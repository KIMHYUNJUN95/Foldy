import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestImageSrc, requestImageSrcs } from "@/lib/request-image-src";

const BASE = "https://proj.supabase.co";
const ORG = "11111111-1111-4111-8111-111111111111";
const REC = "22222222-2222-4222-8222-222222222222";
const PATH = `${ORG}/complaint-images/${REC}/a.jpg`;
const ROUTE = `/api/request-images/${PATH}`;

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
});

describe("requestImageSrc", () => {
  it("우리 공개 주소 → 라우트", () => {
    expect(requestImageSrc(`${BASE}/storage/v1/object/public/request-images/${PATH}`)).toBe(ROUTE);
  });
  it("서명 주소(토큰 포함) → 라우트", () => {
    expect(requestImageSrc(`${BASE}/storage/v1/object/sign/request-images/${PATH}?token=abc`)).toBe(ROUTE);
  });
  it("버킷 안 경로 → 라우트", () => {
    expect(requestImageSrc(PATH)).toBe(ROUTE);
  });
  it("이미 라우트 주소면 그대로", () => {
    expect(requestImageSrc(ROUTE)).toBe(ROUTE);
  });
  it("다른 프로젝트 주소는 그대로", () => {
    const other = `https://other.supabase.co/storage/v1/object/public/request-images/${PATH}`;
    expect(requestImageSrc(other)).toBe(other);
  });
  it("다른 버킷은 그대로", () => {
    const other = `${BASE}/storage/v1/object/public/announcement-images/${PATH}`;
    expect(requestImageSrc(other)).toBe(other);
  });
  it("blob: · 외부 주소 · 빈 값", () => {
    expect(requestImageSrc("blob:http://localhost/123")).toBe("blob:http://localhost/123");
    expect(requestImageSrc("https://example.com/x.png")).toBe("https://example.com/x.png");
    expect(requestImageSrc("")).toBe("");
    expect(requestImageSrc(null)).toBe("");
    expect(requestImageSrc(undefined)).toBe("");
  });
  it("`..` 가 섞인 경로는 라우트로 바꾸지 않는다", () => {
    const bad = `${BASE}/storage/v1/object/public/request-images/${ORG}/x/%2E%2E/a.jpg`;
    expect(requestImageSrc(bad)).toBe(bad);
  });
  it("환경변수가 없으면 공개 주소도 그대로", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const url = `${BASE}/storage/v1/object/public/request-images/${PATH}`;
    expect(requestImageSrc(url)).toBe(url);
  });
  it("배열", () => {
    expect(requestImageSrcs([PATH, null, "blob:x"])).toEqual([ROUTE, "", "blob:x"]);
    expect(requestImageSrcs(null)).toEqual([]);
  });
});
