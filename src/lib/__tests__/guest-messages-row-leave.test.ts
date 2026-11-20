import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INBOX_STATUS_FILTERS, type InboxStatusFilter } from "@/lib/guest-messages/inbox-model";
import { createPaneMessageHandler, postRowChange, ROW_MESSAGE } from "@/lib/guest-messages/pane-messages";
import { leavesStatusList, stateAfterAction, type RowAction, type RowNext } from "@/lib/guest-messages/row-leave";
import { SPLIT_PANE_NAME } from "@/lib/split-pane";

/**
 * 손님 메시지 — 「처리 끝」 · 「나중에」 · 「되돌리기」 뒤 목록 줄을 먼저 접을지(47 §5-10 · 16 「줄 접힘」).
 * 검색은 상태 탭을 보지 않으므로(모든 상태) 검색 중에는 줄을 접지 않는다 — 접으면 결과가 다시 오면서 펴지거나(관리자 받은 탭),
 * 목록에 없는 줄이라 표시가 안 지워져 접힌 채 남는다(나중에 · 전체 탭).
 * 상황표: {검색 중 / 아님} × {받은 · 나중에 · 처리 끝 · 전체} × {처리 끝 · 나중에 · 되돌리기 · 나중에 풀기} × {관리자 · 폰 · 태블릿 칸}.
 * 「나중에 풀기」 뒤 상태는 서버가 정한다(손님 말이 마지막이면 답장 대기, 아니면 처리 끝) — 어느 쪽이든 「나중에」가 아니므로
 * 나중에 탭에서만 빠지고, 다른 탭은 그대로 둔다(아직 없던 줄을 미리 접어 두면 들어올 때 접힌 채 나온다).
 */

const ACTIONS: readonly RowAction[] = ["done", "snooze", "reopen", "unsnooze"];

/** 검색이 아닐 때 줄이 그 탭에서 빠지는(= 접는) 칸 — 나머지는 모두 그대로. */
const LEAVES_WHEN_LISTING: Record<InboxStatusFilter, Record<RowAction, boolean>> = {
  awaiting: { done: true, snooze: true, reopen: false, unsnooze: false },
  snoozed: { done: true, snooze: false, reopen: true, unsnooze: true },
  done: { done: false, snooze: true, reopen: true, unsnooze: false },
  all: { done: false, snooze: false, reopen: false, unsnooze: false },
};

const C1 = "00000000-0000-4000-8000-000000000001";
type Win = { location: { origin: string }; parent?: unknown; name?: string; postMessage?: (data: unknown, origin: string) => void };

/** 태블릿: 칸(iframe) 안 대화가 바깥 목록 창에 알리고, 바깥 창이 자기 탭 · 검색 상태로 판단한다. */
function tabletCollapses(searching: boolean, filter: InboxStatusFilter, action: RowAction): boolean {
  const rows = new Map<string, boolean>();
  const parent: Win = { location: { origin: "https://app.test" } };
  const pane: Win = { location: parent.location, parent, name: SPLIT_PANE_NAME };
  const handle = createPaneMessageHandler({
    self: parent as never,
    freshness: { markWrite: () => {} },
    applyIds: () => {},
    rowRule: { searching, filter },
    setRowLeaving: (id, leaving) => rows.set(id, leaving),
  });
  parent.postMessage = (data, origin) => handle({ data, origin, source: pane } as never);
  postRowChange(pane as never, C1, stateAfterAction(action));
  return rows.get(C1) === true;
}

/** 폰: 대화가 따로 열린 화면이라 목록 창이 없다 — 신호를 보내지 않는다(목록은 돌아올 때 다시 그린다). */
function phoneSends(action: RowAction): number {
  let sent = 0;
  const self: Win = { location: { origin: "https://app.test" }, postMessage: () => (sent += 1) };
  self.parent = self;
  postRowChange(self as never, C1, stateAfterAction(action));
  return sent;
}

describe("stateAfterAction — 누른 버튼 뒤 상태", () => {
  it("처리 끝 → done · 나중에 → snoozed · 되돌리기 → awaiting · 나중에 풀기 → unsnoozed(서버가 정함)", () => {
    expect(ACTIONS.map(stateAfterAction)).toEqual<RowNext[]>(["done", "snoozed", "awaiting", "unsnoozed"]);
  });
});

describe.each([false, true])("상황표 — 검색 중 %s", (searching) => {
  describe.each(INBOX_STATUS_FILTERS.map((f) => [f]))("탭 %s", (filter) => {
    it.each(ACTIONS.map((a) => [a]))("%s", (action) => {
      const expected = searching ? false : LEAVES_WHEN_LISTING[filter][action];
      // 관리자 콘솔 — 같은 판단을 바로 쓴다.
      expect(leavesStatusList({ searching, filter, next: stateAfterAction(action) })).toBe(expected);
      // 모바일 태블릿 칸 — 칸이 보낸 신호를 바깥 목록이 같은 판단으로 받는다.
      expect(tabletCollapses(searching, filter, action)).toBe(expected);
      // 모바일 폰 — 신호 없음(접을 목록이 같은 화면에 없다).
      expect(phoneSends(action)).toBe(0);
    });
  });
});

describe("pane-messages gm-row — 실패하면 다시 편다", () => {
  it("next=null 은 탭 · 검색과 상관없이 펴기", () => {
    const rows: Array<[string, boolean]> = [];
    const parent: Win = { location: { origin: "https://app.test" } };
    const pane: Win = { location: parent.location, parent, name: SPLIT_PANE_NAME };
    const handle = createPaneMessageHandler({
      self: parent as never,
      freshness: { markWrite: () => {} },
      applyIds: () => {},
      rowRule: { searching: false, filter: "awaiting" },
      setRowLeaving: (id, leaving) => rows.push([id, leaving]),
    });
    handle({ data: { type: ROW_MESSAGE, id: C1, next: "done" }, origin: "https://app.test", source: pane } as never);
    handle({ data: { type: ROW_MESSAGE, id: C1, next: null }, origin: "https://app.test", source: pane } as never);
    expect(rows).toEqual([
      [C1, true],
      [C1, false],
    ]);
  });
});

/** 연결 — 화면의 「나중에 풀기」 · 「실행 취소」가 실제로 같은 판정 · 신호를 거치는지(소스에서 그 핸들러 덩이를 본다). */
function block(file: string, start: string, end: string): string {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  const from = src.indexOf(start);
  expect(from, `${file}: ${start}`).toBeGreaterThan(-1);
  const to = src.indexOf(end, from + start.length);
  return src.slice(from, to === -1 ? undefined : to);
}

describe("연결 — 나중에 풀기 · 실행 취소", () => {
  it("PC 「나중에 풀기」: 같은 판정으로 접고, 성공 때 목록 · 검색 다시 읽기, 실패 때 펴기", () => {
    const code = block("src/components/admin/messages/messages-console.tsx", "const applyUnsnooze", "\n  };");
    expect(code).toMatch(/leavesStatusList\(\{\s*searching: search\.active,\s*filter: status,\s*next: stateAfterAction\("unsnooze"\)/);
    expect(code).toContain("controller.unsnooze(");
    expect(code).toContain("inbox.applyIds([id])");
    expect(code).toContain("search.refresh()");
    expect(code).toMatch(/next\.delete\(id\)/);
    const button = block("src/components/admin/messages/messages-console.tsx", 'state === "snoozed" ?', "copy.unsnooze}");
    expect(button).toContain("onClick={applyUnsnooze}");
  });

  it("PC 다른 대화 「실행 취소」: 성공 때 검색도 다시 찾는다", () => {
    const code = block("src/components/admin/messages/messages-console.tsx", "settleWrite(() => guestWrites.setDone(id, false))", "});");
    expect(code).toContain("inbox.applyIds([id])");
    expect(code).toContain("search.refresh()");
  });

  it("모바일 「나중에 풀기」: 처리 끝 · 나중에와 같은 tellList 로 next(실패면 null)", () => {
    const code = block("src/components/guest-messages/mobile-messages.tsx", "const unsnooze = ", "\n  };");
    expect(code).toContain('tellList(conversationId, stateAfterAction("unsnooze"))');
    expect(code).toContain("tellList(conversationId, null)");
    expect(code).toContain("controller.unsnooze(");
    const item = block("src/components/guest-messages/mobile-messages.tsx", 'state === "snoozed" ?', "copy.unsnooze}");
    expect(item).toContain("unsnooze()");
  });
});

describe("연결 — 처리 끝 · 나중에 · 칸 바깥 목록 · 검색 줄", () => {
  const CONSOLE = "src/components/admin/messages/messages-console.tsx";
  const MOBILE = "src/components/guest-messages/mobile-messages.tsx";

  it("PC 처리 끝 · 나중에: 지금 검색 · 탭으로 같은 판정", () => {
    expect(block(CONSOLE, "const markDone", "\n  };")).toMatch(
      /leavesStatusList\(\{\s*searching: search\.active,\s*filter: status,\s*next: stateAfterAction\(done \? "done" : "reopen"\)/,
    );
    expect(block(CONSOLE, "const applySnooze", "\n  };")).toMatch(
      /leavesStatusList\(\{\s*searching: search\.active,\s*filter: status,\s*next: stateAfterAction\("snooze"\)/,
    );
  });

  it("모바일 처리 끝 · 나중에: tellList 에 다음 상태, 실패면 null", () => {
    const done = block(MOBILE, "const setDone = ", "\n  };");
    expect(done).toContain('tellList(conversationId, stateAfterAction(done ? "done" : "reopen"))');
    expect(done).toContain("tellList(conversationId, null)");
    const snooze = block(MOBILE, "const snooze = ", "\n  };");
    expect(snooze).toContain('tellList(conversationId, stateAfterAction("snooze"))');
    expect(snooze).toContain("tellList(conversationId, null)");
  });

  it("칸 바깥 목록: rowRule 에 지금 검색 · 탭, 칸의 쓰기(gm-write) 뒤엔 검색도 다시 찾음", () => {
    const handler = block(MOBILE, "const onMessage = createPaneMessageHandler(", "window.addEventListener");
    expect(handler).toContain("rowRule: { searching, filter: status }");
    expect(handler).toMatch(/applyIds: \(ids\) => \{\s*refreshSearch\(\);\s*return applyIds\(ids\);/);
    expect(block(MOBILE, "const searching = ", "\n")).toContain("search.active");
    expect(block(MOBILE, "const refreshSearch = ", "\n")).toContain("search.refresh");
  });

  it.each([CONSOLE, MOBILE])("%s 검색 줄엔 data-leaving 이 없다(목록 줄엔 있다)", (file) => {
    const searchRows = block(file, "found.map(({ row, match })", "))}");
    expect(searchRows).toContain('className="row-collapse"');
    expect(searchRows).not.toContain("data-leaving");
    expect(block(file, "list.rows.map((row)", "data-entering")).toContain("data-leaving=");
  });
});
