# Notification Design

## 알림 지우기 (화이트 리디자인 시안, 2026-10-09 — 구현 전)

지금 앱에는 알림을 지우는 기능이 없다. 화이트 리디자인 시안(`docs/design/05-white-redesign.md`)에서 사용자 요청으로
알림 화면에 지우기를 넣기로 했다. **아직 코드에 없다** — 리디자인을 앱에 옮길 때 같이 만든다.

| 동작 | 규칙 |
| --- | --- |
| 진입 | 알림 화면 오른쪽 위 「모두 읽음」 옆 **휴지통 아이콘** → 선택 모드 |
| 선택 모드 | 위에 「N개 선택 · 전체 선택 · 취소」, 줄마다 동그란 체크(고른 줄은 옅은 보라 면). 하단 탭 자리에 「모두 지우기」 · 「N개 지우기」(빨강) 버튼 줄 |
| 골라서 지우기 | **확인 없이 바로 지운다.** |
| 모두 지우기 | 되돌릴 수 없으므로 확인을 거친다(CLAUDE.md §9 — 되돌릴 수 없는 파괴 작업은 확인 UX 유지). 확인은 가운데 팝업이 아니라 **공용 `BottomSheet`**(아래에서 올라오는 시트 — 빨간 「N개 모두 지우기」 + 「취소」)로 띄운다. 문구: 「알림을 모두 지울까요? 알림 N개가 지워져요. 지운 알림은 되돌릴 수 없어요. 알림을 눌러 연 원래 글 · 업무는 그대로 남아요」 |
| 지우는 범위 | **내 알림 행만** 하드 삭제한다. 알림이 가리키던 원래 글 · 업무 · 주문 등은 건드리지 않는다. 다른 사람의 알림에도 영향 없음 |
| 권한 | 본인 알림만. 서버 액션과 RLS 가 `user_id = auth.uid()` 를 다시 확인한다(UI 노출만으로 판단하지 않는다) |
| 종류 탭과의 관계 | 「모두 지우기」는 지금 보고 있는 종류 탭(전체 · 업무 · 공지 · 게시판)의 알림만 지운다 |

열린 질문: 골라서 지운 뒤 「실행 취소」 토스트를 띄울지(투두처럼 soft delete 가 필요해진다 — CLAUDE.md §9 예외 승인 필요).

## Purpose

Notifications should make sure important operational events reach the right people at the right time.

The first version should avoid noisy notifications and focus on events that need action.

## Notification Channels

Initial channels:

- Push notification
- In-app notification center

Future channels:

- Email
- Slack

## Required Notification Events

## Order Requests

### Order Request Approved

Trigger:

- Office Admin approves an order request.

Recipient:

- Requester

Content:

- Request approved

### Order Request Rejected

Trigger:

- Office Admin rejects an order request.

Recipient:

- Requester

Content:

- Request rejected
- Rejection reason

### Order Request — Order Processed (주문 처리)

Trigger:

- Office Admin marks an order request as ordered (주문 처리 완료, status → `ordered`).
- Note: `delivery_date` is **required** at the time of this transition (captured in the action modal).

Recipient:

- Requester

Content:

- Order processing completed.
- Expected delivery date (from `delivery_date` field, stored as date-only `YYYY-MM-DD`).
- Date should be displayed in Asia/Tokyo operational timezone.

Implementation status (implemented 2026-06-03):

- `delivery_date` field is captured and stored at the time of order processing.
- `delivery_start_date` and `delivery_end_date` fields support delivery range mode.
- Notification dispatch to the requester is **implemented** via `createOrderProcessedNotification()` in `src/lib/notifications/create.ts`.
- The notification payload includes: `orderId`, `orderTitle`, `buildingName`, `roomLabel`, `status`, `deliveryDate`, `deliveryStartDate`, `deliveryEndDate`, `processedByUserId`.
- Self-notification is suppressed: if the processor and the requester are the same user, no notification is created.
- A dedupe key (`order_processed:{orderId}`) prevents duplicate notifications per order.
- The `schemaUnavailable` fallback is in place: if the `notifications` table does not yet exist, the action silently skips notification creation with a server-side warning log.
- i18n key for future notification message with date: `mobile.orderDetail.orderProcessedWithDeliveryDate` (ko/ja/en).

### Order Request — Delivery Date Updated (배송일 변경)

Trigger:

- An office role edits the delivery date of an already-`ordered` request (delivery calendar / order
  detail "배송일 수정"), implemented 2026-06-15.

Recipient: Requester (self-notification suppressed when editor = requester).

Implementation:

- `createOrderDeliveryUpdatedNotification()` (`src/lib/notifications/create.ts`) **reuses the
  `order_processed` notification type** (no enum migration) with a `kind: "delivery_updated"` payload
  flag. `getNotificationDisplay` branches on that flag to render the "배송예정일 변경" title/body
  (`mobile.notifications.orderDeliveryUpdatedTitle` / `orderDeliveryUpdatedBody`, ko/ja/en).
- Dedupe key `order_delivery_updated:{orderId}:{deliveryValue}` — each distinct new delivery value
  produces a fresh notification (re-saving the same date dedupes).

## Announcements

### New Announcement

Trigger:

- Announcement is published.

Recipient:

- Targeted users

### Important Announcement

Trigger:

- Announcement is marked important.
- The record is published (either created as `published` or later changed to `published`).

Recipient:

- Targeted users

Behavior:

- Stronger visual priority in notification center
- May also be shown as app-open popup if configured

Implementation status (implemented 2026-06-24):

- Important-announcement alerts are now **implemented** via
  `createImportantAnnouncementNotifications()` in `src/lib/notifications/create.ts`.
- Only `is_important = true` announcements notify, and only when they become `published`.
- Recipients are the announcement's targeted active members (`target_scope` / `target_roles`);
  the publishing actor is skipped.
- Dedupe key: `announcement_important:{announcementId}:{recipientUserId}`.
- Deep-link: `/mobile/announcements/{id}`.

## Maintenance

### Urgent Maintenance Request

Trigger:

- Maintenance request is created with urgent priority.

Recipient candidates:

- Field Manager
- Office Admin
- Owner if configured

## Lost and Found

### Disposal Scheduled

Trigger:

- Lost item automatically moves to disposal_scheduled.

Recipient candidates:

- Office Admin
- Field Manager

## Cleaning

### Cleaning Overdue

Trigger:

- A cleaning timer is still in progress after 16:00.

Reason:

- Cleaning normally starts around 10:00 and should be completed by 16:00 at the latest.

Recipient candidates:

- Staff member with active cleaning timer
- Field Manager
- Office Admin if configured

Frequency:

- Send once at/after 16:00.
- Do not repeat by default.

## Cleaning Time Rule

Default operational rule:

```txt
Cleaning starts around 10:00
Cleaning should be completed by 16:00
If cleaning is still in progress after 16:00 -> send overdue notification
```

## Todo / Shared Task

Implemented (2026-06-11). Todo / Shared Task has full in-app notification coverage for its first
slice. All are org-scoped, fan out only to a task's current participants (private personal tasks never
leak), and dedupe per recipient via the `notifications` `unique (recipient_user_id, dedupe_key)`
constraint. Each deep-links to `/mobile/tasks/{id}`.

| Event | `notification_type` | Trigger | Actor self-notify? |
|---|---|---|---|
| Shared with me | `task_shared` | `createTask` (with recipients), `shareTaskWithUsers` | No |
| Update-log activity (progress note) | `task_updated` (`event: note`) | `addTaskUpdate` | No |
| Shared task edited (core) | `task_updated` (`event: edited`) | `updateTaskCore` | No |
| Task completed | `task_completed` | `completeTask` (re-introduced 2026-06-13) | No |
| Due today (due soon) | `task_due_soon` | daily cron `/api/tasks/reminders` | n/a (system) |
| Overdue | `task_overdue` | daily cron `/api/tasks/reminders` | n/a (system) |

Notes:

- **Update-log activity reuses `task_updated`** but stays distinct via `payload.event = note` (its own
  title/body), rather than adding another enum value — the smallest coherent path.
- **`task_completed` is active (as-built 2026-06-13).** It is fired by `completeTask` to a task's other
  participants when a shared task is marked complete (the actor is excluded). It is no longer a
  deferred/unused enum value.
- **Due-soon / overdue are time-based system reminders** evaluated once daily (08:00 JST) by the
  CRON_SECRET-guarded `/api/tasks/reminders` endpoint. Due soon = active task due today (Tokyo);
  overdue = active task due before today (Tokyo). Exactly one reminder per task per recipient (ever),
  so there is no escalating-repeat spam. The reminder run first materializes recurring task
  instances for the active task window, then evaluates deadlines. Because there is no actor, the
  task's author is intentionally reminded about their own deadline.

## Implementation Status Summary (as of 2026-06-24)

| Event | Status |
|---|---|
| Order processed (주문 처리) | Implemented -- in-app only |
| Order delivery date updated (배송일 변경) | Implemented (2026-06-15) -- in-app; reuses `order_processed` type with `kind: "delivery_updated"` |
| Task shared / update / completed / due-soon / overdue | Implemented -- in-app only |
| Important announcement published | Implemented (2026-06-24) -- in-app; `announcement_activity` with `payload.event = important_published` |
| Staff suggestion: created / referenced / status / comment | Implemented (2026-06-16) -- in-app; one `suggestion_activity` type discriminated by `payload.event` |
| Attendance: correction created / approved / rejected / abnormal session (admin) + 18:30 open-session reminder (worker) | Implemented (expanded 2026-06-24) -- in-app; one `attendance_activity` type discriminated by `payload.event` |
| Order approved | Planned -- not implemented |
| Order rejected | Planned -- not implemented |
| Urgent maintenance | Planned -- not implemented |
| Disposal scheduled (lost item) | Planned -- not implemented |
| Cleaning overdue | Planned -- not implemented |
| Web Push (push channel) | Post-MVP -- not implemented |

The in-app notification center (`/mobile/notifications`) and the `notifications` table are live. The
mobile bell now opens the real data-driven list (no longer the mock Suggestions frame). Active first
operational set: `announcement_activity`, `order_processed`, the Todo / Shared Task reminder/activity
types, `suggestion_activity`, and `attendance_activity`.

## Attendance — notifications (implemented 2026-06-18, expanded 2026-06-24)

One discriminated type `attendance_activity` (migration `202606180001`) via `payload.event`:

| Event | Trigger | Recipients |
|---|---|---|
| `correction_created` | a worker submits a correction/exception request | owner + `attendance_payroll_admin` (never the requester) |
| `correction_approved` | an attendance admin approves a correction request | the requester |
| `correction_rejected` | an attendance admin rejects a correction request | the requester |
| `abnormal_session` | a session crosses midnight (clock-out) or stays open from a prior Tokyo day (cron) | owner + `attendance_payroll_admin` |
| `open_session_reminder` | worker still has an open session after 18:30 Tokyo (cron, once/day) | the worker themselves |

`notifyAttendanceAdmins` / `createAttendanceOpenSessionReminder` (`src/lib/notifications/create.ts`);
admin ids via `getAttendancePayrollAdminUserIds`. Approval / rejection fan-out is written from
`src/app/admin/attendance/actions.ts` and deep-links to the worker correction-status page. The
interactive **18:30 prompt** (still working / already left — the latter routes to the correction flow,
never auto clock-out) is a once-per-Tokyo-day **home prompt** backed by
`attendance_open_session_reminders` (migration `202606180002`). Scheduled scan:
`GET /api/attendance/reminders` (CRON_SECRET). In-app only; **Web Push deferred**. Admin alerts
deep-link to `/mobile/attendance` (the privileged review UI is the deferred web dashboard).

## Staff Suggestions — notifications (implemented 2026-06-16)

One discriminated notification type `suggestion_activity` (migration `202606160003_suggestion_notifications.sql`) carries every Staff Suggestions event via `payload.event`, mirroring the `task_updated` pattern (no enum value per event). Payload: `{ suggestionId, suggestionTitle, actorUserId, event, status? }`; deep-links to `/mobile/suggestions/{id}`; fan-out via `notifySuggestionParticipants` (skips the actor, dedupes per recipient). Self-notifications suppressed; targets are always restricted to valid participants at creation time, so existence never leaks to non-participants.

| Event (`payload.event`) | Trigger | Recipients (actor skipped) |
|---|---|---|
| `created` | suggestion created, **or** the author changes the recipient on an edit (while `submitted`) | recipient (on edit: the **new** recipient only) |
| `referenced` | suggestion created with references, **or** the author adds new references on an edit | referenced users (on edit: only the **newly-added** ones) |
| `status` | recipient changes status (`payload.status` = new status; `on_hold` / `completed` get specific copy) | author + referenced users |
| `comment` | a participant adds a comment | the other participants (author + recipient + referenced) |

Display: `getNotificationDisplay` branches on `payload.event` for the title/body (`mobile.notifications.suggestion*`, ko/ja/en); kind label `suggestionKind`. The author edit flow (only while `submitted`) reuses the `created` / `referenced` events: it compares the recipient against the pre-edit value and the reference set against the previous set (returned by the atomic `update_staff_suggestion` function), so an unchanged recipient sends nothing and already-referenced users are not re-notified. Self-notifications are always suppressed.

## Open Questions

- Should overdue alert go to Office Admin immediately or only after extra delay?
- Should urgent maintenance notify all Field Managers or only selected managers?
- Should users be able to mute some notification types?
- Should announcements always send push notifications or only important ones?
