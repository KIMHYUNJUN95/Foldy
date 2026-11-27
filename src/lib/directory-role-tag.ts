/**
 * 직원 목록 줄의 이름 옆 역할 글자(2026-11-27 unslop). 묶음 이름(관리 · 사무실 / 현장 / 아르바이트)과 겹치는 말은 빼고
 * 역할 코드 기준으로 남은 말만 — 문자열 자르기는 en(「Part-timer」 ↔ 「Part-time」)에서 깨진다.
 * 개발자처럼 기본 역할 이름이 아닌 표시(`isOverride`)는 그대로 보인다.
 */
export function directoryRoleTag(
  role: string,
  roleLabel: string,
  isOverride: boolean,
  short: { fieldManager: string; partLeader: string },
): string {
  if (isOverride) return roleLabel;
  if (role === "part_time_staff") return "";
  if (role === "field_manager") return short.fieldManager;
  if (role === "staff") return short.partLeader;
  return roleLabel;
}
