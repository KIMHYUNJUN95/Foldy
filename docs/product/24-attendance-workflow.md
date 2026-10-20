# Attendance / 근태 Workflow

Status: live multi-slice attendance domain. The original 2026-06-17 design port is now backed by real
GPS + QR clock-in/out, breaks, self history, correction requests/status, self pay view, notifications,
transport-reimbursement backend, roster, and the admin attendance/payroll/transport dashboard slices.
The authoritative technical as-built log is
`docs/engineering/11-attendance-payroll-technical-design.md`. UI copy for the shipped surfaces is
dictionary-backed in ko/ja/en; new attendance UI must keep that contract.

Annual leave is implemented as a separate attendance-adjacent workflow for salary-based regular
employees. The source-of-truth contract is `docs/product/26-annual-leave-workflow.md`.

**출근자 명단(`/mobile/attendance/roster`) 구현 완료 (2026-06-24):** 관리자 역할이 당일(혹은 과거 날짜)의
실제 출근자를 실시간으로 조회할 수 있으며, 전화 연결 기능 포함.

**관리자 근태 대시보드 구현/하드닝 (2026-07-02):** `/admin/attendance` overview, review queue,
payroll, transport, wage management, and staff detail slices are wired to real server data. Overview KPI
counts are sourced from the same queue/payroll/transport helpers as the detail pages; the correction
card renders recent open requests instead of an empty state; correction approval preserves separate
clock-in and clock-out site values; future hourly-rate replacements keep the client history consistent
with server-side delete/replace behavior. The admin console now uses one shared top month picker in the
attendance subnav; overview, queue, payroll, transport, wage management, and staff detail share the same
`?ym=YYYY-MM` context instead of rendering separate page-level month controls.

**관리자 근태 정산 안전 하드닝 (2026-07-03):** manual session create/update, correction approval,
invalidate/restore now validate `clock_out_at > clock_in_at`, handle overnight sessions by anchoring
clock-out to the next Tokyo day when needed, and block edits against finalized user-months. Session-less
exception approvals now create the missing completed attendance session instead of only approving the
request. Correction approve/reject and transport review updates are guarded by current status to prevent
two-admin race conditions. Payroll/transport admin lists include active members plus inactive members who
have month sessions, snapshots, or transport reports, so resigned staff do not disappear from accounting
views. Review queue and date-picker labels are locale/Tokyo-timezone based.

**수기 근무 입력 UI (2026-07-10):** the review queue (`/admin/attendance/queue`) toolbar has a **"근무 추가"**
button opening a manual work-session modal (`ManualSessionModal`): staff · date · clock-in · optional
clock-out · **free-text work location** · reason. This covers off-site work and forgotten clock-ins —
`createManualAttendanceSession` now accepts a free-text `manual_location` instead of requiring a registered
site (a site is no longer mandatory; a location or a site is). The typed location is stored on the session
(`attendance_sessions.manual_location`) and shows in the "근무 위치" column of per-user payroll PDF/Excel
exports (falling back to the registered site name). Once the manual session exists, base pay and any
attendance allowances for that date apply automatically. A `daily_fixed` attendance allowance also applies
to an hourly worker even on a date with **no** session at all (off-site / unrecorded shift); `hourly_extra`
still needs recognized minutes, so it requires a session (clocked or manually entered).

**관리자 근태 배지/집계 경량화 (2026-07-03):** attendance subnav badges now use a dedicated lightweight
stats helper instead of calling the full overview aggregation from every attendance subpage. Overview
still loads detailed KPI/sample data, but queue/payroll/transport/wages/roster/staff-detail pages no
longer trigger the payroll/transport full fanout just to render badges. Correction request site labels are
batch-loaded once per request list instead of doing per-row site lookups.

**관리자 근태 상태/URL 정합성 보강 (2026-07-03):** overview → queue links now preserve the selected
`?ym=YYYY-MM`, including direct session deep links, so past-month rows open in the matching queue month.
The correction queue only loads open requests (`requested` / `in_review`) and removes a request from the
client list after approval/rejection. Transport submitted-total KPI excludes draft/rejected/
changes-requested reports and recalculates from the current client rows after review actions.
Transport `changes_requested` is treated as a worker-owned correction state: desktop admin panels no
longer expose approve/reject/request-fix buttons until the worker resubmits the report, while staff
detail labels show the same `보완 요청` status instead of falling back to `미제출`.
Follow-up hardening keeps the selected month context on overview → payroll/transport links, staff-day
→ queue links, and wage-panel → staff-detail links. The overview transport card now shows the real
missing-receipt count from reimbursement items instead of a placeholder `0`, and its note uses that
same count. Bulk queue actions run in parallel; if some rows fail, the toast stays open until dismissed
and lists the first failed staff/date targets. Payroll finalization uses the shared admin reason modal
with finalization-specific copy, while reopen keeps the required-reason flow.

**관리자 근태 패널 접근성 보강 (2026-07-03):** the attendance console side panels keep their existing
visual design, but now share an accessibility hook for behavior: `Esc` closes the open panel, body scroll
is locked while a panel is open, focus moves into the panel on open, and focus returns to the previously
focused element on close. Nested reason modals/lightboxes keep priority so pressing `Esc` does not close
the parent panel underneath them.
Close/previous/next aria labels in attendance admin panels and receipt focus view are dictionary-backed
in ko/ja/en; urgency chips use the dedicated localized `tagUrgent` label instead of parsing a KPI
sentence.

**관리자 출근자 명단 추가 (2026-07-02):** `/admin/attendance/roster`는 첨부된 desktop roster handoff의
상단 일자 선택기, 캘린더 팝오버, 요약 카운트, 상태별 그룹 테이블, 빈 상태 구조를 관리자 콘솔 안에 포팅한
일 단위 명단 화면이다. 데이터는 모바일 `/mobile/attendance/roster`와 같은 `getAttendanceRoster`
헬퍼를 사용하므로 모바일 출퇴근/휴게 기록과 100% 같은 출처를 본다. URL은
`/admin/attendance/roster?date=YYYY-MM-DD`이며 Tokyo 오늘, 미래 날짜, 90일 이전 날짜 clamp 규칙을
모바일과 맞춘다. 오늘 날짜 조회 중에는 클라이언트가 10초마다 조용히 재조회해 실시간 감지에 가깝게
현재 출근자/휴게자 변화를 반영하고, 상단 갱신 시각 표시는 1초 단위로 현재 Tokyo 시각을 갱신한다.
열린 휴게가 있는 직원은 휴게 컬럼에 `휴게 N분` 형태의 현재 휴게 경과 시간을 1초 tick 기준으로
재계산해 보여주며, 상태 컬럼의 `휴게 중` 칩은 별도로 유지한다.
정정·무효·급여 반영 변경은 여전히 검토 큐에서 처리하고,
명단은 조회 중심의 운영 표면이다. 날짜 선택은 근태 subnav 우측의 상단 일자 선택기 하나로
통합하고, 명단 본문 내부에는 별도 캘린더를 두지 않는다.
단, 전화 연결 버튼은 모바일 roster에서만 제공한다. PC 관리자 콘솔의 `/admin/attendance/roster`는
전화 컬럼/`tel:` 버튼을 노출하지 않는다.

**수당(시급) 화면 Excel/PDF 내보내기 구현 (2026-07-14):** `/admin/attendance/wages` 사이드 패널의
비활성(disabled) 스텁 내보내기 버튼을 제거하고, 툴바에 공용 `<AdminExportButtons>`
(`src/components/admin/shared/admin-export-buttons.tsx`)를 신설했다. 신규 서버 액션
`exportAttendanceWagesWorkbook()` / `exportAttendanceWagesReport()`(`src/app/admin/attendance/actions.ts`)는
기존 급여(payroll) export와 동일한 `attendance_payroll_admin`/`owner` 권한 게이트를 쓴다. 산출물은
2시트 구성: (1) 직원별 요약 — 직원/고용형태/현재 시급/적용 시작일/이력 단계 수, (2) 시급 이력 상세 —
직원/시급/적용 시작일/적용 종료일/사유. 어드민 콘솔 공용 그린 렛저 템플릿
(`src/lib/admin-table-workbook.ts` / `admin-table-report.ts`)을 통해 렌더링되며, 근태 급여·교통비
내보내기는 이번 변경 이전에 이미 같은 공용 톤을 쓰고 있어 변경 없음. i18n: `attendanceConsole.wageColTo`
신규 추가(ko/ja/en).

## Design source

Ported from `Attendance Module v2.html` (high-fidelity handoff). Same ivory + deep-ink-navy tokens as
the rest of the app, plus attendance status hues (open / done / warn / info / invalid / danger) and a
monospace face for the live timer.

## Implementation (2026-06-17)

The first implementation began as a frontend design port, but the current attendance product is no
longer frontend-only. Routes are gated like every mobile route (auth + org context), and the shipped
clock, break, correction, payroll, roster, transport, and admin-review flows use server-side
organization-scoped data.

- Scope under `.att` in `src/components/attendance/attendance.css` (1:1 CSS port); icons in
  `att-icons.tsx`; the live-timer ring gradients in `AttRingDefs`.
- Nav entry `attendance` (`근태` / `勤怠` / `Attendance`, `Clock` icon) added to
  `mobileSidebarNavigation` (side menu + bottom-bar editor pool), `routeAccess`, and the shell
  launcher (`LAUNCHER_META.attendance`). Reached from the side menu / "추가" launcher / a pinned tab.
- **Integration choice:** the design's own 5-tab bottom bar (홈/이력/출퇴근/급여/내정보) is **not**
  rendered — it would clash with the app's global bottom nav. The home content's large clock button is
  the primary action instead, so no designed element is lost. **이력 is now built (Step 5, 2026-06-17)**
  as new UI in the existing `.att` token language (the v2 handoff had no 이력 frame). **급여 is now built
  (Step 10, 2026-06-18)** as new UI too (self monthly hourly expected-pay, `/mobile/attendance/pay`); 내정보
  remains unbuilt. The home shows **이력** + **급여** shortcut entry rows (`entryList`) in **all three
  states (idle / open / break)** — placed below the primary clock-in/out + break action buttons so the
  main action is always visually dominant. (2026-06-23)
  - **Transportation reimbursement entry (implemented 2026-06-26):** **교통비 제출** 백엔드 구현 완료. DB schema (3개 테이블), query layer, server actions, storage policy 적용됨. 진입 경로는 attendance-home quick-entry 목록 내 **`시급 급여` 바로 아래 행**으로 확정. 프론트엔드 UI 연결(transport-statement.tsx mock 제거 및 실데이터 props 주입)은 진행 중. 상세 구현: `docs/engineering/11-attendance-payroll-technical-design.md` "As-built — Transport Reimbursement Backend (2026-06-26)".
  - **Amount privacy toggle (eye icon):** the pay card amounts (예상 총 급여, 근무 인정 시간 / 근무일, and
    the daily 일급 column) can be hidden via the eye button. The hide effect uses **transparent text +
    `text-shadow` blur**, NOT `filter: blur()` — on iOS Safari a `filter: blur()` on text inside the
    `overflow: hidden` pay card clips its blur halo into a hard rectangle / white hairline (reported
    artifact). The text-shadow approach obscures cleanly with no edge box. Shadow color follows the card
    variant (ink on the light `--expected` card, white on the dark `--final` card). See
    `src/components/attendance/attendance.css` (`.entryrow__val.masked`, `.paycard.hide .pc__amt`,
    `.paycard.hide .pc__v`). (2026-06-22) **기본값은 가려진 상태(hidden)이며 사용자의 마지막 선택을
    `localStorage` (`stayops:attendance:pay-amount-visible`, `"1"` = shown / `"0"` = hidden) 에
    영속화한다 — 탭을 닫았다 다시 열어도 마지막 상태가 복원된다. `attendance-home`의 시급 급여 행과
    `/mobile/attendance/pay` 페이지가 같은 localStorage 키를 공유하므로, 한쪽에서 풀면 다른 쪽도 풀린
    채로 진입한다. SSR 안전: 첫 렌더는 항상 hidden으로 고정되고, `useEffect` 이후에 클라이언트에서
    저장된 값을 읽어 갱신한다 (hydration mismatch 없음). 구현 훅: `src/lib/use-persistent-toggle.ts`.
    (2026-06-23)

Screens:

- `/mobile/attendance` — **home (ring hero)** → `attendance-home.tsx`. Renders the four designed
  states: **출근 전 (idle)** · **근무 중 (open)** · **휴게 중 (break)** · **로딩 (skeleton)**. The live
  ring (navy = working, amber = break), info strip (장소/시각, 휴게 합계/횟수), clock-in/out + break
  buttons, and method chips (GPS+QR / Wi-Fi 준비중). User name + today's date are real (from the
  session); clock data is static placeholder. The clock button links to the capture flow. The **이력
  (history)** and **급여 (pay)** shortcut entry rows appear below the primary action buttons in **all
  three active states** (idle, open, break) so users can navigate to those screens without clocking
  out. **교통비 제출** 백엔드 구현 완료 (2026-06-26) — DB schema, query layer, server actions, storage policy. UI 연결 진행 중.
- `/mobile/attendance/history` — **own attendance history (Step 5, 2026-06-17)** → `attendance-history.tsx`.
  New self-view screen: today summary (세션/근무/휴게) + the user's own session list (date, 출근/퇴근
  time + site, status/검토/수동 chips, 근무·휴게 totals); a card opens a **detail bottom sheet** (shared
  drag-dismiss) with in/out detail, methods, break rows, and an abnormal/review marker. Data is
  strictly self-scoped server-side (`src/lib/attendance-history.ts`).
- `/mobile/attendance/capture` — **clock-in capture** → `attendance-capture.tsx`. QR scan view (corner
  frame, scan line, GPS chip) + the three **result sheets**: **성공 (출근 완료 + recap)**, **반경 밖
  (거리 게이지 138m)**, **위치 권한 거부** (`?result=`). Result sheets are portaled to `<body>` (the
  shell scroll container's `transform` traps `position: fixed`). **Scope (2026-06-22 fix):** because the
  sheet is portaled out of the page tree, its `BottomSheet` carries the `att` class (`className="att
  att__result-sheet"`) — all attendance result-sheet CSS is scoped under `.att`, so without it the
  portaled content rendered unstyled (giant intrinsic-size SVG icons, no recap layout). Tapping the
  scanner simulates a successful scan (prototype).
- `/mobile/attendance/correction` — **correction request form** → `attendance-correction-form.tsx`
  (reason chips · desired in/out time · site · memo · photos, fixed submit bar). From `Attendance
  Correction Request.html`. **Wired (Step 6, 2026-06-17):** controlled form → `createAttendanceCorrectionRequest`
  (self-only, current/previous Tokyo month only, ≤5 photos via `attendance-corrections/`); optional
  `?sessionId=` ties it to a session, else it's a session-less exception request (capture failures reach
  it). Desired-site uses a shared drag-dismiss picker.
- `/mobile/attendance/correction/status` — **request status** → `attendance-correction-status.tsx`,
  four states (**요청됨 / 검토 중 / 승인 / 반려**) with a 3-step timeline, request recap, reviewer
  comment, and 다시 요청. Data-driven from `?id=` (or latest), self-scoped; admin approve/reject now
  updates the request status and, for linked sessions, applies approved authoritative values to the
  session with an audit row.
- `/mobile/attendance/roster` — **출근자 명단 (Wired, 2026-06-24)** → `attendance-roster.tsx`. 관리자
  전용 실시간 출근자 현황 화면. 접근 권한: `cleaningRecordViewerRoles` (owner, office_admin, cs_staff,
  field_manager) — 일반 staff / part_time_staff는 접근 불가이며, 권한 없으면 `/mobile/attendance`로
  리다이렉트. 진입 경로: `attendance-home.tsx` 홈 바로가기 목록 하단(시급 급여 아래)에 `출근자 명단`
  버튼이 표시되며 권한 없는 역할에게는 미표시.
  - **화면 구성** ①주간 스트립(가로 스와이프, 출근 기록 있는 날 하단 점 표시, 미래 날짜 비활성)
    ②선택 날짜 + "오늘" 태그 + 출근/퇴근 카운트 메타 ③캘린더 BottomSheet 날짜 선택 버튼
    ④요약 카운트(근무 중 / 퇴근 완료 / 검토 필요 / 무효) ⑤직원 카드 리스트(출근 시각 순)
    ⑥빈 상태(해당 날짜 기록 없음).
  - **직원 카드**: 아바타 + 이름 + 역할, 상태 chip, 사이트명, 출근/퇴근/휴게 타임 스트립, 전화 버튼.
  - **URL**: `/mobile/attendance/roster?date=YYYY-MM-DD`. `date` 없으면 Tokyo 오늘 날짜.
    미래 및 90일 이전은 오늘로 clamp.
  - **데이터 소스**: `attendance_sessions` JOIN `profiles` JOIN `memberships` JOIN `attendance_sites`
    JOIN `attendance_breaks`. 서버 컴포넌트가 렌더 시 실시간 로드.
  - **세션 상태 정의**:
    | statusKey | 조건 | 표시 색상 |
    |---|---|---|
    | `working` | clock_in ✓, clock_out ✗, 오픈 브레이크 없음 | green |
    | `on_break` | clock_in ✓, clock_out ✗, 오픈 브레이크 ✓ | amber |
    | `done` | clock_in ✓, clock_out ✓ | slate |
    | `needs_review` | review_state = `needs_review` | orange |
    | `void` | invalidated_at not null | red |

### 전화 기능 (출근자 명단)

출근자 명단의 직원 카드에는 전화 연결 버튼이 포함된다.

- **데이터 소스**: `profiles.phone_number` (가입 시 등록한 번호).
- **링크 방식**: `<a href="tel:{phone_number}">` — 네이티브 전화 앱 연결 (PWA 포함).
- **표시 조건**: 세션 상태가 `working` 또는 `on_break` **이며** `profiles.phone_number` 가 존재하는
  경우에만 카드에 전화 버튼을 렌더링.
- **숨김 조건**: `done` / `needs_review` / `void` 상태이거나 phone_number 가 null / 빈 문자열인
  경우에는 전화 버튼을 표시하지 않음. 퇴근 후 직원에게 업무 목적으로 전화하는 혼선을 방지하기 위한
  의도적 설계.
- **권한**: 전화 버튼은 출근자 명단 접근 권한(`cleaningRecordViewerRoles`)을 가진 관리자만 볼 수 있음
  (화면 자체가 권한 게이트됨).

**Back buttons were removed from all attendance screens** (the global shell owns navigation). A
design-phase preview index existed during review and was **removed on completion**. Any remaining
`?state=` / `?result=` affordances are development-preview compatibility only and must not be treated as
the source of operational state.

## Current Product Scope

Implemented scope: GPS + QR clock-in/out, break start/stop with clock-out blocked during an open break,
session review states, correction request lifecycle, self history, expected hourly pay, monthly
finalization/reopen/export foundations, notifications, roster, transportation reimbursement backend,
and admin dashboard review/payroll/transport/wage/staff slices.

Admin payroll export refinement (2026-07-03): the payroll side panel can export one staff member's
monthly Excel/PDF detail sheet. It combines daily attendance/pay, approved transport items, and completed
cleaning rooms for the same staff/date. Cleaning room labels currently use the user-confirmed summaries
AA/AB/KK/T2 while Okubo and Sky remain as stored labels. For Arakicho duplicate account room keys
such as `501` / `501_2`, the export now follows the same display-room rule as the cleaning UI and
collapses them to one visible room label (`AA501`, `AB501`).
The personal Excel/PDF totals row also carries the work-day count next to `합계`/`Total` and counts only
dates with recognized paid minutes, so transport-only dates do not inflate attendance days. The personal
export includes a cleaning memo column sourced from `cleaning_sessions.notes`; when multiple completed
cleaning sessions on the same date have notes, they are joined as room-summary-prefixed memo entries.
The staff monthly detail page no longer exposes a separate daily-ledger CSV button; accounting hand-off
exports are kept in the payroll panel's Excel/PDF actions to avoid duplicate document paths.
The monthly payroll toolbar also includes a `시급제만` export switch next to the PDF/Excel actions. When
enabled, both monthly PDF and Excel exports include only hourly/mixed payroll rows with an active hourly
rate, excluding salaried/staff rows whose hourly-rate cell is blank.
Payroll calculation consistency hardening (2026-07-03): admin payroll lists, staff detail, and monthly
Excel/PDF exports now prefer finalized snapshot amounts once a user-month is closed, so later hourly-rate
edits cannot alter locked payroll. Personal Excel/PDF daily rows are reconciled to the official monthly
payroll total, keeping the visible daily-pay sum and the finalized/expected monthly amount aligned to the
yen.
Payroll review document alignment (2026-07-03): monthly payroll Excel/PDF and personal staff Excel/PDF
exports keep the existing green ledger format, but all title/meta/table/total text is center-aligned for
visual consistency across the four document paths.

## 打刻 검증 순서 — 위치보다 세션 상태를 먼저 (2026-07-31)

`submitAttendanceScan` 의 검증 순서를 바꿨다.

```txt
1) QR 토큰 (활성 + 동일 조직)
2) 사이트 (동일 조직 + 활성)
3) 세션 상태  ← 여기로 앞당김
     출근: 열린 근무가 있으면 → open_session
     퇴근: 열린 근무가 없으면 → no_session / 휴게가 열려 있으면 → open_break
4) GPS 필수
5) 사이트 반경 이내
6) 기록
```

**이유.** 열린 근무의 유무는 위치와 무관한 사실이다. 예전 순서(GPS·반경 먼저)에서는 이미 출근한
사람이 **다른 현장 QR** 을 찍으면 "허용 범위 밖입니다" 가 떴다. 그 안내를 믿고 그 현장 안으로
걸어 들어가 다시 찍어도 결과는 같다 — 이미 출근 중이라 어차피 실패한다. 사용자를 헛걸음시키는
안내였다. 위치와 무관하게 이미 결정된 실패는 먼저 알려준다.

부수 효과로 `attendance_attempt_logs` 의 `outside_radius` 는 이제 "정말 위치 때문에 실패한 시도"만
담는다. 세션 상태 때문에 실패한 시도는 `open_session_exists` / `open_break_blocks_clock_out` 으로
분리돼 진단이 정확해진다.

## QR Deep Link — 휴대폰 기본 카메라로 바로 인증 (2026-07-31)

### 배경

QR 에는 토큰 문자열(`att_…`)만 들어 있었다. 휴대폰 기본 카메라로 찍으면 "열 수 있는 것"이 없어
아무 반응이 없었고, 직원은 반드시 앱을 열어 → 근태 → 출근/퇴근 → 스캔 순서를 밟아야 했다.

### 인코딩

QR 은 이제 **절대 URL** 을 담는다. **토큰 값 자체는 바뀌지 않았다.**

```txt
https://<앱주소>/mobile/attendance/capture?token=att_…
```

- 기준 주소는 **`NEXT_PUBLIC_APP_URL`** 이다(요청 호스트가 아니다). QR 은 인쇄물이라, 관리자가
  LAN IP 로 접속한 상태에서 뽑으면 현장에서 열리지 않는 QR 이 인쇄된다. 주소가 비어 있으면 예전처럼
  토큰만 담는다.
- **하위호환은 필수다.** 이미 붙어 있는 인쇄물은 토큰만 담고 있으므로 앱 내 스캐너는 두 형식을 모두
  받는다(`extractAttendanceToken`). 기존 QR 은 앱에서 계속 동작하지만, **카메라 기능을 쓰려면 건물별
  QR 을 새로 출력해 교체해야 한다.**

### 현장 정리 — 삭제 vs 비활성화 (2026-07-31)

출퇴근 현장을 목록에서 치울 수 있어야 한다는 요구가 있었지만, **삭제 범위는 스키마가 이미 정해
두었다.**

| 참조 | on delete |
| --- | --- |
| `attendance_qr_tokens.site_id` | `cascade` — QR 은 현장과 함께 사라진다 |
| `attendance_sessions.clock_in/out_site_id` | **`restrict`** — 출퇴근 기록이 있으면 삭제 거부 |
| `attendance_attempt_logs.resolved_site_id` | `set null` |
| `attendance_correction_requests.desired_*_site_id` | `set null` |

즉 **근태 기록이 한 건이라도 있는 현장은 삭제할 수 없다.** 급여 근거가 되는 기록을 지우지 않기
위한 설계이며 그대로 유지한다. 그래서 UI 는 두 갈래로 나눈다.

- **완전 삭제** — 기록이 한 번도 없는 현장만. 인라인 확인을 거치고, QR 토큰은 cascade 로 함께
  삭제된다. 그 현장에 붙여둔 인쇄 QR 은 즉시 죽는다(확인 문구에 명시).
- **비활성화** — 기록이 있는 현장은 `is_active = false` 로 운영에서만 뺀다. 기록은 보존되고,
  비활성 현장의 출퇴근은 이미 `submitAttendanceScan` 이 거부한다. 다시 활성화할 수 있다.

**비활성화해도 삭제할 수 있게 되지는 않는다.** 비활성화는 `is_active` 플래그만 끄고 근태 세션은
그대로 남으므로 FK restrict 가 계속 삭제를 막는다. 즉 실제로 사용된 현장의 최종 상태는 "비활성"이다.
삭제를 열어주려면 근태 기록을 지우거나 현장 연결을 끊어야 하는데, 둘 다 급여 근거를 훼손하므로
제공하지 않는다.

기록 유무는 `attendanceSiteHasHistory()` 로 미리 확인해, 삭제할 수 없는 현장에는 삭제 버튼 대신
안내를 띄운다(눌러도 실패만 하는 버튼을 두지 않는다). 이 판단은 `is_active` 를 보지 않고 세션 존재
여부만 본다.

목록에서 비활성 현장은 **기본으로 숨긴다.** 비활성 현장이 있으면 목록 상단에 「비활성 포함」 토글
(`?inactive=1`)이 개수와 함께 나타난다. 선택 중인 현장이 비활성이면 토글과 무관하게 항상 보인다
(상세 패널이 목록에 없는 현장을 가리키지 않도록).

**카운트·경고에서도 비활성 현장은 빠진다** — 설정 인덱스의 현장/QR 카운트, QR 화면 상단의
"QR 없는 현장" 경고 모두 활성 현장만 센다. 그러지 않으면 비활성화해도 경고가 남아 비활성화가
무의미해진다. 삭제·활성/비활성 전환은 `audit_logs` 에 남는다
(`attendance_site_delete` / `attendance_site_activate` / `attendance_site_deactivate`).

### QR 인쇄 (2026-07-31)

현장 벽에 붙일 물건을 뽑는 화면. `/admin/settings/attendance/print`.

- **카드 80×80mm 정사각**, QR 약 55mm. A4 한 장에 6장이 들어가고 점선 자르기 안내선이 있다.
  A4 한 장을 통째로 쓰는 안은 "현장에 붙이기엔 너무 크고 보기 안 좋다"는 이유로 채택하지 않았다.
- **담는 것은 QR 과 현장 이름뿐이다.** 설명 문구를 넣지 않는다 — 벽에 붙는 종이가 지저분해지고,
  어차피 찍으면 앱이 안내한다.
- 어드민 셸(사이드바·헤더)을 쓰지 않는 독립 라우트다. 인쇄물에 화면 요소가 섞이면 안 된다.
- 범위: 목록 상단 「전체 인쇄」(활성 현장 전부) / QR 카드의 「이 현장 인쇄」(`?site=`).
- **카메라로 열리지 않는 QR 은 인쇄 대상에서 제외한다.** 붙여도 동작하지 않는 종이를 뽑는 것이
  이 화면의 최악의 실패다. 대신 화면 상단(인쇄에는 안 나감)에 어느 현장이 왜 빠졌는지 알린다.
- 자동으로 인쇄 대화상자를 띄우지 않는다. 몇 장이 나오는지·제외된 현장이 있는지 먼저 확인한 뒤
  사용자가 누른다.

#### 인쇄용 이름 — `attendance_sites.print_name`

인쇄물의 현장 이름은 영문이어야 하는데, `attendance_sites.name` 은 한글이고 이 조직의 현장은
전부 `property_id` 가 비어 있어 `properties.display_name_en` 을 끌어올 수도 없었다.

한글 이름을 영문으로 바꾸는 대신 **인쇄 전용 이름 컬럼을 따로 두었다**(마이그레이션
`202607310002`). 어드민 화면·근태 기록은 계속 한글 이름을 쓰고, 인쇄물만 이 값을 쓴다.
비어 있으면 `name` 으로 폴백하므로 채우지 않아도 인쇄는 된다. 현장 설정 폼의
「인쇄용 이름 (영문)」 칸에서 입력한다.

### 미가입자가 QR 을 찍으면 (2026-07-31)

벽에 붙은 인쇄물이라 **지나가던 사람도 찍을 수 있다.** 방어선은 네 겹이고 전부 서버에서 판정한다.

| 검증 | 위치 |
| --- | --- |
| 로그인 필요 | `/mobile/attendance/capture` 진입 |
| 조직 소속 필요 (초대코드) | 온보딩 |
| **동일 조직 토큰** | `submitAttendanceScan` / 진입 화면의 사이트 조회 |
| GPS 필수 + 사이트 반경 | `submitAttendanceScan` |

- **로그아웃 상태** → 로그인 화면. 계정을 만들어도 온보딩에서 초대코드를 요구하므로 조직에 들어갈 수 없다.
- **다른 조직 직원** → 화면은 열리지만 토큰의 `organization_id` 가 달라 「사용할 수 없는 QR」이 뜨고,
  제출해도 서버가 거부한다. **토큰을 알아도 다른 조직에서는 무의미하다.**

로그아웃 상태로 QR 을 찍고 들어오면 로그인 화면에 **「출퇴근 QR을 읽었어요 · 직원 전용」** 안내를
띄운다(`auth.entry.qrNotice*`). 아무 설명 없이 로그인 화면만 뜨면 지나가던 사람이 무엇을 찍었는지
알 수 없기 때문이다. 안내 언어는 `?lang=` → `stayops_locale` 쿠키 → **Accept-Language** 순으로
정해지므로, 처음 방문한 일본어 단말에는 일본어로 뜬다.

**함께 고친 것:** 로그인 페이지가 모바일에서 `next` 를 무조건 `/mobile` 로 덮어쓰고 있었다.
`/admin/...` 목적지를 앱으로 돌리려는 의도였는데 모바일 경로까지 함께 버려서, 로그아웃 상태로 QR 을
찍은 직원이 로그인 후 인증 화면이 아니라 홈으로 떨어졌다(토큰이 사라졌다). 이제 이미 모바일 경로인
`next` 는 그대로 지킨다.

### 인쇄 전 안전장치 (2026-07-31, 실제 사고 후 추가)

`NEXT_PUBLIC_APP_URL` 이 비어 있으면 QR 은 **조용히 예전 형식(토큰만)** 으로 그려진다. 화면상으로는
멀쩡해 보이지만 카메라로 찍으면 그냥 검색어로 읽힌다 — 실제로 이 상태로 확인하다 한 번 겪었다.
QR 은 인쇄물이라 잘못 뽑으면 전 건물을 다시 붙여야 하므로, 관리자 화면이 출력 전에 판정해서 알린다.

| 상태 | 화면 표시 | 조치 |
| --- | --- | --- |
| `ok` (공개 https 주소) | 초록 "휴대폰 카메라로 열립니다. 출력해도 됩니다." | 출력 진행 |
| `local` (localhost·사설망) | 노랑 경고 | 운영 사이트에서 다시 확인 후 출력 |
| `missing` (URL 아님 = 토큰만) | 노랑 경고 | `NEXT_PUBLIC_APP_URL` 설정 → 재배포 후 재확인 |

판정 로직은 `attendanceQrLinkState()` (`src/lib/attendance-qr.ts`), 테스트는
`src/lib/__tests__/attendance-qr.test.ts`. **QR 은 반드시 운영 사이트에서 뽑는다** — 로컬 개발 서버에서
뽑으면 `http://localhost:3000` 이 박혀 현장 휴대폰에서 열리지 않는다.

### 기기별 동작 (확인된 제약)

| 기기 | 카메라로 QR 촬영 시 |
| --- | --- |
| Android | 링크 배너 → URL 이 PWA scope(`/`) 안이라 **설치된 앱 창으로 열린다.** 의도한 동작. |
| iOS | **Safari 로만 열린다.** 홈 화면 PWA 로 넘기는 방법이 iOS 에 없다(Universal Links 는 네이티브 앱 필요). iOS 16.4+ 는 standalone PWA 와 Safari 의 저장소가 분리돼 있어 Safari 에서 재로그인이 필요할 수 있다. |

iOS 사용자는 기존처럼 앱에서 스캔하는 동선이 여전히 가장 빠르다. 두 동선 모두 유지한다.

### 진입 화면

건물 QR 에는 **방향(출근/퇴근) 정보가 없다.** 그래서 링크로 들어오면 카메라를 켜지 않고 진입
화면을 보여준다.

- 어느 건물의 QR 인지(토큰 → 사이트 이름 조회)와 GPS 상태를 먼저 보여준다.
- 직원이 **「출근 인증」 / 「퇴근 인증」** 을 고르면 그 토큰으로 바로 제출한다.
- 토큰이 더 이상 유효하지 않으면(재발급·폐기) "사용할 수 없는 QR" 안내와 앱 스캔 경로를 준다.
- 로그아웃 상태면 로그인으로 보내되 **토큰을 `next` 에 실어** 인증 후 같은 화면으로 돌아온다.

### 보안 — 바뀐 것 없음

토큰이 URL 로 노출돼도 판정은 전부 서버(`submitAttendanceScan`)가 그대로 한다: 동일 조직의 **활성**
토큰 + **활성** 사이트 + **GPS 필수** + **사이트 반경 이내**. 링크를 받아도 현장에 있지 않으면
인증되지 않으므로 대리 출근 위험은 이전과 동일하다. 진입 화면의 사이트 이름 조회는 **표시용**이며
인증이 아니다.

관련 파일: `src/lib/attendance-qr.ts`(인코딩/파싱, 테스트
`src/lib/__tests__/attendance-qr.test.ts`), `src/lib/attendance-sites.ts`
(`getSiteNameByActiveQrToken`), `src/app/mobile/attendance/capture/page.tsx`,
`src/components/attendance/attendance-capture.tsx`, `src/app/admin/settings/attendance/page.tsx`.

## Trusted Device — 재로그인 없이 打刻 (2026-07-31)

### 왜 필요한가

위 QR 딥링크에서 아이폰은 **Safari 로만** 열린다. iOS 는 홈 화면 PWA 와 Safari 의 저장소가 분리돼
있어 로그인 세션을 공유하지 않는다. 그래서 QR 로 들어올 때마다 재로그인을 요구받는 상황이 생긴다.
로그인 수단(구글/이메일)을 바꿔도 이 구조는 그대로다.

### 방식

**한 번 로그인해 실제로 打刻에 성공한 기기**를 기억한다. 그 다음부터는 인증 세션이 없어도 그
기기에서 出退勤만 바로 된다.

- 발급 시점: 打刻 **성공 직후**(출근 또는 퇴근). 화면만 열어서는 발급되지 않는다 — 실제로 현장에서
  쓴 기기라는 증거가 있는 셈이다.
- 저장: `attendance_trusted_devices` (조직·사용자·**토큰 sha256 해시**·기기 라벨·최종 사용·만료·폐기).
  **원문 토큰은 DB 에 없다.** 쿠키에만 있다.
- 쿠키: `stayops_att_device` — HttpOnly · Secure · SameSite=Lax · **`Path=/mobile/attendance`**
  (근태 경로 요청에만 실린다).
- 만료: **180일 슬라이딩.** 쓸 때마다 다시 180일로 밀린다. 반년간 한 번도 안 쓰면 자동으로 죽는다.
- 기기 라벨은 UA 에서 "iPhone · Safari" 수준만 뽑아 저장한다. 원본 UA 는 보관하지 않는다.

### 권한 경계 (이 기능의 핵심 — 넓히지 말 것)

이 자격증명이 허용하는 것은 **출근/퇴근 打刻 두 가지뿐**이다.

- 근무 이력 · 급여 · 정정 요청 · 프로필 · 다른 모듈 · 어드민 = **전부 불가.** 그 화면들은 여전히
  정상 인증 세션을 요구한다.
- `middleware.ts` 의 보호 경로는 이 기능 때문에 넓히지 않는다.
- 신원 대체는 `submitAttendanceScan` 과 QR 진입 화면 렌더링에서만 일어난다
  (`resolveTrustedDevice()`). 다른 어떤 권한 판단에도 쓰지 않는다.
- **GPS 필수 + 사이트 반경 검증은 그대로다.** 쿠키만으로 현장 밖에서 打刻할 수 없다.
- 조직 멤버십이 `active` 가 아니면 즉시 무효 — 퇴사·정지 처리하면 그 기기도 같이 죽는다.
- 진입 화면에 **"○○○님으로 기록됩니다"** 를 명시해 다른 사람으로 잘못 찍히는 걸 막는다.

### 폐기 경로

- **로그아웃**: 쿠키 삭제 + DB 폐기. 명시적 로그아웃은 "이 기기에서 나가겠다"는 뜻이므로 기억도 함께 끊는다.
- **기기 주인 변경**: 같은 기기에서 다른 사람이 로그인해 打刻하면 이전 자격증명을 폐기하고 새로 발급한다.
- **관리자 해지**: 어드민 → 설정 → 근태의 **「기억된 기기」** 목록에서 해지. 휴대폰 분실·퇴사 시 사용한다.
  해지는 `audit_logs`(`attendance_trusted_device_revoke`)에 기록된다.
- **만료**: 180일 미사용 시 자동.

### 부수 효과

iOS 전용 대책이 아니다. 안드로이드·PWA 에서도 세션이 만료된 사람은 같은 혜택을 받는다.

관련 파일: `src/lib/attendance-trusted-device.ts`,
`supabase/migrations/202607310001_attendance_trusted_devices.sql`,
`src/app/mobile/attendance/actions.ts`(打刻 시 신원 대체 + 기억),
`src/app/mobile/attendance/capture/page.tsx`, `src/app/auth/actions.ts`(로그아웃 폐기),
`src/app/admin/settings/attendance/*`(목록·해지).

Remaining/explicitly limited scope: Wi-Fi attendance stays inactive; QR **scanning inside the app**
remains mobile-only due to physical device constraints (the camera deep link above does not change
that — it only removes the manual navigation before the scan); payroll premiums
(overtime/holiday/night) remain out of scope; broader automated midnight sweep and advanced
export/reporting refinements are handled in the technical roadmap.

## 2026-08-03 정정 요청 · 로스터 · 연차 승인 — 3건 수정

### 정정 요청 재제출은 기존 pending 을 갱신한다 (supersede)

예전에는 재제출이 무조건 INSERT 였다. 화면(`getCorrectionRequestView`)은 최신 1건만 보여주는데
마감 판정(`getFinalizationEligibility`)은 `requested|in_review` **전 건**을 세므로, 같은 날
재요청하면 **화면엔 1건인데 마감은 2건으로 막혔고** 관리자 큐에도 서로 모순되는 요청이 2건 떴다.

→ 같은 대상(같은 `session_id`, 세션 없는 예외 요청은 `session_id is null` + 같은 `target_month`)의
본인 pending 요청이 있으면 **그 행을 갱신**한다. 갱신 시 `status` 를 `requested` 로 되돌리고
`review_comment` / `reviewed_at` / `reviewed_by_user_id` 를 비운다 — 관리자가 보던 값이 이미
사라졌으므로 재검토가 맞다. UPDATE 에 상태 가드를 걸어 **읽기~쓰기 사이에 관리자가 처리해버린
레이스**에도 안전하고, 0행 갱신되면 새 INSERT 로 폴백한다.

- **미완**: 이미 쌓인 legacy 중복 pending 행은 이 변경으로 정리되지 않는다(관리자 큐에서 개별 처리).
### 정정 요청 철회 (2026-08-03, 마이그레이션 `202608030001`)

요청자가 **아직 처리되지 않은 요청(`requested` / `in_review`)을 스스로 거둘 수 있다.** 예전에는
잘못 낸 요청을 되돌릴 방법이 없어, 관리자가 반려해 줄 때까지 대기 큐에 남고
`getFinalizationEligibility` 가 그 요청을 세므로 **그 달의 근태 마감까지 막혔다.**

- 상태 `cancelled` + `cancelled_at` 추가. 하드 삭제가 아니라 상태인 이유: 관리자가 이미 검토를
  시작했을 수 있고, 마감 판정과 감사 흐름이 요청 이력을 근거로 삼는다. 연차 요청도 같은 이유로
  `cancelled` 상태를 쓴다 — 그 선례를 따랐다.
- 행위자는 항상 요청자 본인이라 `cancelled_by` 컬럼은 두지 않았다.
- **강제는 서버에서.** service-role 쓰기라 RLS 가 막지 않으므로 UPDATE 의
  `organization_id` / `requested_by_user_id` / `status in (requested, in_review)` 조건이 유일한
  경계다. 관리자가 그 사이에 승인/반려하면 0행이 갱신되고 `not_pending` 으로 떨어진다(레이스 안전).
- 대기 큐와 마감 판정은 `requested|in_review` 만 세므로 `cancelled` 는 두 곳에서 자동으로 빠진다.
- UI: 상태 화면의 철회 버튼 → 공용 `BottomSheet` 확인. 상태 칩은 반려와 달리 **중립색**
  (스스로 거둔 것이지 거절당한 게 아니다).

### 어드민 정정 큐에 증빙 사진 표시

모바일은 정정 요청에 사진을 첨부하는데(`image_urls`) 어드민 조회·패널이 그 필드를 아예 읽지 않아
**관리자가 사진 없이 승인/반려**하고 있었다. `AdminCorrectionRow.imageUrls` 를 추가하고, 교통비
패널과 **동일한 썸네일 + 공용 `ImageLightbox`** 를 재사용해 표시한다(사진 0장이면 누락 표시).

### 로스터 상태 판정 — DB enum 과 표시용 키를 구분

`deriveStatus()` 가 raw `review_state`(DB 값 `review_required`)를 **표시용 키**(`needs_review`)와
비교하고 있었다. 그래서 `needs_review` 가 절대 생성되지 않았고 어드민 로스터의 **danger dot · flag
행 · 카운트 타일이 전부 dead code** 였다. 타입에서 상수를 가져와 비교하도록 고쳐 **오타 시 컴파일
에러**가 나게 했고, `RosterStatusKey` 에 "DB enum 이 아니라 표시용 키" 주석을 남겼다.

### 연차 승인 잔여 계산 — 기사용분 차감

`poolRemainingFor()` 가 `computeAnnualLeaveSummary()` 를 호출하면서 `usedDays` /
`specialUsedDays` 를 넘기지 않았다. 두 파라미터의 기본값이 `0` 이라 **조용히 통과**했고, 그 결과
승인 모달의 "잔여 영향" 이 총 부여일수 기준으로 나오고 **잔여 초과 경고가 발화 자체를 하지
않았다**(`remaining - daysCount < 0` 이 성립 불가).

→ 모바일 잔여 화면이 쓰는 정본 `getMyAnnualLeaveSummary()` 에 **위임**한다. 승인 화면용 별도
계산을 만들지 않는다 — 같은 숫자를 두 화면이 보여줘야 한다.

- 부수: `balanceAfter` 가 음수가 될 수 있어 잔여 막대 `width` 를 0–100% 로 클램프했다.
- **경고만, 차단 없음** 이라는 기존 설계는 유지했다. 다만 **승인 모달 자체에는 초과 경고 UI 가
  없어** 승인자가 모달만 보고 초과를 알아채기 어렵다 — 설계 변경이라 별도 결정 사항.
- **확인 필요**: 경고가 그동안 발화하지 않았으므로 **잔여를 초과해 승인된 건이 남아 있을 수 있다.**
  계산 엔진이 초과분을 0 에서 클램프해 화면상 드러나지 않는다.

### 출근자 명단 권한 — 현황 기록 (변경 없음)

`canViewRoster()` 는 **무조건 `true`** 이고 모바일 로스터는 근무 중인 동료의 **전화번호 + `tel:`
통화 링크**를 전 조직원(파트타임 포함)에게 노출한다. 어드민 로스터는 콘솔 세션 게이트가 있고
전화번호를 표시하지 않는다. `src/config/roles.ts` 주석("roster is not a privileged view")상
**의도된 결정**으로 보이나, `src/app/mobile/attendance/roster/page.tsx` 최상단 주석은 아직
"매니저/오피스 역할만 접근 가능"이라 **코드와 모순**이다. 권한을 좁히기로 한다면 UI 숨김이 아니라
`getAttendanceRoster` 에서 **서버 측으로 `phoneNumber` 를 null 처리**해야 한다(CLAUDE.md §6).

**판정(2026-08-03): 개방은 의도된 것, 주석이 거짓이었다.** `roles.ts` 의
"roster is not a privileged view" 가 확정 결정이고, 페이지 주석이 말하던
"cleaningRecordViewerRoles 로 리다이렉트" 하는 코드는 **존재한 적이 없다**(청소 기록 열람 권한과
혼동한 서술). 권한은 그대로 두고 **주석만 실제 동작으로 정정**했다. 전화번호 + `tel:` 링크 노출도
"현장에서 서로 연락하라"는 이 화면의 목적에 부합하므로 유지한다.

## 교통비 출근지 — 캘린더 건물 + 사무실 + 기타 (2026-09-11)

### 왜 고쳤나

출근지가 **코드에 박힌 문자열 목록**이었다(`transport-statement.tsx` 의 `BUILDING_KEYS`).
두 가지가 동시에 틀어져 있었다.

1. **새로 연 건물이 목록에 없었다.** 2026-09 에 문을 연 STAY ARI Apartment Hotel 로 출근한
   알바생은 **고를 항목 자체가 없었다.** 목록에는 대신 `스카이` 가 있었는데, 그건 같은 건물의
   **오픈 전 이름**이었다.
2. **저장되는 값이 「번역된 라벨」이었다.** 일본어로 쓰는 직원이 고르면 `高田馬場`, 한국어면
   `다카다노바바` 가 저장된다 — 같은 건물이 언어별로 다른 값이 된다.

### 지금의 목록

| 종류 | 출처 | 키 |
| --- | --- | --- |
| 건물 | **캘린더와 같은 건물 집합**(Beds24 동기화, 사노 제외) | `property_id` |
| 사무실 | 고정 항목 | `"office"` |
| 기타 | 고정 항목 | `"other"` |

건물이 늘면 목록이 따라온다 — 코드를 고칠 필요가 없다. 사노가 빠지는 기준은 캘린더와 같다
(`isExcludedOperationalProperty`).

**이름도 캘린더와 같아야 한다.** `properties.name` 은 Beds24 원본(`Arakicho A`, `Okubo_A (B棟)`)
이라 그대로 보여주면 캘린더는 한국어인데 교통비만 영어가 된다. 반드시
`getCanonicalPropertyName()` 으로 정규화한 뒤 `localizePropertyName()` 에 넘긴다 — 정규화를
빼먹으면 매핑이 하나도 안 걸려 원본이 그대로 나온다. 회귀 테스트로 잠가 두었다.

매핑이 없는 건물(STAY ARI 등)은 원본 이름을 쓴다 — 이것도 캘린더와 같은 동작이다.

저장은 `property_id` + `work_context.destinationKey` 로 한다. 표시 라벨(`buildingLabel`)도 같이
남기지만 **키로 쓰지 않는다.**

### 기타는 메모가 필수다

건물 외 영수증은 **사유가 유일한 근거**다. 어디에 왜 썼는지가 없으면 나중에 정산할 수 없다.
그래서 「기타」를 고르면 메모가 없으면 저장 버튼이 잠기고, **서버도 같은 판정을 한 번 더 한다**
(`memo_required`). 화면만 막으면 다른 경로로 들어온 요청이 그대로 통과한다.

판정은 `transportDestinationRequiresMemo()` 한 곳에 있다
(`src/lib/transport-destinations.ts` — 순수 모듈이라 화면과 서버가 같은 함수를 본다).

### 금액을 기억한다

**같은 사람이 같은 곳으로 가면 운임은 그대로다.** 그래서 출근지를 고르면 그 사람이 **마지막에
그곳에 넣은 금액**을 입력칸에 미리 채운다. 하루 10~20명이 매일 왕복 금액을 손으로 치는 일이
대부분 사라진다.

지키는 규칙 세 가지:

- **이미 친 값은 덮지 않는다.** 오늘 금액을 먼저 입력한 사람의 값을 덮는 것이 더 나쁜 실수다.
- **언제 것인지 같이 보여준다** (「9/10과 같음」). 근거 없이 숫자만 들어가 있으면 확인 없이
  넘기게 되고, 운임이 바뀐 날에 틀린 값이 그대로 확정된다.
- **기타는 기억하지 않는다.** 매번 다른 목적의 지출이라 지난 금액이 근거가 못 된다.

「가장 최근 값」을 쓴다(가장 흔한 값이 아니라) — 운임이 오르면 다음부터 새 값이 따라와야 한다.

**영수증은 그대로 매일 첨부한다.** 자동 채움은 금액 입력을 덜어줄 뿐 증빙을 대신하지 않는다.

### 엑셀·PDF

두 내보내기 모두 **출근지와 메모**가 나간다(공용 계약 §4b — 엑셀과 PDF는 항상 같이).
컬럼: `No · 직원 · 날짜 · 출근지 · 메모 · 상태 · 금액`.

엑셀 합계 수식은 `AMOUNT_COL` 에서 열 글자를 만들어 쓴다. 예전에는 `F` 로 박혀 있었는데, 메모
열을 넣자 금액이 `G` 로 밀려 **합계가 엉뚱한 열을 더할 뻔했다.**

### 남은 것

수정 시트에서는 **출근지를 바꿀 수 없다**(금액·메모·객실만 수정 가능). 화살표 아이콘이 있어
누를 수 있어 보이지만 동작하지 않는다 — 기존 상태 그대로 두었다.


## 자동 연결 — 실제 근무 기록에 이어붙인다 (2026-09-11)

### 고치기 전에는 아무 일도 안 했다

입력 방식에 「자동 연결 / 직접 입력」 이 있었는데, **자동 연결은 표시만 바꿀 뿐이었다.**

- 후보 목록(`getLinkedTransportCandidates`)을 서버에서 읽어 prop 으로 넘기고는 있었지만
  **화면이 그것을 꺼내 쓰지 않았다**
- 버튼을 눌러도 날짜·건물이 채워지지 않고 근태와 이어지지도 않았다
- 저장되는 행에 `entry_mode: 'linked'` 라고 **적히기만** 했다 — 기존 29건 전부
  `attendance_session_id` 가 null 이다

즉 **기록이 사실과 달랐다.** 「자동 연결」을 골랐으니 연결됐겠거니 생각하게 되는데 연결된 것이
없다.

### 지금의 동작

자동 연결을 고르면 **그 달의 실제 근무 기록**이 목록으로 뜬다.

| 후보 | 출처 | 이어지는 것 |
| --- | --- | --- |
| 출퇴근 | `attendance_sessions` | `attendance_session_id` + 근무지의 `property_id` |
| 청소 | `cleaning_sessions` | 객실 → 건물의 `property_id` |

하나를 고르면 **날짜와 건물이 채워지고**, 그 건물의 지난 금액이 있으면 금액까지 미리 들어간다.
같은 날 이미 교통비를 넣었으면 「이미 등록됨」이 붙는다 — **막지는 않는다.** 하루에 두 번
이동하는 날이 있다.

`attendance_sites` 에 건물 FK 가 있어서 출퇴근 후보도 건물로 이어진다. 그래야 금액 기억이
자동 연결에서도 동작한다.

### 근무지에 건물을 연결한다 (설정 화면)

`attendance_sites.property_id` 는 처음부터 있었고 `createAttendanceSite` ·
`updateAttendanceSite` 도 그 값을 받도록 돼 있었다. 그런데 **설정 화면에 고를 칸이 없었다** —
폼이 보내는 값은 이름·인쇄명·좌표·반경뿐이었다. 그래서 근무지 9곳 전부 `property_id` 가 null
이었고, 교통비 자동 연결이 그 FK 를 따라가려 하자 아무것도 이어지지 않았다(「9/10 사무실」을
골라도 건물 칸이 그대로였다).

`/admin/settings/attendance` 근무지 편집에 **「건물」 선택 칸**을 추가했다. 목록은 캘린더·교통비와
같은 건물 집합이고, **「건물 아님 (사무실 등)」** 을 고르면 연결을 비운다.

2026-09-11 에 기존 9곳을 연결했다. 근무지 이름과 건물 이름이 달라도(`아라키초A` ↔ `Arakicho A`,
`스카이` ↔ `STAY ARI Apartment Hotel`) FK 로 묶여 정확히 이어진다. 출퇴근 기록 38건이 건물로
해석되고, 남은 9건은 사무실이라 정상이다.

> 「스카이」는 STAY ARI 의 **오픈 전 이름**이다. 출퇴근 기록이 `site_id` 로 묶여 있어 이름을
> 바꿔도 기록에는 영향이 없지만, 출퇴근 화면과 벽에 붙이는 QR 인쇄물(`Sky`)에 보이므로 현장과
> 함께 정하는 편이 낫다. 건물 연결만으로 기능은 이미 정상이다.

### 이름으로 맞추는 대비책

FK 를 채우는 것이 정답이지만 그건 운영 데이터 정리다. 그 사이에도 화면은 동작해야 하므로
**건물 이름으로 맞춰 본다**(`matchDestinationByLabel`). 표기가 갈려도
`getCanonicalPropertyName` 이 흡수하고, 못 찾으면 비워 둔다 — 엉뚱한 건물을 고르느니 낫다.

「사무실」처럼 **애초에 건물이 아닌 근무지**는 FK 를 채워도 여전히 이름으로만 이어지므로, 이
대비책은 데이터 정리 뒤에도 쓸모가 남는다.

**근무지 목록도 낡아 있다**: 「스카이」(STAY ARI 의 오픈 전 이름)가 남아 있고 STAY ARI 가 없다.
그 건물로 출근한 기록은 이름이 안 맞아 건물이 비워진다.

### 고르지 않으면 저장되지 않는다

자동 연결을 골라 놓고 근무 기록을 안 집으면 저장 버튼이 잠긴다. **서버도 같은 판정을 한 번 더
한다** — `entry_mode: 'linked'` 인데 `attendance_session_id` 도 `property_id` 도 없으면
`link_target_required` 로 거절한다. 화면만 막으면 다른 경로로 들어온 요청이 그대로 통과해서,
고치기 전과 똑같은 「연결됐다고 적혔지만 연결된 것 없는」 행이 다시 쌓인다.

### 이 모드의 값어치

근태와 이어지면 **「출근하지 않은 날의 교통비」가 자연히 걸러진다.** 후보 목록 자체가 실제 근무
기록이라, 목록에 없는 날은 애초에 자동 연결로 넣을 수 없다.

## 정정 요청 — 자정을 넘는 퇴근은 다음 날로 (2026-10-01)

직원 정정 요청(`createAttendanceCorrectionRequest`)이 희망 퇴근 시각을 **항상 운영일과 같은 날**로 붙였다.
22:00 출근 · 06:00 퇴근 같은 야간 근무를 요청하면 퇴근이 출근보다 앞선 값으로 저장됐고, 관리자가 승인하는
순간 순서 검사(`validClockOrder`)에 걸려 `invalid` 로 떨어졌다. 관리자 수동 수정·수동 생성은 이미 다음 날로
넘기고 있어서 **같은 일을 두 경로가 다르게** 하고 있었다.

- 규칙: 같은 날로 붙인 퇴근이 출근 **이후가 아니면** 다음 날로 넘긴다. 비교 기준은 희망 출근, 없으면 그
  세션의 실제 출근. 비교할 출근이 없으면(세션 없는 예외 요청에 퇴근만 적은 경우) 같은 날 그대로.
- 두 경로가 한 함수를 쓴다: `resolveClockOutAfterClockIn` (`src/lib/attendance-clock.ts`). 회귀 테스트
  `src/lib/__tests__/attendance-clock.test.ts`.
- 자정을 넘는 값은 승인 시 기존 규칙대로 `review_required` 로 걸린다(바뀐 것 없음).

## 예외 정정 요청 — 근무 날짜를 고른다 (2026-10-01, 마이그레이션 `202610010002`)

세션 없는 예외 요청(QR·GPS 실패 등으로 기록 자체가 없는 날)은 날짜를 고를 수 없어 **늘 오늘로** 접수됐고, 날짜를
어디에도 저장하지 않았다. 어제 기록이 없다는 걸 오늘 알면 어제 근무가 오늘 날짜로 들어갔다.

- 폼(`attendance-correction-form.tsx`): 세션이 없을 때만 **「근무 날짜」** 칸(필수, 기본 오늘)을 보인다. 날짜 시트는
  입사일 시트(`hire-date-picker.tsx`)를 `title` · `minDate` 로 넓혀 재사용 — 오늘 이후와 전월 1일 이전은 막힌다.
  i18n `attendance.corrFieldWorkDate`(근무 날짜 / 勤務日 / Work date), `corrSessExceptionNote` 문구 교체(ko/ja/en).
- 서버(`createAttendanceCorrectionRequest`): `targetDate` 를 받아 형식 · 오늘 이후(`out_of_range`) · 당월/전월 창을
  다시 검사한다. 희망 시각은 그 날짜에 붙는다(자정 넘김 규칙은 위 절 그대로).
- 저장: `attendance_correction_requests.target_date date`(세션 없는 요청만, 세션 요청은 null — 세션 운영일이 날짜).
  기존 예외 요청은 희망 출근(없으면 퇴근)의 도쿄 날짜로 채웠다(당시 0건). 월 마감 판정은 계속 `target_month` 를 쓴다.
- **대기 중 요청 덮어쓰기(supersede) 짝**도 `target_month` → `target_date` 로 바꿨다. 날짜를 고를 수 있게 된 뒤로
  같은 달 다른 날 요청끼리 덮으면 앞 요청이 사라지기 때문이다.
- 표시: 직원 요청 상태 화면(`toRequestView`)과 관리자 정정 목록(`getAdminAttendanceCorrections`)이 세션이 없으면
  `target_date` 로 날짜를 보여 준다(예전에는 빈칸).

## 관리자 근태 — 큐 1,000행 · 방치 표시 (2026-10-01)

- **검토 큐 1,000행 잘림**: `getAttendanceReviewQueue` 가 `limit`(관리자 큐 5,000)을 걸어도 PostgREST 상한 1,000행에서
  조용히 잘렸다. `limit` 에 닿거나 마지막 쪽이 올 때까지 1,000행씩 읽는다(정렬 끝에 `id`). 휴게 합계 · 정정 상태 조회는
  세션 id 를 200개씩 나눠 `.in()` 한다(URL 길이). 당시 한 달 47건이라 화면 변화는 없다.
- **방치 세션을 관리자 수정으로 닫을 때** `abandoned_at` 을 지운다 — 정정 승인 경로는 이미 지우고 있었다.

## 휴게 차감 · 정정 승인 순서 (2026-10-05)

**급여에서 빼는 휴게는 근무 시간 안의 것만** — `breakSecondsBySession`(`src/lib/attendance-pay-calculation.ts`, 테스트
`attendance-break-window.test.ts`). 직원 월 급여 · 관리자 검토/급여 · 일별 장부가 같은 함수를 쓴다.

- 휴게를 세션의 [출근, 퇴근] 안으로 자른다. 관리자가 출퇴근 시각을 옮겨 휴게가 근무 밖으로 나가면 그 부분은 빼지 않는다
  (전에는 근무 밖 휴게도 그대로 차감).
- **닫힌 세션에 열린 휴게**가 남았으면 퇴근 시각에 끝난 것으로 본다. 모바일은 휴게 중 퇴근을 막지만 관리자 수정 · 정정
  승인으로 닫으면 휴게가 열린 채 남는다 — 전에는 그 휴게를 아예 빼지 않아 과지급이었다. 휴게 종료도 퇴근도 찍지 않고
  떠난 경우라 그 뒤는 일하지 않은 시간으로 본다. 아직 열린 세션의 열린 휴게는 세지 않는다.

**정정 승인은 「요청 승인 확정 → 세션 반영」 순서**(`approveCorrectionRequest`).

- 요청을 먼저 `approved` 로 바꾼다(내가 잡은 `in_review` 일 때만 — 동시에 누른 두 번째 승인은 여기서 떨어진다).
- 그다음 세션을 바꾸거나 만든다. **0행이면 실패**로 보고(`review_state` 조건에 걸린 경우) 요청을 `in_review` 로 되돌린다.
  전에는 0행이어도 성공으로 보고 「세션은 그대로인데 요청만 승인」이 될 수 있었다.
- 두 쓰기가 한 트랜잭션은 아니지만 어긋난 채 끝나는 길은 없다. 감사 로그는 반영이 성공한 뒤에 남긴다.

## 화이트 리디자인 — 근태 운영 개요 · 근태 홈 (2026-10-13)

시안 Att-PC · Att-Phone · Att-Fold · Att-Tablet 그대로. 규칙은 `docs/design/05-white-redesign.md`.

- **관리자 위 탭 줄(7개 탭 공용, `.subnav`)**: 상자 대신 글자 탭 + 밑줄, 아래 가는 줄. 아이콘은 감추고 개수는 탭 옆 작은 숫자(긴급 = 빨강). 오른쪽 달 선택은 그대로.
- **근태 운영 개요**: 숫자 줄 5칸(검토 필요 세션 — 긴급이 있으면 빨강 · 정정 요청 · 급여(예상) · 제외 기록 · 교통비 대기) → 즉시 검토(검토 필요 세션 | 정정 요청 두 칸,
  줄 = 이니셜 · 이름 · 날짜 · 시각 · 현장 · 오른쪽 글자 배지 — 긴급 빨강 / 검토 필요 주황 / 정정 항목 보라) → 급여 · 교통비 요약(숫자 셋 · 안내 줄). 카드 상자 없음.
  공용 흰 프리미티브(`.wkpis` · `.wsec` · `.wcols` · `.wrow` · `.wtag` · `.wstats`)를 `admin-console.css` 맨 아래에 새로 두었다 — 다음 화면들도 쓴다.
- **근태 홈(모바일)**: 인사말 대신 제목 「근태」 + 「날짜 · 이름 님」. 링(근무 중 보라, 시 · 분 · 초 같은 크기) → 방법 두 글자(GPS + QR 보라 · Wi-Fi 준비중 회색) →
  출근 장소 · 시각 옅은 칸 → **휴게 시작 | 퇴근하기 나란히**(출근 전은 「출근하기」 한 줄) → 바로가기 줄(옅은 보라 아이콘 칸, 상자 없이 가는 줄). 휴게 중 화면은 구조 그대로 색만.
- 고친 것: 근무 중 화면에 퇴근 미기록 배너가 **두 번** 그려지던 것, 바로가기 「교통비 제출」 오른쪽의 **가짜 금액 ¥13,160 · 「작성 중」**(실데이터가 아니었다) 제거.
- 넓은 화면: 폴드 = 가운데 560px 한 줄, 태블릿 가로 = 왼쪽 링 · 버튼 | 오른쪽 바로가기(기존 그대로).
- **근태 검토 큐(2026-10-13)**: 공용 표 · 배지 · 보기 탭을 흰 톤으로(디자인 05번). 보기 탭 · 열 · 일괄 선택 · 근무 추가 · 상세 패널 동작은 그대로. 긴급 줄의 왼쪽 빨간 막대는 없앴다(빨간 「긴급」 배지는 그대로).
- **디테일 다듬기(2026-10-13 시안 컨펌 → 구현)**:
  - 근태 개요 검토 필요 세션 줄의 배지가 사유를 말한다 — **퇴근 누락**(퇴근 기록 없음) · **장시간**(인정 12시간 초과) · **이상 감지**(시스템 표시), 긴급이면 「긴급 · 사유」. 위치(현장 밖) 같은 측정할 수 없는 사유는 쓰지 않는다.
  - 근태 홈 링 아래 「오늘 누적 근무 · **8시간 기준**」(링이 무엇을 기준으로 차는지).
  - 근태 홈 태블릿 가로에 **오늘 기록**(출근 · 현장 · 시각, 휴게 중이면 시작 시각, 끝난 휴게는 횟수 · 합계) — 왼쪽 아래 빈 곳. 휴게 시작 · 끝 각각의 시각은 지금 화면 데이터에 없어 합계로 보여 준다.
  - 바로가기 이름 · 순서를 시안대로: **근무 기록 · 급여 · 연차 · 출근자 명단 · 교통비 정산**. 연차의 오래된 「NEW」 배지 제거, 교통비의 고정 문구 「6월 정산 장부」 → 「이번 달 정산」.
- **HIG 다듬기 2차(2026-10-19, 시안 A2Att-Phone · Fold · Tablet)**:
  - 링 **240 · 두께 12**, 가운데 시간 **34**(초는 옅은 회색) — 숫자가 링에 닿지 않게(전 252 · 14 · 44). 상태 「근무 중」 15 + 옅은 고리 점.
  - 방법은 색 알약 대신 링 아래 **회색 글자 한 줄** 「GPS+QR · Wi-Fi 준비 중」.
  - 출근 현장 · 시각 칸 54 · 값 16/600, 버튼 높이 50.
  - 「바로가기」 구역 제목 17/600(위 구분선 없음). 줄 = 아이콘 36 · 이름 16/500 · 설명 13 · 최소 62 · 오른쪽 ›, 구분선은 공용 규칙(0.5px · 글자 시작점 48부터).
    급여 눈 버튼은 보이는 원 28 그대로, 누르는 자리 44.
  - 넓은 화면: 폴드 = 가운데 520px 한 줄. 태블릿 가로 = 제목 아래 **두 칸 같은 폭** — 왼쪽 링 · 현장/시각 · 버튼, 오른쪽 바로가기 + **오늘 기록**(근무 중일 때, 줄 16/13 · 52 · 구분선 20부터).
    오늘 기록은 왼쪽 아래 → 오른쪽 바로가기 아래로 옮겼다. 코드: 화면을 `.att-main` · `.att-side` 두 덩어리로 나눔(폰은 위아래 그대로).

## 화이트 리디자인 — 출근 QR (2026-10-13, 시안 AttQR-Phone · Fold · Tablet · AttQRFail-Phone · AttQRLand-Phone)

- `attendance-capture.tsx`: 스캔 화면을 **화면 전체 어두운 화면**으로(셸 위 `<body>` 포털 — 레일 · 사이드바까지 덮음). 카메라 영상 위 어두운 막에 사각 구멍, 위 「출근(퇴근) QR을 비춰 주세요」 + 안내, 아래 GPS 알약(확인됨 초록 · 확인 중 깜빡임 · 꺼짐 빨강), 카메라 실패면 「카메라 다시 시도」, 맨 아래 「QR을 못 찍나요? 정정 요청 ›」.
  방식 카드(GPS+QR · Wi-Fi 준비중) · 「1/2 · QR 스캔」 단계 표시는 뺐다. 위층이라 화면 스와이프 뒤로가기가 닿지 않아 **왼쪽 위 ×**(사진 뷰어와 같은 방식, `data-native-back-overlay`) · Esc · 안드로이드 뒤로가기로 나간다.
- **현장 QR 로 연 경우**: 같은 어두운 화면 + 아래 흰 판 「{현장} · 현장 QR / 출근할까요, 퇴근할까요? / 출근 · 퇴근」(기억된 기기면 이름 줄), 못 쓰는 QR이면 「앱에서 직접 스캔하기」.
- **결과 시트**: 아이콘 · 제목 · 한두 줄 · 버튼(성공 「확인」, 실패 「다시 시도」 또는 「홈으로」) · 필요하면 정정 요청 링크. 상자형 안내(failnote) · 칩 · 요약 표는 뺐다. 현장 밖이면 「○○ 반경 n m」 · 「현재 약 n m」(실제 결과 값).
- **움직임**: 코너가 천천히 숨쉬고 스캔선이 오르내림 → QR을 잡으면 코너가 보라로 조여지고 짧은 진동(`haptic("light")`) → 성공이면 체크가 그려지며 성공 진동, 실패면 아이콘이 짧게 흔들리며 오류 진동. 현장 QR 판은 아래에서 올라옴. `prefers-reduced-motion` 이면 모두 끔.
- **출근 · 퇴근 완료 화면(2026-10-14, 시안 Motion-B2-FirstWin-Phone · Motion-B2-ClockIn-Phone)**: 성공은 시트 대신 **흰 화면 한 장**(`ClockDone`, `clock-done.css`) — 초록 점 자리에서 흰 화면이 퍼지고 → 점이 스프링으로 자리 잡으며 체크 · 고리 → 「출근 완료」 → 얇은 큰 시각(자리마다 아래서 올라옴) → 「현장 · 날짜」 → 근무 시작 선(「09:02 출근 · 근무 시간 기록 중」, 퇴근이면 「퇴근 · 오늘 근무를 마쳤어요」) → 보라 「확인」. 실패는 지금 시트 그대로.
  **「첫 출근을 환영해요 / ○○님, 오늘부터 함께해요」는 첫 출근에만**(사용자 결정) — 서버(`submitAttendanceScan`)가 출근을 넣은 뒤 이 조직에서 내 근무 기록이 1건뿐이면 `firstEver: true` 를 준다(세기 실패면 평소 화면). 이름 밑줄이 그어지고 작은 빛 알갱이가 흩어짐. 이름은 캡처 페이지가 세션(또는 기억된 기기) 이름을 넘긴다.

## 화이트 리디자인 — 시급 관리 (2026-10-13, 시안 AttRate-PC)

- **표**(`attendance-wages-client.tsx`): 카드 · 고용형태 배지 · 「n구간」 대신 직원(역할 · 시급/정규직) · **현재 시급**(굵게, 없으면 회색 「시급 미적용」) · 적용 시작일 · **최근 변경**(「¥1,600 → ¥1,700」, 한 번뿐이면 「처음 설정」) · **변경 이력**(「n회」). 숫자 열 오른쪽 정렬. 탭 · 엑셀/PDF · 달 고르기 · 상세 패널은 그대로.
- **추가수당**(`attendance-allowances-section.tsx`): 카드 · 아이콘 배지 · 배지 묶음 대신 제목 · 설명 · 「추가수당 추가」 → 표(날짜 · 직원 · 메모 · 구분 · 방식 · 금액 · 빨간 글자 「취소」, 취소된 줄은 회색 취소선 + 「취소됨」).
  **입력은 오른쪽 패널**(시안 AttAllowAdd-PC — 화면 폭 전체 폼이 길쭉하다는 지적): 날짜 · 대상(전체 시급직 / 특정 직원 → 직원 고르기) · 구분(추가수당 / 특별수당) · 방식(일 고정 / 시간당 추가) 토글 · 금액 · 메모 이름표 칸 · 안내 · 빨간 오류 한 줄 · 저장. 닫기는 패널 위 × 하나(중복 닫기 제거). 취소 확인 창 버튼은 「그대로 두기 · 추가수당 취소」(둘 다 「취소」라 헷갈리던 것).
- **연차 대리 신청 창**(`leave-request-modal.tsx`): 신청 대상은 브라우저 기본 목록 대신 공용 `AdmDropdown`(9명 이상이면 검색), 창 안 두 칸 날짜의 왼쪽 달력은 왼쪽 기준으로 펼쳐 창 밖으로 잘리지 않게.

## 화이트 리디자인 — 연차 (2026-10-13, 시안 AttLeave-PC · AttLeaveHomeM · AttLeaveNewM · AttLeaveHistM · AttLeaveCalM)

- **PC**(`leave-queue-client.tsx`): 보기 탭(승인 심사 · 팀 캘린더 · 직원 잔여·부여 · 문서 · 이력)은 아이콘 · 보라 채움 없는 글자 세그, 오른쪽에 **내 연차 신청 · 대리 신청**(모든 보기에서).
  숫자 카드 3장(승인 대기 · 이번 주 휴가자 · 잔여 이상)은 뺐다 — 상태 세그 건수로 충분. 상태 세그 · 검색 · 종류 · 정렬 · 표 · 상세 패널 · 다른 보기 내용은 그대로.
- **모바일 연차 홈**(`leave-home.tsx`): 「연차 · 2026년」 → 큰 「사용 가능 n일」 → 「부여 · 사용 · 승인 대기 n건」 + 막대(사용 | 남음) → 다음 자동 부여 · 특별휴가(4년 보너스) 줄 → 연차 신청하기 · 연차 캘린더 › · 신청 내역 › → 최근 신청 줄(종류 · 일수 / 기간 · 신청일 / 상태).
  태블릿 가로는 오른쪽에 최근 신청 · 부여 규칙. 셸은 `wide`, 하단 탭 다시 보임(아래 고정 버튼 없앰).
- **신청서**(`leave-form.tsx`): 신청일 · 신청자 회색 칸 → 제목 아래 「이름 · 10/13 신청」. 시작 · 종료(반차면 날짜 하나)는 테두리 이름표 칸(누르면 기존 기간 시트), 종류 · 단위(종일 · 오전 반차 · 오후 반차 — 경조 휴가면 숨김)는 칩, 사용 일수 한 줄, 사유(300자) · 비상 연락처 이름표 칸, 안내, 임시 저장 · 신청 제출(제자리).
  태블릿 가로 오른쪽은 유급 휴가면 「신청 후 남는 연차」(지금 − 이번), 다른 종류면 「지금 남은 연차」 + 「유급 연차에서 빠지지 않아요」. 페이지가 `getMyAnnualLeaveSummary` 로 남은 연차를 넘긴다.
- **신청 내역**(`leave-history.tsx`): 「신청 내역 · 2026년 · n건」 + 「+ 신청」, 글자 탭(건수), 줄(종류 · 일수 / M/D 기간 · 신청일 / 상태 색 글자). 카드 · 종류 아이콘 · LV 코드 · 아래 고정 버튼 제거. 상세 · 취소 시트와 임시 저장 줄 밀어서 삭제는 그대로(빨간 삭제 바탕은 열릴 때만).
- **연차 캘린더**(`leave-calendar.tsx`): 「연차 캘린더 · 2026년 10월 · 승인된 휴가만」 + 월 알약, 월요일 시작 달력에 휴가 있는 날 점(지난 날 회색), 「이번 달 휴가」 줄(이름 · 종류 / 기간 · 일수 / 오늘 휴가 · 지난 휴가). 예전 색 리본 · 아바타 색 · 종류 칩은 뺐다. 내 휴가 / 팀 휴가 구분은 데이터에 신청자 id 가 없어 쓰지 않는다.

### HIG 다듬기 2차 — 연차 홈 (2026-10-20, 시안 A2Leave-* · 지금 A2LeaveNow-* 나란히)

기능 · 배치는 그대로. 처음엔 홈만(`.lvw--home`) 바꿨고, 같은 날 신청서 · 내역 · 캘린더 시안이 승인되면서 아래 규칙을 연차 화면 공용(`.lvw`)으로 올렸다:
- 줄 사이 선: 모든 줄 **위**에 긋던 것 → **줄 사이에만**(앞 아이콘 없는 줄이라 끝까지, 묶음 첫 줄 위 선 없음 — 공용 구분선 규칙).
- 묶음 제목 「최근 신청 · 연차 부여 규칙」 15/700 → **17/600 · 높이 44**, 「전체 ›」 15 · 누르는 자리 44.
- 줄 제목 15 → 16, 아래 줄 12 → 13, 오른쪽 「+n일」 14 → 15. 상태 글자 13/600 그대로.
- 「2026년」 · 「사용 가능 연차」 · 「부여 · 사용 · 승인 대기」 13 → 15, 범례 12 → 13. 큰 숫자 40 그대로.
- 「연차 캘린더 › · 신청 내역 ›」 14 → 15 · 누르는 자리 높이 44. 부여 규칙 줄 16 · 빈 화면 15.

### HIG 다듬기 2차 — 연차 신청서 · 신청 내역 · 캘린더 (2026-10-20, 시안 A2LeaveForm-* · A2LeaveHist-* · A2LeaveCal-* · 지금 *Now-* 나란히)

기능 · 배치는 그대로(`leave.css` 끝 블록 + 위 공용 블록):
- **신청서**: 입력칸 글자 15 → **16**(16 미만이면 iOS 가 누르는 순간 화면을 확대한다) · 칸 높이 48 → 50 · 칸 이름 12 → 13 · 「0 / 300」 11 → 12.
  종류 · 단위는 보라 알약 칩(38 · 14) → **나눔 버튼**(회색 판 위 흰 칸 하나 = 고른 것, 요청 「전체 | 내 요청」과 같은 모양 · 보이는 36 · 누르는 자리 44 · 15, 칸 폭은 글자에 맞추고 남는 폭을 나눔 — en 「Bereavement」도 한 줄).
  묻는 줄 · 「사용 일수」 15 · 「총 n일」 17 · 오류 · 안내 13 · 태블릿 「신청 후 남는 연차」 17 · 계산 줄 15. 마크업 · 동작(aria-pressed) 그대로.
- **신청 내역**: 탭 40 → 44 · 14 → 15, **탭 아래 끝까지 긋던 선 없음**(고른 탭 밑줄만 — 사용자 지시), 「+ 신청」 15 · 누르는 자리 44, 줄 16 / 13, 위 줄 · 빈 화면 15.
- **캘린더**: 「‹ 10월 ›」 동그라미 32 → 36 · 누르는 자리 44 · 달 글자 15, 날짜 14 → 16 · 요일 · 범례 13, 「이번 달 휴가」 17 · 「n건」 15 · 줄 16 / 13 · 줄 사이에만 선.

## 화이트 리디자인 — 출근자 명단 (2026-10-13, 시안 AttRoster-PC · AttRosterM-Phone · Fold · Tablet)

- **PC**(`attendance-roster-client.tsx`): 날짜 고르기는 근태 탭 줄 오른쪽의 공용 피커 그대로. 본문 위 한 줄 = 날짜 제목 + 「● 실시간 · 15:40 갱신」(지난 날짜는 「과거 날짜 · 읽기 전용」) + **근무지 · 상태 고르기**(공용 `AdmDropdown`, 화면 안 필터).
  숫자 넷 — 근무 중(휴게 포함, 「휴게 n명 포함」) · 퇴근 완료 · 검토 필요(빨강) · 무효 세션. 표: 직원(역할) · 근무지(퇴근지가 다르면 「A → B」) · 출근 · 퇴근 · 휴게 · 상태(색 글자) · 전화(근무 · 휴게 중이고 번호가 있을 때).
  **휴게 칸**은 휴게 중이면 「11:30 –」(시작 시각), 끝난 휴게만 있으면 합계 「30분」 — 휴게마다의 시작 · 끝 시각은 명단 데이터에 없다. 상태별 묶음 머리 · 세션 코드 · 맨 아래 읽기 전용 안내는 뺐다. 10초 자동 갱신은 그대로.
- **모바일**(`attendance-roster.tsx`): 주간 스트립 대신 제목 · 「오늘 n명 출근 · ● 실시간」 → ‹ 날짜 ▾ ›(누르면 달력 시트) · 오늘 → 상태 막대 + 범례(근무 중 · 퇴근 · 검토 필요 · 무효) → 줄(이름 · 역할 · 현장 · 출근 → 퇴근 · 상태 · 전화), 근무 중 먼저.
  **태블릿 가로**는 왼쪽 달력(월요일 시작, 오늘 이후 못 고름, 「오늘」) + 그날 요약(막대 · 세로 범례) | 오른쪽 「오늘 출근자 · n명」 줄. 셸은 `wide`(이전 `split` 대신 — 상세 칸이 없는 화면).

### HIG 다듬기 2차 — 출근자 명단 (2026-10-20, 시안 A2Roster-* · 지금 A2RosterNow-* 나란히)

기능 · 배치는 그대로(`attendance.css` 의 `.att--rosterw` HIG 블록):
- 제목 「출근자 명단」 24/900 → **34/700**(다른 화면과 같은 큰 제목), 「오늘 n명 출근 · 실시간」 12/700 → 15 보통 굵기.
- 날짜 줄 ‹ › 36 → 44 · 날짜 17/600 · 「오늘」 34/13 → 44/15.
- 줄 사이 선: 모든 줄 위 · 화면 끝부터 긋던 것 → **줄 사이에만, 글자 시작점 50부터**(이니셜 38 + 간격 12, 공용 구분선 규칙).
- 이름 15/600 → 16/500 · 역할 · 「현장 · 출근 → 퇴근」 12 → 13 · 전화 40 → 44. 상태 글자 13/600 그대로.
- 태블릿 가로: 달력 ‹ › 32 → 44 · 달 17/600 · 요일 13 · 날짜 16 · 「오늘」 44/15 · 상태 요약 줄 40 → 44 · 오른쪽 제목 17/600 · 높이 44 · 「근무 중 먼저」 13.

## 화이트 리디자인 — 교통비 (2026-10-13, 시안 AttTransport-PC · AttTransportM-Phone · Fold · Tablet)

- **PC 교통비 검토**(`attendance-transport-client.tsx`): 숫자 줄 3칸 · 비활성 상태 필터 칩 대신 **상태 탭** — 검토 대기(제출 · 검토 중) · 보완 요청 · 승인 · 반려 · 제출 전(미제출 · 작성 중).
  첫 탭은 검토 대기, 비어 있으면 정산서가 있는 첫 탭. 표 열: 직원(아래 상태) · 건수 · 제출 금액(굵게) · 증빙(「영수증 n」 / 빨강 「누락 n」) · **제출일**.
  제출일을 위해 관리자 요약(`getTransportReportSummaryForAdmin`)과 `AdminTransportRow` 에 `submittedAt` 을 더했다.
  상세 패널: 위 한 줄(증빙 누락 n · 상태) · 이름 · 「달 · n건」 · 날짜 줄(9/11 · 출근지 · 영수증 작은 사진 / 「증빙 누락」 · 금액) · 합계, 권한 상자 대신 「검토 시작」 한 줄, 아래 버튼 **반려(글자) · 보완 요청 · 승인**. 승인 · 반려 · 보완 요청 · 다시 열기 동작과 사유 입력은 그대로.
- **모바일 교통비 정산**(`transport-statement.tsx`): 정산서 카드 대신 제목 「교통비 정산」 · 「9월 · 아직 제출 전」(보완 요청 · 반려는 빨강) · 「+ 추가」, 보완 요청 · 반려면 **관리자 메모**,
  「9월 합계 · n건」 + 큰 금액, 날짜 줄(출근지 · 맥락 · 「영수증 n장」 / 빨강 「증빙 누락」), 영수증 없는 건 안내 한 줄, 「9월 교통비 제출」(보완 요청 · 반려면 「고쳐서 다시 제출」). 제출 후에는 「확인할 때까지 고칠 수 없어요」.
  태블릿 가로는 왼쪽 제목 · 합계 · 제출 · 「+ 교통비 추가」 | 오른쪽 「9월 내역」. 줄을 누르면 상세 · 고치기 · 삭제 시트(기존 그대로).
  **눌러도 아무 일 없던 「엑셀」 버튼은 뺐다**(직원용 엑셀 내보내기는 아직 없음).

### HIG 다듬기 2차 — 교통비 정산 (2026-10-20, 시안 A2Trn-* · 지금 A2TrnNow-* 나란히)

기능 · 배치는 그대로(`transport.css` 의 `.trnw` HIG 블록):
- 제목 「교통비 정산」 24 → **34/700**(다른 화면과 같은 큰 제목), 「10월 · 아직 제출 전」 13 → 15. 「+ 추가」 36/14 → 44/15.
- 줄 사이 선: 모든 줄 위(첫 줄 위 포함) → **줄 사이에만**(날짜 글자가 왼쪽 끝이라 끝까지 — 공용 구분선 규칙).
- 건물 15 → 16 · 「현장 · 영수증 n장 / 증빙 누락」 12 → 13 · 금액 15 → 16. 날짜 13 그대로.
- 「n월 합계 · n건」 · 영수증 안내 · 잠금 안내 · 빈 화면 15. 반려 메모 이름 13 · 본문 15. 합계 숫자 30 / 40 그대로.
- 태블릿 가로: 「+ 교통비 추가」 46 → 50 · 오른쪽 「n월 내역」 17/600 · 높이 44 · 「줄을 눌러 고치기」 13.

## 화이트 리디자인 — 정정 요청 · 정정 요청 상태 (2026-10-13, 시안 AttCorr · AttCorrStatus)

- **정정 요청**(`attendance-correction-form.tsx`): 제목 아래 한 줄(기록에서 왔으면 「날짜 · 현장」, 기록 없는 날이면 「기록 없는 날 · 이번 달 · 지난달만」).
  출처 기록 카드는 뺐다. 기록 없는 날이면 맨 위 **근무 날짜** 칸. 「무엇이 잘못됐나요?」 사유 6가지(출근 누락 · 퇴근 누락 · 시각 오류 · 장소 오류 · 인증 실패 · 기타 — 실제 값 그대로),
  출근 · 퇴근 · 현장 · 「메모 · 선택」은 **테두리 이름표 칸**(로그인 칸 모양), 사진(선택 · n/5), 보내기 버튼은 맨 아래 제자리(화면 아래 고정 막대 아님) + 안내 한 줄. 보내는 값 · 검사 · 사진 올리기는 그대로.
- **태블릿 가로**: 오른쪽에 **내 정정 요청(최근 30일)** — 날짜 · 사유 · 요청 시각 · 상태(대기 · 검토 중 보라, 반려 빨강). 누르면 그 요청의 상태 화면.
  새 조회 `listMyCorrectionRequests()`(`src/lib/attendance-corrections.ts`, 본인 것만 · 도쿄 기준 30일 · 최대 20건).
- **정정 요청 상태**(`attendance-correction-status.tsx`): 제목 「정정 요청 상태」, 아래 「날짜 · 사유」. 상태 한 마디 + 큰 문장(기다리는 중 · 확인 중 · 반영됨 · 반려됨 · 철회함),
  세로 진행(요청됨 시각 → 검토 중 → 승인/반려/철회 시각 · 처리한 사람), 요청 내용(요청한 시각 · 현장 · 메모 · **사진 미리보기**, 누르면 원본), **관리자 답변**(승인 · 반려에 답변이 있을 때),
  아래 「근무 기록에서 보기 ›」(승인) · 「다시 요청 ›」(대기 · 반려) · 요청 철회(대기 · 검토 중, 확인 시트 그대로). 원래 기록 줄은 상태 데이터에 없어 넣지 않았다.

## 화이트 리디자인 — 근무 기록 (2026-10-13, 시안 AttHist-Phone · Fold · Tablet)

- 화면 이름 「근태 이력」 → **「근무 기록」**(ko · ja 勤務記録 · en Work log). 제목 아래 「8월 · 2일 근무 · 32분」 — 합계는 **정상 기록만**(검토 필요 · 무효 · 진행 중 제외, 급여 인정 시간과 같은 기준).
- 노란 경고 박스 대신 제목 아래 빨간 글자 한 줄 **「검토 필요 n건 ›」**(1건이면 그 기록 상세, 여러 건이면 고르기 시트). 검토 필요 = 검토 대상 · 이상 감지 · 퇴근 누락.
- 위쪽 오늘 요약 카드(실시간 타이머)는 뺐다 — 근태 홈이 맡는다. 진행 중 기록 줄의 근무 시간은 1분마다 다시 센다.
- **달력**(월요일 시작): 근무한 날 보라 점, 검토 필요한 날 빨간 점, 오늘 이후 옅게. 기록 있는 날을 누르면 그 날짜 줄로 스크롤. 달 이동은 급여와 같은 월 알약.
- **날짜별 줄**: 「09:02 → 근무 중」 · 「17:35 → 09:20 **+1일**」(퇴근이 다음 날 이후면 며칠 뒤인지, 도쿄 기준), 아래 현장 · 방식 · 휴게 n분. 오른쪽 근무 시간과 한 마디 —
  근무 중 · 무효 · 정정 요청됨/검토 중 · 「퇴근 누락 · 정정 요청」 · 검토 필요 · 장시간(12시간 초과) · 정정 승인/반려. 줄을 누르면 상세 시트(태블릿은 가운데 카드) — 상세 내용 · 정정 요청 버튼은 그대로.
- 태블릿 가로: 왼쪽 제목 · 달력(따라 내려옴) | 오른쪽 「8월 기록」 줄. 이전의 오른쪽 상세 칸은 없앴다(상세는 시트).

## 화이트 리디자인 — 급여 (2026-10-13, 시안 AttPay-PC · Phone · Fold · Tablet)

- **PC 급여 검토**(`attendance-payroll-client.tsx`): 위 숫자 줄 5칸 — 시급 대상 · 예상 세전 총액(수당 포함) · 제외 기록 · **평균 시급**(직원별 시급을 인정 시간으로 가중 평균. 기본급 ÷ 시간으로 내면 월 10엔 올림이 섞여 없는 시급이 나와서 이렇게 정했다) · 확정 완료.
  그 아래 줄에 상태 글자(「예상 · 확정 전」, 전원 확정이면 「확정」)와 시급제만 토글 · 엑셀 · PDF. 쓰이지 않던 비활성 「고용형태」 필터 칩은 뺐다.
  표 열: 직원 · **근무일** · 인정 시간(「32분」 / 「8시간」 / 「8시간 12분」) · 시급 · **수당** · 예상 세전(굵게, 월급제는 —) · **제외 n건 ›**(검토 큐로) · 상태. 줄을 누르면 오른쪽 상세 패널은 그대로.
- **모바일 급여**(`attendance-pay.tsx`): 제목 「급여」 + 「8월 예상 · 확정 전」/「8월 확정」. 큰 예상 총액(눈 아이콘으로 가리기 — 근태 홈과 같은 설정) 아래 「시급 · 인정 시간 · 수당」 한 줄,
  숫자 셋(근무일 · 근무 인정 시간 · **제외 n건** — 누르면 제외 목록 시트), 시급 구간 · 수당(있을 때만), **날짜별 근무 시간 막대**(그 달 1일~말일 축, 근무 없는 날은 옅은 바닥선, 진행 중 진한 보라 · 급여 제외 빨강 짧은 막대, 근무일 8일 이하일 때만 막대 위 h:mm),
  날짜 줄(최근 날부터, 금액 또는 「검토 필요」 등 제외 사유), 맨 아래 월 합계. 막대 · 줄을 누르면 그날 상세 시트(기존).
  안내 문구에 「**월 합계는 10엔 단위로 올림**」을 붙였다 — 날짜 줄 합(예: ¥853)과 월 합계(¥860)가 다른 이유.
  태블릿 가로는 왼쪽(총액 · 숫자 · 구간 · 수당) | 오른쪽(막대 · 날짜 줄) 두 칸(기존 격자 그대로).

## 급여 · 마감 버그 수정 (2026-10-19)

- **무효 처리한 「검토 필요」 세션이 마감을 막던 것** — 마감 판정(`countBlockingSessions`, 자기 · 관리자 두 길 공용)이
  무효 세션을 세지 않는다. 검토 큐 「검토」 탭 · 근태 배지 · 개요 「검토 필요」 · 직원 상세 이상 표시도 무효를 뺀다(전체 탭엔 「무효」로 남는다).
  전에는 무효로 바꿔도 `review_state` 가 그대로라 마감이 영원히 막혔고, 화면에서 풀려면 복구(다시 유효)밖에 없었다.
- **같은 사람의 근무 시간 겹침 거절** — 수동 추가 · 직접 수정(시각을 바꿀 때) · 복구 · 정정 승인이 저장 전에
  같은 직원의 다른 유효 세션과 [출근, 퇴근) 이 겹치면 「같은 직원의 다른 근무와 시간이 겹칩니다」로 거절한다(이중 지급 방지).
  맞닿는 것(앞 퇴근 = 뒤 출근)은 괜찮다. 근무 중 세션은 끝이 열린 것으로, 퇴근 없이 넘어간 세션은 출근 시각 한 점으로 본다.
  직원 본인의 출퇴근(모바일)과 DB 제약은 아직 아니다.
- **10엔 과지급** — 분 단위 금액을 부동소수로 더하면 정확히 100엔이 100.00000000000001 이 돼 10엔 올림이 110엔을 냈다
  (시급 1,000엔 · 1분 × 6일로 재현). 올림 전에 소수점 아래 6자리에서 맞춘다(`settleYen`). 규칙(월 합계 10엔 올림)은 그대로.
  **마감된 달은 스냅샷 금액을 쓰므로 바뀌지 않는다.** 무작위 1,500개 달 비교에서 바뀐 것은 8개, 전부 정확히 −10엔(부동소수 잡음 경우)이었다.
- **급여 계산 한 곳으로** — `calculateMonthlyPay`(`src/lib/attendance-pay-calculation.ts`)를 자기 급여 화면 · 마감 스냅샷 · 내보내기
  (`getMonthlyPayView`)와 관리자 급여 · 개요 · 직원 상세(`computePayrollMonth`)가 같이 쓴다.
