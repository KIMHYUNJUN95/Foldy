# 실시간 갱신 확대 (할 일 · 요청 · 알림 · 근태 대기열) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 할 일 · 주문/수리/분실물 요청 · 알림 · 근태 대기열을 PC 대시보드와 모바일 양쪽에서 새로고침 없이 바뀌게 한다.

**Architecture:** 이미 쓰는 「신호만 받고 `router.refresh()`」 방식(`admin-live-refresh.tsx`)을 공용 `LiveRefresh` 로 올린다.
테이블을 `supabase_realtime` publication 에 넣고, 화면은 자기가 보여 주는 테이블만 구독한다. 행 데이터는 웹소켓으로
쓰지 않는다 — 화면 값은 늘 권한 검사를 통과한 서버 렌더 결과. 구독도 select RLS 를 통과해야 신호가 온다.
Beds24 쪽의 「놓친 신호 따라잡기」(재구독 · `online` · 60초 넘게 가려진 탭)를 공용 훅에도 넣는다.

**Tech Stack:** Next.js 16 App Router · React 19 · Supabase Realtime(`postgres_changes`) · vitest

**Spec:** 이 문서 + 대화 결정(2026-10-29): 1~4번 전부, 모바일 · 대시보드 둘 다.

## Global Constraints

- 행 데이터를 클라이언트로 흘리지 않는다 — 신호 → `router.refresh()` 만.
- 구독 전에 `supabase.realtime.setAuth(access_token)` 를 기다린다(2026-10-15 실측: anon 으로 붙으면 org 필터 거절).
- 디바운스 600ms(여러 행이 한 번에 바뀔 때 한 번만), 숨은 탭은 미뤘다가 보일 때 한 번.
- 폴링 추가 금지(Vercel 함수 호출 증가). 신호가 없는 화면은 그대로 두지 폴링으로 메우지 않는다.
- 새 화면 문구 없음 → i18n 추가 없음. 문구가 생기면 ko · ja · en 함께.
- 마이그레이션은 새 파일. **운영 DB 적용은 사용자 허락 뒤에만**(CLAUDE.md 규칙 10).
- `/mobile` 코드는 `src/app/admin/**` 을 import 하지 않는다 — 공용 훅은 `src/components/shared`.
- 커밋 · 푸시는 컨펌 뒤.

## Review Focus

1. **입력 · 시트를 연 채로 신호가 옴** — 쓰던 글 · 열린 시트가 그대로여야 한다. props 를 `useState` 로 복사해 두고 다시 맞추는
   화면(`attendance-queue-client.tsx:327-332` 의 synced 패턴, 할 일 작성 · 편집)은 편집 중인 항목을 덮어쓰면 안 된다.
   → Task 3 · 4 · 6 에서 「시트 열고 다른 브라우저에서 변경」 수동 확인.
2. **내가 바꾼 것의 메아리** — 저장 직후 내 `router.refresh()` + 내 변경 신호로 두 번 다시 읽어 낙관적 표시(`useOptimistic`,
   `.row-collapse`)가 깜빡이면 안 된다. → Task 3 수동 확인: 할 일 체크 · 삭제 후 깜빡임 없음.
3. **권한 밖 신호** — 알바는 남의 비공개 할 일 · 남의 정정 요청 신호를 받으면 안 된다(RLS). → Task 1 RLS 점검 + Task 6 알바 계정 확인.
4. **연결 끊김 뒤 복귀**(폰 잠금 · 와이파이 전환) — 돌아오면 한 번 따라잡아야 한다. → Task 2 테스트 `catchUpAfterLongHidden`.
5. **하드 삭제는 신호가 안 온다**(주문 · 수리 · 분실물 — replica identity 기본값). 다른 사람이 지운 행은 다음 갱신 때까지 남는다.
   → 알려진 한계로 문서에 적는다(채용과 같은 결정). 할 일은 소프트 삭제라 UPDATE 로 온다.

---

### Task 1: 테이블을 realtime publication 에 넣기 (마이그레이션 · RLS 점검)

**Files:**
- Create: `supabase/migrations/202610290001_enable_ops_realtime.sql`
- Modify: `docs/engineering/04-data-model.md`(실시간 테이블 목록), `docs/engineering/05-rls-permissions.md`(구독은 select RLS 를 탄다)

**Interfaces:**
- Produces: 아래 테이블의 INSERT/UPDATE 변경 신호.

| 테이블 | 구독 필터 | 비고 |
| --- | --- | --- |
| `tasks` | `organization_id=eq.{org}` | 소프트 삭제라 삭제도 UPDATE |
| `task_occurrence_state` | `organization_id=eq.{org}` | 반복 할 일 체크 |
| `task_participants` | `user_id=eq.{me}` | org 칸 없음 — 내가 초대 · 제외될 때만 |
| `task_updates` | `task_id=eq.{id}` | 할 일 상세에서만(org 칸 없음) |
| `order_requests` · `maintenance_reports` · `lost_items` | `organization_id=eq.{org}` | |
| `notifications` | `recipient_user_id=eq.{me}` | |
| `attendance_correction_requests` · `transport_reimbursement_reports` | `organization_id=eq.{org}` | 근태 대기열 |

- [ ] **Step 1:** `supabase:supabase-postgres-best-practices` 스킬을 불러 읽는다.
- [ ] **Step 2:** 위 9개 테이블마다 authenticated 역할의 select 정책이 있는지, 필터 칸이 정책 안에서 쓰이는지 확인한다
  (`execute_sql`: `select tablename, policyname, cmd, qual from pg_policies where tablename in (...)` — 읽기만).
  select 정책이 없는 테이블은 신호가 안 온다 → 그 테이블은 빼고 보고.
- [ ] **Step 3:** 마이그레이션을 `202610150001_enable_annual_leave_requests_realtime.sql` 과 같은 `do $$ … if not exists … $$` 형태로
  테이블마다 하나씩 쓴다. `replica identity` 는 바꾸지 않는다(Review Focus 5). 맨 위 주석에 「신호만 · 삭제 신호 없음」.
- [ ] **Step 4:** 로컬(또는 브랜치 DB)에 적용해 `select tablename from pg_publication_tables where pubname='supabase_realtime'` 에 9개가 보이는지 확인.
- [ ] **Step 5:** 운영 적용은 **멈추고 사용자에게 묻는다.**

### Task 2: 공용 `LiveRefresh` (여러 테이블 · 따라잡기)

**Files:**
- Create: `src/components/shared/live-refresh.tsx`
- Create: `src/lib/live-refresh-schedule.ts` (순수 로직 — 디바운스 · 숨김 · 따라잡기 판정)
- Test: `src/lib/__tests__/live-refresh-schedule.test.ts`
- Modify: `src/components/admin/shared/admin-live-refresh.tsx` → `LiveRefresh` 를 쓰는 한 줄 래퍼로(연차 승인 화면은 그대로 동작)

**Interfaces:**
- Produces:
  ```ts
  export type LiveSource = { table: string; filter: string }; // filter 예: "organization_id=eq.<uuid>"
  export function LiveRefresh(props: { sources: LiveSource[]; channelKey: string }): null;
  export function createLiveRefreshScheduler(opts: {
    refresh: () => void; debounceMs?: number; catchUpHiddenMs?: number; now?: () => number;
  }): { onSignal(visible: boolean): void; onVisible(): void; onHidden(): void; onReconnect(): void; dispose(): void };
  ```
- 채널 하나에 `.on("postgres_changes", …)` 를 source 수만큼 건다. 기본값 debounce 600 · catchUp 60_000(Beds24 값과 같게).

- [ ] **Step 1: 실패하는 테스트** (`vi.useFakeTimers`)
  - `debouncesBurst`: 보이는 상태에서 `onSignal(true)` 5번 → 600ms 뒤 `refresh` 1번.
  - `defersWhileHidden`: `onSignal(false)` → refresh 0번; `onVisible()` → 600ms 뒤 1번.
  - `catchUpAfterLongHidden`: `onHidden()` → 61초 → `onVisible()` → 신호 없이도 refresh 1번.
  - `noCatchUpAfterShortHidden`: 10초 숨김 → `onVisible()` → 0번.
  - `reconnectRefreshes`: `onReconnect()` → 1번.
- [ ] **Step 2:** `npx vitest run src/lib/__tests__/live-refresh-schedule.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3:** 스케줄러 구현 후 `LiveRefresh` 구현: `getSession` → `setAuth` → 채널 구독. 구독 상태가
  `SUBSCRIBED` 로 **두 번째 이후** 바뀌면 `onReconnect`, `window` `online` 도 `onReconnect`. `vercel-react-best-practices` 스킬 확인.
- [ ] **Step 4:** 테스트 PASS · `/admin/attendance/leave` 가 예전처럼 신호를 받는지(브라우저 두 개) 확인.

### Task 3: 할 일 — 모바일 · PC · 두 홈

**Files (각 페이지에 `<LiveRefresh>` 한 줄):**
- `src/app/mobile/tasks/page.tsx` · `src/app/mobile/tasks/projects/[projectId]/page.tsx` · `src/app/mobile/tasks/[id]/page.tsx`(+ `task_updates` `task_id=eq.{id}`)
- `src/app/admin/tasks/page.tsx`
- `src/app/admin/page.tsx`(대시보드 「오늘 할 일」) · `src/app/mobile/page.tsx`(홈 할 일 카드)
- 공용 묶음: `src/lib/live-sources.ts` — `taskLiveSources(orgId, userId): LiveSource[]` (`tasks` · `task_occurrence_state` · `task_participants`)

**Interfaces:**
- Consumes: Task 2 `LiveRefresh`, `LiveSource`.
- Produces: `taskLiveSources`, `requestLiveSources`(Task 4), `attendanceQueueLiveSources`(Task 6) — 모두 `src/lib/live-sources.ts`.

- [ ] **Step 1:** `taskLiveSources` 단위 테스트(`src/lib/__tests__/live-sources.test.ts`): 3개 source, `task_participants` 필터가 `user_id=eq.{userId}`.
- [ ] **Step 2:** 구현 · 각 페이지에 붙인다. 홈은 기존 `Beds24LiveRefresh` 옆에 둔다(대체하지 않음).
- [ ] **Step 3:** `tasks-workspace.tsx` · `admin-tasks-console.tsx` 가 서버 props 를 `useState` 로 복사해 두는 목록이 있으면,
  props 가 바뀔 때 다시 맞추되 **열린 편집 · 낙관적 항목은 유지**(queue client 의 synced 패턴을 따른다).
- [ ] **Step 4:** 수동: 브라우저 A(PC)에서 체크 → B(폰 · 폴드 · 태블릿 폭)의 목록 · 홈 카드가 1초 안에 바뀜. Review Focus 1 · 2 확인.

### Task 4: 요청 — 주문 · 수리 · 분실물

**Files:**
- PC: `src/app/admin/orders/page.tsx` · `src/app/admin/maintenance/page.tsx` · `src/app/admin/maintenance/[id]/page.tsx` · `src/app/admin/lost-found/page.tsx`
- 모바일: `src/app/mobile/requests/page.tsx` · `requests/orders/[id]` · `requests/maintenance/[id]` · `requests/lost-found/[id]` · `lost-found/returned` · `lost-found/disposed`
- 대시보드 · 모바일 홈에 요청 숫자가 있으면 그 페이지에도 `requestLiveSources` 추가.

**Interfaces:**
- Produces: `requestLiveSources(orgId): LiveSource[]` (3개 테이블).

- [ ] **Step 1:** `requestLiveSources` 테스트 추가 → 구현 → 페이지에 붙인다. 목록 화면은 그 화면 테이블만 구독해도 되지만,
  `/mobile/requests` 는 세 종류가 한 목록이라 세 개 다.
- [ ] **Step 2:** 각 콘솔(`orders-console.tsx` · `maintenance-console.tsx` · `lost-found-console.tsx`)의 props→state 복사 여부 점검, Task 3 Step 3 과 같은 처리.
- [ ] **Step 3:** 수동: 폰에서 주문 요청 → PC 주문 목록에 바로 뜸 / PC 에서 승인 → 폰 상세 상태 바뀜.

### Task 5: 알림 · 사이드 메뉴 배지

**Files:**
- `src/app/mobile/layout.tsx` · `src/app/admin/layout.tsx` — 레이아웃에 `notifications` (`recipient_user_id=eq.{me}`) 하나만 구독
- `src/app/mobile/notifications/page.tsx` 는 레이아웃 구독으로 충분(추가 없음)

- [ ] **Step 1:** 레이아웃에 `<LiveRefresh channelKey="notifications" sources={[{ table: "notifications", filter: … }]} />`.
  레이아웃에는 **알림만** 둔다 — 할 일 · 요청을 레이아웃에서 구독하면 급여 같은 무관한 화면까지 매번 서버 렌더를 다시 돈다.
  배지(`nav-badges.ts`)는 알림 신호 · 해당 화면 신호로 refresh 될 때 같이 다시 센다.
- [ ] **Step 2:** 수동: 알림이 생기는 동작(예: 할 일 배정) → 상대방 종 숫자 · 알림 목록이 바로 바뀜.

### Task 6: 근태 대기열 · 내 신청 상태

**Files:**
- PC: `src/app/admin/attendance/queue/page.tsx` — `attendance_correction_requests` · `transport_reimbursement_reports` · `annual_leave_requests`
- 모바일: `src/app/mobile/attendance/correction/status/page.tsx`(정정) · `src/app/mobile/attendance/leave/history/page.tsx`(연차) — 같은 테이블,
  필터는 org(RLS 가 내 것만 보여 준다)
- 대시보드 홈에 대기 건수가 있으면 그곳에도.

**Interfaces:**
- Produces: `attendanceQueueLiveSources(orgId): LiveSource[]`.

- [ ] **Step 1:** 테스트 → 구현 → 붙이기.
- [ ] **Step 2:** `attendance-queue-client.tsx:327-332` synced 패턴이 처리 중인 행(결재 모달 열림)을 덮어쓰지 않는지 확인.
- [ ] **Step 3:** 수동: 알바 계정으로 정정 신청 → PC 대기열에 바로 뜸 → 승인 → 알바 상태 화면 바로 바뀜. 다른 알바에겐 신호 없음(Review Focus 3).

### Task 7: 문서 · 검증 마무리

**Files:**
- `docs/product/16-mobile-navigation.md` — 「실시간 갱신 — 공용」 절(어떤 화면이 무엇을 구독하는지 표, 하드 삭제 한계)
- `docs/product/05-admin-web-ia.md` — 같은 표의 PC 부분
- `docs/planning/01-decision-log.md` — 2026-10-29 결정 한 줄(신호만 · 레이아웃은 알림만 · 삭제 신호 없음)
- `docs/planning/06-current-status.md` 「▶ 다음에 할 일」
- 기능 문서: `08-maintenance-workflow.md` · `09-lost-found-workflow.md` · `10-order-request-workflow.md` · 할 일 기술 문서 `docs/engineering/09-todo-task-technical-design.md`

- [ ] **Step 1:** 문서 갱신.
- [ ] **Step 2:** `npx vitest run` · `npm run lint` · `npm run build` 모두 통과.
- [ ] **Step 3:** 최종 회귀 리뷰(`code-review` 스킬) — 권한 · 메아리 · 편집 중 덮어쓰기.
- [ ] **Step 4:** 보고 후 커밋 · 푸시 · 운영 마이그레이션 적용 각각 허락 받기.
