import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  areLinenPhotoUrlsAllowed,
  clampLinenRange,
  linenAllowedItemIds,
  linenRpcErrorReason,
  parseLinenLines,
} from "../linen-return-rules";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const REC = "22222222-2222-4222-8222-222222222222";
const SUB = "33333333-3333-4333-8333-333333333333";
const HOST = "https://abc.supabase.co";

function url(path: string) {
  return `${HOST}/storage/v1/object/public/request-images/${path}`;
}

const prevEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = HOST;
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = prevEnv;
});

describe("사진 주소 규칙 — 모바일 · PC 같은 함수", () => {
  it("새 주소는 {조직}/linen-returns/{폴더 id}/ 바로 아래 파일만", () => {
    expect(areLinenPhotoUrlsAllowed([url(`${ORG}/linen-returns/${SUB}/a.jpg`)], { organizationId: ORG, folderId: SUB })).toBe(true);
  });

  it("다른 조직 · 다른 폴더 · 다른 기록 · 외부 주소는 거절", () => {
    const opts = { organizationId: ORG, folderId: SUB };
    expect(areLinenPhotoUrlsAllowed([url(`${OTHER_ORG}/linen-returns/${SUB}/a.jpg`)], opts)).toBe(false);
    expect(areLinenPhotoUrlsAllowed([url(`${ORG}/order-images/${SUB}/a.jpg`)], opts)).toBe(false);
    expect(areLinenPhotoUrlsAllowed([url(`${ORG}/linen-returns/${REC}/a.jpg`)], opts)).toBe(false);
    expect(areLinenPhotoUrlsAllowed(["https://evil.example.com/a.jpg"], opts)).toBe(false);
  });

  it("수정 때 이미 저장돼 있던 주소는 폴더가 달라도 그대로 허용", () => {
    const kept = url(`${ORG}/linen-returns/${SUB}/old.jpg`);
    expect(
      areLinenPhotoUrlsAllowed([kept, url(`${ORG}/linen-returns/${REC}/new.jpg`)], {
        organizationId: ORG,
        folderId: REC,
        kept: [kept],
      }),
    ).toBe(true);
  });

  it("등록은 같은 조직 linen-returns 아래 어느 제출 폴더든(임시 저장에서 되살린 예전 id 폴더 사진)", () => {
    const opts = { organizationId: ORG, folderId: "any" as const };
    expect(areLinenPhotoUrlsAllowed([url(`${ORG}/linen-returns/${REC}/a.jpg`), url(`${ORG}/linen-returns/${SUB}/b.jpg`)], opts)).toBe(true);
    expect(areLinenPhotoUrlsAllowed([url(`${OTHER_ORG}/linen-returns/${REC}/a.jpg`)], opts)).toBe(false);
    expect(areLinenPhotoUrlsAllowed([url(`${ORG}/order-images/${REC}/a.jpg`)], opts)).toBe(false);
    expect(areLinenPhotoUrlsAllowed([url(`${ORG}/linen-returns/not-a-uuid/a.jpg`)], opts)).toBe(false);
    expect(areLinenPhotoUrlsAllowed([url(`${ORG}/linen-returns/a.jpg`)], opts)).toBe(false);
  });

  it("빈 목록은 허용", () => {
    expect(areLinenPhotoUrlsAllowed([], { organizationId: ORG, folderId: SUB })).toBe(true);
  });
});

describe("고를 수 있는 품목 — 비활성 품목은 이미 그 기록에 있던 것만", () => {
  it("건물이 같으면 기존 줄의 품목 id 를 더한다", () => {
    const ids = linenAllowedItemIds({
      activeIds: ["a", "b"],
      building: "아라키초A",
      existing: { building: "아라키초A", itemIds: ["retired"] },
    });
    expect([...ids].sort()).toEqual(["a", "b", "retired"]);
  });

  it("건물을 바꾸면 기존 줄의 비활성 품목은 받지 않는다", () => {
    const ids = linenAllowedItemIds({
      activeIds: ["a"],
      building: "오쿠보A",
      existing: { building: "아라키초A", itemIds: ["retired"] },
    });
    expect(ids.has("retired")).toBe(false);
  });

  it("새 등록은 활성 품목만", () => {
    expect([...linenAllowedItemIds({ activeIds: ["a"], building: "x" })]).toEqual(["a"]);
  });
});

describe("품목 줄 검사", () => {
  const allowed = new Set(["a", "b"]);
  it("정상 줄은 그대로", () => {
    expect(parseLinenLines([{ itemId: "a", quantity: 2 }, { itemId: "b", quantity: "3" }], allowed)).toEqual({
      ok: true,
      lines: [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 3 },
      ],
    });
  });
  it("모르는 품목 · 0 · 소수 · 중복 · 빈 목록", () => {
    expect(parseLinenLines([{ itemId: "z", quantity: 1 }], allowed)).toEqual({ ok: false, reason: "invalid_item" });
    expect(parseLinenLines([{ itemId: "a", quantity: 0 }], allowed)).toEqual({ ok: false, reason: "invalid_quantity" });
    expect(parseLinenLines([{ itemId: "a", quantity: 1.5 }], allowed)).toEqual({ ok: false, reason: "invalid_quantity" });
    expect(parseLinenLines([{ itemId: "a", quantity: 1 }, { itemId: "a", quantity: 1 }], allowed)).toEqual({
      ok: false,
      reason: "duplicate_item",
    });
    expect(parseLinenLines([], allowed)).toEqual({ ok: false, reason: "missing_items" });
  });
  it("정수 범위를 넘는 수량은 거절(DB integer)", () => {
    expect(parseLinenLines([{ itemId: "a", quantity: 3_000_000_000 }], allowed)).toEqual({
      ok: false,
      reason: "invalid_quantity",
    });
  });
});

describe("관리자 조회 기간 상한", () => {
  it("366일 이하는 그대로, 거꾸로면 바로잡는다", () => {
    expect(clampLinenRange("2026-01-01", "2026-12-31")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(clampLinenRange("2026-03-31", "2026-03-01")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });
  it("366일을 넘으면 끝 날짜 기준으로 366일만", () => {
    expect(clampLinenRange("2020-01-01", "2026-12-31")).toEqual({ from: "2025-12-31", to: "2026-12-31" });
  });
});

describe("DB 함수 오류 → 화면 오류 코드", () => {
  it("함수가 던지는 이름표를 읽는다", () => {
    expect(linenRpcErrorReason("linen:too_many_photos_merged")).toBe("too_many_photos_merged");
    expect(linenRpcErrorReason("linen:too_many_photos")).toBe("too_many_photos");
    expect(linenRpcErrorReason("linen:stale")).toBe("stale");
    expect(linenRpcErrorReason("linen:not_found")).toBe("not_found");
    expect(linenRpcErrorReason("linen:forbidden")).toBe("forbidden");
  });
  it("모르는 오류는 null", () => {
    expect(linenRpcErrorReason("new row violates row-level security policy")).toBeNull();
    expect(linenRpcErrorReason(undefined)).toBeNull();
  });
});
