import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionProvider } from "@/components/providers/session-provider";
import { AdmDropdown, ddMenuClassName, menuOverflowsRight, menuShiftX, menuVerticalPlan, nextOptionIndex, returnsToSearch } from "@/components/admin/shared/adm-dropdown";

// 환경이 node 라 DOM 이벤트(Esc 전파 · 포커스 복귀)는 못 돌린다 — 키 이동 계산 · 방향 클래스 · 접근성 속성만 검증하고,
// Esc · 포커스는 화면에서 확인한다.
describe("nextOptionIndex", () => {
  it("ArrowDown/ArrowUp 은 끝에서 멈춘다", () => {
    expect(nextOptionIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextOptionIndex("ArrowDown", 2, 3)).toBe(2);
    expect(nextOptionIndex("ArrowUp", 1, 3)).toBe(0);
    expect(nextOptionIndex("ArrowUp", 0, 3)).toBe(0);
  });
  it("검색 입력(-1)에서 ArrowDown 은 첫 옵션으로 들어간다", () => {
    expect(nextOptionIndex("ArrowDown", -1, 3)).toBe(0);
  });
  it("Home/End 와 빈 목록", () => {
    expect(nextOptionIndex("Home", 2, 3)).toBe(0);
    expect(nextOptionIndex("End", 0, 3)).toBe(2);
    expect(nextOptionIndex("ArrowDown", -1, 0)).toBe(-1);
  });
});

describe("returnsToSearch", () => {
  it("검색형의 첫 옵션에서 ArrowUp 만 검색으로 돌아간다", () => {
    expect(returnsToSearch("ArrowUp", 0, true)).toBe(true);
    expect(returnsToSearch("ArrowUp", 1, true)).toBe(false);
    expect(returnsToSearch("ArrowUp", 0, false)).toBe(false);
    expect(returnsToSearch("ArrowDown", 0, true)).toBe(false);
  });
});

describe("ddMenuClassName", () => {
  it("placement up 이면 dd__menu--up, 기본(down)은 없다", () => {
    expect(ddMenuClassName({ wide: false, placement: "up", instant: false })).toContain("dd__menu--up");
    expect(ddMenuClassName({ wide: false, placement: "down", instant: false })).toBe("dd__menu");
  });
  it("키보드로 연 메뉴는 instant 클래스", () => {
    expect(ddMenuClassName({ wide: true, placement: "down", instant: true })).toBe("dd__menu dd__menu--wide dd__menu--instant");
  });
});

describe("AdmDropdown 닫힌 상태", () => {
  it("트리거는 listbox 팝업을 알리고 선택 라벨을 보여 준다", () => {
    const html = renderToStaticMarkup(
      <SessionProvider initialSession={null}>
        <AdmDropdown
          ariaLabel="lang"
          onChange={() => {}}
          options={[{ value: "", label: "None" }, { value: "en", label: "English" }]}
          placement="up"
          value="en"
        />
      </SessionProvider>,
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("English");
  });
});

describe("menuOverflowsRight", () => {
  it("오른쪽 여백 8px 를 넘으면 뒤집는다", () => {
    expect(menuOverflowsRight(1272, 1280)).toBe(false);
    expect(menuOverflowsRight(1273, 1280)).toBe(true);
  });
});

describe("menuShiftX (모바일 .dd-scope)", () => {
  it("안에 들어가면 그대로", () => {
    expect(menuShiftX(16, 200, 390)).toBe(0);
  });
  it("오른쪽으로 넘치면 넘친 만큼 왼쪽으로", () => {
    expect(menuShiftX(250, 200, 390)).toBe(-68);
  });
  it("왼쪽 여백 8px 밑으로는 밀지 않는다", () => {
    expect(menuShiftX(20, 400, 390)).toBe(-12);
  });
});

describe("menuVerticalPlan (모바일 .dd-scope)", () => {
  const base = { viewportTop: 0, viewportBottom: 760 };
  it("아래 자리가 넉넉하면 아래로, 높이는 아래 자리", () => {
    expect(menuVerticalPlan({ ...base, menuHeight: 200, triggerTop: 100, triggerBottom: 144 })).toEqual({ up: false, maxHeight: 602 });
  });
  it("탭바 가까이에서 아래가 모자라고 위가 넓으면 위로", () => {
    expect(menuVerticalPlan({ ...base, menuHeight: 300, triggerTop: 600, triggerBottom: 644 })).toEqual({ up: true, maxHeight: 586 });
  });
  it("아래가 모자라도 위가 더 좁으면 아래로 열고 스크롤", () => {
    expect(menuVerticalPlan({ ...base, menuHeight: 900, triggerTop: 200, triggerBottom: 244 })).toEqual({ up: false, maxHeight: 502 });
  });
  it("양쪽 다 좁아도 높이는 120px(메뉴가 더 작으면 그 높이) 밑으로 줄지 않는다", () => {
    const tight = { menuHeight: 300, triggerTop: 40, triggerBottom: 84, viewportTop: 0, viewportBottom: 110 };
    expect(menuVerticalPlan(tight)).toEqual({ up: true, maxHeight: 120 });
    expect(menuVerticalPlan({ ...tight, menuHeight: 90 })).toEqual({ up: true, maxHeight: 90 });
  });
});
