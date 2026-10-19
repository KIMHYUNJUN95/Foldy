import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVIEW_READ_PAGE_SIZE,
  defaultReviewRange,
  readAllReviewPages,
  type ReviewPageResult,
} from "@/lib/external-review-pages";

/**
 * 리뷰 화면이 기간 안의 리뷰를 **전부** 읽는지 (2026-10-19).
 *
 * PostgREST 는 한 응답을 1,000행에서 오류 없이 자른다. 예전 집계는 `.limit(5000)` 한 번이라
 * 365일(1,702건)이 1,000건만 셌고, PC 목록은 `.limit(500)` 이라 90일 511건 중 11건이 빠졌다.
 */
function fakeTable(total: number, { withCount = true } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `r${i}` }));
  const calls: Array<[number, number, boolean]> = [];
  const fetchPage = async (from: number, to: number, count: boolean): Promise<ReviewPageResult<{ id: string }>> => {
    calls.push([from, to, count]);
    // 서버처럼 한 응답은 1,000행을 넘지 않는다.
    const end = Math.min(to, from + REVIEW_READ_PAGE_SIZE - 1);
    return { data: rows.slice(from, end + 1), error: null, count: count && withCount ? total : null };
  };
  return { rows, calls, fetchPage };
}

describe("readAllReviewPages — 1,000행 상한 너머까지", () => {
  it("1,702건(365일 실측 규모)을 2쪽으로 전부 읽는다", async () => {
    const table = fakeTable(1702);
    const result = await readAllReviewPages(table.fetchPage);
    expect(result).toHaveLength(1702);
    expect(result.map((row) => row.id)).toEqual(table.rows.map((row) => row.id));
    expect(table.calls).toEqual([
      [0, 999, true],
      [1000, 1999, false],
    ]);
  });

  it("2,500건은 첫 쪽 뒤 나머지 2쪽을 동시에 읽는다", async () => {
    const table = fakeTable(2500);
    const result = await readAllReviewPages(table.fetchPage);
    expect(result).toHaveLength(2500);
    expect(table.calls.slice(1)).toEqual([
      [1000, 1999, false],
      [2000, 2999, false],
    ]);
  });

  it("1,000건 이하는 1회로 끝난다(511건 = 예전 limit 500 이 11건 자르던 경우)", async () => {
    const table = fakeTable(511);
    expect(await readAllReviewPages(table.fetchPage)).toHaveLength(511);
    expect(table.calls).toHaveLength(1);
  });

  it("딱 1,000건 · 0건도 정확하다", async () => {
    expect(await readAllReviewPages(fakeTable(1000).fetchPage)).toHaveLength(1000);
    expect(await readAllReviewPages(fakeTable(0).fetchPage)).toHaveLength(0);
  });

  it("건수를 못 받으면 짧은 쪽이 나올 때까지 차례로 읽는다", async () => {
    const table = fakeTable(2000, { withCount: false });
    expect(await readAllReviewPages(table.fetchPage)).toHaveLength(2000);
    expect(table.calls.map(([from]) => from)).toEqual([0, 1000, 2000]);
  });

  it("읽는 사이 쪽이 밀려 겹친 행은 한 번만 센다", async () => {
    const fetchPage = async (from: number): Promise<ReviewPageResult<{ id: string }>> =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` })), error: null, count: 1001 }
        : { data: [{ id: "r999" }, { id: "r1000" }], error: null };
    const result = await readAllReviewPages(fetchPage);
    expect(result).toHaveLength(1001);
  });

  it("어느 쪽이든 오류면 던진다 — 조용히 덜 세지 않는다", async () => {
    const boom = new Error("boom");
    const fetchPage = async (from: number): Promise<ReviewPageResult<{ id: string }>> =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` })), error: null, count: 1500 }
        : { data: null, error: boom };
    await expect(readAllReviewPages(fetchPage)).rejects.toBe(boom);
  });
});

describe("defaultReviewRange — 도쿄 날짜 기준 최근 90일", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("UTC 로는 전날인 도쿄 새벽에도 오늘(도쿄)을 끝으로 잡는다", () => {
    vi.useFakeTimers();
    // 도쿄 2026-10-19 01:00 = UTC 2026-10-18 16:00. 예전 `toISOString()` 은 10-18 을 썼다.
    vi.setSystemTime(new Date("2026-10-18T16:00:00Z"));
    expect(defaultReviewRange()).toEqual({ from: "2026-07-22", to: "2026-10-19" });
  });

  it("도쿄 23:59 까지는 같은 날이다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T14:59:00Z"));
    expect(defaultReviewRange().to).toBe("2026-10-19");
    vi.setSystemTime(new Date("2026-10-19T15:00:00Z"));
    expect(defaultReviewRange().to).toBe("2026-10-20");
  });

  it("오늘 포함 90일이고 달 · 해 경계를 넘는다", () => {
    expect(defaultReviewRange("2026-03-01")).toEqual({ from: "2025-12-02", to: "2026-03-01" });
  });
});
