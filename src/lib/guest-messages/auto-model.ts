/**
 * 자동 안내 — 규칙 검사 · 보낼 시각(도쿄) · 변수 채우기 · 예약마다 계획. **순수 모듈**(서버 import 없음).
 * docs/product/47-guest-messaging.md §5-3 · §5-6
 *
 * - 보낼 시각은 **도쿄 달력 날짜 + 도쿄 시각**(`YYYY-MM-DDTHH:MM:00+09:00`). 날짜 옮기기는 `ymdShift`(달 · 해 넘김은 Date.UTC 정규화).
 *   일본은 서머타임이 없어 +09:00 고정이 맞다.
 * - 계획은 매번 처음부터 다시 계산한다(`planAutoRun`) — 예약 날짜가 바뀌면 시각이 따라 바뀌고, 취소되면 빠지고, 건물 정보가 채워지면
 *   「빈 변수」로 막혔던 것이 다시 「보낼 예정」이 된다. 이미 큐에 넣은 것(queued · sent · failed)은 건드리지 않는다.
 * - 같은 규칙은 같은 예약에 한 번만(DB 고유 + 멱등 키 'auto:' || 실행 번호).
 */

import { OTA_SENDABLE_CHANNELS, type GuestChannelKey } from "@/lib/guest-messages/types";
import { GUEST_LANGS, pickLocalized, type GuestInfo, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import { formatGuestDate } from "@/lib/guest-messages/saved-reply-model";
import { replyBlockReason } from "@/lib/guest-messages/inbox-model";
import { isCalendarYmd, tokyoDateOf, ymdShift } from "@/lib/tokyo-date";

export const AUTO_TRIGGERS = ["confirmed", "before_checkin", "day_of_checkin", "before_checkout", "after_checkout"] as const;
export type AutoTrigger = (typeof AUTO_TRIGGERS)[number];

export const AUTO_TARGET_STATUSES = ["confirmed", "request", "inquiry"] as const;
export type AutoTargetStatus = (typeof AUTO_TARGET_STATUSES)[number];

/** 보낼 수 있는 채널만 대상으로 고른다(직접 예약 · 모름은 늘 빠진다). */
export const AUTO_TARGET_CHANNELS = OTA_SENDABLE_CHANNELS;

export const AUTO_RUN_STATUSES = ["scheduled", "skipped", "paused", "queued", "sent", "failed", "cancelled"] as const;
export type AutoRunStatus = (typeof AUTO_RUN_STATUSES)[number];
/** 큐에 넣은 뒤 — 계획이 다시 건드리지 않는다. */
export const AUTO_TERMINAL_STATUSES: readonly AutoRunStatus[] = ["queued", "sent", "failed"];

export type AutoSkipReason =
  | "empty_variable"
  | "direct_booking"
  | "unknown_channel"
  | "cancelled"
  | "past_due"
  | "no_body"
  | "rule_disabled"
  | "not_target";

export const AUTO_LIMITS = { name: 80, body: 2000, count: 50, maxOffset: 30 } as const;

/**
 * 보낼 시각이 이만큼 지났으면 보내지 않는다(past_due). 발송 작업이 한동안 안 돌았을 때 「내일 체크인 안내」가 체크인 뒤에 나가지 않게.
 */
export const AUTO_LATE_GRACE_MS = 6 * 60 * 60 * 1000;
/** 계획하는 예약 범위(도쿄 오늘 기준) — 체크인이 이 날 수 안 · 체크아웃이 지난 지 이 날 수 안. */
export const AUTO_PLAN_AHEAD_DAYS = AUTO_LIMITS.maxOffset + 2;
export const AUTO_PLAN_BEHIND_DAYS = AUTO_LIMITS.maxOffset + 2;

export const AUTO_VARIABLES = [
  "guest_name",
  "checkin_date",
  "checkout_date",
  "nights",
  "guests",
  "building",
  "room",
  "checkin_time",
  "checkout_time",
  "wifi_name",
  "wifi_password",
  "directions",
  "luggage",
  "parking",
  "trash",
  "free_text",
  "entry_code_shared",
  "entry_code_room",
] as const;
export type AutoVariable = (typeof AUTO_VARIABLES)[number];
/** 출입 코드 — 자동 안내에서만 쓴다(답장 칸 넣기 목록의 손님용 칸에는 없다, §6-3). */
export const AUTO_CODE_VARIABLES: readonly AutoVariable[] = ["entry_code_shared", "entry_code_room"];

export type AutoRule = {
  id: string;
  name: string;
  trigger: AutoTrigger;
  offsetDays: number;
  /** HH:MM 도쿄. 확정 직후는 null. */
  sendTime: string | null;
  targetBuildings: string[];
  targetChannels: GuestChannelKey[];
  targetStatuses: AutoTargetStatus[];
  bodies: Localized;
  enabled: boolean;
  enabledAt: string | null;
  sortOrder: number;
  updatedAt: string;
  createdAt: string;
};

export type AutoRuleInput = Pick<
  AutoRule,
  "name" | "trigger" | "offsetDays" | "sendTime" | "targetBuildings" | "targetChannels" | "targetStatuses" | "bodies"
>;

export type AutoRuleInputError = "invalid_input" | "empty" | "too_long" | "invalid_time" | "invalid_offset";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BUILDING_KEY_RE = /^[a-z0-9_]{1,40}$/;

export function isAutoTrigger(value: unknown): value is AutoTrigger {
  return typeof value === "string" && (AUTO_TRIGGERS as readonly string[]).includes(value);
}

/** 트리거별 날 수 범위 — DB 의 auto_message_rules_offset_check 와 같다. */
export function offsetRange(trigger: AutoTrigger): { min: number; max: number } {
  switch (trigger) {
    case "confirmed":
    case "day_of_checkin":
      return { min: 0, max: 0 };
    case "before_checkin":
    case "after_checkout":
      return { min: 1, max: AUTO_LIMITS.maxOffset };
    case "before_checkout":
      return { min: 0, max: AUTO_LIMITS.maxOffset };
  }
}

function stringList(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") return null;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** 저장할 규칙 검사 — 길이를 넘으면 자르지 않고 거절. */
export function validateAutoRuleInput(raw: unknown): { ok: true; value: AutoRuleInput } | { ok: false; error: AutoRuleInputError } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_input" };
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!isAutoTrigger(record.trigger)) return { ok: false, error: "invalid_input" };
  const trigger = record.trigger;
  const range = offsetRange(trigger);
  const offsetDays = range.max === 0 ? 0 : Number(record.offsetDays);
  if (!Number.isInteger(offsetDays) || offsetDays < range.min || offsetDays > range.max) return { ok: false, error: "invalid_offset" };
  let sendTime: string | null = null;
  if (trigger !== "confirmed") {
    if (typeof record.sendTime !== "string" || !TIME_RE.test(record.sendTime)) return { ok: false, error: "invalid_time" };
    sendTime = record.sendTime;
  }
  const buildings = stringList(record.targetBuildings);
  const channels = stringList(record.targetChannels);
  const statuses = stringList(record.targetStatuses);
  if (!buildings || !channels || !statuses) return { ok: false, error: "invalid_input" };
  if (buildings.length > 40 || buildings.some((key) => !BUILDING_KEY_RE.test(key))) return { ok: false, error: "invalid_input" };
  if (channels.some((key) => !(AUTO_TARGET_CHANNELS as readonly string[]).includes(key))) return { ok: false, error: "invalid_input" };
  if (statuses.length === 0 || statuses.some((key) => !(AUTO_TARGET_STATUSES as readonly string[]).includes(key))) {
    return { ok: false, error: "invalid_input" };
  }
  const bodiesRaw = record.bodies;
  if (!bodiesRaw || typeof bodiesRaw !== "object" || Array.isArray(bodiesRaw)) return { ok: false, error: "invalid_input" };
  const bodies = { ko: "", ja: "", en: "" } as Localized;
  for (const lang of GUEST_LANGS) {
    const value = (bodiesRaw as Record<string, unknown>)[lang];
    if (value !== undefined && value !== null && typeof value !== "string") return { ok: false, error: "invalid_input" };
    bodies[lang] = typeof value === "string" ? value.trim() : "";
    if (Array.from(bodies[lang]).length > AUTO_LIMITS.body) return { ok: false, error: "too_long" };
  }
  if (Array.from(name).length > AUTO_LIMITS.name) return { ok: false, error: "too_long" };
  if (!name || !(bodies.ko || bodies.ja || bodies.en)) return { ok: false, error: "empty" };
  return {
    ok: true,
    value: {
      name,
      trigger,
      offsetDays,
      sendTime,
      targetBuildings: buildings,
      targetChannels: channels as GuestChannelKey[],
      targetStatuses: statuses as AutoTargetStatus[],
      bodies,
    },
  };
}

// ── 보낼 시각 ────────────────────────────────────────────────────────────────

/** 도쿄 날짜 + 도쿄 시각 → 그 순간(ms). 없는 날짜 · 시각이면 null. */
export function tokyoInstant(ymd: string, hhmm: string): number | null {
  if (!isCalendarYmd(ymd) || !TIME_RE.test(hhmm)) return null;
  const ms = Date.parse(`${ymd}T${hhmm}:00+09:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** 규칙의 보낼 날(도쿄). 확정 직후는 null(날짜가 아니라 처음 본 순간). */
export function scheduledDayFor(
  rule: Pick<AutoRule, "trigger" | "offsetDays">,
  booking: { checkInDate: string | null; checkOutDate: string | null },
): string | null {
  switch (rule.trigger) {
    case "confirmed":
      return null;
    case "before_checkin":
      return isCalendarYmd(booking.checkInDate) ? ymdShift(booking.checkInDate, -rule.offsetDays) : null;
    case "day_of_checkin":
      return isCalendarYmd(booking.checkInDate) ? booking.checkInDate : null;
    case "before_checkout":
      return isCalendarYmd(booking.checkOutDate) ? ymdShift(booking.checkOutDate, -rule.offsetDays) : null;
    case "after_checkout":
      return isCalendarYmd(booking.checkOutDate) ? ymdShift(booking.checkOutDate, rule.offsetDays) : null;
  }
}

/**
 * 보낼 순간(ISO). 확정 직후는 `confirmedSeenAt`(처음 확정으로 본 순간 — 이미 계획이 있으면 그 시각을 그대로).
 */
export function scheduledAtFor(
  rule: Pick<AutoRule, "trigger" | "offsetDays" | "sendTime">,
  booking: { checkInDate: string | null; checkOutDate: string | null },
  confirmedSeenAt: string,
): string | null {
  if (rule.trigger === "confirmed") return confirmedSeenAt;
  const day = scheduledDayFor(rule, booking);
  if (!day || !rule.sendTime) return null;
  const ms = tokyoInstant(day, rule.sendTime);
  return ms === null ? null : new Date(ms).toISOString();
}

// ── 예약 ─────────────────────────────────────────────────────────────────────

export type AutoBookingStatus = AutoTargetStatus | "cancelled" | "black";

/** 우리 예약 상태(enum) + Beds24 원래 상태 → 자동 안내 대상 판단용 상태. */
export function autoBookingStatus(reservationStatus: string | null, rawStatus: string | null): AutoBookingStatus {
  const ours = reservationStatus?.trim().toLowerCase() ?? "";
  if (ours === "cancelled" || ours === "no_show") return "cancelled";
  const raw = rawStatus?.trim().toLowerCase() ?? "";
  if (raw === "cancelled" || raw === "canceled" || raw === "0") return "cancelled";
  // Beds24 v1 숫자 상태: 0 취소 · 1 확정 · 2 새 예약 · 3 요청 · 4 검정 · 5 문의(src/lib/beds24/reservation-status.ts 와 같다).
  if (raw === "request" || raw === "3") return "request";
  if (raw === "inquiry" || raw === "5") return "inquiry";
  if (raw === "black" || raw === "4") return "black";
  return "confirmed";
}

export type AutoBooking = {
  provider: "beds24";
  providerBookingId: string;
  reservationId: string | null;
  /** 정본 건물 이름(아라키초A). */
  propertyName: string | null;
  buildingKey: string | null;
  roomLabel: string | null;
  guestName: string | null;
  /** 정리된 손님 언어 코드(ko · ja · en · fr …) 또는 null. */
  guestLanguage: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  status: AutoBookingStatus;
  channel: GuestChannelKey | null;
  guests: number | null;
  /** 우리 예약 행이 처음 생긴 순간 — 확정 직후 규칙은 켠 뒤에 들어온 예약에만(Beds24 `bookingTime` 이 없을 때). */
  createdAt: string | null;
  /** Beds24 `bookingTime`(예약이 들어온 순간, UTC) — 있으면 `createdAt` 보다 먼저 본다(과거 가져오기 · 늦게 들어온 행 대비). */
  bookedAt?: string | null;
  /**
   * 묶음 예약(Beds24 `masterId`)의 대표가 아닌 방 — 안내는 묶음마다 한 번, 대표 예약으로만 간다(임시 결정 — 47 §5-6 · Q).
   * 대표의 `roomLabel` 자리에 묶음의 방 전부가 들어간다(서버가 채움).
   */
  groupMember?: boolean;
  /** 묶음 대표일 때 묶음의 방 전부(살아 있는 방, 정렬). 비면 이 예약의 방 하나. */
  groupRooms?: string[] | null;
};

/** 손님 언어 → 보낼 본문 언어(ko · ja · en, 그 밖은 en). */
export function autoLangFor(guestLanguage: string | null): GuestLang {
  const base = guestLanguage?.toLowerCase().split(/[-_]/)[0] ?? "";
  return (GUEST_LANGS as readonly string[]).includes(base) ? (base as GuestLang) : "en";
}

export function matchesAutoTargets(
  rule: Pick<AutoRule, "targetBuildings" | "targetChannels" | "targetStatuses">,
  booking: Pick<AutoBooking, "buildingKey" | "channel" | "status">,
): boolean {
  if (booking.status === "cancelled" || booking.status === "black") return false;
  if (!rule.targetStatuses.includes(booking.status)) return false;
  if (rule.targetBuildings.length > 0 && (!booking.buildingKey || !rule.targetBuildings.includes(booking.buildingKey))) return false;
  // 채널 대상은 OTA 중에서만 고른다 — 직접 예약 · 모름은 여기서 거르지 않고 skipped(이유 보임)로 남긴다.
  if (rule.targetChannels.length > 0 && booking.channel && (AUTO_TARGET_CHANNELS as readonly string[]).includes(booking.channel)) {
    return rule.targetChannels.includes(booking.channel);
  }
  return true;
}

// ── 변수 ─────────────────────────────────────────────────────────────────────

/** 변수 채우기 재료(언어별 값은 서버가 사전으로 만든다). */
export type AutoFillContext = {
  guestName: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  nights: number | null;
  guests: number | null;
  building: Localized | null;
  room: Localized | null;
  guestInfo: GuestInfo | null;
  /** 공용 출입 코드 줄(「창고: 519」) — 언어별 라벨. 없으면 null. */
  sharedCodes: Localized | null;
  /** 이 방 출입 코드 값. */
  roomCode: string | null;
};

const VARIABLE_RE = /\{([a-z_]+)\}/g;

/** 본문에 쓴 변수(아는 것만, 순서대로 한 번씩). */
export function usedAutoVariables(body: string): AutoVariable[] {
  const out: AutoVariable[] = [];
  for (const match of body.matchAll(VARIABLE_RE)) {
    const name = match[1] as AutoVariable;
    if ((AUTO_VARIABLES as readonly string[]).includes(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

function localizedValue(value: Localized | null | undefined, lang: GuestLang): string | null {
  if (!value) return null;
  return pickLocalized(value, lang)?.text ?? null;
}

export function autoVariableValue(name: AutoVariable, ctx: AutoFillContext, lang: GuestLang): string | null {
  const info = ctx.guestInfo;
  switch (name) {
    case "guest_name":
      return ctx.guestName?.trim() || null;
    case "checkin_date":
      return formatGuestDate(ctx.checkInDate, lang);
    case "checkout_date":
      return formatGuestDate(ctx.checkOutDate, lang);
    case "nights":
      return ctx.nights && ctx.nights > 0 ? String(ctx.nights) : null;
    case "guests":
      return ctx.guests && ctx.guests > 0 ? String(ctx.guests) : null;
    case "building":
      return localizedValue(ctx.building, lang);
    case "room":
      return localizedValue(ctx.room, lang);
    case "checkin_time":
      return info ? localizedValue(info.checkIn, lang) : null;
    case "checkout_time":
      return info ? localizedValue(info.checkOut, lang) : null;
    case "wifi_name":
      return info?.wifiName.trim() || null;
    case "wifi_password":
      return info?.wifiPassword.trim() || null;
    case "directions":
      return info ? localizedValue(info.directions, lang) : null;
    case "luggage":
      return info ? localizedValue(info.luggage, lang) : null;
    case "parking":
      return info ? localizedValue(info.parking, lang) : null;
    case "trash":
      return info ? localizedValue(info.trash, lang) : null;
    case "free_text":
      return info ? localizedValue(info.freeText, lang) : null;
    case "entry_code_shared":
      return localizedValue(ctx.sharedCodes, lang);
    case "entry_code_room":
      return ctx.roomCode?.trim() || null;
  }
}

/** 변수 채우기 — 값이 없는 변수는 그대로 두고 `missing` 에 남긴다(자동 안내는 하나라도 비면 보내지 않는다). */
export function fillAutoVariables(body: string, ctx: AutoFillContext, lang: GuestLang): { text: string; missing: AutoVariable[] } {
  const missing: AutoVariable[] = [];
  const text = body.replace(VARIABLE_RE, (token, name: string) => {
    if (!(AUTO_VARIABLES as readonly string[]).includes(name)) return token;
    const value = autoVariableValue(name as AutoVariable, ctx, lang);
    if (value === null) {
      if (!missing.includes(name as AutoVariable)) missing.push(name as AutoVariable);
      return token;
    }
    return value;
  });
  return { text, missing };
}

export type AutoMessageBuild =
  | { ok: true; text: string; lang: GuestLang }
  | { ok: false; reason: "no_body"; lang: GuestLang }
  | { ok: false; reason: "empty_variable"; lang: GuestLang; missing: AutoVariable[]; text: string };

/** 손님 언어의 본문(없으면 영어) → 채운 글. */
export function buildAutoMessage(bodies: Localized, guestLanguage: string | null, ctx: AutoFillContext): AutoMessageBuild {
  const wanted = autoLangFor(guestLanguage);
  const picked = pickLocalized(bodies, wanted);
  if (!picked) return { ok: false, reason: "no_body", lang: wanted };
  const filled = fillAutoVariables(picked.text, ctx, picked.lang);
  if (filled.missing.length > 0) return { ok: false, reason: "empty_variable", lang: picked.lang, missing: filled.missing, text: filled.text };
  return { ok: true, text: filled.text, lang: picked.lang };
}

// ── 계획 ─────────────────────────────────────────────────────────────────────

export type ExistingAutoRun = {
  id: string;
  status: AutoRunStatus;
  scheduledAt: string;
  skipReason: AutoSkipReason | null;
  missingVariables: string[];
  pausedAt: string | null;
  /** 이 줄을 계획할 때의 규칙 트리거(없으면 옛 줄 — 같은 것으로 본다). */
  trigger?: AutoTrigger | null;
};

export type DesiredAutoRun = {
  status: Exclude<AutoRunStatus, "queued" | "sent" | "failed">;
  scheduledAt: string;
  skipReason: AutoSkipReason | null;
  missingVariables: AutoVariable[];
};

/**
 * 규칙 하나 × 예약 하나의 바라는 상태. `null` = 실행 줄이 필요 없다(아직 없으면 만들지 않음).
 * `"keep"` = 이미 큐에 넣었다(건드리지 않음).
 */
export function planAutoRun(args: {
  rule: AutoRule;
  booking: AutoBooking;
  existing: ExistingAutoRun | null;
  ctx: AutoFillContext;
  now: Date;
}): DesiredAutoRun | "keep" | null {
  const { rule, booking, existing, now } = args;
  if (existing && AUTO_TERMINAL_STATUSES.includes(existing.status)) return "keep";
  const nowIso = now.toISOString();
  // 규칙의 트리거가 바뀌었으면 이 줄은 처음 계획하는 것과 같다(확정 직후의 「처음 본 순간」을 옛 시각으로 두지 않게).
  const triggerChanged = !!existing?.trigger && existing.trigger !== rule.trigger;
  const fresh = !existing || triggerChanged;
  const scheduledAt = scheduledAtFor(rule, booking, fresh ? nowIso : (existing?.scheduledAt ?? nowIso));
  const cancel = (reason: AutoSkipReason): DesiredAutoRun | null =>
    existing ? { status: "cancelled", scheduledAt: scheduledAt ?? existing.scheduledAt, skipReason: reason, missingVariables: [] } : null;

  if (booking.status === "cancelled") return cancel("cancelled");
  if (!rule.enabled) return cancel("rule_disabled");
  // 묶음 예약의 대표가 아닌 방 — 안내는 대표 예약으로 한 번만.
  if (booking.groupMember) return cancel("not_target");
  if (!matchesAutoTargets(rule, booking)) return cancel("not_target");
  if (!scheduledAt) return cancel("not_target");

  if (fresh) {
    // 확정 직후: 규칙을 켠 뒤에 들어온 예약만(Beds24 예약 시각이 있으면 그것, 없으면 우리 행이 생긴 순간) · 체크아웃이 아직 안 지난 예약만
    // (켜자마자 옛 예약 · 과거 가져오기로 들어온 지난 예약에 「확정 안내」가 나가지 않게).
    if (rule.trigger === "confirmed") {
      const since = rule.enabledAt ? Date.parse(rule.enabledAt) : Number.NaN;
      const bookedAt = parseBeds24Instant(booking.bookedAt ?? null);
      const created = bookedAt ?? (booking.createdAt ? Date.parse(booking.createdAt) : Number.NaN);
      if (Number.isNaN(since) || Number.isNaN(created) || created < since) return cancel("not_target");
      const today = tokyoDateOf(nowIso);
      if (!isCalendarYmd(booking.checkOutDate) || !today || booking.checkOutDate < today) return cancel("not_target");
    }
    // 처음 계획할 때 이미 지난 시각이면 만들지 않는다(규칙을 만든 날 체크인한 손님에게 「내일 체크인」이 나가지 않게).
    if (Date.parse(scheduledAt) < now.getTime() - AUTO_LATE_GRACE_MS) {
      return existing ? { status: "skipped", scheduledAt, skipReason: "past_due", missingVariables: [] } : null;
    }
  }

  const refusal = replyBlockReason(booking.channel);
  if (refusal) return { status: "skipped", scheduledAt, skipReason: refusal, missingVariables: [] };

  const built = buildAutoMessage(rule.bodies, booking.guestLanguage, args.ctx);
  if (!built.ok) {
    return built.reason === "no_body"
      ? { status: "skipped", scheduledAt, skipReason: "no_body", missingVariables: [] }
      : { status: "skipped", scheduledAt, skipReason: "empty_variable", missingVariables: built.missing };
  }
  if (existing?.pausedAt) return { status: "paused", scheduledAt, skipReason: null, missingVariables: [] };
  if (Date.parse(scheduledAt) < now.getTime() - AUTO_LATE_GRACE_MS) {
    return { status: "skipped", scheduledAt, skipReason: "past_due", missingVariables: [] };
  }
  return { status: "scheduled", scheduledAt, skipReason: null, missingVariables: [] };
}

/**
 * Beds24 시각 글자 → ms. v2 는 UTC ISO(「2026-11-05T10:20:30Z」). 시간대가 없는 꼴(「2026-11-05 10:20:30」)도 UTC 로 읽는다
 * (Beds24 API 의 시각은 UTC). 못 읽으면 null.
 */
export function parseBeds24Instant(value: string | null | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text);
  const ms = Date.parse(zoned ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 글 안의 출입 코드 값을 「••••」로 가린다(대화에서 출입 코드를 볼 권한이 없는 사람에게 — 47 §5-6 임시 결정). 손님에게 나간 글은 그대로다.
 * 짧은 값(2자 이하)은 다른 숫자까지 가릴 수 있어 건너뛴다. 긴 값부터 바꾼다(「2010」 안의 「201」이 먼저 바뀌지 않게).
 */
export const MASKED_CODE = "••••";
export function maskEntryCodes(text: string, codes: readonly string[]): string {
  const list = [...new Set(codes.map((code) => code.trim()).filter((code) => code.length >= 3))].sort((a, b) => b.length - a.length);
  if (list.length === 0 || !text) return text;
  const pattern = new RegExp(list.map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  return text.replace(pattern, MASKED_CODE);
}

/** 바뀐 칸만(없으면 null). */
export function autoRunPatch(existing: ExistingAutoRun, desired: DesiredAutoRun): Partial<{
  status: DesiredAutoRun["status"];
  scheduled_at: string;
  skip_reason: AutoSkipReason | null;
  missing_variables: string[];
}> | null {
  const patch: ReturnType<typeof autoRunPatch> = {};
  if (existing.status !== desired.status) patch.status = desired.status;
  if (Date.parse(existing.scheduledAt) !== Date.parse(desired.scheduledAt)) patch.scheduled_at = desired.scheduledAt;
  if (existing.skipReason !== desired.skipReason) patch.skip_reason = desired.skipReason;
  const sameMissing =
    existing.missingVariables.length === desired.missingVariables.length &&
    existing.missingVariables.every((name, index) => name === desired.missingVariables[index]);
  if (!sameMissing) patch.missing_variables = desired.missingVariables;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** 지금 큐에 넣을 차례인가(보낼 시각이 됐고 · 늦음 한도 안). */
export function isAutoRunDue(scheduledAt: string, now: Date): boolean {
  const at = Date.parse(scheduledAt);
  return !Number.isNaN(at) && at <= now.getTime() && at >= now.getTime() - AUTO_LATE_GRACE_MS;
}

/** 목록의 「다음 발송」 — 보낼 예정 중 가장 이른 것. */
export function nextScheduledAt(runs: ReadonlyArray<{ status: AutoRunStatus; scheduledAt: string }>, now: Date): string | null {
  let best: number | null = null;
  for (const run of runs) {
    if (run.status !== "scheduled") continue;
    const at = Date.parse(run.scheduledAt);
    if (Number.isNaN(at) || at < now.getTime() - AUTO_LATE_GRACE_MS) continue;
    if (best === null || at < best) best = at;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** 규칙 DB 줄 → 모양. */
export function toAutoRule(row: {
  id: string;
  name: string;
  trigger: string;
  offset_days: number;
  send_time: string | null;
  target_buildings: string[] | null;
  target_channels: string[] | null;
  target_statuses: string[] | null;
  body_ko: string;
  body_ja: string;
  body_en: string;
  enabled: boolean;
  enabled_at: string | null;
  sort_order: number;
  updated_at: string;
  created_at: string;
}): AutoRule | null {
  if (!isAutoTrigger(row.trigger)) return null;
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    offsetDays: row.offset_days,
    sendTime: row.send_time,
    targetBuildings: row.target_buildings ?? [],
    targetChannels: (row.target_channels ?? []).filter((key): key is GuestChannelKey =>
      (AUTO_TARGET_CHANNELS as readonly string[]).includes(key),
    ),
    targetStatuses: (row.target_statuses ?? []).filter((key): key is AutoTargetStatus =>
      (AUTO_TARGET_STATUSES as readonly string[]).includes(key),
    ),
    bodies: { ko: row.body_ko, ja: row.body_ja, en: row.body_en },
    enabled: row.enabled,
    enabledAt: row.enabled_at,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

/** 화면에 보일 실행 한 줄(PC 「보낼 예정」 · 대화 패널 · 모바일 예약 정보 시트). */
export type AutoRunView = {
  id: string;
  ruleId: string;
  ruleName: string;
  providerBookingId: string;
  conversationId: string | null;
  guestName: string | null;
  /** 정본 건물 이름(그릴 때 localize). */
  propertyName: string | null;
  roomLabel: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  channel: string | null;
  scheduledAt: string;
  status: AutoRunStatus;
  skipReason: AutoSkipReason | null;
  missingVariables: string[];
  paused: boolean;
  /** 큐에 넣은 뒤의 발송 상태(queued · sending · sent · uncertain · failed · cancelled). */
  outboxStatus: "queued" | "sending" | "sent" | "uncertain" | "failed" | "cancelled" | null;
};

export type AutoRunDisplay = "scheduled" | "paused" | "blocked" | "skipped" | "queued" | "sent" | "failed" | "uncertain" | "cancelled";

/** 화면 상태 한 가지 — 큐에 넣은 뒤는 큐 상태를 따른다. 빈 변수는 「막힘」(빨강). */
export function autoRunDisplay(run: Pick<AutoRunView, "status" | "skipReason" | "outboxStatus">): AutoRunDisplay {
  if (run.outboxStatus) {
    switch (run.outboxStatus) {
      case "sent":
        return "sent";
      case "failed":
        return "failed";
      case "uncertain":
        return "uncertain";
      case "cancelled":
        return "cancelled";
      default:
        return "queued";
    }
  }
  switch (run.status) {
    case "scheduled":
      return "scheduled";
    case "paused":
      return "paused";
    case "skipped":
      return run.skipReason === "empty_variable" ? "blocked" : "skipped";
    case "queued":
      return "queued";
    case "sent":
      return "sent";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

/** 멈출 수 있나 · 다시 보낼 수 있나(큐에 넣기 전만). */
export function canPauseAutoRun(run: Pick<AutoRunView, "status" | "outboxStatus">): boolean {
  return !run.outboxStatus && (run.status === "scheduled" || run.status === "skipped");
}
export function canResumeAutoRun(run: Pick<AutoRunView, "status" | "outboxStatus">): boolean {
  return !run.outboxStatus && run.status === "paused";
}
