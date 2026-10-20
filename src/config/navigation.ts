import {
  CalendarRange,
  DoorOpen,
  BedDouble,
  Bell,
  BellRing,
  Flag,
  BookText,
  Building2,
  ListChecks,
  CalendarCheck2,
  CalendarCog,
  CalendarDays,
  ChartPie,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  Gauge,
  House,
  Inbox,
  Link2,
  Bug,
  Megaphone,
  MessageSquareWarning,
  Newspaper,
  Package,
  Recycle,
  Settings,
  Sparkles,
  SprayCan,
  TrendingUp,
  Undo2,
  UserCog,
  UserSearch,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { Capability } from "@/config/capabilities";
import {
  getLocalizedText,
  localizedNavigationLabels,
  type Locale,
  type LocalizedText,
} from "@/lib/i18n";

export type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type NavigationItem = {
  id: string;
  label: LocalizedText;
  /**
   * 하단 탭바 **전용** 축약 라벨. 없으면 `label` 을 쓴다.
   *
   * 탭은 10.5px 글자에 폭이 ~72px뿐이라 긴 이름이 줄바꿈돼 탭바 높이를 밀어낸다. 그렇다고
   * 축약형을 `label` 자체로 두면 **폭이 넉넉한 사이드 메뉴까지** 줄어든 이름을 쓰게 된다 —
   * 실제로 「게스트 피드백」이 사이드 메뉴에서도 「피드백」으로 나오고 있었다(2026-08-11).
   * 좁은 자리의 제약이 넓은 자리의 이름을 깎지 않도록 둘을 분리한다.
   */
  shortLabel?: LocalizedText;
  href: string;
  icon: NavigationIcon;
  /**
   * 이 메뉴를 보려면 필요한 권한 키.
   *
   * 없으면 어드민 웹에 들어올 수 있는 전원에게 보인다 — 대부분의 페이지가 그렇다(별도 게이트가
   * 없으므로 숨기면 오히려 틀린다).
   *
   * **역할 배열을 여기 적지 않는다.** 적는 순간 「누가 이 기능을 쓸 수 있는가」의 정의가 페이지
   * 게이트와 내비 두 곳이 되고, 반드시 갈라진다. 권한 키만 참조한다
   * (`docs/engineering/14-permission-architecture.md`).
   *
   * 필터는 UX일 뿐 보안이 아니다. `AdminShell` 은 클라이언트 컴포넌트라 메뉴 목록 자체는 번들에
   * 들어 있고, 실제 차단은 페이지·서버 액션·RLS 가 한다.
   */
  capability?: Capability;
};

const mobileNavHome = {
  id: "home",
  label: localizedNavigationLabels.mobile.home,
  href: "/mobile",
  icon: House,
} as const satisfies NavigationItem;

const mobileNavCalendar = {
  id: "calendar",
  label: localizedNavigationLabels.mobile.calendar,
  href: "/mobile/calendar",
  icon: CalendarCheck2,
} as const satisfies NavigationItem;

// 판매 캘린더(운영 관리자) — `ops_admin.access` 보유자에게만 보인다. 데스크톱 `/admin/ops/calendar` 의 모바일판.
// See docs/product/33-calendar-write-features.md → 「모바일 판매 캘린더」.
const mobileNavOpsCalendar = {
  id: "ops-calendar",
  label: localizedNavigationLabels.mobile.opsCalendar,
  shortLabel: localizedNavigationLabels.mobile.opsCalendarShort,
  href: "/mobile/ops/calendar",
  icon: CalendarCog,
  capability: "ops_admin.access",
} as const satisfies NavigationItem;

// 룸 링크(운영 관리자 구역) — `room_links.access` 보유자에게만. 데스크톱 `/admin/ops/room-links` 의 모바일판(보기 · 열기 ·
// 복사, 고치기는 대시보드). See docs/product/35-room-links.md → 「모바일」.
const mobileNavRoomLinks = {
  id: "ops-room-links",
  label: localizedNavigationLabels.mobile.roomLinks,
  shortLabel: localizedNavigationLabels.mobile.roomLinksShort,
  href: "/mobile/ops/room-links",
  icon: Link2,
  capability: "room_links.access",
} as const satisfies NavigationItem;

// 가동률(운영 관리자) — 데스크톱 `/admin/ops/occupancy` 의 모바일 요약판(2026-10-15, 시안 Occ-Phone · Fold · Tablet).
// 데스크톱 페이지가 관리자 웹 역할 + `ops_admin.access` 를 둘 다 요구하므로 모바일도 같다(`MOBILE_ADMIN_WEB_ONLY_IDS`).
// See docs/product/34-metrics-and-automation.md → 「모바일 가동률」.
const mobileNavOpsOccupancy = {
  id: "ops-occupancy",
  label: localizedNavigationLabels.mobile.opsOccupancy,
  href: "/mobile/ops/occupancy",
  icon: ChartPie,
  capability: "ops_admin.access",
} as const satisfies NavigationItem;

// 매출(운영 관리자) — 데스크톱 `/admin/ops/revenue` 의 모바일 요약판(2026-10-15, 시안 Rev-Phone · Fold · Tablet).
// 권한은 가동률과 같다 — 관리자 웹 역할 + `ops_admin.access`(`MOBILE_ADMIN_WEB_ONLY_IDS`). 아이콘은 데스크톱 매출과 같은 TrendingUp.
// See docs/product/34-metrics-and-automation.md → 「모바일 매출」.
const mobileNavOpsRevenue = {
  id: "ops-revenue",
  label: localizedNavigationLabels.mobile.opsRevenue,
  href: "/mobile/ops/revenue",
  icon: TrendingUp,
  capability: "ops_admin.access",
} as const satisfies NavigationItem;

// 자동화(운영 관리자) — 데스크톱 `/admin/ops/automation` 의 모바일판(2026-10-15, 시안 AutoM-Phone · Fold · Tablet).
// 모바일에서도 PC 와 같은 일을 다 한다(켜기 · 미리보기 · 지금 보내기 · 실행 기록 · 설정 · 담당자). 권한은 가동률 · 매출과 같다 —
// 관리자 웹 역할 + `ops_admin.access`(`MOBILE_ADMIN_WEB_ONLY_IDS`), 설정 · 발송은 서버 액션이 `automation.manage` 를 다시 본다.
// 아이콘은 데스크톱 자동화와 같은 Zap. See docs/product/36-automation-control.md → 「모바일 자동화」.
const mobileNavOpsAutomation = {
  id: "ops-automation",
  label: localizedNavigationLabels.mobile.opsAutomation,
  href: "/mobile/ops/automation",
  icon: Zap,
  capability: "ops_admin.access",
} as const satisfies NavigationItem;

const mobileNavCleaning = {
  id: "cleaning",
  label: localizedNavigationLabels.mobile.cleaning,
  href: "/mobile/cleaning",
  icon: Sparkles,
} as const satisfies NavigationItem;

// 내 시프트 · 오늘 내 방(2026-10-20) — 알바가 일할 날을 신청하고, 배정된 방을 본다. 청소 작업자(`cleaning.work`)만.
// See docs/product/37-cleaning-shift-assignment.md.
const mobileNavShift = {
  id: "shift",
  label: localizedNavigationLabels.mobile.shift,
  href: "/mobile/shift",
  icon: CalendarRange,
  capability: "cleaning.work",
} as const satisfies NavigationItem;

const mobileNavMyRooms = {
  id: "my-rooms",
  label: localizedNavigationLabels.mobile.myRooms,
  href: "/mobile/shift/today",
  icon: DoorOpen,
  capability: "cleaning.work",
} as const satisfies NavigationItem;

const mobileNavRequests = {
  id: "requests",
  label: localizedNavigationLabels.mobile.requests,
  href: "/mobile/requests",
  icon: ClipboardCheck,
} as const satisfies NavigationItem;

const mobileNavAnnouncements = {
  id: "announcements",
  label: localizedNavigationLabels.mobile.announcements,
  href: "/mobile/announcements",
  icon: BellRing,
} as const satisfies NavigationItem;

// Linen Return lives in the side menu (and the pinnable bottom-bar pool), not as a
// default bottom tab. See docs/product/19-linen-defect-workflow.md.
const mobileNavLinenReturn = {
  id: "linen-return",
  label: localizedNavigationLabels.mobile.linenReturn,
  href: "/mobile/linen-return",
  icon: BedDouble,
} as const satisfies NavigationItem;

// Todo / Shared Task — side-menu entry + pinnable bottom-bar candidate.
// See docs/product/18-todo-task-workflow.md.
const mobileNavTasks = {
  id: "tasks",
  label: localizedNavigationLabels.mobile.tasks,
  href: "/mobile/tasks",
  icon: ListChecks,
} as const satisfies NavigationItem;

// Staff Suggestions / Feedback Box — side-menu entry + pinnable bottom-bar candidate.
// See docs/product/22-staff-suggestions-workflow.md.
const mobileNavSuggestions = {
  id: "suggestions",
  label: localizedNavigationLabels.mobile.suggestions,
  href: "/mobile/suggestions",
  icon: Inbox,
} as const satisfies NavigationItem;

// Board / 게시판 — free bulletin board for all staff. See docs/product/23-board-workflow.md.
const mobileNavBoard = {
  id: "board",
  label: localizedNavigationLabels.mobile.board,
  href: "/mobile/board",
  icon: Newspaper,
} as const satisfies NavigationItem;

// Bug Report — internal product/system issue reporting. Intentionally NOT in the side-menu nav
// list (nor the pinnable bottom-bar pool): it is a utility surfaced in the sidebar footer next to
// Logout. See docs/product/25-bug-report-workflow.md + docs/product/16-mobile-navigation.md.
export const mobileNavBugs = {
  id: "bugs",
  label: localizedNavigationLabels.mobile.bugs,
  href: "/mobile/bugs",
  icon: Bug,
} as const satisfies NavigationItem;

// Attendance / 근태 (clock-in/out, live timer, capture) — implemented side-menu entry + pinnable
// bottom-bar candidate. See docs/product/24-attendance-workflow.md.
const mobileNavAttendance = {
  id: "attendance",
  label: localizedNavigationLabels.mobile.attendance,
  href: "/mobile/attendance",
  icon: Clock,
} as const satisfies NavigationItem;

// Complaints / 컴플레인 — implemented manual complaint + external-review workspace. Side-menu entry
// + pinnable bottom-bar candidate. See docs/product/25-complaint-workflow.md.
const mobileNavComplaints = {
  id: "complaints",
  label: localizedNavigationLabels.mobile.complaints,
  shortLabel: localizedNavigationLabels.mobile.complaintsShort,
  href: "/mobile/complaints",
  icon: MessageSquareWarning,
} as const satisfies NavigationItem;

// Bottom tab bar uses a center action ("추가") button, so it holds only 4 tabs.
// "Cleaning" intentionally lives in the side menu (hamburger) instead of the bottom bar.
export const mobileBottomNavigation = [
  mobileNavHome,
  mobileNavCalendar,
  mobileNavRequests,
  mobileNavAnnouncements,
] as const satisfies readonly NavigationItem[];

// Operational ordering: 진입점 → 일일 코어(예약·청소·할일·요청·근태) → 커뮤니케이션(공지·게시판·제안함)
// → 참조(린넨 반품·직원 목록). Bug Report is intentionally excluded (sidebar footer, next to Logout).
export const mobileSidebarNavigation = [
  mobileNavHome,
  mobileNavCalendar,
  mobileNavCleaning,
  mobileNavShift,
  mobileNavMyRooms,
  mobileNavTasks,
  mobileNavRequests,
  mobileNavAttendance,
  mobileNavAnnouncements,
  mobileNavBoard,
  mobileNavSuggestions,
  mobileNavComplaints,
  mobileNavLinenReturn,
  {
    id: "directory",
    label: localizedNavigationLabels.mobile.directory,
    href: "/mobile/directory",
    icon: Users,
  },
  // 사용자 관리(2026-10-20) — 데스크톱 `/admin/users` 의 모바일판(멤버 · 권한 · 초대코드). 대시보드 메뉴와 같은 키
  // `user.manage`(개발자 + 위임받은 사람)로만 보인다. See docs/product/17-user-profile-directory.md → 「모바일 사용자 관리」.
  {
    id: "users",
    label: localizedNavigationLabels.mobile.users,
    href: "/mobile/users",
    icon: UserCog,
    capability: "user.manage",
  },
] as const satisfies readonly NavigationItem[];

/**
 * 운영 관리자 메뉴(모바일) — **일반 메뉴와 섞지 않는다**(2026-10-01 사용자 지시). 데스크톱 사이드바가 「운영 관리자」
 * 묶음을 맨 아래 따로 두는 것과 같다(`adminNavGroupOf` → `ops`). 사이드 메뉴 아래쪽에 제목을 단 별도 구역으로 그린다.
 * 하단 탭 편집 후보에는 **넣는다**(2026-10-02 사용자 지시 — 판매 캘린더를 탭에 고정) — 후보 목록 맨 뒤. 권한이 없으면
 * 사이드 구역째 · 후보에서도 사라진다(셸의 `canSeeMobileNavItem`).
 */
export const mobileOpsAdminNavigation = [
  mobileNavOpsOccupancy,
  mobileNavOpsRevenue,
  mobileNavOpsAutomation,
  mobileNavOpsCalendar,
  mobileNavRoomLinks,
] as const satisfies readonly NavigationItem[];

// ── Per-user bottom-bar customization ────────────────────────────────────────
// The center FAB opens an editor where each user picks which features sit in
// their mobile bottom tab bar. The selectable pool is the mobile side menu, and
// the chosen ids are persisted per user (profiles.bottom_nav_tabs).

/** Maximum number of user-pinned bottom tabs (the center FAB is always shown). */
export const MAX_BOTTOM_NAV_TABS = 4;

/** Default bottom-bar tab ids for a new/unset user. */
export const defaultBottomNavTabIds = [
  "home",
  "calendar",
  "requests",
  "announcements",
] as const satisfies readonly string[];

/** Features a user may pin to the bottom bar (the side menu + the ops-admin section, filtered per user). */
export const customizableBottomNavItems = [
  ...mobileSidebarNavigation,
  ...mobileOpsAdminNavigation,
] as const satisfies readonly NavigationItem[];

/**
 * 권한 키에 더해 **관리자 웹 역할**도 요구하는 운영 관리자 항목인가(셸이 함께 거른다).
 *
 * 판매 캘린더는 쓰기 액션이 관리자 세션을 거쳐 역할도 본다. 가동률 · 매출 · 자동화는 데스크톱 페이지가 관리자 웹 역할을 요구해서 같다.
 * **룸 링크는 아니다** — 보기 · 열기 · 복사뿐이라 권한 키만
 * 받으면 현장 역할도 쓴다(2026-10-05, 사용자 상세에서 개인 부여).
 */
const MOBILE_ADMIN_WEB_ONLY_IDS: ReadonlySet<string> = new Set(["ops-calendar", "ops-occupancy", "ops-revenue", "ops-automation"]);
export function isMobileOpsAdminNavItem(id: string): boolean {
  return MOBILE_ADMIN_WEB_ONLY_IDS.has(id);
}

/**
 * 이 사람에게 보이는 내비 항목인가 — `capability` 가 없으면 전원, 있으면 그 권한 키를 가진 사람만.
 * UX 필터일 뿐이다(실제 차단은 페이지 · 서버 액션 · RLS).
 */
export function canSeeNavItem(item: object, capabilities: readonly string[] | null | undefined): boolean {
  const capability = (item as { capability?: Capability }).capability;
  return !capability || Boolean(capabilities?.includes(capability));
}

/** Resolve stored bottom-nav ids into ordered navigation items (max enforced). */
export function resolveBottomNavItems(
  ids: readonly string[] | null | undefined,
): NavigationItem[] {
  const byId = new Map<string, NavigationItem>(
    customizableBottomNavItems.map((item) => [item.id, item]),
  );
  const source = ids && ids.length > 0 ? ids : defaultBottomNavTabIds;
  const seen = new Set<string>();
  const resolved: NavigationItem[] = [];

  for (const id of source) {
    if (seen.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue;
    seen.add(id);
    resolved.push(item);
    if (resolved.length >= MAX_BOTTOM_NAV_TABS) break;
  }

  // Never render an empty bottom bar — fall back to defaults if nothing resolved.
  if (resolved.length === 0) {
    for (const id of defaultBottomNavTabIds) {
      const item = byId.get(id);
      if (item) resolved.push(item);
    }
  }

  return resolved;
}

/** Sanitize an arbitrary id list before persisting (valid, unique, capped). */
export function sanitizeBottomNavTabIds(ids: readonly string[]): string[] {
  const valid = new Set<string>(customizableBottomNavItems.map((item) => item.id));
  const seen = new Set<string>();
  const out: string[] = [];

  for (const id of ids) {
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_BOTTOM_NAV_TABS) break;
  }

  return out.length > 0 ? out : [...defaultBottomNavTabIds];
}

export const adminNavigation = [
  {
    id: "dashboard",
    label: localizedNavigationLabels.admin.dashboard,
    href: "/admin",
    icon: Gauge,
  },
  {
    id: "calendar",
    label: localizedNavigationLabels.admin.calendar,
    href: "/admin/calendar",
    icon: CalendarDays,
  },
  {
    id: "cleaning",
    label: localizedNavigationLabels.admin.cleaning,
    href: "/admin/cleaning",
    icon: SprayCan,
  },
  {
    // 청소 배정(2026-10-20) — 시프트 신청자를 그날 방에 넣기 · 월 배정 · 배정 설정 · 월 비교표. 배정 담당만.
    id: "cleaning-assign",
    capability: "cleaning.assign",
    label: localizedNavigationLabels.admin.cleaningAssign,
    href: "/admin/cleaning-assign",
    icon: CalendarRange,
  },
  {
    id: "maintenance",
    label: localizedNavigationLabels.admin.maintenance,
    href: "/admin/maintenance",
    icon: Wrench,
  },
  {
    id: "lost-found",
    label: localizedNavigationLabels.admin.lostFound,
    href: "/admin/lost-found",
    icon: Recycle,
  },
  {
    id: "linen-return",
    label: localizedNavigationLabels.admin.linenReturn,
    href: "/admin/linen-return",
    icon: Undo2,
  },
  {
    id: "orders",
    label: localizedNavigationLabels.admin.orders,
    href: "/admin/orders",
    icon: Package,
  },
  {
    id: "complaints",
    label: localizedNavigationLabels.admin.complaints,
    href: "/admin/complaints",
    icon: MessageSquareWarning,
  },
  {
    id: "recruit",
    // 지원서는 민감 개인정보다 — 대표·전무 + 지정된 개인만 본다(2026-09-10 결정).
    capability: "job_application.read",
    label: localizedNavigationLabels.admin.recruit,
    href: "/admin/recruit",
    icon: UserSearch,
  },
  {
    id: "announcements",
    label: localizedNavigationLabels.admin.announcements,
    href: "/admin/announcements",
    icon: Megaphone,
  },
  {
    // 게시판 신고 처리(2026-10-06, 앱 출시 준비) — 처리 권한자만. docs/product/23-board-workflow.md §12-C
    id: "board-reports",
    capability: "board.moderate",
    label: localizedNavigationLabels.admin.boardReports,
    href: "/admin/board-reports",
    icon: Flag,
  },
  {
    id: "recurring-work",
    label: localizedNavigationLabels.admin.recurringWork,
    href: "/admin/tasks",
    icon: Building2,
  },
  {
    id: "attendance",
    label: localizedNavigationLabels.admin.attendance,
    href: "/admin/attendance",
    icon: Clock,
  },
  {
    id: "users",
    // 원래부터 「지정된 개인만」인 화면이다(기본은 플랫폼 개발자, 개발자가 개인에게 위임).
    // 2026-09-10 이전에는 전원에게 메뉴가 보이고 누르면 튕겼다.
    capability: "user.manage",
    label: localizedNavigationLabels.admin.users,
    href: "/admin/users",
    icon: Users,
  },
  {
    id: "settings",
    label: localizedNavigationLabels.admin.settings,
    href: "/admin/settings",
    icon: Settings,
  },

  // ── 운영 관리자 ──────────────────────────────────────────────────────────
  //
  // STAY ARI Manager 에서 가져오는 5개 화면. **다섯 개가 나란히 놓인 독립 메뉴**이고,
  // 캘린더 안의 탭이 아니다 — 캘린더는 파는 곳이고 지표는 본 결과라 하는 일도 위험도 다르다
  // (docs/product/32-ops-admin-area.md → 「지표를 캘린더 안에 넣지 않는다」).
  //
  // 전부 같은 키 하나(`ops_admin.access`)로 열린다. 권한이 없으면 메뉴가 통째로 안 보인다.
  {
    id: "ops-calendar",
    capability: "ops_admin.access",
    label: localizedNavigationLabels.admin.opsCalendar,
    href: "/admin/ops/calendar",
    icon: CalendarCog,
  },
  {
    id: "ops-occupancy",
    capability: "ops_admin.access",
    label: localizedNavigationLabels.admin.opsOccupancy,
    href: "/admin/ops/occupancy",
    icon: TrendingUp,
  },
  {
    id: "ops-revenue",
    capability: "ops_admin.access",
    label: localizedNavigationLabels.admin.opsRevenue,
    href: "/admin/ops/revenue",
    icon: CircleDollarSign,
  },
  {
    id: "ops-ledger",
    capability: "ops_admin.access",
    label: localizedNavigationLabels.admin.opsLedger,
    href: "/admin/ops/ledger",
    icon: BookText,
  },
  {
    id: "ops-automation",
    capability: "ops_admin.access",
    label: localizedNavigationLabels.admin.opsAutomation,
    href: "/admin/ops/automation",
    icon: Zap,
  },
  // 룸 링크 — 객실별 Airbnb · Booking.com 리스팅 링크(2026-10-02). 운영 관리자 묶음에 있지만 **따로 준다**
  // (`room_links.access` — 사용자 상세에서 개인별로 부여). docs/product/35-room-links.md
  {
    id: "ops-room-links",
    capability: "room_links.access",
    label: localizedNavigationLabels.admin.opsRoomLinks,
    href: "/admin/ops/room-links",
    icon: Link2,
  },
] as const satisfies readonly NavigationItem[];

// Desktop console sidebar grouping — matches the design handoff: 운영 / 인력 / 정보.
// Maps each admin nav id to a group bucket; ids not listed fall under "operations".
// See docs/product/05-admin-web-ia.md → "Primary Navigation".
export type AdminNavGroupKey = "operations" | "people" | "info" | "ops";

export const adminNavGroupOf: Record<string, AdminNavGroupKey> = {
  // 운영 관리자 — 가격·매출을 다루는 소수만 본다. 권한이 없으면 묶음째 사라진다.
  "ops-calendar": "ops",
  "ops-occupancy": "ops",
  "ops-revenue": "ops",
  "ops-ledger": "ops",
  "ops-automation": "ops",
  "ops-room-links": "ops",
  // 운영
  dashboard: "operations",
  cleaning: "operations",
  "cleaning-assign": "operations",
  maintenance: "operations",
  "lost-found": "operations",
  "linen-return": "operations",
  orders: "operations",
  complaints: "operations",
  // 채용은 사람을 다루므로 「인력」 묶음이다 — 근태·사용자와 같은 자리.
  recruit: "people",
  // 인력
  attendance: "people",
  users: "people",
  // 정보
  calendar: "info",
  announcements: "info",
  "board-reports": "info",
  "recurring-work": "info",
  settings: "info",
};

// 운영 관리자는 **맨 아래**다. 매일 쓰는 화면이 위에 있어야 하고, 이쪽은 들어오는 사람이
// 몇 명뿐이라 위에 두면 대부분의 사용자에게 빈 자리만 남는다.
export const adminNavGroupOrder: readonly AdminNavGroupKey[] = [
  "operations",
  "people",
  "info",
  "ops",
];

export const utilityNavigation = [
  {
    id: "notifications",
    label: localizedNavigationLabels.utility.notifications,
    href: "/mobile/notifications",
    icon: Bell,
  },
] as const satisfies readonly NavigationItem[];

/**
 * 메뉴에 걸린 권한 키.
 *
 * `as const satisfies` 로 굳힌 배열은 항목마다 리터럴 타입이라 `item.capability` 를 직접 읽으면
 * 그 속성이 없는 항목에서 타입 에러가 난다. 넓은 타입으로 한 번 받아 읽는다.
 */
export function navigationCapability(item: NavigationItem): Capability | undefined {
  return item.capability;
}

export function getNavigationLabel(item: NavigationItem, locale: Locale) {
  const label = getLocalizedText(item.label, locale);
  if (label) {
    return label;
  }
  console.warn(`[navigation] missing localized label for "${item.id}"`);
  return item.id;
}

/**
 * 하단 탭바용 라벨 — 축약형이 있으면 그것, 없으면 정식 이름.
 *
 * **탭바에서만 쓴다.** 사이드 메뉴·탭 편집 시트·화면 제목은 `getNavigationLabel` 이다. 탭 폭이
 * 좁다는 이유로 다른 자리의 이름까지 줄이면 안 된다.
 */
export function getNavigationTabLabel(item: NavigationItem, locale: Locale) {
  const short = item.shortLabel ? getLocalizedText(item.shortLabel, locale) : "";
  return short || getNavigationLabel(item, locale);
}
