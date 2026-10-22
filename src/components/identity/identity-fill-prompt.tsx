"use client";

/**
 * 이미 가입한 사람에게 「이름 정보를 채워 주세요」 — 국적 · 영문 · 가타카나 이름이 없으면 하루 한 번 하단 시트(2026-10-22).
 * 「채우기」 → 내 정보에서 이름 시트를 바로 연다(`/account?mode=mobile&fill=identity`). 「나중에」 → 오늘은 다시 안 뜬다.
 * docs/product/41-residence-card-workflow.md §3-2.
 *
 * 이름이 다 차 있고 신분 서류(재류카드 · 마이넘버 카드 앞면)가 없으면 같은 자리에서 「카드를 등록해 주세요」를 하루 한 번(R2, 2026-10-23).
 * 두 안내는 따로 「나중에」를 기억한다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/shell/bottom-sheet";

const KEY = "foldy.identityPrompt.dismissedOn";
const DOC_KEY = "foldy.idCardPrompt.dismissedOn";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export function IdentityFillPrompt({
  incomplete,
  copy,
  documentPrompt,
}: {
  incomplete: boolean;
  copy: { fillTitle: string; fillBody: string; fillLater: string; fillCta: string };
  /** 신분 서류가 없을 때의 안내(이름이 다 찼을 때만 쓴다). 없으면 띄우지 않는다. */
  documentPrompt?: { title: string; body: string; cta: string } | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const mode: "identity" | "document" | null = incomplete ? "identity" : documentPrompt ? "document" : null;
  const storageKey = mode === "document" ? DOC_KEY : KEY;

  useEffect(() => {
    if (!mode) return;
    let dismissed: string | null = null;
    try {
      dismissed = window.localStorage.getItem(storageKey);
    } catch {
      dismissed = null;
    }
    if (dismissed === todayKey()) return;
    // 스플래시 · 화면 전환이 끝난 뒤에 뜨게 조금 늦춘다.
    const id = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(id);
  }, [mode, storageKey]);

  if (!mode || !open || pathname?.startsWith("/account")) return null;

  const title = mode === "document" && documentPrompt ? documentPrompt.title : copy.fillTitle;
  const body = mode === "document" && documentPrompt ? documentPrompt.body : copy.fillBody;
  const cta = mode === "document" && documentPrompt ? documentPrompt.cta : copy.fillCta;
  const href = mode === "document" ? "/account/id-card?from=prompt" : "/account?mode=mobile&fill=identity";

  function later() {
    try {
      window.localStorage.setItem(storageKey, todayKey());
    } catch {
      // 저장소를 못 쓰면 다음에 또 뜬다 — 그래도 괜찮다.
    }
  }

  return (
    <BottomSheet
      ariaLabel={title}
      onClose={() => {
        later();
        setOpen(false);
      }}
    >
      {({ close }) => (
        <div className="grid gap-4 pb-2 pt-1">
          <div>
            <p className="text-[18px] font-bold tracking-[-0.02em] text-foreground">{title}</p>
            <p className="mt-1.5 text-[14.5px] leading-[1.55] text-muted-foreground">{body}</p>
          </div>
          <Link
            className="flex h-[52px] items-center justify-center rounded-[15px] bg-primary text-[15.5px] font-extrabold text-primary-foreground"
            href={href}
            onClick={() => {
              later();
              setOpen(false);
            }}
          >
            {cta}
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
