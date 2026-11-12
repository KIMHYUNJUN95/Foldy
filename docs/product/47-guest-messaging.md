# 47. 손님 메시지 (Beds24 CS) — 기획

> 상태: **0 · 1단계 구현(화면 없음) — 커밋 · 운영 적용 전** (2026-11-12). 2단계부터는 시안 컨펌 대기.
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
- **아직 정기 실행에 넣지 않았다**(`vercel.json` · GitHub Actions 없음). 주기(10~15분 예정)는 V1 확인 뒤 정해서 붙인다.

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

- 탭: **대화 · 자동 안내 · 정해 둔 문구 · 설정**(설정 = 응답 목표 시간 + Beds24 연결, 시안 R2Settings).
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
- 열린 결정 Q1: 폰 대화 화면에서 아래 탭을 셸 계약대로 둘지, 대화 화면만 숨길지(셸 계약 변경 → 허락 필요).

### 5-3. 자동 안내 (PC 탭)

- 안내 목록: 이름 · 보내는 때 · 다음 발송 · 켜기.
- 편집: 보내는 때(예약 확정 직후 / 체크인 N일 전 HH:MM / 당일 / 체크아웃 N일 전 / 체크아웃 다음 날, **도쿄 시간**) · 대상(건물 · 채널 · 예약 상태) · 언어별 문구(한국어 · 日本語 · English, 다른 언어 손님은 English) · 변수 넣기 · 미리 보기.
- **빈 변수 막기**: 그 건물 값이 비어 있으면(예: 건물 비밀번호) 그 건물에는 보내지 않고 미리 보기에 빨간 글자로 알린다.
- 직접 예약은 보내지 않는다(어댑터가 막음). 취소된 예약은 큐에서 빠진다.
- 보낼 예정 목록에서 예약 하나만 멈출 수 있다(예: 이미 도착한 손님).

## 6. 추가 기능 (D5)

### 6-1. 응답 목표 시간

- 설정: 예약 상태별 목표 — 시안 기본값 문의 30분 · 예약 요청 30분 · 숙박 중 1시간 · 확정 · 그 밖 2시간(관리자가 고침). 「밤에는 세지 않기」(23:00–07:00 도쿄) 스위치를 시안에 넣었다 — 기본값은 Q4.
- 「기다린 시간」 = 마지막 손님 말 이후 우리 답장(또는 「처리 끝」)이 없는 시간. 내부 메모는 답장으로 치지 않는다.
- 구현 `computeWaiting(conversation, settings, now)`(`src/lib/guest-messages/response-target.ts`) → `{ waitingMinutes, targetMinutes, ratio, overdue }`.
  분류: Beds24 상태 `inquiry` → 문의, `request` → 예약 요청, 도쿄 날짜로 체크인 ≤ 오늘 < 체크아웃 → 숙박 중, 그 밖. `done` · 답장 이후 · 「나중에」가 안 끝났으면 0.
  「나중에」가 끝났으면 그 시각부터 다시 센다(직원이 그때 보겠다고 정했으니 — 1단계 결정). 목표를 **넘으면**(`>`) overdue. 밤 빼기는 도쿄 23:00–07:00, 날 · 달 경계는 `tokyo-date.ts`.
  기본값은 꺼짐(`night_pause = false`, Q4 미정).
- 목록: 목표 넘으면 빨간 글자(`#c4364b`) + 맨 위. 목표의 80% 를 넘으면 굵게.
- 「처리 끝」: 답장할 필요 없는 말(「감사합니다」 등)은 처리 끝으로 표시해 기다림에서 뺀다. 「나중에」(시각 지정) 도 같은 자리.
- 알림(목표 넘음 → 관리자)은 알림 일괄 구현 때 붙인다(D6). 1차는 화면 표시만.
- 도쿄 시간 기준(CLAUDE.md 7).

### 6-2. 사용량 표시

- 위치: 손님 메시지 「설정」 탭 → 「Beds24 연결」(시안 R2Settings) · 메시지함 목록 위 경고 줄(멈췄을 때만).
- 막대 하나로 5분 사용량(쓴 양 · 메시지용으로 남겨 둔 양)을 보이고, 남겨 둘 양 · 통로 멈춤 기준 시간을 같은 곳에서 고친다.
- 보여 줄 것: 마지막으로 받은 웹훅 시각 · 마지막 보정 조회 · 5분 남은 크레딧(마지막 응답 헤더 기준) · 리셋까지 · 보낼 차례 기다리는 메시지 수 · 최근 실패.
- 숫자는 **Beds24 를 새로 부르지 않고** 이미 받은 응답 헤더를 기록해 보여 준다(보는 것만으로 크레딧이 나가지 않게).
- 「받는 통로 멈춤」: 일정 시간(예: 3시간 — Q5) 웹훅이 하나도 없으면 관리자에게만 경고 줄 + 「지금 확인하기」(보정 조회 1번).
- 권한: 관리 권한(`guest_messages.manage`, 가칭)만.

### 6-3. 건물별 정보 카드

- **새 표를 만들지 않고** 예약 캘린더의 건물 정보(`property_operation_infos` — 공용 출입 코드 · 객실 출입 코드 · 운영 메모, 문서 15 「건물 정보」)를 넓힌다. 편집 권한도 같은 `property_info.edit`.
- 더할 칸(손님에게 보내도 되는 정보, 언어별 ko · ja · en): 와이파이 이름 · 비밀번호 · 짐 보관 · 주차 · 쓰레기 버리는 법 · 체크인 · 체크아웃 시각 · 길 안내 · 자유 칸.
- **손님에게 보내도 되는 칸과 직원용 칸을 나눈다.** 운영 메모는 손님용이 아니다. 출입 코드는 자동 안내 변수로만 쓰고 답장 칸 「넣기」 목록에서는 따로 표시한다.
- 쓰는 곳: 답장 칸 「건물 정보 넣기」(손님 언어로 넣음) · 자동 안내 변수 · 예약 패널.
- 셀프 체크인 건물 비밀번호(사용자 정리 대기 — 메모리)와 같은 값인지 Q6.

### 6-4. 메시지 → 업무 한 번에

- 대화 패널 「업무 만들기」 → 고르기: **수리 · 점검**(08) · **분실물**(09) · **할 일**(28) · **게스트 피드백**(25). PC 는 오른쪽 패널이 만들기 칸으로 바뀌고(시안 R2Task), 폰은 「더 보기」 → 공용 `BottomSheet` 로 종류를 고른다(시안 R2PhoneTask).
- 붙일 손님 말은 대화에서 고른 말(테두리 표시)이고, 사진도 같이 붙는다.
- 미리 채움: 건물 · 방 · 예약 번호 · 손님 이름 · 고른 손님 말(번역문 + 원문) · 사진(있으면).
- 연결: 대화 ↔ 업무를 서로 링크. 대화에는 「수리 · 점검 #123 · 접수됨」 줄이 시스템 줄로 남고, 업무 상세에는 「손님 메시지에서」 링크.
- 업무가 끝나면 대화에 「해결됐어요」 답장 **초안**(정해 둔 문구)을 띄운다 — 자동으로 보내지 않는다.
- 권한: 각 업무를 만들 권한은 그 기능의 기존 권한 그대로(새 권한 없음). 버튼은 권한이 있는 업무만 보인다.

## 7. 데이터 모델

**1단계 확정**(`202611120002_guest_messages_foundation.sql`, 운영 적용 2026-11-12 — 칸 목록은 `docs/engineering/04-data-model.md` 「손님 메시지」):
`guest_conversations` · `guest_messages` · `guest_message_outbox` · `guest_message_channel_state`.
- 대화에 예약 상태 · 날짜(`booking_status` · `check_in_date` · `check_out_date`)를 사본으로 둔다 — 응답 목표 분류용. 건물 · 객실은 `property_id` · `room_id`(외래 키) + 표시용 `property_name` · `room_label`.
- 메시지에 `provider_source`(통로가 준 출처 원문)를 더했다 — 모르는 출처를 `system` 으로 읽어도 원래 값이 남는다.
- 발송 큐 상태에 `uncertain`(나갔는지 모름 — 다시 보내지 않음)을 더했다. 연결 상태에 `last_reconcile_error` 를 더했다.
- 대화 상태는 DB 함수 `guest_conversation_apply_messages` 로만 바꾼다(서버 경로).
- 설정은 새 표 `guest_message_channel_state`(조직마다 한 줄)에: 응답 목표는 `settings.responseTargetMinutes`(jsonb, 기본 문의 30 · 요청 30 · 숙박 중 60 · 그 밖 120), `night_pause` · `credit_reserve`(20) · `stall_hours`(3) 은 칸.
- `auto_message_rules` · `auto_message_runs` · `guest_message_links` · `property_operation_infos` 넓히기는 아직 안 만들었다(5 · 6 · 4단계). `guest_message_outbox.rule_id` 의 외래 키는 그때 붙인다.

초안(나머지 단계):

| 표 | 주요 칸 | 비고 |
| --- | --- | --- |
| `guest_conversations` | organization_id · reservation 연결 · property / room · channel · guest_name · guest_language · status(awaiting/done/snoozed) · snooze_until · last_guest_at · last_reply_at · provider · provider_booking_id | 예약 하나 = 대화 하나 |
| `guest_messages` | conversation_id · provider · external_id(고유) · direction(guest/host/internal/system) · body · body_translated · translated_lang · sent_at · read_at · author_user_id · attachments | 원본 |
| `guest_message_outbox` | conversation_id · body · kind(reply/auto) · rule_id · status(queued/sending/sent/failed/cancelled) · attempts · next_try_at · error_code · external_id | 발송 큐, 멱등 키 |
| `auto_message_rules` | organization_id · name · trigger(confirmed/before_checkin/day_of/before_checkout/after_checkout) · offset_days · send_time · targets(건물 · 채널 · 상태) · bodies(ko/ja/en) · enabled | |
| `auto_message_runs` | rule_id · reservation 연결 · scheduled_at · status · outbox_id | 같은 예약에 두 번 안 가게 고유 |
| `guest_message_links` | conversation_id · message_id · target_type · target_id | 메시지 → 업무 |
| `property_operation_infos` 넓히기 | 손님용 칸(언어별) | 6-3 |
| 설정 | 응답 목표(상태별 분) · 메시지용 크레딧 선 · 통로 멈춤 기준 | `property_settings` 또는 조직 설정 |
| 연결 상태 | last_webhook_at · last_reconcile_at · last_credit_remaining · last_credit_reset_at | 6-2 |

- 모두 organization 범위 + RLS. 손님 개인정보(이름 · 메시지)는 서버에서 권한 확인.
- 보관 기간 · 삭제 정책은 Q7(삭제 정책은 민감 — CLAUDE.md 9).

## 8. 권한 (가칭 — 확정은 Q2)

| 권한 | 할 수 있는 것 |
| --- | --- |
| `guest_messages.view` | 메시지함 보기 |
| `guest_messages.reply` | 답장 · 내부 메모 · 처리 끝 · 나중에 |
| `guest_messages.manage` | 자동 안내 규칙 · 정해 둔 문구 · 응답 목표 · 사용량 표시 |

- 화면 숨김만으로 막지 않는다 — 서버 액션 · RLS 에서 확인(CLAUDE.md 6). 공용 서버 액션은 `src/actions/` 에 두고 `forbidden` 을 돌려준다.
- **1단계에 키 등록(2026-11-12) — 기본 역할은 임시(Q2 가 정해지면 바꾼다)**: 보기 · 답장은 대표 · 전무 · CS 직원, **관리는 대표 · 전무만**(자동 안내는 모든 손님에게 나가고 크레딧 선을 바꾸므로 — 검토 반영). 알바(아르바이트 · 리더)는 역할로 받지 않는다.
  역할 사본은 새 마이그레이션 insert + `202609100001` 의 자동 생성 구간(레지스트리 사본 — `capability-registry.test.ts` 가 맞는지 본다, 기존 키 추가 때와 같은 방식).
  알바 · 야간 직원에게 줄 수 있게 개인 부여 · 차단을 열었다(기한은 묻지 않음 — 상시 업무). 사용자 화면에서는 「게스트 · 건물」 묶음에 보인다.
- DB(RLS): 읽기는 `guest_messages.view`, 대화 상태(`status` · `snooze_until`) 고치기는 `guest_messages.view` **와** `guest_messages.reply`, 연결 상태 · 설정 읽기 · 고치기는 `guest_messages.manage`. 그 밖의 쓰기는 서버(service_role)만 — `docs/engineering/05-rls-permissions.md` 「손님 메시지」.

## 9. 번역

- 손님 말 → 직원 언어로 번역해 보여 주고 「원문 보기」. 답장은 직원이 쓴 언어 → 손님 언어로 번역해 보낸다(보내기 전 번역문 확인 가능).
- 기존 게스트 피드백 번역(문서 25, 번역 한도 있음)과 같은 방식 · 한도를 쓴다. 비용 · 한도는 Q3.
- 번역이 실패하면 원문 그대로 보여 주고 보내기는 막지 않는다(원문으로 보낼지 묻기).

## 10. 단계

| 단계 | 내용 |
| --- | --- |
| 0 | V1~V4 확인(코드는 웹훅 원문 임시 기록만) — **임시 기록 구현 2026-11-12**(§3-4), 확인은 배포 · 적용 뒤 |
| 1 | 수신(웹훅 추출 · 보정 조회 · 중복 막기) + 데이터 모델 + 어댑터 골격 — **구현 2026-11-12**(§4-0, 화면 없음 · 보정 조회 정기 실행 없음 · 운영 DB 적용 2026-11-12 · 코드 배포 전) |
| 2 | PC 메시지함 · 모바일 3폭 · 답장 · 발송 큐 · 429 대기 · 내부 메모 · 처리 끝 |
| 3 | 응답 목표 시간 · 사용량 표시 |
| 4 | 건물별 정보 카드 · 정해 둔 문구 |
| 5 | 자동 안내 규칙 · 보낼 예정 목록 |
| 6 | 메시지 → 업무 한 번에 |
| 나중 | AI 답장 초안(AI 기능 때) · 푸시 알림(알림 일괄 구현 때) · 이메일 어댑터(직접 예약 손님) · OTA 직접 연동 |

## 11. 시험 · 확인

- 1단계 단위 시험: `src/lib/__tests__/guest-messages.test.ts`(변환 · 시간대 없는 시각 · 중복 · 읽음 채우기 · 되돌아옴(보내는 중 · 모름 포함) · 대화 상태 거울 · 첫 웹훅 옛 이력 · 발송 큐 순위 · 선(건수 비례 · 10 하한) · 429 · 나간 뒤 실패 = uncertain · 보내기 전 실패 · 허용 목록 · 게이트 · 조직 정하기 · 가짜 DB 로 쓰기 오류 처리 · 임시 기록 가리기 · 상한 · 웹훅 실패 삼킴). DB 함수 · RLS 는 로컬 PGlite 에서 확인(05 「손님 메시지」).
- 단위: 웹훅 본문 → 표준 메시지 변환 · 중복 막기 · 보낸 메시지 되돌아옴 합치기 · 기다린 시간 계산(도쿄) · 자동 안내 예약 시각 계산(도쿄, 월 · 해 넘김) · 빈 변수 막기 · 429 대기 · 우선순위.
- 권한: service_role · 일반 사용자 · 권한 없는 사용자로 읽기 · 쓰기(RLS · GRANT 포함). 운영 DB 에는 쓰지 않는다.
- 화면: 폰 · 폴드 · 태블릿 × ko · ja · en, PC 1280 · 1440.
- 크레딧: 하루 동안 실제 사용량 기록 → 남겨 둘 선 확정.

## 12. 열린 질문

| # | 질문 |
| --- | --- |
| Q1 | 폰 대화 화면에서 아래 탭을 숨길까(셸 계약 변경) |
| Q2 | 누가 보고 답장하나 — 알바 · 야간 직원 포함 여부, 기본 권한 묶음(**임시**: 보기 · 답장 = 대표 · 전무 · CS, 관리 = 대표 · 전무, 개인 부여 가능 — §8) |
| Q3 | 번역 비용 · 한도 · 어떤 번역을 쓸지 |
| Q4 | 응답 목표를 밤 시간에도 셀지(예: 23시~7시 제외) |
| Q5 | 「받는 통로 멈춤」 기준 시간 |
| Q6 | 건물 정보 카드의 출입 코드와 셀프 체크인 건물 비밀번호를 하나로 둘지 |
| Q7 | 메시지 보관 기간 · 퇴실 뒤 삭제 여부 |
| Q8 | 크레딧 한도를 200 으로 유지할지(지금 200, 기본은 100) |
