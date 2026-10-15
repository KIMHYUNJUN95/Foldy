import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import { BoardReportsConsole } from "@/components/admin/board-reports/board-reports-console";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { canModerateBoard, listPendingBoardReports } from "@/lib/board-moderation";
import { getDictionary, localizedNavigationLabels } from "@/lib/i18n";

// Admin · 게시판 신고 (2026-10-06, 앱 출시 준비 B4 · 2026-10-15 화이트 리디자인). 대기 신고 표 + 우측 상세 패널에서
// 문제없음으로 닫기 / 휴지통 → 삭제.
// 처리 권한 = `board.moderate`. 모바일 `/mobile/board/reports` 와 같은 데이터 · 같은 서버 액션.
// docs/product/23-board-workflow.md §12-C
export default async function AdminBoardReportsPage() {
  const session = await requireAdminPageSession({ nextPath: "/admin/board-reports" });
  if (!canModerateBoard(session)) redirect("/admin");

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const reports = await listPendingBoardReports(session);

  return (
    <AdminShell activeItem="board-reports" title={localizedNavigationLabels.admin.boardReports[locale]}>
      <BoardReportsConsole copy={dictionary.board} reports={reports} w={dictionary.boardReportsWhite} />
    </AdminShell>
  );
}

