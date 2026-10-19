# Attendance / Clock-In-Out / Payroll Workflow

> 2026-06-29 dashboard note:
> earlier "admin dashboard deferred" wording in this document reflects the old build order.
> The current dashboard rebuild direction is active. Treat `docs/product/05-admin-web-ia.md` as the
> source of truth for the admin attendance/payroll surface while this document continues to define the
> domain workflow, mobile flow, and payroll rules.

Status: **Implemented across mobile and admin.** Mobile provides QR/GPS clock-in/out, breaks, trusted
device flow, corrections, history, expected pay, notifications, and reminders. The admin console provides
overview, review queue, manual management, roster, employment/rate management, payroll/finalization,
transportation, annual leave, and Excel/print-to-PDF exports. Wi-Fi activation, tax/deduction accounting,
and salaried payroll remain outside the current implementation.

The dated Step 1–14 notes below are implementation history. Their statements such as "no admin
dashboard", "deferred dashboard", or "backend only" describe the state on that date and are superseded
by the current status above and the later as-built sections.

> **Step 14 (2026-06-18, final app step):** attendance **notifications** use the shared system (one
> `attendance_activity` type): admin alerts on **correction created** + **abnormal/midnight session**
> (owner / `attendance_payroll_admin` only), and the worker **18:30 open-session reminder** -> a
> once-per-Tokyo-day home prompt ("Still working?" suppresses; "Already left work" routes to correction, **no
> auto clock-out**) + a CRON_SECRET-gated scan (`/api/attendance/reminders`). In-app only (Web Push
> deferred); no admin dashboard. See `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 14" and `docs/product/14-notification-design.md`.

> **Step 13 (2026-06-18):** finalized-only payroll **export** is live (`exportMonthlyPayroll` /
> `exportUserPayroll`, owner / `attendance_payroll_admin` only): monthly bulk + per-person, **finalized
> snapshots only** (draft/reopened/superseded never included), with an `attendance_export_logs` audit row
> each. **Superseded (2026-07-03):** the operator's final **Excel workbook + PDF** export now ships from
> the admin 급여 검토 page (`/admin/attendance/payroll`) — see the "Export" section below. The original
> CSV path (`runPayrollExport` / `exportMonthlyPayroll` / `exportUserPayroll` + the dev test route)
> remains only as a legacy/back-compat foundation and is not wired into the dashboard UI. See
> `docs/engineering/11-attendance-payroll-technical-design.md` → "As-built — Step 13".

> **Step 12 (2026-06-18):** the privileged **org-wide payroll-totals data layer** is ready
> (`getPayrollTotals(org, ym)`): finalized labor total (from finalized snapshots), expected labor total
> (sum of relevant hourly workers' current expected pay), unfinalized worker count, and site-based
> totals (by clock-in site). Expected vs finalized are kept explicitly separate. **Query-only, no
> dashboard UI** (the totals dashboard is part of the deferred web dashboard); owner /
> `attendance_payroll_admin` gate enforced by the caller. See
> `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 12".

> **Step 11 (2026-06-18):** per-person **monthly finalization** + reopen is live as a privileged backend
> (`finalizeAttendanceMonth` / `reopenAttendanceMonth`, owner / `attendance_payroll_admin` only).
> Finalize is **blocked** while review-required / pending-correction / open sessions remain (or already
> finalized) — **invalidated sessions never block** (2026-10-19: invalidating is the resolution); it stores a `finalized` snapshot (paid minutes, rate breakdown, gross, finalizer, time).
> **Reopen requires a reason**, flips the snapshot to `reopened` (expected pay resumes), and **never
> destroys prior history** (superseded chain + `audit_logs`). The worker self pay screen shows the
> finalized number + finalized badge when finalized. The admin attendance/payroll console is now implemented. See
> `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 11".

> **Step 10 (2026-06-18):** hourly **expected** gross-pay is live with a new self monthly pay screen
> (`/mobile/attendance/pay`). Effective-date rate resolution (a rate change applies to the whole Tokyo
> day, never retroactive); usable sessions only (completed + resolved; open / review-required / pending
> correction / invalid excluded); paid minutes in 1-min units, breaks excluded, no premiums; monthly
> gross rounded **up** to the nearest 10 yen (ceiling; e.g. 93→100, 95→100). Salaried days never pay.
> **Self-only.** No finalization yet, and **no admin dashboard** (deferred). Employment/rate
> **management** (시급 설정·변경) is deferred to the **admin dashboard** (Step 9); a dev seed route
> exists for testing. See `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 10".

> **Step 8 (2026-06-17):** privileged **manual attendance** backend is live -> `createManualAttendanceSession` / `updateAttendanceSessionAdmin` / `invalidateAttendanceSession`
> (owner / `attendance_payroll_admin` only, server-enforced; **mandatory reason + audit**). Bad records
> are **invalidated, never deleted**. **No admin PC/web dashboard was built** (deferred until the app is
> done); these are the backend it will call, and manual/invalid sessions already reflect in the existing
> review-queue + worker self-history. See
> `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 8".

> **Step 7 (2026-06-17):** the admin correction-review **backend** is live -> org-wide review-queue
> query layer + approve / reject / in-review actions (owner / `attendance_payroll_admin` only,
> server-enforced). **Approve authoritatively applies** admin-confirmed final values to the session
> (defaulting to the requester's proposals) and writes an `attendance_session_audits` row; **reject
> requires a comment** and leaves the session unchanged. The **review-queue UI is built in the web
> dashboard later** (like site/QR); worker self-view reflects the outcome automatically. See
> `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 7".

> **Step 6 (2026-06-17):** correction / exception requests are live (`createAttendanceCorrectionRequest`).
> Users request corrections for **their own** records, **current or previous Tokyo month only**, with
> reason + desired times + desired site + memo + photos (optional); requests **only suggest values and never
> mutate the session** (admin confirms in Step 7). Session-linked and session-less exception requests
> are supported; status is visible to the requester and surfaced as a chip in self-history. See
> `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 6".

> **Step 5 (2026-06-17):** own attendance **history** is live at `/mobile/attendance/history` -> today
> summary + the user's own session list with per-session detail (clock-in/out, sites, methods, break
> rows, review/abnormal markers). **Self-only** (server-scoped to the authenticated user). The history
> screen is **new UI in the existing design language** (the handoff had no history frame). See
> `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 5".

> **Step 4 (2026-06-17):** break start/end is live on the home screen (`startBreak` / `endBreak`).
> Multiple breaks per session, one open break at a time, each break stored as its own row;
> **clock-out is blocked while a break is open** (the break is never auto-closed). Same for salaried and
> hourly users. See `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 4".

> **Step 3 (2026-06-17):** the worker UI is now functional for **GPS + QR clock-in / clock-out**. One
> server action (`submitAttendanceScan`) validates the QR token, resolves the site, checks GPS against
> the site radius, enforces one-open-session-per-user, creates/completes the session, and logs every
> attempt; the capture screen does in-app camera QR scan (`jsqr`) + Geolocation and the home shows the
> live open-session state. Breaks, corrections, payroll, dashboards, exports, and notifications are
> still later steps. See `docs/engineering/11-attendance-payroll-technical-design.md` -> "As-built - Step 3".

> **Build-surface note (updated 2026-06-22):** the owner-only site/QR backend shipped first, and the
> first owner-facing web bridge now exists at **/admin/settings/attendance**. The page lets an
> owner create or edit an attendance site (
ame / latitude / longitude / radius) and issue or
> reissue the active QR for that site. This is intentionally a **narrow settings surface**, not the full
> attendance admin dashboard. The original **dev-only temporary-QR tool**
> (`GET /api/dev/attendance/temp-qr`, local-dev gated) still exists for local testing. See
> `docs/engineering/11-attendance-payroll-technical-design.md` → the Step-2 follow-up note. Wi-Fi
> attendance remains modeled but inactive (`준비중`).

## Purpose
This module replaces paper-based attendance tracking and becomes the source of truth for:

- real attendance records for salaried staff
- real attendance records for hourly workers
- monthly gross wage calculation for hourly workers only

This module does **not** handle:

- staff scheduling
- tax, insurance, or deductions
- salaried payroll calculation

Scheduling is handled in another app. Foldy only handles actual attendance records and hourly gross-pay calculation.

## Scope Summary

### Included

- site-based clock-in / clock-out
- QR-based attendance for the first PWA release
- GPS proof for every successful attendance event
- break tracking
- own attendance history
- own monthly wage view for hourly workers
- correction / exception request flow
- admin review
- monthly per-person finalization
- monthly gross labor dashboard for limited admins
- Excel export

### Deferred / Limited

- `GPS + Wi-Fi` attendance is part of the long-term design, but **PWA cannot use it yet**
- in the PWA UI, Wi-Fi attendance should appear as `준비중`
- taxes, insurance, deductions, and company-side payroll processing remain outside this module

## User Model

### Salaried Staff

- use this module for attendance / work record only
- do not receive wage calculation here

### Hourly Workers

- use this module for attendance
- monthly gross pay is calculated from approved attendance data
- hourly users are typically `part_time_staff` or equivalent hourly contracts

### Privileged Admins

- `owner` (or `senior_managing_director` / 전무, treated as fully owner-equivalent org-wide since
  2026-07-13 — see `docs/planning/01-decision-log.md` → 2026-07-13)
- explicitly designated `attendance_payroll_admin`

These privileged admins can:

- review all attendance
- approve / reject correction requests
- manually create attendance sessions
- manage hourly rates and employment type history
- finalize / reopen monthly payroll snapshots
- export payroll data
- view total labor dashboards

### Owner-only Authority

Only the `owner` (or `senior_managing_director` / 전무, owner-equivalent since 2026-07-13) can manage:

- site master
- site coordinates / radius
- site Wi-Fi SSID configuration
- site QR issuance / replacement

**플랫폼 개발자(`developer_super_admin`)도 포함된다 (2026-07-31 수정).** 세션 역할은
`platformAdmin?.role ?? membership?.role` 순서로 정해지므로, 플랫폼 관리자는 같은 조직의 `owner`
멤버십을 갖고 있어도 세션 role 이 `developer_super_admin` 으로 덮인다. 그래서 `isOrgTopAdmin` 만
보던 게이트에서 **가장 권한이 높은 계정이 오히려 막혀** 근태 설정 화면에 들어가지 못했다. 해당
게이트 3곳(설정 카드 · 페이지 · 서버 액션)은 이제 `isOrgTopAdminOrPlatform()` 을 쓴다.
`isOrgTopAdmin` 자체의 의미(조직 상위 관리자)는 그대로 두었다 — 사용처가 여러 곳이라 의미를 바꾸면
다른 화면 권한까지 함께 움직인다.

## Core Operating Rules

### Session Model

- attendance is recorded as a **work session**
- one session starts at `clock in`
- one session ends at `clock out`
- a user may have only **one open session at a time**
- a user may have multiple sessions in one day, but only after closing the prior session

### Site Model

- every attendance action is tied to a registered site
- free-text locations are not allowed
- clock-in site and clock-out site may differ
- both must be registered sites
- both must be stored in the session record

### Date Boundary

- all attendance dates use `Asia/Tokyo`
- overnight work is not considered a normal operating case
- if a session crosses midnight, it becomes a review-required abnormal session
- the next day can still start a new session

## Authentication Rules

### PWA First Release

Active method:

- `GPS + QR`

Designed but not active in PWA:

- `GPS + Wi-Fi`

PWA reason:

- browser/PWA delivery should expose Wi-Fi attendance as `준비중`
- the data model should still reserve Wi-Fi method support for a later non-web or extended release

### GPS Rule

- GPS is mandatory
- every successful attendance action requires GPS
- each site has:
  - reference latitude / longitude
  - allowed radius in meters
- default allowed radius: `100m`
- per-site override allowed

If GPS is missing or denied:

- normal attendance fails
- user must use correction / exception request

### QR Rule

- each site has one active QR token at a time
- QR is printed and fixed on-site
- replacement is allowed
- reissuing a QR deactivates the previous token

### Wi-Fi Rule

- Wi-Fi is a long-term supported method in the design
- one site may hold multiple allowed SSIDs
- site SSIDs are distinct per building in the current operating assumption
- PWA release keeps Wi-Fi disabled and marked `준비중`

## Attendance UX

### Successful Clock-In / Clock-Out

On success, show immediately:

- clock-in complete / clock-out complete
- recognized site
- timestamp
- authentication method
- current open-session state
- today cumulative work time

### Failure Handling

On failure, show a specific reason such as:

- GPS permission denied
- outside allowed radius
- QR scan failed
- Wi-Fi unavailable or unsupported in current PWA release
- open break prevents clock-out
- midnight-crossing abnormal state

Then offer:

- retry
- correction / exception request

## Break Policy

### Shared Rules

- the same attendance UI is used by salaried staff and hourly workers
- break start / break end actions are available in the shared UI

### Hourly Workers

- breaks are free-form and may occur multiple times in one session
- only recorded break time is excluded from paid time
- no automatic break deduction
- if an hourly worker does not take a break, all worked time remains paid
- if a break is forgotten or overstated, correction request is used

### Strict Break Closure

- clock-out is blocked while a break is still open
- user must close the break before clocking out
- if the user closes the break late and overstates unpaid time, they can submit a correction request

### Salaried Staff

- salaried users may still record breaks for attendance history
- this module does not calculate salaried pay from those breaks

## Open Session / Missing Clock-Out Rules

- if a user forgets to clock out, the session remains abnormal
- the system does **not** auto-close the session
- the user may still start a new session the next day
- the old session becomes `review required`
- abnormal or incomplete sessions do not enter hourly pay until resolved

### 6:30 PM Reminder

- if a user still has an open work session after `18:30` Tokyo time, show one reminder that day
- choices:
  - `still working`
  - `already left work`
- `still working` keeps the session open and does not ask again that day
- `already left work` does **not** auto clock-out; it sends the user to correction / incomplete-session handling

## Correction / Exception Requests

### Who Can Request

- users may request correction for their own records only
- requestable period: current month + previous month
- older records require admin handling only

### Request Reasons

- missing clock-in
- missing clock-out
- wrong time
- wrong site
- GPS / QR / Wi-Fi authentication failure
- other

### Request Payload

Users may submit:

- desired clock-in time
- desired clock-out time
- desired clock-in site
- desired clock-out site
- memo
- optional photos, up to 5

Users cannot directly change the original record.

### Admin Resolution

- correction state:
  - `requested`
  - `in_review`
  - `approved`
  - `rejected`
- reject comment is required
- approve comment is optional
- final corrected value is always admin-confirmed, not user-self-applied

## Admin Review

### Review Priority

Admin review should surface items in this order:

1. review-required sessions
2. sessions with correction requests
3. incomplete sessions
4. normal completed sessions

### Review Filters

- all
- review required
- correction requested
- incomplete
- manually created
- not finalized this month

Additional filters:

- user name
- date range
- site

### Review Fields

Minimum row data:

- user
- date
- clock-in time / site
- clock-out time / site
- auth method
- break total
- paid duration
- status
- correction request presence

## Audit and Deletion Policy

- attendance records are never hard-deleted
- original records remain preserved
- corrections, invalidations, and superseding actions must leave an audit trail
- manager-side actions require a mandatory reason

Minimum audit history must include:

- actor
- timestamp
- before values
- after values
- reason

### Manual Admin Creation

Implemented (2026-07-10). Admins can manually enter attendance for off-site work or missed QR
clock-in/out.

- **Entry point:** `/admin/attendance/queue` (검토 큐) toolbar **"근무 추가"** → `ManualSessionModal`
  → `createManualAttendanceSession` (`src/app/admin/attendance/actions.ts`).
- **Who:** `isAttendancePayrollAdmin` — `owner` / `senior_managing_director`(전무, owner-equivalent) /
  `attendance_payroll_admin`.
- **Input:** employee, date, clock-in, clock-out (optional), **work location (free text)**, reason. For
  off-site work the free-text location replaces a registered attendance site (no site/coordinates exist).
- manual records must store:
  - `manual_created = true`
  - creator
  - creation time
  - creation reason
  - **`manual_location`** — the free-text work location (`attendance_sessions.manual_location`, migration
    `202607100004`); also surfaced as a "근무 위치" column in the per-user payroll export.

Manual records follow the same correction, review, payroll, snapshot, and export rules as normal records.
A manually-entered work day still receives applicable pay allowances (e.g. `daily_fixed`) even when it
has no QR clock-in/out session.

## Employment Type and Rate Rules

### Employment Type

- employment type is not inferred only from role
- it is stored per person and managed by privileged admins
- recommended values:
  - `hourly`
  - `salaried`

### Employment Type History

- employment type changes are historical
- change applies from the effective date
- past records never get reinterpreted
- the effective date applies to the whole day

### Hourly Rate

- hourly rate differs per person
- rate changes are historical
- past records never change
- a rate change applies from the effective date
- the effective date applies to the whole day

## Hourly Pay Calculation Rules

This module calculates **gross principal only**.

### Included

- paid work minutes
- approved corrected records
- manually created records once approved/valid

### Excluded

- taxes
- insurance
- deductions
- holiday premiums
- overtime premiums
- night premiums

### Attendance Allowances

**Status: implemented (2026-07-10, migration `202607100001`).** Managed in the 추가수당 section of
`/admin/attendance/wages`; applied allowances appear in the `/admin/attendance/payroll` side panel, the
worker's `/mobile/attendance/pay` screen, and as a separate base-wage / allowance / transport breakdown in
every monthly & per-user Excel/PDF export.

Foldy adds **attendance allowances** for busy days or short-staffed days. This is not a bonus or a
permanent hourly-rate change. It is an extra allowance applied to a specific Tokyo operating date to help
secure staff when demand is high.

Core principle:

- keep the user's base hourly rate in `hourly_rate_history`
- do not rewrite base-rate history for one-off busy days
- calculate allowances as a separate pay layer on top of recognized hourly work
- preserve applied allowance details in the finalized month snapshot

MVP allowance types:

- `daily_fixed`: a fixed extra amount paid once for a date when the worker has at least one valid paid
  session on that date
- `hourly_extra`: an extra hourly amount multiplied by the recognized paid minutes on that date

MVP targeting:

- specific Tokyo operating date
- all hourly workers, or a specific worker

Deferred targeting:

- site-specific allowance
- role-specific allowance
- time-window allowance
- work-type allowance

### Calculation Rules

- work time is tracked in 1-minute units
- hourly workers accumulate paid minutes continuously
- paid time excludes recorded break time
- only closed / resolved sessions count
- review-required, incomplete, or pending-correction records are excluded until resolved
- planned attendance allowances apply only to days that otherwise have recognized paid work
- `daily_fixed` allowances apply once per worker per date, even if the worker has multiple sessions
- `hourly_extra` allowances are calculated from recognized paid minutes for that date
- final gross amount is rounded **up** to the nearest `10 yen` (ceiling — e.g. 93→100, 95→100; not round-half).
  The ceiling applies to the **exact** sum — floating-point noise is settled first, so an exact 100.00 is 100,
  not 110 (2026-10-19)
- the same worker's sessions may not overlap in time; admin manual add / edit / restore and correction
  approval reject an overlapping range so one hour is never paid twice (2026-10-19)

Planned daily formula:

```txt
base pay = recognized paid minutes × base hourly rate
hourly allowance = recognized paid minutes × hourly_extra amount
fixed allowance = daily_fixed amount, once per worker/date
daily gross = base pay + hourly allowance + fixed allowance
```

## Monthly View for Hourly Workers

Hourly workers can see:

- current month expected pay before finalization
- finalized pay after monthly close
- cumulative paid time
- rate segments if rates changed within the month
- excluded record count
- daily breakdown:
  - sessions
  - clock-in / clock-out times
  - break total
  - paid time
  - daily gross amount
  - planned applied allowance breakdown once the allowance feature ships

They cannot see:

- other users' pay
- total labor cost

## Transportation Reimbursement

**Status: Implemented** — schema, query layer, server actions, storage policy, and the mobile statement UI are connected to real data. 상세 구현 내용은 `docs/engineering/11-attendance-payroll-technical-design.md` "As-built — Transport Reimbursement Backend (2026-06-26)" 참조.

Transportation reimbursement belongs to the same **attendance/payroll operating domain**, but it is
**not part of gross wage calculation**.

Core principle:

- wage calculation and transportation reimbursement must remain **separate totals**
- transport reimbursement is a **receipt-backed reimbursement workflow**, not a pay-rate formula
- every original record is stored **per user**, and privileged admins later review or aggregate it

### Who Uses It

- all users may submit transportation reimbursement items
- there is **no employee vs part-time evidence exemption**
- privileged admins (`owner`, `attendance_payroll_admin`) may review both specific-user detail and
  monthly organization totals

### Submission Unit

- one user has **one monthly transport report** per Tokyo month
- that monthly report contains **many transport items**
- users may add items gradually during the month or enter them later in bulk before submission
- the monthly report is the office-review unit, not the individual image

### Item Unit

- one line item represents **one reimbursable transport entry**
- multiple items may exist on the same date
- an item may be created from:
  - linked attendance / cleaning history
  - fully manual input

### Required Item Data

Every transport item must store at least:

- usage date
- amount in yen
- receipt / screenshot photo evidence
- user
- monthly report

Recommended contextual fields:

- linked attendance session when available
- building context
- room / cleaning context summary when available
- memo
- entry mode (`linked` or `manual`)

### Evidence Rule

- every transport item requires **at least 1 image**
- accepted evidence:
  - receipt photo
  - transit/payment app screenshot
- an item without image evidence may be drafted temporarily but **cannot be submitted**
- final monthly submission is blocked if any included item lacks evidence

### Linked and Manual Entry

The product must support both:

- **linked entry**
  - derive date / building / work context from attendance and cleaning history
  - works from the **selected month's existing records**, not only from same-day input
  - should auto-generate candidate rows when the user opens the monthly ledger later
  - reuse existing building / room context-linking patterns where useful
- **manual entry**
  - user directly selects the date and enters the amount later
  - required because some users record everything in bulk at month end

### Monthly Ledger UI

- the month screen must be a **list ledger**, not card-based
- users should be able to see **all entries for the month in one screen**
- the screen must show the **monthly total amount**
- worker entry point: from **Attendance Home → 바로가기 → `시급 급여` 아래 `교통비 제출` 행**
- each row should show at minimum:
  - date
  - building
  - room / cleaning summary when available
  - amount
  - evidence count
  - linked/manual indicator

### User Visibility

- each user sees only their own monthly report and items
- users do not see other users' reimbursement data

### Privileged Visibility

Only `owner` and `attendance_payroll_admin` can see:

- a specific user's monthly reimbursement detail
- a specific user's monthly total
- organization-level monthly reimbursement total
- organization-level user-by-user monthly summary

### Review Status

Recommended monthly-report states:

- `draft`
- `submitted`
- `reviewing`
- `changes_requested` (implemented, migration `202607030001`) — reviewer sends the report back for edits;
  unlike `rejected`, this status expects the user to revise and resubmit the same report/items rather
  than treating the report as closed
- `approved`
- `rejected`

Suggested edit rule:

- user may edit own report/items while `draft`
- a `changes_requested` report is editable and expected to be resubmitted
- rejected report returns to editable state for resubmission

### Dashboard Direction (implemented)

The admin dashboard supports:

- total transportation reimbursement for the selected month
- user-by-user monthly totals
- submission count / non-submission count
- review-state breakdown
- drill-down into a single user's monthly detail

### Export

Transportation reimbursement requires Excel export.

Recommended export shape:

- **summary sheet**
  - one row per user-month
  - total amount
  - item count
  - evidence completion state
  - report status
- **detail sheet**
  - one row per transport item
  - date
  - building / room summary
  - amount
  - evidence count
  - memo

Important:

- export should stay **clean and office-friendly**
- receipt images should not be embedded into every sheet cell by default
- the workbook is a reimbursement ledger; the images remain the evidence source in the app/storage
- if later needed, evidence download should be handled separately from the main workbook

## Monthly Finalization

### Finalization Unit

- finalization is done per person per month
- one problematic worker must not block all other workers

### Month Boundary

- month = `1st` through `last day`
- Tokyo operating date

### Finalization Rule

- finalization is manual only
- only `owner` and `attendance_payroll_admin` can finalize
- finalization is blocked if any of these remain:
  - review-required sessions
  - pending correction requests
  - incomplete sessions
  - reopened state

### Snapshot Rule

When finalizing a user-month, store a snapshot that includes:

- target month
- user
- total paid time
- pay by rate segment
- applied allowance breakdown once the allowance feature ships
- final gross amount
- finalizer
- finalized timestamp

When the planned allowance feature is implemented, finalized snapshots must lock the allowance result
the same way they lock the base wage result. Later allowance edits must not silently change an already
finalized user-month; the month must be reopened and re-finalized.

If reopened later:

- prior snapshot remains as superseded history
- a new snapshot is generated on re-finalization

## Dashboard and Visibility

### Default User Visibility

- users can see only their own attendance records
- hourly users can see only their own pay

### Privileged Visibility

Only `owner` and `attendance_payroll_admin` can see:

- organization-wide attendance
- other users' hourly pay
- other users' attendance allowances
- other users' transportation reimbursement detail
- transportation reimbursement monthly totals
- monthly payroll finalization queue
- monthly total labor dashboards
- export

### 출근자 명단 (Attendance Roster) — 관리자 대시보드 기능

**목적:** 당일 또는 날짜별로 실제 출근한 직원을 한눈에 파악한다.
사무실이 실제 근무 예정자를 이미 알고 있기 때문에, 예상 명단과 대조해 부정출근 여부를 즉시 감지하는 것이 핵심 목적이다.

**접근 권한:** `owner`, `attendance_payroll_admin`, `office`

**당일 실시간 명단 (Today's Live Roster):**
- 해당 Tokyo date에 clock-in 기록이 있는 직원만 표시 (출근 전 직원은 목록에 없음)
- 각 항목: 이름, 출근 시각, 사이트, 현재 상태
- 상태: **근무 중** (open) / **휴게 중** (open + open break) / **퇴근 완료** (completed, 퇴근 시각 표시) / **검토 필요** (review_required) / **무효** (invalid)
- 출근 시각 순 정렬

**날짜별 조회:**
- 날짜 피커로 과거 날을 선택해 해당 날의 출근자 명단 조회
- 미래 날짜 선택 불가

**구현 위치:** `/admin/attendance/roster` (관리자 웹 대시보드에 구현됨)
See `docs/product/05-admin-web-ia.md` → "Attendance Roster / 출근자 명단".

### Dashboard Metrics

Show both:

- finalized labor total
- expected labor total

Also show:

- number of unfinalized workers
- site-based labor totals

For first slice, site cost rollup is based on the **clock-in site**.

## Export

- monthly bulk export supported
- per-person export supported
- export includes finalized data only
- draft / reopened / unresolved records are excluded
- **Implemented (2026-07-03):** the final monthly + per-person **Excel workbook + PDF** export ships in
  the admin 급여 검토 page (`/admin/attendance/payroll`), with base wage / 추가수당 / 특별수당 / 교통비
  shown as separate columns (see `docs/engineering/11-attendance-payroll-technical-design.md` → the
  2026-07-03 as-built export sections). The earlier interim CSV path is retained only as a
  legacy/back-compat foundation, not the shipped export.
- **Implemented (2026-07-14):** the 수당(시급) management screen (`/admin/attendance/wages`) also has a
  real Excel + PDF export (`exportAttendanceWagesWorkbook` / `exportAttendanceWagesReport`), replacing a
  previously disabled placeholder button. Same `owner` / `attendance_payroll_admin` gate as the payroll
  export. Two sheets: per-staff current-rate summary, and full rate-change history. See
  `docs/product/24-attendance-workflow.md` → "수당(시급) 화면 Excel/PDF 내보내기 구현".
- Google Sheets compatibility may be added later; not scheduled

Export history must be stored:

- who exported
- when
- which month
- which finalized version set

Transportation reimbursement export should be tracked separately from wage finalization export, because
it is a reimbursement ledger rather than a payroll snapshot.

## Notifications

### Worker-facing

- one daily 18:30 open-session reminder
- correction request status updates

### Admin-facing

Notify `owner` and `attendance_payroll_admin` immediately for:

- correction / exception request created
- incomplete session created
- midnight-crossing abnormal session

Transportation reimbursement notifications are not part of the current attendance-notification slice and
should be defined separately when the reimbursement module is implemented.

## Phase Plan

### Phase A

- site master
- QR issuance / replacement
- GPS + QR attendance in PWA
- Wi-Fi method shown as `준비중`
- shared attendance UI
- own attendance history
- correction / exception requests
- admin review

### Phase B

- employment type history
- hourly rate history
- hourly expected pay
- monthly finalization snapshots
- dashboard

### Phase C

- Excel export
- Google Sheets follow-up if required
- future Wi-Fi activation in a non-PWA or expanded delivery path

## Remaining Open Items

- final Excel export template is still pending from the operator
- future Wi-Fi activation method depends on the final app delivery form beyond the current PWA


## 퇴근 미기록(`abandoned`) — as-built (2026-08-04)

**문제.** 열린 근무는 사용자당 하나인데(`attendance_sessions_one_open_per_user_idx`) 그 제약이
**날짜를 보지 않는다.** 출근 액션도 열린 세션이 있으면 무조건 거절했다. 그래서 어제 퇴근을 깜빡한
것 하나가 **오늘 현장에 나온 사람의 출근을 막았다** — 실제로 2026-07-15 출근 후 미퇴근인 세션이
20일간 그 직원의 모든 출근을 차단하고 있었다.

**원칙.** 기록이 지저분한 것보다 **현장에 나온 사람이 일을 시작하지 못하는 쪽이 훨씬 나쁘다.**
기록은 나중에 고칠 수 있지만, 출근을 못 찍으면 그날 근무 자체가 남지 않는다.
**막을 것은 마감이지 출근이 아니다.**

### 동작

| | |
| --- | --- |
| 출근 시 지난 운영일의 `open` 이 있으면 | `abandoned` 로 옮기고 **새 출근을 통과**시킨다 |
| 같은 운영일에 이미 열려 있으면 | 기존대로 거절(`open_session`) |
| `clock_out_at` | **비운 채로 둔다** |
| 급여 | 제외(`PayExcludeReason = "abandoned"`) — 0원 |
| 월 마감 | **차단한다**(`getFinalizationEligibility` 가 미해소로 셈) |

### 왜 퇴근 시각을 추정해 채우지 않는가

"아마 18시쯤 퇴근했겠지" 로 채우면 **그 값이 그대로 급여가 된다.** 근태는 돈이 걸린 기록이라
추측이 들어가면 안 된다. 비워 두면 급여 계산이 `clock_in_at`·`clock_out_at` 을 둘 다 요구하므로
자동으로 0원이 되고, 마감 차단이 사람의 정리를 강제한다.

### 해소 경로 (기존 수단 재사용, 신규 없음)

| 상황 | 처리 | 급여 |
| --- | --- | --- |
| 실제 근무였다 | 직원의 **정정 요청** 승인, 또는 관리자 `updateAttendanceSessionAdmin`(퇴근 시각 + **사유 필수**) | 시각이 채워지면 **포함** |
| 안 왔다 / 테스트였다 | `invalidateAttendanceSession` (무효 **표시**, 삭제 아님) | 제외 |

관리자 수정으로 닫히면 `status = completed`, `abandoned_at = null` 로 되돌아간다.

### 표시

- **본인** — 근태 홈에 경고 배너(`abandonedTitle` / `abandonedBody`, ko·ja·en). 날짜만 나열한다:
  몇 시에 퇴근했는지는 본인만 아는 정보라 화면에서 추정하지 않는다. 관리자만 볼 수 있게 두면
  직원은 자기 급여에서 그날이 빠진 이유를 끝까지 모른다.
- **관리자** — 기존 `issueKey = "clockout_missing"` 으로 묶인다. 목록의 `status` 는 `open` 으로
  접는다(관리자가 할 일이 동일하고, 뷰 타입에 상태를 늘리면 필터·배지·엑셀이 전부 갈라진다).

### 남은 과제

- **18:30 리마인더가 `page.tsx` 호출이라 앱을 열어야 뜬다.** 정작 잊은 사람은 앱을 안 연다.
  크론 + 푸시가 근본이지만, 알림은 개발 막바지에 전 기능 일괄로 붙이기로 한 정책에 따라 보류.
- 자동 시각 추정(근무지별 종료 시각 등)은 정책 확정 전까지 도입하지 않는다.

가드: `src/lib/__tests__/attendance-abandoned.test.ts` — 위 조건들이 여러 파일에 흩어져 있어
한 곳만 되돌려도 조용히 옛 동작으로 돌아가므로 소스를 직접 검사한다.

## 월 마감 동시 실행 · 고용형태 미설정 (2026-10-05)

- **사람 · 달마다 `finalized` 스냅샷은 하나** — DB 부분 유일 인덱스 `attendance_month_snapshots_one_finalized`
  (마이그레이션 `202610050001`). 두 관리자가 동시에 마감하면 두 번째는 `blocked`(`alreadyFinalized`)로 돌아간다.
  전에는 둘 다 들어간 뒤 서로를 `superseded` 로 바꿔 마감본이 하나도 안 남을 수 있었다.
- 이전 스냅샷 `superseded` 처리는 **마감 전에 읽어 둔 행만** 바꾸고, 실패하면 로그를 남긴다(전에는 「내 것 빼고 전부」 ·
  실패 무시).
- **고용형태 미설정**: 이 달 근무 기록이 있는데 고용형태 이력이 없는 사람은 급여 목록 · 패널에 「고용형태 미설정」 경고
  (`employmentMissing`, `payEmploymentMissing` ko/ja/en). 전에는 「—」로만 보여 급여 0 으로 조용히 빠졌다
  (2026-10-05 운영 데이터에 사무 관리자 1명 — 근무 3건). 고용형태를 넣으면 그 날짜부터 계산된다(소급 없음 — 기존 결정).
