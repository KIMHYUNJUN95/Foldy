"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { STAFF_DOCUMENT_BUCKET } from "@/lib/staff-documents/server";
import { loadUploadTarget } from "@/lib/staff-documents/roster-server";
import { actorCanOpenUserManagement } from "@/lib/user-management-access";
import {
  EMPTY_ID_FIELDS,
  adminUploadFields,
  normalizeIdFields,
  validateAdminIdFields,
  type IdDocumentField,
  type IdDocumentFields,
  type IdFieldErrorKey,
} from "@/lib/staff-documents/fields";

/**
 * 관리자 대신 올리기(재류카드 R4, 2026-10-26) — PC `/admin/users/documents` · 모바일 `/mobile/users/documents` 가 같이 부른다.
 *
 * 사무실에 있는 종이 복사본을 스캔 · 촬영해 올리고 칸은 원본을 보고 손으로 채운다(자동 읽기 없음 — 동의는 본인만 할 수 있다).
 * 올리면 바로 「확인함」이다(올린 사람 = 확인한 사람, `uploaded_by` 로 「관리자가 올림」을 보인다).
 *
 * 사진: 저장소 insert 정책은 본인 경로만 허락한다. 그래서 서버가 권한을 본 뒤 **대상 사람 경로**의 일회용 서명 업로드 주소를
 * 만들어 준다(`prepareStaffIdUpload`) — 정책은 그대로 두고, 남의 경로에 올릴 수 있는 길은 이 액션 하나다.
 * 문: 화면과 같은 문 — 사용자 관리(`actorCanOpenUserManagement`) + `staff_documents.view` + 대상이 이 조직 활성 멤버(개발자 계정 제외). 자기 서류는 대신 올리지 않는다(개발자 예외 — 확인과 같은 규칙).
 * 거부는 `forbidden` 결과로 돌려준다(redirect 하지 않는다 — 폰 사용자를 관리자 화면으로 던지지 않게).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = /^(front|back)-[0-9a-z]{6,24}\.jpg$/;

type Side = "front" | "back";

async function reviewerSession() {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  if (!session.capabilities.includes("staff_documents.view")) return null;
  // 보기 권한만 따로 받은 사람이 액션을 직접 불러 「확인함」을 쓰지 못하게 화면 문과 맞춘다.
  if (!(await actorCanOpenUserManagement(session.user.id, session.user.role))) return null;
  return session;
}

function isPathFor(path: string | null | undefined, organizationId: string, userId: string, documentId: string, side: Side) {
  if (!path) return false;
  const parts = path.split("/");
  return (
    parts.length === 4 &&
    parts[0] === organizationId &&
    parts[1] === userId &&
    parts[2] === documentId &&
    FILE.test(parts[3]) &&
    parts[3].startsWith(`${side}-`)
  );
}

function randomName(side: Side) {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `${side}-${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}.jpg`;
}

export type PrepareStaffIdUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; errorKey: "forbidden" | "no_nationality" | "failed" };

/** 한 면을 올릴 일회용 주소 — 다시 고를 때마다 새 이름(덮어쓰지 않는다). 저장 때 안 쓴 파일은 지운다. */
export async function prepareStaffIdUpload(input: { userId: string; documentId: string; side: Side }): Promise<PrepareStaffIdUploadResult> {
  const session = await reviewerSession();
  if (!session) return { ok: false, errorKey: "forbidden" };
  if (!UUID.test(input.userId) || !UUID.test(input.documentId)) return { ok: false, errorKey: "forbidden" };
  if (input.side !== "front" && input.side !== "back") return { ok: false, errorKey: "forbidden" };
  if (input.userId === session.user.id && session.user.role !== "developer_super_admin") return { ok: false, errorKey: "forbidden" };
  const target = await loadUploadTarget(session.organization.id, input.userId);
  if (!target) return { ok: false, errorKey: "forbidden" };
  if (!target.kind) return { ok: false, errorKey: "no_nationality" };
  if (target.kind === "my_number_card" && input.side === "back") return { ok: false, errorKey: "forbidden" };

  const path = `${session.organization.id}/${input.userId}/${input.documentId}/${randomName(input.side)}`;
  const { data, error } = await getSupabaseServiceClient().storage.from(STAFF_DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, errorKey: "failed" };
  return { ok: true, path, token: data.token };
}

export type SaveStaffIdDocumentInput = {
  userId: string;
  documentId: string;
  frontPath: string;
  backPath: string | null;
  fields: Partial<IdDocumentFields>;
};

export type SaveStaffIdDocumentResult =
  | { ok: true }
  | {
      ok: false;
      errorKey: "forbidden" | "no_nationality" | "invalid" | "photo_missing" | "failed";
      fieldErrors?: Partial<Record<IdDocumentField, IdFieldErrorKey>>;
    };

/** 대신 올린 서류 저장 — 바로 「확인함」. 이 사람의 지금 서류가 있으면 이력으로 내린다(본인 등록과 같은 순서). */
export async function saveStaffIdDocumentByAdmin(input: SaveStaffIdDocumentInput): Promise<SaveStaffIdDocumentResult> {
  const session = await reviewerSession();
  if (!session) return { ok: false, errorKey: "forbidden" };
  const org = session.organization.id;
  if (!UUID.test(input.userId) || !UUID.test(input.documentId)) return { ok: false, errorKey: "forbidden" };
  if (input.userId === session.user.id && session.user.role !== "developer_super_admin") return { ok: false, errorKey: "forbidden" };
  const target = await loadUploadTarget(org, input.userId);
  if (!target) return { ok: false, errorKey: "forbidden" };
  if (!target.kind) return { ok: false, errorKey: "no_nationality" };
  const kind = target.kind;
  if (!isPathFor(input.frontPath, org, input.userId, input.documentId, "front")) return { ok: false, errorKey: "photo_missing" };
  const backPath = kind === "residence_card" ? input.backPath : null;
  if (kind === "residence_card" && !isPathFor(backPath, org, input.userId, input.documentId, "back")) {
    return { ok: false, errorKey: "photo_missing" };
  }

  // 화면이 보여 준 칸만 받는다 — 나머지(이름 · 생년월일)는 프로필에서 채운다.
  const allowed = adminUploadFields(kind);
  const picked: Partial<IdDocumentFields> = {};
  for (const key of allowed) picked[key] = String(input.fields[key] ?? "") as never;
  const fields = normalizeIdFields({
    ...EMPTY_ID_FIELDS,
    ...picked,
    nameRoman: kind === "residence_card" ? target.nameEn : target.nameJa,
    birthDate: target.birthDate,
  });
  const fieldErrors = validateAdminIdFields(kind, fields);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, errorKey: "invalid", fieldErrors };

  const service = getSupabaseServiceClient();
  const folder = `${org}/${input.userId}/${input.documentId}`;
  const { data: listed } = await service.storage.from(STAFF_DOCUMENT_BUCKET).list(folder, { limit: 100 });
  const names = new Set((listed ?? []).map((f) => `${folder}/${f.name}`));
  if (!names.has(input.frontPath) || (backPath && !names.has(backPath))) return { ok: false, errorKey: "photo_missing" };

  const nullable = (value: string) => (value ? value : null);
  const now = new Date().toISOString();
  const { error } = await service.from("staff_id_documents").insert({
    id: input.documentId,
    organization_id: org,
    user_id: input.userId,
    kind,
    status: "confirmed",
    is_current: false,
    front_path: input.frontPath,
    back_path: backPath,
    name_roman: nullable(fields.nameRoman),
    birth_date: nullable(fields.birthDate),
    expires_on: nullable(fields.expiresOn),
    card_number: nullable(fields.cardNumber),
    residence_status: nullable(fields.residenceStatus),
    work_restriction: nullable(fields.workRestriction),
    extra_activity: nullable(fields.extraActivity),
    ocr_used: false,
    ocr_values: null,
    edited_fields: [],
    confirmed_by: session.user.id,
    confirmed_at: now,
    uploaded_by: session.user.id,
  });
  if (error) {
    console.error("[staff-documents] admin insert failed", error.code);
    return { ok: false, errorKey: "failed" };
  }

  // 내리기 → 올리기는 한 트랜잭션이 아니다. 같은 순간 본인도 제출해 올리기가 「지금 카드 하나」 규칙에 걸리면
  // 새 행을 지우고 내렸던 카드를 되살린다 — 지금 카드가 0장이 되거나, 같은 문서 id 로 다시 저장이 영영 막히지 않게.
  // 사진은 남겨 둔다(같은 id 로 다시 저장할 수 있게, 그만두면 `discardStaffIdUpload` 가 지운다).
  const { data: previous } = await service
    .from("staff_id_documents")
    .select("id")
    .eq("organization_id", org)
    .eq("user_id", input.userId)
    .eq("is_current", true);
  const previousIds = (previous ?? []).map((row) => row.id);
  const { error: demoteError } =
    previousIds.length > 0
      ? await service.from("staff_id_documents").update({ is_current: false }).eq("organization_id", org).in("id", previousIds)
      : { error: null };
  const { error: promoteError } = demoteError
    ? { error: demoteError }
    : await service.from("staff_id_documents").update({ is_current: true }).eq("organization_id", org).eq("id", input.documentId);
  if (promoteError) {
    console.error("[staff-documents] admin promote failed", promoteError.code);
    await service.from("staff_id_documents").delete().eq("organization_id", org).eq("id", input.documentId);
    if (previousIds.length > 0 && !demoteError) {
      await service.from("staff_id_documents").update({ is_current: true }).eq("organization_id", org).in("id", previousIds);
    }
    return { ok: false, errorKey: "failed" };
  }

  const unused = [...names].filter((path) => path !== input.frontPath && path !== backPath);
  if (unused.length > 0) await service.storage.from(STAFF_DOCUMENT_BUCKET).remove(unused);

  revalidatePath("/admin/users", "layout");
  revalidatePath("/mobile/users", "layout");
  return { ok: true };
}

/**
 * 대신 올리기를 그만둘 때(취소 · 다른 사람으로 · 화면 닫기) 올려 둔 사진을 지운다 — 개인정보 사진이 행 없이 남지 않게.
 * 그 문서 id 로 저장된 행이 있으면 아무것도 지우지 않는다(이미 쓰는 사진). 창을 그냥 닫으면 불리지 못한다 — 41 「R4 구현」 남은 틈.
 */
export async function discardStaffIdUpload(input: { userId: string; documentId: string }): Promise<{ ok: boolean }> {
  const session = await reviewerSession();
  if (!session) return { ok: false };
  if (!UUID.test(input.userId) || !UUID.test(input.documentId)) return { ok: false };
  const org = session.organization.id;
  const service = getSupabaseServiceClient();
  const { data: row } = await service.from("staff_id_documents").select("id").eq("organization_id", org).eq("id", input.documentId).maybeSingle();
  if (row) return { ok: true };
  const folder = `${org}/${input.userId}/${input.documentId}`;
  const { data: listed } = await service.storage.from(STAFF_DOCUMENT_BUCKET).list(folder, { limit: 100 });
  const names = (listed ?? []).map((f) => `${folder}/${f.name}`).filter((path) => FILE.test(path.split("/")[3] ?? ""));
  if (names.length > 0) await service.storage.from(STAFF_DOCUMENT_BUCKET).remove(names);
  return { ok: true };
}
