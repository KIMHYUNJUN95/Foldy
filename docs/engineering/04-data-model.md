# Data Model

## Purpose

This document defines the initial Supabase/PostgreSQL data model for Foldy.

The model must support:

- Multi-tenant organizations
- PWA mobile field app
- Admin web app
- Role-based permissions
- Korean/Japanese/English UI
- Beds24 reservation calendar
- Cleaning timer records
- Maintenance requests
- Lost and found
- Order requests
- Announcements
- User directory
- Notifications
- Recurring work scheduler
- Linen defect registration (approved post-MVP batch, 2026-06-09)
- Personal todo / shared task inbox (approved post-MVP batch)
- Internal board (approved post-MVP batch)
- Staff suggestions / feedback (approved post-MVP batch)
- Attendance / clock-in/out + hourly payroll (mobile and admin implementation live)

## Core Principles

## 1. Organization Isolation

Every business record must belong to an organization.

Core rule:

```txt
organization_id is required on every operational table.
```

## 2. Internal IDs + External IDs

Foldy should use internal UUID primary keys.

External systems such as Beds24 should be mapped through external ID fields.

Example:

```txt
external_provider = "beds24"
external_id = "..."
```

## 3. Role-Based Access

Permissions should be enforced with:

- Application-level checks
- Supabase Row Level Security

Do not rely only on hiding UI buttons.

## 4. Hard Delete Policy

User-triggered deletion is hard delete in MVP.

Important:

- Show confirmation popup before delete.
- Be careful with foreign keys and cascading behavior.

## 5. Attachments

Implementation note (updated): The actual MVP implementation stores image URLs directly on each feature table as `image_urls text[]` rather than using a shared `attachments` table. The shared table approach was the original design intent but was not used in practice. Each table (lost_items, maintenance_reports, order_requests, announcements) stores its own `image_urls text[]` column. The Supabase Storage bucket for request images is `request-images`; the bucket for announcement images is `announcement-images`.

## Core Tables

Implementation note:

- The first implementation migration is `supabase/migrations/202605090001_initial_foundation.sql`.
- The first migration intentionally covers only the foundation tables needed before authentication and onboarding:
  - organizations
  - profiles
  - memberships
  - invite_codes
  - platform_admins
  - audit_logs
- Feature tables such as properties, rooms, reservations, cleaning records, requests, announcements, notifications, and recurring work should be added in later migrations after the auth/invite foundation is connected and tested.

## organizations

Represents a company/workspace.

Fields:

```txt
id uuid primary key
name text not null
slug text unique
status text not null
created_at timestamptz
updated_at timestamptz
```

## profiles

Extends Supabase auth users.

Fields:

```txt
id uuid primary key references auth.users(id)
name text not null
birth_date date                                   -- added migration 202606180004; replaces age
gender profile_gender                             -- added migration 202607030002; nullable for legacy accounts
hire_date date                                    -- added migration 202607060001; self-entered, annual-leave accrual basis
phone_number text                                 -- unique (partial index, excludes NULL/empty)
last_used_organization_id uuid references organizations(id) on delete set null  -- added 202606180004
profile_photo_url text
preferred_language text not null
theme_preference text not null default 'system'  -- schema only; NOT used by the app (light-mode-only since 2026-06-08)
bottom_nav_tabs text[] not null default '{home,calendar,requests,announcements}'
can_generate_report boolean not null default false
ops_calendar_mode text  -- 2026-10-05 (202610050001): 판매 캘린더 마지막 보기 rolling·monthly, null = 30일
created_at timestamptz
updated_at timestamptz
```

Auth/onboarding notes (updated 2026-06-18):

- `birth_date` is the active operational field. `age` is the legacy column from initial DB gen; kept for backward compat but not used in onboarding logic. Do not add new code that reads `age`.
- `gender` is collected during onboarding for payroll/employment-facing exports and records. Current allowed values are `female` and `male`. It is intentionally nullable so already-onboarded accounts are not forced back through onboarding.
- `phone_number` is stored in international format and enforced as account-level unique via the partial unique index `profiles_phone_number_unique` (excludes NULL and empty). Migration `202606180004`.
- `last_used_organization_id` tracks the last organization the user actively signed into — used for multi-org routing so login returns to the right org. Nullable (NULL = first login or single-org user).
- Users may edit `name`, `birth_date`, `phone_number`, and `gender` later. The current `/account` UI surfaces `birth_date` and `gender` specifically so legacy accounts can fill missing profile fields without being forced back through onboarding.
- `preferred_language` is chosen during onboarding and becomes the user's top-priority locale after join.

`can_generate_report` (migration `supabase/migrations/202606130001_profile_report_access.sql`) is a
per-user override for the Todo **daily-report generator** (업무일지; free, template-based — no LLM).
Default `false`. The report
permission is `role != 'part_time_staff' OR can_generate_report = true`, so regular staff are covered
by the role check and never need the flag; it is toggled per-user by owner/office_admin in admin user
management for the few part-timers who work in a management capacity. See
`docs/engineering/05-rls-permissions.md` and `docs/product/18-todo-task-workflow.md` (2026-06-13).

`ops_calendar_mode` (2026-10-05, `202610050001_profile_ops_calendar_mode.sql`) remembers the user's last 판매 캘린더 view (`rolling` = 30일 / `monthly` = 월간), shared by `/admin/ops/calendar` and `/mobile/ops/calendar`. Written server-side (service-role, own row) when a calendar URL carries `mode`; read when it doesn't. See `docs/product/33-calendar-write-features.md` 「30일 · 월간 보기 기억」.

`bottom_nav_tabs` stores the user's customized mobile bottom-bar tabs (ordered ids, max 4 enforced in app logic). Added in `supabase/migrations/202606080001_profile_bottom_nav.sql`. The selectable pool is the current `mobileSidebarNavigation`: `home`, `calendar`, `cleaning`, `tasks`, `requests`, `attendance`, `announcements`, `board`, `suggestions`, `complaints`, `linen-return`, and `directory`. Unknown/stale ids are ignored by the resolver.

`hire_date` (migration `202607060001`) is self-entered by the employee from the "hire date missing"
screen (`src/components/attendance/leave-exception.tsx`, `missing` variant → `setAnnualLeaveBaselineAction`
in `src/app/mobile/attendance/leave/actions.ts`). It is the basis for annual-leave accrual — see
`annual_leave_baselines` below and `docs/product/26-annual-leave-workflow.md`. Admins can edit the
hire date and grant baseline from the leave balance drawer; salary-based targeting is additionally
enforced by the current leave workflow gates.

Language values:

```txt
ko
ja
en
```

Theme values (schema only — the app no longer reads or writes `theme_preference`; light-mode-only since 2026-06-08, dark mode deferred until post-launch):

```txt
system
light
dark
```

## memberships

Connects users to organizations.

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
user_id uuid not null references profiles(id)
role text not null
status text not null
team_id uuid references teams(id) on delete set null  -- added migration 202607140001; nullable = 미지정
joined_at timestamptz
created_at timestamptz
updated_at timestamptz
```

`team_id` (migration `202607140001`, **not yet applied**) links the membership to its 현장/사무실 team
(see `teams` above). Assigned/edited via `setMemberTeam` in `/admin/users/[id]`. `on delete set null`
so deleting a team un-assigns its members without deleting the people.

Role values:

```txt
owner
office_admin
cs_staff
field_manager
staff
part_time_staff
```

Developer/Super Admin is not stored as an organization membership role. It uses `platform_admins`.

Status values:

```txt
invited
active
suspended
removed
```

## teams

**Phase 1 implemented (2026-07-14), migration `supabase/migrations/202607140001_teams.sql` — NOT yet
applied to the linked Supabase project.** Within-org 소속(현장/사무실) split. The org stays the tenant
boundary (see `docs/planning/01-decision-log.md` → 2026-07-14 "조직 모델 방향"); `teams` adds a
top-level field/office dimension per member, with room for named sub-teams later without another
migration.

```txt
id uuid primary key
organization_id uuid not null references organizations(id) on delete cascade
name text not null
kind team_kind not null        -- 'field' | 'office'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

`team_kind` enum values:

```txt
field
office
```

Notes:
- Two default teams are seeded per existing org by the migration: `현장` (`kind='field'`) and `사무실`
  (`kind='office'`). Existing memberships are backfilled onto the default team matching their role
  (`field_manager`/`staff`/`part_time_staff` → 현장; everyone else → 사무실).
- Index: `teams_organization_id_idx (organization_id)`.
- RLS: SELECT for active org members; no write policies — writes go only through service-role server
  actions gated the same way as `memberships.manage_users` (`actorCanManageUsersInOrg`). See
  `docs/engineering/05-rls-permissions.md`.
- Phase 1 scope is schema + backfill + assignment/filter on the Users screen only. Team CRUD (creating
  sub-teams) and 근태/청소/대시보드 filters by team are later phases, not built yet.
- See `docs/product/01-user-roles.md` for how this relates to (and is independent of) role, and
  `docs/planning/06-current-status.md` / `01-decision-log.md` → 2026-07-14 for status.

## invite_codes

Invite codes for onboarding, especially part-time staff.

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
code text unique not null
name text not null
default_role text not null
expires_at timestamptz not null
max_uses integer not null
used_count integer not null default 0
is_active boolean not null default true
created_by_user_id uuid references profiles(id)
created_at timestamptz
updated_at timestamptz
```

Business rules (2026-06-18 planning baseline):

- Invite code resolves both `organization_id` and the signup-facing role category
- `owner` invite code: one-time use
- all other role categories: `expires_at = within 3 months`, `max_uses = 100` by default
- Invite-code management UI is deferred; initial org/owner/code bootstrap is manual DB/admin-script work
- Additional organizations can be joined by reusing the same account and entering another valid invite code

## platform_admins

Platform-level admin access.

This is separate from organization memberships.

Fields:

```txt
id uuid primary key
user_id uuid not null references profiles(id)
role text not null
is_active boolean not null default true
created_at timestamptz
updated_at timestamptz
```

Role values:

```txt
developer_super_admin
```

Purpose:

- Create organizations during MVP
- Access all organizations for support/debugging
- Manage platform-level settings later

## audit_logs

Records important admin/platform actions.

MVP does not need a full audit log UI, but important actions should be stored.

Fields:

```txt
id uuid primary key
organization_id uuid references organizations(id)
actor_user_id uuid references profiles(id)
action text not null
target_type text
target_id uuid
metadata jsonb
created_at timestamptz
```

Example actions:

```txt
organization.created
membership.role_changed
membership.deactivated
invite_code.created
request.deleted
reservation.manual_checkout_updated
platform_admin.used
attendance_month_finalize
attendance_month_reopen
linen_return_console_update
linen_return_console_delete
task_daily_report_slack_sent
```

Notes:

- `linen_return_console_update` / `linen_return_console_delete` (2026-07-30) come from the admin
  린넨 반품 console (`/admin/linen-return`). `target_type = linen_return_record`, `target_id` = the
  record id, and `metadata` holds the before/after (or pre-delete) snapshot — building, item lines +
  quantities, note, photo count — plus the original `registered_at` / `registered_by_user_id`
  evidence. There is no free-text reason field for these two actions; see
  `docs/product/19-linen-defect-workflow.md`.
- `task_daily_report_slack_sent` (2026-08-03) records a successful manual daily-report delivery to
  the configured single Slack channel. `target_type = daily_report`, `target_id = {user_id}:{Tokyo
  date}`, and metadata retains only `date` and `character_count`; it deliberately excludes the report
  body and Slack webhook URL.

- `organization_id` can be null for platform-level actions.
- Super Admin actions should be recorded.
- Important role and permission changes should be recorded.

## properties

Buildings, hotels, or standalone accommodations.

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
name text not null
display_name_ko text
display_name_ja text
display_name_en text
property_type text not null
address text
status text not null
external_provider text
external_property_id text
created_at timestamptz
updated_at timestamptz
```

## rooms

Rooms or units inside a property.

Migration: `supabase/migrations/202605240001_properties_rooms.sql`

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
property_id uuid not null references properties(id)
room_label text not null           -- canonical room label (e.g. "201", "A301")
status room_status not null        -- active | inactive
external_provider text             -- "beds24" for Beds24-synced rooms
external_room_id text              -- Beds24 unitId
external_minimum_stay integer      -- from Beds24 inventory API; null = unknown/unclassified
created_at timestamptz
updated_at timestamptz
```

Status values (room_status enum):

```txt
active
inactive
```

Note: `external_minimum_stay` determines whether a Beds24 room is classified as active or inactive. Rooms with `external_minimum_stay < 50` are treated as active; `null` or `>= 50` are treated as inactive. This is used by `getActiveRoomLabels()` to decide which rooms render on the calendar.

## reservations

Beds24 reservation data used for calendar display.

Migration: `supabase/migrations/202605220001_reservations.sql`

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
property_name text not null        -- free text from Beds24 payload, not a FK to properties
room_label text not null           -- free text from Beds24 payload, not a FK to rooms
source text not null               -- channel name: "Booking.com", "Airbnb", "Direct", etc.
source_reservation_id text not null -- "{channelRef}::room::{label}" (+ "::bid::{beds24Id}" only on same-room group collision)
guest_name text not null
guest_count integer
check_in_date date not null        -- Beds24 firstNight date
check_out_date date not null       -- lastNight + 1 calendar day
status reservation_status not null
raw_payload jsonb                  -- original Beds24 webhook payload for recovery/debugging
created_at timestamptz not null
updated_at timestamptz not null
unique (organization_id, source, source_reservation_id)
-- original_reservation_id text generated always as (split_part(source_reservation_id, '::room::', 1)) stored  (2026-10-16)
```

Status values (reservation_status enum):

```txt
confirmed
checked_in
checked_out
cancelled
no_show
```

Notes:
- property_name and room_label are free text (not FKs) because Beds24 sends string labels. The `properties` and `rooms` tables are maintained in parallel for room master management but are not enforced as FKs here.
- check_out_date uses exclusive semantics: guest checks out on check_out_date morning, not the night before.
- Cancelled and no_show reservations are excluded from all calendar renders and counts.
- source_reservation_id may encode room assignment as "{originalId}::room::{label}" to support multi-room bookings under the same unique constraint.
- `{originalId}` is the channel reference (`apiReference` first), so a Beds24 **group** booking (one channel reference, one Beds24 booking per room linked by `masterId`) shares it across rooms. "Same booking" is decided only by the Beds24 own id in `raw_payload` (`bookId` → `id`), never by the key prefix. If two different Beds24 bookings of one group land on the same room label, the later one is stored as `"{originalId}::room::{label}::bid::{beds24Id}"` (2026-10-01). See `docs/engineering/01-beds24-integration.md` → "2026-10-01 Group (multi-room) bookings".
- Realtime is enabled on this table (migration `202605260002_enable_reservations_realtime.sql`).

## beds24_webhook_events

Observability log for Beds24 reservation ingestion. Records every inbound webhook batch and every reconciliation run with its processing result, so a dropped or never-delivered webhook is detectable instead of silently missing. See `docs/product/15-reservation-calendar.md` → "Webhook Reliability".

Migration: `supabase/migrations/202606100001_beds24_webhook_events.sql`

Fields:

```txt
id uuid primary key
organization_id uuid references organizations(id) on delete set null  -- nullable: webhook may fail to resolve org
trigger_source text not null            -- 'webhook' | 'reconciliation' (CHECK constrained)
http_status integer
processed_count integer not null        -- bookings in the batch / rows fetched by reconciliation
succeeded_count integer not null
failed_count integer not null
modes text[] not null                   -- per-result processing modes (upserted, missing_required_fields, ...)
booking_summary jsonb not null          -- compact [{bookId,status,mode}] (webhook) or window/skip summary (reconciliation)
error_message text
received_at timestamptz not null
created_at timestamptz not null
```

Notes:
- This is platform/operational data, not org business data: readable only by platform admins, writable only by the service role (webhook + cron paths).
- `booking_summary` is intentionally a compact summary, NOT the full raw payload — enough to trace a specific reservation without storing bulk PII. The full payload still lives in `reservations.raw_payload` for recovered rows.
- Written by `src/lib/beds24/webhook-events.ts` from the webhook route and the reconciliation route; logging failures are swallowed and never block the ingestion response.

## cleaning_sessions

Cleaning timer and completion records.

Migrations: `supabase/migrations/202605210001_cleaning_sessions.sql`,
`supabase/migrations/202607150001_cleaning_sessions_admin_force_complete.sql`

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
staff_user_id uuid not null references profiles(id)
room_label text not null          -- canonical "PropertyName RoomLabel" string, not a FK
task_label text not null          -- task type key (checkout_cleaning, simple_cleaning, long_stay_cleaning)
status cleaning_status not null
cleaning_date date not null       -- JST operating date (Asia/Tokyo)
started_at timestamptz not null
completed_at timestamptz
duration_seconds integer
notes text
completed_by_admin uuid references profiles(id) on delete set null  -- admin id when force-completed on
                                                                     -- behalf of staff (202607150001); null
                                                                     -- for normal self-completion
created_at timestamptz not null
updated_at timestamptz not null
```

Status values (cleaning_status enum):

```txt
in_progress
completed
cancelled
```

Note: room_label and property are stored as free text rather than FKs to properties/rooms tables because cleaning sessions predate the room master and must survive property data changes. The room master (properties/rooms tables) is used for display and filtering but is not enforced as a FK here.

Note: `cleaning_date`'s default expression (migration `202605210002`) computes the operating date via
`(now() at time zone 'Asia/Seoul')::date`. This is not a bug — Seoul and Tokyo share the same UTC+9
offset with no DST — but the label is inconsistent with the rest of the codebase's `Asia/Tokyo`
convention (`cleaningOperatingTimeZone` in `src/lib/cleaning.ts`, etc). Left as-is (an already-applied
migration; behavior is correct) — noted here so it isn't mistaken for a timezone bug during review.

Admin force-complete (`forceCompleteCleaningSession` in `src/app/admin/cleaning/actions.ts`) is the
only write path that sets `completed_by_admin`. See `docs/product/07-cleaning-workflow.md` →
"2026-07-14 어드민 청소 대시보드 — 백엔드 연동".

## maintenance_reports

Maintenance/field issue records.

Migrations: `supabase/migrations/202605210007_maintenance_reports.sql`,
`supabase/migrations/202605210008_request_images.sql`,
`supabase/migrations/202607090003_reservation_calendar_linking_and_notes.sql`,
`supabase/migrations/202607160001_maintenance_backend.sql` (2026-07-14 백엔드 연동)

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
reported_by_user_id uuid not null references profiles(id)
room_label text not null           -- free text, matches cleaning_sessions.room_label pattern
is_building_only boolean not null default false  -- 객실 없는 건물 단위(공용부) 신고
property_name text                 -- 건물명 스냅샷
reservation_id uuid references reservations(id) on delete set null
guest_name text                    -- reservation-linked guest snapshot
issue_title text not null
description text
category maintenance_category not null default 'other'
priority maintenance_priority not null default 'normal'
status maintenance_status not null default 'open'
image_urls text[] not null default '{}'            -- 신고 사진 (≤5)
resolution_image_urls text[] not null default '{}' -- 완료(수리 후) 사진 (≤5, 선택)
resolution_memo text               -- 처리 메모 (신고 시 description과 별개)
completed_at timestamptz           -- closed/cancelled 로 갈 때 기록, 재오픈 시 null
completed_by uuid references profiles(id) on delete set null   -- 완료/무효를 처리한 사람
completed_by_admin boolean not null default false               -- 관리자 예외 개입으로 종료됐는지
cleaning_session_id uuid references cleaning_sessions(id)  -- set when created during active cleaning
created_at timestamptz not null
updated_at timestamptz not null
```

Status values (maintenance_status enum) — **4-state as of 2026-07-14**:

```txt
open
in_progress
closed
cancelled
```

> **`resolved`는 폐기됐다** (2026-07-14). 현장이 "해결"과 "완료"를 구분할 수 없었고 두 상태가 실질적으로
> 같게 쓰였다. 마이그레이션 `202607160001`이 기존 `resolved` 행을 `closed`로 옮긴 뒤 enum을 재생성한다
> (되돌릴 수 없음). 대신 `cancelled`(무효)가 추가됐다 — 잘못된·중복 신고를 하드 삭제하는 대신 감사 흔적을
> 남기기 위해서다.

Priority values (maintenance_priority enum): `low` / `normal` / `high` / `urgent`.

Category values (maintenance_category enum, 10종): `electric` / `water` / `air_conditioning_heating` /
`wifi` / `furniture` / `appliance` / `cleaning_condition` / `supplies` / `damage` / `other`.
모바일 폼의 기존 8종(hvac / lock / internet / amenities …)은 **UI에만 있었고 저장된 적이 없어서**
(서버 액션이 `formData`의 category를 읽지 않았다) 데이터 마이그레이션 없이 교체했다.

Notes:

- Room is stored as free text `room_label` (same pattern as cleaning_sessions). There is no
  property_id or room_id FK. When created from an active cleaning session, `cleaning_session_id` is
  set automatically. When created from the reservation calendar linked action, `reservation_id` and
  `guest_name` can be stored as optional context snapshots after the server re-validates that the
  reservation belongs to the same organization and matches the selected property / room.
- **`property_name`은 2026-07-14까지 마이그레이션 없이 원격 DB에만 존재했다** (대시보드 SQL로 직접 추가된
  것으로 보인다). `202607160001`이 `add column if not exists`로 따라잡는다 — 그 전에는
  `supabase db reset`을 하면 모바일 신청이 깨졌다.
- **파생 값은 저장하지 않는다.** "재실 중"(연동 예약이 오늘(Tokyo)을 덮는지)과 "오래된 미해결"
  (`open` + 접수 후 72h 초과, `MAINTENANCE_AGING_HOURS`)은 조회 시 계산한다 —
  `src/lib/admin-maintenance.ts`.
- **완료 사진은 별도 폴더**에 올라간다: `{orgId}/maintenance-resolutions/{reportId}/{file}`
  (신고 사진은 `{orgId}/maintenance-reports/…`). 같은 `request-images` 버킷이며, storage RLS 정책의
  폴더 화이트리스트에 추가돼 있다.

## lost_items

Lost and found records.

Migrations: `supabase/migrations/202605210006_lost_items.sql`,
`supabase/migrations/202607090003_reservation_calendar_linking_and_notes.sql`,
`supabase/migrations/202607170001_lostfound_return.sql` (반환 처리 백엔드),
`supabase/migrations/202607180001_lostfound_console.sql` (어드민 콘솔 스키마 + 자동 생애주기,
**적용 완료 2026-07-16, MCP**)

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
reported_by_user_id uuid not null references profiles(id)
room_label text not null           -- free text, matches cleaning_sessions.room_label pattern
property_name text                 -- optional building snapshot for reservation-linked create
reservation_id uuid references reservations(id) on delete set null
guest_name text                    -- reservation-linked guest snapshot
item_name text not null
found_at timestamptz not null
status lost_item_status not null
image_urls text[] not null default '{}' -- 등록 사진
memo text                          -- 등록 메모
cleaning_session_id uuid references cleaning_sessions(id)  -- set when created during active cleaning
handling_memo text                 -- 현장 처리 메모 (2026-07-15). 등록 memo와 별개
handling_image_urls text[] not null default '{}'  -- 처리 증빙 사진 ≤5 (2026-07-15)
handled_at timestamptz             -- 마지막 처리 시각 (2026-07-15)
handled_by uuid references profiles(id) on delete set null  -- 마지막 처리자 (2026-07-15)
handled_by_admin boolean not null default false  -- 어드민 예외 개입 여부 (2026-07-15)
category lost_item_category not null default 'other'      -- 품목 분류 (2026-07-16)
return_method lost_return_method                            -- 반환 방식: delivery/pickup (2026-07-16)
return_tracking_no text                                     -- 배송 송장번호 (2026-07-16)
hold_until date                                              -- 보관 연장 시 새 폐기 예정일 (2026-07-16)
hold_reason text                                             -- 보관 연장 사유 (2026-07-16)
created_at timestamptz not null
updated_at timestamptz not null
```

Status values (lost_item_status enum — `returned` added 2026-07-15):

```txt
registered
stored
disposal_scheduled
disposed
returned            -- 손님에게 전달 완료 (종결). enum ADD VALUE (제거 없음)
```

New enums (2026-07-16, migration `202607180001_lostfound_console.sql`):

```txt
lost_item_category: electronics | wallet | accessory | clothing | document | bag | umbrella
                   | toiletry | other                                              -- 9 values
lost_return_method: delivery | pickup                                              -- 2 values
```

반환은 별도 `retrieved_*` 컬럼이 아니라 `status = 'returned'` + `handled_*`로 남는다. 종결 상태는
`returned` 또는 `disposed` 둘이며, 이 상태에서 모바일 상세는 처리 이력을 보여준다. `property_name`,
`reservation_id`, `guest_name`은 예약 연동 create의 선택적 컨텍스트 스냅샷이고 `room_label`이 여전히
주 위치 필드다.

### Automated lifecycle functions (2026-07-16, applied remotely via MCP)

Migration `202607180001_lostfound_console.sql` also defines two `SECURITY DEFINER` functions, scheduled
daily via pg_cron (Tokyo-anchored, UTC `15:05`/`15:15`):

- `public.lostfound_auto_dispose()` — active (registered/stored/disposal_scheduled) rows whose due date
  (`hold_until` else `found_at + 14 days`, Tokyo date) has passed are set to `status = 'disposed'`
  (`handled_at = now()`, `handled_by = null` = system auto-dispose, `handled_by_admin = false`); rows
  within 3 days of the due date are bumped to `disposal_scheduled`.
- `public.lostfound_auto_purge()` — hard-deletes `status = 'disposed'` rows whose disposal date
  (`handled_at`, Tokyo) is more than 90 days in the past. Guarded to `status = 'disposed'` only.

Both bypass RLS by design (cron has no org/session context) and instead scope purely by `status` and
Tokyo date. See `docs/engineering/05-rls-permissions.md` → `lost_items` for the RLS-bypass note, and
`docs/product/09-lost-found-workflow.md` → "대시보드 분실물 관리 콘솔" for the full policy.

## reservation_internal_notes

Per-reservation internal operator memo used by the admin reservation calendar inspector.

Migration: `supabase/migrations/202607090003_reservation_calendar_linking_and_notes.sql`

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id) on delete cascade
reservation_id uuid not null references reservations(id) on delete cascade
updated_by_user_id uuid references profiles(id) on delete set null
note text not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (organization_id, reservation_id)
```

Notes:
- One note row per reservation per organization.
- Empty save from the admin calendar deletes the row instead of storing blank text.
- This table is operational metadata owned by Foldy, distinct from Beds24 reservation source data.
- Read access is intentionally broader than write access: all active organization members can read
  the note, while create / update / delete remains limited to the privileged reservation-calendar
  operator roles.

## order_requests

Free-text supply/amenity requests. Multiple items per request stored as JSONB.

Migrations: `202606010001_order_requests.sql`, `202606010002_order_requests_delivery_date.sql`, `202606020001_order_requests_delivery_range.sql`, `202607190001_orders_console.sql`

Fields:

```txt
id                    uuid primary key default gen_random_uuid()
organization_id       uuid not null references organizations(id) on delete cascade
reported_by_user_id   uuid not null references profiles(id) on delete restrict
building_name         text not null
room_label            text not null default '-'
title                 text not null
description           text
reason                text
urgency               order_request_urgency not null default 'normal'
status                order_request_status not null default 'requested'
items                 jsonb not null default '[]'    -- array of {id, name, quantity, link, memo, imageUrls?}
delivery_date         date                            -- single delivery date; populated at ordered transition
delivery_start_date   date                            -- range start (mutually exclusive with delivery_date)
delivery_end_date     date                            -- range end; constraint: start <= end, both null or both set
admin_memo            text                            -- admin exception-handling memo (e.g. reject reason,
                                                        -- status-correction memo); added by 202607190001;
                                                        -- distinct from the requester-facing reason/description
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
```

Constraint: `order_requests_delivery_range_valid` ensures delivery_start_date and delivery_end_date are either both null or both set with start <= end.

Enums:

```txt
order_request_status:  requested | approved | ordered | received | closed
order_request_urgency: normal | high
```

Note: per-transition audit columns are not in the MVP schema. The `status` enum value tracks workflow state. Per-item photo URLs are stored inside `items[].imageUrls` within the JSONB column. `admin_memo` (added 2026-07-19, part of the `/admin/orders` operations-console rebuild) is nullable and RLS policies are unchanged by the migration; the admin console (`getAdminOrders`, `src/lib/admin-orders.ts`) displays the DB `received` status as `ordered` (an inactive step) and does not surface a distinct `received` state in the UI.

## announcements

Internal notices.

Migrations: `202605100001_announcements.sql`, `202605100003_announcement_images.sql`, and related hardening migrations.

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
title text not null
content text not null
created_by_user_id uuid not null references profiles(id)
target_scope text not null
target_property_ids uuid[]
target_roles text[]
is_important boolean not null default false
is_pinned boolean not null default false
show_popup_on_app_open boolean not null default false
popup_until timestamptz
allow_comments boolean not null default true
status text not null default 'draft'   -- draft | published | archived
image_urls text[] not null default '{}' -- up to 5 announcement images in announcement-images bucket
published_at timestamptz
archived_at timestamptz
created_at timestamptz
updated_at timestamptz
```

## attachments (not implemented)

Note: The shared `attachments` table design was planned but not implemented. All feature tables (lost_items, maintenance_reports, order_requests, announcements) store image URLs directly in an `image_urls text[]` column. This is the current production approach.

File limits per feature:

```txt
lost_item images: max 5
maintenance_report images: max 5
order request per-item images: max 5 per item
announcement images: max 5
```

Storage buckets:

```txt
request-images   -- shared image bucket; path: {org_id}/{request_type}/{request_id}/{filename}
                 -- request_type whitelist (storage RLS): lost-items, maintenance-reports,
                 -- order-images, linen-returns, task-images, task-update-images, suggestion-images
                 -- (suggestion-images added 202606160004; part_time_staff may upload only there)
announcement-images -- announcement images
                 -- path: {org_id}/{announcement_id}/{filename}
```

## announcement_reads

Read tracking.

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
announcement_id uuid not null references announcements(id)
user_id uuid not null references profiles(id)
read_at timestamptz not null
```

## announcement_comments

Announcement comments.

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
announcement_id uuid not null references announcements(id)
user_id uuid not null references profiles(id)
content text not null
created_at timestamptz
updated_at timestamptz
```

## notifications

In-app notification center records.

Base migration: `supabase/migrations/202606030001_notifications.sql`. Enum values were later extended
by `supabase/migrations/202606100003_todo_tasks.sql` (task activity) and
`supabase/migrations/202606110001_task_reminder_notifications.sql` (task reminders).

The notifications table now backs three dispatch surfaces:
- order processing notifications
- Todo / Shared Task activity (shared / update / completed)
- Todo / Shared Task time-based reminders (due-soon / overdue)

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
recipient_user_id uuid not null references profiles(id)
type notification_type not null    -- enum (see values below)
href text not null                 -- in-app navigation target on tap
source_type text not null          -- e.g. "order_request", "task"
source_id uuid not null            -- FK-equivalent to the source record
dedupe_key text not null           -- unique per (recipient, event) to prevent duplicates
payload jsonb not null default '{}' -- event-specific data (order/task title, delivery date, event, etc.)
read_at timestamptz                -- null = unread
created_at timestamptz not null
unique (recipient_user_id, dedupe_key)
```

Notification type values (notification_type enum, as implemented):

```txt
order_processed
task_shared
task_updated
task_completed
task_due_soon
task_overdue
project_shared
suggestion_activity
```

Implementation notes:
- `order_processed` is dispatched when an order request status transitions to `ordered` (and reused,
  with a `kind: "delivery_updated"` payload flag, for a later delivery-date edit).
- `suggestion_activity` (migration `202606160003_suggestion_notifications.sql`) is one type for all
  Staff Suggestions events, distinguished by `payload.event` (`created` / `referenced` / `status` /
  `comment`); fan-out only to valid participants, deep-linking to `/mobile/suggestions/{id}`.
- `task_shared` / `task_updated` / `task_completed` are event-driven from the task server actions and
  fan out only to a task's current participants (org-scoped). `task_updated` is one type distinguished
  by `payload.event` — `edited` (author core edit), `note` (update-log activity), `reopened`.
- `task_due_soon` / `task_overdue` are time-based system reminders produced only by the daily
  `/api/tasks/reminders` cron (`src/lib/notifications/task-reminders.ts`): due-soon = active task due
  today (Tokyo), overdue = active task due before today. The `unique (recipient_user_id, dedupe_key)`
  constraint (key `task_due_soon|task_overdue:<taskId>`) limits each task to one reminder per recipient,
  so the cron never re-spams. See `docs/product/14-notification-design.md` for the full matrix.
- Self-notifications are suppressed for event-driven types (the actor is excluded from recipients).
  Reminders have no actor, so a task's author is intentionally reminded about their own deadline.
- A `schemaUnavailable` graceful fallback is used if the migration has not yet been applied; the
  notifications UI shows an info card instead of crashing.
- Push notifications are not yet implemented; in-app only.

## recurring_work_templates

Recurring work definitions.

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
title text not null
description text
property_id uuid references properties(id)
room_id uuid references rooms(id)
frequency_type text not null
frequency_interval integer
created_by_user_id uuid references profiles(id)
is_active boolean not null default true
created_at timestamptz
updated_at timestamptz
```

## recurring_work_occurrences

Generated recurring work instances.

Fields:

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
template_id uuid references recurring_work_templates(id)
property_id uuid references properties(id)
room_id uuid references rooms(id)
due_date date not null
status text not null
completed_by_user_id uuid references profiles(id)
completed_at timestamptz
notes text
created_at timestamptz
updated_at timestamptz
```

# Post-MVP Feature Batch Tables (approved 2026-06-09)

The tables below back the implemented post-MVP batch. Full column types, enums, indexes, and RLS detail
live in the per-feature technical-design docs (`docs/engineering/08`–`12`) and migrations; the
definitions here are the canonical inventory. Linen, tasks/projects, suggestions, board, and
attendance/payroll tables are implemented.

## linen_items

Implemented. Selectable linen item catalog. Org-scoped with nullable `building_name`
(`NULL` = available for all buildings; a value scopes the item to one canonical building name).
Building is the canonical property name (text), not a `properties` FK — consistent with the rest
of the app. Current default global set per org is 7 items
(`duvet_single, duvet_double, mattress_single, mattress_double, pillow, towel, mat`); older
generic defaults are retired from the active picker but kept for historical rows. See
`docs/engineering/08-linen-defect-technical-design.md` → "As-Built".

```txt
id uuid primary key
organization_id uuid not null references organizations(id) on delete cascade
building_name text                 -- NULL = all buildings
code text
name text not null
category text
is_active boolean not null default true
display_order integer not null default 0
created_by_user_id uuid references profiles(id) on delete set null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## linen_return_records

Implemented. Building-scoped linen return header. One row = one return registration event.
`building_name` is the canonical property name (text), matching `order_requests.building_name`.
No status column in the first slice.

```txt
id uuid primary key
organization_id uuid not null references organizations(id) on delete cascade
building_name text not null
note text
image_urls text[] not null default '{}'
registered_by_user_id uuid not null references profiles(id) on delete restrict
registered_at timestamptz not null default now()
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## linen_return_record_items

Implemented. Child item lines under one `linen_return_records` row. `unique (return_record_id,
linen_item_id)` blocks the same item appearing twice in one record (quantities are summed into a
single line instead).

```txt
id uuid primary key
return_record_id uuid not null references linen_return_records(id) on delete cascade
linen_item_id uuid not null references linen_items(id) on delete restrict
quantity integer not null check (quantity > 0)
sort_order integer not null default 0
created_at timestamptz not null default now()
unique (return_record_id, linen_item_id)
```

## tasks

Implemented (migration `202606100003_todo_tasks.sql`). One canonical task + `task_participants`
(one set, author + participants) + `task_updates` (unified log). Private by default; sharing adds
participant rows. `priority`/`status` are text+check (not enums). Notification enum gained
`task_shared` / `task_updated` / `task_completed`; task photos reuse the `request-images` bucket
(`task-images` / `task-update-images` subfolders). All writes go through service-role server
actions with explicit permission checks; reads are RLS-scoped via `is_task_participant()`.

Personal todo / shared task inbox. Private by default, but expandable to one shared task with participant set and common status. See `docs/engineering/09-todo-task-technical-design.md`.

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
created_by_user_id uuid not null references profiles(id)
title text not null
description text
property_id uuid references properties(id)
room_id uuid references rooms(id)
reservation_id uuid references reservations(id)
guest_name text
scheduled_date date
due_at timestamptz
all_day boolean not null default true
time_label text
duration_minutes integer                   -- 시간 블록 길이(분). NULL=기간 없음. time_label 있을 때만 유효 (202607240001)
priority text not null default 'normal'   -- 4단계(2026-07-30, 202607300002): urgent=우선순위1 · important=우선순위2 · medium=우선순위3 · normal=우선순위4(기본). 색: 빨/주/파/회
status text not null default 'open'        -- open | in_progress | completed | cancelled
is_inbox boolean not null default true
is_shared boolean not null default false
recurrence_rule text                       -- daily | weekly | monthly | weekdays | weekends | yearly | custom (yearly: 202607240001)
recurrence_instance_date date              -- 반복의 FIXED 앵커(2026-07-30~). 완료해도 롤포워드 안 함. 회차는 규칙으로 계산 → task_occurrence_state
tags text[]
image_urls text[]
completed_by_user_id uuid references profiles(id)
completed_at timestamptz
is_directive boolean not null default false -- 업무 지시(대상에게 부여). 대시보드 "지시" 탭 (202607270001)
deleted_at timestamptz                      -- SOFT delete. NULL=live. 되돌리기(Undo)용. 모든 조회가 deleted_at is null 필터 (202607290001)
created_at timestamptz
updated_at timestamptz
```

Note (2026-07-29): task deletion is **soft** (`deleted_at`) so the Undo toast can restore it. All task
list/detail reads (`getVisibleTasks` / `getProjectTasks` / `getTaskDetail`, project counts, reminders,
report) filter `deleted_at is null`; RLS still sees deleted rows so the author can restore via
`restoreTask` / `restoreConsoleTask`. Owner-approved exception to the hard-delete policy (CLAUDE.md §9).

Note (2026-06-13): `completed_at` / `completed_by_user_id` (and `status`) are **actively written
again** by the re-introduced complete/reopen actions (`completeTask` / `reopenTask` in
`src/app/mobile/tasks/[id]/actions.ts`). They are no longer dormant — completing a task stamps
`completed_at` (its Tokyo date drives the Completed/기록 tab grouping) and the completing user, and
reopening clears them.

Note (2026-07-30): the above `status`/`completed_at` semantics apply to **one-off tasks only**. For
**recurring** tasks, completion no longer touches the row (no roll-forward) — per-occurrence
completion lives in `task_occurrence_state` keyed by `occurrence_date`. A recurring row stays
`status='open'` with a fixed `recurrence_instance_date` anchor. See `docs/planning/01-decision-log.md`
→ "2026-07-30 롤포워드 폐지".

## task_participants

Current participant set for each task.

```txt
id uuid primary key
task_id uuid not null references tasks(id)
user_id uuid not null references profiles(id)
role text not null            -- author | participant
is_first_recipient boolean not null default false
added_by_user_id uuid references profiles(id)
created_at timestamptz
```

## task_updates

Unified task update-log. Covers participant notes plus small system entries such as edited/shared/completed/reopened.

```txt
id uuid primary key
task_id uuid not null references tasks(id)
created_by_user_id uuid references profiles(id)
update_type text not null     -- note | system_edited | system_shared | status_changed | completed | reopened
body text
image_urls text[]
created_at timestamptz
```

## task_occurrence_state

Per-occurrence state for **recurring** tasks (migration `202607300001_task_occurrence_state.sql`,
2026-07-30). Recurring tasks no longer roll forward on completion — the row is a fixed rule +
anchor, occurrences are virtual per scheduled date, and THIS table records whether a given
`(task_id, occurrence_date)` is completed / skipped / carried. The recurring row's
`status`/`completed_at` no longer mean "done" (that field is for one-off tasks). See
`docs/planning/01-decision-log.md` → "2026-07-30 롤포워드 폐지".

```txt
task_id uuid not null references tasks(id) on delete cascade
occurrence_date date not null            -- rule-computed occurrence (fixed anchor based)
organization_id uuid not null references organizations(id)
state text not null                      -- completed | skipped | moved
completed_by_user_id uuid references profiles(id)
moved_to_date date                       -- when state=moved ("오늘로 가져오기" carry target)
created_at timestamptz / updated_at timestamptz
primary key (task_id, occurrence_date)
```

- **completed** — that date's occurrence is done. `completed_by_user_id` set. Aggregated (완료탭 /
  업무일지 / "오늘 완료") by `occurrence_date`.
- **skipped** — overdue occurrence dismissed ("삭제"). Kept forever, never re-appears as overdue.
- **moved** — overdue occurrence carried to today ("오늘로 가져오기"); a carry-over one-off task is
  created separately for `moved_to_date`. Not counted as a completion.
- Overdue occurrence = scheduled date `< today` with **no row here** (still open).

## board_posts / board_post_reads / board_comments / board_reactions

자유 게시판 피드. **마이그레이션 `supabase/migrations/202606250001_board.sql` 적용 완료 (2026-06-25).**  
전체 기능 명세: `docs/product/23-board-workflow.md`.

```txt
-- board_posts
id uuid primary key default gen_random_uuid()
organization_id uuid not null references organizations(id) on delete cascade
created_by_user_id uuid not null references profiles(id) on delete restrict
title text                                 -- 선택 (nullable)
content text not null                      -- check: trim 길이 > 0
tags text[] not null default '{}'
image_urls text[] not null default '{}'    -- 최대 5개 (check constraint)
file_attachments jsonb not null default '[]'  -- FileAttachment[] (최대 5개)
is_pinned boolean not null default false
pinned_at timestamptz
pinned_by_user_id uuid references profiles(id) on delete set null
allow_comments boolean not null default true
created_at timestamptz not null default now()
updated_at timestamptz not null default now()  -- set_updated_at() trigger
deleted_at timestamptz                     -- soft delete

-- board_post_reads  (복합 PK: post_id + user_id)
post_id uuid not null references board_posts(id) on delete cascade
user_id uuid not null references profiles(id) on delete cascade
read_at timestamptz not null default now()

-- board_comments
id uuid primary key default gen_random_uuid()
post_id uuid not null references board_posts(id) on delete cascade
organization_id uuid not null references organizations(id) on delete cascade
created_by_user_id uuid not null references profiles(id) on delete restrict
content text not null                      -- 평문; @이름 / @ALL 토큰을 그대로 저장
image_urls text[] not null default '{}'    -- 최대 3개 (check constraint)
mentioned_user_ids uuid[] not null default '{}'  -- 멘션된 멤버 UUID 배열 (GIN 인덱스)
mention_all boolean not null default false       -- true = @ALL 전체 멘션
created_at timestamptz not null default now()
deleted_at timestamptz

-- board_reactions  (복합 PK: post_id + user_id + emoji)
post_id uuid not null references board_posts(id) on delete cascade
user_id uuid not null references profiles(id) on delete cascade
emoji text not null
created_at timestamptz not null default now()
```

Indexes: `board_posts_feed_idx (organization_id, created_at desc) where deleted_at is null` · `board_posts_pinned_idx (organization_id, is_pinned, pinned_at desc) where deleted_at is null` · `board_comments_post_idx (post_id, created_at asc) where deleted_at is null` · `board_comments_mentions_idx USING gin (mentioned_user_ids) where deleted_at is null` (2026-06-25, @멘션 UUID 배열 포함 여부 검색용)

> 별도 mention 테이블 미사용: UUID 배열 컬럼 + GIN 인덱스로 충분, 알림은 시점에 발송하므로 영속 관계 불필요.

Storage: 이미지 → `request-images` 버킷 (`board-posts/` / `board-comments/` 서브폴더, part_time_staff 허용). 첨부 파일 → `board-attachments` 버킷 (private, 서명 URL 방향). 경로: `{org_id}/{post_id}/{filename}`.

Permissions: 전체 활성 멤버 (part_time_staff 포함) → SELECT·INSERT. 작성자 또는 owner/office_admin → UPDATE·DELETE.

## staff_suggestions

Structured feedback thread with one required recipient, optional referenced users, recipient-owned status, and participant comments. **Fully wired**: schema, server actions, participant-scoped queries, comments, status flow, images, and notifications are implemented. See `docs/engineering/12-staff-suggestions-technical-design.md`.

```txt
id uuid primary key default gen_random_uuid()
organization_id uuid not null references organizations(id) on delete cascade
created_by_user_id uuid not null references profiles(id) on delete restrict
recipient_user_id uuid not null references profiles(id) on delete restrict
title text not null
body text not null
category text
status text not null default 'submitted'   -- submitted | reviewing | on_hold | completed
hold_reason text
completion_note text
property_id uuid references properties(id) on delete set null
property_name text
room_id uuid references rooms(id) on delete set null
room_label text
image_urls text[] not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()  -- maintained by set_updated_at() trigger
```

CHECK constraints (as built):
- `status in ('submitted','reviewing','on_hold','completed')`
- `char_length(trim(title)) > 0`, `char_length(trim(body)) > 0`
- `recipient_user_id <> created_by_user_id` (cannot address own author)
- `coalesce(array_length(image_urls,1),0) <= 5` (max 5 photos; re-applied server-side)
- `status <> 'on_hold' or trim(hold_reason) <> ''` (hold needs a reason)
- `status <> 'completed' or trim(completion_note) <> ''` (completion needs a note)

Indexes: `(organization_id, created_by_user_id, created_at desc)` Sent · `(organization_id, recipient_user_id, created_at desc)` Received · `(organization_id, status, created_at desc)` status · `(organization_id, property_id, created_at desc)` context.

```txt
staff_suggestion_references
  id uuid primary key default gen_random_uuid()
  organization_id uuid not null references organizations(id) on delete cascade
  suggestion_id uuid not null references staff_suggestions(id) on delete cascade
  user_id uuid not null references profiles(id) on delete cascade
  created_at timestamptz not null default now()
  unique (suggestion_id, user_id)
```

Indexes: `(suggestion_id)` join lookups · `(organization_id, user_id, created_at desc)` Referenced list. (Author/recipient duplication of a referenced user is excluded server-side at write time, not by a DB constraint.)

```txt
staff_suggestion_comments
  id uuid primary key default gen_random_uuid()
  organization_id uuid not null references organizations(id) on delete cascade
  suggestion_id uuid not null references staff_suggestions(id) on delete cascade
  created_by_user_id uuid not null references profiles(id) on delete restrict
  body text
  image_urls text[] not null default '{}'
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()  -- set_updated_at() trigger
```

CHECK constraints: `coalesce(array_length(image_urls,1),0) <= 5` (max 5 photos) · not fully empty (`trim(body) <> '' or array_length(image_urls,1) > 0`). Index: `(suggestion_id, created_at asc)` thread loading.

Visibility helper: `public.can_view_staff_suggestion(target_suggestion_id uuid)` — `SECURITY DEFINER`, returns true if `auth.uid()` is the author, the recipient, or a referenced user (used by the three SELECT policies; bypasses RLS to avoid recursion).

Permissions note: read access is limited to author + recipient + referenced users (+ platform admin). Only the recipient changes status. Referenced users can comment but cannot change status or edit the main suggestion. The author edits/deletes the main suggestion only while `submitted`; comment edit/delete is comment-author only. These rules are enforced by the implemented service-role server actions; participant reads remain RLS-scoped.

## customer_complaints / complaint_comments / external_reviews / review_translations

`customer_complaints`와 `complaint_comments`는 수동 컴플레인 도메인으로 구현되어 있다
(migration `202606290001_customer_complaints.sql`). `external_reviews`와 `review_translations`도
Beds24 수집·DeepL 온디맨드 번역용으로 구현되어 있다(migration `202608050001_external_reviews.sql`,
예약 식별자 보강 `202608060001_external_reviews_source_reservation.sql`). 외부 리뷰는 수동
컴플레인과 별도 레코드이며 사용자가 명시적으로 전환할 때만 연결된다.

```txt
external_reviews (implemented)
  id uuid primary key default gen_random_uuid()
  organization_id uuid not null references organizations(id) on delete cascade
  provider text not null                         -- airbnb | booking
  external_review_id text not null
  rating_value numeric
  rating_scale numeric
  risk_level text not null default 'unrated'     -- unrated | normal | risk | critical
  rating_breakdown jsonb not null default '{}'   -- provider-specific detailed scores; may be empty
  reviewed_at timestamptz
  imported_at timestamptz not null default now()
  source_updated_at timestamptz
  property_id uuid references properties(id) on delete set null
  property_name text
  room_id uuid references rooms(id) on delete set null
  room_label text
  reservation_id uuid references reservations(id) on delete set null   -- local link; never displayed
  source_reservation_id text                     -- provider's own reservation number; this is what the UI shows
  guest_display_name text                        -- Booking.com: reviewer.name. Airbnb: copied from the matched reservation
  headline text                                  -- Booking.com content.headline; Airbnb has none
  source_language_code text                      -- Booking.com content.language_code; null on Airbnb
  review_text text                               -- nullable: provider may submit score-only review
  positive_review_text text                      -- Booking.com, nullable
  negative_review_text text                      -- Booking.com, nullable
  private_feedback text                          -- Airbnb only; guest-to-host, never public
  ota_reply_text text                            -- Booking.com reply.text, read-only
  ota_replied_at timestamptz                     -- Booking.com reply.last_change_timestamp
  raw_payload jsonb not null default '{}'
  linked_complaint_id uuid references customer_complaints(id) on delete set null
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
  unique (organization_id, provider, external_review_id)
```

Implemented indexes: `(organization_id, provider, reviewed_at desc)`,
`(organization_id, risk_level, rating_value asc, reviewed_at desc)`,
`(organization_id, property_id, room_id, reviewed_at desc)`, and a partial index for unlinked risky
reviews. `customer_complaints` will gain an optional one-to-one external review link/snapshot only
when a user explicitly converts a review; implementation must enforce that one review cannot create
duplicate linked complaints.

**Risk is server-calculated (revised 2026-08-04):** `risk_level` has exactly three values —
`unrated` / `normal` / `risk`. Airbnb `rating_value <= 3` = `risk`; Booking.com `rating_value <= 7.0`
= `risk`; anything above the boundary = `normal`; missing/unverifiable score = `unrated`. **Boundary
values belong to `risk`.** The earlier Booking `critical` (`< 7.0`) tier was dropped. Airbnb's
`overall_rating` arrives as an int32, so its `risk` band is effectively 1–3.

Reviews are stored **in full regardless of score** — `risk_level` is a classification, not an
ingestion filter. Building/room average ratings depend on the good reviews too, and the Airbnb
endpoint offers no score or date filter anyway.

`rating_breakdown` deliberately preserves provider-specific dimensions rather than fabricating a
cross-provider schema: Airbnb stores `category_ratings[]`, Booking.com stores
`scoring{clean, comfort, facilities, location, staff, value}` — measured 2026-08-07 across all 253
stored reviews. The planned `services` key **does not exist** in the payload (0/253) while `comfort`
does (245/253) and was being dropped; both were corrected and the stored breakdowns backfilled from
`raw_payload`. Booking.com positive/negative text is
independently nullable; both may be absent for a valid score-only review.

**Reservation linkage (corrected 2026-08-06, migration `202608060001_external_reviews_source_reservation.sql`).**
The original note "Airbnb exposes no reservation id" was wrong — measured against our own stored
`raw_payload`, all 2,214 Airbnb reviews carry `reservation_confirmation_code` (e.g. `HMRWNK5RQW`).
It is not a Beds24 bookingId, hence the miss, but the same code lives on our reservations at
`raw_payload->>apiReference` (indexed by `reservations_api_reference_idx`).
(Same-booking lookups in `reservation-lookup.ts` use the stored generated column
`reservations.original_reservation_id = split_part(source_reservation_id, '::room::', 1)` with index
`(organization_id, original_reservation_id)` — migration `202610160002`. The earlier
`LIKE '<id>::room::%'` + `text_pattern_ops` index still seq-scanned under PostgREST's parameterised plans.) `source_reservation_id`
stores the provider-native number for both providers and is what the detail screen displays;
`reservation_id` stays the internal uuid link. The Airbnb match also supplies `guest_display_name`,
since the review payload itself really does carry no reviewer name (numeric `reviewer_id` only).
Room is **not** taken from the matched reservation for Airbnb — the queried `roomId` is the stronger
signal. Unmatched reviews keep NULLs; nothing is inferred.

`private_feedback` is Airbnb's guest-to-host private note. It carries no score and must never feed
risk classification or rating aggregation; clients render it visually separated from the public
review. `ota_reply_text` surfaces a reply that already exists on the OTA — Foldy does not compose
or send replies in v1.

**Field availability is asymmetric between providers.** Airbnb returns no `reservation_id` and no
reviewer name, but the queried `roomId` pins the room exactly. Booking.com returns no room at all,
only a `reservation_id` (Beds24 bookingId) resolved against local `reservations.source_reservation_id`.
Where a payload omits a room or a safe reservation key, `room_id`/`room_label` stay null rather than
inferred. Airbnb reviews are bidirectional: only guest-authored, submitted, non-hidden reviews are
ingested. `raw_payload` is server-side troubleshooting data, not a client rendering contract — and it
matters more than usual because both Beds24 review endpoints are Beta/Alpha. Full workflow:
`docs/product/25-complaint-workflow.md`.

```txt
review_translations (implemented)
  id uuid primary key default gen_random_uuid()
  organization_id uuid not null references organizations(id) on delete cascade
  external_review_id uuid not null references external_reviews(id) on delete cascade
  source_part text not null                      -- review | positive | negative | headline | private
  target_locale text not null                    -- ko | ja | en
  source_locale text
  translated_text text not null
  provider text not null default 'deepl'
  translated_at timestamptz not null default now()
  source_text_hash text not null
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
  unique (external_review_id, source_part, target_locale)
```

The server verifies `organization_id` against the parent review on every read/write. A translation is
reused only while `source_text_hash` equals the current source-review text hash; changed source text
requires a fresh on-demand translation. Translation usage/cost telemetry belongs in a separate
server-only sync/usage log, not in this user-facing record.

### Period rating summaries (implemented derived query contract)

Building/room rating summaries do **not** add a source-of-truth table in v1. The server aggregates
`external_reviews` directly by `organization_id`, `provider`, and `reviewed_at` range:

- building: `property_id` / property snapshot; average `rating_value`, review count, **risk count**
  (`risk_level = 'risk'`) and risk ratio;
- room: only reviews with a reliable `room_id`; same four measures;
- scores are never averaged across providers because Airbnb and Booking.com use different native scales;
- rows without `reviewed_at` are excluded from a selected-period summary;
- `unrated` rows count toward review count only — never toward the average or the risk count;
- reviews with a null `room_id` count toward their building's totals but not toward any room row, so
  the screen states the unmapped remainder explicitly instead of letting building and room sums drift;
- properties where `properties.property_type = 'standalone'` (the Okubo detached-house rule) return a
  building summary only and suppress all room summary rows, even if room mapping data exists. The rule
  keys off the enum, never off a property-name string.

The risk count exists because an average hides a handful of bad stays in a high-volume room. The
`문제 객실` admin view sorts on risk ratio and drills from a risk count straight into that building's
or room's filtered review list.

The range default/control is a design decision, not a schema default. Introduce a cache/materialized
aggregate only after measuring a real query-performance need; it must remain derived exclusively from
`external_reviews`.

## bug_reports

Foldy 앱/시스템 버그 및 제품 문제 신고. **1차 구현 (2026-06-25).** Migration: `supabase/migrations/<timestamp>_bug_reports.sql` (DB engineer 결과 확인 후 파일명 갱신 필요).

```txt
id                    uuid primary key default gen_random_uuid()
organization_id       uuid not null references organizations(id) on delete cascade
reported_by_user_id   uuid not null references profiles(id) on delete restrict
title                 text not null
description           text not null
image_urls            text[] not null default '{}'
status                text not null default 'submitted'
reviewed_by_user_id   uuid references profiles(id) on delete set null
closed_by_user_id     uuid references profiles(id) on delete set null
closed_at             timestamptz
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
```

CHECK constraints:
- `char_length(trim(title)) > 0`
- `char_length(trim(description)) > 0`
- `coalesce(array_length(image_urls, 1), 0) <= 5`
- `status in ('submitted', 'reviewing', 'fixed', 'closed')`

Indexes:
- `bug_reports_org_created_idx (organization_id, created_at desc)`
- `bug_reports_reporter_idx (organization_id, reported_by_user_id, created_at desc)`
- `bug_reports_status_idx (organization_id, status, created_at desc)`

Storage: 이미지 → `request-images` 버킷, path: `{organization_id}/bug-reports/{report_id}/{filename}`, 최대 5장.

Permissions: 작성자 본인 SELECT/DELETE(submitted만) · 리뷰어(`owner`, `office_admin`) SELECT · 모든 활성 멤버 INSERT · 리뷰어 status UPDATE. 모든 쓰기는 서비스롤 서버 액션 경유. 자세한 RLS 명세: `docs/engineering/05-rls-permissions.md` → `bug_reports`.

## Attendance / Payroll tables

**As-built — Step 1 schema (2026-06-17), migration `202606170001_attendance_payroll.sql`.** The refined
attendance/payroll policy (decision-log 2026-06-17) is a **session-first** model, not loose event rows.
This supersedes the earlier `attendance_events` / `employment_profiles` draft. Full column-by-column
spec lives in `docs/engineering/11-attendance-payroll-technical-design.md`; this is the data-model
summary. All tables are organization-scoped, carry timestamps, and have **read-only RLS** (no write
policies — all writes go through service-role server actions in later steps; see
`docs/engineering/05-rls-permissions.md`).

Permission foundation:

- `memberships.attendance_payroll_admin boolean not null default false` — explicit per-membership
  attendance/payroll privilege (separate from the broad role names).
- `can_manage_attendance_payroll(org)` SECURITY DEFINER helper = platform admin, OR an active member
  who is the org `owner` or carries the `attendance_payroll_admin` flag. Site master / QR issuance stays
  **owner-only** (enforced in app logic via `has_org_role(org, ['owner'])`).

Tables (12):

| Table | Purpose / key columns |
|---|---|
| `attendance_sites` | registered sites; `print_name` (nullable, migration `202607310002`) = QR 인쇄물 표기용 이름(주로 영문); 비면 `name` 폴백, 화면/기록 표기에는 쓰지 않는다; `latitude`/`longitude`/`allowed_radius_meters` (default **100**), `wifi_ssids text[]` (modeled, PWA-inactive), `is_active`. Owner-managed. |
| `attendance_qr_tokens` | one **active token per site** (partial unique on `site_id where is_active`); reissue revokes + links `replaced_by_token_id`. |
| `attendance_trusted_devices` | **Implemented (2026-07-31, migration `202607310001`).** 근태 QR 딥링크용 "기억된 기기". 컬럼: `token_hash`(**원문 토큰은 저장하지 않는다 — sha256 해시만**), `device_label`("iPhone · Safari" 수준), `last_used_at`, `expires_at`(**180일 슬라이딩**), `revoked_at`. 打刻 **성공 직후**에만 발급/연장된다. **이 자격증명은 출근/퇴근 打刻 두 가지만 허용한다** — 이력·급여·정정·다른 모듈은 여전히 정상 세션이 필요하고, GPS 필수 + 사이트 반경 검증도 그대로다. 로그아웃·기기 주인 변경·관리자 해지·만료로 폐기. See `docs/product/24-attendance-workflow.md` → "Trusted Device". |
| `attendance_sessions` | the core work session; `status` (open/completed/reopened/invalid), `review_state` (normal/review_required/pending_correction/approved_correction/rejected_correction), separate clock-in/out `*_at/_site_id/_method/_qr_token_id/_lat/_long/_accuracy/_device_info`, `operating_date` (Tokyo), `manual_created*`, `manual_location` (free-text work location for off-site / manual entries, migration `202607100004`; overrides the site name in per-user payroll exports), `invalidated*`. **One `open` session per user** (partial unique on `user_id where status='open'`). Methods: `gps_qr`/`gps_wifi`/`manual`. |
| `attendance_breaks` | multiple breaks per session; `started_at`/`ended_at` (open while null). Clock-out-blocked-by-open-break is server-enforced. |
| `attendance_attempt_logs` | every attempt (success/failure) for admin diagnostics; `action_type`, `method`, `failure_reason` (gps_denied/outside_radius/qr_*/wifi_*/open_break_blocks_clock_out/midnight_crossing/open_session_exists). Admin-visible only; no payroll effect. |
| `attendance_correction_requests` | user-submitted corrections; `status` (requested/in_review/approved/rejected), `reason_type`, `target_month` (YYYY-MM-01, migration `202606180003`), `desired_clock_in/out_at/_site_id`, `memo`, `image_urls` (**max 5**), `review_comment`/`reviewed_*`, `target_date` (세션 없는 예외 요청의 근무 날짜, 세션 요청은 null — migration `202610010002`, 2026-10-01). |
| `attendance_session_audits` | append-only manager-action trail; `action_type` (manual_create/manual_update/invalidate/restore/correction_apply/reopen/finalize), mandatory `reason`, `before_json`/`after_json`. |
| `employment_type_history` | per-person `employment_type` (hourly/salaried) with `effective_from`/`effective_to`. Past never reinterpreted. |
| `hourly_rate_history` | per-person `hourly_rate` with `effective_from`/`effective_to`. Past never changes. This remains the base contractual/default rate layer; one-off busy-day allowances must not be stored here. |
| `attendance_pay_allowances` | **Implemented (2026-07-10, migration `202607100001`).** Date-based attendance allowance layer for busy/short-staffed days. Columns: `target_date`, nullable `target_user_id` (null = all hourly workers), `allowance_type` (`daily_fixed` / `hourly_extra` — calculation method), `amount_yen`, `category` (`regular` = 추가수당 / `special` = 특별수당, renamed from `reason_type` in migration `202607100003`; decides which payroll column the amount lands in), `memo`, `status` (`active` / `cancelled`), creator/canceller audit fields. Separate from `hourly_rate_history`; reflected into payroll calculation (`attendance-pay.ts`, split into 추가수당/특별수당 buckets) and preserved in the finalized snapshot's `allowance_breakdown jsonb` column. Read-only RLS (own targeted rows or payroll admin); create/cancel via service-role actions only, blocked for a finalized user-month. |
| `attendance_month_snapshots` | per-person per-month payroll snapshot; `status` (draft/finalized/superseded/reopened), `total_paid_minutes`, `gross_amount`, `rate_breakdown jsonb`, `supersedes_snapshot_id`. Migration `202607030003_attendance_finalized_snapshot_unique.sql` enforces at most one `finalized` row per `(organization_id, user_id, target_month)` while preserving historical reopened/superseded rows. |
| `attendance_export_logs` | export audit trail; `export_scope` (monthly_bulk/single_user), `target_month`, `snapshot_ids uuid[]`, `exported_by_user_id`. |
| `transport_reimbursement_reports` | per-user-month transport-cost ledger (migration `202606260001`), **separate from payroll** (`attendance_month_snapshots`). `target_month` (1st of Tokyo month), `status` (draft/submitted/reviewing/approved/rejected/**changes_requested** — the last added in migration `202607030001`; worker-editable like draft/rejected, i.e. "sent back for fixes, please resubmit"), `submitted_at`/`reviewed_at`/`reviewed_by_user_id`/`review_note`, `total_amount_cached` (convenience; items are source of truth). Unique `(organization_id, user_id, target_month)`. Admin review transitions: submitted/reviewing/changes_requested → approved \| rejected \| changes_requested; approved/rejected → **reopen** (back to submitted, drops out of the payroll total until re-approved). |
| `transport_reimbursement_items` | reimbursable transport entries (many per report); `usage_date`, `amount_yen` (>0), `entry_mode` (linked/manual), optional `attendance_session_id`/`property_id`/`room_id`, `work_context jsonb` (building/room/cleaning summary), `memo`, `sort_order`. FKs to session/property/room are `on delete set null`. |
| `transport_reimbursement_item_images` | receipt/proof images per item; `storage_path`, `sort_order`. Image count enforced in app. Storage: `request-images/{org}/transport-reimbursements/{report_id}/{item_id}/{file}` (5-part path). |

Attendance/payroll integrity hardening (2026-07-03):

- Admin manual session writes and correction approval validate chronological order; completed sessions must have `clock_out_at > clock_in_at`.
- Overnight manual clock-out times are resolved to the next Tokyo date when the same-day time would be earlier than clock-in, then flagged for review when crossing Tokyo midnight.
- Finalized user-months are locked against manual session edits, invalidation, restore, and correction approval that would change pay-affecting data.
- Session-less exception approvals create a completed manual attendance session with audit trail.
- Admin payroll/transport views include active members plus inactive members with month activity/snapshots/reports, preventing resigned staff from disappearing from accounting exports.
- Attendance allowances (implemented 2026-07-10) are locked by the same finalized-month rule: once a
  user-month has a finalized snapshot, allowance creation/cancellation for that user-month is blocked
  until reopen and
  re-finalize.

**Step 2 (2026-06-17):** site/QR **backend** — migration `202606170002_issue_attendance_qr_fn.sql` adds
the atomic `issue_attendance_qr(org, site, created_by, token)` function (deactivate old → insert new →
link `replaced_by_token_id`, preserving one-active-per-site). Helpers in `src/lib/attendance-sites.ts`
(create/update/activate site, issue/reissue/revoke QR, list/get/active-QR/history reads). The owner-only
**admin UI is deferred to the web dashboard**; a dev-only `GET /api/dev/attendance/temp-qr` provisions a
temp site + scannable QR for app testing.

**Step 3 (2026-06-17):** worker **GPS + QR clock-in/out** writes `attendance_sessions` (one `open` per
user; Tokyo `operating_date`; clock-in/out site, method `gps_qr`, QR token ref, lat/long/accuracy,
device info; since 2026-10-21 a prior-day open session is moved to `abandoned` and the clock-out is
refused — it no longer flags `review_required`) and logs every attempt to
`attendance_attempt_logs`. Via `submitAttendanceScan` (`src/app/mobile/attendance/actions.ts`,
service-role); the open session is read by `getCurrentOpenSession` (`src/lib/attendance-sessions.ts`).
In-app QR decode uses the `jsqr` dependency. `attendance_session_audits` are still untouched (manager
edits are a later step).

**Step 4 (2026-06-17):** **break tracking** writes `attendance_breaks` (`startBreak`/`endBreak` in
`src/app/mobile/attendance/actions.ts`): one open break at a time, multiple breaks per session, each row
kept individually (open break has `ended_at` null). Clock-out is blocked while a break is open
(`open_break_blocks_clock_out`). Break rows are not logged to `attendance_attempt_logs` (that table is
GPS/QR-oriented). `getCurrentOpenSession` derives the on-break flag + closed-break total + count for the
home.

**Step 5 (2026-06-17):** worker **self-view history** reads `attendance_sessions` + `attendance_breaks`
(+ `attendance_sites` for names) via `src/lib/attendance-history.ts` (`getAttendanceHistory`,
`getAttendanceTodaySummary`) — **strictly self-scoped** (`user_id` = authenticated user + org; no
client-supplied target). No writes, no pay calc; shapes leave room for later correction/pay indicators.
New screen `/mobile/attendance/history`.

**Step 6 (2026-06-17):** **correction / exception requests** write `attendance_correction_requests`
(`createAttendanceCorrectionRequest` in `src/app/mobile/attendance/actions.ts`) — self-only, current or
previous Tokyo month only, reason + desired in/out times + desired site + memo + image_urls (≤5). The
request **never mutates the session** (admin confirms later). Session-linked or session-less (exception).
Photos use the `request-images` bucket's new `attendance-corrections/` folder (storage migration
`202606170003_attendance_correction_storage.sql`). Reads via `src/lib/attendance-corrections.ts`
(self-scoped); the latest per-session status is surfaced on the history screen.

**Step 7 (2026-06-17):** **admin correction review** — `src/lib/attendance-review.ts` (org-wide review
queue + `isAttendancePayrollAdmin` gate) and `src/app/admin/attendance/actions.ts` (approve / reject /
in-review, owner+`attendance_payroll_admin` only). **Approve** updates the linked `attendance_sessions`
row with admin-confirmed final values (review_state → `approved_correction`, open→completed when both
ends present) and writes an `attendance_session_audits` row (`correction_apply`, before/after). **Reject**
(comment required) updates only the request row (no session change). The review-queue UI is live in the
web dashboard.

**Step 8 (2026-06-17):** **manual admin management** (`src/app/admin/attendance/actions.ts`:
`createManualAttendanceSession` / `updateAttendanceSessionAdmin` / `invalidateAttendanceSession` /
`restoreAttendanceSession` (added 2026-07-02), owner+`attendance_payroll_admin` only). Create sets
`manual_created` + `manual_created_by_user_id` + `manual_created_reason` (methods `manual`); update
edits clock-in/out times+sites+review_state; invalidate sets `status='invalid'` +
`invalidated_at/_by_user_id/_reason` (**never hard-deletes**); restore is invalidate's explicit reverse
(recomputes `status` from the session's own clock-in/out, clears the `invalidated_*` fields, resets
`review_state`, blocked on a conflicting open session). Every action requires a reason and writes an
`attendance_session_audits` row (`manual_create` / `manual_update` / `invalidate` / `restore`,
before/after). The admin queue and manual-management surfaces use these actions.

**Step 10 (2026-06-18):** **hourly expected-pay** reads `attendance_sessions` + `attendance_breaks` +
`hourly_rate_history` + `employment_type_history` (effective-date resolution) via `src/lib/attendance-pay.ts`
(`getMonthlyPayView`, self-scoped) — usable sessions only, 1-min paid units, breaks excluded, monthly gross
rounded to 10 yen; no writes, no finalization. `attendance_pay_allowances` (implemented 2026-07-10) adds
a separate date-based allowance layer (`daily_fixed` / `hourly_extra`) without changing base hourly-rate
history; `expectedGross` in the pay view now means base wage + allowance (rounded once at the monthly
layer).
New self screen `/mobile/attendance/pay`. Employment/rate management writes are implemented in the
admin wages console; a dev route `/api/dev/attendance/seed-pay` remains for local testing.

**Step 11 (2026-06-18):** **monthly finalization** writes `attendance_month_snapshots`
(`finalizeAttendanceMonth` / `reopenAttendanceMonth`, owner+`attendance_payroll_admin`). Eligibility
(`src/lib/attendance-finalization.ts`) blocks finalize while review-required / pending-correction / open
sessions or an existing finalized snapshot remain. Finalize inserts `status='finalized'`
(target_month=`YYYY-MM-01`, total_paid_minutes, gross_amount [10-yen rounded], rate_breakdown jsonb,
finalized_by/at, supersedes_snapshot_id); prior non-superseded rows → `superseded` (history preserved).
Reopen flips `finalized` → `reopened` (expected pay resumes). Finalize/reopen are audited in the generic
`audit_logs` table (`attendance_month_finalize` / `attendance_month_reopen`, reason in metadata) — no
schema change. The worker self pay view reflects the finalized snapshot; the admin payroll console
exposes finalize/reopen.

**Step 12 (2026-06-18):** **payroll-totals data layer** (`src/lib/attendance-payroll-totals.ts`,
`getPayrollTotals(org, ym)`) reads `attendance_month_snapshots` (finalized total) + recomputed expected
pay per hourly worker + `attendance_sessions`/`attendance_sites` (site rollup by clock-in site). Returns
finalized vs expected labor totals, unfinalized worker count, and per-site totals. The query is read-only
and surfaced in the privileged dashboard; owner/`attendance_payroll_admin` gate is enforced by the caller.

**Step 13 (2026-06-18):** **finalized-only export** (`src/lib/attendance-export.ts` `runPayrollExport` +
`exportMonthlyPayroll` / `exportUserPayroll`) reads `attendance_month_snapshots` (status='finalized'
only) + `profiles` (names), serializes a structured CSV (interim, until the operator Excel template), and
writes an `attendance_export_logs` row (organization_id, target_month, export_scope monthly_bulk/single_user,
user_id, snapshot_ids[], exported_by_user_id, meta). owner/`attendance_payroll_admin` only. The admin
console also offers localized Excel and print-to-PDF reports; a dev route streams the legacy CSV path.

**Step 14 (2026-06-18):** **notifications** use the shared `notifications` table + new `attendance_activity`
enum value (migration `202606180001`). New table `attendance_open_session_reminders` (migration
`202606180002`, unique per `(organization_id, user_id, operating_date)` — org-scoped per migration
`202606180003`) holds the once-per-Tokyo-day 18:30 reminder response (`still_working` / `left_work`).
Admin alerts (correction_created, abnormal_session) target owner / `attendance_payroll_admin`; the worker
reminder targets the worker. Scheduled scan `GET /api/attendance/reminders` (CRON_SECRET). In-app only.

**Bug-fix pass (2026-06-18)** — migration `202606180003_attendance_session_fixes.sql`:
- Added `target_month date` column to `attendance_correction_requests` (enables per-month export and
  session-less corrections outside the current month).
- Changed `attendance_open_session_reminders` unique constraint from `(user_id, operating_date)` to
  `(organization_id, user_id, operating_date)` — organization isolation was missing.
- Added partial index on `attendance_correction_requests` for session-less corrections
  (`session_id IS NULL`).
- Fixed finalization order bug in `finalizeAttendanceMonth` (insert new row before superseding prior).

Wi-Fi attendance (`gps_wifi`) is modeled but **not active** in the PWA. Shared row types +
status/method/reason unions + constants live in `src/lib/attendance.ts`.

## annual_leave_baselines

**Phase 1 foundation (implemented 2026-07-06), migration
`202607060001_annual_leave_hire_date_baseline.sql`.** This table began as the hire-date/baseline slice;
the later request, approval, calendar, document, and export workflow is now implemented.

One row per user: the employee's self-entered "as of today" starting balance for the two pools
tracked by `src/lib/annual-leave.ts` (`computeAnnualLeaveSummary`) — 유급 휴가 (base) and 특별휴가
(one-time 4-year bonus). The accrual schedule itself (10/11/12/14/16/18/20d + 4-year +4d bonus, 2-year
lapse) is computed in app code from `hire_date`, not stored.

```txt
id uuid primary key default gen_random_uuid()
organization_id uuid not null references organizations(id) on delete cascade
user_id uuid not null references profiles(id) on delete cascade
base_amount numeric(5,1) not null default 0    -- 유급 휴가 pool, as of baseline_date
bonus_amount numeric(5,1) not null default 0   -- 특별휴가 pool, as of baseline_date (usually 0)
baseline_date date not null                    -- Tokyo date the baseline was recorded (auto, = today at save time)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()  -- set_updated_at() trigger
unique (organization_id, user_id)
```

RLS: read-only (self row, or org owner/`attendance_payroll_admin`/platform admin org-wide) — same
shape as `transport_reimbursement_reports`. All writes go through the service-role server action
`setAnnualLeaveBaselineAction` (`src/app/mobile/attendance/leave/actions.ts`), which also sets
`profiles.hire_date`. Self-service upsert — one row per user, overwritten (not versioned) on
re-save. Reads: `getMyAnnualLeaveSummary` (`src/lib/annual-leave-server.ts`) returns null when either
`hire_date` or this row is missing, which routes the mobile screen to the "hire date missing"
self-entry form instead of the balance view.

Implemented follow-up: approved usage is deducted from the correct leave pools; admin hire-date/grant
editing is available in the leave balance view; and current workflow gates exclude hourly/part-time
membership paths according to the documented salary-based rule.

## annual_leave_requests

**Phase 2 backend. Stage 1 (request submission/cancellation, implemented 2026-07-06) and stage 2
(admin approval review, implemented 2026-07-07) are both live** — migration
`202607060002_annual_leave_requests.sql` (no new migration was needed for stage 2; it reuses the
approval/reject columns already defined here). Document numbering, printable 休暇届 output, calendar,
ledger, and exports are also implemented; see `docs/product/26-annual-leave-workflow.md`.

Confirmed policy this schema encodes:

- approver = any member with `memberships.leave_approver_role` set — either one approving completes
  the request (no sequential chain)
- attachments are optional
- e-signature is an approval "stamp" (button click; name + timestamp recorded on approval), not a
  drawn signature
- 경조휴가(`annual`)/기타(`other`) requests never affect the accrual pools; 유급휴가(`paid`) draws
  the base pool; 특별휴가(`special`) draws the bonus pool only (see `src/lib/annual-leave.ts`)

```txt
id uuid primary key default gen_random_uuid()
organization_id uuid not null references organizations(id) on delete cascade
user_id uuid not null references profiles(id) on delete cascade
applicant_name text not null          -- snapshot at submit time, survives later profile name changes
leave_type text not null              -- annual(경조) | paid(유급) | special(특별휴가) | other(기타)
start_date date not null
end_date date not null                -- check: end_date >= start_date
duration_unit text not null default 'full'  -- full | am | pm
days_count numeric(4,1) not null      -- allows .5 for half-day
reason text not null
emergency_contact text not null
image_urls text[] not null default '{}'     -- optional, max 5
status text not null default 'requested'    -- draft | requested | approved | rejected | cancelled
submitted_at timestamptz              -- null while draft
approved_by_user_id uuid references profiles(id) on delete set null
approved_role text                    -- department_head | senior_managing_director; drives the printed stamp box
approved_at timestamptz
rejected_by_user_id uuid references profiles(id) on delete set null
rejected_reason text
rejected_at timestamptz
cancelled_at timestamptz
cancelled_by_user_id uuid references profiles(id) on delete set null  -- admin revoke or self-cancel (202607090001)
cancelled_reason text                 -- optional (202607090001)
document_number text                  -- 休暇届 no. AL-YYYY-MM-NNN, assigned on approval (202607080001)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()  -- set_updated_at() trigger
```

**Stage 3 — 休暇届 document (implemented 2026-07-08):** `document_number` (migration
`202607080001_annual_leave_document_number.sql`) holds the printable form number `AL-YYYY-MM-NNN`
(`YYYY-MM` = approval month, Asia/Tokyo; `NNN` = zero-padded per-org/month sequence), assigned on approval
(best-effort, never blocks the approval). A partial unique index `(organization_id, document_number)`
guards collisions; the migration backfills existing approved rows. No separate documents table — the A4
休暇届 is derived from the request row + approver name; the 문서 sub-tab reads it via `listLeaveDocuments`.

Permission foundation: `memberships.leave_approver_role text` (values `department_head` = 대표/CEO,
`senior_managing_director` = 전무, matching the two stamp boxes on the paper form's 결재란 — 부서장
column is filled by the company's 대표) + `is_leave_approver(org)` SECURITY DEFINER helper, same
shape as `attendance_payroll_admin`/`can_manage_attendance_payroll` but a role enum instead of a
boolean since the (not-yet-built) printed document needs to know which stamp box an approval fills.

**Stage 2 (implemented 2026-07-07):** `approved_by_user_id`/`approved_role`/`approved_at` and
`rejected_by_user_id`/`rejected_reason`/`rejected_at` are now actually written by the admin approval
queue at `/admin/attendance/leave`, via `approveLeaveRequestForApprover` /
`rejectLeaveRequestForApprover` (`src/lib/annual-leave-approvals-server.ts`, service-role,
organization-isolated, re-verifies `is_leave_approver`). Approve transitions `status: requested →
approved` only from `requested`; reject transitions to `rejected` with an optional (not required)
reason, per confirmed policy. Usage deduction into `computeAnnualLeaveSummary`'s `usedDays`/
`specialUsedDays` is still not wired — approval does not yet affect the balance calculation itself.

RLS: read-only (self row, or `is_leave_approver(org)`/platform admin org-wide) — no write policies;
all writes go through service-role server actions `submitLeaveRequestAction` /
`cancelLeaveRequestAction` / `deleteLeaveRequestDraftAction`
(`src/app/mobile/attendance/leave/actions.ts`). `submitLeaveRequestAction` takes an optional
`requestId`: omitted → insert a new row; present → `updateDraftLeaveRequest` overwrites that row in
place (only while it's still `status = 'draft'`) and, if not saving as a draft again, transitions it
to `requested` — this is how "임시저장" (save draft) is resumed and finished from
`/mobile/attendance/leave/new?id=<id>`. `deleteLeaveRequestDraft` (only callable while still `draft`)
hard-deletes a draft — surfaced as a swipe-to-delete row in `leave-history.tsx` (reuses the
`notification-list.tsx` `SwipeItem` interaction). Storage: optional evidence images reuse
`request-images` at `{org_id}/annual-leave-requests/{request_id}/{filename}` (max 5, same convention
as attendance-corrections/transport-reimbursements).

**Team calendar visibility (2026-07-06, migration `202607060003_annual_leave_approved_visibility.sql`).**
Confirmed: the mobile leave calendar (L5) shows every employee's **approved** leave, including the
viewer's own — an additive SELECT policy `annual_leave_requests_org_approved_select`
(`status = 'approved' AND has_active_membership(org)`) grants this on top of the existing
self-or-approver policy. Pending/rejected/draft/cancelled requests are never visible org-wide.
Query: `listApprovedLeaveForMonth` (`src/lib/annual-leave-requests-server.ts`), rendered by
`leave-calendar.tsx` with real month/year navigation (`?ym=` query) — replacing the earlier
hardcoded July-2026 mock calendar.

## membership_permission_overrides

**Implemented (schema 2026-07-09; UI/actions/enforcement completed 2026-07-13).** See
`docs/product/27-permission-override-workflow.md`.

Purpose: let `owner` / `senior_managing_director` / `developer_super_admin` grant one specific person a specific, named,
**time-bound** feature exception **without** changing their role and without a new migration per
exception type. This is additive to — not a replacement for — the seven-role model and the three
existing per-feature flags (`memberships.attendance_payroll_admin`, `memberships.leave_approver_role`,
`profiles.can_generate_report`), none of which this migration touches.

```txt
id uuid primary key default gen_random_uuid()
organization_id uuid not null references organizations(id) on delete cascade
user_id uuid not null references profiles(id) on delete cascade   -- the person receiving the exception
permission_key text not null           -- OPEN whitelist, no DB enum/CHECK (managed in app code, src/config/roles.ts style)
granted_by_user_id uuid references profiles(id) on delete set null
reason text not null                   -- mandatory reason (audit)
expires_at timestamptz not null        -- time-bound BY DESIGN; no permanent grants through this system
revoked_at timestamptz                 -- null = still active (if not expired)
revoked_by_user_id uuid references profiles(id) on delete set null
created_at timestamptz not null default now()
-- check: granted_by_user_id <> user_id   -- DB-level self-grant guard (double defense; server action also checks)
```

Design notes:
- `permission_key` is `text` at the DB layer, while the closed application whitelist lives in
  `src/config/permission-overrides.ts`: `order_processor`, `maintenance_status_change`,
  `property_room_manage`, and `can_generate_report`. It can never be `"role"`; role changes stay on the
  existing role-change flow (`updateMemberRole`).
- `expires_at` is `not null` — no permanent/indefinite grants through this system by policy.
- No `updated_at` (revoke is a one-shot write of `revoked_at`/`revoked_by_user_id`); no `set_updated_at`
  trigger.
- Actor columns (`granted_by_user_id`/`revoked_by_user_id`) use `on delete set null` so the audit row
  survives an actor's profile deletion — same convention as `reviewed_by_user_id`/`approved_by_user_id`
  elsewhere.

New SECURITY DEFINER helper `has_permission_override(org, user, key) → boolean` (same style as
`has_org_role`/`is_platform_admin`): true iff an **active** row exists (`revoked_at is null AND
expires_at > now()`). Migration `202607130004_permission_override_enforcement.sql` wires it into
orders, maintenance, and property/room RLS; `can_generate_report` is enforced in application code.

Indexes: partial `(organization_id, user_id, permission_key) where revoked_at is null` (helper hot
path) + `(organization_id, user_id)` (admin browse). RLS: read-only, owner/platform-admin only — see
`docs/engineering/05-rls-permissions.md`.

## Storage buckets — batch note

Linen/board/todo image uploads reuse the existing client-compressed pattern. Linen uses the existing
`request-images` bucket under the `linen-returns/` path; the earlier dedicated `linen-images` option was
not adopted. Board file attachments use their documented private attachment path/bucket contract.

## Initial RLS Direction

Basic rules:

- Users can only access rows for organizations where they have active membership.
- Developer/Super Admin can access all organizations.
- Part-time Staff can create/view requests but cannot change statuses.
- Order request processing is office-level only.
- Price/revenue data is not stored in Foldy MVP reservation tables.

## Resolved Decisions

- CS Staff is treated as office-level for order request processing (can approve/reject/process orders).
- Shared `attachments` table is not used. Each feature table stores `image_urls text[]` directly.
- Hard delete is the MVP policy. Cascades or blocks are handled per-table per FK.
- Reservation raw payloads are stored in `reservations.raw_payload jsonb` for recovery. A separate `beds24_webhook_events` table stores ingestion processing results (webhook + reconciliation) for observability — it is a result log, not raw-payload storage.

## Open Questions

- Which exact actions must be audit logged in MVP?
- Should hard delete cascade related records or be blocked when related records exist (currently varies by table)?
- Will age and profile photo be added to the profile editing screen?
## 2026-07-10 Reservation Calendar Metadata

### `public.property_operation_infos`

Organization-scoped shared building-operation metadata used by both admin and mobile calendars.

- `organization_id`
- `canonical_name`
- `address_ko`
- `address_ja`
- `address_en`
- `shared_access jsonb`
- `room_access jsonb`
- `note`
- timestamps

Constraints / behavior:

- unique on `(organization_id, canonical_name)`
- stores overrides on top of the static property seed metadata
- intended for shared address, access, and ops-note editing from admin calendar

## 2026-08-03 `attendance_correction_requests` — 철회 상태 추가

마이그레이션 `202608030001_attendance_correction_cancel.sql` (원격 적용 완료).

- `status` CHECK: `requested | in_review | approved | rejected` → **`cancelled` 추가**
- `cancelled_at timestamptz` 추가 — `status = 'cancelled'` 일 때만 채워진다. 행위자는 항상
  `requested_by_user_id`(본인만 철회 가능)라 별도 컬럼을 두지 않았다.

대기 큐(`getAdminAttendanceCorrections`)와 마감 판정(`getFinalizationEligibility`)은
`requested|in_review` 만 세므로 `cancelled` 는 두 곳에서 자동으로 빠진다 — 별도 인덱스 불필요.

## 2026-09-09 `job_applications` — 채용 지원서 수신

마이그레이션 `202609090001_job_applications.sql` (원격 적용 완료).

외부 채용 사이트(haru-recruit / Firebase)에서 넘어온 지원서를 보관·심사한다. 도메인 계약은
`docs/product/30-recruit-workflow.md`.

새 enum `job_application_status`: `pending | screening | interview`.
(최초에는 `hired`/`rejected` 가 있었으나 2026-09-09 제거 — `202609090003`.)

주요 컬럼:

- 원본 식별 — `source`(`applications` | `applicants`, Firestore 컬렉션 이름), `external_id`(문서 ID)
- 공고 — `job_external_id`, `job_title`, `employment_type`, `applied_position`
- 지원자 — `applicant_name`(NOT NULL), `age`, `gender`, `phone`, `kakao_id`, `address`,
  `commute_time`, `uniform_size`
- 체류 — `nationality`, `visa_type`, `visa_period`
- 조건 — `work_days text[]`, `days_per_week`, `duration`, `start_date`
- 경험 — `has_industry_exp`, `industry_tasks text[]`, `source_channel`(지원 경로), `motivation`
- 이력서 — `resume_file_name`, `resume_source_url`(**서버 전용**, 토큰 포함 Firebase URL),
  `resume_path`(비공개 버킷 `recruit-resumes` 경로)
- 심사 — `status`, `status_changed_at`, `status_changed_by_user_id`, `review_note`
- 시각 — `applied_at`(원본 접수 시각, 판독 불가 시 NULL), `imported_at`
- `raw_payload jsonb` — **서버 전용** 원문 사본

Constraints / behavior:

- unique on `(organization_id, source, external_id)` — 재전송·백필 재실행이 중복을 만들지 않는다
- 수신 경로는 **지원자 정보 컬럼만** 갱신한다. 심사 상태·메모·합격 연결은 덮지 않는다
- `applied_at` 은 nullable — 접수 시각을 지어내지 않는다
- 인덱스: 최근 지원 순 / 상태별 / `pending` 부분 인덱스 / 이력서 미복사 부분 인덱스
- 새 스토리지 버킷 `recruit-resumes` 는 **비공개**(`public = false`). 다른 첨부 버킷과 다르다 —
  이력서는 개인정보 문서라 서명 URL 로만 연다

### 2026-09-09 후속 — 합격·불합격 제거

마이그레이션 `202609090003_job_application_status_triage_only.sql` (원격 적용 완료).

- enum 에서 `hired` / `rejected` 제거 → `pending | screening | interview`
- 컬럼 `invite_code_id` / `hired_user_id` / `hired_at` **삭제**. `hired` 가 없으면 채워질 수 없는
  자리다(194건 전부 null 이었다)
- enum 값은 제거가 불가능해 새 타입으로 갈아 끼운다. **부분 인덱스(`where status = 'pending'`)를
  먼저 내려야 한다** — 술어가 타입 변경 중 재해석되지 못해 실패한다

버킷 `recruit-resumes` 의 허용 형식은 `202609090002` 에서 넓혔다(.hwp/.heic/.xlsx 가 실제로 들어와
거부됐다). 목록에 없는 형식은 코드가 `application/octet-stream` 으로 낮춰 저장한다.

### 2026-09-09 후속 — Realtime 활성화

마이그레이션 `202609090004_enable_job_applications_realtime.sql` (원격 적용 완료).

- 이 테이블은 `supabase_realtime` publication 에 들어 있다(`reservations` 에 이은 두 번째).
- 콘솔은 **신호만** 받고 행 데이터는 쓰지 않는다 — 갱신은 서버 렌더를 다시 받는다
  (`src/components/admin/recruit/recruit-live-refresh.tsx`).
- select RLS 가 그대로 적용되므로 owner / 전무 / office_admin / platform_admin 이 아닌 세션은
  구독해도 아무 신호를 받지 못한다.
- **DELETE 는 배달되지 않는다.** RLS 가 걸린 테이블에서 realtime 이 DELETE 를 필터링하려면
  `replica identity full` 이 필요한데, 그러면 지워진 행 전체가 WAL 로 나간다. 삭제는 드물고
  수동이라 개인정보를 더 흘리는 쪽을 택하지 않았다.


### 2026-10-15 `annual_leave_requests` — Realtime 활성화

마이그레이션 `202610150001_enable_annual_leave_requests_realtime.sql` (원격 적용 완료 2026-10-15).

- `supabase_realtime` publication 세 번째 테이블. PC 연차 승인 화면(`/admin/attendance/leave`)이 공용
  `AdminLiveRefresh`(`src/components/admin/shared/admin-live-refresh.tsx`)로 **신호만** 받아 서버 렌더를 다시 받는다.
- select RLS(`annual_leave_requests_self_or_approver_select` 등)가 그대로 적용 — 승인자가 아니면 남의 신청 신호는 안 온다.
- DELETE 는 배달되지 않는다(replica identity 기본값). 지우는 건 승인 화면에 안 뜨는 임시저장(draft)뿐이라 문제없다.
- **구독 전에 로그인 토큰을 소켓에 싣는다**(`auth.getSession()` → `realtime.setAuth()`). 쿠키 세션이 읽히기 전에 붙으면
  anon 으로 들어가 `invalid column for filter organization_id` 로 거절되고 신호가 영영 오지 않는다 — anon 은 이 테이블들에
  열 권한이 없다(2026-10-15 실측). 같은 구조인 캘린더 · 채용 구독도 같은 경합에 걸릴 수 있다.

## 2026-09-29 `beds24_block_logs` — Beds24 차단 전송 로그

마이그레이션: `supabase/migrations/202609290001_beds24_block_logs.sql` (운영 적용 2026-09-29).
판매 캘린더 「이력 → Beds24 전송」 탭이 읽는다(`docs/product/33-calendar-write-features.md` → 「이력 · 전송 로그」).

가격·최소숙박은 `beds24_price_jobs` 가 작업마다 상태·객실별 결과를 남긴다. 차단은 큐 없이 바로 쓰고
성공하면 `room_block_snapshots` 만 남아 **실패 기록이 없었다.** 서버 액션(`runBlockChange`)이 Beds24 에
보낸 **구간 하나**(한 객실의 연속된 밤)마다 성공·실패를 한 줄 남긴다. 이력이라 고치지 않는다.

| 컬럼 | 뜻 |
| --- | --- |
| `action` | `block` · `unblock` |
| `status` | `succeeded` · `failed` |
| `property_name` · `room_label` · `external_room_ids` | 어느 방(같은 물리 방의 모든 Beds24 유닛) |
| `start_date` · `end_date` · `nights` | 막은 밤 범위(양끝 포함), 성공 시 밤 수 |
| `reason` · `detail` | 실패 사유 코드(`block-write.ts`)와 세부 |
| `requested_by` · `requested_by_name` | 누른 사람 |

인덱스 `(organization_id, created_at desc)`. 쓰기는 `recordBlockLog()`(`src/lib/beds24/block-log.ts`) —
던지지 않는다(로그 실패가 이미 반영된 차단을 실패로 만들면 안 된다).

## 2026-09-29 `price_change_logs.field` — `blackout` 추가

마이그레이션: `supabase/migrations/202609290002_price_change_logs_blackout.sql` (운영 적용 2026-09-29).
허용 값 `price1 · price2 · price3 · min_stay` 에 **`blackout`** 추가 — 판매 캘린더 「이력 → 변경 이력」이 가격·최소숙박·
차단을 한 이력으로 보여준다. 차단은 상태라 `old_value`/`new_value` 가 **1 = 차단, 0 = 열림**.

| `adjust_mode` | 누가 남기나 |
| --- | --- |
| `amount` · `percent` · `min_stay` | 우리 앱 가격·최소숙박 작업(워커, `job_id` 있음) |
| `block` | 우리 앱 차단·해제(서버 액션, `job_id` 없음 — 같은 시각으로 묶는다) |
| `beds24` | Beds24 에서 바뀐 것을 요금 동기화가 이전 값과 비교해 잡은 것(가격 `price1` · 최소숙박 · 차단) |

## 2026-09-30 `beds24_try_lock` / `beds24_release_lock` — 락을 DB 가 한 문장으로 판정

마이그레이션: `supabase/migrations/202609300001_beds24_lock_rpc.sql` (운영 적용 2026-09-30).
계약: `docs/product/33-calendar-write-features.md` → 「Beds24 락이 「읽고 → upsert」 경쟁을 지던 것」.

`beds24_sync_locks`(`202609240002_beds24_sync_locks.sql`)를 잡고 놓던 예전 방식은 **읽고 → upsert** 두
단계였다 — 두 인스턴스가 같은 순간 읽으면 둘 다 「비어 있다」로 보고 둘 다 락을 잡았다고 믿었다.

| 함수 | 시그니처 | 하는 일 |
| --- | --- | --- |
| `beds24_try_lock` | `(p_name text, p_locked_by text, p_ttl_ms integer, p_lock_id text) returns boolean` | `insert … on conflict (name) do update … where l.expires_at <= now()` — 만료된 행만 덮어쓴다. 시각은 전부 DB `now()` |
| `beds24_release_lock` | `(p_name text, p_lock_id text) returns boolean` | 그 `lock_id`(metadata 안)일 때만 `expires_at = now()` 로 만료시킨다. 지우지 않는다 — 진단에 쓸모 있다 |

둘 다 `language sql`, `SECURITY INVOKER`(정의자 권한이 필요 없다 — 호출자가 이미 service_role). **호출자는
service_role 뿐이다**: `revoke all … from public, anon, authenticated` 후 `grant execute … to service_role`.
호출부: `src/lib/beds24/sync-locks.ts` → `acquireBeds24Lock`/`releaseBeds24Lock`. 워커의 심장 박동
(`touchWorkerLock`)과 고아 잠금 회수(`breakOrphanedWorkerLock`)도 `beds24_release_lock` 을 그대로 쓴다.

## 2026-09-30 `upsert_room_daily_rates_if_newer` — 요금 동기화가 더 새 값을 못 덮게

마이그레이션: `supabase/migrations/202609300002_room_daily_rates_upsert_if_newer.sql` (운영 적용 2026-09-30).
대상 테이블: `room_daily_rates`(`202609170002_room_daily_rates.sql`). 계약:
`docs/product/33-calendar-write-features.md` → 「요금 upsert 가 DB 에서 한 번 더 「더 새 값」을 지킨다」.

`upsert_room_daily_rates_if_newer(p_rows jsonb) returns table (written_room_id uuid, written_stay_date date)`
— `p_rows` 는 `(organization_id, room_id, stay_date, price1, price2, price3, min_stay, max_stay, num_avail,
override_kind, synced_at)` 레코드 배열(jsonb). `on conflict (room_id, stay_date) do update … where
r.synced_at < excluded.synced_at and r.organization_id = excluded.organization_id` — 기존 행의
`synced_at` 이 이번 값보다 **크면**(그 사이 다른 쓰기가 더 나중에 반영됐으면) 그 칸은 건너뛴다. **실제로
쓴 `(room_id, stay_date)` 만 반환**한다 — 호출부가 건너뛴 칸을 「Beds24 가 바꿨다」로 잘못 남기지 않게.

호출자는 service_role 뿐(`revoke … from public, anon, authenticated` / `grant execute … to service_role`).
`language sql`, `SECURITY INVOKER`. 호출부: `src/lib/beds24/room-rates-sync.ts`(요금 동기화) ·
`src/lib/beds24/price-job-worker.ts` 의 `patchLocalRates`/`refreshLinkedLocalRates`(가격 작업 워커가 검증
통과 값을 즉시 로컬에 반영할 때)는 일반 `upsert()` 를 쓰되 자기 쓰기 시각을 `synced_at` 으로 찍어 같은
규약을 지킨다.

## 2026-09-30 `beds24_deferred_refreshes` · Beds24 틱 함수 — 쿨다운이 풀리면 이어받기

마이그레이션: `supabase/migrations/202609300003_beds24_deferred_refreshes.sql`,
`supabase/migrations/202609300004_beds24_tick_cron.sql` (**운영 미적용** — 리드 검토 후 적용).
계약: `docs/product/33-calendar-write-features.md` → 「쿨다운이 풀리면 1분 안에 이어서 보낸다 · 미뤄 둔 웹훅 재조회」.

### `public.beds24_deferred_refreshes` — 미뤄 둔 건물 재조회

가격·재고 웹훅이 쿨다운·가격 작업 대기 때문에 물러났거나, 읽다가 실패했을 때 「이 건물은 다시 읽어야
한다」를 남긴다. **건물당 한 줄.**

| 컬럼 | 타입 | 비고 |
| --- | --- | --- |
| `external_property_id` | `text` PK | Beds24 propId |
| `organization_id` | `uuid` not null → `organizations(id)` on delete cascade | 재조회를 어느 조직으로 돌릴지 |
| `reason` | `text` not null, check `cooldown` · `price_job` · `failed` | 마지막으로 남은 이유 |
| `requested_at` | `timestamptz` not null default `now()` | 가장 최근 요청 시각. 읽기 **시작 시각 이하**일 때만 지운다 |
| `attempts` | `integer` not null default 0 | 틱의 실패 횟수. 5 이상이면 틱이 더 안 부른다. 새 웹훅이 0 으로 되돌린다 |
| `last_error` | `text` null | `room-rates:*` 실패 코드만(토큰·본문 없음) |
| `updated_at` | `timestamptz` not null default `now()` | |

인덱스: `(requested_at)` — 틱이 오래된 것부터 집는다. 쓰는 곳: `src/lib/beds24/price-webhook.ts`
`refreshBeds24Property`(upsert · 성공 시 delete), `src/app/api/beds24/tick/route.ts`(attempts 증가).

### 함수

| 함수 | 시그니처 | 하는 일 |
| --- | --- | --- |
| `beds24_tick_token_ok` | `(p_token text) returns boolean` | Vault `beds24_tick_token` 과 SHA-256 다이제스트끼리 비교. 값은 돌려주지 않는다. 32자 미만은 거부 |
| `beds24_tick_if_needed` | `() returns text` | 쿨다운(`beds24_sync_locks.api_cooldown`) · 틱 락(`beds24_tick`) · 대기 작업(`queued` 또는 15분 넘은 `processing`) · 재시도 한도 안의 미뤄 둔 재조회를 보고, 필요할 때만 `net.http_post` 로 `/api/beds24/tick` 호출. 반환 `cooldown`·`busy`·`idle`·`not_configured`·`fired` 가 `cron.job_run_details` 에 남는다 |

둘 다 `SECURITY DEFINER` · `search_path = ''` (Vault 를 읽어야 해서). `revoke all … from public, anon,
authenticated` + `grant execute … to service_role`. `auth.uid()` 판정 헬퍼가 아니다 — 호출자는 pg_cron
(postgres)과 틱 라우트(service_role)뿐이다.

pg_cron 잡 `beds24-tick` (`* * * * *`) → `select public.beds24_tick_if_needed()`. 확장: `pg_net`(이
마이그레이션에서 활성화), `pg_cron`·`supabase_vault`·`pgcrypto`(기존). Vault 시크릿 `beds24_tick_token`
(SQL 안에서 난수 생성) · `beds24_tick_url`. 판단 조건은 `src/lib/beds24/tick-plan.ts` `decideBeds24Tick`
과 같게 유지한다(`src/lib/__tests__/beds24-tick-plan.test.ts` 가 이름·한도 일치를 검사).

## 2026-10-01 `beds24_block_logs` 차단 사유 컬럼

- `purpose text` — `repair` · `cleaning` · `owner` · `other` 중 하나 또는 null(체크 제약). 차단을 **걸 때만**.
- `memo text` — 200자 이하(체크 제약).
- 기존 `reason` 은 전송 실패 코드 그대로. 마이그레이션 `202610010001_block_log_purpose.sql`. 화면 계약은
  `docs/product/33-calendar-write-features.md` → 「차단 사유」.
- `beds24_price_jobs.adjust_mode` 에 `revert`(수정 되돌리기)가 생겼다 — 제약 없는 text 라 스키마 변경 없음.

## 2026-10-02 `room_listing_links` 룸 링크

유닛(`rooms`) 하나 × 채널(`airbnb` / `booking`) 하나의 리스팅 링크. 마이그레이션 `202610020001_room_listing_links.sql`,
이관 데이터 `202610020002_room_listing_links_seed.sql`(저쪽 Firestore `roomLinks` → Airbnb 90줄).

- `id uuid pk` · `organization_id → organizations` · `room_id → rooms (on delete cascade)` · `channel text`(`airbnb`/`booking` 체크).
- `listing_id text` — Airbnb 리스팅 ID(링크에서 읽음). `host_url` · `guest_url text`. `memo text`(200자 체크).
- `updated_by → auth.users` · `created_at` · `updated_at`.
- 유일: `(room_id, channel)`. 인덱스: 조직 · 리스팅 ID.
- 쓰기는 서버 액션 `saveRoomListingLink`(service-role, 조직 · 권한 재검증)만. 화면 계약은 `docs/product/35-room-links.md`.
- `202610020003` 부터 `channel` 은 `airbnb` 만 — Booking.com 은 건물 단위라 아래 표로 옮겼다.

### `building_listing_links` (2026-10-02, `202610020003`)

건물 하나 × 채널(`booking`) 하나의 링크. Booking.com 은 숙소(건물) 단위로 엑스트라넷 · 손님용 페이지가 하나다.

- `id` · `organization_id → organizations` · `canonical_name text`(캘린더 · 건물 정보와 같은 건물 이름) · `channel`(`booking` 체크).
- `listing_id`(숙소 ID `hotel_id`) · `host_url`(엑스트라넷) · `guest_url`(손님용 페이지) · `memo`(200자) · `updated_by` · 시각들.
- 유일: `(organization_id, canonical_name, channel)`. 쓰기는 서버 액션 `saveBuildingListingLink` 만.

### 2026-10-15 룸 링크 직접 추가 — `room_link_buildings` · `room_link_rooms` (`202610150002`)

Beds24 에 없는 건물 · 객실을 룸 링크에서만 만든다. 캘린더 · 청소 · 가동률 · 매출은 이 표를 읽지 않는다(`properties` / `rooms` 에 넣지 않음).
화면 계약: `docs/product/35-room-links.md` → 「건물 · 객실 직접 추가」.

- `room_link_buildings`: `id` · `organization_id → organizations` · `name`(1~40자 체크) · `sort_order int`(기본 0, 새 건물은 최댓값+1) ·
  `created_by → auth.users` · `created_at` · `updated_at`. 유일 `(organization_id, name)`. Beds24 건물 이름과의 겹침은 서버 액션이 막는다.
- `room_link_rooms`: `id` · `organization_id` · `manual_building_id → room_link_buildings (on delete cascade)` · `canonical_name text`(Beds24 건물
  이름) — **정확히 하나**(체크 `room_link_rooms_one_building`) · `name`(1~40자) · `created_by` · 시각들. 유일(부분 인덱스):
  `(manual_building_id, name)` / `(organization_id, canonical_name, name)`.
- `room_listing_links.manual_room_id → room_link_rooms (on delete cascade)` 추가, `room_id` 는 null 허용으로 — 체크 `room_listing_links_one_room`
  (`num_nonnulls(room_id, manual_room_id) = 1`), 유일 `(manual_room_id, channel)`(upsert 용 제약, 기존 `(room_id, channel)` 유지).
- `building_listing_links.manual_building_id → room_link_buildings (on delete cascade)` 추가, `canonical_name` 은 null 허용으로 — 체크
  `building_listing_links_one_building`, 유일 `(manual_building_id, channel)`. 이름이 아니라 id 로 붙여 건물 이름을 바꿔도 링크가 따라간다.
- 직접 추가한 건물을 지우면 그 객실 → 링크까지 연쇄로 지워진다(hard delete). 쓰기는 서버 액션(service-role)만.

## 2026-10-05 근태 마감 유일 인덱스 · 수기 예약 멱등 키

- `attendance_month_snapshots_one_finalized` — `(organization_id, user_id, target_month) where status = 'finalized'` 부분 유일
  인덱스(`202610050001`). 사람 · 달마다 마감본 하나. `docs/product/21-attendance-payroll-workflow.md`.
- `ops_manual_booking_requests` (`202610050002`) — 수기 예약 요청 키. `(organization_id, request_key)` PK, `booking_id` ·
  `reservation_id`(만든 뒤 채움) · `created_by` · `created_at`. service-role 전용(RLS 켜고 정책 없음).
  `docs/product/33-calendar-write-features.md` → 「서버 검증 보강」.

## 2026-10-06 자동화 관제실 — `automation_*` · `cleaning_list_assignees`

마이그레이션 `202610060003_automation_control.sql`(운영 적용). 계약: `docs/product/36-automation-control.md`.

| 표 | 한 줄 | 주요 컬럼 |
| --- | --- | --- |
| `automation_jobs` | 조직 × 자동화(`daily_report` · `cleaning_list` · `cancel_alert` · `same_day_alert` · `failure_alert`) | `enabled`(발송 토글) · `send_time` · `retry_until`(time, 도쿄) · `weekdays smallint[]`(ISO) · `settings jsonb`(제외 건물 · 채널 · 변동 재전송) · `next_wake_at` · `last_done_on` · `event_cursor` · 유일 (organization_id, job_key). 줄이 없으면 꺼짐 |
| `automation_destinations` | 자동화 × Slack 채널 키 | `channel_key`(`^[A-Z0-9_]{1,40}$`) · `locales text[]`(ko/ja/en, 1개 이상) — 언어마다 한 통 |
| `automation_runs` | 받는 곳 × 언어 × 실행 한 번 | `trigger`(scheduled/retry/manual/event/correction/resend) · `status`(sent/skipped/failed) · `reason` · `message` · `meta jsonb`(숫자 4개 · 이름 · 정정 지문) · `dedupe_key`(유일, 부분 인덱스) |
| `automation_setting_logs` | 설정 변경 한 번 | `changes jsonb` {필드: {before, after}} · `actor_id` |
| `cleaning_list_assignees` | 날짜 × 운영 객실 키 | `names`(1~120자) — 청소 명단 담당자 수기 입력(Hotelsmart 수집 안 함) |
| `reservations.last_known_amount` (2026-10-07, `202610070003`) | 예약 × 1 | 마지막으로 0 보다 컸던 `raw_payload.price`. 트리거 `reservations_keep_last_known_amount`(before insert/update)가 채운다 — 취소로 price 가 0 이 돼도 남아 취소 금액 표시에 쓴다. Beds24 동기화 코드는 이 컬럼을 쓰지 않는다 |
| `automation_jobs.enabled_at` (2026-10-07, `202610070002`) | 자동화 × 1 | 마지막으로 켠 시각(꺼짐 → 켜짐 때 서버 액션이 적음). 취소 · 당일예약 알림은 이 뒤의 취소 · 예약만 보낸다 |
| `cleaning_list_extra_rooms` (2026-10-07, `202610070001`) | 날짜(`target_date`) × 물리 객실 키 | `property_name` · `room_label` · `note`(1~60자, 선택) · `created_by` — 청소 명단에 사람이 직접 더한 청소 방(퇴실 없는 연박 청소 등, Hotelsmart 대신) |

- `reservations (organization_id, updated_at)` 인덱스 추가 — 이벤트형 자동화가 매 분 커서 뒤 변경을 본다.
- 함수 `automation_tick_if_needed()` · `automation_tick_token_ok()`, pg_cron `automation-tick`.

## 2026-10-06 `board_reports` · `user_blocks` — 게시판 신고 · 차단

마이그레이션 `202610060001_board_reports_user_blocks.sql` (원격 적용 2026-10-06, MCP). 둘 다 **RLS 켜고 정책 없음 — service-role 전용**
(서버 액션 · `src/lib/board-moderation.ts` 만 읽고 쓴다). 기능: `docs/product/23-board-workflow.md` §12-C.

`board_reports`: `id` · `organization_id` · `reporter_user_id` · `target_type`(`post` | `comment`) · `post_id`(댓글 신고면 댓글이 속한 글) ·
`comment_id`(댓글 신고만) · `target_author_user_id`(신고 당시 작성자) · `reason`(`spam` | `harassment` | `inappropriate` | `privacy` | `other`) ·
`note`(≤ 500) · `status`(`pending` | `removed` | `dismissed` | `withdrawn` — 신고자가 취소, `202610060002` 에서 추가) · `resolved_by_user_id` · `resolved_at` · `created_at`.
같은 신고자의 같은 대상 중복 금지(부분 유니크 인덱스 2개), 대기 목록 인덱스. 글 · 댓글이 하드 삭제되면 cascade.

`user_blocks`: PK (`organization_id`, `blocker_user_id`, `blocked_user_id`), `created_at`, 자기 자신 차단 금지 CHECK.

## 2026-10-08 `ops_stats_months` · `ops_room_month_stats` — 객실 × 월 집계 표

마이그레이션 `202610080002`. 매출 · 가동률 · 비교 화면이 예약을 매번 다시 읽지 않게 객실 행 × 달로 미리 계산해 둔다(도메인 규칙:
`docs/product/34-metrics-and-automation.md` 「객실 × 월 집계 표」).

`ops_room_month_stats`: PK (`organization_id`, `month` = 그 달 1일, `room_key` = 판매 캘린더 객실 행 키), `property_name` · `room_label` ·
`in_catalog`, `revenue` · `commission` · `occupied_nights` · `available_nights`(방 × 일수, 목록 방만 — 「문 열기 전」 규칙은 읽는 쪽) ·
`airbnb` · `booking` · `direct` · `other`(채널 몫), `first_check_in`(그 달 체크인한 확정 예약 중 가장 이른 날).

`ops_stats_months`: PK (`organization_id`, `month`), `version`(앱 `OPS_STATS_VERSION`), `dirty` · `dirty_at`, `built_at`. 트리거가 dirty 를 적는다 —
`reservations` 행의 전 · 후 날짜의 달(`ops_stats_mark_reservation`, 관련 칸이 실제로 바뀔 때만), `rooms` 의 목록 판정 칸 변경 · 추가 · 삭제와
`properties.name` 변경은 조직 전체(`ops_stats_mark_room` · `ops_stats_mark_property`).

## 2026-10-20 `task_report_schedules` — 업무일지 예약 보내기

`organization_id` · `user_id`(profiles) · `report_date`(도쿄 날짜) · `body`(예약 순간의 본문, 1~40,000자) · `send_at` · `status`(scheduled → sending → sent | failed, cancelled) ·
`error`(이유 코드만) · `claimed_at` · `sent_at`. 부분 유니크 `(user_id, report_date) where status in ('scheduled','sending')`, 보낼 것 찾기 부분 인덱스 `(send_at) where status = 'scheduled'`.
RLS: 본인 읽기만, 쓰기는 서버. 함수 `claim_due_task_report_schedules` · `task_report_tick_if_needed` · `task_report_tick_token_ok`(service role 만). 마이그레이션 `202610200005`.
상세 `docs/product/18-todo-task-workflow.md` 「업무일지 예약 보내기」.

