import "server-only";

import {
  canAccessMobileCleaning,
  getCleaningOperatingDateKey,
  isCleaningTaskKey,
  type CleaningSessionRow,
} from "@/lib/cleaning";
import { signalCleaningAssignChange } from "@/lib/cleaning-assign/live";
import { roomRecordDecision, roomWriteErrorKind, sameRoomRecords, sessionRoomKeyOf } from "@/lib/cleaning-assign/room-key";
import { buildSessionRoomLabel, physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import { buildActiveRoomCatalog, fetchRoomCatalogRows } from "@/lib/rooms";
import type { AppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

/**
 * 청소 시작 · 끝내기 · 끝내기 되돌리기 — 검사와 저장만(2026-10-28 · 「오늘 내 방」 그 자리에서 시작).
 *
 * 화면 이동(redirect)은 부르는 쪽이 정한다 — 예전 청소 화면 액션(`/mobile/cleaning/actions.ts`)은 결과를 쿼리로 넘겨
 * redirect 하고, 오늘 내 방 액션(`/mobile/shift/today/actions.ts`)은 결과를 그대로 돌려줘 화면을 옮기지 않는다.
 * 같은 검사를 두 벌 두지 않으려고 여기 한 곳에 모았다. 시작 · 끝내기 · 되돌리기는 관리자 청소 현황판이
 * 새로고침 없이 바뀌도록 `cleaning_assign` 실시간 신호를 보낸다. docs/product/07-cleaning-workflow.md
 */

export type SessionOpError =
  | "not_allowed"
  | "invalid_selection"
  | "already_processed_today"
  | "already_active"
  | "start_failed"
  | "missing_session"
  | "active_not_found"
  | "complete_failed"
  | "undo_failed"
  | "close_failed"
  | "room_changed"
  | "room_held"
  | "room_resolved"
  | "not_assigned"
  | "day_changed";

export type SessionOpResult<T = object> = ({ ok: true } & T) | { ok: false; error: SessionOpError };

/**
 * 시작 기록 넣기 실패 → 화면 사유. DB 가 마지막에 막는 경우(같은 순간 두 번 누름):
 * - 방 트리거 `cleaning_room_full` — detail `resolved`(그 사이 관리자가 「처리 끝」) → 「처리 끝 방」, 그 밖 → 「이미 처리된 방」
 * - 한 사람 · 하루 · 한 방 유니크 → 「이미 처리된 방」
 * - 한 사람 진행 중 하나 유니크(`cleaning_sessions_one_active_per_org_user_idx`) → 「이미 다른 방 청소 중」
 * 그 밖 오류는 「시작 못 함」 — 모르는 오류를 「이미 처리됨」으로 감추지 않는다.
 */
function insertFailure(error: { code?: string; message?: string; details?: string | null } | null): SessionOpError {
  const kind = roomWriteErrorKind(error);
  if (kind === "resolved") return "room_resolved";
  if (kind === "taken") return "already_processed_today";
  if (kind === "active") return "already_active";
  return "start_failed";
}

/** 끝낸 뒤 「되돌리기」를 받아 주는 시간 — 토스트가 떠 있는 동안(6초)보다 넉넉히. */
const UNDO_WINDOW_MS = 2 * 60 * 1000;

function fail(error: SessionOpError): { ok: false; error: SessionOpError } {
  console.warn(`[cleaning] blocked: ${error}`);
  return { ok: false, error };
}

async function signal(organizationId: string) {
  await signalCleaningAssignChange(organizationId).catch(() => undefined);
}

export async function startSessionCore(
  session: AppSession,
  roomLabel: string,
  taskKey: string,
  /** 부른 쪽이 확인에 쓴 운영일 — 새벽 날짜가 바뀌는 순간 확인(어제)과 기록(오늘)이 갈리지 않게 그대로 쓴다. 없으면 지금 운영일. */
  cleaningDate?: string,
): Promise<SessionOpResult<{ sessionId: string; startedAt: string }>> {
  if (!canAccessMobileCleaning(session.user.role)) return fail("not_allowed");
  if (roomLabel.length === 0 || roomLabel.length > 100 || !isCleaningTaskKey(taskKey)) return fail("invalid_selection");

  const supabase = await getSupabaseServerClient();

  // **실제 방** 기준으로 받는다(2026-10-15). 아라키초는 한 방에 Beds24 계정이 둘이라(`401` 쉬는 계정 · `401_2_2` 판매 중)
  // 쉬는 계정으로 들어온 예약의 카드가 판매 중 계정 라벨만 있는 카탈로그와 글자로 안 맞아 시작이 늘 거절됐다.
  // 라벨은 카드가 보낸 그대로 저장한다 — 화면 · 콘솔이 그 라벨로 예약 카드와 짝을 짓는다.
  const physicalRoom = physicalRoomKeyOfSessionLabel(roomLabel);
  // 객실 마스터가 없는 조직(행 0개 → undefined)은 예전처럼 검사를 건너뛴다. **읽기 오류는 막는다**(2026-11-02 점검 C1) —
  // 카탈로그 없이 만든 방 키는 이름표 없는 새 건물에서 배정 키와 모양이 달라, 그 키가 기록에 그대로 남으면 같은 방을 못 묶는다.
  const catalogRows = await fetchRoomCatalogRows(session.organization.id, supabase);
  if (catalogRows.error) {
    console.error("[cleaning] room catalog read failed", { message: catalogRows.error.message });
    return fail("start_failed");
  }
  const catalog = buildActiveRoomCatalog(catalogRows.data);
  if (catalog !== undefined) {
    const labels = catalog.map((item) => buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel));
    const allowedPhysical = new Set(labels.map(physicalRoomKeyOfSessionLabel));
    // 이름표가 아직 없는 새 건물은 실제 방 키를 못 만든다 — 그때는 예전처럼 글자 그대로 맞춰 본다.
    const allowed = labels.includes(roomLabel) || (physicalRoom !== null && allowedPhysical.has(physicalRoom));
    if (!allowed) return fail("invalid_selection");
  }

  // 같은 날 같은 **실제 방** 기록을 본다(2026-11-02 점검 C1 — 2인 방은 각자 기록, `canRecordInRoom`). 막는 경우:
  //   - 그 방이 「처리 끝」(관리자) — 청소 안 함.
  //   - 내가 그 방에 이미 진행 중 · 완료 기록이 있음.
  //   - 내가 그 방에 배정되지 않았는데 이미 누가 기록이 있음 — 배정 없는 방은 예전처럼 한 사람. 배정된 사람의 자리는 남이 먼저 해도 남는다.
  // 아라키초 쉬는 계정 라벨(「401」 · 「401_2_2」)도 같은 방으로 묶는다(`room_key`, 없으면 라벨에서). 남이 시작한 방도 봐야 하므로
  // 서비스 키로 읽는다(2026-10-26). 읽기에 실패하면 막는다. 같은 순간 두 번 눌러도 DB 트리거(`cleaning_sessions_room_capacity`,
  // 방마다 잠금)와 유니크 인덱스(한 사람 · 하루 · 한 방)가 같은 규칙으로 막는다.
  // 같은 방 묶기는 저장된 `room_key`(없는 예전 기록은 라벨에서) 또는 같은 라벨 — DB 트리거와 같다.
  // 중복 확인과 기록이 같은 운영일을 본다 — 날짜가 바뀌는 순간에도 같은 방을 두 번 시작하지 않게.
  const day = cleaningDate ?? getCleaningOperatingDateKey();
  const roomKey = sessionRoomKeyOf(roomLabel, catalog);
  const service = getSupabaseServiceClient();
  const [dayResult, assigneeResult, holdResult] = await Promise.all([
    service
      .from("cleaning_sessions")
      .select("room_key, room_label, staff_user_id, status, closed_without_cleaning")
      .eq("organization_id", session.organization.id)
      .eq("cleaning_date", day)
      .in("status", ["in_progress", "completed"]),
    service
      .from("cleaning_assignments")
      .select("user_id")
      .eq("organization_id", session.organization.id)
      .eq("work_date", day)
      .eq("room_key", roomKey),
    // 관리자가 미룬 방(오늘이 미룬 기간 안)은 어느 시작 경로(오늘 내 방 · 청소 화면)에서도 시작하지 않는다(2026-11-02 리뷰).
    // 미룸 기록의 날짜(`origin_date`)는 **처음 청소해야 했던 날**이다 — 밀려 온 방을 오늘 미루면 지난 날짜로 남는다.
    // 그래서 「그날 이전에 생긴 방 · 미룬 날이 그날 뒤」로 찾는다.
    // 이름표 없는 새 건물(물리 키 없음)은 방 키를 못 만든다 — 그때는 그 기간의 미룸을 읽어 저장된 건물 · 방 이름으로 맞춘다
    // (미룬 방은 몇 개뿐이라 조직 전체를 읽어도 가볍다).
    (() => {
      const query = service
        .from("cleaning_room_holds")
        .select("room_key, property_name, room_label")
        .eq("organization_id", session.organization.id)
        .eq("kind", "defer")
        .lte("origin_date", day)
        .gt("until_date", day);
      return physicalRoom ? query.eq("room_key", physicalRoom).limit(1) : query.limit(500);
    })(),
  ]);
  if (dayResult.error || assigneeResult.error || holdResult.error) return fail("start_failed");
  const held = (holdResult.data ?? []).some(
    (row) => physicalRoom !== null || buildSessionRoomLabel(row.property_name, row.room_label) === roomLabel,
  );
  if (held) return fail("room_held");
  const decision = roomRecordDecision(
    sameRoomRecords(dayResult.data ?? [], roomLabel, roomKey),
    session.user.id,
    (assigneeResult.data ?? []).some((row) => row.user_id === session.user.id),
  );
  if (decision === "resolved") return fail("room_resolved");
  if (decision !== "ok") return fail("already_processed_today");

  const insert: Database["public"]["Tables"]["cleaning_sessions"]["Insert"] = {
    cleaning_date: day,
    organization_id: session.organization.id,
    room_key: roomKey,
    room_label: roomLabel,
    staff_user_id: session.user.id,
    task_label: taskKey,
  };
  const { data, error } = await supabase.from("cleaning_sessions").insert(insert).select("id, started_at").single();
  if (error || !data) return fail(insertFailure(error));

  await signal(session.organization.id);
  return { ok: true, sessionId: data.id, startedAt: data.started_at };
}

export async function completeSessionCore(
  session: AppSession,
  sessionId: string,
  notes: string,
): Promise<SessionOpResult<{ durationSeconds: number }>> {
  if (!canAccessMobileCleaning(session.user.role)) return fail("not_allowed");
  if (!sessionId) return fail("missing_session");

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("cleaning_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .eq("staff_user_id", session.user.id)
    .eq("status", "in_progress")
    .maybeSingle();
  const activeSession = data as CleaningSessionRow | null;
  if (error || !activeSession) return fail("active_not_found");

  const completedAt = new Date();
  const durationSeconds = Math.max(0, Math.round((completedAt.getTime() - new Date(activeSession.started_at).getTime()) / 1000));
  const { data: updated, error: updateError } = await supabase
    .from("cleaning_sessions")
    .update({ completed_at: completedAt.toISOString(), duration_seconds: durationSeconds, notes: notes || null, status: "completed" })
    .eq("id", activeSession.id)
    .eq("status", "in_progress")
    .select("id");
  if (updateError) return fail("complete_failed");
  // 0행 = 그 사이에 끝났거나 취소됨 — 「끝냈어요」라고 하지 않는다.
  if (!updated || updated.length === 0) return fail("active_not_found");

  await signal(session.organization.id);
  return { ok: true, durationSeconds };
}

/**
 * 끝내기 되돌리기 — 본인이 방금(2분 안) 끝낸 세션만 다시 「청소 중」으로. RLS 쓰기 정책은 진행 중 → 끝남 한 방향만
 * 열어 두어서 서비스 키로 쓴다(앱에서 본인 · 조직 · 상태 · 시간을 먼저 확인). 그 사이 다른 방을 시작했으면
 * 「한 사람 진행 중 하나」 유니크 인덱스가 막는다 → `undo_failed`.
 */
export async function reopenSessionCore(
  session: AppSession,
  sessionId: string,
): Promise<SessionOpResult> {
  if (!canAccessMobileCleaning(session.user.role)) return fail("not_allowed");
  if (!sessionId) return fail("missing_session");
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("cleaning_sessions")
    .select("id, status, staff_user_id, completed_at, cleaning_date")
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();
  if (error || !data || data.staff_user_id !== session.user.id || data.status !== "completed" || !data.completed_at) return fail("undo_failed");
  if (data.cleaning_date !== getCleaningOperatingDateKey() || Date.now() - new Date(data.completed_at).getTime() > UNDO_WINDOW_MS) {
    return fail("undo_failed");
  }
  const { data: reopened, error: updateError } = await service
    .from("cleaning_sessions")
    .update({ completed_at: null, duration_seconds: null, notes: null, status: "in_progress" })
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .eq("staff_user_id", session.user.id)
    .eq("status", "completed")
    .select("id");
  if (updateError || !reopened || reopened.length === 0) return fail("undo_failed");

  await signal(session.organization.id);
  return { ok: true };
}

/**
 * 지난 날 끝내지 못한 내 청소 닫기(2026-11-02 점검 수정 — 오늘 내 방).
 *
 * 한 사람당 진행 중 기록은 하나라(`cleaning_sessions_one_active_per_org_user_idx`, 날짜 조건 없음) 어제 시작하고 끝내지 않은
 * 기록이 남으면 오늘 방을 하나도 시작할 수 없다. 오늘 내 방은 오늘 기록만 읽어서 그 기록이 보이지도 않았다.
 * 「지금 끝내기」로 닫으면 소요 시간이 하루를 넘겨 기록 · 통계가 틀어지므로, 알바가 두 가지 중 고른다(2026-11-02 사용자 결정):
 * - 「청소했어요」(`cleaned`) → 완료 · 소요 0초 · 끝 시각 = 시작 시각(「끝낸 시각 모름」). 관리자가 강제 완료로 시각을 채운다.
 * - 「못 했어요」 → 취소 · 소요 0초. 방은 다음 날 「밀려 온 방」으로 다시 뜬다.
 * 오늘 기록은 여기서 닫지 않는다(오늘 것은 화면의 끝내기를 쓴다).
 */
export async function closeStaleSessionCore(session: AppSession, sessionId: string, cleaned: boolean): Promise<SessionOpResult> {
  if (!canAccessMobileCleaning(session.user.role)) return fail("not_allowed");
  if (!sessionId) return fail("missing_session");
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("cleaning_sessions")
    .select("id, cleaning_date, started_at")
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .eq("staff_user_id", session.user.id)
    .eq("status", "in_progress")
    .maybeSingle();
  // 읽기 오류는 「이미 닫힘」이 아니다 — 화면이 카드를 숨기지 않고 다시 시도하게 close_failed 로 돌려준다.
  if (error) return fail("close_failed");
  if (!data) return fail("active_not_found");
  if (data.cleaning_date >= getCleaningOperatingDateKey()) return fail("close_failed");

  // 알바가 고른다(2026-11-02 사용자 결정): 「청소했어요」 → 완료, 「못 했어요」 → 취소.
  // - 완료: 그날 끝낸 방이라 다음 날 「밀려 온 방」으로 다시 뜨지 않는다. 끝낸 시각은 모르니 시작 시각 · 소요 0
  //   이 「끝 = 시작 · 0초」 조합이 「끝낸 시각 모름」 표시다(`isUnmeasuredSession`) — 기록 · 사람별 달력은 끝 시각을 비우고,
  //   관리자 강제 완료가 이 기록만 덮어써 시각을 채운다.
  // - 취소: 소요 시간은 **0** — 며칠에 걸친 「지금 − 시작」을 넣으면 더하는 집계가 부풀려진다. 방은 다음 날 다시 뜬다.
  // DB check 제약: 완료 · 취소 모두 completed_at · duration_seconds 가 있어야 한다.
  const { data: closed, error: updateError } = await supabase
    .from("cleaning_sessions")
    .update(
      cleaned
        ? { completed_at: data.started_at, duration_seconds: 0, status: "completed" }
        : { completed_at: new Date().toISOString(), duration_seconds: 0, status: "cancelled" },
    )
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .eq("staff_user_id", session.user.id)
    .eq("status", "in_progress")
    .select("id");
  if (updateError) return fail("close_failed");
  if (!closed || closed.length === 0) return fail("active_not_found");

  await signal(session.organization.id);
  return { ok: true };
}
