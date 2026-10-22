"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasOpenOverlay } from "@/lib/swipe-back/controller";

/** 이만큼 넘게 나가 있다 돌아오면 새로 고친다. */
const STALE_MS = 5 * 60_000;

/** 지금 무언가 입력 · 작성 중인가 — 그때 통째로 다시 불러오면 쓴 글이 날아간다. */
function isEditing() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('input, textarea, select, [contenteditable="true"]')) return true;
  if (hasOpenOverlay()) return true;
  // 포커스는 없어도 글이 든 칸이 있으면(작성 화면을 두고 나갔다 온 경우) 다시 불러오지 않는다 — 다음 복귀 때 다시 본다.
  // React 의 제어 입력칸은 value 속성까지 맞춰 써서 「바뀐 칸」을 가려낼 수 없어, 빈 칸이 아니면 다 쓰는 중으로 본다.
  const typed = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="number"], input[type="tel"], input[type="email"], input[type="url"]';
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(typed)) {
    if (field.value.trim()) return true;
  }
  return false;
}

async function deployChanged() {
  const current = process.env.FOLDY_DEPLOY_ID;
  if (!current || current === "dev") return false;
  try {
    const res = await fetch("/api/build", { cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json()) as { build?: unknown };
    return typeof body.build === "string" && body.build !== current;
  } catch {
    return false;
  }
}

/**
 * 앱으로 돌아오면 새로 고치기 (2026-10-22 네이티브 점검) — 모바일 레이아웃에 한 번만 둔다. 앱 · 홈 화면 PWA · 브라우저 모두.
 *
 * 전엔 백그라운드에서 돌아와도 화면이 그대로였다 — 아침에 앱을 열면 어젯밤 화면이 보였고 직접 당겨 새로 고쳐야 했다.
 * 이제 5분 넘게 나가 있다 돌아오면(`visibilitychange` — 앱 WebView 도 백그라운드에서 hidden 이 된다):
 * - 그사이 **새 배포**가 나갔고 입력 · 시트 중이 아니면 통째로 다시 불러온다 — 앱은 배포된 웹을 띄우므로 이게 곧 앱 업데이트다.
 * - 아니면 `router.refresh()` — 화면 · 스크롤 · 입력은 그대로 두고 서버 내용만 새로 받는다.
 * 오프라인이면 아무것도 안 한다(오프라인 알약이 알린다). 상세 docs/product/16-mobile-navigation.md 「앱으로 돌아오면 새로 고침」.
 */
export function ResumeRefresh() {
  const router = useRouter();

  useEffect(() => {
    let hiddenAt = document.visibilityState === "hidden" ? Date.now() : 0;

    async function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away < STALE_MS || !navigator.onLine) return;
      if (!isEditing() && (await deployChanged())) {
        window.location.reload();
        return;
      }
      router.refresh();
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  return null;
}
