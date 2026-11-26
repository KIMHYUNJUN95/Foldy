import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCheckinDb, type FakeDb } from "./fake-checkin-db";

// jobs/retention — retain_until 이 지난 stay 의 파일을 먼저 지우고 줄을 지운다(43 §8-14 · 16 §3). 예약 찾기 시도는 48시간 뒤 지운다.
const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createCheckinServiceClient: () => state.db }));

import { GET, POST } from "@/app/api/jobs/retention/route";
import { runRetention } from "@/lib/retention/run";

const NOW = new Date("2026-11-26T19:00:00Z"); // 도쿄 11-27 04:00
const TODAY = "2026-11-27";

type FakeStorage = {
  files: Set<string>;
  removed: string[][];
  failRemove: (paths: string[]) => boolean;
  failList: boolean;
  keep: Set<string>;
  listCalls: { prefix: string; limit: number; offset: number }[];
};

function withStorage(db: FakeDb, files: string[]) {
  const storage: FakeStorage = { files: new Set(files), removed: [], failRemove: () => false, failList: false, keep: new Set(), listCalls: [] };
  const bucket = {
    async list(prefix: string, options: { limit?: number; offset?: number } = {}) {
      const limit = options.limit ?? 100;
      const offset = options.offset ?? 0;
      storage.listCalls.push({ prefix, limit, offset });
      if (storage.failList) return { data: null, error: { message: "list failed" } };
      const names = new Map<string, boolean>();
      for (const path of storage.files) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const rest = path.slice(prefix.length + 1);
        const [head, ...tail] = rest.split("/");
        names.set(head, tail.length > 0 || names.get(head) === true);
      }
      const entries = [...names].sort(([a], [b]) => a.localeCompare(b)).map(([name, folder]) => ({ name, id: folder ? null : `obj-${name}` }));
      return { data: entries.slice(offset, offset + limit), error: null };
    },
    async remove(paths: string[]) {
      if (storage.failRemove(paths)) return { data: null, error: { message: "remove failed" } };
      storage.removed.push(paths);
      for (const path of paths) if (!storage.keep.has(path)) storage.files.delete(path);
      return { data: [], error: null };
    },
  };
  Object.assign(db, { storage: { from: () => bucket } });
  return storage;
}

function seed() {
  return fakeCheckinDb({
    stays: [
      { id: "s-1", organization_id: "org-1", reservation_group_key: "HM-OLD", status: "checked_in", retain_until: "2026-11-26" },
      { id: "s-2", organization_id: "org-1", reservation_group_key: "HM-CANCEL", status: "cancelled", retain_until: "2026-10-01" },
      { id: "s-3", organization_id: "org-1", reservation_group_key: "HM-TODAY", status: "checked_in", retain_until: TODAY },
      { id: "s-4", organization_id: "org-1", reservation_group_key: "HM-NEW", status: "pending", retain_until: "2029-11-30" },
      { id: "s-5", organization_id: "org-1", reservation_group_key: "HM-NULL", status: "pending", retain_until: null },
    ],
    guests: [
      { id: "g-1", organization_id: "org-1", stay_id: "s-1" },
      { id: "g-2", organization_id: "org-1", stay_id: "s-1" },
      { id: "g-3", organization_id: "org-1", stay_id: "s-2" },
      { id: "g-4", organization_id: "org-1", stay_id: "s-3" },
    ],
    guest_documents: [
      { id: "d-1", organization_id: "org-1", guest_id: "g-1", kind: "passport", storage_path: "org-1/s-1/g-1/passport-a.jpg" },
      { id: "d-2", organization_id: "org-1", guest_id: "g-1", kind: "face_video", storage_path: "org-1/s-1/g-1/face-b.mp4" },
      { id: "d-3", organization_id: "org-1", guest_id: "g-3", kind: "passport", storage_path: "org-1/s-2/g-3/passport-c.jpg" },
      { id: "d-4", organization_id: "org-1", guest_id: "g-4", kind: "passport", storage_path: "org-1/s-3/g-4/passport-d.jpg" },
    ],
    audit_log: [
      { id: 1, organization_id: "org-1", stay_id: "s-1", action: "document_viewed" },
      { id: 2, organization_id: "org-1", stay_id: "s-4", action: "document_viewed" },
      { id: 3, organization_id: "org-1", stay_id: null, action: "device_revoked" },
    ],
    deletions: [],
    claim_attempts: [
      { id: 1, key_hash: "k", ip_hash: "i", succeeded: false, attempted_at: "2026-11-24T18:59:00.000Z" },
      { id: 2, key_hash: "k", ip_hash: "i", succeeded: false, attempted_at: "2026-11-24T19:01:00.000Z" },
      { id: 3, key_hash: "k", ip_hash: "i", succeeded: true, attempted_at: "2026-11-26T18:00:00.000Z" },
    ],
  });
}

const FILES = [
  "org-1/s-1/g-1/passport-a.jpg",
  "org-1/s-1/g-1/face-b.mp4",
  "org-1/s-1/g-9/passport-orphan.jpg", // 줄 없이 남은 파일(동행자를 뺀 뒤 파일 지우기가 실패한 경우)
  "org-1/s-2/g-3/passport-c.jpg",
  "org-1/s-3/g-4/passport-d.jpg",
  "org-1/s-4/g-5/passport-e.jpg",
];

let db: FakeDb;
let storage: FakeStorage;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db = seed();
  storage = withStorage(db, FILES);
  state.db = db;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const ids = (table: string) => (db.tables[table] ?? []).map((row) => row.id);

describe("만료 고르기", () => {
  it("도쿄 오늘보다 retain_until 이 앞선 stay 만 지운다(오늘 · 미래 · 빈 값은 남김)", async () => {
    const result = await runRetention(db as never, { now: NOW });
    expect(ids("stays")).toEqual(["s-3", "s-4", "s-5"]);
    expect(result.staysDeleted).toBe(2);
    expect(storage.files.has("org-1/s-3/g-4/passport-d.jpg")).toBe(true);
    expect(storage.files.has("org-1/s-4/g-5/passport-e.jpg")).toBe(true);
  });

  it("지운 stay 의 파일은 줄이 없는 것까지 모두 지우고, 감사 기록은 그 stay 것만 지운다", async () => {
    await runRetention(db as never, { now: NOW });
    expect([...storage.files].sort()).toEqual(["org-1/s-3/g-4/passport-d.jpg", "org-1/s-4/g-5/passport-e.jpg"]);
    expect(ids("audit_log")).toEqual([2, 3]);
  });

  it("deletions 에 예약 번호 · 건수만 남긴다(개인 정보 없음)", async () => {
    await runRetention(db as never, { now: NOW });
    const rows = db.tables.deletions;
    expect(rows.map((row) => row.stay_key).sort()).toEqual(["HM-CANCEL", "HM-OLD"]);
    const old = rows.find((row) => row.stay_key === "HM-OLD")!;
    expect(old).toMatchObject({ organization_id: "org-1", counts: { guests: 2, documents: 2, files: 3, audit_log: 1, status: "checked_in" } });
    expect(Object.keys(old).sort()).toEqual(["counts", "organization_id", "stay_key"]);
  });

  it("두 번 돌려도 같은 결과(다시 돌리기 안전)", async () => {
    await runRetention(db as never, { now: NOW });
    const again = await runRetention(db as never, { now: NOW });
    expect(again.staysDeleted).toBe(0);
    expect(db.tables.deletions).toHaveLength(2);
  });
});

describe("파일 먼저", () => {
  it("파일을 지운 뒤에야 줄을 지운다", async () => {
    const order: string[] = [];
    const bucket = (db as unknown as { storage: { from: () => { remove: (paths: string[]) => Promise<unknown> } } }).storage.from();
    const remove = bucket.remove;
    bucket.remove = async (paths) => {
      order.push(`files:${paths[0].split("/")[1]}`);
      return remove(paths);
    };
    const from = db.from;
    Object.assign(db, {
      from: (table: string) => {
        const builder = from(table);
        if (table !== "stays") return builder;
        const del = builder.delete;
        builder.delete = () => {
          order.push("row");
          return del();
        };
        return builder;
      },
    });
    await runRetention(db as never, { now: NOW });
    expect(order).toEqual(["files:s-1", "row", "files:s-2", "row"]);
  });

  it("파일 지우기가 실패하면 그 stay 줄은 남기고 다음 stay 는 계속, 다음 실행에서 지운다", async () => {
    storage.failRemove = (paths) => paths.some((path) => path.startsWith("org-1/s-1/"));
    const first = await runRetention(db as never, { now: NOW });
    expect(first.staysDeleted).toBe(1);
    expect(first.staysFailed).toBe(1);
    expect(ids("stays")).toContain("s-1");
    expect(ids("guests")).toContain("g-1");
    expect(ids("audit_log")).toContain(1);
    expect(db.tables.deletions.map((row) => row.stay_key)).toEqual(["HM-CANCEL"]);

    storage.failRemove = () => false;
    const second = await runRetention(db as never, { now: NOW });
    expect(second.staysDeleted).toBe(1);
    expect(ids("stays")).not.toContain("s-1");
  });

  it("파일 목록 읽기가 실패해도 줄을 지우지 않는다", async () => {
    storage.failList = true;
    const result = await runRetention(db as never, { now: NOW });
    expect(result.staysDeleted).toBe(0);
    expect(result.staysFailed).toBe(2);
    expect(ids("stays")).toHaveLength(5);
  });
});

describe("고른 뒤 바뀐 stay · 남은 파일", () => {
  it("고른 뒤 sync-stays 가 기간을 늘리면 파일 · 감사 기록 · 줄을 모두 남긴다", async () => {
    const from = db.from;
    let first = true;
    Object.assign(db, {
      from: (table: string) => {
        const builder = from(table);
        if (table !== "stays" || !first) return builder;
        first = false;
        const then = builder.then;
        builder.then = (resolve) =>
          then((value) => {
            db.tables.stays.find((row) => row.id === "s-1")!.retain_until = "2029-12-01";
            return resolve(value);
          });
        return builder;
      },
    });
    const result = await runRetention(db as never, { now: NOW });
    expect(ids("stays")).toContain("s-1");
    expect(ids("guests")).toEqual(expect.arrayContaining(["g-1", "g-2"]));
    expect(ids("audit_log")).toContain(1);
    expect(storage.files.has("org-1/s-1/g-1/passport-a.jpg")).toBe(true);
    expect(storage.files.has("org-1/s-1/g-9/passport-orphan.jpg")).toBe(true);
    expect(result).toMatchObject({ staysDeleted: 1, staysFailed: 0 });
    expect(db.tables.deletions.map((row) => row.stay_key)).toEqual(["HM-CANCEL"]);
  });

  it("폴더 목록을 페이지로 끝까지 읽는다(한 페이지보다 많은 파일)", async () => {
    for (let i = 0; i < 5; i++) storage.files.add(`org-1/s-1/g-2/passport-${i}.jpg`);
    await runRetention(db as never, { now: NOW, listPageSize: 2 });
    expect([...storage.files].filter((path) => path.startsWith("org-1/s-1/"))).toEqual([]);
    expect(ids("stays")).not.toContain("s-1");
    expect(storage.listCalls.some((call) => call.prefix === "org-1/s-1/g-2" && call.offset === 4)).toBe(true);
  });

  it("지운 뒤 다시 봐서 파일이 남아 있으면 줄을 남기고 다음 실행에서 지운다", async () => {
    storage.keep.add("org-1/s-1/g-9/passport-orphan.jpg");
    const first = await runRetention(db as never, { now: NOW });
    expect(first).toMatchObject({ staysDeleted: 1, staysFailed: 1 });
    expect(ids("stays")).toContain("s-1");
    expect(ids("audit_log")).toContain(1);

    storage.keep.clear();
    const second = await runRetention(db as never, { now: NOW });
    expect(second.staysDeleted).toBe(1);
    expect(ids("stays")).not.toContain("s-1");
  });
});

describe("한 번에 하는 양", () => {
  it("maxStays 를 넘기지 않고, 남은 것은 다음 실행으로", async () => {
    const result = await runRetention(db as never, { now: NOW, batchSize: 1, maxStays: 1 });
    expect(result.staysDeleted).toBe(1);
    expect(result.done).toBe(false);
    expect(ids("stays")).toHaveLength(4);
    const rest = await runRetention(db as never, { now: NOW, batchSize: 1 });
    expect(rest.staysDeleted).toBe(1);
    expect(rest.done).toBe(true);
  });

  it("시간 예산을 다 쓰면 멈춘다", async () => {
    const result = await runRetention(db as never, { now: NOW, budgetMs: 0 });
    expect(result.staysDeleted).toBe(0);
    expect(result.done).toBe(false);
    expect(ids("stays")).toHaveLength(5);
  });
});

describe("예약 찾기 시도", () => {
  it("stay 정리가 예산을 다 써도 끝 5초는 claim_attempts 정리에 남긴다", async () => {
    const result = await runRetention(db as never, { now: NOW, budgetMs: 5_000 });
    expect(result.staysDeleted).toBe(0);
    expect(ids("stays")).toHaveLength(5);
    expect(result.claimAttemptsDeleted).toBe(1);
  });

  it("가장 긴 잠금 창(24시간) + 여유 24시간 = 48시간보다 오래된 줄만 지운다", async () => {
    const result = await runRetention(db as never, { now: NOW });
    expect(ids("claim_attempts")).toEqual([2, 3]);
    expect(result.claimAttemptsDeleted).toBe(1);
  });
});

describe("라우트 인증", () => {
  const call = (handler: typeof GET, authorization?: string) =>
    handler(new Request("https://x/api/jobs/retention", { headers: authorization ? { authorization } : {} }));

  it("CRON_SECRET 이 없으면 아무도 못 부른다", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(GET, "Bearer ")).status).toBe(401);
    expect(ids("stays")).toHaveLength(5);
  });

  it("비밀값이 틀리거나 없으면 401, 맞으면 200 + 건수만", async () => {
    vi.stubEnv("CRON_SECRET", "cron-test");
    expect((await call(GET)).status).toBe(401);
    expect((await call(POST, "Bearer wrong")).status).toBe(401);
    expect(ids("stays")).toHaveLength(5);
    const ok = await call(POST, "Bearer cron-test");
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ ok: true, result: { staysDeleted: 2, claimAttemptsDeleted: 1 } });
    expect(JSON.stringify(body)).not.toContain("HM-");
  });
});
