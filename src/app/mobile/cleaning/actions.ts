"use server";

import { redirect } from "next/navigation";
import { getTodayWorkState } from "@/lib/attendance-sessions";
import { canAccessMobileCleaning, getCleaningOperatingDateKey } from "@/lib/cleaning";
import { getCleaningTargets } from "@/lib/cleaning-targets";
import { closeStaleSessionCore, completeSessionCore, startSessionCore } from "@/lib/cleaning-session-ops";
import { signalCleaningAssignChange } from "@/lib/cleaning-assign/live";
import { cleaningListStart, sessionCloseFields } from "@/lib/cleaning-assign/room-rules";
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
  // 오늘 출근 기록이 없으면 시작 안내에 「출근하기」를 붙인다(2026-10-29) — 시작은 막지 않는다.
  const organizationId = session.organization?.id;
  const roomLabel = cleanText(formData.get("roomLabel"));
  let taskKey = cleanText(formData.get("taskKey"));
  // 청소 목록의 방(`source=list`) — 화면이 낡았어도 서버가 지금 목록을 다시 본다: 예약이 취소돼 빠졌으면 막고, 종류도 서버가 정한다.
  // 수기 경로(「기타 청소」)는 목록 밖 방이 정상이고 고른 종류를 그대로 쓴다(문서 45 C13). 목록을 못 읽으면 막는다.
  if (cleanText(formData.get("source")) === "list" && organizationId) {
    const targets = await getCleaningTargets(organizationId, getCleaningOperatingDateKey()).catch((error: unknown) => {
      console.error("[cleaning] targets read failed", error);
      return null;
    });
    if (!targets) redirectWithError("start_failed");
    const fromList = cleaningListStart(targets, roomLabel);
    if (!fromList) redirectWithError("room_changed");
    taskKey = fromList.taskKey;
  }
  const [result, workState] = await Promise.all([
    startSessionCore(session, roomLabel, taskKey),
    organizationId ? getTodayWorkState(organizationId, session.user.id) : Promise.resolve("working" as const),
  ]);
  if (!result.ok) {
    redirectWithError(result.error);
  }

  redirect(`${cleaningPath}?started=1${workState === "none" ? "&noClockIn=1" : ""}&n=${noticeNonce()}`);
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
    .select("id, status, staff_user_id, started_at, cleaning_date")
    .eq("id", sessionId)
    .eq("organization_id", session.organization.id)
    .maybeSingle();

  const sessionRow = rawData as { id: string; status: string; staff_user_id: string; started_at: string; cleaning_date: string } | null;

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

  // 값은 `sessionCloseFields` 하나 — 지난 날 기록은 소요 0초(문서 45 C12). DB check 제약상 취소도 끝 시각 · 소요가 있어야 한다.
  const fields = sessionCloseFields({
    cleaned: false,
    cleaningDate: sessionRow.cleaning_date,
    now: new Date(),
    startedAt: sessionRow.started_at,
    today: getCleaningOperatingDateKey(),
  });

  // RLS 쓰기 정책은 `staff_user_id = auth.uid()` 라 남의 세션은 0행으로 조용히 막힌다. 그래서 개발자가
  // 남의 세션을 취소할 때만 서비스 키로 쓴다 — 관리자 강제완료(202607150001)와 같은 방식: 위에서 앱 권한을
  // 확인했고, 조직 · 상태 조건을 함께 건다.
  const writer = cancellingOthers ? getSupabaseServiceClient() : supabase;
  const { data: cancelledRows, error: updateError } = await writer
    .from("cleaning_sessions")
    .update(fields)
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

/**
 * 지난 날 끝내지 못한 내 청소 닫기 — 「청소했어요 / 못 했어요」, 소요 0초(문서 45 C12). 오늘 내 방과 같은 `closeStaleSessionCore`.
 */
export async function closeStaleCleaningSession(formData: FormData) {
  const session = await getCurrentAppSession();

  if (!session) {
    redirect("/auth/login?next=/mobile/cleaning");
  }

  if (!canAccessMobileCleaning(session.user.role)) {
    redirectWithError("not_allowed");
  }

  const cleaned = cleanText(formData.get("cleaned")) === "1";
  const result = await closeStaleSessionCore(session, cleanText(formData.get("sessionId")), cleaned);
  if (!result.ok) {
    redirectWithError(result.error);
  }

  redirect(`${cleaningPath}?${cleaned ? "completed" : "cancelled"}=1&n=${noticeNonce()}`);
}
