import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 과거 답장에서 찾은 후보 — 권한 · 조직 · 비밀 걸러내기 · 넣기 전엔 아무것도 안 바뀜 · 빼기 기억 · 되돌리기.
 * 모델 · 임베딩은 `GUEST_AI_FAKE=1`(가짜 출력). 벡터 거리 SQL 은 로컬 DB 에서 따로 확인. docs/product/49 §9
 */
const state = vi.hoisted(() => ({
  session: null as null | {
    organization: { id: string };
    user: { id: string; preferredLanguage: "ko" | "ja" | "en" };
    capabilities: string[];
  },
  db: null as unknown,
  after: [] as Array<() => unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => state.after.push(fn) }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => state.session,
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => state.db }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static PermissionDeniedError = class extends APIError {};
    messages = {
      create: async () => {
        throw new Error("Claude must not be called in fake mode");
      },
    };
  }
  return { default: Anthropic };
});

import {
  addReplyCandidate,
  applyGuestInfoReplyCandidate,
  dismissReplyCandidate,
  getReplyCandidates,
  markGuestInfoCandidatesSaved,
  restoreReplyCandidate,
  runReplyCandidates,
  undoAddReplyCandidate,
  undoGuestInfoReplyCandidate,
} from "@/actions/guest-message-candidates";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(900);
const OTHER_ORG = uuid(901);
const USER = uuid(800);
const VIEW = "guest_messages.view";
const MANAGE = "guest_messages.manage";
const EDIT = "property_info.edit";
const ALL = [VIEW, MANAGE, EDIT];
/** 시험용 가짜 코드(실제 건물 번호 아님). */
const DOOR = "4827";
const WIFI_PASS = "wifi-pass-9911";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
let fake: ReturnType<typeof createFakeSupabase>;
let runSeq = 0;

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** SQL 함수와 같은 판정(조직 · 기간 · 거리) — 거리 계산만 JS 로. */
function near(args: Row, tables: Tables) {
  const centroid = JSON.parse(String(args.p_centroid)) as number[];
  return (tables.guest_reply_pairs ?? [])
    .filter((row) => row.organization_id === args.p_organization_id && row.reply_text !== null && row.embedding)
    .filter((row) => String(row.asked_at) >= String(args.p_since))
    .filter((row) => (args.p_property_name ? row.property_name === args.p_property_name : true))
    .filter((row) => 1 - cosine(JSON.parse(String(row.embedding)) as number[], centroid) <= Number(args.p_max_distance) + 1e-9)
    .sort((a, b) => (String(a.asked_at) < String(b.asked_at) ? 1 : -1));
}

const RPC = {
  guest_reply_candidate_run_start: (args: Row, tables: Tables) => {
    const runs = (tables.guest_reply_candidate_runs ??= []);
    if (runs.some((run) => run.organization_id === args.p_organization_id && run.status === "running")) {
      return { data: [{ outcome: "busy", run_id: null }], error: null };
    }
    const id = uuid(700 + ++runSeq);
    runs.push({
      id,
      organization_id: args.p_organization_id,
      status: "running",
      started_by: args.p_user_id,
      started_at: new Date(Date.now() + runSeq).toISOString(),
      finished_at: null,
      source_count: 0,
      source_since: null,
      error_key: null,
      skip_notes: [],
      cost_micro_usd: args.p_reserve_micro_usd,
    });
    return { data: [{ outcome: "started", run_id: id }], error: null };
  },
  guest_reply_cluster_stats: (args: Row, tables: Tables) => {
    const rows = near(args, tables);
    const ats = rows.map((row) => String(row.asked_at)).sort();
    return { data: [{ ask_count: rows.length, first_at: ats[0] ?? null, last_at: ats[ats.length - 1] ?? null }], error: null };
  },
  guest_reply_cluster_recent: (args: Row, tables: Tables) => ({
    data: near(args, tables)
      .slice(0, Number(args.p_limit ?? 12))
      .map((row) => ({
        pair_id: row.id,
        conversation_id: row.conversation_id,
        property_name: row.property_name,
        asked_at: row.asked_at,
        question_text: row.question_text,
        reply_text: row.reply_text,
      })),
    error: null,
  }),
};

const CONV = uuid(1);

function pairs(): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < 12; i += 1) {
    const day = String(i + 1).padStart(2, "0");
    // 묶음 A — 체크아웃 질문(깨끗한 답). 가장 최근 답에 손님 이름.
    out.push({
      id: uuid(100 + i),
      organization_id: ORG,
      conversation_id: CONV,
      property_name: "아라키초A",
      asked_at: `2026-10-${day}T03:00:00.000Z`,
      question_text: "What time is check-out?",
      reply_text: i === 11 ? "Hi Emma, check-out is by 11 AM. Thank you!" : "Check-out is by 11 AM. Thank you!",
      embedding: "[1,0,0]",
    });
    // 묶음 B — 체크인 · 문 코드(비밀). 후보가 되면 안 된다.
    out.push({
      id: uuid(200 + i),
      organization_id: ORG,
      conversation_id: CONV,
      property_name: "아라키초A",
      asked_at: `2026-10-${day}T05:00:00.000Z`,
      question_text: "How do we get in?",
      reply_text: `For check-in, the door code is ${DOOR}. Wi-Fi password is ${WIFI_PASS}.`,
      embedding: "[0,1,0]",
    });
  }
  // 다른 조직 — 섞이면 안 된다.
  for (let i = 0; i < 12; i += 1) {
    out.push({
      id: uuid(300 + i),
      organization_id: OTHER_ORG,
      conversation_id: uuid(2),
      property_name: "아라키초A",
      asked_at: `2026-10-${String(i + 1).padStart(2, "0")}T03:00:00.000Z`,
      question_text: "Parking?",
      reply_text: "Other org parking is at lot 7.",
      embedding: "[0,0,1]",
    });
  }
  return out;
}

function building(org: string): Row {
  return {
    organization_id: org,
    canonical_name: "아라키초A",
    address_ko: "",
    address_ja: "",
    address_en: "",
    note: "",
    updated_at: null,
    shared_access: [],
    room_access: [{ roomLabel: "101", code: DOOR }],
    guest_info: { wifiName: "Arakicho-A", wifiPassword: WIFI_PASS },
    guest_info_updated_at: "2026-11-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.stubEnv("GUEST_AI_FAKE", "1");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("GUEST_AI_MONTHLY_CAP_USD", "");
  state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "ko" }, capabilities: ALL };
  state.after = [];
  runSeq = 0;
  fake = createFakeSupabase(
    {
      guest_reply_pairs: pairs(),
      guest_conversations: [
        { id: CONV, organization_id: ORG, guest_name: "Emma" },
        { id: uuid(2), organization_id: OTHER_ORG, guest_name: "Other" },
      ],
      guest_reply_candidates: [],
      guest_reply_candidate_runs: [],
      guest_message_saved_replies: [],
      guest_saved_reply_embeddings: [],
      property_operation_infos: [building(ORG), building(OTHER_ORG)],
    },
    RPC,
  );
  // DB 기본값(마이그레이션 202611180005)과 uuid id — 가짜는 기본값을 모른다.
  let candidateSeq = 0;
  const from = fake.client.from;
  state.db = {
    ...fake.client,
    from(table: string) {
      const query = from(table);
      if (table !== "guest_reply_candidates") return query;
      const insert = query.insert;
      query.insert = (value: unknown) =>
        insert(
          (Array.isArray(value) ? value : [value]).map((row: Row) => ({
            id: uuid(5000 + ++candidateSeq),
            status: "pending",
            decided_at: null,
            decided_by: null,
            result_saved_reply_id: null,
            applied_previous: null,
            ...row,
          })),
        );
      return query;
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function runOnce() {
  const result = await runReplyCandidates();
  expect(result).toEqual({ ok: true });
  for (const fn of state.after.splice(0)) await fn();
}

function candidates(kind?: string): Row[] {
  return fake.tables.guest_reply_candidates.filter((row) => !kind || row.kind === kind);
}

describe("뽑기 — 비밀은 후보가 되지 않고, 넣기 전엔 아무것도 바뀌지 않는다", () => {
  it("문구 · 건물 칸 후보를 만들되 문 코드 · 와이파이 비밀번호 · 손님 이름은 어디에도 없다", async () => {
    await runOnce();
    const saved = candidates("saved_reply");
    const info = candidates("guest_info");
    expect(saved).toHaveLength(1); // 묶음 A 만 — 묶음 B(문 코드)는 걸러짐
    expect(info.map((row) => row.field)).toEqual(["checkOut"]); // checkIn(문 코드 문장)은 걸러짐
    expect(info[0].property_name).toBe("아라키초A");
    expect(info[0].ask_count).toBe(12);

    const everything = JSON.stringify(fake.tables.guest_reply_candidates);
    expect(everything).not.toContain(DOOR);
    expect(everything).not.toContain(WIFI_PASS);
    expect(everything).not.toContain("Emma");
    expect(everything).not.toContain("Other org");

    const run = fake.tables.guest_reply_candidate_runs[0];
    expect(run).toMatchObject({ status: "done", error_key: null, model: "fake" });
    const notes = run.skip_notes as Array<{ property: string; field: string; reason: string }>;
    expect(notes).toContainEqual(expect.objectContaining({ property: "아라키초A", field: "checkIn", reason: "few" }));
  });

  it("뽑기는 후보 표 · 실행 표에만 쓴다(정해 둔 문구 · 건물 안내는 그대로)", async () => {
    await runOnce();
    const touched = new Set(fake.writes.map((write) => write.table));
    expect([...touched].sort()).toEqual(["guest_reply_candidate_runs", "guest_reply_candidates"]);
    expect(fake.tables.guest_message_saved_replies).toHaveLength(0);
    expect((fake.tables.property_operation_infos[0].guest_info as Row).checkOut).toBeUndefined();
  });

  it("값이 섞이면 최신 값이 첫째, 근거에 날짜가 있다", async () => {
    await runOnce();
    const info = candidates("guest_info")[0];
    const options = info.options as Array<{ lastAt: string }>;
    expect(options[0].lastAt).toBe("2026-10-12T03:00:00.000Z");
    const evidence = info.evidence as Array<{ at: string; text: string }>;
    expect(evidence[0].at).toBe("2026-10-12T03:00:00.000Z");
    expect(evidence.length).toBeLessThanOrEqual(3);
  });

  it("조직마다 한 번에 하나 — 진행 중이면 busy", async () => {
    expect(await runReplyCandidates()).toEqual({ ok: true });
    expect(await runReplyCandidates()).toEqual({ ok: false, errorKey: "busy" });
  });

  it("키가 없으면 사용할 수 없음(모델 · 임베딩 부르지 않음)", async () => {
    vi.stubEnv("GUEST_AI_FAKE", "");
    vi.stubEnv("VOYAGE_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await runReplyCandidates()).toEqual({ ok: false, errorKey: "unavailable" });
    const overview = await getReplyCandidates();
    expect(overview.ok && overview.available).toBe(false);
    expect(fake.rpcCalls).toHaveLength(0);
  });
});

describe("빼기는 영영 — 다시 찾기에도 같은 묶음 · 같은 값은 안 뜬다", () => {
  it("뺀 문구 묶음 · 뺀 건물 값은 다음 실행에 다시 만들지 않는다", async () => {
    await runOnce();
    const saved = candidates("saved_reply")[0];
    const info = candidates("guest_info")[0];
    expect((await dismissReplyCandidate(String(saved.id), "saved_reply")).ok).toBe(true);
    expect((await dismissReplyCandidate(String(info.id), "guest_info")).ok).toBe(true);

    await runOnce();
    expect(candidates().filter((row) => row.status === "pending")).toHaveLength(0);
    expect(candidates().filter((row) => row.status === "dismissed")).toHaveLength(2);
  });

  it("뺀 것 되돌리기 → 다시 남은 후보", async () => {
    await runOnce();
    const saved = candidates("saved_reply")[0];
    await dismissReplyCandidate(String(saved.id), "saved_reply");
    const back = await restoreReplyCandidate(String(saved.id), "saved_reply");
    expect(back.ok && back.candidate.status).toBe("pending");
    expect(saved.decided_at).toBeNull();
  });
});

describe("추가 · 넣기 · 되돌리기", () => {
  it("문구 추가 → 사람이 고친 글로 정해 둔 문구 하나, 되돌리기 → 지워지고 후보로", async () => {
    await runOnce();
    const saved = candidates("saved_reply")[0];
    const added = await addReplyCandidate(String(saved.id), { title: "체크아웃 시간", bodies: { ko: "체크아웃은 11시예요.", ja: "", en: "" } });
    expect(added.ok && added.candidate.status).toBe("added");
    expect(fake.tables.guest_message_saved_replies).toHaveLength(1);
    expect(fake.tables.guest_message_saved_replies[0]).toMatchObject({ organization_id: ORG, title: "체크아웃 시간", created_by: USER });
    // 두 번 눌러도 하나만
    expect(await addReplyCandidate(String(saved.id), { title: "x", bodies: { ko: "y" } })).toEqual({ ok: false, errorKey: "not_found" });

    const undone = await undoAddReplyCandidate(String(saved.id));
    expect(undone.ok && undone.candidate.status).toBe("pending");
    expect(fake.tables.guest_message_saved_replies).toHaveLength(0);
  });

  it("빈 제목이면 추가하지 않고 후보도 그대로", async () => {
    await runOnce();
    const saved = candidates("saved_reply")[0];
    expect(await addReplyCandidate(String(saved.id), { title: "", bodies: { ko: "a" } })).toEqual({ ok: false, errorKey: "invalid" });
    expect(saved.status).toBe("pending");
  });

  it("건물 칸 넣기(모바일) → 그 칸만 저장, 되돌리기 → 이전 값, 그 사이 누가 고쳤으면 changed", async () => {
    await runOnce();
    const info = candidates("guest_info")[0];
    const value = { ko: "체크아웃은 11시", ja: "チェックアウトは11時", en: "Check-out by 11 AM" };
    const applied = await applyGuestInfoReplyCandidate(String(info.id), value);
    expect(applied.ok && applied.candidate.status).toBe("added");
    const row = fake.tables.property_operation_infos.find((item) => item.organization_id === ORG)!;
    expect((row.guest_info as Row).checkOut).toEqual(value);
    expect((row.guest_info as Row).wifiPassword).toBe(WIFI_PASS); // 다른 칸은 그대로
    const otherOrg = fake.tables.property_operation_infos.find((item) => item.organization_id === OTHER_ORG)!;
    expect((otherOrg.guest_info as Row).checkOut).toBeUndefined();

    const undone = await undoGuestInfoReplyCandidate(String(info.id));
    expect(undone.ok && undone.candidate.status).toBe("pending");
    expect(((row.guest_info as Row).checkOut as Row).ko).toBe("");

    await applyGuestInfoReplyCandidate(String(info.id), value);
    (row.guest_info as Row).checkOut = { ko: "직원이 바꿈", ja: "", en: "" };
    expect(await undoGuestInfoReplyCandidate(String(info.id))).toEqual({ ok: false, errorKey: "changed" });
  });

  it("PC 패널 — 저장된 칸이 채워진 후보만 추가함", async () => {
    await runOnce();
    const info = candidates("guest_info")[0];
    expect(await markGuestInfoCandidatesSaved("아라키초A", [info.id])).toEqual({ ok: true, marked: [] });
    const row = fake.tables.property_operation_infos.find((item) => item.organization_id === ORG)!;
    (row.guest_info as Row).checkOut = { ko: "11시", ja: "11時", en: "11 AM" };
    expect(await markGuestInfoCandidatesSaved("아라키초A", [info.id])).toEqual({ ok: true, marked: [info.id] });
    expect(info.status).toBe("added");
  });
});

describe("권한 · 조직 — 서버에서 판정", () => {
  it("로그인 없음 · 보기만 · 조직 없음 → forbidden", async () => {
    state.session = null;
    expect(await getReplyCandidates()).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "ko" }, capabilities: [VIEW] };
    expect(await getReplyCandidates()).toEqual({ ok: false, errorKey: "forbidden" });
    state.session = { organization: { id: "platform" }, user: { id: USER, preferredLanguage: "ko" }, capabilities: ALL };
    expect(await runReplyCandidates()).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("문구 관리만 → 문구 후보만 보이고, 건물 칸은 못 넣는다", async () => {
    await runOnce();
    state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "ko" }, capabilities: [VIEW, MANAGE] };
    const overview = await getReplyCandidates();
    expect(overview.ok && overview.pending.map((item) => item.kind)).toEqual(["saved_reply"]);
    expect(overview.ok && overview.canRun).toBe(true);
    const info = candidates("guest_info")[0];
    expect(await applyGuestInfoReplyCandidate(String(info.id), { ko: "a", ja: "a", en: "a" })).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await dismissReplyCandidate(String(info.id), "guest_info")).toEqual({ ok: false, errorKey: "forbidden" });
  });

  it("건물 고치기만 → 건물 후보만, 다시 찾기 · 문구 추가는 못 한다", async () => {
    await runOnce();
    state.session = { organization: { id: ORG }, user: { id: USER, preferredLanguage: "ko" }, capabilities: [VIEW, EDIT] };
    const overview = await getReplyCandidates();
    expect(overview.ok && overview.pending.map((item) => item.kind)).toEqual(["guest_info"]);
    expect(overview.ok && overview.canRun).toBe(false);
    expect(await runReplyCandidates()).toEqual({ ok: false, errorKey: "forbidden" });
    const saved = candidates("saved_reply")[0];
    expect(await addReplyCandidate(String(saved.id), { title: "t", bodies: { ko: "b" } })).toEqual({ ok: false, errorKey: "forbidden" });
    // 종류를 속여도 그 줄 종류로 다시 확인한다
    expect(await dismissReplyCandidate(String(saved.id), "guest_info")).toEqual({ ok: false, errorKey: "not_found" });
  });

  it("다른 조직 후보는 보이지도 · 고쳐지지도 않는다", async () => {
    await runOnce();
    const saved = candidates("saved_reply")[0];
    state.session = { organization: { id: OTHER_ORG }, user: { id: USER, preferredLanguage: "ko" }, capabilities: ALL };
    const overview = await getReplyCandidates();
    expect(overview.ok && overview.pending).toEqual([]);
    expect(await dismissReplyCandidate(String(saved.id), "saved_reply")).toEqual({ ok: false, errorKey: "not_found" });
    expect(await addReplyCandidate(String(saved.id), { title: "t", bodies: { ko: "b" } })).toEqual({ ok: false, errorKey: "not_found" });
    expect(saved.status).toBe("pending");
  });

  it("잘못된 id 는 DB 를 건드리지 않는다", async () => {
    expect(await dismissReplyCandidate("not-a-uuid", "saved_reply")).toEqual({ ok: false, errorKey: "invalid" });
    expect(await dismissReplyCandidate(uuid(1), "bogus" as never)).toEqual({ ok: false, errorKey: "forbidden" });
    expect(fake.writes).toHaveLength(0);
  });
});

describe("점검 고치기 — 실패해도 남은 후보 유지 · 비용 정산 · 덮어쓰기 막기", () => {
  it("다시 찾기가 실패하면 예전 남은 후보는 그대로, 이번 실행 후보는 남지 않는다", async () => {
    await runOnce();
    const before = candidates().map((row) => row.id).sort();
    expect(before.length).toBeGreaterThan(0);
    const original = RPC.guest_reply_cluster_recent;
    RPC.guest_reply_cluster_recent = () => ({ data: null, error: { code: "XX000" } }) as never;
    try {
      await runOnce();
    } finally {
      RPC.guest_reply_cluster_recent = original;
    }
    const second = fake.tables.guest_reply_candidate_runs[1];
    expect(second).toMatchObject({ status: "failed", error_key: "failed" });
    expect(candidates().map((row) => row.id).sort()).toEqual(before);
    expect(candidates().some((row) => row.run_id === second.id)).toBe(false);
  });

  it("성공하면 예전 남은 후보는 새 것으로 바뀐다(넣은 · 뺀 것은 그대로)", async () => {
    await runOnce();
    const first = fake.tables.guest_reply_candidate_runs[0];
    await runOnce();
    const second = fake.tables.guest_reply_candidate_runs[1];
    expect(candidates().filter((row) => row.status === "pending").every((row) => row.run_id === second.id)).toBe(true);
    expect(candidates().some((row) => row.run_id === first.id)).toBe(false);
  });

  it("15분 넘어 멈춤으로 닫힌 실행 — 끝날 때 실제 쓴 값을 그 줄에 정산하고, 그 실행 후보는 남기지 않는다", async () => {
    await runOnce();
    const before = candidates().map((row) => row.id).sort();
    expect(await runReplyCandidates()).toEqual({ ok: true });
    const run = fake.tables.guest_reply_candidate_runs[1];
    Object.assign(run, { status: "failed", error_key: "stale", cost_micro_usd: 0 });
    for (const fn of state.after.splice(0)) await fn();
    expect(run).toMatchObject({ status: "failed", error_key: "stale", model: "fake", cost_micro_usd: 0 });
    expect(candidates().map((row) => row.id).sort()).toEqual(before);
  });

  it("표본 읽기는 거꾸로 된 범위를 만들지 않는다(뜻 숫자가 깨진 줄이 섞여도)", async () => {
    const extra: Row[] = [];
    for (let i = 0; i < 2100; i += 1) {
      extra.push({
        id: uuid(20000 + i),
        organization_id: ORG,
        conversation_id: CONV,
        property_name: "아라키초A",
        asked_at: `2026-09-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`,
        question_text: "q",
        reply_text: "r",
        embedding: i % 2 === 0 ? "not-a-vector" : "[0,0,1]",
      });
    }
    fake.tables.guest_reply_pairs.push(...extra);
    const ranges: Array<[number, number]> = [];
    const db = state.db as { from: (table: string) => Record<string, (...args: unknown[]) => unknown> };
    const from = db.from;
    db.from = (table: string) => {
      const query = from(table);
      if (table === "guest_reply_pairs") {
        const range = query.range;
        query.range = (a: unknown, b: unknown) => {
          ranges.push([Number(a), Number(b)]);
          return range(a, b);
        };
      }
      return query;
    };
    await runOnce();
    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges.every(([a, b]) => a <= b)).toBe(true);
  });

  it("건물 칸 넣기 — 그 사이 누가 칸을 채웠으면 덮지 않고 conflict", async () => {
    await runOnce();
    const info = candidates("guest_info")[0];
    const row = fake.tables.property_operation_infos.find((item) => item.organization_id === ORG)!;
    (row.guest_info as Row).checkOut = { ko: "직원이 먼저 씀", ja: "", en: "" };
    expect(await applyGuestInfoReplyCandidate(String(info.id), { ko: "11시", ja: "11時", en: "11 AM" })).toEqual({ ok: false, errorKey: "conflict" });
    expect(((row.guest_info as Row).checkOut as Row).ko).toBe("직원이 먼저 씀");
    expect(info.status).toBe("pending");
  });

  it("문구 추가 되돌리기 — 그 사이 문구를 고쳤으면 지우지 않고 changed", async () => {
    await runOnce();
    const saved = candidates("saved_reply")[0];
    await addReplyCandidate(String(saved.id), { title: "체크아웃 시간", bodies: { ko: "체크아웃은 11시예요.", ja: "", en: "" } });
    const reply = fake.tables.guest_message_saved_replies[0];
    reply.updated_at = new Date(Date.parse(String(reply.created_at)) + 60_000).toISOString();
    expect(await undoAddReplyCandidate(String(saved.id))).toEqual({ ok: false, errorKey: "changed" });
    expect(fake.tables.guest_message_saved_replies).toHaveLength(1);
    expect(saved.status).toBe("added");
  });

  it("근거 글 — 과거 답에 비밀 문장이 섞여 있으면 그 문장은 […]", async () => {
    for (const row of fake.tables.guest_reply_pairs) {
      if (row.organization_id === ORG && String(row.question_text).startsWith("What time")) {
        row.reply_text = "Check-out is by 11 AM. Wi-Fi password: 1 2 3 4. Thank you!";
      }
    }
    await runOnce();
    const info = candidates("guest_info");
    expect(info.map((row) => row.field)).toContain("checkOut");
    const everything = JSON.stringify(fake.tables.guest_reply_candidates);
    expect(everything).not.toMatch(/password/i);
    expect(everything).not.toContain("1 2 3 4");
    expect(JSON.stringify(info.find((row) => row.field === "checkOut")!.evidence)).toContain("Check-out is by 11 AM.");
  });
});
