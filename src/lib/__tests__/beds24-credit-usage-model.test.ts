import { describe, expect, it } from "vitest";
import {
  beds24CreditRangeStart,
  beds24CreditWindowsInRange,
  buildBeds24CreditBars,
  buildBeds24CreditDetailView,
  buildBeds24CreditSnapshot,
  currentBeds24CreditWindow,
  groupBeds24CreditWindows,
  parseBeds24CreditWindowRows,
  summarizeBeds24CreditActors,
  summarizeBeds24CreditCurrent,
  summarizeBeds24CreditFeatures,
  summarizeBeds24CreditPauses,
  tokyoTodayStartMs,
  windowsSince,
  type Beds24CreditWindowRow,
} from "@/lib/beds24/credit-usage-model";

const MIN = 60_000;
// 2026-11-18 12:02 도쿄
const NOW = Date.parse("2026-11-18T03:02:00.000Z");

function row(partial: Partial<Beds24CreditWindowRow>): Beds24CreditWindowRow {
  return {
    credentialKey: "main",
    windowResetsAt: NOW + 3 * MIN,
    windowMinRemaining: 150,
    windowPausedAt: null,
    actorKind: "auto",
    actorUserId: null,
    actorName: null,
    actorJob: "rates_sync",
    feature: "rates_read",
    calls: 1,
    cost: 10,
    rateLimited: 0,
    firstAt: NOW - MIN,
    lastAt: NOW - MIN,
    ...partial,
  };
}

describe("창 계산", () => {
  it("한 창 = 한도 − 가장 낮은 남은 값, 밖 = 그 차이 − 우리 비용", () => {
    const windows = groupBeds24CreditWindows(
      [
        row({ cost: 20, windowMinRemaining: 120 }),
        row({ actorKind: "user", actorUserId: "u1", actorName: "김", actorJob: null, feature: "rates_write", cost: 30, windowMinRemaining: 120 }),
      ],
      "main",
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ ours: 50, outside: 30, used: 80, minRemaining: 120 });
  });

  it("밖은 0 아래로 내려가지 않고, 0 이면 「Foldy 밖」 줄이 없다", () => {
    const windows = groupBeds24CreditWindows([row({ cost: 60, windowMinRemaining: 150 })], "main");
    expect(windows[0].outside).toBe(0);
    const actors = summarizeBeds24CreditActors(windows);
    expect(actors.map((a) => a.key)).toEqual(["auto"]);
  });

  it("누가 — 사람별 · 자동 하나 · 밖, 많이 쓴 순, 상위 기능 2개", () => {
    const windows = groupBeds24CreditWindows(
      [
        row({ cost: 5, feature: "rooms_sync", windowMinRemaining: 100 }),
        row({ cost: 15, feature: "rates_read", windowMinRemaining: 100 }),
        row({ cost: 2, feature: "auth", actorJob: "reviews_sync", windowMinRemaining: 100 }),
        row({ actorKind: "user", actorUserId: "u1", actorName: "김", actorJob: null, feature: "block_write", cost: 40, windowMinRemaining: 100 }),
      ],
      "main",
    );
    const actors = summarizeBeds24CreditActors(windows);
    expect(actors).toEqual([
      { key: "user:u1", kind: "user", name: "김", topFeatures: ["block_write"], credits: 40 },
      { key: "outside", kind: "outside", name: "", topFeatures: [], credits: 38 },
      { key: "auto", kind: "auto", name: "", topFeatures: ["rates_read", "rooms_sync"], credits: 22 },
    ]);
    expect(summarizeBeds24CreditFeatures(windows)[0]).toEqual({ feature: "block_write", credits: 40 });
  });

  it("헤더 없는 줄만 있으면 우리 비용만(밖 0)", () => {
    const windows = groupBeds24CreditWindows([row({ windowResetsAt: null, windowMinRemaining: null, cost: 0 })], "main");
    expect(windows[0]).toMatchObject({ resetsAt: null, outside: 0, used: 0 });
  });

  it("토큰(키)마다 창을 따로 센다", () => {
    const rows = [row({ cost: 10 }), row({ credentialKey: "messages", cost: 7, windowMinRemaining: 190 })];
    expect(groupBeds24CreditWindows(rows, "main")[0].ours).toBe(10);
    expect(groupBeds24CreditWindows(rows, "messages")[0]).toMatchObject({ ours: 7, outside: 3 });
  });

  it("지금 창 = 아직 리셋 안 된 창", () => {
    const windows = groupBeds24CreditWindows(
      [row({ windowResetsAt: NOW - 2 * MIN, firstAt: NOW - 6 * MIN }), row({ windowResetsAt: NOW + 3 * MIN })],
      "main",
    );
    expect(currentBeds24CreditWindow(windows, NOW)?.resetsAt).toBe(NOW + 3 * MIN);
    expect(beds24CreditWindowsInRange(windows, "5m", NOW)).toHaveLength(1);
    expect(beds24CreditWindowsInRange(windows, "1h", NOW)).toHaveLength(2);
  });

  it("RPC 응답 파싱 — 문자열 시각 · 모르는 기능은 other", () => {
    const [parsed] = parseBeds24CreditWindowRows([
      {
        credential_key: "main",
        window_resets_at: "2026-11-18T03:05:00+00:00",
        window_min_remaining: 120,
        window_paused_at: null,
        actor_kind: "user",
        actor_user_id: "u1",
        actor_name: "김",
        actor_job: null,
        feature: "nope",
        calls: 2,
        cost: 4,
        rate_limited: 0,
        first_at: "2026-11-18T03:01:00+00:00",
        last_at: "2026-11-18T03:01:30+00:00",
      },
    ]);
    expect(parsed.windowResetsAt).toBe(Date.parse("2026-11-18T03:05:00Z"));
    expect(parsed.feature).toBe("other");
    expect(parsed.actorKind).toBe("user");
  });
});

describe("게이지 값", () => {
  const raw = { expiresAt: NOW + 2 * MIN, remaining: 40, resetsAt: NOW + 2 * MIN, limit: null, recordedAt: NOW - MIN };

  it("리셋 전이면 그 값 · 50 아래는 주의", () => {
    expect(buildBeds24CreditSnapshot(raw, null, NOW)).toMatchObject({ state: "warn", remaining: 40, limit: 200, resetsAt: NOW + 2 * MIN });
  });

  it("리셋이 지났으면 가득(한도)", () => {
    expect(buildBeds24CreditSnapshot(raw, null, NOW + 3 * MIN)).toMatchObject({ state: "ok", remaining: 200, resetsAt: null });
  });

  it("쿨다운이면 남은 값과 상관없이 쉬는 중", () => {
    expect(buildBeds24CreditSnapshot({ ...raw, remaining: 180 }, NOW + MIN, NOW)).toMatchObject({ state: "stop", pausedUntil: NOW + MIN });
  });

  it("기록이 없으면 모름", () => {
    expect(buildBeds24CreditSnapshot(null, null, NOW)).toMatchObject({ state: "unknown", remaining: null });
  });

  it("10 아래는 쉬는 중", () => {
    expect(buildBeds24CreditSnapshot({ ...raw, remaining: 9 }, null, NOW).state).toBe("stop");
  });
});

describe("막대 · 쉰 때", () => {
  it("시계에 맞춘 5분 칸 12개, 창은 시작한 칸에", () => {
    const windows = groupBeds24CreditWindows(
      [
        row({ windowResetsAt: NOW + 3 * MIN, cost: 30, windowMinRemaining: 150 }), // 리셋 12:05 → 시작 12:00 → 마지막 칸
        row({ windowResetsAt: NOW - 30 * MIN, firstAt: NOW - 34 * MIN, cost: 5, windowMinRemaining: 5, windowPausedAt: NOW - 31 * MIN }),
      ],
      "main",
    );
    const bars = buildBeds24CreditBars(windows, NOW);
    expect(bars).toHaveLength(12);
    expect(bars[11].startsAt).toBe(Date.parse("2026-11-18T03:00:00Z"));
    expect(bars[11]).toMatchObject({ used: 50, level: "ok" });
    expect(bars[4].level).toBe("stop");
    const stopped = bars.find((b) => b.level === "stop");
    expect(stopped?.used).toBe(195);
    const pauses = summarizeBeds24CreditPauses(windows);
    expect(pauses).toEqual({ count: 1, lastAt: NOW - 31 * MIN, lastSeconds: 60 });
  });
});

describe("막대 — 창 기준 칸 · 헤더 없는 429", () => {
  it("창이 :03 에 시작하면 칸도 :03 기준 — 지금 창이 마지막 칸(ago 0)", () => {
    // 지금 12:06, 지금 창 = 12:03 ~ 12:08, 앞 창 = 11:58 ~ 12:03(바로 이어짐), 그 앞 = 11:50 ~ 11:55
    const now = Date.parse("2026-11-18T03:06:00Z");
    const windows = groupBeds24CreditWindows(
      [
        row({ windowResetsAt: Date.parse("2026-11-18T03:08:00Z"), firstAt: Date.parse("2026-11-18T03:03:00Z"), cost: 40, windowMinRemaining: 160 }),
        row({ windowResetsAt: Date.parse("2026-11-18T03:03:00Z"), firstAt: Date.parse("2026-11-18T02:58:00Z"), cost: 70, windowMinRemaining: 130 }),
        row({ windowResetsAt: Date.parse("2026-11-18T02:55:00Z"), firstAt: Date.parse("2026-11-18T02:50:00Z"), cost: 9, windowMinRemaining: 191 }),
      ],
      "main",
    );
    const bars = buildBeds24CreditBars(windows, now);
    expect(bars).toHaveLength(12);
    expect(bars[11]).toMatchObject({ startsAt: Date.parse("2026-11-18T03:03:00Z"), used: 40 });
    expect(bars[10]).toMatchObject({ startsAt: Date.parse("2026-11-18T02:58:00Z"), used: 70 });
    expect(bars[8]).toMatchObject({ startsAt: Date.parse("2026-11-18T02:48:00Z"), used: 9 });
    expect(bars[9].used).toBe(0);
    expect(bars.every((b) => b.used <= 200)).toBe(true);
  });

  it("한 칸은 한도를 넘지 않는다(헤더 없는 줄이 창과 같은 칸에 들어도)", () => {
    const windows = groupBeds24CreditWindows(
      [
        row({ cost: 180, windowMinRemaining: 20 }),
        row({ windowResetsAt: null, windowMinRemaining: null, cost: 50, firstAt: NOW - MIN }),
      ],
      "main",
    );
    expect(buildBeds24CreditBars(windows, NOW)[11].used).toBe(200);
  });

  it("헤더 없는 429 도 쉰 때 — 칸은 stop, 쉰 때에 센다(길이는 모름)", () => {
    const windows = groupBeds24CreditWindows(
      [row({ windowResetsAt: null, windowMinRemaining: null, windowPausedAt: null, cost: 0, rateLimited: 1, firstAt: NOW - 20 * MIN })],
      "main",
    );
    expect(windows[0].pausedAt).toBe(NOW - 20 * MIN);
    const bars = buildBeds24CreditBars(windows, NOW);
    expect(bars.filter((b) => b.level === "stop")).toHaveLength(1);
    expect(summarizeBeds24CreditPauses(windows)).toEqual({ count: 1, lastAt: NOW - 20 * MIN, lastSeconds: null });
  });

  it("헤더 없는 줄의 windowPausedAt(조직 없는 줄 전체에서 공유)은 쓰지 않는다 — 429 가 아니면 쉰 때 아님", () => {
    const windows = groupBeds24CreditWindows(
      [row({ windowResetsAt: null, windowMinRemaining: null, windowPausedAt: NOW - 30 * MIN, rateLimited: 0, firstAt: NOW - 10 * MIN })],
      "main",
    );
    expect(windows[0].pausedAt).toBeNull();
  });
});

describe("요약 — 지금 창", () => {
  const snapshot = (remaining: number | null, resetsAt: number | null) =>
    ({ state: "ok", remaining, limit: 200, resetsAt, pausedUntil: null, recordedAt: NOW }) as const;

  it("이 조직 창이 없어도 계정 값이 유효하면 그 차이를 「Foldy 밖」으로", () => {
    expect(summarizeBeds24CreditCurrent([], snapshot(140, NOW + 2 * MIN), NOW)).toEqual({
      windowUsed: 60,
      actors: [{ key: "outside", kind: "outside", name: "", topFeatures: [], credits: 60 }],
    });
  });

  it("계정 값이 지났거나(가득) 모르면 0", () => {
    expect(summarizeBeds24CreditCurrent([], snapshot(200, null), NOW)).toEqual({ windowUsed: 0, actors: [] });
    expect(summarizeBeds24CreditCurrent([], snapshot(null, null), NOW)).toEqual({ windowUsed: 0, actors: [] });
  });

  it("이 조직 창이 있으면 그 창", () => {
    const windows = groupBeds24CreditWindows([row({ cost: 20, windowMinRemaining: 170 })], "main");
    expect(summarizeBeds24CreditCurrent(windows, snapshot(140, NOW + 2 * MIN), NOW)).toMatchObject({ windowUsed: 30 });
  });
});

describe("도쿄 날짜 경계", () => {
  it("7일 시작 · 창 범위 · 쉰 때 — UTC 15:00(도쿄 0시) 경계", () => {
    const now = Date.parse("2026-11-18T15:00:30Z"); // 도쿄 11/19 00:00:30
    const start = beds24CreditRangeStart("7d", now);
    expect(start).toBe(Date.parse("2026-11-13T00:00:00+09:00"));
    const before = row({ windowResetsAt: start, firstAt: start - 5 * MIN, cost: 5, windowMinRemaining: 5, windowPausedAt: start - 2 * MIN });
    const after = row({ windowResetsAt: start + 1000, firstAt: start - 4 * MIN, cost: 7, windowMinRemaining: 5, windowPausedAt: start - MIN });
    const windows = groupBeds24CreditWindows([before, after], "main");
    const inRange = windowsSince(windows, start);
    expect(inRange.map((w) => w.resetsAt)).toEqual([start + 1000]);
    expect(summarizeBeds24CreditPauses(inRange)).toEqual({ count: 1, lastAt: start - MIN, lastSeconds: 61 });
    expect(beds24CreditRangeStart("today", now)).toBe(Date.parse("2026-11-19T00:00:00+09:00"));
  });

  it("UTC 15시(도쿄 0시) 직후는 도쿄 새 날", () => {
    const justAfter = Date.parse("2026-11-18T15:01:00Z"); // 도쿄 11/19 00:01
    expect(tokyoTodayStartMs(justAfter)).toBe(Date.parse("2026-11-19T00:00:00+09:00"));
    const justBefore = Date.parse("2026-11-18T14:59:00Z"); // 도쿄 11/18 23:59
    expect(tokyoTodayStartMs(justBefore)).toBe(Date.parse("2026-11-18T00:00:00+09:00"));
  });

  it("7일 = 오늘 포함 7일(도쿄)", () => {
    expect(beds24CreditRangeStart("7d", NOW)).toBe(Date.parse("2026-11-12T00:00:00+09:00"));
    expect(beds24CreditRangeStart("today", NOW)).toBe(Date.parse("2026-11-18T00:00:00+09:00"));
    expect(beds24CreditRangeStart("1h", NOW)).toBe(NOW - 60 * MIN);
  });
});

describe("지금 창 — 요약과 상세가 같은 값", () => {
  const raw = (remaining: number, expiresAt: number) => ({
    expiresAt,
    remaining,
    resetsAt: expiresAt,
    limit: 200,
    recordedAt: NOW - MIN,
  });

  it("기록 없는 창 + 유효한 계정 값 → 요약 · 상세 지금 막대 · 5분 합계 · 누가 가 같다", () => {
    const snap = buildBeds24CreditSnapshot(raw(150, NOW + 2 * MIN), null, NOW);
    const summary = summarizeBeds24CreditCurrent([], snap, NOW);
    const detail = buildBeds24CreditDetailView([], snap, "5m", NOW);
    expect(summary.windowUsed).toBe(50);
    expect(detail.total).toBe(50);
    expect(detail.actors).toEqual(summary.actors);
    expect(detail.bars[detail.bars.length - 1]).toMatchObject({ startsAt: NOW + 2 * MIN - 5 * MIN, used: 50 });
  });

  it("1시간 범위 합계는 기록만 쓴다", () => {
    const snap = buildBeds24CreditSnapshot(raw(150, NOW + 2 * MIN), null, NOW);
    expect(buildBeds24CreditDetailView([], snap, "1h", NOW).total).toBe(0);
  });

  it("계정 값이 만료됐으면 둘 다 0", () => {
    const snap = buildBeds24CreditSnapshot(raw(150, NOW - MIN), null, NOW);
    const detail = buildBeds24CreditDetailView([], snap, "5m", NOW);
    expect(summarizeBeds24CreditCurrent([], snap, NOW)).toEqual({ windowUsed: 0, actors: [] });
    expect(detail.total).toBe(0);
    expect(detail.actors).toEqual([]);
    expect(detail.bars.every((bar) => bar.used === 0)).toBe(true);
  });

  it("지금 창 기록이 있으면 요약 · 상세 둘 다 그 창", () => {
    const windows = groupBeds24CreditWindows([row({ cost: 20, windowMinRemaining: 170 })], "main");
    const snap = buildBeds24CreditSnapshot(raw(140, NOW + 2 * MIN), null, NOW);
    expect(summarizeBeds24CreditCurrent(windows, snap, NOW).windowUsed).toBe(30);
    expect(buildBeds24CreditDetailView(windows, snap, "5m", NOW).total).toBe(30);
  });
});
