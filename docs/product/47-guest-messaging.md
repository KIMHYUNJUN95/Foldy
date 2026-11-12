# 47. 손님 메시지 (Beds24 CS) — 기획

> 상태: **1단계 커밋 · 운영 DB 적용(2026-11-12) · 2~6단계(메시지함 · 답장 · 번역 · 정해 둔 문구 · 건물 정보 · 자동 안내 · 메시지 → 업무) 구현 — 커밋 전**(2026-11-13). **실제 Beds24 발송은 `GUEST_MESSAGES_SEND_ENABLED=1` 일 때만(기본 꺼짐).** 정기 실행(보정 조회 15분 · 발송 5분 · 자동 안내 5분)은 Supabase pg_cron 마이그레이션 `202611130006` 으로 준비만(미적용). 과거 메시지 가져오기는 정기 실행 없음.
> 2~6단계 마이그레이션 `202611130001` → `0002` → `0003` → `0004` → `0005`(이 순서로, 코드 배포보다 먼저) · 정기 실행 `202611130006`(코드 배포 뒤) — `0001`~`0005` **운영 적용 2026-11-13**(사용자 SQL Editor) · `0006` 은 아직 미적용(코드 배포 뒤, 사용자 허락 뒤). 202611120002(운영 적용됨)는 고치지 않는다.
> 마이그레이션 `supabase/migrations/202611120002_guest_messages_foundation.sql` — **운영 적용 2026-11-12**(Dashboard SQL Editor, 표 4 · RLS 4 · 정책 6 · 함수 1 · 권한 8행 확인)
> 시안 캔버스: https://claude.ai/artifact/EPUHqKjNJKC5ezeqG5WuVn (PC 메시지함 · 답장 칸 상태 · 폰/폴드/태블릿 · 자동 안내 규칙 · ja/en)
> 관련 문서: 15 예약 캘린더(건물 정보) · 08 수리 · 09 분실물 · 25 게스트 피드백 · 28 할 일 · 43~46 셀프 체크인 · 33 Beds24 쓰기 · 05 RLS · 04 데이터 모델

## 1. 목적

- OTA(Airbnb · Booking.com 등) 손님 메시지를 **Foldy 안에서 보고 답장**한다. Beds24 인박스는 거의 쓰지 않고 Foldy 로만 운영한다.
- 예약 상태와 날짜에 맞춘 **정해진 안내를 자동으로 보낸다**(확정 안내 · 체크인 방법 · 체크아웃 안내 등).
- **나중에 Beds24 를 빼도 그대로 돌아가야 한다.** 메시지의 원본은 Foldy DB 이고 Beds24 는 "통로" 중 하나다.
- 모든 연동은 **웹훅 중심**이다(CLAUDE.md 「Beds24 — Webhook-first」). 잦은 조회로 되돌아가지 않는다.

## 2. 사용자 결정 (2026-11-12)

| # | 결정 |
| --- | --- |
| D1 | 범위는 ① 메시지함(보기 + 답장) ③ 자동 안내. 「알림만」 안은 버림 |
| D2 | Beds24 Auto Actions 는 쓰지 않는다. 자동 안내 규칙은 Foldy 가 갖는다 |
| D3 | 미래에 Beds24 를 대체할 수 있는 구조(채널 어댑터) |
| D4 | 수신은 웹훅 중심 |
| D5 | **넣는다:** 응답 목표 시간 · 사용량 표시 · 건물별 정보 카드 · 메시지 → 업무 한 번에 |
| D6 | **빼거나 미룬다:** 담당자 · 「답장 쓰는 중」 표시(필요 없음) · AI 답장 초안(AI 기능 만들 때) · 푸시 알림(알림 일괄 구현 때) |

## 3. Beds24 공식 문서 근거

출처: [API V2 위키](https://wiki.beds24.com/index.php/API_V2.0) · [API V2 명세 apiV2.yaml](https://beds24.com/api/v2/apiV2.yaml) (2026-11-12 읽음).

### 3-1. 크레딧

- 기본 **5분당 100 크레딧**. 고객지원에 요청하면 월 10€에 200, 그 이상도 가능. **계정 단위**라 모든 토큰이 같이 쓴다(하위 계정은 따로).
- 요청 하나의 비용은 "복잡도에 따라 동적" — 엔드포인트별 표가 없다. 응답 헤더 `x-request-cost` 로만 안다(우리 기록: 일반 호출 1).
- 남은 양 `x-five-min-limit-remaining`, 리셋까지 초 `x-five-min-limit-resets-in`.
- 넘으면 429 / "Usage limit exceeded in last 5 minutes" — **5분이 끝날 때까지 모든 호출이 막힌다**(가격 반영 포함).
- **새 토큰 발급도 크레딧을 쓴다.** 토큰은 24시간 — 재사용(`src/lib/beds24/access-token.ts`).
- POST 는 배열로 여러 건 한 번에(약 1MB · 1만 건까지). 위키 권장: "많이 보낼 때는 30초마다 모아서 한 번에".

### 3-2. 메시지 API

| 엔드포인트 | 내용 |
| --- | --- |
| `GET /bookings/messages` | `id` · `propertyId` · `roomId` · `bookingId` · `masterId` · `filter`(read/unread) · `maxAge`(일) · `source`(host/guest/internalNote/system) · `page`. 예약 ID 없이 계정 전체를 한 번에 거를 수 있다 |
| `POST /bookings/messages` | 보내기 `[{bookingId, message}]` · 읽음 `[{id, read:true}]` · 첨부 `attachment`(base64) · `attachmentName` · `attachmentMimeType` |
| `PATCH /bookings/messages` | 선택한 메시지 묶음의 `read` 바꾸기(선택자 이름은 `messageId`) |

- 메시지 필드: `id` · `bookingId` · `roomId` · `propertyId` · `time` · `read` · `message` · `source` · `authorOwnerId` · 첨부 3칸.
- **POST 는 OTA 예약에만 된다.** 자체 예약 페이지로 들어온 직접 예약은 안 된다(위키 원문).
- 첨부: 명세는 Airbnb(jpeg/png/gif) · Booking.com(jpeg/png) · VRBO(+pdf) 를 적었지만 위키 FAQ 는 "사진은 아직 안 됨" — **모순, 실제 확인 필요**.
- 메시지 쓰기에 필요한 scope 는 문서에 분명하지 않다. 읽기 전용 장기 토큰으로는 쓸 수 없다.

### 3-3. 웹훅

- 위키 FAQ 원문: "There is no separate message webhook, **message activity is included in the booking webhook**." 예약 웹훅 본문에 `messages` 배열이 들어 있다(명세 `Webhooks - bookings`).
- "웹훅은 비동기 · **평균 1분 지연**, 즉시 알림이 아님". 명세에는 Alpha 로 표시. 재시도 · 서명 규칙은 문서에 없다.
- 설정: 설정 > 숙소 > 접근 > Booking webhooks(숙소마다). 버전 `twoWithPersonalData` 여야 메시지 내용이 온다(추정 — 확인 필요).
- 예약 상태: `confirmed` · `request` · `new` · `cancelled` · `black` · `inquiry`. 채널 설정 `inquiryAndRequests`(`ignore` / `importAll` / `importOnlyContainingBookingNumber`) 가 `ignore` 면 문의가 Beds24 에 아예 안 들어온다.

### 3-4. 구현 전에 확인할 것

| # | 확인 | 방법 |
| --- | --- | --- |
| V1 | 손님 메시지가 오면 예약 웹훅이 실제로 울리고 `messages` 가 들어오는가 | 시험 예약에 메시지 1건 → 웹훅 원문 저장(지금은 실패 배치만 원문 저장 — 임시 기록 필요) |
| V2 | 숙소마다 예약 웹훅이 켜져 있고 버전이 맞는가 | Beds24 설정 화면 |
| V3 | 지금 토큰이 메시지 읽기 · 쓰기를 할 수 있는가 · GET/POST 실제 비용 | 시험 호출 1번씩, `x-request-cost` 기록 |
| V4 | 채널별 문의 가져오기 설정 · 채널별 답장 · 첨부 동작 | 채널 설정 + 채널마다 시험 메시지 |

V1 결과에 따라 보정 조회 간격(§4 「보정 조회」)만 바뀌고 나머지 설계는 그대로다.

**V1 임시 원문 기록 (0단계, 임시 — 확인 끝나면 끈다)**
- 환경변수 `BEDS24_WEBHOOK_CAPTURE_MESSAGES=1` 일 때만(기본 꺼짐), 본문 어딘가에 **비어 있지 않은 `messages` 배열**이 있는 예약 웹훅의 원문을
  기존 표 `beds24_webhook_events.raw_payload` 에 남긴다(새 표 없음). 그 줄의 `modes` 에 `messages_capture` 가 붙는다.
- 판단 함수 `shouldCaptureWebhookMessages`(`src/lib/guest-messages/webhook-ingest.ts`), 연결은 `src/app/api/beds24/webhook/route.ts`.
- 저장 전에 첨부 값(base64 일 수 있음)은 **길이만** 남기고(`{ redactedLength }`), 6만 자를 넘으면 앞 1.2만 자 표본 + 길이만 남긴다(`prepareCapturedMessagesPayload`).
  실패 배치는 예전대로 원문 전체(재처리용). DB 칸 설명(`comment on column beds24_webhook_events.raw_payload`)에 이 임시 예외를 적었다.
- 원문에는 손님 이름 · 메시지가 들어 있다(개인정보). **확인이 끝나면 이 순서로 끈다**:
  1. Vercel 환경변수 `BEDS24_WEBHOOK_CAPTURE_MESSAGES` 를 지우고 재배포.
  2. 쌓인 줄 지우기(운영 DB 쓰기 — 사용자 컨펌 뒤 SQL Editor): `delete from public.beds24_webhook_events where 'messages_capture' = any(modes) and failed_count = 0;`
     (실패도 함께 난 배치는 재처리용이라 남긴다 — 필요하면 `raw_payload` 만 비운다.)
  3. 이 절과 `docs/engineering/07-environment-setup.md` 의 해당 줄을 「끝남」으로 고친다.

## 4. 구조

```txt
Beds24 예약 웹훅 ──▶ /api/beds24/webhook (기존) ──▶ 메시지 추출 ──▶ guest_messages (원본)
                                                                    │
  보정 조회(10~15분, 안 읽은 손님 메시지만) ─────────────────────────┘
                                                                    ▼
                                             PC · 모바일 메시지함 (DB 만 읽음, 크레딧 0)
                                                                    │
            직원 답장 · 자동 안내 ──▶ guest_message_outbox ──▶ 채널 어댑터.send() ──▶ Beds24 POST
```

- **채널 어댑터**: `receive`(웹훅 본문 → 표준 메시지) · `send` · `markRead` 세 가지만. 지금은 Beds24 어댑터 하나. 나중에 OTA 직접 연동 · 이메일(직접 예약 손님) 어댑터를 붙인다. 화면 · 규칙 · 업무 연결은 어댑터를 모른다.
- **중복 막기**: `(organization_id, provider, external_id)` 고유(조직마다 따로 — 다른 조직 줄과 부딪쳐 조용히 버려지지 않게). 웹훅과 보정 조회가 같은 메시지를 두 번 넣어도 하나.
  이미 있는 줄에 통로가 읽음(`read = true`)을 주면 비어 있던 `read_at` 을 채운다(보정 조회가 먼저 안 읽음으로 넣고 웹훅이 나중에 읽음을 줄 때).
- **보낸 메시지 되돌아옴**: 우리가 보낸 메시지도 웹훅에 `source=host` 로 다시 온다 → 발송 큐 줄과 맞춰 한 줄로 합친다.
  맞출 대상은 `sent` · `sending` · `uncertain` 줄(발송 작업이 결과를 저장하기 전에 웹훅이 먼저 올 수 있다), `sent_at` 이 비어 있어도 된다.
  외부 번호로 먼저, 번호를 모르면 같은 글(공백 정리) · 24시간 안(보낸 시각, 없으면 만든 시각)으로. 맞으면 `sending` · `uncertain` 줄은 `sent` 가 된다.
- **발송 계약(2단계 발송 작업이 지킬 것)**: 메시지 줄은 발송 큐 한 줄에 하나(`guest_messages_outbox_key` = `outbox_id` 고유). 발송 작업이 `sent` 를 저장할 때
  메시지 줄을 `outbox_id` 로 upsert 한다 — 되돌아옴 합치기가 먼저 만든 줄이 있으면 새로 넣지 않고 그 줄에 잇는다(번호 · 본문 · `author_user_id` 를 채움).

### 4-0. 구현 (0 · 1단계, 2026-11-12)

| 파일 | 하는 일 |
| --- | --- |
| `src/lib/guest-messages/types.ts` | 표준 메시지 · 어댑터 인터페이스(`receive` · `send` · `markRead`) · 설정 기본값 |
| `src/lib/guest-messages/beds24-normalize.ts` | 웹훅 본문 → 표준 메시지(순수). 봉투 `{ booking, messages }` 와 예약 객체 안 `messages` 둘 다. 번호 없는 메시지 · 빈 본문은 버리고, 모르는 `source` 는 `system`(손님 말로 세지 않음), 시각이 없으면 받은 시각, 시간대 없는 시각은 UTC 로 읽음(V1 확인 필요), 첨부의 base64 는 저장하지 않음 |
| `src/lib/guest-messages/beds24-adapter.ts` | Beds24 어댑터. `send` 는 한 POST(배열). **OTA 허용 목록**(airbnb · booking · expedia · agoda · vrbo)만 보낸다 — 직접 예약은 `direct_booking`, 채널 모름 · 그 밖은 `unknown_channel`(호출 안 함). 부르기 전 `gate`(동기화 멈춤 · 계정 쿨다운)면 `rate_limited`. 429 는 `resets-in` + 2초(15~300초). 요청이 나간 뒤의 실패(네트워크 · 5xx · 응답 줄 빠짐)는 `uncertain`, 4xx 는 `rejected`, 설정 · 토큰 없음은 `pre_send` |
| `src/lib/guest-messages/adapter-server.ts` | 서버용 — 게이트(멈춤 · 쿨다운), 크레딧 기록(계정 전체 + 조직 사본), 남은 크레딧 < `LOW_CREDIT_THRESHOLD`(10) 면 계정 쿨다운 low_credit, 429 면 rate_limit |
| `src/lib/guest-messages/credit.ts` | 크레딧 판단 한 곳: `knownRemainingCredit`(리셋 시각을 모르거나 지났으면 null) · `effectiveCreditReserve`(설정값과 10 중 큰 쪽) · `estimateBatchCost`(건수 비례 — V3 실측 전) |
| `src/lib/beds24/account-credit.ts` | 계정 전체 마지막 크레딧 기록 — `beds24_sync_locks` 의 `account_credit` 줄(`expires_at` = 리셋 시각) |
| `src/lib/guest-messages/ingest-plan.ts` | 중복 막기 · 되돌아옴 합치기 · DB 함수 인자 만들기(`summarizeAddedMessages`) · 상태 규칙 거울(`nextConversationState`, 순수) |
| `src/lib/guest-messages/store.ts` | DB 쓰기(service_role). 웹훅 · 보정 조회가 같은 함수로 넣는다. 모든 쓰기의 오류를 확인한다(되돌아옴 합치기 실패는 건수에 안 넣음, 23505 는 이미 있는 줄에 잇기, 대화 다시 읽기 실패는 던져 실패 건수에 든다) |
| `src/lib/guest-messages/org-resolve.ts` | 조직 정하기(매핑 → 기본값, 기본값으로만 정해지면 경고) · 보정 조회의 조직 섞임 판정 |
| `src/lib/guest-messages/webhook-ingest.ts` | 웹훅 → 메시지. 예약 처리 뒤 `after()` 에서, **절대 던지지 않음**(웹훅 응답 · 예약 처리 영향 없음). 조직은 예약 처리와 같은 매핑 규칙 |
| `src/lib/guest-messages/outbox.ts` | `processOutboxBatch` — 발송 큐 한 바퀴(어댑터 주입, DB 모름). 2단계 발송 작업이 줄 잡기(`sending`) · 결과 저장을 맡는다 |
| `src/lib/guest-messages/reconcile.ts` | 보정 조회 `reconcileGuestMessages(organizationIds)` — 계정 한 번 읽기 |
| `src/lib/guest-messages/response-target.ts` | `computeWaiting` — 기다린 시간(§6-1) |

- **대화 상태 규칙** — DB 함수 `guest_conversation_apply_messages`(한 문장 · service_role 만 실행)가 바꾼다. 읽고 → 고치기 사이에 직원 「처리 끝」이 덮이지 않게(검토 반영).
  - 시각 칸(`last_guest_at` · `last_reply_at` · `last_message_at`)은 뒤로 가지 않는다(`greatest`).
  - 「답장 기다림」은 **새 안 읽은 손님 말**이 지금까지의 손님 말 · 답장보다 모두 나중일 때만. 그래서 직원이 「처리 끝」 한 뒤 같은 · 옛 손님 말이 다시 와도(웹훅은 이력 전체를 싣는다) 다시 열리지 않는다.
  - Beds24 가 이미 읽음(`read = true`)이라고 준 손님 말은 기다림을 만들지 않는다. **새로 만든 대화**에서 가장 늦은 안 읽은 손님 말이 48시간보다 오래됐으면 `done` 그대로(첫 웹훅의 옛 이력).
  - 「나중에」가 아직 안 끝났으면 `snoozed` 그대로, 끝났으면 `awaiting` 으로 돌아가며 `snooze_until` 을 비운다.
  - 우리 답장(host)이 마지막 손님 말 이후면 `awaiting` → `done`. 내부 메모 · 시스템 줄은 상태를 바꾸지 않는다.
  - 들어온 메시지 **전부**(중복 포함)를 함수에 넘긴다 — 함수가 단조롭게(뒤로 안 감 · 새 것만 다시 엶) 바꾸므로 안전하고, 앞서 상태 저장이 실패했어도 다음 배달이 바로잡는다.
  - 같은 규칙의 TS 거울 `nextConversationState` 는 시험용이다. 둘을 고칠 때는 함께 고친다.
- **대화 = Beds24 자기 예약 번호**(v2 `id`, 채널 번호 `apiReference` 아님) — 그룹 예약은 방마다 대화가 따로다(2단계에서 `masterId` 로 묶어 보일지 정한다).
- **채널 분류**(`classifyGuestChannel`): 예약 `channel` 정확 일치 → `referer` · `apiSource` 에서 OTA 이름(airbnb · booking.com · expedia · agoda · vrbo/homeaway) → 예약 페이지 · 수기 · 전화 · walk-in 은 `direct` → 그 밖은 `other`. 예전의 `beds24` · `iframe` 같은 느슨한 부분 일치는 뺐다.
  대화 채널을 모르면 우리 예약 행의 출처(`reservations.source`)로 다시 분류한다(`resolveOutboundChannel`). 보내기는 허용 목록만 — 실제 값 목록 · 채널별 동작은 **V4 에서 확정**.
- **조직**: 웹훅 · 보정 조회 모두 매핑(건물 · 객실 → 조직)이 먼저. 매핑 없이 `BEDS24_DEFAULT_ORGANIZATION_ID` 로만 정해지면 넣되 경고 로그를 남긴다.
- **시간대 없는 시각**: UTC 로 읽고(V1 확인 전), 그런 메시지 수를 경고 로그로 남긴다(`timeAssumedUtc`).
- **웹훅이 하는 일**: Beds24 를 새로 부르지 않는다(크레딧 0). 메시지가 없어도 그 조직의 `last_webhook_at` 을 고치고, 메시지가 있으면 `last_message_webhook_at` 도.

### 4-0-1. 보정 조회

- `reconcileGuestMessages(organizationIds)`: **한 번 실행 = 계정 전체 한 번 읽기** — `GET /bookings/messages?filter=unread&maxAge=2&page=N`(최대 10페이지) → 예약마다 조직을 정해 웹훅과 같은 함수로 넣는다.
  조직: 매핑이 먼저 · 매핑이 없으면 그 예약의 기존 대화가 있는 조직(하나일 때) · 그래도 없으면 기본값(경고). **매핑 조직과 기존 대화 조직이 다르면 넣지 않고 로그**. 넘긴 조직 목록 밖이면 건너뜀.
- 부르지 않는 때: 동기화 멈춤 · 계정 쿨다운 · 계정 전체 마지막 크레딧 기록(리셋 전만 믿음)이 선(`effectiveCreditReserve`, 조직 설정 중 큰 값과 10 중 큰 쪽) 아래 · 토큰 없음.
  페이지마다 헤더를 기록하고(계정 + 조직 사본, 10 아래면 계정 쿨다운 low_credit) 선 아래로 내려가면 남은 페이지를 미룬다. 429 면 계정 쿨다운(rate_limit)을 켜고 멈춘다.
- `last_reconcile_at` 은 **한 페이지라도 읽었을 때만** 고친다. 실패 · 건너뜀 이유는 `last_reconcile_error`(성공하면 null).
- 라우트 `/api/beds24/messages-reconcile`(GET · POST, `?organizationId=` 선택) — 인가는 **`Authorization: Bearer <CRON_SECRET>` 만**(Beds24 웹훅 시크릿은 받지 않음, 없으면 404).
  `http_error` · `request_error` 로 멈췄거나 토큰이 없거나 예약 넣기 실패(`failedBookings`)가 있으면 207 · `ok: false`.
- 정기 실행은 Supabase pg_cron 15분(`202611130006`, **미적용** — `vercel.json` · GitHub Actions 없음). 라우트는 `CRON_SECRET` 또는 pg_cron 토큰(Vault, `guest_messages_cron_token_ok()`)을 받는다.

### 4-0-2. 과거 메시지 가져오기 (2026-11-12 결정)

**결정(사용자, 2026-11-12)**: Beds24 가 주는 과거 메시지를 **전부** 가져온다(`maxAge=999`일 — Beds24 상한).
몇 년치 손님 이름 · 메시지 본문이 한꺼번에 들어오므로 보관 기준이 필요하다 — **Q7 확정 (2026-11-12 사용자): 지금은 자동 삭제 없음**, 보관 기준(예: 체크아웃 3년 뒤 삭제)은 2027-02-12 까지 정한다(19 열린 할 일).
- **실제로 돌리는 순서(확정 (2026-11-12 사용자))**: 먼저 재기 모드(`mode=measure`)로 비용을 보고, 실제 가져오기는 **밤에**(가격 · 예약 동기화와 같은 Beds24 크레딧을 나눠 쓴다).

- 코드: `backfillGuestMessageHistory(organizationId, { mode, restart })` — `src/lib/guest-messages/backfill.ts`.
  `GET /bookings/messages?maxAge=999&page=N`(거르지 않음 — 읽음 · 안 읽음 · 모든 채널), 한 번 실행에 최대 10페이지(라우트는 20까지) · **시간 예산 240초**. 다시 부르면 이어 받는다.
- **조직 하나 기준**으로 계정 전체를 훑는다. 예약 → 조직은 **매핑 · 그 예약의 기존 대화로만** 정한다 — 보정 조회와 달리 **`BEDS24_DEFAULT_ORGANIZATION_ID` 기본값은 쓰지 않는다**
  (몇 년치를 엉뚱한 조직에 넣지 않게). 매핑 없음 · 다른 조직 · 엇갈림은 넣지 않고 `unrouted_count` 로만 센다(로그에는 예약 번호만). 조직이 둘 이상이면 조직마다 따로 돌린다(크레딧도 따로 든다).
- 진행: `guest_message_backfill_state`(조직마다 한 줄 — 마이그레이션 `202611130002`, 운영 적용 2026-11-13). `status` idle · running · paused · done · failed,
  `next_page` 커서, 페이지 · 가져옴 · 이미 있음 · 못 넣음 · 실패 예약 수, `page_attempts` · `failed_booking_ids`, 시작 · 끝 · 마지막 실행 시각, `last_error`, `resume_after`(429 · 저크레딧 때 리셋 시각).
- **실행 소유**: DB 함수 `guest_message_backfill_claim()` 이 한 문장으로 잡고 새 `run_id` 를 준다. 모든 상태 쓰기는 `status = 'running' and run_id = 내 번호` 조건이고,
  페이지마다 lease(120초, 함수 쪽 상한 300초)를 늘린다. lease 가 지나 다른 실행이 잡으면 앞 실행의 쓰기는 0행 → 그 실행은 바로 멈춘다(`lost_lease`). 끝난 것은 `restart` 일 때만 1페이지부터 다시.
- **커서**: 페이지를 다 넣은 뒤에만 앞으로 간다.
  - 이어 받을 때는 **앞 페이지(`next_page − 1`)부터 다시** 읽는다 — 가져오는 사이 새 메시지로 Beds24 페이지 경계가 밀려도 빠지지 않게(중복은 고유 제약으로 건너뜀).
    겹친 페이지는 **새로 들어간 수만** 센다(페이지 · 건수 · 이미 있음은 다시 안 셈). 페이지 순서(오래된 것 먼저 / 새 것 먼저)는 재기 모드가 `order` 로 남긴다 — 새 것 먼저면 밀림이 잦으니 V3 때 확인.
  - 예약 넣기가 실패한 페이지는 커서와 숫자를 그대로 두고 `failed`(다시 돌리면 같은 페이지부터). **같은 페이지가 3번 실패하면** 실패 예약 번호를 `failed_booking_ids`(최대 500)에 남기고 넘어간다 — 독이 든 한 예약에 영원히 막히지 않게.
- **크레딧 — 가져오기 전용 선**: `max(남겨 둘 선 + 40, 5분 한도 200 × 50%)` = 지금 **100**(`backfillStopLine`, 상수 `BACKFILL_RESERVE_MARGIN` · `BACKFILL_LIMIT_SHARE` · `BACKFILL_ASSUMED_FIVE_MIN_LIMIT`).
  **페이지마다 부르기 전에** 「남은 크레딧 − 마지막 비용 × 2」가 이 선 아래면 멈춘다(paused, 다음 실행이 이어 받음). 남은 크레딧을 모르면(기록 없음 · 리셋 지남) **첫 페이지만** 읽는다(`credit_unknown`).
  선이 발송 선(≥ 10)보다 늘 높아서 가져오기가 계정 저크레딧 쿨다운(10)을 일으키지 않고, 직원 답장 · 자동 안내 몫이 남는다. 동기화 멈춤 · 계정 쿨다운이면 부르지 않는다. 429 면 계정 쿨다운을 켜고 `resume_after` 를 남긴다.
- **과거 메시지는 「답장 기다림 · 늦음」을 만들지 않는다.** `ingestConversationMessages({ history: true })` 가 「48시간 넘은 안 읽은 손님 말은 열지 않기」를
  새 대화뿐 아니라 이미 있는 대화에도 적용한다. **48시간 안의 안 읽은 손님 말에 답장이 없으면 답장 기다림으로 연다**(진짜로 기다리는 손님이라 — 전부 막으면
  뒤에 오는 보정 조회는 이미 있는 메시지라 다시 열 수 없다). 예약이 없어도 대화를 만든다(건물 · 객실은 매핑, 예약 날짜는 예약 캐시에 있으면). 첨부는 메타데이터만.
- 라우트 `/api/beds24/messages-backfill`(GET · POST) — **인가 먼저**(`Authorization: Bearer <CRON_SECRET>` 만, 없으면 404, 틀리면 403), 그다음 동기화 멈춤이면 202.
  `organizationId`(필수) · `mode=measure` · `restart=1` · `pages=1~20`. `maxDuration = 300`. **정기 실행에 넣지 않는다**(한 번만 하는 일). 토큰 없음 · 설정 없음 · `http_error` · `request_error` · 예약 실패로 멈추면 207.
- 서버 액션(`src/actions/guest-messages-backfill.ts`, `guest_messages.manage` 만 — 아니면 `forbidden`, 조직은 세션에서):
  - `startGuestMessageBackfill({ mode?: "run" | "measure", restart?: boolean })` → `{ ok: true, status }` | `{ ok: false, errorKey: "forbidden" | "busy" | "done" | "too_soon" | "failed" }`.
    `run` 은 한 번 실행을 `after()` 로 뒤에서 돌리고 **바로** 돌아온다 — 화면은 상태를 다시 읽어 진행을 보여 주고, `paused` 면 단추를 다시 누른다.
  - `getGuestMessageBackfillStatus()` → `{ ok: true, status: { status, nextPage, pagesDone, fetched, imported, skipped, unrouted, failedBookings, startedAt, finishedAt, lastRunAt, lastError, resumeAfter, measure } }`.
    lease 가 지난 `running` 은 끊긴 실행이라 `paused` 로 보여 준다.
  - **3단계 화면 작업 메모**: 이 액션을 부르는 설정 페이지는 **`export const maxDuration = 300`** 을 둬야 한다(`after()` 실행이 그 페이지 함수 시간 안에서 돈다). 단추 · 문구(ko · ja · en, `too_soon` 포함)는 그때 붙인다.
- **재기 모드(V3)**: `mode: "measure"` — `maxAge=7` 첫 페이지 하나만 읽고 **넣지 않는다**. 건수 · `x-request-cost` · 남은 크레딧 · 리셋까지 초 · 다음 페이지 여부 · 정렬 방향(`order`)을
  `last_measure` 에 남긴다. **5분에 한 번**(`last_measure.at` 기준, 아니면 `too_soon`). 전부 가져오기 전에 한 번 돌려 페이지당 비용을 보고, 몇 번에 나눌지 정한다.

### 4-1. 크레딧 예산 · 우선순위

| 순위 | 작업 | 예상 사용 |
| --- | --- | --- |
| 1 | 직원 답장 | 보낼 때만, 건당 소량 |
| 2 | 자동 안내 | 같은 분에 나갈 것을 한 POST 로 묶음 |
| 3 | 읽음 처리 | 답장과 함께 · 모아서 |
| 4 | 보정 조회 | 10~15분에 1번(5분당 약 0.3~0.5) |
| 5 | 가격 반영 · 리뷰 수집 등 기존 작업 | 메시지용으로 **남겨 둘 선(예: 20)** 아래로는 내려가지 않게 쉼 |

- 429 를 받으면 발송 큐는 `resets-in` 초 뒤에 다시 시도한다. 직원 화면에는 「보낼 차례 기다리는 중」(시안 States).
- 기존 쿨다운 `src/lib/beds24/sync-locks.ts` · 헤더 읽기 `src/lib/beds24/credits.ts` 를 그대로 쓴다. 저크레딧 선은 가격 작업과 같은 `LOW_CREDIT_THRESHOLD`(10) — 그 아래면 계정 쿨다운(low_credit).
- **크레딧 기록은 계정에 한 곳**: `beds24_sync_locks` 의 `account_credit` 줄(남은 양 · 리셋 시각 · 비용, `expires_at` = 리셋 시각). `guest_message_channel_state.last_credit_*` 는 이 기능 화면용 **사본**이다. 지금은 손님 메시지 경로만 이 줄을 쓴다.
- 남겨 둘 선 숫자는 V3 실측 뒤 정한다. 지금 기본값 20(`guest_message_channel_state.credit_reserve`), 실제로 쓰는 선은 설정값과 10 중 큰 쪽.
- 구현(`processOutboxBatch`): 직원 답장 묶음 → 자동 안내 묶음 순서로 한 POST 씩.
  - 자동 안내는 「남은 크레딧 − 예상 비용 < 선」이면 보내지 않고 큐에 둔다. 예상 비용은 **건수 비례**(마지막 `x-request-cost` × 건수, 모르면 건수 — V3 실측 전이라 넉넉히). 리셋 시각을 모르거나 지난 기록은 믿지 않는다. 직원 답장은 선과 무관.
  - 429 · 멈춤 · 쿨다운: 그 묶음을 `retryAfterSec` 뒤로(시도 횟수 그대로) 미루고 바퀴를 멈춘다.
  - 보내기 전 실패(설정 · 토큰 없음): 5분 뒤 다시, **시도 횟수 그대로**, 바퀴를 멈춘다.
  - **보내기는 멱등이 아니다** — 요청이 나간 뒤의 실패(네트워크 끊김 · 시간 초과 · 5xx · 응답에 그 줄 결과가 없음)는 `uncertain` 이고 **자동으로 다시 보내지 않는다**. 되돌아온 host 메시지(웹훅 · 보정 조회)가 `sent` 로 바꾼다. 끝내 안 오면 화면(2단계)에서 사람이 확인한다.
  - Beds24 거절(4xx · 줄 단위 거절) · 직접 예약 · 채널 모름: 바로 `failed`.

## 5. 화면

시안 캔버스 대지 이름으로 적는다. 모든 화면은 ko · ja · en, 모바일은 폰 · 폴드 · 태블릿.

### 5-1. PC `/admin/messages` (가칭)

- 탭: **대화 · 자동 안내 · 정해 둔 문구 · 설정**(설정 = 응답 목표 시간 + Beds24 연결, 시안 R2Settings). 5단계(2026-11-13)에 자동 안내 탭을 붙였다(`?tab=auto`, §5-6). 탭 줄은 `guest_messages.manage` 만 보인다(§5-5).
- 대화 머리: 손님 · 채널 · 상태 · 언어 · 기다린 시간(목표 넘으면 빨강) + 「번역해서 보기」 · 「나중에」 · 「처리 끝」(시안 R2Main).
- 대화: 왼쪽 목록(필터는 드롭다운 — 상태 「답장 기다림 / 전체 / 처리 끝」 · 건물) · 가운데 대화 · 오른쪽 예약 패널.
- 목록 줄: 손님 이름 · 채널 점(회사 색) · 기다린 시간 · 마지막 말 · `건물 · 방 · 예약 상태 · 날짜`. 정렬은 **응답 목표에 가까운 순**(6-1).
- 대화: 손님 말(번역 · 원문 보기) · 우리 답장 · 내부 메모(자물쇠, 손님에게 안 보임) · 시스템 줄(「Airbnb 문의 · 기다린 지 32분」).
- 답장 칸: 정해 둔 문구 · 건물 정보 넣기(6-3) · 내부 메모로 쓰기 · 사진 · 「Airbnb 메시지로 나가요」 · 보내기.
- 오른쪽 패널: 날짜 · 인원 · 채널 · 언어 · 예약 번호(캘린더로) · **업무 만들기**(6-4) · 보낼 자동 안내 순서.
- 상태 화면(States): 직접 예약 답장 불가 · 보낼 차례 기다림(고치기 · 취소) · 보내지 못함(이유 + 다시 보내기) · 받는 통로 멈춤 경고 · 빈 상태.

### 5-2. 모바일 `/mobile/messages` (가칭)

- 폰: 목록 → 대화(뒤로는 화면 스와이프, 뒤로 단추 없음). 예약 정보는 위 한 줄 → 공용 `BottomSheet`.
- 폴드: 레일 + 목록 + 대화. 태블릿: 사이드바 + `SplitList`(목록 + 대화 칸).
- 아래 탭 · 메뉴 · 레일에 「답장 기다림」 숫자.
- Q1 확정 (2026-11-12 사용자): 폰 대화 화면도 아래 탭을 둔다(셸 계약 그대로).

### 5-3. 자동 안내 (PC 탭)

- 안내 목록: 이름 · 보내는 때 · 다음 발송 · 켜기.
- 편집: 보내는 때(예약 확정 직후 / 체크인 N일 전 HH:MM / 당일 / 체크아웃 N일 전 / 체크아웃 다음 날, **도쿄 시간**) · 대상(건물 · 채널 · 예약 상태) · 언어별 문구(한국어 · 日本語 · English, 다른 언어 손님은 English) · 변수 넣기 · 미리 보기.
- **빈 변수 막기**: 그 건물 값이 비어 있으면(예: 건물 비밀번호) 그 건물에는 보내지 않고 미리 보기에 빨간 글자로 알린다.
- 직접 예약은 보내지 않는다(어댑터가 막음). 취소된 예약은 큐에서 빠진다.
- 보낼 예정 목록에서 예약 하나만 멈출 수 있다(예: 이미 도착한 손님).
- 구현 · 결정은 §5-6.

### 5-4. 구현 (2단계, 2026-11-13)

| 파일 | 하는 일 |
| --- | --- |
| `src/app/admin/messages/page.tsx` · `src/components/admin/messages/messages-console.tsx` | PC 3칸(목록 · 대화 · 예약 패널). 필터 = 공용 `AdmDropdown`(상태 · 건물 · 채널), 고른 대화는 `?c=`, 채널은 `?channel=`. 「나중에」 팝오버 = 1시간 · 3시간 · 내일 9시 + 공용 `AdminDatePicker` · `AdminTimePicker`(도쿄). 「처리 끝」은 줄 접힘 + `AdminUndoToast` 되돌리기. 볼 권한 없으면 `AdminNoAccess`. 탭은 2단계엔 「대화」 하나라 탭 줄을 그리지 않는다 |
| `src/app/mobile/messages/page.tsx` · `[id]/page.tsx` · `loading.tsx` 둘 · `src/components/guest-messages/mobile-messages.tsx` | 폰 · 폴드: 목록 → 대화 화면(제목 줄 누르면 예약 정보 `BottomSheet`, 처리 끝 아이콘, 「더 보기」 시트 = 나중에 · 예약 정보). 태블릿 가로: 공용 `SplitList`(`split`, 상세 주소 `messages`) — 오른쪽 칸 안은 같은 대화 화면(칸 모드). 칸에서 처리 끝 · 나중에를 누르면 서버를 기다리기 전에 왼쪽 줄이 접힌다(`postMessage`, 실패하면 다시 펴짐). 답장 칸은 아래에 붙는다(sticky `bottom: 0` — 이 화면만 셸 본문 아래 여백을 폰 = 탭바 자리 `--tabbar-h + 12px`, 폴드 · 칸 = 0 으로 줄여 탭바 바로 위에 붙고 그 밑 빈 칸이 없다. 새 말이 오면 셸 스크롤 칸을 끝까지 내려 마지막 말이 답장 칸 위에 보인다). 폰 대화 머리 밑 한 줄 = 채널 · 방 · 예약 상태. 번역 아이콘 → 볼 언어 고르기 시트. 토스트 = `TaskToast`(공용 움직임) |
| `src/components/guest-messages/gm-parts.tsx` · `gm-format.ts` · `use-thread.ts` · `guest-messages.css` | PC · 모바일 공용 — 목록 줄 · 대화 줄(번역 보기 · 원문 보기 · 내부 메모 자물쇠 · 보낼 차례 기다림 고치기/취소 · 보내지 못함 다시 보내기 · 모름 확인 창) · 답장 칸(내부 메모 전환 · 번역 미리 보기 · 번역 실패 시 「쓴 글 그대로 보내기」) · 직접 예약 막힘 안내(이메일 복사) · 예약 정보 줄. 시각은 모두 도쿄 |
| `src/actions/guest-messages.ts` | 서버 액션(PC · 모바일 공용, 문서 CLAUDE.md `src/actions`). 권한: 읽기 · 번역 = `guest_messages.view`, 답장 · 메모 · 처리 끝 · 나중에 · 큐 고치기 = `view + reply`. **관리자 웹 권한은 요구하지 않는다**(§8 — 알바에게 개인 부여 가능). 모든 쿼리 `organization_id` 로 거름(service_role) |
| `src/lib/guest-messages/inbox-model.ts` | 순수 — 목록 상태(끝난 「나중에」 = 답장 기다림) · 정렬(목표 넘음 → 목표 비율 → 오래 기다림) · 「나중에」 시각(도쿄, 미래 · 30일 안 · 없는 날짜 거절) · 보낼 수 있는 채널(어댑터 `outboundChannelRefusal` 과 같음) · 번역 언어 |
| `src/lib/guest-messages/inbox-server.ts` | 목록(열린 대화 ≤500 + 처리 끝 ≤200, 미리 보기 한 줄은 DB 함수 `guest_conversation_last_lines` — 대화마다 한 줄) · 대화(메시지 ≤300 · 큐 상태 · 작성자 이름(**이 조직 구성원만**) · 보는 사람 언어 번역 · 예약 인원) 읽기 · 메뉴 숫자(RLS 서버 클라이언트) |
| `src/lib/guest-messages/outbox-runner.ts` | 발송 작업 — ① 10분 넘게 `sending` 인 줄(`claimed_at`)은 `uncertain`(`stuck`, 다시 안 보냄) ② 줄 잡기(`queued → sending` + `claimed_at`, **보낼 글은 잡을 때 돌려받은 값** — 읽은 뒤 고친 글이 옛 글로 나가지 않게) ③ `processOutboxBatch` ④ 결과 저장(`status = sending` 조건, 저장 실패 → `uncertain`(`save_failed`), 맞는 줄 0개 → 로그) ⑤ `sent` 면 대기 메시지 줄에 번호 잇기 → `guest_conversation_apply_messages`. 어댑터가 던지면 잡은 줄을 `uncertain` |
| `src/app/api/guest-messages/outbox/route.ts` | 발송 작업 수동/예약 실행용(`CRON_SECRET` 또는 pg_cron 토큰 Bearer, 둘 다 없으면 404, 플래그 꺼지면 202). 보내기 · 다시 보내기 뒤 `after()` 로 돌고, 정기 실행은 `202611130006`(pg_cron 5분, 보낼 시각이 된 queued 줄 · 멈춘 sending 줄이 있을 때만 부름 — **미적용**). 읽기는 부작용 없음 |
| `src/lib/review-translate.ts` | `deeplTranslate()` 를 꺼내 리뷰 · 손님 메시지가 같은 키 · 같은 월 한도를 쓴다. 한도 = 리뷰 번역 글자 + `translation_usage` 합(DB 함수 `translation_usage_since` 한 번). 그 합을 못 읽으면 리뷰 번역은 **예전처럼 리뷰 글자만**, 손님 메시지(`strict`)는 번역 안 함 |
| `src/lib/nav-badges.ts` · `src/app/admin/layout.tsx` · `src/config/navigation.ts` | 메뉴 「손님 메시지」(모바일 사이드 메뉴 · PC 운영 묶음) + 숫자 = 답장 기다림(볼 권한 있을 때만) |
| `scripts/dev/seed-guest-messages.mjs` | 시험 데이터 8개 대화(Airbnb · Booking.com · 직접 예약 · 문의 · 숙박 중 · 목표 넘음 · 나중에 · 처리 끝 · 내부 메모 · 보내지 못한 답장). **운영 ref 면 멈춘다.** `--org <uuid>`(계획만) · `--apply` · `--reset` |

**2단계 결정(구현 중, 2026-11-13 — 리뷰에서 바꿀 수 있음)**

- **보낸 답장이 실제로 나갈 때까지 대화는 「답장 기다림」**. 발송 작업이 `sent` 를 저장할 때 DB 함수가 처리 끝으로 바꾼다. 플래그가 꺼져 있으면 답장은 「보낼 차례 기다림」으로 남고 대화도 기다림 그대로 — 실제로 안 나간 답장을 「처리됨」으로 보이지 않게.
- **발송 플래그 `GUEST_MESSAGES_SEND_ENABLED=1`**: 꺼져 있으면 큐에 쌓기만 하고 Beds24 를 부르지 않는다(화면 안내 「발송이 아직 꺼져 있어요」). 켜는 것은 V1~V4 확인 뒤 사용자 허락.
- **태블릿 가로는 공용 `SplitList`**(상세 주소가 있는 화면 규칙, 16). 폴드는 폰처럼 넘어간다.
- **폰 대화 화면도 아래 탭을 둔다**(Q1 확정 (2026-11-12 사용자) — 셸 계약 그대로). 답장 칸은 탭바 바로 위에 붙는다.
- 손님 말 번역은 **언어마다 한 줄**(`guest_message_translations`, (메시지, 언어) 기본키) — 없는 언어만 채우고 덮지 않는다(보기 권한만으로도 안전). 「번역해서 보기」는 한 줄씩 번역하다 한도 소진 · 오류가 나면 멈추고, 실패한 줄은 자동으로 다시 부르지 않는다(「번역」 눌러야). 답장 줄의 `body_translated` 는 직원이 쓴 원문(번역해서 보낸 경우).
- 답장 넣기는 DB 함수 `guest_message_enqueue_reply` 하나로(큐 줄 + 대기 메시지 줄, 그 사이 발송 작업이 끼지 못함). 같은 키 + 같은 글 = 첫 줄, 같은 키 + 다른 글 = `stale`. 화면은 글이 바뀌면 새 키를 쓰고, 번역문도 서버와 같은 4,000 코드포인트로 미리 막는다.
- 「나중에」가 끝나 「답장 기다림」으로 보이는 대화에 답장이 나가면 처리 끝(DB 함수 다시 정의, 앱 거울 `nextConversationState` 도 같이).
- 보낸 답장 취소(`queued` · `failed`)는 아직 안 나간 대기 메시지 줄을 **지운다**(hard delete — 기본 삭제 정책). 큐 줄은 `cancelled` 로 남는다.
- **어느 OTA 인지 글자로 보인다**(2026-11-13 사용자 요청 — 점만으로는 모름). 목록 줄 아래 줄 맨 앞에 「● Airbnb」 · 「● Booking.com」 · 「● 직접 예약」(점은 채널 색 #FF5A5F · #003B95 · #8B8898, 글자는 진한 회색 — 칩 · 테두리 없음, 색 글자는 흰 바탕 대비가 4.5:1 이 안 돼 쓰지 않는다). 대화 머리(PC 이름 밑 · 폰 제목 밑 한 줄)와 예약 정보(PC 패널 · 폰 시트 「채널」 줄)에도 채널 이름. Airbnb · Booking.com · Expedia · Agoda · Vrbo 는 상표라 번역하지 않고, 「직접 예약 · 그 밖 · 모든 채널」은 사전(ko · ja · en).
- **채널 필터**(PC `AdmDropdown` · 모바일 드롭다운, 상태 · 건물 옆): 모든 채널 / Airbnb / Booking.com / 직접 예약 / 그 밖(Expedia · Agoda · Vrbo · 모르는 채널 · 비어 있음). 주소 `?channel=airbnb|booking|direct|other`(모르는 값 = 모든 채널). 머리 숫자(답장 기다림 · 목표 넘음)도 채널 · 건물 필터를 따른다. 판정 `matchesChannelFilter()`(`inbox-model.ts`).
- 아직 안 한 것: 읽음 표시(`markRead`) · 사진 첨부 보내기 · 그룹 예약 묶어 보기. 발송 작업 정기 실행은 `202611130006`(pg_cron 5분, 미적용 — §10). (정해 둔 문구 · 건물 정보 넣기는 3 · 4단계에 붙였다 — §5-5.)

### 5-5. 구현 (3 · 4단계, 2026-11-13)

| 파일 | 하는 일 |
| --- | --- |
| `src/app/admin/messages/page.tsx` | 탭 대화 · 정해 둔 문구 · 설정(`?tab=replies` · `?tab=settings`, **관리 권한만** — 없으면 탭 줄 없이 대화만, 주소로 와도 대화). `maxDuration = 300`(설정 탭 과거 메시지 가져오기의 `after()`) |
| `src/components/admin/messages/messages-settings.tsx` | 설정 탭(시안 R2Settings) — 왼쪽 응답 목표(문의 · 예약 요청 · 숙박 중 · 확정 · 그 밖, 숫자 + 분/시간 `AdmDropdown`, 5분~24시간) · 밤에는 세지 않기 스위치 · 저장. 오른쪽 Beds24 연결 — 크레딧 막대(쓴 양 · 남겨 둔 양, 한도 200 가정 · 남은 값이 더 크면 그 값) · 다시 채워지기까지 · 마지막 웹훅 / 메시지 웹훅 / 보정 확인 · 보낼 차례 기다림 수 · 최근 7일 보내지 못함(누르면 그 대화) · 남겨 둘 양(10~150) · 멈춤 기준(1~72시간) · 저장. 아래 「과거 메시지 가져오기」(재기 · 시작 · 이어서 · 처음부터, 확인 창, 도는 동안 4초마다 상태). **보는 것만으로 Beds24 를 부르지 않는다**(기록된 값만) |
| `src/components/guest-messages/stall-notice.tsx` | 목록 위 「받는 통로 멈춤」 줄(PC 목록 · 모바일 목록 머리, 관리 권한만) — 마지막 웹훅 뒤 `stall_hours` 가 지났거나 한 번도 안 왔을 때만. 「지금 확인하기」 = 보정 조회 한 번 |
| `src/actions/guest-messages-settings.ts` | `checkGuestMessagesNow()`(PC · 모바일 공용, `guest_messages.manage`) — 1분에 한 번(`settings.lastManualCheckAt` 을 조회 **전에** 남김 → 실패해도 연타로 크레딧이 안 나감), 이 조직만 보정 조회. 크레딧 · 쿨다운 판단은 보정 조회 그대로 |
| `src/app/admin/messages/actions.ts` | PC 탭 전용 — 설정 저장(`settings` 의 다른 키는 남김) · 문구 만들기/고치기/지우기(hard delete)/순서. 관리자 웹 + `guest_messages.manage`, 아니면 `forbidden` |
| `src/components/admin/messages/saved-replies-manager.tsx` | 정해 둔 문구 탭 — 왼쪽 목록(위/아래로 순서) · 오른쪽 편집(제목 · 언어 탭 한국어/日本語/English · 변수 넣기 단추 · 지우기 확인 · 저장 안 한 채 나가기 확인). 세로 구분선 없음(목록 칸 바탕만 다름) |
| `src/components/guest-messages/composer-inserts.tsx` · `gm-parts.tsx` | 답장 칸 「정해 둔 문구」 · 「건물 정보 넣기」 — PC 는 답장 칸 위 팝오버, 폰 · 폴드 · 태블릿은 공용 `BottomSheet`. 누르면 **커서 자리에 넣는다**(덮지 않음). 열 때마다 다시 읽는다(`getComposerInserts`, 앞 값은 읽는 동안 그대로 · 패널 저장 뒤 바로 다시). 빈 칸은 「비어 있음」으로 흐리게(누를 수 없음). 직원만 보는 출입 코드는 자물쇠 묶음으로 따로(「손님에게 보내도 되는지 확인하고 넣어요」). 「건물 정보 고치기」(PC · `property_info.edit`) → 건물 손님용 정보 패널, 「문구 관리」(관리 권한) → 정해 둔 문구 탭 |
| `src/actions/guest-messages-compose.ts` | `getComposerInserts(conversationId)`(`view + reply`) — 언어마다(ko · ja · en) 건물 정보 넣기 글(와이파이 꼴은 그 언어 사전) · 문구(변수 채움) · 건물 이름(그 언어로) · 직원용 코드(공용 출입 코드 + 이 방 코드) |
| `src/components/admin/messages/building-guest-info-panel.tsx` | 건물 손님용 정보 오른쪽 패널(공용 `.panel`) — 와이파이 이름 · 비밀번호(모든 언어 같은 값) + 언어 탭별 체크인 · 체크아웃 · 짐 보관 · 쓰레기 · 주차 · 길 안내 · 그 밖 안내 + 직원만 보는 정보 요약. 저장은 본 버전일 때만(충돌이면 쓴 글은 두고 「최신 값 불러오기 / 내 글로 덮기」). 출입 코드는 개수만 받는다. 메시지 답장 칸과 **예약 캘린더 「건물 정보」 카드의 「손님용 정보」** 둘 다에서 연다 |
| `src/lib/guest-messages/guest-info-model.ts` · `guest-info-server.ts` | 손님용 칸 모양 · 검사(길이 넘으면 자르지 않고 거절: 짧은 칸 120 · 글 500 · 그 밖 안내 2,000) · 언어 고르기 · 넣기 목록 · 읽기/저장(`guest_info_updated_at` 버전) |
| `src/lib/guest-messages/saved-reply-model.ts` · `saved-replies-server.ts` | 문구 검사(제목 1~80 · 본문 2,000 · 언어 하나 이상) · 변수 `{guest_name}` `{checkin_date}` `{checkout_date}` `{nights}` `{building}` `{room}` 채우기(날짜는 그 언어 꼴 「11월 20일 / 11月20日 / Nov 20」) · 조직마다 200개 |
| `src/lib/guest-messages/settings-model.ts` · `channel-overview-server.ts` | 설정 값 범위 · 분↔시간 · 멈춤 판정 · 크레딧 막대 계산 · 연결 상태 한 번에 읽기 |

**3 · 4단계 결정(구현 중 — 리뷰에서 바꿀 수 있음)**

- **넣는 언어** = 대화의 손님 언어(ko · ja · en, 그 밖 = 영어). **단, 답장을 번역해서 보낼 때는 직원 언어로 넣는다** — 넣은 글이 다시 번역되어 두 번 번역되지 않게(`insertLanguageFor()`). 그 언어 값이 비면 영어, 영어도 비면 「비어 있음」.
- 와이파이 이름 · 비밀번호는 언어와 상관없는 값 하나(꼴만 언어별: 「와이파이: … / 비밀번호: …」).
- 문구 변수 값이 없으면(예: 문의라 방이 없음) **변수 글자를 그대로 남기고** 토스트로 알린다 — 직원이 보고 고친다(빈 칸으로 몰래 지우지 않음).
- 손님용 칸은 **버전을 따로**(`guest_info_updated_at`) — 직원용 출입 코드 저장과 손님용 정보 저장이 서로를 「다른 사람이 고쳤어요」로 막지 않게(DB 트리거가 바뀐 쪽 시각만 올린다).
- 출입 코드는 손님용 넣기 목록에 섞지 않고 직원용 묶음에서만 넣는다(§6-3 그대로).
- 크레딧 남겨 둘 양은 10(낮은 크레딧 선) 아래로 못 내린다 · 150 까지. 멈춤 「한 번도 안 옴」도 경고로 보인다. 「지금 확인하기」는 1분에 한 번.
- 「한국어에서 번역해 채우기」(DeepL 로 ja · en 칸 채우기)는 **하지 않았다** — 직원이 언어별로 직접 쓴다.
- 폰에서는 「건물 정보 고치기」가 없다(패널은 PC 전용). 폰 · 폴드 · 태블릿 답장 칸: 도구 줄(정해 둔 문구 · 건물 정보 · 내부 메모)은 좁으면 다음 줄로 넘어가고(가로 스크롤 없음), **번역 언어 드롭다운은 입력 칸 아래 안내 글 줄**에 있다.

**리뷰 반영(2026-11-13)**

- `{room}` · `{building}` 둘 다 언어마다(`localizeRoomPlaceLabel` · `localizeBuildingName`) — 한 채 건물은 방 라벨이 건물 이름이라 그대로 두면 일본어 · 영어 답장에 한국어가 나갔다. 직원용 방 코드 이름도 보는 사람 언어로.
- 손님용 정보 저장이 건물 줄을 **처음 만들면** `staff_info_saved = false`(직원 칸은 기본값). 그 뒤 「줄 없음」 화면에서 연 출입 코드 저장은 23505 충돌 대신 그 줄을 고친다. 사람이 직원 칸을 저장한 줄이면 지금처럼 충돌. 직원 칸이 바뀌면 트리거가 true 로.
- 충돌 때 **쓴 글을 지우지 않는다** — 건물 손님용 정보 패널 · 정해 둔 문구 편집 모두 「최신 값 불러오기 / 내 글로 덮기」(덮기 = 최신 버전으로 다시 저장). 문구 고치기도 `updated_at` 버전 조건(순서만 바뀌면 버전은 그대로 — 트리거).
- 고친 채로 패널을 닫으면(바깥 · X · Esc · 닫기) 확인 창. 건물이 바뀌면 패널이 읽는 중부터 새로. 저장 성공 · 실패 햅틱.
- 답장 칸 넣기 목록은 **열 때마다** 다시 읽고, 패널에서 저장하면 바로 다시 읽는다.
- 「지금 확인하기」 1분 간격은 DB 함수 `guest_message_claim_manual_check`(줄 잠금 안에서 확인 + 기록 — 동시에 눌러도 조회 한 번), 설정 저장은 `guest_message_save_settings`(`settings` 의 응답 목표 키만 바꿈), 문구 순서는 `guest_message_saved_replies_reorder`(unnest with ordinality, update 한 번). 순서 단추는 저장 중 막힘.
- 건물 패널로 가는 값에는 **출입 코드 값이 없다**(개수만, `toGuestInfoView`).
- 크레딧 막대 한도: 헤더가 한도를 주면(`x-five-min-limit`) 그 값, 아니면 200 으로 **추정**하고 「(한도는 추정)」을 붙인다(지금 Beds24 는 남은 양만 준다).


### 5-6. 구현 (5단계 자동 안내, 2026-11-13)

| 파일 | 하는 일 |
| --- | --- |
| `supabase/migrations/202611130004_guest_messages_auto.sql`(운영 적용 2026-11-13) | 표 `auto_message_rules`(규칙) · `auto_message_runs`(규칙 × 예약 한 줄, `UNIQUE(rule_id, provider, provider_booking_id)`) · 발송 큐 `rule_id` 외래 키 · 서버 전용 함수 `guest_message_enqueue_auto`(줄 잠금 → `scheduled` 일 때만 큐 + 대기 줄, 멱등 키 `auto:<run id>`) |
| `src/lib/guest-messages/auto-model.ts` | 순수 — 보낼 시각(도쿄 `+09:00`, 달 · 해 · 윤년) · 규칙 검사 · 대상 판정 · 변수 채우기(손님 언어, 그 밖 = 영어) · 계획 `planAutoRun()` · 화면 상태 |
| `src/lib/guest-messages/auto-scheduler.ts` | 계획 바퀴 `runAutoMessagePlanner()`(오늘 ± 32일 예약 × 켜진 규칙) · 보낼 시각이 된 줄 큐에 넣기 · 웹훅 뒤 계획만 `planAutoMessagesAfterWebhook()`(켜 둔 규칙이 있는 조직만 — 하나도 없으면 예약을 읽지 않고 끝남) |
| `src/lib/guest-messages/auto-rules-server.ts` · `src/app/admin/messages/auto-actions.ts` | 규칙 만들기 · 고치기(버전 충돌) · 켜기 · 지우기 · 미리 보기 · 보낼 예정 목록 · 예약 하나 멈추기 |
| `src/app/api/guest-messages/auto/route.ts` | 정기 작업 입구(`CRON_SECRET` 또는 pg_cron 토큰 Bearer — `cron-auth.ts`). 계획 → (발송 플래그 켜졌을 때만) 큐 넣기 → 발송 작업. 정기 실행은 `202611130006`(pg_cron 5분, 켜 둔 규칙이 있을 때만 부름 — **미적용**) |
| `src/components/admin/messages/auto-messages-manager.tsx` · `src/components/guest-messages/auto-runs-list.tsx` · `auto-format.ts` | PC 「자동 안내」 탭(목록 + 켜기 · 보낼 예정 목록 + 규칙 고르기 · 편집 = 보내는 때 `AdmDropdown` + 날 수 + `AdminTimePicker` · 대상 드롭다운 3개 · 언어 탭 · 변수 넣기(출입 코드 묶음 따로) · 미리 보기(빈 변수 빨강)) · 대화 오른쪽 패널 「보낼 자동 안내」(멈추기 · 다시 보내기) · 모바일 예약 정보 시트(읽기만) |

결정(확정 (2026-11-12 사용자)):

- **큐에 넣는 것은 발송 플래그(`GUEST_MESSAGES_SEND_ENABLED=1`)가 켜졌을 때만.** 꺼져 있으면 계획(보낼 예정 · 막힘 표시)만 하고 큐에 쌓지 않는다 — 켜는 순간 밀린 안내가 한꺼번에 나가지 않게.
- 웹훅은 그 예약만 **계획만** 다시 한다(큐 넣기 · 발송 없음, 실패는 삼킴). 큐 넣기는 정기 작업 입구에서만.
- **규칙을 끄면 그 자리에서** 그 규칙의 아직 안 나간 줄(보낼 예정 · 막힘 · 멈춤)을 `cancelled` + `rule_disabled` 로 닫는다(`setAutoRuleEnabled`) — 켜 둔 규칙이 하나도 안 남으면 정기 실행이 계획 바퀴를 부르지 않아 「보낼 예정」에 남아 있던 것. 큐에 들어간 줄 · 보냄 · 못 보냄은 그대로(큐 줄은 화면에서 취소).
- **6시간 넘게 늦으면 보내지 않는다**(`past_due`). 이미 지난 시각의 새 줄은 만들지 않는다(규칙을 처음 켤 때 지난 손님에게 몰아서 가지 않게).
- 「예약 확정 직후」는 **규칙을 켠 뒤에 들어온 예약만**(켜기 전 예약에 감사 인사가 한꺼번에 가지 않게). 시각은 처음 본 순간, 다시 계획해도 그대로.
- 새 규칙은 **꺼진 채로** 저장된다. 켜면 `enabled_at` 이 찍힌다. 끄면 보낼 예정 줄은 `cancelled`(rule_disabled). 지우기는 하드 삭제(실행 줄도 같이, 큐 줄의 `rule_id` 는 비움).
- 큐에 넣은 뒤(`queued` · `sent` · `failed`)는 계획이 건드리지 않는다. 취소 · 대상 아님은 `cancelled`, 직접 예약 · 채널 모름 · 언어 글 없음 · 빈 변수 · 늦음은 `skipped` + 이유(목록에 보임). 빈 변수는 값을 채우면 다음 계획에서 다시 `scheduled`.
- 예약 하나 멈추기는 `guest_messages.manage` 또는 `view + reply`(답장하는 사람이 「이미 도착한 손님」을 멈출 수 있게). 규칙 · 미리 보기는 `manage` + 관리자 웹.
- 자동 안내가 나가도 대화를 「처리 끝」으로 닫지 않는다(답장 시각을 남기지 않음 — 손님 질문을 기다리는 대화가 그대로 남게). 되돌아온 자동 안내 메아리도 답장으로 치지 않는다.
- 출입 코드(`{entry_code_shared}` · `{entry_code_room}`)는 자동 안내 변수로만. 공용 코드가 여럿이면 「이름 코드 / …」.
- 발송 순위는 그대로: 직원 답장 → 자동 안내, 자동 안내는 크레딧 선 아래면 큐에 둔다(§4-1).

**독립 리뷰 반영(2026-11-13)**

- **1,000줄 상한**: 기존 실행 줄은 예약 묶음 크기를 `floor(1000 / 규칙 수)` 로 나누고 끝까지 `.range()` 로 넘긴다. 범위 예약 · 규칙 요약 숫자도 끝까지 넘긴다. 큐에 넣기 직전에 지금 데이터로 다시 계획해서 **바라는 시각이 줄의 시각과 같고 지금 보낼 차례일 때만** 넣는다(다르면 줄만 고치고 다음 바퀴).
- **범위 밖 예약**: 큐 넣기는 보낼 시각에서 6시간 안의 줄만 읽고(`gte`), 이번 범위(오늘 ± 32일)에 없는 예약은 실행 줄의 예약 번호로 따로 읽는다(확정 직후의 먼 미래 예약 등). 예약 행이 없으면(지워짐) `cancelled`. 전체 바퀴마다 6시간 넘게 지난 `scheduled` 줄은 한 번에 `past_due`.
- **보내기 직전 검사**: 발송 작업이 잡은 자동 안내 줄의 원래 보낼 시각이 6시간 넘게 지났거나(크레딧 선 · 429 로 밀림) 예약이 취소됐으면 보내지 않는다 — 큐 줄 `cancelled`(`auto_past_due` · `auto_cancelled`) · 대기 메시지 줄 지움 · 실행 줄 `skipped past_due` / `cancelled`. 밀린 자동 안내는 `queued` 로 돌아가 다음 발송 작업(보내기 뒤 · `/api/guest-messages/outbox` · `/api/guest-messages/auto`)이 다시 집고, 그때마다 이 검사를 지난다.
- **답장 먼저 읽기**: 발송 작업은 직원 답장을 먼저 읽고 남은 자리를 자동 안내로 채운다(자동 안내가 밀려 있어도 답장이 빠지지 않게).
- **멈춤 경합**: DB 함수는 `paused_at` 이 있으면 넣지 않는다. 계획이 줄을 고칠 때는 읽을 때의 멈춤 상태 그대로일 때만(`paused_at is null` / `is not null`).
- **확정 직후**: Beds24 `bookingTime`(있으면, UTC)이 규칙을 켠 뒤일 때만 — 없으면 우리 예약 행이 생긴 순간. 체크아웃(도쿄)이 오늘 이후인 예약만.
- **트리거 바뀜**: 실행 줄에 계획할 때의 트리거(`rule_trigger`)를 남기고, 규칙의 트리거가 바뀌면 처음 계획하는 것처럼 시각을 다시 정한다.
- **숫자 상태**: Beds24 `3` = 예약 요청 · `5` = 문의(`src/lib/beds24/reservation-status.ts` 와 같다).
- **줄 고치기 묶음**: 바뀐 내용이 같은 줄끼리 `.in('id', …)` 한 번(규칙을 끄면 수백 줄이 한 번에). 상태 · 시각이 그대로여도 사본(손님 이름 · 방 · 날짜)이 바뀌면 고친다(큐에 넣은 뒤 줄도 사본만).
- **웹훅 찾기**: 원본 예약 번호만 오면 방 나눔 사본(`70001::room::201`)까지 앞부분으로 찾는다(숫자 번호만).
- **출입 코드 가리기 — Q10 확정 (2026-11-12 사용자)**: 대화 · 목록 한 줄에서 자동 안내 글의 출입 코드 값을 `guest_messages.manage` 또는 `property_info.edit` 가 없는 사람에게는 「••••」로 가린다(그 건물 코드 값 · 3자 이상, 코드를 못 읽으면 숫자 묶음 전부). 목록 한 줄은 자동 안내인지 알 수 없어 우리 쪽 말 전부에 같은 규칙. 자동 안내 큐 줄 고치기 · 취소 · 다시 보내기는 manage 만(화면 단추도 숨김). 손님에게 나가는 글은 그대로.
- **묶음 예약 — Q11 확정 (2026-11-12 사용자)**: 같은 `masterId` 의 예약은 한 번만 — 대표(살아 있는 대표 예약, 없으면 살아 있는 방 중 번호가 가장 작은 것)로 보내고, `{room}` 은 묶음의 방 전부(「201 / 202」), `{entry_code_room}` 은 방마다(「201 코드 / 202 코드」 — 한 방이라도 없으면 빈 변수로 막힘), `{guests}` 는 합. 다른 방은 실행 줄을 만들지 않고 있던 줄은 `cancelled(not_target)`. 웹훅으로 한 방만 와도 같은 묶음을 더 읽는다.

### 5-7. 구현 (6단계 메시지 → 업무, 2026-11-13)

| 파일 | 하는 일 |
| --- | --- |
| `supabase/migrations/202611130005_guest_message_links.sql`(운영 적용 2026-11-13) | 표 `guest_message_links`(대화 ↔ 업무, `unique (organization_id, target_type, target_id)` · 대화 · 메시지 · 업무가 같은 조직인지 보는 트리거) · `guest_message_saved_replies.purpose`(`'resolved'`, 조직마다 하나 — 부분 고유 인덱스) · 서버 전용 함수 `guest_message_set_resolved_reply` |
| `src/lib/guest-messages/task-link-model.ts` | 순수 — 만들 수 있는 종류(`creatableKinds`) · 미리 채움(`buildTaskPrefill`) · 업무 상태 → 줄(`linkTargetState`) · 「해결됐어요」 고르기(`pickResolvedLink`) · 상세 주소(`linkTargetHref`) |
| `src/lib/guest-messages/task-link-server.ts` · `reply-context-server.ts` | 대화를 열 때 링크 + 업무 상태 읽기(트리거 · 알림 없음) · 링크 넣기(같은 대화로 다시 오면 그대로 성공, 다른 대화면 `conflict`) · 업무 → 대화 · 「해결됐어요」 초안 글 |
| `src/actions/guest-message-tasks.ts` | 공용 서버 액션 — `getTaskFormContext` · `createTaskFromGuestMessage` · `getGuestMessageLinkForTarget`(거부는 `forbidden`, redirect 없음) |
| `src/lib/maintenance-create.ts` · `lost-item-create.ts` · `task-create.ts` | 기능 폼 액션에 있던 검사 · 저장을 **그대로 옮긴 공용 만들기 함수**. 모바일 폼(`/mobile/maintenance/new` · `/mobile/lost-found/new` · `/mobile/tasks/new`)과 메시지 「업무 만들기」가 같이 부른다. 폼 액션은 결과 코드를 예전 redirect 주소로 바꾸기만 한다. 게스트 피드백은 기존 `createComplaint`(`src/lib/complaints.ts`) |
| `src/components/guest-messages/task-create.tsx` | PC 만들기 칸(종류 세그먼트 · 드롭다운) · 폰 종류 목록 · 대화 안 업무 줄 · PC 예약 패널 「업무 만들기」 + 연결된 업무 |
| `src/components/guest-messages/guest-message-back-link.tsx` | 업무 상세의 「손님 메시지에서 · 손님 이름」 링크 |

결정(확정 (2026-11-12 사용자)):

- **권한 = 기존 그대로.** 메시지를 읽어야 하니 `guest_messages.view` 가 있어야 하고, 그 위에 수리 · 점검 · 분실물 · 할 일은 조직 구성원이면(각 기능의 기존 규칙), 게스트 피드백은 `complaint.write`. 서버가 다시 보고(`canCreateKind`), 만들기 함수도 스스로 본다(`createComplaint` 는 `complaint.write`, 할 일은 연결 id 조직 확인).
- **자리 · 예약은 서버가 대화에서 다시 읽는다.** 화면이 보낸 건물 · 방은 수리 · 분실물만 쓰고(활성 방 카탈로그로 다시 검사), 직원이 고른 자리가 예약 자리와 같을 때만 예약을 잇는다. 할 일 · 피드백의 건물 · 방 · 예약 · 손님 이름은 대화 값.
- **같은 만들기를 두 번 보내도 한 건**(응답을 못 받고 다시 누름 포함) — 네 종류 모두 화면이 만든 요청 id(`submissionId`, v4 uuid — `randomUUID` 가 없는 http 사내 주소에서도 `getRandomValues` 로 같은 꼴)를 넘긴다. 수리 · 분실물 · 피드백은 기능의 기존 멱등 규칙, 할 일은 `createTaskRecord` 의 선택 `id`(같은 id 로 다시 오면 **이 사람이 10분 안에 만든 이 조직 · 안 지운 할 일**만 돌려줌. 모바일 새 할 일 폼은 id 를 안 줘서 예전 그대로). 응답이 끊기면 칸에 실패 문구, 다시 누르면 같은 id 라 할 일 · 링크 한 건(화면 확인).
- **남의 업무는 잇지 않는다** — 만들기 함수가 같은 요청 id 로 이미 있는 줄을 돌려주면, 링크를 넣기 전에 그 업무가 **이 조직 · 이 사람이 10분 안에 만든 것**인지 본다(`isOwnFreshTarget`). 아니면 `conflict`(링크 없음). 피드백의 기존 `findBySubmission` 은 다른 화면도 쓰므로 그대로 두고 이 길에서만 막는다.
- **게스트 피드백의 건물 · 방**도 수리 · 분실물과 같은 정본 꼴(예약 → 대화, `placeOf`)로 저장한다 — 대화 칸은 예약 원문(「201_2」 등)이라 피드백 폼이 만든 줄과 꼴이 달라졌다.
- 만든 뒤 그 기능 목록도 새로 그린다(수리 = `/mobile/requests` · `/admin/maintenance`, 분실물 = `/mobile/requests` · `/admin/lost-found`, 할 일 = `/mobile/tasks`, 피드백 = `/mobile/complaints` · `/admin/complaints`).
- 종류를 수리 → 다른 것으로 바꾸면 「건물 전체」 방 선택은 풀린다(다른 종류는 건물 전체가 없다).
- **링크만 실패하면** 업무는 남기고 「만들었지만 이 대화에 잇지 못했어요」.
- **수리 · 점검 「급함」 처음 값** = 지금 숙박 중인 손님(도쿄 날짜, 체크인 ≤ 오늘 < 체크아웃). 할 일 「급함」은 우선순위 `urgent`.
- **할 일은 참여자만 보는 기록**이라 대화 줄 · 패널에는 할 일 제목을 그 사람이 참여자일 때만 보인다(상태는 누구에게나). PC 는 할 일 콘솔 `/admin/tasks?task=<id>`(그 작업의 오른쪽 상세 칸을 열고 시작 — 볼 수 없는 id 는 무시), 모바일은 `/mobile/tasks/<id>`.
- **업무 상태는 대화를 열 때 읽는다**(트리거 · 알림 없음). 줄: 「수리 · 점검 · 처리 끝 · 제목 · 시각 · 열기」 — 종류는 굵게, 상태 · 시각은 회색, 지워진 업무는 「지워짐」(열기 없음).
- **「해결됐어요」 초안** — 끝난 업무(수리 `closed` · 분실물 `returned` · 할 일 `completed` · 피드백 `resolved`. 무효 · 폐기 · 취소는 아님) 중 가장 최근에 끝난 것이 있고 **그 뒤로 우리 답장이 없을 때만**, 빈 답장 칸에 글을 넣어 둔다(「수리 · 점검 끝 · 초안」 라벨 + 「자동으로 보내지 않아요」). **보내지 않는다** — 보내기는 언제나 직원이 누른다. 글 = 「해결됐어요」로 표시한 정해 둔 문구(PC 정해 둔 문구 편집의 체크, 조직마다 하나 · 변수는 대화 값), 없으면 사전 기본 문구(업무 종류마다). 넣는 언어는 정해 둔 문구 넣기와 같은 규칙(번역해서 보내면 직원 언어, 아니면 손님 언어 — §9).
- 폰은 「더 보기」 → 「업무 만들기」 → 종류 → 만들기 칸, 칸 안 「손님 말 고르기」가 시트를 닫고 고르기 모드(말풍선을 눌러 붙이기 · 「완료」로 칸에 돌아옴). 만들기 칸 시트는 안에서 스크롤(태블릿 가운데 카드에서 「만들기」가 밖으로 밀리지 않게).
- **고르기 모드를 다녀와도 쓰던 값이 남는다** — 고친 제목 · 내용 · 급함 · 분류 · 건물 · 방 · 요청 id 를 대화 화면이 들고 있다가(`TaskFormDraft`) 칸이 다시 열리면 이어 쓴다. 만들기에 성공하거나, 시트를 직접 내리거나, 고르기를 취소하면 비운다.
- **저장 중에 시트를 내려도** 결과는 사라지지 않는다 — 성공이면 평소 토스트, 실패면 실패 문구를 토스트로(PC 패널을 닫았을 때도 같음). 다른 시트처럼 닫기를 막지 않는 이유: 공용 `BottomSheet` 는 닫는 움직임이 끝난 뒤 `onClose` 를 불러 막으면 보이지 않는 시트가 남는다.
- 「해결됐어요」 문구 표시 바꾸기는 DB 함수 `guest_message_set_resolved_reply` 한 번(지우기 + 붙이기가 한 트랜잭션, 서버만 실행). 링크 트리거는 업무 표(종류마다)에 같은 조직 줄이 있는지도 본다.
- **알고 둔 한계**: ① 같은 요청 id 를 **10분 넘게 지나** 다시 보내면(앱을 오래 열어 두고 다시 누름) 할 일은 이미 있는 줄을 돌려주지 않고 `conflict` 로 끝난다 — 만든 할 일은 남아 있고 링크만 안 생긴다(새로 만들면 된다). ② 두 사람이 동시에 다른 문구를 「해결됐어요」로 표시하면 한 쪽은 고유 인덱스에 걸려 실패 문구가 뜬다 — 다시 누르면 된다.

## 6. 추가 기능 (D5)

### 6-1. 응답 목표 시간

- 설정: 예약 상태별 목표 — 시안 기본값 문의 30분 · 예약 요청 30분 · 숙박 중 1시간 · 확정 · 그 밖 2시간(관리자가 고침). 「밤에는 세지 않기」(23:00–07:00 도쿄) 스위치를 시안에 넣었다 — 기본값은 꺼짐(Q4 확정 (2026-11-12 사용자)).
- 「기다린 시간」 = 마지막 손님 말 이후 우리 답장(또는 「처리 끝」)이 없는 시간. 내부 메모는 답장으로 치지 않는다.
- 구현 `computeWaiting(conversation, settings, now)`(`src/lib/guest-messages/response-target.ts`) → `{ waitingMinutes, targetMinutes, ratio, overdue }`.
  분류: Beds24 상태 `inquiry` → 문의, `request` → 예약 요청, 도쿄 날짜로 체크인 ≤ 오늘 < 체크아웃 → 숙박 중, 그 밖. `done` · 답장 이후 · 「나중에」가 안 끝났으면 0.
  「나중에」가 끝났으면 그 시각부터 다시 센다(직원이 그때 보겠다고 정했으니 — 1단계 결정). 목표를 **넘으면**(`>`) overdue. 밤 빼기는 도쿄 23:00–07:00, 날 · 달 경계는 `tokyo-date.ts`.
  기본값은 꺼짐(`night_pause = false`, Q4 확정 (2026-11-12 사용자)).
- 목록: 목표 넘으면 빨간 글자(`#c4364b`) + 맨 위. 목표의 80% 를 넘으면 굵게.
- 「처리 끝」: 답장할 필요 없는 말(「감사합니다」 등)은 처리 끝으로 표시해 기다림에서 뺀다. 「나중에」(시각 지정) 도 같은 자리.
- 알림(목표 넘음 → 관리자)은 알림 일괄 구현 때 붙인다(D6). 1차는 화면 표시만.
- 도쿄 시간 기준(CLAUDE.md 7).

### 6-2. 사용량 표시

- 위치: 손님 메시지 「설정」 탭 → 「Beds24 연결」(시안 R2Settings) · 메시지함 목록 위 경고 줄(멈췄을 때만).
- 막대 하나로 5분 사용량(쓴 양 · 메시지용으로 남겨 둔 양)을 보이고, 남겨 둘 양 · 통로 멈춤 기준 시간을 같은 곳에서 고친다.
- 보여 줄 것: 마지막으로 받은 웹훅 시각 · 마지막 보정 조회 · 5분 남은 크레딧(마지막 응답 헤더 기준) · 리셋까지 · 보낼 차례 기다리는 메시지 수 · 최근 실패.
- 숫자는 **Beds24 를 새로 부르지 않고** 이미 받은 응답 헤더를 기록해 보여 준다(보는 것만으로 크레딧이 나가지 않게).
- 「받는 통로 멈춤」: 3시간(Q5 확정 (2026-11-12 사용자) — 실제로 1~2주 써 본 뒤 다시 본다) 웹훅이 하나도 없으면 관리자에게만 경고 줄 + 「지금 확인하기」(보정 조회 1번).
- 권한: 관리 권한(`guest_messages.manage`, 가칭)만.

### 6-3. 건물별 정보 카드

- **새 표를 만들지 않고** 예약 캘린더의 건물 정보(`property_operation_infos` — 공용 출입 코드 · 객실 출입 코드 · 운영 메모, 문서 15 「건물 정보」)를 넓힌다. 편집 권한도 같은 `property_info.edit`.
- 더할 칸(손님에게 보내도 되는 정보, 언어별 ko · ja · en): 와이파이 이름 · 비밀번호 · 짐 보관 · 주차 · 쓰레기 버리는 법 · 체크인 · 체크아웃 시각 · 길 안내 · 자유 칸.
- **손님에게 보내도 되는 칸과 직원용 칸을 나눈다.** 운영 메모는 손님용이 아니다. 출입 코드는 자동 안내 변수로만 쓰고 답장 칸 「넣기」 목록에서는 따로 표시한다.
- 쓰는 곳: 답장 칸 「건물 정보 넣기」(손님 언어로 넣음) · 자동 안내 변수 · 예약 패널.
- **출입 코드를 답장 칸에서 누가 보나 — Q9 확정 (2026-11-12 사용자)**: `guest_messages.manage` 또는 `property_info.edit` 가 있는 사람에게만 직원용 코드 묶음을 준다. 답장 권한만 개인으로 받은 알바 · 야간 직원에게는 안 보인다(코드는 손님에게 잘못 나가면 위험).
- **구현(4단계, 2026-11-13)**: `property_operation_infos.guest_info`(jsonb) + `guest_info_updated_at`(마이그레이션 `202611130003`). 고치는 곳 = 예약 캘린더 「건물 정보」 카드 「손님용 정보」 · 메시지 답장 칸 「건물 정보 고치기」(같은 패널, §5-5).
- 셀프 체크인 건물 비밀번호(사용자 정리 대기 — 메모리)와 같은 값인지 Q6.

### 6-4. 메시지 → 업무 한 번에

- 대화 패널 「업무 만들기」 → 고르기: **수리 · 점검**(08) · **분실물**(09) · **할 일**(28) · **게스트 피드백**(25). PC 는 오른쪽 패널이 만들기 칸으로 바뀌고(시안 R2Task), 폰은 「더 보기」 → 공용 `BottomSheet` 로 종류를 고른다(시안 R2PhoneTask).
- 붙일 손님 말은 대화에서 고른 말(**옅은 보라 바탕** + 「업무에 붙일 말」 — 테두리 · 왼쪽 막대 없음). 처음엔 마지막 손님 말 하나가 붙어 있다.
- 미리 채움: 건물 · 방 · 예약 번호 · 손님 이름 · 고른 손님 말(번역문 + 원문). **손님 사진은 옮기지 않는다** — 1단계부터 첨부는 정보만 저장하고 파일은 Beds24 에 있어, 「손님 사진 n장은 Beds24 에 있어요」로만 알린다(Beds24 에서 받아 오지 않는다).
- 연결: 대화 ↔ 업무를 서로 링크. 대화에는 「수리 · 점검 #123 · 접수됨」 줄이 시스템 줄로 남고, 업무 상세에는 「손님 메시지에서」 링크.
- 업무가 끝나면 대화에 「해결됐어요」 답장 **초안**(정해 둔 문구)을 띄운다 — 자동으로 보내지 않는다.
- 권한: 각 업무를 만들 권한은 그 기능의 기존 권한 그대로(새 권한 없음). 버튼은 권한이 있는 업무만 보인다.
- **구현(6단계, 2026-11-13)** — §5-7.

## 7. 데이터 모델

**1단계 확정**(`202611120002_guest_messages_foundation.sql`, 운영 적용 2026-11-12 — 칸 목록은 `docs/engineering/04-data-model.md` 「손님 메시지」):
`guest_conversations` · `guest_messages` · `guest_message_outbox` · `guest_message_channel_state`.
- 대화에 예약 상태 · 날짜(`booking_status` · `check_in_date` · `check_out_date`)를 사본으로 둔다 — 응답 목표 분류용. 건물 · 객실은 `property_id` · `room_id`(외래 키) + 표시용 `property_name` · `room_label`.
- 메시지에 `provider_source`(통로가 준 출처 원문)를 더했다 — 모르는 출처를 `system` 으로 읽어도 원래 값이 남는다.
- 발송 큐 상태에 `uncertain`(나갔는지 모름 — 다시 보내지 않음)을 더했다. 연결 상태에 `last_reconcile_error` 를 더했다.
- 대화 상태는 DB 함수 `guest_conversation_apply_messages` 로만 바꾼다(서버 경로).
- 설정은 새 표 `guest_message_channel_state`(조직마다 한 줄)에: 응답 목표는 `settings.responseTargetMinutes`(jsonb, 기본 문의 30 · 요청 30 · 숙박 중 60 · 그 밖 120), `night_pause` · `credit_reserve`(20) · `stall_hours`(3) 은 칸.
- **6단계**(`202611130005_guest_message_links.sql`, 운영 적용 2026-11-13): `guest_message_links`(organization_id · conversation_id → 대화 cascade · message_id → 메시지 set null · target_type maintenance/lost_found/task/complaint · target_id(외래 키 없음 — 업무 표가 여럿, 지워지면 화면이 「지워짐」) · created_by · created_at, `unique (organization_id, target_type, target_id)`, 트리거 `guest_message_links_check` 가 대화 · 메시지의 조직을 다시 봄, 읽기 = `guest_messages.view`, 쓰기 = 서버만) · `guest_message_saved_replies.purpose`(`resolved` 하나, 조직마다 하나).
- **5단계**(`202611130004_guest_messages_auto.sql`, 운영 적용 2026-11-13): `auto_message_rules`(읽기 = `guest_messages.manage`, 쓰기 = 서버만, 글이 바뀔 때만 `updated_at` · 켤 때 `enabled_at`) · `auto_message_runs`(읽기 = `guest_messages.view`, 쓰기 = 서버만, 상태 scheduled/skipped/paused/queued/sent/failed/cancelled + `skip_reason` · `missing_variables`) · `guest_message_outbox.rule_id` 외래 키(set null) · 서버 전용 함수 `guest_message_enqueue_auto`. 칸 목록은 04 「손님 메시지」.
- **3 · 4단계**(`202611130003_guest_messages_stage3_4.sql`, 운영 적용 2026-11-13): `property_operation_infos.guest_info` jsonb(기본 `{}`, 객체 · 64KB 이하) + `guest_info_updated_at` + `staff_info_saved` · 트리거 `property_operation_infos_touch()`(직원 칸이 바뀌면 `updated_at` + `staff_info_saved = true`, 손님 칸이 바뀌면 `guest_info_updated_at` 만) · 새 표 `guest_message_saved_replies`(제목 · 언어별 본문 · 순서 · 만든 사람, 읽기 = `guest_messages.view`, 쓰기 = 서버만, 글이 바뀔 때만 `updated_at`) · 서버 전용 함수 `guest_message_claim_manual_check` · `guest_message_save_settings` · `guest_message_saved_replies_reorder`.

기획 때의 초안 표(칸 이름 · 상태 목록)는 **위 실제 마이그레이션으로 대체됐다** — 초안과 달라진 곳: 발송 큐 상태에 `uncertain`, 자동 안내 트리거는 `day_of_checkin`, `auto_message_runs` 는 `(rule_id, provider, provider_booking_id)` 고유(방 나눔 사본이 있어도 예약 하나에 한 번), 설정 · 연결 상태는 `guest_message_channel_state` 한 표. 칸 목록의 기준은 `docs/engineering/04-data-model.md` 「손님 메시지」.

- 모두 organization 범위 + RLS. 손님 개인정보(이름 · 메시지)는 서버에서 권한 확인.
- 보관 기간 · 삭제 정책은 Q7 — 지금은 자동 삭제 없음(확정 (2026-11-12 사용자)), 기준은 2027-02-12 까지(삭제 정책은 민감 — CLAUDE.md 9).

## 8. 권한 (기본 역할 Q2 확정 (2026-11-12 사용자))

| 권한 | 할 수 있는 것 |
| --- | --- |
| `guest_messages.view` | 메시지함 보기 |
| `guest_messages.reply` | 답장 · 내부 메모 · 처리 끝 · 나중에 |
| `guest_messages.manage` | 자동 안내 규칙 · 정해 둔 문구 · 응답 목표 · 사용량 표시 |

- 화면 숨김만으로 막지 않는다 — 서버 액션 · RLS 에서 확인(CLAUDE.md 6). 공용 서버 액션은 `src/actions/` 에 두고 `forbidden` 을 돌려준다.
- **메시지 → 업무(6단계)**: 새 권한 없음 — `guest_messages.view` + 그 업무의 기존 권한(수리 · 분실물 · 할 일 = 조직 구성원, 게스트 피드백 = `complaint.write`). 링크 표 읽기 = `guest_messages.view`, 쓰기 = 서버만(§5-7).
- **1단계에 키 등록(2026-11-12) — 기본 역할 확정 (2026-11-12 사용자)(Q2)**: 보기 · 답장은 대표 · 전무 · CS 직원, **관리는 대표 · 전무만**(자동 안내는 모든 손님에게 나가고 크레딧 선을 바꾸므로 — 검토 반영). 알바(아르바이트 · 리더)는 역할로 받지 않는다(필요하면 나중에 개인 부여).
  역할 사본은 새 마이그레이션 insert + `202609100001` 의 자동 생성 구간(레지스트리 사본 — `capability-registry.test.ts` 가 맞는지 본다, 기존 키 추가 때와 같은 방식).
  알바 · 야간 직원에게 줄 수 있게 개인 부여 · 차단을 열었다(기한은 묻지 않음 — 상시 업무). 사용자 화면에서는 「게스트 · 건물」 묶음에 보인다.
- DB(RLS): 읽기는 `guest_messages.view`, 대화 상태(`status` · `snooze_until`) 고치기는 `guest_messages.view` **와** `guest_messages.reply`, 연결 상태 · 설정 읽기 · 고치기는 `guest_messages.manage`. 그 밖의 쓰기는 서버(service_role)만 — `docs/engineering/05-rls-permissions.md` 「손님 메시지」.

## 9. 번역

- 손님 말 → 직원 언어로 번역해 보여 주고 「원문 보기」. 답장은 직원이 쓴 언어 → 손님 언어로 번역해 보낸다(보내기 전 번역문 확인 가능).
- 기존 게스트 피드백 번역(문서 25, 번역 한도 있음)과 같은 방식 · 한도를 쓴다. 비용 · 한도는 Q3.
- 번역이 실패하면 원문 그대로 보여 주고 보내기는 막지 않는다(원문으로 보낼지 묻기).
- **보낼 언어 고르기(2026-11-13 사용자 요청)** — 답장 칸 아래 「영어로 번역」 자리가 드롭다운 하나가 된다(칩 대신): `번역 안 함` / `{손님 언어}로 번역 · 손님 언어`(PC, 폰은 짧게 `{언어}로 번역`) / 한국어 · 일본어 · 영어 중 직원 언어가 아닌 것. 처음 값 = 손님 언어(DeepL 이 아는 언어이고 직원 언어와 다를 때), 아니면 `번역 안 함`. **손님 언어를 몰라도 영어 · 일본어로는 보낼 수 있다.** 미리 보기 제목에 고른 언어가 붙고(「번역문 확인 · 일본어」), 보낸 답장에는 그 언어가 남는다(`guest_messages.body_lang`, 번역해서 보낸 경우만 — 대화 줄 아래 「보냄 · 일본어」). 서버가 후보 안의 언어인지 다시 본다(`isAllowedReplyTarget()` — 후보 밖이면 DeepL 을 부르지 않고 `translation_unavailable`, 보낸 줄의 언어 칸은 비움). 후보 · 기본값: `replyTranslationTargets()` · `defaultReplyTarget()`(`inbox-model.ts`).
- **볼 언어 고르기** — 「번역해서 보기」가 PC 머리에선 `AdmDropdown`(원문 / 한국어로 보기 / 일본어로 보기 / 영어로 보기, 보는 사람 언어가 먼저), 폰 · 폴드 · 태블릿에선 번역 아이콘 → 고르기 시트(같은 네 줄, 고른 줄에 체크). 기본 = 원문, 손님 말 옆 「번역」도 고른 언어(없으면 보는 사람 언어)로. 번역 캐시는 언어마다 한 줄이라 언어를 바꿔도 다른 언어 번역을 덮지 않는다(`translateGuestMessage(id, lang)` — `ko` · `ja` · `en` 만, 다른 값은 `invalid`).

## 10. 단계

| 단계 | 내용 |
| --- | --- |
| 0 | V1~V4 확인(코드는 웹훅 원문 임시 기록만) — **임시 기록 구현 2026-11-12**(§3-4), 확인은 배포 · 적용 뒤 |
| 1 | 수신(웹훅 추출 · 보정 조회 · 중복 막기) + 데이터 모델 + 어댑터 골격 — **구현 2026-11-12**(§4-0, 화면 없음 · 운영 DB 적용 2026-11-12 · 보정 조회 정기 실행은 `202611130006` pg_cron 15분(미적용)) |
| 2 | PC 메시지함 · 모바일 3폭 · 답장 · 발송 큐 · 429 대기 · 내부 메모 · 처리 끝 — **구현 2026-11-13**(§5-4, 커밋 전 · 발송 플래그 기본 꺼짐 · `translation_usage` 마이그레이션 미적용) |
| 3 | 응답 목표 시간 · 사용량 표시 — **구현 2026-11-13**(§5-5, 커밋 전) |
| 4 | 건물별 정보 카드 · 정해 둔 문구 — **구현 2026-11-13**(§5-5, 커밋 전 · 마이그레이션 `202611130003` 운영 적용 2026-11-13) |
| 5 | 자동 안내 규칙 · 보낼 예정 목록 — **구현 2026-11-13**(§5-6, 마이그레이션 `202611130004` 운영 적용 2026-11-13 · 정기 실행은 `202611130006` pg_cron 5분(미적용)) |
| 6 | 메시지 → 업무 한 번에 — **구현 2026-11-13**(§5-7, 마이그레이션 `202611130005` 운영 적용 2026-11-13) |
| 정기 실행 | 보정 조회 · 발송 · 자동 안내 pg_cron — **준비 2026-11-13**(`202611130006` 미적용, `src/lib/guest-messages/cron-auth.ts`) |
| 운영 반영 | **확정 (2026-11-12 사용자)** 순서: ① 마이그레이션 `202611130001` → `0005` 운영 적용(코드보다 먼저) ② 코드 배포 ③ 정기 실행 `202611130006` 적용(라우트가 pg_cron 토큰을 받는 코드가 나간 뒤 — Supabase pg_cron: 보정 조회 15분 · 발송 5분 · 자동 안내 5분) ④ 과거 가져오기 재기 모드 → 실제 가져오기는 밤에(동기화와 크레딧을 나눠 씀) ⑤ 실제 OTA 예약 하나로 답장 시험 뒤에만 `GUEST_MESSAGES_SEND_ENABLED=1`. 알고 둔 점: 발송 플래그는 SQL 이 모르므로, 꺼져 있는 동안에도 보낼 시각이 된 queued 줄이 있으면 발송 잡이 5분마다 라우트를 부르고 라우트는 202 로 끝난다(크레딧 안 씀, 07). 모두 사용자 허락 뒤 |
| 나중 | AI 답장 초안(AI 기능 때) · 푸시 알림(알림 일괄 구현 때) · 이메일 어댑터(직접 예약 손님) · OTA 직접 연동 |

## 11. 시험 · 확인

- 1단계 단위 시험: `src/lib/__tests__/guest-messages.test.ts`(변환 · 시간대 없는 시각 · 중복 · 읽음 채우기 · 되돌아옴(보내는 중 · 모름 포함) · 대화 상태 거울 · 첫 웹훅 옛 이력 · 발송 큐 순위 · 선(건수 비례 · 10 하한) · 429 · 나간 뒤 실패 = uncertain · 보내기 전 실패 · 허용 목록 · 게이트 · 조직 정하기 · 가짜 DB 로 쓰기 오류 처리 · 임시 기록 가리기 · 상한 · 웹훅 실패 삼킴). DB 함수 · RLS 는 로컬 PGlite 에서 확인(05 「손님 메시지」).
- 2단계 단위 시험: `src/lib/__tests__/guest-messages-inbox.test.ts`(리뷰 반영: 같은 키 다른 글 stale · 읽기 부작용 없음 · 대화마다 마지막 줄 · 언어별 번역 · 구성원만 작성자 이름 · 잡을 때 글 · 멈춘 sending → 모름 · 저장 0줄이어도 메시지 잇기 / 권한 보기/답장/없음 · 조직 격리 · 보내기 = 큐 + 대기 줄 · 같은 키 두 번 · 직접 예약/모르는 채널 막힘 · 플래그 꺼짐/켜짐 · 취소 · 모름 다시 보내기 확인 · 처리 끝/되돌리기 · 나중에 풀기 · 도쿄 「내일 9시」 · 번역 저장/캐시/실패 · 발송 작업 꺼짐/보냄/어댑터 던짐 · 정렬 · 채널 판정 = 어댑터).
- 3 · 4단계 단위 시험: `src/lib/__tests__/guest-messages-stage34-model.test.ts`(설정 범위 · 분↔시간 · 멈춤(도쿄 자정 넘김) · 1분 간격 · 크레딧 막대 · 손님용 칸 정리/길이 거절 · 언어 고르기 · 넣는 언어 · 넣기 목록 · 문구 검사 · 날짜 꼴 · 변수 채우기 · 사전 세 언어 같은 키) · `guest-messages-stage34-actions.test.ts`(manage 없으면 forbidden · 관리자 웹 없으면 PC 탭 액션 forbidden · 설정 저장이 다른 키 남김 · 다른 조직 안 건드림 · 지금 확인하기 too_soon / 이 조직만 · 건물 손님용 정보 처음 만들기 / 직원 줄만 있을 때 / 버전 충돌 / 다른 조직 / 길이 거절). 로컬 Postgres 에서 트리거 · RLS(일반 사용자 쓰기 거절 42501 · 본문 없음 23514) 확인.
- 5단계 단위 시험: `src/lib/__tests__/guest-messages-auto.test.ts`(트리거마다 도쿄 시각 · 새벽 · 달 · 해 · 윤년 · 규칙 검사 · 손님 언어 · 영어 대신 · 빈 변수 · 출입 코드 · 날짜 바뀜 다시 계획 · 취소 · 규칙 꺼짐 · 대상 아님 · 직접 예약 · 채널 모름 · 빈 변수 → 채우면 풀림 · 멈춤 유지 · 큐 뒤 그대로 · 늦음 6시간 · 확정 직후 = 켠 뒤 예약만 / 가짜 DB 로 두 번 돌려도 한 줄 · 플래그 꺼짐이면 큐 없음 · 켜지면 한 번만 · 멈춘 줄 · 다른 조직 · 순위 답장 먼저 · 크레딧 선 · 보내면 실행 줄 sent(못 보냄 → 다시 보내기로 보내진 failed 줄 포함) · 켠 규칙 없으면 웹훅 뒤 계획이 예약을 안 읽음 · 답장 시각 없음 / 권한). 로컬 Postgres 에서 함수 멱등 · 다른 조직 거절 · 검사 · 고유 키 · RLS(대표 = 규칙 · 실행 줄 읽음, CS = 실행 줄만, 알바 = 없음, 일반 사용자 쓰기 · 함수 실행 42501) 확인. 큐 줄이 지워질 때 실행 줄 검사가 막던 것을 고쳤다(`queued_at` 기준).
- 6단계 단위 시험: `src/lib/__tests__/guest-messages-stage6.test.ts`(권한별 종류 · 미리 채움(번역 + 원문 · 빈 말 · 80자) · 종류마다 끝남 상태 · 지워짐 · 상세 주소 · 상태 읽기(다른 조직 업무 = 지워짐 · 할 일 제목은 참여자만) · 「해결됐어요」 = 끝난 뒤 답장 없을 때만 · 가장 최근 · 기본 문구 / 표시한 문구 · 쓰기 없음 / 링크 한 업무 한 줄 · 같은 대화 다시 = 성공 · 다른 대화 = conflict · 조직마다 / 메시지 권한 없음 · complaint.write 없음 = forbidden(아무것도 안 만듦) · 공용 만들기 함수 입력(예약 잇기 · 다른 방이면 안 이음 · 대화 값) · 기능 검사 실패 코드 · 다른 조직 대화 · 메시지 · 우리 답장 거절 · 상세 링크 권한). 로컬 Postgres 에서 RLS(대표 · CS 읽기, 알바 0줄, 일반 사용자 넣기 42501) · 트리거(다른 조직 23514 · 다른 대화 메시지 23514) · 고유(같은 업무 23505 · 「해결됐어요」 둘 23505) 확인 + 검토 반영(다른 조직 · 없는 업무 · 종류가 다른 업무 23514 · 문구 표시 함수 = 하나만 · 없는 id 면 그대로 · 일반 사용자 실행 42501). `src/lib/__tests__/task-create-idempotent.test.ts`(할 일 요청 id: 없으면 예전대로 · 같은 id 두 번 = 한 건 · 남의 · 10분 넘은 · 지운 할 일 = 실패 · uuid 아님 거절 · 되돌리기 지우기 조직 필터 / 분실물 카탈로그 읽기 실패 = save_failed). 화면에서 네 종류를 하나씩 만들고(PC 수리 · 분실물, 폰 할 일 · 피드백) 수리를 끝내 초안이 답장 칸에 들어가는지 · 발송 큐가 그대로인지 확인.
- 정기 실행: `src/lib/__tests__/guest-messages-cron-auth.test.ts`(CRON_SECRET 통과 · pg_cron 토큰은 DB 함수로 대조 · 틀리면 403 · 둘 다 없으면 404 · 짧은 값은 묻지 않음 · 함수 없으면 거절). `202611130006` 은 로컬 Postgres(pg_cron · pg_net · Vault 흉내)에서 두 번 적용 → 잡 3개 · 시크릿 2개 그대로, 할 일 없으면 `idle` · 있으면 `fired`(보낼 시각 지난 queued · 10분 멈춘 sending · 켠 규칙), 주소 없으면 `not_configured`, 일반 사용자 실행 권한 없음 확인. 할 일 링크: PC 1280 ko 에서 대화 줄 → `/admin/tasks?task=<id>` 상세 칸 열림 · 모르는 id 는 빈 칸.
- 단위: 웹훅 본문 → 표준 메시지 변환 · 중복 막기 · 보낸 메시지 되돌아옴 합치기 · 기다린 시간 계산(도쿄) · 자동 안내 예약 시각 계산(도쿄, 월 · 해 넘김) · 빈 변수 막기 · 429 대기 · 우선순위.
- 권한: service_role · 일반 사용자 · 권한 없는 사용자로 읽기 · 쓰기(RLS · GRANT 포함). 운영 DB 에는 쓰지 않는다.
- 화면: 폰 · 폴드 · 태블릿 × ko · ja · en, PC 1280 · 1440.
- 크레딧: 하루 동안 실제 사용량 기록 → 남겨 둘 선 확정.

## 12. 열린 질문

| # | 질문 |
| --- | --- |
| Q1 | ~~폰 대화 화면에서 아래 탭을 숨길까~~ — **확정 (2026-11-12 사용자): 둔다** |
| Q2 | ~~누가 보고 답장하나~~ — **확정 (2026-11-12 사용자)**: 보기 · 답장 = 대표 · 전무 · CS, 관리 = 대표 · 전무, 알바는 역할로 없음(나중에 개인 부여) — §8 |
| Q3 | 번역 비용 · 한도 · 어떤 번역을 쓸지 |
| Q4 | ~~응답 목표를 밤 시간에도 셀지~~ — **확정 (2026-11-12 사용자): 밤에도 센다(멈춤 꺼짐)** |
| Q5 | ~~「받는 통로 멈춤」 기준 시간~~ — **확정 (2026-11-12 사용자): 3시간**, 실제로 1~2주 써 본 뒤 다시 본다 |
| Q6 | 건물 정보 카드의 출입 코드와 셀프 체크인 건물 비밀번호를 하나로 둘지 |
| Q7 | 메시지 보관 기간 · 퇴실 뒤 삭제 여부 — **확정 (2026-11-12 사용자): 지금은 자동 삭제 없음.** 보관 기준(예: 체크아웃 3년 뒤 삭제)은 **2027-02-12 까지** 정한다(19 열린 할 일, §4-0-2) |
| Q8 | 크레딧 한도를 200 으로 유지할지(지금 200, 기본은 100) |
| Q9 | 답장 칸에서 출입 코드를 넣을 수 있는 사람 — **확정 (2026-11-12 사용자)**: 관리(`guest_messages.manage`) 또는 건물 정보 고치기(`property_info.edit`)만, 답장 권한만 있는 사람은 못 봄(§6-3) |
| Q10 | 대화에 보이는 자동 안내의 출입 코드 — **확정 (2026-11-12 사용자)**: Q9 와 같은 사람만 보이고, 나머지는 「••••」로 가림(손님에게 나간 글은 그대로). 자동 안내 큐 줄 고치기 · 취소 · 다시 보내기는 관리만(§5-6) |
| Q11 | 묶음 예약(Beds24 `masterId`, 방 여러 개)의 자동 안내 — **확정 (2026-11-12 사용자)**: 묶음마다 한 번, 대표 예약으로 보내고 `{room}` · `{entry_code_room}` 에 묶음의 방 전부(「201 / 202」 · 「201 코드 / 202 코드」, 한 방이라도 코드가 없으면 막힘)(§5-6) |
| Q12 | 정기 실행 간격 — **확정 (2026-11-12 사용자): 보정 조회 15분 · 발송 5분 · 자동 안내 5분.** Vercel 요금제가 확인되지 않아(Hobby 는 하루보다 짧은 크론을 거절) `vercel.json` 이 아니라 Supabase pg_cron `202611130006`(미적용 — 적용은 사용자 허락 뒤) |
| Q13 | ~~폰에서 손님 말을 꾹 눌러 고르기~~ — **확정 (2026-11-12 사용자): 넣지 않음**(글자 복사와 겹친다). 「더 보기 → 업무 만들기 → 손님 말 고르기」 그대로, 직원이 원하면 다시 본다 |
