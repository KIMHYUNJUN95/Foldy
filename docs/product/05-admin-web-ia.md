# Admin Dashboard IA

## Purpose

이 문서는 Foldy 관리자 대시보드의 단일 기준 문서다.

- 모바일 앱은 현장 실행용 표면이다.
- 관리자 대시보드는 데스크톱/노트북 중심 운영 콘솔이다.
- 두 표면은 연결되지만 같은 화면의 반응형 변형이 아니다.

이 문서는 관리자 대시보드의 원칙, 정보구조, 공통 UX 패턴, 모듈 우선순위를 정의한다.
모바일 고유 UX는 `docs/product/16-mobile-navigation.md` 와 각 기능 문서가 계속 맡는다.

## Status

2026-06-29 기준 관리자 대시보드 리빌드 방향이 확정되었다.

- 기존 `/admin` 구현은 참고 자산일 뿐이며, 이번 대시보드 작업 중 재구성될 수 있다.
- 현재 코드의 역할/화면 범위는 이 문서와 완전히 일치하지 않을 수 있다.
- 앞으로 대시보드 관련 구현은 이 문서를 기준으로 정렬한다.

### Implemented (2026-06-29)

- **Dashboard Home** 가 데스크톱 운영 콘솔로 구현됨.
  - Shell: 그룹형 IA 사이드바(Home / Operations / Work·Comms / Management) +
    조직 컨텍스트 + 모바일 보기 진입 + 콘솔 헤더(크럼 · 전역 검색 · 알림 · 계정).
    `src/components/shell/admin-shell.tsx`.
  - Home: ops summary bar + 최상단 우선 블록 카드(진행 중 청소 · 즉시 처리 큐 ·
    이상 근태/정정 · 중요 공지 · 오늘 할 일 · 예약 체크인/아웃). 모든 블록은
    `getAdminDashboard`(`src/lib/admin-dashboard.ts`)로 실데이터 연동되고 각 모듈로
    진입한다. `src/components/admin/dashboard-home.tsx`.
  - **진행 중 청소 카드**는 행 클릭 시 **우측 상세 슬라이드 패널**(작업 정보 · 활동 기록 · 완료/메시지
    액션)을 연다. 체크리스트는 Foldy 청소 데이터 모델에 없어 제외하고 실제 보유 필드(담당/시작/경과/유형/
    상태)만 표시한다. 다른 모듈의 우측 패널·자동 갱신·알림/조직 전환 팝오버는 후속 슬라이스다.
  - 사이드바는 디자인 핸드오프 기준 **다크 웜-에스프레소 레일**(골드 액티브 액센트) + 아이보리 콘텐츠이고,
    섹션은 **운영 / 인력 / 정보** 3그룹이다. 브랜드 마크는 실제 앱 아이콘(`/icon-192.png`)을 쓴다.
  - **사이드바는 아이콘 레일이고, 마우스를 올릴 때만 펼쳐진다**(2026-09-24).
    평소 `64px`, 올리면 `248px`. **조작 수단은 커서뿐이다** — 접기/펴기 버튼을 두지 않으므로
    저장할 상태도, 그리기 전에 복원할 것도 없다. 규칙이 전부 CSS 안에서 끝나고 React 는
    관여하지 않는다.
    판매 캘린더는 객실 90개 × 30일이 가로로 깔려 **248px 가 날짜 약 5일치**이고, 눌러앉아
    가격을 조정하는 동안 메뉴를 쓸 일이 거의 없다. 반대로 청소·채용처럼 들락날락하는 화면에서는
    사이드바가 제값을 하므로 **없애지 않고 접는다.**
    - **펼침은 본문을 밀지 않는다.** 레일이 격자에서 64px 자리를 계속 차지하고 펼쳐진 폭만
      본문 위로 떠오른다. 밀어내면 마우스가 왼쪽을 스칠 때마다 격자 2,700칸이 다시 배치되고
      날짜 칸이 흔들린다 — 가격을 읽는 화면에서 그건 못 쓴다.
    - 중심을 맞출 때 **테두리가 자리를 먹는 것**을 빼먹으면 안 된다. 이 콘솔은
      `box-sizing: border-box` 라 조직 버튼의 `width: 100%` 안에 테두리 1px × 2 가 들어간다.
      여백을 17 로 두면 내용이 28px 이 되는데 로고는 30px 에 `flex: 0 0 auto` 라 줄지 않아
      **2px 넘치고 `overflow: hidden` 이 오른쪽을 잘라낸다**(둥근 모서리가 한쪽만 깎여 보인다).
      여백 16 → 상자 32 − 테두리 2 = 내용 30 = 로고 30 으로 딱 맞는다.
    - **접었을 때 조직 전환 버튼의 테두리·바탕은 지운다.** 로고가 30×30 인데 상하 패딩과
      테두리가 남으면 30×48 짜리 세로 알약이 되어 정사각 로고를 감싼 모양이 어색해진다.
      접힌 상태에서 그 테두리는 묶어 줄 글자가 없어 역할도 없다. 패딩은 남긴다 — 없애면
      줄 높이가 줄어 아래 메뉴가 통째로 올라간다.
    - **레일에서 아이콘 중심을 전부 32px 에 맞춘다.** 앱 마크 38px · 조직 로고 30px ·
      메뉴 아이콘 18px 로 크기가 다르므로 왼쪽만 맞추면 중심이 37·37·31 로 갈린다.
    - **글자는 줄바꿈시키지 않는다**(`nowrap` + `min-width: 0`). 64px 안에서 「게스트 피드백」이
      네 줄이 되면 행 높이가 폭발한다 — 투명하게만 만들고 자리를 두면 이게 그대로 일어난다.
    - **폭·여백·투명도가 같은 곡선과 같은 지연으로 움직인다**(`170ms`, 지연 `120ms`).
      폭만 애니메이션하고 여백이 즉시 튀면 아이콘이 먼저 점프하고 상자가 뒤따라온다.
      지연이 없으면 마우스가 지나가기만 해도 펼쳐지고, 나갈 때도 같은 지연이 걸려 메뉴로
      비스듬히 가는 동안 접히지 않는다. `prefers-reduced-motion` 에서는 전부 0초.
    - 글자는 `display:none` 이 아니라 **투명도**로 다룬다. `display` 는 지연시킬 수 없고,
      그룹 제목은 높이를 가지므로 없애면 세로가 통째로 출렁인다. 투명도면 높이가 유지돼
      아이콘이 제자리에 있고 그 빈 줄이 묶음 사이 간격 노릇도 한다.
    - 레일 규칙은 사이드바 기본 규칙 **뒤에** 둔다. 특이도가 같아 순서가 승부를 가른다 —
      앞에 두면 기본값이 이겨 레일이 적용되지 않는다.
  - **사이드바 스크롤바는 평소에 보이지 않는다**(2026-09-24). 에스프레소 바탕 위에 브라우저 기본
    스크롤바(밝은 회색 + 화살표)가 얹히면 앱 chrome 이 아니라 덧댄 창틀처럼 보인다. 메뉴가 뷰포트보다
    조금 길 뿐인데 세로 막대가 상시 노출되는 대가가 크다. 다만 아예 없애면 「더 있다」는 신호도 같이
    사라지므로 **사이드바에 마우스를 올리면** 얇고 옅은 막대가 떠오른다.
    같은 콘솔에서 `.subnav` 는 숨기기만, `.atp__col` 은 얇게 — 이 둘의 중간 규칙이다.
- **Admin Login** 구현됨 (2026-06-30). 데스크톱 콘솔 진입 화면을 split 레이아웃(좌측 다크 클레이
  브랜드 패널 + 우측 인증 폼)으로 통일했고, 전 상태(진입 · 이메일 로그인 · 가입 · 비밀번호 재설정 ·
  발송 완료 · 새 비밀번호 · 차단/정지/제거/비활성)에 적용했다. 실제 인증 흐름(`next`·온보딩·차단
  게이팅·언어 선택)은 그대로 보존했다. 파일: `src/app/auth/login/auth-frame.tsx`,
  `auth-console.css`(.authx), 재스타일된 `email-*-form.tsx`/`google-button.tsx`/`page.tsx`.
  i18n는 `auth.console`(ko/ja/en) 추가. 모바일/태블릿은 좁은 폭에서 브랜드 패널을 숨기고 폼만 노출한다.
  - **언어 선택은 폭에 따라 갈린다**(2026-09-29). 데스크톱 폭(>1080px, 브랜드 패널이 보이는 폭)에서는
    우측 상단 언어 pill 아래로 대시보드 `.dd` 와 같은 모양의 드롭다운(`.langdd__menu`, 바깥 클릭·Esc 닫힘)을
    펼친다. 그 이하 폭(모바일 진입)은 기존 모바일 `BottomSheet` 계약을 유지한다.
    파일: `src/app/auth/login/language-sheet.tsx`.

## Surface Boundary

관리자 대시보드는 독립 표면이다.

- 데스크톱/노트북은 `/admin`
- 모바일/태블릿은 `/mobile`
- 모바일/태블릿은 `/admin*` 를 직접 렌더링하지 않는다
- 대시보드 안에서 모바일 앱을 보는 기능은 허용되지만, 그것이 표면 통합을 의미하지는 않는다

즉 원칙은 아래와 같다.

- 앱은 앱이다
- 웹은 웹이다
- 데이터와 계정은 공유할 수 있다
- 하지만 UI, IA, 조작 흐름은 분리한다

## Installable Admin PWA (2026-07-03)

관리자 콘솔은 모바일 앱과 **분리된 독립 설치형 PWA**다. 오피스/관리 인력이 데스크톱에서
바탕화면·시작메뉴·독 아이콘으로 실행해 주소창·탭 없는 standalone 창으로 쓰도록 한다.

- 관리자 전용 매니페스트: `public/manifest-admin.webmanifest`
  - `id "/admin"`, `scope "/admin"`, `start_url "/admin"`, `display "standalone"`.
  - orientation 미지정(=any) — 모바일과 달리 세로 고정하지 않는다.
  - 아이콘은 **1차로 기존 모바일 세트(`/icons/*`)를 재사용**한다(전용 아이콘은 후속 과제).
- `src/app/admin/layout.tsx`가 `metadata.manifest`를 위 매니페스트로 오버라이드한다.
  Next.js 메타데이터는 세그먼트 단위로 병합되므로 `/admin/*`에서만 관리자 매니페스트가,
  그 외(`/mobile` 등)에서는 루트의 모바일 매니페스트가 노출된다.
- 결과: `/admin` 페이지에서 설치하면 "Foldy Admin"(id `/admin`) 앱이, `/mobile`에서 설치하면
  "Foldy"(id `/`) 앱이 각각 별개로 등록된다.
- 서비스워커(`public/sw.js`, scope `/`)와 오프라인 폴백(`/offline`)은 두 표면이 공유한다.

제약:

- macOS 는 Chrome/Edge 설치 또는 Safari 17+ 「파일 → Dock에 추가」로 설치한다(맥 설치 파일은 나중 — 아래).
- `scope "/admin"`이므로 스코프 밖(`/auth`, `/onboarding`) 이동은 standalone 창이 아닌 브라우저
  탭으로 열릴 수 있다. 관리자 셸의 일상 흐름은 `/admin` 내부에서 완결되어 현재 문제 없다.

### Windows 설치 파일 — Microsoft Store (2026-10-15)

진짜 설치 파일은 **Windows 먼저, Microsoft Store 로** 낸다(사용자 결정 2026-10-15, 무료 · 경고 없음).

- 같은 매니페스트를 PWABuilder 가 Store 용 MSIX 패키지로 감싼다 — 앱은 배포된 `/admin` 을 띄우므로
  **웹 배포가 곧 앱 갱신**이다. 서명은 Store 가 해 「알 수 없는 게시자」 경고가 없다.
- Store 용으로 매니페스트에 `lang` · `dir` · `categories`(business · productivity) ·
  `launch_handler`(`navigate-existing` — 아이콘을 다시 눌러도 새 창 대신 열린 창으로) ·
  `prefer_related_applications: false` 를 더했다.
- 패키지에는 **주소가 박힌다** — 자체 도메인(출시 계획 C1) 뒤에 새 주소로 패키지를 한 번 더 올린다.
- 단계 · 담당: `docs/planning/17-app-release-plan.md` 「PC 설치 파일」(W 항목).

맥 설치 파일(Tauri + Apple 서명 · 공증)은 나중에 한다. 그전까지 맥은 브라우저 주소 또는 위 방법으로 설치해 쓴다.
Electron 은 쓰지 않는다(설치 파일이 크다).

## Core Principles

### 1. Full Admin Surface

관리자 대시보드는 단순 조회판이 아니다.

- 실행
- 등록
- 수정
- 삭제
- 상태 변경
- 검토
- 승인/반려
- 운영 관리

를 모두 수행할 수 있어야 한다.

원칙적으로 모바일에서 가능한 기능은 관리자 대시보드에서도 가능해야 한다.

### 2. Physical Exceptions Only

완전한 기능 대응 원칙의 예외는 물리 장치 제약뿐이다.

현재 확정된 예외:

- 출근/퇴근 QR 스캔 실행은 모바일 전용

하지만 아래는 대시보드에서 가능해야 한다.

- 출근 사이트 관리
- QR 생성/재발급/보관/이력 관리
- 근태 수동 생성/수정/무효화
- 정정 요청 검토
- 급여/교통비 검토 및 export

### 3. Execution And Management Together

대시보드는 모바일보다 더 강한 관리 표면이다.

- 모바일은 빠른 현장 실행에 최적화
- 대시보드는 여러 건 비교, 검토, 수정, 기록 추적, export, 조직 관리에 최적화

예외적으로 청소는 현장 실행보다 관리자 개입 중심으로 해석한다.

- 일반 청소 시작: 기본적으로 모바일 중심
- 일반 청소 완료: 기본적으로 모바일 중심
- 관리자 강제 완료: 대시보드 포함
- 기록 수정/보정/추적/export: 대시보드 포함

### 4. Same Brand, Different Layout

대시보드는 모바일과 같은 브랜드 톤을 유지한다.

- 색상
- 기본 무드
- 표면 질감
- 브랜드 감성

은 모바일과 맞춘다.

대신 레이아웃은 데스크톱 운영 콘솔에 맞게 재구성한다.

- 테이블
- 카드
- 우측 상세 패널
- 고밀도 필터
- 다중 정보 비교

가 기본 구조다.

### 5. Access Gate And Feature Gate Are Separate

관리자 대시보드 접근 방향은 아래와 같다.

- **(2026-07-13 기준, `canAccessAdminWeb`/`adminWebRoles`, `src/config/roles.ts`)**
  `part_time_staff`를 제외한 **전원**이 어드민 웹에 접근 가능하다: `developer_super_admin`, `owner`,
  `senior_managing_director`(전무), `office_admin`, `cs_staff`, `field_manager`, `staff`.
- **접근 가능(access)과 기본 착지 모드(default surface)는 별개다.** `field_manager`·`staff`는 어드민 웹을
  열 수 있지만 **기본 착지는 모바일**이다(`defaultsToAdminSurface`, `src/config/roles.ts`). 모드 간 전환은
  `canSwitchToFieldMode`(part_time 제외 전원 가능). 즉 현장 인력은 모바일이 홈이되, 필요 시 어드민 웹에 진입할 수 있다.

단, 세부 기능 권한은 지금 일괄 확정하지 않는다.

- 대시보드 접근 가능 여부
- 각 기능의 보기/수정/삭제/승인 권한

은 분리해서 관리한다.
모듈 구현 시점마다 해당 기능 문서와 서버 권한 규칙에서 확정한다.

## Primary Navigation

대시보드 좌측 내비게이션은 디자인 핸드오프 기준 **3개 묶음(운영 / 인력 / 정보)** 으로 정리한다.
(구현은 현재 존재하는 `/admin/*` 라우트만 노출하며, 모듈이 추가되면 해당 그룹에 편입한다.
`src/config/navigation.ts` 의 `adminNavGroupOf` / `adminNavGroupOrder` 가 단일 소스다.)

### 운영 (Operations)

- Dashboard Home (홈)
- Cleaning (청소)
- Maintenance (정비·시설)
- Lost & Found (분실물)
- Orders (주문·비품)

### 인력 (People)

- Attendance / Payroll / Transportation (근태)
- Users / Members (멤버)

### 정보 (Information)

- Reservations / Calendar (예약)
- Announcements / Board (공지·게시판)
- **Board reports (게시판 신고)** — `/admin/board-reports`, 권한 키 `board.moderate`(2026-10-06). 대기 신고 표(내용 — 글/댓글 테두리 태그 + 한 줄 미리보기 + 작성자 ·
  사유 칩 · 신고 수 · 최근 신고(도쿄, 24시간제, 고정폭 글꼴 아님)) + 우측 상세 패널(제목 「○○님의 글」, 본문 상자, 사유, 신고 메모, 신고 수 · 최근 신고)에서
  「문제없음」 / 「삭제」(확인 모달에 본문 미리보기). 공용 `.qtbl` · `.panel` · `.modal` · `.pill` · `.kv` · `.adm-toast` 위에 화면 고유 스타일만
  `board-reports-console.css`(`.brp-*`)로 얹는다. 아이콘은 항상 `.ic` 래퍼 안에(크기 1em).
  게시판 본문 콘솔은 아직 없다(사용자 결정 — 신고 처리만 먼저). docs/product/23-board-workflow.md §12-C
- Todoist (투두이스트) — 대시보드 콘솔은 다른 어드민 모듈의 "관리형" 패턴이 **아니라** Todoist 본연의
  워크스페이스(모바일 코어 패리티) + 사무실 **업무 지시**만. 기획 스펙: `docs/product/28-admin-todoist-console.md`.
  현재 라우트는 `/admin/tasks`이며 legacy `/admin/recurring-work`는 해당 화면으로 리다이렉트한다.
- Settings (설정)

향후 모듈(Linen Return · Complaints · Tasks/Projects · Suggestions · Bug Reports · Notifications ·
Permissions · Invite Codes · Attendance Sites/QR 등)은 위 3개 그룹의 성격에 맞춰 편입한다.

## Dashboard Home

`/admin` 홈은 KPI 판넬과 작업 허브가 결합된 운영 콘솔이어야 한다.

## Shared Dashboard UI System

관리자 대시보드의 표준 시각/상호작용 언어는 `src/components/admin/admin-console.css`의 콘솔 패턴과
`src/components/admin/shared`의 공용 프리미티브를 기준으로 한다. 기존 Tailwind 중심 관리자 화면은
즉시 전면 재작성하지 않지만, 새로 만드는 화면이나 수정하는 화면은 아래 기준을 먼저 확인한다.

- `AdminMonthPicker`, `AdminDatePicker`, `AdminTimePicker`, `AdminDateRangePicker`(단일 결합
  "시작일 – 종료일" 트리거 + 범위 선택 캘린더 팝오버, 2026-07-14 청소 기록 필터에서 처음 도입.
  팝오버는 `position:fixed` + 트리거 `getBoundingClientRect()` 기반 뷰포트 클램프 좌표라 스크롤
  가능한 조상의 `overflow`에 잘리지 않는다)
- `AdmDropdown`(`.dd`) — **어드민 콘솔의 단일 드롭다운 표준**. 네이티브 `<select>`와 필터 드롭다운을
  모두 대체한다. 값 편집·필터·정렬 어디서든 이 하나만 쓴다. 폼 제출용은 `DdFormSelect`(숨은 input
  래퍼)를 쓴다. CSS는 `admin-console.css`에 있어 모든 `.adm` 페이지에서 로드된다. **화면마다 다른
  드롭다운을 만들지 않는다**(구 칩형 `ChipDropdown`/`.adp` 드롭다운은 폐기·삭제됨, 2026-07-13).
  단, 달력형 `AdminDatePicker`/`AdminTimePicker`/`AdminMonthPicker`는 드롭다운이 아닌 별도 피커 컨트롤이다.
  네이티브 `<select>`를 폼에서 대체할 땐 `DdFormSelect`, 네이티브 `<input type="date">`를 폼에서
  대체할 땐 `DateFormField`(둘 다 숨은 input 래퍼)를 쓴다. 과거의 두 번째 커스텀 드롭다운
  `AdminSelectField`(`.selfield`)는 폐기·삭제됨(2026-07-14) — `.dd`만 쓴다.
- `AdminReasonModal`
- `useAdminPanelA11y`
- `AdminExportButtons` — 콘솔의 **유일한** 내보내기 컨트롤 (아래 참조)
- `admin-format` utilities for workbook download, yen formatting, and shared transport status pills
- `.panel__tool` (2026-09-24) — 우측 상세 패널 헤더의 **보조 동작** 버튼 자리(닫기 왼쪽).
  상태를 바꾸지 않는 동작만 여기 둔다. 하단 액션 바의 왼쪽(파괴)·오른쪽(진행) 자리는 반복 처리 중
  오조작을 막으려고 고정돼 있어, 성격이 다른 버튼을 끼우면 그 고정이 깨진다. 첫 사용처는 채용
  콘솔의 「인쇄」이고, 다른 콘솔 패널도 같은 자리를 그대로 쓴다.

같은 역할의 월/일자/시간 선택, 드롭다운, 사유 입력 모달, 우측 패널 동작을 기능별 폴더에 다시 만들지
않는다. 필요한 차이가 있으면 `src/components/admin/shared`의 프리미티브를 확장하거나 명시적인 디자인
결정으로 예외를 남긴다. `src/components/admin/attendance`는 이제 근태 도메인 화면 컴포넌트만 소유하고,
대시보드 전반에서 재사용 가능한 조작 프리미티브와 동일 출력의 포맷/다운로드 유틸은 shared 소유로 둔다.

### 캘린더 — 하나의 디자인, 예외 없음 (절대 규칙, 2026-07-14)

어드민 콘솔의 모든 날짜 컨트롤은 아래 **셋 중 하나**다. 네 번째는 없고, 기능별 자체 캘린더도 없다.

| 용도 | 컴포넌트 | 폼(`<form method="get">`)용 래퍼 |
| --- | --- | --- |
| 기간(범위) | `AdminDateRangePicker` | `DateRangeFormField` |
| 특정 하루 | `AdminDatePicker` | `DateFormField` |
| 특정 월 | `AdminMonthPicker` | — |

- **네이티브 `<input type="date">` 사용 금지.** 브라우저 기본 캘린더가 떠서 콘솔과 절대 같아지지 않는다.
  (2026-07-14에 분실물·수리점검·주문 필터바, 연차 신청 모달, 연차 잔여 입사일 편집에서 전부 제거함.)
- 캐논 캘린더 크롬은 청소 기록 탭 범위 피커의 `.calpop` 팝오버다 — 폭 292px, radius 16px, padding 14px,
  30px nav 버튼, 34px 날짜 셀, 오늘 표시 점. `admin-console.css`의 `.adp__*`(단일일)과 `.amp__*`(월)은
  이와 **의도적으로 동일하게 유지**한다. 하나를 손보면 셋 다 손본다.
- 달력 앞 빈칸 클래스는 `is-blank`(`.adp__cell.is-blank`) — **`empty` 같은 일반 이름을 쓰지 않는다.** 공용 빈 상태 `.adm .empty`
  (padding 26px)와 겹쳐 `AdminDatePicker` 의 첫 주 줄만 52px 로 늘어나 있었다(2026-10-07 수정). 범위 피커는 `cald--pad`.
- `AdminMonthPicker` 에 선택 prop `onSelect(ym)`(2026-10-08) — 주면 주소(`?ym=`)를 바꾸지 않고 그 함수를 부른다. 한 화면에
  달 선택기가 둘인 매출 비교(A · B)용. 주지 않은 화면은 예전과 똑같다.
- `AdminMonthPicker`는 **월 선택 개념 그대로 유지**한다(급여·교통비·수당). 월 선택을 범위 선택으로,
  또는 그 반대로 임의 변환하지 않는다 — 서로 다른 조작 개념이다.

#### 연 ▾ · 월 ▾ 드롭다운 · 휠 · 버튼의 연도 (2026-10-06)

몇 년 전 날짜를 고르려면 달마다 ‹ 를 수십 번 눌러야 했다(사용자 지적). `AdminDateRangePicker` 머리를 바꿨다:

- **‹ [2023년 ▾] [2월 ▾] ›** — 연을 누르면 **스크롤 목록**(올해 −8 ~ +2, 보고 있는 해가 밖이면 넓힌다, 열면 고른 해가 가운데),
  월을 누르면 **12칸**(월 선택기와 같은 `.amp__grid` · `.amp__m` — §4a 세 피커 같은 모양). 고르면 날짜 칸으로 돌아온다.
  고르던 시작 · 끝의 해 · 달은 테두리(`.is-draft`).
- **날짜 칸 위에서 휠** = 이전/다음 달(페이지는 같이 굴러가지 않는다).
- **시작일 – 종료일 직접 입력**(달력 맨 위 두 칸, 2026-10-06 「몇 년도 몇 월 며칠부터 몇 년도 몇 월 며칠까지」). 「2023-02-01」 ·
  「2023.2.1」 · 「2023/02/01」 · 「20230201」 · 「2023년 2월 1일」 · 「23.2.1」을 받는다(`parseTypedDate`, 테스트
  `admin-typed-date.test.ts`). 읽히는 날짜가 되는 순간 달력이 그 달로 가고 띠가 그려진다. 없는 날(2/30) · 막힌 날은 빨간 칸,
  Enter = 적용, 앞뒤가 바뀌면 바로잡아 넘긴다. 자리 표시는 지금 기간. 라벨 `typeStart` · `typeEnd`
  (`dictionary.admin.shared.dateTypeStart` · `dateTypeEnd`) — 공용 사전을 쓰는 화면 12곳에 연결했다.
- **올해가 아닌 기간은 버튼에 연도까지**(「2023년 2월 1일 – 2월 28일」). 올해 기간은 예전처럼 월 · 일만.
- 라벨에 `pickYear` · `pickMonth`(접근성 이름)를 선택으로 더했다(공용 `dictionary.admin.shared.datePickYear` · `datePickMonth`).
  주지 않은 화면도 그대로 동작한다.
- 발주 처리 모달(`orders-action-modal.tsx`)의 `.calpop` 사본에는 아직 없다(아래 「캘린더 격자가 두 벌이다」).

#### 고를 수 없는 날 — `isDateDisabled` (2026-09-28)

`AdminDateRangePicker` 에 선택 prop 두 개를 더했다. 주지 않으면 **예전과 똑같이** 동작한다.

- `isDateDisabled(date, pendingFrom)` — 그 날을 회색(`.cald.is-off`: 흐림 + 가로줄)으로 막는다.
  `pendingFrom` 은 시작을 찍고 끝을 기다리는 중일 때의 시작일이라, **끝으로 고를 수 있는 날**을
  따로 판정할 수 있다. 이 prop 을 주면 범위가 제약된 것으로 보고 ① 시작보다 앞을 누르면 앞뒤를
  바꾸지 않고 그 날부터 다시 고르며 ② 「이번 달」 바로가기를 숨긴다.
- `onMonthChange(monthKey)` — 달력이 보여 주는 달이 바뀔 때(열 때 포함). 그 달 데이터를 늦게
  읽는 화면이 쓴다.

첫 사용처는 판매 캘린더의 수동 예약 패널이다(팔린 밤·판매 중지 밤, 그리고 그 밤을 넘어가는
체크아웃을 막는다 → `33-calendar-write-features.md`). 단일일(`.adp__*`)·월(`.amp__*`) 피커에는
아직 막는 날 개념이 없다 — 필요해지면 같은 모양(`is-off`)으로 맞춘다.

#### 선택 구간 띠(`is-band`)의 마감 (2026-08-07)

두 가지를 같이 고쳤다.

1. **띠가 하루마다 끊겨 있었다.** `.calpop__grid` 에 `gap:2px` 가 있는데 띠를 날짜 버튼의
   `background` 로 칠하고 있어서, 실제 화면에서는 이어진 띠가 아니라 2px 간격의 점선처럼 보였다.
   좌우 2px `box-shadow` 로 그 틈을 띠 색으로 메운다.
   - **가상요소가 아니라 `box-shadow` 를 쓰는 이유:** `::before` + `z-index:-1` 은 `.calpop` 이
     쌓임 맥락일 때만 동작한다. 그런데 발주 처리 모달(`orders-action-modal.tsx`)은 같은 `.calpop`
     을 `position:static` 인라인으로 얹어 쓰기 때문에 그쪽에서는 띠가 카드 배경 밑으로 사라진다.
     `box-shadow` 는 쌓임 맥락과 무관하게 «배경 바로 바깥»에 그려져 두 사용처 모두에서 같다.
2. **띠가 끊기는 쪽 모서리가 각졌다.** 끊기는 자리는 세 군데다 — 주 경계(토→일), 달 첫날이
   주중이라 앞이 빈칸인 자리, 기간이 이웃 달로 이어져 격자 끝에서 잘리는 자리. 컴포넌트가
   이웃 칸의 띠 여부를 보고 안 닿는 쪽에만 `is-capl` / `is-capr` 를 붙이고, CSS 는 그쪽만 9px
   로 막는다(`.cald` 와 같은 반지름 — 콘솔의 모서리 언어를 따른다).

«시작·끝만 둥글게» 로 처리하면 주 경계에서 각진 모서리가 그대로 남는다. 이웃을 봐야 한다.

**캘린더 격자가 두 벌이다.** `AdminDateRangePicker` 와 `orders-action-modal.tsx` 가 `.calpop`
마크업을 각자 들고 있다(§4a 위반 상태, 선행 부채). 한쪽만 고치면 다른 쪽 띠가 사라지므로
**둘을 항상 같이 고친다.** 정리한다면 발주 모달을 공용 컴포넌트로 흡수하는 방향이다.

모바일 `requests/date-range-calendar.tsx` 도 같은 «이웃을 보고 막는» 규칙을 쓰되, 그쪽은 격자에
가로 간격이 없어 다리(box-shadow)가 필요 없고 셀이 원형이라 캡도 완전한 반원이다.

### Excel + PDF 내보내기 — 하나의 컨트롤, 하나의 템플릿 (절대 규칙, 2026-07-14)

- 콘솔의 모든 내보내기는 **`<AdminExportButtons>`**
  (`src/components/admin/shared/admin-export-buttons.tsx`)로 렌더한다 — `chipbtn` + lucide `Download`
  2개 조합. 화면마다 내보내기 버튼을 새로 만들지 않는다.
- **Excel과 PDF는 항상 함께 제공한다.** 둘 중 하나만 있는 화면은 미완성으로 본다.
- 서버 측에서 두 포맷은 **동일한 입력 구조**를 공유한다:
  `buildAdminTableWorkbookBase64()` (`src/lib/admin-table-workbook.ts`) 와
  `buildAdminTableReportHtml()` (`src/lib/admin-table-report.ts`). 초록 원장 서식(제목 병합행 → 헤더행 →
  번호 매긴 데이터행 → 합계행 → org/생성일시 푸터)은 `attendance-payroll-workbook.ts`의 상수를 재사용한다.
  새 색상이나 새 워크북 레이아웃을 만들지 않는다.
- **CSV는 폐기됐다.** 신규 CSV 다운로드, 클라이언트 `Blob` 내보내기, `/api/admin/export/*` 라우트를
  추가하지 않는다 — 해당 경로는 2026-07-14에 전부 삭제됐다.
- **내보내기 로케일은 서버가 결정한다.** `buildAdminExportMeta(session)`이
  `session.user.preferredLanguage`에서 해석한다. 클라이언트는 export 액션에 로케일을 넘기지 않는다.
- 두 프리미티브의 문구는 공용 `dictionary.admin.shared` 네임스페이스(`ko`/`ja`/`en`)에 있다. 기능별
  네임스페이스에 `exportXls`, `pickRange`, `dateApply` 같은 키를 다시 선언하지 않는다.
- **`wrap: true` 열의 행 높이는 빌더가 자동으로 계산한다 (2026-07-30).** 데이터 행 높이를 18pt로
  고정하면 메모·비고처럼 긴 열의 두 번째 줄부터가 파일에서 잘려 보인다(명시적 높이가 있으면
  Excel/LibreOffice가 자동 맞춤을 하지 않는다). `admin-table-workbook.ts`가 열 너비 대비 표시 폭으로
  줄 수를 추정해 필요한 만큼만 행을 키운다(전각 2칸 계산, 최대 12줄). 줄바꿈이 없는 행은 18pt 그대로다.
  **행 높이를 다시 상수로 고정하지 말 것** — 회귀 가드는 `src/lib/__tests__/admin-table-workbook.test.ts`.

**열 너비는 선언값이 최소값이다 (2026-09-10).** `AdminTableColumn.width` 는 고정 너비가 아니라
**하한**이고, 실제 값이 더 길면 그만큼 넓어진다(상한 42자, 좌우 여백 2자). 한글·가나는 라틴의 두
배 폭이라 문자 수로만 잡으면 자주 넘쳤다 — 채용 지원서 내보내기에서 「객실 클리닝 스태프」·
「체류 자격 만료 D-384」가 잘려 보였다. `wrap: true` 열은 넓히지 않는다: 그 열의 선언 너비는
줄바꿈 기준이기도 해서(`dataRowHeight`) 넓히면 행 높이가 함께 어긋난다.
회귀 가드: `src/lib/__tests__/admin-table-workbook.test.ts`.

적용 현황(2026-07-30 기준): 청소 기록 / 근태 급여 / 근태 교통비 / 근태 수당 / 연차 이력 / 연차 잔여 /
분실물 / 주문·비품 / 린넨 반품 — 전부 위 캐논을 따른다.

**확정 예외 — 수리·점검(`/admin/maintenance`)에는 내보내기가 없다 (2026-07-14, 사용자 결정).**
"Excel과 PDF를 항상 함께 제공한다"는 위 규칙은 **내보내기를 제공하는 화면**에 적용되는 것이지, 모든
화면이 내보내기를 가져야 한다는 뜻이 아니다. 수리·점검은 급여·정산처럼 외부로 넘길 산출물이 아니라
현장이 처리하고 콘솔이 감시하는 운영 기록이라, 내보낼 일이 없다고 판단했다. 버튼과 서버 액션
(`exportMaintenanceWorkbook` / `exportMaintenanceReport`)을 **모두 삭제**했다 — 다시 필요해지면
`buildAdminTableWorkbookBase64` / `buildAdminTableReportHtml`로 되살린다. 새 화면에 내보내기를 붙일
때는 여전히 Excel + PDF 2종을 함께, `<AdminExportButtons>`로만 제공한다.

### 설정 섹션 — 마스터·디테일 (2026-07-31)

`/admin/settings` · `/admin/settings/organization` · `/admin/settings/attendance` 는 이 콘솔에서
마지막까지 구형 Tailwind `Card`/`Button` 으로 남아 있던 화면이었다. 2026-07-31 에 공용 `.adm`
프리미티브로 이식하면서 구조도 다른 콘솔과 맞췄다.

- **탭 바**: `SettingsSubnav`(`src/components/admin/settings/settings-subnav.tsx`). 시각 표현은 공용
  `.lvsubtabs`/`.lvsubtab` 를 그대로 쓴다 — 설정만의 탭 스타일을 새로 만들지 않는다. 근태 콘솔의
  `AttendanceSubnav` 와 같은 역할이다.
- **마스터·디테일**: 출퇴근 QR 과 조직 설정 모두 `좌측 목록 표 / 우측 상세`. 린넨·청소 콘솔의
  목록+상세 패턴과 같은 구조라, 설정 안에서 조작 방식이 화면마다 바뀌지 않는다.
- **목록은 상태를 보여준다**: 출퇴근 QR 좌측 표는 현장별 QR 상태를 `.pill` 로 노출한다
  (준비됨 / 조치 필요 / 미발급). 설정 인덱스 카드도 현장 수·QR 준비됨·조치 필요 카운트를 같이 보여준다.
- **페이지 전용 CSS 는 최소**: `settings-console.css` 에 마스터·디테일 그리드(`.setgrid`), 결과 배너
  (`.setnote`), QR 표면(`.setqr`), 발급 이력 행(`.sethist`) 정도만 둔다. 나머지는 전부 공용 프리미티브다.
- **권한 노출 일치**: 조직 설정은 플랫폼 개발자 전용이므로 인덱스 카드와 탭도 같은 조건으로만 노출한다
  (이전에는 카드가 모두에게 보이는데 페이지에서 튕겼다).

### Home Top Priority Blocks

최상단 우선 정보는 아래 4묶음이다.

- 진행 중 청소
- 미처리 정비 / 분실물 / 주문
- 이상 근태 / 정정 요청
- 중요 공지 / 오늘 할 일

### Home Should Also Include

- 오늘 체크인 / 체크아웃 현황
- 예약/객실 운영 경고
- 새 알림
- 컴플레인/버그 리포트 요약
- 조직 전환 상태
- 전역 검색 진입

## Global Dashboard UX

### Global Search

대시보드 상단 전역 검색은 1차 필수다.

검색 대상:

- 사용자
- 건물 / 객실
- 예약
- 정비
- 분실물
- 주문
- 할 일
- 게시판 / 공지 / 제안함 / 버그 리포트
- 컴플레인

### Organization Switcher

하나의 계정이 여러 조직을 다룰 수 있으므로 대시보드 상단 조직 전환기를 둔다.

### Notification Center

알림 센터는 1차 포함이다.

- 벨 아이콘
- 읽음/안읽음
- 중요 알림 우선 표시
- 해당 상세 화면 deep link

### List / Detail Pattern

핵심 목록 화면은 아래 패턴을 기본으로 한다.

- 목록
- 우측 상세 패널
- 필요 시 전체 상세 페이지

즉 기본은 빠른 패널 검토이고, 긴 편집/복잡한 기록은 전체 페이지로 확장한다.

### Batch Actions

일괄 처리는 1차 필수가 아니다.

- 1차는 단건 실행/수정/검토 흐름 완성
- 2차에서 모듈별 일괄 처리 확장

### Real-Time Refresh

핵심 운영 모듈만 자동 갱신한다.

1차 자동 갱신 포함:

- 진행 중 청소
- 이상 근태 / 정정 요청
- 미처리 정비 / 분실물 / 주문
- 알림 센터
- 오늘 할 일
- 예약 / 체크인 / 체크아웃 현황

나머지는 수동 새로고침 또는 재진입 기준으로 처리해도 된다.

## Foundational First Screens

대시보드 디자인은 아래 2개 화면부터 시작한다.

1. 로그인 화면
2. 홈 화면

이 두 화면이 대시보드 전체의 첫 인상, 톤, 구조, 정보 우선순위를 결정한다.

### Why These Two First

- 로그인 화면은 데스크톱 대시보드의 진입 규칙을 고정한다
- 홈 화면은 대시보드 전체 IA 와 운영 철학을 고정한다
- 이후 기능 화면은 홈에서 무엇을 먼저 보여주는지에 따라 구조가 정해진다

## Admin Login Screen

### Purpose

관리자 대시보드 로그인 화면은 데스크톱 사용자가 Foldy 운영 콘솔로 진입하는 첫 화면이다.

이 화면은:

- 하나의 계정 체계
- 데스크톱 우선 진입
- 운영 제품다운 신뢰감
- 다국어 지원
- 로그인 이후 정확한 표면 진입

을 동시에 보여줘야 한다.

### Core Rules

- 루트 데스크톱 진입은 로그인 화면으로 들어간다
- 모바일/태블릿은 대시보드 로그인 화면을 기본 표면으로 보지 않는다
- 로그인 성공 후에는 온보딩/권한/조직 상태를 반영해 다음 표면으로 이동한다
- 같은 계정 체계로 모바일 앱과 대시보드를 함께 사용한다
- 대시보드와 모바일 중 하나를 고르는 랜딩 화면은 두지 않는다

### 대시보드 전용 가입 화면 (2026-10-01)

PC 에서 가입하면 `/onboarding` 이 **모바일 마법사가 아니라 한 화면 폼**을 그린다
(`src/app/onboarding/desktop-onboarding.tsx` · `desktop-onboarding.css`). Claude Design
「PC 회원가입 전후 비교」의 2a 안이다.

- **분리 규칙:** 기기 표면(`getDeviceSurfaceFromHeaders`)이 `desktop` 일 때만 PC 화면이다. 모바일 · 판별 불가는
  기존 `onboarding-wizard.tsx` 그대로 — 두 화면은 컴포넌트 · CSS 를 공유하지 않는다. 서버 액션
  (`submitOnboardingProfile` · `joinWithInviteCode` · `previewInviteCode`)과 검증 규칙만 같이 쓴다.
- **레이아웃:** 로그인과 같은 split(왼쪽 에스프레소 브랜드 패널 + 오른쪽 폼, `.authx` 토큰). 브랜드 패널에
  단계(계정 만들기 ✓ → 프로필 · 팀 참여 → 시작하기). 좁은 폭(≤1080px)은 브랜드 패널을 숨기고 폼을 1단으로.
- **기본 정보(한 화면, 2단 그리드):** 이름 · 생년월일(YYYY / MM / DD 키보드 입력, 다 차면 다음 칸, 빈 칸에서
  Backspace 는 앞 칸, 만 14세 이상 · 실제 날짜 검사) · 성별(세그먼트) · 휴대폰 번호(국가번호는 **입력칸 아래 검색
  드롭다운** — ↑↓ · Enter · Esc, 하단 시트 없음).
- **팀 참여:** 초대코드 + 「팀 확인」 → 조직 · 역할 카드. 확인 안 하고 제출하면 Enter 한 번에 확인까지 한다.
  「코드 없이 나중에 입력」은 프로필 단계에서만(저장 후 `/onboarding` 의 초대코드 화면으로).
  프로필이 이미 있는 경우(`needs_membership` · 재가입)는 초대코드 칸만 보인다.
- **제출:** 폼 바로 아래 버튼 · Enter(키 표시는 두지 않는다). 주 버튼은 로그인 「이메일로 계속하기」와 같은 그라디언트 ·
  50px · 14.5px/800, 「코드 없이 나중에 입력」은 로그인 「이메일로 가입」 링크와 같은 남색 800. 빈 필수 칸은 제출을 누른 뒤에만
  빨갛게. 전화번호 중복은 그 칸 아래에.
  성공하면 같은 화면에서 완료 안내 → 「업무 시작하기」.
- 문구: `onboarding.desktop` (ko/ja/en) + 기존 `onboarding.steps` · `joinFlow` · `review` · `success` 재사용.

### Required Login States

디자인은 아래 상태를 수용할 수 있어야 한다.

- 기본 로그인 진입
- 이메일 로그인
- 이메일 회원가입
- 비밀번호 재설정 요청
- 새 비밀번호 설정
- 확인 메일 발송 완료
- 비밀번호 변경 완료
- 계정/멤버십 차단 상태

즉, 로그인 화면은 한 장의 정적 화면이 아니라 인증 상태를 담는 공통 프레임이다.

### Required Elements

- Foldy 브랜드 영역
- 운영 콘솔이라는 정체성을 보여주는 짧은 설명
- Google 로그인 진입
- 이메일 로그인 진입
- 언어 선택
- 오류/상태 메시지 배너 영역
- 비밀번호 재설정 진입
- 계정 차단/제거/비활성 상태 대응 영역

### Product Tone

로그인 화면은 일반 소비자용 마케팅 랜딩처럼 보이면 안 된다.

원하는 인상:

- 안정적
- 신뢰 가능
- 조용하지만 고급스러움
- 실무 제품답게 명확함
- 모바일과 같은 브랜드 감성

### Layout Direction

디자인 자유도는 열어두되, 아래 원칙은 유지한다.

- 데스크톱 폭을 전제로 한 구조
- 브랜드/설명 영역과 인증 영역의 시각적 위계 분리
- 인증 폼은 한눈에 읽히고 빠르게 입력 가능해야 함
- 언어 변경과 상태 메시지가 폼을 방해하지 않아야 함
- “처음 진입하는 관리자/사무실 사용자” 에게 불안감을 주지 않아야 함

### UX Notes For Design

- 대시보드 로그인 화면에서 모바일 앱 선택 버튼은 두지 않는다
- 하지만 데스크톱 관리자도 같은 계정으로 모바일 앱을 쓴다는 느낌은 줄 수 있다
- 보안/조직 운영 제품이라는 인상을 주는 보조 카피나 아이콘은 허용된다
- 입력량보다 상태 가독성이 더 중요하다

### What The Login Screen Is Not

- 제품 소개 랜딩 페이지
- 마케팅 사이트
- 대시보드/모바일 선택 페이지
- 복잡한 온보딩 설명 페이지

## Dashboard Home Screen

### Purpose

홈 화면은 “오늘 운영에서 무엇이 중요한가” 를 가장 빠르게 보여주는 관리자 콘솔 첫 화면이다.

이 화면은:

- 숫자 요약
- 긴급 작업
- 검토 대기
- 운영 이상 상태
- 빠른 상세 진입

을 한 화면 안에서 균형 있게 보여줘야 한다.

### Home Type

홈은 아래 두 성격이 섞인 운영 콘솔이다.

- KPI / 현황 보드
- 오늘 해야 할 일 허브

즉 단순 숫자 카드 모음도 아니고, 단순 할 일 리스트도 아니다.

### Required Top-Priority Blocks

홈 최상단에서 우선 보여야 하는 정보 묶음:

- 진행 중 청소
- 미처리 정비 / 분실물 / 주문
- 이상 근태 / 정정 요청
- 중요 공지 / 오늘 할 일

### Required Secondary Blocks

최상단 다음으로 강하게 보여야 하는 정보:

- 예약 / 체크인 / 체크아웃 현황
- 알림 센터 진입
- 전역 검색
- 조직 전환
- 모바일 버전 보기 진입

### Header Requirements

홈 상단 공통 헤더에는 아래 요소가 들어가야 한다.

- 조직 전환기
- 전역 검색
- 알림
- 계정/프로필 진입
- 필요 시 모바일 버전 보기 진입

### Home Layout Direction

홈은 카드 몇 개만 띄우는 단순 대시보드가 아니라, 운영 밀도가 느껴져야 한다.

권장 구조:

- 상단: 조직 / 검색 / 알림 / 계정
- 첫 번째 구역: 오늘 운영 핵심 요약
- 두 번째 구역: 처리 대기 큐
- 세 번째 구역: 경고 / 이상 / 검토 필요
- 네 번째 구역: 공지 / 오늘 할 일 / 빠른 진입

### Interaction Pattern

홈의 모든 핵심 카드/행은 아래 중 하나로 바로 이어져야 한다.

- 우측 상세 패널
- 해당 모듈의 목록 화면
- 전체 상세 페이지

홈은 정보를 “보여주기만” 하면 안 되고, 즉시 운영 화면으로 이어져야 한다.

### Auto-Refresh Targets

홈에서 자동 갱신 우선 대상:

- 진행 중 청소
- 이상 근태 / 정정 요청
- 미처리 정비 / 분실물 / 주문
- 알림 센터
- 오늘 할 일
- 예약 / 체크인 / 체크아웃 현황

### Design Tone

홈 화면은 아래 느낌을 동시에 가져야 한다.

- 차분함
- 통제력
- 밀도감
- 즉시성
- 모바일과 같은 브랜드 무드

중요:

- 정보가 많아도 정신없어 보이면 안 된다
- KPI 카드만 예쁘게 놓는 식의 generic SaaS 대시보드가 되면 안 된다
- 실제 운영자가 “오늘 어디부터 봐야 하는지” 가 즉시 읽혀야 한다

## Mobile View Inside Dashboard

대시보드 안에는 모바일 앱 보기 기능을 제공한다.

### Purpose

- 같은 계정으로 모바일 표면을 바로 확인
- 운영자가 데스크톱에서 모바일 UX를 검토
- 모바일 전용 흐름을 빠르게 재현

### Requirements

- 핸드폰 프레임 안에서 보여야 한다
- 실제 모바일 앱처럼 동작해야 한다
- 단순 목업이나 스크린샷이 아니다
- 현재 로그인한 같은 계정으로 열린다
- 관리자 대시보드의 축소판이 아니라, 진짜 모바일 표면이어야 한다

### Presentation Modes

- 우측 패널 안의 핸드폰 프레임
- 전체 화면 오버레이 확장 모드

### First-Slice Target

구조는 전 기능 확장 가능하게 설계하되, 1차 적용은 핵심 모듈부터 시작한다.

추천 우선 모듈:

- 예약 / 캘린더
- 청소
- 근태
- 할 일
- 공지
- 컴플레인

## Module Rules

### Reservations / Calendar

예약 원본 데이터의 source of truth 는 Beds24 이다.

- Foldy 대시보드에서 Beds24 원본 예약을 직접 수정하지 않는다
- Beds24 변경은 웹훅으로 Foldy 에 반영되어야 한다

대신 Foldy 대시보드는 아래 운영 데이터를 관리한다.

- 운영 메모
- 얼리 체크아웃 시간
- 청소 상태 연결
- 정비/컴플레인/할 일 연결
- 내부 태그
- 담당자 메모
- 후속 조치 기록

1차 필수 화면/기능:

- 월간 객실 캘린더
- 주간/일간 보기
- 객실 타임라인
- 빈방 보기
- 예약 상세 패널
- 예약 검색
- 건물별 필터
- 채널별 필터

현재 구현 상태 (2026-07-09):

- `/admin/calendar` 은 하나의 통합 예약 콘솔로 구현되었다.
- 같은 페이지 안에서 아래 4개 뷰를 전환한다.
  - 월간 보드
  - 오늘 운영
  - 객실 상태
  - 건물 정보
- 우측 예약 인스펙터는 Beds24 원본 데이터는 읽기 전용으로 유지하면서, 운영 보조 작업만 연결한다.
  - `Beds24 ID 복사`
  - 예약별 내부 메모 저장 (`reservation_internal_notes`, 조직 + 예약 단위 영구 저장)
  - 모바일 캘린더 바로 보기
  - 수리 / 컴플레인 / 분실물 모바일 작성 화면으로 예약 컨텍스트 딥링크
- 대시보드 상단의 `모바일 보기` 버튼은 단순 `/mobile` 이동이 아니라 현재 캘린더의
  `month` / `property` 문맥을 유지한 `/mobile/calendar?...` 링크를 사용할 수 있다.
- 월간 보드는 현재 관리자 대시보드의 예약 기본 화면이다.
  - 객실 × 날짜 밀집 타임라인
  - 세로 스크롤 중에도 날짜 헤더가 계속 보이는 sticky header
  - 건물명만 보이는 중앙 정렬 chip filter
  - 채널 앵커 메뉴 filter
  - 내보내기 버튼
  - 우측 예약 상세 drawer
- 화면 내부 언어 토글은 두지 않는다.
  - 관리자 예약 캘린더는 로그인 사용자의 `preferred_language` 를 그대로 따른다
  - 언어 변경은 사용자/프로필 설정에서만 수행한다
- 예약 상세 drawer 는 **읽기 전용 원칙**을 따른다.
  - Beds24 ID 복사 가능
  - 정비 / 분실물 화면으로 이동 가능
  - 컴플레인 연결은 실제 관리자 route 부재로 아직 보류 toast 만 제공
- `Today ops` / `Room status` / `Building info` 는 운영 스냅샷 보드 역할을 한다.
- `객실 상태` 테이블의 현재 투숙 / 다음 예약 셀은 상태 텍스트보다 숙박 범위를 우선한다.
  - 게스트명 아래에 `체크인일 ~ 체크아웃일` 형식으로 바로 보이게 한다.
- `Today ops` 의 3번째 카드와 상단 요약 KPI 는 더 이상 턴오버/청소 필요를 재사용하지 않는다.
  - 대신 모바일 청소 smart list 와 같은 규칙의 `셋팅 대상` 을 보여준다.
  - 기준: `check_in_date = today` 이고 같은 객실에 `check_out_date = today` 가 없는 예약
  - 대상이 없으면 명시적인 빈 상태 문구를 표시한다.
- `Building info` 는 `src/lib/property-map-links.ts` 를 source of truth 로 읽는다.
  - 현재 화면 내 편집은 브라우저 세션 미리보기만 반영되고 서버 저장은 아직 없다.
- 우상단 새로고침 chip 은 **수동 스냅샷 갱신용 UI** 이다.
  - `router.refresh()` 만 수행
  - secret 보호된 `/api/beds24/reconcile` 를 관리자 직접 실행 버튼으로 노출하지 않는다
- **독립 `/admin/check-in-out` 모듈은 폐기됨 (2026-07-22).**
  - 이유: 오늘 체크인/체크아웃 조회, 투숙중, 셋팅 대상 등 핵심 운영 기능이 이미 `/admin` 홈 요약과
    `/admin/calendar` 통합 예약 콘솔에 구현되어 있어 독립 메뉴가 기능 중복만 만들기 때문.
  - 사이드바의 `체크인/아웃` 항목과 독립 라우트는 모두 제거되었다.
  - 따라서 대시보드에서 체크인/체크아웃은 **독립 모듈이 아니라 예약 캘린더 콘솔의 운영 보드 영역**으로
    취급한다.

### Cleaning

청소는 관리자 개입과 운영 추적 중심으로 설계한다.

1차 포함:

- 진행 중 청소 실시간 보기
- 청소 기록 조회
- 청소 기록 수정/보정
- 관리자 강제 완료
- 메모/사진 검토
- 정비/분실물 연계 확인
- 날짜/건물/직원 필터
- Excel / PDF export (CSV는 2026-07-14에 폐기 — 위 "Excel + PDF 내보내기" 절 참고)

### Lost & Found / Orders

두 모듈은 대시보드에서 전 범위를 처리한다.

- 신규 등록
- 상세 조회
- 상태 변경
- 수정
- 삭제
- 사진 보기
- 댓글/메모
- 담당자/요청자/건물 필터
- export

### Maintenance (수리·점검) — 위 규칙의 예외 (확정, 2026-07-14)

수리·점검 콘솔은 **감시 + 이력 + 예외 개입** 전용이다. 처리(상태 변경·처리 메모·완료 사진)는
현장이 모바일에서 한다. 따라서 위 목록 중 다음 세 가지가 **의도적으로 없다**:

| 항목 | 상태 | 이유 |
| --- | --- | --- |
| 본문 수정 | **없음** | 접수된 신고는 사실 기록이다. 잘못된 건은 수정이 아니라 삭제·무효 처리로 정리한다. |
| 담당자 배정·담당자 필터 | **없음** | 배정 개념 자체를 두지 않는다 (`assignee` 컬럼 없음). 현장이 먼저 잡는 쪽이 처리한다. |
| Excel / PDF 내보내기 | **없음** | 위 "Excel + PDF 내보내기 — 절대 규칙"의 명시적 예외. 내보낼 업무 사유가 없다. |

어드민이 할 수 있는 것: 열람(보드/목록·이력/완료 3뷰) · 강제 완료 · 무효 처리 · 삭제.
자세한 내용은 `docs/product/08-maintenance-workflow.md`.

### Linen Return

린넨 반품 대시보드는 현장 등록을 대체하지 않는 **사무실 기록 관리 콘솔**이다. 상세 기획은
`docs/product/19-linen-defect-workflow.md` → "Admin Dashboard — Linen Return Record Management"를
기준으로 한다.

- 모바일: 현장에서 반품 등록·본인 기록 수정/삭제를 계속 담당한다.
- 대시보드: 언제(등록 시각), 어디서(건물), 무엇을(모든 품목), 얼마나(품목별/기록 총수량), 누가 등록했는지
  확인하고, 모바일에서 등록된 기존 기록을 수정·삭제한다.
- 기본 조회는 이번 달(Tokyo)·최신 등록순이며, 건물·날짜/기간·품목·등록자 필터를 제공한다.
- 수정은 건물·품목/수량·메모·사진만 가능하며, 원래 등록 시각·등록자는 증빙값으로 보존한다. 삭제는 MVP
  hard delete이며 확인 모달과 감사 기록(`audit_logs`)이 따른다.
- 대시보드 v1에서 새 반품 등록, 상태, 품목 마스터, 월별 집계 대시보드는 범위 밖이다.
  (기간 내 **품목별 수량 대조표**와 **Excel/PDF 내보내기**는 2026-07-30 결정으로 범위에 포함됐다 —
  아래 참고.)

**구현 완료 (2026-07-30).** 라우트 `/admin/linen-return`, 사이드바 운영 그룹의 `린넨 반품`.

- **뷰 2개.** 「기록」(반품 한 건 = 한 행) / 「품목별 수량」(같은 조건의 품목별 대조표). 다른 콘솔의
  `.cviewbar` + `.lviews` 뷰 전환 패턴을 그대로 쓴다.
- **「기록」 뷰 열:** 등록 일시(요일 보조 표기) · 건물 · 반품 품목(요약 + 전체 품목/수량 나열) ·
  \[품목 필터 시 그 품목의 수량 열\] · 총 수량 · 등록자. 행을 잘라 단일 품목처럼 보이게 하지 않는다.
- **「품목별 수량」 뷰 열:** 반품 품목 · 수량(+막대) · \[건물을 좁혔을 때 전체 건물 수량\] · 기록 수 ·
  최종 반품. 반품이 없던 품목도 0으로 남겨 "누락"과 "0건"을 구분한다. 행을 누르면 그 품목으로
  「기록」 뷰가 좁혀진다.
- **필터 바:** 공용 `AdminDateRangePicker`(기간) + `AdmDropdown`(건물 / 품목 / 등록자). 등록자
  드롭다운은 공용 `AdmDropdown` 의 `searchable` 모드(메뉴 안 검색)를 쓴다 — 이 콘솔을 위해 만든
  전용 드롭다운이 아니라 공용 프리미티브 확장이며, 다른 콘솔도 그대로 쓸 수 있다.
- **등록 액션은 없다.** 대신 상단에 "현장 모바일 등록" 배지(`.robadge`)와 안내(`.dimnote`)를 둔다.
- **상세 패널**(`.panel`)에서 읽기 ↔ 수정을 전환한다. 수정 모드에서 등록 일시·등록자는 잠금
  필드(`.rofield` + 자물쇠)로만 보이고 편집할 수 없다.
- **삭제**는 공용 파괴적 작업 모달(`.cficon--dispose` / `.stnote--expired` / `.btn--danger`)로 확인한다.
- 기간은 URL `?from=&to=` 로 관리하고 서버가 조직 스코프 쿼리로 좁힌다. 다른 조직·다른 기간의 행이
  브라우저로 내려오지 않는다.
- **Excel + PDF 내보내기** — 공용 `<AdminExportButtons>` 를 필터 바 오른쪽(`.ctoolbar__spacer` 뒤)에
  둔다. 위 "Excel + PDF 내보내기 — 절대 규칙"을 그대로 따른다: 두 형식을 항상 함께 제공하고,
  서버는 같은 입력으로 `buildAdminTableWorkbookBase64` / `buildAdminTableReportHtml` 을 호출하며,
  로케일은 `buildAdminExportMeta(session)` 가 서버에서 정한다. CSV 는 없다.
  **한 파일에 시트 2개**(「린넨 반품 기록」 + 「품목별 수량」)를 담아 콘솔의 두 탭과 1:1로 맞춘다.
  제목 앞 라벨에 기간과 적용된 필터(건물 · 품목 · 등록자)를 함께 찍어, 파일만 봐도 조건을 알 수 있다.
  기록이 0건이면 버튼이 비활성화된다.

### Tasks / Projects

대시보드에서 아래를 모두 지원한다.

- 개인 작업
- 공유 작업
- 프로젝트
- 참여자 관리
- 댓글/업데이트
- 완료/재오픈
- 프로젝트 섹션 흐름
- 필요 시 모바일 버전 바로 보기

### Board

대시보드에서 게시판도 직접 운영한다.

- 글 작성
- 상세 보기
- 수정/삭제
- 댓글/반응
- 고정/관리자 운영

### Announcements

공지 역시 대시보드의 핵심 운영 영역이다.

- 작성
- 중요 표시
- 타깃 설정
- 게시/보관 상태 관리
- 읽음 추적
- 팝업/공지 운영

대시보드 공지 화면은 모바일 공지의 단순 확장판이 아니라 **배포 관리 콘솔**이어야 한다.

- 상태는 `Published / Drafts / Archived` 3개만 사용한다
- 모바일에서 가능한 공지 기능은 대시보드에서도 모두 가능해야 한다
- 작성 권한과 게시/보관/삭제 같은 운영 권한은 분리해서 본다
- 기본 뷰는 `Published / Drafts / Archived`
- 핵심 요약은 게시중 / 초안 / 중요 / 팝업 활성 / 미읽음 남은 중요 공지
- 읽음 추적은 전체 공지에 존재하지만, 대시보드 운영상 강조는 중요 공지 미읽음 위주로 둔다
- 목록은 제목 + 상태 + 중요/고정/팝업 + 대상 + 작성자 + 날짜 + 읽음 요약을 밀도 있게 스캔 가능해야 한다

**구현 상태 (2026-07-23):** 위 명세대로 `/admin/announcements` 콘솔이 재구현되었다. 다른 운영
콘솔(주문·분실물·수리)과 동일한 패턴(`AdminShell` + 클라이언트 콘솔 + `x-console.css` + 결과 반환형
서버 액션)을 따른다. 상세는 `docs/product/11-announcement-workflow.md` → "Admin Dashboard
Management Console" → Current Implementation Note.
- 행 클릭 시 우측 상세 패널에서 본문 / 첨부 / 읽음 상태 / 게시/보관/삭제 액션을 처리한다
- 현재 구현의 좌측 고정 생성 카드는 임시 형태로 보고, 장기적으로는 `새 공지` 작성 패널/전용 편집 흐름으로 정리한다
- 공지는 공식 안내 채널이므로 댓글/토론은 게시판 또는 제안함으로 분리한다. 어드민 공지 댓글 UI는 레거시 클린업 대상으로 본다

### Suggestions

제안함은 관리자 대시보드에서 직접 확인/참여/상태 관리가 가능해야 한다.

### Bug Reports

버그 리포트는 모바일 전용 리뷰어 흐름으로 남기지 않는다.

대시보드에서 가능해야 하는 범위:

- 목록/상세
- 상태 변경
- 검토 메모
- 이미지 확인
- deep link

### Guest Feedback (게스트 피드백)

게스트 피드백은 사무실/CS 중심의 **수동 컴플레인 + Beds24 외부 리뷰** 통합 검토 모듈이다. 외부 리뷰와
내부 처리 티켓은 구분한다. 낮은 평점 리뷰를 자동 티켓으로 만들지 않고, 검토자가 필요할 때만 수동
컴플레인으로 전환·연결한다.

> **`컴플레인` → `게스트 피드백` 개명 (2026-08-11).** 이 모듈은 좋은 평을 포함한 Airbnb ·
> Booking.com 리뷰 전체와 문제 객실 집계까지 다루는데, 「컴플레인」은 세 뷰 중 하나만 가리켰다.
> 사이드바 라벨은 `게스트 피드백` / `ゲストフィードバック` / `Guest Feedback` (모바일 탭바만
> 폭 때문에 축약형 — `docs/product/16-mobile-navigation.md`). **바뀐 것은 표시명뿐이다**:
> 라우트 `/admin/complaints`, 내비 id `complaints`, 테이블 `customer_complaints`, 그리고
> 컴플레인 **엔티티**를 가리키는 문구(`수동 컴플레인`, `컴플레인 등록`, `컴플레인으로 전환`)는
> 그대로 둔다.

`/admin/complaints` (계획)은 공용 어드민 콘솔 패턴을 사용한다.

- 뷰 3개: `수동 컴플레인` / `외부 리뷰` / `문제 객실`
- 수동 컴플레인: 등록·상세·상태 변경·댓글·사진, 건물/객실/예약/작성자/날짜 필터
- **직접 등록** (구현 2026-08-06): 수동 컴플레인 뷰 헤더의 공용 `chipbtn` `+ 컴플레인 등록`이 공용
  `.panel` 우측 슬라이드오버를 연다. 저장은 모바일 등록과 같은 도메인 함수를 쓴다. 연결은
  `예약 연결` / `건물 · 객실` / `연결 안 함` 3가지 — Beds24를 거치지 않고 들어온 예약(전화·워크인·
  자사 홈페이지)도 객실을 남길 수 있어야 하기 때문이다. 건물·객실은 활성 객실 마스터에서 고르며
  자유 텍스트가 아니다. 전용 폼 스타일을 만들지 않고 `.fld` / `.btn--pri` 공용 primitive를 쓴다.
- 외부 리뷰: Airbnb·Booking.com 원점수, 위험도, 건물·객실·예약 문맥, 플랫폼/위험도/건물/객실/리뷰 날짜 필터
- 상세: 원문은 보존하고 필요 시 현재 앱 언어(한국어·일본어·영어)로 자동 번역을 표시한다. 목록·필터에서는
  번역 API를 호출하지 않으며, 같은 리뷰·언어 번역은 캐시를 재사용한다.
- 플랫폼이 제공한 세부 평점은 상세에서만 조건부로 보인다. Booking.com 긍정/부정 본문과 리뷰 제목은 분리해
  표시하며, 본문 없이 점수만 있는 유효 리뷰도 일반 행으로 표시한다.
- Airbnb 비공개 피드백은 상세에서만, `비공개` 배지와 함께 공개 리뷰와 분리해 보여준다. Booking.com에 이미
  달린 OTA 답글은 읽기 전용으로만 표시하며 대시보드에서 답글을 작성·전송하지 않는다.
- 외부 리뷰 기본 순서: 위험도 우선 → 낮은 원점수 → 최신 리뷰
- 위험 기준(2026-08-04 확정): Airbnb **3점 이하**, Booking.com **7.0점 이하**가 문제. 경계값 포함이며
  `매우 위험` 단계는 두지 않는다. 위험도는 `미평가 / 정상 / 문제` 3값이다.
- 리뷰는 점수와 무관하게 전량 저장한다. 위험도는 분류이지 수집 필터가 아니다.
- 객실은 Beds24 예약/객실 식별자와 신뢰성 있게 매칭된 경우만 표시하며, 그렇지 않으면 객실 정보 없음을 명시.
  Airbnb는 조회한 룸타입으로 객실이 확정되고, Booking.com은 예약 ID 역조회로만 객실을 얻는다.
- `문제 객실` 뷰: 선택 기간 리뷰를 건물 → 객실 2단으로 집계해 플랫폼별 `평균 원점수 / 리뷰 수 / 문제 건수 /
  문제 비율`을 함께 보여준다. 기본 정렬은 문제 비율 내림차순이고, 문제 건수를 누르면 해당 건물·객실의 문제
  리뷰만 필터된 `외부 리뷰` 뷰로 이동한다. 평균만으로는 리뷰가 많은 객실의 저평점이 묻히기 때문이다.
- Airbnb·Booking은 척도가 달라 플랫폼별 평균 원점수와 리뷰 수를 분리 표시하며, 단일 종합 평점으로 합치지
  않는다. 객실 미연결 리뷰는 건물 합계에만 넣고 `객실 미연결 N건`으로 밝힌다.
- 오쿠보는 모두 독채(`property_type = 'standalone'`)이므로 건물 행 하나만 제공하고 객실 행을 펼치지 않는다.
  기간 선택은 공용 `AdminDateRangePicker` / `DateRangeFormField`를 쓰며, 기본 기간은 디자인 단계에서 확정한다.
- 상세 패널에서 외부 리뷰 원문을 확인하고, 권한 있는 사용자는 수동 컴플레인으로 전환하거나 연결된
  컴플레인으로 이동

외부 리뷰 목록은 Foldy 로컬 DB만 조회한다. 화면 필터/정렬/상세 진입이 Beds24 API를 호출해서는 안 된다.
대시보드는 `/mobile/complaints`와 동일한 조직 데이터·리뷰 ID·컴플레인 ID를 사용한다. 사무실에서 상태를
변경하거나 외부 리뷰를 컴플레인으로 전환하면 모바일에도 같은 연결 상태가 반영되며, 대시보드 전용 복사본을
만들지 않는다. 시각 디자인은 별도 디자인 작업에서 결정한다. 자동 티켓 생성, OTA 답글 전송, 통계 차트, export, 담당자
배정 UI는 이 1차 범위에 포함하지 않는다. 상세 도메인 계약은 `docs/product/25-complaint-workflow.md`를 따른다.

### Attendance / Payroll / Transportation

대시보드 최우선 모듈이다.

1차 필수 범위:

- 출근자 명단
- 정정 요청 검토
- 수동 출근/퇴근 세션 생성
- 세션 시간/사이트 수정
- 세션 무효 처리
- 시급/고용형태 관리
- 추가수당/특별수당 관리 (`/admin/attendance/wages`, 2026-07-10 구현)
- 월 마감
- 급여 총액 대시보드
- 교통비 검토/승인/반려
- 교통비 증빙 이미지 검토
- 급여/교통비 export
- 출근 사이트/QR 관리

추가 원칙:

- 출근자 명단은 웹 전용 기능이 아니다
- 모바일과 관리자 대시보드 모두에서 보여야 한다
- QR 스캔 출퇴근만 모바일 전용이다

구현 상태 (2026-07-02):

- `/admin/attendance` overview는 검토 큐, 정정 요청, 급여, 교통비 KPI를 같은 서버 헬퍼에서 집계해
  각 상세 페이지와 숫자가 어긋나지 않도록 한다.
- overview의 정정 요청 카드는 열린 요청 수만 표시하지 않고 최근 열린 요청을 직원, 대상일, 변경값,
  제출 시각으로 보여준다.
- `/admin/attendance/queue`는 검토 필요 세션, 정정 요청, 수동 수정/무효/복원, 감사 이력을 운영자가
  한 화면에서 처리하는 콘솔 표면이다. 정정 승인 시 출근 지점과 퇴근 지점은 독립 필드로 보존되며,
  서버에서 조직 소유 지점인지 다시 검증한다. 검토 큐는 미확정 작업함이므로 export 액션을 두지
  않고, 급여/교통비처럼 확정 또는 정산 목적이 분명한 화면에서만 내보내기를 제공한다.
- `/admin/attendance/roster`는 모바일 `/mobile/attendance/roster`와 같은 `getAttendanceRoster`
  조회를 사용하는 관리자용 일 단위 출근자 명단이다. 모바일 출퇴근/휴게 기록은 별도 동기화 없이
  같은 `attendance_sessions`/`attendance_breaks` 데이터에서 즉시 반영되며, 오늘 날짜는 클라이언트에서
  10초 주기로 조용히 새로고침해 운영자가 현재 출근자를 감지할 수 있다.
- `/admin/attendance/payroll`, `/transport`, `/wages`, `/staff/[userId]`는 같은 데스크톱 콘솔 패턴을
  사용한다. 특히 임금 예약 변경은 서버의 미래 예약 삭제/대체 규칙과 클라이언트 히스토리 표시가
  일치해야 한다. 시급 관리는 설정/이력 확인 화면이므로 상단 `시급 대장 내보내기` 버튼은 두지 않고,
  실제 정산 export는 급여/교통비 화면에서 제공한다.
- `/admin/attendance/payroll`의 월 단위 내보내기 버튼명은 `엑셀 내보내기`로 표시한다. 이 엑셀은
  세무사/회계 실무 전달용 요약표이며 이름, 출근일수, 총 근무시간, 시급, 승인된 교통비, 교통비 제외
  급여, 교통비 포함 총 지급액을 포함한다. 교통비 금액은 교통비 검토 모듈의 승인 완료 금액만 연동한다.
- 직원별 패널의 내보내기는 기존 CSV가 아니라 개인별 월간 정산표 Excel/PDF로 제공한다. 개인별 양식은
  날짜, 출근시간, 퇴근시간, 날짜별 근무시간, 일 급여, 승인된 날짜별 교통비, 청소한 객실, 총합계를
  포함한다. `청소한 객실`은 청소 기능의 완료된 청소 세션(`completed_at` 존재)을 직원+청소일 기준으로
  연동한다. 개인별 Excel/PDF에서는 이 `청소한 객실` 컬럼도 우측 정렬한다. 객실 표시는 현재 요약 규칙
  `아라키초A → AA`, `아라키초B/아리키초B → AB`,
  `가부키초 → KK`, `다카다노바바 → T2`, `오쿠보* → 원문 유지`, `스카이 → 원문 유지`를 적용한다.
  아라키초처럼 동일 객실이 복수 account room key(`501`, `501_2`)로 들어오는 경우에는 청소 UI와 같은
  display-room 규칙을 따라 `_2` suffix를 접고 `AA501` / `AB501`처럼 하나의 객실 표기로 통일한다.
  패널 하단 액션 라벨은 줄바꿈과 폭 흔들림을 피하기 위해 짧은 `상세` / `PDF` / `Excel` / `해제`(`마감`)
  표기로 유지하며, 개인별 PDF/Excel 내보내기와 마감/해제 처리 중에도 버튼 문구는 바꾸지 않는다.
  월별/개인별, Excel/PDF 네 가지 출력은 같은 녹색 장부 템플릿을 공유하며, 금액 컬럼은 검은색
  굵은 글씨로 통일하고, 합계 금액은 우측 정렬을 유지한다.
- 근태 콘솔의 대상 월은 탭별 개별 컨트롤이 아니라 최상단 공통 subnav 우측의 월 선택기 하나로
  제어한다. 개요/검토 큐/급여/교통비/시급/직원 상세는 같은 `?ym=YYYY-MM` 컨텍스트를 공유하며,
  월을 바꿔도 탭 간 이동 시 선택 월이 유지된다.
- 단, 출근자 명단은 운영일 단위 조회 화면이므로 월 단위 `?ym=` 대신 `?date=YYYY-MM-DD`를 사용한다.
  실제 날짜 선택은 근태 subnav 우측의 상단 일자 선택기 하나로 통합하고, 명단 본문 안에는 별도
  캘린더를 반복하지 않는다.
- **근태 subnav는 어느 탭에 있든 동일하게 보여야 한다 (2026-07-29 확정).** 탭을 옮길 때 바 자체가
  변형되면 안 된다는 뜻이며, 구체적으로 세 가지를 강제한다.
  1. **배지는 모든 탭에서 동일하게 표시한다.** 7개 페이지 전부 `getAdminAttendanceBadgeStats`를
     호출해 `queue` / `payroll` / `transport` 배지를 `AttendanceSubnav`에 넘긴다. 한 페이지라도
     `badges`를 빠뜨리면 숫자 칩이 사라지면서 뒤쪽 탭들이 통째로 왼쪽으로 밀려, 사용자에게는
     "탭 위치가 움직인다"로 보인다(연차 탭에서 실제로 발생했던 버그).
  2. **활성 탭 스타일은 7개 탭이 전부 같다** — 연한 primary 칩(`.subnav__t.on`). 특정 탭만 solid
     navy CTA로 강조하지 않는다. 과거 출근자 명단에만 적용되던 `.subnav__t--entry` 규칙은
     삭제됐다.
  3. **우측 컨트롤은 피커이거나 아무것도 없거나 둘 중 하나다.** 월 스코프가 있으면
     `AdminMonthPicker`, 운영일 스코프면 `AdminDatePicker`, 스코프 자체가 없으면(연차)
     아무것도 렌더링하지 않는다. 정적 텍스트를 대신 넣지 않는다 — 페이지 제목과 중복되고 그
     탭만 다른 컴포넌트처럼 보이게 만든다. `AttendanceSubnav`의 `monthLabel`은 이제 선택적
     prop이며 피커의 `aria-label` 용도로만 쓰인다.
- `/admin/attendance/*` page entry guards use the shared `requireAdminPageSession` helper. The helper
  centralizes unauthenticated → `/auth/login?next=...`, incomplete/no-organization → `/onboarding`, and
  non-admin-web role → `/mobile` redirects, so attendance admin pages cannot drift on organization
  context or role gating.
- `/admin/attendance/leave` (added 2026-07-07) is the **연차 승인 심사(approval review)** screen,
  a new "연차"/"年次"/"Leave" tab in the attendance console subnav
  (`src/components/admin/attendance/attendance-subnav.tsx`). Access is gated to leave approvers only
  (`is_leave_approver` — platform admin or a membership with `leave_approver_role` set); non-approvers
  see a permission-denied card. Backend `src/lib/annual-leave-approvals-server.ts` provides the org-wide
  request queue + summary, request detail (balance impact + same-period overlap), and the approve
  ("stamp") / reject (reason optional) actions. Frontend
  `src/components/admin/attendance/leave-queue-client.tsx` follows the same list + status-tabs + filter +
  right-side detail-panel dashboard pattern as `/admin/attendance/queue`. The other leave sub-tabs
  (팀 캘린더 / 직원 잔여·부여 / 문서 / 이력) are backend-wired (2026-07-08~09). **The former 승인자 관리
  sub-tab was removed (2026-07-13)** — approver granting is being unified onto the Users screen
  (`/admin/users`), so the leave section now has **5 sub-tabs**. See
  `docs/product/26-annual-leave-workflow.md` for full scope and follow-up items.

### Users / Permissions / Settings

본 섹션(사용자 목록/상세/역할/상태/권한 부여/초대) 전체가 **개발자 기본 + `manage_users` 위임** 접근
게이트를 공유한다 (`actorCanOpenUserManagement`, `src/lib/user-management-access.ts`, 2026-07-13).

1차 필수 범위:

- 사용자 목록
- 사용자 상세
- 역할 변경
- 활성/비활성/정지
- 초대코드 생성/수정/비활성화 — **`설정` → `사용자`로 이전됨 (2026-07-13)**. 초대(팀코드) 관리 화면이
  `/admin/settings/invite-codes`에서 `/admin/users/invites`로 옮겨져, 멤버 라이프사이클(초대 → 관리 →
  비활성 → 삭제)이 사용자 화면 한 곳으로 통일됐다. `/admin/users`와 `/admin/users/invites`는 상단
  "멤버 목록"/"멤버 초대" 탭 스위처(`src/components/admin/users/users-section-tabs.tsx`)로 오간다.
  게이트는 `/admin/users`와 동일하게 **개발자 또는 `manage_users` 위임**(`actorCanOpenUserManagement`,
  `src/lib/user-management-access.ts`) — 기존 owner/office_admin/전무 역할 하드코딩 체크는 이걸로
  대체됐고, 그 과정에서 전무(`senior_managing_director`)가 초대코드를 못 만들던 버그도 함께 해소됐다.
  초대 시 부여 가능한 기본 역할의 상한(개발자/owner/전무는 전체, 그 외는 `officeAdminAssignableRoles`만)은
  그대로 유지된다. 옛 경로(`/admin/settings/invite-codes`)는 새 경로로 리다이렉트만 하는 스텁으로 남아
  있다. 설정 페이지의 초대코드 카드는 제거됐다.

  **초대코드 생성 폼 자동화 (2026-09-09).** 폼에서 손으로 채우는 항목은 **조직과 역할 2개뿐**이다.
  나머지 네 값은 자동으로 만들어진다.

  | 항목 | 자동값 |
  | --- | --- |
  | 초대코드 | `HARU-K7M2QP` — 조직 slug(없으면 이름) 앞 6자 + 랜덤 6자. 문자 집합에서 `0 O 1 I L` 은 제외(구두 전달·손글씨 혼동 방지) |
  | 이름 | `사무직 초대 09-09` — 역할 라벨 + 도쿄 기준 생성일. `admin.settings.inviteAutoName` (`"{role} 초대 {date}"`) 을 ko/ja/en 각각으로 채운다 |
  | 만료일 | 도쿄 기준 오늘 + 30일 |
  | 최대 사용 횟수 | 10 |

  규칙은 `src/lib/invite-code-gen.ts` 한 곳에 있고 클라이언트 폼과 서버 액션이 같은 헬퍼를 쓴다.
  폼 아래 접힌 **"세부 설정"**(`InviteCreateForm`, `src/components/admin/users/invite-create-form.tsx`)
  을 펼치면 네 값 모두 덮어쓸 수 있고, 코드 옆 ↻ 로 다시 뽑을 수 있다. 이름은 사용자가 한 번이라도
  입력하기 전까지 역할 선택을 따라간다.

  구현상 두 가지 제약이 있다.

  - **첫 코드는 서버가 뽑는다.** 클라이언트가 첫 렌더에서 랜덤을 돌리면 SSR 결과와 어긋나
    하이드레이션이 깨진다. 재생성은 사용자 조작(조직 변경 / ↻)에서만 일어난다.
  - **`invite_codes.code` 는 전역 unique.** 자동 코드가 충돌하면 서버가 조용히 다시 뽑아 최대 5회
    재시도하고, 사용자가 직접 입력한 코드가 충돌하면 `duplicate_code` 로 알린다 — 말없이 다른 코드로
    바꿔치기하지 않는다.

  서버 액션(`createInviteCode`)의 필수 검증은 이제 **조직 + 역할**만이다. 나머지가 비어 오면 같은
  자동 규칙으로 채우므로, 폼이 아닌 경로로 들어온 요청도 동일하게 동작한다. 권한 상한
  (`canGrantDefaultRole`)은 그대로다.
- 조직 기본 설정
- 근태 관리자 권한 부여 (급여 담당 `attendance_payroll_admin` · 연차 결재자 `leave_approver_role`) —
  모든 역할·권한 부여를 사용자 상세로 통일 (2026-07-13 방향 확정). 디자인은 권한 예외 핸드오프 기반,
  백엔드는 디자인 컨펌 후. 참고: `docs/product/27-permission-override-workflow.md`
- 개인별 추가 권한 부여 (시간제한 per-user 권한 예외, `membership_permission_overrides`)
- 조직 전환
- 감사 로그 보기

## Priority Order

관리/운영/수정이 강한 영역을 먼저 만든다.
모바일과 단순 대칭만 필요한 기능은 후순위로 둔다.

### First Priority

1. Attendance / Payroll / Transportation
2. Reservations / Calendar / Check-In-Out
3. Users / Permissions / Organization Settings
4. Cleaning Operations
5. Maintenance / Lost & Found / Orders

### Next Priority

6. Linen Return
7. Tasks / Projects
8. Board
9. Announcements
10. Suggestions
11. Bug Reports
12. Complaints

## Document Structure Rule

대시보드 관련 문서는 과도하게 늘리지 않는다.

원칙:

- 이 문서를 관리자 대시보드 총괄 기준 문서로 사용
- 모바일 문서는 모바일 고유 UX 와 현장 흐름을 계속 관리
- 각 도메인 기능 문서는 공통 도메인 규칙을 관리
- 대시보드 전용 보조 문서는 꼭 필요한 경우에만 추가

즉, 관리자 대시보드 관련 변경은 우선 이 문서와 결정 로그, 현재 상태 문서에 먼저 반영한다.

## Design Note

관리자 대시보드는 마케팅형 대시보드가 아니라 조밀하지만 명확한 운영 콘솔이어야 한다.

- 숫자는 즉시 읽혀야 한다
- 경고는 한눈에 보여야 한다
- 수정은 빠르게 들어가야 한다
- 상세 검토는 깊게 들어갈 수 있어야 한다
- 모바일과 같은 브랜드 감성 위에서 데스크톱 운영 효율을 최우선으로 둔다
## 2026-07-10 Reservation Calendar Admin Contract

- `Building info` on the admin reservation calendar is a shared operational editor, not a local
  preview panel. Changes save to organization-scoped Supabase metadata and must be reflected on the
  mobile calendar map/access view as the same source of truth.
- Reservation export for the calendar is now an A4 landscape print surface (`/admin/calendar/print`)
  instead of a reservation CSV action. Keep this aligned with the shared admin calendar chrome.
- Beds24 sync state is exposed in the calendar chrome. During the temporary pause window, the admin
  console should show that sync is paused rather than implying a live Beds24 refresh.

## 2026-08-03 콘솔 CSS 변수 네이밍 — `--adm-*` (ABSOLUTE)

`admin-console.css` 및 `.adm` 스코프 CSS 가 정의하는 **콘솔 전용 값은 전부 `--adm-*` 접두어**를
쓴다. globals(`src/app/globals.css` `:root`)의 Tailwind 토큰과 같은 이름을 재정의하면, `.adm` 안에
렌더되는 공용 컴포넌트(`src/components/ui/**` 등)의 `bg-surface` / `bg-muted` 유틸이 조용히 다른
색이 된다 — CSS 변수는 클래스와 달리 **스코프를 넘어 상속되기 때문**이다.

- 금지: `.adm { --muted: … }` `--surface` `--primary` `--background` `--foreground` `--border` 등
  globals 토큰과 겹치는 이름
- 허용: `--adm-muted` `--adm-surface` `--adm-primary`, 그리고 겹치지 않는 콘솔 고유 이름
  (`--bg` `--ink` `--line` `--card` `--danger` …)
- 선례: `users-console.css` 의 `--ui-*`, `home-screen.css` 의 `--hm-*`

새 콘솔 CSS 를 만들 때 이 규칙을 먼저 확인할 것. 근거는
`docs/planning/01-decision-log.md` → 2026-08-03 항목.



## 에러 바운더리 (2026-08-05)

`/admin/*` 이 던지면 `src/app/admin/error.tsx` 가 받는다. 그전에는 루트 `src/app/error.tsx` 의
흰 화면 + 영어 "Something went wrong." 으로 떨어졌다 — 모바일은 브랜드·다국어 화면이 있는데
콘솔만 맨몸이었다.

모바일 경계와 **같은 문구 소스**(`src/lib/fallback-copy.ts`)를 쓰고, 언어는 루트 레이아웃이
심어 둔 `<html lang>` 에서 읽는다(알 수 없으면 `ko`). 사전 모듈(`i18n.ts`)에 의존하지 않는 이유는
`docs/product/16-mobile-navigation.md` 의 폴백 화면 항목과 같다 — 앱이 고장난 상태에서 떠야 한다.

### 알려진 노출 지점

로더가 던지는데 호출부가 `.catch` 하지 않는 콘솔 라우트가 셋 있다. DB 장애 시 이 화면이 뜬다:

- `admin/settings` → `getAttendanceSiteQrOverview`
- `admin/calendar` → `getAdminCalendarDashboardData`
- `admin/linen-return` → `getAdminLinenReturns`

다른 콘솔 로더들은 내부에서 `loadError` 플래그로 접어 화면을 유지한다. 위 셋도 같은 방식으로
바꾸는 것이 낫지만, 우선 **떨어질 곳을 제대로 만들어 두는 것**을 먼저 했다.

## 상단 예약 검색 (2026-09-30)

어드민 상단 검색창은 **판매 캘린더 권한(`ops_admin.access`)이 있으면** 예약 검색이다 — 고객명 ·
예약번호(Beds24 id · masterId · 채널 예약번호 `apiReference`) · 전화번호(`phone` · `mobile`)로 찾아
**판매 캘린더의 예약 상세 사이드 패널**(`ops-reservation-panel.tsx`)을 연다. 권한이 없으면 예전 자리
표시 입력 그대로다(열어 줄 패널이 없다). 「고객번호」라는 별도 개념은 데이터에 없어 전화번호·예약번호로 찾는다.

- **이름 매칭**(`src/lib/guest-search.ts`, 테스트 `guest-search.test.ts`): 대소문자 · 악센트 · 전각 ·
  **띄어쓰기 무시**, **성·이름 순서 무관**(`minsukim` = `Kim Minsu`, `민수김` = `김 민수`). DB 에서는 단어마다
  앞뒤 글자 조각(ilike)으로 넓게 받고, 최종 판정은 서버 JS 가 한다.
- **결과가 여럿이면(동명이인 등) 아래로 목록**이 펼쳐진다 — 이름 · 건물 · 객실 · 체크인→아웃 · 박수 · 연도 ·
  채널 점, 취소는 취소선. 살아 있는 예약 먼저, 그다음 오늘과 가까운 순, 최대 20건. 하나뿐이면 Enter 로 바로 연다.
- 판매 캘린더 위에서는 그 자리에서 패널을 연다(이벤트 `stayops:ops-open-reservation`). 다른 화면에서는
  `/admin/ops/calendar?resv=<id>` 로 넘어가 열고, 주소에서 `resv` 는 바로 뗀다. 창 밖 숙박도 열린다.
- 오른쪽 끝은 ⌘K 장식 대신 **검색 버튼**(Enter 모양, 입력 전에는 비활성) + 입력 중 지우기(X).
  ⌘K / Ctrl+K 로 검색창에 포커스하는 단축키는 실제로 동작한다. ↑↓ 로 고르고 Esc 로 닫는다.
- 서버 액션 `src/app/admin/ops/calendar/search-actions.ts`(service-role, 조직 필터 직접), 막대·객실 행
  매핑은 격자와 같은 `resolveOpsReservationPlacements`(`ops-calendar.ts`). 문구는 `admin.console.search*`(ko/ja/en).
- 컴포넌트 `src/components/shell/admin-guest-search.tsx`, 스타일 `admin-console.css` 의 `.gsearch*`.
- 상단바(`.adm .top`)는 z-index 20 — 목록이 판매 캘린더의 붙는 날짜 머리(z 6) 아래로 깔리던 것을 고쳤다.
  펼친 사이드바(z 30)보다는 낮다.

## 모바일 미리보기 (2026-09-11)

상단 「모바일 보기」는 전체 화면으로 넘어가는 대신 **아이폰 모양 프레임**을 띄운다. 어드민에서
일하는 중에 보는 것이라 화면을 떠나지 않는 편이 낫다.

**「새 탭에서 열기」는 두지 않는다** (2026-09-11 사용자 확인 — 「미리보기가 더 편하다」). 같은
목적지로 가는 길이 둘이면 하나는 안 쓰이고, 안 쓰이는 쪽이 먼저 낡는다. `/mobile` 은 주소로 직접
열 수 있고 모바일 기기에서는 그것이 본래 경로다.

`src/components/shell/mobile-preview.tsx` · 스타일은 `admin-console.css` 의 `.mprev*`.

- **프레임은 실제 아이폰처럼 두 겹이다** (2026-09-30). 바깥 3.5px 티타늄 림(위·아래 반사광이 흐르는
  금속 그라디언트 + 좌우 가장자리 하이라이트) 안에 9.5px 검은 유리 베젤(`.mprev__bezel`)이 화면을
  감싼다(합 13px = `BEZEL`). 측면 버튼도 림과 같은 금속, 아일랜드에는 카메라 렌즈(`.mprev__lens`).
- **iframe 으로 진짜 앱을 띄운다.** 모바일 화면을 흉내 내면 그 순간 두 벌이 되고, 실제 앱이 바뀌어도
  미리보기는 안 바뀐다. 같은 오리진이라 세션 쿠키가 통해 로그인 상태 그대로 열린다.
- 화면 크기는 **390 × 844**(아이폰 15 논리 해상도) 고정. 기기 선택은 두지 않는다 — 고르는 게 늘면
  미리보기가 도구가 된다. 창이 낮으면 프레임을 **줄인다**(키우지는 않는다).
- **상태바(시계 · 아일랜드 · 신호/와이파이/배터리)와 홈 인디케이터는 화면 안에 있다** — 실제 기기와
  같은 구조다. 시계는 지금 시각을 보여 준다(고정값이면 그 자리만 가짜로 보인다). 다만 **앱은 그
  사이 공간만 쓴다**: 실제 기기는
  `safe-area-inset-top` 이 내용을 밀어내지만 **iframe 안에서는 그 값이 0** 이라, 겹쳐 놓으면 앱
  헤더·탭바와 부딪힌다. 피하려면 모바일 셸에 여백을 주입해야 하는데 그 셸은 공용 계약이라
  (CLAUDE.md §3) 미리보기 때문에 실제 레이아웃을 건드릴 수 없다. **실제 앱 코드는 한 줄도 바뀌지
  않는다**(2026-09-11 사용자 선택 — A안).
- Esc · 바깥 클릭으로 닫고, 열려 있는 동안 뒤 화면 스크롤을 잠근다.
- **포털은 `<div className="adm">` 으로 감싼다.** 이 콘솔의 스타일과 토큰은 전부 `.adm` 아래로
  스코프돼 있는데 포털은 `document.body` 로 나간다 — 감싸지 않으면 CSS 가 하나도 적용되지 않아
  프레임도 배율도 없이 날것으로 그려진다(2026-09-11 에 실제로 그랬다). 같은 이유로
  `cleaning-live-card` 의 패널 포털도 그렇게 한다. **admin 콘솔에서 포털을 쓸 때의 공통 규칙이다.**

## 룸 링크 (2026-10-02)

사이드바 맨 아래 「운영 관리자」 묶음(`ops`)의 **「룸 링크」**(`/admin/ops/room-links`, nav id `ops-room-links`, 아이콘 `Link2`).
판매 캘린더와 **따로 주는 권한**(`room_links.access`) — 사용자 상세 → 권한에서 개인 부여, 대표 · 전무는 역할로 받는다.
권한이 없으면 메뉴가 안 보이고, 주소로 들어와도 `/admin` 으로 보낸다.

- 배치(시안 1b): 위 집계 · 검색 → 왼쪽 건물 목록 → 가운데 객실 카드 → 오른쪽 상세 패널(건물 주소 · 지도 · 유닛별 Airbnb /
  Booking.com 링크 열기 · 복사 · 편집). 1180px 아래에서는 패널이 아래로 내려간다.
- 스타일은 `src/components/admin/ops/room-links.css`(`.adm .rl__*`, 콘솔 토큰만). 문구는 `dictionary.roomLinks`(ko/ja/en).
- 도메인 계약: `docs/product/35-room-links.md`.
