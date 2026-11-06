import { z } from "zod";

// 직원 통화 상태 판정(DB 없음 — 테스트로 덮는다). 46 §3. 쓰기는 staff-call-store.ts 가 조건부 update 로 한다.

export const RING_MS = 45_000;
export const CALL_MAX_MS = 30 * 60_000;

export type StaffCallStatus = "ringing" | "accepted" | "ended" | "no_answer" | "canceled" | "failed";
export type StaffCallEndedBy = "guest" | "staff" | "timeout" | "system";

export type StaffCallTransition =
  | { from: "ringing"; to: "no_answer" | "canceled"; endedBy: StaffCallEndedBy }
  | { from: "accepted"; to: "ended"; endedBy: StaffCallEndedBy };

export type StaffCallTiming = { status: string; ring_deadline_at: string; accepted_at: string | null };

/** 시간이 지나 닫아야 하면 그 전이. 받기는 `ring_deadline_at > now` 일 때만이므로 기한이 된 순간부터 no_answer 다. */
export function staleTransition(row: StaffCallTiming, now: Date): StaffCallTransition | null {
  if (row.status === "ringing" && Date.parse(row.ring_deadline_at) <= now.getTime()) {
    return { from: "ringing", to: "no_answer", endedBy: "timeout" };
  }
  if (row.status === "accepted" && row.accepted_at && Date.parse(row.accepted_at) + CALL_MAX_MS <= now.getTime()) {
    return { from: "accepted", to: "ended", endedBy: "timeout" };
  }
  return null;
}

/** 손님이 취소 · 끊기를 눌렀을 때. 두 경로 모두 같다 — 받기와 겹쳐도 직원만 빈 방에 남지 않는다. 끝난 통화는 그대로. */
export function guestHangUpTransition(status: string): StaffCallTransition | null {
  if (status === "ringing") return { from: "ringing", to: "canceled", endedBy: "guest" };
  if (status === "accepted") return { from: "accepted", to: "ended", endedBy: "guest" };
  return null;
}

export const NO_RECIPIENT_TRANSITION: StaffCallTransition = { from: "ringing", to: "no_answer", endedBy: "system" };
export const SYSTEM_END_TRANSITION: StaffCallTransition = { from: "accepted", to: "ended", endedBy: "system" };

/** 새 호출이 왔을 때 이 기기의 옛 통화. 아직 울리는 호출은 그대로 다시 쓰고, 통화 중으로 남은 행(앱이 죽은 경우)은 닫는다. */
export function supersedeTransition(status: string): StaffCallTransition | null {
  return status === "accepted" ? SYSTEM_END_TRANSITION : null;
}

export function ringDeadlineFrom(now: Date): string {
  return new Date(now.getTime() + RING_MS).toISOString();
}

export function roomNameFor(callId: string): string {
  return `call-${callId}`;
}

export const callRequestSchema = z.object({
  step: z.enum(["welcome", "find", "passport", "face", "address", "done", "other"]),
  language: z.enum(["ja", "en", "zh-Hans", "ko"]),
});

const uuidSchema = z.uuid();

export function isCallId(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

/** 기존 태블릿 라우트가 두 이름(`session_id` · `sessionId`)을 함께 쓴다. 모양이 틀리면 없는 것으로 본다 — 호출을 막지 않는다. */
export function sessionIdOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { session_id: snake, sessionId: camel } = body as Record<string, unknown>;
  const parsed = uuidSchema.safeParse(snake ?? camel);
  return parsed.success ? parsed.data : null;
}
