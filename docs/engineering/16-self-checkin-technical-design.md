# 16. 셀프 체크인 — 기술 설계 (초안)

> 상태: **설계(2026-10-30) · 태블릿 스택 B(Kotlin · Jetpack Compose) 사용자 확정 · NFC 1차 제외 · 코드 미착수.** 기획(무엇을 · 왜)은 `docs/product/43-self-checkin-kiosk.md`, 이 문서는 **어떻게**(스택 · 구조 · 데이터 · API · 기기)다.
> 전제(43 §8-9, 절대): 기존 Foldy 에 충돌 · 문제가 생기면 안 된다 — 같은 저장소 · 같은 Supabase, 손님용은 따로 배포.
> 사용자 요구(2026-10-30): 「기술 스택 · 네이티브 급으로 기획하고 시작」 — 태블릿 앱은 웹 뷰 껍데기 수준이 아니라 **키오스크 기기로서 네이티브 품질**이어야 한다.

## 1. 태블릿 앱 스택 — 선택지 (결정 대기)

「네이티브 급」이 뜻하는 것(43 §8-15 · 8-17 에서 나온 요구): ① 화면 잠금(홈 · 뒤로 · 알림 차단, 재부팅 뒤 자동 복귀) ② 전면 카메라로 **여권 사진 + 얼굴 동영상(5초 × 인원)** 을 끊김 없이 ③ 인터넷 끊겨도 입력 보존 · 복구 뒤 전송 ④ 터치 반응 · 전환이 즉각(키오스크는 느리면 손님이 포기) ⑤ 나중에 여권 MRZ 판독(OCR) · 여권 IC 칩 NFC ⑥ 사내 기기 수십 대에 **원격 배포 · 설정**.

| | A. Capacitor 셸 + 우리가 만드는 네이티브 플러그인 | B. 순수 네이티브(Kotlin · Jetpack Compose) | C. React Native(Expo) |
| --- | --- | --- | --- |
| 화면 | 웹(Next.js, 4개 언어) — 배포하면 바로 갱신 | Compose — 갱신은 APK 재설치 | RN — OTA 갱신 가능(EAS Update) |
| 잠금 · 키오스크 | Android **Lock Task Mode**(Device Owner) 를 **우리 플러그인**(Kotlin)으로 — Foldy 가 이미 `PredictiveBackPlugin` · `AppSettingsPlugin` 을 Java 로 만든 전례 | 같은 API 를 직접 | 네이티브 모듈 필요(같은 일) |
| 카메라 · 동영상 | **CameraX 플러그인(우리 제작)**: 미리보기 · 사진 · 5초 × n 동영상(720p, H.264) · 파일 경로 반환. 웹 `getUserMedia` 로도 되지만 WebView 녹화(MediaRecorder)는 코덱 · 성능이 기기마다 달라 **네이티브로 간다** | CameraX 직접 | expo-camera(동영상 품질 · 제어 제한) |
| 오프라인 보존 | 플러그인이 입력 JSON · 파일을 앱 저장소(암호화 `EncryptedFile`)에 보관, 네이티브 쪽 **전송 큐**(WorkManager) | WorkManager 직접 | 라이브러리 |
| 성능 | WebView — 화면이 단순(큰 버튼 · 폼)하고 애니메이션이 적으면 체감 차이 없음. 무거운 것(카메라 · 녹화)은 네이티브가 함 | 가장 좋음 | 좋음 |
| OCR · NFC(나중) | ML Kit 텍스트 인식 플러그인 · NFC(ISO-DEP) 플러그인 — 42 번 재류카드 NFC 설계와 같은 길 | 직접 | 네이티브 모듈 |
| 원격 배포 · 설정 | 화면은 Vercel 배포, 셸(APK)은 **Android Enterprise(Managed Google Play) 또는 MDM** 으로 밀기 — 어느 안이든 같음 | 같음 | 같음 |
| **팀 · 유지** | Foldy 팀이 쓰는 그대로(TS · Next.js · Capacitor) + Kotlin 플러그인 3~4개(잠금 · 카메라 · 오프라인 큐 · 기기 정보). 직원 화면 · 사전 등록 페이지와 **코드 · 사전(i18n) 공유** | Kotlin 전담 필요, 화면 두 벌(태블릿 Compose · 사전 등록 웹) | 새 스택 하나 더 — Foldy 에 없음 |
| 위험 | WebView 가 느린 저가 태블릿이면 체감 저하 → **기기 확인(43 §8-1)** 뒤 결정 | 개발 기간 · 인력 | 스택 분산 |

### 1-0. 이 기능에 최적인 스택 — 요구에서 거꾸로 (2026-10-30, 사용자 「벤치마킹이 아니라 최적의 스택」)

Hotelsmart 는 참고일 뿐이다. 이 기능이 **잘 되려면** 무엇이 결정적인지부터:

| 결정적 요구 | 왜 결정적인가 | 가장 잘 푸는 기술 |
| --- | --- | --- |
| ① 여권을 **읽히게** 찍기 | 명부의 핵심이 여권 번호 · 이름 · 국적 — 흐리면 법 요건 미달 · 직원이 다시 확인 | **CameraX**(연속 자동 초점 · 탭 초점 · 노출 잠금 · 고해상도 정지 화상) — WebView `getUserMedia` 는 초점 · 해상도 제어가 없어 저가 태블릿에서 흐릿해지기 쉽다 |
| ② **MRZ 자동 판독**(여권 아래 2줄) | 손님이 로마자 이름 · 여권 번호 · 생년월일 · 국적을 **안 치게** 하는 것이 체크인 시간 · 오타 · 포기율을 좌우. 2025-04 개정의 「자동 체크인 기기로 정보 대조」(방식 B) 도 여기서 열린다 | **ML Kit Text Recognition v2(온디바이스, 무료)** + MRZ 체크섬 파서. 웹에는 동급이 없다(Tesseract.js 는 느리고 부정확) |
| ③ **여권 IC 칩(NFC)** — 위조 판별 | 재류카드 42 번과 같은 이유: 사진만 찍는 방식은 정교한 위조를 못 잡는다. 나중이지만 **스택을 지금 정해야** 그때 붙는다 | Android `IsoDep` + **JMRTD**(ICAO 9303 BAC/PACE · DG1/DG2 · Passive Authentication). Web NFC 는 불가 |
| ④ 얼굴 **동영상 5초 × n** | 법 요건(현행 방식) — 끊김 · 코덱 실패가 곧 체크인 실패 | CameraX `VideoCapture`(H.264 720p, 기기 하드웨어 인코더) |
| ⑤ **키오스크 잠금 · 자동 복귀** | 손님이 홈으로 나가면 기기가 멈춘 것과 같다. 재부팅 · 업데이트 뒤에도 혼자 돌아와야 | **Device Owner 앱 + Lock Task Mode**(Android Enterprise QR 프로비저닝) — 우리 앱 자체가 Device Owner 가 되는 것이 가장 견고(서드파티 키오스크 앱 불필요) |
| ⑥ 오프라인 보존 · 재전송 | 건물 와이파이는 끊긴다 | **Room(SQLCipher) + WorkManager** 전송 큐 — 앱이 죽어도 OS 가 이어서 보냄 |
| ⑦ 즉각 반응 · 큰 터치 · 4개 언어 | 키오스크는 0.3초 지연에도 두 번 누른다 | **Jetpack Compose**(네이티브 렌더 · 60fps · 시스템 폰트 Noto CJK) |
| ⑧ 화면 캡처 방지 · 민감 데이터 | 여권이 화면에 뜬다 | `FLAG_SECURE` · 앱 내 저장은 암호화 · 전송 뒤 즉시 삭제 |
| ⑨ 원격 배포 · 설정 · 상태 | 기기 수십 대 | Android Enterprise(Managed Google Play 비공개 앱) + 우리 서버의 기기 핑 · 설정 내려주기 |

**NFC 는 결정 근거에서 뺀다(2026-10-30, 사용자 질문 「NFC 포기가 더 좋은가」에 대한 답)**: 여권 IC 칩 읽기는 ① 법 요건이 아니다(요건 = 사본 보관 + 본인 확인) ② 태블릿에 NFC 하드웨어가 없을 수 있다(저가 Android 태블릿 다수가 미탑재 — 기종 확인 전엔 모른다) ③ 손님이 여권을 기기에 대고 기다려야 해 체크인이 길어진다 ④ 위조 여권이 민박 · 호텔 체크인에서 잡히는 빈도는 낮다. 그래서 **NFC 는 포기해도 된다 — 1차 범위에서 빼고, 나중에 회사가 원하고 기기가 지원할 때만**. 스택 결정은 NFC 가 아니라 **① 여권 초점 ② MRZ 판독 ④ 동영상 ⑤ 잠금 ⑥ 오프라인** 다섯 가지로 한다 — 이 다섯만으로도 B 가 맞다. 다만 B 로 가면 NFC 의 문은 공짜로 열려 있고, A′ 로 가면 영원히 닫힌다는 차이만 남는다.

**결론: 태블릿 앱의 최적 스택은 B — Kotlin · Jetpack Compose 순수 네이티브.** ①②③④⑤⑥ 여섯 개가 전부 네이티브 API 라서, 웹 뷰 위에 플러그인을 쌓는 A 는 「네이티브를 웹에서 조종하는 다리」만 늘리고 품질은 B 를 넘지 못한다. 카메라 미리보기를 WebView 위에 겹치는 것도 A 의 고질적 약점(터치 · 레이아웃 충돌)이다.
A′(순수 웹) 는 ①②③ 을 **영원히** 못 하므로 「최적」이 아니라 「가장 빠른 임시」다 — 1차로 쓰더라도 2차에 B 로 **다시 만들게** 된다(웹 화면을 재사용 못 함).

**B 의 비용과 그 대응**
- Kotlin · Compose 를 새로 익힌다 → 범위가 작다(화면 7~8개 · 선형 흐름 · 디자인 시스템 최소). Foldy 가 이미 Java 플러그인 · Gradle · 서명 · 실기기 테스트를 한다. 카메라 · ML Kit · NFC · WorkManager 는 전부 Google 공식 라이브러리 + 예제가 풍부.
- 화면 로직이 두 벌(태블릿 Compose · 사전 등록 웹) → **「계약」을 하나로**: 명부 칸 정의 · 필수 규칙 · 막는 경우 · 문구(4개 언어)를 서버가 **JSON 으로 내려주고** 양쪽이 그대로 그린다(`GET /api/kiosk/settings` · `GET /api/guest/[token]` 에 스키마 포함). 검증 규칙도 서버가 최종.
- iOS 는 안 만든다(회사 기기 = Android). 나중에 팔 때 iPad 요구가 오면 그때 Swift 또는 Flutter 판단.

**그 밖의 층은 요구가 다르므로 스택도 다르다**
- **사전 등록(손님 휴대폰 웹)**: 카메라 고급 제어 · OCR · NFC 가 필요 없고(사진 업로드면 충분 — 판독 · 대조는 태블릿에서 다시), 링크 하나로 열려야 하므로 **Next.js 웹**이 최적. `apps/checkin`.
- **백엔드**: Supabase Postgres(`checkin` 스키마) + Storage + **Next.js 라우트 핸들러**(`apps/checkin`, Vercel hnd1). Foldy 와 같은 운영 방식 · 같은 DB · RLS. Edge Functions(Deno) 로 나눌 이유 없음.
- **직원 화면**: Foldy 안(Next.js) — 43 §8-16.
- **OCR 서버 대조(나중, 방식 B)**: 태블릿 ML Kit 결과 + 여권 사진을 서버가 Beds24 예약 이름과 대조 — 서버 측 추가 OCR 은 불필요.

### 1-1. Hotelsmart 는 무엇으로 만들었나 (참고용) (2026-10-30 관리자 화면에서 확인)

- **관리자(호스트) 화면**: Vue SPA(`Dashboard.vue-*.js` 청크, esbuild/Vite 번들) + Material Icons + Quill 에디터. 백엔드는 **PHP**(2026-10-22 자체 공지 「PHP の脆弱性への対応状況」) · JSON POST `/host-api`. 직원용 화상 통화 · 전화는 브라우저 WebRTC(`phone-ringtone` · 「準備OK」 표시) + `native-bridge-worker.js`(Windows 「HotelSmart 機器接続」 앱과 다리 — 프린터 · 자동 정산기용).
- **태블릿 화면**: 현장 사진(43 §8-2)에 「back to top」 링크와 Material 스타일 버튼 → **브라우저(또는 WebView) 에서 도는 웹 페이지**다. 스토어 앱은 검색에서 못 찾았다(공식 자료도 「タブレット端末」라고만). 「確認動画撮影」 · 얼굴 사진 · 여권 촬영이 전부 **브라우저 카메라(getUserMedia · MediaRecorder)** 로 된다는 뜻 — 1,500~3,500 시설이 이 방식으로 운영 중.
- 즉 Hotelsmart 의 태블릿은 **「웹 + 얇은 껍데기」** 수준이고, 우리 A 안은 그보다 네이티브 쪽이 두텁다.

### 1-2. 그래서 가장 효과적인 것은 — **A′ 먼저, A 로 성장**

| | A′. 순수 웹 + 키오스크 브라우저(Fully Kiosk Browser 등) | A. Capacitor 셸 + Kotlin 플러그인 |
| --- | --- | --- |
| 네이티브 코드 | **0줄** — 잠금 · 화면 켜짐 · 재부팅 자동 시작 · 원격 관리 · 카메라 권한 자동 허용은 키오스크 브라우저 앱이 해 준다(기기당 약 1,000엔 한 번) | Kotlin 플러그인 4개를 우리가 만들고 유지 |
| 카메라 · 동영상 | 브라우저 `getUserMedia` + `MediaRecorder`(Android Chrome · WebView: VP8/H.264 webm) — Hotelsmart 와 같은 길. 5초 × n 짧은 클립엔 충분 | CameraX — 더 안정 · 해상도 제어 |
| 오프라인 | 웹(IndexedDB) 에 입력 보존 · 복구 뒤 전송 — 서비스 워커 없이도 됨 | 암호화 파일 + WorkManager |
| OCR · NFC(나중) | **안 됨**(Web NFC 는 ISO-DEP 불가 — 42 번과 같음) → 이때 A 로 | 됨 |
| 처음 쓸 때까지 | **가장 빠름** — 웹만 만들면 끝 | 플러그인 · 빌드 · 서명 · 배포 추가 |
| 위험 | 브라우저 업데이트로 카메라 동작이 바뀔 수 있음(Hotelsmart 도 같은 위험을 안고 운영) · 키오스크 앱이 서드파티 | 우리 코드라 통제 가능 |

**(1-2 는 「빠른 임시」 비교로만 남긴다 — 최적 결론은 §1-0.)** ~~추천(수정): 1차 = A′, 2차 = A.~~ 웹 화면은 두 안에서 **완전히 같은 코드**라 A′ 로 시작해도 버리는 것이 없다. 네이티브가 꼭 필요해지는 순간은 ① 여권 MRZ OCR ② 여권 NFC ③ WebView 카메라가 기기에서 불안정할 때 — 그때 같은 웹을 Capacitor 셸에 넣고 플러그인을 붙인다(§5 는 그때 쓰는 설계로 남긴다).
「네이티브 급」 체감(즉각 반응 · 잠금 · 자동 복귀)은 A′ 에서도 키오스크 브라우저 + 가벼운 웹(큰 버튼 · 애니메이션 최소 · 사전 로딩)으로 낸다. 단 **기종 확인**(Android 10+ · RAM 3GB+)은 두 안 모두의 조건.

**원래 A 의 설명** — 「웹이 화면, 네이티브가 기기」. 키오스크에서 네이티브가 꼭 필요한 곳(잠금 · 카메라 · 녹화 · 오프라인 · 나중의 OCR · NFC)은 **전부 Kotlin 플러그인**으로 만들고, 화면 · 흐름 · 문구는 웹으로 둬 사전 등록 페이지 · 직원 화면과 같은 코드 · 사전을 쓴다. Foldy 앱이 이미 이 구조(Capacitor + 자체 플러그인 + 배포된 웹)로 돌고 있어 운영 방식도 같다.
단, **A 의 조건**: 태블릿이 WebView 를 매끈하게 돌릴 수 있는 기종이어야 한다(Android 10+ · RAM 3GB+ 권장). 기종 확인 뒤 저사양이면 B 로 간다.

→ **B 확정(2026-10-30 사용자 「B로 확정」).** §2 이하는 B 기준.

## 2. 전체 구조 (B 확정)

```txt
apps/checkin/                        ← 독립 Next.js 16 앱: 손님 사전 등록 웹 + 서버 API (루트 Foldy 와 package.json 분리)
  src/app/r/[token]/…                ← 사전 등록 페이지 (링크 토큰, 4개 언어)
  src/app/api/kiosk/…  api/guest/…  api/device/…  api/jobs/…
  src/lib/contract/                  ← 「계약」: 명부 칸 정의 · 검증 규칙 · 막는 경우 · 문구 — JSON 으로 내려줌
  src/lib/i18n/{ja,en,zh-Hans,ko}.json
apps/checkin-kiosk/                  ← Android 네이티브 앱 (Kotlin · Jetpack Compose), Gradle 프로젝트, 루트 android/ 와 무관
  app/src/main/java/com/harutokyo/foldy/checkin/
    ui/        (Compose 화면 · 테마)
    camera/    (CameraX 여권 촬영 · 동영상)
    mrz/       (ML Kit 텍스트 인식 + MRZ 파서)
    kiosk/     (Device Owner · Lock Task · 부팅 자동 실행)
    data/      (Room 암호화 DB · 전송 큐 WorkManager · API 클라이언트)
    contract/  (서버 계약 JSON 모델 — apps/checkin 과 같은 스키마)
supabase/migrations/202611020001_checkin_schema.sql    ← 같은 이력에 추가만 (43 §8-9) · 초안, 운영 미적용
Foldy(루트) src/app/admin/checkin · src/app/mobile/checkin · src/actions/checkin   ← 직원 화면 (추가만, 4단계)
```

- **루트 Foldy 와 떼어 두기(2026-11-02 적용)**: 루트 `tsconfig.json` exclude `apps` · `eslint.config.mjs` ignore `apps/**` · `vitest.config.ts` exclude `apps/**`(같이 `.claude/**` — 다른 세션 작업 트리 테스트가 섞이지 않게). `apps/checkin` 은 자기 `node_modules` · `.gitignore` · lint · test · build 를 따로 돈다. `.npmrc` 의 `legacy-peer-deps=true` 는 npm 10.9 설치 오류(arborist) 피하기용.
- 손님 쪽 트래픽은 전부 `apps/checkin` 도메인(API 포함). 태블릿 앱도 같은 API 를 기기 토큰으로 부른다. Foldy 도메인에는 손님 · 기기 경로가 없다.
- **Beds24 API 호출 0 — 읽기 · 쓰기 모두 안 함**(2026-11-01, 44 §14-6): 예약은 Foldy 웹훅이 채운 `public.reservations` 에서만 읽는다(크레딧 0). `apps/checkin` 은 Beds24 토큰을 갖지 않는다. ~~Info 항목 1종 쓰기(44 §14-5)~~ 는 1차 제외.
- `public` 스키마는 **읽기 전용**(`reservations` · `properties` · `rooms` · `property_operation_infos`). `checkin` → `public` FK 없음(id 값만 저장).
- **계약(contract) 하나**: 명부 칸 · 필수(국적 · 일본 주소 여부에 따라) · 어린이 규칙 · 막는 경우 코드 · 문구 4개 언어 · 약관 버전 · 동영상 초를 서버가 `GET /api/kiosk/settings`(기기) · `GET /api/guest/[token]`(손님) 에 JSON 으로 담아 준다. 태블릿(Compose) 과 웹(React) 은 **그리기와 입력만** 하고, 검증의 최종 판정은 서버(`PUT guests` 가 계약으로 다시 검사). 계약 스키마는 `apps/checkin/src/lib/contract/schema.ts`(zod) 가 원본이고, Kotlin 모델은 그 JSON 과 1:1(수동 유지 · 계약 버전 번호로 호환성 검사).

## 3. 데이터 모델 — `checkin` 스키마

| 표 | 핵심 열 | 메모 |
| --- | --- | --- |
| `checkin.devices` | id · organization_id · property_key · name · token_hash · registered_by · last_seen_at · revoked_at · app_version · device_model · os_version · battery | 기기 토큰(sha256) — 근태 `attendance_trusted_devices` 와 같은 방식 |
| `checkin.enrollment_codes` | code(8자리) · property_key · expires_at(10분) · used_at | 기기 등록 1회용 |
| `checkin.property_settings` | property_key · languages · welcome_text(jsonb 4개 언어) · terms_text(jsonb) · terms_version · required_fields(jsonb) · video_seconds_per_guest(5) · support_contacts(jsonb) · idle_seconds_input(240) · idle_seconds_done(30) · verification_method(`video` \| `staff_call` \| `auto_match`) · staff_pin_hash · mrz_autofill(bool) | 43 §8-6(3) 건물별 설정 — 계약의 재료 |
| `checkin.stays` | id · organization_id · reservation_group_key(`original_reservation_id`) · property_key · check_in_date · check_out_date · guest_count_expected · party_size(손님이 줄인 인원, 2026-11-02) · checkin_code(6자리, org 안 unique · 기간 지나면 재사용) · status(`pending` \| `pre_registered` \| `in_progress` \| `checked_in` \| `expired` \| `cancelled`) · pre_reg_token_hash · pre_reg_sent_at · reminded_at · checked_in_at · verified_at · verified_by · retain_until | 예약 묶음 하나 = 체크인 하나(43 §8-13) |
| `checkin.stay_tokens` | token_hash(sha256, 기본 키) · stay_id · created_at | 손님 개인 링크 — stay 당 여러 개 · 최근 10개(2026-11-02, `202611020002`) |
| `checkin.claim_attempts` | key_hash · ip_hash · succeeded · attempted_at | 「예약 찾기」 시도 — 잠금 · 속도 제한(IP 원문 없음, `202611020002`) |
| `checkin.stay_rooms` | stay_id · reservation_id(public) · room_label · room_id | 여러 방 |
| `checkin.guests` | id · stay_id · stay_room_id · is_representative · guest_type(`adult` \| `child`) · name_roman · name_kana · nationality(ISO 3166-1 alpha-3) · has_japan_address · address · postal_code · phone · email · birth_date · gender · occupation · passport_number · passport_expiry · prev_stay · next_dest · source(`beds24` \| `guest` \| `staff` \| `mrz`) · mrz_raw · mrz_valid(bool) · no_passport_reason | `mrz_*` = 판독 원문 · 체크섬 결과(직원이 손 입력과 비교) |
| `checkin.guest_documents` | id · guest_id · kind(`passport` \| `face_video` \| `id_card`) · storage_path · byte_size · width · height · duration_s · captured_at · captured_on(`kiosk` \| `guest_web` \| `staff`) · device_id · replaced_by · retain_until · sha256 | 비공개 버킷 `checkin-documents`; sha256 로 전송 무결성 |
| `checkin.consents` | stay_id · guest_id(대표자) · terms_version · agreed_at · locale · device_id | 약관 동의 |
| `checkin.sessions` | id · stay_id · device_id · started_at · last_step · step_payload(jsonb) · finished_at · abandoned_at · locked_until | 태블릿 진행(이어 하기 · 동시 잠금 — 다른 기기는 `locked_until` 안엔 거부) |
| `checkin.audit_log` | actor_user_id \| device_id · action · stay_id · guest_id · document_id · at · meta | 열람 · 수정 · 확인 · 내보내기 · 삭제 · 기기 등록 |
| `checkin.deletions` | stay_key · deleted_at · counts | 자동 삭제 기록(개인 정보 없음) |

- **RLS**: `checkin.*` 는 **직원 읽기 정책만**(`public.memberships` + `checkin.view` / `checkin.documents` 권한 — Foldy 권한 표 그대로 읽음). 손님 · 기기 쓰기는 전부 서버 라우트(서비스 롤). anon 정책 없음, delete 정책 없음(43 §8-14). `audit_log` 는 insert 만.
- **마이그레이션 초안(2026-11-02, `202611020001_checkin_schema.sql`, 운영 미적용)**: 위 11개 표 + 비공개 버킷 `checkin-documents`(60MB, jpeg · png · webp · mp4 · webm). 자식 표에도 `organization_id` 를 넣어 RLS 가 조인 없이 거른다. 읽기 정책은 `public.has_capability(organization_id, auth.uid(), 'checkin.view' | 'checkin.documents' | 'checkin.manage')`. `storage.objects` 정책은 두지 않는다(파일은 서버가 서명 URL 로만). **권한 키 등록(`capability_roles` 씨앗)은 4단계 직원 화면 때** — 그 전에는 플랫폼 관리자만 통과한다. 로컬 검증은 PGlite(표 11 · 정책 12 생성 확인).
- **stays 생성**: Foldy Beds24 웹훅은 손대지 않는다. `apps/checkin` 의 `jobs/sync-stays`(5분 크론) 가 `public.reservations` 의 오늘 −1 ~ +30일 예약을 읽어 `stays` · `stay_rooms` 를 만들고 코드를 발급한다. **한 stay = 채널 예약 번호(`original_reservation_id`) 하나** — 방 여러 개 예약(같은 번호 줄이 여럿, 최근 6개월 19건)은 stay 1개 + `stay_rooms` 여러 개로 묶어, 예약 번호로 찾으면 방 전부가 한 번에 열린다(43 방 여러 개 규칙). 취소 · 날짜 · 인원 변경도 여기서 따라간다(체크인 뒤 변경은 기록만).
- **sync-stays 동작(2026-11-02 구현, `apps/checkin/src/lib/sync/plan.ts` 판단 · `run.ts` 읽기 쓰기 · `GET|POST /api/jobs/sync-stays`)**:
  - 읽는 범위: `public.reservations` 체크인 날짜 도쿄 오늘 −1 ~ +30일(취소 포함, 1,000줄씩). 묶음 = (조직, `original_reservation_id`). 번호가 비면 건너뛴다.
  - 숙박 있는 줄 = 상태가 `cancelled` · `no_show` 가 아닌 것(43 「막는 경우」 표와 같다). 체크인 날짜 = 가장 이른 날, 체크아웃 = 가장 늦은 날, 예상 인원 = 방마다 성인 + 어린이 + 유아(모르면 방 하나 1명).
  - 건물 키: `property_name` 을 `apps/checkin/src/lib/building-key.ts` 로 바꾼다(Foldy `room-label-normalization.ts` 와 같은 규칙을 따로 둠 — 건물이 늘면 두 곳을 같이 고친다). 모르는 건물은 건너뛰고 건수만 돌려준다.
  - 없으면 만든다: `pending` + 6자리 코드(겹치면 다시 뽑기, 최대 8번) + `stay_rooms`. 전부 취소된 묶음은 만들지 않는다.
  - 있으면 맞춘다: 열린 stay(`pending` · `pre_registered` · `in_progress`)는 바뀐 칸만 고치고 방을 더하거나 뺀다. 전부 취소되면 `cancelled` · `retain_until = 오늘 + 30일`. 취소됐다 살아나면 `pending` + 새 코드. `checked_in` · `expired` 는 바꾸지 않고 「체크인 뒤 변경」 건수만 센다(`audit_log` 는 사람 · 기기만 적는 칸이라 크론 기록은 4단계에서 정한다).
  - 같은 묶음을 두 실행이 동시에 만들면 늦은 쪽은 건너뛰고 다음 실행이 맞춘다. 응답은 건수만(이름 · 예약 번호 없음), 오류 문구도 「sync_failed」만.
  - 인증: `Authorization: Bearer <CRON_SECRET>` — Vercel Cron 이 GET 으로 부르므로 GET · POST 둘 다 받는다. 비밀값이 없으면 전부 401.
  - 운영 연결 전 할 일: 마이그레이션 적용(사용자 컨펌) · Supabase API 노출 스키마에 `checkin` 추가 · Vercel `foldy-checkin` 프로젝트 환경 변수(`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `CRON_SECRET`) · 5분 크론 등록(Vercel 요금제에 따라 크론 간격 제한 확인).
- **보존**: `retain_until = check_out_date + 3년`(취소는 +30일). 매일 도쿄 04:00 `jobs/retention` 이 파일 → 줄 순으로 삭제.

## 4. API (서버 라우트, `apps/checkin`)

| 경로 | 호출자 | 인증 | 하는 일 |
| --- | --- | --- | --- |
| `POST /api/device/enroll` | 태블릿 | 등록 코드 + 기기 정보 | 기기 토큰 발급(원문 1회 반환) |
| `POST /api/device/ping` | 태블릿(5분) | 기기 토큰 | last_seen · 배터리 · 앱 버전 · 설정 버전 → 바뀌었으면 settings 다시 받으라는 신호 |
| `GET /api/kiosk/settings` | 태블릿 | 기기 토큰 | **계약 JSON**(칸 · 규칙 · 문구 · 약관 · 초 · 연락처 · 계약 버전) |
| `POST /api/kiosk/find` | 태블릿 | 기기 토큰 | 코드 또는 이름 + 날짜 → stay(그 건물 · 기간 안) · 방 · 미리 입력된 명부 · 막는 경우 코드 |
| `POST /api/kiosk/session` | 태블릿 | 기기 토큰 | 세션 시작 · 잠금 · 이어 하기(`step_payload`) |
| `PUT /api/kiosk/guests` | 태블릿 | 기기 토큰 + 세션 | 명부 저장(사람별 · 부분) — 서버가 계약으로 재검증, MRZ 원문 · 체크섬도 받음 |
| `POST /api/kiosk/upload-url` | 태블릿 · 손님 웹 | 기기/링크 토큰 | 서명 업로드 URL(종류 · 용량 · MIME · 1회) |
| `POST /api/kiosk/document` | 태블릿 · 손님 웹 | 기기/링크 토큰 | 업로드 끝 보고(sha256 · 크기) → `guest_documents` 줄 |
| `POST /api/kiosk/complete` | 태블릿 | 기기 토큰 + 세션 | 동의 · 전원 명부 · 동영상 검증 → `checked_in` · 방 번호 · 비밀번호(`property_operation_infos`) 반환 |
| `POST /api/guest/claim` | 손님 웹(건물 고정 링크 `/p/<건물>`) | 없음(공개) — 이름 + 체크인 날짜 + **채널 예약 번호**(`reservations.original_reservation_id` — `raw_payload.apiReference` 와 같은 값, 대소문자 · 공백 · 하이픈 무시, 없으면 전화 뒤 4자리) 3요소(2026-11-01, 44 §14-7) | 일치하는 stay 가 **하나**면 토큰 발급(원문 1회) · IP · 건물당 속도 제한 · 5회 실패 10분 잠금 · 불일치 시 어떤 것이 틀렸는지 말하지 않음 |
| `PUT\|DELETE /api/guest/[token]/guests` · `POST …/passport` · `POST …/consent` | 손님 웹 | 링크 토큰 | 한 사람 저장(최대 20명) · 「이 사람은 안 와요」(DELETE — 저장한 동행자는 줄 · 여권 파일까지 지움, 빈 자리는 `stays.party_size` 만 줄임, 대표자 · 마지막 한 자리는 409) · 여권 사진(서버 multipart) · 동의(체크인 뒤 409 잠금). 화면 읽기는 라우트가 아니라 서버 페이지(`/r/[token]`)가 직접 한다(2026-11-02) |
| `GET\|POST /api/jobs/sync-stays` · `/retention` · `/remind` | 크론 | 크론 비밀값(`Authorization: Bearer <CRON_SECRET>`) | 동기화 · 자동 삭제 · 리마인드. `sync-stays` 는 우리 DB(`public.reservations`)만 읽어 stay 를 만든다 — **Beds24 호출 없음**(2026-11-01, 44 §14-6). ~~stay 생성 뒤 Beds24 Info 항목 쓰기 · `stays.beds24_info_synced_at`~~ 는 1차 제외 |
| Foldy `src/actions/checkin/*` | 직원 | Foldy 세션 + `checkin.*` | 현황 · 열람(서명 URL 1~5분, audit) · 확인함 · 대리 입력 · 내보내기 · 기기 · 건물 설정 |

- 속도 제한: `find` 기기당 분당 20회, `guest/[token]` IP 당 분당 30회, `enroll` 분당 5회. 토큰 32바이트 랜덤 · DB 엔 sha256. 모든 응답에 `contract_version`.
- 업로드: 클라이언트 → Supabase Storage 서명 URL 직접. 여권 JPEG 긴 변 2,400px · 품질 85(MRZ 가 읽히는 수준), 동영상 H.264 720p ≤ 5초 × n(상한 60초 · 약 1MB/초).
- **손님 웹 여권 업로드는 서명 URL 대신 서버 multipart(2026-11-02 구현)**: 폰이 긴 변 2,400px · JPEG 0.85 로 줄여 `POST /api/guest/[token]/passport`(`guest_id` · `file`) 로 보낸다 → 서버가 앞 바이트로 형식 확인(jpeg · png · webp) · 10MB 상한 · stay 당 시간 40장 → `checkin-documents` 에 올리고 `guest_documents` 줄. 다시 올리면 앞 줄에 `replaced_by` 를 채우고 앞 파일은 지운다. 사진 한 장이 작아(≈1MB) 서명 URL 왕복 두 번보다 단순하다. 태블릿 동영상은 크기가 커서 서명 URL(`/api/kiosk/upload-url`) 그대로.
- **`claim` 시도 기록(2026-11-02)**: `checkin.claim_attempts`(마이그레이션 `202611020002_checkin_guest_web.sql`, 운영 미적용) — IP 원문 없이 `HMAC(IP + 건물, CHECKIN_HASH_SECRET)`. 같은 키 10분 안 5회 실패 → 마지막 실패 + 10분까지 잠금(429 `locked`, `locked_until`), 같은 IP 분당 30회(429 `rate_limited`). 실패 응답은 `not_found` + 남은 횟수뿐 — 어느 칸이 틀렸는지 말하지 않는다.
- **링크 토큰은 찾을 때마다 하나 더 발급, 앞 링크도 그대로 열림(2026-11-02 수정)**: `checkin.stay_tokens`(토큰 sha256 · stay · 만든 때, stay 지우면 같이 지움) — 32바이트 base64url 원문은 한 번만 돌려준다. stay 당 최근 10개만 남긴다. 일행에게 보낸 링크가 다시 찾기로 닫히지 않게 하려는 것. `stays.pre_reg_token_hash` 는 쓰지 않는다.
- **실제 인원(2026-11-02)**: `stays.party_size` — 손님이 「이 사람은 안 와요」로 줄인 인원(null = 예약 인원). 명부 자리 = max(저장한 사람, party_size). 동의 화면은 저장한 사람 ≥ party_size 일 때만 열리고, 예약 인원 ≠ 명부 인원이면 「예약 N명 · 명부 M명 — 직원이 확인」 한 줄(막지 않음, 43 §8). 직원 화면 표시는 4단계.
- 새 환경 변수: `CHECKIN_HASH_SECRET`(시도 기록 HMAC 키, 없으면 `claim` 이 500).
- **기기 라우트 3개 구현(2026-11-02, 3단계 뼈대)**: `POST /api/device/enroll` — 8자리 코드(10분 · 한 번)를 조건부 update 한 번(`used_at is null` · `expires_at > now`)으로 써 버리고 `devices` 줄 + 기기 토큰(원문 1회, DB 엔 sha256) · 틀리면 404 `invalid_code` · 같은 IP 분당 5회(`claim_attempts`, 키 `device-enroll`) 넘으면 429. `POST /api/device/ping` — `last_seen` · 배터리 · 앱/OS 버전 저장, `settingsVersion`(= `property_settings.updated_at`, 없으면 `default`) 반환. `GET /api/kiosk/settings` — 기기 · `settingsVersion` · 계약. 기기 토큰이 없거나 틀리면 401 `unauthorized`, 해제된 기기는 401 `revoked`(`src/lib/device/auth.ts`).
- **찾기 · 인원 라우트 2개 구현(2026-11-02, 3단계 두 번째 묶음)**: `POST /api/kiosk/find`(기기 토큰) — 본문 `{mode:"code", code}`(6자리, 회사 전체에서 찾아 다른 건물이면 `other_building`, 같은 코드가 여럿이면 진행 중 → 최근 것) 또는 `{mode:"name", lastName, firstName, checkInDate}`(그 건물 · 그 날짜에서 이름이 **한 예약에만** 맞을 때만, 대소문자 무시). 열 수 있는 기간 = 도착일 도쿄 0시 ~ 체크아웃 날 도쿄 12시. 응답: 200 `found` / `checked_in`(+ `session_id` · 예약 언어 · stay — 방 · 날짜 · 박 · 인원 · 명부 사람별 빠진 칸), 404 `not_found` + `remaining`, 429 `locked` + `locked_until`, 409 `blocked` + `reason`(too_early(+ `check_in_date`) · expired · cancelled · other_building · busy). **틀림 잠금은 기기 단위**(`claim_attempts` 키 = hmac(`kiosk-find|기기 id`)): 10분 안에 연달아 5번 틀릴 때마다 1분, 맞히면 처음부터. 찾으면 **세션도 같이 잡는다**(`checkin.sessions` 5분 `locked_until`, 이미 있으면 늘림) — 다른 기기가 잡고 있으면 `busy`(FR-K17). 예약 언어는 Beds24 `raw_payload.lang` → ja · en · zh-Hans · ko(건물이 쓰는 언어면 앱이 그 언어로 바꿈). `POST /api/kiosk/party` `{sessionId, partySize}` — 이 기기가 잡은 세션으로만, 1~20 · 저장한 사람 수 이상, 「미리 체크인 끝」인데 빈 자리가 생기면 다시 `pending`. 실패 `session_gone` 409 · `invalid` 400. 따로 두려던 `POST /api/kiosk/session` 은 찾기가 세션을 잡아 이어 하기(`step_payload`)가 붙을 때 다시 본다. 순수 판단은 `src/lib/kiosk/find.ts`, DB 는 `src/lib/kiosk/store.ts`, stay 읽기는 웹과 같은 `loadStayById`(`src/lib/guest/store.ts`).
- **계약 확장(2026-11-02, `CONTRACT_VERSION` 은 1 그대로)**: `termsText` · `idleSecondsInput`(30~900) · `idleSecondsDone`(5~120) · `mrzAutofill` · `supportContacts`(phone · line · whatsapp) · `staffPin`. 계약은 `buildContract(property_settings 줄)`(`src/lib/contract/build.ts`)이 만든다 — 줄이 없으면 기본값(4개 언어 · 칸: 이름(로마자) · 주소 필수, 국적 · 여권 번호 · 전 숙박지 · 다음 행선지는 외국인만 필수). 이름(로마자)은 설정으로도 필수를 끌 수 없다. 칸 이름은 사전 `fields` 4개 언어.
- **직원 PIN(FR-K18)**: `property_settings.staff_pin_hash` = `pbkdf2-sha256$120000$<salt base64>$<hash base64>`(32바이트, `src/lib/device/pin.ts` `hashPin` · `verifyPin`, PIN 은 숫자 4~8자리). 계약의 `staffPin` 은 이 해시를 나눈 값(원문 PIN 은 어디에도 없음) — 태블릿이 오프라인에서도 같은 방식(Java `PBKDF2WithHmacSHA256`)으로 대조한다. PIN 을 정하는 화면은 4단계(건물 설정).

## 5. 태블릿 앱 (Kotlin · Jetpack Compose, `apps/checkin-kiosk`)

| 모듈 | 하는 일 | 라이브러리 · API |
| --- | --- | --- |
| `kiosk/` | 앱이 **Device Owner**(Android Enterprise QR 프로비저닝 또는 `adb shell dpm set-device-owner`) → `setLockTaskPackages` + `startLockTask()`; 홈 앱(HOME 카테고리)으로 등록해 재부팅 · 크래시 뒤 자동 복귀; 상태바 · 내비게이션 숨김; `FLAG_KEEP_SCREEN_ON`; 직원 해제 = 로고 5초 누름 + 건물 PIN(서버 해시 대조, 오프라인엔 마지막 받은 해시) | `DevicePolicyManager` · `LockTaskMode` · `BOOT_COMPLETED` |
| `camera/` | 전면 카메라 미리보기(Compose `PreviewView`), **여권 촬영**: 연속 AF · 탭 초점 · 여권 테두리 가이드 · 흔들림 · 밝기 경고 → `ImageCapture`(최대 해상도 → 2,400px 리사이즈); **동영상**: `VideoCapture<Recorder>` 720p H.264, `5초 × n` 자동 종료, 녹화 중 남은 초 표시 | CameraX 1.4 |
| `mrz/` | 촬영 직후 ML Kit 텍스트 인식 → MRZ 2줄(TD3) 찾기 → 파서(이름 · 국적 · 여권 번호 · 생년월일 · 성별 · 만료 · 체크섬 4개) → 칸 **자동 채움**(손님이 확인 · 수정) · `mrz_valid` 저장. 실패하면 손 입력 | ML Kit Text Recognition v2(온디바이스) · 자체 MRZ 파서(테스트 포함) |
| `data/` | Room DB(SQLCipher) 에 세션 · 명부 · 파일 경로 임시 보관 → **WorkManager 전송 큐**(순서 · 재시도 · 지수 백오프) → 서버 확인 뒤 로컬 삭제; Retrofit/Ktor + kotlinx.serialization; 기기 토큰은 `EncryptedSharedPreferences` | Room · SQLCipher · WorkManager · Ktor |
| `contract/` | `GET settings` JSON → 데이터 클래스. 화면 · 검증은 전부 이 모델을 보고 그림(칸 목록 · 필수 · 어린이 규칙 · 문구). 계약 버전 불일치면 「앱 업데이트 필요」 화면 | kotlinx.serialization |
| `ui/` | Compose, 세로 고정, Material 3 + 우리 토큰(Foldy 아이보리 · 네이비와 같은 색 — 디자인 시안에서 정함), 터치 타깃 ≥ 56dp, 단계 표시, 무조작 타이머(240초 · 30초), 4개 언어 리소스(`values-ja` · `values-en` · `values-zh-rCN` · `values-ko`, **문구 원본은 서버 계약**이고 앱 리소스는 오프라인 대비 복사본) | Jetpack Compose · Material 3 |
| 보안 | `FLAG_SECURE`(전 화면), 로컬 파일은 전송 뒤 즉시 삭제, 로그에 개인 정보 금지, 인증서 피닝(선택) | — |
| (2차 · 조건부) `nfc/` | 기기에 NFC 가 있고 회사가 원할 때만 — JMRTD BAC(MRZ 키) → DG1 · DG2 · Passive Auth | `IsoDep` · JMRTD |

- 최소 SDK: Android 10(API 29). 타깃: 최신. 태블릿 권장: RAM 3GB+ · 전면 카메라 5MP+ · (선택) NFC — 👤 기종 확인 뒤 확정.
- 화면 흐름(43 §4 · §8-6(3)): 언어 → 코드/이름 → 방 · 인원 확인 → 사람별(여권 촬영 → MRZ 자동 채움 → 확인 · 보충) → 약관 동의 → 얼굴 동영상 → 완료(방 번호 · 비밀번호 · 입실 안내) → 30초 뒤 처음.
- 디자인 시안: 태블릿 7~8 화면 + 사전 등록 웹 + Foldy 직원 화면을 **별도 캔버스**로(메모리 규칙), 구현 전 컨펌.

### 5-1. 뼈대 구현 상태 (2026-11-02, 3단계 첫 묶음)

지은 것: 기기 등록(E) · 계약 받기 · 잠금 · 언어 고르기(G1) · 메뉴(G2) · 직원 PIN · 직원 메뉴 · 무조작 복귀 · 오프라인 표시. **두 번째 묶음(2026-11-02)**: 예약 찾기(T1 이름 + 날짜 · T1k 6자리 코드) · 못 찾음(T1x, 남은 횟수 · 잠금 초 세기) · 막힘(T1b 사유별) · 이미 체크인(T1c) · 명부 확인(T2 방 · 날짜 · 인원 ± · 사람별 상태) — `ui/Lookup.kt` · `contract/Lookup.kt`. 찾은 예약 언어가 건물 언어면 화면 언어를 그걸로 바꾼다. 날짜 고르기는 오늘 · 어제 · 다른 날(어제 ~ +30일, ‹ › 하루씩). 카메라 · MRZ · 동영상 · 완료 · 전송 큐 · 직원 호출 화면은 다음 묶음(T1c 「방 번호 보기」 · T2 「여권 찍기 · 시작」 · 「직원 호출」 · 메뉴의 나머지 타일은 지금 「다음 단계에서 만들어요」 자리로 간다).

| 정한 것 | 내용 · 위 표와 다른 점 |
| --- | --- |
| 패키지 · 도구 | `com.harutokyo.checkin.kiosk` · AGP 9.5.0(Kotlin 내장) · Kotlin compose/serialization 플러그인 2.4.21 · Gradle 9.8.2 · Compose BOM 2026.09.00 · compileSdk/targetSdk 37 · minSdk 29 · Java 17. 빌드는 Android Studio 의 JBR 로(`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`) — 이 Mac 의 기본 Java 27 은 Gradle 9.8 이 못 쓴다. `local.properties`(sdk.dir)는 각자 만든다(gitignore). |
| 서버 주소 | 빌드 때 `-PcheckinApiBase=https://…`. 없으면 `http://127.0.0.1:3100` + `adb reverse tcp:3100 tcp:3100`(이 Mac 의 `apps/checkin` 개발 서버). **Android 17 은 앱이 사설 주소(에뮬레이터의 `10.0.2.2`)로 나가는 것을 막는다** — 처음엔 10.0.2.2 로 했다가 연결이 안 돼 바꿨다. http 는 `127.0.0.1` 에만 허용(network_security_config), 운영은 https 만. |
| 통신 | Ktor 대신 `HttpURLConnection` + kotlinx.serialization(`data/Api.kt`) — 부르는 곳이 5개(찾기 · 인원 포함)라 라이브러리를 더하지 않았다. 업로드가 붙을 때 다시 본다. 찾기 요청은 sealed `FindQuery` 를 `classDiscriminator = "mode"` 로 보내 서버 zod 모양과 같다. |
| 토큰 · 설정 사본 | `EncryptedSharedPreferences`(폐기 예정) 대신 Android Keystore AES-GCM 키로 직접 암호화(`data/TokenVault.kt`). 기기 토큰과 마지막 계약 JSON 을 넣어 두고, 켤 때 사본으로 바로 G1 을 띄운 뒤 서버에서 새로 받는다(오프라인이면 사본으로 계속 + 위에 「오프라인」 줄). 백업 · 기기 이전에서 빠짐(`allowBackup=false` · `data_extraction_rules.xml`). |
| 신호(ping) | WorkManager(최소 15분) 대신 ViewModel 코루틴 5분 반복. `settingsVersion` 이 바뀌면 계약을 다시 받는다. 401 이면 토큰 · 사본을 지우고 등록 화면 + 「이 기기는 해제됐어요」. |
| 잠금 | 앱이 Device Owner 일 때만 `setLockTaskPackages` · `LOCK_TASK_FEATURE_NONE` · HOME 기본 앱 고정 · `startLockTask`(`kiosk/Kiosk.kt`). Device Owner 가 아니면(개발 에뮬레이터) 시스템 바만 숨긴다. 뒤로 가기는 앱이 먹고 G1 로. 직원 메뉴의 「잠금 풀기 · 다시 잠그기」는 Device Owner 일 때만 보인다. **실기기 Device Owner 잠금은 아직 확인 못 함**(👤 태블릿 · 프로비저닝 뒤). |
| 직원 해제 | 표지 5초 누름 → PIN(숫자판, 기기에서 대조) → 직원 메뉴(기기 이름 · 건물 키 · 설정 다시 받기 · 잠금 풀기/다시 잠그기 · 기기 다시 등록 · 닫기). 직원 화면은 손님이 고른 언어가 아니라 **기기 언어**로. PIN 이 아직 없으면 「PIN 이 아직 정해지지 않았어요」. **PIN 5번 틀리면 1분 잠금**, 또 5번 틀릴 때마다 두 배(최대 15분, `kiosk/PinGuard.kt`) — 숫자판이 꺼지고 남은 초를 보인다. 맞히면 처음부터. 잠금은 ViewModel 에 있어 PIN 화면을 닫았다 열어도 남는다(앱을 다시 켜면 풀림 — 표지 5초 누름이 있어 받아들임). 「기기 다시 등록」은 한 번 더 묻는다(「이 기기의 등록을 지울까요?」 · 취소 / 등록 지우기 — 되돌릴 수 없고 새 등록 코드가 있어야 해서). 「잠금 풀기 · 다시 잠그기」 글자는 누를 때마다 실제 상태를 다시 읽는다. |
| 화면 · 글자 | 시안 G 「밤의 키오스크」 토큰(`ui/Theme.kt` — 사전 등록 웹과 같은 색, 위 `ui/` 줄의 아이보리 · 네이비가 아님) · 시스템 글꼴. 손님 언어는 기기 설정을 바꾸지 않고 화면 안에서만(`Localized`) — 그래서 언어별 분할 설치를 껐다(`bundle.language.enableSplit=false`). 문구는 앱 리소스 4개 언어(`values`=ja · `values-en` · `values-zh-rCN` · `values-ko`). G1 제목 · 「Call staff」는 시안대로 여러 언어를 한 줄에. 줄바꿈: 일본어는 구절 단위(`LineBreak.WordBreak.Phrase`), 한국어는 띄어쓰기에서만(글자 사이에 U+2060 을 넣는 `keepKoreanWords()` — CSS `keep-all` 과 같은 효과, `str()` 로 모든 문구에). 영어는 복수형 경고를 피하려고 숫자를 끝에 둔다(「Seconds left: 58」). |
| 무조작 · 화면 | 손을 떼고 `idleSecondsInput`(기본 240초) 지나면 G1 · 언어 ja 로 — **직원 화면(PIN · 직원 메뉴)이 열려 있어도 닫는다**(직원이 열어 두고 떠나도 손님에게 남지 않게). 화면 항상 켜짐. `FLAG_SECURE`(캡처 막기)는 **배포판만** — 개발판은 화면 확인 캡처가 필요하다. 세로 고정은 Android 16+ 큰 화면에서 무시될 수 있다(lint 경고) — 그래서 **가로 · 큰 글자에서도 깨지지 않게** 지었다: 화면마다 스크롤 한 겹 + 아래 버튼 고정(`ScrollPage`), 넓으면(가로) G1 은 2열 · G2 는 체크인 타일 옆에 작은 타일 둘, 버튼 · 타일 · 숫자 칸은 고정 높이 대신 최소 높이(글자가 커지면 같이 커짐), 한 줄의 타일은 높이를 맞춤. 회전 · 화면 크기 변경은 액티비티를 다시 만들지 않는다(`configChanges`). 글자 크기를 바꾸면 다시 만들어져 G1 로 간다(받아들임). 실기기에서 회전을 확인하고, 필요하면 Device Owner 정책으로 묶는다. 앱 아이콘은 아직 없음. |
| 테스트 | JUnit 16개(두 번째 묶음에 4개 — 찾기 요청 모양 `mode` · found/checked_in · 실패 응답 · 자리 상태): PIN 잠금(5번 · 두 배 · 15분 끝 · 맞히면 처음부터) · 한국어 줄바꿈 · PIN 대조(서버 `hashPin` 이 만든 값 그대로 · 틀린 PIN · PIN 없음 · 다른 방식) · 계약 읽기(서버 `buildContract(null)` 출력을 `test/resources/contract-default.json` 으로 — 계약이 바뀌면 다시 뽑는다 · 모르는 칸 무시). |

## 6. 손님 사전 등록 웹 (`apps/checkin`, Next.js)

- Next.js 16 App Router · React 19 · Tailwind v4 — Foldy 와 같은 버전(의존성은 자기 `package.json`). 폰 세로 기준, 사진은 `<input capture=\"environment\">`(뒷카메라) 또는 파일, 클라이언트 리사이즈(긴 변 2,400px).
- 생년월일은 연 · 월 · 일 세 칸(화면 언어로 표시, 영어는 월 · 일 · 연) — 휴대폰 기본 날짜 칸은 기기 언어로 나오고 오래된 연도 넘기기가 힘들어 바꿨다(2026-11-02).
- i18n: `ja` 기본, en · zh-Hans · ko — 사전 파일은 `apps/checkin/src/lib/i18n/*.json`(계약 문구와 같은 키). Foldy `src/lib/i18n.ts` 는 쓰지 않는다.
- 사전 등록에서는 MRZ 판독을 **하지 않는다**(브라우저 OCR 품질 문제) — 손님이 사진만 올리고 칸은 손으로; 태블릿에서 여권을 다시 찍으면 MRZ 로 자동 보정 · 대조(직원 화면에 「사전 입력 ≠ MRZ」 표시).
- 상태는 서버가 원본, 단계마다 저장. 체크인 뒤에는 읽기 전용.

## 7. 배포 · 운영

- **웹 · API**: Vercel 프로젝트 `foldy-checkin`(Root Directory `apps/checkin`, 리전 `hnd1`, 환경 변수 Foldy 와 별도). 도메인 `checkin.<자체 도메인>`(19 D1 때).
- **태블릿 앱**: Android Enterprise(무료) — Managed Google Play **비공개 앱**으로 배포 · 업데이트, 키오스크 정책(단일 앱 · 설정 잠금 · 원격 재시작). 1차 한 건물 병행은 서명 APK 사이드로드 + `adb dpm set-device-owner` 로 시작해도 된다. 서명 키는 Foldy 앱 키와 **별개**(19 C4 와 같이 보관).
- **모니터링**: 기기 `ping` 5분, 1시간 끊기면 관리자 기기 목록 경고(알림은 막바지 일괄). 앱 크래시는 Firebase Crashlytics **대신** 자체 `POST /api/device/log`(개인 정보 없는 스택만) — 외부 SDK 최소화.
- **버전**: 앱 `contract_version` 과 서버 계약 버전이 다르면 앱이 「업데이트 필요」 화면 — 서버는 이전 버전 계약을 1개 더 유지(점진 배포).

## 8. 테스트

- 서버(`apps/checkin`): 체크인 가능 기간(도쿄 날짜) · 코드 발급 · 보존 계산 · 계약 검증(국적 · 일본 주소 · 어린이) · 막는 경우 — Vitest. 라우트 통합 — 로컬 Supabase.
- 앱(`apps/checkin-kiosk`): MRZ 파서 단위 테스트(체크섬 · 실제 샘플 형식) · 계약 모델 직렬화 · 전송 큐 재시도 — JUnit. Compose UI 테스트는 핵심 흐름 1개.
- 기기: 실제 태블릿 체크리스트 — 잠금 · 재부팅 복귀 · 여권 초점(어두운 로비) · MRZ 성공률(여권 10종) · 동영상 5초 × 4 · 와이파이 끊고 입력 → 복구 전송 · PIN 해제 · 240/30초 복귀.
- **Foldy 회귀**: 단계마다 루트 `npm run lint` · `npm run build` 가 전과 같은지(43 §8-9).

## 9. 단계 (코드 착수는 사용자 컨펌 뒤)

1. 루트 세 줄(tsconfig exclude · eslint ignore · vitest exclude) · `apps/checkin` 뼈대 · `checkin` 스키마 마이그레이션(로컬) · 계약 스키마(zod) · `sync-stays` — Foldy 빌드 확인
   - 2026-11-02 진행: 루트 세 줄 ✅ · 뼈대(`/p/[building]` 시작 화면 · `/api/health` · 4개 언어 사전 · 서비스 클라이언트) ✅ · 마이그레이션 초안 ✅(운영 미적용) · 계약 스키마 ✅ · `sync-stays` ✅(아래 「sync-stays 동작」, 운영 연결 전)
2. 사전 등록 웹(명부 · 여권 업로드 · 동의) · 링크 발급 · 리마인드 크론
   - 2026-11-02 진행: 찾기(`/p/[building]` — 예약 번호 또는 전화 뒤 4자리 · 못 찾음 · 잠금) ✅ · 명부(`/r/[token]`) · 사람별 입력(`…/guest/[id]`) · 여권 사진 · 동의(`…/terms`) · 완료(코드) · 체크인 뒤 읽기 전용 ✅ · 4개 언어 ✅ · 단위 테스트 37개 ✅. **리마인드 크론은 보류**(메시지 보낼 길이 아직 없음 — L0 만). 실제 DB 왕복 테스트 · 운영 연결 전
3. 태블릿 앱: 뼈대(Compose · 기기 등록 · 계약 받기 · 잠금) → 찾기 · 명부 → 카메라 · MRZ → 동영상 → 완료 → 오프라인 큐
   - 2026-11-02 진행: 서버 기기 라우트 3개(`enroll` · `ping` · `kiosk/settings`) · 계약 확장 · 직원 PIN 해시 ✅(테스트 47개) · 앱 뼈대(기기 등록 · 계약 받기 · 잠금 · G1 · G2 · 직원 PIN · 직원 메뉴 · 무조작 복귀 · 오프라인 사본) ✅(§5-1) · JUnit 12개 ✅ · 점검 뒤 고침 5개(PIN 잠금 · 직원 화면 무조작 닫기 · 잠금 글자 · 가로 · 큰 글자 · 다시 등록 확인) ✅ · 에뮬레이터(800×1280 · 1280×800 · 글자 1.3×/2×)에서 가짜 서버로 등록 → G1 → 4개 언어 메뉴 → PIN 틀림/맞음 → 직원 메뉴 → 다시 등록 · 오프라인 시작 · 해제된 기기 확인 ✅. 2026-11-02 두 번째 묶음: `kiosk/find` · `kiosk/party` ✅(테스트 58개) · 찾기 · 못 찾음 · 막힘 · 이미 체크인 · 명부 화면 ✅(JUnit 16개) · 에뮬레이터 + 가짜 서버로 한국어 이름 찾기 → 명부 → 인원 ± (저장한 사람 아래로 못 내림), 코드 4가지(이미 체크인 · 도착일 전 · 다른 기기 · 다른 건물), 5번 틀림 → 1분 잠금 초 세기, 일본어 예약 → 화면 일본어, 가로 1280×800 ✅. 남음: 카메라 · MRZ → 동영상 → 완료 → 오프라인 큐 · 직원 호출, 실기기 Device Owner 잠금, 실제 DB 왕복
4. Foldy 직원 화면(PC · 모바일) · 권한 키 · 내보내기 · 기기 · 건물 설정
5. 보존 크론 · 감사 기록 · 기기 체크리스트 · 한 건물 병행(43 §8-20)
