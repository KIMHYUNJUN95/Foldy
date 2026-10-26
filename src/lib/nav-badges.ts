import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBoardUnreadCount } from "@/lib/board-queries";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { countUnreadNotifications } from "@/lib/notifications/queries";
import { getCurrentAppSession } from "@/lib/session";
import { countPendingIdDocumentPeople } from "@/lib/staff-documents/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

/**
 * 모바일 사이드 메뉴에 배지로 보이는 운영 "미처리" 건수,
 * `mobileSidebarNavigation` 항목 id 를 키로 한다.
 *
 * 정의:
 * - cleaning:      오늘(도쿄 운영 날짜) 아직 진행 중인 청소 — 즉
 *                  끝내야 할 남은 건수이며 하나씩 완료될 때마다 줄어든다.
 * - requests:      미승인 주문 요청 (status 'requested') + 미처리 유지보수
 *                  보고 (open / in_progress) + 오늘 등록된 분실물 (도쿄).
 * - linen-return:  조직의 누구든 등록한 오늘(도쿄) 린넨 반품 기록
 *                  (조직 전체 공유 건수).
 * - announcements: 사용자가 아직 읽지 않은 게시된 공지 (읽으면 사라짐).
 * - board:         읽음 행이 없는 조직 게시판 글 (본인이 쓴 글 제외; 열면 사라짐).
 * - users:         재류카드 / 마이넘버 카드 확인을 기다리는 사람 — `staff_documents.view` 권한이 있는
 *                  보는 사람에게만 (다른 사람에게는 키 자체가 없음).
 * - notifications: 읽지 않은 알림 (read_at 이 null). [임시 — 다시 살펴볼 것]
 *
 * 홈, 캘린더, 연락처는 의도적으로 배지가 없다.
 *
 * 이 값은 화면 안내용 건수일 뿐이다. 접근/조직 격리는 RLS +
 * 서버 쿼리가 강제하며, 모든 건수는 실패 시 0 으로 닫히므로 테이블/마이그레이션이 없어도
 * 셸이 깨지지 않는다.
 */
export type NavBadgeCounts = Partial<Record<string, number>>;

type SupabaseServerClient = SupabaseClient<Database>;

/** head count 쿼리를 실행하고, 오류가 나면 던지지 않고 0 을 반환한다. */
async function safeCount(
  run: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  try {
    const { count, error } = await run();
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

/** 읽지 않음 = 조직의 게시된 공지에서 사용자가 읽은 것을 뺀 것. */
async function countUnreadAnnouncements(
  supabase: SupabaseServerClient,
  orgId: string,
  userId: string,
): Promise<number> {
  try {
    // 게시 목록과 읽음을 한 번에 — 읽음은 id 목록을 기다리지 않고 「이 조직의 게시된 공지」로 조인해 거른다
    // (결과는 예전 `.in(ids)` 와 같다).
    const [publishedRes, readsRes] = await Promise.all([
      supabase
        .from("announcements")
        .select("id")
        .eq("organization_id", orgId)
        .eq("status", "published")
        .returns<{ id: string }[]>(),
      supabase
        .from("announcement_reads")
        .select("announcement_id, announcements!inner(id)")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .eq("announcements.organization_id", orgId)
        .eq("announcements.status", "published")
        .returns<{ announcement_id: string }[]>(),
    ]);

    if (publishedRes.error) {
      return 0;
    }

    const ids = (publishedRes.data ?? []).map((row) => row.id);
    if (ids.length === 0) {
      return 0;
    }

    if (readsRes.error) {
      return 0;
    }

    const readIds = new Set((readsRes.data ?? []).map((row) => row.announcement_id));
    return ids.filter((id) => !readIds.has(id)).length;
  } catch {
    return 0;
  }
}

/**
 * 현재 세션의 모바일 사이드 메뉴 배지 건수를 계산한다.
 * `cache()` 가 한 서버 요청 안의 반복 호출을 합친다.
 */
export const getMobileNavBadges = cache(async (): Promise<NavBadgeCounts> => {
  // 페이지가 인증 확인 전에 미리 시작해 두고 끝에서 await 한다 — 여기서 던지면 처리되지 않은 거부가 된다.
  const session = await getCurrentAppSession().catch(() => null);
  if (!session || session.organization.id === "platform") {
    return {};
  }

  const orgId = session.organization.id;
  const userId = session.user.id;
  const supabase = await getSupabaseServerClient();

  // 오늘 도쿄 운영일 구간 (timestamptz 컬럼: registered_at / created_at).
  const today = getCleaningOperatingDateKey();
  const dayStart = new Date(`${today}T00:00:00+09:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = dayEnd.toISOString();

  const [cleaning, orders, maintenance, lostToday, linenReturn, announcements, board, notifications, users] =
    await Promise.all([
      // 오늘 남은 청소 (도쿄): 시작했지만 아직 완료하지 않은 것.
      safeCount(() =>
        supabase
          .from("cleaning_sessions")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("cleaning_date", today)
          .eq("status", "in_progress"),
      ),
      // 미승인(신규) 주문 요청.
      safeCount(() =>
        supabase
          .from("order_requests")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "requested"),
      ),
      // 미처리 유지보수 요청 (open / in progress).
      safeCount(() =>
        supabase
          .from("maintenance_reports")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .in("status", ["open", "in_progress"]),
      ),
      // 오늘 등록된 분실물 (도쿄).
      safeCount(() =>
        supabase
          .from("lost_items")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "registered")
          .gte("created_at", dayStartIso)
          .lt("created_at", dayEndIso),
      ),
      // 오늘 조직의 누구든 등록한 린넨 반품 (공유 건수).
      safeCount(() =>
        supabase
          .from("linen_return_records")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .gte("registered_at", dayStartIso)
          .lt("registered_at", dayEndIso),
      ),
      countUnreadAnnouncements(supabase, orgId, userId),
      getBoardUnreadCount(session).catch(() => 0),
      countUnreadNotifications(supabase, {
        userId,
        organizationId: orgId,
      }).catch(() => 0),
      session.capabilities.includes("staff_documents.view") ? countPendingIdDocumentPeople(orgId) : Promise.resolve(0),
    ]);

  return {
    cleaning,
    requests: orders + maintenance + lostToday,
    "linen-return": linenReturn,
    announcements,
    board,
    notifications,
    users,
  };
});

export const getMobileNotificationBadge = cache(async (): Promise<NavBadgeCounts> => {
  const session = await getCurrentAppSession();
  if (!session || session.organization.id === "platform") {
    return {};
  }

  const notifications = await countUnreadNotifications(
    await getSupabaseServerClient(),
    {
      userId: session.user.id,
      organizationId: session.organization.id,
    },
  ).catch(() => 0);

  return notifications > 0 ? { notifications } : {};
});
