/**
 * 손님 메시지함 표시 도움 — 순수(클라이언트 · 서버 어디서나). 시각은 **도쿄 시간대**로 그린다(CLAUDE.md 7).
 */

import type { Dictionary } from "@/lib/i18n";
import {
  STAFF_VIEW_LANGS,
  type InboxChannelFilter,
  type InboxConversationRow,
  type OutboxErrorKey,
  type StaffViewLang,
} from "@/lib/guest-messages/inbox-model";
import { responseTargetCategory } from "@/lib/guest-messages/response-target";
import type { GuestChannelKey } from "@/lib/guest-messages/types";
import { tokyoDateOf } from "@/lib/tokyo-date";

export type GmCopy = Dictionary["guestMessages"];

export const CHANNEL_DOT: Record<GuestChannelKey | "none", string> = {
  airbnb: "#FF5A5F",
  booking: "#003B95",
  expedia: "#8B8898",
  agoda: "#8B8898",
  vrbo: "#8B8898",
  direct: "#8B8898",
  other: "#8B8898",
  none: "#8B8898",
};

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export function durationLabel(minutes: number, copy: GmCopy): string {
  if (minutes < 60) return fill(copy.waitMinutes, { n: Math.max(0, minutes) });
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? fill(copy.waitHoursOnly, { h }) : fill(copy.waitHours, { h, m });
  }
  return fill(copy.waitDays, { d: Math.floor(minutes / (24 * 60)) });
}

export function channelName(channel: GuestChannelKey | null, copy: GmCopy): string {
  switch (channel) {
    case "airbnb":
      return copy.channelAirbnb;
    case "booking":
      return copy.channelBooking;
    case "expedia":
      return copy.channelExpedia;
    case "agoda":
      return copy.channelAgoda;
    case "vrbo":
      return copy.channelVrbo;
    case "direct":
      return copy.channelDirect;
    default:
      return copy.channelOther;
  }
}

/** 「번역해서 보기」 언어 고르기 — 원문 · 보는 사람 언어 먼저 · 나머지 둘. */
export function viewLangOptions(copy: GmCopy, locale: string): Array<{ value: StaffViewLang | null; label: string }> {
  const order = [...STAFF_VIEW_LANGS].sort((a, b) => (a === locale ? -1 : b === locale ? 1 : 0));
  return [
    { value: null, label: copy.translateViewOff },
    ...order.map((lang) => ({
      value: lang,
      label: fill(copy.translateViewIn, {
        lang: languageName(lang, locale) ?? lang,
      }),
    })),
  ];
}

/** 채널 필터 칸 이름 — Airbnb · Booking.com 은 상표라 그대로, 「모든 채널 · 직접 예약 · 그 밖」은 사전. */
export function channelFilterLabel(filter: InboxChannelFilter, copy: GmCopy): string {
  switch (filter) {
    case "airbnb":
      return copy.channelAirbnb;
    case "booking":
      return copy.channelBooking;
    case "direct":
      return copy.channelDirect;
    case "other":
      return copy.channelOtherFilter;
    default:
      return copy.channelAll;
  }
}

/** 예약 상태 한 마디 — 숙박 중 · 오늘 체크인은 도쿄 날짜로. */
export function bookingStateLabel(
  row: Pick<InboxConversationRow, "bookingStatus" | "checkInDate" | "checkOutDate">,
  copy: GmCopy,
  now: Date,
  long = false,
): string {
  const status = row.bookingStatus?.trim().toLowerCase() ?? "";
  if (status === "cancelled") return copy.statusCancelled;
  const category = responseTargetCategory(
    {
      booking_status: row.bookingStatus,
      check_in_date: row.checkInDate,
      check_out_date: row.checkOutDate,
    },
    now,
  );
  if (category === "inquiry") return long ? copy.statusInquiryLong : copy.statusInquiry;
  if (category === "request") return copy.statusRequest;
  if (category === "staying") {
    return row.checkInDate === tokyoDateOf(now.toISOString()) ? copy.statusCheckinToday : copy.statusStaying;
  }
  if (status === "new") return copy.statusNew;
  if (status === "confirmed") return copy.statusConfirmed;
  return copy.statusOther;
}

const TZ = "Asia/Tokyo";

function localeTag(locale: string): string {
  return locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
}

export function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(iso));
}

/** 「내일 9:00」 같은 다시 보일 시각 — 오늘이면 시각만, 그 밖은 월/일 + 시각. */
export function formatWhen(iso: string, locale: string, now: Date): string {
  const sameDay = tokyoDateOf(iso) === tokyoDateOf(now.toISOString());
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "numeric", minute: "2-digit", timeZone: TZ }
    : {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: TZ,
      };
  return new Intl.DateTimeFormat(localeTag(locale), options).format(new Date(iso));
}

export function formatDay(ymd: string, locale: string, now: Date, copy: GmCopy): string {
  const today = tokyoDateOf(now.toISOString());
  if (ymd === today) return copy.dayToday;
  const yesterday = tokyoDateOf(new Date(now.getTime() - 86_400_000).toISOString());
  if (ymd === yesterday) return copy.dayYesterday;
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${ymd}T00:00:00Z`));
}

/** 체크인–체크아웃 「11/20 (목) – 11/23 (일)」. 날짜 문자열이라 UTC 로 읽어 요일을 고정한다. */
export function formatStayRange(checkIn: string | null, checkOut: string | null, locale: string): string | null {
  if (!checkIn || !checkOut) return null;
  const fmt = new Intl.DateTimeFormat(localeTag(locale), {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });
  return `${fmt.format(new Date(`${checkIn}T00:00:00Z`))} – ${fmt.format(new Date(`${checkOut}T00:00:00Z`))}`;
}

/** 체크인 · 체크아웃을 따로(화면이 날짜 하나씩 끊기지 않게 묶는다). */
export function formatStayParts(checkIn: string | null, checkOut: string | null, locale: string): { from: string; to: string } | null {
  if (!checkIn || !checkOut) return null;
  const fmt = new Intl.DateTimeFormat(localeTag(locale), {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });
  return {
    from: fmt.format(new Date(`${checkIn}T00:00:00Z`)),
    to: fmt.format(new Date(`${checkOut}T00:00:00Z`)),
  };
}

export function formatShortRange(checkIn: string | null, checkOut: string | null): string | null {
  if (!checkIn || !checkOut) return null;
  const a = checkIn.slice(5).replace("-", "/");
  const b = checkOut.slice(5).replace("-", "/");
  return `${a}–${b}`;
}

export function languageName(code: string | null, locale: string): string | null {
  if (!code) return null;
  try {
    const display = new Intl.DisplayNames([localeTag(locale)], {
      type: "language",
    });
    return display.of(code === "zh-hant" ? "zh-Hant" : code) ?? code;
  } catch {
    return code;
  }
}

export function outboxErrorText(key: OutboxErrorKey, copy: GmCopy, channel: string): string {
  switch (key) {
    case "directBooking":
      return copy.errDirectBooking;
    case "unknownChannel":
      return copy.errUnknownChannel;
    case "rejected":
      return fill(copy.errRejected, { channel });
    case "invalidBooking":
      return copy.errInvalidBooking;
    case "uncertain":
      return fill(copy.uncertainLabel, { channel });
    case "rateLimited":
      return copy.errRateLimited;
    case "notConfigured":
      return copy.errNotConfigured;
    default:
      return copy.errOther;
  }
}

export function initialOf(name: string | null, fallback: string): string {
  return Array.from((name ?? "").trim() || fallback)[0]?.toUpperCase() ?? "·";
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // `randomUUID` 가 없는 곳(http 로 연 사내 주소 등 보안 문맥 아님)에서도 서버가 받는 v4 uuid 꼴로 — 예전 `k-…` 는 업무 만들기에서 거절됐다.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 줄 오른쪽 위 기다린 시간 · 상태 글자 + 색 · 굵기. */
export function waitBadge(
  row: InboxConversationRow,
  copy: GmCopy,
  locale: string,
  now: Date,
  withTarget: boolean,
): { text: string; tone: "urgent" | "strong" | "muted" } {
  if (row.state === "done") return { text: copy.stateDone, tone: "muted" };
  if (row.state === "snoozed" && row.snoozeUntil) {
    return {
      text: fill(copy.stateSnoozedUntil, {
        time: formatWhen(row.snoozeUntil, locale, now),
      }),
      tone: "muted",
    };
  }
  const wait = durationLabel(row.waiting.waitingMinutes, copy);
  const text = withTarget
    ? fill(copy.waitWithTarget, {
        wait,
        target: durationLabel(row.waiting.targetMinutes, copy),
      })
    : wait;
  if (row.waiting.overdue) return { text, tone: "urgent" };
  if (row.waiting.ratio >= 0.8) return { text, tone: "strong" };
  return { text, tone: "muted" };
}

export function lastLineText(row: InboxConversationRow, copy: GmCopy): string {
  if (row.replyBlock === "direct_booking" && row.state !== "done" && !row.lastLine) return copy.directNoReply;
  if (!row.lastLine) return "";
  const body = row.lastLine.body.replace(/\s+/g, " ").trim() || copy.attachmentOnly;
  if (row.state === "awaiting" && row.lastLine.direction === "guest") return body;
  return fill(row.lastLine.direction === "guest" ? copy.prefixGuest : copy.prefixReply, { text: body });
}

/** 멈춘 이유 코드(보정 조회 · 가져오기) → 문구. 모르는 코드는 「그 밖」. */
export function reasonText(code: string | null, copy: GmCopy): string {
  switch (code) {
    case "paused":
      return copy.reasonPaused;
    case "cooldown":
      return copy.reasonCooldown;
    case "low_credit":
      return copy.reasonLowCredit;
    case "missing_env":
      return copy.reasonMissingEnv;
    case "token":
      return copy.reasonToken;
    case "rate_limited":
      return copy.reasonRateLimited;
    case "http_error":
      return copy.reasonHttp;
    case "request_error":
      return copy.reasonRequest;
    case "failed_bookings":
      return copy.reasonFailedBookings;
    case "credit_unknown":
      return copy.reasonCreditUnknown;
    case "max_pages":
      return copy.reasonMaxPages;
    case "lost_lease":
      return copy.reasonLostLease;
    case "time_budget":
      return copy.reasonTimeBudget;
    default:
      return fill(copy.reasonOther, { code: code ?? "?" });
  }
}
