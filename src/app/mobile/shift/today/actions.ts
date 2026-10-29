"use server";

import { revalidatePath } from "next/cache";
import { getTodayWorkState } from "@/lib/attendance-sessions";
import { completeSessionCore, reopenSessionCore, startSessionCore, type SessionOpResult } from "@/lib/cleaning-session-ops";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

/**
 * 오늘 내 방 — 그 자리에서 청소 시작 · 끝내기 · 끝내기 되돌리기(2026-10-28, 시안 2riUcpk…).
 * 예전엔 「501 청소 시작」이 청소 화면으로 넘어가 방을 다시 골라야 했다. 이제 결과를 돌려주고 화면은 그대로 둔다.
 * 검사 · 저장은 청소 화면과 같은 `cleaning-session-ops`. docs/product/37-cleaning-shift-assignment.md 「4-3」
 */

const PATHS = ["/mobile/shift/today", "/mobile/cleaning", "/admin/cleaning"];

function refresh() {
  for (const path of PATHS) revalidatePath(path);
}

async function worker() {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session) || !session.capabilities.includes("cleaning.work")) return null;
  return session;
}

export async function startMyRoom(
  input: { roomLabel: string },
): Promise<SessionOpResult<{ sessionId: string; startedAt: string; noClockIn: boolean }>> {
  const session = await worker();
  if (!session) return { ok: false, error: "not_allowed" };
  // 오늘 출근 기록이 없으면 「출근 기록이 아직 없어요 · 출근하기」를 띄운다(2026-10-29 사용자 결정) — 시작은 막지 않는다.
  const [result, workState] = await Promise.all([
    startSessionCore(session, typeof input.roomLabel === "string" ? input.roomLabel.trim() : "", "checkout"),
    getTodayWorkState(session.organization.id, session.user.id),
  ]);
  if (!result.ok) return result;
  refresh();
  return { ...result, noClockIn: workState === "none" };
}

export async function finishMyRoom(input: { sessionId: string }): Promise<SessionOpResult<{ durationSeconds: number }>> {
  const session = await worker();
  if (!session) return { ok: false, error: "not_allowed" };
  const result = await completeSessionCore(session, typeof input.sessionId === "string" ? input.sessionId : "", "");
  if (result.ok) refresh();
  return result;
}

export async function undoFinishMyRoom(input: { sessionId: string }): Promise<SessionOpResult> {
  const session = await worker();
  if (!session) return { ok: false, error: "not_allowed" };
  const result = await reopenSessionCore(session, typeof input.sessionId === "string" ? input.sessionId : "");
  if (result.ok) refresh();
  return result;
}
