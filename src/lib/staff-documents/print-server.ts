import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AppSession } from "@/lib/session";
import { STAFF_DOCUMENT_BUCKET } from "@/lib/staff-documents/server";
import { buildPrintSheet, type PrintablePerson } from "@/lib/staff-documents/print";
import type { IdDocumentKind } from "@/lib/staff-documents/fields";

/**
 * 신분 서류 A4 인쇄(재류카드 R3) — 서버 쪽 읽기 · 기록. docs/product/41 §3-4.
 *
 * 권한: `staff_documents.view` + 같은 조직. 주소의 사람 id 는 **이 조직 서류 · 이 조직 멤버십**으로만 걸러 읽는다 —
 * 다른 조직 사람 id 를 넣어도 그 조직 서류는 처음부터 조회 대상이 아니다(빠진 사람 수로만 보인다).
 * 사진은 인쇄 화면을 그릴 때 만든 10분 서명 URL.
 */

const SIGNED_URL_SECONDS = 600;

export function canPrintIdDocuments(session: AppSession): boolean {
  return session.capabilities.includes("staff_documents.view") && session.organization.id !== "platform";
}

type CurrentDocRow = {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  name_roman: string | null;
  birth_date: string | null;
  nationality_text: string | null;
  card_number: string | null;
  residence_status: string | null;
  expires_on: string | null;
  work_restriction: string | null;
  extra_activity: string | null;
  front_path: string;
  back_path: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
};

/** 이 조직에서 인쇄할 수 있는 지금 서류(멤버십이 있는 사람만), 주소 순서대로. */
async function loadPrintableDocs(organizationId: string, userIds: string[]): Promise<CurrentDocRow[]> {
  if (userIds.length === 0) return [];
  const service = getSupabaseServiceClient();
  const [docs, members] = await Promise.all([
    service
      .from("staff_id_documents")
      .select(
        "id, user_id, kind, status, name_roman, birth_date, nationality_text, card_number, residence_status, expires_on, work_restriction, extra_activity, front_path, back_path, confirmed_by, confirmed_at",
      )
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .in("user_id", userIds),
    service.from("memberships").select("user_id").eq("organization_id", organizationId).in("user_id", userIds),
  ]);
  if (docs.error) throw docs.error;
  if (members.error) throw members.error;
  const memberIds = new Set((members.data ?? []).map((m) => m.user_id));
  const byUser = new Map((docs.data ?? []).map((row) => [row.user_id, row as CurrentDocRow]));
  return userIds.flatMap((id) => {
    const row = byUser.get(id);
    return row && memberIds.has(id) ? [row] : [];
  });
}

export async function loadPrintPeople(
  session: AppSession,
  userIds: string[],
): Promise<{ people: PrintablePerson[]; skipped: number; printerName: string }> {
  const organizationId = session.organization.id;
  const docs = await loadPrintableDocs(organizationId, userIds);
  const service = getSupabaseServiceClient();

  const profileIds = [...new Set([...docs.map((d) => d.user_id), ...docs.flatMap((d) => (d.confirmed_by ? [d.confirmed_by] : [])), session.user.id])];
  const paths = docs.flatMap((d) => (d.kind === "my_number_card" ? [d.front_path] : [d.front_path, d.back_path ?? ""])).filter(Boolean);

  const [profiles, signed] = await Promise.all([
    service
      .from("profiles")
      .select("id, name, name_katakana, name_ko, name_ja, name_en, nationality, birth_date")
      .in("id", profileIds),
    paths.length > 0
      ? service.storage.from(STAFF_DOCUMENT_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);
  const profileById = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  const people = docs.map((d): PrintablePerson => {
    const kind = d.kind as IdDocumentKind;
    const p = profileById.get(d.user_id);
    const sheet = buildPrintSheet({
      kind,
      status: d.status as "pending" | "confirmed" | "returned",
      organizationName: session.organization.name,
      profile: {
        nameKatakana: p?.name_katakana ?? null,
        nameKo: p?.name_ko ?? null,
        nameJa: p?.name_ja ?? null,
        nameEn: p?.name_en ?? null,
        nationality: p?.nationality ?? null,
        birthDate: p?.birth_date ?? null,
      },
      doc: {
        nameRoman: d.name_roman,
        birthDate: d.birth_date,
        nationalityText: d.nationality_text,
        // 마이넘버 카드는 개인번호를 받지 않지만, 어떤 값이 있어도 인쇄 칸에 넘기지 않는다.
        cardNumber: kind === "my_number_card" ? null : d.card_number,
        residenceStatus: d.residence_status,
        expiresOn: d.expires_on,
        workRestriction: d.work_restriction,
        extraActivity: d.extra_activity,
        confirmedAt: d.confirmed_at,
      },
      confirmedByName: d.confirmed_by ? (profileById.get(d.confirmed_by)?.name ?? null) : null,
    });
    return {
      userId: d.user_id,
      documentId: d.id,
      kind,
      sheet,
      frontUrl: urlByPath.get(d.front_path) ?? null,
      backUrl: kind === "my_number_card" || !d.back_path ? null : (urlByPath.get(d.back_path) ?? null),
    };
  });

  return {
    people,
    skipped: userIds.length - people.length,
    printerName: profileById.get(session.user.id)?.name ?? session.user.name ?? "",
  };
}

/** 인쇄 기록 — 대상 한 사람당 한 줄(누가 · 언제 · 누구 것 · 어느 서류). 같은 걸러내기로 다시 읽어 넣는다. */
export async function recordPrint(session: AppSession, userIds: string[]): Promise<number> {
  const docs = await loadPrintableDocs(session.organization.id, userIds);
  if (docs.length === 0) return 0;
  const { error } = await getSupabaseServiceClient()
    .from("staff_document_print_logs")
    .insert(
      docs.map((d) => ({
        organization_id: session.organization.id,
        printed_by: session.user.id,
        user_id: d.user_id,
        document_id: d.id,
      })),
    );
  if (error) throw error;
  return docs.length;
}
