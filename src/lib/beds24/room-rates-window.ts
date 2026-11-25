import { tokyoDateOf, ymdShift } from "@/lib/tokyo-date";

/** 이 시간 안에 우리 작업이 쓴 칸은 동기화 값과 어긋나면 다시 읽는다(`recent-write-guard.ts`). */
export const RECENT_WRITE_GUARD_MS = 60 * 60 * 1000;

/**
 * 요금 전체 읽기의 날짜 창 — 읽은 날(도쿄) 어제 ~ +12개월, 양 끝 포함. 순수 모듈이다: 판매 캘린더 병합
 * (`ops-rate-merge.ts`)이 「그 전체 읽기가 이 날짜를 읽었나」를 같은 창으로 다시 계산한다.
 */
export function buildRoomRatesWindow(now = new Date()): { from: string; to: string } {
  const today = tokyoDateOf(now.toISOString()) as string;
  const [year, month, day] = today.split("-").map(Number);
  // 입력이 이미 도쿄 달력 날짜라 여기서의 UTC 는 시간대가 아니라 달력 계산용이다(`ymdShift` 와 같다).
  const to = new Date(Date.UTC(year, month - 1 + 12, day)).toISOString().slice(0, 10);
  return { from: ymdShift(today, -1), to };
}
