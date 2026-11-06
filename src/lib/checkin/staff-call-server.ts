import "server-only";

import { AccessToken, RoomServiceClient, TrackSource, type VideoGrant } from "livekit-server-sdk";

import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

import { checkinDb, throwOnCheckinError, type CheckinGate } from "./server";
import { STAFF_CALL_NOTIFICATION_HREF, STAFF_CALL_TOKEN_SECONDS, isCallOverdue, isRingOverdue, isStaffCallRoomName } from "./staff-call";

// 직원 통화 서버 공용 — LiveKit 토큰 · 방 삭제 · 시간 초과 닫기 · 기록. 권한은 부르는 액션이 본다. docs/product/46 §3 · §5.

/**
 * 직원 통화 전용 문. `checkin.call` 은 관리자 웹 권한이 없는 야간 직원도 받게 만든 키라 `checkinGate`(`admin_web.access` 요구)를 쓰지 않는다(§4).
 * 세션은 토큰(JWT)만 검증해 정지된 계정도 토큰이 살아 있는 동안 통과한다 — 그래서 `getUser()` 로 정지를 보는 온보딩 상태를 같이 본다.
 * 멤버십이 비활성이면 세션 자체가 없다. 쓰는 곳은 이 파일의 호출자(`actions/checkin/calls.ts`)뿐이고, 다른 체크인 액션은 `checkinGate` 그대로다.
 */
export async function checkinCallGate(capability: "checkin.call" | "checkin.view"): Promise<CheckinGate> {
  const [state, session] = await Promise.all([getOnboardingState(), getCurrentAppSession()]);
  if (state.status !== "ready" || !session || !hasOrganizationContext(session)) return { ok: false, errorKey: "forbidden" };
  if (!session.capabilities.includes(capability)) return { ok: false, errorKey: "forbidden" };
  return {
    ok: true,
    organizationId: session.organization.id,
    userId: session.user.id,
    capabilities: session.capabilities,
  };
}

export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };

export function readLiveKitConfig(): LiveKitConfig | null {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

// 직원 얼굴이 손님에게 가지 않게 하는 곳이다 — 화면이 아니라 이 grant 가 막는다(§1). camera · screen_share 를 넣지 말 것.
function staffVideoGrant(room: string): VideoGrant {
  return {
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishData: false,
    canPublishSources: [TrackSource.MICROPHONE],
  };
}

export async function mintStaffToken(config: LiveKitConfig, input: { room: string; userId: string }): Promise<string> {
  if (!isStaffCallRoomName(input.room)) throw new Error("staff-call: bad room name");
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `staff-${input.userId}`,
    ttl: STAFF_CALL_TOKEN_SECONDS,
  });
  token.addGrant(staffVideoGrant(input.room));
  return token.toJwt();
}

/** 방 삭제 — 실패해도 통화 기록은 이미 끝났으니 무시한다(§2). */
export async function deleteStaffCallRoom(room: unknown): Promise<void> {
  const config = readLiveKitConfig();
  if (!config || !isStaffCallRoomName(room)) return;
  try {
    await new RoomServiceClient(config.url, config.apiKey, config.apiSecret).deleteRoom(room);
  } catch (error) {
    console.error("[checkin] staff-call room delete:", error instanceof Error ? error.name : "unknown");
  }
}

/** 기록에는 통화 id 와 건물만(§8). 끝난 변경을 되돌리지 않으므로 실패해도 던지지 않는다. 시간 초과는 사람이 한 일이 아니라 기기로만 남는다. */
export async function writeStaffCallAudit(entry: {
  organizationId: string;
  userId: string | null;
  deviceId: string;
  action: "staff_call_accepted" | "staff_call_ended" | "staff_call_no_answer";
  callId: string;
  propertyKey: string;
}): Promise<void> {
  try {
    const { error } = await checkinDb()
      .from("audit_log")
      .insert({
        organization_id: entry.organizationId,
        actor_user_id: entry.userId,
        device_id: entry.deviceId,
        action: entry.action,
        meta: { call_id: entry.callId, property_key: entry.propertyKey },
      });
    throwOnCheckinError(error, "audit_log");
  } catch (error) {
    console.error(`[checkin] audit ${entry.action}:`, error instanceof Error ? error.message : "unknown");
  }
}

export const STAFF_CALL_COLUMNS =
  "id, organization_id, property_key, device_id, stay_id, room_name, status, step, language, ring_deadline_at, created_at, accepted_at, accepted_by, ended_at, ended_by";

export type StaffCallRow = {
  id: string;
  organization_id: string;
  property_key: string;
  device_id: string;
  stay_id: string | null;
  room_name: string;
  status: string;
  step: string;
  language: string;
  ring_deadline_at: string;
  created_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  ended_at: string | null;
  ended_by: string | null;
};

async function notifyMissedCall(row: StaffCallRow): Promise<void> {
  try {
    const { error } = await checkinDb().rpc("notify_staff", {
      p_organization_id: row.organization_id,
      p_capability: "checkin.call",
      p_type: "checkin_call_missed",
      p_dedupe_key: `checkin_call_missed:${row.id}`,
      p_href: STAFF_CALL_NOTIFICATION_HREF,
      p_payload: { callId: row.id, propertyKey: row.property_key },
    });
    if (error) throw new Error(error.code ?? "unknown");
  } catch (error) {
    console.error("[checkin] staff-call missed notify:", error instanceof Error ? error.message : "unknown");
  }
}

/**
 * 시간이 지난 호출 · 통화를 닫고 지금 상태를 돌려준다(§3 — 스케줄러 없이 읽거나 쓸 때 판정).
 * 조건부 update 라 태블릿 서버와 겹쳐도 한쪽만 바꾸고, 놓친 알림도 바꾼 쪽만 넣는다.
 */
export async function settleStaffCall(row: StaffCallRow, nowMs: number): Promise<StaffCallRow> {
  const now = new Date(nowMs).toISOString();
  if (isRingOverdue(row, nowMs)) {
    const { data, error } = await checkinDb()
      .from("staff_calls")
      .update({ status: "no_answer", ended_at: now, ended_by: "timeout" })
      .eq("organization_id", row.organization_id)
      .eq("id", row.id)
      .eq("status", "ringing")
      .lte("ring_deadline_at", now)
      .select("id")
      .maybeSingle();
    throwOnCheckinError(error, "staff_calls");
    if (data) {
      await notifyMissedCall(row);
      await writeStaffCallAudit({
        organizationId: row.organization_id,
        userId: null,
        deviceId: row.device_id,
        action: "staff_call_no_answer",
        callId: row.id,
        propertyKey: row.property_key,
      });
    }
    return { ...row, status: "no_answer", ended_at: now, ended_by: "timeout" };
  }
  if (isCallOverdue(row, nowMs)) {
    const { data, error } = await checkinDb()
      .from("staff_calls")
      .update({ status: "ended", ended_at: now, ended_by: "timeout" })
      .eq("organization_id", row.organization_id)
      .eq("id", row.id)
      .eq("status", "accepted")
      .select("id")
      .maybeSingle();
    throwOnCheckinError(error, "staff_calls");
    if (data) {
      await deleteStaffCallRoom(row.room_name);
      await writeStaffCallAudit({
        organizationId: row.organization_id,
        userId: null,
        deviceId: row.device_id,
        action: "staff_call_ended",
        callId: row.id,
        propertyKey: row.property_key,
      });
    }
    return { ...row, status: "ended", ended_at: now, ended_by: "timeout" };
  }
  return row;
}

/** 기기 폐기 — 그 기기의 진행 중 통화를 닫고 방을 지운다. 폐기 자체는 이미 끝났으니 무엇이 실패해도 던지지 않는다. */
export async function closeDeviceStaffCalls(input: { organizationId: string; deviceId: string; userId: string }): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await checkinDb()
      .from("staff_calls")
      .update({ status: "ended", ended_at: now, ended_by: "system" })
      .eq("organization_id", input.organizationId)
      .eq("device_id", input.deviceId)
      .in("status", ["ringing", "accepted"])
      .select("id, property_key, room_name");
    throwOnCheckinError(error, "staff_calls");
    for (const call of data ?? []) {
      await deleteStaffCallRoom(call.room_name);
      await writeStaffCallAudit({
        organizationId: input.organizationId,
        userId: input.userId,
        deviceId: input.deviceId,
        action: "staff_call_ended",
        callId: call.id,
        propertyKey: call.property_key,
      });
    }
  } catch (error) {
    console.error("[checkin] staff-call close on revoke:", error instanceof Error ? error.message : "unknown");
  }
}
