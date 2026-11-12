import { AdminShell } from "@/components/shell/admin-shell";
import { LostFoundConsole } from "@/components/admin/lost-found/lost-found-console";
import { getAdminLostFound } from "@/lib/admin-lost-found";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { requestLiveSources } from "@/lib/live-sources";

// Admin · 분실물 — 보관 중 / 반환 / 폐기 내역 / 전체 기록 console (화이트 리디자인 2026-10-14). Claude Design
// 핸드오프를 2026-07-16 에 이식했고 같은 날 실제 데이터(lost_items + 연결된 예약)에 연결함. 참고:
// docs/product/09-lost-found-workflow.md.
export default async function AdminLostFoundPage({ searchParams }: { searchParams: Promise<{ item?: string | string[] }> }) {
  const session = await requireAdminPageSession({ nextPath: "/admin/lost-found" });
  const query = await searchParams;
  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);

  const { items, loadError } = await getAdminLostFound(session, dictionary.cleaning.buildingLabels);
  // `?item=` — 손님 메시지 대화의 업무 줄에서 열 때 그 분실물 패널을 바로 연다(6단계, 2026-11-13). 목록에 없는 id 는 무시.
  const itemRaw = Array.isArray(query.item) ? query.item[0] : query.item;
  const initialSelectedId = itemRaw && items.some((i) => i.id === itemRaw) ? itemRaw : null;

  return (
    <AdminShell activeItem="lost-found" title={dictionary.lostFound.adminTitle}>
      <LiveRefresh sources={requestLiveSources(session.organization.id)} />
      {/* 처리 단추는 모바일과 같은 키(`lost_found.handle`)가 있을 때만 — 서버 액션이 다시 본다(2026-11-10). */}
      <LostFoundConsole
        canHandle={session.capabilities.includes("lost_found.handle")}
        deleteAccess={{ canDeleteAny: session.capabilities.includes("request.delete_any"), userId: session.user.id }}
        initialSelectedId={initialSelectedId}
        locale={locale}
        items={items}
        loadError={loadError}
      />
    </AdminShell>
  );
}
