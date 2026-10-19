import { describe, expect, it } from "vitest";
import { mergeTaskImageUrls, sanitizeTaskImageUrls } from "@/lib/task-images";

const url = (n: number) => `https://x.supabase.co/storage/v1/object/public/request-images/o/task-images/t/${n}.jpg`;
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => url(from + i));

describe("mergeTaskImageUrls — 기존 사진은 상한에 잘리지 않는다 (2026-10-19)", () => {
  it("프로젝트에서 빠진 15장(상한 5)을 그대로 둔다", () => {
    expect(mergeTaskImageUrls(range(0, 15), range(0, 15), false)).toEqual(range(0, 15));
  });
  it("상한을 넘은 상태에서 새 사진은 받지 않는다", () => {
    expect(mergeTaskImageUrls(range(0, 15), [...range(0, 15), url(99)], false)).toEqual(range(0, 15));
  });
  it("상한 아래에서는 새 사진을 남은 칸만큼 받는다", () => {
    expect(mergeTaskImageUrls(range(0, 3), [...range(0, 3), url(7), url(8), url(9)], false)).toEqual([
      ...range(0, 3),
      url(7),
      url(8),
    ]);
  });
  it("http(s) 가 아니거나 중복이면 버린다", () => {
    expect(mergeTaskImageUrls([url(1)], [url(1), url(1), "javascript:x", url(2)], true)).toEqual([url(1), url(2)]);
  });
  it("생성용 sanitize 는 그대로 상한을 적용한다", () => {
    expect(sanitizeTaskImageUrls(range(0, 8), false)).toHaveLength(5);
  });
});
