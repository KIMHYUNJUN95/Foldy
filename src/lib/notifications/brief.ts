import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/lib/i18n";
import { getDictionary } from "@/lib/i18n";
import { getNotificationDisplay } from "@/lib/notifications/display";
import { localizeBuildingName, localizeRoomPlaceLabel } from "@/lib/room-label-normalization";
import { categoryForType, type NotificationIconKey, type NotificationView } from "@/lib/notifications/grouping";
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
} from "@/lib/notifications/types";
import type { Database } from "@/types/database";

/**
 * 알림 한 건 → 화이트 리디자인 줄(짧은 제목 · 대상 · 시각 · 어디서). 서버에서만 부른다(사전을 읽는다).
 * 저장된 알림에는 문장이 없고 `type` + `payload` 만 있다 — 여기서 종류 · 사건마다 짧은 글로 바꾼다. 모르는 종류 · 깨진
 * payload 는 예전 긴 문장(`getNotificationDisplay`)으로 떨어진다.
 *
 * 문서: docs/product/14-notification-design.md 「알림 화면 — 화이트 리디자인」
 */

type Copy = ReturnType<typeof getDictionary>["mobile"]["notifications"]["w"];

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);

const tokyoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const tokyoClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });

function dayKeyOf(iso: string): string {
  return tokyoDay.format(new Date(iso));
}

/** 오늘 「오전 8:02」 · 어제 「어제 18:20」 · 그 전 「10/13」. 오전/오후 표기는 사전 틀로(Node ICU 와 브라우저가 달라서). */
export function formatNotificationShortTime(iso: string, todayKey: string, copy: Copy): string {
  const dayKey = dayKeyOf(iso);
  const [hh, mm] = tokyoClock.format(new Date(iso)).split(":").map(Number);
  const clock24 = `${hh}:${String(mm).padStart(2, "0")}`;
  if (dayKey === todayKey) {
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return fill(hh < 12 ? copy.timeAm : copy.timePm, { time: `${h12}:${String(mm).padStart(2, "0")}` });
  }
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
  if (dayKey === yesterday) return fill(copy.timeYesterday, { time: clock24 });
  const [, m, d] = dayKey.split("-").map(Number);
  return `${m}/${d}`;
}

/** 작업 공유처럼 「누가」가 중요한 알림의 이름 — 같은 조직 프로필만 읽힌다(RLS). 실패하면 이름 없이 그린다. */
export async function loadNotificationActorNames(
  supabase: SupabaseClient<Database>,
  rows: readonly Pick<NotificationRow, "type" | "payload">[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.type === "task_shared" && isTaskNotificationPayload(row.payload) && row.payload.actorUserId) {
      ids.add(row.payload.actorUserId);
    }
    if (row.type === "project_shared" && isProjectNotificationPayload(row.payload) && row.payload.actorUserId) {
      ids.add(row.payload.actorUserId);
    }
  }
  const names = new Map<string, string>();
  if (ids.size === 0) return names;
  try {
    const { data } = await supabase.from("profiles").select("id, name").in("id", Array.from(ids));
    for (const profile of data ?? []) if (profile.name) names.set(profile.id, profile.name);
  } catch {
    // 이름은 덤 — 못 읽어도 줄은 그린다.
  }
  return names;
}

type Brief = { title: string; object: string; icon: NotificationIconKey; source: string; event: string };

function briefOf(row: NotificationRow, locale: Locale, actorNames: Map<string, string>): Brief {
  const dictionary = getDictionary(locale);
  const copy = dictionary.mobile.notifications.w;
  const nav = dictionary.navigation.mobile as Record<string, string | undefined>;
  const source = (key: string, fallback: string) => nav[key] ?? fallback;
  const quote = (title: string) => fill(copy.quoted, { title });
  const withActor = (name: string | null | undefined, object: string) =>
    name ? fill(copy.actorObject, { name, object }) : object;
  const payload = row.payload;

  if (
    (row.type === "task_shared" ||
      row.type === "task_updated" ||
      row.type === "task_completed" ||
      row.type === "task_due_soon" ||
      row.type === "task_overdue") &&
    isTaskNotificationPayload(payload)
  ) {
    const object = quote(payload.taskTitle);
    const src = source("tasks", "");
    switch (row.type) {
      case "task_overdue":
        return { title: copy.tOverdue, object, icon: "flag", source: src, event: "overdue" };
      case "task_due_soon":
        return { title: copy.tDueToday, object, icon: "clock", source: src, event: "due_soon" };
      case "task_completed":
        return { title: copy.tTaskCompleted, object, icon: "check", source: src, event: payload.event };
      case "task_shared":
        return {
          title: copy.tTaskShared,
          object: withActor(payload.actorUserId ? actorNames.get(payload.actorUserId) : null, object),
          icon: "user",
          source: src,
          event: "shared",
        };
      default: {
        const title =
          payload.event === "edited"
            ? copy.tTaskEdited
            : payload.event === "reopened"
              ? copy.tTaskReopened
              : payload.event === "completed"
                ? copy.tTaskCompleted
                : copy.tTaskNote;
        return { title, object, icon: payload.event === "completed" ? "check" : "comment", source: src, event: payload.event };
      }
    }
  }

  if (row.type === "project_shared" && isProjectNotificationPayload(payload)) {
    return {
      title: copy.tProjectShared,
      object: withActor(payload.actorUserId ? actorNames.get(payload.actorUserId) : null, quote(payload.projectTitle)),
      icon: "folder",
      source: source("tasks", ""),
      event: "shared",
    };
  }

  if (row.type === "order_processed" && isOrderProcessedPayload(payload)) {
    const building = localizeBuildingName(payload.buildingName, dictionary.cleaning.buildingLabels);
    // 독채는 방 라벨이 건물 이름(「오쿠보A」) — 방 자리도 보는 사람 언어로 바꾸고, 건물과 같으면 한 번만 쓴다(2026-10-26).
    const room =
      payload.roomLabel && payload.roomLabel !== "-"
        ? localizeRoomPlaceLabel(payload.roomLabel, dictionary.cleaning.buildingLabels)
        : "";
    const location = room && room !== building ? `${building} ${room}` : building;
    const object = location ? `${quote(payload.orderTitle)} · ${location}` : quote(payload.orderTitle);
    const delivery = payload.kind === "delivery_updated";
    return {
      title: delivery ? copy.tOrderDelivery : copy.tOrderProcessed,
      object,
      icon: "box",
      source: source("requests", ""),
      event: delivery ? "delivery_updated" : "processed",
    };
  }

  if (row.type === "suggestion_activity" && isSuggestionNotificationPayload(payload)) {
    const title =
      payload.event === "created"
        ? copy.tSuggestionNew
        : payload.event === "referenced"
          ? copy.tSuggestionRef
          : payload.event === "comment"
            ? copy.tSuggestionComment
            : payload.status === "on_hold"
              ? copy.tSuggestionHold
              : payload.status === "completed"
                ? copy.tSuggestionDone
                : copy.tSuggestionStatus;
    return {
      title,
      object: quote(payload.suggestionTitle),
      icon: payload.event === "comment" ? "comment" : "bulb",
      source: source("suggestions", ""),
      event: `${payload.event}:${payload.status ?? ""}`,
    };
  }

  if (row.type === "announcement_activity" && isAnnouncementNotificationPayload(payload)) {
    return {
      title: copy.tAnnouncement,
      object: quote(payload.announcementTitle),
      icon: "megaphone",
      source: source("announcements", ""),
      event: payload.event,
    };
  }

  if (row.type === "board_activity" && isBoardNotificationPayload(payload)) {
    const title =
      payload.event === "mentioned" ? copy.tBoardMention : payload.event === "mention_all" ? copy.tBoardMentionAll : copy.tBoardComment;
    return {
      title,
      object: withActor(payload.actorName, quote(payload.postTitle)),
      icon: payload.event === "commented" ? "comment" : "at",
      source: source("board", ""),
      event: payload.event,
    };
  }

  if (row.type === "bug_report_activity" && isBugReportNotificationPayload(payload)) {
    return {
      title: payload.event === "created" ? copy.tBugNew : copy.tBugStatus,
      object: payload.event === "created" ? withActor(payload.actorName, quote(payload.reportTitle)) : quote(payload.reportTitle),
      icon: "bug",
      source: source("bugs", ""),
      event: payload.event,
    };
  }

  if (row.type === "attendance_activity" && isAttendanceNotificationPayload(payload)) {
    const src = source("attendance", "");
    const name = payload.subjectName ?? null;
    switch (payload.event) {
      case "correction_created":
        return { title: copy.tCorrectionNew, object: name ?? copy.oShift, icon: "clock", source: src, event: payload.event };
      case "correction_approved":
        return { title: copy.tCorrectionApproved, object: copy.oMyCorrection, icon: "check", source: src, event: payload.event };
      case "correction_rejected":
        return { title: copy.tCorrectionRejected, object: copy.oMyCorrection, icon: "clock", source: src, event: payload.event };
      case "abnormal_session":
        return { title: copy.tAbnormal, object: name ?? copy.oShift, icon: "clock", source: src, event: payload.event };
      default:
        return { title: copy.tReminder, object: copy.oReminder, icon: "clock", source: src, event: payload.event };
    }
  }

  if (row.type === "id_document_expiring" && isIdDocumentExpiryNotificationPayload(payload)) {
    const expired = payload.stage === "expired";
    const admin = payload.audience === "admin";
    const values = { n: Math.max(0, payload.daysLeft), name: payload.subjectName ?? "" };
    const title = fill(
      expired ? (admin ? copy.tIdDocExpiredAdmin : copy.tIdDocExpired) : admin ? copy.tIdDocExpiringAdmin : copy.tIdDocExpiring,
      values,
    );
    return {
      title,
      object: admin ? copy.oIdDocCheck : copy.oIdDocRenew,
      icon: expired ? "flag" : "clock",
      source: copy.sIdDoc,
      event: `${payload.audience}:${payload.stage}`,
    };
  }

  // 모르는 종류 · 깨진 payload — 예전 긴 문장 그대로.
  const legacy = getNotificationDisplay(row, locale);
  return { title: legacy.title, object: legacy.body, icon: "bell", source: legacy.kindLabel, event: "legacy" };
}

/** 알림 행들 → 화면 줄(최근 순 그대로). `now` 는 테스트 · 같은 요청 안 일관성용. */
export function buildNotificationViews(
  rows: readonly NotificationRow[],
  options: { locale: Locale; actorNames?: Map<string, string>; now?: Date },
): { views: NotificationView[]; todayKey: string } {
  const copy = getDictionary(options.locale).mobile.notifications.w;
  const todayKey = dayKeyOf((options.now ?? new Date()).toISOString());
  const actorNames = options.actorNames ?? new Map<string, string>();
  const views = rows.map((row): NotificationView => {
    const brief = briefOf(row, options.locale, actorNames);
    return {
      id: row.id,
      href: row.href,
      unread: !row.read_at,
      category: categoryForType(row.type),
      icon: brief.icon,
      title: brief.title,
      object: brief.object,
      time: formatNotificationShortTime(row.created_at, todayKey, copy),
      source: brief.source,
      dayKey: dayKeyOf(row.created_at),
      groupKey: `${row.type}:${brief.event}`,
    };
  });
  return { views, todayKey };
}
