import type { Role } from "@/config/roles";

export type AppMode = "mobile" | "admin";

export type RouteAccess = {
  path: string;
  mode: AppMode;
  label: string;
  roles: readonly Role[];
};

const allRoles = [
  "developer_super_admin",
  "owner",
  "senior_managing_director",
  "office_admin",
  "cs_staff",
  "field_manager",
  "staff",
  "part_time_staff",
] as const satisfies readonly Role[];

const adminRoles = [
  "developer_super_admin",
  "owner",
  "senior_managing_director",
  "office_admin",
  "cs_staff",
] as const satisfies readonly Role[];

export const routeAccess = [
  {
    path: "/mobile",
    mode: "mobile",
    label: "모바일 홈",
    roles: allRoles,
  },
  {
    path: "/mobile/calendar",
    mode: "mobile",
    label: "모바일 캘린더",
    roles: allRoles,
  },
  {
    path: "/mobile/cleaning",
    mode: "mobile",
    label: "청소",
    roles: allRoles,
  },
  {
    path: "/mobile/requests",
    mode: "mobile",
    label: "요청",
    roles: allRoles,
  },
  {
    path: "/mobile/suggestions",
    mode: "mobile",
    label: "제안함",
    roles: allRoles,
  },
  {
    path: "/mobile/attendance",
    mode: "mobile",
    label: "근태",
    roles: allRoles,
  },
  {
    path: "/mobile/announcements",
    mode: "mobile",
    label: "공지",
    roles: allRoles,
  },
  {
    path: "/mobile/complaints",
    mode: "mobile",
    label: "게스트 피드백",
    roles: allRoles,
  },
  {
    path: "/admin",
    mode: "admin",
    label: "관리자 대시보드",
    roles: adminRoles,
  },
] as const satisfies readonly RouteAccess[];
