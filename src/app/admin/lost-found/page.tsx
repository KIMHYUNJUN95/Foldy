import { AdminShell } from "@/components/shell/admin-shell";
import { LostFoundConsole } from "@/components/admin/lost-found/lost-found-console";
import { getAdminLostFound } from "@/lib/admin-lost-found";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";

// Admin · 분실물 — 보관 중 / 반환 / 폐기 내역 / 전체 기록 console (화이트 리디자인 2026-10-14). Claude Design
// 핸드오프를 2026-07-16 에 이식했고 같은 날 실제 데이터(lost_items + 연결된 예약)에 연결함. 참고:
// docs/product/09-lost-found-workflow.md.
export default async function AdminLostFoundPage() {
  const session = await requireAdminPageSession({ nextPath: "/admin/lost-found" });
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);

  const { items, loadError } = await getAdminLostFound(session, dictionary.cleaning.buildingLabels);

  return (
    <AdminShell activeItem="lost-found" title={dictionary.lostFound.adminTitle}>
      <LostFoundConsole locale={locale} items={items} loadError={loadError} />
    </AdminShell>
  );
}
