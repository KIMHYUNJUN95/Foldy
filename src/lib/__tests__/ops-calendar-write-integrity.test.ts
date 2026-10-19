import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/beds24/live-signal", () => ({ signalBeds24Change: vi.fn(async () => undefined) }));
vi.mock("@/lib/beds24/sync-locks", () => ({
  activateBeds24Cooldown: vi.fn(async () => 60),
  getBeds24Cooldown: vi.fn(async () => ({ active: false, reason: null, remainingSec: 0, until: null })),
}));
vi.mock("@/lib/beds24/calendar-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/beds24/calendar-client")>();
  return { ...original, fetchBeds24Calendar: vi.fn(), postBeds24Calendar: vi.fn() };
});

const { enqueueBeds24PriceJob } = await import("@/lib/beds24/price-job-queue");
const { clearRoomBlock, createRoomBlock } = await import("@/lib/beds24/block-write");
const calendarClient = await import("@/lib/beds24/calendar-client");
const fetchCalendar = vi.mocked(calendarClient.fetchBeds24Calendar);
const postCalendar = vi.mocked(calendarClient.postBeds24Calendar);

const ORG = "org-1";

function dates(start: string, count: number): string[] {
  const list: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  for (let index = 0; index < count; index += 1) {
    list.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return list;
}

/** Beds24 달력 응답 — 방마다 밤별 override · numAvail. */
function calendarResponse(byRoom: Record<string, Record<string, { override?: string | null; numAvail?: number }>>) {
  return {
    credit: { remaining: 100, resetInSec: null },
    roomsById: new Map(
      Object.entries(byRoom).map(([roomId, nights]) => [
        roomId,
        {
          calendar: Object.entries(nights).map(([night, value]) => ({ from: night, to: night, ...value })),
          roomId,
        },
      ]),
    ),
    truncated: false,
  };
}

function accepted(roomIds: string[]) {
  return {
    credit: { remaining: 100, resetInSec: null },
    items: roomIds.map((externalRoomId) => ({ accepted: true, error: null, errorCode: null, externalRoomId })),
  };
}

beforeEach(() => {
  fetchCalendar.mockReset();
  postCalendar.mockReset();
});

/**
 * #8 — 1,000칸 넘는 최소숙박 수정이 **일부만** 큐에 들어가던 회귀(2026-10-19).
 *
 * 큐가 칸마다 그날의 minStay 로 「운영 중인 유닛」을 고르는데, 그 읽기가 1,000행에서 잘려 뒤쪽 칸은 유닛이 없어 빠졌다.
 */
describe("enqueueBeds24PriceJob — 1,000행 넘는 요금 읽기", () => {
  it("1,200칸 최소숙박 수정이 전부 큐에 들어간다", async () => {
    const nights = dates("2026-11-01", 600);
    const rooms = [
      { external_price_source_room_id: null, external_room_id: "e1", id: "u1", organization_id: ORG, preferred_min_stay_room_id: null, property_id: "p1" },
      { external_price_source_room_id: null, external_room_id: "e2", id: "u2", organization_id: ORG, preferred_min_stay_room_id: null, property_id: "p1" },
    ];
    const rates = rooms.flatMap((room) =>
      nights.map((night) => ({ min_stay: 2, organization_id: ORG, room_id: room.id, stay_date: night })),
    );
    const fake = createFakeSupabase({ beds24_price_jobs: [], room_daily_rates: rates, rooms });

    const result = await enqueueBeds24PriceJob({
      cells: rooms.flatMap((room) =>
        nights.map((night) => ({ roomIds: [room.id], roomLabel: room.id, stayDate: night, values: { m: 1 } })),
      ),
      jobType: "min_stay",
      organizationId: ORG,
      requestedBy: null,
      requestedByName: null,
      supabase: fake.client as never,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skippedDates).toEqual([]);
    const job = fake.tables.beds24_price_jobs[0] as { room_updates: Array<{ dates: Record<string, unknown> }> };
    const queuedCells = job.room_updates.reduce((sum, update) => sum + Object.keys(update.dates).length, 0);
    expect(queuedCells).toBe(1200);
  });
});

/**
 * #9 — 차단 일부 · 여러 구간 해제가 **재고를 복원하지 않던** 회귀와, 해제 · 차단이 일부만 들어갔을 때 우리 표와 Beds24 가
 * 어긋나던 문제(2026-10-19).
 */
describe("clearRoomBlock — 일부 해제와 실패", () => {
  const range10to14 = { endDate: "2026-11-14", startDate: "2026-11-10" };

  function seed() {
    return createFakeSupabase({
      room_block_snapshots: [
        {
          created_at: "2026-10-01T00:00:00Z",
          end_date: "2026-11-14",
          external_room_id: "101",
          id: "snap-1",
          organization_id: ORG,
          pre_block_num_avail: { "2026-11-10": 1, "2026-11-11": 1, "2026-11-12": 1, "2026-11-13": 1, "2026-11-14": 1 },
          start_date: "2026-11-10",
        },
      ],
      room_blocks: [],
      room_daily_rates: [],
      rooms: [{ external_room_id: "101", id: "u1", organization_id: ORG }],
    });
  }

  it("10~14 차단에서 11~12 만 풀어도 그 밤의 재고를 복원하고, 스냅샷은 남는 밤만 들고 쪼갠다", async () => {
    const fake = seed();
    postCalendar.mockResolvedValueOnce(accepted(["101"]) as never);
    fetchCalendar.mockResolvedValueOnce(
      calendarResponse({ "101": { "2026-11-11": { override: null }, "2026-11-12": { override: null } } }) as never,
    );

    const result = await clearRoomBlock({
      externalRoomIds: ["101"],
      organizationId: ORG,
      propertyName: "P",
      range: { endDate: "2026-11-12", startDate: "2026-11-11" },
      roomLabel: "101",
      supabase: fake.client as never,
    });

    expect(result.ok).toBe(true);
    const sent = postCalendar.mock.calls[0][0] as Array<{ calendar: Array<Record<string, unknown>> }>;
    expect(sent[0].calendar).toEqual([{ from: "2026-11-11", numAvail: 1, override: "none", to: "2026-11-12" }]);
    const kept = fake.tables.room_block_snapshots.map((row) => [row.start_date, row.end_date, row.pre_block_num_avail]);
    expect(kept).toEqual([
      ["2026-11-10", "2026-11-10", { "2026-11-10": 1 }],
      ["2026-11-13", "2026-11-14", { "2026-11-13": 1, "2026-11-14": 1 }],
    ]);
  });

  it("되읽기에서 일부만 풀렸으면 풀린 밤을 다시 막고, 우리 표(스냅샷)는 그대로 둔다", async () => {
    const fake = seed();
    postCalendar
      .mockResolvedValueOnce(accepted(["101"]) as never)
      .mockResolvedValueOnce(accepted(["101"]) as never);
    fetchCalendar.mockResolvedValueOnce(
      calendarResponse({
        "101": {
          "2026-11-10": { override: null },
          "2026-11-11": { override: null },
          "2026-11-12": { override: "blackout" },
          "2026-11-13": { override: "blackout" },
          "2026-11-14": { override: "blackout" },
        },
      }) as never,
    );

    const result = await clearRoomBlock({
      externalRoomIds: ["101"],
      organizationId: ORG,
      propertyName: "P",
      range: range10to14,
      roomLabel: "101",
      supabase: fake.client as never,
    });

    expect(result).toMatchObject({ ok: false, reason: "verify_mismatch" });
    const reblock = postCalendar.mock.calls[1][0] as Array<{ calendar: Array<Record<string, unknown>> }>;
    expect(reblock[0].calendar).toEqual([{ from: "2026-11-10", override: "blackout", to: "2026-11-11" }]);
    expect(fake.tables.room_block_snapshots).toHaveLength(1);
    expect(fake.writes.filter((write) => write.op === "delete")).toHaveLength(0);
  });

  it("다시 막기도 실패하면 사람에게 Beds24 확인을 요청한다", async () => {
    const fake = seed();
    postCalendar.mockResolvedValueOnce(accepted(["101"]) as never).mockRejectedValueOnce(new Error("network"));
    fetchCalendar.mockRejectedValueOnce(new Error("timeout"));

    const result = await clearRoomBlock({
      externalRoomIds: ["101"],
      organizationId: ORG,
      propertyName: "P",
      range: range10to14,
      roomLabel: "101",
      supabase: fake.client as never,
    });

    expect(result).toMatchObject({ ok: false, reason: "unblock_not_restored" });
  });
});

describe("createRoomBlock — 되읽기 불일치 보상 롤백", () => {
  it("검증에 실패하면 원래 열려 있던 밤만 되돌린다 — 이미 막혀 있던 밤은 건드리지 않는다", async () => {
    const fake = createFakeSupabase({ room_block_snapshots: [], room_blocks: [], room_daily_rates: [], rooms: [] });
    fetchCalendar
      .mockResolvedValueOnce(
        calendarResponse({
          "101": {
            "2026-11-10": { numAvail: 1, override: null },
            "2026-11-11": { numAvail: 0, override: "blackout" },
            "2026-11-12": { numAvail: 1, override: null },
          },
        }) as never,
      )
      .mockResolvedValueOnce(
        calendarResponse({
          "101": {
            "2026-11-10": { override: "blackout" },
            "2026-11-11": { override: "blackout" },
            "2026-11-12": { override: null },
          },
        }) as never,
      );
    postCalendar
      .mockResolvedValueOnce(accepted(["101"]) as never)
      .mockResolvedValueOnce(accepted(["101"]) as never);

    const result = await createRoomBlock({
      externalRoomIds: ["101"],
      organizationId: ORG,
      propertyName: "P",
      range: { endDate: "2026-11-12", startDate: "2026-11-10" },
      roomLabel: "101",
      supabase: fake.client as never,
    });

    expect(result).toMatchObject({ ok: false, reason: "verify_mismatch" });
    const rollback = postCalendar.mock.calls[1][0] as Array<{ calendar: Array<Record<string, unknown>> }>;
    expect(rollback[0].calendar).toEqual([
      { from: "2026-11-10", numAvail: 1, override: "none", to: "2026-11-10" },
      { from: "2026-11-12", numAvail: 1, override: "none", to: "2026-11-12" },
    ]);
    expect(fake.tables.room_block_snapshots).toHaveLength(0);
  });

  it("되돌리기도 실패하면 Beds24 확인을 요청하는 사유로 돌린다", async () => {
    const fake = createFakeSupabase({ room_block_snapshots: [], room_blocks: [], room_daily_rates: [], rooms: [] });
    fetchCalendar
      .mockResolvedValueOnce(calendarResponse({ "101": { "2026-11-10": { numAvail: 1, override: null } } }) as never)
      .mockRejectedValueOnce(new Error("timeout"));
    postCalendar.mockResolvedValueOnce(accepted(["101"]) as never).mockRejectedValueOnce(new Error("network"));

    const result = await createRoomBlock({
      externalRoomIds: ["101"],
      organizationId: ORG,
      propertyName: "P",
      range: { endDate: "2026-11-10", startDate: "2026-11-10" },
      roomLabel: "101",
      supabase: fake.client as never,
    });

    expect(result).toMatchObject({ ok: false, reason: "save_failed_not_rolled_back" });
  });

  it("이미 막혀 있던 밤의 재고는 스냅샷에 넣지 않는다", async () => {
    const fake = createFakeSupabase({ room_block_snapshots: [], room_blocks: [], room_daily_rates: [], rooms: [] });
    fetchCalendar
      .mockResolvedValueOnce(
        calendarResponse({
          "101": { "2026-11-10": { numAvail: 1, override: null }, "2026-11-11": { numAvail: 0, override: "blackout" } },
        }) as never,
      )
      .mockResolvedValueOnce(
        calendarResponse({
          "101": { "2026-11-10": { override: "blackout" }, "2026-11-11": { override: "blackout" } },
        }) as never,
      );
    postCalendar.mockResolvedValueOnce(accepted(["101"]) as never);

    const result = await createRoomBlock({
      externalRoomIds: ["101"],
      organizationId: ORG,
      propertyName: "P",
      range: { endDate: "2026-11-11", startDate: "2026-11-10" },
      roomLabel: "101",
      supabase: fake.client as never,
    });

    expect(result.ok).toBe(true);
    expect(fake.tables.room_block_snapshots[0].pre_block_num_avail).toEqual({ "2026-11-10": 1 });
  });
});
