import type { AppSession } from "@/lib/session";

/**
 * 운영 관리자 영역 — 접근 판정과 화면 목록.
 *
 * 도메인 계약: docs/product/32-ops-admin-area.md
 *
 * ## 키 하나가 영역 전체를 연다
 *
 * 캘린더 쓰기 · 가동률 · 매출 · 전표 · 자동화를 기능별로 쪼개지 않는다(2026-09-16 확정).
 * 들어오는 사람이 사무실 직원 몇 명뿐이고, 들어왔으면 그 안의 기능을 전부 쓴다.
 * 나중에 쪼개야 하면 키를 추가하고 정책에 등록하면 된다 — **기능 코드는 이 파일만 본다.**
 */

/** 이 영역에 들어올 수 있는가. 다섯 화면이 전부 같은 답을 쓴다. */
export function canAccessOpsAdmin(session: AppSession): boolean {
  return session.capabilities.includes("ops_admin.access");
}

/**
 * 판매 캘린더를 **바꿀** 수 있는가 — 가격 · 최소숙박 · 차단 · 수기 예약 · 예약 수정 · 옮기기 · 취소 · 되돌리기 · 대기 가격 보내기.
 *
 * 2026-10-20 권한 정리 5-1 에서 위 「키 하나가 영역 전체」에서 쓰기만 떼었다(`ops_calendar.write`). 기본 역할은 `ops_admin.access` 와 같은
 * 대표 · 전무라 지금 쓰는 사람에게는 달라지는 게 없다. 나중에 「보기만 할 사람」에게 영역을 열어도 채널로 바로 나가는 쓰기는 잠겨 있게 하려는 것.
 * 없으면 판매 캘린더가 보기 전용(PC · 모바일), 서버 액션도 `forbidden`.
 */
export function canWriteOpsCalendar(session: AppSession): boolean {
  return canAccessOpsAdmin(session) && session.capabilities.includes("ops_calendar.write");
}

/**
 * 룸 링크(`/admin/ops/room-links`)를 쓸 수 있는가 — 운영 관리자 묶음에 있지만 **판매 캘린더와 따로 준다**
 * (2026-10-02 사용자 결정). 리스팅 확인은 가격을 만지지 않는 사람도 한다. docs/product/35-room-links.md
 */
export function canAccessRoomLinks(session: AppSession): boolean {
  return session.capabilities.includes("room_links.access");
}

/**
 * 영역 안의 화면.
 *
 * **다섯 개가 나란히 놓인 독립 화면**이고 캘린더 안의 탭이 아니다. 캘린더는 *파는 곳*이고
 * 지표는 *본 결과*라 하는 일도, 보는 주기도, 위험도 다르다. 섞으면 「지표 보러 들어갔다가
 * 가격을 만지는」 사고가 나고, 화면이 무거워져 모바일에서 먼저 망가진다 — 저쪽 원본
 * `BuildingCalendar.jsx` 가 11,672줄이 된 경로가 이것이다.
 */
export const OPS_ADMIN_SCREENS = [
  "calendar",
  "occupancy",
  "revenue",
  "ledger",
  "automation",
] as const;

export type OpsAdminScreen = (typeof OPS_ADMIN_SCREENS)[number];

/**
 * 사이드바 `activeItem` 값.
 *
 * 반환형을 `string` 이 아니라 템플릿 리터럴로 좁힌다 — `AdminShell` 의 `activeItem` 은
 * `adminNavigation` 의 id 유니온이라, 넓히면 **오타가 타입 검사에 안 걸린다.**
 */
export type OpsNavId = `ops-${OpsAdminScreen}`;

export function opsNavId(screen: OpsAdminScreen): OpsNavId {
  return `ops-${screen}`;
}
