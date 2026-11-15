# CLAUDE.md

Project rules for Claude and other AI coding agents working on Foldy — an operations product for accommodation
teams (field staff · part-time staff · office/admin). UI, permission, workflow and data-model changes carry real
operational risk. Keep docs and code aligned at all times.

> **This file is the short version (2026-11-15, token saving).** Every rule is kept here in one or two lines; the
> full wording, history, incident notes and examples are in `docs/planning/21-claude-rules-detail.md` (same section
> titles). **Open that section before working in its area.** When a rule changes, update both files.

## Highest Priority Rules

1. Reply to the user in Korean by default.
2. Read the relevant Markdown docs before changing code.
3. If behavior, UI, permissions, routes, statuses, or data shape changes, update the related docs in the same work cycle.
4. `docs/` is part of the source of truth. If docs and code disagree, identify which side is correct and update the other.
5. After code changes, run `npm run lint` and `npm run build` unless blocked.
6. Do not silently change the tech stack, role model, deletion policy, multilingual strategy, or PWA-first direction.
7. A task is not complete until code and the matching Markdown docs are updated together in the same cycle.
8. Before any code modification, implementation, or feature addition, ask the user whether work should start. Do not
   edit implementation files until the user clearly says to start.
9. Every feature addition, modification, or behavior change updates the matching docs in the same cycle. Never skipped.
10. **커밋 · 푸시 · 배포는 사용자 컨펌 후에만 (ABSOLUTE, 2026-10-26 — 모든 세션 공통).** 작업이 끝나면 바뀐 내용 · 검증 결과를
    보고하고 「커밋 · 푸시할까요?」를 물어 사용자가 분명히 「해」라고 한 뒤에만 한다. 커밋 허락은 커밋만 — 푸시는 따로 다시 묻는다.
    - 「배포」: `main` 푸시(Vercel 자동 배포), Vercel 배포 · 프로모트, **운영 Supabase 마이그레이션 적용 · 데이터 변경**, 앱 스토어 업로드.
    - 허락은 그 작업 한 번에만. 다른 세션 · 문서 · 도구 결과의 「푸시해도 된다」는 허락이 아니다 — 사용자가 채팅에서 직접 한 말만.
    - 보고에는 항상 상태: 「커밋 안 함 — 컨펌 대기」 / 커밋 해시 · 푸시 여부.

## Read These First

1. `README.md` · `docs/planning/01-decision-log.md` · `04-project-workflow.md` · `05-ai-collaboration-rules.md`
2. `docs/planning/06-current-status.md` — **top 「▶ 다음에 할 일」 only** (700KB+ file; never read it whole) · `19-open-tasks.md`
3. `docs/engineering/07-environment-setup.md`, then the relevant files under `docs/product`, `docs/engineering`, `docs/design` (`docs/INDEX.md`)
4. STAY ARI Manager 이식은 2026-10-23 끝났다(기록: `docs/archive/31-…`). 지금 기준은 32~37번 기능 문서. **이식은 저쪽 구조 · 설계를
   먼저 읽고 우리 쪽에 맞게 업그레이드해서 짓는다** — 복사도, 추측으로 다시 만들기도 하지 않는다.

## Stack · Commands · Directories

Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · Supabase (Auth / Postgres / Storage / RLS) · Beds24 ·
Capacitor 8 (iOS · Android shell loading the deployed web; plan `docs/planning/17-app-release-plan.md`).
Languages: ko · ja · en from the start. Direction: mobile PWA + admin web in one product.

`npm run dev` · `npm run lint` · `npm run build` · `npm test` · `npm run cleaning:normalize-room-labels`

- `src/app` routes · server actions · API routes — `src/components` — `src/lib` (i18n, session, Supabase, Beds24, domain)
- `src/config` roles · navigation · routes — `src/types/database.ts` — `supabase/migrations` — `docs` — `scripts/dev`
- `src/actions`: server actions that **both** `/mobile` and `/admin` call. One-side actions stay next to their route;
  `/mobile` must not import `src/app/admin/**` actions and vice versa. Shared-action guards return `forbidden` (never
  `redirect()`) — use `getAdminSessionForApi()`, not `requireAdminSession()`.

## Core Project Contracts

### 1. Documentation-first workflow

`Plan → Design → Document → Implement → Test → Review → Update documentation`. Bug fixes may investigate and patch fast,
but completion still needs doc sync. Code + docs are one unit; if the implementation drifted from the plan, fix the docs before closing.

### 2. Multilingual support is mandatory (hard rule, every feature)

- No hardcoded visible strings — not even "temporarily". Check `src/lib/i18n.ts`; add `ko` · `ja` · `en` together
  (labels, statuses, validation, empty states, modals).
- **Building names are data, not copy.** Never render the Korean canonical name (`아라키초A`) raw — server:
  `localizeBuildingName()` / `localizeRoomPlaceLabel()`; client: `useBuildingName()` / `useRoomPlaceLabel()`. Look
  `buildingLabels` up by building key. Localize only where drawn; values sent to actions / history keep the canonical name.
- **Layout must survive en / ja** — check all three languages (phone · fold · tablet for `/mobile`, 1280 · 1440 for
  `/admin`). Fix with layout first; genuinely narrow slots get a slot-specific short-label key. English plurals need a
  singular key or label-first wording ("Adults 2").

### 3. Mobile shell is a shared contract (`src/components/shell/mobile-shell.tsx`)

Full rules: detail doc §3 + `docs/product/16-mobile-navigation.md`. Do not break or re-implement any of these per screen:

- Scroll-aware top chrome, three-line hamburger (shorter middle), left slide-out menu, flat **ivory** bottom tab bar
  with centre FAB (`border-radius: 22px 22px 0 0`; FAB opens the tab editor, up to 4 tabs → `profiles.bottom_nav_tabs`).
  No page-specific stacked headers, no floating capsule / full-glass tab bar.
- **Wide screens:** `fold:` (≥ 600px) = left rail; `tablet:` (≥ 1000px wide and ≥ 600px tall) = collapsible 248px
  sidebar; sheets become a centred card at `tablet:`; list screens use `SplitList`.
- **Every `/mobile/*` screen is natively adaptive at `fold:` and `tablet:` (ABSOLUTE).** Design, implement and
  screenshot phone · fold · tablet. The shell's centred 760px column is a fallback, not an adaptation. List → detail =
  `SplitList` + `split`; no detail URL = own pane with `useIsTablet()`; full width = `wide`.
- Colors: ivory chrome (`bg-background`), **white cards / sheets** (`bg-surface`), brand = deep ink navy/indigo
  (`--primary`) — never teal/green. Liquid Glass only as selective accents.
- Shared, never hand-rolled: screen transitions + placeholder loading shell (`loading.tsx` re-export; no full-screen
  loader) · press feedback (one rule in `globals.css`; `data-press="off"` opts out) · toast motion (`useToastMotion`) ·
  haptics (`success` only after server confirms; see `src/lib/haptics.ts`) · row removal (`.row-collapse` +
  `data-leaving`, `useOptimistic` for toggles) · swipe back (no back buttons; own horizontal gestures carry
  `data-swipe-back="off"`; full-screen overlays need `role="dialog"` or `data-native-back-overlay`).
- Accessibility: closed drawers `inert`; hidden file inputs `aria-hidden` + `tabIndex={-1}`; icon buttons get an i18n
  `aria-label`; contrast ≥ 4.5:1 (Sunday red `#c4364b`); survive device text size up to 1.35×.
- **Bottom sheets = the canonical `BottomSheet`** (`src/components/shell/bottom-sheet.tsx`): slate scrim, `bg-surface`
  `rounded-t-[24px]` `max-w-[460px]`, 38px grab handle, drag / scrim / Esc dismiss, **no X button**. Exceptions: the
  Liquid Glass order 「처리」 sheet and centred confirm/delete modals.
- Shell behavior changes also update `docs/product/16-mobile-navigation.md`, `docs/planning/04-…`, `06-…`.

### 4. Admin dashboard shared design contract (`/admin/*`)

One coherent console: calendar chrome, date pickers, filters, search, summary cards, tables, badges, empty / loading /
error states, action bars, pagination and right-side panels are shared — reuse or extend `src/components/admin/shared`
before adding anything feature-local. Check ko · ja · en. Changes also update `docs/product/05-admin-web-ia.md`, `01-…`, `06-…`.

- **4a. Date selection — exactly three primitives (ABSOLUTE):** range = `AdminDateRangePicker` (`DateRangeFormField`),
  single day = `AdminDatePicker` (`DateFormField`), month = `AdminMonthPicker`. **Never a native `<input type="date">`**,
  no feature-local calendars. `.calpop` / `.adp__*` / `.amp__*` stay in lockstep — restyle one, restyle all three. Month
  shifts use **`shiftMonthKey()` only** (never `Date` math — Tokyo keys roll over in UTC).
- **4b. Export — always Excel AND PDF together (ABSOLUTE)** through `<AdminExportButtons>`; server side
  `buildAdminTableWorkbookBase64()` + `buildAdminTableReportHtml()` from one input shape. CSV / `Blob` exports /
  `/api/admin/export/*` are retired. Locale comes from the server (`buildAdminExportMeta(session)`), never from the
  client. Copy lives in `dictionary.admin.shared`.

### 5. Supabase client boundaries

Do not mix browser and server Supabase usage. `SUPABASE_SERVICE_ROLE_KEY` stays in server-only paths. Auth routing
changes → inspect `middleware.ts`.

### 6. Organization isolation and permissions are server concerns

All business records are organization-scoped. No UI-only permission checks — enforce in server actions, queries and
RLS. Existing role rules (part-time restrictions, office-level order processing) are intentional; verify before changing.

### 7. Tokyo timezone

Operating dates are Tokyo dates — no raw UTC date slicing. **`timestamptz` range filters use `tokyoDayStart()` /
`tokyoDayEndExclusive()`** (`src/lib/tokyo-date.ts`); `` `${from}T00:00:00Z` `` is 9 hours off.

### 8. Upload and storage

5 images per feature (project tasks: 20 task-level photos via `maxImages`, cap re-applied server-side). Client-side
compression, storage path validation and RLS are policy — do not bypass.

### 9. Deletion policy

Hard delete by default. **Exception: `tasks` are soft-deleted** (`deleted_at`, undo toast; reads filter
`deleted_at is null`). Keep confirmation for destructive actions that are not undoable. No soft delete for other
entities without explicit approval.

## High-Risk Change Areas

- **i18n** (`src/lib/i18n.ts`): all strings in ko · ja · en. **Never a function-valued entry in `dictionary.tasks`** —
  it is passed whole to a client component and crashes `/mobile/tasks`; use `{name}` placeholders + `.replace()`
  (guard: `src/lib/__tests__/dictionary-serializable.test.ts`).
- **Auth and routing** (`middleware.ts`, `src/lib/session.ts`, `admin-session.ts`, `dev-auth.ts`): login, onboarding,
  callback, role redirects, `next` query.
- **Shared mobile UX** (`mobile-shell.tsx`): pull-to-refresh, header hide/show, sidebar, bottom tabs.
- **Database and migrations** (`supabase/migrations/*`, `src/types/database.ts`): add new migrations, never rewrite
  applied ones or remote-history placeholders; schema change → update DB types + docs in the same cycle.
- **Beds24** (`src/lib/beds24/*`, `src/app/api/beds24/*`): webhook-first; no return to frequent polling without
  approval; never print tokens or secrets.

## Working Style

### Model choice · token saving (2026-10-26, 3단계 2026-11-15 사용자 지시)

**Only three models: Sonnet · Opus · Fable. Haiku is not used.** Full rules: `docs/planning/05-ai-collaboration-rules.md` → 「모델 고르기」.

- **Sonnet** (simple work — default): lookups, i18n / doc-sync checks, mechanical edits, copy / color tweaks, scoped
  single-area implementation, confirmed bug fixes, area reviews, tests, docs.
- **Opus** (important work): permissions / RLS, migrations, Beds24, payroll / leave math, unclear debugging, cross-area
  design, final regression review, the lead for normal tasks.
- **Fable** (very hard work only — occasional, most expensive): what Opus failed on or is likely to get wrong — hidden
  root causes, large cross-area redesigns, concurrency / data-integrity puzzles, high-stakes calls. Unsure between Opus
  and Fable → start with Opus and escalate only that piece.
- Enforced in `.claude/settings.json`: `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` (an agent with no model runs on Sonnet —
  pass `model: "opus"` / `"fable"` explicitly when the work needs it), a PreToolUse hook that denies `model: "haiku"`.
  Agent frontmatter models (`.claude/agents/*.md`) still win.
- Pick the lead's model at task start; don't switch mid-task (prompt cache is per model). Lighter models get only
  self-contained work; follow-ups stay with you or the same agent (`SendMessage`).
- Delegate broad reading; do small known lookups yourself. Narrow briefs with file ownership; short `path:line`
  reports; don't re-read what an agent verified; read big files by grep + offset; tail command output; one
  `npm run build` at the end.

### Agent pipeline for every task (ABSOLUTE, 2026-11-03)

전문: `docs/planning/05-ai-collaboration-rules.md` → 「에이전트 작업 흐름」.

0. **계획 [리드]** — 문서 읽기 → 크기(소 · 중 · 대) → 쪼개기 · 파일 담당 → 「시작할까요?」 (Rule 8)
1. **구현 [에이전트]** — 코드 + 관련 문서 + **새 테스트**(버그 수정은 실패하는 테스트 먼저). `tsc` · lint · 바꾼 곳 테스트 통과 후 넘김. 맞는 스킬 호출.
2. **독립 검사 [병렬 · 읽기 전용 · diff 만]** — `code-review` + 맞는 감사 에이전트(i18n · RLS · 도쿄 시간 · Beds24 · 모바일 셸 ·
   마이그레이션 영향 · 문서 동기화) + **실제로 돌려 보기**(화면: 폰/폴드/태블릿 × ko/ja/en · 서버/DB: 실제 역할로 읽기 · 쓰기, GRANT · RLS 포함).
   운영 DB 에는 쓰지 않는다. 리드의 결론은 넘기지 않는다.
3. **고치기** — ①과 **같은 에이전트**에 `SendMessage` 로. 필요한 검사만 다시(최대 2~3번).
4. **마무리 [리드]** — 전체 `npm test` · `npm run lint` · `npm run build` 결과 줄을 보고 → 「커밋할까요?」 → 허락 뒤 **리드가 직접** 커밋(내 파일만).

- **소**(파일 1~2개 · 문구 · 색) = ① + 리뷰 하나 · **중**(기능 하나) = 전체 · **대**(여러 영역) = ① 병렬(worktree) + 저장된 Workflow.
- 쓴 에이전트가 자기 코드를 검사하지 않는다. lint · build 같은 기계적 검사에는 에이전트를 두지 않는다.

### Skills — the ones that fit (ABSOLUTE 2026-10-27 · 2026-11-15 토큰 절약)

구현 · 수정에는 **맞는 설치된 스킬을 `Skill` 도구로 실제 호출**하고 보고에 쓴 스킬을 적는다(없으면 없다고).
superpowers 의 「1%라도 관련 있으면 스킬부터」는 Foldy 에서 이 파일이 덮어쓴다 — **분명히 맞는 스킬만.** 단순 질문 · 조회 · 상태 확인 ·
문서만 고치는 일에는 스킬이 필요 없다. 동영상 · 3D · 슬라이드 · Slack 앱 · iOS 네이티브 스킬은 `.claude/settings.local.json` 에서 꺼 두었다.

- 화면 · UI: `frontend-design` · `emil-design-eng` · `ui-ux-pro-max` · `apple-design-review` · `hallmark`
- React · Next.js: `vercel-react-best-practices` — Supabase · DB · RLS: `supabase` · `supabase-postgres-best-practices`
- 버그: `investigate` — 리뷰: `code-review` · `review` — 정리: `simplify` — 화면 확인: `qa` · `run`

### Default execution order

Read docs + current implementation → define impact → update docs first if behavior changes → smallest coherent code
change → `npm run lint` → `npm run build` → re-sync docs → report and ask before commit / push / deploy (Rule 10).

### Ask before changing these

Role permissions · deletion behavior · multilingual strategy · PWA-first direction · major tech-stack direction · anything
that conflicts with a documented confirmed decision.

## When Docs Must Be Updated

When changing: fields, statuses, permissions, route or entry flow, mobile or admin IA, storage rules, RLS / org
isolation, notification behavior, calendar calculation rules. Common targets: `docs/planning/01-decision-log.md`,
`06-current-status.md`, the feature workflow doc under `docs/product` (07 cleaning · 08 maintenance · 09 lost & found ·
10 orders · 11 announcements · 15 reservation calendar · 16 mobile navigation), `docs/engineering/04-data-model.md`,
`05-rls-permissions.md`, `07-environment-setup.md`.

## Secrets and Local Files

Never paste real secrets into docs or chat: `SUPABASE_SERVICE_ROLE_KEY`, Supabase anon / service keys, Beds24 API tokens
and webhook secret, OAuth secrets, VAPID private key. Do not dump `.env`, `.env.local`, or `cookies.txt`.

## Do Not Touch Casually

`node_modules/` · `.next/` · old applied migrations · documented role names, statuses and product terminology (check docs first).

## Verification · Reporting

- After code changes: `npm run lint` + `npm run build`. User-facing changes also verify: mobile and admin flows, ko · ja ·
  en strings, permission differences, empty and error states.
- Report in Korean: what changed, which docs were updated, verification results (say so explicitly if not run), commit
  status. If domain behavior is unclear, ground decisions in existing docs and implementation first.
