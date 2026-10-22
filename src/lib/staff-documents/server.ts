import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoToday } from "@/lib/tokyo-date";
import {
  daysUntil,
  normalizeIdFields,
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
