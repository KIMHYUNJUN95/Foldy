import Link from "next/link";
import { LiveWash } from "@/components/shared/live-wash";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { startCleaningSession } from "@/app/mobile/cleaning/actions";
import { CleaningNotice } from "@/components/cleaning/cleaning-notice";
import { CleaningCompletionPanel } from "@/components/cleaning/cleaning-completion-panel";
import type { ManualBuildingOption, ManualRoomEntry } from "@/components/cleaning/manual-cleaning-form";
import { ManualCleaningForm } from "@/components/cleaning/manual-cleaning-form";
import { SettingTargetsSheet, type SettingTargetSheetItem } from "@/components/cleaning/setting-targets-sheet";
import { MobileShell } from "@/components/shell/mobile-shell";
import { CleaningBoardScreen } from "@/app/mobile/cleaning/cleaning-board-screen";
import { getMobileNavBadges } from "@/lib/nav-badges";
import "@/components/mobile/cleaning-screen.css";
import {
  canAccessMobileCleaning,
  cleaningTaskKeys,
  getCleaningOperatingDateKey,
  canReadAllCleaningSessions,
  getCleaningStaffOptions,
  getMyActiveCleaningSession,
  getMyTodayCleaningSessions,
  getOrgProcessedCleaningRoomLabels,
  getOrgTodayCleaningRoomLabels,
  isCleaningTaskKey,
} from "@/lib/cleaning";
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
  physicalRoomKeyOfSessionLabel,
  getDisplayRoomLabel,
  resolveRoomKey,
} from "@/lib/room-label-normalization";
import type { ActiveRoomCatalogItem } from "@/lib/rooms";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { FoldyEmpty } from "@/components/shared/foldy-empty";

type MobileCleaningPageProps = {
  searchParams: Promise<{
    /** 조회할 운영일(YYYY-MM-DD). 없거나 형식이 어긋나면 오늘. */
    date?: string;
    cancelled?: string;
    completed?: string;
    error?: string;
    lostReported?: string;
    maintenanceReported?: string;
    /** 결과 안내 갱신용(액션이 매번 새로 준다) — `CleaningNotice` 가 이 값이 바뀔 때마다 안내를 화면 안으로 끌어온다. */
    n?: string;
    started?: string;
    /** 출근 기록 없이 시작함(2026-10-29) — 시작 안내에 「출근하기」를 붙인다. */
    noClockIn?: string;
    /** 배정 담당이 현황판 대신 예전 「청소 시작」 목록을 보려 할 때(직접 청소 · 셋팅, 오늘 내 방 「목록에 없는 방」). */
    work?: string;
  }>;
};

// 건물 순서는 예약 캘린더와 같다(`CALENDAR_BUILDING_ORDER`, 2026-10-15). 전에는 여기 7개를 따로 적어 스테이아리가 맨 뒤로 밀렸다.
const BUILDING_KEY_ORDER = CALENDAR_BUILDING_ORDER.map((name) => CANONICAL_TO_BUILDING_KEY[name] ?? name);

const BUILDING_KEY_RANK = new Map<string, number>(
  BUILDING_KEY_ORDER.map((key, i) => [key, i]),
);
const ROOM_LABEL_MAPPING_WARNING_THRESHOLD = 3;

// 방 라벨의 앞쪽 정수를 뽑아 숫자 기준 정렬에 쓴다.
// "101" -> 101, "202" -> 202, "No digits" -> Infinity (맨 뒤로 정렬).
function roomSortKey(canonicalRoomLabel: string): number {
  const match = /\d+/.exec(canonicalRoomLabel);
  return match ? parseInt(match[0], 10) : Infinity;
}

type Groupable = {
  canonicalPropertyName: string;
  canonicalRoomLabel: string;
};

// 항목을 건물 키(정규 slug)로 묶고, 각 그룹을 방 번호순(숫자 기준, 같으면 라벨순)으로 정렬해
// 고정된 BUILDING_KEY_ORDER 순서의 건물 그룹으로 돌려준다
// (모르는 키는 뒤에 알파벳순으로 붙임).
// 돌려주는 buildingKey 는 React key 와 i18n 라벨 조회에 함께 쓴다.
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

// 활성 방 카탈로그를 수동 입력 폼용 ManualBuildingOption[] 로 바꾼다.
// 건물과 방은 청소/설정 목록과 같은 정렬 규칙으로 정렬한다.
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
    // 아라키초 하위 호실(201 / 201_2 = 같은 물리적 방)을 표시 라벨 기준 옵션 하나로 합쳐, 선택기에 "201" 이
    // 한 번만 나오게 한다 — 방을 보여주는 다른 화면과 같다. 대표 sessionRoomLabel 은 기본 계정
    // (canonical === display)을 우선한다.
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
  // 아라키초 하위 호실 키(예: 501_2 → 501)를 합쳐 카드가 캘린더의 표시 라벨과 같게 한다.
  // 그 밖의 속성은 그대로 돌려준다.
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

/** 건물 묶음 안의 짧은 객실 표기 — 「402」, 객실 = 건물 하나인 곳은 건물 이름(시안 2026-10-13). */
function getRowRoomLabel(
  canonicalPropertyName: string,
  canonicalRoomLabel: string,
  copy: ReturnType<typeof getDictionary>["cleaning"],
) {
  if (canonicalRoomLabel === canonicalPropertyName) {
    return copy.buildingLabels[getBuildingKey(canonicalPropertyName)] ?? canonicalPropertyName;
  }
  return getDisplayRoomLabel(canonicalPropertyName, canonicalRoomLabel);
}

function minutesLabel(totalSeconds: number | null, copy: ReturnType<typeof getDictionary>["cleaning"]) {
  if (totalSeconds === null) return "—";
  const min = Math.round(totalSeconds / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const { unitHour, unitMin } = copy.console;
  if (h === 0) return `${m}${unitMin}`;
  return m === 0 ? `${h}${unitHour}` : `${h}${unitHour} ${m}${unitMin}`;
}

/** 하루치 청소 결과 한 줄 — 과거 날짜 줄 오른쪽에 보여준다. */
type DayCleaningRecord = { staffName: string; timeLabel: string | null };

/** 목록 한 줄 — 객실 · 제목/보조 줄 · 오른쪽(시작 버튼이나 결과). 상자 없이 가는 줄로 나눈다. */
function CleanRow({
  room,
  title,
  sub,
  right,
  muted,
  just,
  live,
}: {
  room: string;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  muted?: boolean;
  /** 방금 완료한 줄 — 왼쪽부터 옅은 초록이 차오르고 앞쪽에 빛 선, 체크가 톡(2026-10-14 모션, 시안 Motion-B-RoomDone-Phone). */
  just?: boolean;
  /** 새 청소 대상이 위에서 내려오는 움직임의 열쇠(`LiveWash move`). */
  live?: string;
}) {
  return (
    <div className={`cln-row${muted ? " is-muted" : ""}${just ? " is-just" : ""}`} data-live={live}>
      {just ? (
        <>
          <span className="cln-row__fill" aria-hidden="true" />
          <span className="cln-row__edge" aria-hidden="true" />
        </>
      ) : null}
      <span className="cln-row__rm">{room}</span>
      <div className="cln-row__b">
        <p className="cln-row__t">{title}</p>
        {sub ? <p className="cln-row__s">{sub}</p> : null}
      </div>
      {right ? <div className="cln-row__r">{right}</div> : null}
    </div>
  );
}

/**
 * 보조 줄 — 손님 이름이 길면 이름만 말줄임하고 끝의 인원(「· 3명」)은 늘 남긴다(2026-10-23). en 「3 guests」 ·
 * ja 「3名」처럼 단위가 길어져도 청소 준비에 필요한 인원이 잘려 사라지지 않게.
 */
function SubKeepTail({ lead, tail }: { lead: string; tail: string | null }) {
  if (!tail) return <>{lead}</>;
  return (
    <span className="cln-row__split">
      <span className="cln-row__lead">{lead}</span>
      <span className="cln-row__tail">{tail}</span>
    </span>
  );
}

/**
 * 줄 오른쪽. 오늘 = 시작 버튼, 지난 날 = 결과. `record` 가 `null` 이면 **확실히** 기록이 없는 것,
 * `undefined` 면 볼 권한이 없어 단정할 수 없는 것이라 아무것도 그리지 않는다 — 남의 청소를
 * 「기록 없음」으로 그리면 빠뜨린 것처럼 읽힌다(2026-08-04).
 */
function RowRight({
  copy,
  startable,
  roomLabel,
  taskKey,
  startLabel,
  record,
}: {
  copy: ReturnType<typeof getDictionary>["cleaning"];
  startable: boolean;
  roomLabel: string;
  taskKey: "checkout" | "simple";
  startLabel: string;
  record?: DayCleaningRecord | null;
}) {
  if (startable) {
    return (
      <form action={startCleaningSession}>
        <input type="hidden" name="roomLabel" value={roomLabel} />
        <input type="hidden" name="taskKey" value={taskKey} />
        <button className="cln-start" type="submit">
          {startLabel}
        </button>
      </form>
    );
  }
  if (record) {
    return (
      <div className="cln-rec">
        <span className="cln-rec__st">{copy.statusLabels.completed}</span>
        <span className="cln-rec__s">
          {record.staffName}
          {record.timeLabel ? ` · ${record.timeLabel}` : ""}
        </span>
      </div>
    );
  }
  if (record === null) return <span className="cln-rec__none">{copy.console.noRecordLabel}</span>;
  return null;
}

// 청소 · 셋팅 대상은 예약에서만 나온다 — 요금 · 차단 신호로 다시 읽지 않는다(2026-10-19).
// 다른 사람이 시작 · 끝낸 방, 관리자 강제 완료도 바로 보이게 `cleaning_assign` 신호도 받는다(2026-10-28).
const LIVE_KINDS = ["reservations", "cleaning_assign"] as const;

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

  // 배정 담당(`cleaning.assign`)에게 「청소」는 현황판이다(2026-10-28, 시안 2riUcpk…) — 방마다 담당 · 대기 / 청소 중 / 끝남,
  // 담당 없는 방은 바로 넣기. 청소 시작 · 끝내기 결과로 돌아온 경우(started · completed · error …)와 「직접 청소」(work=1),
  // 다른 날 기록 보기(date)는 예전 목록을 그린다. 알바는 「오늘 내 방」에서 시작하고, 이 목록은 배정에 없는 방 · 셋팅용으로 남는다.
  const showsWorkList =
    params.work === "1" || Boolean(params.date || params.started || params.completed || params.cancelled || params.error || params.lostReported || params.maintenanceReported);
  if (session.capabilities.includes("cleaning.assign") && !showsWorkList) {
    return <CleaningBoardScreen session={session} />;
  }

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
  const canSeeAllSessions = canReadAllCleaningSessions(session);
  const isFuture = viewDate > operatingToday;

  // 서로 기다릴 필요 없는 읽기는 한 번에 시작한다(2026-10-19 속도 — 전에는 9단계 직렬). 배지(`getMobileNavBadges`)도 함께.
  // 과거 날짜에서 담당자 이름을 그리려면 이름표가 필요하다. 오늘만 볼 때는 부르지 않는다.
  // roomCatalog 는 항상 가져온다(activeSession 으로 막지 않음). 카탈로그 기반 방 라벨 해석기와
  // 수동 입력 폼 옵션 둘 다에 쓰이기 때문이다.
  // 「이미 시작 · 완료한 방」은 서비스 키로 조직 전체를 읽는다(`getOrgProcessedCleaningRoomLabels`, 라벨 · 상태만, 2026-10-26) —
  // RLS 로 읽으면 `cleaning.read_all` 없는 직원에게 남이 맡은 방이 시작 가능한 채로 남았다. 지난 날 「누가 언제」 기록은
  // 담당자 · 시각이 필요해 RLS 조회(`getOrgTodayCleaningRoomLabels`)를 그대로 쓴다 — 지난 날짜일 때만.
  const [sessions, activeSession, staffOptions, cleaningTargets, roomCatalog, orgProcessedSessions, orgDaySessions, navBadges] = await Promise.all([
    getMyTodayCleaningSessions(session),
    getMyActiveCleaningSession(session),
    isToday ? Promise.resolve([]) : getCleaningStaffOptions(session.organization.id).catch(() => []),
    getCleaningTargets(session.organization.id, viewDate).catch(() => null),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
    getOrgProcessedCleaningRoomLabels(session.organization.id, viewDate).catch(() => []),
    isToday ? Promise.resolve([]) : getOrgTodayCleaningRoomLabels(session.organization.id, viewDate).catch(() => []),
    getMobileNavBadges(),
  ]);
  // 진행 중인 세션은 **오늘 목록이 아니라 날짜 무관 조회**로 잡는다. 유니크 인덱스가 날짜를 보지
  // 않으므로, 지난 날짜의 미완료 세션이 남아 있으면 그것이 새 시작을 막는다 — 화면에 안 보이면
  // 사용자가 풀 방법이 없어 교착이다(2026-08-04). 자세한 배경은 getMyActiveCleaningSession 참고.
  const staleActiveDate =
    activeSession && activeSession.cleaning_date !== getCleaningOperatingDateKey()
      ? activeSession.cleaning_date
      : null;
  const recentSessions = sessions.filter((item) => item.status === "completed");
  // 완료하고 돌아온 직후(?completed=1)면 가장 최근에 끝난 줄 하나만 「방금 완료」 모션.
  const justCompletedId = params.completed
    ? recentSessions.reduce<{ id: string; at: string } | null>(
        (best, item) => (item.completed_at && (!best || item.completed_at > best.at) ? { id: item.id, at: item.completed_at } : best),
        null,
      )?.id ?? null
    : null;
  // 사전에 없는 키여도 **무언가는 보여준다.** 예전에는 `copy.errors[key]` 가 undefined 면 배너가
  // 통째로 사라져, 액션이 막혀도 화면상 아무 일도 안 일어난 것처럼 보였다(2026-08-04). 키가 빠진
  // 것은 버그지만, 그 버그가 사용자에게 "무반응"으로 보이는 것이 더 나쁘다.
  const noticeNonce = params.n ?? "";
  const errorMessage = params.error
    ? (copy.errors[params.error] ?? copy.errors.start_failed ?? params.error)
    : null;

  const staffNameById = new Map(staffOptions.map((o) => [o.id, o.name] as const));

  // 카탈로그 기반 맵이 기본 해석기다(활성 방 마스터 항목을 모두 포함).
  // 대체: 옛 라벨은 canonical 접두어를 파싱한다.
  // 끝까지 알 수 없는 라벨은 null 이 되어 제외되므로, 잘못 제외되는 일이 없다.
  const catalogLabelMap = buildSessionLabelToRoomKeyMap(roomCatalog ?? []);
  const legacyAliasMap = buildLegacyAliasToRoomKeyMap(roomCatalog ?? []);
  // 「이미 시작/완료한 방」 · 지난 날 기록은 **실제 방** 단위로 짝짓는다(2026-10-15). 아라키초는 한 방에 계정이 둘이라
  // 「401」 예약 카드와 「401_2_2」 로 시작한 세션이 같은 방이다 — 글자 키로는 카드가 안 사라진다.
  const roomKeyOfSession = (label: string, resolved: string) => physicalRoomKeyOfSessionLabel(label) ?? resolved;
  const roomKeyOfTarget = (target: { sessionRoomLabel: string; roomKey: string }) =>
    physicalRoomKeyOfSessionLabel(target.sessionRoomLabel) ?? target.roomKey;
  const processedRoomKeys = new Set<string>();
  const unknownRoomLabelSamples: string[] = [];
  let unknownRoomLabelCount = 0;
  let resolvedByAliasCount = 0;
  for (const s of orgProcessedSessions) {
    const resolved = resolveRoomKey(s.room_label, catalogLabelMap, legacyAliasMap);
    if (resolved.matchedBy === "legacy_alias") resolvedByAliasCount += 1;
    if (resolved.roomKey !== null) {
      processedRoomKeys.add(roomKeyOfSession(s.room_label, resolved.roomKey));
      continue;
    }
    unknownRoomLabelCount += 1;
    if (unknownRoomLabelSamples.length < 5) unknownRoomLabelSamples.push(s.room_label);
  }
  // 과거 날짜용 — 객실별 "누가 언제 했는지". 오늘은 시작 버튼을 그려야 하므로 만들지 않는다.
  const recordByRoomKey = new Map<string, DayCleaningRecord>();
  if (!isToday) {
    for (const s of orgDaySessions) {
      if (s.status !== "completed") continue;
      const resolved = resolveRoomKey(s.room_label, catalogLabelMap, legacyAliasMap);
      if (resolved.roomKey === null) continue;
      recordByRoomKey.set(roomKeyOfSession(s.room_label, resolved.roomKey), {
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
    (t) => !processedRoomKeys.has(roomKeyOfTarget(t)),
  );
  const filteredSettingList = (cleaningTargets?.settingList ?? []).filter(
    (t) => !processedRoomKeys.has(roomKeyOfTarget(t)),
  );

  // 가독성을 위해 JSX 밖에서 그룹 목록을 미리 계산한다
  const cleaningGroups =
    filteredCleaningList.length > 0
      ? groupByBuilding(filteredCleaningList)
      : null;
  const settingGroups =
    filteredSettingList.length > 0
      ? groupByBuilding(filteredSettingList)
      : null;
  // 「기타」 시트에서 흐리게 둘 방 — 이미 청소 목록에 잡힌 방(그 목록의 「시작」으로) + 오늘 이미 시작 · 완료한 방(서버가
  // 「오늘 이미 처리된 객실」로 막는다). 같은 실제 방 키로 맞춘다(2026-10-20, 시안 A2CleanMan3).
  const manualBlockedKeys = new Set<string>([...filteredCleaningList.map(roomKeyOfTarget), ...processedRoomKeys]);
  const manualBuildingOptions = buildManualRoomOptions(roomCatalog).map((group) => ({
    ...group,
    rooms: group.rooms.map((room) => {
      const key = physicalRoomKeyOfSessionLabel(room.sessionRoomLabel) ?? catalogLabelMap.get(room.sessionRoomLabel);
      return key && manualBlockedKeys.has(key) ? { ...room, blocked: true } : room;
    }),
  }));
  const cleaningTargetCount = filteredCleaningList.length;
  const settingTargetCount = filteredSettingList.length;
  const settingSheetItems: SettingTargetSheetItem[] = filteredSettingList.map((target) => ({
    arrivingGuestName: target.arrivingGuestName,
    arrivingPax: target.arrivingPax,
    roomLabel: target.sessionRoomLabel,
    roomTitle: getLocalizedRoomTitle(target.canonicalPropertyName, target.canonicalRoomLabel, copy),
  }));
  const sessionLabelToLocalizedRoomTitleMap = buildSessionLabelToLocalizedRoomTitleMap(roomCatalog, copy);
  // 조직 전체의 in_progress 개수 — KPI 일관성을 위해 큐 필터와 같은 범위
  const inProgressCount = orgProcessedSessions.filter((s) => s.status === "in_progress").length;

  // 진행 중인 청소가 있으면 새로 시작할 수 없다(유니크 인덱스) — 목록은 보여 주되 시작 버튼은 감춘다(2026-10-13).
  const startable = isToday && !activeSession;
  const viewDateLong = new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${viewDate}T00:00:00.000Z`));
  const recordFor = (roomKey: string) =>
    isToday ? undefined : (recordByRoomKey.get(roomKey) ?? (canSeeAllSessions ? null : undefined));
  const activeRoomTitle = activeSession
    ? (sessionLabelToLocalizedRoomTitleMap.get(activeSession.room_label) ?? activeSession.room_label)
    : "";

  return (
    // 화이트 리디자인(2026-10-13, 시안 Clean-Phone · Fold · Tablet): 상자 없는 한 장 — 제목 · 숫자 3개, 진행 중인 청소(링),
    // 청소 목록 | 셋팅 목록 · 오늘 기록. 폴드 2열 · 태블릿 가로 3열(폭 전부). 스타일: components/mobile/cleaning-screen.css
    <MobileShell activeItem="cleaning" appearance="cleaning" badges={navBadges} split title={copy.mobileTitle}>
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <div className="cln">
        <header className="cln-head">
          <div className="cln-head__t">
            <h1>{copy.mobileTitle}</h1>
            <p>
              {viewDateLong} · {copy.operatingDateShort}
            </p>
          </div>
          <div className="cln-kpis">
            <div className="cln-kpi">
              <span className="cln-kpi__k">{copy.kpiCleaningTargets}</span>
              <span className="cln-kpi__v">{cleaningTargets === null ? "-" : cleaningTargetCount}</span>
            </div>
            <div className="cln-kpi">
              <span className="cln-kpi__k">{copy.kpiSettingTargets}</span>
              <span className="cln-kpi__v">
                {cleaningTargets === null ? (
                  "-"
                ) : startable ? (
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
                  // 과거·미래 날짜(또는 청소 중)에는 시트를 열지 않는다. 시작 버튼이 눌리면 서버가 **오늘**
                  // 날짜로 세션을 만들어 엉뚱한 날에 기록된다(2026-08-04).
                  settingTargetCount
                )}
              </span>
            </div>
            <div className="cln-kpi">
              <span className="cln-kpi__k">{copy.kpiInProgress}</span>
              <span className={`cln-kpi__v${inProgressCount > 0 ? " is-live" : ""}`}>{inProgressCount}</span>
            </div>
          </div>
        </header>

        {/* 운영일 이동 · 내 청소 기록. 청소 대상은 예약에서 파생되므로 과거·미래도 그대로 계산된다(2026-08-04). */}
        <div className="cln-nav">
          <div className="cln-nav__day">
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
          </div>
          <Link className="cln-nav__rec" href="/mobile/cleaning/records">
            {copy.myRecordsLink}
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>

        {/* 오늘이 아닌 날짜의 한계를 명시한다 — 숫자를 오해하지 않도록. */}
        {!isToday ? <div className="cln-note">{isFuture ? copy.console.dateFutureNotice : copy.console.datePastNotice}</div> : null}
        {errorMessage ? <CleaningNotice className="cln-note is-danger" haptic="error" nonce={noticeNonce}>{errorMessage}</CleaningNotice> : null}
        {params.cancelled ? <CleaningNotice className="cln-note is-danger" nonce={noticeNonce}>{copy.cancelSuccess}</CleaningNotice> : null}
        {params.started ? (
          <CleaningNotice className="cln-note" nonce={noticeNonce}>
            {copy.startSuccess}
            {params.noClockIn ? (
              <>
                {" "}
                {copy.startNoClockIn}{" "}
                <Link className="cln-note__link" href="/mobile/attendance">
                  {copy.startClockInGo}
                </Link>
              </>
            ) : null}
          </CleaningNotice>
        ) : null}
        {params.completed ? <CleaningNotice className="cln-note cln-note--done" haptic="success" nonce={noticeNonce}>{copy.completeSuccess}</CleaningNotice> : null}
        {params.lostReported ? <CleaningNotice className="cln-note" nonce={noticeNonce}>{copy.lostReported}</CleaningNotice> : null}
        {params.maintenanceReported ? <CleaningNotice className="cln-note" nonce={noticeNonce}>{copy.maintenanceReported}</CleaningNotice> : null}
        {unknownRoomLabelCount >= ROOM_LABEL_MAPPING_WARNING_THRESHOLD ? (
          <div className="cln-note is-warn">
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
        {staleActiveDate ? <div className="cln-note is-warn">{copy.staleActiveNotice.replace("{date}", staleActiveDate)}</div> : null}

        {activeSession ? (
          <section className="cln-active">
            <h2 className="cln-h">{copy.activeCleaning}</h2>
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
                cleaningNow: copy.cleaningNow,
                finishCleaning: copy.finishCleaning,
                lostShort: copy.lostShort,
                issueShort: copy.issueShort,
              }}
              lostHref={`/mobile/lost-found/new?sessionId=${activeSession.id}`}
              maintenanceHref={`/mobile/maintenance/new?sessionId=${activeSession.id}`}
              metaLine={`${getTaskLabel(activeSession.task_label, copy)} · ${copy.startedAtShort.replace(
                "{time}",
                formatTime(activeSession.started_at, locale),
              )}`}
              roomLabel={activeRoomTitle}
              sessionId={activeSession.id}
              startedAt={activeSession.started_at}
              startedAtLabel={formatTime(activeSession.started_at, locale)}
              taskLabel={getTaskLabel(activeSession.task_label, copy)}
            />
          </section>
        ) : null}

        <div className="cln-cols">
          <section className="cln-col">
            <h2 className="cln-h">
              {copy.cleaningListTitle}
              {cleaningTargets ? <span className="cln-h__c">{cleaningTargetCount}</span> : null}
            </h2>
            {cleaningTargets === null ? (
              <div className="cln-note is-danger">{copy.loadError}</div>
            ) : cleaningGroups !== null ? (
              <LiveWash move sig={cleaningGroups.flatMap((g) => g.items.map((t) => t.roomKey)).join(",")}>
              {cleaningGroups.map(({ buildingKey, items }) => (
                <div className="cln-group" key={buildingKey}>
                  <p className="cln-group__t">{copy.buildingLabels[buildingKey] ?? buildingKey}</p>
                  {items.map((target) => (
                    <CleanRow
                      key={target.roomKey}
                      live={target.roomKey}
                      room={getRowRoomLabel(target.canonicalPropertyName, target.canonicalRoomLabel, copy)}
                      title={copy.taskOptions.checkout}
                      sub={
                        target.hasTurnover ? (
                          <SubKeepTail
                            lead={`${copy.turnoverBadge} · ${target.arrivingGuestName ?? copy.guestFallback}`}
                            tail={target.arrivingPax !== null ? ` · ${target.arrivingPax}${copy.paxUnit}` : null}
                          />
                        ) : target.nextCheckInDate ? (
                          <SubKeepTail
                            lead={`${copy.nextCheckIn} ${formatDateShort(target.nextCheckInDate, locale)}${
                              target.nextCheckInGuestName ? ` ${target.nextCheckInGuestName}` : ""
                            }`}
                            tail={target.nextCheckInPax !== null ? ` · ${target.nextCheckInPax}${copy.paxUnit}` : null}
                          />
                        ) : (
                          copy.noCheckInToday
                        )
                      }
                      right={
                        <RowRight
                          copy={copy}
                          record={recordFor(roomKeyOfTarget(target))}
                          roomLabel={target.sessionRoomLabel}
                          startLabel={copy.startShort}
                          startable={startable}
                          taskKey="checkout"
                        />
                      }
                    />
                  ))}
                </div>
              ))}
              </LiveWash>
            ) : (
              <FoldyEmpty title={copy.noCleaningToday} compact />
            )}

            {/* 기타 청소 — 목록에 없는 객실을 골라 시작. 청소 중에는 시작할 수 없어 감춘다. */}
            {startable ? (
              <div className="cln-manual">
                <h2 className="cln-h">{copy.manualSection}</h2>
                {manualBuildingOptions.length > 0 ? (
                  <ManualCleaningForm
                    buildings={manualBuildingOptions}
                    buildingLabels={copy.buildingLabels}
                    labels={{
                      open: copy.manualOpen,
                      openSub: copy.manualOpenSub,
                      sheetTitle: copy.manualSheetTitle,
                      blockedHint: copy.manualBlockedHint,
                      pickRoom: copy.manualPickRoom,
                      startRoom: copy.manualStartRoom,
                      task: copy.task,
                    }}
                    taskOptions={cleaningTaskKeys.map((key) => ({
                      key,
                      label: copy.manualTaskShort[key],
                    }))}
                  />
                ) : (
                  <p className="cln-empty">{copy.manualRoomMasterUnavailable}</p>
                )}
              </div>
            ) : null}
          </section>

          <div className="cln-side">
            {settingGroups ? (
              <section className="cln-col">
                <h2 className="cln-h">
                  {copy.settingListTitle}
                  <span className="cln-h__c">{settingTargetCount}</span>
                </h2>
                {settingGroups.map(({ buildingKey, items }) => (
                  <div className="cln-group" key={buildingKey}>
                    <p className="cln-group__t">{copy.buildingLabels[buildingKey] ?? buildingKey}</p>
                    {items.map((target) => (
                      <CleanRow
                        key={target.roomKey}
                        room={getRowRoomLabel(target.canonicalPropertyName, target.canonicalRoomLabel, copy)}
                        title={target.arrivingGuestName ?? copy.guestFallback}
                        sub={target.arrivingPax !== null ? `${target.arrivingPax}${copy.paxUnit}` : undefined}
                        right={
                          <RowRight
                            copy={copy}
                            record={recordFor(roomKeyOfTarget(target))}
                            roomLabel={target.sessionRoomLabel}
                            startLabel={copy.startSetting}
                            startable={startable}
                            taskKey="simple"
                          />
                        }
                      />
                    ))}
                  </div>
                ))}
              </section>
            ) : null}

            <section className="cln-col">
              <h2 className="cln-h">{copy.recentSessions}</h2>
              {recentSessions.length > 0 ? (
                <div className="cln-group">
                  {recentSessions.map((item) => (
                    <CleanRow
                      key={item.id}
                      room={sessionLabelToLocalizedRoomTitleMap.get(item.room_label) ?? item.room_label}
                      title={copy.taskDone.replace("{task}", getTaskLabel(item.task_label, copy))}
                      sub={[copy.durTaken.replace("{dur}", minutesLabel(item.duration_seconds, copy)), item.notes]
                        .filter(Boolean)
                        .join(" · ")}
                      right={
                        item.id === justCompletedId ? (
                          <span className="cln-row__done">
                            <span className="cln-row__ck" aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </span>
                            <span className="cln-row__time">{formatTime(item.completed_at, locale)}</span>
                          </span>
                        ) : (
                          <span className="cln-row__time">{formatTime(item.completed_at, locale)}</span>
                        )
                      }
                      just={item.id === justCompletedId}
                    />
                  ))}
                </div>
              ) : (
                <FoldyEmpty title={copy.noCompleted} compact />
              )}
            </section>
          </div>
        </div>
      </div>
    </MobileShell>
  );
}
