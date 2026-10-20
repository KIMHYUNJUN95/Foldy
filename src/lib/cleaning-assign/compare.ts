import type { CompareRow } from "@/lib/cleaning-assign/data";

/**
 * 청소 월 비교표 계산 — 화면(`assign-compare.tsx`)과 Excel · PDF 내보내기가 같은 숫자를 쓰도록 한 곳에 둔다. 순수 모듈.
 * 방당 급여 = 그달 급여 ÷ 청소한 방(같이 한 방은 나눠 셈). 평균은 비교에 넣은 사람(제외 · 청소 0 빼고)의 합으로 낸다.
 * 견습(같이 한 방을 반만 세서 튐) · 직원(청소 말고 일이 많음)은 `exclude` 면 비교에서 뺀다.
 * docs/product/37-cleaning-shift-assignment.md 「4-4」
 */

export type CompareComputedRow = CompareRow & {
  perRoom: number | null;
  perMinutes: number | null;
  /** 평균 방당 급여에서 벗어난 %(반올림). 비교에서 빠졌거나 청소 0 이면 null. */
  dev: number | null;
  excluded: "trainee" | "staff" | null;
};

export function computeCompare(rows: CompareRow[], exclude: boolean): { avg: number; avgMinutes: number; rows: CompareComputedRow[] } {
  const base: CompareComputedRow[] = rows.map((row) => ({
    ...row,
    dev: null,
    excluded: exclude ? (row.trainee ? "trainee" : row.role !== "part_time_staff" ? "staff" : null) : null,
    perMinutes: row.cleaned > 0 ? Math.round(row.paidMinutes / row.cleaned) : null,
    perRoom: row.cleaned > 0 ? Math.round(row.pay / row.cleaned) : null,
  }));
  const counted = base.filter((row) => !row.excluded && row.cleaned > 0);
  const totalPay = counted.reduce((sum, row) => sum + row.pay, 0);
  const totalRooms = counted.reduce((sum, row) => sum + row.cleaned, 0);
  const totalMinutes = counted.reduce((sum, row) => sum + row.paidMinutes, 0);
  const avg = totalRooms > 0 ? totalPay / totalRooms : 0;
  for (const row of base) {
    if (!row.excluded && row.perRoom !== null && avg > 0) row.dev = Math.round((row.perRoom / avg - 1) * 100);
  }
  base.sort((a, b) => Number(Boolean(a.excluded)) - Number(Boolean(b.excluded)) || (b.perRoom ?? -1) - (a.perRoom ?? -1));
  return { avg, avgMinutes: totalRooms > 0 ? Math.round(totalMinutes / totalRooms) : 0, rows: base };
}

/** 기준(%)을 넘게 벗어난 사람 — 많이 벗어난 순. */
export function flaggedRows(rows: CompareComputedRow[], threshold: number): CompareComputedRow[] {
  return rows.filter((row) => row.dev !== null && Math.abs(row.dev) > threshold).sort((a, b) => Math.abs(b.dev!) - Math.abs(a.dev!));
}

export function devText(dev: number): string {
  return `${dev >= 0 ? "+" : "−"}${Math.abs(dev)}%`;
}
