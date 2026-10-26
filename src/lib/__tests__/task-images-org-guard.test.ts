import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOrgTaskImageUrl, mergeTaskImageUrls, sanitizeTaskImageUrls } from "@/lib/task-images";

const BASE = "https://proj.supabase.co";
const ORG = "org-1";
const pub = (path: string) => `${BASE}/storage/v1/object/public/request-images/${path}`;

describe("isOrgTaskImageUrl — 우리 스토리지 · 우리 조직 폴더만 (2026-10-26)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  it("조직 task-images 폴더의 공개 URL 은 받는다", () => {
    expect(isOrgTaskImageUrl(pub(`${ORG}/task-images/req/a.jpg`), ORG)).toBe(true);
  });
  it("다른 조직 · 다른 폴더 · 외부 호스트 · http 는 거절한다", () => {
    expect(isOrgTaskImageUrl(pub(`org-2/task-images/req/a.jpg`), ORG)).toBe(false);
    expect(isOrgTaskImageUrl(pub(`${ORG}/order-images/req/a.jpg`), ORG)).toBe(false);
    expect(isOrgTaskImageUrl(`https://evil.example.com/storage/v1/object/public/request-images/${ORG}/task-images/r/a.jpg`, ORG)).toBe(false);
    expect(isOrgTaskImageUrl(pub(`${ORG}/task-images/req/a.jpg`).replace("https:", "http:"), ORG)).toBe(false);
  });
  it("`..` 로 접두사만 맞춘 경로는 거절한다", () => {
    expect(isOrgTaskImageUrl(pub(`${ORG}/task-images/%2E%2E/%2E%2E/org-2/task-images/r/a.jpg`), ORG)).toBe(false);
  });
  it("메모 사진은 task-update-images 폴더로 따로 본다", () => {
    const u = pub(`${ORG}/task-update-images/req/a.jpg`);
    expect(isOrgTaskImageUrl(u, ORG, "task-update-images")).toBe(true);
    expect(isOrgTaskImageUrl(u, ORG)).toBe(false);
  });
  it("생성 sanitize · 편집 merge 는 조직을 주면 남의 URL 을 버린다(기존 사진은 유지)", () => {
    const mine = pub(`${ORG}/task-images/req/a.jpg`);
    const foreign = "https://example.com/x.jpg";
    expect(sanitizeTaskImageUrls([mine, foreign, mine], false, ORG)).toEqual([mine]);
    // 이미 붙어 있던 사진(previous)은 규칙과 무관하게 남는다 — 새로 붙인 것만 검사.
    expect(mergeTaskImageUrls([foreign], [foreign, mine, pub("org-2/task-images/r/b.jpg")], false, ORG)).toEqual([
      foreign,
      mine,
    ]);
  });
});
