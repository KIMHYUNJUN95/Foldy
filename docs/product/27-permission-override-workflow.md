# Permission Override / 사용자별 권한 예외 부여

> **이 문서는 권한 아키텍처로 일반화된다 (2026-09-10 방향 확정, 구현 대기).**
> 사용자 지시: 「모든 기능을 역할 기반으로도, 개개인 특정으로도 세분화할 수 있게 설계 자체를
> 그렇게 해야 한다.」 아래에 적힌 것은 **개인 부여(grant)** 한 방향뿐이고, 앞으로는
> **차단(deny)** 과 **역할 기본 부여**가 같은 모델 안에 들어온다.
>
> 바뀌는 것 둘:
> - **「모든 부여에 기한 필수, 무기한 없음」**(아래 Goal 절)은 폐기가 아니라 **키별 정책**이 된다.
>   기존 예외성 권한은 그대로 기한 필수이고, 상시 업무 지정(채용 담당자 등)만 무기한을 허용한다.
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
- **Time-bound by default.** Every grant requires an `expires_at`. No permanent/indefinite grants
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
