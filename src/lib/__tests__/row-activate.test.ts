import { describe, expect, it, vi } from "vitest";
import { rowActivateProps } from "@/components/admin/shared/row-activate";

// 콘솔 표의 「줄 누르면 열기」(2026-11-11) — 마우스만 되던 것을 키보드(Tab → Enter · Space)로도.
function key(k: string, sameTarget = true) {
  const target = {};
  return { key: k, target, currentTarget: sameTarget ? target : {}, preventDefault: vi.fn() };
}

describe("rowActivateProps", () => {
  it("Tab 으로 닿고(tabIndex 0) Enter · Space 로 연다", () => {
    const open = vi.fn();
    const p = rowActivateProps(open);
    expect(p.tabIndex).toBe(0);
    p.onKeyDown(key("Enter") as never);
    const sp = key(" ");
    p.onKeyDown(sp as never);
    expect(open).toHaveBeenCalledTimes(2);
    expect(sp.preventDefault).toHaveBeenCalled(); // Space 로 화면이 내려가지 않게
  });

  it("줄 안의 단추 · 체크에서 누른 키는 줄을 열지 않는다", () => {
    const open = vi.fn();
    rowActivateProps(open).onKeyDown(key("Enter", false) as never);
    expect(open).not.toHaveBeenCalled();
  });

  it("다른 키는 무시", () => {
    const open = vi.fn();
    rowActivateProps(open).onKeyDown(key("a") as never);
    expect(open).not.toHaveBeenCalled();
  });
});
