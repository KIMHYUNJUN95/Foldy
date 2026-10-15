import type { SupabaseClient } from "@supabase/supabase-js";
import { isNotificationsTableUnavailable } from "@/lib/notifications/schema";
import type { NotificationRow } from "@/lib/notifications/types";
import type { Database } from "@/types/database";

export type NotificationScope = {
  userId: string;
  organizationId: string;
};

export type NotificationsListResult = {
  items: NotificationRow[];
  schemaUnavailable: boolean;
};

function logNotificationsSchemaUnavailable(context: string, message: string) {
  console.warn(
    `[notifications] ${context}: table or enum not available (apply supabase/migrations/202606030001_notifications.sql):`,
    message,
  );
}

export async function listNotificationsForUser(
  supabase: SupabaseClient<Database>,
  scope: NotificationScope,
  options?: { limit?: number },
): Promise<NotificationsListResult> {
  const limit = options?.limit ?? 50;
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_user_id", scope.userId)
    .eq("organization_id", scope.organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isNotificationsTableUnavailable(error.message)) {
      logNotificationsSchemaUnavailable("list", error.message);
      return { items: [], schemaUnavailable: true };
    }
    throw new Error(`notifications list failed: ${error.message}`);
  }

  return { items: (data ?? []) as NotificationRow[], schemaUnavailable: false };
}

export async function countUnreadNotifications(
  supabase: SupabaseClient<Database>,
  scope: NotificationScope,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_user_id", scope.userId)
    .eq("organization_id", scope.organizationId)
    .is("read_at", null);

  if (error) {
    if (isNotificationsTableUnavailable(error.message)) {
      logNotificationsSchemaUnavailable("unread count", error.message);
      return 0;
    }
    throw new Error(`notifications unread count failed: ${error.message}`);
  }

  return count ?? 0;
}

export async function markNotificationRead(
  supabase: SupabaseClient<Database>,
  notificationId: string,
  scope: NotificationScope,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_user_id", scope.userId)
    .eq("organization_id", scope.organizationId)
    .is("read_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isNotificationsTableUnavailable(error.message)) {
      logNotificationsSchemaUnavailable("mark read", error.message);
      return false;
    }
    console.error("[notifications] mark read failed", error.message);
    return false;
  }

  return Boolean(data);
}

export async function deleteNotifications(
  supabase: SupabaseClient<Database>,
  notificationIds: string[],
  scope: NotificationScope,
): Promise<boolean> {
  if (notificationIds.length === 0) return true;
  const { error } = await supabase
    .from("notifications")
    .delete()
    .in("id", notificationIds)
    .eq("recipient_user_id", scope.userId)
    .eq("organization_id", scope.organizationId);

  if (error) {
    if (isNotificationsTableUnavailable(error.message)) {
      logNotificationsSchemaUnavailable("delete", error.message);
      return false;
    }
    console.error("[notifications] delete failed", error.message);
    return false;
  }

  return true;
}

export async function markAllNotificationsRead(
  supabase: SupabaseClient<Database>,
  scope: NotificationScope,
) {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", scope.userId)
    .eq("organization_id", scope.organizationId)
    .is("read_at", null);

  if (error) {
    if (isNotificationsTableUnavailable(error.message)) {
      logNotificationsSchemaUnavailable("mark all read", error.message);
      return false;
    }
    console.error("[notifications] mark all read failed", error.message);
    return false;
  }

  return true;
}

/** 여러 알림을 읽음으로(밀어서 「읽음」 · 묶음 줄) — 내 알림 · 이 조직 · 아직 안 읽은 것만. */
export async function markNotificationsReadByIds(
  supabase: SupabaseClient<Database>,
  notificationIds: string[],
  scope: NotificationScope,
): Promise<boolean> {
  if (notificationIds.length === 0) return true;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", notificationIds)
    .eq("recipient_user_id", scope.userId)
    .eq("organization_id", scope.organizationId)
    .is("read_at", null);

  if (error) {
    if (isNotificationsTableUnavailable(error.message)) {
      logNotificationsSchemaUnavailable("mark read (ids)", error.message);
      return false;
    }
    console.error("[notifications] mark read (ids) failed", error.message);
    return false;
  }

  return true;
}
