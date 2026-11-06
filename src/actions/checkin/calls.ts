"use server";

import { UUID_PATTERN, checkinDb, runCheckinAction, throwOnCheckinError } from "@/lib/checkin/server";
import {
  acceptMissReason,
  canControlCall,
  type AcceptStaffCallErrorKey,
  type RingingStaffCall,
  type StaffCallStatus,
  type StaffCallStay,
} from "@/lib/checkin/staff-call";
import {
  STAFF_CALL_COLUMNS,
  checkinCallGate,
  deleteStaffCallRoom,
  mintStaffToken,
  readLiveKitConfig,
  settleStaffCall,
  writeStaffCallAudit,
  type StaffCallRow,
} from "@/lib/checkin/staff-call-server";
import { loadCheckinStayDetail } from "@/lib/checkin/stays";

/**
 * 셀프 체크인 직원 통화 — 직원 쪽 다섯 액션. docs/product/46 §5.
 * 문은 `checkinCallGate` — 관리자 웹 권한이 없는 직원도 받는다. 모바일 · 관리자 공용이라 거부는 redirect 없이 결과로 돌려준다. `organization_id` 는 항상 세션에서 온다.
 * 다른 조직 통화는 없는 것과 같게 `forbidden` 으로 답한다 — 있다는 사실도 알리지 않는다.
 */

type Failure = { ok: false; errorKey: "forbidden" | "not_ready" | "failed" };

async function readCall(organizationId: string, id: string): Promise<StaffCallRow | null> {
  const { data, error } = await checkinDb()
    .from("staff_calls")
    .select(STAFF_CALL_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  throwOnCheckinError(error, "staff_calls");
  return data as StaffCallRow | null;
}

export type GetRingingStaffCallsResult = { ok: true; calls: RingingStaffCall[] } | Failure;

/** 지금 울리는 호출. 45초가 지난 것은 여기서 닫는다. */
export async function getRingingStaffCalls(): Promise<GetRingingStaffCallsResult> {
  const gate = await checkinCallGate("checkin.call");
  if (!gate.ok) return gate;
  return runCheckinAction("calls-ringing", async () => {
    const db = checkinDb();
    const nowMs = Date.now();
    const { data, error } = await db
      .from("staff_calls")
      .select(STAFF_CALL_COLUMNS)
      .eq("organization_id", gate.organizationId)
      .eq("status", "ringing")
      .order("created_at", { ascending: true });
    throwOnCheckinError(error, "staff_calls");

    const settled = await Promise.all(((data ?? []) as StaffCallRow[]).map((row) => settleStaffCall(row, nowMs)));
    const live = settled.filter((row) => row.status === "ringing");
    if (live.length === 0) return { ok: true as const, calls: [] };

    const { data: devices, error: deviceError } = await db
      .from("devices")
      .select("id, name")
      .eq("organization_id", gate.organizationId)
      .in("id", [...new Set(live.map((row) => row.device_id))]);
    throwOnCheckinError(deviceError, "devices");
    const deviceNames = new Map((devices ?? []).map((device) => [device.id, device.name]));

    return {
      ok: true as const,
      calls: live.map((row) => ({
        id: row.id,
        propertyKey: row.property_key,
        deviceName: deviceNames.get(row.device_id) ?? "",
        step: row.step,
        language: row.language,
        ringDeadlineAt: row.ring_deadline_at,
      })),
    };
  });
}

export type AcceptStaffCallResult =
  | { ok: true; token: string; url: string; stayId: string | null; canViewStay: boolean }
  | { ok: false; errorKey: AcceptStaffCallErrorKey };

/** 받기 — 조건부 update 한 번으로 먼저 온 한 명만 성공한다(§3). 토큰은 이긴 사람만 받는다. */
export async function acceptStaffCall(id: string): Promise<AcceptStaffCallResult> {
  const gate = await checkinCallGate("checkin.call");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(id)) return { ok: false, errorKey: "forbidden" };
  // 잡기 전에 본다 — 설정이 없으면 호출을 그대로 두어 태블릿이 시간 초과로 연락처 화면까지 가게 한다.
  const config = readLiveKitConfig();
  if (!config) {
    return runCheckinAction("calls-accept", async () => {
      const row = await readCall(gate.organizationId, id);
      return { ok: false as const, errorKey: row ? ("unconfigured" as const) : ("forbidden" as const) };
    });
  }

  return runCheckinAction("calls-accept", async (): Promise<AcceptStaffCallResult> => {
    const db = checkinDb();
    const now = new Date();
    const nowIso = now.toISOString();
    const { data: won, error } = await db
      .from("staff_calls")
      .update({ status: "accepted", accepted_at: nowIso, accepted_by: gate.userId })
      .eq("organization_id", gate.organizationId)
      .eq("id", id)
      .eq("status", "ringing")
      .gt("ring_deadline_at", nowIso)
      .select(STAFF_CALL_COLUMNS)
      .maybeSingle();
    throwOnCheckinError(error, "staff_calls");

    if (!won) {
      const row = await readCall(gate.organizationId, id);
      if (!row) return { ok: false, errorKey: "forbidden" };
      const settled = await settleStaffCall(row, now.getTime());
      return { ok: false, errorKey: acceptMissReason(settled) };
    }

    const call = won as StaffCallRow;
    let token: string;
    try {
      token = await mintStaffToken(config, { room: call.room_name, userId: gate.userId });
    } catch (mintError) {
      // 이미 잡았으니 그대로 두면 손님이 빈 통화에 30분 갇힌다.
      console.error("[checkin] staff-call token:", mintError instanceof Error ? mintError.message : "unknown");
      const { error: closeError } = await db
        .from("staff_calls")
        .update({ status: "ended", ended_at: nowIso, ended_by: "system" })
        .eq("organization_id", gate.organizationId)
        .eq("id", id)
        .eq("status", "accepted");
      throwOnCheckinError(closeError, "staff_calls");
      await writeStaffCallAudit({
        organizationId: gate.organizationId,
        userId: gate.userId,
        deviceId: call.device_id,
        action: "staff_call_ended",
        callId: call.id,
        propertyKey: call.property_key,
      });
      return { ok: false, errorKey: "failed" };
    }

    await writeStaffCallAudit({
      organizationId: gate.organizationId,
      userId: gate.userId,
      deviceId: call.device_id,
      action: "staff_call_accepted",
      callId: call.id,
      propertyKey: call.property_key,
    });

    const canViewStay = gate.capabilities.includes("checkin.view") && !!call.stay_id;
    return { ok: true, token, url: config.url, stayId: canViewStay ? call.stay_id : null, canViewStay };
  });
}

export type EndStaffCallResult = { ok: true; status: StaffCallStatus } | Failure;

/** 끊기 — 받은 본인 또는 `checkin.manage`. 이미 끝난 통화는 그대로 성공(기록을 더하지 않는다). */
export async function endStaffCall(id: string): Promise<EndStaffCallResult> {
  const gate = await checkinCallGate("checkin.call");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(id)) return { ok: false, errorKey: "forbidden" };
  return runCheckinAction("calls-end", async (): Promise<EndStaffCallResult> => {
    const read = await readCall(gate.organizationId, id);
    // 시간이 지난 통화는 누가 건드려도 닫는다 — 권한은 답을 가를 뿐, 낡은 행을 남기지 않는다.
    const row = read && (await settleStaffCall(read, Date.now()));
    if (!row || !canControlCall(row, gate.userId, gate.capabilities.includes("checkin.manage"))) {
      return { ok: false, errorKey: "forbidden" };
    }
    if (row.status !== "accepted") return { ok: true, status: row.status as StaffCallStatus };

    const now = new Date().toISOString();
    const { data, error } = await checkinDb()
      .from("staff_calls")
      .update({ status: "ended", ended_at: now, ended_by: "staff" })
      .eq("organization_id", gate.organizationId)
      .eq("id", id)
      .eq("status", "accepted")
      .select("id")
      .maybeSingle();
    throwOnCheckinError(error, "staff_calls");
    if (data) {
      await deleteStaffCallRoom(row.room_name);
      await writeStaffCallAudit({
        organizationId: gate.organizationId,
        userId: gate.userId,
        deviceId: row.device_id,
        action: "staff_call_ended",
        callId: row.id,
        propertyKey: row.property_key,
      });
    }
    return { ok: true, status: "ended" };
  });
}

export type GetStaffCallStatusResult = { ok: true; status: StaffCallStatus } | Failure;

/** 받은 뒤 상대가 끊었는지 확인. 30분이 지났으면 여기서 닫는다. */
export async function getStaffCallStatus(id: string): Promise<GetStaffCallStatusResult> {
  const gate = await checkinCallGate("checkin.call");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(id)) return { ok: false, errorKey: "forbidden" };
  return runCheckinAction("calls-status", async (): Promise<GetStaffCallStatusResult> => {
    const read = await readCall(gate.organizationId, id);
    const row = read && (await settleStaffCall(read, Date.now()));
    if (!row || !canControlCall(row, gate.userId, gate.capabilities.includes("checkin.manage"))) {
      return { ok: false, errorKey: "forbidden" };
    }
    return { ok: true, status: row.status as StaffCallStatus };
  });
}

export type GetStaffCallStayResult = { ok: true; stay: StaffCallStay } | Failure | { ok: false; errorKey: "not_found" };

/** 「예약 보기」 — `checkin.view` 필수, 내가 받아 진행 중인 통화의 stay 요약만. */
export async function getStaffCallStay(id: string): Promise<GetStaffCallStayResult> {
  const gate = await checkinCallGate("checkin.view");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(id)) return { ok: false, errorKey: "forbidden" };
  return runCheckinAction("calls-stay", async (): Promise<GetStaffCallStayResult> => {
    const read = await readCall(gate.organizationId, id);
    const row = read && (await settleStaffCall(read, Date.now()));
    if (!row || row.status !== "accepted" || row.accepted_by !== gate.userId) return { ok: false, errorKey: "forbidden" };
    if (!row.stay_id) return { ok: false, errorKey: "not_found" };
    const detail = await loadCheckinStayDetail(gate.organizationId, row.stay_id, { includeDocuments: false });
    if (!detail) return { ok: false, errorKey: "not_found" };
    const { stay } = detail;
    return {
      ok: true,
      stay: {
        stayId: stay.stayId,
        leadName: stay.leadName,
        reservationNumber: stay.reservationNumber,
        propertyKey: stay.propertyKey,
        roomLabels: stay.roomLabels,
        checkInDate: stay.checkInDate,
        checkOutDate: stay.checkOutDate,
        partySize: stay.partySize,
      },
    };
  });
}
