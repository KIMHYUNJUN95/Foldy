import type { CleaningTaskType } from "@/components/admin/cleaning/cleaning-console-data";
import { roomWriteErrorKind } from "@/lib/cleaning-assign/room-key";
import { tokyoDateOf } from "@/lib/tokyo-date";

/**
 * 관리자 대리 완료 취소(2026-11-25 사용자 결정) — 판정 · 되돌릴 값 · 다시 완료할 입력을 **한 곳**에 둔다.
 *
 * - 취소할 수 있는 것: **오늘(도쿄 운영일) · 관리자가 완료 처리(`completed_by_admin`) · 처리 끝(청소 안 함) 아님 ·
 *   완료 처리 전 상태를 담은 스냅샷이 있음 · 완료 처리 뒤 바뀌지 않음** — 하나라도 어긋나면 막는다.
 * - 되돌리는 값: 진행 중이던 기록은 진행 중으로(담당 · 시작 시각 · 메모 그대로), 관리자가 없던 자리에 만든 기록은 지운다.
 * - 스냅샷은 강제 완료가 덮어쓰기 **직전** 값(`cleaning_sessions.admin_complete_snapshot`). 스냅샷 없는 예전 대리 완료는 취소하지 않는다.
 *
 * 화면(버튼 보이기)과 서버 액션(실제 되돌리기)이 모두 이 판정을 쓴다 — 서버가 기준이다.
 */

export type ForceCompletePrevRow = {
  status: "in_progress" | "completed" | "cancelled";
  staff_user_id: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  notes: string | null;
  completed_by_admin: string | null;
};

export type ForceCompleteApplied = {
  staff_user_id: string;
  started_at: string;
  completed_at: string;
  /** 강제 완료가 남긴 메모(2차 점검 1) — 완료 뒤 메모가 바뀌면 「그 뒤 바뀜」으로 취소를 막는다(빈 값 = null). */
  notes: string | null;
};

export type ForceCompleteSnapshot =
  | { v: 1; created: true; applied: ForceCompleteApplied }
  | ({ v: 1; created: false; applied: ForceCompleteApplied } & ForceCompletePrevRow);

/** 강제 완료가 덮어쓰기 전 값 — `prev` 가 null 이면 관리자가 새로 만든 기록(취소 = 삭제). */
export function buildForceCompleteSnapshot(
  prev: ForceCompletePrevRow | null,
  applied: ForceCompleteApplied,
): ForceCompleteSnapshot {
  if (!prev) return { v: 1, created: true, applied };
  return {
    v: 1,
    created: false,
    status: prev.status,
    staff_user_id: prev.staff_user_id,
    started_at: prev.started_at,
    completed_at: prev.completed_at,
    duration_seconds: prev.duration_seconds,
    notes: prev.notes,
    completed_by_admin: prev.completed_by_admin,
    applied,
  };
}

const sameInstant = (a: string | null, b: string | null) =>
  a !== null && b !== null && new Date(a).getTime() === new Date(b).getTime();

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNullableStr = (v: unknown) => v === null || typeof v === "string";

function parseApplied(v: unknown): ForceCompleteApplied | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (!isStr(a.staff_user_id) || !isStr(a.started_at) || !isStr(a.completed_at)) return null;
  if (!("notes" in a) || !isNullableStr(a.notes)) return null;
  return { staff_user_id: a.staff_user_id, started_at: a.started_at, completed_at: a.completed_at, notes: (a.notes as string | null) || null };
}

export function parseForceCompleteSnapshot(json: unknown): ForceCompleteSnapshot | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const s = json as Record<string, unknown>;
  if (s.v !== 1) return null;
  const applied = parseApplied(s.applied);
  if (!applied) return null;
  if (s.created === true) return { v: 1, created: true, applied };
  if (s.created !== false) return null;
  if (s.status !== "in_progress" && s.status !== "completed" && s.status !== "cancelled") return null;
  if (!isStr(s.staff_user_id) || !isStr(s.started_at)) return null;
  if (!isNullableStr(s.completed_at) || !isNullableStr(s.notes) || !isNullableStr(s.completed_by_admin)) return null;
  if (s.duration_seconds !== null && typeof s.duration_seconds !== "number") return null;
  // 강제 완료가 덮어쓸 수 있는 두 모양만 받는다(점검 A1(b)) — 진행 중(끝 시각 · 소요 없음) · 끝난 시각 모름 완료
  // (`isUnmeasuredSession`: 소요 0초 · 끝 시각 = 시작 시각). 취소 기록 · 정상 완료 기록 모양은 위조로 보고 거절한다.
  const restorable =
    s.status === "in_progress"
      ? s.completed_at === null && s.duration_seconds === null
      : s.status === "completed" && s.duration_seconds === 0 && sameInstant(s.completed_at as string | null, s.started_at);
  if (!restorable) return null;
  return {
    v: 1,
    created: false,
    status: s.status,
    staff_user_id: s.staff_user_id,
    started_at: s.started_at,
    completed_at: s.completed_at as string | null,
    duration_seconds: s.duration_seconds as number | null,
    notes: s.notes as string | null,
    completed_by_admin: s.completed_by_admin as string | null,
    applied,
  };
}

export type ForceCompleteUndoRow = {
  status: string;
  completed_by_admin: string | null;
  closed_without_cleaning: boolean;
  cleaning_date: string;
  staff_user_id: string;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  admin_complete_snapshot: unknown;
};

export type ForceCompleteUndoBlock = "not_completed" | "not_proxy" | "closed" | "not_today" | "no_snapshot" | "changed";

/** 취소할 수 없는 까닭 — null 이면 취소할 수 있다. `today` 는 도쿄 운영일(`getCleaningOperatingDateKey()`). */
export function forceCompleteUndoBlock(row: ForceCompleteUndoRow, today: string): ForceCompleteUndoBlock | null {
  if (row.status !== "completed") return "not_completed";
  if (!row.completed_by_admin) return "not_proxy";
  if (row.closed_without_cleaning) return "closed";
  if (row.cleaning_date !== today) return "not_today";
  const snap = parseForceCompleteSnapshot(row.admin_complete_snapshot);
  if (!snap) return "no_snapshot";
  const { applied } = snap;
  // 대리 완료 뒤 담당자가 다시 열고 끝냈거나(2분 되돌리기) 다른 관리자가 다시 완료했으면 — 그때의 「완료 처리 전」이 아니다.
  if (
    row.staff_user_id !== applied.staff_user_id ||
    !sameInstant(row.started_at, applied.started_at) ||
    !sameInstant(row.completed_at, applied.completed_at) ||
    (row.notes || null) !== applied.notes
  ) {
    return "changed";
  }
  return null;
}

const TS_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Postgres timestamptz 두 값이 **마이크로초까지** 같은 순간인지(`Date` 는 밀리초까지만 본다). 읽을 수 없으면 다르다. */
export function sameTimestamp(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = a ? TS_RE.exec(a) : null;
  const pb = b ? TS_RE.exec(b) : null;
  if (!pa || !pb) return false;
  const epoch = (m: RegExpExecArray) => {
    const tz = m[4] === "Z" ? "Z" : m[4].length === 3 ? `${m[4]}:00` : m[4].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    return Date.parse(`${m[1]}T${m[2]}${tz}`);
  };
  const micro = (m: RegExpExecArray) => (m[3] ?? "").padEnd(6, "0");
  const ea = epoch(pa);
  return Number.isFinite(ea) && ea === epoch(pb) && micro(pa) === micro(pb);
}

/** 다시 완료(취소 토스트의 「실행 취소」)가 본 줄과 지금 줄이 다른지 — 기대값이 없으면(보통 강제 완료) 보지 않는다. */
export function forceCompleteExpectedStale(actualUpdatedAt: string | null, expectedUpdatedAt: string | null | undefined): boolean {
  if (!expectedUpdatedAt) return false;
  return !sameTimestamp(actualUpdatedAt, expectedUpdatedAt);
}

export type ForceCompleteUndoDecision =
  | { ok: true; snapshot: ForceCompleteSnapshot; plan: ForceCompleteUndoPlan }
  | { ok: false; reason: "invalid" | "expired" | "changed" };

/**
 * 서버 취소 액션의 판정 한 곳(2차 점검 1 · 6). `expectedUpdatedAt` 은 **화면이 본** 줄의 `updated_at`
 * (카드 · 강제 완료 결과) — 서버가 방금 읽은 값이 아니다. 그 뒤 무엇이든 바뀌었으면 `changed` 로 거절한다.
 * DB 쓰기도 같은 값으로 거른다(`.eq("updated_at", expectedUpdatedAt)`) — 읽기와 쓰기 사이 경쟁은 그쪽이 막는다.
 */
export function decideForceCompleteUndo(
  row: ForceCompleteUndoRow & { updated_at: string },
  opts: { today: string; expectedUpdatedAt: string | null | undefined },
): ForceCompleteUndoDecision {
  if (!opts.expectedUpdatedAt) return { ok: false, reason: "invalid" };
  // 스냅샷이 있는데 읽을 수 없는 모양 = 강제 완료가 쓴 값이 아니다(위조 · 손상) — 「기한 지남」이 아니라 거절(점검 A1(b)).
  if (row.admin_complete_snapshot !== null && !parseForceCompleteSnapshot(row.admin_complete_snapshot)) {
    return { ok: false, reason: "invalid" };
  }
  const block = forceCompleteUndoBlock(row, opts.today);
  if (block === "changed" || block === "not_completed") return { ok: false, reason: "changed" };
  if (block) return { ok: false, reason: "expired" };
  if (!sameTimestamp(row.updated_at, opts.expectedUpdatedAt)) return { ok: false, reason: "changed" };
  const snapshot = parseForceCompleteSnapshot(row.admin_complete_snapshot);
  if (!snapshot || !row.completed_by_admin) return { ok: false, reason: "expired" };
  return { ok: true, snapshot, plan: forceCompleteUndoPlan(snapshot) };
}

/** 강제 완료 · 완료 취소 · 다시 완료가 **한 번에 하나만** 돌게 하는 문(2차 점검 3) — 콘솔이 하나 들고 모든 쓰기 시작점이 지난다. */
export function createWriteGate() {
  let busy = false;
  return {
    tryBegin(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    end(): void {
      busy = false;
    },
  };
}

export type CleaningPanelFoot = "forceMissing" | "force" | "undo" | "close";

/**
 * 패널 아래 단추 하나 판정(2차 점검 4) — 단추와 「오늘 안에는 완료를 취소할 수 있습니다」 안내가 이 값 하나를 따른다.
 * 순서: 2인 방에서 아직 기록 없는 직원 몫 대신 완료 → 열린 방 · 끝난 시각 모름 강제 완료 → 완료 취소 → 닫기.
 */
export function cleaningPanelFoot(p: {
  canForceComplete: boolean;
  isHistory: boolean;
  status: string;
  sessionId: string | null;
  unmeasured: boolean;
  missingAssignees: readonly string[];
  undoable: boolean;
  hasUndoHandler: boolean;
}): CleaningPanelFoot {
  if (!p.canForceComplete || p.isHistory) return "close";
  const fillTimes = p.sessionId !== null && p.unmeasured;
  if (p.status === "done" && !fillTimes && p.missingAssignees.length > 0) return "forceMissing";
  if (p.status !== "done" || fillTimes) return "force";
  if (p.undoable && p.hasUndoHandler) return "undo";
  return "close";
}

/**
 * 스냅샷 속 사람이 이 조직 사람인지(점검 A1(b)) — 서버가 되돌리기 전에 본다. DB 트리거가 작업자의 위조 쓰기를 막지만,
 * 서비스 키로 그대로 복원하는 길이라 앱에서도 한 번 더 막는다.
 * - 지금 기록의 `completed_by_admin` 은 이 조직의 강제 완료 권한자여야 한다.
 * - 되살릴 담당자(`staff_user_id`)는 이 조직 구성원, 되살릴 이전 관리자 표시는 비었거나 강제 완료 권한자여야 한다.
 */
export function forceCompleteUndoActorsOk(
  rowCompletedByAdmin: string,
  snapshot: ForceCompleteSnapshot,
  memberIds: ReadonlySet<string>,
  forceCompleterIds: ReadonlySet<string>,
): boolean {
  if (!forceCompleterIds.has(rowCompletedByAdmin)) return false;
  if (snapshot.created) return true;
  if (!memberIds.has(snapshot.staff_user_id)) return false;
  return snapshot.completed_by_admin === null || forceCompleterIds.has(snapshot.completed_by_admin);
}

/** 강제 완료 토스트에 「실행 취소」를 붙일지 — 그 기록이 **누르는 지금** 도쿄 오늘일 때만(점검 C1 · C2). 지난 날짜 화면 · 자정 넘김은 붙이지 않는다. */
export function offerForceCompleteUndo(cleaningDate: string, now: number): boolean {
  return cleaningDate === tokyoDateOf(new Date(now).toISOString());
}

export type ForceCompleteUndoPlan =
  | { kind: "delete" }
  | {
      kind: "restore";
      fields: ForceCompletePrevRow & { admin_complete_snapshot: null };
    };

export function forceCompleteUndoPlan(snapshot: ForceCompleteSnapshot): ForceCompleteUndoPlan {
  if (snapshot.created) return { kind: "delete" };
  return {
    kind: "restore",
    fields: {
      status: snapshot.status,
      staff_user_id: snapshot.staff_user_id,
      started_at: snapshot.started_at,
      completed_at: snapshot.completed_at,
      duration_seconds: snapshot.duration_seconds,
      notes: snapshot.notes,
      completed_by_admin: snapshot.completed_by_admin,
      admin_complete_snapshot: null,
    },
  };
}

/** 강제 완료 입력 모양(`ForceCompleteCleaningInput`) — 취소 토스트의 「실행 취소」가 같은 값으로 다시 완료한다. */
export type ForceCompleteRedoInput = {
  sessionId: string | null;
  sessionRoomLabel: string;
  taskType: CleaningTaskType;
  staffId: string;
  start: string;
  end: string;
  note: string;
  cleaningDate: string;
  /** 다시 완료는 취소 직후 그대로일 때만(2차 점검 1) — 되살린 줄의 `updated_at`, 지운 기록이면 null(새로 만듦). */
  expectedUpdatedAt?: string | null;
};

function tokyoHhmm(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    // hour12:false 만 두면 어떤 환경에선 자정이 「24:00」로 나온다 — 0~23 으로 고정(점검 C3).
    hourCycle: "h23",
  }).format(new Date(iso));
}

function taskTypeOf(taskLabel: string): CleaningTaskType {
  if (taskLabel === "long_stay") return "longstay";
  if (taskLabel === "simple") return "simple";
  return "checkout";
}

export function forceCompleteRedoInput(
  row: {
    id: string;
    room_label: string;
    task_label: string;
    staff_user_id: string;
    started_at: string;
    completed_at: string | null;
    notes: string | null;
    cleaning_date: string;
  },
  deleted: boolean,
  restoredUpdatedAt: string | null,
): ForceCompleteRedoInput {
  return {
    // 지운 기록은 같은 id 로 되살릴 수 없다 — 새로 만든다(처음 강제 완료와 같은 길).
    sessionId: deleted ? null : row.id,
    sessionRoomLabel: row.room_label,
    taskType: taskTypeOf(row.task_label),
    staffId: row.staff_user_id,
    start: tokyoHhmm(row.started_at),
    end: tokyoHhmm(row.completed_at ?? row.started_at),
    note: row.notes ?? "",
    cleaningDate: row.cleaning_date,
    expectedUpdatedAt: deleted ? null : restoredUpdatedAt,
  };
}

/** 되돌리기 쓰기가 DB 에 막힌 까닭 — busy: 그 담당자가 지금 다른 방을 청소 중 · changed: 방이 처리 끝 · 다 참. */
export function undoRestoreFailure(error: { code?: string; message?: string; details?: string | null }): "busy" | "changed" | "error" {
  const kind = roomWriteErrorKind(error);
  if (kind === "active") return "busy";
  if (kind === "resolved" || kind === "taken") return "changed";
  return "error";
}
