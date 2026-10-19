import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBoardUnreadCount } from "@/lib/board-queries";
import { getCleaningOperatingDateKey } from "@/lib/cleaning";
import { countUnreadNotifications } from "@/lib/notifications/queries";
import { getCurrentAppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

/**
 * Operational "unprocessed" counts shown as badges on the mobile side menu,
 * keyed by `mobileSidebarNavigation` item id.
 *
 * Definitions:
 * - cleaning:      today's (Tokyo operating date) cleanings still in progress — i.e. the
 *                  remaining-to-finish count; drops as each is completed.
 * - requests:      unapproved order requests (status 'requested') + unprocessed maintenance
 *                  reports (open / in_progress) + lost items registered today (Tokyo).
 * - linen-return:  today's (Tokyo) linen return records registered by ANY user in the org
 *                  (organization-wide shared count).
 * - announcements: published announcements the user has not read yet (clears on read).
 * - board:         org board posts (not authored by the user) without a read row (clears on open).
 * - notifications: unread notifications (read_at is null). [placeholder — to be revisited]
 *
 * Home, Calendar and Directory intentionally have no badge.
 *
 * These are advisory UI counts only. Access/org-isolation is enforced by RLS +
 * server queries; every count fails closed to 0 so a missing table/migration
 * never breaks the shell.
 */
export type NavBadgeCounts = Partial<Record<string, number>>;

type SupabaseServerClient = SupabaseClient<Database>;

/** Run a head count query, returning 0 on any error instead of throwing. */
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

/** Unread = published announcements in the org minus those the user has read. */
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
 * Compute mobile side-menu badge counts for the current session.
 * `cache()` dedupes repeated calls within a single server request.
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

  // Today's Tokyo operating-day window (timestamptz columns: registered_at / created_at).
  const today = getCleaningOperatingDateKey();
  const dayStart = new Date(`${today}T00:00:00+09:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = dayEnd.toISOString();

  const [cleaning, orders, maintenance, lostToday, linenReturn, announcements, board, notifications] =
    await Promise.all([
      // Remaining cleanings for today (Tokyo): started but not yet completed.
      safeCount(() =>
        supabase
          .from("cleaning_sessions")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("cleaning_date", today)
          .eq("status", "in_progress"),
      ),
      // Unapproved (new) order requests.
      safeCount(() =>
        supabase
          .from("order_requests")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "requested"),
      ),
      // Unprocessed maintenance requests (open / in progress).
      safeCount(() =>
        supabase
          .from("maintenance_reports")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .in("status", ["open", "in_progress"]),
      ),
      // Lost items registered today (Tokyo).
      safeCount(() =>
        supabase
          .from("lost_items")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "registered")
          .gte("created_at", dayStartIso)
          .lt("created_at", dayEndIso),
      ),
      // Linen returns registered today by anyone in the org (shared count).
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
    ]);

  return {
    cleaning,
    requests: orders + maintenance + lostToday,
    "linen-return": linenReturn,
    announcements,
    board,
    notifications,
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
