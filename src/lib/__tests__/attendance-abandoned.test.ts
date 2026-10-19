import { describe, expect, it } from "vitest";

import { ATTENDANCE_SESSION_STATUSES } from "@/lib/attendance";

/**
 * `abandoned` 계약 가드 (2026-08-04).
 *
 * 어제 퇴근을 깜빡한 세션 하나가 오늘 출근을 통째로 막고 있었다(실제 20일). 그 수정의 핵심은
 * **막을 것은 마감이지 출근이 아니다** 라는 규칙인데, 여기 얽힌 조건이 여러 파일에 흩어져 있어
 * 한 곳만 되돌려도 조용히 옛 동작으로 돌아간다. 소스를 직접 읽어 그 조건들이 살아 있는지 본다.
 */
describe("abandoned attendance session contract", () => {
  it("is a known session status", () => {
    expect(ATTENDANCE_SESSION_STATUSES).toContain("abandoned");
  });

  it("월 마감은 abandoned 를 미해소로 센다", async () => {
    const src = await import("fs").then((fs) =>
      fs.readFileSync("src/lib/attendance-finalization.ts", "utf8"),
    );
    // 이 조건이 빠지면 미퇴근인 달이 그대로 닫힌다 — 급여에서 빠진 채로.
    expect(src).toContain('s.status === "abandoned"');
  });

  it("급여 집계에서 abandoned 를 제외한다", async () => {
    const src = await import("fs").then((fs) =>
      fs.readFileSync("src/lib/attendance-pay-calculation.ts", "utf8"),
    );
    // 판정은 급여 공용 계산(`payExcludeReason`) 한 곳에 있다(2026-10-19).
    expect(src).toContain('if (s.status === "abandoned") return "abandoned"');
  });

  it("관리자 수정으로 abandoned 를 닫을 수 있다", async () => {
    const src = await import("fs").then((fs) =>
      fs.readFileSync("src/app/admin/attendance/actions.ts", "utf8"),
    );
    // 이 전이가 없으면 방치 세션을 정리할 방법이 사라진다.
    expect(src).toContain('(s.status === "open" || s.status === "abandoned") && resultingIn && resultingOut');
  });

  it("지난 운영일 세션은 출근을 막지 않는다", async () => {
    const src = await import("fs").then((fs) =>
      fs.readFileSync("src/app/mobile/attendance/actions.ts", "utf8"),
    );
    expect(src).toContain('status: "abandoned"');
    expect(src).toContain("openSession.operating_date !== tokyoDate(");
  });
});
