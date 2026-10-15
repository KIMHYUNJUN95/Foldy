import { describe, expect, it } from "vitest";

import {
  categoryForType,
  filterByTab,
  groupNotificationViews,
  notificationSection,
  sectionizeGroups,
  unreadByTab,
  type NotificationView,
} from "@/lib/notifications/grouping";

function view(id: string, dayKey: string, groupKey: string, extra: Partial<NotificationView> = {}): NotificationView {
  return {
    id,
    href: `/mobile/tasks/${id}`,
    unread: false,
    category: "work",
    icon: "flag",
    title: "t",
    object: `‘${id}’`,
    time: "8:02",
    source: "s",
    dayKey,
    groupKey,
    ...extra,
  };
}

describe("groupNotificationViews", () => {
  it("묶음: 같은 날 · 같은 종류가 이어지면 한 줄", () => {
    const groups = groupNotificationViews([
      view("a", "2026-10-15", "task_overdue:overdue"),
      view("b", "2026-10-15", "task_overdue:overdue", { unread: true }),
      view("c", "2026-10-15", "task_overdue:overdue"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].head.id).toBe("a");
    expect(groups[0].rest.map((v) => v.id)).toEqual(["b", "c"]);
    expect(groups[0].ids).toEqual(["a", "b", "c"]);
    expect(groups[0].unread).toBe(true);
  });

  it("다른 날이면 끊는다", () => {
    const groups = groupNotificationViews([
      view("a", "2026-10-15", "k"),
      view("b", "2026-10-14", "k"),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([["a"], ["b"]]);
  });

  it("사이에 다른 종류가 끼면 끊는다(시간 순서 유지)", () => {
    const groups = groupNotificationViews([
      view("a", "2026-10-15", "k1"),
      view("b", "2026-10-15", "k2"),
      view("c", "2026-10-15", "k1"),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("빈 목록", () => {
    expect(groupNotificationViews([])).toEqual([]);
  });
});

describe("notificationSection", () => {
  it("오늘 · 이번 주(최근 7일) · 이전", () => {
    expect(notificationSection("2026-10-15", "2026-10-15")).toBe("today");
    expect(notificationSection("2026-10-14", "2026-10-15")).toBe("week");
    expect(notificationSection("2026-10-09", "2026-10-15")).toBe("week");
    expect(notificationSection("2026-10-08", "2026-10-15")).toBe("earlier");
  });

  it("달 · 해 경계", () => {
    expect(notificationSection("2026-09-30", "2026-10-01")).toBe("week");
    expect(notificationSection("2025-12-31", "2026-01-01")).toBe("week");
    expect(notificationSection("2025-12-20", "2026-01-01")).toBe("earlier");
  });

  it("구간별로 나누고 빈 구간은 뺀다", () => {
    const groups = groupNotificationViews([view("a", "2026-10-15", "k"), view("b", "2026-09-01", "k")]);
    const sections = sectionizeGroups(groups, "2026-10-15");
    expect(sections.map((s) => s.section)).toEqual(["today", "earlier"]);
  });
});

describe("tabs", () => {
  it("종류 → 탭", () => {
    expect(categoryForType("task_overdue")).toBe("work");
    expect(categoryForType("order_processed")).toBe("work");
    expect(categoryForType("announcement_activity")).toBe("notice");
    expect(categoryForType("board_activity")).toBe("board");
    expect(categoryForType("attendance_activity")).toBe("attendance");
  });

  it("탭 거르기 · 안 읽은 수", () => {
    const items = [
      view("a", "2026-10-15", "k", { unread: true }),
      view("b", "2026-10-15", "k", { category: "attendance", unread: true }),
      view("c", "2026-10-15", "k", { category: "attendance" }),
    ];
    expect(filterByTab(items, "attendance").map((v) => v.id)).toEqual(["b", "c"]);
    expect(filterByTab(items, "all")).toHaveLength(3);
    expect(unreadByTab(items)).toEqual({ all: 2, work: 1, notice: 0, board: 0, attendance: 1 });
  });
});
