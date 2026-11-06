import { describe, expect, it, vi } from "vitest";

import {
  ACCEPT_TIMEOUT_MS,
  FORBIDDEN_LIMIT_MS,
  INITIAL_STAFF_CALL_FLOW,
  guestAbsentTooLong,
  judgeCallStatus,
  needsRingReread,
  staffCallFlowReducer,
  withTimeout,
  type StaffCallFlow,
} from "@/lib/checkin/staff-call-flow";
import type { RingingStaffCall } from "@/lib/checkin/staff-call";

// 직원 앱 수신 흐름 — 울림 · 닫기 · 받기 · 끝남. 화면과 분리한 순수 reducer. docs/product/46 §2 · §6.
const call = (id: string): RingingStaffCall => ({
  id,
  propertyKey: "arakicho_a",
  deviceName: "T",
  step: "passport",
  language: "en",
  ringDeadlineAt: "2026-11-06T00:00:45.000Z",
});

const run = (flow: StaffCallFlow, ...events: Parameters<typeof staffCallFlowReducer>[1][]) => events.reduce(staffCallFlowReducer, flow);
const list = (calls: RingingStaffCall[], nowMs = 1000) => ({ type: "ring_list" as const, calls, nowMs });

describe("울림", () => {
  it("목록에 호출이 오면 첫 호출이 울린다", () => {
    const flow = run(INITIAL_STAFF_CALL_FLOW, list([call("a"), call("b")]));
    expect(flow.screen).toMatchObject({ kind: "ringing", call: { id: "a" } });
  });

  it("다른 직원이 받아 목록에서 빠지면 조용히 닫힌다", () => {
    const flow = run(INITIAL_STAFF_CALL_FLOW, list([call("a")]), list([]));
    expect(flow.screen).toEqual({ kind: "idle" });
  });

  it("울리던 호출이 빠지면 남은 호출이 이어서 울린다", () => {
    const flow = run(INITIAL_STAFF_CALL_FLOW, list([call("a"), call("b")]), list([call("b")]));
    expect(flow.screen).toMatchObject({ kind: "ringing", call: { id: "b" } });
  });

  it("「닫기」는 내 화면만 닫고, 같은 호출이 또 와도 다시 울리지 않는다", () => {
    const flow = run(INITIAL_STAFF_CALL_FLOW, list([call("a")]), { type: "dismiss", id: "a" }, list([call("a")]));
    expect(flow.screen).toEqual({ kind: "idle" });
  });

  it("닫은 뒤 새 호출은 울린다", () => {
    const flow = run(INITIAL_STAFF_CALL_FLOW, list([call("a")]), { type: "dismiss", id: "a" }, list([call("a"), call("b")]));
    expect(flow.screen).toMatchObject({ kind: "ringing", call: { id: "b" } });
  });

  it("통화 중에는 새 호출이 끼어들지 않는다", () => {
    const flow = run(
      INITIAL_STAFF_CALL_FLOW,
      list([call("a")]),
      { type: "accept_start", id: "a" },
      { type: "accept_ok", stayId: null, canViewStay: false },
      { type: "room_connected", nowMs: 5000 },
      list([call("b")]),
    );
    expect(flow.screen).toMatchObject({ kind: "active", call: { id: "a" } });
  });

  it("서버 소식 없이 50초가 지나면 스스로 닫는다 — 기기 시계가 틀려도 처음 본 때 기준", () => {
    const first = run(INITIAL_STAFF_CALL_FLOW, list([call("a")], 1000));
    expect(staffCallFlowReducer(first, { type: "tick", nowMs: 1000 + 49_000 }).screen).toMatchObject({ kind: "ringing" });
    expect(staffCallFlowReducer(first, { type: "tick", nowMs: 1000 + 51_000 }).screen).toEqual({ kind: "idle" });
  });
});

describe("받기", () => {
  const ringing = () => run(INITIAL_STAFF_CALL_FLOW, list([call("a")]));

  it("받기 → 연결 → 통화 중, 시작 시각은 연결된 때", () => {
    const flow = run(ringing(), { type: "accept_start", id: "a" }, { type: "accept_ok", stayId: "s", canViewStay: true }, { type: "room_connected", nowMs: 9000 });
    expect(flow.screen).toEqual({ kind: "active", call: call("a"), stayId: "s", canViewStay: true, startedAtMs: 9000 });
  });

  it("다른 직원이 먼저 받으면 안내를 띄운다", () => {
    const flow = run(ringing(), { type: "accept_start", id: "a" }, { type: "accept_failed", errorKey: "already_taken" });
    expect(flow.screen).toMatchObject({ kind: "notice", notice: "taken" });
  });

  it.each([
    ["expired", "expired"],
    ["unconfigured", "unavailable"],
    ["forbidden", "failed"],
    ["failed", "failed"],
    ["not_ready", "unavailable"],
  ] as const)("거절 %s → 안내 %s", (errorKey, notice) => {
    const flow = run(ringing(), { type: "accept_start", id: "a" }, { type: "accept_failed", errorKey });
    expect(flow.screen).toMatchObject({ kind: "notice", notice });
  });

  it("거절 안내가 끝나면 그 호출은 다시 울리지 않는다", () => {
    const flow = run(
      ringing(),
      { type: "accept_start", id: "a" },
      { type: "accept_failed", errorKey: "expired" },
      { type: "notice_done" },
      list([call("a")]),
    );
    expect(flow.screen).toEqual({ kind: "idle" });
  });

  it("다른 호출의 받기는 무시한다", () => {
    expect(run(ringing(), { type: "accept_start", id: "zzz" }).screen).toMatchObject({ kind: "ringing", call: { id: "a" } });
  });
});

describe("끝", () => {
  const active = () =>
    run(
      INITIAL_STAFF_CALL_FLOW,
      list([call("a")]),
      { type: "accept_start", id: "a" },
      { type: "accept_ok", stayId: null, canViewStay: false },
      { type: "room_connected", nowMs: 1 },
    );

  it("상대가 끊으면 끝 안내 뒤 닫힌다", () => {
    const flow = run(active(), { type: "remote_ended" });
    expect(flow.screen).toMatchObject({ kind: "notice", notice: "ended" });
    expect(run(flow, { type: "notice_done" }).screen).toEqual({ kind: "idle" });
  });

  it("연결이 끊기면 끊김 안내", () => {
    expect(run(active(), { type: "connection_lost" }).screen).toMatchObject({ kind: "notice", notice: "lost" });
  });

  it("내가 끊으면 바로 닫히고 다시 울리지 않는다", () => {
    const flow = run(active(), { type: "local_end" }, list([call("a")]));
    expect(flow.screen).toEqual({ kind: "idle" });
  });

  it("끝난 안내 중 상태 이벤트가 또 와도 그대로", () => {
    const flow = run(active(), { type: "remote_ended" }, { type: "connection_lost" });
    expect(flow.screen).toMatchObject({ kind: "notice", notice: "ended" });
  });

  it("안 울리는데 온 끝남 이벤트는 무시한다", () => {
    expect(run(INITIAL_STAFF_CALL_FLOW, { type: "remote_ended" }).screen).toEqual({ kind: "idle" });
  });
});

describe("손님 부재", () => {
  it("30초 넘게 손님이 방에 없으면 끝낸다", () => {
    expect(guestAbsentTooLong(1000, 1000 + 30_000)).toBe(false);
    expect(guestAbsentTooLong(1000, 1000 + 30_001)).toBe(true);
  });
});

describe("알림에서 다시 띄우기", () => {
  it("닫아 둔 호출이 아직 울리는 중이면 다시 울린다", () => {
    const flow = run(INITIAL_STAFF_CALL_FLOW, list([call("a")]), { type: "dismiss", id: "a" }, { type: "reopen", id: "a" }, list([call("a")]));
    expect(flow.screen).toMatchObject({ kind: "ringing", call: { id: "a" } });
  });

  it("끝난 호출이면 아무 일도 없다", () => {
    const flow = run(INITIAL_STAFF_CALL_FLOW, { type: "reopen", id: "a" }, list([]));
    expect(flow.screen).toEqual({ kind: "idle" });
  });
});

describe("받기 시간 제한", () => {
  it("10초 안에 안 오면 실패로 끝낸다", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => undefined), ACCEPT_TIMEOUT_MS);
    const assertion = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(ACCEPT_TIMEOUT_MS);
    await assertion;
    vi.useRealTimers();
    expect(ACCEPT_TIMEOUT_MS).toBe(10_000);
  });

  it("시간 안에 오면 그 값을 돌려준다", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });
});

describe("통화 중 상태 읽기", () => {
  const forbidden = { ok: false as const, errorKey: "forbidden" };
  const accepted = { ok: true as const, status: "accepted" };

  it("forbidden 한 번으로는 끊지 않고 그때부터 센다 — 인증 일시 오류일 수 있다", () => {
    expect(judgeCallStatus(forbidden, null, 1000)).toEqual({ event: null, forbiddenSinceMs: 1000 });
  });

  it("30초 미만이면 계속 통화한다", () => {
    expect(judgeCallStatus(forbidden, 1000, 1000 + FORBIDDEN_LIMIT_MS - 1)).toEqual({ event: null, forbiddenSinceMs: 1000 });
  });

  it("30초 연속이면 방을 나간다", () => {
    expect(FORBIDDEN_LIMIT_MS).toBe(30_000);
    expect(judgeCallStatus(forbidden, 1000, 1000 + FORBIDDEN_LIMIT_MS)).toEqual({ event: { type: "connection_lost" }, forbiddenSinceMs: 1000 });
  });

  it("그 사이 정상 응답이 한 번 오면 다시 센다", () => {
    const reset = judgeCallStatus(accepted, 1000, 20_000);
    expect(reset).toEqual({ event: null, forbiddenSinceMs: null });
    expect(judgeCallStatus(forbidden, reset.forbiddenSinceMs, 31_000)).toEqual({ event: null, forbiddenSinceMs: 31_000 });
  });

  it("서버 오류는 끊지도, 세던 것을 지우지도 않는다", () => {
    for (const errorKey of ["failed", "not_ready"]) {
      expect(judgeCallStatus({ ok: false, errorKey }, null, 5000)).toEqual({ event: null, forbiddenSinceMs: null });
      expect(judgeCallStatus({ ok: false, errorKey }, 1000, 5000)).toEqual({ event: null, forbiddenSinceMs: 1000 });
    }
  });

  it.each(["ended", "no_answer", "canceled", "failed"])("서버가 %s 를 돌려주면 바로 끝낸다", (status) => {
    expect(judgeCallStatus({ ok: true, status }, null, 1).event).toEqual({ type: "remote_ended" });
    expect(judgeCallStatus({ ok: true, status }, 1000, 2000).event).toEqual({ type: "remote_ended" });
  });
});

describe("다시 읽어야 할 때", () => {
  it.each(["ringing", "connecting", "active", "notice"] as const)("%s 에서 idle 이 되면 다시 읽는다", (kind) => {
    expect(needsRingReread(kind, "idle")).toBe(true);
  });
  it("계속 idle 이거나 idle 이 아니면 읽지 않는다", () => {
    expect(needsRingReread("idle", "idle")).toBe(false);
    expect(needsRingReread("ringing", "notice")).toBe(false);
  });
  it("A 를 닫은 뒤 다시 읽으면 함께 온 B 가 울린다", () => {
    const flow = run(INITIAL_STAFF_CALL_FLOW, list([call("a")]), { type: "dismiss", id: "a" }, list([call("a"), call("b")]));
    expect(flow.screen).toMatchObject({ kind: "ringing", call: { id: "b" } });
  });
  it("통화가 끝난 뒤 다시 읽으면 통화 중 온 B 가 울린다", () => {
    const flow = run(
      INITIAL_STAFF_CALL_FLOW,
      list([call("a")]),
      { type: "accept_start", id: "a" },
      { type: "accept_ok", stayId: null, canViewStay: false },
      { type: "room_connected", nowMs: 1 },
      list([call("b")]),
      { type: "remote_ended" },
      { type: "notice_done" },
      list([call("b")]),
    );
    expect(flow.screen).toMatchObject({ kind: "ringing", call: { id: "b" } });
  });
});
