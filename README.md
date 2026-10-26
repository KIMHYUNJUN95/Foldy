# Foldy

Foldy is a multilingual hotel and accommodation operations platform for field staff and office/admin staff.

The project starts as an internal company operations app and may later become a public product for other accommodation operators.

## Current Status

Stage:

```txt
Internal rollout ready — Phase 13 QA in progress
```

Core operations modules are substantially implemented. Auth/onboarding, cleaning, requests, announcements,
notifications, reservations (Beds24 webhook), Todoist/tasks, projects, linen returns, suggestions, board,
attendance/payroll, annual leave, complaints/reviews, exports, profile/directory, and the admin console are live.
The linked Supabase migration state must be verified against the target project before deployment; local
migration files alone do not prove that a remote environment is current. See
`docs/planning/06-current-status.md` for the detailed implementation log.

## Development

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm run dev
```

Open:

```txt
http://127.0.0.1:3000
```

Validate the app:

```bash
npm run lint
npm run build
```

## Local Supabase Setup

Create or update `.env.local` with values from the Supabase dashboard:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://sspdgzkytkpmquqsfaup.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Keep the service role key server-only and never paste it into chat or documentation.

## Product Scope

Foldy supports:

- Mobile PWA for field staff and part-time staff
- Admin web app for office/admin users
- Hotel-style buildings
- Airbnb-style standalone properties
- Korean, Japanese, and English
- Light mode only (dark mode is intentionally deferred)
- Warm-ivory operational UI, deep navy accent, and selective Apple-inspired Liquid Glass surfaces

Core MVP modules:

- Auth and invite flow
- Organization/workspace
- User profile and directory
- Reservation calendar with Beds24 webhook data
- Cleaning timer and cleaning records
- Maintenance requests
- Lost and found
- Order/supply requests
- Announcements
- Notifications
- Recurring work scheduler
- Cleaning record export

Future modules:

- Full inventory management
- Native iOS/Android app with Expo
- Public signup and billing

## Confirmed MVP Tech Stack

```txt
Next.js App Router
TypeScript
PWA-first
Tailwind CSS v4
shadcn/ui + Radix UI
Lucide Icons
Supabase Auth
Supabase PostgreSQL
Supabase Storage
Supabase RLS
Vercel
Web Push + in-app notification center
Beds24 Webhook
React Hook Form
Zod
TanStack Query
TanStack Table
ExcelJS
Localized print-ready HTML reports with browser Print / Save as PDF
```

## Deployment Direction

Initial:

```txt
Vercel free/low-cost deployment
*.vercel.app domain
PWA internal use
```

Later:

```txt
Company domain
Apple Developer account
Google Play Console account
React Native / Expo native app if needed
App Store / Google Play release
```

## Documentation Is Source of Truth

All planning, design, technical, and workflow decisions must be reflected in Markdown files.

If code changes behavior, permissions, UI flow, data structure, or technical direction, update the related docs in the same work cycle.

Important:

```txt
No major feature should exist only in code.
```

## Start Reading Here

Read these first:

- [Documentation Index](./docs/INDEX.md)
- [Project Brief](./docs/planning/00-project-brief.md)
- [Decision Log](./docs/planning/01-decision-log.md)
- [Project Workflow](./docs/planning/04-project-workflow.md)
- [AI Collaboration Rules](./docs/planning/05-ai-collaboration-rules.md)
- [Environment Setup](./docs/engineering/07-environment-setup.md)

## Product Docs

- [Product Requirements](./docs/product/00-product-requirements.md)
- [User Roles](./docs/product/01-user-roles.md)
- [Feature Map](./docs/product/02-feature-map.md)
- [Multilingual Strategy](./docs/product/03-multilingual-strategy.md)
- [Organization and Invitations](./docs/product/04-organization-invitations.md)
- [Admin Web IA](./docs/product/05-admin-web-ia.md)
- [Property and Room Model](./docs/product/06-property-room-model.md)
- [Cleaning Workflow](./docs/product/07-cleaning-workflow.md)
- [Maintenance Workflow](./docs/product/08-maintenance-workflow.md)
- [Lost and Found Workflow](./docs/product/09-lost-found-workflow.md)
- [Order Request Workflow](./docs/product/10-order-request-workflow.md)
- [Announcement Workflow](./docs/product/11-announcement-workflow.md)
- [Recurring Work Scheduler](./docs/product/12-recurring-work-scheduler.md)
- [Inventory Future Module](./docs/product/13-inventory-future-module.md)
- [Notification Design](./docs/product/14-notification-design.md)
- [Reservation Calendar](./docs/product/15-reservation-calendar.md)
- [Mobile Navigation](./docs/product/16-mobile-navigation.md)
- [User Profile and Directory](./docs/product/17-user-profile-directory.md)
- [Todo / Task Workflow](./docs/product/18-todo-task-workflow.md)
- [Linen Defect Workflow](./docs/product/19-linen-defect-workflow.md)
- [Attendance / Payroll Workflow](./docs/product/21-attendance-payroll-workflow.md)
- [Staff Suggestions Workflow](./docs/product/22-staff-suggestions-workflow.md)
- [Board Workflow](./docs/product/23-board-workflow.md)
- [Project Workflow](./docs/product/23-project-workflow.md)
- [Attendance Mobile Workflow](./docs/product/24-attendance-workflow.md)
- [Bug Report Workflow](./docs/product/25-bug-report-workflow.md)
- [Complaint / External Review Workflow](./docs/product/25-complaint-workflow.md)
- [Annual Leave Workflow](./docs/product/26-annual-leave-workflow.md)
- [Permission Override Workflow](./docs/product/27-permission-override-workflow.md)
- [Admin Todoist Console](./docs/product/28-admin-todoist-console.md)
- [Expense Receipt Workflow](./docs/product/29-expense-receipt-workflow.md)

## Design Docs

- [Design Direction](./docs/design/00-design-direction.md)

## Engineering Docs

- [Beds24 Integration](./docs/engineering/01-beds24-integration.md)
- [Platform Architecture](./docs/engineering/02-platform-architecture.md)
- [Deployment Strategy](./docs/engineering/03-deployment-strategy.md)
- [Data Model](./docs/engineering/04-data-model.md)
- [RLS Permissions](./docs/engineering/05-rls-permissions.md)
- [Environment Setup](./docs/engineering/07-environment-setup.md)
- [Linen Defect Technical Design](./docs/engineering/08-linen-defect-technical-design.md)
- [Todo / Task Technical Design](./docs/engineering/09-todo-task-technical-design.md)
- [Attendance / Payroll Technical Design](./docs/engineering/11-attendance-payroll-technical-design.md)
- [Staff Suggestions Technical Design](./docs/engineering/12-staff-suggestions-technical-design.md)
- [Bug Report Technical Design](./docs/engineering/13-bug-report-technical-design.md)

## Archive

지난 계획 · 끝난 이식 기록은 [docs/archive](./docs/archive/)에 둔다(2026-10-26). 지금 기준은 아니다.

## Work Process

Use this workflow:

```txt
Plan
Design
Document
Implement
Test
Review
Update docs
Repeat
```

For each feature:

```txt
1. Confirm requirements
2. Update docs
3. Design in Claude Design if UI-heavy
4. Implement small vertical slice
5. Test mobile/admin, light mode, ko/ja/en
6. Update docs if implementation differs
```

## AI Collaboration

Codex, Claude, Cursor, and other AI tools must:

- Read relevant docs before making changes
- Follow confirmed decisions
- Update docs when behavior changes
- Not silently change tech stack, permissions, deletion behavior, i18n strategy, or PWA-first direction

## Next Practical Steps

1. Create `.env.local` from `.env.example` and add only the secrets required for the target environment.
2. Compare local and remote migration history, then apply every pending migration in order.
3. Sign in at `/auth/login`; use `/onboarding` only when the account still needs profile or membership setup.
4. Run the release/physical-device checks in `docs/planning/13-qa-checklist.md` before operational rollout.
