# Implementation Plan

## Purpose

This document defines the practical development order for Foldy MVP.

It should be followed by Codex, Claude, Cursor, and any other AI or human contributor.

## Principle

Build the product in small vertical slices.

Do not build every database table or every UI screen before testing real workflows.

Recommended rhythm:

```txt
Design small slice
Build small slice
Test
Update docs
Continue
```

## Phase 0: Planning and Design Preparation

Status: Completed for initial MVP build start

Goals:

- Finalize MVP scope
- Keep decision log updated
- Create Stitch designs for core screens
- Review data model and permissions

Core Stitch screens:

- Login/signup
- Mobile home
- Cleaning timer
- Requests tab
- Reservation calendar
- Announcements
- Admin dashboard

Deliverables:

- Updated docs
- Stitch screenshots or Figma frames
- Confirmed first implementation slice

## Phase 1: Project Setup

Status: Completed

Goals:

- Create Next.js App Router project
- Add TypeScript
- Add Tailwind CSS v4
- Add shadcn/ui
- Add lint/format setup
- Add basic folder structure
- Add environment variable structure

Deliverables:

- Running local app
- Basic PWA shell
- Initial README setup commands

Current implementation notes:

- Next.js App Router + TypeScript project created at the repository root.
- Tailwind CSS v4 and ESLint are configured.
- PWA manifest and `.env.example` are present.
- Local app runs at `http://127.0.0.1:3000`.
- `npm run lint` and `npm run build` pass.

## Phase 2: i18n and Theme Foundation

Status: Completed

Goals:

- Add Korean/Japanese/English i18n structure
- No hardcoded visible UI strings
- ~~Add theme preference: System/Light/Dark~~ (Removed 2026-06-08: light mode only; dark mode deferred post-launch)
- Add Liquid Glass readable design tokens
- Add base layout components

Deliverables:

- Language switch/test
- Light mode working (dark mode removed 2026-06-08; deferred post-launch)
- Base button/input/dialog/card patterns

Current implementation notes:

- Korean/Japanese/English dictionary structure is implemented in `src/lib/i18n.ts`.
- Admin shell, mobile shell, login, onboarding, role labels, and development entry copy now read visible text from localization dictionaries instead of component-local UI strings.
- Korean is the default fallback locale.
- Authenticated app screens use `profiles.preferred_language` from the Supabase profile when selecting copy.
- Language selection is stored in local storage for the foundation preview.
- ~~System/Light/Dark theme selection is implemented with document-level theme state.~~ Removed 2026-06-08: the app is light-mode-only; theme state, toggle UI, and `dark:` styling were deleted. Dark mode deferred until post-launch.
- Initial Liquid Glass design tokens are defined in global CSS.
- Base `Button`, `Card`, `Badge`, `Input`, and `Separator` components are present.
- Role, navigation, and route access configuration has started in `src/config`.
- Input, dialog/sheet, form, and feature-specific layout components still need to be expanded.
- A stricter no-hardcoded-visible-text check was added on 2026-06-08 (see "i18n Hardcoded-String Guard" below).

### i18n Hardcoded-String Guard (2026-06-08)

- Enforcement is a Vitest test: `src/lib/__tests__/no-hardcoded-i18n.test.ts`. It runs as part of `npm test` and can be run alone via `npm run check:i18n`.
- It scans `src/app` and `src/components` (`.ts` / `.tsx`) for hardcoded Korean / Japanese / Kanji (CJK) literals. A raw CJK literal in JSX/TSX is almost always UI copy that bypassed `src/lib/i18n.ts`, so this gives a high-signal, near-zero-false-positive check.
- English is intentionally not scanned: hardcoded English is indistinguishable from class names, `aria-*` values, route segments, DB field names, and technical defaults, so a CJK-only scan avoids the noise the Phase 2 note warned about. English copy continues to rely on code review plus the dictionary-first convention.
- Ignored automatically: comments (line / block / JSX) and complete `LocalizedText` literals (a line carrying `ko:`, `ja:`, and `en:` together), which are fully localized data rather than single-language hardcoded copy.
- Escape hatches (use with a justifying comment): `i18n-ignore` (single line), `i18n-ignore-start` / `i18n-ignore-end` (block), `i18n-ignore-file` (whole file). Each directive is recognized **only when written inside a comment** — line (`//`), block (`/* */`), or JSX (`{/* */}`). The same text in a string literal or ordinary code does not suppress scanning. Canonical building-name domain constants in the calendar/cleaning pages are wrapped with block directives because they are normalization keys, not translatable copy.
- The directive parser is covered by its own unit tests in the same file (`scanSource`): line/block/JSX directive recognition, non-comment contexts not suppressing scanning, the `i18n-ignore` family, `LocalizedText` exemption, and accurate line-number reporting are all asserted, so the guard's own reliability is regression-protected.
- Handling a true positive: move the string into `src/lib/i18n.ts` (ko/ja/en together) and read it from the dictionary. During this task two real fallbacks (`"건물 정보 없음"`, `"룸 정보 없음"`) in the cleaning linked forms were migrated to `lostFound.form` / `maintenance.form` (`noBuildingInfo` / `noRoomInfo`).
- Scope/limits: this catches the most common regression (a hardcoded ko/ja label) but does not detect hardcoded English or strings built dynamically. It reduces — not fully eliminates — the manual-review burden.

## Phase 3: Supabase Foundation

Status: Completed for foundation

Goals:

- Create Supabase project
- Add initial schema migrations
- Add generated TypeScript types
- Add RLS helper functions
- Add local environment documentation

Core tables:

- organizations
- profiles
- platform_admins
- memberships
- invite_codes
- audit_logs

Deliverables:

- Supabase connected
- Auth user profile creation flow
- Basic RLS policies

Current implementation notes:

- Supabase packages are installed: `@supabase/supabase-js` and `@supabase/ssr`.
- Build-safe lazy client helpers are present:
  - `src/lib/supabase/browser.ts`
  - `src/lib/supabase/server.ts`
  - `src/lib/supabase/service.ts`
- Environment variable validation is present in `src/lib/env.ts`.
- Initial TypeScript database shape is present in `src/types/database.ts`.
- Initial foundation migration is present at `supabase/migrations/202605090001_initial_foundation.sql`.
- The migration currently covers organizations, profiles, memberships, invite codes, platform admins, audit logs, enum types, timestamps, indexes, RLS helper functions, and starter policies.
- The Supabase project has been created in the Tokyo region.
- `.env.local` has been created locally.
- The anon key and service role key are configured locally.
- `202605090001_initial_foundation.sql` has been applied to the remote Supabase project.
- `202605090002_api_grants.sql` has been applied to the remote Supabase project.
- Core foundation tables are available in the remote database.

## Phase 4: Auth, Organization, and Invite Flow

Status: Completed (2026-06-03 — includes Google OAuth, logout, membership state access control, phone validation)

Goals:

- Email login
- Google login
- Signup profile completion
- Language selection during signup
- Super Admin organization creation
- Invite code validation
- Membership creation

Deliverables:

- User can join organization through invite code
- Super Admin can create organization
- Role-based post-login routing

Current implementation notes:

- Email magic-link login and Google OAuth are both live on `/auth/login`.
- Google OAuth uses `supabase.auth.signInWithOAuth({ provider: "google", options: { prompt: "select_account" } })`.
- Google login is authentication only. Google profile data (name, phone) is NOT auto-prefilled. Users must complete all required fields manually.
- Supabase auth callback route is present at `/auth/callback`; handles both magic-link and OAuth code exchange.
- Logout is implemented via `signOut` server action in `src/app/auth/actions.ts`; clears session and redirects to `/auth/login`. Accessible from `/account`.
- `getOnboardingState()` returns one of: `unauthenticated`, `needs_profile`, `needs_membership`, `suspended`, `removed`, `ready`.
- `suspended` and `removed` membership states show a blocked screen with a clear message and logout button. These users cannot enter the app.
- Phone number is validated at onboarding and account editing using `isValidPhone()` in `src/lib/onboarding.ts` (7-15 digits, allows +, spaces, hyphens, parentheses).
- Invite code error handling is specific: `invite_expired`, `invite_inactive`, `invite_maxed`, `invalid_invite`, `membership_failed`.
- Onboarding route at `/onboarding` requires profile completion and invite code before granting app access. Both steps are mandatory for all users.
- The first setup user can claim `developer_super_admin` only while no platform admin exists.
- `/admin/settings/organization` lets Developer / Super Admin create organizations.
- `/admin/users/invites` lets developers and `manage_users` delegates create, list, and deactivate
  invite codes (moved from `/admin/settings/invite-codes` 2026-07-13; old path redirects there).
- `/admin/users` displays member directory with search/filter and role/status update actions.
- `/admin/users/[id]` provides member detail view with role and status management.

## Phase 5: App Shells

Status: Substantially complete

Goals:

- Mobile PWA bottom tabs
- Admin web sidebar
- Role-based routing
- Mode switching for admin-capable roles

Mobile tabs:

- Home
- Calendar
- Cleaning
- Requests
- Announcements

Admin sidebar:

- Dashboard
- Calendar
- Check-In/Out
- Cleaning
- Maintenance
- Lost & Found
- Orders
- Announcements
- Recurring Work
- Users
- Settings

Deliverables:

- Navigation works by role
- Mobile/admin layouts are responsive

Current implementation notes:

- Mobile navigation contract is defined in `src/config/navigation.ts`.
- Admin sidebar contract is defined in `src/config/navigation.ts`.
- Role constants and initial access helpers are defined in `src/config/roles.ts`.
- Initial route access metadata is defined in `src/config/routes.ts`.
- Mock session shape is defined in `src/lib/session.ts`.
- Temporary `SessionProvider` is implemented in `src/components/providers/session-provider.tsx`.
- Initial mobile shell is available at `/mobile`.
- Initial admin shell is available at `/admin`.
- Development entry page is available at `/`.
- The session provider is now backed by server-loaded Supabase session data.
- Temporary mock session data remains only as a development reference in `src/lib/session.ts`.
- **Global mobile shell unified (current contract):** `MobileShell` owns the shared mobile chrome: three-line hamburger with a shorter middle line, centered `Foldy` wordmark, notification bell, profile link, scroll-aware top chrome, full-screen slide-in side menu, and a bottom-attached ivory tab bar with a raised center squircle FAB. The canvas/chrome is warm ivory, cards/sheets use cream-white surfaces, and the accent is deep navy. `title` drives `<main aria-label>` only. Future mobile pages must not override the shell structure without an explicit architectural decision.

## Phase 6: User Profile and Directory

Status: Completed (age and profile_photo deferred to post-MVP)

Goals:

- My Profile
- Edit name, phone, language (`age`, `photo`, and theme editing deferred/removed in current MVP surface)
- User directory
- Phone call button
- User search/filter

Deliverables:

- Users can manage own profile
- Members can view organization directory
- Phone call action works on mobile

Current implementation notes:

- `/account` is implemented as the My Profile screen.
- Users can update `name`, `phone_number`, and `preferred_language`. (Theme editing was removed 2026-06-08; the app is light-mode-only. The `profiles.theme_preference` column remains in schema only and is not read or written by the app.)
- The account icon in both admin/mobile shells routes to the profile screen.
- `/mobile/directory` is implemented as the staff directory tab in the mobile shell.
- Directory shows all active/invited org members sorted by role, then name.
- Each member card shows name, role, optional phone number, and a phone call button (`tel:` link) when a phone number is present.
- `/admin/users/[id]` is implemented as the admin-side member detail page.
- Admin can view profile, email, role, status, and joined date; can update role and membership status.
- `age` and `profile_photo` remain deferred to post-MVP.

## Phase 7: Cleaning Workflow

Status: Substantially complete (all done criteria met)

Goals:

- Today's check-out selection placeholder or connected data if ready
- Search property/room
- Start cleaning
- Active timer
- Complete confirmation popup
- Optional notes
- Today's my activity records

Deliverables:

- Staff can start/complete cleaning
- Duration is recorded
- Admin can view cleaning status

Entry criteria (all must be true before starting Phase 7):

- `npm run lint` and `npm run build` pass.
- Announcement security QA checklist deferred items are documented.
- No open P1/P2 issues in announcement or auth flows.

Done criteria (all met as of 2026-05-21):

- [x] Staff can start, run, and complete a cleaning session from the mobile app.
- [x] Cleaning duration is recorded in the database.
- [x] Admin can view cleaning status per room and date.
- [x] All visible strings go through i18n dictionaries (ko/ja/en).
- [x] Server actions validate all inputs; DB mutations use RLS.
- [x] `npm run lint` and `npm run build` pass.
- [x] `docs/planning/06-current-status.md` and `docs/engineering/06-implementation-plan.md` updated.

Current implementation notes:

- First vertical slice added `public.cleaning_sessions` in `supabase/migrations/202605210001_cleaning_sessions.sql`.
- `cleaning_sessions` stores organization, staff user, room label, task label/key, status, cleaning date, started/completed timestamps, duration seconds, optional notes, and timestamps.
- Cleaning date handling uses a defined UTC+9 local operating date (`Asia/Seoul`, matching Korea/Japan operating date) instead of raw UTC ISO slicing. The app sets `cleaning_date` explicitly on start, mobile/admin "today" queries use the same helper, and corrective migration `202605210002_correct_cleaning_operating_date_and_active_index.sql` updates the DB default.
- `owner` is now treated as a permanent hybrid role for mobile field operations, so the mobile cleaning page guard and matching RLS policies allow owners alongside normal field roles. `developer_super_admin` continues to bypass for support/debugging, but the broader admin-web QA allowance has been removed.
- RLS allows field roles (`field_manager`, `staff`, `part_time_staff`) to start their own sessions, staff to complete their own active sessions, and admin/manager roles to read operational status. A corrective migration scopes the active-session unique index to `(organization_id, staff_user_id)` so multi-organization users are only limited per organization.
- `/mobile/cleaning` is implemented as the first staff workflow: choose a room and one of three task options (Checkout Cleaning, Simple Cleaning, Long-stay Cleaning), start cleaning, see an active timer, enter an optional note, review room/task/start time/elapsed time in a confirmation step, complete, and review today's completed sessions.
- `/admin/cleaning` is implemented as a first operational status view for the current organization/date, showing room, task, staff, state, start time, and duration.
- This slice intentionally does not connect Beds24 checkout data, room master data, search, overdue notifications, exports, or photo upload yet. The completion confirmation step is UI-only safety around the existing completion server action and does not change role/RLS or persistence semantics.
- `CleaningCompletionPanel` confirmation modal now renders the entered note as a read-only `whitespace-pre-wrap` block below the room/task/time summary; the block renders only when `notes.trim()` is non-empty, so no new i18n key is required. Line breaks are preserved.
- **Second vertical slice: active-cleaning linked workflows (2026-05-21)**:
  - `lost_items` table added (`202605210006_lost_items.sql`): stores organization, cleaning session FK (nullable ON DELETE SET NULL), reporter, room label, item name, found timestamp, memo, and `lost_item_status` enum (registered/stored/disposal_scheduled/disposed). RLS: any active org member can create own records; reporters or manager-capable roles (owner/office_admin/cs_staff/field_manager) can update/delete; platform admins bypass.
  - `maintenance_reports` table added (`202605210007_maintenance_reports.sql`): stores organization, cleaning session FK (nullable ON DELETE SET NULL), reporter, room label, issue title, description, and `maintenance_status` enum (open/in_progress/resolved/closed). Same RLS pattern as lost_items.
  - `/mobile/lost-found/new`: RSC form page. Reads `?sessionId=` param, validates the session server-side (same user, same org, no status filter), prefills room. Form: room (editable select), item name (required), memo (optional). Server action `createLostItem` re-validates the session link, validates room/item, inserts to `lost_items`, redirects to `/mobile/requests/lost-found/{id}?created=1` using the just-created record's ID. Fallback on ID resolution failure is `/mobile/requests`.
  - `/mobile/maintenance/new`: same pattern. Form: room, issue title (required), description (optional). Server action `createMaintenanceReport` redirects to `/mobile/requests/maintenance/{id}?created=1`.
  - `/mobile/cleaning` active-session card now shows a "Report from active cleaning" shortcut strip with "Report Lost Item" and "Report Issue" links, each passing `?sessionId=<activeSession.id>` for server-side context handoff.
  - TypeScript types for `lost_items`, `maintenance_reports`, `lost_item_status`, `maintenance_status` added to `src/types/database.ts`.
  - i18n: `lostFound` and `maintenance` dictionary sections added (ko/ja/en); cleaning dictionary extended with `lostReported`, `maintenanceReported`, `quickActions`, `reportLostItem`, `reportMaintenance`.
- **Context-integrity fix for linked workflows (2026-05-21)**:
  - Invalid or stale `?sessionId=` now shows an explicit error state on both `/mobile/lost-found/new` and `/mobile/maintenance/new` instead of silently falling back to standalone mode. The form is not rendered at all when `isLinkedMode && !linkedSessionValid`; only the error message and a back-to-cleaning button are shown.
  - Login redirect now preserves `?sessionId=` in the `next` param: `?next=%2Fmobile%2Flost-found%2Fnew%3FsessionId%3D...` so cleaning context survives session expiry.
  - Server actions (`createLostItem`, `createMaintenanceReport`) now extract `rawCleaningSessionId` before the session check so the auth redirect can include the session ID. If DB session validation fails after login, the action redirects with `error=invalid_session&sessionId=...` instead of silently saving the record without the link.
  - Status filter (`.eq("status", "in_progress")`) removed from page-level session validation; both pages and both actions now accept any session belonging to this user/org so the link survives when the user completes cleaning before submitting the form.
  - `invalid_session` error string added to `lostFound.errors` and `maintenance.errors` in all three locales.
- **Linked-form client-side validation (2026-05-21)**:
  - `CleaningLinkedConfirmationSheet` accepts an optional `onBeforeOpen?: () => boolean` prop; if it returns `false`, the sheet does not open.
  - `LostFoundLinkedForm` validates `itemName.trim()` in `onBeforeOpen` and shows an inline error below the input (`copy.errors.missing_item_name`) if empty. Error clears when the field changes.
  - `MaintenanceLinkedForm` validates `issueTitle.trim()` identically (`copy.errors.missing_issue_title`).
  - Hardcoded `"-"` fallback removed from `summaryFields` in both linked forms; required values are guaranteed non-empty before the sheet opens.
  - No new i18n keys added; existing `missing_item_name` / `missing_issue_title` strings serve both server-redirect and inline client validation roles.
- **Lost item and maintenance list/status management (2026-05-21)**:
  - `src/lib/lost-found.ts`: `getOrgLostItems`, `getLostItemById`, `getMyLostItems`: join reporter names from profiles; org-scoped; recent-first.
  - `src/lib/maintenance-reports.ts`: same pattern for maintenance.
  - `src/app/admin/lost-found/actions.ts`: `updateLostItemStatus` server action: `requireAdminSession`, UUID + enum validation, org-ownership check before UPDATE, `as never` cast for Supabase update type.
  - `src/app/admin/maintenance/actions.ts`: `updateMaintenanceStatus`: same pattern.
  - `/admin/lost-found`: org-scoped list, room/item/status/reporter/found-at columns, cleaning-session indicator tag, clickable rows to detail.
  - `/admin/lost-found/[id]`: detail card + status change form (dropdown + submit).
  - `/admin/maintenance` and `/admin/maintenance/[id]`: same pattern.
  - `/mobile/requests`: combined two-section view (lost items + maintenance), current user's own records only, status badges, cleaning-tag indicators, empty states.
  - `mobile.requestsTitle` added to i18n (ko/ja/en) for the page header.
  - `lostFound` and `maintenance` dictionary sections extended with: `adminTitle`, `adminDescription`, `backToList`, `changeStatus`, `detailTitle`, `foundAt`/`reportedAt`, `fromCleaningTag`, `mobileListTitle`, `noRecords`, `reporter`, `statusLabel`, `statusLabels` (typed map), `statusUpdated`, and three new error keys (`forbidden`, `not_found`, `status_update_failed`) in all three locales.
- **Mobile request detail + status tracking (2026-05-21)**:
  - `src/lib/lost-found.ts`: added `getMyLostItemById(session, id)`: fetches by `id + organization_id + reported_by_user_id`; returns `LostItemRow | null`; reporter-scoped (no reporter-name join needed since caller is always the reporter).
  - `src/lib/maintenance-reports.ts`: added `getMyMaintenanceReportById(session, id)`: same pattern.
  - `src/app/mobile/requests/lost-found/[id]/page.tsx` (new): RSC detail page. Guards: `getOnboardingState` + `getCurrentAppSession`; auth redirect preserves `/mobile/requests/lost-found/[id]` in `next` param. Fetches via `getMyLostItemById`; `notFound()` if null. Renders: back link, main card (cleaning-tag eyebrow if linked, icon + item name, status badge, dl with room + found_at, memo block if present), status-progress card (4-segment bar coloured by `lostItemStatuses.indexOf(item.status)`, step labels with active label highlighted). Uses existing `lostFound.detailTitle`, `backToList`, `fromCleaningTag`, `room`, `foundAt`, `memo`, `statusLabel`, `statusLabels` strings; no new i18n keys.
  - `src/app/mobile/requests/maintenance/[id]/page.tsx` (new): identical pattern for maintenance reports. Fields: issue_title (Wrench icon), room, created_at (reportedAt label), description block. Status statuses: `maintenanceStatuses` (open/in_progress/resolved/closed). No new i18n keys.
  - `src/app/mobile/requests/page.tsx` updated: each lost-item and maintenance card is now wrapped in a `<Link>` to its detail page. Hover state `hover:bg-accent/40` added to cards for tap affordance. Separator character middle dot styling was moved from `text-border` to an explicit muted decorative span with `aria-hidden="true"`, avoiding reliance on the border token for inline punctuation.
  - No schema changes, no RLS changes, no new i18n strings.
- **Mobile request filtering + post-create handoff (2026-05-21)**:
  - `src/components/requests/requests-filter-view.tsx` (new): `"use client"` component. Props: `lostItems: LostItemRow[]`, `maintenanceReports: MaintenanceReportRow[]`, `locale`, `filterLabels`, `lostFoundCopy`, `maintenanceCopy`. Manages `typeFilter` (`"all"|"lost-found"|"maintenance"`) and `statusFilter` (`"all"|"active"|"closed"`) with `useState`. Derives filtered arrays inline (no extra state). Active statuses: lost = `{registered, stored, disposal_scheduled}`; maintenance = `{open, in_progress}`. Types are imported via `import type` from `@/types/database` (pure type file - no server-only code). Status arrays and badge class maps defined inline. Renders `FilterPill` subcomponent for each option. Shows `noFilterResults` empty card when both visible arrays are empty.
  - `src/app/mobile/requests/page.tsx` simplified: now just fetches data and passes to `RequestsFilterView`; no in-page JSX for cards or status class maps.
  - `src/app/mobile/lost-found/new/actions.ts` updated: after successful insert, fetches the just-created record by `org_id + user_id`, order desc, limit 1 -> redirects to `/mobile/requests/lost-found/{id}?created=1`. Fallback on null is `/mobile/requests`. All existing validation and session-link logic unchanged.
  - `src/app/mobile/maintenance/new/actions.ts` updated: same pattern -> redirects to `/mobile/requests/maintenance/{id}?created=1`.
  - Both mobile detail pages accept `searchParams: Promise<{ created?: string }>`. When `created === "1"`, a primary-tinted success banner shows the localized `createdSuccess` string above the back link.
  - i18n: `mobile.filterAll/filterActive/filterClosed/filterLostFound/filterMaintenance/noFilterResults` added to type and all three locales; `lostFound.createdSuccess` and `maintenance.createdSuccess` added to type and all three locales (8 new type fields, 8 x 3 = 24 new locale strings).
  - Status badge color palette consistent across all surfaces: registered/open=blue, stored/in_progress=amber, disposal_scheduled=orange, resolved=green, disposed/closed=muted.
  - No schema changes; no new migrations; existing RLS preserved.
- **Linked confirmation + reservation suggestion guard (2026-05-21)**:
  - In cleaning-linked mode only, `/mobile/lost-found/new` and `/mobile/maintenance/new` now use a final confirmation sheet before submit; standalone mode remains direct-submit.
  - Confirmation UI shows room + report summary + report time + memo/description preview and still submits through existing server actions (`createLostItem`, `createMaintenanceReport`) so persistence semantics remain unchanged.
  - Guest/reservation suggestion block is explicitly shown in the confirmation step. Since reservation integration is not yet connected in this slice, the UI renders a clear "suggestion unavailable" message instead of generating synthetic values.
  - No permission model or RLS changes were introduced for this step.

## Phase 8: Requests

Status: **Substantially complete** (all three request types implemented; image attachment for order requests deferred)

Goals:

- Maintenance requests ✓
- Lost items ✓
- Order requests ✓
- Attachments table ✓ (lost items + maintenance; order requests deferred)
- Image compression ✓ (lost items + maintenance)
- All/My registrations views ✓
- Status permissions ✓
- Hard delete with confirmation (not yet implemented)

Deliverables:

- Users can create/view requests ✓
- Part-time Staff cannot change order request status ✓
- Order processing limited to office-level roles ✓ (server action + role gate)
- Timer-created maintenance/lost item records link correctly ✓
- Request image upload and detail rendering work for lost items and maintenance reports ✓

Current implementation notes:

- `supabase/migrations/202605210008_request_images.sql` adds `image_urls text[] not null default '{}'` to both `lost_items` and `maintenance_reports`, creates the public `request-images` Storage bucket (8 MB per file, JPEG/PNG/WebP/GIF only), and adds Storage RLS INSERT and DELETE policies. Path contract: `{orgId}/{requestType}/{requestId}/{filename}` (4-segment, both ID segments are UUIDs, requestType must be `lost-items` or `maintenance-reports`).
- `src/components/requests/request-image-upload.ts` is a client-side upload utility that maps `RequestImageType` to the bucket path and uploads each file. Returns `imageUrls[]` passed to the create server action via FormData.
- `AnnouncementImageUploader` component is reused in all 4 request form components (`LostFoundCreateForm`, `MaintenanceCreateForm`, `LostFoundLinkedForm`, `MaintenanceLinkedForm`); image labels are passed as required props from the page.
- `dictionary.requestImages` section added to `src/lib/i18n.ts` (ko/ja/en) with 7 keys: `addPhotos`, `attachments`, `errorCount`, `errorSize`, `errorType`, `limit`, `remove`. Pages pass these to form components so no visible UI strings are hardcoded.
- Both create server actions (`createLostItem`, `createMaintenanceReport`) validate each submitted image URL against the Supabase project hostname, the `request-images` bucket, and a 4-segment path before inserting the DB row. On any validation, permission, or DB failure, uploaded images are removed from Storage before redirecting.
- Mobile detail pages (`/mobile/requests/lost-found/[id]`, `/mobile/requests/maintenance/[id]`) display attached images via `AnnouncementImageGrid`.

**Order requests (implemented 2026-06-01):**

- `supabase/migrations/202606010001_order_requests.sql`: `order_requests` table + `order_request_status`/`order_request_urgency` enums + RLS + indexes.
- `supabase/migrations/202606010002_order_requests_delivery_date.sql`: `delivery_date date` column added.
- `/mobile/orders/new`: multi-item request creation form with building selector, per-item name/quantity/link/memo.
- `/mobile/requests/orders/[id]`: detail page with status badge, item list (per-item links), delivery date card, location/requester, timeline progress bar, action bar.
- Status transitions enforced server-side: `requested → approved → ordered` (delivery_date required) and any non-closed → `closed`. Direct `requested → ordered` is blocked.
- Role gate in `updateOrderRequestStatus`: only `adminWebRoles` (owner, office_admin, cs_staff, developer_super_admin) can change status.
- `delivery_date` captured in process-order modal; stored as `date` column; displayed in Asia/Tokyo timezone.
- Order requests appear in `/mobile/requests` list with type filter, status filter, and delivery date metadata.
- i18n complete (ko/ja/en) for all order-request-related UI strings.

## Phase 9: Announcements

Status: Substantially complete (property targeting deferred to Phase 10)

Goals:

- Create announcements
- Target everyone/property/role
- Important/pinned flags
- Popup on app open
- Read tracking
- Comments
- Up to 5 image attachments

Deliverables:

- Announcements show to targeted users
- Read tracking works
- Comments work

Current implementation notes:

- `supabase/migrations/202605100001_announcements.sql` adds `announcements`, `announcement_status`, and `announcement_target_scope`.
- `/admin/announcements` is implemented as the first admin announcement management screen.
- Admin-capable users can create draft or published announcements for manageable organizations.
- The first version supports everyone/role targeting, important, pinned, popup flag, comments flag, and status changes.
- Status updates support draft, published, and archived states.
- Allowed users can delete announcements from the admin announcement screen.
- Announcement deletion now uses a confirmation modal in the admin UI.
- Announcement cards now link to a read/detail view at `/admin/announcements/[id]`.
- Published popup-enabled announcements appear as a dismissible popup on the admin announcement screen.
- `/mobile/announcements` now shows the first read-only published announcement list for targeted users.
- `/mobile/announcements/[id]` now shows the first read-only mobile announcement detail view.
- Published popup-enabled announcements also appear as a dismissible popup on the mobile announcement list screen.
- `supabase/migrations/202605100002_announcement_reads.sql` adds persistent read confirmations.
- `supabase/migrations/202605100003_announcement_images.sql` adds image URL storage and the public announcement image bucket.
- `supabase/migrations/202605100004_announcement_comments.sql` adds `announcement_comments`.
- Admin and mobile users are marked as read automatically when they open a visible published announcement detail page.
- Admin announcement detail shows the first read/unread summary for the announcement target audience.
- Admin announcement detail now opens read/unread member lists from the summary counts.
- Admin announcement creation supports up to 5 image attachments.
- Admin and mobile announcement detail screens display attached images.
- Admin and mobile announcement popups display attached images.
- Admin and mobile announcement detail screens now show a shared comment thread and comment creation form for enabled published announcements.
- Admin and mobile announcement detail screens now let the comment author edit or delete their own comments.
- Comment edit/delete mutations are handled by server actions that verify the current user owns the comment and can access the announcement before updating or soft-deleting it.
- Admin and mobile announcement popups support a browser-local 7-day hide option.
- Announcement popup rendering now waits for client-side popup hide storage before showing, preventing refresh flicker.
- `supabase/migrations/202605110001_announcement_popup_dismissals.sql` adds `announcement_popup_dismissals` for persistent cross-device popup hide tracking.
- Popup "do not show for 7 days" now persists a record via `dismissPopupForWeek` server action (in `src/app/announcements/popup-actions.ts`) and syncs across all devices for the same user.
- Pages pre-filter popup candidates using `getPopupDismissals` (in `src/lib/announcements.ts`) before passing the list to `AnnouncementPopup`, preventing flash of dismissed popups from any device.
- Browser local storage is retained as a same-page fast path to hide the popup immediately after dismiss without waiting for a full page reload.
- ~~System theme now has a CSS-level dark fallback on first render when the OS prefers dark mode.~~ Obsolete: dark mode removed 2026-06-08; the app is light-mode-only.
- `AnnouncementImageUploader` client component replaces the raw file input in the admin announcement creation form.
- Images are compressed client-side before upload: max 1600px long edge, quality 0.75 for JPEG/WebP/PNG; GIF is skipped to preserve animation.
- Compressed images are uploaded directly to Supabase Storage in the client-side upload loop; no Server Action body size limit applies.
- Selected images can be individually removed before submission.
- Client-side validation shows i18n error messages for unsupported type, count exceeded, and size exceeded conditions; server-side validation is retained as a defence-in-depth layer.
- Admin announcement detail access is verified against the announcement's organization: only active memberships with an admin-web-capable role (owner, office_admin, cs_staff) are permitted; developer_super_admin bypasses the check. This prevents cross-organization access by users who hold a privileged role in one org but a non-admin role in another.
- Announcement status changes and deletion verify the user's current role in the announcement's organization: owner/office_admin can manage all announcements, and authors can manage their own announcements only while they still have an active non-part-time membership.
- Announcement creation now checks the selected organization membership directly, so multi-organization users are authorized by the target organization rather than by an arbitrary active membership.
- Admin announcement list actions are only shown for announcements the current user can actually manage; server actions and RLS remain the final authority.
- Announcement deletion now removes attached Storage images from the announcement-images bucket after the DB row is successfully deleted; cleanup only accepts URLs from the current Supabase project host and bucket, and cleanup errors are logged but do not fail the user-facing response.
- Announcement draft status and back-to-draft action labels are unified per locale: Korean "임시저장", Japanese "下書き", and English "Draft".
- Admin popup candidates are now filtered by target_scope / target_roles for the current user via `filterAnnouncementsByTargetVisibility` in `src/lib/announcements.ts`, matching the visibility logic already applied on the mobile side.
- `announcement_popup_dismissals` update RLS has been hardened by a corrective migration (`202605160001`): a trigger prevents mutating announcement_id, organization_id, or user_id, and WITH CHECK repeats the full insert-time visibility check.
- Announcement update and delete RLS policies have been replaced by a corrective migration (`202605160002`): author-only access now requires an active non-part-time membership in the announcement's organization; owner/office_admin of the org can manage all; platform admin bypasses all.
- Supabase migration history reconciliation is complete as of 2026-05-17. Local placeholder files preserve remote-applied historical versions; continue using `npx supabase migration list` as the routine verification step before and after future migration pushes.
- Direct Supabase Storage upload is implemented (`202605170001`): images are uploaded from the browser to the `announcement-images` bucket using the anon key and a Storage RLS INSERT policy. The server action receives URLs and validates structure before the DB insert. The 50MB Server Action body size override has been removed from `next.config.ts`.
- Storage INSERT policy for `announcement-images` has been hardened by corrective migrations (`202605190001`, `202605190002`): the path must be exactly `{UUID}/{UUID}/{safe-filename}` with a 3-segment check, both UUID segments validated by regex, and filename restricted to a compact safe basename that starts and ends with an alphanumeric character. Both migrations were pushed to remote 2026-05-19.
- `cleanupAnnouncementImagePaths` server action now takes `(announcementId, paths)`: cleanup is pinned to the submitted announcement ID, all paths must belong to exactly one org the user can create in, structurally invalid paths reject the whole cleanup request, and cleanup is refused if that announcement ID already exists in the DB.
- `createAnnouncement` now cleans up structurally valid uploaded images on validation, permission, or DB insert failure while refusing to delete files for an already-persisted announcement ID. `organizationId` is now also validated as a UUID (not just non-empty) in the first guard.
- `cleanupStoragePaths` now logs Storage errors instead of silently discarding them; previously silent failures left orphan images with no trace.
- `purgeOrphanAnnouncementImages` platform-admin-only server action (`src/app/admin/announcements/orphan-cleanup-actions.ts`) handles the "user uploads images then closes the tab" orphan case. It traverses the bucket hierarchy (org -> announcement -> file), applies a 60-minute grace period, compares each path against all DB-referenced URLs, and deletes in batches of 100. The admin UI trigger (`OrphanCleanupButton`) is rendered only for platform admins at the bottom of `/admin/announcements`. Folder traversal is limited to 500 entries per level; add per-level pagination if the bucket grows beyond that.
- Orphan cleanup now treats any org-level, announcement-level, or file-level Storage listing error as an incomplete run: the action aborts before deletion and returns `ok: false`, `aborted: true`, `errorMessage`, and `listingFailures` so the admin UI can show a prominent failure alert instead of a success-like zero-delete result.
- `updateAnnouncementStatus` and `deleteAnnouncement` server actions now validate `announcementId` as a UUID before the DB lookup, matching the guard already present in `createAnnouncement`.
- All 5 announcement image create/cleanup flows and 5 orphan cleanup flows verified by code-level trace on 2026-05-20; see `docs/planning/06-current-status.md` for the full trace table.
- Local test-login shortcut removed (2026-06-23): `src/app/api/dev/seed-login/route.ts`, `src/lib/dev-auth.ts`, the bottom login-page test block, and the unused `DevEntry` component were deleted. Internal rollout QA now uses real Google/email accounts. Non-auth local maintenance endpoints use `ENABLE_LOCAL_DEV_TOOLS=true` instead of seed-login credentials.
- Mobile announcement presentation refresh completed (2026-05-20): `/mobile/announcements`, `/mobile/announcements/[id]`, and `AnnouncementPopup` were visually aligned to the new reference (sectioned list cards, stronger title hierarchy, segmented detail content cards, refined comment composer, and centered modal popup action stack) without changing server actions, RLS assumptions, or visibility rules.
- Admin announcement presentation refresh completed (2026-05-20): `/admin/announcements` and `/admin/announcements/[id]` now use the same restrained announcement design system as mobile, adapted for admin web with operational header, cleaner create form, table/card hybrid rows, stronger status/target/author/date metadata, thumbnail previews, refined empty state, detail summary cards, content and attachment sections, read status panel polish, and comments polish.
- Shared `AnnouncementPopup` detail CTA now receives a surface-specific href base (`/mobile/announcements` or `/admin/announcements`) instead of hardcoding the mobile route. The secondary CTA uses the existing close/dismiss label to match its actual behavior; read tracking remains tied to detail page opens through `ensureAnnouncementRead`.
- Final announcement design polish completed on 2026-05-21 across mobile list/detail, admin list/detail, shared popup, comments, read-status panel, attachment presentation, and empty states. The Figma-alignment refinement tightened section rhythm, card proportions, metadata wrapping, modal hierarchy, attachment framing, and long-content behavior. Follow-up final polish reinforced long-title/body/comment wrapping, mobile card balance, read-status modal scrolling, and cross-surface visual cohesion with the redesigned login screen. A restrained Liquid Glass refinement was then applied mainly to mobile announcement cards, the shared popup, comments, attachments, and selected overlay/card surfaces using subtle translucency, modest blur, edge highlights, and softer shadows; admin announcement surfaces were intentionally kept more solid for operational readability. The centered popup modal now carries the strongest glass treatment in this pass, while mobile list cards received lighter translucency and the metadata separator bug was corrected. Mobile list cards show each announcement's non-deleted comment count beside the target indicator. Empty states and long titles/body text/author names/role target lists were reviewed for graceful wrapping. No RLS assumptions, server actions, popup dismissal, upload/cleanup, read-tracking rules, or permission semantics were changed.
- Browser E2E for server actions (TC-01 ~ TC-10) intentionally deferred to formal QA phase; see `docs/planning/07-qa-checklist-announcement-images.md`.
- Property targeting remains for a later slice.

## Phase 10: Reservation Calendar and Beds24

Goals:

- Properties/rooms setup
- Beds24 webhook endpoint
- Reservation table updates
- Current month + next month (2 months total)
- Mobile monthly calendar with reservation bars
- Reservation detail popup
- Today check-in/check-out
- Staying today
- Empty today
- Earliest empty availability list

Deliverables:

- Reservation calendar works from stored data
- Webhook can update reservation records
- Cancelled reservations are removed from visible calendar

Current implementation notes (as of 2026-05-24):

- `supabase/migrations/202605220001_reservations.sql`: `reservations` table + `reservation_status` enum + RLS.
- `src/app/api/beds24/webhook/route.ts`: POST endpoint, multi-alias field extraction, reservation upsert.
  - Beds24 v2 native fields supported: `bookId`, `propId`/`propName`, `unitId`/`unitName`, `firstNight`, `lastNight`, `referer`, `guestFirstName`/`guestLastName`.
  - `lastNight` → `check_out_date` conversion: `lastNightToCheckout()` adds +1 calendar day (UTC-safe).
  - `firstNight` → `check_in_date` (direct mapping, same date).
  - `referer` → `source` field (Beds24 v2 channel name).
  - Room sync called before reservation upsert on every booking event.
- `supabase/migrations/202605240001_properties_rooms.sql`: `properties` + `rooms` tables.
- `supabase/migrations/202605240002_beds24_sync_indexes.sql`: unique indexes for upsert conflict keys.
- `supabase/migrations/202605240003_beds24_property_external_key.sql`: external property ID unique constraint.
- `src/lib/rooms.ts`: `BEDS24_INACTIVE_MIN_STAY_THRESHOLD=50`, `getActiveRoomLabels()`.
- `src/lib/beds24/room-sync.ts`: `classifyBeds24Room()`, `extractBeds24RoomSyncFields()`, `syncBeds24PropertyAndRoom()`.
- `src/app/mobile/calendar/page.tsx`: queries `getActiveRoomLabels()` in parallel, passes `roomMasterRooms` prop.
  - Reservation fetch window: fixed operational window based on TODAY (not selectedMonth).
    - `operationalMonthStart` = first day of today's JST month.
    - `operationalWindowEnd` = first day of the month after next (exclusive, 2 months ahead).
    - Query: `check_in_date < operationalWindowEnd AND check_out_date >= operationalMonthStart`.
    - This includes currently-staying guests, current month, and next month reservations.
  - `selectedMonth` (UI navigation) is independent of the fetch window — controls Overview grid display only.
  - Lists mode (Check-in/Check-out/Staying Today) always filters by `today`, independent of selectedMonth.
- `src/components/calendar/mobile-calendar-view.tsx`: authoritative/provisional branch via `roomMasterRooms`.
  - `roomSourceDebug` includes `fetchWindow: { from, to }` in dev mode (`?debug=rooms`).
- `scripts/dev/beds24-webhook-sample.json`, `beds24-webhook-airbnb-sample.json`: dev test fixtures.
- `scripts/dev/beds24-webhook-test.sh`: curl-based local E2E test script.
- Reservation `source` is now canonicalized before upsert in both webhook and backfill paths to stabilize dedupe on `organization_id, source, source_reservation_id`.

Implementation update (2026-06-02):

- Beds24 webhook processing is now helper-driven rather than route-monolithic:
  - `src/app/api/beds24/webhook/route.ts` handles auth + batch orchestration only
  - `src/lib/beds24/booking-payload.ts` provides:
    - `extractBeds24BookingCandidates()` for strict backfill payloads
    - `extractBeds24WebhookBookingCandidates()` for relaxed webhook payloads
  - `src/lib/beds24/process-webhook-booking.ts` processes a single booking payload
  - `src/lib/beds24/reservation-lookup.ts` owns source-agnostic original-booking lookup and cancel consistency cleanup
- Webhook cancellation behavior is now source-agnostic and original-booking-id based.
- Sparse cancellation payloads are accepted for webhook handling when they carry a booking ID plus cancellation signals, even if stay dates are omitted.
- Current multi-room persistence rule remains the compatible rollout:
  - database uniqueness is still `(organization_id, source, source_reservation_id)`
  - Foldy stores room-assignment identity inside `source_reservation_id` as `"{originalReservationId}::room::{room_label}"`
- Mobile calendar room rendering now separates:
  - internal room identity (`canonicalRoomLabel`)
  - display room row label (`displayRoomLabel`)
  so Arakicho sub-units such as `402_2` can share one visible row `402` without merging distinct real-unit identities like `A301` and `301`.

Reservation fetch window rule (current implementation):

| Field | Value |
|---|---|
| `operationalMonthStart` | First day of today's month (JST) |
| `operationalWindowEnd` | First day of month+2 (exclusive) |
| Covers | Currently staying + current month + next month |
| Does NOT cover | Months beyond +1 from today |

Limitation: if user navigates Overview beyond the operational window, bars are empty. MVP does not support full future/historical browsing. Document this to users if needed.

**Out-of-Window Exploration Fix (2026-05-26 - Option A)**:
- Problem: crossover reservations (e.g. late June arrivals staying into July) partially showing when viewing July (outside the 2-month fetch window).
- Resolution: `isOutOfWindow` detected server-side; when true, reservations DB query is skipped and `reservations = []` is passed to the client. `isOutOfWindow` boolean is passed as a prop so the client does not recompute it independently. Displays clear, localized alert panels under Overview and Lists mode. Month navigation remains enabled so users can easily toggle back.
- Debug format: Unicode arrow `→` replaced with `->` and `(exclusive)` label appended. Dev mode (`?debug=rooms`) now also shows `reservations query: skipped | executed`.

**2026-05-26 Code Review Follow-up — P2/P3 close-out**:
- P2 (Server query skip): `src/app/mobile/calendar/page.tsx` now computes `isOutOfWindow` (same formula as the former client useMemo) and branches before the Supabase reservations query. Out-of-window path calls only `getActiveRoomLabels` (kept for debug/room-source consistency). In-window path runs the full `Promise.all` as before. `roomSourceDebug` extended with `reservationsQuery: "skipped" | "executed"`.
- P2 (Single source of truth): `isOutOfWindow` is now a required prop on `MobileCalendarView`. The client-side `useMemo` that recomputed it independently has been removed. `effectiveReservations` defensive guard is kept for clarity.
- P3 (Docs): `docs/product/15-reservation-calendar.md` Out-of-Window Policy updated to reflect server-side query skip; "Future / Post-MVP: Extending the Window" section added. `docs/engineering/06-implementation-plan.md` Phase 10 Remaining split into "MVP backlog" vs "Post-MVP / Optional" to eliminate aspirational/confirmed conflation.

`npm run lint` and `npm run build` pass.

### 2026-05-26 Phase 10 follow-up: mobile today alignment + auto-scroll + Beds24 ops docs

- `src/components/calendar/mobile-calendar-view.tsx`
  - Date column width now uses the same `DAY_WIDTH` constant for both header day cells and body grid/highlight math.
  - `todayIndex` is resolved with `dates.findIndex((date) => date === today)` as explicit equality predicate.
  - Header today cell and body today stripe now share the exact same `index * DAY_WIDTH` coordinate basis.
  - Overview horizontal scroller auto-scrolls once per `selectedMonth + selectedProperty` key to `max(todayIndex - 1, 0) * DAY_WIDTH`.
  - Room label column width and body scroll coordinate system are explicitly separated and fixed so x-origin remains stable.
- Beds24 reservation source dedupe hardening:
  - New helper `src/lib/beds24/source-normalization.ts` canonicalizes `Booking.com`, `Airbnb`, `API` channel variants before reservation upsert.
  - Applied in both `src/lib/beds24/reservations-backfill.ts` and `src/app/api/beds24/webhook/route.ts`.
- Docs and runbook updates:
  - Added linked-properties token-scope risk and checklist.
  - Added webhook-vs-backfill responsibility split and troubleshooting order.
  - Clarified MVP trust boundary: webhook provides freshness, backfill provides completeness; calendar reliability depends on both layers.

### 2026-05-26 Phase 10 critical hardening (backfill/webhook/source)

- Backfill pagination integrity:
  - `src/lib/beds24/reservations-backfill.ts` no longer treats partial page-chain fetch as success.
  - Any mid-chain page failure now flags partial failure (`partial`, `failedPageUrl`) and avoids success-like reservation fetch results.
  - `src/app/api/dev/beds24/backfill-reservations/route.ts` now returns mode states: `success`, `partial_failure`, `no_data`.
- Webhook room-label pollution guard:
  - `src/app/api/beds24/webhook/route.ts` no longer uses `unitId`/`roomId` as room-label candidates.
  - Room-master sync now ignores numeric ID-like labels and uses display labels or existing room lookup only.
  - Reservation upsert still proceeds with raw payload retained when room label cannot be resolved, so data is recoverable without polluting room master.
- Source canonical policy expanded:
  - `src/lib/beds24/source-normalization.ts` now canonicalizes `Direct`, `Agoda` and applies case normalization for unknown channels to reduce dedupe-key drift.

Remaining (MVP backlog):

- [x] Admin reservation calendar or list view -- implemented at `/admin/calendar` with month grid, property filter, check-in/out lists, and CSV export.
- [ ] Earliest empty availability list -- still deferred.
- [x] Real-time update -- implemented via Supabase Realtime subscription; calendar updates automatically on webhook-driven reservation changes.

Post-MVP / Optional (do not implement without a documented product requirement change):

- [ ] Extend fetch window beyond 2 months. The confirmed MVP policy is current month + next month (2 months total). Any extension requires an explicit product decision, UI scope changes, and a performance review of the larger query range.

## Phase 11: Notifications

Status: Completed (2026-06-03)

Goals:

- In-app notification center
- Notification table
- Order completed notification
- Web Push (deferred to post-MVP)

Deliverables:

- Users can see notifications in app
- Push notification proof of concept (deferred)

Implementation notes:

- `notifications` table implemented via migration `supabase/migrations/202606030001_notifications.sql`.
- `notification_type` enum: currently one value `order_processed`.
- `order_processed` notification is dispatched when an order transitions to `ordered` via `updateOrderRequestStatus` server action.
- Self-notification suppressed: processor = requester does not trigger a notification.
- Dedupe key `order_processed:{orderId}` prevents duplicate notifications per order.
- `/mobile/notifications` lists notifications with unread badge, mark-as-read, and mark-all-read.
- `schemaUnavailable` graceful fallback: missing table shows an info card instead of crashing.
- Web Push not yet implemented. In-app only.
- Announcement, maintenance, and cleaning-overdue notifications remain planned for post-MVP.

## Phase 12: Exports

Status: Completed (2026-06-01/02); **CSV route superseded 2026-07-14** (see below)

Goals:

- CSV export for all major operational records
- Permission-gated export actions
- UTF-8 BOM for Korean/Japanese text compatibility

Deliverables:

- Admin-web roles can download CSV exports
- Field staff cannot export

Implementation notes (original, 2026-06-01/02 — route no longer exists, see superseded note below):

- Export route: `GET /api/admin/export/[resource]` (requires admin session).
- Supported resources: `reservations`, `cleaning`, `maintenance`, `lost-found`, `orders`.
- All exports include UTF-8 BOM and RFC 5987 `filename*` Content-Disposition encoding.
- Date/time values formatted in Asia/Tokyo timezone.
- Building labels localized per user's preferred language.
- Filters (date range, status, property, staff) passed as URL search params and applied in the export query.
- Reservation export uses the same out-of-window guard as the calendar page.

**Superseded (2026-07-14) — CSV route removed, Excel + PDF via shared server actions:**

- `/api/admin/export/[resource]` and every route under `/api/admin/export/*` were deleted, along with
  `src/lib/export/admin-export.ts`, `src/lib/export/csv.ts`, `src/lib/export/admin-reservations.ts`, and
  `src/components/admin/export-csv-link.tsx`.
- Every admin-web list (cleaning history, lost-found, maintenance, orders, annual-leave ledger/balance,
  attendance wages, plus the pre-existing attendance payroll/transport exports) now exports through a
  dedicated server action pair (`export<Resource>Workbook` / `export<Resource>Report`) that renders via
  two new shared builders:
  - `src/lib/admin-table-workbook.ts` (`buildAdminTableWorkbookBase64`) — the single `.xlsx` builder for
    the whole admin console (exceljs; green-ledger template: title merge row → header row → numbered
    data rows → total row → org/generated-at footer; multi-sheet supported).
  - `src/lib/admin-table-report.ts` (`buildAdminTableReportHtml`) — the matching A4-landscape print HTML
    (PDF via browser print) for the same input shape.
  - `src/lib/admin-export-meta.ts` (`buildAdminExportMeta`) — resolves org name / generated-at / shared
    labels; **locale is always resolved server-side from `session.user.preferredLanguage`**, never passed
    by the client.
  - `src/components/admin/shared/admin-export-buttons.tsx` (`<AdminExportButtons>`) — the canonical
    Excel/PDF button pair used by every export bar.
- The client always sends only the current filter values (never row data); each server action re-queries
  the underlying data function so the exported file always matches the filtered screen.
- Reservation calendar export is unaffected by this change — it was already moved to
  `/admin/calendar/print` (browser print/save-as-PDF) on 2026-07-10, a separate path from the table
  exporters above.
- See `docs/product/07-cleaning-workflow.md`, `docs/product/08-maintenance-workflow.md`,
  `docs/product/09-lost-found-workflow.md`, `docs/product/10-order-request-workflow.md`,
  `docs/product/26-annual-leave-workflow.md`, and `docs/product/21-attendance-payroll-workflow.md` for
  the per-surface detail.

## Phase 13: QA and Internal Rollout

Status: **In progress** (started 2026-06-03)

Goals:

- Test mobile PWA on iPhone/Android
- Test admin web on desktop
- Test Korean/Japanese/English
- Test light mode (dark mode removed; deferred post-launch)
- Test role permissions
- Test invite flow
- Test image upload limits
- Test PWA install instructions

Deliverables:

- [x] Full-system QA checklist → `docs/planning/13-qa-checklist.md`
- [x] Known issues / open risks list → `docs/planning/13-qa-checklist.md` section 11
- [x] Release-readiness summary → `docs/planning/06-current-status.md` and `docs/planning/13-qa-checklist.md` section 12
- [x] Rollout guide for staff → `docs/planning/14-rollout-guide.md`

Done criteria:

- [x] All critical code bugs fixed (TypeScript build error, missing DB migrations)
- [x] `npm run lint` passes with 0 errors
- [x] `npm run build` passes
- [ ] Browser E2E golden-path pass (pending manual verification)
- [ ] Room master backfill run in production
- [ ] First staff batch onboarded successfully

## Phase 14: Post-MVP Feature Batch (approved 2026-06-09)

Status: **Implemented and in active hardening.** The unchecked build-order lists below are retained as
historical planning provenance and are superseded by this as-built summary:

- Linen return: mobile building-first create/detail/ledger plus `/admin/linen-return` console live.
- Todoist/tasks: mobile tasks, recurrence occurrences, projects, participants, reports/reminders, and
  `/admin/tasks` desktop console live; `/admin/recurring-work` redirects to the console.
- Suggestions: participant-aware mobile create/list/detail/edit/delete, status workflow, comments,
  images, notifications, and ko/ja/en UI live.
- Board: mobile feed/create/detail, reads, pins, comments, reactions, mentions, files, notifications,
  and moderation live. The dedicated edit route remains a known follow-up.
- Attendance/payroll: QR/GPS attendance, breaks, trusted device, corrections, history, expected pay,
  notifications, and reminders live on mobile; admin overview/review/manual management/roster/wages/
  payroll/finalization/transport/annual leave/Excel and print-to-PDF exports live under
  `/admin/attendance/*`.
- Navigation: all five features have entries in `src/config/navigation.ts` and the shared mobile shell.

Historical build checklist (superseded):

### 14.1 Linen Defect Registration (historical checklist)

- [ ] Design 5 mobile screens from the refined 2026-06-10 product plan: building picker, building list, create, detail, ledger/statistics
- [ ] Migration: `linen_items`, `linen_return_records`, `linen_return_record_items` → update `src/types/database.ts`
- [ ] RLS per `docs/engineering/05` linen sections: org-wide read, author/admin mutation, item-master admin-only management
- [ ] Server actions (create/update/delete record, manage item master) per `docs/engineering/08`
- [ ] Mobile-only UI first; admin web deferred until the wider mobile set is complete
- [ ] Reuse current optional image-upload pattern; no `defect_type` enum in v1, note/reason is one optional text field
- [ ] i18n ko/ja/en for building-first flow, ledger/statistics, validation
- [ ] Sync docs `19`, `08`, `04`, `05`, `16`

### 14.2 Personal Todo / Shared Task Inbox (historical checklist)

- [ ] Design the core mobile task workspace from the refined 2026-06-10 product plan:
  - Today
  - Tomorrow
  - Inbox
  - Sent By Me
  - Calendar
  - quick add
  - detailed create/edit
  - task detail
  - participant picker
- [ ] Migration: `tasks`, `task_participants`, `task_updates` → update `src/types/database.ts`
- [ ] RLS per `docs/engineering/05` task sections: participant-only visibility, author-only core edits, participant workflow-state mutation via actions
- [ ] Actions per `docs/engineering/09`; i18n; sync docs `18`, `09`, `04`, `05`, `16`
- [ ] Keep task calendar visually and conceptually distinct from the reservation calendar

### 14.3 Staff Suggestions / Feedback Box (historical checklist)

- [ ] Migration: `staff_suggestions`, `staff_suggestion_references`, `staff_suggestion_comments`
- [ ] Participant-aware RLS: author / recipient / referenced users only
- [ ] Mobile create/list/detail with `Sent`, `Received`, `Referenced` tabs
- [ ] Recipient-only status actions with required `hold_reason` / `completion_note`
- [ ] Comment thread with photo attachments (max 5) and comment-author-only edit/delete
- [ ] Notifications for create / reference / status / comment; i18n; sync docs `22`, `12`, `04`, `05`, `01`

### 14.4 Internal Board (historical checklist)

- [ ] Expand `docs/engineering/10` (indexes, action detail) before build
- [ ] Migration: `board_posts`; part-time write allowed (2026-06-09)
- [ ] RLS, actions, feed + moderation; i18n; sync docs `20`, `10`, `04`, `05`

### 14.5 Attendance / Clock-In-Out + Payroll (historical checklist)

- [x] **Step 1 — schema + permission foundation (2026-06-17):** migration `202606170001_attendance_payroll.sql` — 11 session-first tables (`attendance_sites`, `attendance_qr_tokens`, `attendance_sessions`, `attendance_breaks`, `attendance_attempt_logs`, `attendance_correction_requests`, `attendance_session_audits`, `employment_type_history`, `hourly_rate_history`, `attendance_month_snapshots`, `attendance_export_logs`) + `memberships.attendance_payroll_admin` + `can_manage_attendance_payroll(org)`; read-only RLS; TS types + `src/lib/attendance.ts`. (Supersedes the earlier `attendance_events`/`employment_profiles` draft.)
- [ ] Step 2+ — PWA QR + GPS clock-in/out + breaks + corrections (service-role actions); Asia/Tokyo operating-date boundaries; one-open-session + open-break-blocks-clock-out enforcement; own history + admin review queries
- [ ] Payroll: employment/rate-history management, expected pay, monthly per-person finalization snapshots, dashboard (owner + `attendance_payroll_admin` only) — hourly gross principal only (no OT/holiday/night premiums); export (finalized only) once the operator template is provided
- [ ] Wi-Fi (`gps_wifi`) stays modeled but inactive in the PWA (UI `준비중`)
- [ ] Sync docs `21`, `11`, `04`, `05` each step

### Phase 14 nav/IA prerequisite (completed; historical checklist)

- [ ] Add nav entries for the new features to `src/config/navigation.ts` and `docs/product/16-mobile-navigation.md` (currently none of the five have a mobile nav home)

## Always Required

For every phase:

- Update relevant docs when behavior changes.
- Update decision log for confirmed decisions.
- Keep i18n keys complete.
- Test light mode (light-mode-only; dark mode deferred post-launch).
- Test mobile layout.
- Respect RLS/permission rules.

## 2026-05-21 Implementation Note

- New corrective migration adds:
  - `lost_items.image_urls text[] not null default '{}'`
  - `maintenance_reports.image_urls text[] not null default '{}'`
  - `request-images` public storage bucket (8MB per file, image mime allowlist)
  - strict storage path contract: `{orgId}/{requestType}/{requestId}/{filename}`
- Request creation actions now validate image URL/path ownership and request-id consistency.

## 2026-05-22 Implementation Note

- `MobileShell` top chrome was normalized to one shared implementation for all mobile pages.
- Historical note: the menu icon first opened a 78%-width drawer; the current shared contract uses a full-screen slide-in menu.



## 2026-05-22 Phase 10 Kickoff Note

- Reservation Calendar/Beds24 phase has started with schema groundwork.
- Added migration: `supabase/migrations/202605220001_reservations.sql`
  - `reservation_status` enum: `confirmed`, `checked_in`, `checked_out`, `cancelled`, `no_show`
  - `reservations` table with core fields: organization, property, room, guest, check-in/out, source IDs, raw payload
  - unique key: `(organization_id, source, source_reservation_id)`
  - trigger-based `updated_at`, date/content checks, and calendar-oriented indexes
  - RLS: active org members can read, platform admins can manage, service role can upsert
- Updated `src/types/database.ts` with `public.reservations` and `reservation_status`.

## 2026-05-22 Beds24 Webhook Endpoint Note

- Added webhook receiver route: `src/app/api/beds24/webhook/route.ts`
- Endpoint accepts `POST` JSON and upserts into `public.reservations` by `(organization_id, source, source_reservation_id)`.
- Secret verification supports:
  - `x-beds24-webhook-secret` header
  - `Authorization: Bearer <secret>`
  - `?secret=` query
- Required payload fields (alias-supported): reservation id, check-in/out, guest, property, room.
- Organization mapping can come from payload fields or `BEDS24_DEFAULT_ORGANIZATION_ID` env.

## 2026-05-24 Beds24 Active Room ID Rule

- Before implementing `properties` / `rooms` master sync, Foldy must apply a company-specific active-room filter to Beds24 room data.
- Some buildings rotate between two Beds24 room ID groups over the year.
- Internal rule: if the Beds24 minimum stay is `50 nights or more`, that room ID group is treated as inactive for that period.
- Normal operational minimum stay values such as `1`, `2`, or `3` nights identify the active room ID group.
- This is not a Beds24 standard rule. It is a company-only rule and must be documented in sync code and room-master design.
- Phase 10 room/property master work must import only the active room ID set; inactive room IDs must not affect room axis, occupancy, or `Empty today`.

## 2026-05-22 Mobile Calendar Baseline Note

- File: `src/app/mobile/calendar/page.tsx`
- Follows existing RSC + MobileShell pattern; `activeItem="calendar"` wires the bottom-tab highlight.
- Auth/onboarding guards: `getOnboardingState` + `getCurrentAppSession`; unauthenticated redirects to `/auth/login?next=/mobile/calendar`.

**Current implemented scope:**

- Organization-scoped Supabase query: 14-day window (`check_in_date <= rangeEnd` AND `check_out_date >= today`), `status != 'cancelled'`, ordered by `check_in_date ASC`.
- Date bounds derived from JST date string via `Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Tokyo"})`.
- Today counts:
  - Check-ins: `check_in_date === today`
  - Check-outs: `check_out_date === today`
  - Staying (in-house): `check_in_date <= today && check_out_date > today` (checkout-day guests excluded)
  - Empty (provisional): rooms observed this month minus occupied rooms; not authoritative until room master table exists
- Calendar UI modes:
  - Overview: sticky room column + horizontal 14-day date axis + source-colored reservation bars
  - Lists: Check-in today / Check-out today / Staying today sections
- Reservation detail modal: bottom sheet opens on reservation bar/list item tap.
- Month navigation:
  - Query param `month=YYYY-MM` added to `/mobile/calendar`
  - Overview header prev/next controls move month and trigger month-scoped server query refresh
- Month query scope:
  - `check_in_date < nextMonthStart` AND `check_out_date >= monthStart`
  - includes overlapping stays within the selected month window
- i18n: `admin.reservationStatusLabels` added to `src/lib/i18n.ts` (type + ko/ja/en values); status badge now uses `dictionary.admin.reservationStatusLabels[item.status]` with raw-value fallback for unknown statuses.

**Deferred to next Phase 10 slices:**

- Prev/next month navigation (requires client-side state or search param)
- Room master table for authoritative empty/available counts
- Admin reservation view
- Beds24 payload field mapping finalization

## 2026-05-23 Phase 10 Slice Note (Map/Modal/Empty Prep)

- Updated `src/components/calendar/mobile-calendar-view.tsx` policy behaviors:
  - Added consistent selectable tab modes: `overview`, `lists`, `map`.
  - `map` mode is a placeholder card with explicit i18n guidance while integration is pending.
  - Added reservation detail action policy fallback:
    - `Message Guest` button disabled with explanatory hint until integration is ready.
    - `Manage Booking` button disabled with explanatory hint until integration is ready.
  - Added reliable phone actions in detail sheet:
    - clipboard copy with fallback implementation,
    - `tel:` call action only when dialable number exists,
    - explicit missing-phone text fallback.
- Empty-room accuracy prep implemented in UI:
  - `Lists` mode now shows provisional `Empty today` count + warning text.
  - Provisional formula is unchanged (observed rooms minus currently occupied rooms).
  - Room-master-backed authoritative calculation remains TODO for a future schema slice.
- Follow-up i18n repair restored Korean/Japanese dictionary coverage across the active app surfaces after fallback leakage was found during verification.
- 2026-05-23 Japanese completeness pass: added missing `ja` locale overrides for admin.settings, admin.users.errors/success, requestImages, mobile snapshot strings, cleaning (duration/staff/status/noSessions/lostReported/maintenanceReported/errors), lostFound and maintenance (modal copy + errors), and onboarding.errors. All production-visible surfaces now have full ko/ja/en coverage.

## 2026-05-24 i18n Follow-up Note

- Added localized auth error mapping for `/auth/login` so user-facing login failures no longer display raw error query values.
- Added localized organization status labels in admin settings so `organization_status` enum values are not shown directly in the UI.
- In-app browser QA verified localized login rendering for `ko`, `ja`, and `en`. Follow-up authenticated verification used direct Supabase session cookies against the running local dev server and confirmed consistent `ko`, `ja`, and `en` rendering on `/admin/users`, `/admin/settings/organization`, `/mobile/calendar`, `/mobile/cleaning`, and `/mobile/requests`.

## 2026-05-24 Phase 10 — Empty Today Structural Prep + Follow-up Fixes

- Room master table (`rooms` / `properties`) confirmed absent from all migrations. No authoritative room set exists yet.
- `Empty today` in Lists mode stays **provisional** but is now structurally ready for authoritative switch.

### Component changes (`src/components/calendar/mobile-calendar-view.tsx`)

- `computeEmptyToday(roomMasterRooms, stayingToday, allReservations)` helper extracted outside the component; returns `{ count: number; isProvisional: boolean }`. Authoritative branch active when `roomMasterRooms` is a non-empty array; provisional branch active otherwise.
- `roomMasterRooms?: string[]` prop added to `MobileCalendarViewProps`. Currently `undefined`; pass active room labels from a rooms table query to activate authoritative mode.
- `rooms` useMemo updated: uses `roomMasterRooms` as the canonical room set when provided; falls back to reservation-observed rooms when `undefined`. Both the Overview room axis and `computeEmptyToday()` use the same source — no split authoritative/provisional state possible.
- Lists mode Empty today card: amber styling and `emptyAccuracyHint` text render only when `isProvisional: true`. Neutral card renders when authoritative — no i18n or UI changes needed at switch time.
- TODO comment in `computeEmptyToday()` links to `docs/product/06-property-room-model.md`.

### Page change (`src/app/mobile/calendar/page.tsx`)

- Login redirect now preserves the `month` query param: resolves `searchParams` in the same `Promise.all` as session/onboarding checks, then builds `nextPath` with `isValidMonth()` guard before redirecting. Result: `/auth/login?next=%2Fmobile%2Fcalendar%3Fmonth%3D2026-07`.
- `roomMasterRooms` is **not yet passed** — no rooms table to query.

### Authoritative switch (future, one-time wiring)

1. Implement rooms/properties table per `docs/product/06-property-room-model.md`.
2. Query active room labels server-side in `src/app/mobile/calendar/page.tsx`.
3. Pass `roomMasterRooms={activeRoomLabels}` to `<MobileCalendarView>`.
4. Both room axis and empty count switch to authoritative automatically.

`npm run lint` and `npm run build` pass.

## 2026-05-24 Phase 10 — Code Review Follow-up 2

### authoritative 판정 기준 수정

- `roomMasterRooms && roomMasterRooms.length > 0` → `roomMasterRooms !== undefined` 으로 변경 (2곳: `computeEmptyToday()` + `rooms` useMemo).
- 의미 정의: `undefined` = room master 미연결 (provisional); `[]` = 연결됨 + active room 0개 (authoritative zero-room state, isProvisional: false, amber 카드 미표시).
- `roomMasterRooms = []` 결과: empty count 0, isProvisional false, room axis 빈 목록.

### onboarding까지 month 보존

- **`src/app/mobile/calendar/page.tsx`**: `state !== "ready"` 분기 → `/onboarding?next=<encodedCalendarPath>`.
- **`src/app/auth/login/page.tsx`**: authenticated-but-not-ready 상태에서 `/onboarding?lang=<locale>&next=<encodedCalendarPath>` 로 redirect 하도록 수정. 로그인 단계에서 `next`가 더 이상 끊기지 않음.
- **`src/app/onboarding/page.tsx`**: `next?: string` prop 추가, `safeNext` 검증 (상대 경로만 허용), 두 form에 hidden `next` input 삽입.
- **`src/app/onboarding/page.tsx`**: unauthenticated 재진입 시에도 `/auth/login?next=/onboarding?...&next=<encodedCalendarPath>` 형태로 내부 `next`를 다시 감싸 전달. onboarding 진입 중 세션이 끊겨도 month 복귀 경로 유지.
- **`src/app/onboarding/actions.ts`**: `sanitizeNext()` 헬퍼 추가, `completeProfile` + `joinOrganizationWithInviteCode` 성공 경로에서 `next || getDefaultRouteForRole(role)` 사용; profile-only 저장 후 membership 대기 redirect도 `next` 보존.
- edge case: `joinInviteCode` 헬퍼 내부 error redirect는 `next` 미보존 (허용).

`npm run lint` and `npm run build` pass (30 routes).

## 2026-05-24 Phase 10 — properties/rooms 스키마 도입 + Beds24 활성 room 필터

### 마이그레이션

- `supabase/migrations/202605240001_properties_rooms.sql` 추가
  - 새 enum: `property_type` (standalone, multi_room_building, hotel, apartment, house)
  - 새 enum: `property_status` (active, inactive, under_construction, archived)
  - 새 enum: `room_status` (active, inactive, under_construction)
  - `properties` 테이블: organization FK, name/display_name(ko/ja/en), property_type, status, external_provider, external_property_id, updated_at 트리거, RLS
  - `rooms` 테이블: organization FK, property FK, name, **room_label** (org 내 unique, 예약/청소/분실물/유지보수 cross-table 조인 키), floor, unit_type, status, external_provider, external_room_id, **external_minimum_stay** (Beds24 활성 room 판별값), updated_at 트리거, RLS
  - 두 테이블 모두: 멤버 select, platform admin all, service_role all

### Beds24 활성 room 필터 구현

- `src/lib/rooms.ts` 신규 생성
  - `BEDS24_INACTIVE_MIN_STAY_THRESHOLD = 50`: 임계값 상수 (회사 내부 규칙)
  - `isInactiveBeds24Room(minimumStay: number): boolean`: 단순 판별 헬퍼
  - `getActiveRoomLabels(organizationId, supabase)`: 활성 room_label 배열 조회
  - `status = 'active'` + `(non-Beds24 room OR Beds24 room with explicit external_minimum_stay < 50)` 필터 적용
  - Beds24 rows with `external_minimum_stay = NULL` are intentionally excluded until sync data is complete enough to classify them
  - classified room row가 하나도 없으면 `undefined` 반환 → calendar provisional 모드 유지
  - classified room row가 있고 active row가 0개면 `[]` 반환 → authoritative zero-room state
  - active row가 있으면 `string[]` → authoritative 모드 활성화

### Calendar 연결

- `src/app/mobile/calendar/page.tsx` 업데이트
  - `getActiveRoomLabels` 임포트 추가
  - `supabase` 클라이언트 생성 후 reservations 쿼리와 **병렬** `Promise.all`로 rooms 조회
  - `roomMasterRooms` 결과를 `<MobileCalendarView roomMasterRooms={roomMasterRooms} ...>` 로 전달
  - rooms 테이블이 비어 있으면 `undefined` 반환 → provisional 모드 유지 (amber 카드 표시)
  - rooms 데이터가 존재하면 authoritative 모드 전환 → amber 카드 사라짐

### Types

- `src/types/database.ts` 업데이트
  - `properties` 테이블 Insert/Row/Update 타입 추가
  - `rooms` 테이블 Insert/Row/Update 타입 추가
  - `property_status`, `property_type`, `room_status` enum 추가

`npm run lint` and `npm run build` pass.

## 2026-05-24 Phase 10 — Beds24 webhook → properties/rooms room master sync

### 추가 마이그레이션 (`202605240002_beds24_sync_indexes.sql`)

- `properties`: `UNIQUE (organization_id, name)` constraint 추가 — name fallback ON CONFLICT upsert 지원
- `properties`: `UNIQUE (organization_id, external_provider, external_property_id)` constraint 추가 — Beds24 property ID 기준 upsert 지원
- `rooms`: `rooms_beds24_ext_room_id_idx` partial unique index 추가 — `external_provider = 'beds24' AND external_room_id IS NOT NULL` 조건하 중복 방지 및 beds24 room ID 조회 지원

### `src/lib/beds24/room-sync.ts` 신규 생성

- `classifyBeds24Room(minimumStay: number | null): "active" | "inactive"`
  - `null` → `"inactive"`: minimum_stay 정보 없으면 보수적으로 inactive (active inventory 오염 방지)
  - `>= 50` → `"inactive"`: 회사 내부 규칙
  - `< 50` → `"active"`: 정상 운영값
- `extractBeds24RoomSyncFields(payload)`: Beds24 webhook payload에서 property/room sync 필드 추출
  - `propertyName`, `externalPropertyId`, `roomLabel`, `externalRoomId`, `minimumStay`
  - minimumStay 추출 키: `minimumStay / minimum_stay / minStay / min_stay / minNights / min_nights`
- `syncBeds24PropertyAndRoom(organizationId, fields, supabase)`: property + room upsert 오케스트레이터
  - property upsert:
    - `external_property_id`가 있으면 `(organization_id, external_provider, external_property_id)` 기준 ON CONFLICT DO UPDATE
    - 없으면 `(organization_id, name)` fallback ON CONFLICT DO UPDATE
    - propertyName 없으면 externalPropertyId를 name fallback으로 사용
  - room upsert: `(organization_id, room_label)` unique constraint로 ON CONFLICT DO UPDATE
    - inactive room도 `status = 'inactive'`로 저장 (추적성 유지, active inventory에는 미포함)
    - rotating room ID 지원: room_label은 stable, external_room_id + minimum_stay 갱신
  - 실패 정책: property/room sync 실패는 서버 로그에 남기고 caller의 reservation upsert는 차단하지 않음

### `src/app/api/beds24/webhook/route.ts` 업데이트

- `extractBeds24RoomSyncFields` + `syncBeds24PropertyAndRoom` import
- `syncBeds24InventoryMinimumStay` import
- 필수 필드 검증 통과 후 supabase client 생성 → property/room sync → reservation upsert 순서
- property/room sync 직후 `externalPropertyId` 기준 current-date inventory sync 시도
- sync 실패는 로그만 기록, reservation은 계속 저장
- response에 `roomSync` + `inventorySync` 메타데이터 추가

### authoritative 전환 경로 (end-to-end)

이제 Beds24 webhook이 유효한 booking payload를 받으면:
1. `properties` row가 없으면 생성 (name + beds24 provider)
2. `rooms` row가 없으면 생성 (room_label + status 분류 + external_minimum_stay 기록)
3. `reservations` row upsert (기존 동작)
4. `/mobile/calendar` 다음 접속 시 `getActiveRoomLabels()`가 classified room rows를 기준으로 상태를 결정
   - booking webhook only + `minimum_stay = null` rows only → still provisional
   - inventory sync 성공 + active rows 존재 → authoritative 모드 전환

### Inventory sync 추가 (same day)

- `src/lib/beds24/inventory-sync.ts` 신규 생성
  - `BEDS24_API_BASE_URL` + (`BEDS24_API_TOKEN` or `BEDS24_API_REFRESH_TOKEN`) 존재 시 동작
  - `GET /properties?includeAllRooms=true` 우선 호출
  - target property의 `roomTypes[].id`, `roomTypes[].minStay`를 primary sync source로 사용
  - current-date 기준 `propId` inventory calendar 조회는 fallback으로 유지
  - query variants:
    - `from/to`
    - `dateFrom/dateTo`
    - `start/end`
  - extracted `minimumStay`를 `rooms.external_minimum_stay`에 반영
  - `classifyBeds24Room()`로 `rooms.status` 재분류
  - 매칭 기준: `organization_id + external_provider='beds24' + external_room_id`
  - `BEDS24_API_REFRESH_TOKEN`이 있으면 `GET /authentication/token`으로 access token을 발급받아 메모리 캐시 후 재사용
  - 401/403 등 Beds24 인증 실패는 `inventory:http-401`, `inventory:refresh-token-invalid` 같은 skipped code로 노출

### 2026-05-25 remote verification update

- Remote Supabase project had not yet applied the 2026-05-24 room-master migrations at the start of verification.
- Applied remotely:
  - `properties_rooms`
  - `beds24_sync_indexes`
  - `beds24_property_external_key`
- Replayed the local Booking.com sample webhook against `/api/beds24/webhook`.
- Result:
  - reservation upsert succeeded
  - property/room sync succeeded and returned real UUIDs
  - SQL verification confirmed a `rooms` row with `external_room_id = 67890`, `external_minimum_stay = null`, `status = inactive`
  - later, a valid long-life token was supplied and direct Beds24 calls started returning `200 OK`
  - real `properties?includeAllRooms=true` responses contain `roomTypes[].minStay`
  - real `inventory/rooms/calendar` same-day calls returned room rows but empty `calendar: []`
  - inventory sync was updated to prefer `properties?includeAllRooms=true` and keep calendar as fallback
  - real-ID webhook replay (`propId=176430`, `unitId=383971`) produced:
    - `inventorySync.matchedRooms = 1`
    - `inventorySync.updatedRooms = 1`
    - room row updated to `external_minimum_stay = 1`, `status = active`
- Conclusion:
  - webhook -> room-master population path is now verified
  - authoritative room classification path is now verified with real Beds24 IDs
  - remaining work is to align real webhook traffic / legacy placeholder rows / browser-level calendar QA, not core API connectivity
  - additional mobile hardening added afterward:
    - platform-only sessions now redirect away from `/mobile*` routes instead of crashing on `"platform"` pseudo-org IDs
    - `getActiveRoomLabels()` was simplified to a single room query + in-app classification to avoid brittle PostgREST filter chains during authoritative room lookup
  - development-only room-source QA hook added:
    - `/mobile/calendar?debug=rooms`
    - local staff-session check confirmed `authoritative_active` with active room label `201`
  - follow-up backfill path added for already-synced Beds24 properties:
    - `backfillBeds24InventoryMinimumStay()` iterates existing `properties.external_property_id` rows and reuses the same minimum-stay sync logic
    - `POST /api/dev/beds24/backfill-inventory` exposes the backfill behind local-development guards + `x-beds24-webhook-secret`
    - `scripts/dev/beds24-backfill-inventory.sh` gives a repeatable local trigger for reclassification without waiting for a new booking webhook

첫 번째 Beds24 webhook이 올 때 자동으로 room master 데이터가 생성됨.
최초 webhook 이후 코드 변경 없이 calendar authoritative 모드가 켜짐.
active room이 0개인 경우에도 room master 연결 상태는 유지되며, calendar는 authoritative zero-room state를 사용함.

`npm run lint` and `npm run build` pass.

## 2026-05-26 Phase 10 update: Building-first mobile calendar

- Added building-first filtering in `/mobile/calendar` via `property` query parameter.
- Added room-master catalog usage (`room + property`) so room axis is authoritative per building.
- Preserved selected building through month navigation.
- Implementation scope remains within MVP 2-month operational window; this change improves operator usability, not fetch-window scope.

## 2026-05-29 Mobile Home — Error/Empty State Separation

- `src/lib/home.ts`: all three home data functions now return `HomeResult<T>` instead of a raw value or `null`.
  - `HomeResult<T>` = `{ status: "ok"; data: T } | { status: "empty" } | { status: "error" }`
  - Supabase `error` field is explicitly checked; DB errors no longer silently collapse to the empty state.
- `src/app/mobile/page.tsx`: rendering branches on `status` per section; error state is shown at section level only, not as an app-level throw.
- `src/lib/i18n.ts`: two i18n keys added to `mobile` namespace (ko/ja/en): `homeSectionLoadError`, `homeStatsSectionLabel`.
- Accessibility: check-in/check-out section `aria-label` corrected from single-stat label to `homeStatsSectionLabel` (neutral combined label).

`npm run lint` and `npm run build` pass.
