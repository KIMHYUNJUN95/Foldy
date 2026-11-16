import { tokyoDateOf } from "@/lib/tokyo-date";

/**
 * 오늘 진행 고리(done/total)의 «오늘 완료» 기준 — 모바일 · PC 가 같은 함수를 쓴다(2026-11-16).
 * 예전에는 모바일이 완료 로그만, PC 가 «완료 처리된 일회성 + 반복은 로그» 로 따로 세어 0/3 ↔ 1/4 로 갈렸다.
 *
 * - 일회성: status=completed 이고 완료 시각(도쿄)이 오늘인 내 작업.
 * - 반복: 행 상태는 안 바뀌므로 오늘 완료 로그가 있는 내 작업.
 * - 한 작업은 한 번만 센다.
 */
export type TodayDoneTask = {
  id: string;
  status: string;
  completedAt: string | null;
  recurrenceRule: string | null;
};

export type TodayDoneEntry<T> = { t: T; recurring: boolean };

export function doneTodayEntries<T extends TodayDoneTask>(
  tasks: readonly T[],
  completions: readonly { taskId: string; day: string }[],
  today: string,
  opts: {
    isMine: (t: T) => boolean;
    isRecurring: (t: T) => boolean;
    accept?: (t: T) => boolean;
  },
): TodayDoneEntry<T>[] {
  const accept = opts.accept ?? (() => true);
  const seen = new Set<string>();
  const rows: TodayDoneEntry<T>[] = [];
  for (const t of tasks) {
    if (!opts.isMine(t) || t.status !== "completed" || tokyoDateOf(t.completedAt) !== today) continue;
    if (opts.isRecurring(t) || !accept(t)) continue;
    seen.add(t.id);
    rows.push({ t, recurring: false });
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const c of completions) {
    if (c.day !== today || seen.has(c.taskId)) continue;
    const t = byId.get(c.taskId);
    if (!t || !opts.isMine(t) || !opts.isRecurring(t) || !accept(t)) continue;
    seen.add(t.id);
    rows.push({ t, recurring: true });
  }
  return rows;
}

/** 진행 고리 숫자 — 오늘 완료는 분자와 분모에 모두 들어간다. */
export function todayProgress(remaining: number, done: number): { done: number; total: number } {
  return { done, total: remaining + done };
}
