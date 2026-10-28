"use server";

import { redirect } from "next/navigation";
import { canAccessMobileCleaning } from "@/lib/cleaning";
import { completeSessionCore, startSessionCore } from "@/lib/cleaning-session-ops";
import { signalCleaningAssignChange } from "@/lib/cleaning-assign/live";
import { getCurrentAppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPlatformDeveloper } from "@/config/roles";

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

  // 검사 · 저장은 오늘 내 방과 같은 곳(`startSessionCore`) — 여기선 결과를 쿼리로 넘겨 청소 화면으로 돌아간다.
  const result = await startSessionCore(session, cleanText(formData.get("roomLabel")), cleanText(formData.get("taskKey")));
  if (!result.ok) {
    redirectWithError(result.error);
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

  // DB check 제약은 'completed' 와 'cancelled' 상태 모두
  // completed_at + duration_seconds 가 null 이 아닐 것을 요구한다.
  const cancelledAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((cancelledAt.getTime() - new Date(sessionRow.started_at).getTime()) / 1000),
  );

  // RLS 쓰기 정책은 `staff_user_id = auth.uid()` 라 남의 세션은 0행으로 조용히 막힌다. 그래서 개발자가
  // 남의 세션을 취소할 때만 서비스 키로 쓴다 — 관리자 강제완료(202607150001)와 같은 방식: 위에서 앱 권한을
  // 확인했고, 조직 · 상태 조건을 함께 건다.
  const writer = cancellingOthers ? getSupabaseServiceClient() : supabase;
  const { data: cancelledRows, error: updateError } = await writer
    .from("cleaning_sessions")
    .update({
      completed_at: cancelledAt.toISOString(),
      duration_seconds: durationSeconds,
      status: "cancelled",
    })
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .eq("status", "in_progress")
    .select("id");

  if (updateError) {
    redirectWithError("cancel_failed");
  }

  // 0행 = 그 사이에 완료 · 취소됐거나 RLS 가 조용히 막은 것 — 「취소했습니다」라고 하지 않는다(2026-10-26).
  if (!cancelledRows || cancelledRows.length === 0) {
    redirectWithError("active_not_found");
  }

  // 관리자 청소 현황판이 새로고침 없이 「청소 중」을 지우게.
  await signalCleaningAssignChange(session.organization.id).catch(() => undefined);
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

  const result = await completeSessionCore(session, cleanText(formData.get("sessionId")), cleanText(formData.get("notes")));
  if (!result.ok) {
    redirectWithError(result.error);
  }

  redirect(`${cleaningPath}?completed=1&n=${noticeNonce()}`);
}
