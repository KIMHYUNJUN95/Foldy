import { describe, expect, it } from "vitest";
import { CAPABILITIES, roleCan, rolesWithCapability, type Capability } from "@/config/capabilities";
import { roles } from "@/config/roles";

/**
 * 역할 × 기능 표 — 2026-10-20 권한 정리 ③ 에서 기능 파일마다 흩어져 있던 역할 목록을 권한 레지스트리로 옮기면서, **옮기기 전 목록을
 * 그대로** 여기 적어 못박았다(예외: 개발자는 「모든 권한」 결정에 따라 넷에 새로 들어감 — 공지 전체 관리 · 린넨 · 버그 검토 · 게시판 관리). 레지스트리를 바꾸면 이 표가 깨진다 — 의도한 변경이면 이 표와 문서(01-user-roles)를 같이 고친다.
 */
const EXPECTED: Partial<Record<Capability, readonly string[]>> = {
  "announcement.create": ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager", "staff"],
  "announcement.manage": ["developer_super_admin", "owner", "senior_managing_director", "office_admin"],
  "cleaning.work": ["developer_super_admin", "owner", "senior_managing_director", "field_manager", "staff", "part_time_staff"],
  "cleaning.read_all": ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
  "cleaning.force_complete": ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "field_manager"],
  "linen.manage": ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
  "property_info.edit": ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff"],
  "complaint.write": ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff"],
  "complaint.manage": ["developer_super_admin", "owner", "senior_managing_director", "office_admin"],
  "complaint.comment": ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager", "staff"],
  "request.delete_any": ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
  "bug.review": ["developer_super_admin", "owner", "senior_managing_director", "office_admin"],
  "board.manage": ["developer_super_admin", "owner", "senior_managing_director", "office_admin"],
  // 판매 캘린더 바꾸기(5-1) — 보기(`ops_admin.access`)와 같은 기본 역할.
  "ops_calendar.write": ["developer_super_admin", "owner", "senior_managing_director"],
  // 주문 처리 — 앱 게이트 `canProcessOrders` 의 역할 부분(개인 부여는 따로).
  order_processor: ["developer_super_admin", "owner", "senior_managing_director", "office_admin", "cs_staff"],
};

describe("역할 × 기능 표 (권한 정리 ③)", () => {
  for (const [capability, allowed] of Object.entries(EXPECTED) as [Capability, readonly string[]][]) {
    it(capability, () => {
      const actual = roles.filter((role) => roleCan(role, capability));
      expect(actual).toEqual(roles.filter((role) => allowed.includes(role)));
    });
  }

  it("역할로만 정한 키는 개인 부여 · 차단이 닫혀 있다(열면 RLS 도 같이 — 3b)", () => {
    for (const capability of Object.keys(EXPECTED) as Capability[]) {
      if (capability === "order_processor" || capability === "ops_calendar.write") continue;
      expect(CAPABILITIES[capability].individualGrant, capability).toBe(false);
      expect(CAPABILITIES[capability].individualDeny, capability).toBe(false);
    }
  });

  it("DB 조회용 역할 목록은 개발자를 빼고 전무를 넣는다", () => {
    expect(rolesWithCapability("bug.review")).toEqual(["owner", "senior_managing_director", "office_admin"]);
    expect(rolesWithCapability("cleaning.work")).not.toContain("developer_super_admin");
  });
  it("판매 캘린더 바꾸기는 보기와 기본 역할이 같다(5-1 — 오늘 쓰는 사람은 그대로)", () => {
    for (const role of roles) expect(roleCan(role, "ops_calendar.write"), role).toBe(roleCan(role, "ops_admin.access"));
  });
});
