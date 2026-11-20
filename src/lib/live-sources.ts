/**
 * 화면별 실시간 구독 묶음 (2026-10-29) — `<LiveRefresh sources={…} />` 에 넘긴다.
 *
 * 필터는 Supabase realtime `postgres_changes` 형식(`칸=eq.값`). 조직 칸이 없는 테이블(`task_participants` ·
 * `task_updates`)은 나 · 그 할 일로 거른다. 어느 경우든 RLS 가 볼 수 있는 행의 신호만 보낸다.
 * 테이블은 `supabase_realtime` publication 에 있어야 한다(`202610290001_enable_ops_realtime.sql`).
 * 예외: `topic` 이 있는 줄(손님 메시지, 2026-11-16)은 private broadcast 로 받고 브라우저가 같은 필터로 거른다 — 그 표는 publication 에 없다.
 */
export type LiveSource = {
  table: string;
  filter: string;
  /** 받을 변경 종류(기본 전부). 손님 메시지는 목록에 `INSERT` 만 받아 사진 사본 갱신 같은 홍수를 거른다(2026-11-13). */
  event?: "INSERT" | "UPDATE";
  /**
   * 있으면 `postgres_changes` 가 아니라 이 **private broadcast 토픽**으로 받는다(2026-11-16, 손님 메시지).
   * DB 트리거가 id 칸만 든 신호를 보내고(`LIVE_BROADCAST_EVENT`), 브라우저가 `table` · `event` · `filter` 로 거른다
   * (`liveChangeMatches`). 구독 허가는 `realtime.messages` RLS 가 한다 — 행 전체가 소켓에 실리지 않는다.
   */
  topic?: string;
};

/** 신호 하나 — `useLiveChanges` 의 `toKeys` 가 받는다. `record` 는 `pickLiveIds` 가 남긴 id 칸뿐이다(행 내용은 들어오지 않는다). */
export type LiveChange = {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  record: Record<string, unknown>;
};

/** 신호 행에서 남길 칸 — id 와 이어 주는 칸만(본문 · 이름 · 첨부 · 출입 코드가 든 글은 버린다, 47 §5-9 · 05). */
export const LIVE_ID_COLUMNS = ["id", "conversation_id", "provider_booking_id", "organization_id"] as const;

export function pickLiveIds(row: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row || typeof row !== "object") return out;
  for (const column of LIVE_ID_COLUMNS) {
    const value = (row as Record<string, unknown>)[column];
    if (typeof value === "string") out[column] = value;
  }
  return out;
}

/** 구독 묶음 → 문자열(내용이 같으면 다시 구독하지 않게). */
export function liveSourcesKey(sources: readonly LiveSource[]): string {
  return sources.map((s) => `${s.table}|${s.filter}|${s.event ?? ""}|${s.topic ?? ""}`).join(",");
}

/**
 * 구독을 다시 맺을지 정하는 열쇠 — `postgres_changes` 줄은 필터가 서버 쪽이라 통째로, private 토픽 줄은 **토픽 이름만**.
 * 토픽 줄의 필터는 브라우저가 신호마다 거르므로(`liveChangeMatches`) 필터만 바뀌면(PC 에서 다른 대화를 고름) 채널을 떠났다
 * 다시 들어올 까닭이 없다 — 다시 들어오면 「다시 붙음 → 따라잡기」가 돌아 방금 읽은 대화를 한 번 더 읽었다(2026-11-20).
 * `parseLiveSourcesKey` 로 되읽으면 토픽 줄은 `{ table: "", filter: "", topic }` 하나씩이다.
 */
export function liveSubscriptionKey(sources: readonly LiveSource[]): string {
  const topics = [...new Set(sources.filter((s) => s.topic).map((s) => s.topic as string))].sort();
  return liveSourcesKey([...sources.filter((s) => !s.topic), ...topics.map((topic) => ({ table: "", filter: "", topic }))]);
}

export function parseLiveSourcesKey(key: string): LiveSource[] {
  if (!key) return [];
  return key.split(",").map((entry) => {
    const [table, filter, event, topic] = entry.split("|");
    const source: LiveSource = { table, filter };
    if (event === "INSERT" || event === "UPDATE") source.event = event;
    if (topic) source.topic = topic;
    return source;
  });
}

// ── private broadcast 신호 (2026-11-16) ─────────────────────────────────────────────────────────────

/** DB 트리거가 `realtime.send(…, 'change', topic, true)` 로 보내는 이벤트 이름. `202611160001_guest_messages_realtime_private.sql` 과 같아야 한다. */
export const LIVE_BROADCAST_EVENT = "change";

/** 손님 메시지 네 표의 조직 토픽 — `realtime.messages` 정책이 `'guest-messages:' || 조직 id` 로 비교한다. */
export function guestLiveTopic(organizationId: string): string {
  return `guest-messages:${organizationId}`;
}

/**
 * broadcast 신호 → `LiveChange`. 표 · 종류를 모르면 버린다(null). 칸은 `pickLiveIds` 로 한 번 더 거른다 —
 * 트리거가 이미 id 칸만 보내지만, 무엇이 오든 화면 상태에 다른 칸이 들어가지 않게.
 */
export function liveChangeFromBroadcast(payload: unknown): LiveChange | null {
  if (!payload || typeof payload !== "object") return null;
  const { table, eventType } = payload as Record<string, unknown>;
  if (typeof table !== "string" || !table) return null;
  if (eventType !== "INSERT" && eventType !== "UPDATE") return null;
  return { table, eventType, record: pickLiveIds(payload) };
}

/**
 * 신호가 이 구독 줄에 드는가 — `postgres_changes` 가 서버에서 하던 거르기를 브라우저에서 똑같이 한다:
 * 같은 표 · (있으면) 같은 종류 · `칸=eq.값` 이 맞을 것. 모르는 필터 모양이면 받지 않는다(넓게 받는 것보다 안전).
 * uuid 는 대소문자를 가리지 않는다.
 */
export function liveChangeMatches(source: LiveSource, change: LiveChange): boolean {
  if (source.table !== change.table) return false;
  if (source.event && source.event !== change.eventType) return false;
  const match = /^([a-z_]+)=eq\.(.+)$/.exec(source.filter);
  if (!match) return false;
  const value = change.record[match[1]];
  return typeof value === "string" && value.toLowerCase() === match[2].toLowerCase();
}

const byOrg = (table: string, organizationId: string): LiveSource => ({
  table,
  filter: `organization_id=eq.${organizationId}`,
});

/** 할 일 목록 · 홈 카드. 남이 나를 새 할 일에 넣으면 `tasks` INSERT 는 RLS 에 막혀(아직 참여자가 아님) 안 오고 참여자 행이 온다. */
export function taskLiveSources(organizationId: string, userId: string): LiveSource[] {
  return [
    byOrg("tasks", organizationId),
    byOrg("task_occurrence_state", organizationId),
    { table: "task_participants", filter: `user_id=eq.${userId}` },
  ];
}

/** 할 일 상세 — 목록 묶음 + 그 할 일의 업데이트(댓글 · 사진). */
export function taskDetailLiveSources(organizationId: string, userId: string, taskId: string): LiveSource[] {
  return [...taskLiveSources(organizationId, userId), { table: "task_updates", filter: `task_id=eq.${taskId}` }];
}

/** 주문 · 수리 · 분실물 요청. */
export function requestLiveSources(organizationId: string): LiveSource[] {
  return [
    byOrg("order_requests", organizationId),
    byOrg("maintenance_reports", organizationId),
    byOrg("lost_items", organizationId),
  ];
}

/** 내 알림 — 종 숫자 · 사이드 메뉴 배지. 레이아웃에서 구독한다. */
export function notificationLiveSources(userId: string): LiveSource[] {
  return [{ table: "notifications", filter: `recipient_user_id=eq.${userId}` }];
}

/**
 * 근태 대기열(확인할 출퇴근 기록 · 정정 · 교통비 · 연차) · 내 신청 상태. 출퇴근 기록은 RLS 가 직원에겐 자기 것만,
 * 근태 관리자에겐 조직 전체를 보여 준다 — 신호도 그만큼만 온다.
 */
export function attendanceQueueLiveSources(organizationId: string): LiveSource[] {
  return [
    byOrg("attendance_sessions", organizationId),
    byOrg("attendance_correction_requests", organizationId),
    byOrg("transport_reimbursement_reports", organizationId),
    byOrg("annual_leave_requests", organizationId),
  ];
}

/**
 * 근태 급여(PC) — 근무 · 정정 · 마감 스냅샷 · 수당 · 시급 · 고용 형태(2026-11-11). 마감 스냅샷 · 수당 · 시급 · 고용 형태는
 * `202611110001_attendance_hardening.sql` 에서 publication 에 넣었다. RLS 가 급여 담당에게만 행을 보여 주므로 신호도 그만큼.
 */
export function attendancePayrollLiveSources(organizationId: string): LiveSource[] {
  return [
    byOrg("attendance_sessions", organizationId),
    byOrg("attendance_correction_requests", organizationId),
    byOrg("attendance_month_snapshots", organizationId),
    byOrg("attendance_pay_allowances", organizationId),
    byOrg("hourly_rate_history", organizationId),
    byOrg("employment_type_history", organizationId),
  ];
}

/** 근태 시급(PC) — 시급 · 고용 형태 · 수당(2026-11-11). */
export function attendanceWagesLiveSources(organizationId: string): LiveSource[] {
  return [
    byOrg("hourly_rate_history", organizationId),
    byOrg("employment_type_history", organizationId),
    byOrg("attendance_pay_allowances", organizationId),
  ];
}

const byOrgTopic = (table: string, organizationId: string): LiveSource => ({
  ...byOrg(table, organizationId),
  topic: guestLiveTopic(organizationId),
});

/**
 * 손님 메시지 목록(PC 대화 탭 · 모바일 목록, 2026-11-13 — PC 는 목록 채널과 열린 대화 채널을 따로 둔다) — 대화 줄 · 새 메시지(INSERT 만) · 발송 큐.
 * 2026-11-16 부터 publication 이 아니라 조직 private 토픽(`guestLiveTopic`)으로 받는다 — 트리거가 id 칸만 보내고, 볼 권한
 * (`guest_messages.view`)이 있는 사람만 `realtime.messages` RLS 로 구독된다(`202611160001_guest_messages_realtime_private.sql`).
 */
export function guestInboxLiveSources(organizationId: string): LiveSource[] {
  return [
    byOrgTopic("guest_conversations", organizationId),
    { ...byOrgTopic("guest_messages", organizationId), event: "INSERT" },
    byOrgTopic("guest_message_outbox", organizationId),
  ];
}

/**
 * 열린 대화 한 건 — 그 대화의 메시지(새 말 · 사진 사본 · 되돌아옴) · 발송 큐 · 대화 줄 + 조직의 자동 안내 실행 줄
 * (대화가 생기기 전에 계획된 줄은 `conversation_id` 가 비어 있어 예약 번호로 맞춘다). 토픽은 조직 하나 — 그 대화 것만 브라우저가 거른다.
 */
export function guestThreadLiveSources(organizationId: string, conversationId: string): LiveSource[] {
  const topic = guestLiveTopic(organizationId);
  return [
    { table: "guest_conversations", filter: `id=eq.${conversationId}`, topic },
    { table: "guest_messages", filter: `conversation_id=eq.${conversationId}`, topic },
    { table: "guest_message_outbox", filter: `conversation_id=eq.${conversationId}`, topic },
    byOrgTopic("auto_message_runs", organizationId),
  ];
}

/** PC 자동 안내 탭 — 실행 줄(보낼 예정 · 보냄 · 막힘). */
export function autoRunLiveSources(organizationId: string): LiveSource[] {
  return [byOrgTopic("auto_message_runs", organizationId)];
}
