// 관리자 청소 콘솔의 공용 표시 헬퍼 — 상태/유형 아이콘+라벨 조회와 작은
// 재사용 조각(상태 필, 직원 아바타, 보고 배지)을 오늘 보드, 이력
// 보드, 상세 패널이 함께 써서 셋이 시각적으로 같게 유지된다.
import type { ComponentType, SVGProps } from "react";
import {
  Ban,
  BedDouble,
  Check,
  Clock,
  LogOut,
  Moon,
  PackageSearch,
  SprayCan,
  Wrench,
  Zap,
} from "lucide-react";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { AdminCleaningStatus } from "@/lib/admin-cleaning";
import type { CleaningStaffOption } from "@/lib/cleaning";
import type { CleaningTaskType } from "./cleaning-console-data";

/**
 * 콘솔 문구 = `cleaning.console` 사전 + 세션 상태 문구.
 *
 * `cleaning.console` 에는 "취소"/"전체 상태" 같은 **세션 상태** 문구가 아직 없고, 콘솔 전용으로
 * 새 키를 만들면 모바일(`cleaning.statusLabels` / `cleaning.records.status`)과 두 벌이 된다.
 * 그래서 이미 ko/ja/en 이 모두 갖춰진 기존 키를 그대로 재사용해 한 곳에서 합친다.
 * (후속: `cleaning.console` 에 stCancelled / allSessionStatus / completionType 키가 추가되면
 *  이 shim 을 걷어내고 콘솔 네임스페이스만 쓰면 된다.)
 */
export type ConsoleCopy = Dictionary["cleaning"]["console"] & {
  stCancelled: string;
  allSessionStatus: string;
  sessionStatus: Dictionary["cleaning"]["records"]["status"];
};

export function buildConsoleCopy(dictionary: Dictionary): ConsoleCopy {
  return {
    ...dictionary.cleaning.console,
    stCancelled: dictionary.cleaning.statusLabels.cancelled,
    allSessionStatus: dictionary.cleaning.records.statusAll,
    sessionStatus: dictionary.cleaning.records.status,
  };
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export const TYPE_ICON: Record<CleaningTaskType, IconType> = {
  checkout: LogOut,
  simple: Zap,
  longstay: Moon,
  setup: BedDouble,
};

export const STATUS_ICON: Record<AdminCleaningStatus, IconType> = {
  pending: Clock,
  progress: SprayCan,
  done: Check,
  cancelled: Ban,
};

export function typeLabel(type: CleaningTaskType, t: ConsoleCopy): string {
  if (type === "checkout") return t.tyCheckout;
  if (type === "simple") return t.tySimple;
  if (type === "longstay") return t.tyLongstay;
  return t.tySetup;
}

export function statusLabel(status: AdminCleaningStatus, t: ConsoleCopy): string {
  if (status === "pending") return t.stPending;
  if (status === "progress") return t.stProgress;
  if (status === "cancelled") return t.stCancelled;
  return t.stDone;
}

export function StatusPill({ status, t }: { status: AdminCleaningStatus; t: ConsoleCopy }) {
  const Icon = STATUS_ICON[status];
  const showIcon = status === "pending" || status === "cancelled";
  return (
    <span className={`cstat cstat--${status}`}>
      {showIcon ? (
        <span className="ic">
          <Icon />
        </span>
      ) : (
        <span className="d" />
      )}
      {statusLabel(status, t)}
    </span>
  );
}

/* ---------------- 직원 디렉터리 ----------------
   실제 직원은 이름이 하나뿐이고(옛 목업처럼 로케일별 변형 없음) 저장된 아바타
   색도 없으므로, 아바타 색은 사용자 id 에서 결정적으로 정한다 — 같은 사람은 항상
   한 세션 동안 같은 색을 받고, 이를 위한 DB 컬럼이 필요 없다. */

export type StaffDirectoryEntry = { id: string; name: string; bg: string };
export type StaffDirectory = Map<string, StaffDirectoryEntry>;

const AVATAR_PALETTE = [
  "#3f7d5a",
  "#4d6db5",
  "#557a8a",
  "#a86b3c",
  "#8a5cc7",
  "#c9587c",
  "#b08d2e",
  "#3f8f8f",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function avatarColorFor(id: string): string {
  return AVATAR_PALETTE[hashString(id) % AVATAR_PALETTE.length];
}

export function buildStaffDirectory(staff: readonly CleaningStaffOption[]): StaffDirectory {
  return new Map(staff.map((s) => [s.id, { id: s.id, name: s.name, bg: avatarColorFor(s.id) }]));
}

export function staffLabelOf(id: string | null, directory: StaffDirectory): string {
  if (!id) return "";
  return directory.get(id)?.name ?? "";
}

export function StaffAvatar({
  staffId,
  directory,
  className = "rmc__av",
}: {
  staffId: string | null;
  directory: StaffDirectory;
  className?: string;
}) {
  const entry = staffId ? directory.get(staffId) : null;
  return (
    <span className={className} style={{ background: entry ? entry.bg : "var(--adm-surface)" }}>
      {entry ? entry.name.slice(0, 1) : "?"}
    </span>
  );
}

export function ReportBadges({
  reports,
  t,
}: {
  reports: { lost?: number; issue?: number } | null;
  t: ConsoleCopy;
}) {
  if (!reports) return null;
  return (
    <>
      {reports.lost ? (
        <span className="rbadge rbadge--lost" title={t.lost}>
          <span className="ic">
            <PackageSearch />
          </span>
          {reports.lost}
        </span>
      ) : null}
      {reports.issue ? (
        <span className="rbadge rbadge--issue" title={t.issue}>
          <span className="ic">
            <Wrench />
          </span>
          {reports.issue}
        </span>
      ) : null}
    </>
  );
}

/**
 * 오늘 이 객실에서 청소가 취소된 적이 있음을 알리는 배지. 취소는 방을 다시 청소 대상으로
 * 되돌리므로 카드 상태는 `pending` 을 유지하고, 취소 이력만 이 배지로 노출한다.
 */
export function CancelledBadge({ count, t }: { count: number; t: ConsoleCopy }) {
  if (count <= 0) return null;
  return (
    <span className="rbadge rbadge--cancelled" title={t.stCancelled}>
      <span className="ic">
        <Ban />
      </span>
      {count}
    </span>
  );
}

/** 소요 시간 — 「46분」 · 「1시간 22분」(화이트 리디자인 2026-10-13, 시안 표기). 값이 없으면 「—」. */
export function durLabel(min: number | null, t: ConsoleCopy): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}${t.unitMin}`;
  return m === 0 ? `${h}${t.unitHour}` : `${h}${t.unitHour} ${m}${t.unitMin}`;
}

export function localeTagOf(locale: Locale): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

/** 현지화된 건물 라벨. 7개 표준 건물 중 어느 것으로도 해석되지 않은 방에는
 * 원래 이름으로 대체한다 (매칭되지 않은 방 라벨 — admin-cleaning.ts 참고). */
export function buildingLabelOf(
  item: { building: string | null; buildingRaw: string },
  buildingLabels: Record<string, string>,
): string {
  return (item.building ? buildingLabels[item.building] : null) ?? item.buildingRaw;
}
