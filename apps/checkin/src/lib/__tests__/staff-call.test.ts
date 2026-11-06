import { describe, expect, it } from "vitest";

import {
  CALL_MAX_MS,
  RING_MS,
  callRequestSchema,
  guestHangUpTransition,
  isCallId,
  ringDeadlineFrom,
  roomNameFor,
  sessionIdOf,
  staleTransition,
  supersedeTransition,
  type StaffCallStatus,
} from "@/lib/kiosk/staff-call";

const NOW = new Date("2026-11-06T10:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe("시간 초과 판정", () => {
  const row = (status: StaffCallStatus, deadline: number, accepted: number | null = null) => ({
    status,
    ring_deadline_at: at(deadline),
    accepted_at: accepted === null ? null : at(accepted),
  });

  it("울리는 동안은 그대로", () => {
    expect(staleTransition(row("ringing", 1), NOW)).toBeNull();
  });
  it("기한이 된 순간부터 no_answer", () => {
    expect(staleTransition(row("ringing", 0), NOW)).toEqual({ from: "ringing", to: "no_answer", endedBy: "timeout" });
  });
  it("받은 지 30분 안은 그대로, 30분이면 ended(timeout)", () => {
    expect(staleTransition(row("accepted", -CALL_MAX_MS, -CALL_MAX_MS + 1), NOW)).toBeNull();
    expect(staleTransition(row("accepted", -CALL_MAX_MS, -CALL_MAX_MS), NOW)).toEqual({ from: "accepted", to: "ended", endedBy: "timeout" });
  });
  it.each(["ended", "no_answer", "canceled", "failed"] as StaffCallStatus[])("끝난 %s 는 바뀌지 않는다", (status) => {
    expect(staleTransition(row(status, -CALL_MAX_MS * 2, -CALL_MAX_MS * 2), NOW)).toBeNull();
  });
  it("울림 기한은 45초 뒤", () => {
    expect(RING_MS).toBe(45_000);
    expect(ringDeadlineFrom(NOW)).toBe(at(45_000));
  });
});

describe("손님이 끊기 · 취소", () => {
  it("울리는 중이면 canceled, 통화 중이면 ended", () => {
    expect(guestHangUpTransition("ringing")).toEqual({ from: "ringing", to: "canceled", endedBy: "guest" });
    expect(guestHangUpTransition("accepted")).toEqual({ from: "accepted", to: "ended", endedBy: "guest" });
  });
  it.each(["ended", "no_answer", "canceled", "failed"] as StaffCallStatus[])("이미 끝난 %s 는 아무것도 안 한다", (status) => {
    expect(guestHangUpTransition(status)).toBeNull();
  });
});

describe("새 호출이 왔을 때 옛 행", () => {
  it("아직 울리면 그대로 쓰고, 통화 중으로 남은 행은 system 으로 닫는다", () => {
    expect(supersedeTransition("ringing")).toBeNull();
    expect(supersedeTransition("accepted")).toEqual({ from: "accepted", to: "ended", endedBy: "system" });
  });
});

describe("입력 값", () => {
  it.each(["welcome", "find", "passport", "face", "address", "done", "other"])("step %s 통과", (step) => {
    expect(callRequestSchema.safeParse({ step, language: "ja" }).success).toBe(true);
  });
  it.each(["ja", "en", "zh-Hans", "ko"])("language %s 통과", (language) => {
    expect(callRequestSchema.safeParse({ step: "find", language }).success).toBe(true);
  });
  it.each([
    [{ step: "lobby", language: "ja" }],
    [{ step: "find", language: "fr" }],
    [{ language: "ja" }],
    [{ step: "find" }],
    [null],
  ])("%j 거절", (body) => {
    expect(callRequestSchema.safeParse(body).success).toBe(false);
  });
  it("세션 값은 기존 두 이름 모두 받고, 모양이 틀리면 없는 것으로 본다", () => {
    const id = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(sessionIdOf({ session_id: id })).toBe(id);
    expect(sessionIdOf({ sessionId: id })).toBe(id);
    expect(sessionIdOf({ sessionId: "x" })).toBeNull();
    expect(sessionIdOf({})).toBeNull();
  });
  it("통화 id 모양 · 방 이름", () => {
    const id = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(isCallId(id)).toBe(true);
    expect(isCallId("1;drop")).toBe(false);
    expect(roomNameFor(id)).toBe(`call-${id}`);
  });
});
