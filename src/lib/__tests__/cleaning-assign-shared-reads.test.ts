import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createSharedRoomReads } = await import("@/lib/cleaning-assign/rooms");

/** 표마다 읽은 횟수를 세는 가짜 클라이언트. */
function fakeClient(rows: Record<string, unknown[]>) {
  const reads: Record<string, number> = {};
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "eq", "gte", "lte", "neq", "in", "order", "range"]) chain[name] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => {
        reads[table] = (reads[table] ?? 0) + 1;
        return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
      };
      return chain;
    },
  };
  return { client: client as never, reads };
}

describe("오늘 · 내일이 나눠 쓰는 기록 · 미룸 읽기", () => {
  const TODAY = "2026-11-10";
  const TOMORROW = "2026-11-11";

  it("여러 번 불러도 표마다 한 번만 읽고, 그 날 기준 범위로 잘라 준다", async () => {
    const { client, reads } = fakeClient({
      cleaning_room_holds: [{ origin_date: TODAY }, { origin_date: TOMORROW }, { origin_date: "2026-09-03" }],
      cleaning_sessions: [{ cleaning_date: TODAY }, { cleaning_date: TOMORROW }, { cleaning_date: "2026-09-03" }],
    });
    const shared = createSharedRoomReads(client, "org", TODAY, TOMORROW);
    const [todayHolds, tomorrowHolds, todaySessions, tomorrowSessions] = await Promise.all([
      shared.holds(TODAY, TODAY),
      shared.holds(TOMORROW, TOMORROW),
      shared.sessions(TODAY, TODAY),
      shared.sessions(TOMORROW, TOMORROW),
    ]);
    expect(reads).toEqual({ cleaning_room_holds: 1, cleaning_sessions: 1 });
    // 오늘 기준: 내일 줄은 빠지고 68일 전(9/3)은 들어간다. 내일 기준: 9/3 은 69일 전이라 빠진다.
    expect(todayHolds.map((row) => row.origin_date)).toEqual([TODAY, "2026-09-03"]);
    expect(tomorrowHolds.map((row) => row.origin_date)).toEqual([TODAY, TOMORROW]);
    expect(todaySessions.map((row) => row.cleaning_date)).toEqual([TODAY, "2026-09-03"]);
    expect(tomorrowSessions.map((row) => row.cleaning_date)).toEqual([TODAY, TOMORROW]);
  });
});
