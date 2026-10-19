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

// CJK 본문 폰트 — 가변 폰트(wght 100~900) 한 벌. weight 배열을 주면 굵기마다 @font-face 를
// 따로 만들어 폰트당 745개(CSS 약 1MB, 첫 그림 차단)가 됐다. weight 를 생략하면 next/font 가
// 가변 파일을 쓰므로 400~900(특히 가장 많이 쓰는 600)이 모두 진짜 굵기로 그려진다.
// preload:false 로 큰 폰트가 초기 경로에 실리지 않게 한다.
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-kr",
  preload: false,
});

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-jp",
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
  // Link previews (KakaoTalk · Slack · iMessage). Without og tags KakaoTalk guessed an image and kept
  // showing a pre-rebrand picture. The image itself is `src/app/opengraph-image.png` (1200×630, current
  // logo) — Next adds og:image from that file; on Vercel it resolves against the production domain.
  openGraph: {
    type: "website",
    siteName: "Foldy",
    title: "Foldy",
    description: "Hotel operations app for field staff and office teams.",
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
