/**
 * 손님 메시지 설정 탭 — 응답 목표 · 통로 멈춤 · 크레딧 막대. **순수 모듈**. docs/product/47-guest-messaging.md §6-1 · §6-2
 *
 * - 크레딧 막대는 **기록된 응답 헤더만** 쓴다(이 화면을 열어도 Beds24 를 부르지 않는다). 리셋 시각을 모르거나 지났으면 「모름」.
 * - 「받는 통로 멈춤」 = 마지막 웹훅 뒤 `stall_hours` 가 지났다(경과 시간 — 날짜 자르기 없음, 시각 표시는 화면이 도쿄로).
 *   한 번도 받은 적이 없으면 `never` 로 따로 알린다(설정 전일 수 있다).
 */

import { LOW_CREDIT_THRESHOLD } from "@/lib/beds24/calendar-client";
import type { ResponseTargetCategory } from "@/lib/guest-messages/types";

export const RESPONSE_TARGET_KEYS: readonly ResponseTargetCategory[] = ["inquiry", "request", "staying", "other"];

export const SETTINGS_LIMITS = {
  targetMin: 5,
  targetMax: 24 * 60,
  reserveMin: LOW_CREDIT_THRESHOLD,
  reserveMax: 150,
  stallMin: 1,
  stallMax: 72,
} as const;

/** 5분 한도 — Beds24 기본 100, 이 계정은 200(47 §3-1 · Q8). 기록이 더 크면 그 값을 쓴다. */
export const ASSUMED_FIVE_MIN_LIMIT = 200;

export type GuestMessageSettingsInput = {
  responseTargetMinutes: Record<ResponseTargetCategory, number>;
  nightPause: boolean;
  creditReserve: number;
  stallHours: number;
};

export type SettingsField = ResponseTargetCategory | "creditReserve" | "stallHours";

function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

export function validateGuestMessageSettingsInput(
  raw: unknown,
): { ok: true; value: GuestMessageSettingsInput } | { ok: false; error: "invalid_input"; field: SettingsField | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_input", field: null };
  const record = raw as Record<string, unknown>;
  const targetsRaw = record.responseTargetMinutes;
  if (!targetsRaw || typeof targetsRaw !== "object" || Array.isArray(targetsRaw)) return { ok: false, error: "invalid_input", field: null };
  const targets = {} as Record<ResponseTargetCategory, number>;
  for (const key of RESPONSE_TARGET_KEYS) {
    const value = intIn((targetsRaw as Record<string, unknown>)[key], SETTINGS_LIMITS.targetMin, SETTINGS_LIMITS.targetMax);
    if (value === null) return { ok: false, error: "invalid_input", field: key };
    targets[key] = value;
  }
  if (typeof record.nightPause !== "boolean") return { ok: false, error: "invalid_input", field: null };
  const creditReserve = intIn(record.creditReserve, SETTINGS_LIMITS.reserveMin, SETTINGS_LIMITS.reserveMax);
  if (creditReserve === null) return { ok: false, error: "invalid_input", field: "creditReserve" };
  const stallHours = intIn(record.stallHours, SETTINGS_LIMITS.stallMin, SETTINGS_LIMITS.stallMax);
  if (stallHours === null) return { ok: false, error: "invalid_input", field: "stallHours" };
  return { ok: true, value: { responseTargetMinutes: targets, nightPause: record.nightPause, creditReserve, stallHours } };
}

/** 분 → 화면 칸(60 의 배수면 시간). */
export function splitTargetMinutes(minutes: number): { value: number; unit: "min" | "hour" } {
  return minutes >= 60 && minutes % 60 === 0 ? { value: minutes / 60, unit: "hour" } : { value: minutes, unit: "min" };
}

/** 화면 칸 → 분. 숫자가 아니면 null. */
export function joinTargetMinutes(value: string, unit: "min" | "hour"): number | null {
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return unit === "hour" ? n * 60 : n;
}

export type ChannelStall = { stalled: boolean; never: boolean; hoursSince: number | null };

export function channelStallState(lastWebhookAt: string | null, stallHours: number, now: Date): ChannelStall {
  const at = lastWebhookAt ? Date.parse(lastWebhookAt) : Number.NaN;
  if (Number.isNaN(at)) return { stalled: true, never: true, hoursSince: null };
  const hoursSince = Math.max(0, (now.getTime() - at) / 3_600_000);
  return { stalled: hoursSince >= stallHours, never: false, hoursSince };
}

export type CreditBar =
  | { known: false }
  | {
      known: true;
      limit: number;
      /** 한도를 헤더로 받지 못해 200 으로 추정했나(화면이 「추정」을 붙인다). */
      limitAssumed: boolean;
      remaining: number;
      used: number;
      reserve: number;
      /** 0~100 */
      usedPct: number;
      reservePct: number;
      resetsInSec: number;
      requestCost: number | null;
      /** 남은 양이 남겨 둘 선 아래(자동 안내 · 보정 조회가 쉰다). */
      belowReserve: boolean;
    };

export function creditBarModel(
  record: { remaining: number | null; resetsAt: number | null; requestCost: number | null; limit?: number | null } | null,
  reserve: number,
  nowMs: number,
  assumedLimit: number = ASSUMED_FIVE_MIN_LIMIT,
): CreditBar {
  if (!record || record.remaining === null || record.resetsAt === null || record.resetsAt <= nowMs) return { known: false };
  const remaining = Math.max(0, Math.round(record.remaining));
  const recorded = typeof record.limit === "number" && Number.isFinite(record.limit) && record.limit > 0 ? Math.round(record.limit) : null;
  const limit = Math.max(recorded ?? assumedLimit, remaining);
  const used = limit - remaining;
  const effectiveReserve = Math.max(reserve, LOW_CREDIT_THRESHOLD);
  const pct = (n: number) => Math.round((Math.min(limit, Math.max(0, n)) / limit) * 1000) / 10;
  return {
    known: true,
    limit,
    limitAssumed: recorded === null,
    remaining,
    used,
    reserve: effectiveReserve,
    usedPct: pct(used),
    reservePct: pct(effectiveReserve),
    resetsInSec: Math.max(0, Math.ceil((record.resetsAt - nowMs) / 1000)),
    requestCost: record.requestCost,
    belowReserve: remaining < effectiveReserve,
  };
}

/** 「지금 확인하기」 간격 — 1분에 한 번(크레딧 아끼기). */
export const RECONCILE_NOW_INTERVAL_MS = 60_000;

export function reconcileNowTooSoon(lastReconcileAt: string | null, now: Date): boolean {
  const at = lastReconcileAt ? Date.parse(lastReconcileAt) : Number.NaN;
  return !Number.isNaN(at) && now.getTime() - at < RECONCILE_NOW_INTERVAL_MS;
}
