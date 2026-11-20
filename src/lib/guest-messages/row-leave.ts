import { matchesStatusFilter, type InboxRowState, type InboxStatusFilter } from "@/lib/guest-messages/inbox-model";

/**
 * 손님 메시지 — 대화 상태를 바꿀 때 목록 줄을 서버 답 전에 먼저 접을지(47 §5-10 · 16 「줄 접힘」). **순수하다.**
 * 관리자 콘솔 · 모바일 태블릿 칸(바깥 목록 창)이 같은 판단을 쓴다. 폰은 대화가 다른 화면이라 접을 줄이 없다.
 * - 검색 중에는 접지 않는다 — 검색은 상태 탭을 보지 않아(모든 상태) 바뀐 줄도 결과에 남는다. 결과는 `refresh()` 로 새 상태를 받는다.
 * - 검색이 아니면 새 상태가 지금 탭에 안 맞을 때만 접는다(그 줄이 탭에서 빠진다).
 * - 「나중에 풀기」 뒤 상태는 서버가 정한다(손님 말이 마지막이면 답장 대기, 아니면 처리 끝) — 누르는 순간엔 「나중에가 아님」만 안다(`unsnoozed`).
 *   그래서 나중에 탭에서만 빠지고 다른 탭은 그대로다. 한쪽으로 짐작하면 그 줄이 없던 탭에서 미리 접혀 있다가, 서버 답으로 들어올 때 접힌 채 나온다.
 */
export type RowAction = "done" | "snooze" | "reopen" | "unsnooze";

/** 누른 버튼 뒤 상태 — `unsnoozed` = 「나중에」는 아님(답장 대기 · 처리 끝 중 하나, 서버가 정함). */
export type RowNext = InboxRowState | "unsnoozed";

export const ROW_NEXT_VALUES: readonly RowNext[] = ["awaiting", "snoozed", "done", "unsnoozed"];

export function stateAfterAction(action: RowAction): RowNext {
  switch (action) {
    case "done":
      return "done";
    case "snooze":
      return "snoozed";
    case "reopen":
      return "awaiting";
    case "unsnooze":
      return "unsnoozed";
  }
}

export function leavesStatusList(input: { searching: boolean; filter: InboxStatusFilter; next: RowNext }): boolean {
  if (input.searching) return false;
  // 풀린 뒤 상태를 모르면 어느 쪽이 되어도 이 탭에 안 맞을 때만 빠진다.
  const possible: readonly InboxRowState[] = input.next === "unsnoozed" ? ["awaiting", "done"] : [input.next];
  return possible.every((state) => !matchesStatusFilter(state, input.filter));
}
