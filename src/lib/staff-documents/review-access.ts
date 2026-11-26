import "server-only";
import type { AppSession } from "@/lib/session";
import { actorCanManageUsersInOrg } from "@/lib/user-management-access";

/**
 * 재류카드 확인 · 다시 요청 · 관리자 대신 올리기의 문 — `staff_documents.view` + 사용자 관리(화면 문과 같다).
 * 두 액션(`account/id-card`, `actions/staff-documents`)이 같이 쓴다. docs/product/41 §4
 */
export async function canReviewStaffDocuments(session: Pick<AppSession, "capabilities" | "organization" | "user">): Promise<boolean> {
  if (!session.capabilities.includes("staff_documents.view")) return false;
  return actorCanManageUsersInOrg(session.user.id, session.user.role, session.organization.id);
}
