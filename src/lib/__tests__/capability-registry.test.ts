import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  assignableCapabilities,
  canBeDenied,
  capabilityPolicy,
  evaluateCapability,
  type Capability,
} from "@/config/capabilities";
import { organizationRoles } from "@/config/roles";
import {
  buildCapabilityRolesSeedSql,
  extractCapabilityRolesSeedSql,
} from "@/lib/capability-seed";

const SEED_MIGRATION_PATH = "supabase/migrations/202609100001_capability_foundation.sql";

/**
 * 권한 설계가 실패하는 방식은 언제나 **두 벌이 갈라지는 것**이다.
 *
 * 역할표는 `src/config/capabilities.ts` 한 곳에 있지만, RLS 가 SQL 안에서 판정해야 하므로 DB 에도
 * 사본이 필요하다. 이 테스트가 그 사본이 원본과 같은지 지킨다 — 레지스트리만 고치고 마이그레이션을
 * 안 고치면 여기서 깨지고, **붙여넣을 SQL 을 그대로 출력해 준다.**
 *
 * 설계: `docs/engineering/14-permission-architecture.md`
 */
describe("capability registry", () => {
  it("마이그레이션 시드가 레지스트리와 일치한다", () => {
    const file = readFileSync(SEED_MIGRATION_PATH, "utf8");
    const current = extractCapabilityRolesSeedSql(file);

    expect(current, `${SEED_MIGRATION_PATH} 에서 생성 구간 경계를 찾지 못했다`).not.toBeNull();

    const expected = buildCapabilityRolesSeedSql();
    if (current?.trim() !== expected.trim()) {
      throw new Error(
        `capability_roles 시드가 레지스트리와 다르다.\n` +
          `${SEED_MIGRATION_PATH} 의 생성 구간을 아래로 교체할 것:\n\n${expected}\n`,
      );
    }
  });

  it("모든 키의 역할이 실재하는 조직 역할이다", () => {
    for (const capability of CAPABILITY_KEYS) {
      for (const role of CAPABILITIES[capability].roles) {
        expect(organizationRoles as readonly string[]).toContain(role);
      }
    }
  });

  it("역할 부여가 없는 키에는 차단을 켜지 않는다", () => {
    // 뺄 것이 없는데 차단을 허용하면 관리 화면에 의미 없는 조작이 생긴다.
    for (const capability of CAPABILITY_KEYS) {
      const policy = CAPABILITIES[capability];
      if (policy.roles.length === 0) {
        expect(policy.individualDeny, `${capability}`).toBe(false);
      }
    }
  });

  it("개인 지정이 불가능한 키는 관리 화면 목록에 뜨지 않는다", () => {
    // 권한 관리 권한 자체가 그렇다 — 개인 지정으로 뺏고 줄 수 있으면 잠금 사고가 난다.
    expect(assignableCapabilities()).not.toContain("permission.manage");
  });

  it("사용자 관리 위임은 개발자만 줄 수 있다", () => {
    // 위임받은 사람이 다시 위임하면 권한이 무한히 번진다(2026-07-13 결정). 권한 카드가 이 규칙을
    // 잃지 않도록 못박는다 — 예전에는 개발자 전용 드롭다운이 그 역할을 했다.
    expect(CAPABILITIES["user.manage"].developerOnly).toBe(true);
  });

  it("개발자 전용 키는 개인 부여가 가능해야 의미가 있다", () => {
    for (const capability of CAPABILITY_KEYS) {
      // 리터럴 유니온을 그대로 좁히면 뒤 조건이 never 로 좁혀진다 — 넓은 타입으로 읽는다.
      const policy = capabilityPolicy(capability);
      if (!policy.developerOnly) continue;
      expect(policy.individualGrant || policy.individualDeny, `${capability}`).toBe(true);
      expect(policy.systemOnly, `${capability}`).toBe(false);
    }
  });
});

describe("판정식", () => {
  const base = { capability: "order_processor" as const, granted: false, denied: false };

  it("역할로 부여된다", () => {
    expect(evaluateCapability({ ...base, role: "office_admin" })).toBe(true);
    expect(evaluateCapability({ ...base, role: "staff" })).toBe(false);
  });

  it("개인 부여가 역할 없음을 이긴다", () => {
    expect(evaluateCapability({ ...base, role: "staff", granted: true })).toBe(true);
  });

  it("차단이 역할 부여를 이긴다", () => {
    expect(evaluateCapability({ ...base, role: "office_admin", denied: true })).toBe(false);
  });

  it("차단이 개인 부여도 이긴다", () => {
    // 「빼라」가 「줘라」보다 강해야 판단이 갈릴 때 안전한 쪽으로 실패한다.
    expect(
      evaluateCapability({ ...base, role: "staff", granted: true, denied: true }),
    ).toBe(false);
  });

  it("owner·전무·개발자는 차단되지 않는다", () => {
    // 소유자를 잠그면 되돌릴 사람이 없다.
    for (const role of ["owner", "senior_managing_director", "developer_super_admin"] as const) {
      expect(canBeDenied(role)).toBe(false);
      expect(evaluateCapability({ ...base, role, denied: true })).toBe(true);
    }
  });

  // 2026-10-21 — 개발자 예외: 부여 · 차단 행은 키 정책(individualGrant · individualDeny)과 무관하게 판정에 든다.
  // 정책 플래그는 「대표 · 전무가 걸 수 있는가」만 정한다(grantMemberOverride).
  it("차단을 허용하지 않는 키라도 차단 행이 있으면 막힌다(개발자가 건 차단)", () => {
    expect(
      evaluateCapability({
        capability: "job_application.read",
        role: "staff",
        granted: true,
        denied: true,
      }),
    ).toBe(false);
  });

  it("역할이 비어 있는 키는 개인 지정으로만 열린다", () => {
    // `automation.manage` — 조직 역할로는 아무도 받지 않고(개발자만 통과), 개인 부여로만 열린다.
    for (const role of organizationRoles) {
      expect(
        evaluateCapability({ capability: "automation.manage", role, granted: false, denied: false }),
        `${role}`,
      ).toBe(false);
    }
    expect(
      evaluateCapability({
        capability: "automation.manage",
        role: "field_manager",
        granted: true,
        denied: false,
      }),
    ).toBe(true);
  });

  it("사용자 관리는 대표 · 전무가 기본, 나머지는 개인 부여로만 (2026-10-20)", () => {
    for (const role of organizationRoles) {
      const expected = role === "owner" || role === "senior_managing_director";
      expect(evaluateCapability({ capability: "user.manage", role, granted: false, denied: false }), `${role}`).toBe(expected);
    }
    expect(evaluateCapability({ capability: "user.manage", role: "office_admin", granted: true, denied: false })).toBe(true);
  });

  it("채용 열람은 대표·전무 + 지정된 개인만", () => {
    const capability = "job_application.read" as const;
    for (const role of ["owner", "senior_managing_director"] as const) {
      expect(evaluateCapability({ capability, role, granted: false, denied: false }), role).toBe(true);
    }
    // 사무직 자동 열람은 없앴다 — 지정된 사람만 본다(2026-09-10 결정).
    for (const role of ["office_admin", "cs_staff", "field_manager", "staff", "part_time_staff"] as const) {
      expect(evaluateCapability({ capability, role, granted: false, denied: false }), role).toBe(false);
      expect(evaluateCapability({ capability, role, granted: true, denied: false }), `${role} granted`).toBe(true);
    }
  });

  it("개인 부여를 허용하지 않는 키라도 부여 행이 있으면 열린다(개발자가 건 부여)", () => {
    expect(
      evaluateCapability({
        capability: "permission.manage",
        role: "staff",
        granted: true,
        denied: false,
      }),
    ).toBe(true);
  });

  it("전무는 owner 가 가진 것을 모두 가진다", () => {
    // DB 헬퍼 has_org_role 이 「owner 가 목록에 있으면 전무도 통과」로 동작한다. 앱이 다르면
    // 같은 권한이 앱에서는 열리고 RLS 에서는 막히는(또는 그 반대) 상태가 된다.
    for (const capability of CAPABILITY_KEYS) {
      const owner = evaluateCapability({ capability, role: "owner", granted: false, denied: false });
      const smd = evaluateCapability({
        capability,
        role: "senior_managing_director",
        granted: false,
        denied: false,
      });
      expect(smd, `${capability}`).toBe(owner);
    }
  });
  it("개발자는 모든 권한을 갖는다", () => {
    // 사용자 결정(2026-09-10): 「개발자는 모든 권한이 당연히 전부 있어야 한다.」
    // 새 권한 키를 추가하면서 platformBypass 를 빠뜨리면 여기서 걸린다.
    for (const capability of CAPABILITY_KEYS) {
      expect(
        evaluateCapability({
          capability,
          role: "developer_super_admin",
          granted: false,
          denied: false,
        }),
        `${capability}`,
      ).toBe(true);
      // 차단으로도 개발자를 잠글 수 없다 — 마지막 복구 수단이다.
      expect(
        evaluateCapability({
          capability,
          role: "developer_super_admin",
          granted: false,
          denied: true,
        }),
        `${capability} (denied)`,
      ).toBe(true);
    }
  });
  it("통과가 꺼진 키에서도 개발자는 일반 규칙으로 판정된다", () => {
    // 예전에는 `return policy.platformBypass` 라 통과가 꺼진 키에서 개발자가 개인 부여를 갖고도
    // 거부됐다. SQL 은 흘려보내고 있어 둘의 답이 갈렸다(2026-09-10 감사).
    // 지금은 모든 키가 통과 true 라 이 테스트는 회귀 가드다.
    for (const capability of CAPABILITY_KEYS) {
      const policy = CAPABILITIES[capability];
      if (policy.platformBypass) continue;
      expect(
        evaluateCapability({ capability, role: "developer_super_admin", granted: true, denied: false }),
        `${capability}`,
      ).toBe(policy.individualGrant);
    }
  });
});

// 2026-10-21 — 역할 = 기본 틀, 대표 · 전무 · 개발자가 사람마다 켜고 끈다. 역할 이름 · 표시로 고정돼 있던 권한을 키로 옮겼다.
describe("역할 기본 틀 — 옮겨 온 키", () => {
  type OrgRole = (typeof organizationRoles)[number];
  const can = (role: OrgRole, capability: Capability, over: { granted?: boolean; denied?: boolean } = {}) =>
    evaluateCapability({ capability, role, granted: over.granted ?? false, denied: over.denied ?? false });

  it("관리자 웹 · 분실물 처리는 알바(아르바이트 · 리더)가 역할로 못 받는다", () => {
    for (const role of organizationRoles) {
      expect(can(role, "admin_web.access"), role).toBe(role !== "part_time_staff" && role !== "staff");
      expect(can(role, "lost_found.handle"), role).toBe(role !== "part_time_staff" && role !== "staff");
    }
  });

  it("근태 · 급여 · 시급 · 교통비 · 연차 결재는 역할로는 대표 · 전무만", () => {
    const keys: Capability[] = ["attendance.manage", "payroll.view", "payroll.manage", "wages.manage", "transport.manage", "leave.approve"];
    for (const capability of keys) {
      for (const role of organizationRoles) {
        expect(can(role, capability), `${capability} ${role}`).toBe(role === "owner" || role === "senior_managing_director");
      }
    }
  });

  it("근태 관리를 받은 아르바이트 리더에게 급여 보기는 따라오지 않는다", () => {
    expect(can("staff", "attendance.manage", { granted: true })).toBe(true);
    expect(can("staff", "payroll.view")).toBe(false);
  });

  it("역할로 받은 기본 기능도 사람마다 끌 수 있고, 대표 · 전무는 못 끈다", () => {
    expect(can("field_manager", "admin_web.access", { denied: true })).toBe(false);
    expect(can("staff", "admin_web.access")).toBe(false);
    expect(can("staff", "admin_web.access", { granted: true })).toBe(true);
    expect(can("owner", "attendance.manage", { denied: true })).toBe(true);
    expect(can("senior_managing_director", "payroll.view", { denied: true })).toBe(true);
  });
});