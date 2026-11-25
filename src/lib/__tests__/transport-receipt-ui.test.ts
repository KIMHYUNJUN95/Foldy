import { describe, expect, it } from "vitest";
import {
  canChangeEntryMode,
  isReceiptUrlStale,
  removeReceiptImage,
  mergeChosenFiles,
  receiptCountForm,
  receiptEvidenceState,
  receiptSlotsLeft,
  transportErrorKind,
} from "../transport-receipt-ui";

const f = (name: string, size = 1) => ({ name, size, lastModified: 1 });

describe("receiptSlotsLeft", () => {
  it("이미 붙은 것과 고른 것을 합쳐 5장까지", () => {
    expect(receiptSlotsLeft(0, 0)).toBe(5);
    expect(receiptSlotsLeft(2, 1)).toBe(2);
    expect(receiptSlotsLeft(5, 0)).toBe(0);
    expect(receiptSlotsLeft(4, 3)).toBe(0);
  });
});

describe("mergeChosenFiles", () => {
  it("자리를 넘는 것은 버리고 알린다", () => {
    const r = mergeChosenFiles(3, [f("a")], [f("b"), f("c")]);
    expect(r.files.map((x) => x.name)).toEqual(["a", "b"]);
    expect(r.truncated).toBe(true);
  });
  it("자리 안이면 알리지 않는다", () => {
    const r = mergeChosenFiles(0, [], [f("a"), f("b")]);
    expect(r.files).toHaveLength(2);
    expect(r.truncated).toBe(false);
  });
  it("같은 파일을 두 번 고르면 한 번만", () => {
    const r = mergeChosenFiles(0, [f("a")], [f("a")]);
    expect(r.files).toHaveLength(1);
  });
  it("기존 사진이 이미 5장이면 하나도 못 받는다", () => {
    const r = mergeChosenFiles(5, [], [f("a")]);
    expect(r.files).toHaveLength(0);
    expect(r.truncated).toBe(true);
  });
});

describe("receiptEvidenceState", () => {
  it("0장일 때만 누락", () => {
    expect(receiptEvidenceState({ imageCount: 0, usableUrlCount: 0 })).toBe("missing");
    expect(receiptEvidenceState({ imageCount: 0, imageUrlsFailed: true, usableUrlCount: 0 })).toBe("missing");
  });
  it("사진은 있는데 주소가 모자라면 불러오지 못함", () => {
    expect(receiptEvidenceState({ imageCount: 2, usableUrlCount: 0 })).toBe("failed");
    expect(receiptEvidenceState({ imageCount: 2, usableUrlCount: 1 })).toBe("failed");
    expect(receiptEvidenceState({ imageCount: 1, imageUrlsFailed: true, usableUrlCount: 1 })).toBe("failed");
  });
  it("모두 있으면 정상", () => {
    expect(receiptEvidenceState({ imageCount: 2, usableUrlCount: 2 })).toBe("ok");
  });
});

describe("canChangeEntryMode", () => {
  it("자동 연결 → 직접 입력만 바꿀 수 있다", () => {
    expect(canChangeEntryMode("linked", "manual")).toBe(true);
    expect(canChangeEntryMode("manual", "linked")).toBe(false);
    expect(canChangeEntryMode("manual", "manual")).toBe(true);
    expect(canChangeEntryMode("linked", "linked")).toBe(true);
  });
});

describe("receiptCountForm", () => {
  it("1장만 단수", () => {
    expect(receiptCountForm(1)).toBe("one");
    expect(receiptCountForm(0)).toBe("other");
    expect(receiptCountForm(2)).toBe("other");
  });
});

describe("transportErrorKind", () => {
  it("서버 코드를 종류로 옮긴다", () => {
    expect(transportErrorKind("report_not_editable")).toBe("locked");
    expect(transportErrorKind("invalid_amount")).toBe("amount");
    expect(transportErrorKind("memo_required")).toBe("memo");
    expect(transportErrorKind("date_outside_month")).toBe("date");
    expect(transportErrorKind("invalid_entry_mode")).toBe("entryMode");
    expect(transportErrorKind("forbidden")).toBe("forbidden");
    expect(transportErrorKind("auth")).toBe("auth");
    expect(transportErrorKind("insert_failed")).toBe("generic");
    expect(transportErrorKind(undefined)).toBe("generic");
  });
});

describe("isReceiptUrlStale", () => {
  it("기준 시간이 지나야 묵은 것", () => {
    expect(isReceiptUrlStale(1000, 1000 + 8 * 60_000, 8 * 60_000)).toBe(false);
    expect(isReceiptUrlStale(1000, 1001 + 8 * 60_000, 8 * 60_000)).toBe(true);
  });
});

describe("removeReceiptImage", () => {
  it("연달아 지워도 현재 목록 기준으로 둘 다 빠진다", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const once = removeReceiptImage(list, "a");
    const twice = removeReceiptImage(once, "b");
    expect(twice.map((x) => x.id)).toEqual(["c"]);
    expect(removeReceiptImage(list, "zzz")).toHaveLength(3);
  });
});

describe("고치기 시트의 「방」 글 — 연결 항목은 원래 요약(2026-11-25)", () => {
  it("직접으로 바꿔 고친 뒤 자동으로 되돌리면 원래 요약으로 돌아간다", async () => {
    const { editContextForMode } = await import("../transport-receipt-ui");
    const original = { mode: "linked" as const, context: "아라키초A · 201" };
    expect(editContextForMode(original, "manual", "고친 글")).toBe("고친 글");
    expect(editContextForMode(original, "linked", "고친 글")).toBe("아라키초A · 201");
    // 직접 입력 항목은 손대지 않는다.
    expect(editContextForMode({ mode: "manual", context: "A" }, "manual", "B")).toBe("B");
  });

  it("저장 뒤 화면 값: 서버가 돌려준 값 → 없으면 연결 항목은 원래 요약, 직접 입력은 적은 글", async () => {
    const { savedTransportContext } = await import("../transport-receipt-ui");
    const original = { mode: "linked" as const, context: "아라키초A · 201" };
    expect(savedTransportContext("서버 값", original, "linked", "고친 글")).toBe("서버 값");
    expect(savedTransportContext("", original, "manual", "x")).toBe("");
    expect(savedTransportContext(undefined, original, "linked", "고친 글")).toBe("아라키초A · 201");
    expect(savedTransportContext(undefined, original, "manual", " 301 ")).toBe("301");
  });
});
