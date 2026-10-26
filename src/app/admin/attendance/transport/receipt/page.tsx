import { CircleAlert } from "lucide-react";
import { TransportReceiptView } from "@/components/admin/attendance/transport-receipt-view";
import { getAdminTransportReceiptsForUser } from "@/lib/admin-attendance";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import "@/components/admin/admin-console.css";

// 직원 한 명의 한 달을 보는 데스크톱 마스터-디테일 영수증 검토 페이지. 교통비 패널의 버튼으로 들어온다.
// 권한 필요 + 조직 범위 (getAdminTransportReceiptsForUser 에서 강제).
// AdminShell 로 감싸지 않는다 — 자기 탭에서 여는 집중형 검토 화면이다.
export default async function TransportReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; user?: string }>;
}) {
  const params = await searchParams;

  const ym = typeof params.ym === "string" ? params.ym : "";
  const user = typeof params.user === "string" ? params.user : "";
  const backTo = `/admin/attendance/transport/receipt?ym=${encodeURIComponent(ym)}&user=${encodeURIComponent(user)}`;
  const session = await requireAdminPageSession({ nextPath: backTo });

  const locale = session.user.preferredLanguage;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const c = getDictionary(locale).admin.attendanceConsole;
  const data =
    ym && user ? await getAdminTransportReceiptsForUser(session, ym, user, localeTag) : null;

  if (!data) {
    return (
      <div className="adm" style={{ minHeight: "100dvh", background: "var(--bg)", padding: "48px 16px" }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <div className="card">
            <div className="state">
              <span className="state__ic empty">
                <span className="ic">
                  <CircleAlert />
                </span>
              </span>
              <div className="state__t">{c.trReceiptNotFoundTitle}</div>
              <div className="state__s">{c.trReceiptNotFoundBody}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <TransportReceiptView data={data} locale={locale} localeTag={localeTag} />;
}
