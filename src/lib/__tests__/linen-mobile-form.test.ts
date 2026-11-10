import { describe, expect, it } from "vitest";
import {
  aggregateWithCatalog,
  decideSubmissionId,
  freshLinenDraft,
  LINEN_DRAFT_TTL_MS,
  errorCodeForMessage,
  linenFingerprint,
  linenDraftKey,
  parseLedgerPeriod,
  parseLinenDraft,
  serializeLinenDraft,
  shiftLedgerMonth,
} from "../linen-mobile-form";

describe("임시 저장", () => {
  it("건물 · 모드 · 기록별로 키가 다르다", () => {
    expect(linenDraftKey("create", "아라키초A")).not.toBe(linenDraftKey("create", "오쿠보A"));
    expect(linenDraftKey("create", "아라키초A")).not.toBe(linenDraftKey("edit", "아라키초A", "r1"));
    expect(linenDraftKey("edit", "아라키초A", "r1")).not.toBe(linenDraftKey("edit", "아라키초A", "r2"));
  });
  it("저장했다 읽으면 같은 값이 돌아온다(사진은 없다)", () => {
    const d = { id: "abc", fp: "f", qty: { t: 2, s: 1 }, note: "메모", savedAt: 1000 };
    expect(parseLinenDraft(serializeLinenDraft(d))).toEqual(d);
    expect(parseLinenDraft(JSON.stringify({ ...d, photoUrls: ["x"] }))).toEqual(d);
  });
  it("0 이하 · 정수가 아닌 수량은 버린다", () => {
    const raw = JSON.stringify({ id: "a", fp: "", qty: { t: 0, s: -1, p: 1.5, k: 3 }, note: "" });
    expect(parseLinenDraft(raw)?.qty).toEqual({ k: 3 });
  });
  it("깨진 값 · 빈 값 · id 없는 값은 null", () => {
    expect(parseLinenDraft(null)).toBeNull();
    expect(parseLinenDraft("{bad")).toBeNull();
    expect(parseLinenDraft(JSON.stringify({ qty: {}, note: "" }))).toBeNull();
  });
});

describe("내용 지문 · 제출 id", () => {
  const base = {
    building: "아라키초A",
    lines: [{ itemId: "b", quantity: 1 }, { itemId: "a", quantity: 2 }],
    note: "m",
    keptPhotos: ["u1"],
    files: [{ name: "a.jpg", size: 10 }],
  };
  it("품목 순서가 달라도 같은 지문", () => {
    expect(linenFingerprint(base)).toBe(linenFingerprint({ ...base, lines: [...base.lines].reverse() }));
  });
  it("수량 · 메모 · 건물 · 남긴 사진 · 파일이 다르면 다른 지문", () => {
    const fp = linenFingerprint(base);
    expect(linenFingerprint({ ...base, lines: [{ itemId: "a", quantity: 3 }, base.lines[0]] })).not.toBe(fp);
    expect(linenFingerprint({ ...base, note: "n" })).not.toBe(fp);
    expect(linenFingerprint({ ...base, building: "오쿠보A" })).not.toBe(fp);
    expect(linenFingerprint({ ...base, keptPhotos: [] })).not.toBe(fp);
    expect(linenFingerprint({ ...base, files: [] })).not.toBe(fp);
    expect(linenFingerprint({ ...base, files: [{ name: "a.jpg", size: 11 }] })).not.toBe(fp);
    expect(linenFingerprint({ ...base, files: [...base.files, { name: "b.jpg", size: 1 }] })).not.toBe(fp);
  });
  it("지문이 같으면 같은 id, 사진만 추가해도 새 id", () => {
    const fp = linenFingerprint(base);
    const stored = { id: "old", fp };
    expect(decideSubmissionId(stored, fp, () => "new")).toBe("old");
    const more = linenFingerprint({ ...base, files: [...base.files, { name: "b.jpg", size: 1 }] });
    expect(decideSubmissionId(stored, more, () => "new")).toBe("new");
  });
  it("저장된 것이 없거나 지문이 비었으면 새 id", () => {
    expect(decideSubmissionId(null, "x", () => "new")).toBe("new");
    expect(decideSubmissionId({ id: "old", fp: "" }, "", () => "new")).toBe("new");
  });
  it("문구에서 코드를 찾는다", () => {
    expect(errorCodeForMessage("X", { stale: "X", other: "Y" })).toBe("stale");
    expect(errorCodeForMessage("Z", { stale: "X" })).toBeNull();
    expect(errorCodeForMessage(null, { stale: "X" })).toBeNull();
  });
});

describe("장부 기간", () => {
  const cur = { year: 2026, month: 11 };
  it("정상 값은 그대로", () => {
    expect(parseLedgerPeriod("2026", "3", cur)).toEqual({ year: 2026, month: 3 });
  });
  it("범위 밖이면 이번 달", () => {
    expect(parseLedgerPeriod("1999", "3", cur)).toEqual(cur);
    expect(parseLedgerPeriod("2028", "3", cur)).toEqual(cur);
    expect(parseLedgerPeriod("2026", "13", cur)).toEqual(cur);
    expect(parseLedgerPeriod(undefined, undefined, cur)).toEqual(cur);
    expect(parseLedgerPeriod("20x6", "3", cur)).toEqual(cur);
  });
  it("달 이동은 연도를 넘고 3 · 5 · 7월에서도 한 달씩", () => {
    expect(shiftLedgerMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftLedgerMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    for (const m of [3, 5, 7, 10, 12]) {
      expect(shiftLedgerMonth(2026, m, 1).month).toBe(m === 12 ? 1 : m + 1);
      expect(shiftLedgerMonth(2026, m, -1).month).toBe(m - 1);
    }
  });
});

describe("품목 집계 보충", () => {
  it("이름이 같아도 id 가 다르면 둘 다 보인다", () => {
    const rows = aggregateWithCatalog(
      [{ id: "a", name: "타월", qty: 3, count: 1 }],
      [{ id: "a", name: "타월" }, { id: "b", name: "타월" }],
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[1].qty).toBe(0);
  });
  it("이미 있는 id 는 다시 넣지 않는다", () => {
    const rows = aggregateWithCatalog([{ id: "a", name: "타월", qty: 3, count: 1 }], [{ id: "a", name: "새 이름" }]);
    expect(rows).toHaveLength(1);
  });
});

describe("임시 저장 유효 시간", () => {
  const raw = (savedAt: number) => serializeLinenDraft({ id: "a", fp: "f", qty: {}, note: "", savedAt });
  it("1시간 안이면 쓴다", () => {
    expect(freshLinenDraft(raw(1000), 1000 + LINEN_DRAFT_TTL_MS)?.id).toBe("a");
  });
  it("1시간을 넘으면 버린다", () => {
    expect(freshLinenDraft(raw(1000), 1001 + LINEN_DRAFT_TTL_MS)).toBeNull();
  });
  it("저장 시각이 없는 옛 값 · 미래 시각도 버린다", () => {
    expect(freshLinenDraft(JSON.stringify({ id: "a", fp: "f", qty: {}, note: "" }), 5000)).toBeNull();
    expect(freshLinenDraft(raw(9000), 5000)).toBeNull();
  });
});
