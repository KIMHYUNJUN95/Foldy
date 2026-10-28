import "server-only";

import {
  canAccessMobileCleaning,
  getCleaningOperatingDateKey,
  getOrgProcessedCleaningRoomLabels,
  isCleaningTaskKey,
  type CleaningSessionRow,
} from "@/lib/cleaning";
import { signalCleaningAssignChange } from "@/lib/cleaning-assign/live";
import { buildSessionRoomLabel, physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import { getActiveRoomCatalog } from "@/lib/rooms";
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
  | "undo_failed";

export type SessionOpResult<T = object> = ({ ok: true } & T) | { ok: false; error: SessionOpError };

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
): Promise<SessionOpResult<{ sessionId: string; startedAt: string }>> {
  if (!canAccessMobileCleaning(session.user.role)) return fail("not_allowed");
  if (roomLabel.length === 0 || roomLabel.length > 100 || !isCleaningTaskKey(taskKey)) return fail("invalid_selection");

  const supabase = await getSupabaseServerClient();

  // **실제 방** 기준으로 받는다(2026-10-15). 아라키초는 한 방에 Beds24 계정이 둘이라(`401` 쉬는 계정 · `401_2_2` 판매 중)
  // 쉬는 계정으로 들어온 예약의 카드가 판매 중 계정 라벨만 있는 카탈로그와 글자로 안 맞아 시작이 늘 거절됐다.
  // 라벨은 카드가 보낸 그대로 저장한다 — 화면 · 콘솔이 그 라벨로 예약 카드와 짝을 짓는다.
  const physicalRoom = physicalRoomKeyOfSessionLabel(roomLabel);
  // 카탈로그가 없으면(객실 마스터 없음 · 읽기 오류 → undefined) 예전처럼 검사를 건너뛴다 — `getActiveRoomCatalog` 가
  // 두 경우를 구분하지 않아, 막으면 객실 마스터가 없는 조직은 청소를 아예 시작하지 못한다.
  const catalog = await getActiveRoomCatalog(session.organization.id, supabase).catch(() => undefined);
  if (catalog !== undefined) {
    const labels = catalog.map((item) => buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel));
    const allowedPhysical = new Set(labels.map(physicalRoomKeyOfSessionLabel));
    // 이름표가 아직 없는 새 건물은 실제 방 키를 못 만든다 — 그때는 예전처럼 글자 그대로 맞춰 본다.
    const allowed = labels.includes(roomLabel) || (physicalRoom !== null && allowedPhysical.has(physicalRoom));
    if (!allowed) return fail("invalid_selection");
  }

  // 오늘 이미 in_progress 또는 completed 세션이 있는 방은 다시 시작하지 못하게 막는다 — 같은 실제 방의 다른 계정
  // 라벨로 시작한 것도 막는다(「401」로 시작했는데 「401_2_2」로 또 시작하지 않게).
  // 남이 시작한 방도 봐야 하므로 서비스 키로 읽는다(2026-10-26) — RLS 로는 `cleaning.read_all` 없는 직원이 본인 세션만
  // 받아 같은 방을 두 번 시작할 수 있었다. 읽기에 실패하면 막는다(확인 못 한 채 시작시키지 않는다).
  // 남는 틈: 두 사람이 같은 순간에 누르는 경쟁은 DB 유니크 인덱스(조직 · 날짜 · 실제 방)가 있어야 완전히 막힌다 — 문서 07 「남은 것」.
  const todayActive = await getOrgProcessedCleaningRoomLabels(session.organization.id).catch(() => null);
  if (todayActive === null) return fail("start_failed");
  const alreadyProcessed = todayActive.some(
    (row) =>
      row.room_label === roomLabel ||
      (physicalRoom !== null && physicalRoomKeyOfSessionLabel(row.room_label) === physicalRoom),
  );
  if (alreadyProcessed) return fail("already_processed_today");

  const insert: Database["public"]["Tables"]["cleaning_sessions"]["Insert"] = {
    cleaning_date: getCleaningOperatingDateKey(),
    organization_id: session.organization.id,
    room_label: roomLabel,
    staff_user_id: session.user.id,
    task_label: taskKey,
  };
  const { data, error } = await supabase.from("cleaning_sessions").insert(insert).select("id, started_at").single();
  if (error || !data) return fail(error?.code === "23505" ? "already_active" : "start_failed");

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
