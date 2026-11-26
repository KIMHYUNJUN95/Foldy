import type { Locale } from "@/lib/i18n";

/**
 * 에러 · 404 폴백 화면 문구.
 *
 * ## 왜 `src/lib/i18n.ts` 가 아니라 별도 모듈인가
 *
 * 이 문구를 쓰는 화면들은 **앱의 나머지가 고장난 상태에서 떠야 한다.** 에러 바운더리가 11,000줄짜리
 * 사전 모듈을 끌어오면 그 청크 로딩이 실패했을 때 폴백조차 못 뜬다. 그래서 폴백 문구만 의존성 없는
 * 작은 모듈에 따로 둔다 — 대신 ko/ja/en 는 **여기서도 똑같이 필수**다.
 *
 * 2026-08-04 이전에는 세 화면이 세 언어를 **동시에** 쌓아 보여줬다("문제가 발생했어요 / 問題が発生
 * しました / Something went wrong"). 세션 로케일을 모른다는 이유였는데, 실제로는 알 수 있다:
 *   - `error.tsx` 는 클라이언트 컴포넌트 → 루트 레이아웃이 심어 둔 `<html lang>` 을 읽으면 된다.
 *   - `not-found.tsx` 는 서버 컴포넌트 → 세션의 `preferredLanguage` 를 그대로 읽으면 된다.
 * `/offline` 만 예외로 남는다. 서비스 워커가 **네트워크 없이** 캐시에서 내보내는 페이지라 세션도
 * 서버 렌더도 없다 — 그 화면은 3개 국어 병기를 유지한다.
 */

export const FALLBACK_COPY: Record<
  Locale,
  {
    errorTitle: string;
    errorBody: string;
    retry: string;
    home: string;
    notFoundTitle: string;
    notFoundBody: string;
    goHome: string;
  }
> = {
  // i18n-ignore-start: 폴백 화면 전용 문구 테이블(위 주석의 이유로 사전 모듈과 분리).
  ko: {
    errorTitle: "문제가 생겼어요",
    errorBody: "화면을 표시하지 못했어요. 다시 시도해 주세요. 계속되면 소속 조직 관리자에게 알려 주세요.",
    retry: "다시 시도",
    home: "홈으로",
    notFoundTitle: "찾을 수 없어요",
    notFoundBody: "삭제되었거나 존재하지 않는 항목이에요.",
    goHome: "홈으로",
  },
  ja: {
    errorTitle: "問題が発生しました",
    errorBody: "画面を表示できませんでした。もう一度お試しください。続く場合は所属組織の管理者にお知らせください。",
    retry: "再試行",
    home: "ホームへ",
    notFoundTitle: "見つかりませんでした",
    notFoundBody: "削除されたか、存在しない項目です。",
    goHome: "ホームへ",
  },
  en: {
    errorTitle: "Something went wrong",
    errorBody: "This screen couldn't be shown. Please try again. If it keeps happening, let your organization's administrator know.",
    retry: "Try again",
    home: "Go to home",
    notFoundTitle: "Not found",
    notFoundBody: "This item was deleted or doesn't exist.",
    goHome: "Go to home",
  },
  // i18n-ignore-end
};

/**
 * `<html lang>` 등에서 얻은 값을 지원 로케일로 좁힌다. 알 수 없으면 `ko`(기본 운영 언어).
 * 폴백 화면에서 쓰므로 절대 throw 하지 않는다.
 */
export function resolveFallbackLocale(raw: string | null | undefined): Locale {
  const value = String(raw ?? "").toLowerCase();
  if (value.startsWith("ja")) return "ja";
  if (value.startsWith("en")) return "en";
  return "ko";
}
