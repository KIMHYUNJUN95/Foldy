import { notFound, redirect } from "next/navigation";
import { MobileStaffDocDetail } from "@/components/mobile/users/mobile-staff-doc-detail";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { loadStaffDocumentRoster } from "@/lib/staff-documents/roster-server";
import { loadCurrentIdDocument } from "@/lib/staff-documents/server";
import { requireMobileUserManagement } from "../../gate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 모바일 사용자 관리 › 서류 › 한 사람(재류카드 R4, 2026-10-26). 서류가 있으면 확인 칸, 없거나 `?upload=1` 이면 대신 올리기.
 * 같은 조직 활성 멤버만(목록과 같은 기준). 사진 서명 URL 은 이 사람 것만, 올리기 화면에서는 만들지 않는다.
 */
export default async function MobileStaffDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await params;
  const sp = (await searchParams) ?? {};
  const upload = (Array.isArray(sp.upload) ? sp.upload[0] : sp.upload) === "1";
  const navBadgesPromise = getMobileNavBadges();
  const session = await requireMobileUserManagement(`/mobile/users/documents/${userId}`);
  if (session.organization.id === "platform" || !session.capabilities.includes("staff_documents.view")) redirect("/mobile/users");
  if (!UUID.test(userId)) notFound();
  const rows = await loadStaffDocumentRoster(session);
  const row = rows.find((r) => r.userId === userId);
  if (!row) notFound();
  const [doc, navBadges] = await Promise.all([
    row.doc ? loadCurrentIdDocument(session.organization.id, userId, { withPhotos: !upload }) : Promise.resolve(null),
    navBadgesPromise,
  ]);
  const locale = session.user.preferredLanguage;
  return (
    <MobileShell activeItem="users" badges={navBadges} title={getDictionary(locale).admin.users.console.tabDocs}>
      <MobileStaffDocDetail
        key={`${userId}:${upload ? "up" : "view"}`}
        row={row}
        doc={doc}
        upload={upload}
        locale={locale}
        confirmerName={session.user.name}
        isDeveloperViewer={session.user.role === "developer_super_admin"}
      />
    </MobileShell>
  );
}
