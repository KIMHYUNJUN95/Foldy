# Notification Design

## 알림 화면 — 화이트 리디자인 (2026-10-15 구현)

시안: Notif-Phone · NotifSelect-Phone · NotifClear-Phone · Notif-Fold · Notif-Tablet · NotifPop-PC(`docs/design/05-white-redesign.md`).
코드: 모바일 `src/app/mobile/notifications/page.tsx` → `src/components/notifications/notification-list.tsx`, 줄 모양
`notification-row.tsx` · `notification-icons.tsx` · `notification-white.css`, PC `src/components/admin/notification-bell.tsx`.

### 줄 모양 — 무엇이 · 어느 것 · 언제 · 어디서

저장된 알림(`notifications`)에는 문장이 없고 `type` + `payload` 만 있다. 서버에서 `src/lib/notifications/brief.ts`
(`buildNotificationViews`)가 종류 · 사건마다 **짧은 제목**과 **대상 줄**을 만들어 넘긴다(클라이언트에는 사전을 싣지 않는다 —
글자는 `dictionary.mobile.notifications.w`, ko/ja/en, 함수 값 없음 · `{n}` 자리표시자).

| 종류 · 사건 | 짧은 제목(ko) | 대상 줄 | 아이콘 · 어디서 |
| --- | --- | --- | --- |
| `task_overdue` | 마감이 지났어요 | ‘작업 이름’ | 깃발 · 투두이스트 |
| `task_due_soon` | 마감이 오늘이에요(리마인더는 **마감 당일**에 간다 — 시안의 「내일」이 아님) | ‘작업 이름’ | 시계 |
| `task_shared` | 작업을 맡겼어요 | 「보낸 사람 님 · ‘작업’」(이름은 같은 조직 프로필에서 읽음, 못 읽으면 작업만) | 사람 |
| `task_completed` / `task_updated`(note · edited · reopened) | 작업이 끝났어요 / 업데이트가 올라왔어요 · 작업 내용이 바뀌었어요 · 작업이 다시 열렸어요 | ‘작업’ | 체크 · 말풍선 |
| `project_shared` | 프로젝트에 초대됐어요 | 「보낸 사람 님 · ‘프로젝트’」 | 폴더 · 투두이스트 |
| `order_processed`(processed · delivery_updated) | 주문이 처리됐어요 · 배송일이 바뀌었어요 | ‘주문’ · 건물 객실 | 상자 · 요청 |
| `suggestion_activity` | 새 의견이 왔어요 · 참조로 추가됐어요 · 의견이 보류됐어요 · 의견이 완료됐어요 · 의견 상태가 바뀌었어요 · 의견에 댓글이 달렸어요 | ‘의견’ | 전구 · 제안함 |
| `announcement_activity` | 중요 공지가 올라왔어요 | ‘공지’ | 확성기 · 공지 |
| `board_activity` | 내 글에 댓글이 달렸어요 · 나를 언급했어요 · 모두를 언급했어요 | 「쓴 사람 님 · ‘글’」 | 말풍선 · @ · 게시판 |
| `bug_report_activity` | 새 버그 신고가 왔어요 · 버그 신고 상태가 바뀌었어요 | ‘신고’ | 벌레 · 버그 신고 |
| `id_document_expiring`(2026-10-23) | 재류카드 기간이 N일 남았어요 · 재류카드 기간이 지났어요 / 관리자 「OOO님 재류카드 …」 | 본인 「새 카드를 등록해 주세요」 · 관리자 「갱신 신청 여부를 확인해 주세요」 | 시계(만료는 깃발) · 재류카드 · **근태 탭** — 규칙은 docs/product/41 「만료 표시 · 만료 알림」 |
| `attendance_activity` | 정정 요청이 왔어요 · 정정 요청이 승인됐어요 · 반려됐어요 · 확인이 필요한 근무가 있어요 · 아직 근무 중인가요? | 직원 이름 · 「내 근태 정정 요청」 · 「퇴근 기록을 남겨 주세요」 | 시계 · 근태 |
| 모르는 종류 · 깨진 payload | 예전 긴 제목(`getNotificationDisplay`) | 예전 본문 | 종 |

- 아이콘 칸 36px: 안 읽음 = 옅은 보라(#f1ecfd · #5a30cf) + 굵은 제목 + 보라 점(화면 읽기 「안 읽음」), 읽음 = 회색 칸 · 보통 굵기.
- 시각(도쿄): 오늘 「오전 8:02」 · 어제 「어제 18:20」 · 그 전 「10/13」. 오전/오후는 사전 틀로 만든다(Node ICU 와 브라우저가 달라서).
- 줄 전체가 버튼(늘어난 `nfw-hit`), 「N개 더」는 그 위에 따로 뜬 버튼(버튼 안에 버튼 없음). 누름 = 줄 내용 .98.

### 묶음 · 구간 · 탭

- **묶음**: 같은 도쿄 날짜 + 같은 종류(`type` + 사건)가 **이어지면** 한 줄 — 「‘가장 최근 것’ 외」 + 「N개 더 ⌄」, 누르면 그 자리에서
  펼쳐진다(작은 아이콘 줄, 다시 「접기」). 사이에 다른 종류가 끼면 끊는다(시간 순서 유지). 순수 함수 `src/lib/notifications/grouping.ts`
  (`groupNotificationViews`), 테스트 `src/lib/__tests__/notification-grouping.test.ts`.
- 묶음 줄을 누르면 대표(가장 최근) 알림을 연다. 밀어서 읽음 · 지우기 · 선택은 **묶음 전부**(펼친 상태에선 각 줄 따로).
- **구간**: 오늘 · 이번 주(오늘 뺀 최근 6일 — 오늘 포함 7일) · 이전. 도쿄 날짜 기준, 빈 구간은 안 보인다.
- **종류 탭**: 전체 · 업무(작업 · 프로젝트 · 비품 주문 · 제안 · 버그) · 공지 · 게시판 · 근태. 탭 이름 옆 회색 숫자 = 그 탭의 안 읽은 수
  (고른 탭이면 보라). 목록은 최근 50건.
- 머리: 「알림」 + 「안 읽은 알림 N개」(다 읽었으면 「모두 읽었어요」), 글자 버튼 「모두 읽음」(안 읽은 게 있을 때) · 「지우기」(선택 모드).
- 「모두 읽음」 → 점이 위에서부터 빠르게 차례로 사라지고(30ms 간격) 아이콘 칸이 회색으로, 그 뒤 서버 반영(실패하면 되돌림).

### 알림 지우기

| 동작 | 규칙 |
| --- | --- |
| 진입 | 머리 오른쪽 글자 버튼 **「지우기」** → 선택 모드(종류 탭은 숨김) |
| 선택 모드 | 머리 「N개 선택 · 전체 선택 · 취소」 + 「지울 알림을 눌러 고르세요」, 줄마다 동그란 체크(체크 표시가 그려짐), 고른 줄은 옅은 보라 면(#f4f1fd, 왼쪽 막대 없음). 폰은 하단 탭 바를 내리고 그 자리에 「모두 지우기」(회색) · 「🗑 N개 지우기」(빨강) 막대, 폴드 · 태블릿은 목록 바닥에 붙은 같은 막대 |
| 골라서 지우기 | **확인 없이 바로 지운다.** N 은 지워질 알림 수(묶음 줄을 고르면 그 묶음 전부를 센다) |
| 모두 지우기 | 되돌릴 수 없으므로 확인을 거친다(CLAUDE.md §9). **공용 `BottomSheet`** — 휴지통 동그라미 · 「알림을 모두 지울까요?」(탭이 전체가 아니면 「‘업무’ 알림을 모두 지울까요?」) · 「알림 N개가 지워져요. 되돌릴 수 없어요. / 알림을 눌러 연 원래 글 · 업무는 그대로 남아요.」 · 빨간 「N개 모두 지우기」 · 「취소」 |
| 지우는 범위 | **내 알림 행만** 하드 삭제(`deleteNotifications` 서버 액션 → `recipient_user_id` · `organization_id` 를 다시 걸고, RLS 「Users can delete own notifications」(마이그레이션 `202606240004_notifications_delete_policy.sql`)가 본인 것만 허용). 원래 글 · 업무 · 주문은 그대로. 한 번에 200건까지 |
| 종류 탭과의 관계 | 「모두 지우기」는 **지금 보고 있는 탭**의 알림만 지운다(지금 불러온 최근 50건 안에서) |
| 움직임 | 지운 줄은 높이가 접히며(grid-template-rows) 흐려져 사라진다. 서버가 실패하면 줄이 돌아오고 「처리하지 못했어요」 |
| 되돌리기 | 없음(soft delete 아님 — 실행 취소 토스트를 넣으려면 §9 예외 승인이 필요) |

### 밀어서 읽음 · 지우기(폰 · 폴드)

- 줄을 **왼쪽으로** 밀면 줄 안쪽에 떠 있는 둥근 타일 둘이 미는 만큼 커지며 나타난다 — 「읽음」(옅은 보라 · 열린 봉투, **안 읽은 줄에만**)
  · 「지우기」(빨강 · 휴지통). 밀린 줄은 오른쪽 모서리가 둥글고 옅은 그림자가 생긴다. 놓으면 스프링으로 열린 자리 / 제자리에 선다.
- 「읽음」 = 그 줄(묶음 전부) 읽음 처리(`markNotificationsAsRead`, 내 것 · 안 읽은 것만), 「지우기」 = 위 지우기 규칙과 같음(확인 없음).
- **끝까지 밀기**: 줄 폭의 55%(또는 타일 + 72px) 넘게 밀면 「읽음」이 비키고 「지우기」가 커지며 가볍게 진동 — 그대로 놓으면 줄이 밖으로
  나가고 접히며 지워진다(진동). 그 전에 되돌리면 취소.
- 열린 줄은 하나만. 다른 줄을 밀거나 다른 곳을 누르면 닫힌다. 열린 줄 자체를 누르면 닫히기만 한다.
- 세로가 먼저 움직이면 스크롤. 닫힌 줄을 **오른쪽으로** 미는 건 화면 스와이프 뒤로가기 몫. 줄이 열렸거나 미는 중일 때만
  `data-swipe-back="off"`(`16-mobile-navigation.md` 「뒤로가기 — 화면 스와이프」). 미는 동안 셸의 당겨서 새로고침에 넘기지 않는다.
- 태블릿 가로 · 선택 모드에서는 밀기가 없다(선택 모드로 지운다). 키보드 · 화면 읽기 사용자도 선택 모드로 지운다.

### 넓은 화면

- 폴드(≥ 600): 같은 한 줄, 가운데 최대 540px.
- 태블릿 가로(≥ 1000): `SplitList` — 왼쪽 목록 400px(세로줄 없음) · 오른쪽 칸에 **그 알림이 가리키는 상세 화면**(투두 작업 · 공지 · 게시글 등,
  기존 `SPLIT_DETAIL_PATTERNS.notifications`). 연 줄은 옅은 보라. 상세가 아닌 주소(근태 등)는 그대로 넘어간다. 시안의 칸
  (「투두이스트에서 열기」 버튼이 있는 요약)은 따로 만들지 않고 실제 상세 화면을 칸에 연다.

### PC 종 팝오버

`05-admin-web-ia.md` 「Notification Center」 — 400px, 같은 줄 · 같은 묶음, 「알림 · 안 읽음 N · 모두 읽음」, 「알림 전체 보기 →」.

### 움직임(전부 `prefers-reduced-motion` 이면 끔 · transform/opacity 위주)

「모두 읽음」 점 차례로 사라짐 · 묶음 펼침/접힘(높이 + 페이드, 화살표 돌기) · 줄 누름 .98 · 선택 체크 그리기 · 선택 막대 아래에서 올라옴 ·
밀기 스프링 · 지운 줄 접힘 · 팝오버 .96 → 1. 줄 목록에는 `LiveWash`(새 줄 내려옴)를 붙이지 않는다 — 밀기 손짓과 겹친다.

### HIG 다듬기 2차 (2026-10-19, 시안 A2Notif-Phone · Fold · Tablet — 지금 대지 A2NotifNow-* 와 나란히)

모바일 알림 화면(`.nfw`)만 — PC 종 팝오버(`.nfw-pop`)는 PC 글자 기준이라 그대로. 기능 · 배치는 그대로, 글자 · 크기만:
줄 제목 15 → 16 · 대상 13 → 15 · 시각 · 어디서 12 → 13 · 줄 위아래 14 → 12, 날짜 묶음 제목(오늘 · 이번 주 · 이전) 12 회색 → **17/600 검정 · 높이 44**,
「안 읽은 알림 N개」 · 「모두 읽음 · 지우기」 · 종류 탭 15, 「N개 더」 · 밀기 버튼 글자 13, 선택 체크 24, 선택 막대 · 모두 지우기 확인 버튼 50 · 「취소」 · 본문 15,
빈 화면 17 / 15. 구분선은 공용 규칙(0.5px · 글자 시작점 48부터) 그대로.

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
