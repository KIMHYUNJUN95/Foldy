# iOS · Android 앱 출시 계획

> **이 문서가 출시 작업의 단일 체크리스트다.** 사용자와 진행하는 작업은 전부 iOS · Android 출시를 향한다(2026-10-06 사용자 지시).
> 항목을 끝내면 상태를 `[x]` 로 바꾸고 커밋 해시 · 날짜를 적는다. 세부 근거는 `docs/engineering/03-deployment-strategy.md` 「App Store 준비」.

## 방향 (확정 · 미정)

- **확정 (2026-10-06):** 비공개 배포 먼저 → 준비가 끝나면 공개 출시. iOS 는 Apple Business Manager Custom App 또는 Unlisted App,
  Android 는 Google Play 비공개(내부 · 비공개 테스트 트랙 → 조직 대상 배포).
- **확정 (2026-10-06, 사용자 승인):** 앱 껍데기 = **Capacitor**(iOS · Android 한 코드베이스, 현재 Next.js 앱을 그대로 띄우고 네이티브 기능을 붙임).
  웹 · PWA 는 지금처럼 그대로 운영한다. 결정 로그 2026-10-06.

## 담당 표기

- **👤 사용자** — 계정 · 결제 · 회사 서류 · DNS 처럼 사용자만 할 수 있는 것
- **🤖 Claude** — 코드 · 문서 · 설정 작업
- **🤝 함께** — 사용자가 콘솔에서 누르고 Claude 가 값 · 순서를 안내

---

## 미룬 항목 (2026-10-07 사용자 결정)

지금 하지 않아도 손해가 없는 것은 미루고, 계정 없이 할 수 있는 개발 · 문서부터 끝낸다.

| 항목 | 언제 | 이유 |
| --- | --- | --- |
| A2 Apple Developer 가입 · A3 Play Console 가입 | 개발 오픈 직전 | 결제 · 연회비. D-U-N-S(A1)는 받아 둠 |
| ~~B6 데모 계정 운영 DB 적용(`--apply`)~~ ✅ 2026-10-15 | Windows Store 제출(W5) 때 적용 | 기본 이메일 그대로. 비밀번호는 사용자에게 전달(문서에 적지 않음) |
| ~~심사관 로그인 이메일 결정~~ ✅ 2026-10-15 | — | 기본값 `stayops.review@haru-tokyo.com` 으로 확정 |
| 출퇴근 시연 영상(심사 메모 첨부) | 심사 제출(C9) 전 | 필수는 아니지만 원격 심사관이 출퇴근을 못 해 보므로 권장 (👤 현장 촬영) |

## 브랜드 교체 예정 (2026-10-08 사용자 공지)

> **로고를 완전히 다른 로고로, 앱 이름도 새로 바꾼다.** 새 이름 · 로고가 정해지면 아래를 한 번에 바꾼다. 그 전까지 아이콘 · 이름은 임시다.
>
> **2026-10-09 로고 확정 · 교체 완료** — 「접힌 리넨」(라벤더 바탕 + 보라 막대 세 겹). 앱 · PWA · 시작 화면 · 스토어 이미지 전부 새 로고.
> 시안은 디자인 캔버스(https://claude.ai/artifact/RVnjFAhUmmZ2CYndfL5e1h)에 보관.
>
> **2026-10-09 앱 이름 확정 · 교체 완료 — 「Foldy」**(옛 이름 StayOps). 화면 · 앱 표시 이름 · 법적 문서 · 문서 전부. 내부 식별자(쿠키 · 저장소 키 ·
> 앱 ID · 패키지명 · 배포 주소)는 그대로 — 아래 표 · 결정 로그 2026-10-09.

| 항목 | 바꿀 곳 | 비고 |
| --- | --- | --- |
| ~~새 로고 받기~~ ✅ 2026-10-09 | 벡터로 정의(`generate-app-icons.mjs` `BG` · `MARK` → `public/brand/logo.svg` · `logo-mark.svg`). 적응형은 배경(라벤더) / 그림(막대) 분리 | 앱 · 시작 화면 · 스토어 · PWA `public/icons` · `favicon.ico` · `public/splash` 일괄 재생성 완료 |
| ~~앱 표시 이름~~ ✅ 2026-10-09 | `capacitor.config.ts` `appName` · Android `strings.xml` `app_name`/`title_activity_main` · iOS `CFBundleDisplayName` · PWA `manifest*.webmanifest` | 홈 화면 아이콘 아래 이름. 스토어 등록 전까지 자유롭게 바꿀 수 있다 |
| ~~화면 문구~~ ✅ 2026-10-09 | `src/lib/i18n.ts`(ko/ja/en 36곳) · 웹 시작 화면 · 헤더 워드마크(「Foldy」) · `src/` 기타 파일 | 3개 언어 함께 교체 완료 |
| ~~법적 문서 · 스토어 문구~~ ✅ 2026-10-09 | `src/lib/legal-content.ts`(24곳) · `18-store-review-kit.md` · 지원 페이지 · iOS 권한 문구(`*.lproj/InfoPlist.strings`) | 방침 · 약관의 서비스 이름 |
| ~~앱 ID / 번들 ID~~ ✅ 2026-10-09 → `com.harutokyo.foldy` | `capacitor.config.ts` `appId` · Android 패키지 · iOS 번들 · 앱 스킴 `com.harutokyo.foldy://` · **Supabase Redirect URLs** | **스토어 등록(C4) 후에는 못 바꾼다.** 새 이름에 맞출지 C4 전에 결정 (👤). 회사 도메인 기준이라 그대로 둬도 무방. **2026-10-09 이름 교체 때는 그대로 둠(미결)** |
| 바깥 서비스의 이름 (👤) | ✅ Google OAuth 동의 화면(이름 Foldy · 로고 · 홈페이지/방침/약관 링크 · 승인 도메인 `stay-ops-two.vercel.app`, 2026-10-09) · ✅ Supabase 인증 메일(Confirm sign up · Reset password 를 Foldy 3개 언어 문구로, 2026-10-09) · ✅ Slack 앱 「Foldy Automation」(이름 · 새 아이콘 · 배경색 `#5B2BD6`, 2026-10-09) · [ ] Vercel 프로젝트/주소 `stay-ops-two` · GitHub 저장소 | 코드 밖이라 각 콘솔에서 바꾼다. **자체 도메인(C1) 때 Google 동의 화면의 홈페이지 · 방침 · 약관 링크와 승인 도메인도 새 도메인으로** |

## 0단계 — 계정 · 도메인 (오래 걸리므로 지금 시작)

| # | 항목 | 담당 | 상태 | 비고 |
| --- | --- | --- | --- | --- |
| A1 | **D-U-N-S 번호** (회사 명의) | 👤 | [x] 2026-10-07 — `718114295` (TSR 企業コード 131871412). 남은 확인: Apple 조회 도구에서 D&B 영문 법인명 · 주소가 맞는지 | Apple · Google 조직 계정에 필요. 발급 1~2주. 일본 법인은 TSR(도쿄상공리서치) |
| A2 | **Apple Developer Program 조직 가입** ($99/년) | 👤 | [ ] Apple ID 생성 완료 · 미결제 · **오픈 직전으로 미룸** | 결제 전에 「조직」으로 가입할 것 — 판매자명이 회사명으로 표시. 회사 도메인 이메일 · 웹사이트 필요 |
| A3 | **Google Play Console 조직 계정** ($25, 1회) | 👤 | [ ] **오픈 직전으로 미룸** | 개인 계정은 신규 앱 출시 전 「테스터 12명 × 14일」 비공개 테스트 의무 — 조직 계정은 면제 |
| A4 | **자체 도메인** `app.haru-tokyo.com`(안) | 👤→🤝 | [ ] DNS 관리자 확인 중 | 회사 메일 도메인의 하위 도메인이라 메일에 영향 없음. DNS 에 CNAME 1줄 |

## 1단계 — 계정 없이 지금 할 수 있는 것

| # | 항목 | 담당 | 상태 | 비고 |
| --- | --- | --- | --- | --- |
| B0 | **Capacitor 채택 결정** | 👤 승인 | [x] 2026-10-06 | 결정 로그 기록 |
| B1 | **Capacitor 골격** (iOS · Android 프로젝트, 앱 ID, 권한 설정) | 🤖 | [x] 2026-10-06 | `capacitor.config.ts` · `android/` · `ios/`. 앱은 배포된 웹을 띄운다. 빌드 방법: `03-deployment-strategy.md` 「앱 빌드」 |
| B1-1 | **실기기 · 에뮬레이터 첫 실행 확인** — Android Studio(Windows 가능) / Xcode(Mac 필요) | 👤 | [~] 2026-10-08 Pixel 8 에뮬레이터(API 35)에서 설치 · 실행 · 로그인 → 모바일 홈(판매 캘린더) 정상. 남은 확인: 출퇴근 QR 권한 · 다운로드 · 외부 링크 · 뒤로가기 · 연결 실패 화면. 절차: `03` 「Android 첫 실행」 | 이메일 · Google 로그인 → 홈 → 출퇴근 QR(카메라 · 위치 권한) → 첨부 다운로드 → 외부 링크 → 뒤로가기 버튼 → 연결 실패 화면(비행기 모드) → 새 아이콘 · 시작 화면 |
| B1-3 | **iOS 빌드 경로** — Mac 없음 → 클라우드 빌드(Codemagic · GitHub Actions macOS 러너) | 🤝 | [~] 2026-10-07 서명 없는 시뮬레이터 빌드 확인 워크플로 · 2026-10-09 **서명 + TestFlight 업로드 워크플로 준비**(`ios-testflight.yml`, 수동 실행) — A2 후 시크릿 4개 넣고 첫 실행(03 「iOS TestFlight 업로드」) | `.github/workflows/ios-build-check.yml` — iOS 파일이 바뀌면 macOS 러너에서 컴파일 확인. 사용자 확인: Mac 없음, Android Studio 있음(2026-10-06) |
| B1-2 | **앱 아이콘 · 스플래시** — 1024px 원본에서 생성 | 🤖 (+👤 원본) | [x] 2026-10-09 **새 로고(접힌 리넨)로 벡터에서 생성** — 1024 스토어 아이콘도 선명. 남은 것: 실기기에서 홈 화면 아이콘 · 시작 화면 확인(재설치 필요) | `node scripts/dev/generate-app-icons.mjs [원본]`. `03` 「아이콘 · 스플래시」 |
| B2 | **앱 안 Google 로그인** — 시스템 브라우저로 로그인 → 딥링크로 앱 복귀 | 🤖 | [x] 2026-10-06 | `getNativeGoogleSignInUrl` + `@capacitor/browser` + `NativeAuthBridge`, 스킴 `com.harutokyo.foldy://auth/callback`. `03` 「앱 안 Google 로그인」 |
| B2-1 | **Supabase Redirect URLs 에 `com.harutokyo.foldy://auth/callback` 추가** | 👤 | [x] 2026-10-09 새 주소 추가 완료(사용자, Redirect URLs 6개 — 옛 `com.harutokyo.stayops://…` 도 남아 있음, 지워도 무방) | 이게 있어야 앱으로 돌아온다 |
| B2-2 | **실기기에서 앱 Google 로그인 확인** | 👤 | [x] 2026-10-08 N10 수정(`b77cffc` · `9c5167d`) 후 에뮬레이터에서 Google 로그인 → 앱 복귀 → 앱 화면(주소창 없음) 확인 | 위쪽에 주소 · X 버튼이 보이면 앱이 아니라 앱 안 브라우저 |
| B3 | **WebView 호환 점검** — 다운로드, 외부 링크(Beds24 · OTA · 지도 · 전화), 카메라 · 위치 권한, Android 뒤로가기 버튼, safe-area | 🤖 | [x] 2026-10-06 | `NativeShellBridge` — 외부 링크 · 다운로드 → 앱 안 브라우저, 같은 출처 새 창 → WebView, 뒤로가기 버튼, SystemBars 설정. 실기기 확인은 B1-1. `03` 「앱 안 WebView 보정」 |
| B4 | **게시판 신고 · 차단** (`/mobile/board`) | 🤖 | [x] 2026-10-06 | 신고(사유 5종 + 메모) → 신고자에게 즉시 숨김, owner · office_admin 이 `/mobile/board/reports` 에서 삭제 / 문제없음. 차단 = 내 게시판에서 숨김, 계정 → 보안에서 해제. `23-board-workflow.md` §12-C |
| B4-2 | **신고 취소 · 관리 콘솔 신고 처리** | 🤖 | [x] 2026-10-06 | 계정 → 보안 「신고한 글 · 댓글」 → 신고 취소(`withdrawn`). `/admin/board-reports` 표 + 상세 패널. 처리 권한을 권한 키 `board.moderate` 로 정식화 |
| B4-1 | 다른 사용자 작성 콘텐츠(공지 댓글 · 제안함 댓글 등)에도 신고 · 차단이 필요한지 검토 | 🤖 | [x] 2026-10-07 — 게시판 외 추가 불필요 | 아래 「B4-1 검토 결과」. 공개 출시(3단계) 전에 제안함만 다시 본다 |
| B5 | **웹에서 계정 삭제 요청 경로** | 🤖 | [x] 2026-10-06 | `/legal/account-deletion`(ko/ja/en) — Play Console 「계정 삭제 URL」에 이 주소. 로그인 불가 시 메일 요청은 본인 확인 후 30일 이내 처리(운영 약속) |
| B5-1 | **계정 삭제 시 남는 칸** — 성별 · 입사일 | 👤 결정 | [x] 2026-10-06 | 고용 기록으로 남긴다(결정 로그). 코드 변경 없음 |
| B6 | **심사용 데모 조직 · 계정 · 샘플 데이터** | 🤖 (+👤 확인) | [x] 2026-10-15 운영 DB 적용(조직 「Foldy Demo」 · 로그인 확인). 첫 적용 때 공지 `is_important` NOT NULL 로 중단 → 스크립트 수정(행마다 같은 칸 · 건물 유무로 샘플 재투입 판단) | `scripts/dev/seed-review-demo.js`. 내용 · 원칙: `18-store-review-kit.md` §6 |
| ✅ | 개인정보처리방침 · 이용약관 · 고객지원 페이지 | 🤖 | [x] `dfc5e6a` 2026-10-06 | `/legal/privacy` · `/legal/terms` · `/support` (ko/ja/en) |
| ✅ | 문의 메일 환경 변수 `NEXT_PUBLIC_SUPPORT_EMAIL` | 👤 | [x] 2026-10-06 | Vercel Production 에 설정 · 반영 확인 |
| ✅ | 앱 안 계정 삭제 | — | [x] (기존) | 계정 → 보안 → 계정 삭제 |

### B4-1 검토 결과 (2026-10-07)

App Store 1.2 · Google Play UGC 정책이 신고 · 차단을 요구하는 대상은 **불특정 다수에게 공유되는 사용자 작성 콘텐츠**다.
그 기준으로 화면을 하나씩 봤고, **조직 전체에 공개되는 자유 글은 게시판뿐**이라 신고 · 차단은 게시판(B4 · B4-2)으로 충분하다.

| 화면 | 누가 쓰고 누가 보나 | 판단 |
| --- | --- | --- |
| 게시판 `/mobile/board` | 모든 멤버 → 조직 전체 | **적용 완료** (B4 · B4-2) |
| 공지 `/mobile/announcements` | 관리 역할만 작성하는 공식 안내. 모바일 댓글은 2026-06-26 제거 | 불필요. 어드민 상세의 레거시 댓글(관리 역할끼리)은 `11` 문서대로 정리 대상 |
| 제안함 `/mobile/suggestions` | 작성자 → 받는 사람 · 참조자만 보는 1:N 비공개 스레드. 조직 공개 · 익명 없음 | 불필요(공유 피드가 아니라 지정된 사람에게 보내는 업무 건의). 상대를 「차단」하면 상사에게 건의가 막히는 부작용. **공개 출시 전 심사관 질의가 오면 재검토** |
| 할 일 · 프로젝트 진행 기록 | 참여자끼리의 업무 기록 | 업무 기록 — 제외 |
| 청소 · 유지보수 · 분실물 · 발주 · 버그 신고 · 근태 | 업무 처리 기록(담당자 · 관리자) | 업무 기록 — 제외 |
| 고객 불만 · 리뷰 | OTA 에서 들어온 투숙객 리뷰(앱 사용자가 쓴 글 아님) | 대상 아님 |
| 디렉터리 | 이름 · 역할 · 전화(자유 글 · 사진 없음) | 대상 아님 |

- 심사 메모(App Review Notes)에는 「사용자 간 공개 콘텐츠는 게시판 하나이며 신고 · 차단 · 관리자 처리가 있다」고 적는다(C9). 처리 기한(예: 24시간)을 적으려면 운영 약속으로 먼저 정한다.

### 네이티브 품질 수정 목록 (N, 2026-10-08~)

> **원칙(사용자 지시 2026-10-08): 크든 작든 「웹을 감싼 티」가 나는 것은 전부 고친다** — 앱은 네이티브 앱처럼 보이고 동작해야 한다.
> 에뮬레이터 · 실기기 확인에서 발견하면 여기에 먼저 적고 하나씩 고친다. 고치면 `[x]` + 커밋.

| # | 발견 | 기대(네이티브 기준) | 상태 |
| --- | --- | --- | --- |
| N1 | 상태바(시계 · 배터리 줄)가 화면에 따라 **검정** / 아이보리로 바뀜 | 항상 앱 배경색(아이보리) + 어두운 아이콘 | [x] 2026-10-08 `windowBackground` 아이보리 + `SystemBars` LIGHT(Android 설정 · iOS 브리지) — 에뮬레이터 재확인 |
| N2 | 위치 권한이 **웹 팝업**(「stay-ops-two.vercel.app wants to use your device's location」 Block / Allow)으로 뜸 — 주소가 드러남 | 앱 이름으로 묻는 **OS 권한 팝업** 한 번만 | [x] 2026-10-08 앱에서는 `@capacitor/geolocation` 으로 읽음 — 에뮬레이터 재확인 |
| N3 | 출퇴근 스캔에서 카메라 권한 팝업을 확인하지 못함 · 미리보기 검정 | OS 카메라 권한 팝업 → 미리보기 표시(에뮬레이터 카메라 설정도 확인) | [x] 2026-10-08 「Allow Foldy to take pictures…」 OS 팝업 확인(사용자). 미리보기는 허용 후 확인 |
| N4 | 화면 왼쪽 가운데에 **웹용 뒤로가기 동그라미(‹)** 가 뜸 | 앱에서는 OS 뒤로 제스처 · 버튼만(웹 오버레이 숨김) | [x] 확인 결과 **Android 시스템 뒤로 제스처 화살표**였다(웹 오버레이 아님) — 수정 없음 |
| N5 | 외부 링크(룸 링크 → Airbnb)가 앱 안 브라우저로 열림 — 동작 정상 | 툴바 색을 앱 색에 맞추기(사소) | [x] 2026-10-09 툴바 아이보리(`IN_APP_BROWSER_OPTIONS`, 외부 링크 · Google 로그인) — 재설치 후 확인 |
| N6 | 아이폰에서 비행기 모드 → **영어 화면만 나오고 아무것도 안 눌림**(사용자 보고, 홈 화면 PWA 로 보임) | 기기 언어로 안내 + 다시 시도 · 자동 복귀. 앱은 `errorPath` 화면(D2)으로 확인 | [~] 2026-10-09 원인 추정: 오프라인에서 화면을 옮기면 뜨는 Next 오류 화면이 **영어 전용**(「Something went wrong / Try again」)이고 다시 시도가 오프라인에서 먹지 않았다 → 3개 언어 · 오프라인 안내 · 연결되면 자동 재시도(`AppErrorScreen`). **2026-10-22 진짜 원인 찾음** — 서비스 워커가 오프라인 화면을 원래 주소에 내보내 React 로 살아나지 못했고, 자동 다시 불러오기(useEffect)가 한 번도 안 돌았다(로컬 재현: 복귀 6초 뒤에도 갇힘). React 없는 맨 스크립트로 교체 — 기기 언어 하나 · 「다시 시도」 · `online` + 3초마다 확인해 복귀(로컬 확인). SW 캐시 v5. 아이폰 재확인 |
| N7 | 로그인 첫 화면이 「관리자 콘솔에 로그인」 | 폰 · 앱은 현장 앱 문구 | [x] `de5d1e5` · 앱에서 확인 |
| N8 | 링크를 길게 누르면 **브라우저 메뉴**(Copy link address · Download link · Open in Chrome browser + 주소) | 메뉴 없음(입력칸의 붙여넣기는 유지) | [x] 2026-10-08 앱에서 `contextmenu` 차단(입력칸 제외) + iOS `allowsLinkPreview: false` — 재설치 후 확인 |
| N9 | 로그인 안내 · 권한 없음 문구가 「개발자에게 문의」 | 실제 직원 · 심사관 기준 「소속 조직 관리자에게」 | [x] 2026-10-08 ko/ja/en 문구 수정 |
| N10 | **Google 로그인이 앱으로 돌아오지 않음** — 앱 안 브라우저(Custom Tab)에서 웹이 로그인된 채 열리고, 그 안에서 계속 쓰게 됨(카메라도 Chrome 팝업) | 로그인 후 브라우저가 닫히고 앱 화면으로 복귀 | [x] 2026-10-08 원인: `redirectTo` 에 `?next=` 를 붙여 Supabase 등록 주소와 불일치 → Site URL 로 대체됨(auth 로그 확인). 쿼리 없이 보냄. **원인 2**: 앱 복귀 주소 판정이 `new URL()` 에 기대 예전 WebView 에서 늘 실패 → 로그인 코드가 버려지고 로그인 화면에 머묾 → 문자열 판정으로(`nativeCallbackToWebPath`) — 재확인 |
| N12 | 뒤로가기가 **가장자리에서만**(Android 시스템 제스처) · iOS 앱은 뒤로 제스처 자체가 없음(WKWebView 기본값 꺼짐) | 화면 어디서든 밀어서 뒤로(인스타그램 · iOS 26), 이전 화면이 아래에서 따라 들어옴 | [~] 2026-10-08 웹 엔진 완료(`16` 「뒤로가기 — 화면 스와이프」) · 2026-10-20 다듬기(놓은 뒤 속도 · 둥근 판 · 기록 없으면 위 화면) · **Android 예측 뒤로가기 연결**(`PredictiveBackPlugin` — 가장자리 제스처도 같은 엔진, 갈 곳 없으면 OS 홈 미리보기) — 남은 것: iOS · Android 앱 · 설치한 PWA 실기기 손맛 확인(Android 는 새 앱 빌드 필요) |
| N13 | 아이폰 키보드 위 **「‹ › 완료」 막대**(웹 입력칸 티) | 막대 없음 | [x] 2026-10-09 `@capacitor/keyboard` 로 숨김 — iOS 실기기 확인(C8) |
| N14 | 기기 **글자 크기**를 키우면 Android WebView 가 제한 없이 따라가 화면이 깨질 수 있음 · iOS 앱은 아예 무시 | 기기 설정을 따르되 깨지지 않는 범위 | [x] 2026-10-09 `@capacitor/text-zoom` 0.85~1.15 배 — 에뮬레이터에서 글자 크기 최대로 확인 · **2026-10-22 0.85~1.35 배**(iOS 일반 글자 크기 최대) · 두 플랫폼 모두 CSS `text-size-adjust` 로 키우고 탭바 · 촘촘한 표는 고정(`data-text-fixed`) — 16 「접근성 — 공용 규칙」 |
| N15 | **iOS 앱에 진동이 전혀 없음**(Vibration API 미지원) | 탭 · 완료 · 오류에 Taptic 피드백 | [x] 2026-10-09 `@capacitor/haptics`(`haptic()` 호출부 그대로) |
| N16 | Android 앱에서 「공유」가 **공유 시트 없이 링크 복사**로 끝남 | OS 공유 시트 | [x] 2026-10-09 `@capacitor/share`(`shareLink()`) |
| N17 | 앱을 백그라운드에 뒀다 열면 **어젯밤 화면 그대로**(당겨야 새로 고침) | 오래 나갔다 오면 저절로 새 내용 · 새 배포 | [x] 2026-10-22 `ResumeRefresh` — 5분 넘게 나갔다 오면 새로 고침, 새 배포면 다시 불러옴(쓰는 중이면 안 함) |
| N18 | 화면 읽기(VoiceOver · TalkBack)가 **닫힌 메뉴 20여 개를 본문보다 먼저** 읽음 | 닫힌 메뉴는 없는 것으로 | [x] 2026-10-22 서랍 `inert` · 열리면 `aria-modal` — 접근성 점검(16 「접근성 — 공용 규칙」). 실기기 VoiceOver 확인 남음 |
| N19 | 앱 아이콘을 꾹 누르면 **메뉴가 없음** | 자주 쓰는 3개 바로가기 | [x] 2026-10-22 iOS `UIApplicationShortcutItems` · Android `shortcuts.xml`(ko/ja/en) — 새 앱 빌드부터 |
| N20 | 번역 사전(ko · ja · en 전부, 압축 약 287KB)을 **모든 화면이 통째로** 내려받음 — 화면 코드의 절반쯤 | 사용자 언어 사전만 받기(약 190KB 절약) | [ ] **보류 — 출시 직전, 화면 개발이 다 끝난 뒤** 한 번에(2026-10-23 사용자 결정). 동기 `getDictionary` 를 부르는 클라이언트 파일 49곳을 바꿔야 해 위험이 커서, 화면이 계속 바뀌는 동안은 하지 않음 |
| N11 | 앱을 켤 때 **아주 잠깐 로고가 엉뚱한 위치**에 보임(사용자 보고) | 시스템 시작 화면(가운데 아이콘) → 바로 앱 화면, 흰 화면 깜빡임 없음 | [x] 2026-10-08 ① 시작 테마의 `android:background` 비트맵 제거 · WebView 바탕 아이보리(`c9589e0`) ② **진짜 원인**: OS 시작 화면(큰 원 아이콘) 뒤에 **웹 시작 화면**(`SplashScreen`, 작은 네모 아이콘 + 튀어나오는 애니메이션 + 아래 글자)이 겹쳐 로고가 순간 이동 · 흐려 보임 → 앱에서는 웹 시작 화면 숨김(`html[data-native-app]`) ③ 시작 화면 아이콘이 432px 를 늘려 흐림 → 960px `drawable-nodpi/splash_icon` — 재설치 후 확인 |

### 출시 보강 목록 (H, 2026-10-09)

> 출시 전 기술 점검(사용자 요청 「부족한 기술 스택 · 보완할 것, 미룬 것 빼고」)에서 찾은 것. 사용자 「하나도 빠짐없이 전부 수정」.
> 세부: `03-deployment-strategy.md` 「앱 출시 보강」 · 「Android 릴리스 서명」. **반영하려면 `npm run cap:android:win` → ▶ Run 재설치.**

| # | 문제 | 보완 | 상태 |
| --- | --- | --- | --- |
| H1 | iOS 최소 15.0 인데 Next.js 16 은 Safari 16.4+ — 15.x ~ 16.3 아이폰에서 빈 화면 | iOS 최소 버전 16.4 | [x] 2026-10-09 |
| H2 | Android 7(minSdk 24) 폰의 WebView 가 Chrome 111 보다 낡으면 빈 화면 | 낡은 엔진이면 「WebView 업데이트」 안내(3개 언어, ES5 인라인 스크립트) | [x] 2026-10-09 |
| H3 | 웹 배포는 깔린 모든 앱 버전에 즉시 반영 — 옛 설치본에 없는 플러그인을 부르면 동작 중단 | `hasNativePlugin` 판정 + 웹 방식 대체, `MIN_NATIVE_BUILD` 「업데이트 필요」 화면, 빌드 번호 규칙(지금 2) | [x] 2026-10-09 |
| H4 | 앱 안에서도 서비스 워커 — 배포 직후 옛 HTML, 별도 오프라인 화면 | 앱에서는 등록 안 함 · 남은 것 해제 + 캐시 삭제 | [x] 2026-10-09 |
| H5 | iOS 키보드 막대 | N13 | [x] |
| H6 | iOS 진동 없음 | N15 | [x] |
| H7 | Android 공유 = 복사 | N16 | [x] |
| H8 | 엑셀 · PDF 내보내기 · 인쇄가 WebView 에서 동작 안 함(태블릿 관리 콘솔) | 앱은 관리 콘솔을 열지 않게 고정(`StayOpsApp` UA 꼬리표 → 늘 모바일 화면). 모바일 화면에는 blob 내려받기 · 인쇄 없음(확인) | [x] 2026-10-09 |
| H9 | 기기 글자 크기 | N14 | [x] |
| H10 | Android 릴리스 서명 키 · AAB 절차 없음 | `keystore.properties`(커밋 안 함) 읽는 서명 설정 · 동기화 스크립트가 키를 지우지 않게 · 절차 문서. **👤 키 만들기 · 백업** | [~] 2026-10-09 설정 완료 · 키 생성은 사용자(03 「Android 릴리스 서명」) |
| H11 | iOS 수출 규정 질문(업로드마다) | `ITSAppUsesNonExemptEncryption = false` | [x] 2026-10-09 |
| H12 | `allowBackup="true"` — 로그인 쿠키가 다른 기기로 복원될 수 있음 | 백업 · 기기 이전 끔 | [x] 2026-10-09 |
| H14 | 가입 확인 메일 — Supabase 기본 메일 서버는 시간당 몇 통(2026-10-09 가입 테스트 중 「발송 한도」로 막힘) · 메일 다시 받기 없음 · 미확인 계정이 쌓임 | 🤖 「메일 다시 보내기」(60초) · 7일 지난 미확인 가입 자동 정리 · 「이미 가입됐을 수 있음」 안내(04번 「가입 → 메일 확인」). **👤 외부 SMTP 연결**: 메일 서비스(예: Resend · SendGrid) 가입 → 보내는 도메인 DNS 인증 → Supabase 대시보드 Authentication → Emails → SMTP Settings 에 호스트 · 포트 · 계정 · 보내는 주소 입력 → Rate Limits 에서 시간당 메일 수 올리기 | [~] 2026-10-09 코드 완료(리디자인 브랜치) · **SMTP 는 도메인 작업(A4 · C1) 때 함께 — 사용자 결정 2026-10-09** |
| H13 | 앱 화면 오류를 볼 길이 없음 | 직접 만든 수집(`/api/client-errors` → Vercel 로그, 외부 서비스 없음 — 사용자가 방식 미지정, 스택 변경 없는 쪽으로) · 오류 화면 3개 언어 · 방침 · 개인정보 라벨(진단, 연결 안 됨) 반영 | [x] 2026-10-09 |

## 2단계 — 계정 · 도메인이 생긴 뒤

| # | 항목 | 담당 | 상태 | 비고 |
| --- | --- | --- | --- | --- |
| C1 | **도메인 연결 · 주소 교체** — (같이 할 것: **H14 외부 SMTP** — 도메인이 생기면 Resend 등에서 `no-reply@새도메인` 인증 → Supabase SMTP 설정 · 발송 한도 올리기) Vercel 도메인, Supabase 로그인 리디렉트, Google OAuth 승인 도메인, `NEXT_PUBLIC_APP_URL`, 약관 · 지원 URL | 🤝 | [ ] | A4 이후. **스토어 제출(C9) 전에 끝낸다** — 앱 바이너리에 주소가 박히고 스토어 등록에 방침 URL 이 들어가므로. 바꿀 곳(2026-10-09 정리): 👤 Vercel Domains 에 도메인 추가 + DNS CNAME · Supabase **Site URL** + Redirect URLs 에 `https://새도메인/auth/callback` 추가 · Google 인증 플랫폼 **브랜딩**의 홈페이지 · 개인정보처리방침 · 서비스 약관 링크 + 승인된 도메인 추가 / 🤖 `capacitor.config.ts` `serverUrl` · `capacitor-www/index.html` `APP_URL` · GitHub Actions 워크플로 5개(`.github/workflows/*`) · pg_cron 호출 주소 3곳(새 마이그레이션으로 — 적용된 `202609300004` · `202610060003` · `202610080002` 는 고치지 않는다) · `NEXT_PUBLIC_APP_URL`(Vercel 환경 변수). `stay-ops-two.vercel.app` 은 도메인을 붙여도 계속 열리므로 한 번에 안 바꿔도 끊기지 않는다 |
| C2 | **앱 링크 검증 파일** — iOS `apple-app-site-association`, Android `assetlinks.json` | 🤖 | [ ] | 링크를 누르면 앱이 열리게 + B2 로그인 복귀 |
| C3 | **Apple 로그인** | 🤝 | [ ] | Google 로그인이 있으므로 iOS 필수(Apple 4.8). Supabase Apple provider + Services ID · 키 |
| C4 | **서명 · 번들 ID(iOS) · 패키지명(Android)** | 🤝 | [ ] | 한 번 정하면 못 바꿈. **ID 확정 `com.harutokyo.foldy`(2026-10-09)** — 남은 것: 서명 키 |
| C5 | **네이티브 푸시** — iOS APNs · Android FCM | 🤖 | [ ] | 「알림은 막바지에 일괄 구현」 방침과 같은 배치로 |
| C6 | **권한 설명 문구 · 개인정보 신고** — Info.plist(카메라 · 위치 · 사진, ko/ja/en), `PrivacyInfo.xcprivacy`, App Store 개인정보 라벨, Google Play 데이터 보안 양식 | 🤖 (+👤 제출) | [~] 2026-10-07 준비 완료 · 콘솔 제출 남음 · 2026-10-20 빠진 위치 키 `NSLocationAlwaysAndWhenInUseUsageDescription` 추가(TestFlight 업로드 ITMS-90683 방지) | 답안: `18-store-review-kit.md`. `src/lib/legal-content.ts` 수집 항목과 일치해야 함. iOS 빌드 확인은 B1-3 |
| C7 | **스토어 등록 자료** — 아이콘 1024px, 스크린샷(아이폰 · 아이패드 · 안드로이드 폰 · 태블릿), 3개 언어 설명문, 연령 등급, 카테고리 | 🤖 (+👤 제출) | [~] 2026-10-07 아이콘 · 3개 언어 문구 · 카테고리 · 연령 등급 답안 완료 · 스크린샷 남음 | `18-store-review-kit.md` §7. 스크린샷은 에뮬레이터(B1-1) + 데모 데이터(B6)로 |
| C8 | **내부 테스트** — TestFlight · Google Play 내부 테스트 트랙 | 🤝 | [ ] | 실기기에서 로그인 · 출퇴근 QR · 사진 업로드 · 푸시 |
| C9 | **비공개 배포** — Custom/Unlisted App · Play 비공개 트랙 | 🤝 | [ ] | 심사 제출 · 대응 |

## 3단계 — 공개 출시 전

| # | 항목 | 담당 | 상태 | 비고 |
| --- | --- | --- | --- | --- |
| D1 | 방침 · 약관에 운영 법인명 · 주소 기재 + 법무 검토 | 👤 | [ ] | |
| D2 | 「웹을 감싼 앱」 거절(Apple 4.2) 대비 — 네이티브 기능 · 오프라인 동작 보강 | 🤖 | [~] 2026-10-07 연결 실패 화면(`errorPath`, ko/ja/en, 자동 복귀) · 2026-10-22 앱 안 오프라인 표시(셸 위 알약, `OfflinePill`) · 오프라인 화면 복귀 고침(N6) · 네이티브급 움직임 점검(10-21: 스와이프 · 시트 · 전환 · 누름 · 토스트 · 메뉴) · 2026-10-22 앱 아이콘 꾹 누르기 메뉴(출퇴근 · 할 일 추가 · 오늘 내 방) · 돌아오면 새로 고침 · OS 연결 판정(`@capacitor/network`) · 접근성 점검(16 「접근성 — 공용 규칙」) | 비공개 배포 땐 부담이 작지만 공개 심사는 엄격. 남은 것: 네이티브 푸시(C5) · 아이콘 메뉴 · 연결 판정은 새 앱 빌드 실기기 확인 |
| D3 | 공개 스토어 페이지 · 마케팅 문구 | 🤝 | [ ] | |

## PC 설치 파일 — 대시보드 (2026-10-15 사용자 결정)

대시보드(`/admin`)를 PC 설치 앱으로. **Windows 먼저 — Microsoft Store**(PWABuilder 로 MSIX 패키징, 무료 · Store 서명이라 경고 없음).
맥은 나중(Tauri + A2 Apple 계정으로 서명 · 공증) — 그전까지 브라우저 주소 또는 「Dock에 추가」. 상세 `docs/product/05-admin-web-ia.md`.

| # | 항목 | 담당 | 상태 | 비고 |
| --- | --- | --- | --- | --- |
| W1 | 매니페스트 Store 준비 — `lang` · `categories` · `launch_handler` 등 | 🤖 | [x] 2026-10-15 | `public/manifest-admin.webmanifest` |
| W2 | **Microsoft Partner Center 개발자 등록** | 👤 | [x] 2026-10-15 개인 계정 | storedeveloper.microsoft.com. 개인 계정은 무료(가입 화면에서 확인). 회사 계정은 게시자 이름이 회사명이지만 비용 · 회사 확인 절차가 있다 |
| W3 | 앱 이름 예약 「Foldy Admin」 → 제품 ID 값 3개 확인 | 🤝 | [x] 2026-10-15 — Name `Haru95.FoldyAdmin` · Publisher `CN=20214217-1D17-4582-ADB2-3120F7D60408` · 표시 이름 `Haru_95` · Store ID `9P4845FDBTG5` | Partner Center → 앱 → 제품 관리 → 제품 ID: Package ID · Publisher ID · Publisher display name |
| W4 | PWABuilder 로 패키지 만들기 | 🤝 | [x] 2026-10-15 패키지 2개 업로드(W5) | pwabuilder.com 에 `https://stay-ops-two.vercel.app/admin` → Windows 패키지 → W3 값 3개 입력 → `.msixbundle` 다운로드 |
| W5 | 제출 — 공개 범위 · 스토어 정보 · 심사 메모 | 🤝 | [x] 2026-10-15 **인증 통과 · Store 게시 완료(스토어 페이지 열림 확인)** · 인증 제출(Submission 1) — 가격 무료 · 속성 · 연령 등급(IARC 3+ · 사용자 상호작용) · 패키지 2개 · ko/ja/en 목록 · runFullTrust 사유 · 테스트 계정(B6) 입력. 통과 후 자동 게시, 설치 링크 `https://apps.microsoft.com/detail/9P4845FDBTG5` | 공개 범위 = 공개 대상 + 검색 안 됨(직접 링크만). 스크린샷 1장 이상. 심사 메모에 심사용 로그인 계정(B6 데모 계정) |
| W6 | 자체 도메인(C1) 뒤 새 주소로 패키지 재제출 | 🤝 | [ ] | 패키지에 주소가 박힌다. 옛 주소도 계속 열리므로 급하지 않다 |

---

## 스토어 개인정보 신고 — 재류카드(2026-10-23)

> 재류카드 R2(`docs/product/41-residence-card-workflow.md` §10)로 **신분 서류 사진 · 카드 칸**을 새로 모으고, 동의한 사람만 사진을
> **Anthropic(미국) Claude API** 로 보내 글자를 읽는다. 이 절은 C6(개인정보 신고) 답안의 **추가분**이다 — 확정되면 `18-store-review-kit.md` §2~4,
> `ios/App/App/PrivacyInfo.xcprivacy`, `src/lib/legal-content.ts` 를 같이 고친다(이 절을 쓴 시점에는 **아무것도 고치지 않음** — 사용자 승인 대기).
> 조사일 2026-10-23. 근거 URL 은 각 줄에 붙였다. 확인하지 못한 것은 「확인 필요」로 적었다.

### 0. 사실관계 (우리 쪽 구현 기준)

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 모으는 것 | 재류카드 앞 · 뒤 사진(일본 국적은 마이넘버 카드 **앞면만** — 12자리 개인번호는 받지 않음, 보이면 사진 삭제 후 다시 찍게 함) + 칸: 로마자 이름 · 생년월일 · 성별 · 국적 · **주소(住居地)** · 카드 번호 · 재류자격 · 만료일 · 취로 제한 · 자격외활동 · 읽은 값(`ocr_values`) · 고친 칸 | `staff_id_documents`(마이그레이션 `202610230001`) · `src/lib/staff-documents/fields.ts` |
| 원본 저장 | Supabase 비공개 버킷 `staff-documents` — **도쿄(`ap-northeast-1`)**. 앱 서버(Vercel 함수)도 도쿄 `hnd1` | `docs/engineering/06-implementation-plan.md`(Tokyo region) · `vercel.json` `regions: ["hnd1"]` · `docs/product/15-reservation-calendar.md` |
| 해외로 가는 것 | **동의(기본 꺼짐)한 경우에만** 사진을 Anthropic API 로 보냄. 동의 안 하면 사진만 저장 · 직접 입력 | `src/lib/staff-documents/ocr.ts` · `id-card-flow.tsx` |
| Anthropic 보관 | API 입력 · 출력은 **30일 안에 자동 삭제**. 단 안전 분류기에 걸리면 **최대 2년**(분류 점수 최대 7년), 법적 의무가 있으면 그 기간 | [Anthropic — How long do you store my organization's data](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) · [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) |
| 학습 사용 | 상용 약관: 「Anthropic may not train models on Customer Content from Services」 · API 문서: 「Retained data is never used for model training without your express permission」 | [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) · [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) |
| Anthropic 의 지위 | Claude API 에서 Anthropic 은 **데이터 처리자(data processor)** — DPA(데이터 처리 부속서)가 상용 약관에 편입 | 위 두 문서 |
| 보는 사람 | 본인 + `staff_documents.view`(기본 대표 · 전무). 서버 · RLS 에서 막음 | 41 §4 · §10 |
| 보관 | 퇴사 후 3년 뒤 하드 삭제(R4 에서 자동 정리 — 아직 미구현) | 41 §6 |

#### 0-1. 신고 전에 고쳐야 할 것 (조사 중 발견 — 코드 안 고침, 사용자 결정 필요)

1. **「미국」이라는 동의 문구와 실제 처리 위치가 다를 수 있다.** Claude API 의 `inference_geo` 기본값은 `"global"`(「Inference may run in any available
   geography」)이고, 미국 안으로 고정하려면 `inference_geo: "us"`(요금 1.1배) 또는 워크스페이스 `default_inference_geo`/`allowed_inference_geos` 를 `us` 로 둬야 한다.
   저장(at rest)은 지금 `us` 하나뿐이다. `ocr.ts` 는 `inference_geo` 를 넘기지 않는다 → **추천: `inference_geo: "us"` 를 넣거나 콘솔에서 워크스페이스를 US 로 고정**.
   (서버 쪽 대체 모델 `fallbacks: "default"` 에도 같은 지역 제한이 걸리는지는 **확인 필요**.) 근거: [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency).
2. **동의 「자세히 보기」의 「최대 30일」은 예외를 빠뜨렸다** — 안전 분류기에 걸린 요청은 최대 2년. 방침 본문(아래 §4)에는 예외까지 적고, 화면 문구는
   「보통 30일 안에 지워요(예외는 개인정보처리방침)」 정도로 맞추기를 추천.
3. **계정 삭제가 신분 서류를 지우지 않는다.** `deleteAccount`(`src/app/account/actions.ts`)는 프로필을 묘비 처리(이름 · 전화 · 사진 · 생년월일 비움)하고
   행은 남기므로 `staff_id_documents` 의 `on delete cascade` 가 돌지 않는다 — **카드 사진(버킷) · 카드 칸 · `name_ko`/`name_ja`/`name_katakana`/`nationality` 가 남는다**.
   Google Play 는 계정 삭제 때 「계정에 연결된 사용자 데이터」를 지우거나, 보안 · 규제 이유로 남기는 것은 방침에 밝히라고 요구한다
   ([Play 사용자 데이터 정책](https://support.google.com/googleplay/android-developer/answer/10144311)). 결정할 것:
   (가) 계정 삭제 = 서류도 즉시 삭제, 또는 (나) 「퇴사 후 3년」 보관을 유지하되 방침에 「고용 관련 법정 확인 기록으로 최대 3년 보관 후 삭제」라고 명시.
   **→ 정해짐(2026-10-23 사용자): (나) 퇴사 후 3년 보관** — 방침 §4 문안에 「계정을 삭제해도 소속 조직의 고용 확인 기록으로 퇴사 후 3년까지 보관한 뒤 삭제합니다」를 넣는다.
   처리 지역은 코드에서 `inference_geo: "us"` 로 고정했다(2026-10-23). 보관 문구는 「보통 30일, 안전 점검이 필요한 경우 더 오래」로 고침(동의 문구 판 `2026-10-23.2`).
   **추천: (나) + 보관 중엔 서류 담당자만 열람 · R4 자동 삭제 구현 전에는 출시 신고에 (나)라고 쓰지 않는다**(지키지 못하는 약속이 되므로).
4. **APPI 28조 2항 정보 제공**: 동의를 받을 때 ①나라 이름 ②그 나라 개인정보 보호 제도 ③받는 쪽의 보호 조치를 본인에게 알려야 한다. 지금 동의 화면은 「미국」만 있다 →
   「자세히 보기」에 방침 §4 링크(아래 문안)를 붙이면 된다(문구 ko/ja/en 추가 필요 — 코드 작업).

### 1. App Store 「앱 개인정보」 (App Store Connect → 앱 개인정보) — 추가 · 변경분

현재 Apple 의 분류(16 범주 · 35 유형, [App privacy details](https://developer.apple.com/app-store/app-privacy-details/)) 기준. **추적: 아니요(그대로)**.
모든 새 항목: **사용자에게 연결됨(Linked)** · 목적 **앱 기능(App Functionality)** 하나(Apple 정의에 「authenticate the user … prevent fraud, implement security
measures」 포함 — 고용 자격 확인이 여기 들어간다).

| Apple 범주 → 유형 | 지금 신고 | 재류카드로 바뀌는 것 |
| --- | --- | --- |
| 연락처 정보 → 이름 | 있음 | 그대로(로마자 · 가타카나 이름도 「이름」) |
| 연락처 정보 → **실제 주소(Physical Address)** | **없음** | **새로 추가** — 카드의 住居地를 칸으로 저장(`staff_id_documents.address`) |
| 사용자 콘텐츠 → 사진 또는 비디오 | 있음 | 그대로 — 카드 사진도 이 유형. Apple: 「if you have a feature that enables users to upload … photos … you'll need to disclose」 |
| 기타 데이터 → 기타 데이터 유형 | 있음(생년월일 · 성별 · 근태 …) | 근거 설명에 **국적 · 재류자격 · 카드 번호 · 만료일 · 취로 제한 · 자격외활동**을 더함 |
| 민감한 정보(Sensitive Info) | 없음 | **추천: 신고 안 함.** Apple 정의는 「racial or ethnic data, sexual orientation, … religious …, biometric data」 — 국적은 인종 · 민족이 아니고, 카드 얼굴 사진은 **생체 인식 처리(얼굴 대조)를 하지 않는다**. 나중에 NFC 칩 얼굴 사진으로 **얼굴 대조**를 하면 다시 판단(42 문서 §6) |
| 식별자 / 진단 / 위치 | 있음 | 변화 없음 |

- **Anthropic 은 「제3자 파트너」 신고 대상이 아니라 우리 수집의 일부로 신고된다.** Apple 의 「third-party partners」 = 「analytics tools, advertising networks,
  third-party SDKs, or other external vendors **whose code you've added to your app**」. Anthropic 호출은 우리 서버에서 하므로 앱 안 SDK 가 아니다 —
  라벨은 「우리가 모으는 데이터」로 위 표에 이미 들어간다. 추적(데이터 브로커 · 광고)이 아니므로 「추적」도 아니요.
- **선택 신고(optional disclosure) 예외는 해당 없음** — 신분 서류 등록은 앱의 업무 기능(고용 확인)의 일부이고 「infrequent … not part of primary functionality」 조건을 다 채우지 않는다. 신고한다.
- `PrivacyInfo.xcprivacy`: `NSPrivacyCollectedDataTypePhysicalAddress`(Linked · 추적 아님 · AppFunctionality) 추가 필요 — **코드 작업, 승인 후**.

### 2. Google Play 「데이터 보안」 — 추가 · 변경분

현재 Play 분류([데이터 보안 양식 도움말](https://support.google.com/googleplay/android-developer/answer/10787469)) 기준. Play 에는 **「신분증(Government ID)」 유형이 따로 없다** —
개인 정보 → 기타 정보 정의가 「Any other personal information such as date of birth, gender identity, veteran status, etc.」 라서 카드 번호 · 재류자격 · 국적은 여기에 넣는다.

| Play 분류 → 유형 | 수집 / 공유 | 일시 처리? | 필수 / 선택 | 목적 |
| --- | --- | --- | --- | --- |
| 개인 정보 → 이름 | 수집 · 공유 안 함 | 아니요 | 필수(그대로) | 앱 기능 · 계정 관리 |
| 개인 정보 → **주소** | **새로 추가** · 공유 안 함 | 아니요 | **선택**(카드 등록은 「나중에」 가능) | 앱 기능 · **사기 방지 · 보안 · 규정 준수** |
| 개인 정보 → 기타 정보 | 수집 · 공유 안 함 | 아니요 | 기존 항목은 필수, 카드 칸은 선택 — Play 는 유형 하나에 한 값이므로 **필수**로 둠 | 앱 기능 · 계정 관리 · **사기 방지 · 보안 · 규정 준수**(추가) |
| 사진 및 동영상 → 사진 | 수집 · 공유 안 함 | 아니요(버킷에 저장) | 선택 | 앱 기능 · **사기 방지 · 보안 · 규정 준수**(추가) |

- **「공유」 아님**: Play 는 「a "service provider" that processes data on the developer's behalf … based on the developer's instructions」 로의 전송을 공유에서 뺀다.
  Anthropic 은 상용 약관 · DPA 상 처리자이고 우리 지시(글자 읽기)로만 처리한다 → **공유 = 아니요**. 18 §4 의 서비스 제공자 목록에 Anthropic 을 더한다.
- **전송 중 암호화: 예**(앱 ↔ 서버 HTTPS, 서버 ↔ Supabase · Anthropic HTTPS).
- **삭제 요청 가능: 예** — 단 신분 서류는 고용 확인 기록으로 퇴사 후 3년 보관(2026-10-23 결정, 방침에 사유 · 기간 명시).
- 목적 「사기 방지 · 보안 · 규정 준수(Fraud prevention, security, and compliance)」 은 Play 목적 목록에 있는 값이다 — 외국인 고용 시 재류 자격 확인(입관법)이 「규정 준수」.

### 3. 심사 지침 · 정책에서 특별히 걸리는 것

| 출처 | 내용 | 우리 상태 |
| --- | --- | --- |
| Apple 5.1.2(i) | 「You must clearly disclose where personal data will be shared with third parties, **including with third-party AI**, and obtain explicit permission before doing so.」 | **충족** — 동의 체크(기본 꺼짐) 뒤에만 전송, 동의 안 해도 등록 가능. 단 화면에 AI 언급을 뺀 상태(2026-10-23 사용자 결정)라 **방침에는 「글자 인식 AI 서비스(Anthropic)」라고 분명히 적어야** 이 조항을 충족한다(아래 §4) |
| Apple 5.1.1(i) | 방침에 수집 데이터 · 용도 · 제3자 보호 수준 · 보관/삭제 · 동의 철회 방법 | 방침 추가 필요(§4) |
| Apple 5.1.1(ii)·(iv) | 동의 철회를 쉽게, 거부해도 대안 | 대안 있음(직접 입력). 철회 = 다음 등록부터 동의 끄기 · 이미 보낸 사진은 Anthropic 에서 30일 안 삭제 — 방침에 적음 |
| Apple 5.1.1(iii) | 데이터 최소화 · 가능하면 시스템 사진 선택기 | 마이넘버 개인번호 미수집 · 앱 안 카메라 + 앨범 둘 다 |
| Apple 5.1.1(ix) | 「require sensitive user information」 앱은 개인이 아니라 **법인 명의로 제출** | A2 가 「조직」 가입이라 충족(17 0단계) |
| Apple 5.1 전체 | **신분증 수집 자체를 금지하거나 별도 서류를 요구하는 조항은 없다**(5.1 원문에 「government」 · 「ID」 단어 없음, 4.8 의 정부 전자 ID 로그인 예외만 있음) | — · 근거 [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) |
| Google Play 사용자 데이터 정책 | 개인 · 민감 데이터는 **앱 안에서 눈에 띄는 고지 + 적극적 동의**(탭 · 체크; 뒤로 가기 · 화면 이탈은 동의 아님), 수집 전에. 고지는 방침에만 있으면 안 되고 다른 고지와 묶지 말 것. 「government identification numbers」를 공개적으로 노출하는 것 금지 | 동의 화면이 촬영 **전**에 따로 있음 · 기본 꺼짐 → 충족. Play 권장 형식(「[앱]은 [기능]을 위해 [데이터]를 [언제] 전송합니다」)에 맞춰 「자세히 보기」를 보강하면 더 안전 |
| Google Play 계정 삭제 | 앱 안 + 웹 링크, 계정에 연결된 데이터 삭제, 남기는 건 방침에 공개 | §0-1 3번 결정 필요 |

- 심사 메모(18 §5)에 한 줄 추가 추천: 「외국인 직원의 재류카드(일본 국적은 마이넘버 카드 앞면 — 개인번호 미수집)를 고용 자격 확인용으로 받습니다. 사진 글자 읽기는
  사용자가 동의한 경우에만 외부 AI 서비스를 쓰며, 동의하지 않으면 직접 입력합니다. 데모 계정에서 계정 → 재류카드로 확인할 수 있습니다.」

### 4. 개인정보처리방침 추가 문안(안) — **승인 대기, `legal-content.ts` 미반영**

`/legal/privacy`(`src/lib/legal-content.ts` `privacyPolicy`)에 넣을 한국어 원안. 승인되면 ja · en 을 같은 조항 구조로 만들고 `LEGAL_EFFECTIVE_DATE` 를 올린다.
**공개 출시 전 법무 검토(D1) 대상**이다.

**「2. 수집하는 정보」에 한 줄 추가**

> 신분 확인 서류: 외국 국적 구성원은 재류카드 앞면 · 뒷면 사진과 카드에 적힌 정보(로마자 이름, 생년월일, 성별, 국적 · 지역, 주소, 재류카드 번호, 재류자격,
> 재류기간 만료일, 취로 제한 여부, 자격외활동 허가)를, 일본 국적 구성원은 마이넘버 카드 **앞면** 사진과 앞면 정보(이름, 생년월일, 성별, 주소)를 받습니다.
> 마이넘버(개인번호)는 받지 않으며, 사진에 개인번호가 보이면 저장하지 않고 다시 찍도록 안내합니다.

**「3. 이용 목적」에 한 줄 추가**

> 고용 시 취로 자격 확인, 외국인 고용 상황 신고 등 소속 조직의 법령상 확인 업무와 직원 정보 관리

**새 조항 「4-1. 신분 확인 서류와 글자 자동 읽기」**

> 신분 확인 서류 사진은 Foldy 의 비공개 저장소(일본 도쿄 리전)에 저장되며, 본인과 소속 조직에서 서류 열람 권한을 받은 관리자만 볼 수 있습니다.
> 등록할 때 이용자가 **동의한 경우에만**, 카드의 글자를 자동으로 읽기 위해 사진을 미국의 Anthropic, PBC 가 제공하는 글자 인식 AI 서비스(Claude API)로 보냅니다.
> 동의하지 않아도 사진만 올리고 정보를 직접 입력해 등록할 수 있습니다. 동의는 등록할 때마다 따로 묻고, 다음 등록에서 동의하지 않는 것으로 언제든 철회할 수 있습니다.
>
> - 받는 곳: Anthropic, PBC(미국). 우리 지시에 따라 글자 읽기만 처리하는 처리자이며, 계약상 받은 데이터를 AI 학습에 쓰지 않습니다.
> - 받는 곳의 보관: 보통 30일 안에 자동 삭제됩니다. 다만 Anthropic 의 안전 점검 시스템이 이용 정책 위반 가능성으로 표시한 경우 최대 2년, 법령상 보관 의무가 있는 경우 그 기간 동안 보관될 수 있습니다.
> - 이전되는 나라: 미국.
> - 미국의 개인정보 보호 제도: 미국에는 연방 차원의 포괄적인 개인정보 보호법이 없고 분야별 법률(예: 의료 HIPAA, 금융 GLBA, 통신 ECPA)이 있으며,
>   Anthropic 의 소재지인 캘리포니아주에는 포괄적인 법률로 캘리포니아 소비자 프라이버시법(CCPA)이 있습니다. 미국은 EU 적정성 결정을 받지 않았고 APEC CBPR 에 참여하고 있습니다.
>   자세한 내용은 일본 개인정보보호위원회의 「외국의 개인정보 보호 제도 조사(미국)」를 참고하세요: https://www.ppc.go.jp/enforcement/infoprovision/laws/offshore_report_america/
> - 받는 곳의 보호 조치: 데이터 처리 계약(DPA)에 따른 처리, 전송 · 저장 암호화, 접근 통제 등. 〔확인 필요: Anthropic Trust Center(https://trust.anthropic.com)에서 보유 인증(SOC 2 Type II · ISO 27001 등)을 확인해 이름을 적을지 결정〕
>
> 보관 기간: 재직 중에는 현재 서류와 이전 서류(갱신 이력)를 보관하고, 퇴사 후 3년이 지나면 사진과 정보를 삭제합니다.
> 계정을 삭제해도 소속 조직의 고용 확인 기록으로 퇴사 후 3년까지 보관한 뒤 삭제합니다. (2026-10-23 사용자 결정)

**「5. 외부 처리자와 국외 이전」 목록에 한 줄 추가**

> Anthropic — 신분 확인 서류 사진의 글자 읽기(이용자가 동의한 경우에만, 미국)

**「6. 보관과 파기」에 문장 추가**(§0-1 3번 (나)를 고른 경우)

> 신분 확인 서류는 위 4-1 의 기간에 따라 별도로 보관 · 삭제됩니다.

- 근거: APPI 28조 2항 · 시행규칙 17조 2항(나라 이름 · 제도 정보 · 받는 쪽 조치) — 개인정보보호위원회는 위 미국 조사(2021년 10월 시점)를 참고 자료로 공개하면서
  「外国における個人情報の保護に関する制度の確認は、外国にある第三者に対して個人データを提供する事業者の責任において行うべき」라고 적었다 → 출시 전 법무 검토 때 최신 여부 확인.
- 출입국재류관리청 공개 페이지도 「IC 칩에서 읽은 정보를 저장하면 개인정보보호법에 따라 이용 목적을 통지 · 공표해야 한다」는 취지를 적고 있다 — NFC(42 문서)를 붙이면 이 조항에 칩 정보를 더한다.

---

## 작업 기록

| 날짜 | 커밋 | 무엇 |
| --- | --- | --- |
| 2026-10-06 | `dfc5e6a` | 약관 · 개인정보 · 지원 공개 페이지, 끊긴 링크 연결 |
| 2026-10-06 | — | `NEXT_PUBLIC_SUPPORT_EMAIL` 프로덕션 설정(사용자) · 반영 확인 |
| 2026-10-06 | `56e3061` | 출시 계획 문서 신설 |
| 2026-10-06 | `8431e3f` | B5 계정 삭제 안내 페이지 `/legal/account-deletion` |
| 2026-10-06 | `cecc637` | B4 게시판 신고 · 차단 + 신고 처리 화면 · 차단 해제 |
| 2026-10-06 | `29ff68c` | B0 Capacitor 채택 기록 · B1 골격(android/ · ios/ · 권한) · B5-1 결정 |
| 2026-10-06 | `5e2a027` · `8a42c09` | B4-2 신고 취소 · 관리 콘솔 「게시판 신고」 · `board.moderate` 권한 키 · 콘솔 디자인 정리 |
| 2026-10-06 | `f200832` | B2 앱 안 Google 로그인(시스템 브라우저 + 앱 스킴 복귀) |
| 2026-10-06 | `e4d8179` | B2-1 Supabase Redirect URLs 에 앱 스킴 추가(사용자) |
| 2026-10-06 | `af4ce17` | B3 WebView 보정(외부 링크 · 다운로드 · 새 창 · 뒤로가기 · SystemBars), Android 첫 실행 가이드 |
| 2026-10-06 | (이 커밋) | Windows Android Studio 용 빌드 사본 스크립트(`npm run cap:android:win`) — WSL JDK 오류 회피 |
| 2026-10-07 | `28e6712` | B4-1 신고 · 차단 범위 검토 — 게시판 외 추가 불필요 |
| 2026-10-07 | (이 커밋) | A1 도쿄상공리서치 회신 — 회사 등록 확인, D-U-N-S 는 TSR 조회 페이지 · Apple 조회 도구로 확인 |
| 2026-10-07 | `dd7d824` | A1 D-U-N-S 번호 수령(718114295) |
| 2026-10-07 | `c851ee2` | B1-2 앱 아이콘 · 스플래시 생성 스크립트 + iOS · Android 반영 |
| 2026-10-07 | `458114e` | C6 iOS 권한 문구 ko/ja/en · `PrivacyInfo.xcprivacy` · 스토어 개인정보 답안(`18-store-review-kit.md`) |
| 2026-10-07 | `0b0bfbb` | B1-3 iOS 빌드 확인 워크플로(서명 없음, macOS 러너) |
| 2026-10-07 | `08f47b5` | D2 연결 실패 화면 — `server.errorPath` + 3개 언어 · 자동 복귀 |
| 2026-10-07 | `bdb8eab` | B6 데모 조직 시드 스크립트 · 개인정보처리방침 위치 문구 정정(출퇴근은 위치 필수 — 코드 기준) |
| 2026-10-07 | `f1f29e3` | 미룬 항목 정리(A2 · A3 · B6 적용 · 시연 영상) · C7 스토어 등록 문구 초안 · 청소 완료에 사진이 있다는 잘못된 문구 정정(iOS 카메라 권한 문구 포함) |
| 2026-10-08 | `de5d1e5` | B1-1 에뮬레이터 첫 실행 성공 · 로그인 첫 화면을 폰 · 앱에서는 현장 앱 문구로(「관리자 콘솔」 문구는 PC 만) |
| 2026-10-08 | `544329f` | B1-1 앱 로그인 → 모바일 홈 정상 확인(사용자) |
| 2026-10-08 | `1991776` | B2-2 Google 로그인 확인 · 네이티브 품질 수정 목록(N1~N7) 신설 |
| 2026-10-08 | `8795909` | N1 상태바 아이보리 + 어두운 아이콘 · N2 앱 위치를 네이티브 플러그인으로 · N4 정상 판정 |
| 2026-10-08 | `00aad4a` | N8 길게 누르기 브라우저 메뉴 차단 |
| 2026-10-08 | `3a761b9` | N9 「개발자에게 문의」 → 「소속 조직 관리자」(ko/ja/en) · N7 앱 확인 |
| 2026-10-08 | `b77cffc` | N10 앱 Google 로그인 복귀 수정(등록 주소와 정확히 일치) · B2-2 확인 정정 |
| 2026-10-08 | `9c5167d` | N10 원인 2 — 앱 복귀 주소를 예전 WebView 에서도 읽도록 문자열 판정 |
| 2026-10-08 | `c9589e0` | N11 시작 화면 로고 위치 튐 · 흰 화면 깜빡임 |
| 2026-10-08 | `8ac9741` | N11 진짜 원인 — 앱에서 웹 시작 화면 숨김 · 시작 화면 아이콘 960px · N3 · N10 앱에서 확인 |
| 2026-10-08 | `564dc66` | B1-2 앱 아이콘 · 시작 화면 · 연결 실패 화면 로고를 실제 제품 로고(회색 문)로 교체 — 남색 "S" 는 옛 임시 마크였다 |
| 2026-10-08 | (이 커밋) | 브랜드(로고 · 앱 이름) 교체 예정 기록 · 바꿀 곳 목록 |
| 2026-10-08 | (이 커밋) | N12 화면 스와이프 뒤로가기 — 웹 엔진 · 충돌 정리 · 뒤로 전환 방향 |
| 2026-10-09 | `2160d80` | N12 아이폰 홈 화면 앱 「반응 없음」 진단 — 세 손가락 탭 진단 표시(빌드 · 받음/안 받음 이유) |
| 2026-10-09 | (이 커밋) | 브랜드 로고 교체 — 「접힌 리넨」(앱 · PWA · 시작 화면 · 스토어 이미지 · favicon), 벡터 원본 `public/brand/logo.svg` |
| 2026-10-09 | (이 커밋) | 앱 이름 StayOps → Foldy — 화면 문구(ko/ja/en) · 앱 표시 이름 · 법적 문서 · 권한 문구 · 문서 전부 |
| 2026-10-09 | `7688de1` | 출시 보강 H1~H13 · 네이티브 품질 N13~N16 · N6 원인 수정(오류 화면 3개 언어 · 오프라인 자동 복귀) · 빌드 번호 2 |
| 2026-10-09 | (이 커밋) | 바깥 서비스 이름 교체 기록 — Google 동의 화면 · Supabase 인증 메일 완료(사용자) |
| 2026-10-09 | (이 커밋) | 앱 ID `com.harutokyo.stayops` → `com.harutokyo.foldy` (Android 패키지 · iOS 번들 · 앱 스킴) — Supabase Redirect URL 재등록 필요 |
| 2026-10-09 | (이 커밋) | N5 앱 안 브라우저 툴바 아이보리 · B1-3 iOS 서명 + TestFlight 업로드 워크플로(Mac 없이, 수동 실행) |
| 2026-10-09 | (이 커밋) | N12 메뉴 첫 화면에서도 스와이프 뒤로가기(사용자 결정) — 돌아갈 곳이 앱 밖이면 받지 않음 |
| 2026-10-20 | (이 커밋) | TestFlight 전 iOS 점검 — 위치 권한 키 `NSLocationAlwaysAndWhenInUseUsageDescription` 추가(Info.plist · ko/ja/en), WebView 바탕색 주석 정정 |
| 2026-10-20 | `6c71878` | N12 화면 스와이프 다듬기 — 놓은 뒤 손가락 속도 이어받기 · 둥근 판 · 검색칸 예외 · 밑그림 저장 · 기록 없으면 위 화면 |
| 2026-10-20 | (이 커밋) | N12 Android 예측 뒤로가기 → 같은 스와이프 엔진(`PredictiveBackPlugin`, App 뒤로 처리 끔) · 디버그 APK 컴파일 확인 — **새 앱 빌드 필요**, 실기기 미확인 |
| 2026-10-21 | (이 커밋) | iOS `Info.plist` `CADisableMinimumFrameDurationOnPhone` — ProMotion 아이폰에서 앱 애니메이션 120Hz(새 앱 빌드부터) · 스와이프 판 `transform` |
| 2026-10-22 | (이 커밋) | N6 오프라인 화면이 다시 안 살아나던 진짜 원인(React 미기동) → 맨 스크립트 · 기기 언어 · 다시 시도 · D2 앱 안 오프라인 표시 · 스와이프 판 모서리 아이폰 기종별 |
| 2026-10-23 | (이 커밋) | C6 추가분 — 재류카드 스토어 개인정보 신고 답안 · 방침 추가 문안(승인 대기) · 신고 전 고칠 것 3개 · NFC 칩 확인 설계(42) |
