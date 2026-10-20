import { rolesWithCapability } from "@/config/capabilities";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrganizationRole } from "@/config/roles";
import { isNotificationsTableUnavailable } from "@/lib/notifications/schema";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type {
  AnnouncementNotificationPayload,
  AttendanceNotificationPayload,
  BoardNotificationPayload,
  BugReportNotificationPayload,
  OrderProcessedNotificationPayload,
  ProjectNotificationPayload,
  SuggestionNotificationPayload,
  TaskNotificationPayload,
} from "@/lib/notifications/types";
import type { Database } from "@/types/database";

type TaskNotificationType =
  | "task_shared"
  | "task_updated"
  | "task_completed"
  | "task_due_soon"
  | "task_overdue";

/**
 * Fan-out a task notification to each recipient (skipping the actor). `dedupeBase` must be
 * unique per event so distinct events are not collapsed (e.g. include the update id);
 * the recipient id is appended automatically.
 */
export async function notifyTaskParticipants(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    taskId: string;
    recipientUserIds: string[];
    actorUserId: string;
    type: TaskNotificationType;
    dedupeBase: string;
    payload: TaskNotificationPayload;
  },
): Promise<void> {
  const recipients = Array.from(new Set(params.recipientUserIds)).filter(
    (id) => id && id !== params.actorUserId,
  );
  for (const recipientUserId of recipients) {
    await createNotification(supabase, {
      organizationId: params.organizationId,
      recipientUserId,
      type: params.type,
      href: `/mobile/tasks/${params.taskId}`,
      sourceType: "task",
      sourceId: params.taskId,
      dedupeKey: `${params.dedupeBase}:${recipientUserId}`,
      payload: params.payload,
    });
  }
}

/**
 * Fan-out a project notification (currently only `project_shared`) to each invited member,
 * skipping the actor. `dedupeBase` should be unique per event; the recipient id is appended.
 */
export async function notifyProjectMembers(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    projectId: string;
    recipientUserIds: string[];
    actorUserId: string;
    dedupeBase: string;
    payload: ProjectNotificationPayload;
  },
): Promise<void> {
  const recipients = Array.from(new Set(params.recipientUserIds)).filter(
    (id) => id && id !== params.actorUserId,
  );
  for (const recipientUserId of recipients) {
    await createNotification(supabase, {
      organizationId: params.organizationId,
      recipientUserId,
      type: "project_shared",
      href: `/mobile/tasks/projects/${params.projectId}`,
      sourceType: "project",
      sourceId: params.projectId,
      dedupeKey: `${params.dedupeBase}:${recipientUserId}`,
      payload: params.payload,
    });
  }
}

/**
 * Fan-out a Staff Suggestions notification to each recipient, skipping the actor and de-duplicating.
 * Targets must already be limited to valid participants (author / recipient / referenced) by the
 * caller — this never broadens visibility. `dedupeBase` must be unique per event (e.g. include the
 * comment id or new status); the recipient id is appended automatically.
 */
export async function notifySuggestionParticipants(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    suggestionId: string;
    recipientUserIds: string[];
    actorUserId: string;
    dedupeBase: string;
    payload: SuggestionNotificationPayload;
  },
): Promise<void> {
  const recipients = Array.from(new Set(params.recipientUserIds)).filter(
    (id) => id && id !== params.actorUserId,
  );
  for (const recipientUserId of recipients) {
    await createNotification(supabase, {
      organizationId: params.organizationId,
      recipientUserId,
      type: "suggestion_activity",
      href: `/mobile/suggestions/${params.suggestionId}`,
      sourceType: "staff_suggestion",
      sourceId: params.suggestionId,
      dedupeKey: `${params.dedupeBase}:${recipientUserId}`,
      payload: params.payload,
    });
  }
}

/**
 * Fan-out @mentions raised in a board comment. The CALLER must have already validated that every id
 * in `recipientUserIds` is an active member of the same org (and is NOT the actor) — this helper
 * never broadens visibility. When `mentionAll` is true a single `mention_all` notification is sent
 * to each recipient INSTEAD OF individual `mentioned` notifications, so the same comment cannot
 * trigger two notifications for one user. `commentId` makes the dedupe key unique per comment.
 */
export async function notifyBoardCommentMentions(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    postId: string;
    commentId: string;
    recipientUserIds: string[];
    actorUserId: string;
    mentionAll: boolean;
    postTitle: string;
    actorName: string | null;
  },
): Promise<void> {
  const recipients = Array.from(new Set(params.recipientUserIds)).filter(
    (id) => id && id !== params.actorUserId,
  );
  if (recipients.length === 0) return;

  const event: BoardNotificationPayload["event"] = params.mentionAll ? "mention_all" : "mentioned";
  const dedupeBase = params.mentionAll
    ? `board_mention_all:${params.commentId}`
    : `board_mention:${params.commentId}`;

  for (const recipientUserId of recipients) {
    await createNotification(supabase, {
      organizationId: params.organizationId,
      recipientUserId,
      type: "board_activity",
      href: `/mobile/board/${params.postId}`,
      sourceType: "board_post",
      sourceId: params.postId,
      dedupeKey: `${dedupeBase}:${recipientUserId}`,
      payload: {
        postId: params.postId,
        postTitle: params.postTitle,
        actorUserId: params.actorUserId,
        actorName: params.actorName,
        event,
      },
    });
  }
}

/**
 * Notify the board post author of a new comment (single recipient). No-op when the commenter IS the
 * author. `dedupeBase` must be unique per comment (include the comment id) so each comment notifies.
 */
export async function notifyBoardPostAuthor(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    postId: string;
    authorUserId: string;
    actorUserId: string;
    dedupeBase: string;
    payload: BoardNotificationPayload;
  },
): Promise<void> {
  if (!params.authorUserId || params.authorUserId === params.actorUserId) return;
  await createNotification(supabase, {
    organizationId: params.organizationId,
    recipientUserId: params.authorUserId,
    type: "board_activity",
    href: `/mobile/board/${params.postId}`,
    sourceType: "board_post",
    sourceId: params.postId,
    dedupeKey: `${params.dedupeBase}:${params.authorUserId}`,
    payload: params.payload,
  });
}

/**
 * Fan-out a privileged attendance admin alert (correction created / abnormal session) to the supplied
 * recipients (owner + attendance_payroll_admin ids — the CALLER resolves them; this never broadens
 * visibility), skipping the actor. `dedupeBase` must be unique per event; the recipient id is appended.
 */
export async function notifyAttendanceAdmins(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    recipientUserIds: string[];
    actorUserId: string | null;
    dedupeBase: string;
    href: string;
    sourceId: string;
    payload: AttendanceNotificationPayload;
  },
): Promise<void> {
  const recipients = Array.from(new Set(params.recipientUserIds)).filter(
    (id) => id && id !== params.actorUserId,
  );
  for (const recipientUserId of recipients) {
    await createNotification(supabase, {
      organizationId: params.organizationId,
      recipientUserId,
      type: "attendance_activity",
      href: params.href,
      sourceType: "attendance",
      sourceId: params.sourceId,
      dedupeKey: `${params.dedupeBase}:${recipientUserId}`,
      payload: params.payload,
    });
  }
}

/**
 * The worker-facing 18:30 open-session reminder notification. Deduped once per Tokyo day per user, so
 * the scheduled job can't spam. Deep-links to the attendance home where the interactive prompt lives.
 */
export async function createAttendanceOpenSessionReminder(
  supabase: SupabaseClient<Database>,
  params: { organizationId: string; userId: string; tokyoDate: string; sessionId: string },
): Promise<{ created: boolean }> {
  const result = await createNotification(supabase, {
    organizationId: params.organizationId,
    recipientUserId: params.userId,
    type: "attendance_activity",
    href: "/mobile/attendance",
    sourceType: "attendance",
    sourceId: params.sessionId,
    dedupeKey: `attendance_open_reminder:${params.userId}:${params.tokyoDate}`,
    payload: { event: "open_session_reminder", subjectUserId: params.userId, sessionId: params.sessionId },
  });
  return { created: result.created };
}

/**
 * Fan-out an important-announcement publish alert to the targeted active org members, skipping the
 * actor and honoring role-targeting at membership-read time. Dedupe is per announcement + recipient,
 * so re-publishing the same announcement does not spam duplicates.
 */
export async function createImportantAnnouncementNotifications(
  supabase: SupabaseClient<Database>,
  params: {
    organizationId: string;
    announcementId: string;
    announcementTitle: string;
    actorUserId: string;
    targetScope: "everyone" | "roles";
    targetRoles: OrganizationRole[];
  },
): Promise<void> {
  let membershipQuery = supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", params.organizationId)
    .eq("status", "active");
  if (params.targetScope === "roles" && params.targetRoles.length > 0) {
    membershipQuery = membershipQuery.in("role", params.targetRoles);
  }

  const { data, error } = await membershipQuery;
  if (error) {
    console.error("[notifications] important announcement recipients failed", {
      announcementId: params.announcementId,
      error: error.message,
    });
    return;
  }

  const payload: AnnouncementNotificationPayload = {
    announcementId: params.announcementId,
    announcementTitle: params.announcementTitle,
    actorUserId: params.actorUserId,
    event: "important_published",
  };

  const recipientUserIds = Array.from(
    new Set(
      ((data ?? []) as { user_id: string | null }[])
        .map((row) => row.user_id)
        .filter((value): value is string => Boolean(value && value !== params.actorUserId)),
    ),
  );

  for (const recipientUserId of recipientUserIds) {
    await createNotification(supabase, {
      organizationId: params.organizationId,
      recipientUserId,
      type: "announcement_activity",
      href: `/mobile/announcements/${params.announcementId}`,
      sourceType: "announcement",
      sourceId: params.announcementId,
      dedupeKey: `announcement_important:${params.announcementId}:${recipientUserId}`,
      payload,
    });
  }
}

/**
 * Fan-out a `bug_report_activity:created` notification to every reviewer (owner/office_admin) in
 * the organization, skipping the actor. Reviewer membership is resolved here via the service client
 * so the caller does not have to supply it; this never broadens visibility because the role filter
 * is enforced server-side. Dedupe is per report + recipient so resubmitting the same id is a no-op.
 */
export async function notifyBugReportCreated(params: {
  reportId: string;
  reportTitle: string;
  organizationId: string;
  actorUserId: string;
  actorName?: string | null;
}): Promise<void> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("memberships")
    .select("user_id")
    .eq("organization_id", params.organizationId)
    .eq("status", "active")
    .in("role", rolesWithCapability("bug.review"));
  if (error) {
    console.error("[notifications] bug report reviewers failed", {
      reportId: params.reportId,
      error: error.message,
    });
    return;
  }

  const recipients = Array.from(
    new Set(
      ((data ?? []) as { user_id: string | null }[])
        .map((row) => row.user_id)
        .filter((value): value is string => Boolean(value && value !== params.actorUserId)),
    ),
  );

  const payload: BugReportNotificationPayload = {
    reportId: params.reportId,
    reportTitle: params.reportTitle,
    event: "created",
    actorUserId: params.actorUserId,
    actorName: params.actorName ?? null,
  };

  for (const recipientUserId of recipients) {
    await createNotification(service, {
      organizationId: params.organizationId,
      recipientUserId,
      type: "bug_report_activity",
      href: `/mobile/bugs/${params.reportId}`,
      sourceType: "bug_report",
      sourceId: params.reportId,
      dedupeKey: `bug_report_created:${params.reportId}:${recipientUserId}`,
      payload,
    });
  }
}

/**
 * Notify the original reporter when a reviewer changes the report's status. Self-suppressed when
 * the reviewer IS the reporter (rare edge case but handled). Dedupe includes the new status so each
 * distinct transition produces a fresh notification (submitted → reviewing → fixed → closed).
 */
export async function notifyBugReportStatusChanged(params: {
  reportId: string;
  reportTitle: string;
  reporterUserId: string;
  status: BugReportNotificationPayload["status"];
  actorUserId: string;
  actorName?: string | null;
  organizationId?: string;
}): Promise<void> {
  if (!params.reporterUserId || params.reporterUserId === params.actorUserId) return;

  const service = getSupabaseServiceClient();

  // organizationId may be omitted by callers that already validated the report; look it up to keep
  // the notification row's organization_id correct (required column).
  let organizationId = params.organizationId ?? null;
  if (!organizationId) {
    const { data, error } = await service
      .from("bug_reports")
      .select("organization_id")
      .eq("id", params.reportId)
      .maybeSingle();
    if (error || !data) return;
    organizationId = (data as { organization_id: string }).organization_id;
  }

  const payload: BugReportNotificationPayload = {
    reportId: params.reportId,
    reportTitle: params.reportTitle,
    event: "status_changed",
    status: params.status,
    actorUserId: params.actorUserId,
    actorName: params.actorName ?? null,
  };

  await createNotification(service, {
    organizationId,
    recipientUserId: params.reporterUserId,
    type: "bug_report_activity",
    href: `/mobile/bugs/${params.reportId}`,
    sourceType: "bug_report",
    sourceId: params.reportId,
    dedupeKey: `bug_report_status:${params.reportId}:${params.status ?? "unknown"}`,
    payload,
  });
}

type CreateNotificationInput = {
  organizationId: string;
  recipientUserId: string;
  type: Database["public"]["Enums"]["notification_type"];
  href: string;
  sourceType: string;
  sourceId: string;
  dedupeKey: string;
  payload: Database["public"]["Tables"]["notifications"]["Insert"]["payload"];
};

export async function createNotification(
  supabase: SupabaseClient<Database>,
  input: CreateNotificationInput,
): Promise<{ created: boolean; id: string | null }> {
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      organization_id: input.organizationId,
      recipient_user_id: input.recipientUserId,
      type: input.type,
      href: input.href,
      source_type: input.sourceType,
      source_id: input.sourceId,
      dedupe_key: input.dedupeKey,
      payload: input.payload,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { created: false, id: null };
    }
    if (isNotificationsTableUnavailable(error.message)) {
      console.warn("[notifications] create skipped — table not migrated:", error.message);
      return { created: false, id: null };
    }
    console.error("[notifications] create failed", {
      type: input.type,
      dedupeKey: input.dedupeKey,
      error: error.message,
    });
    return { created: false, id: null };
  }

  return { created: true, id: (data as { id: string } | null)?.id ?? null };
}

export async function createOrderProcessedNotification(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  recipientUserId: string;
  processedByUserId: string;
  order: {
    id: string;
    title: string;
    building_name: string;
    room_label: string;
    delivery_date: string | null;
    delivery_start_date: string | null;
    delivery_end_date: string | null;
  };
}) {
  if (params.recipientUserId === params.processedByUserId) {
    return { created: false, id: null };
  }

  const payload: OrderProcessedNotificationPayload = {
    orderId: params.order.id,
    orderTitle: params.order.title,
    buildingName: params.order.building_name,
    roomLabel: params.order.room_label,
    status: "ordered",
    deliveryDate: params.order.delivery_date,
    deliveryStartDate: params.order.delivery_start_date,
    deliveryEndDate: params.order.delivery_end_date,
    processedByUserId: params.processedByUserId,
  };

  return createNotification(params.supabase, {
    organizationId: params.organizationId,
    recipientUserId: params.recipientUserId,
    type: "order_processed",
    href: `/mobile/requests/orders/${params.order.id}`,
    sourceType: "order_request",
    sourceId: params.order.id,
    dedupeKey: `order_processed:${params.order.id}`,
    payload,
  });
}

// Notify the requester when the delivery date of an already-ordered request is edited. Reuses the
// `order_processed` notification type (no enum migration) but flags `kind: "delivery_updated"` so the
// display renders a "delivery date changed" message. The dedupeKey includes the new delivery value so
// each distinct change produces a fresh notification.
export async function createOrderDeliveryUpdatedNotification(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  recipientUserId: string;
  editedByUserId: string;
  order: {
    id: string;
    title: string;
    building_name: string;
    room_label: string;
    delivery_date: string | null;
    delivery_start_date: string | null;
    delivery_end_date: string | null;
  };
}) {
  if (params.recipientUserId === params.editedByUserId) {
    return { created: false, id: null };
  }

  const payload: OrderProcessedNotificationPayload = {
    orderId: params.order.id,
    orderTitle: params.order.title,
    buildingName: params.order.building_name,
    roomLabel: params.order.room_label,
    status: "ordered",
    deliveryDate: params.order.delivery_date,
    deliveryStartDate: params.order.delivery_start_date,
    deliveryEndDate: params.order.delivery_end_date,
    processedByUserId: params.editedByUserId,
    kind: "delivery_updated",
  };

  const deliveryKey =
    params.order.delivery_start_date && params.order.delivery_end_date
      ? `${params.order.delivery_start_date}_${params.order.delivery_end_date}`
      : params.order.delivery_date ?? "none";

  return createNotification(params.supabase, {
    organizationId: params.organizationId,
    recipientUserId: params.recipientUserId,
    type: "order_processed",
    href: `/mobile/requests/orders/${params.order.id}`,
    sourceType: "order_request",
    sourceId: params.order.id,
    dedupeKey: `order_delivery_updated:${params.order.id}:${deliveryKey}`,
    payload,
  });
}
