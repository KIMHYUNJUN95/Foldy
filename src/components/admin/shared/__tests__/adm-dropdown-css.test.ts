import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 모바일 `.dd-scope` 토큰이 관리자 `.adm` 값과 어긋나면 같은 드롭다운이 두 모양이 된다(2026-11-16).
const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new Map([...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
}

describe("adm-dropdown.css", () => {
  const dropdown = read("shared/adm-dropdown.css");
  const consoleCss = read("admin-console.css");

  it(".dd-scope 토큰은 .adm 의 같은 이름 값과 같다", () => {
    const scope = block(dropdown, ".dd-scope");
    const adm = block(consoleCss, ".adm");
    for (const name of ["--card", "--line", "--adm-primary", "--primary-soft", "--sh-pop", "--mono"]) expect(scope.has(name), name).toBe(true);
    for (const [name, value] of scope) expect(adm.get(name), name).toBe(value);
  });

  it("드롭다운 규칙은 .adm 과 같은 세부도(:is(.adm, .dd-scope))로만 쓴다 — 관리자 화면이 예전과 같게", () => {
    expect(dropdown).not.toMatch(/^\.adm \.dd/m);
    expect(consoleCss).not.toMatch(/^:is\(\.adm, \.dd-scope\) \.dd/m);
  });
});
