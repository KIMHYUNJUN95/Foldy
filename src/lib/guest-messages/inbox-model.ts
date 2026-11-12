/**
 * 손님 메시지함(2단계) — 화면 · 서버 액션이 같이 쓰는 **순수** 규칙. docs/product/47-guest-messaging.md §5 · §6-1 · §9
 *
 * - 목록 정렬은 응답 목표에 가까운 순(`computeWaiting`): 목표 넘음 → 목표에 가까운 순 → 나중에(돌아올 시각 순) → 처리 끝(최근 순).
 * - 「나중에」가 끝난 대화는 DB 상태가 아직 `snoozed` 여도 「답장 기다림」으로 본다(다음 메시지가 올 때 DB 함수가 바꾼다 — §4-0).
 * - 보내기 막힘(직접 예약 · 채널 모름)은 어댑터의 허용 목록과 같은 규칙(`OTA_SENDABLE_CHANNELS`).
 * - 「나중에」 시각은 도쿄 기준(CLAUDE.md 7). UTC 자르기 금지 — `tokyo-date.ts`.
 *
 * 서버 import 없음 — 클라이언트 컴포넌트도 가져온다.
 */

import type { ResolvedDraft, ThreadLinkView } from "@/lib/guest-messages/task-link-model";
import { computeWaiting, type WaitingResult } from "@/lib/guest-messages/response-target";
import {
  OTA_SENDABLE_CHANNELS,
  type GuestChannelKey,
  type GuestConversationStatus,
  type GuestMessageDirection,
  type GuestMessageSettings,
} from "@/lib/guest-messages/types";
import { tokyoDateOf, tokyoDayStart, ymdShift } from "@/lib/tokyo-date";
import type { AutoRunView } from "@/lib/guest-messages/auto-model";

export type InboxStatusFilter = "awaiting" | "snoozed" | "done" | "all";
export const INBOX_STATUS_FILTERS: readonly InboxStatusFilter[] = ["awaiting", "snoozed", "done", "all"];

/** 화면에서 보는 상태 — 「나중에」가 끝났으면 awaiting. */
export type InboxRowState = "awaiting" | "snoozed" | "done";

export type ReplyBlock = "direct_booking" | "unknown_channel" | null;

export type OutboxDisplayStatus = "queued" | "sending" | "sent" | "uncertain" | "failed" | "cancelled";

/** 목록 줄에 띄울 발송 문제(가장 급한 것 하나). */
export type OutboxAlert = "failed" | "uncertain" | "queued" | null;

export const MAX_REPLY_CHARS = 4000;
export const MAX_NOTE_CHARS = 2000;
/** 「나중에」 최대 30일. */
export const MAX_SNOOZE_DAYS = 30;

export type InboxConversationRow = {
  id: string;
  guestName: string | null;
  channel: GuestChannelKey | null;
  state: InboxRowState;
  snoozeUntil: string | null;
  propertyName: string | null;
  roomLabel: string | null;
  bookingStatus: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  guestLanguage: string | null;
  lastMessageAt: string | null;
  lastGuestAt: string | null;
  lastLine: { direction: GuestMessageDirection; body: string } | null;
  waiting: WaitingResult;
  outboxAlert: OutboxAlert;
  replyBlock: ReplyBlock;
};

export type ConversationStateInput = {
  status: GuestConversationStatus;
  snooze_until: string | null;
};

export function effectiveRowState(row: ConversationStateInput, now: Date): InboxRowState {
  if (row.status === "snoozed") {
    const until = row.snooze_until ? Date.parse(row.snooze_until) : Number.NaN;
    if (!Number.isNaN(until) && until > now.getTime()) return "snoozed";
    return "awaiting";
  }
  return row.status;
}

export function matchesStatusFilter(state: InboxRowState, filter: InboxStatusFilter): boolean {
  return filter === "all" || state === filter;
}

/** 채널 필터(§5) — Airbnb · Booking.com · 직접 예약 · 그 밖(Expedia · Agoda · Vrbo · 모르는 채널 · 비어 있음). */
export type InboxChannelFilter = "all" | "airbnb" | "booking" | "direct" | "other";
export const INBOX_CHANNEL_FILTERS: readonly InboxChannelFilter[] = ["all", "airbnb", "booking", "direct", "other"];
export function parseChannelFilter(raw: unknown): InboxChannelFilter {
  return typeof raw === "string" && (INBOX_CHANNEL_FILTERS as readonly string[]).includes(raw) ? (raw as InboxChannelFilter) : "all";
}
export function matchesChannelFilter(channel: GuestChannelKey | null, filter: InboxChannelFilter): boolean {
  if (filter === "all") return true;
  if (filter === "other") return channel !== "airbnb" && channel !== "booking" && channel !== "direct";
  return channel === filter;
}

/** 어댑터 `outboundChannelRefusal` 과 같은 규칙(테스트가 둘이 같은지 본다). */
export function replyBlockReason(channel: string | null | undefined): ReplyBlock {
  if (channel === "direct") return "direct_booking";
  if (!channel || !(OTA_SENDABLE_CHANNELS as readonly string[]).includes(channel)) return "unknown_channel";
  return null;
}

export function toChannelKey(value: string | null | undefined): GuestChannelKey | null {
  const keys: readonly string[] = ["airbnb", "booking", "expedia", "agoda", "vrbo", "direct", "other"];
  return value && keys.includes(value) ? (value as GuestChannelKey) : null;
}

const STATE_ORDER: Record<InboxRowState, number> = {
  awaiting: 0,
  snoozed: 1,
  done: 2,
};

function ms(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 응답 목표에 가까운 순(§6-1). 안정 정렬 — 같으면 id. */
export function compareInboxRows(a: InboxConversationRow, b: InboxConversationRow): number {
  const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (byState !== 0) return byState;
  if (a.state === "awaiting") {
    if (a.waiting.overdue !== b.waiting.overdue) return a.waiting.overdue ? -1 : 1;
    if (a.waiting.ratio !== b.waiting.ratio) return b.waiting.ratio - a.waiting.ratio;
    // 같은 비율(둘 다 0 등)이면 먼저 온 손님 말이 위.
    const byGuest = ms(a.lastGuestAt) - ms(b.lastGuestAt);
    if (byGuest !== 0) return byGuest;
  } else if (a.state === "snoozed") {
    const bySnooze = ms(a.snoozeUntil) - ms(b.snoozeUntil);
    if (bySnooze !== 0) return bySnooze;
  } else {
    const byRecent = ms(b.lastMessageAt) - ms(a.lastMessageAt);
    if (byRecent !== 0) return byRecent;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortInboxRows(rows: readonly InboxConversationRow[]): InboxConversationRow[] {
  return [...rows].sort(compareInboxRows);
}

/** DB 줄 → 기다림 계산(그대로 `computeWaiting`). */
export function waitingOf(
  row: {
    status: GuestConversationStatus;
    snooze_until: string | null;
    last_guest_at: string | null;
    last_reply_at: string | null;
    booking_status: string | null;
    check_in_date: string | null;
    check_out_date: string | null;
  },
  settings: Pick<GuestMessageSettings, "responseTargetMinutes" | "nightPause">,
  now: Date,
): WaitingResult {
  return computeWaiting(row, settings, now);
}

/** 발송 큐 줄들 → 목록에 띄울 하나. 보내지 못함 > 나갔는지 모름 > 보낼 차례 기다림. */
export function strongestOutboxAlert(statuses: readonly string[]): OutboxAlert {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("uncertain")) return "uncertain";
  if (statuses.includes("queued") || statuses.includes("sending")) return "queued";
  return null;
}

export type SnoozeInput = { preset: "1h" | "3h" | "tomorrow9" } | { date: string; time: string };

const HOUR_MS = 3_600_000;

/**
 * 「나중에」 돌아올 시각(ISO). 도쿄 기준 — 「내일 오전 9시」는 도쿄 내일 09:00, 직접 고르기는 도쿄 그날 그 시각.
 * 지금보다 앞이거나 30일보다 멀면 null.
 */
export function resolveSnoozeUntil(input: SnoozeInput, now: Date): string | null {
  const nowMs = now.getTime();
  let target: number;
  if ("preset" in input) {
    if (input.preset === "1h") target = nowMs + HOUR_MS;
    else if (input.preset === "3h") target = nowMs + 3 * HOUR_MS;
    else if (input.preset === "tomorrow9") {
      const today = tokyoDateOf(now.toISOString());
      if (!today) return null;
      target = Date.parse(tokyoDayStart(ymdShift(today, 1))) + 9 * HOUR_MS;
    } else return null;
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return null;
    const time = /^(\d{2}):(\d{2})$/.exec(input.time);
    if (!time) return null;
    const hours = Number(time[1]);
    const minutes = Number(time[2]);
    if (hours > 23 || minutes > 59) return null;
    const dayStart = Date.parse(tokyoDayStart(input.date));
    if (Number.isNaN(dayStart)) return null;
    // 달력에 없는 날(2월 30일 등)은 굴러가지 않게 다시 확인한다.
    if (tokyoDateOf(new Date(dayStart).toISOString()) !== input.date) return null;
    target = dayStart + hours * HOUR_MS + minutes * 60_000;
  }
  if (!(target > nowMs)) return null;
  if (target - nowMs > MAX_SNOOZE_DAYS * 24 * HOUR_MS) return null;
  return new Date(target).toISOString();
}

/** 손님 언어 원문(`ja` · `en-US` · `zh_TW` · `Japanese` 등) → 소문자 기본 코드. 모르면 null. */
export function normalizeGuestLanguage(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase().replace(/_/g, "-");
  if (!value) return null;
  const names: Record<string, string> = {
    japanese: "ja",
    english: "en",
    korean: "ko",
    chinese: "zh",
    french: "fr",
    german: "de",
    spanish: "es",
    italian: "it",
    portuguese: "pt",
  };
  if (names[value]) return names[value];
  if (value === "zh-tw" || value === "zh-hk" || value === "zh-hant") return "zh-hant";
  const base = value.split("-")[0];
  return /^[a-z]{2}$/.test(base) ? base : null;
}

/** DeepL 대상 코드. DeepL 이 모르는 언어면 null(번역해서 보내기를 감춘다). */
export function deeplTargetFor(language: string | null): string | null {
  if (!language) return null;
  const map: Record<string, string> = {
    ko: "KO",
    ja: "JA",
    en: "EN-US",
    zh: "ZH-HANS",
    "zh-hant": "ZH-HANT",
    fr: "FR",
    de: "DE",
    es: "ES",
    it: "IT",
    pt: "PT-PT",
    nl: "NL",
    pl: "PL",
    ru: "RU",
    id: "ID",
    tr: "TR",
    sv: "SV",
    da: "DA",
    fi: "FI",
    nb: "NB",
    no: "NB",
    cs: "CS",
    uk: "UK",
    el: "EL",
    hu: "HU",
    ro: "RO",
    bg: "BG",
    sk: "SK",
    sl: "SL",
    et: "ET",
    lv: "LV",
    lt: "LT",
    ar: "AR",
  };
  return map[language] ?? null;
}

/** 직원 언어와 손님 언어가 다르고 DeepL 이 아는 언어일 때만 「번역해서 보내기」. */
export function canTranslateReply(staffLocale: string, guestLanguage: string | null): boolean {
  if (!guestLanguage || !deeplTargetFor(guestLanguage)) return false;
  return guestLanguage !== staffLocale && !(guestLanguage.startsWith("zh") && staffLocale.startsWith("zh"));
}

/** 직원 화면 언어 — 손님 말을 이 셋 중 하나로 번역해 볼 수 있다(번역 캐시 표 `guest_message_translations.lang`). */
export const STAFF_VIEW_LANGS = ["ko", "ja", "en"] as const;
export type StaffViewLang = (typeof STAFF_VIEW_LANGS)[number];
export function isStaffViewLang(value: unknown): value is StaffViewLang {
  return typeof value === "string" && (STAFF_VIEW_LANGS as readonly string[]).includes(value);
}

/**
 * 답장을 번역해서 보낼 수 있는 언어(§9) — 손님 언어(번역 가능할 때) 먼저, 그다음 한국어 · 일본어 · 영어 중
 * 직원 언어 · 손님 언어가 아닌 것. 손님 언어를 모르거나 DeepL 이 모르는 언어여도 ko · ja · en 은 고를 수 있다.
 */
export function replyTranslationTargets(staffLocale: string, guestLanguage: string | null): string[] {
  const out: string[] = [];
  if (canTranslateReply(staffLocale, guestLanguage) && guestLanguage) out.push(guestLanguage);
  for (const lang of STAFF_VIEW_LANGS) {
    if (lang !== staffLocale && !out.includes(lang)) out.push(lang);
  }
  return out;
}

/** 처음 고른 번역 언어 — 손님 언어로 번역할 수 있으면 그것, 아니면 null(번역 안 함 · 원문 그대로). */
export function defaultReplyTarget(staffLocale: string, guestLanguage: string | null): string | null {
  return canTranslateReply(staffLocale, guestLanguage) ? guestLanguage : null;
}

/** 서버 확인 — 화면이 보낸 번역 언어가 이 대화에서 고를 수 있는 것인지. */
export function isAllowedReplyTarget(staffLocale: string, guestLanguage: string | null, target: unknown): target is string {
  return typeof target === "string" && replyTranslationTargets(staffLocale, guestLanguage).includes(target);
}

/** 화면이 만든 보내기 한 번의 키(uuid 같은 모양만). */
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/.test(value);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 발송 큐 오류 → 화면 문구 키. */
export type OutboxErrorKey =
  "directBooking" | "unknownChannel" | "rejected" | "invalidBooking" | "uncertain" | "rateLimited" | "notConfigured" | "other";

export function outboxErrorKey(code: string | null | undefined): OutboxErrorKey {
  switch (code) {
    case "direct_booking":
      return "directBooking";
    case "unknown_channel":
      return "unknownChannel";
    case "provider_rejected":
      return "rejected";
    case "invalid_booking_id":
      return "invalidBooking";
    case "uncertain":
      return "uncertain";
    case "rate_limited":
      return "rateLimited";
    case null:
    case undefined:
      return "other";
    default:
      if (code.startsWith("http_4")) return "rejected";
      if (code === "missing_env" || code.includes("token") || code.includes("config")) return "notConfigured";
      return "other";
  }
}

/** 다시 보내기가 의미 있는 실패인가 — 직접 예약 · 채널 모름은 다시 보내도 같다. */
export function isRetryableOutbox(status: string, errorCode: string | null): boolean {
  if (status === "uncertain") return true;
  if (status !== "failed") return false;
  return errorCode !== "direct_booking" && errorCode !== "unknown_channel";
}

// ── 대화 한 건(화면으로 넘기는 모양) ─────────────────────────────────────────

export type InboxMessageOutbox = {
  id: string;
  /** reply = 직원 답장, auto = 자동 안내(작성자 대신 「자동 안내」로 보인다). */
  kind: "reply" | "auto";
  status: OutboxDisplayStatus;
  errorCode: string | null;
  nextTryAt: string | null;
  retryable: boolean;
  /** 이 사람이 고치기 · 취소 · 다시 보내기를 할 수 없다(자동 안내는 `guest_messages.manage` 만 — 47 §5-6 임시 결정). */
  locked: boolean;
};

export type InboxMessage = {
  id: string;
  direction: GuestMessageDirection;
  body: string;
  /** 손님 말: 직원 언어 번역(캐시). 우리 답장: 직원이 쓴 원문(번역해서 보냈을 때). */
  bodyTranslated: string | null;
  translatedLang: string | null;
  /** 우리 답장: 손님에게 나간 글(`body`)의 언어 — 번역해서 보냈을 때만(그때 고른 언어). */
  bodyLang: string | null;
  sentAt: string;
  authorName: string | null;
  attachmentCount: number;
  outbox: InboxMessageOutbox | null;
};

export type InboxReservationSummary = {
  reservationId: string | null;
  propertyName: string | null;
  roomLabel: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  nights: number | null;
  adults: number | null;
  children: number | null;
  totalGuests: number | null;
  bookingStatus: string | null;
  channel: GuestChannelKey | null;
  guestLanguage: string | null;
  /** Beds24 자기 예약 번호. */
  bookingNumber: string;
  /** 채널 예약 번호(Airbnb 확인 코드 등) — 있으면 이쪽을 크게. */
  channelReference: string | null;
  /** 직접 예약일 때만(답장 대신 이메일로 — 시안 States). */
  guestEmail: string | null;
};

export type InboxThread = {
  conversation: InboxConversationRow;
  messages: InboxMessage[];
  reservation: InboxReservationSummary;
  /** 실제 Beds24 발송이 켜져 있나(`GUEST_MESSAGES_SEND_ENABLED`). 꺼져 있으면 답장은 큐에 남는다. */
  sendEnabled: boolean;
  /** 이 예약의 자동 안내(5단계 — 보낼 예정 · 보냄 · 막힘). 표가 없거나 읽기 실패면 빈 목록. */
  autoRuns: AutoRunView[];
  /** 이 대화에서 만든 업무(6단계) — 시스템 줄로 그린다. 표가 없거나 읽기 실패면 빈 목록. */
  links: ThreadLinkView[];
  /** 이어진 업무가 끝났고 그 뒤 답장이 아직 없으면 「해결됐어요」 초안(자동으로 보내지 않는다). */
  resolvedDraft: ResolvedDraft | null;
};

export type InboxListData = {
  rows: InboxConversationRow[];
  awaitingCount: number;
  overdueCount: number;
  /** 정본 건물 이름(그릴 때 localize). */
  buildings: string[];
};

/** 두 날짜 사이 밤 수(YYYY-MM-DD). */
export function nightsBetween(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}
