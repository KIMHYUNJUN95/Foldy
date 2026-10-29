# Mobile Navigation

## 2026-08-06 accessibility copy contract

Shared mobile overlays and controls, including image-lightbox close actions, date-range previous/next month controls, toggles, overflow menus, and remove actions, receive localized accessible names from their owning `ko`/`ja`/`en` dictionary. Shared components must not provide an English-only default label.

## Purpose

The mobile/PWA field interface should be optimized for fast daily work by on-site staff, field managers, regular staff, and part-time staff.

## Entry Routing Contract

The product must not show a public root-level version chooser such as:

- "Go to dashboard"
- "Go to mobile version"

Confirmed routing direction:

- **Desktop / PC** root access should enter the desktop auth flow first (`/auth/login`), then proceed to the dashboard/web side after authentication/onboarding resolution
- **Mobile / tablet** access should go directly to the mobile side (`/mobile`)
- **Mobile / tablet must never render `/admin*` dashboard pages.** If a mobile request arrives at
  `/admin*` directly (shared link, KakaoTalk/LINE in-app browser, stale `next=/admin`, or OAuth
  callback), the route is normalized to `/mobile` before the dashboard page renders.
- Auth, OAuth callback, password-reset, and onboarding completion must also normalize mobile
  `next=/admin*` to `/mobile`.
- If an authenticated mobile session has no organization/workspace context, `/mobile/*` routes must
  redirect to `/mobile/unavailable` instead of `/admin`. This keeps the field app and dashboard
  surfaces separated even for platform/admin-only accounts or stale sessions.
- If the dashboard later offers a way to open the mobile version, that belongs **inside the dashboard**
  after login, not on the root landing page

This means any temporary/manual entry chooser screen is a development artifact and must not remain in
the real product flow.

## Confirmed Bottom Tabs

The bottom bar uses a **center-action ("추가") button** design: four tabs split 2 / 2 around a raised central FAB.

```txt
Home   Calendar   [ ✎ 편집 (center FAB) ]   Requests   Announcements
```

- **The four side tabs are per-user customizable.** Each user picks which features sit in their bottom bar (all four slots are free to change). The chosen ids are persisted per user in `profiles.bottom_nav_tabs` (Supabase) and synced across devices. Defaults: Home, Calendar, Requests, Announcements.
- **The center FAB ("편집", squircle button with an app-grid icon) opens the bottom-bar editor sheet**: a dark scrim + slide-up sheet with a 2-column colour-category tile grid listing every selectable feature (`customizableBottomNavItems` = the side-menu pool: Home, Calendar, Cleaning, Todoist, Suggestions, Attendance, Requests, Announcements, Directory, Linen Return). Tapping a tile adds/removes it from the bottom bar (max 4; a counter `n/4` and a "full" hint are shown; at least one tab must remain). Each tile uses a unified palette (`oklch` with fixed lightness/chroma, hue-only variation per `LAUNCHER_META`) and shows a check when selected. The grid scrolls vertically when it overflows, with the scrollbar hidden (`.add-sheet__scroll`). Edits are saved (via the `updateBottomNavTabs` server action) when the sheet closes by any path (drag-down / scrim tap / Escape).
- **Cleaning** is not a default bottom tab but can be pinned via the editor. Since 2026-10-28 it is shown only to `cleaning.assign` holders (side menu and bottom tab both filtered) and opens the 청소 현황판; field staff start and finish rooms in 「오늘 내 방」 (`/mobile/shift/today`), whose 「목록에 없는 방 · 셋팅 청소」 link opens the old list (`/mobile/cleaning?work=1`). See `07-cleaning-workflow.md` 「2026-10-28 모바일 청소 현황판」.
- Profile and user directory remain accessible from the top-right profile button / side menu rather than the bottom bar (Directory may also be pinned).
- **Todoist** (`투두이스트` / `Todoist` / `Todoist`, id `tasks`, `/mobile/tasks`) is a side-menu entry + pinnable bottom-bar candidate. Internal chip-tab views (Today default · Tomorrow · Inbox(관리함) · **프로젝트** · **지시(받은/보낸)** · Completed(완료/기록) · Calendar); quick add + detailed create (`/new`), task detail (`/[id]`), core edit (`/[id]/edit`). Personal-by-default with shared participant tasks; task calendar is separate from the reservation calendar. 프로젝트 탭은 기능 구현 완료(2026-06-15, 첫 슬라이스); 마이그레이션 `202606150002_projects.sql` 적용 필요. User-facing naming is `Todoist`; route id remains `tasks`. See `docs/product/18-todo-task-workflow.md` and `docs/product/23-project-workflow.md`.
- **Suggestions / Feedback Box** (`제안함` / `提案箱` / `Suggestions`, id `suggestions`, `/mobile/suggestions`, `Inbox` icon) is a side-menu entry + pinnable bottom-bar candidate. Screens: list (`받은/보낸/참조` text tabs + one 「진행 중만 ⌄」 filter that opens a BottomSheet — white redesign 2026-10-15), compose (`/new`), and a **role-aware** detail (`/[id]`) — recipient gets an inline 4-button status control (hold / complete open a note BottomSheet), every participant gets the inline comment thread + composer; the old `/referenced` route now redirects to the list. **Fully wired and shippable as of 2026-06-16 (Steps 1–8):** schema + create + list + participant-only detail + comments + recipient-only status workflow + notifications, all localized ko/ja/en. Suggestion notifications use the `suggestion_activity` type, deep-link to the suggestion, and render in the live `/mobile/notifications` bell feed. See `docs/product/22-staff-suggestions-workflow.md`.
- **Attendance / 근태** (`근태` / `勤怠` / `Attendance`, id `attendance`, `/mobile/attendance`, `Clock` icon) is a side-menu entry + pinnable bottom-bar candidate. Screens: home ring-hero clock (`/mobile/attendance`, states 출근 전/근무 중/휴게 중), GPS+QR capture (`/mobile/attendance/capture?mode=in|out`), correction request + status (`/mobile/attendance/correction`), **own history (`/mobile/attendance/history`, Step 5)**, and **own monthly pay (`/mobile/attendance/pay`, Step 10)**. **Now functional (Steps 3–10, 2026-06-17/18):** real GPS+QR clock-in/out, break start/end (clock-out blocked while on break), self-scoped history, correction/exception requests, and a self hourly **expected-pay** screen. Admin review + correction approval + manual session management are already server-backed, and the active dashboard rebuild now treats their admin UI as a first-class module. The home shows 이력 + 급여 shortcut entry rows in all three states (idle / open / break), placed below the primary action buttons. (2026-06-23) Wi-Fi stays `준비중`. The design's own 5-tab bottom bar is intentionally dropped in favor of the app's global bottom nav. Finalization / dashboard / export remain dashboard work rather than mobile-primary work. See `docs/product/24-attendance-workflow.md`, `docs/product/21-attendance-payroll-workflow.md`, and `docs/product/05-admin-web-ia.md`.
- **Linen Return** (`린넨 반품` / `リネン返却` / `Linen Return`, id `linen-return`, `/mobile/linen-return`) is a side-menu entry, not a default bottom tab. It can be pinned via the bottom-bar editor (it is part of the customizable pool). Building-first flow: building picker → building list → create / detail / ledger. See `docs/product/19-linen-defect-workflow.md`.
- **Guest Feedback** (nav label `피드백` / `ゲストの声` / `Feedback`; screen title `게스트 피드백` /
  `ゲストフィードバック` / `Guest Feedback`, id `complaints`, `/mobile/complaints`) is a
  side-menu entry and a pinnable bottom-bar candidate, not a default tab. The existing mobile manual
  complaint flow is redesigned as one entry point with two distinct data views: **수동 컴플레인** and
  **외부 리뷰**. It does not add a feature-specific header, tab bar, or navigation shell.
  - **Renamed from `컴플레인` on 2026-08-11.** The screen collects Airbnb / Booking.com reviews —
    including good ones — plus the problem-room rollup, so "complaint" named only one of its three
    views. Route id, path, and the `customer_complaints` table are unchanged: this is a display-name
    change only, so bookmarks and persisted `profiles.bottom_nav_tabs` values keep working.
  - **The nav label is deliberately shorter than the screen title.** Bottom-tab labels render at
    10.5px in a ~72px column, so `게스트 피드백` / `ゲストフィードバック` would wrap and push the tab
    bar taller. The Japanese nav label stays within the 6-character ceiling set by the longest
    existing tab label (`スタッフ一覧`). "수동 컴플레인" and every other complaint-entity string
    (등록 / 삭제 / 전환) keeps the word complaint — the entity did not get renamed, the feature did.
  - **화이트 리디자인(2026-10-14)**: 목록 머리는 `FeedbackHead`(제목 · 기간 줄 · 「+ 컴플레인 등록」 · 보기 셋 세그 — 외부 리뷰 /
    수동 컴플레인 + 미처리 수 / 건물 · 객실별)로 바뀌었고 `ComplaintViewTabs` 와 떠 있는 + 버튼은 없어졌다. 리뷰 고르기는 쿼리
    (`provider` · `risk` · `building` · `rl` · `from` · `to` · `page`), 기본 기간은 최근 90일(도쿄). 상세: 25번 「화이트 리디자인」.
    아래 문단은 그 전 상태의 기록이다.
  - `/mobile/complaints`: the two views are separated before filtering via a `?view=manual|reviews`
    tab switch rendered above the list content (`ComplaintViewTabs`, plain `<Link>` tabs — no client
    state, so only the active view's data is fetched). Manual complaints keep their existing
    platform / open-resolved / building-room filters and create entry unchanged. External reviews
    (implemented 2026-08-05) apply client-side platform and problem-only chip filters plus a building
    chip derived from the fetched reviews themselves (no separate property lookup); a review-date range
    filter is implemented through `from`/`to` query parameters and shared range controls. Sort
    order (risk → lower source rating → newest) comes from `listExternalReviews` and is not
    re-sorted client-side.
  - `/mobile/complaints/new`: manual complaint registration remains available only to the existing
    write roles. The reservation-calendar `?reservationId=` prefill path remains valid.
  - `/mobile/complaints/[id]`: manual complaint detail retains status, comments and photos.
  - `/mobile/complaints/reviews/[id]` (implemented 2026-08-05): read-only external review detail
    shows the native rating and risk chip, the provider-supplied `rating_breakdown` (Airbnb
    `category_ratings[]` / Booking.com `scoring{...}`, never normalized into a common schema),
    building/room/reservation context, and linked-complaint state or a convert action. A missing room
    is shown as `객실 정보 없음` rather than hidden; Airbnb rows explicitly note the missing reservation
    id and reviewer name. Booking.com positive and negative text render as separate blocks; a
    valid score-only review shows a "score only" notice instead of an empty body and offers no
    translate button. Airbnb `private_feedback` renders in a visually distinct dashed block with a
    private badge, never mixed into the public review, and is explicitly noted as not affecting the
    rating. Booking.com's existing OTA reply shows read-only with no reply-compose UI. Translation is
    a single "view translation" toggle per review (not per paragraph) that reuses any already-cached
    parts and only calls `translateReviewPartAction` for the still-missing ones on demand; it never
    runs from the list. Converting a review into a manual complaint opens the canonical `BottomSheet`
    with a title/description form; the button is gated by the same write roles as manual complaint
    creation and the server re-checks the role and the review's organization.
  - The external-review view surfaces period rating summaries by building/room in the mobile
    `?view=rooms` board, using the same `summarizeReviewsByPlace` function as the admin console.
  - Any active organization member may read external reviews. Only existing complaint-write roles can
    create a linked manual complaint; this is not automatic even for risky ratings. The mobile screen
    uses the existing shared sheet/edge-swipe/scroll contracts — no new bottom-sheet shell.
  - Mobile is a field-oriented view of the **same organization data source** used by
    `/admin/complaints`; it does not maintain a mobile-only complaint/review list. Manual registration,
    comments, status changes, review-to-complaint links and cached translations created on either
    surface are visible on the other surface under the same permissions.
  - Full domain contract: `docs/product/25-complaint-workflow.md`.

Implementation note:

- The mobile navigation contract is implemented in `src/config/navigation.ts`.
- The initial mobile shell is implemented in `src/components/shell/mobile-shell.tsx`.
- Any future mobile screen should reuse this navigation contract instead of redefining tabs locally.
- Navigation labels are localized through `src/lib/i18n.ts` and `src/config/navigation.ts`.
- **뒤로가기 — 화면 스와이프 (2026-10-08, 사용자 지시 · 01번 결정 로그).** 모바일 화면은 좌상단 뒤로가기 버튼을
  그리지 않는다(2026-06-15 결정 유지). 뒤로 가기는 **화면 어디서든 오른쪽으로 미는 제스처**가 맡는다 — 인스타그램 · iOS 26 의
  화면 전체 뒤로 스와이프와 같은 방식. 가장자리에서만이 아니다.

  **동작.** 손가락을 따라 지금 화면이 밀리고(그림자), 아래에서 **이전 화면이 30% 뒤에서 따라 들어오며 어둠이 걷힌다**(iOS
  내비게이션 전환). 놓을 때 판 폭의 35%(**최대 220px** — 태블릿 가로에서 326px 를 끌어야 했다)를 넘겼거나 오른쪽으로 빠르게
  튕겼으면 이전 화면으로, 아니면 제자리로. 이동한 새 화면은 전환 애니메이션 없이 그 자리에 나타난다(두 번 미끄러지지 않게).
  **다듬기 (2026-10-20, 사용자 지시 「인스타처럼 자연스럽게」 · 점검 측정 후):**
  - **둥근 판** — 미는 동안 판 모서리를 화면 모서리처럼 둥글게(인스타그램). 반경은 `--screen-corner` 가 있으면 그 값, 없으면
    아이폰은 화면 크기 · 배율로 기종별 값(2026-10-22 `iphoneScreenCorner` — 홈 버튼 기종 0, X~17 39~62px, 모르는 기종 44) · 그 밖 28px
    (웹은 기기 곡률을 못 읽어 표로 둔다). 아래 이전 화면도 같은 반경으로 잘린다. 쉬는 동안엔 각진 판.
  - **놓은 뒤 손가락 속도 이어받기** — 전에는 140~320ms 에 시작이 가파른 곡선이라 놓는 첫 프레임에 화면이 손가락보다 약 25배
    빨리 튀었다(측정: 0.18px/ms → 77px). 이제 곡선 시작 기울기를 손가락 속도에 맞추고(멈춘 채 놓으면 0.3px/ms 로 출발) 220~380ms
    에 부드럽게 멈춘다(`settleMotion`). iOS · Ionic(`swipe-back.ts`)과 같은 원리.
  - **이동을 조금 일찍** — 넘어가는 움직임이 96% 진행됐을 때 이동을 시작한다. 끝난 뒤에 시작하면 새 화면을 그리는 동안(저가 폰
    300ms) 그림만 있는 화면이 눌리지 않았다.
  **120Hz 점검 (2026-10-21, 사용자 「아이폰 홈 화면 추가에서 120Hz 보다 60Hz 보는 느낌」):**
  - **원인** — iOS Safari · 홈 화면 PWA(그리고 앱 WebView)는 기본값으로 JS 가 그리는 움직임을 60Hz 로 돌린다(스크롤은 시스템이 그려 120Hz).
    손가락을 따라가는 동안은 JS 가 매 프레임 그리므로 60Hz — **웹에서는 끌 수 없다.** 미는 동안 계산 자체는 가볍다(CPU 4배 감속 실측
    약 170프레임 중 늦은 프레임 1~3개).
  - **판은 `transform` 으로 민다**(전엔 `translate` 속성) — 놓은 뒤의 움직임은 CSS 전환이라 시스템 합성기가 돌릴 수 있는데, 합성기 가속이
    확실한 `transform` 으로 바꿨다. 도착 직전 새 화면을 그리느라 메인 스레드가 바빠도(실측 4배 감속 64~93ms) 움직임은 끊기지 않는다.
    판의 원래 `transform`(당겨서 새로고침의 `translateY`) · `transition` · `will-change` 는 시작 때 기억해 뒤에 이어 붙이고, 끝나면 전환을 끈 채
    돌려놓는다(원래 420ms 전환이 헛돌지 않게).
  - **미는 동안 다시 복제 안 함** — 엔진이 당겨서 새로고침 띠(`[data-ptr-indicator]`)를 숨기는 것을 「내용이 바뀜」으로 세어, 놓은 뒤 움직임
    한가운데서 복제가 메인 스레드를 잡았다. 이제 그 스타일 변경은 세지 않는다(`snapshot-store.ts`).
  - **앱(iOS)** — `Info.plist` 에 `CADisableMinimumFrameDurationOnPhone`(ProMotion 아이폰에서 앱 애니메이션 60Hz 제한 해제). 새 앱 빌드부터.
  - **남은 것** — 손가락을 따라가는 동안의 60Hz 는 그대로다. 그래도 거슬리면 미는 동작을 가로 스크롤(시스템이 그려 120Hz)로 바꾸는 시험판을
    따로 만들어 비교한다(큰 변경). 드래그 첫 프레임(밑그림 드러내기, 4배 감속 22ms ≈ 실기기 5ms)은 한 프레임 안이라 두었다.
  - **손가락에 붙기** — 방향 판정(10px) 동안 판은 멈춰 있는데 그 거리를 계속 빼서 판이 손가락보다 늘 10px 늦었다. 이제 다음 48px
    동안 조금씩 따라잡는다(`followOffset`, 튀지 않음).
  - 폰: 화면 전체(상단 바 · 탭 바 포함)가 움직인다.
  - 폴드 · 태블릿: 레일 · 사이드바는 제자리, **오른쪽 본문만** 움직이고 이전 화면도 그 칸 안에만 보인다(아이패드 앱처럼).
  - **예외 — 화면 전체를 덮는 위층 화면**(사진 뷰어 · 출근 QR 스캔, 2026-10-13): 셸 밖 `<body>` 에 떠서 스와이프가 닿지 않으므로 `data-native-back-overlay` 를 달고 **왼쪽 위 ×** · Esc · 안드로이드 뒤로가기로 닫는다.
  - 2분할 칸 안(`html[data-pane]`)과, 태블릿에서 오른쪽 칸이 열려 있는 동안은 받지 않는다(칸의 이동이 같은 history 에 섞인다).

  **어디서 받나.** 모든 `/mobile` 화면 — **메뉴 첫 화면(홈 · 청소 · 요청 …)도 받는다**(2026-10-09 사용자 결정 「돌아갈 곳이 있으면 다
  받기」). 처음엔 메뉴 첫 화면을 「뒤가 없는 화면」으로 막았는데(`SWIPE_BACK_ROOTS`, 삭제), 사용자가 머무는 화면 대부분이 메뉴 첫
  화면이라 아이폰에서 「안 되는 화면이 더 많다」가 됐고, Android 뒤로가기 버튼은 거기서도 이전 화면으로 가서 기기마다 달랐다.
  **모바일 셸로 그려지는 계정 화면(`/account?mode=mobile`)도 받는다**(2026-10-23 버그 수정 — 주소가 `/mobile` 밖이라 가운데에서 밀면
  반응이 없고 가장자리 OS 제스처만 됐다. 시작 판정 `canStartSwipeBack`, 셸 없는 `/account/id-card` 는 제외).
  돌아갈 곳이 `/mobile` 밖(로그인 · 온보딩 · 계정)이면 받지 않는다(`isSwipeBackScreen` 을 갈 곳에도 적용). 갈 곳은
  「pathname 이 다른 가장 가까운 이전 기록」이다 — 같은 화면 안의 쿼리 이동(`?tab=` · `?month=`)은 화면이 아니므로 건너뛴다.
  앱 안 이전 기록이 없으면(알림 · 새 탭으로 바로 들어온 경우) **위 화면으로 간다**(2026-10-20 — 뒤로 버튼이 없는 앱이라 전에는
  갇혔다): 주소를 한 칸씩 올라가 처음 만나는 실제 화면(`parentScreen` · `mobile-screens.ts`), 상세 → 목록 → 메뉴 첫 화면 → 홈.
  기록을 바꿔치기(`router.replace`)한다. 홈에서는 갈 곳이 없어 받지 않는다. Android 뒤로가기 버튼도 같은 규칙이다.

  **우선순위(iOS 26 과 같은 규칙).**
  1. 열린 시트 · 대화상자 · 사이드 메뉴 · 사진 뷰어가 있으면 받지 않는다(`hasOpenOverlay` — Android 뒤로가기 버튼과 같은 판정).
  2. `[data-swipe-back="off"]` 안, 입력칸 · 선택 · 편집 영역, 슬라이더 위에서는 받지 않는다.
  3. 가로 스크롤 영역이 **왼쪽으로 더 갈 수 있으면** 스크롤이 먼저, 왼쪽 끝에 닿아 있으면 뒤로가기.
  4. 첫 10px 이 세로이거나 왼쪽이면 그 터치는 끝까지 스크롤 몫(약 40° 안쪽의 오른쪽 이동만 뒤로가기).
  5. **입력을 시작한 화면(작성 · 수정 폼)은 받지 않는다** — 실수로 밀어 쓰던 내용을 잃지 않게. 그런 화면은 OS 뒤로가기만.
     검색칸(`type="search"` · `role="search"` 안) · 체크 · 라디오 · 선택은 쓰던 내용이 아니므로 세지 않는다(2026-10-20 — 투두 ·
     직원 목록 · 분실물 보관함 · 객실 링크 · 프로젝트 검색에 한 번 치면 그 화면 스와이프가 꺼졌다). 새 검색칸은 `type="search"` 로.
  6. iOS Safari **탭**에서는 왼쪽 24px 를 Safari 의 가장자리 뒤로가기에 비켜 준다. 설치한 PWA · 앱은 가장자리도 우리가 받는다.

  **새 화면 · 컴포넌트 규칙.** 자체 가로 제스처(밀어서 삭제 줄, 캐러셀, 끌어 고르는 격자, 순서 바꾸기 손잡이)를 만들면
  그 요소에 `data-swipe-back="off"` 를 단다 — 밀어서 여는 줄은 **열려 있을 때만**(닫힌 줄을 오른쪽으로 밀면 뒤로가기).
  지금 붙은 곳: 알림 밀어서 읽음 · 지우기 줄(열렸거나 미는 중일 때 — 2026-10-15) · 연차 초안 밀어서 삭제 줄(열렸을 때), 투두 카드(열렸을 때) · 순서 손잡이 · 섹션 손잡이, 예약 캘린더 ·
  판매 캘린더 격자. 몸통이 `<body>` 로 포털되는 시트 · 뷰어는 애초에 판 밖이라 표식이 필요 없다. 새 전체 화면 오버레이는
  Esc 로 닫히게 하고 `role="dialog"` 나 `data-native-back-overlay` 를 붙인다(위 1번 · Android 뒤로가기 버튼이 함께 쓴다).

  **구현** (`src/lib/swipe-back/*`, 셸 연결은 `MobileShell`):
  - `history-tracker.ts` — `pushState` · `replaceState` 를 감싸 **기록마다 번호(`history.state.__so`)** 를 붙이고, 번호 → 주소 표를
    sessionStorage 에 둔다. 뒤로 · 앞으로(popstate)는 번호로 방향을 정확히 안다. Next 가 매 렌더 state 를 갈아 써도 래퍼가 번호를
    다시 붙인다. 루트 레이아웃의 `HistoryTrackerBoot` 가 켠다.
  - `snapshot-store.ts` — 「아래에 깔리는 이전 화면」. Next 는 이동하면 이전 화면을 없애므로 **화면의 보이는 부분을 DOM 으로
    복제**해 기록 번호별로 둔다(메모리 최근 5개). 맡긴 복제본은 한가할 때 HTML 로 **sessionStorage 에도**(최근 10개 · 사용자별 ·
    한 화면 60만 자 이하) 두어, 새로고침 · 앱 재시작 뒤나 5단계보다 깊이 갔다 돌아와도 아래에 이전 화면이 깔린다(전에는 빈 회색 판).
    스크롤 위치는 복제본 요소의 `data-sb-scroll` 에 적어 HTML 로 되살려도 맞춘다. 이미지가 아니라 같은 DOM · CSS 라 선명하고 네이티브 빌드가 필요 없다. 화면 밖 요소는
    같은 크기의 빈 칸으로(연달아 밖인 형제는 칸 하나로) 바꿔 노드 1만 2천 개 화면도 350개 남짓이 된다. 복제는 **한가할 때 미리**
    (화면이 뜬 뒤 · 스크롤 · 내용이 바뀐 뒤) 하고, 떠날 때는 맡기기만 한다 — 떠나는 커밋 안에서 복제하면 반쯤 바뀐 DOM 을 통째로
    다시 배치해 긴 목록에서 200ms 가 들었다(CPU 4배 감속 측정, 미리 복제로 5~35ms). id 는 지운다.
    **개인정보 · 다시 찍기 (2026-10-26)**: 복제본엔 게스트 이름 · 연락처 같은 화면 내용이 그대로 들어 있다 — 로그아웃 버튼(사이드바 ·
    계정 화면 `<form action={signOut} onSubmit={clearSwipeSnapshots}>`)이 메모리 · sessionStorage(`stayops:swipe-snapshots`)를 비우고
    다음 화면을 잡을 때까지 새로 저장하지 않는다(떠나는 화면의 마지막 맡김 포함). 다른 사용자가 화면을 잡으면(`trackScreen` 의 사용자
    바뀜) 앞 사용자 것을 모두 버린다. **`data-no-snapshot`** 이 붙은 요소는 속 · 속성을 복제하지 않고 같은 크기 빈 칸으로 둔다(민감한 칸
    opt-out). **`data-snapshot-ignore`** 안의 변화는 「내용 바뀜」으로 세지 않는다 — 홈 경과 시계(1초마다)와 당겨서 새로고침 띠에
    붙였다. 전엔 시계가 바뀔 때마다 1.5초 간격으로 화면 전체를 다시 복제했다.
  - `controller.ts` — 제스처 엔진. React 밖에서 판(`[data-swipe-surface]`)에 `transform` 을 직접 써서(2026-10-21 전엔 `translate`) 미는 동안 렌더 0회. 밑그림
    층은 `body` 맨 끝 `position: fixed; z-index: -1; contain: strict` 로 **한가할 때 미리 깔아 두고**(보이지 않게) 밀 때 보이게만 한다
    (드래그 시작 1ms). 미는 동안만 `<main>` · `<body>` 바탕을 투명하게 해 판 뒤로 이 층이 보인다. 이동은 `history.go(-n)`, 옛 판이
    DOM 에서 빠지는 순간(MutationObserver — 그리기 전) 층을 걷는다. 4초 안에 이동이 안 되면 제자리로.
    **당겨서 새로고침 중엔 시작하지 않는다 (2026-10-26)**: 판의 `transform` 을 PTR 이 쥐고 있는 동안(당기는 중 · 새로고침 중 · 띠가
    남은 동안) 셸이 판에 `data-ptr-active` 를 달고 `canBegin` 이 거절한다. 전엔 새로고침 중에 밀면 끝날 때 그때의 transform 을 되돌려
    놓아 판이 내려간 채 멈출 수 있었다.
  - **iOS(WebKit) 팬 선점 (2026-10-08 `c5cdf12`)**: iOS 는 방향 판정(10px) 전에 스크롤 팬을 시작해, 그 뒤 touchmove 를 막을 수 없어
    아이폰에서 제스처가 통째로 무시됐다(Chromium 은 `touch-action` 이 막아 재현 안 됨). 판정 전이라도 오른쪽으로 뚜렷이 가로인 움직임
    (dx > 1.5|dy|)이면 첫 touchmove 부터 막고, 막을 수 없는 touchmove 여도 가로로 잠갔으면 계속 간다.
  - **실기기 진단 표시 (2026-10-09, `src/lib/swipe-back/debug.ts`)**: 홈 화면 앱 · 앱 셸에는 주소창이 없어, **세 손가락으로 한 번
    탭**하면 켜고 끈다(그 기기 localStorage `stayops:swipe-debug`). 화면 위에 빌드(`NEXT_PUBLIC_BUILD_SHA` — Vercel 커밋 앞 7자리) ·
    standalone 여부 · 기록 번호 · 돌아갈 곳 · 최근 터치 8개를 왜 받았는지/안 받았는지(메뉴 첫 화면 · 열린 시트 · 막힌 대상 · 갈 곳 없음 · 앱 밖으로 나감 ·
    판정 전 놓음 · 세로로 거절 · 막을 수 없는 touchmove · 놓을 때 거리/속도)를 띄운다. 개발자용이라 번역하지 않는다. 꺼져 있으면 비용 0.
    홈 화면 앱은 SW 가 HTML 을 stale-while-revalidate 로 내준다. 2026-10-19 부터 옛 배포의 저장본은 그리지 않지만, 이름표 확인이 1.5초를 넘기면(느린 망) 옛 빌드가 뜰 수 있어 빌드 표시로 먼저 확인한다.
  - 순수 판정(`history-model.ts` — 갈 곳 · 위 화면 · 방향 잠금 · 따라잡기 · 놓을 때 판정 · 마무리 곡선)은
    `src/lib/__tests__/swipe-back.test.ts`. 화면 목록(`mobile-screens.ts`)이 `src/app/mobile` 과 다르면 테스트가 실패한다.
  - 셸: 스크롤 영역에 `touch-action: pan-y pinch-zoom`(가로 이동은 브라우저가 쓰지 않아 touchmove 를 언제나 막을 수 있다), 스크롤
    위치 복원을 `useLayoutEffect` 로(첫 프레임부터 밑그림과 같은 자리).

  **전환 방향(`src/lib/nav-direction.ts`) 고침.** 2026-10-08 전까지는 「뒤로」를 세우는 코드가 없어 **모든 뒤로가기가 앞으로 미는
  애니메이션**을 틀었다. 이제 popstate 를 기록 번호로 판정해 OS 뒤로가기 · Android 뒤로가기 버튼은 `screen-pop`, 화면 스와이프와
  브라우저가 이미 애니메이션한 경우(`PopStateEvent.hasUAVisualTransition` — Safari 가장자리 스와이프)는 애니메이션 없음. 전환 클래스는
  끝나면 뗀다(`animation-fill-mode: both` 가 남긴 transform 이 화면 내내 쌓임 맥락 · 고정 위치 기준이 되던 것). 템플릿은 `/mobile`
  아래 첫 구획이 바뀔 때만 다시 그려지므로 같은 구획 안 이동에는 원래 전환이 없다.

  **남긴 것:** 특정 출발점으로 돌아가는 워크플로 버튼(오류 상태의 유일한 탈출구이기도 하다 — 예: 수리 / 분실물의 「청소로
  돌아가기」 → `/mobile/cleaning`), 뒤로가기가 아닌 chevron(캘린더 월 이동, 사진 캐러셀, 날짜 선택기). 어드민 웹은 뒤로가기 버튼을
  유지한다(데스크톱에는 터치 스와이프가 없다).

  **앱(Capacitor) Android 하드웨어 뒤로가기 (2026-10-06):** `NativeShellBridge` 가 받는다. 열린 오버레이가 있으면(`hasOpenOverlay` —
  밑그림 복제본 속 표식은 세지 않는다) window 에 Esc 를 보내 닫고(BottomSheet · 사진 뷰어 · 사이드 메뉴가 이미 Esc 로 닫힌다), 없으면
  `history.back()`, 앱 안 이전 기록이 없으면 위 화면(`parentScreen`, 2026-10-20), 홈이면 앱 최소화. **2026-10-26**: **홈(`/mobile`)에서는** `history.back()` 을
  이전 기록이 앱 안 화면(`isSwipeBackScreen`)일 때만 — WebView 기록에 남은 로그인 · 온보딩 · 외부 페이지로 돌아가던 것을 막고 앱을 내린다.
  홈 밖의 `/mobile` 밖 앱 화면(계정 `/account/id-card` 등)은 예전처럼 기록 뒤로(막으면 재류카드 화면에서 뒤로 = 앱이 내려갔다). Esc 를 안 받는 대화상자에서 막히지 않게 1.2초 안에 다시 누르면 화면 이동. 셸 쪽 표식 —
  사이드 메뉴 `<aside>` 가 열려 있을 때 `data-native-back-overlay`, `ImageLightbox` 루트에 같은 표식.
  **사진 뷰어 접근성 · Esc (2026-10-26)**: `ImageLightbox` 루트는 `role="dialog"` · `aria-modal` · `aria-label`(`common.lightboxDialog`), 이전 · 다음 ·
  점 버튼은 `common.lightboxPrev` · `lightboxNext` · `lightboxGoTo`(「사진 {index} / {total}」, 지금 사진은 `aria-current`) — 전엔 「←」 「→」 「1」 그대로
  읽혔다. Esc 는 **맨 위 오버레이일 때만** 닫는다 — `BottomSheet` 의 열린 시트 쌓임을 `pushOverlay` · `isTopOverlay` 로 내보내 뷰어도 같이 쓴다.
  전엔 시트 안에서 연 뷰어에서 Esc(= Android 뒤로) 한 번에 뷰어와 시트가 함께 닫혔다.

  **Android 예측 뒤로가기 (2026-10-20, 17번 N12).** Android 는 화면 양쪽 가장자리 밀기를 OS 가 먼저 가져간다 — 구글 지침상 앱이
  가로채면 안 되고 가로챌 수 있는 길이도 한쪽 200dp 뿐이라, 가장자리를 우리 터치로 받지 않는다. 대신 OS 가 알려 주는 제스처의
  시작 · 진행(손가락 위치) · 취소 · 확정을 **같은 엔진에 손가락 대신 넣는다** — 가장자리에서 밀어도 지금 화면이 손가락을 따라
  밀리고 아래에 이전 화면이 보이며, 놓으면 같은 마무리(손가락 속도 이어받기 · 둥근 판)로 넘어간다. 오른쪽 가장자리에서 밀면 거울처럼
  판이 왼쪽으로. 화면 가운데에서 미는 것은 그대로 웹 터치.
  - 네이티브: `android/.../PredictiveBackPlugin.java`(MainActivity 가 등록) — `OnBackPressedCallback` 의 `handleOnBackStarted` ·
    `Progressed` · `Cancelled` · `Pressed` 를 웹 이벤트로. 매니페스트 `enableOnBackInvokedCallback="true"`.
  - 웹: `src/lib/swipe-back/native-predictive-back.ts` → `getExternalBackGesture()`(엔진의 begin · move · cancel · commit).
  - **켜고 끄기**: OS 는 제스처가 시작되기 전에 누가 받을지 정한다. 그래서 「뒤로 갈 곳이 있는가」(`wantsBack` — 열린 시트, 앱 안
    이전 화면, 위 화면)를 이동 · 시트 열림/닫힘마다 미리 알린다. 갈 곳이 없으면(홈) 꺼 두어 **OS 기본 — 홈 화면으로 나가는 미리보기**가
    나온다. 그래서 Capacitor App 플러그인의 뒤로 처리는 끈다(`capacitor.config.ts` `App.disableBackButtonHandler` — 늘 가로채서 OS
    미리보기를 막았다).
  - 미리보기 없이 확정되는 뒤로(3버튼 내비게이션 버튼, 열린 시트, 입력 중인 화면, 2분할 칸)는 위 하드웨어 뒤로가기와 같은 순서로 처리.
  - 옛 앱 빌드(플러그인 없음)는 설정도 옛것이라 `backButton` 으로 예전처럼 동작한다.

  **남은 일(앱 출시 계획 17번 N12).** iOS 앱 · Android 앱 · 설치한 PWA 실기기 손맛 확인.

  <details><summary>과거 서술 — 2026-09-11 「직접 구현하지 않는다」 결정과 그 전의 엣지 스와이프 (코드에 없음)</summary>

  2026-09-11: 「뒤로 가기는 OS·브라우저가 제공하는 엣지 스와이프가 담당한다. 네이티브 제스처 위에 자체 구현을 얹으면 두 번 뒤로
  가거나 가로 스크롤과 싸운다 — `mobile-calendar-view.tsx` 주석: 「왼쪽 가장자리에서 시작한 가로 스크롤이 `router.back()` 을
  발동시키곤 했다」.」 2026-10-08 에 사용자 지시로 뒤집었다 — 가장자리 · 가로 스크롤 충돌은 위 우선순위(가장자리 비켜 주기, 가로
  스크롤 먼저, 방향 잠금)로 막는다. 또 iOS 앱(WKWebView)은 `allowsBackForwardNavigationGestures` 가 꺼져 있어 **OS 가장자리
  제스처조차 없었다**.

  2026-06-15 ~ 2026-09-11 문서는 「`MobileShell` 이 `<main>` 에서 `handleSwipeStart` / `handleSwipeMove` / `handleSwipeEnd` /
  `handleSwipeCancel` 로 처리하고, 왼쪽 ~30px 에서 시작한 드래그가 좌측 그라데이션 그림자와 chevron 힌트를 띄우며, ~64px 을 넘겨
  놓으면 `router.back()`, 오른쪽 엣지는 `router.forward()`. 2026-06-22 에 `goBack()` 이 `window.history.length <= 1` 이면
  `router.push("/mobile")` 로 대신한다」고 적고 있었으나, 2026-09-11 전수 확인 결과 그 코드는 없었다. 아래 「Edge-back zero-render
  hint」 · 「PTR / edge-swipe mutual exclusion」 · 「navigatingRef」 · 「Springback animation fix」 · 「nav-direction TTL」 항목도 같은
  사라진 구현의 기록이다(이력으로 남긴다).

  </details>

  **Touch-gesture render throttle (2026-06-22):** the visual state updates from `touchmove` — the
  pull-to-refresh pull distance — are **coalesced to one `setState` per animation frame** (rAF),
  while the underlying ref (`pullDistanceRef`) still updates synchronously on every sample.
  (원문은 엣지 백의 `edgeDx` / `edgeRawDxRef` 도 함께 적었으나, 그 구현은 코드에 없다 — 위 참고.) This stops a full subtree re-render firing at the device's
  ~120Hz touch rate, keeping scroll / pull / edge-drag smooth on high-refresh-rate devices; thresholds
  and spring-back behavior are unchanged.
  **PTR start-at-top gate (2026-06-22):** pull-to-refresh only arms when the gesture **started at the
  top** of the scroll area (`scrollTop ≤ 0` on `touchstart`, tracked by `ptrEligibleRef`). A gesture
  that reaches the top via momentum decay or rubber-band rebound — or any touch that began while
  `scrollTop > 0` — does **not** activate PTR; the touch anchor is re-captured on those frames so a
  later coast back to 0 can't compute a huge stale `deltaY` and snap the content down. PTR becomes
  eligible again only after the user lifts and re-touches at the top. Clean top-of-page pulls behave
  exactly as before.
  **Edge-back zero-render hint (2026-06-22):** the left-edge back gradient + chevron intensity is no
  longer React state — `handleSwipeMove` writes a `--edge-progress` (0..1) CSS custom property straight
  to the hint DOM node (`edgeHintRef`), and the inline styles derive opacity + chevron translate from it
  via `calc()`. The drag therefore re-renders **nothing** mid-gesture (only the start/end `edgeDragging`
  flip, which toggles the spring transition, renders). Opacity ramp, ~64px commit threshold, spring-back,
  and right-edge forward fling are visually identical to before.
  **PTR / edge-swipe mutual exclusion (2026-06-23):** the two gesture systems now gate each other.
  If PTR (`isPullingRef.current`) is active when `handleSwipeStart` fires, `edgeCandidateRef` stays
  false — the edge-back gesture is not armed. Conversely, if `edgeLockedRef.current` is true,
  `handleTouchMove` (PTR) returns early — the horizontal edge drag owns the gesture. `handleSwipeMove`
  also bails when `isPullingRef.current` is true. This prevents a diagonal top-left touch from
  simultaneously activating both subsystems.
  **navigatingRef — post-goBack() stale event guard (2026-06-23):** `goBack()` sets
  `navigatingRef.current = true`; the next `handleSwipeStart` resets it to false. Any `handleSwipeMove`
  arriving after `goBack()` fires (but before the new page mounts) is dropped, preventing a stale
  `edgeLockedRef` state from processing phantom events after a fast fling.
  **Springback animation fix (2026-06-23):** `endEdgeDrag(false)` defers `writeEdgeProgress(0)`
  by one `requestAnimationFrame` when not committing, so React can paint the CSS transition change
  (`transition:none → opacity 380ms ease`) before the hint intensity is zeroed — the gradient fades
  out smoothly instead of snapping away.
  **nav-direction TTL 1200ms→400ms (2026-06-23):** the "back" flag in `nav-direction.ts` now expires
  after 400ms (was 1200ms). The mobile template mounts within ~100ms; the longer window allowed a
  stale "back" to mis-animate the next forward navigation as a pop when `goBack()` routed outside
  `/mobile/` (e.g. to `/account`).
  **Notifications page wrapped (2026-06-23):** `/mobile/notifications` now uses `MobileShell` so
  the left-edge swipe-back gesture is available on the notifications screen.
  **Option B — full-screen pull-to-refresh (2026-06-24):** The PTR indicator is now a `position:fixed`
  panel at the very top of the viewport (`z-[58]`, `bg-background`, height = `safe-area-inset-top +
  52px`). The outer shell wrapper div (header + content + bottom nav combined) carries a
  `translateY(${contentOffset}px)` so the entire chrome slides down together as the user pulls,
  gradually revealing the fixed indicator behind. The inner scroll div no longer holds a `translateY`
  or any inline PTR indicator/gradient curtain. Haptic feedback fires once at the pull threshold
  crossing and once when the refresh starts — both `haptic("light")` (2026-10-26: was a raw
  `navigator.vibrate(10)` + `medium`, which skipped the native haptics bridge and broke the shared haptics rule). On release, the outer shell springs back with
  `cubic-bezier(0.34,1.56,0.64,1)` while the indicator fades/scales out.
  **로고 막대 표시(2026-10-15, 시안 Motion-C-Pull-Phone — 모든 `/mobile/*` 공용):** 위 패널의 글자(「놓아서 새로고침」 ·
  「새로고침 중…」)를 로고 세 막대로 바꿨다. 당긴 거리 ÷ 72px 에 따라 위(연보라) → 가운데(보라) → 아래(진보라) 순서로
  하나씩 나타나고(흐림 + 가로로 펴짐), 72px 을 넘어 다 모이면 묶음이 살짝 커졌다 돌아오며(「딸깍」) 진동 10ms. 놓으면
  새로고침이 끝날 때까지 공용 로더(`FoldyLoader`)와 같은 엇갈린 숨 쉬기, 끝나면 흐려지며 사라진다. 막대 묶음은 로더의
  0.8배 크기로 벌어진 틈의 가운데에 놓인다. 글자는 화면 읽기 프로그램용(`sr-only`, aria-live)으로만 남김. 스타일
  `src/components/shell/pull-refresh.css`, 줄인 움직임이면 딸깍 · 숨 쉬기 없음.
  **PC 「모바일 보기」(2026-10-15):** 미리보기 iframe 안(`window.self !== window.top`, 태블릿 칸 `data-pane` 제외)에서는 마우스로 끌어내려도 같은
  당겨서 새로고침이 된다 — 마우스 포인터를 손가락과 같은 처리(`handleTouchStart/Move/End`)로 넘김. 끌어내린 뒤 손을 뗀 자리의 링크는 열리지 않는다.
  진짜 폰 · 태블릿(터치)은 그대로.
- **`hideBottomNav` (2026-06-15):** `MobileShell` accepts an opt-in `hideBottomNav` prop (default
  `false`) that hides the bottom tab bar for focused **registration / create-edit** flows, so the
  screen reads as a dedicated form (and a sticky submit bar can't overlap the tab bar). Applied to the
  Requests-feature create pages — maintenance (`/mobile/maintenance/new`), lost & found
  (`/mobile/lost-found/new`), order request (`/mobile/orders/new`, also `/mobile/requests/orders/new`)
  — and linen-return create/edit. When set, the content's bottom padding shrinks since there is no tab
  bar to clear; every feature is still reachable from the side menu. Use sparingly — the default
  tabbed shell remains the norm.

Bottom-bar labels (left 2 / center FAB / right 2):

```txt
ko:  홈    캘린더    [ ✎ 편집 ]    요청    공지
ja:  ホーム カレンダー [ ✎ 編集 ]   リクエスト お知らせ
en:  Home  Calendar  [ ✎ Edit ]    Requests  Announcements
```

Cleaning (청소 / 清掃 / Cleaning) is reached from the side menu, not the bottom bar.
## Tab Responsibilities

## Home

Purpose:

- Show today's most important operational information and quick actions.

### Design (Haru Ops home redesign, 2026-06-17)

The home screen was fully re-skinned to the "Haru Ops · 홈 (빠른 출근)" / v2 design.
All previous functionality is preserved; only the layout/visual style changed.

- Scoped styles live in `src/components/mobile/home-screen.css` (every selector is
  prefixed with `.hm` so it never leaks into other screens). The page markup is in
  `src/app/mobile/page.tsx` and still does all server-side data fetching.
- The warm ivory chrome contract is unchanged: cards/sheets stay cream/white, the
  brand accent stays deep ink navy.

3D hero image:

- The design's top **3D hero image** (a wireframe orb/sphere) is **intentionally not
  used** on the live home for now. The asset is preserved at
  `src/assets/home-hero-3d.svg` (do not delete) so the 3D hero can be re-enabled later.
- The previous Lottie top hero (`HomeHeroAnimation` + `src/assets/home-hero-top-v2.json`)
  is no longer rendered on the home but remains in the repo for possible reuse.

Home includes (top → bottom):

1. **Greeting** — Tokyo-dated line + "{name} 님, 안녕하세요" + avatar initial.
2. **Last updated** — auto-refreshing JST `HH:MM` clock.
3. **Quick clock-in hero** — static "출근 전 / 대기" card with a 출근 button and
   `GPS+QR` / `Wi-Fi 준비중` method chips. The card now reflects the **real attendance state**
   (idle vs working vs on-break) from the current open session and still opens `/mobile/attendance`.
   (The shortcut reflects the real attendance state and opens the implemented QR/GPS attendance flow.)
4. **Important announcement** — only the latest important announcement, links to its detail.
5. **오늘 현황** — today check-in / check-out counts. **Each count card is tappable**:
   it opens a bottom sheet listing that day's reservations (guest name · localized
   building·room · channel/source), drag-to-dismiss like the app's other sheets.
   Data: `getHomeCheckInOutReservations` (`src/lib/home.ts`) — today's reservations
   (Tokyo operating day, cancelled/no-show excluded); the sheet UI is
   `src/components/mobile/home-checkinout.tsx`. Empty state per direction.
   **Room-label mapping (2026-06-18):** the building·room label is resolved through the
   **same canonical + display path as the reservation calendar** (room catalog +
   `resolveReservationCanonicalRoomLabel` + `getDisplayRoomLabel`), so 2-account rooms
   (e.g. `501`/`501_2`, `803#`/`K803`) collapse to one display label and unmapped/inactive
   rooms drop (authoritative). The count = the resolved list length, so it tracks the
   calendar's active-room axis. See `docs/product/15-reservation-calendar.md` → 2026-06-18.
   **건물별 묶음 (2026-10-22):** 시트 목록은 건물 머리줄(건물 이름 · 건수) 아래에 그 건물의 줄이
   이어진다 — 줄은 객실 번호 · 손님 · 채널. 건물 순서는 판매 캘린더와 같은 운영 순서
   (`CALENDAR_BUILDING_ORDER`), 건물 안은 객실 번호순. 묶는 규칙은 어드민 대시보드 홈과 공용
   (`groupByBuilding`, `src/lib/home-reservation-groups.ts`). 머리줄은 글자만 — 구분선 · 왼쪽 막대 없음.
6. **진행 중 작업** — active cleaning task card (room/label + live elapsed timer), or a plain
   "진행 중인 작업 없음" empty card. (The empty-state "청소 시작하기" CTA was removed 2026-06-17 —
   the cleaning shortcut already lives in 빠른 실행, so the CTA was redundant.)
7. **빠른 실행** — quick-action grid. Four existing actions only: 청소, 정비, 분실물, 주문.
   (Clock-in is intentionally **not** duplicated here — it already lives in the hero above.)
8. **오늘 기록** — today's activity records, rendered as a log-style card. The empty state is a
   plain "오늘 기록이 없습니다" message (the cleaning-specific "첫 청소 시작하기" CTA was removed
   2026-06-17 — this feed is meant to log ANY user action, not just cleaning).
   **Currently recorded** (`getHomeTodayActivity`): cleaning completion (`cleaning_sessions`),
   maintenance report (`maintenance_reports`), lost-item report (`lost_items`), **비품 주문 / order
   request (`order_requests`)** and **린넨 반품 / linen return (`linen_return_records`)** — the last two
   added 2026-06-17.
   **Still not recorded** (by product choice for now): 제안함 (staff suggestions), 할일 (tasks),
   cleaning *start* (only completion logs today), attendance.

Quick actions (unchanged set):

- Start cleaning (`/mobile/cleaning`)
- Register maintenance issue (`/mobile/maintenance/new`)
- Register lost item (`/mobile/lost-found/new`)
- Create order request (`/mobile/orders/new`)

Today's activity records:

- Automatically created from user actions.
- Cleaning start records are added automatically.
- Cleaning completion records are added automatically.
- Other user-created records, such as maintenance/lost item/order request, can also appear if useful.
- This is not a separate manual todo list in the MVP.

Access to My Profile and the User Directory remains via the side menu (unchanged).

## Calendar

Purpose:

- Show reservation and availability information from Beds24.

Includes:

- Building picker entry screen before a property-specific calendar is opened
- Monthly reservation calendar
- Today check-in
- Today check-out
- Staying today
- Empty today
- Earliest empty availability list

Current entry behavior:

- Opening the Calendar tab without a `property` query shows a cute building picker grid first.
- Selecting a building navigates to `/mobile/calendar?month=YYYY-MM&property=<building>`.
- Okubo properties use a detached-house icon; all other properties use a hotel/building icon.
- The old horizontal building chip row is removed from the calendar screen. A compact selected-building card with `Change building` returns to the picker.

## Cleaning

Purpose:

- Manage cleaning execution.

Includes:

- Select room/property from today's check-out list
- Search room/property as secondary method
- Start cleaning
- Complete cleaning
- Active timer
- Cleaning history
- Report lost item from cleaning
- Report maintenance issue from cleaning

## Requests

Purpose:

- Central place for operational reports and requests.

Includes:

- Maintenance requests
- Lost and found
- Order/supply requests

List visibility:

- All users can create and view maintenance requests.
- All users can create and view lost item records.
- All users can create and view order requests.
- Users should also have a "My registrations" view for records they created.
- The Requests mobile list exposes a dedicated **"내 요청" (mine) toggle switch** in the filter row (`role="switch"`, `scope` query `mine`/`all`). This replaces the old scope option inside the filter sheet.
  - `All` (default): all visible records in the organization scope
  - `My registrations` (toggle on): records created by the current user only
- The mine toggle applies consistently across maintenance, lost and found, and order request list views.
- **Toggle label per tab (2026-06-15)**: the scope toggle text is tab-dependent — 분실물
  (lost-found) keeps **"내 등록"** (`filterScopeMine`), while 수리요청 (maintenance) and 비품주문
  (order) show **"내 요청"** (`filterScopeMineRequest`, ko "내 요청" / ja "自分の依頼" / en "My
  requests"). Same `scope` behavior; label only.

List layout (`src/components/requests/requests-filter-view.tsx`):

- **Filter row**: `[필터 버튼] · [내 요청/내 등록 토글] · (비품주문 탭) [배송 캘린더 아이콘] · [총 N건 카운트(ml-auto)]`.
- **완료-목록 진입 행 (분실물 탭 전용, 2026-07-16)**: 필터 행 바로 아래 **별도 줄**에 `[반환완료 pill][폐기 내역 pill]`
  두 개를 나란히 둔다. 두 pill을 필터 행에 함께 넣으면 좁은 화면에서 오른쪽이 잘려서 별도 줄로 분리했다
  (`space-y-3` 형제 행, 가로 넘침 시 스크롤).
- **반환완료 진입 pill (2026-07-15)**: 분실물 탭에서만, "내 등록" 토글 옆에 네이비 아웃라인 pill
  (Undo2 아이콘 + `dictionary.lostFound.returned.entry`)이 뜬다. 탭 → **반환완료 전용 목록**
  `/mobile/requests/lost-found/returned` (`ReturnedLostFoundList`). 반환완료(`returned`) 항목만
  통계·검색·기간/건물 필터와 함께 월별 그룹으로 본다. 자세한 내용은 `docs/product/09-lost-found-workflow.md`
  → "반환완료 전용 목록".
- **폐기 내역 진입 pill (2026-07-16)**: 분실물 탭에서만, 반환완료 pill **바로 옆**에 슬레이트 아웃라인 pill
  (Trash2 아이콘 + `dictionary.lostFound.disposed.entry`)이 뜬다. 탭 → **폐기 내역 전용 목록**
  `/mobile/requests/lost-found/disposed` (`DisposedLostFoundList`). 폐기(`disposed`) 항목만 통계·검색·
  기간/건물 필터와 함께 월별 그룹으로 본다. 반환완료 목록의 1:1 미러(톤만 슬레이트), 읽기 전용,
  처리 라인은 자동/수동 구분, 90일 삭제시계는 미표시. 자세한 내용은
  `docs/product/09-lost-found-workflow.md` → "폐기 내역 전용 목록".
- **Delivery calendar icon (2026-06-15)**: a high-quality calendar icon button sits next to the scope
  toggle **on the 비품주문 (order) tab only — it does NOT appear on the 수리요청 or 분실물 tabs**
  (only order requests carry a delivery date). Tapping it opens a **popup (centered modal) with a large
  month calendar** (`OrderDeliveryCalendar`) of order deliveries, derived from
  `order_requests.delivery_date` (auto-shown when an admin sets it, auto-updated on edit; respects the
  전체/내 요청 scope). Day tap → that day's deliveries, each linking to the order detail. Full spec:
  Order Request Workflow doc → "Delivery Calendar (Implemented — 2026-06-15)".
- **Open count ("총 N건")**: counts only records in **active/open status** for the current tab + mine scope (lost-found active, maintenance `open`/`in_progress`, order `requested`/`approved`/`ordered`). Completed/closed records are excluded, so the number drops as work is closed. Completed records still appear as cards (e.g. under earlier date groups).
- **Date groups**: visible records are split into **Today / Yesterday / Earlier** (`오늘/어제/이전`) by the Tokyo operating date of each record (lost `found_at`, maintenance/order `created_at`). Empty groups are not rendered. Group labels: `dictionary.mobile.groupToday/groupYesterday/groupEarlier`.

Status change permission:

- Part-time Staff cannot change request statuses.
- Staff and above can change request statuses according to module rules.
- Order request approval/rejection/ordered status is limited to office-level roles.

Edit/delete permission:

- Users can edit/delete records they created.
- Part-time Staff can only edit/delete their own records.
- Delete is a hard delete in MVP.
- Show confirmation popup before deleting.

Requests can be created from:

- Requests tab directly
- Home quick actions
- Active cleaning timer shortcuts

If a lost item or maintenance request is created from an active cleaning timer, it should still appear in the Requests tab lists.

## Announcements

Purpose:

- Read company notices and participate in comments.

Includes:

- Announcement list
- Important announcements
- Pinned announcements
- Comments
- Read tracking

## Global Mobile Shell (current contract)

All mobile screens share one shell rendered by `MobileShell`:

```txt
[three-line hamburger]  Foldy wordmark  [Notifications] [Profile]
```

Implementation: `src/components/shell/mobile-shell.tsx`.

Current rules:

- **Base surface**: the mobile shell, sidebar, bottom bar, and page background use a warm **ivory** `bg-background` base; cards/sheets stay white (`bg-surface`). The brand accent (`--primary`) is deep ink **navy/indigo** (teal/green retired). The shell itself is not a full-screen glass surface.
- **Left**: a hamburger menu button (3-line SVG with a shorter middle line) opens the mobile side menu. `aria-label` uses `dictionary.common.menu`.
- **Layout**: the header is a 3-part `justify-between` row — left menu button / centered wordmark / right notification-and-profile group.
- **Center**: the `Foldy` wordmark (20px, `text-foreground`, `white-space: nowrap`) uses the shared `.wordmark` class (serif italic — Noto Serif, defined in `src/app/globals.css` and loaded in `src/app/layout.tsx`).
- **화이트 리디자인(2026-10-09)**: 워드마크는 세리프 이탤릭 대신 **Geist 700**(`.wordmark`), 세 줄 메뉴 바로 오른쪽에 **왼쪽 정렬**(가운데 정렬 아님),
  메뉴 버튼은 동그란 회색 바탕 없이 줄만, 오른쪽 프로필은 사람 아이콘 대신 **옅은 보라 동그라미 이니셜**. 레일(폴드)은 옅은 면(`#F7F7F9`) · 테두리 없음 ·
  선택 = 흰 칸 · 편집 버튼 = 흰 네모(테두리 1px), 사이드바(태블릿)는 테두리 없음 · 로고 마크 + 워드마크 · 선택 = 옅은 보라 면.
- **HIG 다듬기 2차(2026-10-19) — 큰 제목 · 작은 제목 · 채운 아이콘**: 폰 위 줄의 「Foldy」 글자를 뺐다(HIG 「Don't title windows with your app name」).
  화면의 큰 제목(`[data-large-title]` 또는 첫 `h1`)이 위 줄 아래로 스크롤돼 사라지면 위 줄 가운데에 그 제목(`data-compact-title` 이 있으면 그 값 — 홈은
  「홈」)이 17px 반굵게 떠오르고, 맨 위로 돌아오면 숨는다(`IntersectionObserver`, `.shell-title`). 큰 제목이 없는 화면은 위 줄 가운데가 비어 있다.
  목록 첫 화면 제목은 모두 **34/41 · 700**(iOS Large Title — 투두 · 알림 · 청소 · 요청 · 공지 · 게시판 · 직원 · 제안 · 버그 · 게스트 피드백 · 연차 · 근태 홈 ·
  가동률 · 매출 · 룸 링크 · 자동화 · 홈 인사말). 상세 · 작성 화면 제목은 그대로(20~24px).
  하단 탭 · 레일 · 사이드바는 같은 아이콘 모음(`src/components/shell/nav-glyphs.tsx`)을 쓰고, **고른 항목은 채운 아이콘**(`[data-fill]` 채움 ·
  `[data-knock]` 바탕색으로 비움 · `[data-on]` 고른 때만 — `globals.css`). 사이드바 줄은 44px · 15px.
- **Top chrome surface**: the header bar is flat/borderless — no capsule outline, ring, glass blur, or shadow. Menu, notification, profile controls and the centered wordmark sit over the shared ivory chrome.
- **Buttons**: the menu button is a 38px muted circle; notification and profile controls use the same 38px touch target and muted icon color. The menu icon is a 3-line SVG with a shorter middle line; the profile icon is a person SVG.
- **Right**: the notification bell links to `/mobile/notifications` and can show the unread badge; the profile button links to `/account?mode=mobile`. Accessible labels use the shared dictionary.
- **Scroll behavior**: the top chrome hides when users scroll down and returns when users scroll up — and it now **fully slides away**, mirroring the bottom tab bar. **Overlay model (2026-06-22):** the top bar is an **absolutely positioned overlay** (`absolute inset-x-0 top-[env(safe-area-inset-top)] z-30 h-16`) that slides up off-screen (`-translate-y-[calc(100%+env(safe-area-inset-top))]`) on scroll-down and back on scroll-up, exactly like the bottom bar's slide. Previously the bar was an **in-flow `h-16` block** whose inner content merely faded while the 64px slot stayed occupied, leaving a blank band at the top while scrolling (the reported bug). With the overlay model the content reclaims that space. The scroll container carries a **constant** `pt-[84px]` (64px header + ~20px breathing room) so content clears the overlay at rest and simply scrolls under where the header was — the padding never toggles, so there is no reflow/snap jump (an earlier `pt-5`/`pt-0` toggle shifted content 20px while `scrollTop` stayed put and was removed 2026-06-22). The pull-to-refresh indicator and gradient curtain are offset to `top-16` so they sit below the overlay header. Hide/show is **debounced via accumulated-delta thresholds** (`updateVisibility`): the header only hides after ≥**64px** of intentional downward scroll and only returns after ≥**36px** of upward scroll (raised from 28/12 on 2026-06-22 to stop touch-jitter flicker), with per-tick deltas of ≤4px filtered on **both** directions so iOS momentum micro-oscillation never feeds the accumulators. Scrolling to the very top (`scrollTop ≤ 8px`) always snaps the header visible.

- **전체폭(full-bleed) 화면이 셸 패딩을 취소할 때의 규칙 (2026-08-07).** 일부 상세/목록 화면은
  `-mx-5 -mb-* -mt-[84px] h-[100dvh]` 로 셸의 패딩을 상쇄해 화면 전체를 직접 그린다. 이때 **취소한
  만큼 스스로 되돌려 놓아야 한다.**
  - `pt-[84px]` 은 장식이 아니라 **떠 있는 상단 바(absolute, h-16)를 피하는 자리**다. `-mt-[84px]`
    로 취소하고 끝내면 첫 84px 이 상단 바 뒤로 들어간다. 게시판 상세가 그래서 **작성자 행과 「⋯」
    메뉴가 통째로 가려져** 글 수정·삭제에 닿을 수 없었다(2026-08-07 수정). 취소 뒤에는 반드시
    `<div className="h-[84px] shrink-0" />` 같은 스페이서로 같은 높이를 다시 확보한다.
  - 하단은 **바텀탭 유무에 따라 값이 다르다.** 셸은 `hideBottomNav` 면 `pb-8`(32px), 아니면
    `pb-[124px]` 을 쓴다. 화면이 `-mb-8` 로 고정해 두면 바텀탭을 띄우는 화면에서 92px 이 남아
    콘텐츠 아래로 빈 공간이 스크롤된다(버그 신고 목록·상세가 그랬다). **자기 화면의
    `hideBottomNav` 설정과 짝을 맞춘다.**
  - 이 화면들(버그 신고 목록 / 버그 신고 상세)은 자체 스크롤 영역을 가지므로
    **상단 바 자동 숨김이 동작하지 않는다** — 셸의 스크롤 컨테이너가 움직이지 않기 때문이다.
    즉 84px 은 상시 필요하다.
  - **게시판 상세는 2026-10-15 화이트 리디자인에서 이 방식을 그만뒀다.** 셸 스크롤 안에서 그리고, 댓글 입력은
    `position: sticky; bottom: 0`(`.bdw-cmp`)로 화면 바닥에 붙인다. 셸의 `hideBottomNav` 아래 여백(`pb-8`)만
    `.bdw-dwrap { margin-bottom: -32px }` 로 지운다. 폴드(`fold:px-7 fold:pt-6`) · 태블릿 칸에서도 음수 여백이 어긋나지 않고,
    상단 바 자동 숨김도 다시 동작한다. 글이 짧으면 입력칸이 댓글 바로 아래에 온다(시안과 같음).
- **Layout height**: the outer shell frame uses the live viewport height (`h-dvh`), while the centered max-width wrapper and inner safe-area column inherit that height with `h-full`. Earlier attempts that bound multiple nested containers to viewport units (`h-svh` everywhere, then mixed viewport units) caused real iPhone Safari / standalone gaps under the bottom bar and floating sidebar floors. New shell-height work should keep **one viewport-bound outer frame** and let nested shell boxes inherit from it.
- **Native standalone touch contract (2026-06-22)**: global rules in `src/app/globals.css` keep the installed PWA feeling native — `-webkit-tap-highlight-color: transparent` (no grey tap-flash), `-webkit-touch-callout: none` + `user-select: none` on UI chrome (buttons / links / labels / `.tabbar` / `.wordmark`; body text and inputs stay selectable), `html, body { overscroll-behavior: none }` (no document rubber-band), and `@media (pointer: coarse) { input/textarea/select { font-size: 16px } }` so iOS never zoom-snaps on focus (oversized fields opt out with `data-keep-font-size`). When adding chrome, don't reintroduce tap-highlight or callouts; new inputs need ≥16px on touch. Tappable controls also get `touch-action: manipulation` (instant taps, no double-tap zoom) and `html` gets `text-size-adjust: 100%` (no iOS landscape text inflation).
- **Native `<input type="date">` iOS fix (2026-07-17)**: on iOS Safari the native date field ignores the container box — it applies its own `-webkit-appearance` chrome and renders the value through `::-webkit-date-and-time-value` with an intrinsic width, centering, and margin, so the field stretched wide and the text sat off-baseline (reported on the account/profile 생년월일 field, `src/app/account/page.tsx`; onboarding shares the same input). Desktop was unaffected, so it only reproduced on real devices. Global rule in `src/app/globals.css` now resets `input[type="date"]` with `-webkit-appearance: none; appearance: none` (keeping `min-width: 0; max-width: 100%`) and forces `::-webkit-date-and-time-value { text-align: left; margin-inline: 0; margin-block: auto }` + `::-webkit-datetime-edit { padding: 0 }` so the field follows our `h-11 px-3` box and left-aligns the value. **Vertical-centering follow-up (2026-07-17):** the first cut used `margin: 0`, which also killed the UA's block-axis `auto` margin — that margin is what centers the value inside iOS's flex shadow container, so the digits sat high in the h-11 box (reported on 생년월일). Only the inline axis may be zeroed; `margin-block` must stay `auto`. This is the shared standard for any native date input — do not re-style date fields per-page.
- **Keyboard native correctness (2026-06-22)**: mobile inputs set the right keyboard hints — `enterKeyHint` on single-line fields (login `next`/`go`, search `search`, comment composers `send`, invite `done`), search bars use `type="search"`, onboarding name/phone carry `autoComplete="name"`/`"tel"`, invite-code fields disable `autoCorrect`/`spellCheck`/`autoComplete`. New inputs should pick the correct `type`/`inputMode`/`enterKeyHint`/`autoComplete` rather than a bare `type="text"`.
- **Route transitions — 화면 전환 (2026-06-22 → 2026-10-21 네이티브 점검으로 다시 짬)**: 전환은 이제 `MobileShell` 이 **본문 칸
  (`[data-shell-column]`)에만** 건다(예전 `src/app/mobile/template.tsx` 는 셸 통째로 — 탭바 · 위 줄까지 — 밀었고, 섹션이 바뀔 때만 돌아
  목록 → 상세에는 전환이 없었다. 지웠다). 셸은 화면마다 다시 그려지지만 탭바 · 위 줄은 같은 자리 같은 모양이라, 본문만 움직이면 네이티브
  탭바처럼 고정돼 보인다. 방향은 `src/lib/nav-direction.ts` `consumeScreenEntrance(path, placeholder)`(셸이 처음 그려질 때 한 번):
  - **앞으로**(링크 · 버튼) `.screen-push` — 오른쪽 14% 에서 반투명으로 밀려 들어옴(280ms). **뒤로**(브라우저 · Android 뒤로) `.screen-pop`.
  - **탭 전환**(아래 탭바 · 사이드 메뉴 · 레일의 링크 — 셸 틀이 `onClickCapture` 로 `"tab"`) `.screen-tab` — 밀지 않고 160ms 짧게 나타남.
  - **스와이프 뒤로가기** · Safari 가 이미 그린 뒤로 = 움직임 없음. **같은 경로 다시 그림** = 없음.
  - **로딩 자리 셸**(아래)이 먼저 민 경로의 진짜 화면은 `.screen-reveal`(200ms 나타남)만 — 방향은 이어받는다.
  - **그리다 버려진 셸 (2026-10-22 고침)**: React 가 그리던 화면을 버리고 다시 그리면(로딩 중 재시도) 셸의 `useState` 초기값이 한 번 더
    불린다. 판정은 화면에 붙을 때까지 같은 답을 돌려주고(`consumeScreenEntrance`), 셸이 붙으면 마운트 effect 가 `commitScreenEntrance` 로
    비운다. 전엔 버려진 쪽이 「reveal」을 써 버려 진짜 화면은 「same」(효과 없음) — 태블릿에서 요청 탭으로 갈 때 실측. 폴드(700) · 태블릿
    (1200) 레일 · 사이드바 전환 측정: 레일 · 사이드바 제자리, 본문만 나타남(탭) → 로더 → 나타남(reveal), 매번.
  - 끝나면 클래스를 뗀다(`animation-fill-mode: both` 의 transform 이 `position: fixed` 자손의 기준 상자가 되지 않게). 줄이기 모드는 전부 없음.
  - **서버 · 하이드레이션 (2026-10-26 고침)**: 판정은 브라우저 한 곳의 기록이라 모듈 변수에 두는데, 서버에서도 불려 요청 사이에 그 변수가
    공유됐다(다른 요청의 경로가 「same」 · 「reveal」 판정에 섞여 서버 HTML ≠ 클라이언트 첫 그림). 이제 서버에서는 아무것도 바꾸지 않고
    `none`, 클라이언트도 **하이드레이션 중에는**(`useSyncExternalStore` 서버 스냅샷) 같은 `none` 을 그린다 — 앱을 처음 열 때 첫 화면은
    밀려 들어오지 않는다(네이티브 앱 실행 첫 화면처럼). 하이드레이션 중에도 판정은 해서 모듈 상태 · 스크롤 복원 방향은 맞춘다. 그 뒤 이동의
    push · pop · tab · reveal 은 그대로.
- **로딩 자리 셸 (2026-10-21)**: `src/app/mobile/loading.tsx` = `MobileShellPlaceholder`(`src/components/shell/mobile-shell-placeholder.tsx`)
  — 같은 셸(탭바 · 위 줄 · 배지)을 `placeholder` 로 그리고 본문 칸에 공용 로더(`FoldyLoader`, 0.3초 뒤에만 보임). 예전 로딩은 화면 전체를
  덮어(`fill`) **탭바까지 사라졌고**, 섹션 안 이동(목록 → 상세 · 새로 쓰기)은 로딩 경계가 없어 서버 응답까지 **눌러도 멈춰** 있었다. 이제:
  - 누르자마자(미리 받아 둔 로딩 경계) 셸 자리 로딩이 그려지고 본문이 밀려 들어온다 → 데이터가 오면 본문만 나타남.
  - **하위 화면이 있는 폴더마다** `loading.tsx` 가 이 파일을 다시 내보낸다(orders · maintenance · requests(+ orders · maintenance · lost-found) ·
    tasks(+ projects · [id]) · bugs · complaints(+ reviews) · announcements · ops · lost-found · cleaning · linen-return(+ record · record/[id]) ·
    board(+ [id]) · attendance(+ leave · correction) · suggestions(+ [id]) · users). Next 는 로딩 경계를 「그 폴더 레이아웃의 자식 칸」마다
    두고 **검색어(`?view=`)는 칸 키에서 뺀다** — 그래서 같은 화면의 필터 · 탭(`?view=`) 바꾸기는 로딩이 끼지 않는다.
    **새 규칙:** 모바일에 하위 화면이 있는 폴더를 새로 만들면 같은 한 줄 `loading.tsx` 를 둔다.
  - 탭바 모양은 그 경로를 지난번에 그린 셸 설정(`getShellHint` — 메뉴 · 탭바 숨김 · 제목 · 넓은 화면)과 마지막 배지를 따른다. 처음 가는
    경로면 주소로 메뉴를 찾고, `/new` · `/compose` · `/edit` 은 탭바를 숨긴다.
  - 자리 셸은 스와이프 뒤로가기 · 밑그림 · 스크롤 위치 저장을 하지 않는다(진짜 화면이 한다).
- **Scroll restoration (2026-06-22)**: the shell scrolls an inner div (not the window), so Next's built-in restoration can't help. `MobileShell` saves the scroll container's `scrollTop` per pathname (module-scoped `SCROLL_POSITIONS`, survives the per-route remount) and restores it on mount — back-nav lands where you left off in long lists. **2026-10-21:** 복원은 뒤로 · 스와이프 · 탭 전환 · 같은 화면일 때만 — **앞으로 새로 연 화면은 맨 위에서** 시작한다(네이티브). 예전에는 링크로 다시 들어와도 지난번 위치로 내려가 있었다.
- **메뉴 끌어 닫기 (2026-10-21 네이티브 점검)**: 열린 왼쪽 메뉴(서랍)를 왼쪽으로 밀면 손가락을 따라 밀리고(폴드 · 태블릿은 뒤 어둠도 같이
  걷힘), 메뉴 폭의 30% 넘게 밀었거나 왼쪽으로 빠르게 튕기면 닫힌다(가벼운 햅틱) — 아니면 제자리로. `useDrawerDragClose`
  (`src/components/shell/use-drawer-drag-close.ts`). 세로 · 오른쪽 손짓은 메뉴 목록 스크롤 몫, 메뉴 검색칸에서 시작한 손짓은 받지 않는다.
  끄는 동안 `html[data-gesture]`(누름 반응 끔). 서랍의 `transform` · `transition` 은 React 가 쥔 값이라 끄는 동안만 덮고, 닫을 땐 전환을
  되돌린 뒤 `closeSidebar` 로 React 가 -100% 를 쓴다(남은 거리를 원래 360ms 곡선으로). 로컬 빌드로 폰(390) · 폴드(700) 폭 확인.
- **오프라인 표시 (2026-10-22 출시 점검 D2)**: 연결이 끊기면 셸 위쪽(폰: 위 줄 바로 아래 72px · 폴드/태블릿: 본문 위)에 작은 알약
  「오프라인 — 불러온 내용만 보여요」(`OfflinePill`, `common.offlineBanner` ko/ja/en)이 내려오고 돌아오면 걷힌다. 지금 화면은 그대로 둔다.
  앱에서는 OS 연결 상태(`@capacitor/network`, 2026-10-22)로 판정한다 — iOS WebView 의 `navigator.onLine` 은 늦거나 틀릴 때가 있다.
  다른 화면으로 가면 서비스 워커가 그 화면의 저장본(전에 연 화면) 또는 `/offline` 을 내보낸다. `/offline` 은 React 없이 도는 맨 스크립트로
  기기 언어 하나만 보이고 「다시 시도」 · `online` + 3초마다 `/api/build` 확인으로 돌아온다(전 `OfflineAutoReload` 는 React 가 안 살아나
  한 번도 안 돌았다 — N6).
- **Sidebar transition lock (2026-06-23)**: opening/closing the side menu locks the shared top and bottom chrome hidden until the sidebar transition completes. This prevents a closing-frame flash where the header/tab bar reappears while the menu panel is still sliding away.
- **Keyboard inset (2026-06-22)**: `KeyboardInsetSync` (mounted in `layout.tsx`) publishes the on-screen keyboard height as `--keyboard-inset` (VisualViewport). Genuinely `position:fixed` bottom submit bars use `bottom: var(--keyboard-inset, 0px)` so the keyboard never covers them (linen-return create; attendance `.att .submitbar`). New fixed bottom bars with inputs should do the same; flex-flow composers don't need it (the browser auto-scrolls them).
- **Known deferred**: the shell still renders per-page (no shared `mobile/layout.tsx`), so it remounts on navigation (header scroll state resets; bottom-tab active highlight updates on arrival, not instantly on tap). A true persistent shell needs a route-group restructure to exempt the no-shell screens (`/mobile/notifications`, attendance capture) — deferred.
- **Press feedback (2026-06-22)**: tappable controls give a native press response — the shared `Button` (`ui/button.tsx`) has `active:` states + `active:scale-[0.98]`, bottom tab items and notification rows depress on `:active`. Because Tailwind v4 only applies `hover:` on hover-capable devices, new touch controls must use `active:` (not hover) for tap feedback.
  - **누름 반응 — 공용 규칙 (2026-10-21 네이티브 점검)**: 점검 때 링크가 있는 모바일 화면 28곳 중 21곳에 누름 표시가 없었다. 이제
    `globals.css` 한 곳에서 **모바일 셸(`[data-shell-frame]`) · 시트(`[data-sheet]`) 안의 링크 · 버튼 · `role="button"` · `summary`** 가 누르는
    동안 `filter: opacity(0.6)` 로 옅어진다(터치 기기만 — `pointer: coarse`).
    - **50ms 늦게** 옅어진다 — 스크롤하려고 댄 손가락에 줄이 깜빡이지 않게(iOS 스크롤 뷰와 같은 원리). 떼면 바로 돌아온다.
    - **가장 안쪽 것만** — 카드 링크 안의 버튼을 누르면 버튼만(`:has`).
    - **빼는 것**: 자기 `active:` 유틸리티가 있는 요소(두 번 반응 안 함) · 탭바 · `.add-tile` · 자기 가로 손짓이 있는 줄(`[data-swipe-back="off"]`
      안) · 화면을 밀거나 시트를 끄는 동안(`html[data-gesture]` — 스와이프 엔진 · `useSheetDragDismiss` 가 건다) · 개별로 `data-press="off"`.
    - `opacity` 가 아니라 `filter: opacity()` · `!important` 인 이유: 목록 줄 대부분의 등장 애니메이션(`ntw-in` 등)이 끝난 뒤에도 opacity 를
      쥐고 있어 지연이 안 걸렸고(바로 옅어짐), `transition-colors` 같은 유틸리티에 지연 transition 이 졌다. 누르는 동안만 걸린다.
    - 새 화면은 따로 넣을 필요 없다. 다른 반응(작아짐 · 배경색)을 원하면 그 요소에 `active:` 를 쓰면 공용 규칙이 빠진다.
- **줄 접힘 · 즉시 반영 — 공용 (2026-10-21 네이티브 점검)**: 목록에서 줄을 지우면 서버를 기다리지 않고 바로 높이가 접히며 흐려지고 아래 줄이
  부드럽게 올라온다 — 감싸는 요소에 `.row-collapse`(globals.css), 빠지는 동안 `data-leaving`, 실패하면 속성을 떼서 다시 편다. 알림 목록
  (`.nfw-item[data-gone]`) · 할 일(`is-leaving`)은 이미 같은 방식이었고, 이번에 연차 임시저장 밀어서 지우기에 붙였다. 상태 바꾸기는
  `useOptimistic` 으로 누르자마자 반영 — 이번에 불만 「해결 · 다시 열기」(할 일 · 게시판 반응 · 근무 신청 · 알림 읽음은 이미). 새로 쓰기 ·
  고치기 폼은 저장 뒤 화면을 옮기므로 대상이 아니다. 새 목록에서 줄을 지우는 동작은 `.row-collapse` 를 쓴다.
- **햅틱 — 공용 규칙 (2026-10-22)**: 같은 일엔 어느 화면이든 같은 진동(`src/lib/haptics.ts` 머리 주석이 기준).
  `success` = 기록이 남는 일이 서버 확인 뒤 끝남(저장 · 제출 · 신청 · 완료 · 승인, 누르자마자 반영이면 그 순간) · `error` = 서버 거절 · 실패(오류
  문구와 같이) · `warning` = 일부만 됨 · 되돌릴 수 없는 꾹 확정 직전 · `light` = 고르기 · 토글 · 탭 전환 · 밀어 치움 · 삭제 완료 · 댓글 보냄 ·
  `medium` = 꾹 눌러 집기. 저장 뒤 서버가 다른 화면으로 보내는 폼(`redirect`)은 진동 없이 화면 이동이 피드백. 점검 때 서버에 저장 · 제출하면서
  진동이 전혀 없던 모바일 화면 22곳 중 결과를 받는 14곳에 맞춰 넣었다(버그 신고 · 근태 정정 · 연차 신청 · 연차 기준 · 교통비 · 판매 캘린더 차단 ·
  수기 예약 · 예약 취소/수정/옮기기 · 요청 삭제 · 건의 댓글/상태). 나머지는 `redirect` 폼(공지 · 분실물 · 수리 · 린넨 삭제 · 건의 작성 · 할 일 작성).
- **사진 부드럽게 나타나기 — 공용 (2026-10-22)**: 모바일 셸 · 시트 안 `img` 는 다 받아질 때까지 숨겼다가 0.22초에 나타난다(전엔 줄줄이
  그려지거나 툭 떴다 — 부드럽게 나타나는 곳이 1곳뿐). `ImageFadeIn`(`src/components/shell/image-fade-in.tsx`, 모바일 레이아웃에 한 번) +
  globals.css. **안전장치 먼저**: 숨김은 `html[data-img-fade]` 일 때만이고, 이 속성은 이미 받아진 사진을 표시(`data-loaded`)한 뒤에 켠다 —
  스크립트가 안 돌면 평소처럼 보인다. 받기 실패도 표시(깨진 그림 · 대체 글이 보이게), 새로 붙은 사진은 문서 캡처 `load` · `error` +
  MutationObserver(이미 받아진 사진 · `src` 바뀜). 나타남은 `animation` — 사진의 `transition-*` 유틸리티를 덮지 않게. reduced-motion 이면 끈다.
  새 화면은 따로 할 것 없다. 로컬 확인: 느린 사진은 숨었다 나타남, 깨진 사진도 보임, 이미 받아진 사진은 바로 나타남.
- **앱으로 돌아오면 새로 고침 — 공용 (2026-10-22)**: 전엔 백그라운드에서 돌아와도 화면이 그대로라 아침에 앱을 열면 어젯밤 화면이 보였다.
  `ResumeRefresh`(`src/components/shell/resume-refresh.tsx`, 모바일 레이아웃에 한 번)가 **5분 넘게** 나가 있다 돌아오면(`visibilitychange` —
  앱 WebView · 홈 화면 PWA · 브라우저 모두) 새로 고친다. 그사이 **새 배포**가 나갔으면(`/api/build` ≠ 빌드에 굳은 `FOLDY_DEPLOY_ID`) 통째로
  다시 불러온다 — 앱은 배포된 웹을 띄우므로 이게 곧 앱 업데이트. 단 입력칸에 포커스 · 시트 · 메뉴가 열림 · 글이 든 입력칸이 있으면 통째로는
  안 하고(쓴 글 보호) `router.refresh()` 만 — 화면 · 스크롤 · 입력은 그대로, 서버 내용만 새로. 오프라인이면 아무것도 안 한다. 로컬 확인: 1분
  자리 비움은 그대로, 6분은 새로 고침.
- **실시간 갱신 — 공용 (2026-10-29)**: 화면을 열어 둔 동안 다른 사람이 바꾼 것도 새로고침 없이 보인다. `LiveRefresh`
  (`src/components/shared/live-refresh.tsx`, PC · 모바일 공용)가 테이블 변경 **신호만** 받아 `router.refresh()` — 행 데이터는 소켓으로 쓰지
  않고, 구독도 각 테이블의 select RLS 를 통과해야 신호가 온다(볼 수 없는 행은 신호도 없음). 600ms 디바운스, 숨은 탭은 보일 때 한 번,
  60초 넘게 가려졌거나 소켓이 다시 붙거나 `online` 이면 한 번 따라잡기(`src/lib/live-refresh-schedule.ts`). 화면별 묶음은
  `src/lib/live-sources.ts`. 테이블은 `supabase_realtime` publication 에 있어야 한다(`202610290001_enable_ops_realtime.sql`).
  폴링이 아니다. 새 화면이 같이 쓰는 데이터를 보여 주면 서버 페이지에 `<LiveRefresh sources={…} />` 한 줄을 붙인다.

  | 화면 | 구독 |
  | --- | --- |
  | 모바일 레이아웃(모든 `/mobile`) | 내 알림 — 종 · 사이드 메뉴 배지. **레이아웃엔 알림만**(할 일 · 요청을 여기 두면 상관없는 화면까지 매번 다시 그림) |
  | 할 일 목록 · 프로젝트 · 상세(PC `/admin/tasks` 도) | `tasks` · `task_occurrence_state`(조직) · `task_participants`(나) · 상세는 + `task_updates`(그 할 일) |
  | 홈 | 요청(주문 · 수리 · 분실물) — Beds24 신호는 그대로 |
  | 요청 목록 · 주문/수리/분실물 상세 · 반환 · 폐기 목록 | `order_requests` · `maintenance_reports` · `lost_items` |
  | 정정 처리 상태 · 연차 신청 내역 | `attendance_sessions` · `attendance_correction_requests` · `transport_reimbursement_reports` · `annual_leave_requests` |

  알려진 한계: **삭제 신호는 없다**(replica identity 기본값) — 할 일은 소프트 삭제라 바로 반영되지만, 주문 · 수리 · 분실물을 남이 지우면
  다음 갱신 때 빠진다. 반복 회차 완료 되돌리기 · 「건너뛴 날」 되살리기 · 참여자 빼기는 행을 지우지만 DB 트리거가 부모 할 일의 `updated_at` 을
  새로 써서 `tasks` UPDATE 신호로 대신 온다. 단 **빠진 그 사람**은 이제 그 할 일을 못 봐서(RLS) 신호가 없다 — 그 사람 목록에선 다음 갱신 때 빠진다.
- **접근성 — 공용 규칙 (2026-10-22 점검)**: axe(버튼 · 링크 이름 · 입력칸 이름 · 대비 · 누르는 크기 등)를 모바일 화면 54곳 × 폰 · 폴드 · 태블릿
  너비로 돌리고, 화면 밖에 있는데 화면 읽기(VoiceOver · TalkBack)가 닿는 요소 · 11px 미만 글자 · 28px 미만 누르는 자리를 따로 쟀다. 이름 없는
  버튼은 0곳이었다. 고친 것과 규칙:
  - **닫힌 메뉴(서랍)는 `inert`** — 화면 밖으로 밀려 있어도 화면 읽기가 메뉴 항목 20여 개를 본문보다 먼저 읽었다. 닫힌 동안 `inert`, 열리면
    `role="dialog"` + `aria-modal`. 화면 밖에 늘 붙어 있는 패널을 새로 만들면 닫힌 동안 `inert` 를 건다.
  - **숨긴 파일 입력칸은 `aria-hidden` + `tabIndex={-1}`** — 이름 붙은 보이는 버튼이 대신 연다(게시판 쓰기 · 고치기 · 댓글, 버그 신고, 공지 사진,
    교통비 영수증). 새 업로더도 같게.
  - **탭바 이름은 「주요 탭」**(`common.tabBarLabel`) — 화면 제목을 썼더니 같은 제목의 화면 안 탭 목록(사용자 · 게스트 피드백)과 이름이 겹쳤다.
  - **글자 대비 4.5:1** — 일요일 빨강 글자 `#d8455a`(4.3:1) → `#c4364b`(5.3:1, 모바일 달력 6곳), 연차 글자 수 `#b4b1bf` → `#77738a`. 점 · 고리 같은 비글자 표시는 3:1 이면 되므로 그대로. 지난 · 아직 안 온 날짜(비활성)는 기준 예외라 그대로.
  - **누르는 자리 44px** — 시프트 달 이동 화살표가 좁은 폰에서 22px 로 눌려 줄었다 → `flex: none`. 할 일 완료 동그라미는
    24px 지만 보이지 않는 44px 자리(`::before`)가 이미 있다. 탭바 글자 10.5px 는 iOS 기본 탭바(10pt)와 같아 그대로.
  - **큰 글씨 — 앱은 기기 글자 크기를 0.85~1.35 배로 따른다 (2026-10-22, 1.15 → 1.35)**. 1.35 = iOS 일반 글자 크기의 가장 큰 단계(본문
    17 → 23pt). 그보다 큰 「손쉬운 사용」 큰 글씨(최대 약 3배)는 1.35 에서 멈춘다 — Apple 권장(200%)까지는 화면마다 다시 점검이 필요하다.
    방식: 두 플랫폼 모두 `body` 의 `text-size-adjust` 로 키운다(`NativeShellBridge`, Android WebView 의 자체 textZoom 은 100% 로 되돌림 —
    그래야 아래 고정이 Android 에서도 먹는다). 모바일 화면 42곳을 1.35 배 × 폰 · 폴드 · 태블릿으로 점검(가로 넘침 · 잘림 · 글자 넘침 측정 +
    화면 캡처): 대부분 그대로 괜찮았고, 고친 것은 —
    - **원래 크기로 고정**(`.tabbar`, `[data-text-fixed]`, globals.css): 탭바(키우면 「Requests」 「Announcements」가 붙었다 — iOS 기본 탭바도
      글자 크기를 따르지 않는다) · 판매 캘린더 격자 · 범례(촘촘한 데이터 표, 칸 이름이 잘렸다) · 연차 신청 종류 나눔 버튼(「Bereavement」가 옆
      칸과 겹쳤다, `leave.css`). 본문 · 목록 · 버튼 · 입력칸에는 쓰지 않는다 — 큰 글씨가 필요한 사람이 읽는 곳이다.
    - **잘리던 이름은 줄바꿈**: 가동률 · 매출 숫자 이름(「Sold nig…」), 같은 줄 숫자는 아래로 맞춤.
    - **연차 날짜 칸 위 여백**: 날짜가 여러 줄이 되면 첫 줄이 이름표에 붙었다.
    브라우저 · PWA 의 손가락 확대는 막지 않았다.
- **앱 아이콘 꾹 누르기 메뉴 (2026-10-22, 앱 전용)**: 홈 화면에서 앱 아이콘을 꾹 누르면 **출퇴근**(`/mobile/attendance`) · **할 일 추가**
  (`/mobile/tasks/new`) · **오늘 내 방**(`/mobile/shift/today`). iOS `Info.plist` `UIApplicationShortcutItems`(제목은 `InfoPlist.strings` ko/ja/en,
  SF Symbol 아이콘) → `SceneDelegate` 가 `com.harutokyo.foldy://open/<id>` 로 바꿔 Capacitor App 플러그인에 넘긴다(앱이 꺼져 있었으면
  `getLaunchUrl`, 켜져 있었으면 `appUrlOpen`). Android `res/xml/shortcuts.xml`(같은 주소의 VIEW 인텐트, 문구 `values` · `values-ko` · `values-ja`,
  48dp 원 아이콘). 웹은 `NativeAuthBridge` 가 받아 `nativeShortcutToWebPath`(정해 둔 3개만 — 아무 주소나 열지 않는다)로 앱 안 이동. 권한 없는
  화면이면 그 화면이 평소처럼 막는다. **새 앱 빌드부터** 보인다(옛 빌드는 메뉴가 없을 뿐).
- **토스트 — 공용 움직임 (2026-10-21 네이티브 점검)**: 토스트 **모양은 화면마다**(시안으로 확정된 할 일 · 판매 캘린더 · 자동화 · 사용자 관리 ·
  게시판 알약) 두고, **움직임만** `useToastMotion`(`src/components/shell/use-toast-motion.ts`) 하나로 맞춘다. 화면에 고정된 토스트 바깥 요소에 `ref`.
  (점검 정정: 「등장 움직임 없음」은 틀렸다 — 셋 다 CSS 등장은 있었다. 빠진 건 아래 둘.)
  - **사라질 때** — 전엔 부모가 상태를 비우는 순간 한 프레임에 사라졌다. 이제 언마운트 직전 그 자리에 복제본을 두고 180ms 동안 살짝 내려가며
    흐려진다(`@keyframes toast-leave`). 복제본 안 등장 · 체크 · 남은 시간 줄 애니메이션은 끝난 모습으로 멈춘다(`[data-toast-leaving]`). 다음
    토스트가 바로 이어 뜨면(`key` 가 바뀜) 옛것은 빠지고 새것은 올라와 겹쳐 바뀐다.
  - **밀어서 치우기** — 옆이나 아래로 밀면 손가락을 따라오며 흐려지고, 가로 56px · 아래 28px 넘게 밀거나 빠르게 튕기면 치워진다(가벼운 햅틱,
    민 방향으로 이어서 나감). 아니면 제자리로. 6px 넘게 움직인 손짓 뒤의 클릭은 먹는다(몸통 탭 닫기 · 되돌리기가 잘못 눌리지 않게). 위로는
    안 끌린다. `onDismiss` 를 안 주면(게시판 1.8초 알림 · 판매 캘린더 진행 중) 사라짐만.
  - **콜백 ref (2026-10-26)**: 훅이 돌려주는 `ref` 는 콜백 ref 다 — 같은 컴포넌트 안에서 조건부로 나중에 그려지는 토스트(`{toast && <div ref={ref}>}`)도
    그려질 때 붙고 사라질 때 복제본을 남긴다. 전엔 처음 그릴 때의 `ref.current` 에만 붙어 내 시프트 저장 토스트는 움직임이 없었다. `ref.current` 는 읽지 않는다.
  - 쓰는 곳: `TaskToast`(되돌리기 · 건너뛰기 · 이동 거절) · `MobileOpsToast` · 자동화 `Toast` · `MobileUsersToast` · `BoardToast`(게시판 상세 · 신고) ·
    내 시프트 저장 토스트 · 급여 토스트 · 셸 오류 알약(하단 탭 저장 실패 — 아래).
- **하단 탭 저장 실패 (2026-10-26)**: 편집 시트를 닫으면 저장하는데, 오프라인 · 서버 오류로 액션이 던지면 오류 화면으로 튕겼고 실패해도
  탭은 바뀐 채였다. 이제 잡아서 탭을 저장 전으로 되돌리고 `haptic("error")` + 셸 알약(「탭을 저장하지 못했어요」, `common.bottomNavSaveFailed`,
  3.2초 · 밀어서 치움). 알약은 PTR 로 transform 이 걸리는 판 밖(`<main>` 바로 아래)에 둔다.
    근태 교통비 명세의 `trn-toast` 는 자체 나가는 움직임이 있어 그대로. 새 모바일 토스트는 이 훅을 쓴다.
- **Double-submit guard (2026-06-22)**: `<form action={serverAction}>` submit buttons use the shared `SubmitButton` (`ui/submit-button.tsx`, `useFormStatus`) which disables + shows a spinner while the action is in flight — prevents double-submit and the dead-button feel. New server-action forms should use it (or `disabled={isPending}` with `useTransition`).
- **Calendar gesture isolation (2026-06-22, 2026-10-08 갱신)**: the horizontal calendar grid `stopPropagation`s its touch events (pull-to-refresh) and carries `data-swipe-back="off"` so a horizontal scroll never triggers the screen swipe-back (React `stopPropagation` does not stop the swipe engine's native listener — the marker does). Any full-width horizontal scroller or drag grid inside the shell should carry the same marker; see 「뒤로가기 — 화면 스와이프」.
- **Tab re-tap scrolls to top (2026-06-22)**: tapping the already-active bottom tab `preventDefault`s the navigation and smooth-scrolls the content container to top (native behavior) instead of a no-op.
- **Double flash when opening a screen — fixed (2026-08-04)**: the SW paints a cached document
  instantly, then messaged the client to `router.refresh()` **on every cacheable navigation**, so
  returning to the app or re-opening the same screen rendered twice. Two changes: (1) a cached copy
  younger than `NAV_FRESH_MS` (30s) no longer triggers the refresh message — the cache still
  revalidates, so the next entry is current; (2) `notifyNavRevalidated` only treats a response as
  "redirected" when the **final URL differs from the requested one**. Middleware refreshes the
  Supabase session cookie and can 307 back to the same address; that was read as "you must go
  elsewhere" and triggered a full `window.location.reload()` — a second, harder flash. Cache
  entries now carry an `x-so-cached-at` header (`NAV_CACHE` bumped to `stayops-nav-v2`; entries
  without the header read as stale, which is the safe direction).
- **로그아웃 뒤 저장본 지우기 (2026-10-28 보안 점검)**: 화면 저장본(`stayops-nav-*`)은 로그인한 사람의 화면을 그대로 담아서,
  공용 기기에서 로그아웃한 뒤 다음 사람이 같은 주소를 열면 앞사람 화면이 먼저 그려질 수 있었다. 로그인 화면(`AuthFrame`)이 뜨면
  `NavCachePurge`(`src/components/shell/nav-cache-purge.tsx`)가 저장본을 모두 지운다 — 로그아웃은 어느 버튼이든 로그인 화면으로 끝난다.
- **No stale-build paint — fixed (2026-10-19)**: a cached document from an **older deployment** was painted first; the
  follow-up `router.refresh()` then hit Next's build-id check and did a full reload, so the entry motion (`admin-entry` ·
  `app-splash`) played twice (Edge-installed admin app). Every response now carries `x-foldy-build` (deployment id,
  `next.config.ts`) and static `/api/build` returns the same value. Before painting a cached copy the SW asks `/api/build`
  (1.5s cap); on mismatch — or a copy without the header — it waits for the network document instead. If the check fails
  (offline · slow) it paints the cached copy as before.
- **Shared date-picker bottom sheet (2026-08-04)**: `src/components/shell/date-picker-sheet.tsx` —
  the one mobile calendar. Arrow-only navigation can't reach a date weeks away, and the native
  `<input type="date">` used briefly rendered the OS calendar, which neither matches the app's visual
  language nor the "every slide-up sheet uses the canonical `BottomSheet`" contract above. It is
  month-paged (‹ / ›), marks today with a ring and the selection with a filled pill, and carries a
  full-width "go to today" action. All date arithmetic stays on Tokyo `YYYY-MM-DD` strings — round-
  tripping through `Date` shifts a day near midnight, a bug this repo has hit repeatedly.
  **White redesign (2026-10-15, draft DateSheet-Phone):** borderless ‹ › (44px) beside a left-aligned month name, 44px day
  circles, selection = filled #7a52e6 circle (pops in), today = purple text + dot, Sundays red, a full-width soft-purple
  「오늘 · 10월 15일」 button; horizontal swipe on the grid pages months (`data-swipe-back="off"`) and the new month slides in
  from that side (off under reduced motion).
  **Sheets don't leak pointer gestures (2026-10-15):** portals still bubble React pointer events up the React tree, so the PC
  「모바일 보기」 mouse pull-to-refresh read a sheet drag-down as a refresh too. `BottomSheet`'s root (and the automation confirm
  overlays) stop **`pointerdown` only** — the shell arms its drag on pointerdown, so that is enough. Do NOT stop pointermove/up:
  React's `stopPropagation` also stops the native event before `window`, which killed the sheet's own drag-to-dismiss
  (`useSheetDragDismiss` listens on window). Mobile automation preview / assignee date now use it instead of a native input. **The
  console is separate**: it keeps the `.calpop` `AdminDatePicker` per §4a, and the two are never
  mixed. First caller: the cleaning day switcher; other mobile screens should reuse this rather than
  hand-rolling a calendar.
- **Fallback screens use the real app icon (2026-08-04)**: `error.tsx` and `/offline` were drawing a
  gradient box with an italic "S" — a mark that exists nowhere else in the product and is not the
  logo. Both now render `public/icons/icon-192.png`, the same PWA icon `not-found.tsx` and the splash
  screen already used, so cold-launch / error / 404 / offline read as one brand. `/offline` uses a
  plain `<img>` (not `next/image`) because the service worker serves it with no network, so
  `/_next/image` is unreachable; the icon is added to the SW precache list (`OFFLINE_ICON`) and the
  static cache name is bumped to `stayops-static-v2` so installed clients pick it up.
- **Fallback screens follow the viewer's language (2026-08-04)**: `/mobile` `error.tsx` and
  `not-found.tsx` used to stack ko + ja + en at once, justified as "renders without session locale
  context". That was wrong on both: the root layout writes the session language onto `<html lang>`
  (readable from the client error boundary), and `not-found.tsx` is a server component that can read
  the session directly. Both now render **one** language, `ko` when unknown. This also fixed a real
  layout break — the stacked labels wrapped mid-word and the `<Link>`'s fixed `leading-[44px]` pushed
  "Home" outside its pill on a phone. Copy lives in `src/lib/fallback-copy.ts`, deliberately separate
  from `src/lib/i18n.ts`: these screens must render when the rest of the app is broken, so they must
  not pull in the 11k-line dictionary chunk. **`/offline` stays trilingual** — the service worker
  serves it from cache with no network, no session, and no server render.
- **Root 404 (2026-10-23)**: `src/app/not-found.tsx` covers unknown URLs outside `/mobile` and `notFound()` from `/admin`
  detail pages (before, Next's English default 404 showed). Same copy table (`src/lib/fallback-copy.ts`) and look as the
  mobile 404; language = session → `stayops_locale` cookie → Accept-Language (same order as the root layout's `<html lang>`);
  「home」 goes to `/`, which re-routes by device. `/offline` now also sets the tab title in the device language.
- **Error / 404 / offline screens (2026-06-22)**: `/mobile` has branded trilingual `error.tsx` (retry/home) and `not-found.tsx` (deep-links to deleted records); `/offline` (SW fallback) auto-reloads when back online. The service worker reloads the client once on `controllerchange` after a deploy so users aren't stranded on the old shell. Keyboard focus uses a global `:focus-visible` outline (restored after the tap-highlight removal); `animate-spin` honors reduced-motion.
- **Scroll restoration keying (2026-06-22)**: restoration is keyed by the full URL (path + query) via `window.location`, since list screens vary content by query (`?view=`/`?month=`) on one pathname.
- **In-app photo viewing**: mobile photo attachments open in the shared `ImageLightbox` (`src/components/shell/image-lightbox.tsx`, via `LightboxThumbs`), **not** `target="_blank"` — a new tab ejects the installed standalone app into Safari. New image surfaces must reuse the lightbox. Genuine external destinations (maps, shopping links, mailto/tel) intentionally still leave the app.
- **Route loading**: ~~ivory skeleton~~ → 2026-10-14 공용 로더 → **2026-10-21 로딩 자리 셸**(위 「로딩 자리 셸」).
- **PWA install / icons / offline (2026-06-22)**: `public/manifest.webmanifest` has a full icon set (`/icons/icon-192`, `icon-512`, `maskable-512`), `id`/`scope` `/`, and `start_url: /mobile`; `layout.tsx` `metadata.icons` adds the iOS `apple-touch-icon` plus a `/favicon.ico` (Safari bookmark/tab icon). A conservative service worker (`public/sw.js`, registered prod-only by `ServiceWorkerRegister` in `layout.tsx`) makes the app installable on Android and serves an `/offline` fallback; navigations stay **network-first** (no stale HTML/RSC), only content-hashed static assets are cached. Bump `CACHE` in `sw.js` to invalidate static cache on deploy. **Dev kill switch (2026-09-28)**: under `next dev`, `next.config.ts` rewrites `/sw.js` (`beforeFiles`) to `public/sw-dev-reset.js`, which clears every cache, unregisters itself and reloads open tabs — so a prod SW left on `localhost:3000` from an earlier `npm start` can no longer serve stale chunks to the dev server (symptom: infinite loading after deleting `.next`, fine in incognito). Production still serves the real `public/sw.js`.
- **App icon (2026-10-09 — "folded linen" mark, replaces the 2026-06-23 grey "open door")**: lavender `#EFE7FF` square with three stacked rounded bars in violet tones. Defined as vector in `scripts/dev/generate-app-icons.mjs` (`BG` / `MARK`, also written to `public/brand/logo.svg`), which regenerates `icon-192` / `icon-512` (rounded, transparent corners), `maskable-512` (full bleed, mark in safe zone), `apple-touch-icon` (180, opaque), `favicon.ico` (16/32/48), the link-preview image `src/app/opengraph-image.png` (1200×630 — og:image for KakaoTalk/Slack cards, added 2026-10-16 after KakaoTalk kept showing the old grey door; `layout.tsx` also sets `openGraph` title/description) and the native app icons; then `node scripts/gen-splash.mjs` for the iOS PWA splash images. In-app uses (launch splash, offline / 404 / error screens, admin sidebar mark, login brand mark) all read `/icons/icon-192.png`. (The navy "S" `generate-pwa-icons.mjs` flow stays retired.)
- **Launch splash (2026-06-23, tuned 2026-07-17)**: `SplashScreen` (`src/components/pwa/splash-screen.tsx`, mounted in `layout.tsx`) shows the app icon centered on the ivory canvas — with the **"Foldy" wordmark** (shared `.wordmark` serif-italic) near the bottom center above the safe-area inset — only **briefly** on a real launch / refresh / standalone cold-start. The current timing is **~160ms hold + ~180ms fade** (previously ~850ms + ~420ms, which made cold launch feel sluggish on iPhone home-screen installs). It is server-rendered so it is visible at first paint with no blank flash, and it is now **non-interactive** (`pointer-events: none`) so it never blocks early touches while fading. `splash-pop` keyframe (icon scale-in) lives in `globals.css` and is neutralized under `prefers-reduced-motion`.
  - **Stuck-splash guard (2026-10-09)**: the splash only closes once React hydrates. Right after a deploy the service worker may serve the cached (stale) document whose `/_next/static` chunks no longer exist → no hydration → Safari stayed on the icon screen until a manual refresh. Two layers now: (1) `STALE_CHUNK_RECOVERY_SCRIPT` (`src/lib/stale-chunk-recovery.ts`, inline in `<head>`) catches a failed Next chunk load and reopens the page once with `?__fresh=` (misses the SW cache → fresh document), then strips the param before the app reads the URL; 10-second loop guard. (2) CSS `splash-failsafe` in `globals.css` hides `[data-splash]` after 2.5s even without JS.
- **Home cold-start query trimming (2026-07-17)**: `/mobile` no longer does an extra `getOnboardingState()` round-trip after middleware has already gated unauthenticated users; the page now relies on `getCurrentAppSession()` only and sends missing/incomplete sessions straight to `/onboarding`. The home also fetches only the **latest important announcement** instead of the full published-announcement list with author/comment metadata, and its initial shell badges are trimmed to the **notification count only** so the installed PWA's first home render does not wait on the full advisory badge fan-out.
- **Side menu**: tapping the menu button opens a left slide-in **full-screen navigation sheet** (`w-full`) rather than a partial-width drawer. The old 78% drawer + exposed dimmed right-side sliver repeatedly made iOS standalone/PWA status-bar and top-edge transitions look broken; the full-screen sheet makes the menu read as the current screen, closer to native app navigation patterns such as ChatGPT's mobile sidebar. Opening/closing uses a 360ms transform transition. Layout top→bottom:
  - **Status-bar blend:** the full-screen sheet's top background starts from `var(--background)`, the same ivory used by `viewport.themeColor` / the root canvas, and only transitions to the warmer sidebar gradient after `calc(env(safe-area-inset-top) + 64px)`. This avoids a fixed-height guess and keeps Dynamic Island / notched iPhones reading as one continuous menu surface.
  - **Safari seam fixes (2026-06-23):** the sidebar no longer draws a bright `border-r` divider on its right edge, and the now-invisible old scrim layer was removed entirely. A full-width panel does not need a dimmed exposed region; removing the dead layer avoids extra iOS compositing/sampling work that could reintroduce status-bar or top/bottom seam flashes.
  - **Shared chrome while open/closing:** when the side menu opens, the shared top bar and bottom tab bar temporarily slide/fade out. They stay locked hidden until the close transition finishes, so the header/tab bar cannot reappear underneath the sliding panel for a few frames.
  - **내용 — 화이트 리디자인(2026-10-15, 시안 Menu-Phone)**: 서랍 안은 `MobileMenuPanel`(`src/components/shell/mobile-menu-panel.tsx` + `mobile-menu.css`)이 그린다. 서랍 자체(`<aside>` · 열고 닫는 움직임 · Esc · `data-native-back-overlay` · 폴드 360px)는 `MobileShell` 그대로. 위→아래:
    - **닫기** — 오른쪽 위 44px `X`(시안에는 없지만 iOS 에서는 서랍을 닫을 다른 길이 없어 남겼다). 「Foldy」 워드마크 줄은 뺐다.
    - **내 정보 줄** → `/account?mode=mobile`: 48px 이니셜 동그라미(#ede7fc / #5a30cf) · 이름 17px 굵게 · `조직 이름 · 역할` 13px 회색 · 옅은 `ChevronRight`. 상자 · 테두리 없음.
    - **기능 검색** — 46px 옅은 회색(#f4f4f7) 칸, 16px 글자(iOS 확대 방지). 화면 안에서만 거른다: 보이는 메뉴(일반 + 운영 관리자) 중 ko · ja · en 이름이나 짧은 이름에 검색어가 들어간 것만 한 줄 목록으로. 검색 중엔 자주 쓰는 기능 · 묶음 제목을 숨기고, 없으면 `common.menuSearchEmpty`. 서랍이 닫히면 검색어를 비운다.
    - **자주 쓰는 기능**(`common.menuFrequent`) = **내 하단 탭**(권한으로 거른 `bottomItems`) 4칸 — 56px 옅은 보라(#f4f1fd) 타일 + 짧은 이름. 아래 얇은 선.
    - **묶음 목록** — 「업무」(`common.menuGroupWork`: 홈 · 예약 캘린더 · 청소 · 요청 · 투두이스트 · 근태 · 린넨 반품) · 「소통」(`common.menuGroupComms`: 공지 · 게시판 · 게스트 피드백 · 제안함 · 직원 목록) · 「운영 관리자」(`mobileOpsAdminNavigation` — 가동률 · 매출 · 자동화 · 판매 캘린더 · 룸 링크, 권한 없으면 구역째 없음). 묶음은 패널의 `COMMS_IDS` / `WORK_ORDER` 로 나누고, 거기 없는 새 메뉴는 「업무」 끝에 붙는다. 한 줄 50px · 아이콘 21px 회색 · 16px 글자 · 오른쪽 갯수(회색 숫자). **고른 줄은 옅은 보라 바탕(#f4f1fd) + 보라 글자만** — 왼쪽 막대는 없앴다.
    - **아래 줄** — 「계정 설정」(`common.accountSettings`, 톱니) · 「버그 신고」(`mobileNavBugs`) 두 개, 위에 얇은 선. **로그아웃은 메뉴에서 뺐다** — 계정 화면(`/account`)에 있다(시안 그대로). 태블릿 사이드바(`MobileSideNav`)의 로그아웃은 그대로.
    - **움직임** — 줄 · 타일 · 아래 링크를 누르면 .97 로 살짝 눌림, `prefers-reduced-motion` 이면 끈다.
  - The side menu lists Cleaning (in addition to the bottom-bar tabs) since Cleaning is not a bottom tab.
- **Bottom navigation**: a bottom-attached `bg-surface` bar (`.tabbar` in `src/app/globals.css`) with rounded top corners (`border-radius: 22px 22px 0 0`) and a soft top shadow. Layout is four tabs split 2 / 2 around a raised central FAB. Active color `var(--primary)`, inactive `var(--muted-foreground)`. The bottom bar renders the user's customized tabs via `resolveBottomNavItems(session.user.bottomNavTabs)`, split left/right around the center FAB. The center FAB is a 52px **squircle** (rounded square, `border-radius: 17px`) with a navy gradient (`linear-gradient(160deg, hsl(223 50% 42%), hsl(223 54% 22%))`), raised above the bar (`margin-top: -26px`, 4px ivory border + shadow) per the "Bottom Bar (Squircle Edit)" design, labelled `dictionary.common.editBottomBar` ("하단바 편집") with an **app-grid icon** (2×2 squares); tapping it opens the bottom-bar editor sheet (`createOpen` state) where the user toggles which features (max 4) appear. **편집 시트 — 화이트 리디자인(2026-10-15, 시안 TabEdit-Phone)**: 본문은 `TabEditor`(`src/components/shell/tab-editor.tsx`, 스타일 `mobile-menu.css`). 머리(끌어내림 자리) = 제목 「하단 탭 편집」(`common.tabEditTitle`) + 「최대 4개 · 끌어서 순서를 바꾸고 「−」로 빼요」(`common.tabEditSub`). 위 **지금 탭** 줄(옅은 보라 #faf8ff 판, 4칸) — 타일을 **옆으로 끌면 순서가 바뀌고**(포인터, 6px 넘게 움직이면 시작 · 칸을 넘을 때마다 햅틱; 줄에 `data-swipe-back="off"` · `touch-action: none`), 오른쪽 위 **흰 「−」 동그라미**(흰 바탕 · 옅은 테두리 · 그림자 · 진한 빼기, 손가락 자리 44px)를 누르면 타일이 줄어들며 사라진다(180ms). 마지막 하나는 「−」가 없다. 아래 **더할 수 있는 기능**(`common.tabEditAddable`) 4열 격자 — 누르면 탭 끝에 들어가며 톡 튀어나온다(되돌아온 타일도 같다). 4개가 차면 격자가 흐려지고 안내가 `common.bottomBarFull` 로 바뀐다. 맨 아래 전폭 보라 「완료」(`common.tabEditDone`) = 시트 닫기. 아이콘은 사이드 메뉴와 같은 `item.icon`(lucide), 이름은 탭과 같은 짧은 이름. 예전 2열 체크 타일(`.add-tile`)은 이 시트에서 안 쓴다. Edits (추가 · 빼기 · **순서**) persist to `profiles.bottom_nav_tabs` on close (any close path — 완료 · 끌어내림 · 바깥 탭 · Esc), same as before. `env(safe-area-inset-bottom)` padding handles the iOS home indicator.
- **Accessibility**: the `title` prop on `MobileShell` is used as `aria-label` on `<main>`. It is not rendered visually in the header. Page content provides its own visual hierarchy.
- **Appearance prop**: `appearance` remains accepted for compatibility but currently does not change shell visuals. Do not rely on it for page tinting.
- `ModeSwitcher` is not part of the shell header. The notification `Bell` is part of the current header; there is no theme switcher because the app is light-mode-only.
- **Browser chrome tint (theme-color)**: iOS Safari status bar / URL toolbar are tinted via `viewport.themeColor` in `src/app/layout.tsx`. It is declared for **both** `light` and `dark` schemes with the **same ivory `#f7f4ee`**, so that the top status bar and bottom URL toolbar stay unified with the app's ivory chrome even when iOS is in dark mode (a single themeColor is ignored in dark mode, falling back to black system chrome). This forces the light design in both schemes and is not a design change. safe-area handling in `mobile-shell.tsx` is unaffected. (In-app browsers like KakaoTalk/Instagram ignore theme-color and are out of scope.)
- **Color scheme lock (2026-06-22)**: `viewport.colorScheme = "light"` in `src/app/layout.tsx` (renders as `<meta name="color-scheme" content="light">`). Without this, iOS Safari in OS dark mode treats the page as dark-mode-capable and paints the canvas + system chrome dark — even when `themeColor` is set to ivory — which became most visible after the sidebar opened (the dim scrim made Safari's chrome sampling commit to black for the status bar + URL toolbar). Locking the page to the light scheme suppresses the dark-mode fallback so the ivory chrome holds in both light and dark device modes, with or without the sidebar scrim. Not a design change — the app's surfaces remain identical.
- **PWA manifest chrome (2026-06-22)**: `public/manifest.webmanifest` `theme_color` / `background_color` were stale pre-rebrand values (`theme_color: #00796f` teal, `background_color: #fbfcfc` near-white). Both corrected to ivory `#f7f4ee` to match the `viewport.themeColor` and the ivory canvas. In **installed / standalone** PWA mode (Add to Home Screen) the manifest — not the in-page meta — drives the OS status-bar tint and the launch splash background, so the stale teal would have surfaced there. The teal value also violated the "teal/green retired" brand rule. **Note:** in regular in-browser Safari (URL bar visible) the system chrome is governed by the in-page `themeColor` + `colorScheme` meta above, not the manifest; the manifest only takes effect once the app is installed to the home screen.
- **Root (`html`) background — standalone safe-area black bands (2026-06-22)**: `src/app/globals.css` now paints the ivory `--background` on **both `html` and `body`** (previously only `body`). In an installed/standalone iOS PWA the region behind the status bar / notch — and any safe-area or overscroll band — exposes the **root `<html>` element's** background; with no background on `<html>` iOS painted those bands **black**, most visibly when the sidebar opened and the layout repainted (and on the attendance/standalone screens). Painting `<html>` ivory removes the black bands. `apple-mobile-web-app-status-bar-style` stays `"default"` (dark text on light) — correct for a light app; `black-translucent` is intentionally **not** used (it would force invisible white status-bar text on ivory). Not a design change; the visible canvas was already this ivory.

### Capability-gated menu items — 판매 캘린더 (2026-10-01)

- 사이드 메뉴 항목은 `capability` 를 가질 수 있다. `canSeeNavItem(item, session.capabilities)`
  (`src/config/navigation.ts`)가 **사이드 메뉴 · 하단 탭 · 하단 탭 편집 후보** 세 곳을 모두 거른다 — 권한이 없으면
  메뉴가 아예 안 보이고, 예전에 탭으로 골라 둔 항목도 탭 바에서 빠진다(접근 자체는 페이지가 서버에서 다시 막는다).
- **넓은 화면 — 레일 · 사이드바(2026-10-05, 01번 결정 로그 「태블릿 · 펼친 폴드 = 네이티브 적응형」, 시안 6b · 6c)**: 폭 구간은
  `globals.css` 의 두 변형 — `fold:`(≥ 600px: 펼친 폴드 · 태블릿 세로 · 가로 폰) · `tablet:`(≥ 1000px 이면서 높이 ≥ 600px:
  태블릿 가로). **CSS 로만** 바뀐다(처음 그릴 때 폭을 몰라도 깜빡이지 않게).
  **2026-10-06 `tablet:` 을 840 → 1000 으로 올렸다(갤럭시 폴드 실측).** 펼친 폴드 가로는 841 × 673 이라 840 을 겨우 넘어 248px 사이드바 +
  태블릿 배치가 켜졌고, 본문 590px 남짓에서 홈 출근 제목이 한 글자씩 세로로 서고 청소 · 근태 · 2분할 칸이 짓눌렸다. 이제 폴드 가로는
  레일 + 폴드 배치, 아이패드 가로(1133 · 1180 · 1366)만 태블릿 배치. JS 판정(`TABLET_QUERY`)과 화면 CSS 의 `@media` 도 같은 값.
  - 폰(< 600): 지금 그대로 — 430px 한 줄 · 위 머리(햄버거 · 워드마크 · 알림 · 내 정보, 스크롤하면 숨음) · 하단 탭 바 + 가운데 편집.
  - `fold:`: 셸이 폭 전부. **하단 탭 바 · 위 머리를 숨기고 왼쪽 레일**(`MobileSideNav`, 78px): 햄버거(전체 메뉴 서랍 —
    넓은 화면에서는 왼쪽 360px + 뒤 어둡게) · 편집 버튼(하단 탭 편집 시트) · **하단 탭에서 고른 탭**(아이콘 + 짧은 이름 · 갯수) ·
    알림(갯수) · 내 정보(이름 첫 글자). 키 낮은 가로 폰에서는 레일이 세로로 넘어간다. 스크롤해도 크롬을 숨기지 않는다.
  - `tablet:`: 레일 대신 **펼친 사이드바**(248px): 워드마크 · 알림 · 접기 버튼, 전체 메뉴(갯수 — 알림 · 요청은 빨강) + 운영 관리자
    구역, 아래 내 정보 · 버그 신고 · 로그아웃. **접기**를 누르면 레일로(기기에 기억 — `localStorage` `stayops.navCollapsed`),
    레일 아래 펼치기 버튼으로 되돌린다.
  - 본문: 아직 넓은 화면용으로 다듬지 않은 화면은 **가운데 760px 한 줄**(`fold:max-w-[760px]`) — 폰 화면이 끝없이 늘어나지
    않게. `wide` 를 켠 화면(판매 캘린더 · 홈)은 폭 전부를 쓰고 스스로 배치한다(홈 = 2열/3열 — `home-screen.css` `.hm__grid`).
    **홈 정렬(2026-10-06, 아이패드 실기기 지적 「수평이 안 맞는다」)**: 칸마다 제목이 같은 높이에서 시작하고 같은 줄 카드는 윗선 · 아랫선이
    같다. 태블릿 가로 = 공지(있을 때만) 한 줄 → 「근태(출근) · 오늘 체크인/아웃 · 오늘 기록」 → 「빠른 실행 · 진행 중 작업」. 출근 카드에도
    넓은 화면에서만 칸 제목(`.hm__wide-only` — 근태)을 단다. 같은 줄 카드는 늘려 높이를 맞추고(체크인/아웃 카드는 숫자 · 이름을 아래로),
    오늘 기록만 내용 높이. 폴드 2열도 같은 규칙.
  - 판매 캘린더는 탭 바가 숨으면(`getClientRects()` 가 비면) 창 바닥까지 격자를 늘린다.
  - 문구 `common.collapseMenu` · `expandMenu`(ko/ja/en).
- **화면별 넓은 화면 대응 현황(2026-10-05 — 「모든 화면은 폴드 · 태블릿 대응」 결정, `01-decision-log.md`)**. 셸의 가운데 760px 는
  미적응 화면의 비상 처리이지 대응이 아니다. 새 화면은 이 표에 넣고 세 폭(폰 · 폴드 · 태블릿 가로)을 확인한다.

  | 상태 | 화면 |
  | --- | --- |
  | ✅ 전체 화면(셸 없음) | **재류카드 · 마이넘버 카드 등록** `/account/id-card`(2026-10-23: 폰 한 단 · 폴드 확인 화면 사진 \| 칸 2열 · 태블릿 촬영 화면 오른쪽 단계 칸 — `41-residence-card-workflow.md` §10) |
  | ✅ 폭 전부(`wide`) | **청소 현황판** `/mobile/cleaning`(배정 담당, 2026-10-28: 폰 한 단 + 바닥 시트 · 폴드 건물 2열 + 시트 · 태블릿 가로 오른쪽 380px 칸에서 담당 넣기 — `07-cleaning-workflow.md`) · 홈 `/mobile` · 판매 캘린더 `/mobile/ops/calendar` · **예약 캘린더** `/mobile/calendar`(격자는 날짜 칸 고정 폭이라 넓을수록 더 많은 날, 목록 = 체크인 · 체크아웃 · 숙박 중 폴드 2열 · 태블릿 3열, 건물 정보 카드 2/3열) · **게시판 신고 처리** `/mobile/board/reports`(묶음 줄 폰 1 · 폴드 2 · 태블릿 3열, 2026-10-06 · 화이트 2026-10-15) · **내 시프트** `/mobile/shift` · **사람별 시프트**(관리자) `/mobile/users/[id]/shift`(폰 시트 · 폴드 달력 아래 · 태블릿 오른쪽 칸, 2026-10-23) · **오늘 내 방** `/mobile/shift/today`(2026-10-21: 폰 한 단 · 폴드 가운데 600px · 태블릿 가로는 달력/목록 + 오른쪽 380px 옅은 회색 칸(다가오는 일정 · 고른 날 · 고른 방), 칸 사이 세로줄 없음 · 2026-10-22 HIG 다듬기 — 폰은 「청소 시작」이 탭 바 위 sticky — `37-cleaning-shift-assignment.md`) |
  | ✅ 목록 → 상세 2분할(`split` + `SplitList`) | 할 일(+ 프로젝트 — **2026-10-15 화이트 리디자인**: 오늘 · 내일 · 관리함은 목록 \| 상세 칸, 고른 줄 옅은 보라 · 목록과 칸 사이 세로줄 없음. 완료 · 지시 · 프로젝트 · 캘린더는 칸이 비어 있으면 넓게(최대 720 · 캘린더는 달력 \| 고른 날 목록), 줄을 눌러 칸이 열리면 2분할로 — `18-todo-task-workflow.md` 「화이트 리디자인 — 모바일」. 할 일 상세 · 새 할 일 · 수정을 화면으로 열면(폴드 · 태블릿에서 칸 밖, 2026-10-29) 버그 · 제안함처럼 가운데 540px 한 줄) · 요청(+ 처리 끝난 분실물) · 컴플레인 · 공지 · 게시판 · **제안함**(2026-10-15 화이트 리디자인: 목록 400px \| 칸, 연 줄 옅은 보라 · 세로줄 없음, 폴드는 가운데 540px 한 줄 — `22-staff-suggestions-workflow.md` 「화이트 리디자인 — 모바일」) · **버그**(2026-10-15 화이트 리디자인: 같은 방식, 새 신고 폼은 셸 안 가운데 540px — `25-bug-report-workflow.md` 「화이트 리디자인 — 모바일」) · 린넨 반품 기록 · **린넨 장부**(기록 → 칸) · **사용자 관리**(2026-10-20: 멤버 목록 \| 멤버 상세 칸, 고른 줄 옅은 보라 · 초대코드 탭은 한 단 — `17-user-profile-directory.md` 「모바일 사용자 관리」) · **직원 서류**(2026-10-26: `/mobile/users/documents` 목록 \| 확인 칸 · 대신 올리기 폼, 패턴 `staffDocs`, 폰 탭 이름 「서류」 · 폴드는 화면 이동 + 올리기 폼 두 단 — `41-residence-card-workflow.md` 「R4 구현」) · **알림**(알림이 가리키는 상세를 칸에 — `SPLIT_DETAIL_PATTERNS.notifications` = 위 상세 주소 전부, `useSplitPush`. **2026-10-15 화이트 리디자인**: 목록 400px \| 칸, 연 줄 옅은 보라 · 세로줄 없음 · 태블릿에선 밀기 없음, 폴드는 가운데 540px 한 줄 — `14-notification-design.md` 「알림 화면 — 화이트 리디자인」) |
  | ✅ 칸 직접(`split` + `useIsTablet`) | **룸 링크**(2026-10-15 화이트 리디자인: 태블릿 가로 건물 목록 \| 객실 \| 상세 칸, 폴드는 폰과 같은 한 줄 540px) · **청소 기록**(기록 \| 상세 칸, 폴드는 날짜 묶음 2열) · **근무 기록**(2026-10-13 리디자인: 태블릿 가로 달력 \| 월 기록, 상세는 시트 · 폴드는 한 줄) · **직원 목록**(2026-10-14 리디자인: 태블릿 가로 목록 \| 프로필 칸, 폴드는 한 줄에 번호까지) · **예약 캘린더 리스트 · 지도**(2026-10-14 리디자인: 태블릿 가로 목록 \| 예약 상세 / 건물 \| 출입 정보) |
  | ✅ 두 칸 배치(`split` + 화면 CSS) | **가동률** `/mobile/ops/occupancy`(2026-10-15: 태블릿 링 · 앞으로 3달 \| 건물별 + 아래 월별 추이, 폴드 540px 한 줄) · **매출** `/mobile/ops/revenue`(2026-10-15: 태블릿 총매출 · 숫자 · 채널 \| 건물별 + 아래 월별 매출 15칸, 폴드 540px 한 줄 · 월별 9칸, 폰 7칸) · **자동화** `/mobile/ops/automation`(2026-10-15: 태블릿 오늘 발송 + 목록 330px \| 상세 직접 그림, 폴드 540px 한 줄 · 목록 → 상세 `?job=`) · **근태 홈**(2026-10-19: 태블릿 제목 아래 링 · 출퇴근 \| 바로가기 · 오늘 기록 두 칸 같은 폭, 폴드 520px) · **급여**(태블릿: 급여 카드 · 구간 \| 일별 표) · **급여 준비**(관리자) `/mobile/payroll`(2026-10-25, 알바 급여 P3: 폰 한 줄 목록 → 하단 시트 · 폴드 표(이름 · 시간 · 총지급 · 실수령) → 같은 시트 · 태블릿 가로 목록 \| 사람 칸(시트 없음) — `39-part-time-payroll-automation-plan.md` §5-A. P5(2026-10-26) 결재 · 지급: 폰 맨 위 「결재할 급여」 카드 → `?view=approve`, 폴드 표 + 아래 막대, 태블릿 확인표 \| 320px 결재 칸 · 지급 현금 \| 이체 두 단 — 39 「P5 구현」) · **휴가 달력**(태블릿: 달력 \| 휴가 목록) |
  | ✅ 카드 여러 열(`split`) | **청소**(줄 목록 — 폴드 = 청소 목록 \| 셋팅 목록 + 오늘 기록 2열 · 태블릿 = 3열, 진행 중 링은 태블릿에서 링 \| 버튼, 2026-10-13 화이트) · **린넨 반품 건물 고르기**(폰 2 · 폴드 3 · 태블릿 4열) · **출근자 명단**(출근 중 · 퇴근 완료 섹션 나란히) |
  | ✅ 한 칼럼이 맞는 화면 | 위 목록들의 상세 · 새로 만들기 · 수정 화면(태블릿에선 2분할 칸 안에 열림 — **게시판 글쓰기 · 수정**은 2026-10-15부터 셸 안 560px 가운데 폼), 근태 찍기 · 정정 · 휴가 신청 흐름, **교통비**(청구서 한 장 — 문서형이라 가운데 문서 폭이 맞다) · **계정** `/account?mode=mobile`(2026-10-15 화이트 리디자인: 묶음 줄 한 칼럼, 폴드 · 태블릿 가운데 540px — `17-user-profile-directory.md` 「계정 화면 — 화이트 리디자인(모바일)」) |
  | ⬜ 적용 필요 | — (2026-10-05 기준 없음. 새 화면은 이 표에 넣는다) |

  **아이패드 실측 점검(2026-10-06)** — 24개 화면을 가로 1180×820 · 세로 820×1180 로 찍어 고친 것: 룸 링크 가로(사이드바 때문에 가운데
  칸이 좁아 객실 카드가 깨짐 → 세 칸 폭 176 · 1fr · 320–380, 객실은 칸 폭에 맞춰 1~2열, Booking 줄 줄바꿈) · 홈(한국어 어절 단위 줄바꿈
  `:lang(ko) word-break: keep-all`) · 예약 캘린더 건물 고르기(2026-10-15 지도 | 목록 — 지도: 폰 위 · 폴드 카드 위 · 태블릿 가로 지도 왼쪽 + 목록 오른쪽, `docs/product/15-reservation-calendar.md` → 「건물 지도」) · 청소 기록 · 근태 기록(상세 칸이 있을 때만
  두 칸 — 기록이 없는 달에 왼쪽이 반쪽이던 것). 스크린샷은 로그인한 전용 Chrome 프로필로 찍는다(개발 서버).

  **갤럭시 폴드 실측 점검(2026-10-06)** — 접은 커버 344×882 · 펼친 세로 673×841 · 펼친 가로 841×673. 펼친 가로가 태블릿 배치로 짓눌려
  `tablet:` 을 1000 으로 올렸고(위), 커버 화면의 알림 머리 버튼(「모두 읽음」 · 「삭제」)이 한 글자씩 서던 것을 줄바꿈 금지로 고쳤다.
  **윈도 헤드리스 Chrome 은 창 폭을 500px 아래로 못 줄이고 높이를 95px 남짓 먹는다** — 정확한 크기는 같은 출처 프레임(정해진 폭 · 높이의
  `<iframe>`)에 띄워 찍고 잘라 낸다.

- **목록 → 상세 2분할(2026-10-05, 시안 7a)**: `tablet:` 에서 목록 화면은 왼쪽 목록(400px, 따로 넘어감) · 오른쪽 상세 칸이다.
  `SplitList`(`src/components/shell/split-list.tsx`)로 목록을 감싸고 `MobileShell split` 을 켠다(그 폭에서 760px 제한을 푼다).
  - 오른쪽 칸 = **그 상세 화면을 그대로** 같은 출처 프레임(`name="stayops-pane"`, 주소에 `?pane=1`)으로 띄운다 — 상세 화면 코드는
    바꾸지 않는다. 프레임 안은 「칸 모드」(`html[data-pane]` — `<head>` 의 `beforeInteractive` 스크립트가 그리기 전에 붙인다):
    레일 · 사이드바 · 위 머리 · 탭 바 · 시작 화면(스플래시) 없이 본문만(최대 760px).
    앱 스플래시(`src/app/mobile/layout.tsx` 의 `AppSplash`, 새로고침 · 화면 껐다 켬마다)도 칸 안에선 나오지 않는다(`src/lib/entry-replay.ts`).
  - 목록 안 링크가 상세 주소면 넘어가지 않고 칸에 연다. 코드로 여는 곳은 `useSplitPush()`(할 일 카드 · 프로젝트 화면 · 발주 납품 달력).
    고른 줄은 남색 테두리(`a[data-split-active]`). 칸 위 얇은 줄에 닫기 버튼 · 불러오는 동안 가는 진행 줄.
  - 칸 안에서 **서버 액션이 끝나면**(POST + `next-action` 머리 — 부트 스크립트가 감지) 부모에 알려 왼쪽 목록을 새로 읽는다.
    칸이 **상세 밖으로** 가면(삭제 후 목록 · 예약 보기 같은 다른 화면) 칸을 닫고 부모가 그 주소로 간다. 폭이 줄어 태블릿 가로가
    아니게 되면(회전) 열려 있던 상세로 넘어간다.
  - 대상과 상세 주소(`SPLIT_DETAIL_PATTERNS`, `src/lib/split-pane.ts`, 테스트 `split-pane.test.ts`): 할 일(+ 프로젝트 화면) · 요청
    (수리 · 분실물 · 발주, 처리 끝난 분실물 목록 포함) · 컴플레인(+ 리뷰) · 공지 · 게시판 · 제안함 · 버그 신고 · 린넨 반품 기록 · 사용자 관리 멤버 상세(2026-10-20) · 직원 서류 한 사람(2026-10-26).
    새로 만들기 · 하위 목록은 칸에 열지 않는다. 폰 · 폴드에서는 아무것도 바뀌지 않는다.
  - **상세가 따로 주소가 없는 화면은 칸을 직접 그린다** — 룸 링크(`/mobile/ops/room-links`, 2026-10-05): `split` 을 켜고
    `useIsTablet()` 으로 시트 대신 오른쪽 상세 칸(대시보드 1b 와 같은 3열 — 건물 목록 · 객실 · 상세). `35-room-links.md` → 「모바일」.
  - 문구 `common.splitEmpty`(빈 칸 안내) · `common.close`(ko/ja/en).
- **아이패드 = 모바일 앱(2026-10-05)**: 아이패드 사파리는 Mac 으로 알려 서버가 PC 로 본다. `TouchTabletDetect`(루트 레이아웃)가
  「터치 되는 Mac」(`maxTouchPoints > 1`)을 알아보고 쿠키 `stayops_touch_tablet=1`(1년)을 심고, PC 쪽 화면(`/` · 로그인 · `/admin`)에
  있었으면 한 번 다시 부른다. `getDeviceSurface` 가 쿠키를 보고 모바일로 판정 — 미들웨어가 `/admin` 대신 `/mobile` 로 보낸다.
  진짜 Mac 은 `maxTouchPoints` 가 0. 테스트 `mobile-device.test.ts`.
- **BottomSheet — 키 낮은 화면(2026-10-02)**: 높이 560px 아래(가로 모드)면 폭 600px · 최대 높이 94dvh 로 넓힌다
  (`[@media(max-height:560px)]` — 시트마다 준 max-h 보다 우선).
- **BottomSheet — 넓은 화면(2026-10-05)**: `fold:` 폭 560px(바닥에서 올라옴). `tablet:` 은 **가운데 카드**(아이패드 양식 시트) —
  네 모서리 둥글게 · 그림자 · 최대 높이 86dvh, 아래에서 40px 만 올라오며 나타난다. 끌어 닫기 · 스크림 · Esc 는 그대로.
  - **예외 — 출근 QR 결과(화이트 리디자인 시안, 2026-10-09 사용자 결정, 구현 전)**: 카메라 화면 위의 「출근했어요」 결과는
    `tablet:` 에서도 가운데 카드가 아니라 **바닥에서 올라오는 시트**(폭 560px)로 띄운다 — 가운데 카드가 QR 틀을 가리기 때문.
  - **예외 — 약관 보기(2026-10-09 사용자 결정, 구현)**: 로그인 · 가입의 이용약관 · 개인정보 처리방침은 그 자리에서 시트로 열고, `tablet:` 에서도
    바닥 시트다. **PC(≥ 1200px)만 가운데 팝업**(닫기 X · 「새 창에서 보기」). `BottomSheet` 의 `tabletLayout="bottom"` 으로 켠다
    (`src/components/legal/legal-overlay.tsx`). 출근 QR 결과도 구현할 때 같은 옵션을 쓴다.
- **운영 관리자는 별도 구역이다**(2026-10-01 사용자 지시 — 「일반 사이드바에 넣으면 안 된다, 대시보드처럼 구분」).
  `mobileOpsAdminNavigation`(`src/config/navigation.ts`)은 `mobileSidebarNavigation` 과 **다른 목록**이고, 사이드 메뉴
  아래쪽에 구분선 + 제목(`admin.console.navGroupOpsAdmin` — 운영 관리자 / 運営管理者 / Revenue Ops)을 단 구역으로 그린다.
  데스크톱 사이드바가 「운영 관리자」 묶음을 맨 아래 따로 두는 것(`adminNavGroupOf` → `ops`)과 같은 규칙이다.
  **하단 탭 편집 후보에는 넣는다**(2026-10-02 사용자 지시로 변경 — 예전엔 뺐다): `customizableBottomNavItems` = 일반 메뉴
  + 운영 관리자 구역(후보 맨 뒤). 탭 라벨은 축약형 `opsCalendarShort`(판매 / 販売 / Sales). 셸의 `canSeeMobileNavItem` 이
  사이드 구역 · 하단 탭 · 편집 후보 세 곳을 같은 조건으로 거른다. 권한이 없으면 구역째 안 보인다.
  **관리자 웹 역할(`canAccessAdminWeb`)도 함께 본다**(2026-10-01) — 페이지가 `ops_admin.access` + 관리자 웹 역할을
  둘 다 요구하므로(쓰기 액션이 `requireAdminSession` 을 거친다), 키만 개별 부여받은 현장 역할에게 메뉴를 보여 주면
  눌러도 홈으로 튕겼다. 메뉴와 페이지가 같은 두 조건을 쓴다(`mobile-shell.tsx`). 이 추가 조건은 **판매 캘린더 · 가동률 · 매출 · 자동화에만** 건다
  (`isMobileOpsAdminNavItem` = `MOBILE_ADMIN_WEB_ONLY_IDS`) — 룸 링크는 보기 · 복사뿐이라 권한 키만 있으면 현장 역할도 연다.
- **가동률** `ops-occupancy` → `/mobile/ops/occupancy`(`ops_admin.access` + 관리자 웹 역할, 2026-10-15). 구역 맨 앞(가동률 · 판매
  캘린더 · 룸 링크 — 시안 순서), 아이콘 `ChartPie`, 라벨은 짧아 축약형 없음(가동률 / 稼働率 / Occupancy). 데스크톱 가동률 페이지가 관리자
  웹 역할을 요구하므로 `MOBILE_ADMIN_WEB_ONLY_IDS` 에도 넣었다. 화면 계약은 `34-metrics-and-automation.md` → 「모바일 가동률」.
- **급여 준비** `payroll` → `/mobile/payroll`(`payroll.view` 또는 `payroll.approve`(2026-10-26, 결재자도 찾게 — `orCapabilities`), 2026-10-25 알바 급여 P3). 사이드 메뉴 근태 바로 다음, 아이콘 `Wallet`, 탭 바 후보.
  기본 달은 도쿄 지난달(10월분보다 앞으로는 못 감). 손 입력 저장은 공용 액션 `src/actions/payroll-month-inputs.ts` 가 `payroll.manage` 를 다시 본다.
  화면 계약은 `39-part-time-payroll-automation-plan.md` → 「P3 구현」.
- **매출** `ops-revenue` → `/mobile/ops/revenue`(`ops_admin.access` + 관리자 웹 역할, 2026-10-15). 가동률 바로 다음(가동률 · 매출 ·
  판매 캘린더 · 룸 링크), 아이콘 `TrendingUp`(데스크톱 매출과 같다), 라벨 짧아 축약형 없음(매출 / 売上 / Revenue). 가동률과 같은 이유로
  `MOBILE_ADMIN_WEB_ONLY_IDS` 에 넣었다. 화면 계약은 `34-metrics-and-automation.md` → 「모바일 매출」.
- **자동화** `ops-automation` → `/mobile/ops/automation`(`ops_admin.access` + 관리자 웹 역할, 2026-10-15). 매출 바로 다음(가동률 · 매출 ·
  자동화 · 판매 캘린더 · 룸 링크), 아이콘 `Zap`(데스크톱 자동화와 같다), 라벨 짧아 축약형 없음(자동화 / 自動化 / Automation).
  `MOBILE_ADMIN_WEB_ONLY_IDS` 에 넣었다. 화면 계약은 `36-automation-control.md` → 「모바일 자동화」.
- 현재 항목: **판매 캘린더** `ops-calendar` → `/mobile/ops/calendar`(`ops_admin.access`). 데스크톱
  `/admin/ops/calendar` 의 모바일판이다 — 화면 · 입력 계약은 `33-calendar-write-features.md` → 「모바일 판매 캘린더」.
- **룸 링크** `ops-room-links` → `/mobile/ops/room-links`(`room_links.access`, 2026-10-05). 탭 라벨 축약형 `roomLinksShort`
  (룸 링크 / リンク / Links). 화면 계약은 `35-room-links.md` → 「모바일」.
- **영어 탭 축약형(2026-10-23)** — 탭 폭(~72px, 10.5px 글자)을 넘는 영어 이름만 탭 · 레일 · 서랍 자주 쓰는 칸 · 탭 편집에서 줄인다:
  `myRoomsShort`(en 「My Rooms」) · `announcementsShort`(en 「Notices」) · `directoryShort`(en 「Staff」). ko · ja 는 정식 이름과 같다.
  사이드 메뉴 · 화면 제목은 정식 이름 그대로(`getNavigationLabel`).
- 이 화면의 격자는 **자체 스크롤 상자**다(날짜 머리 · 객실 열 sticky). 셸 크롬은 `mobile-shell-scroll` 로 **다른 화면처럼 숨었다 나타나고**, 그 빈자리는 화면이
  채운다(탭 바의 `pointer-events-none` 을 지켜봐서 숨으면 64px 올리고 격자를 바닥까지 늘림 — 셸과 같은 곡선), 격자가 맨 위가 아닐 때는 셸의 당겨서 새로고침을 무장시키지 않는다. 칸을 고르는 동안에는 **선택 도구줄이 하단 탭 바 자리를 대신한다**(`body` 포털 z-70, 탭 바와 같은 표면 ·
  모서리 · 위치 — 사진 앱 선택 모드. X 없이 아래로 밀기 · 빈 곳 탭으로 닫는다. 셸의 탭 바 계약은 그대로이고, 선택을
  풀면 탭 바가 다시 보인다),
  편집 패널은 공용 `BottomSheet` 안에 연다(시트 계약 그대로 — X 없음 · 드래그/스크림/Esc 닫기).

### Side-menu operational badge counts

The side-menu nav rows can show an unprocessed-work count badge. Counts are computed server-side by `getMobileNavBadges()` (`src/lib/nav-badges.ts`) and passed into `MobileShell` via the `badges` prop (keyed by nav id). Each mobile page **starts** them before its auth gate — `const navBadgesPromise = getMobileNavBadges()` right above the `getOnboardingState()` / `getCurrentAppSession()` batch — and awaits `navBadgesPromise` at the end, then renders `<MobileShell badges={navBadges} ...>` (2026-10-19 속도: the badge fan-out now overlaps the Auth-server `getUser()` round trip and the page's own data instead of running after them). The function is `cache()`d and never rejects (session errors fall back to `{}`). The announcement and board unread counts each run as **one** parallel batch: the read rows are joined to "published announcements of this org" / "non-deleted posts of this org" (`announcements!inner` / `board_posts!inner`) instead of waiting for the id list, and `getBoardHiddenFor` is request-cached (`board-moderation.ts`) so the board feed/detail and the badge share one read. Detail screens that mark an item read (announcement / board post) write the read row in `after()` and subtract that item from the badge they render, so the badge still drops the moment the screen opens.

Current count definitions (org-scoped, RLS-enforced; each fails closed to 0 so a missing table/migration never breaks the shell):

| Nav id | Counts |
|---|---|
| `cleaning` | today's (Tokyo operating date) `cleaning_sessions` with `status = in_progress` — the remaining-to-finish count; drops as each is completed |
| `requests` | unapproved `order_requests` (`status = requested`) + unprocessed `maintenance_reports` (`open`/`in_progress`) + `lost_items` (`status = registered`) registered today (Tokyo) |
| `linen-return` | today's (Tokyo) `linen_return_records` registered by anyone in the org (organization-wide shared count) |
| `announcements` | published announcements the user has not read (`announcement_reads`); clears on read |
| `board` | org board posts not authored by the user, not hidden by report/block, without a `board_post_reads` row; clears on open |
| `notifications` | unread notifications (`read_at is null`) — via `countUnreadNotifications` (placeholder, to be revisited) |

`home`, `calendar`, and `directory` intentionally show no badge.

Counts refresh on navigation and on pull-to-refresh (`router.refresh()`); these are advisory UI hints only — access control stays in RLS + server queries. Real-time updates (Supabase Realtime) are out of scope for this slice.

## Design Notes

- Bottom tabs should use clear, premium line icons from `src/config/navigation.ts`.
- Labels must fit Korean, Japanese, and English.
- Home quick actions should be large enough for field use.
- Avoid hiding maintenance/lost item/order request too deeply because these are high-frequency actions.
- Top bar, bottom tab bar, and bottom sheets are a single shared design contract. They must stay unified across features unless there is an explicit product/design decision to change them.
- The current top bar and bottom tab bar design are fixed shared surfaces and should be preserved as-is.
- Do not add per-page controls, titles, breadcrumbs, or secondary icons to the shared top chrome unless explicitly decided.
- Liquid Glass is selective: floating bottom navigation, bottom sheets, cards, chips, and overlays may use it; the global mobile background should remain solid and readable.

## 2026-06-15 Bottom Sheets — iOS-style Drag-to-Dismiss

All mobile **bottom sheets** (sheets that slide up from the bottom edge) share one drag-to-dismiss
contract so they behave like native iOS sheets.

- **Unified dismissal rule**: every bottom sheet closes either by dragging down from the sheet's upper touch area / grab-handle zone, or by tapping the empty scrim outside the sheet. Do not invent feature-specific close gestures for bottom sheets.
- **Drag zone**: the center grab handle (`mx-auto h-1 w-[38px] rounded-full`) and the sheet's top
  header area start the drag. ~~A gesture that begins inside the sheet's scrollable body does **not**
  trigger drag-dismiss~~ — **바뀜(2026-10-21, 네이티브 점검 5번):** iOS 시트처럼 **내용에서도** 끌어 닫는다.
  내용을 누른 손가락이 6px 넘게 **아래로**(가로보다 세로가 크게) 움직였고, 그 자리의 스크롤 칸이 **맨 위**(또는 스크롤 칸이 없음)이면
  시트가 손가락을 따라 내려간다(같은 문턱 · 같은 속도 판정 · 6px 만큼 튀지 않게 그 자리에서 시작). 스크롤이 내려가 있거나 위로 미는
  손짓은 그대로 내용 스크롤. 받지 않는 경우: 시트 안 입력칸에 포커스(키보드 열림 — 쓰던 내용 보호), 가로 손짓,
  `[data-sheet-drag="off"]` · `[data-swipe-back="off"]` · 슬라이더 · `touch-action: none` 요소(자기 제스처가 있는 것). 구현은
  `useSheetDragDismiss` 의 `sheetRef` 옵션(시트에 직접 붙인 touch 리스너 — 받은 뒤 `touchmove` 를 막아 목록 고무줄 · 스크롤이 같이
  움직이지 않게). `BottomSheet` 는 늘 켠다. **새 시트 규칙:** 시트 안에 세로로 끄는 자기 제스처를 만들면 `data-sheet-drag="off"`.
- **Touch target size**: the upper drag area must stay broad and easy to catch. Do not shrink it into a tiny, hard-to-grab strip.
- **Follow + dim**: while dragging, the sheet follows the finger downward (`translateY`, clamped at 0
  — no upward drag), and the scrim dims in proportion to the drag distance.
- **Release**: dismiss when pulled past **max(80px, 25% of sheet height)** OR flicked down fast
  (release velocity ≥ **0.5 px/ms**); otherwise the sheet snaps back to rest. Dismiss reuses the
  sheet's existing slide-out + `onClose`, so drag, scrim tap, and Esc all share one exit path.
- **No header close (X) button**: now that drag-down (plus scrim tap / Esc) dismisses, bottom sheets
  do **not** show a top-right X close button — the slide gesture replaces it. (X icons that serve
  other roles stay: remove-member, chip clear, search clear, the long-press/select cancel, the photo
  lightbox close, and center-aligned confirm/reject dialogs.) The order action sheet keeps an X only
  on its centered confirm/reject variant, not the draggable bottom-sheet variant.
- **Touch isolation**: sheets portal to `<body>`, but React synthetic touch events still bubble
  through the React tree into the shell's pull-to-refresh / swipe-nav handlers, which would otherwise
  drag the background screen with the sheet. The hook stops touch propagation on the grab handle /
  header so only the sheet moves.
- **Reduced motion**: the drag still works, but the slide/scrim transitions follow each sheet's
  existing `motion-reduce:transition-none` opt-out.

Shared implementation: `useSheetDragDismiss` in `src/components/shell/use-sheet-drag-dismiss.ts`
(one place owns the pointer mechanics; each sheet keeps its own open/close lifecycle and just spreads
`handleProps` on the grab handle/header, tags the sheet `data-sheet`, and applies `sheetStyle` /
`scrimStyle`). Thresholds are defined as constants in that file.

Sheets covered: bottom-bar editor (`mobile-shell`), Tasks quick-add / calendar day sheet /
long-press menu (`tasks-workspace`), share picker, context picker, report sheet, project create
(`projects-board`), project members (`project-detail-view`), photo gallery (`photo-gallery`),
calendar reservation detail (`mobile-calendar-view`), and the order "처리" bottom sheet variant
(`order-action-bar`). **Excluded** (not bottom sheets): fixed action bars, the left side menu, the
photo lightbox carousel, and small anchored dropdown/popover menus. (As of 2026-06-17 the former
center-aligned confirm / delete / action / picker dialogs are NO LONGER excluded — they were all
converted to bottom sheets; see the canonical-standard section below.)

## 2026-07-31 BottomSheet — 스크림 탭 관통(ghost click) 가드

시트를 연 그 탭이 곧바로 시트를 닫아버려 **"잠깐 떴다 사라지는"** 버그가 있었다
(근태 QR 진입 화면에서 「출근 인증」 → 결과 시트가 순간 사라짐).

원인: 시트는 `<body>` 로 포털되어 화면 전체를 덮는다. 모바일의 한 번 탭은
`pointerdown → pointerup → click` 순으로 오는데, 그 사이에 시트가 마운트되면 **뒤따라오는
click 이 방금 생긴 스크림 위에 떨어진다.** 서버 응답이 빠를수록(예: 위치 검증 전에 즉시
반환되는 "이미 출근 중") 재현이 잘 된다.

수정: 스크림 탭으로 닫으려면 **포인터가 스크림 위에서 눌렸어야** 한다(`pointerdown` 타깃 확인).
시트가 열리기 전에 눌린 탭에는 스크림 `pointerdown` 이 없으므로 걸러진다. 드래그·Esc·스크림
탭이라는 문서상의 닫기 수단은 그대로다.

이 가드는 공용 `BottomSheet` 에 있으므로 앱의 모든 시트에 함께 적용된다.

## 2026-06-17 Bottom Sheet — Canonical Visual Standard + Shared `BottomSheet`

The drag-to-dismiss behavior above is now paired with **one canonical visual spec**, so every
bottom sheet looks identical. The reference design is the home check-in/out sheet; the spec is:

- **Scrim**: `bg-slate-950/45` (cool slate). It **fades toward transparent as you drag the sheet
  down** (the dim is proportional to drag distance — this is the look the team standardized on). No
  warm/tinted scrims.
- **Surface**: `bg-surface` (cream), `rounded-t-[24px]`, `max-w-[460px]`, centered, bottom-anchored.
- **Padding**: `px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]`.
- **Grab handle**: `mx-auto mb-3 h-1 w-[38px] rounded-full bg-slate-200` (slate-200, 38×4).
- **Animation**: slide-in/out `translate-y-full → translate-y-0`, curve `cubic-bezier(0.32,0.72,0,1)`.
  **2026-10-02 (사용자 지시 「물 흐르듯이, 너무 빠르지 않게, 닫을 때도」)**: open **480ms**, close **380ms**, scrim fades on
  the same timing (`SHEET_OPEN_MS` / `SHEET_CLOSE_MS` in `bottom-sheet.tsx`, inline transition so drag stays `none`).
  **Content growth glides** — when content arrives late (loading → loaded) and the sheet gets taller, a `ResizeObserver`
  FLIPs the `translate` property (compositor-only, independent of the drag/slide `transform`) so the top edge slides up
  over 420ms instead of jumping. Shrinking is not animated (a lifted sheet would show the scrim below it).
  `prefers-reduced-motion` turns all of it off.
  **2026-10-05 fix (사용자 지적 「아래에서 위로 자연스럽게 열리고 위에서 아래로 닫히게」)**: the inline transition must list
  **both `transform` and `translate`**. Tailwind v4 compiles `translate-y-full` / `translate-y-0` to the CSS **`translate`
  property**, not `transform` — with only `transform` in the transition the sheet snapped open/closed (only the scrim faded).
  `transform` stays reserved for the drag (`drag.sheetStyle`). Any hand-written sheet that toggles `translate-*` classes with an
  inline `transition: transform …` has the same bug — use Tailwind's `transition-transform` (covers `translate` in v4) or list both.
- **Scroll lock & close are robust (2026-10-02)**: the body scroll lock is **reference-counted** across all open
  sheets (first sheet saves + locks, last sheet restores) — per-sheet save/restore could restore a *locked* state
  when sheets overlapped and leave the page unscrollable. `close` is a stable function (state-driven; the latest
  `onClose` is read from a ref in an effect), so an inline `onClose` no longer re-runs the lock effect on every
  parent render. If the parent unmounts a sheet while it is sliding out (e.g. swaps to another sheet), the pending
  `onClose` timer is cancelled and cannot close the new sheet.
- **Keyboard (2026-10-02)**: device keyboard only (no custom keypads). The sheet's bottom padding already absorbs
  `--keyboard-inset` inside its max height; on `focusin` of a field the sheet scrolls it into view after the keyboard
  settles (320ms). Fields inside sheets must be ≥16px (iOS zoom).
- **손으로 만든 시트 0곳(2026-10-19)**: 공용 부품을 흉내 내 따로 짠 시트 3곳을 `BottomSheet` 로 바꿨다 —
  할 일 「컨텍스트 연결」(`context-picker-sheet.tsx`, 단계 화면은 안쪽 `ContextPickerBody` 가 `useBottomSheetClose()` 로 닫음),
  사진 목록(`photo-gallery.tsx`, 전체 화면 라이트박스는 시트가 아니라 그대로 — Esc 는 캡처 단계에서 라이트박스만 닫음),
  모바일 예약 캘린더 예약 상세(`mobile-calendar-view.tsx`, `z-[200]` 유지). 이제 셋도 태블릿 가로에서 가운데 카드 · 같은 끌어 닫기 ·
  참조 수 바탕 잠금을 쓴다. 예약 캘린더는 따로 걸던 `useBodyScrollLock` 을 뺐다(공용 잠금과 두 겹이 되면 닫을 때 바탕이 잠긴 채 남을 수 있음).
  `rounded-t-[24px]` 를 `bottom-sheet.tsx` 밖에서 쓰는 곳이 생기면 손으로 만든 시트이니 공용으로 바꾼다.
- **Dismiss**: drag past threshold, scrim tap, or Esc. **No top-right X button.**
- **Lifecycle**: portals to `<body>`, locks body scroll, closes on Esc. **겹친 시트(2026-10-20):** 시트 위에 시트를 띄우면(`zIndexClassName="z-[90]"`, 예: 업무일지 → 보낼 시각) Esc 는 **맨 위 시트만** 닫는다(열린 순서를 쌓아 둔다).
- **Drag performance (2026-06-23)**: live drag distance updates are coalesced with `requestAnimationFrame`; refs still track every pointer sample for threshold/velocity accuracy, but React renders at most once per frame.
- **Sheet content must be self-contained (2026-07-22)**: because `BottomSheet` portals to `<body>`,
  a sheet's content leaves its page DOM subtree — so **page-scoped CSS does not reach it**. The
  attendance 미퇴근 리마인더 sheet was styled with `.att .rsheet*` / `.att .rbtn*` rules that never
  applied inside the portal (giant unstyled warning triangle + text-like buttons — a stale test look).
  Fixed by rebuilding it with self-contained Tailwind (`attendance-home.tsx` → `ReminderPrompt`):
  amber icon badge, ivory/navy hierarchy, **full-width stacked buttons** (primary "근무 중" navy fill +
  outline "이미 퇴근했어요" with edit icon) so longer `ja`/`en` labels never clip. Rule: never rely on
  a feature's page-scoped stylesheet for content rendered inside a `BottomSheet`.

**Mandatory going forward:** build any NEW bottom sheet with the shared
**`BottomSheet`** component (`src/components/shell/bottom-sheet.tsx`) — do not hand-roll a sheet
shell. It encapsulates the entire spec above (portal + slate scrim + drag-to-dismiss via
`useSheetDragDismiss` + handle + body-lock + Esc). It is mount-driven (the parent conditionally
renders it and unmounts in `onClose`); close programmatically with the render-prop
`children={({ close }) => …}` or `useBottomSheetClose()`, and make extra drag zones with
`useBottomSheetDragHandle()`.

**Every popup that anchors to / slides up from the bottom now uses `BottomSheet` or the same drag
contract** — including what used to be center-aligned confirm/delete/action/picker dialogs. They were
all converted so they slide up from the bottom and dim-on-drag exactly like the home sheet (a final
sweep confirmed zero bottom overlays lack the effect).

On the shared `BottomSheet` component: home check-in/out, report sheet, share picker, cleaning record
detail + filter picker, project create (`projects-board`), project members + delete/leave confirm
(`project-detail-view`), cleaning linked-confirmation, Tasks bulk-delete (`tasks-workspace`), task
delete/leave/remove confirms (`task-detail-view`), maintenance/lost-found/order confirms, generic
delete confirm, announcement popup + delete + read-status, linen-return success + detail delete,
cleaning completion + cancel confirms, cleaning targets sheet, the date-range and order-delivery
calendars, the requests filter + delete sheets, and the **bottom-bar editor** (`mobile-shell` — the
center-FAB "편집" sheet; converted 2026-06-17 so it drag-dims like the rest).

Kept on their own markup but **normalized to the canonical values** (slate scrim, 24px radius,
slate-200 handle, drag-dim — visually/behaviorally identical, migrate to `BottomSheet`
opportunistically): the suggestions status/hold/complete/comment/like sheets + member picker
(`suggestions.css`), context picker, Tasks day/long-press/quick-add sheets, the calendar reservation
sheet, and the photo-gallery sheet. These were left on their own
shells because they use an always-mounted `.show`/transform toggle or a multi-step body with
body-level dismiss calls; a structural rewrite carries more regression risk than visual gain.

**Intentional exceptions** (NOT flattened): the order "처리" sheet (`order-action-bar`) keeps its
dual-mode **Liquid Glass** treatment (backdrop-blur, 28px, glass border) per the selective-glass
policy; center-aligned confirm/delete dialogs are modals, not bottom sheets; the photo lightbox is a
full-screen carousel. The attendance correction sheets follow the same shared contract, and the
attendance capture result sheet also uses the shared bottom-sheet / drag-dismiss path.

## 2026-05-22 Header Consistency Note

- Header visual style is shared across all `MobileShell` pages.
- Announcement pages (`/mobile/announcements`, `/mobile/announcements/[id]`) and popup modal follow the same top-header and surface hierarchy rule with no page-level header overrides.

## 2026-05-28 Mobile Shell Interaction Update (historical, superseded)

- This section records the 2026-05-28 shell and is superseded by "Global Mobile Shell (current contract)" above.
- The current menu icon is three lines with a shorter middle line.
- The current menu opens as a full-screen slide-in surface.
- The top header is scroll-aware: scroll down hides it, scroll up restores it.
- The current bottom tab bar is bottom-attached, solid ivory, and rounded only at the top, with a raised center squircle FAB.
- The current mobile base is warm ivory with cream-white surfaces. Liquid Glass remains selective.

## 2026-05-22 Calendar Slice Update

- `/mobile/calendar` route is now implemented as the Phase 10 baseline mobile calendar surface.
- Current behavior:
  - Reads `public.reservations` by the signed-in organization.
  - Excludes `cancelled` reservations.
  - Shows today summary counters and a month-overlap reservation list.
- The 14-day room timeline (Overview), lists mode, map tab, building picker, and month navigation are all fully implemented. See subsequent calendar update notes below.

## 2026-05-23 Calendar Tab UX Update

- Calendar tab interaction on `/mobile/calendar` now keeps a consistent three-mode selector:
  - `Calendar`: overview timeline
  - `Lists`: operational list view
  - `Map`: operational building access hub
- `Map` is now active and provides building cards, map links, and access-info entry points.
- This update does not change the global `MobileShell` contract.

## 2026-05-27 Calendar Tab Status Refresh

- `/mobile/calendar` Map tab is no longer placeholder behavior.
- Property filter chips are hidden in Map mode and shown only in Calendar/Lists modes.
- The global shell contract remains fixed: `[three-line hamburger] Foldy [Notifications + Profile]`, scroll-aware top chrome, full-screen slide-in menu, and bottom-attached rounded tabs.

## 2026-06-08 Side Menu Design Update — Teal Minimal

- Side menu nav items replaced from "dark slate pill + icon badge" to "teal tint + bare line icon + right teal dot":
  - Active: `bg-primary/10 text-primary`, right-side `size-1.5 rounded-full bg-primary` dot.
  - Inactive: `text-muted-foreground`, hover `bg-muted/60 text-foreground`.
  - Icons: bare `size-5` line icons; icon badge box removed.
  - Font: `font-semibold` (was `font-bold`).
  - `aria-current="page"` added to active item for accessibility.
- Account card, close button, footer link: border/background/text all converted to design tokens (`border-border`, `bg-surface`, `text-foreground`, `text-muted-foreground`).
- All remaining `text-slate-*` in the shell converted to tokens; `bg-slate-950/42` scrim overlay retained (intentional dark overlay).
- Wordmark color in all three locations (header, side-menu header, admin sidebar) unified to `text-foreground`.

## 2026-06-08 Side Menu — High-Quality List + Operational Counts

- Upgraded the teal-minimal side menu to a "high-quality list" layout:
  - **Account card**: avatar tile (`bg-primary/10`) + name + `account` label + **role chip** (`dictionary.roles[role]`) + trailing `ChevronRight`.
  - **Nav rows** (48px) under a `menu` section heading, with a **left teal active bar** (`absolute left-0 h-5 w-[3px] bg-primary`), `size-[22px]` line icon, label, and optional **count badge** (`bg-primary text-primary-foreground` active / `bg-muted text-muted-foreground` inactive, `99+` cap, `font-mono tabular-nums`).
  - **Footer row**: account-settings link + **logout** button (`<form action={signOut}>` → `dictionary.common.logout`).
- `MobileShell` gained a `badges?: Partial<Record<string, number>>` prop (nav id → unprocessed count).
- New server helper `getMobileNavBadges()` (`src/lib/nav-badges.ts`, `cache()`-wrapped) computes org-scoped counts: cleaning (`in_progress`), requests (maintenance open/in_progress + orders requested + lost registered), announcements (unread), notifications (unread). All counts fail closed to 0.
- All 14 mobile pages that render `MobileShell` now fetch and pass `badges={navBadges}`.
- Reuses existing i18n (`common.account`, `common.menu`, `common.logout`, `roles.*`) — no new strings.

## Post-MVP Feature Batch — Navigation (implemented)

The five approved batch features have mobile entry points in `src/config/navigation.ts` and are eligible for the customizable bottom bar where appropriate:

- **Linen Defect:** dedicated side-menu entry and customizable-bottom-bar candidate; building picker → building list → create/detail → ledger/statistics.
- **Personal Todo / Task Inbox:** dedicated side-menu entry and a candidate for the customizable bottom-tab pool (`customizableBottomNavItems`). Implemented (2026-06-10, hardened through 2026-06-13). Internal mobile IA: `Today / Tomorrow / Inbox(관리함) / 프로젝트 / 지시(받은·보낸) / Completed(완료/기록) / Calendar` (seven tabs). Completed tab groups finished tasks by Tokyo date and provides a daily report (업무일지) generator — free, template-based, no LLM. Task calendar stays visually distinct from the reservation Calendar tab.
- **Staff Suggestions:** side-menu entry and customizable-bottom-bar candidate.
- **Internal Board:** side-menu entry and customizable-bottom-bar candidate.
- **Attendance:** Home quick action, side-menu entry, and customizable-bottom-bar candidate; QR/GPS capture remains PWA-specific.

Future navigation additions must also update the side-menu badge table and `getMobileNavBadges()` when the feature carries an unprocessed count. New nav labels require ko/ja/en i18n keys.

## 2026-08-03 하단 탭 재탭 — 화면 리셋

이미 있는 탭을 하단 바에서 **한 번 더 누르면 그 화면을 처음 상태로 되돌린다**(네이티브 앱 관례).
예전에는 스크롤-투-탑까지만 했는데(`7e6a4f9`), 목록 화면들이 쿼리와 로컬 상태로 필터를 들고
있어서 "완료·기록을 보다가 투두이스트를 다시 눌렀는데 그대로"인 상황이 됐다.

**두 단계로 동작한다.**

1. **URL 이 탭 기본 주소와 다르면** 기본 주소로 이동한다(`?view=` `?date=` `?month=` 초기화).
   되돌아갈 때 예전 스크롤이 복원되면 리셋이 아니게 되므로 `SCROLL_POSITIONS` 에서 그 키를 지운다.
2. **이미 기본 주소면** 맨 위로 스크롤하고 **콘텐츠 서브트리를 리마운트**한다
   (`<div key={contentKey}>{children}</div>` 의 키를 +1).

**왜 리마운트인가.** 내부 탭(투두이스트의 오늘/기록/지시)·검색어·필터·선택 모드는 전부 화면
컴포넌트의 **로컬 state** 라 같은 URL 로 다시 와도 라우팅으로는 풀리지 않는다. 화면마다 리셋
리스너를 다는 방법도 있지만 **탭이 추가될 때마다 배선을 잊으면 조용히 동작하지 않는다.** 키
리마운트는 한 곳만 고치면 **모든 탭이 별도 배선 없이** 초기화된다.

서버 컴포넌트 결과는 이미 element 로 넘어와 있어 리마운트해도 서버 재요청이 일어나지 않는다.
새 탭을 하단 바에 추가할 때 따로 해 줄 일이 없다.

## 모션 규칙 — 움직이는 것은 `transform` 으로 (2026-08-11)

**위치·크기를 애니메이션할 때 `left` / `top` / `width` / `height` 를 트랜지션 대상으로 두지
않는다.** 이들은 레이아웃 속성이라 매 프레임 리플로우가 걸린다. `transform` 은 컴포지터에서만
처리돼 저사양 안드로이드에서 차이가 크게 난다.

| 하려는 것 | 쓰는 것 |
| --- | --- |
| 토글 손잡이 좌우 이동 | `left` 고정 + `translate-x-*` |
| 세그먼트 컨트롤 thumb | `left-0` + `transform: translateX(측정값)` |
| 진행바 채우기 | `w-full` + `origin-left` + `scaleX(비율)` |

- 세그먼트 thumb 의 **폭은 트랜지션하지 않는다.** 항목이 `flex-1` 이라 폭은 애초에 변하지 않는다
  (2026-08-11까지 `transition-[left,width]` 로 폭까지 걸어 두고 있었는데 아무 일도 하지 않는
  트랜지션이었다). 폭이 실제로 다른 세그먼트를 만들게 되면 그때 다시 판단한다.
- `left-0` + `translateX(offsetLeft)` 는 기존 `left: offsetLeft` 와 **같은 자리**다 — 둘 다 위치
  기준 조상의 패딩 박스가 원점이다.
- 진행바를 `scaleX` 로 바꿀 때 `origin-left` 를 빠뜨리면 가운데에서 늘어난다.

2026-08-11 전환 대상이던 곳: 게시판 고정 토글 · 요청 범위 토글 · 프로젝트 공유 토글 · 업무 지시
토글 · 린넨 모드 스위치 · 성별/언어 세그먼트 · 온보딩 진행바. 전환 전후를 실제 CSS 로 렌더해
위치가 픽셀 단위로 같은 것을 확인했다.

## 이미지 — `next/image` 를 쓰는 곳과 쓰지 않는 곳 (2026-08-11)

`<img>` 41곳을 훑어 **24곳을 `next/image` 로 바꾸고 17곳은 그대로 뒀다.** 전부 바꾸는 것이
정답이 아니었다.

| 종류 | 처리 | 이유 |
| --- | --- | --- |
| 원격 썸네일·사진 그리드 | **`next/image`** | 반응형 srcset · WebP/AVIF · 자동 lazy |
| 라이트박스 / 전체보기 | `<img>` 유지 | **원본 해상도로 본다**(결정 로그 2026-06-22). 축소 사본을 내려받으면 «크게 봐서 확인한다»는 목적이 깨진다 |
| 업로드 전 blob 미리보기 | `<img>` 유지 | `blob:` URL 은 최적화 자체가 불가능하다 |
| 오프라인·스플래시 아이콘 | `<img>` 유지 | 서비스워커가 `/icons` 는 캐시하지만 **`/_next/image` 는 캐시하지 않는다** — 바꾸면 오프라인 화면에서 아이콘이 깨진다 |

- 컨테이너가 `position:relative` + 고정 비율이면 `fill` + `sizes`, 고정 px 이면 `width`/`height`
  를 넘기고 표시 크기는 기존 CSS 가 계속 잡는다.
- 버킷은 `request-images` / `announcement-images` **둘뿐**이고 `next.config.ts` 의
  `remotePatterns` 에 이미 등록돼 있다. 「허용 목록에 없어서 `<img>` 를 쓴다」는 취지의 옛 주석이
  두 군데 있었는데 **사실과 달랐다** — 바로잡았다.
- 업로드 시 클라이언트가 **최대 1600px 로 압축**하므로 `next/image` 의 이득은 용량보다
  반응형·포맷·lazy 쪽이다.
- **비용 주의:** Vercel Hobby 는 이미지 최적화에 월 할당량이 있다. 사진이 많은 화면을 추가로
  변환할 때는 이 점을 감안한다.
- 유지하기로 한 `<img>` 에는 **이유를 주석으로 남기고** `eslint-disable` 을 붙인다. 경고만 남겨
  두면 «아직 안 바꾼 것»과 «바꾸면 안 되는 것»이 구분되지 않는다.

## 2026-08-25 떠 있는 토스트 — 도크 높이와 공용 `TaskToast`

떠 있는 토스트(실행 취소 · 안내)는 **탭바 위 고정 도크**에 앉는다. 높이를 호출부에서 직접 쓰지 않는다.

- **`--tabbar-h` (globals.css)** = `calc(51px + max(16px, env(safe-area-inset-bottom, 0px)))`
  — 위 패딩 12 + 탭 항목(아이콘 22 + gap 4 + 라벨 13) + 아래 패딩 `max(16px, safe)`.
- **`.toast-dock`** = `bottom: calc(var(--tabbar-h) + 40px)`. 40px 은 중앙 스퀘어클이 탭바 위로
  솟는 26px + 숨 쉴 여백 14px 이다.

**왜 상수를 못 쓰나.** 투두의 토스트 네 곳이 각자 `bottom-[92px]` 를 하드코딩하고 있었는데, 그 값은
`env(safe-area-inset-bottom)` 을 모른다. 홈 인디케이터가 있는 기기에서는 탭바가 두꺼워져 92px 가
스퀘어클 버튼과 겹쳤다. **새 토스트를 만들 때 픽셀 값을 직접 쓰지 말고 `.toast-dock` 을 쓴다.**

### 시각 표준

`src/components/tasks/task-toast.tsx` 가 정본이다(모바일 투두). 다른 화면에 토스트를 새로 만들 때
이 형태를 따른다.

- 표면: `rounded-[20px]`, `bg-slate-900/95` + `backdrop-blur-xl`, `border-white/10` 1px,
  `shadow-[0_22px_50px_-20px_rgba(15,23,42,0.85)]`. 아이보리 캔버스와 대비되는 어두운 알약이다.
- 구성: **아이콘 칩(32px) · 메시지 · 행동 하나**. 칩은 무슨 일이 일어났는지 글자를 읽기 전에
  알려준다(완료=체크, 삭제·건너뛰기=`tone="danger"` 로즈 톤).
- 행동은 36px 알약(`bg-white/12`)이다. 예전의 rose-300 **글자** 버튼은 탭 타깃이 작고 붉은 글자가
  「오류」로 읽혔다.
- **닫기(X) 버튼은 두지 않는다.** 토스트는 스스로 사라지고(4~6초), 실행 취소라는 진짜 행동이 이미
  있다. BottomSheet 의 X 금지와 같은 판단이다.
- 등장은 아래에서 14px + 페이드(`.toast-pop`, `prefers-reduced-motion` 존중).

### 떠 있는 FAB 와의 관계

토스트는 우측 하단 FAB(`bottom-[calc(6rem+env(safe-area-inset-bottom))]`)와 같은 자리를 지난다.
겹쳐 그리면 FAB 가 잘린 채 비쳐 지저분하므로, **토스트가 떠 있는 동안 FAB 는 페이드·축소로 물러난다**
(`pointer-events-none scale-90 opacity-0`). 투두 워크스페이스의 `toastVisible` 참고.

## 스크롤바는 감춘다 (2026-09-11)

모바일 셸의 본문 스크롤러는 스크롤바를 그리지 않는다
(`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`).

실제 기기에서는 쉴 때 보이지 않는 오버레이 스크롤바지만, 데스크톱 브라우저와 어드민의 아이폰 모양
미리보기에서는 **항상 자리를 차지하는 막대**가 생긴다. 폭 390px 중 15px 을 먹고, 기기처럼 보이지도
않는다.

같은 파일의 **측면 메뉴 스크롤러는 원래부터 이렇게 하고 있었다** — 본문만 빠져 있던 것을 맞춘 것이다.
스크롤 동작(스크롤 인지 상단 크롬 · 당겨서 새로고침 · overscroll 격리)은 그대로다.
