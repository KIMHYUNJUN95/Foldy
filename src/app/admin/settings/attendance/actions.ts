"use server";

import { redirect } from "next/navigation";
import {
  createAttendanceSite,
  deleteAttendanceSite,
  getActiveQrToken,
  getAttendanceSite,
  issueAttendanceQr,
  setAttendanceSiteActive,
  updateAttendanceSite,
} from "@/lib/attendance-sites";
import { revokeTrustedDevice } from "@/lib/attendance-trusted-device";
import { requireAdminSession } from "@/lib/admin-session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasOrganizationContext } from "@/lib/session";

function parseText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseNumberField(value: string) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function requireOwnerOrgSession() {
  const session = await requireAdminSession();
  if (!session.capabilities.includes("attendance.settings") || !hasOrganizationContext(session)) {
    redirect("/admin/settings?error=forbidden");
  }
  return session;
}

export async function saveAttendanceSiteSettings(formData: FormData) {
  const session = await requireOwnerOrgSession();
  const organizationId = session.organization.id;
  const siteId = parseText(formData, "siteId");
  const name = parseText(formData, "name");
  const latitude = parseNumberField(parseText(formData, "latitude"));
  const longitude = parseNumberField(parseText(formData, "longitude"));
  const radius = parseNumberField(parseText(formData, "radius"));
  const printName = parseText(formData, "printName");
  // 빈 값은 「건물 아님」(사무실 등)이다 — null 로 저장해 연결을 끊는다.
  const propertyId = parseText(formData, "propertyId") || null;

  if (!name || latitude == null || longitude == null) {
    redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&error=invalid_coordinates`);
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&error=invalid_coordinates`);
  }
  if (radius == null || !Number.isInteger(radius) || radius <= 0) {
    redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&error=invalid_radius`);
  }

  let savedSiteId: string;
  try {
    const site = siteId
      ? await updateAttendanceSite(organizationId, siteId, {
          name,
          printName,
          latitude,
          longitude,
          allowedRadiusMeters: radius,
          propertyId,
        })
      : await createAttendanceSite({
          organizationId,
          name,
          latitude,
          longitude,
          allowedRadiusMeters: radius,
          propertyId,
          isActive: true,
        });
    savedSiteId = site.id;
  } catch {
    redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&error=site_save_failed`);
  }
  redirect(`/admin/settings/attendance?site=${savedSiteId}&saved=1`);
}

export async function issueAttendanceSiteQr(formData: FormData) {
  const session = await requireOwnerOrgSession();
  const organizationId = session.organization.id;
  const siteId = parseText(formData, "siteId");

  if (!siteId) {
    redirect("/admin/settings/attendance?error=invalid_site");
  }

  let site: Awaited<ReturnType<typeof getAttendanceSite>>;
  try {
    site = await getAttendanceSite(organizationId, siteId);
  } catch {
    redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&error=qr_issue_failed`);
  }
  if (!site) {
    redirect("/admin/settings/attendance?error=invalid_site");
  }

  // 성공 redirect 는 try 밖 — 안에서 부르면 NEXT_REDIRECT 가 catch 에 잡혀 「발급 실패」로 보이고,
  // 그걸 믿고 다시 발급하면 이미 인쇄한 QR 이 무효가 된다.
  let hadActive: boolean;
  try {
    hadActive = Boolean(await getActiveQrToken(organizationId, siteId));
    await issueAttendanceQr({
      organizationId,
      siteId,
      createdByUserId: session.user.id,
    });
  } catch {
    redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&error=qr_issue_failed`);
  }
  redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&${hadActive ? "reissued" : "issued"}=1`);
}

/**
 * 기억된 근태 기기 해지 (2026-07-31).
 *
 * 휴대폰 분실·퇴사처럼 그 기기에서 더 이상 打刻하면 안 되는 상황에서 쓴다. 해지하면 그 기기는
 * 즉시 정상 로그인을 다시 요구한다. 조직 스코프로 제한해 다른 조직 기기는 건드릴 수 없다.
 * 참고: docs/product/24-attendance-workflow.md → "Trusted Device".
 */
export async function revokeAttendanceTrustedDevice(formData: FormData) {
  const session = await requireOwnerOrgSession();
  const organizationId = session.organization.id;
  const deviceId = parseText(formData, "deviceId");
  const siteId = parseText(formData, "siteId");
  const back = siteId
    ? `/admin/settings/attendance?site=${encodeURIComponent(siteId)}`
    : "/admin/settings/attendance";

  if (!deviceId) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=invalid_device`);
  }

  const ok = await revokeTrustedDevice(organizationId, deviceId);
  if (!ok) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=device_revoke_failed`);
  }

  await writeTrustedDeviceAudit(organizationId, session.user.id, deviceId);
  redirect(`${back}${back.includes("?") ? "&" : "?"}device_revoked=1`);
}

async function writeTrustedDeviceAudit(
  organizationId: string,
  actorUserId: string,
  deviceId: string,
) {
  try {
    await getSupabaseServiceClient()
      .from("audit_logs")
      .insert({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        action: "attendance_trusted_device_revoke",
        target_type: "attendance_trusted_device",
        target_id: deviceId,
        metadata: {},
      });
  } catch {
    console.error("[attendance] trusted-device revoke audit failed", deviceId);
  }
}

/**
 * 현장 삭제 (2026-07-31).
 *
 * 출퇴근 기록이 있는 현장은 DB(FK restrict)가 삭제를 거부한다 — 급여 근거가 되는 기록을 지우지
 * 않기 위한 설계이므로 그대로 둔다. 그런 현장은 `deactivateAttendanceSite` 로 운영에서만 뺀다.
 * QR 토큰은 cascade 로 함께 삭제된다.
 */
export async function deleteAttendanceSiteAction(formData: FormData) {
  const session = await requireOwnerOrgSession();
  const organizationId = session.organization.id;
  const siteId = parseText(formData, "siteId");
  if (!siteId) {
    redirect("/admin/settings/attendance?error=invalid_site");
  }

  const result = await deleteAttendanceSite(organizationId, siteId);
  if (!result.ok) {
    const key = result.reason === "in_use" ? "site_in_use" : "site_delete_failed";
    redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&error=${key}`);
  }

  await writeSiteAudit(organizationId, session.user.id, "attendance_site_delete", siteId);
  redirect("/admin/settings/attendance?site_deleted=1");
}

/** 현장 활성/비활성 전환. 비활성 현장에서는 출퇴근을 찍을 수 없고, 기록은 그대로 보존된다. */
export async function setAttendanceSiteActiveAction(formData: FormData) {
  const session = await requireOwnerOrgSession();
  const organizationId = session.organization.id;
  const siteId = parseText(formData, "siteId");
  const activate = parseText(formData, "activate") === "1";
  if (!siteId) {
    redirect("/admin/settings/attendance?error=invalid_site");
  }

  try {
    await setAttendanceSiteActive(organizationId, siteId, activate);
  } catch {
    redirect(`/admin/settings/attendance?site=${encodeURIComponent(siteId)}&error=save_failed`);
  }

  await writeSiteAudit(
    organizationId,
    session.user.id,
    activate ? "attendance_site_activate" : "attendance_site_deactivate",
    siteId,
  );
  redirect(
    `/admin/settings/attendance?site=${encodeURIComponent(siteId)}&${activate ? "site_activated" : "site_deactivated"}=1`,
  );
}

async function writeSiteAudit(
  organizationId: string,
  actorUserId: string,
  action: string,
  siteId: string,
) {
  try {
    await getSupabaseServiceClient()
      .from("audit_logs")
      .insert({
        organization_id: organizationId,
        actor_user_id: actorUserId,
        action,
        target_type: "attendance_site",
        target_id: siteId,
        metadata: {},
      });
  } catch {
    console.error("[attendance] site audit failed", action, siteId);
  }
}
