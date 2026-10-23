"use server";

import { redirect } from "next/navigation";
import {
  canAccessMobileCleaning,
  getCleaningOperatingDateKey,
  isCleaningTaskKey,
  type CleaningSessionRow,
} from "@/lib/cleaning";
import { buildSessionRoomLabel, physicalRoomKeyOfSessionLabel } from "@/lib/room-label-normalization";
import { getActiveRoomCatalog } from "@/lib/rooms";
import { getCurrentAppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPlatformDeveloper } from "@/config/roles";
import type { Database } from "@/types/database";

const cleaningPath = "/mobile/cleaning";

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

/**
 * 결과 안내마다 새 값 — 같은 거절이 연달아 와도 화면이 안내를 다시 보이는 곳으로 끌어오게(`CleaningNotice`, 2026-10-15).
 */
function noticeNonce() {
  return Date.now().toString(36);
}

/**
 * 실패 사유를 쿼리로 넘겨 화면에 띄운다.
 *
 * 사유를 서버 로그에도 남긴다 — 이 액션들은 실패해도 throw 하지 않고 redirect 하므로 Vercel
 * 런타임 **에러** 로그에 아무것도 안 남는다. 2026-08-04 에 "셋팅 시작이 안 된다"를 추적할 때,
 * 서버 에러 0건 + DB 행 0건 + 303 리다이렉트만 보이는 상태라 어느 분기인지 특정할 수 없었다.
 */
function redirectWithError(error: string): never {
  console.warn(`[cleaning] blocked: ${error}`);
  redirect(`${cleaningPath}?error=${encodeURIComponent(error)}&n=${noticeNonce()}`);
}

export async function startCleaningSession(formData: FormData) {
  const session = await getCurrentAppSession();

  if (!session) {
    redirect("/auth/login?next=/mobile/cleaning");
  }

  if (!canAccessMobileCleaning(session.user.role)) {
    redirectWithError("not_allowed");
  }

  const roomLabel = cleanText(formData.get("roomLabel"));
  const taskKey = cleanText(formData.get("taskKey"));

  if (roomLabel.length === 0 || roomLabel.length > 100 || !isCleaningTaskKey(taskKey)) {
    redirectWithError("invalid_selection");
  }

  const supabase = await getSupabaseServerClient();

  // **실제 방** 기준으로 받는다(2026-10-15). 아라키초는 한 방에 Beds24 계정이 둘이라(`401` 쉬는 계정 · `401_2_2` 판매 중)
  // 쉬는 계정으로 들어온 예약의 카드가 판매 중 계정 라벨만 있는 카탈로그와 글자로 안 맞아 시작이 늘 거절됐다.
  // 라벨은 카드가 보낸 그대로 저장한다 — 화면 · 콘솔이 그 라벨로 예약 카드와 짝을 짓는다.
  const physicalRoom = physicalRoomKeyOfSessionLabel(roomLabel);
  const catalog = await getActiveRoomCatalog(session.organization.id, supabase).catch(() => undefined);
  if (catalog !== undefined) {
    const labels = catalog.map((item) => buildSessionRoomLabel(item.propertyName, item.canonicalRoomLabel));
    const allowedPhysical = new Set(labels.map(physicalRoomKeyOfSessionLabel));
    // 이름표가 아직 없는 새 건물은 실제 방 키를 못 만든다 — 그때는 예전처럼 글자 그대로 맞춰 본다.
    const allowed = labels.includes(roomLabel) || (physicalRoom !== null && allowedPhysical.has(physicalRoom));
    if (!allowed) {
      redirectWithError("invalid_selection");
    }
  }

  // Block re-starting a room that already has an in_progress or completed session today — 같은 실제 방의 다른 계정
  // 라벨로 시작한 것도 막는다(「401」로 시작했는데 「401_2_2」로 또 시작하지 않게).
  const { data: todayActive } = await supabase
    .from("cleaning_sessions")
    .select("room_label")
    .eq("organization_id", session.organization.id)
    .eq("cleaning_date", getCleaningOperatingDateKey())
    .in("status", ["in_progress", "completed"]);

  const alreadyProcessed = (todayActive ?? []).some(
    (row) =>
      row.room_label === roomLabel ||
      (physicalRoom !== null && physicalRoomKeyOfSessionLabel(row.room_label) === physicalRoom),
  );
  if (alreadyProcessed) {
    redirectWithError("already_processed_today");
  }

  const insert: Database["public"]["Tables"]["cleaning_sessions"]["Insert"] = {
    cleaning_date: getCleaningOperatingDateKey(),
    organization_id: session.organization.id,
    room_label: roomLabel,
    staff_user_id: session.user.id,
    task_label: taskKey,
  };

  const { error } = await supabase
    .from("cleaning_sessions")
    .insert(insert);

  if (error) {
    redirectWithError(error.code === "23505" ? "already_active" : "start_failed");
  }

  redirect(`${cleaningPath}?started=1&n=${noticeNonce()}`);
}

export async function cancelCleaningSession(formData: FormData) {
  const session = await getCurrentAppSession();

  if (!session) {
    redirect("/auth/login?next=/mobile/cleaning");
  }

  if (!canAccessMobileCleaning(session.user.role)) {
    redirectWithError("not_allowed");
  }

  const sessionId = cleanText(formData.get("sessionId"));

  if (!sessionId) {
    redirectWithError("missing_session");
  }

  const supabase = await getSupabaseServerClient();
  const { data: rawData, error } = await supabase
    .from("cleaning_sessions")
    .select("id, status, staff_user_id, started_at")
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();

  const sessionRow = rawData as { id: string; status: string; staff_user_id: string; started_at: string } | null;

  if (error || !sessionRow) {
    redirectWithError("active_not_found");
  }

  if (sessionRow.status === "cancelled") {
    redirectWithError("already_cancelled");
  }

  if (sessionRow.status === "completed") {
    redirectWithError("already_completed");
  }

  // 남의 진행 중 청소는 플랫폼 개발자만 취소한다(2026-10-23 「개발자는 전부 가능」).
  const cancellingOthers = sessionRow.staff_user_id !== session.user.id;
  if (cancellingOthers && !isPlatformDeveloper(session.user.role)) {
    redirectWithError("not_allowed");
  }

  // DB check constraint requires completed_at + duration_seconds to be non-null
  // for both 'completed' and 'cancelled' statuses.
  const cancelledAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((cancelledAt.getTime() - new Date(sessionRow.started_at).getTime()) / 1000),
  );

  // RLS 쓰기 정책은 `staff_user_id = auth.uid()` 라 남의 세션은 0행으로 조용히 막힌다. 그래서 개발자가
  // 남의 세션을 취소할 때만 서비스 키로 쓴다 — 관리자 강제완료(202607150001)와 같은 방식: 위에서 앱 권한을
  // 확인했고, 조직 · 상태 조건을 함께 건다.
  const writer = cancellingOthers ? getSupabaseServiceClient() : supabase;
  const { error: updateError } = await writer
    .from("cleaning_sessions")
    .update({
      completed_at: cancelledAt.toISOString(),
      duration_seconds: durationSeconds,
      status: "cancelled",
    })
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .eq("status", "in_progress");

  if (updateError) {
    redirectWithError("cancel_failed");
  }

  redirect(`${cleaningPath}?cancelled=1&n=${noticeNonce()}`);
}

export async function completeCleaningSession(formData: FormData) {
  const session = await getCurrentAppSession();

  if (!session) {
    redirect("/auth/login?next=/mobile/cleaning");
  }

  if (!canAccessMobileCleaning(session.user.role)) {
    redirectWithError("not_allowed");
  }

  const sessionId = cleanText(formData.get("sessionId"));
  const notes = cleanText(formData.get("notes"));

  if (!sessionId) {
    redirectWithError("missing_session");
  }

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

  if (error || !activeSession) {
    redirectWithError("active_not_found");
  }

  const completedAt = new Date();
  const startedAt = new Date(activeSession.started_at);
  const durationSeconds = Math.max(
    0,
    Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
  );
  const update: Database["public"]["Tables"]["cleaning_sessions"]["Update"] = {
    completed_at: completedAt.toISOString(),
    duration_seconds: durationSeconds,
    notes: notes || null,
    status: "completed",
  };

  const { error: updateError } = await supabase
    .from("cleaning_sessions")
    .update(update)
    .eq("id", activeSession.id)
    .eq("status", "in_progress");

  if (updateError) {
    redirectWithError("complete_failed");
  }

  redirect(`${cleaningPath}?completed=1&n=${noticeNonce()}`);
}
