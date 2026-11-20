import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";
import { searchInbox } from "@/lib/guest-messages/inbox-server";
import { createSearchRunner } from "@/lib/guest-messages/search-runner";

/**
 * 손님 메시지 검색 속도(2026-11-20) — 서버는 읽기 횟수 · 동시 실행을, 화면 쪽은 언제 서버에 묻는지를 가짜 시계로 센다.
 * docs/product/47-guest-messaging.md §5-10 「검색 속도」
 */
type Row = Record<string, unknown>;

const ORG = "00000000-0000-4000-8000-000000000900";
const NOW = new Date("2026-11-20T03:00:00.000Z");
const CONV = "00000000-0000-4000-8000-000000000001";

function conversation(id: string): Row {
  return {
    id,
    organization_id: ORG,
    provider: "beds24",
    provider_booking_id: "b-1",
    reservation_id: null,
    property_name: "아라키초A",
    room_label: "201",
    channel: "airbnb",
    booking_status: "confirmed",
    check_in_date: "2026-11-20",
    check_out_date: "2026-11-22",
    guest_name: "Kimura Taro",
    guest_language: "en",
    status: "awaiting",
    snooze_until: null,
    last_guest_at: "2026-11-13T00:00:00Z",
    last_reply_at: null,
    last_message_at: "2026-11-13T00:00:00Z",
  };
}

function searchRow(): Row {
  return {
    conversation_id: CONV,
    last_message_at: "2026-11-13T00:00:00Z",
    guest_name: "Kimura Taro",
    reservation_guest_name: null,
    name_hit: true,
    reference_hit: false,
    place_hit: false,
    phone: null,
    mobile: null,
    email_hit: false,
    body_message_id: null,
    body_direction: null,
    body: null,
  };
}

/** 표마다 읽은 횟수와 동시에 떠 있던 최대 수 — 응답을 한 틱 늦춰 잰다. */
function instrument(fake: ReturnType<typeof createFakeSupabase>) {
  const counts: Record<string, number> = {};
  let now = 0;
  let max = 0;
  const client = {
    ...fake.client,
    from(table: string) {
      const builder = fake.client.from(table) as unknown as {
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
      };
      const then = builder.then.bind(builder);
      builder.then = (resolve, reject) => {
        counts[table] = (counts[table] ?? 0) + 1;
        now += 1;
        max = Math.max(max, now);
        return new Promise((r) => setTimeout(r, 5)).then(() =>
          then((result) => {
            now -= 1;
            return resolve(result);
          }, reject),
        );
      };
      return builder;
    },
  };
  return { client: client as never, counts, maxInFlight: () => max };
}

describe("검색 서버 — 건물 정보 한 번 · 뒤쪽 읽기는 한꺼번에", () => {
  const rpc = {
    guest_conversation_search: () => ({ data: [searchRow()], error: null }),
    guest_conversation_last_lines: () => ({ data: [], error: null }),
  };

  it("코드를 못 보는 사람 — 건물 정보(property_operation_infos)는 한 번만 읽는다", async () => {
    const fake = createFakeSupabase({ guest_conversations: [conversation(CONV)], guest_message_outbox: [], property_operation_infos: [] }, rpc);
    const db = instrument(fake);
    const result = await searchInbox(db.client, ORG, "kim", { building: null }, NOW, { canSeeCodes: false, canManageAuto: false });
    expect(result.results).toHaveLength(1);
    expect(db.counts.property_operation_infos).toBe(1);
  });

  it("코드를 보는 사람 — 건물 정보를 읽지 않고, 대화 줄 · 발송 줄은 동시에 읽는다", async () => {
    const fake = createFakeSupabase({ guest_conversations: [conversation(CONV)], guest_message_outbox: [] }, rpc);
    const db = instrument(fake);
    const result = await searchInbox(db.client, ORG, "kim", { building: null }, NOW);
    expect(result.results).toHaveLength(1);
    expect(db.counts.property_operation_infos).toBeUndefined();
    expect(db.maxInFlight()).toBe(2);
  });
});

/** 가짜 시계 — `advance(ms)` 로 시간을 밀고, 그 사이 잡힌 타이머를 차례로 돌린다. */
function fakeTimers() {
  let clock = 0;
  let nextId = 1;
  const queue = new Map<number, { at: number; run: () => void }>();
  return {
    timers: {
      setTimeout: (run: () => void, ms: number) => {
        const id = nextId++;
        queue.set(id, { at: clock + ms, run });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        queue.delete(handle as number);
      },
      now: () => clock,
    },
    advance(ms: number) {
      const end = clock + ms;
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        clock = due[1].at;
        due[1].run();
      }
      clock = end;
    },
  };
}

/** 서버 답을 손으로 풀어 주는 가짜 fetch. */
function manualFetch() {
  const calls: Array<{ query: string; resolve: (value: string) => void }> = [];
  return {
    calls,
    fetch: (query: string) => new Promise<string>((resolve) => calls.push({ query, resolve })),
    answer: async (index: number) => {
      calls[index].resolve(`answer:${calls[index].query}`);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function setup() {
  const clock = fakeTimers();
  const server = manualFetch();
  const results: Array<[string, string | null]> = [];
  const commits: Array<string | null> = [];
  const starts: string[] = [];
  const runner = createSearchRunner<string>({
    fetch: server.fetch,
    onStart: (q) => starts.push(q),
    onResult: (q, r) => results.push([q, r]),
    onCommit: (q) => commits.push(q),
    timers: clock.timers,
  });
  return { clock, server, results, commits, starts, runner };
}

describe("검색 묻는 때 — 사라질 때 · 지웠다 다시 · 실시간과 겹칠 때", () => {
  it("입력 직후(300ms 안) 사라지면 아직 안 쓴 주소를 마지막 검색어로 쓰고, 서버에는 묻지 않는다", () => {
    const { clock, server, commits, runner } = setup();
    runner.type("ki");
    clock.advance(100);
    runner.type("kim");
    runner.dispose();
    expect(commits).toEqual(["kim"]);
    clock.advance(1000);
    expect(server.calls).toHaveLength(0);
    expect(commits).toEqual(["kim"]);
  });

  it("flush() — 떠나기 직전(누름) 주소만 먼저 쓰고, 검색은 그대로 300ms 뒤 — 주소는 두 번 쓰지 않는다", () => {
    const { clock, server, commits, runner } = setup();
    runner.type("kim");
    runner.flush();
    expect(commits).toEqual(["kim"]);
    expect(server.calls).toHaveLength(0);
    clock.advance(300);
    expect(server.calls.map((c) => c.query)).toEqual(["kim"]);
    expect(commits).toEqual(["kim"]);
    runner.dispose();
    expect(commits).toEqual(["kim"]);
  });

  it("쓸 주소가 없으면 사라질 때 아무것도 쓰지 않는다(개발 모드 이펙트 두 번 · 필터 바꿔 다시 그리기)", () => {
    const first = setup();
    first.runner.dispose();
    expect(first.commits).toEqual([]);
    const second = setup();
    second.runner.submit("kim");
    second.runner.dispose();
    expect(second.commits).toEqual(["kim"]);
    const third = setup();
    third.runner.submit("kim");
    third.runner.type(null);
    third.runner.dispose();
    expect(third.commits).toEqual(["kim", null]);
  });

  it("사라진 뒤에는 타이머 · 묻고 있던 답 · 기다리던 검색 모두 onStart / onResult 를 부르지 않는다", async () => {
    const { clock, server, results, starts, runner } = setup();
    runner.submit("kim");
    runner.live();
    runner.type("kimu");
    runner.dispose();
    await server.answer(0);
    clock.advance(10_000);
    runner.type("kimur");
    runner.submit("kimura");
    runner.refresh();
    runner.live();
    clock.advance(10_000);
    expect(starts).toEqual(["kim"]);
    expect(results).toEqual([]);
    expect(server.calls).toHaveLength(1);
  });

  it("묻는 중에 온 실시간 신호는 끝난 뒤 한 번만 이어 돈다", async () => {
    const { clock, server, results, runner } = setup();
    runner.submit("kim");
    clock.advance(6000); // 간격(5초)은 지났지만 아직 묻는 중
    runner.live();
    runner.live();
    runner.live();
    expect(server.calls).toHaveLength(1);
    await server.answer(0);
    expect(results).toEqual([["kim", "answer:kim"]]);
    expect(server.calls.map((c) => c.query)).toEqual(["kim", "kim"]);
    await server.answer(1);
    clock.advance(10_000);
    expect(server.calls).toHaveLength(2);
  });

  it("실시간 타이머가 입력 중(300ms 대기)에 울리면 건너뛰고, 새 검색어로 한 번만 찾는다", async () => {
    const { clock, server, runner } = setup();
    runner.submit("kim");
    await server.answer(0);
    runner.live(); // 5초 뒤 타이머
    clock.advance(4900);
    runner.type("kimu");
    clock.advance(100); // 실시간 타이머가 여기서 울림 — 입력 중이라 건너뜀
    expect(server.calls.map((c) => c.query)).toEqual(["kim"]);
    clock.advance(200);
    expect(server.calls.map((c) => c.query)).toEqual(["kim", "kimu"]);
    await server.answer(1);
    clock.advance(10_000);
    expect(server.calls).toHaveLength(2);
  });

  it("지웠다가 같은 말을 다시 치면 — 지우기 전에 묻던 답은 버리고 새로 묻는다", async () => {
    const { clock, server, results, commits, runner } = setup();
    runner.submit("kim");
    runner.type(null);
    runner.type("kim");
    await server.answer(0);
    expect(results).toEqual([]);
    clock.advance(300);
    expect(server.calls.map((c) => c.query)).toEqual(["kim", "kim"]);
    await server.answer(1);
    expect(results).toEqual([["kim", "answer:kim"]]);
    expect(commits).toEqual(["kim", null, "kim"]);
  });

  it("지웠다가 같은 말을 다시 치면 — 앞 답이 이미 왔어도 새로 묻는다", async () => {
    const { clock, server, results, runner } = setup();
    runner.submit("kim");
    await server.answer(0);
    runner.type(null);
    runner.type("kim");
    clock.advance(300);
    expect(server.calls).toHaveLength(2);
    await server.answer(1);
    expect(results).toEqual([
      ["kim", "answer:kim"],
      ["kim", "answer:kim"],
    ]);
  });
});

describe("검색 묻는 때 — 입력 · 한 번에 하나 · 실시간 간격", () => {
  it("글자를 칠 때마다 300ms 를 다시 세고, 주소는 입력이 멈춘 뒤에만 쓴다", () => {
    const { clock, server, commits, runner } = setup();
    runner.type("ki");
    clock.advance(200);
    runner.type("kim");
    clock.advance(200);
    expect(server.calls).toHaveLength(0);
    expect(commits).toEqual([]);
    clock.advance(100);
    expect(server.calls.map((c) => c.query)).toEqual(["kim"]);
    expect(commits).toEqual(["kim"]);
  });

  it("묻는 동안 새로 친 말은 마지막 하나만 보내고, 앞 검색어의 답은 버린다", async () => {
    const { clock, server, results, runner } = setup();
    runner.type("kim");
    clock.advance(300);
    runner.type("kimu");
    clock.advance(300);
    runner.type("kimur");
    clock.advance(300);
    // 「kim」 이 아직 돌고 있어 「kimu」 · 「kimur」 는 기다린다 — 서버에 간 것은 하나.
    expect(server.calls.map((c) => c.query)).toEqual(["kim"]);
    await server.answer(0);
    expect(results).toEqual([]);
    // 중간 것(「kimu」)은 건너뛰고 마지막 것만.
    expect(server.calls.map((c) => c.query)).toEqual(["kim", "kimur"]);
    await server.answer(1);
    expect(results).toEqual([["kimur", "answer:kimur"]]);
  });

  it("새 글자를 치면 묻고 있던 답은 300ms 를 기다리는 중에 와도 버린다", async () => {
    const { clock, server, results, runner } = setup();
    runner.submit("kim");
    runner.type("kimu");
    await server.answer(0);
    expect(results).toEqual([]);
    clock.advance(300);
    await server.answer(1);
    expect(results).toEqual([["kimu", "answer:kimu"]]);
  });

  it("지우면 바로 멈추고 주소에서도 뺀다 — 늦게 온 답은 그리지 않는다", async () => {
    const { server, results, commits, runner } = setup();
    runner.submit("kim");
    runner.type(null);
    await server.answer(0);
    expect(results).toEqual([]);
    expect(commits).toEqual(["kim", null]);
  });

  it("실시간 신호는 5초에 한 번까지 — 그 안에 온 신호는 끝에 한 번으로 모은다", async () => {
    const { clock, server, runner } = setup();
    runner.submit("kim");
    await server.answer(0);
    for (let i = 0; i < 10; i += 1) {
      runner.live();
      clock.advance(100);
    }
    expect(server.calls).toHaveLength(1);
    clock.advance(5000);
    expect(server.calls).toHaveLength(2);
    await server.answer(1);
    clock.advance(10_000);
    expect(server.calls).toHaveLength(2);
  });

  it("입력 중(300ms 대기)에는 실시간 신호 · 다시 찾기를 건너뛴다", () => {
    const { clock, server, runner } = setup();
    runner.type("kim");
    runner.live();
    runner.refresh();
    clock.advance(300);
    expect(server.calls.map((c) => c.query)).toEqual(["kim"]);
  });

  it("내 손으로 바꾼 뒤(refresh)는 간격 없이 바로 — 묻는 중이면 끝난 뒤 한 번", async () => {
    const { server, results, runner } = setup();
    runner.submit("kim");
    runner.refresh();
    runner.refresh();
    expect(server.calls).toHaveLength(1);
    await server.answer(0);
    // 같은 검색어라 앞 답도 그린다(보이던 결과를 갈아 끼움) — 그리고 모아 둔 다시 찾기 한 번.
    expect(results).toEqual([["kim", "answer:kim"]]);
    expect(server.calls).toHaveLength(2);
  });

  it("실패한 답은 null 로 알린다", async () => {
    const clock = fakeTimers();
    const results: Array<[string, unknown]> = [];
    const runner = createSearchRunner({
      fetch: () => Promise.reject(new Error("down")),
      onResult: (q, r) => results.push([q, r]),
      timers: clock.timers,
    });
    runner.submit("kim");
    await new Promise((r) => setTimeout(r, 0));
    expect(results).toEqual([["kim", null]]);
  });
});
