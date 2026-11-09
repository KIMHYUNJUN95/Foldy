import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AUTOMATION_BUILDING_ORDER, cleaningRoomCode } from "@/lib/automation/data";
import { defaultJobConfig, parseSettings } from "@/lib/automation/jobs";
import {
  alertPlatformLabel,
  automationBuildingLabel,
  buildCleaningListMessage,
  buildDailyReportMessage,
  alertCardBlocks,
  buildReservationAlertCard,
  cleaningStructureKey,
  computeDailyStats,
  dailySnapshotOf,
  isFreshCancellation,
  isSameDayBooking,
  isSameDayBookingSince,
  sameSnapshot,
  type CleaningListModel,
} from "@/lib/automation/messages";
import { bookDateOf, cancelInstantOf, originalAmountOf, type AutomationReservation } from "@/lib/automation/reservation-fields";
import { computeNextWake, isScheduledSendDue, nextScheduledSend, tokyoClock } from "@/lib/automation/schedule";
import { dictionaries } from "@/lib/i18n";
import { CALENDAR_BUILDING_ORDER, getCanonicalPropertyName } from "@/lib/room-label-normalization";

/**
 * 자동화 — 저쪽(STAY ARI Manager `slackReports.js`) 규칙 재현과 시각 계산.
 * 도메인 계약: docs/product/36-automation-control.md
 */

const at = (iso: string) => new Date(iso);

describe("자동화 시각 (도쿄)", () => {
  const job = { ...defaultJobConfig("daily_report"), enabled: true, lastDoneOn: null };

  it("도쿄 시계 — UTC 21:30 은 도쿄 다음 날 06:30", () => {
    expect(tokyoClock(at("2026-10-05T21:30:00Z"))).toEqual({ date: "2026-10-06", minutes: 390, weekday: 2 });
  });

  it("발송 시각 전에는 보내지 않고, 06:30 ~ 09:00 사이에 보낸다", () => {
    expect(isScheduledSendDue(job, at("2026-10-05T21:29:00Z"))).toBe(false); // 06:29
    expect(isScheduledSendDue(job, at("2026-10-05T21:30:00Z"))).toBe(true); // 06:30
    expect(isScheduledSendDue(job, at("2026-10-06T00:00:00Z"))).toBe(true); // 09:00
    expect(isScheduledSendDue(job, at("2026-10-06T00:01:00Z"))).toBe(false); // 09:01
  });

  it("오늘 이미 끝냈으면 보내지 않는다 · 꺼져 있으면 보내지 않는다 · 요일이 빠지면 보내지 않는다", () => {
    expect(isScheduledSendDue({ ...job, lastDoneOn: "2026-10-06" }, at("2026-10-05T22:00:00Z"))).toBe(false);
    expect(isScheduledSendDue({ ...job, enabled: false }, at("2026-10-05T22:00:00Z"))).toBe(false);
    expect(isScheduledSendDue({ ...job, weekdays: [1, 3, 4, 5, 6, 7] }, at("2026-10-05T22:00:00Z"))).toBe(false); // 화요일 빠짐
  });

  it("다음 발송 — 오늘 끝났으면 내일 06:30, 창 전이면 오늘 06:30", () => {
    expect(nextScheduledSend(job, at("2026-10-05T20:00:00Z"))?.toISOString()).toBe("2026-10-05T21:30:00.000Z");
    expect(nextScheduledSend({ ...job, lastDoneOn: "2026-10-06" }, at("2026-10-05T22:00:00Z"))?.toISOString()).toBe(
      "2026-10-06T21:30:00.000Z",
    );
  });

  it("실패 직후엔 5분 뒤, 보낸 뒤 확인 창 안이면 10분 뒤", () => {
    const now = at("2026-10-05T22:00:00Z"); // 07:00
    expect(computeNextWake({ ...job, recheckUntil: null }, now, { retryAfterFailure: true })?.toISOString()).toBe(
      "2026-10-05T22:05:00.000Z",
    );
    expect(computeNextWake({ ...job, lastDoneOn: "2026-10-06", recheckUntil: "18:00" }, now)?.toISOString()).toBe(
      "2026-10-05T22:10:00.000Z",
    );
    expect(computeNextWake({ ...job, enabled: false, recheckUntil: null }, now)).toBeNull();
  });

  // 2026-10-07 디버깅 — 화면의 「확인 간격(분)」이 저장만 되고 10분 고정으로 돌던 것.
  it("확인 간격(분) 설정을 따른다", () => {
    const now = at("2026-10-05T22:00:00Z"); // 07:00
    expect(
      computeNextWake({ ...job, lastDoneOn: "2026-10-06", recheckEveryMinutes: 30, recheckUntil: "18:00" }, now)?.toISOString(),
    ).toBe("2026-10-05T22:30:00.000Z");
  });
});

function reservation(partial: Partial<AutomationReservation> & { raw: Record<string, unknown> }): AutomationReservation {
  return {
    checkIn: "2026-10-20",
    checkOut: "2026-10-22",
    guestName: "Kim",
    id: Math.random().toString(36).slice(2),
    propertyName: "아라키초A",
    roomLabel: "201",
    lastKnownAmount: null,
    status: "confirmed",
    updatedAt: "2026-10-05T10:00:00Z",
    ...partial,
  } as AutomationReservation;
}

describe("예약 원본 필드 (저쪽 normalize)", () => {
  it("예약일은 bookingTime 의 도쿄 날짜", () => {
    expect(bookDateOf({ bookingTime: "2026-10-04T16:00:00Z" })).toBe("2026-10-05");
    expect(bookDateOf({ bookTime: "2026-10-05" })).toBe("2026-10-05");
    expect(bookDateOf({ invoiceItems: [{ invoiceDate: "2026-10-07" }, { invoiceDate: "2026-10-03" }] })).toBe("2026-10-03");
    expect(bookDateOf({})).toBeNull();
  });

  it("취소 시각이 없으면 취소된 예약만 마지막 수정 시각을 쓴다", () => {
    expect(cancelInstantOf({ modifiedTime: "2026-10-05T01:00:00Z" }, true)).toBe("2026-10-05T01:00:00Z");
    expect(cancelInstantOf({ modifiedTime: "2026-10-05T01:00:00Z" }, false)).toBeNull();
  });
});

describe("일일 운영 리포트", () => {
  const reportDate = "2026-10-05";
  const stats = () =>
    computeDailyStats({
      buildingOrder: CALENDAR_BUILDING_ORDER,
      canonicalProperty: getCanonicalPropertyName,
      channels: ["airbnb", "booking"],
      excludedProperties: [],
      reportDate,
      reservations: [
        reservation({ raw: { bookingTime: "2026-10-05T03:00:00Z", price: 50000, referer: "Airbnb", status: "confirmed" } }),
        reservation({ checkIn: "2026-11-02", propertyName: "가부키초", raw: { bookingTime: "2026-10-05T05:00:00Z", price: 30000, referer: "Booking.com", status: "new" } }),
        // 금액 0 → 제외
        reservation({ raw: { bookingTime: "2026-10-05T05:00:00Z", price: 0, referer: "Airbnb", status: "confirmed" } }),
        // 수기 예약 → 일일 리포트 채널이 아님
        reservation({ raw: { bookingTime: "2026-10-05T05:00:00Z", price: 9000, referer: "Direct", status: "confirmed" } }),
        // 이번 달이지만 어제가 아님 → 당월 누적에만
        reservation({ raw: { bookingTime: "2026-10-02T05:00:00Z", price: 20000, referer: "Airbnb", status: "confirmed" } }),
        // 어제 취소(도쿄) — UTC 로는 10/04
        reservation({ status: "cancelled", raw: { cancelTime: "2026-10-04T20:00:00Z", price: 0, referer: "Airbnb", status: "cancelled" } }),
        // 그제 취소 → 제외
        reservation({ status: "cancelled", raw: { cancelTime: "2026-10-03T20:00:00Z", referer: "Airbnb", status: "cancelled" } }),
      ],
    });

  it("신규 · 취소 · 매출 · 당월 누적을 저쪽 규칙대로 센다", () => {
    const result = stats();
    expect(dailySnapshotOf(result)).toEqual({ mtdNew: 3, revenue: 80000, totalCancel: 1, totalNew: 2 });
    expect(result.newByChannel).toEqual({ airbnb: 1, booking: 1 });
    expect(result.cancelByChannel).toEqual({ airbnb: 1, booking: 0 });
    // 건물 줄은 0건이어도 전부 나온다(저쪽처럼).
    expect(result.buildings.map((item) => item.propertyName)).toEqual([...CALENDAR_BUILDING_ORDER]);
  });

  // 2026-10-07 — 당월 누적만 바뀐 것으로는 재전송하지 않는다(이번 달 예약이 오늘 취소될 때마다 바뀌어 매일 나갔다).
  it("변동 재전송 기준 = 어제 신규 · 취소 · 매출, 당월 누적은 보지 않는다", () => {
    const base = { mtdNew: 100, revenue: 5000, totalCancel: 3, totalNew: 10 };
    expect(sameSnapshot(base, { ...base, mtdNew: 99 })).toBe(true);
    expect(sameSnapshot(base, { ...base, totalNew: 9 })).toBe(false);
    expect(sameSnapshot(base, { ...base, revenue: 4000 })).toBe(false);
  });

  // 2026-10-07 — 폰 Slack 가독성: 요약은 건수 / 매출 두 줄, 건물은 「이름 + 매출」 아래 예약 · 취소 줄, 0건 건물은 한 줄로.
  it("메시지 — 짧은 줄로 나눈다(ko · ja · en)", () => {
    const ko = buildDailyReportMessage({ copy: dictionaries.ko.automationMessages, locale: "ko", propertyLabel: (n) => n, stats: stats() });
    expect(ko.split("\n")[0]).toBe("📊 *일일 운영 리포트 · 10/5(월)*");
    expect(ko).toContain("신규 *2건* · 취소 *1건*\n매출 *¥80,000*");
    expect(ko).toContain("*가부키초*  *¥30,000*\n　예약 1건 · 11월 1건\n");
    expect(ko).not.toContain("가부키초*  *¥30,000*\n　예약 1건 · 11월 1건\n　취소");
    expect(ko).toContain("예약 · 취소 없음: 아라키초B, STAY ARI Apartment Hotel");
    const ja = buildDailyReportMessage({ copy: dictionaries.ja.automationMessages, locale: "ja", propertyLabel: (n) => n, stats: stats() });
    expect(ja).toContain("新規 *2件* · キャンセル *1件*\n売上 *¥80,000*");
    expect(ja).toContain("新規・チェックイン月: 10月 1件、11月 1件"); // 일본어 목록은 「、」
    const en = buildDailyReportMessage({ copy: dictionaries.en.automationMessages, locale: "en", propertyLabel: (n) => n, stats: stats() });
    expect(en.split("\n")[0]).toBe("📊 *Daily operations report · Mon 10/5*");
    expect(en).toContain("By check-in month: Oct 2, Nov 1");
    // 폰에서 한 줄이 너무 길지 않게 — 건물 줄은 이름 · 매출만(0건 건물 목록은 이름 나열이라 줄바꿈돼도 된다).
    const quietLabels = [ko, ja, en].map((_, i) => [dictionaries.ko, dictionaries.ja, dictionaries.en][i].automationMessages.daily.buildingsQuiet.split(":")[0]);
    [ko, ja, en].forEach((text, i) => {
      const lines = text.split("\n").filter((line) => !line.startsWith(quietLabels[i]));
      expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(60);
    });
  });

  it("변동 재전송 — 직전 숫자와 다르면 변동 줄과 상세가 붙는다", () => {
    const text = buildDailyReportMessage({
      copy: dictionaries.ko.automationMessages,
      locale: "ko",
      previous: { mtdNew: 2, revenue: 50000, totalCancel: 1, totalNew: 1 },
      propertyLabel: (n) => n,
      stats: stats(),
    });
    expect(text).toContain("전번 대비 변동: 예약 +1 | 매출 *+¥30,000* | 당월누적 +1");
    expect(text).toContain("■ 변동 상세");
  });
});

describe("청소 · 셋팅 명단", () => {
  const model: CleaningListModel = {
    cleaning: [
      { code: "AA201", guestName: "Tanaka", kind: "turnover", pax: 2, propertyName: "아라키초A", roomKey: "아라키초A_201" },
      { code: "AA302", guestName: null, kind: "no_checkin", pax: 3, propertyName: "아라키초A", roomKey: "아라키초A_302" },
    ],
    setting: [{ code: "K802", guestName: "Garcia", kind: "setting", pax: 2, propertyName: "가부키초", roomKey: "가부키초_802" }],
    targetDate: "2026-10-06",
  };

  it("넣은 이름만 붙고, 없으면 아무것도 안 붙는다", () => {
    const text = buildCleaningListMessage({
      buildingOrder: CALENDAR_BUILDING_ORDER,
      copy: dictionaries.ko.automationMessages,
      model,
      names: new Map([["아라키초A_201", "김민지"]]),
      propertyLabel: (n) => n,
    });
    expect(text).toContain("*AA201* | Tanaka (2) | 김민지");
    expect(text).toContain("*AA302* | 체크인 X (3)\n");
    expect(text).not.toContain("미배정");
    expect(text).toContain("*셋팅해야 하는 객실*");
    // 건물 이름은 굵게(2026-10-08).
    expect(text).toContain("\n*아라키초A*\n*AA201* | Tanaka (2) | 김민지");
    expect(text).toContain("\n*가부키초*\n*K802* | Garcia (2)");
  });

  // 2026-10-07 — 「청소 방 직접 추가」 · 데이터 경고 · 정정본은 현장 일이 바뀔 때만.
  it("직접 더한 방은 청소 칸에 메모(없으면 「추가 청소」)로, 정보가 빠진 예약은 끝에 경고로", () => {
    const text = buildCleaningListMessage({
      buildingOrder: AUTOMATION_BUILDING_ORDER,
      copy: dictionaries.ko.automationMessages,
      model: {
        ...model,
        cleaning: [
          ...model.cleaning,
          { code: "203", guestName: null, kind: "extra", note: "연박 청소", pax: null, propertyName: "STAY ARI Apartment Hotel", roomKey: "STAY ARI Apartment Hotel_203" },
          { code: "205", guestName: null, kind: "extra", note: null, pax: null, propertyName: "STAY ARI Apartment Hotel", roomKey: "STAY ARI Apartment Hotel_205" },
        ],
        dataIssues: [{ bookingId: "94292271", code: "AA302" }],
      },
      names: new Map([["STAY ARI Apartment Hotel_203", "김민지"]]),
      propertyLabel: (n) => n,
    });
    expect(text).toContain("*203* | 연박 청소 | 김민지");
    expect(text).toContain("*205* | 추가 청소");
    expect(text.trim().split("\n").pop()).toBe("⚠️ 확인 필요: 정보가 빠진 예약 1건 — AA302(94292271)");
    expect(text.indexOf("*203*")).toBeLessThan(text.indexOf("셋팅해야 하는 객실"));
  });

  it("정정본 지문 — 게스트 이름만 바뀌면 같고, 인원 · 추가 방이 바뀌면 다르다", () => {
    const renamed = { ...model, cleaning: model.cleaning.map((room) => ({ ...room, guestName: room.guestName ? `${room.guestName}!` : null })) };
    expect(cleaningStructureKey(renamed)).toBe(cleaningStructureKey(model));
    const paxChanged = { ...model, setting: model.setting.map((room) => ({ ...room, pax: 5 })) };
    expect(cleaningStructureKey(paxChanged)).not.toBe(cleaningStructureKey(model));
    const withExtra = {
      ...model,
      cleaning: [...model.cleaning, { code: "203", guestName: null, kind: "extra" as const, note: null, pax: null, propertyName: "STAY ARI Apartment Hotel", roomKey: "x_203" }],
    };
    expect(cleaningStructureKey(withExtra)).not.toBe(cleaningStructureKey(model));
  });

  it("청소 명단 정정본 하루 상한 기본값은 8(묶어 보내므로 폭주 방지용)", () => {
    expect(defaultJobConfig("cleaning_list").settings.resend.maxPerDay).toBe(8);
    expect(defaultJobConfig("daily_report").settings.resend.maxPerDay).toBe(3);
  });

  it("정정본 판단 지문은 이름을 보지 않는다", () => {
    expect(cleaningStructureKey(model)).toBe(cleaningStructureKey({ ...model }));
    const changed = { ...model, setting: [] };
    expect(cleaningStructureKey(changed)).not.toBe(cleaningStructureKey(model));
  });
});

describe("취소 · 당일예약 알림", () => {
  it("당일예약 = 확정 · 예약일 = 입실일 = 오늘 · 금액 > 0", () => {
    const today = "2026-10-06";
    expect(isSameDayBooking(reservation({ checkIn: today, raw: { bookingTime: "2026-10-06T01:00:00Z", price: 1000, status: "new" } }), today)).toBe(true);
    expect(isSameDayBooking(reservation({ checkIn: today, raw: { bookingTime: "2026-10-05T01:00:00Z", price: 1000, status: "new" } }), today)).toBe(false);
    expect(isSameDayBooking(reservation({ checkIn: today, raw: { bookingTime: "2026-10-06T01:00:00Z", price: 0, status: "new" } }), today)).toBe(false);
  });

  // 2026-10-07 — 일괄 저장으로 켜기(10:17) 전 당일예약이 늦게 나갔다. 켠 뒤에 들어온 예약만.
  it("당일예약은 켠 시각 이후에 들어온 예약만(예약 시각을 모르면 보내지 않음)", () => {
    const today = "2026-10-07";
    const enabledAt = "2026-10-07T01:17:51Z"; // 10:17 도쿄
    const before = reservation({ checkIn: today, raw: { bookingTime: "2026-10-06T23:31:49Z", price: 46931, status: "new" } }); // 08:31
    const after = reservation({ checkIn: today, raw: { bookingTime: "2026-10-07T02:00:00Z", price: 46931, status: "new" } }); // 11:00
    expect(isSameDayBooking(before, today)).toBe(true);
    expect(isSameDayBookingSince(before, today, enabledAt)).toBe(false);
    expect(isSameDayBookingSince(after, today, enabledAt)).toBe(true);
    expect(isSameDayBookingSince(after, today, null)).toBe(true);
  });

  it("켜기 전(또는 하루 넘게 지난) 취소는 보내지 않는다", () => {
    const row = reservation({ status: "cancelled", raw: { cancelTime: "2026-10-06T00:00:00Z" } });
    expect(isFreshCancellation(row, "2026-10-05T12:00:00Z")).toBe(true);
    expect(isFreshCancellation(row, "2026-10-06T01:00:00Z")).toBe(false);
  });

  // 2026-10-07 — 취소 · 당일예약 = Slack 카드(제목 · 2열 칸 · 회색 줄 · 링크 줄). 잠금화면 알림은 한 줄(notify).
  it("취소 카드 — 제목 · 칸 4개 · 회색 줄 · 링크, 알림 한 줄에 방 · 날짜 · 금액", () => {
    const card = buildReservationAlertCard({
      copy: dictionaries.ko.automationMessages,
      kind: "cancel",
      openUrl: "https://example.test/go/reservation/1",
      propertyLabel: "아라키초A",
      reservation: reservation({ status: "cancelled", raw: { bookId: "777", cancelTime: "2026-10-06T00:41:00Z", numAdult: 2, numChild: 1, price: 86400, referer: "Airbnb" } }),
      roomLabel: "AA302",
      today: "2026-10-06",
    });
    // 제목은 건물만, 객실은 아래 줄(2026-10-08).
    expect(card.header).toBe("❌ 취소 · 아라키초A");
    expect(card.rows).toEqual([
      [{ label: "객실", value: "AA302" }, { label: "채널", value: "Airbnb" }],
      [{ label: "숙박", value: "10/20(화) → 22(목) · 2박" }],
      [{ label: "취소 금액", value: "¥86,400" }, { label: "인원", value: "3명(아동 1)" }],
    ]);
    expect(card.context).toBe("Kim · 예약 777 · 취소 10/6(화) 09:41");
    expect(card.notify).toBe("❌ 취소 · 아라키초A AA302 · 10/20~22 · ¥86,400");
    const blocks = alertCardBlocks(card);
    expect(blocks.map((block) => block.type)).toEqual(["header", "section", "context", "section"]);
    // 항목마다 한 줄, 묶음 사이 빈 줄(2026-10-08).
    expect(JSON.stringify(blocks[1])).toContain("*객실* AA302\\n*채널* Airbnb\\n\\n*숙박* 10/20(화) → 22(목) · 2박\\n\\n*취소 금액* ¥86,400\\n*인원* 3명(아동 1)");
    expect(JSON.stringify(blocks)).not.toContain('"fields"');
    // 버튼이 아니라 링크 줄(우리 Slack 앱은 Interactivity 주소가 없다).
    expect(JSON.stringify(blocks[3])).toContain("<https://example.test/go/reservation/1|Foldy 에서 열기 ›>");
    expect(JSON.stringify(blocks)).not.toContain('"button"');
  });

  it("당일예약 카드(ja) · 달이 바뀌면 끝날에 월 · 올해 아니면 연도 · 이름의 < > & 는 이스케이프 · 금액 모르면 확인 불가", () => {
    const sameDay = buildReservationAlertCard({
      copy: dictionaries.ja.automationMessages,
      kind: "same_day",
      openUrl: null,
      propertyLabel: "STAY ARI Apartment Hotel",
      reservation: reservation({ checkIn: "2026-09-30", checkOut: "2026-10-02", guestName: "A&B <VIP>", raw: { id: "93804456", numAdult: 4, price: 23413, referer: "Booking.com" } }),
      roomLabel: "305",
      today: "2026-09-30",
    });
    expect(sameDay.header).toBe("🟢 当日予約 · STAY ARI Apartment Hotel");
    expect(sameDay.rows[0]).toEqual([{ label: "客室", value: "305" }, { label: "チャネル", value: "Booking" }]);
    expect(sameDay.rows[1]).toEqual([{ label: "宿泊", value: "本日 9/30(水) → 10/2(金) · 2泊" }]);
    expect(sameDay.rows[2]).toEqual([{ label: "金額", value: "¥23,413" }, { label: "人数", value: "4名" }]);
    expect(sameDay.notify).toBe("🟢 当日予約 · STAY ARI Apartment Hotel 305 · 9/30~10/2 · ¥23,413");
    // 일본어도 폰 한 줄(약 21자)에 — 항목 한 줄이 짧다.
    for (const row of sameDay.rows) for (const cell of row) expect(`${cell.label} ${cell.value}`.length).toBeLessThanOrEqual(30); // 숫자 · 기호는 반각이라 화면 폭은 더 좁다
    expect(sameDay.link).toBeNull();
    const blocks = alertCardBlocks(sameDay);
    expect(blocks).toHaveLength(3);
    expect(JSON.stringify(blocks[2])).toContain("A&amp;B &lt;VIP&gt;");
    const cancelled = buildReservationAlertCard({
      copy: dictionaries.ko.automationMessages,
      kind: "cancel",
      openUrl: null,
      propertyLabel: "STAY ARI Apartment Hotel",
      reservation: reservation({ checkIn: "2027-02-04", checkOut: "2027-02-08", status: "cancelled", raw: { cancelTime: "2026-09-28T22:44:00Z", id: "93557561", price: 0, referer: "Booking.com" } }),
      roomLabel: "206",
      today: "2026-09-29",
    });
    expect(cancelled.rows[1][0].value).toBe("2027/2/4(목) → 8(월) · 4박");
    expect(cancelled.rows[2]).toEqual([{ label: "취소 금액", value: "확인 불가" }]);
    expect(cancelled.rows[0][1].value).toBe("Booking");
    // 오쿠보처럼 방 코드가 없으면 객실 칸을 뺀다.
    const okubo = buildReservationAlertCard({
      copy: dictionaries.ko.automationMessages,
      kind: "same_day",
      openUrl: null,
      propertyLabel: "오쿠보A",
      reservation: reservation({ raw: { id: "1", price: 1000, referer: "Airbnb" } }),
      roomLabel: "",
      today: "2026-10-20",
    });
    expect(okubo.rows[0]).toEqual([{ label: "채널", value: "Airbnb" }]);
    expect(okubo.notify.startsWith("🟢 당일 예약 · 오쿠보A · ")).toBe(true);
    expect(alertPlatformLabel("Airbnb")).toBe("Airbnb");
    expect(alertPlatformLabel("booking.com")).toBe("Booking");
  });
});

// 2026-10-07 — Beds24 는 취소되면 price 를 0 으로 비운다. 요금 내역(rateDescription)에서 원래 금액을 되살린다.
describe("취소된 예약의 원래 금액", () => {
  const booking = "2026-11-05 (55601056 Standard Rate) JPY 114996\n2026-11-06 (55601056 Standard Rate) JPY 130536\nTotal Commission: 49106\nPayment Charge: 5647\n";
  const airbnb = "Cancel policy moderate\nBase Price 370500 JPY\nCleaning fee 9500.00 JPY\nHost Fee -58900.00 JPY\nExpected Payout Amount 321100.00 JPY\n";

  it("Booking.com = 날짜 줄 합, Airbnb = Base Price + Cleaning fee, 남은 금액이 있으면 그대로, 없으면 null", () => {
    expect(originalAmountOf({ rateDescription: booking }, 0)).toBe(245532);
    expect(originalAmountOf({ rateDescription: airbnb }, 0)).toBe(380000);
    expect(originalAmountOf({ rateDescription: airbnb }, 12000)).toBe(12000);
    expect(originalAmountOf({}, 0)).toBeNull();
    // DB 가 기억한 금액이 요금 내역보다 먼저(Airbnb 가 내역까지 0 으로 바꿔 와도 남는다).
    expect(originalAmountOf({ rateDescription: "Base Price 0 JPY\nHost Fee -0.00 JPY\n" }, 0, 158270)).toBe(158270);
    expect(originalAmountOf({ rateDescription: "Base Price 0 JPY\nHost Fee -0.00 JPY\n" }, 0)).toBeNull();
  });

  it("취소 알림 · 일일 리포트에 원래 금액이 나온다", () => {
    const cancelled = reservation({
      propertyName: "아라키초B",
      status: "cancelled",
      raw: { cancelTime: "2026-10-05T04:09:52Z", id: "94244398", price: 0, rateDescription: booking, referer: "Booking.com", status: "cancelled" },
    });
    const card = buildReservationAlertCard({
      copy: dictionaries.ko.automationMessages,
      kind: "cancel",
      openUrl: null,
      propertyLabel: "아라키초B",
      reservation: cancelled,
      roomLabel: "201",
      today: "2026-10-05",
    });
    expect(card.rows[2][0]).toEqual({ label: "취소 금액", value: "¥245,532" });
    expect(card.notify).toContain("¥245,532");
    const stats = computeDailyStats({
      buildingOrder: AUTOMATION_BUILDING_ORDER,
      canonicalProperty: getCanonicalPropertyName,
      channels: ["airbnb", "booking"],
      excludedProperties: [],
      reportDate: "2026-10-05",
      reservations: [cancelled, reservation({ status: "cancelled", raw: { cancelTime: "2026-10-05T05:00:00Z", price: 0, referer: "Airbnb", status: "cancelled" } })],
    });
    expect(stats.cancelRevenue).toBe(245532);
    expect(stats.cancelUnknown).toBe(1);
    const daily = buildDailyReportMessage({ copy: dictionaries.ko.automationMessages, locale: "ko", propertyLabel: (n) => n, stats });
    expect(daily).toContain("매출 *¥0*\n취소 금액 *¥245,532* (금액 확인 불가 1건)");
    expect(daily).toContain("　취소 1건 · 10월 1건 · *¥245,532*");
  });
});

describe("메시지 표시 형식 — 저쪽 이름 · 순서 (2026-10-07)", () => {
  const plain = (name: string) => `plain:${name}`;

  it("청소 명단 제목은 동 표시 없이 「오쿠보A」, 일일 리포트는 「오쿠보A동」 · 「사노시」, 나머지는 건물 정보 이름", () => {
    const ko = dictionaries.ko.automationMessages;
    expect(automationBuildingLabel(ko, "cleaning", "오쿠보A", plain)).toBe("오쿠보A");
    expect(automationBuildingLabel(ko, "cleaning", "오쿠보B", plain)).toBe("오쿠보B");
    expect(automationBuildingLabel(ko, "cleaning", "오쿠보C", plain)).toBe("오쿠보C");
    expect(automationBuildingLabel(ko, "daily", "오쿠보A", plain)).toBe("오쿠보A동");
    expect(automationBuildingLabel(ko, "daily", "사노", plain)).toBe("사노시");
    expect(automationBuildingLabel(ko, "cleaning", "사노", plain)).toBe("plain:사노");
    expect(automationBuildingLabel(ko, "daily", "아라키초A", plain)).toBe("plain:아라키초A");
    expect(automationBuildingLabel(dictionaries.ja.automationMessages, "cleaning", "오쿠보A", plain)).toBe("大久保A");
  });

  it("건물 순서 = 저쪽 청소 명단 순서(다카다노바바 → 오쿠보 → 스테이아리), 사노 맨 끝", () => {
    expect([...AUTOMATION_BUILDING_ORDER]).toEqual([
      "아라키초A", "아라키초B", "가부키초", "다카다노바바", "오쿠보A", "오쿠보B", "오쿠보C", "STAY ARI Apartment Hotel", "사노",
    ]);
  });

  it("스테이아리 방은 숫자만(O · sky 접두어 없음), 다른 건물은 저쪽 코드", () => {
    expect(cleaningRoomCode("STAY ARI Apartment Hotel", "O107")).toBe("107");
    expect(cleaningRoomCode("아라키초A", "702")).toBe("AA702");
    expect(cleaningRoomCode("다카다노바바", "6F")).toBe("T6");
    expect(cleaningRoomCode("오쿠보A", "오쿠보A")).toBeNull();
  });

  it("정정본 머리말에 ↻ 아이콘", () => {
    const text = buildCleaningListMessage({
      buildingOrder: AUTOMATION_BUILDING_ORDER,
      copy: dictionaries.ko.automationMessages,
      correction: true,
      model: { cleaning: [], setting: [], targetDate: "2026-10-07" },
      names: new Map(),
      propertyLabel: (n) => n,
    });
    expect(text.split("\n")[0]).toBe(":arrows_counterclockwise: *청소/셋팅 명단 정정본*");
  });
});

describe("설정 · 다국어", () => {
  it("모르는 설정 값은 기본값으로", () => {
    expect(parseSettings({ channels: ["x"], resend: { maxPerDay: 99, until: "25:00" } })).toEqual({
      channels: ["airbnb", "booking"],
      excludedProperties: [],
      resend: { debounceMinutes: 10, enabled: true, maxPerDay: 20, until: "18:00" },
    });
  });

  it("자동화 문구는 ko · ja · en 모두 같은 키를 가진다(빠지면 영어로 새지 않게)", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix];
    const en = keys({ a: dictionaries.en.automation, m: dictionaries.en.automationMessages }).sort();
    for (const locale of ["ko", "ja"] as const) {
      const local = keys({ a: dictionaries[locale].automation, m: dictionaries[locale].automationMessages }).sort();
      expect(local).toEqual(en);
      // 번역이 영어 그대로 남지 않았는지(대표 키).
      expect(dictionaries[locale].automation.title).not.toBe(dictionaries.en.automation.title);
      expect(dictionaries[locale].automationMessages.daily.title).not.toBe(dictionaries.en.automationMessages.daily.title);
    }
  });
});
