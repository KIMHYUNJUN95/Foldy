"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

/**
 * MobileFab — 모바일 목록 화면(생성 / 작성 진입점)의 오른쪽 아래에 떠 있는
 * 유일한 표준 플로팅 액션 버튼. 모든 기능의 FAB 이
 * 시각적으로 동일하도록 공용으로 쓴다.
 *
 *   - <body> 로 포털되어 모바일 셸의 당겨서 새로고침 transform 이 끌고 가지 못한다
 *   - 오른쪽 아래 고정, 하단 탭 바 위에 놓이며 safe-area 인셋을 지킨다
 *   - 56px 네이비 원, Plus 글리프, 은은한 네이비 그림자, 누름 시 축소 피드백
 *
 * 이동은 `href`, 커스텀 동작은 `onClick` 을 넘긴다. `label` 은 aria-label.
 */
export function MobileFab({
  href,
  onClick,
  label,
  icon,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  /** 선택: 글리프 교체 (기본은 플러스). */
  icon?: React.ReactNode;
}) {
  const router = useRouter();
  // 클라이언트 전용: 하이드레이션 이후 렌더해 포털 대상(document.body)이 존재하고
  // 서버/클라이언트 마크업이 일치하게 한다. useSyncExternalStore 로 set-state-in-effect 를 피한다.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!hydrated) return null;

  return createPortal(
    <button
      type="button"
      aria-label={label}
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_16px_30px_-10px_hsl(var(--primary-hsl)/0.5)] transition-transform active:scale-[0.93]"
      onClick={() => {
        if (onClick) onClick();
        else if (href) router.push(href);
      }}
    >
      {icon ?? <Plus className="size-6" strokeWidth={2.2} aria-hidden="true" />}
    </button>,
    document.body,
  );
}
