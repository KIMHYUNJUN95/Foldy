# Documentation Index

## Purpose

This index helps humans and AI assistants understand the Foldy documentation structure.

Status labels:

```txt
Confirmed: Decision is currently accepted.
Draft: Direction exists but needs more review before implementation.
Future: Documented for later, not MVP.
Living: Must be updated continuously.
Historical: Retained for decision history but superseded by a newer document or the current implementation.
```

## Start Here

| Document | Status | Purpose |
|---|---:|---|
| [README](../README.md) | Living | Project entry point |
| [Project Brief](./planning/00-project-brief.md) | Living | Product summary and context |
| [Decision Log](./planning/01-decision-log.md) | Living | Confirmed decisions |
| [Project Workflow](./planning/04-project-workflow.md) | Confirmed | How the project is run |
| [AI Collaboration Rules](./planning/05-ai-collaboration-rules.md) | Confirmed | Rules for Codex/Claude/Cursor/other AI |

## Planning Docs

| Document | Status | Purpose |
|---|---:|---|
| [Project Brief](./planning/00-project-brief.md) | Living | Project identity and context |
| [Decision Log](./planning/01-decision-log.md) | Living | Source of confirmed decisions |
| [Project Workflow](./planning/04-project-workflow.md) | Confirmed | Work process |
| [AI Collaboration Rules](./planning/05-ai-collaboration-rules.md) | Confirmed | Shared AI rules |
| [Current Status](./planning/06-current-status.md) | Living | Completed/in-progress/remaining tracker |
| [QA Checklist Announcement Images](./planning/07-qa-checklist-announcement-images.md) | Living | Historical QA checklist for announcement-image rollout |
| [QA Checklist](./planning/13-qa-checklist.md) | Living | Full system QA and release-readiness checklist |
| [Rollout Guide](./planning/14-rollout-guide.md) | Living | Internal rollout sequence and operational checks |
| [Admin Dashboard Workflow](./planning/16-admin-dashboard-workflow.md) | Living | Active workflow board for dashboard planning and implementation |

## Product Docs

| Document | Status | Purpose |
|---|---:|---|
| [Product Requirements](./product/00-product-requirements.md) | Living | Overall product requirements |
| [User Roles](./product/01-user-roles.md) | Confirmed | Role definitions |
| [Feature Map](./product/02-feature-map.md) | Living | Product module map |
| [Multilingual Strategy](./product/03-multilingual-strategy.md) | Confirmed | Korean/Japanese/English rules |
| [Organization and Invitations](./product/04-organization-invitations.md) | Confirmed | Org, membership, invite flow |
| [Admin Dashboard IA](./product/05-admin-web-ia.md) | Living | Admin dashboard principles, IA, and module priorities |
| [Property and Room Model](./product/06-property-room-model.md) | Confirmed | Property/room structure |
| [Cleaning Workflow](./product/07-cleaning-workflow.md) | Confirmed | Cleaning timer and records |
| [Maintenance Workflow](./product/08-maintenance-workflow.md) | Confirmed | Maintenance request workflow |
| [Lost and Found Workflow](./product/09-lost-found-workflow.md) | Confirmed | Lost item lifecycle |
| [Order Request Workflow](./product/10-order-request-workflow.md) | Confirmed | Order/supply request workflow |
| [Announcement Workflow](./product/11-announcement-workflow.md) | Confirmed | Announcements and comments |
| [Recurring Work Scheduler](./product/12-recurring-work-scheduler.md) | Confirmed | Periodic work management |
| [Inventory Future Module](./product/13-inventory-future-module.md) | Future | Inventory later |
| [Notification Design](./product/14-notification-design.md) | Living | Implemented and planned notification triggers |
| [Reservation Calendar](./product/15-reservation-calendar.md) | Confirmed | Beds24 calendar requirements |
| [Mobile Navigation](./product/16-mobile-navigation.md) | Confirmed | Mobile tabs and home layout |
| [User Profile and Directory](./product/17-user-profile-directory.md) | Confirmed | Profile and user directory |
| [Todo / Task Workflow](./product/18-todo-task-workflow.md) | Living | Implemented CS follow-up and operational task memory |
| [Linen Defect Workflow](./product/19-linen-defect-workflow.md) | Living | Implemented property-scoped linen defect workflow |
| [Attendance / Payroll Workflow](./product/21-attendance-payroll-workflow.md) | Living | Implemented PWA attendance and hourly gross-pay operations |
| [Staff Suggestions Workflow](./product/22-staff-suggestions-workflow.md) | Living | Implemented staff suggestion and feedback workflow |
| [Board Workflow](./product/23-board-workflow.md) | Living | Implemented free internal board for active members |
| [Project Workflow](./product/23-project-workflow.md) | Living | Implemented project boards and task coordination |
| [Attendance Workflow](./product/24-attendance-workflow.md) | Living | Implemented attendance mobile UX and screen behavior |
| [Bug Report Workflow](./product/25-bug-report-workflow.md) | Living | Foldy product/system issue reporting workflow (1차 구현 2026-06-25) |
| [Complaint Workflow](./product/25-complaint-workflow.md) | Living | Customer complaint intake and tracking workflow (모바일 1차 구현) |
| [Annual Leave Workflow](./product/26-annual-leave-workflow.md) | Living | Annual-leave request, approval, balance, calendar, document, and export workflow |
| [Permission Override Workflow](./product/27-permission-override-workflow.md) | Living | Time-bound per-user feature permission exceptions |
| [Admin Todoist Console](./product/28-admin-todoist-console.md) | Living | Desktop Todoist/task operations console |
| [Expense Receipt Workflow](./product/29-expense-receipt-workflow.md) | Draft | Transportation-adjacent expense receipt planning |
| [Self Check-in Kiosk](./product/43-self-checkin-kiosk.md) | Draft | Building-tablet self check-in under Shinjuku ryokan rules (planning, decisions pending) |

## Design Docs

| Document | Status | Purpose |
|---|---:|---|
| [Design Direction](./design/00-design-direction.md) | Confirmed | Warm ivory + deep navy + selective Liquid Glass + readability |

## Engineering Docs

| Document | Status | Purpose |
|---|---:|---|
| [Beds24 Integration](./engineering/01-beds24-integration.md) | Living | Implemented webhook and reconciliation integration |
| [Platform Architecture](./engineering/02-platform-architecture.md) | Confirmed | PWA/admin/backend architecture |
| [Deployment Strategy](./engineering/03-deployment-strategy.md) | Confirmed | Vercel/PWA/internal deployment |
| [Data Model](./engineering/04-data-model.md) | Living | Implemented Supabase/PostgreSQL schema contract |
| [RLS Permissions](./engineering/05-rls-permissions.md) | Living | Implemented RLS and server-side permission contract |
| [Environment Setup](./engineering/07-environment-setup.md) | Living | Environment variables and service setup |
| [Linen Defect Technical Design](./engineering/08-linen-defect-technical-design.md) | Living | Implemented linen schema, RLS, and action design |
| [Todo / Task Technical Design](./engineering/09-todo-task-technical-design.md) | Living | Implemented task, sharing, recurrence, and calendar design |
| [Attendance / Payroll Technical Design](./engineering/11-attendance-payroll-technical-design.md) | Living | Implemented attendance and hourly gross-pay technical design |
| [Staff Suggestions Technical Design](./engineering/12-staff-suggestions-technical-design.md) | Living | Implemented visibility-aware suggestion technical design |
| [Bug Report Technical Design](./engineering/13-bug-report-technical-design.md) | Living | Implemented bug-report schema, RLS, actions, and notification design |

## Archive

지금 기준이 아닌 지난 계획 · 끝난 작업 기록(2026-10-26 옮김). 참고만 한다.

| Document | Purpose |
|---|---|
| [Technical Options](./archive/00-technical-options.md) | 초기 기술 스택 비교 |
| [Implementation Plan](./archive/06-implementation-plan.md) | 초기 MVP 단계별 개발 순서 · 이력 |
| [MVP Priority](./archive/03-mvp-priority.md) | 초기 모바일 우선순위 |
| [Feature Batch Plan](./archive/15-feature-batch-plan.md) | 2026-06 기능 묶음 계획(구현 완료) |
| [STAY ARI Migration Overview](./archive/31-stay-ari-migration-overview.md) | 판매 캘린더 · 자동화 이식 기록(2026-10-23 끝) |

## Current Delivery Checklist

- [x] Core mobile and admin surfaces implemented
- [x] Data model and feature-specific RLS documented
- [x] Supabase project direction confirmed
- [x] Environment variable names documented
- [x] i18n key strategy and hardcoded-string guard established
- [x] Light-mode-only warm-ivory theme contract established
- [ ] Complete physical-device/browser E2E and rollout checks tracked in `planning/13-qa-checklist.md`
- [ ] Verify migration history and required secrets separately for each deployment environment

## Open Decisions To Resolve Soon

- Expense receipt export template and OCR rollout details (`product/29-expense-receipt-workflow.md`)
- Remaining physical-device QA and production rollout checks (`planning/13-qa-checklist.md`)
- Any future dark-mode or native-app direction requires a new explicit decision

## Maintenance Rule

When a document changes status or a new document is added, update this index.
