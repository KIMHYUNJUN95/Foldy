import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import { getDictionary, pickLocale } from "@/lib/i18n";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = pickLocale((await headers()).get("accept-language"));
  return { title: getDictionary(locale).meta.title, robots: { index: false, follow: false } };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d0e10" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = pickLocale((await headers()).get("accept-language"));
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
