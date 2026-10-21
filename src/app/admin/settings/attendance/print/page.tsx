import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/admin-session";
import { attendanceQrLinkState, buildAttendanceQrValue } from "@/lib/attendance-qr";
import { getAttendanceSiteQrOverview } from "@/lib/attendance-sites";
import { getDictionary } from "@/lib/i18n";
import { hasOrganizationContext } from "@/lib/session";
import { PrintTrigger } from "./print-trigger";
import "./print.css";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Admin · 출퇴근 QR 인쇄 시트 (2026-07-31).
//
// 현장에 붙일 물건을 뽑는 화면이라 어드민 셸을 쓰지 않는다 — 사이드바·헤더가 인쇄에 섞이면 안 된다.
// 카드 한 장 = 현장 하나, 80×80mm 정사각. A4 한 장에 6장이 들어가고 자르는 선을 넣어 둔다.
//
// 담는 것은 **QR 과 현장 이름뿐**이다. 벽에 붙는 인쇄물에 설명 문구가 길면 지저분하고, 어차피
// 찍으면 앱이 안내한다. 이름은 `print_name`(주로 영문), 비어 있으면 `name` 으로 폴백한다.
//
// 카메라로 열리지 않는 QR(기준 주소 미설정/로컬)은 **인쇄 대상에서 제외**한다 — 붙여도 동작하지
// 않는 종이를 뽑는 것이 이 화면의 최악의 실패다. 대신 화면 상단에 왜 빠졌는지 알린다.
// See docs/product/24-attendance-workflow.md → "QR 인쇄".
export default async function AttendanceQrPrintPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  if (!session.capabilities.includes("attendance.settings") || !hasOrganizationContext(session)) {
    redirect("/admin/settings?error=forbidden");
  }

  const params = (await searchParams) ?? {};
  const settings = getDictionary(session.user.preferredLanguage).admin.settings;
  const onlySiteId = firstParam(params.site) ?? "";

  const rows = await getAttendanceSiteQrOverview(session.organization.id);
  const scoped = rows.filter(
    (row) => row.site.is_active && (!onlySiteId || row.site.id === onlySiteId),
  );

  const cards = await Promise.all(
    scoped.map(async (row) => {
      if (!row.token) return { id: row.site.id, name: row.site.name, svg: null, skipped: "none" as const };
      const value = buildAttendanceQrValue(row.token.token);
      if (attendanceQrLinkState(value) !== "ok") {
        return { id: row.site.id, name: row.site.name, svg: null, skipped: "unreachable" as const };
      }
      return {
        id: row.site.id,
        name: (row.site.print_name ?? "").trim() || row.site.name,
        svg: await QRCode.toString(value, { type: "svg", margin: 0, width: 400 }),
        skipped: null,
      };
    }),
  );

  const printable = cards.filter((card) => card.svg);
  const skipped = cards.filter((card) => !card.svg);

  return (
    <main className="qrsheet">
      <PrintTrigger
        disabled={printable.length === 0}
        label={printable.length === 0 ? settings.attendancePrintEmpty : settings.attendancePrintCta}
      />

      {skipped.length > 0 ? (
        <div className="qrsheet__warn">
          <b>{settings.attendancePrintExcluded.replace("{n}", String(skipped.length))}</b>
          <ul>
            {skipped.map((card) => (
              <li key={card.id}>
                {card.name} —{" "}
                {card.skipped === "none"
                  ? settings.attendancePrintExcludedNoQr
                  : settings.attendancePrintExcludedUnreachable}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="qrsheet__grid">
        {printable.map((card) => (
          <section className="qrcard" key={card.id}>
            <div className="qrcard__q" dangerouslySetInnerHTML={{ __html: card.svg as string }} />
            <div className="qrcard__n">{card.name}</div>
          </section>
        ))}
      </div>
    </main>
  );
}
