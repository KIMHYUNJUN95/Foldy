import { beforeEach, describe, expect, it, vi } from "vitest";

/** 새로 붙인 사진만 「내가 올린 파일」인지 본다 — 할 일 · 메모 · 제안 저장(2026-11-27, 주소 끼워 넣기 막기). */
vi.mock("server-only", () => ({}));

import { newRequestImagesOwnedBy } from "@/lib/request-image-owners";

const BASE = "https://proj.supabase.co";
const ORG = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const path = (name: string) => `${ORG}/task-images/22222222-2222-4222-8222-222222222222/${name}`;
const url = (name: string) => `${BASE}/storage/v1/object/public/request-images/${path(name)}`;

let owners: Record<string, string>;
let rpcFails: boolean;
let calls: string[][];
const client = {
  rpc: async (_fn: "request_image_owners", args: { p_names: string[] }) => {
    calls.push(args.p_names);
    if (rpcFails) return { data: null, error: { message: "x" } };
    return {
      data: args.p_names.filter((n) => owners[n]).map((n) => ({ name: n, owner_id: owners[n] })),
      error: null,
    };
  },
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  owners = { [path("mine.jpg")]: ME, [path("theirs.jpg")]: OTHER };
  rpcFails = false;
  calls = [];
});

describe("newRequestImagesOwnedBy", () => {
  it("새 주소가 모두 내가 올린 것 → true", async () => {
    expect(await newRequestImagesOwnedBy(client, [url("mine.jpg")], [], ME)).toBe(true);
  });
  it("남이 올린 주소를 새로 붙이면 false", async () => {
    expect(await newRequestImagesOwnedBy(client, [url("mine.jpg"), url("theirs.jpg")], [], ME)).toBe(false);
  });
  it("이미 그 기록에 있던 주소는 묻지 않는다 — 남의 사진을 유지하는 수정 · 새 주소 없으면 조회 없음", async () => {
    expect(await newRequestImagesOwnedBy(client, [url("theirs.jpg")], [url("theirs.jpg")], ME)).toBe(true);
    expect(calls).toEqual([]);
    expect(await newRequestImagesOwnedBy(client, [url("theirs.jpg"), url("mine.jpg")], [url("theirs.jpg")], ME)).toBe(true);
    expect(calls).toEqual([[path("mine.jpg")]]);
  });
  it("없는 파일 · 우리 저장소 주소가 아닌 새 주소 → false", async () => {
    expect(await newRequestImagesOwnedBy(client, [url("gone.jpg")], [], ME)).toBe(false);
    expect(await newRequestImagesOwnedBy(client, ["https://evil.example/x.jpg"], [], ME)).toBe(false);
  });
  it("주인을 못 읽으면 error", async () => {
    rpcFails = true;
    expect(await newRequestImagesOwnedBy(client, [url("mine.jpg")], [], ME)).toBe("error");
  });
});
