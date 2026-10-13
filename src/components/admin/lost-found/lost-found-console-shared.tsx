// Admin 분실물 console — shared display helpers: status pill, category chip, D-day badges (폐기 임박/
// 만료 및 삭제 임박), 사진 배지, 연장 배지. Board, list, done, disposal, panel and modal all render
// through these so every view stays visually identical. Mirrors maintenance-console-shared.tsx.
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  Briefcase,
  CalendarPlus,
  Camera,
  Droplet,
  Ellipsis,
  FileText,
  Gem,
  Hourglass,
  Inbox,
  Package,
  Plug,
  Shirt,
  TriangleAlert,
  Umbrella,
  Undo2,
  Wallet,
} from "lucide-react";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { LostItemCategory, LostItemStatus } from "@/lib/lost-found-constants";
import {
  CATEGORY_KEY,
  LOST_STATUS,
  avatarColorFor,
  tpl,
  type AdminLostItemVM,
} from "./lost-found-console-data";

export type LFCopy = Dictionary["lostFound"]["console"];
type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export const STATUS_ICON: Record<LostItemStatus, IconType> = {
  registered: Inbox,
  stored: Package,
  disposal_scheduled: Hourglass,
  disposed: Package,
  returned: Undo2,
};

export const CATEGORY_ICON: Record<LostItemCategory, IconType> = {
  electronics: Plug,
  wallet: Wallet,
  accessory: Gem,
  clothing: Shirt,
  document: FileText,
  bag: Briefcase,
  umbrella: Umbrella,
  toiletry: Droplet,
  other: Ellipsis,
};

export function copyOf(t: LFCopy, key: string): string {
  return (t as unknown as Record<string, string>)[key] ?? key;
}

export function statusLabel(status: LostItemStatus, t: LFCopy): string {
  return copyOf(t, LOST_STATUS[status].key);
}
export function categoryLabel(category: LostItemCategory, t: LFCopy): string {
  return copyOf(t, CATEGORY_KEY[category]);
}

/** active(접수/보관중/폐기예정) 상태는 상태 아이콘을, 종결(반환/폐기) 상태는 점(dot) 하나만 보여준다
 *  (수리·점검 콘솔의 StatusPill과 동일 규칙). */
export function StatusPill({ status, t }: { status: LostItemStatus; t: LFCopy }) {
  const Icon = STATUS_ICON[status];
  const showIcon = status === "registered" || status === "stored" || status === "disposal_scheduled";
  return (
    <span className={`cstat cstat--${LOST_STATUS[status].cls}`}>
      {showIcon ? (
        <span className="ic">
          <Icon aria-hidden="true" />
        </span>
      ) : (
        <span className="d" />
      )}
      {statusLabel(status, t)}
    </span>
  );
}

export function CategoryChip({
  category,
  t,
  align,
}: {
  category: LostItemCategory;
  t: LFCopy;
  align?: "end";
}) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className="cat" style={align === "end" ? { justifyContent: "flex-end" } : undefined}>
      <span className="ic">
        <Icon aria-hidden="true" />
      </span>
      {categoryLabel(category, t)}
    </span>
  );
}

/** 보관 연장(hold_until) 배지 — 카드 상단 및 패널 헤더 칩. */
export function ExtBadge({ t }: { t: LFCopy }) {
  return (
    <span className="extb">
      <span className="ic">
        <CalendarPlus aria-hidden="true" />
      </span>
      {t.extended}
    </span>
  );
}

export function PhotoBadge({ count, t }: { count: number; t: LFCopy }) {
  if (!count) {
    return (
      <span className="phcount is-none">
        <span className="ic">
          <Camera aria-hidden="true" />
        </span>
        {t.noPhoto}
      </span>
    );
  }
  return (
    <span className="phcount">
      <span className="ic">
        <Camera aria-hidden="true" />
      </span>
      {tpl(t.photoN, count)}
    </span>
  );
}

/** 폐기 예정 D-day 배지 — 보드 카드 · 목록 due-cell 공용. active 항목에서 daysLeft<0(만료) 또는
 *  0~3(임박)일 때만 렌더한다. */
export function DdayBadge({ item, t }: { item: AdminLostItemVM; t: LFCopy }) {
  if (item.isExpired) {
    return (
      <span className="dday dday--expired">
        <span className="ic">
          <TriangleAlert aria-hidden="true" />
        </span>
        {tpl(t.dOver, Math.abs(item.daysLeft))}
      </span>
    );
  }
  if (item.isDueSoon) {
    return (
      <span className="dday dday--soon">
        <span className="ic">
          <Hourglass aria-hidden="true" />
        </span>
        {item.daysLeft === 0 ? t.dueToday : tpl(t.dueOn, item.daysLeft)}
      </span>
    );
  }
  return null;
}

/** 삭제 예정(폐기 후 90일 자동 삭제) D-day 배지 — 폐기 내역 뷰 전용. */
export function DelDdayBadge({
  daysLeft,
  soon,
  t,
}: {
  daysLeft: number;
  soon: boolean;
  t: LFCopy;
}) {
  const text = daysLeft === 0 ? t.delToday : tpl(t.delDaysLeft, daysLeft);
  if (soon) {
    return (
      <span className="dday dday--delete">
        <span className="ic">
          <TriangleAlert aria-hidden="true" />
        </span>
        {text}
      </span>
    );
  }
  return <span className="dday dday--muted">{text}</span>;
}

export function ReporterAvatar({
  id,
  name,
  className,
}: {
  id: string | null;
  name: string;
  className: string;
}) {
  return (
    <span className={className} style={{ background: id ? avatarColorFor(id) : "var(--adm-surface)" }}>
      {name ? name.slice(0, 1) : "?"}
    </span>
  );
}

export function localeTagOf(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

/** 빈 · 오류 상태 한 덩어리(상자 없음) — 화이트 리디자인(2026-10-14) 보기 4개 공용. */
export function LFState({
  icon,
  title,
  sub,
  action,
  onAction,
}: {
  icon?: ReactNode;
  title: string;
  sub: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="lfw-empty">
      {icon}
      <b>{title}</b>
      <span>{sub}</span>
      {action && onAction ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
