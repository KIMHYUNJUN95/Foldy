# Design Direction

## Current Status

The main Foldy visual direction is confirmed.

Current design status:

- Apple-inspired Liquid Glass accents with strong business-app readability are the confirmed direction.
- The mobile shell uses a warm ivory canvas/chrome with cream-white cards and sheets; Liquid Glass is applied selectively to high-value surfaces such as cards, chips, overlays, and bottom sheets.
- Google Stitch is being used for planning and screen direction.
- Multiple mobile and admin web screens have passed as v1 working directions.
- The Admin Reservation Calendar is implemented as a custom dense room/date timeline; the earlier Stitch acceptance gap no longer blocks the live console.
- Remaining design closeout work includes App Splash / Launch Screen, role-based visibility review, and final Stitch progress cleanup.

## App Splash / Launch Screen

Foldy should include a short app launch experience for the mobile app/PWA.

Direction:

- White or bright gray-white background.
- Foldy app logo centered on the screen.
- Very brief display when the app starts, similar to familiar consumer app launch screens.
- Calm, clean, and not decorative.
- No marketing copy.

Current status:

- Required for app polish.
- Final logo is not designed yet.
- Use a temporary `Foldy` wordmark or placeholder mark until the official logo is created.
- The interim wordmark renders as `Foldy` (with a space) in a serif italic typeface (Noto Serif, weight 600). It is shared across all shells/entry screens via the `.wordmark` class in `src/app/globals.css` (font loaded in `src/app/layout.tsx` as `--font-wordmark`). Applied in the mobile shell header + side menu, admin shell, dev entry, and the login/onboarding headers (`dictionary.app.name`).
- The mobile top chrome is flat and borderless: no capsule outline/ring/glass/shadow — the centered wordmark sits between the 38px menu control and the notification/profile control group over the shared warm-ivory chrome.

## Product Feeling

Foldy should feel:

- Fast
- Clear
- Professional
- Calm
- Reliable
- Easy for busy staff
- Modern
- Apple-inspired

It should not feel like:

- A marketing landing page
- A social app
- A decorative dashboard
- A complicated enterprise tool

## Design Priorities

### 1. Speed

Hotel staff may use the app while standing, walking, answering guests, or handling urgent work.

Important actions should be quick:

- Register lost item
- Report maintenance issue
- Create order request
- Update status
- Add photo

### 2. Clarity

Every task should clearly show:

- What happened
- Where it happened
- Who owns it
- What status it is in
- What needs to happen next

### 3. Role-Based Simplicity

Different roles should see different priorities.

Examples:

- Front desk needs search and guest-facing information.
- Maintenance needs assigned work and completion actions.
- Admin needs overview, filters, and assignment controls.

## Client-Specific Design

### Mobile App

The mobile app should be optimized for:

- Fast field entry
- Photo capture
- Assigned tasks
- Push notifications
- Simple status updates
- Staff schedules

### Admin Web App

The admin web app should be optimized for:

- Calendar and schedule overview
- Check-in/check-out review
- Cleaning status tracking
- Staff and role management
- Task assignment
- Filtering and search
- Bulk review
- Reports and operational visibility
- Beds24 reservation/occupancy views
- Maintenance, lost and found, order requests, and announcements
- User directory and role management
- Recurring work management

## Early UI Direction

Possible design direction:

- PWA-first mobile field interface
- Admin web operations console
- Warm-ivory mobile shell with cream-white surfaces and selective Apple-inspired liquid glass accents
- Bottom tab navigation: Home, Calendar, Cleaning, Requests, Announcements
- Clear status chips
- Compact task cards
- Fast create button
- Photo-first issue reporting
- Calm neutral base with meaningful status colors

## Visual Style Direction

Confirmed direction:

- Warm-ivory operational base, deep navy accent, and selective Apple-inspired Liquid Glass surfaces
- Light mode only for the MVP/internal rollout (dark mode deferred until post-launch — see "Light and Dark Mode" below)

Important interpretation for Foldy:

- Use subtle translucency, blur, depth, and layered surfaces only where they add clarity or polish.
- Do not make the whole mobile app glass. Keep the global shell/background solid and calm.
- Prefer restrained Liquid Glass refinements on popup/bottom-sheet surfaces and selected mobile cards/chips; keep the attached bottom navigation and admin data surfaces solid when readability matters.
- Keep operational readability higher priority than decoration.
- Avoid making the UI too flashy for field work.
- Status colors must remain clear and accessible.
- Admin tables, calendars, and forms must stay dense and easy to scan.
- Use solid or lightly translucent surfaces behind important text.
- Avoid low contrast glass panels for critical data.

### Typography — CJK Rules (2026-09-09)

폰트 스택은 **Geist(라틴·숫자) → Noto Sans KR / JP(한글·가나)** 이고 `src/app/layout.tsx` 에서
로드한다. 일본어 페이지는 KR/JP 순서를 뒤집어 한자가 JP 자형으로 나오게 한다
(`:lang(ja) body`, `src/app/globals.css`).

**1. `--font-sans` / `--font-mono` 토큰에도 CJK 를 넣는다.**
Tailwind 의 `font-sans` / `font-mono` 유틸은 `body` 의 스택을 덮어쓴다. 토큰에 Noto 가 빠져 있으면
그 유틸을 쓴 곳만 한글이 시스템 글꼴(윈도우 맑은 고딕)로 떨어져, **같은 화면 안에서 글씨체가 달라
보인다.** 회원가입 초대코드 입력의 `placeholder:font-sans` 가 실제로 그랬다. 두 토큰은 항상
`body` 스택과 같은 순서를 유지한다.

**2. 한글·가나에는 letter-spacing 을 걸지 않는다.**
한글과 가나는 이미 정사각 자간으로 설계됐다. 라틴 기준 자간을 그대로 씌우면 넓힌 쪽은
「설 정  완 료」처럼 흩어지고 좁힌 쪽은 답답해진다. `text-transform: uppercase` 도 한글에는 효과가
없으면서 같은 줄에 섞인 라틴만 대문자로 만들어 글자 높이를 어긋나게 한다.

공용 유틸 두 개가 `globals.css` 에 있다. 라틴 기준 자간은 클래스에 그대로 두고, CJK 일 때만 덮는다.

| 클래스 | 라틴 | ko / ja |
| --- | --- | --- |
| `.t-eyebrow` | 원래 값 (`uppercase` + `tracking-[0.04~0.13em]`) | `letter-spacing: 0` · `text-transform: none` |
| `.t-display` | 원래 값 (`tracking-[-0.03em]`) | `letter-spacing: -0.005em` |

Tailwind 유틸리티는 `@layer utilities` 안에 있고 이 규칙들은 레이어 밖이라 특이도와 무관하게
이긴다. 로그인 화면은 `.authx` 스코프로 `auth-console.css` 끝에 같은 보정을 둔다.

**3. `lang` 은 화면 언어와 반드시 일치해야 한다.**
위 보정이 `:lang()` 으로 걸리기 때문이다. `<html lang>` 은 **세션 → `stayops_locale` 쿠키 →
Accept-Language → `ko`** 로 정한다(`layout.tsx`). 다만 레이아웃은 `searchParams` 를 읽을 수 없어
`?lang=` 로만 언어를 바꾼 로그아웃 첫 방문은 커버하지 못한다. 그래서 **로그인(`.authx`)과 온보딩
위저드(`<main>`)는 자기 루트에 `lang` 을 한 번 더 단다** — `:lang()` 은 가장 가까운 `lang` 조상을
따르므로 이 값이 이긴다.

**4. 앱 전체 적용 (2026-09-09 2차).**
회원가입·로그인만 고친 뒤 전수 조사를 돌렸더니 같은 결함이 앱 전반에 있었다. 세 갈래로 처리했다.

| 갈래 | 범위 | 처리 |
| --- | --- | --- |
| 손으로 쓴 CSS | 13개 파일 · 47개 규칙 | 각 파일 끝에 `:lang(ko)/:lang(ja)` 오버라이드를 **함께 둔다**(선택자가 바뀔 때 같이 눈에 띄도록) |
| Tailwind 인라인 | 124곳 | `globals.css` 의 속성 선택자 한 벌로 덮는다 |
| 폰트 토큰 | `--mono` 6곳 · `--font` · `--hm-mono` · `--att-mono` | CJK 폴백 추가 |

Tailwind 쪽은 클래스를 124번 다는 대신 **결함의 형태 자체**를 선택자로 쓴다.

```css
:lang(ko) .uppercase[class*="tracking-[0."] { letter-spacing: 0; }
```

`uppercase` 와 **양수** 자간을 함께 가진 요소만 걸린다(음수는 `tracking-[-0.` 이라 안 걸린다).
담기는 문구를 전수 확인한 결과 전부 i18n 값이고 하드코딩된 라틴 라벨은 0건이었다.

**`text-transform` 은 앱 전체 규칙에서는 건드리지 않는다.** 한글에는 어차피 효과가 없고,
같은 규칙을 공유하는 라틴 전용 라벨의 대문자 표시를 잃지 않기 위해서다. 회원가입 화면만 예외로
`uppercase` 도 함께 끄는데, 그 문구들이 순수 한글임을 확인했기 때문이다.

**`--mono` 는 6곳에 따로 정의돼 있었고 그중 한 곳만 CJK 를 포함했다.** 숫자 전용이라 문제없어
보이지만 실제로는 한글이 섞여 든다 — 연차 이력의 `3일` 은 숫자만 Geist Mono 이고 `일` 은
시스템 고정폭이었다. 여섯 정의를 하나의 스택으로 통일했다.

**`--font` 는 `announcements-console.css` 에서만 정의됐고 그 값에 Geist 도 Noto 도 없었다.**
`var(--font)` 를 쓰는 파일은 6개인데 정의가 한 곳뿐이라, 같은 단위 라벨이 공지 페이지에서만
시스템 글꼴로 보였다(다른 페이지에서는 변수가 없어 body 글꼴을 상속해 «우연히» 맞았다).
정의를 `admin-console.css` 의 `.adm` 으로 옮기고 `.att` 에도 같은 값을 뒀다.

**문제없음을 확인한 것**: `--serif`(`Noto Serif`)는 워드마크와 채용 KPI 숫자에만 쓰여 한글이
지나가지 않는다.

**5. 2차 스윕 — 자간만 걸린 규칙 (2026-09-09).**
1차는 `uppercase` 가 붙은 규칙만 잡았다. `uppercase` 없이 자간만 걸린 규칙과 손으로 쓴 CSS 의
강한 음수 자간을 다시 훑어 **21곳**을 더 보정했다(양수 12 · 음수 9).

**의도적으로 제외한 것 — 자간이 맞게 쓰인 자리다.**

| 제외 | 이유 |
| --- | --- |
| 숫자 표시 (`__v` `__amt` `score` `count b` `timer` `stat-v` `balcard__big` `tpick__display`) | 숫자는 좁은 자간이 오히려 정렬돼 보인다 |
| 일본어 서식 `.jp__*` (입사 서류 A4) | 일본어 공식 서식은 字間을 의도적으로 벌린다 |
| 초대코드 입력 · `.wordmark` | 라틴 전용 |
| +0.01 ~ +0.02em (17곳) | 12px 기준 0.24px 이하 — 눈에 띄지 않아 손대지 않는다 |

기준은 **한글이 실려 자간이 눈에 띄는가**이지 "자간이 걸려 있는가"가 아니다. 전자만 고친다.

**6. 폰트 토큰은 12곳 전부 같은 스택을 쓴다.**
`--font-sans` / `--font-mono` / `--font`(2) / `--mono`(6) / `--hm-mono` / `--sg-font` — 정의가
12곳으로 흩어져 있다. **전부 CJK 를 포함해야 하고, 리터럴 `"Noto Sans KR"` 이 아니라
`var(--font-noto-kr)` 를 써야 한다.** 리터럴은 웹폰트 자체는 맞히지만 next/font 가 만든 metric
보정 폴백(`"Noto Sans KR Fallback"`)을 놓쳐 로딩 중 레이아웃이 한 번 튄다.

**6-1. 600(semibold)이 빠져 있었다 (2026-09-10 수정).**
실측하니 **600 이 코드베이스에서 가장 많이 쓰는 굵기**였다 — CSS `font-weight: 600` 264곳 +
`font-semibold` 412곳. 그런데 `Noto_Sans_KR/JP` 의 로드 목록은 `400/500/700/800/900` 이라 600 이
없었다. 없는 굵기는 브라우저가 합성하거나 700 으로 스냅한다. 그래서 **한글만 유독 뭉개지거나
라틴보다 굵게** 보였다 — 같은 자리의 라틴은 Geist 가 600 을 갖고 있어 차이가 더 드러났다.

두 폰트의 목록에 `600` 을 넣었다(→ 6-2 에서 목록 자체를 없앴다). `preload: false` 라 초기 경로에는 실리지 않고, 없는 굵기는
모든 화면에서 계속 잘못 그려지므로 교환이 명확하다.

남은 미세 항목: `650/750/850/950` 이 26곳에 있다(가변 폰트 문법). 정적 굵기로는 표현되지 않아
가까운 값으로 스냅한다. 수가 적고 대부분 장식용이라 두었다.

**6-2. 굵기 목록 대신 가변 폰트 한 벌 (2026-10-19).**
`weight: [...]` 배열을 주면 next/font 가 굵기마다 `@font-face` 를 따로 만들어 폰트당 744개(KR · JP 각각, CSS 약 1MB, 첫 그림 차단)가
됐다. 배열을 빼면 Google 의 가변 파일(wght 100~900)이 쓰여 폰트당 **124개**(약 1/6)다 — 유니코드 구간 조각 수는 같고 굵기 곱이
사라졌다. 코드베이스가 쓰는 굵기(400·500·600·700·800·900)는 모두 범위 안이라 화면 굵기는 그대로이고, 6-1 의 600 문제도 구조적으로
다시 생기지 않는다(굵기 목록 자체가 없다). 300 은 Geist 가 그려 오던 자리(숫자 · 라틴)뿐이다.

**6-3. 미리 받는 글꼴은 Geist 하나 (2026-10-22 첫 실행 속도).**
`Geist Mono`(고정폭 숫자 — 몇 화면) · `Noto Serif`(관리자 콘솔 워드마크 · 채용 KPI 숫자만, 모바일은 안 씀)도 `preload: false`. 전엔 모든 화면
첫 로드에 이 글꼴 5벌을 미리 받았다(154KB) — 이제 Geist 만(48KB), 나머지는 쓰는 화면에서만 받는다. 첫 그림이 4G · 느린 폰 기준 약 0.9~1.1초 →
0.7초. 새 글꼴을 붙일 때 모든 화면이 쓰는 게 아니면 `preload: false`.

**7. 남겨 둔 것 — 첫 진입 폰트 전환.**
`Noto Sans KR/JP` 는 `preload: false` 다(초기 로딩 경로에서 큰 CJK 폰트를 빼려는 의도). 그래서
캐시가 없는 첫 방문에서는 한글이 잠깐 시스템 글꼴로 보이다 바뀐다. 회원가입은 대개 첫 화면이라 이
전환이 가장 잘 보이는 자리지만, `preload: true` 로 바꾸면 **모든 라우트**가 CJK 폰트를 선로딩하게
되므로 교환이 크다. 바꾸려면 별도 결정이 필요하다.

### Admin Dashboard Shared UI Contract

The admin dashboard uses one operations-console design system. The current implementation baseline is
`src/components/admin/admin-console.css` plus reusable primitives in `src/components/admin/shared`.

- Reuse shared admin primitives before creating feature-local controls.
- Month/date/time pickers, chip filters, reason modals, side-panel behavior, status chips, cards, tables,
  and action bars should remain visually and interaction-wise consistent across `/admin/*`.
- Shared formatting/downloading helpers that affect visible output, such as yen formatting and status-pill
  mappings, should live with the admin shared layer when multiple admin pages use the same result.
- New admin pages may extend the shared system, but should not introduce a second visual language or
  one-off control set unless a documented decision explains why.
- Multilingual length checks (`ko`, `ja`, `en`) are part of the design acceptance criteria for shared
  admin controls.

## Mandatory Mobile Visual Consistency Rule (Do Not Break)

This is a hard project rule and must always be enforced:

- All mobile pages under `/mobile/*` must share one coherent visual system based on warm-ivory canvas/chrome, cream-white content surfaces, high readability, and selective Liquid Glass accents.
- Liquid Glass is a partial treatment, not a full-screen theme. Apply it to bottom sheets, important cards, chips, and overlays when it improves polish without harming readability.
- The current shared `MobileShell` behavior is the baseline: warm-ivory background, scroll-aware top chrome, full-screen slide-in side menu, notification bell, and bottom-attached rounded tab bar with a raised center squircle FAB.
- No mobile page is allowed to mix unrelated visual languages once touched.
- If a page is implemented or modified and cannot meet this consistency level in the same cycle, the change is not considered complete.

Required consistency checkpoints for every mobile page update:

1. The shell/background stays visually unified in the warm-ivory/cream family unless an explicit page-level exception is approved.
2. Glass accents are used intentionally and consistently, not as a blanket background treatment.
3. Header/body/cards/controls feel like one design family.
4. Calendar, Cleaning, Requests, Announcements, and Home have consistent interaction polish.
5. Readability and accessibility remain stronger than visual decoration.

## Light and Dark Mode

**Status (2026-06-08): Light mode only. Dark mode is deferred until after the official launch.**

For the MVP and internal rollout Foldy ships light-mode-only. All dark-mode code, styling, theme state, and the theme-toggle UI have been removed (see `docs/planning/06-current-status.md` → "Dark mode removed"). The previous System/Light/Dark theme preference no longer exists.

Implementation notes (current):

- Use design tokens for colors, glass surfaces, borders, shadows, and status colors. The light `:root` token set in `src/app/globals.css` is the single source of truth.
- Important operational text must remain high contrast.

Post-launch (deferred): dark mode may be reintroduced as a fresh slice. If it is, Liquid Glass effects must be tuned separately for dark mode and both mobile PWA and admin web must support it, with the decision log updated first.

## Design Source Workflow

Screen wireframes and layouts will be created with Google Stitch.

Implementation should follow Stitch outputs, but the final product must still respect:

- Real operational workflows
- Responsive PWA constraints
- Accessibility
- Multilingual text length
- Data-heavy admin screens

## Open Design Questions

- The mobile app should remain field-first while the admin web remains a dense operations console.
- The admin dashboard is an active product surface, not a future option.
- ~~Should the first MVP include dark mode?~~ Resolved 2026-06-08: no — light mode only for MVP; dark mode deferred until post-launch.
- Should each hotel be able to customize logo/color?
