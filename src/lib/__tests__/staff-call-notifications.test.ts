import { describe, expect, it } from "vitest";

import { resolveCheckinNotificationLink } from "@/lib/checkin/staff-call";
import { buildNotificationViews } from "@/lib/notifications/brief";
import { getNotificationDisplay, notificationTypeLabel } from "@/lib/notifications/display";
import type { NotificationRow } from "@/lib/notifications/types";

// 새 알림 3종의 글 · 눌렀을 때 — docs/product/46 §4, docs/product/14.
const row = (type: string, payload: Record<string, unknown>) =>
  ({
    id: "n1",
    organization_id: "o",
    recipient_user_id: "u",
    type,
    href: "/admin/checkin",
    source_type: "checkin_staff_call",
    source_id: "c1",
    dedupe_key: "k",
    payload,
    read_at: null,
    created_at: "2026-11-06T00:00:00.000Z",
  }) as unknown as NotificationRow;

const TYPES = ["checkin_staff_call", "checkin_call_missed", "checkin_staff_check"] as const;
const LOCALES = ["ko", "ja", "en"] as const;
const payload = { callId: "c1", stayId: "s1", propertyKey: "arakicho_a" };

describe("문구", () => {
  it.each(TYPES.flatMap((type) => LOCALES.map((locale) => [type, locale] as const)))("%s · %s — 건물 이름이 그 언어로, 빈 문구 없음", (type, locale) => {
    const display = getNotificationDisplay(row(type, payload), locale);
    expect(display.title).toBeTruthy();
    expect(display.body).not.toContain("{building}");
    expect(display.body).not.toContain("arakicho_a");
    expect(notificationTypeLabel(type, locale)).toBeTruthy();
    const { views } = buildNotificationViews([row(type, payload)], { locale });
    expect(views[0].title).toBe(display.title);
    expect(views[0].object).not.toContain("arakicho_a");
  });
});

describe("눌렀을 때", () => {
  const link = (surface: "admin" | "mobile", canViewCheckin: boolean, type = "checkin_staff_call") =>
    resolveCheckinNotificationLink({ type, callId: "c1", access: { surface, canViewCheckin } });

  it("관리자 콘솔 + checkin.view 면 체크인 화면으로", () => {
    expect(link("admin", true).href).toBe("/admin/checkin");
  });

  it("checkin.view 가 없으면 이동하지 않는다", () => {
    expect(link("admin", false).href).toBe("");
    expect(link("admin", false, "checkin_call_missed").href).toBe("");
  });

  it("모바일에서는 관리자 화면으로 보내지 않는다", () => {
    expect(link("mobile", true).href).toBe("");
    expect(link("mobile", true, "checkin_call_missed").href).toBe("");
  });

  it("호출 알림만 받기 화면으로 다시 이을 수 있다", () => {
    expect(link("mobile", false).staffCallId).toBe("c1");
    expect(link("mobile", false, "checkin_call_missed").staffCallId).toBeNull();
    expect(link("mobile", false, "checkin_staff_check").staffCallId).toBeNull();
  });

  it("권한 정보를 안 넘기면 이동하지 않는다, 다른 알림의 href 는 그대로", () => {
    const { views } = buildNotificationViews(
      [row("checkin_call_missed", payload), { ...row("board_activity", {}), href: "/mobile/board/1" }],
      { locale: "ko" },
    );
    expect(views[0].href).toBe("");
    expect(views[1].href).toBe("/mobile/board/1");
  });
});
