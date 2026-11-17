import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canEnableAutomation, effectiveMessageCount, effectiveRecipientCount, orphanDestinations } from "@/lib/automation/enable-guard";
import { buildReservationAlertCard } from "@/lib/automation/messages";
import { channelNameOf, reservationNumberOf, type AutomationReservation } from "@/lib/automation/reservation-fields";
import { getReservationDisplayId, resolveReservationNumber } from "@/lib/reservation-display-id";
import { dictionaries } from "@/lib/i18n";

/** 자동화 9순위 unslop — 켜기 판정 · 연결 안 된 채널 · 알림의 예약 번호(2026-11-17). */

describe("켜기 판정 — 실제로 나가는 받는 곳이 0곳이면 막는다", () => {
  const known = ["ops", "cs"];
  it("받는 곳이 없으면 no_destination", () => {
    expect(canEnableAutomation([], known)).toEqual({ count: 0, error: "no_destination", ok: false });
  });
  it("채널은 있어도 체크한 언어가 하나도 없으면 막는다", () => {
    expect(canEnableAutomation([{ channelKey: "ops", locales: [] }], known).ok).toBe(false);
  });
  it("연결 안 된 채널만 있으면 막는다(센다고 해도 보낼 수 없다)", () => {
    expect(canEnableAutomation([{ channelKey: "old", locales: ["ko"] }], known)).toEqual({ count: 0, error: "no_destination", ok: false });
  });
  it("연결된 채널에 언어가 하나라도 있으면 켤 수 있고, 나가는 곳 수에 연결 안 된 줄은 빠진다", () => {
    const list = [
      { channelKey: "ops", locales: ["ko" as const] },
      { channelKey: "cs", locales: [] },
      { channelKey: "old", locales: ["ja" as const] },
    ];
    expect(canEnableAutomation(list, known)).toEqual({ count: 1, ok: true });
    expect(effectiveRecipientCount(list, known)).toBe(1);
  });
});

describe("받는 곳 N곳 · 메시지 N통 — 머리와 확인 창이 같은 기준", () => {
  const known = ["ops", "cs"];
  const list = [
    { channelKey: "ops", locales: ["ko" as const, "en" as const] },
    { channelKey: "cs", locales: ["ja" as const] },
    { channelKey: "old", locales: ["ko" as const, "ja" as const, "en" as const] },
    { channelKey: "cs2", locales: [] },
  ];
  it("연결 안 된 채널의 언어는 메시지 통수에 들어가지 않는다", () => {
    expect(effectiveRecipientCount(list, known)).toBe(2);
    expect(effectiveMessageCount(list, known)).toBe(3);
  });
  it("곳 수와 통수는 canEnableAutomation 의 count 와 항상 같다", () => {
    expect(canEnableAutomation(list, known)).toMatchObject({ count: effectiveRecipientCount(list, known) });
  });
});

describe("연결 안 된 채널 줄", () => {
  const saved = [
    { channelKey: "ops", locales: ["ko" as const] },
    { channelKey: "old", locales: ["ja" as const, "en" as const] },
  ];
  it("지금 연결된 채널에 없는 받는 곳만 돌려준다", () => {
    expect(orphanDestinations(saved, ["ops", "cs"])).toEqual([{ channelKey: "old", locales: ["ja", "en"] }]);
  });
  it("모두 연결돼 있으면 비어 있다", () => {
    expect(orphanDestinations(saved, ["ops", "old"])).toEqual([]);
  });
  it("연결된 채널이 하나도 없으면 저장된 건 전부 보인다", () => {
    expect(orphanDestinations(saved, [])).toHaveLength(2);
  });
});

describe("알림의 예약 번호 — 채널 번호 → Beds24 번호, 내부 UUID 는 안 보임", () => {
  const UUID = "00000000-1111-2222-3333-444444444444";
  it("저장된 채널 예약번호가 먼저 · 객실 꼬리표는 뗀다", () => {
    expect(reservationNumberOf({ bookId: "555" }, "HMABC12345::room::201")).toBe("HMABC12345");
  });
  it("채널 번호가 없으면 Beds24 번호(예약 캘린더와 같은 순서)", () => {
    expect(reservationNumberOf({ apiReference: "HMXYZ98765", bookId: "555" })).toBe("555");
    expect(reservationNumberOf({ apiReference: "HMXYZ98765" }, null)).toBe("HMXYZ98765");
  });
  it("규칙은 하나 — 캘린더(getReservationDisplayId)와 같은 값, 채널 번호는 알림에서만 먼저", () => {
    const row = { raw_payload: { bookId: "555" }, source_reservation_id: "999::room::201" };
    expect(getReservationDisplayId(row)).toBe("555");
    expect(getReservationDisplayId({ raw_payload: {}, source_reservation_id: "999::room::201" })).toBe("999");
    expect(resolveReservationNumber({ channelReservationId: "HMABC12345", rawPayload: row.raw_payload })).toBe("HMABC12345");
    expect(resolveReservationNumber({ rawPayload: {}, sourceReservationId: "" })).toBeNull();
  });
  it("아무 번호도 없으면 null — UUID 를 돌려주지 않는다", () => {
    expect(reservationNumberOf({}, null)).toBeNull();
    expect(reservationNumberOf({}, "")).toBeNull();
  });
  it("채널 이름 — 원본 이름 → 번호 모양 → 없으면 -", () => {
    expect(channelNameOf({ referer: "Airbnb" }, null)).toBe("Airbnb");
    expect(channelNameOf({}, "HMABC12345")).toBe("Airbnb");
    expect(channelNameOf({}, "4321098765")).toBe("Booking.com");
    expect(channelNameOf({}, null)).toBe("-");
  });
  it("채널 이름이 원본에 있으면 번호 모양으로 짐작하지 않는다", () => {
    expect(channelNameOf({ referer: "Expedia" }, "HMABC12345")).toBe("Expedia");
    expect(channelNameOf({ channel: "Rakuten" }, "4321098765")).toBe("Rakuten");
    expect(channelNameOf({ apiSource: "Agoda" }, "4321098765")).toBe("Agoda");
  });
  it("번호 모양이 둘 다 아니면 짐작하지 않는다", () => {
    expect(channelNameOf({}, "12345")).toBe("-");
    expect(channelNameOf({}, "hmabc12345")).toBe("-");
  });
  it("당일예약 카드 — 번호 없는 예약에도 UUID 가 새지 않고 채널이 채워진다", () => {
    const reservation = {
      channelReservationId: "HMABC12345",
      checkIn: "2026-10-20",
      checkOut: "2026-10-22",
      guestName: "Kim",
      id: UUID,
      lastKnownAmount: null,
      propertyName: "아라키초A",
      raw: { price: 10000 },
      roomLabel: "201",
      status: "confirmed",
      updatedAt: "2026-10-20T01:00:00Z",
    } as AutomationReservation;
    const card = buildReservationAlertCard({
      copy: dictionaries.ko.automationMessages,
      kind: "same_day",
      openUrl: null,
      propertyLabel: "아라키초A",
      reservation,
      roomLabel: "AA201",
      today: "2026-10-20",
    });
    expect(JSON.stringify(card)).not.toContain(UUID);
    expect(card.context).toContain("예약 HMABC12345");
    expect(JSON.stringify(card.rows)).toContain("Airbnb");
    const bare = buildReservationAlertCard({
      copy: dictionaries.ko.automationMessages,
      kind: "same_day",
      openUrl: null,
      propertyLabel: "아라키초A",
      reservation: { ...reservation, channelReservationId: null },
      roomLabel: "AA201",
      today: "2026-10-20",
    });
    expect(JSON.stringify(bare)).not.toContain(UUID);
  });
});
