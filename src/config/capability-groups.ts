import type { Capability } from "@/config/capabilities";

/**
 * 사용자 화면의 권한 토글 묶음(2026-10-22) — 36줄이 한 줄로 내려와 관리가 어려웠다(사용자). PC(`users-console`)와
 * 모바일(`mobile-member-detail`)이 이 순서 · 묶음을 그대로 쓴다. 새 권한 키를 만들면 여기 한 묶음에 넣는다
 * (`capability-groups.test.ts` 가 빠진 키를 잡는다). 묶음 이름은 `dictionary.admin.users.console.permGroups`.
 */
export const CAPABILITY_GROUPS = [
  { id: "access", keys: ["admin_web.access", "user.manage"] },
  {
    id: "attendance",
    keys: [
      "attendance.manage",
      "attendance.settings",
      "payroll.view",
      "payroll.manage",
      "payroll.approve",
      "wages.manage",
      "transport.manage",
      "leave.approve",
      "can_generate_report",
    ],
  },
  { id: "cleaning", keys: ["cleaning.work", "cleaning.read_all", "cleaning.assign", "cleaning.assign_swap", "cleaning.force_complete", "linen.manage"] },
  { id: "requests", keys: ["maintenance_status_change", "lost_found.handle", "order_processor", "request.delete_any"] },
  { id: "comms", keys: ["announcement.create", "announcement.manage", "board.manage", "board.moderate", "bug.review"] },
  { id: "guest", keys: ["complaint.write", "complaint.manage", "complaint.comment", "property_info.edit"] },
  { id: "ops", keys: ["ops_admin.access", "ops_calendar.write", "room_links.access", "automation.manage"] },
  { id: "recruit", keys: ["job_application.read", "job_application.triage", "job_application.delete", "staff_documents.view"] },
] as const satisfies readonly { id: string; keys: readonly Capability[] }[];

export type CapabilityGroupId = (typeof CAPABILITY_GROUPS)[number]["id"];

/**
 * 사용자 화면에 그리지 않는 키 — 쓰는 화면이 없다(2026-10-22 점검). `property_room_manage` 는 건물 · 객실 표 DB 쓰기만 여는데
 * 그 화면이 없다(건물 · 객실은 Beds24 동기화로 들어온다). DB 권한은 남긴다 — 편집 화면을 만들면 여기서 뺀다.
 */
export const HIDDEN_CAPABILITIES: readonly Capability[] = ["property_room_manage"];

/** 이 키가 들어간 묶음. 「개발자 지정」 줄처럼 키가 아닌 줄은 `access` 로. */
export function capabilityGroupOf(key: string): CapabilityGroupId {
  return CAPABILITY_GROUPS.find((group) => (group.keys as readonly string[]).includes(key))?.id ?? "access";
}

/** 줄 목록을 묶음 순서대로 나눈다(빈 묶음은 뺀다). 묶음 안 순서는 위 `keys` 순서. */
export function groupPermissionRows<T extends { id: string }>(rows: readonly T[]): { id: CapabilityGroupId; rows: T[] }[] {
  return CAPABILITY_GROUPS.map((group) => {
    const order = group.keys as readonly string[];
    const mine = rows.filter((row) => capabilityGroupOf(row.id) === group.id);
    mine.sort((a, b) => {
      const ia = order.indexOf(a.id);
      const ib = order.indexOf(b.id);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    return { id: group.id, rows: mine };
  }).filter((group) => group.rows.length > 0);
}
