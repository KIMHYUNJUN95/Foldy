// 근태 — 사업장 마스터 + QR 토큰 백엔드 헬퍼 (2단계).
//
// 근태 사업장 마스터와 QR 수명 주기를 위한, 호출자에 구애받지 않는 서버 전용 데이터 헬퍼. 앞으로 만들
// 소유자 전용 웹 대시보드 서버 액션이 호출할 재사용 가능한 기본 단위이며, 개발용
// 임시 QR 도구(src/app/api/dev/attendance/temp-qr)가 테스트 데이터를 만들 때도 쓴다.
//
// 중요 — 권한 경계:
//   이 함수들은 호출자가 누구인지 확인하지 않는다. 사업장 마스터 / QR 발급은 제품 규칙(docs/product/21 → "Owner-only Authority")상
//   소유자 전용이며, 그 확인은 이 함수들을 호출하기 전에
//   호출자가 반드시 해야 한다 (웹 대시보드 서버 액션은 `role === 'owner'` 를 검증하고, 개발용
//   도구는 로컬 개발에서만 열린다). 모든 헬퍼는 조직 단위로 동작한다 — service 클라이언트가 RLS 를 우회하더라도
//   조직 격리가 유지되도록 항상 소유자의 조직 id 를 넘겨야 한다.
//
// 여기에는 작업자 출근/퇴근, 휴게, 정정, 급여 로직이 없다 — 그것은 3단계 이후.

import "server-only";
import { randomBytes } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isExcludedOperationalProperty } from "@/lib/room-label-normalization";
import type { AttendanceSiteRow, AttendanceQrTokenRow } from "@/lib/attendance";
import { ATTENDANCE_DEFAULT_RADIUS_METERS } from "@/lib/attendance";
import type { Database } from "@/types/database";

// 프로젝트의 database.ts 는 Relationships 를 생략해 service.rpc() 에 타입이 붙지 않는다. 호출하는 RPC 하나에
// 필요한 최소한의 타입만 제공한다 (src/app/onboarding/actions.ts 와 같음).
type IssueQrRpcClient = {
  rpc(
    fn: "issue_attendance_qr",
    args: { p_org: string; p_site: string; p_created_by: string; p_token: string },
  ): Promise<{ data: AttendanceQrTokenRow | null; error: { message: string } | null }>;
};

export type CreateAttendanceSiteInput = {
  organizationId: string;
  name: string;
  latitude: number;
  longitude: number;
  allowedRadiusMeters?: number;
  propertyId?: string | null;
  wifiSsids?: string[];
  isActive?: boolean;
};

export type UpdateAttendanceSitePatch = {
  name?: string;
  /** 인쇄물 표기용(주로 영문). 빈 문자열이면 null 로 저장해 `name` 폴백으로 돌아간다. */
  printName?: string | null;
  latitude?: number;
  longitude?: number;
  allowedRadiusMeters?: number;
  propertyId?: string | null;
  wifiSsids?: string[];
  isActive?: boolean;
};

/** 사업장 고유의, 서버가 검증할 수 있는 QR 토큰 값. */
export function generateAttendanceQrToken(): string {
  return `att_${randomBytes(24).toString("base64url")}`;
}

// ── 조회 ──

/** 조직의 모든 사업장, 최신순. (활성 + 비활성 — 관리자 목록은 둘 다 보여준다.) */
export async function listAttendanceSites(organizationId: string): Promise<AttendanceSiteRow[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("attendance_sites")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to list attendance sites: ${error.message}`);
  }
  return (data ?? []) as AttendanceSiteRow[];
}

/** 사업장 하나(조직 범위), 그 조직에 없으면 null. */
export async function getAttendanceSite(
  organizationId: string,
  siteId: string,
): Promise<AttendanceSiteRow | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("attendance_sites")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", siteId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load attendance site: ${error.message}`);
  }
  return (data as AttendanceSiteRow | null) ?? null;
}

/** 사업장의 단일 활성 QR 토큰, 활성인 것이 없으면 null. */
export async function getActiveQrToken(
  organizationId: string,
  siteId: string,
): Promise<AttendanceQrTokenRow | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("attendance_qr_tokens")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("site_id", siteId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load active QR token: ${error.message}`);
  }
  return (data as AttendanceQrTokenRow | null) ?? null;
}

/** 사업장의 전체 QR 토큰 이력 (활성 + 폐기), 최신순. */
export async function getQrTokenHistory(
  organizationId: string,
  siteId: string,
): Promise<AttendanceQrTokenRow[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("attendance_qr_tokens")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("site_id", siteId)
    .order("issued_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to load QR token history: ${error.message}`);
  }
  return (data ?? []) as AttendanceQrTokenRow[];
}

// ── 쓰기 (service-role, 호출자는 이미 소유자로 권한이 확인되어 있어야 함) ──

export async function createAttendanceSite(
  input: CreateAttendanceSiteInput,
): Promise<AttendanceSiteRow> {
  const { data, error } = await getSupabaseServiceClient()
    .from("attendance_sites")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      allowed_radius_meters: input.allowedRadiusMeters ?? ATTENDANCE_DEFAULT_RADIUS_METERS,
      property_id: input.propertyId ?? null,
      wifi_ssids: input.wifiSsids ?? [],
      is_active: input.isActive ?? true,
    })
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to create attendance site: ${error.message}`);
  }
  return data as AttendanceSiteRow;
}

export async function updateAttendanceSite(
  organizationId: string,
  siteId: string,
  patch: UpdateAttendanceSitePatch,
): Promise<AttendanceSiteRow> {
  const update: Database["public"]["Tables"]["attendance_sites"]["Update"] = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.printName !== undefined) update.print_name = patch.printName || null;
  if (patch.latitude !== undefined) update.latitude = patch.latitude;
  if (patch.longitude !== undefined) update.longitude = patch.longitude;
  if (patch.allowedRadiusMeters !== undefined) update.allowed_radius_meters = patch.allowedRadiusMeters;
  if (patch.propertyId !== undefined) update.property_id = patch.propertyId;
  if (patch.wifiSsids !== undefined) update.wifi_ssids = patch.wifiSsids;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;

  const { data, error } = await getSupabaseServiceClient()
    .from("attendance_sites")
    .update(update)
    .eq("organization_id", organizationId)
    .eq("id", siteId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to update attendance site: ${error.message}`);
  }
  return data as AttendanceSiteRow;
}

/** 다른 필드는 건드리지 않고 사업장을 활성화 / 비활성화한다. */
export async function setAttendanceSiteActive(
  organizationId: string,
  siteId: string,
  isActive: boolean,
): Promise<AttendanceSiteRow> {
  return updateAttendanceSite(organizationId, siteId, { isActive });
}

/**
 * 사업장의 활성 QR 토큰을 발급(또는 재발급)한다. `issue_attendance_qr` Postgres
 * 함수로 원자적으로 처리: 이전 활성 토큰은 비활성화되고 새 토큰에 연결되어
 * "사업장당 활성 토큰은 하나" 보장과 감사 체인이 유지된다.
 */
export async function issueAttendanceQr(params: {
  organizationId: string;
  siteId: string;
  createdByUserId: string;
}): Promise<AttendanceQrTokenRow> {
  const token = generateAttendanceQrToken();
  const service = getSupabaseServiceClient();
  const { data, error } = await (service as unknown as IssueQrRpcClient).rpc("issue_attendance_qr", {
    p_org: params.organizationId,
    p_site: params.siteId,
    p_created_by: params.createdByUserId,
    p_token: token,
  });
  if (error || !data) {
    throw new Error(`Failed to issue attendance QR: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

/** 교체 토큰을 발급하지 않고 사업장의 활성 QR 토큰을 비활성화한다. */
export async function revokeAttendanceQr(organizationId: string, siteId: string): Promise<void> {
  const { error } = await getSupabaseServiceClient()
    .from("attendance_qr_tokens")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("site_id", siteId)
    .eq("is_active", true);
  if (error) {
    throw new Error(`Failed to revoke attendance QR: ${error.message}`);
  }
}

// ── QR 딥링크 (2026-07-31) ──
// 휴대폰 기본 카메라로 QR 을 찍으면 `/mobile/attendance/capture?token=…` 로 들어온다. 그 진입
// 화면이 "어느 건물의 QR 인지"를 먼저 보여주고 출근/퇴근을 고르게 하려면, 제출 전에 토큰 →
// 사이트 이름을 한 번 조회해야 한다.
//
// 여기서 통과했다고 인증이 되는 것은 아니다 — 실제 판정(활성 토큰 · 활성 사이트 · 동일 조직 ·
// GPS 필수 · 반경 이내)은 전부 `submitAttendanceScan` 이 다시 한다. 이건 화면 표시용 조회다.

type SiteWithProperty = AttendanceSiteRow & {
  properties: {
    display_name_ko: string | null;
    display_name_ja: string | null;
    display_name_en: string | null;
  } | null;
};

/** 활성 QR 토큰이 가리키는 사이트의 표시 이름. 토큰/사이트가 유효하지 않으면 null. */
export async function getSiteNameByActiveQrToken(
  organizationId: string,
  token: string,
  locale: string,
): Promise<string | null> {
  if (!token) return null;
  const service = getSupabaseServiceClient();

  const tokenRes = await service
    .from("attendance_qr_tokens")
    .select("*")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();
  const tokenRow = tokenRes.data as AttendanceQrTokenRow | null;
  // 조직 일치는 반드시 확인한다 — 서비스 클라이언트는 RLS 를 우회한다.
  if (tokenRes.error || !tokenRow || tokenRow.organization_id !== organizationId) return null;

  const siteRes = await service
    .from("attendance_sites")
    .select("*, properties(display_name_ko, display_name_ja, display_name_en)")
    .eq("organization_id", organizationId)
    .eq("id", tokenRow.site_id)
    .maybeSingle();
  const site = siteRes.data as SiteWithProperty | null;
  if (siteRes.error || !site || !site.is_active) return null;

  const p = site.properties;
  if (p) {
    if (locale === "ja" && p.display_name_ja) return p.display_name_ja;
    if (locale === "en" && p.display_name_en) return p.display_name_en;
    if (p.display_name_ko) return p.display_name_ko;
  }
  return site.name;
}

// ── 현장별 QR 개요 (2026-07-31, 설정 콘솔 마스터·디테일) ──────────────────
// 설정 인덱스와 출퇴근 QR 화면이 같은 값을 본다: 현장 목록 + 각 현장의 활성 토큰.
// 현장 수만큼 쿼리를 돌리지 않도록 활성 토큰을 한 번에 읽어 맵으로 붙인다.

export type AttendanceSiteQrRow = {
  site: AttendanceSiteRow;
  /** 활성 토큰이 없으면 null = 이 현장에서는 아직 출퇴근을 찍을 수 없다. */
  token: AttendanceQrTokenRow | null;
};

export async function getAttendanceSiteQrOverview(
  organizationId: string,
): Promise<AttendanceSiteQrRow[]> {
  const service = getSupabaseServiceClient();
  const [sitesRes, tokensRes] = await Promise.all([
    service
      .from("attendance_sites")
      .select("*")
      .eq("organization_id", organizationId)
      // 비활성 현장은 목록 맨 아래로 — 운영에서 뺀 현장이 위를 차지하지 않게.
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: true }),
    service
      .from("attendance_qr_tokens")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_active", true),
  ]);
  if (sitesRes.error) throw new Error(`Failed to load attendance sites: ${sitesRes.error.message}`);

  const bySite = new Map<string, AttendanceQrTokenRow>();
  for (const row of (tokensRes.data ?? []) as AttendanceQrTokenRow[]) {
    bySite.set(row.site_id, row);
  }
  return ((sitesRes.data ?? []) as AttendanceSiteRow[]).map((site) => ({
    site,
    token: bySite.get(site.id) ?? null,
  }));
}

// ── 현장 정리: 삭제 / 비활성화 (2026-07-31) ────────────────────────────────
//
// 스키마가 이미 경계를 정해 두었다:
//   · attendance_qr_tokens.site_id        → on delete cascade  (QR 은 현장과 함께 사라진다)
//   · attendance_sessions.clock_in/out_site_id → **on delete restrict**
//   · attendance_attempt_logs / correction_requests → set null
//
// 즉 **출퇴근 기록이 한 건이라도 있는 현장은 DB 가 삭제를 거부한다.** 급여 근거가 되는 기록을
// 지우지 않기 위한 설계이고, 그대로 유지한다. 그래서 UI 는 두 가지를 나눠 제공한다:
//   · 기록이 없는 현장 → 완전 삭제
//   · 기록이 있는 현장 → `is_active = false` 로 운영에서만 제외(기록은 보존)
// 비활성 현장의 출퇴근은 이미 `submitAttendanceScan` 이 거부한다.

/** 이 현장을 참조하는 출퇴근 세션이 하나라도 있는지. 삭제 가능 여부 판단용. */
export async function attendanceSiteHasHistory(
  organizationId: string,
  siteId: string,
): Promise<boolean> {
  const service = getSupabaseServiceClient();
  const { count, error } = await service
    .from("attendance_sessions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .or(`clock_in_site_id.eq.${siteId},clock_out_site_id.eq.${siteId}`);
  // 확인에 실패하면 "기록이 있다"로 본다 — 모르는 상태에서 삭제 버튼을 열어주지 않는다.
  if (error) return true;
  return (count ?? 0) > 0;
}

export type DeleteAttendanceSiteResult =
  | { ok: true }
  | { ok: false; reason: "in_use" | "not_found" | "error" };

/** 현장 삭제. 출퇴근 기록이 있으면 DB(FK restrict)가 막고 `in_use` 를 돌려준다. */
export async function deleteAttendanceSite(
  organizationId: string,
  siteId: string,
): Promise<DeleteAttendanceSiteResult> {
  if (!siteId) return { ok: false, reason: "not_found" };
  const { error } = await getSupabaseServiceClient()
    .from("attendance_sites")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", siteId);
  if (!error) return { ok: true };
  // 23503 = foreign_key_violation → 이 현장을 참조하는 근태 세션이 있다.
  if (error.code === "23503") return { ok: false, reason: "in_use" };
  return { ok: false, reason: "error" };
}

// 활성/비활성 전환은 위쪽의 기존 `setAttendanceSiteActive()` 를 그대로 쓴다.

/**
 * 근무지에 연결할 **건물 선택지** (2026-09-11).
 *
 * `attendance_sites.property_id` 는 처음부터 있었고 `createAttendanceSite` ·
 * `updateAttendanceSite` 도 받도록 돼 있었지만, **설정 화면에 고를 칸이 없었다.** 그래서 근무지
 * 9곳 전부 비어 있었고, 교통비 자동 연결이 그 FK 를 따라가려 하자 아무것도 이어지지 않았다.
 *
 * 근무지 이름과 건물 이름은 따로 관리돼 어긋난다 — 근무지는 `아라키초A`, 건물은 Beds24 원본인
 * `Arakicho A` 다. 「스카이」처럼 **건물이 개명됐는데 근무지 이름은 그대로**인 경우도 있다
 * (STAY ARI 의 오픈 전 이름). 이름으로 맞추는 것은 임시방편이고, FK 로 묶어야 이름이 달라도
 * 정확히 이어진다.
 *
 * 사노는 운영 대상이 아니라 뺀다(캘린더와 같은 기준).
 */
export type AttendanceSitePropertyOption = { id: string; label: string };

export async function listAttendanceSiteProperties(
  organizationId: string,
): Promise<AttendanceSitePropertyOption[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("properties")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) {
    console.error("[attendance-sites] property option read failed", error.message);
    return [];
  }
  return (data ?? [])
    .filter((row) => !isExcludedOperationalProperty(row.name))
    .map((row) => ({ id: row.id, label: row.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
