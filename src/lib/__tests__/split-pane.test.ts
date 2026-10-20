import { describe, expect, it } from "vitest";
import { isSplitPaneMessage, matchesDetail, SPLIT_DETAIL_PATTERNS as P } from "@/lib/split-pane";

describe("split pane detail patterns", () => {
  it("opens details (and their edit screens) in the pane", () => {
    expect(matchesDetail(P.tasks, "/mobile/tasks/abc?occurrence=2026-10-05")).toBe(true);
    expect(matchesDetail(P.tasks, "/mobile/tasks/abc/edit")).toBe(true);
    expect(matchesDetail(P.requests, "/mobile/requests/maintenance/12")).toBe(true);
    expect(matchesDetail(P.requests, "/mobile/requests/orders/9")).toBe(true);
    expect(matchesDetail(P.complaints, "/mobile/complaints/reviews/77")).toBe(true);
    expect(matchesDetail(P.board, "/mobile/board/5/edit")).toBe(true);
    expect(matchesDetail(P.linen, "/mobile/linen-return/record/3")).toBe(true);
  });

  it("keeps create screens and sub-lists out of the pane", () => {
    expect(matchesDetail(P.tasks, "/mobile/tasks/new")).toBe(false);
    expect(matchesDetail(P.tasks, "/mobile/tasks/projects/1")).toBe(false);
    expect(matchesDetail(P.requests, "/mobile/requests/lost-found/disposed")).toBe(false);
    expect(matchesDetail(P.requests, "/mobile/requests/orders/new")).toBe(false);
    expect(matchesDetail(P.complaints, "/mobile/complaints/new")).toBe(false);
    expect(matchesDetail(P.board, "/mobile/board/compose")).toBe(false);
    expect(matchesDetail(P.suggestions, "/mobile/suggestions/referenced")).toBe(false);
    expect(matchesDetail(P.bugs, "/mobile/bugs")).toBe(false);
  });

  it("users opens a member detail, not the invites tab (2026-10-20)", () => {
    expect(matchesDetail(P.users, "/mobile/users/cb934ba7-66b2-49a9-abdc-3fff26fa80ab")).toBe(true);
    expect(matchesDetail(P.users, "/mobile/users/invites")).toBe(false);
    expect(matchesDetail(P.users, "/mobile/users")).toBe(false);
  });

  it("notifications open any feature detail in the pane, nothing else (2026-10-05)", () => {
    expect(matchesDetail(P.notifications, "/mobile/requests/maintenance/abc?from=notif")).toBe(true);
    expect(matchesDetail(P.notifications, "/mobile/tasks/123")).toBe(true);
    expect(matchesDetail(P.notifications, "/mobile/announcements/9")).toBe(true);
    expect(matchesDetail(P.notifications, "/mobile/attendance/correction/status")).toBe(false);
    expect(matchesDetail(P.notifications, "/mobile/calendar")).toBe(false);
    expect(matchesDetail(P.notifications, "/mobile/tasks/new")).toBe(false);
  });

  it("only trusts its own message shape", () => {
    expect(isSplitPaneMessage({ kind: "mutated", type: "stayops-pane" })).toBe(true);
    expect(isSplitPaneMessage({ type: "other" })).toBe(false);
    expect(isSplitPaneMessage(null)).toBe(false);
  });
});
