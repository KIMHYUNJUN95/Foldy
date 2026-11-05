import { describe, expect, it } from "vitest";

import { addressError, japanFlagChanged, normalizeAddress } from "../guest/address";
import { applyAddressPlan, companionsSharingOldAddress, planAddresses, type AddressGuest } from "../guest/address-plan";
import { guestInputSchema } from "../guest/fields";
import { completionBlock } from "../kiosk/complete";

import cases from "../guest/address-cases.json";

// 공용 사례표(address-cases.json): 서버 · 웹 · 태블릿(Kotlin)이 같은 결과를 내야 한다.
describe("addressError — 공용 사례표", () => {
  for (const item of cases) {
    it(`${item.name}${item.hasJapanAddress ? " (일본 거주)" : " (외국인)"}`, () => {
      expect(addressError(item.text, item.hasJapanAddress)).toBe(item.error);
    });
  }
});

describe("normalizeAddress", () => {
  it("양끝 쉼표 · 줄바꿈 · 겹친 공백을 정리한다", () => {
    expect(normalizeAddress("  Japan,\n Tokyo \r\n 1-2-3   Ginza ")).toBe("Japan, Tokyo, 1-2-3 Ginza");
    expect(normalizeAddress("USA, Boston\n")).toBe("USA, Boston");
    expect(normalizeAddress(",USA, Boston,")).toBe("USA, Boston");
  });
  it("NFC · NBSP · 곡선 따옴표 · 긴 줄표를 ASCII 로", () => {
    expect(normalizeAddress("E\u0301cole")).toBe("\u00C9cole");
    expect(normalizeAddress("O\u2019Connell\u00A0St \u2013 5")).toBe("O'Connell St - 5");
  });
});

describe("japanFlagChanged", () => {
  it("실제로 바뀔 때만 true, 모름(null)은 외국인으로 센다", () => {
    expect(japanFlagChanged(false, true)).toBe(true);
    expect(japanFlagChanged(true, false)).toBe(true);
    expect(japanFlagChanged(true, true)).toBe(false);
    expect(japanFlagChanged(null, false)).toBe(false);
    expect(japanFlagChanged(undefined, true)).toBe(true);
  });
});

describe("guestInputSchema — 주소를 보내면 같은 검사", () => {
  const base = { lastName: "A", firstName: "B", guestType: "adult", hasJapanAddress: false };
  it("주소를 안 보내면 null, 보내면 정리해서 저장", () => {
    const none = guestInputSchema.safeParse(base);
    expect(none.success && none.data.address).toBeNull();
    const ok = guestInputSchema.safeParse({ ...base, address: " USA, Boston,\n12 Main St " });
    expect(ok.success && ok.data.address).toBe("USA, Boston, 12 Main St");
  });
  it("외국인의 비라틴 · 짧은 주소는 address 칸 오류", () => {
    for (const address of ["USA", "한국 서울시 강남구 1번지"]) {
      const bad = guestInputSchema.safeParse({ ...base, address });
      expect(bad.success).toBe(false);
      if (!bad.success) expect(bad.error.issues.map((i) => i.path.join("."))).toEqual(["address"]);
    }
    expect(guestInputSchema.safeParse({ ...base, hasJapanAddress: true, address: "東京都新宿区1-2-3" }).success).toBe(true);
  });
});

describe("planAddresses — 분배", () => {
  const guests: AddressGuest[] = [
    { id: "rep", is_representative: true, has_japan_address: false },
    { id: "c1", is_representative: false, has_japan_address: false },
    { id: "c2", is_representative: false, has_japan_address: false },
  ];
  const REP = "USA, Boston, 12 Main St";

  it("모두 같으면 대표자 글 하나에 전원", () => {
    expect(planAddresses(guests, REP, [])).toEqual({ ok: true, groups: [{ address: REP, ids: ["rep", "c1", "c2"] }] });
  });
  it("다른 사람만 따로, 나머지는 대표자 글", () => {
    const plan = planAddresses(guests, REP, [{ guestId: "c2", address: "Canada, Toronto, 5 King St" }]);
    expect(plan).toEqual({
      ok: true,
      groups: [
        { address: REP, ids: ["rep", "c1"] },
        { address: "Canada, Toronto, 5 King St", ids: ["c2"] },
      ],
    });
  });
  it("일본 거주 대표자 주소를 외국 동행자가 그대로 받는다(글자 검사 없음)", () => {
    const mixed: AddressGuest[] = [
      { id: "rep", is_representative: true, has_japan_address: true },
      { id: "c1", is_representative: false, has_japan_address: false },
    ];
    expect(planAddresses(mixed, "東京都新宿区1-2-3", [])).toEqual({ ok: true, groups: [{ address: "東京都新宿区1-2-3", ids: ["rep", "c1"] }] });
    // 하지만 그 외국 동행자가 「다른 사람」이면 영문만.
    const bad = planAddresses(mixed, "東京都新宿区1-2-3", [{ guestId: "c1", address: "東京都渋谷区1-2-3" }]);
    expect(bad).toEqual({ ok: false, fields: ["address.c1"] });
  });
  it("대표자 글이 틀리면 address", () => {
    expect(planAddresses(guests, "USA", [])).toEqual({ ok: false, fields: ["address"] });
    expect(planAddresses(guests, "한국 서울시 강남구 1번지", [])).toEqual({ ok: false, fields: ["address"] });
  });
  it("예약에 없는 사람 · 대표자 · 중복은 거절", () => {
    expect(planAddresses(guests, REP, [{ guestId: "zzz", address: "Canada, Toronto, 5 King St" }])).toEqual({ ok: false, fields: ["address.zzz"] });
    expect(planAddresses(guests, REP, [{ guestId: "rep", address: "Canada, Toronto, 5 King St" }])).toEqual({ ok: false, fields: ["address.rep"] });
    const dup = { guestId: "c1", address: "Canada, Toronto, 5 King St" };
    expect(planAddresses(guests, REP, [dup, dup])).toEqual({ ok: false, fields: ["address.c1"] });
  });
  it("대표자가 없으면 거절, 줄바꿈 글은 정리해서 분배", () => {
    expect(planAddresses([guests[1]], REP, [])).toEqual({ ok: false, fields: ["address"] });
    expect(planAddresses(guests, "USA\nBoston, 12 Main St", [])).toMatchObject({ ok: true, groups: [{ address: "USA, Boston, 12 Main St" }] });
  });
});

describe("applyAddressPlan — 저장 호출", () => {
  it("묶음마다 한 번씩 update, 빈 묶음은 건너뛰고, 오류는 던진다", async () => {
    const calls: unknown[] = [];
    const make = (fail = false) => ({
      from: () => ({
        update: (values: Record<string, unknown>) => ({
          eq: (_c: string, stayId: string) => ({
            in: async (_c2: string, ids: string[]) => {
              calls.push({ values, stayId, ids });
              return { error: fail ? { message: "boom" } : null };
            },
          }),
        }),
      }),
    });
    await applyAddressPlan(make(), "stay", [{ address: "A", ids: ["1", "2"] }, { address: "B", ids: [] }, { address: "C", ids: ["3"] }], "t");
    expect(calls).toEqual([
      { values: { address: "A", updated_at: "t" }, stayId: "stay", ids: ["1", "2"] },
      { values: { address: "C", updated_at: "t" }, stayId: "stay", ids: ["3"] },
    ]);
    await expect(applyAddressPlan(make(true), "stay", [{ address: "A", ids: ["1"] }], "t")).rejects.toThrow("boom");
  });
});

describe("주소가 비면 체크인을 끝낼 수 없다", () => {
  it("missing 에 address 가 있으면 roster 로 막는다", () => {
    const g = (missing: string[]) => ({ name: "A", missing });
    expect(completionBlock({ consented: true, partySize: 2, guests: [g([]), g(["address"])] })).toBe("roster");
    expect(completionBlock({ consented: true, partySize: 2, guests: [g([]), g([])] })).toBeNull();
  });
});

describe("companionsSharingOldAddress", () => {
  const guests = [
    { id: "r", is_representative: true, address: "東京A" },
    { id: "c1", is_representative: false, address: "東京A" },
    { id: "c2", is_representative: false, address: "東京A " },
    { id: "c3", is_representative: false, address: "Canada, Toronto" },
    { id: "c4", is_representative: false, address: null },
  ];
  it("옛 글과 글자 그대로 같은 동행자만, 대표자 · 다른 글 · 빈 주소는 제외", () => {
    expect(companionsSharingOldAddress(guests, "東京A")).toEqual(["c1"]);
    expect(companionsSharingOldAddress(guests, null)).toEqual([]);
    expect(companionsSharingOldAddress(guests, "")).toEqual([]);
  });
});

import { guestCountText, messageAfterEdit, recomputeFieldError } from "../guest/address-form-state";

describe("주소 화면 — 오류 지우기", () => {
  it("빨간 칸만 다시 판정: 맞는 글이면 그 칸 오류가 사라지고, 여전히 틀리면 새 오류로", () => {
    const errors = { rep: "짧아요", c1: "달라요" };
    expect(recomputeFieldError(errors, "rep", null)).toEqual({ c1: "달라요" });
    expect(recomputeFieldError(errors, "rep", "영어로")).toEqual({ rep: "영어로", c1: "달라요" });
    expect(recomputeFieldError(errors, "zzz", null)).toBe(errors); // 빨갛지 않은 칸은 입력 중 건드리지 않음
  });
  it("빨간 칸이 없어지면 안내 문장도 지운다", () => {
    expect(messageAfterEdit({}, "빨간 칸을 확인해 주세요")).toBeNull();
    expect(messageAfterEdit({ c1: "x" }, "빨간 칸을 확인해 주세요")).toBe("빨간 칸을 확인해 주세요");
    expect(messageAfterEdit({ c1: "x" }, null)).toBeNull();
  });
  it("빈 칸 제출 뒤 맞는 주소를 치면 오류 상태가 비워진다(addressError 와 연결)", () => {
    let errors: Record<string, string> = { rep: "errShort" };
    const text = "USA, Boston, 12 Main St";
    errors = recomputeFieldError(errors, "rep", addressError(text, false) ? "errShort" : null);
    expect(errors).toEqual({});
    expect(messageAfterEdit(errors, "invalid")).toBeNull();
  });
});

describe("guestCountText", () => {
  it("한국어는 고유어 «세 분», 20분까지 · 그 위는 숫자, 다른 언어는 숫자", () => {
    expect([1, 2, 3, 4, 5, 10, 11, 12, 20].map((n) => guestCountText("ko", n))).toEqual(
      ["한 분", "두 분", "세 분", "네 분", "다섯 분", "열 분", "열한 분", "열두 분", "스무 분"],
    );
    expect(guestCountText("ko", 21)).toBe("21분");
    expect(guestCountText("en", 3)).toBe("3");
    expect(guestCountText("ja", 4)).toBe("4");
  });
});
