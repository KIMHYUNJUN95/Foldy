/**
 * 손님 메시지함 검색 — 순수 규칙(검색어 다듬기 · DB 함수 인자 · 결과 다시 보기 · 미리보기 자르기). docs/product/47-guest-messaging.md §5-10
 *
 * DB 함수 `guest_conversation_search`(202611180001)가 그 조직의 대화 전체에서 넓게 찾고, 여기서 이름 · 전화번호를 기존 예약 검색과
 * 같은 판정(`matchesGuestName` · `matchesDigits`)으로 다시 본다. 서버 읽기는 `inbox-server.ts` `searchInbox`.
 */

import { MASKED_CODE, maskEntryCodes } from "@/lib/guest-messages/auto-model";
import { messagePlainText } from "@/lib/guest-messages/message-body";
import type { GuestMessageDirection } from "@/lib/guest-messages/types";
import {
  buildGuestSearchPlan,
  escapeLikePattern,
  matchesDigits,
  matchesGuestName,
  normalizeGuestText,
  phoneLikePattern,
} from "@/lib/guest-search";
import { CANONICAL_TO_BUILDING_KEY, getCanonicalPropertyName } from "@/lib/room-label-normalization";

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 60;
export const SEARCH_RESULT_LIMIT = 50;
/** DB 에서 조금 더 받는다 — 이름 · 전화번호 후보는 여기서 다시 보고 떨어질 수 있다. */
export const SEARCH_FETCH_LIMIT = 80;
/**
 * 공백 뺀 글자가 이보다 짧으면(= 2글자) 메시지 내용은 최근 `SHORT_QUERY_BODY_DAYS` 일만 본다 — trigram 색인은 3글자부터라
 * 2글자는 메시지 전체를 읽는다(운영 12만 줄 약 2초 · 처음 12초 → 90일이면 0.8초). 이름 · 예약번호 · 건물 · 전화 · 이메일은 전체 기간.
 */
export const BODY_FULL_RANGE_MIN_CHARS = 3;
export const SHORT_QUERY_BODY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 메시지 내용을 볼 시작 시각 — 2글자 검색어면 `now` 90일 전, 아니면 null(전체 기간). */
export function bodySinceFor(query: string, now: Date): string | null {
  if (Array.from(query.replace(/\s/g, "")).length >= BODY_FULL_RANGE_MIN_CHARS) return null;
  return new Date(now.getTime() - SHORT_QUERY_BODY_DAYS * DAY_MS).toISOString();
}

/** 코드 값을 못 읽었을 때 가리는 모양 — 목록 미리보기(`maskAllCodeLike`)와 같다. */
export const CODE_LIKE_SOURCE = "[0-9#*]{3,}";

export type InboxSearchHit = "name" | "booking" | "place" | "phone" | "email" | "message";
export const INBOX_SEARCH_HITS: readonly InboxSearchHit[] = ["name", "booking", "place", "phone", "email", "message"];

export type InboxSearchMatch = {
  hits: InboxSearchHit[];
  /** 내용으로 맞았을 때 그 메시지 앞뒤를 자른 글(코드를 볼 수 없으면 손님 말 · 우리 답장 모두 코드를 가린 뒤). */
  snippet: { direction: GuestMessageDirection; text: string } | null;
};

/** 검색어 다듬기 — 앞뒤 공백 · 겹친 공백 · 길이(60자). 2글자 미만이면 null(찾지 않음). */
export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const query = Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, SEARCH_MAX_CHARS).join("").trim();
  return Array.from(query.replace(/\s/g, "")).length >= SEARCH_MIN_CHARS ? query : null;
}

/**
 * 보는 사람 언어 이름(ja `荒木町A` · en `Arakicho A`)으로 친 건물 → 정본(ko) 이름. 저장은 ko 정본이라 그대로는 ilike 에 안 걸린다.
 * `labelSets` = 세 언어 `cleaning.buildingLabels`.
 */
export function placeNamesFor(query: string, labelSets: readonly Record<string, string>[]): string[] {
  const compact = (value: string) => normalizeGuestText(value).replace(/\s+/g, "");
  const needle = compact(query);
  if (Array.from(needle).length < SEARCH_MIN_CHARS) return [];
  const out = new Set<string>();
  const direct = getCanonicalPropertyName(query);
  if (CANONICAL_TO_BUILDING_KEY[direct]) out.add(direct);
  for (const [canonical, key] of Object.entries(CANONICAL_TO_BUILDING_KEY)) {
    if (labelSets.some((labels) => labels[key] && compact(labels[key]).includes(needle)) || compact(canonical).includes(needle)) {
      out.add(canonical);
    }
  }
  return [...out];
}

/**
 * 검색 대상 메시지(손님 말 · 우리 답장)에서 가릴 코드의 Postgres 정규식. 코드를 볼 수 있으면 null(가리지 않음), 코드 값을 못 읽었으면 숫자 · 기호 묶음 전체.
 * `maskEntryCodes` 와 같은 값(3자 이상)만 — 그래서 DB 의 「가린 글에서도 맞나」와 화면 미리보기가 같은 글을 본다.
 */
export function codeMaskPattern(canSeeCodes: boolean, codes: readonly string[] | null): string | null {
  if (canSeeCodes) return null;
  if (codes === null) return CODE_LIKE_SOURCE;
  const list = [...new Set(codes.map((code) => code.trim()).filter((code) => code.length >= 3))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return null;
  return list.map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

export function maskCodeText(text: string, canSeeCodes: boolean, codes: readonly string[] | null): string {
  if (canSeeCodes) return text;
  if (codes === null) return text.replace(new RegExp(CODE_LIKE_SOURCE, "g"), MASKED_CODE);
  return maskEntryCodes(text, codes);
}

/** 검색 칸이 들고 있는 마지막 답(결과 또는 실패). */
export type SearchAnswer<R> =
  | { query: string; status: "ready"; results: R[]; truncated: boolean; bodyRecentOnly: boolean }
  | { query: string; status: "error" };

/**
 * 지금 검색어 기준으로 그릴 것 — 그 검색어의 답(`current`), 답을 기다리는 중인지, 기다리는 동안 흐리게 둘 앞 결과(`stale`).
 */
export function searchViewState<R>(answer: SearchAnswer<R> | null, query: string | null) {
  const current = answer && query && answer.query === query ? answer : null;
  return {
    current,
    loading: query !== null && current === null,
    stale: query !== null && current === null && answer?.status === "ready" ? answer : null,
  };
}

/** 찾기 시작할 때 — 실패 답은 지워 바로 「찾는 중」으로(다시 시도). 결과는 새 답이 올 때까지 둔다(실시간 다시 찾기 · 흐린 앞 결과). */
export function answerOnRunStart<R>(answer: SearchAnswer<R> | null): SearchAnswer<R> | null {
  return answer?.status === "error" ? null : answer;
}

export type InboxSearchArgs = {
  p_like: string;
  p_name_fragments: string[];
  p_reference: string | null;
  p_phone_pattern: string | null;
  p_email: "full" | "local" | null;
  p_place_names: string[];
  p_body: boolean;
  p_body_since: string | null;
  p_code_mask: string | null;
};

/** 다듬은 검색어 → DB 함수 인자(조직 · 필터 · 개수는 부르는 쪽이 붙인다). `now` = 2글자 내용 검색 기간의 기준 시각. */
export function buildSearchArgs(
  query: string,
  options: { labelSets: readonly Record<string, string>[]; canSeeCodes: boolean; codes: readonly string[] | null; now: Date },
): InboxSearchArgs {
  const plan = buildGuestSearchPlan(query);
  const spaced = /\s/.test(query);
  return {
    p_like: `%${escapeLikePattern(query)}%`,
    p_name_fragments: plan?.nameFragments ?? [],
    p_reference: plan?.reference ?? null,
    p_phone_pattern: phoneLikePattern(plan?.digits ?? null),
    // @ 가 있으면 주소 전체, 없으면 @ 앞만 — 「airbnb」로 찾았을 때 중계 주소(…@guest.airbnb.com)가 모두 걸리지 않게.
    p_email: query.includes("@") ? "full" : !spaced && Array.from(query).length >= 3 ? "local" : null,
    p_place_names: placeNamesFor(query, options.labelSets),
    p_body: true,
    p_body_since: bodySinceFor(query, options.now),
    p_code_mask: codeMaskPattern(options.canSeeCodes, options.codes),
  };
}

export type SearchRpcRow = {
  conversation_id: string;
  last_message_at: string | null;
  guest_name: string | null;
  reservation_guest_name: string | null;
  name_hit: boolean;
  reference_hit: boolean;
  place_hit: boolean;
  phone: string | null;
  mobile: string | null;
  email_hit: boolean;
  body_message_id: string | null;
  body_direction: GuestMessageDirection | null;
  body: string | null;
};

const SNIPPET_BEFORE = 24;
const SNIPPET_LENGTH = 96;

/** 맞은 자리 앞뒤를 자른 한 줄 — 사진 · 링크는 글로 바꾸고(목록 미리보기와 같게) 공백은 하나로. */
export function snippetAround(body: string, query: string): string {
  const text = messagePlainText(body).text.replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  const lowered = text.toLowerCase();
  const at = lowered.indexOf(query.toLowerCase());
  const atChar = at < 0 ? 0 : Array.from(text.slice(0, at)).length;
  const start = Math.max(0, atChar - SNIPPET_BEFORE);
  const end = Math.min(chars.length, start + SNIPPET_LENGTH);
  return `${start > 0 ? "…" : ""}${chars.slice(start, end).join("").trim()}${end < chars.length ? "…" : ""}`;
}

/**
 * DB 후보 → 맞은 곳 목록. 이름 · 전화번호는 기존 예약 검색 판정으로 다시 보고, 맞은 곳이 하나도 안 남은 줄은 뺀다.
 * DB 순서(마지막 메시지 최신순)를 지키고 `limit` 개까지.
 */
export function pickSearchMatches(
  rows: readonly SearchRpcRow[],
  query: string,
  options: { canSeeCodes: boolean; codes: readonly string[] | null; limit?: number },
): Array<{ id: string; match: InboxSearchMatch }> {
  const out: Array<{ id: string; match: InboxSearchMatch }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.conversation_id)) continue;
    const hits: InboxSearchHit[] = [];
    if (row.name_hit && [row.guest_name, row.reservation_guest_name].some((name) => !!name && matchesGuestName(query, name))) hits.push("name");
    if (row.reference_hit) hits.push("booking");
    if (row.place_hit) hits.push("place");
    if (matchesDigits(query, row.phone) || matchesDigits(query, row.mobile)) hits.push("phone");
    if (row.email_hit) hits.push("email");
    let snippet: InboxSearchMatch["snippet"] = null;
    if (row.body_message_id && row.body !== null && (row.body_direction === "guest" || row.body_direction === "host")) {
      const shown = maskCodeText(row.body, options.canSeeCodes, options.codes);
      hits.push("message");
      snippet = { direction: row.body_direction, text: snippetAround(shown, query) };
    }
    if (hits.length === 0) continue;
    seen.add(row.conversation_id);
    out.push({ id: row.conversation_id, match: { hits, snippet } });
    if (out.length >= (options.limit ?? SEARCH_RESULT_LIMIT)) break;
  }
  return out;
}
