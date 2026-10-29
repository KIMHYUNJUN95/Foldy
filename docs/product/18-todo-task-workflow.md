# Todoist / Task Workflow

## 화이트 리디자인 — 모바일 (2026-10-15)

승인 시안: `Todo-Phone` · `TodoAdd-Phone` · `TodoDetail-Phone` · `TodoDone-Phone` · `TodoCal-Phone` · `TodoDir-Phone` ·
`TodoProj-Phone` + 각 `-Fold` · `-Tablet`. 대상: `/mobile/tasks`(7개 보기) · `/mobile/tasks/[id]` · `/[id]/edit` · `/new` ·
`/projects/[projectId]`. 스타일 `src/components/tasks/tasks-white.css`(접두사 `tkw-`), 문구 `dictionary.tasks.mobileWhite`
(ko/ja/en, **함수 값 없음** — `{n}` 자리 + `.replace()`). 서버 액션 · `src/lib/tasks*` · 권한은 바꾸지 않았다.

**공통 시각** — 흰 바탕 · 상자/카드 없음 · 가로 줄(#f3f3f6)만 · 세로선 없음(태블릿 2분할의 목록 | 칸 사이 줄도 뺐다) ·
고른 줄은 옅은 보라(#f4f1fd) 바탕만(왼쪽 막대 없음). 보라 #7a52e6(글자 #5a30cf) · 빨강 #c5282e · 회색 #6b6878 · 먹색 #16141f.

**보기 탭** — 칩 → 글자 탭(가로로 넘어감, 순서 · 라우팅 그대로: 오늘 · 내일 · 관리함 · 프로젝트 · 지시 · 완료 · 캘린더).
고른 탭은 굵은 먹색, 숫자는 보라. 숫자는 시안대로 **오늘 · 내일 · 지시에만**(관리함 · 완료 숫자는 뺐다). 고른 탭이 띠 밖이면
띠만 옆으로 밀어 보이게 한다. 선택 모드에서는 탭 자리를 「✕ · n개 선택 · 전체 선택」 줄이 대신한다(아래 고정 삭제 버튼 그대로).

**오늘 / 내일 / 관리함**
- 머리: (오늘만) 진행 링 「완료 / 전체」(전체 = 오늘 줄 수 + 오늘 완료 수, 지연 포함) + 「오늘」 + 「10월 15일 목요일 · 9개 중 2개 완료」,
  오른쪽 44px 돋보기. 내일은 「날짜 · 작업 n개」, 관리함은 안내 문구 · 작업 n개.
- 돋보기 → 검색 칸(제목 · 작성자 · 태그) + 달력 버튼(특정 날짜 / 기간 — 기존 `MiniCalendar`). 필터가 걸린 채 닫으면 「필터 · "검색어" ·
  날짜 · 지우기」 한 줄만 남고 돋보기에 보라 점.
- 섹션 **지연 / 오늘 / 완료**. 지연 머리 오른쪽은 「날짜 다시 정하기」 + 「⋯」(2026-10-19 HIG 다듬기 — 누르는 영역 44px, 지우기를 자주 누르는
  버튼 옆에 두지 않는다). 「⋯」 시트: 일정변경 · 선택 / 선택 해제(지연 일괄 선택 모드, 진입 시 내 지연 전부 선택) · 맨 아래 빨간 「지난 미완료 삭제」 →
  확인 시트(그대로). 공용 일정 피커 · 서버 동작은 바뀌지 않았다. 예전의 지연 안내 카드는 없앴다.
- **「완료」 묶음(신규)** — 오늘(도쿄) 완료 로그의 일반 작업(프로젝트 작업 제외), 최신 먼저. 일회성은 고리를 눌러 되살릴 수 있고(예전
  완료·기록과 같은 규칙), 반복 완료는 정적 표시. 고리를 누르면 행이 낙관적으로 **완료 상태로 바뀌어** 이 묶음으로 내려앉는다
  (`useOptimistic` — 일회성은 status=completed, 반복은 회차 상태 + 완료 로그 한 줄을 낙관적으로 더함). 서버 응답이 오면 실제 값으로.
- 줄(`TaskCard`): 상자 없음. 앞 고리 = 우선순위(긴급 빨강 링 #d8455a + #fdf3f4, 중요 주황 #d98a1f + #fdf6ea, 보통 파랑 #2f6fde,
  없음 회색 #b4b1bf). 제목 15px, 회색 메타 한 줄 — 「긴급 · / 중요 ·」 → 날짜(오늘/내일 목록에서는 생략, 지연 · 관리함은 표시) →
  시간(「09:00 – 10:00」) → 연결(건물 · 객실) → 진행 중(보라) → 「지시 · 보낸 사람」 또는 남이 만든 작업의 작성자 → 「↻ 반복」 →
  태그 → 사진 n장 → 공유 n명 → N일 밀림(빨강). 지연은 메타 전체가 빨강. 완료 = 회색으로 채운 고리 + 흰 체크 + 취소선.
  예전의 날짜 칩 · 깃발 · 「마감」 꼬리말은 없앴다.
- 그대로 둔 동작: 밀어서 내일로/오늘로(반복 · 이미 그 날짜면 안 열림), 손잡이로 순서 바꾸기(필터 · 선택 중 꺼짐), 길게 눌러
  메뉴(편집 · 선택 · 삭제, 반복 회차는 「이 날짜만 건너뛰기 / 전체 삭제」), 선택 모드 일괄 삭제, 실행 취소 토스트(완료 · 삭제 ·
  건너뛰기 — **완료 · 삭제 토스트를 4~5.5초 → 6초**로 맞췄다), `?created=1` 뒤 빠른 추가 칸 비우기 · `?deleted=` 되돌리기.
- 줄 본문은 이제 **상세 주소를 가진 링크**(`/mobile/tasks/{id}?view=…`)다 — 태블릿 2분할이 고른 줄에 보라 바탕을 칠하려면 링크여야
  한다. 길게 누름 · 밀기 · 열린 줄 닫기 뒤의 클릭은 `touchend` 에서 막아 2분할이 칸을 열지 않게 했고, 선택 모드에서는 링크가 아닌
  버튼으로 그린다. 상세는 `view` 로 빵부스러기(「오늘 · 투두이스트」)를 그린다.
- 끝에 「+ 작업 추가」(빠른 추가 시트). 오른쪽 아래 떠 있는 + 버튼은 그대로(보라 원, 토스트가 뜨면 물러남).

**빠른 추가 시트(시안 TodoAdd-Phone)** — 손으로 짠 시트를 공용 `BottomSheet` 로 바꿨다. 「작업 추가」 + 보라 테두리 입력 + 버튼 세 개
한 줄: 「관리함」(회색, 폼 기본 제출 = 엔터) · 「오늘에 추가」(보라) · 「내일에 추가」(옅은 보라 #f4f1fd / #5a30cf). 아래 「추가해도
시트가 열려 있어 이어서 쓸 수 있어요」 + 「자세히 작성 ›」(입력값을 들고 `/new` 로). 닫으면 입력값을 기억했다가 다시 열 때 복원.

**상세(시안 TodoDetail-Phone)** — 빵부스러기 + 연필(수정) · 휴지통(작성자만) → 큰 고리(26px) + 제목 20px → 설명 → **상태 세그먼트
「대기 | 진행 중 | 완료」**(예전 2칸 + 완료 버튼을 한 줄로; 대기/진행 중 = `setTaskProgress`, 완료 = `completeTask`(반복은 그 회차),
완료 상태에서 대기 = `reopenTask`, 진행 중 = 되살린 뒤 `setTaskProgress(true)`, 회차를 모르는 반복은 완료 칸을 막고 안내) → 사진 줄
(64px 칸 · 「+」는 수정 화면으로 · 「사진 n / 5」(프로젝트 작업 20), 누르면 앱 안 사진 보기) → 정보 목록 일정 · 반복 · 우선순위 ·
연결(「예약 보기」 → 예약 캘린더) · 태그 · 함께(얼굴 + 이름, 누르면 참여자 시트: 더 부르기 · 나가기 · 작성자의 내보내기 — 개인
작업은 「공유하기」, 프로젝트 작업은 없음) → 「업데이트 로그」(메모 · 시스템 줄 「완료 · 이름 · 7/29 15:10」) + 둥근 입력(사진 · 보내기).
확인 시트는 모두 공용 `BottomSheet` + 같은 버튼 두 개.

**만들기 · 수정 폼** — 필드는 그대로(제목 · 설명 · 일정 · 공유 대상 + 지시 스위치 · 연결 · 더 보기(우선순위 · 태그 · 사진)), 초안 자동
저장(sessionStorage) 그대로. 이름표(notched) 칸 · 우선순위는 고리 점 칩 · 태그 칩 · 지시는 스위치 줄. 연결 칸(`ContextLinkSection`)도
같은 이름표 칸 한 줄 + 「바꾸기 · 예약 보기」 글자 링크로.

**완료 · 기록(시안 TodoDone-Phone)** — 「완료 · 기록」 + 「이번 주 n개 완료」(월요일 시작, 도쿄) + 돋보기, 글자 필터 전체 · 일반 작업 ·
프로젝트 작업, 날짜 묶음(「오늘 · 10월 15일」 · 「어제 · 10월 14일」 · 「10월 13일 (화)」 + 개수) 오른쪽 「업무일지」(기존 보고서 시트).
줄은 취소선 + 오른쪽 완료 시각(도쿄). 현장 활동은 그날 한 줄로 묶었다 — 회색 네모 「현」 + 「현장 활동 · 청소 완료 3 · 린넨 반품 1」 +
「자동으로 모여요 · 업무일지에 함께 들어가요」.

**캘린더(시안 TodoCal-Phone)** — 「‹ 2026년 10월 ›」(다른 달이면 「오늘」) + 「반복 숨기기」 스위치, 범례 개인(주황) · 공유(보라) ·
긴급·지연(빨강), **월요일 시작** 달력(토 파랑 · 일 빨강), 날짜 아래 점 최대 3개(긴급 또는 지난 날짜의 일회성 = 빨강, 공유 = 보라,
나머지 주황), 고른 날 = 보라 칸. **고른 날의 목록이 달력 바로 아래**(기본 = 오늘; 예전의 하루 시트 · 「이 달 일정」 아젠다는 없앴다).
미래 날짜는 점 미리보기 그대로. 끝에 「+ 이 날짜에 작업 추가」. 선택 모드의 「전체 선택」 대상은 고른 날의 목록.

**지시(시안 TodoDir-Phone)** — 「지시」 + 안내 문구 + 돋보기, 회색 세그먼트 「받은 지시 n | 보낸 지시 n」, 상태 묶음(지연 · 미확인/할 일 ·
진행 중 · 완료) 그대로. 받은 지시 메타는 지시자 이름부터, 보낸 지시는 「나 → 대상(+n)」 · 「오늘까지 / 10/10까지」. 완료 줄은 오른쪽에
완료 날짜. 보낸 지시 끝에 「+ 지시로 보내기」(`/new?directive=1`).

**프로젝트(시안 TodoProj-Phone)** — 목록: 「프로젝트」 + 「프로젝트 n개」, 상자 없는 줄 「# 이름 · 43%」 + 가는 진행 막대 + 얼굴 · 작업 수 ·
멤버 수, 「프로젝트 만들기」 알약 버튼 그대로(만들기 시트는 이름표 칸 · 공유 스위치 · 이름 검색 초대). 프로젝트 화면: 「‹ 프로젝트 목록」 →
「# 이름」 + 더 보기(멤버 관리 · 프로젝트 삭제/나가기 시트) → 「섹션 3 · 작업 7 · 사진 최대 20장」 → 얼굴 + 「멤버 n명」(관리 시트) →
섹션 묶음(주인: 손잡이 · 이름 바꾸기 · 삭제) · 투두와 같은 줄 · 「+ 작업 추가」 → 「+ 섹션 추가」. 「섹션 없음」 묶음은 그 작업이 있거나
섹션이 하나도 없을 때만 보인다.

**프로젝트를 나가거나 빠지면(2026-10-28 확정)** — 그 사람은 그 프로젝트의 할 일을 **하나도 못 본다 — 자기가 쓴 것도.** 할 일은 프로젝트에
남는다. 예외: 직접 초대(공유 · 지시)로 받은 할 일은 계속 보인다. **프로젝트 주인은 프로젝트의 모든 할 일을 고치고 · 완료하고 · 지운다**
(나간 멤버가 쓴 것 포함, 서버 `canEditTaskCore`). 작성자가 프로젝트에 없는 할 일은 「나감」 표시 — 프로젝트 줄 메타 「사토 유이 · 프로젝트에서
나감」, 할 일 상세 「쓴 사람 · 사토 유이 · 프로젝트에서 나감」, 주인이 남의 할 일 상세를 열면 「프로젝트 주인이라 고치고 · 완료하고 · 지울 수 있어요.」.
- **나가기 시트**: 「「{프로젝트}」에서 나갈까요?」 · 「나가면 이 프로젝트의 할 일은 더 볼 수 없어요. 내가 쓴 할 일 {n}개는 프로젝트에 남고,
  {주인} 님이 이어서 관리해요.」(열린 할 일이 없으면 첫 문장만) · 내 열린 할 일 제목 최대 5개 회색 묶음 · 「취소」 | 빨간 「프로젝트 나가기」.
- **멤버 빼기 시트**(주인, 멤버 관리 시트의 ×): 「{이름} 님을 뺄까요?」 · 「{이름} 님은 이 프로젝트를 더 볼 수 없어요. {이름} 님이 쓴 할 일 {n}개는
  프로젝트에 남고, 내가 고치거나 완료할 수 있어요.」 · 「취소」 | 「빼기」(#c4364b). 예전엔 ×를 누르면 바로 빠졌다.
- 수(n)는 서버가 센다 — 그 사람이 쓴 열린(open · in_progress) · 지우지 않은 프로젝트 할 일(`ProjectDetailData.openTasksByAuthor`).

**폴드 · 태블릿** — 폴드(≥ 600)는 셸 칸 안에 같은 내용. 태블릿 가로(≥ 1000): 오늘 · 내일 · 관리함은 목록 | 상세 칸(`split` +
`SplitList`, 고른 줄 #f4f1fd). 완료 · 지시 · 프로젝트 · 캘린더는 **칸이 비어 있으면 목록을 넓게**(최대 720px, 캘린더 920px) 쓰고 칸을
숨긴다 — 캘린더는 달력 | 고른 날 목록(320px)을 옆으로. 줄을 눌러 칸이 열리면 다시 400px 목록 | 칸(CSS `:has(.split-list__frame)`).

**움직임**(모두 `prefers-reduced-motion` 에서 끔) — 줄 차례 등장(30ms 간격) · 고리 누르면 보라로 채워지며 체크가 그려진 뒤(340ms)
완료 · 진행 링 채움(700ms) · 프로젝트 막대 채움 · 밀어서 드러남(열릴 때 햅틱) · 누름 .97~.985 · 시트는 공용 곡선 · 검색 칸 내려옴.
햅틱(`@/lib/haptics`): 완료 success · 되살림/실행 취소 light · 빠른 추가 success · 길게 누름 medium · 삭제 확정 warning. 누르는 요소는
`touch-action: manipulation` + 탭 하이라이트 없음.

### 업무일지 시트 (2026-10-15 추가, 시안 TodoReport-Phone)

- PC 업무일지 창과 같은 구성으로 맞췄다(사용자 요청): 제목 「업무일지」 + 「10월 15일 (목) · 완료 n건 중 m건 포함」 → 포함할 항목(줄 · 체크 그리기) →
  노치 라벨 「본문」 → 안내 한 줄 + 「다시 생성」 → 「Slack으로 보내기 | 전체 복사」 한 줄. Slack 결과는 보라(성공) / 빨강(실패) 한 줄.
- 문구: 제목 「일일 보고서」 → 「업무일지」, 복사 「복사」 → 「전체 복사」(ko/ja/en, PC와 같게). 새 키 `tasks.mobileWhite.reportSub` · `reportBody`.

## 2026-08-06 multilingual context and accessibility copy

Direct-booking context labels and task/project accessibility actions (toggle, previous/next month, more actions, remove participant) are dictionary-backed in Korean, Japanese, and English on both mobile and admin task surfaces.

Status: First slice implemented (2026-06-10), hardened through 2026-06-15. Mobile Todoist/Shared Task is live under
`/mobile/tasks/*` (side-menu entry `tasks`, user-facing label `Todoist`). Seven tabs now present: Today / Tomorrow / Inbox(관리함) / **프로젝트** / **지시(받은/보낸)** / Completed(완료/기록) / Calendar. The 프로젝트 tab is **functional (first slice, 2026-06-15)**: project create/delete, sections (add/rename/delete with their tasks), an Unsectioned area, project-task create + complete/reopen, member invite/remove/leave, a Completed-tab filter (전체/일반/프로젝트), and a `project_shared` notification. Project tasks appear only in the Projects tab (never in Today/Tomorrow/Inbox/지시/Calendar). Requires migration `202606150002_projects.sql`. See `docs/product/23-project-workflow.md` and `docs/engineering/09-todo-task-technical-design.md`.
quick add + detailed create/edit, task detail with unified update log, multi-select sharing, and
author/participant rules are implemented. Recurrence is the **occurrence model (2026-07-30, supersedes
the 2026-06-16 roll-forward model)** — a recurring task is **one live row** with a FIXED anchor; it shows
on **every** scheduled date independently (completion no longer rolls the row forward), per-occurrence
completion lives in `task_occurrence_state`, and overdue occurrences persist (grouped "N일 밀림" with
오늘로 가져오기 / 삭제). See the Recurrence section + `docs/planning/01-decision-log.md`. The calendar header has a
**"반복 숨기기" (Hide recurring) toggle** (2026-07-29) — a session-only client switch (default off, resets on
reload) that hides fixed/standard-recurring occurrences across the whole calendar (month grid, month agenda,
and day sheet) so one-off dated tasks read clearly; it is mirrored 1:1 on the admin console calendar. notifications cover the current slice — shared, update-log activity, **task_completed**, plus
time-based **due-soon** and **overdue** reminders (daily cron). An extra intermediate tab was removed in the 2026-06-12 IA cleanup; manual complete / reopen was re-introduced on 2026-06-13 and now drives the Completed (완료/기록) tab and the free template-based daily report (업무일지, no LLM). See
`docs/engineering/09-todo-task-technical-design.md` for the as-built schema/RLS and `docs/product/
14-notification-design.md` for the notification matrix.

Hardening pass (2026-06-11): task creation is now fail-safe (the task row is rolled back if the
participant insert fails, so no invisible orphan rows); the original author can edit task-level photos
in edit mode; update-log entries support optional photo upload (max 5, `task-update-images` path); the
misleading Sent "new update" dot was removed (see Sent By Me); calendar weekday headers are localized
via the shared `Intl` weekday pattern used elsewhere in the app; participant management (author removes
any participant, anyone removes self) is exposed in task detail with destructive confirmations. Second
hardening cut (same day): re-sharing (`shareTaskWithUsers`) is fail-safe (a failed participant insert
no longer produces false shared state or notifications); update-log photo-upload failures show an
inline localized error instead of failing silently; and removed task-level photos are hard-deleted
from Storage, not just detached from the DB.

## Purpose

The Todo / Task workflow is a mobile-first operational task system for:

- personal reminders
- CS follow-up
- shared team tasks
- date-based planning
- fast capture before later organization

This feature is closer to:

```txt
Todoist-style personal + shared operational task management
```

than to a simple memo list.

Important product direction:

- the center of gravity is still **personal task / personal memo first**
- sharing is a powerful extension, not the default starting point

## Product Position

This module should cover:

- personal task capture
- operational follow-up
- shared work with one common task record
- task calendar
- lightweight recurring task behavior

This module is the canonical task workspace across mobile and admin.

## Naming And Admin Surface

- Mobile user-facing label is `Todoist`.
- Admin sidebar user-facing label is also `Todoist`.
- The current admin route is legacy `/admin/recurring-work` (a "준비 중" placeholder); the dashboard
  console will move to `/admin/tasks` (legacy path redirects). See the planning spec below.
- The old separate "Recurring Work Scheduler" concept is not the active user-facing module anymore; the shared task workspace is the canonical direction.
- **대시보드 Todoist 기획 스펙 (2026-07-24): `docs/product/28-admin-todoist-console.md`.** 대시보드는
  "모바일 코어 기능 그대로 + 업무 지시(Work Directive) 하나"로 심플하게 간다 — 관리자 분석/오버사이트나
  부가기능은 넣지 않는다. 정식 담당자(assignee)는 보류. 디자인은 대표님이 직접 진행.

## Core Product Direction

### 1. Personal First

New tasks start as personal by default.

That means:

- a user can create a fully private task
- it is visible only to the creator at first
- later, the creator can turn it into a shared task by adding people

### 2. Shared Tasks Use One Common Record

Once a task is shared:

- all participants see the same core task information
- all participants stay on the same canonical task
- there are no per-user task copies

This is important because the product should not show different truth to different participants.

### 3. The Original Author Owns Core Content

For a shared task, the original creator remains the only person who can edit the core task content.

Core content includes:

- title
- description
- tags
- scheduled date
- due date
- time
- recurrence
- task-level photos

Participants cannot edit the core content of a shared task.

### 4. Participants Can Collaborate On The Shared Task

Once shared, participants can still:

- add update-log entries
- re-share to more people
- remove themselves

### 5. Shared Tasks Can Go Back To Personal

If all non-author participants are removed:

- the task returns to personal/private state

### 6. If The Original Author Leaves, The Task Is Deleted

Special deletion rule:

- if a normal participant removes themselves, the task disappears only for that person
- if the original author removes themselves, the task is deleted for everyone

## Users

Primary users:

- Owner
- Office Admin
- CS Staff
- Field Manager
- Staff
- Part-time Staff

All active organization users can:

- create personal tasks
- share tasks with any active organization user
- receive shared tasks
- use the calendar/task views

## Relationship To Other Modules

### Reservation Calendar

Task calendar is separate from the Beds24 reservation calendar.

Tasks can optionally link to:

- property/building
- room/unit
- reservation
- guest name

But:

- task items must not become reservation bars
- reservation calendar and task calendar must remain distinct surfaces

#### Context Link — as-built (2026-06-12)

A task can optionally carry an operational **context link** so CS/field notes stay attached to the
building-only, building · room, reservation, or guest context they are about. This is a convenience pointer, not a second
reservation surface — it never creates calendar bars and stays separate from the Beds24 calendar.

Picker flow (four screens, bottom sheet from the create/edit form):

1. **Building** — choose a building. The list shows **only genuinely active buildings**, taken from
   the same active-room catalog the reservation calendar uses (not a raw property list). Each row
   shows its active room count and today's in-stay guest count.
2. **Room + Reservation** — pick a room (occupancy shown), then optionally a reservation in that
   room. Rooms shown are **only active rooms**, and physical sub-units are **merged into one cell**
   (e.g. `201` and `201_2` are the same room → one `201` cell), exactly like the calendar room axis.
   Reservations are the real bookings for that room across the current + next month window (Tokyo).
3. **Building-only / Room-only** — on the room step, the alt actions can link either just the
   building or the building · room without a reservation. This covers building-level notes where a
   room is irrelevant. Because the user already entered this step from a chosen building, the
   building-only action is shown with a slightly more active visual treatment than the neutral
   alternatives.
4. **Guest direct entry** — emergency fallback when Beds24 data is missing/not synced: link by typed
   guest name with no date restriction. Clearly labeled as the missing-data path.

Display:

- A linked task shows a small **context chip** on its list card (building, building · room, or guest
  name) and a full **linked-context block** in task detail (building / room when present, channel
  badge, guest, date range,
  and a "go to reservation" affordance).
- Property and room labels are shown in their **canonical/merged form** (e.g. a booking stored as
  `荒木町A` / `201_2` displays as `아라키초A` / `201`), consistent with the calendar and the picker.
- **Go to reservation** opens the reservation calendar filtered to that building and scrolled to the
  reservation's check-in month, and — when the link points at a specific reservation — **auto-opens
  that reservation's detail sheet** on arrival (via a `reservationId` deep-link param) so the guest
  info is shown immediately, with no extra tap or manual refresh. A building-only or room-only link
  opens the calendar without a sheet; a guest-only emergency link has no building to open, so its
  card is shown without the navigation affordance.

Reservation, building-only, and room-only links are all fully saved and displayed: the building name
always resolves, and the room number appears when a room was linked even with no reservation attached.

Deactivation safety (confirmed rule): the picker only lets you **newly link active rooms**, but an
**existing link is never dropped when its room/reservation later goes inactive** — the note keeps
showing its context. Active-only filtering applies to *creating* a link, not to *displaying* one.

#### Today / Tomorrow tabs, swipe + drag-reorder — as-built (2026-06-12)

There are two day tabs side by side: **Today** (오늘) and **Tomorrow** (내일). The Tomorrow tab is a
full copy of Today's behaviour (same card layout, chips, and drag-reorder), filtered to tasks
anchored to tomorrow (Tokyo).

**Swipe to move between the day tabs.** The card-body left-swipe reveals one action:

- **Today tab → "내일로"** (defer to tomorrow): sets `scheduled_date` = tomorrow (Tokyo), un-inboxes.
- **Tomorrow tab → "오늘로"** (pull to today): sets `scheduled_date` = today (Tokyo), un-inboxes.
- Inbox also swipes **"오늘로"**; Sent / Calendar lists have swipe disabled.
- After the move the server action returns the user to the **same tab** they swiped from (`?view=`),
  so the card simply leaves the list.

**Drag-reorder** (both day tabs):

- **Today + Tomorrow + 관리함(Inbox).** Today's Overdue/Today sections, the Tomorrow list, and the
  Inbox are reorderable (Inbox added 2026-07-30, mirrored on the admin console). In the Inbox,
  unranked tasks fall back to **newest-first** (so a new task still lands on top) rather than priority.
  Sent/Calendar keep automatic ordering.
- **Dedicated drag handle.** Each card shows a small grip handle (≡) on its right edge; dragging
  starts only from the handle. It owns its own pointer gesture and stops propagation, so it never
  triggers the card's **tap** (open), **long-press** (context menu), or **swipe** — no conflict.
- **Persistence.** Order is stored in `tasks.sort_order` (nullable integer). NULL = unranked → falls
  back to **priority order**, so behaviour is unchanged until the user first drags. Dropping assigns
  every card in that section a sequential `sort_order` (0..n). The value is **global to the task, not
  per-user** (MVP limitation): a shared task reordered by one member moves for everyone who sees it.
- **Disabled when ambiguous.** Reorder is off (handles hidden, plain list) while a **search/date
  filter** is active (the list is a subset) or in **multi-select mode** (the card body owns the tap).

### Maintenance / Lost and Found / Orders

Todo can be used for follow-up around these modules.

Examples:

- reminder to check a guest reply
- follow-up after a maintenance request
- room-preparation note before check-in

Todo is not a substitute for the original record in those modules.

### Legacy Separate Scheduler Concept

Again:

- recurring task support here is lightweight and personal/team-task oriented
- any future formal facility routine module must be treated as a new explicit feature, not as this Todoist workspace

## Core Task Model

One task can move across these modes:

```txt
private personal task
-> shared task
-> private again (if participants removed)
```

So this should be modeled as:

- one task record
- one participant set
- one update-log stream

Not as sender/recipient independent copies.

## Main Views

The feature should feel like a structured task workspace, not one flat list.

Required major views:

- Today
- Tomorrow
- Inbox
- 프로젝트
- 지시 (받은 / 보낸)
- Completed (완료/기록)
- Calendar

### Default First View

First view on entry:

- `Today`

### Internal View Order

Recommended order:

```txt
Today
Tomorrow
Inbox
프로젝트
지시 (받은 / 보낸)
Completed (완료/기록)
Calendar
```

### Navigation Pattern

- side-menu entry for the feature
- also available as a bottom-bar customization candidate
- once inside the feature, switch between the main views using internal segmented/tab navigation

## View Definitions

### Today

Purpose:

- show what really needs attention today

Include:

- overdue tasks
- tasks due today
- tasks manually placed into today

Recommended sort:

1. overdue section, then today's section
2. inside each section: manual drag order if present
3. then importance for unranked tasks

### Tomorrow

Purpose:

- show what is already anchored to tomorrow

Include:

- tasks scheduled for tomorrow
- tasks due tomorrow

Recommended sort:

1. manual drag order if present
2. then importance

### Inbox

Purpose:

- active management list for the current user's visible tasks

Meaning:

- quick capture still lands here first
- ongoing active tasks are also managed here
- this is the broadest day-to-day task list in the mobile IA

Rules (Todoist "Inbox = default project" model):

- Inbox(`관리함`) = **every active task that is not in a named project** — dated or not. This is the one place to manage all non-project work. (Mobile `TasksWorkspace` keys the Inbox view off "no project", i.e. `isActive`, not the `is_inbox` flag.)
- **Mobile 「관리함으로 옮기기」 (2026-10-28):** a project task's detail has a 「⋯」 button in the crumb (author only) that opens a sheet row 「관리함으로 옮기기 — 「프로젝트」에서 빠져요 · 날짜 · 반복은 그대로」. No confirm: it drops project + section (date, time, repeat kept) and shows a toast 「관리함으로 옮겼어요」 with 「되돌리기」, which puts the project and section back. Same rule as the PC dashboard.
- **Today / Tomorrow are filters over this same set** — a task dated today appears in Inbox AND in Today (they are not mutually exclusive).
- **Project tasks are excluded** from Inbox/Today/Tomorrow/Sent/Calendar; they live only in the Projects tab.
- shared / received-directive tasks (non-project) also appear in Inbox; a shared Inbox task appears in every participant's Inbox.
- The `is_inbox` column still exists from earlier iterations but **no longer gates this view** (the view is "no project"). Quick-add still stamps it, harmlessly.
- **Dashboard(`/admin/tasks`) uses the identical model (aligned 2026-07-27):** `관리함` = all active non-project tasks, Today/Tomorrow are filters, project tasks only in the project view, "관리함으로 이동" = remove from project (keeps the date). See `docs/product/28-admin-todoist-console.md` §12.

Recommended behavior:

- Inbox is an explicit workflow state
- a task should not unexpectedly leave Inbox just because some fields were filled
- moving in/out of Inbox should be deliberate

Recommended sort:

- newest first

### Sent By Me

Purpose:

- track tasks the current user shared with others
- manage the original task from the sender perspective

Should show:

- the task itself
- whether it is shared
- who it is currently shared with
- whether the task was updated — **deferred (2026-06-11)**: there is no per-user read/seen state yet, so a truthful "new update" indicator is not possible in this slice. The earlier dot was derived only from share presence (not real activity) and has been removed rather than left as a misleading cue. Revisit when a read-state model exists.

Recommended sort:

- latest shared / latest updated first

### Completed (완료/기록) — as-built (2026-06-13)

Purpose:

- review finished work as a dated history

Include:

- completed tasks grouped by **completion day** using the Tokyo date of `completed_at`
  (`tokyoDateOf(completed_at)`), newest day first — so a task scheduled for tomorrow but finished
  today appears under today's group, not its scheduled date.

Tab order is `Today · Tomorrow · Inbox(관리함) · 프로젝트 · 지시 · Completed(완료) · Calendar`.

Rules:

- The tab's **count badge** = today's (Tokyo) completions only.
- Each day-group header carries a **보고서 (Report)** button that opens the daily report for that
  day (see Daily Report below).

### Calendar

Purpose:

- view dated tasks across month and agenda-style views

Required modes:

- month view
- agenda / list by date

Rules:

- show all dated tasks relevant to the current user
- include tasks created by the user
- include shared tasks visible to the user
- visually distinguish shared tasks from personal tasks

Date tap behavior:

- open a bottom sheet / modal for that date's tasks

As-built (2026-06-15):

- **Month navigation** — a compact header with prev/next chevrons moves month-to-month; the month grid
  and agenda both update. On any non-current month a small **Today** button resets to the current month
  and re-selects today; the personal/shared legend shows only on the current month (keeps the header
  light). Tasks load once for the whole workspace, so month navigation is instant and client-side.
- **Month grid** — each day cell shows up to three dots (shared = brand accent navy, personal = amber, chosen for clear hue + value contrast; the legend below the grid labels them).
  `Today` is ringed; the selected day is filled with the brand accent (its dots invert for contrast).
- **Month agenda** — below the grid, the shown month's dated tasks are grouped by day in date order,
  each group with a localized weekday/day header, a count, and a `Today` chip on today's group. Tapping
  a group header opens that day's sheet. This replaces the previous flat "next 8 upcoming" list so the
  agenda reads as an intentional month surface, not leftover output.
- **Selected date** — tapping a grid cell selects it (persistent emphasis) and opens the bottom sheet;
  the screen also shows a small selected-date summary strip above the agenda with the localized date,
  task count, a `Today` chip when relevant, a re-open action, and a clear-selection action. The sheet
  shows the date, a task count, the day's tasks, and the unchanged "add a task on this date" action.
  Closing the sheet keeps the day highlighted; tapping it again or using the summary strip re-opens it.
- **Anchor date** — the calendar uses the same anchor as the rest of the feature (due date wins over
  scheduled date, Tokyo). No second calendar interpretation is introduced.
- **Separation** — the list-view search/filter bar still does not appear on Calendar; Calendar's date
  controls are native to it. The task calendar remains entirely separate from the Beds24 reservation
  calendar.
- **Empty/sparse** — a month with no dated tasks shows a clear "no dated tasks this month" agenda
  message; a selected date with no tasks shows the day-sheet empty message.

Production-polish pass (2026-06-11): the month nav + weekday row + grid sit inside a single white
`bg-surface` card lifted off the ivory canvas (matching the rest of the Foldy card system); the
legend moved to a quiet divider row directly under the grid it explains. Grid cells share a
fixed-height marker row for even vertical rhythm, with distinct calm states for today (soft tint +
inset ring) vs the selected day (filled accent + lifted shadow). The day sheet's task list scrolls
within a capped height for busy days, the empty states are intentional icon blocks rather than bare
text, and the "add a task on this date" CTA is a soft accent-tinted button. No behavior, permission,
or anchor-date change — visual/interaction polish only.

## Dates And Time

### Single-date model + unified schedule picker (as-built 2026-07-24, A안 — supersedes the two-date UI)

The mobile create/edit form now exposes **one date**, not a scheduled/due pair, benchmarked on
Todoist's date popover. Rationale: field staff almost always mean "do it / due on this day"; the
scheduled + due split added UI weight without real use.

- **One date → `due_at`.** The single date maps to `due_at` (all-day = `00:00` Tokyo; a time sets the
  clock). This matches the app's existing anchor (`due ?? scheduled`, so Today/Tomorrow/Calendar/overdue
  already prefer due). The form submits `scheduledDate=""` + `dueDate=<date>`, so any created or edited
  task writes due-only and `scheduled_date` is cleared.
- **`scheduled_date` is legacy-only.** The column is kept (no migration); un-edited legacy tasks that
  only have `scheduled_date` still display via the anchor. Editing any such task through the form
  converts it to due-only.
- **Unified picker** — `src/components/tasks/task-schedule-sheet.tsx` (`TaskSchedulePicker`), a canonical
  `BottomSheet`: quick relative options (**오늘 · 내일 · 다음 주 · 다음 주말 · 날짜 없음**, each with its
  computed date), an inline month calendar, and expandable **시간 / 반복** rows — all in one sheet.
  Commit-on-close (Todoist-style: any dismiss keeps the current selection). The create/edit form's
  date/time/repeat now live only in this sheet (removed from the old "더 보기" section); the form shows a
  single 일정 chip summarizing date + time + repeat.
- **Consistency actions** — the quick-create (`quickCreateTodayTask` / `quickCreateTomorrowTask`) and
  swipe move (`moveTaskToToday` / `moveTaskToTomorrow`) actions now write `due_at` (move preserves
  time-of-day and re-anchors a recurring occurrence) instead of `scheduled_date`, so the single-date
  model is coherent across create, edit, quick-add, and swipe.
- i18n: `scheduleTitle` / `scheduleNoDate` / `scheduleNextWeek` / `scheduleNextWeekend` / `scheduleDone`
  / `scheduleEmpty` / `scheduleAddTime` / `scheduleAddRepeat` (ko/ja/en).

### Time-block duration + contextual repeat (as-built 2026-07-24)

Inside the schedule sheet, the **Time** and **Repeat** sub-pickers were rebuilt to match Todoist:

- **Duration (기간)** — a timed task can carry a same-day **time-block length**. Default is **기간 없음**;
  tapping offers **15분 / 30분 / 1시간 / 2시간 / 사용자 정의(분 입력)**. Stored in a new nullable column
  `tasks.duration_minutes` (migration `202607240001_task_duration.sql` — **apply in Supabase before
  deploy**). Duration is only kept when the task has a time-of-day (`time_label`); all-day tasks force it
  to null (server-guarded). Display: cards show `HH:MM–HH:MM` and detail shows `HH:MM – HH:MM · <length>`.
  This is a **single-day block**, not a multi-day span (the single-date model is preserved).
- **Repeat — contextual list keyed off the selected date** (Todoist-style vertical menu, not chips):
  반복 없음 · 매일 · **매주 {요일}** · 평일마다 (월-금) · **매월 {일}일** · **매년 {월 일}** · 사용자 정의
  (read-only, legacy). The weekly/monthly labels are display-only (the engine already anchors to the
  selected weekday/day-of-month). **`매년`(yearly) is a new recurrence rule** added to the engine
  (`nextOccurrence` = +1 year, same month/day, Feb-29 clamped). Standalone "주말마다"(weekends) was
  dropped from the new picker (engine + legacy display retained). i18n: `durationLabel` / `durationNone`
  / `duration15…120` / `durationCustom` / `durationMinUnit` / `repeatWeeklyOn` / `repeatEveryWeekday` /
  `repeatMonthlyOn` / `repeatYearlyOn` / `repeatYearly` (ko/ja/en).

### Overdue bulk reschedule reuses the picker + check-alignment fix (as-built 2026-07-24)

The Today-tab overdue **"일정변경 N개 선택"** sheet now renders the same `TaskSchedulePicker` in a
**date-only variant** (`variant="date"`: quick options 오늘/내일/다음 주/다음 주말 + inline calendar, no
time/repeat, no 날짜 없음). Unlike the create/edit picker (commit-on-close), the date variant **commits
only on the 완료 button** (a scrim tap / drag / Esc cancels), then applies the chosen date to every
selected overdue task via `rescheduleOverdueTo(date, ids)`. The previous bespoke reschedule sheet and its
custom mini-calendar (plus the `overdueCustom*` state) were removed. Also fixed: in the picker's quick
options, the selected row's 요일/날짜 no longer shifts left — the check (✓) now sits in a fixed-width slot.

The scheduling model description below is the **original two-date direction**, kept for history; the
single-date model above is the current UI truth.

The task system needs stronger scheduling than a simple due-date field.

### Required Date Model

Each task should support:

- scheduled date
- due date

### Quick Date Actions Needed

- today
- tomorrow
- weekday
- weekend
- direct date selection

### Time Policy

Default:

- all-day

Optional:

- specific time

So users should be able to choose:

- all-day task
- time-specific task

As-built (2026-06-11): the detailed create/edit form's Time section offers an **All day** toggle, a
direct **time picker** (`HH:MM`), three quick-time chips, and a clear control that returns the task to
all-day. The saved time-of-day lives in `time_label` (with `all_day` = "no time-of-day"); the picker
is pre-filled from `time_label` when editing, so a saved time round-trips correctly. Toggling back to
all-day in edit clears the time cleanly (no stale `time_label`). See
`docs/engineering/09-todo-task-technical-design.md` "Time handling" for the exact persistence rule.

A specific time **requires at least one date anchor** (scheduled or due). Entering a time with no
date is **not accepted** — the form blocks submission with a clear localized error (it no longer
silently drops the time), and both server actions reject it as a guard (create returns to the form,
edit returns to the edit form, both with the error). This applies identically to create and edit.

An **all-day due task is shown as date-only** in task detail, never as a midnight time. Because an
all-day due date is stored at `00:00` Tokyo internally, the detail view renders it as a plain date
when `all_day` is true (and date + time only for genuinely timed tasks), so the screen never shows a
contradictory "Due: … 00:00" alongside "Time: All day".

## Recurring Tasks

Recurring tasks are needed here, but in a lighter form than the Work Scheduler.

Required support:

- daily
- weekly
- monthly
- weekdays only
- weekends only
- custom repeat pattern

Not required in first slice:

- exception dates
- recurrence count limits
- complex recurrence-end rules

As-built (2026-07-30, occurrence model — **supersedes** the 2026-06-16 roll-forward model. See
`docs/planning/01-decision-log.md` → "2026-07-30 롤포워드 폐지"):

- A recurring task is a **single live `tasks` row** carrying the `recurrence_rule`,
  `recurrence_series_id`, and a **FIXED anchor** (`recurrence_instance_date`). Occurrences are the
  rule's dates computed on the fly (`recurringOccurrencesInRange`) — **not** pre-created rows.
- **Every scheduled date shows independently — completion no longer rolls the row forward.** A
  recurring task appears on **each** of its occurrence dates in 오늘/내일/캘린더 (so "5 recurring →
  tomorrow also shows 5"), regardless of whether today's is done. The date-agnostic tabs (관리함/지시)
  still show one entry per series.
- **Per-occurrence completion lives in `task_occurrence_state`** (keyed by `(task_id,
  occurrence_date)`), **not** on the row. `completeTask(taskId, occurrenceDate)` records that date as
  `completed` (row untouched, stays `open`) + logs a `completed` update + fires `task_completed`. The
  quick-complete **undo** (`reopenTask(taskId, occurrenceDate)`) clears that occurrence's state row.
  The **Completed (완료/기록)** tab and **daily report** still read the `task_updates` completion log
  (unchanged), so recurring completions appear there by their completion day.
- **Overdue occurrences persist forever — no auto-skip, no auto-delete.** An occurrence whose date has
  passed with no recorded state is **overdue** and stays so (연차·연휴·업무 사정으로 며칠 밀려도 사라지지
  않는다). Overdue occurrences of a recurring task are collapsed into **one grouped item per task**
  ("○○ · N일 밀림") in the Today tab's overdue area, with two actions:
  - **(2026-09-08 폐기)** 예전에는 「오늘로 가져오기」/「삭제」 2택을 지연 섹션에 두었다. 지금은
    반복이 지연 섹션에 뜨지 않으므로 그 두 액션도 없다 — 아래 「반복 지연은 오늘 줄의 배지」 참고.
  One-off overdue tasks keep the existing bulk 오늘로 가져오기 / 지난 미완료 삭제 prompt (author-scoped).
- **반복 지연은 지연 섹션이 아니라 「오늘 줄의 배지」다 (2026-09-08).**
  반복이 **오늘 회차이거나 밀린 회차가 있으면** 오늘 목록에 **한 줄**로 뜬다(`showsOnTodayList`).
  오늘이 회차가 아닌 반복(주간 등)이 밀린 경우도 오늘로 끌어온다. 밀렸다는 사실은 그 줄의
  **「N일 밀림」 배지**(`odDaysBehind`)로 남는다.
  - **왜 바꿨나.** 평일 반복은 하루만 밀려도 전부 지연 섹션에 쏟아진다 — 실측 화면에서 지연 9건 중
    8건이 「1일 밀림」 반복이었고, 정작 2주 밀린 일회성 하나가 그 사이에 묻혀 있었다. 게다가 오늘도
    회차인 반복은 지연·오늘 두 줄로 나타났다. 지연 섹션은 이제 **일회성만** 담아 신호가 산다.
  - **완료가 곧 해소다.** 오늘 것을 완료하면 서버가 그보다 앞선 미해결 회차를 `moved` 로 함께
    처리하고(`absorbEarlierOccurrences`) 배지도 사라진다. 이 반복 업무들은 누적되지 않기 때문이다
    (3일치 재고 확인을 세 번 하지 않는다). `moved_to_date` 에 어느 완료가 흡수했는지 남는다.
  - **완료한 날짜보다 앞선 것만** 흡수한다 — 캘린더에서 과거 회차를 직접 완료할 때 뒤의 미해결
    회차까지 쓸어버리면 안 된다.
  - **오늘이 회차가 아닌 경우**(월·수·금 반복을 화요일에 보는 경우) 완료는 **가장 오래된 미해결
    회차**로 정산된다(`resolveCompletionOccurrence`). 화요일에 하는 일은 「밀린 월요일 것」이지
    「화요일 것」이 아니다 — 그대로 저장하면 **규칙에 없는 날짜에 상태 행**이 생겨, 상세 화면이
    그 회차를 무효로 보고 완료 버튼을 감춘다.
  - **되돌리기는 흡수한 것까지 되살린다**(`releaseAbsorbedOccurrences`). 완료가
    `moved_to_date = <완료일>` 로 흡수하므로 그 완료일을 가리키는 `moved` 행을 함께 지운다.
    없으면 취소해도 밀림 배지가 돌아오지 않아 되돌리기가 반쪽이 된다.
- **반복 업무는 「오늘로/내일로 이동」의 대상이 아니다 (2026-08-25).** Those actions re-anchor a task
  through `due_at`, and for a recurring row that is the **series anchor**. Re-anchoring shifted the
  whole rule's phase (weekly-Monday silently became weekly-Wednesday) and, because overdue
  occurrences are computed from the anchor forward, **wiped the accumulated backlog**. That
  contradicts the fixed-anchor contract below, so all four actions (`moveTaskToToday`,
  `moveTaskToTomorrow`, `moveConsoleToToday`, `moveConsoleToTomorrow`) now reject a standard
  recurring task with the error code **`recurring_series`**, and `recurrence_instance_date` is no
  longer written by any move path. The mobile swipe and the console row menu hide the action for
  recurring tasks; the rejection copy points at the two supported routes — edit the recurrence rule,
  or skip just this occurrence. **The only legitimate way to move a series anchor is an explicit
  user edit** (`updateTaskCore` / `updateConsoleTaskCore`).
- **완료 토글은 누른 즉시 반영된다 — 일회성·반복 같은 방식 (2026-08-11).**
  완료를 누르면 서버 왕복(세션 조회 → 상태 기록 → 로그 insert → `revalidatePath` 3개 → 페이지
  전체 RSC 재렌더)이 끝나야 목록이 갱신된다. 그동안 아무 반응이 없으면 «눌렀나?» 하고 다시
  누르게 된다.
  - 그런데 낙관적 처리가 **일회성에만** 있었다(`if (!occurrenceDate)`). 관리함은 반복 업무가
    대부분(실측 9건 중 7건)이라 사실상 대다수의 완료가 그 대기를 겪고 있었다.
  - 두 경로를 `useOptimistic` 으로 통일했다. 일회성은 행을 즉시 빼고, 반복은 **회차 상태를
    낙관적으로 «완료»로 얹어** 같은 결과(행이 즉시 사라짐)를 만든다.
  - **관리자 콘솔도 같은 모델로 이식했다 (2026-08-25).** 콘솔의 체크박스는 낙관적 처리가 전혀 없어
    서버 왕복이 끝나야 반응했고, 게다가 `run()` 이 `revalidatePath` 로 이미 갱신된 화면을
    `router.refresh()` 로 한 번 더 돌려 **왕복이 2회**였다. 콘솔의 모든 쓰기 액션이
    `revalidatePath(CONSOLE_PATH)` 를 호출함을 전수 확인하고 그 `router.refresh()` 를 제거했다.
  - 되돌리기(reopen)에는 양쪽 모두 낙관적 처리를 하지 않는다 — 행이 다시 나타나야 하는데 그건 서버
    데이터가 와야 알 수 있고, 실행 취소는 이미 토스트라는 즉각적 피드백을 갖고 있다.
  - 직접 만든 «숨김 집합 + try/finally 원복»을 걷어냈다. 되돌리기를 손으로 관리하다 보니 한쪽
    경로가 빠졌던 것이고, `useOptimistic` 은 새 props 가 도착하면 스스로 버려져 실패 시에도
    행이 저절로 제자리로 돌아온다. **삭제(단건·일괄)도 같은 경로를 쓴다.**
  - **되돌리기(reopen)에는 낙관적 처리를 넣지 않는다.** 행이 다시 나타날 자리는 서버 데이터가
    와야 알 수 있고, 실행 취소는 이미 토스트라는 즉각 피드백을 갖고 있다.
- **반복 업무는 «원본 행»으로 그려질 때 지연 배지를 달지 않는다 (2026-08-07 수정).**
  반복 업무의 `due_at` 은 마감일이 아니라 **앵커**다 — 「7/29부터 평일마다」의 시작점이라 고정된 채
  과거에 남는다. 오늘/내일 탭은 반복을 회차 행으로 그려서(`occurrence` prop) 문제가 없었지만,
  **관리함은 원본 행으로 그린다.** `TaskCard` 가 지연을 자체 계산하면서 반복을 빼지 않아, 관리함의
  반복 업무가 **전부** 「7/29 지연」으로 보였다(실측 9건 중 7건). 어드민 콘솔
  (`admin/tasks/helpers.ts` `isOverdue`)과 이 화면의 탭 분류(`tasks-workspace.tsx` `isOverdue`)는
  **둘 다 이미 반복을 제외**하고 있었다 — 카드만 자기 규칙을 갖고 있었던 것이다.
  - 반복 원본 행은 앵커 대신 **다음 회차**를 보여 준다(`nextRecurringOccurrence`). 날짜를 통째로
    지우면 반복 칩(「평일」)만 남아 «언제 하는 일인지»가 사라진다. 문구는 완료 토스트가 쓰는
    `nextLabel`("다음: {date}")을 재사용한다 — 같은 개념을 두 문구로 두지 않는다.
  - **카드는 «진짜 밀린 회차»를 세지 않는다.** 그건 `task_occurrence_state` 를 알아야 하는데 카드에
    없다. 위의 「N일 밀림」 그룹이 액션까지 포함해 이미 담당하므로, 카드에서 흉내 내면 근거 없는
    숫자만 하나 더 생긴다.
- **Calendar/list previews are virtual** — the month grid, agenda, day sheet, and now the 오늘/내일
  lists expand each recurring task across its occurrence dates from the rule for display; tapping a
  virtual occurrence acts on the one real series row, and its checkbox completes **that date's**
  occurrence.
- The old window-materializer (`materializeRecurringTasks`) is **deprecated and no longer called**
  from any read path. Pre-existing materialized instances were collapsed to one row per series by
  migration `202606160002_collapse_recurring_instances.sql`.
- A repeat rule **requires a date anchor** (`scheduled_date` or `due_at`). Saving repeat with no date
  is rejected both in the form and in the server actions.
- User-selectable rules: **None, daily, weekly, monthly, yearly, weekdays, weekends** (None clears it).
  Recurrence can be set in create, changed in edit, and cleared back to None at any time.
- **Two recurrence-rule tables MUST stay in sync:** `STANDARD_RECURRENCE_RULES` +
  `nextOccurrence` exist in both `@/lib/tasks` (server-only, TaskRecord rollover) and
  `@/lib/tasks-recurrence` (client-safe, calendar previews + overdue dismiss/reschedule gating). A rule
  in one but not the other silently diverges the paths — this caused a **data-loss bug (fixed
  2026-07-29)** where an overdue `yearly` task was hard-deleted by "지난 미완료 삭제" instead of rolling
  forward, because `tasks-recurrence.ts` was missing `yearly`.
- **`custom` is recognized but not user-configurable in this slice.** There is no rule builder, so the
  form does not offer `custom` as a new choice. If a task already stores `custom` (legacy/external),
  the edit form surfaces it as a read-only highlighted chip so the selection is unambiguous and the
  value is not silently lost; the user can keep it, switch to a standard rule, or clear it — but cannot
  newly assign `custom`. It renders with the "Custom" label wherever recurrence is shown.
- This `custom` rule is **enforced on the server, not just in the UI.** Persistence is identical in
  create and edit and runs through one shared resolver: a standard rule is stored, empty/None or any
  unrecognized value fails closed to `null`, and `custom` is kept **only when the task already had
  `custom`**. So a new task can never be created with `custom`, and a non-custom task can never be
  turned into `custom`, even by a manipulated request — only an existing `custom` task round-trips.
- Generation model (Todoist-style, 2026-06-16):
  - the task the user saves is the single live occurrence; **no future rows are generated**
  - completing it rolls the same row forward to the next occurrence (and stays open)
  - the calendar projects future occurrences virtually from the rule (display only)
  - clearing repeat (set None) turns it back into a one-off task; completing then closes it normally

## Priority

Priority is needed, but must stay simple.

Use 3 levels:

- normal
- important
- urgent

## Tags

Tags are needed.

Rules:

- user-created only
- not fixed system-only tags
- max about 10 tags per task

## Photos

Photos are optional.

Max:

- 5 images

Photos may be attached to:

- the main task itself
- update-log entries

Viewing (as-built 2026-06-12): attached photos are shown, not just counted. Task detail (both the task
header and each update-log note) renders a few **tiny thumbnails**; tapping them raises a **bottom
sheet** listing every attachment, and tapping one there opens a **full-screen swipeable viewer**
(multi-photo carousel with a position counter and dots). Before this, photos showed only as a
"사진 N장" count with no way to open them.

Removal behavior (as-built 2026-06-11): when the original author removes a task-level photo during a
core edit, the file is hard-deleted from Storage (not just detached from the DB) — only files under
the task's own org/`task-images` path are eligible, and removal happens server-side after the DB
reference is dropped. Update-log photos are immutable once posted (the update-log has no edit/delete in
this slice), so they are not storage-cleaned.

## Update Log

Comments and progress notes should not be separate concepts in the first slice.

Use one unified update-log stream.

This stream should support:

- participant progress notes
- follow-up notes
- optional update images

It should also support system-style small entries such as:

- task edited
- task shared

So the user can see small signals like:

```txt
edited
```

without a separate audit UI.

## Sharing Model

### Default

- task starts private

### Sharing

- any active organization user can be selected
- multi-select sharing is required
- one share action can add multiple recipients

### Re-sharing — 참여자도 부를 수 있다 (규칙 유지, 2026-07-31 확인)

- **참여자도 다른 사람을 추가할 수 있다.** 지시를 받은 사람, 공유를 받은 사람 모두 해당한다.
- **부르기만 되고 빼기는 안 된다.** 남을 참여자에서 제거하는 것은 **작성자만** 가능하다
  (`removeTaskParticipant` — 자기 자신 나가기는 누구나). 참여자의 "지시/공유 성격 변경"
  (`is_directive` 전환)도 작성자 전용이다.
- **플랫폼 개발자 예외(2026-10-23):** 작성자 전용 동작(코어 편집 · 일정 변경 · 삭제 · 되살리기 · 참여자 빼기 · 지시 전환)과
  프로젝트 소유자 전용 관리(섹션 · 멤버 · 삭제)는 개발자도 할 수 있다 — `canEditTaskCore` · `ProjectDetailData.viewerCanManage`.
  단, **개발자가 열 수 있는 작업(getTaskScope 범위) 안에서만**이다. 남의 개인 작업이 보이게 되지는 않는다. 05 「개발자 예외」.
- **프로젝트 주인(2026-10-28):** 프로젝트 할 일의 작성자 전용 동작(코어 편집 · 일정 · 삭제 · 되살리기 · 참여자 빼기)은 그 프로젝트
  주인도 할 수 있다 — `canEditTaskAsOwnerOrAuthor`. 「작성자가 나가면 = 삭제」는 진짜 작성자에게만.
- 이 규칙은 원래 문서에 있었으나 **관리 콘솔만 작성자 전용으로 구현되어 두 화면이 갈라져
  있었다.** 2026-07-31 소유자 확인으로 **문서 쪽(참여자 허용)** 으로 통일했다.

**두 화면의 구현이 다른 점 — 서버가 흡수한다.**

| | 모바일 `shareTaskWithUsers` | 콘솔 `shareConsoleTask` |
| --- | --- | --- |
| 구조 | 추가 전용(`!existing.has`) | 피커 체크 상태로 **집합 재조정** |
| 참여자가 호출하면 | 그대로 추가 | **제거분을 버리고 추가만 적용**, `is_directive` 미변경 |

콘솔 액션을 그냥 열면 참여자가 다른 참여자를 축출할 수 있게 되므로, 작성자가 아닐 때는
`toRemove = []` 로 두고 `tasks` 갱신도 `is_shared: true` 만 한다. 화면에서도 기존 참여자 행을
`disabled` 로 잠가, 해제했다가 새로고침에 되살아나는 유령 조작을 막는다.

**알아둘 것.** 지시(`is_directive`) 작업에 참여자가 누군가를 추가하면, 추가된 사람에게는 **원
작성자가 보낸 지시**로 보인다(`recvInstr` 판정이 작성자 기준). 누가 실제로 불렀는지는
`task_participants.added_by_user_id` 에 남는다. 연결된 객실·예약·게스트 컨텍스트도 함께 전달된다.

### First Recipient

The first recipient should be shown in the UI, even if only in a subtle way.

### Participant Display

Show:

- original author
- first recipient
- current participant list

Recommended display style:

- list cards: summary like `shared with 3`
- detail: full participant names
- first recipient subtly distinguished

### Shared Task Visual Distinction

Do not overdesign this.

Recommended direction:

- small shared indicator
- participant hint
- subtle distinction only

## Permissions

### Private Task

- creator can view/edit/delete
- no one else can see it

### Shared Task — Core Content

Only the original author can edit:

- title
- description
- tags
- scheduled date
- due date
- time
- recurrence
- task-level photos

### Shared Task — Collaboration Actions

Any participant can:

- add update-log entries

### Participant Management

- original author can remove any participant
- any participant can remove themselves

If a non-author participant removes themselves:

- the task disappears completely from that person's views

If the original author removes themselves:

- the task is deleted for everyone

### Deletion

Deletion is hard delete.

## Quick Add

The system needs both:

- quick add
- detailed create

### Quick Add

Required input:

- title only

Default destination:

- Inbox

### Detailed Create

Should allow full task setup.

Recommended first-visible fields:

- title
- description
- scheduled date
- due date
- share recipients

Recommended collapsed / "more" fields:

- time
- priority
- tags
- photos
- recurrence

### As-built flow (2026-06-11)

The Quick Add ↔ Detailed Create distinction is made explicit in the interaction:

- The floating **Quick add** button (on every task view) opens a bottom sheet for **fast capture**:
  a title-only field, a primary **Save to Inbox** action (creates `is_inbox = true`), and a secondary
  **Full create** action. The sheet's helper copy states the two outcomes plainly.
- Below those, two one-tap day shortcuts sit side by side — **Add to Today** and **Add to Tomorrow** —
  which create an organized task (`is_inbox = false`) with `scheduled_date` set to today / tomorrow
  (Tokyo) and jump straight to that day tab (`quickCreateTodayTask` / `quickCreateTomorrowTask`).
- **Full create** is the deliberate organize path. It routes to `/mobile/tasks/new` (an organized task,
  `is_inbox = false`) where dates, share recipients, time, priority, tags, photos, and recurrence are
  configured. A short subtitle on that screen restates this. Any title already typed in Quick Add is
  **carried over** (`?title=`) so escalating from capture to full create never loses the input.
- The same `/mobile/tasks/new` is reused for date-prefilled creation from the **Calendar** day sheet
  (`?date=`); there is no separate full-create entry path.
- Wording is unambiguous about destination: Quick Add → Inbox, Full create → organized task. Detailed
  create never lands in Inbox (see Inbox Rules).
- **Sheet dismissal (2026-06-15)**: the Quick Add sheet — like every bottom sheet in this feature
  (Calendar day sheet, long-press menu, share picker, context picker, report sheet, photo-attachment
  sheet) — is dismissed by **dragging it down** (iOS-style), tapping the scrim, or Esc. The old
  top-right **X close button was removed** since the slide replaces it. Shared behavior + thresholds:
  Mobile Navigation doc → "2026-06-15 Bottom Sheets — iOS-style Drag-to-Dismiss".
- **Draft preservation (2026-06-12)**: the detailed create/edit form mirrors its in-progress values
  (title, description, dates, time, priority, tags, share recipients, linked context, expanded state)
  into `sessionStorage`, so leaving the form and coming back restores them. This matters most for the
  context link's **"예약 보기"** action, which navigates to the reservation calendar — a back-navigation
  no longer wipes what was typed. The draft is cleared on a successful save and on an explicit
  back-to-list; newly attached (not-yet-uploaded) photos are the one field a round-trip does not keep.

- **Double-submit guard (2026-08-25).** Neither the quick-add sheet nor the detailed form nor the
  console's inline add had an in-flight lock, and the create actions mint a fresh `crypto.randomUUID()`
  with no idempotency key or unique constraint — so a fast double tap created **two tasks**.
  - Quick-add sheet: a `useFormStatus`-based wrapper disables all three submit buttons (보관함 / 오늘 /
    내일) while the action is in flight. The shared `SubmitButton` was not reused here because its
    `Button` base styling (`h-11 rounded-xl shadow-glass`, blur on `secondary`) breaks this sheet's
    flat look; the reason is recorded at the component.
  - Detailed create/edit form: the button's `disabled={isPending}` only engaged **after** the photo
    upload `await`, leaving the whole upload window tappable. A ref-based lock is now taken
    synchronously at the top of `handleSubmit` (a state flag re-renders too late to stop the second
    tap) and released on every early-return path — missing-title, `time_needs_date`,
    `repeat_needs_date`, and upload failure — so a rejected submit never leaves the form stuck.
  - Console inline add: same synchronous ref lock, released in both the success and error callbacks,
    plus a pending-disabled save button. The Enter-to-save path shares the guarded function.
- **Recurring completion from the detail screen (2026-08-25).** The detail view's complete button
  called `completeTask(task.id)` **without an occurrence date**, so the server fell back to the
  series anchor (`recurringAnchorDate`) and marked a *past* occurrence complete while today's stayed
  open in the list. Its label was also driven by `task.status`, which for a recurring row is
  permanently `open`, so the button always read 완료. The page now passes the occurrence date, and
  `done` reads that occurrence's recorded state for recurring tasks. When the detail is opened
  **without** occurrence context (a series row tapped from 관리함, no `?occurrence=`), the complete
  button is **hidden** and replaced with guidance to open the task from 오늘 / 내일 / 캘린더 —
  silently completing the anchor is the very bug being fixed. Occurrence state for the page comes
  from the task-scoped `occurrenceStatesForTask()`; the org-wide `getOccurrenceStates()` would read
  400 days of organization data to answer one date.

- **반복 지연 카드 리디자인 (2026-08-25).** 밀린 반복 묶음 행(`recOverdueGroup`)은 제목 오른쪽에
  좁은 알약 두 개(`px-3 py-1.5`, 높이 ~28px)를 끼워 넣은 구조라 제목이 잘리고 탭 타깃이 작았다.
  지연 배너와 같은 문법으로 다시 짰다 — **아이콘 칩 + 제목 + 「N일 밀림」 배지 한 줄, 그 아래 전폭
  액션 두 개**(h-10 `rounded-[14px]`, 오늘로 가져오기=primary / 삭제=ghost). 아이콘은 `Repeat` 인데,
  이 카드는 바로 위 **일회성** 지연 배너와 나란히 놓이므로 둘을 구분하는 유일한 단서다. 토스트
  표준은 `docs/product/16-mobile-navigation.md` → "2026-08-25 떠 있는 토스트".

- **텍스트 입력이 큰 트리를 다시 그리지 않게 한다 (2026-09-04, 성능 계약).** 빠른 추가 시트의 제목은
  제어 입력이라 **한 글자마다 `TasksWorkspace`(2500줄) 전체가 다시 그려졌다.** 폼 제출은 이미
  `name="title"` 로 **DOM 에서 직접** 값을 읽으므로(서버 액션의 `formData.get("title")`), 애초에
  상태로 들고 있을 이유가 없었다. 비제어로 바꾸고, 화면이 실제로 알아야 하는 「비었는가」 하나만
  상태로 둔다(버튼 활성화). 시트를 닫았다 열면 입력이 유지되던 동작은 **닫을 때 한 번** 값을
  `quickSeed` 에 담아 유지한다 — 렌더 중에 ref 를 읽지 않으므로 `react-hooks/refs` 규칙도 지킨다.
  - 검색창은 예외가 아니라 **다른 완화책**을 쓴다: `useDeferredValue` 로 무거운 목록 계산만 뒤로
    미룬다(2026-08). 입력 자체는 즉시 반응한다.
  - 관리자 콘솔 인라인 추가도 같은 이유로 같은 처리를 했다(`28-admin-todoist-console.md`).
- **빠른 추가 성공 후 입력을 비우고 시트는 열어 둔다 (2026-09-04).** 서버 액션이
  `redirect("/mobile/tasks?view=…&created=1")` 로 끝나는데 같은 라우트라 소프트 내비게이션이
  일어나고 `TasksWorkspace` 가 언마운트되지 않는다. 그래서 **시트도 입력도 그대로 남아 있었고**,
  방금 등록한 제목이 칸에 남아 한 번 더 누르면 같은 작업이 또 만들어졌다. `created` 파라미터는
  타입 선언에만 있고 **아무도 소비하지 않았다.** 이제 그 파라미터를 받아 입력을 비우고 URL 에서
  털어낸다(`skippedTask`/`deleted` 와 같은 소비 패턴).
  - **닫지는 않는다** — 한 건 넣고 곧바로 다음 건을 치는 흐름을 콘솔 인라인 추가와 맞춘다.
    닫으려면 스크림 탭 · 아래로 드래그 · Esc(기존 경로 그대로).
  - 콘솔과 달리 **낙관적 삽입은 없다.** 모바일은 서버 액션이 리다이렉트로 끝나 목록이 내비게이션과
    함께 갱신되는 모델이라, 낙관적 행을 얹으려면 액션의 리다이렉트 구조부터 바꿔야 한다.
  - **React Compiler 로는 못 줄이는 종류다.** 상태가 바뀌면 그 상태를 읽는 트리는 다시 그려야 한다.
    새 입력을 큰 컴포넌트에 넣을 때는 「상태를 아예 건드리지 않는」 쪽을 먼저 검토할 것.

- **Tokyo 운영일은 클라이언트에서 살아 있다 (2026-09-08).** `today` 는 서버가 prop 으로 주지만
  **초기값으로만** 쓰고, 이후에는 1분 간격 + focus/visibilitychange 로 다시 계산한다. PWA 를 켠 채
  두면 `TasksWorkspace` 가 언마운트되지 않아 서버 렌더 시점의 날짜가 그대로 남고, JST 자정을 넘기면
  **「오늘」 탭이 어제를 보여 주고 지연 판정도 하루 밀린다.** 관리자 콘솔이 쓰던 방식을 그대로 이식했다.
  - 초기값은 반드시 서버 값이어야 한다 — 첫 렌더에서 클라이언트가 스스로 계산하면 하이드레이션이
    어긋난다. 갱신은 마운트 후에만 일어난다.
  - **캘린더·청소에는 같은 처리를 하지 않았다.** 그쪽은 서버가 `today` 기준으로 **데이터 범위까지
    가져온다** — `today` 만 클라이언트에서 바꾸면 「오늘 표시」와 실제 데이터가 어긋난다
    (`mobile-calendar-view.tsx` 의 «never recompute on client» 주석이 그 뜻이다). 투두는 목록 전체가
    이미 클라이언트에 있고 `today` 는 분류에만 쓰이므로 다시 계산하는 것이 완전하다. 날짜 이동은
    서버 요청이라 어차피 스스로 바로잡힌다.

- **새 작업은 목록 «아래»에 붙는다 (2026-09-09).** 수동 드래그 순서가 없는 항목은 **만든 순서
  (오래된 것 먼저)** 로 정렬한다. 오늘·내일은 우선순위를 먼저 보고 같은 우선순위 안에서 만든 순서다.
  - 예전에는 새 작업이 **맨 위**로 튀었다. 의도한 규칙이 아니라 목록 데이터가 `created_at desc` 로
    오는 것을 그대로 둔 결과였다(관리함만 그 동작을 명시적으로 쓰고 있었다). 정작 **추가하는 자리는
    아래**(콘솔 인라인 추가·모바일 빠른 추가)라, 방금 만든 것이 시야 밖으로 사라졌다.
  - 적용 범위는 **오늘 · 내일 · 관리함** 세 목록이다. 완료·기록(완료일 그룹)과 캘린더는 자체 정렬을
    쓰므로 영향이 없다.
  - 모바일과 콘솔이 같은 규칙을 쓴다.

- **미래 날짜는 완료할 수 없다 — 미리보기다 (2026-09-09).** 다가오는 일정·캘린더 날짜 시트에서
  **오늘보다 뒤인 날짜**의 항목은 체크박스가 비활성이다(콘솔은 흐리게, 모바일은 정적 표시).
  오늘·과거는 그대로 완료할 수 있다.
  - **표시는 점 마커다 — 흐린 체크박스가 아니다.** 못 누르는 동그라미를 남겨 두면 「고장난 버튼」으로
    읽힌다. 체크박스 자리(콘솔 24px · 모바일 22px)를 그대로 지키는 7px 점으로 바꿔, 오늘·과거 행과
    왼쪽 정렬이 어긋나지 않으면서 「지금 누를 것이 아니다」가 형태로 드러나게 한다. 점 색은 우선순위를
    그대로 따른다.
  - **왜.** 이 반복들은 그날에 묶인 운영 업무다 — 금요일 「일매출 변동 시트작업」을 수요일에 할 수
    없다(그날 매출이 아직 없다). 그런데 미리 눌리면 **그날이 왔을 때 목록에서 사라진다.** 아무도 안
    했는데 기록만 「완료」다. 게다가 다가오는 일정은 100건 넘게 스크롤되는 목록이라 오탭이 쉽고,
    그 화면엔 실행 취소도 없다.
  - **콘솔은 그보다 나빴다.** `renderRow(t, { hideDate: true })` 가 **회차 날짜를 넘기지 않아**
    서버가 `recurringAnchorDate` 로 폴백했다 — 「9월 11일」 항목을 체크하면 9/11이 아니라 **시리즈
    앵커**(8/19 등)가 완료 처리된다. 대개 이미 완료된 날짜라 화면상 반응이 없고, 대신 오늘자 완료
    로그만 하나 쌓여 업무일지에 **안 한 일이 올라간다.**
  - 미리 끝낸 일회성 작업이라면 **날짜를 오늘로 당기는 것**이 사실에 더 가깝다.

## Task Cards

For readability, default list cards should prioritize:

Required:

- title
- priority
- scheduled date or due date
- time if set
- shared indicator
- participant summary
- recurrence indicator

Optional:

- 1-line description preview
- 1-2 tag preview
- photo indicator

Avoid by default:

- long body previews
- full participant lists
- excessive metadata

## Completion — as-built (2026-06-13)

Task completion was re-introduced (it had been removed in the 2026-06-12 IA cleanup):

- Tapping the leading **status circle** on any task card **completes** it (active task) or **reopens**
  it (completed task). Completing shows a bottom **undo toast** ("완료했습니다 · 실행 취소"); for a
  **recurring** task it adds a **"다음: {날짜}"** subline (the next occurrence it rolled to). Undo = reopen.

### Soft-delete & Undo (2026-07-29, owner-approved deletion-policy change)

- **Tasks now use SOFT delete** (`deleted_at`, migration `202607290001`) so deletes are undoable. All
  task list/detail reads filter `deleted_at is null`; `restoreTask` clears it (author-checked). Create-
  rollback deletes stay hard. This is a scoped exception to the hard-delete MVP policy (CLAUDE.md §9).
- **Delete undo:** `deleteTask` soft-deletes and redirects to `/mobile/tasks?deleted=<id>`; the list
  shows a **"작업을 삭제했습니다 · 실행 취소"** toast that calls `restoreTask` (ref-guarded, once per id).
- The dashboard console (`/admin/tasks`) uses the identical model + a Todoist-style `.undobar`.
- The task **detail view** also has a **완료 / 다시 열기** button.
- Completing sets `status` + `completed_at` + `completed_by_user_id`, writes a `completed` row to the
  update log, and fans out a `task_completed` notification to other participants; reopening clears
  those fields and writes a `reopened` log row. Both revalidate the list and detail.

## 업무일지 예약 보내기 (2026-10-20, 시안 https://claude.ai/artifact/SL1oygg2h9bs8CLpCJzjtC A안)

업무일지 시트는 그대로(포함할 항목 → 본문) 두고, 버튼 위에 **「보낼 시각」 줄 하나**를 더했다. 그 줄이 아래 큰 버튼 글자를 정한다.

| 무엇 | 동작 |
| --- | --- |
| 보낼 시각 | **3차(2026-10-20, 시안 모바일 https://claude.ai/artifact/JnZtYSQ8TyC1mwHAdKPWu6 A · PC https://claude.ai/artifact/7SR7V8JauKj1rStKt1AEWM P1)** — 2차 「오늘 [시]:[분]」 칸(▲▼ · 숫자 키패드)은 써 보니 불편(특히 모바일: 한 시트에 다 쌓여 길고, 키패드가 보내기 버튼을 덮음)해서 바꿨다. 업무일지 시트에는 **한 줄만** 「보낼 시각 · 오늘 17:37 · 1시간 12분 뒤 ›」(지금 바로면 「지금 바로」). 누르면 **시각만 담은 시트가 위에 한 장 더**(`report-time-sheet.tsx`, 공용 BottomSheet `z-[90]`): 제목 「언제 보낼까요?」 · 「오늘 · 날짜」, 빠른 선택 한 줄(지금 바로 · 30분 뒤 · 1시간 뒤 · 18:00 · 19:00 · 20:00 — 가로로 밀림, `data-swipe-back="off"`, 지난 것은 흐림 + 줄 그음), 큰 시각 + 「1시간 12분 뒤」, **시 · 분 휠**(`report-time-wheel.tsx`, 1분 단위, scroll-snap, 한 칸 넘을 때마다 가벼운 햅틱, 줄 누르면 그 값으로 굴러감, 열마다 role=spinbutton ↑↓ · Page Up/Down · Home/End), 맨 아래 「이 시각으로 정하기」(지금 바로면 「바로 보내기로 정하기」). **지난 시 · 분은 흐린 줄긋기로 남고, 거기서 멈추면 가장 이른 시각(지금+2분)으로 굴러 돌아간다** — 휠 안에선 빨간 오류가 없다. 빠른 선택을 누르면 휠이 그 시각으로 굴러간다. 지금 바로 상태에선 휠이 가장 이른 시각(5분 단위 올림)을 회색으로 가리킨다. 정하기를 눌러야 반영되고, 끌어 내리기 · 바깥 · Esc 로 닫으면 그대로. 키패드는 뜨지 않는다. 정한 뒤 시간이 흘러 지난 시각이 되면 업무일지 줄 아래에 「지난 시각이에요 · 20:07부터 고를 수 있어요」 · 보내기 흐림. **오늘(도쿄)** 안에서만(23:59 까지, 서버는 1분 뒤 ~ 48시간 안만 받음). 「지금」은 고른 동안 30초마다 다시 잰다. 계산은 `src/lib/report-schedule-time.ts`(테스트 `report-schedule-time.test.ts`). 줄 위아래 구분선 없음(사용자 지시) |
| 버튼 | 왼쪽 회색 「전체 복사」, 오른쪽 보라 = 지금 바로면 「Slack으로 보내기」, 시각이면 「19:00에 보내기」(2026-10-20 순서를 바꿈 — 예전엔 보내기가 왼쪽 회색) |
| 예약됨 | 시트 맨 위 옅은 보라 줄 「오늘 19:00에 Slack으로 보내요」 + 작은 글자 「1시간 12분 남음 · 창을 닫아도 서버가 보내요」 + **시각 바꾸기**(시각 시트가 바로 열림) · **예약 취소**(2차) — 예전엔 「· 예약 취소」만, 버튼은 「19:00 예약됨」(눌리지 않음). **그 순간의 본문을 저장해 그대로 보낸다** — 다시 열면 예약해 둔 본문이 보인다 |
| 예약 뒤 수정 | 본문 · 항목 · 시각을 바꾸면 「바뀐 내용은 아직 예약에 반영되지 않았어요」 + 버튼 「바뀐 내용으로 예약」. 「지금 바로」로 바꾸고 누르면 예약을 취소하고 바로 보낸다 |
| 예약 취소 | 확인 창 없이 바로 취소 + 「19:00 예약을 취소했어요 · 되돌리기」(PC 는 콘솔의 되돌리기 토스트, 모바일은 시트 한 줄) — 되돌리기는 같은 본문 · 시각으로 다시 예약(그 사이 시각이 지났으면 이유를 보여 줌). 「꾹 확정은 드문 결정만」 규칙 |
| 결과 | 시트 한 줄 「19:00에 Slack으로 보냈어요」 / 「19:00 예약을 보내지 못했어요 · 이유」(Slack 설정 없음 · 권한 없음 · 그 밖). 투두 「완료 · 기록」 날짜 줄의 「업무일지」 앞에 「19:00 예약」(옅은 보라) · 「19:00 보냄」(회색) · 「보내지 못함」(빨강) |
| 앱 알림 | 붙이지 않았다 — 「알림은 개발 막바지에 전 기능 일괄」 규칙. 시안 ⑦ 보드에 적어 둠 |
| PC 콘솔 (2026-10-20, 시안 https://claude.ai/artifact/N2XxQQtMQZA3NQqgBsHVBD) | 가운데 업무일지 창의 **아래 한 줄**: 왼쪽 「🕒 보낼 시각 · 지금 바로 ⌄」 칩(시각을 고르면 옅은 보라 「오늘 19:00」), 오른쪽 「전체 복사」(회색) · 보내기(보라). 「닫기」 글자 버튼은 뺐다 — 위 X · Esc · 바깥 누르기. 칩을 누르면 **칩 위로 작은 창**(340 폭) — **3차(시안 P1): 칸 하나 + 목록**(`src/components/tasks/report-time-combo.tsx`, 구글 캘린더 방식). 목록 = 「지금 바로」 + 지금부터 15분 간격(줄마다 「25분 뒤」, 고른 시각이 15분 칸이 아니면 제자리에 끼워 보임). 열리면 칸에 커서(전체 선택). **치기**: 「1837」 「18:37」 「6시 반」 「6時37分」 「午後6時」 「6:30 pm」 「30분 뒤」 「+45」 「1時間後」 … 아무렇게나 → 맨 위에 알아들은 시각(칸 오른쪽 「→ 18:37」), 아래에 같은 시간대 15분 칸. 오전/오후 표시가 없고 1~11시가 이미 지났으면 오후로 본다. 지난 시각을 치면 칸 테두리만 빨강 + 「지난 시각」, 맨 위가 「20:07 가장 이른 시각」. ↑↓ 목록 이동 · **Enter = 고른 줄로 바로 예약**(「지금 바로」 줄은 고르기만) · **클릭 = 고르기**(창 닫힘, 보내기는 아래 버튼) · Esc 는 작은 창부터 닫는다(화면에 키 안내 글은 넣지 않는다 — 사용자 결정). 고른 시각이 지나면 창 안 한 줄 「지난 시각이에요 · …부터」. 2차의 빠른 선택 칩 6개 · 「직접 입력」 칸은 없앴다(목록이 남은 시간을 보여 주므로). 관리자 공용 `AdminTimePicker`(시 · 분 두 열, 제약 없음)와는 다르다 — 「지금부터 · 남은 시간 · 아무렇게나 치기」가 필요한 이 창 전용. 예약됨 줄(제목 아래) · 「19:00 예약됨」/「바뀐 내용으로 예약」 · 결과 한 줄 · 「완료 · 기록」 날짜 줄 표시는 모바일과 같다. 지금 보내기 · 예약 · 취소 결과는 콘솔 토스트, 실패 · 바뀐 내용 · 예약이 보냄/못 보냄은 창 안 한 줄. 같은 서버 액션(`report-schedule-actions.ts` — `/admin/tasks` 도 다시 그린다), 시각 계산은 `src/lib/report-schedule-time.ts` 를 모바일과 같이 쓴다. 문구 `admin-tasks-i18n.ts` `rptWhen*`(3차: `rptWhenInput` · `rptWhenPlaceholder` · `rptWhenEarliestItem` · `rptWhenPast` · `rptWhenNoMatch` 새로, 칩 · 칸 문구는 뺌) · `rptDur*` · `rptSchedule*` · `rptList*`(ko/ja/en, 모바일은 `tasks.reportWhen*` — 3차: `reportWhenAsk` · `reportWhenApply` · `reportWhenApplyNow` 새로, `reportWhenManual` · `reportWhenGroup` · `reportWhen{Hour,Minute}{Up,Down}` 뺌 · `reportDur*` · `reportSchedule*`). |

서버:
- 표 `task_report_schedules`(마이그레이션 `202610200005`) — 본인만 읽기(RLS), 쓰기는 서버(service role). **표 권한(GRANT)은 `202610200006`** — 0005 가 빠뜨려 첫날 예약이 `permission denied` 로 저장되지 않고 「Slack으로 보내지 못했습니다」가 떴다(2026-10-20 수정).
  새 표를 만들 땐 `grant all … to service_role` · 필요하면 `grant select … to authenticated` 를 같이 적는다 — 이 프로젝트는 기본 권한으로 DML 이 붙지 않는다. 한 사람 · 한 날짜에 살아 있는 예약 하나(부분 유니크) —
  다시 예약하면 이전 것을 취소하고 새로 넣는다. 액션 `src/actions/task-report-schedule.ts`(`scheduleDailyReport` · `cancelDailyReportSchedule` ·
  `getReportSchedule` · `listReportSchedules`). 예약할 때 권한 · 빈 일지는 지금 보내기와 같은 판정(`generateDailyReport`).
- 보내기: pg_cron 이 **매 분** `task_report_tick_if_needed()` — 보낼 때가 된 예약이 있을 때만 pg_net 으로 `/api/tasks/report-tick`(토큰은 Vault
  `task_report_tick_token`, 주소 `task_report_tick_url`). 라우트는 `claim_due_task_report_schedules`(원자적으로 'sending', `for update skip locked`)로 가져가
  **보내기 직전에 권한을 다시 보고**(`canSendDailyReport` — 퇴사 · 비활성 · 역할 변경) Slack 으로 보낸다. 'sending' 에서 10분 넘게 멈춘 것은 다시 보내지 않고
  실패(stuck) — 두 번 나가는 것보다 「못 보냄」이 낫다. Slack 보내기 본체는 지금 보내기와 같은 `src/lib/daily-report-slack.ts`. 감사 기록 `scheduled: true`.
  **2026-10-29** 「지금 보내기」도 '보내는 중'으로 잡을 때 `claimed_at` 을 적는다(전엔 안 적어서 도중에 멈추면 영영 안 풀리고 그 날짜가 계속 「보내는 중」으로 막혔다).
  예약 · 지금 보내기는 시작할 때 그 날짜의 10분 넘은 '보내는 중'을 먼저 실패(stuck)로 푼다 — 틱이 돌지 않아도 막히지 않는다(`claimed_at` 없는 옛 행은 `updated_at` 기준, `src/lib/task-report-stuck.ts`).

## Daily Report (업무일지) — as-built (2026-06-13)

Each day-group header in the **Completed (완료/기록)** tab has a **보고서 (Report)** button that opens
the **ReportSheet** bottom sheet:

- It gathers the **caller's own** completions for that Tokyo date and builds a Korean daily work
  report ("업무일지") — a date header followed by one bullet per completed item.
- **Recurring completions are included (fix 2026-07-29).** Because completing a recurring task rolls
  the row forward and keeps it `open` (never `status=completed`), the report is built from the
  `completed`/`reopened` events in **`task_updates`** (not `tasks.status`): the per-task net
  (`completed − reopened`) for that day. This captures a recurring task's daily completion (e.g. a
  daily cleaning check) — which the old `status=completed` query missed — and a same-day undo cancels
  out (net 0 → excluded). Titles are de-duplicated. The dashboard console report
  (`generateConsoleReport`) delegates here, so both surfaces behave identically.
- **Free, no AI.** The report is template-based with a deterministic local tidy-up (whitespace,
  leading bullet glyphs, punctuation spacing) for light auto-correction — no LLM, no API key, no
  per-use cost. (An LLM-backed variant was prototyped then dropped; see the decision log.)
- **Pick which items go in (2026-08-03).** Above the text body the sheet lists every completed item
  with a checkbox — **all checked by default**, so excluding is the exception. Unchecking an item
  removes it from the body and **renumbers the rest**; the total line follows the selection. A
  header shows "8개 중 6개" with a **전체 선택 / 전체 해제** toggle. This exists because a work log may
  contain items a staff member does not want to send to the whole company; before this, the only way
  to drop one was to delete the line in the textarea and fix the numbering by hand.
  - With **nothing selected** the body is empty and both 복사 / Slack 전송 are disabled — an empty
    report can never be sent.
  - Manual textarea edits are kept, but **changing the selection rebuilds the body** (it has to —
    numbering and the total are derived). The hint line under the box says so as soon as the text
    has been edited by hand. In the console, **"원본으로"** resets the selection along with the text,
    so the checkboxes never disagree with what would actually be sent.
  - The same picker exists on **both surfaces** — mobile `ReportSheet` and the admin console's
    report modal — sharing one assembly function, so numbering and the summary line cannot drift.
- **Field activity is folded in automatically (2026-08-04).** Work finished outside the todo feature —
  cleaning, maintenance, linen returns, supply orders — appears under a second **■ 현장 활동** section
  and in the **Completed (완료/기록)** tab, without creating any `tasks` row. See "Field Activity"
  below for the rules.
- The result is shown in an **editable textarea** and can be copied to the clipboard or manually sent
  to the one configured Slack daily-report channel. The send control keeps its label on one line even
  on a narrow screen. Slack receives the textarea body unchanged, so the
  existing report format and the author's final edits are preserved. The message already contains the
  report's author line; no Slack-user account matching is required.
- **Send failures are now visible and diagnosable (2026-08-04).** Two problems compounded into
  "mobile can't send to Slack": (1) the result was an 11.5px muted line that was easy to miss —
  the console shows a toast, mobile said nothing loud — so even a *successful* send read as
  "nothing happened"; (2) `forbidden` / `empty` were folded into the generic "try again" message, so
  the real cause never reached the user. The banner is now colour-split (success vs failure, with an
  icon) and every reason has its own copy in ko/ja/en. Server side, `sendDailyReportToSlack` logs the
  blocking reason and Slack's own rejection body — the action returns a result object instead of
  throwing, so nothing was landing in Vercel's runtime **error** log (the same lesson as the mobile
  cleaning actions). The webhook URL is never logged.
- **The audit write was silently failing (fixed 2026-08-05).** `audit_logs.target_id` is a **uuid**
  column, but the insert passed `` `${userId}:${day}` `` — Postgres rejected every row. supabase-js
  returns `{ error }` instead of throwing, and the result was never checked, so the whole audit trail
  for Slack sends did not exist (0 rows, confirmed against the live DB). A daily report is not a table
  row, so `target_id` is now `null` and the date stays in `metadata`; the insert error is logged
  instead of swallowed. Every other `audit_logs` write in the repo passes a real row uuid — this was
  the only offender.
- Sending uses the server-only `SLACK_DAILY_REPORT_WEBHOOK_URL` Incoming Webhook. It is never exposed
  to the browser. The same report-generation permission is rechecked server-side before every send;
  delivery succeeds only after Slack accepts the request. Successful sends write an `audit_logs`
  `task_daily_report_slack_sent` event containing the sender, Tokyo report date and character count
  (never the report body or webhook URL).
- **Permission — staff-only.** Generation is allowed when the role is anything except
  `part_time_staff`, OR the user has an individually-granted `profiles.can_generate_report = true`
  override (the flag exists for the few part-timers who work in a management capacity; regular staff
  never need it). A non-permitted caller sees a **"권한 없음"** popup inside the sheet. The check is
  enforced server-side, not just in the UI.

See `docs/planning/01-decision-log.md` (2026-06-13) for the free-template decision.

## Field Activity (현장 활동) — as-built (2026-08-04)

Finishing a job on another screen now shows up in the todo **Completed (완료/기록)** tab and in the
daily report, so a staff member's log reflects the whole day — not only the items they typed in
themselves. Source: `src/lib/field-activity.ts` (`getFieldActivities`), shared by mobile and console.

**No `tasks` rows are created.** The union happens at read time. Auto-generating task rows was
rejected because it would (a) fill 오늘/내일/관리함 with items the user never added, (b) put records
that have no undo contract inside `tasks`, which does have one (soft delete + 실행 취소), and
(c) require a second copy to be fixed whenever the original record is corrected — the same
duplicate-source hazard that once caused overdue tasks to be hard-deleted.

**Only unambiguous completions count.** Starting, reporting, or filing is not completing:

| Source | Counted when | Line |
| --- | --- | --- |
| `cleaning_sessions` | `status = completed`, `staff_user_id` = viewer | `아라키초A 201 청소 완료` |
| `maintenance_reports` | `status = closed`, `completed_by` = viewer | `아라키초A 201 유지보수 완료` |
| `linen_return_records` | registered (`registered_at`) | `린넨 반품처리 및 등록 완료` |
| `order_requests` | request filed (`created_at`) | `재고조사 및 주문요청 처리 완료` |

Lost & found is deliberately excluded. Attendance is excluded — it is not work output, and the
report can be posted to a shared Slack channel.

Rules:

- **Linen and orders collapse to one line per day** no matter how many times they happened; the point
  is that it was done, not how often. Cleaning and maintenance are per-room, so they stay separate.
- Room labels reuse the cleaning canonical form, so the two surfaces never print a room differently.
  Stored session labels keep the Arakicho sub-listing suffix for matching, so display goes through
  `getDisplaySessionRoomLabel()` ("아라키초A 501_2" → "아라키초A 501").
- The rows are **read-only** — no complete toggle, no undo, no long-press menu. The record lives on
  the cleaning / maintenance screen; letting it be reverted from two places would make it unclear
  which surface is authoritative.
- They are **hidden while a filter is active** (search, tag, priority, or the 일반/프로젝트 pills).
  Those filters test task attributes that field activity does not have, so leaving the rows in would
  read as a broken filter.
- A day group is created from the **union** of both sources — a day with only cleaning still gets a
  group, and the daily report is no longer `empty` when the user completed field work but no todos.
- Included in the report by default and **uncheckable** through the item picker, so anything a staff
  member does not want to post can be dropped before copying or sending.

## Swipe Actions

As-built (2026-06-12) — one move action per view, revealed by a card-body left-swipe:

- **Today** → "내일로" (defer to tomorrow)
- **Tomorrow / Inbox** → "오늘로" (pull to today)
- **Sent / Calendar lists** → swipe disabled

The action returns the user to the tab they swiped from. Full semantics live in the
"Today / Tomorrow tabs, swipe + drag-reorder" section above.

Possible later additions:

- date change
- share

Do not prioritize destructive swipe-delete.

## Search / Filters

First-slice required search/filter axes:

- title
- author name
- date

As-built (2026-06-11): a single lightweight search/filter bar sits below the view chips on the list
views (Today / Tomorrow / Inbox / Sent). One shared filter state is reused across those
views and persists across tab switches.

- **Text search** — one field matching task **title** and **author name** (case-insensitive partial).
- **Date filter** — a toggle button opens a compact block with a **Single / Range** mode. Single
  matches tasks whose anchor date equals the chosen date; Range matches anchor date within
  start/end (either side may be left open). The anchor date is the existing one (due date wins over
  scheduled date, Tokyo operating date) — the same value used for grouping, listing, and the
  calendar. Dateless tasks never match an active date filter.
- **Active state** — when any filter is active, a "Filters" row shows the search term and/or date
  chip plus a one-tap **Clear**. The date button also carries a small dot when a date filter is set.
- **Empty vs no-result** — a view that is genuinely empty keeps its own empty state; a view that has
  tasks but matches none shows a distinct "no matching tasks" state with a Clear action.
- **Scope** — the **Calendar** view does not show the bar (it already navigates by date).
- Filtering is **client-side** over the already-loaded, org-scoped task set; it changes nothing about
  permissions, visibility, ownership, or shared state.

Not required in first slice (still deferred):

- body search
- status filter as a primary search surface
- priority filter as a core search surface
- tag search as a first-slice requirement
- participant-name search as a first-slice requirement

## Entry Points

Tasks can be created from:

- Todo/Task feature entry itself
- quick add
- calendar date
- reservation/guest/property context where practical

And new-task entry should be available from:

- Today
- Tomorrow
- Inbox
- Sent By Me
- Calendar

## Empty-State Tone

Use a clear but slightly supportive operational tone.

Not too dry, not chatty.

Example direction:

- no tasks today
- inbox is clear
- add a task or organize existing items

## Mobile-Only First Slice

This task system should be designed for mobile first.

Admin web was initially deferred until the mobile feature set matured. The mobile Todoist and the
dashboard console are now implemented; see `docs/product/28-admin-todoist-console.md`. Both surfaces
reuse the same DB and domain actions (no separate sync layer), with the dashboard also supporting the
manager Work Directive flow.

## Suggested First Design Slice

Design in this order:

1. Today
2. Tomorrow
3. Inbox
4. Sent By Me
5. Calendar
6. quick add
7. detailed create / edit
8. task detail
9. participant picker / share flow

## Verification Focus For Future Implementation

- private task visibility is preserved
- only original author edits core fields
- participants can update the shared update-log
- original-author leave = full delete
- participant self-remove = disappear only for self
- shared Inbox behavior is consistent for all participants
- calendar stays separate from reservation calendar
- ko/ja/en strings exist

## 2026-07-30 진행 중(in_progress) 상태 — 모바일 지원

**문제.** 상태 모델은 원래 3개(`open` / `in_progress` / `completed`)인데, 모바일에는
`completeTask` / `reopenTask` 두 액션뿐이라 **진행 중을 설정할 수단이 없었다.**
`task-detail-view.tsx`는 값을 **읽어서 표시만** 하고 있었고, 목록 카드에는 표시조차 없어 대기 상태와
구분되지 않았다. 어드민 콘솔은 3상태 세그먼트를 이미 쓰고 있어서, 관리자가 "진행 중"으로 바꾼 작업이
현장에서는 그냥 대기로 보였다 — 같은 데이터를 한쪽에서만 다룰 수 있는 상태였다.

**해결.**

- **서버**: `setTaskProgress(taskId, inProgress)` 신규 (`src/app/mobile/tasks/[id]/actions.ts`).
  `open ↔ in_progress` 만 다루고, 완료 전환은 기존 `completeTask` 가 계속 맡는다 — 완료는 반복
  회차(occurrence) 처리와 알림이 얽혀 있어 경로를 나누는 편이 안전하다. 이 액션으로 완료 상태가
  되살아나지 않도록 완료 스탬프(`completed_at` / `completed_by_user_id`)도 함께 지운다.
  `task_updates` 에 `status_changed` 로그를 남기는 것도 콘솔과 동일하다.
- **상세 화면**: 완료 버튼 위에 `대기 / 진행 중` 2칸 세그먼트. **완료 상태에서는 숨긴다** —
  그때 필요한 동작은 "다시 열기"가 먼저다. 완료는 계속 아래 전용 버튼이 맡으므로 콘솔의 3칸
  세그먼트와 모양은 다르지만 상태 모델은 같다.
- **목록 카드**: `진행 중` 칩 추가(primary 톤). 이게 없으면 목록에서 대기와 완전히 동일하게 보인다.

**i18n**: `tasks.statusOpen` / `tasks.statusInProgress` 는 ko·ja·en 모두 이미 존재해 재사용했다.

**남은 격차**: 관리함 드래그 정렬은 이제 콘솔에도 있다(2026-07-30). 프로젝트 섹션·멤버 관리 등 일부는
여전히 모바일 전용일 수 있으니 콘솔 문서(28)를 함께 참고.
관리자가 프로젝트를 구성하는 화면인데 섹션·멤버를 만질 수 없는 건 어색하므로 별도 슬라이스로 다룬다.

## 2026-07-30 반복 회차 중복 이동 차단

**요구.** 반복 작업의 오늘 회차를 내일로 옮기려는데 **내일에도 이미 그 반복의 회차가 있으면**,
안내 문구를 띄우고 이동을 거절한다.

단일 행 모델이라 옮겨도 행이 늘지는 않지만, 사용자 눈에는 "내일에도 이미 있는 그 작업"을 또 내일로
미는 것이라 의미가 없다 — 실제로 아무것도 바뀌지 않는다.

**판정은 한 곳.** `canMoveRecurringTo(rule, anchor, targetDate)`
(`src/lib/tasks-recurrence.ts`) — 대상 날짜에 회차가 있으면 `false`. 비반복 작업, 앵커 없는 작업,
그리고 앵커와 같은 날짜(애초에 no-op)는 항상 허용한다. 두 표면이 각자 판정하면 어긋나므로 공용
모듈에 둔다.

**적용 지점 (4개)**

| 표면 | 액션 | 거절 방식 |
| --- | --- | --- |
| 어드민 | `moveConsoleToToday` / `moveConsoleToTomorrow` | `{ ok:false, error:"duplicate_occurrence" }` → 토스트 |
| 모바일 | `moveTaskToToday` / `moveTaskToTomorrow` (스와이프) | `?moveError=duplicate_occurrence` 로 리다이렉트 → 목록 토스트 |

모바일 스와이프는 form POST + `redirect` 구조라 결과를 돌려줄 수 없어 쿼리로 전달한다. 목록이
읽어서 한 번만 띄우고 `history.replaceState` 로 URL을 정리한다 — 새로고침 시 안내가 다시 뜨면 안 된다.

**범위 밖.** 일정 변경 팝오버(`rescheduleConsoleTask`)로 임의 날짜를 고르는 경로는 막지 않는다.
그쪽은 사용자가 날짜를 직접 보고 고르는 흐름이라 실수로 겹칠 여지가 작고, 의도적으로 겹치게 두려는
경우까지 막게 된다.

**i18n**: `tasks.moveDuplicateOccurrence`, `adminTasks.errDuplicateOccurrence` (ko·ja·en).

## 2026-07-30 지시(받은/보낸) — 모바일 반영

관리 콘솔에만 있던 **받은 지시 / 보낸 지시**를 모바일에도 넣었다. 탭을 늘리지 않고 기존
**공유함(`sent`) 탭을 지시(`instr`) 탭으로 재구성**했다 — 7탭 유지.

### IA

- 탭 라벨: `지시` / `指示` / `Directives`. 탭 **배지 = 미확인(=`status open`) 받은 지시 건수** —
  탭을 열지 않아도 밀린 지시가 보인다.
- 탭 안에 **받은 지시 / 보낸 지시** 세그먼트 컨트롤(Bell / Megaphone + 카운트 배지).
  시각 규격은 이미 쓰고 있는 건의함 세그먼트(`suggestions.css` `.seg`/`.seg__b`)와 같다:
  슬레이트 트랙 + 흰 알약 + 활성 시 네이비 카운트.
- **받은 지시는 오늘 / 내일 / 관리함에도 그대로 보인다.** 지시 탭은 *모아보기* 역할이다.
- **내가 보낸 지시는 내 일정 뷰(오늘·내일·관리함·캘린더·기록)에서 빠진다** — 대상자의 일정이기
  때문이며, 관리 콘솔 `myOwn` 과 같은 규칙이다. 진행 상황은 `지시 › 보낸 지시`에서만 본다.

### 상태 그룹 (콘솔 `recvView`/`sentView` 와 동일 순서)

| | 그룹 |
| --- | --- |
| 받은 지시 | 지연 → 해야 할 지시(open) → 진행 중 → 완료 |
| 보낸 지시 | 미확인 · 대기(open) → 진행 중 → 완료 |

지연은 받은 지시에서만 따로 뽑는다(보낸 쪽의 지연은 대상자가 처리할 몫이라 상태로만 표시).
반복 작업은 기존 `isOverdue` 규약대로 지연 판정에서 빠진다.

### 카드

공용 `TaskCard` 를 그대로 쓰고 `instrMode="recv" | "sent"` 만 추가했다.

- `recv` — 지시자를 **이니셜 아바타 + 이름 칩**으로 칩 줄 맨 앞에 올린다(기존 `이름 →` 접두사 대체).
- `sent` — **담당 {n}명** 칩. 체크 원을 **렌더하지 않는다**(`onCompleteToggle` 미전달): 지시자가
  대상자의 작업을 대신 완료 처리하지 않는다. 스와이프도 끈다.

### 담당자별 진행률은 없다 (2026-07-30 확인)

`task_participants` 에는 **담당자별 완료 상태가 없다** — 완료는 작업 1건당
하나(`status` / `completed_at` / `completed_by_user_id`)다. 따라서 "2 / 3 완료" 같은 담당자별
진행률 바는 현재 데이터 모델로 만들 수 없고, 보낸 지시 카드는 **담당 인원 수 + 작업 상태**만
보여준다(콘솔 `sentView` 와 동일). 담당자별 진행이 필요해지면 `task_participants.completed_at`
추가 + 완료 의미 변경이라는 **별도 결정**이 필요하다.

### 구현 메모

- 지시 판별 술어(`sentInstr` / `recvInstr` / `myOwn` / `partsOf` / `isMine`)는
  **`src/lib/task-directives.ts` 한 곳**에 두고 `src/components/admin/tasks/helpers.ts` 는
  재수출만 한다. 모바일·콘솔에 같은 규칙을 복사하면 이 저장소가 이미 한 번 데인 쌍둥이 파일
  문제(`tasks.ts` / `tasks-recurrence.ts`)를 되풀이한다.
- 뷰 키 `sent` → `instr`. 예전 링크·되돌아오기 쿼리의 `?view=sent` 는 `page.tsx` 에서 조용히
  `instr` 로 넘긴다(`LIST_VIEWS` 도 두 키를 모두 받는다).
- **peer 공유 전용 목록은 모바일에서 사라졌다.** 내가 공유한(지시가 아닌) 작업은 여전히 내
  작업이므로 오늘/내일/관리함에 그대로 보인다 — 다만 "공유한 것만 모아 보는" 화면은 없다.
  콘솔에는 공유함 탭이 그대로 남아 있다.
- i18n: `dict.tasks.viewInstr / instrRecv / instrSent / instrRecvNote / instrSentNote /
  instrSec* / instrUnconfirmed / instrBy / instrAssigned / instrEmpty*`(ko·ja·en). 문구는
  콘솔(`admin-tasks-i18n.ts`)과 같은 표현을 쓴다. 로그 라벨 `system_shared` 가 탭 이름
  `viewSent` 를 빌려 쓰고 있어 전용 키 `logShared` 로 분리했다.

## 2026-07-30 반복 회차 건너뛰기 — "이 날짜만" vs "반복 전체"

**문제.** 오늘/내일 화면의 반복 카드를 길게 눌러 삭제하면 `tasks` 행이 지워져 **모든 날짜에서**
사라졌다. "오늘만 못 한다"(공실·휴무 등)를 표현할 수단이 없어, 사용자가 한 회차를 넘기려고
시리즈 전체를 날리게 되는 구조였다.

**해결(A안).** 반복 작업을 **회차로 보고 있을 때** 삭제를 누르면 확인 모달 대신 선택 시트를 띄운다.

```
반복되는 작업입니다
  ⏭  7/30 (목)만 건너뛰기 — 이 날짜만 넘어가고 반복은 계속됩니다
  🗑  반복 전체 삭제        — 모든 날짜에서 사라집니다
      취소
```

- **일회성 작업은 그대로** 기존 확인 모달을 쓴다.
- **관리함처럼 회차가 아닌 목록**에서는 행 자체가 시리즈를 뜻하므로 역시 기존 모달 그대로다.
  시트는 `occurrence` 로 렌더된 카드에서만 뜬다.

### 저장

새 테이블 없음. 기존 `task_occurrence_state` 에 `state='skipped'` 행을 하나 넣는다 — 오버듀 회차
정리에 이미 쓰던 그 상태다. 지금까지 **오늘/내일 회차에만 배선이 없었을 뿐**이다.

- `skipOccurrenceOn(taskId, occurrenceDate)` — 그 회차만 `skipped`
- `unskipOccurrenceOn(taskId, occurrenceDate)` — 되돌리기(`clearOccurrenceState`)

두 액션 모두 날짜를 **클라이언트에서 믿지 않고** 반복 규칙에서 다시 계산해 실제 회차인지 확인한다
(`isOccurrenceDate`). 아니면 조용히 무시한다 — 임의 날짜로 상태 행을 심을 수 없다.

### 되돌리기

`skipped` 는 영구 상태(*kept forever, never re-appears*)이므로 건너뛴 직후
**"{날짜} 건너뜀 · 실행 취소" 토스트**를 6초간 띄운다. 되돌릴 수 있으므로 별도 확인 모달은 두지
않는다(CLAUDE.md — 확인 UX는 되돌릴 수 없는 파괴적 동작에만).

되돌리기의 한계: 회차 상태는 한 칸뿐이라 종류별 삭제가 불가능하다. 토스트가 떠 있는 사이 같은
회차가 완료 처리되면 실행 취소가 그 완료까지 푼다(실무상 6초 안에 겹칠 일은 거의 없다).

### 같이 고친 버그 — 상태 있는 회차가 목록에 남던 문제

모바일·콘솔 모두 회차 필터가 `state !== "completed"` 였다. **상태 행이 있으면 그 회차는 해결된
것**(completed · skipped · moved)이므로 `!state` 로 바꿨다. 이걸 안 고치면 건너뛴 회차가 목록에
그대로 남는다. 콘솔은 주석에 이미 "완료·스킵·이동된 회차 제외"라고 적혀 있었는데 코드가 따라가지
못한 상태였고, 이제 `outstandingOverdueOccurrences` 의 "행이 있으면 해결" 규약과도 일치한다.

### 관리 콘솔도 동일 (2026-07-30)

`/admin/tasks` 의 행 메뉴 삭제도 같은 규칙을 따른다. 오늘/내일 목록의 반복 행은 `⋯` 메뉴가 회차
날짜(`RowMenuPop.occ`)를 함께 들고 열리고, 삭제를 누르면 `RecurDeleteModal` 이 뜬다 —
`이 날짜만 건너뛰기` / `반복 전체 삭제`. 서버는 `skipConsoleOccurrence` /
`unskipConsoleOccurrence` 로 모바일과 같은 `task_occurrence_state` 를 쓰고, 같은 방식으로 날짜를
규칙에서 재검증한다.

회차 정보가 없는 두 곳은 시리즈 삭제를 유지한다.

- **관리 콘솔 상세 패널** — 패널은 회차 날짜를 들고 있지 않고 작업 전체를 보여주므로 시리즈 삭제다.
- **관리함 등 회차가 아닌 목록** — 행이 곧 시리즈다. 기존 즉시 삭제 + 실행 취소 그대로.

### 모바일 상세 화면도 회차 문맥 유지 (2026-08-07)

오늘·내일처럼 반복 작업의 특정 회차 카드에서 모바일 상세로 들어가면 카드가
`?occurrence=YYYY-MM-DD&view=<source>` 를 전달한다. 상세 페이지는 이 날짜를 그대로 믿지 않고
반복 규칙과 앵커로 실제 회차인지 다시 검증한 뒤 `TaskDetailView` 에 넘긴다.

검증된 회차에서 삭제를 누르면 상세 화면도 관리 콘솔 행 메뉴와 같은 두 선택지를 보여준다.

- `{date}만 건너뛰기` → 기존 `skipOccurrenceOn` 으로 해당 회차만 `skipped`
- `반복 전체 삭제` → 기존 `deleteTask` 로 시리즈 소프트 삭제

건너뛰기 뒤에는 원래 목록으로 돌아가 6초 실행 취소 토스트를 이어서 보여준다. 직접 URL로 잘못된
날짜를 넣었거나 관리함처럼 회차 문맥 없이 상세를 연 경우에는 기존 전체 삭제 확인만 노출한다.

### 2026-10-28 「건너뛴 날」 — 건너뛴 회차 되살리기

건너뛰기 토스트는 6초 뒤 사라져서, 놓친 뒤에는 되돌릴 길이 없었다. 반복 업무 상세(모바일 `TaskDetailView` —
폰 · 폴드 · 태블릿 분할 창 공용, PC 콘솔 오른쪽 상세 패널)에 **「건너뛴 날」 구역**을 둔다.

- 보이는 것: 최근 30일(도쿄 날짜, 오늘 포함 · 미래 제외)에 `skipped` 로 기록된 회차를 최신순으로. 처음 5줄, 나머지는 보라
  글자 「{count}개 더 보기」(영어는 「Show 1 more」 / 「Show {count} more」). 머리 줄은 왼쪽 「건너뛴 날」, 오른쪽 작은 회색 「최근 30일」.
  반복 업무가 아니거나 건너뛴 날이 없으면 구역을 그리지 않는다.
- 줄: 날짜(예 「10월 26일 (월)」, 언어별 표기) + 보라 글자 「되살리기」(모바일 탭 높이 44px). 흰 바탕 · 0.5px 구분선 · 상자 없음.
- 되살리기: 줄이 서버를 기다리지 않고 바로 접히고(`.row-collapse` + `data-leaving`) 실패하면 다시 펴진다. 성공하면 햅틱 `success`,
  실패는 `error`. 토스트 「{날짜}을 되살렸어요」 + 「다시 건너뛰기」(기존 건너뛰기 액션으로 다시 건너뜀). 되살린 과거 날짜는
  목록에 «밀림» 으로 다시 나타난다(서버 액션 revalidate).
- 권한: 건너뛸 수 있는 사람이면 누구나(건너뛰기 액션과 같은 검사).
- 서버 가드: `clearSkippedOccurrenceState` — `state = 'skipped'` 일 때만 지운다. 토스트 «실행 취소» 도 같은 함수를 쓰므로,
  그 사이 같은 회차가 완료됐다면 완료를 풀지 않는다.
- 선택 로직은 순수 함수 `selectRecentSkippedDays` (`src/lib/task-skipped-days.ts`, 테스트 `task-skipped-days.test.ts`).

모바일 작업 상세의 `…` 옵션 메뉴는 메뉴와 트리거 바깥을 누르면 즉시 닫힌다. 바깥 화면의 원래
동작은 막지 않으며, 키보드 사용 시 `Escape` 로도 닫을 수 있다.

모달 크롬은 콘솔 규격(`day-scrim` + `pop`)을 그대로 쓰고, 두 선택지는 `.rcopt` 카드로 같은 크기로
놓되 되돌릴 수 없는 쪽(전체 삭제)만 danger 톤을 준다.

## 2026-07-31 지시 보내기 — 두 화면 모두 진입점 추가

지시를 **볼** 수는 있는데 **보낼** 수단이 화면마다 빠져 있었다. "보낸 지시" 탭이 빈 상태에서
"작업을 만들 때 대상을 지정하면…"이라고 안내만 하고, 정작 거기서 만들 수는 없었다.

### 관리 콘솔

`보낸 지시` 뷰(목록·빈 상태 둘 다)에 인라인 **지시 보내기** 트리거를 넣었다.

- `AddDraft.ctx` 에 `"instr"` 추가. 기존 인라인 추가 폼을 그대로 쓰므로 새 UI가 없다 —
  그 폼에는 이미 **대상(지시) 칩**(`openSharePop(…, "target")`)이 있다.
- **날짜 기본값 = 오늘.** 날짜 없는 지시는 대상자의 관리함에 묻히기 쉽다(스케줄 칩에서 변경 가능).
- **대상이 없으면 저장 불가.** 대상 없이 저장하면 `is_directive=false` 인 내 개인 작업이 되어
  저장 직후 이 목록에서 사라진다. 저장 버튼을 잠그고 라벨도 `지시 보내기` 로 바꾼다.

### 모바일

모바일에는 **지시를 보낼 경로가 아예 없었다** — 생성 액션이 `is_directive` 를 한 번도 쓰지 않아
모든 공유가 peer 공유로만 저장됐다.

- 상세 생성 폼(`/mobile/tasks/new`)에 **"지시로 보내기" 토글** 추가. 공유 대상을 고른 뒤에만
  노출된다(대상 없는 지시는 성립하지 않는다). 공유(동료끼리 같이 봄)와 지시(대상자가 수행)는 다른
  행위라 한 화면에서 분명히 갈라 준다.
- 서버: `is_directive: directive && shareIds.length > 0` — 콘솔 `createConsoleTask` 와 같은 규칙.
- `지시 › 보낸 지시` 화면 상단에 **지시 보내기** 진입점(→ `/mobile/tasks/new?directive=1`).
  쿼리로 들어오면 토글이 켜진 채 시작하고, **저장된 초안이 그 의도를 덮지 않는다**(초안의 false 는
  무시). 안 그러면 사용자가 눈치채지 못한 채 평범한 공유로 나간다.

### 검증 포인트

지시로 보낸 작업은 **지시자의 오늘/내일/관리함/캘린더에서 빠지고**(`myOwn`) 대상자의 일정에 잡힌다.
보낸 쪽은 `지시 › 보낸 지시`에서만 진행 상황을 본다.

## 2026-07-31 모바일 ↔ 콘솔 불일치 일괄 정리

에이전트 병렬 감사에서 나온 투두 관련 불일치를 정리했다. **기능 결손이 아니라 두 화면이 갈라져
있던 것들**이라 한쪽 기준으로 맞추는 작업이었다.

### 반복 옵션 비대칭 해소

| | 이전 | 지금 |
| --- | --- | --- |
| 모바일 | none · daily · weekly · weekdays · monthly · **yearly** | 6종 + **weekends** |
| 콘솔 | none · daily · weekly · weekdays · **weekends** · monthly | 6종 + **yearly** |

같은 작업을 **어디서 만들었느냐에 따라 선택지가 달랐다.** 양쪽 목록을 같게 맞췄다. 라벨은 두 사전에
이미 있었고(`repeatWeekends` / `repYearly`) 엔진도 `yearly` 를 처음부터 지원했다 —
콘솔 주석의 "yearly 미지원" 은 **틀린 서술**이라 함께 고쳤다.

### 목록 일괄 삭제에 실행 취소 추가 (모바일)

모바일은 **상세에서 지우면** `?deleted=<id>` 로 돌아와 실행 취소 토스트가 떴지만,
**목록에서 여러 개를 지우면** 되돌릴 방법이 없었다. 같은 앱 안에서 삭제 경로에 따라 되돌리기 유무가
갈리던 것.

- `deleteTasksInList` 가 **실제로 지워진 id** 를 돌려준다(`.select("id")`). 목록에서 남의 작업을
  같이 골라도 그건 안 지워지므로, 지우지도 않은 작업을 되살리면 안 된다.
- `restoreTasksInList(ids)` 신설 — 소프트 삭제라 `deleted_at` 만 비우면 복구된다(작성자 본인 한정).
- 클라이언트의 되돌리기 상태를 **id 배열 하나로 일반화**해 상세·목록 두 경로가 같은 토스트를 쓴다.

> `showDeleteUndo` 는 `performDelete` **위에** 선언해야 한다 — 아래에 두면 React Compiler 가
> "Cannot access variable before it is declared" 로 막는다.

### 모바일 실행 취소 토스트 밀도 (2026-08-07)

모바일의 완료·삭제·반복 회차 건너뛰기 실행 취소 토스트는 기존 다크 바 디자인, 하단 위치, 실행 취소
및 닫기 동작을 그대로 유지하되 작은 화면을 과하게 가리지 않도록 패딩·간격·글자·아이콘·버튼 터치
영역을 한 단계 작게 사용한다. 메시지는 한 줄로만 표시하고, 건너뛴 회차 날짜와 반복 완료 후 다음
회차 날짜는 넣지 않는다. 이 밀도 조정은 `/mobile/tasks` 에만 적용하며 관리자 콘솔의 `.undobar`
크기·문구·디자인은 변경하지 않는다.

### 완료 로그 조회 중복 제거

완료 집계(`task_updates` 의 completed − reopened net)가 `src/lib/tasks.ts` 와
`src/lib/admin-tasks.ts` 두 곳에 복사돼 있었다. **콘솔 완료·기록 탭과 모바일 완료·기록/업무일지가
같은 숫자를 보여야 하므로** 갈라지면 곧바로 사용자에게 드러난다. `admin-tasks.ts` 의
`getCompletionRecords` 는 이제 `getTaskCompletions()` 에 **위임만** 하고 콘솔이 쓰는 모양으로
좁힌다.

이 저장소는 반복 규칙을 두 파일에 복사해 뒀다가 정의가 갈리면서 **오버듀 작업이 하드 삭제되는**
사고를 낸 적이 있다. 같은 실수를 반복하지 않기 위한 정리다.

## 2026-09-09 투두 가시 범위 — "각자의 개인 공간" (확정)

### 규칙

투두는 **개인 업무의 공간**이다. 다른 사람의 작업이 내 화면에 들어오는 경로는 **셋뿐**이다.

| 경로 | 근거 |
| --- | --- |
| 공유받은 작업 | `task_participants` 에 내 행이 있다 |
| 받은 지시 (`is_directive`) | 같음 (지시 대상 = 참여자) |
| 내가 속한 프로젝트의 작업 | `project_participants` 에 내 행이 있다 |

그 밖의 남의 작업은 **역할과 무관하게** 보이지 않는다. 최고 관리자도, 플랫폼 개발자 계정도
예외가 아니다 — 조직을 관리할 권한과 남의 개인 할 일을 들여다볼 권한은 다른 것이다.

### 왜 명시하는가 (2026-09-09 발견)

콘솔 「오늘」 목록에 다른 사용자가 혼자 만든 개인 투두가 「작성자 → 제목」 형태로 섞여 있었다.
행 렌더링은 정상이었다(내가 만들지 않은 작업이라 작성자 접두사를 붙인 것). **문제는 그 작업이
애초에 목록에 들어온 것**이었다.

원인은 가시 범위 판정을 **RLS 에만** 맡긴 것이다. `tasks` 의 select 정책은
`is_platform_admin()` 이면 참여자 조건을 통째로 건너뛴다. 그래서 플랫폼 관리자 계정 하나가
조직 전원의 개인 투두를 자기 오늘/내일/관리함/완료·기록에서 보고 있었다.

정책의 관리자 예외는 조직 간 운영·복구용으로 **그대로 둔다.** 대신 투두 화면이 쓰는 읽기
경로를 앱에서 다시 좁혔다 — 조직 격리와 같은 원칙(서버에서 강제, UI 필터에 의존하지 않음).
구현은 `docs/engineering/09-todo-task-technical-design.md` → "가시 범위 게이트" 참고.

### 확인 항목

- 남이 혼자 만든 작업은 오늘·내일·관리함·캘린더·완료·기록 어디에도 없다
- URL 로 남의 작업 id 를 직접 찍어도 상세가 열리지 않는다(«없음»으로 응답)
- 공유·지시·프로젝트 작업은 그대로 보인다
- 비참여 프로젝트는 프로젝트 목록에 없고 id 로도 열리지 않는다

## 2026-09-09 완료·기록 = 내가 한 일 (보낸 지시 제외)

지시를 보낸 사람과 그 일을 한 사람은 다르다. 대상자가 완료해도 **지시자의 완료·기록에는 남지
않는다** — 지시자는 「지시 › 보낸 지시」에서 진행 상황만 본다.

| 작업 | 내 완료·기록에 남는가 |
| --- | --- |
| 내 개인 작업 (내가 완료) | ○ |
| 받은 지시 (내가 완료) | ○ |
| **보낸 지시 (대상자가 완료)** | **✕** |
| 보낸 지시 (내가 직접 완료) | ○ — 내가 한 일이다 |
| 공유(공동 작업, 상대가 완료) | ○ — 둘 다 작업자다 |

이 규칙(`myOwn` — 보낸 지시는 대상자의 일정)은 오늘·내일·관리함·캘린더에 이미 적용돼 있었고,
완료·기록만 빠져 있었다. 2026-07-29 의 "완료·기록은 팀 완료를 표시" 결정은 **지시에 한해서만**
철회된다(공유는 유지). 상세는 `docs/product/28-admin-todoist-console.md` →
"완료·기록에서 보낸 지시 제외".

**업무일지(보고서)는 원래부터 본인 완료만 집계**하므로(`generateDailyReport` —
`created_by_user_id = me`), 이 변경으로 목록과 보고서가 지시 건에 대해 서로 어긋나지 않게 됐다.

## 2026-10-28 모바일 토스트 · 순서 저장 · 초대 실패 · IME 정리

감사에서 나온 빈틈을 한 번에 고쳤다(`/mobile/tasks`, `src/components/tasks/*`).

### 토스트는 한 번에 하나만
- 안내(`moveNotice`, 실패 포함) · 회차 건너뛰기 취소 · 완료 취소 · 삭제 취소는 같은 고정 자리(`.toast-dock`)를
  쓴다. 예전엔 따로 그려져 겹쳤고 아래쪽 「실행 취소」가 가려졌다.
- 이제 토스트가 새로 뜰 때마다 번호표(`toastSeq`)를 올리고, **살아 있는 것 중 가장 최근 것 하나만** 그린다.
  치우면 아직 살아 있는 이전 토스트가 이어서 보인다. 각 토스트의 타이머(안내 4초, 취소류 6초)는 그대로다.

### 실행 취소 범위
- **완료 취소는 한 칸**: 새 완료가 이전 완료 토스트를 대신한다(이전 건은 더 못 되돌린다). 이미 날아간 이전 건의
  되돌리기는 자기 요청을 붙잡고 있어서 새 완료와 섞이지 않는다.
- 삭제 취소는 한 번에 지운 묶음 전체를 되돌린다. 건너뛴 회차의 취소는 6초 안에서만 가능하고, 토스트 밖에는
  되돌리는 화면이 아직 없다(`unskipOccurrenceOn` 은 토스트에서만 부른다 — 열린 항목).

### 순서 저장 실패
- 오늘 · 내일 · 관리함의 줄 끌기와 프로젝트 섹션 끌기는 서버가 `{ ok: false }` 를 돌려주거나 던지면
  **끌기 전 순서로 되돌리고** 실패 안내 토스트 + `error` 햅틱을 낸다(`onPersistError`). 그 사이 서버 목록이
  새로 도착했으면(id 순서가 달라졌으면) 되돌리지 않는다.

### 프로젝트 멤버 초대 실패
- `inviteProjectMembers` 결과가 `ok:false` 이거나 던지면 고르기 시트를 다시 열고 실패 토스트 + `error` 햅틱.
  `success` 햅틱은 서버가 확인한 뒤에만.

### 삭제 · 선택 모드
- 일괄 삭제는 서버가 확인하기 전에 선택 모드를 끝내지 않는다. 실패하면 행이 돌아오고 고른 항목도 그대로
  남아 바로 다시 시도할 수 있다.

### 입력기(IME) 규칙
- 한글 · 일본어 조합 중의 Enter 는 글자 확정이다. Enter 로 제출하는 입력칸(게스트 이름, 태그, 업무일지 시각
  콤보)은 `e.nativeEvent.isComposing` 또는 `keyCode === 229` 이면 제출하지 않는다. 새 Enter 제출 칸도 같다.

### 사진 한도
- 수정 화면에서 기존 사진 + 새 사진이 한도를 넘으면 조용히 자르지 않고 개수 초과 문구(기존
  `requestImages.errorCount` / 프로젝트 작업 `photosCountError20`)를 띄운 채 저장을 멈춘다.

### 2026-10-28 서버 쪽 점검 반영 (업무일지 · 완료 · 복구)

- **지금 보내기**: 모바일 · PC 모두 `sendDailyReportNow` — 먼저 보내고, 성공한 뒤에만 예약을 거둔다. 실패하면 예약이 남는다(전엔 예약을 먼저 지워서 둘 다 잃었다).
- **업무일지 집계**: (할 일, 회차)마다 마지막 기록으로 센다. 누가 다시 열든(내가 아니어도) 완료가 취소된다. 반복 할 일의 완료 · 다시 열기 기록은 회차 날짜를 남긴다.
- **완료 두 번**: 이미 끝난 일회성 할 일 · 이미 완료된 회차를 또 완료하면 기록 · 알림 없이 성공으로 끝난다(두 번 누르기 · 폰과 PC 동시).
- **완료 → 진행 중**: 완료였던 할 일을 진행 중으로 바꾸면 「다시 열기」로 기록해 업무일지에서 빠진다.
- **날짜 · 시각 검사**: 없는 날짜(2026-02-31) · 없는 시각(25:99)은 저장하지 않고 오류로 돌려준다.
- **연결 항목**: 건물 · 객실 · 예약 연결은 같은 조직 것만 저장된다.
- **프로젝트 삭제**: 할 일 사진을 저장소에서도 지운다(다른 할 일이 쓰는 사진은 남김). 업데이트 기록 사진은 아직 남는다(후속).
- **결정 대기(동작 그대로)**: 「받은편지함」 뜻이 모바일(표시만) · PC(프로젝트에서 떼기)에서 다름, 프로젝트에서 빠진 사람이 자기가 쓴 프로젝트 할 일을 계속 봄, 건너뛴 회차를 토스트 6초가 지나면 되돌릴 곳이 없음.

### 2026-10-29 상세 · 새 할 일 · 수정 — 폴드 · 태블릿 폭

- 폴드(≥ 600px)와 태블릿에서 할 일 상세(`/mobile/tasks/[id]`) · 새 할 일(`/mobile/tasks/new`) · 수정(`/mobile/tasks/[id]/edit`)을
  **화면으로 열면** 셸의 760px 대체 폭 대신 **가운데 540px 한 줄**로 그린다(버그 신고 · 제안함과 같은 폭).
- 태블릿 가로에서 목록 줄을 눌러 **칸에 열린 상세 · 수정**(`html[data-pane]`)은 칸 폭을 그대로 쓴다 — 바뀐 것 없음.
- 폰(< 600px)은 그대로. CSS 한 곳: `src/components/tasks/tasks-white.css` 「폴드 · 태블릿 — 상세 · 새 할 일 · 수정」.
