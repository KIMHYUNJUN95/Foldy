// 관리자 수리·점검 콘솔의 공용 표시 헬퍼 — 상태 필, 우선순위 배지, 카테고리
// 칩, 파생 (재실 중 / 오래 방치 / 사진 개수) 배지. 보드, 목록, 패널, 모달이 모두 렌더링한다
// 이들을 거쳐 넷이 시각적으로 같게 유지된다.
import type { ComponentType, SVGProps } from "react";
import {
  Ban,
  Camera,
  Droplet,
  Ellipsis,
  Hammer,
  Inbox,
  CircleCheck,
  Package,
  Plug,
  Snowflake,
  Sofa,
  SprayCan,
  TriangleAlert,
  User,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";
import type { Dictionary, Locale } from "@/lib/i18n";
import type {
  MaintenanceCategory as MaintCategory,
  MaintenancePriority as MaintPriority,
  MaintenanceStatus as MaintStatus,
} from "@/lib/maintenance-constants";
import {
  MAINT_CATEGORY,
  MAINT_PRIORITY,
  MAINT_STATUS,
  avatarColorFor,
} from "./maintenance-console-data";

export type MaintCopy = Dictionary["maintenance"]["console"];
type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export const STATUS_ICON: Record<MaintStatus, IconType> = {
  open: Inbox,
  in_progress: Wrench,
  closed: CircleCheck,
  cancelled: Ban,
};

export const CATEGORY_ICON: Record<MaintCategory, IconType> = {
  electric: Zap,
  water: Droplet,
  air_conditioning_heating: Snowflake,
  wifi: Wifi,
  furniture: Sofa,
  appliance: Plug,
  cleaning_condition: SprayCan,
  supplies: Package,
  damage: Hammer,
  other: Ellipsis,
};

export function copyOf(t: MaintCopy, key: string): string {
  return (t as unknown as Record<string, string>)[key] ?? key;
}

export function statusLabel(status: MaintStatus, t: MaintCopy): string {
  return copyOf(t, MAINT_STATUS[status].key);
}
export function priorityLabel(priority: MaintPriority, t: MaintCopy): string {
  return copyOf(t, MAINT_PRIORITY[priority].key);
}
export function categoryLabel(category: MaintCategory, t: MaintCopy): string {
  return copyOf(t, MAINT_CATEGORY[category].key);
}

/** open / in_progress 는 상태 아이콘을 보이고, 종료 상태는 단순 점을 보인다 (디자인 핸드오프 규칙). */
export function StatusPill({ status, t }: { status: MaintStatus; t: MaintCopy }) {
  const Icon = STATUS_ICON[status];
  const showIcon = status === "open" || status === "in_progress";
  return (
    <span className={`cstat cstat--${MAINT_STATUS[status].cls}`}>
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

export function PriorityBadge({ priority, t }: { priority: MaintPriority; t: MaintCopy }) {
  return (
    <span className={`pri pri--${MAINT_PRIORITY[priority].cls}`}>
      <span className="d" />
      {priorityLabel(priority, t)}
    </span>
  );
}

export function CategoryChip({
  category,
  t,
  align,
}: {
  category: MaintCategory;
  t: MaintCopy;
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

export function OccupiedBadge({ t }: { t: MaintCopy }) {
  return (
    <span className="occ">
      <span className="ic">
        <User aria-hidden="true" />
      </span>
      {t.occupied}
    </span>
  );
}

export function AgingTag({ t }: { t: MaintCopy }) {
  return (
    <span className="agingtag">
      <span className="ic">
        <TriangleAlert aria-hidden="true" />
      </span>
      {t.oldFlag}
    </span>
  );
}

export function PhotoBadge({ count }: { count: number }) {
  return (
    <span className={`phcount${count ? "" : " is-none"}`}>
      <span className="ic">
        <Camera aria-hidden="true" />
      </span>
      {count}
    </span>
  );
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
