// 외부 리뷰 — 순수 읽기 헬퍼(서버 import 없음, 테스트 가능).
//
// Contract: docs/product/25-complaint-workflow.md → 「기간 전부 읽기」

import { tokyoToday, ymdShift } from "@/lib/tokyo-date";

/**
 * PostgREST 응답 한 번의 행 상한. `.limit(5000)` 을 줘도 이 값에서 **오류 없이 잘린다** —
 * 365일 집계(1,702건)가 1,000건만 세던 원인이다(2026-10-19).
 */
export const REVIEW_READ_PAGE_SIZE = 1000;

export type ReviewPageResult<R> = {
  data: R[] | null;
  error: unknown;
  count?: number | null;
};

/**
 * 조건에 맞는 행을 **전부** 읽는다. 첫 쪽에서 전체 건수를 받고, 나머지 쪽은 동시에 읽는다
 * (1,000건 이하는 1회, 1,702건은 2회 — 직렬 단계는 늘 최대 2).
 *
 * `fetchPage` 는 매번 새 쿼리를 만들어야 하고, 쪽 경계가 흔들리지 않게 고정 정렬(예: `reviewed_at`
 * desc + `id` desc)을 걸어야 한다. 읽는 사이 새 행이 들어와 쪽이 한 칸 밀리면 같은 행이 두 쪽에
 * 나올 수 있어 id 로 한 번 거른다.
 */
export async function readAllReviewPages<R extends { id: string }>(
  fetchPage: (from: number, to: number, withCount: boolean) => PromiseLike<ReviewPageResult<R>>,
  pageSize: number = REVIEW_READ_PAGE_SIZE,
): Promise<R[]> {
  const first = await fetchPage(0, pageSize - 1, true);
  if (first.error) throw first.error;
  const rows = [...(first.data ?? [])];

  if (typeof first.count === "number") {
    const pages: Promise<ReviewPageResult<R>>[] = [];
    for (let start = pageSize; start < first.count; start += pageSize) {
      pages.push(Promise.resolve(fetchPage(start, start + pageSize - 1, false)));
    }
    for (const page of await Promise.all(pages)) {
      if (page.error) throw page.error;
      rows.push(...(page.data ?? []));
    }
  } else {
    // 건수를 못 받으면 짧은 쪽이 나올 때까지 차례로 읽는다.
    let last = first.data?.length ?? 0;
    for (let start = pageSize; last === pageSize; start += pageSize) {
      const page = await fetchPage(start, start + pageSize - 1, false);
      if (page.error) throw page.error;
      last = page.data?.length ?? 0;
      rows.push(...(page.data ?? []));
    }
  }

  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
}

/** 리뷰 화면 기본 기간 — 최근 90일(오늘 포함, **도쿄 날짜**). PC 콘솔 · 모바일 공용. */
export function defaultReviewRange(today: string = tokyoToday()): { from: string; to: string } {
  return { from: ymdShift(today, -89), to: today };
}

/** PC 콘솔 리뷰 목록이 한 번에 펼치는 건수 — 「더 보기」 한 번에 이만큼 늘어난다. */
export const REVIEW_LIST_STEP = 50;
