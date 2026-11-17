import { describe, expect, it } from "vitest";

import { POPOVER_VIEWPORT_MARGIN, popoverAlign } from "@/components/admin/shared/popover-align";

// 공용 날짜 · 월 달력이 열리는 방향(2026-11-17) — 본문 맨 왼쪽 버튼의 달력이 왼쪽 메뉴를 덮던 문제.
describe("popoverAlign", () => {
  const width = 292;
  const button = 160;
  const right = (w: number) => w - POPOVER_VIEWPORT_MARGIN;
  const at = (triggerLeft: number, boundRight: number, boundLeft = POPOVER_VIEWPORT_MARGIN) =>
    popoverAlign({ triggerLeft, triggerRight: triggerLeft + button, popoverWidth: width, boundLeft, boundRight });

  it("오른쪽으로 펼칠 자리가 있으면 버튼 왼쪽 맞춤(start)", () => {
    // 1280 화면, 사이드바 옆 본문 맨 왼쪽(체크인 도착일)
    expect(at(272, right(1280))).toBe("start");
  });

  it("오른쪽 끝 버튼은 예전처럼 오른쪽 맞춤(end)", () => {
    expect(at(1100, right(1280))).toBe("end");
    // 딱 맞으면 start, 1px 넘치면 end
    expect(at(right(1280) - width, right(1280))).toBe("start");
    expect(at(right(1280) - width + 1, right(1280))).toBe("end");
  });

  it("창(모달) 안 오른쪽 칸은 창 오른쪽 끝을 넘으면 end", () => {
    // 화면은 넓어도 모달 몸통(오른쪽 끝 880)에서 잘리면 안 된다
    expect(at(660, Math.min(right(1440), 880))).toBe("end");
    expect(at(424, Math.min(right(1440), 880))).toBe("start");
  });

  it("양쪽 다 좁으면 자리가 넓은 쪽", () => {
    // 300px 창: 왼쪽 버튼은 오른쪽 자리가 더 넓다
    expect(at(16, right(300))).toBe("start");
    // 같은 창에서 버튼이 오른쪽에 붙으면 왼쪽 자리가 더 넓다
    expect(popoverAlign({ triggerLeft: 180, triggerRight: 280, popoverWidth: width, boundLeft: 16, boundRight: right(300) })).toBe("end");
  });

  it("왼쪽으로 펼치면 잘리는 칸(잘림 상자 왼쪽 끝)도 본다", () => {
    // 오른쪽 자리 160 · 왼쪽 자리(잘림 상자 왼쪽 520) 80 → 오른쪽
    expect(at(440, 600, 520)).toBe("start");
    // 왼쪽 경계가 넓으면(16) 왼쪽으로 다 들어가니 end
    expect(at(440, 600, 16)).toBe("end");
  });
});
