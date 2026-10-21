# User Roles

## Role Model

Foldy should use role-based permissions from the beginning.

Roles are split into:

- Platform-level role
- Organization-level roles

Platform-level roles are stored separately from organization memberships.

Implementation note:

- Initial role constants and labels are implemented in `src/config/roles.ts`.
- These constants are UI/routing helpers only. Final security must still be enforced through server code and Supabase RLS.

## Platform-Level Role

### Developer / Super Admin

Used by the developer/operator of Foldy.

Can:

- Access all organizations for debugging and support
- Manage global settings
- Inspect system-level issues
- Manage technical configuration
- Bypass normal organization limits when needed

Important:

- This role should be limited to trusted developer/operator accounts.
- Actions should be audit logged.
- This role should be stored in a platform-level table, not as a normal organization role.

## Organization-Level Roles

### 화면 표시 이름 · 급여 구분 (2026-10-21 역할 정리 — 현재 기준)

내부 이름(slug) · 권한은 그대로 두고 **화면 표시 이름만** 바꿨다. 아래 섹션 제목(CS Staff · Staff · Part-Time Staff …)은 옛 이름이다.

| 내부 이름 | ko | ja | en | 급여 | 비고 |
| --- | --- | --- | --- | --- | --- |
| `owner` | 대표 | 代表 | Owner | 월급제 | 플랫폼 개발자는 멤버십이 owner 여도 「개발자」로 표시(2026-10-16, `displayRoleKey`) |
| `senior_managing_director` | 전무 | 専務 | Managing Director | 월급제 | |
| `office_admin` | 오피스 관리자 | オフィス管理者 | Office Admin | 월급제 | |
| `cs_staff` | **CS 관리자** | CS管理者 | CS Manager | 월급제 | 옛 「CS 직원」 |
| `field_manager` | 현장 관리자 | 現場管理者 | Field Manager | 월급제 | 현장 책임자. 청소 전체 보기 · 강제 완료 · 린넨 관리 · 남의 요청 삭제 |
| `staff` | **아르바이트 리더** | アルバイトリーダー | Part-time Leader | **시급제** | 오래 일해 관리 업무를 일부 맡는 알바. 관리자 웹 일부(민감 화면 제외) · 일일 보고서 항상 가능 |
| `part_time_staff` | **아르바이트** | アルバイト | Part-timer | **시급제** | 모바일만 |

- **역할 = 기본 틀(2026-10-21):** 역할은 처음 켜진 권한만 정한다. 그 밖은 대표 · 전무 · 개발자가 사람마다 주고 뺀다(관리자 웹 진입 ·
  근태 관리 · 급여 · 연차 결재까지 전부 권한 키). 역할별 기본값 표: `docs/product/27-permission-override-workflow.md` 「역할 = 기본 틀」.
- **시급제 역할 = `isHourlyRole`** (`src/config/roles.ts`, `part_time_staff` · `staff`) — 연차 제외 · 청소 배정의 알바 판정이 이것 하나를 쓴다. 권한 판단에는 쓰지 않는다. 전에는 `part_time_staff` 만 제외였다.
- 급여 계산은 역할이 아니라 **고용형태 이력**(`employment_type_history`)으로 한다(기존 결정 그대로). 역할을 바꾸면 고용형태도 같이 맞춘다.
- 리더에게 더 맡길 일은 사람별 권한 추가(`docs/product/27-permission-override-workflow.md`)로 준다.
- 초대 코드 분류 표시도 맞췄다: `part_time_staff` 아르바이트 · `office_staff` 오피스 관리자 · `field_staff`(→`staff`) 아르바이트 리더 ·
  `part_time_manager`(→`field_manager`) 현장 관리자.
- 직원 목록 묶음: 관리 · 사무실 / 현장(`field_manager`) / 아르바이트(`staff` · `part_time_staff`).

### Admin Dashboard Access Direction (confirmed 2026-06-29)

The dashboard rebuild target is:

- `part_time_staff` cannot access the admin dashboard
- every non-part-time role can access the admin dashboard surface

Important:

- dashboard access does **not** mean every role gets the same admin powers
- detailed module permissions will be finalized feature by feature during dashboard implementation
- treat `can enter dashboard` and `can perform action X inside dashboard` as separate rules

## Signup / Invite Categories (2026-06-18 planning baseline)

Login/onboarding must expose the following business-facing role categories through team invite codes:

- Part-time Staff
- Office Staff
- Field Staff
- Part-time Staff (Manager)
- Owner

Important:

- These are the **invite/onboarding categories** visible to end users.
- Final internal role slugs and permission mapping still need to be reconciled with the existing role model during auth implementation.
- The signup flow should not ask the user to choose a role manually; the invite code determines it.

### Owner

The company representative or business owner.

Can:

- Manage organization settings
- Manage all staff — `/admin/users` · `/mobile/users` (list, detail, invites). **2026-10-20:** owner and 전무 get
  `user.manage` by role (before: developer default + delegation only, so an owner needed a developer to open it).
  Other roles still need an individual `user.manage` grant, which only developers can give. Protected-target rules
  (owner · 전무 · developer accounts, last owner, self) are unchanged. See `docs/product/27-permission-override-workflow.md`.
- View all records
- Configure permissions
- Access admin web
- Use mobile operational workflows when needed
- View reports
- Manage subscription/billing later

Implementation note:

- `owner` is treated as a hybrid operations role in the app, which means owners can move between admin web and selected mobile field workflows without needing a separate staff account.

### Senior Managing Director (전무) (added 2026-07-13)

An organization role fully equivalent to `owner` in every organization-scoped permission check.

- Introduced via migrations `202607130002` (enum value) and `202607130003` (`has_org_role` redefined so
  every RLS policy that already checks for `owner` automatically also passes for 전무, with no per-policy
  changes needed).
- Has every capability listed under Owner above, including user management by role (2026-10-20).
- Is the **default 연차(annual leave) approver role** (`DEFAULT_APPROVER_ROLE`), replacing the earlier
  `department_head` default — see `docs/product/26-annual-leave-workflow.md` and
  `docs/planning/01-decision-log.md` → 2026-07-13.
- See `docs/planning/01-decision-log.md` → 2026-07-13 ("사용자/권한 모델 개편") for the full decision
  record.
- **App-code role lists follow the same rule (2026-10-20).** DB helpers already treat 전무 as owner, but six
  features kept hand-written role lists without 전무 — 공지 작성, 청소(모바일 사용 · 남의 기록 보기), 컴플레인 작성 · 관리,
  린넨 반품 관리, 버그 신고 검토 · 알림, 게시판 남의 글 · 댓글 삭제, 요청 목록의 「남의 것 삭제」 버튼. All now include
  `senior_managing_director`. Wherever a feature doc says "owner/office_admin", read it as "owner · 전무 · office_admin".
  Regression test `src/lib/__tests__/senior-director-parity.test.ts` fails if any role list in `src/` names `owner` without 전무.
- **Since 2026-10-20 those feature gates are registry keys** (`src/config/capabilities.ts` → 「권한 정리 ③」, e.g. `announcement.create`,
  `cleaning.read_all`, `complaint.manage`, `request.delete_any`), checked with `roleCan`. The full role × feature table lives in
  `docs/engineering/14-permission-architecture.md` §3-1-1 and is pinned by `src/lib/__tests__/role-matrix.test.ts`.

### Office Admin

Office or back-office manager.

Can:

- Use admin web
- View operational records
- Create and manage announcements
- Manage staff invitations — `/admin/users/invites` · `/mobile/users/invites`, same gate as `/admin/users`
  (owner · 전무 by role since 2026-10-20; office_admin only with a developer-given `user.manage` grant)
- Assign or update tasks
- Manage inventory and order requests
- View calendar and reservation data
- Search and filter records

### CS Staff

Customer support staff who receive guest communication and update guest-related operational information.

Can:

- View guest information
- View all rooms/properties needed for guest support
- View reservation and stay schedule data
- Use admin web
- Manually update early check-out information
- Add guest-related operational notes
- Create tasks related to guest requests
- Update relevant calendar/schedule details
- Create announcements
- Approve, reject, and mark as ordered (주문 처리) for order/supply requests

### Field Manager

On-site manager responsible for field operations.

Can:

- Use mobile app
- Use admin web
- View field tasks
- Manage maintenance-related work
- Register and update maintenance issues
- Register and update lost items
- Review cleaning execution records
- Create order/supply requests
- Comment on operational records
- Create announcements

Cannot:

- Approve, reject, or mark as ordered for order/supply requests (office-level action only)

Maintenance responsibility belongs under this role for the first version.

### Staff

Regular employee.

Can:

- Use mobile app
- Use admin web
- View guest/reservation information except price/revenue data
- View all rooms/properties needed for work
- Register lost items
- Register maintenance issues
- Start and complete cleaning records
- Create order/supply requests
- Read announcements
- Comment on permitted records

### Part-Time Staff

Part-time worker.

Can:

- Use mobile app
- Register lost items
- Register maintenance issues
- Start and complete cleaning records
- Create order/supply requests if permitted
- Read announcements
- Comment on announcements if permitted

Permissions may be more limited than regular staff depending on company policy, but guest and room/property visibility is required for work.

Part-time staff should not see:

- Price
- Revenue
- Payment amount
- Financial performance data

Part-time staff also do **not** access the admin dashboard surface in the confirmed 2026-06-29
dashboard direction.

## Post-MVP Feature Batch Permissions (confirmed 2026-06-09)

These supplement the role definitions above for the approved feature batch. See `docs/planning/01-decision-log.md` (2026-06-09).

- **Internal Board:** all active roles **including Part-Time Staff** can create and read posts. Authors edit/delete their own; admin-capable roles (owner, office_admin, cs_staff, field_manager, developer_super_admin) moderate all (pin/archive/delete). This is intentionally looser than Announcements, where Part-Time Staff cannot create.
- **Staff Suggestions:** any active member can submit, with one required recipient and optional referenced users from the same organization. Read access is limited to the author, recipient, and referenced users. Only the recipient can change status. Referenced users can read/comment only. Authors can edit/delete the main suggestion only while status is `submitted`. Comment edit/delete is always limited to the comment author.
- **Linen Defect:** all active members create/read all linen return records in the organization. Authors can edit/delete their own records; admin-capable roles can edit/delete all records and manage the linen item master.
- **Personal Todo:** tasks are private to the creator by default. Shared tasks are visible only to active participants. The original author alone edits core task content; any participant can update shared workflow state (status / complete / reopen / update-log). Original author can remove any participant; participants can remove themselves.
- **Attendance / Payroll:** workers clock in/out and read their own attendance/pay. Privileged payroll operations use `owner`, owner-equivalent `senior_managing_director`, platform admin, or the per-membership `attendance_payroll_admin` flag; org-wide wage/rate data remains server-gated. Part-Time Staff never gain access to other users' pay/rate data through their base role.

## Permission Questions

TBD:

- Should front desk users see all lost items?
- Should housekeeping see all room maintenance requests or only assigned ones?
- Should order requests require approval?
- Who can delete records?
- Should deletion be disabled and replaced with archive?
- Should part-time staff create order requests directly?
- Should Staff and Part-Time Staff have different access by property?
- Which roles can see price/revenue information?

## Team (소속: 현장/사무실) Assignment (Phase 1 implemented 2026-07-14)

Separate from role. Every membership can be assigned to a **team** (`teams` table, `kind` = 현장(field)
/ 사무실(office)), a within-org grouping used for future view/filter purposes — not a permission
control. See `docs/planning/01-decision-log.md` → 2026-07-14 ("조직 모델 방향") for why this is a
same-org dimension rather than separate organizations, and `docs/engineering/04-data-model.md` → `teams`
for schema.

- Assignment is **independent of role**: a `field_manager` is not forced onto 현장, and an `office_admin`
  is not forced onto 사무실 — the default backfill maps role → team kind once, but an admin can
  re-assign any member to either team afterward.
- Migration `202607140001_teams.sql` seeds two default teams per org (현장/사무실) and backfills existing
  members: `field_manager`/`staff`/`part_time_staff` → 현장, everyone else → 사무실.
- Assignment/edit lives on `/admin/users/[id]` (a 소속 dropdown: 현장/사무실/미지정, save button) and the
  `/admin/users` directory shows a 소속 column + a 소속 filter (전체 소속/현장/사무실). Only shown when
  the org has teams.
- Server action `setMemberTeam` (`src/app/admin/users/actions.ts`) uses the same
  `actorCanManageUsersInOrg` gate as role/status changes. `null` clears the assignment (미지정).
- **Phase 1 scope only.** Team CRUD (creating additional/sub-teams beyond the two defaults) and using
  team as a filter on 근태/청소/대시보드 screens are later phases, not built yet.
- Migration is written but **not yet applied** to the linked Supabase project as of 2026-07-14.

## Auth / Onboarding Rules (2026-06-18 planning baseline)

- A user can belong to more than one organization.
- One account can hold multiple memberships; one active organization is selected at a time.
- Login should return the user to the last-used organization by default.
- Joining an additional organization should require only a new team invite code once the account profile is already complete.
