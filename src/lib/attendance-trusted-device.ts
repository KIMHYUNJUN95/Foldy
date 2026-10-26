import "server-only";

// 근태 기기 기억 (Attendance Trusted Device) — 2026-07-31
//
// 배경: 건물 QR 을 휴대폰 기본 카메라로 찍으면 아이폰은 Safari 로 열린다. iOS 는 홈 화면 PWA 와
// Safari 의 저장소가 분리돼 있어 로그인 세션을 공유하지 않는다. 그래서 QR 로 들어올 때마다
// 재로그인을 요구받는 상황이 생긴다. 한 번 로그인해 실제로 打刻에 성공한 기기를 기억해서,
// 그 다음부터는 세션 없이도 出退勤만 바로 되게 한다.
//
// ⚠ 권한 경계 — 이 자격증명이 허용하는 것은 **출근/퇴근 打刻 두 가지뿐**이다.
//    · 근무 이력 · 급여 · 정정 · 프로필 · 다른 모듈 · 어드민 = 전부 불가(정상 세션 필요)
//    · middleware 의 보호 경로는 이 기능 때문에 넓히지 않는다
//    · 신원 대체는 `resolveTrustedDevice()` 를 호출하는 근태 打刻 경로 안에서만 일어난다
//    · GPS 필수 + 사이트 반경 검증은 그대로다 → 쿠키만으로 현장 밖에서 打刻할 수 없다
//
// 원문 토큰은 쿠키에만 있고 DB 에는 sha256 해시만 둔다.
// 참고: docs/product/24-attendance-workflow.md → "Trusted Device".

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type DeviceRow = Database["public"]["Tables"]["attendance_trusted_devices"]["Row"];

export const TRUSTED_DEVICE_COOKIE = "stayops_att_device";
/** 슬라이딩 만료 — 쓸 때마다 다시 180일. 반년간 한 번도 안 쓰면 자동으로 죽는다. */
export const TRUSTED_DEVICE_DAYS = 180;
/** 쿠키를 근태 경로에만 실어 보낸다 — 다른 화면 요청에는 아예 붙지 않는다. */
const COOKIE_PATH = "/mobile/attendance";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function expiryFromNow(): Date {
  return new Date(Date.now() + TRUSTED_DEVICE_DAYS * 86_400_000);
}

/**
 * UA 에서 관리자 목록에 보여줄 최소한의 라벨만 뽑는다 ("iPhone · Safari").
 * 원본 UA 는 보관하지 않는다 — 기기 식별에 필요한 만큼만 남긴다.
 */
export function deviceLabelFrom(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const platform = /iPhone|iPad|iPod/i.test(userAgent)
    ? "iPhone"
    : /Android/i.test(userAgent)
      ? "Android"
      : /Macintosh/i.test(userAgent)
        ? "Mac"
        : /Windows/i.test(userAgent)
          ? "Windows"
          : null;
  // 순서 주의: Edge/Chrome 도 "Safari" 를 UA 에 달고 다닌다.
  const browser = /EdgA?\//i.test(userAgent)
    ? "Edge"
    : /CriOS|Chrome/i.test(userAgent)
      ? "Chrome"
      : /FxiOS|Firefox/i.test(userAgent)
        ? "Firefox"
        : /Safari/i.test(userAgent)
          ? "Safari"
          : null;
  const parts = [platform, browser].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type TrustedDeviceIdentity = {
  userId: string;
  userName: string;
  organizationId: string;
  deviceId: string;
};

/**
 * 요청에 실린 기기 쿠키로 신원을 확인한다. 유효하지 않으면(없음/폐기/만료/멤버십 비활성) null.
 *
 * 호출하는 쪽이 반드시 지켜야 할 것: 이 결과는 **근태 打刻에만** 쓴다. 다른 어떤 권한 판단에도
 * 쓰지 말 것. 조직 스코프와 GPS/반경 검증은 호출부에서 그대로 수행한다.
 */
export async function resolveTrustedDevice(): Promise<TrustedDeviceIdentity | null> {
  const jar = await cookies();
  const raw = jar.get(TRUSTED_DEVICE_COOKIE)?.value?.trim();
  if (!raw) return null;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("attendance_trusted_devices")
    .select("*")
    .eq("token_hash", hashToken(raw))
    .maybeSingle();
  const device = data as DeviceRow | null;
  if (error || !device) return null;
  if (device.revoked_at) return null;
  if (new Date(device.expires_at).getTime() <= Date.now()) return null;

  // 재직 중인 조직 멤버여야 한다. 퇴사/정지 처리된 사람의 기기는 즉시 무효가 된다.
  const membership = await service
    .from("memberships")
    .select("status")
    .eq("organization_id", device.organization_id)
    .eq("user_id", device.user_id)
    .maybeSingle();
  const status = (membership.data as { status: string } | null)?.status;
  if (membership.error || status !== "active") return null;

  // 진입 화면이 "○○○님으로 기록됩니다" 를 보여줘야 다른 사람으로 잘못 찍히는 걸 막을 수 있다.
  const { data: profile } = await service
    .from("profiles")
    .select("name")
    .eq("id", device.user_id)
    .maybeSingle();

  return {
    userId: device.user_id,
    userName: (profile as { name: string } | null)?.name ?? "",
    organizationId: device.organization_id,
    deviceId: device.id,
  };
}

/**
 * 打刻에 성공한 뒤 이 기기를 기억한다(또는 만료를 연장한다).
 *
 * 서버 액션에서만 호출한다 — Server Component 는 쿠키를 쓸 수 없다.
 * 같은 기기에서 다른 사람이 로그인해 打刻하면 기존 자격증명을 폐기하고 새로 발급한다
 * (기기가 이전 사용자로 남아 있으면 안 된다).
 */
export async function rememberTrustedDevice(params: {
  userId: string;
  organizationId: string;
  userAgent: string | null;
}): Promise<void> {
  const jar = await cookies();
  const service = getSupabaseServiceClient();
  const existingRaw = jar.get(TRUSTED_DEVICE_COOKIE)?.value?.trim();
  const expiresAt = expiryFromNow();

  if (existingRaw) {
    const { data } = await service
      .from("attendance_trusted_devices")
      .select("*")
      .eq("token_hash", hashToken(existingRaw))
      .maybeSingle();
    const device = data as DeviceRow | null;
    const sameUser =
      device && !device.revoked_at && device.user_id === params.userId &&
      device.organization_id === params.organizationId;

    if (sameUser) {
      // 슬라이딩 연장 — 토큰은 그대로 두고 만료만 민다.
      await service
        .from("attendance_trusted_devices")
        .update({
          last_used_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .eq("id", device.id);
      writeCookie(jar, existingRaw, expiresAt);
      return;
    }

    if (device && !device.revoked_at) {
      // 기기 주인이 바뀌었다 → 이전 자격증명을 끊는다.
      await service
        .from("attendance_trusted_devices")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", device.id);
    }
  }

  const token = randomBytes(32).toString("base64url");
  const { error } = await service.from("attendance_trusted_devices").insert({
    organization_id: params.organizationId,
    user_id: params.userId,
    token_hash: hashToken(token),
    device_label: deviceLabelFrom(params.userAgent),
    expires_at: expiresAt.toISOString(),
  });
  // 기억에 실패해도 打刻 자체는 이미 성공했다 — 다음 번에 다시 시도된다.
  if (error) return;

  writeCookie(jar, token, expiresAt);
}

type CookieJar = Awaited<ReturnType<typeof cookies>>;

function writeCookie(jar: CookieJar, token: string, expiresAt: Date) {
  jar.set(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

/** 로그아웃 시 호출 — 쿠키를 지우고 DB 기록도 폐기한다. */
export async function forgetTrustedDevice(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(TRUSTED_DEVICE_COOKIE)?.value?.trim();
  jar.delete({ name: TRUSTED_DEVICE_COOKIE, path: COOKIE_PATH });
  if (!raw) return;
  try {
    await getSupabaseServiceClient()
      .from("attendance_trusted_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hashToken(raw))
      .is("revoked_at", null);
  } catch {
    // 쿠키는 이미 지웠으므로 이 기기에서는 더 이상 쓸 수 없다.
  }
}

// ── 관리자 화면 ─────────────────────────────────────────────────────────────

export type TrustedDeviceVM = {
  id: string;
  userId: string;
  userName: string;
  deviceLabel: string | null;
  /** ISO. */
  lastUsedAt: string;
  expiresAt: string;
};

/** 조직의 살아 있는(미폐기·미만료) 기억된 기기, 최근 사용순. */
export async function listTrustedDevices(organizationId: string): Promise<TrustedDeviceVM[]> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("attendance_trusted_devices")
    .select("*")
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("last_used_at", { ascending: false });
  if (error) return [];

  const rows = (data ?? []) as DeviceRow[];
  if (rows.length === 0) return [];

  const names = new Map<string, string>();
  const { data: profiles } = await service
    .from("profiles")
    .select("id, name")
    .in("id", [...new Set(rows.map((r) => r.user_id))]);
  for (const p of (profiles ?? []) as Array<{ id: string; name: string }>) {
    names.set(p.id, p.name);
  }

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: names.get(row.user_id) ?? "—",
    deviceLabel: row.device_label,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  }));
}

/** 관리자 해지. 조직 스코프로 제한해서 다른 조직 기기를 건드릴 수 없게 한다. */
export async function revokeTrustedDevice(
  organizationId: string,
  deviceId: string,
): Promise<boolean> {
  const { error } = await getSupabaseServiceClient()
    .from("attendance_trusted_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", deviceId)
    .eq("organization_id", organizationId)
    .is("revoked_at", null);
  return !error;
}
