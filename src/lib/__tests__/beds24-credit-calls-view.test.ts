import { describe, expect, it } from "vitest";
import {
  appendCreditCallPage,
  compareCreditCallsDesc,
  CREDIT_CALL_GROUP_GAP_MS,
  creditCallCursor,
  creditCallListKey,
  creditCallRetryTarget,
  groupCreditCalls,
  isCreditCallGroupOpen,
  isCurrentCreditCallResponse,
  mergeCreditCallHead,
  NO_CREDIT_CALL_FILTER,
  startCreditCallList,
  toggleCreditCallFilter,
  toggleCreditCallGroup,
} from "@/lib/beds24-credit-view";
import type { Beds24CreditCall, Beds24CreditCallPage } from "@/lib/beds24/credit-usage-types";

/** Beds24 크레딧 「최근 호출」 — 묶기 · 합치기 · 커서 · 늦은 응답 버리기 · 거르기(2026-11-18). */

const T0 = Date.parse("2026-11-18T03:00:00.000Z");

function call(id: number, atMs: number, over: Partial<Beds24CreditCall> = {}, micro = ""): Beds24CreditCall {
  const iso = new Date(atMs).toISOString().replace("Z", `${micro}+00:00`);
  return {
    id: String(id),
    at: atMs,
    calledAt: iso,
    actor: { kind: "user", userId: "u1", name: "Kim", job: null },
    feature: "guest_messages",
    action: "messages.get",
    itemCount: null,
    cost: 1,
    remaining: 150,
    httpStatus: 200,
    ...over,
  };
}

const page = (calls: Beds24CreditCall[], hasMore = false, since = T0 - 86_400_000): Beds24CreditCallPage => ({ calls, hasMore, since });
const key = creditCallListKey("today", NO_CREDIT_CALL_FILTER);

describe("groupCreditCalls — 연달아 난 같은 호출은 한 줄", () => {
  it("같은 사람 · 같은 기능 · 앞 줄과 60초 안이면 묶고, 합 · 최근 남은 값", () => {
    const calls = [call(3, T0 + 60_000, { remaining: 140, cost: 2 }), call(2, T0 + 30_000, { remaining: 142 }), call(1, T0, { remaining: 143 })];
    const groups = groupCreditCalls(calls);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "1", cost: 4, remaining: 140, at: T0 + 60_000, firstAt: T0 });
    expect(groups[0].calls.map((c) => c.id)).toEqual(["3", "2", "1"]);
  });

  it("60초 경계 — 딱 60초는 묶고, 60.001초는 끊는다(첫 줄이 아니라 바로 앞 줄 기준)", () => {
    expect(groupCreditCalls([call(2, T0 + CREDIT_CALL_GROUP_GAP_MS), call(1, T0)])).toHaveLength(1);
    expect(groupCreditCalls([call(2, T0 + CREDIT_CALL_GROUP_GAP_MS + 1), call(1, T0)])).toHaveLength(2);
    // 이어진 사슬은 첫 줄과 60초를 넘어도 한 묶음
    expect(groupCreditCalls([call(3, T0 + 100_000), call(2, T0 + 50_000), call(1, T0)])).toHaveLength(1);
  });

  it("실패한 호출(오류 응답 · 비용 모름)은 성공 줄과 묶지 않고, 실패끼리도 묶지 않는다", () => {
    const calls = [
      call(4, T0 + 3000),
      call(3, T0 + 2000, { cost: null, httpStatus: 429 }),
      call(2, T0 + 1000, { cost: null, httpStatus: null }),
      call(1, T0, { httpStatus: 500, cost: 1 }),
    ];
    expect(groupCreditCalls(calls).map((g) => g.calls.length)).toEqual([1, 1, 1, 1]);
  });

  it("사람이 다르거나 · 기능이 다르거나 · 자동 작업 이름이 다르면 끊는다", () => {
    const other = { kind: "user" as const, userId: "u2", name: "Lee", job: null };
    expect(groupCreditCalls([call(2, T0 + 1000, { actor: other }), call(1, T0)])).toHaveLength(2);
    expect(groupCreditCalls([call(2, T0 + 1000, { feature: "rates_read" }), call(1, T0)])).toHaveLength(2);
    const auto = (job: string) => ({ actor: { kind: "auto" as const, userId: null, name: "", job } });
    expect(groupCreditCalls([call(2, T0 + 1000, auto("reviews")), call(1, T0, auto("bookings"))])).toHaveLength(2);
    expect(groupCreditCalls([call(2, T0 + 1000, auto("reviews")), call(1, T0, auto("reviews"))])).toHaveLength(1);
  });

  it("장 경계 — 「더 보기」로 받은 줄이 앞 장 마지막 묶음에 이어진다", () => {
    let list = startCreditCallList(key, 0, page([call(5, T0 + 40_000), call(4, T0 + 30_000)], true));
    expect(groupCreditCalls(list.calls)).toHaveLength(1);
    list = appendCreditCallPage(list, page([call(3, T0 + 20_000), call(2, T0 + 10_000), call(1, T0 - 120_000)]), creditCallCursor(list));
    const groups = groupCreditCalls(list.calls);
    expect(groups.map((g) => g.calls.map((c) => c.id))).toEqual([["5", "4", "3", "2"], ["1"]]);
  });

  it("펼침은 줄 id 로 — 묶음이 위로 자라도 펼친 채", () => {
    const before = groupCreditCalls([call(2, T0 + 10_000), call(1, T0)])[0];
    const open = toggleCreditCallGroup(before, new Set());
    const after = groupCreditCalls([call(3, T0 + 20_000), call(2, T0 + 10_000), call(1, T0)])[0];
    expect(isCreditCallGroupOpen(after, open)).toBe(true);
    expect(isCreditCallGroupOpen(after, toggleCreditCallGroup(after, open))).toBe(false);
  });
});

describe("mergeCreditCallHead — 자동 갱신 첫 장 합치기", () => {
  it("새 호출은 위에, 「더 보기」로 받은 아래 줄은 그대로, 겹침 없음", () => {
    let list = startCreditCallList(key, 0, page([call(4, T0 + 4000), call(3, T0 + 3000)], true));
    list = appendCreditCallPage(list, page([call(2, T0 + 2000), call(1, T0 + 1000)], false), creditCallCursor(list));
    const next = mergeCreditCallHead(list, page([call(6, T0 + 6000), call(5, T0 + 5000), call(4, T0 + 4000)], true));
    expect(next.calls.map((c) => c.id)).toEqual(["6", "5", "4", "3", "2", "1"]);
    // 아래는 이미 끝까지 받았다 — 첫 장의 「뒤에 더 있음」에 덮이지 않는다.
    expect(next.hasMore).toBe(false);
  });

  it("같은 id 는 하나만, 뒤에 온 값(새 남은 값)이 이긴다", () => {
    const list = startCreditCallList(key, 0, page([call(1, T0, { remaining: 10 })]));
    const next = mergeCreditCallHead(list, page([call(1, T0, { remaining: 20 })]));
    expect(next.calls).toHaveLength(1);
    expect(next.calls[0].remaining).toBe(20);
  });

  it("아래까지 받지 않았으면 「더 보기」 여부는 첫 장 기준", () => {
    const list = startCreditCallList(key, 0, page([call(1, T0)], false));
    expect(mergeCreditCallHead(list, page([call(2, T0 + 1000), call(1, T0)], true)).hasMore).toBe(true);
  });

  it("기간 시작보다 옛 줄은 걷어 낸다(5분 · 1시간은 밀린다)", () => {
    const list = startCreditCallList(key, 0, page([call(2, T0 + 1000), call(1, T0 - 600_000)]));
    const next = mergeCreditCallHead(list, page([call(2, T0 + 1000)], false, T0 - 300_000));
    expect(next.calls.map((c) => c.id)).toEqual(["2"]);
  });

  it("첫 장이 받아 둔 줄과 하나도 안 겹치고 뒤에 더 있으면 사이가 빈다 — 첫 장으로 다시", () => {
    const list = startCreditCallList(key, 0, page([call(2, T0 + 1000), call(1, T0)]));
    const next = mergeCreditCallHead(list, page([call(9, T0 + 9000), call(8, T0 + 8000)], true));
    expect(next.calls.map((c) => c.id)).toEqual(["9", "8"]);
    expect(next.hasMore).toBe(true);
  });

  it("거르기 결과가 비면 목록도 빈다", () => {
    const list = startCreditCallList(key, 0, page([call(1, T0)]));
    expect(mergeCreditCallHead(list, page([]))).toMatchObject({ calls: [], hasMore: false });
  });
});

describe("커서 — 같은 시각 줄도 빠지거나 겹치지 않는다", () => {
  // 서버(PostgREST `called_at < X or (called_at = X and id < Y)`, called_at desc, id desc)를 흉내 낸다.
  function serverPage(all: Beds24CreditCall[], cursor: { calledAt: string; id: string } | null, size: number): Beds24CreditCallPage {
    const sorted = [...all].sort(compareCreditCallsDesc);
    const after = cursor ? sorted.filter((c) => compareCreditCallsDesc(c, { ...c, at: Date.parse(cursor.calledAt), calledAt: cursor.calledAt, id: cursor.id }) > 0) : sorted;
    return page(after.slice(0, size), after.length > size);
  }

  it("같은 ms · 같은 µs 줄이 장 경계에 걸려도 모두 한 번씩", () => {
    const same = T0 + 5000;
    const all = [
      call(10, same, {}, "123"),
      call(11, same, {}, "123"),
      call(12, same, {}, "123"),
      call(13, same, {}, "456"), // 같은 ms, 더 늦은 µs
      call(9, T0 + 4000),
      call(8, T0 + 3000),
    ];
    let list = startCreditCallList(key, 0, serverPage(all, null, 2));
    while (list.hasMore) list = appendCreditCallPage(list, serverPage(all, creditCallCursor(list), 2), creditCallCursor(list));
    expect(list.calls.map((c) => c.id)).toEqual(["13", "12", "11", "10", "9", "8"]);
  });

  it("커서는 가장 옛 줄의 DB 시각 그대로(µs 포함)", () => {
    const list = startCreditCallList(key, 0, page([call(2, T0 + 1000), call(1, T0, {}, "789")]));
    expect(creditCallCursor(list)).toEqual({ calledAt: "2026-11-18T03:00:00.000789+00:00", id: "1" });
    expect(creditCallCursor(startCreditCallList(key, 0, null))).toBeNull();
  });

  it("id 는 숫자 크기로 — 「9」 < 「10」", () => {
    const list = startCreditCallList(key, 0, page([call(9, T0), call(10, T0)]));
    expect(list.calls.map((c) => c.id)).toEqual(["10", "9"]);
  });
});

describe("늦은 응답 · 거르기", () => {
  it("기간 · 거르기를 바꾼 뒤(열쇠 · 세대가 다름) 온 응답은 버린다", () => {
    const sent = startCreditCallList(key, 3, null);
    expect(isCurrentCreditCallResponse(sent, sent)).toBe(true);
    expect(isCurrentCreditCallResponse(sent, startCreditCallList(creditCallListKey("7d", NO_CREDIT_CALL_FILTER), 4, null))).toBe(false);
    // 같은 거르기로 다시 시작해도(풀었다 다시 걸기) 세대가 달라 버린다
    expect(isCurrentCreditCallResponse(sent, startCreditCallList(key, 4, null))).toBe(false);
  });

  it("같은 줄을 다시 누르면 풀리고, 누가 · 어디에는 따로 걸린다", () => {
    const a = toggleCreditCallFilter(NO_CREDIT_CALL_FILTER, "actor", "user:u1");
    expect(a).toEqual({ actor: "user:u1", feature: null });
    const both = toggleCreditCallFilter(a, "feature", "guest_messages");
    expect(both).toEqual({ actor: "user:u1", feature: "guest_messages" });
    expect(toggleCreditCallFilter(both, "actor", "user:u1")).toEqual({ actor: null, feature: "guest_messages" });
    expect(toggleCreditCallFilter(a, "actor", "auto")).toEqual({ actor: "auto", feature: null });
    expect(creditCallListKey("today", both)).not.toBe(creditCallListKey("today", a));
  });
});

describe("오류 뒤 다시 받기 · 다시 시작한 목록 — 독립 검사 지적(2026-11-18)", () => {
  it("다시 받기는 마지막에 실패한 쪽으로 — 더 보기가 실패했고 아래가 남았으면 더 보기, 아니면 첫 장", () => {
    const withRows = startCreditCallList(key, 0, page([call(2, T0 + 1000), call(1, T0)], true));
    expect(creditCallRetryTarget(null, withRows)).toBeNull();
    expect(creditCallRetryTarget("more", withRows)).toBe("more");
    expect(creditCallRetryTarget("head", withRows)).toBe("head");
    // 거르기를 푼 뒤 첫 장이 실패하고, 상세 갱신이 목록만 채운 경우 — 「더 보기」가 아니라 첫 장을 다시(전엔 hasMore=false 라 아무것도 안 함).
    const filledNoMore = startCreditCallList(key, 0, page([call(2, T0 + 1000), call(1, T0)], false));
    expect(creditCallRetryTarget("more", filledNoMore)).toBe("head");
    expect(creditCallRetryTarget("more", startCreditCallList(key, 0, null))).toBe("head");
  });

  it("첫 장이 빈틈을 알아채 다시 시작하면 세대가 올라 그 전에 보낸 「더 보기」 응답은 버려진다", () => {
    // 1~50 을 가진 목록에서 「더 보기」를 보냄(커서 = 가장 옛 줄)
    const before = startCreditCallList(key, 2, page([call(2, T0 + 1000), call(1, T0)], true));
    const sent = before;
    const sentCursor = creditCallCursor(sent);
    // 그사이 자동 갱신 첫 장이 하나도 안 겹치고 뒤에 더 있음 → 다시 시작
    const restarted = mergeCreditCallHead(before, page([call(9, T0 + 9000), call(8, T0 + 8000)], true));
    expect(restarted.generation).toBe(3);
    expect(isCurrentCreditCallResponse(sent, restarted)).toBe(false);
    // 이중 방어 — 세대 판정을 지나쳐도 커서가 지금 목록의 맨 끝 줄이 아니면 잇지 않는다(옛 0~… 줄이 새 첫 장 아래 붙지 않게).
    const stale = page([call(0, T0 - 1000)], false);
    expect(appendCreditCallPage(restarted, stale, sentCursor)).toBe(restarted);
  });

  it("거르기 결과가 비어 목록을 비울 때도 세대를 올린다(그 전 「더 보기」가 빈 목록에 붙지 않게)", () => {
    const list = startCreditCallList(key, 5, page([call(1, T0)], true));
    expect(mergeCreditCallHead(list, page([])).generation).toBe(6);
  });

  it("이미 비어 있고 더 없음이면 빈 첫 장은 같은 목록 객체 — 세대 · 다시 그리기 없음, 진행 중인 「다시 받기」를 버리지 않는다(재리뷰)", () => {
    const empty = startCreditCallList(key, 4, page([]));
    expect(mergeCreditCallHead(empty, page([]))).toBe(empty);
  });

  it("평소 합치기(빈틈 없음)는 세대를 그대로 — 진행 중인 「더 보기」가 이어진다", () => {
    const list = startCreditCallList(key, 1, page([call(2, T0 + 1000), call(1, T0)], true));
    const cursor = creditCallCursor(list);
    const merged = mergeCreditCallHead(list, page([call(3, T0 + 2000), call(2, T0 + 1000)], true));
    expect(merged.generation).toBe(1);
    expect(appendCreditCallPage(merged, page([call(0, T0 - 1000)]), cursor).calls.map((c) => c.id)).toEqual(["3", "2", "1", "0"]);
  });

  it("묶음 id 는 가장 옛 줄 — 위에 새 줄이 붙어 묶음이 자라도 그대로(다시 마운트 · 포커스 잃음 없음)", () => {
    const before = groupCreditCalls([call(2, T0 + 10_000), call(1, T0)])[0];
    const grown = groupCreditCalls([call(3, T0 + 20_000), call(2, T0 + 10_000), call(1, T0)])[0];
    expect(before.id).toBe("1");
    expect(grown.id).toBe("1");
  });
});
