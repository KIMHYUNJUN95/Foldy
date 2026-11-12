"use server";

/**
 * PC `/admin/messages` 「자동 안내」 탭 · 대화 오른쪽 패널의 자동 안내 액션(모바일은 읽기만 — 그래서 `src/actions` 가 아니라 여기).
 * docs/product/47-guest-messaging.md §5-3 · §5-6
 *
 * - 규칙 만들기 · 고치기 · 지우기 · 켜기 · 미리 보기: 관리자 웹 + `guest_messages.manage`.
 * - 예약 하나 멈추기 · 다시 보내기: 관리자 웹 + (`guest_messages.manage` 또는 `guest_messages.view` + `guest_messages.reply`) —
 *   답장하는 사람이 「이미 도착한 손님」에게 안 가게 멈출 수 있게.
 * - 아니면 redirect 없이 `forbidden`. 조직은 세션에서, 쓰기는 service_role.
 * - 규칙이 바뀌면 바로 계획을 다시 돈다(큐 넣기 없음 · Beds24 호출 없음) — 「보낼 예정」 · 「다음 발송」이 곧바로 맞게.
 */

import { revalidatePath } from "next/cache";
import { getAdminSessionForApi } from "@/lib/admin-session";
import { validateAutoRuleInput, type AutoRule, type AutoRuleInputError } from "@/lib/guest-messages/auto-model";
import {
  createAutoRule,
  deleteAutoRule,
  loadUpcomingAutoRuns,
  previewAutoRule,
  setAutoRuleEnabled,
  setAutoRunPaused,
  updateAutoRule,
  type AutoPreview,
} from "@/lib/guest-messages/auto-rules-server";
import { runAutoMessagePlanner } from "@/lib/guest-messages/auto-scheduler";
import { isGuestLang } from "@/lib/guest-messages/guest-info-model";
import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import { hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AutoRunView } from "@/lib/guest-messages/auto-model";

type Gate = { ok: true; organizationId: string; userId: string } | { ok: false; errorKey: "forbidden" };

async function gate(mode: "manage" | "pause"): Promise<Gate> {
  const auth = await getAdminSessionForApi().catch(() => null);
  if (!auth?.ok || !hasOrganizationContext(auth.session)) return { ok: false, errorKey: "forbidden" };
  const caps = auth.session.capabilities;
  const allowed =
    caps.includes("guest_messages.manage") ||
    (mode === "pause" && caps.includes("guest_messages.view") && caps.includes("guest_messages.reply"));
  if (!allowed) return { ok: false, errorKey: "forbidden" };
  return { ok: true, organizationId: auth.session.organization.id, userId: auth.session.user.id };
}

function revalidate() {
  revalidatePath("/admin/messages");
  revalidatePath("/mobile/messages");
}

/** 계획 다시 — 실패해도 저장은 끝났다(다음 바퀴 · 웹훅이 바로잡는다). */
async function replan(organizationId: string): Promise<void> {
  try {
    await runAutoMessagePlanner(getSupabaseServiceClient(), organizationId, { enqueue: false });
  } catch (error) {
    console.error("[guest-messages/auto] replan failed", error instanceof Error ? error.message : "unknown");
  }
}

export type SaveAutoRuleActionResult =
  | { ok: true; rule: AutoRule }
  | { ok: false; errorKey: "forbidden" | AutoRuleInputError | "limit" | "not_found" | "failed" }
  | { ok: false; errorKey: "conflict"; current: AutoRule };

export async function saveAutoRuleAction(input: unknown): Promise<SaveAutoRuleActionResult> {
  const access = await gate("manage");
  if (!access.ok) return access;
  const checked = validateAutoRuleInput(input);
  if (!checked.ok) return { ok: false, errorKey: checked.error };
  const record = (input ?? {}) as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  if (id !== null && !UUID_RE.test(id)) return { ok: false, errorKey: "invalid_input" };
  const db = getSupabaseServiceClient();
  try {
    let saved;
    if (id) {
      const expected = typeof record.expectedUpdatedAt === "string" ? record.expectedUpdatedAt : null;
      if (!expected) return { ok: false, errorKey: "invalid_input" };
      saved = await updateAutoRule(db, access.organizationId, id, checked.value, expected);
    } else {
      saved = await createAutoRule(db, access.organizationId, access.userId, checked.value);
    }
    if (!saved.ok) {
      if (saved.error === "conflict") return { ok: false, errorKey: "conflict", current: saved.current };
      return { ok: false, errorKey: saved.error === "save_failed" ? "failed" : saved.error };
    }
    await replan(access.organizationId);
    revalidate();
    return { ok: true, rule: saved.rule };
  } catch (error) {
    console.error("[guest-messages/auto] save failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

export type SimpleAutoResult = { ok: true } | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "locked" | "failed" };

export async function toggleAutoRuleAction(id: string, enabled: boolean): Promise<{ ok: true; rule: AutoRule } | Exclude<SimpleAutoResult, { ok: true }>> {
  const access = await gate("manage");
  if (!access.ok) return access;
  if (typeof id !== "string" || !UUID_RE.test(id) || typeof enabled !== "boolean") return { ok: false, errorKey: "invalid" };
  const result = await setAutoRuleEnabled(getSupabaseServiceClient(), access.organizationId, id, enabled);
  if (result === "failed") return { ok: false, errorKey: "failed" };
  if (!result) return { ok: false, errorKey: "not_found" };
  await replan(access.organizationId);
  revalidate();
  return { ok: true, rule: result };
}

export async function deleteAutoRuleAction(id: string): Promise<SimpleAutoResult> {
  const access = await gate("manage");
  if (!access.ok) return access;
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, errorKey: "invalid" };
  const result = await deleteAutoRule(getSupabaseServiceClient(), access.organizationId, id);
  if (result !== "ok") return { ok: false, errorKey: result };
  revalidate();
  return { ok: true };
}

export async function setAutoRunPausedAction(runId: string, paused: boolean): Promise<SimpleAutoResult> {
  const access = await gate("pause");
  if (!access.ok) return access;
  if (typeof runId !== "string" || !UUID_RE.test(runId) || typeof paused !== "boolean") return { ok: false, errorKey: "invalid" };
  const db = getSupabaseServiceClient();
  const result = await setAutoRunPaused(db, access.organizationId, runId, paused, access.userId);
  if (result !== "ok") return { ok: false, errorKey: result };
  // 다시 보내기는 계획이 빈 값 · 지난 시각을 다시 본다.
  if (!paused) await replan(access.organizationId);
  revalidate();
  return { ok: true };
}

export async function previewAutoRuleAction(input: {
  bodies: unknown;
  lang: unknown;
  providerBookingId: unknown;
}): Promise<{ ok: true; preview: AutoPreview } | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "failed" }> {
  const access = await gate("manage");
  if (!access.ok) return access;
  const bodies = input?.bodies as Record<string, unknown> | null;
  if (!bodies || typeof bodies !== "object" || !isGuestLang(input.lang) || typeof input.providerBookingId !== "string") {
    return { ok: false, errorKey: "invalid" };
  }
  if (!/^\d{1,15}$/.test(input.providerBookingId)) return { ok: false, errorKey: "invalid" };
  const clean = {
    ko: typeof bodies.ko === "string" ? bodies.ko.slice(0, 2000) : "",
    ja: typeof bodies.ja === "string" ? bodies.ja.slice(0, 2000) : "",
    en: typeof bodies.en === "string" ? bodies.en.slice(0, 2000) : "",
  };
  try {
    const preview = await previewAutoRule(getSupabaseServiceClient(), access.organizationId, {
      bodies: clean,
      lang: input.lang,
      providerBookingId: input.providerBookingId,
    });
    return preview ? { ok: true, preview } : { ok: false, errorKey: "not_found" };
  } catch (error) {
    console.error("[guest-messages/auto] preview failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, errorKey: "failed" };
  }
}

export async function listUpcomingAutoRunsAction(ruleId: string | null): Promise<{ ok: true; runs: AutoRunView[] } | { ok: false; errorKey: "forbidden" | "invalid" | "failed" }> {
  const access = await gate("manage");
  if (!access.ok) return access;
  if (ruleId !== null && (typeof ruleId !== "string" || !UUID_RE.test(ruleId))) return { ok: false, errorKey: "invalid" };
  try {
    return { ok: true, runs: await loadUpcomingAutoRuns(getSupabaseServiceClient(), access.organizationId, { ruleId }) };
  } catch {
    return { ok: false, errorKey: "failed" };
  }
}
