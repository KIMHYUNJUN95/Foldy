// 사용자 관리 점검 수정(2026-11-11) — 서버 쪽. 역할 경합(expectedRole · stale) · 권한 회수 먼저 · DB 마지막 대표 오류 ·
// 대상 조직 역할 · 'invited' 수동 지정 금지 · 회수 대상 확인 · 삭제 이력 조회 실패 · 초대 켜기 역할 확인 · 0행 기록 금지 ·
// 직접 넣는 코드 형식 · 도쿄 만료 · 권한 읽기 실패 시 닫기 · 탈퇴(마지막 대표 · deleteUser 결과 · 개발자 해제) ·
// 첫 개발자 등록 RPC · 초대 미리보기 일반 오류. 실제 DB 를 부르지 않는다(마이그레이션은 PGlite 로 따로 확인).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createComplaintsFakeDb } from "./complaints-fake-db";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
class RedirectError extends Error {
  constructor(public url: string) {
    super(`REDIRECT ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

const audit = vi.hoisted(() => ({ calls: [] as Array<{ action: string }> }));
vi.mock("@/lib/user-audit", () => ({
  USER_AUDIT_TARGET: "membership",
  INVITE_AUDIT_TARGET: "invite_code",
  logUserAudit: async (entry: { action: string }) => {
    audit.calls.push(entry);
  },
}));

type FailFn = (table: string, op: string, payload: unknown) => { code: string; message: string } | null;
const state = vi.hoisted(() => ({
  actor: "actor" as string | null,
  failWrite: null as null | FailFn,
  failSelect: null as null | ((table: string, columns: string) => { code: string; message: string } | null),
  authCalls: [] as Array<{ fn: string; args: unknown[] }>,
  authError: null as null | { message: string },
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  rpcResult: { data: null as unknown, error: null as null | { message: string } },
  /** 호출 순서(rpc:이름 · auth:함수) — 「DB 거래 먼저, 로그인 잠금 나중」 같은 순서를 확인한다. */
  order: [] as string[],
  /** 이 RPC 를 DB 오류로 실패시킨다(아무것도 바꾸지 않음 = 거래 롤백 흉내). */
  rpcFail: null as null | string,
  /** RPC 직전에 부른다 — 앱이 읽은 뒤 · 거래 전에 남이 바꾼 경합을 흉내 낸다. */
  beforeRpc: null as null | (() => void),
}));

let db: ReturnType<typeof createComplaintsFakeDb>;

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.actor ? { id: state.actor } : null } }) },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => db.client.from(table),
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      state.order.push(`rpc:${name}`);
      state.beforeRpc?.();
      if (state.rpcFail === name) return { data: null, error: { message: "db down" } };
      const simulated = simulateRpc(name, args as Record<string, unknown>);
      return simulated ?? state.rpcResult;
    },
    auth: {
      admin: {
        updateUserById: async (...args: unknown[]) => {
          state.authCalls.push({ fn: "updateUserById", args });
          state.order.push("auth:updateUserById");
          return { error: state.authError };
        },
        deleteUser: async (...args: unknown[]) => {
          state.authCalls.push({ fn: "deleteUser", args });
          state.order.push("auth:deleteUser");
          return { error: state.authError };
        },
      },
    },
  }),
}));

/**
 * 202611110003 의 원자 함수 흉내(한 거래 — 실패면 아무것도 안 바뀐다). SQL 자체는 PGlite 스크립트로 따로 확인했다.
 * 여기서는 앱이 그 결과를 어떻게 다루는지(순서 · 오류 키)만 본다.
 */
function simulateRpc(name: string, args: Record<string, unknown>) {
  const memberships = db.tables.memberships;
  const overrides = db.tables.membership_permission_overrides;
  const target = memberships.find((row) => row.id === args.p_membership_id);
  const removesLastOwner = (next: { role?: unknown; status?: unknown; deleted?: boolean }) =>
    target!.role === "owner" &&
    target!.status === "active" &&
    (next.deleted || (next.role ?? "owner") !== "owner" || (next.status ?? "active") !== "active") &&
    !memberships.some((row) => row !== target && row.organization_id === target!.organization_id && row.role === "owner" && row.status === "active");
  const revokeAll = () => {
    const hit = overrides.filter((row) => row.organization_id === target!.organization_id && row.user_id === target!.user_id && row.revoked_at === null);
    for (const row of hit) row.revoked_at = "now";
    return hit.map((row) => row.permission_key);
  };
  if (name === "apply_membership_change") {
    if (!target) return { data: { result: "not_found" }, error: null };
    if (args.p_expected_role && target.role !== args.p_expected_role) return { data: { result: "stale" }, error: null };
    if (removesLastOwner({ role: args.p_role ?? undefined, status: args.p_status ?? undefined })) return { data: { result: "last_owner" }, error: null };
    const roleChanged = args.p_role != null && args.p_role !== target.role;
    const revoke = roleChanged || (args.p_status != null && args.p_status !== "active");
    if (args.p_role != null) target.role = args.p_role;
    if (args.p_status != null) target.status = args.p_status;
    return { data: { result: "ok", revoked: revoke ? revokeAll() : [] }, error: null };
  }
  if (name === "delete_membership_atomic") {
    if (!target) return { data: { result: "not_found" }, error: null };
    if (removesLastOwner({ deleted: true })) return { data: { result: "last_owner" }, error: null };
    const revoked = revokeAll();
    db.tables.memberships = memberships.filter((row) => row !== target);
    let profileDeleted = false;
    if (args.p_delete_profile && !db.tables.memberships.some((row) => row.user_id === target.user_id)) {
      db.tables.profiles = db.tables.profiles.filter((row) => row.id !== target.user_id);
      profileDeleted = true;
    }
    return { data: { result: "ok", revoked, profile_deleted: profileDeleted }, error: null };
  }
  return null;
}

const ORG = "org-1";
const ORG_B = "org-2";

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  db = createComplaintsFakeDb({
    tables: {
      platform_admins: [],
      memberships: [
        { id: "m-actor", organization_id: ORG, user_id: "actor", role: "owner", status: "active" },
        { id: "m-owner2", organization_id: ORG, user_id: "owner2", role: "owner", status: "active" },
        { id: "m-staff", organization_id: ORG, user_id: "staff1", role: "staff", status: "active" },
        { id: "m-staff2", organization_id: ORG, user_id: "staff2", role: "staff", status: "active" },
      ],
      membership_permission_overrides: [
        { id: "ov-staff", organization_id: ORG, user_id: "staff1", permission_key: "payroll.view", effect: "grant", revoked_at: null, expires_at: null },
        { id: "ov-staff2", organization_id: ORG, user_id: "staff2", permission_key: "payroll.view", effect: "grant", revoked_at: null, expires_at: null },
      ],
      profiles: [],
      invite_codes: [],
      organizations: [{ id: ORG, name: "Haru", slug: "haru", status: "active" }],
      attendance_sessions: [],
      cleaning_sessions: [],
      annual_leave_requests: [],
      staff_id_documents: [],
      ...extra,
    },
    failWrite: (table, op, payload) => state.failWrite?.(table, op, payload) ?? null,
    failSelect: (table, columns) => state.failSelect?.(table, columns) ?? null,
  });
}

beforeEach(() => {
  state.actor = "actor";
  state.failWrite = null;
  state.failSelect = null;
  state.authCalls = [];
  state.authError = null;
  state.rpcCalls = [];
  state.rpcResult = { data: null, error: null };
  state.order = [];
  state.rpcFail = null;
  state.beforeRpc = null;
  audit.calls = [];
  seed();
});

const membership = (id: string) => db.tables.memberships.find((row) => row.id === id)!;
const activeOverride = (id: string) => db.tables.membership_permission_overrides.find((row) => row.id === id)!.revoked_at === null;

describe("setMemberRole", () => {
  it("expectedRole 이 지금 역할과 다르면 stale 을 돌려주고 아무것도 바꾸지 않는다", async () => {
    const { setMemberRole } = await import("@/actions/users");
    expect(await setMemberRole("m-staff", "field_manager", "part_time_staff")).toEqual({ ok: false, error: "stale" });
    expect(membership("m-staff").role).toBe("staff");
    expect(activeOverride("ov-staff")).toBe(true);
  });

  it("expectedRole 이 맞으면 바꾼다", async () => {
    const { setMemberRole } = await import("@/actions/users");
    expect(await setMemberRole("m-staff", "field_manager", "staff")).toEqual({ ok: true });
    expect(membership("m-staff").role).toBe("field_manager");
  });

  it("역할 변경 + 권한 회수는 한 거래 RPC 로 — 실패하면 역할도 차단(deny)도 그대로, save_failed", async () => {
    const { setMemberRole } = await import("@/actions/users");
    db.tables.membership_permission_overrides.push({ id: "ov-deny", organization_id: ORG, user_id: "staff1", permission_key: "payroll.view", effect: "deny", revoked_at: null });
    state.rpcFail = "apply_membership_change";
    expect(await setMemberRole("m-staff", "field_manager")).toEqual({ ok: false, error: "save_failed" });
    expect(membership("m-staff").role).toBe("staff");
    expect(activeOverride("ov-deny")).toBe(true);
    expect(db.writes.filter((w) => w.table === "membership_permission_overrides")).toHaveLength(0);
  });

  it("읽은 뒤 거래 전에 남이 역할을 바꿨으면 stale — 아무것도 회수하지 않는다", async () => {
    const { setMemberRole } = await import("@/actions/users");
    state.beforeRpc = () => {
      membership("m-staff").role = "part_time_staff";
    };
    expect(await setMemberRole("m-staff", "field_manager")).toEqual({ ok: false, error: "stale" });
    expect(membership("m-staff").role).toBe("part_time_staff");
    expect(activeOverride("ov-staff")).toBe(true);
  });

  it("거래가 last_owner 를 돌려주면 같은 오류 키(앱 확인 뒤 다른 대표가 정지된 경합)", async () => {
    const { setMemberRole } = await import("@/actions/users");
    state.beforeRpc = () => {
      membership("m-actor").status = "suspended";
    };
    expect(await setMemberRole("m-owner2", "office_admin")).toEqual({ ok: false, error: "last_owner" });
    expect(membership("m-owner2").role).toBe("owner");
  });

  it("대표 여부는 대상 조직의 역할로 본다 — 다른 조직 첫 멤버십 역할이 낮아도 막지 않는다", async () => {
    const { setMemberRole } = await import("@/actions/users");
    // 행위자: ORG_B 에서는 staff(먼저 나오는 줄), ORG 에서는 owner.
    db.tables.memberships.unshift({ id: "m-actor-b", organization_id: ORG_B, user_id: "actor", role: "staff", status: "active" });
    expect(await setMemberRole("m-staff", "senior_managing_director")).toEqual({ ok: true });
  });
});

describe("setMemberStatus", () => {
  it("'invited' 는 수동으로 지정할 수 없다(로그인이 잠긴 채 남는다)", async () => {
    const { setMemberStatus } = await import("@/actions/users");
    expect(await setMemberStatus("m-staff", "invited")).toEqual({ ok: false, error: "invalid_member" });
    expect(state.authCalls).toHaveLength(0);
  });

  it("정지: DB 거래(상태 + 회수)를 먼저, 로그인 잠금은 그 뒤", async () => {
    const { setMemberStatus } = await import("@/actions/users");
    expect(await setMemberStatus("m-staff", "suspended")).toEqual({ ok: true });
    expect(state.order).toEqual(["rpc:apply_membership_change", "auth:updateUserById"]);
    expect(membership("m-staff").status).toBe("suspended");
    expect(activeOverride("ov-staff")).toBe(false);
  });

  it("정지: 거래가 실패하면 잠금도 하지 않고 차단(deny)도 그대로", async () => {
    const { setMemberStatus } = await import("@/actions/users");
    db.tables.membership_permission_overrides.push({ id: "ov-deny", organization_id: ORG, user_id: "staff1", permission_key: "payroll.view", effect: "deny", revoked_at: null });
    state.rpcFail = "apply_membership_change";
    expect(await setMemberStatus("m-staff", "suspended")).toEqual({ ok: false, error: "save_failed" });
    expect(state.authCalls).toHaveLength(0);
    expect(membership("m-staff").status).toBe("active");
    expect(activeOverride("ov-deny")).toBe(true);
  });

  it("정지: 거래 뒤 로그인 잠금이 실패하면 save_failed — DB 는 정지 + 회수로 맞게 남는다(세션 문이 정지 멤버를 막는다)", async () => {
    const { setMemberStatus } = await import("@/actions/users");
    state.authError = { message: "auth down" };
    expect(await setMemberStatus("m-staff", "suspended")).toEqual({ ok: false, error: "save_failed" });
    expect(membership("m-staff").status).toBe("suspended");
    expect(activeOverride("ov-staff")).toBe(false);
  });

  it("정지: 거래가 last_owner 면 잠금을 하지 않는다", async () => {
    const { setMemberStatus } = await import("@/actions/users");
    state.beforeRpc = () => {
      membership("m-actor").status = "suspended";
    };
    expect(await setMemberStatus("m-owner2", "suspended")).toEqual({ ok: false, error: "last_owner" });
    expect(state.authCalls).toHaveLength(0);
    expect(membership("m-owner2").status).toBe("active");
  });

  it("활성화: 잠금 풀기 먼저, 거래가 실패하면 잠금을 되돌린다", async () => {
    const { setMemberStatus } = await import("@/actions/users");
    membership("m-staff").status = "suspended";
    state.rpcFail = "apply_membership_change";
    expect(await setMemberStatus("m-staff", "active")).toEqual({ ok: false, error: "save_failed" });
    expect(state.order).toEqual(["auth:updateUserById", "rpc:apply_membership_change", "auth:updateUserById"]);
    expect(state.authCalls.map((call) => (call.args[1] as { ban_duration: string }).ban_duration)).toEqual(["none", "876000h"]);
  });
});

describe("revokePermissionOverrideAction", () => {
  it("다른 사람의 지정 id 로는 회수하지 않고 기록도 남기지 않는다", async () => {
    const { revokePermissionOverrideAction } = await import("@/actions/users");
    expect(await revokePermissionOverrideAction({ membershipId: "m-staff", overrideId: "ov-staff2" })).toEqual({
      ok: false,
      error: "invalid_override",
    });
    expect(activeOverride("ov-staff2")).toBe(true);
    expect(audit.calls).toHaveLength(0);
  });

  it("그 사람의 지정이면 회수하고 기록한다", async () => {
    const { revokePermissionOverrideAction } = await import("@/actions/users");
    expect(await revokePermissionOverrideAction({ membershipId: "m-staff", overrideId: "ov-staff" })).toEqual({ ok: true });
    expect(activeOverride("ov-staff")).toBe(false);
    expect(audit.calls.map((call) => call.action)).toEqual(["member.permission_revoke"]);
  });
});

describe("deleteMember", () => {
  it("이력 개수 조회가 실패하면 0 으로 보지 않고 delete_failed", async () => {
    const { deleteMember } = await import("@/actions/users");
    state.failSelect = (table) => (table === "attendance_sessions" ? { code: "XX", message: "timeout" } : null);
    expect(await deleteMember("m-staff")).toEqual({ ok: false, error: "delete_failed" });
    expect(membership("m-staff")).toBeDefined();
    expect(activeOverride("ov-staff")).toBe(true);
    expect(state.authCalls).toHaveLength(0);
  });

  it("DB 거래(회수 + 멤버십 + 프로필)가 실패하면 로그인 계정도 지우지 않는다", async () => {
    const { deleteMember } = await import("@/actions/users");
    state.rpcFail = "delete_membership_atomic";
    expect(await deleteMember("m-staff")).toEqual({ ok: false, error: "delete_failed" });
    expect(membership("m-staff")).toBeDefined();
    expect(activeOverride("ov-staff")).toBe(true);
    expect(state.authCalls).toHaveLength(0);
  });

  it("DB 거래를 먼저, 로그인 계정 삭제는 그 뒤 — 실패하면 로그인을 잠가 빈 계정이 쓰이지 않게", async () => {
    const { deleteMember } = await import("@/actions/users");
    db.tables.profiles.push({ id: "staff1", name: "Lee", phone_number: "+81" });
    state.authError = { message: "auth down" };
    expect(await deleteMember("m-staff")).toEqual({ ok: true });
    expect(state.order).toEqual(["rpc:delete_membership_atomic", "auth:deleteUser", "auth:updateUserById"]);
    expect(db.tables.memberships.find((row) => row.id === "m-staff")).toBeUndefined();
    expect(db.tables.profiles.find((row) => row.id === "staff1")).toBeUndefined();
  });

  it("다른 조직 멤버십이 남으면 멤버십만 지우고 로그인 계정은 건드리지 않는다", async () => {
    const { deleteMember } = await import("@/actions/users");
    db.tables.memberships.push({ id: "m-staff-b", organization_id: ORG_B, user_id: "staff1", role: "staff", status: "active" });
    expect(await deleteMember("m-staff")).toEqual({ ok: true });
    expect(state.authCalls).toHaveLength(0);
    expect(state.rpcCalls.at(-1)?.args).toMatchObject({ p_delete_profile: false });
  });
});

describe("invite codes", () => {
  const actor = { userId: "actor", role: "owner" as const };

  it("오피스 관리자는 대표급 기본 역할 초대를 다시 켤 수 없다", async () => {
    const { setInviteCodeActiveAs } = await import("@/lib/invite-codes-server");
    db.tables.memberships.push({ id: "m-oa", organization_id: ORG, user_id: "oa", role: "office_admin", status: "active" });
    db.tables.membership_permission_overrides.push({ id: "ov-um", organization_id: ORG, user_id: "oa", permission_key: "user.manage", effect: "grant", revoked_at: null, expires_at: null });
    db.tables.invite_codes.push({ id: "inv-1", organization_id: ORG, default_role: "office_admin", is_active: false });
    const result = await setInviteCodeActiveAs({ userId: "oa", role: "office_admin" }, { inviteCodeId: "inv-1", organizationId: ORG, active: true });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(db.tables.invite_codes[0].is_active).toBe(false);
    // 끄기는 된다(권한을 줄이는 쪽).
    db.tables.invite_codes[0].is_active = true;
    expect(await setInviteCodeActiveAs({ userId: "oa", role: "office_admin" }, { inviteCodeId: "inv-1", organizationId: ORG, active: false })).toEqual({ ok: true });
  });

  it("다른 조직 · 없는 코드면 바뀐 줄이 없어 기록하지 않는다", async () => {
    const { setInviteCodeActiveAs, deleteInviteCodeAs } = await import("@/lib/invite-codes-server");
    db.tables.invite_codes.push({ id: "inv-x", organization_id: ORG_B, default_role: "staff", is_active: true });
    expect(await setInviteCodeActiveAs(actor, { inviteCodeId: "inv-x", organizationId: ORG, active: false })).toEqual({ ok: false, error: "invalid_invite" });
    expect(await deleteInviteCodeAs(actor, { inviteCodeId: "inv-x", organizationId: ORG })).toEqual({ ok: false, error: "invalid_invite" });
    expect(audit.calls).toHaveLength(0);
    expect(db.tables.invite_codes).toHaveLength(1);
  });

  it("직접 넣는 코드는 6자 이상 · 영문 대문자 · 숫자 · 하이픈만", async () => {
    const { createInviteCodeAs } = await import("@/lib/invite-codes-server");
    for (const code of ["AB1", "한글코드입니다", "HARU_2026", "HARU<script>"]) {
      expect(await createInviteCodeAs(actor, { organizationId: ORG, defaultRole: "staff", code })).toEqual({ ok: false, error: "invalid_code" });
    }
    expect(db.tables.invite_codes).toHaveLength(0);
    expect(await createInviteCodeAs(actor, { organizationId: ORG, defaultRole: "staff", code: "haru 2026" })).toEqual({ ok: true });
    expect(db.tables.invite_codes[0].code).toBe("HARU-2026");
  });

  it("만료일은 도쿄 그날 끝(23:59:59 JST)이다", async () => {
    const { createInviteCodeAs } = await import("@/lib/invite-codes-server");
    expect(await createInviteCodeAs(actor, { organizationId: ORG, defaultRole: "staff", expiresAt: "2026-12-01" })).toEqual({ ok: true });
    expect(db.tables.invite_codes[0].expires_at).toBe("2026-12-01T14:59:59.000Z");
  });
});

describe("capabilities fail closed", () => {
  it("개인 부여 · 차단을 못 읽으면 역할 기본 권한도 주지 않는다", async () => {
    const { memberCapabilities } = await import("@/lib/capabilities-server");
    state.failSelect = (table) => (table === "membership_permission_overrides" ? { code: "XX", message: "timeout" } : null);
    expect(await memberCapabilities(ORG, "actor")).toEqual([]);
  });

  it("세션 행 읽기에서 개인 권한을 못 읽으면 예외(차단이 사라진 세션을 만들지 않는다)", async () => {
    const { getIdentityRows } = await import("@/lib/identity-rows");
    state.failSelect = (table) => (table === "membership_permission_overrides" ? { code: "XX", message: "timeout" } : null);
    await expect(getIdentityRows("actor")).rejects.toThrow();
  });
});

describe("identity rows / onboarding fail closed", () => {
  it.each(["memberships", "platform_admins"])("%s 를 못 읽으면 예외(「멤버십 없음」 온보딩으로 보내지 않는다)", async (table) => {
    const { getIdentityRows } = await import("@/lib/identity-rows");
    state.failSelect = (t) => (t === table ? { code: "XX", message: "timeout" } : null);
    await expect(getIdentityRows("actor")).rejects.toThrow();
  });

  it("첫 개발자 가능 여부 개수 조회가 실패하면 「가능」으로 보지 않는다", async () => {
    const { getOnboardingState } = await import("@/lib/onboarding");
    // 프로필 없음 → needs_profile 경로. 세션 배치 읽기(role)는 성공, 개수 조회(id)만 실패.
    state.failSelect = (t, columns) => (t === "platform_admins" && columns === "id" ? { code: "XX", message: "timeout" } : null);
    const result = (await getOnboardingState()) as { status: string; canClaimPlatformAdmin?: boolean };
    expect(result.status).toBe("needs_profile");
    expect(result.canClaimPlatformAdmin).toBe(false);
  });

  it("알림 받는 사람 고르기는 읽기 실패면 빈 목록 + 오류 로그", async () => {
    const { memberIdsWithCapability } = await import("@/lib/capabilities-server");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    state.failSelect = (t) => (t === "membership_permission_overrides" ? { code: "XX", message: "timeout" } : null);
    expect(await memberIdsWithCapability(ORG, "payroll.view")).toEqual([]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("deleteAccount", () => {
  it("어느 조직의 마지막 활성 대표면 { error: 'last_owner' } 를 돌려주고 아무것도 바꾸지 않는다", async () => {
    const { deleteAccount } = await import("@/app/account/actions");
    membership("m-owner2").status = "suspended";
    db.tables.profiles.push({ id: "actor", name: "Kim", phone_number: "+81-90-1111-2222" });
    expect(await deleteAccount()).toEqual({ error: "last_owner" });
    expect(db.tables.profiles[0].name).toBe("Kim");
    expect(membership("m-actor").status).toBe("active");
    expect(state.authCalls).toHaveLength(0);
  });

  it("deleteUser 가 실패하면 delete_failed 를 돌려준다(성공 화면으로 넘기지 않는다)", async () => {
    const { deleteAccount } = await import("@/app/account/actions");
    state.actor = "staff1";
    db.tables.profiles.push({ id: "staff1", name: "Lee", phone_number: "+81-90-1111-3333" });
    state.authError = { message: "auth down" };
    expect(await deleteAccount()).toEqual({ error: "delete_failed" });
  });

  it("플랫폼 개발자가 탈퇴하면 platform_admins 를 끈다", async () => {
    const { deleteAccount } = await import("@/app/account/actions");
    state.actor = "staff1";
    db.tables.profiles.push({ id: "staff1", name: "Lee", phone_number: "+81-90-1111-3333" });
    db.tables.platform_admins.push({ id: "pa-1", user_id: "staff1", role: "developer_super_admin", is_active: true });
    await expect(deleteAccount()).rejects.toThrow("REDIRECT /auth/login");
    expect(db.tables.platform_admins[0].is_active).toBe(false);
    expect(state.authCalls.map((call) => call.fn)).toEqual(["deleteUser"]);
  });
});

describe("updateAccountProfile", () => {
  it("언어만 바꾸면 예전 형식 전화 · 비어 있는 성별을 다시 검사하지 않는다", async () => {
    const { updateAccountProfile } = await import("@/app/account/actions");
    db.tables.profiles.push({ id: "actor", name: "Kim", phone_number: "090 1111", gender: null, birth_date: null, preferred_language: "ko" });
    const form = new FormData();
    form.set("mode", "mobile");
    form.set("name", "Kim");
    form.set("phoneNumber", "090 1111");
    form.set("gender", "");
    form.set("birthDate", "");
    form.set("preferredLanguage", "ja");
    await expect(updateAccountProfile(form)).rejects.toThrow("saved=1");
    expect(db.tables.profiles[0].preferred_language).toBe("ja");
    expect(db.tables.profiles[0].phone_number).toBe("090 1111");
  });

  it("전화를 바꾸면 그 칸은 검사한다", async () => {
    const { updateAccountProfile } = await import("@/app/account/actions");
    db.tables.profiles.push({ id: "actor", name: "Kim", phone_number: "090 1111", gender: "male", birth_date: null, preferred_language: "ko" });
    const form = new FormData();
    form.set("mode", "mobile");
    form.set("name", "Kim");
    form.set("phoneNumber", "12");
    form.set("gender", "male");
    form.set("preferredLanguage", "ko");
    await expect(updateAccountProfile(form)).rejects.toThrow("error=phone_invalid");
    expect(db.tables.profiles[0].phone_number).toBe("090 1111");
  });
});

describe("updateAccountLanguage", () => {
  it("언어만 저장하고 결과를 돌려준다(주소의 ?error= 와 상관없이)", async () => {
    const { updateAccountLanguage } = await import("@/app/account/actions");
    db.tables.profiles.push({ id: "actor", name: "Kim", phone_number: "090 1111", gender: null, preferred_language: "ko" });
    expect(await updateAccountLanguage("en")).toEqual({ ok: true });
    expect(db.tables.profiles[0]).toMatchObject({ preferred_language: "en", phone_number: "090 1111" });
  });

  it("모르는 언어 · 저장 실패 · 로그인 없음은 ok:false", async () => {
    const { updateAccountLanguage } = await import("@/app/account/actions");
    db.tables.profiles.push({ id: "actor", name: "Kim", phone_number: "+81", preferred_language: "ko" });
    expect(await updateAccountLanguage("fr")).toEqual({ ok: false, error: "invalid_language" });
    state.failWrite = (table) => (table === "profiles" ? { code: "XX", message: "boom" } : null);
    expect(await updateAccountLanguage("ja")).toEqual({ ok: false, error: "profile_failed" });
    expect(db.tables.profiles[0].preferred_language).toBe("ko");
    state.actor = null;
    expect(await updateAccountLanguage("ja")).toEqual({ ok: false, error: "unauthenticated" });
  });
});

describe("createInviteCode (대시보드 폼 액션)", () => {
  it("결과를 돌려준다 — 실패는 error, 성공은 ok", async () => {
    vi.doMock("@/lib/session", () => ({ getCurrentAppSession: async () => ({ user: { id: "actor", role: "owner" } }) }));
    const { createInviteCode } = await import("@/app/admin/settings/actions");
    const form = new FormData();
    form.set("organizationId", ORG);
    form.set("defaultRole", "staff");
    form.set("code", "AB");
    expect(await createInviteCode(form)).toEqual({ ok: false, error: "invalid_code" });
    form.set("code", "HARU-2026");
    expect(await createInviteCode(form)).toEqual({ ok: true });
    vi.doUnmock("@/lib/session");
  });
});

describe("onboarding", () => {
  it("첫 개발자 등록은 한 거래 RPC 로 한다", async () => {
    const { claimFirstPlatformAdmin } = await import("@/app/onboarding/actions");
    state.rpcResult = { data: "platform_admin_exists", error: null };
    await expect(claimFirstPlatformAdmin()).rejects.toThrow("error=platform_admin_exists");
    expect(state.rpcCalls).toEqual([{ name: "claim_first_platform_admin", args: { p_user_id: "actor" } }]);
    state.rpcResult = { data: "ok", error: null };
    await expect(claimFirstPlatformAdmin()).rejects.toThrow("REDIRECT /admin");
  });

  it("초대 미리보기는 없음 · 만료 · 꺼짐 · 다 씀 · 정지 조직을 같은 오류로 돌려준다", async () => {
    const { previewInviteCode } = await import("@/app/onboarding/actions");
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    db.tables.organizations.push({ id: ORG_B, name: "Stopped", status: "suspended" });
    db.tables.invite_codes.push(
      { code: "EXP-111", organization_id: ORG, default_role: "staff", expires_at: past, max_uses: 5, used_count: 0, is_active: true },
      { code: "OFF-111", organization_id: ORG, default_role: "staff", expires_at: future, max_uses: 5, used_count: 0, is_active: false },
      { code: "MAX-111", organization_id: ORG, default_role: "staff", expires_at: future, max_uses: 1, used_count: 1, is_active: true },
      { code: "SUS-111", organization_id: ORG_B, default_role: "staff", expires_at: future, max_uses: 5, used_count: 0, is_active: true },
      { code: "OK-1111", organization_id: ORG, default_role: "staff", expires_at: future, max_uses: 5, used_count: 0, is_active: true },
    );
    for (const code of ["NOPE-111", "EXP-111", "OFF-111", "MAX-111", "SUS-111"]) {
      expect(await previewInviteCode(code)).toEqual({ ok: false, errorKey: "invalid_invite" });
    }
    expect(await previewInviteCode("ok-1111")).toMatchObject({ ok: true, organizationName: "Haru" });
  });
});
