// 태블릿 「예약 찾기」 판정(DB 없음 — 테스트로 덮는다). 44 FR-K01 · K02 · K03 · K04 · K17, 시안 T1 · T1k · T1x · T1b · T1c.
import { nameTokens, sameName } from "../guest/match";
import { addDays, todayTokyo } from "../tokyo-date";

export type KioskStayStatus = "pending" | "pre_registered" | "in_progress" | "checked_in" | "expired" | "cancelled";

/** 찾은 예약을 이 태블릿에서 열 수 있는지. 「도착일 0시 ~ 체크아웃 날 12시(도쿄)」 안만 연다. */
export type KioskGate =
  | { kind: "open" }
  | { kind: "checked_in" }
  | { kind: "blocked"; reason: "too_early"; checkInDate: string }
  | { kind: "blocked"; reason: "expired" | "cancelled" };

export function kioskGate(stay: { status: string; checkInDate: string; checkOutDate: string }, now: Date): KioskGate {
  if (stay.status === "cancelled") return { kind: "blocked", reason: "cancelled" };
  if (stay.status === "expired") return { kind: "blocked", reason: "expired" };
  if (todayTokyo(now) < stay.checkInDate) return { kind: "blocked", reason: "too_early", checkInDate: stay.checkInDate };
  if (now.getTime() >= Date.parse(`${stay.checkOutDate}T12:00:00+09:00`)) return { kind: "blocked", reason: "expired" };
  if (stay.status === "checked_in") return { kind: "checked_in" };
  return { kind: "open" };
}

export type NameCandidate = { stayId: string; guestNames: string[] };

/** 이름(성 + 이름)이 **한 예약에만** 맞을 때만 그 예약. 둘 이상이면 아무것도 열지 않는다(남의 예약을 보여 주지 않게). */
export function matchByName(candidates: NameCandidate[], lastName: string, firstName: string): string | null {
  const hits = candidates.filter((candidate) => candidate.guestNames.some((name) => sameName(name, lastName, firstName)));
  return hits.length === 1 ? hits[0].stayId : null;
}

/** 여권 찾기 후보 날짜 — 오늘 · 어제(도쿄). 자정 넘어 도착한 손님용. */
export function passportSearchDates(now: Date): string[] {
  const today = todayTokyo(now);
  return [today, addDays(today, -1)];
}

/**
 * 여권 MRZ(성 · 이름들)로 예약 찾기. sameName 이거나, 예약 이름이 2단어 이상이고 모두 여권 단어 안에 있으며
 * 여권 성 단어가 예약 이름 안에 있으면 맞다(「Daniel Hu」 ↔ HU / DANIEL JAMES). 한 예약에만 맞을 때만 연다.
 */
/** 예약 이름 하나가 여권(성 · 이름들)에 맞는지 — 찾기와 본인 확인이 같은 판정을 쓴다. */
export function nameMatchesPassport(bookedName: string, surname: string, givenNames: string): boolean {
  if (sameName(bookedName, surname, givenNames)) return true;
  const surnameTokens = nameTokens(surname);
  const passportTokens = new Set([...surnameTokens, ...nameTokens(givenNames)]);
  const booked = nameTokens(bookedName);
  if (booked.length < 2 || surnameTokens.length === 0) return false;
  return booked.every((token) => passportTokens.has(token)) && surnameTokens.every((token) => booked.includes(token));
}

export function passportHits(candidates: NameCandidate[], surname: string, givenNames: string): string[] {
  return candidates
    .filter((candidate) => candidate.guestNames.some((name) => nameMatchesPassport(name, surname, givenNames)))
    .map((candidate) => candidate.stayId);
}

export function matchByPassport(candidates: NameCandidate[], surname: string, givenNames: string): string | null {
  const hits = passportHits(candidates, surname, givenNames);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 취소 · 만료 예약은 빼고 여권 이름으로 찾는다. 체크인 끝난 stay(묵는 중) 와 겹치면 어느 쪽인지 알 수 없으므로 열지 않는다
 * (묵는 중인 동명이인이 오늘 도착하는 사람의 예약으로 들어가는 것을 막는다) — 손님은 코드나 이름으로 찾는다.
 * 후보가 전부 도착 예정이면 예전 규칙대로 오늘 도착인 것으로 좁힌다. 그래도 하나가 아니면 열지 않는다.
 */
export function matchByPassportStays(
  candidates: NameCandidate[],
  stays: { id: string; status: string; checkInDate: string }[],
  surname: string,
  givenNames: string,
  today: string,
): string | null {
  const live = new Map(stays.filter((stay) => stay.status !== "cancelled" && stay.status !== "expired").map((stay) => [stay.id, stay]));
  let ids = passportHits(candidates.filter((candidate) => live.has(candidate.stayId)), surname, givenNames);
  if (ids.length > 1 && ids.some((id) => live.get(id)?.status === "checked_in")) return null;
  if (ids.length > 1) {
    const arrivingToday = ids.filter((id) => live.get(id)?.checkInDate === today);
    if (arrivingToday.length > 0) ids = arrivingToday;
  }
  return ids.length === 1 ? ids[0] : null;
}

/** 같은 코드가 여러 줄이면(취소된 옛 예약이 코드를 다시 쓴 경우) 진행 중인 것 → 가장 최근 것. */
export function pickByCode<T extends { status: string; checkInDate: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const active = rows.filter((row) => ["pending", "pre_registered", "in_progress", "checked_in"].includes(row.status));
  const pool = active.length ? active : rows;
  return [...pool].sort((a, b) => b.checkInDate.localeCompare(a.checkInDate))[0];
}

// 틀림 막기: 이 기기에서 연달아 5번 틀릴 때마다 1분 쉼(웹은 10분 — 로비는 여러 손님이 같이 써서 짧게). 10분 안 기록만 센다.
export const KIOSK_MAX_FAILURES = 5;
export const KIOSK_LOCK_MS = 60_000;
export const KIOSK_WINDOW_MS = 10 * 60_000;

export type KioskAttempt = { succeeded: boolean; attempted_at: string };

/** 최근 시도(새것 먼저)로 지금 잠겼는지 · 몇 번 남았는지. 성공하면 앞의 실패는 지운 셈. */
export function kioskLockState(recent: KioskAttempt[], now: Date) {
  const windowStart = now.getTime() - KIOSK_WINDOW_MS;
  let failures = 0;
  let lastFailure: number | null = null;
  for (const row of recent) {
    const at = Date.parse(row.attempted_at);
    if (at < windowStart || row.succeeded) break;
    failures += 1;
    lastFailure ??= at;
  }
  const lockEnd = lastFailure === null ? 0 : lastFailure + KIOSK_LOCK_MS;
  const locked = failures > 0 && failures % KIOSK_MAX_FAILURES === 0 && lockEnd > now.getTime();
  return {
    failures,
    remaining: KIOSK_MAX_FAILURES - (failures % KIOSK_MAX_FAILURES),
    lockedUntil: locked ? new Date(lockEnd).toISOString() : null,
  };
}

/** Beds24 `lang` → 태블릿 언어(ja · en · zh-Hans · ko). 모르는 값이면 null(손님이 고른 언어 그대로). */
export function kioskLanguageOf(lang: string | null | undefined): "ja" | "en" | "zh-Hans" | "ko" | null {
  const value = (lang ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("ja")) return "ja";
  if (value.startsWith("ko")) return "ko";
  if (value.startsWith("zh")) return "zh-Hans";
  if (value.startsWith("en")) return "en";
  return null;
}

/** 같은 예약을 다른 기기가 잡고 있는지(FR-K17). */
export function heldByOther(
  sessions: { device_id: string | null; locked_until: string | null; finished_at: string | null; abandoned_at: string | null }[],
  deviceId: string,
  now: Date,
): boolean {
  return sessions.some(
    (session) =>
      !session.finished_at &&
      !session.abandoned_at &&
      session.device_id !== deviceId &&
      !!session.locked_until &&
      Date.parse(session.locked_until) > now.getTime(),
  );
}

/** 「인원」 ± 의 허용 범위: 저장한 사람 수 아래로는 못 내린다(그 사람은 명부에서 빼는 다른 길로), 1~20. */
export function clampPartySize(requested: number, saved: number): number | null {
  if (!Number.isInteger(requested)) return null;
  if (requested < Math.max(1, saved) || requested > 20) return null;
  return requested;
}

export { todayTokyo };
