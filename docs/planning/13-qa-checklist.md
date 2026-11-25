# Phase 13: Full-System QA Checklist

Last updated: 2026-07-14  
Verification method: code trace + unit tests + TypeScript build + DB migration check (browser E2E pending)

Use this document as the live gate for internal rollout decisions.  
For the rollout execution steps, see `docs/planning/14-rollout-guide.md`.

---

## How to Use This Checklist

- **Code trace**: reviewed in source without a running browser session.
- **Unit test**: covered by automated Vitest suite (`npm test`). Pass = all 64 tests green.
- **Build verified**: confirmed by `npm run lint` + `npm run build`.
- **DB verified**: confirmed by comparing local migrations against remote Supabase history.
- **Browser E2E**: requires a logged-in session and real device. Mark as Pass only after manual confirmation.
- **Deferred**: intentionally not implemented for MVP; no action needed before rollout.

---

## 1. Auth and Onboarding

| Test case | Method | Status |
|---|---|---|
| Email magic-link triggers login | Browser E2E | Not tested |
| Auth callback redirects correctly after email click | Browser E2E | Not tested |
| First-time user reaches `/onboarding` | Browser E2E | Not tested |
| Profile completion (name, phone, language) saves correctly | Browser E2E | Not tested |
| Onboarding shows a visible `return to login` action on every step and returns to `/auth/login` after sign-out | Browser E2E | Not tested |
| Duplicate phone-number submit returns user to the phone step with recovery guidance | Browser E2E | Not tested |
| Invite code join assigns correct role | Browser E2E | Not tested |
| First developer/super-admin claim works | Browser E2E | Not tested |
| Unauthenticated access to `/mobile/*` redirects to login | Code trace | Pass |
| Unauthenticated access to `/admin/*` redirects to login | Code trace | Pass |
| `next` param preserved from login through onboarding to the original destination | Code trace | Pass |
| Language preference persists across sessions | Browser E2E | Not tested |

### Auth/Onboarding Hardening — Automated Unit Tests (added 2026-06-04)

Run with `npm test`. All cases below are covered by `src/lib/__tests__/`.

| Test case | Method | Status |
|---|---|---|
| `sanitizeNextPath` rejects `https://evil.com`, `//evil.com`, `/\evil.com`, `/\\evil.com` | Unit test | Pass |
| `sanitizeNextPath` rejects non-path strings, null, undefined, non-string values | Unit test | Pass |
| `sanitizeNextPath` returns custom fallback for unsafe values | Unit test | Pass |
| `sanitizeNextPath` accepts `/mobile`, `/onboarding?next=%2Fmobile`, `/admin/users?id=1#section` | Unit test | Pass |
| `isLocale` accepts `ko`, `ja`, `en` | Unit test | Pass |
| `isLocale` rejects `kr`, `JP`, `english`, empty string, null, undefined, values with whitespace | Unit test | Pass |
| Invite RPC known error keys (`missing_invite`, `invalid_invite`, `invite_inactive`, `invite_expired`, `invite_maxed`, `membership_blocked`) pass through as-is | Unit test | Pass |
| Unknown RPC errors (`forbidden`, `missing_user`, `internal_error`, empty string) map to `invite_join_failed` | Unit test | Pass |
| `forbidden` is NOT a passthrough key (DB internals not exposed to UI) | Unit test | Pass |
| `actions.ts` calls `join_organization_with_invite_code` RPC (no manual DB ops) | Unit test | Pass |
| `actions.ts` does not manually increment `used_count` | Unit test | Pass |
| `actions.ts` does not directly upsert `memberships` in invite join flow | Unit test | Pass |

### Remaining Browser E2E gaps for auth/onboarding

The automated tests above cover pure-function and static-structure behavior. The following still require a live browser session with a real Supabase connection:

- Actual magic-link email delivery and click-through
- Google OAuth flow (live; Supabase dashboard OAuth provider setup required for production)
- Onboarding form submission reaching the DB (profile + invite join)
- Auth callback `?next=` forwarding through to the final destination in a real browser
- Middleware redirect behavior under different auth states

---

## 2. Home (Mobile)

| Test case | Method | Status |
|---|---|---|
| Home loads with check-in/check-out counts | Browser E2E | Not tested |
| Active cleaning task card shows when session in progress | Browser E2E | Not tested |
| Today's activity timeline renders completed sessions | Browser E2E | Not tested |
| Error state shows retry CTA (not blank screen) | Code trace | Pass |
| Empty state shows correct message per locale | Code trace | Pass |
| Quick actions route correctly (Cleaning, Maintenance, Lost Item, Order) | Code trace | Pass |
| Latest announcement card links to detail | Code trace | Pass |
| "Last updated" clock refreshes without page reload | Code trace | Pass |
| Pull-to-refresh triggers page reload | Code trace | Pass |
| Room labels on activity timeline are localized (ko/ja/en) | Code trace | Pass |

---

## 3. Reservation Calendar

### Mobile (`/mobile/calendar`)

| Test case | Method | Status |
|---|---|---|
| Building picker shows before selecting a property | Code trace | Pass |
| Overview mode renders room-axis timeline with reservation bars | Browser E2E | Not tested |
| Today column is highlighted | Code trace | Pass |
| Auto-scroll positions today column on initial load | Code trace | Pass |
| Month prev/next navigation works | Code trace | Pass |
| Out-of-window month shows warning banner (no partial data) | Code trace | Pass |
| Lists mode shows check-in / check-out / staying today lists | Code trace | Pass |
| Reservation detail bottom sheet opens on tap | Browser E2E | Not tested |
| Bottom sheets dismiss by dragging the grab handle/header down; partial drag snaps back; background stays put | Browser E2E (touch) | Not tested |
| Bottom sheets have no top-right X close button (drag / scrim tap / Esc dismiss) | Code trace | Pass |
| Map tab shows building cards with address and access codes | Code trace | Pass |
| Cancelled reservations are excluded | Code trace | Pass |
| Realtime update refreshes calendar after webhook event | Code trace | Pass |
| Empty count shows provisional warning when room master not loaded | Code trace | Pass |
| Empty count switches to authoritative when room master is populated | Code trace | Pass |

### Admin (`/admin/calendar`)

| Test case | Method | Status |
|---|---|---|
| Month grid renders rooms × days with guest name cells | Browser E2E | Not tested |
| Today column highlighted | Code trace | Pass |
| Property filter chips filter room axis and stats | Code trace | Pass |
| Check-in / check-out lists show today's guests | Code trace | Pass |
| Reservation export opens `/admin/calendar/print` (A4 landscape month board for browser print/save-as-PDF) — CSV download route no longer exists (2026-07-10) | Code trace | Pass |
| Out-of-window month shows notice card | Code trace | Pass |

---

## 4. Cleaning Workflow

| Test case | Method | Status |
|---|---|---|
| Cleaning list shows rooms with check-out today | Code trace | Pass |
| Setting list shows rooms with check-in today | Code trace | Pass |
| Rooms with completed/in-progress sessions are excluded from both lists | Code trace | Pass |
| Building sections group correctly with operational order | Code trace | Pass |
| Building labels are localized (ko/ja/en) | Code trace | Pass |
| Cascading building-to-room select works in manual section | Code trace | Pass |
| Starting a session creates DB record and activates timer | Browser E2E | Not tested |
| Active timer card shows elapsed time | Browser E2E | Not tested |
| Completion modal shows note input | Browser E2E | Not tested |
| Completing session updates admin cleaning list | Browser E2E | Not tested |
| "Report Lost Item" shortcut pre-fills building/room | Code trace | Pass |
| "Report Issue" shortcut pre-fills building/room | Code trace | Pass |
| Top KPI counts (cleaning targets / setting targets / in-progress) are org-wide | Code trace | Pass |
| Admin cleaning page shows org-scoped sessions by date | Code trace | Pass |

---

## 5. Requests

### Lost-Found

| Test case | Method | Status |
|---|---|---|
| Create form has building-to-room cascade | Code trace | Pass |
| Standalone form submission creates record and shows detail | Browser E2E | Not tested |
| Linked (from cleaning) form pre-fills room and requires confirmation | Code trace | Pass |
| Detail page shows status progress bar | Code trace | Pass |
| Admin can update status via detail page | Browser E2E | Not tested |
| Images upload and appear in detail | Browser E2E | Not tested |
| Scope toggle (All / My) filters list correctly | Code trace | Pass |

### Maintenance

| Test case | Method | Status |
|---|---|---|
| Create form has building-to-room cascade | Code trace | Pass |
| Standalone form submission creates record and shows detail | Browser E2E | Not tested |
| Admin can update status via detail page | Browser E2E | Not tested |
| Images upload and appear in detail | Browser E2E | Not tested |

### Order Requests

| Test case | Method | Status |
|---|---|---|
| Create form accepts items (name, quantity, unit) | Browser E2E | Not tested |
| Submitted order appears in admin `/admin/orders` list | Browser E2E | Not tested |
| Admin approves order (status changes from `requested` to `approved`) | Browser E2E | Not tested |
| Admin processes order; delivery date is required | Code trace | Pass |
| Admin processes order with delivery range | Code trace | Pass |
| `delivery_date` column exists in remote DB | DB verified | Pass |
| `delivery_start_date` / `delivery_end_date` columns exist | DB verified | Pass |
| Order detail shows timeline (3 steps: requested / approved / ordered) | Code trace | Pass |
| `closed` status shows neutral (muted) timeline bar | Code trace | Pass |
| Delivery date renders in Tokyo timezone | Code trace | Pass |
| Mobile requester receives notification when order processed | Code trace | Pass |

---

## 6. Announcements

| Test case | Method | Status |
|---|---|---|
| Admin can create announcement with up to 5 images | Code trace | Pass |
| Client-side image compression before upload | Code trace | Pass |
| Images upload to Supabase Storage with validated path | Code trace | Pass |
| Draft / publish / archive status transitions work | Browser E2E | Not tested |
| Published popup-enabled announcement appears as modal | Browser E2E | Not tested |
| "Do not show for 7 days" persists across devices | Code trace | Pass |
| Mobile announcement list shows unread/read state | Code trace | Pass |
| Opening detail marks announcement as read | Code trace | Pass |
| Comments can be created, edited, deleted by author | Code trace | Pass |
| Admin read-status panel shows per-user read counts | Code trace | Pass |
| Storage orphan cleanup available to platform admins | Code trace | Pass |
| Popup is scoped to announcement target roles | Code trace | Pass |

---

## 7. Notifications

| Test case | Method | Status |
|---|---|---|
| `notifications` table exists in remote DB | DB verified | Pass |
| Notification created when order status changes to `ordered` | Code trace | Pass |
| Self-notification suppressed (processor = requester) | Code trace | Pass |
| Dedupe key prevents duplicate notifications per order | Code trace | Pass |
| Mobile `/mobile/notifications` lists notifications | Code trace | Pass |
| Tapping notification marks it read | Code trace | Pass |
| "Mark all read" works | Code trace | Pass |
| `schemaUnavailable` fallback shows info card (not crash) | Code trace | Pass |
| Notification routes to order detail on tap | Code trace | Pass |

---

## 8. Admin Export (Excel / PDF)

> **Superseded (2026-07-14):** the original `/api/admin/export/[resource]` CSV route (and every
> `/api/admin/export/*` endpoint — `reservations`, `cleaning`, `maintenance`, `lost-found`, `orders`)
> was **deleted**. All admin-web exports now go through canonical server actions
> (`exportCleaningHistoryWorkbook/Report`, `exportLostFoundWorkbook/Report`,
> `exportOrdersWorkbook/Report`, `exportLeaveLedgerWorkbook/Report`,
> `exportLeaveBalanceWorkbook/Report`, `exportAttendanceWagesWorkbook/Report`, plus the pre-existing
> attendance payroll/transport export actions) that render through the shared
> `src/lib/admin-table-workbook.ts` (Excel) / `src/lib/admin-table-report.ts` (PDF/print HTML) builders.
> The reservation calendar export is a separate path — it opens `/admin/calendar/print` for
> browser print/save-as-PDF (2026-07-10), not a workbook download. The table below replaces the old
> CSV-route checklist.
>
> **수리·점검은 내보내기가 아예 없다 (2026-07-14 확정).** `exportMaintenanceWorkbook/Report`도
> 함께 삭제됐다 — 아래 표에서 수리·점검은 검증 대상이 아니다.

| Test case | Method | Status |
|---|---|---|
| Every admin export action calls `requireAdminSession()` (or the page-level equivalent) before querying | Code trace | Pass |
| Export actions re-query rows server-side from the current filter values only — client never transmits row data | Code trace | Pass |
| Excel output uses the shared green-ledger template (title row → header row → numbered data rows → total row → org/generated-at footer) | Code trace | Pass |
| PDF output is an A4-landscape-style print HTML using the same shared template as Excel | Code trace | Pass |
| Export language is resolved server-side from `session.user.preferredLanguage` — client never passes a locale | Code trace | Pass |
| Date range filters are applied in export output where the surface has a date filter (cleaning history, lost-found, orders) | Code trace | Pass |
| Status filter is applied in export output where the surface has a status filter | Code trace | Pass |
| Empty result set returns a distinct "no rows" result instead of an empty file | Code trace | Pass |
| Leave 이력/잔여 and 근태 수당 exports are approver/`attendance_payroll_admin`-gated (not open to all admin-web roles) | Code trace | Pass |
| Actual file downloads / print dialog opens in browser | Browser E2E | Not tested |

---

## 9. Profile and Directory

| Test case | Method | Status |
|---|---|---|
| `/account` loads with current profile data | Browser E2E | Not tested |
| Name, phone, and language can be updated (no theme control — light-mode-only) | Browser E2E | Not tested |
| `/mobile/directory` shows org members sorted by role | Code trace | Pass |
| Phone call shortcut opens native dialer | Browser E2E | Not tested |
| `/admin/users` list shows members with search/filter | Code trace | Pass |
| `/admin/users/[id]` shows member profile and email | Code trace | Pass |
| Admin can update role and status from detail page | Code trace | Pass |
| Non-super-admin cannot view members of another org | Code trace | Pass |

---

## 10. Cross-Cutting

| Test case | Method | Status |
|---|---|---|
| All mobile pages use shared `MobileShell` | Code trace | Pass |
| All admin pages use shared `AdminShell` | Code trace | Pass |
| ko / ja / en language switching works | Code trace | Pass |
| No hardcoded Korean strings visible to ja/en users | Code trace | Pass |
| No raw DB enum values visible in UI | Code trace | Pass |
| Light-mode-only (no dark-mode styling/state); dark mode deferred post-launch | Code trace | Pass |
| PWA installable on iOS Safari / Android Chrome | Browser E2E | Not tested |
| Organization isolation: user cannot see another org's data | Code trace (RLS) | Pass |
| Part-time staff cannot access admin web | Code trace | Pass |
| Unauthenticated access to all protected routes redirects | Code trace | Pass |

---

## 11. Known Issues and Open Risks

### Medium

| ID | Description | Workaround |
|---|---|---|
| R-01 | Calendar empty count shows "provisional" amber warning until room master is populated via inventory backfill | Run `scripts/dev/beds24-backfill-room-master.sh` before first operational use |
| R-02 | Browser E2E (actual server action mutations) not verified; all server action checks are code-trace only | Perform manual golden-path pass before first staff use |
| R-03 | Beds24 webhook may miss events if webhook delivery fails; calendar won't update automatically | Run `POST /api/dev/beds24/backfill-reservations` as a recovery path if reservations look stale |

### Low

| ID | Description | Notes |
|---|---|---|
| ~~R-04~~ | ~~Admin orders page links to mobile order detail (mobile layout on desktop)~~ | Resolved 2026-06-04: `/admin/orders/[id]` added |
| ~~R-05~~ | ~~No hard-delete confirmation UX for lost-found / maintenance records~~ | Resolved 2026-06-04: `DeleteConfirmButton` added to admin detail pages (component removed 2026-11-25; the detail pages were replaced by console panels) |
| ~~R-06~~ | ~~Google OAuth not implemented; login screen has disabled placeholder~~ | Resolved 2026-06-04: `signInWithGoogle` server action live; Supabase dashboard provider setup required for production |
| R-07 | Map tab shows building cards with Google Maps deeplink, no embedded map | Sufficient for operational use |
| R-08 | `<img>` used for client-side blob URL previews in order items (not Next.js Image) | Intentional; Next.js Image does not support blob URLs |

### Not Tested (requires real browser or external service)

- Actual server action execution (all create/update mutations)
- PWA install flow on iOS Safari and Android Chrome
- Push notification delivery (not yet implemented; in-app only)
- Multi-language rendering in production environment
- Real Beds24 webhook delivery end-to-end with live reservation changes

---

## 12. Release Recommendation

**Status: Conditionally approved for limited internal rollout**

No critical code-level blockers remain as of 2026-06-03. The build passes, all DB migrations are applied, and the majority of the security, routing, and business logic has been verified by code trace. However, server action mutations and device-specific behavior have not been confirmed through browser E2E testing.

Controlled internal rollout may begin once the two required steps below are completed. Phase 13 remains open until browser E2E is confirmed.

### What has been verified

- TypeScript build passes with 0 errors and 0 lint warnings.
- All remote DB migrations are applied and confirmed against local history.
- Auth routing, access control, RLS scope, and permission guards verified by code trace.
- Business logic for cleaning, requests, orders, announcements, notifications, and exports verified by code trace.
- Auth/onboarding hardening slice verified by Vitest unit tests (64 tests total, `npm test`): safe redirect sanitization, invite RPC error mapping, `isLocale` language validation, and the CJK hardcoded-string guard (`no-hardcoded-i18n`, including unit tests for its own directive parser).
- i18n coverage for ko/ja/en confirmed across all production-visible surfaces.

### What has not been verified

- Actual form submission and server action mutations (create, update, status change); requires a browser session.
- Image upload end-to-end (client compression, Storage write, detail display).
- PWA install flow on iOS Safari and Android Chrome.
- Real Beds24 webhook delivery with a live booking change.
- Multi-language rendering in the production Vercel environment.

### Required before first staff use

1. Run `scripts/dev/beds24-backfill-room-master.sh` to populate room master and switch calendar empty count from provisional to authoritative.
2. Perform a manual browser golden-path pass covering: login, cleaning start/complete, order request creation, admin order approval and processing, and notification receipt.
3. Create invite codes at `/admin/users/invites` for the first staff batch.

### Recommended actions after rollout

- Monitor Supabase logs for server action errors in the first week.
- Confirm Beds24 webhook events are arriving by checking `/admin/calendar` after a real booking change.
- Collect field staff feedback on cleaning workflow and mobile navigation.
- Verify Google OAuth provider is enabled in Supabase dashboard (Authentication → Providers → Google) before production use; client ID and client secret from Google Cloud Console required.
