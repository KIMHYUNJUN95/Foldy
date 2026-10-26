import { redirect } from "next/navigation";
import { StaffDocsConsole, type StaffDocsSelection } from "@/components/admin/users/staff-docs-console";
import { AdminShell } from "@/components/shell/admin-shell";
import { requireAdminSession } from "@/lib/admin-session";
import { getDictionary } from "@/lib/i18n";
import { hasOrganizationContext } from "@/lib/session";
import { loadStaffDocumentRoster } from "@/lib/staff-documents/roster-server";
import { loadCurrentIdDocument } from "@/lib/staff-documents/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { actorCanOpenUserManagement } from "@/lib/user-management-access";
import { loadUsableInviteCount } from "@/lib/user-management-data";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 사용자 › 직원 서류(재류카드 R4, 2026-10-26, 시안 M8bU3z… Main · Upload-PC).
 * 문: 사용자 화면과 같은 문(개발자 · `user.manage`) + `staff_documents.view`. 권한이 없으면 사용자 목록으로 보낸다.
 * `?u=<userId>` = 오른쪽 패널, `&upload=1` = 대신 올리기(서류가 없으면 저절로). 사진 서명 URL 은 고른 사람 것만 만든다.
 * 모바일 `/mobile/users/documents` 와 같은 데이터(`loadStaffDocumentRoster`). docs/product/41 「R4 구현」
 */
export default async function AdminStaffDocumentsPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  if (!(await actorCanOpenUserManagement(session.user.id, session.user.role))) redirect("/admin");
  if (!hasOrganizationContext(session) || !session.capabilities.includes("staff_documents.view")) redirect("/admin/users");

  const params = (await searchParams) ?? {};
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const selectedId = first(params.u);
  const wantsUpload = first(params.upload) === "1";
  const dictionary = getDictionary(session.user.preferredLanguage);

  const [rows, inviteCount, memberCount] = await Promise.all([
    loadStaffDocumentRoster(session),
    loadUsableInviteCount(session),
    getSupabaseServiceClient()
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.organization.id)
      .then(({ count }) => count ?? null),
  ]);

  let selection: StaffDocsSelection | null = null;
  const row = selectedId && UUID.test(selectedId) ? rows.find((r) => r.userId === selectedId) : undefined;
  if (row) {
    const doc = row.doc ? await loadCurrentIdDocument(session.organization.id, row.userId, { withPhotos: !wantsUpload }) : null;
    selection = { userId: row.userId, mode: wantsUpload || !doc ? "upload" : "view", doc };
  }

  return (
    <AdminShell activeItem="users" title={dictionary.admin.users.title}>
      <StaffDocsConsole
        rows={rows}
        selection={selection}
        locale={session.user.preferredLanguage}
        confirmerName={session.user.name}
        isDeveloperViewer={session.user.role === "developer_super_admin"}
        memberCount={memberCount}
        inviteCount={inviteCount}
      />
    </AdminShell>
  );
}
