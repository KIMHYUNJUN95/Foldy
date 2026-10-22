"use client";

/**
 * 이미 가입한 사람에게 「이름 정보를 채워 주세요」 — 국적 · 영문 · 가타카나 이름이 없으면 하루 한 번 하단 시트(2026-10-22).
 * 「채우기」 → 내 정보에서 이름 시트를 바로 연다(`/account?mode=mobile&fill=identity`). 「나중에」 → 오늘은 다시 안 뜬다.
 * docs/product/41-residence-card-workflow.md §3-2.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";

const KEY = "foldy.identityPrompt.dismissedOn";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export function IdentityFillPrompt({
  incomplete,
  copy,
}: {
  incomplete: boolean;
  copy: { fillTitle: string; fillBody: string; fillLater: string; fillCta: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!incomplete) return;
    let dismissed: string | null = null;
    try {
      dismissed = window.localStorage.getItem(KEY);
    } catch {
      dismissed = null;
    }
    if (dismissed === todayKey()) return;
    // 스플래시 · 화면 전환이 끝난 뒤에 뜨게 조금 늦춘다.
    const id = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(id);
  }, [incomplete]);

  if (!incomplete || !open || pathname?.startsWith("/account")) return null;

  function later() {
    try {
      window.localStorage.setItem(KEY, todayKey());
    } catch {
      // 저장소를 못 쓰면 다음에 또 뜬다 — 그래도 괜찮다.
    }
  }

  return (
    <BottomSheet
      ariaLabel={copy.fillTitle}
      onClose={() => {
        later();
        setOpen(false);
      }}
    >
      {({ close }) => (
        <div className="grid gap-4 pb-2 pt-1">
          <div>
            <p className="text-[18px] font-bold tracking-[-0.02em] text-foreground">{copy.fillTitle}</p>
            <p className="mt-1.5 text-[14.5px] leading-[1.55] text-muted-foreground">{copy.fillBody}</p>
          </div>
          <Link
            className="flex h-[52px] items-center justify-center rounded-[15px] bg-primary text-[15.5px] font-extrabold text-primary-foreground"
            href="/account?mode=mobile&fill=identity"
            onClick={() => {
              later();
              setOpen(false);
            }}
          >
            {copy.fillCta}
          </Link>
          <button
            className="h-[44px] text-[14px] font-bold text-muted-foreground"
            onClick={() => close()}
            type="button"
          >
            {copy.fillLater}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
