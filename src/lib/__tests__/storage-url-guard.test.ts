import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOwnStoragePublicUrl, storagePathFromPublicUrl } from "@/lib/storage-url-guard";
import { isValidLostItemTransition, splitLostFoundHandlingMemo } from "@/lib/lost-found-handling";

const BASE = "https://abc.supabase.co";
const ORG = "11111111-1111-1111-1111-111111111111";
const ID = "22222222-2222-2222-2222-222222222222";
const pub = (path: string) => `${BASE}/storage/v1/object/public/request-images/${path}`;

describe("isOwnStoragePublicUrl", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE));
  afterEach(() => vi.unstubAllEnvs());

  const prefix = `${ORG}/maintenance-resolutions/${ID}/`;

  it("accepts a file directly under the prefix", () => {
    expect(isOwnStoragePublicUrl(pub(`${prefix}a1b2.jpg`), "request-images", prefix)).toBe(true);
  });

  it("rejects another org, another folder, another record", () => {
    expect(isOwnStoragePublicUrl(pub(`99999999-9999-9999-9999-999999999999/maintenance-resolutions/${ID}/a.jpg`), "request-images", prefix)).toBe(false);
    expect(isOwnStoragePublicUrl(pub(`${ORG}/lost-items/${ID}/a.jpg`), "request-images", prefix)).toBe(false);
    expect(isOwnStoragePublicUrl(pub(`${ORG}/maintenance-resolutions/other/a.jpg`), "request-images", prefix)).toBe(false);
  });

  it("rejects foreign hosts, other buckets, traversal and deeper paths", () => {
    expect(isOwnStoragePublicUrl(`https://evil.example/storage/v1/object/public/request-images/${prefix}a.jpg`, "request-images", prefix)).toBe(false);
    expect(isOwnStoragePublicUrl(`${BASE}/storage/v1/object/public/other/${prefix}a.jpg`, "request-images", prefix)).toBe(false);
    expect(isOwnStoragePublicUrl(pub(`${prefix}../x/a.jpg`), "request-images", prefix)).toBe(false);
    expect(isOwnStoragePublicUrl(pub(`${prefix}x/a.jpg`), "request-images", prefix)).toBe(false);
    expect(isOwnStoragePublicUrl("not a url", "request-images", prefix)).toBe(false);
    expect(isOwnStoragePublicUrl(`${pub(`${prefix}a.jpg`)}?x=1`, "request-images", prefix)).toBe(false);
  });

  it("allows one random subfolder when asked (suggestions / complaints)", () => {
    const p = `${ORG}/suggestion-images/`;
    expect(isOwnStoragePublicUrl(pub(`${p}${ID}/a.png`), "request-images", p, { subfolders: 1 })).toBe(true);
    expect(isOwnStoragePublicUrl(pub(`${p}a.png`), "request-images", p, { subfolders: 1 })).toBe(false);
  });

  it("extracts the bucket path", () => {
    expect(storagePathFromPublicUrl(pub(`${prefix}a.jpg`), "request-images")).toBe(`${prefix}a.jpg`);
  });
});

describe("lost-found handling rules", () => {
  it("only allows one step forward, return from any active state, and nothing out of terminal", () => {
    expect(isValidLostItemTransition("registered", "stored")).toBe(true);
    expect(isValidLostItemTransition("registered", "disposed")).toBe(false);
    expect(isValidLostItemTransition("stored", "returned")).toBe(true);
    expect(isValidLostItemTransition("disposed", "stored")).toBe(false);
    expect(isValidLostItemTransition("returned", "returned")).toBe(true);
  });

  it("splits admin-restore system lines out of the editable memo", () => {
    const memo = "보관함 B\n[stayops:admin_restore] 실수로 폐기";
    expect(splitLostFoundHandlingMemo(memo)).toEqual({
      editable: "보관함 B",
      systemLines: ["[stayops:admin_restore] 실수로 폐기"],
    });
    expect(splitLostFoundHandlingMemo(null)).toEqual({ editable: "", systemLines: [] });
  });
});
