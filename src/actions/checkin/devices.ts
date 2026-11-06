"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";

import { ENROLLMENT_CODE_PATTERN, checkinPropertyName, formatEnrollmentCode, isDeviceDisconnected } from "@/lib/checkin/model";
import { UUID_PATTERN, checkinDb, checkinGate, runCheckinAction, throwOnCheckinError, writeCheckinAuditAfterChange } from "@/lib/checkin/server";
import { closeDeviceStaffCalls } from "@/lib/checkin/staff-call-server";

/**
 * 셀프 체크인 기기 관리(FR-S07) — 등록 코드 · 목록 · 이름 · 폐기. 권한 `checkin.manage`. 16 §4-1.
 * 등록 코드는 스키마상 평문 8자리다(`enrollment_codes.code`, 태블릿 `/api/device/enroll` 이 그대로 대조). 발급 응답에 한 번만 내보낸다 —
 * 다시 읽는 액션이 없고, 표는 service_role 만 읽을 수 있다(authenticated 권한 · 정책 없음).
 */

type CommonFailure = { ok: false; errorKey: "forbidden" | "not_ready" | "invalid" | "failed" };

const CODE_ATTEMPTS = 5;

export type CheckinDevice = {
  id: string;
  propertyKey: string;
  /** 건물 정규 이름 — 그릴 때 현지화한다. */
  propertyName: string;
  name: string;
  registeredAt: string;
  lastSeenAt: string | null;
  disconnected: boolean;
  appVersion: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  battery: number | null;
};

function cleanDeviceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}

export type IssueCheckinEnrollmentCodeResult = { ok: true; code: string; expiresAt: string } | CommonFailure;

export type InvalidateCheckinEnrollmentCodeResult = { ok: true; invalidated: boolean } | CommonFailure;

/**
 * 「새 코드」 — 화면에 보이는 **그 코드 하나만** 끝낸다(expires_at = 지금). 태블릿 등록은 `expires_at > now` 만 받는다.
 * 건물마다 태블릿을 연달아 등록할 때 앞서 받아 둔 다른 코드가 죽으면 안 되므로 발급자 전체를 끝내지 않는다.
 * 조직 · 발급자 · 미사용 조건을 함께 걸어, 다른 사람 코드 값을 넘기거나 이미 쓴 코드면 0줄이다(`invalidated: false`, 기록 없음). 기록에 코드 값은 넣지 않는다.
 * 패널을 닫는 것으로는 부르지 않는다(적어 두고 태블릿으로 가는 흐름).
 */
export async function invalidateCheckinEnrollmentCode(code: string): Promise<InvalidateCheckinEnrollmentCodeResult> {
  const gate = await checkinGate("checkin.manage");
  if (!gate.ok) return gate;
  if (typeof code !== "string" || !ENROLLMENT_CODE_PATTERN.test(code)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("enrollment-code-invalidate", async () => {
    const now = new Date().toISOString();
    const { data, error } = await checkinDb()
      .from("enrollment_codes")
      .update({ expires_at: now })
      .eq("code", code)
      .eq("organization_id", gate.organizationId)
      .eq("created_by", gate.userId)
      .is("used_at", null)
      .gt("expires_at", now)
      .select("property_key")
      .maybeSingle();
    throwOnCheckinError(error, "enrollment_codes");
    if (!data) return { ok: true as const, invalidated: false };
    await writeCheckinAuditAfterChange({
      organizationId: gate.organizationId,
      userId: gate.userId,
      action: "enrollment_code_invalidated",
      meta: { property_key: data.property_key },
    });
    return { ok: true as const, invalidated: true };
  });
}

/** 8자리 · 10분 · 한 번(만료 칼럼 기본값). 앞서 받은 코드는 그대로 둔다 — 건물마다 태블릿을 연달아 등록한다. 기록에는 코드 값을 넣지 않는다. */
export async function issueCheckinEnrollmentCode(input: { propertyKey: string; deviceName: string }): Promise<IssueCheckinEnrollmentCodeResult> {
  const gate = await checkinGate("checkin.manage");
  if (!gate.ok) return gate;
  const deviceName = cleanDeviceName(input.deviceName);
  if (!deviceName || !checkinPropertyName(input.propertyKey)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("enrollment-code", async () => {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const { data, error } = await checkinDb()
        .from("enrollment_codes")
        .insert({
          code: formatEnrollmentCode(randomInt(0, 100_000_000)),
          organization_id: gate.organizationId,
          property_key: input.propertyKey,
          device_name: deviceName,
          created_by: gate.userId,
        })
        .select("code, expires_at")
        .single();
      if (error?.code === "23505") continue;
      throwOnCheckinError(error, "enrollment_codes");
      if (!data) break;
      await writeCheckinAuditAfterChange({
        organizationId: gate.organizationId,
        userId: gate.userId,
        action: "enrollment_code_issued",
        meta: { property_key: input.propertyKey },
      });
      return { ok: true as const, code: data.code, expiresAt: data.expires_at };
    }
    return { ok: false as const, errorKey: "failed" as const };
  });
}

export type ListCheckinDevicesResult = { ok: true; devices: CheckinDevice[] } | CommonFailure;

/** 폐기되지 않은 기기. 토큰 해시 칼럼은 읽지 않는다. */
export async function listCheckinDevices(input: { propertyKey?: string | null } = {}): Promise<ListCheckinDevicesResult> {
  const gate = await checkinGate("checkin.manage");
  if (!gate.ok) return gate;
  if (input.propertyKey && !checkinPropertyName(input.propertyKey)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("devices", async () => {
    let query = checkinDb()
      .from("devices")
      .select("id, property_key, name, registered_at, last_seen_at, app_version, device_model, os_version, battery")
      .eq("organization_id", gate.organizationId)
      .is("revoked_at", null)
      .order("property_key")
      .order("name");
    if (input.propertyKey) query = query.eq("property_key", input.propertyKey);
    const { data, error } = await query;
    throwOnCheckinError(error, "devices");
    const now = new Date();
    return {
      ok: true as const,
      devices: (data ?? []).map((row) => ({
        id: row.id,
        propertyKey: row.property_key,
        propertyName: checkinPropertyName(row.property_key) ?? row.property_key,
        name: row.name,
        registeredAt: row.registered_at,
        lastSeenAt: row.last_seen_at,
        disconnected: isDeviceDisconnected(row.last_seen_at, now),
        appVersion: row.app_version,
        deviceModel: row.device_model,
        osVersion: row.os_version,
        battery: row.battery,
      })),
    };
  });
}

export type RenameCheckinDeviceResult = { ok: true } | CommonFailure | { ok: false; errorKey: "not_found" };

export async function renameCheckinDevice(input: { deviceId: string; name: string }): Promise<RenameCheckinDeviceResult> {
  const gate = await checkinGate("checkin.manage");
  if (!gate.ok) return gate;
  const name = cleanDeviceName(input.name);
  if (!name || !UUID_PATTERN.test(input.deviceId)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("device-rename", async () => {
    const { data, error } = await checkinDb()
      .from("devices")
      .update({ name })
      .eq("organization_id", gate.organizationId)
      .eq("id", input.deviceId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    throwOnCheckinError(error, "devices");
    if (!data) return { ok: false as const, errorKey: "not_found" as const };
    await writeCheckinAuditAfterChange({
      organizationId: gate.organizationId,
      userId: gate.userId,
      action: "device_renamed",
      meta: { device_id: input.deviceId },
    });
    revalidatePath("/admin/checkin");
    return { ok: true as const };
  });
}

export type RevokeCheckinDeviceResult = { ok: true; already: boolean } | CommonFailure | { ok: false; errorKey: "not_found" };

/** 폐기 — 줄은 남기고 `revoked_at` 만 채운다(기록 · 문서가 이 기기를 가리킨다). 다음 요청부터 태블릿 토큰이 무효가 된다. */
export async function revokeCheckinDevice(deviceId: string): Promise<RevokeCheckinDeviceResult> {
  const gate = await checkinGate("checkin.manage");
  if (!gate.ok) return gate;
  if (!UUID_PATTERN.test(deviceId)) return { ok: false, errorKey: "invalid" };
  return runCheckinAction("device-revoke", async () => {
    const db = checkinDb();
    const { data, error } = await db
      .from("devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("organization_id", gate.organizationId)
      .eq("id", deviceId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    throwOnCheckinError(error, "devices");
    if (!data) {
      const { data: existing, error: readError } = await db
        .from("devices")
        .select("id")
        .eq("organization_id", gate.organizationId)
        .eq("id", deviceId)
        .maybeSingle();
      throwOnCheckinError(readError, "devices");
      return existing ? { ok: true as const, already: true } : { ok: false as const, errorKey: "not_found" as const };
    }
    await writeCheckinAuditAfterChange({
      organizationId: gate.organizationId,
      userId: gate.userId,
      action: "device_revoked",
      meta: { device_id: deviceId },
    });
    await closeDeviceStaffCalls({ organizationId: gate.organizationId, deviceId, userId: gate.userId });
    revalidatePath("/admin/checkin");
    return { ok: true as const, already: false };
  });
}
