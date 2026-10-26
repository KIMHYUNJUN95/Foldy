import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// ─────────────────────────────────────────────────────────────────────────────
// 개발 전용: 로그인한 사용자의 고용 형태 + 시급을 심어 두어 개인 월 급여 화면
// (/mobile/attendance/pay) 이 앱 테스트 중 실제 숫자를 보이게 한다. 정식 owner/payroll_admin 의
// 고용 형태 + 시급 관리(Step 9)와 관리자 UI 는 보류된 웹 대시보드에 있고, 이것은
// ENABLE_LOCAL_DEV_TOOLS 로 막아 둔 로컬 테스트 편의 기능일 뿐이다.
//
// 사용법 (앱에 로그인한 상태에서):
//   GET /api/dev/attendance/seed-pay                 → hourly, ¥1200/h, effective 2020-01-01
//   GET /api/dev/attendance/seed-pay?rate=1500       → hourly, ¥1500/h
//   GET /api/dev/attendance/seed-pay?type=salaried   → salaried (no pay)
// 이 조직에서 호출자의 기존 이력 행을 교체한다 (테스트용 멱등).
// ─────────────────────────────────────────────────────────────────────────────

const EFFECTIVE_FROM = "2020-01-01";

function isLocalDevHost(host: string) {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
}

function getRequestHostname(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost
    ? (forwardedHost.split(",")[0]?.trim() ?? request.nextUrl.host)
    : (request.headers.get("host") ?? request.nextUrl.host);
  return host.split(":")[0] ?? request.nextUrl.hostname;
}

function ensureDevOnly(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (process.env.ENABLE_LOCAL_DEV_TOOLS !== "true") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!isLocalDevHost(getRequestHostname(request))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const blocked = ensureDevOnly(request);
  if (blocked) return blocked;

  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) {
    return NextResponse.json({ error: "no_org_context" }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const type = params.get("type") === "salaried" ? "salaried" : "hourly";
  const rate = Number(params.get("rate") ?? "1200");
  const hourlyRate = Number.isFinite(rate) && rate >= 0 ? rate : 1200;

  const service = getSupabaseServiceClient();
  const organizationId = session.organization.id;
  const userId = session.user.id;

  try {
    // 이 조직에서 이 사용자의 이력을 초기화(테스트 멱등성)한 뒤, 끝이 열린 구간 하나를 삽입한다.
    await service
      .from("employment_type_history")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", userId);
    await service
      .from("hourly_rate_history")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", userId);

    const empIns = await service.from("employment_type_history").insert({
      organization_id: organizationId,
      user_id: userId,
      employment_type: type,
      effective_from: EFFECTIVE_FROM,
      created_by_user_id: userId,
    });
    if (empIns.error) throw new Error(empIns.error.message);

    if (type === "hourly") {
      const rateIns = await service.from("hourly_rate_history").insert({
        organization_id: organizationId,
        user_id: userId,
        hourly_rate: hourlyRate,
        effective_from: EFFECTIVE_FROM,
        created_by_user_id: userId,
      });
      if (rateIns.error) throw new Error(rateIns.error.message);
    }

    return NextResponse.json({
      ok: true,
      employment_type: type,
      hourly_rate: type === "hourly" ? hourlyRate : null,
      effective_from: EFFECTIVE_FROM,
      note: "Seeded for the current user. Open /mobile/attendance/pay to view.",
    });
  } catch (error) {
    console.error("[dev/attendance/seed-pay] failed:", error);
    return NextResponse.json({ error: "seed_pay_failed" }, { status: 500 });
  }
}
