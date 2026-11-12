/**
 * 예약 내부 메모 저장 규칙 — **순수 모듈** (2026-11-12 예약 캘린더 점검).
 *
 * 예전엔 칸을 떠날 때마다(안 바꿔도) 저장했고, 서버는 버전 확인 없이 덮어썼다. 그래서
 * ① 다른 사람이 그사이 쓴 메모를 내 낡은 화면 값으로 지우거나 덮었고, ② 빈 칸으로 떠나면 남의 메모가 사라졌다.
 *
 * 이제:
 * - 화면은 **마지막으로 본 서버 값과 다를 때만** 저장한다(`isNoteChanged`).
 * - 화면은 마지막으로 본 `updated_at`(없던 메모면 `null`)을 같이 보낸다. 서버는 그 값이 그대로일 때만
 *   고치거나 지운다(조건부 update · delete), 없던 메모는 아직 없을 때만 만든다(insert, 겹치면 23505).
 *   하나도 안 바뀌면 `conflict` — 화면은 최신 값을 보여 주고 덮어쓰지 않는다.
 */

export const RESERVATION_INTERNAL_NOTE_MAX_LENGTH = 2000;

export type ReservationNoteSnapshot = { note: string; updatedAt: string | null };

export type ReservationNoteWritePlan = "noop" | "insert" | "update" | "delete";

export type ReservationNoteErrorCode =
  | "conflict"
  | "forbidden"
  | "invalid_note"
  | "invalid_reservation_id"
  | "note_too_long"
  | "reservation_not_found"
  | "save_failed";

export function normalizeNote(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 지금 칸의 값이 마지막으로 본 서버 값과 다른가 — 같으면 저장하지 않는다(앞뒤 공백만 다른 것도 같다). */
export function isNoteChanged(draft: string, server: ReservationNoteSnapshot | null | undefined): boolean {
  return normalizeNote(draft) !== normalizeNote(server?.note ?? "");
}

/** 서버가 할 일 — 보낸 값(다듬은 뒤)과 화면이 본 버전으로 정한다. */
export function planReservationNoteWrite(input: { note: string; expectedUpdatedAt: string | null }): ReservationNoteWritePlan {
  const note = normalizeNote(input.note);
  if (input.expectedUpdatedAt === null) return note ? "insert" : "noop";
  return note ? "update" : "delete";
}

/** 입력 검사 — 문자열 · 길이. 통과하면 다듬은 값. */
export function validateNoteInput(
  raw: unknown,
): { ok: true; note: string } | { ok: false; error: "invalid_note" | "note_too_long" } {
  if (typeof raw !== "string") return { ok: false, error: "invalid_note" };
  const note = raw.trim();
  if (note.length > RESERVATION_INTERNAL_NOTE_MAX_LENGTH) return { ok: false, error: "note_too_long" };
  return { ok: true, note };
}

/** 버전 값 검사 — `null` 이거나 ISO 시각 문자열(길이 제한). 아니면 `undefined`(잘못된 입력). */
export function validateExpectedUpdatedAt(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length > 64 || Number.isNaN(Date.parse(raw))) return undefined;
  return raw;
}

/** DB 오류 코드 → 화면 코드. RLS 거절(42501)은 권한 없음, 고유 키 충돌(23505)은 누가 먼저 만든 것. */
export function classifyNoteDbError(code: string | null | undefined): "conflict" | "forbidden" | "save_failed" {
  if (code === "42501") return "forbidden";
  if (code === "23505") return "conflict";
  return "save_failed";
}

/**
 * 서버에서 새로 받은 메모 묶음과 화면에서 고치던 칸을 합친다 — **고치던 칸(dirty)은 그대로**, 나머지는 서버 값.
 * `drafts` 에서 서버 값과 같아진 칸은 지운다(저장이 끝났거나 다른 사람이 같은 값으로 바꾼 경우).
 */
export function reconcileNoteDrafts(
  drafts: Readonly<Record<string, string>>,
  server: Readonly<Record<string, ReservationNoteSnapshot>>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [id, draft] of Object.entries(drafts)) {
    if (isNoteChanged(draft, server[id])) next[id] = draft;
  }
  return next;
}

/** 이 화면이 저장(또는 충돌로 받은) 최신 값. 지운 메모는 `updatedAt: null` + 지우기 전 버전(`supersedes`). */
export type SavedNoteSnapshot = ReservationNoteSnapshot & { supersedes?: string | null };

/**
 * 서버에서 다시 읽은 값(props)과 이 화면이 방금 저장한 값 중 **더 새것**을 고른다.
 * 저장 직후 늦게 도착한 옛 읽기(라이브 새로고침)가 방금 저장한 메모를 옛 값으로 되돌리지 않게.
 * 버전 문자열은 PostgREST 가 늘 같은 모양으로 주므로 문자열 비교로 순서를 본다.
 */
export function pickLatestNote(
  fromServer: ReservationNoteSnapshot | undefined,
  saved: SavedNoteSnapshot | undefined,
): ReservationNoteSnapshot {
  const empty = { note: "", updatedAt: null };
  if (!saved) return fromServer ?? empty;
  if (saved.updatedAt !== null) {
    if (fromServer?.updatedAt && fromServer.updatedAt >= saved.updatedAt) return fromServer;
    return { note: saved.note, updatedAt: saved.updatedAt };
  }
  // 이 화면이 지운 메모 — 그 뒤에 누가 새로 쓴 값만 이긴다.
  if (fromServer?.updatedAt && saved.supersedes && fromServer.updatedAt > saved.supersedes) return fromServer;
  return empty;
}

/**
 * 새 서버 묶음(props)이 오면 이 화면이 저장해 둔 값을 정리한다 — **서버가 정답**(삭제 포함, 2026-11-12 리뷰).
 * 저장 결과를 받은 **뒤에** 온 묶음에서만 부른다(저장 값은 결과를 받을 때만 들어간다).
 * 남기는 건 서버 값이 저장 값보다 **분명히 옛것**일 때뿐(저장 전에 출발한 읽기가 늦게 온 경우). 서버에 없으면(남이 지움) 버린다.
 */
export function pruneSavedNotes(
  saved: Readonly<Record<string, SavedNoteSnapshot>>,
  fresh: Readonly<Record<string, ReservationNoteSnapshot>>,
): Record<string, SavedNoteSnapshot> {
  const next: Record<string, SavedNoteSnapshot> = {};
  for (const [id, entry] of Object.entries(saved)) {
    const server = fresh[id];
    const serverIsOlder =
      entry.updatedAt !== null && server?.updatedAt != null && server.updatedAt < entry.updatedAt;
    const staleBeforeDelete =
      entry.updatedAt === null && server?.updatedAt != null && entry.supersedes != null && server.updatedAt <= entry.supersedes;
    if (serverIsOlder || staleBeforeDelete) next[id] = entry;
  }
  return next;
}

/**
 * 충돌로 돌아왔는데 서버의 최신 값이 **내가 보낸 값과 같으면** 성공으로 본다 — 같은 저장이 두 번 나갔거나(첫 번째가 이미 반영)
 * 다른 사람이 같은 내용으로 바꾼 경우. 내 글을 「충돌」로 보여 주지 않는다.
 */
export function resolveNoteConflict(
  draft: string,
  current: ReservationNoteSnapshot,
): { kind: "same"; snapshot: ReservationNoteSnapshot } | { kind: "conflict" } {
  return normalizeNote(current.note) === normalizeNote(draft) ? { kind: "same", snapshot: current } : { kind: "conflict" };
}

/**
 * 칸별 저장 진행 표시 — 렌더와 상관없이 **바로** 바뀌는 값(2026-11-12 리뷰: 상태로 「저장 중」을 표시하면 전환(transition)에 밀려
 * 다음 닫기가 같은 버전으로 두 번째 요청을 보내 내 글이 충돌이 됐다). 화면 표시는 상태(`noteStatus`), 중복 막기는 이것.
 */
export class NoteSaveTracker {
  private readonly inflight = new Set<string>();
  private readonly queued = new Set<string>();
  private readonly drafts = new Map<string, string>();

  /** 보내기 시작 — 이미 보내는 중이면 `false`(그때는 `queue`). */
  begin(id: string): boolean {
    if (this.inflight.has(id)) return false;
    this.inflight.add(id);
    return true;
  }
  end(id: string): void {
    this.inflight.delete(id);
  }
  isInflight(id: string): boolean {
    return this.inflight.has(id);
  }
  /** 보내는 중에 또 저장하라고 함 — 끝난 뒤 첫 결과의 새 버전으로 한 번 더. */
  queue(id: string): void {
    this.queued.add(id);
  }
  takeQueued(id: string): boolean {
    return this.queued.delete(id);
  }
  /** 가장 최근에 친 값 — 저장 중에 더 쓴 글을 다음 저장이 놓치지 않게. */
  setDraft(id: string, value: string): void {
    this.drafts.set(id, value);
  }
  draft(id: string): string | undefined {
    return this.drafts.get(id);
  }
  clearDraftIf(id: string, value: string): void {
    const current = this.drafts.get(id);
    if (current !== undefined && normalizeNote(current) === normalizeNote(value)) this.drafts.delete(id);
  }
}
