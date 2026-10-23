"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readIdCardPhotos, type OcrResult } from "@/lib/staff-documents/ocr";
import { STAFF_DOCUMENT_BUCKET } from "@/lib/staff-documents/server";
import {
  documentKindFor,
  editedFieldsOf,
  normalizeIdFields,
  validateIdFields,
  type IdDocumentField,
  type IdDocumentFields,
  type IdFieldErrorKey,
} from "@/lib/staff-documents/fields";

/**
 * 재류카드 · 마이넘버 카드 앞면 — 읽기 · 등록 · 관리자 확인(docs/product/41 §3, R2 2026-10-23).
 *
 * 사진 파일은 클라이언트가 본인 경로(`{조직}/{본인}/{서류id}/front-*.jpg`)에 직접 올린다(저장소 규칙이 경로를 막는다).
 * 여기서는 그 경로가 정말 본인 것인지 다시 보고, 표 쓰기는 모두 service role 로 한다(표에 쓰기 정책이 없다).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = /^(front|back)-[0-9a-z]{6,24}\.jpg$/;

function ownPath(path: string | null | undefined, organizationId: string, userId: string, documentId: string, side: "front" | "back") {
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

async function memberSession() {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  return session;
}

export type ReadIdCardInput = { documentId: string; frontPath: string; backPath: string | null; consent: boolean };

/** 찍은 사진을 AI 로 읽어 칸을 미리 채운다. 동의하지 않았으면 부르지 않는다(손 입력). */
export async function readIdCard(input: ReadIdCardInput): Promise<OcrResult | { ok: false; reason: "forbidden" | "no_consent" }> {
  const session = await memberSession();
  if (!session) return { ok: false, reason: "forbidden" };
  if (!input.consent) return { ok: false, reason: "no_consent" };
  const kind = documentKindFor(session.user.identity.nationality);
  const org = session.organization.id;
  const uid = session.user.id;
  if (!UUID.test(input.documentId)) return { ok: false, reason: "forbidden" };
  if (!ownPath(input.frontPath, org, uid, input.documentId, "front")) return { ok: false, reason: "forbidden" };
  if (kind === "residence_card" && !ownPath(input.backPath, org, uid, input.documentId, "back")) {
    return { ok: false, reason: "forbidden" };
  }

  const service = getSupabaseServiceClient();
  const paths = kind === "residence_card" ? [input.frontPath, input.backPath as string] : [input.frontPath];
  const images = [];
  for (const path of paths) {
    const { data, error } = await service.storage.from(STAFF_DOCUMENT_BUCKET).download(path);
    if (error || !data) return { ok: false, reason: "failed" };
    images.push({ data: Buffer.from(await data.arrayBuffer()).toString("base64"), mediaType: "image/jpeg" as const });
  }

  const result = await readIdCardPhotos(kind, images);
  if (!result.ok && result.reason === "individual_number") {
    // 개인번호가 보이는 사진은 남기지 않는다(41 §9-7).
    await service.storage.from(STAFF_DOCUMENT_BUCKET).remove([input.frontPath]);
  }
  return result;
}

export type SubmitIdCardInput = {
  documentId: string;
  frontPath: string;
  backPath: string | null;
  fields: IdDocumentFields;
  /** AI 가 읽은 값(읽기를 안 썼으면 null) — 본인이 고친 칸을 남긴다. */
  readFields: IdDocumentFields | null;
};

export type SubmitIdCardResult =
  | { ok: true }
  | { ok: false; errorKey: "forbidden" | "invalid" | "failed"; fieldErrors?: Partial<Record<IdDocumentField, IdFieldErrorKey>> };

export async function submitIdCard(input: SubmitIdCardInput): Promise<SubmitIdCardResult> {
  const session = await memberSession();
  if (!session) return { ok: false, errorKey: "forbidden" };
  const nationality = session.user.identity.nationality;
  if (!nationality) return { ok: false, errorKey: "forbidden" };
  const kind = documentKindFor(nationality);
  const org = session.organization.id;
  const uid = session.user.id;
  if (!UUID.test(input.documentId)) return { ok: false, errorKey: "forbidden" };
  if (!ownPath(input.frontPath, org, uid, input.documentId, "front")) return { ok: false, errorKey: "forbidden" };
  const backPath = kind === "residence_card" ? input.backPath : null;
  if (kind === "residence_card" && !ownPath(backPath, org, uid, input.documentId, "back")) {
    return { ok: false, errorKey: "forbidden" };
  }

  const fields = normalizeIdFields(input.fields);
  if (kind === "my_number_card") {
    fields.cardNumber = "";
    fields.residenceStatus = "";
    fields.workRestriction = "";
    fields.extraActivity = "";
  }
  const fieldErrors = validateIdFields(kind, fields);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, errorKey: "invalid", fieldErrors };
  const readFields = input.readFields ? normalizeIdFields(input.readFields) : null;

  const service = getSupabaseServiceClient();
  // 사진이 실제로 올라가 있는지 — 폴더 목록으로 확인하고, 다시 찍느라 남은 파일은 지운다.
  const folder = `${org}/${uid}/${input.documentId}`;
  const { data: listed } = await service.storage.from(STAFF_DOCUMENT_BUCKET).list(folder, { limit: 100 });
  const names = new Set((listed ?? []).map((f) => `${folder}/${f.name}`));
  if (!names.has(input.frontPath) || (backPath && !names.has(backPath))) return { ok: false, errorKey: "invalid" };

  const nullable = (value: string) => (value ? value : null);
  const { error } = await service.from("staff_id_documents").insert({
    id: input.documentId,
    organization_id: org,
    user_id: uid,
    kind,
    status: "pending",
    // 새 행을 먼저 넣고(아직 지금 카드 아님) → 이전 카드를 이력으로 → 새 행을 지금 카드로. 넣기가 실패해도 이전 카드가 남는다.
    is_current: false,
    front_path: input.frontPath,
    back_path: backPath,
    name_roman: nullable(fields.nameRoman),
    birth_date: nullable(fields.birthDate),
    gender: nullable(fields.gender),
    nationality_text: nullable(fields.nationalityText),
    address: nullable(fields.address),
    expires_on: nullable(fields.expiresOn),
    card_number: nullable(fields.cardNumber),
    residence_status: nullable(fields.residenceStatus),
    work_restriction: nullable(fields.workRestriction),
    extra_activity: nullable(fields.extraActivity),
    ocr_used: readFields !== null,
    ocr_values: readFields,
    edited_fields: editedFieldsOf(readFields, fields, kind),
  });
  if (error) {
    console.error("[staff-documents] insert failed", error.code);
    return { ok: false, errorKey: "failed" };
  }

  const { error: demoteError } = await service
    .from("staff_id_documents")
    .update({ is_current: false })
    .eq("organization_id", org)
    .eq("user_id", uid)
    .eq("is_current", true);
  const { error: promoteError } = demoteError
    ? { error: demoteError }
    : await service.from("staff_id_documents").update({ is_current: true }).eq("id", input.documentId);
  if (promoteError) return { ok: false, errorKey: "failed" };

  // 영문 이름은 가입 때 받지 않는다 — 재류카드의 로마자 이름으로 채운다(비어 있을 때만, 2026-10-23 사용자). 마이넘버 카드는 로마자가 없다.
  if (kind === "residence_card" && fields.nameRoman && !session.user.identity.nameEn) {
    await service.from("profiles").update({ name_en: fields.nameRoman }).eq("id", uid);
  }

  const unused = [...names].filter((path) => path !== input.frontPath && path !== backPath);
  if (unused.length > 0) await service.storage.from(STAFF_DOCUMENT_BUCKET).remove(unused);

  revalidatePath("/account");
  return { ok: true };
}

export type ReviewIdDocumentInput = { documentId: string; decision: "confirm" | "return"; reason?: string };

/** 관리자 확인 — 「확인함」 또는 「다시 요청(사유)」. `staff_documents.view` 가 있는 같은 조직 사람만. */
export async function reviewIdDocument(input: ReviewIdDocumentInput): Promise<{ ok: boolean; errorKey?: "forbidden" | "reason_required" | "failed" }> {
  const session = await memberSession();
  if (!session || !session.capabilities.includes("staff_documents.view")) return { ok: false, errorKey: "forbidden" };
  if (!UUID.test(input.documentId)) return { ok: false, errorKey: "forbidden" };
  const reason = (input.reason ?? "").trim().slice(0, 300);
  if (input.decision === "return" && !reason) return { ok: false, errorKey: "reason_required" };

  const service = getSupabaseServiceClient();
  const { data: row } = await service
    .from("staff_id_documents")
    .select("id, organization_id, is_current")
    .eq("id", input.documentId)
    .maybeSingle();
  if (!row || row.organization_id !== session.organization.id || !row.is_current) return { ok: false, errorKey: "forbidden" };

  const { error } = await service
    .from("staff_id_documents")
    .update(
      input.decision === "confirm"
        ? { status: "confirmed", confirmed_by: session.user.id, confirmed_at: new Date().toISOString(), return_reason: null }
        : { status: "returned", confirmed_by: session.user.id, confirmed_at: new Date().toISOString(), return_reason: reason },
    )
    .eq("id", input.documentId);
  if (error) return { ok: false, errorKey: "failed" };
  revalidatePath("/admin/users");
  revalidatePath("/mobile/users");
  return { ok: true };
}
