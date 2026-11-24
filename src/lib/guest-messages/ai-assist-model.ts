/**
 * AI 답장 도우미 — **순수 함수**(서버 · 시험 어디서나). docs/product/49-guest-message-ai-reply-assist.md §4 · §8
 *
 * - 「답 필요 없음」 판정(15자 미만 · 사진만 · 시스템 · 손님 말 아님).
 * - 과거 답 가리기(코드 · 3자리 이상 숫자 · 방 번호 · URL · 메일 · 전화 · 금액 → `[…]`) — 말투 · 구성 참고용(§7 설계 1).
 * - 자리 표시(`{entry_code_room}` · `{wifi}`) 채우기 / 보는 직원 언어 자리 표시 남기기.
 * - 사람 판단 필요 주제 · 그날 사정에 달린 주제 — 모델의 `needsHuman` 에 더하는 안전망(§4).
 * - 모델 출력 검사(확인 필요 문구는 초안 안의 정확한 부분 문자열, 최대 4개).
 * - 보낸 글 ↔ 초안 비교(그대로 보냄 · 고쳐 보냄) · 이번 달(도쿄) 경계 · 비용 계산.
 */

import { pickSingleRoomAccess } from "@/lib/guest-messages/access-codes";
import { maskEntryCodes, MASKED_CODE } from "@/lib/guest-messages/auto-model";
import type { GuestLang } from "@/lib/guest-messages/guest-info-model";
import { messagePlainText } from "@/lib/guest-messages/message-body";
import { MAX_REPLY_CHARS } from "@/lib/guest-messages/inbox-model";
import { ASSIST_LIMITS, type AssistCheck } from "@/lib/guest-messages/ai-assist-types";
import { tokyoDateOf, tokyoDayStart } from "@/lib/tokyo-date";

export const MIN_QUESTION_CHARS = 15;
export const PAIR_WINDOW_MS = 12 * 60 * 60 * 1000;
export const MASK = "[…]";

function charCount(text: string): number {
  return Array.from(text).length;
}

// ── 글 꺼내기 · 답 필요 없음 ───────────────────────────────────────────────────

const QUOTE_CUT_RES = [
  /^\s*On .{3,200} wrote:\s*$/im,
  /^\s*-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}/im,
  /^\s*From:\s.+$/im,
  /^.{0,80}(?:님이 작성|のメッセージ|wrote)\s*:\s*$/im,
];

/** 메시지 본문 → 도우미가 읽을 글(사진 · 링크 주소 빼고, 메일 인용 부분 잘라냄). */
export function assistTextOf(body: string | null | undefined): string {
  let text = messagePlainText(body).text;
  for (const re of QUOTE_CUT_RES) {
    const match = re.exec(text);
    if (match && match.index > 0) text = text.slice(0, match.index);
  }
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 이 메시지가 답이 필요한 손님 질문인가(49 §2 걸러내기 — 짧은 인사 · 사진만 · 시스템 · 우리 말은 아님). */
export function needsReplyMessage(message: { direction: string; body: string | null }): boolean {
  if (message.direction !== "guest") return false;
  return charCount(assistTextOf(message.body)) >= MIN_QUESTION_CHARS;
}

export type ThreadMessage = { id: string; direction: string; body: string | null; sent_at: string };

/**
 * 도우미가 가리킬 손님 메시지 — 마지막 손님 메시지. 그 뒤에 우리 답이 이미 있으면 null(답할 차례가 아님),
 * 마지막 손님 메시지가 답 필요 없음이면 null.
 */
export function pickAssistQuestion(messagesAscending: readonly ThreadMessage[]): ThreadMessage | null {
  for (let i = messagesAscending.length - 1; i >= 0; i -= 1) {
    const message = messagesAscending[i];
    if (message.direction === "host") return null;
    if (message.direction === "guest") return needsReplyMessage(message) ? message : null;
  }
  return null;
}

/**
 * 백필용 — 질문(답 필요한 손님 메시지)마다 12시간 안 우리 첫 답(없으면 null). 시간 오름차순 입력.
 * 답은 그 답 **바로 앞의 마지막 질문** 하나에만 붙는다(`pickAssistQuestion` · 보낼 때 붙이기와 같은 규칙) —
 * 사이에 다른 질문이 또 오면 앞 질문은 답 없음.
 */
export function pairQuestions(
  messagesAscending: readonly ThreadMessage[],
): Array<{ question: ThreadMessage; reply: ThreadMessage | null }> {
  const out: Array<{ question: ThreadMessage; reply: ThreadMessage | null }> = [];
  messagesAscending.forEach((message, index) => {
    if (!needsReplyMessage(message)) return;
    const askedAt = Date.parse(message.sent_at);
    let reply: ThreadMessage | null = null;
    for (let j = index + 1; j < messagesAscending.length; j += 1) {
      const next = messagesAscending[j];
      if (Date.parse(next.sent_at) - askedAt > PAIR_WINDOW_MS) break;
      if (needsReplyMessage(next)) break;
      if (next.direction === "host" && assistTextOf(next.body)) {
        reply = next;
        break;
      }
    }
    out.push({ question: message, reply });
  });
  return out;
}

// ── 가리기 ─────────────────────────────────────────────────────────────────────

const URL_RE = /\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const AMOUNT_RE = /(?:[¥￥]|\bJPY\s?)\s?\d[\d,.]*|\d[\d,.]*\s?(?:円|엔|yen\b|JPY\b)/gi;
const PHONE_RE = /\+?\d[\d ()-]{7,}\d/g;
const ROOM_RE = /(?:\broom|\brm\.?|部屋|房间|房)\s*#?\s*[A-Za-z]?\d{1,4}[A-Za-z]?|\b[A-Za-z]?\d{1,4}\s*(?:호실|호|号室|号|号房)/gi;
const DIGITS_RE = /[0-9#*]{3,}/g;
/** 띄어쓰기 · 하이픈이 섞인 숫자 3개 넘게(「12-34」 · 「1 2 3 4」) — 코드를 나눠 쓴 것. 줄은 넘지 않는다.
 *  시간 · 거리(「15:00-22:00」 · 「10-15 minutes」)와 모양이 같아서 **비밀 낱말이 든 문장 안에서만** 쓴다. */
const SPACED_DIGITS_RE = /\d(?:[^\S\n]?-?[^\S\n]?\d){2,}/g;
/** 비밀 낱말(한 · 일 · 영) — 출입 코드 · 비밀번호를 말하는 문장 표지. 후보 걸러내기(`reply-candidates-model.ts`)도 같은 것을 쓴다. */
export const SECRET_WORD_RE =
  /(비밀\s*번호|비번|암호|패스\s*워드|현관\s*번호|도어\s*락|키\s*박스|password|passcode|pass\s*code|\bpin\b|door\s*code|entry\s*code|key\s*code|access\s*code|lock\s*code|keypad|key\s*box|keybox|lockbox|暗証|パスワード|キーボックス|キーナンバー|解錠|ロック番号)/i;
export const WIFI_WORD_RE = /(wi-?fi|와이파이|ワイファイ|ssid)/i;
/** 문장 끝 — 마침표는 뒤에 빈칸 · 끝이 올 때만(「15.00」 · 「wi-fi.net」 이 잘리지 않게). */
export const SENTENCE_SPLIT_RE = /(?<=[!?。！？\n]|\.(?=\s|$))/;

/** 비밀 낱말(와이파이 포함)이 든 문장 — 그리고 그 바로 다음 조각(「Door code:\n12 34」 처럼 줄을 바꿔 값을 쓴 것 · 빈 줄은 건너서)에서만
 *  나눠 쓴 숫자를 가린다. */
function maskSplitCodesInSecretSentences(text: string): string {
  let previousSecret = false;
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((sentence) => {
      // 빈칸 · 줄바꿈뿐인 조각(「Door code:\n\n12 34」 의 빈 줄 · 「Door code.\n12 34」 의 줄바꿈)은 건너뛴다 — 앞 문장의
      // 비밀 상태를 다음 조각까지 넘긴다.
      if (!sentence.trim()) return sentence;
      const flat = sentence.normalize("NFKC");
      const secret = SECRET_WORD_RE.test(flat) || WIFI_WORD_RE.test(flat);
      const masked = secret || previousSecret ? sentence.replace(SPACED_DIGITS_RE, MASK) : sentence;
      previousSecret = secret;
      return masked;
    })
    .join("");
}

function collapseMasks(text: string): string {
  return text.replace(/\[…\](?:[\s,.:/-]*\[…\])+/g, MASK);
}

/** 이름 조각(2자 이상) 가리기 — 그 대화 손님 이름이 과거 글에 남지 않게. */
export function maskNames(text: string, names: ReadonlyArray<string | null | undefined>): string {
  const parts = [
    ...new Set(
      names
        .flatMap((name) => (name ?? "").split(/[\s,.()]+/))
        .map((part) => part.trim())
        .filter((part) => charCount(part) >= 2),
    ),
  ].sort((a, b) => b.length - a.length);
  if (parts.length === 0 || !text) return text;
  // 라틴 글자 이름은 낱말 경계로만(「An」이 「can」 안을 가리지 않게). 한자 · 한글 이름은 띄어쓰기가 없을 수 있어 그대로.
  const source = parts
    .map((part) => {
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return /^\p{Script=Latin}+$/u.test(part) ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
    })
    .join("|");
  return text.replace(new RegExp(source, "giu"), MASK);
}

/** 손님 연락처 가리기(URL · 메일 · 전화) — 질문 글에. */
function maskContacts(text: string): string {
  return text.replace(URL_RE, MASK).replace(EMAIL_RE, MASK).replace(PHONE_RE, MASK);
}

/** 저장할 질문 글 — 출입 코드 · 그 손님 이름 · 연락처를 가린다(뜻은 남김). */
export function maskQuestion(text: string, codes: readonly string[], names: ReadonlyArray<string | null | undefined>): string {
  const masked = maskEntryCodes(text, codes).split(MASKED_CODE).join(MASK);
  return collapseMasks(maskContacts(maskNames(masked, names))).slice(0, 4000);
}

/** 과거 답 가리기(§8-3) — 코드 · 이름 · URL · 메일 · 금액 · 전화 · 방 번호 · 3자리 이상 숫자 묶음 → `[…]`.
 *  띄어쓰기 · 하이픈으로 나눠 쓴 숫자(「1 2 3 4」 · 「12-34」)는 비밀 낱말이 든 문장 안에서만 가린다(시간 · 거리는 남김). */
export function maskPastReply(text: string, codes: readonly string[], names: ReadonlyArray<string | null | undefined> = []): string {
  let out = maskEntryCodes(text, codes).split(MASKED_CODE).join(MASK);
  out = maskNames(out, names);
  out = out.replace(URL_RE, MASK).replace(EMAIL_RE, MASK).replace(AMOUNT_RE, MASK).replace(PHONE_RE, MASK);
  out = maskSplitCodesInSecretSentences(out.replace(ROOM_RE, MASK)).replace(DIGITS_RE, MASK);
  return collapseMasks(out).slice(0, 4000);
}

// ── 자리 표시 ─────────────────────────────────────────────────────────────────

export const ASSIST_TOKENS = { entryCode: "{entry_code_room}", wifi: "{wifi}" } as const;

/** 채우지 못한 자리 표시 — 보는 직원 언어(초안이 직원 언어라서, §8 결정). */
export const ASSIST_PLACEHOLDER_LABELS: Record<keyof typeof ASSIST_TOKENS, Record<GuestLang, string>> = {
  entryCode: { ko: "[출입 비밀번호]", ja: "[入室暗証番号]", en: "[Door code]" },
  wifi: { ko: "[와이파이 정보]", ja: "[Wi-Fi情報]", en: "[Wi-Fi details]" },
};

const ENTRY_TOKEN_RE = /\{\s*(?:entry_code[a-z_]*|door_code|room_code|password)\s*\}/gi;
const WIFI_TOKEN_RE = /\{\s*wifi[a-z_]*\s*\}/gi;

/**
 * `{wifi}` 는 이름표까지 붙은 한 줄로 채워진다(「와이파이: … / 비밀번호: …」). 모델이 앞에 「Wi-Fi:」 같은 이름을 붙였으면 뗀다 —
 * 안 떼면 「와이파이: 와이파이: …」 가 된다. 줄 맨 앞 이름표만(문장 속 낱말은 그대로).
 */
const WIFI_LABEL_BEFORE_TOKEN_RE =
  /^([^\S\n]*)(?:wi-?fi|wlan|와이파이|ワイファイ|無線LAN)[^\S\n]*(?:정보|情報|details|info(?:rmation)?|network|password|비밀번호|パスワード)?[^\S\n]*[:：][^\S\n]*(?=\{\s*wifi[a-z_]*\s*\})/gimu;

export function stripWifiLabelBeforeToken(text: string): string {
  return text.replace(WIFI_LABEL_BEFORE_TOKEN_RE, "$1");
}

/**
 * 모델 초안의 자리 표시 채우기. 값이 없으면(코드 볼 권한 없음 · 이 방 코드 없음 · 와이파이 비어 있음) 보는 직원 언어 자리 표시를 남기고
 * `placeholders` 에 적는다 — 남아 있으면 보내기를 막는다.
 */
export function fillAssistPlaceholders(
  text: string,
  values: { entryCode: string | null; wifi: string | null },
  lang: GuestLang,
): { text: string; placeholders: string[] } {
  const placeholders = new Set<string>();
  const fill = (re: RegExp, value: string | null, label: string) =>
    (source: string) =>
      source.replace(re, () => {
        if (value?.trim()) return value.trim();
        placeholders.add(label);
        return label;
      });
  let out = fill(ENTRY_TOKEN_RE, values.entryCode, ASSIST_PLACEHOLDER_LABELS.entryCode[lang])(text);
  out = fill(WIFI_TOKEN_RE, values.wifi, ASSIST_PLACEHOLDER_LABELS.wifi[lang])(out);
  return { text: out, placeholders: [...placeholders] };
}

/** 보내려는 글에 채우지 않은 자리 표시가 남아 있나(그 초안의 자리 표시 + 날것 토큰). */
export function hasUnfilledPlaceholder(body: string, placeholders: readonly string[]): boolean {
  if (placeholders.some((label) => label && body.includes(label))) return true;
  return new RegExp(ENTRY_TOKEN_RE.source, "i").test(body) || new RegExp(WIFI_TOKEN_RE.source, "i").test(body);
}

// ── 주제 안전망 ────────────────────────────────────────────────────────────────

const SENSITIVE_RE = new RegExp(
  [
    "cancel",
    "refund",
    "\\bpay(?:ment|ing)?\\b",
    "\\bcharge",
    "invoice",
    "credit card",
    "\\bdamage",
    "change (?:the |my |our )?(?:date|dates|reservation|booking)",
    "\\bextend",
    "extra night",
    "stay longer",
    "(?:more|additional|extra) (?:guest|guests|person|people)",
    "\\bnois",
    "\\bloud\\b",
    "police",
    "unsafe",
    "\\bbroken\\b",
    "not working",
    "doesn'?t work",
    "\\bleak",
    "no hot water",
    "\\bdirty\\b",
    "\\bsmell",
    "cockroach",
    "\\bbugs?\\b",
    "\\bstain",
    "\\blost\\b",
    "left (?:my|behind)",
    "forgot",
    "취소",
    "환불",
    "결제",
    "청구",
    "날짜.{0,4}(?:변경|바꾸)",
    "예약.{0,4}(?:변경|바꾸)",
    "연장",
    "인원",
    "소음",
    "시끄",
    "경찰",
    "고장",
    "작동.{0,3}안",
    "안 ?돼요",
    "누수",
    "더러",
    "냄새",
    "벌레",
    "분실",
    "잃어버",
    "두고 ?(?:왔|나왔)",
    "キャンセル",
    "返金",
    "支払",
    "請求",
    "日程.{0,3}変更",
    "予約.{0,3}変更",
    "延長",
    "人数",
    "騒音",
    "うるさ",
    "警察",
    "故障",
    "壊れ",
    "動かない",
    "汚",
    "臭",
    "虫",
    "忘れ物",
    "紛失",
    "なくし",
    "取消",
    "退款",
    "付款",
    "支付",
    "改期",
    "延长",
    "噪音",
    "吵",
    "坏了",
    "不能用",
    "脏",
    "丢",
    "遗失",
  ].join("|"),
  "i",
);

const DAY_DEPENDENT_RE = new RegExp(
  [
    "late check-?out",
    "check-?out (?:late|later)",
    "early check-?in",
    "check-?in (?:early|earlier)",
    "luggage",
    "baggage",
    "\\bbags?\\b",
    "(?:change|move|switch) (?:to )?(?:another |a different |the )?rooms?",
    "room (?:change|move)",
    "\\bfree\\b",
    "complimentary",
    "늦은 ?체크아웃",
    "레이트 ?체크아웃",
    "체크아웃.{0,6}(?:늦|연장)",
    "얼리 ?체크인",
    "일찍 ?체크인",
    "체크인.{0,6}(?:일찍|빨리)",
    "짐",
    "방.{0,3}(?:변경|이동|바꿔|옮)",
    "무료",
    "レイト ?チェックアウト",
    "アーリー ?チェックイン",
    "早め.{0,3}チェックイン",
    "遅.{0,4}チェックアウト",
    "荷物",
    "部屋.{0,3}(?:変更|移動|替え|変え)",
    "無料",
    "延迟退房",
    "晚退房",
    "提前入住",
    "行李",
    "换房",
    "免费",
  ].join("|"),
  "i",
);

export function assistTopicFlags(question: string): { sensitive: boolean; dayDependent: boolean } {
  return { sensitive: SENSITIVE_RE.test(question), dayDependent: DAY_DEPENDENT_RE.test(question) };
}

// ── 모델 출력 ─────────────────────────────────────────────────────────────────

export type DraftOutput = {
  kind: "draft" | "direct";
  text: string;
  checks: AssistCheck[];
  needsHuman: boolean;
  reason: string | null;
};

/** 확인 필요 문구 — 초안 안의 정확한 부분 문자열만, 겹침 없이, 최대 4개. */
export function filterChecks(text: string, checks: readonly AssistCheck[]): AssistCheck[] {
  const seen = new Set<string>();
  const out: AssistCheck[] = [];
  for (const check of checks) {
    const part = check.text;
    if (!part.trim() || seen.has(part) || !text.includes(part)) continue;
    seen.add(part);
    out.push({ text: part, why: check.why });
    if (out.length >= ASSIST_LIMITS.checks) break;
  }
  return out;
}

function shortString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? Array.from(trimmed).slice(0, max).join("") : null;
}

/** 모델이 낸 JSON 검사 — 모양이 틀리면 null(초안 실패). */
export function validateDraftOutput(raw: unknown): DraftOutput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.kind !== "draft" && record.kind !== "direct") return null;
  if (typeof record.needsHuman !== "boolean") return null;
  const reason = shortString(record.reason, 200);
  if (record.kind === "direct") return { kind: "direct", text: "", checks: [], needsHuman: true, reason };
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text || charCount(text) > MAX_REPLY_CHARS) return null;
  const rawChecks = Array.isArray(record.checks) ? record.checks : [];
  const checks: AssistCheck[] = [];
  for (const item of rawChecks) {
    if (!item || typeof item !== "object") continue;
    const part = (item as Record<string, unknown>).text;
    const why = shortString((item as Record<string, unknown>).why, 200);
    if (typeof part !== "string" || !why) continue;
    checks.push({ text: part, why });
  }
  return { kind: "draft", text, checks: filterChecks(text, checks), needsHuman: record.needsHuman, reason };
}

// ── 보낸 글 비교 ───────────────────────────────────────────────────────────────

/** 비교용 정리 — 유니코드 NFC · 앞뒤 공백 · 공백 묶음 하나로. */
export function normalizeForCompare(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function sentKindFor(draftHash: string | null, sentHash: string): "sent_as_is" | "sent_edited" {
  return draftHash !== null && draftHash === sentHash ? "sent_as_is" : "sent_edited";
}

// ── 이번 달 · 비용 ─────────────────────────────────────────────────────────────

/** 이번 달(도쿄) 시작 · 다음 달 시작(timestamptz ISO). */
export function tokyoMonthBounds(now: Date): { start: string; endExclusive: string } {
  const ymd = tokyoDateOf(now.toISOString()) as string;
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: tokyoDayStart(`${ymd.slice(0, 7)}-01`),
    endExclusive: tokyoDayStart(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`),
  };
}

/** 도쿄 날짜로 N달 전 그날 0시(+09:00) — 말일은 그 달 마지막 날로(3/31 의 한 달 전 = 2/28 · 29). */
export function tokyoMonthsAgoStart(now: Date, months: number): string {
  const ymd = tokyoDateOf(now.toISOString()) as string;
  const total = Number(ymd.slice(0, 4)) * 12 + (Number(ymd.slice(5, 7)) - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Number(ymd.slice(8, 10)), lastDay);
  return tokyoDayStart(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

export type DraftUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** 비용(백만분의 1 달러) — 가격은 100만 토큰당 달러라 「토큰 × 가격」이 곧 micro USD. */
export function costMicroUsd(
  usage: DraftUsage,
  price: { input: number; output: number; cacheWrite: number; cacheRead: number },
): number {
  return Math.round(
    usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead,
  );
}

// ── 시험용 가짜 임베딩 ─────────────────────────────────────────────────────────

/** `GUEST_AI_FAKE=1` — 글자 3개 묶음을 칸에 나눠 담고 길이 1로. 같은 글 = 같은 숫자, 비슷한 글 = 가까운 숫자. */
export function fakeEmbedding(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  const chars = Array.from(text.toLowerCase().replace(/\s+/g, " "));
  for (let i = 0; i < chars.length; i += 1) {
    const gram = chars.slice(i, i + 3).join("");
    let hash = 2166136261;
    for (let k = 0; k < gram.length; k += 1) {
      hash ^= gram.charCodeAt(k);
      hash = Math.imul(hash, 16777619);
    }
    vector[(hash >>> 0) % dim] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
}

/** pgvector 글 꼴(`[0.1,0.2,…]`). */
export function toVectorLiteral(values: readonly number[]): string {
  return `[${values.map((value) => (Number.isFinite(value) ? Number(value.toFixed(7)) : 0)).join(",")}]`;
}

/** 거리(코사인) → 0~1 유사도. */
export function similarityOf(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance));
}

// ── 이 예약 방의 손님용 출입 코드 ─────────────────────────────────────────────

/** 손님이 쓰는 공용 출입 번호 종류 — 창고 · 키 박스 · 리넨실은 직원용이라 넣지 않는다(49 §4). */
const GUEST_SHARED_ACCESS = new Set(["roomPassword", "doorPassword"]);

/**
 * 초안 `{entry_code_room}` 에 넣을 값 — **지금 예약의 방**에 저장된 번호, 없으면 손님용 공용 번호(모든 방 같음 · 현관),
 * 그것도 없으면 null(자리 표시가 남는다). 다른 방 · 직원용 번호는 절대 고르지 않는다.
 */
export function guestEntryCodeFor(
  building: {
    sharedAccess: ReadonlyArray<{ labelKey: string; code: string }>;
    roomAccess: ReadonlyArray<{ roomLabel: string; code: string }>;
  } | null,
  roomLabel: string | null,
): string | null {
  if (!building) return null;
  const room = pickSingleRoomAccess(roomLabel, building.roomAccess.filter((item) => item.code.trim()));
  if (room) return room.code.trim();
  if (building.roomAccess.some((item) => item.code.trim())) return null;
  const shared = building.sharedAccess.filter((item) => item.code.trim() && GUEST_SHARED_ACCESS.has(item.labelKey));
  return shared.length === 1 ? shared[0].code.trim() : null;
}
