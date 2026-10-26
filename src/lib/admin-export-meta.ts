import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";
import type { AppSession } from "@/lib/session";

// 모든 관리자 콘솔 Excel/PDF 내보내기가 공유하는 머리글/바닥글 메타데이터.
//
// 로케일 규칙 (깨지 말 것): 내보내기 로케일은 항상 행위자 본인의 `session.user.preferredLanguage` 에서
// 서버가 해석한다. 클라이언트 컴포넌트는 내보내기 액션에 로케일을 넘기지 않는다 —
// 그러지 않으면 로그인한 사용자가 고르지 않은 언어로 파일이 나올 수 있다.

export type AdminExportMeta = {
  locale: Locale;
  localeTag: string;
  orgName: string;
  /** e.g. "생성일시 · 2026-07-14 09:31" */
  generatedLabel: string;
  /** Canonical shared labels (export buttons, No./합계 column headers, print button). */
  shared: Dictionary["admin"]["shared"];
};

export function adminLocaleTag(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

/** "2026-07-01" → "20260701", 내보내기 파일명용. */
export function compactRangePart(value: string): string {
  return value.replace(/-/g, "");
}

export function buildAdminExportMeta(session: AppSession): AdminExportMeta {
  const locale = session.user.preferredLanguage;
  const localeTag = adminLocaleTag(locale);
  const dictionary = getDictionary(locale);
  const shared = dictionary.admin.shared;

  const generatedAt = new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  return {
    locale,
    localeTag,
    orgName: session.organization.name ?? "",
    generatedLabel: `${shared.exportGeneratedLabel} · ${generatedAt}`,
    shared,
  };
}
