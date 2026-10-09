"use client";

import { useEffect, useSyncExternalStore } from "react";
import { reportClientError } from "@/lib/client-error-report";
import { getDictionary, resolveLocale } from "@/lib/i18n";

/**
 * 공통 오류 화면 — `src/app/error.tsx` · `src/app/global-error.tsx` (2026-10-09, 네이티브 품질 N6).
 *
 * 예전 화면은 흰 바탕에 영어 「Something went wrong. / Try again」뿐이었다. 오프라인에서 화면을 옮기면(서버 데이터 요청 실패)
 * 이 화면이 떴고, 「Try again」은 오프라인이라 아무 반응이 없어 「영어만 나오고 아무것도 안 눌린다」로 보였다.
 *
 * - 3개 언어(`dictionary.appShell`), 문서 언어(`<html lang>`) → 기기 언어 순.
 * - 오프라인이면 오프라인 안내로 바꾸고, 연결이 돌아오면 **자동으로 다시 시도**한다.
 * - 오류는 서버 로그로 보낸다(`reportClientError`).
 * - 스타일은 인라인 — `global-error` 는 루트 레이아웃(전역 CSS)을 대신하므로 클래스에 기댈 수 없다. 색은 앱 바탕(아이보리) · 남색.
 */

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function subscribeNothing() {
  return () => undefined;
}

/** 언어 쿠키(`stayops_locale`, 루트 레이아웃과 같은 값) → 기기 언어. */
function pickStoredLocale(): string {
  const match = document.cookie.match(/(?:^|;\s*)stayops_locale=([a-z]{2})/);
  return match?.[1] ?? navigator.language ?? "ko";
}

/** 문서 언어(`<html lang>`, 루트 레이아웃이 세션 → 쿠키 → 기기 순으로 정한 값). */
function pickDocumentLocale(): string {
  return document.documentElement.lang || pickStoredLocale();
}

export function AppErrorScreen({
  error,
  source,
  onRetry,
  documentLocale = true,
}: {
  error: Error & { digest?: string };
  source: string;
  onRetry: () => void;
  documentLocale?: boolean;
}) {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  // 서버 렌더에서는 언어를 알 수 없다 — useSyncExternalStore 로 하이드레이션 뒤 기기 쪽 값으로 바꾼다(불일치 경고 없이).
  // `global-error` 는 자기 <html> 을 그리므로 문서 언어를 믿을 수 없다 → 쿠키 · 기기 언어.
  const locale = resolveLocale(
    useSyncExternalStore(subscribeNothing, documentLocale ? pickDocumentLocale : pickStoredLocale, () => "ko"),
  );
  const copy = getDictionary(locale).appShell;

  useEffect(() => {
    console.error(error);
    reportClientError(error, source);
  }, [error, source]);

  // 연결이 돌아오면 한 번 자동으로 다시 시도.
  useEffect(() => {
    const retry = () => onRetry();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [onRetry]);

  return (
    <main
      lang={locale}
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "env(safe-area-inset-top) 16px env(safe-area-inset-bottom)",
        background: "#ffffff",
        color: "#16141f",
        textAlign: "center",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Apple SD Gothic Neo", "Noto Sans JP", "Noto Sans KR", system-ui, sans-serif',
      }}
    >
      <div style={{ width: "100%", maxWidth: 340 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 오류 · 오프라인 중에도 떠야 해서 이미지 최적화를 거치지 않는다 */}
        <img
          alt=""
          height={64}
          src="/icons/icon-192.png"
          style={{ display: "block", width: 64, height: 64, margin: "0 auto 20px", borderRadius: 15 }}
          width={64}
        />
        <h1 style={{ margin: "0 0 10px", fontSize: 20, lineHeight: 1.35, fontWeight: 700 }}>
          {online ? copy.errorTitle : copy.offlineTitle}
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#5b6472" }}>
          {online ? copy.errorBody : copy.offlineBody}
        </p>
        <button
          onClick={onRetry}
          style={{
            marginTop: 24,
            width: "100%",
            height: 48,
            border: 0,
            borderRadius: 14,
            background: "#7a52e6",
            color: "#fff",
            font: "inherit",
            fontSize: 15,
            fontWeight: 700,
          }}
          type="button"
        >
          {copy.errorRetry}
        </button>
        <button
          onClick={() => window.location.assign("/")}
          style={{
            marginTop: 10,
            width: "100%",
            height: 44,
            border: 0,
            background: "transparent",
            color: "#7a52e6",
            font: "inherit",
            fontSize: 14,
            fontWeight: 600,
          }}
          type="button"
        >
          {copy.errorHome}
        </button>
      </div>
    </main>
  );
}
