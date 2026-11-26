import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 웹훅 확인 읽기(`fetchBeds24BookingById(id, { allStatuses: true })`, 2026-11-26 재감사).
 * `not_found` 가 살아 있는 예약을 취소하지 않도록: 모든 상태를 싣고, 정상 응답에 그 번호의 행이 없을 때만 `not_found`.
 * 계약: docs/engineering/01-beds24-integration.md 「2026-11-26 웹훅 순서 · 확인 · 상한」.
 */
const state = vi.hoisted(() => ({ urls: [] as string[], response: null as Response | null, queue: [] as Response[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getOptionalBeds24ApiEnv: () => ({ baseUrl: "https://beds24.test/api/v2/" }) }));
vi.mock("@/lib/beds24/access-token", () => ({ resolveBeds24AccessToken: async () => ({ ok: true, token: "t" }) }));
vi.mock("@/lib/beds24/credit-ledger", () => ({
  beds24Fetch: async (url: string) => {
    state.urls.push(url);
    return state.queue.shift() ?? state.response;
  },
}));

import { fetchBeds24BookingById } from "@/lib/beds24/calendar-client";

const reply = (body: unknown, status = 200) =>
  (state.response = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

beforeEach(() => {
  state.urls = [];
  state.queue = [];
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchBeds24BookingById — inquiry 를 거절(400)하면 한 번 더", () => {
  it("400 이면 inquiry 빼고 다시 읽어 그 결과를 쓴다(최대 2 크레딧)", async () => {
    state.queue = [json({ error: "bad status" }, 400), json({ success: true, data: [{ id: 9001, status: "confirmed" }] })];
    expect(await fetchBeds24BookingById("9001", { allStatuses: true })).toEqual({ ok: true, booking: { id: 9001, status: "confirmed" } });
    expect(state.urls).toHaveLength(2);
    expect(new URL(state.urls[1]!).searchParams.getAll("status").sort()).toEqual(["black", "cancelled", "confirmed", "new", "request"]);
  });

  it("문의를 빼고 다시 읽어 행이 없으면 not_found 가 아니다(unexpected_response — 살아 있는 문의를 취소하지 않게)", async () => {
    for (const data of [[], [{ id: 9002 }]]) {
      state.queue = [json({}, 400), json({ success: true, data })];
      expect(await fetchBeds24BookingById("9001", { allStatuses: true })).toEqual({ ok: false, error: "unexpected_response" });
    }
  });

  it("다시 읽어도 실패면 던진다(가드 · 정합이 unavailable 로 본다) · 세 번째는 없다", async () => {
    state.queue = [json({}, 400), json({}, 400)];
    await expect(fetchBeds24BookingById("9001", { allStatuses: true })).rejects.toMatchObject({ status: 400 });
    expect(state.urls).toHaveLength(2);
  });

  it("400 이 아닌 실패 · 옵션 없는 읽기는 다시 읽지 않는다", async () => {
    state.queue = [json({}, 500)];
    await expect(fetchBeds24BookingById("9001", { allStatuses: true })).rejects.toBeTruthy();
    expect(state.urls).toHaveLength(1);
    state.urls = [];
    state.queue = [json({}, 400)];
    await expect(fetchBeds24BookingById("9001")).rejects.toBeTruthy();
    expect(state.urls).toHaveLength(1);
  });
});

describe("fetchBeds24BookingById — allStatuses (웹훅 확인)", () => {
  it("URL 에 모든 상태를 싣는다", async () => {
    reply({ success: true, data: [{ id: 9001 }] });
    await fetchBeds24BookingById("9001", { allStatuses: true });
    const url = new URL(state.urls[0]!);
    expect(url.searchParams.get("id")).toBe("9001");
    expect(url.searchParams.getAll("status").sort()).toEqual(
      ["black", "cancelled", "confirmed", "inquiry", "new", "request"].sort(),
    );
  });

  it("문의 · 요청 예약도 찾음(취소하지 않음)", async () => {
    for (const status of ["inquiry", "request"]) {
      reply({ success: true, data: [{ id: 9001, status }] });
      expect(await fetchBeds24BookingById("9001", { allStatuses: true })).toEqual({
        ok: true,
        booking: { id: 9001, status },
      });
    }
  });

  it("그룹 응답에서 번호가 같은 행이 첫 행이 아니어도 찾는다", async () => {
    reply({ success: true, data: [{ id: 9000, masterId: 9000 }, { id: 9001, masterId: 9000 }] });
    expect(await fetchBeds24BookingById("9001", { allStatuses: true })).toEqual({
      ok: true,
      booking: { id: 9001, masterId: 9000 },
    });
  });

  it("정상 응답에 그 번호가 없을 때만 not_found", async () => {
    reply({ success: true, data: [] });
    expect(await fetchBeds24BookingById("9001", { allStatuses: true })).toEqual({ ok: false, error: "not_found" });
    reply({ success: true, data: [{ id: 9002 }] });
    expect(await fetchBeds24BookingById("9001", { allStatuses: true })).toEqual({ ok: false, error: "not_found" });
  });

  it("200 + success:false · data 없음 · 배열 본문은 not_found 가 아니다(unexpected_response)", async () => {
    for (const body of [{ success: false, data: [] }, { success: true }, [{ id: 9002 }], { success: true, data: {} }]) {
      reply(body);
      expect(await fetchBeds24BookingById("9001", { allStatuses: true })).toEqual({
        ok: false,
        error: "unexpected_response",
      });
    }
  });

  it("2xx 가 아니면 던진다(가드가 unavailable 로 본다)", async () => {
    reply({ error: "x" }, 500);
    await expect(fetchBeds24BookingById("9001", { allStatuses: true })).rejects.toBeTruthy();
  });

  it("옵션 없이(판매 캘린더)는 예전 그대로 — 상태 없이, 첫 행", async () => {
    reply({ success: true, data: [{ id: 9001 }] });
    expect(await fetchBeds24BookingById("9001")).toEqual({ ok: true, booking: { id: 9001 } });
    expect(new URL(state.urls[0]!).searchParams.getAll("status")).toEqual([]);
  });
});
