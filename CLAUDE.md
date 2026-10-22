# CLAUDE.md

## Purpose

This file defines project-specific rules for Claude and other AI coding agents working on Foldy.

Foldy is not a generic Next.js demo. It is an operations product for accommodation teams. UI changes, permission changes, workflow changes, and data-model changes can create real operational risk. Keep docs and code aligned at all times.

## Highest Priority Rules

1. Reply to the user in Korean by default.
2. Read the relevant Markdown docs before changing code.
3. If behavior, UI, permissions, routes, statuses, or data shape changes, update the related docs in the same work cycle.
4. `docs/` is part of the source of truth. If docs and code disagree, identify which side is correct and update the other side.
5. After code changes, run `npm run lint` and `npm run build` unless blocked.
6. Do not silently change the tech stack, role model, deletion policy, multilingual strategy, or PWA-first direction.
7. A task is not complete until both code and the matching Markdown docs are updated together in the same completion cycle.
8. Before any code modification, implementation, or feature addition, explicitly ask the user whether work should start. Do not begin coding or editing implementation files until the user clearly says to start.
9. For any feature addition, modification, or behavior change, always update the matching Markdown documentation in the same work cycle to keep docs and implementation aligned. This is mandatory and must never be skipped.

## Read These First

Before making changes, read in this order:

1. `README.md`
2. `docs/planning/01-decision-log.md`
3. `docs/planning/04-project-workflow.md`
4. `docs/planning/05-ai-collaboration-rules.md`
5. `docs/planning/06-current-status.md`
6. `docs/engineering/07-environment-setup.md`
7. Relevant files under `docs/product`, `docs/engineering`, and `docs/design`
8. **STAY ARI Manager 이식 작업**(판매 캘린더 · 가동률 · 매출 · 자동화 — 원본 `C:\-stay-ari-manager-main` =
   `/mnt/c/-stay-ari-manager-main`)을 이어갈 때는 `docs/product/31-stay-ari-migration-overview.md` 를 먼저 읽는다 —
   진행 상황 · 다음 순서 · 재개 가이드가 거기 있다.
   **이식은 항상 저쪽 구조와 설계를 먼저 읽고, 우리 쪽에 맞게 업그레이드해서 짓는다** — 복사도, 추측으로 다시 만들기도
   하지 않는다(31번 「이식 원칙」).

## Project Snapshot

- Product: Foldy
- Domain: accommodation and hotel operations
- Users: field staff, part-time staff, office/admin staff
- Languages: Korean, Japanese, English from the start
- Direction: mobile PWA plus admin web in one product

## Current Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- Supabase Auth / Postgres / Storage / RLS
- Beds24 integration
- Capacitor 8 — iOS · Android app shell that loads the deployed web (approved 2026-10-06; web/PWA keeps running). Plan: `docs/planning/17-app-release-plan.md`

Primary commands:

```bash
npm run dev
npm run lint
npm run build
npm run cleaning:normalize-room-labels
```

## Important Directories

- `src/app`: routes, server actions, API routes
- `src/components`: shared UI and domain components
- `src/lib`: i18n, session, Supabase, Beds24, domain helpers
- `src/config`: roles, navigation, routes
- `src/types/database.ts`: generated or maintained DB types
- `supabase/migrations`: database migrations
- `docs`: planning, product, design, engineering source of truth
- `scripts/dev`: local maintenance and backfill scripts

## Core Project Contracts

### 1. Documentation-first workflow

Foldy follows this baseline workflow:

```txt
Plan -> Design -> Document -> Implement -> Test -> Review -> Update documentation
```

For bug fixes, investigation and patching can be fast, but final completion still requires doc sync.

Completion rule:

- Every time a task finishes, update the relevant Markdown docs in the same cycle.
- Treat code changes and doc changes as one unit of completion.
- If implementation changed from the original plan while coding, update the docs again before closing the task.

### 2. Multilingual support is mandatory

- Do not add visible UI text as one-off hardcoded strings.
- Check `src/lib/i18n.ts` first.
- If new copy is needed, add `ko`, `ja`, and `en` together.
- Fallback behavior exists, but new UI should not depend on missing translations.
- **Building names are data, not copy (2026-10-22).** Reservations, rates, occupancy, revenue and notifications carry
  the Korean canonical name (`아라키초A`). Never render it raw — server: `localizeBuildingName()` /
  `localizeRoomPlaceLabel()` (`src/lib/room-label-normalization.ts`), mobile client: `useBuildingName()`
  (`src/components/shared/building-names.tsx`). Single-unit buildings use the building name as the room label — localize
  that too. Look `buildingLabels` up by building key, never by the stored name.
- This is a **hard rule for every feature addition and every feature modification**.
- Do **not** hardcode Korean UI text temporarily "just for now" during implementation.
- New UI/UX, status labels, validation copy, action labels, empty states, and modal text must be
  designed and implemented as **multilingual from the start** (`ko`, `ja`, `en` together).

### 3. Mobile shell is a shared contract

For `/mobile/*`, treat `src/components/shell/mobile-shell.tsx` as a global contract.

- Keep the scroll-aware top chrome behavior.
- Keep the three-line hamburger menu trigger pattern (shorter middle line).
- Keep the left slide-out menu behavior.
- Keep the flat **ivory** bottom tab bar with center FAB (rounded top corners, `border-radius: 22px 22px 0 0`). The FAB opens the bottom-bar editor sheet where the user can pick up to 4 tabs. Tabs persist to `profiles.bottom_nav_tabs`.
- **Wide-screen exception (approved 2026-10-05):** at `fold:` (≥ 600px) the bottom tab bar and top chrome are replaced by the left rail, and at `tablet:` (≥ 1000px wide and ≥ 600px tall — raised from 840 on 2026-10-06 after Galaxy Fold landscape 841×673 got squeezed) by the collapsible 248px sidebar (`src/components/shell/mobile-side-nav.tsx`). Phones (< 600px) are unchanged. Bottom sheets become a centred card at `tablet:`. List screens use `SplitList` (list + detail pane via a same-origin `stayops-pane` frame in 「칸 모드」) at `tablet:` — new list screens should be wrapped too. See `docs/product/16-mobile-navigation.md` → 「넓은 화면 — 레일 · 사이드바」 · 「목록 → 상세 2분할」.
- **Every `/mobile/*` screen must be natively adaptive at `fold:` and `tablet:` (ABSOLUTE, 2026-10-05 사용자 지시).** Not just phones —
  new screens from the start, existing screens too. The shell's centred 760px column is a fallback for un-adapted screens, NOT an
  adaptation. When building or changing a mobile screen, design, implement and screenshot all three widths (phone · fold ≥ 600 ·
  tablet landscape ≥ 1000): list → detail uses `SplitList` + `split`; a screen without detail URLs draws its own pane with
  `useIsTablet()` (room links); a screen that should use the full width uses `wide` and lays itself out. Design drafts include fold and
  tablet frames too. Adaptation status per screen: `docs/product/16-mobile-navigation.md` → 「화면별 넓은 화면 대응 현황」.
- Keep the warm **ivory** chrome base: page/shell background (`bg-background`), sidebar, and bottom tab bar are ivory; **cards/sheets stay white** (`bg-surface`) so they lift off the canvas. The brand accent is **deep ink navy/indigo** (`--primary`), not teal/green — do not reintroduce teal/green as the brand color. Liquid Glass accents stay selective (floating sheets, cards, chips, overlays); the global background and tab bar remain solid.
- **Screen transitions + loading are a shared contract (2026-10-21).** `MobileShell` animates only the content column
  (push / pop / tab fade / reveal via `consumeScreenEntrance`); the tab bar and top bar never slide. Loading is the
  placeholder shell (`src/app/mobile/loading.tsx` → `MobileShellPlaceholder`) — never a full-screen loader that hides
  the tab bar. A new `/mobile` folder with child routes gets the one-line `loading.tsx` re-export. See
  `docs/product/16-mobile-navigation.md` → 「Route transitions — 화면 전환」 · 「로딩 자리 셸」.
- **Press feedback is shared (2026-10-21).** Links and buttons inside the mobile shell and sheets dim while pressed via one
  rule in `globals.css` (50ms delay, innermost only). Do not hand-add press dimming per screen; an element that wants a
  different response uses its own `active:` utility (the shared rule then skips it), and `data-press="off"` opts out.
  Custom gestures that drag content should set `html[data-gesture]` while dragging. See 16 → 「누름 반응 — 공용 규칙」.
- **Toast motion is shared (2026-10-21).** Mobile toasts keep their own look but get exit + swipe-to-dismiss from
  `useToastMotion` (`src/components/shell/use-toast-motion.ts`) — put its `ref` on the fixed toast element. Do not
  hand-roll another exit/swipe for a new mobile toast. See 16 → 「토스트 — 공용 움직임」.
- **Haptics follow one rule (2026-10-22).** `success` only after the server confirms a saved record, `error` with
  a failure message, `light` for selections / toggles / dismissals / deletes, `medium` for long-press pick-up,
  `warning` for partial results. See the header of `src/lib/haptics.ts` and 16 → 「햅틱 — 공용 규칙」.
- **Row removal collapses (2026-10-21).** Removing a row from a mobile list collapses it immediately (wrap in
  `.row-collapse`, set `data-leaving` before awaiting the server, remove it on failure) — no row vanishing after a
  round-trip. Quick status toggles use `useOptimistic`. See 16 → 「줄 접힘 · 즉시 반영 — 공용」.
- **Accessibility basics are shared (2026-10-22).** Off-screen panels that stay mounted (the drawer) are `inert` while
  closed; hidden file inputs opened by a labelled button get `aria-hidden` + `tabIndex={-1}`; icon-only buttons need an
  `aria-label` from i18n; text contrast ≥ 4.5:1 (Sunday red is `#c4364b`, not `#d8455a`). The app follows the device text
  size up to 1.35× — new screens must survive it; only the tab bar, dense data grids and segmented controls opt out with
  `data-text-fixed` / `text-size-adjust: 100%`. See 16 → 「접근성 — 공용 규칙」.
- **Swipe back is a shared contract (2026-10-08).** Back = swiping right anywhere on a screen (`src/lib/swipe-back/*`, wired in
  `MobileShell`). Do not add back buttons or a second swipe handler. Any element with its own horizontal gesture (swipe-to-reveal
  row — only while open, carousel, drag grid, reorder handle) must carry `data-swipe-back="off"`; new full-screen overlays need
  `role="dialog"` or `data-native-back-overlay`. See `docs/product/16-mobile-navigation.md` → 「뒤로가기 — 화면 스와이프」.
- Do not reintroduce page-specific stacked mobile headers.
- Do not revert to a floating capsule or full-glass tab bar without an explicit design decision.
- **Bottom sheets are a shared contract.** Every slide-up bottom sheet must use the canonical
  **`BottomSheet`** component (`src/components/shell/bottom-sheet.tsx`): slate scrim (`bg-slate-950/45`)
  that fades transparent on drag-down, `bg-surface` `rounded-t-[24px]` `max-w-[460px]` surface, 38px
  `bg-slate-200` grab handle, drag-to-dismiss + scrim-tap + Esc (NO top-right X button), portal to
  `<body>`, body-scroll lock. Do not hand-roll a new sheet shell or introduce warm/tinted scrims,
  other radii, or an X-close. The Liquid Glass order "처리" sheet and center-aligned confirm/delete
  modals are intentional exceptions. See `docs/product/16-mobile-navigation.md` → "Bottom Sheet —
  Canonical Visual Standard".

If shared mobile shell behavior changes, also review and update:

- `docs/product/16-mobile-navigation.md`
- `docs/planning/04-project-workflow.md`
- `docs/planning/06-current-status.md`

### 4. Admin dashboard shared design contract

For `/admin/*`, treat repeated desktop-console patterns as a shared contract, not page-by-page custom UI.

- Do not redesign common admin dashboard primitives separately on each page.
- Repeated patterns such as calendar chrome, date pickers, month/week navigation, filter bars, search inputs,
  summary cards, tables, status badges, empty states, loading states, error states, action bars, pagination,
  and right-side detail panels must stay visually and interaction-wise unified across the dashboard.
- If a page introduces a new shared pattern, define it in a way that can be reused by later admin pages
  instead of making a one-off layout.
- Calendar-related controls must stay especially consistent: the same date-selection concept should not look
  or behave differently between attendance, reservations, roster, payroll, or other admin pages without an
  explicit documented reason.
- Do not create feature-specific date pickers, calendar headers, filter rows, or table action areas when an
  existing dashboard pattern can be extended.
- Shared admin dashboard primitives live in `src/components/admin/shared`. Reuse or extend these first
  for month/date/time pickers, chip filters, reason modals, and side-panel behavior before adding a
  feature-local equivalent.
- Admin pages should feel like one coherent operations console. Mixed visual density, inconsistent spacing,
  or different control metaphors between dashboard pages are treated as incomplete work.
- Multilingual support is part of this contract: shared dashboard components must be checked against `ko`,
  `ja`, and `en`, including longer labels, button widths, date labels, table headers, and empty-state text.

#### 4a. Date selection — one calendar, no exceptions (ABSOLUTE, 2026-07-14)

Every date control in `/admin/*` is one of exactly three shared primitives in
`src/components/admin/shared`. There is no fourth, and there are no feature-local calendars.

| Need | Component | Form-friendly wrapper (for `<form method="get">`) |
| --- | --- | --- |
| A date range | `AdminDateRangePicker` | `DateRangeFormField` |
| A single day | `AdminDatePicker` | `DateFormField` |
| A month | `AdminMonthPicker` | — |

- **Never use a native `<input type="date">` inside the admin console.** It renders the browser's own
  calendar, which will never match the console.
- The canonical calendar chrome is the `.calpop` popover (the cleaning 기록 range picker): 292px wide,
  16px radius, 14px padding, 30px nav buttons, 34px day cells, today-dot marker. `.adp__*` (single day)
  and `.amp__*` (month) in `admin-console.css` are deliberately kept in lockstep with it — **if you
  restyle one, restyle all three.**
- `AdminMonthPicker` stays a *month* control (payroll / commute / wages). Do not silently convert a
  month selector into a range picker, or vice versa.
- **월 이동은 `shiftMonthKey()` (`src/components/admin/shared/admin-month-key.ts`) 하나만 쓴다.**
  `Date` 로 달을 더하지 말 것 — 이 콘솔의 날짜 키는 도쿄 기준이고, 도쿄 1일 00시는 UTC 로 전달
  말일이라 `setUTCMonth(+1)` 이 없는 날짜를 만들어 JS 가 굴려버린다. 2026-09-11 까지 범위 피커의
  화살표가 3·5·7·10·12월에서 **제자리였고** prev 는 한 달씩 건너뛰었다. 회귀 테스트:
  `src/lib/__tests__/admin-month-key.test.ts`.

#### 4b. Excel + PDF export — one control, one template (ABSOLUTE, 2026-07-14)

- Every export in `/admin/*` renders through **`<AdminExportButtons>`**
  (`src/components/admin/shared/admin-export-buttons.tsx`) — the `chipbtn` + lucide `Download` pair.
  Do not hand-roll export buttons.
- **Always ship Excel AND PDF together.** A screen that exports only one of the two is incomplete.
- Server side, both formats come from the same input shape:
  `buildAdminTableWorkbookBase64()` (`src/lib/admin-table-workbook.ts`) and
  `buildAdminTableReportHtml()` (`src/lib/admin-table-report.ts`). Reuse the green-ledger fills from
  `attendance-payroll-workbook.ts`; do not introduce new export colors or a new workbook layout.
- **CSV is retired.** Do not add a new CSV download, a `Blob`-based client export, or a
  `/api/admin/export/*` route — that whole path was deleted on 2026-07-14.
- **The export locale is resolved on the server** from `session.user.preferredLanguage` via
  `buildAdminExportMeta(session)`. A client must never pass a locale into an export action.
- Copy for both primitives lives in the shared `dictionary.admin.shared` namespace (`ko`/`ja`/`en`).
  Do not re-declare `exportXls`, `pickRange`, `dateApply`, etc. in a feature namespace.

If shared admin dashboard behavior or structure changes, also review and update:

- `docs/product/05-admin-web-ia.md`
- `docs/planning/01-decision-log.md`
- `docs/planning/06-current-status.md`

### 5. Respect Supabase client boundaries

- Do not mix browser and server Supabase usage carelessly.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to client code.
- Keep service-role usage in server-only paths.
- When auth routing changes, inspect `middleware.ts` carefully.

### 6. Organization isolation and permissions are server concerns

- All business records are organization-scoped by default.
- Do not rely on UI-only permission checks.
- Enforce access in server actions, queries, and RLS-compatible logic.
- Existing role rules such as part-time restrictions and office-level order processing are intentional. Verify before changing.

### 7. Tokyo timezone matters

This project uses Tokyo operating dates in several important flows.

- Do not casually use raw UTC date slicing for operational logic.
- Review existing patterns before changing cleaning dates, calendar logic, or order delivery dates.
- **`timestamptz` 컬럼을 날짜 범위로 거를 때는 `tokyoDayStart()` / `tokyoDayEndExclusive()`
  (`src/lib/tokyo-date.ts`) 를 쓴다.** `` `${from}T00:00:00Z` `` 로 붙이면 UTC 자정 기준이라
  **9시간 밀린다** — 시작일 오전 0~9시(도쿄) 것이 빠지고 종료일 다음 날 새벽 것이 섞인다.
  2026-09-11 에 게스트 피드백과 채용 지원서 두 곳에서 발견됐고, 리뷰 2,617건 중 17.8% 가
  UTC 날짜 ≠ 도쿄 날짜라 경계일마다 실제로 건수가 틀렸다(9/1~9/11: 19건 → 21건).
  회귀 테스트: `src/lib/__tests__/tokyo-day-range.test.ts`.

### 8. Upload and storage rules are not arbitrary

- Image upload limit is generally 5 files per feature. **Exception (2026-06-15):** project tasks
  (`tasks.project_id` set) allow up to 20 task-level photos; regular tasks and update-log photos stay
  at 5. Implemented via a `maxImages` prop (uploader + create/edit form) with the cap re-applied
  server-side. See `docs/engineering/09-todo-task-technical-design.md` → Images.
- Client-side compression is part of the current policy.
- Storage path validation and RLS expectations already exist. Do not bypass them casually.

### 9. Deletion policy is sensitive

- MVP user-triggered deletion is hard delete by default.
- **Exception — Todoist tasks (approved 2026-07-29): `tasks` use SOFT delete** (`deleted_at`) so the
  "실행 취소 / Undo" toast can restore a completion or a delete. User deletes set `deleted_at`; all task
  list/detail reads filter `deleted_at is null`; `restoreTask`/`restoreConsoleTask` clear it. Create-
  rollback deletes stay hard. This exception is scoped to tasks — do NOT extend soft-delete to other
  entities without the same explicit approval.
- Keep confirmation UX for destructive actions **that are not undoable**. A single-task delete is now
  immediate + undo (no confirm); bulk clears (지난 미완료 정리) and project/section deletes keep confirm.
- Do not switch other entities to soft delete or retention-heavy behavior without explicit user approval.

## High-Risk Change Areas

### i18n

- File: `src/lib/i18n.ts`
- All new visible strings must be translated across `ko`, `ja`, and `en`
- This includes status labels, validation errors, modal copy, and navigation labels
- **Never use a function-valued entry in `dictionary.tasks`.** That namespace is handed to a client
  component whole (`<TasksWorkspace copy={dict.tasks} />`), and RSC cannot serialize a function —
  one function value crashes `/mobile/tasks` entirely with "Functions cannot be passed directly to
  Client Components". Use a `{name}` placeholder string plus `.replace()`, like `completedDayCount`.
  Neither `tsc` nor lint catches this; `src/lib/__tests__/dictionary-serializable.test.ts` does.
  Other namespaces may keep function copy as long as only the resulting string crosses to a client.

### Auth and routing

- Files: `middleware.ts`, `src/lib/session.ts`, `src/lib/admin-session.ts`, `src/lib/dev-auth.ts`
- Login, onboarding, callback handling, and role redirects are easy regression points
- Track `next` query behavior and protected-route behavior carefully

### Shared mobile UX

- File: `src/components/shell/mobile-shell.tsx`
- Pull-to-refresh, header hide/show, sidebar behavior, and bottom tabs affect many screens at once

### Database and migrations

- Files: `supabase/migrations/*`, `src/types/database.ts`
- Add new migrations; do not rewrite already-applied history casually
- In-app notifications require `supabase/migrations/202606030001_notifications.sql` on the linked Supabase project (run via Dashboard SQL editor or `supabase db push` when CLI is linked)
- Leave remote-history placeholder migrations alone unless there is a very strong reason
- If schema changes, update DB types and related docs in the same cycle

### Beds24

- Files: `src/lib/beds24/*`, `src/app/api/beds24/*`, `src/app/api/dev/beds24/*`
- Webhook-first is a confirmed direction
- Do not regress toward frequent polling without user approval
- Never print tokens or secrets into docs or chat

## Working Style

### Default execution order

1. Read relevant docs and current implementation.
2. Define the impact area.
3. Update docs first if behavior is changing.
4. Make the smallest coherent code change.
5. Run `npm run lint`.
6. Run `npm run build`.
7. Re-sync docs to actual implementation details.

### Ask before changing these

Stop and confirm with the user before changing:

- role permissions
- deletion behavior
- multilingual strategy
- PWA-first direction
- major tech-stack direction
- any implementation that conflicts with a documented confirmed decision

## When Docs Must Be Updated

Update related docs when changing:

- fields
- statuses
- permissions
- route or entry flow
- mobile or admin IA
- storage rules
- RLS or org-isolation behavior
- notification behavior
- calendar calculation rules

Commonly related docs:

- `docs/planning/01-decision-log.md`
- `docs/planning/06-current-status.md`
- `docs/product/07-cleaning-workflow.md`
- `docs/product/08-maintenance-workflow.md`
- `docs/product/09-lost-found-workflow.md`
- `docs/product/10-order-request-workflow.md`
- `docs/product/11-announcement-workflow.md`
- `docs/product/15-reservation-calendar.md`
- `docs/product/16-mobile-navigation.md`
- `docs/engineering/04-data-model.md`
- `docs/engineering/05-rls-permissions.md`
- `docs/engineering/07-environment-setup.md`

## Secrets and Local Files

- Never paste real secret values into docs or chat.
- Especially protect:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - Supabase anon and service keys
  - Beds24 API tokens and webhook secret
  - OAuth secrets
  - VAPID private key
- Do not dump full contents of `.env`, `.env.local`, or `cookies.txt`.

## Do Not Touch Casually

- `node_modules/`
- `.next/`
- old applied migrations
- documented role names, statuses, and product terminology without checking the docs first

## Verification

Current baseline verification after code changes:

```bash
npm run lint
npm run build
```

If the change is user-facing, also verify when relevant:

- mobile and admin flows both still work
- `ko`, `ja`, and `en` strings exist
- permission differences still hold
- empty and error states still render correctly

## Expected Reporting Style

- Report in Korean to the user.
- State what changed and which docs were updated.
- If verification was not run, say so explicitly.
- If domain behavior is unclear, ground decisions in existing docs and implementation first.
