# Linen Defect Workflow

Status: Mobile first slice implemented (2026-06-10). The dashboard record-management console is
**implemented (2026-07-30)** at `/admin/linen-return`. Mobile linen return ledger is live under
`/mobile/linen-return/*` (side-menu entry `linen-return`). See
`docs/engineering/08-linen-defect-technical-design.md` → "As-Built" for the implemented schema,
routes, and permissions. All five screens below are implemented: building picker, building list,
create, detail (with permission-gated edit/delete), and ledger (record + item-summary views with
registrant/item filters and month navigation). The building-specific item master remains deferred.
The dashboard record-management console is described below.

## Purpose

This module is not just a generic defect log.

Its first operational purpose is to leave a clear internal record that:

- a staff member handed defective linen back to the vendor
- it happened on a specific date
- it belonged to a specific building
- the returned items and quantities were recorded

The most important evidence point is:

```txt
Who registered the return, and when?
```

This is needed because:

- the linen vendor visits around four times per week
- defective items are sometimes mixed into incoming linen
- replacement may fail or be delayed on the vendor side
- the office later needs to compare Foldy records against delivery slips
- the team also wants to review monthly return volume by building and by item

## Working Definition

For the first mobile-first slice, treat this feature as a:

```txt
building-scoped linen return ledger
```

More specifically:

- the trigger is not simply "a defect exists"
- the trigger is "we registered this linen as returned / handed back"
- one saved record is one return event for one building

This keeps the product aligned to the real operations need:

- proof of return registration
- historical lookup
- date/building/person-based checking
- later comparison against vendor paperwork

## Scope Position

This module is related to linen defects, but the workflow is operationally closer to:

- a return record
- a site ledger
- a vendor comparison log

It is **not** the first slice of full inventory management.

## Relationship To Other Modules

### Property / Building Model

Each return record belongs to exactly one building.

Rules:

- a return record cannot mix multiple buildings
- the user must enter through a building-specific flow
- the building drives the linen item selection list

### Linen Item Master

Buildings may use different linen types.

Confirmed direction:

- the UI should be designed from the start as a building-specific item selector
- the real dropdown/item-master connection can be completed later during implementation
- do not design this as uncontrolled free-text item entry

### Inventory

This module should not:

- adjust stock automatically
- settle vendor claims
- calculate financial loss

Those are possible later extensions, not first-slice requirements.

### Notifications

No notification requirement in the first slice.

## Users

Primary users:

- Owner
- Office Admin
- CS Staff
- Field Manager
- Staff
- Part-time Staff

Rules:

- all active organization users can create and read linen return records
- all active organization users can view all buildings in their organization
- authors can edit/delete their own records
- admin-capable roles can edit/delete all records
- admin-capable roles manage the linen item master later

## Core Product Rules

### 1. One Return Record = One Building

One record can contain multiple linen items, but:

- it belongs to one building only
- items from different buildings cannot be mixed into one record

Reason:

- vendor paperwork checking is building-based

### 2. Same User / Same Building / Same Tokyo Day Auto-Merges

For the implemented mobile slice, repeated registrations by the same user for the same building on
the same Tokyo operating day do not create a second header row.

Instead, the system merges the new submission into that day's existing record:

- matching item lines have their quantity summed
- newly added item types are appended as new lines
- note and photos are appended to the same record

This keeps the building ledger compact during repetitive field work while preserving day-based
history.

The system must automatically store:

- registered date/time
- registered user

These should not be manual input fields.

### 3. Multiple Items Are Allowed In One Record

Field staff often need to register several returned items at once.

So one record should support:

- item line 1
- item line 2
- item line 3
- etc.

### 4. Duplicate Items In The Same Record Are Not Allowed

Inside one return record:

- the same item can appear only once
- quantity should be summed in that single line
- if the same item is submitted again later that day by the same user in the same building, the
  system adds that quantity into the existing line automatically

Example:

```txt
Allowed:
- Single duvet cover x3
- Pillow cover x2

Not allowed:
- Single duvet cover x1
- Single duvet cover x2
```

### 5. Quantity Is Integer Only

The first slice should use:

- integer quantity only

No decimal or half-unit input is needed.

### 6. No Status Workflow In MVP

This is a simple record workflow.

There is no first-slice status such as:

- registered
- reviewed
- confirmed

Once saved, the record exists as a ledger entry.

## Record Structure

### Record Header

One return record contains:

```txt
id
organization_id
building_id or canonical building key
registered_by_user_id
registered_at
note
image_urls
created_at
updated_at
```

### Record Line Items

Each return record also contains one or more line items:

```txt
id
return_record_id
linen_item_id
quantity
sort_order
created_at
```

Important:

- this is a header + line-item model
- not a flat one-row-per-item model

## Required Fields

### System-Auto Fields

Auto-filled by system:

- registered date/time
- registered user

### User Required Fields

Required:

- building
- at least one linen item line
- quantity for each line

### Optional Fields

Optional:

- note
- photos

## Note Field Policy

There is no separate structured "defect reason" field in the first slice.

Instead:

- reason and memo are merged into one free-text note field

Reason:

- field staff should not be forced through too many inputs
- the workflow should stay fast and lightweight

Examples:

```txt
오염 심함
찢어짐 있음
세트가 안 맞음
업체에 바로 전달함
```

## Photo Policy

Photos are optional.

They may be used for:

- evidence
- showing the problem clearly
- preserving unusual details

Rules:

- some users may attach photos often
- some may save without photos
- the UI should support photos, but should not force them

## Mobile Information Architecture

This feature is mobile-first.

### Entry Placement

- dedicated side-menu entry
- not a default bottom-tab item
- can later be offered inside the user-customizable bottom-bar editor pool

### Mobile Flow

```txt
Open Linen Return
-> building picker
-> building-specific return list
-> create return record / open detail / open ledger
```

### Building Picker

Required direction:

- first entry screen should be a building card grid
- search should be available
- after entering a building, the screen should still offer a "change building" action

## Admin Dashboard — Linen Return Record Management (Implemented 2026-07-30)

### Purpose and Surface

The dashboard surface is an office-side **record-management console**, not a second registration
workflow. Field staff continue to register returns on mobile; office users use the dashboard to
verify and correct the records that were registered in the field.

Route and navigation placement:

```txt
/admin/linen-return
Operations group → Linen Return
```

The visual design was confirmed on 2026-07-30 from the Claude Design handoff
(`린넨 반품 콘솔 (admin).html`) and implemented the same day. Two deliberate deviations from the
handoff are recorded in `docs/planning/01-decision-log.md`: the page-wide typography scale-up block
(it would have resized shared shell chrome on this page only) and the "검토용 관리자 / 열람 전용"
switcher (a prototype-only device — real permissions come from the session role).

### Required Information

For each registered return event, the dashboard must make it possible to verify:

- **when**: registered date/time, displayed in Tokyo time
- **where**: building
- **what**: every linen item in the record
- **how many**: quantity per item and the record's total quantity
- **who**: the staff member who registered it

Because one record can contain multiple item lines, the list must never truncate the record into
an ambiguous single item. It may use a compact item summary in the row, but opening/expanding the
row must reveal every item and quantity.

### Views

The console has exactly two views, switched with the shared `.cviewbar` / `.lviews` tabs.

**1. 기록 (Records)** — one row per registered return event.

| Column | Content |
| --- | --- |
| 등록 일시 | Tokyo `YYYY.MM.DD HH:MM` + weekday sub-line |
| 건물 | building name |
| 반품 품목 | summary title ("싱글 이불 커버 외 2종") + **every** item and quantity below it |
| \[품목 열\] | only when an item filter is active — that item's quantity, highlighted |
| 총 수량 | the record's total |
| 등록자 | avatar + name + building |

**2. 품목별 수량 (Quantity by item)** — a per-item reconciliation table for the same period /
building / registrant conditions. The item filter is deliberately ignored here so the table is
always a full-catalog comparison.

| Column | Content |
| --- | --- |
| 반품 품목 | item name |
| 수량 | quantity in the current scope + a proportional bar |
| \[전체 건물\] | only when a building is selected — the same period's all-building quantity |
| 기록 수 | how many records contained the item |
| 최종 반품 | last registration timestamp for the item |

Items with zero returns in the period stay in the table (rendered dimmed and non-clickable) so
"nothing was returned" is distinguishable from "the item is missing". Clicking a non-zero row
narrows the 기록 view to that item.

### List and Filtering Contract

- Default period: current Tokyo calendar month.
- Default sort: 기록 = most recently registered first; 품목별 수량 = highest quantity first.
- Filters: date range, building, item, and registrant. The registrant dropdown searches by name
  inside its menu (shared `AdmDropdown searchable` mode).
- The initial view includes all buildings; choosing a building narrows the records to that building.
- Empty and error states use the dashboard's shared `.state` patterns. There is no separate loading
  state — the list is server-rendered.
- The **date range is a server-side organization-scoped query** driven by `?from=&to=` on the URL.
  Building / item / registrant then narrow the already-scoped rows in the browser. Another
  organization's records are never loaded.

### Record Management Contract

Opening a record must show its full item lines, quantities, note, photos (when present), registration
time, and registrant. The office can manage a mobile-created record from this detail surface.

- **Edit:** building, item lines/quantities, note, and photo set may be corrected. The existing
  one-building-per-record, no-duplicate-item, and positive-integer quantity rules remain in force.
- **Evidence fields are immutable:** `registered_at` and `registered_by_user_id` remain the original
  field-registration evidence and cannot be edited from the dashboard.
- **Delete:** deletion is hard delete under the MVP deletion policy. It requires an explicit
  destructive-action confirmation and removes the return record and its line items according to the
  existing data model.
- **Authorization:** the dashboard reuses the existing author/admin edit-delete rules and enforces
  them again in server actions and organization-scoped queries; showing an action in the UI is never
  sufficient authorization.
- **Traceability:** dashboard edits and deletes write to the existing `audit_logs` table —
  `action` = `linen_return_console_update` / `linen_return_console_delete`,
  `target_type` = `linen_return_record`, `target_id` = the record id, plus actor and timestamp.
  `metadata` carries the before/after snapshot (building, item lines + quantities, note, photo count)
  and the original registration evidence. **There is no free-text reason field** — the confirmed
  delete design has no reason input, so the automatic change snapshot replaces it (decision log,
  2026-07-30). Audit failure never rolls back an already-applied change; it is logged server-side.

### Explicitly Out of Scope

The dashboard v1 does not provide:

- registration or mobile-flow replacement
- item-master management
- monthly aggregate dashboards (the in-period per-item reconciliation table IS in scope — see "Views")
- vendor settlement, inventory adjustment, or claim handling

### Export (Implemented 2026-07-30)

Excel and PDF export ship through the console's shared export contract — the `<AdminExportButtons>`
pair at the right end of the filter bar. Both formats are always offered together; CSV does not
exist in this console.

- One file carries **two sheets**, matching the two views: 「린넨 반품 기록」 and 「품목별 수량」.
- 기록 sheet columns: 등록 일시 · 건물 · 반품 품목(전체 나열) · 품목 수 · 총 수량 · 등록자 · 메모,
  with a 총 수량 total row.
- 품목별 sheet columns: 반품 품목 · 수량 · \[건물을 좁혔을 때 전체 건물\] · 기록 수 · 최종 반품,
  with a 수량 total row.
- The title bar carries the period **and** the applied filters (건물 · 품목 · 등록자) so the file is
  self-describing.
- The export always mirrors what is on screen. The item filter is only applied when it is actually
  visible (기록 view) — exporting from the 품목별 수량 view never silently narrows the 기록 sheet.
- Export locale is resolved server-side from the actor's `preferredLanguage`; the client never sends
  a locale.

The existing mobile author/admin edit-delete permissions and the current record data model remain
unchanged. Dashboard access continues to follow the existing dashboard/session permission model;
this plan does not create or alter a role, team, or per-user permission rule.

## Mobile Screens

### 1. Building Picker

Purpose:

- choose the building first

UI direction:

- card grid
- search
- fast building switching

### 2. Building Return List

Purpose:

- show return history only for the selected building

Rules:

- do not show an all-buildings mixed feed here
- sort by latest registered first
- keep the screen operationally simple
- search/filter is not the main responsibility of this screen

Recommended card content:

- registered date/time
- registered user
- item summary
- total quantity
- photo attachment indicator when applicable

Not needed on the card:

- building name
- status badge
- note preview

Primary CTA:

- fixed bottom FAB for new return registration

### 3. Return Create Screen

Purpose:

- register one building-scoped return event quickly

Form direction:

- building already fixed by previous screen
- item line 1 starts visible
- user can add more lines with `+ add item`
- each line = item selector + integer quantity
- each line can be deleted directly
- duplicate items inside the same record are not allowed
- note is one optional free-text field
- photos are optional

### 4. Return Detail Screen

Purpose:

- show the exact saved record

Recommended content:

- registered date/time
- registered user
- building
- all item lines with quantities
- total quantity
- full photo set when attached
- edit button
- delete button

Not required:

- note full text as a mandatory detail block in the first design

Permission display rule:

- show edit/delete only when the current user is allowed to use them

### 5. Ledger / Statistics Screen

Purpose:

- let staff and office users inspect records like a ledger

Why this is separate:

- the normal building list should stay simple
- heavier checking/search belongs in a dedicated ledger view

Required behavior:

- building-scoped
- default period = current month
- also support custom date range
- support searching/filtering by:
  - registered user
  - linen item
  - date / date range

This screen should support two modes:

#### Record View

Recommended row content:

- registered date/time
- registered user
- item summary
- total quantity
- detail entry
- optional photo indicator

#### Item Summary View

Recommended aggregated values:

- item name
- total returned quantity
- total return record count

Example:

```txt
Single duvet cover 12 units / 5 records
Pillow cover 8 units / 3 records
```

## Current Default Item List (2026-06-15)

The current global default linen-return catalog is:

- Single duvet cover
- Double duvet cover
- Single mattress cover
- Double mattress cover
- Pillow cover
- Towel
- Bath mat

Implementation note:

- Older seeded generic items (`bath`, `hand`, `sheet`, `duvet`, `robe`) are retired from the active picker.
- They may still appear in historical records; new registrations should use the 7-item list above.

## Save And Completion UX

After a successful save:

- show a completion-focused success moment
- a richer 3D completion motion is explicitly acceptable in this workflow
- after the motion, return the user to the selected building's return list

Reason:

- the feature is repetitive field work
- after saving, users usually need to continue working in the same building context

Recommended post-save behavior:

- return to the building list
- highlight the affected row briefly
- if it was the first save for that user/building/day, that row is newly created
- if a same-day same-user same-building record already existed, the save should reopen that existing
  row with merged quantities

## Search / Filter Policy

### Building Return List

Keep this screen simple.

Baseline direction:

- latest-first list
- no heavy search/filter responsibility

### Ledger / Statistics Screen

This is the main search surface.

Required searchable/filterable dimensions:

- registered user
- linen item
- date / date range

Not required in first slice:

- free-text note search

## Edit / Delete Policy

### Edit

- authors can edit their own records
- non-authors cannot edit other users' records
- admin-capable roles can edit all records
- saving an edit never leaves a record without its items: lines are added and changed first and removed
  last, and a failed save keeps the previous items (2026-10-19 — before that, an admin editing another
  user's record could wipe all of its items)

### Delete

- authors can delete their own records
- non-authors cannot delete other users' records
- admin-capable roles can delete all records
- deletion is hard delete in MVP

## Out Of Scope

Deferred:

- dashboard management beyond existing-record edit/delete (new registration, item master, monthly
  aggregate dashboards, Excel/PDF export) — the in-period per-item reconciliation table shipped
  2026-07-30 and is no longer deferred
- vendor settlement / reimbursement workflow
- replacement tracking
- stock deduction
- approval/status workflow
- per-item structured reason enums
- all-buildings mixed operational feed on the mobile building list
- free-text item entry as the primary design pattern

## Open Implementation Notes

These are intentionally acknowledged now, but do not block the product/design phase:

- the building-specific linen item dropdown/master will be implemented later
- final table names and exact schema can be confirmed in technical design
- the customizable bottom-tab pool update should happen when navigation implementation begins

## Suggested Design-First Slice

Design in this order:

1. building picker
2. building return list
3. return create form
4. return detail
5. ledger / statistics (record view + item summary view)

## Verification Focus For Future Implementation

- building-first entry flow is preserved
- one record cannot mix buildings
- one record can include multiple item lines
- duplicate item lines are blocked
- quantity is integer-only
- author/admin edit-delete rules hold
- latest-first building list is correct
- ledger filters work by user / item / date
- ko/ja/en strings exist

## 2026-08-03 어드민·모바일 정합 정리

### 건물 표기 — 청소 콘솔과 같은 현지화 규칙

린넨 어드민만 DB 원문 한국어를 그대로 출력하고 있었다(청소·분실물·수리·예약 콘솔은 전부
`localizePropertyName(name, dictionary.cleaning.buildingLabels)` 사용). **정규명과 표시 라벨을
분리**해 맞췄다 — `AdminLinenRecordVM.buildingLabel` 을 추가하고 표(건물 열·등록자 보조줄), 상세
패널(읽기/수정·건물 `<option>`), 삭제 모달, 품목별 수량 뷰, Excel/PDF 내보내기까지 전부 라벨을
쓴다. **필터 값 · 저장 payload · `isKnownBuilding` 검증은 계속 정규명**이라 ja/en 세션에서도 저장이
깨지지 않는다. 모바일 건물 목록·피커 정렬도 표시 라벨 기준으로 통일했다.

### 목록 화면 헤더 — "이번 달" → 총계

`getLinenReturnsByBuilding` 에는 기간·limit 이 없는데 헤더는 "이번 달" 이었다. **쿼리가 아니라
라벨을 고쳤다** — 문서상 "2. Building Return List" 는 기간 개념이 없고 기간 조회는
"5. Ledger / Statistics Screen" 의 책임이기 때문이다. 목록을 이번 달로 좁히면 기본 화면에서 과거
이력 접근이 사라진다.

- **미완**: 이 목록 쿼리는 여전히 무제한이다. 건물당 기록이 누적되면 limit/페이지네이션이 필요하다.

### 모바일 수정 폼에 사진 편집 추가

문서 어디에도 "모바일 사진 수정 불가" 가 없었고(Deferred 목록에도 없음) 어드민은 "photo set may be
corrected" 로 명시돼 있었다. 코드 주석의 "photo editing is deferred" 만 있던 **미문서화 결정**이라
불일치로 판단해 열었다. 기존 사진 썸네일 + 삭제, 업로더 상한은 `5 - 남긴 장수`, 저장 시 "남긴 URL +
신규 URL" 로 **통째 교체**(어드민 `updateAdminLinenRecord` 와 동일). 5장 상한·압축·스토리지 경로
규칙(CLAUDE.md §8)은 그대로다. **건물은 모바일에서 못 바꾸는 게 문서와 일치**하므로 유지했다.

### 어드민 서버 가드 통일

`src/app/admin/linen-return/actions.ts` 의 `guard()` 가 `getCurrentAppSession()` 만 확인해서,
`canAccessAdminWeb` 가 막는 역할(예: 파트타임)도 서버 액션을 직접 호출하면 자기 기록을 수정·삭제할
수 있었다. 같은 파일의 export 들이 쓰던 `requireAdminSession()` 으로 통일했다.

### revalidate 경로 통일

모바일 등록/합산/수정/삭제 4개 경로에 `revalidatePath` 가 아예 없었고, 어드민은
`/mobile/linen-return/list` · `/ledger` 를 빠뜨리고 있었다. `revalidateLinenReturnPaths()` 하나로
모아 양쪽이 같은 경로 집합을 무효화한다.

---

## 미해결 — 자동 합산 모델의 운영 리스크 (결정 필요)

§2 "Same User / Same Building / Same Tokyo Day Auto-Merges" 는 **문서상 확정 모델**이고 어드민의
"1행 = 1기록" 도 이 헤더 단위와 일치한다. 즉 아래 두 가지는 버그가 아니라 **이 데이터 모델의 논리적
귀결**이다. 다만 실제 운영에서는 문제가 될 수 있어 별도 결정이 필요하다.

1. **사무실 정정 위에 현장이 덧셈한다.** 합산은 `registered_at` 이 그날 안이기만 하면 무조건
   `existing.quantity + line.quantity` 다. 어드민이 5 → 3 으로 고친 뒤 현장이 2 를 더 올리면 5 로
   돌아간다. `audit_logs` 에는 정정 기록이 남지만 최종값은 되돌아간다.
2. **어드민에서 한 행을 삭제하면 그날 제출 전체가 지워진다.** 문서상 hard delete 대상이 "record"
   이므로 계약대로지만, 삭제 모달이 "그날 합산 전체" 임을 알려주지 않는다.

코드로 바꾸려면 §2 / §4 개정이 선행되어야 한다.

**판정(2026-08-03).**

- **1번은 버그로 보지 않는다.** 사무실이 5 → 3 으로 고친 뒤 현장이 2 를 더 올려 5 가 되는 것은
  "그날 실제로 5장을 반품했다"는 뜻이므로 §2 의 합산 모델대로다. 정정을 최종값으로 고정하려면
  "정정 이후 제출은 합산하지 않는다" 는 새 규칙이 필요하고, 그건 문서 개정 사항이다. 현행 유지.
- **2번은 UX 결함으로 보고 고쳤다.** 모델(1행 = 그날 헤더)은 그대로 두되, 삭제 모달이 **무엇이
  지워지는지 알리지 않던 것**이 문제였다. "이 기록은 같은 날·같은 건물에서 같은 사람이 올린 제출이
  모두 합쳐진 건입니다" 안내(`dScopeNote`, ko/ja/en)를 확인 모달에 추가했다.

---

## 화이트 리디자인 (2026-10-14)

시안: 캔버스 Linen-Phone · LinenBld · LinenNew · LinenDone · LinenDetail · LinenLedger(Items) · Linen-PC · LinenItems-PC · LinenEdit-PC.
흰 바탕 · 상자 없는 줄 · 이름표 칸 · 보라 `#7A52E6`. 데이터 모델(§2 자동 합산 · 1행 = 그날 헤더)과 권한은 바뀌지 않았다.

### 모바일

- **진입 = 마지막 건물로 바로 연다**(사용자 승인). 마지막으로 연 건물은 쿠키 `foldy_linen_building` 에 남고, 다음 진입 때
  건물 고르기 단계를 건너뛴다. `?pick=1` 이면 예전처럼 건물 목록. 머리의 건물 이름을 누르면 **건물 바꾸기 시트**
  (`linen-building-switch.tsx`, 표준 `BottomSheet`).
- 목록은 한 줄 기록(시각 · 품목 요약 · 총 수량 · 등록자). 줄은 차례로 등장하고, 방금 저장한 줄은 잠깐 강조된다.
- **등록 폼 = 7개 품목 ± 목록**(사용자 승인) — 품목을 고르는 단계 없이 수량만 올린다. 0 이면 − 가 숨는다. 합계 · 메모(선택) · 사진(최대 5).
- **저장 완료 순간**(`linen-return-success.tsx`): 체크를 그리고 총 수량 막대가 채워진다. 같은 날 · 같은 건물 · 같은 사람 제출과
  합쳐졌으면 서버 액션이 `&merged=1` 을 붙이고 「오늘 등록한 기록에 합쳐졌어요」로 알린다. 한 번만 보이게 `sessionStorage`
  `foldy-linen-just-saved` 로 표시.
- 기록 상세 · 휴지통은 시트, 장부(기록 / 품목별 수량)는 같은 표 언어로 다시 그렸다. 한국어 수량 단위는 「장」.

### PC 콘솔 (`/admin/linen-return`)

- **보기바 한 줄**: 기록 / 품목별 수량 탭 · 기간 · 건물 · 품목 · 등록자 · Excel · PDF. 설명 문단 · 숫자 배지는 뺐다.
- **기록 표**: 등록 일시(요일 아래) · 건물 · 반품 품목(요약 + 아래에 전체 품목 · 수량) · (품목 필터 시 그 품목 수량 열) · 총 수량 · 등록자.
  위에 「기록 N건」 굵게 + 「총 N장 · 최근 등록 순」. 등록자 색 동그라미는 뺐다(hallmark 점검).
- **품목별 수량 표**: 품목 · 수량 막대(채워지며 등장) · 수량 · (건물을 좁혔으면 전체 건물 대조 열) · 기록 수 · 최종 반품.
  반품이 없던 품목도 0 으로 흐리게 남긴다. 줄을 누르면 그 품목으로 기록 보기를 좁힌다.
- **상세 패널**: 건물 · 「요약 · 총 수량」 제목 · 일시 · 등록자 · 품목별 수량 줄 · 합계 · 사진 · 메모 · 「등록 일시 · 등록자는 바꿀 수 없어요」.
  아래 「기록 수정」, 위 휴지통. 패널은 콘솔 공통대로 목록 위에 겹쳐 열린다(시안은 나란히 그렸음).
- **수정 창**: 건물 · 7개 품목 ± 스테퍼(숫자가 굴러 바뀜) · 합계 · 메모(선택) · 사진 → [취소][저장]. 품목이 하나도 없으면 저장 막음.
- **삭제 창**(`.lfm`): 요약 · 건물 · 시각 · 등록자 → 범위 안내(`dScopeNote`, 그날 제출 전체) · 되돌릴 수 없음 → [그대로 두기][삭제]. × 없음.

