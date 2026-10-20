# Staff Suggestions / Feedback Box Workflow

Status: Planned (scope refined 2026-06-16) · **UI/UX slice implemented 2026-06-16 (frontend only)** · **DB schema (Step 1) implemented 2026-06-16** (migration `202606160001_staff_suggestions.sql`) · **Create flow (Step 2) wired 2026-06-16** · **List queries (Step 3) wired 2026-06-16** · **Detail queries (Step 4) wired 2026-06-16** · **Comments (Step 5) wired 2026-06-16** · **Status workflow (Step 6) wired 2026-06-16** · **Notifications (Step 7) wired 2026-06-16** — participants get in-app alerts for created / referenced / status / comment events (one `suggestion_activity` type, deep-linking to the suggestion; self-suppressed, participant-scoped). **First slice complete & internally shippable (Step 8, 2026-06-16)** — full ko/ja/en i18n, empty/error states, QA hardening, dead-code cleanup, doc sync. **Debug pass (2026-06-16): fixed a blocking storage-RLS bug** — the `request-images` upload/delete policies did not whitelist the `suggestion-images/` folder, so every suggestion photo upload (compose + comments) was rejected; migration `202606160004_suggestion_image_storage.sql` adds it (and allows part-time members to attach photos under that folder, since suggestions are open to all members). See `docs/engineering/12-staff-suggestions-technical-design.md` → "As-built — Step 1 … Step 8" and `docs/product/14-notification-design.md`. **Debug pass 2 (2026-06-16):** (a) implemented **author edit/delete** of the main suggestion while `submitted` (`updateStaffSuggestion` / `deleteStaffSuggestion` actions + `/mobile/suggestions/[id]/edit` reusing the compose form + author edit/delete affordances on the detail) — closes the previously-missing core rule; (b) the list card now shows the **author** on Received/Referenced (and recipient on Sent) instead of always the recipient; (c) the author edit now re-syncs all fields + references **atomically** via the `update_staff_suggestion` Postgres function (migration `202606160005`) — fixes a data-integrity bug where a failed reference re-insert could wipe all references while still reporting success; (d) changing the recipient while `submitted` now **notifies the new recipient** (the edit returns the previous reference set, so only newly-added references and a genuinely-changed recipient are notified; unchanged recipient and self are suppressed). **2026-06-24 follow-up:** building-only context links are allowed in the shared picker, and suggestion notifications now surface in the live `/mobile/notifications` bell feed. **Pending migrations to apply:** `202606160001` + `202606160003` + `202606160004` + `202606160005`.

## Implementation Status (2026-06-16)

A frontend UI slice was built from the `Feedback Box.html` design handoff (9 frames) and then **fully
wired end-to-end (Steps 2–7) and hardened (Step 8)**: create, list (sent/received/referenced + status
filter), participant-only detail, comments (create/edit/delete + photos), recipient-only status
workflow (with hold/completion notes), and notifications. All visible strings are localized (ko/ja/en)
via `dict.mobile.suggestions`.

Routes / components:

- `/mobile/suggestions` — main list (`보낸/받은/참조` segments + status filter pills + cards + portaled `+` FAB) → `src/components/suggestions/suggestions-list.tsx`. **Wired (Step 3, 2026-06-16):** the page loads real data via `getSuggestionListData` (`src/lib/suggestions-queries.ts`) — Sent (author) / Received (recipient) / Referenced (via `staff_suggestion_references`), org+user scoped (RLS-backed). The status filter works (`active` = submitted + reviewing, `all`, or a single status); segment counts reflect the current filter; cards show real status / title / excerpt / counterparty / reference & comment counts / relative time (`Intl.RelativeTimeFormat`); empty segments show `mobile.suggestions.empty`. The card's counterparty line shows the **recipient on Sent** ("받는 사람") and the **author on Received / Referenced** ("보낸 사람"), so the other party is always meaningful.
- `/mobile/suggestions/new` — compose (recipient / references / title / body / category / building·room tags / 5 photos) + member picker sheet → `suggestions-compose.tsx`, `suggestions-user-picker.tsx`. **Wired (Step 2, 2026-06-16):** controlled fields; data-driven member picker (recipient single-select, references multi-select, fed by `getShareableUsers`); building·room reuses the shared `ContextPickerSheet` and now allows a **building-only** context when no room-level tag is needed; photos reuse `uploadRequestImages` + `compressImageFile` (`request-images` bucket, `suggestion-images/` path); submit → `createStaffSuggestion` → redirect to `/mobile/suggestions`.
- `/mobile/suggestions/[id]` — detail thread (`suggestions-detail.tsx`). **Wired (Step 4, 2026-06-16):** loads real data via `getSuggestionDetail` (participant-only — author/recipient/referenced, RLS-backed; redirects to the list if not found/allowed). One **role-aware** component renders all three viewer treatments. **Comments are live (Step 5):** the comment composer is shown to **every visible participant** (author / recipient / referenced) — `suggestion-comment-composer.tsx` submits text and/or up to 5 photos (reusing `compressImageFile` + `uploadRequestImages`) via `createStaffSuggestionComment`. Each thread comment renders via `suggestion-comment-item.tsx`, which shows inline **edit (text) / delete (two-step confirm)** affordances only on the current user's own comments (`updateStaffSuggestionComment` / `deleteStaffSuggestionComment`). Comments work at every status. For the recipient, the status bar is stacked **above** the composer. **Status workflow is live (Step 6):** the recipient's status bar + status sheet, hold-reason sheet, and completion-note sheet now submit real changes via `updateStaffSuggestionStatus` — direct moves (submitted / reviewing) apply immediately; `on_hold` / `completed` require their note (controlled textareas, submit disabled until filled, also enforced server-side + by DB CHECK). Transitions are freely reversible. The status bar reflects the real current status and the `on_hold` / `completed` banners show the saved note. Author and referenced users never see these controls. Renders real status (with hold-reason banner when `on_hold`, completion-note banner when `completed`), author→recipient route, referenced-count, category/building/room tags, body, photos, and the live comment thread (author name + role pill + relative time + photo count). Viewer role drives "(나)" markers and which bottom affordance shows. **Author edit/delete is live (Debug pass 2):** while `status='submitted'` the author sees an edit affordance (→ `/mobile/suggestions/[id]/edit`, reuses the compose screen via `updateStaffSuggestion`) and a two-step delete confirm (`deleteStaffSuggestion`); once the status leaves `submitted` the body is read-only for everyone. The author edit re-syncs title/body/category/recipient/context/photos/references **atomically** via the `update_staff_suggestion` Postgres function (single transaction — a failed reference re-insert rolls the whole edit back, so there is no partial-success state). Changing the recipient while `submitted` notifies the new recipient (see Notifications). **Detail redesigned to "Instagram style" (2026-06-16, `Feedback Detail (Instagram style).html`):** the body no longer shows the inline comment thread; instead it ends with an **action row** (a visual-only like + a comment button showing the count). There are now **two clearly distinct bottom sheets**: (1) the **comment sheet** — opened by the comment action, a tall (76%) sheet with a header + close (X), the scrollable thread, and the composer docked at its bottom (`csheet*` styles); (2) the **status sheet** — opened by the recipient's bottom-right **status pill** (`상태 ● <status> ▲`), carrying the four status options + hold/completion sub-sheets. Author/referenced users see a permission note at the bottom instead of the status pill. The like is client-only (no backend) pending a future like feature; new i18n `statusPill` / `likeAction` (ko/ja/en). **Like surfacing + comment sheet refinements (2026-06-16):** the action row shows an always-visible **facepile + "○○ liked this"** summary (tap → the who-liked sheet; the heart also opens it on long-press); the comment sheet's X button was removed (drag-the-handle / tap-scrim to close, with an enlarged grab zone), and comment bodies render **plain** (no card bubble). **Status changes now appear inline in the comment thread** as a log entry ("○○ changed status to <status>") — backed by a new `staff_suggestion_events` table (migration `202606160005_suggestion_status_events.sql`, applied; participant-read RLS via `can_view_staff_suggestion`); `updateStaffSuggestionStatus` records an event on every change, `getSuggestionDetail` returns `events`, and the comment sheet interleaves comments + events by time. Comment counts (list/detail) are unaffected (events live in their own table). New i18n `likeEmpty` / `likeSummaryOne` / `likeSummaryMany` / `statusLog`.
- `/mobile/suggestions/referenced` — **superseded (Step 4)**: the referenced detail is now rendered role-aware by `[id]`; this design-preview route (no id) redirects to `/mobile/suggestions`. The old `suggestions-detail-referenced.tsx` component was **deleted in Step 8** (dead code).
- Notifications: suggestion activity now surfaces in the shared live bell feed at `/mobile/notifications`
  via `src/components/notifications/notification-list.tsx`.

Implementation notes:

- Visual design ported 1:1 into `src/components/suggestions/suggestions.css` (scoped under `.sg`); icons in `sg-icons.tsx`. Palette reuses the app theme (ivory + deep-ink navy).
- Nav entry `suggestions` added to `mobileSidebarNavigation` (side menu + bottom-bar editor pool) and `routeAccess`; `LAUNCHER_META.suggestions` icon added to the shell.
- Bottom bars, sheets, and the FAB are portaled to `document.body` (the shell scroll container's `transform` traps `position: fixed`). Sheets use the shared `useSheetDragDismiss` drag-to-close.
- **i18n complete (Step 8):** every visible suggestions string (list tabs, filter pills, form labels,
  buttons, validation/error messages, empty states, status labels, hold/completion prompts, comment
  UI, picker labels, page titles) is localized via the `dict.mobile.suggestions` group (ko/ja/en),
  threaded as a `copy` prop through every suggestions component. Suggestion **notification** display
  strings live under `dict.mobile.notifications.suggestion*`. No remaining one-off hardcoded UI copy in
  the active components. Relative time uses `Intl.RelativeTimeFormat` (no manual strings).

The product spec below is the target behavior; the UI slice is a visual scaffold for it.

## Purpose

The Staff Suggestions / Feedback Box is a structured way to send feedback to one specific person inside the organization.

This module covers:

- 업무 개선 제안
- 불편사항
- 운영 문제
- 건의사항
- 불만 접수

This is not a public board.

It is a shared feedback thread between:

- author
- one required recipient
- optional referenced users

## Core Product Direction

The author is sending an opinion or issue to one specific person.

The first slice should behave more like a private shared thread than a broadcast feed.

Main distinction:

- Internal Board = broad team posting
- Staff Suggestions = person-directed feedback thread with controlled visibility and status ownership

## First-Slice Goal

Deliver a first version where:

- any active member can send feedback to one specific recipient
- optional referenced users can be added for shared visibility
- the recipient alone manages status
- all visible participants can discuss through comments
- the author can track progress without the post becoming organization-wide

## Participants

### Author

- any active organization member
- `part_time_staff` included

### Recipient

- exactly one required recipient
- must be an active member in the same organization
- should be someone other than the author

### Referenced Users

- optional
- zero or more active members in the same organization
- visible participants only
- cannot manage status

## Visibility Model

Readable by:

- author
- recipient
- referenced users

Not readable by:

- everyone else in the organization

Important rule:

- this feature has no `public_team` or organization-wide visibility mode

All visible participants can see:

- who the author is
- who the recipient is
- which users were referenced

## Main Roles Inside One Thread

### Author

Can:

- create the suggestion
- edit the suggestion only while status is `submitted`
- delete the suggestion only while status is `submitted`
- change recipient / references / property / room / photos only while status is `submitted`
- comment at any status

Cannot:

- change status

### Recipient

Can:

- read
- comment
- change status

Cannot:

- edit or delete the main suggestion body
- change recipient or references

### Referenced Users

Can:

- read
- comment

Cannot:

- change status
- edit or delete the main suggestion body
- change recipient or references

## Statuses

First-slice statuses:

- `submitted`
- `reviewing`
- `on_hold`
- `completed`

Meaning:

- `submitted`: newly sent to the recipient
- `reviewing`: recipient is actively checking it
- `on_hold`: paused or blocked for a stated reason
- `completed`: recipient considers the matter completed

Status rules:

- new suggestion always starts as `submitted`
- status never changes automatically
- only the recipient can change status
- recipient can move status back again later if needed

### Required Notes By Status

- moving to `on_hold` requires a hold reason
- moving to `completed` requires a completion note
- moving to `reviewing` does not require a note

## Main Fields

```txt
author
recipient
referenced users (optional)
title
body
category (optional, free text)
status
hold reason
completion note
property
room
photos
created_at
updated_at
```

Field rules:

- category is optional free text
- property tag is optional
- room tag is optional
- a building may be linked without selecting a room when the note is building-level only
- photos are allowed up to 5 on the main suggestion

## Comments

Comments are part of the first slice.

Who can comment:

- author
- recipient
- referenced users

Comment rules:

- comments are allowed at every status, including `on_hold` and `completed`
- comment edit/delete is allowed only for the comment author
- comment edit/delete is not blocked by suggestion status
- comments may include photos
- comment photos are allowed up to 5 per comment

This feature should support multi-turn discussion, not a single reply note only.

## Notifications

Send notifications when the target user has notifications enabled.

Trigger points:

- recipient is notified immediately when a new suggestion is created
- referenced users are notified when they are added
- when the author changes the recipient on an edit (only possible while `submitted`), the **new** recipient is notified (reuses the "created" event); if the recipient is unchanged, no notification is sent
- visible participants are notified when status changes
- visible participants are notified when a new comment is added

Recommended baseline:

- suppress self-notifications for the acting user

## List Structure

Recommended first-slice top tabs:

- `Sent`
- `Received`
- `Referenced`

Meaning:

- `Sent`: suggestions created by me
- `Received`: suggestions where I am the recipient
- `Referenced`: suggestions where I was added as a referenced user

Default list behavior:

- default view emphasizes active items
- users can filter by:
  - `all`
  - `submitted`
  - `reviewing`
  - `on_hold`
  - `completed`

Recommended default filter:

- show active work first (`submitted` + `reviewing`)

### 화이트 리디자인 — 모바일 (2026-10-15, 시안 Sugg-Phone · SuggDetail-Phone · Sugg-Fold · Sugg-Tablet)

흰 바탕 · 카드 상자 없음 · 세로 구분선 없음 · 줄 사이 가는 가로줄만(`src/components/suggestions/suggestions-white.css`, 접두어 `sgw-`).

- **목록** `/mobile/suggestions`: 머리(「제안함」 · 「한 사람에게 보내는 의견」 · 오른쪽 「+ 쓰기」 → `/new`, 예전 떠 있는 + 버튼 대신) →
  글자 탭 **받은 · 보낸 · 참조**(기본 받은, 지금 필터에 맞는 개수) → 상태 칩 줄 대신 **글자 하나 「진행 중만 ⌄」** + 옅은 요약
  (「· 접수 · 검토중」 / 「· N건」). 누르면 공용 `BottomSheet` 에서 진행 중 · 전체 · 접수 · 검토중 · 보류 · 완료(각 개수, 고른 줄 옅은 보라 + 체크).
  필터 규칙은 그대로(진행 중 = 접수 + 검토중). 줄 = 「상태 글자(접수 검정 · 검토중 보라 · 보류 회색 · 완료 초록) · 보낸 → 받는(나) · 시간」 /
  굵은 제목. 시간은 하루 안이면 「2시간 전」, 이틀 안이면 「어제」, 그 뒤는 「10/6」(도쿄). 빈 화면 「아직 제안이 없어요」.
- **상세** `/mobile/suggestions/[id]`(하단 탭 보임): 「상태 · 분류 · 건물 · 객실」 → 제목 → 「보낸 → 받는 · 참조 이름 · 날짜 시각」 →
  (작성자 · 접수 상태) 수정 · 삭제(2단계 확인) → 보류 사유 / 완료 메모(옅은 회색 칸) → 본문 · 사진(누르면 새 탭) → **「댓글 N」 — 댓글과 상태 바뀜
  기록을 시간순으로 화면 안에**(예전 댓글 시트를 없앴다) → 받은 사람만 **「상태 바꾸기 · 받은 사람만」 4칸**(접수 · 검토중은 바로, 보류 · 완료는
  공용 `BottomSheet` 에서 사유 · 메모를 받아 저장 — 예전 상태 시트 · 손수 만든 시트 대신), 나머지는 「받는 사람만 상태를 바꿀 수 있어요」 →
  댓글 입력(기존 `SuggestionCommentComposer`, 사진 5장, 둥근 회색 칸). 예전 하트(좋아요)는 저장되지 않는 화면 장식이라 뺐다.
- **폴드** 가운데 540px 한 줄 · **태블릿 가로** `SplitList` 목록 | 상세 칸(연 줄 옅은 보라, 목록과 칸 사이 세로줄 없음).
- 움직임: 줄 · 버튼 누름 살짝 작아짐, 첫 그림 · 탭 · 필터 바꿀 때 줄이 차례로 떠오름, 필터 체크 그리기. 동작 줄이기면 전부 끔.
- 문구 `mobile.suggestions.white.*`(ko/ja/en). 목록 줄에 보류 사유는 아직 안 붙는다(목록 데이터에 없음 — 시안의 「보류 · 새 QR 발급 대기」).

### HIG 다듬기 2차 — 모바일 제안함 (2026-10-20, 시안 A2Sugg-* · 지금 A2SuggNow-* 나란히)

기능 · 배치는 그대로(`suggestions-white.css` 끝 블록):
- 「한 사람에게 보내는 의견」 13 → 15 · 「+ 쓰기」 14 → 15 · 「전체 ▾」 13 → 15 · 「· n건」 12 → 13. 탭은 이미 44/15.
- 줄 사이 선: 모든 줄 위(첫 줄 포함) → **줄 사이에만**(상태 글자가 왼쪽 끝이라 끝까지). 칸 모드 고른 줄 위아래 선 숨김.
- 줄: 「상태 · 보낸 사람 → 받는 사람 · 시각」 12 → 13 · 제목 15 → 16. 빈 화면 17/15.
- 상세: 본문 15 → 16 · 「수정 · 삭제」 40/13 → 44/15 · 「댓글 n」 15/700 → 17/600 · 댓글 본문 14 → 15 · 역할 · 시각 12 → 13 · 댓글 「⋯」 누르는 자리 32 → 44 · 메모 14 → 15 · 메모 이름 · 처리 기록 12 → 13.

## Entry Points

### Mobile

First-slice mobile surfaces:

- sent / received / referenced list
- create form
- detail thread

### Admin Web

Admin web is not a different permission model in this feature.

If added in the first slice, it should mirror the same participant-based rules rather than introduce admin-only review powers.

## Workflow

```txt
Author opens suggestion box
Author chooses one recipient
Author optionally adds referenced users
Author writes title/body
Author optionally adds category, property, room, photos
Author saves
Recipient and referenced users get notified
Visible participants read and discuss in comments
Recipient manually changes status when needed
Author tracks progress from Sent
```

## Edit / Delete Rules

Main suggestion edit/delete:

- author only
- only while status is `submitted`

Editable while `submitted`:

- recipient
- referenced users
- title
- body
- category
- property
- room
- main photos

Locked after status leaves `submitted`:

- all main-body fields above

Comments:

- comment author only
- independent from suggestion status

## Out of Scope For First Slice

- organization-wide visibility
- anonymous posting
- separate admin-only workflow
- reactions / likes / votes
- assignment to multiple status owners
- attachment types beyond photos
- escalation / whistleblower route

## Risks

- If read access is implemented loosely, private feedback can leak.
- If recipient-only status ownership is not enforced server-side, the workflow loses accountability.
- If comments are not first-class data, the feature will regress into a weak one-reply box.

## Build Summary

Build in this order:

1. suggestion create flow with one required recipient
2. sent / received / referenced lists
3. detail thread with comments
4. recipient-only status change
5. notifications for create / reference / status / comments
