"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { LOCALES, type Locale } from "@/lib/i18n";

import { GlobeIcon } from "./icons";

// 언어 이름은 그 언어로 적는다(고르는 사람이 읽을 수 있게).
export const LOCALE_NAMES: Record<Locale, string> = { ja: "日本語", en: "English", "zh-Hans": "简体中文", ko: "한국어" };

export function setLocaleCookie(locale: Locale) {
  document.cookie = `ci_lang=${locale}; path=/; max-age=${60 * 60 * 24 * 60}; samesite=lax`;
}

export function LangSwitch({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--line)] px-3 text-[14px]"
      >
        <GlobeIcon />
        {LOCALE_NAMES[locale]}
      </button>
      {open ? (
        <ul className="absolute right-0 top-12 z-20 w-44 overflow-hidden rounded-md border border-[var(--line-strong)] bg-[var(--surface)]">
          {LOCALES.map((option) => (
            <li key={option}>
              <button
                type="button"
                lang={option}
                aria-current={option === locale}
                onClick={() => {
                  setLocaleCookie(option);
                  setOpen(false);
                  router.refresh();
                }}
                className="flex h-12 w-full items-center px-4 text-left text-[16px] aria-[current=true]:font-semibold"
              >
                {LOCALE_NAMES[option]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
