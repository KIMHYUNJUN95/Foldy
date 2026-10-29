# Lost and Found Workflow

## 2026-08-06 localized system history

An admin restore entry is shared operational history, so the server stores a stable locale-neutral marker plus the optional reason. Admin and mobile readers translate that marker for the current `ko`/`ja`/`en` viewer. Existing Korean restore entries are recognized for backward-compatible display.

## Purpose

The lost and found workflow manages items found in rooms/properties from registration to storage, disposal scheduling, and final disposal.

The company generally stores lost items for 2 weeks. Expensive or important items may sometimes be stored longer.

## Required Fields

`lost_items` 실제 컬럼 (권위 있는 정의는 `docs/engineering/04-data-model.md`):

```txt
id
organization_id
cleaning_session_id        -- 청소 타이머에서 등록 시 연동 (nullable)
reported_by_user_id        -- 등록자
room_label                 -- free text (properties/rooms FK 아님, 청소 세션과 동일 패턴)
property_name              -- free text (nullable)
item_name
memo                       -- 등록 메모
image_urls                 -- 등록 사진 (≤5)
found_at
reservation_id             -- 예약 연동 (nullable, 서버 재검증 후 스냅샷)
guest_name                 -- 예약 연동 스냅샷 (nullable)
status                     -- lost_item_status (registered/stored/disposal_scheduled/disposed/returned)
handling_memo              -- 현장 처리 메모 (2026-07-15 신설). 등록 memo와 별개
handling_image_urls        -- 처리 증빙 사진 (≤5, 2026-07-15 신설)
handled_at                 -- 마지막 처리 시각 (2026-07-15 신설)
handled_by                 -- 마지막 처리자 (2026-07-15 신설)
handled_by_admin           -- 어드민 예외 개입 여부 (2026-07-15 신설, default false)
category                   -- lost_item_category (9종, not null default 'other', 2026-07-16 신설)
return_method               -- lost_return_method (delivery/pickup, nullable, 2026-07-16 신설)
return_tracking_no          -- 배송 송장번호 (nullable, 2026-07-16 신설)
hold_until                  -- 보관 연장 시 새 폐기 예정일 (date, nullable, 2026-07-16 신설)
hold_reason                 -- 보관 연장 사유 (nullable, 2026-07-16 신설)
created_at
updated_at
```

> `category`/`return_method`/`return_tracking_no`/`hold_until`/`hold_reason`은 어드민 분실물 콘솔
> 구현(2026-07-16)으로 신설됐다 — 마이그레이션 `supabase/migrations/202607180001_lostfound_console.sql`.
> 반환 방식은 **`delivery`(배송) / `pickup`(방문 수령)** 2종이다(기획 초안의 `shipped`/`picked_up` 명칭은
> 최종 구현에서 채택되지 않았다 — 아래 "대시보드 분실물 관리 콘솔" 절 참고).

> 과거 판에 있던 `property_id`/`room_id`/`photos`/`retrieval_status`/`retrieved_*`/`dispose_after`/
> `scheduled_for_disposal_at`/`disposed_at`는 코드·마이그레이션 어디에도 없는 가공의 필드였다.
> (2026-07-15 정정) 반환은 별도 `retrieved_*` 컬럼이 아니라 `status = 'returned'` + `handled_*`로 남는다.

## Field Meaning

### Found Property / Room

Required.

The item must be connected to the property and, when applicable, the room/unit where it was found.

Entry behavior:

- If the lost item is registered from an active cleaning timer, property and room/unit should be auto-filled from the active cleaning room.
- If the lost item is registered from the Lost and Found tab directly, the user must select property and room/unit.
- When property/room is auto-filled from cleaning, show a final confirmation popup asking the user to confirm the room is correct.
- If the auto-filled room is wrong, provide a pencil/edit icon so the user can correct the property/room before submitting.

### Item Name

Required.

Short name of the found item.

### Photos

Optional but strongly recommended.

Photos help identify the item later when a guest contacts the team.

Limit:

- Maximum 5 photos per lost item.
- Server check (2026-10-26): every URL must be our Storage `request-images` URL directly under
  `{orgId}/lost-items/{requestId}/` (shared `isOwnStoragePublicUrl()`).
- Upload owner = the client hook `usePhotoUpload` (2026-10-26): a failed insert no longer deletes the uploaded photos on
  the server (the retry re-sends the same URLs); the photos are removed only when the user abandons the confirm sheet.

Compression:

- Resize long edge to max 1600px.
- Use JPEG/WebP compression around 70-80% quality.

### Found Date / Time

Required, auto-filled.

The found date/time should be automatically filled based on the registration time.

Users should not need to manually enter found date/time during the normal quick flow.

### Reported By

Required, auto-filled.

The app should automatically store the staff member who registered the item.

### Guest / Reservation Link

Required when a likely reservation can be inferred, auto-suggested.

The app should automatically suggest the guest/reservation connected to the most relevant recent checkout for the selected room.

Rules:

- If registering from an active cleaning timer, use the guest/reservation from that room's checkout for the cleaning date when available.
- If registering from the Lost and Found tab directly, after the user selects property/room, show the most recent checkout guest for that room.
- The suggested guest/reservation should be visible to the user for confirmation.
- If the suggested guest/reservation is wrong or unavailable, the user should be able to edit or clear the link.

Implementation note (2026-07-09):
- The reservation-calendar linked entry is implemented via
  `/mobile/lost-found/new?reservationId=...`.
- In that path, the form opens with reservation-linked building / room / guest context already
  filled and stores optional `property_name`, `reservation_id`, and `guest_name` snapshots.
- The standalone direct lost-found form does **not yet** auto-suggest the latest checkout after
  room selection; that broader suggestion flow remains future work.

### Retrieval

> **정정 (2026-07-15, 2026-07-16 갱신):** 아래 `retrieval_status`/`retrieved_at`/`retrieved_by`/
> `retrieval_memo` 필드는 **구현된 적이 없다.** 반환(회수)은 별도 회수 컬럼이 아니라 **`status =
> 'returned'` + `handled_*`(처리자·시각·메모·사진)**로 남는다. 반환 방식(배송/직접수령)은
> **`return_method`(`delivery`/`pickup`) + `return_tracking_no`로 구조화 완료**(2026-07-16, 어드민
> 분실물 콘솔 구현 — 아래 "대시보드 분실물 관리 콘솔" 절 참고). 이 절은 초기 요구사항 배경으로만
> 보존한다.

The workflow needs retrieval tracking.

Retrieval means the customer/guest has picked up or received the item.

It does not mean internal staff collected the item from the room.

Possible fields:

```txt
retrieval_status
retrieved_at
retrieved_by
retrieval_memo
```

When retrieval is completed:

- The item should no longer be included in automatic disposal scheduling.
- The retrieval date/time should be saved.
- The staff member who processed retrieval should be saved.

No additional required retrieval form is needed for the first version.

Reason:

- The person who registered the lost item and the person who completes retrieval may be different.
- The staff member who physically gives the item to the guest or ships it should simply mark it as retrieved.
- Guest pickup and shipping are both common, but do not require separate mandatory fields in the MVP.
- Extra details can be written in memo if needed.

### Memo

Optional.

Used for internal notes, guest contact notes, or special handling instructions.

## Statuses

Confirmed statuses (5 — `returned` added 2026-07-15):

- registered
- stored
- disposal_scheduled
- disposed
- **returned** ← 신규. 손님에게 전달을 마친 완료 상태.

Display labels:

```txt
registered: 접수됨 / 受付済み / Registered
stored: 보관중 / 保管中 / Stored
disposal_scheduled: 폐기예정 / 廃棄予定 / Disposal Scheduled
disposed: 폐기됨 / 廃棄済み / Disposed
returned: 반환완료 / 返却済み / Returned
```

`returned`의 배경: 기존 4상태는 "아무도 안 찾아가서 결국 폐기한다" 흐름만 담고 있어, 물건이
**주인에게 돌아가는 결말**을 담을 상태가 없었다. 수리·점검의 완료(`closed`)에 대응하는 개념으로
`returned`를 추가했다. DB enum은 값을 **추가**만 한다(제거 없음) — 마이그레이션
`202607170001_lostfound_return.sql`.

**완료(terminal) 상태 = `returned` 또는 `disposed`.** 이 두 상태에서는 상세 화면이 처리 블록 대신
처리 이력(처리자·시각·메모·사진)을 보여준다. `registered`/`stored`/`disposal_scheduled`는 진행
상태다. 읽기 전용 진행바(폐기 경로)는 `returned`를 제외한 4단계만 표시한다 — 반환은 이 선형 흐름
밖의 완료이기 때문.

## Storage & Disposal Policy (확정, 2026-07-16 — 자동 생애주기)

회사 정책 + 자동 생애주기(2026-07-16 확정, 이전 "수동 폐기" 결정을 대체):

- 분실물은 **등록일(습득 시각으로 auto-fill되는 `found_at`)로부터 2주(14일)** 보관한다.
- **자동 폐기.** 등록일 + 14일이 지나고 아직 **미반환·미연장**이면, 시스템이 **자동으로 `disposed`**
  처리하고 **폐기 내역**으로 옮긴다. 매번 사람이 수동으로 폐기하지 않는다(운영 부담 때문 — 사용자 결정).
  자동 폐기 DB 함수(`lostfound_auto_dispose()`)는 메모가 비어 있으면 한국어 한 줄 「보관기간 만료 자동 폐기」를
  `handling_memo` 에 넣는다 — **저장값은 그대로 두고** 화면(어드민 상세 패널 · 모바일 분실물 상세)이 그릴 때
  `localizeLostFoundMemo()`(`src/lib/lost-found-memo.ts`) 가 `lostFound.autoDisposeMemoLabel`(ko/ja/en)로 바꾼다(2026-10-23).
- **보관 기간 연장(예외).** 관리자가 폐기 예정일을 미룰 수 있다(주로 고가·중요 물품). 연장된 건
  (`hold_until` 설정)은 그 날짜까지 자동 폐기에서 제외된다. '고가'를 별도 플래그로 저장하지 않고 연장으로만
  표현하며, 사유는 메모로 남긴다.
- **폐기 내역 90일 보관 → 자동 삭제.** 폐기된 건은 **폐기 내역**에 남아 **폐기일로부터 90일** 보관된다.
  이 기간 손님 문의·분쟁에 대비한다. **90일이 지나면 자동으로 하드 삭제**(레코드 완전 제거, 되돌릴 수
  없음)된다.
- **수동 개입은 그대로 병존.** 사무실은 14일 전이라도 조기 폐기·반환·연장을 할 수 있고, 잘못된·중복 등록은
  즉시 수동 하드 삭제로 정리한다(수동 삭제는 감사 기록을 남기지 않는다).

생애주기 요약:

```txt
등록 → 보관중
  ├─ (언제든) 반환 → returned          … 완료(반환). 자동 폐기 대상 아님.
  ├─ (사무실) 조기 폐기/연장/반환/삭제  … 능동 처리·예외 개입
  ├─ (사무실) 완료 건 복원 → 보관중     … 예외 개입. returned/disposed → stored,
  │                                       보관 시계 = 복원일+14일로 재설정.
  └─ 등록일+14일 경과 & 미반환 & 미연장
        → [자동] disposed → 폐기 내역
             └─ 폐기일+90일 경과 → [자동] 하드 삭제(레코드 제거)
```

> **자동 처리 = 스케줄 작업 (구현 완료, 2026-07-16).** "자동 폐기(14일)"와 "자동 삭제(폐기+90일)"는
> Supabase **pg_cron**으로 매일 1회 실행된다. `public.lostfound_auto_dispose()`(폐기 임박 3일 전 →
> `disposal_scheduled`, 만료 → `disposed` + 자동 처리 메모)와 `public.lostfound_auto_purge()`(`disposed`
> & 폐기일+90일 경과 → 하드 삭제, `status='disposed'` 가드)는 도쿄 자정 근처(UTC `15:05`/`15:15`)에 매일
> 실행되도록 `cron.schedule`로 등록됐다 — 마이그레이션
> `supabase/migrations/202607180001_lostfound_console.sql`. **✅ 원격 Supabase(Foldy)에 적용 완료
> (2026-07-16, MCP).** pg_cron(1.6.4) 확장 활성화 + 컬럼 5개·enum 2종·함수 2종·cron 잡 2개(active) 검증
> 완료. 이 자동 삭제(90일 보관 후 purge)는 CLAUDE.md의 "user-triggered hard delete" 기본값에 대한
> **명시적으로 승인된 예외**다(사용자 승인, 2026-07-16). 수동 삭제는 여전히 즉시 하드 삭제로 남는다.

> 구 판의 "30일 후 disposal_scheduled → 추가 기간 후 자동 삭제"와 2026-07-15의 "수동 폐기" 문안은 모두
> 폐기됐다. 실제 정책은 **14일 자동 폐기 → 폐기 내역 90일 → 자동 삭제 + 연장 예외**다. 상세 계산·뷰는
> 아래 "대시보드 분실물 관리 콘솔" 절이 기준이다.

## Creation Entry Points

Lost items can be created from:

- Lost and Found tab
- Quick action on mobile home
- Active cleaning timer
- Admin web

> **Implementation note (2026-05-21):** Linked-mode creation and list/status management implemented.
> - `/mobile/lost-found/new` accepts optional `?sessionId=`. Session validated server-side (same user, same org); invalid `sessionId` shows explicit error state (no form render); login redirect preserves `sessionId` in `next`.
> - Client-side required-field validation blocks confirmation sheet if `item_name` is empty; inline error shown below the field.
> - `/mobile/requests` shows current user's own lost items and maintenance reports in a combined view with color-coded status badges.
> - `/admin/lost-found` lists all org-scoped lost items with room, item name, status, reporter, and found-at columns; rows link to detail pages.
> - `/admin/lost-found/[id]` shows full item detail and a status-change form (select + submit). Status updates validated server-side (role + org ownership); success/error banners driven by `?statusUpdated` / `?error` search params.

## Visibility

All users can create and view lost item records.

The Requests tab should include:

- All lost item records
- My registered lost item records

Default mobile behavior:

- `All` scope should be the default list mode in `/mobile/requests`.
- `My registered lost item records` should be available via an explicit scope filter/toggle.

## 화이트 리디자인 (2026-10-14, 시안 LF-PC · LFReturn-PC · LFDisposed-PC · LFAll-PC · LFAct-PC · LFDetail-Phone · LFDetail-Fold · LF-Tablet · LFDone-Phone · LFReturned-Phone)

- **PC 보기 넷**(`lost-found-console.tsx`): **보관 중 · 반환 · 폐기 내역 · 전체 기록**(예전 현황 보드 · 목록·이력 · 완료 · 폐기 내역). 보기 줄 하나에 탭(아이콘 없음) + 보기마다 고르기 —
  보관 중: 「● 실시간 · 방금 갱신」 · 건물 · 분류 / 반환: 기간 · 반환 방식 · 건물 / 폐기 내역: 기간(폐기일) · 건물 / 전체 기록: 기간(등록일) · 검색 · 상태 · 건물 · 신고자.
  예전 「완료」(반환 + 폐기)는 **반환만** 보는 「반환」으로 바뀌었다(폐기는 폐기 내역에). 예전 「목록 · 이력」은 진행 중만 보였는데 「전체 기록」은 **진행 중과 완료를 모두** 보여 준다.
- **보관 중**(`lost-found-board.tsx`): 상태 3칸 보드 대신 **보관 타임라인** — 진행 중(접수 · 보관중 · 폐기예정)을 자동 폐기까지 남은 날 순으로 한 줄씩:
  사진(없으면 분류 아이콘) · 품목 · 「분류 · 손님(또는 신고자) · 사진 n」(연장이면 「연장됨 · M/D까지」) | 호실 · 건물 | 보관 경과 막대(지난 날 / 전체, 3일 이내 · 만료면 빨강, 연장이면 회색 — 막대가 채워지며 등장) · 「12/14일」 | 자동 폐기 D-n(연장이면 날짜, 만료면 「n일 경과」).
  위 숫자 다섯: 보관 중(진행 중 전부) · 폐기 임박(3일 이내 + 만료) · 이번 달 반환(배송 n · 직접 수령 n) · 이번 달 폐기(자동 n · 수동 n) · 폐기 내역(삭제 임박 n · 90일 보관). 예전 「폐기 대상」 칸은 폐기 임박에 합쳤다.
- **반환**(`lost-found-done.tsx`): 기간 숫자 셋(이 기간 반환 · 배송 · 직접 수령) + 표(반환 시각 · 품목 · 위치 · 방식 · 송장번호 · 처리자).
- **폐기 내역**(`lost-found-disposal.tsx`): 위 안내 한 줄(90일 뒤 자동 삭제) + 표(폐기일 · 품목 · 위치 · 자동/수동 · 삭제 예정 · 남은 날, 7일 이내는 「D-n · 곧 삭제」 빨강).
- **전체 기록**(`lost-found-list.tsx`): 「n건 · 등록일 최신 순」 + 표(등록 · 품목 · 위치 · 분류 · 신고자 · 상태 색 글자). 검색은 품목 · 위치 · 신고자 · 손님.
- 표는 상자 없이 줄만, 고른 줄은 옅은 보라 바탕(왼쪽 막대 없음), 누르면 살짝 눌림. 빈 · 오류 상태도 상자 없음.
- **상세 패널**(`lost-found-detail-panel.tsx`): 위 한 줄(폐기 임박/만료 · 상태 · 반환 방식 · 연장 · 분류) + 삭제(빨간 휴지통) · 닫기 → 제목 → 호실 · 건물 → 사진 →
  진행 중이면 「자동 폐기까지 D-n」 막대 + 「M/D 등록 · n일째 보관 · M/D 자동 폐기 예정」 → 정보 줄(완료면 처리 시각 · 처리자 / 송장 / 삭제 예정, 손님 · 숙박, 신고자 · 발견 시각, 연장 사유, 메모, 완료면 처리 메모) → 완료면 증빙 사진.
  아래: 진행 중 = **[반환 처리]** · [보관 연장 | 폐기 처리] · 상태 정정(글자 버튼), 완료 = 「예외 개입」 **보관 중으로 복원** + 「복원하면 오늘부터 14일 다시 보관해요」. 예전 칩 · 상자 · 능동 처리 상자 · 아래 「닫기」 버튼 제거.
- **처리 창**(`lost-found-action-modal.tsx`): 제목(반환 처리 등) · 「품목 · 호실」 · 설명 한 줄 → 반환이면 [직접 수령 | 배송] 토글(배송이면 송장번호 칸이 나타남), 연장이면 새 폐기 예정일(공용 `AdminDatePicker`), 정정이면 3칸 상태 토글 →
  테두리 이름표 메모 칸 → [취소][확인] 두 개. **× 없음 — 닫기는 「취소」 하나**(Esc · 바깥 누르기도 취소). 살짝 커지며 나타남. 처리 창에서 증빙 사진은 받지 않는다(서버 액션이 받지 않음 — 시안의 사진 줄은 뺐다).
- **모바일 상세**(`/mobile/requests/lost-found/[id]` · `lost-found-handling-form.tsx` · `lost-found-detail.css`, 수리 상세의 `.mdw` 위에): 카드 대신 위 한 줄(폐기 임박/만료 · 상태 · 분류 · 청소에서 등록) → 제목 → 「호실 · 건물 · 신고자 · M/D HH:mm」 → 사진 →
  진행 중이면 **「자동 폐기까지 D-n」 막대**(새 공용 계산 `lostItemClock()` — `src/lib/lost-found-constants.ts`, 어드민과 같은 규칙: `hold_until` ?? 발견일 + 14) + 「n일째 보관 · M/D 자동 폐기 예정 · 연장은 오피스에서 해요」 → 메모 → 손님 →
  **현장 처리**: 5칸 상태 토글(누르면 가벼운 진동) · 반환완료로 바꾸면 경고 한 줄 · 테두리 이름표 메모 · 증빙 사진 · 저장(저장되면 초록 체크 + 성공 진동). 반환완료 확인 시트는 그대로(상자 없는 정보 줄로).
  완료 건은 **처리 기록**(체크가 그려지는 초록 원 · 처리자 · 시각 · 반환 방식 · 송장 · 메모 · 증빙 사진 · 「상태 정정 · 무효는 어드민에서만」). 파트타임은 잠금 한 줄. 예전 읽기 전용 진행바 · 상자 · 배지 제거.
  휴지통은 넣지 않는다(삭제는 목록에서 — 수리 상세와 같음). 손님은 이름만(모바일엔 숙박 날짜가 없다).
- **모바일 요청 목록 · 분실물 탭**(`requests-filter-view.tsx`): 날짜 묶음 대신 **「보관 중 · 자동 폐기 가까운 순」 → 「완료 · 최근 순」** 묶음(사용자 승인 2026-10-14). 보관 중 줄은 시각 대신 **D-n**(만료면 D+n), 3일 이내 · 만료는 상태 글자가 빨강. 다른 탭(전체 등)은 날짜 묶음 그대로이고 분실물 줄의 D-n · 빨강만 같이 쓴다.
- **반환완료 · 폐기 내역 목록**(`lost-found-archive-list.tsx` — 두 화면 공용으로 합침): 제목 → 숫자 셋(전체 · 이번 달 · 이번 주, 올라오며 등장) → 검색 + 「필터」(기간 4칸 토글 · 건물 고르기 시트) → 월별 묶음 한 줄 행(품목 / 호실 · 건물 · 처리자(자동 폐기면 「시스템(자동)」) / 반환 방식 · 송장 | M/D HH:mm).
  예전 상자 카드 · 왼쪽 색 막대 · 배지 · 알약 칩 제거.
- **분실물 신고 폼**(`/mobile/lost-found/new` · `lost-found-create-form.tsx`, 2026-10-14 시안 LFNew-Phone · LFNewConfirm-Phone · LFNew-Fold): 아이콘 카드 · 번호 붙은 상자 구역 대신 제목 「분실물 신고」 + 「발견한 물건을 등록하면 14일 동안 보관해요」 → 이름표 칸 건물 · 객실 → 물품명 → **분류는 드롭다운 대신 3칸 타일**(사용자 승인) → 메모(선택) → 사진(흰 모양 72px 타일, 업로더 `variant="white"`) → 등록자(자동) → [분실물 등록] → 확인 시트(위치 · 분류 · 사진 · 「14일 · M월 D일 자동 폐기 예정」 · [취소][등록]). 일반 신고 화면의 「청소로 돌아가기」 버튼은 청소에서 넘어왔을 때만 보인다. 공용 조각 `request-form-kit.tsx`(이름표 고르기 칸 · 고르기 타일 · 읽기 전용 칸 · 확인 시트).

## 설계 원칙 — 감시 + 이력 + 예외 개입 (확정, 2026-07-15)

분실물은 수리·점검과 **동일한 매커니즘**을 쓴다. 습득물은 결국 현장이 손에 쥐고 있으므로,
**현장이 모바일에서 직접 처리**한다(상태 변경 · 처리 메모 · 증빙 사진 전부 모바일).

- **배정 개념이 없다.** 등록자와 무관하게 **누구나(파트타임 제외) 처리 가능** — 특히 반환은 손님에게
  물건을 넘긴 사람이 그대로 저장한다.
- 대시보드의 역할 = **감시(oversight) + 이력(record) + 예외 개입**. (예외 개입 = 상태 정정 · 복원 ·
  삭제 — **2026-07-16 어드민 콘솔에 구현 완료**. 무효(void)는 두지 않는다. 아래 "구현 요약" 참고.)
- **현장(모바일)에서 반환완료는 되돌릴 수 없는 완료**이라, 저장 전 canonical `BottomSheet`로 한 번 더
  확인한다(오조작 방지). 그 외 상태 변경은 확인 없이 바로 저장. (되돌리기는 어드민 콘솔의 **복원**만
  가능 — 관리자 전용.)
- 저장하면 **처리자·시각**이 기록으로 남는다(`handled_by` / `handled_at`).

### 모바일 현장 처리 (2026-07-15 신설)

- 화면: 분실물 상세 `/mobile/requests/lost-found/[id]`. 기존 카드1(품목·위치·사진)은 그대로.
  읽기 전용이던 상태 스테퍼(카드2)를 **처리 블록**으로 승격.
- 컴포넌트: `src/components/requests/lost-found-handling-form.tsx` (수리·점검의
  `MaintenanceHandlingForm`과 동일 구조). 상태 칩 5개 + 처리 메모 + 증빙 사진(≤5) + 저장.
- 서버 액션: `updateLostItemHandling`
  (`src/app/mobile/requests/lost-found/actions.ts`). part_time 차단 → 이미지 경로 검증
  (`{org}/lost-found-handling/{itemId}/`) → 영향 행 수 확인(RLS backstop) → `handled_*` 기록.
- 상세 페이지 분기: **완료(returned/disposed) → 처리 이력 카드**, **처리 가능(비-파트타임) → 처리
  블록**, **파트타임 → 읽기 전용 진행바 + 잠금 안내**.
- 증빙 사진은 `request-images` 버킷의 `{org}/lost-found-handling/{itemId}/` 경로. 스토리지 정책
  화이트리스트에 `lost-found-handling` 추가(마이그레이션 `202607170001`).
- **2026-10-26 디버깅 — 현장 처리 고침**
  - **반환 방식**: 반환완료로 새로 넘길 때 상태 칸 아래에 어드민 반환 창과 같은 **[직접 수령 | 배송]** 토글(기본 직접 수령)이
    나타나고, 배송이면 **송장번호(선택)** 칸이 열린다(사전은 `lostFound.console.mrMethod` · `mrPickup` · `mrDelivery` ·
    `mrTracking` · `mrTrackingPh` 재사용). 확인 시트에도 「반환 방식 · 송장」 줄. 서버는 반환완료로 새로 넘어갈 때
    `returnMethod` 가 없으면 `return_method_required` 로 거절한다(예전 모바일은 방식을 안 물어 `return_method` 가 비고
    송장은 `""` 로 저장됐다). 송장번호는 어드민과 같이 선택 — 배송일 때만 저장(100자까지).
  - **갈 수 있는 상태만**: 상태 5칸 중 지금 상태에서 갈 수 없는 칸은 흐리게 · 누를 수 없다. 규칙은 서버와 같은
    `isValidLostItemTransition()`(`src/lib/lost-found-handling.ts` — 클라이언트 · 서버 공용으로 옮김): 한 단계 전진 ·
    진행 중 어디서든 반환 · 종결에서 나가기 금지.
  - **증빙 사진 이어 붙이기**: 새로 고른 사진만 보내고 서버가 저장된 사진 뒤에 붙인다(예전엔 통째로 바꿔 이전 사진이
    사라졌다). 합쳐 5장 — 넘으면 `too_many_photos`. 업로더는 남은 장수만, 진행 중 상세에도 이미 남긴 증빙 사진을 보여 준다.
    주소 검사는 공용 `isOwnStoragePublicUrl()`(`src/lib/storage-url-guard.ts`).
  - **두 번 저장 막기**: 사진 올리기부터 저장까지 버튼이 잠기고, 성공하면 고른 사진을 비우며, 실패하면 방금 올린 사진을 지운다.
  - **동시 변경**: 화면을 열 때 본 상태(`expectedStatus`)와 지금 상태가 다르면 `conflict`(「방금 다른 사람이 이 분실물을
    바꿨어요」) — 업데이트에도 `.eq("status", 읽은 상태)` 가드.
  - **처리 메모의 시스템 줄**: 고치는 칸에는 사람이 쓴 줄만 넣는다(`splitLostFoundHandlingMemo()`). 관리자 복원 표시
    (`[stayops:admin_restore] …`)는 보는 사람 언어로 바꾼 글로 칸에 들어가 그 언어로 굳어 저장되던 문제 — 이제 서버가
    저장할 때 시스템 줄을 원래대로 뒤에 다시 붙인다.

### 반환완료 전용 목록 (2026-07-15 신설)

반환완료(`returned`)된 분실물만 따로 모아 보는 전용 화면. 반환이 늘어나면 일반 목록에서는 진행 중인
건에 묻히기 때문에, 반환 이력을 한눈에 보고 검색·필터할 수 있게 분리했다.

- **진입점**: 요청 → 분실물 탭의 필터 행, **"내 등록" 토글 옆**에 네이비 아웃라인 "반환완료" pill
  (`requests-filter-view.tsx`, 분실물 탭에서만 렌더). 누르면 전용 화면으로 이동.
- **경로**: `/mobile/requests/lost-found/returned`
  (`src/app/mobile/requests/lost-found/returned/page.tsx`).
- **구성**: 상단 통계(총 반환 / 이번 달 / 이번 주, Tokyo 기준 서버 계산) + 검색(물품·등록자·객실) +
  기간(전체/오늘/7일/30일)·건물 필터(canonical `BottomSheet`) + **월별 그룹**(이번 달 / 지난 달 /
  그 이전은 "YYYY년 M월") 카드. 카드마다 반환일시·처리자·위치·처리 메모.
- 클라이언트: `src/components/requests/lost-found-archive-list.tsx`(2026-10-14 화이트 리디자인에서 반환완료 · 폐기 내역 공용으로 합침 — 예전 `returned-lost-found-list.tsx`). 데이터는
  `getReturnedLostItems(session)`(`src/lib/lost-found.ts`) — `status='returned'`, `handled_at`
  내림차순, `found_at` 기간 제한 없음(오래전 발견돼도 최근 반환된 건이 위로).
- 카드 탭 → 기존 상세(`/mobile/requests/lost-found/[id]`). 상세는 완료이라 처리 이력 카드를 보여준다.
- **범위 메모**: 기간 필터는 프리셋(전체/오늘/7일/30일)만 — 디자인의 "사용자 지정" 커스텀 범위는
  모바일 canonical 범위 피커가 없어 이번엔 제외(후속). 통계는 필터와 무관하게 전체 기준으로 고정 표시.

### 폐기 내역 전용 목록 (2026-07-16 신설)

대시보드에 **폐기 내역** 뷰가 생기면서, 모바일에도 대칭되는 폐기 전용 목록을 추가해 정합을 맞췄다.
반환완료 목록을 **1:1 미러링**하고 톤만 슬레이트(폐기)로 바꾼 것이다. **읽기 전용** — 복원/삭제는
관리자 전용(`canForceCompleteCleaning`)이라 모바일엔 없다.

- **진입점**: 요청 → 분실물 탭 필터 행, **반환완료 pill 옆**에 슬레이트 아웃라인 "폐기 내역" pill
  (`requests-filter-view.tsx`, 분실물 탭에서만 렌더, `Trash2` 아이콘 + `dictionary.lostFound.disposed.entry`).
- **경로**: `/mobile/requests/lost-found/disposed`
  (`src/app/mobile/requests/lost-found/disposed/page.tsx`).
- **구성**: 상단 통계(총 폐기 / 이번 달 / 이번 주, Tokyo 기준 서버 계산) + 검색 + 기간·건물 필터
  (canonical `BottomSheet`) + 월별 그룹 카드. 카드마다 **폐기일시 · 처리(자동/수동) · 위치 · 처리 메모**.
  **처리 라인은 `handled_by` 유무로 자동/수동을 구분** — 자동 폐기 배치가 처리한 건은 "시스템(자동)"
  (`metaAuto`), 관리자 수동 폐기는 처리자 이름.
- **삭제 예정일(90일) D-day는 표시하지 않는다** — 90일 자동삭제는 관리자 오버사이트 영역이라 모바일은
  폐기일까지만 보여준다(사용자 결정 2026-07-16). 대시보드 폐기 내역 뷰에는 삭제 시계가 있다.
- 클라이언트: `src/components/requests/lost-found-archive-list.tsx`(반환완료와 같은 공용 목록 — 예전 `disposed-lost-found-list.tsx`). 데이터는
  `getDisposedLostItems(session)`(`src/lib/lost-found.ts`) — `status='disposed'`, `handled_at`
  내림차순(자동/수동 폐기 모두 포함).
- 카드 탭 → 기존 상세(`/mobile/requests/lost-found/[id]`). 완료 상태라 처리 이력 카드를 보여준다.

## Status Change Permission

Can change status (모바일 현장 처리 + 어드민 모두 동일 게이트):

- Developer / Super Admin
- Owner
- Office Admin
- CS Staff if permitted
- Field Manager
- Staff

Cannot change status:

- Part-time Staff (모바일에서 처리 블록 대신 읽기 전용 안내를 본다. 서버 액션·RLS가 최종 게이트.)

> RLS 보강 (2026-07-15): 기존 lost_items UPDATE 정책은 `owner/office_admin/cs_staff/field_manager`만
> 허용해 **`staff`가 빠져 있었다**(수리·점검에서 고친 것과 같은 누락). "반환은 누구나"가 요구사항이라
> `staff`를 추가하고 `with check`도 붙였다 — 마이그레이션 `202607170001_lostfound_return.sql`.

## Edit and Delete Permission

### Who can delete

| Role | Own records | Others' records |
|---|---|---|
| developer_super_admin | ✅ | ✅ |
| owner | ✅ | ✅ |
| office_admin | ✅ | ✅ |
| cs_staff | ✅ | ✅ |
| field_manager | ✅ | ❌ |
| staff | ✅ | ❌ |
| part_time_staff | ✅ | ❌ |

### Entry point

- Delete button is accessible directly from the **request list view** (icon button per card).
- Delete is also accessible from the request detail page.

### Deletion behavior

- Hard delete — record is permanently removed.
- Show a confirmation modal before executing.
- Confirmation modal must include the item name to prevent accidental deletion.
- On success, remove the card from the list and refresh.

### Server-side enforcement

- RLS DELETE policy enforces ownership check for non-admin roles.
- Admin roles bypass ownership check but must still be authenticated org members.
- The server action validates role before executing the DELETE.
- Show confirmation popup before deleting.

When created from an active cleaning timer, the record should automatically link to:

- Cleaning record
- Property
- Room/unit
- Reporter
- Found date/time
- Most relevant checkout guest/reservation for that room when available

The app should show a final confirmation popup before submitting a lost item created from the cleaning timer:

- Confirm property/room
- Confirm suggested guest/reservation if available
- Allow editing via pencil/edit action before final submit

## Alerts

Potential alerts:

- Item nearing auto-disposal (D-3)
- Item auto-disposed (moved to disposal history)
- Disposal record nearing auto-delete (90-day retention, D-7)
- Guest/reservation linked to item

> 구 후보였던 "High-value item registered"는 뺐다 — '고가'를 별도 플래그로 저장하지 않기로 했기
> 때문(2026-07-15). 보관을 더 해야 하는 물품은 **보관 기간 연장**으로만 다룬다.

## Admin Surface (`/admin/lost-found`) — 역사적 기록, 2026-07-16 콘솔로 대체됨

> **주의 (2026-07-16):** 아래 "Filters and Export" 절은 `/admin/lost-found`가 목록+필터+내보내기
> 화면이던 시절(2026-07-14)의 기록이다. **이 화면은 2026-07-16 "대시보드 분실물 관리 콘솔" 절의 운영
> 콘솔로 완전히 대체됐다** — 구 필터폼·`LostFoundExportBar`·`/admin/lost-found/[id]` 상세 라우트는
> **삭제**됐고, 내보내기는 제거됐다(아래 "대시보드 분실물 관리 콘솔" 절이 현재 상태다). 이 절은 히스토리
> 보존용으로만 남긴다.

### Filters and Export (2026-07-14, 폐기됨 — 2026-07-16 콘솔로 대체)

- **Filter bar**: date range (formerly two native `<input type="date">` fields) now uses the shared
  `<DateRangeFormField>` (`src/components/admin/shared/date-range-form-field.tsx`, an
  `AdminDateRangePicker` popover + 2 hidden inputs). `startDate`/`endDate` search params are unchanged,
  so deep links still work. Status filter unchanged.
- **Export = Excel + PDF (was CSV).** The old `ExportCsvLink` download link was replaced with
  `LostFoundExportBar` (`src/components/admin/lost-found/lost-found-export-bar.tsx`) rendering the
  canonical `<AdminExportButtons>`. New server actions `exportLostFoundWorkbook(filters)` /
  `exportLostFoundReport(filters)` (`src/app/admin/lost-found/actions.ts`) — gated by
  `requireAdminSession()` + organization scope. The client sends only the current filter values, never
  row data; the server re-queries via `getOrgLostItems` so the file always matches the filtered screen.
- **Export columns** (carried over from the old CSV headers): building / room / item name / status /
  reporter / found-at.
- Output goes through the shared admin export builders (`src/lib/admin-table-workbook.ts` /
  `admin-table-report.ts` — the same green-ledger template used across the whole admin console).
  Language is resolved server-side from `session.user.preferredLanguage`; the client never passes a
  locale.
- **The old `/api/admin/export/lost-found` CSV route no longer exists.** All `/api/admin/export/*`
  endpoints were removed on 2026-07-14 as part of a console-wide export unification (see
  `docs/product/07-cleaning-workflow.md` and `docs/product/10-order-request-workflow.md` for the same
  change on cleaning records and order requests).

## 대시보드 분실물 관리 콘솔 (2026-07-16, 구현 완료)

> **상태: 구현 완료 (빌드 그린).** 2026-07-15 기획을 2026-07-16에 실제로 구현했다. 수리·점검 어드민
> 콘솔(`08-maintenance-workflow.md`의 "설계 원칙" + "디자인 + 백엔드 연동")과 **같은 매커니즘**을 쓰되,
> **분실물만의 능동 처리**를 더했다. `npm run lint` / `npm run build` 통과. **✅ 마이그레이션
> `supabase/migrations/202607180001_lostfound_console.sql` 원격 적용 완료(2026-07-16, MCP + pg_cron 활성화).**
> 자동 생애주기(자동 폐기·자동 삭제)와 신규 컬럼이 DB에서 동작한다. 자세한 구현 내역은 아래 "구현 요약" 절 참고.

### 성격 — 감시 + 이력 + 예외 개입 + (분실물 한정) 능동 처리

수리·점검 대시보드는 **순수 감시**였다(처리는 전부 현장 모바일). 분실물은 다르다. 현장이 등록·보관하지만,
**손님에게 돌려주는 마무리와 보관기간 만료 처리는 사무실이 조율**하는 경우가 많다 — 특히:

- **배송 반환**: 손님이 직접 못 오면 사무실이 택배로 보낸다.
- **보관 만료 폐기**: 회사 정책상 2주 보관 후 폐기. 폐기 판단·집행은 사무실 몫.
- **고가 물품 보관 연장**: 값비싼/중요 물품은 사무실이 폐기 예정일을 미룬다.

그래서 분실물 콘솔은 감시·이력·예외 개입에 더해 **능동 처리 3종(반환 · 폐기 · 보관 기간 연장)**을 사무실이
대시보드에서 직접 한다. (현장 모바일도 여전히 반환·상태 변경이 가능하다 — 사무실 처리와 병존한다.)

### 필요한 기능 (needed)

1. **열람·현황** — 등록된 분실물 전체를 조직 스코프로 본다. 대시보드 신규 등록은 하지 않는다.
2. **필터·검색** — 기간 / 상태 / 건물 / 신고자 / 검색어(품목·객실·손님). 공용 프리미티브
   (`AdminDateRangePicker`, `AdmDropdown`) 재사용.
3. **보관 만료 감시(aging)** — 2주 정책을 파생 계산으로 시각화. **폐기 임박(D-3)** 배지와 KPI로 "곧
   자동 폐기됨 → 남기려면 지금 연장" 경고를 준다. (저장하지 않고 조회 시 계산.)
4. **자동 생애주기** — 등록일 + 14일 경과 & 미반환 & 미연장 → **자동 폐기** → 폐기 내역으로 이동. 폐기일
   + 90일 경과 → **자동 하드 삭제**. (스케줄 작업. 아래 "상태 모델 · 자동 생애주기" 참고.)
5. **폐기 내역 뷰** — 자동/수동 폐기된 건 목록. 각 건 **삭제 예정일(폐기일 + 90일) D-day** 표시. 90일 보관
   기간을 눈으로 관리. (사용자가 요구한 신규 화면.)
6. **능동 처리 3종** (자동과 병존)
   - **반환 처리** — 방식(배송 / 직접수령) 선택. 배송이면 송장번호. → `status=returned`.
   - **폐기 처리** — 14일 전이라도 **조기 폐기**하거나, 자동 폐기 건에 사유·사진을 남긴다. → `status=disposed`.
   - **보관 기간 연장** — 폐기 예정일을 미룬다(새 날짜 지정) → 자동 폐기 제외. 주로 고가·중요 물품이지만,
     **'고가'를 별도 상태로 저장·표시하지 않고 연장 자체로만** 표현한다. 연장 사유는 자유 메모로 남긴다.
7. **처리 이력** — 처리자 · 시각 · 메모 · 증빙 사진(반환/폐기 공통, ≤5). 기존 `handled_*` 재사용. 자동
   폐기 건은 처리자가 "시스템(자동)"으로 표시된다.
8. **예외 개입** — 상태 정정 · **복원** · 삭제 3종. (수리·점검의 예외 개입과 같은 자리·역할 게이트. 단
   분실물은 **무효(void) 상태가 없어** 잘못된 등록은 삭제로만 정리한다.)
   - **상태 정정** — 진행 3종(접수/보관/폐기예정) 사이에서 잘못된 자동/수동 상태를 되돌린다.
   - **복원(restore)** — **완료(폐기/반환) 건을 다시 보관중으로 되돌린다**(2026-07-16 신설). 관리자
     실수·고객 재방문 등 변수 대응. 상태 → `stored`, `hold_until` → **복원일+14일**(자동 폐기 배치가
     발견일+14 기준으로 즉시 재폐기하지 않도록 보관 시계를 새로 준다), `return_method`/`return_tracking_no`/
     `handled_at`/`handled_by`/`hold_reason` 초기화·`handled_by_admin=false`. 복원 사유는 기존 처리
     메모에 `"관리자 복원: {사유}"`로 **덧붙여 감사 흔적을 남긴다**(삭제와 달리 기록을 남긴다). 완료 상태
     상세 패널에서만 노출(삭제 버튼 앞), 서버 액션은 `restoreLostItem`이며 `disposed`/`returned`가 아니면
     거부한다.
   - **삭제** — 잘못된 등록을 하드 삭제로 정리(감사 기록 없음).

### 불필요한 기능 (not needed / 범위 밖)

- ❌ **대시보드 신규 등록** — 등록은 현장 모바일. "대시보드에서 등록할 일은 거의 없다"(사용자). 콘솔에
  등록 폼을 두지 않는다.
- ❌ **담당자 배정** — 배정 개념 자체가 없다(수리·점검과 동일).
- ❌ **무효(void) 상태** — 두지 않는다(2026-07-15 확정). 잘못된 등록은 **수동 하드 삭제**로만 정리하고,
  **수동 삭제는 감사 기록을 남기지 않는다**(수리·점검의 무효-기록 방식과 다르다).
- ❌ **Excel/PDF 내보내기** — 콘솔에 두지 않는다(수리·점검과 동일, 2026-07-15 확정). 현재
  `/admin/lost-found`의 내보내기 바는 콘솔 재구축 때 제거한다.
- ❌ **비용 추적** — 범위 밖.

> **참고 — 2026-07-16에 뒤집힌 결정:** 직전 판(2026-07-15)은 "자동 상태 이관·자동 하드 삭제 없음(수동
> 폐기)"이었다. 운영 부담(매번 수동 폐기 불가) 때문에 **자동 폐기(14일) + 폐기 내역 90일 + 자동 삭제**로
> 바꿨다. 위 "Storage & Disposal Policy" 참고. 자동 삭제는 이제 **범위 안**이다.

### 구현 요약 (2026-07-16)

`/admin/lost-found`가 목록+필터폼에서 **운영 콘솔**로 교체됐다. 구 `/admin/lost-found/[id]` 상세 라우트는
**제거**(콘솔 우측 상세 패널로 대체)됐고, 구 `lost-found-export-bar.tsx`(내보내기 바)도 **삭제**됐다.

- **화면(4뷰)**: 아래 "뷰 구성" 절 그대로 구현 — ① 현황 보드(접수/보관중/폐기예정 3칼럼) ② 목록·이력
  ③ **완료**(반환+폐기 아카이브 — 반환 방식·송장·종결시각) ④ **폐기 내역**(폐기됨만, 폐기일·삭제
  예정일·D-day·자동/수동 구분·90일 자동삭제 안내 배너). 우측 상세 패널 + 능동 처리 모달(반환/폐기/보관
  연장) + 예외 개입(상태 정정/복원/삭제). 내보내기 없음·무효(void) 없음 — 기획대로.
- **반환 방식 최종 명칭**: 기획 초안의 `shipped`/`picked_up`이 아니라 **`delivery`(배송) /
  `pickup`(방문 수령)**으로 구현됐다. `lost_return_method` enum. 위 "Required Fields"·"반환 방식
  구조화" 절 정정 완료.
- **자동 생애주기**: `public.lostfound_auto_dispose()` / `public.lostfound_auto_purge()`
  (SECURITY DEFINER, 도쿄 기준) + pg_cron 매일 1회(UTC `15:05`/`15:15`). 마이그레이션
  `202607180001_lostfound_console.sql`. **원격 DB 적용 완료(2026-07-16, MCP)** — pg_cron 활성화 + cron
  잡 2개 active 검증.
- **스키마**: `lost_items`에 `category`(not null default `'other'`) · `return_method` ·
  `return_tracking_no` · `hold_until`(date) · `hold_reason`(text) 5개 컬럼 + `lost_item_category`(9종)·
  `lost_return_method`(2종) enum 신규.
- **품목 분류(category) 신설**: 모바일 등록 폼(`src/components/requests/lost-found-create-form.tsx`)에
  분류 선택 드롭다운 추가, `createLostItem`(`src/app/mobile/lost-found/new/actions.ts`)이 저장. 콘솔의
  필터·배지에서도 사용.
- **서버/데이터**: `src/lib/admin-lost-found.ts`(`getAdminLostFound` + `AdminLostItemVM` — 보관 시계·
  삭제 시계 파생 계산 포함), `src/app/admin/lost-found/actions.ts`(`returnLostItem` /
  `disposeLostItem` / `extendLostItemStorage` / `correctLostItemStatus` / `restoreLostItem` /
  `deleteLostItemById` — 전부 `requireAdminSession()` + `canForceCompleteCleaning()` + 조직 스코프 +
  영향 행수 확인).
- **복원(restore) 추가(2026-07-16)**: `restoreLostItem`이 완료(폐기/반환) 건을 보관중으로 되돌린다 —
  `status=stored`, `hold_until`=복원일+14일, 반환·처리 정보 초기화, 처리 메모에 복원 사유 append. 상세
  패널의 예외 개입 존(완료 상태에서만) + `restore` 모달(`lost-found-action-modal.tsx`). 스키마 변경 없음
  (기존 컬럼만 사용). 위 "뷰 구성" 8번 항목 참고.
- **RLS**: 컬럼 추가만이라 `lost_items` UPDATE/DELETE 정책 변경 없음(직전 `202607170001`에서 org-scoped
  정의된 그대로). 자동 함수 2종은 `SECURITY DEFINER`로 RLS를 우회하는 전역 배치 작업(cron엔 org
  컨텍스트가 없어 `status`·도쿄 날짜로만 대상을 좁힌다).
- **화면 컴포넌트(10개)**: `src/components/admin/lost-found/` — `lost-found-console.tsx`(뷰 전환 셸),
  `lost-found-console-shared.tsx`, `lost-found-console-data.ts`(표시 헬퍼), `lost-found-board.tsx`(현황
  보드), `lost-found-list.tsx`(목록·이력), `lost-found-done.tsx`(완료), `lost-found-disposal.tsx`(폐기
  내역), `lost-found-detail-panel.tsx`(우측 상세), `lost-found-action-modal.tsx`(능동 처리·예외 개입
  모달), `lost-found-console.css`.
- **i18n**: `dictionary.lostFound.console` + `lostFound.categoryLabels` + `lostFound.form.category`
  (ko/ja/en).
- **검증**: `npm run lint` · `npm run build` 통과(그린). **마이그레이션 원격 적용 완료(2026-07-16, MCP)** —
  pg_cron(1.6.4) 활성화 + 컬럼·enum·함수·cron 잡 검증 완료. 남은 것은 브라우저 실화면 점검·테스트 데이터.

### 상태 모델 · 자동 생애주기

- 상태 5종은 그대로: `registered` / `stored` / `disposal_scheduled` / `disposed` / `returned`.
  완료 = `returned` · `disposed`.
- **보관 시계(anchor)** = `found_at`(등록 시 자동 기록되는 습득 시각 = **등록일**). 회사 정책 =
  **등록일 + 14일**이 폐기 예정일(2026-07-15 확정: "등록한 날로부터 2주 뒤까지").
- **폐기 예정일** = `hold_until`(연장이 있으면) **그렇지 않으면** `found_at + 14일`.
- **삭제 예정일** = **폐기 시각(`handled_at`, disposed 건) + 90일**. 폐기 내역에서 이 날짜에 자동 하드 삭제.
- **자동 전이 (스케줄 작업, 매일 1회):**
  - 완료 아님 & 미연장 & 폐기 예정일까지 **3일 이내** → `disposal_scheduled`(임박)로 올린다.
  - 완료 아님 & 미연장 & 폐기 예정일 **경과** → **`disposed`**(자동 폐기) + 폐기 내역으로 이동.
    자동 폐기 건은 `handled_by=null`(시스템), `handled_by_admin=false`, 시스템 메모("보관기간 만료 자동
    폐기")를 남긴다.
  - `disposed` & 삭제 예정일 **경과** → **하드 삭제**(레코드 제거).
- 파생 flag (Tokyo 기준, 저장하지 않음):
  - **폐기 임박** = 완료 아님 & 폐기 예정일까지 **3일 이내** → "곧 자동 폐기" 경고.
  - **삭제 임박** = disposed & 삭제 예정일까지 **7일 이내** → 폐기 내역에서 강조.
- 상수 예정: `LOST_FOUND_STORAGE_DAYS = 14`, `LOST_FOUND_DUE_SOON_DAYS = 3`,
  `LOST_FOUND_DISPOSAL_RETENTION_DAYS = 90`, `LOST_FOUND_PURGE_SOON_DAYS = 7`
  (`src/lib/lost-found-constants.ts`, 클라이언트 안전).

### 뷰 구성 (4뷰 — 수리·점검 콘솔 프리미티브 재사용)

수리·점검은 3뷰였지만, 분실물은 완료 결말이 둘(반환 vs 폐기)이고 폐기는 90일 보관 생애주기가 있어
**반환완료**와 **폐기 내역**을 나눈다. 뷰 전환 바·KPI·필터바·상세 패널·모달은 전부 공용 프리미티브.

- **KPI 스트립(5칸)**: 보관중(진행) · **폐기 임박**(D-3, 곧 자동 폐기) · 이번 달 반환 · 이번 달 폐기 ·
  **폐기 내역**(보관 중 건수, 삭제 임박 강조). `loadError` 시 0 대신 "–".
- **① 현황 보드**: 진행 상태 칼럼 — **접수 / 보관중 / 폐기예정(임박)**. 자동 폐기·반환된 건은 보드에서
  빠진다. 카드에 품목 · 위치 · 사진 수 · 신고자 · 보관 경과일 · **폐기 임박 배지**(곧 자동 폐기) ·
  **연장됨 표시**. 정렬은 폐기 임박(급한 것) → 오래된 순. 보드에 성격 배지.
- **② 목록 · 이력**: 기간 + 상태 · 건물 · 신고자 드롭다운 + 검색. 전체(진행·완료 포함) 검색용.
- **③ 반환완료**: `returned` 건. 반환시각 · 처리자 · **반환 방식(배송/직접수령)** · 송장번호 컬럼.
  (모바일 `/mobile/requests/lost-found/returned` 목록의 대시보드 판.)
- **④ 폐기 내역** *(신규, 사용자 요구)*: `disposed` 건. 상단에 "폐기된 분실물은 **90일 보관 후 자동
  삭제**됩니다" 안내. 컬럼: 품목 · 위치 · 손님 · **폐기일** · **삭제 예정일(폐기+90일) D-day** · 폐기
  방식(자동/수동) · 사진. **삭제 임박(D-7)** 배지 강조. 검색 + 기간(폐기일) 필터. 정렬은 삭제 임박 순.
- **우측 상세 패널**: 품목·사진 → 기본 정보 → 손님/예약 연동 → 보관 상태(경과일·폐기 예정일·임박/연장)
  또는 폐기 상태(폐기일·삭제 예정일) → 처리 이력(완료 시) → **능동 처리(반환/폐기/연장)** → **예외
  개입(정정·삭제)**.
- **확인 모달**: 반환 처리 · 폐기 처리(조기 폐기) · 보관 연장 · (예외) 상태 정정 · 삭제. 각 모달은
  메모(선택)를 받는다.

### 능동 처리 — 모달 명세

- **반환 처리**: 방식 라디오(배송 / 직접수령). 배송 선택 시 **송장번호** 입력칸 노출. 처리 메모·증빙
  사진(선택). 저장 → `status=returned`, `return_method`, `return_tracking_no`, `handled_*`,
  `handled_by_admin=true`. 되돌릴 수 없는 완료이라 확인을 한 번 더 받는다.
- **폐기 처리(조기/수동)**: 14일 자동 폐기를 기다리지 않고 사무실이 직접 폐기하거나, 자동 폐기 건에
  사유·사진을 보강한다. 폐기 사유/방법 메모(선택) + 사진(선택). 저장 → `status=disposed`, `handled_*`,
  `handled_by_admin=true` → 폐기 내역으로 이동(삭제 예정일 = 폐기일 + 90일).
- **보관 기간 연장**: 새 폐기 예정일(공용 `AdminDatePicker`) + 연장 사유 메모(선택). 저장 → `hold_until`.
  상태는 그대로(진행). 이후 aging이 `hold_until` 기준으로 재계산되고, 카드·패널에 **연장됨**으로 표시한다.
  **'고가' 같은 별도 플래그는 저장하지 않는다** — 연장 사유(고가·중요 등)는 메모로만 남는다.

### 반환 방식 구조화 — 스키마 추가 (구현 완료, 2026-07-16)

반환 방식은 더 이상 처리 메모 자유텍스트가 아니다. 통계·필터·이력 컬럼을 위해 `lost_items`에 실제로
추가됐다(마이그레이션 `202607180001_lostfound_console.sql`):

```txt
return_method        -- enum lost_return_method(delivery/pickup), nullable. returned 로 갈 때 기록.
return_tracking_no   -- text, nullable. 배송(delivery) 선택 시의 송장번호.
hold_until           -- date, nullable. 보관 기간 연장 시 새 폐기 예정일. 설정돼 있으면 "연장됨".
hold_reason          -- text, nullable. 연장 사유(고가·중요 등은 여기 자유 메모로만 남긴다). 별도 고가
                     --   플래그(is_high_value 등)는 두지 않는다.
```

> `return_method`는 기획 초안(2026-07-15)의 `shipped`/`picked_up`이 아니라 **`delivery`/`pickup`**으로
> 최종 구현됐다(2026-07-16). `src/types/database.ts`·`docs/engineering/04-data-model.md`·
> `docs/engineering/05-rls-permissions.md`도 같은 사이클에 갱신했다.

### 권한

- 능동 처리(반환/폐기/연장) · 예외 개입은 **어드민 콘솔 세션**(`requireAdminSession()`) + 조직 스코프.
  역할 게이트는 수리·점검 예외 개입과 동일 계열(owner/office_admin/개발자 + 허용된 cs_staff/field_manager).
- **반환은 현장에서도 누구나(파트타임 제외)** 그대로 가능하다 — 사무실 능동 처리와 병존한다.
- 모든 쓰기는 RLS + 영향 행 수 확인을 최종 게이트로 둔다(조용한 0행 성공 방지 — 수리·점검에서 고친 것과 동일).

### 알림 (후속)

기존 "Alerts" 절의 후보(폐기 임박(자동 폐기 D-3) · 자동 폐기됨 · **삭제 임박(자동 삭제 D-7)** · 예약
연동)는 **알림 일괄 구현 단계**에서 처리한다. 콘솔 자체가 배지·KPI로 폐기 임박·삭제 임박을 항상 보여주므로,
알림 없이도 감시는 성립한다.

### 확정된 결정 — 전부 구현 완료 (2026-07-16)

- **자동 생애주기(2026-07-16).** 등록일 + 14일 → **자동 폐기** → 폐기 내역 90일 보관 → **자동 하드 삭제**.
  연장(`hold_until`) 건은 자동 폐기 제외. 스케줄 작업(pg_cron/Vercel Cron) 필요. → **폐기 내역 뷰 신설.**
- **무효(void) 상태 없음.** 잘못된·중복 등록은 **수동 하드 삭제**로 정리하고, 수동 삭제는 감사 기록을
  남기지 않는다. 예외 개입은 상태 정정 + 삭제 2종.
- **보관 시계 anchor = 등록일(`found_at`) + 14일.** 삭제 시계 = 폐기일 + 90일.
- **내보내기 없음.** 어떤 뷰에도 Excel/PDF 내보내기를 두지 않는다(수리·점검과 동일). 현재
  `/admin/lost-found`의 `LostFoundExportBar`는 콘솔 재구축 시 **제거**한다.

## Open Questions

대부분 위 "대시보드 분실물 관리 콘솔" 절에서 확정·구현됐다. 정리:

| 질문 | 결론 |
| --- | --- |
| 반환(손님 전달)을 별도 상태로 둘 것인가, 회수 필드로 둘 것인가? | **별도 상태(`returned`).** (2026-07-15 확정) |
| 반환 방식(배송/직접수령)을 나중에 추가할 것인가? | **구조화해서 기록**(`return_method` + 송장번호). (2026-07-15 확정) |
| 14일 만료 시 어떻게 처리하나? | **자동 폐기(`disposed`) → 폐기 내역.** (2026-07-16 확정, 2026-07-15 "수동 폐기" 대체) |
| 폐기 후 며칠 뒤 삭제하나? | **폐기 내역 90일 보관 후 자동 하드 삭제.** (2026-07-16 확정) |
| 고가/연장 물품을 자동 폐기에서 제외하나? | **예. `hold_until` 연장 건은 자동 폐기 제외.** (2026-07-16 확정) |
| 폐기 예정일을 누가 조정하나 / 누가 폐기하나? | 자동(스케줄) + 어드민 콘솔 세션(office/owner/개발자 계열)의 능동 처리. (2026-07-16 확정) |
| 무효(void) 상태를 둘 것인가? | **아니오. 삭제만**(하드 삭제, 감사 기록 없음). (2026-07-15 확정) |
| 보관 시계 기준일은? | **등록일(`found_at`) + 14일.** (2026-07-15 확정) |
| 완료 뷰 내보내기를 유지할 것인가? | **아니오. 내보내기 없음**(수리·점검과 동일). (2026-07-15 확정) |

## 2026-10-26 어드민 처리 액션 가드

- 반환 · 폐기 · 보관 연장 · 상태 정정은 **진행 중 상태(등록/보관중/폐기예정)** 에서만 된다. 읽은 상태로 조건부 업데이트하고(`.eq("status", 읽은 값)`), 0행이면 `invalid`. 종결 건은 「복원」만.
- 반환/폐기의 메모는 기존 처리 메모에 **덧붙인다**(덮어쓰거나 비우지 않음).
- 보관 연장일은 도쿄 오늘보다 뒤여야 한다(과거 날짜면 곧바로 자동 폐기에 걸린다).
- 종결 → 진행 상태 정정 시 `restoreLostItem` 처럼 반환 방식·송장·처리자·처리시각을 비우고 보관 시계(`hold_until`)를 복원일 + 14일로 다시 준다.

## 실시간 갱신 (2026-10-29)

- 요청 목록 · 상세(PC · 모바일) · 모바일 홈 활동 · PC 대시보드가 새로고침 없이 바뀐다 — 누가 올리거나 상태를 바꾸면 열어 둔 화면에 바로 보인다.
  `requestLiveSources()` (`src/lib/live-sources.ts`) → `<LiveRefresh>`. 남이 **지운** 건은 다음 갱신 때 빠진다(삭제 신호 없음).
  공용 규칙: `docs/product/16-mobile-navigation.md` 「실시간 갱신 — 공용」.
