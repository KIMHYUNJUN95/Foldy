# Todo / Task Technical Design

## 2026-10-28 반복 회차 감사 반영 (as-built)

반복 회차 계산 · 완료 정산 · 알림의 결함 수정. 계산은 전부 `src/lib/tasks-recurrence.ts`(순수, 서버 ·
클라이언트 공용) 한 곳이다. 회귀 테스트: `src/lib/__tests__/task-recurrence-audit-2026-10-28.test.ts`,
`src/lib/__tests__/task-datetime-validation.test.ts`.

- **월 · 연 반복은 앵커에서 바로 계산한다.** n 번째 회차 = `shiftMonthlyYmd(anchor, n)` /
  `shiftYearlyYmd(anchor, n)`. 예전에는 직전 회차에서 한 칸씩 넘어가 말일 잘림이 굳었다(1/31 → 2/28 →
  3/28 …, 2024-02-29 연 반복이 2028 에도 02-28). 이제 1/31 → 2/28 → 3/31, 2/29 → 평년 2/28 · 윤년 2/29.
  매일 · 매주도 n 으로 바로 뛰어서, 예전 1500 단계 상한 때문에 4년 넘은 앵커가 회차를 놓치던 문제도 없다.
- **요일 묶음 규칙(평일 · 주말 · `custom:`)은 맞지 않는 앵커를 내지 않는다.** 토요일 앵커의 「평일마다」는
  월요일이 첫 회차다. `recurringOccurrencesInRange` 하나가 기준이라 `isRecurringOccurrenceDate` ·
  `nextRecurringOccurrence` · 밀린 회차 · 모바일/콘솔 달력이 모두 같은 답을 낸다.
- **밀린 회차는 상태 창(400일) 안만 센다.** `OCCURRENCE_STATE_WINDOW_DAYS = 400` 을 서버 읽기
  (`getOccurrenceStates` / `getOccurrenceOrders`)와 `outstandingOverdueOccurrences` 가 함께 쓴다 — 창 밖
  회차를 세면 끝낸 회차가 «밀림» 으로 되살아난다.
- **회차 상태 읽기는 빠짐없이.** `getOccurrenceStates` / `getOccurrenceOrders` 가 조직 전체를 한 번에 읽어
  PostgREST 1000행 상한에서 조용히 잘렸다. 이제 참여 범위 작업 id 로 좁혀(150개씩) `range` 로 끝까지 넘긴다.
- **완료 정산은 가장 최근 미해결 회차.** 회차가 아닌 날 체크하면 `pickCompletionOccurrence` 가 그 날짜
  이전의 **가장 최근** 미해결 회차로 정산하고, 더 오래된 것은 흡수가 치운다(예전에는 가장 오래된 것을
  골라 금 · 월이 밀린 화요일 체크 뒤 월요일이 «1일 밀림» 으로 남았다).
- **흡수는 오늘(도쿄) 이후를 건드리지 않는다.** `occurrencesToAbsorb` = `[anchor, min(완료일, 오늘))` 의
  미해결 회차. 모바일 「내일」 탭에서 내일 회차를 체크하면 예전에는 열린 오늘 회차가 «이동» 처리돼
  오늘 목록에서 사라졌다.
- **이중 완료 가드용 헬퍼.** 순수 `isOccurrenceCompleted(states, date)` (`tasks-recurrence.ts`), 서버
  `occurrenceAlreadyCompleted(taskId, date): Promise<boolean>` (`task-occurrences.ts`). 완료 액션은
  `resolveCompletionOccurrence` 가 돌려준 날짜로 부른다.
- **되돌리기의 한계(기록).** `releaseAbsorbedOccurrences` 는 `moved_to_date = 완료일` 인 `moved` 행을
  지운다. 흡수가 만든 행과 예전 「오늘로 가져오기」(2026-07-30 ~ 08-25)가 만든 행은 모양이 같아 구분할 수
  없어, 그날로 가져왔던 옛 행도 함께 지워질 수 있다. 옛 행은 그 기간 것뿐이라 그대로 둔다.
- **반복 업무 알림은 회차 기준.** 아래 Notifications → Time-based 참고(`decideRecurringReminder`).
- **날짜 · 시각 검증.** `isValidYmd`(달력에 있는 날짜) · `isValidHm`(00:00–23:59)을 `src/lib/tasks.ts` 에서
  export. `normalizeTaskDateTime` · `taskTimeWithoutDate` 가 이것을 쓴다. 범위 밖 값은 미설정으로 본다.
- **죽은 코드 삭제.** `tasks.ts` 의 `nextRecurringInstance` · `previousRecurringInstance` ·
  `shiftRecurringTaskDates` · `isTaskOverdue` · `isTaskToday` · `isTaskActive` 와 롤포워드용 쌍둥이 날짜 계산,
  `task-occurrences.ts` 의 `createCarryOverTask`(호출부 없음). `moveOccurrences` 는 흡수가 쓰므로 남긴다.

## 2026-10-26 mobile bug-fix pass (as-built)

Server actions (`src/app/mobile/tasks/[id]/actions.ts`):

- **Status actions return a result.** `completeTask` / `reopenTask` → `TaskStatusResult = { ok, occurrenceDate? }`
  (completeTask used to return the bare recorded date); `setTaskProgress` → `{ ok, reason?: "recurring" }`.
  The row UPDATE (one-off) and the `task_occurrence_state` write (recurring — `completeOccurrence` /
  `clearOccurrenceState` now return `boolean`) are checked; on failure the action returns `{ ok: false }`
  **before** writing the `completed` log or notifying participants. Writes also carry `organization_id`.
- **`setTaskProgress` rejects recurring tasks** (`reason: "recurring"`) — the row status of a recurring task
  stays `open`; completion is per occurrence. The detail view no longer draws the 대기 | 진행 중 | 완료
  segment for recurring tasks (the big ring handles complete / reopen).
- **Reorder ids are scope-filtered.** `reorderTasks` / `reorderDateTasks` keep only ids in
  `getTaskScope(session).taskIds` (indexes keep the original merged-list positions), and
  `setOccurrenceOrders` (shared with the console) re-checks the ids belong to the org and are not deleted.
- `rescheduleOverdueTo` validates `targetDate` as a real `YYYY-MM-DD` (bad input used to throw a RangeError → 500).
- `removeTaskParticipant` checks the delete (`mustWrite`) and returns `?error=save_failed` on failure.
- `updateTaskCore` failures (`forbidden` / `missing_title` / `save_failed` / `time_needs_date` /
  `repeat_needs_date`) redirect to **`/mobile/tasks/{id}/edit?error=…`** — the detail page never rendered
  `?error=`, so edit failures were silent. `deleteProject` checks its delete and returns
  `?error=delete_failed`.

Clients:

- `TaskCreateForm` (create + edit) runs the action through `submitAction`: a redirect carrying `?error=`
  unlocks the form and shows the mapped `copy.errors[...]` (draft kept); any other redirect = success →
  **only then** the sessionStorage draft is cleared (it used to be cleared before submit); a non-redirect
  throw shows `save_failed`. The redirect error is re-thrown so Next completes the navigation. A changed
  `serverError` prop is synced into the visible error and unlocks the submit guard.
- `tasks-workspace.tsx`: completion / reopen / delete / skip / restore / overdue bulk actions catch
  thrown actions and `{ ok: false }` → the optimistic value is dropped when the transition ends, an
  error toast (`copy.errors.save_failed`, reusing the move-notice slot as `action_failed`) and
  `haptic("error")`. `haptic("success")` fires only after the server confirms (card ring → `light` on
  tap; quick-add → on the `?created=1` return). Undo of a completion (one-off too) waits for the
  completion request before reopening, and is skipped if the completion failed.
- `?deleted=<id>` is removed from the URL after showing the undo toast (it used to re-appear on every
  refresh and actually restore the task); the timer lives in the `showDeleteUndo` ref.
- Completion undo and delete undo share one toast slot: the most recent is shown, dismissing it clears
  only that one (`lastUndoKind`), the other's undo stays available.
- State updaters no longer call server actions (`undoSkipOccurrence`, `handleRestore`).
- `ProjectDetailView`: a recurring project task's ring opens the detail with `?occurrence=<today Tokyo>`
  instead of completing (which completed the series start date); the detail page re-validates the date.
  Complete / reopen failures show an error toast.
- `ReorderableTaskList` resyncs its order only when the **id sequence** of `items` changes (same ids →
  card objects refreshed in the current order), so a dropped order no longer snaps back on an
  unrelated parent re-render.
- `ReportSheet`: load failures fall to the error state (spinner no longer hangs); schedule / cancel /
  Slack send failures release the busy state; clipboard `writeText` rejection falls back to
  `execCommand`.
- Haptics: delete confirmations use `light` (was `warning`); form-action submits that can't observe the
  server result (create project, add section) use `light`.

Other:

- `scheduleDailyReport` (`src/actions/task-report-schedule.ts`) **updates the live scheduled row in place**
  (body + send_at, guarded by `status = 'scheduled'`) instead of cancel → insert, so a failed write no
  longer loses the existing schedule (insert-before-cancel is impossible — the one-active partial unique
  index). All its queries and `cancelDailyReportSchedule` filter `organization_id`.
- `searchReservations` (`src/actions/task-context.ts`) strips PostgREST `or()` syntax characters with
  `escapeIlikeFragment` (`src/lib/guest-search.ts`) before building the `ilike` filter.
- Image URL validation — see Images below.

## 2026-08-07 mobile occurrence-detail deletion

A recurring mobile `TaskCard` appends a candidate `occurrence` date when navigating to detail. The
server page recomputes that date against the stored task anchor and recurrence rule before exposing
the per-occurrence delete choice. Skipping uses the existing `skipOccurrenceOn` action and returns
to the source list with an undo handoff; whole-series deletion continues through the existing
author-scoped soft-delete action.

Status: First slice implemented (2026-06-10) — migrations `202606100003_todo_tasks.sql`,
`202606150003_task_recurrence_instances.sql`. As-built notes:
`priority`/`status` are text columns with CHECK constraints (not enums); RLS uses a `security definer`
`is_task_participant(task_id)` helper to avoid recursion; reads are RLS-scoped while **all writes go
through service-role server actions** with explicit permission checks; notification_type gained
`task_shared`/`task_updated`/`task_completed` and notifications fan out to participants; task photos
reuse the `request-images` bucket (`task-images`/`task-update-images`). Recurrence then materialized
real task-instance rows inside the active operating window *(historical — replaced by roll-forward on
2026-06-16, then by the fixed-anchor occurrence model on 2026-07-30)*.

Completion + report (2026-06-13): manual complete / reopen is **re-introduced** and now drives a
**완료/기록 (Completed)** tab plus a **daily-report generator** (free, template-based — no LLM).
- `completeTask(taskId)` / `reopenTask(taskId)` (server actions in `tasks/[id]/actions.ts`) set
  `status` + `completed_at` + `completed_by_user_id`, log a `completed`/`reopened` `task_updates`
  row, and (complete only) fan out a `task_completed` notification. Both `revalidatePath` the list +
  detail. Invoked programmatically from the card status-circle (with an undo toast) and the detail
  view's 완료/다시 열기 button.
- The Completed tab groups completed tasks by **completion day** (`tokyoDateOf(completed_at)`, newest
  first) — a task scheduled for tomorrow but finished today lands in today's group. Each day header
  has a **보고서** button.
- The report is generated by `generateDailyReport(date)` (`src/actions/task-report.ts`) — **free,
  template-based, no LLM / no API key**: it gathers the caller's own completions for that Tokyo date
  and returns a date-headed bullet list, with a deterministic local `tidy()` pass (whitespace,
  leading bullet glyphs, punctuation spacing) for light auto-correction. The header suffix is
  localized (업무일지 / 業務日報 / Daily report). **Staff-only**:
  `canGenerateDailyReport(role, can_generate_report)` = `role != part_time_staff OR
  profiles.can_generate_report`; a forbidden caller gets a "권한 없음" popup. Owner/office_admin toggle
  the per-user flag in admin user management (`updateMemberReportAccess`).
  (An LLM-backed variant was prototyped then dropped for cost — see decision log 2026-06-13.)
- **Slack delivery (2026-08-03):** `sendDailyReportToSlack(date, editedText)` repeats the same
  generation/permission check, validates a server-only `https://hooks.slack.com` Incoming Webhook,
  and posts the reviewed textarea verbatim as Slack `text`. It refuses reports over 40,000 characters
  rather than letting Slack truncate them. Both mobile and admin delegate to this one action; a
  successful delivery writes `audit_logs.task_daily_report_slack_sent` with no report body or secret.

Hardening pass (2026-06-11): `quickCreateTask`/`createTask` roll back the inserted `tasks` row when
the `task_participants` insert fails (no DB transaction in this path, so the rollback is an explicit
delete) — this prevents author-invisible orphan rows, since visibility depends on participant
membership. `updateTaskCore` now also writes `image_urls`, so task-level photos are author-editable
after creation. Update-log photo upload is wired end-to-end (client upload → `addTaskUpdate` →
`task_updates.image_urls`). Detailed create always sets `is_inbox = false` (see Inbox Rules).

Bug fix (2026-06-12): sharing on detailed create failed with a NOT-NULL violation on
`task_participants.is_first_recipient`. `createTask` bulk-inserts the author row + recipient rows in
one array; PostgREST builds a single multi-row INSERT from the **union of keys** and fills any key a
row omits with **NULL (not the column default)**. The author row omitted `is_first_recipient`, so it
was written as NULL whenever recipients (which carry that key) were present. Fix: the author row now
carries the same keys (`is_first_recipient: false`, `added_by_user_id: null`) so the shapes are
uniform. Author-only inserts (private create, quick-add) were unaffected (single homogeneous row →
column default applies).

Bug fix (2026-06-12): the task-detail confirm modals (delete, author-leave / unshare-deletes-task,
remove-participant) used `position: fixed inset-0` but were rendered **inline**, so the mobile
shell's transformed scroll container trapped them (a transformed ancestor makes `fixed` relative to
itself, not the viewport) and they appeared stuck near the top instead of centered. Fix: each is now
`createPortal(…, document.body)` (guarded by `typeof document`), matching the existing body-portal
pattern used by the quick-add sheet, `SharePicker`, and `ContextPickerSheet`.

Bottom-sheet interaction (2026-06-15): every body-portaled bottom sheet here — quick-add, the
Calendar day sheet, the long-press context menu, `SharePicker`, `ContextPickerSheet`, `ReportSheet`,
the photo-attachment sheet (`PhotoGallery`), and the project create / members sheets — now shares one
iOS-style **drag-to-dismiss** primitive, `useSheetDragDismiss` (`src/components/shell/use-sheet-drag-dismiss.ts`).
Each sheet keeps its own open/close lifecycle and just spreads `handleProps` on the grab handle /
header, tags the container `data-sheet`, and applies `sheetStyle` / `scrimStyle`. Dragging the handle
follows the finger; release past `max(80px, 25% of sheet height)` or a ≥0.5 px/ms downward flick
dismisses (reusing the existing slide-out + `onClose`), otherwise it snaps back. The hook stops touch
propagation on the handle so the shell's pull-to-refresh / swipe-nav can't drag the background with
the sheet. Because the slide now dismisses, the **top-right close (X) buttons were removed** from
these sheets (scrim tap + Esc remain). X icons with other roles stay (remove-participant, chip clear,
search clear, select-mode cancel, the photo lightbox close). Full contract: Product `16` →
"2026-06-15 Bottom Sheets — iOS-style Drag-to-Dismiss".

Context link (2026-06-12): tasks can optionally link a building-only, building · room, reservation,
or guest context. The
picker mirrors the reservation calendar's active-room catalog (active-only, sub-units like 201/201_2
merged) via a shared resolver extracted into `src/lib/rooms.ts`; reservation-linked saves persist
`reservation_id` + `guest_name`, and context display survives later room deactivation. See "Context
Link (as-built 2026-06-12)" below.

Hardening pass 2 (2026-06-11): `shareTaskWithUsers` is now fail-safe — it checks the
`task_participants` insert result and short-circuits on failure, so a failed share never marks
`tasks.is_shared = true`, never writes a `system_shared` log row, and never emits notifications (no
false shared state). Update-log photo-upload failures are no longer swallowed: the compose area shows
an inline localized error (`tasks.errors.upload_failed`), keeps the typed text/selected photos, and
submits nothing so the user can retry. Removed task-level photos are now hard-deleted from Storage
(Option A): on core edit, `updateTaskCore` computes the detached set as `previous − new` from the
**server-truth** `task.image_urls` (never arbitrary client URLs), validates each resolves to a path
under `${organizationId}/task-images/` in the `request-images` bucket (host + bucket + org-prefix
checks, mirroring the announcements `extractStoragePath` pattern), and removes only those objects
after the DB row no longer references them. A failed Storage remove is non-fatal (logged) — the DB
reference is already detached, so the worst case is a stray file, not a broken task.

## Purpose

This document defines the recommended technical design for the Todo / Task workflow.

Important clarification:

- the older "sender/recipient copy" recommendation is no longer the product direction
- the confirmed direction is:

```txt
one task
+ one participant set
+ one unified update-log
```

## First-Slice Goal

Deliver:

- private personal tasks by default
- conversion from private to shared
- Today / Tomorrow / Inbox / Sent By Me / Completed (완료/기록) / Calendar views
- quick add + detailed create
- unified update-log with optional images

Do not include:

- admin web surface
- full recurring-work-scheduler overlap
- complex subtasks
- advanced natural-language date parsing
- complex recurrence exceptions

## Data Model Direction

The system should not use:

- independent sender/recipient task copies

Use:

```txt
tasks
+ task_participants
+ task_updates
```

## Recommended Tables

### `tasks`

Purpose:

- one canonical task record

Recommended fields:

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
priority text not null default 'normal'    -- normal | important | urgent
status text not null default 'open'        -- open | in_progress | completed | cancelled
is_inbox boolean not null default true
is_shared boolean not null default false
recurrence_rule text
recurrence_series_id uuid                    -- shared series id across real recurring instances (202606150003)
recurrence_instance_date date                -- this row's occurrence date inside the series (202606150003)
tags text[] not null default '{}'
image_urls text[] not null default '{}'
sort_order integer                          -- manual Today/Tomorrow drag order; NULL = unranked (202606120001)
completed_at timestamptz
completed_by_user_id uuid references profiles(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Notes:

- `created_by_user_id` is the original author
- original author remains the only core-content editor after sharing
- `is_inbox` is an explicit workflow flag
- `is_shared` is derived by participant count in logic, but a stored flag can simplify queries/UI
- `sort_order` was added by migration `202606120001_task_sort_order.sql` (nullable; global to the
  task, not per-user — see the drag-reorder section)

### `task_participants`

Purpose:

- who currently participates in the task

Recommended fields:

```txt
id uuid primary key
task_id uuid not null references tasks(id) on delete cascade
user_id uuid not null references profiles(id)
role text not null                  -- author | participant
is_first_recipient boolean not null default false
added_by_user_id uuid references profiles(id)
created_at timestamptz not null default now()
```

Rules:

- one unique row per `(task_id, user_id)`
- exactly one `author` row
- author row corresponds to `tasks.created_by_user_id`
- first recipient is optional for private tasks, and at most one participant row should hold `is_first_recipient = true`

### `task_updates`

Purpose:

- one unified update-log stream

Recommended fields:

```txt
id uuid primary key
task_id uuid not null references tasks(id) on delete cascade
created_by_user_id uuid references profiles(id)
update_type text not null           -- note | system_edited | system_shared | status_changed | completed | reopened
body text
image_urls text[] not null default '{}'
created_at timestamptz not null default now()
```

Notes:

- use this for both participant notes and lightweight system log entries
- `created_by_user_id` may be null only for system-generated events if implementation prefers that style
- `completed` / `reopened` are written again by `completeTask` / `reopenTask` (2026-06-13);
  `status_changed` remains historical-only (no current UI writes it)

## Core Editing Rules

### Core Content

Only the original author can edit:

- title
- description
- tags
- scheduled_date
- due_at
- all_day
- time_label
- recurrence_rule
- task-level `image_urls`

### Shared Collaboration State

Any current participant can update:

- update-log entries

## Inbox Rules

Inbox is an explicit task state, not only an inferred lack of dates.

As-built behavior (2026-06-11):

- quick-add creates `is_inbox = true` (the staging entry point) via `quickCreateTask`
- detailed create produces an organized task (`is_inbox = false`) via `createTask` — using the full create form is itself the deliberate "organize" act, so it does not land in Inbox
- the Quick Add sheet's one-tap **Add to Today / Add to Tomorrow** shortcuts (`quickCreateTodayTask` / `quickCreateTomorrowTask`) also create organized tasks (`is_inbox = false`, `scheduled_date` set)
- entry flow: the Quick Add sheet's **Save to Inbox** calls `quickCreateTask`; its **Full create** action links to `/mobile/tasks/new`, carrying any typed title via `?title=` (read into the form's `defaultTitle`, kept separate from `defaultDate` so Calendar's `?date=` prefill is unaffected). `/mobile/tasks/new` is the single full-create route, also used by the Calendar day sheet for date-prefilled creation.
- a task leaves Inbox through deliberate actions afterward — the swipe move actions (`moveTaskToToday` / `moveTaskToTomorrow` set `is_inbox = false`) — never implicitly from field edits. (Old `moveTaskToInbox` / `moveTaskOutOfInbox` / `setInbox` toggled `is_inbox`, which no view reads; removed 2026-10-28.)
- **Mobile 「관리함으로 옮기기」 (2026-10-28):** detail crumb 「⋯」 → BottomSheet row, shown only for a project task to its author (`canEditTaskCore`). `moveTaskToInbox(taskId)` (`src/app/mobile/tasks/[id]/actions.ts`) = same as PC `moveConsoleToInbox`: `project_id`/`section_id` -> null, date · time · recurrence kept, `is_inbox` untouched; returns `{ ok: true, previousProjectId, previousSectionId } | { ok: false, reason }` (no redirect, callable from a client toast). Undo = `restoreTaskToProject(taskId, projectId, sectionId)`: author only, project must still be in `getTaskScope`, section restored only if it still belongs to that project. No confirm; toast 「관리함으로 옮겼어요 · 되돌리기」 (6s), haptics success/error. Dead i18n key `swipeInbox` removed.
- shared tasks may remain in Inbox
- shared Inbox membership is common to all participants

Recommended first-slice permission:

- private task: author controls Inbox membership
- shared task: any participant may move it in/out of Inbox because this is workflow state, not protected core content

## Sharing Rules

### Private -> Shared

- add one or more participant rows
- set `is_shared = true`
- create a `task_updates` system entry

### Shared -> Private

- if all non-author participant rows are removed, set `is_shared = false`

### Participant Self-Remove

- delete that participant row
- after removal, the task disappears completely from that user's task scope

### Author Self-Remove

- treat as full task deletion
- delete task row, cascading participants/updates

## Query Rules

### Today

Include current-user visible tasks where:

- overdue
- due today
- or explicitly marked as today in the chosen app logic

Recommended sorting:

1. overdue
2. today items
3. then importance inside group

### Inbox

- visible tasks where `is_inbox = true`
- newest first

As-built note (2026-06-12): the current mobile `Inbox` tab label is operationally closer to
`All active / 관리함` than a strict `is_inbox = true` slice. The UI shows every active visible task
in one place and keeps `is_inbox` as a workflow flag manipulated by explicit actions.

### Tomorrow

- visible active tasks where `scheduled_date = tomorrow` or `due_at = tomorrow` in Tokyo
- manual drag order wins when `sort_order` is set; otherwise fall back to priority

### Sent By Me

- `created_by_user_id = current user`
- especially useful when `is_shared = true`
- sort by latest share/update signal

### Calendar

- visible tasks where `scheduled_date` or `due_at` is present
- support month view and agenda/list range view

As-built (2026-06-11): fully client-side in `TasksWorkspace` over the already-loaded task set — no
month-scoped server query. A `calMonth: { y, m }` state drives a navigable grid (`shiftMonth(±1)` with
12-month rollover; `goToday()` resets to the current month and selects today). Day placement and the
agenda both key off the shared `anchor(task)` (`dueDateOf ?? scheduledDate`, Tokyo) — the same value
used for list grouping and the date filter, so there is one calendar interpretation. The agenda groups
the shown month's dated tasks by `anchor` day (`anchor.slice(0,7) === monthPrefix`), sorted ascending.
Selected-date emphasis is decoupled from the sheet: `calDay` holds the selection (persists for grid
highlight) while `sheetOpen` controls the bottom sheet, so closing the sheet keeps the day highlighted
and re-tapping re-opens it. When `calDay` is present, a compact selected-date summary strip renders
above the agenda (date label, count, reopen CTA, clear-selection action) so the whole Calendar body
keeps the same context, not only the sheet. The personal/shared legend stays on the current month only.
Recurring tasks are now expanded into real rows inside the active operating window, so the Calendar
surface can show those generated occurrences rather than a single label-only master row.

## Search / Filter Rules

Required first-slice search/filter:

- title
- author name
- date / date range

As-built (2026-06-11): implemented **client-side** inside `TasksWorkspace` over the already-loaded,
org-scoped task list — no new server query or backend full-text index. One shared filter state
(`search`, `dateMode: single | range`, `dateFrom`, `dateTo`) is applied uniformly to the list views
via a local `matchesFilter(task)` / `applyFilter(list)` pair:

- text: case-insensitive `includes` over `` `${title} ${authorName}` ``.
- date: uses the same `anchor(task)` as grouping (`dueDateOf(task) ?? scheduledDate`, Tokyo); single
  mode is exact-equality, range mode is `from <= anchor <= to` with either bound optional; a `null`
  anchor never matches an active date filter.
- the bar renders on Today/Tomorrow/Inbox/Sent only (not Calendar).
- empty vs no-result is distinguished per view by comparing the pre-filter base list against the
  filtered list (genuine empty state vs a `noMatchState()` with a clear action).

If the dataset ever grows past what is reasonable to load client-side, move this predicate to a
server query — the `matchesFilter` semantics above are the contract to preserve.

Not required as core first-slice search (still deferred):

- description/body search
- participant name search
- priority search
- tag search

## 가시 범위 게이트 (as-built 2026-09-09)

**투두 읽기 경로는 RLS 만 믿지 않는다.** `tasks` 의 select 정책
(`202609030002_task_rls_org_scope.sql`)은 `is_platform_admin()` 이면 참여자 조건을 통째로
건너뛴다. 그 예외는 조직 간 운영·복구용으로 필요하지만, 투두 화면에 그대로 노출되면 플랫폼
관리자 계정이 조직 전원의 개인 투두를 자기 「오늘」 목록에서 보게 된다(2026-09-09 실제 발생).

`src/lib/tasks.ts` 의 `getTaskScope(session)` 이 뷰어의 가시 범위를 계산한다.

```ts
type TaskScope = { taskIds: Set<string>; projectIds: Set<string> };
```

- `taskIds` = `task_participants` 의 내 행 ∪ 내가 속한 프로젝트에 달린 작업 id
  - **예외(2026-10-28, 프로젝트 나가기):** 내가 멤버가 아닌 프로젝트의 작업에 걸린 **`author` 행은 뺀다**.
    작성자는 언제나 author 행을 가지므로, 그대로 두면 나간 · 빠진 사람이 자기가 쓴 프로젝트 할 일을 계속 본다.
    직접 초대 행(`role` 이 author 가 아닌 것)은 남는다. 규칙은 순수 함수 `buildTaskScope()` 하나 —
    `src/lib/__tests__/task-project-leave.test.ts`.
- `projectIds` = `project_participants` 의 내 행
- `react.cache` 로 **요청당 1회**만 계산한다 — 한 페이지 로드가 목록/회차/완료 로그를 병렬로
  읽으므로 매번 다시 조회하면 같은 쿼리가 서너 번 나간다.

적용 지점(모바일·콘솔이 같은 함수를 공유하므로 두 화면이 함께 닫힌다):

| 함수 | 게이트 |
| --- | --- |
| `getVisibleTasks` | 결과를 `scope.taskIds` 로 필터 |
| `getTasksByIds` | 같음 |
| `getOccurrenceStates` / `getOccurrenceOrders` | `task_id` 를 `scope.taskIds` 로 필터 |
| `getTaskCompletions(session)` | `task_id` 를 `scope.taskIds` 로 필터 (인자 추가) |
| `getTaskDetail` | 범위 밖이면 `null` (= 없음) |
| `getProjectTasks` | 비참여 프로젝트면 `[]` |
| `getVisibleProjects` / `getProjectDetail` (`src/lib/projects.ts`) | `scope.projectIds` 로 필터 / `null` |

**전제.** 모든 생성 경로가 작성자 참여자 행을 함께 넣는다(모바일 4개 + 콘솔 1개 + 반복 회차
인스턴스). 적용 전 실측: 작성자 참여자 행이 없는 작업 0건 / 소유자 참여자 행이 없는 프로젝트 0건.
이 전제가 깨지면 **본인 작업이 본인에게 안 보이게** 되므로, 새 생성 경로를 추가할 때 참여자 행을
빠뜨리지 않는다.

**RLS 정책은 바꾸지 않았다.** 관리자 예외는 그대로 두고 앱 경계에서 이중으로 막는 방식이다.

## RLS Direction

### `tasks`

Read:

- current user must be an active participant in `task_participants`
- 앱 쪽에서 `getTaskScope` 로 한 번 더 좁힌다 — 위 "가시 범위 게이트" 참고

Insert:

- allowed only when the acting user creates a task whose author is themselves

Update:

- original author can edit all fields
- non-author participants may update only workflow-state fields through controlled server actions

Delete:

- original author can delete the task
- no participant direct delete of the canonical task row
- participant self-remove should use a controlled action that deletes only the participant row

### `task_participants`

Read:

- current user is a participant on the parent task

Insert:

- via server action only, so author/share constraints stay consistent

Delete:

- author may remove any non-author participant
- participant may remove self

### `task_updates`

Read:

- current user is a participant on the parent task

Insert:

- current user is a participant on the parent task

Update / delete:

- keep simple in first slice: no edit/delete after posting, unless product later asks for it

## Server Actions / Routes

As-built actions (2026-06-12):

Create (`src/app/mobile/tasks/new/actions.ts`):

- `quickCreateTask` — quick-add → Inbox (`is_inbox = true`)
- `quickCreateTodayTask` / `quickCreateTomorrowTask` — one-tap day shortcuts
  (`scheduled_date` = today / tomorrow Tokyo, `is_inbox = false`, redirect to that day tab)
- `createTask` — detailed create (dates, share, time, priority, tags, photos, context link)

Mutate (`src/app/mobile/tasks/[id]/actions.ts`):

- `updateTaskCore`
- `moveTaskToToday` / `moveTaskToTomorrow` — swipe move actions; read a hidden `view` field and
  redirect back to the originating tab
- `moveTaskToInbox` / `moveTaskOutOfInbox` — exported but currently have **no UI call site**
  (kept for a future explicit inbox toggle)
- `shareTaskWithUsers`
- `removeTaskParticipant`
- `deleteTask` (detail) / `deleteTasksInList` (list multi-select batch; author-owned only)
- `reorderTasks` — Today/Tomorrow drag-reorder persistence (`sort_order`); ids filtered by `getTaskScope`
- `completeTask` / `reopenTask` — set/clear `status` + `completed_*`, log `completed`/`reopened`,
  fan out `task_completed` (complete only); programmatic (card circle + undo toast, detail button).
  Return `{ ok, occurrenceDate? }`; nothing is logged / notified when the write fails (2026-10-26)
- `setTaskProgress` — open ↔ in_progress for one-off tasks; rejects recurring (`reason: "recurring"`)
- `addTaskUpdate`

Report (`src/actions/task-report.ts`):

- `generateDailyReport(date)` — staff-only (`canGenerateDailyReport`); gathers the caller's own
  completions for the Tokyo `date` and returns a free, template-based 업무일지 (no LLM / no API key), or
  `{ ok: false, reason: "forbidden" | "empty" | "error" }`.
  **Returns a draft, not just a string (2026-08-03):** `{ ok: true, text, items, template }`
  (`DailyReportDraft`). `items` is the tidied, de-duplicated completed-task titles in completion
  order; `template` carries the already-localized header / labels / date label / author name and the
  `summaryOne` / `summaryMany` count phrases with an `{n}` placeholder (functions can't cross the
  server-action boundary). `text` is the same draft with **every** item included.
- **Assembly lives in `src/lib/daily-report.ts`** (`buildDailyReportText`), imported by the server
  action *and* both clients so numbering / summary can never drift between them. It is a separate
  module because a `"use server"` file may only export async functions.
- **Two sections (2026-08-04).** `DailyReportItem` = `{ text, section: "done" | "field" }`. `done` is
  todo completions; `field` is `getFieldActivities()` output. Numbering restarts at 1 inside each
  section, an all-unchecked section drops its heading, and the total counts every selected item.

Field activity (`src/lib/field-activity.ts`):

- `getFieldActivities({ organizationId, userId, locale })` — read-only union of completed cleaning
  sessions, closed maintenance reports, linen return registrations and filed order requests for the
  viewer, grouped by Tokyo operating day, over the same 120-day window as `getTaskCompletions()`.
  **Creates no rows.** Returns already-localized `label` strings (ko/ja/en table in the module, same
  pattern as the report template). Linen / order collapse to one record per day.
- Consumed by `generateDailyReport` (field section), `src/app/mobile/tasks/page.tsx` and
  `getAdminTasksData` (Completed tab). Cleaning days come from `cleaning_date` — **not** from
  `completed_at` — because the operating date and the calendar date differ for work finished after
  midnight.
- `sendDailyReportToSlack(date, editedText)` — server-only Incoming Webhook send of the reviewed
  report; rechecks the same permission and never returns the webhook URL to either UI.

Admin (`src/actions/users.ts`):

- `updateMemberReportAccess` — owner/office_admin toggles `profiles.can_generate_report`.

Reads are not per-view actions: the page loads one org-scoped `getVisibleTasks(session)`
(`src/lib/tasks.ts`, RLS-scoped, **all statuses**) and every view (Today / Tomorrow / Inbox / Sent /
Completed / Calendar) filters client-side in `tasks-workspace.tsx`.

## Dates / Recurrence Direction

### Single-date model (as-built 2026-07-24, A안)

The create/edit UI exposes **one date** and maps it to `due_at` (see product doc `18` → "Single-date
model"). No schema change: `scheduled_date` stays as a column but the form submits `scheduledDate=""` +
`dueDate=<date>`, so `createTask` / `updateTaskCore` (unchanged — they already route through
`normalizeTaskDateTime`) write due-only and clear `scheduled_date`. The anchor helper
(`taskAnchorDateInput` = `tokyoDateOf(dueAt) ?? scheduledDate`) means legacy scheduled-only rows still
resolve. `quickCreateTodayTask` / `quickCreateTomorrowTask` and `moveTaskToToday` / `moveTaskToTomorrow`
were switched from `scheduled_date` to `due_at` (a shared `anchorToDate(task, date)` helper in
`[id]/actions.ts` builds the Tokyo all-day/timed `due_at`, preserves `time_label`, sets
`scheduled_date: null`, and re-anchors `recurrence_instance_date` for a series). The unified
date/time/repeat picker is `src/components/tasks/task-schedule-sheet.tsx` (`TaskSchedulePicker`,
canonical `BottomSheet`); `MiniCalendar` / `TimeWheels` (`date-time-fields.tsx`) are reused inside it.

**Duration + yearly (as-built 2026-07-24).** New nullable column `tasks.duration_minutes` (migration
`202607240001_task_duration.sql`) stores a same-day time-block length; `TaskRecord.durationMinutes`
maps it, and it is added to the shared `TASK_SELECT` list (so `getVisibleTasks` / `getProjectTasks` /
`getTaskDetail` all read it). `createTask` / `updateTaskCore` parse `durationMinutes` (int 1–1440, else
null) and **guard it to `null` unless `timeLabel` is set** (all-day tasks have no duration). A new
`yearly` recurrence rule was added to the engine: `"yearly"` in `STANDARD_RECURRENCE_RULES`, a
`shiftYearlyYmd(ymd, ±1)` helper (month/day preserved, Feb-29 clamped), and cases in
`nextOccurrenceDate` / `previousOccurrenceDate`; `resolveRecurrenceRule` accepts it automatically via the
STANDARD list, so calendar previews / occurrence state / reminders support yearly with no extra
change. *(2026-10-28: the roll-forward wording that stood here is obsolete — roll-forward was retired on
2026-07-30, and `nextOccurrenceDate` / `previousOccurrenceDate` were deleted from `tasks.ts`. Yearly
dates are now generated from the anchor — see 「2026-10-28 반복 회차 감사 반영」 at the top.)* The schedule sheet's Repeat sub-picker renders **contextual labels** (매주 {요일} / 매월 {일}일 /
매년 {월 일}) derived from the selected date; display helpers (`repeatLabel` in card/detail) map `yearly`
to `repeatYearly`.

### Recurrence occurrence model (as-built 2026-07-30 — supersedes roll-forward)

Roll-forward is removed. A recurring task is a single row with a **fixed** anchor
(`recurrence_instance_date`); occurrences are virtual (rule-computed). Per-occurrence state lives in
**`task_occurrence_state`** `(task_id, occurrence_date, state: completed|skipped|moved,
completed_by_user_id, moved_to_date)` (migration `202607300001`, RLS = participant read / service
write). See `docs/planning/01-decision-log.md` → "2026-07-30 롤포워드 폐지".

- **Pure helpers** (`src/lib/tasks-recurrence.ts`, client+server): `outstandingOverdueOccurrences(rule,
  anchor, today, resolvedDates)` = rule occurrences in `[anchor, today)` with no state; `OccurrenceState`
  type; `isResolvedOccurrenceState`. Twin-safe (server `tasks.ts` and both UIs import from here).
- **Write payloads are type-checked natively (2026-09-03).** `src/types/database.ts` was regenerated
  with `Relationships`, so `Database` now satisfies `@supabase/supabase-js`'s `GenericSchema` and
  `.insert({...})` / `.update({...})` type-check without a cast. The 2026-08-28 stopgap
  (`src/lib/db-write.ts`) is deleted and its 79 call sites reverted. `TASK_SELECT` is a string
  literal (`as const`) rather than a joined array, so `.select()` results are typed too — the old
  `as TaskRow[]` casts are gone. See the decision log, 2026-09-03 (2).
- **Batch reads for bulk actions (2026-08-28).** `getTasksByIds(session, ids)` — one RLS-scoped
  select + `hydrate` (batched), so query count is fixed regardless of id count. `bulkDeleteConsoleTasks`
  previously called `getTaskDetail` per id, turning a 200-item delete into hundreds of queries.
- **`getVisibleTasks` bounds finished tasks to 180 days (2026-08-28).** Active work
  (`open`/`in_progress`) is never bounded — overdue must persist forever (2026-07-30). The window only
  drops completed/cancelled rows older than 180 days, which must stay wider than the 120-day
  completion log or the 완료·기록 tab would show records whose task row was dropped. `created_at` is
  checked alongside `completed_at` to protect legacy rows with a null `completed_at`.
- **`setTaskSortOrders` writes only changed rows (2026-08-28).** Lives beside `setOccurrenceOrders` in
  `task-occurrences.ts`; the four reorder actions previously fired one UPDATE per index (cap 500).
- **Pure modules (client-safe, 2026-08-25).** `@/lib/tasks` pulls in supabase/session, so client
  components could never import it by value — which is why Tokyo date helpers had been re-implemented
  **seven times** inside the tasks feature and the date/occurrence predicates existed twice (console
  `helpers.ts` vs. mobile inline). Both now have one home:
  - `src/lib/tokyo-date.ts` — `tokyoToday` / `tokyoDateOf` / `ymdShift` / `isYmd`. `@/lib/tasks`
    re-exports these; `admin/tasks/helpers.ts` aliases them under its existing names.
  - `src/lib/task-predicates.ts` — `anchorDateOf`, `occursOn`, `isOverdueOneOff`, `isTodayOneOff`,
    `isTomorrowOneOff`, `isOpenOccurrenceOn`, `overdueOccurrenceDatesOf`, `prioRank`/`prioSort`,
    `backlogCoveredByOccurrenceOn`. **`today` is always a parameter** — a module that reads "now"
    itself drifts between server render and client, showing up as an off-by-one-day near midnight.
  - Tested in `src/lib/__tests__/task-predicates.test.ts` (27 cases). Being testable is the point:
    while these lived inside screen components there was no way to assert on them.
- **Mutations** (`src/lib/task-occurrences.ts`, service-role): `completeOccurrence` /
  `clearOccurrenceState` / `skipOccurrences` / `moveOccurrences` / `resolvedOccurrenceDates`. Shared by
  mobile + console actions (no twin drift). Added 2026-08-25:
  - `occurrenceStatesForTask(taskId)` → `Map<occurrence_date, OccurrenceState>`. One task-scoped read
    that answers both "which dates are resolved" and "is this one *completed*" —
    `resolvedOccurrenceDates` only answers the former, and the detail page was otherwise pulling the
    org-wide `getOccurrenceStates()` (400 days, whole organization) to check a single date.
  - (`hasOpenOccurrenceOn` was replaced on 2026-08-25 by `backlogCoveredByOccurrenceOn` in
    `task-predicates.ts` — it gated on "today's occurrence is still *open*", so completing today's
    occurrence first made the carry create a duplicate. See the decision log.)
  - `createCarryOverTask({task, organizationId, userId, date})` — the make-up one-off + its author
    participant row. Mobile and console previously held copy-pasted twins of this insert block.
- **Loader**: `getOccurrenceStates(session)` (RLS-scoped, ~400-day window) → `OccurrenceStateRecord[]`;
  wired into `getAdminTasksData` (console) and the mobile `page.tsx`, passed to the workspace/console as
  `occurrenceStates`.
- **Actions**: `completeTask`/`reopenTask` (mobile) and `completeInternal`/`reopenInternal` (console)
  take an `occurrenceDate`; recurring → write/clear `task_occurrence_state` (row never rolls, stays
  `open`) + still log `task_updates` completed/reopened (so 완료탭/보고서 aggregation is unchanged);
  one-off → existing `status`/`completed_at`. `carryOverdueToToday`/`skipOverdueOccurrences` (mobile) and
  `carryConsoleOverdueToToday`/`skipConsoleOverdue` (console) recompute the outstanding overdue set
  server-side; carry marks them `moved` and inserts a one-off carry-over task via
  `createCarryOverTask` — **only when today has no still-open occurrence** (2026-08-25; otherwise
  today's own occurrence doubles as the make-up and the copy was a visible duplicate). The copy is
  anchored by `due_at` alone, not `scheduled_date`, because both overdue predicates read `due_at`.
  Skip marks them `skipped`. `isOverdueOwned` and the console date predicates
  (`isOverdue`/`isTodayTask`/`isTomorrowTask`) now **exclude standard-recurring** (handled per-occurrence).
  **Move actions never touch `recurrence_instance_date` (2026-08-25).** `moveTaskToToday` /
  `moveTaskToTomorrow` / `moveConsoleToToday` / `moveConsoleToTomorrow` reject a standard-recurring
  task with `recurring_series`; writing the anchor there re-phased the whole rule and erased the
  overdue backlog (which is computed forward from the anchor). `anchorToDate` and the console's two
  inline duplicates of that line were removed. Only an explicit user edit (`updateTaskCore` /
  `updateConsoleTaskCore`) may move a series anchor.
- **UI**: 오늘/내일/캘린더/day-sheet expand recurring via `occursOn`; each occurrence's done state =
  `task_occurrence_state`; the row checkbox threads `occurrenceDate` (`TaskCard.occurrence` prop on
  mobile, `renderRow(t, { occurrence })` on console). Overdue recurring = one grouped row per task
  ("N일 밀림") with 오늘로 가져오기 / 삭제. **Compiler note:** on mobile, `tomorrowDate` had to be
  `useMemo`'d — as a plain render const flowing into the occurrence helpers it made the React Compiler
  bail the whole component (preserve-manual-memoization).

### Time handling (as-built 2026-06-11)

`createTask` and `updateTaskCore` apply one shared rule via `normalizeTaskDateTime()` in
`src/lib/tasks.ts`, so create and edit can never drift:

- `time_label` is the authoritative optional time-of-day (`"HH:MM"`); `all_day = !time_label`.
  Display everywhere keys off `time_label` (cards show a time chip only when set; the detail Time row
  shows the time or "All day"). `due_at`'s clock component is **not** used as the time source — an
  all-day task with a due date stores `due_at` at `00:00` Tokyo, so reading a time from it would be
  wrong.
- a time requires a date anchor (scheduled or due). A time entered with **no date at all** is
  **rejected, not silently dropped**: `taskTimeWithoutDate()` (also in `src/lib/tasks.ts`) gates the
  flow — the form blocks submission with `tasks.errors.time_needs_date`, and both server actions
  re-check and redirect back with the same error (create → `/mobile/tasks/new`, edit →
  `/mobile/tasks/[id]/edit`). `normalizeTaskDateTime` still drops a stray time defensively, but the
  validation makes that path unreachable for a normal save, so no time is ever lost without feedback.
- `due_at` is built from the due date + kept time at `+09:00` (Tokyo) when a due date exists, else
  `null`. An all-day due date persists at `00:00` local — the existing intentional pattern, since
  `anchor()` / `tokyoDateOf()` read only the Tokyo calendar date. **Detail rendering** honors
  `all_day`: an all-day due date is shown date-only (`longDateOnlyIso`), never `00:00`, so it cannot
  contradict the "All day" time row; only genuinely timed tasks render date + time.
- inputs are validated: a date must be a **real calendar date** (`isValidYmd` — `2026-02-31` is
  rejected, not rolled to 3/3) and a time a real `HH:MM` in 00:00–23:59 (`isValidHm` — `25:99` used to
  throw a `RangeError` → 500; both 2026-10-28, exported from `src/lib/tasks.ts`), otherwise it is treated as
  unset (handles partial/invalid time states). Toggling all-day back on clears `time_label` and
  normalizes `all_day`/`due_at` with no stale leftovers.

This narrows the previously underspecified time behavior; no broader scheduling semantics changed.

### Quick Date Helpers

Support later in UI/server handling:

- today
- tomorrow
- weekday
- weekend
- direct date pick

### Recurrence

Recommended first-slice recurrence values:

- daily
- weekly
- monthly
- weekdays
- weekends
- custom rule string

As-built (2026-06-15):

- Recurrence now creates **real task-instance rows**. Each series shares a
  `recurrence_series_id`; each occurrence row stores its own `recurrence_instance_date`,
  completion state, and update log. The originally saved task is the first occurrence.
- A repeat rule **requires a date anchor** (`scheduled_date` or `due_at`). The form blocks repeat
  with no date (`tasks.errors.repeat_needs_date`), and both server actions re-check it.
- ~~`materializeRecurringTasks()` pre-generated real occurrence rows for the active task window and
  was called by `getVisibleTasks` / `getProjectTasks` / `getTaskDetail` / the reminder cron before
  each read.~~ **Deprecated by the 2026-06-16 Todoist-style roll-forward switch**, which was itself
  **retired on 2026-07-30**: a recurring task is now a single row with a fixed anchor that never rolls;
  per-occurrence completion lives in `task_occurrence_state`, and the calendar expands occurrences
  virtually via `recurringOccurrencesInRange`. No read path calls it anymore, and the dead helper
  (plus its private `getRecurrenceWindow` / `fastForwardRecurrenceCursor` / `buildRecurringTaskInsert`
  helpers) was **removed from the code on 2026-07-24**.
- Series continuation uses the **latest occurrence row's** repeat rule. So changing repeat on the
  latest row changes future generation from that point, and clearing repeat there stops the series.
- `createTask` and `updateTaskCore` persist identically through one shared helper,
  `resolveRecurrenceRule(submitted, previousRule)` in `src/lib/tasks.ts`. A standard rule
  (`daily | weekly | monthly | weekdays | weekends`) passes through; empty/None or any unrecognized
  value fails closed to `null`. No stale rule survives a clear in edit.
- **`custom` is round-trip only, enforced server-side (not UI-only).** `resolveRecurrenceRule` keeps
  `custom` solely when `previousRule === "custom"`:
  - create passes `previousRule = null`, so a new task can **never** be created with `custom`
    (submitted `custom` → `null`);
  - edit passes `previousRule = task.recurrence_rule`, so a task that already has `custom` may keep it,
    switch to a standard rule, or clear it — but a **non-custom task can never be turned into `custom`**
    (submitted `custom` on a non-custom task → `null`).
  This closes the gap where a crafted request could assign `custom` despite the UI omitting it. The
  form still omits `custom` from new choices and only renders a read-only `custom` chip when the loaded
  task already has that value. **Bare `custom` stays round-trip only even after the 2026-07-29
  weekday builder below** — it carries no schedule, so it must not become newly creatable.
- Display helpers (`repeatLabel` in `task-card.tsx` and `task-detail-view.tsx`) map all six values to
  the shared `tasks.repeat*` i18n keys, so labels stay consistent across cards, detail, list, and
  calendar surfaces.

### 사용자 지정 요일 반복 (2026-07-29)

"매주 월·수·금"처럼 **사용자가 직접 요일을 고르는** 반복. 위의 bare `custom`(요일 정보 없음)과는
별개의 값이며, 그쪽은 기존 round-trip 동작을 그대로 유지한다.

**저장 형식** — 기존 `tasks.recurrence_rule` **text 컬럼 그대로**, 마이그레이션 없음.

```
custom:<d>[,<d>…]     d = JS 요일 (0=일 … 6=토), 중복 제거 + 오름차순
예) custom:1,3,5      매주 월·수·금
```

`custom:`(요일 0개)는 **유효하지 않다** — 파서가 `null`을 돌려주므로 저장되지 않는다. UI는 이 상태를
"사용자 지정 모드는 켜졌지만 아직 안 고름"으로만 쓰고, 요일이 0개면 적용/완료 버튼을 잠근다.

**파서는 하나뿐이다.** `src/lib/tasks-recurrence.ts`가 `CUSTOM_RECURRENCE_PREFIX` /
`parseCustomWeekdays` / `buildCustomRecurrenceRule` / `isCustomWeekdayRecurrence` /
`formatCustomWeekdays` / `formatWeekday` / `WEEKDAY_ORDER`를 export하고, **서버 쌍둥이인
`src/lib/tasks.ts`가 이 모듈에서 import한다**(재구현하지 않음).

> ⚠️ **왜 이게 중요한가.** 두 파일은 각자 `STANDARD_RECURRENCE_RULES` 표를 갖고 있고,
> `tasks-recurrence.ts` 헤더가 경고하듯 **한쪽에만 있는 규칙은 조용히 어긋난다** — 지난 반복 작업이
> `tasks.ts`에서는 롤포워드되는데 dismiss/reschedule 분기는 `tasks-recurrence.ts`의 판정을 보고
> **하드 삭제**한다. 커스텀 규칙 판정을 한 모듈에 두고 양쪽이 그걸 import하게 만들어, 이 어긋남이
> 구조적으로 불가능하게 했다.

**판정 함수**

| 파일 | 함수 | 의미 |
| --- | --- | --- |
| `tasks-recurrence.ts` | `isStandardRecurrence` | 표준 6종 **+ `custom:요일`**. "살아있는 반복 작업인가" 게이트 |
| ~~`tasks.ts`~~ | ~~`hasRecurrenceMath` / `isStandardRecurrenceRule`~~ | 2026-10-28 삭제 — 롤포워드 쌍둥이 계산과 함께 지움. `tasks.ts` 는 `STANDARD_RECURRENCE_RULES` 도 `tasks-recurrence.ts` 에서 가져온다 |

**날짜 계산** — 기존 `weekdays`/`weekends`의 전진 스캔 루프를 요일 집합만 바꿔 재사용한다
(`nextWeekdayOccurrence` / `stepToWeekday`). ~~앵커 날짜 자체는 규칙과 무관하게 항상 첫 항목으로
포함된다.~~ **2026-10-28 변경:** 요일 묶음 규칙(평일 · 주말 · `custom:`)은 규칙에 맞는 날만 낸다 —
첫 회차는 앵커 이후 처음 맞는 요일이다(맨 위 「2026-10-28 반복 회차 감사 반영」).

**서버 검증** — `resolveRecurrenceRule`이 `custom:…`을 **재파싱 후 재직렬화**한다. 조작된 요청이
`custom:5,1,1`이나 `custom:9`를 보내도 각각 `custom:1,5` / `null`로 정규화된다.

**UI**

- 어드민(`admin-tasks-console.tsx` 일정 팝오버): 반복 목록 맨 아래 "사용자 지정" 행 → 펼치면
  일~토 7칸 토글(`.wdpick`/`.wdchip`). 요일 0개면 **적용 버튼 비활성**.
- 모바일(`task-schedule-sheet.tsx`): 같은 구조의 7칸 토글. 이 시트는 **commit-on-close**라서 버튼
  비활성만으로는 부족하다 — 드래그로 닫아도 미완성 규칙이 저장되지 않도록 `draftRef`에서
  `custom:`(요일 0개)를 `""`(반복 없음)으로 정규화한다. 서버도 같은 값을 fail-closed 처리하므로
  화면과 저장값이 어긋나지 않는다.
- 라벨: 어드민은 `repCustomDays`("매주 {wd}"), 모바일은 기존 `repeatWeeklyOn`("매주 {w}") 재사용.
  요일 이름은 제품 문구가 아니라 로케일 데이터이므로 `Intl`(ko/ja는 narrow "월", en은 short "Mon")로
  뽑고, 구분자는 ko/ja `·`, en `, `.

**i18n 신규 키** — 어드민 `repCustomDays`/`repPickDays`/`repPickDaysHint`,
모바일 `repeatPickDays`/`repeatPickDaysHint` (각각 ko/ja/en 동시).

Not required in first slice:

- exception dates
- advanced recurrence-end modeling
- a custom rule builder / parser

## Context Link (as-built 2026-06-12)

A task may optionally point at an operational context (building-only, building · room, reservation,
or guest). The
columns already exist on `tasks` (`property_id`, `room_id`, `reservation_id`, `guest_name`); this
slice wires the picker → save → display path. It deliberately stays separate from the reservation
calendar and the cleaning room axis — it only *references* those records.

### Picker server actions (`src/actions/task-context.ts`)

All three mirror the **reservation calendar's active-room catalog** rather than querying
`properties`/`rooms` raw, so the picker shows the same active inventory as the calendar:

- `fetchPickerBuildings()` — active buildings derived from `getActiveRoomCatalog`, grouped by
  canonical property name; returns `{ id (canonical name), name (localized), totalRooms, todayGuests }`.
  Today's guest count resolves live reservations through the shared resolver.
- `fetchPickerRooms(propertyId)` — active rooms for the building, **deduped by display label** so
  sub-units collapse (`201` / `201_2` → one `201`); `occupied` flags come from today's live
  reservations resolved to display labels.
- `fetchRoomReservations(propertyId, displayRoomLabel)` — real bookings for that display room across
  the current + next month window (Tokyo), filtered by resolving each reservation to its active-room
  display label so sub-unit bookings surface under the merged room.

Provisional fallback: when `getActiveRoomCatalog` returns `undefined` (org has no classified
room-master rows), all three fall back to a legacy `properties`/`rooms` listing with exact
`room_label` reservation matching — same provisional/authoritative split the calendar uses.

### Shared resolver (single source of truth)

The reservation → active-room resolution was extracted into `src/lib/rooms.ts` so the calendar and
the context picker can never drift:

- `getRawPayloadString(rawPayload, keys)`
- `buildGlobalExternalRoomToCanonical(catalog)`
- `resolveReservationCanonicalRoomLabel(item, { lookups, globalExternalRoomToCanonical, isAuthoritative })`
  — priority: raw_payload room/unit id → unit name → reservation `room_label` (exact then normalized),
  with the authoritative-vs-provisional drop rule.

Use `getDisplayRoomLabel(canonicalProperty, <resolved key>)` to collapse sub-units for display. The
calendar page still carries a behaviorally identical inline copy; unifying it onto the lib helper is a
safe later cleanup.

### Save path

- The picker's `onSelect` populates the form's `linkedCtx`; `handleSubmit` appends `ctxPropertyId`,
  `ctxRoomId`, `ctxReservationId`, and `ctxGuestName` to the form data.
- `createTask` / `updateTaskCore` parse all four and write `property_id` / `room_id` /
  `reservation_id` / `guest_name` (empty → `null`, which clears the link on edit). The edit page seeds
  `initialCtx` from the task's `resolvedContext` (UUIDs included) so an existing link round-trips
  without re-picking.
- **Building-only links are first-class.** The shared `ContextPickerSheet` now exposes a building-only
  alt action on the room step; it persists `property_id` with `room_id = null` and no reservation
  fields, which is valid for building-level operational notes.
- **UUID sourcing**: `getActiveRoomCatalog` / `ActiveRoomCatalogItem` carry `roomId` (`rooms.id`) and
  `propertyId` (`rooms.property_id`); the picker surfaces them on `PickerBuilding.propertyId` and
  `PickerRoom.{roomId,propertyId}`. A merged display room (201 = {201, 201_2}) uses the **base
  sub-unit** (canonical key === display label) as its representative `room_id`. So a **room-only
  link** (building · room, no reservation) now persists `property_id` + `room_id` and renders its
  name in the chip/detail (previously these were unsaved and the room-only chip was blank).
- `reservations` has no `room_id`/`property_id` (text `room_label`/`property_name` only); the picker's
  room/property UUIDs come from the `rooms` catalog, not the reservation.

### Hydrate / display

- `buildLinkedContext()` in `src/lib/tasks.ts` resolves `TaskRecord.resolvedContext` during `hydrate`
  via batch joins (reservation → property_name/room_label/source/dates; properties/rooms for
  building-only and room-only links), and **normalizes** the reservation's raw labels to canonical
  property + merged display room
  (`荒木町A` / `201_2` → `아라키초A` / `201`) for consistent chips/detail.
- When only `property_id` is present, the linked-context chip/detail still resolves and displays the
  building name; if `room_id` is also present, the room number is shown too.
- **Deactivation safety**: these context joins are **not status-filtered**. The picker offers only
  active rooms for *new* links, but a task already linked to a room/reservation that later goes
  inactive keeps resolving and displaying its context.

### Deep-link to the reservation calendar (auto-open as-built 2026-06-12)

`LinkedContextBlock` ("go to reservation") navigates to
`/mobile/calendar?property={canonicalName}&month={check-in YYYY-MM}&reservationId={id}`. The calendar
(`src/app/mobile/calendar/page.tsx`) accepts `property` (canonical name, matched via
`getCanonicalPropertyName`), `month` (`YYYY-MM`), and `reservationId`.

- **Auto-open**: when `reservationId` is present, `MobileCalendarView` opens that reservation's detail
  sheet on arrival, so the guest info appears immediately (no extra tap).
- **Building-only / room-only deep links**: when there is a building but no `reservationId`, the
  calendar opens on that building without auto-opening a reservation sheet.
- **Read params from the live URL, not the server prop.** Both `reservationId` and `property` are read
  client-side via `useSearchParams()` (with the server prop as a fallback). A soft `router.push` to
  `/mobile/calendar` can serve a **prefetched/cached RSC payload** whose `searchParams` differ from the
  URL (e.g. the param-less building-picker payload), leaving the server prop stale — which is why the
  modal previously needed a manual refresh. The reservation list / room maps are fetched independently
  of these params, so deriving them from the URL renders correctly without a refresh.
- **StrictMode-safe auto-open**: the open is scheduled in a `requestAnimationFrame` and the
  "already-opened" guard ref is set **inside** that callback (not before scheduling), so React's
  dev mount→cleanup→mount double-invoke can't cancel the only scheduled open.
- Room-only links omit `reservationId` (calendar opens, no sheet) and `month` (→ current month).
  Guest-only links (no `propertyName`) render the card non-interactive (button `disabled`, affordance
  hidden).
- The in-create-form context card's **"예약 보기"** button (`ContextLinkSection`) does the same
  `router.push` to the calendar. Because that unmounts the create form, `TaskCreateForm` persists an
  **in-progress draft to `sessionStorage`** (key `taskDraft:${mode}:${taskId ?? "new"}`) on every
  change and restores it on mount, so the round-trip keeps everything typed. Uncontrolled
  title/description are restored by writing their DOM `value`; state fields are applied in a
  `queueMicrotask` (avoids sync setState in the effect body). The draft is cleared on successful save
  and on explicit back-to-list; unuploaded photo `File`s are the only non-restored field.

### Tomorrow tab + day-tab swipe (as-built 2026-06-12)

A second day tab, **Tomorrow** (`view=tomorrow`), sits next to Today and mirrors its full behaviour
(card layout, chips, drag-reorder), filtered to `isTomorrow` = active && anchored to `ymdShift(today,
1)` (Tokyo). Added to the page `VIEWS` allow-list, the workspace `View` union, and the chip tabs
(`Sunrise` icon).

Swipe action is parameterised per view via `TaskCard`'s `swipeAction: "today" | "tomorrow"` (replacing
the old boolean `showMoveToday`): Today → `moveTaskToTomorrow` ("내일로"), every other swipe-enabled
view → `moveTaskToToday` ("오늘로"). In the current IA that means Tomorrow + Inbox can pull a task to
today, while Sent/Calendar keep swipe disabled. Both server actions read a hidden `view` field and
redirect to `/mobile/tasks?view=<originating tab>` (allow-listed) so the user stays on the tab they
swiped from.
`moveTaskToTomorrow` sets `scheduled_date` = `ymdShift(tokyoToday(), 1)`, `is_inbox = false`. The
swipe reveal is a single fixed-width (74px) button; Sent/Calendar still pass `swipe={false}`.

### Drag-reorder, day tabs (as-built 2026-06-12)

Manual drag-and-drop ordering for the **Today and Tomorrow** tabs.

- **Schema**: `tasks.sort_order` (nullable `integer`, migration `202606120001_task_sort_order.sql`).
  NULL = unranked → app falls back to priority order (pre-reorder behaviour preserved). Global to the
  task, not per-user (MVP limitation, documented in the migration).
- **Sorting**: `tasks-workspace.tsx` sorts the Today Overdue/Today sections and the Tomorrow list with
  `orderSort` — `sort_order` ascending wins; ties and unranked tasks fall back to `prioSort`; ranked
  tasks always precede unranked.
- **Server action**: `reorderTasks(orderedIds)` in `src/app/mobile/tasks/[id]/actions.ts` sets each
  id's `sort_order` to its index (0..n), **org-scoped** (service client, `eq(organization_id)`),
  `revalidatePath("/mobile/tasks")`. Mirrors the `deleteTasksInList` session/permission pattern.
- **Component**: `src/components/tasks/reorderable-task-list.tsx` owns the order state and the drag.
  Pointer-based: drag starts from a **dedicated grip handle** rendered by `TaskCard` (`reorderable`
  prop). The handle has `touch-action:none` and stops touch/pointer/click propagation, so it never
  triggers the card's tap, long-press menu, or swipe. While dragging the order array is held fixed and
  the move is previewed (dragged row follows the finger; crossed rows shift by one "slot" =
  measured row height + 8px gap, handling variable card heights); the array is committed once on drop,
  set optimistically, and persisted. Window `pointermove`/`up` listeners are attached **once** on
  mount and gated on a `dragging` ref (stable add/remove); render-time values are mirrored into refs
  via effects to satisfy `react-hooks/refs` (no ref read/write during render).
- **Disabled** (handles hidden, plain list) when a search/date filter is active (list is a subset) or
  in multi-select mode (card body owns the tap).

### i18n

`contextLink*` / `contextPicker*` keys plus `contextLinkedSection` / `contextGoToReservation`,
`reorderHandle` (drag handle aria-label), the Tomorrow-tab set (`viewTomorrow` / `secTomorrow` /
`tomorrowEmptyTitle` / `tomorrowEmptySub` / `swipeTomorrow`), and `quickAddTomorrow` — all in
ko/ja/en.

## Images

Task-level images:

- optional
- max 5 for regular tasks; **max 20 for project tasks** (`project_id` set) — 2026-06-15. The cap is a
  single `maxImages` value threaded through: `TaskCreateForm` (`maxImages` prop) →
  `AnnouncementImageUploader` (`maxImages` prop, default 5), and re-applied server-side in
  `createTask` (`linkedProjectId ? 20 : 5`) and `updateTaskCore` (`task.projectId ? 20 : 5`). No
  storage/RLS change — the `request-images` policy validates per-file path only, not row count.
  i18n: `tasks.photosMax20` / `tasks.photosCountError20` (ko/ja/en).
- **Existing photos are never cut by the cap (2026-10-19).** Edits (`updateTaskCore` /
  `updateConsoleTaskCore`) store `mergeTaskImageUrls(previous, requested, isProjectTask)`
  (`src/lib/task-images.ts`): URLs the task already has are kept even above the cap, only *new* URLs are
  capped (accepted while the total is under the limit). Before this, moving a project task with 15 photos
  to 관리함 (`moveConsoleToInbox` → cap 20 → 5) and then editing anything sliced the list to 5 and
  `cleanupRemovedTaskImages` hard-deleted the other 10 from storage. Storage deletion now only happens
  for photos the author actually removed. The uploaders already hide "add" at/over the cap, so an
  over-cap task keeps its photos and simply can't take more. `sanitizeTaskImageUrls` (plain cap) is for
  creates only. The only storage delete path for task photos is `cleanupRemovedTaskImages`.
  Regression: `src/lib/__tests__/task-images-merge.test.ts`, `task-occurrence-status-undo.test.ts`.
- **Only our own storage URLs are accepted (2026-10-26, mobile).** `isOrgTaskImageUrl(url, org, folder)`
  accepts a URL only if it is a `request-images` public object on our Supabase host under
  `{org}/task-images/` (`{org}/task-update-images/` for update-log/memo photos), with no `..` segments.
  `createTask` uses `sanitizeTaskImageUrls(urls, true, org)`, `updateTaskCore` passes the org to
  `mergeTaskImageUrls` (only *newly added* URLs are checked — existing ones stay), and `addTaskUpdate`
  filters memo URLs by the `task-update-images` folder. The upload path is
  `{org}/{folder}/{random requestId}/{uuid}.{ext}` for both create and edit (the task id does not exist
  yet on create), so the rule is the org folder, not the task's own folder. The admin console callers
  still pass no org (unchanged behaviour there).
- **Deletion requires no other reference (2026-10-26).** `cleanupRemovedTaskImages` (mobile + console)
  now deletes a removed URL only if it is under `{org}/task-images/` **and no other task row in the org
  still lists it in `image_urls`** (soft-deleted rows count). This closes «attach a colleague's photo URL,
  save, then remove it → their file is deleted». If the reference check errors, nothing is deleted
  (fail closed). Regression: `src/lib/__tests__/task-images-org-guard.test.ts`.
- **Project delete also removes memo photos (2026-10-29).** Deleting a project cascades `projects → tasks →
  task_updates` rows, but storage files stayed. `collectProjectImageUrls` (`task-images.ts`, shared by mobile
  `deleteProject` and console `deleteConsoleProject`) collects, *before* the delete, both task photos and memo
  (`task_updates.image_urls`) photos of the project's tasks (soft-deleted included). After the delete,
  `cleanupRemovedTaskImages` handles task photos and the new `cleanupRemovedTaskUpdateImages` handles memo
  photos — only `{org}/task-update-images/` objects no remaining `task_updates` row still lists; reference-check
  error → nothing deleted. Section delete stays a soft delete (restorable), so it does not touch files.
  Regression: `src/lib/__tests__/task-project-delete-images.test.ts`.

Update-log images:

- optional
- max 5 per update entry (unchanged — the 20 cap applies only to task-level photos on project tasks)

Recommended MVP choice:

- reuse current direct-upload pattern and file rules

### Viewer (as-built 2026-06-12)

Previously the task detail showed only a "사진 N장" count for both task-level and update-log photos —
the attachments were never actually viewable. `src/components/tasks/photo-gallery.tsx` (`PhotoGallery`)
now renders them, used in both spots in `task-detail-view.tsx` (task header `size="md"`, update-log
notes `size="sm"`):

- **Inline**: a few tiny rounded thumbnails (with a `+N` overlay past 4; no separate count/icon label).
- **Bottom sheet**: tapping the thumbnails opens a body-portaled sheet (slide-up, ivory `bg-surface`)
  with a 3-col grid of every attachment.
- **Lightbox**: tapping a grid photo opens a body-portaled full-screen viewer — a CSS scroll-snap
  carousel (native horizontal swipe) with a live `n / N` counter, glass close/nav chrome, and dots.
  Both overlays portal to `<body>` (escaping the shell's transformed scroll container), lock body
  scroll, and close on Esc. Title reuses `requestImages.attachments`; thumbnails use plain `<img>`.

## Notifications

The refined product plan expects all of these:

- shared with me
- shared task edited
- new update-log entry on a task I participate in
- due soon
- overdue

As-built (2026-06-12) — the active task notification set is shared / update-log / due-soon /
overdue. `notification_type` gained `task_due_soon` and `task_overdue`
(migration `202606110001_task_reminder_notifications.sql`) alongside the existing `task_shared` /
`task_updated` / `task_completed`. All fan out through `notifyTaskParticipants`
(service-role, org-scoped, recipient = current participants, deduped per recipient via
`unique (recipient_user_id, dedupe_key)`); each carries the task id + title + event in its payload and
deep-links to `/mobile/tasks/{id}`.

Event-driven (emitted from server actions, actor excluded from recipients):

- `task_shared` — `createTask` (with recipients) and `shareTaskWithUsers`.
- `task_updated` — one type, distinguished by `payload.event`: `edited` (author core edit via
  `updateTaskCore`) and `note` (**update-log activity** via `addTaskUpdate` — this is the update-log
  notification, kept distinct by event rather than a new type).

Time-based (system reminders, no actor → every participant incl. the author is notified):

- `task_due_soon` / `task_overdue` — produced only by `runTaskReminders` (`src/lib/notifications/
  task-reminders.ts`), driven once daily by Vercel Cron `/api/tasks/reminders` (08:00 JST; CRON_SECRET
  guarded). The run is **read-only** — it never creates occurrence rows. **One-off tasks:** due soon =
  active task whose `due_at` Tokyo date is today; overdue = before today. One reminder per task per
  recipient ever (dedupe key `task_due_soon|task_overdue:<taskId>`).
  **Recurring tasks (2026-10-28):** `due_at` is the fixed anchor, not a deadline, so they are judged per
  occurrence by `decideRecurringReminder` using `task_occurrence_state` (same 400-day window as the
  screens): today is an open occurrence → due soon, key `task_due_soon:<taskId>:<today>`; otherwise the
  newest open overdue occurrence → overdue, key `task_overdue:<taskId>:<that date>`. Before this, a
  recurring task got 「기한 초과」 the day after creation and the permanent `task_overdue:<taskId>` key
  then blocked every later reminder. If the state read fails, recurring reminders are skipped for that run.

Implementation timing may still phase these, but the product direction is confirmed.

## UI / Route Direction

Recommended mobile routes/views:

- Today
- Tomorrow
- Inbox
- Sent By Me
- Completed (완료/기록)
- Calendar
- Quick add
- Task detail
- Detailed create/edit
- Participant picker

The admin web route is implemented at `/admin/tasks`; `/admin/recurring-work` redirects there. It
shares the canonical task/project tables and server-enforced participant/author permissions with mobile.

## Projects (as-built 2026-06-15)

Projects group tasks under optional sections inside the Tasks workspace (the **프로젝트** tab, between
관리함 and 공유함). A project task is the same canonical `tasks` row with `project_id` set (and an
optional `section_id`). See `docs/product/23-project-workflow.md` for the product spec. Migration:
`supabase/migrations/202606150002_projects.sql`.

### Tables

- **`projects`**: `id`, `organization_id`, `created_by_user_id`, `title`, `description`, `is_shared`,
  `sort_order`, timestamps. `updated_at` trigger; org/creator indexes.
- **`project_participants`**: `id`, `project_id` (cascade), `user_id` (cascade), `role`
  (`owner | member`), `is_first_recipient`, `added_by_user_id`, `created_at`,
  `unique (project_id, user_id)`.
- **`project_sections`**: `id`, `project_id` (cascade), `title`, `sort_order`, timestamps.
- **`tasks` additions**: `project_id uuid → projects(id) on delete cascade` (NULL = regular task,
  shown in Today/Tomorrow/Inbox/Sent/Calendar; NOT NULL = project task, shown only in the Projects
  tab) and `section_id uuid → project_sections(id) on delete set null` (NULL + project = Unsectioned).
  Partial indexes on each.

### RLS

- Helper `is_project_participant(project_id)` (SECURITY DEFINER) mirrors `is_task_participant`.
- The `tasks` SELECT policy is recreated to add `or (project_id is not null and
  is_project_participant(project_id))`, so a project participant reads every task in the project even
  when not a per-task participant.
- `projects` / `project_participants` / `project_sections` each get a SELECT policy gated on
  `is_platform_admin() or is_project_participant(...)`. All writes go through service-role server
  actions (no authenticated write policies), matching the tasks model.

### Server actions (`src/app/mobile/tasks/projects/actions.ts`)

`createProject` (owner row + validated invited members + `project_shared` notify), `deleteProject`
(owner; cascade), `addProjectSection` / `renameProjectSection` / `deleteProjectSection` (owner;
**section delete also deletes its tasks** explicitly, since the section FK is `on delete set null`),
`reorderProjectSections(projectId, orderedIds)` (owner; sets each `project_sections.sort_order` to its
index, revalidates), `inviteProjectMembers` (owner; notify), `removeProjectMember` (owner; never the
creator; the phone × now opens a confirm sheet first), `leaveProject` (member only; owner deletes instead).
**Leaving / being removed (2026-10-28):** the person loses every task of that project (their own included —
`buildTaskScope` drops author rows for non-member projects); tasks stay in the project; direct-invite
participant rows survive. `getProjectDetail` carries `openTasksByAuthor` (`countOpenTasksByAuthor`: open ·
in_progress, non-deleted, count + up to 5 titles) for the leave / remove confirm copy.
**Project owner edits every task (2026-10-28):** `TaskRecord.projectOwnerUserId` (owner row of
`project_participants`, read in `hydrate` via `getProjectMembership`) feeds `canEditTaskAsOwnerOrAuthor()` —
`canEditTaskCore` = author OR platform developer OR project owner. Same rule in restore paths (`restoreTask`,
`restorableIds`). `TaskRecord.authorLeftProject` = author is no longer in the project's membership (false when the
membership can't be read) → 「나감」 marker on the project row, mobile detail and PC detail.
Permission boundary =
`getProjectDetail(session, id)` (RLS-scoped read proves participation) plus a `viewerIsOwner` check for
owner-only actions. Task complete/reopen reuse the existing `completeTask` / `reopenTask`.

**Project-task creation (room/context link, 2026-06-15).** Project tasks are created through the **full
create form**, not a title-only quick-add: the project detail's `작업 추가` links to
`/mobile/tasks/new?project=…&section=…`. `TaskCreateForm` takes `projectId`/`sectionId` (hidden inputs,
Share section hidden), and `createTask` validates the viewer is a project participant
(`getProjectDetail`) + the section belongs to the project, writes `project_id`/`section_id`, forces
`is_shared=false`, and redirects back to the project. This reuses the existing `ContextPickerSheet`, so
a project task can link building · room · reservation · guest exactly like a regular task — no schema
change (the `tasks` context columns already exist). Section drag-reorder UI:
`src/components/tasks/reorderable-section-list.tsx` (owner-only grip handle; mirrors
`reorderable-task-list` mechanics).

### Queries (`src/lib/projects.ts`)

`getVisibleProjects` (list cards with members + task counts) and `getProjectDetail` (members, ordered
sections, project tasks via `getProjectTasks`). The Tasks page splits `getVisibleTasks` into non-project
`tasks` and `projectCompletedTasks` (passed separately so the Completed tab's 전체/일반/프로젝트 filter can
show project completions while the other views never see project tasks).

### Notifications

`project_shared` (`notification_type` enum value) fans out via `notifyProjectMembers`
(`src/lib/notifications/create.ts`), deep-links to `/mobile/tasks/projects/{id}`, rendered by
`getNotificationDisplay` with `mobile.notifications.project*` copy (ko/ja/en).

## Future Extensions

- per-task drag-reorder inside a project section (section-level reorder shipped 2026-06-15)
- project task ↔ regular task move, project stats/progress, archive, admin web project view
- richer notification controls
- tag management helpers
- drag/drop calendar rescheduling
- subtasks
- advanced search
- admin/manager oversight view if explicitly approved later


## 2026-07-30 회차별 드래그 순서 (task_occurrence_order)

**문제.** 오늘/내일 목록에서 **일회성 작업에만 드래그 핸들이 있고 반복 회차에는 없었다.** 순서가
`tasks.sort_order` 한 컬럼에만 저장되는데, 반복 작업은 **행 하나가 여러 날짜에 나타나므로** 날짜별
위치를 담을 자리가 없었기 때문이다. 그래서 오늘/내일 섹션이 목록을 둘로 갈라 렌더했고
(`ReorderableTaskList` + `RecurringOccurrenceCards`), 후자는 `reorderable` 을 아예 넘기지 않았다.

### 저장 모델 — 저장처가 둘, 순서 공간은 하나

| 항목 | 저장처 | 키 |
| --- | --- | --- |
| 일회성 작업 | `tasks.sort_order` | 행 하나 = 날짜 하나 = 위치 하나 |
| 반복 회차 | **`task_occurrence_order.sort_order`** (신규) | `(task_id, occurrence_date)` |

인덱스는 **병합 목록 기준**으로 부여한다. 읽을 때 두 저장처를 다시 합쳐 정렬해야 사용자가 놓은
순서가 재현되기 때문이다(`mergeByDateOrder` / `dateOrderOf` in `tasks-workspace.tsx`).

### 왜 `task_occurrence_state` 에 컬럼을 더하지 않았나

그 테이블의 계약은 **"행이 없으면 아직 열린 회차"** 다 — `outstandingOverdueOccurrences` 가 행이
있는 날짜를 전부 resolved 로 본다. 순서용 행을 거기 넣으면 **오버듀 회차가 조용히 사라진다.**
순서는 완료·스킵과 무관한 별개 수명(아직 아무 상태도 없는 회차에도 존재)이라 테이블을 분리했다.
마이그레이션: `202607300002_task_occurrence_order.sql`. RLS·grant 는 state 테이블과 동일 패턴
(참여자 read-only, 쓰기는 service-role 서버 액션).

행이 없으면 "아직 수동 배치 안 됨"이고 우선순위 폴백을 탄다.

### 서버

`reorderDateTasks(occurrenceDate, items)` (`mobile/tasks/[id]/actions.ts`) — 항목마다
`{ taskId, recurring }` 을 받아 일회성은 `tasks.sort_order`, 반복은 `setOccurrenceOrders` 로
나눠 쓴다. 기존 `reorderTasks(orderedIds)` 는 날짜 개념이 없는 **관리함 전용**으로 남는다.

### 클라이언트

- `ReorderableTaskList` 가 `occurrenceDate` + `onPersistDate` 를 받으면 날짜 목록 모드로 동작한다.
- **회차 컨텍스트 복원이 이 변경의 핵심 함정이었다.** 두 목록을 합치면서 예전
  `RecurringOccurrenceCards` 가 넘기던 `occurrence={{date, done}}` 과 `swipe: false` 가 빠지면,
  체크박스가 **회차가 아니라 행 전체**를 완료 처리한다(`TaskCard` 의 `done` / `onCompleteToggle`
  분기). 목록 컴포넌트가 항목별로 다시 붙인다.
- `RecurringOccurrenceCards` 는 사용처가 사라져 삭제했다.

### 어드민 콘솔 (2026-07-30, 같은 날 후속)

**같은 저장 모델을 공유한다** — `reorderConsoleDateTasks(date, items)` 가 모바일
`reorderDateTasks` 와 동일하게 일회성/반복을 나눠 쓴다. 저장처를 새로 만들지 않았으므로 두 표면에서
바꾼 순서가 서로 그대로 보인다.

콘솔은 원래부터 오늘/내일 목록을 하나로 합쳐 렌더하고 `renderRow(t, { occurrence })` 로 회차
컨텍스트를 넘기고 있었다(모바일이 목록을 둘로 갈랐던 것과 다름). 그래서 **정렬과 드래그만** 얹으면
됐고, 모바일에서 겪은 `occurrence` 누락 함정은 발생하지 않았다.

드래그 방식은 관리함과 동일한 **HTML5 `draggable`**(`onDragStart`/`onDragOver`/`onDrop`)이고 CSS
(`.idrag` / `.is-drag` / `.is-over`)도 재사용한다 — 콘솔 안에서 조작 감각이 갈리지 않게. 모바일의
포인터+핸들 방식과 다른 것은 표면 성격 차이이며 의도적이다.

`renderDateList(arr, date)` 하나가 오늘·내일 양쪽을 담당한다. 낙관적 순서는 `dateOrder`
(`{date, ids}`)에 두고 서버 갱신 시 `inboxOrder` 와 함께 초기화한다.

### 적용 범위

| 뷰 | 모바일 | 어드민 |
| --- | --- | --- |
| 오늘 · 내일 | ✅ 일회성 + 반복 회차 | ✅ 일회성 + 반복 회차 |
| 지연 | 일회성만 | 드래그 없음 |
| 관리함 | 일회성 (날짜 없음) | 일회성 (날짜 없음) |

지연(overdue) 섹션은 반복 backlog 를 날짜별 그룹 카드(`recOverdueGroup`)로 그리는 구조라 순서
개념이 달라 제외했다. 관리함은 날짜가 없어 기존 `tasks.sort_order` 유지.

### 마이그레이션 적용 — 완료 (2026-07-30)

`supabase/migrations/202607300002_task_occurrence_order.sql` 를 원격 프로젝트(Foldy)에 적용
완료했다. 검증: 컬럼 6 · 인덱스 3 · RLS 정책 1 · updated_at 트리거 1 · `rowsecurity = true`.

> ⚠️ **여기서 실제로 겪은 일.** 코드를 먼저 배포하고 테이블은 안 만든 상태로 테스트해서, 드래그가
> 화면에서만 먹고 탭을 옮기면 되돌아갔다. `setOccurrenceOrders` 가 upsert 결과를 버리고 있어
> **에러가 어디에도 남지 않았고**, 원인을 찾는 데 시간이 걸렸다. 그래서 지금은 실패 시
> `false` 를 돌려주고 로그를 남기며, 어드민 액션은 `save_failed` 로 사용자에게 알린다.
> 스키마가 필요한 기능은 **마이그레이션 적용을 코드 배포와 같은 단계로 취급**할 것.

## 2026-07-30 지시 술어 모듈 — `src/lib/task-directives.ts`

`sentInstr` / `recvInstr` / `myOwn` / `partsOf` / `isMine` 은 원래 관리 콘솔 전용
`src/components/admin/tasks/helpers.ts` 안에만 있었다. 모바일에 지시 화면이 생기면서 **한 곳으로
옮기고** `helpers.ts` 는 재수출만 한다.

```ts
// src/lib/task-directives.ts — 클라이언트 안전(@/lib/tasks 는 타입만 import)
sentInstr(t, meId)  // t.isDirective && 내가 작성 && 대상 1명 이상
recvInstr(t, meId)  // t.isDirective && 남이 작성 && 참여자에 나 포함
myOwn(t, meId)      // !sentInstr — 내 일정 뷰(오늘/내일/관리함/캘린더)에 넣을지
```

**왜 공유 모듈인가.** 이 저장소는 `tasks.ts` / `tasks-recurrence.ts` 두 곳에
`STANDARD_RECURRENCE_RULES` 를 복사해 뒀다가 두 정의가 갈라지면서 **오버듀 작업이 하드 삭제되는**
사고를 냈다. 지시 판정도 모바일과 콘솔이 갈라지면 "누구 화면에서는 지시인데 다른 화면에서는 아닌"
상태가 되므로 같은 실수를 막는다.

**소비처**

| 화면 | 쓰는 곳 |
| --- | --- |
| 모바일 `tasks-workspace.tsx` | `myOwn` 으로 내 일정 뷰 필터, `recvInstr`/`sentInstr` 로 지시 탭 목록 |
| 콘솔 `admin-tasks-console.tsx` | `helpers.ts` 재수출을 통해 기존과 동일하게 사용 |

### `TaskCard` `instrMode`

지시 화면 전용 표시 모드. `"recv"` 는 지시자를 이니셜 아바타 칩으로 칩 줄 맨 앞에 올리고(기존
`이름 →` 접두사를 끈다), `"sent"` 는 **담당 {n}명** 칩을 올리고 공유 요약 칩을 중복 제거한다.
보낸 지시는 호출부에서 `onCompleteToggle` 을 넘기지 않아 **체크 원 자체가 렌더되지 않는다** —
지시자가 대상자의 작업을 대신 완료 처리하지 않는다는 규칙을 UI 구조로 강제한다.

### 담당자별 완료 상태는 없다

`task_participants` 는 `(task_id, user_id, role, is_first_recipient, added_by_user_id)` 뿐이고
완료는 작업 행 하나에만 있다(`status` / `completed_at` / `completed_by_user_id`). 그래서 보낸 지시
카드의 "2 / 3 완료" 같은 담당자별 진행률은 **구현 불가**이며, 필요해지면
`task_participants.completed_at` 추가 + 완료 의미 변경이라는 별도 결정이 선행되어야 한다.

## React Compiler 가 큰 화면을 통째로 건너뛰는 패턴 (2026-10-19)

`reactCompiler: true` 인데도 컴포넌트 하나가 아래 중 하나만 있으면 그 컴포넌트는 **컴파일에서 빠지고 아무 경고도 없다**
(`babel-plugin-react-compiler` 의 `logger.logEvent` 로 `CompileError` 를 보면 보인다). 투두 콘솔(4,700줄) · 예약 콘솔(1,790줄) ·
온보딩이 그렇게 빠져 있었다.

- `style={{ ["--x" as string]: v }}` — 계산된 키 안의 `as`. `style={{ "--x": v } as React.CSSProperties}` 로.
- `try { }` 안의 `??` · `||` · 삼항 — 값을 try 밖에서 계산해 넘긴다.
- 옵셔널 체이닝이 든 논리식(`a?.b || c?.d ? x : y`, `[a?.x, a?.y].filter().join() || z`) 이 JSX · 정렬 콜백 안에 — 모듈 함수로 뺀다.
- 함수 안의 `x++`(람다가 잡은 변수) — 인덱스를 값으로 계산한다.
- `return` 뒤에 선언한 함수 선언 · 쓰기 전에 선언하지 않은 함수(`closePanel`) — 쓰는 곳보다 위로 올린다.

## 콘솔 투두 서버 액션 점검 반영 (2026-10-26)

모바일 점검(30c3a23d)과 같은 규칙을 `src/app/admin/tasks/actions.ts` 에 맞췄다.

- **순서 저장**(`reorderConsoleTasks` · `reorderConsoleDateTasks`)은 `getTaskScope(session).taskIds` 에 든 작업만 쓴다 — 같은 조직 남의 개인 작업 순서를 서비스 키로 바꾸지 못한다.
- **사진 주소**는 조직 폴더만: 작업 사진 `{org}/task-images/`(생성 `sanitizeTaskImageUrls`, 수정 `mergeTaskImageUrls` 에 `organizationId`), 메모 사진 `{org}/task-update-images/`(`isOrgTaskImageUrl`, 5장 상한).
- **회차 쓰기 실패**(`completeOccurrence` · `clearOccurrenceState` · `skipOccurrences` — 셋 다 boolean 반환)는 `save_failed` 로 돌려주고 완료 기록 · 알림을 남기지 않는다. 일회성 완료/다시 열기도 `mustWrite`.
- **이미 완료된 일회성 작업**을 다시 완료하면 아무것도 하지 않는다(완료 기록 · 알림 중복 방지).
- **회차 건너뛰기**(`skipConsoleOccurrence`)는 이미 상태(완료 · 옮김)가 있는 회차를 덮어쓰지 않는다(`already_resolved`, 이미 건너뜀이면 성공 처리).
- **건너뛴 날 되살리기**(2026-10-28): `clearSkippedOccurrenceState`(`task-occurrences.ts`)가 `state = 'skipped'` 행만 지운다. `unskipOccurrenceOn`(모바일, 이제 `{ ok }` 반환)과 `unskipConsoleOccurrence` 가 쓴다 — 완료된 회차는 풀리지 않는다. 모바일 상세 페이지는 반복 업무일 때 `occurrenceStatesForTask` 를 읽어 `selectRecentSkippedDays`(`task-skipped-days.ts`, 최근 30일 · 최신순)로 `skippedDays` 를 내려준다. 콘솔은 이미 가진 `occurrenceStates` 에서 같은 함수를 쓴다.
- **프로젝트 작업을 관리함으로 이동**(`moveConsoleToInbox`)은 작성자(또는 개발자, `canEditTaskCore`)만. 2026-10-28 부터
  `canEditTaskCore` 에 프로젝트 주인도 들어가므로 주인도 옮길 수 있다 — 남이 쓴 할 일을 옮기면 프로젝트 밖으로 나가 주인 범위에서 빠지고 작성자에게 돌아간다.

## 실시간 갱신 (2026-10-29)

- 할 일 목록 · 프로젝트 · 상세(모바일) · PC 콘솔(`/admin/tasks`) · PC 대시보드 「오늘 할 일」이 새로고침 없이 바뀐다. 구독: `tasks` · `task_occurrence_state`(조직) ·
  `task_participants`(나) · 상세는 + `task_updates`(그 할 일) — `taskLiveSources()` / `taskDetailLiveSources()` (`src/lib/live-sources.ts`).
- 목록은 서버 props 를 `useOptimistic` 으로 그리므로 `router.refresh()` 가 그대로 흘러 들어간다(로컬 복사본 없음). 소프트 삭제라 삭제 · 되살리기도 UPDATE 신호로 온다.
  회차 완료 되돌리기 · 「건너뛴 날」 되살리기 · 참여자 빼기(행 삭제)는 DB 트리거가 부모 할 일 `updated_at` 을 새로 써 UPDATE 신호로 온다 —
  다만 빠진 그 사람에게는 신호가 없어(이제 못 봄) 다음 갱신 때. 공용 규칙: `docs/product/16-mobile-navigation.md` 「실시간 갱신 — 공용」.
