import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BedDouble, CheckCircle2, ChevronRight, ClipboardList, DoorOpen, Package, Sparkles, SprayCan, Timer, UsersRound, Wrench } from "lucide-react";
import { startCleaningSession } from "@/app/mobile/cleaning/actions";
import { CleaningCompletionPanel } from "@/components/cleaning/cleaning-completion-panel";
import type { ManualBuildingOption, ManualRoomEntry } from "@/components/cleaning/manual-cleaning-form";
import { ManualCleaningForm } from "@/components/cleaning/manual-cleaning-form";
import { SettingTargetsSheet, type SettingTargetSheetItem } from "@/components/cleaning/setting-targets-sheet";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  canAccessMobileCleaning,
  cleaningTaskKeys,
  formatDuration,
  getCleaningOperatingDateKey,
  canReadAllCleaningSessions,
  getCleaningStaffOptions,
  getMyActiveCleaningSession,
  getMyTodayCleaningSessions,
  getOrgTodayCleaningRoomLabels,
  isCleaningTaskKey,
  type CleaningSessionRow,
} from "@/lib/cleaning";
import type { CleaningTarget, SettingTarget } from "@/lib/cleaning-targets";
import { getCleaningTargets } from "@/lib/cleaning-targets";
import { CleaningDaySwitcher } from "@/components/cleaning/cleaning-day-switcher";
import { getDictionary, type Locale } from "@/lib/i18n";
import { getOnboardingState } from "@/lib/onboarding";
import {
  buildLegacyAliasToRoomKeyMap,
  buildSessionLabelToRoomKeyMap,
  buildSessionRoomLabel,
  CALENDAR_BUILDING_ORDER,
  CANONICAL_TO_BUILDING_KEY,
  getDisplayRoomLabel,
  resolveRoomKey,
} from "@/lib/room-label-normalization";
import type { ActiveRoomCatalogItem } from "@/lib/rooms";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";

type MobileCleaningPageProps = {
  searchParams: Promise<{
    /** 조회할 운영일(YYYY-MM-DD). 없거나 형식이 어긋나면 오늘. */
    date?: string;
    cancelled?: string;
    completed?: string;
    error?: string;
    lostReported?: string;
    maintenanceReported?: string;
    started?: string;
  }>;
};

// 건물 순서는 예약 캘린더와 같다(`CALENDAR_BUILDING_ORDER`, 2026-10-15). 전에는 여기 7개를 따로 적어 스테이아리가 맨 뒤로 밀렸다.
const BUILDING_KEY_ORDER = CALENDAR_BUILDING_ORDER.map((name) => CANONICAL_TO_BUILDING_KEY[name] ?? name);

const BUILDING_KEY_RANK = new Map<string, number>(
  BUILDING_KEY_ORDER.map((key, i) => [key, i]),
);
const ROOM_LABEL_MAPPING_WARNING_THRESHOLD = 3;
const CLEANING_PANEL =
  "rounded-[28px] border border-slate-200/80 bg-surface shadow-[0_22px_46px_-32px_rgba(31,58,95,0.48)] backdrop-blur-none";
const CLEANING_CARD =
  "overflow-hidden rounded-[24px] border border-slate-200/80 bg-surface shadow-[0_16px_34px_-28px_rgba(31,58,95,0.48)] backdrop-blur-none";
const CLEANING_START_BUTTON =
  "h-10 shrink-0 rounded-2xl border border-slate-200/70 bg-white px-4 text-xs font-black text-slate-800 shadow-[0_14px_28px_-24px_rgba(31,58,95,0.48)] transition-all hover:bg-slate-50 active:scale-[0.98]";

// Extract the leading integer from a room label for numeric-aware sorting.
// "101" -> 101, "202" -> 202, "No digits" -> Infinity (sort last).
function roomSortKey(canonicalRoomLabel: string): number {
  const match = /\d+/.exec(canonicalRoomLabel);
  return match ? parseInt(match[0], 10) : Infinity;
}

type Groupable = {
  canonicalPropertyName: string;
  canonicalRoomLabel: string;
};

// Groups items by building key (canonical slug), sorts each group by room number
// (numeric-aware, then label tiebreaker), and returns building groups in the fixed
// BUILDING_KEY_ORDER (unknown keys appended alphabetically at end).
// The returned buildingKey is used for both React key and i18n label lookup.
function groupByBuilding<T extends Groupable>(
  items: T[],
): { buildingKey: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key =
      getBuildingKey(item.canonicalPropertyName);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  for (const list of map.values()) {
    list.sort((a, b) => {
      const diff = roomSortKey(a.canonicalRoomLabel) - roomSortKey(b.canonicalRoomLabel);
      return diff !== 0 ? diff : a.canonicalRoomLabel.localeCompare(b.canonicalRoomLabel);
    });
  }

  return [...map.keys()]
    .sort((a, b) => {
      const ra = BUILDING_KEY_RANK.get(a) ?? BUILDING_KEY_ORDER.length;
      const rb = BUILDING_KEY_RANK.get(b) ?? BUILDING_KEY_ORDER.length;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    })
    .map((buildingKey) => ({ buildingKey, items: map.get(buildingKey)! }));
}

function getBuildingKey(canonicalPropertyName: string): string {
  return CANONICAL_TO_BUILDING_KEY[canonicalPropertyName] ?? canonicalPropertyName;
}

// Transforms the active room catalog into ManualBuildingOption[] for the manual form.
// Buildings and rooms are sorted using the same ordering rules as the cleaning/setting lists.
function buildManualRoomOptions(
  catalog: ActiveRoomCatalogItem[] | undefined,
): ManualBuildingOption[] {
  if (!catalog || catalog.length === 0) return [];

  const map = new Map<string, { buildingKey: string; rooms: ManualRoomEntry[] }>();

  for (const item of catalog) {
    const buildingKey = getBuildingKey(item.propertyName);
    if (!map.has(buildingKey)) {
      map.set(buildingKey, { buildingKey, rooms: [] });
    }
    const sessionRoomLabel = buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel);
    const displayRoomLabel = getDisplayRoomLabel(item.propertyName, item.canonicalRoomLabel);

    const group = map.get(buildingKey)!;
    // Collapse Arakicho sub-units (201 / 201_2 = same physical room) to one option keyed by the
    // display label, so the picker shows "201" once — matching every other room-facing screen. Prefer
    // the base account (canonical === display) as the representative sessionRoomLabel.
    const existing = group.rooms.find((r) => r.displayRoomLabel === displayRoomLabel);
    if (!existing) {
      group.rooms.push({
        canonicalRoomLabel: item.canonicalRoomLabel,
        displayRoomLabel,
        sessionRoomLabel,
      });
    } else if (
      item.canonicalRoomLabel === displayRoomLabel &&
      existing.canonicalRoomLabel !== displayRoomLabel
    ) {
      existing.canonicalRoomLabel = item.canonicalRoomLabel;
      existing.sessionRoomLabel = sessionRoomLabel;
    }
  }

  for (const group of map.values()) {
    group.rooms.sort((a, b) => {
      const diff =
        roomSortKey(a.canonicalRoomLabel) - roomSortKey(b.canonicalRoomLabel);
      return diff !== 0 ? diff : a.canonicalRoomLabel.localeCompare(b.canonicalRoomLabel);
    });
  }

  return [...map.keys()]
    .sort((a, b) => {
      const ra = BUILDING_KEY_RANK.get(a) ?? BUILDING_KEY_ORDER.length;
      const rb = BUILDING_KEY_RANK.get(b) ?? BUILDING_KEY_ORDER.length;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    })
    .map((key) => map.get(key)!);
}

function buildSessionLabelToLocalizedRoomTitleMap(
  catalog: ActiveRoomCatalogItem[] | undefined,
  copy: ReturnType<typeof getDictionary>["cleaning"],
): Map<string, string> {
  const map = new Map<string, string>();
  if (!catalog) return map;

  for (const item of catalog) {
    const sessionLabel = buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel);
    map.set(sessionLabel, getLocalizedRoomTitle(item.propertyName, item.canonicalRoomLabel, copy));
  }

  return map;
}

function getLocalizedRoomTitle(
  canonicalPropertyName: string,
  canonicalRoomLabel: string,
  copy: ReturnType<typeof getDictionary>["cleaning"],
) {
  const buildingKey = getBuildingKey(canonicalPropertyName);
  const buildingLabel = copy.buildingLabels[buildingKey] ?? canonicalPropertyName;
  if (canonicalRoomLabel === canonicalPropertyName) return buildingLabel;
  // Collapse Arakicho sub-unit keys (e.g. 501_2 → 501) so the card matches the
  // calendar's display label. Other properties are returned unchanged.
  const displayRoomLabel = getDisplayRoomLabel(canonicalPropertyName, canonicalRoomLabel);
  return `${buildingLabel} ${displayRoomLabel}`;
}
function formatTime(value: string | null, locale: Locale) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function formatDateShort(dateStr: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateStr}T00:00:00.000Z`));
}

function getTaskLabel(
  taskLabel: string,
  copy: ReturnType<typeof getDictionary>["cleaning"],
) {
  return isCleaningTaskKey(taskLabel) ? copy.taskOptions[taskLabel] : taskLabel;
}

type CleaningKpiCardProps = {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone: "primary" | "slate" | "muted";
};

function CleaningKpiCard({
  icon,
  label,
  value,
  tone,
}: CleaningKpiCardProps) {
  // Primary KPI (today's cleaning targets) gets a filled navy icon to draw focus;
  // the others stay neutral. Tiles share a soft navy wash so they read as one group.
  const iconTone = {
    primary:
      "bg-primary text-primary-foreground shadow-[0_8px_18px_-10px_hsl(var(--primary-hsl)/0.6)]",
    muted: "bg-surface text-slate-500 ring-1 ring-border",
    slate: "bg-surface text-slate-500 ring-1 ring-border",
  }[tone];
  const valueClass = tone === "primary" ? "text-primary" : "text-foreground";

  return (
    <div className="relative flex flex-col items-center rounded-2xl border border-primary/10 bg-primary/[0.05] px-3 py-3.5 text-center">
      <div className={`flex size-9 items-center justify-center rounded-2xl ${iconTone}`}>
        {icon}
      </div>
      <p className="mt-2 flex min-h-[2rem] items-center justify-center px-1 text-[11px] font-black leading-tight text-muted-foreground">
        {label}
      </p>
      <div className={`mt-0.5 text-2xl font-black tracking-[-0.04em] ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function CleaningSummaryCard({
  copy,
  locale,
  roomLabelText,
  session,
}: {
  copy: ReturnType<typeof getDictionary>["cleaning"];
  locale: Locale;
  roomLabelText: string;
  session: CleaningSessionRow;
}) {
  return (
    <Card className={`${CLEANING_CARD} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
            {copy.room} {roomLabelText}
          </p>
          <h3 className="mt-1 break-words text-lg font-black tracking-[-0.03em] text-slate-950">
            {getTaskLabel(session.task_label, copy)}
          </h3>
        </div>
        <Badge className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600">
          {copy.statusLabels[session.status]}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-muted-foreground">
        <span className="rounded-xl bg-slate-50 px-3 py-2">
          {copy.startedAt}: {formatTime(session.started_at, locale)}
        </span>
        <span className="rounded-xl bg-slate-50 px-3 py-2">
          {copy.duration}: {formatDuration(session.duration_seconds)}
        </span>
      </div>
      {session.notes ? (
        <p className="mt-3 whitespace-pre-line break-words rounded-xl bg-background/70 px-3 py-2 text-sm text-muted-foreground">
          {session.notes}
        </p>
      ) : null}
    </Card>
  );
}

/** 하루치 청소 결과 한 줄 — 과거 날짜 카드에 겹쳐 보여준다. */
type DayCleaningRecord = { staffName: string; timeLabel: string | null };

function CleaningTargetCard({
  copy,
  locale,
  target,
  readOnly,
  record,
}: {
  copy: ReturnType<typeof getDictionary>["cleaning"];
  locale: Locale;
  target: CleaningTarget;
  /** 오늘이 아닌 날짜 = 읽기 전용. 시작 버튼을 그리지 않는다(2026-08-04). */
  readOnly?: boolean;
  /**
   * 그날의 청소 결과. 값이 있으면 누가 언제 했는지, `null` 이면 **확실히** 기록이 없는 것,
   * `undefined` 면 볼 권한이 없어 **단정할 수 없는** 것이다 — 마지막 경우엔 아무것도 그리지
   * 않는다. 남의 청소를 "기록 없음"으로 그리면 빠뜨린 것처럼 읽히기 때문이다.
   */
  record?: DayCleaningRecord | null;
}) {
  const subLabel = target.hasTurnover ? (
    <span>
      {target.arrivingGuestName ?? "Guest"}
      {target.arrivingPax !== null
        ? ` | ${target.arrivingPax}${copy.paxUnit}`
        : ""}
    </span>
  ) : target.nextCheckInDate ? (
    <span>
      {copy.noCheckInToday} | {copy.nextCheckIn}{" "}
      {formatDateShort(target.nextCheckInDate, locale)}{" "}
      {target.nextCheckInGuestName ?? ""}
      {target.nextCheckInPax !== null
        ? ` | ${target.nextCheckInPax}${copy.paxUnit}`
        : ""}
    </span>
  ) : (
    <span>{copy.noCheckInToday}</span>
  );

  return (
    <Card className={CLEANING_CARD}>
      <div className="relative flex items-center justify-between gap-3 p-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-r-full bg-[#BFD6EA]"
        />
        <div className="min-w-0 flex-1 pl-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <BedDouble className="size-4.5" aria-hidden="true" />
            </span>
            <p className="text-[16px] font-black leading-tight tracking-[-0.03em] text-slate-950 md:text-base">{getLocalizedRoomTitle(target.canonicalPropertyName, target.canonicalRoomLabel, copy)}</p>
            {target.hasTurnover && (
              <Badge className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                {copy.turnoverBadge}
              </Badge>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1.5 truncate text-xs font-semibold text-slate-500">
            <UsersRound className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate">{subLabel}</span>
          </p>
        </div>
        {!readOnly ? (
          <form action={startCleaningSession}>
            <input type="hidden" name="roomLabel" value={target.sessionRoomLabel} />
            <input type="hidden" name="taskKey" value="checkout" />
            <Button
              className={CLEANING_START_BUTTON}
              type="submit"
            >
              {copy.start}
            </Button>
          </form>
        ) : record ? (
          <div className="shrink-0 text-right">
            <p className="text-[12px] font-black text-primary">{copy.statusLabels.completed}</p>
            <p className="mt-0.5 text-[11.5px] font-bold text-slate-600">{record.staffName}</p>
            {record.timeLabel ? (
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{record.timeLabel}</p>
            ) : null}
          </div>
        ) : record === null ? (
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-400">
            {copy.console.noRecordLabel}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function SettingTargetCard({
  copy,
  target,
  readOnly,
  record,
}: {
  copy: ReturnType<typeof getDictionary>["cleaning"];
  target: SettingTarget;
  readOnly?: boolean;
  /** `null` = 확실히 기록 없음, `undefined` = 볼 권한이 없어 단정 불가(아무것도 그리지 않음). */
  record?: DayCleaningRecord | null;
}) {
  return (
    <Card className={CLEANING_CARD}>
      <div className="relative flex items-center justify-between gap-3 p-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-r-full bg-slate-300/80"
        />
        <div className="min-w-0 flex-1 pl-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-600 ring-1 ring-slate-200/80">
              <DoorOpen className="size-4.5" aria-hidden="true" />
            </span>
            <p className="truncate text-[16px] font-black leading-tight tracking-[-0.03em] text-slate-950 md:text-base">{getLocalizedRoomTitle(target.canonicalPropertyName, target.canonicalRoomLabel, copy)}</p>
          </div>
          <p className="mt-2 flex items-center gap-1.5 truncate text-xs font-semibold text-slate-500">
            <UsersRound className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate">
              {target.arrivingGuestName}
              {target.arrivingPax !== null
                ? ` | ${target.arrivingPax}${copy.paxUnit}`
                : ""}
            </span>
          </p>
        </div>
        {!readOnly ? (
          <form action={startCleaningSession}>
            <input type="hidden" name="roomLabel" value={target.sessionRoomLabel} />
            <input type="hidden" name="taskKey" value="simple" />
            <Button
              className={CLEANING_START_BUTTON}
              type="submit"
            >
              {copy.startSetting}
            </Button>
          </form>
        ) : record ? (
          <div className="shrink-0 text-right">
            <p className="text-[12px] font-black text-primary">{copy.statusLabels.completed}</p>
            <p className="mt-0.5 text-[11.5px] font-bold text-slate-600">{record.staffName}</p>
            {record.timeLabel ? (
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{record.timeLabel}</p>
            ) : null}
          </div>
        ) : record === null ? (
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-400">
            {copy.console.noRecordLabel}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export default async function MobileCleaningPage({
  searchParams,
}: MobileCleaningPageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/mobile/cleaning");
  }

  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const copy = dictionary.cleaning;

  if (!canAccessMobileCleaning(session.user.role)) {
    redirect("/mobile");
  }

  // 조회 날짜. 잘못된 값은 조용히 오늘로 떨어진다 — 링크 하나로 화면이 깨지지 않게.
  const operatingToday = getCleaningOperatingDateKey();
  const viewDate =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : operatingToday;
  const isToday = viewDate === operatingToday;
  // RLS 상 staff / part_time_staff 는 **본인 세션만** 읽는다. 그 사람들에게 "기록 없음"을 그리면
  // 남이 끝낸 청소가 빠뜨린 것처럼 보인다 — 단정할 수 있는 사람에게만 그린다(2026-08-04).
  const canSeeAllSessions = canReadAllCleaningSessions(session.user.role);
  const isFuture = viewDate > operatingToday;

  const sessions = await getMyTodayCleaningSessions(session);
  // 진행 중인 세션은 **오늘 목록이 아니라 날짜 무관 조회**로 잡는다. 유니크 인덱스가 날짜를 보지
  // 않으므로, 지난 날짜의 미완료 세션이 남아 있으면 그것이 새 시작을 막는다 — 화면에 안 보이면
  // 사용자가 풀 방법이 없어 교착이다(2026-08-04). 자세한 배경은 getMyActiveCleaningSession 참고.
  const activeSession = await getMyActiveCleaningSession(session);
  const staleActiveDate =
    activeSession && activeSession.cleaning_date !== getCleaningOperatingDateKey()
      ? activeSession.cleaning_date
      : null;
  const recentSessions = sessions.filter((item) => item.status === "completed");
  // 사전에 없는 키여도 **무언가는 보여준다.** 예전에는 `copy.errors[key]` 가 undefined 면 배너가
  // 통째로 사라져, 액션이 막혀도 화면상 아무 일도 안 일어난 것처럼 보였다(2026-08-04). 키가 빠진
  // 것은 버그지만, 그 버그가 사용자에게 "무반응"으로 보이는 것이 더 나쁘다.
  const errorMessage = params.error
    ? (copy.errors[params.error] ?? copy.errors.start_failed ?? params.error)
    : null;

  // Fetch cleaning targets, room catalog, and org-wide today sessions in parallel.
  // roomCatalog is always fetched (not gated on activeSession) because it serves
  // both the catalog-based room label resolver and the manual form options.
  let cleaningTargets: Awaited<ReturnType<typeof getCleaningTargets>> | null = null;
  let roomCatalog: ActiveRoomCatalogItem[] | undefined = undefined;
  let orgTodaySessions: Awaited<ReturnType<typeof getOrgTodayCleaningRoomLabels>> = [];
  // 과거 날짜에서 담당자 이름을 그리려면 이름표가 필요하다. 오늘만 볼 때는 부르지 않는다.
  const staffOptions = isToday
    ? []
    : await getCleaningStaffOptions(session.organization.id).catch(() => []);
  const staffNameById = new Map(staffOptions.map((o) => [o.id, o.name] as const));

  [cleaningTargets, roomCatalog, orgTodaySessions] = await Promise.all([
    getCleaningTargets(session.organization.id, viewDate).catch(() => null),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
    getOrgTodayCleaningRoomLabels(session.organization.id, viewDate).catch(() => []),
  ]);

  // Catalog-based map is the primary resolver (covers all active room master entries).
  // Fallback: canonical prefix parse for legacy labels.
  // Truly unknown labels return null and are excluded so they never produce false exclusions.
  const catalogLabelMap = buildSessionLabelToRoomKeyMap(roomCatalog ?? []);
  const legacyAliasMap = buildLegacyAliasToRoomKeyMap(roomCatalog ?? []);
  const processedRoomKeys = new Set<string>();
  const unknownRoomLabelSamples: string[] = [];
  let unknownRoomLabelCount = 0;
  let resolvedByAliasCount = 0;
  for (const s of orgTodaySessions) {
    if (s.status !== "in_progress" && s.status !== "completed") continue;
    const resolved = resolveRoomKey(s.room_label, catalogLabelMap, legacyAliasMap);
    if (resolved.matchedBy === "legacy_alias") resolvedByAliasCount += 1;
    if (resolved.roomKey !== null) {
      processedRoomKeys.add(resolved.roomKey);
      continue;
    }
    unknownRoomLabelCount += 1;
    if (unknownRoomLabelSamples.length < 5) unknownRoomLabelSamples.push(s.room_label);
  }
  // 과거 날짜용 — 객실별 "누가 언제 했는지". 오늘은 시작 버튼을 그려야 하므로 만들지 않는다.
  const recordByRoomKey = new Map<string, DayCleaningRecord>();
  if (!isToday) {
    for (const s of orgTodaySessions) {
      if (s.status !== "completed") continue;
      const resolved = resolveRoomKey(s.room_label, catalogLabelMap, legacyAliasMap);
      if (resolved.roomKey === null) continue;
      recordByRoomKey.set(resolved.roomKey, {
        staffName: staffNameById.get(s.staff_user_id) ?? copy.console.unknownStaff,
        timeLabel: s.completed_at ? formatTime(s.completed_at, locale) : null,
      });
    }
  }

  if (process.env.NODE_ENV === "development" && (unknownRoomLabelCount > 0 || resolvedByAliasCount > 0)) {
    console.warn("[cleaning] room_label resolver stats", {
      legacyAliasResolved: resolvedByAliasCount,
      unknownRoomLabelCount,
      unknownRoomLabelSamples,
    });
  }

  const filteredCleaningList = (cleaningTargets?.cleaningList ?? []).filter(
    (t) => !processedRoomKeys.has(t.roomKey),
  );
  const filteredSettingList = (cleaningTargets?.settingList ?? []).filter(
    (t) => !processedRoomKeys.has(t.roomKey),
  );

  // Pre-compute grouped lists outside JSX for readability
  const cleaningGroups =
    filteredCleaningList.length > 0
      ? groupByBuilding(filteredCleaningList)
      : null;
  const settingGroups =
    filteredSettingList.length > 0
      ? groupByBuilding(filteredSettingList)
      : null;
  const manualBuildingOptions = buildManualRoomOptions(roomCatalog);
  const cleaningTargetCount = filteredCleaningList.length;
  const settingTargetCount = filteredSettingList.length;
  const settingSheetItems: SettingTargetSheetItem[] = filteredSettingList.map((target) => ({
    arrivingGuestName: target.arrivingGuestName,
    arrivingPax: target.arrivingPax,
    roomLabel: target.sessionRoomLabel,
    roomTitle: getLocalizedRoomTitle(target.canonicalPropertyName, target.canonicalRoomLabel, copy),
  }));
  const sessionLabelToLocalizedRoomTitleMap = buildSessionLabelToLocalizedRoomTitleMap(roomCatalog, copy);
  // Org-wide in_progress count — same scope as the queue filter for KPI consistency
  const inProgressCount = orgTodaySessions.filter((s) => s.status === "in_progress").length;

  const navBadges = await getMobileNavBadges();

  return (
    // 넓은 화면(2026-10-05): 청소 · 세팅 대상과 최근 기록 카드가 폴드 2열 · 태블릿 가로 3열(폭 전부).
    <MobileShell activeItem="cleaning" appearance="cleaning" badges={navBadges} split title={copy.mobileTitle}>
      <Beds24LiveRefresh organizationId={session.organization.id} />
      <div className="space-y-5">
        <Card className={`${CLEANING_PANEL} relative overflow-hidden p-4`}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(70%_100%_at_100%_0%,hsl(var(--primary-hsl)/0.08),transparent_72%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-10 bottom-2 size-28 rounded-full bg-slate-100/70 blur-2xl"
          />
          <div className="relative flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-primary">
                {copy.todayOpsTitle}
              </p>
              <p className="mt-1 text-[11px] font-bold text-slate-400">
                {copy.operatingDateLabel}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Sparkles className="size-5" aria-hidden="true" />
            </div>
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-2">
            <CleaningKpiCard
              icon={<SprayCan className="size-4" aria-hidden="true" />}
              label={copy.kpiCleaningTargets}
              tone="primary"
              value={cleaningTargets === null ? "-" : cleaningTargetCount}
            />
            <CleaningKpiCard
              icon={<DoorOpen className="size-4" aria-hidden="true" />}
              label={copy.kpiSettingTargets}
              tone="muted"
              value={
                cleaningTargets === null ? (
                  "-"
                ) : (
                  isToday ? (
                  <SettingTargetsSheet
                    closeLabel={copy.cancelCompletion}
                    count={settingTargetCount}
                    description={copy.settingTargetsModalDescription}
                    emptyMessage={copy.settingTargetsEmptyMessage}
                    items={settingSheetItems}
                    paxUnit={copy.paxUnit}
                    startLabel={copy.startSetting}
                    title={copy.settingListTitle}
                  />
                  ) : (
                    // 과거·미래 날짜에서는 시트를 열지 않는다. 시작 버튼이 눌리면 서버가 **오늘**
                    // 날짜로 세션을 만들어 엉뚱한 날에 기록된다(2026-08-04).
                    settingTargetCount
                  )
                )
              }
            />
            <CleaningKpiCard
              icon={<Timer className="size-4" aria-hidden="true" />}
              label={copy.kpiInProgress}
              tone="slate"
              value={inProgressCount}
            />
          </div>
        </Card>

        {/* 운영일 이동. 청소 대상은 예약에서 파생되므로 과거·미래도 그대로 계산된다(2026-08-04). */}
        <CleaningDaySwitcher
          basePath="/mobile/cleaning"
          date={viewDate}
          labels={{
            prev: copy.console.dayPrev,
            next: copy.console.dayNext,
            select: copy.console.daySelect,
            today: copy.console.today,
            prevMonth: copy.console.monthPrev,
            nextMonth: copy.console.monthNext,
            goToday: copy.console.goToday,
          }}
          locale={locale}
          today={operatingToday}
        />

        {/* 오늘이 아닌 날짜의 한계를 명시한다 — 숫자를 오해하지 않도록. */}
        {!isToday ? (
          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3 text-[12.5px] font-semibold leading-relaxed text-primary">
            {isFuture ? copy.console.dateFutureNotice : copy.console.datePastNotice}
          </div>
        ) : null}

        {/* Cleaning log entry — date-grouped record sheet (own; managers can view others). */}
        <Link
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.4)] transition-colors active:bg-slate-50"
          href="/mobile/cleaning/records"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-extrabold tracking-[-0.01em] text-foreground">
              {copy.records.entry}
            </span>
            <span className="block text-[12px] text-muted-foreground">{copy.records.entrySub}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />
        </Link>

        {errorMessage ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {errorMessage}
          </div>
        ) : null}
        {params.cancelled ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {copy.cancelSuccess}
          </div>
        ) : null}
        {params.started ? (
          <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
            {copy.startSuccess}
          </div>
        ) : null}
        {params.completed ? (
          <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
            {copy.completeSuccess}
          </div>
        ) : null}
        {params.lostReported ? (
          <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
            {copy.lostReported}
          </div>
        ) : null}
        {params.maintenanceReported ? (
          <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
            {copy.maintenanceReported}
          </div>
        ) : null}
        {unknownRoomLabelCount >= ROOM_LABEL_MAPPING_WARNING_THRESHOLD ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-700">
            {copy.roomMappingWarning
              .replace("{count}", String(unknownRoomLabelCount))
              .replace(
                "{samples}",
                unknownRoomLabelSamples.length > 0 ? ` (${unknownRoomLabelSamples.join(", ")})` : "",
              )}
          </div>
        ) : null}

        {/* 지난 날짜의 미완료 세션 — 유니크 인덱스가 날짜를 안 보므로 이게 남아 있으면 오늘
            아무것도 시작할 수 없다. 무엇이 막고 있는지와 푸는 방법을 알려준다(2026-08-04). */}
        {staleActiveDate ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-700">
            {copy.staleActiveNotice.replace("{date}", staleActiveDate)}
          </div>
        ) : null}

        {activeSession ? (
          <Card className={`${CLEANING_PANEL} p-5`}>
            <div className="flex flex-col items-center text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
                <span className="size-2 rounded-full bg-primary" />
                {copy.activeCleaning}
              </div>
              <h3 className="mt-3 text-[28px] font-black tracking-tight text-foreground">
                {copy.room} {sessionLabelToLocalizedRoomTitleMap.get(activeSession.room_label) ?? activeSession.room_label}
              </h3>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                {getTaskLabel(activeSession.task_label, copy)}
              </p>
            </div>

            <CleaningCompletionPanel
              labels={{
                cancelCleaning: copy.cancelCleaning,
                cancelCleaningMessage: copy.cancelCleaningMessage,
                cancelCleaningTitle: copy.cancelCleaningTitle,
                cancelCompletion: copy.cancelCompletion,
                completedToday: copy.completedToday,
                confirmCancelCleaning: copy.confirmCancelCleaning,
                confirmCompletion: copy.confirmCompletion,
                completionConfirmation: copy.completionConfirmation,
                elapsed: copy.elapsed,
                notesLabel: copy.notesLabel,
                notesPlaceholder: copy.notesPlaceholder,
                reviewCompletion: copy.reviewCompletion,
                room: copy.room,
                startedAt: copy.startedAt,
                task: copy.task,
              }}
              roomLabel={sessionLabelToLocalizedRoomTitleMap.get(activeSession.room_label) ?? activeSession.room_label}
              sessionId={activeSession.id}
              startedAt={activeSession.started_at}
              startedAtLabel={formatTime(activeSession.started_at, locale)}
              taskLabel={getTaskLabel(activeSession.task_label, copy)}
            />

            <div className="mt-4 space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
                {copy.quickActions}
              </p>
              <div className="space-y-2">
                <Link
                  className="flex h-12 items-center gap-3 rounded-full border border-white/60 bg-white/28 px-4 text-sm font-bold text-foreground shadow-sm backdrop-blur-xl transition-[background-color,transform] hover:bg-white/40 active:scale-[0.99] active:bg-white/55"
                  href={`/mobile/lost-found/new?sessionId=${activeSession.id}`}
                >
                  <span className="flex size-8 items-center justify-center rounded-full border border-white/50 bg-white/35 text-primary">
                    <Package className="size-4" aria-hidden="true" />
                  </span>
                  <span className="truncate">{copy.reportLostItem}</span>
                </Link>
                <Link
                  className="flex h-12 items-center gap-3 rounded-full border border-white/60 bg-white/28 px-4 text-sm font-bold text-foreground shadow-sm backdrop-blur-xl transition-[background-color,transform] hover:bg-white/40 active:scale-[0.99] active:bg-white/55"
                  href={`/mobile/maintenance/new?sessionId=${activeSession.id}`}
                >
                  <span className="flex size-8 items-center justify-center rounded-full border border-white/50 bg-white/35 text-primary">
                    <Wrench className="size-4" aria-hidden="true" />
                  </span>
                  <span className="truncate">{copy.reportMaintenance}</span>
                </Link>
              </div>
            </div>
          </Card>
        ) : (
          <>
            {/* Cleaning targets (today's checkouts) */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-9 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                    <SprayCan className="size-4.5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-black tracking-[-0.03em] text-slate-950">
                      {copy.cleaningListTitle}
                    </p>
                    <p className="text-[11px] font-bold text-slate-400">
                      {copy.kpiCleaningTargets}
                    </p>
                  </div>
                </div>
                {cleaningTargets && (
                  <span className="inline-flex h-9 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-[17px] font-black leading-none text-primary shadow-[0_10px_20px_-18px_rgba(31,58,95,0.5)]">
                    {cleaningTargetCount}
                  </span>
                )}
              </div>

              {cleaningTargets === null ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
                  {copy.loadError}
                </div>
              ) : cleaningGroups !== null ? (
                <div className="space-y-4">
                  {cleaningGroups.map(({ buildingKey, items }) => (
                    <div key={buildingKey} className="space-y-2.5">
                      <p className="pl-1 text-[11px] font-black uppercase tracking-[0.10em] text-slate-400">
                        {copy.buildingLabels[buildingKey] ?? buildingKey}
                      </p>
                      <div className="grid gap-2.5 fold:grid-cols-2 tablet:grid-cols-3">
                      {items.map((target) => (
                        <CleaningTargetCard
                          copy={copy}
                          key={target.roomKey}
                          locale={locale}
                          readOnly={!isToday}
                          record={
                            recordByRoomKey.get(target.roomKey) ??
                            (canSeeAllSessions ? null : undefined)
                          }
                          target={target}
                        />
                      ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Card className={`${CLEANING_CARD} border-dashed p-4 text-sm font-semibold text-muted-foreground`}>
                  {copy.noCleaningToday}
                </Card>
              )}
            </section>

            {/* Setting targets (today's check-ins with no checkout) */}
            {settingGroups && (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-2xl bg-slate-50 text-slate-600 ring-1 ring-slate-200/80">
                      <DoorOpen className="size-4.5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-black tracking-[-0.03em] text-slate-950">
                        {copy.settingListTitle}
                      </p>
                      <p className="text-[11px] font-bold text-slate-400">
                        {copy.kpiSettingTargets}
                      </p>
                    </div>
                  </div>
                  <Badge className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-black text-slate-600">
                    {settingTargetCount}
                  </Badge>
                </div>
                <div className="space-y-4">
                  {settingGroups.map(({ buildingKey, items }) => (
                    <div key={buildingKey} className="space-y-2.5">
                      <p className="pl-1 text-[11px] font-black uppercase tracking-[0.10em] text-slate-400">
                        {copy.buildingLabels[buildingKey] ?? buildingKey}
                      </p>
                      <div className="grid gap-2.5 fold:grid-cols-2 tablet:grid-cols-3">
                      {items.map((target) => (
                        <SettingTargetCard
                          copy={copy}
                          key={target.roomKey}
                          readOnly={!isToday}
                          record={
                            recordByRoomKey.get(target.roomKey) ??
                            (canSeeAllSessions ? null : undefined)
                          }
                          target={target}
                        />
                      ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Manual / Other */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-2xl bg-slate-50 text-slate-700 ring-1 ring-slate-200/80">
                  <CheckCircle2 className="size-4.5" aria-hidden="true" />
                </span>
                <p className="text-sm font-black tracking-[-0.03em] text-slate-950">
                  {copy.manualSection}
                </p>
              </div>
              <Card className={`${CLEANING_PANEL} p-4`}>
                {manualBuildingOptions.length > 0 ? (
                  <ManualCleaningForm
                    buildings={manualBuildingOptions}
                    buildingLabels={copy.buildingLabels}
                    labels={{
                      buildingLabel: copy.manualBuildingLabel,
                      buildingPlaceholder: copy.manualBuildingPlaceholder,
                      room: copy.room,
                      roomPlaceholder: copy.manualRoomSelectPlaceholder,
                      start: copy.start,
                      task: copy.task,
                    }}
                    taskOptions={cleaningTaskKeys.map((key) => ({
                      key,
                      label: copy.taskOptions[key],
                    }))}
                  />
                ) : (
                  <p className="text-sm font-semibold text-muted-foreground">
                    {copy.manualRoomMasterUnavailable}
                  </p>
                )}
              </Card>
            </section>
          </>
        )}

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-2xl bg-slate-50 text-slate-700 ring-1 ring-slate-200/80">
              <Timer className="size-4.5" aria-hidden="true" />
            </span>
            <p className="text-sm font-black tracking-[-0.03em] text-slate-950">
              {copy.recentSessions}
            </p>
          </div>
          {recentSessions.length > 0 ? (
            <div className="grid gap-3 fold:grid-cols-2 tablet:grid-cols-3">
            {recentSessions.map((item) => (
              <CleaningSummaryCard
                copy={copy}
                key={item.id}
                locale={locale}
                roomLabelText={sessionLabelToLocalizedRoomTitleMap.get(item.room_label) ?? item.room_label}
                session={item}
              />
            ))}
            </div>
          ) : (
            <Card className={`${CLEANING_CARD} border-dashed p-4 text-sm font-semibold text-muted-foreground`}>
              {copy.noCompleted}
            </Card>
          )}
        </section>
      </div>
    </MobileShell>
  );
}
