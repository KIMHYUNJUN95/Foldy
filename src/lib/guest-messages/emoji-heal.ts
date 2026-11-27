/**
 * 이모지가 「?」로 망가진 손님 메시지 본문 되살리기 — **순수**. docs/product/47-guest-messaging.md §4-0-3
 *
 * 2026-11-13 부터 Beds24 웹훅 본문의 메시지는 BMP 밖 글자(이모지 · 국기 · 피부색 등 UTF-8 4바이트)가 **글자 하나마다 「?」 하나**로
 * 바뀌어 온다(🙏🏻 → 「??」). 같은 메시지를 API(`GET /bookings/messages`)로 읽으면 이모지가 그대로다.
 *
 * 판정(`emojiMaskMatches`): API 본문에 BMP 밖 글자가 있고, 저장된 본문과 다르며, API 본문의 BMP 밖 글자를 「?」 하나씩으로 바꾸면
 * 저장된 본문과 **정확히** 같을 때만 망가진 것으로 본다. 그 밖의 글자는 하나라도 다르면 아니다 — 손님이 정말 쓴 「??」는 API 도
 * 「??」라 절대 바꾸지 않는다. 너그러움은 하나만: 이모지 사이에 붙는 BMP 보이지 않는 글자(ZWJ U+200D · 변형 선택자 U+FE0E/U+FE0F ·
 * 키캡 U+20E3)는 그대로 남거나 · 「?」가 되거나 · 빠져도 맞는 것으로 본다(Beds24 가 이 글자들을 어떻게 다루는지 실측 전이라).
 */

import { isCalendarYmd, tokyoDateOf, tokyoDayStart } from "@/lib/tokyo-date";

const JOINERS = new Set([0x200d, 0xfe0e, 0xfe0f, 0x20e3]);
const QUESTION = 0x3f;

function codePoints(text: string): number[] {
  const out: number[] = [];
  for (const char of text) out.push(char.codePointAt(0) as number);
  return out;
}

export function hasNonBmp(text: string): boolean {
  for (const char of text) if ((char.codePointAt(0) as number) > 0xffff) return true;
  return false;
}

export function maskNonBmp(text: string): string {
  let out = "";
  for (const char of text) out += (char.codePointAt(0) as number) > 0xffff ? "?" : char;
  return out;
}

export function emojiMaskMatches(stored: string, apiBody: string): boolean {
  if (stored === apiBody || !hasNonBmp(apiBody) || !stored.includes("?")) return false;
  const api = codePoints(apiBody);
  const saved = codePoints(stored);
  // 저장된 본문에서 이어 맞출 수 있는 자리들 — 너그러운 글자에서만 갈라진다.
  let positions = new Set<number>([0]);
  for (const point of api) {
    const next = new Set<number>();
    for (const j of positions) {
      if (point > 0xffff) {
        if (saved[j] === QUESTION) next.add(j + 1);
      } else if (JOINERS.has(point)) {
        next.add(j);
        if (saved[j] === point || saved[j] === QUESTION) next.add(j + 1);
      } else if (saved[j] === point) {
        next.add(j + 1);
      }
    }
    if (next.size === 0) return false;
    positions = next;
  }
  return positions.has(saved.length);
}

export type EmojiHealIncoming = { externalId: string; body: string };
export type EmojiHealExisting = {
  id: string;
  external_id: string | null;
  body: string;
  direction: "guest" | "host" | "internal" | "system";
};
export type EmojiHealUpdate = {
  id: string;
  externalId: string;
  body: string;
  previousBody: string;
  /** 손님 말은 번역이 망가진 글로 만들어졌을 수 있다 — 번역 캐시 · 옛 번역 칸을 지운다(다음에 볼 때 새로). 직원 말의 `body_translated` 는 직원 원문이라 두고. */
  clearTranslation: boolean;
};

/** 들어온 메시지 중 고칠 후보 — BMP 밖 글자가 있는 것만(웹훅 본문은 이미 가려져 있어 보통 0개). */
export function emojiHealCandidateIds(incoming: readonly EmojiHealIncoming[]): string[] {
  const ids = new Set<string>();
  for (const message of incoming) if (hasNonBmp(message.body)) ids.add(message.externalId);
  return [...ids];
}

export function planEmojiHeals(
  incoming: readonly EmojiHealIncoming[],
  existing: readonly EmojiHealExisting[],
): EmojiHealUpdate[] {
  const byExternal = new Map<string, EmojiHealExisting>();
  for (const row of existing) if (row.external_id) byExternal.set(row.external_id, row);
  const planned = new Set<string>();
  const out: EmojiHealUpdate[] = [];
  for (const message of incoming) {
    const row = byExternal.get(message.externalId);
    if (!row || planned.has(row.id)) continue;
    if (!emojiMaskMatches(row.body, message.body)) continue;
    planned.add(row.id);
    out.push({
      id: row.id,
      externalId: message.externalId,
      body: message.body,
      previousBody: row.body,
      clearTranslation: row.direction === "guest",
    });
  }
  return out;
}

/** 되살리기 모드의 이어 읽기 자리 — 이 줄(만든 시각 + id)부터(포함). 같은 시각 줄이 몰려 있어도 id 로 앞으로 간다. */
export type EmojiRepairCursor = { createdAt: string; id: string };

/**
 * 되살리기 실행이 다시 읽을 대화 고르기 — 「?」 들어간 메시지 줄(만든 시각 · id 오름차순, `scanLimit` + 1 줄까지 읽음)에서
 * 대화를 처음 나온 순서로 `max` 개. `nextCursor` 는 다음 실행이 시작할 줄: 담지 못한 첫 대화의 첫 줄, 다 담았는데
 * 한 줄 더 읽혔으면(뒤에 더 있음) 그 줄, 아니면 null(끝).
 */
export function pickRepairConversations<T extends { id: string; conversation_id: string; created_at: string }>(
  rows: ReadonlyArray<T>,
  max: number,
  options: { scanLimit: number },
): { conversationIds: string[]; nextCursor: EmojiRepairCursor | null } {
  const picked: string[] = [];
  const seen = new Set<string>();
  const scanned = rows.slice(0, options.scanLimit);
  for (const row of scanned) {
    if (seen.has(row.conversation_id)) continue;
    if (picked.length >= max) return { conversationIds: picked, nextCursor: { createdAt: row.created_at, id: row.id } };
    seen.add(row.conversation_id);
    picked.push(row.conversation_id);
  }
  const peek = rows[options.scanLimit];
  return { conversationIds: picked, nextCursor: peek ? { createdAt: peek.created_at, id: peek.id } : null };
}

/**
 * 되살리기 모드 응답이 「실패」(207 — 부르는 쪽은 반복을 멈춘다)인지. 시간 · 요청 예산으로 멈춘 것만 정상(커서로 이어 부름).
 * 멈춤 · 쿨다운 · 크레딧 · 429 · 오류 · 필터 무시는 모두 실패 — 다시 불러도 같은 이유로 막히거나 크레딧만 쓴다.
 */
export function isEmojiRepairFailure(result: { skipped: string | null; stoppedEarly: string | null }): boolean {
  if (result.skipped !== null) return true;
  return result.stoppedEarly !== null && result.stoppedEarly !== "time_budget" && result.stoppedEarly !== "request_budget";
}

/**
 * 웹훅 뒤 다시 읽기의 하루 요청 상한(조직마다, 도쿄 날짜). 예상 하루 100~230 요청(손님 · 직원 메시지 중 「?」가 든 새 줄이 있는 웹훅마다
 * 예약 하나 · 보통 1페이지)보다 넉넉한 300 — 넘으면 그날 나머지는 「?」로 남고 되살리기 모드로 고친다. Beds24 하루 한도(약 57,600)의 약 0.5%.
 */
export const EMOJI_HEAL_DAILY_MAX_REQUESTS = 300;
/** 같은 예약을 읽은 시각 기록을 들고 있는 시간 — 연달아 온 배달이 같은 예약을 겹쳐 읽지 않게. */
export const EMOJI_HEAL_RECENT_MS = 60_000;

/**
 * `guest_message_channel_state.settings.emojiHeal` — 웹훅 뒤 다시 읽기 몫.
 * - `day` · `used`: 도쿄 날짜와 그날 쓴 요청 수.
 * - `recent`: 예약 번호 → 그 예약을 마지막으로 읽기 시작한 시각(1분 안 것만).
 */
export type EmojiHealState = { day: string | null; used: number; recent: Record<string, string> };

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function readEmojiHealState(settings: unknown): EmojiHealState {
  const raw =
    settings && typeof settings === "object" ? (settings as { emojiHeal?: unknown }).emojiHeal : undefined;
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const recent: Record<string, string> = {};
  if (record.recent && typeof record.recent === "object" && !Array.isArray(record.recent)) {
    for (const [id, at] of Object.entries(record.recent as Record<string, unknown>)) if (isIso(at)) recent[id] = at;
  }
  const used = typeof record.used === "number" && Number.isFinite(record.used) && record.used > 0 ? Math.floor(record.used) : 0;
  return {
    day: typeof record.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.day) ? record.day : null,
    used,
    recent,
  };
}

function todayState(state: EmojiHealState, nowMs: number): EmojiHealState {
  const today = tokyoDateOf(new Date(nowMs).toISOString()) as string;
  const recent = Object.fromEntries(
    Object.entries(state.recent).filter(([, at]) => nowMs - Date.parse(at) < EMOJI_HEAL_RECENT_MS),
  );
  return { day: today, used: state.day === today ? state.used : 0, recent };
}

export type EmojiHealClaim = { claimed: boolean; reason: "daily_cap" | "recent" | null; state: EmojiHealState };

/**
 * 예약 하나를 다시 읽을 몫 잡기 — 요청 하나를 먼저 센다(`settleEmojiHeal` 이 실제 수로 맞춤).
 * 그 예약을 `insertedAt`(이 줄이 들어간 뒤) 이후에 이미 읽기 시작했으면 그 읽기가 이 줄도 봤으니 건너뛴다.
 */
export function claimEmojiHeal(
  state: EmojiHealState,
  args: { providerBookingId: string; insertedAt: string; nowMs: number },
): EmojiHealClaim {
  const current = todayState(state, args.nowMs);
  if (current.used >= EMOJI_HEAL_DAILY_MAX_REQUESTS) return { claimed: false, reason: "daily_cap", state: current };
  const last = current.recent[args.providerBookingId];
  if (last && Date.parse(last) >= Date.parse(args.insertedAt)) return { claimed: false, reason: "recent", state: current };
  return {
    claimed: true,
    reason: null,
    state: {
      ...current,
      used: current.used + 1,
      recent: { ...current.recent, [args.providerBookingId]: new Date(args.nowMs).toISOString() },
    },
  };
}

/**
 * 읽은 뒤 — 잡을 때 센 1 을 실제 요청 수로. 필터가 무시됐으면 그날은 상한으로 채워 더 부르지 않는다.
 * `forget` 이면(읽기가 끝나지 못함 · 한 번도 못 부름) 그 예약의 읽은 시각을 지워 다음 배달이 건너뛰지 않게 한다.
 */
export function settleEmojiHeal(
  state: EmojiHealState,
  args: { providerBookingId: string; requests: number; nowMs: number; haltForDay: boolean; forget: boolean },
): EmojiHealState {
  const current = todayState(state, args.nowMs);
  const used = Math.max(0, current.used - 1 + args.requests);
  const recent = { ...current.recent };
  if (args.forget) delete recent[args.providerBookingId];
  return { ...current, used: args.haltForDay ? Math.max(used, EMOJI_HEAL_DAILY_MAX_REQUESTS) : used, recent };
}

/** 이 쓰기로 그날 상한에 처음 닿았는지(`after` 는 claim · settle 결과 = 오늘 기준). 경고를 하루 한 번만 남기려고. */
export function emojiHealCapReached(before: EmojiHealState, after: EmojiHealState): boolean {
  const usedBefore = before.day === after.day ? before.used : 0;
  return usedBefore < EMOJI_HEAL_DAILY_MAX_REQUESTS && after.used >= EMOJI_HEAL_DAILY_MAX_REQUESTS;
}

const ISO_WITH_ZONE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 되살리기 모드의 `since` — 도쿄 날짜(`YYYY-MM-DD`, 그날 0시부터) 또는 시간대가 붙은 ISO 시각(앞 응답의 `nextCursor`).
 * 달력에 없는 날짜 · 시간대 없는 시각(서버 시간대로 읽혀 어긋남)은 null. 주소에서 「+」가 공백이 된 것도 받는다.
 */
export function parseEmojiRepairSince(value: string | null): string | null {
  const raw = (value ?? "").trim().replace(" ", "+");
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isCalendarYmd(raw) ? new Date(tokyoDayStart(raw)).toISOString() : null;
  const match = ISO_WITH_ZONE.exec(raw);
  if (!match || !isCalendarYmd(match[1])) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
