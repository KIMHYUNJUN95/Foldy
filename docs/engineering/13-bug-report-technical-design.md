# Bug Report / Problem Report Technical Design

Status: 1차 구현 (2026-06-25)

Design note:

- 디자인 1차 구현 완료, 모바일 3개 화면 (목록/작성/상세).
- 수정 페이지는 1차 deferred. admin web 페이지는 1차 deferred.

## Purpose

This document defines the technical design for the first Bug Report / Problem Report slice.

Important distinction:

- this is for **Foldy product/system issues**
- it is not a maintenance/facility workflow
- it is not the staff-suggestions feedback thread

## Routes (1차 구현)

### Mobile

```txt
/mobile/bugs          -- list (my reports; all-org for reviewers)
/mobile/bugs/new      -- create form
/mobile/bugs/[id]     -- detail + reviewer status-change BottomSheet
```

Note: route is `/mobile/bugs`, **not** `/mobile/bug-reports` (changed per design decision 2026-06-25).

### 1차 deferred routes

```txt
/mobile/bugs/[id]/edit   -- edit page (design not finalized; button hidden in 1차)
/admin/bug-reports        -- admin web reviewer page (1차 deferred — reviewers use mobile)
```

## Data Model

Single primary table:

```txt
bug_reports
```

No separate comments/events table in the first slice. If timeline/history becomes necessary later, add:

```txt
bug_report_events
```

as a second-step expansion.

## Table: `bug_reports`

Migration: `supabase/migrations/<timestamp>_bug_reports.sql`

> Note: migration filename to be confirmed from Database engineer output before commit. Placeholder used above.

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

## Constraints

```txt
check (char_length(trim(title)) > 0)
check (char_length(trim(description)) > 0)
check (coalesce(array_length(image_urls, 1), 0) <= 5)
check (status in ('submitted', 'reviewing', 'fixed', 'closed'))
```

## Indexes

```txt
bug_reports_org_created_idx    (organization_id, created_at desc)
bug_reports_reporter_idx       (organization_id, reported_by_user_id, created_at desc)
bug_reports_status_idx         (organization_id, status, created_at desc)
```

## Storage

Reuses the shared `request-images` bucket.

```txt
bucket:  request-images
path:    {organization_id}/bug-reports/{report_id}/{filename}
```

Rules:

- max 5 images
- client-side compression before upload
- public URLs stored in `image_urls text[]`

## Permissions / RLS

### Reviewer definition (1차 확정)

```txt
owner, office_admin
```

`cs_staff` / `developer_super_admin` as reviewers: open question, deferred.

### SELECT

```txt
reported_by_user_id = auth.uid()                    -- own report
OR has_org_role(organization_id, ['owner', 'office_admin'])   -- reviewer
```

### INSERT

```txt
has_active_membership(organization_id)
AND reported_by_user_id = auth.uid()
```

### UPDATE

Two separate policies:

```txt
-- author edits own report while submitted
reported_by_user_id = auth.uid()
AND status = 'submitted'

-- reviewer changes status
has_org_role(organization_id, ['owner', 'office_admin'])
```

Implementation note: status change is handled by the `updateBugReportStatus` server action (service-role).
Content edit is handled by `updateBugReport` (service-role). Code-level gates double-check RLS intent.

### DELETE

```txt
reported_by_user_id = auth.uid()
AND status = 'submitted'
```

Reviewer hard delete: **not allowed in 1차** (requires explicit admin policy approval later).

## Server Actions

```txt
createBugReport(formData)
  -- any active org member
  -- sets reported_by_user_id = auth.uid()
  -- redirects to /mobile/bugs on success

updateBugReport(formData)
  -- author only, status = 'submitted' only
  -- platform developer bypasses both (2026-10-23, 05 「개발자 예외」)
  -- 1차: not exposed via UI (edit page deferred)

deleteBugReport(reportId)
  -- author only, status = 'submitted' only
  -- platform developer bypasses both — detail page shows delete for them (2026-10-23)
  -- hard delete, requires confirmation modal

updateBugReportStatus(formData)
  -- reviewer only (owner, office_admin)
  -- updates status, sets reviewed_by_user_id / closed_by_user_id / closed_at as appropriate
  -- triggers bug_report_activity notification to reporter

getMyBugReports(session)
  -- returns own reports, newest first

getBugReportDetail(session, id)
  -- author or reviewer; 403 if neither

getOrgBugReports(session, filters)
  -- reviewer only; all reports in org
```

Write paths use service-role with explicit org/role checks, consistent with other Foldy workflows.

## Notification

### Type

```txt
bug_report_activity
```

### Payload

```txt
{
  reportId:    string,
  reportTitle: string,
  event:       "created" | "status_changed",
  status?:     "submitted" | "reviewing" | "fixed" | "closed",
  actorName?:  string
}
```

### Recipients

```txt
created        -> same-org reviewers (owner, office_admin); suppress self
status_changed -> original reporter (reported_by_user_id); suppress actor self
```

### i18n keys

```txt
notificationBugReportCreatedTitle
notificationBugReportCreatedBody
notificationBugReportStatusChangedTitle
notificationBugReportStatusChangedBody
```

Deep link: `/mobile/bugs/{reportId}`

## i18n Keys (페이지/폼)

All page, form, and error strings live under the `bugs` key in `src/lib/i18n.ts`, with full
`ko` / `ja` / `en` entries (FALLBACK = en, `localeOverrides.ko` / `.ja`):

```txt
bugs.title                     -- also the MobileShell title for list + detail
bugs.listHeadingMine
bugs.listHeadingAll
bugs.listColumnId
bugs.listColumnTitle
bugs.listColumnStatus
bugs.composeCta
bugs.composeTitleLabel
bugs.composeTitlePlaceholder
bugs.composeDescriptionLabel
bugs.composeDescriptionPlaceholder
bugs.composeScreenshotsLabel
bugs.composeSubmit
bugs.composeSubmitting
bugs.composeMenuAria            -- compose top-chrome menu button aria-label
bugs.composeProfileAria        -- compose top-chrome profile button aria-label
bugs.screenshotAddAria         -- compose "add screenshot" button aria-label
bugs.screenshotRemoveAria      -- compose "remove screenshot" button aria-label
bugs.screenshotAlt             -- detail image alt, rendered as `{screenshotAlt} {n}`
bugs.detailSectionDescription
bugs.detailSectionScreenshots
bugs.detailKvStatus
bugs.detailKvReportedAt
bugs.detailKvReporter
bugs.detailActionEdit          -- hidden in 1차 (edit page deferred)
bugs.detailActionDelete
bugs.detailDeleteConfirmTitle
bugs.detailDeleteConfirmBody
bugs.detailDeleteConfirmCancel
bugs.detailDeleteConfirmCta
bugs.detailDeleteError         -- delete-action failure alert
bugs.statusSubmitted
bugs.statusReviewing
bugs.statusFixed
bugs.statusClosed
bugs.statusChangeSheetTitle    -- status sheet header + reviewer status-chip aria-label
bugs.emptyState
bugs.submitError               -- create-action failure inline error
bugs.errorBugReportTitleRequired
bugs.errorBugReportDescriptionRequired
bugs.errorBugReportImageLimit
bugs.errorBugReportNotEditable
```

Note on error key naming: Backend agents use `errorBugReportTitleRequired`, `errorBugReportDescriptionRequired`, `errorBugReportImageLimit`, `errorBugReportNotEditable` as top-level keys in the `bugs` section (not nested under a sub-key). These are confirmed naming contracts.

### Wiring (2026-06-25)

The dictionary keys existed from the first cut, but the UI shipped with hardcoded Korean strings.
This was fixed so the surfaces consume the dictionary, following the board/tasks pattern:

- **Server pages** (`bugs/page.tsx`, `bugs/[id]/page.tsx`, `bugs/new/page.tsx`) resolve the locale
  from `session.user.preferredLanguage` and pass `copy = getDictionary(locale).bugs` to their client
  components. The list/detail `MobileShell` title uses `copy.title`.
- **`bug-types.ts`** exports `BugCopy = Dictionary["bugs"]` and `bugStatusLabel(copy, status)` — the
  single source of truth for status → localized label.
- **`BugStatusBadge`** now takes a required `label` prop (callers pass `bugStatusLabel(copy, status)`);
  the old in-component Korean status map was removed.
- No user-visible string is hardcoded in `src/app/mobile/bugs/*` or `src/components/bugs/*`
  (verified: no Korean string literals remain — comments only).

## Implementation Order

1. DB: migration + TS types
2. Backend: server actions + notification fan-out
3. Frontend: list + create + detail + status BottomSheet
4. i18n: all ko/ja/en keys (done as part of docs sync 2026-06-25)
5. Docs: sync (this file + product/25 + data-model/04 + rls/05 + decision-log + current-status)

## Open Questions

- whether reviewer roles expand to `cs_staff` / `developer_super_admin` (open, deferred)
- whether device/browser/app-version is auto-captured silently in a later slice
- migration filename: confirm from DB engineer before commit (placeholder `<timestamp>_bug_reports.sql` above)
