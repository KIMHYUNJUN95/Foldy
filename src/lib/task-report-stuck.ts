/**
 * 업무일지 예약 — 「보내는 중」에 갇힌 행 풀기 기준(2026-10-29).
 *
 * 틱(`claim_due_task_report_schedules`)은 `claimed_at` 이 10분 넘게 지난 `sending` 을 `failed`('stuck')로 푼다.
 * 「지금 보내기」는 예전에 `claimed_at` 없이 `sending` 으로만 바꿔서, 도중에 서버가 멈추면 그 행이 영영 풀리지 않았다
 * (그 날짜는 다시 예약 · 지금 보내기 모두 `busy`). 이제 지금 보내기도 `claimed_at` 을 적고, 서버 액션이 같은 기준으로 먼저 푼다.
 * `claimed_at` 이 없는 옛 행은 `updated_at`(트리거가 갱신)으로 본다. docs/product/18-todo-task-workflow.md 「업무일지 예약 보내기」
 */

export const REPORT_SENDING_STUCK_MS = 10 * 60_000;

/** PostgREST `or` 조건 — 이 시각보다 오래 `sending` 인 행. */
export function stuckSendingOrFilter(nowMs: number): string {
  const cutoff = new Date(nowMs - REPORT_SENDING_STUCK_MS).toISOString();
  return `claimed_at.lt."${cutoff}",and(claimed_at.is.null,updated_at.lt."${cutoff}")`;
}
