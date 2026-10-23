# 42. 재류카드 IC 칩 진위 확인 (NFC) — 설계

> **상태: 나중에 구현(2026-10-23 사용자 「nfc는 나중에 구현 예정으로 미루자」)** — 설계만 보관.

> 상태: **설계만(2026-10-23) · 구현 안 함 · 사용자 결정 대기**. 41 「재류카드」의 (뒤) 단계 「앱 NFC 로 IC 칩 진위 확인」을 조사 · 설계한 문서다.
> 앞 단계: `docs/product/41-residence-card-workflow.md`(R2 = 사진 + 글자 읽기 + 관리자 확인). 스토어 신고 영향: `docs/planning/17-app-release-plan.md`
> 「스토어 개인정보 신고 — 재류카드(2026-10-23)」.
> 근거는 출입국재류관리청(ISA) 공개 사양서를 직접 받아 읽었다(아래 출처). 확인하지 못한 것은 「확인 필요」로 적었다.

## 1. 목표

- 직원이 R2 에서 카드 사진을 찍은 뒤 **카드를 휴대폰 뒤에 대면**, 앱이 IC 칩을 읽어
  1. 칩의 **전자 서명**을 ISA 루트 인증서까지 검증해 「ISA 가 발급한 데이터」인지 확인하고
  2. 칩 데이터와 사진 · 읽은 칸(R2)을 **대조**해 위조 · 변조(사진만 바꾼 카드 등)를 잡는다.
- 관리자 화면 「신분 서류」 칸에 **「IC 칩 확인됨 / 칩 불일치 / 칩 미확인」** 을 보이게 한다. 지금의 「失効情報照会 바로가기」(번호 실효 확인)와 함께 쓴다.
- 지금 종이 · 사진 확인으로는 못 잡는 **정교한 위조 카드**(券面만 위조)를 잡는 것이 목적이다. ISA 도 실효 조회만으로는 부족하고 「実在する番号を悪用した偽造カードもある」라며
  읽기 앱 · 위조 방지 확인과 같이 쓰라고 안내한다([ISA 읽기 앱 · 실효 조회 지원 페이지](https://www.moj.go.jp/isa/applications/procedures/rcc-support.html)).

## 2. 가능한가 — 결론

**가능하다. 단 앱(iOS · Android)에서만, 웹 · PWA 에서는 안 된다.**

| 판단 | 근거 |
| --- | --- |
| 사양이 공개돼 있다 | ISA 가 「民間企業等において、カードの偽変造等確認を容易に行うことができるようにするため」 IC 칩 읽기 사양을 공개. 사양에 따라 소프트웨어를 만들어 파는 것도 막지 않는다고 명시([사양 공개 페이지(1세대)](https://www.moj.go.jp/isa/applications/disclosure/120424_01.html), [2세대 · 특정 재류카드](https://www.moj.go.jp/isa/publications/resources/120424_01_00003.html)) |
| 특수 비밀값이 필요 없다 | 접근 키 = **카드 번호(12자리)**. 공개 루트 인증서로 서명 검증. (특정 재류카드만 공개된 「RSA 配送鍵」이 추가로 필요 — 아래 §3-3) |
| 폰이 읽을 수 있다 | 칩 = ISO/IEC 14443 **Type B**. ISA 공식 「在留カード等読取アプリケーション」이 **iOS 16 이상 · Android 12 이상**, NFC Type B 지원 폰에서 동작(iPad 불가) — 같은 일을 하는 앱이 이미 스토어에 있다 |
| 웹은 불가 | Web NFC 는 NDEF 만 다루고 ISO-DEP APDU 를 못 보낸다 → **Capacitor 네이티브 플러그인 필요**. 웹 · PWA 사용자는 지금처럼 사진 + 실효 조회 |

## 3. 칩 사양 요약 (ISA 공개 사양서 직접 확인)

### 3-1. 카드 세대 (2026-06-14 부터 바뀜)

| 세대 | 언제 | 사양서 |
| --- | --- | --- |
| 1세대 재류카드 | 2012-07 ~ 2026-06-13 발급분(만료일까지 유효) | 「在留カード等仕様書（一般公開用）」 令和6年3月 — [PDF](https://www.moj.go.jp/isa/content/001414093.pdf) |
| **2세대 재류카드** | 2026-06-14 새 양식 도입과 함께 발급되는 것으로 판단(ISA 페이지는 「公布から2年以内の政令で定める日」로만 적음 — 날짜 일치는 **확인 필요**, 칩의 카드 종별로 어차피 판별됨) | 「第２世代在留カード等仕様書（一般公開用）」 2026-04 수정 — [PDF](https://www.moj.go.jp/isa/content/001460711.pdf) |
| **특정 재류카드**(마이넘버 카드 일체형, 선택) | 2026-06-14 부터 | 「特定在留カード等仕様書（一般公開用）」 2026-04 수정 — [PDF](https://www.moj.go.jp/isa/content/001460712.pdf) |

- 2026-06-14 새 양식 카드는 券面에 **「在留期間」「許可の種類」「許可年月日」「交付年月日」이 인쇄되지 않는다**([ISA 「在留カードとは」](https://www.moj.go.jp/isa/applications/procedures/whatzairyu_00001.html)).
  사진 글자 읽기(R2)로는 이 칸을 못 얻고, 칩에는 들어 있다(2세대 `DF1/EF02` — 아래). → **NFC 가 2세대 카드에서는 정보 수집 수단으로도 의미가 있다.**
  (R2 가 쓰는 「재류기간 만료일」은 券面에 남는지 **확인 필요** — ISA 페이지가 「在留期間」만 적고 「満了日」은 따로 언급하지 않음. R2 OCR 프롬프트 · 칸 점검 대상.)
- 2세대 칩 「카드 종별」(`MF/EF02`, 태그 `C1`): `05` 2세대 재류카드 · `06` 2세대 특별영주자증명서 · `07` 특정 재류카드 · `08` 특정 특별영주자증명서. 1세대는 1바이트 `1`/`2`.
  → 칩을 읽으면 세대를 자동 판별할 수 있다.

### 3-2. 파일 구조 · 접근 (1세대 · 2세대 공통 틀)

- DF 는 16바이트 AID 로 SELECT:
  - DF1 `D392F0004F0200000000000000000000`
  - DF2 `D392F0004F0300000000000000000000`
  - DF3 `D392F0004F0400000000000000000000`
  - (특정 재류카드만) 재류 AP `D392F0004F0100000000000000000000` 를 먼저 SELECT — 마이넘버 카드 안의 한 애플리케이션이라서
- `MF/EF01`(사양 버전) · `MF/EF02`(카드 종별)는 **인증 없이** 읽힌다. 나머지는 **「在留カード等番号による認証」** 이 필요하고, DF1 은 추가로 **보안 메시징(SM)** 필수.
- 인증 순서(사양서 3.5.2 · 별첨 1): `GET CHALLENGE` → `MUTUAL AUTHENTICATE`(세션 키 교환) → `VERIFY`(P2 `86`, 카드 번호를 세션 키로 암호화해 보냄) → `READ BINARY with SM`.
  - 키: **Kenc = Kmac = SHA-1(카드 번호 12바이트) 앞 16바이트**. 세션 키 KSenc = SHA-1(K.IFD ⊕ K.ICC ‖ `00000001`) 앞 16바이트.
  - 암호: 1세대 **TDES 2-key CBC**, 2세대 · 특정 **AES-128 CBC + CMAC(AES-128)**. 특정 재류카드는 세션 키 교환에 공개된 **RSA 配送鍵**을 씀.
  - 즉 **카드 번호(券面 · OCR 로 얻는 값)가 열쇠**다. R2 가 이미 카드 번호를 읽으므로 사용자가 따로 입력할 것이 없다(틀리면 고쳐서 다시).
- 읽기 응답이 크다(1세대 券面 이미지 7,004바이트, 2세대 이름 · 얼굴 5,508바이트). 사양 예시는 **확장 길이 APDU**(Le 3바이트)로 한 번에 읽는다. ISA PC 판도
  「拡張APDU対応の非接触型ICカードリーダライタ」를 요구 → **폰마다 확장 APDU 지원 여부가 위험 요소**(§8).

### 3-3. 칩에 들어 있는 것

| | 1세대 | 2세대 · 특정 |
| --- | --- | --- |
| 券面 글자 | **이미지만** — 券面(표) 이미지(MMR 압축 TIFF, 인쇄 틀 · 얼굴 제외) | **글자 데이터** — 유효기간 만료일 · 생년월일 · 성별 코드 · 국적 코드 · 재류자격 코드 · 재류기간 · 허가 종류 · 허가일 · 취로 제한 코드 · **재류기간 만료일** + **카드 번호**(`DF1/EF01`) |
| 이름 | 券面 이미지 안 | **이름 이미지**(MMR TIFF) — 글자 아님 |
| 얼굴 | 얼굴 사진(JPEG 2000 컬러) | 얼굴 사진(JPEG 2000 컬러) |
| 주소 | 住居地(뒷면 추기) **글자** + 시정촌 코드 + 추기일 | **주소 이미지**(MMR TIFF) |
| 뒷면 | 자격외활동 포괄 · 개별 허가란(글자), 갱신 신청 중 여부 | 자격외활동 허가 코드(`1` 주 28시간 · 풍속 불가 / `2` 주 28시간 · 교육 등) · 포괄 허가 기한 · 개별 허가 유무 · 갱신 신청 중 여부 |
| 서명 | `DF3/EF01`: 체크 코드(RSA 2048 서명) + X.509 공개키 인증서 | `DF3/EF01`: 체크 코드(**ECDSA P-384, SHA256withECDSA**) + X.509 인증서 |
| 서명 대상 | 券面 이미지 + 얼굴 사진 | 이름 이미지 + 券面 기재 사항(글자) + 얼굴 사진 |

- 1세대 서명 검증(사양서 3.4.3.1): 인증서의 RSA 공개키로 체크 코드를 풀어(PKCS#1 v1.5) 나온 SHA-256 값과, 券面 이미지(7,000) ‖ 얼굴(3,000) 값을 이어 붙인 SHA-256 을 비교.
  인증서는 ISA **루트 CA 인증서**(공개, 1세대 4개 · 2세대 1개 · 시험용 1개)로 검증한다.
- 16세 미만(1세대) · 1세 미만(2세대) 카드는 얼굴 · 서명이 비어 있다 → 서명 검증 불가 = 「칩 읽힘 · 서명 없음」으로 표시. 직원은 해당 없음에 가깝다.
- **한계(중요)**: 이 서명은 「데이터가 ISA 가 쓴 그대로」만 증명한다(수동 인증). 칩 자체가 진짜인지 증명하는 능동 인증(Active Authentication)은 사양에 없다 →
  **진짜 카드의 칩 데이터를 그대로 복제한 칩**은 서명이 통과한다. 그래서 반드시 **칩의 얼굴 · 이름 · 번호가 찍은 사진 · 본인과 같은지 대조**를 함께 한다.

## 4. 흐름 (사용자 · 관리자)

```
R2 촬영(앞 · 뒤) → 글자 읽기 → 확인 · 고치기(카드 번호 확정)
  → [앱 · NFC 있는 폰] 「IC 칩 확인」 화면: 「카드를 휴대폰 뒷면 위쪽에 대 주세요」
      → 카드 종별 읽기(세대 판별) → 카드 번호로 인증 → DF1 · DF2 · DF3 읽기
      → 서버로 칩 원본 바이트 전송 → 서버가 서명 검증 + 대조 → 결과 저장
  → 완료
  (웹 · PWA · NFC 없는 폰 · 「나중에」 → 지금처럼 끝. 관리자 화면에 「칩 미확인」)
```

- **카드 번호 = 키**. 인증이 실패하면(`63 00`) 「카드 번호가 카드와 다른 것 같아요」 → 확인 화면의 번호 칸으로 돌아가 고치고 다시. 잘못된 번호로 연속 실패해도 칩이 잠긴다는 기술은
  사양서에서 찾지 못함 — **확인 필요**(잠금이 있으면 재시도 횟수를 앱에서 제한).
- iOS 는 시스템 NFC 시트가 뜬다(문구 지정 가능). 세션은 연결 후 약 20초에 끊긴다는 개발자 포럼 보고가 있다(Apple 공식 아님) → 읽기는 한 세션에 끝내고, 끊기면 「다시 대 주세요」.
- 관리자 「신분 서류」 칸: `IC 칩 확인됨`(서명 OK + 대조 OK, 세대 · 확인 시각) / `칩 불일치`(어느 칸이 다른지) / `서명 실패` / `칩 미확인`. 「확인함」 버튼은 그대로 사람이 누른다.
- 마이넘버 카드(일본 국적)는 **범위 밖** — 마이넘버 카드 칩은 공적 개인 인증(JPKI) 등 다른 체계이고 개인번호를 다룰 위험이 있다. 41 §9-7 결정(개인번호 미수집)과 충돌.

## 5. 대조 규칙 (서버)

| 세대 | 자동 대조 | 사람이 보는 것 |
| --- | --- | --- |
| 2세대 · 특정 | 칩 글자 ↔ R2 칸: 카드 번호 · 생년월일 · 성별 · 재류자격 · 재류기간 만료일 · 취로 제한 · 자격외활동. 다르면 칸별 「칩 값」을 보여 주고 **칩 값으로 고치기** 제안 | 이름 이미지 · 주소 이미지 · 얼굴 ↔ 찍은 사진 |
| 1세대 | 카드 번호(인증 성공 자체가 번호 일치) · 주소(칩 글자 ↔ R2 주소, 정규화 후) · 자격외활동(글자 포함 여부) | 칩 券面 이미지 · 얼굴 ↔ 찍은 사진(나란히) |

- 1세대 券面 이미지를 글자로 바꿔 자동 대조하려면 OCR 이 또 필요하다 → **하지 않는다**(이미지를 관리자에게 나란히 보여 주는 것으로 충분, 해외 전송도 늘지 않음).
- 2세대 코드값(국적 · 재류자격 · 허가 종류)은 ISA 가 **코드표를 따로 신청받아 준다**(공개 페이지 「コード表データは別途申請」 취지) — 코드표를 받기 전까지는 재류자격 대조를 끄거나
  아는 코드만 대조. **확인 필요: 코드표 신청 절차 · 이용 조건.**
- 서명 검증은 **서버(Node `crypto`)** 에서 한다: RSA PKCS#1 v1.5 / ECDSA P-384 둘 다 표준 지원. 앱이 「검증됨」이라고 보내는 값을 믿지 않는다(앱이 변조돼도 서버가 칩 원본으로 다시 검증).
  루트 CA 인증서는 저장소에 고정(만료 2028 · 2031 · 2034 · 2039, 새 인증서가 나오면 추가).

## 6. 데이터 처리 · 개인정보

- **저장하는 것(추천)**: 결과(`ok` / 칸별 불일치 / 서명 실패) · 세대 · 칩 사양 버전 · 인증서 일련번호 · 확인 시각 · (2세대) 칩 글자 칸 값(R2 칸과 같은 종류라 새 항목 아님).
- **저장하지 않는 것(추천)**: 칩 **얼굴 사진** · 券面 · 이름 · 주소 **이미지** — 서버 메모리에서 서명 검증 · 관리자 대조 화면 표시에만 쓰고 버린다.
  관리자 대조를 나중에 다시 보고 싶다면 「확인 때만 짧게(예: 확인함/다시 요청 누를 때까지) 보관」 안 — **사용자 결정**(§10).
- 칩 데이터는 **해외로 보내지 않는다**(Anthropic 미사용, 서명 검증 · 대조 모두 도쿄 서버). 동의 화면에 별도 동의는 필요 없지만, ISA 가 「칩 정보를 저장하면 개인정보보호법에 따라
  이용 목적을 통지 · 공표」하라고 적고 있어 **방침 4-1 에 「IC 칩 정보(진위 확인용)」를 추가**한다(17 「스토어 개인정보 신고」 §4).
- **얼굴 대조를 자동으로 하지 않는다** — 얼굴 사진 자동 비교(생체 인식)는 Apple 「Sensitive Info → biometric data」 신고 · 별도 동의 · 일본 개인정보 위험이 커진다. 관리자가 눈으로 본다.
- 스토어 신고 변화: 칩 데이터를 위 추천대로만 다루면 **새 데이터 유형 없음**. iOS 권한 문구 `NFCReaderUsageDescription` 만 추가(ko/ja/en, 18 §1 표에 「NFC」 줄).

## 7. 네이티브 플러그인 계획 (커스텀 Capacitor 플러그인)

### 7-1. 기존 것 조사

| 후보 | 상태 | 판단 |
| --- | --- | --- |
| Capawesome `@capawesome-team/capacitor-nfc` | `transceive` 있음(Android `ISO_DEP`, iOS `ISO_7816`). **Capawesome Insiders 유료 전용**, 라이선스 키 필요. iOS 의 ISO 7816 SELECT AID 설정 · Type B 폴링 문서 없음, iOS 7816 transceive 관련 미해결 이슈 보고 | 유료 · 블랙박스 · iOS 불확실 → 비추천 ([문서](https://capawesome.io/docs/sdks/capacitor/nfc/)) |
| `@capgo/capacitor-nfc` 8.2.2 | NDEF 읽기/쓰기 중심, **APDU transceive API 없음**(README 기준) | 불가 ([README](https://cdn.jsdelivr.net/npm/@capgo/capacitor-nfc@8.2.2/README.md)) |
| `Ukenn2112/ResidenceCardKit` (Swift) | 재류카드 1세대 SM · 서명 검증 구현, 사양 예시로 테스트, iOS 26 실기기 확인 주장. **라이선스 표시 없음 · 별 0 · 2026-05 단일 커밋 · 2세대 미지원** | **코드 사용 불가**(라이선스 없음 = 권리 유보). 구현이 가능하다는 참고로만 |
| `treastrain/TRETJapanNFCReader` (Swift, MIT) | Core NFC 로 일본 카드(운전면허 · 마이넘버 등). 마지막 push 2024-12 | 재류카드 미지원 확인됨 아님. Core NFC Type B 처리 참고 |
| `eringoio/zairyu-card-reader` (Python, Apache-2.0) · `KagurazakaHanabi/residence_card_reader` (Python, MIT) | 2026 생성, 별 0, PC 리더용 | 2세대 처리 참고(라이선스상 참고 · 이식 가능, 품질 미검증) |
| OSSTech `libjeid` | 일본 공적 카드 읽기 상용 라이브러리(샘플 앱 공개) | 상용 — 비용 · 조건 **확인 필요** |

→ **추천: 우리 플러그인을 직접 만든다**(사양이 짧고 공개돼 있으며, 암호는 OS 표준 라이브러리로 충분). 단계: 사양서 별첨 2 의 **예시값으로 단위 테스트**부터(하드웨어 없이).

### 7-2. 구조

```
src/lib/native/residence-card-nfc.ts   ← JS 쪽 래퍼(웹이면 isAvailable() = false)
ios/App/App/ResidenceCardNfcPlugin.swift
android/app/src/main/java/.../ResidenceCardNfcPlugin.kt
```

- API(안): `isAvailable()` · `read({ cardNumber, alertMessage })` → `{ generation, cardType, specVersion, files: { "MF/EF02": base64, "DF1/EF01": …, … } }` ·
  오류 코드 `not_supported` / `cancelled` / `auth_failed`(번호 틀림) / `lost`(카드가 떨어짐) / `timeout`.
- 플러그인은 **원본 바이트만** 돌려준다. 해석 · 서명 검증 · 대조는 서버 `src/lib/staff-documents/chip.ts`(신규)에서 — 앱 업데이트 없이 규칙을 고칠 수 있고, 웹 코드와 한곳에 모인다.
- **iOS(Swift)**:
  - `NFCTagReaderSession(pollingOption: .iso14443)` → `NFCISO7816Tag` → `sendCommand(apdu:)`. SM · 키 유도는 `CommonCrypto`(TDES · AES · SHA-1) / `CryptoKit`.
  - 앱 ID 에 **Near Field Communication Tag Reading** 기능, entitlements `com.apple.developer.nfc.readersession.formats` = `TAG`.
  - Info.plist `com.apple.developer.nfc.readersession.iso7816.select-identifiers` = 위 AID 3개(+ 특정 재류카드용 `…4F01…`) — iOS 는 목록에 있는 AID 로만 ISO 7816 태그를 연다.
    ([Apple 키 문서](https://developer.apple.com/documentation/bundleresources/information-property-list/com.apple.developer.nfc.readersession.iso7816.select-identifiers))
    한 3rd-party 문서는 iOS 26.4 의 새 `NFCTagReaderSession.Configuration` API 에서 위치가 바뀐다고 적는다 — **확인 필요**(Xcode · iOS 버전 맞춰 실기기로).
  - Info.plist `NFCReaderUsageDescription` + `ko/ja/en.lproj/InfoPlist.strings` 3개 언어.
  - Core NFC 는 iPhone 7 이후 · ISO 7816 은 iOS 13 이후. ISA 공식 앱 권장은 iOS 16+(위 지원 페이지) — **우리 최소 지원 iOS 와 맞춤**. iPad 는 NFC 없음.
- **Android(Kotlin)**:
  - `NfcAdapter.enableReaderMode(activity, cb, FLAG_READER_NFC_B or FLAG_READER_SKIP_NDEF_CHECK, …)` → `IsoDep.get(tag)` → `connect()` · `timeout` 늘리기 · `transceive()`.
  - Manifest: `android.permission.NFC`, `<uses-feature android:name="android.hardware.nfc" android:required="false"/>`(NFC 없는 폰도 설치 가능).
  - `IsoDep.isExtendedLengthApduSupported()` 가 false 면 **짧은 APDU 로 나눠 읽기**(READ BINARY 오프셋) — SM 상태에서 나눠 읽기가 되는지 **확인 필요**(사양 예시는 확장 길이 한 번).
  - 암호는 `javax.crypto`(DESede/CBC, AES/CBC, AESCMAC 은 BouncyCastle 또는 직접 구현 — **확인 필요**: Android 기본 제공자에 AES-CMAC 이 없을 수 있음).
- **이미지 변환**: JPEG 2000 얼굴 · MMR(CCITT G4) TIFF 는 브라우저가 대부분 못 그린다 → 서버에서 PNG 로 바꿔 관리자 대조 화면에 보여 줌. Node 용 JPEG 2000 · CCITT G4
  디코더 선택은 **확인 필요**(예: OpenJPEG 바인딩 · `sharp` 의 JP2 지원 여부).

## 8. 위험

| 위험 | 내용 | 대응 |
| --- | --- | --- |
| 폰 지원 편차 | 안드로이드 기종마다 NFC 안테나 위치 · Type B 감도 · 확장 APDU · 최대 전송 길이가 다르다. iOS 는 iPhone 7+ 이나 확장 APDU 지원이 공식 문서에 명시돼 있지 않다 | 나눠 읽기 대비 · 기종별 실기기 시험(직원 폰) · 실패해도 등록은 막지 않음 |
| 시험용 카드 | 실제 카드로만 확인 가능. ISA 가 개발 사업자에게 **견본 카드 대여**(2026-04-24 부터, 지정 장소에서만 · 반출 불가 · 신청서 · 비밀유지 서약 · 제품 계획서) | 직원 본인 카드로 동의 받아 시험 + 필요하면 대여 신청(👤) |
| 사양 변경 | 「予告なしに修正又は訂正する場合があります」. 2세대는 2026-04 에 이미 수정 | 서버 해석 · 루트 인증서 목록을 한곳에(`chip.ts`)에 두고 사양 버전(`C0`)을 저장 |
| 복제 칩 | 수동 인증만 있음(§3-3) | 얼굴 · 이름 사람 대조 필수, 「칩 확인됨」을 「본인 확인됨」으로 표현하지 않음 |
| 앱 심사 | NFC 기능 추가 = 새 앱 빌드 · 권한 문구. Apple 은 ISO 7816 태그 읽기에 별도 승인 절차는 없다(FeliCa 는 시스템 코드 신고) — 단 **확인 필요**(App Store Connect 의 기능 추가만으로 되는지) | 출시(C9) 뒤 업데이트로 넣는 것을 추천 |
| 웹 사용자 | PWA · PC 로 등록한 사람은 칩 확인 불가 | 관리자가 나중에 앱 있는 폰으로 대신 읽는 「관리자 칩 확인」(본인 카드를 면접 때 대면) — R4 와 묶어 검토 |

## 9. 작업량 (대략)

| 단계 | 내용 | 기간(1인) |
| --- | --- | --- |
| N1 | 서버 해석 · 서명 검증(1 · 2세대) + 사양서 예시값 단위 테스트 + 루트 인증서 고정 | 3~4일 |
| N2 | iOS 플러그인(SM TDES/AES, 세대 판별, 읽기) + 실기기 | 4~5일 |
| N3 | Android 플러그인(+ 나눠 읽기) + 기종 2~3개 실기기 | 4~5일 |
| N4 | 화면(카드 대기 · 실패 · 결과) ko/ja/en · 폴드 · 태블릿 · 관리자 대조 칸 · 이미지 변환 · DB 칸 · 문서 | 3~4일 |
| (선택) N5 | 특정 재류카드(재류 AP · RSA 配送鍵) | 2~3일 |

- 합계 **약 3~4주**(특정 재류카드 포함 4주+). 실제 카드 · 기종 확보가 일정의 변수다.
- 새 네이티브 코드라 **앱 빌드 · 스토어 업데이트가 필요**(서버 배포만으로는 안 됨).

## 10. 사용자 결정 항목

| # | 결정 | 추천 |
| --- | --- | --- |
| 1 | 할지 · 언제 | 출시(C9) **뒤** 첫 업데이트. 2세대 카드가 늘수록 가치가 커짐(券面에 없는 칸이 칩에만 있음) |
| 2 | 필수 / 선택 | **선택**(「나중에」 가능, 웹 사용자 고려). 관리자 화면에 「칩 미확인」만 표시 |
| 3 | 칩 얼굴 · 이미지 저장 | **저장 안 함**(검증 · 표시 후 버림). 관리자 재확인이 꼭 필요하면 「확인함/다시 요청까지만」 |
| 4 | 얼굴 자동 대조 | **안 함**(생체 인식 신고 · 위험) |
| 5 | 특정 재류카드 · 특별영주자증명서 | 2세대 재류카드까지 먼저, 특정은 실제로 가진 직원이 생기면 |
| 6 | 2세대 코드표 신청(ISA) · 견본 카드 대여 신청 | 코드표는 신청(재류자격 자동 대조에 필요), 견본 대여는 직원 카드로 안 될 때만 |
| 7 | 플러그인 직접 개발 vs 상용(libjeid · Capawesome) | **직접 개발**(사양 공개 · 작음 · 라이선스 깔끔) |

## 출처

- ISA 재류카드 등 사양서 공개(1세대, 루트 CA 인증서 · 견본 대여): https://www.moj.go.jp/isa/applications/disclosure/120424_01.html
- ISA 2세대 · 특정 재류카드 사양서 공개: https://www.moj.go.jp/isa/publications/resources/120424_01_00003.html
- 1세대 사양서 PDF(令和6年3月): https://www.moj.go.jp/isa/content/001414093.pdf
- 2세대 사양서 PDF(2026-04): https://www.moj.go.jp/isa/content/001460711.pdf
- 특정 재류카드 사양서 PDF(2026-04): https://www.moj.go.jp/isa/content/001460712.pdf
- ISA 「在留カードとは」(2026-06-14 새 양식, 券面에서 빠진 칸): https://www.moj.go.jp/isa/applications/procedures/whatzairyu_00001.html
- ISA 읽기 앱 · 실효 조회 지원 페이지(지원 OS · 무료 · 조회 주소): https://www.moj.go.jp/isa/applications/procedures/rcc-support.html
- Apple ISO 7816 select-identifiers 키: https://developer.apple.com/documentation/bundleresources/information-property-list/com.apple.developer.nfc.readersession.iso7816.select-identifiers
- Apple NFCISO7816APDU: https://developer.apple.com/documentation/corenfc/nfciso7816apdu
- Apple 개발자 포럼(태그 연결 약 20초 보고): https://developer.apple.com/forums/thread/802895
- Capawesome NFC: https://capawesome.io/docs/sdks/capacitor/nfc/ · Capgo NFC README: https://cdn.jsdelivr.net/npm/@capgo/capacitor-nfc@8.2.2/README.md
- GitHub: https://github.com/Ukenn2112/ResidenceCardKit · https://github.com/treastrain/TRETJapanNFCReader · https://github.com/eringoio/zairyu-card-reader · https://github.com/KagurazakaHanabi/residence_card_reader
