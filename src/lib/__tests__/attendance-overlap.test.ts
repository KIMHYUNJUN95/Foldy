import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => ({}) }));

const at = (hhmm: string, day = "2026-09-10") => `${day}T${hhmm}:00+09:00`;
const row = (id: string, inAt: string | null, outAt: string | null, status = "completed") => ({
  id,
  status,
  clock_in_at: inAt,
  clock_out_at: outAt,
});

describe("attendance session overlap (2026-10-19)", () => {
  it("rejects an overlapping range and allows touching ones", async () => {
    const { findOverlappingSession } = await import("../attendance-overlap");
    const existing = [row("a", at("09:00"), at("12:00"))];
    expect(findOverlappingSession({ clockInAt: at("11:00"), clockOutAt: at("13:00") }, existing)?.id).toBe("a");
    expect(findOverlappingSession({ clockInAt: at("08:00"), clockOutAt: at("09:30") }, existing)?.id).toBe("a");
    expect(findOverlappingSession({ clockInAt: at("12:00"), clockOutAt: at("15:00") }, existing)).toBeNull();
    expect(findOverlappingSession({ clockInAt: at("07:00"), clockOutAt: at("09:00") }, existing)).toBeNull();
  });

  it("ignores invalid sessions and the session being edited", async () => {
    const { findOverlappingSession } = await import("../attendance-overlap");
    const existing = [row("a", at("09:00"), at("12:00"), "invalid"), row("b", at("09:00"), at("12:00"))];
    expect(findOverlappingSession({ clockInAt: at("10:00"), clockOutAt: at("11:00") }, existing, "b")).toBeNull();
  });

  it("treats an open session as open-ended and an abandoned one as a point at clock-in", async () => {
    const { findOverlappingSession } = await import("../attendance-overlap");
    const open = [row("o", at("09:00"), null, "open")];
    expect(findOverlappingSession({ clockInAt: at("20:00"), clockOutAt: at("21:00") }, open)?.id).toBe("o");
    expect(findOverlappingSession({ clockInAt: at("07:00"), clockOutAt: at("08:00") }, open)).toBeNull();
    const abandoned = [row("x", at("09:00"), null, "abandoned")];
    expect(findOverlappingSession({ clockInAt: at("10:00"), clockOutAt: at("18:00") }, abandoned)).toBeNull();
    expect(findOverlappingSession({ clockInAt: at("08:00"), clockOutAt: at("10:00") }, abandoned)?.id).toBe("x");
    // 퇴근 없는 후보(수동 open)는 그 뒤 세션과 전부 겹친다.
    expect(
      findOverlappingSession({ clockInAt: at("08:00"), clockOutAt: null }, [row("c", at("13:00"), at("14:00"))])?.id,
    ).toBe("c");
  });
});

describe("finalization blockers ignore invalidated sessions (2026-10-19)", () => {
  it("an invalidated review-required session no longer blocks finalization", async () => {
    const { countBlockingSessions } = await import("../attendance-finalization");
    expect(
      countBlockingSessions([
        { status: "invalid", review_state: "review_required", clock_out_at: null },
        { status: "completed", review_state: "review_required", clock_out_at: at("18:00") },
        { status: "abandoned", review_state: "normal", clock_out_at: null },
        { status: "completed", review_state: "normal", clock_out_at: at("18:00") },
      ]),
    ).toEqual({ reviewRequired: 1, openSessions: 1 });
  });
});
