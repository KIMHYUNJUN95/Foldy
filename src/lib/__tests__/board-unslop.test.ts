import { describe, expect, it } from "vitest";
import { boardDateTime, boardMetaLine, boardSummaryText } from "@/components/board/board-time";
import { BOARD_COMMENT_UNDO_MS, checkBoardCommentRestore, goneReportAction } from "@/lib/board-comment-restore";
import { nextRadioIndex } from "@/components/board/board-radio-keys";
import { boardImageStoragePath } from "@/lib/board-upload-paths";

// 게시판 unslop(2026-11-20) — docs/product/23-board-workflow.md 「unslop」.

describe("boardDateTime — 날짜 표기 하나로(도쿄)", () => {
  it("UTC 05:05 는 도쿄 14:05", () => {
    expect(boardDateTime("2026-11-19T05:05:00Z")).toBe("2026.11.19 14:05");
  });
  it("도쿄 자정은 24 가 아니라 00", () => {
    expect(boardDateTime("2026-11-18T15:00:00Z")).toBe("2026.11.19 00:00");
  });
  it("UTC 날짜와 도쿄 날짜가 다른 경계", () => {
    expect(boardDateTime("2026-12-31T16:30:00Z")).toBe("2027.01.01 01:30");
  });
  it("잘못된 값은 대시", () => {
    expect(boardDateTime("nope")).toBe("—");
  });
});

describe("boardMetaLine — 상대 시각 옆에 실제 시각", () => {
  it("여러 조각을 · 로 잇고 빈 것은 뺀다", () => {
    expect(boardMetaLine("매니저", "3분 전", "2026.11.19 14:05")).toBe("매니저 · 3분 전 · 2026.11.19 14:05");
    expect(boardMetaLine("", "", "2026.11.19 14:05")).toBe("2026.11.19 14:05");
  });
});

describe("boardSummaryText — 피드 요약 끝 마침표 겹침", () => {
  it("줄바꿈을 한 칸으로 모아 줄 자르기 말줄임이 마침표 뒤에 붙지 않게 한다", () => {
    expect(boardSummaryText("첫 줄입니다.\n\n둘째 줄.\n셋째")).toBe("첫 줄입니다. 둘째 줄. 셋째");
  });
  it("앞뒤 공백을 지운다", () => {
    expect(boardSummaryText("  안녕  ")).toBe("안녕");
  });
});

describe("boardImageStoragePath — 저장 실패 때 올린 사진 지우기", () => {
  it("공개 URL 에서 request-images 안 경로를 뽑는다", () => {
    expect(
      boardImageStoragePath(
        "https://x.supabase.co/storage/v1/object/public/request-images/org1/board-posts/p1/a.jpg",
      ),
    ).toBe("org1/board-posts/p1/a.jpg");
  });
  it("다른 버킷 · 모르는 주소는 null", () => {
    expect(boardImageStoragePath("https://x.supabase.co/storage/v1/object/public/other/a.jpg")).toBeNull();
    expect(boardImageStoragePath("blob:abc")).toBeNull();
  });
  it("? 뒤 쿼리는 뗀다", () => {
    expect(
      boardImageStoragePath(
        "https://x.supabase.co/storage/v1/object/public/request-images/org1/board-posts/p1/a.jpg?t=123&v=2",
      ),
    ).toBe("org1/board-posts/p1/a.jpg");
  });
  it("인코딩된 경로는 풀어서 돌려준다", () => {
    expect(
      boardImageStoragePath(
        "https://x.supabase.co/storage/v1/object/public/request-images/org1/board-posts/p1/%EC%82%AC%EC%A7%84%201.jpg",
      ),
    ).toBe("org1/board-posts/p1/사진 1.jpg");
  });
  it("깨진 인코딩은 던지지 않고 null", () => {
    expect(
      boardImageStoragePath("https://x.supabase.co/storage/v1/object/public/request-images/org1/%E0%A4%A.jpg"),
    ).toBeNull();
  });
});

describe("checkBoardCommentRestore — 댓글 지우기 60초 되돌리기(지운 사람만)", () => {
  const now = Date.parse("2026-11-20T05:00:00Z");
  const viewer = { organizationId: "org1", userId: "u1" };
  type C = { organization_id: string; deleted_by_user_id: string | null; deleted_at: string | null };
  const comment = (over: Partial<C> = {}): C => ({
    organization_id: "org1",
    deleted_by_user_id: "u1",
    deleted_at: new Date(now - 10_000).toISOString(),
    ...over,
  });
  const run = (c: C | null, opts: { postAlive?: boolean; removedByReport?: boolean; v?: typeof viewer } = {}) =>
    checkBoardCommentRestore({
      comment: c,
      postAlive: opts.postAlive ?? true,
      removedByReport: opts.removedByReport ?? false,
      viewer: opts.v ?? viewer,
      nowMs: now,
    });

  it("지운 사람이 60초 안이면 되돌린다", () => {
    expect(run(comment())).toEqual({ ok: true });
  });
  it("관리자가 지운 댓글을 쓴 사람이 되돌리면 forbidden", () => {
    // 쓴 사람 u1, 관리자 admin 이 지움 → u1 이 되돌리기
    expect(run(comment({ deleted_by_user_id: "admin" }))).toEqual({ error: "forbidden" });
  });
  it("쓴 사람이 지운 댓글을 관리자가 되돌리면 forbidden", () => {
    expect(run(comment({ deleted_by_user_id: "u1" }), { v: { organizationId: "org1", userId: "admin" } })).toEqual({
      error: "forbidden",
    });
  });
  it("신고 처리로 지운 댓글은 그 관리자도 되돌리지 못한다", () => {
    expect(
      run(comment({ deleted_by_user_id: "admin" }), {
        removedByReport: true,
        v: { organizationId: "org1", userId: "admin" },
      }),
    ).toEqual({ error: "forbidden" });
  });
  it("지운 사람이 비어 있으면(예전 삭제) forbidden", () => {
    expect(run(comment({ deleted_by_user_id: null }))).toEqual({ error: "forbidden" });
  });
  it("다른 조직 댓글은 forbidden", () => {
    expect(run(comment({ organization_id: "org2" }))).toEqual({ error: "forbidden" });
  });
  it("60초가 지나면 expired", () => {
    expect(run(comment({ deleted_at: new Date(now - 60_001).toISOString() }))).toEqual({ error: "expired" });
  });
  it("딱 60초는 아직 된다", () => {
    expect(run(comment({ deleted_at: new Date(now - BOARD_COMMENT_UNDO_MS).toISOString() }))).toEqual({ ok: true });
  });
  it("글이 지워졌으면 not_found", () => {
    expect(run(comment(), { postAlive: false })).toEqual({ error: "not_found" });
  });
  it("댓글이 없거나 안 지워졌으면 not_found", () => {
    expect(run(null)).toEqual({ error: "not_found" });
    expect(run(comment({ deleted_at: null }))).toEqual({ error: "not_found" });
  });
  it("지운 시각이 이상한 값이면 expired", () => {
    expect(run(comment({ deleted_at: "nope" }))).toEqual({ error: "expired" });
  });
});

describe("goneReportAction — 신고함 정리가 되돌리기를 막지 않게", () => {
  const now = Date.parse("2026-11-20T05:00:00Z");
  const at = (ms: number) => new Date(now - ms).toISOString();
  const run = (o: Partial<Parameters<typeof goneReportAction>[0]>) =>
    goneReportAction({ postGone: false, commentMissing: false, commentDeletedAt: at(10_000), nowMs: now, ...o });
  it("60초 안에 지운 댓글은 숨기기만(닫지 않음)", () => {
    expect(run({})).toBe("hide");
    expect(run({ commentDeletedAt: at(BOARD_COMMENT_UNDO_MS) })).toBe("hide");
  });
  it("60초가 지났으면 닫는다", () => {
    expect(run({ commentDeletedAt: at(BOARD_COMMENT_UNDO_MS + 1) })).toBe("close");
  });
  it("글이 지워졌거나 댓글 줄이 없으면 닫는다", () => {
    expect(run({ postGone: true })).toBe("close");
    expect(run({ commentMissing: true, commentDeletedAt: undefined })).toBe("close");
  });
});

describe("nextRadioIndex — 신고 사유 화살표 키", () => {
  it("아래 · 오른쪽은 다음, 끝에서 처음으로", () => {
    expect(nextRadioIndex(0, "ArrowDown", 5)).toBe(1);
    expect(nextRadioIndex(4, "ArrowRight", 5)).toBe(0);
  });
  it("위 · 왼쪽은 이전, 처음에서 끝으로", () => {
    expect(nextRadioIndex(0, "ArrowUp", 5)).toBe(4);
    expect(nextRadioIndex(2, "ArrowLeft", 5)).toBe(1);
  });
  it("Home · End", () => {
    expect(nextRadioIndex(3, "Home", 5)).toBe(0);
    expect(nextRadioIndex(1, "End", 5)).toBe(4);
  });
  it("아무것도 안 골랐을 때(-1) 아래는 처음", () => {
    expect(nextRadioIndex(-1, "ArrowDown", 5)).toBe(0);
  });
  it("다른 키는 null", () => {
    expect(nextRadioIndex(1, "a", 5)).toBeNull();
  });
});
