"use server";

import { revalidatePath } from "next/cache";

import { checkinPropertyName, resolveArrivalDate, type CheckinArrivalRow, type CheckinArrivalSummary } from "@/lib/checkin/model";
import {
  CHECKIN_DOCUMENTS_BUCKET,
  UUID_PATTERN,
  checkinDb,
  checkinGate,
  runCheckinAction,
  throwOnCheckinError,
  writeCheckinAudit,
  writeCheckinAuditAfterChange,
} from "@/lib/checkin/server";
import { loadCheckinArrivals, loadCheckinStayDetail, type CheckinStayDetail } from "@/lib/checkin/stays";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 셀프 체크인 직원 — 도착 목록 · 상세 · 파일 열람 · 확인함 · 체크인 코드 보기. docs/engineering/16 §4-1.
 * 모바일 · 관리자 공용이라 거부는 redirect 없이 `forbidden` 결과로 돌려준다. `organization_id` 는 항상 세션에서 온다.
 */

type CommonFailure = { ok: false; errorKey: "forbidden" | "not_ready" | "invalid" | "failed" };

// 서명 URL 은 1~5분(44 §6) — 짧은 영상 한 번 재생에 충분한 3분.
const SIGNED_URL_SECONDS = 180;

export type GetCheckinArrivalsResult =
  | { ok: true; date: string; rows: CheckinArrivalRow[]; summary: CheckinArrivalSummary }
  | CommonFailure;

/** `date` 를 안 주면 도쿄 오늘. `propertyKey` 없으면 모든 건물. 권한 `checkin.view`. */
export async function getCheckinArrivals(input: { date?: string | null; propertyKey?: string | null } = {}): Promise<GetCheckinArrivalsResult> {
  const gate = await checkinGate("checkin.view");
  if (!gate.ok) return gate;
  const date = resolveArrivalDate(input.date);
  if (!date) return { ok: false, errorKey: "invalid" };
  if (input.propertyKey && !checkinPropertyName(input.propertyKey)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("arrivals", async () => {
    const { rows, summary } = await loadCheckinArrivals(gate.organizationId, { date, propertyKey: input.propertyKey });
    return { ok: true as const, date, rows, summary };
  });
}

export type GetCheckinStayDetailResult =
  | { ok: true; detail: CheckinStayDetail; canViewDocuments: boolean; canVerify: boolean }
  | CommonFailure
  | { ok: false; errorKey: "not_found" };

/** 권한 `checkin.view`. `checkin.documents` 가 없으면 사람 줄에 `documents` 칸 자체가 없다. */
export async function getCheckinStayDetail(stayId: string): Promise<GetCheckinStayDetailResult> {
  const gate = await checkinGate("checkin.view");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(stayId)) return { ok: false, errorKey: "invalid" };
  const canViewDocuments = gate.capabilities.includes("checkin.documents");
  return runCheckinAction("detail", async () => {
    const detail = await loadCheckinStayDetail(gate.organizationId, stayId, { includeDocuments: canViewDocuments });
    if (!detail) return { ok: false as const, errorKey: "not_found" as const };
    return { ok: true as const, detail, canViewDocuments, canVerify: canViewDocuments };
  });
}

export type OpenCheckinDocumentResult =
  | { ok: true; url: string; kind: string; expiresAt: string }
  | CommonFailure
  | { ok: false; errorKey: "not_found" };

/** 여권 사진 · 얼굴 영상 서명 URL — 부를 때마다 `audit_log` 한 줄. 기록을 못 남기면 주소도 주지 않는다. 권한 `checkin.documents`. */
export async function openCheckinDocument(documentId: string): Promise<OpenCheckinDocumentResult> {
  const gate = await checkinGate("checkin.documents");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(documentId)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("document", async () => {
    const db = checkinDb();
    const { data: doc, error } = await db
      .from("guest_documents")
      .select("id, guest_id, kind, storage_path")
      .eq("organization_id", gate.organizationId)
      .eq("id", documentId)
      .is("replaced_by", null)
      .maybeSingle();
    throwOnCheckinError(error, "guest_documents");
    if (!doc) return { ok: false as const, errorKey: "not_found" as const };

    const { data: guest, error: guestError } = await db
      .from("guests")
      .select("stay_id")
      .eq("organization_id", gate.organizationId)
      .eq("id", doc.guest_id)
      .maybeSingle();
    throwOnCheckinError(guestError, "guests");

    await writeCheckinAudit({
      organizationId: gate.organizationId,
      userId: gate.userId,
      action: "document_viewed",
      stayId: guest?.stay_id ?? null,
      guestId: doc.guest_id,
      documentId: doc.id,
      meta: { kind: doc.kind, expires_in_seconds: SIGNED_URL_SECONDS },
    });

    const { data: signed, error: signError } = await getSupabaseServiceClient()
      .storage.from(CHECKIN_DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS);
    if (signError || !signed) return { ok: false as const, errorKey: "failed" as const };
    return {
      ok: true as const,
      url: signed.signedUrl,
      kind: doc.kind,
      expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString(),
    };
  });
}

export type MarkCheckinStayVerifiedResult =
  | { ok: true; verifiedAt: string; already: boolean }
  | CommonFailure
  | { ok: false; errorKey: "not_found" | "not_checked_in" };

/**
 * 「확인함」 — 체크인이 끝난 건만. 이미 확인된 건은 먼저 확인한 사람 · 시각을 그대로 두고 `already: true`(기록도 더하지 않는다).
 * 권한 `checkin.documents`: 여권 · 영상을 보고 남기는 표시이고, 확인 요청 알림도 이 키를 가진 사람에게 간다(43 §8-16).
 */
export async function markCheckinStayVerified(stayId: string): Promise<MarkCheckinStayVerifiedResult> {
  const gate = await checkinGate("checkin.documents");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(stayId)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("verify", async () => {
    const db = checkinDb();
    const now = new Date().toISOString();
    const { data: updated, error } = await db
      .from("stays")
      .update({ verified_at: now, verified_by: gate.userId, updated_at: now })
      .eq("organization_id", gate.organizationId)
      .eq("id", stayId)
      .eq("status", "checked_in")
      .is("verified_at", null)
      .select("id")
      .maybeSingle();
    throwOnCheckinError(error, "stays");

    if (!updated) {
      const { data: current, error: readError } = await db
        .from("stays")
        .select("status, verified_at")
        .eq("organization_id", gate.organizationId)
        .eq("id", stayId)
        .maybeSingle();
      throwOnCheckinError(readError, "stays");
      if (!current) return { ok: false as const, errorKey: "not_found" as const };
      if (current.verified_at) return { ok: true as const, verifiedAt: current.verified_at, already: true };
      return { ok: false as const, errorKey: "not_checked_in" as const };
    }

    await writeCheckinAuditAfterChange({ organizationId: gate.organizationId, userId: gate.userId, action: "stay_verified", stayId });
    revalidatePath("/admin/checkin");
    return { ok: true as const, verifiedAt: now, already: false };
  });
}

export type RevealCheckinCodeResult =
  | { ok: true; code: string }
  | CommonFailure
  | { ok: false; errorKey: "not_found" | "checked_in" | "cancelled" | "expired" | "no_code" };

/**
 * 체크인 코드 보기(시안 S1c · S1d): 전화로 본인 확인 → 코드 보기 → 말로 알림 → 손님이 태블릿 「코드로 찾기」로 스스로 끝낸다.
 * 직원이 대신 완료시키는 기능은 없다. 목록 · 상세에는 코드가 없고 이 액션으로만 나간다. 볼 때마다 `audit_log` 한 줄(코드 값 없음) —
 * 기록을 못 남기면 코드도 주지 않는다. 권한 `checkin.view`.
 */
export async function revealCheckinCode(stayId: string): Promise<RevealCheckinCodeResult> {
  const gate = await checkinGate("checkin.view");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(stayId)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("reveal-code", async () => {
    const { data: stay, error } = await checkinDb()
      .from("stays")
      .select("status, checkin_code")
      .eq("organization_id", gate.organizationId)
      .eq("id", stayId)
      .maybeSingle();
    throwOnCheckinError(error, "stays");
    if (!stay) return { ok: false as const, errorKey: "not_found" as const };
    if (stay.status === "checked_in" || stay.status === "cancelled" || stay.status === "expired") {
      return { ok: false as const, errorKey: stay.status };
    }
    if (!stay.checkin_code) return { ok: false as const, errorKey: "no_code" as const };

    await writeCheckinAudit({ organizationId: gate.organizationId, userId: gate.userId, action: "checkin_code_revealed", stayId });
    return { ok: true as const, code: stay.checkin_code };
  });
}
