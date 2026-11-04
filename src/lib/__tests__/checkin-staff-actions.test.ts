import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateCapability } from "@/config/capabilities";
import { createFakeSupabase } from "@/lib/__tests__/fake-supabase";

/**
 * 셀프 체크인 직원 서버 액션 — 서버 액션을 그대로 돌리되 세션 · DB · 저장소는 가짜다. 실제 RLS 확인은 마이그레이션 적용 뒤 따로.
 * docs/engineering/16 §4-1 · AC-07 · AC-08.
 */
const state = vi.hoisted(() => ({
  session: null as null | { organization: { id: string }; user: { id: string }; capabilities: string[] },
  checkin: null as unknown,
  publicDb: null as unknown,
  signed: [] as { path: string; seconds: number }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: (session: { organization: { id: string } }) => session.organization.id !== "platform",
}));
vi.mock("@/lib/admin-session", () => ({
  getAdminSessionForApi: vi.fn(async () => (state.session ? { ok: true, session: state.session } : { ok: false, status: 401 })),
}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    schema: () => state.checkin,
    from: (table: string) => (state.publicDb as { from: (t: string) => unknown }).from(table),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, seconds: number) => {
          state.signed.push({ path, seconds });
          return { data: { signedUrl: `https://signed.example/${seconds}` }, error: null };
        },
      }),
    },
  }),
}));

import {
  invalidateCheckinEnrollmentCode,
  issueCheckinEnrollmentCode,
  listCheckinDevices,
  renameCheckinDevice,
  revokeCheckinDevice,
} from "@/actions/checkin/devices";
import { getCheckinPropertySettings, saveCheckinPropertySettings } from "@/actions/checkin/settings";
import {
  getCheckinArrivals,
  getCheckinStayDetail,
  markCheckinStayVerified,
  openCheckinDocument,
  revealCheckinCode,
} from "@/actions/checkin/stays";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uuid(900);
const OTHER_ORG = uuid(901);
const USER = uuid(800);
const STAY = uuid(1);
const OTHER_STAY = uuid(2);
const GUEST = uuid(11);
const DOC = uuid(21);
const OLD_DOC = uuid(22);
const OTHER_DOC = uuid(23);
const DEVICE = uuid(31);
const OTHER_DEVICE = uuid(32);
const CODE = "573914";
const PATH = "org/stay/passport-secret-path.jpg";
const PASSPORT = "18AB1234542";
const MRZ = "P<FRAMOREAU<<LUCAS<<<<<";

const ALL = ["checkin.view", "checkin.documents", "checkin.manage"];

function stay(over: Record<string, unknown> = {}) {
  return {
    id: STAY,
    organization_id: ORG,
    status: "pending",
    reservation_group_key: "HM4K2X9PQ",
    property_key: "arakicho_a",
    check_in_date: "2026-11-04",
    check_out_date: "2026-11-06",
    guest_count_expected: 1,
    party_size: null,
    checkin_code: CODE,
    checked_in_at: null,
    verified_at: null,
    verified_by: null,
    ...over,
  };
}

const fullGuest = {
  id: GUEST,
  organization_id: ORG,
  stay_id: STAY,
  stay_room_id: uuid(41),
  is_representative: true,
  guest_type: "adult",
  name_roman: "MOREAU LUCAS",
  nationality: "FRA",
  has_japan_address: false,
  address: "12 Rue Oberkampf",
  contact: "+33-1-0000",
  age: 34,
  gender: "male",
  passport_number: PASSPORT,
  prev_stay: "Paris",
  next_dest: "Osaka",
  source: "mrz",
  mrz_raw: MRZ,
  mrz_valid: true,
  no_passport_reason: null,
};

function seed(over: { stays?: Record<string, unknown>[] } = {}) {
  state.checkin = createFakeSupabase({
    stays: over.stays ?? [stay(), stay({ id: OTHER_STAY, organization_id: OTHER_ORG, reservation_group_key: "OTHER" })],
    stay_rooms: [
      { id: uuid(41), organization_id: ORG, stay_id: STAY, reservation_id: uuid(51), room_label: "201" },
      { id: uuid(42), organization_id: OTHER_ORG, stay_id: OTHER_STAY, reservation_id: uuid(52), room_label: "999" },
    ],
    guests: [fullGuest, { ...fullGuest, id: uuid(12), organization_id: OTHER_ORG, stay_id: OTHER_STAY, name_roman: "OTHER ORG GUEST" }],
    guest_documents: [
      { id: DOC, organization_id: ORG, guest_id: GUEST, kind: "passport", storage_path: PATH, replaced_by: null, captured_at: "t", captured_on: "kiosk" },
      { id: uuid(24), organization_id: ORG, guest_id: GUEST, kind: "face_video", storage_path: "video-path.mp4", replaced_by: null, captured_at: "t", captured_on: "kiosk" },
      { id: OLD_DOC, organization_id: ORG, guest_id: GUEST, kind: "passport", storage_path: "old.jpg", replaced_by: DOC, captured_at: "t", captured_on: "kiosk" },
      { id: OTHER_DOC, organization_id: OTHER_ORG, guest_id: uuid(12), kind: "passport", storage_path: "other.jpg", replaced_by: null, captured_at: "t", captured_on: "kiosk" },
    ],
    consents: [{ id: uuid(61), organization_id: ORG, stay_id: STAY, guest_id: GUEST, terms_version: 1, agreed_at: "t", locale: "fr", device_id: uuid(31) }],
    sessions: [],
    audit_log: [],
    enrollment_codes: [],
    property_settings: [],
    devices: [
      { id: DEVICE, organization_id: ORG, property_key: "arakicho_a", name: "로비", token_hash: "hash-secret", registered_at: "t", last_seen_at: null, revoked_at: null },
      { id: OTHER_DEVICE, organization_id: OTHER_ORG, property_key: "arakicho_a", name: "남", token_hash: "other-hash", registered_at: "t", last_seen_at: null, revoked_at: null },
    ],
  }).client;
  state.publicDb = createFakeSupabase({
    reservations: [
      { id: uuid(51), organization_id: ORG, guest_name: "Lucas Moreau", source: "airbnb" },
      { id: uuid(52), organization_id: OTHER_ORG, guest_name: "Other", source: "booking" },
    ],
    profiles: [{ id: USER, name: "담당자" }],
  }).client;
}

async function auditRows() {
  const db = state.checkin as { from: (table: string) => PromiseLike<{ data: Record<string, unknown>[] }> & { select: () => PromiseLike<{ data: Record<string, unknown>[] }> } };
  return (await db.from("audit_log").select()).data;
}

function signIn(capabilities: string[], organizationId = ORG) {
  state.session = { organization: { id: organizationId }, user: { id: USER }, capabilities };
}

beforeEach(() => {
  state.signed = [];
  seed();
  signIn(ALL);
});

afterEach(() => vi.useRealTimers());

const settingsInput = {
  propertyKey: "arakicho_a",
  expectedUpdatedAt: null as string | null,
  languages: ["ja", "en"],
  welcomeText: { ja: "ようこそ" },
  termsText: { ko: "약관 1" },
  requiredFields: [],
  videoSecondsPerGuest: 5,
  supportContacts: { phone: "+81-3-0000-0000" },
  idleSecondsInput: 240,
  idleSecondsDone: 30,
  verificationMethod: "video",
  mrzAutofill: true,
};

describe("권한", () => {
  const calls: [string, () => Promise<{ ok: boolean; errorKey?: string }>][] = [
    ["도착 목록", () => getCheckinArrivals()],
    ["상세", () => getCheckinStayDetail(STAY)],
    ["파일 열기", () => openCheckinDocument(DOC)],
    ["확인함", () => markCheckinStayVerified(STAY)],
    ["코드 보기", () => revealCheckinCode(STAY)],
    ["등록 코드", () => issueCheckinEnrollmentCode({ propertyKey: "arakicho_a", deviceName: "새 기기" })],
    ["등록 코드 무효화", () => invalidateCheckinEnrollmentCode("11111111")],
    ["기기 목록", () => listCheckinDevices()],
    ["기기 이름", () => renameCheckinDevice({ deviceId: DEVICE, name: "새 이름" })],
    ["기기 폐기", () => revokeCheckinDevice(DEVICE)],
    ["설정 읽기", () => getCheckinPropertySettings("arakicho_a")],
    ["설정 저장", () => saveCheckinPropertySettings(settingsInput)],
  ];

  it.each(calls)("권한 없는 사무실 직원은 %s 이 forbidden 이다", async (_name, call) => {
    signIn(["admin_web.access"]);
    expect(await call()).toEqual({ ok: false, errorKey: "forbidden" });
    expect(await auditRows()).toEqual([]);
    expect(state.signed).toEqual([]);
  });

  it.each(calls)("로그인 안 됨 · 플랫폼 세션도 %s 을 못 부른다", async (_name, call) => {
    state.session = null;
    expect((await call()).errorKey).toBe("forbidden");
    signIn(ALL, "platform");
    expect((await call()).errorKey).toBe("forbidden");
  });

  it("키가 나뉘어 있다 — view 만으로 파일 · 확인함 · 기기를 못 쓴다", async () => {
    signIn(["checkin.view"]);
    expect((await getCheckinArrivals()).ok).toBe(true);
    expect((await revealCheckinCode(STAY)).ok).toBe(true);
    expect((await openCheckinDocument(DOC)).ok).toBe(false);
    expect((await markCheckinStayVerified(STAY)).ok).toBe(false);
    expect((await listCheckinDevices()).ok).toBe(false);
  });

  it("기본은 대표 · 전무 · 개발자, 사무실 직원은 개인 부여 뒤에만(AC-08)", () => {
    for (const capability of ["checkin.view", "checkin.documents", "checkin.manage"] as const) {
      for (const role of ["owner", "senior_managing_director", "developer_super_admin"] as const) {
        expect(evaluateCapability({ capability, role, granted: false, denied: false })).toBe(true);
      }
      for (const role of ["office_admin", "cs_staff", "field_manager", "staff", "part_time_staff"] as const) {
        expect(evaluateCapability({ capability, role, granted: false, denied: false })).toBe(false);
        expect(evaluateCapability({ capability, role, granted: true, denied: false })).toBe(true);
      }
    }
  });
});

describe("다른 조직", () => {
  it("다른 조직 예약은 읽기 · 코드 · 확인함 모두 not_found 이고 기록도 없다", async () => {
    expect(await getCheckinStayDetail(OTHER_STAY)).toEqual({ ok: false, errorKey: "not_found" });
    expect(await revealCheckinCode(OTHER_STAY)).toEqual({ ok: false, errorKey: "not_found" });
    expect(await markCheckinStayVerified(OTHER_STAY)).toEqual({ ok: false, errorKey: "not_found" });
    expect(await auditRows()).toEqual([]);
  });

  it("도착 목록에 다른 조직 줄 · 이름이 섞이지 않는다", async () => {
    const result = await getCheckinArrivals({ date: "2026-11-04" });
    expect(result.ok && result.rows.map((row) => row.stayId)).toEqual([STAY]);
    expect(JSON.stringify(result)).not.toContain("OTHER");
  });

  it("다른 조직 파일 · 기기는 못 건드린다", async () => {
    expect(await openCheckinDocument(OTHER_DOC)).toEqual({ ok: false, errorKey: "not_found" });
    expect(state.signed).toEqual([]);
    expect(await renameCheckinDevice({ deviceId: OTHER_DEVICE, name: "뺏기" })).toEqual({ ok: false, errorKey: "not_found" });
    expect(await revokeCheckinDevice(OTHER_DEVICE)).toEqual({ ok: false, errorKey: "not_found" });
    const devices = await listCheckinDevices();
    expect(devices.ok && devices.devices.map((device) => device.id)).toEqual([DEVICE]);
  });
});

describe("파일 줄 숨김 · 열람 기록", () => {
  it("checkin.documents 가 없으면 파일 줄 자체가 없다", async () => {
    signIn(["checkin.view"]);
    const result = await getCheckinStayDetail(STAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canViewDocuments).toBe(false);
    expect(result.canVerify).toBe(false);
    expect(result.detail.guests[0]).not.toHaveProperty("documents");
    expect(JSON.stringify(result)).not.toContain(DOC);
  });

  it("있으면 지금 파일 줄만 주고 저장 경로 · 원문은 어느 쪽에도 없다", async () => {
    const result = await getCheckinStayDetail(STAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const documents = result.detail.guests[0].documents ?? [];
    expect(documents.map((doc) => doc.id).sort()).toEqual([DOC, uuid(24)].sort());
    const text = JSON.stringify(result);
    for (const secret of [PATH, "storage_path", OLD_DOC, PASSPORT, MRZ, CODE]) expect(text).not.toContain(secret);
    expect(result.detail.guests[0].passportNumberMasked).toBe("18AB•••••42");
    expect(result.detail.consents[0]).toMatchObject({ agreedAt: "t", locale: "fr", via: "tablet" });
  });

  it("열 때마다 기록 한 줄, 서명 URL 은 1~5분(AC-07)", async () => {
    const opened = await openCheckinDocument(DOC);
    expect(opened.ok).toBe(true);
    await openCheckinDocument(DOC);
    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: "document_viewed", organization_id: ORG, actor_user_id: USER, stay_id: STAY, guest_id: GUEST, document_id: DOC });
    expect(JSON.stringify(rows)).not.toContain(PATH);
    expect(state.signed[0].path).toBe(PATH);
    expect(state.signed[0].seconds).toBeGreaterThanOrEqual(60);
    expect(state.signed[0].seconds).toBeLessThanOrEqual(300);
  });

  it("교체된 옛 파일은 열리지 않는다", async () => {
    expect(await openCheckinDocument(OLD_DOC)).toEqual({ ok: false, errorKey: "not_found" });
  });

  it("기록을 못 남기면 주소도 주지 않는다", async () => {
    const db = state.checkin as { from: (table: string) => unknown };
    state.checkin = {
      from: (table: string) => (table === "audit_log" ? { insert: async () => ({ error: { code: "XX000" } }) } : db.from(table)),
    };
    expect(await openCheckinDocument(DOC)).toEqual({ ok: false, errorKey: "failed" });
    expect(state.signed).toEqual([]);
  });
});

describe("체크인 코드 보기", () => {
  it("코드를 돌려주고 기록 한 줄, 기록에 코드 값은 없다", async () => {
    signIn(["checkin.view"]);
    expect(await revealCheckinCode(STAY)).toEqual({ ok: true, code: CODE });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "checkin_code_revealed", organization_id: ORG, actor_user_id: USER, stay_id: STAY });
    expect(JSON.stringify(rows)).not.toContain(CODE);
  });

  it("볼 때마다 한 줄씩 는다", async () => {
    await revealCheckinCode(STAY);
    await revealCheckinCode(STAY);
    expect(await auditRows()).toHaveLength(2);
  });

  it.each(["checked_in", "cancelled", "expired"])("%s 는 코드를 주지 않고 사유를 돌려준다", async (status) => {
    seed({ stays: [stay({ status })] });
    const result = await revealCheckinCode(STAY);
    expect(result).toEqual({ ok: false, errorKey: status });
    expect(JSON.stringify(result)).not.toContain(CODE);
    expect(await auditRows()).toEqual([]);
  });

  it.each(["pending", "pre_registered", "in_progress"])("%s 는 볼 수 있다", async (status) => {
    seed({ stays: [stay({ status })] });
    expect((await revealCheckinCode(STAY)).ok).toBe(true);
  });

  it("코드가 없는 줄은 no_code", async () => {
    seed({ stays: [stay({ checkin_code: null })] });
    expect(await revealCheckinCode(STAY)).toEqual({ ok: false, errorKey: "no_code" });
    expect(await auditRows()).toEqual([]);
  });

  it("기록을 못 남기면 코드도 주지 않는다", async () => {
    const db = state.checkin as { from: (table: string) => unknown };
    state.checkin = {
      from: (table: string) => (table === "audit_log" ? { insert: async () => ({ error: { code: "XX000" } }) } : db.from(table)),
    };
    expect(await revealCheckinCode(STAY)).toEqual({ ok: false, errorKey: "failed" });
  });

  it("목록 · 상세 결과에는 코드가 없다", async () => {
    expect(JSON.stringify(await getCheckinArrivals({ date: "2026-11-04" }))).not.toContain(CODE);
    expect(JSON.stringify(await getCheckinStayDetail(STAY))).not.toContain(CODE);
  });
});

describe("확인함", () => {
  it("체크인 끝난 건만 — 누가 언제 남기고 기록 한 줄", async () => {
    seed({ stays: [stay({ status: "checked_in", checked_in_at: "2026-11-04T07:00:00Z" })] });
    const result = await markCheckinStayVerified(STAY);
    expect(result).toMatchObject({ ok: true, already: false });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "stay_verified", stay_id: STAY, actor_user_id: USER });
    const detail = await getCheckinStayDetail(STAY);
    expect(detail.ok && detail.detail.stay.verifiedByName).toBe("담당자");
  });

  it("이미 확인된 건은 그대로 두고 already, 기록을 더하지 않는다", async () => {
    seed({ stays: [stay({ status: "checked_in", verified_at: "2026-11-04T08:00:00Z", verified_by: uuid(801) })] });
    expect(await markCheckinStayVerified(STAY)).toEqual({ ok: true, verifiedAt: "2026-11-04T08:00:00Z", already: true });
    expect(await auditRows()).toEqual([]);
  });

  it.each(["pending", "pre_registered", "in_progress", "expired", "cancelled"])("%s 는 not_checked_in", async (status) => {
    seed({ stays: [stay({ status })] });
    expect(await markCheckinStayVerified(STAY)).toEqual({ ok: false, errorKey: "not_checked_in" });
  });
});

describe("도착 목록", () => {
  it("도착 8건 = 체크인 3 · 진행 중 1 · 아직 4 (AC-07), 취소는 세지 않는다", async () => {
    const statuses = ["checked_in", "checked_in", "checked_in", "in_progress", "pending", "pending", "pre_registered", "expired", "cancelled"];
    seed({ stays: statuses.map((status, index) => stay({ id: uuid(100 + index), status, reservation_group_key: `R${index}` })) });
    const result = await getCheckinArrivals({ date: "2026-11-04" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({ arrivals: 8, checkedIn: 3, inProgress: 1, notYet: 4, preRegistered: 1, notArrived: 2, expired: 1 });
    // 명부 없는 체크인 3건은 인원 불일치 → 확인 필요가 맨 앞.
    expect(result.rows.map((row) => row.group)).toEqual(["attention", "attention", "attention", "in_progress", "not_yet", "not_yet", "not_yet", "not_yet"]);
  });

  it("확인 끝난 건은 끝남으로, 표시할 값은 정규 이름 그대로", async () => {
    seed({ stays: [stay({ status: "checked_in", verified_at: "t", verified_by: USER })] });
    const result = await getCheckinArrivals({ date: "2026-11-04" });
    expect(result.ok && result.rows[0]).toMatchObject({
      group: "done",
      propertyName: "아라키초A",
      propertyKey: "arakicho_a",
      channel: "airbnb",
      leadName: "MOREAU LUCAS",
      roomLabels: ["201"],
    });
  });

  it("체크인 전이면 영상이 없어도 직원 확인을 걸지 않는다", async () => {
    const result = await getCheckinArrivals({ date: "2026-11-04" });
    expect(result.ok && result.rows[0].staffCheckCount).toBe(0);
  });

  it("도쿄 날짜 경계 — 날짜를 안 주면 도쿄 오늘로 고른다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T14:59:59Z"));
    expect(await getCheckinArrivals()).toMatchObject({ ok: true, date: "2026-11-03", rows: [] });
    vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
    const result = await getCheckinArrivals();
    expect(result).toMatchObject({ ok: true, date: "2026-11-04" });
    expect(result.ok && result.rows).toHaveLength(1);
  });

  it("잘못된 날짜 · 모르는 건물은 invalid", async () => {
    expect(await getCheckinArrivals({ date: "2026-02-30" })).toEqual({ ok: false, errorKey: "invalid" });
    expect(await getCheckinArrivals({ propertyKey: "sano" })).toEqual({ ok: false, errorKey: "invalid" });
  });
});

describe("표가 아직 없을 때", () => {
  const notReady = (code: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      is: () => query,
      order: () => query,
      maybeSingle: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: { code } })),
    };
    state.checkin = { from: () => query };
  };

  it.each(["PGRST106", "PGRST205", "42P01", "3F000"])("%s 는 터지지 않고 not_ready", async (code) => {
    notReady(code);
    expect(await getCheckinArrivals()).toEqual({ ok: false, errorKey: "not_ready" });
    expect(await getCheckinStayDetail(STAY)).toEqual({ ok: false, errorKey: "not_ready" });
    expect(await revealCheckinCode(STAY)).toEqual({ ok: false, errorKey: "not_ready" });
    expect(await listCheckinDevices()).toEqual({ ok: false, errorKey: "not_ready" });
    expect(await getCheckinPropertySettings("arakicho_a")).toEqual({ ok: false, errorKey: "not_ready" });
  });

  it("그 밖의 오류는 failed, 메시지는 밖으로 나가지 않는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    notReady("XX000");
    expect(await getCheckinArrivals()).toEqual({ ok: false, errorKey: "failed" });
    spy.mockRestore();
  });
});

describe("기기", () => {
  it("등록 코드 8자리 — 조직은 세션에서, 평문은 응답에만", async () => {
    const result = await issueCheckinEnrollmentCode({ propertyKey: "arakicho_b", deviceName: " 2층 " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toMatch(/^[0-9]{8}$/);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "enrollment_code_issued", organization_id: ORG });
    expect(JSON.stringify(rows)).not.toContain(result.code);
    const stored = (await (state.checkin as { from: (t: string) => { select: () => Promise<{ data: Record<string, unknown>[] }> } }).from("enrollment_codes").select()).data;
    expect(stored[0]).toMatchObject({ organization_id: ORG, property_key: "arakicho_b", device_name: "2층", created_by: USER });
  });

  describe("코드 끝내기", () => {
    const FUTURE = "2999-01-01T00:00:00.000Z";
    const codes = async () =>
      (await (state.checkin as { from: (t: string) => { select: () => Promise<{ data: Record<string, unknown>[] }> } }).from("enrollment_codes").select()).data;
    const row = (over: Record<string, unknown>) => ({ organization_id: ORG, created_by: USER, used_at: null, expires_at: FUTURE, property_key: "arakicho_a", device_name: "기기", ...over });
    const seedCodes = async (rows: Record<string, unknown>[]) => {
      const db = state.checkin as { from: (t: string) => { insert: (v: unknown) => PromiseLike<unknown> } };
      await db.from("enrollment_codes").insert(rows);
    };
    const expiresOf = async (code: string) => (await codes()).find((item) => item.code === code)?.expires_at;

    it("코드 A 를 받고 B 를 받아도 A 가 살아 있다", async () => {
      await seedCodes([row({ code: "11111111" })]);
      const second = await issueCheckinEnrollmentCode({ propertyKey: "arakicho_b", deviceName: "다음 건물" });
      expect(second.ok).toBe(true);
      expect(await expiresOf("11111111")).toBe(FUTURE);
      // 발급 때는 끝냄 기록도 없다.
      expect((await auditRows()).map((item) => item.action)).toEqual(["enrollment_code_issued"]);
    });

    it("「새 코드」는 그 코드만 끝낸다 — 같은 사람의 다른 코드는 그대로", async () => {
      await seedCodes([row({ code: "11111111" }), row({ code: "55555555" })]);
      expect(await invalidateCheckinEnrollmentCode("11111111")).toEqual({ ok: true, invalidated: true });
      expect(String(await expiresOf("11111111")) < FUTURE).toBe(true);
      expect(await expiresOf("55555555")).toBe(FUTURE);
    });

    it("기록 한 줄, 코드 값은 없다", async () => {
      await seedCodes([row({ code: "11111111" })]);
      await invalidateCheckinEnrollmentCode("11111111");
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: "enrollment_code_invalidated", organization_id: ORG, actor_user_id: USER });
      expect(JSON.stringify(rows)).not.toContain("11111111");
    });

    it.each([
      ["다른 사람 코드", { code: "22222222", created_by: uuid(801) }],
      ["다른 조직 코드", { code: "22222222", organization_id: OTHER_ORG }],
      ["이미 쓴 코드", { code: "22222222", used_at: "2026-11-04T00:00:00Z" }],
    ])("%s 값을 넘기면 끝나지 않고 기록도 없다", async (_name, over) => {
      await seedCodes([row(over)]);
      expect(await invalidateCheckinEnrollmentCode("22222222")).toEqual({ ok: true, invalidated: false });
      expect(await expiresOf("22222222")).toBe(FUTURE);
      expect(await auditRows()).toEqual([]);
    });

    it("이미 끝난 코드 · 없는 코드는 바꾸지 않는다", async () => {
      await seedCodes([row({ code: "22222222", expires_at: "2020-01-01T00:00:00.000Z" })]);
      expect(await invalidateCheckinEnrollmentCode("22222222")).toEqual({ ok: true, invalidated: false });
      expect(await expiresOf("22222222")).toBe("2020-01-01T00:00:00.000Z");
      expect(await invalidateCheckinEnrollmentCode("99999999")).toEqual({ ok: true, invalidated: false });
    });

    it("모양이 틀린 값은 invalid", async () => {
      expect(await invalidateCheckinEnrollmentCode("1234")).toEqual({ ok: false, errorKey: "invalid" });
    });
  });

  it("번호가 겹치면 다시 뽑는다", async () => {
    const real = state.checkin as { from: (table: string) => Record<string, unknown> };
    let conflicts = 1;
    state.checkin = {
      from: (table: string) => {
        const builder = real.from(table);
        if (table === "enrollment_codes" && conflicts > 0) {
          builder.insert = () => {
            conflicts -= 1;
            return { select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }) };
          };
        }
        return builder;
      },
    };
    expect((await issueCheckinEnrollmentCode({ propertyKey: "arakicho_a", deviceName: "로비" })).ok).toBe(true);
  });

  it("사노 · 모르는 건물 · 빈 이름은 코드를 만들지 않는다", async () => {
    expect((await issueCheckinEnrollmentCode({ propertyKey: "sano", deviceName: "x" })).ok).toBe(false);
    expect((await issueCheckinEnrollmentCode({ propertyKey: "nope", deviceName: "x" })).ok).toBe(false);
    expect((await issueCheckinEnrollmentCode({ propertyKey: "arakicho_a", deviceName: "  " })).ok).toBe(false);
    expect((await issueCheckinEnrollmentCode({ propertyKey: "arakicho_a", deviceName: "x".repeat(61) })).ok).toBe(false);
  });

  it("목록에 토큰 해시가 없고 끊김을 표시한다", async () => {
    const result = await listCheckinDevices();
    expect(JSON.stringify(result)).not.toContain("token_hash");
    expect(result.ok && result.devices[0]).toMatchObject({ id: DEVICE, disconnected: true, propertyName: "아라키초A" });
  });

  it("이름 변경 · 폐기는 기록을 남기고, 폐기된 기기는 다시 못 고친다", async () => {
    expect(await renameCheckinDevice({ deviceId: DEVICE, name: "입구" })).toEqual({ ok: true });
    expect(await revokeCheckinDevice(DEVICE)).toEqual({ ok: true, already: false });
    expect(await revokeCheckinDevice(DEVICE)).toEqual({ ok: true, already: true });
    expect(await renameCheckinDevice({ deviceId: DEVICE, name: "또" })).toEqual({ ok: false, errorKey: "not_found" });
    expect((await auditRows()).map((row) => row.action)).toEqual(["device_renamed", "device_revoked"]);
    const list = await listCheckinDevices();
    expect(list.ok && list.devices).toEqual([]);
  });
});

describe("건물 설정", () => {
  const stored = () =>
    (state.checkin as { from: (t: string) => { select: () => Promise<{ data: Record<string, unknown>[] }> } }).from("property_settings").select();

  it("저장한 적 없으면 기본값", async () => {
    const result = await getCheckinPropertySettings("arakicho_a");
    expect(result.ok && result.settings).toMatchObject({ saved: false, termsVersion: 1, videoSecondsPerGuest: 5, verificationMethod: "video", hasStaffPin: false });
  });

  it("PIN 은 해시로 저장되고 응답 · 기록에 값이 없다", async () => {
    const result = await saveCheckinPropertySettings({ ...settingsInput, staffPin: "482913" });
    expect(result.ok && result.settings.hasStaffPin).toBe(true);
    const row = (await stored()).data[0];
    expect(String(row.staff_pin_hash)).toMatch(/^pbkdf2-sha256\$120000\$/);
    const hash = String(row.staff_pin_hash);
    const output = JSON.stringify(result) + JSON.stringify(await auditRows());
    expect(output).not.toContain("482913");
    expect(output).not.toContain(hash);
    expect(output).not.toContain("staff_pin_hash");
    expect((await auditRows())[0]).toMatchObject({ action: "property_settings_updated" });
  });

  const T0 = "2026-11-01T00:00:00.000Z";
  const seedRow = async (termsText: unknown, version: number, staffPinHash: string | null = null) => {
    const db = state.checkin as { from: (t: string) => { insert: (v: unknown) => PromiseLike<unknown> } };
    await db.from("property_settings").insert({
      organization_id: ORG, property_key: "arakicho_a", terms_text: termsText, terms_version: version, languages: ["ja", "en"],
      welcome_text: {}, required_fields: [], support_contacts: {}, video_seconds_per_guest: 5, idle_seconds_input: 240,
      idle_seconds_done: 30, verification_method: "video", staff_pin_hash: staffPinHash, mrz_autofill: true, updated_at: T0,
    });
  };

  it("PIN 을 안 주면 칼럼을 보내지 않아 그대로, null 이면 지운다", async () => {
    await saveCheckinPropertySettings(settingsInput);
    expect((await stored()).data[0]).not.toHaveProperty("staff_pin_hash");
    seed();
    await seedRow({ ko: "약관 1" }, 1, "pbkdf2-sha256$old");
    const kept = await saveCheckinPropertySettings({ ...settingsInput, expectedUpdatedAt: T0 });
    expect(kept.ok).toBe(true);
    const row = (await stored()).data[0];
    expect(row.staff_pin_hash).toBe("pbkdf2-sha256$old");
    await saveCheckinPropertySettings({ ...settingsInput, expectedUpdatedAt: String(row.updated_at), staffPin: null });
    expect((await stored()).data[0]).toHaveProperty("staff_pin_hash", null);
  });

  it("약관 글이 바뀌면 서버가 버전을 올리고, 그대로면 둔다", async () => {
    await seedRow({ ko: "약관 1" }, 3);
    await saveCheckinPropertySettings({ ...settingsInput, expectedUpdatedAt: T0 });
    expect((await stored()).data[0]).toMatchObject({ terms_version: 3 });
    seed();
    await seedRow({ ko: "약관 1" }, 3);
    await saveCheckinPropertySettings({ ...settingsInput, expectedUpdatedAt: T0, termsText: { ko: "약관 2" } });
    expect((await stored()).data[0]).toMatchObject({ terms_version: 4 });
  });

  it("첫 저장에서 약관 글을 넣으면 1 → 2, 글이 없으면 1", async () => {
    await saveCheckinPropertySettings(settingsInput);
    expect((await stored()).data[0]).toMatchObject({ terms_version: 2 });
    seed();
    await saveCheckinPropertySettings({ ...settingsInput, termsText: {} });
    expect((await stored()).data[0]).toMatchObject({ terms_version: 1 });
  });

  describe("저장 경합", () => {
    it("폼을 읽은 뒤 누가 저장했으면 conflict — 아무것도 안 바뀐다", async () => {
      await seedRow({ ko: "먼저 저장한 글" }, 3);
      const result = await saveCheckinPropertySettings({ ...settingsInput, expectedUpdatedAt: "2026-10-31T00:00:00.000Z", termsText: { ko: "뒤 글" } });
      expect(result).toEqual({ ok: false, errorKey: "conflict" });
      expect((await stored()).data[0]).toMatchObject({ terms_text: { ko: "먼저 저장한 글" }, terms_version: 3 });
      expect(await auditRows()).toEqual([]);
    });

    it("빈 폼으로 열었는데 그 사이 줄이 생겼으면 conflict", async () => {
      await seedRow({ ko: "먼저" }, 2);
      expect(await saveCheckinPropertySettings(settingsInput)).toEqual({ ok: false, errorKey: "conflict" });
    });

    it("읽은 뒤 쓰기 직전에 끼어들어도 조건부 update 가 막는다", async () => {
      await seedRow({ ko: "약관 1" }, 3);
      // 가짜 DB 는 읽은 줄을 참조로 주므로, 「읽은 값 ≠ 지금 DB 값」은 update 조건 쪽을 바꿔 흉내 낸다.
      const real = state.checkin as { from: (t: string) => Record<string, (...args: unknown[]) => unknown> };
      let conditioned = false;
      state.checkin = {
        from: (table: string) => {
          const builder = real.from(table);
          if (table === "property_settings") {
            const eq = builder.eq;
            builder.eq = (column: unknown, value: unknown) => {
              if (column !== "updated_at") return eq(column, value);
              conditioned = true;
              return eq(column, "2026-10-01T00:00:00.000Z");
            };
          }
          return builder;
        },
      };
      expect(await saveCheckinPropertySettings({ ...settingsInput, expectedUpdatedAt: T0, termsText: { ko: "뒤 글" } })).toEqual({ ok: false, errorKey: "conflict" });
      expect(conditioned).toBe(true);
      expect((await stored()).data[0]).toMatchObject({ terms_text: { ko: "약관 1" }, terms_version: 3 });
    });

    it("첫 저장이 겹쳐 insert 가 부딪혀도 conflict", async () => {
      const real = state.checkin as { from: (t: string) => Record<string, unknown> };
      state.checkin = {
        from: (table: string) => {
          const builder = real.from(table);
          if (table === "property_settings") builder.insert = async () => ({ error: { code: "23505" } });
          return builder;
        },
      };
      expect(await saveCheckinPropertySettings(settingsInput)).toEqual({ ok: false, errorKey: "conflict" });
    });
  });

  it.each([
    ["본인 확인 방식은 1차 video 만", { verificationMethod: "staff_call" }, "verificationMethod"],
    ["동영상 초 범위", { videoSecondsPerGuest: 16 }, "videoSecondsPerGuest"],
    ["대기 시간 범위", { idleSecondsInput: 10 }, "idleSecondsInput"],
    ["모르는 언어", { languages: ["ja", "fr"] }, "languages"],
    ["언어 없음", { languages: [] }, "languages"],
    ["PIN 모양", { staffPin: "12a" }, "staffPin"],
    ["법에 정해진 칸을 끄기", { requiredFields: [{ key: "address", required: false, foreignOnly: false }] }, "requiredFields"],
    ["법에 정해진 칸을 외국인만으로 좁히기", { requiredFields: [{ key: "next_dest", required: true, foreignOnly: true }] }, "requiredFields"],
    ["모르는 칸", { requiredFields: [{ key: "occupation", required: true, foreignOnly: false }] }, "requiredFields"],
  ])("%s", async (_name, patch, field) => {
    expect(await saveCheckinPropertySettings({ ...settingsInput, ...patch })).toEqual({ ok: false, errorKey: "invalid", field });
    expect((await stored()).data).toEqual([]);
  });

  it("사노 · 모르는 건물은 읽기 · 저장 모두 invalid", async () => {
    expect(await getCheckinPropertySettings("sano")).toEqual({ ok: false, errorKey: "invalid" });
    expect(await saveCheckinPropertySettings({ ...settingsInput, propertyKey: "sano" })).toEqual({ ok: false, errorKey: "invalid" });
  });
});
