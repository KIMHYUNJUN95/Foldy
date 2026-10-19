"use client";

// 투두 콘솔 화이트 리디자인(2026-10-15) — 콘솔 본체에서 떼어 낸 작은 프리젠테이션 조각.
// 상태를 갖지 않고 props 만 그린다: 우선순위 고리 체크박스 · 진행 고리 · 왼쪽 보기 목록.
// 스타일: admin-tasks-white.css (`atw-` 접두사). See docs/product/28-admin-todoist-console.md.
import type { ReactNode } from "react";
import { Plus } from "lucide-react";

export type RingPrio = "urgent" | "important" | "medium" | "normal" | string;

const prioClass = (p: RingPrio) =>
  p === "urgent" ? "p-urgent" : p === "important" ? "p-important" : p === "medium" ? "p-medium" : "";

/** 체크 표시 — `pathLength=1` 이라 대시 길이 1 로 「그려지는」 움직임을 CSS 로만 준다. */
function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.6 4.5L19 7.5" pathLength={1} />
    </svg>
  );
}

/**
 * 우선순위 색 고리 체크박스. `onToggle` 이 없으면 누를 수 없는 표시용(span)으로 그린다
 * (보낸 지시처럼 내가 완료할 대상이 아닌 줄).
 */
export function TaskRing({
  prio,
  done,
  label,
  onToggle,
  size = "md",
}: {
  prio: RingPrio;
  done: boolean;
  label: string;
  onToggle?: () => void;
  size?: "md" | "lg";
}) {
  const cls = `atw-ring ${prioClass(prio)} ${done ? "is-done" : ""} ${size === "lg" ? "is-lg" : ""}`;
  if (!onToggle)
    return (
      <span className={`${cls} is-static`} role="img" aria-label={label}>
        <CheckMark />
      </span>
    );
  return (
    <button
      type="button"
      className={cls}
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <CheckMark />
    </button>
  );
}

const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;

/** 오늘 진행 고리 — 완료 비율만큼 보라 선이 차오른다(처음 그릴 때 0 에서 출발). */
export function ProgressRing({ done, total, label }: { done: number; total: number; label: string }) {
  const p = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="atw-pring" role="img" aria-label={label}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle className="atw-pring__bg" cx="28" cy="28" r={RING_R} />
        <circle
          className={`atw-pring__fg ${p === 0 ? "is-zero" : ""}`}
          cx="28"
          cy="28"
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - p)}
          transform="rotate(-90 28 28)"
          style={{ "--atw-ring-c": String(RING_C) } as React.CSSProperties}
        />
      </svg>
      <span className="atw-pring__n num">
        {done}/{total}
      </span>
    </div>
  );
}

export type NavItem = {
  key: string;
  label: string;
  icon: ReactNode;
  count?: number;
  /** 지연이 있는 「오늘」처럼 숫자를 빨갛게. */
  alert?: boolean;
  on: boolean;
  onClick: () => void;
};

/** 왼쪽 보기 목록 — 「+ 작업 추가」, 보기들, 프로젝트 묶음. 선택은 옅은 보라 바탕만(왼쪽 막대 없음). */
export function ViewNav({
  aria,
  addLabel,
  onAdd,
  items,
  projectsLabel,
  projects,
  newProjectLabel,
  onNewProject,
}: {
  aria: string;
  addLabel: string;
  onAdd: () => void;
  items: NavItem[];
  projectsLabel: string;
  projects: NavItem[];
  newProjectLabel: string;
  onNewProject: () => void;
}) {
  return (
    <nav className="atw-nav" aria-label={aria}>
      <button type="button" className="atw-nav__add" onClick={onAdd}>
        <Plus size={16} strokeWidth={2.2} />
        {addLabel}
      </button>
      {items.map((it) => (
        <NavRow key={it.key} it={it} />
      ))}
      <span className="atw-nav__grp">{projectsLabel}</span>
      {projects.map((it) => (
        <NavRow key={it.key} it={it} />
      ))}
      <button type="button" className="atw-nav__i is-new" onClick={onNewProject}>
        <span className="atw-nav__ic">+</span>
        <span className="atw-nav__t">{newProjectLabel}</span>
      </button>
    </nav>
  );
}

function NavRow({ it }: { it: NavItem }) {
  return (
    <button
      type="button"
      className={`atw-nav__i ${it.on ? "on" : ""}`}
      aria-current={it.on ? "page" : undefined}
      onClick={it.onClick}
    >
      <span className="atw-nav__ic">{it.icon}</span>
      <span className="atw-nav__t">{it.label}</span>
      {it.count ? <b className={`num ${it.alert ? "is-red" : ""}`}>{it.count}</b> : null}
    </button>
  );
}
