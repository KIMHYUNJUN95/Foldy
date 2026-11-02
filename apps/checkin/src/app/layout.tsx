import type { Metadata, Viewport } from "next";

import { getDictionary } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  // 링크 토큰이 주소에 있으니 다른 사이트로 넘어갈 때 주소를 보내지 않는다.
  return { title: getDictionary(locale).meta.title, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d0e10" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- 시안 G 글꼴(Inter Tight + Noto Sans 4개 언어) */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600&family=Noto+Sans+JP:wght@300;400;500;600&family=Noto+Sans+KR:wght@300;400;500;600&family=Noto+Sans+SC:wght@300;400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
