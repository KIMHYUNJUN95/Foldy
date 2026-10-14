# Reservation Calendar

## 화이트 리디자인 — PC (2026-10-14, 시안 Cal-PC · CalDetail-PC · CalOps-PC · CalRooms-PC · CalInfo-PC)

`/admin/calendar` 의 네 보기와 예약 상세 패널을 흰 바탕으로 바꿨다. 데이터 · 서버 액션 · 가져오는 범위는 그대로다.

- **위 숫자 카드 다섯 제거** → 「오늘 운영」 보기 맨 위 숫자 줄로 옮김(체크인 · 체크아웃 · 셋팅 대상 · 투숙 중 · 빈 방, 빈 방 아래 가동률).
- **한 줄 보기 바**: 보기 탭(공용 `.lviews`) · (월간) 달 이동 + 「이번 달」 · (그 밖) 「M월 D일 (요일) · 도쿄 기준」 · 오른쪽 건물 고르기(공용
  `AdmDropdown`, 예전 건물 칩 줄 대신) · (월간) 채널 고르기 · 인쇄 · 「방금 갱신 ↻」(누르면 `router.refresh()`, 아이콘이 돈다 — 예전과 같은 수동 새로고침).
- **월간 보드**: 날짜 세로선 없음 — 주말 열은 옅은 회색, 오늘 열은 옅은 보라. 건물마다 머리줄 「이름 · N실 · 이번 달 X%」(이번 달 가동률 = 판 밤 ÷
  객실 × 날짜)와 **빈 방 줄**(그날 밤 예약도 차단도 없는 방 수, 채널 고르기와 무관). 막대는 회색 바탕 + 채널 색 점, 넓으면 「이름 · 성인 N」,
  내부 메모가 있으면 연필 표시. 위 설명 줄 오른쪽에 채널 범례 + 「막아 둔 기간」. 아래 상태 범례는 뺐다.
- **오늘 운영**: 네 목록(체크인 · 체크아웃 · 셋팅 대상 · 투숙 중)을 상자 없이. 줄 = 객실 · 이름 · 「(건물) · 인원 · 박수 · 채널」 / 「인원 · 기간」 /
  「오늘 체크인 · 같은 날 체크아웃 없음」 / 「~ 체크아웃일」. 손님별 도착 시각은 데이터가 없어 보이지 않는다.
- **객실 상태**: 건물 머리줄에 「객실 N · 빈 방 · 체크인 · 체크아웃」 수. 상태는 배지 대신 글자(빈 객실 보라 · 오늘 체크인 초록). 체크아웃하는 방은
  「○○ · 오늘 나감」.
- **건물 정보**: 건물마다 한 줄 3칸(이름 · 주소 · 「지도 열기 ↗ · 수정」 / 공용 출입 코드 · 운영 메모 / 객실 출입 코드 — 넓은 화면에서 여러 열로 흐른다). 편집은 그 건물의 「수정」
  → 칸이 입력칸으로 바뀌고 「취소 · 저장」(서버 액션 그대로).
- **예약 상세 패널**: 채널 · 예약번호(복사) → 이름 → 「건물 · 객실 · 인원」 → 체크인 · 체크아웃(「16:00부터 · 10:00까지 · N박」 = 운영 기본 시각)
  → 전화번호(복사 · 걸기) → 내부 메모(칸을 떠나면 저장) → 「이 예약으로 등록: 수리/점검 · 컴플레인 · 분실물」. 읽기 전용 안내 · 활동 기록 · 아래
  버튼 줄은 뺐다.
- **전화번호는 하이픈으로 끊어 보인다**(2026-10-14 사용자 요청): `formatPhoneDisplay()` (`src/lib/phone-format.ts`, libphonenumber 메타데이터) —
  `+33-6-12-34-56-78` · `+81-90-5816-1006` · 국내 `090-1234-5678`. 끊을 수 없으면 받은 그대로. 걸기 · 복사에는 원래 값. 회귀 테스트:
  `src/lib/__tests__/phone-format.test.ts`.
- 움직임: 막대 차례 펼침 · 막대 누름 반응 · 패널 들어옴 · 새로고침 아이콘 회전 · 목록 줄 등장. 움직임 줄이기 설정에서는 끈다.
- 모바일(폰 · 폴드 · 태블릿)은 다음 단계에서 같은 시안으로 바꾼다.

## 인원 표기 — 성인 · 어린이 (2026-10-05)

현장용 예약 캘린더(`/mobile/calendar` 예약 상세)와 관리자 예약 캘린더(`/admin/calendar` 예약 패널)는 인원을 **「성인 N · 어린이 N」**
으로 보인다 — 판매 캘린더 예약 패널(`rpGuestsValue`)과 같은 표기(사용자 지시).

- 값: Beds24 원본 `numAdult` · `numChild`(유아 키가 있으면 어린이에 합침). 공용 헬퍼 `getReservationGuests`
  (`src/lib/reservation-guests.ts`, 테스트 `reservation-guests.test.ts`). 어린이가 없으면 「어린이 0」.
- 성인 수가 없는 예약(다른 채널 · 옛 데이터)만 예전처럼 합계(`N명`), 그것도 없으면 「미확인」.
- **고친 것**: 전에는 두 화면이 각자 합계를 구했는데 합계 키 목록 맨 앞이 `numAdult` 라 **어린이가 빠진 성인 수**가 「인원」으로
  나왔다. 합계는 이제 성인 + 어린이.
- 문구: `admin.calendar.guestBreakdown` · `mobile.calendarGuestBreakdown`(ko/ja/en, `{adults}` · `{children}` 자리표시 문자열).

## 2026-08-06 multilingual surface contract

The mobile Tokyo-now badge, map building count, and admin print heading are localized through the shared `ko`/`ja`/`en` calendar copy. Calendar navigation accessibility labels also follow the viewer locale.

## Overview grid — scroll model: page-vertical / grid-horizontal (2026-07-22)

Two related mobile fixes to `mobile-calendar-view.tsx`, in order:

**(a) room-label / bottom-bar overlap.** On iPhone the sticky left **room-number column overlapped
the shell's bottom tab bar** while scrolling. The sticky room-label column is `z-40` (day header
`z-20`) and the shell tab bar is `z-20` in the **same stacking context**, so the labels painted over
the bar. Fixed by adding **`isolate`** to the grid scroll container so it becomes its own stacking
context that always sits below the tab bar.

**(b) nested-vertical-scroll trap → decoupled axes.** The grid used to be a **fixed-height 2-axis
scroll pane** (`height: calc(100dvh - …)`, `overflow: auto`). A vertical swipe scrolled the *room
list inside the grid* instead of the page, so to scroll the screen you had to touch empty space. Now
the grid scrolls **horizontally only** (`overflow-x-auto`, no fixed height): its height fits all
rows, so it has no vertical overflow and the browser hands vertical scrolling to the **page** (the
shell content container). Result: a vertical swipe anywhere scrolls the whole calendar — rooms
included — as one natural page scroll; horizontal swipe still pans the date axis. The sticky
room-label column (left) is unchanged and still pins on horizontal scroll.

- The top-chrome hide is now driven natively by the shell content container's own scroll
  (`handleContentScroll`), so the grid no longer dispatches the synthetic `mobile-shell-scroll`
  event (that existed only because the grid used to own the vertical scroll).

**(c) frozen date header (2026-07-22).** Requirement: with many rooms the date row must stay visible
while scrolling down. Because a horizontally-scrolling container is itself a `position: sticky`
boundary, the date header can't be pinned from *inside* the grid — so it now lives **outside** the
grid scroller as a page-`sticky` (`top-0`) element, and its horizontal position is kept in sync with
the grid via `translateX` on an inner strip (set in `handleGridScroll` from the grid's `scrollLeft`).
A left spacer equal to the room-label column width keeps the date columns aligned with the body. The
old in-grid header row and the room-label column's header spacer were removed. For this sticky to
resolve against the shell scroll container, the overview `Card` dropped `overflow-hidden` (rounded
corners are now per-child: month-nav top, grid bottom) — no overflow!=visible ancestor may sit
between the header and the shell content scroller.

**Jitter fix (2026-07-22).** The first cut synced the header from React's `onScroll`, which also
`setState`d the visible-date-range label **every scroll frame** → the whole calendar re-rendered per
frame, starving the main thread so the JS-driven header fell behind the compositor-driven grid and
visibly shook during momentum scroll. Fixed two ways: (1) the label only `setState`s when its text
actually changes (a ref guards it), and (2) the header transform is now driven by a **native passive
`scroll` listener** using `translate3d(...)` (GPU), not React's synthetic onScroll.

**Superseded — native 2-axis scroll (2026-07-22, "B안").** Even the rAF/translate3d sync left a
residual ~1-frame lag on fast momentum scroll, because the header moved on the **main thread** while
the grid scrolled on the **compositor** — an inherent limit of any JS-synced frozen header. The
definitive fix (owner-approved) makes the grid ITSELF the native 2-axis scroll surface, so the header
and columns scroll in the **same compositor scroll** (zero lag/jitter):
- The overview `Card` is `flex flex-col overflow-hidden` with `max-height: calc(100dvh - 15rem -
  env(safe-area-inset-bottom))`; the grid scroller is `flex-1 min-h-0 overflow-auto` — it fills the
  card and is the scroll surface. Month-nav + legend are `shrink-0` above it.
- Inside the grid: a **`sticky top-0`** header row (with a `sticky left-0` corner) + a body flex row
  = **`sticky left-0`** room-label column + the bar canvas. All native — the JS translate3d sync,
  `headerInnerRef`, and the external header are gone.
- The grid now owns the vertical scroll, so it re-dispatches the `mobile-shell-scroll` event
  (`{scrollTop}`) to keep the shell's top-chrome auto-hide working; `handleGridScroll` also updates
  the visible-date label (change-guarded).
- **Trade-off:** the page no longer scrolls as one — vertical scrolling happens **inside the grid**
  (month-nav/controls stay fixed above, always visible). This is the standard calendar-app model and
  is what makes the pinned header perfectly jitter-free. Grid height is `dvh`-based, so verify on
  device that it fills without overlapping the bottom tab bar or leaving dead space (tune the `15rem`
  reserve if needed).

## Overview grid UI (2026-06-10 readability redesign)

Visual/UX-only refinement of the mobile **overview (timeline) grid** in
`src/components/calendar/mobile-calendar-view.tsx`. Data, routing, lists/map modes, the
reservation detail sheet, and the common shell are unchanged. Ivory/navy app theme applies.

- **Date header** is two lines: localized weekday (Sat `text-blue-600`, Sun `text-rose-600`,
  weekday `text-slate-500`) over the day number (`text-[15px] font-extrabold`). Weekend columns
  get a faint tint; the today column keeps `bg-amber-100/60`, amber text, and a small "오늘"
  (`copy.today`) chip.
- **Reservation bars**: `rounded-[9px]`, 3px horizontal inset, soft shadow + `border-white/25`.
  A check-in dot shows when the stay starts within the visible month; stays continuing past the
  month edge flatten that corner (`rounded-l/r-[3px]`) and show a `›` overflow hint. Channel
  colors (Booking/Airbnb/other) and bar position math are unchanged.
- **Grid**: alternating room rows get a subtle stripe; vertical grid lines lightened; the today
  column has an amber vertical marker. Sticky room-label column unchanged.
- **Channel legend** above the grid: Airbnb / Booking / Direct (`copy.legendDirect`, new i18n key
  `mobile.calendarLegendDirect`, ko/ja/en) with channel-colored swatches.

## Purpose

The reservation calendar shows Beds24 reservation, occupancy, and availability information inside Foldy.

It is separate from the recurring work scheduler.

## Required Data

The calendar must show:

- Date
- Property/building
- Room/unit
- Guest name
- Check-in date
- Check-out date
- Number of guests
- Reservation source/channel
- Whether there is an empty room/property for the selected day

Price/revenue information should not be shown in Foldy MVP.

## Date Range

Foldy does not need to show all historical reservation data.

Required calendar range for MVP:

```txt
Current month + next month (2 months total)
```

Historical data from previous years is not needed in Foldy MVP.

### Operational Fetch Window (implemented 2026-05-26)

The reservation data fetch window is fixed relative to **today**, not the selected month in the UI:

```
operationalMonthStart = first day of today's month   (e.g., 2026-05-01)
operationalWindowEnd  = first day of the month after next (exclusive, e.g., 2026-07-01)

Query:
  check_in_date  < operationalWindowEnd     → includes May and June arrivals
  check_out_date >= operationalMonthStart   → includes currently-staying guests
```

Key behaviors:
- Guests currently staying (checked in before today) are always included.
- Next month's upcoming reservations are always included.
- The UI's selected month (prev/next navigation) controls which month the Overview grid renders — it does not change what data is fetched.
- The Lists mode (Check-in Today / Check-out Today / Staying Today) always shows today's operational snapshot, regardless of which month the user is browsing, as long as `selectedMonth` is within the operational window.
- **Out-of-Window Policy (Implemented 2026-05-26 - Option A)**: If the user navigates to a month beyond the operational window (e.g., July or later, or prior months), the server skips the reservations DB query entirely (no unnecessary read), passes `reservations = []`, and the client shows a clear, localized usability warning banner: *"Out of operational window" / "현재 운영 조회 범위 밖"* under both Overview and Lists mode. This avoids fragmented/misleading crossover bookings (e.g. end-of-June check-in persisting into July). Month navigation is kept operational so users can easily tap back. The `isOutOfWindow` boolean is computed server-side and passed as a prop — the client does not recompute it independently.

This is the authoritative implementation note. **Current confirmed policy: current month + next month (2 months total).** This is the MVP scope and is not aspirational.

### Future / Post-MVP: Extending the Window

Extending the fetch window beyond 2 months is a **separate backlog item** and is not planned for the current MVP. It requires:

1. An explicit product decision and documented requirement change.
2. UI changes to clarify the extended browsing scope to users.
3. Performance review of the larger query range.

Do not implement a wider window without fulfilling these prerequisites. The current 2-month policy is intentional and stable.

## Reservation Status Display

MVP calendar should display only confirmed/valid reservations.

Cancelled reservations:

- Should be removed from the visible calendar.
- May remain in internal sync logs if needed for debugging/history.
- Should not appear as active occupancy.

Reservation status labels must always be shown in the user's preferred language (ko/ja/en).

- Raw DB enum values (`confirmed`, `checked_in`, `checked_out`, `cancelled`, `no_show`) must never be shown directly as UI text.
- All reservation status labels are defined in `dictionary.admin.reservationStatusLabels` in `src/lib/i18n.ts`.
- Any new status values added to the DB enum must be added to all three locales before use in UI.

## Mobile Requirement

The mobile screen must show a one-month reservation calendar by property/building at a glance.

Design reference:

- TimeTree-like calendar feeling

Important mobile goal:

```txt
Staff can choose a property/building and quickly understand the whole month of reservations.
```

Current design priority:

- Mobile and admin web calendar requirements are both documented.
- Mobile focuses on a readable month / rooms / lists structure.
- Admin web focuses on a dense channel-manager-style room/date grid for office users.

## Mobile Views

Required mobile views:

### Monthly Property Calendar

Purpose:

- Show one month of reservations for a selected property/building.

Must show:

- Dates
- Reservation bars inside date cells
- Guest name and number of guests inside reservation bars
- Reservation source/channel color on reservation bars
- Occupied/empty state
- Room/unit if property has multiple rooms

Confirmed mobile layout:

- Use a date-based monthly calendar.
- Put real reservation bars inside each date cell, including multi-day bars that visually span from check-in date to check-out date.
- Tapping a reservation bar opens guest/reservation details.
- This should feel similar to TimeTree, but adapted for hotel/property reservations.
- The month grid should use vertical space efficiently and should not leave a large unused blank area above the bottom navigation.

Date number rule:

- The date number must always remain visible, even when a reservation exists on that date.
- Reservation bars must not cover or replace the date number.
- Date numbers should stay on a higher visual layer or fixed top-left area of the date cell.

Reservation bar source color rule:

- Booking.com / Booking channel: blue or blue-teal family.
- Airbnb channel: soft light pink family.
- Direct/other channels: neutral gray family.
- Color should support quick scanning while staying readable in light mode (the app is light-mode-only; dark mode deferred post-launch).

Reservation bar display priority:

```txt
Guest name + Number of guests
```

When the user taps a reservation bar, open a popup/detail panel with full guest and reservation information.

Reservation popup/detail should show:

- Property/building
- Room/unit
- Guest name
- Number of guests
- Phone number
- Reservation ID
- Check-in date
- Check-out date

Reservation detail shows a read-only, organization-shared internal note synced from the admin
reservation inspector (`reservation_internal_notes`) — see "2026-07-10 Admin Calendar Update" below.

Phone number actions:

- Copy phone number
- Call phone number

### Reservation Detail Modal Policy (updated 2026-06-02)

- Mobile reservation detail uses an information-first bottom sheet (slides up from the bottom edge) with selective Liquid Glass surface styling.
- The modal opens above a dimmed backdrop and stays visually detached from the underlying page scroll.
- Bottom actions `Message Guest` and `Manage Booking` are removed from the modal.
- The detail sheet keeps operational contact actions only:
  - Copy phone number
  - Call phone number (enabled only when a dialable number exists)
- Guest-count display is hidden when guest-count data is unavailable.
- Check-in/check-out time display uses operating defaults for this phase:
  - Check-in: `10:00`
  - Check-out: `16:00`
- **Dismissal (2026-06-15)**: the mobile reservation detail bottom sheet is dismissed by **dragging
  it down** (iOS-style — grab handle / header), tapping the scrim, or Esc; its top-right **X close
  button was removed** now that the slide replaces it. This uses the shared `useSheetDragDismiss`
  primitive — see Mobile Navigation doc → "2026-06-15 Bottom Sheets — iOS-style Drag-to-Dismiss".

### Current Row-Label Policy (updated 2026-06-02)

- The calendar uses separate concepts for:
  - internal room identity, used for authoritative room-master matching
  - display row label, used for the visible room row shown to staff
- This is especially important for Arakicho buildings where Beds24 can expose sub-unit labels such as `402_2` or `A301_2`.
- Current display policy:
  - `402` and `402_2` share one calendar row labeled `402`
  - `A301` and `A301_2` share one calendar row labeled `A301`
  - `A301` and `301` remain separate rows because they represent different real unit identities
- Goal:
  - prevent incorrect reservation merging across distinct units
  - prevent over-splitting the visible room axis into `_2`-style sub-rows

Future optional view:

- Room/unit timeline view is required as an alternate mobile view for large multi-room buildings.
- The company internal calendar reference uses a room-by-date grid with reservation bars spanning dates. This is a strong reference for large buildings where one property can have about 26 to 28 rooms.
- The monthly date-cell calendar should remain useful for small properties or selected room/unit views, but it should not try to show all reservations for a 28-room building inside one month grid.

### Mobile Large-Building Calendar Strategy

> **Superseded (2026-05-23)** — the "Month / Rooms / Lists" view switcher and the separate density-mode
> "Rooms view" described below were not built this way. The shipped mobile calendar tabs are
> `Calendar` (overview month timeline) / `Lists` / `Map`, with no standalone "Rooms" view — the Map tab
> replaced that role. See "2026-05-23 Mobile Calendar Policy Update" further below for the confirmed
> current behavior. The section below is kept as historical design context only.

Problem:

- A single building may have 26 to 28 rooms.
- Showing every room's reservations inside a normal monthly date-cell calendar will become unreadable on mobile.

Recommended mobile solution:

- Keep the month calendar as the default overview.
- Add a view switcher: Month / Rooms / Lists.
- In Month view, show a compact property-level overview and allow room filtering.
- In Rooms view, show a room-by-date horizontal timeline for the selected building.
- In Lists view, show Check-in Today, Check-out Today, Staying Today, Empty Today, and Earliest Empty.

Large-building rules:

- For buildings with many rooms, the user should select a building first, then view either all rooms in a room timeline or one selected room in the month calendar.
- The app should not force all 28 rooms into one normal mobile month grid.
- Empty-room discovery should rely on list/timeline views rather than trying to visually infer everything from a dense month grid.

Rooms view date density rule:

- The default Rooms view should show a useful 7-day range.
- On mobile, users should be able to visually understand the full selected range, not only 3 to 4 days.
- If 7 days cannot fit with readable text, use compact date columns, abbreviated labels, and horizontal scrolling with clear scroll affordance.
- Provide view density options: 7 days, 14 days, and compact mode.
- 14-day view may reduce reservation text to guest last name/short name plus guest count.
- The room column should remain sticky while date columns scroll horizontally.

Rooms view should support two different density modes:

1. Detail mode
   - Shows fewer days with readable reservation labels.
   - Good for checking guest names and tapping a reservation.

2. Overview mode
   - Shows more dates, such as 14 days or month-level occupancy.
   - Prioritizes room occupancy shape over full guest names.
   - Reservation bars can omit names or show very short labels.
   - Tapping a reservation opens the reservation detail bottom sheet.
   - Preferred visual direction: compact room rows on the left, date columns on top, and horizontal colored reservation bars without visible guest names.
   - This mode should feel like a mobile occupancy heat/timeline board for quick scanning.

For large buildings, a mobile overview cannot show 28 rooms, many dates, and full guest names all at once. Foldy should intentionally separate overview scanning from detail reading.

Implementation note (2026-05-22):

- Mobile calendar currently ships with two interaction modes in the same screen:
  - `Overview`: full selected-month room timeline (dates = every day in the selected month, per
    `daysInMonth` in `mobile-calendar-view.tsx`), horizontally scrollable, with reservation bars
  - `Lists`: Check-in Today / Check-out Today / Staying Today operational lists
- Tapping a reservation in either mode opens a bottom-sheet reservation detail modal.
- Overview header supports month navigation (prev/next). The selected month is represented by `month=YYYY-MM` in the route query.

### Today Check-In

Purpose:

- Show guests checking in today.

Must show:

- Property/building
- Room/unit
- Guest name
- Number of guests
- Phone number
- Check-in date/time

### Today Check-Out

Purpose:

- Show guests checking out today.

Must show:

- Property/building
- Room/unit
- Guest name
- Number of guests
- Phone number
- Check-out date/time
- Manual early check-out time if set

### Staying Today

Purpose:

- Show guests currently staying today.

Must show:

- Property/building
- Room/unit
- Guest name
- Number of guests
- Phone number
- Stay date range

### Empty Today

Purpose:

- Show empty rooms/properties for today.

Must show:

- Property/building
- Room/unit
- Empty status

Empty rule:

- A room/property is considered empty on a date if there is no reservation bar on that date.
- Cleaning status is not part of empty-room calculation in the MVP.

Beds24 room-source rule:

- For buildings where the company rotates between two Beds24 room ID groups, the calendar must use only the currently active room ID group.
- Active/inactive is determined by the company internal rule, not by Beds24 itself.
- If a Beds24 room/group has minimum stay `50 nights or more`, it is treated as inactive for that period and must be excluded from:
  - room master import
  - room axis display
  - `Empty today` calculation
  - occupancy/availability summaries
- Normal operational minimum stay values such as `1`, `2`, or `3` nights indicate the active room ID group for that period.

### Earliest Empty Availability

Purpose:

- Quickly show the earliest available empty room/property date from today onward.

Required behavior:

- User can view earliest empty availability for the currently selected property/building.
- User can also select all properties/buildings.
- The search starts from today, including today.
- For all properties/buildings, show the earliest empty availability per property/building.

Example:

```txt
Selected: All properties
Date basis: Today included

Arakicho A -> Empty today
Arakicho B -> Next empty: May 7
Kabukicho -> Next empty: May 9
Okubo A -> Empty today
```

This is separate from the visual empty state in the monthly calendar.

## Admin Web Views

Recommended admin web views:

- Month calendar
- Day check-in/check-out list
- Room/property timeline
- Occupancy and empty room filter

### Admin Channel-Manager Timeline

Purpose:

- Let office/admin users scan many rooms and many dates quickly.
- Support hotel-style buildings with about 26 to 28 rooms.
- Provide a dense operational view similar to a channel manager, but without price, revenue, rate, payment, or inventory data.

Design direction:

- Use a room-by-date grid as the primary admin calendar view.
- The left room column and top date header should feel sticky.
- Date columns should support horizontal scrolling when the selected range is wider than the viewport.
- Empty rooms must remain visible as blank reservation rows.
- Reservation bars must span check-in to check-out dates.
- Reservation bars display guest name and number of guests only.
- Tapping/selecting a reservation opens the mobile reservation detail bottom sheet.

Recommended dense row structure:

```txt
Room 201
  Status
  Min Stay
  Reservation
```

Notes:

- `Status` is operational status such as Empty, Occupied, Checkout, Cleaning, or Blocked.
- `Min Stay` may show a small value such as 1, 2, 3, or dash when useful.
- `Reservation` contains the multi-day reservation bars.
- These sub-rows are optional implementation details, but the admin calendar must preserve channel-manager-level density.
- Price/rate rows are not allowed in Foldy MVP.

Right-side reservation detail:

- A selected reservation inspector is useful for admin web.
- It should show property/building, room/unit, guest name, number of guests, phone number, check-in, check-out, channel, copy phone, and call actions.
- The inspector is secondary to the dense grid. If it reduces grid density too much, it can be collapsible.

Admin Stitch status:

- Admin Reservation Calendar Stitch exploration did not produce an accepted final v1.
- The accepted direction is structural only: dense channel-manager room/date grid, no financial data, optional detail inspector.
- Final visual/layout details should be completed during implementation with a custom data-grid/timeline component.

### Admin dashboard implementation status (2026-07-09)

`/admin/calendar` now ships a first real dashboard implementation aligned to the accepted structural
direction above.

- The screen is split into **4 dashboard views** inside one page:
  - `Month board`: dense room × day timeline grid
  - `Today ops`: arrivals / departures / setting targets / in-house operational lists
  - `Room status`: property-grouped room status table with current guest / next reservation
    stay ranges shown directly as check-in ~ check-out dates
  - `Building info`: address + shared-access + room-access board for each property
- The **month board** is the primary admin view:
  - sticky room label column + sticky day header that stays visible while the inner grid scrolls
  - centered property-name chips (label only, no room-count badge), custom anchored channel menu,
    print/export button
  - channel-colored multi-day bars (Airbnb / Booking.com / other)
  - Airbnb / Booking badges and bars use a softer, more premium palette instead of flat saturated
    blocks, so property/room chips in `Today ops` and the reservation inspector read less harshly
  - clicking a reservation opens a right-side inspector drawer
- `Today ops` now mirrors the mobile cleaning smart-list rule for **setting targets**:
  - target = reservations with `check_in_date = today`
  - exclude same-room same-day turnover cases where a checkout already exists for that room
  - when no setting targets exist, the card shows an explicit empty state instead of reusing the
    turnover / cleaning list
- The admin calendar follows the signed-in user's `preferred_language` only.
  - there is **no in-page locale toggle**
  - language changes belong to the user/profile settings flow, not the reservation console
- The **reservation inspector** is read-only for reservation core data because Beds24 remains the
  source of truth. Current actions:
  - copy Beds24 ID
  - deep-link into maintenance / complaint / lost-found creation flows with
    `reservationId=<uuid>` so the mobile form opens with reservation-linked property / room /
    guest context already filled
  - save a persistent internal note per reservation (`reservation_internal_notes`); the note is
    stored server-side, reloaded when the inspector is reopened, and visible to all active
    organization members in the mobile reservation detail sheet
  - reservations with internal-note text show a small indicator on the month-view reservation bar
- **Operational fetch window behavior remains current month + next month relative to today.**
  The server still fetches the live operational window even if the user browses an out-of-window
  month, so `Today ops`, `Room status`, and `Building info` keep working from the current snapshot.
  The month grid itself shows an explicit out-of-window warning for those months.
- The top-right **refresh chip is passive only**:
  - it refreshes the page snapshot (`router.refresh()`)
  - it does **not** expose the secret-protected `/api/beds24/reconcile` route as a manual admin action
- **Building info** is now backed by shared property-operation metadata.
  - `src/lib/property-map-links.ts` remains the canonical base metadata / fallback source
  - organization-specific overrides are persisted in `property_operation_infos`
  - `/admin/calendar` saves edits server-side and revalidates both `/admin/calendar` and
    `/mobile/calendar`
  - shared metadata currently includes localized address overrides (`ko`, `ja`, `en`), shared
    access codes, room-level access codes, and a shared ops note
- The admin reservation export action now opens `/admin/calendar/print` instead of downloading a
  reservation CSV. The print route renders an A4 landscape month board intended for browser print /
  save-as-PDF output.

## Calendar Interaction Ideas

Mobile:

- Select property/building
- Swipe month
- Tap date
- Tap reservation bar
- View reservations for date
- Open guest/reservation detail
- Switch tabs: Month / Check-in / Check-out / Staying / Empty
- Open earliest empty availability list

Admin web:

- Filter by property/building
- Filter by room/unit
- Search guest name
- View day detail
- Export later if needed
- Select reservation to view detail bottom sheet on mobile; admin web may use an inspector/drawer if needed.

## Map Tab — Building Access Hub (updated 2026-05-26)

The mobile calendar's **Map** tab is now an operational building-access hub.

### UI
- Liquid Glass card list (one card per building): `rounded-2xl border-white/60 bg-white/50 shadow-sm backdrop-blur-xl`.
- Each card includes:
  - building name
  - address
  - Google Maps deep link
  - access-info action that opens a bottom sheet
- Icon policy:
  - `Home` icon for detached houses (`오쿠보A`, `오쿠보B`, `오쿠보C`)
  - `Building2` icon for all other buildings
- Property filter chips are hidden in Map mode; chips still render in Calendar/Lists modes.

### Password UX policy
- Sensitive codes are not fully expanded on every card by default.
- Card-level summary shows only count-level metadata.
- Full details open in a dedicated bottom sheet:
  - shared/common access codes
  - room-level access codes (when available)
  - copy actions per code
  - address copy action
  - Google Maps open action

### Data source
- `src/lib/property-map-links.ts` stores canonical building metadata in one place:
  - building kind (`hotel | house`)
  - localized address
  - `googleMapsUrl`
  - `sharedAccess[]`
  - optional `roomAccess[]`
- Current file is populated with production operation values for all 7 buildings.

### i18n keys (map access UX)
- `calendarMapAccessSheetTitle`
- `calendarMapAddressLabel`
- `calendarMapAddressCopy`
- `calendarMapCopiedAddress`
- `calendarMapCopiedCode`
- `calendarMapOpenAccess`
- `calendarMapOpenInMaps`
- `calendarMapRoomAccessLabel`
- `calendarMapSharedAccessLabel`
- `calendarMapNoAccessData`

## 2026-05-27 Mobile Calendar selective Liquid Glass update

- `/mobile/calendar` follows the shared mobile visual family: warm-ivory shell/chrome, cream-white surfaces, deep navy accent, and selective Apple-style Liquid Glass accents.
- Shell-level behavior is provided by `MobileShell`: scroll-aware top chrome, a full-screen left slide-in menu, and the solid warm-ivory bottom-attached tab bar with a raised center FAB. The `appearance` prop should not be used as a shell tint contract.
- Scope is visual-only (no data/query/permission logic changes):
  - top segmented mode switch and selected-building card
  - overview month frame + date rail surfaces
  - list cards and operational summary cards
  - reservation detail / empty-room / map-access bottom sheets
- Shared surface rules applied:
  - warm-ivory base with selective translucent cream-white layers
  - thin bright border
  - soft depth shadow + subtle inset highlight
  - readable blur level with preserved text contrast
- Calendar bar readability policy remains:
  - channel colors preserved
  - stronger contrast and stable capsule shape for guest labels
  - date numbers and bars keep non-overlapping visual hierarchy.

## Open Questions

- For multi-room buildings, should mobile month view group by room or by date?
- ~~How should webhook failures be retried and monitored?~~ Resolved 2026-06-10 — see "Webhook Reliability" below (observability log + daily reconciliation).
- Should cancelled reservations remain visible in an admin-only sync log?

## Webhook Reliability (Implemented 2026-06-10)

### Background

Reservation ingestion is webhook-first (`docs/planning/01-decision-log.md` → "Beds24 Webhook Strategy"). Webhooks are not guaranteed delivery: a booking created/modified during downtime, a transient delivery failure, a secret mismatch, or a payload missing required fields can cause a booking to never reach the DB. Before this change a dropped webhook left **zero trace** — the only symptom was an operator noticing a gap in the calendar (this is exactly how reservation `5843903602` / Kabukicho 302, check-in 2026-06-08, was discovered missing).

### Two-part fix

1. **Observability — `beds24_webhook_events` table** (`supabase/migrations/202606100001_beds24_webhook_events.sql`):
   - Every inbound webhook batch and every reconciliation run is logged with processing result: `trigger_source` (`webhook` | `reconciliation`), `http_status`, processed/succeeded/failed counts, per-result `modes`, and a compact `booking_summary`.
   - Written by `src/lib/beds24/webhook-events.ts` from the webhook route and the reconcile route. Logging failures are swallowed and never block the ingestion response.
   - Platform-admin read only; service-role write (see `docs/engineering/05-rls-permissions.md`).
   - Makes a dropped/failed booking detectable instead of invisible.

2. **Prevention — daily reconciliation safety net** (`src/app/api/beds24/reconcile/route.ts`):
   - Production-safe, idempotent endpoint that re-pulls the operational window (current month + next month) from the Beds24 `/bookings` API and upserts anything missing — the production counterpart to the dev-only `backfill-reservations` route.
   - Driven daily by **Vercel Cron** (`vercel.json`, `0 19 * * *` UTC = 04:00 Asia/Tokyo), within the free Hobby plan's once-per-day cron limit.
   - Authorized by `CRON_SECRET` (Vercel Cron Bearer header) or `BEDS24_WEBHOOK_SECRET` (manual trigger).
   - A webhook dropped today is healed by the next morning's reconciliation run.

### Policy note

This does **not** regress the webhook-first decision. Webhooks remain the primary, real-time update path. Reconciliation is a low-frequency (daily) catch-up safety net, not polling — consistent with Beds24's guidance to avoid high-frequency GET calls and with CLAUDE.md's "no frequent polling without approval" rule. The daily cadence was confirmed by the user on 2026-06-10.

### Known limitations / future work

- The reconciliation window is the same 2-month operational window as the calendar. A dropped webhook for a booking **outside** current month + next month (e.g. 8+ months out) is not healed by reconciliation. This matches the confirmed MVP calendar scope.
- No active alerting yet (e.g. "0 webhook events received in 24h" → Slack/push). The data to detect this now exists in `beds24_webhook_events`; wiring an alert channel is deferred.
- Reconciliation upserts the full window each run (~hundreds of rows). The upserts are **batched** (in-memory dedup → 500-row chunked bulk upsert in `reservations-backfill.ts`); `maxDuration` is set to 60s on the route as a guard. This fixed an initial production timeout — per-row upserts from a US-East (`iad1`) function to the Tokyo (`ap-northeast-1`) Supabase exceeded 60s.
- Function region is pinned to **Tokyo (`hnd1`)** in `vercel.json` (`regions`), co-located with the Tokyo Supabase DB and the Tokyo-based operations users. This minimizes DB round-trip latency for the reconcile cron, the webhook handler, and all other DB-bound routes. (Default was `iad1` / US-East.)

## Order Delivery Calendar — moved out of the reservation calendar (2026-06-15)

**Decision update (2026-06-15):** the order **delivery calendar will NOT live in this reservation
calendar.** This room-axis timeline is keyed to guest reservations per room; building-scoped order
deliveries do not fit that axis and would clutter the primary reservation use case. The delivery
calendar instead lives in the **mobile Requests area, on the 비품주문 (order) tab only** — opened from
a calendar icon next to the "내 요청" toggle as a large popup, derived directly from
`order_requests.delivery_date` (no separate calendar entry / no schema change). Full spec:
`docs/product/10-order-request-workflow.md` → "Delivery Calendar (Planned / Design — 2026-06-15)".

Retained rules (still apply, just on the Requests-side calendar):

- Only `delivery_date` (point) / `delivery_start_date`..`delivery_end_date` (range) drives an entry.
- No other order workflow date creates a calendar entry.
- If `delivery_date` is missing, no entry is created.
- For delivery scheduling only — not generic purchasing / approval / receiving timeline visualization.

Current data status (as of 2026-06-01): `delivery_date` (+ range columns) exists on `order_requests`
(migrations `202606010002` / `202606020001`), is **required** at the `approved → ordered` transition,
and is displayed on the order detail page + request list cards in Asia/Tokyo. The Requests-side
delivery calendar view is **implemented (2026-06-15)** — `OrderDeliveryCalendar`, opened from the
order tab; the delivery date is editable from the order detail by office roles.

## 2026-05-23 Mobile Calendar Policy Update

- Calendar tab entry now starts with a building picker when no `property` query is selected.
- The picker hero may use a Lottie animation asset for the building/assistant scene; do not recreate it as CSS-only illustration when an approved animation file exists.
- Building picker cards use property-specific icons: Okubo detached-house properties use a house icon, all other properties use a hotel/building icon.
- Selecting a building opens the property-specific calendar via `?property=<building>`.
- The previous horizontal building filter chip row is removed from the calendar view; selected-property changes happen through the building picker.
- Mobile tab interaction now uses three consistent selectable tabs:
  - `Calendar` (overview timeline)
  - `Lists` (check-in/check-out/staying + empty summary)
  - `Map` (operational building access hub)
- `Map` is active and provides building cards, map links, and access-info entry points.
- Reservation detail bottom-sheet action policy is now explicit:
  - `Message Guest`: disabled fallback until messaging integration is ready.
  - `Manage Booking`: disabled fallback until external channel/booking integration is ready.
  - Both actions must show a clear reason in UI copy.
- Phone action policy in reservation detail:
  - Copy phone number action must be provided.
  - Call action (`tel:`) must be provided only when a dialable number is present.
  - Missing phone numbers must show explicit fallback copy, not silent `-`.
- `Empty today` on mobile is still provisional in this phase:
  - current formula = rooms observed in reservation data - occupied rooms today.
  - this is not authoritative without room master data.
  - implementation must keep TODO markers for room-master-based replacement.

## 2026-05-24 Empty Today - Provisional vs Authoritative

- `Empty today` calculation state: **provisional**.
- Provisional formula: `(unique room_label values in current month's reservations) - (rooms occupied today)`.
- Limitation: rooms with no reservations in the current month are invisible to this formula and are not counted as empty.
- UI: Lists mode shows an amber warning card with locale-specific `emptyAccuracyHint` text when the calculation is provisional. The amber card and hint are hidden automatically once authoritative data is supplied.

### Component readiness (current state)

Both the Overview room axis and `computeEmptyToday()` in `src/components/calendar/mobile-calendar-view.tsx` use the same `roomMasterRooms` prop. The authoritative/provisional branch is determined by whether the prop is `undefined` (not connected / unpopulated) or a non-empty array (authoritative room list):

| `roomMasterRooms` value | Source | Overview room axis | Empty today | Amber warning |
|---|---|---|---|---|
| `undefined` | rooms table absent or empty | Reservation-observed rooms | Provisional | Shown |
| `[]` | room master connected, but all current rows inactive/non-operational | No active room rows | Authoritative zero-room state | Hidden |
| `["A", "B", ...]` | `getActiveRoomLabels()` returned active room rows | All master rooms | Authoritative | Hidden |

**Current wiring (as of 2026-05-24):**

- `src/app/mobile/calendar/page.tsx` now calls `getActiveRoomLabels(session.organization.id, supabase)` in parallel with the reservations query and passes the result as `roomMasterRooms`.
- `getActiveRoomLabels()` in `src/lib/rooms.ts` returns `undefined` while the org has no **classified** room-master rows yet.
- "Classified" means:
  - non-Beds24 room row, or
  - Beds24 room row with `external_minimum_stay` present
- Once classified room-master rows exist, `getActiveRoomLabels()` returns `string[]`:
  - `[]` when every classified row is inactive / filtered out
  - `["A", "B", ...]` when active room rows exist
- The `rooms` table (`supabase/migrations/202605240001_properties_rooms.sql`) exists in schema but contains no data yet, so the calendar remains in provisional mode until rows are inserted.
- Beds24 active room filter rule is encoded in `BEDS24_INACTIVE_MIN_STAY_THRESHOLD = 50` in `src/lib/rooms.ts`. Safety guard: Beds24 rooms are treated as active only when `external_minimum_stay` is explicitly present and `< 50`. Rows with `external_minimum_stay >= 50` or `NULL` are excluded from the active room list.
- property sync prefers `(organization_id, external_provider, external_property_id)` when Beds24 property ID is present, and falls back to `(organization_id, name)` only when the payload omits the external property ID.
- inventory sync now uses Beds24 property data as the primary authoritative classification source:
  - primary: `GET /properties?includeAllRooms=true` -> `roomTypes[].id`, `roomTypes[].minStay`
  - fallback: current-date `GET /inventory/rooms/calendar?propId=...`
  - tested same-day calendar responses returned `calendar: []`, so the calendar endpoint is currently fallback-only

**To activate authoritative mode:** the Beds24 webhook (`/api/beds24/webhook`) now performs two sync steps:
1. booking payload -> `properties` / `rooms` / `reservations`
2. property/room minimum-stay lookup -> `external_minimum_stay` / room status refresh

If the inventory call succeeds and yields `minimumStay`, `getActiveRoomLabels()` can immediately return classified active rooms and the calendar leaves provisional mode automatically. If the inventory call is unavailable or returns no usable room rows, the calendar remains provisional until classification data exists.

## 2026-05-26 Building Filter Update

- `/mobile/calendar` now supports building-level filtering using `property` query:
  - example: `/mobile/calendar?month=2026-05&property=아라키초A`
- Filter chips are shown above the calendar/list body:
  - detected building list only (no `All`)
  - month navigation preserves selected building
- Active room axis follows room master + building filter together:
  - room source = active rows from `rooms` table
  - only rooms belonging to the selected building are rendered
- Current operational building order for UI:
  - 아라키초A, 아라키초B, 가부키초, 다카다노바바, 오쿠보A, 오쿠보B, 오쿠보C

## 2026-05-26 Active room loading policy clarification

- Confirmed company rule: Beds24 `minimumStay >= 50` (including 50, up to 99+) is inactive.
- Calendar reservation loading now follows room-master authoritative filtering:
  - if room master is available, only reservations whose `room_label` belongs to active room-master rows are rendered.
  - inactive room-id account reservations are excluded from UI rendering.
  - legacy/manual rows without raw Beds24 room identity are not trusted in authoritative mode because they cannot be verified against the active external room-id catalog.

## 2026-05-26 Physical-room display normalization

- Active room selection rule remains authoritative: only `minimumStay < 50` is active (`>= 50` inactive).
- UI room labels now normalize by property-level operational rules:
  - Arakicho A: suffix room labels like `201_2` still normalize to base room label `201`, but reservations carrying inactive external room IDs are filtered before rendering so inactive aliases do not reappear.
  - Kabukicho: `K202`, `202#` -> `202`
  - Okubo A/B/C: all Beds24 room IDs in each property collapse to one detached-house room label (`Okubo A`, `Okubo B`, `Okubo C`)
- Reservation bars and room axis use the same canonical label mapping to avoid split rows for one physical room.

## 2026-05-26 Canonical property naming update

- Property labels are now normalized to the fixed operational names in UI:
  - Arakicho A, Arakicho B, Kabukicho, Takadanobaba, Okubo A, Okubo B, Okubo C
- This normalization is applied before calendar filters and room-label canonicalization.

## 2026-05-26 Operational exclusion updates

- Excluded from mobile calendar operations:
  - Property: `Test` (currently not operated)
  - Room: `Takadanobaba 401_2` (inactive room-id alias)
- Okubo property display is unified to `Okubo A`, `Okubo B`, `Okubo C` (no raw Beds24 suffix labels in UI).
- Property chips and reservation property labels now render locale-specific names (ko/ja/en) while keeping canonical internal mapping.

## 2026-05-26 Property label format adjustment

- Locale display labels use compact building format for English (`ArakichoA`, `ArakichoB`, `OkuboA`, `OkuboB`, `OkuboC`).
- Property normalization now absorbs Beds24 raw variants with underscores/parentheses so `Okubo_A (B棟)` style names always map to canonical Okubo labels.

## 2026-05-26 Today column alignment fix + auto-scroll to today on first entry

### Alignment fix

Root cause: the room-row body container had `p-1` (4px horizontal padding), shifting all absolute-positioned elements (bars, today stripe) 4px to the right of the header date cells.

Fix: changed `p-1` → `py-1` (top/bottom padding only). Now `left: N * DAY_WIDTH` in a room row maps to the same x as the N-th header date cell.

Follow-up hardening (same day):

- Header day-cell width now also uses `DAY_WIDTH` directly (inline style) instead of an independent Tailwind width class.
- Header and body share one coordinate system:
  - header today emphasis: `date === today`
  - body today stripe x: `todayIndex * DAY_WIDTH`
  - date lookup: `dates.findIndex((date) => date === today)`
- This removes drift risk when design tokens or Tailwind width classes change.

### Auto-scroll to today

On first entry into the overview panel for a given month/property:
- `scrollLeft` is set to `max(0, todayIndex - 1) * DAY_WIDTH` so the day before today is visible at the left edge, placing today clearly in view
- Implemented with `useEffect` (deps: `mode`, `isTodayInView`, `todayIndex`, `selectedMonth`, `selectedProperty`)
- A `Set<string>` ref tracks scrolled `selectedMonth:selectedProperty` keys — each combo is auto-scrolled at most once per client session
- When `selectedMonth` is not today's month (`isTodayInView === false`): auto-scroll is skipped
- When mode switches back to "overview" after having been auto-scrolled: no repeat scroll (key already in Set)

## 2026-05-26 Mobile calendar overview readability improvements + today column highlight

### Readability changes

- Row height: `h-8` (32px) → `h-10` (40px) across header, room label column, and all room rows
- Max visible area: `max-h-[460px]` → `max-h-[560px]` to preserve the number of visible rooms
- Date header font: `10px` → `11px`; still `font-semibold`
- Room label font: `11px` → `12px` (`text-xs`); color `text-muted-foreground` → `text-foreground/70`
- Reservation bar: `h-6 top-1` → `h-7 top-1.5` — slightly taller bars with centered vertical position

### Today column highlight (Asia/Tokyo)

- Source of truth: `today` prop passed from server (computed `Asia/Tokyo` — never recomputed on client)
- Header today cell: amber/orange background + bold orange text
  - `bg-orange-200/50 font-bold text-orange-600` (light-mode-only; dark variants removed 2026-06-08)
- Body today column: per-row `pointer-events-none` absolute stripe at `left: todayIndex * DAY_WIDTH`
  - `bg-orange-200/30` (light-mode-only; dark variants removed 2026-06-08)
  - Inserted as first child of each room row so reservation bars (DOM order: later) render on top
- When `today` is outside the selected month (`todayIndex === -1`), no highlight is rendered

## 2026-05-26 Reservation bar off-by-one fix (last day of month)

### Problem

The last day column of the selected month (e.g., May 31) appeared empty even when reservations were staying through that night.

Root cause: the bar rendering code used `rangeEnd = dates.at(-1)` (e.g., `"2026-05-31"`) as an **inclusive** clamp and computed width as `endDate - startDate`. A stay of `check_in=2026-05-29, check_out=2026-06-01` clamped to `end="2026-05-31"`, giving `widthDays = May31 - May29 = 2` — missing the 31st column.

### Fix

`rangeEndExclusive = "${nextMonth}-01"` (e.g., `"2026-06-01"`) is now used as the exclusive upper bound for all bar calculations in `src/components/calendar/mobile-calendar-view.tsx`:

- **`activeInRange` filter**: `checkInDate < rangeEndExclusive` (was `<= rangeEnd`)
- **Bar clamp**: `endExclusive = min(checkOutDate, rangeEndExclusive)`
- **Width**: `widthDays = (endExclusive − start) / 1 day`

Verified regression cases:

| Reservation | May view expected | Result |
|---|---|---|
| `05-31 → 06-01` | 31st column, 1 day wide | ✓ |
| `05-29 → 06-01` | 29, 30, 31 — 3 days wide | ✓ |
| `04-29 → 05-01` | not shown (checkout = range start) | ✓ |
| `04-29 → 05-02` | 1st column, 1 day wide | ✓ |
| `06-01 → 06-05` | not shown (pure June) | ✓ |

The visible date header columns (01–31) are unchanged.

## 2026-05-26 Room label resolution — Japanese property name and global externalRoomId fallback

### Background

`resolveReservationCanonicalRoomLabel` uses a 4-step fallback chain to map a raw reservation record to a canonical room label that the active room-master catalog recognizes. In authoritative mode, reservations that fail all steps are filtered out.

### Root cause of 아라키초A reservation bars not appearing

When Beds24 sends a Japanese property name (e.g. `"荒木町A"`) in the reservation payload, the previous `getCanonicalPropertyName()` implementation did not recognize it and returned `"荒木町A"` unchanged. The lookup table `canonicalRoomLabelsByProperty["荒木町A"]` was undefined, so `allowed = new Set()`. All `allowed.has()` checks failed, including the property-specific `externalRoomId` lookup, so every step returned false and reservations were filtered out.

### Fixes applied (2026-05-26)

1. **Japanese kanji aliases in `src/lib/room-label-normalization.ts`:** Each property recognizer now includes the Japanese kanji form:
   - `isArakichoA`: `"荒木町a"` (after `.toLowerCase()`)
   - `isArakichoB`: `"荒木町b"`
   - `isKabukicho`: `"歌舞伎町"`
   - `isTakadanobaba`: `"高田馬場"`
   - `isSano`: `"佐野"` (exclusion rule preserved)
   - `isOkuboA`: `"大久保a"`, `isOkuboB`: `"大久保b"`, `isOkuboC`: `"大久保c"`

2. **Global `externalRoomId` fallback in `src/app/mobile/calendar/page.tsx`:** A `globalExternalRoomToCanonical: Map<string, string>` is built from the full room catalog (all properties, all active rooms) before `resolveReservationCanonicalRoomLabel` runs. If the property-specific `externalRoomId` lookup fails (due to property-name mismatch), the resolver now tries the global map. Since `externalRoomId` is unique across the rooms table, no `allowed.has()` guard is needed — the catalog is authoritative.

3. **Missing payload aliases:** `"unitLabel"`, `"unit_label"`, `"room_label"` added to the unit-name lookup key list.

### Resolution order (updated)

| Step | Source | Guard |
|---|---|---|
| 1 | `getCanonicalRoomLabel(property, room_label)` | `allowed.has()` |
| 2 | payload unit name (`unitName`/`unit_name`/`roomName`/`room_name`/`roomLabel`/`unitLabel`/`unit_label`/`room_label`) → normalize | `allowed.has()` |
| 3 | payload unit name → raw label map lookup | `allowed.has()` |
| 4 | payload unit ID (`unitId`/`unit_id`/`roomId`/`room_id`) → property-specific externalRoomId map | `allowed.has()` |
| 5 | payload unit ID → global externalRoomId map | none (catalog-authoritative) |
| 6 | single-room property fallback (`allowed.size === 1`) | — |
| 7 | fallback: `fromReservation` (may not match → filtered out) | filtered by `activeCanonicalRoomSet` |

### Recurrence prevention

- **New properties or locales:** if a new property is added to Beds24 with a name in a new script/language, add the corresponding alias to the recognizer function in `src/lib/room-label-normalization.ts`. The global externalRoomId fallback (step 5) provides a safe net even before the alias is added.
- **New Beds24 payload field names:** add to the `payloadUnitName` or `payloadUnitId` alias arrays in `resolveReservationCanonicalRoomLabel`. The global fallback ensures that known room IDs always resolve even if field names vary.

## 2026-05-26 Building chips only policy

- Mobile calendar property filter no longer includes `All`.
- Only explicit building chips are shown.
- When no `property` query is provided, the first available building is auto-selected by server logic.

## 2026-05-26 Arakicho B label normalization

- Arakicho B room labels now strip alphabetic prefixes as well as suffix variants.
- Example: `Ab101` -> `101`.

## 2026-05-26 Overview grid refinement — lighter grid lines, horizontal room separators, pill bars

### Grid line changes

- **Vertical column lines**: opacity reduced from `rgba(0,0,0,0.10)` → `rgba(0,0,0,0.06)` — subtler feel without disappearing.
- **Horizontal room row separators (new)**: `border-b border-border/20` added to each room row (right body) and each room label (left column). Previously only vertical lines existed; horizontal lines now separate rooms clearly for scannability.
- `space-y-1` gaps and `py-1` container padding removed from both the left label column and right body container — rows stack directly and borders provide the visual separation.

### Reservation bar pill style

- Shape: `rounded-md` → `rounded-full` — full capsule/pill shape.
- Size: `top-1.5 h-7` → `top-2 h-6` — slightly shorter pill with more breathing room above and below.
- Padding: `px-1` → `px-1.5` — slightly wider internal text padding matching the rounder shape.
- Rationale: pill shape visually separates adjacent reservations better than square-corner bars, reducing crowding sensation even when bars are close.

## 2026-05-26 Webhook-only freshness behavior

- Operational expectation: new/modified/cancelled Beds24 reservations should appear from webhook writes, not from periodic calendar polling.
- Mobile calendar now listens to Supabase Realtime changes on `public.reservations` for the active organization and refreshes the screen automatically when reservation rows change.
- Backfill is retained only for dev/manual recovery, not as the normal user-visible freshness mechanism.
- Realtime prerequisite: `public.reservations` must be present in the `supabase_realtime` publication.
- **2026-09-29 — 차단·요금도 실시간.** 모바일 캘린더는 위 예약 구독에 더해 Beds24 실시간 신호
  (`beds24-live:<조직>` broadcast)도 듣는다. 차단 막대(`room_blocks`)가 웹훅으로 바뀌어도 새로고침 없이
  다시 그린다. 같은 신호를 어드민 예약 캘린더·판매 캘린더·대시보드·청소(모바일/어드민)·모바일 홈도
  듣는다. 계약: `docs/product/33-calendar-write-features.md` → 「화면도 웹훅 기준으로」.
  **2026-09-30 부터 private 채널** — 구독 전에 `supabase.realtime.setAuth()` 로 사용자 JWT 를 싣고,
  `realtime.messages` RLS 가 그 조직 active 멤버만 받게 한다(`202609300006`).
- 참고: 같은 구독 안의 `reservation_internal_notes` 변경 알림은 그 표가 `supabase_realtime` 에 없어
  실제로는 오지 않는다(2026-09-29 확인). 내부 메모는 저장한 화면에서 직접 갱신된다.
- **2026-09-30 — 신호에 범위가 생겼다.** `signalBeds24Change` 가 `{ propertyNames?, from?, to? }` 범위를
  실을 수 있고, 받는 쪽도 범위를 줄 수 있다(`beds24LiveScopesOverlap`, `src/lib/beds24-live.ts`) — 겹치지
  않는 신호는 무시한다. 지금 이 범위를 실제로 거는 것은 판매 캘린더(`/admin/ops/calendar`)뿐이고, 이
  모바일 예약 캘린더를 포함한 나머지 구독은 **범위 없이 그대로 전부** 받는다(바뀌지 않았다). 계기와 상세:
  `docs/product/33-calendar-write-features.md` → 「판매 캘린더가 스스로 무한 새로고침을 돌던 것」.
- **2026-10-09 — 놓친 변경 따라잡기(판매 캘린더와 같은 공용 장치).** Beds24 신호 구독을 직접 짜던 것을 공용
  `useBeds24LiveRefresh`(`src/components/shared/beds24-live-refresh.tsx`)로 바꿨다. 실시간 신호는 저장되지 않아서, 폰 잠금 ·
  와이파이 전환 · 오래 가려 둔 화면으로 연결이 끊긴 동안 온 예약은 다음 변경이나 새로고침까지 안 보였다. 이제 ① Beds24 채널이 끊겼다
  다시 붙으면 ② 네트워크가 돌아오면(`online`) ③ 1분 넘게 가려졌던 화면이 다시 보이면 **한 번 다시 읽는다**. 예약 표 구독
  (`calendar-reservations:<조직>`)도 끊겼다 다시 붙으면 한 번 다시 읽는다. 연결 상태는 공용 점(`Beds24LiveDot`)과 같은 신호로 알린다.

### Cancellation visibility policy (verified)

- When Beds24 sends a cancelled webhook event, the reservation row is updated in DB to `status = cancelled`.
- The calendar server query excludes cancelled rows (`status != cancelled`), so cancelled reservations disappear from:
  - overview bars
  - list sections (check-in / check-out / staying)
- This is an intentional display policy:
  - cancelled data can remain in DB for audit/recovery,
  - operational calendar surfaces must not show cancelled reservations as active occupancy.
- `no_show` keeps its own status and is not treated as cancelled by default in this phase.

## 2026-06-01 Planned Integration - Order Delivery Date Sync

Scope:

- This is a planned integration between Order Requests and Calendar.
- Not implemented in the current step.

Planned trigger:

- When an order request status changes to `ordered` and `delivery_date` is saved.

Planned result:

- Create a calendar schedule entry for the delivery date.
- Show this schedule to both requester and office/admin in calendar surfaces.
- Only the delivery date is used for this integration.

Current interim behavior:

- Keep `delivery_date` on the order request detail/list and notifications until calendar wiring is implemented.

## 2026-06-18 Room-label mapping parity — home check-in/out sheet + cleaning targets

Background: the calendar resolved reservations to canonical rooms correctly, but two
other surfaces showed raw, unnormalized room labels:

- Home "오늘 체크인 / 체크아웃" detail sheet showed raw `room_label` (e.g. `가부키초 303#`,
  `가부키초 K803`, `아라키초A 501_2`, `오쿠보C 오쿠보 2-1`).
- Cleaning "청소 대상" cards showed the canonical key without the display collapse
  (e.g. `아라키초A 501_2` instead of `501`).

Fix — both surfaces now match the calendar's display label:

- **Home sheet** (`getHomeCheckInOutReservations` in `src/lib/home.ts`): now fetches the
  active room catalog and reuses the same resolution the calendar uses
  (`buildPropertyRoomLookups` + `buildGlobalExternalRoomToCanonical` +
  `resolveReservationCanonicalRoomLabel`), then `getDisplayRoomLabel` for the visible label.
  The 2-account case (e.g. `501`/`501_2`, `803#`/`K803`) is disambiguated via
  `raw_payload.roomId → external_room_id → canonical` and collapsed to one display label.
  Okubo rooms (canonical room == property) render the building name only. Property name is
  returned canonical so the caller's `buildPlaceLabel` localizes it unchanged.
  (Drop behavior superseded — see the 2026-06-18 "No-drop" section below: unmapped
  reservations now fall back to the normalized label instead of being hidden.)
- **Cleaning targets** (`getLocalizedRoomTitle` in `src/app/mobile/cleaning/page.tsx`): now
  applies `getDisplayRoomLabel` so Arakicho sub-units collapse (`501_2` → `501`). Kabukicho
  `#`/`K` stripping and Okubo property-only labels were already correct via
  `getCanonicalRoomLabel`. Display-only change; stored `sessionRoomLabel` and dedup keys are
  unchanged.

Reference resolver remains the single source of truth in `src/lib/rooms.ts`
(`resolveReservationCanonicalRoomLabel`), shared by calendar, task context picker, and now
the home check-in/out sheet.

## 2026-06-18 No-drop policy + null-minStay rooms stay visible (data-loss fixes)

Diagnosis (vs the in-house reference system, which never loses data): our system resolved
reservations at **read time** against the live `rooms` catalog and **dropped** any reservation
whose room did not map to an *active* catalog row. Combined with two write-side traps this
caused intermittent missing reservation bars / cleaning targets:

- Webhook booking payloads carry **no minimumStay**, so a freshly-synced room was created with
  `external_minimum_stay = NULL` → classified **inactive** → excluded from the catalog → its
  reservations dropped, until a separate inventory sync ran.
- Any catalog gap (missing/rotated `external_room_id`, not-yet-synced room) silently removed a
  reservation, and the read-time design made visibility fluctuate as the catalog changed.

Fixes (the in-house system never drops a booking and uses a complete, static room axis):

1. **null minStay → active** (`classifyBeds24Room` in `room-sync.ts`; `getActiveRoomCatalog` in
   `rooms.ts`). Only an explicit `>= 50` marks a room inactive. New webhook-synced rooms are
   active immediately; any existing room row now counts as "classified" (authoritative).
2. **No-drop + fallback rows** (calendar `src/app/mobile/calendar/page.tsx`, home `src/lib/home.ts`):
   reservations are never discarded. If a reservation does not resolve to a catalog room, it
   falls back to the normalized room label (`getCanonicalRoomLabel` → `getDisplayRoomLabel`).
   On the calendar, orphan rooms (room not in the active catalog) are **added to the room axis**
   (`canonicalRoomMasterRooms` + `propertyRoomsMap`) so the bar has a row to render on. The
   home check-in/out sheet keeps all guests (count = full list).
   - Note: orphan rooms added to the axis also participate in the "empty today" count, since
     they are real rooms with reservations in the window.

Fetch completeness (verified, no change needed): the reconcile/backfill and all surface queries
filter by **stay dates** (`arrivalTo`/`departureFrom`, `check_in_date`/`check_out_date`
overlap), not booking date. A booking made 12 months ago that checks in this/next month is
captured. The operational display/fetch window stays current month + next month; only the
**booking date is unconstrained**.

Still pending (infra, not code): live Beds24 webhook delivery — `beds24_webhook_events` shows
**0 webhook events** and reconcile last ran 2026-06-10. Until webhook + reconcile run, data is
frozen regardless of the above logic fixes.
## 2026-07-10 Admin Calendar Update

- Admin `Building info` is no longer browser-preview-only. It now saves shared property operation
  metadata to Supabase and the same data is read by both `/admin/calendar` and `/mobile/calendar`.
- Shared building operation metadata currently includes localized address overrides (`ko`, `ja`,
  `en`), shared access codes, room-level access codes, and a shared ops note.
- Reservation internal notes remain organization-visible operational notes. When a reservation bar
  has a note, the calendar bar shows a small indicator dot.
- The admin reservation export button is no longer a reservation CSV download. Reservation
  calendar export now opens `/admin/calendar/print` and renders an A4 landscape month board
  intended for browser print / save-as-PDF output.
- Historical note: Beds24 ingestion was temporarily paused during the 2026-07-10 webhook/API shutdown
  window, but this is **no longer the current state**. Since 2026-07-17 production runs with
  `BEDS24_SYNC_PAUSED=false`, live webhook ingestion and reconcile are active again.

## 2026-07-13 A4 Print Fit Fix

- `/admin/calendar/print` day-column width is now computed from the available A4 landscape content
  width instead of a fixed `7.78mm`. Previously the fixed width made 30/31-day months overflow the
  ~257mm sheet content area (e.g. July at 31 days needed ~275mm), and the grid's `overflow: hidden`
  clipped the right-most dates.
- The day column is now `calc((256mm - var(--label-width)) / <dateCount>)`, so the label column plus
  all day columns always fit within one A4 landscape page for any month length (28–31 days). Reservation
  bars stay aligned because they already position off the shared `--day-width` variable.

## 차단(블락) 표시 (2026-09-11)

### 무엇을 보여주나

Beds24 캘린더에서 막아 둔 객실·날짜를 **회색 빗금 띠**로 그린다. 라벨은 `차단 / ブロック /
Blocked`. 어드민 월간 캘린더(`/admin/calendar`)와 모바일 캘린더(`/mobile/calendar`) 둘 다에서
같은 모양으로 보인다.

띠가 덮는 범위는 **막힌 밤**이다 — 9/23~9/26 이면 23·24·25·26 네 밤이고, 예약 막대와 눈금이
정확히 맞는다(체크인 9/23 · 체크아웃 9/27 인 예약과 같은 자리).

### 예약 막대 아래에 깔린다

차단과 예약은 **겹칠 수 있다.** 채널 판매를 막아 두고 그 자리에 수기 예약을 넣는 운영이 실제로
쓰이기 때문이다(2026-09-23 O202·O203). 겹칠 때는 예약이 위로 올라온다 — 손님 이름이 먼저 보여야
한다.

색이 아니라 빗금으로 구분하는 이유: 채널 색(에어비앤비·부킹)을 하나 더 쓰면 「또 다른 채널」로
읽힌다.

### 보이지 않는 것

**끝이 열린 차단은 그리지 않는다.** 조회 창 끝까지 이어지는 blackout 은 차단이 아니라 아직
판매를 안 연 기간인 경우가 많다(2026-09-11 기준 여러 건물이 2027-03-01 부터 그런 모양이었다).
그것까지 그리면 해당 달이 통째로 빗금이 되어 진짜 차단이 묻힌다.

판매 기간을 열면 자연히 사라지는 값이므로 운영 화면에서는 제외한다. 판단 기준과 근거는
`docs/engineering/01-beds24-integration.md` → 「캘린더 블락(차단)을 가져온다」.

### 신선도

블락은 웹훅이 없다 — 예약이 아니라 인벤토리 오버라이드라서 Beds24 가 이벤트를 보내지 않는다.
**6시간마다 도는 정합성 작업이 유일한 입구다**(`beds24-reconcile.yml`). 즉 Beds24 에서 막은 직후
우리 캘린더에 즉시 반영되지는 않고, 최대 6시간 뒤에 맞춰진다. 예약은 종전대로 웹훅으로 즉시
들어온다.

### 예약 없이 판매만 막아 둔 방 (2026-09-11)

블락은 예약과 짝이 아니다. **판매만 막고 예약은 넣지 않는** 운영이 자주 쓰인다. 그 경우:

| 화면 | 어떻게 보이나 |
| --- | --- |
| 캘린더 (어드민·모바일) | 빗금 띠가 가려지지 않고 온전히 보인다 + `차단` 라벨 |
| 어드민 객실 현황 표 | **`차단`** — 「빈 객실」이 아니다 |
| 모바일 「오늘 빈 객실」 목록 | 목록에는 남고 **`차단` 배지**가 붙는다 |
| 모바일 「오늘 빈 객실」 **숫자** | **포함해서 센다** (아래 이유) |

**왜 숫자에서는 빼지 않나.** 「오늘 빈 객실」은 *물리적으로 비어 있는 방*의 수이고, 블락은 판매만
막은 것이라 방 자체는 비어 있다. 여기서 빼면 청소·점검 인원이 보는 숫자가 실제 현장과 어긋난다.
대신 목록에서 `차단` 으로 표시해 「팔 수 있는 방」으로 오인하지 않게 한다.

투숙 중인 방이 동시에 막혀 있으면 **손님이 먼저다** — 현황 표에는 `재실`이 뜨고 차단은 캘린더
띠로만 보인다.

판정은 `src/lib/room-blocks.ts` 한곳에 모여 있다(`blockCoversDate`, `collectBlockedRooms`).
블락 구간은 **양끝을 포함**하므로 예약(체크아웃 제외)과 규칙이 다르다 — 화면마다 손으로 쓰면
한쪽만 어긋난다. 회귀 테스트: `src/lib/__tests__/room-blocks.test.ts`.

**작업(할 일) 화면의 객실 선택**도 같은 규칙을 따른다(어드민 팝오버·모바일 시트 모두).
우선순위는 **투숙 > 차단 > 공실** — 막아 둔 방에 수기 예약이 들어와 있으면 작업을 배정하는
사람에게는 「손님이 있다」가 먼저 알아야 할 사실이다. `PickerRoom.blocked` 로 내려간다.

유지보수(정비) 화면의 `투숙 중` 배지는 손대지 않았다. 그 배지는 「손님이 있으니 작업 주의」를
뜻하고 공실을 주장하지 않으므로, 차단된 빈 방에 배지가 없는 것이 오히려 맞다.


## 건물 선택 카드는 높이가 같다 (2026-09-11)

모바일 캘린더의 건물 선택 격자(2열)에서 **「STAY ARI Apartment Hotel」 카드만 커 보이던** 문제.

원인은 두 가지가 겹쳤다.

1. 격자 칸(`Link`)은 줄 높이만큼 늘어나는데 **그 안의 카드가 내용 높이에 머물렀다.** `Link` 와
   `Card` 에 `h-full` 을 줘서 같은 줄의 카드가 같은 높이가 된다.
2. 이름 줄 수가 카드 높이를 좌우했다. 건물 이름은 「가부키초」처럼 짧은 것부터 「STAY ARI
   Apartment Hotel」처럼 두 줄짜리까지 제각각이고 앞으로도 그렇다. 그래서 **이름 자리를 두 줄로
   고정**했다 — 한 줄짜리는 아래 여백으로 남고 두 줄짜리는 꽉 찬다. 어느 쪽이든 카드 크기는 같다.

자리를 잡는 바깥 상자와 글을 다루는 안쪽 `<p>` 를 나눴다. `text-balance`(줄바꿈 균형)와
`break-keep`(한국어 단어가 음절로 쪼개지는 것 방지)은 **글 상자에 걸려야** 먹기 때문이다.
`line-clamp` 은 쓰지 않는다 — `display: -webkit-box` 라 바깥의 flex 정렬과 충돌한다.

**짧은 이름을 붙이는 방법도 있다.** 다른 건물은 전부 한국어 약칭이 있고(`CANONICAL_TO_BUILDING_KEY`)
STAY ARI 만 원문을 그대로 쓴다. 다만 그 이름은 예약·청소 라벨의 매칭 키이기도 해서
(`getCanonicalPropertyName`), 바꾸려면 저장된 값들과 함께 봐야 한다. 이번에는 레이아웃만 고쳤다.

## 예약 · 블록은 1,000행씩 끝까지 읽는다 (2026-10-01)

PostgREST 는 한 번에 1,000행까지만 주고 초과분은 **오류 없이 잘린다**. 관리자(`getAdminCalendarDashboardData`)·
모바일(`/mobile/calendar`) 예약 캘린더는 두 달 창 예약을 한 번에 읽고 있어서, 1,000건을 넘는 순간 예약 막대가
조용히 사라질 상태였다(2026-10-01 당시 771건). 비어 보이는 칸은 「판매 가능」으로 읽히므로 이중 판매로 이어진다.

- 판매 캘린더가 쓰던 `readAllPages` 를 `src/lib/supabase/read-all-pages.ts` 로 공용화해 예약·`room_blocks` 를
  쪽 나눠 끝까지 읽는다. 정렬 뒤에 `id` 를 붙여 쪽 경계에서 행이 빠지거나 겹치지 않게 했다.
- 블록 읽기가 중간에 실패하면 반쪽을 그리지 않고 비운다(관리자 · 모바일 같음). 예약 읽기 실패는 기존처럼 오류.
- 테스트 `src/lib/__tests__/read-all-pages.test.ts`.

