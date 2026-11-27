/**
 * 투두 날짜·회차 술어 — **순수 모듈, 서버 import 없음.** 모바일과 관리자 콘솔이 함께 쓴다.
 *
 * **왜 여기 있나.** 이 술어들은 「이 작업이 오늘 목록에 뜨는가 / 지연인가 / 이 날짜에 회차가 있는가」를
 * 정한다. 그런데 두 화면이 각자 구현하고 있었다 — 콘솔은 `admin/tasks/helpers.ts` 에 export 로,
 * 모바일은 `tasks-workspace.tsx` 안에 인라인 화살표 함수로. 의미는 같고 코드는 별개였다.
 *
 * 이 저장소가 문서에 «쌍둥이 어긋남»을 반복 실패 모드로 못박아 둔 이유가 이것이다: 반복 규칙이 두
 * 파일에 복사돼 있다가 정의가 갈리면서 **오버듀 작업이 하드 삭제되는** 사고가 났다
 * (`admin-tasks.ts` 주석). 2026-08-25 에 고친 회귀 5건 중 3건도 같은 패턴이었다.
 *
 * 그래서 규칙을 한 곳에 두고, 테스트를 이 파일에 건다
 * (`src/lib/__tests__/task-predicates.test.ts`). 화면 컴포넌트에 있는 한 테스트를 걸 수가 없다.
 *
 * **계약:** `today` 는 항상 인자로 받는다. 모듈이 스스로 «지금»을 읽으면 서버 렌더 시점과 클라이언트
 * 시점이 갈리고, 그 차이가 자정 근처에서 하루 오차로 나타난다.
 */

import type { TaskRecord } from "@/lib/tasks"; // 타입 전용 — 빌드 시 지워지므로 서버 오염 없음
import {
  isRecurringOccurrenceDate,
  isStandardRecurrence,
  outstandingOverdueOccurrences,
  recurringOccurrencesInRange,
  type OccurrenceState,
} from "@/lib/tasks-recurrence";
import { tokyoDateOf, ymdShift } from "@/lib/tokyo-date";

/** 완료·취소가 아닌 살아 있는 작업. `cancelled` 는 DB CHECK 에 있는 정식 상태다. */
export function isActiveTask(t: TaskRecord): boolean {
  return t.status !== "completed" && t.status !== "cancelled";
}

/** 마감(due)의 도쿄 날짜. 시간이 있어도 날짜만 본다. */
export function dueDateOf(t: TaskRecord): string | null {
  return tokyoDateOf(t.dueAt);
}

/**
 * 이 작업이 걸려 있는 단 하나의 날짜 — 마감 우선, 없으면 예정일.
 *
 * 반복 작업에서 이 값은 **마감이 아니라 앵커**다(「7/30부터 평일마다」의 시작점). 고정이며, 이동
 * 액션은 이 값을 건드리지 않는다(2026-08-25). 목록에서 반복 작업의 날짜를 보여줄 거라면 앵커가
 * 아니라 다음 회차를 써야 한다 — `nextRecurringOccurrence`.
 */
export function anchorDateOf(t: TaskRecord): string | null {
  return dueDateOf(t) ?? t.scheduledDate ?? null;
}

/** 이 작업이 `ymd` 에 걸리는가 — 반복은 규칙으로, 비반복은 앵커 하루. */
export function occursOn(t: TaskRecord, ymd: string): boolean {
  const anchor = anchorDateOf(t);
  if (!anchor) return false;
  if (isStandardRecurrence(t.recurrenceRule)) {
    return recurringOccurrencesInRange(t.recurrenceRule, anchor, ymd, ymd).length > 0;
  }
  return anchor === ymd;
}

/* ── 일회성 전용 날짜 버킷 ────────────────────────────────────────────────────────
   표준 반복은 완료해도 롤포워드하지 않고 각 회차가 독립이므로(2026-07-30), 아래 세 술어는
   **반복을 명시적으로 제외**한다. 반복은 회차 술어로 따로 처리한다. */

/** 지연 — 마감이 오늘보다 과거인 살아 있는 일회성 작업. */
export function isOverdueOneOff(t: TaskRecord, today: string): boolean {
  if (isStandardRecurrence(t.recurrenceRule)) return false;
  const due = dueDateOf(t);
  return isActiveTask(t) && !!due && due < today;
}

/** 오늘 — 오늘에 걸린 일회성 작업(지연으로 이미 잡힌 것은 제외). */
export function isTodayOneOff(t: TaskRecord, today: string): boolean {
  if (isStandardRecurrence(t.recurrenceRule)) return false;
  return (
    isActiveTask(t) &&
    !isOverdueOneOff(t, today) &&
    (t.scheduledDate === today || dueDateOf(t) === today)
  );
}

/** 내일 — 내일에 걸린 일회성 작업. 미래라 지연일 수 없다. */
export function isTomorrowOneOff(t: TaskRecord, today: string): boolean {
  if (isStandardRecurrence(t.recurrenceRule)) return false;
  const tomorrow = ymdShift(today, 1);
  return (
    isActiveTask(t) && (t.scheduledDate === tomorrow || dueDateOf(t) === tomorrow)
  );
}

/* ── 반복 회차 술어 ──────────────────────────────────────────────────────────────
   회차 상태는 `task_occurrence_state` 가 정본이고, 여기서는 **조회 함수를 주입받는다** — 두 화면의
   상태 보관 형태가 다르기 때문이다(모바일은 Map<taskId, Map<date, state>>, 콘솔도 유사하지만 별개).
   순수하게 유지하려면 저장 형태를 모르는 편이 낫다. */

/**
 * 이 날짜에 **미해결** 반복 회차가 떠야 하는가.
 *
 * 상태 행이 있으면 그 회차는 해결된 것이다 — completed(완료) · skipped(건너뜀) · moved(가져옴)
 * 셋 다. 예전에 completed 만 걸러서 건너뛴 회차가 목록에 남았던 적이 있다.
 */
export function isOpenOccurrenceOn(
  t: TaskRecord,
  ymd: string,
  stateOf: (taskId: string, date: string) => OccurrenceState | undefined,
): boolean {
  return (
    isActiveTask(t) &&
    isStandardRecurrence(t.recurrenceRule) &&
    occursOn(t, ymd) &&
    !stateOf(t.id, ymd)
  );
}

/** 이 반복 작업의 미해결 지연 회차 날짜들(과거 · 상태 없음). 비반복이면 빈 배열. */
export function overdueOccurrenceDatesOf(
  t: TaskRecord,
  today: string,
  resolvedDates: ReadonlySet<string>,
): string[] {
  if (!isStandardRecurrence(t.recurrenceRule)) return [];
  return outstandingOverdueOccurrences(t.recurrenceRule, anchorDateOf(t), today, resolvedDates);
}

/**
 * 이 반복 작업이 **오늘 목록에 떠야 하는가** (2026-09-08).
 *
 * 오늘이 회차거나, **밀린 회차가 남아 있으면** 뜬다. 후자가 이번에 추가된 규칙이다.
 *
 * 예전에는 밀린 회차를 지연 섹션에 «작업별 1건» 으로 따로 세웠는데, 평일 반복은 하루만 밀려도
 * 전부 거기 쏟아져 **진짜 지연(일회성)이 묻혔다** — 실측 화면에서 지연 9건 중 8건이 「1일 밀림」
 * 반복이었고, 정작 2주 밀린 일회성 하나가 그 사이에 파묻혀 있었다. 게다가 오늘도 회차인 반복은
 * 지연·오늘 **두 줄**로 나타났다.
 *
 * 이제 반복은 어느 경우든 **오늘 한 줄**이고, 밀렸다는 사실은 `overdueOccurrenceDatesOf` 로 센
 * 「N회 밀림」 배지로 붙는다. 완료하면 서버가 밀린 회차까지 흡수하므로 배지도 함께 사라진다
 * (`absorbEarlierOccurrences`).
 */
export function showsOnTodayList(
  t: TaskRecord,
  today: string,
  stateOf: (taskId: string, date: string) => OccurrenceState | undefined,
  resolvedDates: ReadonlySet<string>,
): boolean {
  if (!isStandardRecurrence(t.recurrenceRule) || !isActiveTask(t)) return false;
  // **오늘 회차가 이미 해결됐으면 뜨지 않는다** — 완료/건너뜀/이동 전부. 밀린 회차가 남아 있어도
  // 마찬가지다: 오늘 몫을 끝낸 일이 미완료 상태로 다시 목록에 서면 «완료했는데 또 있다» 가 된다
  // (2026-09-08 제보). 완료가 밀린 회차를 흡수하므로 정상 흐름에서는 그 배지도 곧 사라지지만,
  // 이 판정은 흡수 여부와 무관하게 지켜져야 하는 불변식이다.
  if (occursOn(t, today) && stateOf(t.id, today)) return false;
  if (isOpenOccurrenceOn(t, today, stateOf)) return true;
  return overdueOccurrenceDatesOf(t, today, resolvedDates).length > 0;
}

/* ── 정렬 ────────────────────────────────────────────────────────────────────────
   우선순위 사다리(2026-07-30, Todoist P1~P4). `medium` 이 빠지면 폴백(3)으로 떨어져 normal 과
   동점이 되고, 같은 작업이 두 화면에서 다르게 줄 선다 — 실제로 두 파일에 복사돼 있던 표다. */

const PRIO_ORD: Record<string, number> = { urgent: 0, important: 1, medium: 2, normal: 3 };

export function prioRank(priority: string): number {
  return PRIO_ORD[priority] ?? 3;
}

export function prioSort(a: TaskRecord, b: TaskRecord): number {
  return prioRank(a.priority) - prioRank(b.priority);
}

/* ── 「오늘로 가져오기」 보충 사본 판정 ─────────────────────────────────────────── */

/**
 * `date` 의 회차가 **밀린 몫까지 덮는가** — 덮으면 보충 사본을 만들지 않는다.
 *
 * 밀린 회차 계산 범위는 `[anchor, 어제]` 라 오늘 회차는 손대지 않는다. 매일/평일/사용자지정요일처럼
 * 오늘도 회차가 있는 규칙이면, 사본을 무조건 만들 때 오늘 목록에 같은 제목이 2건 뜬다.
 *
 * **상태별 판단** — 이 반복 업무들은 누적되지 않는다(3일치 재고 확인을 세 번 하지 않는다). 오늘
 * 한 번으로 밀린 몫이 덮이므로, 오늘 회차가 있으면 원칙적으로 사본이 필요 없다.
 *   - 상태 없음(열림) → 덮는다. 오늘 뜬 그 회차가 보충분을 겸한다.
 *   - `completed`     → 덮는다. **오늘 이미 했다.** (최초 구현은 여기서 사본을 만들어 「오늘
 *                       완료했는데 같은 게 또 생긴다」는 중복을 냈다 — 2026-08-25 사용자 제보로 수정.)
 *   - `moved`         → 덮는다. 그 회차는 이미 다른 곳으로 옮겨져 처리 중이다.
 *   - `skipped`       → **덮지 않는다.** 오늘 회차를 «안 한다»고 명시한 상태에서 밀린 것을 당겼다면
 *                       오늘 할 일이 하나 필요하다는 뜻이다. 유일하게 사본을 만드는 갈래.
 * 오늘이 애초에 회차가 아니면(주간·월간 등) 덮지 못하므로 사본을 만든다.
 */
export function backlogCoveredByOccurrenceOn(args: {
  rule: string | null;
  anchor: string | null;
  date: string;
  state: OccurrenceState | undefined;
}): boolean {
  if (!isRecurringOccurrenceDate(args.rule, args.anchor, args.date)) return false;
  return args.state !== "skipped";
}
