import { CleaningBoardView, type BoardViewPerson, type BoardViewRow } from "@/components/mobile/cleaning-board/cleaning-board-view";
import { checkInText } from "@/components/admin/cleaning-assign/format";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { loadDayBoard } from "@/lib/cleaning-assign/data";
import { getCleaningAssignCopy } from "@/lib/cleaning-assign-i18n";
import { buildCleaningBoard, type BoardSessionInfo } from "@/lib/cleaning-board";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import type { AppSession } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** 배정 · 청소 시작 · 끝내기(`cleaning_assign`)와 예약(`reservations`) 신호에 새로 읽는다. */
const LIVE_KINDS = ["cleaning_assign", "reservations"] as const;

const TOKYO_HM = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", minute: "2-digit", timeZone: "Asia/Tokyo" });

function tokyoMinutes(now: Date): number {
  const parts = Object.fromEntries(TOKYO_HM.formatToParts(now).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * 모바일 청소 현황판(배정 담당 · `cleaning.assign`, 2026-10-28 · 시안 2riUcpk…). 시작 버튼 없이 보기 · 배정만.
 * 데이터는 PC 배정 하루 보기(`loadDayBoard`) + 오늘 청소 기록(시작 · 끝난 시각). 폰 · 폴드 · 태블릿은 화면(`CleaningBoardView`)이 나눈다.
 * docs/product/07-cleaning-workflow.md 「모바일 청소 현황판」
 */
export async function CleaningBoardScreen({ session }: { session: AppSession }) {
  const navBadgesPromise = getMobileNavBadges();
  const locale = session.user.preferredLanguage;
  const copy = getCleaningAssignCopy(locale);
  const today = getCleaningOperatingDateKey();
  const service = getSupabaseServiceClient();
  const now = new Date();

  const [board, sessionsResult] = await Promise.all([
    loadDayBoard(service, session.organization.id, today, session.user.id),
    service
      .from("cleaning_sessions")
      .select("room_label, status, started_at, completed_at")
      .eq("organization_id", session.organization.id)
      .eq("cleaning_date", today)
      .in("status", ["in_progress", "completed"])
      .order("started_at", { ascending: false }),
  ]);

  // 방마다 가장 최근 기록 하나(끝난 기록이 있으면 그것) — 실제 방 키로 묶는다(한 방에 Beds24 계정이 둘인 건물).
  const sessions = new Map<string, BoardSessionInfo>();
  for (const row of sessionsResult.data ?? []) {
    const key = physicalRoomKeyOfSessionLabel(row.room_label);
    if (!key) continue;
    const prev = sessions.get(key);
    if (!prev || (row.status === "completed" && !prev.completedAt)) {
      sessions.set(key, { completedAt: row.completed_at, startedAt: row.started_at });
    }
  }

  const { rows, summary } = buildCleaningBoard({ now, nowMinutes: tokyoMinutes(now), people: board.people, rooms: board.rooms, sessions });
  const roomByKey = new Map(board.rooms.map((room) => [room.roomKey, room]));
  const viewRows: BoardViewRow[] = rows.map((row) => {
    const room = roomByKey.get(row.roomKey);
    const started = row.kind === "progress" ? (sessions.get(row.roomKey)?.startedAt ?? null) : null;
    return { ...row, info: room ? checkInText(room, copy) : "", startedAt: started };
  });
  const people: BoardViewPerson[] = board.people.map((p) => ({
    applied: p.applied,
    cancelled: p.cancelled,
    name: p.name,
    rooms: p.rooms.map((r) => ({ propertyName: r.propertyName, roomKey: r.roomKey, roomLabel: r.roomLabel })),
    userId: p.userId,
  }));
  const navBadges = await navBadgesPromise;

  return (
    <MobileShell activeItem="cleaning" badges={navBadges} title={copy.boardTitle} wide>
      <Beds24LiveRefresh kinds={LIVE_KINDS} organizationId={session.organization.id} />
      <CleaningBoardView copy={copy} date={today} locale={locale} people={people} rows={viewRows} summary={summary} />
    </MobileShell>
  );
}
