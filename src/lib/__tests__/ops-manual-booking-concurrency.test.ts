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
vi.mock("@/lib/beds24/live-signal", () => ({ signalBeds24Change: vi.fn(async () => undefined) }));
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
    postBeds24Calendar: vi.fn(),
    postBeds24BookingUpdate: vi.fn(),
  };
});

let fake = createFakeSupabase({});
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fake.client }));

const { revertBlockChange, submitManualBooking, submitReservationEdit, submitRoomBlock } = await import("@/actions/ops-calendar");
const calendarClient = await import("@/lib/beds24/calendar-client");
const postCalendar = vi.mocked(calendarClient.postBeds24Calendar);
const fetchBooking = vi.mocked(calendarClient.fetchBeds24BookingById);
const fetchCalendar = vi.mocked(calendarClient.fetchBeds24Calendar);
const postBooking = vi.mocked(calendarClient.postBeds24Booking);
const postBookingUpdate = vi.mocked(calendarClient.postBeds24BookingUpdate);

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
  postBookingUpdate.mockReset();
  postCalendar.mockReset();
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

/**
 * 예약 수정도 새로 묵는 밤이 있으면 수기 예약 · 옮기기와 **같은 방 잠금** 안에서 확인 → 보내기, 보내기 직전 Beds24 가용 재확인
 * (2026-10-26). 인원 · 이름만 바꾸면 가용이 안 바뀌므로 잠그지 않는다.
 */
describe("submitReservationEdit — 방 잠금 · Beds24 재확인", () => {
  const seedReservation = () => {
    fake.tables.reservations = [
      {
        check_in_date: "2030-01-10",
        check_out_date: "2030-01-11",
        guest_name: "Kim Guest",
        id: "res-1",
        organization_id: "org-1",
        raw_payload: { bookId: 900, numAdult: 1, numChild: 0, price: 10000, roomId: 5001 },
        source: "beds24",
        status: "confirmed",
      },
    ];
  };
  const extend = { changes: { departure: "2030-01-12" }, reservationId: "res-1", roomIds: ["u1"], roomKey: ROOM_KEY };

  it("같은 방 잠금을 남이 들고 있으면 Beds24 를 부르지 않고 「방 사용 중」", async () => {
    seedReservation();
    fake.client.rpc = async (name: string) => ({ data: name === "beds24_try_lock" ? false : true, error: null });

    const result = await submitReservationEdit(extend);

    expect(result).toEqual({ error: "room_busy", ok: false });
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(postBookingUpdate).not.toHaveBeenCalled();
  });

  it("새 밤이 Beds24 에서 찼으면 보내지 않는다 · 잠금은 놓는다", async () => {
    seedReservation();
    fetchCalendar.mockResolvedValue(liveCalendar({ "2030-01-11": { numAvail: 0 } }) as never);

    const result = await submitReservationEdit(extend);

    expect(result).toEqual({ conflictDates: ["2030-01-11"], error: "occupied", ok: false });
    expect(postBookingUpdate).not.toHaveBeenCalled();
    expect(fake.rpcCalls.filter((call) => call.name === "beds24_release_lock")).toHaveLength(1);
  });

  it("비어 있으면 같은 방 잠금(manual_booking:조직:행 키) 안에서 보낸다", async () => {
    seedReservation();
    fetchCalendar.mockResolvedValue(liveCalendar({}) as never);
    postBookingUpdate.mockResolvedValue({ ok: true } as never);

    const result = await submitReservationEdit(extend);

    // 다시 읽기가 안 됐다(가짜는 not_found) — Beds24 엔 반영됐지만 우리 표는 못 맞췄다 → 「반영 지연」(2026-10-26).
    expect(result).toEqual({ ok: true, stale: true });
    const lockCalls = fake.rpcCalls.filter((call) => call.name === "beds24_try_lock");
    expect(lockCalls).toHaveLength(1);
    expect((lockCalls[0].args as { p_name: string }).p_name).toBe(`manual_booking:org-1:${ROOM_KEY}`);
    expect(fake.rpcCalls.filter((call) => call.name === "beds24_release_lock")).toHaveLength(1);
    // 재확인은 그 유닛 · 새 밤만.
    expect(fetchCalendar.mock.calls[0][0]).toMatchObject({ endDate: "2030-01-11", externalRoomIds: ["5001"], startDate: "2030-01-11" });
  });

  it("인원만 바꾸면 잠그지도 재확인하지도 않는다", async () => {
    seedReservation();
    postBookingUpdate.mockResolvedValue({ ok: true } as never);

    const result = await submitReservationEdit({ ...extend, changes: { numAdult: 2 } });

    expect(result).toEqual({ ok: true, stale: true });
    expect(fake.rpcCalls.filter((call) => call.name === "beds24_try_lock")).toHaveLength(0);
    expect(fetchCalendar).not.toHaveBeenCalled();
  });
});

describe("submitReservationEdit — 우리 표 다시 맞추기(반영 지연)", () => {
  it("다시 읽어 우리 표를 맞췄으면 `stale` 없이 성공", async () => {
    fake.tables.reservations = [
      {
        check_in_date: "2030-01-10",
        check_out_date: "2030-01-11",
        guest_name: "Kim Guest",
        id: "res-1",
        organization_id: "org-1",
        raw_payload: { bookId: 900, numAdult: 1, numChild: 0, price: 10000, roomId: 5001 },
        source: "beds24",
        status: "confirmed",
      },
    ];
    postBookingUpdate.mockResolvedValue({ ok: true } as never);
    fetchBooking.mockResolvedValueOnce({ booking: { id: 900, numAdult: 2 }, ok: true } as never);

    const result = await submitReservationEdit({
      changes: { numAdult: 2 },
      reservationId: "res-1",
      roomIds: ["u1"],
      roomKey: ROOM_KEY,
    });

    expect(result).toEqual({ ok: true });
  });
});

/**
 * 차단 걸기 · 풀기(2026-10-26) — 수기 예약과 같은 방 잠금, 변경 이력은 **정말 바뀐 밤만**, 되돌리기는 그 밤만.
 */
describe("submitRoomBlock — 방 잠금 · 바뀐 밤만 이력", () => {
  const cells = ["2030-01-10", "2030-01-11"].map((date) => ({ date, roomIds: ["u1"], roomKey: ROOM_KEY, roomLabel: "101" }));

  it("같은 방 잠금을 남이 들고 있으면 Beds24 를 부르지 않고 「방 사용 중」", async () => {
    fake.client.rpc = async (name: string) => ({ data: name === "beds24_try_lock" ? false : true, error: null });

    const result = await submitRoomBlock({ cells });

    expect(result).toEqual({ error: "room_busy", ok: false });
    expect(fetchCalendar).not.toHaveBeenCalled();
    expect(postCalendar).not.toHaveBeenCalled();
  });

  it("이미 막혀 있던 밤은 이력에 남기지 않고, 되돌리기는 원래 열려 있던 밤만 푼다", async () => {
    fake.tables.price_change_logs = [];
    fetchCalendar
      // 걸기 ① 막기 전 — 10일 열림, 11일은 원래 막혀 있음.
      .mockResolvedValueOnce(
        liveCalendar({ "2030-01-10": { numAvail: 1, override: null }, "2030-01-11": { numAvail: 0, override: "blackout" } }) as never,
      )
      // 걸기 ③ 되읽기.
      .mockResolvedValueOnce(
        liveCalendar({ "2030-01-10": { override: "blackout" }, "2030-01-11": { override: "blackout" } }) as never,
      )
      // 되돌리기(풀기) — 풀기 전 · 되읽기.
      .mockResolvedValueOnce(liveCalendar({ "2030-01-10": { override: "blackout" } }) as never)
      .mockResolvedValueOnce(liveCalendar({ "2030-01-10": { override: null } }) as never);
    postCalendar.mockResolvedValue({
      credit: { remaining: 100, resetInSec: null },
      items: [{ accepted: true, error: null, errorCode: null, externalRoomId: "5001" }],
    } as never);

    const blocked = await submitRoomBlock({ cells });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    const logs = fake.tables.price_change_logs as Array<{ stay_date: string; old_value: number; new_value: number }>;
    expect(logs.map((log) => [log.stay_date, log.old_value, log.new_value])).toEqual([["2030-01-10", 0, 1]]);
    // 잠금은 걸기 동안 잡고(수기 예약과 같은 이름) 끝나면 놓는다.
    const lockCalls = fake.rpcCalls.filter((call) => call.name === "beds24_try_lock");
    expect((lockCalls[0].args as { p_name: string }).p_name).toBe(`manual_booking:org-1:${ROOM_KEY}`);
    expect(fake.rpcCalls.filter((call) => call.name === "beds24_release_lock")).toHaveLength(1);

    const reverted = await revertBlockChange({ at: blocked.at });

    expect(reverted).toEqual({ cells: 1, ok: true, skippedChanged: 0 });
    const unblockPayload = postCalendar.mock.calls[1][0] as Array<{ calendar: Array<{ from: string; to: string }> }>;
    expect(unblockPayload[0].calendar.map((segment) => [segment.from, segment.to])).toEqual([["2030-01-10", "2030-01-10"]]);
  });
});
