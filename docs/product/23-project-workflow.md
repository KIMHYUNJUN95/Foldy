# 23. 프로젝트(Project) 워크플로우

> **상태 (2026-06-15):** 첫 슬라이스 **기능 구현 완료** — 프로젝트 생성/삭제, 섹션 추가·이름변경·삭제(작업 동반 삭제),
> Unsectioned 영역, 프로젝트 작업 생성, 작업 완료/재오픈, 멤버 초대/제거/나가기, Completed 탭 필터(전체/일반/프로젝트),
> `project_shared` 알림까지 실제 동작. 목록/상세는 실데이터로 렌더링한다(placeholder 제거됨).
>
> **2차 추가 (2026-06-15):**
> - **객실(컨텍스트) 연결** — 프로젝트 작업도 일반 작업처럼 건물·객실·예약·게스트를 연결한다. `작업 추가`는 전체 생성
>   폼(`/mobile/tasks/new?project=…&section=…`)으로 진입해 기존 `ContextPickerSheet`·날짜·우선순위·사진을 그대로 쓰고,
>   `createTask`가 `project_id`/`section_id`를 기록한 뒤 프로젝트 상세로 복귀한다. 프로젝트 작업은 개별 공유 필드를 숨긴다
>   (공유는 프로젝트 멤버십이 관할). 새 마이그레이션 불필요(`tasks`의 기존 컨텍스트 컬럼 재사용).
> - **섹션 드래그 정렬** — 소유자만, 섹션 헤더의 grip 핸들로 드래그. `reorderProjectSections` 서버액션이
>   `project_sections.sort_order`를 기록. 컴포넌트 `src/components/tasks/reorderable-section-list.tsx`.
> - **사진 최대 20장 (프로젝트 작업 한정)** — 일반 작업은 5장 유지, 프로젝트 작업은 작업 본문 사진을 20장까지.
>   `maxImages` prop을 업로더·생성/편집 폼에 전달하고 `createTask`/`updateTaskCore` 서버에서 동일 cap 재적용.
>   스토리지/RLS 변경 없음. 업데이트 로그 사진은 5장 그대로.
>
> ✅ **DB 마이그레이션 적용 완료 (2026-06-15):** `supabase/migrations/202606150002_projects.sql` 을 연결된 Supabase
> 프로젝트(Foldy)에 적용함 — `projects` / `project_participants` / `project_sections` 테이블 + `tasks.project_id·section_id`
> + RLS + `project_shared` enum 값 생성 확인.
>
> 관련 파일:
> - `supabase/migrations/202606150002_projects.sql` — projects / project_participants / project_sections 테이블,
>   `is_project_participant()` 헬퍼, tasks.project_id·section_id, RLS, `project_shared` 알림 타입
> - `src/lib/projects.ts` — `getVisibleProjects` / `getProjectDetail` 쿼리
> - `src/app/mobile/tasks/projects/actions.ts` — 프로젝트·섹션·멤버 서버 액션
> - `src/components/tasks/projects-board.tsx` — 프로젝트 목록 + 빈 상태 + 생성 시트(멤버 초대)
> - `src/components/tasks/project-detail-view.tsx` — 상세(섹션·작업·완료) + 섹션/프로젝트 삭제·이름변경·나가기·멤버관리
> - `src/app/mobile/tasks/projects/[projectId]/page.tsx` — 상세 진입 라우트
> - `src/components/tasks/tasks-workspace.tsx` — 프로젝트 탭 + 완료 탭 필터(전체/일반/프로젝트)
> - 알림: `src/lib/notifications/{create,display,types}.ts` → `project_shared`
> - i18n: `src/lib/i18n.ts` → `tasks.viewProjects`, `tasks.projects.*`, `mobile.notifications.project*` (ko/ja/en)

## 개요

프로젝트 기능은 Foldy Todo/Task 워크스페이스에 추가되는 협업 도구다.  
일반 할 일(Today/Tomorrow/Inbox)과 달리, 프로젝트에 속한 작업은 **프로젝트 탭 안에서만** 노출된다.  
섹션을 만들어 작업을 묶을 수 있고, Owner가 멤버를 초대해 함께 관리한다.

---

## 탭 IA (Tasks 워크스페이스 chip-tab)

```
오늘 · 내일 · 관리함 · 프로젝트 · 지시 · 완료 · 캘린더
```

프로젝트 탭은 관리함(Inbox) 바로 오른쪽 네 번째 탭으로 위치한다.

---

## 화면 구조

### 1. 프로젝트 목록 (`view=projects`)

- 내가 Owner 또는 Member인 프로젝트 카드 목록
- 카드 표시 정보: 프로젝트명 / 멤버 수 / 완료된 작업 수 / 전체 작업 수
- 빈 상태: "아직 프로젝트가 없습니다. FAB을 눌러 만들어보세요."
- FAB(+) → 프로젝트 생성 바텀 시트 (§ 생성 플로우 참고)

### 2. 프로젝트 상세 (`/mobile/tasks/projects/[projectId]`)

레이아웃 (위 → 아래):

```
[프로젝트 제목]          [멤버 아바타...] [공유] [더보기 ⋮]
─────────────────────────────────────────────────────────
■ Unsectioned (섹션 없는 작업 영역, 최상단 고정)
  · 작업 카드 #1
  · 작업 카드 #2
  · + 작업 추가
─────────────────────────────────────────────────────────
▼ 섹션 이름 A           [작업 수]        [편집✎] [삭제🗑] ← Owner만
  · 작업 카드
  · + 작업 추가
─────────────────────────────────────────────────────────
▼ 섹션 이름 B
  · 작업 카드
  · + 작업 추가
─────────────────────────────────────────────────────────
[+ 섹션 추가]  ← Owner만
```

**더보기 메뉴 (⋮)**

- Owner: 프로젝트 편집 / 멤버 관리 / 프로젝트 삭제
- Member: 프로젝트에서 나가기

---

## 핵심 플로우

### 프로젝트 생성

1. 프로젝트 탭 FAB 탭
2. 생성 시트 열림: 이름 입력(필수) / 설명 입력(선택) / 공유 여부 토글
3. 공유 ON → 멤버 초대 영역 표시 (검색 + 추가, 선택 사항 — 나중에 초대해도 됨)
4. 생성 완료 → 프로젝트 상세 화면으로 이동

> **시트 닫기 (2026-06-15):** 프로젝트 **생성 바텀 시트**와 **멤버 관리 바텀 시트**는 공통
> `useSheetDragDismiss` primitive를 써서 **아래로 드래그**(iOS식, grab 핸들/헤더)·스크림 탭·Esc로
> 닫는다. 슬라이드가 대체하므로 상단 우측 **X 닫기 버튼은 제거**되었다. 공통 동작·임계값은 모바일
> 내비게이션 문서의 "2026-06-15 Bottom Sheets — iOS-style Drag-to-Dismiss" 참고.

### 섹션 추가 (Owner만)

1. 프로젝트 상세 최하단 "섹션 추가" 버튼 탭
2. 이름 입력 시트 → 저장
3. 새 섹션이 기존 섹션 목록 아래에 추가됨

### 섹션 삭제 (Owner만)

1. 섹션 헤더 삭제 아이콘 탭
2. 확인 팝업: "이 섹션과 섹션 내 작업 N개가 모두 삭제됩니다. 계속하시겠습니까?"
3. 확인 → 섹션 + 하위 작업 일괄 삭제 (복구 불가)

### 작업 추가

- Unsectioned 또는 각 섹션 하단의 "+ 작업 추가" 탭
- 기존 작업 생성 시트 재사용 (제목 / 날짜 / 담당자 / 우선순위 등)
- 생성된 작업은 해당 섹션(또는 Unsectioned)에 배치됨
- Owner·Member 모두 추가 가능

### 멤버 초대 (Owner만)

1. 더보기 → 멤버 관리 → "멤버 초대" 버튼
2. 같은 조직(organization) 내 유저 검색
3. 초대 → `project_shared` 알림 발송 → 수락 없이 즉시 Member로 추가

### 멤버 제거 (Owner만)

- 멤버 관리 화면에서 개별 멤버 → 제거
- 제거된 멤버의 기존 작업 기록은 유지 (담당자 표시는 비활성 유저로 표시)

### 프로젝트에서 나가기 (Member만)

- 더보기 → 나가기 → 확인 팝업 → 즉시 Member 해제
- 이후 프로젝트 목록/상세에 미노출

---

## Unsectioned 영역

- 프로젝트 내 `section_id IS NULL`인 작업을 모두 표시
- 프로젝트 상세 최상단에 항상 고정 (섹션보다 위에 위치)
- 헤더 라벨: "섹션 없음" (ko) / "No Section" (en) / "セクションなし" (ja)
- Unsectioned 자체는 삭제/순서 변경 불가 (고정)

---

## Completed 탭 필터 변경

프로젝트 기능 추가 후, 완료(완료/기록) 탭에 필터를 추가한다.

| 필터 | 조건 |
|------|------|
| 전체 (기본) | 일반 작업 + 프로젝트 작업 완료 모두 표시 |
| 일반 작업 | `tasks.project_id IS NULL`인 완료 작업만 |
| 프로젝트 작업 | `tasks.project_id IS NOT NULL`인 완료 작업만 |

업무일지(업무일지 생성) 기능은 "일반 작업" 또는 "전체" 필터에서만 활성화한다.  
(프로젝트 필터 단독 선택 시 업무일지 버튼 비활성)

---

## 권한 매트릭스

| 기능 | Owner | Member | 비고 |
|------|:---:|:---:|------|
| 프로젝트 제목/설명 편집 | ✅ | ❌ | |
| 프로젝트 삭제 | ✅ | ❌ | 전체 작업 일괄 삭제 포함 |
| 멤버 초대 | ✅ | ❌ | |
| 멤버 제거 | ✅ | ❌ | 자기 자신 제거 불가 |
| 프로젝트에서 나가기 | ❌ | ✅ | Owner는 삭제만 가능 |
| 섹션 추가 | ✅ | ❌ | |
| 섹션 이름 편집 | ✅ | ❌ | |
| 섹션 삭제 | ✅ | ❌ | 하위 작업 일괄 삭제 포함 |
| 섹션 순서 변경 (드래그) | ✅ | ❌ | 첫 슬라이스 이후 구현 예정 |
| 작업 추가 (모든 섹션) | ✅ | ✅ | |
| 본인 작업 편집 | ✅ | ✅ | |
| 타인 작업 편집 | ✅ | ❌ | Owner만 타인 작업 편집 가능 |
| 작업 완료 / 재오픈 | ✅ | ✅ | 본인 담당 작업 기준 |
| 업데이트 로그 추가 | ✅ | ✅ | |

---

## 데이터 모델

### 신규 테이블

**`projects`**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `organization_id` | uuid NOT NULL FK | org 격리 |
| `created_by_user_id` | uuid NOT NULL FK | Owner = 생성자 |
| `title` | text NOT NULL | 프로젝트명 |
| `description` | text | 선택 |
| `is_shared` | boolean NOT NULL default false | 공개 여부 |
| `sort_order` | integer | 목록 정렬 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**`project_participants`**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `project_id` | uuid NOT NULL FK → projects(id) ON DELETE CASCADE | |
| `user_id` | uuid NOT NULL FK | |
| `role` | text NOT NULL CHECK IN ('owner', 'member') | |
| `is_first_recipient` | boolean NOT NULL default false | 최초 공유 대상 여부 |
| `added_by_user_id` | uuid FK | 초대한 유저 |
| `created_at` | timestamptz | |
| UNIQUE | (project_id, user_id) | 중복 참여 방지 |

**`project_sections`**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `project_id` | uuid NOT NULL FK → projects(id) ON DELETE CASCADE | |
| `title` | text NOT NULL | 섹션 이름 |
| `sort_order` | integer | 섹션 정렬 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### 기존 `tasks` 테이블 컬럼 추가

| 추가 컬럼 | 타입 | 설명 |
|-----------|------|------|
| `project_id` | uuid REFERENCES projects(id) ON DELETE CASCADE | NULL = 일반 작업 |
| `section_id` | uuid REFERENCES project_sections(id) ON DELETE CASCADE | NULL = Unsectioned |

- `project_id IS NULL` → 일반 작업 (Today / Tomorrow / Inbox 탭 노출)
- `project_id IS NOT NULL` → 프로젝트 작업 (프로젝트 탭에서만 노출)
- `project_id IS NOT NULL AND section_id IS NULL` → Unsectioned 영역

### RLS 추가 방향

기존 `tasks` SELECT 정책에 OR 조건 추가:

```sql
-- 기존
is_task_participant(tasks.id)
-- 추가
OR (
  tasks.project_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM project_participants pp
    WHERE pp.project_id = tasks.project_id
      AND pp.user_id = auth.uid()
  )
)
```

`projects` / `project_participants` / `project_sections` 각 테이블에도  
`organization_id` 또는 `project_id` 기반 RLS 정책을 적용한다.

---

## 알림

| 타입 | 트리거 | 수신 대상 |
|------|--------|-----------|
| `project_shared` | Owner가 멤버를 초대할 때 | 초대된 유저 |
| `task_completed` | 프로젝트 내 작업 완료 시 | 기존 task_participants 기반 로직 그대로 |
| `task_updated` | 프로젝트 내 작업 편집 / 로그 추가 시 | 기존 task_participants 기반 로직 그대로 |

---

## i18n 키 (신규 추가 필요)

```
projects.tab_label          // "프로젝트" / "Projects" / "プロジェクト"
projects.empty_state        // "아직 프로젝트가 없습니다" / ...
projects.create             // "프로젝트 만들기" / ...
projects.section_none       // "섹션 없음" / "No Section" / "セクションなし"
projects.section_add        // "섹션 추가" / ...
projects.section_delete_confirm // "이 섹션과 섹션 내 작업 N개가 모두 삭제됩니다..." / ...
projects.invite_member      // "멤버 초대" / ...
projects.leave              // "프로젝트에서 나가기" / ...
projects.leave_confirm      // "정말 나가시겠습니까?" / ...
completed.filter_all        // "전체" / "All" / "すべて"
completed.filter_regular    // "일반 작업" / "Regular" / "通常タスク"
completed.filter_project    // "프로젝트 작업" / "Projects" / "プロジェクト"
```

---

## 첫 슬라이스 범위

### In Scope (구현 완료)

- 프로젝트 생성 / 편집 / 삭제
- 섹션 추가 / 이름 편집 / 삭제 (확인 팝업 포함)
- **섹션 드래그 정렬 (소유자, grip 핸들)**
- Unsectioned 영역 (최상단 고정)
- 프로젝트 내 작업 생성 (전체 생성 폼 경유 — **객실·예약·게스트 컨텍스트 연결 포함**)
- 작업 완료 / 재오픈
- 프로젝트 목록 화면 + 상세 화면
- 멤버 초대 / 제거 / 나가기
- Completed 탭 필터 (전체 / 일반 / 프로젝트)
- `project_shared` 알림
- RLS 추가

### Deferred (v2 이후)

- 프로젝트 통계 / 진행률 표시
- 프로젝트 아카이브 (soft-archive)
- 프로젝트 작업 ↔ 일반 작업 이동
- 프로젝트 작업의 Calendar 탭 노출 여부 결정 (현재는 미노출)
- 작업(행) 단위 드래그 정렬 (섹션 정렬만 우선 구현)
- Admin 웹 프로젝트 뷰

---

## 관련 문서

- [`docs/product/18-todo-task-workflow.md`](./18-todo-task-workflow.md) — 할 일 전체 워크플로우
- [`docs/engineering/09-todo-task-technical-design.md`](../engineering/09-todo-task-technical-design.md) — 기존 tasks 테이블 스키마
- [`docs/product/16-mobile-navigation.md`](./16-mobile-navigation.md) — 탭 IA 전체 구조
- [`docs/archive/15-feature-batch-plan.md`](../archive/15-feature-batch-plan.md) — 배치 기능 계획

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-15 | 최초 기획 문서 작성 (구현 전 기획 단계) |
| 2026-06-15 | 승인된 디자인 5개 화면을 정적 UI로 이식 (placeholder 데이터). 데이터 레이어·동작은 보류 |
| 2026-06-15 | 첫 슬라이스 기능 구현 완료 — 마이그레이션·RLS·쿼리·서버액션·UI 실데이터 연동, lint·build 통과 |
| 2026-06-15 | 마이그레이션을 연결된 Supabase(Foldy)에 적용 완료 — 테이블·RLS·enum 생성 확인 |
| 2026-06-15 | 2차: 프로젝트 작업 객실(컨텍스트) 연결(전체 생성 폼 경유) + 섹션 드래그 정렬 추가. 생성 시트 디자인 원본 HTML과 대조 수정. 새 마이그레이션 불필요. lint·build 통과 |
| 2026-06-15 | 상세 모달 버그 수정: 확인/이름변경/멤버 모달을 `createPortal(body)`로 변경(상단·하단바 덮도록), `<form>` 감싼 삭제 버튼 폭 정상화(form `flex-1` + 버튼 `w-full`) |
| 2026-06-15 | 생성·멤버 바텀 시트에 공통 드래그-투-디스미스(`useSheetDragDismiss`) 적용, 멤버 시트는 슬라이드 인/아웃으로 승격. 시트 상단 X 닫기 버튼 제거(드래그/스크림/Esc로 대체). lint·build 통과 |
