import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";
import { opsUnitRoomKey } from "@/lib/ops-room-key";

/**
 * #10 — 수기 예약의 **이중 생성** 방어(2026-10-19): 방 잠금 · 만들기 직전 Beds24 가용 재확인 · 시간 초과를 「모름」으로.
 *
 * 서버 액션을 그대로 돌리되 바깥(세션 · DB · Beds24)은 전부 가짜다 — Beds24 를 실제로 부르지 않는다.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/admin-session", () => ({
  getAdminSessionForApi: vi.fn(async () => ({
    ok: true,
    session: { organization: { id: "org-1" }, user: { id: "user-1", name: "Tester" } },
  })),
}));
vi.mock("@/lib/ops-admin", () => ({ canAccessOpsAdmin: () => true, canWriteOpsCalendar: () => true }));
vi.mock("@/app/api/ops/calendar/reads", () => ({ readRoomNames: vi.fn() }));
vi.mock("@/lib/beds24/process-webhook-booking", () => ({
  processBeds24WebhookBooking: vi.fn(async () => ({ ok: true, reservationId: "res-1" })),
}));
vi.mock("@/lib/ops-calendar", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ops-calendar")>();
  return { ...original, readOpsRoomUnavailableNights: vi.fn(async () => ({ booked: [], unsellable: [] })) };
});
vi.mock("@/lib/beds24/sync-locks", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/beds24/sync-locks")>();
  return {
    ...original,
    activateBeds24Cooldown: vi.fn(async () => 60),
    getBeds24Cooldown: vi.fn(async () => ({ active: false, reason: null, remainingSec: 0, until: null })),
  };
});
vi.mock("@/lib/beds24/calendar-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/beds24/calendar-client")>();
  return {
    ...original,
    fetchBeds24BookingById: vi.fn(async () => ({ error: "not_found", ok: false })),
    fetchBeds24Calendar: vi.fn(),
    postBeds24Booking: vi.fn(),
  };
});

let fake = createFakeSupabase({});
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fake.client }));

const { submitManualBooking } = await import("@/actions/ops-calendar");
const calendarClient = await import("@/lib/beds24/calendar-client");
const fetchCalendar = vi.mocked(calendarClient.fetchBeds24Calendar);
const postBooking = vi.mocked(calendarClient.postBeds24Booking);

const PROPERTY = { external_property_id: "176431", name: "Test House" };
const ROOM_KEY = opsUnitRoomKey({ propertyName: PROPERTY.name, roomLabel: "101" })!;

function seed() {
  fake = createFakeSupabase({
    ops_manual_booking_requests: [],
    room_daily_rates: ["2030-01-10", "2030-01-11"].map((night) => ({
      min_stay: 1,
      organization_id: "org-1",
      room_id: "u1",
      stay_date: night,
    })),
    rooms: [{ external_room_id: "5001", id: "u1", organization_id: "org-1", properties: PROPERTY, room_label: "101" }],
  });
}

function liveCalendar(nights: Record<string, { numAvail?: number; override?: string | null }>) {
  return {
    credit: { remaining: 100, resetInSec: null },
    roomsById: new Map([
      [
        "5001",
        {
          calendar: Object.entries(nights).map(([night, value]) => ({ from: night, to: night, ...value })),
          roomId: "5001",
        },
      ],
    ]),
    truncated: false,
  };
}

const request = (requestKey: string) => ({
  comments: "",
  guestEmail: "",
  guestPhone: "",
  input: {
    arrival: "2030-01-10",
    departure: "2030-01-12",
    guestName: "Kim Guest",
    numAdult: 1,
    numChild: 0,
    roomKey: ROOM_KEY,
    totalPrice: 20000,
  },
  requestKey,
  roomIds: ["u1"],
});

beforeEach(() => {
  seed();
  fetchCalendar.mockReset();
  postBooking.mockReset();
});

describe("submitManualBooking — 같은 방 동시 생성", () => {
  it("같은 방 잠금을 남이 들고 있으면 Beds24 를 부르지 않고 「방 사용 중」으로 돌린다", async () => {
    fake.client.rpc = async (name: string) => ({ data: name === "beds24_try_lock" ? false : true, error: null });

    const result = await submitManualBooking(request("key-aaaaaaaa"));

    expect(result).toEqual({ error: "room_busy", ok: false });
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(postBooking).not.toHaveBeenCalled();
  });

  it("잠금 이름은 방 단위다 — 기간이 달라도 같은 방이면 같은 잠금을 다툰다", async () => {
    fetchCalendar.mockResolvedValue(liveCalendar({}) as never);
    postBooking.mockResolvedValue({ bookingId: "900", ok: true, raw: {} } as never);

    await submitManualBooking(request("key-aaaaaaaa"));

    const lockCalls = fake.rpcCalls.filter((call) => call.name === "beds24_try_lock");
    const releaseCalls = fake.rpcCalls.filter((call) => call.name === "beds24_release_lock");
    expect(lockCalls).toHaveLength(1);
    expect((lockCalls[0].args as { p_name: string }).p_name).toBe(`manual_booking:org-1:${ROOM_KEY}`);
    // 끝나면 놓는다.
    expect(releaseCalls).toHaveLength(1);
  });

  it("우리 표엔 비어 있어도 Beds24 재고가 0 인 밤이 있으면 만들지 않는다", async () => {
    fetchCalendar.mockResolvedValue(liveCalendar({ "2030-01-11": { numAvail: 0 } }) as never);

    const result = await submitManualBooking(request("key-bbbbbbbb"));

    expect(result).toEqual({ conflictDates: ["2030-01-11"], error: "occupied", ok: false });
    expect(postBooking).not.toHaveBeenCalled();
    // 확인에서 막혔으면 요청 키도 잡지 않는다 — 다시 시도할 수 있다.
    expect(fake.tables.ops_manual_booking_requests).toHaveLength(0);
  });

  it("가용 재확인을 못 하면(시간 초과) 만들지 않는다", async () => {
    fetchCalendar.mockRejectedValue(new DOMException("timed out", "TimeoutError"));

    const result = await submitManualBooking(request("key-cccccccc"));

    expect(result).toMatchObject({ error: "beds24_failed", ok: false });
    expect(postBooking).not.toHaveBeenCalled();
  });

  it("생성 호출이 시간 초과면 「모름」으로 돌리고 요청 키를 붙잡아 둔다 — 같은 키로 다시 눌러도 또 만들지 않는다", async () => {
    fetchCalendar.mockResolvedValue(liveCalendar({}) as never);
    postBooking.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));

    const first = await submitManualBooking(request("key-dddddddd"));
    expect(first).toEqual({ error: "unconfirmed", ok: false });
    expect(fake.tables.ops_manual_booking_requests).toHaveLength(1);
    // 생성 호출에 시간 제한이 걸려 있다.
    expect(postBooking.mock.calls[0][1]).toMatchObject({ timeoutMs: expect.any(Number) });

    const again = await submitManualBooking(request("key-dddddddd"));
    expect(again).toEqual({ error: "duplicate_request", ok: false });
    expect(postBooking).toHaveBeenCalledTimes(1);
  });

  it("Beds24 가 4xx 로 거절하면 안 만들어진 것이 확실하므로 요청 키를 놓는다", async () => {
    fetchCalendar.mockResolvedValue(liveCalendar({}) as never);
    postBooking.mockRejectedValueOnce(new calendarClient.Beds24HttpError(400, null, false));

    const result = await submitManualBooking(request("key-eeeeeeee"));

    expect(result).toMatchObject({ error: "beds24_failed", ok: false });
    expect(fake.tables.ops_manual_booking_requests).toHaveLength(0);
  });

  it("이미 만든 요청 키로 다시 누르면 겹침 확인 전에 그 예약을 돌려준다", async () => {
    fake.tables.ops_manual_booking_requests.push({
      booking_id: "777",
      organization_id: "org-1",
      request_key: "key-ffffffff",
      reservation_id: "res-9",
    });

    const result = await submitManualBooking(request("key-ffffffff"));

    expect(result).toEqual({ bookingId: "777", ok: true, reservationId: "res-9" });
    expect(fetchCalendar).not.toHaveBeenCalled();
  });
});
