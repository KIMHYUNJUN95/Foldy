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
 * 작업 알림을 각 수신자에게 팬아웃한다(작업자 본인은 제외). `dedupeBase` 는
 * 이벤트마다 고유해야 서로 다른 이벤트가 합쳐지지 않는다(예: 업데이트 id 포함);
 * 수신자 id 는 자동으로 덧붙는다.
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
 * 프로젝트 알림(현재는 `project_shared` 뿐)을 초대된 각 멤버에게 팬아웃하며,
 * 작업자 본인은 제외한다. `dedupeBase` 는 이벤트마다 고유해야 하며 수신자 id 가 덧붙는다.
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
 * 직원 건의 알림을 각 수신자에게 팬아웃한다. 작업자 본인은 제외하고 중복을 제거한다.
 * 대상은 이미 호출자가 유효한 참여자(작성자 / 수신자 / 참조자)로 한정해 둬야 한다
 * — 이 함수는 가시 범위를 절대 넓히지 않는다. `dedupeBase` 는 이벤트마다 고유해야 한다(예:
 * 댓글 id 나 새 상태 포함). 수신자 id 는 자동으로 덧붙는다.
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
 * 게시판 댓글에서 발생한 @멘션을 팬아웃한다. 호출자는 `recipientUserIds` 의 모든 id
 * 가 같은 조직의 활성 멤버이며(작성자 본인이 아님) 이미 검증했어야 한다 — 이 헬퍼는
 * 가시 범위를 절대 넓히지 않는다. `mentionAll` 이 true 이면 각 수신자에게 `mention_all` 알림 하나만
 * 개별 `mentioned` 알림 대신 보내, 같은 댓글이
 * 한 사용자에게 알림 두 개를 일으키지 않는다. `commentId` 로 중복 제거 키를 댓글마다 고유하게 만든다.
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
 * 게시판 글 작성자에게 새 댓글을 알린다(수신자 한 명). 댓글 작성자가 글 작성자 본인이면
 * 아무것도 하지 않는다. `dedupeBase` 는 댓글마다 고유해야 하며(댓글 id 포함) 각 댓글이 알림을 보낸다.
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
 * 권한 있는 근태 관리자 경고(정정 생성 / 이상 세션)를 전달된
 * 수신자(owner + attendance_payroll_admin id — 해석은 호출자가 한다. 이 함수는 가시 범위를 절대 넓히지
 * 않는다)에게 팬아웃하고 작업자 본인은 제외한다. `dedupeBase` 는 이벤트마다 고유해야 하며 수신자 id 가 덧붙는다.
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
 * 근무자용 18:30 미종료 세션 알림. 도쿄 날짜당 사용자 1회로 중복을 제거하므로
 * 예약 작업이 스팸을 보낼 수 없다. 대화형 안내가 있는 근태 홈으로 딥링크한다.
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
 * 중요 공지 게시 알림을 대상 활성 조직 멤버에게 팬아웃하며, 작업자 본인은 제외하고
 * 멤버십 읽기 시점에 역할 타기팅을 적용한다. 중복 제거는 공지 + 수신자 단위이므로
 * 같은 공지를 다시 게시해도 중복 알림이 쌓이지 않는다.
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
 * 조직의 모든 검토자(owner/office_admin)에게 `bug_report_activity:created` 알림을
 * 팬아웃한다(작업자 본인은 제외). 검토자 멤버십은 여기서 service 클라이언트로 해석하므로
 * 호출자가 넘길 필요가 없다. 역할 필터가 서버에서 강제되어 가시 범위를 넓히지 않는다.
 * 중복 제거는 신고 + 수신자 단위이므로 같은 id 를 다시 제출해도 아무 일도 일어나지 않는다.
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
 * 검토자가 신고 상태를 바꾸면 원래 신고자에게 알린다. 다음 경우 자기 알림은 억제:
 * 검토자가 신고자 본인일 때(드문 경계 사례지만 처리함). 중복 제거 키에 새 상태를 넣어 각
 * 전환마다 새 알림이 나간다(submitted → reviewing → fixed → closed).
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

  // 이미 신고를 검증한 호출자는 organizationId 를 생략할 수 있다. 알림 행의 organization_id 를
  // 올바르게 유지하도록 조회한다(필수 컬럼).
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

// 이미 주문된 요청의 배송일이 수정되면 요청자에게 알린다. 기존
// `order_processed` 알림 타입을 재사용하되(enum 마이그레이션 없음) `kind: "delivery_updated"` 를 표시해
// 화면이 "배송일 변경" 메시지를 그리게 한다. dedupeKey 에 새 배송 값을 넣어
// 변경마다 새 알림이 나간다.
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
