// 재류카드 만료 알림 — 하루 한 번 평가(2026-10-23, docs/product/41 「만료 알림」 · docs/product/14).
//
// 시간이 지나서 생기는 알림이라 누가 무엇을 해서 생기지 않는다 → 매일 `/api/tasks/reminders` 크론이 부른다(다른 작업과 따로 감싸서,
// 여기서 실패해도 다른 작업 결과는 그대로).
//
// 규칙:
//   * 대상: 지금 카드(`is_current`) · **재류카드만**(마이넘버 카드 유효기간은 취로 자격이 아니다) · 상태 확인 대기/확인함(「다시 요청」은 날짜를 못 믿는다).
//   * 단계: 90일 전 · 30일 전 · 만료(만료일 다음 날부터) — `dueIdDocExpiryStage`. **건너간 뒤에도** 보낸다(크론이 빠진 날 다음 날 보냄),
//     가장 급한 단계 하나만(이미 20일 남은 카드에 90일 알림을 뒤늦게 보내지 않는다).
//   * 중복: notifications unique (recipient_user_id, dedupe_key), 키 `id_doc_expiring:<서류id>:<단계>` — 받는 사람마다 단계당 한 번.
//   * 받는 사람: 카드 주인(→ `/account/id-card`, 본인 글) + 같은 조직에서 `staff_documents.view` 를 가진 활성 멤버(역할 기본 + 개인 부여/차단,
//     `memberIdsWithCapability`)(→ `/mobile/users/<주인 멤버십 id>`, 「OOO님」 글). 주인이 그 권한을 가져도 본인 글 한 통만.
//   * 주인의 멤버십이 active 가 아니면(퇴사 · 정지) 보내지 않는다.
//   * 알림 글은 막지 않고 확인만 — 기간 안에 갱신 신청을 했으면(特例期間) 계속 일할 수 있어서 「확인해 주세요」로 쓴다.

import type { SupabaseClient } from "@supabase/supabase-js";
import { memberIdsWithCapability } from "@/lib/capabilities-server";
import { createNotification } from "@/lib/notifications/create";
import type { IdDocumentExpiryNotificationPayload } from "@/lib/notifications/types";
import { dueIdDocExpiryStage, idDocExpiryDedupeKey, ID_DOC_EXPIRY_THRESHOLDS } from "@/lib/staff-documents/expiry";
import { daysUntil } from "@/lib/staff-documents/fields";
import { tokyoToday, ymdShift } from "@/lib/tokyo-date";
import type { Database } from "@/types/database";

type Service = SupabaseClient<Database>;

type DocRow = { id: string; organization_id: string; user_id: string; expires_on: string };

export type IdDocumentReminderResult = {
  scanned: number;
  due: number;
  created: number;
};

const PAGE = 1000;

export async function runIdDocumentExpiryReminders(
  service: Service,
  options: { organizationId?: string; today?: string } = {},
): Promise<IdDocumentReminderResult> {
  const today = options.today ?? tokyoToday();
  // 90일 안(과 이미 지난 것)만 후보 — 그 밖은 오늘 보낼 단계가 없다.
  const horizon = ymdShift(today, ID_DOC_EXPIRY_THRESHOLDS.d90);

  const docs: DocRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = service
      .from("staff_id_documents")
      .select("id, organization_id, user_id, expires_on")
      .eq("is_current", true)
      .eq("kind", "residence_card")
      .in("status", ["pending", "confirmed"])
      .not("expires_on", "is", null)
      .lte("expires_on", horizon)
      .order("id")
      .range(from, from + PAGE - 1);
    if (options.organizationId) query = query.eq("organization_id", options.organizationId);
    const { data, error } = await query;
    if (error) throw new Error(`id document reminders: ${error.message}`);
    const rows = (data ?? []) as DocRow[];
    docs.push(...rows);
    if (rows.length < PAGE) break;
  }

  const byOrg = new Map<string, { doc: DocRow; stage: NonNullable<ReturnType<typeof dueIdDocExpiryStage>>; daysLeft: number }[]>();
  for (const doc of docs) {
    const daysLeft = daysUntil(doc.expires_on, today);
    const stage = dueIdDocExpiryStage(daysLeft);
    if (!stage || daysLeft === null) continue;
    byOrg.set(doc.organization_id, [...(byOrg.get(doc.organization_id) ?? []), { doc, stage, daysLeft }]);
  }

  let due = 0;
  let created = 0;
  for (const [organizationId, items] of byOrg) {
    const userIds = [...new Set(items.map((item) => item.doc.user_id))];
    const [membershipRes, profileRes, admins] = await Promise.all([
      service.from("memberships").select("id, user_id, status").eq("organization_id", organizationId).in("user_id", userIds),
      service.from("profiles").select("id, name").in("id", userIds),
      memberIdsWithCapability(organizationId, "staff_documents.view"),
    ]);
    const activeMembership = new Map<string, string>();
    for (const row of (membershipRes.data ?? []) as { id: string; user_id: string; status: string }[]) {
      if (row.status === "active") activeMembership.set(row.user_id, row.id);
    }
    const names = new Map(((profileRes.data ?? []) as { id: string; name: string | null }[]).map((row) => [row.id, row.name]));

    for (const { doc, stage, daysLeft } of items) {
      const membershipId = activeMembership.get(doc.user_id);
      if (!membershipId) continue;
      due += 1;
      const dedupeKey = idDocExpiryDedupeKey(doc.id, stage);
      const base: Omit<IdDocumentExpiryNotificationPayload, "audience"> = {
        documentId: doc.id,
        subjectUserId: doc.user_id,
        subjectName: names.get(doc.user_id) ?? null,
        stage,
        daysLeft,
      };
      const holder = await createNotification(service, {
        organizationId,
        recipientUserId: doc.user_id,
        type: "id_document_expiring",
        href: "/account/id-card",
        sourceType: "staff_id_document",
        sourceId: doc.id,
        dedupeKey,
        payload: { ...base, audience: "holder" },
      });
      if (holder.created) created += 1;
      for (const adminId of admins) {
        if (adminId === doc.user_id) continue;
        const result = await createNotification(service, {
          organizationId,
          recipientUserId: adminId,
          type: "id_document_expiring",
          href: `/mobile/users/${membershipId}`,
          sourceType: "staff_id_document",
          sourceId: doc.id,
          dedupeKey,
          payload: { ...base, audience: "admin" },
        });
        if (result.created) created += 1;
      }
    }
  }

  return { scanned: docs.length, due, created };
}
