import { describe, expect, it } from "vitest";

import {
  claimBuildingKey,
  claimLock,
  claimNameKey,
  NAME_DAY_MAX_FAILURES,
  windowLock,
  type AttemptRow,
} from "../guest/limits";

const SECRET = "test-secret";
const now = new Date("2026-11-13T03:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const fails = (n: number, stepMs: number, startMs = 0): AttemptRow[] =>
  Array.from({ length: n }, (_, i) => ({ succeeded: false, attempted_at: ago(startMs + i * stepMs) }));

describe("예약 찾기 — IP 와 무관한 이름 키", () => {
  it("성 · 이름 순서 · 띄어쓰기 · 대소문자 · 악센트가 달라도 같은 키", () => {
    const base = claimNameKey("stay_ari", "2026-11-13", "Tanaka", "Yuki", SECRET);
    expect(claimNameKey("stay_ari", "2026-11-13", "YUKI", "TANAKA", SECRET)).toBe(base);
    expect(claimNameKey("stay_ari", "2026-11-13", "tana", "kayuki", SECRET)).toBe(base);
    expect(claimNameKey("stay_ari", "2026-11-13", "Tanaka-Yuki", "x", SECRET)).not.toBe(base);
    expect(claimNameKey("stay_ari", "2026-11-13", "Tánaka", "Yuki", SECRET)).toBe(base);
  });

  it("건물 · 날짜가 다르면 다른 키, 원문 이름은 키에 없다", () => {
    const base = claimNameKey("stay_ari", "2026-11-13", "Tanaka", "Yuki", SECRET);
    expect(claimNameKey("okubo_a", "2026-11-13", "Tanaka", "Yuki", SECRET)).not.toBe(base);
    expect(claimNameKey("stay_ari", "2026-11-14", "Tanaka", "Yuki", SECRET)).not.toBe(base);
    expect(base).not.toMatch(/TANAKA|YUKI/i);
    expect(claimBuildingKey("stay_ari", SECRET)).not.toBe(claimBuildingKey("okubo_a", SECRET));
  });
});

describe("windowLock — 창 안 실패 상한", () => {
  it("상한 아래면 열림, 상한이면 그 실패가 창을 벗어날 때까지 잠금", () => {
    expect(windowLock(fails(2, 60_000), now, { max: 3, windowMs: 3_600_000 }).lockedUntil).toBeNull();
    const locked = windowLock(fails(3, 60_000), now, { max: 3, windowMs: 3_600_000 });
    // 세 번째로 새 실패(2분 전) + 1시간
    expect(locked.lockedUntil).toBe(new Date(now.getTime() - 120_000 + 3_600_000).toISOString());
  });

  it("창 밖 실패는 세지 않고, 성공 앞의 실패는 지운 셈", () => {
    expect(windowLock(fails(3, 60_000, 3_600_001), now, { max: 3, windowMs: 3_600_000 }).lockedUntil).toBeNull();
    const rows = [...fails(2, 1000), { succeeded: true, attempted_at: ago(5000) }, ...fails(5, 1000, 6000)];
    expect(windowLock(rows, now, { max: 3, windowMs: 3_600_000 }).lockedUntil).toBeNull();
  });
});

describe("claimLock — 모든 잠금을 하나로", () => {
  const empty = { ip: [], name: [] };

  it("아무 기록 없으면 열림 · 5번 남음", () => {
    expect(claimLock(empty, now)).toMatchObject({ lockedUntil: null, remaining: 5, failures: 0 });
  });

  it("IP 를 바꿔도 같은 이름 · 날짜에 10분 안 5번 틀리면 잠금(기존 상한과 같음)", () => {
    const state = claimLock({ ...empty, name: fails(5, 30_000) }, now);
    expect(state.lockedUntil).toBe(new Date(now.getTime() + 10 * 60_000).toISOString());
  });

  it("4번까지는 정상 손님 실수로 허용", () => {
    const state = claimLock({ ...empty, name: fails(4, 30_000) }, now);
    expect(state).toMatchObject({ lockedUntil: null, remaining: 1, failures: 4 });
  });

  it("같은 이름 · 날짜는 하루 실패 상한(10분 잠금을 기다려 가며 돌려 넣기 막기)", () => {
    // 15분 간격 — 10분 잠금은 매번 풀리지만 하루 상한에 걸린다.
    const rows = fails(NAME_DAY_MAX_FAILURES, 15 * 60_000, 15 * 60_000);
    expect(claimLock({ ...empty, name: rows.slice(0, NAME_DAY_MAX_FAILURES - 1) }, now).lockedUntil).toBeNull();
    const state = claimLock({ ...empty, name: rows }, now);
    expect(state.lockedUntil).not.toBeNull();
    expect(Date.parse(state.lockedUntil!)).toBeGreaterThan(now.getTime() + 60 * 60_000);
  });

  it("잠금이 여럿이면 가장 늦게 풀리는 시각", () => {
    const ipOnly = claimLock({ ...empty, ip: fails(5, 1000) }, now).lockedUntil!;
    const both = claimLock({ ip: fails(5, 1000), name: fails(NAME_DAY_MAX_FAILURES, 1000) }, now).lockedUntil!;
    expect(Date.parse(both)).toBeGreaterThan(Date.parse(ipOnly));
  });
});
