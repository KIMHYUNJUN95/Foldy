"use client";

import type { PriceChangeResult } from "@/actions/ops-calendar";
import { fetchPriceJobStatus } from "./ops-reads";

/**
 * 판매 캘린더 쓰기(가격 · 최소숙박)의 **접수 → 반영 → 화면 갱신**을 잇는다.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「반영되면 새로고침 없이 보인다」
 *
 * ## 왜 필요한가 (2026-09-28)
 *
 * 가격·최소숙박은 **큐**로 간다(`submitPriceChange` → `beds24_price_jobs` → 워커). 서버 액션은
 * 접수만 하고 바로 돌아오므로, 그때 다시 그린 화면은 **아직 반영 전 값**이다. 워커가 몇 초 뒤
 * Beds24 에 쓰고 `room_daily_rates` 를 고쳐도 화면은 그걸 몰라 **새로고침해야** 보였다
 * (사용자 지적). 상태 조회는 만들어 두고 부르는 곳이 없었다.
 *
 * 그래서 격자가 ① 누르는 즉시 새 값을 흐리게 그리고(낙관적 표시) ② 작업이 끝날 때까지 상태를
 * 묻고 ③ 끝나면 `router.refresh()` 로 **서버 데이터만** 다시 받아 확정 값으로 바꾼다.
 * 실패하면 흐린 값을 거두고 원래 값으로 돌아간다.
 */

export type OpsWriteKind = "price" | "minStay";

/** 끝난 모양. `timeout` 은 워커가 아직 안 끝났다는 뜻이지 실패가 아니다(크론이 이어 받는다). */
export type OpsWriteOutcome = "completed" | "partial_failed" | "failed" | "timeout";

/**
 * 패널이 부른다. `values` 는 낙관적으로 먼저 그릴 칸(`roomKey|date` → 새 값)이다.
 *
 * 반환의 `settled` 는 **반영이 끝났을 때** 풀린다 — 패널이 「반영 완료 / 실패」를 그 자리에서
 * 알린다. 접수 자체가 실패했으면 `null` 이다(흐린 값은 이미 거둬졌다).
 */
export type RunOpsWrite = (
  kind: OpsWriteKind,
  values: Array<{ key: string; value: number }>,
  submit: () => Promise<PriceChangeResult>,
) => Promise<{ result: PriceChangeResult; settled: Promise<OpsWriteOutcome> | null }>;

const TERMINAL = new Set(["completed", "partial_failed", "failed"]);
/** 워커는 보통 5~6초면 끝난다(저쪽 실측도 같다). 이만큼 기다리고도 안 끝나면 놓아 준다. */
const WATCH_LIMIT_MS = 90_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * 작업이 끝날 때까지 상태를 묻는다.
 *
 * 처음엔 촘촘히(0.5초), 갈수록 느슨하게(최대 1.5초) — 대부분 몇 초 안에 끝나므로 첫 몇 번이
 * 빨라야 「바로 바뀐다」로 느껴지고, 오래 걸리는 작업에 서버를 두드리지는 않는다.
 * 조회는 행 하나(`beds24_price_jobs` 기본키)라 가볍다.
 */
export async function watchOpsWriteJob(jobId: string): Promise<OpsWriteOutcome> {
  const started = Date.now();
  let delay = 500;
  while (Date.now() - started < WATCH_LIMIT_MS) {
    await sleep(delay);
    try {
      const status = await fetchPriceJobStatus(jobId);
      if (status && TERMINAL.has(status.status)) return status.status as OpsWriteOutcome;
    } catch {
      // 한 번 못 물었다고 포기하지 않는다 — 다음 차례에 다시 묻는다.
    }
    delay = Math.min(1500, delay + 250);
  }
  return "timeout";
}

export type OpsWriteOutcomeCopy = {
  writePartial: string;
  writeFailed: string;
  writeSlow: string;
};

/** 반영 결과 문구. 완료 문구는 패널마다 달라 따로 받는다. */
export function outcomeText(
  doneText: string,
  copy: OpsWriteOutcomeCopy,
  outcome: OpsWriteOutcome,
): string {
  switch (outcome) {
    case "completed":
      return doneText;
    case "partial_failed":
      return copy.writePartial;
    case "failed":
      return copy.writeFailed;
    default:
      return copy.writeSlow;
  }
}
