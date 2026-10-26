import { redirect } from "next/navigation";
import { MobileStaffDocs } from "@/components/mobile/users/mobile-staff-docs";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import { getDictionary } from "@/lib/i18n";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { loadStaffDocumentRoster } from "@/lib/staff-documents/roster-server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { loadUsableInviteCount } from "@/lib/user-management-data";
import { requireMobileUserManagement } from "../gate";

/**
 * 모바일 사용자 관리 › 서류(재류카드 R4, 2026-10-26, 시안 M8bU3z… Docs-Phone · Docs-Fold · Docs-Tablet).
 * 문: 사용자 관리와 같은 문 + `staff_documents.view`(없으면 멤버 목록으로). 대시보드 `/admin/users/documents` 와 같은 데이터.
 * 태블릿 가로는 목록 + 한 사람 칸(`SplitList`). docs/product/41 「R4 구현」
 */
export default async function MobileStaffDocumentsPage() {
  const navBadgesPromise = getMobileNavBadges();
  const session = await requireMobileUserManagement("/mobile/users/documents");
  if (session.organization.id === "platform" || !session.capabilities.includes("staff_documents.view")) redirect("/mobile/users");
  const [rows, inviteCount, memberCount, navBadges] = await Promise.all([
    loadStaffDocumentRoster(session),
    loadUsableInviteCount(session),
    getSupabaseServiceClient()
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.organization.id)
      .then(({ count }) => count ?? null),
    navBadgesPromise,
  ]);
  const locale = session.user.preferredLanguage;
  return (
    <MobileShell activeItem="users" badges={navBadges} title={getDictionary(locale).admin.users.title} split>
      <SplitList detail="staffDocs">
        <MobileStaffDocs rows={rows} memberCount={memberCount} inviteCount={inviteCount} locale={locale} />
      </SplitList>
    </MobileShell>
  );
}
