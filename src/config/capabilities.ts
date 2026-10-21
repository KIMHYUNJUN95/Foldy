import type { OrganizationRole, Role } from "@/config/roles";

/**
 * 권한 레지스트리 — 「누가 이 기능을 쓸 수 있는가」의 **유일한 정의처**.
 *
 * 설계 문서: `docs/engineering/14-permission-architecture.md`
 *
 * ## 왜 있는가
 *
 * 지금까지는 기능마다 역할 배열을 직접 적었다. 그래서 같은 규칙이 페이지 게이트 · 서버 액션 ·
 * RLS 정책(SQL) · 사이드바 **네 곳에 복사**됐고, 한쪽만 고쳐지는 사고가 반복됐다. 여기서는 기능이
 * 역할을 모른다 — 권한 키만 묻는다. 역할표는 이 파일에만 있다.
 *
 * ## 두 가지 부여 방식이 같은 장치 위에 있다
 *
 * - **역할별로 묶어 쓰는 기능**: `roles` 를 채운다.
 * - **지정된 사람만 쓰는 기능**: `roles: []` 로 두고 개인에게 부여한다.
 *
 * 나중에 방식을 바꿔도(역할 부여 → 개인 지정, 또는 그 반대) **기능 코드는 한 줄도 바뀌지 않는다.**
 *
 * ## 이 파일을 고치면
 *
 * `capability_roles` 시드 마이그레이션도 함께 갱신해야 한다. 손으로 맞추지 않는다 —
 * `src/lib/__tests__/capability-registry.test.ts` 가 불일치를 잡고, **붙여넣을 SQL 을 그대로
 * 출력해 준다**(생성은 `src/lib/capability-seed.ts`).
 */

/** 개인 부여·차단이 저장되는 방향. 차단이 부여를 이긴다(`evaluateCapability`). */
export type CapabilityEffect = "grant" | "deny";

export type CapabilityPolicy = {
  /**
   * 이 역할이면 기본으로 받는다.
   *
   * **빈 배열이면 「지정된 개인만」**이 된다 — 역할로는 아무도 받지 못하고 개인 부여로만 열린다.
   */
  roles: readonly OrganizationRole[];
  /** 개인에게 추가로 부여할 수 있는가. */
  individualGrant: boolean;
  /**
   * 역할로 받은 것을 개인에게서 뺄 수 있는가.
   *
   * `roles` 가 비어 있으면 뺄 대상이 없으므로 의미가 없다(테스트가 그 조합을 막는다).
   */
  individualDeny: boolean;
  /**
   * 켤 때 기한을 묻는가(기한 줄이 펼쳐진다).
   *
   * 원래는 「부여에 기한이 반드시 필요한가」였다(`27-permission-override-workflow.md` 의 「모든 부여는
   * 시한부」 결정). **2026-10-20 사용자 결정으로 무기한도 고를 수 있게 바뀌었다** — 기한 줄 맨 앞에
   * 「무기한」 칩이 있다. 그래서 이제는 「묻는가」만 정한다: 일시적 예외는 `true`(1주 · 1개월 · 3개월 ·
   * 날짜 · 무기한 중 고름), 상시 업무 지정(채용 담당자처럼 계속 그 일을 하는 사람)은 `false`(누르면 바로
   * 무기한으로 켜짐).
   */
  asksExpiry: boolean;
  /** 플랫폼 개발자(`developer_super_admin`)가 역할·부여와 무관하게 통과하는가. */
  platformBypass: boolean;
  /**
   * 개인 부여·차단의 대상이 아님을 넘어, **관리 화면에 노출조차 하지 않는다.**
   *
   * 권한 관리 자체가 이런 키다. 개인 지정으로 뺏고 줄 수 있게 두면 「아무도 권한을 관리할 수 없는」
   * 잠금 상태가 만들어진다.
   */
  systemOnly: boolean;
  /**
   * **개발자만 부여·회수할 수 있는 키.**
   *
   * 판정에는 영향이 없다(누가 가지는가가 아니라 **누가 줄 수 있는가**의 규칙이다). 그래서 SQL 로
   * 내리지 않고 서버 액션과 관리 화면에서만 본다.
   *
   * 사용자 관리 위임이 그렇다: 위임받은 사람이 다시 위임하면 권한이 무한히 번진다
   * (2026-07-13 결정 — 「위임자는 재위임하지 못한다」).
   */
  developerOnly: boolean;
};

/**
 * 권한 키는 `도메인.동작` 이다.
 *
 * 읽기와 쓰기를 나누는 이유: 「보기만 되는 사람」과 「처리까지 되는 사람」이 실제로 다르다. 나눠 두면
 * 나중에 쓸 수 있고, 안 나누면 나중에 나눌 때 이미 부여된 권한을 다시 배분해야 한다. 구분이 필요
 * 없는 기능은 키 하나만 두면 된다.
 */
export const CAPABILITIES = {
  /**
   * 권한 관리 — 개인 부여·차단을 다루는 권한.
   *
   * **개인 지정 대상이 아니다.** 역할로만 결정한다(§3-4 잠금 방지).
   */
  "permission.manage": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: true,
    platformBypass: true,
    systemOnly: true,
    developerOnly: false,
  },

  /**
   * 채용 지원서 — **대표·전무 + 지정된 개인**(2026-09-10 사용자 결정).
   *
   * 요구는 「사무직이든 현장직이든 지정된 소수」였다. 그래서 직군으로는 아무도 받지 않고
   * `office_admin` 자동 열람도 없앴다. 대표·전무만 남긴 이유는 **잠기지 않기 위해서**다 —
   * 지정 목록이 비면 아무도 못 보게 되고, 담당자를 지정할 사람도 그 화면을 봐야 할 때가 있다.
   *
   * 읽기·심사·삭제를 나눈 이유(실무 기준):
   * - 담당자에게는 **열람 + 심사**가 한 세트다. 훑고 분류하는 것이 이 콘솔이 하는 일 전부다.
   * - **삭제는 기본으로 주지 않는다.** 하드 삭제이고 이력서 파일까지 지운다 — 되돌릴 수 없는
   *   개인정보 파기다. 필요하면 개인 부여로 열 수 있게 두되, 담당자라고 자동으로 갖지는 않는다.
   *
   * 차단은 켜지 않는다. 역할로 받는 사람이 대표·전무뿐인데 그 둘은 차단 면역이라 뺄 대상이 없다.
   */
  "job_application.read": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  "job_application.triage": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  "job_application.delete": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },

  /**
   * 사용자 관리 화면(`/admin/users` · `/mobile/users`) — 대표 · 전무 + 개발자 + 위임받은 개인.
   *
   * 2026-07-13 모델은 「개발자가 기본, 개인에게 위임」이었다(`roles: []`). **2026-10-20 사용자 결정으로 대표 · 전무가 역할로 기본
   * 포함**된다 — 권한을 바꾸는 자격(`permission.manage`)은 이미 대표 · 전무에게 있는데 화면 입장권이 없어 개발자가 열어 줘야 했다
   * (권한 조사 ②). 위임(개인 부여)은 여전히 **개발자만** 줄 수 있다(`developerOnly` — 위임받은 사람이 다시 위임하면 번진다).
   * 보호 규칙은 그대로: 대표 · 전무 · 개발자 계정은 대표 · 전무 · 개발자만, 마지막 대표 보호, 자기 자신 불가(`user-management-guard.ts`).
   */
  "user.manage": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    // 위임받은 사람이 다시 위임하면 권한이 무한히 번진다(2026-07-13 결정).
    developerOnly: true,
  },

  /**
   * ## 기존 오버라이드 키 4개
   *
   * **이름을 바꾸지 않는다.** RLS 정책과 앱 코드가 이 문자열 그대로를 검사하고 있어
   * (`has_permission_override(org, uid, 'order_processor')` 등), 이름을 바꾸면 그 정책들을 함께
   * 고쳐야 한다. 5단계에서 기능을 옮길 때 정리한다.
   *
   * `roles` 는 **각 기능의 현재 RLS 정책에서 그대로 옮겨 적은 값**이다(2026-09-10 실측). 관리
   * 화면이 「역할로 받은 권한」을 보여줄 때 사실과 달라지면 안 되기 때문이다.
   */

  /**
   * 주문 처리(승인 · 주문 · 거절 · 배송일 · 관리자 메모). 처음엔 `order_requests` UPDATE 정책(행 단위)을 그대로 옮겨 field_manager 가
   * 들어 있었지만, 처리 칸은 사무실 쪽만 바꾼다 — 문서 10번 「Status Change Permission」 · 앱 게이트 `canProcessOrders` · DB 트리거
   * `enforce_order_request_processing`(202610190006) 셋 다 field_manager 를 뺀다. 그래서 **2026-10-20 여기서도 뺐다**(사용자 화면이
   * 「역할로 받음 · 켜짐」으로 잘못 보였다). 현장 관리자 중 맡길 사람은 개인 부여로.
   */
  order_processor: {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: true,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },

  /** `maintenance_reports` UPDATE 정책 — 수리 상태 바꾸기. 알바(아르바이트 · 리더)는 역할로 못 받는다(2026-10-21). */
  maintenance_status_change: {
    roles: [
      "owner",
      "senior_managing_director",
      "office_admin",
      "cs_staff",
      "field_manager",
    ],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: true,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },

  /**
   * `properties` / `rooms` 쓰기.
   *
   * 역할로는 아무도 받지 않는다 — 현재 정책이 **오버라이드 보유자와 플랫폼 관리자에게만** 쓰기를
   * 연다. 원래부터 「지정된 개인만」인 권한이다.
   */
  property_room_manage: {
    roles: [],
    individualGrant: true,
    individualDeny: false,
    asksExpiry: true,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },

  /**
   * 일일 업무일지 생성. RLS 가 아니라 앱 게이트다(`canGenerateDailyReport`).
   *
   * 알바(아르바이트 · 아르바이트 리더)를 뺀 전 역할이 기본으로 갖고, 필요한 알바에게 개인 부여한다(2026-10-21 리더도 알바 기본).
   */
  can_generate_report: {
    roles: [
      "owner",
      "senior_managing_director",
      "office_admin",
      "cs_staff",
      "field_manager",
    ],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: true,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },

  /**
   * 운영 관리자 영역(`/admin/ops/*`) — 가격·재고를 다루는 사무실 소수.
   *
   * **키 하나가 영역 전체를 연다**(2026-09-16 확정). 캘린더 쓰기 · 가동률 · 매출 · 전표 · 자동화를
   * 기능별로 쪼개지 않는다 — 들어오는 사람이 몇 명뿐이라 쪼개 봐야 관리 부담만 늘고, 「가격은
   * 되는데 재고는 안 되는」 상태가 실제 업무에 없다. 나중에 쪼개야 하면 키를 추가하면 된다.
   *
   * 여기서 바꾼 가격은 **에어비앤비·부킹닷컴에 그대로 나간다.** 우리 DB 가 틀어지는 것과는 급이
   * 다르다 — 그래서 역할로는 대표·전무만 받고, 나머지는 **개인 지정**으로만 연다.
   * 현장 직원은 역할로는 절대 들어오지 못한다.
   *
   * `asksExpiry: false` — 가격을 다루는 사람은 그 일을 계속 한다. 기한을 걸면 어느 날 조용히
   * 만료돼 그날 가격을 못 고친다(채용 담당자와 같은 이유).
   *
   * 차단은 켜지 않는다. 역할로 받는 사람이 대표·전무뿐인데 그 둘은 차단 면역이라 뺄 대상이 없다.
   *
   * 도메인 계약: docs/product/32-ops-admin-area.md
   */
  "ops_admin.access": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /**
   * 판매 캘린더 **바꾸기**(2026-10-20 권한 정리 5-1) — 가격 · 최소숙박 · 차단 · 수기 예약 · 예약 수정 · 옮기기 · 취소 · 되돌리기 · 대기 가격 보내기.
   * 보기는 `ops_admin.access`. 기본 역할이 같아(대표 · 전무) 지금과 달라지는 건 없다. 전부 서버 액션(service role · Beds24)이라 RLS 와
   * 상관없어 개인 부여 · 차단을 연다(「보되 못 바꾸는 사람」 · 「가격만 맡기는 사람」). docs/product/32-ops-admin-area.md
   */
  "ops_calendar.write": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /**
   * 룸 링크 — 객실별 Airbnb · Booking.com 리스팅 링크(호스트 편집 화면 · 손님용 링크) 보기 · 편집 (2026-10-02).
   *
   * 사이드바 맨 아래 「운영 관리자」 묶음에 있지만 **판매 캘린더와 따로 준다**(사용자 결정 — 「이것도 사용자에서
   * 권한별로 똑같이 줄지 말지 정할 수 있어야 한다」). 리스팅을 확인하는 일은 가격을 만지지 않는 사람도 하기 때문이다.
   * 정책은 `ops_admin.access` 와 같다 — 대표 · 전무는 역할로, 나머지는 개인 지정, 기한 없음, 차단 없음.
   *
   * 도메인 계약: docs/product/35-room-links.md
   */
  "room_links.access": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /**
   * 자동화 관제실 — 설정 변경 · 발송 토글 · 지금 보내기 · 정정본 · 청소 명단 담당자 이름 입력 (2026-10-06).
   *
   * 보기는 `ops_admin.access` 로 충분하다. 실제로 Slack 에 나가는 것을 바꾸는 일은 **사용자가 지정한 사람만** 한다
   * (사용자 결정 — 「중요한 사람만 건드려야 해, 내가 권한을 준 사람만」). 그래서 역할 기본 부여가 없다(`roles: []`) —
   * 대표 · 전무도 개인 부여를 받아야 한다. 개발자는 `platformBypass` 로 통과해 잠기지 않는다. 상시 업무라 기한 없음.
   *
   * 도메인 계약: docs/product/36-automation-control.md
   */
  "automation.manage": {
    roles: [],
    individualGrant: true,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /**
   * 게시판 신고 처리 — 대기 신고 보기 · 「삭제」 / 「문제없음」 (2026-10-06, 앱 출시 준비 B4).
   *
   * 역할은 지금 남의 게시글을 지울 수 있는 owner · office_admin 과 같다(사용자 결정). 다른 사람에게 맡길 수 있게
   * 개인 부여를 열고, office_admin 중 빼고 싶은 사람이 있을 수 있어 차단도 연다. 상시 업무라 기한은 없다.
   *
   * 도메인 계약: docs/product/23-board-workflow.md §12-C
   */
  "board.moderate": {
    roles: ["owner", "office_admin"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },

  // ── 역할로만 정해지는 기능 게이트 (2026-10-20 권한 정리 ③) ─────────────────────────────────────────
  //
  // 예전엔 기능 파일마다 역할 목록을 따로 들고 있었다(15곳 남짓) — 「전무 = 대표」 규칙이 여섯 곳에서 빠진 원인. 이제 여기 한 곳에
  // 두고 기능 코드는 `roleCan(role, key)` 로 본다. **옮기기만 했다 — 누가 무엇을 할 수 있는지는 그대로**(`role-matrix.test.ts` 가
  // 옮기기 전 목록을 못박는다). 개인 부여 · 차단은 닫아 둔다: 열면 RLS(역할 배열)도 같이 고쳐야 「앱은 허용, DB 는 거부」가 안 생긴다.
  // 열 때는 키 하나씩(3b). `platformBypass` 는 전부 켠다 — 「개발자는 모든 권한」(2026-09-10 사용자 결정). 예전 목록 중 공지 전체 관리 ·
  // 린넨 · 버그 검토 · 게시판 관리 넷은 개발자가 빠져 있었는데(앞의 하나는 따로 통과시켰다) 이번에 그 결정에 맞췄다 — 바뀐 건 개발자뿐.
  /** 공지 작성 — 알바(아르바이트 · 리더) 빼고 전부(예전 `announcementCreatorRoles`). docs/product/11-announcement-workflow.md */
  "announcement.create": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 남이 쓴 공지 상태 변경 · 삭제(예전 `TOP_ADMIN_ROLES`, 멤버십 역할로 본다 — 개발자는 따로 통과). */
  "announcement.manage": {
    roles: ["owner", "senior_managing_director", "office_admin"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 청소 작업자 — 모바일 청소 · 청소 담당자 고르기 목록(예전 `cleaningMobileAccessRoles`). docs/product/07-cleaning-workflow.md */
  "cleaning.work": {
    roles: ["owner", "senior_managing_director", "field_manager", "staff", "part_time_staff"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 남의 청소 기록 보기(예전 `cleaningReadAllRoles` · `cleaningRecordViewerRoles` — 같은 목록 둘이 합쳐졌다). */
  "cleaning.read_all": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /**
   * 청소 배정(2026-10-20) — 시프트 신청자를 그날 방에 넣기 · 배정 설정(제안 규칙 · 건물별 고정 인력 · 사람별) · 대신 넣기 ·
   * 취소 요청 처리 · 못 한 방 미루기. 배정 담당이 건물마다 2명 정도라 역할 기본값에 개인 부여 · 차단을 연다.
   * 2026-10-21 — 사무실도 배정한다(오피스 관리자 기본 추가, CS 는 안 함). 사무실 알바 리더는 사람마다 켠다.
   * docs/product/37-cleaning-shift-assignment.md
   */
  "cleaning.assign": {
    roles: ["owner", "senior_managing_director", "office_admin", "field_manager"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 청소 강제 완료(예전 `cleaningForceCompleteRoles`). */
  "cleaning.force_complete": {
    roles: ["owner", "senior_managing_director", "office_admin", "field_manager"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 린넨 반품 기록을 남의 것까지 고치기 · 지우기(예전 `ADMIN_CAPABLE_ROLES` 두 곳). docs/product/19-linen-defect-workflow.md */
  "linen.manage": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 건물 운영 정보(출입 · 비밀번호 등) 편집(예전 `PROPERTY_OPERATION_INFO_EDITOR_ROLES`). docs/product/15-reservation-calendar.md */
  "property_info.edit": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 게스트 피드백 작성(예전 `WRITE_COMPLAINT_ROLES`). docs/product/25-complaint-workflow.md */
  "complaint.write": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 게스트 피드백 상태 변경 · 삭제(남의 것까지, 예전 `COMPLAINT_ADMIN_ROLES`). */
  "complaint.manage": {
    roles: ["owner", "senior_managing_director", "office_admin"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 게스트 피드백 댓글 — 알바(아르바이트 · 리더)가 빠진다(예전 `NO_COMMENT_ROLES` 의 반대). */
  "complaint.comment": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 남이 쓴 요청(수리 · 분실물 · 주문) 삭제(예전 `DELETE_ANY_ROLES` 네 곳). docs/product/10 · 08 · 09 */
  "request.delete_any": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 버그 신고 검토 · 새 신고 알림 받기(예전 `REVIEWER_ROLES` · `BUG_REPORT_REVIEWER_ROLES`). docs/product/25-bug-report-workflow.md */
  "bug.review": {
    roles: ["owner", "senior_managing_director", "office_admin"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 게시판 남의 글 · 댓글 삭제 · 고정(예전 `MANAGER_ROLES` 두 곳). 신고 처리 `board.moderate` 와는 따로다. docs/product/23-board-workflow.md */
  "board.manage": {
    roles: ["owner", "senior_managing_director", "office_admin"],
    individualGrant: false,
    individualDeny: false,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },

  // ── 2026-10-21 역할 = 기본 틀, 대표 · 전무 · 개발자가 사람마다 켜고 끈다 ──────────────────────────────
  // 역할 이름 · 따로 붙은 표시(급여 담당 · 연차 결재자)로 고정돼 있던 것을 키로 옮겼다. 근태와 급여는 나눴다 —
  // 근태를 넘겨받은 아르바이트 리더에게 동료 급여까지 보이면 안 된다. docs/product/27-permission-override-workflow.md

  /** 관리자 웹 들어가기(+ 관리 ↔ 현장 모드 전환). 예전 `adminWebRoles`. 알바(아르바이트 · 리더)는 역할로 못 받는다 — 사무실을 돕는 리더는 사람마다 켠다(2026-10-21). */
  "admin_web.access": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 근태 관리 — 전체 출퇴근 보기 · 정정 승인/거절 · 수기 입력 · 근무 수정/무효 · 변경 기록. 금액은 안 보인다. 예전 급여 담당 표시의 절반. */
  "attendance.manage": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 급여 보기 — 월 급여표 · 내보내기 · 추가수당 목록 · 청소 월 비교표의 금액. */
  "payroll.view": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 급여 마감 · 마감 취소 · 추가수당 만들기/취소. */
  "payroll.manage": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 시급 · 고용형태 보기와 설정. */
  "wages.manage": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 교통비 신청 보기 · 승인/반려 · 영수증. */
  "transport.manage": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 연차 결재(승인 · 반려 · 문서). 예전 `memberships.leave_approver_role` 표시. 시급제 역할은 연차 대상이 아니지만 결재는 맡을 수 있다. */
  "leave.approve": {
    roles: ["owner", "senior_managing_director"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
  /** 분실물 처리(상태 바꾸기 · 보관/반환). 알바(아르바이트 · 리더)는 역할로 못 받는다 — 필요한 사람에게 켠다(2026-10-21). */
  "lost_found.handle": {
    roles: ["owner", "senior_managing_director", "office_admin", "cs_staff", "field_manager"],
    individualGrant: true,
    individualDeny: true,
    asksExpiry: false,
    platformBypass: true,
    systemOnly: false,
    developerOnly: false,
  },
} as const satisfies Record<string, CapabilityPolicy>;

export type Capability = keyof typeof CAPABILITIES;

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as Capability[];

/**
 * 관리자 웹에 들어갈 수 있나(+ 관리 ↔ 현장 모드 전환) — 권한 키 `admin_web.access`(2026-10-21). 예전 `canAccessAdminWeb(role)`.
 * 세션이 서버에서 계산해 실어 보낸 권한 목록만 본다(클라이언트도 같은 함수).
 */
export function hasAdminWebAccess(session: { capabilities: readonly string[] } | null | undefined): boolean {
  return Boolean(session?.capabilities.includes("admin_web.access"));
}

export function isCapability(value: string): value is Capability {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, value);
}

export function capabilityPolicy(capability: Capability): CapabilityPolicy {
  return CAPABILITIES[capability];
}

/** 관리 화면에서 개인 부여·차단을 다룰 수 있는 키. */
export function assignableCapabilities(): Capability[] {
  return CAPABILITY_KEYS.filter((key) => {
    const policy = capabilityPolicy(key);
    return !policy.systemOnly && (policy.individualGrant || policy.individualDeny);
  });
}

/**
 * 차단을 걸 수 없는 역할.
 *
 * 소유자를 잠그면 되돌릴 사람이 없다. 전무는 owner 동등(`isOrgTopAdmin`)이고, 플랫폼 개발자는
 * 마지막 복구 수단이다.
 */
const DENY_IMMUNE_ROLES: readonly Role[] = [
  "owner",
  "senior_managing_director",
  "developer_super_admin",
];

export function canBeDenied(role: Role): boolean {
  return !DENY_IMMUNE_ROLES.includes(role);
}

/**
 * 판정식 — 앱과 SQL(`has_capability`)이 **같은 규칙**을 쓴다.
 *
 * ```txt
 * can = NOT (denied AND deniable_role)
 *   AND ( granted OR role ∈ roles OR (platform_admin AND platformBypass) )
 *
 * 2026-10-21 부터 부여 · 차단 행은 키의 `individualGrant` · `individualDeny` 와 무관하게 판정에 든다(개발자 예외).
 * ```
 *
 * **차단이 최우선이다.** 개인 부여보다도 앞선다 — 「빼라」가 「줘라」보다 강해야 판단이 갈릴 때
 * 안전한 쪽으로 실패한다. 단, 차단 면역 역할에는 적용되지 않는다(잠금 방지).
 *
 * 순수 함수다. 활성 여부(회수·만료) 판단은 부르는 쪽이 이미 걸러서 넘긴다.
 */
export function evaluateCapability(args: {
  capability: Capability;
  role: Role;
  /** 활성 개인 부여를 보유하는가. */
  granted: boolean;
  /** 활성 개인 차단을 보유하는가. */
  denied: boolean;
}): boolean {
  const policy = capabilityPolicy(args.capability);

  // 개인 부여 · 차단은 **있으면 그대로 따른다.** `individualGrant` · `individualDeny` 는 「대표 · 전무가 걸 수 있는가」의 규칙이고,
  // 개발자는 그와 무관하게 어떤 키든 켜고 끌 수 있다(2026-10-21 사용자 결정) — 그래서 판정에서는 정책 플래그를 보지 않는다.
  // 플래그에 어긋나는 행은 개발자만 만들 수 있다(`grantMemberOverride`).
  if (args.denied && canBeDenied(args.role)) return false;

  // 통과가 켜져 있으면 즉시 허용하고, **꺼져 있으면 일반 규칙으로 흘려보낸다.** 예전에는
  // `return policy.platformBypass` 라 통과가 꺼진 키에서 개발자가 개인 부여를 갖고도 거부됐다 —
  // SQL 은 흘려보내고 있어 둘의 답이 갈렸다(2026-09-10 감사).
  if (args.role === "developer_super_admin" && policy.platformBypass) return true;

  if (args.granted) return true;

  return roleHasCapability(args.role, policy.roles);
}

/**
 * 역할이 이 권한을 기본으로 갖는가.
 *
 * **전무(`senior_managing_director`)는 `owner` 와 동등**하다(`isOrgTopAdmin`, 마이그레이션
 * 202607130003). DB 헬퍼 `has_org_role` 이 이미 「목록에 owner 가 있으면 전무도 통과」로 동작하므로,
 * 여기서도 같아야 한다 — 다르면 같은 권한이 앱에서는 열리고 RLS 에서는 막히는(또는 그 반대) 상태가
 * 된다. 레지스트리에 owner 만 적고 전무를 빠뜨려도 전무가 조용히 권한을 잃지 않는다.
 */
function roleHasCapability(role: Role, roles: readonly OrganizationRole[]): boolean {
  const list = roles as readonly string[];
  if (list.includes(role)) return true;
  return role === "senior_managing_director" && list.includes("owner");
}

/**
 * 역할만으로 이 권한을 갖는가 — 개인 부여 · 차단은 보지 않는다. 역할로만 정해지는 기능 게이트(위 「권한 정리 ③」 키들)와
 * 「역할 기본값」 판단에 쓴다. 개발자는 `platformBypass`, 전무는 owner 를 물려받는다(`evaluateCapability` 와 같은 규칙).
 */
export function roleCan(role: string, capability: Capability): boolean {
  return evaluateCapability({ capability, role: role as Role, granted: false, denied: false });
}

/** 이 권한을 역할로 받는 조직 역할(전무 포함, 개발자 제외) — DB `.in("role", …)` 조회용. */
export function rolesWithCapability(capability: Capability): OrganizationRole[] {
  const roles = new Set<OrganizationRole>(capabilityPolicy(capability).roles);
  if (roles.has("owner")) roles.add("senior_managing_director");
  return [...roles];
}
