import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 모듈 상태(직전 화면 경로 · 로딩 자리 셸)를 테스트마다 새로.
async function load() {
  vi.resetModules();
  // 판정은 브라우저에서만 한다(서버 = 문서 없음 → 늘 「none」, 2026-10-26). 기록 추적기는 window 를 보므로 document 만 흉내.
  vi.stubGlobal("document", {});
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
  afterEach(() => vi.unstubAllGlobals());

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

  it("서버(문서 없음)에서는 모듈 상태를 건드리지 않고 「none」 (2026-10-26)", async () => {
    const nav = await load();
    vi.unstubAllGlobals();
    expect(nav.consumeScreenEntrance("/mobile", false)).toEqual({ kind: "none", direction: "none" });
    vi.stubGlobal("document", {});
    // 서버 호출이 직전 경로를 남기지 않았다 — 클라이언트 첫 판정은 「same」이 아니라 앞으로.
    expect(nav.mount("/mobile", false).kind).toBe("forward");
  });

  it("하이드레이션 중에는 서버와 같은 「none」, 방향은 그대로 돌려준다 (2026-10-26)", async () => {
    const nav = await load();
    expect(nav.consumeScreenEntrance("/mobile", false, true)).toEqual({ kind: "none", direction: "forward" });
    nav.commitScreenEntrance("/mobile", false);
    // 판정은 했으므로 같은 경로 다시 그림은 「same」.
    expect(nav.mount("/mobile", false).kind).toBe("same");
  });
});
