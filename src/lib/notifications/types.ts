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
  // 원래의 "주문 처리됨" 팬아웃과 이후의 납품일 수정을 구분한다. 둘 다
  // `order_processed` 알림 유형을 재사용하며(enum 마이그레이션 없음) 표시가 이 값으로 분기한다.
  kind?: "processed" | "delivery_updated";
};

export type TaskNotificationPayload = {
  taskId: string;
  taskTitle: string;
  actorUserId: string | null;
  // `due_soon`/`overdue` 는 시스템 리마인더(행위자 없음)이고 나머지는 활동 이벤트다.
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
  // 구분 가능한 `suggestion_activity` 유형 하나가 모든 이벤트를 담는다 (이벤트마다 enum 값을 두지 않음).
  event: "created" | "referenced" | "status" | "comment";
  // `status` 이벤트에만 있어, 표시가 새 상태를 이름으로 말할 수 있다 (예: on_hold / completed).
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
  // 구분 가능한 `bug_report_activity` 유형 하나가 두 이벤트를 담는다 (이벤트마다 enum 값을 두지 않음):
  // `created` 는 조직의 검토자들에게 퍼지고, `status_changed` 는 최초 신고자에게 알린다.
  // 표시가 `status` 로 분기해 알맞은 본문 문구를 고른다.
  event: "created" | "status_changed";
  status?: "submitted" | "reviewing" | "fixed" | "closed";
  actorUserId?: string | null;
  actorName?: string | null;
};

export type BoardNotificationPayload = {
  postId: string;
  postTitle: string;
  actorUserId: string | null;
  // 구분 가능한 `board_activity` 유형 하나. `commented` 는 새 댓글이 달리면 게시글 작성자에게
  // 알리고, `mentioned` 는 댓글 본문의 직접 @멘션이며, `mention_all` 은 @ALL 팬아웃이다.
  // mention_all 이 나가면 같은 댓글에 대한 개별 `mentioned` 알림은
  // 모두에게 이중 알림이 가지 않도록 억제한다 (notifyBoardCommentMentions 참고).
  event: "commented" | "mentioned" | "mention_all";
  actorName?: string | null;
};

export type AttendanceNotificationPayload = {
  // 구분 가능한 `attendance_activity` 유형 하나가 모든 이벤트를 담는다 (이벤트마다 enum 값을 두지 않음).
  // `open_session_reminder` 는 작업자 대상(18:30 리마인더)이고, 나머지는 관리자/사용자 알림이다.
  event:
    | "correction_created"
    | "correction_approved"
    | "correction_rejected"
    | "abnormal_session"
    | "open_session_reminder";
  /** 알림의 대상 작업자 (관리자 알림); 리마인더에서는 수신자 본인. */
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
