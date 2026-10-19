# Cleaning Workflow

## 2026-08-06 multilingual warning contract

The mobile unresolved room-label production warning is user-facing operations copy. Its heading, count, and examples must be rendered from the `ko`/`ja`/`en` cleaning dictionary; the warning must never fall back to a hardcoded English sentence.

## Purpose

The cleaning workflow should record when cleaning starts, when it ends, how long it took, and what issues were found during cleaning.

It should also let cleaning staff create linked lost item and maintenance records without leaving the cleaning context.


## 실패 사유 표시 (2026-08-04)

모바일 청소 액션(`src/app/mobile/cleaning/actions.ts`)은 실패할 때 throw 하지 않고
`?error=<사유>` 로 리다이렉트하고, 화면이 `copy.errors[사유]` 를 배너로 띄운다.

**사전에 사유 6종이 빠져 있어 실패가 화면에서 조용히 사라졌다.** 액션은 9종을 내보내는데
`dictionary.cleaning.errors` 에는 5종만 있었고, 그 객체가 `as Record<string, string>` 이라
타입 검사도 잡지 못했다. 그래서 "셋팅 시작을 눌러도 아무 일이 없다"로 보고됐다 — 실제로는
액션이 실행되고 303 으로 되돌아온 뒤 배너만 사라진 상태였다.

정리한 것:

- 빠져 있던 `invalid_selection` / `not_allowed` / `start_failed` / `complete_failed` /
  `active_not_found` / `missing_session` 을 ko·ja·en 에 추가.
- 화면은 이제 **사전에 없는 키여도 무언가는 띄운다**(`start_failed` 문구로 폴백). 키 누락은
  버그지만, 그 버그가 사용자에게 무반응으로 보이는 것이 더 나쁘다.
- 같은 패턴을 전 화면에서 점검했다(아래 표). `mobile/orders/new` 와 `admin/maintenance`(목록)는
  `?error=` 를 **읽지도 않고** 있었다 — 저장 실패가 화면에 흔적조차 남지 않았다. 둘 다 배너를
  붙였고, 주문 폼에는 `errors` 사전 자체가 없어 ko·ja·en 을 새로 추가했다.
- 재발 방지: `src/lib/__tests__/action-error-keys.test.ts` 가 액션 소스에서 `?error=` / 
  `redirectWithError("...")` 키를 뽑아 세 로케일 사전에 전부 있는지 검사한다(13개 액션 파일).
- `redirectWithError()` 가 사유를 `console.warn` 으로 남긴다. 이 액션들은 throw 하지 않으므로
  Vercel 런타임 **에러** 로그에 아무것도 안 남아, 어느 분기에서 막혔는지 추적할 수 없었다.

## Core Flow

```txt
Staff selects room/property from today's check-out list
Staff taps Start Cleaning
Timer starts
Staff works
Staff can add notes, report lost items, or report maintenance issues during cleaning
Staff taps Complete Cleaning
Confirmation popup appears
Staff confirms completion
System records total duration
Cleaning record is saved
```

## Room / Property Selection

Room selection is reservation-driven. The cleaning page (`/mobile/cleaning`) queries today's confirmed reservations (Asia/Tokyo timezone) and derives two lists automatically:

### Unprocessed Queue Policy

Both lists are **unprocessed work queues**, not raw reservation queries. Before rendering, rooms that already have a session today are removed:

- `in_progress` room -> excluded (prevents duplicate starts)
- `completed` room -> excluded (work is done, no re-appearance)

Exclusion is org-wide: if any staff member in the organization has an `in_progress` or `completed` session for a given room today, that room disappears from all staff members' lists. The "Today's records" section below the lists remains unfiltered and always shows the full history.

#### room_label -> roomKey Resolution Priority

The filter compares `cleaning_sessions.room_label` values against `CleaningTarget.roomKey` / `SettingTarget.roomKey`. Reverse mapping uses a three-stage fallback:

1. **Catalog exact match (primary)** -> `buildSessionLabelToRoomKeyMap(roomCatalog)` produces a `Map<sessionRoomLabel, roomKey>` from the active room master. This covers all rooms that were created via the manual form or from reservations whose room master is classified.
2. **Canonical prefix parse (legacy fallback)** -> for labels written before the room master existed, `resolveRoomKey` attempts prefix matching against `CANONICAL_TO_BUILDING_KEY`. Succeeds for the 7 known canonical property names.
3. **Legacy alias map fallback** -> normalized (`NFKC`, whitespace-collapsed, lowercase) aliases derived from active room catalog values are checked last. This captures historical ko/ja/en variants and formatting differences (`property + room_label`, canonical/raw combinations).
4. **Unknown labels** -> if all lookups fail, the label is excluded from `processedRoomKeys` (not added, not used as a filter key). A dev-mode resolver log captures unresolved count and samples for follow-up cleanup.

#### Resolver Safety Guard

- Resolver telemetry is logged in development when alias fallback or unknown labels are observed.
- If unresolved labels for org-today processed sessions reach the warning threshold (`>= 3`), `/mobile/cleaning` shows a warning badge with sample labels.
- This prevents silent queue re-exposure risk from going unnoticed in operations.

#### Legacy Cleanup Policy (One-time / Admin-Dev)

- Script: `scripts/dev/normalize-cleaning-room-labels.js`
- Command: `npm run cleaning:normalize-room-labels -- --org=<organization_id> [--days=14] [--apply]`
- Default mode is **dry-run** (no DB write). `--apply` performs updates.
- Scope: `cleaning_sessions` with `in_progress` or `completed` status for today + recent N days (Tokyo date key).
- Behavior: non-standard `room_label` values are rewritten to canonical `sessionRoomLabel` when mapping is deterministic from active room catalog aliases.

#### KPI Counters

All three KPI cells use org-wide scope:

| KPI | Source | Scope |
|---|---|---|
| Cleaning targets | filtered cleaning list length | org-wide (unprocessed rooms) |
| Setting targets | filtered setting list length | org-wide (unprocessed rooms) |
| In progress | `orgTodaySessions.filter(in_progress).length` | org-wide |

When `getCleaningTargets()` fails (returns `null`), the Cleaning targets / Setting targets cells show `"-"` instead of `0` to distinguish a data loading failure from a genuine zero count. The In progress cell always shows a number (shows `0` if `getOrgTodayCleaningRoomLabels` fails).

### Cleaning List

Rooms with a confirmed `check_out_date = today`. Each card shows:
- Room label (canonical property + room, e.g. `Arakicho A 201`)
- Departing guest name
- Turnover badge + arriving guest info if `check_in_date = today` for the same **physical** room
- Next check-in date and guest if no same-day arrival but a future one exists within 30 days
- "No check-in today" if the room is free after cleaning

Tapping Start records the room label directly from the reservation data into `cleaning_sessions.room_label`.

### Setting List

Rooms with a confirmed `check_in_date = today` whose **physical room** does NOT appear in the checkout set. These are set-up tasks (not post-checkout cleaning). Each card shows arriving guest name and PAX count.

#### Physical-room matching (Arakicho sub-listings)

Turnover detection (Cleaning List) and setting exclusion (Setting List) match on the **physical room**, not the raw Beds24 `room_label`. In Arakicho every physical room carries **two Beds24 listings** — one per channel (e.g. `501` on Airbnb, `501_2` on Booking.com) with distinct `external_room_id`s. A single same-day turnover of that one room can therefore land under two different `room_label`s: the checkout under `501_2`, the check-in under `501`.

**읽기 (2026-10-19 속도)**: 떠나는 예약은 `raw_payload` 를 받지 않고, 도착 예약(30일)은 인원 키만 받는다
(`GUEST_PAYLOAD_KEYS`, `src/lib/reservation-payload-slim.ts` — 통째면 429행에 약 890KB 였다). `/mobile/cleaning` 은 내 세션 ·
진행 중 세션 · 담당자 이름표 · 대상 · 카탈로그 · 조직 세션 · 배지를 **한 번에** 읽고(전에는 9단계 직렬), `/admin/cleaning` 은 기록을
오늘 현황과 동시에 읽는다. 두 화면 모두 예약 신호만 받아 다시 읽는다(`Beds24LiveRefresh kinds={["reservations"]}`).

`getCleaningTargets()` (`src/lib/cleaning-targets.ts`) keys departures and arrivals by a **physical-room key** (`buildRoomKey(property, getDisplayRoomLabel(...))`, which strips the Arakicho `_N` sub-listing suffix — `501 / 501_2 → 501`). This means:

- A same-day checkout+check-in of the same physical room across two listings is correctly a **turnover in the Cleaning List**, not a phantom **Setting** entry.
- Non-Arakicho labels are unchanged (`getDisplayRoomLabel` is a no-op for them), and distinct rooms (`A301` vs `301`) stay distinct — only the trailing `_N` sub-listing suffix collapses.
- The per-listing internal `roomKey` / `sessionRoomLabel` emitted on each card are **unchanged** (still `501` or `501_2`), so `cleaning_sessions` matching is unaffected.

This mirrors the admin reservation console, which already keys its setting-target KPI off the display-collapsed room (`admin-calendar-dashboard.ts`). Both surfaces now agree on the same-day turnover count.

#### Setting KPI Interaction

- The top `셋팅 대상` KPI is clickable when the count is greater than zero.
- Tapping it opens a mobile bottom sheet with the full setting-target list.
- Each row in the sheet shows building/room, guest name, and PAX, with an immediate `Start setting` action.
- No preview rows are shown in the KPI card itself.

### Building Section Display Rules

Both the Cleaning List and Setting List are rendered as building-grouped sections:

- **Empty building sections are hidden.** If a building has no targets on a given day, its section header does not appear at all.
- **Building display names are locale-aware** -> section headers come from `dictionary.cleaning.buildingLabels[key]`, not from the canonical property name string directly. This means Japanese mode shows localized Japanese building labels, Korean shows localized Korean building labels, and English shows labels such as `Arakicho A`, `Kabukicho`, etc.
- **Ordering uses canonical building keys** (stable English slugs), not locale display strings:
  1. `arakicho_a`
  2. `arakicho_b`
  3. `kabukicho`
  4. `takadanobaba`
  5. `okubo_a`
  6. `okubo_b`
  7. `okubo_c`
  - Any building whose canonical property name is not in the `CANONICAL_TO_BUILDING_KEY` map is appended alphabetically after the seven fixed entries. Display falls back to the raw key string.
- **Rooms within each building section are sorted by numeric value ascending** (numeric-aware, not lexicographic). The first integer sequence in the canonical room label is used as the sort key -> e.g. `"2" < "3" < "10" < "101" < "202"`. Ties are broken by the raw label string.

### Canonical Key -> Display Label Architecture

The sorting/grouping layer uses canonical building keys (`arakicho_a`, etc.) internally. The display layer reads `dictionary.cleaning.buildingLabels[key]` from the i18n dictionary. These two concerns are kept separate so that:
- Adding a translation requires only a new key in `src/lib/i18n.ts`
- Reordering buildings requires only changing `BUILDING_KEY_ORDER` in `src/app/mobile/cleaning/page.tsx`
- Neither affects the other

### Exclusion Policy

Properties/rooms listed in `isExcludedOperationalProperty` / `isExcludedOperationalRoom` in `src/lib/room-label-normalization.ts` are filtered out from both lists.

### Manual / Other Section

A cascading building + room select form is always shown below the two auto-detected lists, for exceptions such as long-stay maintenance cleans that have no checkout event.

**Data source**: `rooms` table active room catalog (`getActiveRoomCatalogServer`). Same room master used by the reservation calendar.

**UX flow**:
1. Staff selects a building from the first dropdown.
2. Room dropdown becomes enabled and lists only rooms in the selected building (disabled until building is selected).
3. Staff selects task type.
4. Submit -> `startCleaningSession` server action.

**Room master unavailable**: If no classified room rows exist (catalog returns `undefined`), the form is replaced with an informational message (`copy.manualRoomMasterUnavailable`). There is no free-text fallback.

**roomLabel generation**: The value submitted to `cleaning_sessions.room_label` is the `sessionRoomLabel` computed at page-render time:
- `canonicalRoomLabel === propertyName` -> `propertyName` (Okubo-style single-room property)
- Otherwise -> `"{propertyName} {canonicalRoomLabel}"` (e.g., `Arakicho A 201`)

**Server-side validation**: The `startCleaningSession` action calls `getActiveRoomCatalog` and, when a catalog exists, verifies the submitted `roomLabel` is in the allowed set. Injected labels that do not match a real active room are rejected with `invalid_selection`. If no catalog exists, only length-based validation applies (0 < length <= 100).

After the room master check, the action also queries `cleaning_sessions` to reject any submit where the room already has an `in_progress` or `completed` session today (org-wide). The error key is `already_processed_today` (i18n: ko/ja/en).

**Component**: `src/components/cleaning/manual-cleaning-form.tsx` -> `"use client"` component, uses `useTransition` + `FormData` to call the server action.

### Task Types

- `checkout` -> used for cleaning list items (standard checkout clean)
- `simple` -> used for setting list items (arrival setup)
- `long_stay` -> available via the manual section

## Required Timer Data

Each cleaning record should store:

```txt
id
organization_id
property_id
room_id
staff_user_id
status
started_at
completed_at
duration_seconds
notes
created_at
updated_at
```

Status candidates:

- not_started
- in_progress
- completed
- cancelled

## Multiple Rooms Per Staff

One staff member may clean up to about 2 rooms/properties in a day.

The app should therefore show:

- Today's cleaning records
- Completed records
- Active cleaning timer
- Previous cleaning time history

Cleaning start and completion should automatically appear in the user's "today's activity records" on the mobile home screen.
Displayed cleaning times (start/completion/history) should be formatted in `Asia/Tokyo`.

## Cleaning Record Export

Admin/office users need to export cleaning records.

Export formats:

- Excel
- PDF

Export language:

- Korean

Minimum export fields:

```txt
Cleaning building / property
Room
Assigned cleaner start time
Cleaning completion time
Total duration
Special notes memo
```

Allowed roles:

- Developer / Super Admin
- Owner
- Office Admin
- CS Staff if permitted
- Field Manager

Not allowed:

- Staff
- Part-time Staff

Open question:

- Should one user be allowed to run more than one active cleaning timer at the same time?

Recommended first rule:

- One active cleaning timer per user.

## Completion Notes

At completion, staff should be able to add:

- Special notes
- Room/property condition notes
- Supply shortage note
- Guest-related note if needed

Notes are optional, not required.

## Completion Confirmation Popup

When staff taps Complete Cleaning, show a confirmation popup before final completion.

The popup should show:

- Cleaning room/property
- Cleaning start time
- Approximate elapsed time
- Completion note (read-only; hidden if no note was entered)

The popup should include:

- Confirm completion button
- Cancel/back button
- Optional special note button or input

Purpose:

- Prevent accidental completion.
- Let the staff verify the room/property and elapsed time before saving.

## Lost Item During Cleaning

> **Implementation note (2026-05-21):** Linked reporting slice implemented. Shortcut appears on the active-cleaning card linking to `/mobile/lost-found/new?sessionId=...` and `/mobile/maintenance/new?sessionId=...`. Room is prefilled from the validated cleaning session; `cleaning_session_id` is stored on saved records. Invalid or stale `sessionId` shows an explicit error state; login redirect preserves `sessionId` in `next`. In cleaning-linked mode, both forms now show a final confirmation step before submit, including room/report summary and a visible guest/reservation suggestion section. Because reservation integration is not yet connected in this slice, the suggestion area explicitly reports that no connected reservation data is currently available instead of fabricating a guess.

During an active cleaning timer, staff should be able to tap:

```txt
Report Lost Item
```

The app should open a quick lost item form already prefilled with:

- Property
- Room/unit
- Cleaning record
- Current staff
- Found date/time
- Guest/reservation from that room's checkout when available

After saving, the lost item should be linked back to the cleaning record.

The created lost item must also appear in the normal Lost and Found list inside the Requests tab/admin web.

Before final submission from cleaning context:

- Show a confirmation popup asking whether the auto-filled room/property is correct.
- Show the suggested checkout guest/reservation if available.
- Provide a pencil/edit action if the room/property or reservation link needs correction.

## Maintenance Issue During Cleaning

> **Implementation note (2026-05-21):** First slice implemented. Shortcut appears on the active-cleaning card linking to `/mobile/maintenance/new?sessionId=...`. Room is prefilled from the validated cleaning session; cleaning session ID is stored on the record. Invalid or stale `sessionId` shows an explicit error state; login redirect preserves `sessionId` in the `next` param.
>
> **Update (2026-07-14):** 이 노트에서 "deferred"라고 적었던 두 가지는 모두 구현됐다. 사진 업로드는 신고 사진 5장(`image_urls`) + 완료 사진 5장(`resolution_image_urls`)까지 가능하고, 수리·점검 워크플로 전체(카테고리·우선순위·4단계 상태·현장 처리·어드민 콘솔)가 완성됐다. `docs/product/08-maintenance-workflow.md` 참고.

During an active cleaning timer, staff should be able to tap:

```txt
Report Maintenance Issue
```

The app should open a quick maintenance form already prefilled with:

- Property
- Room/unit
- Cleaning record
- Current staff
- Reported date/time

After saving, the maintenance request should be linked back to the cleaning record.

The created maintenance request must also appear in the normal Maintenance list inside the Requests tab/admin web.

## Active Timer Screen Actions

The active cleaning timer screen should always show:

- Register lost item
- Register maintenance issue
- Special note
- Complete cleaning

These are shortcuts into the same core modules, not separate temporary records.

## Photo Upload Concern

Completion photo upload is useful, but one room may generate about 30 photos.

This can create significant storage and bandwidth cost if every photo is uploaded to Foldy.

## Recommended Photo Strategy for MVP

Do not require 30 completion photos per cleaning record in the first MVP.

Better first options:

### Option A: Optional Limited Photos

Allow only a small number of photos per cleaning completion.

Example:

- Maximum 3 to 5 photos
- Compressed before upload
- Used only for important proof or issue evidence

### Option B: Issue-Only Photos

Do not upload normal completion photos.

Only upload photos when reporting:

- Lost item
- Maintenance issue
- Damage
- Supply shortage

### Option C: External Photo Link

Continue using KakaoTalk or another external photo workflow for bulk photos, and store only a link or note in Foldy later.

## Current Recommendation

For MVP:

- Track cleaning start/completion/timer
- Allow notes
- Allow lost item and maintenance creation from active cleaning
- Do not implement cleaning completion photo upload yet
- Use photos in linked lost item or maintenance records instead

Future:

- If the company later launches the app and accepts the storage cost, cleaning completion may support up to about 30 photos per room.

## Phase 7 First Vertical Slice

Implemented on 2026-05-21:

- Added real database-backed `cleaning_sessions` persistence.
- Mobile field roles can select from a small room/task list, choose Checkout Cleaning, Simple Cleaning, or Long-stay Cleaning, start a cleaning session, see an active timer, add an optional completion note, review room/task/start time/elapsed time in a confirmation step, and then complete the session.
- Completion records `completed_at` and `duration_seconds`.
- Cleaning "today" uses the defined UTC+9 local operating date (`Asia/Seoul`, matching Korea/Japan operating date) instead of raw UTC date slicing.
- A partial unique database index enforces the first rule of one active cleaning timer per organization/user.
- Admin web has a first cleaning status view for the current organization/date with room, task, staff, status, start time, and duration.
- Visible cleaning UI strings are localized in Korean, Japanese, and English.
- Server actions validate user/session, role eligibility, room/task selection, active session ownership, and completion state before database mutation.
- `owner` is treated as a hybrid operations role for this workflow: owners can run the mobile cleaning flow in addition to admin web, and `developer_super_admin` remains able to bypass for support/debugging. Matching RLS keeps the page guard and DB mutations aligned.

Previously deferred; now implemented:

- Beds24 checkout-driven room list -- implemented as the cleaning smart list (Phase 10 calendar integration).
- Room/property master data -- properties/rooms tables implemented; cascading building-to-room selects in manual section.
- Export -- cleaning record export. **Superseded (2026-07-14):** the old `/api/admin/export/cleaning`
  CSV route was removed along with the rest of `/api/admin/export/*`; cleaning-record export is now
  Excel + PDF from `/admin/cleaning`'s 기록 tab — see "2026-07-14 청소 기록 내보내기" below.
- Photo upload for linked records (lost-found and maintenance) -- implemented (up to 5 images each).

Still deferred (post-MVP):

- Beds24-backed guest/reservation suggestion data in linked forms (current implementation shows "reservation data unavailable" placeholder).
- Overdue cleaning notification (planned in notification design, not yet dispatched).
- Cleaning completion photo.

## Open Questions

- Should cleaning completion require a note?
- Should cleaning completion require any photo?
- How many photos should be allowed per maintenance/lost item record?
- Should the app compress photos automatically?
- Should photos expire after a certain time?
- Should old photos be archived or deleted?

## Overdue Notification

Default rule:

```txt
Cleaning usually starts around 10:00.
Cleaning should be completed by 16:00 at the latest.
If a cleaning timer is still active after 16:00, send an overdue notification.
```

Recipients:

- Staff member with active cleaning timer
- Field Manager
- Office Admin if configured

Frequency:

- Send once only.

## 2026-05-27 Localized Room Title Rule

- Card title display must not use stored `sessionRoomLabel` directly.
- `sessionRoomLabel` remains a storage/action value for `cleaning_sessions.room_label`.
- UI title must be composed from:
  1. localized building label (`dictionary.cleaning.buildingLabels[key]`)
  2. canonical room number/label
- Example:
  - `ja`: localized Japanese building label + `201`
  - `ko`: localized Korean building label + `201`
  - `en`: `Arakicho A 201`

## 2026-05-27 Top summary KPI update

- The top hero card in `/mobile/cleaning` now shows KPI summary instead of static title/description.
- KPI fields:
  - cleaning targets = `cleaningList.length`
  - setting targets = `settingList.length`
  - in progress = organization-wide `cleaning_sessions` count where `status = in_progress`
- Data source: same-day `getCleaningTargets()` result (Asia/Tokyo operating date basis).
- Purpose: operators can see daily workload immediately on page entry.

## 2026-06-15 Cleaning Log (청소 기록표)

A date-grouped **cleaning record sheet** so staff can review their cleaning history like a log.

- **Entry / location:** a "내 청소 기록" link on the cleaning home (`/mobile/cleaning`, below the
  summary card) → dedicated sub-page `**/mobile/cleaning/records**`. No new bottom tab.
- **Layout:** horizontal **text rows** grouped by **date** (newest first), fitting the screen width
  (no horizontal scroll). Each row, single line: status dot · 시작–종료 시각 · 건물·객실(truncate) ·
  청소 유형 칩 · 소요시간. The top is a polished dashboard: a month-nav header card with a two-stat
  summary (기록 count · 총 소요 total duration, compact `Xh Ym` format), **building** + (managers) staff
  pill selects, and a **status segmented control** (전체/완료/진행중/취소). **Building filter** is
  server-side via `getOrgCleaningSessionsFiltered({ propertyName })` + the active-room catalog;
  building options are the catalog's property names (excluded ops filtered out), localized.
- **Row tap → detail sheet:** building names are truncated in the row, so tapping a record opens a
  **bottom sheet** (drag-to-dismiss, `useSheetDragDismiss`) showing the **full** info — untruncated
  building·room, cleaning type, status, 담당자(staff), 날짜, 시작/종료 시각, 소요시간, and 메모(notes)
  when present.
- **Data:** reuses `getOrgCleaningSessionsFiltered(session, {startDate,endDate,status,staffUserId})`
  over the selected month (Tokyo), with building·room resolved via the active-room catalog
  (`resolveRequestCatalogLocation`). **No schema/RLS/migration change** — `cleaning_sessions` and its
  RLS already carry who/when/where/duration and own-vs-manager read scoping.
- **Permissions (matches the existing `cleaning_sessions` RLS):**
  - `staff` / `part_time_staff` → **own records only** (no staff filter; RLS scopes automatically).
  - `field_manager` / `cs_staff` / `office_admin` / `owner` (`canViewOthersCleaning`) → can also view
    **other staff's** records in the app via a **직원(staff) filter**; the row then shows the staff name.
  - Admin web (`/admin/cleaning`) already lists **all** records with filters + CSV/Excel export.
- New i18n: `cleaning.records.*` (ko/ja/en). Files: `src/app/mobile/cleaning/records/page.tsx`,
  `src/components/cleaning/cleaning-records-view.tsx`, `canViewOthersCleaning` in `src/config/roles.ts`.

## 2026-06-18 청소 대상 룸 라벨 — 캘린더 표시 라벨과 일치

- "청소 대상" 카드의 룸 제목(`getLocalizedRoomTitle` in `src/app/mobile/cleaning/page.tsx`)이
  이제 `getDisplayRoomLabel`을 적용해 아라키초 서브유닛을 접습니다(`501_2` → `501`). 캘린더가
  보여주는 표시 라벨과 동일해집니다.
- 가부키초 `#`/`K` 제거와 오쿠보 건물명-단독 표기는 기존 `getCanonicalRoomLabel`로 이미
  정상이었고, 이번 변경은 표시 전용입니다(저장되는 `sessionRoomLabel`·중복 제거 키는 불변).
- 동일 맥락의 홈 "오늘 체크인/체크아웃" 시트 룸 매핑 일치 작업은
  `docs/product/15-reservation-calendar.md`(2026-06-18 섹션) 참고.

## 2026-07-13 어드민 청소 대시보드 — 재기획 (감시·이력·강제완료)

> **상태 (2026-07-14):** 디자인 100% 구현 완료 + **백엔드 연동 완료**(실제 `cleaning_sessions` +
> 예약 데이터, 강제완료 서버 액션, `completed_by_admin` 컬럼). 이 섹션은 디자인·구현의 기준
> 스펙이다. 기존 `/admin/cleaning`(읽기 전용 모니터링 + CSV)을 전면 재설계했다. 백엔드 연동
> 상세는 하단 "2026-07-14 어드민 청소 대시보드 — 백엔드 연동" 절 참고.

### 성격

- PC 어드민 대시보드는 **청소를 시작/배정하는 곳이 아니다.** 시작은 모바일 현장, 배정은 별도 웹에서.
- PC의 역할 = **감시(oversight) + 이력(record) + 예외 개입(강제완료)**.
- 핵심 데이터: 모바일과 동일한 예약 기반 로직으로 "오늘(도쿄 날짜) 청소해야 할 객실"을 확실히 수집.
  단, 모바일처럼 처리되면 큐에서 사라지는 게 아니라 **상태로 계속 표시**(대기/진행/완료).

### 화면 A — 오늘 현황 보드 (실시간 감시)

- **상단 KPI 스트립**: `청소 대상 · 미시작 · 진행중 · 완료 · 완료율(%) · 셋팅 대상`.
  데이터 로드 실패 시 숫자 대신 `-`.
- **건물별 섹션 + 객실 카드**, 상태 3버킷을 명확히:
  - 🕓 **청소 대기중(미시작)** — 어느 객실이 남았는지
  - 🧹 **청소중(진행중)** — **담당 직원 이름** + 경과시간(실시간)
  - ✅ **완료** — 소요시간 + 완료 시각
- **셋팅(체크인 셋업) 대상**도 별도 리스트/섹션으로 표시(모바일엔 있으나 어드민엔 없던 것).
- ~~⚠️ 누락/미시작 강조(지연 상태)~~ **2026-07-14 삭제.** 한때 "기준 시각(11:00) 이후 미완료면
  '지연' 라벨"이었다가, 그 시각 기준을 없애 "미시작이면 항상 즉시 지연"으로 바꿨는데, 그러자 상태
  3버킷 중 "대기중"과 "지연"이 사실상 100% 동일해져(미시작 = 항상 지연) 배지 자체가 의미를 잃었다.
  최종적으로 "지연" 상태·배지·KPI 항목을 전부 삭제하고 원래의 대기중/진행중/완료 3상태로 되돌렸다
  (하단 "지연 상태 완전 삭제" 참고).
- **🏷️ 연동 리포트 배지**: 해당 청소 세션에서 나온 분실물·시설 이슈 개수(0이면 숨김).
- **직원별 오늘 요약**: 직원별 `완료 건수 · 평균 소요시간`.
- **실시간 갱신**: 자동 주기 갱신(30~60초). 즉시 realtime 구독은 이번 범위 아님.

### 화면 B — 기록/이력

- **필터 바**: 시작일 · 종료일 · 건물 · 직원(이름 검색 포함) · 상태. 어드민 공용 shared 컴포넌트 사용.
- **모든 사용자의 기록 조회** + **직원 검색**으로 특정 사용자 기록만 조회 가능.
- **테이블**: 객실 · 청소유형 · 담당자 · 상태 · 시작시각 · 소요시간 · 날짜(기간 조회 특성상 실데이터
  연동 시 추가됨, 2026-07-14).
- **행 클릭 → 우측 상세 패널**: 객실(풀네임) · 청소유형 · 상태 · 담당자 · 날짜 · 시작/종료 · 소요시간 ·
  메모 · 연동 분실물/시설 리포트 링크 · (대리 완료 시)관리자 대리 완료 표시.
- **내보내기 = Excel + PDF 둘 다** (기존 CSV 확장). 내보내기 필드:
  `사용자 · 청소 장소(건물·객실) · 청소유형 · 시작/종료 시각 · 소요시간 · 상태 · 메모`.
  PDF는 급여 PDF와 동일한 인쇄 품질 톤으로 통일(`attendance-payroll-report.ts` 패턴 재사용).

### 강제완료 (관리자 대리 완료) — 유일한 개입 액션

- **카드/상세 패널**에 `[완료 처리]` 버튼 — "진행중"뿐 아니라 **대기중·지연 상태에서도** 노출된다
  (실데이터 연동 시 확장, 2026-07-14). 세션이 아직 없는 방(대기중)을 강제완료하면
  `cleaning_sessions` INSERT, 이미 세션이 있는 방(진행중/지연)이면 UPDATE — 완료 상태에서는 버튼
  자체가 숨겨진다.
- **확인 모달**: 객실 · 담당자 · **시작 시각 입력**(AdminTimePicker, 기본값=세션 시작 시각 또는
  11:00) · **완료 시각 입력**(AdminTimePicker, 기본값=현재) · (선택)메모. → 관리자가 시작/완료
  시각을 모두 직접 입력할 수 있으므로(세션이 아예 없던 방을 대신 생성하는 경우까지 커버) 소요시간이
  항상 정확히 계산됨(직원이 몇 시간 깜빡한 경우의 소요시간 오염 방지).
- **감사 기록**: `cleaning_sessions`에 `completed_by_admin`(관리자 user id) 저장. 상세·기록 뷰에
  **"관리자 대리 완료"** 배지 표시. → 마이그레이션으로 컬럼 추가 필요.
- **권한**: 상위 관리자/매니저(owner·전무·office_admin·field_manager 등)만. 서버 액션에서 게이트.

### 상호작용 목록 (디자인이 그려야 할 것)

1. 필터(기간·건물·직원 검색·상태) 2. 탭/날짜 전환 3. 행·카드 클릭 → 상세 패널
4. Excel/PDF 내보내기 5. 대기중/진행중 세션 → 완료 처리(확인 모달). 그 외 입력/버튼 없음(읽는 화면).

**실데이터 연동 시 추가된 상호작용 (2026-07-14, 문서 갱신 누락분 반영)**: 오늘 현황의
**건물별/상태별 그룹 전환 토글**, **수동 동기화 버튼**(60초 자동 갱신과 별개로 즉시 재조회).
둘 다 화면을 다시 그리는 조회성 조작이라 "읽는 화면" 원칙에는 부합하지만, 위 5개 목록에는
누락돼 있었다.

### 범위에서 제외 (그리지 않음)

- ❌ 청소 시작/완료(직원용) 버튼 · ❌ 관리자 방 배정 UI · ❌ 취소/재배정 · ❌ 대신 청소 생성 폼
- ❌ 청소 완료 사진 업로드 · ❌ 소요시간 이상치 플래그 · ❌ 지연 알림 발송 설정(알림 단계에서)

### 상태·다국어

- **빈/로딩/에러 상태** 모두 디자인 필요(오늘 대상 0건, 기록 없음, 로드 실패).
- 새 라벨(KPI 6종, 상태 라벨, 미시작/지연/누락, 직원별 요약, 완료 건수/평균 소요, 관리자 대리 완료,
  Excel/PDF 내보내기, 빈 상태 문구)은 **ko·ja·en 동시 추가**. 폭은 en 기준으로 안전하게.

### 데이터 출처

- 오늘 대상 객실: 예약(Beds24 캐시) + 도쿄 날짜, 모바일과 동일 로직.
- 상태/시각/소요/담당/메모/대리완료: `cleaning_sessions`(+ `completed_by_admin` 신규 컬럼).
- 연동 리포트 수: 분실물·시설 테이블의 `cleaning_session_id`.

### 디자인 프롬프트 (디자이너 전달용)

**기술 스택 제약**

- Next.js 16 App Router + React 19 + Tailwind CSS v4, **데스크톱 웹**(모바일 아님).
- 스타일은 `.adm` 스코프 BEM + `admin-console.css` 톤. 새 프레임워크·아이콘팩·폰트 도입 금지.
  아이콘은 **lucide-react**. 색은 아래 CSS 변수 토큰만 사용(임의 색 금지).

**브랜드 컨셉 / 컬러 토큰**

- 웜 아이보리 크롬 — 페이지/캔버스 배경 `--background: hsl(42 36% 95%)`.
- 카드/시트는 화이트로 떠 보이게 `--surface: hsl(44 52% 98.5%)`.
- 브랜드 액센트 = 딥 잉크 네이비/인디고 `--primary: hsl(223 46% 32%)` (teal/green 금지).
- 텍스트 `--foreground: hsl(222 28% 14%)`, 보조 `--muted-foreground: hsl(222 10% 44%)`,
  테두리 `--border: hsl(40 20% 84%)`, 뉴트럴 `--muted: hsl(40 22% 90%)`.
- 경고/위험(누락·지연·삭제) `--destructive: hsl(4 62% 46%)`, 배경 `--destructive-bg: hsl(6 70% 95.5%)`.
- 톤: 근태·사용자·예약 캘린더 콘솔과 한 몸처럼. 굵은 헤딩(font-black), 라운드 12~24px, 얇은 보더 + 미묘한 그림자.

**공용 컴포넌트 — 새로 만들지 말고 100% 동일하게**

이미 존재하는 전역 공용 UI. 청소 화면에서도 시각·동작이 동일해야 하며 재디자인 금지:

- 드롭다운 = **`AdmDropdown`(`.dd`)** — 사용자 화면의 드롭다운으로 **전 화면 통일**. 흰 사각 트리거
  (쉐브론, 열리면 네이비 보더) + 바로 아래 흰 팝오버 + 선택 항목 체크·네이비 강조. 건물·직원·상태
  필터 전부 이 `.dd`로. **칩형 `.adp`(ChipDropdown)를 새로 쓰지 말 것.** 화면마다 드롭다운이 다르면 안 됨.
- 우측 상세 슬라이드 패널 = `.panel` + `.panel-scrim`(오른쪽 슬라이드-인, 스크림 딤) — 행/카드 상세.
- 중앙 하단 알림 토스트 = `.adm-toast`(하단 중앙, 1.8s 자동 소멸) — 강제완료 성공 등 피드백.
- 날짜/시간/월 선택 = `AdminDatePicker`/`AdminTimePicker`/`AdminMonthPicker` — 기간 필터·완료시각 입력.
- 확인/사유 모달 = `AdminReasonModal` 톤(중앙 정렬) — 강제완료 확인.
- 셀렉트 = `AdminSelectField`. 공용은 자리만 배치하고 별도 비주얼 리디자인 금지.

**해당 기능 화면만 디자인**

- 상단 글로벌 바 / 좌측 사이드 내비 / 사이드바는 `AdminShell`이 이미 감싼다 → **본문 콘텐츠 영역만** 디자인.
- 화면 A/B는 상단 세그먼트 탭(오늘 현황 / 기록) 전환 권장. 최종 배치는 디자이너 재량.
- 이 화면은 입력·버튼이 거의 없는 "읽는 화면". 상호작용은 앞의 상호작용 목록 5개뿐.

### 2026-07-14 디자인 구현 완료 (mock 데이터, 백엔드 연동 전)

Claude Design 핸드오프(`Foldy 청소 (admin)/청소 현황 (admin).html`)를 1:1로 React/TSX 이식했다.
**정적 mock 데이터**로 화면 A/B를 모두 구현했고, 실제 `cleaning_sessions`/예약 연동은 아직 하지
않았다 — 위 "디자인 프롬프트" 절이 정의한 범위(디자인 100%) 까지만 완료된 상태다.

- **파일**: `src/app/admin/cleaning/page.tsx`(세션 게이트 + `AdminShell` 래핑만 담당) +
  `src/components/admin/cleaning/`:
  - `cleaning-console.tsx` — 상태 소유 + KPI 6-스트립 + 뷰 탭(오늘 현황/기록) + group 세그먼트 + 동기화 칩
  - `cleaning-today-board.tsx` — 건물별/상태별 객실 카드, 셋팅 대상, 직원별 오늘 요약
  - `cleaning-history-board.tsx` — 기간·건물·직원·상태 필터 + 기록 테이블
  - `cleaning-detail-panel.tsx` — 우측 상세 패널(오늘 카드 · 기록 행 공용)
  - `cleaning-force-complete-modal.tsx` — 강제완료 모달(시작/완료 시각 입력 + 담당자 대리 선택)
  - `cleaning-console-data.ts` — mock TASKS/HISTORY/STAFF + 날짜·소요시간 헬퍼(모바일과 동일한
    캐노니컬 건물 키를 쓰고, 건물 표시명은 기존 `dictionary.cleaning.buildingLabels`를 그대로 재사용)
  - `cleaning-console.css` — 이 화면 전용 신규 컴포넌트만(KPI 6칸, 객실 카드, 상태 3버킷, 셋팅/직원
    그리드, 기록 툴바). `.dd`/`.panel`/`.modal`/`.qtbl`/`.fld`/`.btn` 등은 기존 `admin-console.css`를
    그대로 재사용했다(신규 정의 없음).
- **공용 컴포넌트 반영**: 드롭다운은 전부 `AdmDropdown`. 기간 필터는 디자인 원본과 동일하게 단일
  결합 필드("시작일 – 종료일" 트리거 하나)+ 범위 선택 캘린더 팝오버다 — 새 공용 컴포넌트
  `AdminDateRangePicker`(`src/components/admin/shared/admin-date-range-picker.tsx`)로 구현해
  다른 어드민 화면(근태·예약 등)의 기간 필터도 재사용할 수 있게 했다. **버그 수정(2026-07-14 후속):**
  최초 구현은 시작일/종료일을 `AdminDatePicker` 2개로 나눠 만들었었는데, 툴바 맨 왼쪽(사이드바 바로
  옆)에 있다 보니 시작일 팝오버가 `.content`의 스크롤 클리핑에 걸려 사이드바와 겹치며 잘리는 버그가
  있었다 — 사용자 리포트로 발견. `AdminDateRangePicker`는 팝오버를 `position:fixed`로 렌더링하고
  좌표를 트리거의 `getBoundingClientRect()` 기준으로 계산·뷰포트 클램프한다(leave-team-calendar.tsx의
  day-menu 팝오버와 동일 기법) — 어떤 스크롤 가능한 조상의 `overflow`에도 잘리지 않는다. 위 디자인
  프롬프트가 언급한 `AdminSelectField`는 이후 폐기·삭제됐으므로(2026-07-14,
  `docs/product/05-admin-web-ia.md`) 쓰지 않았다. 강제완료 모달의 시작/완료 시각은 `AdminTimePicker`.
- **i18n**: `cleaning.console.*`(ko/ja/en, `src/lib/i18n.ts`)에 KPI·상태·뷰탭·기록 테이블·상세
  패널·강제완료 모달 문구를 모두 추가했다. 건물명은 기존 `cleaning.buildingLabels`를 재사용.
- **버그 수정(부수)**: `admin-console.css`의 `--mono` 토큰이 `"Geist Mono", ui-monospace, monospace`
  뿐이라 한글이 모노스페이스 요소(`.rmc__rm`, 기록 테이블 객실 셀, `.elapsed` 등)에 들어가면 OS
  폰트 대체에 의존했다. `var(--font-noto-kr)`/`var(--font-noto-jp)`를 `monospace` 앞에 추가해
  자체 호스팅 웹폰트로 항상 렌더링되게 했다 — 청소 화면의 "단독" 객실 라벨, "기준 경과" 문구에서
  실제로 글자가 깨지는 것을 확인하고 고쳤다. 전 어드민 화면에 영향(개선만, 회귀 없음).
- **의도적으로 하지 않은 것** (범위 제외 목록과 동일): 청소 시작/완료 버튼, 관리자 방 배정, 실시간
  realtime 구독(대신 60초 폴링 `router.refresh()` — 아래 백엔드 연동 절 참고).
- 이 섹션이 기술한 mock 단계는 2026-07-14에 아래 "백엔드 연동" 절로 완전히 대체됐다. `completed_by_admin`
  컬럼, 실제 `cleaning_sessions`·예약 데이터 연동, 강제완료 서버 액션은 모두 구현 완료.

## 2026-07-14 청소 기록 내보내기 (Excel · PDF)

기록 탭 툴바의 Excel/PDF 버튼을 실제로 구현했다. **어드민 대시보드 전체의 모든 Excel/PDF는 하나의
디자인 톤으로 통일**한다는 원칙에 따라, 근태 급여 export(`attendance-payroll-workbook.ts` /
`attendance-payroll-report.ts`)와 동일한 "그린 렛저" 템플릿을 그대로 재사용했다 — 새 템플릿을
만들지 않았다.

**컬럼** (사용자와 기획 합의): No · 날짜 · 건물 · 객실 · 청소유형 · 담당자 · 시작시각 · 종료시각 ·
소요시간 · 구분(정상 완료 / 관리자 대리 완료) · 메모. 맨 아래 합계 행 = 총 건수 + 총 소요시간.
연동된 분실물/유지보수 리포트 건수는 제외(상세 패널 전용 정보로 유지).

**데이터 범위**: 기록 탭에 현재 적용된 필터(기간·건물·직원·상태·검색어) 그대로 내보낸다. 청소
모듈이 아직 mock 데이터 단계라, 클라이언트가 화면에 보이는 필터링된 행을 원본(canonical) 필드
그대로 서버 액션에 넘기고, 서버가 그 필드를 세션 로케일로 다시 로컬라이즈해서 문서를 만든다 —
클라이언트가 렌더링한 문자열을 그대로 보내지 않는다. 실데이터 연동 시에는 서버 액션 내부의
행 조회 부분만 실제 쿼리로 바뀌고, 워크북/리포트 빌더와 액션 시그니처는 그대로 유지된다.

**언어 = 로그인 사용자의 계정 언어.** 서버 액션이 `requireAdminSession()`으로 세션을 가져와
`session.user.preferredLanguage`로 `getDictionary()`를 호출한다 — 클라이언트가 로케일을 넘기지
않는다(근태 export와 동일한 원칙). Excel/PDF 모두 로그인 사용자가 설정한 언어(ko/ja/en)로 그대로
출력된다.

**새 파일**:
- `src/lib/cleaning-history-workbook.ts` — `.xlsx` 빌더(exceljs). 색상·테두리는
  `attendance-payroll-workbook.ts`가 export하는 `WORKBOOK_TITLE_FILL` / `WORKBOOK_HEADER_FILL` /
  `WORKBOOK_TOTAL_FILL` / `WORKBOOK_INK` / `workbookBox()`를 그대로 가져다 씀(새 팔레트 없음).
- `src/lib/cleaning-history-report.ts` — 인쇄용 HTML 빌더. `attendance-payroll-report.ts`와 동일한
  A4 landscape 그린 렛저 CSS·폰트스택(`'Meiryo','Malgun Gothic','Apple SD Gothic Neo','Hiragino
  Sans'`)을 그대로 사용.
- `src/app/admin/cleaning/actions.ts` — 서버 액션 2개(`exportCleaningHistoryWorkbook`,
  `exportCleaningHistoryReport`). `requireAdminSession()`으로 게이트 — 지금은 청소 콘솔 페이지
  자체와 동일한 접근 권한(파트타임 제외 전원)을 쓴다. 더 좁은 역할 제한(구 문서의 "Staff/Part-time
  불가" 스펙)이 필요하면 별도 결정 필요.
- 클라이언트(`cleaning-history-board.tsx`)는 근태와 동일 패턴: 엑셀은 `downloadAdminWorkbook`
  (base64→Blob 다운로드, `admin-format.ts` 재사용), PDF는 클릭 시점에 `window.open('', '_blank')`로
  빈 탭을 먼저 연 뒤(팝업 차단 회피) 서버가 만든 HTML을 `document.write`.
- i18n: `cleaning.console.colEnd/colNo/colNote/exportTitle/exportGeneratedLabel/exportTotalLabel/
  exportPrint/exportBlocked/tExportDone/tExportFailed`(ko/ja/en 추가). 기존 `colDate`/`colRoom`/
  `colType`/`colStaff`/`colStart`/`colDur`/`building`/`status`/`stNormal`/`stProxy` 키를 export
  컬럼 라벨로 재사용해 화면 라벨과 export 라벨이 어긋나지 않게 했다. 플레이스홀더였던
  `tExportXls`/`tExportPdf` 토스트 키는 제거.
- 파일명: `cleaning-history_{시작일YYYYMMDD}_{종료일YYYYMMDD}.xlsx`.

## 2026-07-14 어드민 청소 대시보드 — 백엔드 연동

위 mock 구현(화면 A/B, Excel/PDF export)을 실제 `cleaning_sessions` + 예약(Beds24 캐시) 데이터로
전면 교체했다. UI/디자인은 변경 없음 — 값의 출처만 mock 상수 → 실데이터로 바뀌었다.

**DB 마이그레이션**: `supabase/migrations/202607150001_cleaning_sessions_admin_force_complete.sql`
(원격 프로젝트에 적용 완료). `cleaning_sessions.completed_by_admin uuid references profiles(id)`
컬럼 추가 — 관리자가 담당자를 대신해 강제완료한 경우에만 채워짐(일반 완료는 `null`). 인덱스는
`where completed_by_admin is not null`인 부분 인덱스. RLS 정책은 건드리지 않았다 — 강제완료
서버 액션은 서비스 롤(RLS 우회) + 앱 레벨 역할 체크로 쓰기 때문(근태 관리자 쓰기 패턴과 동일).

**새/수정 파일**:
- `src/lib/room-label-normalization.ts` — 룸키 해석 로직(`resolveRoomKey`의 3단계 폴백,
  `buildRoomKey`/`buildSessionRoomLabel`, `buildSessionLabelToRoomKeyMap`,
  `buildLegacyAliasToRoomKeyMap`)을 공용 export로 승격. 기존에 `mobile/cleaning/page.tsx`와
  `cleaning-targets.ts`에 각각 중복 구현돼 있던 것을 여기 하나로 통합했고, 두 파일 모두 이 export를
  import하도록 리팩터(동작 100% 동일, 어드민이 세 번째 소비자로 추가).
- `src/lib/cleaning.ts` — `getOrgTodayCleaningSessions`(오늘 조직 전체 세션 전체 컬럼 조회),
  `CLEANING_OVERDUE_HOUR = 11`(도쿄 기준 지연 판정 시각), `canForceCompleteCleaning`/
  `cleaningForceCompleteRoles`(강제완료 가능 역할: developer_super_admin·owner·전무·office_admin·
  field_manager), `getCleaningStaffOptions`(청소 담당 가능 역할로 필터된 직원 목록) 추가.
- `src/lib/admin-cleaning.ts` (신규) — 실데이터 레이어. `getAdminCleaningToday(session)`은
  `getCleaningTargets`(예약 기반 오늘 청소 대상) + `getOrgTodayCleaningSessions`(오늘 세션)을
  roomKey로 매칭해 상태(대기/진행/완료/지연)를 산출한다. 예약과 매칭되지 않는 세션(수동/장기투숙
  청소 등)도 별도 카드로 포함해 실데이터가 누락되지 않게 했다. `getAdminCleaningHistory`는 기존
  `getOrgCleaningSessionsFiltered`를 감싸 화면/export가 기대하는 모양으로 매핑.
- `src/app/admin/cleaning/actions.ts` — `forceCompleteCleaningSession` 추가(세션 있으면 UPDATE,
  없으면 INSERT, 둘 다 `completed_by_admin: 관리자 id` 기록). `fetchAdminCleaningHistory(from, to)`
  추가 — 기록 탭에서 최초 로드된 달(page.tsx가 서버에서 미리 로드) 밖의 기간을 선택하면 이 액션으로
  다시 조회한다. `exportCleaningHistoryWorkbook`/`exportCleaningHistoryReport`는 시그니처 변경 없음
  (mock 단계부터 이미 "클라이언트가 넘긴 필터된 행을 서버가 그대로 포맷" 구조였기 때문).
- `src/app/admin/cleaning/page.tsx` — `requireAdminPageSession`으로 게이트, `getAdminCleaningToday` +
  이번 달 `getAdminCleaningHistory`를 서버에서 미리 로드해 `CleaningConsole`에 prop으로 전달(첫
  렌더에 빈 화면이 보이지 않게).
- `src/components/admin/cleaning/*.tsx` — mock 타입(`CleaningTask`/`HISTORY`/`STAFF`/`TASKS`)을
  전부 제거하고 `admin-cleaning.ts`의 실데이터 타입(`AdminCleaningTask`/`AdminCleaningHistoryItem`/
  `AdminSettingTarget`)으로 교체. 강제완료는 로컬 state 낙관적 패치 대신 서버 액션 호출 →
  성공 시 `router.refresh()`(근태 관리자 쓰기 패턴과 동일). 오늘 현황 보드는 60초 주기 + 수동
  동기화 칩 클릭 시 모두 `router.refresh()`로 실제 서버 데이터를 다시 가져온다(실시간 realtime
  구독은 여전히 범위 밖 — 폴링으로 "진행 중 청소 자동 갱신" 요구를 충족).
- **셋팅 대상의 목적 = 불 꺼진 방을 되살리는 것 (2026-08-07 명문화)**. 운영 규칙은 이렇다.
  - 체크아웃이 있는 날은 **무조건 그날 청소**한다.
  - 체크아웃 당일에 체크인이 있으면(턴오버) 청소하며 그대로 이어지므로 **셋팅 대상이 아니다**.
  - 체크아웃 당일에 체크인이 없으면 청소만 하고 **방에 불을 끈다**. 그날은 셋팅하지 않는다.
  - 공백이 지난 뒤 **다음 체크인이 오는 날**, 그 방이 셋팅 대상이 된다.

  구현의 「오늘 체크인 + 오늘 체크아웃 없음」 조건이 곧 「불 꺼진 상태에서 손님을 받는 방」이라
  이 규칙과 의미가 같다. 예: 다카다노바바 9호실이 08-04 체크아웃 후 공실이다가 08-08 체크인이면
  **08-08 이 셋팅 대상**이고, 그 사이 08-05~07 에는 뜨지 않는 것이 정상이다.

  **주의 — 예약 캘린더 KPI 는 같은 정의를 쓰지만 별도 구현이다.** 2026-08-07 까지 그쪽 중복 제거가
  전체 예약을 훑는 버그로 **항상 0** 을 보여주고 있었다(실측 화면 0 / 실제 2건). 두 화면이 같은
  정의를 따르는지 바꿀 때마다 함께 확인해야 한다.
- **셋팅 대상 정의 변경**: mock 단계는 "체크아웃 있는 방 중 턴오버"로 셋팅 대상을 계산했지만,
  실데이터는 모바일과 동일한 `getCleaningTargets().settingList`(체크아웃 없는 순수 입실 객실만)를
  그대로 쓴다 — 체크아웃 카드에는 이미 턴오버 도착 정보가 별도 표시되므로 중복을 피했다(모바일과
  셋팅 대상 정의가 완전히 일치).
- **셋팅 카드 클릭 → 예약 정보 전용 축소 패널 (2026-07-14 후속)**: 처음엔 셋팅 대상(예약만 있고
  아직 청소 세션이 없는 방)에 보여줄 실데이터가 없어 mock 단계의 클릭 핸들러를 제거했었지만,
  사용자 피드백으로 다시 클릭 가능하게 만들었다. 단, 일반 청소 카드/기록 행과 같은 상세 패널을
  재사용하지 않고 `CleaningDetailPanel`에 `setupTarget` 분기를 추가해 별도의 축소된 패널을
  렌더링한다 — 객실·건물·게스트명·인원·"오늘 도착"만 보여주고, 시간 기록/담당자/메모/연동 리포트/
  강제완료 버튼은 표시하지 않는다(해당 데이터 자체가 없으므로). 안내 문구
  (`cleaning.console.setupNoSession`, ko/ja/en)로 "아직 청소 세션이 시작되지 않았다"는 것을 명시한다.
  선택 상태는 오늘 현황 탭 내에서 청소 카드 선택(`selectedId`)과 셋팅 카드 선택(`selectedSetupKey`)이
  상호 배타적으로 관리된다(하나를 클릭하면 다른 하나는 자동 해제).
- **직원 아바타 색상**: 실제 직원 프로필에는 색상 컬럼이 없어 스키마 변경 없이 user id 해시 기반
  고정 팔레트(8색)로 결정적으로 배정 — 같은 사람은 세션 내내 항상 같은 색.
- **아바타 도착 시각**: mock은 가짜 도착 시각(`arrive`)을 보여줬지만 실제 예약에는 시각 정보가 없어
  (체크인 날짜만) `hasArrivalToday: boolean` + "오늘" 라벨로 대체.
- **직원별 오늘 요약 = 실제로 오늘 청소를 완료한 직원만 (2026-07-14 후속)**: 처음엔 청소 담당
  가능 역할(오너·현장매니저·직원·파트타임)을 가진 조직의 모든 활성 멤버를 항상 표시했었는데(오늘
  실적이 없으면 "완료 0건"), 조직 인원이 늘어날수록 실제로 일하지 않은 사람까지 다 나열되는 문제가
  있어 사용자 피드백으로 변경했다. 이제 오늘 완료 건수가 1건 이상인 직원만 카드로 표시하고, 아무도
  완료하지 않았으면 섹션 자체를 렌더링하지 않는다(`cleaning-today-board.tsx`의
  `StaffSummarySection`).
- **공용 내보내기 빌더로 재통합 (2026-07-14 후속).** 바로 위 "2026-07-14 청소 기록 내보내기" 절이
  설명한 전용 파일 `src/lib/cleaning-history-workbook.ts` / `cleaning-history-report.ts`는 이후 **삭제**됐다.
  같은 날 안에 어드민 콘솔 전체(분실물·수리점검·주문·연차·근태수당 등)의 모든 Excel/PDF 내보내기를 단일
  공용 빌더로 통합하는 작업이 이어졌기 때문 — `src/lib/admin-table-workbook.ts`
  (`buildAdminTableWorkbookBase64`)와 `src/lib/admin-table-report.ts` (`buildAdminTableReportHtml`)가
  그린 렛저 템플릿(제목 병합행 → 헤더행 → 번호 매긴 데이터행 → 합계행 → org/생성일시 푸터, 색상은
  기존 `attendance-payroll-workbook.ts` 상수 재사용)의 단일 소스가 됐다. `src/app/admin/cleaning/actions.ts`의
  `exportCleaningHistoryWorkbook` / `exportCleaningHistoryReport`는 시그니처·데이터 범위·산출물 서식
  변경 없이 이 공용 빌더를 직접 호출하도록 리팩터됐을 뿐이다(청소 기록 탭이 이 통일의 시각 기준선
  이었다는 사실은 그대로 유지). 로케일 해석 방식(`session.user.preferredLanguage`, 클라이언트는
  로케일을 넘기지 않음)도 `src/lib/admin-export-meta.ts`의 `buildAdminExportMeta(session)`으로
  공용화됐다. 클라이언트 버튼도 근태와 동일한 커스텀 다운로드/인쇄 로직 대신 공용
  `<AdminExportButtons>`(`src/components/admin/shared/admin-export-buttons.tsx`)로 교체됐다. 컬럼·필터
  범위·i18n 키(`cleaning.console.col*`, `exportTitle` 등)는 변경 없음 — `exportXls`/`exportPdf`/
  `exportGeneratedLabel`/`exportTotalLabel`/`colNo`/`exportPrint`/`exportBlocked` 같은 공용 문구만
  신규 `dictionary.admin.shared.*` 네임스페이스로 옮겨졌다(청소 전용 키는 유지, 공용 문구만 이전).
- **버그 수정(2026-07-14 후속): 강제완료 모달 담당자 드롭다운이 비어 표시됨.**
  `getCleaningStaffOptions`(`src/lib/cleaning.ts`)가 `memberships.role`을 조회할 때 쓰는 역할 목록에
  플랫폼 전용 역할 `developer_super_admin`이 섞여 있었는데, 이 값은 `organization_role` DB enum에
  존재하지 않아 `.in("role", ...)` 쿼리 자체가 Postgres에서 enum 캐스팅 에러로 거부됐다. 그 에러가
  `getAdminCleaningToday`의 `.catch(() => [])`에 조용히 삼켜지면서 담당자 목록이 항상 빈 배열이
  됐다. 쿼리 직전에 `developer_super_admin`을 필터링해서 제외하도록 수정(기존
  `admin/announcements/[id]/page.tsx`의 `orgAdminWebRoles` 패턴과 동일).
- **문서 감사 후속 구현 (2026-07-14): 데이터 로드 실패 시 KPI "-" 표시.**
  `getAdminCleaningToday`(`src/lib/admin-cleaning.ts`)가 `getCleaningTargets`/
  `getOrgTodayCleaningSessions`/`getCleaningStaffOptions` 중 하나라도 실패하면 `loadError: true`를
  반환하도록 확장. `CleaningConsole`은 `loadError`일 때 KPI 6칸 전부(청소 대상·미시작·진행중·완료·
  완료율·셋팅 대상)를 숫자 대신 `-`로, 서브 라벨은 `t.errT`("데이터를 불러오지 못했습니다")로
  표시한다. `getActiveRoomCatalogServer` 실패는 룸키 매칭 정밀도만 낮추는 보조 데이터라 `loadError`
  판정에서 제외.
- **문서 감사 후속 구현 (2026-07-14): 연동 리포트 타일 클릭 → 실제 이동.**
  기존엔 상세 패널의 분실물/유지보수 리포트 타일을 눌러도 토스트만 뜨고 실제로 이동하지 않았다.
  `admin-cleaning.ts`의 세션별 리포트 집계를 건수(count)뿐 아니라 실제 레코드 id 배열
  (`lostIds`/`issueIds`, `lost_items`/`maintenance_reports` 조회에 `id` 컬럼 추가)까지 반환하도록
  확장하고, 상세 패널의 `onOpenReport(kind)` 콜백이 해당 종류의 id가 1개면 `/admin/lost-found/{id}`
  또는 `/admin/maintenance/{id}`로 바로 이동, 2개 이상이면 목록 화면(`/admin/lost-found`,
  `/admin/maintenance`)으로 이동한다(세션 단위 필터링 파라미터가 두 목록 화면에 없기 때문). 기록
  탭 행에는 `reports`가 항상 없으므로(과거 세션 조회 시 리포트 집계를 하지 않음) 이 동작은 오늘
  현황 카드에서만 의미가 있다 — 자리표시자였던 `cleaning.console.tReport` i18n 키는 삭제.
- **범위 제외 위반 제거 (2026-07-14): 소요시간 70분 이상 경고 배지 삭제.** Claude Design 목업을
  1:1 이식할 때 딸려온 `dur >= 70` 하드코딩 경고 표시(기록 테이블·상세 패널 소요시간에 노란/경고색
  + 세모 아이콘)가 있었는데, 이는 문서의 "범위에서 제외" 목록에 명시된 "❌ 소요시간 이상치
  플래그"와 정면으로 충돌하는 상태였다. 게다가 `70`분이라는 기준값 자체가 실제 운영 데이터와 무관한
  임의값이었고, 사용자 확인 결과 이 조직의 실제 최단 청소 소요시간이 2시간 30분(150분)이라 이
  기준으로는 사실상 모든 청소 건이 상시 "경고" 상태가 되어 기능이 무의미했다 — 완전히 삭제
  (`cleaning-history-board.tsx`, `cleaning-detail-panel.tsx`의 `long`/`is-long` 분기와
  `cleaning-console.css`의 `.hdur.is-long`/`.durbig__lbl.is-long` 규칙 제거).
- **지연 판정 시각 기준 삭제 (2026-07-14).** 기존엔 오늘 체크아웃인데 미시작인 방을 도쿄 기준
  11:00(`CLEANING_OVERDUE_HOUR`) 이전엔 중립("대기중"), 11:00 이후에만 경고색("지연")으로
  표시했다. 사용자 판단으로 이 시각 기준을 완전히 제거했다 — 관리자가 대시보드를 실제로 확인하는
  시점은 근무 시간대에 따라 제각각이라 특정 고정 시각과 무관하며, 미시작 체크아웃 객실은 언제
  확인하든 항상 즉시 조치가 필요한 항목이므로 "아직은 괜찮은 대기 상태"라는 유예 구간 자체가
  의미가 없다는 판단. `src/lib/admin-cleaning.ts`에서 미매칭 체크아웃 대상은 이제 즉시 `overdue`
  상태로 분류되며(`pending`은 이 경로에서 더 이상 발생하지 않음 — 타입은 향후 확장을 위해 유지),
  `src/lib/cleaning.ts`의 `CLEANING_OVERDUE_HOUR` 상수와 `admin-cleaning.ts`의
  `tokyoNowMinutes()` 헬퍼는 삭제됐다. "기준시각 경과"를 언급하던 `overdueNote`/`overduePast`
  i18n 문구(ko/ja/en)도 "청소 미시작" 계열로 수정. **→ 이 결정은 바로 아래 "지연 상태 완전 삭제"로
  완전히 대체됐다(같은 날 후속 결정).**
- **지연 상태 완전 삭제 (2026-07-14, 위 항목의 후속).** 시각 기준을 없앤 결과 "대기중"과 "지연"이
  100% 동일한 조건(미시작 = 항상 지연)이 되어 배지가 상시 켜진 상태로만 보였고, 사용자가 실제
  화면에서 확인한 뒤 "저건 필요 없는 기능"이라고 판단해 `overdue` 상태 자체를 완전히 삭제했다.
  이제 상태는 원래의 3버킷(`pending`/`progress`/`done`)만 존재한다.
  - `src/lib/admin-cleaning.ts`: `AdminCleaningStatus`에서 `"overdue"` 제거, 미매칭 체크아웃
    대상은 다시 기본값 `"pending"`으로 분류.
  - `cleaning-console-shared.tsx`: `STATUS_ICON`의 `overdue` 항목, `statusLabel`/`StatusPill`의
    overdue 분기 제거.
  - `cleaning-today-board.tsx`: 룸카드의 "지연" 경과 배지, 지연+오늘도착 턴오버 경고 문구,
    상태별 버킷("대기중")의 overdue 포함 필터를 모두 제거.
  - `cleaning-console.tsx`: KPI "미시작" 셀의 `overdueCount` 합산·빨간 배지 칩 제거(이제
    `pendingCount`만 표시).
  - `cleaning-console.css`: `.rmc.is-overdue`, `.cstat--overdue`, `.elapsed.is-late`,
    `.opscell__flag` 규칙 삭제(전부 지연 전용이었음).
  - i18n: `cleaning.console.stOverdue`/`overdueNote`/`overduePast` 키를 ko/ja/en에서 완전히 삭제.
- i18n: `cleaning.console.histLoading`(기간 변경 시 서버 재조회 중 로딩 문구), `tDoneFailed`(강제완료
  실패 토스트)를 ko/ja/en 추가. `tReport`(사용처 없어진 자리표시자 토스트 문구)는 삭제.
- **검증**: `npm run lint` / `npm run build` 통과. 로그인 세션이 필요한 실제 클릭 동작(강제완료,
  기간 재조회, export)은 이 작업에서 라이브 테스트하지 못했다 — 사용자가 로그인된 세션에서 직접
  확인 필요.

## 2026-07-29 어드민 청소 대시보드 — 객실 정렬 규칙 (건물 순 → 객실번호 순)

**문제.** `getAdminCleaningToday()`가 정렬을 전혀 하지 않아, `getCleaningTargets()`가 돌려준 예약
순서(+ 뒤에 append 되는 예약 미매칭 세션) 그대로 카드가 렌더링됐다. 실제 화면에서 가부키초가
`402 → 302 → 202`, 아라키초B가 `AB201 → AB301 → AB401 → AB202`로 나와 현장에서 방을 찾기 어려웠다.

**규칙 (확정).** 어드민 청소 콘솔의 모든 객실 목록은 **건물 순 → 객실번호 오름차순**으로 정렬한다.

- **건물 순서**는 `BUILDING_ORDER`(아라키초A → 아라키초B → 가부키초 → **STAY ARI** → 다카다노바바 → 오쿠보A →
  오쿠보B → 오쿠보C)를 그대로 따른다 — 예약 캘린더 순서(`CALENDAR_BUILDING_ORDER`)와 같다(2026-10-15, 아래 절). 이 목록에
  없는 건물은 뒤로 밀고 건물명 가나다순(「기타」 칸, 이름 그대로).
- **객실번호**는 `compareRoomLabel()`(신규, `src/lib/room-label-normalization.ts`)로 비교한다.
  구현은 `localeCompare(b, "ko", { numeric: true })` — 숫자 구간을 숫자로 비교하므로
  `202 < 302 < 402`, `AB201 < AB202 < AB301 < AB401`, `8 < 9 < 10`이 된다. 단순 사전순이면
  402가 8보다, AB301이 AB202보다 앞에 오는 문제가 생긴다.

**적용 위치.** 정렬은 **서버(`src/lib/admin-cleaning.ts`)에서 한 번만** 수행한다. 보드 컴포넌트가
아니라 데이터 레이어에서 정렬하므로 "건물별" 그룹 · "상태별" 버킷 · 셋팅 대상 섹션이 자동으로
같은 순서를 공유한다(그룹핑이 원본 배열 순서를 보존하기 때문).

- `getAdminCleaningToday()`: 반환 직전 `tasks` / `setupTargets`에 `compareByBuildingThenRoom` 적용.
- `getAdminCleaningHistory()`(기록 탭): 쿼리 순서인 `cleaning_date ASC`는 유지하고, **같은 날짜
  안에서만** 건물 순 → 객실번호 순으로 재정렬한다(기존에는 `started_at DESC`, 즉 시작 시각 역순
  이라 날짜 안 객실 순서가 무작위로 보였다). 기록 테이블 행과 Excel/PDF 내보내기가 같은 배열에서
  파생되므로 화면과 내보내기 서식이 항상 일치한다.

**변경 파일**: `src/lib/room-label-normalization.ts`(`compareRoomLabel` 신규 export),
`src/lib/admin-cleaning.ts`(`buildingRank` / `compareByBuildingThenRoom` 내부 헬퍼 + 두 조회 함수에 적용).
UI 컴포넌트 · i18n · DB 스키마 변경 없음.

**검증**: `npm run lint`(에러 0) / `npm run build` 통과.


### 실패 사유 표시 점검표 (2026-08-04)

| 화면 | 이전 상태 |
| --- | --- |
| 모바일 청소 | 사유 6종 사전 누락 → 배너 없음 |
| 모바일 주문 | `?error=` 를 읽지 않음 → 배너 없음 |
| 관리자 수리·점검(목록) | `?error=` 를 읽지 않음 → 배너 없음 |
| 모바일 분실물 · 수리 신고 | `?? null` — 사전에 없는 키면 침묵 |
| 관리자 수리·점검(상세) | `?? null` — 같은 위험 |
| 모바일 투두 · 린넨 · 건의 | `?? save_failed` 폴백 (정상) |
| 관리자 설정 · 근태 설정 · 조직 | `?? save_failed` 폴백 (정상) |

모두 `?? save_failed` 폴백으로 통일했다. **키 누락은 버그지만, 그 버그가 사용자에게 무반응으로
보이는 것이 더 나쁘다** — 문구가 정확하지 않더라도 무언가는 뜨는 쪽을 택한다.


## 2026-10-15 STAY ARI Apartment Hotel 청소 대상이 대시보드에서 사라지던 것 · 건물 순서 = 예약 캘린더

**증상(사용자).** 앱 · 대시보드 청소에 STAY ARI 데이터가 없다 — 다른 기능(캘린더 · 판매 · 자동화 청소 명단)에는 다 나온다.

**원인.** 예약 · 청소 대상 계산(`getCleaningTargets`)은 정상이었다(실데이터 10/15 2실, 10/16 11실). 화면 쪽 건물 목록이 둘로
갈라져 있었다.

- 대시보드: 9/29 에 `CANONICAL_TO_BUILDING_KEY` 에 `stay_ari` 이름표가 붙으면서 스테이아리가 「아는 건물」로 분류됐는데,
  `BUILDING_ORDER`(7개)에는 없었다. 오늘 현황은 `BUILDING_ORDER` 만 돌며 칸을 그리므로 **그 건물 칸이 통째로 빠졌다**(「기타」 칸으로도
  안 감). 기록 탭 건물 필터에도 없었다.
- 모바일: 지우지는 않았지만 화면 안 건물 순서 목록(7개)에 없어 **맨 아래**로 밀렸다.

**고침.**
- `BUILDING_ORDER` · `BuildingKey` 에 `stay_ari` 추가, 순서는 **예약 캘린더와 같게**(가부키초 바로 다음 — 사용자 결정). 사노는 현장
  운영 제외라 넣지 않는다.
- `buildingKeyOf()`(`cleaning-console-data.ts` 로 옮김)는 `BUILDING_ORDER` 에 있는 키만 돌려준다 — 이름표만 있고 순서에 없는 건물은
  `null` → 「기타」 칸에 이름 그대로. 다시는 조용히 사라지지 않는다.
- 모바일 청소의 건물 순서는 `CALENDAR_BUILDING_ORDER` 에서 파생(따로 적은 목록 삭제).
- 회귀 테스트 `src/lib/__tests__/cleaning-building-order.test.ts` — `BUILDING_ORDER` = 캘린더 순서(운영 건물만), 스테이아리 위치,
  모르는 건물 → null, 방 번호 숫자만(`O103` → `103`).

## 2026-10-15 「청소 시작」이 반응 없던 것 — 아라키초 쉬는 계정 예약 · 화면 밖 안내

**증상(사용자).** 모바일에서 청소 시작을 눌러도 작동하지 않는다.

**원인 (실기록).** 10/15 08:26 · 08:27(도쿄) 시작 두 번이 서버에서 `invalid_selection` 으로 거절됐다(`[cleaning] blocked` 로그,
`cleaning_sessions` 0행).

- 아라키초는 한 방에 Beds24 계정이 둘이다(`401` 쉬는 계정 · `401_2_2` 판매 중). 청소 대상은 실제 방으로 접어 계산하지만, 카드는 예약이
  걸린 계정 라벨(「아라키초A 401」)로 시작을 보낸다. 시작 검사는 **판매 중 카탈로그의 라벨과 글자로** 맞춰 봤으므로 쉬는 계정 예약은 늘
  거절됐다(실데이터: 10/15 아라키초A 401, 10/16 301 · 402). 아라키초A 가 목록 맨 위라 처음 누르는 카드가 바로 이것이었다.
- 거절 안내는 화면 **위쪽**에 뜨는데 셸이 스크롤 위치를 유지해, 아래 카드에서 누른 사람에게는 화면 밖이라 무반응처럼 보였다.

**고침.**
- `physicalRoomKeyOfSessionLabel()`(`room-label-normalization.ts`) — 세션 라벨 → 실제 방 키(아라키초 `_N` 계정을 접음).
- `startCleaningSession`: 카탈로그 라벨과 글자로 같거나 **같은 실제 방**이면 받는다(이름표 없는 새 건물은 예전처럼 글자 비교). 「오늘 이미
  시작/완료」 검사도 같은 실제 방의 다른 계정 라벨까지 본다. 라벨은 카드가 보낸 그대로 저장.
- 모바일 청소(남은 카드 걸러내기 · 지난 날 기록)와 대시보드 오늘 현황(세션 ↔ 카드 짝짓기)도 실제 방 단위로 짝짓는다 — 「401」 카드와
  「401_2_2」 세션이 따로 노는 일이 없게.
- 결과 안내(거절 · 시작됨 · 완료 · 취소 · 분실물/수리 보고)는 `CleaningNotice` 로 뜨는 즉시 화면 가운데로 끌어온다. 액션이 매번 `n`
  (새 값)을 붙여 같은 거절이 연달아 와도 매번 보인다.
- 확인: 실데이터 10/14 ~ 10/20 청소 · 셋팅 카드 전부(14 ~ 26장/일) 새 규칙으로 거절 0. 회귀 테스트 `cleaning-building-order.test.ts`.

## 지난 날짜의 미완료 세션 교착 (2026-08-04)

`cleaning_sessions_one_active_per_org_user_idx` 는 **(organization_id, staff_user_id) 당
`in_progress` 를 하나로 제한하며 날짜 조건이 없다.** 그런데 모바일 화면은 오늘 날짜 세션만
읽고 있었다(`getMyTodayCleaningSessions`). 그래서 어제 이전에 시작하고 완료하지 않은 세션이
남으면:

1. 화면에는 아무것도 보이지 않고,
2. 새 청소·셋팅을 시작하면 unique 위반(23505) → `already_active` 로 튕기고,
3. 그 세션을 완료·취소할 UI 가 없어 **영구 교착**이 된다.

실제로 2026-06-30 에 시작된 세션이 34일간 남아 그 사용자의 모든 시작을 막고 있었다. 증상은
"셋팅 시작을 눌러도 안 된다" 였고, 같은 시기 실패 사유가 화면에 안 뜨던 문제(위 절)와 겹쳐
원인 파악이 늦어졌다.

정리한 것:

- `getMyActiveCleaningSession()` — **날짜를 빼고** `in_progress` 를 찾는다. 화면의
  `activeSession` 은 이제 이 함수가 준다. 지난 날짜 세션도 항상 카드로 뜨므로 그 자리에서
  완료 또는 취소할 수 있다(취소 액션은 원래부터 날짜를 보지 않는다).
- 세션 날짜가 오늘이 아니면 **경고 배너**(`staleActiveNotice`)로 언제 시작한 것인지와 푸는
  방법을 알린다.
- `already_active` 문구에 "먼저 완료하거나 취소해 주세요" 를 붙였다 — 무엇을 하라는 안내가
  없으면 사용자는 여전히 막힌 채로 남는다.

**남은 과제(미결):** 자정을 넘겨 잊고 퇴근한 세션을 자동으로 정리할지 여부. 현재는 사용자가
직접 완료/취소해야 한다. 자동 취소는 실제 청소 기록을 지울 위험이 있어 결정 전까지 보류한다.


## 과거·미래 날짜 조회 (콘솔, 2026-08-04)

`/admin/cleaning` 의 **오늘 현황** 탭이 `?date=YYYY-MM-DD` 로 **아무 날짜나** 볼 수 있다. 기본값은
오늘이고, 형식이 어긋난 값은 조용히 오늘로 떨어진다.

### 왜 되는가

청소·셋팅 대상은 **예약에서 파생**된다(그날 체크아웃 → 청소, 그날 체크인 → 셋팅). 날짜만 바꾸면
같은 계산이 그대로 돌아간다. `getCleaningTargets(orgId, date?)` 와
`getOrgTodayCleaningSessions(orgId, date?)` 에 날짜를 열었을 뿐, 판정 로직은 건드리지 않았다.

### 과거 날짜에서 얻는 것 — 빠뜨린 청소

**대상은 재계산이고 세션은 사실이다.** 두 축을 한 화면에 겹치므로, 대상에 있는데 세션이 없는 방이
곧 **그날 빠뜨린 청소**다. 완료된 건 담당자·시작/완료 시각·소요시간이 그대로 나온다
(`staff_user_id` / `started_at` / `completed_at` / `duration_seconds` 는 이미 저장돼 있었다).

기존 **기록** 탭은 "실제로 한 청소"만 보여준다 — **안 한 것은 보이지 않는다.** 그 빈자리를 이
화면이 채운다.

### 두 방향의 한계 (화면에 명시한다)

| | 한계 | 화면 안내 |
| --- | --- | --- |
| 과거 | 대상은 **지금** 예약으로 다시 계산한 값이다. 그 뒤 취소·변경된 예약은 사라지거나 달라져 **그날 실제로 보였던 목록과 다를 수 있다** | `datePastNotice` |
| 미래 | 먼 날짜일수록 예약이 덜 차 있어 **건수가 실제보다 적게 보인다**. 한가한 것이 아니라 아직 안 찬 것이다 | `dateFutureNotice` |

정확한 과거 재현은 매일 대상을 스냅샷으로 남겨야 가능하다. 테이블이 하나 느는 비용 대신 **한계를
말해 주는 쪽**을 택했다. (실측: 2026-08 체크아웃 546건 ≈ 하루 18건인데 11월은 47건 ≈ 하루 1.5건 —
후자는 예약이 안 찬 것이지 한가한 것이 아니다.)

### 동작 차이

- **미래 날짜**: 대리 완료(강제완료)를 노출하지 않는다 — 아직 일어나지 않은 청소를 완료로 만들 수
  있으면 안 된다. 서버 권한 검사가 최종 방어선이고 이건 UI 게이트다.
- **과거·오늘**: 기존과 동일.

### 날짜 컨트롤

CLAUDE.md §4a 대로 **공용 `AdminDatePicker`** 의 nav 변형을 그대로 쓴다(◀ ▶ + 팝오버 달력).
근무표용이라 미래가 막혀 있어 **`allowFuture` 옵션을 추가**했다 — 기본값은 기존 동작(미래 차단)이라
근무표는 영향이 없다. 라벨은 `dictionary.admin.shared` 에 날짜 단위 키
(`datePrevDay` / `dateNextDay` / `dateSelect` / `dateTodayTag` / `datePastTag`)를 추가해 공용으로 둔다.

### 모바일 (2026-08-04, 같은 날 추가)

`/mobile/cleaning` 도 `?date=` 로 같은 날짜 이동을 한다. 컨트롤은 `CleaningDaySwitcher` —
`‹ 8월 4일 (월) ›` 이고, **라벨을 누르면 공용 `DatePickerSheet`(바텀시트 달력)** 가 열린다.
화살표만으로는 몇 주 떨어진 날짜에 갈 수 없기 때문이다. 시트는 `docs/product/16-mobile-navigation.md`
의 공용 규격을 따른다(§3 — 모든 슬라이드업 시트는 canonical `BottomSheet`). 콘솔은 `.calpop`
규격의 `AdminDatePicker` 를 유지하며(§4a는 콘솔 한정), **두 규격을 섞지 않는다.**

**오늘이 아닌 날짜에서는 시작 버튼을 전부 감춘다.** 청소 시작 액션은 `cleaning_date` 를 **항상
오늘**로 기록하므로, 8월 1일을 보다가 시작을 누르면 엉뚱한 날짜에 세션이 생긴다. 청소 카드,
셋팅 카드, 셋팅 대상 시트(KPI 안) 세 곳 모두 막았다.

완료된 건은 **담당자 이름 · 완료 시각**을 카드 우측에 보여준다.

#### 권한에 따라 "기록 없음"을 그리지 않는다

RLS 상 `staff` / `part_time_staff` 는 **본인 세션만** 읽는다(실측: 장지원이 볼 수 있는 세션
0/29). 그 사람들에게 남의 청소를 "기록 없음"으로 그리면 **빠뜨린 청소처럼 읽힌다.** 그래서
`canReadAllCleaningSessions(role)` 로 판정해 **단정할 수 있는 사람에게만** 그 배지를 그리고,
아닌 사람에게는 아무것도 그리지 않는다.

> `cleaningReadAllRoles` 는 RLS 정책 `members can read relevant cleaning sessions` 와 **같은
> 목록을 유지해야 한다.** 여기가 넓으면 화면이 없는 데이터를 기대하고, 좁으면 볼 수 있는 것을 감춘다.

### 남은 것

**청소 세션 읽기 권한 결정이 미결이다.** 현장 직원이 과거 날짜에서 "누가 했는지"를 보려면 RLS 를
조직 구성원 전체(`has_active_membership`)로 넓혀야 한다 — 읽기만이고 쓰기는 본인 것만 유지한다.
린넨·수리·분실물은 이미 그렇게 열려 있고 **청소만 예외적으로 좁다.**

같은 제약이 **오늘 화면에도 이미 영향을 준다**: 모바일이 "이미 처리된 객실"을 빼려고 조직 세션을
읽는데 RLS 가 남의 것을 걸러내므로, 남이 끝낸 방이 **"대기"로 보여 중복 청소가 날 수 있다.**

감수할 것: 직원끼리 서로 몇 건 했는지·얼마나 걸렸는지 보이게 된다.

## 화이트 리디자인 (2026-10-13)

시안 Clean-PC · CleanHist-PC · Clean-Phone · Clean-Fold · Clean-Tablet 그대로 입혔다. 규칙은 `docs/design/05-white-redesign.md`.

### 관리자 — 오늘 현황

- 맨 위 한 줄: 보기 탭(오늘 현황 | 기록) · 날짜 이동(공용 `AdminDatePicker`) · 「실시간 · 방금 갱신」 → 오른쪽에 **건물별 | 상태별** 글자 토글 ·
  **전체 건물 · 전체 담당자 · 전체 청소유형** 필터. 건물 · 담당자 필터는 상태로만 있고 오늘 현황에는 화면이 없었다 — 이제 보인다.
  **청소유형 필터는 새로**(체크아웃 · 간단 · 장기 투숙).
- 숫자 줄(청소 대상 · 미시작 · 진행 중 · 완료 · 완료율 · 셋팅 대상)은 **오늘 현황에만** 둔다. 예전에는 기록 탭에서도 오늘 숫자가 떠 헷갈렸다.
- 객실 칸: 옅은 면, 테두리 · 왼쪽 상태 막대 없음. 객실 · 상태 글자 배지(대기 · 진행 중 · 완료 · 취소) · 청소유형 · 담당 이니셜 · 이름(없으면 미배정) ·
  진행 중이면 경과, 완료면 소요(「46분」 · 「1시간 22분」). 선택 = 보라 테두리 + 옅은 보라 면.
- 아래: **셋팅 대상 목록 | 직원별 오늘 요약** 두 칸. 직원별 요약은 완료한 사람만 보이던 것을 **진행 중인 사람도**(「완료 1 · 진행 1」, 평균 소요).

### 관리자 — 기록

- 숫자 줄(걸러진 줄 기준): **기록 N건(기간) · 총 소요(직원 N명) · 평균 소요(완료 N건 기준) · 오래 걸림 N건(70분 넘김, 빨강) · 관리자 완료 N건**.
  「오래 걸림」 기준 70분은 `LONG_CLEANING_MIN`(`cleaning-history-board.tsx`).
- 표 열: 날짜 · 객실(+ 청소유형) · 건물 · 담당 · 시작 → 완료 · 소요 · 메모 · 연결. 최근 날짜가 위(내보내기는 날짜 오름차순 그대로).
  진행 중은 「→ 진행 중」, 취소는 완료 시각 · 소요를 비운다. 메모 · 연결 칸 = 취소 · 대리 완료 · **수리 신고 N · 분실물 N** · 오래 걸림 · 메모.
- **기록 줄에도 연결된 분실물 · 수리 신고**를 붙인다(`getAdminCleaningHistory` → `reports`, 세션 id 150개씩 나눠 조회). 상세 패널의
  「연동 리포트」가 기록에서도 열리고 누르면 그 기록으로 간다.
- 시안의 「사진」과 「완료 취소」는 **넣지 않았다** — 청소 세션에 사진 기능이 없고 완료 취소 기능도 없다(새 기능은 따로 결정).

### 모바일 — 청소 (폰 · 폴드 · 태블릿)

- 상자 없는 한 장: 제목 「청소」 + 「10월 13일 화요일 · 도쿄 기준 운영일」, 숫자 3개(청소 대상 · 셋팅 대상 — 누르면 셋팅 시트 · 진행 중).
  날짜 이동 줄 오른쪽에 **「내 청소 기록 ›」**(예전 카드 → 글자 링크).
- **진행 중인 청소**: 한 시간에 한 바퀴 도는 링 타이머 · 「청소 중」 · 객실 · 「청소유형 · 10:20 시작」 · 꽉 찬 **「청소 완료」** ·
  분실물 · 문제 신고 · 청소 취소 세 버튼(완료 · 취소는 기존 하단 시트 확인 그대로). 태블릿은 링 왼쪽 · 버튼 오른쪽.
- **바뀐 동작:** 청소 중에도 **목록을 보여 준다**(예전엔 감췄다) — 대신 **시작 버튼은 감춘다**(한 사람에 진행 세션 하나 — 유니크 인덱스). 기타 청소 폼도 청소 중엔 감춘다.
- 목록 줄: 객실(짧게 「402」) · 「체크아웃 청소」 · 보조 줄(턴오버 · 게스트 · 인원 / 다음 체크인 날짜 · 게스트 · 인원 / 당일 체크인 없음) · 「시작」.
  셋팅 줄은 게스트 · 인원 · 「셋팅 시작」. 지난 날짜는 오른쪽에 결과(완료 · 담당 · 시각 / 기록 없음) — 규칙은 위 「모바일 (2026-08-04)」 그대로.
- 오늘 기록: 객실 · 「체크아웃 청소 완료」 · 「41분 소요」 · 완료 시각.
- 넓은 화면: 폴드 = 청소 목록 | 셋팅 목록 + 오늘 기록 2열, 태블릿 가로 = 3열. 스타일 `src/components/mobile/cleaning-screen.css`.
