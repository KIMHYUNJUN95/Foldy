"use server";

/**
 * 과거 답장에서 찾은 후보 — PC `/admin/messages` · 모바일 `/mobile/messages` 공용. docs/product/49-guest-message-ai-reply-assist.md §9
 *
 * 권한(서버에서만 판정, 거부는 redirect 없이 `forbidden`):
 * - 정해 둔 문구 후보(보기 · 추가 · 빼기 · 되돌리기) — `guest_messages.view` + `guest_messages.manage`(정해 둔 문구 관리와 같은 기준).
 * - 건물 안내 후보(보기 · 넣기 · 빼기 · 되돌리기) — `guest_messages.view` + `property_info.edit`(건물 손님용 칸 고치기와 같은 기준).
 * - 「다시 찾기」(돈이 드는 실행) — `guest_messages.view` + `guest_messages.manage`.
 * - 목록은 권한 있는 종류만 읽는다(둘 다 없으면 `forbidden`).
 * 조직 id 는 세션에서만. 결과에는 후보 중심 벡터 · 내부 값(이전 값 등)을 싣지 않는다.
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { UUID_RE } from "@/lib/guest-messages/inbox-model";
import {
  addSavedReplyCandidate,
  applyGuestInfoCandidate,
  candidatesAvailable,
  dismissCandidate,
  loadCandidateOverview,
  markGuestInfoCandidatesApplied,
  restoreDismissedCandidate,
  runCandidateExtraction,
  startCandidateRun,
  undoAddSavedReplyCandidate,
  undoGuestInfoCandidate,
  type CandidateOverview,
  type CandidateView,
} from "@/lib/guest-messages/reply-candidates-server";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Kind = "saved_reply" | "guest_info";

type Gate = { ok: true; organizationId: string; userId: string; kinds: Kind[] } | { ok: false };

async function gate(): Promise<Gate> {
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || !hasOrganizationContext(session)) return { ok: false };
  const capabilities = session.capabilities;
  if (!capabilities.includes("guest_messages.view")) return { ok: false };
  const kinds: Kind[] = [];
  if (capabilities.includes("guest_messages.manage")) kinds.push("saved_reply");
  if (capabilities.includes("property_info.edit")) kinds.push("guest_info");
  if (kinds.length === 0) return { ok: false };
  return { ok: true, organizationId: session.organization.id, userId: session.user.id, kinds };
}

function logFailure(scope: string, error: unknown) {
  console.error(`[guest-candidates] ${scope} failed`, error instanceof Error ? error.message : "unknown");
}

function revalidate() {
  revalidatePath("/admin/messages");
  revalidatePath("/mobile/messages");
}

function validId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

function validKind(kind: unknown): kind is Kind {
  return kind === "saved_reply" || kind === "guest_info";
}

export type CandidateOverviewResult =
  | ({ ok: true; canRun: boolean; kinds: Kind[] } & CandidateOverview)
  | { ok: false; errorKey: "forbidden" | "failed" };

/** 후보 화면 열기 — 권한 있는 종류만. 키가 없으면 `available: false`(화면은 「사용할 수 없음」). */
export async function getReplyCandidates(): Promise<CandidateOverviewResult> {
  const auth = await gate();
  if (!auth.ok) return { ok: false, errorKey: "forbidden" };
  try {
    const overview = await loadCandidateOverview(getSupabaseServiceClient(), auth.organizationId, auth.kinds);
    return { ok: true, canRun: auth.kinds.includes("saved_reply"), kinds: auth.kinds, ...overview };
  } catch (error) {
    logFailure("overview", error);
    return { ok: false, errorKey: "failed" };
  }
}

export type RunCandidatesResult = { ok: true } | { ok: false; errorKey: "forbidden" | "unavailable" | "busy" | "cap" | "failed" };

/**
 * 「다시 찾기」 — 실행 줄을 잡고(조직마다 하나 · 한 달 상한 안) 뽑기는 응답 뒤 `after()` 에서. 화면은 `getReplyCandidates` 로 끝을 본다.
 */
export async function runReplyCandidates(): Promise<RunCandidatesResult> {
  const auth = await gate();
  if (!auth.ok || !auth.kinds.includes("saved_reply")) return { ok: false, errorKey: "forbidden" };
  if (!candidatesAvailable()) return { ok: false, errorKey: "unavailable" };
  const db = getSupabaseServiceClient();
  try {
    const started = await startCandidateRun(db, auth.organizationId, auth.userId);
    if (!started.ok) return { ok: false, errorKey: started.error };
    const { organizationId } = auth;
    const runId = started.runId;
    after(async () => {
      await runCandidateExtraction(getSupabaseServiceClient(), organizationId, runId);
      revalidate();
    });
    return { ok: true };
  } catch (error) {
    logFailure("run", error);
    return { ok: false, errorKey: "failed" };
  }
}

export type CandidateActionResult =
  | { ok: true; candidate: CandidateView }
  | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "too_long" | "limit" | "conflict" | "changed" | "failed" };

function fromDecide(result: Awaited<ReturnType<typeof dismissCandidate>>): CandidateActionResult {
  if (result.ok) return result;
  if (result.error === "invalid_input") return { ok: false, errorKey: "invalid" };
  if (result.error === "save_failed") return { ok: false, errorKey: "failed" };
  return { ok: false, errorKey: result.error };
}

/** 문구 후보 「추가」 — 사람이 고친 제목 · 본문으로 정해 둔 문구를 만든다(이때만 저장). */
export async function addReplyCandidate(id: string, input: unknown): Promise<CandidateActionResult> {
  const auth = await gate();
  if (!auth.ok || !auth.kinds.includes("saved_reply")) return { ok: false, errorKey: "forbidden" };
  if (!validId(id)) return { ok: false, errorKey: "invalid" };
  try {
    const result = fromDecide(await addSavedReplyCandidate(getSupabaseServiceClient(), auth.organizationId, auth.userId, id, input));
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    logFailure("add", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 「추가」 되돌리기(5초) — 만든 문구를 지우고 후보로. */
export async function undoAddReplyCandidate(id: string): Promise<CandidateActionResult> {
  const auth = await gate();
  if (!auth.ok || !auth.kinds.includes("saved_reply")) return { ok: false, errorKey: "forbidden" };
  if (!validId(id)) return { ok: false, errorKey: "invalid" };
  try {
    const result = fromDecide(await undoAddSavedReplyCandidate(getSupabaseServiceClient(), auth.organizationId, id));
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    logFailure("undo add", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 「빼기」 — 영영 숨김. 종류마다 그 종류 권한으로. */
export async function dismissReplyCandidate(id: string, kind: Kind): Promise<CandidateActionResult> {
  const auth = await gate();
  if (!validKind(kind) || !auth.ok || !auth.kinds.includes(kind)) return { ok: false, errorKey: "forbidden" };
  if (!validId(id)) return { ok: false, errorKey: "invalid" };
  try {
    return fromDecide(await dismissCandidate(getSupabaseServiceClient(), auth.organizationId, auth.userId, id, kind));
  } catch (error) {
    logFailure("dismiss", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 「빼기」 되돌리기(5초 토스트 · 끝낸 것에서 다시 보기). */
export async function restoreReplyCandidate(id: string, kind: Kind): Promise<CandidateActionResult> {
  const auth = await gate();
  if (!validKind(kind) || !auth.ok || !auth.kinds.includes(kind)) return { ok: false, errorKey: "forbidden" };
  if (!validId(id)) return { ok: false, errorKey: "invalid" };
  try {
    return fromDecide(await restoreDismissedCandidate(getSupabaseServiceClient(), auth.organizationId, id, kind));
  } catch (error) {
    logFailure("restore", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 건물 칸 「넣기」(PC 후보 화면 · 모바일 공용 — 바로 저장). 고른 값(사람이 고칠 수 있음)을 그 칸에만. */
export async function applyGuestInfoReplyCandidate(id: string, value: unknown): Promise<CandidateActionResult> {
  const auth = await gate();
  if (!auth.ok || !auth.kinds.includes("guest_info")) return { ok: false, errorKey: "forbidden" };
  if (!validId(id)) return { ok: false, errorKey: "invalid" };
  try {
    const result = fromDecide(await applyGuestInfoCandidate(getSupabaseServiceClient(), auth.organizationId, auth.userId, id, value));
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    logFailure("apply", error);
    return { ok: false, errorKey: "failed" };
  }
}

/** 건물 칸 「넣기」 되돌리기 — 그 사이 누가 그 칸을 고쳤으면 `changed`(덮어쓰지 않는다). */
export async function undoGuestInfoReplyCandidate(id: string): Promise<CandidateActionResult> {
  const auth = await gate();
  if (!auth.ok || !auth.kinds.includes("guest_info")) return { ok: false, errorKey: "forbidden" };
  if (!validId(id)) return { ok: false, errorKey: "invalid" };
  try {
    const result = fromDecide(await undoGuestInfoCandidate(getSupabaseServiceClient(), auth.organizationId, id));
    if (result.ok) revalidate();
    return result;
  } catch (error) {
    logFailure("undo apply", error);
    return { ok: false, errorKey: "failed" };
  }
}

export type MarkAppliedResult = { ok: true; marked: string[] } | { ok: false; errorKey: "forbidden" | "invalid" | "not_found" | "failed" };

/**
 * PC 건물 패널 — 폼으로 넣은 후보를 패널 저장 성공 뒤 「추가함」으로(그 칸이 실제로 채워진 것만).
 * 미연결(2026-11-19): 화면은 후보를 `applyGuestInfoReplyCandidate` 로 바로 저장하고, 건물 패널은 후보를 모른다.
 * 패널에서 같은 칸을 직접 채운 후보는 다음 「넣기」에서 `conflict` 로 남는다 — 49 §9-6.
 */
export async function markGuestInfoCandidatesSaved(propertyName: string, ids: unknown): Promise<MarkAppliedResult> {
  const auth = await gate();
  if (!auth.ok || !auth.kinds.includes("guest_info")) return { ok: false, errorKey: "forbidden" };
  if (typeof propertyName !== "string" || !propertyName.trim()) return { ok: false, errorKey: "invalid" };
  if (!Array.isArray(ids) || ids.length > 50 || !ids.every(validId)) return { ok: false, errorKey: "invalid" };
  try {
    const result = await markGuestInfoCandidatesApplied(getSupabaseServiceClient(), auth.organizationId, auth.userId, propertyName, ids);
    if (!result.ok) return { ok: false, errorKey: result.error === "not_found" ? "not_found" : "failed" };
    return result;
  } catch (error) {
    logFailure("mark applied", error);
    return { ok: false, errorKey: "failed" };
  }
}
