import { AdminShell } from "@/components/shell/admin-shell";
import { LinenReturnConsole } from "@/components/admin/linen-return/linen-console";
import {
  defaultRangeTokyo,
  getAdminLinenReturns,
} from "@/lib/admin-linen-returns";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { isValidIsoDate } from "@/lib/linen-returns";
import { getDictionary, getLocalizedText, localizedNavigationLabels } from "@/lib/i18n";

// Admin · 린넨 반품 — 사무실 기록 관리 콘솔. 현장(모바일)에서 등록된 반품 기록을 확인하고
// 수정 · 삭제한다. 신규 등록은 모바일 전용이므로 이 화면에는 등록 경로가 없다.
// 조회 기간은 URL 로 받아 서버에서 조직 스코프 쿼리로 좁힌다(기본 = 이번 달 Tokyo).
// 참고: docs/product/19-linen-defect-workflow.md → "Admin Dashboard — Linen Return Record Management".
export default async function AdminLinenReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [session, params] = await Promise.all([
    requireAdminPageSession({ nextPath: "/admin/linen-return" }),
    searchParams,
  ]);

  const locale = session.user.preferredLanguage;
  const fallback = defaultRangeTokyo();
  const from =
    typeof params.from === "string" && isValidIsoDate(params.from) ? params.from : fallback.from;
  const to = typeof params.to === "string" && isValidIsoDate(params.to) ? params.to : fallback.to;

  // 건물 표기는 청소·분실물·수리 콘솔과 같은 사전을 쓴다(모바일 린넨 화면과도 동일).
  const data = await getAdminLinenReturns(
    session,
    from,
    to,
    getDictionary(locale).cleaning.buildingLabels,
  );

  return (
    <AdminShell
      activeItem="linen-return"
      title={getLocalizedText(localizedNavigationLabels.admin.linenReturn, locale)}
    >
      <LinenReturnConsole
        data={data}
        defaultFrom={fallback.from}
        defaultTo={fallback.to}
        from={from <= to ? from : to}
        locale={locale}
        organizationId={session.organization.id}
        to={from <= to ? to : from}
      />
    </AdminShell>
  );
}
