import { describe, expect, it } from "vitest";

import {
  buildGuestInserts,
  emptyGuestInfo,
  guestInfoFillCount,
  guestInfoLanguages,
  insertLanguageFor,
  pickLocalized,
  sanitizeGuestInfo,
  validateGuestInfoInput,
} from "@/lib/guest-messages/guest-info-model";
import { fillReplyVariables, formatGuestDate, savedReplyText, validateSavedReplyInput } from "@/lib/guest-messages/saved-reply-model";
import {
  channelStallState,
  creditBarModel,
  joinTargetMinutes,
  reconcileNowTooSoon,
  splitTargetMinutes,
  validateGuestMessageSettingsInput,
} from "@/lib/guest-messages/settings-model";
import { LOW_CREDIT_THRESHOLD } from "@/lib/beds24/calendar-client";
import { getDictionary } from "@/lib/i18n";
import { readBeds24Credits } from "@/lib/beds24/credits";

/** 손님 메시지 3 · 4단계 순수 규칙 — 설정 값 검사 · 멈춤 · 크레딧 막대 · 손님용 정보 · 정해 둔 문구. docs/product/47 §6 */

const FORMATS = { wifi: "Wi-Fi: {name} / {password}", wifiNameOnly: "Wi-Fi: {name}", wifiPasswordOnly: "PW: {password}" };

describe("설정 값 검사", () => {
  const valid = {
    responseTargetMinutes: { inquiry: 30, request: 60, staying: 15, other: 180 },
    nightPause: false,
    creditReserve: 20,
    stallHours: 3,
  };

  it("범위 안이면 통과", () => {
    expect(validateGuestMessageSettingsInput(valid)).toEqual({ ok: true, value: valid });
  });

  it("응답 목표 5분 미만 · 24시간 초과 · 소수는 그 칸을 짚어 거절", () => {
    expect(validateGuestMessageSettingsInput({ ...valid, responseTargetMinutes: { ...valid.responseTargetMinutes, request: 4 } })).toEqual({
      ok: false,
      error: "invalid_input",
      field: "request",
    });
    expect(
      validateGuestMessageSettingsInput({ ...valid, responseTargetMinutes: { ...valid.responseTargetMinutes, other: 24 * 60 + 1 } }),
    ).toMatchObject({ ok: false, field: "other" });
    expect(
      validateGuestMessageSettingsInput({ ...valid, responseTargetMinutes: { ...valid.responseTargetMinutes, inquiry: 30.5 } }),
    ).toMatchObject({ ok: false, field: "inquiry" });
  });

  it("크레딧 남겨 둘 선은 낮은 크레딧 선(10) 아래로 못 내린다 · 150 넘지 않게", () => {
    expect(validateGuestMessageSettingsInput({ ...valid, creditReserve: LOW_CREDIT_THRESHOLD - 1 })).toMatchObject({ field: "creditReserve" });
    expect(validateGuestMessageSettingsInput({ ...valid, creditReserve: 151 })).toMatchObject({ field: "creditReserve" });
    expect(validateGuestMessageSettingsInput({ ...valid, creditReserve: LOW_CREDIT_THRESHOLD })).toMatchObject({ ok: true });
  });

  it("멈춤 기준 1~72시간 · 밤 쉬기는 참거짓만", () => {
    expect(validateGuestMessageSettingsInput({ ...valid, stallHours: 0 })).toMatchObject({ field: "stallHours" });
    expect(validateGuestMessageSettingsInput({ ...valid, stallHours: 73 })).toMatchObject({ field: "stallHours" });
    expect(validateGuestMessageSettingsInput({ ...valid, nightPause: "yes" })).toMatchObject({ ok: false, field: null });
    expect(validateGuestMessageSettingsInput(null)).toMatchObject({ ok: false });
  });

  it("분 ↔ 화면 칸(60 의 배수면 시간)", () => {
    expect(splitTargetMinutes(30)).toEqual({ value: 30, unit: "min" });
    expect(splitTargetMinutes(120)).toEqual({ value: 2, unit: "hour" });
    expect(splitTargetMinutes(90)).toEqual({ value: 90, unit: "min" });
    expect(joinTargetMinutes("3", "hour")).toBe(180);
    expect(joinTargetMinutes(" 45 ", "min")).toBe(45);
    expect(joinTargetMinutes("1.5", "hour")).toBeNull();
    expect(joinTargetMinutes("", "min")).toBeNull();
  });
});

describe("받는 통로 멈춤", () => {
  it("한 번도 안 왔으면 멈춤(never)", () => {
    expect(channelStallState(null, 3, new Date())).toEqual({ stalled: true, never: true, hoursSince: null });
  });

  it("기준 시간을 넘으면 멈춤 — 도쿄 자정을 넘겨도 경과 시간으로만 판단", () => {
    // 도쿄 23:30(=14:30Z) 에 마지막 웹훅, 도쿄 다음 날 02:31(=17:31Z) 지금 → 3시간 1분.
    const last = "2026-11-12T14:30:00Z";
    expect(channelStallState(last, 3, new Date("2026-11-12T17:31:00Z"))).toMatchObject({ stalled: true, never: false });
    expect(channelStallState(last, 3, new Date("2026-11-12T17:29:00Z"))).toMatchObject({ stalled: false });
    expect(channelStallState(last, 3, new Date("2026-11-12T17:30:00Z")).stalled).toBe(true);
  });

  it("「지금 확인하기」는 1분에 한 번", () => {
    const now = new Date("2026-11-12T05:00:00Z");
    expect(reconcileNowTooSoon(null, now)).toBe(false);
    expect(reconcileNowTooSoon("2026-11-12T04:59:30Z", now)).toBe(true);
    expect(reconcileNowTooSoon("2026-11-12T04:58:59Z", now)).toBe(false);
    expect(reconcileNowTooSoon("garbage", now)).toBe(false);
  });
});

describe("크레딧 막대", () => {
  const now = Date.parse("2026-11-12T05:00:00Z");

  it("기록이 없거나 지났으면 모름", () => {
    expect(creditBarModel(null, 20, now)).toEqual({ known: false });
    expect(creditBarModel({ remaining: 150, resetsAt: now - 1, requestCost: 1 }, 20, now)).toEqual({ known: false });
    expect(creditBarModel({ remaining: null, resetsAt: now + 1000, requestCost: 1 }, 20, now)).toEqual({ known: false });
  });

  it("한도 200 기준 사용량 · 퍼센트 · 남은 초", () => {
    const bar = creditBarModel({ remaining: 150, resetsAt: now + 90_500, requestCost: 2 }, 20, now);
    expect(bar).toMatchObject({ known: true, limit: 200, remaining: 150, used: 50, usedPct: 25, reservePct: 10, resetsInSec: 91, belowReserve: false });
  });

  it("남은 양이 한도보다 크면 그 값을 한도로 · 선 아래면 belowReserve", () => {
    expect(creditBarModel({ remaining: 260, resetsAt: now + 1000, requestCost: null }, 20, now)).toMatchObject({ limit: 260, used: 0 });
    expect(creditBarModel({ remaining: 15, resetsAt: now + 1000, requestCost: null }, 20, now)).toMatchObject({ belowReserve: true });
  });

  it("한도는 헤더가 준 값을 쓰고, 없으면 200 추정(limitAssumed)", () => {
    expect(creditBarModel({ remaining: 50, resetsAt: now + 1000, requestCost: null }, 20, now)).toMatchObject({ limit: 200, limitAssumed: true });
    expect(creditBarModel({ remaining: 50, resetsAt: now + 1000, requestCost: null, limit: 100 }, 20, now)).toMatchObject({
      limit: 100,
      limitAssumed: false,
      used: 50,
      usedPct: 50,
    });
    expect(creditBarModel({ remaining: 50, resetsAt: now + 1000, requestCost: null, limit: 0 }, 20, now)).toMatchObject({ limitAssumed: true });
  });

  it("헤더에 한도가 있으면 읽고, 없으면 키가 없다", () => {
    expect(readBeds24Credits(new Headers({ "x-five-min-limit": "100", "x-five-min-limit-remaining": "40" }))).toMatchObject({ limit: 100, remaining: 40 });
    expect("limit" in readBeds24Credits(new Headers({ "x-five-min-limit-remaining": "40" }))).toBe(false);
  });

  it("선은 최소 낮은 크레딧 선", () => {
    expect(creditBarModel({ remaining: 100, resetsAt: now + 1000, requestCost: null }, 1, now)).toMatchObject({ reserve: LOW_CREDIT_THRESHOLD });
  });
});

describe("손님용 정보", () => {
  it("모르는 키 버리고 모양 맞추기", () => {
    const info = sanitizeGuestInfo({ wifiName: "  FoldyNet ", checkIn: { ko: "15시부터", fr: "x" }, hack: 1, trash: "string" });
    expect(info.wifiName).toBe("FoldyNet");
    expect(info.checkIn).toEqual({ ko: "15시부터", ja: "", en: "" });
    expect(info.trash).toEqual({ ko: "", ja: "", en: "" });
    expect("hack" in info).toBe(false);
  });

  it("길이를 넘으면 자르지 않고 거절", () => {
    expect(validateGuestInfoInput({ wifiPassword: "x".repeat(121) })).toEqual({ ok: false, error: "too_long" });
    expect(validateGuestInfoInput({ checkIn: { en: "x".repeat(501) } })).toEqual({ ok: false, error: "too_long" });
    expect(validateGuestInfoInput({ freeText: { en: "x".repeat(2000) } })).toMatchObject({ ok: true });
    expect(validateGuestInfoInput({ checkIn: "nope" })).toEqual({ ok: false, error: "invalid_input" });
    expect(validateGuestInfoInput([])).toEqual({ ok: false, error: "invalid_input" });
  });

  it("언어 고르기 — 그 언어 → 영어 → 없음", () => {
    expect(pickLocalized({ ko: "", ja: "15時", en: "3pm" }, "ja")).toEqual({ text: "15時", lang: "ja" });
    expect(pickLocalized({ ko: "", ja: "", en: "3pm" }, "ko")).toEqual({ text: "3pm", lang: "en" });
    expect(pickLocalized({ ko: "15시", ja: "", en: "" }, "ja")).toBeNull();
  });

  it("넣을 언어 — 번역해서 보낼 때는 직원 언어(두 번 번역 막기), 아니면 손님 언어, 모르면 영어", () => {
    expect(insertLanguageFor("ja", null, "ko")).toBe("ja");
    expect(insertLanguageFor("en-US", null, "ko")).toBe("en");
    expect(insertLanguageFor("zh", null, "ko")).toBe("en");
    expect(insertLanguageFor(null, null, "ja")).toBe("en");
    expect(insertLanguageFor("zh", "zh", "ko")).toBe("ko");
    expect(insertLanguageFor("fr", "fr", "xx")).toBe("en");
  });

  it("넣기 목록 — 와이파이는 언어와 상관없이, 빈 칸도 줄은 남는다", () => {
    const info = emptyGuestInfo();
    info.wifiName = "FoldyNet";
    info.wifiPassword = "pw1234";
    info.checkIn = { ko: "", ja: "", en: "From 3pm" };
    const items = buildGuestInserts(info, "ko", FORMATS);
    expect(items).toHaveLength(8);
    expect(items[0]).toEqual({ key: "wifi", text: "Wi-Fi: FoldyNet / pw1234", lang: "ko" });
    expect(items.find((item) => item.key === "checkIn")).toEqual({ key: "checkIn", text: "From 3pm", lang: "en" });
    expect(items.find((item) => item.key === "parking")).toEqual({ key: "parking", text: null, lang: null });

    info.wifiName = "";
    expect(buildGuestInserts(info, "ja", FORMATS)[0].text).toBe("PW: pw1234");
    info.wifiPassword = "";
    expect(buildGuestInserts(info, "ja", FORMATS)[0]).toEqual({ key: "wifi", text: null, lang: null });
  });

  it("채운 칸 수 · 언어", () => {
    const info = emptyGuestInfo();
    expect(guestInfoFillCount(info)).toMatchObject({ filled: 0, total: 8 });
    info.wifiPassword = "pw";
    info.trash = { ko: "", ja: "月曜", en: "" };
    expect(guestInfoFillCount(info)).toMatchObject({ filled: 2 });
    expect(guestInfoLanguages(info)).toEqual(["ja"]);
  });
});

describe("정해 둔 문구", () => {
  it("값 검사 — 제목 · 본문 하나 이상, 길이", () => {
    expect(validateSavedReplyInput({ title: " 체크인 안내 ", bodies: { ko: "안녕하세요" } })).toEqual({
      ok: true,
      value: { title: "체크인 안내", bodies: { ko: "안녕하세요", ja: "", en: "" } },
    });
    expect(validateSavedReplyInput({ title: "", bodies: { ko: "x" } })).toEqual({ ok: false, error: "empty" });
    expect(validateSavedReplyInput({ title: "t", bodies: { ko: " " } })).toEqual({ ok: false, error: "empty" });
    expect(validateSavedReplyInput({ title: "t".repeat(81), bodies: { ko: "x" } })).toEqual({ ok: false, error: "too_long" });
    expect(validateSavedReplyInput({ title: "t", bodies: { en: "x".repeat(2001) } })).toEqual({ ok: false, error: "too_long" });
    expect(validateSavedReplyInput({ title: "t", bodies: { en: 3 } })).toEqual({ ok: false, error: "invalid_input" });
  });

  it("날짜 모양 — 언어마다", () => {
    expect(formatGuestDate("2026-11-20", "ko")).toBe("11월 20일");
    expect(formatGuestDate("2026-11-20", "ja")).toBe("11月20日");
    expect(formatGuestDate("2026-01-05", "en")).toBe("Jan 5");
    expect(formatGuestDate("2026-13-01", "en")).toBeNull();
    expect(formatGuestDate(null, "en")).toBeNull();
  });

  const context = {
    guestName: "Emma",
    checkInDate: "2026-11-20",
    checkOutDate: "2026-11-23",
    nights: 3,
    building: { ko: "아라키초A", ja: "荒木町A", en: "Arakicho A" },
    room: { ko: "201", ja: "201", en: "201" },
  };

  it("변수 채우기 — 알고 있는 변수만, 값 없는 변수는 그대로 두고 알린다", () => {
    expect(fillReplyVariables("{guest_name}님, {checkin_date}~{checkout_date} {nights}박 {building} {room}", context, "ko")).toEqual({
      text: "Emma님, 11월 20일~11월 23일 3박 아라키초A 201",
      missing: [],
    });
    expect(fillReplyVariables("Hi {guest_name} {unknown} {room}", { ...context, guestName: " ", room: null }, "en")).toEqual({
      text: "Hi {guest_name} {unknown} {room}",
      missing: ["guest_name", "room"],
    });
  });

  it("방 변수도 언어마다 — 한 채 건물(방 라벨 = 건물 이름)이 한국어로 나가지 않게", () => {
    const single = { ...context, room: { ko: "아라키초A", ja: "荒木町A", en: "Arakicho A" } };
    expect(fillReplyVariables("{room}", single, "ja").text).toBe("荒木町A");
    expect(fillReplyVariables("{room}", single, "en").text).toBe("Arakicho A");
  });

  it("문구 → 손님 언어, 없으면 영어 본문을 영어 날짜로", () => {
    expect(savedReplyText({ ko: "", ja: "", en: "See you on {checkin_date}" }, "ja", context)).toEqual({
      text: "See you on Nov 20",
      lang: "en",
      missing: [],
    });
    expect(savedReplyText({ ko: "안녕", ja: "", en: "" }, "ja", context)).toBeNull();
  });
});

describe("사전 — 3 · 4단계 문구가 세 언어 모두에 있다", () => {
  it("guestMessages 키 모양이 ko · ja · en 같다(문자열만)", () => {
    const [ko, ja, en] = (["ko", "ja", "en"] as const).map((locale) => getDictionary(locale).guestMessages as Record<string, unknown>);
    const keys = Object.keys(en).sort();
    expect(Object.keys(ko).sort()).toEqual(keys);
    expect(Object.keys(ja).sort()).toEqual(keys);
    for (const key of ["guestInfoOpen", "tabSavedReplies", "tabSettings", "checkNow", "stallLine", "langAutonymJa"]) {
      expect(typeof en[key], key).toBe("string");
      expect(String(ko[key]).length, key).toBeGreaterThan(0);
      expect(String(ja[key]).length, key).toBeGreaterThan(0);
    }
    for (const value of [...Object.values(ko), ...Object.values(ja), ...Object.values(en)]) {
      expect(typeof value === "function").toBe(false);
    }
  });
});
