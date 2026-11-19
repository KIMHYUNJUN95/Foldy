import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /onboarding 은 폰 마법사 스타일(onboarding-wizard.css)과 PC 스타일(desktop-onboarding.css)을 한 번들에 같이 싣는다.
 * 2026-11-19 까지 둘 다 `.obd` 를 써서 PC `.obd__org`(회색 상자 · flex)가 폰 완료 문장 속 조직 이름에,
 * 폰 `.obd { overflow: hidden }` 이 PC 화면에 샜다. 두 파일의 클래스 이름이 겹치지 않는지 지킨다.
 */
const dir = path.resolve("src/app/onboarding");
const read = (name: string) => readFileSync(path.join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function classNames(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g), (m) => m[1]));
}
function keyframes(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/@keyframes\s+([\w-]+)/g), (m) => m[1]));
}

describe("온보딩 CSS 이름 겹침", () => {
  const wizard = read("onboarding-wizard.css");
  const desktop = read("desktop-onboarding.css");

  it("폰 마법사와 PC 화면이 같은 클래스 이름을 쓰지 않는다", () => {
    const pc = classNames(desktop);
    const shared = [...classNames(wizard)].filter((name) => pc.has(name));
    expect(shared).toEqual([]);
  });

  it("폰 마법사 클래스는 obm · obw 앞머리만 쓴다", () => {
    // 예외: 굵기 유틸 두 개 — `.obw-main` 안에서만 globals 의 `button { font: inherit }` 를 이겨 굵기를 되살린다.
    const allowed = new Set(["font-semibold", "font-medium"]);
    const stray = [...classNames(wizard)].filter((name) => !/^ob[mw](-|__|$)/.test(name) && !allowed.has(name));
    expect(stray).toEqual([]);
  });

  it("폰 마법사 화면은 PC 클래스(obd)를, PC 화면은 폰 클래스(obm · obw)를 쓰지 않는다", () => {
    const src = (name: string) => readFileSync(path.join(dir, name), "utf8");
    expect(src("onboarding-wizard.tsx").match(/\bobd(__|-|\b)/g) ?? []).toEqual([]);
    expect(src("desktop-onboarding.tsx").match(/\bob[mw](__|-|\b)/g) ?? []).toEqual([]);
  });

  it("애니메이션 이름도 겹치지 않는다", () => {
    const pc = keyframes(desktop);
    expect([...keyframes(wizard)].filter((name) => pc.has(name))).toEqual([]);
  });

  it("예전 파일(onboarding-done.css)은 다시 생기지 않는다", () => {
    expect(() => readFileSync(path.join(dir, "onboarding-done.css"))).toThrow();
  });
});

describe("온보딩 줄바꿈 · 폭 회귀", () => {
  it("PC 화면 최상위(.obd)에도 ko keep-all · ja auto-phrase 규칙이 있다", () => {
    const desktop = read("desktop-onboarding.css");
    expect(desktop).toMatch(/\.obd:lang\(ko\)\s*\{[^}]*word-break:\s*keep-all/);
    expect(desktop).toMatch(/\.obd:lang\(ja\)\s*\{[^}]*word-break:\s*auto-phrase/);
  });

  it("폰 전화번호 칸(flex-1 input)에 min-w-0 이 있어 줄 밖으로 넓어지지 않는다", () => {
    const src = readFileSync(path.join(dir, "onboarding-wizard.tsx"), "utf8");
    const tel = src.match(/<input[^>]*type="tel"[\s\S]*?\/>/);
    expect(tel).not.toBeNull();
    expect(tel![0]).toMatch(/className="[^"]*\bmin-w-0\b/);
  });
});
