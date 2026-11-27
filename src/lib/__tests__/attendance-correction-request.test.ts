import { beforeEach, describe, expect, it, vi } from "vitest";

// 직원 정정 요청(2026-11-11) — 마감 · 급여 결재가 시작된 달은 받지 않는다(H1), 퇴근은 출근보다 뒤 · 16시간 이하(M2).

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const failing = new Set<string>();

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: ((row: Row) => boolean)[] = [];
  private from = 0;
  private to: number | null = null;
  private single = false;
  constructor(private readonly table: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: null) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  gte(c: string, v: string) {
    this.filters.push((r) => r[c] != null && String(r[c]) >= v);
    return this;
  }
  lte(c: string, v: string) {
    this.filters.push((r) => r[c] != null && String(r[c]) <= v);
    return this;
  }
  order() {
    return this;
  }
  range(f: number, t: number) {
    this.from = f;
    this.to = t;
    return this;
  }
  limit(n: number) {
    this.to = this.from + n - 1;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  private run() {
    if (failing.has(this.table)) return { data: null, error: { message: `${this.table} read failed` } };
    let rows = (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    rows = rows.slice(this.from, this.to == null ? undefined : this.to + 1);
    if (this.single) return { data: rows[0] ?? null, error: null };
    return { data: rows.map((r) => ({ ...r })), error: null };
  }
  then<T1, T2>(
    ok?: (v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>,
    bad?: (e: unknown) => T2 | PromiseLike<T2>,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

const inserted: Row[] = [];
const storageOwners: { rows: Array<{ name: string; owner_id: string | null }>; fails: boolean } = { rows: [], fails: false };
const insertingClient = {
  async rpc(fn: string, args: { p_names: string[] }) {
    if (fn !== "request_image_owners" || storageOwners.fails) return { data: null, error: { message: "rpc failed" } };
    return { data: storageOwners.rows.filter((r) => args.p_names.includes(r.name)), error: null };
  },
  from(t: string) {
    const q = new FakeQuery(t) as FakeQuery & { insert?: (row: Row) => unknown };
    (q as unknown as { insert: (row: Row) => unknown }).insert = (row: Row) => {
      inserted.push(row);
      return { select: () => ({ single: async () => ({ data: { id: "req-1" }, error: null }) }) };
    };
    return q;
  },
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => insertingClient }));
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({ user: { id: "u-a", name: "가나" }, organization: { id: "org-1" } }),
  hasOrganizationContext: () => true,
}));
vi.mock("@/lib/notifications/create", () => ({ notifyAttendanceAdmins: async () => undefined }));
vi.mock("@/lib/attendance-review", () => ({ getMemberIdsWithCapability: async () => [] }));
vi.mock("@/lib/attendance-trusted-device", () => ({ rememberTrustedDevice: async () => undefined, resolveTrustedDevice: async () => null }));

import { createAttendanceCorrectionRequest } from "@/app/mobile/attendance/actions";
import { tokyoToday } from "@/lib/tokyo-date";

const today = tokyoToday();
const ym = today.slice(0, 7);

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  failing.clear();
  inserted.length = 0;
  storageOwners.rows = [];
  storageOwners.fails = false;
  tables.attendance_sessions = [
    {
      id: "s1",
      organization_id: "org-1",
      user_id: "u-a",
      operating_date: `${ym}-01`,
      clock_in_at: new Date(`${ym}-01T09:00:00+09:00`).toISOString(),
      clock_out_at: new Date(`${ym}-01T18:00:00+09:00`).toISOString(),
    },
  ];
  tables.attendance_month_snapshots = [];
  tables.payroll_month_approvals = [];
  tables.attendance_correction_requests = [];
  tables.attendance_sites = [];
}
beforeEach(seed);

const base = {
  sessionId: "s1",
  reasonType: "wrong_time" as const,
  memo: null,
  desiredInTime: "09:00",
  desiredOutTime: "17:00",
  desiredSiteId: null,
  imageUrls: [],
};

describe("정정 요청 — 잠긴 달은 받지 않는다 (H1)", () => {
  it("평소엔 받는다", async () => {
    await expect(createAttendanceCorrectionRequest(base)).resolves.toEqual({ ok: true, id: "req-1" });
  });

  it("그 달이 근태 마감됐으면 month_locked", async () => {
    tables.attendance_month_snapshots.push({ organization_id: "org-1", user_id: "u-a", target_month: `${ym}-01`, status: "finalized" });
    await expect(createAttendanceCorrectionRequest(base)).resolves.toEqual({ ok: false, reason: "month_locked" });
    expect(inserted).toHaveLength(0);
  });

  it("그 달 급여 결재가 시작됐으면 month_locked", async () => {
    tables.payroll_month_approvals.push({ organization_id: "org-1", target_month: `${ym}-01`, status: "approval_president" });
    await expect(createAttendanceCorrectionRequest(base)).resolves.toEqual({ ok: false, reason: "month_locked" });
  });

  it("마감 여부를 못 읽으면 받지 않는다(error)", async () => {
    failing.add("attendance_month_snapshots");
    await expect(createAttendanceCorrectionRequest(base)).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("급여 결재 상태를 못 읽어도 받지 않는다(error, fail-closed)", async () => {
    failing.add("payroll_month_approvals");
    await expect(createAttendanceCorrectionRequest(base)).resolves.toEqual({ ok: false, reason: "error" });
    expect(inserted).toHaveLength(0);
  });
});

describe("정정 요청 — 시각 (M2)", () => {
  it("퇴근이 출근보다 앞서면 다음 날로 넘기지 않고 거절", async () => {
    await expect(
      createAttendanceCorrectionRequest({ ...base, desiredInTime: "09:00", desiredOutTime: "08:30" }),
    ).resolves.toEqual({ ok: false, reason: "clock_order" });
  });

  it("퇴근만 고쳐도 세션의 실제 출근과 비교한다", async () => {
    await expect(
      createAttendanceCorrectionRequest({ ...base, desiredInTime: null, desiredOutTime: "08:00" }),
    ).resolves.toEqual({ ok: false, reason: "clock_order" });
  });

  it("같은 날 안의 퇴근은 그대로 저장한다", async () => {
    await createAttendanceCorrectionRequest({ ...base, desiredInTime: null, desiredOutTime: "23:30" });
    expect(inserted[0]?.desired_clock_out_at).toBe(new Date(`${ym}-01T23:30:00+09:00`).toISOString());
  });
});

describe("정정 요청 사진 — 내가 올린 파일만 붙인다 (2026-11-27)", () => {
  const BASE = "https://proj.supabase.co";
  const ORG = "org-1";
  const path = `${ORG}/attendance-corrections/f1/a.jpg`;
  const url = `${BASE}/storage/v1/object/public/request-images/${path}`;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });

  it("내가 올린 사진이면 받는다", async () => {
    storageOwners.rows = [{ name: path, owner_id: "u-a" }];
    await expect(createAttendanceCorrectionRequest({ ...base, imageUrls: [url] })).resolves.toEqual({ ok: true, id: "req-1" });
  });

  it("남이 올린 사진 주소면 invalid", async () => {
    storageOwners.rows = [{ name: path, owner_id: "u-b" }];
    await expect(createAttendanceCorrectionRequest({ ...base, imageUrls: [url] })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(inserted).toEqual([]);
  });

  it("없는 파일이면 invalid", async () => {
    await expect(createAttendanceCorrectionRequest({ ...base, imageUrls: [url] })).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("주인 확인을 못 읽으면 error", async () => {
    storageOwners.fails = true;
    await expect(createAttendanceCorrectionRequest({ ...base, imageUrls: [url] })).resolves.toEqual({ ok: false, reason: "error" });
  });
});

