# Feature Batch Plan

Status: Historical approved scope; batch implemented and in active hardening
Owner: Product / Engineering  
Last updated: 2026-08-07

## Purpose

This document preserves the original Phase 14 batch plan. It is no longer the current implementation
queue: the five features are implemented. Older "deferred", "design-only", and next-action text below
records the build order at that date and is superseded by the current code, the feature documents, and
`docs/planning/06-current-status.md`.

Use it before coding starts when 2-3 upcoming features must be compared, scoped, prioritized, and broken into implementation slices.

This file should be updated first, then implementation should begin only after the target slice is clear.

## Current Batch Summary

| Feature | Status | Priority | Primary Surface | Main Dependency | Recommended Next Action |
|---|---|---:|---|---|---|
| Linen Defect Registration | Implemented | High | Mobile + Admin | Building-specific item master remains optional refinement | Harden from operational feedback |
| Personal Todo / Shared Task Inbox | Implemented | High | Mobile + Admin | Shared recurrence/project/task model | Harden mobile/admin parity |
| Staff Suggestions / Feedback Box | Implemented | Medium-High | Mobile | Participant visibility model | Preserve participant-only permissions |
| Internal Board | Implemented | Medium | Mobile | Edit-route follow-up | Harden feed/detail workflow |
| Attendance / Clock-In-Out + Payroll | Implemented | High | PWA + Admin | Wi-Fi remains inactive; tax/deduction accounting out of scope | Continue rollout QA |

## Planning Rules

- Do not start coding from an undefined feature request.
- Prefer small vertical slices over broad multi-surface rewrites.
- Document permissions and edge cases before implementation.
- If a feature changes schema, RLS, or workflow behavior, update the related docs in the same cycle.
- If code and this plan diverge, update the incorrect side immediately.

## Additional Planned Extensions

### Order Request Delivery-Date Calendar Entry

This is not a new standalone feature candidate. It is an extension of the existing Order Request workflow.

Requested rule:

- the order-delivery calendar entry must be created only when `delivery_date` is explicitly entered
- this calendar usage is only for delivery-date scheduling
- no other order-request dates should create calendar entries in the baseline design

Required related docs:

- `docs/product/10-order-request-workflow.md`
- `docs/product/15-reservation-calendar.md`

### Todo Calendar Requirement

The Personal Todo / Shared Task Inbox feature must include a calendar surface.

Requested direction:

- users need a calendar view for their todo items
- the todo calendar should help users see due dates and scheduled follow-up work
- CS-heavy tasks should still support room/guest/reservation context inside the calendar-linked task detail

Required related docs:

- `docs/product/18-todo-task-workflow.md`

## Scope Change Notes

### Attendance Scope Conflict — RESOLVED 2026-06-09

The attendance / clock-in-out exclusion was **reversed and approved** on 2026-06-09. The following docs have been updated to reflect the scope change:

- `docs/product/00-product-requirements.md` (exclusion replaced with approved note)
- `docs/planning/01-decision-log.md` (2026-06-09 "Attendance / Clock-In-Out + Payroll — Scope Change (Approved)")
- `docs/planning/03-mvp-priority.md` (out-of-scope entry marked reversed)

Current result: attendance capture and the defined hourly gross-pay workflow are implemented, including
rate history, expected pay, finalization/reopen, payroll totals, and Excel/print-to-PDF exports. Taxes,
deductions, and salaried payroll accounting remain out of scope.

### Board vs Announcement Separation

The project already has a formal `Announcements` module.

The new `Internal Board` should remain a separate module with different behavior:

- Announcement = formal notice, targeted audience, read tracking, popup, more controlled publishing
- Internal Board = freer all-user posting space, lighter moderation, no required read tracking in MVP

If this distinction becomes unclear, the board should not be implemented until the product rule is tightened.

### Suggestion Box vs Board Separation

The proposed Suggestions / Feedback Box should not be merged into the Internal Board by default.

Recommended distinction:

- Internal Board = free everyday internal posting and communication
- Suggestions / Feedback Box = structured improvement ideas, complaints, process feedback, and workplace issues with stricter visibility rules and response tracking

If these two modules are merged too early, privacy and operational follow-up will become unclear.

### Todo Scope Clarification

The project already has a `Todo / Task Workflow` direction in `docs/product/18-todo-task-workflow.md`.

This batch adds a sharper rule from the 2026-06-08 request:

- default = personal/private task or memo, visible only to the owner
- optional send/share = push a task into a teammate's task list
- CS-heavy usage must support room/guest/change-request context, not only generic personal notes

The implementation should treat this as a refinement of the Todo module, not as a separate unrelated feature.

## Feature 1: Linen Defect Registration

**Status:** Approved (mobile-first detailed planning refined 2026-06-10)  
**Priority:** High  
**Target iteration:** First implementation candidate

### 1. Problem

- The linen vendor visits the sites about four times per week.
- Incoming linen may include defective items that the team must hand back.
- The office later needs a reliable internal proof that a staff member registered the return on a specific date.
- Vendor-side follow-up is not always reliable, so "we returned it" evidence matters more than a generic defect memo.
- The office also needs historical lookup by building/date/person for delivery-slip comparison.

### 2. Users and Roles

- Primary users: all active organization members who handle site operations
- Allowed roles: `owner`, `office_admin`, `cs_staff`, `field_manager`, `staff`, `part_time_staff`, `developer_super_admin`
- Special admin responsibilities:
  - office/admin-capable roles manage the linen item master
  - all users can create and read return records
  - admins can edit/delete all records
- Blocked users: suspended or removed memberships

### 3. Entry Points

- Mobile:
  - dedicated side-menu entry
  - building picker
  - building-scoped list/detail/ledger view
- Admin:
  - deferred until the wider mobile feature set is complete
- API / background:
  - none required for first slice

### 4. MVP Scope

- In scope:
  - register one building-scoped linen return record with multiple item lines
- In scope:
  - building-specific linen item selection UI direction from day one
- In scope:
  - all users can create and read records inside their organization
- In scope:
  - latest-first building list
- In scope:
  - building-specific ledger/statistics screen with current-month default and custom date range
  - record view + item summary view
  - author edit/delete + admin full edit/delete

### 5. Out of Scope

- Deferred:
  - vendor settlement / cost-claim workflow
- Deferred:
  - automatic inventory deduction or stock reconciliation
- Deferred:
  - replacement tracking / receipt confirmation
- Deferred:
  - admin web surface

### 6. Workflow

1. User enters the dedicated mobile side-menu entry.
2. User chooses a building from a searchable card-grid picker.
3. User opens that building's latest-first return list.
4. User taps the fixed FAB to create a return record.
5. User adds one or more linen item lines for that building.
6. Each line uses one item + one integer quantity; duplicate items inside the same record are blocked.
7. User optionally adds note and photos.
8. System auto-fills registered user and registered date/time.
9. Save success shows a completion-focused motion, then returns the user to the same building list.
10. All organization users can later view the building list, detail view, and ledger/statistics screen.

### 7. Data and Technical Impact

- Tables affected:
  - new linen return header table
  - new linen return line-item table
  - new `linen_items`
- New schema needed:
  - building-linked linen item master
  - one header record per return event
  - one or more child lines per return event
- Server actions / routes:
  - create record
  - update record
  - delete record
  - building list/detail queries
  - ledger/statistics queries
- Shared components:
  - image upload pattern can likely reuse the existing request/announcement direct-upload flow
  - building picker pattern can reuse the existing mobile calendar building-entry direction
- Permissions / RLS impact:
  - all active org members can insert/select all organization records
  - authors can update/delete their own records
  - admin-capable roles can update/delete all records
  - admin-capable roles manage the linen item master
- Notification impact:
  - not required for the baseline slice

### 8. Risks and Open Questions

- Risk:
  - if the item master is skipped too long, the feature will drift into inconsistent naming
- Risk:
  - the final dropdown/master data is deferred, so design must not regress into free-text item input
- Clarified:
  - one record = one building + multiple item lines
  - not a flat one-row-per-item model
- Clarified:
  - status workflow is intentionally absent in the first slice
- Clarified:
  - note/reason is one optional free-text field; no reason enum in v1

### 9. Recommended Implementation Slice

1. Finalize product planning around the mobile-first return-ledger model.
2. Design the first 5 screens:
   - building picker
   - building list
   - create record
   - detail
   - ledger/statistics
3. Confirm technical schema as header + line items + item master.
4. Implement the mobile slice only.
5. Add admin web later after the broader mobile set is complete.

### 10. Verification Checklist

- [ ] Mobile create flow verified
- [ ] Mobile list/detail verified
- [ ] Mobile ledger/statistics verified
- [ ] All-role read access verified
- [ ] Author/admin edit-delete rules verified
- [ ] Building-specific item filtering verified
- [ ] Korean/Japanese/English copy verified
- [ ] Empty/error states verified
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test` when shared logic or i18n changes

## Feature 2: Internal Board

**Status:** Approved (confirmed 2026-06-09; part-time write permission approved)  
**Priority:** Medium  
**Target iteration:** Second implementation candidate

### 1. Problem

- The team needs a shared place where all users can write and read operational posts.
- Existing announcements are more formal and currently do not allow part-time staff to create posts.
- A lighter internal posting space is needed for everyday communication that does not belong in requests or announcements.

### 2. Users and Roles

- Primary users: all active organization members
- Allowed roles: all active roles including `part_time_staff`
- Special admin responsibilities:
  - admin-capable roles can moderate, pin, archive, or hide problematic posts
- Blocked users: suspended or removed memberships

### 3. Entry Points

- Mobile:
  - board list
  - board detail
  - create post
- Admin:
  - board list/detail
  - moderation controls
- API / background:
  - none required for first slice

### 4. MVP Scope

- In scope:
  - all users can create a board post
- In scope:
  - all users can read board posts in their organization
- In scope:
  - basic fields: title, body, optional images, author, created_at
- In scope:
  - own-post edit/delete and admin moderation
- In scope:
  - simple sort order such as newest first, optional pinned posts by admin-capable roles

### 5. Out of Scope

- Deferred:
  - read tracking
- Deferred:
  - popup on app open
- Deferred:
  - audience targeting by role/property
- Deferred:
  - approval flow before publish
- Deferred:
  - rich reactions, mentions, or threaded comments

### 6. Workflow

1. User opens the board surface.
2. User creates a post with title/body and optional images.
3. System validates organization membership and attachment ownership.
4. System stores the post and shows it in the organization board feed.
5. User can open detail and edit/delete if they own the post.
6. Admin-capable roles can pin or moderate posts if needed.

### 7. Data and Technical Impact

- Tables affected:
  - new `board_posts`
- New schema needed:
  - organization, author, title, body, image_urls or attachment relation, pinned flag, archived_at, timestamps
- Server actions / routes:
  - create
  - update
  - delete
  - list/detail
  - admin moderation actions
- Shared components:
  - announcement image uploader/grid may be reusable
  - card/list/detail patterns from announcements can reduce implementation cost
- Permissions / RLS impact:
  - all active org members can select/insert posts
  - owners of a post can update/delete their own post
  - admin-capable roles can moderate broader content
- Notification impact:
  - not required for the baseline slice

### 8. Risks and Open Questions

- Risk:
  - if board and announcement rules overlap too much, users will not know where to post
- Risk:
  - if comments are included too early, the scope expands quickly toward a mini social feed
- Open question:
  - should board posts support comments in v1, or should create/read stay the only baseline?
- Open question:
  - should posts be categorized (`general`, `property_note`, `handover`, `incident`, `other`)?
- Open question:
  - should pinned posts be admin-only or also available to all authors for their own posts?

### 9. Recommended Implementation Slice

1. Confirm the product distinction between Board and Announcements.
2. Add `board_posts` schema + RLS + types.
3. Build mobile-first list/detail/create flow.
4. Add admin moderation/pin/archive controls.
5. Verify author permissions, all-user visibility, and image handling.
6. Reconcile docs after the first real usage feedback.

### 10. Verification Checklist

- [ ] Mobile list/detail/create verified
- [ ] Admin moderation verified
- [ ] All-user create/read access verified
- [ ] Own-post edit/delete verified
- [ ] Korean/Japanese/English copy verified
- [ ] Empty/error states verified
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test` when shared logic or i18n changes

## Feature 3: Personal Todo / Shared Task Inbox

**Status:** Approved (mobile-first detailed planning refined 2026-06-10)  
**Priority:** High  
**Target iteration:** Second implementation candidate

### 1. Problem

- Each user needs a personal place to store tasks, reminders, and operational notes.
- The center of gravity is personal task management first, not team assignment first.
- Users still need strong shared-task behavior once a task is shared.
- CS-heavy operations need richer context than a generic todo list because guest requests, room changes, and exception handling change frequently.
- The product needs a Todoist-like mobile workspace. The current implemented IA is Today / Tomorrow / Inbox(관리함) / Sent(공유함) / Completed(완료/기록) / Calendar (six tabs); Completed tab was added on 2026-06-13 with complete/reopen and daily report. Older planning references to now-removed extra tabs are obsolete.

### 2. Users and Roles

- Primary users: all active organization members
- Allowed roles: all active roles including `part_time_staff`
- Special usage emphasis:
  - `cs_staff` needs property/room/guest/reservation-linked follow-up
  - all users need fast personal memo/task capture
- Blocked users: suspended or removed memberships

### 3. Entry Points

- Mobile:
  - dedicated side-menu entry
  - Today / Tomorrow / Inbox / Sent / Completed / Calendar views
  - quick-add
  - detailed create/edit
  - task detail
  - participant picker / share flow
- Admin:
  - deferred until the wider mobile feature set is complete
- API / background:
  - notifications later in the implementation plan, but product-wise required

### 4. MVP Scope

- In scope:
  - private-by-default personal task storage
- In scope:
  - quick-add to Inbox with title-only capture
- In scope:
  - detailed create/edit with title, description, scheduled date, due date, share recipients
- In scope:
  - task calendar view for due dates and scheduled follow-up work
- In scope:
  - optional property/building, room, guest, or reservation context
- In scope:
  - private -> shared conversion and shared -> private return
- In scope:
  - one shared task with common status/completion across participants
  - original author owns core content; participants operate shared workflow state
  - unified update-log with optional images
  - optional task-level images (max 5) and update-log images (max 5)
  - simple recurrence support

### 5. Out of Scope

- Deferred:
  - complex subtasks
- Deferred:
  - advanced recurrence exceptions/end rules
- Deferred:
  - admin web surface
- Deferred:
  - advanced automation rules or natural-language date parsing
- Deferred:
  - separate rich chat/thread model apart from unified update-log

### 6. Workflow

1. User enters the Todo feature from the side menu or a bottom-bar custom slot.
2. Default first view is Today; Tomorrow, Inbox, Sent, Completed, and Calendar are available as internal top-level views.
3. Quick-add creates a title-only Inbox task.
4. Detailed create/edit can fill title, description, scheduled date, due date, share recipients, and more fields.
5. A task starts private by default.
6. The author can later add one or more participants, turning it into a shared task.
7. Once shared, all participants see the same shared status and completion state.
8. Only the original author can edit core content; any participant can update workflow state and add update-log entries.
9. If all participants are removed, the task becomes private again.
10. If the original author leaves/deletes, the task is deleted for everyone.

### 7. Data and Technical Impact

- Tables affected:
  - new `tasks`
  - new `task_participants`
  - new `task_updates`
- New schema needed:
  - private/shared task record with Inbox + recurrence + date fields
  - participant relation set
  - unified update-log table
- Server actions / routes:
  - quick add
  - create task
  - update core task
  - set status / complete / reopen
  - move in/out of Inbox
  - share with users
  - remove participants
  - delete task
  - add update entry
  - list Today / Tomorrow / Inbox / Sent / Completed / Calendar
- Shared components:
  - room/property selectors
  - optional reservation linking later
  - existing bottom-sheet and list-card patterns may be reusable
- Permissions / RLS impact:
  - private tasks must not leak across users by default
  - shared tasks must be visible only to active participants
  - original author retains core edit power
  - participants can mutate common workflow state only
- Notification impact:
  - all major task notifications are product-required: shared with me, edited, update added, due soon, overdue, completed

### 8. Risks and Open Questions

- Risk:
  - if privacy rules are vague, personal notes may leak to other team members
- Risk:
  - if the implementation accidentally reverts to recipient-copy semantics, product behavior will diverge badly
- Clarified:
  - shared tasks use one common status and one common completion state
- Clarified:
  - quick-add goes to Inbox; detailed create can fully expand the task
- Clarified:
  - recurring work scheduler remains a separate module

### 9. Recommended Implementation Slice

1. Finalize product planning around the private-first but shared-capable task workspace.
2. Design the core mobile views:
   - Today
   - Tomorrow
   - Inbox
   - Sent By Me
   - Completed (완료/기록)
   - Calendar
   - quick add
   - detailed create/edit
   - task detail
   - share picker
3. Confirm technical schema as `tasks + task_participants + task_updates`.
4. Implement the mobile slice only.
5. Add admin web later after the broader mobile set is complete.

### 10. Verification Checklist

- [ ] Private task visibility verified
- [ ] Shared task common-status behavior verified
- [ ] Original-author core edit rules verified
- [ ] Participant workflow-state update rules verified
- [ ] Inbox behavior verified
- [ ] Task calendar view verified
- [ ] Share / remove-participant / delete rules verified
- [ ] Korean/Japanese/English copy verified
- [ ] Empty/error states verified
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test` when shared logic or i18n changes

## Feature 4: Staff Suggestions / Feedback Box

**Status:** Approved (confirmed 2026-06-09; scope refined 2026-06-16)  
**Priority:** Medium-High  
**Target iteration:** Third implementation candidate

### 1. Problem

- Staff and part-time workers need a safe place to send improvement ideas, complaints, and operational feedback to one specific person.
- The company needs shared visibility only for explicitly included participants, not for the whole organization.
- A free-form board is not enough because these items need ownership, privacy, status tracking, and discussion history.

### 2. Users and Roles

- Primary users: all active organization members, including `part_time_staff`
- Allowed submitters: all active roles
- Required recipient:
  - one active member in the same organization
- Optional referenced users:
  - zero or more active members in the same organization
- Blocked users: suspended or removed memberships

### 3. Entry Points

- Mobile:
  - sent / received / referenced lists
  - create suggestion
  - detail thread
- Admin:
  - optional mirror of the same thread views later
- API / background:
  - participant notifications

### 4. MVP Scope

- In scope:
  - create suggestion with one required recipient, optional referenced users, title, body, optional free-text category, optional property/building tag, optional room tag, and photos
- In scope:
  - read visibility limited to author + recipient + referenced users
- In scope:
  - status tracking: `submitted`, `reviewing`, `on_hold`, `completed`
- In scope:
  - participant comment thread
- In scope:
  - recipient-only status change
- In scope:
  - author edit/delete only while `submitted`
- In scope:
  - hold reason required for `on_hold`, completion note required for `completed`
- In scope:
  - notifications for create / reference / status / comment

### 5. Out of Scope

- Deferred:
  - fully anonymous submission
- Deferred:
  - voting / upvote ranking
- Deferred:
  - reactions
- Deferred:
  - non-photo attachments
- Deferred:
  - broad organization-wide visibility
- Deferred:
  - automatic escalation workflow

### 6. Workflow

1. Author opens the suggestion box.
2. Author chooses one required recipient.
3. Author optionally adds referenced users.
4. Author writes the suggestion and optional context tags/photos.
5. System stores the suggestion with status `submitted`.
6. Recipient and referenced users are notified.
7. Visible participants discuss in comments.
8. Recipient updates status when needed.
9. Author tracks progress from the Sent list.

### 7. Data and Technical Impact

- Tables affected:
  - new `staff_suggestions`
  - new `staff_suggestion_references`
  - new `staff_suggestion_comments`
- New schema needed:
  - organization, author, recipient, references, title/body, free-text category, status, required hold/completion notes, property/room context, main photos, comment photos
- Server actions / routes:
  - create suggestion
  - sent / received / referenced list queries
  - update suggestion before status leaves `submitted`
  - recipient status update
  - comment create / update / delete
  - delete own suggestion within allowed rules
- Shared components:
  - card/list/detail patterns from announcements or board can be reused
  - photo upload pattern can reuse existing request/task image policy
- Permissions / RLS impact:
  - only author / recipient / referenced users can read
  - only recipient can change status
  - referenced users can read/comment only
  - author can edit/delete main suggestion only while `submitted`
  - comment edit/delete is comment-author only
- Notification impact:
  - notify participant targets for create / reference / status / comment when user notification settings allow

### 8. Risks and Open Questions

- Risk:
  - if "private" is defined too loosely, sensitive feedback may leak to the wrong audience
- Risk:
  - if recipient-only status ownership is not enforced server-side, accountability becomes ambiguous
- Clarified:
  - one recipient is mandatory
- Clarified:
  - referenced users are visibility-sharing participants only
- Clarified:
  - comments stay available even after `on_hold` or `completed`
- Open question:
  - should there be a separate category for harassment / workplace conflict that bypasses normal visibility?

### 9. Recommended Implementation Slice

1. Add a structured `staff_suggestions` schema + RLS.
2. Build mobile sent / received / referenced list flow.
3. Add detail thread with comments and photo attachments.
4. Enforce recipient-only status controls + required hold/completion notes.
5. Verify participant-only visibility boundaries.
6. Reconcile docs after first internal usage feedback.

### 10. Verification Checklist

- [ ] Author / recipient / referenced visibility verified
- [ ] Non-participant access blocked
- [ ] Recipient-only status control verified
- [ ] Author main-body edit/delete lock after `submitted` verified
- [ ] Comment author-only edit/delete verified
- [ ] Required hold/completion note validation verified
- [ ] Korean/Japanese/English copy verified
- [ ] Empty/error states verified
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test` when shared logic or i18n changes

## Feature 5: Attendance / Clock-In-Out + Payroll

**Status:** Approved (attendance capture only; payroll calculation deferred until wage rules are defined — confirmed 2026-06-09)  
**Priority:** High  
**Target iteration:** Discovery first, implementation later

### 1. Problem

- The team wants to replace a paper timecard workflow currently used in Japan.
- The first delivery target is PWA, not a store-distributed native app.
- Clock-in/out must work across changing work locations.
- QR codes will be printed on-site and should remain stable.
- The long-term direction includes stronger location verification such as GPS now and Wi-Fi + GPS later.
- Part-time workers need automatic pay calculation and export.
- Salaried staff still need attendance logging, but not hourly payroll calculation.
- Managers need to control role type and hourly rate without hardcoding.

### 2. Users and Roles

- Primary users:
  - `staff`, `part_time_staff`, `field_manager`, and operational users who need attendance logging
- Allowed attendance users:
  - all active organization members unless explicitly disabled
- Payroll-specific users:
  - hourly workers only
- Admin responsibilities:
  - `owner`, `office_admin`, `cs_staff`, and possibly `field_manager` view logs, manage sites, manage employment type, manage hourly rate rules, and export attendance/payroll data
- Special role rule:
  - salaried employees can use attendance but are excluded from hourly wage calculation

### 3. Entry Points

- Mobile / PWA:
  - scan QR
  - request geolocation
  - clock in / clock out
  - view own daily/monthly records
- Admin:
  - site master and QR management
  - worker employment type and hourly-rate settings
  - attendance log review
  - correction and export screen
- API / background:
  - payroll aggregation jobs may be required later

### 4. MVP Scope

- In scope:
  - site master with stable QR codes per workplace/location
- In scope:
  - PWA QR scan + GPS capture for clock-in and clock-out
- In scope:
  - attendance logs with immutable captured proof fields (site, QR, GPS, timestamp, device/browser metadata if needed)
- In scope:
  - admin-managed employment type per user (`hourly` vs `salaried`)
- In scope:
  - admin-managed hourly rate configuration with effective dates for hourly workers
- In scope:
  - monthly payroll calculation for hourly workers only
- In scope:
  - basic export once the required sheet shape is known

### 5. Out of Scope

- Deferred:
  - Wi-Fi validation until later native/app-assisted phase or a later PWA enhancement
- Deferred:
  - final Excel export shape before the real sheet template is supplied
- Deferred:
  - salaried payroll calculation
- Deferred:
  - advanced labor-rule engine (night differential, overtime policy variants, tax/social insurance handling) unless specifically defined
- Deferred:
  - biometric verification

### 6. Workflow

1. Admin creates a workplace/site record and assigns a stable QR token.
2. QR code is printed and fixed at the site.
3. Worker opens the PWA, scans the site QR, and grants GPS access.
4. System validates the QR token and stores the attendance proof with timestamp and coordinates.
5. Worker repeats the same flow for clock-out.
6. Admin reviews daily/monthly logs.
7. For hourly workers, the system calculates payable time using configured wage rules.
8. Admin exports the monthly result once the required template is available.

### 7. Data and Technical Impact

- Tables affected (implemented Step 1, 2026-06-17 — session-first model, migration `202606170001`; see `docs/engineering/11`):
  - new `attendance_sites`
  - new `attendance_qr_tokens`
  - new `attendance_sessions` (+ `attendance_breaks`, `attendance_attempt_logs`) — session-first, replaces the earlier loose `attendance_logs`/`employment_profiles` sketch
  - new `attendance_correction_requests` + `attendance_session_audits`
  - new `employment_type_history` + `hourly_rate_history`
  - new `attendance_month_snapshots` + `attendance_export_logs`
- New schema needed:
  - site/location master
  - immutable attendance event records
  - employment type and hourly-rate history
  - payroll summary structure for hourly workers
- Server actions / routes:
  - QR validation and clock event creation
  - admin site/worker/rate management
  - monthly calculation
  - export endpoint
- Shared components:
  - camera/QR scanner surface
  - current user/session/profile infrastructure
  - export helper utilities
- Permissions / RLS impact:
  - users can read their own attendance logs
  - admins can read broader org attendance/payroll data
  - only authorized roles can manage rates and exports
- Notification impact:
  - optional later reminders for missing clock-out or shift anomalies

### 8. Risks and Open Questions

- Risk:
  - this feature directly affects compensation, so unclear rules will create financial and trust risk
- Risk:
  - PWA camera/geolocation behavior differs by browser and device; QR/GPS reliability needs real-device QA
- Risk:
  - current project docs explicitly exclude attendance/payroll from first MVP, so this is a scope decision change
- Risk:
  - a static printed QR code must be stable, but if it is too simple it may be easy to misuse off-site without stronger validation
- Open question:
  - what are the exact pay rules for breaks, rounding, lateness, overtime, overnight shifts, and holiday treatment?
- Open question:
  - do workers need one active clock-in session per organization or per site?
- Open question:
  - what is the payroll cutoff period: monthly calendar month or a custom closing date?
- Open question:
  - what corrections are allowed after submission, and who can approve them?
- Open question:
  - should `field_manager` be allowed to edit attendance records or only request corrections?
- Open question:
  - can one worker clock into different sites on the same day, and how should pay be split?

### 9. Recommended Implementation Slice

1. Do not start with payroll code.
2. First write a dedicated attendance/payroll product spec covering site rules, QR rules, GPS policy, pay rules, cutoff rules, correction rules, and export requirements.
3. Implement attendance capture first:
   - site master
   - stable QR issuance
   - PWA QR scan + GPS clock-in/out
   - own-history and admin log review
4. Implement employment type and hourly-rate management second.
5. Implement payroll calculation third, after rule confirmation.
6. Implement final export last, after the real sheet template is provided.

### 10. Verification Checklist

- [ ] Real-device PWA QR scan verified on iPhone
- [ ] Real-device PWA QR scan verified on Android
- [ ] Geolocation permission and failure states verified
- [ ] Stable QR validation verified
- [ ] Own-history visibility verified
- [ ] Admin rate management verified
- [ ] Hourly-vs-salaried branching verified
- [ ] Payroll calculation verified against sample cases
- [ ] Export verified against the real target sheet
- [ ] Korean/Japanese/English copy verified
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test` when shared logic or i18n changes

## Active Batch

### Selected Order

1. Linen Defect Registration
2. Personal Todo / Shared Task Inbox
3. Staff Suggestions / Feedback Box
4. Internal Board
5. Attendance / Clock-In-Out + Payroll (discovery/spec first, implementation later)

### Why This Order

- Linen Defect Registration is operationally concrete, narrow enough for a first build slice, and has a visible day-to-day workflow.
- Personal Todo / Shared Task Inbox has broad day-to-day value across all roles and extends an already-documented product direction.
- Staff Suggestions / Feedback Box adds structured feedback with privacy rules and avoids overloading the Board with sensitive workplace feedback.
- Internal Board is useful but still needs one clear rule: how it differs from Announcements.
- Attendance / Payroll is high-value but much larger and more sensitive; compensation logic must not start from vague assumptions.

### First Slice To Implement

- Feature:
  - Linen Defect Registration
- Scope boundary:
  - property-scoped linen item master + create/list/detail baseline
  - no vendor settlement, no analytics, no inventory sync in the first slice
- Must-update docs before coding:
  - `docs/product/02-feature-map.md`
  - `docs/product/19-linen-defect-workflow.md`
  - `docs/engineering/04-data-model.md`
  - `docs/engineering/05-rls-permissions.md`
  - `docs/engineering/06-implementation-plan.md`
  - `docs/engineering/08-linen-defect-technical-design.md`
- Verification minimum:
  - mobile create flow
  - all-user read access
  - admin catalog management
  - i18n coverage
