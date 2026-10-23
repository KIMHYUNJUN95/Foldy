import { describe, expect, it } from "vitest";
import { dueIdDocExpiryStage, idDocExpiryDedupeKey, residenceCardNotice } from "@/lib/staff-documents/expiry";
import { daysUntil } from "@/lib/staff-documents/fields";
import { categoryForType } from "@/lib/notifications/grouping";
import { buildNotificationViews } from "@/lib/notifications/brief";
import type { NotificationRow } from "@/lib/notifications/types";

describe("dueIdDocExpiryStage — 재류카드 만료 알림 단계", () => {
  it("90일보다 많이 남으면 보낼 것 없음", () => {
    expect(dueIdDocExpiryStage(91)).toBeNull();
    expect(dueIdDocExpiryStage(365)).toBeNull();
  });

  it("정확히 90일 · 30일에 그 단계", () => {
    expect(dueIdDocExpiryStage(90)).toBe("d90");
    expect(dueIdDocExpiryStage(30)).toBe("d30");
  });

  it("크론이 빠져 문턱을 지나친 날에도 같은 단계(건너간 뒤에도 보냄)", () => {
    expect(dueIdDocExpiryStage(88)).toBe("d90");
    expect(dueIdDocExpiryStage(31)).toBe("d90");
    expect(dueIdDocExpiryStage(29)).toBe("d30");
    expect(dueIdDocExpiryStage(1)).toBe("d30");
  });

  it("만료일 당일(0일)은 아직 유효 — 30일 단계, 다음 날부터 만료", () => {
    expect(dueIdDocExpiryStage(0)).toBe("d30");
    expect(dueIdDocExpiryStage(-1)).toBe("expired");
  });

  it("처음 등록할 때 이미 지났으면 만료 단계 하나만(90 · 30일 알림을 뒤늦게 보내지 않음)", () => {
    expect(dueIdDocExpiryStage(-400)).toBe("expired");
  });

  it("처음 등록할 때 20일 남았으면 30일 단계만", () => {
    expect(dueIdDocExpiryStage(20)).toBe("d30");
  });

  it("만료일이 없으면 null", () => {
    expect(dueIdDocExpiryStage(null)).toBeNull();
    expect(dueIdDocExpiryStage(Number.NaN)).toBeNull();
  });

  it("도쿄 날짜 키로 남은 날 계산 — 달 · 윤년 경계, 문턱 정확히", () => {
    expect(daysUntil("2027-01-29", "2026-10-31")).toBe(90);
    expect(dueIdDocExpiryStage(daysUntil("2027-01-29", "2026-10-31"))).toBe("d90");
    expect(dueIdDocExpiryStage(daysUntil("2027-01-30", "2026-10-31"))).toBeNull();
    expect(daysUntil("2028-03-01", "2028-01-31")).toBe(30); // 2028 윤년(2월 29일)
    expect(dueIdDocExpiryStage(daysUntil("2026-10-22", "2026-10-23"))).toBe("expired");
  });

  it("dedupe 키 — 서류 · 단계마다", () => {
    expect(idDocExpiryDedupeKey("doc-1", "d30")).toBe("id_doc_expiring:doc-1:d30");
    expect(idDocExpiryDedupeKey("doc-1", "expired")).not.toBe(idDocExpiryDedupeKey("doc-1", "d30"));
  });
});

describe("residenceCardNotice — 본인 근태 홈 안내", () => {
  it("만료 · 30일 안 · 그 밖", () => {
    expect(residenceCardNotice(-3)).toEqual({ kind: "expired" });
    expect(residenceCardNotice(0)).toEqual({ kind: "expiring", days: 0 });
    expect(residenceCardNotice(30)).toEqual({ kind: "expiring", days: 30 });
    expect(residenceCardNotice(31)).toBeNull();
    expect(residenceCardNotice(null)).toBeNull();
  });
});

describe("id_document_expiring 알림 줄", () => {
  const row = (payload: Record<string, unknown>): NotificationRow =>
    ({
      id: "n1",
      organization_id: "o",
      recipient_user_id: "u",
      type: "id_document_expiring",
      href: "/account/id-card",
      source_type: "staff_id_document",
      source_id: "doc-1",
      dedupe_key: "id_doc_expiring:doc-1:d30",
      payload,
      read_at: null,
      created_at: "2026-10-23T00:00:00Z",
    }) as unknown as NotificationRow;

  it("근태 탭으로 묶는다", () => {
    expect(categoryForType("id_document_expiring")).toBe("attendance");
  });

  it("본인 · 관리자 글이 다르다(ko)", () => {
    const base = { documentId: "doc-1", subjectUserId: "u", subjectName: "김하루", stage: "d30", daysLeft: 29 };
    const { views } = buildNotificationViews([row({ ...base, audience: "holder" }), row({ ...base, audience: "admin" })], {
      locale: "ko",
      now: new Date("2026-10-23T01:00:00Z"),
    });
    expect(views[0].title).toBe("재류카드 기간이 29일 남았어요");
    expect(views[1].title).toBe("김하루님 재류카드 기간이 29일 남았어요");
    expect(views[0].category).toBe("attendance");
  });

  it("만료 단계(ja · en)", () => {
    const payload = { documentId: "doc-1", subjectUserId: "u", subjectName: "Kim", stage: "expired", daysLeft: -1, audience: "admin" };
    expect(buildNotificationViews([row(payload)], { locale: "en" }).views[0].title).toBe("Kim's residence card period has passed");
    expect(buildNotificationViews([row(payload)], { locale: "ja" }).views[0].title).toBe("Kimさんの在留カードの期間が過ぎています");
  });
});
