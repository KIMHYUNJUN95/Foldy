# Attendance / Payroll Technical Design

Status: **Implemented technical contract.** The schema and Steps 1–14 have been followed by the live
mobile attendance flow and the full admin attendance/payroll/transport/annual-leave console. Dated
"deferred dashboard", "backend only", and "no UI" statements below are build-history snapshots and
are superseded by the later as-built sections and current routes under `/admin/attendance/*`.

## As-built — Step 2 (site/QR backend helpers + dev temp-QR, 2026-06-17)

## As-built — Monthly transport reimbursement export + receipt review (2026-07-03)

`/admin/attendance/transport`'s "이번 달 내보내기" toolbar (previously a disabled stub) now exports a
plain itemized ledger for the month (Excel + PDF), and receipts are reviewed in a separate desktop web
page (see "Receipt review" below) rather than from the file:

- **Excel** (`src/lib/attendance-transport-workbook.ts`, `buildTransportWorkbookBase64`) and **PDF**
  (`src/lib/attendance-transport-report.ts`, `buildTransportReportHtml`) both match the payroll
  export's **plain green accounting-ledger** template EXACTLY — same title bar (`#b6d7a8`), header
  (`#d9ead3`)/zebra/total (`#e2f0d9`) fills, solid 1px black borders, Meiryo-first font stack, and (on
  the Excel side) the same "pad to at least 50 rows" pre-printed-ledger behavior as
  `attendance-payroll-workbook.ts`. The PDF's manual "인쇄 / PDF 저장" button (no auto-triggered print
  dialog) is the same markup/CSS as `attendance-payroll-report.ts`. An earlier draft of the PDF used a
  navy/card-based style copied from a stale reference — that was a real mismatch bug, caught and fixed
  before shipping, once the two files were diffed side by side against the CURRENT payroll report
  (which had itself been unified to the green ledger look in an earlier cycle — always re-read the
  current file rather than trusting memory/summaries when a user says two exports must match exactly).
- **Server actions** (`src/app/admin/attendance/actions.ts`): `exportMonthlyTransportWorkbook(ym)` /
  `exportMonthlyTransportReport(ym)`, built on a shared `buildTransportExportItems` helper. Scope:
  every reimbursement **item** (not per-staff summary) across all staff whose report for the month has
  at least one entered item, regardless of submission status (draft/submitted/reviewing/approved/
  rejected) — each row carries a localized status label so accounting can see what's still provisional.
  Columns are exactly No / staff / date / building / status / amount — all center-aligned. (The
  "usage/context" column was dropped 2026-07-03: work detail is checked in payroll review; for
  transport only the commute building matters.)
- **The exported files are PLAIN LEDGERS — no receipt images, no links (user decision 2026-07-03).**
  An earlier iteration embedded a first-photo thumbnail (Excel + PDF) and a "원본보기" deep link, but a
  cell-sized thumbnail is unreadable and one link per item means 20 clicks / 20 tabs for a 20-day
  month. So thumbnails, the receipt/link columns, and the per-item image download were all removed from
  the export path; `buildTransportExportItems` no longer touches storage at all. Receipts now live only
  in the dedicated web review page below.
  - exceljs note (retained for future image work): `exceljs.addImage()` wants a plain `ArrayBuffer` —
    its own `index.d.ts` declares `interface Buffer extends ArrayBuffer {}` scoped to its module, NOT
    the Node.js global `Buffer`, so a Node Buffer/Uint8Array view must be sliced down to its backing
    `ArrayBuffer` (`buf.buffer.slice(byteOffset, byteOffset + byteLength)`) before assignment.

### Receipt review — desktop master-detail page (2026-07-03)

Receipts are reviewed in the web dashboard, not from the exported file. Because this is the desktop
console (not mobile), the viewer is a **master-detail** layout, not a swipe gallery:

- **Route** `src/app/admin/attendance/transport/receipt/page.tsx` — query params `?ym=&user=` (per
  staff-month). **Entry point**: a "영수증 원본 검토" button in the existing transport review panel
  (`attendance-transport-client.tsx`, shown when the staff has ≥1 item). The rest of that panel's
  UI/UX is unchanged — the button just opens this page (`target="stayops_receipt"`, a fixed window name
  so repeated opens reuse one tab). It is NOT wrapped in AdminShell — a focused reviewer meant to open
  in its own tab.
- **Component** `src/components/admin/attendance/transport-receipt-view.tsx`: a **contact-sheet grid**
  — every receipt photo of the month rendered as a captioned thumbnail (date / amount / building,
  `object-fit: cover`, `+n/N` badge for multi-photo items), plus dashed "no receipt" cards for items
  without a photo so a missing day stays visible. Clicking a thumbnail opens a **focus overlay** (large
  `object-fit: contain` image, click-to-zoom fit↔actual, ←/→ across every photo, `Esc`/backdrop to
  close, "원본 열기" to the raw signed URL). This replaced an earlier one-photo-at-a-time master-detail
  layout that left large whitespace; the grid fills the space and makes a whole month scannable at once
  while still allowing drill-in.
- **Data** `getAdminTransportReceiptsForUser(session, ym, userId, localeTag)` in `admin-attendance.ts`
  — **privileged + organization-scoped**: requires `isAttendancePayrollAdmin`; the report is fetched
  via `getTransportReport(service, session.organization.id, userId, ...)` which is `(org, user, month)`
  scoped, so another org's receipts can't be reached. All image paths resolve to 10-min signed URLs in
  one batch. Unauthenticated hits redirect to `/auth/login?next=...`; non-payroll-admins get the
  "not available" state.

## As-built — Personal payroll Excel/PDF export refinements (2026-07-03)

The admin payroll side panel's single-user Excel/PDF export now shares the same personal payroll data
shape for both formats: date, clock-in, clock-out, recognized work time, daily pay, approved transport,
cleaned rooms, and cleaning notes. Cleaned room labels are summarized through the export room rules
(`AA`, `AB`, `KK`, `T2`, with Okubo/Sky kept as stored labels) and duplicate account suffixes such as
`_2` collapse to the same visible room label through `room-label-normalization`.

The personal totals row carries `합계`/`Total`, the localized work-day label, and the work-day count in
the adjacent cells before the time/pay totals. Work days are counted from rows with positive recognized
paid minutes only; dates that only have approved transportation reimbursement are included in the sheet
but do not count as attendance days.

Cleaning notes are pulled from `cleaning_sessions.notes` for completed sessions owned by the exported
staff member in the selected month. Notes are grouped by `cleaning_date` and rendered in the new memo
column as room-summary-prefixed entries (for example, `AA501: memo`). Multiple same-day notes are joined
with ` / ` so the payroll export remains one row per operating date.

Payroll review document alignment rule (2026-07-03): `attendance-payroll-workbook.ts`,
`attendance-payroll-report.ts`, and `attendance-user-payroll-export.ts` intentionally keep the existing
green accounting-ledger layout and column set, while center-aligning all visible title, meta, table body,
and total text in both monthly and personal Excel/PDF exports.

**Original scope decision (2026-06-17, user-confirmed):** the owner-only **site master + QR management
UI would live in the WEB DASHBOARD (admin web)** and the app would be finished first. So the initial
Step 2 shipped **backend helpers first**, plus a **dev-only temporary-QR tool** so the app's attendance
flow could be tested before a dashboard existed.

- **Atomic QR issuance** — migration 202606170002_issue_attendance_qr_fn.sql adds the plpgsql
  issue_attendance_qr(p_org, p_site, p_created_by, p_token) SECURITY DEFINER function (service_role
  only): deactivates the current active token, inserts the new active one, and links
  eplaced_by_token_id — all in one transaction, so the "one active token per site" partial-unique
  guarantee always holds and the reissue audit chain is intact.
- **Backend helpers** — src/lib/attendance-sites.ts (server-only, service-role; caller-agnostic):
  reads listAttendanceSites / getAttendanceSite / getActiveQrToken / getQrTokenHistory; writes
  createAttendanceSite / updateAttendanceSite / setAttendanceSiteActive / issueAttendanceQr
  (via the RPC) / evokeAttendanceQr; generateAttendanceQrToken() makes a site-specific
  tt_<base64url> token. Every helper is **organization-scoped**. They DO NOT check the caller —
  **owner-only enforcement is the caller's responsibility** and is deferred to the web-dashboard server
  actions (ole === 'owner', server-side). Wi-Fi SSIDs are stored on the site; Wi-Fi attendance stays
  inactive.
- **Dev temp-QR tool** — GET /api/dev/attendance/temp-qr (gated by
  NODE_ENV=development + ENABLE_LOCAL_DEV_TOOLS=true + local/LAN host; 404 otherwise). Resolves the
  logged-in session's org, ensures a temp site, ensures an active QR (or ?reissue=1 to force a fresh
  one), and renders a **scannable QR** (SVG via the qrcode dependency) plus the token; ?format=json
  returns the raw data. Not owner-gated — it's a local testing tool.

**Step-2 follow-up (2026-06-22): owner-only web settings bridge shipped.** `/admin/settings/attendance`
is now the first owner-facing site/QR page. It uses the existing helper layer (no schema change) and
adds owner-enforced server actions for:

- site create/update with `name`, `latitude`, `longitude`, and `allowed_radius_meters`
- active-QR issue/reissue for the selected site
- scannable QR rendering in the admin page itself (SVG via `qrcode`)

This is intentionally **not** the full attendance dashboard: no review queue, payroll, export, or
totals UI, and no broader site-history/revoke management surface yet. The dev temp-QR route remains for
local-only testing. Still pending for the worker app (Step 3+): clock-in/out + break + correction
execution.

**Pending migrations to apply:** `202606170001_attendance_payroll.sql` + `202606170002_issue_attendance_qr_fn.sql`.

## As-built — Step 3 (GPS + QR clock-in / clock-out core, 2026-06-17)
The worker attendance UI is now FUNCTIONAL for GPS + QR clock-in and clock-out, wired into the existing
design (no redesign). Breaks, corrections, payroll, and notifications remain out of scope.

- **One server action** `submitAttendanceScan({ mode, token, latitude, longitude, accuracy, gpsError,
  userAgent })` in `src/app/mobile/attendance/actions.ts` (service-role writes; all validation
  server-side) drives both clock-in (`mode:"in"`) and clock-out (`mode:"out"`). Returns a discriminated
  result the UI maps to the result sheet: `{ ok:true, kind, siteName, atIso, timeLabel, method:"gps_qr" }`
  or `{ ok:false, reason: "gps"|"radius"|"qr"|"open_session"|"no_session"|"error", ... }`.
  - **QR**: token must resolve to an **active** `attendance_qr_tokens` row in the caller's org; the site
    is resolved through the token and must be active. Invalid/inactive -> `qr_invalid` (or
    `qr_scan_failed` when no token decoded).
  - **GPS mandatory**: missing/denied -> `gps_denied` / `gps_unavailable`. Distance to the resolved
    site is computed with **haversine**; beyond `allowed_radius_meters` -> `outside_radius` (the failure
    returns the real distance + radius for the sheet).
  - **Clock-in** enforces **one open session per user** (`open_session_exists` on violation), then
    inserts an `open` session storing Tokyo `operating_date`, `clock_in_at`, site, `method:"gps_qr"`,
    QR token ref, lat/long/accuracy, and `clock_in_device_info` (user agent).
  - **Clock-out** requires an existing open session (else fails -> recorded as `success=false`, no enum
    failure reason exists for "no open session"); completes it with the clock-out fields. **Midnight
    baseline:** if the clock-out Tokyo date differs from the session's `operating_date`, the session is flagged
    `review_state='review_required'` (no silent normalization; full midnight sweep is a later step).
  - **Every attempt** (success and each failure branch) is logged to `attendance_attempt_logs` with
    `action_type`, `method:"gps_qr"`, `success`, `failure_reason`, `resolved_site_id`, and the GPS/device
    fields. Attempt logs are the Step-3 auditability surface; session-level `attendance_session_audits`
    are for manager edits (later steps) and need no row for normal worker clock-in/out.
- **Capture UI** (`src/components/attendance/attendance-capture.tsx`) rewritten to be functional while
  preserving the design: in-app **camera QR scan** via the `jsqr` dependency (added this step) over a
  live `<video>` + canvas frame loop, device **GPS** via the Geolocation API, both sent to the action.
  The result sheet renders the real success summary or the matching failure and reuses the app's shared
  **`useSheetDragDismiss`** bottom-sheet (no attendance-specific sheet behavior). `mode` = in/out
  (`?mode=out`); Wi-Fi chip stays `준비중`.
- **Home** (`attendance-home.tsx` + `page.tsx`) now renders from REAL data via
  `getCurrentOpenSession` (`src/lib/attendance-sessions.ts`): an open session -> `Working`, with a live
  per-second elapsed timer, real site name + clock-in time, and a **Clock out** CTA linking to `/mobile/attendance/capture?mode=out`;
  no open session -> `Clock in`. `?state=` is retained only as a static design-preview override. The
  **Start break** button is unchanged (breaks are a later step).
- **Token format**: the on-site QR encodes the raw token string (as the dev temp-QR tool emits); the
  client decodes it and the server resolves the site. **i18n:** the attendance slice was wired first
  with Korean strings consistent with the design port; a dedicated ko/ja/en i18n pass was completed
  after Step 14 (see "As-built - i18n pass" below).

Still pending (Step 4+): break start/end (with clock-out-blocked-while-break-open), correction request
submit/review, own history + admin review queries, payroll (employment/rate history, expected pay,
monthly finalization, dashboard), export, notifications (incl. the 18:30 reminder), and the full
midnight-crossing sweep. Wi-Fi stays inactive.

## As-built - Step 4 (break tracking, 2026-06-17)

Break start/end is now functional for the open session, wired into the existing home design. Same logic
for salaried and hourly users (only later hourly pay excludes recorded break time).

- **Two server actions** in `src/app/mobile/attendance/actions.ts` (service-role; no form, return a
  result object):
  - `startBreak()` -> requires an open session and **no** already-open break, then inserts an
    `attendance_breaks` row with `started_at`. Fails with `no_session` / `already_on_break`.
  - `endBreak()` -> requires an open session and an open break, then sets `ended_at` on the latest open
    break. Fails with `no_session` / `no_open_break`.
  - Both `revalidatePath("/mobile/attendance")`. **Multiple breaks per session** are supported; rows are
    preserved individually (never collapsed to a single total), so later hourly pay can sum closed break
    durations and compute paid = worked - breaks.
  - Break start/end are intentionally **not** logged to `attendance_attempt_logs` -> that table's `method`
    is GPS/QR-oriented and required, and breaks involve neither; the `attendance_breaks` rows are the
    record.
- **Clock-out blocking** -> the Step-3 clock-out path now checks for an open break on the session right
  after resolving the open session; if one exists it **fails with `open_break` (logged as
  `open_break_blocks_clock_out`) and does NOT auto-close the break**. The capture result sheet renders a
  "End the break before clocking out" message. (The home also disables Clock out while on break, so this
  is defense-in-depth.)
- **Home wiring** (`attendance-home.tsx` + `attendance-sessions.ts`): `getCurrentOpenSession` now also
  returns `openBreakStartedAt` (on-break flag), `closedBreakSeconds` (sum of closed breaks), and
  `breakCount`. The page derives state: open session **with** an open break -> `On break`; open session -> `Working`; none -> `Clock in`. The `Working` state's **Start break** button calls `startBreak`; the `On break` state
  renders live (current break mm:ss, worked = elapsed - total break, running break total + break count) and
  its **End break** button calls `endBreak`; **Clock out** stays disabled while on break. Both buttons
  `router.refresh()` on success. No redesign -> same classes/structure; `?state=` previews retained.
- **States rendered for real**: no open session (`Clock in`), open + not on break (`Working`), open + on break
  (`On break`). A completed session's break history surfaces later with the history view (Step 5+); breaks
  are stored per-row now so it can.

Still pending (Step 5+): correction request submit/review, own history + admin review queries, payroll,
export, notifications, and the full midnight sweep.

## As-built - Step 5 (self-view history, 2026-06-17)

Own attendance history is now a real, **self-only** screen. The v2 design handoff had no history frame, so
this screen is **new, built in the existing `.att` design language** (user-confirmed 2026-06-17) -> not a
redesign of an existing screen.

- **Self-view query layer** `src/lib/attendance-history.ts` (server-only, service-role, **strictly
  self-scoped** -> every query filters `user_id = <authenticated user>` + org; no client-supplied target
  user, so params/query-string tampering cannot reach another user's data):
  - `getAttendanceHistory(org, userId, ym?, limit=60)` -> `AttendanceSessionView[]` (newest first by
    Tokyo `operating_date` then clock-in). When `ym` (YYYY-MM, Tokyo) is supplied, results are bounded
    to that operating month (`operating_date >= ym-01` and `< nextMonth-01`); omitted = all (capped by
    `limit`). Resolves each session's **break rows** (one batched query) and
    **site names** (one batched query); computes Tokyo time labels, closed-break total, and worked
    seconds for completed sessions (clock-in/out minus closed breaks). Exposes `status`, `reviewState`,
    `manualCreated`, and `isAbnormal` -> leaving room for a later `correctionStatus` / expected-pay /
    finalized-vs-estimated field without a rewrite.
  - `getAttendanceTodaySummary(org, userId)` -> today's (Tokyo) session count, on-open flag, worked +
    break totals (the open session's worked is computed at load; the home keeps the live ticker).
- **History screen** `/mobile/attendance/history` (`src/app/mobile/attendance/history/page.tsx` +
  `src/components/attendance/attendance-history.tsx`): same auth/org guards as the other attendance
  routes. Renders the today-summary strip + a session list (date, clock-in/out time + site, status /
  review / manual chips reusing the existing `.att` chip palette, worked + break totals). Tapping a card
  opens a **detail bottom sheet** (the app's shared `useSheetDragDismiss`) with clock-in/out details,
  methods, the **break rows**, and an abnormal/review marker. Minimal history-only CSS was appended to
  `attendance.css` (scoped under `.att`, token-based). A discreet **History** link was added to the home
  topline. No existing screen was restructured; `?state=` previews and Steps 3+ wiring are unchanged.
- **Self-only safety** is enforced server-side in the query layer (not UI hiding). Reads use the
  service client but always pin `user_id` to the session user + org.

Still pending (Step 6+): correction request submit/review, admin review queue, payroll
(employment/rate history, expected pay, monthly finalization, dashboard), export, notifications, and the
full midnight sweep. The query layer is shaped to absorb correction indicators + pay views later.

## As-built - Step 6 (correction / exception requests, 2026-06-17)

The worker correction flow is now functional, wired into the existing `/mobile/attendance/correction`
form + `/mobile/attendance/correction/status` screens (these already existed as prototypes). **Request creation only -> no admin approve/reject, no session mutation, no auto-apply** (Step 7).

- **Create action** `createAttendanceCorrectionRequest(input)` (`src/app/mobile/attendance/actions.ts`,
  service-role) inserts an `attendance_correction_requests` row (status `requested`). **Self-only +
  month-range enforced server-side:** a linked `sessionId` must be the caller's own session (else
  `forbidden`); the base date (the linked session's `operating_date`, or today for an exception request)
  must fall in the **current or previous Tokyo month** (else `out_of_range`). Reason is one of the six
  documented types; memo optional; desired clock-in/out wall times are combined with the base date into
  Tokyo instants; a single desired site applies to both in/out columns; photos
  capped at 5. The request **never touches the session** -> it only suggests values.
- **Exception path:** a request with no `sessionId` (reached from the capture failure sheets' "Correction request"
  buttons) is supported in the same model (base date = today). A non-owned `sessionId` degrades to an
  exception request rather than leaking the other user's session.
- **Photos** reuse the app's `compressImageFile` + `uploadRequestImages` (`request-images` bucket, new
  `attendance-corrections/` folder). Storage RLS migration `202606170003_attendance_correction_storage.sql`
  whitelists that folder (with the part-time carve-out, since attendance is open to all members).
  `RequestImageType` gained `attendance-corrections`.
- **Form** (`attendance-correction-form.tsx`) is now controlled: reason chips (localized labels backed by the enum), native
  time inputs for desired in/out (prefilled from the source session), a **desired-site picker** in a
  shared drag-dismiss sheet, memo, and a real photo picker (optional, compress + preview + remove). Submit
  uploads photos then calls the action and routes to the status screen. The page (`correction/page.tsx`)
  loads the optional self-scoped session context + active sites.
- **Status** (`attendance-correction-status.tsx`) is data-driven from a `CorrectionRequestView`
  (`src/lib/attendance-corrections.ts` -> `getCorrectionRequestView`, by id or latest, self-scoped):
  steps + recap (reason / desired time / site / photos / memo) + review block. All four states (requested /
  in_review / approved / rejected) render so Step 7 lights up without redesign; `review_comment` /
  reviewer are carried through already.
- **Self-history surfacing:** `getAttendanceHistory` now attaches the latest `correctionStatus` per
  session (via `getCorrectionStatusBySession`); the history cards/detail show a correction-request status
  chip, and the detail sheet offers "Session correction request" (or "View correction request status").
- **Self-only safety:** every correction read/write pins `requested_by_user_id` / session ownership to
  the authenticated user server-side; params/query-string tampering cannot reach another user's data.
- **Step-7 compatibility:** the row already carries `status` (`requested` / `in_review` / `approved` / `rejected`),
  `review_comment`, `reviewed_by_user_id`, `reviewed_at`; no value is auto-applied, so the admin review
  + authoritative-application step can be added without reshaping the data.

**Pending migration to apply:** `202606170003_attendance_correction_storage.sql` (correction-photo
storage). Still pending (Step 7+): admin review queue + approve/reject + authoritative correction
application, manual admin session create/update, payroll, export, notifications, full midnight sweep.

## As-built - Step 7 (admin review + correction approve/reject, 2026-06-17)

The admin correction-review **backend** is functional: an org-wide review-queue query layer + the
approve/reject/in-review actions with authoritative application + audit. Per the user-confirmed build
surface (2026-06-17), the **review-queue UI is built in the WEB DASHBOARD later** -> this step ships the
backend it will call. Worker self-view reflects the outcome with no UI change. **No** manual session
creation / payroll / finalization / dashboard / export / notifications here.

- **Privilege gate** `isAttendancePayrollAdmin(service, org, userId)` (`src/lib/attendance-review.ts`) =
  platform admin, OR active `owner` (or `senior_managing_director` / 전무, owner-equivalent since
  2026-07-13 — see `docs/planning/01-decision-log.md` → 2026-07-13) / `attendance_payroll_admin` member.
  Site-master management stays owner-equivalent-only (owner or 전무). Enforced server-side in every write
  action; the read query is caller-agnostic and the dashboard must gate it.
- **Review queue** `getAttendanceReviewQueue(org, params)` (caller-agnostic, org-wide): documented
  filters `all` / `review_required` / `correction_requested` / `incomplete` / `manual` /
  `not_finalized` + name search + date range + site filter; resolves worker name, date, clock-in/out
  time + site + method, break total, paid duration (completed), status / review state, correction
  status, manual marker; ordered review-required -> correction-requested -> incomplete -> normal, then
  recency. (`not_finalized` = current Tokyo month for now -> the finalized-snapshot exclusion plugs in at
  Step 8.)
- **Actions** `src/app/admin/attendance/actions.ts` (`"use server"`, service-role, all privilege-gated):
  - `setCorrectionInReview(requestId)` -> `requested` -> `in_review` (request-only; no session change).
  - `approveCorrectionRequest({ requestId, finalClockInAt?, finalClockOutAt?, finalSiteId?, comment? })`
    -> **authoritative application**: final values default to the requester's proposals but the admin can
    override; the linked session's clock-in/out times + sites are updated, a still-open session that now
    has both ends becomes `completed`, and `review_state` -> `approved_correction` (so the session no
    longer looks unresolved). An `attendance_session_audits` row (`correction_apply`, actor, reason =
    comment or "Correction request approved", before/after JSON) is written. The request is marked `approved`
    (review_comment optional, reviewer + time). Session-less (exception) requests are marked approved but
    not applied (manual session creation is Step 8).
  - `rejectCorrectionRequest(requestId, comment)` -> **comment required**; the request is marked
    `rejected` (reviewer + time + comment); the **session is left entirely unchanged** (a rejected
    proposal must not silently alter authoritative data). The rejection is auditable on the request row.
- **Coherence:** the correction request status is the lifecycle source of truth (surfaced as the
  self-history chip from Step 6). Approve resolves the session (`approved_correction` + applied values);
  reject leaves it as-is (still visible/abnormal if it was). User proposals never auto-apply.
- **Self-view reflection:** approve/reject/in-review `revalidatePath` the worker history + correction
  status + home; those dynamic routes re-read fresh, so the requester sees the new request status and
  any authoritative session change on next load -> no self-view redesign.

Still pending (Step 8+): manual admin session create/update/invalidate, payroll (employment/rate
history, expected pay, monthly finalization snapshots, dashboard), export, notifications, full midnight
sweep, and the owner-only site/QR + review-queue **web-dashboard UI**.

## As-built - Step 8 (manual admin attendance management, 2026-06-17)

Privileged manual attendance **backend** -> create / authoritatively update / invalidate sessions, each
with a mandatory reason + audit. **No admin PC/web dashboard is built** (explicit scope rule): these are
the backend the deferred web dashboard will call; there is no existing app-side privileged UI to wire
into, and no new UI was created. owner / `attendance_payroll_admin` only (server-enforced); site-master
stays owner-only.

- Actions appended to `src/app/admin/attendance/actions.ts` (`"use server"`, service-role, privilege-gated
  via `isAttendancePayrollAdmin`):
  - `createManualAttendanceSession({ userId, operatingDate, clockInTime, clockOutTime, clockInSiteId,
    clockOutSiteId, reason })` -> target must be an **active member**; sites validated against the org;
    times combine with the Tokyo `operatingDate`; `clockOutTime` present -> `completed`, else `open`
    (guarded against the one-open-session collision). Stores `manual_created = true`,
    `manual_created_by_user_id`, `manual_created_reason`, methods `manual`. Audit `manual_create`.
  - `updateAttendanceSessionAdmin({ sessionId, reason, clockInTime?, clockOutTime?, clockInSiteId?,
    clockOutSiteId?, reviewState? })` -> per-field tri-state (omit = keep, null = clear, value = set);
    sites/reviewState validated; status coherence (both ends -> `completed`; cleared end -> `open`; an
    `invalid` session is not auto-revived). Audit `manual_update` with before/after.
  - `invalidateAttendanceSession(sessionId, reason)` -> sets `status='invalid'` + `invalidated_at /
    _by_user_id / _reason`; **never hard-deletes**. Audit `invalidate`.
  - `restoreAttendanceSession(sessionId, reason)` (added 2026-07-02) -> the explicit reverse of
    invalidate: sets `status` back to `completed`, clears `invalidated_at/_by_user_id/_reason`, resets
    `review_state` to `normal`. **Both clock ends must already be present** — an invalid session still
    missing a clock-out returns `incomplete`; the admin must fill it via `updateAttendanceSessionAdmin`
    (수동 정정) first, so a restore never silently resurrects an incomplete/open session that wouldn't
    count toward pay (refined 2026-07-02 from the initial "restore to open when incomplete" behavior).
    Audit `restore` (new `action_type`, migration `202607020001_attendance_session_restore.sql` extends
    the `attendance_session_audits.action_type` check). Admin console UX: no separate button — the queue
    panel's "mark reviewed" button relabels to "restore & mark reviewed" and calls this action when the
    session is `invalid`; that button is **disabled until both clock ends exist** (tooltip directs the
    admin to 수동 정정 first).
  - All require a non-empty reason (also a DB CHECK on the audit row) and `revalidatePath` the worker
    self-view + home.
  - `loadSessionAuditTrail(sessionId)` (added 2026-07-02) — read-only, privileged viewer for the
    `attendance_session_audits` rows of one session. Resolves actor names + site names, and derives a
    human-readable before→after diff over the curated fields (clock-in/out time, clock-in/out site,
    status, review_state). Fully localized server-side (ko/ja/en via `getDictionary`) so the client
    just renders. Powers the queue session panel's "변경 내역" (change history) section — the first UI
    surface for the audit trail (previously written-only). Loaded on-demand when the panel opens and
    re-fetched after a successful manual edit.
- **Reflection (no UI change):** manual/invalidated sessions already render in the existing flows -> the
  review-queue layer (`manual` filter, `manual_created` marker, `invalid` status), and the worker's own
  history (?섎룞 chip via `manualCreated`, 臾댄슚 chip via `invalid` status). Invalidated records remain
  **historically visible** (not deleted). Manual completed sessions carry clock-in/out + (no) breaks, so
  later paid-minute / snapshot / export logic computes from them unchanged.

Still pending (Step 9+): payroll (employment/rate history management, expected pay, monthly finalization
snapshots, dashboard totals), export, notifications, full midnight sweep, and the owner-only site/QR +
review-queue + manual-management **web-dashboard UI** (deferred until the app is complete).

## As-built - Step 10 (hourly expected-pay + self monthly pay view, 2026-06-17)

Hourly **expected** (not finalized) gross-pay calculation + a new self monthly pay screen, wired to real
data. **No admin PC/web dashboard** (explicit scope rule). The pay screen is **new UI in the existing
`.att` language** (the handoff had no pay frame; user asked for an arbitrary screen to refine later).

- **Calculation layer** `src/lib/attendance-pay.ts` (server-only; pure helpers reusable by the later
  finalization/snapshot/export steps):
  - `resolveEffective(rows, date)` -> effective-date resolution (the segment covering a Tokyo date,
    latest `effective_from`); a rate/employment change applies to that **whole day**, never retroactive.
  - Pure payroll math now lives in `src/lib/attendance-pay-calculation.ts` and is covered by
    `src/lib/__tests__/attendance-pay.test.ts`: effective-date rate boundaries, overlapping rate rows,
    closed-break subtraction, exact daily gross, monthly 10-yen ceiling, and personal-export daily
    reconciliation are regression-tested.
  - `paidSecondsForSession` (worked - closed breaks, never negative), `roundToNearest10` (10-yen
    **ceiling** at the monthly final layer only).
  - **Usable session** = `completed` + both clock ends + `review_state in {normal, approved_correction}`
    + correction status not in {requested, in_review}. Excluded: open/reopened/invalid, review_required,
    pending correction. Paid minutes in **1-minute units**; breaks excluded; no premiums.
  - `getMonthlyPayView(org, userId, ym)` (self-scoped) -> month label, `expectedGross` (rounded to 10
    yen), `totalPaidMinutes`, `excludedCount` (hourly-day sessions excluded), `rateSegments` (per rate),
    and a `days[]` daily breakdown (per session in/out, break, paid minutes, daily gross, include flag +
    exclude reason). Per-day employment type decides eligibility: **salaried days never pay**;
    `salariedOnly` months return no totals.
- **Self pay screen** `/mobile/attendance/pay` (`attendance-pay.tsx`): month nav (`?ym=`), expected-gross
  hero, excluded-count warning, rate-segment breakdown (when rates changed), daily list whose rows open
  a **detail bottom sheet** (shared `useSheetDragDismiss`) with that day's sessions; salaried/empty
  states. A pay link sits next to History in the home topline. Self-only (server-scoped).
- **Real-time before finalization:** the view recomputes from current usable attendance -> completed
  sessions, break changes, approved corrections, and rate/employment history all move the number. No
  lock/snapshot here.
- **Locked finalized amount:** once a user-month has a finalized snapshot, admin payroll rows, staff
  detail, and monthly Excel/PDF exports prefer `attendance_month_snapshots.gross_amount` and
  `total_paid_minutes` over any newly recomputed expected value. This prevents later hourly-rate edits
  from changing a previously finalized payable amount.
- **Personal export reconciliation:** personal Excel/PDF rows display integer-yen daily pay. Because the
  official payable amount is rounded only at the monthly layer, the export reconciles the daily display
  rows to the official monthly payroll total (`finalization.gross` when finalized, otherwise
  `expectedGross`) by applying any rounding delta to the final paid day. The visible daily sum and the
  official total therefore cannot drift by 1 yen.
- **Rate + employment management (now built in the web dashboard):** the owner/`attendance_payroll_admin`
  hourly-rate and employment-type management is implemented at `/admin/attendance/wages`
  (`attendance-wages-client.tsx`). Hourly rate → `setHourlyRate`; employment type (시급↔정규직) →
  `setEmploymentType` (2026-07-08) — both privileged server actions in `src/app/admin/attendance/actions.ts`
  that write `hourly_rate_history` / `employment_type_history` as no-retroactive interval changes (close
  the active period at effective_from−1, delete a still-future pending row, insert the new open period),
  with an `audit_logs` entry. The 시급 관리 panel now has a "고용 형태 변경" section (시급/정규직 segmented
  control + effective date + reason) above the rate editor, available for both hourly and salaried members;
  switching type leaves the rate history untouched (pay branches on the active employment type). The
  dev-only `GET /api/dev/attendance/seed-pay` (gated by `ENABLE_LOCAL_DEV_TOOLS`) is now only a testing
  convenience, not the sole writer. Pay shows ¥0 / empty until a rate exists for an hourly member.

### As-built — attendance allowances / 추가수당 (2026-07-10)

> **Implemented (2026-07-10).** Migration `202607100001_attendance_pay_allowances.sql` (table + RLS +
> `attendance_month_snapshots.allowance_breakdown jsonb`) applied to production. Calculation in
> `src/lib/attendance-pay.ts` (+ pure helper `allowanceCalculatedExact` in
> `attendance-pay-calculation.ts`); create/cancel server actions `createAttendanceAllowance` /
> `cancelAttendanceAllowance` (`src/app/admin/attendance/actions.ts`, `isAttendancePayrollAdmin`-gated,
> finalized-month blocked); admin UI section `AttendanceAllowancesSection` on `/admin/attendance/wages`;
> applied-allowance display in the `/admin/attendance/payroll` side panel and `/mobile/attendance/pay`;
> base wage / allowance / transport shown as separate columns in every monthly & per-user Excel/PDF
> export. Snapshot `allowance_breakdown` preserves `{allowanceId, date, type, amountYen, paidMinutes,
> calculatedAmount, reasonType, memo}` per applied row at finalize time. Decisions taken during
> implementation (matching the design below): the snapshot got a **dedicated `allowance_breakdown jsonb`
> column** (not an extended `rate_breakdown`); `expectedGross` now means **base wage + allowance**
> (rounded once at the monthly layer), with `baseGross` = `expectedGross − allowanceTotal` exposed for the
> unmixed base column; allowances apply only on hourly days with recognized paid work.

> **Update (2026-07-10, migration `202607100003`):** the free `reason_type` (staff_shortage/busy_day/…)
> was replaced by a payroll **`category`** — `regular` (추가수당) or `special` (특별수당) — which decides
> the payroll column the amount lands in. The admin form field is now "구분"(Category), not "사유". The pay
> view splits the applied allowance into `allowanceRegularTotal` / `allowanceSpecialTotal` (per-day
> `allowanceRegularExact` / `allowanceSpecialExact`); `allowanceTotal` = their sum, and `baseGross` =
> `expectedGross − allowanceTotal`. Every monthly & per-user Excel/PDF export now shows **기본급 · 추가수당 ·
> 특별수당 · 교통비 · 총액** as separate columns. `hourly_extra` still keeps base wage in the base column and
> puts only the extra (추가 시급 × 인정 시간 차액) into the allowance column, now routed by category.
> Cancelling an allowance from the wage-page list (`cancelAttendanceAllowance`) restores the affected pay.
>
> **Update (2026-07-10, off-site / manual entry):** the field always has variables — off-site work and
> forgotten clock-ins. So (1) admins can enter a session by hand from the review queue
> (`ManualSessionModal` → `createManualAttendanceSession`, free-text `manual_location` instead of a
> required site; migration `202607100004`), (2) per-user Excel/PDF exports gained a **근무 위치** column
> (manual location, else the site name), and (3) `getMonthlyPayView` now applies a **`daily_fixed`
> allowance to an hourly worker even on a date with no session** (an "allowance-only day" carrying no base
> wage). `hourly_extra` still needs recognized minutes, so it only applies where a session (clocked or
> manual) exists.

The accepted design for busy-day staffing allowances follows.

Naming:

- product label: 추가수당 / Attendance allowance
- internal table candidate: `attendance_pay_allowances`
- avoid "bonus" or "incentive" language; the operational reason is staffing coverage on busy or
  short-staffed dates

Planned schema:

```txt
attendance_pay_allowances

id uuid primary key
organization_id uuid not null references organizations(id)
target_date date not null
target_user_id uuid references profiles(id) null
allowance_type text not null -- daily_fixed | hourly_extra
amount_yen numeric not null
reason_type text not null -- staff_shortage | busy_day | urgent_shift | special_work | other
memo text
status text not null default 'active' -- active | cancelled
created_by_user_id uuid not null references profiles(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
cancelled_by_user_id uuid references profiles(id)
cancelled_at timestamptz
```

MVP rules:

- `target_date` is a Tokyo operating date.
- `target_user_id is null` means all hourly workers with recognized paid work on that date.
- `target_user_id is not null` limits the allowance to that worker.
- `daily_fixed` applies once per worker/date when the worker has at least one valid paid session that
  date; multiple sessions must not multiply the fixed amount.
- `hourly_extra` applies to the recognized paid minutes for that date.
- Allowances never change `hourly_rate_history`; base rates stay the contractual/default rate layer.
- Allowance create/cancel is blocked for a user-month that already has a finalized
  `attendance_month_snapshots` row. Operators must reopen, edit allowances, then re-finalize.

Calculation integration:

- `src/lib/attendance-pay.ts` should load active allowance rows for the requested month alongside
  sessions, breaks, `hourly_rate_history`, and `employment_type_history`.
- `PayDayView` should expose both base gross and allowance gross so `/mobile/attendance/pay`,
  `/admin/attendance/payroll`, and per-user exports can show the breakdown.
- `rateSegments` should remain the base-rate segment summary; allowance breakdown should be carried in
  a separate structure to avoid mixing contractual rates with date allowances.
- Monthly rounding remains at the final gross layer after base pay and allowance amounts are summed.

Snapshot/export integration:

- `attendance_month_snapshots.rate_breakdown` currently stores the finalized rate summary. When
  allowances ship, finalized snapshots must also preserve applied allowance detail, either by extending
  the JSON shape or by adding a dedicated `allowance_breakdown jsonb` column in the same migration.
- The snapshot must include enough data to explain the finalized amount without recomputing mutable
  allowance rows later: allowance id, target date, type, amount, calculated amount, reason, and memo.
- Monthly and per-user Excel/PDF exports should show allowance amounts as separate columns/rows from
  base wage and transportation reimbursement. Transport reimbursement remains a separate total.

Admin UI integration:

- First implementation should attach allowance management to `/admin/attendance/wages` as a section in
  the existing wage-management surface.
- `/admin/attendance/payroll` should show applied allowances in the employee payroll side panel.
- A separate `/admin/attendance/allowances` tab can be considered later only if allowance volume makes
  the wage page too dense.

Still pending (Step 11+): monthly finalization snapshots + reopen, dashboard totals, export,
notifications, full midnight sweep, and the owner/admin **web-dashboard UI**. (The employment/rate
**management** backend + its 시급 관리 UI are now built — see the rate + employment management note above.)

## As-built - Step 11 (per-person monthly finalization + reopen + snapshot, 2026-06-18)

Per-person per-month finalization is now functional as a **privileged backend** (owner /
`attendance_payroll_admin`), with the worker self pay view reflecting finalized vs expected. **No admin
PC/web dashboard** (the finalize/reopen UI is in the deferred web dashboard); the only app-side change is
the worker's own pay screen showing the finalized number + badge.

- **Eligibility** `getFinalizationEligibility(org, userId, ym)` (`src/lib/attendance-finalization.ts`,
  server-side) -> finalize is **blocked** while any unresolved item remains for that user-month:
  `review_required` sessions, **pending correction requests** (requested/in_review on the month's
  sessions), **open/incomplete** sessions, or an already-finalized snapshot (must reopen first). Returns
  `{ eligible, blockers }`.
- **Finalize** `finalizeAttendanceMonth({ userId, ym })` (`src/app/admin/attendance/actions.ts`,
  privilege-gated): target must be an active member; eligibility must pass; the month must be hourly
  (`getMonthlyPayView.hourlyEligible`, else `not_hourly`). Computes the final gross from the **same
  expected-pay helpers** and inserts an `attendance_month_snapshots` row (`status='finalized'`,
  `target_month` = `YYYY-MM-01`, `total_paid_minutes`, `gross_amount` rounded to 10 yen, `rate_breakdown`
  JSON, `finalized_by_user_id`, `finalized_at`, `supersedes_snapshot_id`). Any prior non-superseded row
  for that user-month is marked `superseded` (history preserved, linked). Audited in `audit_logs`
  (`attendance_month_finalize`).
- **Reopen** `reopenAttendanceMonth({ userId, ym, reason })` (privilege-gated, **reason required**):
  flips the current `finalized` row to `reopened` (kept as history; no `finalized` row remains -> **expected pay resumes**). Prior finalized history is never destroyed; a later finalize supersedes the
  `reopened` row and links via `supersedes_snapshot_id`. Audited in `audit_logs`
  (`attendance_month_reopen`, with the reason). (Snapshot audit uses the generic `audit_logs` table -> no
  schema change, since `attendance_session_audits` is session-scoped.)
- **Snapshot lifecycle:** `draft`(unused) -> `finalized` -> (reopen) `reopened` -> (re-finalize) prior rows
  `superseded` + new `finalized`. At most one `finalized` per user-month at a time; all prior rows
  remain as history with `supersedes_snapshot_id` links -> ready for later export / total-labor dashboard
  / historical comparison.
- **Self-view reflection:** `getMonthlyPayView` now also reads the current `finalized` snapshot and
  returns a `finalization` block; the pay screen shows the **locked finalized gross + a finalized badge +
  finalized time** when present (hiding the excluded-count warning), and reverts to expected pay after a
  reopen -> no self-view redesign.

Still pending (Step 12+): org-wide total-labor **dashboard**, **export** generation (finalized data
only, `attendance_export_logs`), **notifications** (18:30 reminder, correction/finalize outcomes), full
midnight sweep, the employment/rate **management** backend (Step 9), and the owner/admin **web-dashboard
UI** (deferred until the app is complete).

## As-built - Step 12 (privileged payroll totals data layer, 2026-06-18)

The org-wide payroll-totals **data layer** only -> **no dashboard UI, no pages, no charts/cards, no admin
web route** (explicit scope rule). No existing app screen expects org-wide totals, so this step is
backend/query-only; the future web dashboard (and export) consume it.

- `getPayrollTotals(org, ym)` (`src/lib/attendance-payroll-totals.ts`, server-only) returns the
  documented metrics for a Tokyo month:
  - **`finalizedLaborTotal`** / `finalizedPaidMinutes` / `finalizedWorkerCount` -> sum of `finalized`
    `attendance_month_snapshots` (Step 11) for the month. **Finalized data only**; never mixed with
    expected.
  - **`expectedLaborTotal`** / `expectedPaidMinutes` / `relevantHourlyWorkerCount` -> the currently
    projected gross over relevant **hourly** workers (those with attendance this month), computed by
    reusing each worker's `getMonthlyPayView().expectedGross` so the totals match the self-view and obey
    the same usable-session/exclusion rules. Salaried workers are not finalization targets and are
    excluded.
  - **`unfinalizedWorkerCount`** -> relevant hourly workers without a `finalized` snapshot this month.
  - **`siteTotals`** -> expected labor aggregated by **clock-in site** (the documented first-slice rule),
    from each included session's exact gross; null-site bucket = "Unassigned".
- **Privilege:** caller-agnostic (org + ym), like the review-queue layer -> the **caller MUST gate with
  `isAttendancePayrollAdmin`** (owner / `attendance_payroll_admin`); the `attendance_month_snapshots`
  admin-only SELECT RLS is the backstop. Regular users / hourly workers never reach it (they only see
  their own pay). Expected vs finalized stay explicitly separate in the contract.
- Shaped for direct reuse by the later dashboard UI, export, and historical snapshot reporting; no
  BI-style over-design.

Still pending (Step 13+): **export** generation (`attendance_export_logs`), **notifications**, full
midnight sweep, the employment/rate **management** backend (Step 9), and the owner/admin **web-dashboard
UI** including the totals dashboard (all deferred until the app is complete).

## As-built - Step 13 (finalized-only payroll export, 2026-06-18)

> **Superseded (2026-07-03):** the interim CSV described below is no longer the shipped format. The
> admin 급여 검토 page now exports the **final** monthly + per-user **Excel workbook + PDF** (see the
> "Personal payroll Excel/PDF export refinements" and "Per-user accounting exports" as-built sections).
> The CSV `runPayrollExport` / `exportMonthlyPayroll` / `exportUserPayroll` path and the dev test route
> remain as a legacy/back-compat foundation but are not wired into the dashboard UI.

Privileged finalized-only payroll export (monthly bulk + per-person) + export audit logging. **No admin
dashboard/export UI** (the export trigger UI is in the deferred web dashboard); no app screen expects
export, so this is backend + a dev test route.

- **Export lib** `src/lib/attendance-export.ts` -> `runPayrollExport(service, org, actorId, { scope, ym,
  userId? })`:
  - **Privilege enforced here** (`isAttendancePayrollAdmin`; owner/전무 (senior_managing_director) /
    `attendance_payroll_admin`) — `forbidden` otherwise. Regular users can never export.
  - **Finalized-only, strict:** gathers `attendance_month_snapshots` with `status='finalized'` for the
    Tokyo `target_month` (all users for `monthly_bulk`; the one user for `single_user`). Draft /
    reopened / superseded / non-finalized are never included. Empty bulk -> `empty`; missing per-person -> `not_finalized`.
  - **Format foundation:** the operator's final Excel template is still pending, so it emits a clean,
    structured **CSV with a UTF-8 BOM** (Excel-friendly Korean) whose columns map 1:1 to the documented
    snapshot fields (target month / employee / employee ID / wage type / paid minutes / gross amount / rate breakdown / finalized by / finalized at).
    The row builder is separate from the serializer, so the final template slots in later without
    touching the data layer.
  - **Audit:** writes an `attendance_export_logs` row (organization, `target_month`, `export_scope`,
    `user_id` for single, `snapshot_ids[]`, `exported_by_user_id`, `meta` = { ym, row_count, filename,
    format }). Returns `{ filename, csv, logId, rowCount, snapshotIds }`.
- **Server actions** `src/app/admin/attendance/actions.ts`: `exportMonthlyPayroll(ym)` /
  `exportUserPayroll(userId, ym)` -> thin session wrappers around `runPayrollExport`, returning the CSV
  for the (deferred) web-dashboard caller to download.
- **Dev test route** `GET /api/dev/attendance/export?scope=...&ym=...&userId=...` -> gated by
  `ENABLE_LOCAL_DEV_TOOLS` **and** still privilege-gated by `runPayrollExport`; streams the CSV as a
  download so the export is testable before the dashboard exists.
- **Future compatibility:** the structured rows + `attendance_export_logs` (with `snapshot_ids`) support
  the later operator Excel template, dashboard/reporting, and historical snapshot auditing without a
  redesign.

Still pending (Step 14+): **notifications** (18:30 reminder, correction/finalize outcomes), full
midnight sweep, the employment/rate **management** backend (Step 9), and the owner/admin **web-dashboard
UI** (site/QR, review queue, manual management, rate management, finalize/reopen, totals dashboard, export -> all deferred until the app is complete). ~~The final operator Excel export template also remains
pending (interim CSV is in place).~~ **Done (2026-07-03):** the final monthly + per-user **Excel
workbook + PDF** export ships in the admin 급여 검토 page; see the 2026-07-03 as-built sections below.

## As-built - Step 14 (attendance notifications + 18:30 reminder, 2026-06-18)

Attendance notifications use the **shared** notification system (no separate attendance notifier). One
discriminated type **`attendance_activity`** (migration `202606180001`) carries every event via
`payload.event` (`correction_created` / `abnormal_session` / `open_session_reminder`), mirroring
`suggestion_activity`. Admins receive in-app notifications through the existing notification center, and
the privileged review/manage surfaces are implemented in the admin attendance console.

- **Types/display/i18n:** `AttendanceNotificationPayload` + guard (`notifications/types.ts`); a display
  branch + kind label (`notifications/display.ts`); `mobile.notifications.attendance*` copy in **ko/ja/en**.
- **Create helpers** (`notifications/create.ts`): `notifyAttendanceAdmins` (fan-out to caller-resolved
  owner/전무 (senior_managing_director) / `attendance_payroll_admin` ids, actor-skipped, deduped — never
  broadens visibility) and
  `createAttendanceOpenSessionReminder` (worker, deduped once per Tokyo day). Admin ids come from
  `getAttendancePayrollAdminUserIds` (`attendance-review.ts`).
- **Admin alerts (synchronous):** `createAttendanceCorrectionRequest` fans out `correction_created` to
  admins (never the requester); the clock-out path fans out `abnormal_session` on a midnight-crossing
  session. **Privacy:** only privileged users receive these; regular workers never see org-wide
  attendance/payroll issues.
- **Worker 18:30 reminder:** a **once-per-Tokyo-day home prompt** (shared drag-dismiss sheet) shows when
  the user has an open session and Tokyo time >= 18:30 and they haven't answered today. **"Still working?"**
  records `still_working` (suppresses the prompt the rest of the day); **"Already left work"** records
  `left_work` and **routes to the correction flow** (`/mobile/attendance/correction?sessionId=<id>`) -> it
  **does NOT auto clock-out**. State lives in `attendance_open_session_reminders` (migration `202606180002`,
  unique per user+operating_date) via the self-only `respondOpenSessionReminder` action.
- **Scheduled evaluator:** `runAttendanceReminders` + `GET /api/attendance/reminders` (CRON_SECRET-gated,
  mirrors `/api/tasks/reminders`) creates the deduped worker reminder notification for open-session users
  past 18:30, and fires the admin **incomplete/stale** alert for sessions still open from a prior Tokyo
  day. Wire to Vercel Cron at ~18:30 Asia/Tokyo.
- **Deep-links:** worker reminder -> `/mobile/attendance` (home prompt); admin alerts -> `/mobile/attendance`
  (the in-app privileged review surface is the deferred web dashboard, so admin notifications currently
  deep-link to the attendance home).

This is the **final attendance/payroll app-scope step.** Intentionally deferred (document-only): the
owner/admin **web-dashboard UI** (site/QR, review queue, manual management, employment/rate management [Step 9],
finalize/reopen, totals dashboard, export), the operator Excel **export template**, the full
**midnight sweep**, and **Web Push** delivery (notifications are in-app only).

## As-built - Bug fixes + i18n pass (2026-06-18)

Three correctness fixes shipped as migration `202606180003_attendance_session_fixes.sql`:

1. **Finalization order fix (Bug 1):** `finalizeAttendanceMonth` now inserts the new snapshot row
   **before** superseding the previous one. The old order (supersede -> insert) left a window where a
   failed insert would permanently destroy the last finalized copy. The safety margin is reinforced by
   also excluding the newly inserted row from the supersede UPDATE via `.neq("id", ins.data.id)`.

2. **Session-less correction blocking (Bug 2):** `attendance_correction_requests` gained a
   `target_month date` column (nullable; existing rows default null). Session-less exception correction
   requests now store `target_month` on insert so `getFinalizationEligibility` can find them with a
   separate `IS NULL session_id` + `target_month = firstDay` query alongside the session-linked check.
   Without this, a pending exception request would not block monthly finalization.
   A partial index (`WHERE session_id IS NULL`) covers the new query path. `src/types/database.ts`
   updated (Row/Insert/Update types for `attendance_correction_requests`).

3. **Org-isolated reminder uniqueness (Bug 3):** The `attendance_open_session_reminders` unique
   constraint was `(user_id, operating_date)` -> a user shared across organizations would collide.
   The migration drops the old constraint and adds `(organization_id, user_id, operating_date)`.
   All open-session queries in `src/app/mobile/attendance/actions.ts` (`submitAttendanceScan`,
   `startBreak`/`endBreak`, reminder response) now include an explicit
   `.eq("organization_id", organizationId)` filter; the `getOpenSessionId` helper was updated to
   accept and apply `organizationId`. The reminder upsert `onConflict` clause updated to match.

**Attendance i18n pass (2026-06-18):** all attendance UI strings are now fully localized (ko/ja/en).
Each screen receives a `copy: Dictionary["attendance"]` prop threaded from the page via `getDictionary`.

- `attendance-home.tsx` -> ring states, clock-in/out buttons, break labels, reminder body, name
  suffix (`userNameDisplay`), preview fallback site (`previewSite`), static break preview ordinal.
  `GPS + QR`, `GPS+Wi-Fi`, and `Wi-Fi` method labels are **intentionally retained as literal labels**
  across the attendance UI (method chips + history/detail surfaces) because they are treated as
  universal technical standards, not locale-specific copy.
- `attendance-capture.tsx` -> GPS status, scan hints, all 8 ResultSheet cases
- `attendance-history.tsx` -> today summary, session list, status chips, detail sheet, abnormal note
- `attendance-correction-form.tsx` -> reason chips, all form fields, error messages, picker
- `attendance-correction-status.tsx` -> META labels, step bar, recap fields, review block
- `attendance-pay.tsx` -> duration formatting, amount formatting, exclusion reasons, day breakdown
- Pages: `correction/page.tsx`, `correction/status/page.tsx`, `pay/page.tsx`, `history/page.tsx`
  all call `getDictionary(session.user.preferredLanguage)` and forward `copy={dict.attendance}`.
- `src/lib/i18n.ts`: ~112 new keys added to the `attendance` section (en/ko/ja), grouped as:
  Home, Session status chips, History, Correction form, Correction status, Pay.

## As-built - History/Pay redesign + month switcher (2026-06-18)

UI-only pass over the self history + pay screens (no policy/schema change beyond the `ym` filter param):

- **`historyTitle` renamed** to `Attendance History`. Single source in `i18n.ts`; used by the page `<h1>` and shell title.
- **Shared `MonthSwitcher`** (`src/components/attendance/month-switcher.tsx`, client): `prev / [month] / next` pill. Arrows navigate `?ym=YYYY-MM` (prev/next disabled at the 12-month window edge / current
  month). Clicking the label opens a **custom (non-native) dropdown** listing the last 12 months
  (selected row highlighted + check); options/arrows `router.push` the new `ym`. Month labels are
  `Intl.DateTimeFormat(locale)` (year-prefixed only when it differs from the current year). Both the
  history and pay title rows use it; CSS `.msw*` appended to `attendance.css` (scoped, token-based).
  `caret` (chevron-down) icon added to `att-icons.tsx`.
- **History month scoping:** `history/page.tsx` now reads `?ym` (defaults to current Tokyo month) and
  passes it to `getAttendanceHistory(org, userId, ym)`. The today-summary card renders **only for the
  current month** (`ym === currentYm`); past months show just the month's session list (empty state when
  none).
- **Pay month nav:** `pay/page.tsx` drops the old `prevYm/nextYm/isCurrentMonth` props (and the local
  `shiftYm`) -> `AttendancePay` now takes `currentYm` and derives `isCurrentMonth` internally; the old
  two-button `seg-month` toggle is replaced by `MonthSwitcher`.
- **Detail sheets migrated to the canonical `BottomSheet`** (`src/components/shell/bottom-sheet.tsx`) on
-  both screens, replacing the hand-rolled `.dim`/`.rsheet` + `useSheetDragDismiss` markup -> restoring the
  app-standard slate scrim + drag-to-dismiss contract. The pay **excluded sessions N rows** banner is now a button
  that opens a sheet listing each excluded session (date / clock-in-out / reason chip); tapping a row jumps to
  that day's detail sheet.
- **Pay table fixes:** ko `payAmount` corrected to `¥{amount}` (was `{amount}`); daily `ptbl` grid
  widened/rebalanced (`36px 1fr 44px 76px 70px`) with `text-overflow: ellipsis` on the break/paid cells
  so break / recognized / wage columns no longer collide.

## As-built — Transport Reimbursement Backend (2026-06-26)

교통비 정산 백엔드 구현 완료. 급여(payroll)와 완전 분리된 증빙 기반 비용 정산 모듈.

- **마이그레이션** `202606260001_transport_reimbursement.sql`:
  - `transport_reimbursement_reports` — 사용자별 월 1개; status `draft/submitted/reviewing/approved/rejected/changes_requested`; `total_amount_cached` (소스 of truth는 items, 캐시 전용)
  - `transport_reimbursement_items` — 항목 (usage_date, amount_yen, entry_mode, attendance_session_id nullable, property_id/room_id nullable, work_context jsonb)
  - `transport_reimbursement_item_images` — 항목당 증빙 이미지
  - RLS: 사용자는 자기 데이터 SELECT만; owner/attendance_payroll_admin은 조직 전체 SELECT; 모든 write는 service-role
  - 스토리지 정책: `request-images` 버킷에 5단계 경로 정책 추가 (`{org_id}/transport-reimbursements/{report_id}/{item_id}/{file}`)

- **Query layer** `src/lib/transport-reimbursement.ts`:
  - `getOrCreateTransportReport` — UPSERT (draft 생성 또는 기존 반환)
  - `getTransportReport` — nullable 반환
  - `getTransportItems` — report_id로 items + images 조회
  - `getLinkedTransportCandidates` — 선택 월의 attendance_sessions + cleaning_sessions 읽어 후보 생성 (DB 미저장, 쿼리에서 계산)
  - `syncReportTotalAmount` — items 합계를 total_amount_cached에 반영
  - `getTransportReportSummaryForAdmin` / `getTransportReportUserDetailForAdmin` — 관리자 전용.
    Summary rows include `itemCount` and `missingCount` so overview/list KPI can report missing receipt
    evidence without hardcoded placeholders.

- **Server actions** `src/app/mobile/attendance/transport/actions.ts`:
  - `createTransportItemAction` — report 자동 생성, draft/rejected 상태에서만 허용
  - `updateTransportItemAction` — 소유권 + 상태 검증 후 수정
  - `deleteTransportItemAction` — storage 파일 정리 후 cascade 삭제
  - `addTransportItemImageAction` / `deleteTransportItemImageAction`
  - `submitTransportReportAction` — 증빙 누락 항목 있으면 `missing_evidence` 오류로 제출 차단

- **프론트엔드 연결 상태**: `transport/page.tsx`가 보고서·항목·연결 후보를 조회하고 `transport-statement.tsx`에 실데이터 props로 전달한다. 생성·수정·삭제·이미지 첨부·제출 액션도 연결되어 있다.

## As-built — Admin Attendance Dashboard Console Hardening (2026-07-02)

The desktop admin attendance console now consumes the attendance/payroll/transport backend slices
directly instead of rendering placeholder dashboard values.

- **Overview aggregation** (`src/lib/admin-attendance.ts`): `getAdminAttendanceOverview` pulls from the
  same review queue, correction-request, payroll, and transport helpers used by the detail pages (since
  2026-10-19 it reads only the slices its numbers need — see "Admin attendance read path — batched"). KPI
  values therefore represent the current queue/payroll/transport data instead of safe-zero placeholders.
  Transport KPI includes real missing-receipt evidence count derived from reimbursement items with no
  image rows.
- **Open correction sample** (`src/components/admin/attendance/attendance-overview.tsx`): the overview
  correction card renders recent open requests (`requested` / `in_review`) with requester, date, field,
  before/after value, and submitted time. The card only uses the empty state when there are no open
  correction requests.
- **Correction approval site integrity** (`src/app/admin/attendance/actions.ts`): approving a correction
  applies final clock-in and clock-out site IDs independently. A legacy single `finalSiteId` remains as a
  compatibility fallback, but new callers should send `finalClockInSiteId` and `finalClockOutSiteId`.
  Every final site ID is validated server-side against the organization before updating the session.
- **Hourly-rate future replacement UI** (`src/components/admin/attendance/attendance-wages-client.tsx`):
  the wage editor's optimistic history now mirrors server behavior. When a still-future open rate row is
  replaced, the client removes that superseded row instead of displaying it as a closed historical row.
- **Shared month control** (`src/components/admin/attendance/attendance-subnav.tsx` +
  `admin-month-picker.tsx`): the attendance console uses one top-right month picker in the shared subnav.
  It drives the common `?ym=YYYY-MM` context for overview, queue, payroll, transport, wages, and staff
  detail pages. Page-local month-picker toolbars were removed; non-month panel context such as
  `sessionId` or selected transport `user` is preserved when relevant. Follow-up links from overview to
  payroll/transport, staff-day panels to queue, and wage panels to staff detail also carry the selected
  `ym`.
- **Blocker → review-queue deep links (2026-07-10)**: in the payroll side panel, each 마감 차단 사유
  card (검토 필요 세션 / 정정 요청 대기 / 진행 중 세션) is a link into the review queue pre-filtered to
  the blocking work. `검토 필요`·`진행 중` → `filter=review`, `정정 요청` → `filter=corr`, all carrying
  `?ym=<selected>&q=<staff name>`. The queue page (`/admin/attendance/queue`) now reads `filter`
  (`review|pending|corr|all`, default `review`) and `q` (name search, ≤60 chars) from `searchParams` and
  seeds `AttendanceQueueClient`'s initial `filter` / `nameQuery`. On arrival the client also **auto-opens
  that staff member's side panel** — the first matching session (`filter=review`) or correction request
  (`filter=corr`) for the searched name — computed in the `panel` `useState` initializer (an explicit
  `sessionId` deep link still wins). This lets an operator jump straight from "why can't I finalize" to
  the exact session's detail panel to resolve; once all blockers clear, `finalizationEligible` flips true
  (마감 button enables), and finalizing enables the per-user PDF/Excel export.
- **Panel summary shows transport + total payout (2026-07-10)**: the per-user payroll side panel's
  "월별 요약" now lists **교통비**(approved) and **총 지급액(교통비 포함)** (= expected pre-tax wage +
  approved transport) right under the wage-only "예상 세전 총액", so the on-screen summary matches the
  exported PDF/Excel totals. `AdminPayrollRow` gained `transportApproved` (¥); `getAdminAttendancePayroll`
  joins it from the same source the export uses (`transport_reimbursement_reports`, `status='approved'`,
  `target_month='YYYY-MM-01'`, `total_amount_cached`) so panel and file totals cannot drift. Labels reuse
  `payExportTransport` / `payExportTotalWithTransport` (ko/ja/en); the total row uses `.kv--total`.
  Salaried rows dash the total (wage isn't computed in this panel) but still show the transport amount.
- **Accounting Excel export** (`src/app/admin/attendance/actions.ts` +
  `src/lib/attendance-payroll-workbook.ts`): the payroll page's monthly workbook action is labeled
  `엑셀 내보내기` in Korean and emits a tax/accounting hand-off summary rather than an internal review
  table. Columns are staff name, work days, total recognized time, hourly rate, approved transport
  reimbursement, payroll excluding transport, and total payout including transport. Transport is joined
  from the transport-review helper for the same month and only `approved` reports are included in the
  workbook totals. The workbook intentionally uses a plain payroll-ledger template rather than a
  report-style design: one green title row, Meiryo-sized headers with slightly roomy columns, black grid
  borders, black text throughout, bold-only emphasis for money columns (not text columns such as
  cleaned-room labels), up to 50 staff rows with blank bordered rows left available, and a simple
  right-aligned totals row.
- **Per-user accounting exports** (`src/lib/attendance-user-payroll-export.ts`): the payroll side panel's
  staff export now emits per-user Excel/PDF monthly detail instead of the legacy single-user CSV. The
  export rows are keyed by date and combine `getMonthlyPayView` day data (clock-in/out labels,
  paid minutes, daily gross), approved transport reimbursement items grouped by `usage_date`, and
  completed cleaning sessions grouped by `cleaning_date`. Cleaning rooms are summarized with the current
  user-provided room-label rules: Arakicho A/B -> `AA`/`AB` + room, Kabukicho -> `KK` + room,
  Takadanobaba -> `T2` + room, Okubo/Sky kept as stored labels until a later abbreviation decision.
  The export now reuses the same `getDisplayRoomLabel()` collapse rule as the cleaning UI, so duplicate
  Arakicho account keys such as `501_2` render as `AA501` / `AB501` instead of leaking the raw suffix.
  When a raw room already includes a building prefix (`ab201`, `t2203`, etc.), that prefix is stripped
  before the summary is prepended so exports show `AB201`, `T2203`, not duplicated forms like `ABab201`.
  The workbook totals row keeps payout as a right-aligned numeric cell with a custom number format rather
  than a left-aligned text formula. Monthly Excel/PDF and per-user Excel/PDF are intentionally kept on
  the same green ledger template so export surfaces do not diverge visually.
- **Admin roster** (`/admin/attendance/roster`): the web console now exposes the same daily attendance
  roster as mobile by reusing `src/lib/attendance-roster.ts` and the `attendance_sessions` +
  `attendance_breaks` source data. The route accepts `?date=YYYY-MM-DD`, clamps future and older-than-90-day
  requests to Tokyo today like mobile, and the client performs a quiet 10-second refresh while viewing
  today. The visible live-time label ticks every second independently from that data refresh; active
  status chips use the same small pulse-dot convention as the mobile roster, while the live-time
  indicator keeps its own pulse. `RosterEntry` includes `openBreakStartedAt` so the admin roster can show
  an elapsed `휴게 N분` value in the break column while keeping `휴게 중` as the status chip. Date selection
  lives in one top attendance-subnav date picker, not inside the roster body. This page is read-only;
  payroll-impacting edits remain in the review queue actions.
- **i18n guard fix**: the complaint image lightbox aria labels are dictionary-backed (`lightboxClose`,
  `lightboxPhoto`) in ko/ja/en so the repository-wide i18n guard remains green.

## Purpose

This document turns the confirmed attendance / hourly-pay policy into an implementation-ready technical direction.

Important boundary:

- attendance capture is approved for build
- hourly gross-pay calculation is approved within the narrow rules confirmed on 2026-06-17
- taxes, insurance, deductions, and salaried payroll remain outside this system

## Delivery Phases

### Phase A - Attendance Core

- site master
- QR issuance / rotation
- GPS + QR clock-in / clock-out
- shared staff / hourly attendance UI
- break tracking
- own attendance history
- correction / exception request flow
- admin review queue
- failure attempt logging

### Phase B - Hourly Pay Core

- employment type history
- hourly rate history
- real-time expected pay for hourly workers
- per-person month snapshots
- admin dashboard

### Phase C - Export and Extended Methods

- monthly bulk Excel export
- per-person Excel export
- export audit logs
- Wi-Fi attendance activation in a future non-PWA-capable delivery path

## Architectural Direction

### Session-first model

Do **not** model attendance only as loose event rows.

Recommended core model:

- one `attendance_session` per work session
- one-to-many `attendance_breaks`
- one-to-many `attendance_attempt_logs`
- one-to-many `attendance_correction_requests`
- one-to-many `attendance_session_audits`

Reason:

- the product rules are session-centric
- monthly pay needs closed-session aggregation
- correction, reopening, and audit history are easier to manage on a stable session identity

## Recommended Tables

### `attendance_sites`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
name text not null
property_id uuid references properties(id)
latitude numeric not null
longitude numeric not null
allowed_radius_meters integer not null default 100
wifi_ssids text[] not null default '{}'
is_active boolean not null default true
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Notes:

- owner-only maintenance
- one site may hold multiple allowed SSIDs
- Wi-Fi is modeled now even though PWA activation is deferred

### `attendance_qr_tokens`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
site_id uuid not null references attendance_sites(id)
token text not null unique
is_active boolean not null default true
issued_at timestamptz not null default now()
revoked_at timestamptz
replaced_by_token_id uuid references attendance_qr_tokens(id)
created_by_user_id uuid not null references profiles(id)
```

Constraints / behavior:

- enforce one active token per site at a time
- reissue deactivates the previous token

### `attendance_sessions`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
user_id uuid not null references profiles(id)
operating_date date not null
status text not null
review_state text not null default 'normal'

clock_in_at timestamptz
clock_in_site_id uuid references attendance_sites(id)
clock_in_method text
clock_in_qr_token_id uuid references attendance_qr_tokens(id)
clock_in_latitude numeric
clock_in_longitude numeric
clock_in_accuracy_meters numeric
clock_in_device_info jsonb not null default '{}'

clock_out_at timestamptz
clock_out_site_id uuid references attendance_sites(id)
clock_out_method text
clock_out_qr_token_id uuid references attendance_qr_tokens(id)
clock_out_latitude numeric
clock_out_longitude numeric
clock_out_accuracy_meters numeric
clock_out_device_info jsonb not null default '{}'

manual_created boolean not null default false
manual_created_by_user_id uuid references profiles(id)
manual_created_reason text

invalidated_at timestamptz
invalidated_by_user_id uuid references profiles(id)
invalidated_reason text

created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended `status` values:

```txt
open
completed
reopened
invalid
```

Recommended `review_state` values:

```txt
normal
review_required
pending_correction
approved_correction
rejected_correction
```

Recommended `clock_*_method` values:

```txt
gps_qr
gps_wifi
manual
```

Notes:

- PWA first release should only create `gps_qr` or `manual`
- `gps_wifi` is reserved for later activation
- one user may have only one `status='open'` session at a time
- `operating_date` should use Tokyo date derived from clock-in
- midnight-crossing sessions are not normal; mark `review_required`

### `attendance_breaks`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
session_id uuid not null references attendance_sessions(id)
started_at timestamptz not null
ended_at timestamptz
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Notes:

- multiple breaks per session allowed
- clock-out must be blocked if any break row is still open
- hourly paid minutes exclude only recorded break time

### `attendance_attempt_logs`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
user_id uuid not null references profiles(id)
attempted_at timestamptz not null default now()
action_type text not null
resolved_site_id uuid references attendance_sites(id)
method text not null
success boolean not null
failure_reason text
latitude numeric
longitude numeric
accuracy_meters numeric
device_info jsonb not null default '{}'
created_at timestamptz not null default now()
```

Recommended `action_type` values:

```txt
clock_in
clock_out
break_start
break_end
```

Recommended `failure_reason` values:

```txt
gps_denied
gps_unavailable
outside_radius
qr_invalid
qr_scan_failed
wifi_not_supported
wifi_not_matched
open_break_blocks_clock_out
midnight_crossing
open_session_exists
```

Notes:

- attempt logs are admin-visible only
- attempt logs do not affect payroll directly

### `attendance_correction_requests`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
session_id uuid references attendance_sessions(id)
requested_by_user_id uuid not null references profiles(id)
status text not null default 'requested'
reason_type text not null
memo text
desired_clock_in_at timestamptz
desired_clock_out_at timestamptz
desired_clock_in_site_id uuid references attendance_sites(id)
desired_clock_out_site_id uuid references attendance_sites(id)
image_urls text[] not null default '{}'
review_comment text
reviewed_by_user_id uuid references profiles(id)
reviewed_at timestamptz
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended `status` values:

```txt
requested
in_review
approved
rejected
```

Recommended `reason_type` values:

```txt
missing_clock_in
missing_clock_out
wrong_time
wrong_site
auth_failed
other
```

Notes:

- photos optional, max 5
- reject comment required
- approve comment optional
- approved request must result in admin-confirmed final values, not auto-apply the request verbatim

### `attendance_session_audits`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
session_id uuid not null references attendance_sessions(id)
actor_user_id uuid not null references profiles(id)
action_type text not null
reason text not null
before_json jsonb not null default '{}'
after_json jsonb not null default '{}'
created_at timestamptz not null default now()
```

Recommended `action_type` values:

```txt
manual_create
manual_update
invalidate
correction_apply
reopen
finalize
```

### `employment_type_history`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
user_id uuid not null references profiles(id)
employment_type text not null
effective_from date not null
effective_to date
created_by_user_id uuid not null references profiles(id)
created_at timestamptz not null default now()
```

Recommended `employment_type` values:

```txt
hourly
salaried
```

Notes:

- effective date applies to the full Tokyo operating date
- history must not reinterpret the past

### `hourly_rate_history`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
user_id uuid not null references profiles(id)
hourly_rate numeric not null
effective_from date not null
effective_to date
created_by_user_id uuid not null references profiles(id)
created_at timestamptz not null default now()
```

Notes:

- the rate effective date also applies to the full operating day
- final hourly gross result is rounded to nearest 10 yen

### `attendance_pay_allowances` (implemented 2026-07-10, migration `202607100001`)

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
target_date date not null
target_user_id uuid references profiles(id)
allowance_type text not null
amount_yen numeric not null
reason_type text not null
memo text
status text not null default 'active'
created_by_user_id uuid not null references profiles(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
cancelled_by_user_id uuid references profiles(id)
cancelled_at timestamptz
```

Recommended `allowance_type` values:

```txt
daily_fixed
hourly_extra
```

Recommended `status` values:

```txt
active
cancelled
```

Notes:

- **implemented (2026-07-10)** — see "As-built — attendance allowances / 추가수당" above; `reason_type`
  shown here was superseded by `category` (`regular`/`special`) in migration `202607100003`
- allowances are separate from `hourly_rate_history`
- `daily_fixed` applies once per worker/date when the date has recognized paid work
- `hourly_extra` is multiplied by recognized paid minutes for the date
- finalized payroll must preserve applied allowance detail in snapshot data

### `attendance_month_snapshots`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
user_id uuid not null references profiles(id)
target_month date not null
status text not null
total_paid_minutes integer not null
gross_amount numeric not null
rate_breakdown jsonb not null default '[]'
finalized_by_user_id uuid references profiles(id)
finalized_at timestamptz
supersedes_snapshot_id uuid references attendance_month_snapshots(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended `status` values:

```txt
draft
finalized
superseded
reopened
```

Notes:

- one user-month may have multiple historical snapshots
- only one `finalized` row per `(organization_id, user_id, target_month)` is allowed by
  `attendance_month_snapshots_one_finalized_idx` (migration
  `202607030003_attendance_finalized_snapshot_unique.sql`)
- reopened/superseded rows are retained as history and are not considered payable current rows

Admin attendance consistency hardening (2026-07-03):

- Manual create/update, correction approval, invalidate, and restore all block pay-affecting changes once
  the target user-month has a current finalized snapshot.
- Manual and correction-applied completed sessions require `clock_out_at > clock_in_at`; otherwise the
  action fails instead of silently producing zero paid time.
- Manual clock-out `HH:mm` values that are earlier than clock-in resolve to the next Tokyo day, and
  midnight-crossing sessions are kept review-required.
- Session-less exception approvals insert the missing completed manual session and audit row before the
  correction request is marked approved.
- Correction approval/rejection and transport-review mutations include current-status guards so a second
  admin cannot overwrite an already-transitioned request/report.

Admin dashboard aggregation performance rule (2026-07-03):

- Attendance subnav badges must use `getAdminAttendanceBadgeStats`, the lightweight count-only helper.
  They must not call `getAdminAttendanceOverview`, because overview loads review samples, correction
  samples, payroll fanout, and transport rows for the full landing page.
- Full overview aggregation remains reserved for `/admin/attendance` only.
- Correction request site labels are batch-loaded from `attendance_sites` once per correction list, not
  resolved with per-row site lookup calls.
- Overview queue links must preserve the selected `ym`; session deep links use
  `/admin/attendance/queue?ym=YYYY-MM&sessionId=...` so past-month rows do not open an empty current-month
  queue.

Admin attendance read path — batched (2026-10-19):

- **Payroll is computed per org, not per person.** `getAdminAttendancePayroll` reads the month once —
  sessions (`readAllPages`), `hourly_rate_history`, `employment_type_history`, `attendance_pay_allowances`,
  `attendance_month_snapshots`, session-less pending corrections, then breaks + session corrections by
  session id (200-id chunks) — and `computePayrollMonth` (`src/lib/admin-attendance.ts`) splits it per user
  in memory. It replaced the per-member fan-out of `getMonthlyPayView` + `getFinalizationEligibility` +
  `getCurrentFinalizedSnapshot` (≈12 queries per member → ~140 for 11 staff; now ~13 queries, 3 serial
  steps, independent of staff count).
- **`computePayrollMonth` must follow the same rules as `getMonthlyPayView` and
  `getFinalizationEligibility`.** Changing a pay rule in `src/lib/attendance-pay.ts` means changing it
  here too. `src/lib/__tests__/admin-payroll-batch.test.ts` runs both paths over one in-memory DB and
  compares every payroll row field (yen, minutes, blockers, finalized label) in ko/ja/en.
- **Staff detail** (`getAdminStaffDetail`) uses the same single-user batch: privilege · membership ·
  profile · month inputs · transport report start together, then breaks · corrections · sites · transport
  items. The ledger reuses the pay sessions (newest first) instead of reading sessions, breaks, and
  corrections a second time. ~12 serial steps → 2 (+ the privilege check inside step 1).
- **Overview** reads only what its numbers need: the review queue with `filter: "review_required"` (not
  every session of the month), the open-correction **count** (`head` count, capped at the corr tab's
  200) plus the first 5 for the sample, the batched payroll KPI, and the transport KPI straight from
  `getTransportReportSummaryForAdmin` (`transportKpiOf`, same numbers as the transport table). ~11 serial
  steps / ~170 queries → ~5 / ~27.
- **`isAttendancePayrollAdmin` is `cache()`d** (React request cache) and its two lookups run together, so
  a page that calls it from the badge helper, the body, and nested helpers pays for it once.
- The admin correction queue is an open-work queue: it loads `requested` / `in_review` rows only and
  removes rows from client state after approval/rejection.
- Transport "submitted total" KPI excludes draft, rejected, and changes-requested reports; it only sums
  submitted/reviewing/approved reports and recalculates from current client rows after review actions.
- Attendance side panels share `useAdminPanelA11y`: `Esc` closes the active panel, body scroll is locked
  while open, focus moves into the panel, and the previously focused element is restored on close. Nested
  reason modals and receipt lightboxes disable the parent panel's `Esc` handler so only the top overlay
  responds.

### `attendance_export_logs`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
target_month date not null
export_scope text not null
user_id uuid references profiles(id)
snapshot_ids uuid[] not null default '{}'
exported_by_user_id uuid not null references profiles(id)
created_at timestamptz not null default now()
meta jsonb not null default '{}'
```

Recommended `export_scope` values:

```txt
monthly_bulk
single_user
```

### `transport_reimbursement_reports`

One row per **user-month** reimbursement ledger.

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
user_id uuid not null references profiles(id)
target_month date not null        -- first day of month in Tokyo basis
status text not null default 'draft'
submitted_at timestamptz
reviewed_at timestamptz
reviewed_by_user_id uuid references profiles(id)
review_note text
total_amount_cached integer not null default 0
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended constraints:

- unique `(organization_id, user_id, target_month)`
- `status` in:

```txt
draft
submitted
reviewing
approved
rejected
changes_requested
```

Admin review transitions are intentionally narrower than the status list. Admins may approve, reject,
or request a fix only from `submitted` / `reviewing`; `changes_requested` is with the worker and must be
resubmitted before another admin decision. The desktop transport panel hides impossible decision buttons
for `draft`, `none`, and `changes_requested`, while staff detail renders `changes_requested` as the same
localized request-fix label instead of treating it as no submission.

Notes:

- raw ownership is **always per-user**
- `total_amount_cached` is a convenience field for list/dashboard/export performance; source of truth
  remains the items
- this table is **payroll-adjacent** but must remain separate from `attendance_month_snapshots`

### `transport_reimbursement_items`

One row per reimbursable transport entry.

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
report_id uuid not null references transport_reimbursement_reports(id) on delete cascade
user_id uuid not null references profiles(id)
usage_date date not null
amount_yen integer not null
entry_mode text not null
attendance_session_id uuid references attendance_sessions(id)
property_id uuid references properties(id)
room_id uuid references rooms(id)
work_context jsonb not null default '{}'   -- building label, room labels, cleaning summary, etc.
memo text
sort_order integer not null default 0
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended `entry_mode` values:

```txt
linked
manual
```

Notes:

- multiple items may exist on the same date
- `attendance_session_id` is optional because monthly bulk/manual entry is required
- `linked` item generation should come from **reading the selected month's attendance/cleaning history**
  and building candidate rows later; it is not restricted to same-day creation
- `work_context` is intentional: a single transport entry may need to preserve multiple cleaned rooms or
  a display-ready building/room summary, which does not fit a strict single-room FK alone
- `property_id` / `room_id` allow reuse of the existing building/room context-linking direction where a
  single canonical context exists

### `transport_reimbursement_item_images`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
report_id uuid not null references transport_reimbursement_reports(id) on delete cascade
item_id uuid not null references transport_reimbursement_items(id) on delete cascade
user_id uuid not null references profiles(id)
storage_path text not null
sort_order integer not null default 0
created_at timestamptz not null default now()
```

Notes:

- image count is enforced at the application layer
- recommended storage path:

```txt
{org_id}/transport-reimbursements/{report_id}/{item_id}/{file}
```

- bucket reuse is acceptable (`request-images`) if path/RLS policy stays explicit

### Authorization Flag

Recommended membership-level flag:

```txt
memberships.attendance_payroll_admin boolean not null default false
```

Reason:

- org-scoped privilege
- separate from broad role names
- matches the product rule: `owner (or senior_managing_director / 전무, owner-equivalent since
  2026-07-13) + explicitly designated users`

## Derived Rules

### Paid Minutes

For hourly users only:

```txt
paid_minutes
= completed session minutes
- sum(closed break minutes)
```

Exclude from paid calculation:

- open sessions
- incomplete sessions
- review-required sessions
- pending correction sessions
- invalid sessions

Include after resolution:

- approved corrections
- reviewed manual sessions

### Gross Amount

For each resolved day:

```txt
gross = hourly_rate * (paid_minutes / 60)
```

Monthly total:

- sum all gross segments by effective rate
- round final per-person monthly gross up to the next 10 yen ceiling

### No Premium Layers

Do not add:

- overtime multiplier
- holiday multiplier
- public-holiday multiplier
- night multiplier

These are intentionally out of scope for now.

## PWA Implementation Constraints

### GPS

- use Geolocation API
- require explicit permission
- store latitude / longitude / accuracy
- compare against site coordinates and allowed radius

### QR

- use camera-based QR scan in mobile PWA
- QR identifies site token server-side

### Wi-Fi

- model `gps_wifi` in schema and business rules
- in the current PWA release, do not activate it
- show Wi-Fi attendance in UI as `준비중`
- do not attempt pseudo-SSID logic in browser-only code

## Suggested Server Actions / Routes

### Worker-side

- `submitAttendanceScan` (unified clock-in + clock-out via GPS+QR)
- `startBreak`
- `endBreak`
- `createAttendanceCorrectionRequest`
- `respondOpenSessionReminder`

### Admin-side

- `createAttendanceSite`
- `updateAttendanceSite`
- `issueAttendanceQr`
- `revokeAttendanceQr`
- `createManualAttendanceSession`
- `updateAttendanceSession`
- `invalidateAttendanceSession`
- `reviewAttendanceCorrectionRequest`
- `setEmploymentType`
- `setHourlyRate`
- `finalizeAttendanceMonthForUser`
- `reopenAttendanceMonthForUser`
- `exportAttendanceMonth`
- `exportAttendanceUserMonth`

### Shared Queries

- `getMyAttendanceSessions`
- `getMyAttendanceMonthSummary`
- `getAttendanceReviewQueue`
- `getAttendanceDashboard`
- `getAttendanceSiteCostSummary`
- `getAttendancePayAllowances` (implemented 2026-07-10)
- `getMyTransportReimbursementMonth`
- `getTransportReimbursementUserMonth`
- `getTransportReimbursementMonthSummary`

## RLS Direction

### Default user access

- read own sessions
- read own breaks
- read own correction requests
- read own month summaries
- **implemented:** read own applied attendance allowances through the pay view
- read own transport reimbursement reports/items/images
- no direct client-side writes to authoritative payroll data

### Privileged admin access

- `owner` (or `senior_managing_director` / 전무, owner-equivalent since 2026-07-13) and
  `attendance_payroll_admin` read org-wide attendance and payroll data
- **Implemented:** `owner`/전무 and `attendance_payroll_admin` read and manage org-wide attendance
  allowances (see the 2026-07-10 as-built section above)
- `owner`/전무 and `attendance_payroll_admin` read org-wide transport reimbursement data
- site master writes should still remain owner-equivalent-only (owner or 전무) in application logic

### Service-role writes

Recommended pattern:

- authoritative attendance mutations go through controlled server actions
- **implemented:** attendance allowance create/cancel goes through controlled privileged server actions
  (`createAttendanceAllowance` / `cancelAttendanceAllowance`)
- RLS may remain conservative/read-focused for complex payroll-sensitive tables

## Finalization Rules

A user-month cannot finalize while any of these exist:

- `review_required` sessions
- `requested` or `in_review` correction requests
- open sessions
- reopened month state

**Implemented (2026-07-10):** allowance create/cancel is blocked once the user-month is finalized;
changing it requires reopen and re-finalize.

Finalization should:

- compute paid minutes and gross amount
- compute and preserve applied attendance allowance breakdown
- persist a snapshot
- record audit action

Reopen should:

- preserve prior finalized snapshot as history
- create a reopen trail
- require reason

## Notifications Direction

Worker-facing:

- 18:30 open-session reminder, once per Tokyo day
- correction request outcome

Admin-facing:

- new correction / exception request
- incomplete session detected
- midnight-crossing abnormal session

Transportation reimbursement notifications should be a later, separate slice. Do not force them into the
existing `attendance_activity` design until the reimbursement review lifecycle is implemented.

## Export Rules

- export only finalized data
- support monthly bulk and single-user export
- exclude unresolved / draft / reopened records
- final format = per-user + monthly **Excel workbook + PDF** (2026-07-03), superseding the interim CSV
- store export audit trail

Transportation reimbursement export should be modeled separately from finalized wage export.

Recommended workbook target:

- sheet 1: monthly summary (one row per user)
- sheet 2: detailed transport items (one row per item)

Recommended reimbursement export columns:

- user
- target month
- usage date
- linked attendance date
- building
- room/cleaning summary
- entry mode
- amount_yen
- evidence_count
- memo
- report_status

Important:

- keep workbook visually clean for office review
- do not rely on embedding all receipt images into the workbook cells
- wage totals and transport reimbursement totals must remain separate in both workbook logic and
  dashboard logic

## Current Build Notes

- Phase A can be built now with `GPS + QR`
- Wi-Fi attendance is designed but must remain disabled in the PWA release
- hourly gross-pay logic is now sufficiently defined for implementation
- tax/deduction integration should not be added here
- transportation reimbursement is now planned as a later attendance/payroll-adjacent module: per-user
  monthly ledger, mandatory photo evidence per item, linked + manual entry, clean Excel export, and
  separate totals from wages
