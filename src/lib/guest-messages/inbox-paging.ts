/**
 * 손님 메시지 목록 — 처리 끝 대화 더 불러오기(무한 스크롤, 2026-11-26). docs/product/47-guest-messaging.md §5 · §6-1
 *
 * - 처리 끝은 한 번에 `DONE_PAGE_SIZE`(200)개씩, **키셋 커서**(`last_message_at desc nulls last, id asc`)로 다음 묶음을 읽는다 — offset 없음.
 * - 커서 = 이미 받은 처리 끝 줄 중 **마지막 줄의 열쇠**(`시각|id`, 시각이 없으면 `|id`). 시각은 DB 문자열 그대로(마이크로초까지).
 * - 건물 · 채널 필터는 SQL 에서 건다(한 묶음이 꽉 차고 맞게). 상태 탭이 처리 끝을 빼면(답장 기다림 · 나중에) 읽지 않는다.
 * - PostgREST `.or()` 식은 한 번만 붙인다 — 커서 · 「그 밖」 채널이 함께면 `and(or(…),or(…))` 하나로 묶는다.
 *
 * 서버 import 없음 — 화면도 커서 모양을 같이 쓴다.
 */

import { UUID_RE, type InboxChannelFilter, type InboxStatusFilter } from "@/lib/guest-messages/inbox-model";

export const DONE_PAGE_SIZE = 200;
/** 따라잡기(목록 다시 읽기)에서 이미 펼친 처리 끝을 다시 읽을 때 상한 — 넘으면 거기서 자르고 「더 불러오기」로 잇는다. */
export const DONE_RELOAD_MAX = 1000;
export const DONE_CURSOR_MAX_LENGTH = 80;

export type DoneCursor = { lastMessageAt: string | null; id: string };

/** Postgres timestamptz 문자열(ISO · 공백 구분 · 소수 6자리 · Z 또는 ±hh[:mm]). 쉼표 · 괄호가 들어갈 수 없다(PostgREST 식에 그대로 싣는다). */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

export function encodeDoneCursor(row: { last_message_at: string | null; id: string }): string {
  return `${row.last_message_at ?? ""}|${row.id.toLowerCase()}`;
}

/** 화면에서 온 커서 — 모양이 틀리면 null(그때 액션은 `invalid`). */
export function parseDoneCursor(raw: unknown): DoneCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > DONE_CURSOR_MAX_LENGTH) return null;
  const sep = raw.lastIndexOf("|");
  if (sep < 0) return null;
  const at = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!UUID_RE.test(id)) return null;
  if (at === "") return { lastMessageAt: null, id: id.toLowerCase() };
  if (!TIMESTAMP_RE.test(at) || Number.isNaN(Date.parse(at.replace(" ", "T")))) return null;
  return { lastMessageAt: at, id: id.toLowerCase() };
}

/** 상태 탭이 처리 끝을 보여 주는가 — 아니면 처리 끝은 읽지도 펼치지도 않는다. */
export function statusIncludesDone(status: InboxStatusFilter): boolean {
  return status === "done" || status === "all";
}

/** 커서 **뒤**(목록 순서에서 다음) — 시각이 더 이르거나, 같은 시각에 id 가 크거나, 시각이 없는 줄(맨 뒤). */
export function afterCursorClauses(cursor: DoneCursor): string[] {
  if (cursor.lastMessageAt === null) return [`and(last_message_at.is.null,id.gt.${cursor.id})`];
  const at = cursor.lastMessageAt;
  return [`last_message_at.lt.${at}`, `and(last_message_at.eq.${at},id.gt.${cursor.id})`, "last_message_at.is.null"];
}

/** 커서 **까지**(커서 줄 포함) — 따라잡기에서 이미 펼친 범위를 다시 읽을 때. */
export function untilCursorClauses(cursor: DoneCursor): string[] {
  if (cursor.lastMessageAt === null) return ["last_message_at.not.is.null", `and(last_message_at.is.null,id.lte.${cursor.id})`];
  const at = cursor.lastMessageAt;
  return [`last_message_at.gt.${at}`, `and(last_message_at.eq.${at},id.lte.${cursor.id})`];
}

/** 채널 필터 → SQL. `{ eq }` 는 `.eq("channel")`, `{ clauses }` 는 `.or()` 식, null 은 필터 없음. `toChannelKey` · `matchesChannelFilter` 와 같은 판정. */
export function channelSql(filter: InboxChannelFilter): { eq: string } | { clauses: string[] } | null {
  if (filter === "all") return null;
  // 「그 밖」 = airbnb · booking · direct 가 아닌 모든 값과 빈 값(모르는 글자 · 대문자 등은 `toChannelKey` 에서 null → 그 밖).
  if (filter === "other") return { clauses: ["channel.is.null", "channel.not.in.(airbnb,booking,direct)"] };
  return { eq: filter };
}

/** OR 묶음 여러 개 → `.or()` 한 번에 넣을 식(묶음끼리는 AND). 묶음이 없으면 null. */
export function combineOrGroups(groups: ReadonlyArray<readonly string[]>): string | null {
  const used = groups.filter((group) => group.length > 0);
  if (used.length === 0) return null;
  if (used.length === 1) return used[0].join(",");
  return `and(${used.map((group) => (group.length === 1 ? group[0] : `or(${group.join(",")})`)).join(",")})`;
}

/**
 * 처리 끝 창 — 화면이 이미 받은 처리 끝의 범위. `hasMore` 가 거짓이면 처리 끝 전부를 받았다(커서와 상관없이 창 안).
 * 커서가 없고 `hasMore` 도 거짓이면 처리 끝이 하나도 없다(새로 생기는 처리 끝도 창 안).
 */
export type DoneWindow = { cursor: string | null; hasMore: boolean };
