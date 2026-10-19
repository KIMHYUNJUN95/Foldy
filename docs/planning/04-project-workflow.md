# Project Workflow

## Purpose

This document defines how Foldy should be planned, designed, built, and updated.

The project should be treated like a real team project, even when work is done with AI tools.

## Working Principle

Do not jump straight into coding.

Use this flow:

```txt
Plan
Design
Document
Implement
Test
Review
Update documentation
Repeat
```

## Practical Workflow

## 1. Planning

Define:

- Problem
- Users
- Roles
- Permissions
- Workflows
- MVP scope
- Out-of-scope items

Planning documents must be updated before implementation starts.

## 2. Core Flow Definition

Before building a feature, define:

- Who uses it
- Where they enter
- Required fields
- Statuses
- Permissions
- Notifications
- Edge cases
- Mobile/admin behavior

## 3. Stitch Design

Use Google Stitch for key screens.

Design first for:

- Login/signup
- Mobile home
- Cleaning timer
- Requests
- Reservation calendar
- Announcements
- Admin dashboard

Do not wait for every screen to be designed before starting development.

Recommended approach:

```txt
Design the first 5-7 core screens
Build the foundation
Iterate feature by feature
```

## 4. Technical Design

Before implementation, define:

- Data model
- Supabase schema
- RLS policy direction
- API or server function behavior
- File storage rules
- Notification triggers

## 5. Implementation

Build in small vertical slices.

Before writing UI for any new or changed feature:

- do **not** hardcode Korean-only visible text
- define the needed visible copy in `src/lib/i18n.ts`
- add `ko`, `ja`, and `en` together in the same implementation cycle
- treat multilingual design as part of the first implementation, not a later cleanup step

Recommended first build order:

```txt
Project setup
i18n foundation
Theme/design tokens
Auth
Organization/invite flow
User profile/directory
Mobile shell
Admin shell
Cleaning timer
Requests
Announcements
Reservation calendar
Notifications
Exports
```

## 6. Testing

Each feature should be tested for:

- Mobile PWA
- Admin web
- Light mode (dark mode deferred until post-launch — light-mode-only)
- Korean
- Japanese
- English
- Permissions
- Empty state
- Error state

Automated i18n check:

- An automated guard (`npm run check:i18n`, also part of `npm test`) fails when hardcoded Korean/Japanese/Kanji literals are added under `src/app` or `src/components`. New visible copy must go through `src/lib/i18n.ts` (ko/ja/en together). Legitimate domain data uses an `i18n-ignore` directive with a justifying comment. See the engineering implementation plan for details.

## 7. Documentation Updates

Every feature change must update documentation.

If implementation changes:

- Requirements
- Fields
- Statuses
- Permissions
- UI flow
- Notifications
- Data model
- API behavior
- Tech stack
- Design rules

Then the related Markdown files must be updated in the same work cycle.

Task completion rule:

- Every time one task finishes, update the matching Markdown docs before considering the task complete.
- Code-only completion is not accepted, even for small fixes.
- If the implementation drifted while coding, reconcile the docs again in the same cycle.

## Documentation Is Source of Truth

Markdown docs are the shared project memory.

If code and docs disagree:

- Stop
- Identify which is correct
- Update the incorrect side
- Record important decisions in `docs/planning/01-decision-log.md`

## Change Rule

When adding or changing a feature:

```txt
1. Update or create planning/product/design/engineering docs
2. Implement code
3. Test
4. Update docs again if implementation changed from the plan
```

## AI Handoff Rule

When work continues in a new AI chat, the handoff prompt should include:

1. What has already been completed
2. What is currently stable and verified
3. The single next recommended slice to start
4. Which Markdown documents must be treated as source of truth
5. The required verification steps after changes
6. Any communication rules that the assistant must keep following

Current Foldy handoff expectations:

- Reply in Korean
- Check existing docs and code state first
- Never revert user changes
- Update related Markdown docs in the same work cycle
- Run `npm run lint` and `npm run build` after feature/code changes; run `npm test` when touching i18n or shared logic (includes the hardcoded-string guard)
- When the user asks for the next planned slice, answer with:
  - `현재 이슈`
  - `다음 작업`
  - Then wait for the user to say start
- When the user reports a bug, investigate and fix directly without stopping at planning only
- Keep the workflow/status documents current as implementation moves
- Treat every completed task as requiring code sync and doc sync together

## Admin Dashboard Active Workflow

For the admin-dashboard rebuild, use a lightweight active-workflow model:

- `docs/planning/16-admin-dashboard-workflow.md` = active board only
- `docs/planning/06-current-status.md` = completed record
- `docs/planning/01-decision-log.md` = important dashboard decisions

The dashboard workflow intentionally stays short:

```txt
Backlog -> Ready -> Design -> Build -> Verify -> Done
```

Completed dashboard items should be removed from the active board and recorded in current-status.

## Important Rule

No major feature should be implemented only in code without documentation.

## 2026-05-22 Update: Global Mobile Shell Rule

All mobile screens that use `MobileShell` must inherit the unified mobile shell contract.

- Top chrome: three-line hamburger menu trigger (shorter middle line), notification bell, and profile link. **2026-10-19 (HIG 다듬기 2차):** the
  `Foldy` wordmark is gone — the center shows the screen's compact title only after its large title (`[data-large-title]` or first `h1`) scrolls
  under the bar. List screens use a 34/41 large title. Separators everywhere use `--separator` with the shared inset rule (docs/design/05).
- Top chrome is scroll-aware: it hides on downward scroll and returns on upward scroll.
- Side menu: the top-left menu trigger opens a full-screen left slide-in navigation sheet. The old 78%-width drawer pattern is retired because exposed dimmed slivers repeatedly caused iOS Safari / standalone PWA status-bar and seam artifacts.
- Bottom navigation: the current shared contract is the solid warm-ivory bottom-attached tab bar with a raised center squircle FAB, not a floating capsule.
- Base surface: warm-ivory canvas/chrome with cream-white cards and sheets. Liquid Glass is partial and must not be used as a blanket full-screen treatment.
- Top bar and bottom tab bar must stay globally consistent across features unless an explicit documented design decision changes them.
- Bottom sheets must stay globally consistent too: iPhone-style drag-down-to-dismiss from the upper touch area/handle, plus empty-scrim tap dismissal.
- Do not create feature-specific bottom-sheet closing patterns or overly narrow drag areas.
- Do not add page-specific controls, titles, or secondary icons to the header.
- The `title` prop on `MobileShell` is for `aria-label` on `<main>` only; it is not rendered in the header.
- New mobile pages must not reinstate the old stacked-title pattern.
- See `docs/product/16-mobile-navigation.md` for the full spec.

## 2026-05-21 Update

- Added request-image slice to active workflow:
  1. DB/storage migration
  2. Mobile request form upload UX
  3. Server validation + persistence
  4. Detail-view rendering
  5. `npm run lint` + `npm run build`
- Scope: mobile lost-item request and maintenance request now require 0-5 image support path.

## 2026-05-22 Enforcement Note

- For mobile UI, shared `MobileShell` structure and behavior must stay globally consistent across pages.
- Any change to shared shell behavior must be reflected in:
  - `docs/planning/06-current-status.md`
  - `docs/engineering/06-implementation-plan.md`
  - `docs/product/16-mobile-navigation.md`

## 2026-05-22 Baseline Documentation Rule

When a feature reaches "baseline implemented" (not feature-complete), the workflow/status docs must separate:

1. **Implemented now**: list exact behaviors, file paths, and data constraints (e.g., "staying: `check_in_date <= today AND check_out_date > today`").
2. **Deferred / next slice**: list what is explicitly planned for the next iteration.
3. **Deferred / later**: list what requires external dependencies (room master, admin parity, etc.).

Do not conflate "baseline done" with "feature complete." The docs are the ground truth; stale "awaits X" statements must be removed as soon as baseline is shipped.

## 2026-05-23 Phase 10 Workflow Update

- `/mobile/calendar` now includes:
  - system-adapted overview timeline (room column + horizontal date axis + reservation bars),
  - lists mode (check-in/check-out/staying),
  - reservation detail bottom-sheet modal,
  - month navigation via `month=YYYY-MM` query (prev/next controls).
- Keep the global mobile shell contract unchanged (`[three-line hamburger] Foldy [Notifications + Profile]`, scroll-aware top chrome, full-screen side menu, warm-ivory bottom tab bar with center FAB, shared drag-down bottom sheets).
## 2026-05-27 Workflow Rule Update

- Documentation-first enforcement is now explicit for all contributors:
  1. update relevant Markdown docs first,
  2. implement code following updated docs,
  3. run verification,
  4. finalize by reconciling docs with the actual implementation.
- "Code first, docs later" is not accepted as a completion state.
- Project-flow compliance is required even for rapid bug-fix cycles; only investigation/patch order can be accelerated, not documentation closure.
