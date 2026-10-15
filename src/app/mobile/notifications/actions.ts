"use server";

import { revalidatePath } from "next/cache";
import {
  deleteNotifications as deleteNotificationsInDb,
  markAllNotificationsRead as markAllNotificationsReadInOrg,
  markNotificationRead,
  markNotificationsReadByIds,
} from "@/lib/notifications/queries";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function getNotificationScope() {
  const session = getCurrentAppSession();
  return session.then((value) => {
    if (!value || !hasOrganizationContext(value)) {
      return null;
    }
    return {
      userId: value.user.id,
      organizationId: value.organization.id,
    };
  });
}

export async function markNotificationAsRead(notificationId: string) {
  const scope = await getNotificationScope();
  if (!scope) {
    return { ok: false as const, error: "unauthorized" };
  }

  const supabase = await getSupabaseServerClient();
  const updated = await markNotificationRead(supabase, notificationId, scope);
  revalidatePath("/mobile/notifications");

  return { ok: updated as boolean };
}

/** 밀어서 「읽음」 · 묶음 줄 — 여러 건을 한 번에. 내 알림만(쿼리가 받는 사람 · 조직을 다시 건다). */
export async function markNotificationsAsRead(ids: string[]) {
  const scope = await getNotificationScope();
  if (!scope) return { ok: false as const, error: "unauthorized" };
  const clean = sanitizeIds(ids);
  if (!clean.length) return { ok: true as const };

  const supabase = await getSupabaseServerClient();
  const ok = await markNotificationsReadByIds(supabase, clean, scope);
  if (!ok) return { ok: false as const, error: "save_failed" };

  revalidatePath("/mobile/notifications");
  return { ok: true as const };
}

/** 클라이언트가 보낸 id 목록 — 문자열 · 중복 제거 · 한 번에 200건까지. */
function sanitizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))).slice(0, 200);
}

export async function deleteNotifications(rawIds: string[]) {
  const scope = await getNotificationScope();
  if (!scope) return { ok: false as const, error: "unauthorized" };
  const ids = sanitizeIds(rawIds);
  if (!ids.length) return { ok: true as const };

  const supabase = await getSupabaseServerClient();
  const ok = await deleteNotificationsInDb(supabase, ids, scope);
  if (!ok) return { ok: false as const, error: "delete_failed" };

  revalidatePath("/mobile/notifications");
  return { ok: true as const };
}

export async function markAllNotificationsRead() {
  const scope = await getNotificationScope();
  if (!scope) {
    return { ok: false as const, error: "unauthorized" };
  }

  const supabase = await getSupabaseServerClient();
  const updated = await markAllNotificationsReadInOrg(supabase, scope);
  if (!updated) {
    return { ok: false as const, error: "save_failed" };
  }

  revalidatePath("/mobile/notifications");
  return { ok: true as const };
}
