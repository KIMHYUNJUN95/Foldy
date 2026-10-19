import "server-only";

import { isOrgTopAdmin } from "@/config/roles";
import type { Role } from "@/config/roles";
import { hasPermissionOverride } from "@/lib/permission-overrides-server";

// Roles that may approve / process / reject order requests.
// Order status processing (approve / order / reject) is office-level only — NOT field_manager/staff.
// Source of truth: docs/product/10-order-request-workflow.md → "Status Change Permission"
// (developer_super_admin / owner / office_admin / cs_staff; field_manager·staff·part_time_staff
// cannot process status) and docs/engineering/05-rls-permissions.md → order_requests → "Process status".
//
// This used to be `[...adminWebRoles]`, which contradicted its own comment: `adminWebRoles` gained
// `field_manager` and `staff` on 2026-07-13 (admin-web access ≠ order processing), so `staff` passed
// the app gate and then failed silently in the DB (the RLS UPDATE policy has no `staff`).
// `senior_managing_director` is owner-equivalent (isOrgTopAdmin / has_org_role, migration 202607130003).
const ORDER_PROCESSOR_ROLES: readonly Role[] = [
  "developer_super_admin",
  "owner",
  "senior_managing_director",
  "office_admin",
  "cs_staff",
];

/**
 * 역할 게이트 + 권한 예외(override). `order_processor` 오버라이드는 RLS에는 이미 반영돼 있는데
 * (마이그레이션 202607130004) 앱 게이트가 먼저 거절해서 부여해도 아무 변화가 없었다.
 * 조회 패턴은 `can_generate_report`(src/app/mobile/tasks/report-actions.ts)와 같다.
 */
export async function canProcessOrders(
  organizationId: string,
  userId: string,
  role: Role,
): Promise<boolean> {
  if (isOrgTopAdmin(role) || ORDER_PROCESSOR_ROLES.includes(role)) return true;
  return hasPermissionOverride(organizationId, userId, "order_processor");
}
