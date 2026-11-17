/**
 * 손님 메시지 실시간 — 신호 → 열쇠, 받은 항목 합치기(순수, 2026-11-13). docs/product/47-guest-messaging.md §5-9
 *
 * 신호(Supabase realtime)의 행에서는 **id 만** 꺼낸다(대화 · 메시지의 대화 · 큐의 대화 · 실행 줄 · 예약 번호). 그린 값은 언제나
 * 권한 검사를 통과한 서버 액션 결과다 — 여기서는 그 결과를 지금 화면 상태에 합칠 뿐이다.
 */

import {
  UUID_RE,
  sortInboxRows,
  type InboxConversationRow,
  type InboxListData,
  type InboxMessage,
  type InboxThread,
} from "@/lib/guest-messages/inbox-model";
import type { AutoRunView } from "@/lib/guest-messages/auto-model";
import type { LiveChange } from "@/lib/live-sources";

// ── 신호 → 열쇠 ──────────────────────────────────────────────────────────────

/** 목록 줄이 바뀌었을 수 있는 대화. */
export const listKey = (conversationId: string) => `c:${conversationId}`;
/** 열린 대화 화면이 다시 읽어야 할 대화. */
export const threadKey = (conversationId: string) => `t:${conversationId}`;
/** 자동 안내 실행 줄의 예약 번호(대화가 생기기 전에 계획된 줄은 대화 id 가 없다). */
export const bookingKey = (providerBookingId: string) => `b:${providerBookingId}`;
/** 자동 안내 실행 줄. */
export const runKey = (runId: string) => `r:${runId}`;

const BOOKING_ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;

function uuidOf(record: Record<string, unknown>, column: string): string | null {
  const value = record[column];
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

/**
 * 신호 하나 → 열쇠들. 행의 다른 칸(본문 · 이름 등)은 읽지 않는다.
 * - 메시지 `UPDATE`(사진 사본 · 되돌아옴 잇기)는 목록 줄을 바꾸지 않는다 — 대화 화면 열쇠만(과거 사진 복사의 홍수가 목록을 두드리지 않게).
 * - 삭제는 오지 않는다(replica identity 기본값) — 지워진 항목은 따라잡기 · 다시 읽기에서 빠진다.
 */
export function liveKeysOf(change: LiveChange): string[] {
  const { table, eventType, record } = change;
  if (eventType === "DELETE") return [];
  switch (table) {
    case "guest_conversations": {
      const id = uuidOf(record, "id");
      return id ? [listKey(id), threadKey(id)] : [];
    }
    case "guest_messages": {
      const id = uuidOf(record, "conversation_id");
      if (!id) return [];
      return eventType === "INSERT" ? [listKey(id), threadKey(id)] : [threadKey(id)];
    }
    case "guest_message_outbox": {
      const id = uuidOf(record, "conversation_id");
      return id ? [listKey(id), threadKey(id)] : [];
    }
    case "auto_message_runs": {
      const keys: string[] = [];
      const id = uuidOf(record, "id");
      if (id) keys.push(runKey(id));
      const conversationId = uuidOf(record, "conversation_id");
      if (conversationId) keys.push(threadKey(conversationId));
      const booking = record.provider_booking_id;
      if (typeof booking === "string" && BOOKING_ID_RE.test(booking)) keys.push(bookingKey(booking));
      return keys;
    }
    default:
      return [];
  }
}

/** 열쇠 묶음에서 한 종류의 id 만. */
export function idsOfKind(keys: readonly string[], kind: "c" | "t" | "b" | "r"): string[] {
  const prefix = `${kind}:`;
  return [...new Set(keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)))];
}

/** 열린 대화가 다시 읽어야 하나 — 그 대화의 열쇠 또는 그 예약의 자동 안내 줄. */
export function touchesThread(keys: readonly string[], conversationId: string, providerBookingId: string | null): boolean {
  const id = conversationId.toLowerCase();
  return keys.some((key) => key === threadKey(id) || (providerBookingId !== null && key === bookingKey(providerBookingId)));
}

// ── 목록 합치기 ──────────────────────────────────────────────────────────────

/** 서버가 다시 읽은 줄 하나 — `matches` = 지금 보는 필터(상태 · 건물 · 채널)에 드는지(서버가 판정). */
export type InboxRowUpdate = { row: InboxConversationRow; matches: boolean };

export type InboxMerge = {
  /** 정렬된 줄. 빠지는 줄(`left`)은 접히는 동안 **예전 값 그대로** 남아 있다 — 다 접힌 뒤 `dropRows` 로 뺀다. */
  rows: InboxConversationRow[];
  /** 새로 나타난 줄(살짝 나타나기). */
  entered: string[];
  /** 필터에서 빠지거나 없어진 줄(`.row-collapse` 로 접기). */
  left: string[];
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 바뀐 것이 없으면 예전 객체를 그대로 — 다시 그리지 않게. */
function keepIfSame<T>(prev: T | undefined, next: T): T {
  return prev !== undefined && same(prev, next) ? prev : next;
}

/** 몇 줄만 다시 읽었을 때 — 들어오는 줄은 넣고 · 바뀐 줄은 고치고 · 필터에서 빠진 줄과 없어진 줄은 접는다. */
export function mergeInboxRows(
  current: readonly InboxConversationRow[],
  updates: readonly InboxRowUpdate[],
  missingIds: readonly string[] = [],
): InboxMerge {
  const byId = new Map(current.map((row) => [row.id, row]));
  const entered: string[] = [];
  const left = new Set<string>();
  for (const { row, matches } of updates) {
    const prev = byId.get(row.id);
    if (matches) {
      if (!prev) entered.push(row.id);
      byId.set(row.id, keepIfSame(prev, row));
    } else if (prev) {
      left.add(row.id);
    }
  }
  for (const id of missingIds) if (byId.has(id)) left.add(id);
  return { rows: sortInboxRows([...byId.values()]), entered, left: [...left] };
}

/** 목록 전체를 다시 읽었을 때(따라잡기) — 그대로인 줄은 같은 객체, 없어진 줄은 접는다. */
export function replaceInboxRows(current: readonly InboxConversationRow[], next: readonly InboxConversationRow[]): InboxMerge {
  const prevById = new Map(current.map((row) => [row.id, row]));
  const nextIds = new Set(next.map((row) => row.id));
  const entered = next.filter((row) => !prevById.has(row.id)).map((row) => row.id);
  const left = current.filter((row) => !nextIds.has(row.id)).map((row) => row.id);
  const rows = [...next.map((row) => keepIfSame(prevById.get(row.id), row)), ...current.filter((row) => !nextIds.has(row.id))];
  return { rows: sortInboxRows(rows), entered, left };
}

export function dropRows(rows: readonly InboxConversationRow[], ids: ReadonlySet<string>): InboxConversationRow[] {
  return rows.filter((row) => !ids.has(row.id));
}

// ── 대화 합치기 ──────────────────────────────────────────────────────────────

/** 사진이 「같은 사진 · 같은 상태」인가 — 서명 URL 은 읽을 때마다 새로 나와서 비교에서 뺀다(그대로 두면 다시 받느라 깜빡인다). */
function sameImages(a: InboxMessage["images"], b: InboxMessage["images"]): boolean {
  if (a.length !== b.length) return false;
  return a.every((image, index) => {
    const other = b[index];
    return image.sourceUrl === other.sourceUrl && image.stored === other.stored && image.unavailable === other.unavailable;
  });
}

function mergeMessage(prev: InboxMessage | undefined, next: InboxMessage): InboxMessage {
  if (!prev) return next;
  const candidate = sameImages(prev.images, next.images) ? { ...next, images: prev.images } : next;
  return keepIfSame(prev, candidate);
}

/**
 * 조용히 다시 읽은 대화를 지금 것에 합친다 — 그대로인 말 · 예약 · 자동 안내 · 업무 줄은 같은 객체(입력 · 열린 칸 · 사진이 흔들리지 않게).
 * 다른 대화면 새 것을 그대로. 바뀐 것이 하나도 없으면 `prev` 그대로.
 */
export function mergeThread(prev: InboxThread | null, next: InboxThread): InboxThread {
  if (!prev || prev.conversation.id !== next.conversation.id) return next;
  const prevMessages = new Map(prev.messages.map((message) => [message.id, message]));
  const messages = next.messages.map((message) => mergeMessage(prevMessages.get(message.id), message));
  const sameMessages = messages.length === prev.messages.length && messages.every((message, index) => message === prev.messages[index]);
  const merged: InboxThread = {
    conversation: keepIfSame(prev.conversation, next.conversation),
    messages: sameMessages ? prev.messages : messages,
    reservation: keepIfSame(prev.reservation, next.reservation),
    sendEnabled: next.sendEnabled,
    autoRuns: keepIfSame(prev.autoRuns, next.autoRuns),
    links: keepIfSame(prev.links, next.links),
    resolvedDraft: keepIfSame(prev.resolvedDraft, next.resolvedDraft),
  };
  const unchanged =
    merged.conversation === prev.conversation &&
    merged.messages === prev.messages &&
    merged.reservation === prev.reservation &&
    merged.sendEnabled === prev.sendEnabled &&
    merged.autoRuns === prev.autoRuns &&
    merged.links === prev.links &&
    merged.resolvedDraft === prev.resolvedDraft;
  return unchanged ? prev : merged;
}

/** 아래에 새로 붙은 말 수(보던 말 다음) — 「새 메시지」 단추 숫자. 내부 메모 · 시스템 줄은 세지 않는다. */
export function countAppended(prevIds: ReadonlySet<string>, next: readonly InboxMessage[]): number {
  return next.filter((message) => !prevIds.has(message.id) && (message.direction === "guest" || message.direction === "host")).length;
}

// ── 자동 안내 「보낼 예정」 합치기 ────────────────────────────────────────────

const UPCOMING_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 300;

/** 「보낼 예정」 목록에 드는 줄인가 — 서버 `loadUpcomingAutoRuns` 와 같은 조건(취소 아님 · 지난 하루 이후 · 고른 규칙). */
export function inUpcoming(run: AutoRunView, ruleId: string | null, now: Date): boolean {
  if (run.status === "cancelled") return false;
  if (ruleId && run.ruleId !== ruleId) return false;
  const at = Date.parse(run.scheduledAt);
  return !Number.isNaN(at) && at >= now.getTime() - UPCOMING_LOOKBACK_MS;
}

function compareRuns(a: AutoRunView, b: AutoRunView): number {
  const byTime = Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);
  if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 다시 읽은 실행 줄을 「보낼 예정」에 합친다 — 그 자리에서 상태를 고치고, 새로 든 줄은 시각 순 자리에, 빠진 줄 · 없어진 줄은 뺀다. */
export function mergeAutoRuns(
  current: readonly AutoRunView[],
  updates: readonly AutoRunView[],
  missingIds: readonly string[],
  options: { ruleId: string | null; now: Date },
): AutoRunView[] {
  const byId = new Map(current.map((run) => [run.id, run]));
  let changed = false;
  for (const run of updates) {
    const prev = byId.get(run.id);
    if (inUpcoming(run, options.ruleId, options.now)) {
      const next = keepIfSame(prev, run);
      if (next !== prev) {
        byId.set(run.id, next);
        changed = true;
      }
    } else if (prev) {
      byId.delete(run.id);
      changed = true;
    }
  }
  for (const id of missingIds) {
    if (byId.delete(id)) changed = true;
  }
  if (!changed) return current as AutoRunView[];
  return [...byId.values()].sort(compareRuns).slice(0, UPCOMING_LIMIT);
}

/** 규칙 목록의 숫자만(다음 발송 · 보낼 예정 · 막힘) 새 값으로 — 이름 · 글 · 켜기는 화면이 들고 있는 값 그대로(고치는 중인 글을 덮지 않게). */
export function mergeRuleCounts<T extends { id: string; nextSendAt: string | null; scheduledCount: number; blockedCount: number }>(
  current: readonly T[],
  fresh: readonly Pick<T, "id" | "nextSendAt" | "scheduledCount" | "blockedCount">[],
): T[] {
  const byId = new Map(fresh.map((rule) => [rule.id, rule]));
  let changed = false;
  const next = current.map((rule) => {
    const latest = byId.get(rule.id);
    if (
      !latest ||
      (latest.nextSendAt === rule.nextSendAt && latest.scheduledCount === rule.scheduledCount && latest.blockedCount === rule.blockedCount)
    )
      return rule;
    changed = true;
    return { ...rule, nextSendAt: latest.nextSendAt, scheduledCount: latest.scheduledCount, blockedCount: latest.blockedCount };
  });
  return changed ? next : (current as T[]);
}

// ── 목록 상태 한 곳(리듀서) — 순서 · 접힘 · 나타남을 순수하게 (2026-11-13 리뷰 반영) ─────────────────────

/**
 * 응답이 뒤섞여 와도 새 값이 옛 값에 덮이지 않게 **대화 id 마다** 요청 번호를 들고 있다.
 * - 줄 다시 읽기(`claim` → `rows`): 보낼 때 그 id 들의 번호를 가져가고, 응답은 **아직 그 번호를 가진 id** 만 합친다
 *   (`applyIds([B])` 가 진행 중인 `applyIds([A])` 를 버리지 않는다).
 * - 목록 통째 읽기(`replace` — 따라잡기 · 서버가 새 목록을 줌): 더 나중에 보낸 줄 읽기가 가진 id 는 지금 값을 둔다.
 *   통째 읽기끼리는 마지막 것만(`replaceSeq`).
 * - 접힘(`leaving`): 필터에서 빠지면 넣고, 다시 들어오면(목록에 다시 · `matches`) 바로 뺀다. 빼는 시각은 화면이 정한다(`drop`).
 */
export type InboxLiveState = {
  list: InboxListData | null;
  leaving: ReadonlySet<string>;
  entered: ReadonlySet<string>;
  seqs: ReadonlyMap<string, number>;
  countsSeq: number;
  replaceSeq: number;
};

export type InboxRowsPayload = {
  updates: readonly InboxRowUpdate[];
  missing: readonly string[];
  awaitingCount: number;
};

export type InboxLiveAction =
  | { type: "claim"; ids: readonly string[]; seq: number }
  | { type: "rows"; seq: number; result: InboxRowsPayload }
  | { type: "replace"; seq: number; data: InboxListData }
  | { type: "drop"; ids: readonly string[] }
  | { type: "settleEntered"; ids: readonly string[] };

const EMPTY_SET: ReadonlySet<string> = new Set();

export function initialInboxLive(data: InboxListData | null): InboxLiveState {
  return { list: data, leaving: EMPTY_SET, entered: EMPTY_SET, seqs: new Map(), countsSeq: 0, replaceSeq: 0 };
}

function withAll(set: ReadonlySet<string>, add: readonly string[], remove: Iterable<string> = []): ReadonlySet<string> {
  const next = new Set(set);
  for (const id of add) next.add(id);
  for (const id of remove) next.delete(id);
  if (next.size === set.size && [...next].every((id) => set.has(id))) return set;
  return next;
}

export function inboxLiveReducer(state: InboxLiveState, action: InboxLiveAction): InboxLiveState {
  switch (action.type) {
    case "claim": {
      const seqs = new Map(state.seqs);
      for (const id of action.ids) seqs.set(id, action.seq);
      return { ...state, seqs };
    }
    case "rows": {
      if (!state.list) return state;
      const owns = (id: string) => state.seqs.get(id) === action.seq;
      const updates = action.result.updates.filter((update) => owns(update.row.id));
      const missing = action.result.missing.filter(owns);
      const merge = mergeInboxRows(state.list.rows, updates, missing);
      const back = updates.filter((update) => update.matches).map((update) => update.row.id);
      const counts = action.seq > state.countsSeq;
      return {
        ...state,
        list: {
          ...state.list,
          rows: merge.rows,
          awaitingCount: counts ? action.result.awaitingCount : state.list.awaitingCount,
        },
        leaving: withAll(state.leaving, merge.left, back),
        entered: withAll(state.entered, merge.entered),
        countsSeq: counts ? action.seq : state.countsSeq,
      };
    }
    case "replace": {
      if (action.seq < state.replaceSeq) return state;
      const data = action.data;
      if (!state.list) {
        const seqs = new Map(state.seqs);
        for (const row of data.rows) if ((seqs.get(row.id) ?? 0) < action.seq) seqs.set(row.id, action.seq);
        return { ...state, list: data, seqs, countsSeq: Math.max(state.countsSeq, action.seq), replaceSeq: action.seq };
      }
      // 이 통째 읽기보다 나중에 보낸 줄 읽기가 가진 id — 지금 값을 둔다(빠짐 · 들어옴도 그쪽 응답이 정한다).
      const newer = new Set([...state.seqs].filter(([, seq]) => seq > action.seq).map(([id]) => id));
      const current = state.list.rows;
      const nextRows = [
        ...data.rows.filter((row) => !newer.has(row.id)),
        ...current.filter((row) => newer.has(row.id)),
      ];
      const merge = replaceInboxRows(current, nextRows);
      const seqs = new Map(state.seqs);
      for (const id of [...data.rows.map((row) => row.id), ...merge.left]) if (!newer.has(id)) seqs.set(id, action.seq);
      const counts = action.seq > state.countsSeq;
      return {
        list: {
          rows: merge.rows,
          buildings: data.buildings,
          awaitingCount: counts ? data.awaitingCount : state.list.awaitingCount,
        },
        leaving: withAll(state.leaving, merge.left, data.rows.filter((row) => !newer.has(row.id)).map((row) => row.id)),
        entered: withAll(state.entered, merge.entered),
        seqs,
        countsSeq: counts ? action.seq : state.countsSeq,
        replaceSeq: action.seq,
      };
    }
    case "drop": {
      // 그사이 다시 들어온 줄(접힘에서 빠짐)은 남긴다.
      const gone = new Set(action.ids.filter((id) => state.leaving.has(id)));
      if (gone.size === 0 || !state.list) return state;
      return {
        ...state,
        list: { ...state.list, rows: dropRows(state.list.rows, gone) },
        leaving: withAll(state.leaving, [], gone),
      };
    }
    case "settleEntered": {
      const entered = withAll(state.entered, [], action.ids);
      return entered === state.entered ? state : { ...state, entered };
    }
  }
}

/**
 * 화면이 먼저 접어 둔 줄(내 처리 끝 · 나중에 · 칸의 postMessage) — 서버 답을 기다리는 동안 접힌 채 둔다.
 * 다른 줄의 실시간 합치기로는 펴지 않고, **그 줄이 목록에서 빠졌을 때만** 표시를 지운다(실패 · 되돌리기는 화면이 직접 지운다).
 * 바뀐 것이 없으면 같은 Set.
 */
export function pruneLocalLeaving(leaving: ReadonlySet<string>, rows: readonly { id: string }[]): ReadonlySet<string> {
  if (leaving.size === 0) return leaving;
  const present = new Set(rows.map((row) => row.id));
  const kept = [...leaving].filter((id) => present.has(id));
  return kept.length === leaving.size ? leaving : new Set(kept);
}

// ── 같은 열쇠 읽기 하나로 (대화 다시 읽기) ───────────────────────────────────

/**
 * 같은 열쇠의 읽기가 진행 중이면 새로 보내지 않고 그 약속을 같이 기다린다. 진행 중에 또 불리면 끝난 뒤 **한 번 더** 읽고,
 * 마지막 읽기만 `apply` 한다 — 그래서 기다리는 쪽(처리 끝의 전환)은 **최신 값이 반영된 뒤에** 끝난다.
 * `isCurrent(key)` 가 거짓이 되면(다른 대화로 옮김) 반영하지 않고 끝낸다. 읽기가 던지면 반영 없이 끝낸다(보던 값 그대로).
 */
export function createKeyedSingleFlight<K, T>(
  fetch: (key: K) => Promise<T>,
  apply: (key: K, result: T) => void,
  isCurrent: (key: K) => boolean,
): (key: K) => Promise<void> {
  let flight: { key: K; again: boolean; promise: Promise<void> } | null = null;
  return (key) => {
    if (flight && flight.key === key) {
      flight.again = true;
      return flight.promise;
    }
    const entry: { key: K; again: boolean; promise: Promise<void> } = { key, again: false, promise: Promise.resolve() };
    flight = entry;
    entry.promise = (async () => {
      try {
        do {
          entry.again = false;
          let result: T;
          try {
            result = await fetch(key);
          } catch {
            return;
          }
          if (!isCurrent(key)) return;
          if (!entry.again) apply(key, result);
        } while (entry.again);
      } finally {
        if (flight === entry) flight = null;
      }
    })();
    return entry.promise;
  };
}
