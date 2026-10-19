// 사용자 콘솔 변경 판정 — 순수 함수(서버 액션 · 화면이 같이 쓴다). DB 를 읽지 않는다.
// 설계: docs/product/17-user-profile-directory.md → 「보호 대상 · 마지막 대표 · 삭제/비활성 범위」

import { isOrgTopAdmin, type Role } from "@/config/roles";

export type TargetLock = "top" | "dev" | null;

/** 대상 계정의 보호 등급. 개발자(`platform_admins` 활성)가 대표급보다 우선한다. */
export function targetLock(target: { role: string; isDeveloper: boolean }): TargetLock {
  if (target.isDeveloper) return "dev";
  if (isOrgTopAdmin(target.role as Role)) return "top";
  return null;
}

/**
 * 보호 대상을 바꿀 수 있는가. 대표급(owner · 전무)은 그 조직의 대표급 또는 개발자만, 개발자 계정은 개발자만.
 * `user.manage` 위임만으로는 안 된다 — 위임받은 직원이 대표를 정지 · 강등 · 삭제할 수 있으면 위임이 권한 상승이 된다.
 */
export function canChangeTarget(
  actor: { isDeveloper: boolean; topAdminInOrg: boolean },
  lock: TargetLock,
): boolean {
  if (lock === "dev") return actor.isDeveloper;
  if (lock === "top") return actor.isDeveloper || actor.topAdminInOrg;
  return true;
}

/**
 * 이 변경이 조직의 마지막 활성 owner 를 없애는가. `activeOwnerCount` 는 대상 자신을 포함한 그 조직의 활성 owner 수.
 * 역할을 owner 가 아닌 것으로 바꾸거나, 활성이 아닌 상태로 바꾸거나, 삭제하면 owner 가 하나 줄어든다.
 */
export function removesLastOwner(input: {
  target: { role: string; status: string };
  change: { role?: string; status?: string; delete?: boolean };
  activeOwnerCount: number;
}): boolean {
  if (input.target.role !== "owner" || input.target.status !== "active") return false;
  const { change } = input;
  const staysOwner = !change.delete && (change.role ?? "owner") === "owner" && (change.status ?? "active") === "active";
  if (staysOwner) return false;
  return input.activeOwnerCount <= 1;
}

/**
 * 삭제 범위. 다른 조직 멤버십이 하나라도(상태 무관) 남으면 이 조직 멤버십만 지운다 — profile · 로그인 계정은
 * 다른 조직의 것이기도 하다. 다른 조직 멤버십이 없을 때만 계정 전체를 지운다.
 */
export function deleteScope(otherOrgMembershipCount: number): "membership" | "account" {
  return otherOrgMembershipCount > 0 ? "membership" : "account";
}

/**
 * 로그인 차단(auth ban) 처리. 기준은 하나 — 「바뀐 뒤 어느 조직에도 활성 멤버십이 없으면 차단」.
 * 활성으로 바꾸면 활성 멤버십이 생기므로 항상 해제, 비활성으로 바꾸면 다른 조직에 활성 멤버십이 있을 때는
 * 로그인을 막지 않고(그 조직 일은 계속 해야 한다) 이 조직 멤버십 상태만 바꾼다.
 */
export function authBanAction(nextStatus: string, otherOrgActiveCount: number): "ban" | "unban" | "keep" {
  if (nextStatus === "active") return "unban";
  return otherOrgActiveCount > 0 ? "keep" : "ban";
}
