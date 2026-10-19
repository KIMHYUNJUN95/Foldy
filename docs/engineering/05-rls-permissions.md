# RLS Permissions

## Purpose

This document defines the initial Supabase Row Level Security direction for Foldy.

RLS policies must protect organization data and enforce key permission rules.

> **권한 모델 재구성 진행 중 (2026-09-10).** 「누가 이 기능을 쓸 수 있는가」의 정의를 역할 배열에서
> **권한 키(capability)** 로 옮기는 설계가 확정 대기 중이다. 정책이 역할 배열을 직접 들지 않고
> `has_capability(org, user, '<key>')` 를 부르는 형태가 된다. 이 문서의 역할 기반 서술은 전환이
> 끝날 때까지 유효하며, 기능별로 하나씩 옮긴다.
> 설계: `docs/engineering/14-permission-architecture.md`.
>
> 실측(2026-09-10): 정책 145개 중 31개가 `has_org_role` 로 역할 배열을 직접 들고 있고, 개인 예외를
> 반영하는 정책은 4개다.

## Core Rules

Implementation note:

- Initial RLS helper functions and starter policies are drafted in `supabase/migrations/202605090001_initial_foundation.sql`.
- This document covers the foundation and the implemented feature-specific policies.
- Feature-specific authorization belongs in migrations/RLS plus server actions where applicable, never only in UI visibility.

## 1. Organization Isolation

Users can access only records that belong to organizations where they have an active membership.

Core condition:

```txt
exists active membership for auth.uid() and row.organization_id
```

Policy form (2026-10-16, migration `202610160003`): write the condition as
`organization_id = ANY ((( SELECT current_user_active_organization_ids() ))::uuid[])`, not
`has_active_membership(organization_id)`. Both answer the same question, but the SECURITY DEFINER helper is not
inlined, so the old form ran a memberships lookup **per row** (a month of room rates = thousands of calls). The array
form becomes an InitPlan evaluated once per query. Likewise always wrap `is_platform_admin()` and `auth.uid()` in
`( SELECT … )`. `has_active_membership(x)` is still fine inside a correlated sub-select on another table
(e.g. `has_active_membership(a.organization_id)`). Existing policies were rewritten in place by that migration; the
visible row counts for four role-different accounts across 84 tables were identical before and after.

## 2. Platform Admin Access

Developer/Super Admin users are stored in `platform_admins`.

Active platform admins can access all organizations for support/debugging.

Important:

- Platform admin actions should be audit logged.

## 3. UI Is Not Security

Buttons can be hidden in the UI, but permissions must also be enforced server-side/database-side.

**Permission-denied feedback (as-built, 2026-07-09).** When a server action rejects a call with
`unauthorized`/`forbidden`, the client should tell the user why, not just show a generic failure
message. Two shared components exist for this: `PermissionDeniedSheet`
(`src/components/shell/permission-denied-sheet.tsx`, canonical `BottomSheet`) for `/mobile/*`, and
`AdminToast`/`useAdminToast` (`src/components/admin/shared/admin-toast.tsx`, bottom-center toast) for
`/admin/*`. Copy lives in `dictionary.common.permissionDeniedTitle`/`permissionDeniedBody` (ko/ja/en).
Not every forbidden-returning action is wired to these yet — `DeleteConfirmButton` and
`OrderActionBar` are (see decision log 2026-07-09); other screens (daily report, attendance approval
queue, attendance correction form) already had their own equivalent messaging before this pass and
were left as-is.

## Role Groups

## Platform

```txt
developer_super_admin
```

## Organization Roles

```txt
owner
senior_managing_director
office_admin
cs_staff
field_manager
staff
part_time_staff
```

`senior_managing_director`(전무, added 2026-07-13, migrations `202607130002`/`202607130003`) is fully
`owner`-equivalent: `has_org_role(org, roles[])` was redefined so that whenever `'owner'` is one of the
checked roles, an active 전무 membership also passes — automatically, with no per-policy edits needed,
since every RLS policy that gates on owner already calls `has_org_role`. See
"2026-07-13 User/Permission Model Rework" below.

## Office-Level Roles

Used for order request processing and office/admin actions.

```txt
owner
office_admin
cs_staff
```

## Field/Staff-Level Roles

Used for field operations.

```txt
field_manager
staff
part_time_staff
```

## Status-Changing Roles

Can change maintenance/lost item statuses.

```txt
owner
office_admin
cs_staff
field_manager
staff
```

Part-time staff cannot change statuses.

## Table Policy Direction

## organizations

Read:

- Active organization members can read their own organization.
- Platform admins can read all.

Create:

- The final product rule is no longer "platform admins only during MVP".
- Future organization creation should be allowed only through a validated organization-creation path/code.
- Until that flow is implemented, initial organization bootstrap remains manual / privileged.

Update:

- Owner
- Platform admins

Delete:

- Platform admins only, if ever needed.

## profiles

Read:

- User can read their own profile.
- Organization members can read profiles of users in the same organization directory.
- Platform admins can read all.

Update:

- User can update their own profile.
- Admin-capable roles can update limited profile/admin fields if needed.
- The "users can update own profile" policy also covers `bottom_nav_tabs` (per-user mobile bottom-bar customization); no separate policy is required.

## memberships

Read:

- Active organization members can read memberships in their organization.
- Platform admins can read all.

Create:

- Owner
- Office Admin
- Platform admins

Update:

- Owner
- Office Admin
- Platform admins

Important:

- Users cannot promote themselves.
- Part-time Staff cannot change roles/statuses.
- **(2026-07-13)** In practice, real writes to this table go through **service-role server actions**
  only, additionally gated by **developer default + `manage_users` delegation**
  (`actorCanManageUsersInOrg`, `src/lib/user-management-access.ts`) — an `owner` or `office_admin`
  without a delegation cannot actually change roles/statuses at `/admin/users`, even though the RLS
  policies above still name them. Treat the Owner/Office Admin/Platform Create/Update policies above as
  a **client-side-bypass backstop only**, not the real access rule. See
  "2026-07-13 User/Permission Model Rework" below and `docs/product/27-permission-override-workflow.md`.

## invite_codes

Read:

- Owner
- Office Admin
- Platform admins

Create/update:

- Owner
- Office Admin
- Platform admins

Use:

- Unauthenticated/signup flow can validate active code through a safe server function.

Planning note (2026-06-18):

- Invite-code validation must be the membership gate after authentication.
- A successful validation resolves `organization + signup role category` before final join.
- Initial invite-code creation/rotation is still manual bootstrap until the later dashboard tooling exists.

As-built note (2026-06-18):

- `validateInviteCode` (`src/lib/auth-invite.ts`) and the onboarding `previewInviteCode` server action read `invite_codes` (and the target `organizations.name`) via the **service role, server-side only**, and require an authenticated user — so the preview is not an open invite-probing endpoint. Preview is read-only; it does **not** consume the code.
- Final join still goes through the atomic `join_organization_with_invite_code` RPC (increments `used_count` + creates the membership) — the preview never grants access on its own.

## properties / rooms

Read:

- Active organization members.

Create/update:

- Owner
- Office Admin
- Field Manager
- Platform admins

Delete:

- Admin-capable roles only, with confirmation.

## reservations

Read:

- Active organization members.

Create/update:

- Beds24 webhook server function.
- CS Staff can update manual expected check-out time.
- Office Admin/Owner can update if needed.
- Platform admins.

Delete:

- Server function for cancelled reservations or admin/debug only.

Important:

- Price/revenue fields are not stored in MVP.

## beds24_webhook_events

Platform/operational observability log (not org business data).

Read:

- Platform admins only (`is_platform_admin()`).

Create/update/delete:

- Service role only (webhook + reconciliation cron paths). Platform admins also have full access via the `for all` policy.

Important:

- Not readable by regular organization members, including office-level roles. This is intentional: it is a Beds24 ingestion diagnostic surface, not an operational business table.
- `authenticated` has a `select` grant but the only `select` policy is platform-admin-gated, so non-platform users see nothing.

## cleaning_records

Read:

- Active organization members.

Create:

- Field Manager
- Staff
- Part-time Staff
- Office/admin roles if needed

Update:

- Creator can update active/completion state.
- Field Manager and office-level roles can update/review.
- Platform admins.

Export:

- Owner
- Office Admin
- CS Staff if permitted
- Field Manager
- Platform admins

## maintenance_reports

> 테이블 이름은 `maintenance_reports`다. 이 문서의 예전 판은 `maintenance_requests`로 적혀 있었으나
> 코드·마이그레이션 어디에도 그런 테이블은 없다. (2026-07-14 정정)

Read:

- Active organization members.

Create:

- All active organization members.

Update content:

- RLS UPDATE 정책은 컬럼을 구분하지 않지만, **앱이 실제로 쓰는 UPDATE 경로는 세 개뿐이다**:
  `updateMaintenanceStatus`(상태), `updateMaintenanceHandling`(상태 + `resolution_memo` +
  `resolution_image_urls` + `completed_*`), `applyMaintenanceException`(강제 완료/무효).
- **접수 후 본문(제목·설명·카테고리·우선순위·사진) 수정 경로는 없다** — 의도된 설계다
  (2026-07-14 확정). 잘못 올린 신고는 수정이 아니라 삭제 또는 무효 처리로 정리한다.

Change status:

- Owner
- Office Admin
- CS Staff
- Field Manager
- Staff
- Platform admins

Delete:

- **Admin roles** (developer_super_admin, owner, office_admin, cs_staff): can delete any record.
- **Non-admin roles** (field_manager, staff, part_time_staff): can delete only their own records (`reported_by_user_id = auth.uid()`).
- Entry point: request list view (icon button per card) and request detail page.
- Requires confirmation modal before executing.
- Hard delete.

RLS pattern:
```sql
-- DELETE policy
USING (
  organization_id IN (select org from active_membership)
  AND (
    reported_by_user_id = auth.uid()          -- own record
    OR role IN ('owner','office_admin','cs_staff')  -- admin
    OR is_platform_admin(auth.uid())
  )
)
```

Additional implementation note (2026-07-09):
- Reservation-linked maintenance creation may also set `reservation_id` / `guest_name`, but the
  create path must first verify server-side that the linked reservation belongs to the same
  organization and matches the submitted property / room context.
- These extra context columns do not broaden who can read or mutate maintenance rows.

### 2026-07-14 백엔드 연동 — UPDATE 정책 정정 + 예외 개입

마이그레이션 `202607160001_maintenance_backend.sql`.

- **`staff`가 UPDATE 정책에서 빠져 있었다.** 위 "Change status" 목록은 Staff를 포함하는데, 실제 RLS
  정책은 `owner / office_admin / cs_staff / field_manager`만 허용했다. **문서가 정답**이므로 정책에
  `staff`를 추가했다. `part_time_staff`는 계속 제외된다. `has_org_role`이
  `senior_managing_director`를 owner-equivalent로 처리하므로(마이그레이션 `202607130003`) 전무도
  자동 포함된다. `maintenance_status_change` 권한 예외(override)도 그대로 유지된다.
- **`with check` 절이 없었다.** USING만 있던 기존 UPDATE 정책은 업데이트로 행을 **다른 조직으로 옮기는
  것**을 DB 레벨에서 막지 못했다(앱 코드가 항상 `organization_id`를 고정해 실제 사고는 없었다).
  `with check (has_active_membership(organization_id))`를 추가했다.
- **RLS-필터된 0행 업데이트를 성공으로 착각하면 안 된다.** RLS가 행을 걸러내면 Supabase는 **에러 없이
  0행**을 돌려준다. 구 `updateMaintenanceStatus`는 영향 행 수를 확인하지 않아, 권한 없는 사용자에게도
  "상태 변경됨"이라고 응답했다. 모든 maintenance 쓰기 경로가 이제 `.select("id")`로 영향 행 수를 확인하고
  0행이면 `forbidden`으로 처리한다.
- **관리자 예외 개입**(강제 완료 / 무효 처리)은 RLS가 아니라 **서버 액션의 역할 게이트**로 막는다:
  `requireAdminSession()` + `canForceCompleteCleaning(role)` (= developer_super_admin / owner /
  senior_managing_director / office_admin / field_manager). 청소 강제완료와 같은 게이트다.
  `completed_by_admin = true`로 기록되어 현장 처리와 구분된다.
- **완료 사진 storage 정책**: `request-images` 버킷의 폴더 화이트리스트에
  `maintenance-resolutions`를 추가했다. 나머지 조건(4세그먼트, orgId/reportId UUID 형태,
  `part_time_staff` 제외)은 신고 사진과 동일하다.

## lost_items

Read:

- Active organization members.

Create:

- All active organization members.

Update / 현장 처리 (상태 변경 · 처리 메모 · 증빙 사진):

- 앱이 실제로 쓰는 UPDATE 경로는 `updateLostItemHandling`(모바일 현장 처리 — 상태 +
  `handling_memo` + `handling_image_urls` + `handled_*`)과 기존 어드민 상태 변경뿐이다.
- 반환은 등록자와 무관하게 **누구나(파트타임 제외) 처리 가능** — 요구사항.

Change status / 처리 (모바일·어드민 동일 게이트):

- Owner
- Office Admin
- CS Staff
- Field Manager
- Staff
- Platform admins
- (part_time_staff 제외)

> RLS 보강 (2026-07-15): 기존 lost_items UPDATE 정책은 `owner/office_admin/cs_staff/field_manager`만
> 허용해 **`staff`가 빠져 있었다**(수리·점검에서 고친 것과 동일한 누락). `staff`를 추가하고, USING만
> 있던 정책에 `with check (has_active_membership(organization_id))`를 붙여 업데이트로 행을 다른 조직에
> 옮기는 것을 막았다 — 마이그레이션 `202607170001_lostfound_return.sql`.
> 스토리지: 처리 증빙 사진은 `request-images` 버킷의 `{org}/lost-found-handling/{itemId}/` 폴더이며,
> 같은 마이그레이션이 storage 정책 화이트리스트에 `lost-found-handling`을 추가했다(part_time 제외).

> **어드민 콘솔 컬럼 추가 (2026-07-16, 마이그레이션 `202607180001_lostfound_console.sql`):**
> `category`/`return_method`/`return_tracking_no`/`hold_until`/`hold_reason` 5개 컬럼은 **RLS 정책을
> 바꾸지 않는다** — 직전(`202607170001`)에서 정의된 `lost_items` UPDATE/DELETE 정책이 그대로 적용된다
> (콘솔의 능동 처리 액션도 이 정책 아래에서 동작하며, 역할 게이트는 서버 액션의
> `canForceCompleteCleaning()`이 추가로 좁힌다). 단, 같은 마이그레이션이 추가하는 **자동 생애주기
> 함수 2종(`lostfound_auto_dispose()` / `lostfound_auto_purge()`)은 `SECURITY DEFINER`라 RLS를
> 우회하는 전역 배치 작업**이다 — pg_cron 실행에는 조직/세션 컨텍스트가 없으므로, 대상 행은
> `status`와 도쿄 기준 날짜 계산만으로 좁힌다(조직 스코프 없음, 의도된 설계). 원격 DB에 적용
> 완료(2026-07-16, MCP) — pg_cron 확장 활성화 + 두 배치 잡 등록 확인됨.

Delete:

- **Admin roles** (developer_super_admin, owner, office_admin, cs_staff): can delete any record.
- **Non-admin roles** (field_manager, staff, part_time_staff): can delete only their own records (`reported_by_user_id = auth.uid()`).
- Entry point: request list view (icon button per card) and request detail page.
- Requires confirmation modal before executing.
- Hard delete.

RLS pattern: same structure as the `maintenance_reports` delete policy above.

Additional implementation note (2026-07-09):
- Reservation-linked lost-found creation may set `property_name` / `reservation_id` / `guest_name`
  after the same organization-scoped reservation validation.
- These snapshot columns are descriptive only and do not change lost-item access control.

## reservation_internal_notes

Platform override:

- Platform admins

Read:

- All active organization members

Create / update / delete:

- Owner
- Office Admin
- CS Staff
- Field Manager

Blocked from write:

- Staff
- Part-time Staff

Notes:
- `reservation_internal_notes` is the admin reservation-calendar inspector memo table.
- Read policy is `is_platform_admin()` OR `has_active_membership(organization_id)`.
- Write policies keep the privileged operator scope:
  `is_platform_admin()` OR `has_org_role(organization_id, ['owner','office_admin','cs_staff','field_manager'])`.
- Notes are organization-scoped operational metadata and are never exposed as public reservation
  data.

## order_requests

Read:

- Active organization members.

Create:

- All active organization members (reporter = auth.uid()).

Update content:

- Creator can edit their own record.
- Field Manager, Owner, Office Admin, CS Staff, Platform admins can update any record.
- Staff and Part-time Staff can only edit their own records.

Process status (approve / reject / mark as ordered):

- Developer / Super Admin (platform)
- Owner
- Office Admin
- CS Staff
- (`order_processor` permission override)

Enforced by trigger `order_requests_processing_guard` (migration `202610190006`, 2026-10-19): the UPDATE policy is
row-level, so it lets the creator and Field Manager write any column. The BEFORE UPDATE trigger rejects (42501)
changes to `status` · `delivery_date` · `delivery_start_date` · `delivery_end_date` · `admin_memo` unless the caller is a
platform admin, owner / senior_managing_director, office_admin, cs_staff, or holds `order_processor`, and rejects any
change to `organization_id` / `reported_by_user_id`. Service-role paths (no `auth.uid()`) pass.

Cannot process status:

- Field Manager — **Note**: the RLS UPDATE policy includes `field_manager` for content edits, but the server action (`updateOrderRequestStatus`) gates status mutation on `adminWebRoles` only, which excludes field_manager. Field Manager can edit record content but cannot change status through the app.
- Staff
- Part-time Staff

Delete:

- **Admin roles** (developer_super_admin, owner, office_admin, cs_staff): can delete any record regardless of status.
- **Non-admin roles** (field_manager, staff, part_time_staff): can delete only their own records.
- Additional constraint: orders in `ordered` or `received` status should only be deleted by admin roles (the order may already be placed externally).
- Entry point: request list view (icon button per card) and request detail page.
- Requires confirmation modal before executing.
- Hard delete.

RLS pattern: same structure as the `maintenance_reports` delete policy above.

## announcements

Read:

- Targeted users.
- Platform admins.

Create:

- All roles except Part-time Staff.

Update/delete:

- Creator
- Owner
- Office Admin
- Platform admins

Comments:

- Users who can view an announcement can comment.

## notifications

Read:

- User can read own notifications.

Update:

- User can mark own notifications as read.

Create:

- Server functions/system.

## recurring_work_templates / recurring_work_occurrences

Read:

- Active organization members.

Create/update templates:

- Owner
- Office Admin
- Field Manager
- Platform admins

Complete occurrences:

- Field Manager
- Staff
- Part-time Staff if assigned/allowed
- Office-level roles if needed

## attachments

Read:

- Users who can read the target record.

Create:

- Users who can create or edit the target record.

Delete:

- Users who can delete or edit the target record.

Important:

- Storage path should include organization ID.
- Storage policies must match database permissions.

# Post-MVP Feature Batch RLS (approved 2026-06-09)

All tables below follow the standard org-isolation base: a row is accessible only when the user has an active membership in `row.organization_id`, with platform-admin bypass. Linen, tasks/projects, suggestions, board, and attendance/payroll are implemented. Full detail lives in `docs/engineering/08`–`12` and later migrations.

## linen_items

Implemented.

- Read: all active org members (platform-admin bypass).
- Create / update / delete: admin-capable roles (owner, office_admin, cs_staff, field_manager) plus platform admin — manage the item master. (Admin UI deferred; RLS is ready.)

## linen_return_records

- Read: all active org members.
- Create: all active org members.
- Update / delete: author-only, plus admin-capable roles.

## linen_return_record_items

- Read: follows parent `linen_return_records` visibility.
- Create / update / delete: same mutation rule as the parent record (author or admin-capable roles).

## tasks

Implemented (migration `202606100003_todo_tasks.sql`). RLS uses a `security definer` helper
`is_task_participant(task_id)` to avoid tasks↔participants policy recursion. Reads (lib/tasks.ts)
use the RLS-scoped client; **all writes go through service-role server actions** with explicit
permission checks (author-only core edits, participant workflow, author-leave = full delete,
non-author-all-removed → private). Direct authenticated writes to `task_participants` are denied.

**Soft delete (2026-07-29):** user task deletion sets `deleted_at` (not a row DELETE). This is
enforced in the **query lib** (`.is("deleted_at", null)` on every list/detail read), **not in RLS** —
RLS intentionally still returns soft-deleted rows so the author's `restoreTask` / `restoreConsoleTask`
(service-role, author-checked) can clear `deleted_at`. Owner-approved exception to the hard-delete
policy (CLAUDE.md §9).

- Read: active participants only.
- Create: any active org member when creating a task where they are the original author.
- Update: original author edits core task content; current participants can mutate only shared workflow-state fields through controlled actions.
- **Participant set — add: author OR any current participant (2026-07-31).** Re-sharing is allowed on
  **both** surfaces (`shareTaskWithUsers` mobile / `shareConsoleTask` console); the console had been
  author-only and was opened to match the documented rule. **Removal of others stays author-only**
  (`removeTaskParticipant`; self-removal open to everyone), and flipping `is_directive` stays
  author-only. The console action reconciles the whole set from the picker, so for a non-author it
  drops the removal delta and applies additions only — otherwise a participant could evict others.
  Note: a participant adding someone to a directive makes the new person see it as a directive from
  the ORIGINAL author; the real inviter is recorded in `task_participants.added_by_user_id`.
- Delete: original author only for the canonical task row. Participant self-removal is a separate controlled action.
- **Completion (re-introduced 2026-06-13):** complete/reopen are controlled service-role server
  actions (`completeTask` / `reopenTask`) like every other task write — they stamp/clear
  `status` + `completed_at` + `completed_by_user_id`, write an update-log row, and (on complete) fan
  out a `task_completed` notification. No direct authenticated table write.

### Daily report generation (staff-only) — as-built (2026-06-13)

The Todo **daily report** (업무일지; free, template-based — no LLM) generator is permission-gated
server-side in
`generateDailyReport(date)` via `canGenerateDailyReport(role, can_generate_report)` in
`src/config/roles.ts`:

```txt
role != 'part_time_staff'  OR  profiles.can_generate_report = true
```

- It gathers only the **caller's own** completed tasks for the given Tokyo date.
- A forbidden caller (part-time staff without the flag) is rejected by the server action and shown a
  "권한 없음" popup — UI gating alone is not relied on.
- The per-user `profiles.can_generate_report` flag is toggled by **owner / office_admin** in admin
  user management (`updateMemberReportAccess`). Regular staff are covered by the role check and never
  need the flag.

## task_participants

- Read: active participants on the parent task.
- Create: controlled server action only.
- Delete: original author may remove non-author participants; any participant may remove self.

## task_updates

- Read: active participants on the parent task.
- Create: active participants on the parent task.
- Update / delete: not required in the first slice unless product rules change later.

## task_occurrence_state

Per-occurrence state for recurring tasks (migration `202607300001_task_occurrence_state.sql`,
2026-07-30). Same participant model as `task_updates`.

- Read: participants only — `is_platform_admin()` OR `is_task_participant(task_id)`.
- Write: **server actions only (service-role).** `authenticated` has SELECT-only; all
  completed/skipped/moved writes go through the task server actions, which enforce
  org-scoping + participant checks. No direct client insert/update.

## 투두 계열의 `is_platform_admin()` 예외 — 앱에서 다시 좁힌다 (2026-09-09)

`tasks` / `task_participants` / `task_updates` / `task_occurrence_*` / `projects` 계열의 select
정책은 모두 `is_platform_admin()` 를 OR 로 달고 있다. 조직 간 운영·복구를 위해 **유지한다.**

다만 투두는 **개인 업무 공간**이다(`docs/product/18-todo-task-workflow.md` → "2026-09-09 투두
가시 범위"). 2026-09-09, 이 예외 때문에 플랫폼 관리자 계정 하나가 조직 전원의 개인 투두를 자기
「오늘」 목록에서 보고 있었다 — 앱 쿼리가 참여자 조건을 RLS 에만 맡기고 있었기 때문이다.

**정책은 바꾸지 않았다.** 대신 투두 화면이 쓰는 읽기 경로를 `src/lib/tasks.ts` 의
`getTaskScope(session)` 로 다시 좁혔다(조직 격리와 같은 원칙 — 서버에서 강제, UI 필터에 의존하지
않음). 적용 함수 표는 `docs/engineering/09-todo-task-technical-design.md` → "가시 범위 게이트".

> 새 투두 읽기 경로를 추가할 때는 그 게이트를 함께 통과시킨다. RLS 만으로는 관리자 계정에서
> 막히지 않는다.

## board_posts

- Read: all active org members.
- Create: **all active roles including part_time_staff** (confirmed 2026-06-09).
- Update / delete: author own posts; admin-capable roles moderate all (pin, archive, delete).
- **Reports · blocks (2026-10-06):** `board_reports` · `user_blocks` are service-role only (RLS on, no policies). Any active member may
  report others' posts/comments and block other same-org members; only holders of capability **`board.moderate`** (default owner · office_admin, individually grantable/deniable) see the queue and
  resolve (`canModerateBoard`); reporters may withdraw their own pending/dismissed reports. All checks live in `src/app/mobile/board/moderation-actions.ts`. See `docs/product/23-board-workflow.md` §12-C.

## staff_suggestions

**As-built (Step 1 — schema, migration `202606160001_staff_suggestions.sql`, 2026-06-16):**

- RLS enabled on `staff_suggestions`, `staff_suggestion_references`, `staff_suggestion_comments`.
- **Read** (SELECT policy on all three): `is_platform_admin()` OR `can_view_staff_suggestion(id)` —
  a `SECURITY DEFINER` helper that returns true for the author, the recipient, or a referenced user
  (references checked via the join table; definer-rights so it never recurses through these policies).
- **Writes**: no INSERT / UPDATE / DELETE policies exist, so direct authenticated writes are denied.
  All mutations are routed through **service-role server actions** (added in later steps), which carry
  the business rules below. `grant select, insert, update, delete ... to authenticated` is present but
  inert for writes without a policy; `grant all ... to service_role` lets the service role bypass RLS.

Business rules enforced by the implemented server actions:

- Create: any active org member; recipient required, same org, `<> author` (DB also checks this).
- Update / delete main suggestion by author: own row only while `status = 'submitted'`.
- Update status fields (`status`, `hold_reason`, `completion_note`): recipient only (DB CHECKs already
  require a hold reason for `on_hold` and a completion note for `completed`).
- Referenced-user rows: managed by the author only while parent suggestion is `submitted`; referenced
  user must be same-org and not the author/recipient.
- Comments: visible participants can insert; only the comment author can update/delete.

## customer_complaints / complaint_comments / external_reviews / review_translations

`customer_complaints` 및 `complaint_comments`의 현재 구현은 조직 활성 멤버 SELECT와 service-role 서버
액션 쓰기 경계를 사용한다. 수동 컴플레인 작성·상태·댓글 권한은
`docs/product/25-complaint-workflow.md`의 역할 계약을 따른다.

구현된 `external_reviews` / `review_translations` 정책은 다음과 같다.

- SELECT: `is_platform_admin()` 또는 `has_active_membership(organization_id)`.
- INSERT / UPDATE / DELETE: authenticated 직접 정책을 만들지 않는다. Beds24 동기화 서버 경로만
  service role로 UPSERT하며, 같은 조직 안에서만 예약·객실·컴플레인 연결을 검증한다.
- `raw_payload`는 일반 UI 쿼리의 선택 컬럼에 넣지 않는다. 필요한 최소 표시 필드만 반환한다.
- `private_feedback`(Airbnb 비공개 피드백)은 조직 활성 멤버 읽기 범위 안에 있으나, OTA에 공개되지 않은
  내용이므로 목록·집계 쿼리에서는 선택하지 않고 **상세 조회에서만** 반환한다. 위험도·평점 집계에
  반영하지 않는다.
- 외부 리뷰에서 수동 컴플레인을 만드는 서버 액션은 `canWriteComplaint` 역할을 재검증하고,
  review와 새 complaint의 `organization_id`가 일치하는지 확인한다. 동일 리뷰의 중복 전환을 거부한다.
- `review_translations` SELECT는 부모 `external_reviews`와 동일하게 조직 활성 멤버 및 platform admin으로
  한정한다. INSERT / UPDATE / DELETE는 authenticated에 직접 허용하지 않고, 서버의 DeepL 요청·캐시 경로만
  service role로 처리한다. 부모 리뷰와 translation의 조직 ID 일치, 목표 locale(`ko`/`ja`/`en`),
  `source_part`(`review`/`positive`/`negative`/`headline`/`private`), 원문 hash를 서버에서 검증한다.
- Beds24 리뷰 수집 경로는 `rooms.external_room_id` / `properties.external_property_id`가 요청 조직에
  속하는지 확인한 뒤에만 호출 대상에 넣는다. Booking.com 리뷰의 `reservation_id` 역조회도 같은 조직의
  `reservations`로 한정하며, 조직이 다르면 예약·객실을 연결하지 않고 null로 남긴다.

이 정책은 기획 단계이며 새 migration과 함께 구현한다. 기존 적용 migration은 수정하지 않는다.

## Attendance / Payroll tables

**As-built (Step 1 — schema, migration `202606170001_attendance_payroll.sql`, 2026-06-17).** This is the
session-first model (supersedes the earlier `attendance_events` / `employment_profiles` draft). 11
tables, all with **read-only RLS** (no write policies → direct authenticated writes are denied; all
authoritative writes go through **service-role server actions** in later steps). `grant select, insert,
update, delete ... to authenticated` is present but inert for writes without a policy; `grant all ... to
service_role` lets the service role bypass RLS.

Permission foundation:

- `memberships.attendance_payroll_admin boolean not null default false` — explicit per-membership
  attendance/payroll privilege.
- `can_manage_attendance_payroll(org)` SECURITY DEFINER helper = `is_platform_admin()` OR an active
  member who is the org `owner` or carries `attendance_payroll_admin`. **Site master / QR issuance stays
  owner-only** (app-enforced via `has_org_role(org, ['owner'])`); not broadened by this helper.

Read (SELECT) policies — "own rows, or org-wide for privileged admins" unless noted:

- `attendance_sites`: any **active member** may read (the clock UI needs site name/coords/radius;
  coordinates aren't secret).
- `attendance_qr_tokens`: **privileged admins only** (tokens authorize attendance; clock-in resolves the
  token server-side via service role).
- `attendance_trusted_devices` (2026-07-31): own rows, or `owner`/`senior_managing_director`/
  `office_admin` (분실·퇴사 시 해지해야 하므로). UPDATE 정책은 **해지(revoke) 용도로만** 열려 있고,
  발급/갱신은 쿠키 원문을 다루므로 service-role 서버 액션에서만 수행한다(INSERT 정책 없음).
  ⚠ 이 테이블의 자격증명은 **출근/퇴근 打刻 두 가지만** 허용한다. 다른 어떤 권한 판단에도 쓰지 않으며
  `middleware.ts` 의 보호 경로를 넓히지 않는다. GPS 필수 + 사이트 반경 검증은 그대로다.
- `attendance_sessions`: own (`user_id = auth.uid()`) or privileged admin (review queue / dashboard).
- `attendance_breaks`: session owner (resolved via the parent session) or privileged admin.
- `attendance_attempt_logs`: **privileged admins only** (diagnostics; no payroll effect).
- `attendance_correction_requests`: requester (`requested_by_user_id`) or privileged admin.
- `attendance_session_audits`: **privileged admins only** (manager-side trail).
- `employment_type_history` / `hourly_rate_history`: own rows (the monthly pay view shows the user their
  own type/rate segments) or privileged admin. Other users' wage figures never leak to non-admins.
- `attendance_pay_allowances` (implemented 2026-07-10, migration `202607100001`): read-only RLS —
  `has_active_membership(org) AND (target_user_id = auth.uid() OR can_manage_attendance_payroll(org))`.
  Org-wide (`target_user_id IS NULL`) rows reach a worker only through the service-role monthly pay view,
  never a direct client read. No write policies; `createAttendanceAllowance` / `cancelAttendanceAllowance`
  (service-role, `isAttendancePayrollAdmin`-gated) perform all writes and reject changes to a finalized
  user-month until it is reopened.
- `attendance_month_snapshots`: own pay rows or privileged admin (finalization queue / dashboard).
- `attendance_export_logs`: **privileged admins only**.

**Transport reimbursement (2026-06-26, migration `202606260001`).** `transport_reimbursement_reports`
/ `transport_reimbursement_items` / `transport_reimbursement_item_images` are **read-only RLS, no write
policies** (same pattern as the attendance foundation — all authoritative writes go through service-role
server actions; `service_role` bypasses RLS). SELECT policy on all three: `has_active_membership(org)`
**AND** (`user_id = auth.uid()` OR `can_manage_attendance_payroll(org)`) — i.e. own rows for any active
member, org-wide for org owner / `attendance_payroll_admin` / platform admin. This is the **same
privilege helper as payroll, but a fully separate dataset** from `attendance_month_snapshots`. Reuses
the shared `set_updated_at()` trigger.

**Annual leave — Phase 1 historical slice (2026-07-06, migration `202607060001`; later phases implemented).** `annual_leave_baselines`
is **read-only RLS, no write policies** — identical shape to transport reimbursement above: own row
for any active member, org-wide for org owner / `attendance_payroll_admin` / platform admin. All
writes go through `setAnnualLeaveBaselineAction` (`src/app/mobile/attendance/leave/actions.ts`,
service-role), which also sets `profiles.hire_date`. This migration deliberately does NOT add a leave
request/approval table — that workflow is still a planning draft (see
`docs/product/26-annual-leave-workflow.md`).

**Annual leave — Phase 2, stage 1 historical slice (2026-07-06, migration `202607060002`; approval/doc stages implemented later).** `annual_leave_requests` is
**read-only RLS, no write policies** — own row for any active member, org-wide for a NEW privilege
helper `is_leave_approver(org)` (checks `memberships.leave_approver_role is not null`, same shape as
`can_manage_attendance_payroll` but keyed off a role-enum column instead of a boolean, since the
future printed document needs to know which stamp box — 부서장/대표 vs 전무 — an approval fills).
Initial writes went through `submitLeaveRequestAction` / `cancelLeaveRequestAction`
(`src/app/mobile/attendance/leave/actions.ts`, service-role). Later admin actions added approve,
reject, revoke, proxy/self creation, balance management, documents, and exports while preserving the
same service-role and approver gates. Storage policies mirror the transport-reimbursement
5-part-path pattern, scaled to this table's 4-part path
(`{org}/annual-leave-requests/{request_id}/{file}`), open to all active members including
`part_time_staff` (same precedent as attendance-corrections/transport uploads) even though this
feature itself targets salary-based regular employees only.

**Annual leave — team calendar visibility (2026-07-06, migration `202607060003`).** A second, additive
SELECT policy `annual_leave_requests_org_approved_select` grants any active org member read access to
rows where `status = 'approved'`, org-wide — confirmed policy: the mobile leave calendar shows every
employee's approved leave (including the viewer's own), but pending/rejected/draft/cancelled stay
private (visible only via the existing self-or-approver policy). Combined with that policy, the net
effect is: own rows (any status) + approver/admin rows (any status) + everyone's approved rows.

**Membership permission overrides — implemented (schema 2026-07-09; UI/actions/enforcement 2026-07-13).**
`membership_permission_overrides` is **read-only RLS, no write policies** (same service-role write
boundary as attendance/transport/annual-leave above). Single SELECT policy
`membership_permission_overrides_owner_admin_select`: `has_org_role(org, ['owner'])` OR
`is_platform_admin()` — i.e. `owner`, owner-equivalent `senior_managing_director`, and
`developer_super_admin` may read overrides.
`office_admin` cannot (unlike role changes, where it has partial authority). A self-view policy is an
open question in `docs/product/27-permission-override-workflow.md` and is deliberately NOT added yet.
INSERT/UPDATE/DELETE have no policies, so all grant/revoke goes through the implemented service-role server
actions (`service_role` bypasses RLS). A DB CHECK `granted_by_user_id <> user_id` blocks self-grant at
the DB level (double defense).

A new SECURITY DEFINER helper `has_permission_override(org, user, key)` (same shape as `has_org_role` /
`is_leave_approver`) returns true iff an active grant exists (`revoked_at is null AND expires_at >
now()`). Migration `202607130004_permission_override_enforcement.sql` references it from order,
maintenance, and property/room policies. The report-generation override is enforced in application
code. Grant/revoke/list UI is live on `/admin/users/[id]`.

**Step 2 (2026-06-17) — site/QR write path (later admin UI implemented).** Site master + QR lifecycle writes go through the
service-role helpers in `src/lib/attendance-sites.ts` (create/update/activate site, issue/reissue/revoke
QR; QR issuance is atomic via `issue_attendance_qr`, migration `202606170002`). These helpers are
caller-agnostic and do not check the caller; the live admin settings actions enforce owner-equivalent/
platform-admin authorization before calling them. The dev-only `GET /api/dev/attendance/temp-qr`
tool remains separately gated to local development (`NODE_ENV=development`,
`ENABLE_LOCAL_DEV_TOOLS=true`, and local/LAN host).

**Step 3 (2026-06-17) — worker clock-in/out write path.** `submitAttendanceScan`
(`src/app/mobile/attendance/actions.ts`, service-role) is the first authoritative session writer: it
authenticates the user + org, validates the QR token / site / GPS-radius server-side, enforces
one-open-session-per-user, and writes `attendance_sessions` + `attendance_attempt_logs`. RLS stays
read-only (no write policies); the action holds the rules. Workers read their own sessions via the
read policy; `getCurrentOpenSession` uses the service client but is org+user scoped.

**Step 4 (2026-06-17) — break write path.** `startBreak` / `endBreak`
(`src/app/mobile/attendance/actions.ts`, service-role) write `attendance_breaks` after re-checking the
caller owns an open session server-side (auth + org). One open break at a time; clock-out is blocked
while a break is open. RLS for `attendance_breaks` stays read-only (session owner or admin); workers
read their own break rows through the parent-session policy.

**Step 5 (2026-06-17) — self-view reads.** `src/lib/attendance-history.ts`
(`getAttendanceHistory` / `getAttendanceTodaySummary`) reads sessions + breaks + site names for the
**history screen**. It uses the service client but is **strictly self-scoped**: every query pins
`user_id` to the authenticated session user (+ org) and never accepts a target user id from the client,
so a user cannot reach another user's attendance by tampering with params/query strings. (The
participant RLS read policies are the backstop; the self-scoping is enforced in the query layer.) No
org-wide reads here — the admin review queue is a later step.

**Step 6 (2026-06-17) — correction request write/read path.** `createAttendanceCorrectionRequest`
(`src/app/mobile/attendance/actions.ts`, service-role) writes `attendance_correction_requests` after
**self-only** checks (a linked session must be the caller's own → else `forbidden`) and a **current/
previous Tokyo month** range check (→ else `out_of_range`). It only suggests values; it never mutates the
session (no auto-apply). Reads (`src/lib/attendance-corrections.ts`) pin `requested_by_user_id` to the
authenticated user. Correction photos upload to `request-images/<org>/attendance-corrections/...`;
storage RLS migration `202606170003` whitelists that folder (part-time members included, since
attendance is open to all active members). The participant RLS read policy on
`attendance_correction_requests` (requester or admin) is the backstop; admin approve/reject is Step 7.

**Step 7 (2026-06-17) — admin review (org-wide).** First org-wide attendance surface. The privilege gate
`isAttendancePayrollAdmin(service, org, userId)` (`src/lib/attendance-review.ts`) = platform admin OR
active `owner` / `attendance_payroll_admin` member; **site-master management stays owner-only** (not
broadened). The review-queue read (`getAttendanceReviewQueue`) is caller-agnostic (the web-dashboard
caller must gate it; the `can_manage_attendance_payroll` SELECT RLS policies from Step 1 are the
backstop). The write actions (`src/app/admin/attendance/actions.ts`: approve / reject / in-review)
**enforce the gate themselves** before any write. Approve mutates the linked session (service-role) +
writes `attendance_session_audits`; reject never touches the session. Workers still only read their own
rows; admins read org-wide via the privileged SELECT policies. No org-wide UI yet (web dashboard).

**Step 8 (2026-06-17) — manual admin management.** `createManualAttendanceSession` /
`updateAttendanceSessionAdmin` / `invalidateAttendanceSession` (`src/app/admin/attendance/actions.ts`,
service-role) all **enforce `isAttendancePayrollAdmin` server-side** before any write, require a
mandatory reason, and write `attendance_session_audits`. Create validates the target is an active org
member + sites belong to the org. Invalidate sets `status='invalid'` (no hard delete) — preserving the
"invalidate / supersede, never erase" rule. Site-master management stays owner-equivalent/platform-admin
only. The admin review and manual-management UI is live under `/admin/attendance/*`.

**Step 10 (2026-06-18) — hourly pay self-view.** `src/lib/attendance-pay.ts` (`getMonthlyPayView`) reads
sessions + breaks + the user's own `hourly_rate_history` / `employment_type_history` and is **strictly
self-scoped** (pins `user_id` to the authenticated user + org; no client target). It produces EXPECTED
pay only (no writes, no finalization). Org-wide compensation visibility remains restricted; other
users' rate/history/pay never load for ordinary workers. Employment/rate management is implemented in
the privileged admin wages console; the dev-only seed route remains for local testing.

**Implemented — attendance allowances (2026-07-10, migration `202607100001`).**
`attendance_pay_allowances` follows the same payroll-sensitive boundary: no direct authenticated writes,
service-role server actions only (`createAttendanceAllowance` / `cancelAttendanceAllowance`), and
server-side `isAttendancePayrollAdmin` enforcement for create/cancel. Self pay reads include only
allowances applicable to the authenticated user's own monthly pay view (surfaced through the service-role
`getMonthlyPayView`). Org-wide allowance management and payroll-panel visibility are limited to `owner` /
`attendance_payroll_admin`. The server actions check finalized snapshots and reject allowance changes for
a closed user-month (per-user for a targeted row, any-finalized for an org-wide row) unless that month is
reopened first.

**Step 11 (2026-06-18) — monthly finalization.** `finalizeAttendanceMonth` / `reopenAttendanceMonth`
(`src/app/admin/attendance/actions.ts`, service-role) **enforce `isAttendancePayrollAdmin` server-side**;
reopen requires a reason. They write `attendance_month_snapshots` and an `audit_logs` row each. The
worker pay self-view reads the current `finalized` snapshot via `getMonthlyPayView` (still self-scoped to
the authenticated user). `attendance_month_snapshots` RLS stays read-only (own pay rows or privileged
admin, from Step 1); writes go through the privileged actions only. The admin payroll UI exposes
finalize/reopen with these same gates.

**Step 12 (2026-06-18) — org-wide payroll totals.** `getPayrollTotals(org, ym)`
(`src/lib/attendance-payroll-totals.ts`) reads ORG-WIDE compensation (finalized snapshots + every hourly
worker's expected pay + site rollup). It is **caller-agnostic and the caller MUST gate it with
`isAttendancePayrollAdmin`** (owner / `attendance_payroll_admin`) — same pattern as the review queue; the
`can_manage_attendance_payroll` SELECT RLS on `attendance_month_snapshots` is the backstop. Regular users
and hourly workers never reach org-wide totals (they only see their own pay). Read-only; no writes;
the totals are surfaced in the privileged admin attendance/payroll console.

**Step 13 (2026-06-18) — finalized-only export.** `runPayrollExport` (`src/lib/attendance-export.ts`,
service-role) **enforces `isAttendancePayrollAdmin` itself** before reading any finalized snapshot, then
writes an `attendance_export_logs` audit row. Export is **finalized data only**; regular users / hourly
workers can never export. The server actions (`exportMonthlyPayroll` / `exportUserPayroll`) and the
dev-only route (`/api/dev/attendance/export`, dev-gated AND privilege-gated) both go through it. The
admin console additionally exposes localized Excel and print-to-PDF exports.

**Step 14 (2026-06-18) — notifications + reminder.** Admin attendance alerts (`attendance_activity`) target
**owner / `attendance_payroll_admin` only** — `getAttendancePayrollAdminUserIds` resolves the recipients
server-side and `notifyAttendanceAdmins` never broadens visibility; regular workers never receive org-wide
attendance/payroll alerts. The 18:30 reminder targets the worker themselves. `attendance_open_session_reminders`
RLS is **own read** (owner of the row or platform admin); writes go through the self-only
`respondOpenSessionReminder` action (service-role). Unique constraint is
`(organization_id, user_id, operating_date)` — org-scoped (migration `202606180003`; prior constraint
was missing `organization_id`). The scheduled scan `/api/attendance/reminders` is
CRON_SECRET-gated (no anonymous trigger). In-app delivery only.

Business rules already enforced (Step 3) / to enforce later in server actions: one open session per user
(done); sites required (done); GPS mandatory + within radius (done); PWA active method `gps_qr` (done;
`gps_wifi` modeled but inactive); midnight-crossing flagged `review_required` (baseline done);
sites required (no free-text locations); GPS mandatory; PWA active method `gps_qr` (`gps_wifi` modeled
but inactive); clock-out blocked while a break is open; correction window = current + previous month;
reject comment required on correction reject; finalization (owner / `attendance_payroll_admin`) blocked
while review-required / pending-correction / open / reopened items remain; export covers finalized data
only. See `docs/engineering/11-attendance-payroll-technical-design.md`.

## audit_logs

Read:

- Platform admins.
- Owner/Office Admin later if an admin audit UI is added.

Create:

- Server functions/system only.

Update/delete:

- No normal user updates/deletes.

## Auth / Identity Linking Contract

"**Same email = same account**" is a confirmed product policy. Its enforcement currently depends on **Supabase Auth configuration**, not application code:

- **Automatic identity linking must be enabled**, and **email confirmations must be required**. Under these settings, when a Google sign-in's email matches an existing user's *confirmed* email, Supabase links the Google identity to that user instead of creating a duplicate (verified in this project: the owner account carries both `email` and `google` identities).
- The **email-signup** path additionally handles the reverse collision in app code: `supabase.auth.signUp` returning a user with `identities.length === 0` means the email already exists, and the user is redirected to log in (`resume_existing_account`) — `src/app/auth/actions.ts`.
- **Google sign-in** (`signInWithGoogle`) does **not** add explicit linking/collision handling; it relies on the Supabase behavior above. A manual `linkIdentity` flow (the designed "계정 연결" screen) is intentionally **not** wired yet, because Supabase enforces email uniqueness today.
- **Risk if the config drifts:** if email confirmation or automatic linking is turned off, a same-email Google sign-in could diverge into a separate account. If that policy is ever needed independent of the Supabase setting, wire the manual link-identity flow.

> **Action item:** confirm in the Supabase dashboard (Auth settings) that automatic account linking is on and email confirmations are required.

## 게시판 (board_posts / board_post_reads / board_comments / board_reactions)

마이그레이션 `202606250001_board.sql` (2026-06-25 적용).

**board_posts**
- SELECT: `deleted_at is null AND has_active_membership(organization_id)`
- INSERT: `created_by_user_id = auth.uid() AND has_active_membership(organization_id)` — part_time_staff 포함 전체 활성 멤버
- UPDATE: `created_by_user_id = auth.uid() OR has_org_role(org_id, [owner, office_admin])`
- DELETE: `created_by_user_id = auth.uid() OR has_org_role(org_id, [owner, office_admin])`

**board_post_reads** — 자기 row 만 read/insert/update (user_id = auth.uid())

**board_comments**
- SELECT: `deleted_at is null AND has_active_membership(organization_id)`
- INSERT: `created_by_user_id = auth.uid() AND has_active_membership(organization_id)` — `allow_comments` 체크는 서버 액션 레벨에서 수행 (RLS 정책에 포함되지 않음)
- DELETE: `created_by_user_id = auth.uid() OR has_org_role(org_id, [owner, office_admin])`

> **@멘션 보안**: `mentioned_user_ids`의 각 UUID가 같은 org 활성 멤버인지는 **서버 액션 레벨**에서 검증 (RLS만으로 배열 원소 단위 검증 불가). 클라이언트가 임의 UUID를 삽입해도 서버에서 거부.

**board_reactions**
- SELECT/INSERT: `has_active_membership(게시글의 organization_id 서브쿼리)` + user_id = auth.uid()
- DELETE: user_id = auth.uid()

**스토리지 RLS**
- `request-images`: `board-posts` / `board-comments` 폴더 추가 (part_time_staff 허용). `202606250001_board.sql`에서 "org members can upload/delete request images" 정책 재생성.
- `board-attachments` (새 버킷, private): org 멤버 SELECT·INSERT; 업로드한 본인만 DELETE (owner = auth.uid()).
- `request-images`: 교통비 증빙용 **5단계 경로** 정책 추가 (`202606260001_transport_reimbursement.sql`). 경로 `{org}/transport-reimbursements/{report_id}/{item_id}/{file}`. 기존 정책은 4단계 경로를 강제하므로, "org members can upload/delete transport reimbursement images" 정책을 별도로 추가 (permissive 정책은 OR 결합 → 4단계·5단계 공존). org_id·report_id·item_id 모두 UUID 형식 검증, 활성 org 멤버(part_time_staff 포함) 또는 platform admin 허용.

## bug_reports

**1차 구현 (2026-06-25).** Foldy 앱/시스템 버그 신고 테이블. Migration: `supabase/migrations/<timestamp>_bug_reports.sql` (DB engineer 결과 확인 후 파일명 갱신 필요). 모든 쓰기는 **서비스롤 서버 액션** 경유; RLS 는 코드 게이트와 이중으로 적용.

### 리뷰어 정의 (1차 확정)

```txt
owner, office_admin
```

`cs_staff` / `developer_super_admin` 리뷰어 확장: open question, deferred.

### SELECT

```txt
reported_by_user_id = auth.uid()                              -- 작성자 본인
OR has_org_role(organization_id, ['owner', 'office_admin'])   -- 리뷰어
```

### INSERT

```txt
has_active_membership(organization_id)
AND reported_by_user_id = auth.uid()
```

모든 활성 org 멤버 (part_time_staff 포함) 신고 가능.

### UPDATE

두 가지 별도 정책:

```txt
-- 작성자 본인 수정 (submitted 상태만)
reported_by_user_id = auth.uid()
AND status = 'submitted'

-- 리뷰어 상태 변경
has_org_role(organization_id, ['owner', 'office_admin'])
```

1차에서 수정 페이지는 UI 숨김 (deferred). `updateBugReportStatus` 서버 액션이 리뷰어 상태 변경을 처리.

### DELETE

```txt
reported_by_user_id = auth.uid()
AND status = 'submitted'
```

작성자만 `submitted` 상태일 때 hard delete 가능. **리뷰어 hard delete는 1차 불허** — 별도 관리 정책 승인 시 추가.

## Open Questions

- ~~Should Staff be allowed to status-change lost items and maintenance forever, or only certain
  statuses?~~ → **해결 (2026-07-14):** 수리·점검은 `staff`를 UPDATE 정책에 명시적으로 포함하고
  상태 제한은 두지 않는다 (마이그레이션 `202607160001_maintenance_backend.sql` §5). 현장이 처리하는
  것이 이 기능의 전제이기 때문이다. `part_time_staff`만 앱 레벨에서 읽기 전용.
- Should CS Staff be allowed to export cleaning records by default?
- Should Field Manager be able to delete other users' records?
- Should hard delete be blocked if a record has attachments?
- Should some actions require server functions instead of direct table updates?
## 2026-07-10 Property Operation Info Permissions

`public.property_operation_infos`

- `SELECT`: active organization members in the same org, plus platform/developer super admins
- `INSERT / UPDATE / DELETE`: `owner`, `office_admin`, `cs_staff`, plus platform/developer super admins
- purpose: shared calendar building metadata consumed by both admin and mobile reservation calendar
- app-level write gate (2026-10-19): the only write path is `savePropertyOperationInfoAction`
  (`src/app/admin/calendar/actions.ts`), which writes with the **service-role** client (RLS bypassed). It now
  rejects any role outside `canEditPropertyOperationInfo` (`src/lib/admin-calendar-dashboard.ts` —
  developer_super_admin · owner · senior_managing_director · office_admin · cs_staff, the same set as the RLS
  policy above). Before this, `requireAdminSession` alone let `field_manager` / `staff` overwrite door codes.

## 2026-07-14 teams (소속: 현장/사무실)

**Phase 1 implemented (2026-07-14), migration `supabase/migrations/202607140001_teams.sql` — written,
not yet applied.** See `docs/planning/01-decision-log.md` → 2026-07-14 and
`docs/engineering/04-data-model.md` → `teams`.

- `teams`:
  - SELECT: `organization_id in (select organization_id from active memberships for auth.uid())` —
    any active org member (assignment dropdowns / filters need to read team names).
  - No INSERT/UPDATE/DELETE policies — writes go only through service-role server actions
    (`setMemberTeam`, `src/app/admin/users/actions.ts`), gated by the same
    `actorCanManageUsersInOrg` check as `memberships.manage_users` (developer default or an explicit
    `manage_users` delegation).
- `memberships.team_id`: no separate RLS — covered by the existing `memberships` SELECT/write policies
  above. Writes to this column go through `setMemberTeam`, which additionally validates the target
  team belongs to the same org as the membership before saving.

## 2026-07-13 User/Permission Model Rework

Full decision record: `docs/planning/01-decision-log.md` → 2026-07-13 ("사용자/권한 모델 개편"). Summary
of the RLS/permission-relevant pieces:

- **`senior_managing_director`(전무) = owner-equivalent.** Migrations `202607130002` (enum value) then
  `202607130003` (`has_org_role` redefinition — the only place this needed to change; every policy that
  gates on `'owner'` via `has_org_role` now also passes for an active 전무 membership, with zero
  per-policy edits). App-side helper `isOrgTopAdmin(role)` mirrors this in `src/config/roles.ts`.
- **`/admin/users` (+ actions + `/admin/users/invites`) access is developer-default +
  `manage_users`-delegation gated**, not role-gated. Migration `202607130001` adds
  `memberships.manage_users boolean default false`. `owner`/`office_admin` get **no automatic access**
  to the user-management screen without an explicit delegation; only `developer_super_admin` (platform
  role) can grant/revoke `manage_users` and cannot be locked out of its own developer status. The RLS
  Create/Update policies on `memberships` above are a backstop only — real enforcement is in
  `src/lib/user-management-access.ts` + service-role server actions.
- **Status model stays `invited`/`active`/`suspended`/`removed`(unchanged enum, no migration)**, but the
  user-facing UI now only exposes **활성(active) / 비활성(maps to `suspended`)**. Setting 비활성 now also
  bans the Supabase auth user (`ban_duration: "876000h"`), so it blocks login itself, not just
  org-scoped session access. Setting 활성 unbans.
- **Guard-railed hard delete (`deleteMember`, no migration):** blocked if the target has any
  `attendance_sessions` / `cleaning_sessions` / `annual_leave_requests` rows (`has_activity`) — must be
  deactivated instead. If no activity exists, deletes memberships → profile → the Supabase auth account.
  Self-delete is blocked server-side.
- **Permission-override enforcement (migration `202607130004`):** `has_permission_override(org, user,
  key)` is now actually wired into RLS for `order_processor` (`order_requests` UPDATE),
  `maintenance_status_change` (`maintenance_reports` UPDATE), and `property_room_manage` (new `for all`
  policies on `properties`/`rooms`, plus authenticated DML grants so RLS can allow an override-holder);
  `can_generate_report` is enforced in app code (`hasPermissionOverride()` in the mobile report action),
  not RLS. See `docs/product/27-permission-override-workflow.md`.
- **Migrations to apply for full effect:** `202607130001` (manage_users), `202607130002` +
  `202607130003` (전무, apply in that order), `202607130004` (override enforcement).

## 2026-08-03 연차 baseline — 검증을 유일한 쓰기 지점으로 이동

**문제.** `setAnnualLeaveBaselineForUser()`(`src/lib/annual-leave-server.ts`)는 service-role
클라이언트로 쓰므로 **RLS 가 아무것도 막지 않는다.** 그런데 상한·자격 검사가 관리자 경로
(`saveEmployeeLeaveBaseline`)에만 있었고, 모바일 자가 설정 액션
(`src/app/mobile/attendance/leave/actions.ts`)에는 형식 검사(날짜 포맷, 음수 아님)뿐이었다.
→ **직원이 모바일에서 자기 연차 부여일수와 입사일을 무제한으로 자기부여**할 수 있었다. 급여와
직결되는 값이다.

**수정.** 검증을 **공용 writer 안**으로 옮겼다. baseline 쓰기 지점이 이 함수 하나뿐이므로,
호출자가 늘어나도 자동으로 같은 규칙을 받는다.

| 규칙 | 값 |
| --- | --- |
| 입사일 형식 | `YYYY-MM-DD` |
| 부여일수 | `0 ≤ grant ≤ MAX_LEAVE_GRANT`(40) |
| 가산일수 | `0 ≤ bonus ≤ MAX_LEAVE_BONUS`(8) |
| 멤버십 | 해당 조직에서 `status = active` |
| 역할 | `LEAVE_HOURLY_ROLE`(`part_time_staff`) **제외** |

값과 규칙은 전부 관리자 경로에 있던 것을 그대로 옮겨온 것이라 **동작 변화는 없다** — 막혀 있어야
했는데 안 막히던 경로가 이제 막힐 뿐이다. 관리자 경로의 하드코딩(`40`/`8`)과 로컬 `HOURLY_ROLE`
상수도 공용 상수를 참조하도록 바꿔 정의가 갈라지지 않게 했다.

**호출자별 검사 금지.** 이 값은 급여 계산에 들어가므로, 새 호출 지점을 만들 때 **자체 검증을
추가하지 말고** 이 함수를 통해서만 써야 한다.

## 2026-08-03 쓰기 RPC 의 PUBLIC EXECUTE 회수

마이그레이션 `202608030002_revoke_public_execute_write_rpcs.sql` (원격 적용 완료).

**문제.** Postgres 는 함수를 만들면 **기본으로 PUBLIC 에 EXECUTE 를 준다.** Supabase 의 `anon` /
`authenticated` 도 PUBLIC 의 일원이라, `SECURITY DEFINER` 쓰기 함수가 PostgREST 의
`/rest/v1/rpc/<fn>` 로 **로그인 없이 호출 가능**했다.

가장 위험했던 것은 `issue_attendance_qr` 이다. 함수 본문에 **권한 검사가 전혀 없고** 인자를 그대로
믿는다:

```
1. 그 사이트의 활성 QR 을 전부 폐기(revoked_at)
2. 호출자가 준 토큰 문자열로 새 QR 발급
```

즉 org/site UUID 만 알면 로그인 없이 ① 인쇄된 근태 QR 을 먹통으로 만들고(출근 체크 불가)
② **자기가 정한 토큰**으로 새 QR 을 발급해 현장에 있지 않아도 유효한 토큰을 쥘 수 있었다.

**조치.** 아래 4개에서 `public` / `anon` / `authenticated` 의 EXECUTE 를 회수하고 `service_role`
만 남겼다. 네 함수 모두 앱에서는 service-role 클라이언트로만 호출하므로 동작 변화는 없다.

| 함수 | 앱 호출 지점 |
| --- | --- |
| `issue_attendance_qr` | `src/lib/attendance-sites.ts` |
| `update_staff_suggestion` | `src/app/mobile/suggestions/actions.ts` |
| `lostfound_auto_dispose` / `lostfound_auto_purge` | 앱 호출 없음(운영 자동화) |

**RLS 판정 헬퍼는 건드리지 않는다.** `is_task_participant` / `has_org_role` / `is_platform_admin`
등은 RLS 정책 안에서 **호출자 역할로 실행**되므로 `authenticated` 에서 회수하면 정책 평가가 통째로
깨진다. advisor 가 계속 경고하지만 이들은 판정 전용이고 `auth.uid()` 없이 부르면 아무것도
돌려주지 않는다 — **의도된 노출**이다.

**새 RPC 를 만들 때**: 쓰기 함수는 생성 직후 반드시
`revoke execute … from public, anon, authenticated` + `grant execute … to service_role` 을 함께
넣을 것. 기본값이 PUBLIC 이라 아무것도 안 하면 열린 채로 배포된다.

## 2026-09-30 Beds24 락·요금 upsert RPC 2종 — 처음부터 service_role 전용

마이그레이션 `202609300001_beds24_lock_rpc.sql` · `202609300002_room_daily_rates_upsert_if_newer.sql`
(운영 적용 완료). 위 2026-08-03 규칙을 지켜 **생성 시점부터** `revoke all … from public, anon,
authenticated` + `grant execute … to service_role` 을 함께 넣었다 — 나중에 회수한 것이 아니다.

| 함수 | 앱 호출 지점 |
| --- | --- |
| `beds24_try_lock` / `beds24_release_lock` | `src/lib/beds24/sync-locks.ts` (`acquireBeds24Lock`/`releaseBeds24Lock`) |
| `upsert_room_daily_rates_if_newer` | `src/lib/beds24/room-rates-sync.ts` |

둘 다 `language sql` · `SECURITY INVOKER` — `SECURITY DEFINER` 가 아니므로 「§2. `SECURITY DEFINER` 판정
헬퍼는 «`auth.uid()` 로 잠근다» 를 지켜야 한다」 규칙과는 무관하다. 데이터 모델 상세:
`docs/engineering/04-data-model.md` → 해당 함수명 섹션.


## 2026-09-04 RLS 작성 규칙 두 가지 (실측으로 확인된 함정)

### 1. 정책 안의 `auth.uid()` 는 `(select auth.uid())` 로 감싼다

그냥 쓰면 Postgres 가 **행마다** 재평가한다. 서브쿼리로 감싸면 InitPlan 이 되어 쿼리당 한 번이다.
결과는 같으므로 권한은 바뀌지 않는다. 인자가 없어 행에 무관한 헬퍼(`is_platform_admin()`)도 같다.

**행 값을 인자로 받는 헬퍼는 감싸지 않는다** — `has_active_membership(organization_id)`,
`is_task_participant(id)` 등은 감싸면 상관 서브쿼리가 되어 오히려 손해다.

**2026-09-08 기준 DB 전체에 적용 완료**(132개 중 127개 — 나머지 5개는 `auth.uid()` 를 쓰지 않는다).
`supabase/migrations/202609080002_rls_initplan_sweep.sql` 이 자기 정의를 읽어 재작성하는 DO 블록이라
여러 번 실행해도 안전하다. **새 정책을 만들 때는 처음부터 감싸서 쓸 것** — 그러지 않으면 다음 스윕
때까지 행별 재평가가 남는다.

### 2. `SECURITY DEFINER` 판정 헬퍼는 «`auth.uid()` 로 잠근다» 를 지켜야 한다

이 헬퍼들은 PostgREST 의 `/rest/v1/rpc/<fn>` 로 **로그인 없이도 호출 가능**하다. 그래도 괜찮은
이유는 내부에서 `auth.uid()` 를 읽어 비로그인 호출에 아무것도 돌려주지 않기 때문이다
(`202608030002` 의 판단).

**그 규약을 깨는 헬퍼를 만들면 안 된다.** `has_permission_override` 는 대상 사용자를 `auth.uid()`
가 아니라 **인자로** 받아서, 비로그인 호출자가 임의 사용자의 권한 설정을 조회할 수 있었다
(2026-09-04 수정, `202609040002`).

새 판정 헬퍼를 추가할 때 확인할 것:
- 「누구에 대한 판정인가」를 인자로 받는가? 받는다면 `auth.uid()` 검사와 조직 멤버십 검사를 함께 넣어라.
- ALL/SELECT 정책에서 쓰이는가? 그렇다면 **EXECUTE 회수는 답이 아니다** — 정책 평가가 false 가
  아니라 권한 에러로 끝난다. 함수 안에서 막아라.

## job_applications (2026-09-09)

채용 지원서. 마이그레이션 `202609090001_job_applications.sql`.

- SELECT: `has_org_role(organization_id, ['owner','senior_managing_director','office_admin'])`
  또는 활성 platform admin. **어드민 웹 접근 가능 전 역할에 열지 않는다** — `field_manager`·`staff`
  는 제외다. 지원서는 이름·연락처·주소·비자 정보가 함께 담긴 민감 개인정보다.
- INSERT / UPDATE / DELETE 정책 **없음**. 수신 웹훅과 심사 서버 액션이 service-role 로 조직을
  재확인한 뒤 쓴다(`external_reviews` 와 같은 방식). `authenticated` 에는 `select` grant 만 있다.
- `auth.uid()` 와 `platform_admins` 조회는 `(select ...)` 로 감싸 InitPlan 으로 만든다
  (`auth_rls_initplan`). `has_org_role(organization_id, ...)` 는 행 값을 인자로 받으므로 감싸지 않는다.

스토리지 버킷 `recruit-resumes` 는 `public = false` 이고 `storage.objects` 에 authenticated 정책을
두지 않는다. 업로드는 서버가 service-role 로만 하고(RLS 우회), 열람은 서버가 만든 서명 URL 로만
한다.


## 2026-09-29 `beds24_block_logs`

> 2026-09-30 이후 읽기는 `ops_admin.access` 보유자로 좁혀졌다 — 아래 「판매 캘린더 작업·이력 표」 참고.

`beds24_price_jobs` 와 같은 규칙이다 — 조직 구성원(`has_active_membership`) · 플랫폼 관리자는 **읽기**,
쓰기는 **서비스 롤만**(서버 액션이 운영 관리자 권한 `canAccessOpsAdmin` 을 확인한 뒤 남긴다).
판매 캘린더 「이력」 패널의 서버 액션(`loadOpsChangeHistory` · `loadOpsSendLog` · `sendPendingPriceJobs`)은
service-role 로 읽으므로 **조직을 쿼리에 직접 건다**(`organization_id = session.organization.id`).

## 2026-09-30 `beds24_deferred_refreshes` · Beds24 틱 함수 — service_role 전용

마이그레이션 `202609300003_beds24_deferred_refreshes.sql` · `202609300004_beds24_tick_cron.sql` (운영 미적용).

- `beds24_deferred_refreshes`: RLS 켜고 **정책 없음** + `revoke all … from anon, authenticated` +
  `grant all … to service_role`. `beds24_sync_state` 와 같은 방식이다 — 사용자 클라이언트가 읽을 이유가
  없다. 조직 경계를 넘는 시스템 표라(건물 하나 = 조직 하나) 틱이 행에 적힌 `organization_id` 로 재조회를
  돌린다. 그 재조회(`syncBeds24RoomRates` · `syncBeds24RoomBlocks`)는 모든 쿼리에 그 조직을 직접 건다.
- `beds24_tick_token_ok(text)` · `beds24_tick_if_needed()`: `SECURITY DEFINER`(Vault 읽기) ·
  `search_path = ''` · `revoke all … from public, anon, authenticated` + `grant execute … to service_role`.
  토큰 대조 함수는 **값을 돌려주지 않고** 일치 여부만 돌려준다.
- `/api/beds24/tick` 은 사람 세션이 아니라 토큰으로 연다 — Vault 토큰(pg_net 호출), 또는 워커와 같은
  `CRON_SECRET` / `BEDS24_WEBHOOK_SECRET`. 토큰은 헤더로만 받는다(쿼리 문자열은 접근 로그에 남는다).

## 2026-09-30 판매 캘린더 작업·이력 표 — 읽기도 `ops_admin.access`

마이그레이션 `202609300007_ops_logs_capability_read.sql` (운영 미적용).

대상: `beds24_price_jobs` · `price_change_logs` · `beds24_block_logs`.

- **SELECT 전**: `has_active_membership(organization_id) OR is_platform_admin()` — 조직 구성원이면 누구나.
  화면(`/admin/ops/*`)은 `ops_admin.access` 로만 열리는데 RLS 는 전원에게 열려 있어, 현장 직원 세션으로
  REST 를 직접 치면 가격 작업 본문·변경자·차단 요청자가 읽혔다.
- **SELECT 후**: `to authenticated using (organization_id = any ((select public.capability_organization_ids('ops_admin.access'))::uuid[])`.
  정책 이름 `ops admins can read organization price jobs` / `… price logs` / `… block logs`.
- **판정식은 `has_capability`** 그대로다(차단 우선 · `capability_roles` · 개인 부여/차단 · 만료/회수 ·
  플랫폼 관리자 통과 · 전무 = 대표). 앱의 `canAccessOpsAdmin`(= `session.capabilities` 에 키가 있는가)과
  같은 답이다. 역할 배열을 정책에 적지 않는다.
- 새 헬퍼 `capability_organization_ids(text) returns uuid[]` — `SECURITY DEFINER` · `search_path = public` ·
  `stable` · EXECUTE 는 `authenticated` 만. **대상자를 인자로 받지 않고 `auth.uid()` 만 본다**(RLS 작성 규칙 2).
  호출자의 active 멤버십 중 `has_capability` 가 참인 조직만 돌려준다. 비로그인은 빈 배열.
  - 두는 이유: `has_capability(organization_id, …)` 를 정책에 바로 쓰면 **행마다** 평가된다(SECURITY DEFINER
    는 인라인되지 않는다). 판매 캘린더가 `price_change_logs` 를 창 전체로 읽으므로, 조직 목록을 InitPlan 으로
    쿼리당 한 번 구한다(RLS 작성 규칙 1).
  - 정책을 `to authenticated` 로 한정한 이유: EXECUTE 를 anon 에 주지 않았으므로 anon 에게 정책이 평가되면
    false 가 아니라 권한 에러가 난다. 한정하면 anon 에는 적용되지 않는다.
- 플랫폼 관리자: 멤버십이 있으면 헬퍼 목록에 들고(bypass), 없어도 기존 `platform admins can manage …` FOR ALL
  정책으로 읽는다 — 이전과 같다.
- INSERT / UPDATE / DELETE 정책은 **바꾸지 않았다**. 쓰기는 service-role.
- 사용자 세션(RLS)으로 이 표를 읽는 곳은 `getOpsCalendarData`(`/admin/ops/calendar`, `requireOpsAdminPage`)와
  `getOpsPriceConversions`(`loadOpsPriceConversions`, `requireOpsWriter`) 두 곳뿐이고 둘 다 이미
  `canAccessOpsAdmin` 뒤에 있다. 나머지(이력 패널 · 작업 상태 · 워커 · 틱 · 웹훅)는 service-role. 세 표를
  `postgres_changes` 로 구독하는 화면은 없다. 따라서 정당한 사용자의 동작은 바뀌지 않는다.
- 검증 SQL 은 마이그레이션 파일 끝의 주석(정책 목록 · 사용자 시뮬레이션 · 실행 계획)을 쓴다.

## 2026-09-30 Realtime `beds24-live:<조직>` — private 채널 (`realtime.messages`)

- 마이그레이션: `supabase/migrations/202609300006_beds24_live_private_channel.sql`.
- 정책 `beds24_live_members_receive` — `realtime.messages` **SELECT**, `to authenticated`:
  `extension = 'broadcast'` 이고 `(select realtime.topic())` 가 `'beds24-live:' || <그 사용자가
  `memberships.status = 'active'` 인 조직 id>` 와 같을 때만. `auth.uid()` 는 `(select auth.uid())` 로 감쌌다.
- **INSERT 정책 없음** — 브라우저는 이 토픽으로 보낼 수 없다. 송신은 `signalBeds24Change`
  (`src/lib/beds24/live-signal.ts`)가 service role JWT 로 `httpSend`(private) 해 RLS 를 우회한다.
- 토픽을 uuid 로 캐스팅하지 않고 문자열로 비교한다 — 다른 private 토픽이 생겨도 캐스팅 에러로 그 구독까지
  막지 않게.
- 이 마이그레이션 전에는 `realtime.messages` 에 정책이 하나도 없었다(다른 정책을 건드리지 않음).
  `calendar-reservations:*` · `recruit-applications:*` 는 public `postgres_changes` 구독이라 이 정책과 무관하고,
  프로젝트 Realtime 「Allow public access」 설정도 바꾸지 않았다.
- 배포 순서: 마이그레이션 **먼저**, 클라이언트(private 구독) 배포는 그 다음.

## 2026-09-30 판매 캘린더 · Beds24 웹훅 — 조직 격리 보강 (감사 저위험 3건)

- **행 키는 서버가 다시 계산한다.** `submitManualBooking` · `submitReservationEdit`
  (`src/app/admin/ops/calendar/actions.ts`)는 화면이 보낸 `roomKey` 를 믿지 않는다. 넘어온 `rooms.id` 를
  세션 조직으로 읽고 `resolveOpsRowRoomKey`(`src/lib/ops-room-key.ts`, 격자 `mapRoomUnits` 와 같은
  `opsUnitRoomKey`)로 키를 다시 만든다. 조직 밖 id 가 하나라도 있거나, 유닛이 한 행으로 모이지 않거나,
  화면 키와 다르면 거절(수동 예약 `unknown_room`, 예약 수정 `not_found`). 겹침 검사는 서버 키만 쓴다.
- **「지금 보내기」는 호출 조직의 가격 작업만.** `runNextPriceJob(supabase, { organizationId })` →
  `claimNextJob` 이 `organization_id` 로 거른다. 크론 · 틱 · 킥 경로는 인자 없이 전역(Beds24 계정 하나).
- **웹훅 예약의 조직은 DB 매핑이 정한다.** `processBeds24WebhookBooking` 은 페이로드의
  `organizationId`/`orgId` 등을 더 이상 읽지 않는다. `properties.external_property_id`(없으면
  `rooms.external_room_id`, 둘 다 `external_provider = 'beds24'`) → `organization_id` 로 정하고
  (`src/lib/beds24/webhook-organization.ts`), 매핑이 없거나 여러 조직으로 갈릴 때만 서버 기본값
  (세션 조직 · `BEDS24_DEFAULT_ORGANIZATION_ID`)으로 떨어진다. 매핑에 세션 조직이 있으면 세션 조직.

## 2026-09-30 `has_capability` 는 자기 자신만 (마이그레이션 `202609300008_has_capability_self_only.sql`)

`has_capability(org, user, key)` 는 SECURITY DEFINER 이고 `authenticated` 에 EXECUTE 가 있다. 대상 사용자를
인자로 받아서, 로그인한 누구나 RPC 로 **다른 직원의 권한 보유 여부**를 조회할 수 있었다(위 RLS 작성 규칙 2 가
경고하는 형태 — 데이터는 아니지만 권한 지도가 샌다).

- 판정 본문은 그대로 두고 첫 조건만 더했다: `auth.uid() is null or target_user_id = auth.uid()`.
  JWT 가 있는 호출에서 대상이 본인이 아니면 `false`. 서비스 롤(JWT 에 sub 없음)과 SQL 직접 실행은 예전과 같다.
- 호출처는 전부 `auth.uid()` 를 넘기므로 동작 변화 없음: `job_applications` 읽기 정책,
  `capability_organization_ids()`(판매 캘린더 로그 3표 읽기 정책). anon 은 원래 EXECUTE 가 없다.
- 운영 검증(2026-09-30): 이수현 계정으로 본인 `ops_admin.access` = true, 대표 계정 대상 조회 = false,
  `price_change_logs` 읽기 유지.
- `src/types/database.ts` Functions 에 `has_capability` 타입이 빠져 있던 것을 추가했다.

## 2026-10-02 `room_listing_links` — 읽기는 `room_links.access`

마이그레이션 `202610020001_room_listing_links.sql`(운영 적용).

- SELECT: `to authenticated using (organization_id = any ((select public.capability_organization_ids('room_links.access'))::uuid[]))`
  — 정책 `room links readers can read`. 판매 캘린더 로그 3표와 같은 판정식(`has_capability`).
- 플랫폼 관리자 FOR ALL. 일반 사용자 INSERT/UPDATE/DELETE 정책 없음 — 쓰기는 서버 액션(service-role)이 권한 · 조직을 다시 보고 한다.
- 권한: `select` → `authenticated`, `all` → `service_role`, `anon` 회수.
- `building_listing_links`(`202610020003`, Booking.com 건물 단위 링크)도 같은 모양 — 정책 `room links readers can read building links`
  (SELECT, 같은 판정식) · `platform admins can manage building links`(FOR ALL) · 같은 grant/revoke.
- 새 권한 키 `room_links.access` 의 `capability_roles` · `capability_policies` 행도 같은 마이그레이션에서 넣는다
  (레지스트리 시드 `202609100001` 의 생성 구역도 갱신 — 새 DB 용).

## 2026-10-15 룸 링크 직접 추가 — `room_link_buildings` · `room_link_rooms`

마이그레이션 `202610150002_room_link_manual_entries.sql`(**운영 적용 전** — 검토 후 적용).

- 두 표 모두 기존 룸 링크 표와 같은 모양: SELECT `to authenticated using (organization_id = any ((select public.capability_organization_ids('room_links.access'))::uuid[]))`
  (정책 `room links readers can read manual buildings` / `… manual rooms`) · 플랫폼 관리자 FOR ALL(`platform admins can manage manual buildings` / `… rooms`).
- 일반 사용자 INSERT/UPDATE/DELETE 정책 없음 — 추가 · 이름 바꾸기 · 지우기는 서버 액션(`src/app/admin/ops/room-links/actions.ts`)이
  `room_links.access` 와 대상의 조직을 다시 확인한 뒤 service-role 로 한다. Beds24 객실(`rooms`)은 이 액션들이 건드리지 않는다.
- 권한: `select` → `authenticated`, `all` → `service_role`, `anon` 회수.
- `room_listing_links.manual_room_id` · `building_listing_links.manual_building_id` 는 새 열일 뿐 — 두 표의 기존 정책이 그대로 덮는다(조직 · 권한 판정 같음).

## 2026-10-06 자동화 — 보기 `ops_admin.access` / 쓰기 `automation.manage`

마이그레이션 `202610060003_automation_control.sql`(운영 적용).

- `automation_jobs` · `automation_destinations` · `automation_runs` · `automation_setting_logs` · `cleaning_list_assignees` · `cleaning_list_extra_rooms`(2026-10-07):
  SELECT 정책 `ops admins can read` — `organization_id = any ((select public.capability_organization_ids('ops_admin.access'))::uuid[])`.
  INSERT/UPDATE/DELETE 정책 없음 — 쓰기는 서버 액션(service-role)이 **`automation.manage` 와 조직을 다시 확인한 뒤**만 한다
  (`src/app/admin/ops/automation/actions.ts`). 틱 라우트도 service-role.
- 새 권한 키 **`automation.manage`** — 역할 기본 부여 **없음**(`roles: []`), 개인 부여만, 차단 없음, 기한 없음, 개발자 통과.
  설정 저장 · 발송 토글 · 지금 보내기 · 정정본 · 담당자 이름 입력. 정책 행만 넣는다(역할 행 없음).
- 틱 함수 · 토큰 대조 함수는 `service_role` 만 실행.

## 2026-10-05 `ops_manual_booking_requests` — service-role 전용

마이그레이션 `202610050002`. RLS 를 켜고 정책을 두지 않는다 — `anon` · `authenticated` 는 권한도 회수. 수기 예약 서버 액션
(`submitManualBooking`, `ops_admin.access` 확인 뒤)만 service-role 로 읽고 쓴다.

## 2026-10-08 `ops_stats_months` · `ops_room_month_stats` — service-role 전용

마이그레이션 `202610080002`. RLS 를 켜고 정책을 두지 않는다 — `anon` · `authenticated` 권한 회수, `service_role` 에 명시 grant(이 프로젝트는 새 표에
service_role 권한이 기본으로 붙지 않는다 — 적용 때 `permission denied` 로 확인). 매출 · 가동률 · 비교 서버 읽기(`ops-revenue-server.ts`)는 화면 게이트
(`requireOpsAdminPage`) 뒤에서만 service role 로 읽고 쓴다(조직 필터 명시). 트리거 함수는 `security definer`, `search_path = ''`.
