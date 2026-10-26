"use server";

import { getDictionary } from "@/lib/i18n";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  countUnreadNotifications,
  listNotificationsForUser,
  markAllNotificationsRead,
} from "@/lib/notifications/queries";
import { buildNotificationViews, loadNotificationActorNames } from "@/lib/notifications/brief";
import type { NotificationView } from "@/lib/notifications/grouping";

/** 종 팝오버 글자 — 로그인한 사람의 언어로 서버에서 정해 함께 보낸다. */
export type AdminNotifCopy = {
  unreadShort: string;
  unread: string;
  more: string;
  less: string;
  objectMore: string;
  viewAll: string;
};

export type AdminNotifData = { unread: number; items: NotificationView[]; copy: AdminNotifCopy | null };

async function scopeFromSession() {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return null;
  return {
    scope: { userId: session.user.id, organizationId: session.organization.id },
    locale: session.user.preferredLanguage,
  };
}

// 관리자 콘솔 벨 팝오버 — 최근 알림(화이트 리디자인 행, 클라이언트에서 묶음) + 실제 안 읽은 수.
export async function getAdminNotifications(): Promise<AdminNotifData> {
  const ctx = await scopeFromSession();
  if (!ctx) return { unread: 0, items: [], copy: null };
  const supabase = await getSupabaseServerClient();
  const w = getDictionary(ctx.locale).mobile.notifications.w;
  const copy: AdminNotifCopy = {
    unreadShort: w.unreadShort,
    unread: w.unread,
    more: w.more,
    less: w.less,
    objectMore: w.objectMore,
    viewAll: w.viewAll,
  };
  try {
    const [list, unread] = await Promise.all([
      listNotificationsForUser(supabase, ctx.scope, { limit: 20 }),
      countUnreadNotifications(supabase, ctx.scope),
    ]);
    const actorNames = await loadNotificationActorNames(supabase, list.items);
    const { views } = buildNotificationViews(list.items, { locale: ctx.locale, actorNames });
    return { unread, items: views, copy };
  } catch {
    return { unread: 0, items: [], copy };
  }
}

export async function markAllAdminNotificationsRead(): Promise<{ ok: boolean }> {
  const ctx = await scopeFromSession();
  if (!ctx) return { ok: false };
  const supabase = await getSupabaseServerClient();
  try {
    await markAllNotificationsRead(supabase, ctx.scope);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
