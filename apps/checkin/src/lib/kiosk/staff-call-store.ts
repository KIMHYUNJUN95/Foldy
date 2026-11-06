import "server-only";

import { randomUUID } from "node:crypto";

import type { DeviceRow } from "../device/auth";
import type { CheckinServiceClient } from "../supabase/service";
import { readDeviceSettings } from "../contract/read-settings";
import { deleteCallRoom, kioskCallToken, liveKitConfig } from "./livekit";
import {
  NO_RECIPIENT_TRANSITION,
  guestHangUpTransition,
  isCallId,
  ringDeadlineFrom,
  roomNameFor,
  staleTransition,
  supersedeTransition,
  type StaffCallStatus,
  type StaffCallTransition,
} from "./staff-call";
import { notifyStaff } from "./staff-notify";
import { openProvenKioskStay } from "./store";

// 직원 통화 태블릿 쪽 읽기 · 쓰기. 모든 쿼리는 이 기기의 조직 · 기기로 거른다. 상태 판단은 staff-call.ts.

const COLUMNS = "id, organization_id, property_key, device_id, stay_id, room_name, status, ring_deadline_at, accepted_at, accepted_by";
const ACTIVE_STATUSES: StaffCallStatus[] = ["ringing", "accepted"];

type CallRow = {
  id: string;
  organization_id: string;
  property_key: string;
  device_id: string;
  stay_id: string | null;
  room_name: string;
  status: StaffCallStatus;
  ring_deadline_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
};

async function readDeviceCall(db: CheckinServiceClient, device: DeviceRow, id: string): Promise<CallRow | null> {
  const { data, error } = await db
    .from("staff_calls")
    .select(COLUMNS)
    .eq("id", id)
    .eq("organization_id", device.organization_id)
    .eq("device_id", device.id)
    .maybeSingle();
  if (error) throw new Error(`staff_calls 읽기 실패: ${error.message}`);
  return data as CallRow | null;
}

async function readActiveCalls(db: CheckinServiceClient, device: DeviceRow): Promise<CallRow[]> {
  const { data, error } = await db
    .from("staff_calls")
    .select(COLUMNS)
    .eq("organization_id", device.organization_id)
    .eq("device_id", device.id)
    .in("status", ACTIVE_STATUSES);
  if (error) throw new Error(`staff_calls 읽기 실패: ${error.message}`);
  return (data ?? []) as CallRow[];
}

async function writeAudit(db: CheckinServiceClient, device: DeviceRow, action: string, call: { id: string; property_key: string }) {
  const { error } = await db.from("audit_log").insert({
    organization_id: device.organization_id,
    device_id: device.id,
    action,
    meta: { call_id: call.id, property_key: call.property_key },
  });
  if (error) console.error("[staff-call] audit_log 쓰기 실패:", error.message);
}

async function afterTransition(db: CheckinServiceClient, device: DeviceRow, call: CallRow, transition: StaffCallTransition) {
  await writeAudit(db, device, `staff_call_${transition.to}`, call);
  if (transition.to === "no_answer" && transition.endedBy !== "system") {
    await notifyStaff(db, {
      organizationId: device.organization_id,
      capability: "checkin.call",
      type: "checkin_call_missed",
      sourceId: call.id,
      payload: { callId: call.id, propertyKey: call.property_key },
    });
  }
  if (transition.from === "accepted") {
    const config = liveKitConfig();
    if (config) await deleteCallRoom(config, call.room_name);
  }
}

/**
 * 조건부 update 한 번으로 상태를 옮긴다. 0줄이면 누가 먼저 바꾼 것 — 다시 읽고 다시 판단한다.
 * 받은 직원 · 태블릿 · 시간 초과가 겹쳐도 한 쪽만 쓰므로 놓친 알림 · 기록은 한 번만 나간다.
 */
async function advance(
  db: CheckinServiceClient,
  device: DeviceRow,
  start: CallRow,
  decide: (row: CallRow) => StaffCallTransition | null,
  now: Date,
): Promise<CallRow | null> {
  let current: CallRow | null = start;
  while (current) {
    const transition = decide(current);
    if (!transition) return current;
    const { data, error } = await db
      .from("staff_calls")
      .update({ status: transition.to, ended_at: now.toISOString(), ended_by: transition.endedBy })
      .eq("id", current.id)
      .eq("organization_id", device.organization_id)
      .eq("device_id", device.id)
      .eq("status", transition.from)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`staff_calls 갱신 실패: ${error.message}`);
    if (data) {
      await afterTransition(db, device, data as CallRow, transition);
      return data as CallRow;
    }
    current = await readDeviceCall(db, device, current.id);
  }
  return null;
}

async function provenStayId(db: CheckinServiceClient, device: DeviceRow, sessionId: string | null, now: Date): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const opened = await openProvenKioskStay(db, sessionId, device, now);
    if ("error" in opened || opened.stay.organizationId !== device.organization_id) return null;
    return opened.stay.id;
  } catch (error) {
    console.error("[staff-call] 세션 확인 실패:", error instanceof Error ? error.message : "실패");
    return null;
  }
}

export type OpenCallResult = { ok: true; callId: string; ringDeadlineAt: string } | { ok: false; error: "disabled" | "unconfigured" };

const opened = (call: CallRow): OpenCallResult => ({ ok: true, callId: call.id, ringDeadlineAt: call.ring_deadline_at });

export async function openStaffCall(
  db: CheckinServiceClient,
  device: DeviceRow,
  input: { step: string; language: string; sessionId: string | null },
  now: Date,
): Promise<OpenCallResult> {
  const settings = await readDeviceSettings(db, device, "property_key");
  if (settings?.staff_call_enabled !== true) return { ok: false, error: "disabled" };
  if (!liveKitConfig()) return { ok: false, error: "unconfigured" };

  for (const active of await readActiveCalls(db, device)) {
    const settled = await advance(db, device, active, (row) => staleTransition(row, now) ?? supersedeTransition(row.status), now);
    if (settled?.status === "ringing") return opened(settled);
  }

  const id = randomUUID();
  const { data: created, error: insertError } = await db
    .from("staff_calls")
    .insert({
      id,
      organization_id: device.organization_id,
      property_key: device.property_key,
      device_id: device.id,
      stay_id: await provenStayId(db, device, input.sessionId, now),
      room_name: roomNameFor(id),
      status: "ringing",
      step: input.step,
      language: input.language,
      ring_deadline_at: ringDeadlineFrom(now),
    })
    .select(COLUMNS)
    .single();
  if (insertError?.code === "23505") {
    const [winner] = await readActiveCalls(db, device);
    if (winner) return opened(winner);
  }
  if (insertError) throw new Error(`staff_calls 만들기 실패: ${insertError.message}`);
  const call = created as CallRow;

  await writeAudit(db, device, "staff_call_started", call);
  const recipients = await notifyStaff(db, {
    organizationId: device.organization_id,
    capability: "checkin.call",
    type: "checkin_staff_call",
    sourceId: call.id,
    payload: { callId: call.id, propertyKey: call.property_key },
  });
  if (recipients === 0) await advance(db, device, call, (row) => (row.status === "ringing" ? NO_RECIPIENT_TRANSITION : null), now);
  return opened(call);
}

/** 판정 자체가 실패하면 통화를 이어 간다 — DB 오류로 멀쩡한 통화를 끊지 않는다. */
async function takerStillAllowed(db: CheckinServiceClient, device: DeviceRow, call: CallRow): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("can_take_call", { p_organization_id: device.organization_id, p_user_id: call.accepted_by });
    if (error) throw new Error(error.message);
    return data !== false;
  } catch (error) {
    console.error("[staff-call] 받은 직원 확인 실패:", error instanceof Error ? error.message : "실패");
    return true;
  }
}

export type CallState = { status: StaffCallStatus; token?: string; url?: string };

/**
 * 태블릿이 울리는 동안 1.5초, 통화 중 30초마다 부른다. 30분 한도와 받은 직원의 권한 · 계정 상태를 여기서 판정하고,
 * `accepted` 일 때만 토큰을 준다. 이 기기의 통화가 아니면 null.
 */
export async function readStaffCallState(db: CheckinServiceClient, device: DeviceRow, id: string, now: Date): Promise<CallState | null> {
  if (!isCallId(id)) return null;
  const row = await readDeviceCall(db, device, id);
  if (!row) return null;
  const settled = await advance(db, device, row, (current) => staleTransition(current, now), now);
  if (!settled) return null;
  if (settled.status !== "accepted") return { status: settled.status };

  const config = liveKitConfig();
  if (!config || !(await takerStillAllowed(db, device, settled))) {
    const closed = await advance(db, device, settled, (current) => supersedeTransition(current.status), now);
    return closed ? { status: closed.status } : null;
  }
  return { status: "accepted", token: await kioskCallToken(config, { deviceId: device.id, roomName: settled.room_name }), url: config.url };
}

/** 취소 · 끊기 공용. 이미 끝난 통화는 그 상태를 그대로 답한다. 이 기기의 통화가 아니면 null. */
export async function hangUpStaffCall(db: CheckinServiceClient, device: DeviceRow, id: string, now: Date): Promise<StaffCallStatus | null> {
  if (!isCallId(id)) return null;
  const row = await readDeviceCall(db, device, id);
  if (!row) return null;
  const closed = await advance(db, device, row, (current) => staleTransition(current, now) ?? guestHangUpTransition(current.status), now);
  return closed?.status ?? null;
}
