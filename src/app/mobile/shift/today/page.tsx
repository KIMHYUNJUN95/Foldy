import { redirect } from "next/navigation";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { MobileShell } from "@/components/shell/mobile-shell";
import { TodayRoomsView, type TodayRoomSession } from "@/components/mobile/shift/today-rooms-view";
import { physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { loadTodayRooms } from "@/lib/cleaning-assign/data";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getPropertyMapMeta } from "@/lib/property-map-links";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** 배정 · 신청이 바뀌면 새로고침 없이 다시 읽는다(PC ↔ 모바일 실시간, `src/lib/cleaning-assign/live.ts`). */
const LIVE_KINDS = ["cleaning_assign"] as const;

/**
 * 오늘 내 방(모바일 · 알바) — 배정된 방만 순서대로, 누르면 지금 청소 시작(타이머)으로. 「어젯밤 바뀜」 · 오늘 같이 일하는 사람 · 내일 상태.
 * 폰 · 폴드 · 태블릿(태블릿 가로는 오른쪽에 고른 방 칸). docs/product/37-cleaning-shift-assignment.md 「4-3」
 */
export default async function MobileShiftTodayPage() {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);
  if (state.status === "unauthenticated") redirect("/auth/login?next=/mobile/shift/today");
  if (state.status !== "ready" || !session) redirect("/onboarding");
  if (!hasOrganizationContext(session)) redirect("/mobile/unavailable");
  if (!session.capabilities.includes("cleaning.work")) redirect("/mobile");

  const locale = session.user.preferredLanguage;
  const copy = getCleaningAssignCopy(locale);
  const today = getCleaningOperatingDateKey();
  const service = getSupabaseServiceClient();
  const [data, sessionsResult] = await Promise.all([
    loadTodayRooms(service, session.organization.id, session.user.id, session.user.role, today),
    // 오늘 그 방의 청소 기록 — 그 자리에서 끝내기 · 타이머 · 되돌리기에 세션 id · 시작 시각이 필요하다(2026-10-28).
    service
      .from("cleaning_sessions")
      .select("id, room_label, status, started_at, completed_at, duration_seconds, staff_user_id")
      .eq("organization_id", session.organization.id)
      .eq("cleaning_date", today)
      .in("status", ["in_progress", "completed"])
      .order("started_at", { ascending: false }),
  ]);
  const sessionByRoom = new Map<string, TodayRoomSession>();
  for (const row of sessionsResult.data ?? []) {
    const key = physicalRoomKeyOfSessionLabel(row.room_label);
    if (!key || sessionByRoom.has(key)) continue;
    sessionByRoom.set(key, {
      id: row.id,
      status: row.status === "completed" ? "completed" : "in_progress",
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationSeconds: row.duration_seconds,
      mine: row.staff_user_id === session.user.id,
    });
  }
  const buildingLabels = getDictionary(locale).cleaning.buildingLabels;
  const rooms = data.rooms.map((room) => {
    const meta = getPropertyMapMeta(room.propertyName);
    return {
      ...room,
      buildingLabel: localizePropertyName(room.propertyName, buildingLabels),
      doorCode: meta?.roomAccess?.find((item) => item.roomLabel === room.roomLabel)?.code ?? null,
      mapsUrl: meta?.googleMapsUrl ?? null,
      session: sessionByRoom.get(room.roomKey) ?? null,
    };
  });
  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="my-rooms" badges={navBadges} title={copy.todayTitle} wide>
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <TodayRoomsView copy={copy} locale={locale} data={{ ...data, rooms }} />
    </MobileShell>
  );
}
