import { redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { CleaningRecordsView } from "@/components/cleaning/cleaning-records-view";
import {
  canAccessMobileCleaning,
  getCleaningOperatingDateKey,
  getOrgCleaningSessionsFiltered,
  isCleaningTaskKey,
} from "@/lib/cleaning";
import { getDictionary } from "@/lib/i18n";
import type { Database } from "@/types/database";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getOrgMemberOptions } from "@/lib/org-members";
import { resolveRequestCatalogLocation } from "@/lib/request-location";
import {
  getDisplayRoomLabel,
  isExcludedOperationalProperty,
  localizePropertyName,
} from "@/lib/room-label-normalization";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = {
  searchParams: Promise<{ month?: string; staff?: string; status?: string; building?: string }>;
};

const CLEANING_STATUSES = new Set(["in_progress", "completed", "cancelled"]);

function monthBounds(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${monthKey}-01`, end: `${monthKey}-${String(lastDay).padStart(2, "0")}` };
}

export default async function CleaningRecordsPage({ searchParams }: PageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/cleaning/records")}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  if (!canAccessMobileCleaning(session.user.role)) {
    redirect("/mobile");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);

  const canViewOthers = session.capabilities.includes("cleaning.read_all");
  const monthKey = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : getCleaningOperatingDateKey().slice(0, 7);
  const { start, end } = monthBounds(monthKey);
  // `Set.has` 는 타입을 좁혀주지 못한다 — 런타임 검증은 이 줄이 이미 하고 있으므로 결과에만
  // 상태 유니온을 부여한다(임의 `?status=` 값은 여기서 undefined 로 떨어진다).
  const statusFilter = (
    CLEANING_STATUSES.has(params.status ?? "") ? params.status : undefined
  ) as Database["public"]["Tables"]["cleaning_sessions"]["Row"]["status"] | undefined;
  // 직원 필터는 매니저/사무 역할에만 적용되고, 일반 사용자는 RLS 로 본인 것만 조회된다.
  const staffFilter = canViewOthers && params.staff ? params.staff : undefined;

  // 방 카탈로그를 먼저 가져온다 — 건물 필터 옵션과 건물·방 해석을 모두 좌우하고,
  // `getOrgCleaningSessionsFiltered` 가 숙소별 필터링을 위해 필요로 한다.
  const roomCatalog = await getActiveRoomCatalogServer(session.organization.id).catch(() => undefined);
  const buildingOptions = Array.from(new Set((roomCatalog ?? []).map((i) => i.propertyName)))
    .filter((name) => !isExcludedOperationalProperty(name))
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => ({ value: name, label: localizePropertyName(name, dict.cleaning.buildingLabels) }));
  const buildingFilter = buildingOptions.some((b) => b.value === params.building)
    ? params.building
    : undefined;

  const [sessions, memberOptions] = await Promise.all([
    getOrgCleaningSessionsFiltered(
      session,
      {
        startDate: start,
        endDate: end,
        status: statusFilter,
        staffUserId: staffFilter,
        propertyName: buildingFilter,
      },
      roomCatalog,
    ).catch(() => []),
    canViewOthers
      ? getOrgMemberOptions(session.organization.id).catch(() => [])
      : Promise.resolve([]),
  ]);

  const buildingLabels = dict.cleaning.buildingLabels;
  const roomSuffix = dict.cleaning.records.roomSuffix;
  // 번호가 있는 방은 "아라키초B 202호", 통째로 쓰는 유닛(오쿠보)은 건물 이름만.
  const roomTitle = (buildingName: string | null, roomLabel: string): string => {
    if (!buildingName) return roomLabel;
    const buildingLabel = localizePropertyName(buildingName, buildingLabels);
    if (roomLabel === buildingName) return buildingLabel;
    const stripped = getDisplayRoomLabel(buildingName, roomLabel);
    const num = stripped.replace(/\D/g, "");
    return num ? `${buildingLabel} ${num}${roomSuffix}` : `${buildingLabel} ${stripped}`;
  };

  const records = sessions.map((s) => {
    const loc = resolveRequestCatalogLocation(s.room_label, roomCatalog ?? [], {});
    return {
      id: s.id,
      dateKey: s.cleaning_date,
      title: roomTitle(loc.buildingName, loc.roomLabel),
      taskLabel: isCleaningTaskKey(s.task_label)
        ? dict.cleaning.taskOptions[s.task_label]
        : s.task_label,
      staffUserId: s.staff_user_id,
      staffName: s.staff_name,
      startedAt: s.started_at,
      completedAt: s.completed_at,
      durationSeconds: s.duration_seconds,
      status: s.status,
      notes: s.notes,
    };
  });

  return (
    // 넓은 화면(2026-10-05): 폴드는 날짜 묶음 두 줄, 태블릿 가로는 왼쪽 기록 · 오른쪽 상세 칸(`CleaningRecordsView`).
    <MobileShell activeItem="cleaning" badges={await getMobileNavBadges()} split title={dict.cleaning.records.title}>
      <CleaningRecordsView
        buildings={buildingOptions}
        canViewOthers={canViewOthers}
        copy={dict.cleaning}
        locale={locale}
        members={memberOptions.map((m) => ({ id: m.id, name: m.name }))}
        monthKey={monthKey}
        records={records}
        selectedBuilding={buildingFilter ?? ""}
        selectedStaff={staffFilter ?? ""}
        selectedStatus={statusFilter ?? ""}
      />
    </MobileShell>
  );
}
