import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { runPayrollExport, type ExportScope } from "@/lib/attendance-export";

// ─────────────────────────────────────────────────────────────────────────────
// 개발 전용: 테스트용으로 마감분 전용 급여 내보내기 다운로드를 실행한다 (실제 owner/payroll_admin
// 내보내기 UI 는 보류된 웹 대시보드에 있다). 개발 환경 + ENABLE_LOCAL_DEV_TOOLS +
// 로컬 호스트에서만 열리며, 서버에서도 `runPayrollExport` 로 권한을 다시 확인한다 (owner / attendance_payroll_admin)
// — 개발 중에도 일반 사용자는 급여 데이터를 내보낼 수 없다.
//
// 사용법 (owner/급여 관리자로 로그인한 상태):
//   GET /api/dev/attendance/export?scope=monthly_bulk&ym=2026-06
//   GET /api/dev/attendance/export?scope=single_user&ym=2026-06&userId=<uuid>
// ─────────────────────────────────────────────────────────────────────────────

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
  const scope: ExportScope = params.get("scope") === "single_user" ? "single_user" : "monthly_bulk";
  const ym = params.get("ym") ?? "";
  const userId = params.get("userId") ?? undefined;

  const service = getSupabaseServiceClient();
  const result = await runPayrollExport(service, session.organization.id, session.user.id, {
    scope,
    ym,
    userId,
  });

  if (!result.ok) {
    const status = result.reason === "forbidden" ? 403 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
