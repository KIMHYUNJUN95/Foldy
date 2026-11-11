// 연차 화면의 서버 오류 코드 → 문구(2026-11-11). 클라이언트에서 쓴다. 모르는 코드만 일반 저장 실패.
// "network" = 액션 호출 자체가 던진 경우(오프라인 등) — 화면이 catch 에서 넘긴다.
import type { Dictionary } from "@/lib/i18n";

type LeaveCopy = Dictionary["leave"];

export function leaveSubmitErrorText(code: string, c: LeaveCopy): string {
  switch (code) {
    case "hourly_excluded":
      return c.fHourlyPaidErr;
    case "baseline_required":
      return c.fBaselineRequiredErr;
    case "not_editable":
      return c.fNotEditableErr;
    case "too_long":
      return c.fTooLongErr;
    case "invalid_excluded_dates":
      return c.fExcludedErr;
    case "invalid_dates":
    case "invalid_date_range":
      return c.fInvalidDatesErr;
    case "read_failed":
      return c.fReadFailedErr;
    case "network":
      return c.fNetworkErr;
    default:
      return c.exSetupSaveErr;
  }
}

export function leaveBaselineSetupErrorText(code: string, c: LeaveCopy): string {
  switch (code) {
    case "hourly_excluded":
      return c.exSetupHourlyErr;
    case "already_set":
      return c.exSetupAlreadySet;
    case "future_hire_date":
      return c.exSetupFutureErr;
    case "invalid_dates":
    case "invalid_hire_date":
      return c.exSetupDateErr;
    case "read_failed":
      return c.fReadFailedErr;
    case "network":
      return c.fNetworkErr;
    default:
      return c.exSetupSaveErr;
  }
}

type Lc = Dictionary["admin"]["leaveConsole"];

/** PC 관리자 휴가 신청 모달(대리 · 본인) 오류 문구. */
export function adminLeaveFormErrorText(reason: string | undefined, lc: Lc): string {
  switch (reason) {
    case "forbidden":
      return lc.formErrForbidden;
    case "target_not_found":
      return lc.formErrTargetNotFound;
    case "invalid_reason":
      return lc.formErrInvalidReason;
    case "invalid_dates":
      return lc.formErrInvalidDates;
    case "hourly_excluded":
      return lc.formErrHourlyExcluded;
    case "too_long":
      return lc.formErrTooLong;
    case "invalid_excluded_dates":
      return lc.formErrExcluded;
    case "baseline_required":
      return lc.formErrBaselineRequired;
    case "network":
      return lc.errNetwork;
    default:
      return lc.formErrCreateFailed;
  }
}

/** 원래 휴무로 뺀 날 → 「11/22 · 11/23」(정렬, 날짜 키 그대로 — 시간대 변환 없음). */
export function formatExcludedDates(dates: readonly string[] | null | undefined, localeTag: string): string {
  if (!dates || dates.length === 0) return "";
  const fmt = new Intl.DateTimeFormat(localeTag, { month: "numeric", day: "numeric", timeZone: "UTC" });
  return [...dates]
    .sort()
    .map((d) => fmt.format(new Date(`${d}T00:00:00Z`)))
    .join(" · ");
}
