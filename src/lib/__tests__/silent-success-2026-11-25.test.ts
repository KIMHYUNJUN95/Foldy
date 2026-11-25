import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 실패가 성공으로 돌아오던 세 곳(2026-11-25) — 결과를 버리는 쓰기가 다시 생기지 않게 소스 모양을 지킨다.
const read = (p: string) => readFileSync(p, "utf8");
const body = (src: string, start: string, end: string) => {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  expect(a).toBeGreaterThan(-1);
  return src.slice(a, b > a ? b : undefined);
};

describe("휴게 끝내기", () => {
  const fn = body(read("src/app/mobile/attendance/actions.ts"), "export async function endBreak", "// ── 정정");
  it("읽기 실패는 error, 쓰기 결과는 바뀐 줄까지 확인한다", () => {
    expect(fn).toMatch(/openBreakRes\.error\)\s*\{[\s\S]*reason: "error"/);
    expect(fn).toContain('.select("id")');
    expect(fn).toMatch(/length === 0\) return \{ ok: false/);
  });
});
