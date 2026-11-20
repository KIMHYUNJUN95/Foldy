import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// PC 신고 처리 — 메모 없는 신고 · 빈 화면 렌더 시험(게시판 unslop 2026-11-20). 시드에 없는 모양이라 화면으로 못 본 것을
// 실제로 그려 본다. 서버 액션은 막는다(그리기만 한다).
vi.mock("@/actions/board-moderation", () => ({ resolveBoardReport: vi.fn() }));

const { BoardReportsConsole, ReportPanel } = await import("@/components/admin/board-reports/board-reports-console");
const { getDictionary } = await import("@/lib/i18n");
type Report = Parameters<typeof ReportPanel>[0]["report"];

const report = (noteItems: Report["noteItems"]): Report => ({
  key: "comment:c1",
  targetType: "comment",
  postId: "p1",
  commentId: "c1",
  authorName: "Kim",
  preview: "hello",
  reasons: ["spam"],
  notes: noteItems.map((n) => n.note),
  count: 2,
  latestAt: "2026-11-20T05:00:00Z",
  postTitle: "Post",
  body: "hello",
  imageUrls: [],
  tags: [],
  targetCreatedAt: "2026-11-19T05:00:00Z",
  reasonCounts: [{ reason: "spam", count: 2 }],
  noteItems,
  reactionCount: null,
  commentCount: null,
});

for (const locale of ["ko", "ja", "en"] as const) {
  const d = getDictionary(locale);
  const panel = (r: Report) =>
    renderToString(<ReportPanel copy={d.board} onClose={() => {}} onDone={() => {}} report={r} w={d.boardReportsWhite} />);

  describe(`ReportPanel 신고 메모 (${locale})`, () => {
    it("메모가 비면(공백만 포함) 「신고 메모」 제목이 없다", () => {
      const html = panel(report([{ note: "   ", at: "2026-11-20T05:00:00Z" }]));
      expect(html).not.toContain(d.boardReportsWhite.notesTitle);
      expect(panel(report([]))).not.toContain(d.boardReportsWhite.notesTitle);
    });
    it("메모가 있으면 제목과 메모가 보이고 빈 메모는 빠진다", () => {
      const html = panel(
        report([
          { note: "too many ads", at: "2026-11-20T05:00:00Z" },
          { note: "  ", at: "2026-11-20T04:00:00Z" },
        ]),
      );
      expect(html).toContain(d.boardReportsWhite.notesTitle);
      expect(html).toContain("too many ads");
      expect(html.match(/<q>/g) ?? []).toHaveLength(1);
    });
  });

  it(`BoardReportsConsole 빈 화면 (${locale})`, () => {
    const html = renderToString(<BoardReportsConsole copy={d.board} reports={[]} w={d.boardReportsWhite} />);
    expect(html).toContain(d.boardReportsWhite.empty);
    expect(html).toContain(d.boardReportsWhite.emptyHint);
  });
}
