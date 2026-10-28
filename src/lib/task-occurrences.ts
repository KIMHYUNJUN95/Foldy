import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  isOccurrenceCompleted,
  isRecurringOccurrenceDate,
  occurrencesToAbsorb,
  pickCompletionOccurrence,
  type OccurrenceState,
} from "@/lib/tasks-recurrence";
import { tokyoToday } from "@/lib/tokyo-date";
import type { Database } from "@/types/database";

/**
 * `task_occurrence_state` 의 서버 전용 변경 — 반복 할 일의 회차별 완료/건너뜀/이동 상태.
 * 반복 할 일용이다(2026-07-30 롤포워드 폐지, docs/planning/01-decision-log.md 참고).
 * 모바일과 관리자 할 일 액션이 함께 써서 두 화면이 똑같은 상태를 쓴다(쌍둥이 어긋남 방지).
 *
 * 반복 할 일의 행은 고정된 규칙 + 기준이며 앞으로 넘기거나 완료 처리하지 않는다.
 * 완료는 여기에 `(task_id, occurrence_date)` 를 키로 저장한다.
 */

type OccurrenceInsert = Database["public"]["Tables"]["task_occurrence_state"]["Insert"];

/** 회차 날짜 하나를 완료로 표시한다(PK 기준 멱등 upsert). */
export async function completeOccurrence(args: {
  taskId: string;
  organizationId: string;
  occurrenceDate: string;
  userId: string;
}): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const row: OccurrenceInsert = {
    task_id: args.taskId,
    organization_id: args.organizationId,
    occurrence_date: args.occurrenceDate,
    state: "completed",
    completed_by_user_id: args.userId,
    moved_to_date: null,
  };
  // 결과를 돌려준다(2026-10-26) — 실패를 버리면 호출부가 완료 기록 · 알림을 그대로 남겨,
  // 화면은 «완료됐다»고 말하는데 새로고침하면 다시 열려 있었다.
  const { error } = await supabase
    .from("task_occurrence_state")
    .upsert(row, { onConflict: "task_id,occurrence_date" });
  if (error) {
    console.error("[completeOccurrence] upsert failed:", error.message);
    return false;
  }
  return true;
}

/** 회차에 기록된 상태를 지운다(완료한 회차를 다시 열거나 취소할 때 사용). */
export async function clearOccurrenceState(taskId: string, occurrenceDate: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("task_occurrence_state")
    .delete()
    .eq("task_id", taskId)
    .eq("occurrence_date", occurrenceDate);
  if (error) {
    console.error("[clearOccurrenceState] delete failed:", error.message);
    return false;
  }
  return true;
}

/**
 * «건너뜀» 상태일 때만 지운다(2026-10-28) — 되살리기 사이에 같은 회차가 완료됐다면 그 완료를 풀지 않는다.
 * 건너뜀이 아니어서 지울 게 없어도 성공(true)이다: 화면이 바라는 «건너뛴 상태가 아님» 이 이미 참이다.
 */
export async function clearSkippedOccurrenceState(
  taskId: string,
  occurrenceDate: string,
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("task_occurrence_state")
    .delete()
    .eq("task_id", taskId)
    .eq("occurrence_date", occurrenceDate)
    .eq("state", "skipped");
  if (error) {
    console.error("[clearSkippedOccurrenceState] delete failed:", error.message);
    return false;
  }
  return true;
}

/** 지난 회차 날짜들을 건너뜀("삭제")으로 처리한다 — 영구 보관되며 다시 나타나지 않는다. */
export async function skipOccurrences(args: {
  taskId: string;
  organizationId: string;
  dates: string[];
}): Promise<boolean> {
  if (args.dates.length === 0) return true;
  const supabase = getSupabaseServiceClient();
  const rows: OccurrenceInsert[] = args.dates.map((d) => ({
    task_id: args.taskId,
    organization_id: args.organizationId,
    occurrence_date: d,
    state: "skipped",
    completed_by_user_id: null,
    moved_to_date: null,
  }));
  const { error } = await supabase
    .from("task_occurrence_state")
    .upsert(rows, { onConflict: "task_id,occurrence_date" });
  if (error) {
    console.error("[skipOccurrences] upsert failed:", error.message);
    return false;
  }
  return true;
}

/** 밀린 회차 날짜들을 `movedTo` 로 옮김 처리한다 — 지금은 `absorbEarlierOccurrences` 만 쓴다. */
export async function moveOccurrences(args: {
  taskId: string;
  organizationId: string;
  dates: string[];
  movedTo: string;
}): Promise<void> {
  if (args.dates.length === 0) return;
  const supabase = getSupabaseServiceClient();
  const rows: OccurrenceInsert[] = args.dates.map((d) => ({
    task_id: args.taskId,
    organization_id: args.organizationId,
    occurrence_date: d,
    state: "moved",
    completed_by_user_id: null,
    moved_to_date: args.movedTo,
  }));
  await supabase
    .from("task_occurrence_state")
    .upsert(rows, { onConflict: "task_id,occurrence_date" });
}

/** 할 일에서 이미 상태 행이 있는 회차 날짜(아직 열려 있는 것을 계산할 때 사용). */
export async function resolvedOccurrenceDates(taskId: string): Promise<Set<string>> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("task_occurrence_state")
    .select("occurrence_date")
    .eq("task_id", taskId);
  return new Set(((data ?? []) as Array<{ occurrence_date: string }>).map((r) => r.occurrence_date));
}

/**
 * 한 작업의 회차 상태 전체 — `occurrence_date` → state.
 *
 * `resolvedOccurrenceDates` 는 «행이 있는가»만 답하므로 완료와 건너뜀/이동을 구분하지 못한다. 상세
 * 화면은 그 구분이 필요한데(완료 버튼 라벨), 조직 전체 회차 상태를 끌어오는 `getOccurrenceStates`
 * 를 쓰면 날짜 한 건을 알려고 400일치 org 데이터를 읽게 된다. 작업 하나로 좁힌 조회를 두고,
 * 호출부가 이 한 번의 결과에서 «해결된 날짜 집합»과 «완료 여부»를 함께 뽑아 쓴다.
 */
export async function occurrenceStatesForTask(
  taskId: string,
): Promise<Map<string, OccurrenceState>> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("task_occurrence_state")
    .select("occurrence_date, state")
    .eq("task_id", taskId);
  const rows = (data ?? []) as Array<{ occurrence_date: string; state: string }>;
  return new Map(rows.map((r) => [r.occurrence_date, r.state as OccurrenceState]));
}

/**
 * 이 완료가 **실제로 정산하는 회차 날짜**를 정한다 (2026-09-08, 2026-10-28 갱신).
 *
 * 문제. 반복은 밀린 회차가 있으면 **오늘이 회차가 아니어도** 오늘 목록에 뜬다(월·수·금 반복을
 * 화요일에 보는 경우). 그런데 카드는 «오늘» 을 회차 날짜로 넘기므로, 그대로 저장하면 **규칙에 없는
 * 화요일에 상태 행이 생긴다.** 실제로 그런 행이 만들어졌다(일매출 변동 시트작업 / 2026-09-08 화).
 *
 * 그래서 요청받은 날짜가 회차가 아니면 **그 이전의 가장 최근 미해결 회차**로 바꾼다
 * (`pickCompletionOccurrence`). 더 오래된 밀린 회차는 이어지는 `absorbEarlierOccurrences` 가 치운다.
 * 2026-10-28 전에는 가장 오래된 것을 골라, 금·월이 밀린 화요일에 체크하면 월요일이 «1일 밀림» 으로
 * 남았다.
 */
export async function resolveCompletionOccurrence(args: {
  taskId: string;
  rule: string | null;
  anchor: string | null;
  /** 화면이 넘긴 회차 날짜(대개 «오늘»). */
  requested: string;
}): Promise<string> {
  if (isRecurringOccurrenceDate(args.rule, args.anchor, args.requested)) return args.requested;
  const states = await occurrenceStatesForTask(args.taskId);
  return pickCompletionOccurrence(args.rule, args.anchor, args.requested, new Set(states.keys()));
}

/**
 * 그 회차가 이미 완료로 기록돼 있는가(2026-10-28) — 완료 액션의 이중 완료 가드용.
 * `resolveCompletionOccurrence` 가 돌려준 날짜로 부른다. 읽기 실패는 «완료 아님» 으로 본다
 * (가드가 정상 완료를 막지 않게).
 */
export async function occurrenceAlreadyCompleted(
  taskId: string,
  occurrenceDate: string,
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("task_occurrence_state")
    .select("state")
    .eq("task_id", taskId)
    .eq("occurrence_date", occurrenceDate)
    .maybeSingle();
  if (error || !data) return false;
  return isOccurrenceCompleted(
    new Map([[occurrenceDate, (data as { state: string }).state as OccurrenceState]]),
    occurrenceDate,
  );
}

/**
 * 완료를 되돌릴 때, **그 완료가 흡수했던 회차를 함께 되살린다** (2026-09-08).
 *
 * `absorbEarlierOccurrences` 가 밀린 회차를 `moved_to_date = <완료일>` 로 적어 두므로, 그 완료일을
 * 가리키는 `moved` 행만 지운다. 이게 없으면 완료를 취소해도 **밀림 배지가 돌아오지 않아**, 되돌리기가
 * 반쪽이 된다(사용자는 「취소했는데 밀린 게 사라졌다」를 보게 된다).
 *
 * 한계(2026-10-28 기록): 흡수가 만든 `moved` 행과 예전 「오늘로 가져오기」(2026-07-30 ~ 08-25)가 만든
 * `moved` 행은 모양이 같아 구분할 수 없다. 그래서 그날로 가져왔던 옛 행도 함께 지워져 그 회차가 다시
 * «밀림» 으로 보일 수 있다. 옛 행은 그 기간에 만든 것뿐이라 그대로 둔다.
 */
export async function releaseAbsorbedOccurrences(
  taskId: string,
  completedDate: string,
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("task_occurrence_state")
    .delete()
    .eq("task_id", taskId)
    .eq("state", "moved")
    .eq("moved_to_date", completedDate);
}

/**
 * 반복 회차 하나를 완료할 때, **그보다 앞선 미해결 회차를 함께 해소한다**(2026-09-08).
 *
 * 이 반복 업무들은 누적되지 않는다 — 3일치 재고 확인을 세 번 하지 않는다. 오늘 한 번 하면 밀린
 * 몫도 끝난 것이다. 그래서 밀린 회차를 지연 섹션에 따로 세우지 않고 **오늘 줄에 「N일 밀림」 배지**
 * 로만 보여 주기로 했고(결정 로그 2026-09-08), 그 배지는 완료와 함께 사라져야 한다.
 *
 * 상태는 `skipped` 가 아니라 **`moved`** 를 쓴다 — `moved_to_date` 에 「어느 날짜의 완료가
 * 흡수했는가」가 남아, 나중에 «그날 왜 안 했지» 를 되짚을 수 있다. `skipped` 는 사용자가 명시적으로
 * 건너뛴 것을 뜻하므로 의미가 다르다.
 *
 * 대상은 `[anchor, min(완료일, 오늘))` 이다(`occurrencesToAbsorb`). 캘린더에서 과거 회차를 직접
 * 완료하면 그보다 뒤는 건드리지 않고, **내일 회차를 미리 완료해도 오늘(도쿄) 회차는 건드리지 않는다**
 * (2026-10-28 — 예전에는 오늘 회차가 «이동» 처리돼 오늘 목록에서 사라졌다).
 */
export async function absorbEarlierOccurrences(args: {
  taskId: string;
  organizationId: string;
  rule: string | null;
  anchor: string | null;
  /** 방금 완료한 회차 날짜. 이 날짜와 오늘 중 이른 쪽 **미만**의 미해결 회차가 대상이다. */
  completedDate: string;
}): Promise<number> {
  const states = await occurrenceStatesForTask(args.taskId);
  const dates = occurrencesToAbsorb(
    args.rule,
    args.anchor,
    args.completedDate,
    tokyoToday(),
    new Set(states.keys()),
  );
  if (dates.length === 0) return 0;
  await moveOccurrences({
    taskId: args.taskId,
    organizationId: args.organizationId,
    dates,
    movedTo: args.completedDate,
  });
  return dates.length;
}

/* ── 회차별 수동 순서 (task_occurrence_order, 2026-07-30) ─────────────────────────
   반복 작업은 행 하나가 여러 날짜에 나타나므로 `tasks.sort_order` 한 칸으로는 날짜별 순서를 담을 수
   없다. 그래서 `(task_id, occurrence_date)` 키로 위치를 따로 저장한다.

   **`task_occurrence_state` 가 아니라 별도 테이블인 이유**: 그 테이블은 "행이 없으면 아직 열린
   회차"가 계약이라(`outstandingOverdueOccurrences`), 순서용 행을 넣으면 오버듀 회차가 조용히
   사라진다. 마이그레이션 주석 참고. */

type OccurrenceOrderInsert = Database["public"]["Tables"]["task_occurrence_order"]["Insert"];

/**
 * 일회성 작업의 `tasks.sort_order` 를 **바뀐 행만** 쓴다.
 *
 * 네 곳(모바일·콘솔 × 목록·날짜)이 각자 «인덱스마다 UPDATE 한 방»을 병렬로 쏘고 있었다. 상한이
 * 500이라 한 번의 드래그가 최대 500개의 UPDATE 가 될 수 있었고, 실제로는 드래그 한 번에 위치가
 * 바뀌는 행이 몇 개뿐인 경우가 대부분이다.
 *
 * 먼저 현재 값을 한 번 읽고 **다른 행만** 갱신한다. 읽기 1 + 쓰기 N(변경분). 목록 맨 위로 끌어올려
 * 아래가 전부 밀리는 최악의 경우에도 예전과 같고, 흔한 경우엔 한두 건으로 접힌다.
 *
 * `sort_order` 는 작업당 하나뿐인 전역 값이라(사용자별이 아니다) 날짜별 위치는 여기에 담을 수 없다 —
 * 반복 회차는 아래 `setOccurrenceOrders` 가 따로 든다.
 */
export async function setTaskSortOrders(args: {
  organizationId: string;
  /** taskId → 그 목록에서의 인덱스 */
  positions: ReadonlyMap<string, number>;
}): Promise<void> {
  if (args.positions.size === 0) return;
  const supabase = getSupabaseServiceClient();
  const ids = [...args.positions.keys()];
  const { data } = await supabase
    .from("tasks")
    .select("id, sort_order")
    .in("id", ids)
    .eq("organization_id", args.organizationId);
  const current = new Map(
    ((data ?? []) as Array<{ id: string; sort_order: number | null }>).map((r) => [
      r.id,
      r.sort_order,
    ]),
  );
  // 조회에 없는 id(다른 조직·삭제됨)는 건너뛴다 — 예전 코드는 그런 id 에도 UPDATE 를 쏘고 있었다.
  const changed = [...args.positions].filter(
    ([id, index]) => current.has(id) && current.get(id) !== index,
  );
  if (changed.length === 0) return;
  await Promise.all(
    changed.map(([id, index]) =>
      supabase
        .from("tasks")
        .update({ sort_order: index })
        .eq("id", id)
        .eq("organization_id", args.organizationId),
    ),
  );
}

/**
 * 한 날짜 목록의 반복 회차 위치를 통째로 다시 쓴다.
 *
 * 목록은 일회성 작업과 반복 회차가 섞여 있고, 인덱스는 **그 병합된 목록 기준**으로 넘어온다 —
 * 그래야 두 저장처(`tasks.sort_order` / 여기)를 합쳐 정렬했을 때 사용자가 놓은 순서가 재현된다.
 */
export async function setOccurrenceOrders(args: {
  organizationId: string;
  occurrenceDate: string;
  /** taskId → 병합 목록에서의 인덱스 */
  positions: ReadonlyMap<string, number>;
}): Promise<boolean> {
  if (args.positions.size === 0) return true;
  const supabase = getSupabaseServiceClient();
  // 이 조직의 살아 있는 작업만 남긴다(2026-10-26) — 서비스 키 upsert 라 클라이언트 id 를 그대로
  // 믿으면 다른 조직 작업 id 로 순서 행을 심을 수 있었다(`setTaskSortOrders` 와 같은 방어).
  const { data: owned, error: ownedError } = await supabase
    .from("tasks")
    .select("id")
    .in("id", [...args.positions.keys()])
    .eq("organization_id", args.organizationId)
    .is("deleted_at", null);
  if (ownedError) {
    console.error("[setOccurrenceOrders] ownership check failed:", ownedError.message);
    return false;
  }
  const ownedIds = new Set(((owned ?? []) as Array<{ id: string }>).map((r) => r.id));
  const rows: OccurrenceOrderInsert[] = [...args.positions]
    .filter(([taskId]) => ownedIds.has(taskId))
    .map(([taskId, sortOrder]) => ({
    task_id: taskId,
    organization_id: args.organizationId,
    occurrence_date: args.occurrenceDate,
    sort_order: sortOrder,
  }));
  if (rows.length === 0) return true;
  const { error } = await supabase
    .from("task_occurrence_order")
    .upsert(rows, { onConflict: "task_id,occurrence_date" });
  if (error) {
    // 초기 구현이 결과를 버려, 테이블 미적용 상태에서 저장이 조용히 실패했다 — 화면은 낙관적으로
    // 바뀌고 새로고침하면 되돌아가는데 아무 단서가 없었다(2026-07-30). 최소한 로그는 남긴다.
    console.error("[setOccurrenceOrders] upsert failed:", error.message);
    return false;
  }
  return true;
}
