import type { CleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { fill } from "@/lib/cleaning-assign-i18n";
import { formatCleaningMinutes } from "@/lib/cleaning-record-duration";
import type { Locale } from "@/lib/i18n";

/** 현황판의 「늦은 정도」 — 시간 형식은 청소 기록 소요와 같은 함수 하나. 1시간 미만은 짧게, 이상이면 「시작 예정」을 붙인다. */
export function boardLateText(minutes: number, locale: Locale, copy: CleaningAssignCopy, form: "full" | "tag" = "full"): string {
  const t = formatCleaningMinutes(minutes, locale, { hour: copy.boardUnitHour, min: copy.boardUnitMin });
  if (form === "tag") return fill(copy.boardLateTag, { t });
  return fill(Math.round(minutes) >= 60 ? copy.boardLateHours : copy.boardLate, { t });
}

/** 문구를 「시간 덩어리」 앞뒤로 나눈다 — 화면이 시간 덩어리를 줄바꿈 없는 스팬으로 감싸 「8시간 59분」이 중간에서 안 꺾이게. */
export function boardLateParts(minutes: number, locale: Locale, copy: CleaningAssignCopy): { before: string; t: string; after: string } {
  const t = formatCleaningMinutes(minutes, locale, { hour: copy.boardUnitHour, min: copy.boardUnitMin });
  const template = Math.round(minutes) >= 60 ? copy.boardLateHours : copy.boardLate;
  const [before, after] = template.split("{t}");
  return { after: after ?? "", before: before ?? "", t };
}
