# 46. 셀프 체크인 직원 통화

태블릿의 「직원 호출」을 누른 손님과 직원을 앱 안에서 바로 통화로 잇는다. 시안: 캔버스 `BCPPdekMxDBjY7R2XA1hUm` 「재수정 · 직원 통화」.

## 1. 결정 (2026-11-06 사용자 확정)

- **필요할 때만.** 손님이 누를 때만 통화한다. 본인 확인은 5초 얼굴 영상이고, 통화는 체크인 조건이 아니다.
- **손님을 멈추지 않는다.** 아무도 안 받거나 연결이 실패해도 체크인은 그대로 이어진다. 태블릿은 연락처를 보여 주고 원래 단계로 돌아간다.
- **임시 수단 없음.** Slack 등을 거치지 않는다.
- **직원 얼굴은 보이지 않는다.** 손님 → 직원: 카메라 + 목소리. 직원 → 손님: 목소리만. 이것은 화면이 아니라 서버 토큰 권한으로 막는다.
- **통화는 저장하지 않는다.** LiveKit 녹화 기능을 쓰지 않는다. 통화 기록에는 시각 · 건물 · 기기 · 받은 직원 · 누른 단계 · 언어만 남긴다.
- **건물별 켜기 · 끄기.** 기본은 꺼짐이다. 꺼진 건물은 지금처럼 연락처 화면만 보여 준다.
- 동시에 모두에게 울리고, 먼저 받은 사람이 연결된다. 「닫기」는 그 사람 화면만 닫는다.

## 2. 흐름

```txt
태블릿 호출 ─ POST /api/kiosk/call ─▶ staff_calls 행(ringing, 45초) + 받을 직원에게 알림 행
직원 앱 ─ notifications 실시간 신호 ─▶ getRingingStaffCalls() ─▶ 울리는 화면
직원 받기 ─ acceptStaffCall() ─▶ ringing → accepted (먼저 온 한 명만) + 직원 토큰
태블릿 ─ GET /api/kiosk/call/[id] 1.5초마다 ─▶ accepted + 태블릿 토큰 ─▶ LiveKit 방 입장
아무나 끊기 ─ 상태 ended + 방 삭제(실패해도 무시)
```

`checkin` 스키마는 직원 JWT 로 읽을 수 없다. 그래서 신호는 이미 실시간 구독 중인 `public.notifications` 로 받고, 내용은 권한을 검사한 서버 함수로 읽는다(다른 화면의 「신호만 받고 다시 읽기」와 같은 방식). 통화 내용은 알림 행에 넣지 않는다.

## 3. 상태

| status | 뜻 | 다음 |
| --- | --- | --- |
| `ringing` | 울리는 중, `ring_deadline_at`(45초)까지 | accepted · no_answer · canceled · failed · ended(기기 폐기) |
| `accepted` | 직원이 받음 | ended |
| `ended` | 통화 끝 | 끝 |
| `no_answer` | 45초 안에 아무도 안 받음 | 끝 |
| `canceled` | 손님이 취소 | 끝 |
| `failed` | LiveKit 오류 등 | 끝 |

- 시간 초과는 스케줄러 없이 **읽거나 쓸 때 판정한다.** 45초가 지난 `ringing` 은 조건부 update 로 `no_answer` 로 바꾼다. 30분이 지난 `accepted` 는 `ended`(`ended_by='timeout'`)로 바꾼다.
- 기기 하나에 진행 중 통화는 하나뿐이다(부분 고유 인덱스). 새 호출 전에 낡은 행을 먼저 닫는다.
- 받기는 `update ... where id=? and status='ringing' and ring_deadline_at > now()` 조건부 한 번이다. 0행이면 `already_taken` 또는 `expired` 다.
- 손님의 취소 · 끊기는 같은 규칙이다: `ringing` → `canceled`, `accepted` → `ended`, 끝난 통화는 그대로 답한다. 취소와 받기가 겹치면 통화를 끝낸다(직원만 빈 방에 남지 않게).
- 받을 직원이 0명이면 호출 응답은 그대로 `ok:true` 이고 행은 바로 `no_answer`(`ended_by='system'`)다. 태블릿은 다음 읽기에서 E3 를 보여 준다. 알림 넣기가 실패하면 `ringing` 으로 45초를 기다린 뒤 `no_answer` 가 된다.
- 새 호출 때 이 기기의 행: 기한 안의 `ringing` 은 그대로 다시 돌려주고(두 번 눌림), `accepted` 로 남은 행(앱이 죽은 경우)은 `ended_by='system'` 으로 닫고 새로 만든다.
- 표 제약: `accepted` 는 `accepted_at` · `accepted_by` 필수, 끝난 상태(`ended` · `no_answer` · `canceled` · `failed`)는 `ended_at` 필수.
- `failed` 는 태블릿 서버가 만들지 않는다. `no_answer` 의 `ended_by` 는 `timeout`(또는 받을 사람 0명이면 `system`). `no_answer` 로 바꾸는 쪽이 어디든 `checkin_call_missed` 를 함께 넣는다(받을 사람 0명 제외).

## 4. 데이터

새 마이그레이션 `202611060001_checkin_staff_calls.sql` (운영 적용은 사용자 허락 뒤).

`checkin.staff_calls`: `id uuid pk`, `organization_id`, `property_key`, `device_id`, `stay_id uuid null`(해당 stay 참조, stay 삭제 시 null), `room_name text unique`, `status`, `step`, `language`, `ring_deadline_at`, `created_at`, `accepted_at`, `accepted_by uuid`, `ended_at`, `ended_by text`('guest' · 'staff' · 'timeout' · 'system'). RLS 켬 · 정책 없음 · authenticated 권한 없음(다른 `checkin` 표와 같음).

`step` 값: `welcome` · `find` · `passport` · `face` · `address` · `done` · `other`. `language` 값: `ja` · `en` · `zh-Hans` · `ko`. 이 밖의 값은 400.

`checkin.property_settings.staff_call_enabled boolean not null default false` 추가.

권한 키 `checkin.call` (전화 받기) 추가 — 기본 대표 · 전무, 개인 부여 가능, 기한 · 차단 없음. 야간 응대 직원에게 명부 열람(`checkin.view`) 없이, 관리자 웹 권한 없이도 전화만 받게 하려고 키를 나눈다. 받은 사람이 `checkin.view` 가 있을 때만 「예약 보기」가 열린다. 관리자 웹 권한 없이 받기와, 플랫폼 개발자가 멤버십이 있는 조직의 호출을 받아 손님 영상을 볼 수 있는 점은 사용자가 2026-11-06 확정했다.

알림 종류 `public.notification_type` 에 추가: `checkin_staff_call`(호출) · `checkin_call_missed`(아무도 안 받음) · `checkin_staff_check`(직원 확인 필요 체크인 완료). payload 에 손님 정보 없음 — 호출 · 놓침은 `callId` · `propertyKey` 만(`checkin.call` 만 가진 직원에게도 가므로 `stayId` 를 싣지 않는다), 직원 확인은 `stayId` · `propertyKey` 만. 이 세 종류는 서버만 만든다 — `notifications` INSERT 정책이 로그인 사용자의 직접 삽입을 막는다.

수신자 계산과 알림 넣기는 SQL 함수 `checkin.notify_staff(p_organization_id, p_capability, p_type, p_dedupe_key, p_href, p_payload)` 한 곳에서 한다. 역할은 `capability_roles`, 개인 부여는 기존 개인 권한 표 + 기한 규칙을 그대로 따른다. `apps/checkin` 이 Foldy 코드를 import 할 수 없어서 DB 함수로 둔다. `service_role` 만 실행 가능. 규칙은 앱의 `memberIdsWithCapability` 와 같다 — 플랫폼 개발자 통과는 받는 사람에 넣지 않는다. 돌려주는 값은 받는 사람 수(중복 키로 건너뛴 사람 포함). `source_id` 는 payload 의 `callId`, 없으면 `stayId` 이고 둘 다 없으면 받는 사람 수와 상관없이 오류(`22023`)를 낸다. Auth 정지(`banned_until`) 계정은 받는 사람에서 뺀다.

`checkin.can_take_call(p_organization_id, p_user_id)` 는 받은 직원이 통화를 이어 가도 되는지 답한다. 규칙은 위와 같고, 활성 플랫폼 개발자(활성 멤버십 · 계정 정지 아님)도 통과한다 — `checkinGate` 를 지나 받을 수 있는 사람이라 빼면 받자마자 끊긴다. `service_role` 만 실행 가능.

알림 키: `checkin_staff_call:<callId>` · `checkin_call_missed:<callId>` · `checkin_staff_check:<stayId>`. `href` 는 셋 다 `/admin/checkin`.

## 5. API 약속

**태블릿 ↔ apps/checkin** (`authenticateDevice` 필수. 다른 기기 · 다른 조직의 통화는 404).

| 경로 | 요청 | 응답 |
| --- | --- | --- |
| `POST /api/kiosk/call` | `{ step, language }` + 진행 중 체크인이면 기존 kiosk 세션 값 | `{ ok:true, callId, ringDeadlineAt }` · `{ ok:false, error:"disabled"\|"unconfigured" }` |
| `GET /api/kiosk/call/[id]` | | `{ ok:true, status, token?, url? }` — `token` · `url` 은 `accepted` 일 때만 |
| `POST /api/kiosk/call/[id]/cancel` | | `{ ok:true, status }` |
| `POST /api/kiosk/call/[id]/end` | | `{ ok:true, status }` |

- `disabled` · `unconfigured` 는 HTTP 200 이다(체크 순서도 이 순서). 그 밖의 오류: 입력 값 400(`invalid`), 기기 인증 401, 없는 통화 404(`not_found`), 서버 오류 500(`server_error`). 모든 응답에 `contract_version` 이 붙는다.
- 세션 값은 본문의 `session_id` 또는 `sessionId`. 모양이 틀리면 없는 것으로 보고 호출을 막지 않는다.
- `stay_id` 는 기기가 보낸 값을 믿지 않는다. 기존 증명 흐름(`openProvenKioskStay`)을 통과한 경우에만 넣고, 없으면 null 로 호출을 그대로 진행한다.
- `no_answer` 로 바뀔 때 `checkin_call_missed` 알림을 넣는다. 받을 직원이 0명이면 놓침 알림도 없다.
- `GET` 은 `accepted` 를 읽을 때마다 `can_take_call` 로 받은 직원을 다시 확인한다. 권한 회수 · 멤버십 정지 · 계정 정지면 `ended`(`ended_by='system'`) + 방 삭제 + 기록이고, 판정 자체가 실패하면(DB 오류) 통화를 끊지 않는다. 태블릿은 통화 중 30초마다 이 경로를 부르며, 30분 한도도 여기서 닫힌다.
- 계약 JSON 에 `staffCallEnabled: boolean` 추가(`CONTRACT_VERSION` 유지, 옛 앱은 무시). 코틀린 기본값 false.
- `settingsVersion`(`ping` · `settings` 같은 값)은 `<updated_at>|call:<켜짐>` 이다. 켜기 · 끄기가 `updated_at` 을 바꾸지 않아도 돌고 있는 태블릿이 다시 받는다. 태블릿은 불투명 문자열로만 쓴다.
- 칼럼이 아직 없으면(마이그레이션 전, `42703`) `settings` · `ping` · 호출 모두 꺼짐으로 답한다.

**직원 ↔ Foldy** (`src/actions/checkin/calls.ts`, 전용 문 `checkinCallGate("checkin.call")`, 조직 범위). 이 문은 온보딩 상태 `ready` + 세션 + 조직 + 그 권한 키만 본다. `checkinGate` 와 달리 `admin_web.access` 를 요구하지 않고, 정지 · 비활성 계정은 막힌다.

- `getRingingStaffCalls()` → `{ ok:true, calls:{ id, propertyKey, deviceName, step, language, ringDeadlineAt }[] }` · `{ ok:false, errorKey:"forbidden"|"not_ready"|"failed" }`. 실패를 「호출 없음」과 가르려고 결과로 감싼다. 45초 지난 호출은 여기서도 `no_answer` 로 닫고 놓친 알림을 넣는다(바꾼 쪽만).
- `acceptStaffCall(id)` → `{ ok:true, token, url, stayId, canViewStay }` · `{ ok:false, errorKey:"already_taken"|"expired"|"unconfigured"|"forbidden"|"failed"|"not_ready" }`. `stayId` 는 `canViewStay` 일 때만 값이 있다. 같은 사람이 두 기기에서 눌러도 두 번째는 `already_taken` 이다.
- `endStaffCall(id)` — 문을 지나려면 `checkin.call` 이 있어야 하고(`checkin.manage` 만으로는 못 지난다), 그 위에서 받은 본인 또는 `checkin.manage` 만 끊는다. 이미 끝났으면 그대로 성공.
- `getStaffCallStatus(id)` — 받은 뒤 상대가 끊었는지 확인. 권한은 `endStaffCall` 과 같다. 통화 중 `forbidden` 은 인증 일시 오류에도 나오므로 한 번으로 끊지 않는다. 약 30초 연속일 때만 방을 나가고 끊김 안내를 띄우며, 그 사이 정상 응답이 한 번 오면 다시 센다. 권한 회수 판정은 태블릿의 30초 확인(`can_take_call`)이 서버에서 맡는다. 서버가 끝난 상태를 돌려주면 바로 끝낸다. 시간이 지난 통화는 권한 판단 앞에서 닫는다 — 답만 거부일 뿐 낡은 행을 남기지 않는다.
- `getStaffCallStay(id)` — `checkin.view` 필요(이 액션만 문이 `checkin.call` 이 아니라 `checkin.view`). 내가 받아 진행 중인 통화의 stay 요약만. 코드 · 여권 · 서류 없음. stay 가 없거나 지워졌으면 `{ ok:false, errorKey:"not_found" }`.
- 기록: `audit_log` 의 `staff_call_accepted` · `staff_call_ended` · `staff_call_no_answer`, `device_id` 는 그 통화의 기기(시간 초과는 사람 없이 기기만), meta 는 `call_id` · `property_key` 만.
- 기기 폐기(`revokeCheckinDevice`): 그 기기의 진행 중 통화를 `ended`(`ended_by='system'`)로 닫고 방을 지운다. 실패해도 폐기는 완료된다.

**LiveKit 토큰 권한** (서버에서만 발급, 30분 유효, 방 이름 `call-<uuid>`, 비밀값은 환경 변수 `LIVEKIT_URL` · `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET`만, 운영 `LIVEKIT_URL` 은 `wss://` 필수 — 태블릿 앱이 평문을 막는다).

| 주체 | identity | 올리기 | 받기 |
| --- | --- | --- | --- |
| 태블릿 | `kiosk-<deviceId>` | camera, microphone | 가능 |
| 직원 | `staff-<userId>` | microphone 만 | 가능 |

환경 변수가 없으면 호출은 `unconfigured` 로 끝나고 행도 알림도 만들지 않는다. 태블릿은 「연결하지 못했어요」 화면(연락처)을 보여 준다.

## 6. 화면

**태블릿 (E1~E3)**: 직원 호출 → E1 부르는 중(원 하나가 2초 간격으로 퍼짐, 움직임 줄이기 설정이면 멈춤, 「취소」) → E2 손님 카메라 전체 화면 + 위쪽 「직원과 통화 중」 · 시간 + 「통화 끝내기」 → 끝나면 누른 자리로 복귀. 안 받거나 실패하면 E3(「지금 받는 직원이 없어요」 / 「연결하지 못했어요」 + 연락처 + 뒤로 · 다시 부르기). 통화 중에는 대기 시간 초기화를 멈추고, 체크인 카메라는 닫았다가 복귀할 때 다시 연다. 입력 중이던 값은 지우지 않는다. 마이크 · 카메라 권한이 없거나 방 입장에 20초 넘게 실패하면 E3.

**직원 미입장 · 이탈 규칙 (태블릿, 2026-11-06)**: 손님이 빈 통화 화면에 갇히지 않게 앱이 직접 시간을 잰다(서버 30분 한도에 기대지 않는다).
- 방에 들어간 뒤 **20초 안에 직원이 들어오지 않으면** 서버에 end 를 보내고 E3(「연결하지 못했어요」, 「다시 부르기」는 같은 단계로)로 간다. 입장하는 순간 직원이 이미 방에 있으면 기다리지 않는다.
- 통화 중 직원이 방에서 나간 뒤 **15초 안에 돌아오지 않으면** end 를 보내고 통화를 끝낸다(누른 자리로 복귀). 15초 안에 돌아오면 그대로 이어진다.
- 통화 중에는 **30초마다 `GET /api/kiosk/call/[id]`** 로 서버에 묻는다(권한 회수 · 30분 한도를 서버가 여기서 닫는다). `ended` 등 끝난 상태면 통화를 끝내고 누른 자리로, 401 · 404 면 end 를 보내지 않고 끝낸다. 네트워크 실패는 통화를 끊지 않는다. 통화 중 건물 설정이 꺼지거나 기기가 폐기되면 통화를 끝낸다.
- 권한을 거부한 채 「다시 부르기」를 누르면 서버를 부르지 않고 E3 를 그대로 둔다(직원 앱이 울리지 않는다).
- 손님 쪽 재접속 중 잠깐 끊긴 것은 직원이 나간 것이 아니므로 끝내지 않는다. 방 자체가 닫히면(서버 끝냄 · 재접속 실패 · 30분 한도) 바로 끝낸다.

**직원 폰 · 폴드 (E4 · E5 · E6)**: 레이아웃에 붙은 전체 화면 `role="dialog"`. 건물 이름 · 언어 · 누른 단계 + 닫기 · 받기 → 전체 영상 + 마이크 끄기 · 예약 보기 · 끊기. 울리는 동안은 소리(웹 오디오로 합성, 파일 없음)와 진동. **태블릿 폭 (E7)**: 통화 화면은 같은 전체 화면에 컨트롤을 아래 가운데에 둔다. 예약 보기는 영상 위 `BottomSheet`.

**직원 PC (E8 · E9)**: 어느 관리자 화면에서든 오른쪽 아래 카드 + 닫기 · 받기 + 소리. 받으면 오른쪽 440px 패널(영상 · 시간 · 손님 언어 · 누른 단계 · 예약). 예약 보기는 관리자 체크인 화면으로 이동하며 패널은 유지된다. 레이아웃에 붙이므로 화면을 옮겨도 통화가 끊기지 않는다. 분할 패널 프레임(`stayops-pane`) 안에서는 띄우지 않는다.

**설정**: `/admin/checkin/settings` 건물별 「직원 통화」 켜기 · 끄기(`checkin.manage`). 태블릿은 5분 간격 확인(ping) 때 반영하므로 켜고 끄는 데 최대 5분 걸린다. 그동안 꺼진 건물의 호출은 서버가 `disabled` 로 막고, 연락처로 넘어간다. 폼 아래 따로 있고 누르면 바로 저장한다. 폼의 동시 저장 검사 값(`updated_at`)은 바꾸지 않는다. 칼럼이 아직 없으면 항목을 숨긴다.

**알림 줄을 누르면**: 관리자 콘솔 + `checkin.view` 일 때만 `/admin/checkin` 으로 이동한다. 모바일 · 권한 없는 사람은 이동하지 않는다(빈 `href`). `checkin_staff_call` 은 그 호출이 아직 울리는 중이면 닫아 둔 받기 화면을 다시 띄운다.

**수신 동작**: 신호 · 첫 mount · 앱 복귀 · 재접속 때, 그리고 호출을 닫거나 통화 · 안내가 끝나 비었을 때 `getRingingStaffCalls()` 를 읽고(함께 온 호출 · 통화 중 온 호출), 받기 응답이 10초 안에 안 오면 실패로 끝낸다. 울리는 동안 2초마다 다시 읽어 누가 받았거나 끝나면 조용히 닫는다. 서버 소식이 끊겨도 처음 본 때부터 50초면 스스로 닫는다(기기 시계를 믿지 않으려고 마감 시각과 비교하지 않는다). 숨은 탭은 다시 보일 때 울린다(`useLiveRefresh` 규칙). 통화 중 3초마다 상태를 읽고, 손님이 30초 넘게 방에 없으면 끊는다. 페이지를 떠날 때 끊기는 `pagehide` 에서 시도하지만 전송이 보장되지는 않는다.

**문구**: 태블릿 ja · en · ko · zh-Hans, 직원 ko · ja · en. 한국어에 한자 용어 없음. 건물 이름은 `useBuildingName()`.

## 7. 앱에 필요한 것

- 태블릿 앱: `RECORD_AUDIO` · `MODIFY_AUDIO_SETTINGS` 권한, `io.livekit:livekit-android`.
- 직원 앱(Capacitor): iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO` · `MODIFY_AUDIO_SETTINGS`. **앱을 다시 빌드해야 적용된다.**
- 앱을 닫아 둔 직원 폰이 울리는 것은 Firebase · Apple 푸시 키가 생긴 뒤 다음 단계(`docs/planning/17` C5). 지금은 앱 · 웹을 열어 둔 사람에게 울린다.

## 8. 비용 · 위험

- LiveKit 무료: 월 5,000분, 동시 100. 넘으면 새 연결이 **실패**하고 요금은 붙지 않는다(공식 문서 확인 2026-11-06). 실패하면 연락처 화면으로 이어지므로 체크인은 막히지 않는다. 다음 요금제는 월 50달러 · 15만 분.
- 영상 · 음성이 LiveKit 서버를 거친다. 공식 페이지에 도쿄 지정은 적혀 있지 않고, 지역 고정은 상위 요금제 기능이다. 개인정보 안내 문구는 회사 확인이 필요하다.
- 로그에 손님 이름 · 영상 정보 · 토큰을 남기지 않는다. 기록은 `audit_log` 에 통화 id 와 건물만(`staff_call_started` · `staff_call_no_answer` · `staff_call_canceled` · `staff_call_ended`).

## 9. 검증

토큰 권한(직원 영상 올리기 불가) · 동시 받기(한 명만 성공) · 45초 초과 · 다른 조직 접근 거부 · 환경 변수 없음 · 건물 꺼짐을 자동 테스트로 확인한다. 실제 통화는 로컬 LiveKit 서버 + 에뮬레이터 + 브라우저로 확인한다. 실기기 · 운영 DB 확인은 통합 테스트 때 한다.
