# 스토어 심사 대응 자료

> 스토어 콘솔에 그대로 옮겨 적을 답안 모음이다. 진행 상태는 `17-app-release-plan.md` 에서 관리하고, 이 문서는 **내용**만 담는다.
> 근거는 `src/lib/legal-content.ts`(개인정보처리방침)와 실제 구현이다. 수집 항목 · 권한 · 외부 처리자가 바뀌면 이 문서,
> `legal-content.ts`, `ios/App/App/PrivacyInfo.xcprivacy` 를 함께 고친다.

## 1. 권한 안내 문구 (계획 C6)

| 권한 | 언제 쓰나 | 위치 |
| --- | --- | --- |
| 카메라 | 출퇴근 QR 스캔, 유지보수 · 분실물 등 업무 기록 사진 촬영(청소 완료 자체에는 사진 없음) | iOS `NSCameraUsageDescription` · Android `CAMERA` |
| 위치(사용 중) | 출퇴근을 기록하는 순간 한 번. 백그라운드 추적 없음. **출퇴근 인증에는 필수**(근무지 반경 확인 — `submitAttendanceScan`), 거부하면 출퇴근만 못 하고 다른 기능은 그대로 | iOS `NSLocationWhenInUseUsageDescription`(+ `NSLocationAlwaysAndWhenInUseUsageDescription` 같은 문구 — 플러그인 하위 라이브러리 때문에 Apple 이 요구, 「항상 허용」 팝업은 뜨지 않음) · Android `ACCESS_FINE/COARSE_LOCATION` |
| 사진 보관함 | 업무 기록에 첨부할 사진 선택 | iOS `NSPhotoLibraryUsageDescription` |

- iOS 문구는 `ios/App/App/{en,ko,ja}.lproj/InfoPlist.strings` 에 3개 언어로 있다. `Info.plist` 의 같은 키는 영어 대체값이다.
  `CFBundleLocalizations` = en · ko · ja (App Store 「언어」 표시와 시스템 권한 팝업 언어).
- Android 권한 팝업 문구는 OS 가 정한다(앱이 바꿀 수 없음).
- 백그라운드 위치 · 마이크 · 연락처 · 추적(ATT) 권한은 **요청하지 않는다**. 추가하려면 이 표부터 고친다.

## 2. iOS 개인정보 매니페스트 (`PrivacyInfo.xcprivacy`)

- `NSPrivacyTracking` = false, 추적 도메인 없음.
- `NSPrivacyAccessedAPITypes` = 비어 있음 — 앱 자체 코드(AppDelegate · SceneDelegate)는 Required Reason API 를 쓰지 않는다.
  Capacitor 와 플러그인(`@capacitor/app` · `browser` 등)은 각자 매니페스트를 포함한다. 플러그인을 추가하면 그 플러그인이 매니페스트를 갖췄는지 확인한다.
- `NSPrivacyCollectedDataTypes` = 아래 3절 표와 같은 11개 항목(계정 연결 9 + 오류 진단 2).

## 3. App Store 개인정보 라벨 (App Store Connect → 앱 개인정보)

- **추적(Tracking): 아니요.** 광고 · 광고 식별자 · 제3자 추적 없음.
- 진단 2개를 뺀 모든 항목: **사용자에게 연결됨(Linked to You)**, 목적 **앱 기능(App Functionality)** 하나.
- 진단(2026-10-09 추가): **사용자에게 연결되지 않음(Not Linked)**, 목적 앱 기능 — 화면 오류를 서버 로그로 받는다(`/api/client-errors`, 사용자 · 조직 ID 없음, 주소는 경로만).

| 라벨 분류 | 항목 | 근거 (`legal-content.ts` 「수집하는 정보」) |
| --- | --- | --- |
| 연락처 정보 | 이름 | 계정 정보 |
| 연락처 정보 | 이메일 주소 | 계정 정보 · Google 로그인 |
| 연락처 정보 | 전화번호 | 계정 정보 |
| 위치 | 정확한 위치 | 출퇴근 인증 순간의 GPS |
| 사용자 콘텐츠 | 사진 또는 비디오 | 업무 기록 첨부 사진 · 프로필 사진 |
| 사용자 콘텐츠 | 기타 사용자 콘텐츠 | 청소 · 수리 · 분실물 · 할 일 · 게시판 글과 댓글 |
| 식별자 | 사용자 ID | 계정 ID |
| 식별자 | 기기 ID | 출퇴근 「신뢰 기기」 토큰(앱이 만든 값, 광고 ID 아님) |
| 기타 데이터 | 기타 데이터 유형 | 생년월일 · 성별 · 근태 · 연차 · 급여 계산 정보 |
| 진단 | 충돌 데이터 | 화면 오류(오류 내용 · 스택) — **연결 안 됨** |
| 진단 | 기타 진단 데이터 | 화면 경로 · 앱 버전 · 기기 / 브라우저 종류 — **연결 안 됨** |

- 수집하지 않음: 건강 · 금융(카드 · 계좌) · 연락처 목록 · 검색 기록 · 브라우징 기록 · 구매 · 광고 데이터. (진단은 2026-10-09 부터 수집 — 위 표)
- 투숙객 정보(Beds24 예약 · 리뷰)는 앱 사용자 본인의 데이터가 아니라 조직이 연동한 업무 데이터다. 라벨은 「앱 사용자에게서 수집하는 데이터」 기준이므로 넣지 않되,
  방침 본문에는 이미 적혀 있다. 심사관이 물으면 이 설명으로 답한다.

## 4. Google Play 데이터 보안 양식 (Play Console → 앱 콘텐츠 → 데이터 보안)

| 질문 | 답 |
| --- | --- |
| 사용자 데이터를 수집하거나 공유하나요? | 예(수집) |
| 전송 중 데이터 암호화? | 예 (HTTPS 만 사용, `cleartext: false`) |
| 사용자가 데이터 삭제를 요청할 수 있나요? | 예 — 앱 안 계정 → 보안 → 계정 삭제, 웹 `/legal/account-deletion` |
| 제3자와 **공유**? | 아니요 — Supabase · Vercel · Google · Beds24 · DeepL · Slack 은 우리를 대신해 처리하는 서비스 제공자(Play 기준 「공유」 아님) |

수집 항목 — 모두 「수집됨 · 공유 안 함 · 필수 · 목적: 앱 기능, 계정 관리」(위치는 「앱 기능」만):

| Play 분류 | 항목 | 일시적 처리? |
| --- | --- | --- |
| 개인 정보 | 이름 · 이메일 주소 · 사용자 ID · 전화번호 · 기타 정보(생년월일 · 성별) | 아니요 |
| 위치 | 정확한 위치 | 아니요 (출퇴근 기록에 저장) |
| 사진 및 동영상 | 사진 | 아니요 |
| 앱 활동 | 기타 사용자 생성 콘텐츠 | 아니요 |
| 기기 또는 기타 ID | 기기 ID(신뢰 기기 토큰) | 아니요 |
| 앱 정보 및 성능 | 비정상 종료 로그 · 기타 앱 성능 데이터(화면 오류 · 앱 버전) — 목적: 분석(오류 수정) · 앱 기능 | 아니요 (서버 로그 보관 기간 후 삭제) |

- 「계정 삭제 URL」 = `<앱 주소>/legal/account-deletion` (도메인이 정해지면 C1 에서 교체).
- 「개인정보처리방침 URL」 = `<앱 주소>/legal/privacy`.

## 5. 심사 메모 (App Review Notes · Play 심사 안내) — 초안

제출(C9) 때 데모 계정(B6)과 함께 적는다.

- 업무용 앱: 숙박 시설 운영팀(청소 · 근태 · 유지보수 · 공지)이 쓰는 앱이며, 조직 초대 코드로만 가입한다. 심사용 데모 조직 계정을 제공한다.
- 사용자 간 공개 콘텐츠는 게시판 하나이며 신고 · 차단 · 관리자 처리가 있다(17 「B4-1 검토 결과」).
- 계정 삭제: 계정 → 보안 → 계정 삭제.
- 위치: 출퇴근 버튼을 누르는 순간에만 확인, 백그라운드 추적 없음. 카메라: 출퇴근 QR 스캔과 사진 첨부.
- 예약 캘린더는 예약 시스템(Beds24) 연동 조직에서만 채워지므로 데모 조직에서는 비어 있을 수 있다.
- 출퇴근은 **현장에 붙은 QR + 근무지 반경 안 GPS** 가 있어야 기록된다(보안 설계). 심사관은 원격이라 출퇴근 화면 · 카메라 권한 ·
  「반경 밖」 안내까지만 볼 수 있다 → 현장에서 찍은 **시연 영상 링크**를 메모에 첨부한다(👤 촬영).

## 6. 데모 계정 (계획 B6)

- 스크립트: `node scripts/dev/seed-review-demo.js` (계획만 출력) → `--apply` (실제 생성, 심사관 비밀번호를 **한 번만** 출력).
- 조직 「Foldy Demo」(slug `stayops-review-demo`) — 실제 조직과 `organization_id` 로 분리. 운영 DB 에 만든다(앱이 운영 웹을 띄우므로).
- 심사관 계정: `stayops.review@haru-tokyo.com`(기본값, `--email` 로 변경) · **owner** · 언어 en · 메일 인증 완료 상태 → 로그인하면 바로 홈.
- 다른 직원 2명(Mika Tanaka · Ken Sato, 로그인용 아님) — 게시판 글 · 댓글의 작성자라서 심사관이 **신고 · 차단**을 시험할 수 있다.
- 샘플: 건물 2(객실 5) · 공지 2 · 게시판 글 3 + 댓글 3 · 할 일 3(오늘 · 내일 · 관리함) · 유지보수 1 · 분실물 1. 모두 가상 데이터.
- 넣지 않는 것: 예약(Beds24 미연동) · 근무지(원격 출퇴근 불가) · 청소 일정.
- 2026-10-27: 같은 조직에 근태 · 급여 데모(`scripts/dev/seed-attendance-demo.js` — 근무지 2곳 · 가상 직원 9명 · 9 · 10월 출퇴근 · 급여)가 들어갔다.
  심사관 계정에도 근태 · 급여 화면이 채워져 보인다. 이 스크립트는 심사관 · Mika · Ken 계정은 건드리지 않는다. 자세한 내용: 문서 07.
- 다시 돌려도 안전: 조직이 있으면 계정 · 소속만 확인하고 샘플은 다시 넣지 않는다. 비밀번호 교체 = `--apply --password '<새 값>'`.
- 기존 계정과 이메일이 겹치고 그 계정이 다른 조직 소속이면 **중단**한다(실제 직원 계정을 건드리지 않음).
- 비밀번호는 저장소 · 문서에 적지 않는다. 제출 때 App Store Connect 「로그인 정보」· Play Console 「앱 액세스」에만 넣는다.

## 7. 스토어 등록 문구 (계획 C7) — 초안

- 글자 수 제한: App Store 이름 30 · 부제 30 · 홍보 문구 170 · 키워드 100(쉼표 구분, 공백 없이) · 설명 4000 / Google Play 이름 30 · 간단한 설명 80 · 자세한 설명 4000.
- 기능 설명은 **실제로 있는 기능만** 적는다(과장 = 2.3.1 거절 사유). 기능이 바뀌면 여기도 고친다.
- 「초대받은 조직 구성원만 사용」을 설명 첫머리에 밝힌다 — 심사관 · 일반 사용자가 가입 화면에서 막히는 이유를 미리 알 수 있게.

### 공통 항목

| 항목 | 값 |
| --- | --- |
| 앱 이름 | Foldy |
| 카테고리 | App Store: 비즈니스(주) · 생산성(부) / Google Play: 비즈니스 |
| 지원 URL | `<앱 주소>/support` |
| 개인정보처리방침 URL | `<앱 주소>/legal/privacy` |
| 저작권 | © 2026 株式会社Haru (영문 법인명은 D&B 등록명과 맞춘다) |
| 가격 | 무료 · 앱 내 구매 없음 · 광고 없음 |

### 연령 등급 설문 답안

| 질문(요지) | 답 |
| --- | --- |
| 폭력 · 성적 · 공포 · 약물 · 도박 · 욕설 콘텐츠 | 없음 |
| 사용자 생성 콘텐츠 · 사용자 간 소통 | **있음** — 조직 내부 게시판 · 댓글. 신고 · 차단 · 관리자 삭제 있음(B4) |
| 무제한 웹 접근 | 없음(외부 링크는 앱 안 브라우저로 열리지만 범용 브라우저 기능 없음) |
| 위치 공유 | 사용자 간 공유 없음(출퇴근 확인용으로 서버에만 기록) |
| 디지털 구매 · 광고 | 없음 |

- 예상 결과: App Store 대략 **12+ 또는 그 이하**(사용자 생성 콘텐츠 응답에 따라 Apple 이 정함), Google Play(IARC) **사용자 상호작용 표시가 붙은 전체 이용가**. 결과는 설문 제출 후 확정 — 여기 적힌 값은 예상치다.

### 한국어

- **부제(30):** 숙박 운영팀을 위한 업무 앱
- **홍보 문구(170):** 청소, 출퇴근, 할 일, 유지보수, 분실물, 공지를 하나의 앱에서. 현장 직원과 사무실이 같은 화면으로 일합니다.
- **키워드(100):** 숙박,호텔,민박,청소,출퇴근,근태,할일,유지보수,분실물,공지,게시판,현장관리,하우스키핑
- **간단한 설명(Play, 80):** 숙박 시설 운영팀을 위한 청소 · 출퇴근 · 할 일 · 공지 업무 앱
- **설명:**

```txt
Foldy 는 숙박 시설 운영팀이 매일 하는 일을 한곳에 모은 업무 앱입니다.
소속 조직에서 초대받은 구성원만 사용할 수 있습니다.

■ 청소
오늘 청소할 객실과 담당자를 확인하고 완료를 기록합니다. 고장이나 분실물은 청소 화면에서 바로 사진과 함께 접수합니다.

■ 출퇴근
근무지에 붙은 QR 코드를 스캔해 출근·퇴근을 기록합니다. 위치는 기록하는 그 순간에만 한 번 확인하며 백그라운드에서 추적하지 않습니다.

■ 할 일 · 프로젝트
오늘 · 내일 할 일과 팀 프로젝트를 정리하고 진행 상황을 함께 봅니다.

■ 유지보수 · 분실물 · 발주
객실 고장, 투숙객 분실물, 비품 발주를 사진과 함께 접수하고 처리 상태를 추적합니다.

■ 공지 · 게시판 · 제안함
관리자 공지와 팀 게시판으로 소통합니다. 게시판 글과 댓글은 신고 · 차단할 수 있습니다.

■ 한국어 · 일본어 · 영어
모든 화면을 세 언어로 쓸 수 있어, 다국적 팀도 같은 앱으로 일합니다.

■ 휴대폰 · 폴더블 · 태블릿
화면 크기에 맞춰 목록과 상세를 나란히 보여 줍니다.
```

### 日本語

- **サブタイトル(30):** 宿泊施設の運営チームのための業務アプリ
- **プロモーションテキスト(170):** 清掃、出退勤、タスク、メンテナンス、忘れ物、お知らせをひとつのアプリで。現場スタッフとオフィスが同じ画面で働けます。
- **キーワード(100):** 宿泊,ホテル,民泊,清掃,出退勤,勤怠,タスク,メンテナンス,忘れ物,お知らせ,掲示板,ハウスキーピング
- **簡単な説明(Play, 80):** 宿泊施設の運営チームのための清掃・出退勤・タスク・お知らせ業務アプリ
- **説明:**

```txt
Foldy は、宿泊施設の運営チームが毎日行う業務をひとつにまとめたアプリです。
所属組織から招待されたメンバーのみご利用いただけます。

■ 清掃
今日清掃する客室と担当者を確認し、完了を記録します。故障や忘れ物は清掃画面からそのまま写真付きで受け付けられます。

■ 出退勤
勤務地に掲示された QR コードを読み取って出勤・退勤を記録します。位置情報は記録するその時点で一度だけ確認し、バックグラウンドで追跡することはありません。

■ タスク・プロジェクト
今日・明日のタスクやチームのプロジェクトを整理し、進捗を共有します。

■ メンテナンス・忘れ物・発注
客室の故障、ゲストの忘れ物、備品の発注を写真付きで受け付け、対応状況を追跡します。

■ お知らせ・掲示板・提案箱
管理者からのお知らせとチーム掲示板でコミュニケーションできます。掲示板の投稿やコメントは通報・ブロックできます。

■ 韓国語・日本語・英語
すべての画面を3言語で利用でき、多国籍チームも同じアプリで働けます。

■ スマートフォン・フォルダブル・タブレット
画面サイズに合わせて、一覧と詳細を並べて表示します。
```

### English

- **Subtitle (30):** Operations app for stay teams
- **Promotional text (170):** Cleaning, attendance, tasks, maintenance, lost & found and announcements in one app — so field staff and the office work from the same screen.
- **Keywords (100):** hotel,hospitality,housekeeping,cleaning,attendance,timeclock,tasks,maintenance,lost and found,staff
- **Short description (Play, 80):** Cleaning, attendance, tasks and announcements for accommodation teams
- **Description:**

```txt
Foldy brings the daily work of accommodation operations teams into one app.
It is for members invited by their organization.

■ Cleaning
See which rooms to clean today and who is assigned, and record completion. Report damage or lost items with photos right from the cleaning screen.

■ Attendance
Clock in and out by scanning the QR code posted at your work site. Location is checked once, only at that moment — never tracked in the background.

■ Tasks & projects
Organize today's and tomorrow's tasks and team projects, and follow progress together.

■ Maintenance, lost & found, orders
Report room issues, guest lost items and supply orders with photos, and track their status.

■ Announcements, board & suggestions
Stay in touch through announcements and a team board. Board posts and comments can be reported and authors blocked.

■ Korean, Japanese and English
Every screen is available in three languages, so multinational teams share one app.

■ Phones, foldables and tablets
Lists and details sit side by side on larger screens.
```

### 스크린샷 (에뮬레이터 확인 후)

- 필요 크기: iPhone 6.9″(1320×2868) · iPad 13″(2064×2752) · Android 폰 · 7″/10″ 태블릿. 언어별(ko/ja/en)로 찍는다.
- 장면 안: 홈 · 청소 목록 · 출퇴근 QR · 할 일 · 유지보수 상세 · 게시판. **데모 조직(B6) 데이터로 찍는다** — 실제 투숙객 · 직원 이름이 나오면 안 된다.
