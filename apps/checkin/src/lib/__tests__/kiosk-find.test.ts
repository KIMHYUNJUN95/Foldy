import { describe, expect, it } from "vitest";

import {
  clampPartySize,
  heldByOther,
  KIOSK_LOCK_MS,
  kioskGate,
  kioskLanguageOf,
  kioskLockState,
  matchByName,
  matchByPassport,
  matchByPassportStays,
  passportSearchDates,
  pickByCode,
} from "../kiosk/find";

// 도쿄 2026-11-05 21:00
const now = new Date("2026-11-05T12:00:00Z");
const stay = (over: Partial<{ status: string; checkInDate: string; checkOutDate: string }> = {}) => ({
  status: "pending",
  checkInDate: "2026-11-05",
  checkOutDate: "2026-11-07",
  ...over,
});

describe("태블릿 예약 찾기 — 열 수 있는 기간", () => {
  it("도착일 당일 · 다음 날은 연다", () => {
    expect(kioskGate(stay(), now)).toEqual({ kind: "open" });
    expect(kioskGate(stay({ checkInDate: "2026-11-04" }), now)).toEqual({ kind: "open" });
  });

  it("도착일 전은 날짜와 함께 막는다 — 도쿄 0시 기준", () => {
    expect(kioskGate(stay({ checkInDate: "2026-11-06" }), now)).toEqual({ kind: "blocked", reason: "too_early", checkInDate: "2026-11-06" });
    // 도쿄 11/6 00:30 = UTC 11/5 15:30 — 열린다.
    expect(kioskGate(stay({ checkInDate: "2026-11-06" }), new Date("2026-11-05T15:30:00Z")).kind).toBe("open");
  });

  it("체크아웃 날 12시(도쿄)부터는 기간 지남", () => {
    const out = stay({ checkInDate: "2026-11-03", checkOutDate: "2026-11-05" });
    expect(kioskGate(out, new Date("2026-11-05T02:59:00Z")).kind).toBe("open");
    expect(kioskGate(out, new Date("2026-11-05T03:00:00Z"))).toEqual({ kind: "blocked", reason: "expired" });
  });

  it("취소 · 기간 지남 상태와 체크인 끝", () => {
    expect(kioskGate(stay({ status: "cancelled" }), now)).toEqual({ kind: "blocked", reason: "cancelled" });
    expect(kioskGate(stay({ status: "expired" }), now)).toEqual({ kind: "blocked", reason: "expired" });
    expect(kioskGate(stay({ status: "checked_in" }), now)).toEqual({ kind: "checked_in" });
  });
});

describe("태블릿 예약 찾기 — 맞추기", () => {
  it("이름은 한 예약에만 맞을 때만", () => {
    const candidates = [
      { stayId: "a", guestNames: ["Daniel Hu"] },
      { stayId: "b", guestNames: ["Mei Tanaka", "Mei Tanaka"] },
    ];
    expect(matchByName(candidates, "hu", "daniel")).toBe("a");
    expect(matchByName(candidates, "TANAKA", "MEI")).toBe("b");
    expect(matchByName(candidates, "HU", "DAN")).toBeNull();
    expect(matchByName([...candidates, { stayId: "c", guestNames: ["Daniel Hu"] }], "HU", "DANIEL")).toBeNull();
  });

  it("같은 코드가 여럿이면 진행 중 → 최근 것", () => {
    const rows = [
      { id: "old", status: "cancelled", checkInDate: "2026-11-09" },
      { id: "live", status: "pending", checkInDate: "2026-11-05" },
    ];
    expect(pickByCode(rows)?.id).toBe("live");
    expect(pickByCode([rows[0]])?.id).toBe("old");
    expect(pickByCode([])).toBeNull();
  });
});

describe("태블릿 예약 찾기 — 틀림 잠금", () => {
  const fail = (msAgo: number) => ({ succeeded: false, attempted_at: new Date(now.getTime() - msAgo).toISOString() });

  it("연달아 5번째 틀림에서 1분 잠금, 지나면 다시 5번", () => {
    const four = [fail(1000), fail(2000), fail(3000), fail(4000)];
    expect(kioskLockState(four, now)).toMatchObject({ failures: 4, remaining: 1, lockedUntil: null });
    const five = [fail(0), ...four];
    expect(kioskLockState(five, now).lockedUntil).toBe(new Date(now.getTime() + KIOSK_LOCK_MS).toISOString());
    const later = new Date(now.getTime() + KIOSK_LOCK_MS + 1);
    expect(kioskLockState(five, later)).toMatchObject({ lockedUntil: null, remaining: 5 });
  });

  it("성공이 끼면 앞의 실패는 세지 않는다", () => {
    const rows = [fail(0), { succeeded: true, attempted_at: new Date(now.getTime() - 500).toISOString() }, fail(1000), fail(2000), fail(3000), fail(4000)];
    expect(kioskLockState(rows, now)).toMatchObject({ failures: 1, lockedUntil: null });
  });
});

describe("태블릿 예약 찾기 — 그 밖", () => {
  it("예약 언어", () => {
    expect(kioskLanguageOf("ja")).toBe("ja");
    expect(kioskLanguageOf("EN")).toBe("en");
    expect(kioskLanguageOf("zh-cn")).toBe("zh-Hans");
    expect(kioskLanguageOf("ko")).toBe("ko");
    expect(kioskLanguageOf("fr")).toBeNull();
    expect(kioskLanguageOf(null)).toBeNull();
  });

  it("다른 기기가 잡은 세션", () => {
    const until = new Date(now.getTime() + 60_000).toISOString();
    const base = { finished_at: null, abandoned_at: null };
    expect(heldByOther([{ ...base, device_id: "b", locked_until: until }], "a", now)).toBe(true);
    expect(heldByOther([{ ...base, device_id: "a", locked_until: until }], "a", now)).toBe(false);
    expect(heldByOther([{ ...base, device_id: "b", locked_until: now.toISOString() }], "a", now)).toBe(false);
    expect(heldByOther([{ ...base, device_id: "b", locked_until: until, finished_at: until }], "a", now)).toBe(false);
  });

  it("인원 ±: 저장한 사람 수 아래 · 20 넘게는 안 된다", () => {
    expect(clampPartySize(3, 2)).toBe(3);
    expect(clampPartySize(1, 2)).toBeNull();
    expect(clampPartySize(0, 0)).toBeNull();
    expect(clampPartySize(21, 1)).toBeNull();
    expect(clampPartySize(2.5, 1)).toBeNull();
  });
});

describe("여권으로 예약 찾기", () => {
  const c = (stayId: string, ...guestNames: string[]) => ({ stayId, guestNames });
  it("가운데 이름이 있어도 찾는다", () => {
    expect(matchByPassport([c("a", "Daniel Hu")], "HU", "DANIEL JAMES")).toBe("a");
  });
  it("성 · 이름 순서가 뒤집혀도 찾는다", () => {
    expect(matchByPassport([c("a", "Hu Daniel")], "HU", "DANIEL JAMES")).toBe("a");
  });
  it("성이 다르면 찾지 않는다", () => {
    expect(matchByPassport([c("a", "Daniel Smith")], "HU", "DANIEL JAMES")).toBeNull();
  });
  it("같은 이름 예약이 둘이면 아무것도 열지 않는다", () => {
    expect(matchByPassport([c("a", "Daniel Hu"), c("b", "Daniel Hu")], "HU", "DANIEL")).toBeNull();
  });
  it("한 단어 예약 이름은 sameName 으로만 맞는다", () => {
    expect(matchByPassport([c("a", "Daniel")], "HU", "DANIEL")).toBeNull();
    expect(matchByPassport([c("a", "Madonna")], "MADONNA", "")).toBe("a");
  });
});

describe("여권 찾기 날짜", () => {
  it("오늘과 어제(도쿄)", () => {
    expect(passportSearchDates(new Date("2026-11-05T12:00:00Z"))).toEqual(["2026-11-05", "2026-11-04"]);
  });
  it("UTC 로는 아직 전날인 도쿄 새벽", () => {
    expect(passportSearchDates(new Date("2026-11-04T16:30:00Z"))).toEqual(["2026-11-05", "2026-11-04"]);
  });
  it("달 경계", () => {
    expect(passportSearchDates(new Date("2026-12-01T00:00:00Z"))).toEqual(["2026-12-01", "2026-11-30"]);
  });
});

describe("여권 찾기 — 예외", () => {
  const c = (stayId: string, ...guestNames: string[]) => ({ stayId, guestNames });
  it("MRZ 이름이 비어 있어도 여러 단어 예약은 sameName 으로 맞는다", () => {
    expect(matchByPassport([c("a", "Hu Daniel")], "HU DANIEL", "")).toBe("a");
    expect(matchByPassport([c("a", "Daniel Hu")], "HU", "")).toBeNull();
  });
  it("O'Brien 은 OBRIEN 과 맞는다", () => {
    expect(matchByPassport([c("a", "O'Brien")], "OBRIEN", "")).toBe("a");
    expect(matchByPassport([c("a", "Sean O'Brien")], "OBRIEN", "SEAN")).toBe("a");
  });
  it("예약 단어가 여권에 다 있어도 성이 안 맞으면 찾지 않는다", () => {
    expect(matchByPassport([c("a", "Daniel James")], "HU", "DANIEL JAMES")).toBeNull();
  });
});

describe("여권 찾기 — 상태로 좁히기", () => {
  const today = "2026-11-05";
  const names = (...ids: string[]) => ids.map((id) => ({ stayId: id, guestNames: ["Daniel Hu"] }));
  const st = (id: string, status: string, checkInDate = today) => ({ id, status, checkInDate });
  it("묵는 중인 동명이인과 오늘 도착 동명이인이 겹치면 열지 않는다", () => {
    expect(matchByPassportStays(names("y", "t"), [st("y", "checked_in", "2026-11-04"), st("t", "pending")], "HU", "DANIEL", today)).toBeNull();
  });
  it("둘 다 체크인 끝났어도 열지 않는다", () => {
    expect(matchByPassportStays(names("y", "t"), [st("y", "checked_in", "2026-11-04"), st("t", "checked_in")], "HU", "DANIEL", today)).toBeNull();
  });
  it("취소와 대기는 대기", () => {
    expect(matchByPassportStays(names("x", "t"), [st("x", "cancelled"), st("t", "pending")], "HU", "DANIEL", today)).toBe("t");
  });
  it("오늘 대기가 둘이면 열지 않는다", () => {
    expect(matchByPassportStays(names("a", "b"), [st("a", "pending"), st("b", "pending")], "HU", "DANIEL", today)).toBeNull();
  });
  it("여러 밤 묵는 체크인 끝난 손님(3일째)은 그 하나로 찾는다", () => {
    expect(matchByPassportStays(names("m"), [st("m", "checked_in", "2026-11-03")], "HU", "DANIEL", today)).toBe("m");
  });
  it("어제 대기와 오늘 대기는 오늘 것", () => {
    expect(matchByPassportStays(names("y", "t"), [st("y", "pending", "2026-11-04"), st("t", "pending")], "HU", "DANIEL", today)).toBe("t");
  });
});
