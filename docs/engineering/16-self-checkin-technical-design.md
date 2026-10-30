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
supabase/migrations/2026…_checkin_schema.sql    ← 같은 이력에 추가만 (43 §8-9)
Foldy(루트) src/app/admin/checkin · src/app/mobile/checkin · src/actions/checkin   ← 직원 화면 (추가만, 4단계)
```

- 손님 쪽 트래픽은 전부 `apps/checkin` 도메인(API 포함). 태블릿 앱도 같은 API 를 기기 토큰으로 부른다. Foldy 도메인에는 손님 · 기기 경로가 없다.
- **Beds24 쓰기는 Info 항목 1종만**(44 §14-5): `apps/checkin` 이 Beds24 토큰을 **읽기 전용 + bookings 쓰기** 범위로 따로 발급받아 환경 변수에 둔다(Foldy 의 토큰과 공유하지 않음).
- `public` 스키마는 **읽기 전용**(`reservations` · `properties` · `rooms` · `property_operation_infos`). `checkin` → `public` FK 없음(id 값만 저장).
- **계약(contract) 하나**: 명부 칸 · 필수(국적 · 일본 주소 여부에 따라) · 어린이 규칙 · 막는 경우 코드 · 문구 4개 언어 · 약관 버전 · 동영상 초를 서버가 `GET /api/kiosk/settings`(기기) · `GET /api/guest/[token]`(손님) 에 JSON 으로 담아 준다. 태블릿(Compose) 과 웹(React) 은 **그리기와 입력만** 하고, 검증의 최종 판정은 서버(`PUT guests` 가 계약으로 다시 검사). 계약 스키마는 `apps/checkin/src/lib/contract/schema.ts`(zod) 가 원본이고, Kotlin 모델은 그 JSON 과 1:1(수동 유지 · 계약 버전 번호로 호환성 검사).

## 3. 데이터 모델 — `checkin` 스키마

| 표 | 핵심 열 | 메모 |
| --- | --- | --- |
| `checkin.devices` | id · organization_id · property_key · name · token_hash · registered_by · last_seen_at · revoked_at · app_version · device_model · os_version · battery | 기기 토큰(sha256) — 근태 `attendance_trusted_devices` 와 같은 방식 |
| `checkin.enrollment_codes` | code(8자리) · property_key · expires_at(10분) · used_at | 기기 등록 1회용 |
| `checkin.property_settings` | property_key · languages · welcome_text(jsonb 4개 언어) · terms_text(jsonb) · terms_version · required_fields(jsonb) · video_seconds_per_guest(5) · support_contacts(jsonb) · idle_seconds_input(240) · idle_seconds_done(30) · verification_method(`video` \| `staff_call` \| `auto_match`) · staff_pin_hash · mrz_autofill(bool) | 43 §8-6(3) 건물별 설정 — 계약의 재료 |
| `checkin.stays` | id · organization_id · reservation_group_key(`original_reservation_id`) · property_key · check_in_date · check_out_date · guest_count_expected · checkin_code(6자리, org 안 unique · 기간 지나면 재사용) · status(`pending` \| `pre_registered` \| `in_progress` \| `checked_in` \| `expired` \| `cancelled`) · pre_reg_token_hash · pre_reg_sent_at · reminded_at · checked_in_at · verified_at · verified_by · retain_until | 예약 묶음 하나 = 체크인 하나(43 §8-13) |
| `checkin.stay_rooms` | stay_id · reservation_id(public) · room_label · room_id | 여러 방 |
| `checkin.guests` | id · stay_id · stay_room_id · is_representative · guest_type(`adult` \| `child`) · name_roman · name_kana · nationality(ISO 3166-1 alpha-3) · has_japan_address · address · postal_code · phone · email · birth_date · gender · occupation · passport_number · passport_expiry · prev_stay · next_dest · source(`beds24` \| `guest` \| `staff` \| `mrz`) · mrz_raw · mrz_valid(bool) · no_passport_reason | `mrz_*` = 판독 원문 · 체크섬 결과(직원이 손 입력과 비교) |
| `checkin.guest_documents` | id · guest_id · kind(`passport` \| `face_video` \| `id_card`) · storage_path · byte_size · width · height · duration_s · captured_at · captured_on(`kiosk` \| `guest_web` \| `staff`) · device_id · replaced_by · retain_until · sha256 | 비공개 버킷 `checkin-documents`; sha256 로 전송 무결성 |
| `checkin.consents` | stay_id · guest_id(대표자) · terms_version · agreed_at · locale · device_id | 약관 동의 |
| `checkin.sessions` | id · stay_id · device_id · started_at · last_step · step_payload(jsonb) · finished_at · abandoned_at · locked_until | 태블릿 진행(이어 하기 · 동시 잠금 — 다른 기기는 `locked_until` 안엔 거부) |
| `checkin.audit_log` | actor_user_id \| device_id · action · stay_id · guest_id · document_id · at · meta | 열람 · 수정 · 확인 · 내보내기 · 삭제 · 기기 등록 |
| `checkin.deletions` | stay_key · deleted_at · counts | 자동 삭제 기록(개인 정보 없음) |

- **RLS**: `checkin.*` 는 **직원 읽기 정책만**(`public.memberships` + `checkin.view` / `checkin.documents` 권한 — Foldy 권한 표 그대로 읽음). 손님 · 기기 쓰기는 전부 서버 라우트(서비스 롤). anon 정책 없음, delete 정책 없음(43 §8-14). `audit_log` 는 insert 만.
- **stays 생성**: Foldy Beds24 웹훅은 손대지 않는다. `apps/checkin` 의 `jobs/sync-stays`(5분 크론) 가 `public.reservations` 의 오늘 −1 ~ +30일 예약을 읽어 `stays` · `stay_rooms` 를 만들고 코드를 발급한다. 취소 · 날짜 · 인원 변경도 여기서 따라간다(체크인 뒤 변경은 기록만).
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
| `POST /api/guest/claim` | 손님 웹(건물 고정 링크 `/p/<건물>`) | 없음(공개) — 이름 + 체크인 날짜 + 전화 뒤 4자리/OTA 예약 번호 3요소 | 일치하는 stay 가 **하나**면 토큰 발급(원문 1회) · IP · 건물당 속도 제한 · 5회 실패 10분 잠금 · 불일치 시 어떤 것이 틀렸는지 말하지 않음 |
| `GET /api/guest/[token]` · `PUT …/guests` · `POST …/consent` | 손님 웹 | 링크 토큰 | 사전 등록(계약 JSON 포함) · 저장 · 동의(체크인 뒤 잠금) |
| `POST /api/jobs/sync-stays` · `/retention` · `/remind` | 크론 | 크론 비밀값 | 동기화 · 자동 삭제 · 리마인드. **`sync-stays` 는 stay 를 만든 뒤 Beds24 에 `POST /bookings {id, infoItems:[{code:"FOLDY_CHECKIN", text}]}` 1회**(Foldy 루트 `src/lib/beds24/calendar-client.ts` 의 수정 호출과 같은 토큰 · 재시도 규칙을 **복사**해 `apps/checkin` 안에 둔다 — 루트 코드 import 없음). 실패는 `stays.beds24_info_synced_at` 비움 + 다음 틱 재시도, 체크인에는 영향 없음 |
| Foldy `src/actions/checkin/*` | 직원 | Foldy 세션 + `checkin.*` | 현황 · 열람(서명 URL 1~5분, audit) · 확인함 · 대리 입력 · 내보내기 · 기기 · 건물 설정 |

- 속도 제한: `find` 기기당 분당 20회, `guest/[token]` IP 당 분당 30회, `enroll` 분당 5회. 토큰 32바이트 랜덤 · DB 엔 sha256. 모든 응답에 `contract_version`.
- 업로드: 클라이언트 → Supabase Storage 서명 URL 직접. 여권 JPEG 긴 변 2,400px · 품질 85(MRZ 가 읽히는 수준), 동영상 H.264 720p ≤ 5초 × n(상한 60초 · 약 1MB/초).

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

## 6. 손님 사전 등록 웹 (`apps/checkin`, Next.js)

- Next.js 16 App Router · React 19 · Tailwind v4 — Foldy 와 같은 버전(의존성은 자기 `package.json`). 폰 세로 기준, 사진은 `<input capture=\"environment\">`(뒷카메라) 또는 파일, 클라이언트 리사이즈(긴 변 2,400px).
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

1. 루트 두 줄(tsconfig exclude · eslint ignore) · `apps/checkin` 뼈대 · `checkin` 스키마 마이그레이션(로컬) · 계약 스키마(zod) · `sync-stays` — Foldy 빌드 확인
2. 사전 등록 웹(명부 · 여권 업로드 · 동의) · 링크 발급 · 리마인드 크론
3. 태블릿 앱: 뼈대(Compose · 기기 등록 · 계약 받기 · 잠금) → 찾기 · 명부 → 카메라 · MRZ → 동영상 → 완료 → 오프라인 큐
4. Foldy 직원 화면(PC · 모바일) · 권한 키 · 내보내기 · 기기 · 건물 설정
5. 보존 크론 · 감사 기록 · 기기 체크리스트 · 한 건물 병행(43 §8-20)
