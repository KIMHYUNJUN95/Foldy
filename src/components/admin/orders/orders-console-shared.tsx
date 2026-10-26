// Admin 주문·비품 console — 순수 표시 조각: 아이콘 매핑, 상태 pill, 긴급/배송 D-day 배지, 요청자
// 아바타, 품목 요약, 상품 링크 배지, 빈/에러 상태. Board/list/calendar/closed/panel/modal이 전부 이
// 조각을 통해서만 렌더해 시각 일관성을 유지한다. Mirrors lost-found-console-shared.tsx /
// maintenance-console-shared.tsx 와 같은 구조. 참고: docs/product/10-order-request-workflow.md.
import type { ComponentType, SVGProps } from "react";
import {
  ArrowRight,
  Ban,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  Hash,
  Inbox,
  MapPin,
  Package,
  RefreshCw,
  Search,
  ShoppingCart,
  SquareArrowOutUpRight,
  SquarePen,
  Trash2,
  TriangleAlert,
  Truck,
  Undo2,
  X,
  Zap,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { AdminOrderVM, OrderDeliv, OrderItemVM } from "@/lib/admin-orders";
import {
  STATUS,
  delivBadge,
  isActiveStatus,
  type OrderStatus,
  type OrdersLang,
} from "./orders-console-data";

export type OrdersCopy = Dictionary["admin"]["orders"]["console"];
type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/** 설계 inline SVG(`I.xxx`) → lucide 매핑. CONTRACT "아이콘 매핑" 절 그대로. */
const ICON_MAP: Record<string, IconType> = {
  cart: ShoppingCart,
  package: Package,
  extlink: SquareArrowOutUpRight,
  caldays: CalendarDays,
  checkcircle: CircleCheck,
  truck: Truck,
  uturn: Undo2,
  bolt: Zap,
  edit: SquarePen,
  hash: Hash,
  inbox: Inbox,
  ban: Ban,
  search: Search,
  chevD: ChevronDown,
  chevR: ChevronRight,
  back: ChevronLeft,
  x: X,
  warn: TriangleAlert,
  check: Check,
  clock: Clock,
  pin: MapPin,
  camera: Camera,
  download: Download,
  refresh: RefreshCw,
  trash: Trash2,
  alert: CircleAlert,
  arrowR: ArrowRight,
};

export function OrderIcon({ name, className = "ic" }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Package;
  return (
    <span className={className}>
      <Icon aria-hidden="true" />
    </span>
  );
}

export function copyOf(t: OrdersCopy, key: string): string {
  return (t as unknown as Record<string, string>)[key] ?? key;
}

export function isActive(o: AdminOrderVM): boolean {
  return isActiveStatus(o.status);
}

/** "건물 · 객실" (건물 공통 등록이면 buildingWhole 라벨). 검색에도 쓰인다. */
export function locationLabel(o: AdminOrderVM, buildingWholeLabel: string): string {
  return `${o.buildingLabel} · ${o.room ?? buildingWholeLabel}`;
}

export type BuildingOption = { key: string; label: string };
/** 필터 건물 옵션 — orders에서 유도(distinct buildingKey → buildingLabel). */
export function buildingOptionsOf(orders: readonly AdminOrderVM[]): BuildingOption[] {
  const map = new Map<string, string>();
  for (const o of orders) {
    if (!map.has(o.buildingKey)) map.set(o.buildingKey, o.buildingLabel);
  }
  return [...map.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

export type ReporterOption = { id: string; name: string };
/** 필터 요청자 옵션 — orders에서 유도(distinct reporterId → reporterName). */
export function reporterOptionsOf(orders: readonly AdminOrderVM[]): ReporterOption[] {
  const map = new Map<string, string>();
  for (const o of orders) {
    if (!map.has(o.reporterId)) map.set(o.reporterId, o.reporterName);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

// 아바타 팔레트 — 분실물/유지보수 콘솔과 같은 방식 (결정적 해시 → 사용자별로 고정된
// 색).
const AVATAR_PALETTE = [
  "#3f7d5a",
  "#a86b3c",
  "#4d6db5",
  "#557a8a",
  "#7a5aa8",
  "#2f4d8f",
  "#8a5a5a",
  "#5a8a6f",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function avatarColorFor(id: string): string {
  return AVATAR_PALETTE[hashString(id) % AVATAR_PALETTE.length];
}

export function localeTagOf(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

export function StatusPill({ status, t }: { status: OrderStatus; t: OrdersCopy }) {
  const meta = STATUS[status];
  return (
    <span className={`cstat cstat--${meta.cls}`}>
      {status === "closed" ? <span className="d" /> : <OrderIcon name={meta.icon} />}
      {copyOf(t, meta.key)}
    </span>
  );
}

export function UrgBadge({ t }: { t: OrdersCopy }) {
  return (
    <span className="urg">
      <OrderIcon name="bolt" />
      {t.urgent}
    </span>
  );
}

export function DelivDdayBadge({
  deliv,
  todayKey,
  lang,
  t,
}: {
  deliv: OrderDeliv | null;
  todayKey: string;
  lang: OrdersLang;
  t: OrdersCopy;
}) {
  const badge = delivBadge(deliv, todayKey, lang, { dToday: t.dToday, dOver: t.dOver });
  if (!badge) return null;
  return (
    <span className={`dday dday--${badge.kind}`}>
      <OrderIcon name={badge.kind === "over" ? "warn" : "truck"} />
      {badge.text}
    </span>
  );
}

export function ReporterAvatar({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className: string;
}) {
  return (
    <span className={className} style={{ background: id ? avatarColorFor(id) : "var(--adm-surface)" }}>
      {name ? name.slice(0, 1) : "?"}
    </span>
  );
}

export function ItemSummary({ items, t }: { items: OrderItemVM[]; t: OrdersCopy }) {
  const first = items[0]?.name ?? "";
  const more = items.length > 1 ? items.length - 1 : 0;
  return (
    <>
      {first}
      {more > 0 ? (
        <span style={{ color: "var(--adm-muted)" }}>
          {" "}
          {t.itemsMore} {more}
          {t.itemsUnit}
        </span>
      ) : null}
    </>
  );
}

export function DomainLink({ item, t }: { item: OrderItemVM; t: OrdersCopy }) {
  if (!item.domain) return null;
  const label = item.domain === "amazon" ? "Amazon" : item.domain === "ikea" ? "IKEA" : t.linkOther;
  return (
    <a
      className={`dlink dlink--${item.domain}`}
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      title={t.linkOpen}
    >
      <OrderIcon name="cart" />
      {label}
      <span className="ext">
        <OrderIcon name="extlink" />
      </span>
    </a>
  );
}

export function EmptyState({
  iconName,
  tone = "empty",
  title,
  sub,
  actionLabel,
  onAction,
}: {
  iconName: string;
  tone?: "empty" | "ok";
  title: string;
  sub: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="card">
      <div className="state">
        <div className={`state__ic ${tone}`}>
          <OrderIcon name={iconName} />
        </div>
        <div className="state__t">{title}</div>
        <div className="state__s">{sub}</div>
        {actionLabel && onAction ? (
          <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 16 }} onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ErrorState({ t, onRetry }: { t: OrdersCopy; onRetry: () => void }) {
  return (
    <div className="card">
      <div className="state">
        <div className="state__ic err">
          <OrderIcon name="alert" />
        </div>
        <div className="state__t">{t.errT}</div>
        <div className="state__s">{t.errS}</div>
        <button type="button" className="btn btn--pri btn--sm" style={{ marginTop: 16 }} onClick={onRetry}>
          <OrderIcon name="refresh" />
          {t.retry}
        </button>
      </div>
    </div>
  );
}

export type OrdersFilters = {
  status: OrderStatus | "all";
  urgency: "high" | "normal" | "all";
  prop: string;
  reporter: string;
  from: string;
  to: string;
  query: string;
};
