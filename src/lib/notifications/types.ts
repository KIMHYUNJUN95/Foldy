import type { Database } from "@/types/database";

export type NotificationType = Database["public"]["Enums"]["notification_type"];

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export type OrderProcessedNotificationPayload = {
  orderId: string;
  orderTitle: string;
  buildingName: string;
  roomLabel: string;
  status: "ordered";
  deliveryDate: string | null;
  deliveryStartDate: string | null;
  deliveryEndDate: string | null;
  processedByUserId: string | null;
  // Distinguishes the original "order processed" fan-out from a later delivery-date edit. Both reuse
  // the `order_processed` notification type (no enum migration); the display branches on this.
  kind?: "processed" | "delivery_updated";
};

export type TaskNotificationPayload = {
  taskId: string;
  taskTitle: string;
  actorUserId: string | null;
  // `due_soon`/`overdue` are system reminders (no actor); the rest are activity events.
  event: "shared" | "edited" | "note" | "completed" | "reopened" | "due_soon" | "overdue";
};

export type ProjectNotificationPayload = {
  projectId: string;
  projectTitle: string;
  actorUserId: string | null;
  event: "shared";
};

export type SuggestionNotificationPayload = {
  suggestionId: string;
  suggestionTitle: string;
  actorUserId: string | null;
  // One discriminated `suggestion_activity` type carries every event (no enum value per event).
  event: "created" | "referenced" | "status" | "comment";
  // Present for `status` events so the display can name the new status (e.g. on_hold / completed).
  status?: "submitted" | "reviewing" | "on_hold" | "completed" | null;
};

export type AnnouncementNotificationPayload = {
  announcementId: string;
  announcementTitle: string;
  actorUserId: string | null;
  event: "important_published";
};

export type BugReportNotificationPayload = {
  reportId: string;
  reportTitle: string;
  // One discriminated `bug_report_activity` type carries both events (no enum value per event):
  // `created` fans out to org reviewers; `status_changed` notifies the original reporter and the
  // display branches on `status` to pick the right body string.
  event: "created" | "status_changed";
  status?: "submitted" | "reviewing" | "fixed" | "closed";
  actorUserId?: string | null;
  actorName?: string | null;
};

export type BoardNotificationPayload = {
  postId: string;
  postTitle: string;
  actorUserId: string | null;
  // One discriminated `board_activity` type. `commented` notifies the post author of any new
  // comment; `mentioned` is a direct @mention in a comment body; `mention_all` is the @ALL fan-out.
  // When mention_all goes out, individual `mentioned` notifications for the same comment are
  // suppressed to avoid double-notifying everyone (see notifyBoardCommentMentions).
  event: "commented" | "mentioned" | "mention_all";
  actorName?: string | null;
};

export type AttendanceNotificationPayload = {
  // One discriminated `attendance_activity` type carries every event (no enum value per event).
  // `open_session_reminder` is worker-facing (the 18:30 reminder); the others are admin/user alerts.
  event:
    | "correction_created"
    | "correction_approved"
    | "correction_rejected"
    | "abnormal_session"
    | "open_session_reminder";
  /** The worker the alert is about (admin alerts); the recipient themselves for the reminder. */
  subjectUserId?: string | null;
  subjectName?: string | null;
  sessionId?: string | null;
  correctionId?: string | null;
};

export type IdDocumentExpiryNotificationPayload = {
  documentId: string;
  /** 카드 주인. 관리자 알림이면 「OOO님」의 그 사람. */
  subjectUserId: string;
  /** 보낸 때의 이름(관리자 알림 글에만 쓴다). */
  subjectName: string | null;
  /** 90일 전 · 30일 전 · 만료 — `src/lib/staff-documents/expiry.ts`. */
  stage: "d90" | "d30" | "expired";
  /** 보낸 날 기준 남은 날(크론이 하루 빠지면 89처럼 단계 값과 다를 수 있다). 만료면 음수. */
  daysLeft: number;
  /** 본인 알림인가, `staff_documents.view` 가진 사람 알림인가 — 글이 다르다. */
  audience: "holder" | "admin";
};

export type NotificationPayloadByType = {
  order_processed: OrderProcessedNotificationPayload;
  task_shared: TaskNotificationPayload;
  task_updated: TaskNotificationPayload;
  task_completed: TaskNotificationPayload;
  task_due_soon: TaskNotificationPayload;
  task_overdue: TaskNotificationPayload;
  project_shared: ProjectNotificationPayload;
  suggestion_activity: SuggestionNotificationPayload;
  announcement_activity: AnnouncementNotificationPayload;
  attendance_activity: AttendanceNotificationPayload;
  board_activity: BoardNotificationPayload;
  bug_report_activity: BugReportNotificationPayload;
  id_document_expiring: IdDocumentExpiryNotificationPayload;
};

export function isTaskNotificationPayload(
  payload: unknown,
): payload is TaskNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return typeof record.taskId === "string" && typeof record.taskTitle === "string";
}

export function isProjectNotificationPayload(
  payload: unknown,
): payload is ProjectNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return typeof record.projectId === "string" && typeof record.projectTitle === "string";
}

export function isOrderProcessedPayload(
  payload: unknown,
): payload is OrderProcessedNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return typeof record.orderId === "string" && typeof record.orderTitle === "string";
}

export function isSuggestionNotificationPayload(
  payload: unknown,
): payload is SuggestionNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return (
    typeof record.suggestionId === "string" && typeof record.suggestionTitle === "string"
  );
}

export function isAnnouncementNotificationPayload(
  payload: unknown,
): payload is AnnouncementNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return (
    typeof record.announcementId === "string" &&
    typeof record.announcementTitle === "string" &&
    record.event === "important_published"
  );
}

export function isBoardNotificationPayload(
  payload: unknown,
): payload is BoardNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return typeof record.postId === "string" && typeof record.postTitle === "string";
}

export function isBugReportNotificationPayload(
  payload: unknown,
): payload is BugReportNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return (
    typeof record.reportId === "string" &&
    typeof record.reportTitle === "string" &&
    (record.event === "created" || record.event === "status_changed")
  );
}

export function isAttendanceNotificationPayload(
  payload: unknown,
): payload is AttendanceNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return (
    record.event === "correction_created" ||
    record.event === "correction_approved" ||
    record.event === "correction_rejected" ||
    record.event === "abnormal_session" ||
    record.event === "open_session_reminder"
  );
}

export function isIdDocumentExpiryNotificationPayload(
  payload: unknown,
): payload is IdDocumentExpiryNotificationPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  return (
    typeof record.documentId === "string" &&
    (record.stage === "d90" || record.stage === "d30" || record.stage === "expired") &&
    typeof record.daysLeft === "number" &&
    (record.audience === "holder" || record.audience === "admin")
  );
}
