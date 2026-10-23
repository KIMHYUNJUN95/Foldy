import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoToday } from "@/lib/tokyo-date";
import {
  daysUntil,
  expiryTone,
  normalizeIdFields,
  type ExpiryTone,
  type IdDocumentField,
  type IdDocumentFields,
  type IdDocumentKind,
  type IdDocumentStatus,
} from "@/lib/staff-documents/fields";
import type { Database } from "@/types/database";

/**
 * 직원 신분 서류 읽기 — 본인 화면 · 관리자 사용자 패널이 같이 쓴다(docs/product/41 §3-3).
 * 사진은 공개 URL 이 없다. 볼 때마다 10분짜리 서명 URL 을 만든다. 권한 확인은 부르는 쪽(서버 액션 · 페이지)이 먼저 한다.
 */

export const STAFF_DOCUMENT_BUCKET = "staff-documents";
const SIGNED_URL_SECONDS = 600;

type Row = Database["public"]["Tables"]["staff_id_documents"]["Row"];

export type IdDocumentView = {
  id: string;
  kind: IdDocumentKind;
  status: IdDocumentStatus;
  fields: IdDocumentFields;
  editedFields: IdDocumentField[];
  ocrUsed: boolean;
  frontUrl: string | null;
  backUrl: string | null;
  returnReason: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  submittedAt: string;
  /** 만료까지 남은 날(도쿄). 만료일이 없으면 null. */
  expiryDays: number | null;
};

export function rowToFields(row: Row): IdDocumentFields {
  return normalizeIdFields({
    nameRoman: row.name_roman ?? "",
    birthDate: row.birth_date ?? "",
    gender: (row.gender ?? "") as IdDocumentFields["gender"],
    nationalityText: row.nationality_text ?? "",
    address: row.address ?? "",
    expiresOn: row.expires_on ?? "",
    cardNumber: row.card_number ?? "",
    residenceStatus: row.residence_status ?? "",
    workRestriction: (row.work_restriction ?? "") as IdDocumentFields["workRestriction"],
    extraActivity: (row.extra_activity ?? "") as IdDocumentFields["extraActivity"],
  });
}

/** 이 사람의 지금 서류(없으면 null). `withPhotos` 면 앞 · 뒤 서명 URL 도 만든다. */
export async function loadCurrentIdDocument(
  organizationId: string,
  userId: string,
  { withPhotos }: { withPhotos: boolean },
): Promise<IdDocumentView | null> {
  const service = getSupabaseServiceClient();
  const { data: row } = await service
    .from("staff_id_documents")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_current", true)
    .maybeSingle();
  if (!row) return null;

  let frontUrl: string | null = null;
  let backUrl: string | null = null;
  if (withPhotos) {
    const paths = [row.front_path, row.back_path].filter((p): p is string => Boolean(p));
    const { data: signed } = await service.storage.from(STAFF_DOCUMENT_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    frontUrl = byPath.get(row.front_path) ?? null;
    backUrl = row.back_path ? (byPath.get(row.back_path) ?? null) : null;
  }

  let confirmedByName: string | null = null;
  if (row.confirmed_by) {
    const { data: who } = await service.from("profiles").select("name").eq("id", row.confirmed_by).maybeSingle();
    confirmedByName = who?.name ?? null;
  }

  const fields = rowToFields(row);
  return {
    id: row.id,
    kind: row.kind as IdDocumentKind,
    status: row.status as IdDocumentStatus,
    fields,
    editedFields: (row.edited_fields ?? []) as IdDocumentField[],
    ocrUsed: row.ocr_used,
    frontUrl,
    backUrl,
    returnReason: row.return_reason,
    confirmedAt: row.confirmed_at,
    confirmedByName,
    submittedAt: row.created_at,
    expiryDays: daysUntil(fields.expiresOn, tokyoToday()),
  };
}

/** 지금 서류가 있는가 — 「등록해 주세요」 안내용(사진 없이 한 번 읽기). */
export async function hasCurrentIdDocument(organizationId: string, userId: string): Promise<boolean> {
  const service = getSupabaseServiceClient();
  const { count } = await service
    .from("staff_id_documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_current", true);
  return (count ?? 0) > 0;
}

export type IdDocumentBadge = { status: IdDocumentStatus; tone: ExpiryTone | null };

/** 조직의 지금 서류를 사람별로 한 번에(목록 칩용, 사진 없음). 호출 쪽이 `staff_documents.view` 를 먼저 확인한다. */
export async function loadIdDocumentBadges(organizationId: string): Promise<Map<string, IdDocumentBadge>> {
  const { data } = await getSupabaseServiceClient()
    .from("staff_id_documents")
    .select("user_id, status, expires_on")
    .eq("organization_id", organizationId)
    .eq("is_current", true)
    .limit(5000);
  const today = tokyoToday();
  const map = new Map<string, IdDocumentBadge>();
  for (const row of (data ?? []) as { user_id: string; status: IdDocumentStatus; expires_on: string | null }[]) {
    map.set(row.user_id, { status: row.status, tone: expiryTone(row.expires_on ? daysUntil(row.expires_on, today) : null) });
  }
  return map;
}

/** 확인 대기 사람 수 — 목록 칩 · 「확인 대기 N」과 같은 기준(이 조직 멤버십이 있는 사람). 메뉴 숫자용이라 가볍게, 실패하면 0. */
export async function countPendingIdDocumentPeople(organizationId: string): Promise<number> {
  try {
    const service = getSupabaseServiceClient();
    const { data: pending } = await service
      .from("staff_id_documents")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .eq("status", "pending")
      .limit(1000);
    const ids = [...new Set(((pending ?? []) as { user_id: string }[]).map((row) => row.user_id))];
    if (ids.length === 0) return 0;
    const { data: members } = await service.from("memberships").select("user_id").eq("organization_id", organizationId).in("user_id", ids);
    return new Set(((members ?? []) as { user_id: string }[]).map((row) => row.user_id)).size;
  } catch {
    return 0;
  }
}

/**
 * 재류카드가 만료된 사람(지금 카드 · 재류카드 · 확인 대기/확인함 · 만료일 < 오늘 도쿄) — 청소 배정 · 근태 관리 화면의 「재류카드 만료」 칩용
 * (docs/product/41 「만료 표시」, 2026-10-23). **사람 id 만** 돌려준다 — 카드 번호 · 만료일 · 사진 같은 카드 내용은 싣지 않으므로
 * `staff_documents.view` 가 없는 배정 · 근태 담당에게도 보여 줄 수 있다(조직 범위 · 그 화면의 권한은 부르는 쪽이 이미 확인).
 * 마이넘버 카드는 취로 자격과 무관해 빼고, 「다시 요청」 상태는 날짜를 믿을 수 없어 뺀다. 실패하면 빈 목록(경고는 덤).
 */
export async function loadExpiredResidenceCardUserIds(organizationId: string): Promise<string[]> {
  try {
    const { data } = await getSupabaseServiceClient()
      .from("staff_id_documents")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .eq("kind", "residence_card")
      .in("status", ["pending", "confirmed"])
      .lt("expires_on", tokyoToday())
      .limit(5000);
    return [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))];
  } catch {
    return [];
  }
}

/** 본인 재류카드 만료까지 남은 날(도쿄) — 근태 홈 안내용. 재류카드가 없거나(마이넘버 · 미등록) 「다시 요청」이거나 만료일이 없으면 null. */
export async function loadOwnResidenceCardDaysLeft(organizationId: string, userId: string): Promise<number | null> {
  try {
    const { data } = await getSupabaseServiceClient()
      .from("staff_id_documents")
      .select("expires_on, status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("is_current", true)
      .eq("kind", "residence_card")
      .maybeSingle();
    const row = data as { expires_on: string | null; status: string } | null;
    if (!row?.expires_on || row.status === "returned") return null;
    return daysUntil(row.expires_on, tokyoToday());
  } catch {
    return null;
  }
}
