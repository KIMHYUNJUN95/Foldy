# Feature Map

## Core Modules

### 1. Dashboard

Purpose:

- Show today's operational status at a glance.
- Act as the full desktop operations console, not a read-only summary board.

Possible widgets:

- New tasks
- Urgent tasks
- Overdue tasks
- Lost items pending return
- Maintenance in progress
- Order requests waiting approval
- Inventory alerts
- Today's schedules
- Unread announcements

Confirmed admin direction (2026-06-29):

- the dashboard must support operation, management, and correction workflows
- major mobile modules should also be usable from the dashboard
- physical-device exceptions are allowed only when desktop hardware cannot realistically perform the action

### 2. Todoist and Tasks

Purpose:

- Manage daily internal work and CS follow-up memory across office staff, on-site staff, and part-time staff.
- Especially help CS remember guest-related promises, room-specific notes, special handling, and follow-up tasks.

Key features:

- Quick add to Inbox
- Detailed task create/edit
- Private-by-default task
- Share with multiple participants
- Today / Tomorrow / Inbox / Sent / Completed(완료/기록) / Calendar views
- Mark complete / reopen (status-circle tap with undo toast); Completed tab groups by completion day
- Daily report (업무일지) from a day's completed tasks — auto-formatted (free, no AI), editable +
  copyable, **staff-only** (role != part_time_staff, or individually granted via
  `profiles.can_generate_report`)
- Scheduled date + due date
- Simple recurrence
- Unified update-log
- Attach up to 5 photos on task + up to 5 on updates
- Link to property/room
- Link to guest/reservation
- Reminder and task activity notifications (shared / update / completed / due-soon / overdue)

### 3. Announcements

Purpose:

- Share important company notices and operational updates.

Key features:

- Create announcement
- Target by role or property
- Target everyone
- Mark as important
- Pin announcement
- Track who has read it
- Comments
- Up to 5 images
- Optional app-open popup

### 4. Internal Board

Purpose:

- Provide a shared space for internal operational posts that are not formal tasks.

Examples:

- Policy updates
- Incident notes
- Property notes
- Team communication

Permissions: **all active roles including Part-Time Staff can create posts** (confirmed 2026-06-09) — unlike Announcements, where part-time staff cannot create. See `docs/product/23-board-workflow.md`.

### 4A. Customer Complaints

Purpose:

- Record guest complaints coming from OTA reviews, direct guest contact, and CS intake.

Key features:

- Complaint registration
- Building / room / reservation linking
- Platform / review channel tracking
- Severity classification
- Status management
- Assignee and follow-up tracking
- Internal memo / comment thread
- Screenshot / photo attachment

### 5. Todoist Admin Console

Purpose:

- Provide the desktop management surface for the same Todoist/task workspace used on mobile.
- Give office/admin staff a larger-screen way to monitor shared work, projects, and task follow-up.

Current direction:

- User-facing name is `Todoist`
- Current route may remain `/admin/recurring-work` temporarily as a legacy path
- This is not a separate end-user feature from the mobile Todoist workspace

Default stay time rules:

- Check-in: 16:00 fixed
- Check-out: 10:00 default
- Early check-out: manually entered by CS staff when guest communication changes the expected check-out time

### 5A. Attendance / Payroll / Transportation Reimbursement

Purpose:

- Record real attendance with site-bound proof
- Calculate hourly gross pay
- Collect monthly transportation reimbursement evidence in a reviewable office format

Key features:

- GPS + QR clock-in / clock-out
- Break tracking
- Own attendance history
- Own monthly pay view
- Correction / exception requests
- Monthly finalization
- Transportation reimbursement **monthly ledger**
- Per-item receipt / screenshot photo evidence (required)
- Linked or manual transport-entry creation
- Monthly total amount by user
- Privileged user-level review and org-level monthly totals
- Clean Excel export (summary + detailed sheets)

### Cleaning Workflow

Purpose:

- Let staff start, track, and complete cleaning work for rooms/properties.

Key features:

- Start cleaning
- Complete cleaning
- Cleaning timer
- Room/property assignment
- Status update
- Optional completion photo
- Notes and comments
- Total duration history
- Create linked lost item during cleaning
- Create linked maintenance issue during cleaning

### 6. Inventory

Purpose:

- Track supplies and stock needed for hotel and Airbnb operations.

Key features:

- Item list
- Current quantity
- Minimum stock level
- Location/property
- Stock adjustment history
- Reorder request

### 7. Lost and Found

Purpose:

- Track found items from discovery to storage to return.

Status candidates:

- Registered
- Stored
- Disposal scheduled
- Disposed

Automation:

- Default storage policy is generally 2 weeks.
- If no retrieval/action happens, move to disposal_scheduled after 30 days.
- After an additional TBD period, finalize as disposed/archived or delete depending on final policy.

Delete:

- Available from the request list view.
- Admin roles (owner, office_admin, cs_staff, developer_super_admin) can delete any record.
- Other roles (field_manager, staff, part_time_staff) can delete only their own records.
- Requires a confirmation modal before executing.
- Hard delete.

### 8. Maintenance

Purpose:

- Report and resolve room/property/facility issues, including things part-time staff cannot resolve themselves.

Status candidates:

- Reported
- Assigned
- In progress
- Waiting
- Completed
- Cancelled

Delete:

- Available from the request list view.
- Admin roles (owner, office_admin, cs_staff, developer_super_admin) can delete any record.
- Other roles (field_manager, staff, part_time_staff) can delete only their own records.
- Requires a confirmation modal before executing.
- Hard delete.

### 9. Order Requests

Purpose:

- Request, approve, and track hotel supplies.

Delete:

- Available from the request list view.
- Admin roles (owner, office_admin, cs_staff, developer_super_admin) can delete any record.
- Other roles (field_manager, staff, part_time_staff) can delete only their own records.
- Requires a confirmation modal before executing.
- Hard delete.

Status values (implemented DB enum `order_request_status`):

- `requested` — submitted by staff
- `approved` — approved by office-level role
- `ordered` — order placed; delivery date recorded
- `received` — item arrived (not shown as active timeline step in MVP UI)
- `closed` — rejected or cancelled

Status transition rules (server-enforced):

- `requested → approved` (approve)
- `approved → ordered` (requires delivery_date)
- any non-closed → `closed` (reject)
- direct `requested → ordered` is blocked

Notification rules:

- Approval: requester notified (planned -- not yet implemented).
- Rejection: requester notified with reason (planned -- not yet implemented).
- Ordered: requester notified with delivery date (implemented 2026-06-03; in-app only).

### 10. Notifications

Purpose:

- Make sure important operational events reach the right staff.

Notification channels:

- Push notification
- In-app notification center
- Email later if needed

### 11. Staff and Permissions

Purpose:

- Manage team access safely.

Key features:

- Invite staff
- Assign role
- Deactivate user
- Change language

### 12. Search and Filters

Purpose:

- Let staff quickly find operational records.

Search examples:

- Room number
- Item name
- Date
- Status
- Staff member
- Category

### 13. Bug Reports / Problem Reports

Status: 1차 구현 중 (2026-06-25)

Purpose:

- Let staff report problems found while using Foldy itself.

Examples:

- screen does not load
- button does nothing
- wrong data shown
- permission denied unexpectedly
- unread badge does not clear

Key features:

- all active members can submit
- private visibility between reporter and reviewers
- title + description + optional screenshots
- own history
- reviewer status update (via BottomSheet on detail screen)

Routes: `/mobile/bugs`, `/mobile/bugs/new`, `/mobile/bugs/[id]`

Reviewers (1차): `owner`, `office_admin`

See `docs/product/25-bug-report-workflow.md` + `docs/engineering/13-bug-report-technical-design.md`.

## Post-MVP Approved Batch (confirmed 2026-06-09)

These five features are the approved next build scope after the Phase 6–13 MVP. Build order: Linen Defect → Personal Todo / Shared Task Inbox → Staff Suggestions → Internal Board → Attendance/Payroll. The Todo and Internal Board entries above (#2, #4) are part of this batch. See `docs/archive/15-feature-batch-plan.md` and `docs/planning/01-decision-log.md` (2026-06-09).

### 13. Linen Defect Registration

Purpose:

- Keep a building-specific ledger proving that staff registered returned defective linen to the vendor, with later date/building/person lookup for delivery-slip comparison.

Key features:

- Building-first mobile flow: building picker -> building return list -> create/detail/ledger
- One return record = one building + multiple item lines
- Auto-filled registered user + registered date/time
- Optional note + optional photos
- Latest-first building list + separate ledger/statistics screen
- Linen item master per building (connected during implementation)
- Operational return ledger only — no automatic stock deduction, status workflow, or vendor settlement in MVP

See `docs/product/19-linen-defect-workflow.md`.

### 14. Staff Suggestions / Feedback

Purpose:

- Structured channel for staff/part-time improvement ideas, pain points, and feedback.

Key features:

- Send suggestion to one required recipient
- Optional referenced users share visibility on the same thread
- Status lifecycle: submitted → reviewing → on_hold → completed
- Participant comments with photos
- Recipient-only status ownership
- Separate from Internal Board (structured feedback vs. casual posting)

See `docs/product/22-staff-suggestions-workflow.md`.

### 15. Attendance / Clock-In-Out + Payroll

Purpose:

- PWA-first attendance replacing paper timecards, with a later path to hourly payroll.

Key features:

- On-site QR + device GPS clock-in/out
- Attendance logs per worker/site
- Employment type (hourly / salaried) + hourly rate history
- Hourly gross-pay calculation, finalization, and Excel/print-to-PDF export (implemented; taxes/deductions and salaried payroll accounting excluded)

Status: attendance capture and the defined hourly gross-pay workflow are implemented across mobile and
admin. See `docs/product/21-attendance-payroll-workflow.md`.

## External Integrations

### Beds24

Purpose:

- Sync reservation, property, room, occupancy, and availability data from the existing Beds24 channel manager.

Primary usage:

- Calendar schedule
- Guest stay visibility
- Empty room/property visibility
- Cleaning and maintenance planning

## Future Modules

- Housekeeping checklist
- Shift handover notes
- Inspection checklist
- Inventory count
- Vendor management
- Multi-property management
- Reports and analytics
- PMS integration
