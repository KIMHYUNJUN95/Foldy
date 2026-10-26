import "server-only";

import { nationalityName } from "@/lib/identity-names";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { tokyoToday } from "@/lib/tokyo-date";
import { daysUntil, documentKindFor, type IdDocumentKind, type IdDocumentStatus } from "@/lib/staff-documents/fields";
import { rosterBucket, sortRoster, type StaffDocRosterRow } from "@/lib/staff-documents/roster";
import type { AppSession } from "@/lib/session";

/**
 * 「직원 서류」 목록 데이터(재류카드 R4, 2026-10-26) — PC `/admin/users/documents` · 모바일 `/mobile/users/documents` 가 같이 읽는다.
 * 이 조직의 **활성** 멤버 전부(개발자 계정 제외)와 지금 서류를 한 줄씩. 사진은 읽지 않는다(고른 사람만 따로).
 * 부르는 쪽이 `staff_documents.view` 를 먼저 확인한다 — 없으면 이 함수를 부르지 않는다.
 */
export async function loadStaffDocumentRoster(session: AppSession): Promise<StaffDocRosterRow[]> {
  const orgId = session.organization.id;
  const locale = session.user.preferredLanguage;
  const service = getSupabaseServiceClient();
  const { data: memberData } = await service
    .from("memberships")
    .select("user_id, role, joined_at")
    .eq("organization_id", orgId)
    .eq("status", "active");
  const members = (memberData ?? []) as { user_id: string; role: string; joined_at: string | null }[];
  const userIds = [...new Set(members.map((m) => m.user_id))];
  if (userIds.length === 0) return [];

  const [{ data: profileData }, { data: devData }, { data: docData }] = await Promise.all([
    service.from("profiles").select("id, name, nationality").in("id", userIds),
    service.from("platform_admins").select("user_id").in("user_id", userIds).eq("is_active", true),
    service
      .from("staff_id_documents")
      .select("user_id, kind, status, expires_on, residence_status, card_number, uploaded_by")
      .eq("organization_id", orgId)
      .eq("is_current", true)
      .limit(5000),
  ]);
  const profiles = new Map(((profileData ?? []) as { id: string; name: string | null; nationality: string | null }[]).map((p) => [p.id, p]));
  const devIds = new Set(((devData ?? []) as { user_id: string }[]).map((row) => row.user_id));
  type DocRow = {
    user_id: string;
    kind: string;
    status: string;
    expires_on: string | null;
    residence_status: string | null;
    card_number: string | null;
    uploaded_by: string | null;
  };
  const docs = new Map(((docData ?? []) as DocRow[]).map((d) => [d.user_id, d]));
  const today = tokyoToday();

  const rows: StaffDocRosterRow[] = [];
  for (const member of members) {
    if (devIds.has(member.user_id)) continue;
    const profile = profiles.get(member.user_id);
    const nationality = profile?.nationality ?? null;
    const d = docs.get(member.user_id);
    const doc = d
      ? {
          kind: d.kind as IdDocumentKind,
          status: d.status as IdDocumentStatus,
          residenceStatus: d.residence_status ?? "",
          expiresOn: d.expires_on ?? "",
          cardNumber: d.card_number ?? "",
          days: d.expires_on ? daysUntil(d.expires_on, today) : null,
          uploadedByAdmin: Boolean(d.uploaded_by),
        }
      : null;
    rows.push({
      userId: member.user_id,
      name: profile?.name ?? "",
      nationalityName: nationality ? nationalityName(nationality, locale) : "",
      role: member.role,
      joinedAt: member.joined_at,
      kind: nationality ? documentKindFor(nationality) : null,
      doc,
      bucket: rosterBucket(doc),
      isSelf: member.user_id === session.user.id,
    });
  }
  return sortRoster(rows);
}

/** 대신 올리기 대상 한 사람 — 이 조직 활성 멤버인지 · 이름 · 서류 종류. 아니면 null. */
export async function loadUploadTarget(
  organizationId: string,
  userId: string,
): Promise<{ userId: string; name: string; kind: IdDocumentKind | null; nameEn: string; nameJa: string; birthDate: string } | null> {
  const service = getSupabaseServiceClient();
  const [{ data: membership }, { data: profile }, { data: dev }] = await Promise.all([
    service.from("memberships").select("id").eq("organization_id", organizationId).eq("user_id", userId).eq("status", "active").maybeSingle(),
    service.from("profiles").select("id, name, nationality, name_en, name_ja, birth_date").eq("id", userId).maybeSingle(),
    service.from("platform_admins").select("user_id").eq("user_id", userId).eq("is_active", true).maybeSingle(),
  ]);
  // 목록과 같은 대상 — 개발자 계정은 목록에 없으니 대신 올리기 대상도 아니다.
  if (!membership || !profile || dev) return null;
  return {
    userId,
    name: profile.name ?? "",
    kind: profile.nationality ? documentKindFor(profile.nationality) : null,
    nameEn: profile.name_en ?? "",
    nameJa: profile.name_ja ?? "",
    birthDate: profile.birth_date ?? "",
  };
}
