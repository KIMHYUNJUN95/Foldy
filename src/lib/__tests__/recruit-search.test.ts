import { describe, expect, it } from "vitest";
import { filterApplicationsBySearch, recruitCloseHref, recruitSearchWithQuery } from "@/lib/recruit/search";

/**
 * 「한 글자만 쳐도 바로, 지우면 바로 전체」 (2026-09-11).
 *
 * 예전에는 검색어가 쿼리스트링이라 Enter 를 눌러야 서버가 다시 걸렀고, 글자를 지워도 응답이
 * 올 때까지 목록이 넓어지지 않았다. 이제 브라우저에서 거른다.
 */
const rows = [
  { name: "최지민", phoneTail: "1234" },
  { name: "최민수", phoneTail: "5678" },
  { name: "김민규", phoneTail: "1234" },
  { name: "Park Jiwon", phoneTail: null },
];

describe("filterApplicationsBySearch", () => {
  it("한 글자만 쳐도 관련된 이름이 나온다", () => {
    expect(filterApplicationsBySearch(rows, "최").map((r) => r.name)).toEqual(["최지민", "최민수"]);
    expect(filterApplicationsBySearch(rows, "민").map((r) => r.name)).toEqual([
      "최지민",
      "최민수",
      "김민규",
    ]);
  });

  it("지우면 전체가 그대로 돌아온다", () => {
    expect(filterApplicationsBySearch(rows, "")).toHaveLength(rows.length);
    // 공백만 남은 경우도 「검색 안 함」이다 — 아니면 다 사라진 것처럼 보인다.
    expect(filterApplicationsBySearch(rows, "   ")).toHaveLength(rows.length);
  });

  it("전화번호 뒤 4자리로 찾는다", () => {
    expect(filterApplicationsBySearch(rows, "1234").map((r) => r.name)).toEqual(["최지민", "김민규"]);
    expect(filterApplicationsBySearch(rows, "5678").map((r) => r.name)).toEqual(["최민수"]);
  });

  it("전화번호가 없는 지원자 때문에 터지지 않는다", () => {
    expect(filterApplicationsBySearch(rows, "9999")).toHaveLength(0);
    expect(filterApplicationsBySearch(rows, "park").map((r) => r.name)).toEqual(["Park Jiwon"]);
  });

  it("대소문자를 가리지 않는다 — 서버의 ilike 와 같은 동작", () => {
    expect(filterApplicationsBySearch(rows, "PARK")).toHaveLength(1);
    expect(filterApplicationsBySearch(rows, "jiwon")).toHaveLength(1);
  });

  it("맞는 게 없으면 빈 목록이다", () => {
    expect(filterApplicationsBySearch(rows, "홍길동")).toHaveLength(0);
  });
});

describe("recruitSearchWithQuery", () => {
  it("검색어를 q 로 넣고 다른 필터는 그대로 둔다", () => {
    expect(recruitSearchWithQuery("?status=screening", "최지민")).toBe(
      "?status=screening&q=%EC%B5%9C%EC%A7%80%EB%AF%BC",
    );
  });
  it("이미 있는 q 를 바꾼다", () => {
    expect(recruitSearchWithQuery("?q=a&job=x", "ab")).toBe("?q=ab&job=x");
  });
  it("비었거나 공백뿐이면 q 를 지운다", () => {
    expect(recruitSearchWithQuery("?q=a", "")).toBe("");
    expect(recruitSearchWithQuery("?q=a&job=x", "   ")).toBe("?job=x");
  });
});

describe("recruitCloseHref", () => {
  it("지금 주소의 q 와 필터를 두고 application 만 뺀다", () => {
    expect(recruitCloseHref("?status=screening&q=ab&application=x")).toBe("/admin/recruit?status=screening&q=ab");
  });
  it("남는 게 없으면 쿼리 없이", () => {
    expect(recruitCloseHref("?application=x")).toBe("/admin/recruit");
  });
});
