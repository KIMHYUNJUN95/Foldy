// PC 투두 콘솔(/admin/tasks) 의 표시 판정 — 반복 다듬기(2026-11-26). 순수 함수라 테스트로 고정한다.

export type ConsoleTaskStatus = "open" | "in_progress" | "completed";

/** 밀린 회차가 이보다 많으면 줄에 「밀린 회차 정리」를 붙인다. */
export const CATCH_UP_THRESHOLD = 7;

export const needsCatchUp = (behind: number | undefined) => (behind ?? 0) > CATCH_UP_THRESHOLD;

/**
 * 상세 패널의 상태 알약 하나. 글자는 지금 상태, 누르면 대기 ↔ 진행 중. 완료는 제목 고리가 맡는다.
 * 완료된 일회성은 예전 3칸 「진행 중」처럼 누르면 진행 중으로 다시 연다. 완료된 반복 회차는 고리로만 되돌린다.
 */
export function statusPillView(input: {
  /** 낙관적 값(statusDraft 반영). */
  shownStatus: ConsoleTaskStatus;
  recurring: boolean;
  occDone: boolean;
  completingNow: boolean;
}) {
  const { shownStatus, recurring, occDone, completingNow } = input;
  // 일회성은 낙관적 상태를 따른다 — 완료를 누르면 서버를 기다리지 않고 바로 「진행 중」. 반복은 회차 기록.
  const done = completingNow || (recurring ? occDone : shownStatus === "completed");
  const labelKey = done ? "stCompleted" : shownStatus === "in_progress" ? "stInProgress" : "stOpen";
  return {
    labelKey,
    isDone: done,
    pressed: !done && shownStatus === "in_progress",
    disabled: (recurring && occDone) || completingNow,
    next: (shownStatus === "in_progress" ? "open" : "in_progress") as Exclude<ConsoleTaskStatus, "completed">,
  } as const;
}

/**
 * 상세 「일정」에 보일 날짜. 반복은 연 회차, 회차 없이 열었으면(관리함 · 프로젝트) 시리즈 날짜 그대로 —
 * 그때는 완료도 막혀 있어 「오늘」이라 적으면 어긋난다.
 */
export const detailScheduleDate = (recurring: boolean, occ: string | null, seriesDate: string | null) =>
  recurring ? occ ?? seriesDate : seriesDate;

/** 캘린더 한 칸: 반복은 「↻ 반복 N」 한 줄로 묶고, 나머지는 `max` 개까지 + 「+N건」. */
export function splitCalendarDay<T>(events: readonly T[], isRecurring: (t: T) => boolean, max = 2) {
  const others = events.filter((t) => !isRecurring(t));
  return {
    repeating: events.length - others.length,
    shown: others.slice(0, max),
    more: Math.max(0, others.length - max),
  };
}
