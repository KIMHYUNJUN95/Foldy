import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATCH_UP_PX,
  decideCommit,
  decideLock,
  findBackTarget,
  followOffset,
  canStartSwipeBack,
  isSwipeBackScreen,
  parentScreen,
  settleMotion,
  timeForProgress,
} from "@/lib/swipe-back/history-model";
import { MOBILE_SCREENS } from "@/lib/swipe-back/mobile-screens";

describe("findBackTarget", () => {
  it("goes to the previous screen", () => {
    expect(findBackTarget(["/mobile/cleaning", "/mobile/cleaning/records"], 1)).toEqual({
      delta: -1,
      index: 0,
      url: "/mobile/cleaning",
    });
  });

  it("skips query-only entries of the same screen", () => {
    const urls = ["/mobile/requests", "/mobile/requests/maintenance/1", "/mobile/requests/maintenance/1?tab=log", "/mobile/requests/maintenance/1?tab=photo"];
    expect(findBackTarget(urls, 3)).toEqual({ delta: -3, index: 0, url: "/mobile/requests" });
  });

  it("returns null on the first entry", () => {
    expect(findBackTarget(["/mobile/board/3"], 0)).toBeNull();
  });

  it("stops at an unknown entry instead of guessing", () => {
    expect(findBackTarget([null, "/mobile/board/3"], 1)).toBeNull();
    expect(findBackTarget(["/mobile", null, "/mobile/board/3?x=1", "/mobile/board/3"], 3)).toBeNull();
  });

  it("returns null when the current entry is unknown", () => {
    expect(findBackTarget(["/mobile", null], 1)).toBeNull();
  });
});

describe("isSwipeBackScreen", () => {
  it("every /mobile screen swipes back, menu roots included (2026-10-09)", () => {
    expect(isSwipeBackScreen("/mobile")).toBe(true);
    expect(isSwipeBackScreen("/mobile/cleaning")).toBe(true);
    expect(isSwipeBackScreen("/mobile/cleaning/records")).toBe(true);
    expect(isSwipeBackScreen("/mobile?tab=today")).toBe(true);
    expect(isSwipeBackScreen("/mobile/notifications?x=1")).toBe(true);
  });
  it("never outside /mobile (no swiping back into login · onboarding · account)", () => {
    expect(isSwipeBackScreen("/account")).toBe(false);
    expect(isSwipeBackScreen("/login?next=/mobile")).toBe(false);
    expect(isSwipeBackScreen("/mobilex")).toBe(false);
  });
});

describe("canStartSwipeBack", () => {
  it("the account screen in the mobile shell starts a swipe too (2026-10-23)", () => {
    expect(canStartSwipeBack("/account")).toBe(true);
    expect(canStartSwipeBack("/account?mode=mobile")).toBe(true);
    expect(canStartSwipeBack("/mobile/users/1")).toBe(true);
  });
  it("but not the full-screen id-card flow, login, or look-alike paths", () => {
    expect(canStartSwipeBack("/account/id-card")).toBe(false);
    expect(canStartSwipeBack("/accounts")).toBe(false);
    expect(canStartSwipeBack("/auth/login")).toBe(false);
  });
});

describe("decideLock", () => {
  it("waits for enough movement", () => {
    expect(decideLock(5, 3)).toBe("pending");
  });
  it("accepts a mostly-horizontal rightward move", () => {
    expect(decideLock(12, 4)).toBe("accept");
    expect(decideLock(20, 15)).toBe("accept");
  });
  it("rejects vertical, steep diagonal and leftward moves", () => {
    expect(decideLock(3, 14)).toBe("reject");
    expect(decideLock(12, 12)).toBe("reject");
    expect(decideLock(-14, 0)).toBe("reject");
  });
});

describe("decideCommit", () => {
  it("commits past 35% of the width", () => {
    expect(decideCommit(150, 0, 400)).toBe(true);
    expect(decideCommit(130, 0, 400)).toBe(false);
  });
  it("commits a quick flick even when short", () => {
    expect(decideCommit(40, 0.6, 400)).toBe(true);
    expect(decideCommit(10, 0.6, 400)).toBe(false);
  });
  it("cancels when the finger was moving back left", () => {
    expect(decideCommit(300, -0.4, 400)).toBe(false);
  });
});

describe("decideCommit on wide panes", () => {
  it("caps the distance at 220px so a tablet does not need a 326px drag", () => {
    expect(decideCommit(230, 0, 932)).toBe(true);
    expect(decideCommit(210, 0, 932)).toBe(false);
  });
});

describe("followOffset", () => {
  it("starts at the lock point without a jump and catches up with the finger", () => {
    expect(followOffset(12, 12)).toBe(0);
    expect(followOffset(13, 12)).toBeCloseTo(1.25, 2);
    expect(followOffset(12 + CATCH_UP_PX, 12)).toBe(12 + CATCH_UP_PX);
    expect(followOffset(200, 12)).toBe(200);
  });
  it("never moves backwards while the finger moves right", () => {
    let last = 0;
    for (let dx = 12; dx < 120; dx += 1) {
      const next = followOffset(dx, 12);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });
});

describe("settleMotion", () => {
  /** 곡선의 시작 속도(px/ms) — 시작 기울기 y1/x1 × 거리 / 시간. */
  const startSpeed = (remaining: number, velocity: number) => {
    const { curve, duration } = settleMotion(remaining, velocity);
    return ((curve[1] / curve[0]) * remaining) / duration;
  };

  it("continues at the finger's speed instead of jumping (2026-10-20: was ~25x)", () => {
    expect(startSpeed(252, 0.5)).toBeCloseTo(0.5, 2);
    expect(startSpeed(300, 1.5)).toBeCloseTo(1.5, 2);
  });
  it("starts gently when the finger had stopped", () => {
    expect(startSpeed(252, 0)).toBeCloseTo(0.3, 2);
  });
  it("stays within 220..380ms", () => {
    expect(settleMotion(1000, 0).duration).toBe(380);
    expect(settleMotion(10, 3).duration).toBe(220);
  });
  it("is a valid CSS cubic-bezier", () => {
    expect(settleMotion(200, 0.8).easing).toMatch(/^cubic-bezier\(0\.3, [01](\.\d+)?, 0\.2, 1\)$/);
  });
});

describe("timeForProgress", () => {
  it("finds when the curve reaches a progress", () => {
    const { curve } = settleMotion(300, 0.5);
    const t = timeForProgress(curve, 0.96);
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(1);
    expect(timeForProgress([0, 0, 1, 1], 0.5)).toBeCloseTo(0.5, 3);
  });
});

describe("parentScreen", () => {
  it("goes up to the nearest real screen", () => {
    expect(parentScreen("/mobile/tasks/abc", MOBILE_SCREENS)).toBe("/mobile/tasks");
    expect(parentScreen("/mobile/tasks/abc/edit?x=1", MOBILE_SCREENS)).toBe("/mobile/tasks/abc");
    expect(parentScreen("/mobile/requests/orders/123", MOBILE_SCREENS)).toBe("/mobile/requests");
    expect(parentScreen("/mobile/attendance/leave/done", MOBILE_SCREENS)).toBe("/mobile/attendance/leave");
    expect(parentScreen("/mobile/cleaning", MOBILE_SCREENS)).toBe("/mobile");
  });
  it("has nowhere to go from home or outside the app", () => {
    expect(parentScreen("/mobile", MOBILE_SCREENS)).toBeNull();
    expect(parentScreen("/mobile?tab=today", MOBILE_SCREENS)).toBeNull();
    expect(parentScreen("/account", MOBILE_SCREENS)).toBeNull();
  });
});

describe("MOBILE_SCREENS", () => {
  it("matches every page under src/app/mobile", () => {
    const pages: string[] = [];
    const walk = (dir: string, route: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, `${route}/${name}`);
        else if (name === "page.tsx") pages.push(route);
      }
    };
    walk(join(process.cwd(), "src/app/mobile"), "/mobile");
    expect([...MOBILE_SCREENS].sort()).toEqual(pages.sort());
  });
});
