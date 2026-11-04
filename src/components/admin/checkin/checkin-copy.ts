import type { CheckinChannel, MissingField } from "@/lib/checkin/model";
import type { CodeErrorKey, RowStatusKey } from "@/lib/checkin/staff-view";
import type { Dictionary, Locale } from "@/lib/i18n";

// 셀프 체크인 직원 화면 문구 고르기 — 키 → `dictionary.checkinStaff` 문구. 문구 자체는 i18n.ts 에만 있다.

export type CheckinCopy = Dictionary["checkinStaff"];
export type CheckinSharedCopy = Dictionary["admin"]["shared"];

export function localeTagOf(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

export function statusLabel(key: RowStatusKey, copy: CheckinCopy): string {
  const map: Record<RowStatusKey, string> = {
    verified: copy.statusVerified,
    checkedIn: copy.statusCheckedIn,
    inProgress: copy.statusInProgress,
    preRegistered: copy.statusPreRegistered,
    notArrived: copy.statusNotArrived,
    expired: copy.statusExpired,
    partyMismatch: copy.statusPartyMismatch,
    staffCheck: copy.statusStaffCheck,
  };
  return map[key];
}

export function channelLabel(channel: CheckinChannel, copy: CheckinCopy): string {
  return channel === "airbnb" ? copy.channelAirbnb : channel === "booking" ? copy.channelBooking : copy.channelManual;
}

export function routeLabel(route: "tablet" | "pre_registered" | null, copy: CheckinCopy): string {
  return route === "tablet" ? copy.routeTablet : route === "pre_registered" ? copy.routePreRegistered : "";
}

export function missingLabel(field: MissingField, copy: CheckinCopy): string {
  const map: Record<MissingField, string> = {
    name: copy.missingName,
    address: copy.missingAddress,
    nationality: copy.missingNationality,
    passport_number: copy.missingPassportNumber,
    passport_photo: copy.missingPassportPhoto,
    age: copy.missingAge,
    gender: copy.missingGender,
    contact: copy.missingContact,
    prev_stay: copy.missingPrevStay,
    next_dest: copy.missingNextDest,
  };
  return map[field];
}

export function codeErrorMessage(errorKey: CodeErrorKey, copy: CheckinCopy): string {
  switch (errorKey) {
    case "checked_in":
      return copy.codeErrCheckedIn;
    case "cancelled":
      return copy.codeErrCancelled;
    case "expired":
      return copy.codeErrExpired;
    case "no_code":
      return copy.codeErrNoCode;
    case "not_found":
      return copy.codeErrNotFound;
    case "forbidden":
      return copy.codeErrForbidden;
    default:
      return copy.codeErrFailed;
  }
}
