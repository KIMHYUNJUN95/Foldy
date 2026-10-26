import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  areOwnBoardImageUrls,
  isOwnBoardAttachmentPath,
  sanitizeBoardAttachments,
} from "@/app/mobile/board/board-storage-guard";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const POST = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";
const BASE = "https://example.supabase.co";

describe("board storage guard (2026-10-26)", () => {
  const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  it("accepts attachment paths in this org/post folder only", () => {
    expect(isOwnBoardAttachmentPath(`${ORG}/${POST}/${FILE}.pdf`, ORG, POST)).toBe(true);
    expect(isOwnBoardAttachmentPath(`${ORG}/${POST}/${FILE}.vnd.ms-excel`, ORG, POST)).toBe(true);
    expect(isOwnBoardAttachmentPath(`${OTHER_ORG}/${POST}/${FILE}.pdf`, ORG, POST)).toBe(false);
    expect(isOwnBoardAttachmentPath(`${ORG}/${POST}/../x/${FILE}.pdf`, ORG, POST)).toBe(false);
    expect(isOwnBoardAttachmentPath(`${ORG}/${POST}/sub/${FILE}.pdf`, ORG, POST)).toBe(false);
    expect(isOwnBoardAttachmentPath(`${ORG}/${POST}/${FILE}..pdf`, ORG, POST)).toBe(false);
  });

  it("accepts our public image URLs under the org folder only", () => {
    const own = `${BASE}/storage/v1/object/public/request-images/${ORG}/board-posts/${POST}/${FILE}.jpg`;
    expect(areOwnBoardImageUrls([own], ORG, POST, "board-posts")).toBe(true);
    expect(areOwnBoardImageUrls([own], ORG, POST, "board-comments")).toBe(false);
    expect(areOwnBoardImageUrls(["https://evil.example/x.jpg"], ORG, POST, "board-posts")).toBe(false);
    expect(areOwnBoardImageUrls([own.replace(ORG, OTHER_ORG)], ORG, POST, "board-posts")).toBe(false);
    expect(areOwnBoardImageUrls(["https://legacy/x.jpg"], ORG, POST, "board-posts", new Set(["https://legacy/x.jpg"]))).toBe(true);
  });

  it("rebuilds attachments with known fields and rejects foreign paths", () => {
    const good = { name: "a.pdf", url: `${ORG}/${POST}/${FILE}.pdf`, sizeBytes: 10, mimeType: "application/pdf", extra: 1 };
    expect(sanitizeBoardAttachments([good], ORG, POST)).toEqual([
      { name: "a.pdf", url: good.url, sizeBytes: 10, mimeType: "application/pdf" },
    ]);
    expect(sanitizeBoardAttachments([{ ...good, url: `${OTHER_ORG}/${POST}/${FILE}.pdf` }], ORG, POST)).toBeNull();
    expect(sanitizeBoardAttachments("nope", ORG, POST)).toBeNull();
  });
});
