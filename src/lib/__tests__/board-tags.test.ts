import { describe, expect, it } from "vitest";
import { BOARD_MAX_TAGS, BOARD_TAG_MAX_LENGTH, normalizeBoardTags } from "@/lib/board";

describe("normalizeBoardTags — 서버 상한", () => {
  it("개수 10 · 길이 30 으로 자른다", () => {
    const many = Array.from({ length: 25 }, (_, i) => `t${i}`);
    expect(normalizeBoardTags(many)).toHaveLength(BOARD_MAX_TAGS);
    expect(normalizeBoardTags(["a".repeat(100)])[0]).toHaveLength(BOARD_TAG_MAX_LENGTH);
  });
  it("공백 · 앞의 # · 빈 값 · 중복을 정리한다", () => {
    expect(normalizeBoardTags([" #공지 ", "", "공지", "  "])).toEqual(["공지"]);
  });
  it("배열이 아니거나 문자열이 아닌 값은 버린다", () => {
    expect(normalizeBoardTags("x" as never)).toEqual([]);
    expect(normalizeBoardTags(["a", 1, null] as never)).toEqual(["a"]);
  });
});
