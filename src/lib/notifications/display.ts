import type { Locale } from "@/lib/i18n";
import { getDictionary } from "@/lib/i18n";
import { bugStatusLabel, type BugStatus } from "@/components/bugs/bug-types";
import { localizeBuildingName } from "@/lib/room-label-normalization";
import {
  isAnnouncementNotificationPayload,
  isAttendanceNotificationPayload,
  isBoardNotificationPayload,
  isBugReportNotificationPayload,
  isIdDocumentExpiryNotificationPayload,
  isOrderProcessedPayload,
  isProjectNotificationPayload,
  isSuggestionNotificationPayload,
  isTaskNotificationPayload,
  type NotificationRow,
  type NotificationType,
} from "@/lib/notifications/types";

const BUG_STATUSES: readonly string[] = ["submitted", "reviewing", "fixed", "closed"];
const isBugStatus = (value: string): value is BugStatus => BUG_STATUSES.includes(value);

export type NotificationDisplay = {
  title: string;
  body: string;
  statusLabel: string;
  kindLabel: string;
  locationLabel: string;
};

function formatDeliverySummary(
  payload: {
    deliveryDate: string | null;
    deliveryStartDate: string | null;
    deliveryEndDate: string | null;
  },
  locale: Locale,
  copy: ReturnType<typeof getDictionary>["mobile"]["notifications"],
) {
  if (payload.deliveryStartDate && payload.deliveryEndDate) {
    const start = formatDateOnly(payload.deliveryStartDate, locale);
    const end = formatDateOnly(payload.deliveryEndDate, locale);
    return copy.deliveryRange.replace("{start}", start).replace("{end}", end);
  }
  if (payload.deliveryDate) {
    return copy.deliveryExact.replace(
      "{date}",
      formatDateOnly(payload.deliveryDate, locale),
    );
  }
  return null;
}

function formatDateOnly(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

export function formatNotificationTimestamp(value: string, locale: Locale) {
  // hour12 must be false: Node.js ICU renders "PM 03:51" for ko locale while
  // the browser renders "오후 03:51", causing a React hydration mismatch.
  // 24-hour format is consistent across both environments.
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

export function getNotificationDisplay(
  notification: Pick<NotificationRow, "type" | "payload">,
  locale: Locale,
): NotificationDisplay {
  const dictionary = getDictionary(locale);
  const copy = dictionary.mobile.notifications;
  const statusLabels = dictionary.mobile.orderStatusLabels;

  if (notification.type === "order_processed" && isOrderProcessedPayload(notification.payload)) {
    const payload = notification.payload;
    // 건물은 한국어 정규 명칭으로 실려 온다 — 보는 사람 언어로(2026-10-22).
    const building = localizeBuildingName(payload.buildingName, dictionary.cleaning.buildingLabels);
    const location = payload.roomLabel && payload.roomLabel !== "-" ? `${building} · ${payload.roomLabel}` : building;
    const delivery = formatDeliverySummary(payload, locale, copy);
    const isDeliveryUpdate = payload.kind === "delivery_updated";
    const body = isDeliveryUpdate
      ? (delivery ? copy.orderDeliveryUpdatedBody : copy.orderProcessedBody)
          .replace("{title}", payload.orderTitle)
          .replace("{delivery}", delivery ?? "")
      : delivery
        ? copy.orderProcessedBodyWithDelivery
            .replace("{title}", payload.orderTitle)
            .replace("{delivery}", delivery)
        : copy.orderProcessedBody.replace("{title}", payload.orderTitle);

    return {
      title: isDeliveryUpdate ? copy.orderDeliveryUpdatedTitle : copy.orderProcessedTitle,
      body,
      statusLabel: statusLabels.ordered,
      kindLabel: copy.kindOrder,
      locationLabel: location,
    };
  }

  if (
    (notification.type === "task_shared" ||
      notification.type === "task_updated" ||
      notification.type === "task_completed" ||
      notification.type === "task_due_soon" ||
      notification.type === "task_overdue") &&
    isTaskNotificationPayload(notification.payload)
  ) {
    const payload = notification.payload;
    const title =
      notification.type === "task_shared"
        ? copy.taskSharedTitle
        : notification.type === "task_completed"
          ? copy.taskCompletedTitle
          : notification.type === "task_due_soon"
            ? copy.taskDueSoonTitle
            : notification.type === "task_overdue"
              ? copy.taskOverdueTitle
              : copy.taskUpdatedTitle;
    const bodyTemplate =
      payload.event === "note"
        ? copy.taskNoteBody
        : payload.event === "edited"
          ? copy.taskEditedBody
          : payload.event === "completed"
            ? copy.taskCompletedBody
            : payload.event === "reopened"
              ? copy.taskReopenedBody
              : payload.event === "due_soon"
                ? copy.taskDueSoonBody
                : payload.event === "overdue"
                  ? copy.taskOverdueBody
                  : copy.taskSharedBody;
    return {
      title,
      body: bodyTemplate.replace("{title}", payload.taskTitle),
      statusLabel: copy.taskKind,
      kindLabel: copy.taskKind,
      locationLabel: "",
    };
  }

  if (
    notification.type === "project_shared" &&
    isProjectNotificationPayload(notification.payload)
  ) {
    const payload = notification.payload;
    return {
      title: copy.projectSharedTitle,
      body: copy.projectSharedBody.replace("{title}", payload.projectTitle),
      statusLabel: copy.projectKind,
      kindLabel: copy.projectKind,
      locationLabel: "",
    };
  }

  if (
    notification.type === "suggestion_activity" &&
    isSuggestionNotificationPayload(notification.payload)
  ) {
    const payload = notification.payload;
    const title =
      payload.event === "created"
        ? copy.suggestionCreatedTitle
        : payload.event === "referenced"
          ? copy.suggestionReferencedTitle
          : payload.event === "status"
            ? copy.suggestionStatusTitle
            : copy.suggestionCommentTitle;
    const bodyTemplate =
      payload.event === "created"
        ? copy.suggestionCreatedBody
        : payload.event === "referenced"
          ? copy.suggestionReferencedBody
          : payload.event === "comment"
            ? copy.suggestionCommentBody
            : payload.status === "on_hold"
              ? copy.suggestionStatusBodyHold
              : payload.status === "completed"
                ? copy.suggestionStatusBodyDone
                : copy.suggestionStatusBody;
    return {
      title,
      body: bodyTemplate.replace("{title}", payload.suggestionTitle),
      statusLabel: copy.suggestionKind,
      kindLabel: copy.suggestionKind,
      locationLabel: "",
    };
  }

  if (
    notification.type === "announcement_activity" &&
    isAnnouncementNotificationPayload(notification.payload)
  ) {
    const payload = notification.payload;
    return {
      title: copy.announcementImportantTitle,
      body: copy.announcementImportantBody.replace("{title}", payload.announcementTitle),
      statusLabel: copy.announcementKind,
      kindLabel: copy.announcementKind,
      locationLabel: "",
    };
  }

  if (
    notification.type === "board_activity" &&
    isBoardNotificationPayload(notification.payload)
  ) {
    const payload = notification.payload;
    const title =
      payload.event === "mentioned"
        ? copy.boardMentionTitle
        : payload.event === "mention_all"
          ? copy.boardMentionAllTitle
          : copy.boardCommentTitle;
    const bodyTemplate =
      payload.event === "mentioned"
        ? copy.boardMentionBody
        : payload.event === "mention_all"
          ? copy.boardMentionAllBody
          : copy.boardCommentBody;
    const body = bodyTemplate
      .replace("{title}", payload.postTitle)
      .replace("{actor}", payload.actorName ?? "");
    return {
      title,
      body,
      statusLabel: copy.boardKind,
      kindLabel: copy.boardKind,
      locationLabel: "",
    };
  }

  if (
    notification.type === "bug_report_activity" &&
    isBugReportNotificationPayload(notification.payload)
  ) {
    const payload = notification.payload;
    const isCreated = payload.event === "created";
    const titleTemplate = isCreated ? copy.notificationBugReportCreatedTitle : copy.notificationBugReportStatusChangedTitle;
    const bodyTemplate = isCreated ? copy.notificationBugReportCreatedBody : copy.notificationBugReportStatusChangedBody;
    // 상태는 코드(`fixed`)로 실려 온다 — 버그 신고 화면과 같은 이름으로(2026-10-22, 전엔 영어 코드가 그대로 보였다).
    const status = (payload.status ?? "") as string;
    const statusText = isBugStatus(status) ? bugStatusLabel(dictionary.bugs, status) : status;
    const body = bodyTemplate
      .replace("{title}", payload.reportTitle)
      .replace("{actor}", payload.actorName ?? "")
      .replace("{status}", statusText);
    const kindLabel = copy.bugReportKind;
    return {
      title: titleTemplate,
      body,
      statusLabel: kindLabel,
      kindLabel,
      locationLabel: "",
    };
  }

  if (
    notification.type === "attendance_activity" &&
    isAttendanceNotificationPayload(notification.payload)
  ) {
    const payload = notification.payload;
    const title =
      payload.event === "correction_created"
        ? copy.attendanceCorrectionTitle
        : payload.event === "correction_approved"
          ? copy.attendanceCorrectionApprovedTitle
          : payload.event === "correction_rejected"
            ? copy.attendanceCorrectionRejectedTitle
        : payload.event === "abnormal_session"
          ? copy.attendanceAbnormalTitle
          : copy.attendanceReminderTitle;
    const body = (
      payload.event === "correction_created"
        ? copy.attendanceCorrectionBody
        : payload.event === "correction_approved"
          ? copy.attendanceCorrectionApprovedBody
          : payload.event === "correction_rejected"
            ? copy.attendanceCorrectionRejectedBody
        : payload.event === "abnormal_session"
          ? copy.attendanceAbnormalBody
          : copy.attendanceReminderBody
    ).replace("{name}", payload.subjectName ?? "");
    return {
      title,
      body,
      statusLabel: copy.attendanceKind,
      kindLabel: copy.attendanceKind,
      locationLabel: "",
    };
  }

  if (
    notification.type === "id_document_expiring" &&
    isIdDocumentExpiryNotificationPayload(notification.payload)
  ) {
    const payload = notification.payload;
    const expired = payload.stage === "expired";
    const admin = payload.audience === "admin";
    const days = String(Math.max(0, payload.daysLeft));
    const name = payload.subjectName ?? "";
    const body = (
      expired
        ? admin
          ? copy.idDocExpiredAdminBody
          : copy.idDocExpiredBody
        : admin
          ? copy.idDocExpiringAdminBody
          : copy.idDocExpiringBody
    )
      .replace("{name}", name)
      .replace("{n}", days);
    return {
      title: expired ? copy.idDocExpiredTitle : copy.idDocExpiringTitle.replace("{n}", days),
      body,
      statusLabel: copy.idDocKind,
      kindLabel: copy.idDocKind,
      locationLabel: "",
    };
  }

  return {
    title: copy.fallbackTitle,
    body: copy.fallbackBody,
    statusLabel: copy.fallbackStatus,
    kindLabel: copy.fallbackKind,
    locationLabel: "",
  };
}

export function notificationTypeLabel(type: NotificationType, locale: Locale) {
  const copy = getDictionary(locale).mobile.notifications;
  switch (type) {
    case "order_processed":
      return copy.kindOrder;
    case "task_shared":
    case "task_updated":
    case "task_completed":
    case "task_due_soon":
    case "task_overdue":
      return copy.taskKind;
    case "project_shared":
      return copy.projectKind;
    case "announcement_activity":
      return copy.announcementKind;
    case "suggestion_activity":
      return copy.suggestionKind;
    case "attendance_activity":
      return copy.attendanceKind;
    case "board_activity":
      return copy.boardKind;
    case "bug_report_activity":
      return copy.bugReportKind;
    case "id_document_expiring":
      return copy.idDocKind;
    default:
      return copy.fallbackKind;
  }
}
