"use server";

// 근태 — GPS + QR 출근 / 퇴근 핵심(Step 3) + 휴게 추적(Step 4).
//
// 서버 액션 하나가 근무자 촬영 화면의 출근/퇴근을 처리하고, 둘이 더 홈 화면의 휴게
// 시작/종료를 처리한다. 검증은 전부 서버에서 한다(인증 + 조직, QR 토큰, GPS 대 반경,
// 열린 세션 + 열린 휴게 규칙). 출근/퇴근 시도는 성공이든 실패든
// `attendance_attempt_logs` 에 기록한다. 쓰기는 service-role 클라이언트를 쓴다(RLS 가 인증된 사용자의
// 직접 쓰기를 막는다. docs/engineering/05-rls-permissions.md 참고). PWA 의 활성 방식은 `gps_qr` 뿐이고
// Wi-Fi 는 여기서 켜지 않는다.
//
// 이 단계에 없는 것: 정정 요청, 급여, 알림.

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import {
  rememberTrustedDevice,
  resolveTrustedDevice,
} from "@/lib/attendance-trusted-device";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMemberIdsWithCapability } from "@/lib/attendance-review";
import { notifyAttendanceAdmins } from "@/lib/notifications/create";
import { bestEffortWrite } from "@/lib/db-write-guard";
import { storagePathFromPublicUrl } from "@/lib/storage-url-guard";
import { resolveClockOutAfterClockIn, tokyoWallClockInstant } from "@/lib/attendance-clock";
import {
  ATTENDANCE_CORRECTION_PENDING_STATUSES,
  ATTENDANCE_CORRECTION_REASONS,
  ATTENDANCE_CORRECTION_MAX_IMAGES,
  type AttendanceActionType,
  type AttendanceCorrectionReason,
  type AttendanceFailureReason,
  type AttendanceQrTokenRow,
  type AttendanceSiteRow,
  type AttendanceSessionRow,
  isStaleOpenSession,
} from "@/lib/attendance";

type AttendanceSiteWithProperty = AttendanceSiteRow & {
  properties: {
    display_name_ko: string | null;
    display_name_ja: string | null;
    display_name_en: string | null;
  } | null;
};

function localizedSiteName(site: AttendanceSiteWithProperty, locale: string): string {
  const p = site.properties;
  if (p) {
    if (locale === "ja" && p.display_name_ja) return p.display_name_ja;
    if (locale === "en" && p.display_name_en) return p.display_name_en;
    if (p.display_name_ko) return p.display_name_ko;
  }
  return site.name;
}

export type AttendanceScanMode = "in" | "out";

export type AttendanceScanInput = {
  mode: AttendanceScanMode;
  /** 현장 QR 에서 읽은 원문 토큰 문자열(스캔 결과가 없으면 null). */
  token: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  /** 클라이언트가 GPS 를 전혀 얻지 못했을 때 설정한다. */
  gpsError: "denied" | "unavailable" | null;
  userAgent?: string | null;
};

export type AttendanceScanSuccess = {
  ok: true;
  kind: AttendanceScanMode;
  siteName: string;
  atIso: string;
  timeLabel: string;
  method: "gps_qr";
  /** 이 조직에서 이 사람의 첫 출근이면 true — 결과 화면이 「첫 출근을 환영해요」를 한 번만 보여 준다(2026-10-14). */
  firstEver?: boolean;
};

export type AttendanceScanFailure = {
  ok: false;
  reason: "gps" | "radius" | "qr" | "open_session" | "no_session" | "open_break" | "stale_session" | "month_finalized" | "error";
  siteName?: string;
  distanceMeters?: number;
  radiusMeters?: number;
  /** `stale_session` — 퇴근을 안 찍고 날짜가 넘어간 근무(이번 퇴근 시도에서 `abandoned` 로 넘어감). 정정 요청 링크용. */
  staleSessionId?: string;
  staleDate?: string;
};

export type AttendanceScanResult = AttendanceScanSuccess | AttendanceScanFailure;

/** 시각이 속한 도쿄 달력 날짜(YYYY-MM-DD) — 운영 날짜 경계(Asia/Tokyo). */
function tokyoDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Asia/Tokyo 기준 HH:mm. UI 의 성공 요약에 쓴다. */
function tokyoTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** 두 위경도 사이의 대원 거리(미터, haversine). */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000; // 지구 반지름(m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function submitAttendanceScan(
  input: AttendanceScanInput,
): Promise<AttendanceScanResult> {
  const session = await getCurrentAppSession();
  const hasSession = Boolean(session && hasOrganizationContext(session));

  // 세션이 없으면 "기억된 기기" 로 신원을 확인한다. 아이폰에서 건물 QR 을 기본 카메라로 찍으면
  // Safari 로 열리는데, iOS 는 PWA 와 Safari 의 저장소가 분리돼 로그인이 공유되지 않기 때문이다.
  //
  // ⚠ 이 대체 신원은 **여기(출근/퇴근 打刻)에서만** 허용된다. 다른 어떤 화면·액션도 이 경로로
  //   권한을 얻지 않는다. GPS 필수 + 사이트 반경 검증은 아래에서 그대로 수행되므로, 쿠키만으로
  //   현장 밖에서 打刻할 수는 없다. See src/lib/attendance-trusted-device.ts.
  const trusted = hasSession ? null : await resolveTrustedDevice();
  if (!hasSession && !trusted) {
    return { ok: false, reason: "error" };
  }

  const organizationId = hasSession ? session!.organization.id : trusted!.organizationId;
  const userId = hasSession ? session!.user.id : trusted!.userId;
  const locale = (hasSession ? session!.user.preferredLanguage : null) ?? "ko";
  const service = getSupabaseServiceClient();
  const actionType: AttendanceActionType = input.mode === "in" ? "clock_in" : "clock_out";
  const deviceInfo = { userAgent: input.userAgent ?? null };

  async function logAttempt(args: {
    success: boolean;
    failureReason: AttendanceFailureReason | null;
    resolvedSiteId: string | null;
  }) {
    await bestEffortWrite(
      "attendance_attempt_logs: insert",
      service.from("attendance_attempt_logs").insert({
          organization_id: organizationId,
          user_id: userId,
          action_type: actionType,
          method: "gps_qr",
          success: args.success,
          failure_reason: args.failureReason,
          resolved_site_id: args.resolvedSiteId,
          latitude: input.latitude,
          longitude: input.longitude,
          accuracy_meters: input.accuracy,
          device_info: deviceInfo,
        })
    );
  }

  // 1) QR 토큰이 있어야 하고 이 조직의 활성 토큰이어야 한다.
  if (!input.token) {
    await logAttempt({ success: false, failureReason: "qr_scan_failed", resolvedSiteId: null });
    return { ok: false, reason: "qr" };
  }

  const tokenRes = await service
    .from("attendance_qr_tokens")
    .select("*")
    .eq("token", input.token)
    .eq("is_active", true)
    .maybeSingle();
  const tokenRow = tokenRes.data as AttendanceQrTokenRow | null;
  if (tokenRes.error || !tokenRow || tokenRow.organization_id !== organizationId) {
    await logAttempt({ success: false, failureReason: "qr_invalid", resolvedSiteId: null });
    return { ok: false, reason: "qr" };
  }

  // 2) 토큰이 가리키는 사업장을 찾는다. 같은 조직에 있고 활성이어야 한다.
  const siteRes = await service
    .from("attendance_sites")
    .select("*, properties(display_name_ko, display_name_ja, display_name_en)")
    .eq("organization_id", organizationId)
    .eq("id", tokenRow.site_id)
    .maybeSingle();
  const site = siteRes.data as AttendanceSiteWithProperty | null;
  if (siteRes.error || !site || !site.is_active) {
    await logAttempt({ success: false, failureReason: "qr_invalid", resolvedSiteId: tokenRow.site_id });
    return { ok: false, reason: "qr" };
  }

  // 3) 세션 상태 선행 검증 (2026-07-31).
  //
  // 열린 근무가 있는지 / 없는지는 **위치와 무관한 사실**이다. 예전에는 GPS·반경을 먼저 보느라,
  // 이미 출근한 사람이 다른 현장 QR 을 찍으면 "허용 범위 밖"이라고 안내했다. 그 안내를 믿고
  // 현장 안으로 걸어 들어가 다시 찍어도 결과는 같다(이미 출근 중이므로). 사용자를 헛걸음시키는
  // 안내라서, 위치와 무관하게 이미 결정된 실패는 여기서 먼저 돌려준다.
  const openSessionRes = await service
    .from("attendance_sessions")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();
  let openSession = openSessionRes.data as AttendanceSessionRow | null;

  // 지난 운영일의 미퇴근은 **오늘 출근을 막지 않는다**(2026-08-04).
  //
  // 열린 근무는 사용자당 하나인데 그 제약이 날짜를 보지 않아서, 어제 퇴근을 깜빡한 것 하나가
  // 오늘 현장에 나온 사람의 출근을 통째로 막고 있었다(실제로 20일간 막힌 사례). 기록이 지저분한
  // 것보다 일을 시작하지 못하는 쪽이 훨씬 나쁘다. 그래서 지난 운영일 세션은 `abandoned` 로 옮기고
  // 진행한다.
  //
  // `clock_out_at` 은 채우지 않는다 — 시각을 추측하면 그 값이 그대로 급여가 된다. 대신 월 마감
  // 판정이 `abandoned` 를 미해소로 세므로, 관리자가 정리하기 전에는 그 달을 닫을 수 없다.
  //
  // 퇴근도 같다(2026-10-21) — 근무는 자정을 넘기지 않으므로, 지난 운영일의 근무를 지금 시각으로 닫으면
  // 며칠짜리 근무가 된다(실제 866시간). 퇴근 시각은 정정 요청으로 받는다.
  let staleSession: AttendanceSessionRow | null = null;
  if (openSession && isStaleOpenSession(openSession.operating_date, tokyoDate(new Date().toISOString()))) {
    staleSession = openSession;
    const abandoned = await service
      .from("attendance_sessions")
      .update({ status: "abandoned", abandoned_at: new Date().toISOString() })
      .eq("id", openSession.id)
      .eq("status", "open"); // 동시 요청이 먼저 닫았으면 아무것도 하지 않는다.
    // 전환에 실패해도 출근을 막지 않는다 — 아래 insert 가 유니크 위반으로 걸러 준다.
    if (!abandoned.error) openSession = null;
  }

  if (input.mode === "out" && staleSession) {
    await logAttempt({ success: false, failureReason: null, resolvedSiteId: site.id });
    return {
      ok: false,
      reason: "stale_session",
      siteName: localizedSiteName(site, locale),
      staleSessionId: staleSession.id,
      staleDate: staleSession.operating_date,
    };
  }

  if (input.mode === "in") {
    // 한 사람당 열린 근무는 하나다(같은 운영일 기준).
    if (openSession) {
      await logAttempt({ success: false, failureReason: "open_session_exists", resolvedSiteId: site.id });
      return { ok: false, reason: "open_session", siteName: localizedSiteName(site, locale) };
    }
  } else {
    if (openSessionRes.error || !openSession) {
      // "열린 근무 없음"에 해당하는 failure_reason enum 값이 없어 reason 은 null 로 기록한다.
      await logAttempt({ success: false, failureReason: null, resolvedSiteId: site.id });
      return { ok: false, reason: "no_session", siteName: localizedSiteName(site, locale) };
    }
    // 원칙: 휴게가 열려 있으면 퇴근을 막는다. 휴게를 자동으로 닫지 않는다.
    const openBreakRes = await service
      .from("attendance_breaks")
      .select("id")
      .eq("session_id", openSession.id)
      .is("ended_at", null)
      .maybeSingle();
    if (openBreakRes.data) {
      await logAttempt({ success: false, failureReason: "open_break_blocks_clock_out", resolvedSiteId: site.id });
      return { ok: false, reason: "open_break", siteName: localizedSiteName(site, locale) };
    }
  }

  // 3-1) 마감된 달에는 打刻하지 않는다(2026-10-26). 마감 스냅숏이 급여 금액으로 굳어 있어서, 그 달에 근무가
  // 더 생기면 마감 금액과 기록이 어긋난다. 관리자가 마감을 풀어야 기록할 수 있다.
  // 출근만 막는다 — 이미 시작한 근무의 퇴근까지 막으면 그 근무가 다음 날 abandoned 로 남아 정정만 늘어난다.
  if (input.mode === "in") {
    const ym = tokyoDate(new Date().toISOString()).slice(0, 7);
    const finalized = await service
      .from("attendance_month_snapshots")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("target_month", `${ym}-01`)
      .eq("status", "finalized")
      .limit(1);
    if ((finalized.data ?? []).length > 0) {
      await logAttempt({ success: false, failureReason: null, resolvedSiteId: site.id });
      return { ok: false, reason: "month_finalized", siteName: localizedSiteName(site, locale) };
    }
  }

  // 4) GPS 는 필수.
  if (input.gpsError || input.latitude == null || input.longitude == null) {
    await logAttempt({
      success: false,
      failureReason: input.gpsError === "denied" ? "gps_denied" : "gps_unavailable",
      resolvedSiteId: site.id,
    });
    return { ok: false, reason: "gps", siteName: localizedSiteName(site, locale) };
  }

  // 5) GPS 가 사업장의 허용 반경 안이어야 한다.
  const dist = distanceMeters(site.latitude, site.longitude, input.latitude, input.longitude);
  if (dist > site.allowed_radius_meters) {
    await logAttempt({ success: false, failureReason: "outside_radius", resolvedSiteId: site.id });
    return {
      ok: false,
      reason: "radius",
      siteName: localizedSiteName(site, locale),
      distanceMeters: Math.round(dist),
      radiusMeters: site.allowed_radius_meters,
    };
  }

  const nowIso = new Date().toISOString();

  if (input.mode === "in") {
    // 열린 근무 검사는 위 3)에서 이미 끝났다.
    const insertRes = await service
      .from("attendance_sessions")
      .insert({
        organization_id: organizationId,
        user_id: userId,
        operating_date: tokyoDate(nowIso),
        status: "open",
        review_state: "normal",
        clock_in_at: nowIso,
        clock_in_site_id: site.id,
        clock_in_method: "gps_qr",
        clock_in_qr_token_id: tokenRow.id,
        clock_in_latitude: input.latitude,
        clock_in_longitude: input.longitude,
        clock_in_accuracy_meters: input.accuracy,
        clock_in_device_info: deviceInfo,
      })
      .select("id")
      .single();
    if (insertRes.error) {
      // 두 번 누른 출근이 거의 동시에 들어오면 열린 근무 유니크 인덱스가 두 번째를 막는다 — 오류가 아니라 「이미 출근 중」.
      if ((insertRes.error as { code?: string }).code === "23505") {
        await logAttempt({ success: false, failureReason: "open_session_exists", resolvedSiteId: site.id });
        return { ok: false, reason: "open_session", siteName: localizedSiteName(site, locale) };
      }
      await logAttempt({ success: false, failureReason: null, resolvedSiteId: site.id });
      return { ok: false, reason: "error", siteName: localizedSiteName(site, locale) };
    }

    await logAttempt({ success: true, failureReason: null, resolvedSiteId: site.id });
    // 打刻에 성공한 기기만 기억한다(또는 만료를 연장한다) — 실제로 현장에서 쓴 기기라는 증거가 있는 셈.
    await rememberTrustedDevice({ userId, organizationId, userAgent: input.userAgent ?? null });
    // 첫 출근 = 방금 넣은 것 말고 이 조직에 내 근무 기록이 없음. 세는 데 실패하면 평소 화면(false).
    const { count: sessionCount } = await service
      .from("attendance_sessions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("user_id", userId);
    return {
      ok: true,
      kind: "in",
      firstEver: sessionCount === 1,
      siteName: localizedSiteName(site, locale),
      atIso: nowIso,
      timeLabel: tokyoTimeLabel(nowIso),
      method: "gps_qr",
    };
  }

  // 퇴근: 열린 근무와 휴게 검사는 위 3)에서 끝났다. (타입 좁히기용 방어 — 여기 도달할 수 없다.)
  if (!openSession) {
    await logAttempt({ success: false, failureReason: null, resolvedSiteId: site.id });
    return { ok: false, reason: "no_session", siteName: localizedSiteName(site, locale) };
  }
  const open = openSession;

  // 자정을 넘긴 근무는 위에서 `stale_session` 으로 걸러졌다 — 여기 오는 근무는 모두 오늘 운영일이다.
  const updateRes = await service
    .from("attendance_sessions")
    .update({
      status: "completed",
      clock_out_at: nowIso,
      clock_out_site_id: site.id,
      clock_out_method: "gps_qr",
      clock_out_qr_token_id: tokenRow.id,
      clock_out_latitude: input.latitude,
      clock_out_longitude: input.longitude,
      clock_out_accuracy_meters: input.accuracy,
      clock_out_device_info: deviceInfo,
    })
    .eq("id", open.id)
    .eq("status", "open")
    .select("id");
  if (updateRes.error) {
    await logAttempt({ success: false, failureReason: null, resolvedSiteId: site.id });
    return { ok: false, reason: "error", siteName: localizedSiteName(site, locale) };
  }
  // 0행 = 같은 퇴근이 먼저 처리됐다(두 번 누름). 성공으로 기록하지 않는다.
  if (!updateRes.data || updateRes.data.length === 0) {
    await logAttempt({ success: false, failureReason: null, resolvedSiteId: site.id });
    return { ok: false, reason: "no_session", siteName: localizedSiteName(site, locale) };
  }

  await logAttempt({ success: true, failureReason: null, resolvedSiteId: site.id });

  await rememberTrustedDevice({ userId, organizationId, userAgent: input.userAgent ?? null });
  return {
    ok: true,
    kind: "out",
    siteName: localizedSiteName(site, locale),
    atIso: nowIso,
    timeLabel: tokyoTimeLabel(nowIso),
    method: "gps_qr",
  };
}

// ── 휴게 (Step 4) ──────────────────────────────────────────────────────────
// 휴게 시작/종료는 GPS/QR 근태 액션이 아니므로 `attendance_attempt_logs` 행이 없다(그 테이블의
// `method` 는 GPS 중심이고 필수다). `attendance_breaks` 행이 곧 기록이다. 정규직과 시급직에
// 같은 로직을 쓰고, 나중에 시급 계산에서만 기록된 휴게 시간을 뺀다.

export type BreakActionResult =
  | { ok: true }
  | { ok: false; reason: "no_session" | "already_on_break" | "no_open_break" | "error" };

/**
 * 조직 안에서 호출자의 열린 세션(status = 'open') id 하나를 찾는다. 없으면 null.
 * 지난 운영일의 열린 근무(퇴근 미기록)는 없는 것으로 본다 — 거기에 휴게를 붙이면 안 된다(`isStaleOpenSession`).
 */
async function getOpenSessionId(
  service: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const res = await service
    .from("attendance_sessions")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "open")
    .eq("operating_date", tokyoDate(new Date().toISOString()))
    .maybeSingle();
  const row = res.data as { id: string } | null;
  return res.error ? null : (row?.id ?? null);
}

/** 열린 세션에서 휴게를 시작한다. 열린 세션이 없거나 이미 휴게 중이면 실패한다. */
export async function startBreak(): Promise<BreakActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const service = getSupabaseServiceClient();

  const sessionId = await getOpenSessionId(service, session.user.id, session.organization.id);
  if (!sessionId) return { ok: false, reason: "no_session" };

  const openBreakRes = await service
    .from("attendance_breaks")
    .select("id")
    .eq("session_id", sessionId)
    .is("ended_at", null)
    .maybeSingle();
  if (openBreakRes.data) return { ok: false, reason: "already_on_break" };

  const ins = await (async () => {
    try {
      return await service.from("attendance_breaks").insert({
        organization_id: session.organization.id,
        session_id: sessionId,
        started_at: new Date().toISOString(),
      });
    } catch {
      return null;
    }
  })();
  if (!ins) return { ok: false, reason: "error" };
  if (ins.error) {
    if ((ins.error as { code?: string }).code === "23505")
      return { ok: false, reason: "already_on_break" };
    return { ok: false, reason: "error" };
  }

  revalidatePath("/mobile/attendance");
  return { ok: true };
}

/** 진행 중인 휴게를 끝낸다. 열린 세션이 없거나 열린 휴게가 없으면 실패한다. */
export async function endBreak(): Promise<BreakActionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const service = getSupabaseServiceClient();

  const sessionId = await getOpenSessionId(service, session.user.id, session.organization.id);
  if (!sessionId) return { ok: false, reason: "no_session" };

  const openBreakRes = await service
    .from("attendance_breaks")
    .select("id")
    .eq("session_id", sessionId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const openBreak = openBreakRes.data as { id: string } | null;
  if (openBreakRes.error || !openBreak) return { ok: false, reason: "no_open_break" };

  const upd = await service
    .from("attendance_breaks")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", openBreak.id)
    .is("ended_at", null);
  if (upd.error) return { ok: false, reason: "error" };

  revalidatePath("/mobile/attendance");
  return { ok: true };
}

// ── 정정 / 예외 요청 (Step 6) ─────────────────────────────────
// 사용자가 본인 기록(이번 달 또는 지난달 도쿄 기준만)의 정정을 요청한다. 요청은
// 값을 제안만 할 뿐 확정 세션은 절대 바꾸지 않는다. 관리자가 나중에 최종 값을 확정한다
// (Step 7). 세션에 연결된 요청과 세션 없는 예외 요청(예: 실패한
// 출근에서 낸 요청)을 지원한다. 본인만 + 월 범위를 서버에서 강제한다.

export type CreateCorrectionInput = {
  /** 원본 세션(본인 것). 세션과 무관한 예외 요청이면 null. */
  sessionId: string | null;
  reasonType: AttendanceCorrectionReason;
  memo: string | null;
  /** 기준 날짜와 합치는 희망 출근/퇴근 시각 "HH:mm"(도쿄). null = 미설정. */
  desiredInTime: string | null;
  desiredOutTime: string | null;
  /** 출근/퇴근 모두에 적용되는 희망 사업장 하나(디자인의 "출/퇴근 동일"). null = 미설정. */
  desiredSiteId: string | null;
  /**
   * 세션 없는 예외 요청의 근무 날짜 'YYYY-MM-DD'(도쿄). 세션이 있으면 무시하고 그 세션의 운영일을 쓴다.
   * null 이면 오늘. 오늘 이후 · 당월/전월 밖은 거절한다(2026-10-01).
   */
  targetDate?: string | null;
  imageUrls: string[];
};

export type CreateCorrectionResult =
  | { ok: true; id: string }
  | { ok: false; reason: "forbidden" | "out_of_range" | "invalid" | "error" };

/** 지금의 도쿄 YYYY-MM. */
function tokyoYearMonthNow(): string {
  return tokyoDate(new Date().toISOString()).slice(0, 7);
}

/** 주어진 YYYY-MM 바로 앞의 도쿄 YYYY-MM. */
function previousYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map((n) => Number(n));
  if (m <= 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

export type CancelCorrectionResult = { ok: true } | { ok: false; reason: "error" | "not_pending" };

/**
 * 정정 요청 철회 (2026-08-03, 마이그레이션 202608030001).
 *
 * 예전에는 한 번 낸 요청을 거둘 방법이 없어, 잘못 낸 요청이 관리자가 반려해 줄 때까지 대기 큐에
 * 남고 그 달의 근태 마감까지 막았다(`getFinalizationEligibility` 가 `requested|in_review` 를 센다).
 *
 * **본인 것만**, **아직 처리되지 않은 것만** 철회할 수 있다. service-role 쓰기라 RLS 가 막지
 * 않으므로 UPDATE 의 `.eq`/`.in` 조건이 유일한 경계다 — 관리자가 그 사이에 승인/반려했다면 0행이
 * 갱신되고 `not_pending` 으로 떨어진다(레이스 안전).
 */
export async function cancelAttendanceCorrectionRequest(
  requestId: string,
): Promise<CancelCorrectionResult> {
  const id = String(requestId ?? "").trim();
  if (!id) return { ok: false, reason: "error" };
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from("attendance_correction_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .eq("requested_by_user_id", session.user.id)
    .in("status", [...ATTENDANCE_CORRECTION_PENDING_STATUSES])
    .select("id");
  if (error) return { ok: false, reason: "error" };
  if (!data || (data as unknown[]).length === 0) return { ok: false, reason: "not_pending" };

  revalidatePath("/mobile/attendance");
  revalidatePath("/mobile/attendance/correction/status");
  revalidatePath("/mobile/attendance/history");
  return { ok: true };
}

const CORRECTION_IMAGE_BUCKET = "request-images";
const SAFE_STORAGE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * 정정 요청 사진 주소 검사(2026-10-26). 예전에는 화면이 보낸 주소를 그대로 저장해서 아무 외부 주소나
 * 다른 조직의 사진이 관리자 화면에 뜰 수 있었다. 업로더(`uploadRequestImages`, requestType
 * `attendance-corrections`)가 쓰는 모양 그대로 — 우리 Storage `request-images` 버킷의
 * `{조직}/attendance-corrections/{요청 id}/{파일}` — 만 받는다. 요청 id 는 화면이 한 번 제출할 때 만든 것이라
 * 서버가 모르므로 «한 칸짜리 안전한 이름»인지와, 한 요청의 사진이 모두 같은 요청 id 아래인지만 본다.
 */
function areOwnCorrectionImageUrls(urls: readonly string[], organizationId: string): boolean {
  let folder: string | null = null;
  for (const url of urls) {
    const path = storagePathFromPublicUrl(url, CORRECTION_IMAGE_BUCKET);
    if (!path) return false;
    const segs = path.split("/");
    if (segs.length !== 4) return false;
    const [org, kind, requestFolder, file] = segs;
    if (org !== organizationId || kind !== "attendance-corrections") return false;
    if (!SAFE_STORAGE_SEGMENT.test(requestFolder) || !SAFE_STORAGE_SEGMENT.test(file)) return false;
    if (folder !== null && folder !== requestFolder) return false;
    folder = requestFolder;
  }
  return true;
}

export async function createAttendanceCorrectionRequest(
  input: CreateCorrectionInput,
): Promise<CreateCorrectionResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  if (!ATTENDANCE_CORRECTION_REASONS.includes(input.reasonType)) {
    return { ok: false, reason: "invalid" };
  }
  const imageUrls = (input.imageUrls ?? []).slice(0, ATTENDANCE_CORRECTION_MAX_IMAGES);
  if (!areOwnCorrectionImageUrls(imageUrls, organizationId)) return { ok: false, reason: "invalid" };

  // 정정 대상 기준 날짜를 정하고, 연결된 세션이 있으면 본인 소유인지 확인한다.
  let baseDate: string;
  let sessionId: string | null = null;
  let sessionClockInAt: string | null = null;
  if (input.sessionId) {
    const res = await service
      .from("attendance_sessions")
      .select("id, user_id, operating_date, clock_in_at")
      .eq("organization_id", organizationId)
      .eq("id", input.sessionId)
      .maybeSingle();
    const row = res.data as {
      id: string;
      user_id: string;
      operating_date: string;
      clock_in_at: string | null;
    } | null;
    if (res.error || !row || row.user_id !== userId) return { ok: false, reason: "forbidden" };
    baseDate = row.operating_date;
    sessionId = row.id;
    sessionClockInAt = row.clock_in_at;
  } else {
    const today = tokyoDate(new Date().toISOString());
    const picked = input.targetDate?.trim() || null;
    if (picked && !/^\d{4}-\d{2}-\d{2}$/.test(picked)) return { ok: false, reason: "invalid" };
    // 아직 오지 않은 날의 근무는 정정할 것이 없다.
    if (picked && picked > today) return { ok: false, reason: "out_of_range" };
    baseDate = picked ?? today;
  }

  // 허용 구간: 이번 도쿄 달 + 지난달만.
  const ym = baseDate.slice(0, 7);
  const currentYm = tokyoYearMonthNow();
  if (ym !== currentYm && ym !== previousYearMonth(currentYm)) {
    return { ok: false, reason: "out_of_range" };
  }

  // 선택한 희망 사업장이 이 조직 것인지 검증한다(못 찾으면 버린다).
  let desiredSiteId: string | null = null;
  if (input.desiredSiteId) {
    const siteRes = await service
      .from("attendance_sites")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", input.desiredSiteId)
      .maybeSingle();
    if (siteRes.data) desiredSiteId = input.desiredSiteId;
  }

  const desiredClockInAt = tokyoWallClockInstant(baseDate, input.desiredInTime);
  const payload = {
    reason_type: input.reasonType,
    memo: input.memo?.trim() ? input.memo.trim() : null,
    desired_clock_in_at: desiredClockInAt,
    // 퇴근이 출근보다 앞서면 다음 날(야간 근무) — 관리자 수동 수정과 같은 규칙(`attendance-clock.ts`).
    desired_clock_out_at: resolveClockOutAfterClockIn(
      baseDate,
      input.desiredOutTime,
      desiredClockInAt ?? sessionClockInAt,
    ),
    desired_clock_in_site_id: desiredSiteId,
    desired_clock_out_site_id: desiredSiteId,
    image_urls: imageUrls,
    target_month: `${ym}-01`,
    // 세션 없는 요청만 날짜를 따로 가진다 — 세션이 있으면 그 세션의 운영일이 곧 날짜다.
    target_date: sessionId ? null : baseDate,
  };

  // 같은 대상으로 다시 제출하면 사용자의 아직 대기 중인 요청을 교체해야 하고, 쌓으면 안 된다.
  // 하루에 대기 행이 둘이면 근무자의 상태 화면(최신 1건)과
  // 월 마감 차단 건수(모든 행)가 서로 달랐고, 검토자에게도 상충하는 두 요청을
  // 처리하라고 보였다. 대체하면 행이 `requested` 로 돌아가고 남아 있던 검토 결과도 지운다.
  // 검토자가 보던 값이 더는 존재하지 않기 때문이다.
  let pendingQuery = service
    .from("attendance_correction_requests")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("requested_by_user_id", userId)
    .in("status", ["requested", "in_review"]);
  // 세션 없는 요청은 **같은 근무 날짜**끼리만 덮어쓴다 — 날짜를 고를 수 있게 된 뒤로(2026-10-01) 같은 달의
  // 다른 날 요청을 덮으면 앞 요청이 사라진다.
  pendingQuery = sessionId
    ? pendingQuery.eq("session_id", sessionId)
    : pendingQuery.is("session_id", null).eq("target_date", baseDate);
  const existingRes = await pendingQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const existing = existingRes.data as { id: string } | null;

  const submittedAt = new Date().toISOString();
  let requestId: string | null = null;
  let superseded = false;
  if (existing) {
    const upd = (await service
      .from("attendance_correction_requests")
      .update({
        ...payload,
        status: "requested",
        review_comment: null,
        reviewed_at: null,
        reviewed_by_user_id: null,
        updated_at: submittedAt,
      })
      .eq("id", existing.id)
      .eq("organization_id", organizationId)
      .eq("requested_by_user_id", userId)
      // 읽기와 쓰기 사이에 관리자가 요청을 처리해 버리는 경합을 막는다.
      .in("status", ["requested", "in_review"])
      .select("id")
      .maybeSingle()) as { data: { id: string } | null; error: { message: string } | null };
    if (upd.error) return { ok: false, reason: "error" };
    requestId = upd.data?.id ?? null;
    superseded = requestId != null;
  }

  if (!requestId) {
    const ins = (await service
      .from("attendance_correction_requests")
      .insert({
        organization_id: organizationId,
        session_id: sessionId,
        requested_by_user_id: userId,
        status: "requested",
        ...payload,
      })
      .select("id")
      .single()) as { data: { id: string } | null; error: { message: string } | null };
    if (ins.error || !ins.data) return { ok: false, reason: "error" };
    requestId = ins.data.id;
  }

  // 관리자 알림: owner + attendance_payroll_admin 에게(권한 있는 사람만, 요청자 본인은 제외).
  const adminIds = await getMemberIdsWithCapability(service, organizationId, "attendance.manage");
  await notifyAttendanceAdmins(service, {
    organizationId,
    recipientUserIds: adminIds,
    actorUserId: userId,
    // 재제출은 행 id 를 재사용하므로 중복 방지 키에 제출 시각이 들어간다. 그렇지 않으면
    // 다시 낸(값이 다른) 요청이 중복 알림으로 조용히 삼켜진다.
    dedupeBase: superseded
      ? `attendance_correction:${requestId}:${submittedAt}`
      : `attendance_correction:${requestId}`,
    href: "/mobile/attendance",
    sourceId: requestId,
    payload: {
      event: "correction_created",
      subjectUserId: userId,
      subjectName: session.user.name ?? null,
      correctionId: requestId,
    },
  });

  revalidatePath("/mobile/attendance");
  revalidatePath("/mobile/attendance/correction/status");
  revalidatePath("/mobile/attendance/history");
  return { ok: true, id: requestId };
}

// ── 18:30 열린 세션 알림 응답 (Step 14) ───────────────────────────
// 근무자가 도쿄 기준 하루 한 번 뜨는 열린 세션 안내에 답한다. `still_working` 은 그날 남은
// 시간 동안 안내를 끄고, `left_work` 는 자동 퇴근하지 않는다 — 클라이언트가 정정 흐름으로 보낸다.
// 본인만: 인증된 사용자 자신의 열린 세션에 기록한다.

export type ReminderResponse = "still_working" | "left_work";
export type ReminderResult =
  | { ok: true; sessionId: string | null }
  | { ok: false; reason: "no_session" | "error" };

export async function respondOpenSessionReminder(
  response: ReminderResponse,
): Promise<ReminderResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "error" };
  if (response !== "still_working" && response !== "left_work") return { ok: false, reason: "error" };
  const organizationId = session.organization.id;
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  const today = tokyoDate(new Date().toISOString());
  // 오늘 운영일의 열린 근무에만 답한다 — 지난 날 퇴근 미기록은 정정 요청 대상이다.
  const openRes = await service
    .from("attendance_sessions")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "open")
    .eq("operating_date", today)
    .maybeSingle();
  const open = openRes.data as { id: string } | null;
  if (!open) return { ok: false, reason: "no_session" };

  const up = await service
    .from("attendance_open_session_reminders")
    .upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        operating_date: today,
        response,
        responded_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id,operating_date" },
    );
  if (up.error) return { ok: false, reason: "error" };

  revalidatePath("/mobile/attendance");
  return { ok: true, sessionId: open.id };
}
