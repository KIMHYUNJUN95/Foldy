import { describe, expect, it } from "vitest";

import {
  clampPartySize,
  heldByOther,
  KIOSK_LOCK_MS,
  kioskGate,
  kioskLanguageOf,
  kioskLockState,
  matchByName,
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
