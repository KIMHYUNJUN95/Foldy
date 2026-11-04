import { CALENDAR_BUILDING_ORDER, CANONICAL_TO_BUILDING_KEY } from "@/lib/room-label-normalization";
import { tokyoToday } from "@/lib/tokyo-date";

// 셀프 체크인 직원 화면의 판정 · 표시 규칙(DB 없음). 서버 · 클라이언트 모두 import 할 수 있다. docs/engineering/16 §4-1.

export type CheckinStayStatus = "pending" | "pre_registered" | "in_progress" | "checked_in" | "expired" | "cancelled";

/** 목록 묶음 — 할 일 순(시안 S1): 확인 필요 → 진행 중 → 아직 → 끝남. */
export type CheckinArrivalGroup = "attention" | "in_progress" | "not_yet" | "done";

export type CheckinChannel = "airbnb" | "booking" | "manual";

export type CheckinArrivalRow = {
  stayId: string;
  status: Exclude<CheckinStayStatus, "cancelled">;
  group: CheckinArrivalGroup;
  /** 예약자 — 대표자 명부 이름, 없으면 예약 이름. */
  leadName: string | null;
  channel: CheckinChannel;
  reservationNumber: string;
  propertyKey: string;
  /** 건물 정규 이름 — 그릴 때 현지화한다. */
  propertyName: string;
  roomLabels: string[];
  checkInDate: string;
  checkOutDate: string;
  /** 예약 인원. */
  guestCountExpected: number;
  /** 손님이 말한 실제 인원, 없으면 예약 인원. */
  partySize: number;
  rosterCount: number;
  /** 필수 칸까지 채운 사람 수(점 채움). 여권 사진 없음은 세지 않는다 — 완료 판정과 같다. */
  rosterFilled: number;
  partyMismatch: boolean;
  /** 체크인이 끝났는데 직원이 봐야 하는 사람 수. */
  staffCheckCount: number;
  checkedInAt: string | null;
  /** 진행 중이면 세션 시작 시각. */
  startedAt: string | null;
  route: "tablet" | "pre_registered" | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
};

export type CheckinArrivalSummary = {
  arrivals: number;
  checkedIn: number;
  inProgress: number;
  preRegistered: number;
  /** 사전 등록 안 한 도착 전. */
  notArrived: number;
  expired: number;
  /** 아직 — 사전 등록 + 도착 전 + 기간 지남. */
  notYet: number;
  needsAttention: number;
  verified: number;
};

// ── 건물 ────────────────────────────────────────────────────────────────────
// 사노는 태블릿이 없어 stay 를 만들지 않는다(apps/checkin sync/plan.ts `EXCLUDED_PROPERTY_KEYS`).
export const CHECKIN_PROPERTIES: readonly { key: string; name: string }[] = CALENDAR_BUILDING_ORDER.filter(
  (name) => name !== "사노",
).map((name) => ({ key: CANONICAL_TO_BUILDING_KEY[name], name }));

export function checkinPropertyName(propertyKey: string): string | null {
  return CHECKIN_PROPERTIES.find((property) => property.key === propertyKey)?.name ?? null;
}

// ── 날짜 ────────────────────────────────────────────────────────────────────
/** 날짜를 안 주면 도쿄 오늘. 없는 날짜(2026-02-30)는 null. */
export function resolveArrivalDate(input?: string | null): string | null {
  if (input === undefined || input === null || input === "") return tokyoToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const [year, month, day] = input.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? input : null;
}

// ── 사람 한 줄 판정 ──────────────────────────────────────────────────────────
export type StoredGuest = {
  is_representative: boolean;
  guest_type: string;
  name_roman: string | null;
  nationality: string | null;
  has_japan_address: boolean | null;
  passport_number: string | null;
  age: number | null;
  contact: string | null;
  gender: string | null;
  no_passport_reason: string | null;
  address: string | null;
  prev_stay: string | null;
  next_dest: string | null;
};

export type MissingField =
  | "name"
  | "address"
  | "nationality"
  | "passport_number"
  | "passport_photo"
  | "age"
  | "contact"
  | "gender"
  | "prev_stay"
  | "next_dest";

export type StaffCheckGuest = {
  hasFaceVideo: boolean;
  noPassportReason: string | null;
  mrzValid: boolean | null;
  missing: string[];
};

// 아래 두 함수는 apps/checkin `guest/fields.ts` · `kiosk/complete.ts` 의 사본이다(두 앱은 서로 import 하지 않는다).
// checkin-cross-app.test.ts 가 본문이 같은지 본다 — 한쪽을 고치면 거기서 깨진다.
export function missingFields(guest: StoredGuest, hasPassportPhoto: boolean): MissingField[] {
  const missing: MissingField[] = [];
  if (!guest.name_roman) missing.push("name");
  if (!guest.address) missing.push("address");
  if (guest.is_representative && !guest.contact) missing.push("contact");
  if (!guest.gender) missing.push("gender");
  if (guest.age === null) missing.push("age");
  if (!guest.prev_stay) missing.push("prev_stay");
  if (!guest.next_dest) missing.push("next_dest");
  if (guest.has_japan_address) return missing;
  // 「child」 사유는 어린이만. 태블릿의 다른 사유(카메라 불가 · 여권 거부 등)는 직원 확인으로 넘기고 진행(44 FR-K16).
  const reason = guest.no_passport_reason;
  const passportExempt = !!reason && (reason !== "child" || guest.guest_type === "child");
  if (!guest.nationality) missing.push("nationality");
  if (!passportExempt && !guest.passport_number) missing.push("passport_number");
  if (!passportExempt && !hasPassportPhoto) missing.push("passport_photo");
  return missing;
}

export function needsStaffCheck(guest: StaffCheckGuest): boolean {
  return !guest.hasFaceVideo || !!guest.noPassportReason || guest.mrzValid === false || guest.missing.length > 0;
}

/** 필수 칸까지 채웠는가 — 여권 사진은 완료를 막지 않으므로(complete.ts `NON_BLOCKING_MISSING`) 세지 않는다. */
export function isRosterFilled(missing: readonly MissingField[]): boolean {
  return missing.every((field) => field === "passport_photo");
}

/** 여권 번호는 늘 가려서 보낸다(시안 S1 `18AB•••••42`). 원문은 응답에 싣지 않는다. */
export function maskPassportNumber(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 6) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(value.length - 6)}${value.slice(-2)}`;
}

// ── 예약 한 줄 판정 ──────────────────────────────────────────────────────────
/**
 * 인원 불일치: 손님이 인원을 바꿨거나(`party_size`), 체크인이 끝났는데 명부 수가 예약 인원과 다르면.
 * 체크인 전에 명부가 덜 찬 것은 불일치가 아니다(아직 입력 중).
 */
export function isPartyMismatch(stay: {
  status: string;
  guestCountExpected: number;
  partySize: number;
  rosterCount: number;
}): boolean {
  if (stay.partySize !== stay.guestCountExpected) return true;
  return stay.status === "checked_in" && stay.rosterCount !== stay.guestCountExpected;
}

export function arrivalGroup(row: {
  status: string;
  verifiedAt: string | null;
  partyMismatch: boolean;
  staffCheckCount: number;
}): CheckinArrivalGroup {
  if (row.status === "checked_in") {
    return !row.verifiedAt && (row.partyMismatch || row.staffCheckCount > 0) ? "attention" : "done";
  }
  return row.status === "in_progress" ? "in_progress" : "not_yet";
}

const GROUP_ORDER: readonly CheckinArrivalGroup[] = ["attention", "in_progress", "not_yet", "done"];

export function sortArrivalRows(rows: readonly CheckinArrivalRow[]): CheckinArrivalRow[] {
  return [...rows].sort((a, b) => {
    const byGroup = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (byGroup !== 0) return byGroup;
    const byTime = (a.checkedInAt ?? a.startedAt ?? "").localeCompare(b.checkedInAt ?? b.startedAt ?? "");
    return byTime !== 0 ? byTime : (a.leadName ?? "").localeCompare(b.leadName ?? "");
  });
}

export function summarizeArrivals(rows: readonly CheckinArrivalRow[]): CheckinArrivalSummary {
  const count = (test: (row: CheckinArrivalRow) => boolean) => rows.filter(test).length;
  const preRegistered = count((row) => row.status === "pre_registered");
  const notArrived = count((row) => row.status === "pending");
  const expired = count((row) => row.status === "expired");
  return {
    arrivals: rows.length,
    checkedIn: count((row) => row.status === "checked_in"),
    inProgress: count((row) => row.status === "in_progress"),
    preRegistered,
    notArrived,
    expired,
    notYet: preRegistered + notArrived + expired,
    needsAttention: count((row) => row.group === "attention"),
    verified: count((row) => row.verifiedAt !== null),
  };
}

// ── 기기 ────────────────────────────────────────────────────────────────────
/** 태블릿은 5분마다 핑을 보낸다 — 세 번 빠지면 끊김. */
export const DEVICE_DISCONNECTED_AFTER_MS = 15 * 60_000;

export function isDeviceDisconnected(lastSeenAt: string | null, now: Date): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - Date.parse(lastSeenAt) > DEVICE_DISCONNECTED_AFTER_MS;
}

/** 태블릿이 넣는 8자리 등록 코드 모양(apps/checkin `/api/device/enroll`, DB check 와 같다). */
export const ENROLLMENT_CODE_PATTERN = /^[0-9]{8}$/;

export function formatEnrollmentCode(value: number): string {
  return String(value).padStart(8, "0");
}
