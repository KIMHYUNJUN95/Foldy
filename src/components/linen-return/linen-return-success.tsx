"use client";

// 린넨 반품 등록 완료 순간 — 화이트 리디자인(2026-10-14, 시안 LinenDone-Phone). 문서 19번 「Save And Completion UX」:
// 반복 현장 작업이라 저장 뒤 짧은 완료 순간을 보여 주고 같은 건물 목록으로 돌아간다(그 줄은 잠깐 강조).
// 체크가 그려지고 합계가 차오른 뒤 1.6초에 저절로 닫힌다. 누르면 바로 닫힘. 움직임 줄이기면 체크만 보이고 바로 닫을 수 있다.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { haptic } from "@/lib/haptics";

/** 등록 폼이 저장 직전에 남기는 「방금 보낸 것」 — 합쳐진 기록이면 기록 합계가 아니라 이번에 더한 장수를 보여 주려고. */
export const LINEN_JUST_SAVED_KEY = "foldy-linen-just-saved";
export type LinenJustSaved = { total: number; lines: string };

type Copy = { wDoneTitle: string; wDoneMerged: string; wDoneNew: string; wDoneBack: string };

export function LinenReturnSuccess({
  building,
  buildingLabel,
  copy,
  show,
  merged,
  fallback,
}: {
  building: string;
  buildingLabel: string;
  copy: Copy;
  show: boolean;
  merged: boolean;
  fallback: LinenJustSaved | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(show);
  // 서버 HTML 과 같게 첫 그림은 비우고, 붙은 뒤에 sessionStorage 를 읽는다(하이드레이션 불일치 방지).
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [saved] = useState<LinenJustSaved | null>(() => {
    if (!show || typeof window === "undefined") return fallback;
    try {
      const raw = window.sessionStorage.getItem(LINEN_JUST_SAVED_KEY);
      return raw ? (JSON.parse(raw) as LinenJustSaved) : fallback;
    } catch {
      return fallback;
    }
  });

  const dismiss = useCallback(() => {
    setOpen(false);
    router.replace(`/mobile/linen-return/list?building=${encodeURIComponent(building)}`, { scroll: false });
  }, [building, router]);

  useEffect(() => {
    if (!open) return;
    try {
      window.sessionStorage.removeItem(LINEN_JUST_SAVED_KEY);
    } catch {
      // 지우지 못해도 다음 저장이 덮어쓴다.
    }
    haptic("success");
    const t = window.setTimeout(dismiss, 1600);
    return () => window.clearTimeout(t);
  }, [open, dismiss]);

  if (!open || !hydrated) return null;

  return createPortal(
    <div className="lnw-done" onClick={dismiss} role="status" aria-live="polite">
      <span className="lnw-done__ic" aria-hidden="true">
        <Check />
      </span>
      <b className="lnw-done__t">{copy.wDoneTitle.replace("{n}", String(saved?.total ?? ""))}</b>
      <span className="lnw-done__s">{(merged ? copy.wDoneMerged : copy.wDoneNew).replace("{bld}", buildingLabel)}</span>
      {saved?.lines ? <span className="lnw-done__l">{saved.lines}</span> : null}
      <span className="lnw-done__bar" aria-hidden="true">
        <i />
      </span>
      <span className="lnw-done__back">{copy.wDoneBack.replace("{bld}", buildingLabel)}</span>
    </div>,
    document.body,
  );
}
