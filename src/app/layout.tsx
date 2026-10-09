import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  Noto_Sans_JP,
  Noto_Sans_KR,
  Noto_Serif,
} from "next/font/google";
import { cookies, headers } from "next/headers";
import Script from "next/script";
import { SessionProvider } from "@/components/providers/session-provider";
import { KeyboardInsetSync } from "@/components/pwa/keyboard-inset-sync";
import { ClientErrorReporter } from "@/components/native/client-error-reporter";
import { NativeAuthBridge } from "@/components/native/native-auth-bridge";
import { NativeShellBridge } from "@/components/native/native-shell-bridge";
import { NativeUpdateGate } from "@/components/native/native-update-gate";
import { HistoryTrackerBoot } from "@/components/shell/history-tracker-boot";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { SplashScreen } from "@/components/pwa/splash-screen";
import { TouchTabletDetect } from "@/components/pwa/touch-tablet-detect";
import { getDictionary, inferLocaleFromAcceptLanguage, isLocale } from "@/lib/i18n";
import { buildOutdatedEngineScript } from "@/lib/outdated-engine-guard";
import { getCurrentAppSession } from "@/lib/session";
import { SPLIT_PANE_BOOT_SCRIPT } from "@/lib/split-pane";
import { STALE_CHUNK_RECOVERY_SCRIPT } from "@/lib/stale-chunk-recovery";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// CJK body fonts — match the design handoff's Korean/Japanese weight (incl. 900/black).
// Geist has no CJK glyphs, so Hangul/Kana previously fell back to a system font with
// no true black weight. preload:false keeps these large fonts off the critical path.
//
// **600 을 반드시 포함한다 (2026-09-10).** 실측하니 600(semibold)이 코드베이스에서 가장 많이 쓰는
// 굵기인데(CSS 264곳 + `font-semibold` 412곳) 로드 목록에 없었다. 없는 굵기는 브라우저가 합성하거나
// 700 으로 스냅해서, **한글만 유독 뭉개지거나 라틴보다 굵게** 보였다. 라틴은 Geist 가 그 굵기를
// 갖고 있어 차이가 더 드러났다.
//
// 굵기를 늘리면 파일이 늘지만 preload:false 라 초기 경로에는 실리지 않는다. 반대로 없는 굵기는
// 모든 화면에서 계속 잘못 그려진다 — 교환이 명확하다.
//
// 두 목록은 **같아야 한다.** 공용 상수로 묶고 싶지만 next/font 는 인자를 빌드 타임에 정적으로
// 읽어서 변수·전개를 받지 않는다("Unexpected spread"). 그래서 값을 두 번 적는다.
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-kr",
  weight: ["400", "500", "600", "700", "800", "900"],
  preload: false,
});

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-jp",
  weight: ["400", "500", "600", "700", "800", "900"],
  preload: false,
});

// Wordmark font — serif italic used for the "Foldy" brand mark across all shells.
const notoSerif = Noto_Serif({
  variable: "--font-wordmark",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["italic", "normal"],
});

export const metadata: Metadata = {
  title: "Foldy",
  description: "Hotel operations app for field staff and office teams.",
  manifest: "/manifest.webmanifest",
  // Private, invite-only ops app — keep every page out of search indexes.
  robots: { index: false, follow: false },
  // iOS ignores the manifest icons for the home-screen icon — it needs apple-touch-icon.
  // Without these the installed app showed a blank/screenshot glyph.
  icons: {
    shortcut: "/favicon.ico",
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Foldy",
  },
};

// viewportFit: "cover" makes the app go edge-to-edge so safe-area-inset-* env()
// values are non-zero on notched devices (the mobile shell pads the top notch and
// bottom home-indicator with them). themeColor tints the browser top chrome /
// address bar white (white redesign 2026-10-09) so it blends with the app instead of a grey band.
// Both light/dark map to the SAME white: iOS Safari ignores a single themeColor in
// dark mode and falls back to black system chrome, so declaring an explicit dark
// variant (identical white) forces the light design's chrome in both schemes.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // color-scheme: "light" tells iOS Safari to render the page canvas with light-mode
  // defaults even when the device is in OS dark mode. Without it, Safari falls back to
  // dark chrome/canvas (status bar + URL toolbar turn black) regardless of themeColor —
  // most visible when the sidebar scrim is up and Safari samples the dimmed content.
  colorScheme: "light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#ffffff" },
  ],
};

const LOCALE_COOKIE = "stayops_locale";

/**
 * `<html lang>` — 세션 → `stayops_locale` 쿠키 → Accept-Language → "ko".
 *
 * 예전에는 세션이 없으면 무조건 "ko" 였다. 로그인·회원가입은 로그아웃 상태에서 보는 화면이라,
 * 일본어/영어로 보고 있어도 문서 언어는 한국어라고 선언돼 있었다 — 스크린리더가 영어 문장을
 * 한국어 음성으로 읽고, `:lang()` 으로 거는 CJK 자간 보정도 엉뚱하게 걸린다.
 *
 * `?lang=` 쿼리는 레이아웃에서 읽을 수 없다(레이아웃에는 searchParams 가 없다). 그래서 로그인·
 * 온보딩 화면은 자기 루트 엘리먼트에 lang 을 한 번 더 달아 그 구간을 메운다.
 */
async function resolveDocumentLocale(session: Awaited<ReturnType<typeof getCurrentAppSession>>) {
  if (session?.user.preferredLanguage) return session.user.preferredLanguage;
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value ?? "";
  if (isLocale(cookieLocale)) return cookieLocale;
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  return inferLocaleFromAcceptLanguage(acceptLanguage);
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentAppSession();
  const documentLocale = await resolveDocumentLocale(session);
  const appShellCopy = getDictionary(documentLocale).appShell;

  return (
    <html
      lang={documentLocale}
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansKr.variable} ${notoSansJp.variable} ${notoSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* iOS PWA native splash images — one per device resolution.
          Without these, iOS shows a blank white screen before the WebView paints.
          Generated by scripts/gen-splash.mjs; re-run when the icon changes. */}
      <head>
        {/* 너무 낡은 브라우저 · Android WebView 면 빈 화면 대신 업데이트 안내(3개 언어) — `src/lib/outdated-engine-guard.ts`.
            Next 런타임이 못 도는 엔진에서도 실행돼야 하므로 next/script 가 아니라 맨 앞 인라인 스크립트. */}
        <script
          dangerouslySetInnerHTML={{
            __html: buildOutdatedEngineScript({
              title: appShellCopy.outdatedTitle,
              bodyApp: appShellCopy.outdatedBodyApp,
              bodyBrowser: appShellCopy.outdatedBodyBrowser,
              action: appShellCopy.outdatedAction,
            }),
          }}
        />
        {/* 배포 직후 서비스 워커 저장본이 옛 JS 청크를 가리켜 시작 화면에 멈추면 새 문서로 한 번 다시 연다 — `src/lib/stale-chunk-recovery.ts`. */}
        <script dangerouslySetInnerHTML={{ __html: STALE_CHUNK_RECOVERY_SCRIPT }} />
        {/* 2분할 오른쪽 칸 안이면 그리기 전에 「칸 모드」로(메뉴 · 머리 숨김) — `src/lib/split-pane.ts`. */}
        <Script id="stayops-split-pane" strategy="beforeInteractive">
          {SPLIT_PANE_BOOT_SCRIPT}
        </Script>
        <link rel="apple-touch-startup-image" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1320-2868.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1290-2796.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1206-2622.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1179-2556.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1284-2778.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1170-2532.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1125-2436.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1242-2688.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/apple-splash-828-1792.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 360px) and (device-height: 780px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1080-2340.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/apple-splash-750-1334.png" />
      </head>
      <body className="flex min-h-full flex-col">
        <SplashScreen />
        <ServiceWorkerRegister />
        <KeyboardInsetSync />
        <TouchTabletDetect />
        <NativeAuthBridge />
        <NativeShellBridge />
        <NativeUpdateGate copy={appShellCopy} />
        <ClientErrorReporter />
        <HistoryTrackerBoot />
        <SessionProvider initialSession={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
