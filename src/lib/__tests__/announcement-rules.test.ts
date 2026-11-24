import { describe, expect, it } from "vitest";
import {
  filterPopupQueue,
  nextPublishedAtOnEdit,
  parseHiddenPopupMap,
  parseSessionSeen,
  popupHideStorageKey,
  popupSessionStorageKey,
  selectPopupCandidates,
} from "@/lib/announcement-rules";

describe("수정 저장의 게시 시각", () => {
  const now = "2026-11-12T03:00:00.000Z";
  const old = "2026-10-01T00:00:00.000Z";

  it("보관 → 게시하면 지금 시각(옛 게시일을 쓰지 않는다)", () => {
    expect(nextPublishedAtOnEdit({ status: "archived", published_at: old }, "published", now)).toBe(now);
  });
  it("초안 → 게시하면 지금 시각(예전에 게시했다 내린 초안도)", () => {
    expect(nextPublishedAtOnEdit({ status: "draft", published_at: old }, "published", now)).toBe(now);
    expect(nextPublishedAtOnEdit({ status: "draft", published_at: null }, "published", now)).toBe(now);
  });
  it("게시 중인 공지를 고치면 원래 게시 시각을 지킨다", () => {
    expect(nextPublishedAtOnEdit({ status: "published", published_at: old }, "published", now)).toBe(old);
    expect(nextPublishedAtOnEdit({ status: "published", published_at: null }, "published", now)).toBe(now);
  });
  it("초안으로 저장하면 게시 시각을 건드리지 않는다", () => {
    expect(nextPublishedAtOnEdit({ status: "draft", published_at: old }, "draft", now)).toBe(old);
  });
});

describe("팝업 고르기 — 서버", () => {
  const now = new Date("2026-11-12T03:00:00.000Z");
  const row = (id: string, extra: Partial<{ show_popup_on_app_open: boolean; popup_until: string | null }> = {}) => ({
    id,
    show_popup_on_app_open: true,
    popup_until: null,
    ...extra,
  });

  it("읽은 공지 · 7일 숨긴 공지 · 끝난 팝업 · 팝업 꺼진 공지는 뺀다", () => {
    const rows = [
      row("a"),
      row("read"),
      row("dismissed"),
      row("ended", { popup_until: "2026-11-12T02:59:59.000Z" }),
      row("off", { show_popup_on_app_open: false }),
      row("future", { popup_until: "2026-11-13T00:00:00.000Z" }),
    ];
    const picked = selectPopupCandidates(rows, {
      dismissedIds: new Set(["dismissed"]),
      readIds: new Set(["read"]),
      now,
    });
    expect(picked.map((r) => r.id)).toEqual(["a", "future"]);
  });
});

describe("팝업 고르기 — 브라우저 기록", () => {
  it("기록 키는 사람마다 다르다", () => {
    expect(popupHideStorageKey("u1")).not.toBe(popupHideStorageKey("u2"));
    expect(popupSessionStorageKey("u1")).not.toBe(popupSessionStorageKey("u2"));
    expect(popupHideStorageKey("u1")).not.toBe(popupSessionStorageKey("u1"));
  });

  it("7일 숨김은 아직 안 끝난 것만 남기고, 망가진 값은 빈 기록", () => {
    const nowMs = Date.parse("2026-11-12T00:00:00.000Z");
    const raw = JSON.stringify({ a: "2026-11-15T00:00:00.000Z", b: "2026-11-01T00:00:00.000Z", c: 3 });
    expect(parseHiddenPopupMap(raw, nowMs)).toEqual({ a: "2026-11-15T00:00:00.000Z" });
    expect(parseHiddenPopupMap("{oops", nowMs)).toEqual({});
    expect(parseHiddenPopupMap("[1]", nowMs)).toEqual({});
    expect(parseHiddenPopupMap(null, nowMs)).toEqual({});
  });

  it("세션 기록은 문자열 배열만", () => {
    expect([...parseSessionSeen(JSON.stringify(["a", 1, "b"]))]).toEqual(["a", "b"]);
    expect(parseSessionSeen("nope").size).toBe(0);
    expect(parseSessionSeen(null).size).toBe(0);
  });

  it("7일 숨긴 것 · 이번 세션에 닫은 것은 다시 띄우지 않는다(홈 → 목록 두 번 뜨지 않음)", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(filterPopupQueue(items, { a: "2026-11-15T00:00:00.000Z" }, new Set(["b"])).map((i) => i.id)).toEqual(["c"]);
    expect(filterPopupQueue(items, {}, new Set()).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("방금 이 화면에서 닫은 것은 번호를 위해 차례에 남는다", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(filterPopupQueue(items, {}, new Set(["a"]), new Set(["a"])).map((i) => i.id)).toEqual(["a", "b"]);
  });
});
