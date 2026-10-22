import { beforeEach, describe, expect, it, vi } from "vitest";

// 모듈 상태(직전 화면 경로 · 로딩 자리 셸)를 테스트마다 새로.
async function load() {
  vi.resetModules();
  const nav = await import("@/lib/nav-direction");
  // 셸 하나가 화면에 붙는 것 — 판정 + 마운트 effect 의 커밋.
  const mount = (path: string, placeholder: boolean) => {
    const entrance = nav.consumeScreenEntrance(path, placeholder);
    nav.commitScreenEntrance(path, placeholder);
    return entrance;
  };
  return { ...nav, mount };
}

describe("consumeScreenEntrance — 화면 들어오는 움직임 (2026-10-21)", () => {
  beforeEach(() => vi.resetModules());

  it("평범한 이동은 앞으로 밀어 넣는다", async () => {
    const nav = await load();
    nav.mount("/mobile", false);
    expect(nav.mount("/mobile/tasks", false)).toEqual({ kind: "forward", direction: "forward" });
  });

  it("탭바 이동은 탭 전환(밀지 않음)", async () => {
    const nav = await load();
    nav.mount("/mobile", false);
    nav.setNavDirection("tab");
    expect(nav.mount("/mobile/cleaning", false).kind).toBe("tab");
  });

  it("로딩 자리 셸이 먼저 밀고, 진짜 화면은 나타나기만 — 방향은 이어받는다", async () => {
    const nav = await load();
    nav.mount("/mobile/tasks", false);
    nav.setNavDirection("back");
    expect(nav.mount("/mobile", true).kind).toBe("back");
    expect(nav.mount("/mobile", false)).toEqual({ kind: "reveal", direction: "back" });
  });

  it("같은 경로의 두 번째 로딩 자리 셸(바깥 → 섹션 경계)은 다시 밀지 않는다", async () => {
    const nav = await load();
    nav.mount("/mobile", false);
    expect(nav.mount("/mobile/tasks/1", true).kind).toBe("forward");
    expect(nav.mount("/mobile/tasks/1", true).kind).toBe("none");
    expect(nav.mount("/mobile/tasks/1", false).kind).toBe("reveal");
  });

  it("같은 경로로 다시 그려지면 움직이지 않는다", async () => {
    const nav = await load();
    nav.mount("/mobile/tasks", false);
    nav.setNavDirection("forward");
    expect(nav.mount("/mobile/tasks", false).kind).toBe("same");
  });

  it("다른 경로로 가 버린 로딩 자리 셸은 남지 않는다", async () => {
    const nav = await load();
    nav.mount("/mobile", false);
    nav.mount("/mobile/tasks", true);
    expect(nav.mount("/mobile/cleaning", false).kind).toBe("forward");
    expect(nav.mount("/mobile/tasks", false).kind).toBe("forward");
  });

  it("스와이프 뒤로가기(none)는 움직임 없이", async () => {
    const nav = await load();
    nav.mount("/mobile/tasks/1", false);
    nav.setNavDirection("none");
    expect(nav.mount("/mobile/tasks", false)).toEqual({ kind: "none", direction: "none" });
  });

  it("그리다 버려진 셸(로딩 중 재시도)은 같은 답 — 진짜로 붙는 셸이 「reveal」을 받는다 (2026-10-22)", async () => {
    const nav = await load();
    nav.mount("/mobile/announcements", false);
    nav.setNavDirection("tab");
    expect(nav.mount("/mobile/requests", true).kind).toBe("tab");
    // 첫 그리기는 버려지고(커밋 없음) 다시 그린다.
    expect(nav.consumeScreenEntrance("/mobile/requests", false).kind).toBe("reveal");
    expect(nav.consumeScreenEntrance("/mobile/requests", false).kind).toBe("reveal");
    nav.commitScreenEntrance("/mobile/requests", false);
    // 붙은 뒤 같은 경로로 다시 그려지면 그때는 「same」.
    expect(nav.mount("/mobile/requests", false).kind).toBe("same");
  });
});
