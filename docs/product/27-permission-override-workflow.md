# Permission Override / 사용자별 권한 예외 부여

> **이 문서는 권한 아키텍처로 일반화된다 (2026-09-10 방향 확정, 구현 대기).**
> 사용자 지시: 「모든 기능을 역할 기반으로도, 개개인 특정으로도 세분화할 수 있게 설계 자체를
> 그렇게 해야 한다.」 아래에 적힌 것은 **개인 부여(grant)** 한 방향뿐이고, 앞으로는
> **차단(deny)** 과 **역할 기본 부여**가 같은 모델 안에 들어온다.
>
> 바뀌는 것 둘:
> - **「모든 부여에 기한 필수, 무기한 없음」**(아래 Goal 절)은 폐기가 아니라 **키별 정책**이 된다.
>   기존 예외성 권한은 그대로 기한 필수이고, 상시 업무 지정(채용 담당자 등)만 무기한을 허용한다.
> - **2026-10-20 — 비활성 · 삭제되면 개인 부여 · 차단은 전부 회수된다**(권한 정리 ④ B). 다시 활성으로 돌려도 살아나지 않는다. 회수 · 부여는
>   `audit_logs` 에도 남는다(멤버 상세 「최근 변경」).
> - **2026-10-20 사용자 결정 — 기한 필수 폐지, 모든 키에서 무기한을 고를 수 있다.** 「기간 상관없이 무제한으로
>   권한을 줄 수 있도록 설정할 수 있어야 한다.」 예외성 권한(주문 처리 · 수리 상태 변경 · 건물 · 객실 관리 · 일일
>   리포트 생성)은 켤 때 여전히 기한 줄이 펼쳐지지만 맨 앞에 **「무기한」** 칩이 있다(차단도 같다). 서버는 기한을
>   비우면 무기한으로 저장한다(`expiry_required` 거부 삭제). 레지스트리 필드는 `requiresExpiry` → `asksExpiry`(「묻는가」).
> - `permission_key` 화이트리스트(`src/config/permission-overrides.ts`)는 권한 레지스트리
>   (`src/config/capabilities.ts`)로 흡수된다.
>
> 표 `membership_permission_overrides` 는 유지하고 `effect`(grant/deny) 컬럼이 추가된다.
> 2026-09-10 기준 **부여 이력 0행**이라 데이터 이전이 없다.
> 설계: `docs/engineering/14-permission-architecture.md`.

Status: **UI + grant/revoke/list backend + enforcement all implemented (2026-07-13, migration
`202607130004_permission_override_enforcement.sql`).** All four whitelisted keys (RLS for
`order_processor`/`maintenance_status_change`/`property_room_manage`, app-code gate for
`can_generate_report`) actually change access now, not just show in the UI — see "Enforcement — DONE"
below. The schema was migrated 2026-07-09
(`supabase/migrations/202607090002_membership_permission_overrides.sql` — table
`membership_permission_overrides` + read-only owner/platform-admin RLS + the reusable
`has_permission_override(org, user, key)` helper).

**Implemented 2026-07-13:**
- `/admin/users/[id]` "권한 예외" card (owner/senior_managing_director(전무)/`developer_super_admin`
  only) — list active overrides,
  grant (rich key picker + required datetime-local expiry + reason), two-step inline revoke.
  **Reason became optional on 2026-09-30 (user decision)** — the grant saves with an empty reason; the column
  stays `not null` and stores `''`, and the active-override row hides an empty reason.
  Component `src/components/admin/users/user-detail-client.tsx`.
- Application-level `permission_key` whitelist: `src/config/permission-overrides.ts`
  (`order_processor`, `maintenance_status_change`, `property_room_manage`, `can_generate_report`).
  Labels/descriptions in i18n `admin.users.console.keys` (ko/ja/en).
- Service-role data layer `src/lib/permission-overrides-server.ts`
  (`listMemberOverrides`/`grantMemberOverride`/`revokeMemberOverride`) + server actions
  `grantPermissionOverrideAction`/`revokePermissionOverrideAction` in `src/app/admin/users/actions.ts`,
  gated to owner/senior_managing_director(전무)/developer, org-scoped, self-grant blocked (DB constraint
  + action), expiry-required.
- **No new migration** — reuses `202607090002`.

**Enforcement — DONE (2026-07-13, migration `202607130004_permission_override_enforcement.sql`).** All
four whitelisted keys now actually change access, not just show in the UI:
- `order_processor` → `order_requests` UPDATE (상태 변경) RLS policy gains
  `OR has_permission_override(organization_id, auth.uid(), 'order_processor')`.
- `maintenance_status_change` → `maintenance_reports` UPDATE RLS policy, same OR.
- `property_room_manage` → new `for all` override policies on `properties` / `rooms` (+ DML grants to
  authenticated so RLS can allow an override-holder; writes stay limited to platform admins OR
  override-holders).
- `can_generate_report` → enforced in **app code** (mobile `generateDailyReport` action) via
  `hasPermissionOverride()` (`src/lib/permission-overrides-server.ts`), since that gate is not RLS.
A granted override (active, not expired, not revoked) now grants the real capability; revoke/expiry
removes it immediately.

## Problem

Foldy' role model (`docs/product/01-user-roles.md`, `docs/engineering/05-rls-permissions.md`) is a
seven-role org model (`owner / senior_managing_director / office_admin / cs_staff / field_manager /
staff / part_time_staff` — `senior_managing_director`/전무 added 2026-07-13, fully owner-equivalent)
plus a handful of **per-feature membership flags** that already exist
(`attendance_payroll_admin`, `leave_approver_role`, `profiles.can_generate_report`). Sometimes an
owner/developer needs to grant one specific person access to one specific feature **without**
promoting their role or adding a brand-new dedicated column for a one-off need.

## Explicitly NOT in scope — this already works today

**Permanent role/employment changes are a different problem and already have a solution.** A
part-time worker becoming a regular employee, or any role promotion/demotion, is a normal
`memberships.role` change — already implemented at `/admin/users/[id]` (`updateMemberRole` server
action, `src/app/admin/users/actions.ts`). That flow already has its own permission tiering
(`owner`/`senior_managing_director`/`developer_super_admin` can assign any organization role;
`office_admin` can assign anything
except `owner`/`office_admin`; nobody can promote themselves) and needs no changes. This document is
only about the narrower case: **role stays the same, but one person gets a specific feature-level
exception.**

The three existing per-feature flags (`attendance_payroll_admin`, `leave_approver_role`,
`can_generate_report`) also stay exactly as they are. This system is additive for *future* exception
needs, not a migration/replacement of what already works.

## Goal

Let `owner`, owner-equivalent `senior_managing_director`, or `developer_super_admin` grant a specific, named, **time-bound** exception to a
specific user for a specific feature — without changing their role and without a new DB migration
every time a new exception need comes up.

## Confirmed design direction

- **One generic table, not one column per feature.** A `membership_permission_overrides`-style table
  (org, user, `permission_key`, granted_by, reason, `expires_at`, revoked_at) so new exception types
  don't require a schema migration — only a new entry in a whitelisted `permission_key` enum/list.
- **`permission_key` is a closed whitelist**, defined in application code (mirrors
  `src/config/roles.ts`), never a free-text string. It can never contain `"role"` itself — this system
  cannot be used to reassign `owner`/`office_admin`/etc.; that stays exclusively on the existing
  role-change flow.
- ~~**Time-bound by default.** Every grant requires an `expires_at`.~~ (2026-10-20: 무기한 허용 — 위 머리말.) No permanent/indefinite grants
  through this system — if something needs to be permanent, that's a signal it should become a real
  per-feature flag (like the existing three) or a role change, not an override.
- **Requester ≠ approver**, at minimum: the person who requests/needs the exception cannot also be the
  one who grants it to themselves. Self-grant is blocked the same way self role-promotion is blocked
  today.
- **Audit log** on every grant and revoke (reason optional since 2026-09-30 — superseded the original *mandatory reason* rule), following the same pattern already used
  for manual attendance-session edits (`attendance_session_audits`) and account-linking-sensitive
  actions — write to `audit_logs`.
- **Who can grant**: `owner`, `senior_managing_director`(전무, owner-equivalent since 2026-07-13), and
  `developer_super_admin` only (matches the "개발자, 최고관리자" scope given in conversation).
  `office_admin` cannot grant overrides, unlike role changes where it has partial authority.
  **Developer targets (2026-10-19):** a member who is an active platform developer can only receive or
  lose overrides from a developer — owner/전무 are refused (`protected_member`, same guard as the rest of
  the user console; `docs/product/17-user-profile-directory.md`).
- **Adoption is a two-layer change, not just RLS (corrected 2026-07-09).** A lot of Foldy'
  real authorization logic lives in **TypeScript, not pure RLS** — e.g. `ORDER_PROCESSOR_ROLES`
  (`src/app/mobile/requests/orders/actions.ts`), `canGenerateDailyReport()` /
  `canAssignRole()` / `canAccessAdminWeb()` (`src/config/roles.ts`,
  `src/app/admin/users/actions.ts`), `isAttendancePayrollAdmin()`
  (`src/lib/attendance-review.ts`). Several of these are *stricter* than the matching RLS policy on
  purpose (e.g. `field_manager` can edit order-request content via RLS but is blocked from changing
  status by the server action alone). So adopting this system for a given feature means **both**:
  1. RLS: add `OR public.has_permission_override(org, user, 'key')` next to the existing
     `has_org_role(...)` check (if that feature's RLS is the actual gate), **and**
  2. Server action / `canX()` helper: add the equivalent override check there too (querying
     `has_permission_override` via the service client), wherever the real enforcement is TS code, not
     SQL. Skipping this step is the most likely way a future override silently does nothing.

## Explicitly deferred (not MVP)

- Break-glass / emergency self-service elevation — not needed at Foldy' current scale.
- Periodic access recertification (quarterly review nagging admins to re-confirm active grants) — a
  reasonable v2 addition once there are enough live grants for it to matter.
- A general-purpose policy engine (Zanzibar/OPA-style) — overkill for this org/table count.

## UI/UX — entry flow (confirmed 2026-07-09)

**No new sidebar item.** This is a low-frequency, narrowly-scoped admin action restricted to
owner/developer — it does not warrant a first-class nav entry per the admin dashboard shared-design
contract (`docs/product/05-admin-web-ia.md`), which favors extending an existing pattern over adding
one-off top-level areas. Confirmed: this hangs off the existing **사용자 (Users)** admin feature, not
a new feature area — sidebar "사용자" → `/admin/users` list → `/admin/users/[id]` detail, same page
that already handles role/status changes.

- **Primary entry: `/admin/users/[id]`.** Add a new card ("권한 예외" / 권한 override) directly below
  the existing "Role & status management" card on the same page — same page, same mental model
  ("manage this one person"), consistent with how role changes already live there. Visible only to
  `owner`/`senior_managing_director`(전무)/`developer_super_admin`; other viewers of the page (e.g.
  `office_admin`, who can already reach this page to manage roles) don't see this card at all, since
  they can't act on it.
  - Card shows: any currently-active overrides for this user (permission key, granted by, expires at,
    reason) + a "grant new exception" action (select permission_key from the whitelist, set an
    expiry, enter a reason) + a revoke action per active row.
- **Secondary/audit surface (phase 2, not MVP): `/admin/settings`.** The existing settings area
  already has sub-pages per concern (`settings/attendance`, `settings/organization`; invite-code
  management moved out to `/admin/users/invites` on 2026-07-13). A future `settings/permissions`
  sub-page could show an org-wide list of
  all active + past overrides for accountability review, mirroring the existing sub-page pattern. Not
  required to ship the MVP grant/revoke flow on the user detail page.

## Open questions

- Initial `permission_key` whitelist is resolved and implemented in
  `src/config/permission-overrides.ts`: `order_processor`, `maintenance_status_change`,
  `property_room_manage`, and `can_generate_report`.
- Should an override notify the affected user (in-app notification) when granted/revoked, the way
  other admin actions do? Not decided.
- Should expired-but-unrevoked grants show up anywhere (e.g. a "recently expired" list) or just
  silently stop applying? Leaning toward: RLS/helper just checks `expires_at > now()`, expired rows
  are inert but not deleted (audit trail), no special UI needed for MVP.

## 역할을 바꾸면 역할 기본 권한만 남는다 (2026-10-21)

- **결정(사용자):** 각자 역할에 맞는 기본 기능만 켜져 있고, 그 밖의 권한(개인 부여 · 차단, 급여 담당, 연차 결재자)은 대표 · 전무 · 개발자만 바꾼다.
  개인 권한 · 급여 담당 · 연차 결재자 토글은 원래부터 `canManagePermissions`(대표 · 전무 · 개발자) 게이트였다 — 그대로.
- **바뀐 것:** `setMemberRole` 이 역할이 실제로 바뀌면 개인 부여 · 차단을 전부 회수(`revokeAllMemberOverrides`, 감사 `member.permissions_auto_revoke`)하고
  `attendance_payroll_admin = false` · `leave_approver_role = null` 로 되돌린다. 계기: 오피스 관리자 → 아르바이트 리더로 바꾼 사람에게 연차 결재자 ·
  급여 담당이 그대로 남아 있었다. 토스트가 「개인 권한 초기화」를 알린다(ko/ja/en). 실행 취소는 역할만 되돌린다(회수된 권한은 다시 줘야 함).
- **연차 결재자 끄기:** 시급제 역할(`part_time_staff` · `staff`)은 결재자로 **켤 수만** 없다. 전에는 끄기도 막혀 남은 표시를 지울 수 없었다.
- **운영 데이터(Haru):** 대표 · 전무 · 활성 개발자를 뺀 전원을 같은 날 역할 기본으로 되돌렸다(개인 부여 · 차단 회수, 급여 담당 · 결재자 끔).

## 개발자는 어떤 권한이든 켜고 끈다 (2026-10-21)

- **결정(사용자):** 개발자는 역할로 정해진 기본 기능이라도 사람마다 끄고 켤 수 있어야 한다(예외 처리).
- 사용자 패널(PC · 모바일 같은 데이터): 개발자에게는 「역할로 받음 · 끌 수 없음」 줄도 토글이 열리고, 개인 부여가 막힌 키(꺼짐)도 줄이 보인다.
  대표 · 전무는 지금처럼 키 정책(`individualGrant` · `individualDeny`)대로.
- 서버: `grantMemberOverride({ actorIsDeveloper })` 가 개발자면 키 정책 검사를 건너뛴다. 그대로인 것 — 차단 면역(대표 · 전무 · 개발자), `systemOnly` 키,
  자기 자신에게 걸기 금지.
- 판정: 앱 `evaluateCapability` · DB `has_capability` 둘 다 활성 부여 · 차단 행을 키 정책과 무관하게 따른다(`docs/engineering/05-rls-permissions.md` 맨 아래).

## 역할 = 기본 틀 · 사람마다 켜고 끈다 (2026-10-21)

- **결정(사용자):** 역할마다 기본 틀(처음부터 켜진 권한)은 정하되, 그 밖은 **대표 · 전무 · 개발자가 사람마다** 주고 뺀다.
  아르바이트 리더가 사무실에서 근태 · 청소 배정을 넘겨받아 관리자를 돕는 경우가 있어서, 역할 이름만으로는 못 정한다.
- **누가:** 대표 · 전무 · 개발자 — 키 정책(`individualGrant` · `individualDeny`)과 무관하게 모든 키를 켜고 끈다(`actorBypassesKeyPolicy`).
  그대로: 대표 · 전무 · 개발자는 차단 불가, `systemOnly`(권한 관리 자체) 불가, 자기 자신 불가, `developerOnly`(사용자 관리 위임)는 개발자만.
- **새 키 8개**(역할 기본값):

  | 키 | 기능 | 역할 기본 |
  | --- | --- | --- |
  | `admin_web.access` | 관리자 웹 들어가기 + 관리 ↔ 현장 모드 전환(예전 `adminWebRoles`) | 알바(아르바이트 · 리더) 빼고 전원 |
  | `attendance.manage` | 근태 관리 — 전체 출퇴근 · 정정 승인 · 수기 입력 · 근무 수정/무효 · 변경 기록 (**금액은 안 보임**) | 대표 · 전무 |
  | `payroll.view` | 급여 보기 — 월 급여표 · 내보내기 · 추가수당 목록 · 청소 월 비교표 | 대표 · 전무 |
  | `payroll.manage` | 급여 마감 · 마감 취소 · 추가수당 만들기/취소 | 대표 · 전무 |
  | `wages.manage` | 시급 · 고용형태 보기와 설정 | 대표 · 전무 |
  | `transport.manage` | 교통비 신청 보기 · 승인/반려 · 영수증 | 대표 · 전무 |
  | `leave.approve` | 연차 결재(승인 · 반려 · 휴가계) | 대표 · 전무 |
  | `lost_found.handle` | 분실물 상태 바꾸기 · 보관 · 반환 | 알바(아르바이트 · 리더) 빼고 전원 |

- **없앤 것:** 급여 담당(`memberships.attendance_payroll_admin`) · 연차 결재자(`leave_approver_role`) · 일일 보고서 허용(`profiles.can_generate_report`)
  토글 — 위 키(`can_generate_report` 포함)의 줄로 대신한다. 컬럼은 남기되 판정에서 보지 않는다. 남아 있던 표시는 마이그레이션이 같은 키의 개인 부여로
  옮겼다(운영은 0건 — 그날 이미 역할 기본으로 정리).
- **근태와 급여 분리:** 직원 상세(`/admin/attendance/staff/[id]`)는 근태 관리 또는 급여 보기면 열리고, 금액 칸은 `payroll.view`, 교통비 칸은
  `transport.manage` 일 때만 보인다. 근태 탭 메뉴도 키가 없는 탭은 숨긴다(현황 · 출근부는 누구나).
- **역할만 보던 곳 27곳을 사람별로:** `roleCan(역할, 키)` 는 개인 부여 · 차단을 무시해서 토글이 실제로 먹지 않았다 — 게시판 관리, 청소 기록 전체 보기 ·
  강제 완료, 린넨, 컴플레인, 운영 정보 수정, 남의 요청 삭제, 버그 검토, 공지 작성/관리, 주문 처리(차단 무시), 수리 상태(차단 무시)를
  `session.capabilities` · `memberCapabilities` 로 바꿨다. 공지 · 주문 · 수리는 아르바이트 하드코딩도 뺐다(역할 기본으로 같은 결과).
- **DB:** 마이그레이션 `202610210005_capability_per_person.sql`(운영 적용) — 키 시드, 표시 → 부여 이전, RLS 헬퍼를 키로
  (`can_manage_attendance_payroll` = 근태 관리 ∨ 급여 보기, 새 `can_view_payroll` · `can_manage_transport`, `is_leave_approver` = `leave.approve`),
  금액 · 교통비 표 정책을 각자의 키로, 분실물 UPDATE 정책을 `lost_found.handle` 로.
- **검증:** 운영 DB 에서 리더에게 근태 관리 부여 + 분실물 차단을 걸고 그 사람으로 로그인한 상태를 흉내 내 확인(근태 표 열림 · 급여 · 교통비 막힘 ·
  분실물 막힘) 뒤 되돌림. 로컬 빌드 + 데모 조직 계정으로 화면 확인(리더 기본: 근태 탭 현황 · 출근부만 / 근태 관리 부여 → 근태 처리 탭 생김 ·
  시급 · 교통비 없음 / 관리자 웹 차단 → `/mobile` 로 돌려보냄 / 대표가 보는 리더 패널: 34개 키 모두 토글 가능).
- **남은 것:** 컴플레인 · 청소 · 게시판 등의 DB 보안 규칙 일부는 아직 역할 기준(`has_org_role`) — 그런 곳의 개인 차단은 앱(화면 · 서버 액션)에서만 걸린다.
  근태 QR · 사이트 설정은 아직 대표 전용 역할 비교.

### 리더 = 알바 기본 · 청소 배정은 사무실도 (2026-10-21, 마이그레이션 `202610210006`)

- **사용자:** 「리더는 정직원이 아니라 오래 일해서 정직원 대신 업무를 해 주는 알바(사무실 · 현장). 많은 권한을 주는 게 아니라 누구를 서포트하느냐에
  따라 업무가 달라진다」 · 「청소 배정은 사무실 알바 리더와 현장 직원이 나눠서 한다, CS 는 안 한다」.
- 리더(`staff`) 역할 기본 = 아르바이트와 같음(청소 작업만). 빠진 것: 관리자 웹 · 공지 작성 · 일일 업무일지 · 수리 상태 · 분실물 처리 · 컴플레인 댓글 —
  돕는 일에 따라 사람마다 켠다(예: 사무실 리더 → 관리자 웹 + 근태 관리 + 청소 배정).
- 청소 배정 기본 = 대표 · 전무 · **오피스 관리자** · 현장 관리자(CS 제외).
- 주의: 공지 · 수리 · 분실물 등 일부 DB 규칙은 아직 역할 목록에 `staff` 가 있어 DB 수준에서는 열려 있다 — 앱(화면 · 서버 액션)이 권한 키로 막는다.

### 근태 설정 키 · DB 규칙도 키로 (2026-10-21, 마이그레이션 `202610210007`)

- 새 키 `attendance.settings`(근태 — 설정): 출근 장소 · QR 만들기/인쇄 · 등록 기기 해제. 역할 기본 대표 · 전무(예전 「대표 · 전무 · 개발자」 비교와 같음).
  `/admin/settings` · `/admin/settings/attendance`(+ 인쇄) · 설정 액션이 이 키로 판정.
- 공지 · 게시판 · 버그 · 청소 · 린넨 · 요청 · 건물 운영 정보의 DB 규칙을 역할 목록에서 권한 키로 — 사람별 설정이 DB 에서도 그대로. 표는
  `docs/engineering/05-rls-permissions.md` 「역할 목록 → 권한 키」.

### 사용자 화면 — 권한 토글 묶음 (2026-10-22)

- 36줄이 한 줄로 내려와 관리가 어려웠다(사용자) → **기능별 8묶음**으로 접고 편다(PC 사용자 패널 · 모바일 사용자 상세 같은 규칙):
  관리자 웹 · 사용자 / 근태 · 급여 / 청소 / 요청(수리 · 분실물 · 주문) / 공지 · 게시판 · 버그 / 손님 · 건물 / 운영(판매 · 매출) / 채용.
- 묶음 머리에 「켜진 수 / 전체」. 처음엔 전부 접혀 있다(사용자). 위쪽 「켜진 것만 보기」를 누르면 켜진 줄만 남기고 묶음을 모두 편다.
  기한을 고르는 중인 줄이 있는 묶음은 접히지 않는다. 「개발자 지정」 줄은 관리자 웹 · 사용자 묶음.
- 묶음 정의는 `src/config/capability-groups.ts` 하나 — 새 권한 키는 여기 한 묶음에 넣는다(`capability-groups.test.ts` 가 빠진 키를 잡는다).
- **쓰는 화면이 없는 토글 숨김:** `property_room_manage`(건물 · 객실 관리) — DB 의 건물 · 객실 표 쓰기만 열고 화면이 없다(건물 · 객실은 Beds24 동기화).
  `HIDDEN_CAPABILITIES` 로 사용자 화면에서 뺀다. DB 권한은 그대로 — 편집 화면을 만들면 다시 보인다. 그 밖의 키는 모두 화면 · 서버 · DB 중 어딘가에서 쓰인다(2026-10-22 점검).
- **물음표 설명:** 권한 이름 옆 작은 「?」를 누르면 줄 아래에 자세한 설명(무엇을 열고 · 어느 화면이고 · 끄면 어떻게 되는지)이 펼쳐진다. 한 번에 하나.
  문구 `permHelp`(키마다, 「개발자 지정」은 `developer`) · `wPermHelpAria`.
- 문구 `dictionary.admin.users.console.permGroups` · `wPermOnlyOn` · `wPermGroupCount` · `permHelp` (ko/ja/en).

### 게스트 피드백 = CS 관리자 (2026-10-22, 마이그레이션 `202610220002`)

- **사용자:** 「게스트 피드백은 누구나 볼 수는 있지만 댓글 달거나 컴플레인 등록하거나 등은 전부 CS 관리자 권한뿐」.
- `complaint.write`(작성 · 리뷰 가져오기) · `complaint.manage`(해결 · 다시 열기 · 남의 것 관리) · `complaint.comment`(댓글)의 역할 기본 =
  대표 · 전무 · **CS 관리자**(개발자는 늘 통과). 오피스 관리자 · 현장 관리자는 기본에서 빠졌다 — 필요하면 사람마다 켠다. 보기는 그대로 누구나.
- **쓸모없어진 차단 정리(같은 날, 마이그레이션 `202610220003`):** 역할 기본값이 바뀌면 그 역할이 더는 받지 않는 키에 걸어 둔 차단이 남아
  「개인 차단 · 역할로는 받음」이라는 틀린 글자가 떴고(지유진 · 댓글 1건), 나중에 켜 주려 해도 차단이 이겨 켜지지 않았다. → 그런 차단을 회수했고,
  사용자 화면은 그 경우 「꺼짐」으로 보이며, 부여(켜기)는 같은 키의 반대 방향 지정(차단)을 먼저 회수한다(`grantMemberOverride`, 차단도 마찬가지).
