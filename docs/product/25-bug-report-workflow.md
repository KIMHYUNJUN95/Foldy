# Bug Report / Problem Report Workflow

> 2026-06-29 dashboard note:
> reviewer handling is no longer being planned as mobile-only forever.
> The dashboard rebuild includes a bug-report admin surface; treat `docs/product/05-admin-web-ia.md`
> as the current admin direction while the detailed reviewer rules here are refined during implementation.

Status: 1차 구현 (2026-06-25)

Design note:

- 디자인 1차 구현 완료, 모바일 3개 화면 (목록/작성/상세).
- 수정 페이지 (`/mobile/bugs/[id]/edit`) 는 1차 deferred — 상세 페이지의 "수정" 버튼 1차 숨김.

## Purpose

The Bug Report / Problem Report workflow is for reporting issues found while using **Foldy itself**.

This module is for:

- app bugs
- broken flows
- wrong data shown in the UI
- permission/access problems
- notification mistakes
- severe slowness or repeated failure in one screen

This module is **not** for:

- property/facility issues inside a building
- cleaning quality issues in one room
- supply ordering
- general staff suggestions or opinions

Separation:

- `Maintenance` = real-world property/facility issue
- `Staff Suggestions` = structured internal feedback to a person
- `Bug Report` = Foldy product/system issue

Confirmed scope note:

- this module is specifically for **Foldy app bugs and product issues**
- it is not a general "problem report" bucket for field operations

## Core Product Direction

The first slice is intentionally simple:

- any active member can report a product problem quickly
- the reporter can track the current status of their own report
- office/admin reviewers can triage and close the report
- the workflow should behave like a lightweight internal ticket, not a full helpdesk
- the create form asks only for the minimum information needed

## First-Slice Goal

Delivered in 1차 구현:

- all active members including `part_time_staff` can submit a bug report
- the report is private to the reporter and designated reviewers
- reviewers can change status from the detail screen via a status BottomSheet
- the reporter receives status-change visibility without needing a comment thread
- the create form contains only `title`, `description`, and optional `photos`
- empty state shown when the list is empty
- after creating a report the user is redirected to `/mobile/bugs`

### 1차 deferred

- edit page `/mobile/bugs/[id]/edit` — design not finalized; "수정" button hidden on detail screen in first slice
- admin web reviewer page (`/admin/bug-reports`) — reviewers handle all triage via mobile
- `cs_staff` / `developer_super_admin` as reviewers — open question, deferred
- threaded comments
- categories
- severity
- SLA / assignee workflow

## Routes

### Mobile (1차 구현)

```txt
/mobile/bugs          -- list (mine / all-org for reviewers)
/mobile/bugs/new      -- create form
/mobile/bugs/[id]     -- detail + reviewer status change BottomSheet
```

Note: the route is `/mobile/bugs`, **not** `/mobile/bug-reports` (changed per design decision 2026-06-25).

### 1차 deferred routes

```txt
/mobile/bugs/[id]/edit   -- edit page (design not finalized; 1차 deferred)
/admin/bug-reports        -- admin web reviewer page (1차 deferred)
```

## Users

### Reporter

- any active organization member
- `part_time_staff` included

Can:

- create a report
- read their own reports
- delete their own report only while status is `submitted`

Cannot:

- read other users' reports
- change status after submit
- edit their report (edit button hidden in 1차; available only while `submitted` when the edit page ships)

### Reviewers (1차 확정)

First-slice reviewers:

- `owner`
- `office_admin`

Can:

- read all reports in the organization
- change status (via BottomSheet on the detail screen)

Open question (deferred):

- should `cs_staff` or `developer_super_admin` also be included as org-level reviewers?

## Visibility Model

Readable by:

- report author
- organization reviewers (`owner`, `office_admin`)

Not readable by:

- other ordinary members in the organization

Important rule:

- this is a **private operational issue log**, not a team board

## Core Flow

```txt
Member finds a Foldy problem
-> submits a bug report (/mobile/bugs/new)
-> redirected to /mobile/bugs list
-> reviewer checks and triages via detail screen
-> reviewer taps status row → status BottomSheet → selects new status
-> reporter checks the result (status visible on detail)
```

## Entry Points

- mobile side-menu **footer**, next to Logout → "버그 신고" (`/mobile/bugs`). It is intentionally not in the side-menu nav list nor the pinnable bottom-bar pool — it is a low-frequency utility. See `docs/product/16-mobile-navigation.md` → Side menu → Footer.
- optional: account/help entry (deferred)

## Main Fields

```txt
id                    uuid primary key
organization_id       uuid not null references organizations(id)
reported_by_user_id   uuid not null references profiles(id)
title                 text not null
description           text not null
image_urls            text[] not null default '{}'  -- max 5
status                text not null default 'submitted'
reviewed_by_user_id   uuid references profiles(id)
closed_by_user_id     uuid references profiles(id)
closed_at             timestamptz
created_at            timestamptz not null
updated_at            timestamptz not null
```

## Creation Fields

### Title

Required.

Short summary of the issue.

Examples:

- "출근 QR 스캔 후 로딩이 끝나지 않음"
- "알림 벨 unread 숫자가 줄지 않음"

### Description

Required.

Free-text explanation of what happened.

### Screenshots / Photos

Optional but strongly recommended.

Limit:

- maximum 5 images

Implementation:

- reuses the shared `request-images` bucket upload/compression policy
- path: `{organization_id}/bug-reports/{report_id}/{filename}`
- **Save order (fixed 2026-10-26):** ① `createBugReportAction` (title · description only, the server makes the id) →
  ② each photo is compressed and uploaded with `uploadBugReportImageAction(reportId)` → ③ the returned URLs are attached
  with `updateBugReportAction`. Until then step ③ was missing — the uploaded URLs were thrown away, `image_urls` stayed
  empty and failures were silent. If some photos fail, the report is still sent: a `warning` haptic plus
  `bugs.photosPartialFailed` 「신고는 보냈지만 사진 n장을 올리지 못했어요」 shows for a moment before returning to the list.
- **Upload gate (2026-10-26):** `uploadBugReportImage` now loads the report and requires the caller to be its reporter
  and the report to be `submitted` (platform developer bypass — same rule as edit/delete), and refuses once the report's
  storage folder already holds 5 files (`too_many_photos`). Before, only the id *shape* was checked, so anyone in the
  org could write into another report's folder.
- **URL check (2026-10-26):** create/update accept only our Storage `request-images` URLs directly under
  `{org}/bug-reports/{that report id}/` (shared `isOwnStoragePublicUrl()`, `src/lib/storage-url-guard.ts`) —
  `invalid_image` otherwise.

## Reviewer Actions

Reviewer-side (1차 구현):

- read all reports in the organization (list shows all when viewer is reviewer)
- change status via BottomSheet on the detail screen (status row tap)

Deferred:

- reviewer comments
- internal threaded discussion
- structured triage note fields

## Statuses

```txt
submitted   -- newly reported and not yet triaged
reviewing   -- reviewer is checking or reproducing it
fixed       -- issue is considered resolved
closed      -- duplicate / invalid / cannot reproduce / obsolete
```

Status rules:

- new report always starts as `submitted`
- only reviewers can change status
- reporter cannot reopen or reassign in the first slice
- author can hard-delete only while `submitted`

## Notifications

### New Report

When a new bug report is created:

- type: `bug_report_activity`
- event: `created`
- recipients: designated reviewers (`owner`, `office_admin`) in the same org
- suppresses self-notification

### Status Changed

When a reviewer changes status:

- type: `bug_report_activity`
- event: `status_changed`
- recipient: original reporter (actor suppressed)

Deferred:

- push notifications
- comment/reply notifications
- assignee notifications

## Mobile Surface

1차 구현 screens:

- `/mobile/bugs` — list (my reports; all-org list for reviewers)
- `/mobile/bugs/new` — create form (title + description + screenshots)
- `/mobile/bugs/[id]` — detail (reviewer status change = inline 4 buttons since the 2026-10-15 white redesign; delete for author while submitted; edit button hidden in 1차)

Empty state:

- shown when list is empty
- title: "아직 신고가 없어요"
- subtitle: "버그를 발견하면 알려주세요"

### 화이트 리디자인 — 모바일 (2026-10-15, 시안 BugList-Phone · Bug-Phone)

흰 바탕 · 상자 없음 · 세로 구분선 없음(`src/components/bugs/bugs-white.css`, 접두어 `bgw-`). 상태는 색 글자만 —
접수 회색 · 검토 중 보라 · 수정 완료 초록 · 종료 옅은 회색.

- **목록** `/mobile/bugs`: 「버그 신고」 · 「내가 보낸 신고 N건」(검토자는 「전체 신고 N건」) · 보라 「+ 신고」 → 줄(굵은 제목 / `BR-xxxx · 10/14`
  — 번호는 고정폭 글꼴, 검토자에겐 신고자 이름도 · 상태 글자 · ›) → 안내 「대표 · 사무직이 확인해요 · 처리되면 알림이 와요」. 예전 열 머리(ID · 제목 · 상태) 없앰.
- **새 신고** `/mobile/bugs/new`: 이제 `MobileShell` 안(예전엔 셸 없이 가짜 머리를 그렸다). 「버그 신고」 · 「앱이 이상할 때 알려주세요」 · 오른쪽
  「내 신고 N」 → 테두리 위에 이름표가 걸친 칸 「어떤 문제인가요?」 · 「자세히」 → 「화면 사진 선택 · n/5」(회색 타일 + 「+」, 압축 · 업로드 순서 그대로)
  → 꽉 찬 「보내기」(누르면 도는 표시 「보내는 중…」 → 초록 체크가 그려지며 「보냈어요」 → 목록으로) → 안내 한 줄.
- **상세** `/mobile/bugs/[id]`: `BR-xxxx · 상태` → 제목 → 「신고자 · 역할 신고 · 날짜 시각」 → 설명 → 화면 사진 2열(누르면 새 탭) →
  검토자만 「상태 바꾸기」 4칸(예전 상태 칩 → 시트 대신, 제안함 상세와 같은 모양) → 작성자 · 접수 상태면 빨간 「삭제」(가운데 확인 창 — 의도된 예외) →
  (신고자) 안내 한 줄. `BugStatusSheet` · `BugStatusBadge` 는 이제 쓰는 곳이 없다.
- 상태 바꾸기(2026-10-26): 서버 결과를 본다 — 실패하면 `error` 진동 + 4칸 아래 빨간 한 줄 `bugs.statusChangeError`
  (예전엔 실패해도 조용히 원래 상태로 돌아갔다).
- **폴드** 가운데 540px 한 줄 · **태블릿 가로** `SplitList` 목록 | 상세 칸(연 줄 옅은 보라). 새 신고 폼은 칸이 아니라 화면 이동.
- 움직임: 줄 · 버튼 누름, 줄 차례로 떠오름, 사진 타일 톡, 보내기 → 체크 그리기. 동작 줄이기면 끔. 문구 `bugs.white.*`(ko/ja/en).


### HIG 다듬기 2차 — 모바일 버그 신고 (2026-10-20, 시안 A2Bug-* · 지금 A2BugNow-* 나란히)

기능 · 배치는 그대로(`bugs-white.css` 끝 블록):
- 「+ 신고」: 꽉 찬 보라 버튼이 제목 위쪽에 붙어 위 줄 아이콘과 너무 가까웠다(사용자 지적) → **제목 묶음 아래쪽에 맞춘 보라 글자 버튼**(15/600 · 누르는 자리 44, 게시판 「+ 글쓰기」 · 제안함 「+ 쓰기」와 같게). 「내가 보낸 신고 n건」 13 → 15.
- 줄 사이 선: 모든 줄 위 → **줄 사이에만**(제목 글자가 왼쪽 끝이라 끝까지). 제목 15 → 16 · 「B-0000 · 날짜」 12 → 13. 안내 12 → 13 · 빈 화면 17/15.
- 상세: 본문 15 → 16 · 「상태 바꾸기」 13 → 15 · 상태 버튼 13 → 15 · 「신고 지우기」 14 → 15 · 확인 창 버튼 46/14 → 50/15.
- 새 신고: 칸 이름 12 → 13 · 「사진 (선택)」 13/700 → 15/600 · 사진 ✕ 보이는 26 · 누르는 자리 44.

## Admin Web Surface

1차 deferred.

Reviewers handle all triage via the mobile list/detail screens.

## Out Of Scope (1차)

- multi-assignee workflow
- threaded internal discussion
- Jira/GitHub sync
- public release-note linkage
- automatic error log ingestion
- app-version/device auto-capture as a hard requirement
- category/severity-based triage UI
- admin web page for reviewers

## Open Questions

- Should reviewer scope be expanded to include `cs_staff` or `developer_super_admin`? (open, deferred)
- Should device/browser/app-version or current route be auto-captured silently in a later slice?
- Should `fixed` and `closed` both stay visible to the reporter forever, or should older closed items auto-archive later?
