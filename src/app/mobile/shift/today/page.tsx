import { redirect } from "next/navigation";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { MobileShell } from "@/components/shell/mobile-shell";
import { TodayRoomsView, type TodayRoomSession } from "@/components/mobile/shift/today-rooms-view";
import { shouldOfferStart } from "@/lib/cleaning-assign/room-key";
import { todaySkipReason } from "@/lib/cleaning-assign/task-kind";
import { physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { loadTodayRooms } from "@/lib/cleaning-assign/data";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getPropertyMapMeta } from "@/lib/property-map-links";
import { localizePropertyName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";
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
  const [data, sessionsResult, staleResult] = await Promise.all([
    loadTodayRooms(service, session.organization.id, session.user.id, session.user.role, today),
    // 오늘 그 방의 청소 기록 — 그 자리에서 끝내기 · 타이머 · 되돌리기에 세션 id · 시작 시각이 필요하다(2026-10-28).
    service
      .from("cleaning_sessions")
      .select("id, room_label, status, started_at, completed_at, duration_seconds, staff_user_id")
      .eq("organization_id", session.organization.id)
      .eq("cleaning_date", today)
      .in("status", ["in_progress", "completed"])
      // 관리자 「처리 끝」이 남기는 완료 기록(`closed_without_cleaning`)은 청소가 아니다 — 넣으면 그 방이 「끝남」으로 보이고
      // 청소 중이던 사람의 기록을 가려 「끝내기」가 사라진다(2026-11-02 리뷰). 처리 끝은 `resolvedHold` 로 따로 보인다.
      .eq("closed_without_cleaning", false)
      .order("started_at", { ascending: false }),
    // 지난 날 시작하고 끝내지 않은 **내** 청소(2026-11-02 점검 수정) — 진행 중은 한 사람 하나라 남아 있으면 오늘 방을
    // 하나도 시작하지 못한다. 위 조회는 오늘 날짜만 봐서 이 기록이 화면에 안 보였다 → 맨 위에 띄우고 닫게 한다.
    service
      .from("cleaning_sessions")
      .select("id, room_label, cleaning_date, started_at")
      .eq("organization_id", session.organization.id)
      .eq("staff_user_id", session.user.id)
      .eq("status", "in_progress")
      .lt("cleaning_date", today)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  // 이 조회가 실패하면 카드가 안 뜨고 시작은 「다른 방 청소 중」으로만 막힌다 — 적어도 서버 기록은 남긴다.
  if (staleResult.error) console.error("[shift-today] stale session read failed", { code: staleResult.error.code });
  const stale = staleResult.data
    ? {
        id: staleResult.data.id,
        roomName: localizeRoomPlaceLabel(staleResult.data.room_label, getDictionary(locale).cleaning.buildingLabels),
        cleaningDate: staleResult.data.cleaning_date,
        startedAt: staleResult.data.started_at,
      }
    : null;
  // 방마다 내 기록 · 다른 사람 기록(사람마다 가장 최근 것)을 따로 모은다 — 2인 방은 각자 기록(2026-11-02 점검 C1).
  const sessionsByRoom = new Map<string, { mine: TodayRoomSession | null; others: Map<string, TodayRoomSession> }>();
  for (const row of sessionsResult.data ?? []) {
    // 이름표 규칙이 없는 새 건물은 물리 방 키가 없다 — 그때는 청소 기록 이름 그대로 키로 쓴다(`startMyRoom` 과 같은 맞추기).
    const key = physicalRoomKeyOfSessionLabel(row.room_label) ?? row.room_label;
    const entry = sessionsByRoom.get(key) ?? { mine: null, others: new Map<string, TodayRoomSession>() };
    sessionsByRoom.set(key, entry);
    const mine = row.staff_user_id === session.user.id;
    const value: TodayRoomSession = {
      id: row.id,
      status: row.status === "completed" ? "completed" : "in_progress",
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationSeconds: row.duration_seconds,
      mine,
    };
    if (mine) entry.mine = entry.mine ?? value;
    else if (!entry.others.has(row.staff_user_id)) entry.others.set(row.staff_user_id, value);
  }
  const buildingLabels = getDictionary(locale).cleaning.buildingLabels;
  const rooms = data.rooms.map((room) => {
    const meta = getPropertyMapMeta(room.propertyName);
    const entry = sessionsByRoom.get(room.roomKey) ?? sessionsByRoom.get(room.sessionRoomLabel) ?? null;
    const others = entry ? [...entry.others.values()] : [];
    // 내 기록이 있으면 그것. 없으면 화면 규칙 하나(`shouldOfferStart` — 청소 화면과 같음): 그 방 다른 기록이 **같이 배정된 사람 것뿐이면**
    // (2인 방) 나는 아직 「대기」 — 내 자리는 내 몫이다. 배정 안 된 사람이 해 둔 방은 그 기록으로 보여 준다(「끝남」 · 청소 중) — 이미
    // 누가 치운 방을 다시 청소하지 않게(서버는 막지 않는다). 처리 끝 기록은 위 조회에서 빠지고 `resolvedHold` 로 따로 보인다.
    const assigneeIds = new Set([session.user.id, ...room.mates.map((mate) => mate.userId)]);
    const records = [
      ...(entry?.mine ? [{ staffId: session.user.id, status: entry.mine.status, closed: false }] : []),
      ...[...(entry?.others ?? new Map<string, TodayRoomSession>())].map(([staffId, record]) => ({ staffId, status: record.status, closed: false })),
    ];
    const mySlot = !entry?.mine && others.length > 0 && shouldOfferStart(records, session.user.id, assigneeIds);
    // 남 기록을 보일 때는 청소 중인 것을 먼저(끝난 사람 · 청소 중인 사람이 같이 있으면 방은 아직 청소 중).
    const shown = others.find((record) => record.status === "in_progress") ?? others[0] ?? null;
    const roomSession = entry?.mine ?? (mySlot ? null : shown);
    // 상태는 **내 눈 기준**: 내 기록 → 그 상태, 내 자리 남음 → 「대기」(처리 끝 방은 방 상태), 남 기록을 보이면 → 그 기록 상태,
    // 기록 없음 → 방 상태(목록에서 빠진 방 · 처리 끝 방 포함). 방 상태(`room.status`)는 방 전체 기준(「1/2 끝남」은 청소 중)이라
    // 내 줄에는 쓰지 않는다.
    const fromSession = roomSession ? (roomSession.status === "completed" ? ("done" as const) : ("progress" as const)) : ("pending" as const);
    let status = room.status;
    if (entry?.mine) status = fromSession;
    else if (mySlot) status = room.resolvedHold ? room.status : "pending";
    else if (roomSession) status = fromSession;
    const mates = room.mates.map((mate) => {
      const record = entry?.others.get(mate.userId);
      return { ...mate, state: record ? (record.status === "completed" ? ("done" as const) : ("progress" as const)) : null };
    });
    return {
      ...room,
      mates,
      status,
      // 오늘 청소 안 하는 이유 — 서버 `startMyRoom` 과 같은 규칙(`todaySkipReason`).
      skipReason: todaySkipReason({ ...room, status, hasSession: roomSession !== null }),
      buildingLabel: localizePropertyName(room.propertyName, buildingLabels),
      doorCode: meta?.roomAccess?.find((item) => item.roomLabel === room.roomLabel)?.code ?? null,
      mapsUrl: meta?.googleMapsUrl ?? null,
      session: roomSession,
    };
  });
  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="my-rooms" badges={navBadges} title={copy.todayTitle} wide>
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <TodayRoomsView copy={copy} locale={locale} data={{ ...data, rooms }} stale={stale} />
    </MobileShell>
  );
}
