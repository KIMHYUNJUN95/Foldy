import "server-only";

import type { Role } from "@/config/roles";
import { memberCapabilities } from "@/lib/capabilities-server";

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
  // 역할 부분은 권한 키 `order_processor` 의 역할 기본값(2026-10-20 레지스트리로 옮김 — 대표 · 전무 · 오피스 · CS · 개발자. 현장 관리자 · 직원 ·
  // 파트타임은 불가: docs/product/10-order-request-workflow.md → "Status Change Permission", DB 트리거 202610190006 과 같다).
  // 역할 기본 + 개인 부여 · 차단을 함께 본다(2026-10-21 — 예전엔 부여만 보고 차단은 무시했다).
  void role;
  return (await memberCapabilities(organizationId, userId)).includes("order_processor");
}
