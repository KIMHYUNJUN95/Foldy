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
import { getDictionary, resolvePreSessionLocale } from "@/lib/i18n";
import { buildOutdatedEngineScript } from "@/lib/outdated-engine-guard";
import { getCurrentAppSession } from "@/lib/session";
import { SPLIT_PANE_BOOT_SCRIPT } from "@/lib/split-pane";
import { STALE_CHUNK_RECOVERY_SCRIPT } from "@/lib/stale-chunk-recovery";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// 고정폭 숫자는 몇 화면(사용자 · 룸 링크 · 청소 · 날짜 범위)만 쓴다 — 모든 화면 첫 로드에 미리 받지 않는다(2026-10-22 첫 실행 속도).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
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

// 세리프 — 관리자 콘솔 워드마크 · 채용 KPI 숫자만 쓴다(admin-console.css `--serif`). 모바일은 안 쓰므로 미리 받지 않는다 —
// 전엔 모든 화면 첫 로드에 4벌을 미리 받았다(2026-10-22 첫 실행 속도: 글꼴 154KB → 48KB).
const notoSerif = Noto_Serif({
  variable: "--font-wordmark",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["italic", "normal"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Foldy",
  description: "Hotel operations app for field staff and office teams.",
  manifest: "/manifest.webmanifest",
  // 초대 전용 비공개 운영 앱 — 모든 페이지를 검색 색인에서 제외한다.
  robots: { index: false, follow: false },
  // iOS 는 홈 화면 아이콘에 매니페스트 아이콘을 쓰지 않고 apple-touch-icon 이 필요하다.
  // 이게 없으면 설치된 앱에 빈 글리프/스크린샷 글리프가 보였다.
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
  // 링크 미리보기(카카오톡 · Slack · iMessage). og 태그가 없으면 카카오톡이 이미지를 추측해서
  // 리브랜딩 이전 그림을 계속 보여줬다. 이미지 자체는 `src/app/opengraph-image.png`(1200×630, 현재
  // 로고)이며 Next 가 이 파일로 og:image 를 추가한다. Vercel 에서는 프로덕션 도메인 기준으로 해석된다.
  openGraph: {
    type: "website",
    siteName: "Foldy",
    title: "Foldy",
    description: "Hotel operations app for field staff and office teams.",
  },
};

// viewportFit: "cover" 로 앱이 화면 끝까지 채워지므로 safe-area-inset-* env()
// 값이 노치 기기에서 0 이 아니게 된다(모바일 셸이 이 값으로 상단 노치와
// 하단 홈 인디케이터 여백을 둔다). themeColor 는 브라우저 상단 크롬 /
// 주소창을 흰색으로 물들여(화이트 리디자인 2026-10-09) 회색 띠 대신 앱과 이어 보이게 한다.
// 라이트/다크 모두 같은 흰색으로 매핑한다: iOS Safari 는 다크 모드에서 단일 themeColor 를
// 무시하고 검은 시스템 크롬으로 되돌아가므로, 같은 흰색의 다크
// 변형을 명시적으로 선언해 두 스킴 모두 라이트 디자인의 크롬이 나오게 한다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // color-scheme: "light" 는 기기가 OS 다크 모드여도 iOS Safari 가 페이지 캔버스를
  // 라이트 모드 기본값으로 그리게 한다. 없으면 Safari 는 themeColor 와 무관하게
  // 다크 크롬/캔버스(상태바 + URL 툴바가 검게 변함)로 되돌아간다 —
  // 사이드바 스크림이 떠 있어 Safari 가 어두워진 콘텐츠를 샘플링할 때 가장 두드러진다.
  colorScheme: "light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#ffffff" },
  ],
};

const LOCALE_COOKIE = "stayops_locale";

/**
 * `<html lang>` — 세션 → `stayops_locale` 쿠키 → Accept-Language(지원하지 않는 언어는 "en", 헤더 없음은 "ko").
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
  return resolvePreSessionLocale({
    cookie: (await cookies()).get(LOCALE_COOKIE)?.value,
    acceptLanguage: (await headers()).get("accept-language"),
  });
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
      {/* iOS PWA 네이티브 스플래시 이미지 — 기기 해상도마다 하나씩.
          이게 없으면 WebView 가 그려지기 전에 iOS 가 빈 흰 화면을 보여준다.
          scripts/gen-splash.mjs 로 생성하며, 아이콘이 바뀌면 다시 실행한다. */}
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
        <link rel="apple-touch-startup-image" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1320-2868.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1290-2796.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1206-2622.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1179-2556.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1284-2778.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1170-2532.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1125-2436.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1242-2688.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/apple-splash-828-1792.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 360px) and (device-height: 780px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1080-2340.png?v=2" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/apple-splash-750-1334.png?v=2" />
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
