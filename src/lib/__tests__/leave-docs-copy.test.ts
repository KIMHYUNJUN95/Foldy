import { describe, expect, it } from "vitest";
import { getDictionary } from "@/lib/i18n";

const JA = /[぀-ヿ㐀-鿿]/;

describe("연차 문서 빈 상태 — ko 에 일본어가 남지 않는다", () => {
  it("docsEmptyTitle · docsEmptyBody 에 가나 · 한자가 없다", () => {
    const leave = getDictionary("ko").admin.leaveConsole;
    expect(leave.docsEmptyTitle).not.toMatch(JA);
    expect(leave.docsEmptyBody).not.toMatch(JA);
  });

  it("ko leaveConsole 문구 전체에 일본어가 없다(서류 이름 포함)", () => {
    const hits = Object.entries(getDictionary("ko").admin.leaveConsole).filter(([, v]) => typeof v === "string" && JA.test(v));
    expect(hits).toEqual([]);
  });
});

describe("연차 문구 — en 에 일본어가 남지 않는다", () => {
  it("en leaveConsole 문자열(함수는 대표 인자로 호출)에 가나 · 한자가 없다", () => {
    const hits = Object.entries(getDictionary("en").admin.leaveConsole).flatMap(([k, v]) => {
      const out = typeof v === "function" ? (v as (...a: string[]) => unknown)("Kim", "2026-01-01", "x") : v;
      return typeof out === "string" && JA.test(out) ? [[k, out]] : [];
    });
    expect(hits).toEqual([]);
  });
});
