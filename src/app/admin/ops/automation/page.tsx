import { AutomationConsole } from "@/components/admin/ops/automation-console";
import { AdminShell } from "@/components/shell/admin-shell";
import { getAutomationPageData } from "@/lib/automation/console-data";
import { getDictionary } from "@/lib/i18n";
import { opsNavId } from "@/lib/ops-admin";
import { requireOpsAdminPage } from "../ops-page-session";

/**
 * 자동화 관제실 — Slack 자동화(일일 운영 리포트 · 청소/셋팅 명단 · 취소 · 당일예약 · 실패 알림).
 *
 * 도메인 계약: docs/product/36-automation-control.md
 *
 * 보기는 `ops_admin.access`(이 문), 설정 · 발송은 `automation.manage`(서버 액션이 다시 본다).
 */
export const dynamic = "force-dynamic";

const LOCALE_TAG = { en: "en-US", ja: "ja-JP", ko: "ko-KR" } as const;

export default async function AutomationPage() {
  const session = await requireOpsAdminPage("automation");
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const data = await getAutomationPageData(session, locale);

  return (
    <AdminShell activeItem={opsNavId("automation")} title={dictionary.automation.title}>
      <AutomationConsole
        copy={dictionary.automation}
        data={data}
        locale={locale}
        localeTag={LOCALE_TAG[locale]}
        shared={dictionary.admin.shared}
      />
    </AdminShell>
  );
}
