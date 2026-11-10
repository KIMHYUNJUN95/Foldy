import { AdminShell } from "@/components/shell/admin-shell";
import { MaintenanceConsole } from "@/components/admin/maintenance/maintenance-console";
import { getAdminMaintenance } from "@/lib/admin-maintenance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { requestLiveSources } from "@/lib/live-sources";

// Admin · 수리·점검 — 현황 보드 / 목록·이력 / 완료 콘솔. 디자인은 Claude Design
// 핸드오프(2026-07-14)에서 가져와 같은 날 실제 데이터(maintenance_reports + 연결된 예약/청소)에 연결했다.
// docs/product/08-maintenance-workflow.md → "2026-07-14 어드민 수리·점검 대시보드" 참고.
export default async function AdminMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; report?: string | string[] }>;
}) {
  const session = await requireAdminPageSession({ nextPath: "/admin/maintenance" });
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);

  const { reports, loadError } = await getAdminMaintenance(session, dictionary.cleaning.buildingLabels);

  // `?error=키` 배너 — 예전 상세 화면의 상태 폼이 쓰던 길(그 폼은 2026-11-10 에 지웠다). 옛 주소로 들어와도 안내는 뜬다.
  const query = await searchParams;
  const errorRaw = query?.error;
  const errorKey = Array.isArray(errorRaw) ? errorRaw[0] : errorRaw;
  const errorMessage = errorKey
    ? (dictionary.maintenance.errors[errorKey] ?? dictionary.maintenance.errors.save_failed)
    : null;

  // `?report=<id>` — 옛 상세 주소(`/admin/maintenance/[id]`)가 넘겨 준다. 그 건의 오른쪽 패널을 열고 시작한다.
  const reportRaw = Array.isArray(query?.report) ? query.report[0] : query?.report;
  const initialReportId = reportRaw && reports.some((r) => r.id === reportRaw) ? reportRaw : null;
  // 강제 완료 · 무효 = 모바일 상태 바꾸기와 같은 키(서버 액션이 다시 본다 — 여기는 단추를 숨기기만).
  const canHandle = session.capabilities.includes("maintenance_status_change");

  return (
    <AdminShell activeItem="maintenance" title={dictionary.maintenance.adminTitle}>
      <LiveRefresh sources={requestLiveSources(session.organization.id)} />
      {errorMessage ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
          {errorMessage}
        </div>
      ) : null}
      <MaintenanceConsole
        canHandle={canHandle}
        deleteAccess={{ canDeleteAny: session.capabilities.includes("request.delete_any"), userId: session.user.id }}
        initialReportId={initialReportId}
        locale={locale}
        loadError={loadError}
        reports={reports}
      />
    </AdminShell>
  );
}
