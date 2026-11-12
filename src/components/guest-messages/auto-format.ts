/**
 * 자동 안내 화면 글자 — PC 탭 · 대화 패널 · 모바일 예약 정보 시트 공용(순수). docs/product/47-guest-messaging.md §5-3 · §5-6
 * 시각은 모두 도쿄(`Asia/Tokyo`).
 */

import { fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { autoRunDisplay, type AutoRule, type AutoRunView, type AutoVariable } from "@/lib/guest-messages/auto-model";

const TZ = "Asia/Tokyo";

function localeTag(locale: string): string {
  return locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR";
}

/** 「11/13 18:00」 꼴(언어별 월 · 일, 24시간). */
export function formatAutoAt(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: locale === "en" ? "short" : "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TZ,
  }).format(new Date(iso));
}

/** 목록 「보내는 때」. */
export function autoWhenText(rule: Pick<AutoRule, "trigger" | "offsetDays" | "sendTime">, copy: GmCopy): string {
  const time = rule.sendTime ?? "";
  const n = rule.offsetDays;
  switch (rule.trigger) {
    case "confirmed":
      return copy.autoWhenConfirmed;
    case "before_checkin":
      return fill(n === 1 ? copy.autoWhenBeforeCheckinOne : copy.autoWhenBeforeCheckin, { n, time });
    case "day_of_checkin":
      return fill(copy.autoWhenDayOfCheckin, { time });
    case "before_checkout":
      return n === 0
        ? fill(copy.autoWhenCheckoutDay, { time })
        : fill(n === 1 ? copy.autoWhenBeforeCheckoutOne : copy.autoWhenBeforeCheckout, { n, time });
    case "after_checkout":
      return fill(n === 1 ? copy.autoWhenAfterCheckoutOne : copy.autoWhenAfterCheckout, { n, time });
  }
}

const VAR_LABEL: Record<AutoVariable, keyof GmCopy> = {
  guest_name: "varGuestName",
  checkin_date: "varCheckin",
  checkout_date: "varCheckout",
  nights: "varNights",
  guests: "varGuests",
  building: "varBuilding",
  room: "varRoom",
  checkin_time: "fieldCheckIn",
  checkout_time: "fieldCheckOut",
  wifi_name: "fieldWifiName",
  wifi_password: "fieldWifiPassword",
  directions: "fieldDirections",
  luggage: "fieldLuggage",
  parking: "fieldParking",
  trash: "fieldTrash",
  free_text: "fieldFreeText",
  entry_code_shared: "varEntryShared",
  entry_code_room: "varEntryRoom",
};

export function autoVariableLabel(name: string, copy: GmCopy): string {
  const key = VAR_LABEL[name as AutoVariable];
  return key ? (copy[key] as string) : name;
}

export function missingText(names: readonly string[], copy: GmCopy): string {
  return names.map((name) => autoVariableLabel(name, copy)).join(" · ");
}

/** 상태 글자 + 급함(빨강) 여부. */
export function autoRunStatusText(
  run: Pick<AutoRunView, "status" | "skipReason" | "outboxStatus" | "missingVariables">,
  copy: GmCopy,
): { text: string; urgent: boolean } {
  switch (autoRunDisplay(run)) {
    case "scheduled":
      return { text: copy.autoRunScheduled, urgent: false };
    case "paused":
      return { text: copy.autoRunPaused, urgent: false };
    case "blocked":
      return { text: fill(copy.autoRunBlocked, { fields: missingText(run.missingVariables, copy) }), urgent: true };
    case "queued":
      return { text: copy.autoRunQueued, urgent: false };
    case "sent":
      return { text: copy.autoRunSent, urgent: false };
    case "failed":
      return { text: copy.autoRunFailed, urgent: true };
    case "uncertain":
      return { text: copy.autoRunUncertain, urgent: true };
    case "cancelled":
      return { text: copy.autoRunCancelled, urgent: false };
    case "skipped":
      switch (run.skipReason) {
        case "direct_booking":
          return { text: copy.autoSkipDirect, urgent: false };
        case "unknown_channel":
          return { text: copy.autoSkipUnknown, urgent: false };
        case "past_due":
          return { text: copy.autoSkipPast, urgent: false };
        case "no_body":
          return { text: copy.autoSkipNoBody, urgent: false };
        default:
          return { text: copy.autoRunCancelled, urgent: false };
      }
  }
}
