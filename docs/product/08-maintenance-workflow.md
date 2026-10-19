# Maintenance Workflow

## Purpose

The maintenance workflow is used to report problems or field issues that regular staff or part-time staff cannot resolve themselves.

This includes broken items, missing items, facility issues, cleaning condition issues, and other operational problems that need follow-up.

## Required Fields

`maintenance_reports` 실제 컬럼 (2026-07-14 백엔드 연동 기준). 스키마 원본은
`docs/engineering/04-data-model.md`, 마이그레이션은 `supabase/migrations/202607160001_maintenance_backend.sql`.

```txt
id
organization_id
reported_by_user_id
room_label                -- 자유 텍스트. property_id / room_id FK는 없다.
is_building_only          -- 객실 없는 건물 단위(공용부) 신고
property_name             -- 건물명 스냅샷
issue_title
description
category                  -- maintenance_category enum (10종)
priority                  -- maintenance_priority enum (low/normal/high/urgent)
status                    -- maintenance_status enum (open/in_progress/closed/cancelled)
image_urls                -- 신고 사진 (≤5)
resolution_image_urls     -- 완료(수리 후) 사진 (≤5, 선택)
resolution_memo           -- 처리 메모 (신고 시 description과 별개)
completed_at              -- closed/cancelled 로 갈 때 기록, 재오픈 시 null
completed_by              -- 완료/무효를 처리한 사람
completed_by_admin        -- 관리자 예외 개입으로 종료됐는지
cleaning_session_id       -- 청소 중 신고 시 연동
reservation_id
guest_name
created_at
updated_at
```

**담당자(assignee) 컬럼은 없다** — 배정 개념 자체가 없다(아래 "성격" 절 참고).

> 이 문서는 오랫동안 위치를 `property_id`/`room_id` FK로, 메모를 `memo`로 적어 두었지만 실제 구현은
> 그런 적이 없다. 위 목록이 실제 스키마다.

## Field Meaning

### Room / Property

Required (building). Room is optional.

The request must be connected to a property (building) and, when applicable, a room/unit.

**Room dropdown collapses sub-units (2026-07-14):** the create form's room dropdown lists
`displayRoomLabel` (not `canonicalRoomLabel`), so Arakicho sub-units — 201 / 201_2 = the same physical
room with two Beds24 accounts — collapse to a single "201" entry, matching the reservation calendar's
room axis. Applies to the maintenance and lost-found **create forms** and the **cleaning-linked forms**
(`maintenance-linked-form.tsx` / `lost-found-linked-form.tsx`), which also collapse the inherited
session room to `displayRoomLabel`. The `cleaning_session_id` FK still links the report to the exact
cleaning session regardless of the room label, so linking is unaffected — only the displayed/stored
room label is normalized.

**Server validation must match (2026-07-14):** because the forms now submit the collapsed
`displayRoomLabel` ("201"), the create actions validate against `displayRoomLabel` too —
`createLostItem` (`item.displayRoomLabel === roomLabel`) and the reservation cross-check in both
`createLostItem` / `createMaintenanceReport` compare `getDisplayRoomLabel(...)` on both sides.
Otherwise, in periods when a room's only active Beds24 account is a "_2" sub-unit (base "201"
inactive), a "201" submission would fail catalog/reservation validation and the report would not save.
The manual **cleaning** start form (`manual-cleaning-form.tsx` / `buildManualRoomOptions`) likewise
collapses its room options to `displayRoomLabel` (keeping the canonical `sessionRoomLabel` as the stored
value for session matching). Cleaning's session↔reservation MATCHING keys stay canonical (unchanged).

**Shared display resolver fixed (2026-07-14):** `resolveRequestLocation` / `resolveRequestCatalogLocation`
(`src/lib/request-location.ts`) previously returned `canonicalRoomLabel` ("201_2") as the display value
on a catalog match. They now return `displayRoomLabel` ("201") and also match on `displayRoomLabel`
(so records stored as the collapsed "201" still recover their building). This fixes the **admin
maintenance/lost-found/orders lists** and the **cleaning + request Excel/PDF exports** (CSV export was
later removed org-wide — see "2026-07-14 어드민 수리/점검 내보내기" below), which route through
this helper, in one place. The `canonicalRoomLabel` field it returns stays canonical (matching consumers
like the linked forms are unaffected). **Attendance** room display (payroll export cleaning column,
work-context) already collapses via `summarizeCleaningRoomLabel`/`getDisplayRoomLabel` — OK. Still
pending: `admin-cleaning.ts` (`room: canonicalRoomLabel`, admin cleaning console — being rebuilt in a
separate track), and **historical records** already stored as "201_2" before these fixes show "201_2"
on their echo-path detail pages (a data-backfill item, not a code bug).

**Cleaning session-label displays collapsed (2026-07-14):** four feeds rendered the raw stored cleaning
**session** label ("아라키초A 201_2", canonical for matching) without collapsing. New shared helper
`getDisplaySessionRoomLabel` (`room-label-normalization.ts`) collapses it ("→ 아라키초A 201") and was
applied at: mobile home "today's activity" cleaning row + in-progress card (`src/app/mobile/page.tsx`
`localizeRoomLabel` now strips the sub-unit), admin dashboard-home in-progress cleaning card
(`src/lib/admin-dashboard.ts`), and the transport-reimbursement statement (`src/lib/transport-reimbursement.ts`).
Session↔reservation MATCHING keys stay canonical. This closes the third audit; no remaining code spot
(dashboard or mobile) shows "201_2" except the rebuild-pending admin cleaning console and pre-fix
historical data.

**Building-only reports (2026-07-14):** the mobile create form (`maintenance-create-form.tsx`) shows a
**"건물 전체"(whole building)** option at the top of the room dropdown — for common-area / building-level
issues with no specific room (also available for buildings that have no room catalog entries). Selecting
it stores the localized `roomBuildingOnly` label (`maintenance.form.roomBuildingOnly`, ko/ja/en) as
`room_label`; `property_name` still carries the building, so `resolveRequestLocation` renders it as
"건물 · 건물 전체". The linked/from-cleaning form keeps its fixed room and has no building-only option.

### Description

Required.

Free text explanation of the issue.

### Photos

Optional but strongly recommended when the issue is visual.

Implementation: photos are stored as `image_urls text[]` on the `maintenance_reports` table, uploaded to the `request-images` Supabase Storage bucket. Client-side compression is applied before upload.

Limit:

- Maximum 5 photos per maintenance report.

Compression:

- Resize long edge to max 1600px.
- Use JPEG/WebP compression around 70-80% quality.

### Priority

Required. Default `normal`.

DB enum `maintenance_priority`:

- low
- normal
- high
- urgent

> 2026-07-14 이전에는 신고 폼에 우선순위 칩 4개가 렌더됐지만 **폼에 실리지도 않았고**(hidden input이
> 없었다) 저장할 컬럼도 없었다. 사용자가 고른 값이 그대로 버려졌다. 이제 실제로 저장된다.

### Reported By

Required.

The app should automatically store the user who reported the issue.

### Status

Required.

Implemented DB enum values (maintenance_status) — **4-state as of 2026-07-14**:

- open (접수)
- in_progress (처리중)
- closed (완료)
- cancelled (무효)

**`resolved`는 2026-07-14에 폐기됐다.** 현장이 "해결"과 "완료"를 구분할 수 없어 두 상태가 실질적으로
같게 쓰였다. 마이그레이션 `202607160001`이 기존 `resolved` 행을 `closed`로 병합한 뒤 enum을 재생성한다
(되돌릴 수 없음). 대신 `cancelled`(무효)가 추가됐다 — 잘못된·중복 신고를 하드 삭제하는 대신 감사 흔적을
남기기 위해서다.

**재오픈 허용**: `closed`/`cancelled`를 다시 `open`/`in_progress`로 되돌릴 수 있다(실제로 안 고쳐진
경우). 재오픈하면 `completed_at` / `completed_by`가 초기화된다.

### Memo

Optional.

**처리 메모(`resolution_memo`)** — 현장이 확인·수리한 내용을 남긴다. 신고 시 작성하는 `description`과
별개이며, 신고 폼이 아니라 **상세 화면의 "현장 처리" 블록**에서 입력한다.

> 2026-07-14 이전에는 신고 폼에 "메모" 입력칸이 있었지만 `name` 속성이 없어 **아무것도 저장되지
> 않았다**. 그 죽은 입력칸은 제거됐다.

### Resolution photos

Optional. 완료(수리 후) 사진을 최대 5장 첨부할 수 있다. **강제가 아니다.**

- 신고 사진(`image_urls`)과 분리해 `resolution_image_urls`에 저장한다.
- 스토리지 경로도 분리: `{orgId}/maintenance-resolutions/{reportId}/{file}`
  (신고 사진은 `{orgId}/maintenance-reports/…`). 같은 `request-images` 버킷.
- 압축·용량·타입 정책은 신고 사진과 동일하다.

## Categories

DB enum `maintenance_category` (10종, 2026-07-14 확정). Default `other`.

> 모바일 폼에는 그전까지 **다른 8종**(electric / water / hvac / appliance / lock / internet /
> amenities / other)이 렌더됐지만, 서버 액션이 `formData`의 category를 읽지 않아 **한 번도 저장된 적이
> 없었다**. 따라서 아래 10종으로 교체하는 데 데이터 마이그레이션이 필요하지 않았다.

Confirmed categories:

- electric
- water
- air_conditioning_heating
- wifi
- furniture
- appliance
- cleaning_condition
- supplies
- damage
- other

Display labels:

```txt
electric: 전기 / 電気 / Electric
water: 수도 / 水道 / Water
air_conditioning_heating: 에어컨/난방 / エアコン・暖房 / AC & Heating
wifi: 와이파이 / Wi-Fi / Wi-Fi
furniture: 가구 / 家具 / Furniture
appliance: 가전 / 家電 / Appliance
cleaning_condition: 청소상태 / 清掃状態 / Cleaning Condition
supplies: 소모품 / 消耗品 / Supplies
damage: 파손 / 破損 / Damage
other: 기타 / その他 / Other
```

## Important Product Note

This module is not only for repair work.

It should also support cases where:

- Something is broken
- Something is missing
- Something looks wrong
- A guest-facing issue needs follow-up
- Part-time staff cannot resolve the issue themselves
- The issue needs manager or office attention

## Creation Entry Points

Maintenance requests can be created from:

- Maintenance tab
- Quick action on mobile home
- Active cleaning timer
- Admin web
- Reservation calendar linked action (`/mobile/maintenance/new?reservationId=...`)

Implementation note (2026-07-09):
- The reservation-calendar linked action is now implemented.
- When entered from `/admin/calendar`, the mobile form pre-fills the building / room / guest
  context from the linked reservation and stores `reservation_id` when the submitted room context
  still matches that reservation server-side.
- Standalone manual creation still works without any reservation context.

## Visibility

All users can create and view maintenance requests.

The Requests tab should include:

- All maintenance requests
- My registered maintenance requests

Default mobile behavior:

- `All` scope should be the default list mode in `/mobile/requests`.
- `My registered maintenance requests` should be available via an explicit scope filter/toggle.

## Status Change Permission

Can change status:

- Developer / Super Admin
- Owner (+ Senior Managing Director, owner-equivalent)
- Office Admin
- CS Staff if permitted
- Field Manager
- Staff
- 신고자 본인 (own record)
- `maintenance_status_change` 권한 예외(override) 보유자

Cannot change status:

- Part-time Staff

**어디서 바꾸는가 (2026-07-14):** 현장이 **모바일 상세 화면의 "현장 처리" 블록**에서 바꾼다
(상태 + 처리 메모 + 완료 사진을 한 번에 저장). 어드민 콘솔의 예외 개입은 아래 별도 절 참고.

> 2026-07-14 이전에는 **모바일에 상태 변경 UI가 아예 없었다.** 상세 화면은 상태를 보여주기만 했고,
> 상태를 바꿀 수 있는 경로는 어드민 상세 페이지 하나뿐이었다 — 이 문서가 못박은 규칙이 구현된 적이
> 없었다. 또한 RLS UPDATE 정책에서 `staff`가 빠져 있었다(문서가 정답이라 정책을 정정했다).

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

- Delete button is accessible directly from the **request list view** (swipe action or icon button per card).
- Delete is also accessible from the request detail page.

### Deletion behavior

- Hard delete — record is permanently removed.
- Show a confirmation modal before executing.
- Confirmation modal must include the record title/name to prevent accidental deletion.
- On success, navigate back to the list and refresh.

### Server-side enforcement

- RLS DELETE policy enforces ownership check for non-admin roles.
- Admin roles bypass ownership check but must still be authenticated org members.
- The server action validates role before executing the DELETE.

When created from an active cleaning timer, the request should automatically link to:

- Cleaning record
- Property
- Room/unit
- Reporter
- Reported time

## Open Questions

대부분 2026-07-14에 확정됐다. 남은 것은 알림 하나뿐이다.

| 질문 | 결론 |
| --- | --- |
| 긴급 건에 푸시 알림을 보낼 것인가? | **미정 (유일한 후속 항목).** 알림은 개발 완료 후 출시 전 단계에서 일괄 구현한다. |
| 완료 사진을 필수로 할 것인가? | **아니오.** 선택적 첨부만 허용 (`resolution_image_urls`, ≤5). |
| 비용을 추적할 것인가? | **아니오.** 범위 밖. |
| 담당자 배정을 지원할 것인가? | **아니오.** 배정 개념 자체를 두지 않는다. |
| 제출 후 본문(제목·설명·카테고리·우선순위·사진)을 수정할 수 있는가? | **아니오.** 편집 경로를 두지 않는다 — 접수된 신고는 사실 기록이다. 잘못 올린 건은 삭제(본인) 또는 무효 처리(어드민)로 정리한다. 상세에서 할 수 있는 쓰기는 "현장 처리"(상태·처리 메모·완료 사진)뿐이다. |

## 화이트 리디자인 (2026-10-13, 시안 Maint-PC · MaintList-PC · MaintDone-PC · Req-Phone · ReqDetail-Phone · Req-Fold · Req-Tablet)

- **PC 현황 보드**(`maintenance-console.tsx` · `maintenance-board.tsx`): 맨 위 보기 탭(현황 보드 · 목록·이력 · 완료, 아이콘 없음) + 「● 실시간 · 방금 갱신」(누르면 새로고침, 점이 은은하게 퍼짐) → 보드에서만 숫자 다섯(접수 · 처리중 · 긴급 · 오래된 미해결 · 완료) → 「읽기 전용 · 처리는 현장(모바일). 정렬: 긴급 → 오래된 순」 한 줄.
  열은 상자 없이 점 · 이름 · 건수, 카드는 옅은 회색 바탕(고르면 옅은 보라) — 머리 한 줄(우선순위 · 분류 · 재실 중, 긴급은 숨쉬는 빨간 점) · 제목 · 호실 · 건물 · 신고자 | 사진 n · 경과(72시간 넘으면 주황 굵게). 누르면 살짝 눌림.
- **PC 상세 패널**(`maintenance-detail-panel.tsx`): 위 한 줄(우선순위 · 상태 · 분류) + 삭제(빨간 휴지통) · 닫기 → 제목 → 호실 · 건물(· 오래 방치) → 재실이면 경고 한 줄(게스트 · 숙박 기간) → 사진 → 설명 → 정보 줄(신고자 · 접수 시각 · 경과 · 완료 · 연동(청소 세션 / 예약) · 처리 메모) → 완료면 완료 사진 → 아래 「관리자 예외 개입」 강제 완료 · 무효 처리. 칩 · 상자 · 아래 「닫기」 버튼 제거.
- **모바일 요청 목록**(`requests-filter-view.tsx` · `/mobile/requests`): 옅은 타일 셋(분실물 등록 · 수리 요청 · 비품 주문) → 글자 탭 **전체** · 수리 요청 · 분실물 · 비품 주문(건수) → [전체 | 내 요청] 토글 · 기간/필터(주문이면 납품 달력) → 날짜 묶음의 **한 줄 행**(종류 아이콘 · 제목(긴급) · 「호실 · 건물 · 신고자 · 시각(어제 전이면 날짜)」 · 상태 색 글자 · 권한 있으면 작은 휴지통).
  **「전체」 탭을 다시 넣었다**(예전 「한 종류씩만」 결정을 사용자 승인으로 바꿈 — 세 종류를 날짜순 한 목록으로, 기본값). 카드 · 사진 · 메모 · 배지 · 위 「열린 n건」 표시는 뺐다. 칸 모드에서 고른 줄은 테두리 대신 옅은 보라 바탕.
- **모바일 수리 상세**(`/mobile/requests/maintenance/[id]` · `maintenance-handling-form.tsx`): 카드 대신 위 한 줄(우선순위 · 상태 · 분류 · 청소에서 등록) → 제목 → 「호실 · 건물 · 신고자 · 7/15 03:02」 → 연결된 예약 · 게스트 → 사진 → 설명 → 정보 줄 → (처리 결과) → **현장 처리**: 4칸 상태 토글 · 테두리 이름표 「처리 메모」 · 완료 사진 · 저장(저장되면 초록 체크 + 성공 진동, 2초 뒤 원래대로). 저장 · 권한 · 업로드 동작은 그대로.
- **수리 신고 폼**(`/mobile/maintenance/new` · `maintenance-create-form.tsx`, 2026-10-14 시안 MaintNew-Phone · MaintNewConfirm-Phone · MaintNew-Fold): 제목 「수리 신고」 + 한 줄 → 이름표 칸 건물 · 객실(맨 위 「건물 전체」, 칸 아래 안내 한 줄) → 문제 제목 → **카테고리는 3칸 타일**(사용자 승인) → 긴급도 4칸(긴급은 빨강) → 설명(선택) → 사진 → 신고자(자동) → [수리 신고 보내기] → 확인 시트(위치 · 카테고리 · 긴급도 · 사진 · [취소][보내기]). 「청소로 돌아가기」는 청소에서 넘어왔을 때만.

### HIG 다듬기 2차 — 모바일 요청 목록 (2026-10-19, 시안 A2Req-* · 지금 A2ReqNow-* 나란히)

기능 · 배치는 그대로, 크기 · 글자 · 줄만(`src/components/requests/requests-list.css`):
- 줄 사이 선: 모든 줄 **아래** · 화면 끝부터 긋던 것 → **줄 사이에만, 글자 시작점 44부터**(공용 구분선 규칙, 마지막 줄 아래 없음). 분실물 반환 · 폐기 내역 줄은 앞 아이콘이 없어 내용 여백부터. 칸 모드 고른 줄 위아래 선은 숨김.
- 날짜 묶음 제목 「오늘 · 어제 · 이전」 13/700 + 아래 줄 → **17/600 · 높이 44, 아래 줄 없음**, 건수 15.
- 줄 제목 15/600 → 16/500, 아래 줄 · 「긴급」 12 → 13. 상태 글자 13/600 그대로.
- 누르는 자리 44: 종류 탭(40 → 44) · 「전체 | 내 요청」(보이는 36) · 납품 달력 · 기간 버튼(36 → 44) · 반환 · 폐기 내역 링크 · 휴지통(보이는 30).
- 글자 15: 위 설명 줄 · 바로 만들기 칸(아이콘 22) · 기간 · 필터 · 「전체 | 내 요청」 · 빈 화면.

## 설계 원칙 — 감시 + 이력 + 예외 개입 (확정, 2026-07-14)

수리·점검은 **관리자가 배정·처리하는 콘솔이 아니다.** 유지보수 인력도 결국 현장이라, 신청이 등록되면
**현장이 모바일에서 보고 직접 가서 처리**한다(확인 · 상태 갱신 · 처리 메모 · 완료 사진 전부 모바일).

- **배정 개념이 없다.** `assignee` 컬럼도, 배정 UI도 만들지 않는다.
- 대시보드의 역할 = **감시(oversight) + 이력(record) + 예외 개입**.
- **예외 개입 = 강제 완료 / 무효 처리 / 삭제** 3종. 청소의 강제완료와 같은 철학이고 같은 역할 게이트를 쓴다.
- 무효(`cancelled`)는 **삭제의 대안**이다. 잘못된·중복 신고를 하드 삭제하는 대신 감사 흔적을 남긴다.
  삭제는 정말 불필요할 때만.

구현 상세(3뷰 구성 · KPI · 파생 값 · 파일 목록)는 아래 "디자인 + 백엔드 연동" 절이 기준이다.

### 범위에서 제외

- ❌ **담당자 배정** (배정 개념 없음)
- ❌ 관리자 능동 처리 콘솔 (처리는 모바일 현장)
- ❌ 완료 사진 **필수화** (선택적 첨부만 허용)
- ❌ 비용 추적
- ❌ **Excel/PDF 내보내기** (2026-07-14 확정 — 아래 "내보내기" 절)
- ❌ 급한 건 알림 발송 · **긴급 상시 배지** — 알림은 개발 완료 후 출시 전 단계에서 일괄 구현한다.
  그 전까지는 전부 테스트 버전이라 긴급 가시성은 알림 단계에서 처리한다. (유일하게 남은 후속 항목)

## 2026-07-14 어드민 수리·점검 대시보드 — 디자인 + 백엔드 연동 (완료)

> **상태:** 화면(디자인) 100% 이식 **+ 실데이터 연동 완료 + 모바일 현장 처리 UI 신설**.
> 청소 콘솔과 같은 순서를 따랐다 — 디자인 포팅 → 실데이터 연결.
>
> 마이그레이션 `202607160001_maintenance_backend.sql`은 **원격 Supabase에 적용 완료**(2026-07-14, 대표
> 직접 실행). 컬럼 22개 · enum 3종 · 인덱스 2개 · RLS/storage 정책 반영을 DB에서 직접 대조 확인했다.
> 적용 시점에 테이블 행이 0개였으므로 `resolved` → `closed` 병합과 건물 전체 backfill은 모두 0건이었다.
>
> ✅ **완료 확정 (2026-07-15).** 라이브 DB에 사진 첨부 테스트 신고 6건(상태 4종·긴급·72h 초과·건물
> 전체·완료사진 포함)을 삽입해, 신고 사진(`maintenance-reports/`)과 완료 사진
> (`maintenance-resolutions/`)의 스토리지 업로드·public 읽기를 실제로 검증했다 — 둘 다 인증 없이
> `HTTP 200 image/png`. 코드로 검증되지 않았던 마지막 경로(완료 사진 storage 정책)가 닫혔다.

`/admin/maintenance`가 기존 목록 카드 화면에서 **운영 콘솔**로 교체됐다. Claude Design 핸드오프
(`Foldy 수리 점검 (admin)/수리 점검 현황 (admin).html`)를 그대로 옮긴 것으로, 위 "설계 원칙" 절의
스펙을 화면으로 구현한 결과다.

### 구성 (3뷰)

- **KPI 스트립(5칸)**: 접수 · 처리중 · 긴급 · 오래된 미해결 · 완료.
- **현황 보드**: 상태 3칼럼 — **접수 / 처리중 / 무효**. 완료(closed)는 누적 데이터라 보드에서 빼고
  별도 "완료" 뷰에서만 본다. 카드에 우선순위·카테고리·사진 수·위치·재실 중·신고자·경과시간.
  정렬은 우선순위 → 오래된 순. 보드에만 `읽기 전용 · 처리는 현장(모바일)` 배지 + 실시간 동기화 칩.
- **목록 · 이력**: 기간(공용 `AdminDateRangePicker`) + 상태·우선순위·카테고리·건물·신고자 드롭다운
  (`AdmDropdown`) + 검색. 완료 건은 제외.
- **완료**: 같은 필터바에서 상태 드롭다운만 빠지고, 완료시각·완료 처리자 컬럼이 추가된다.
- **우측 상세 패널**: 재실 경고 → 신고 사진 → 설명 → 기본 정보 → 처리 메모 → 완료 사진(closed 전용)
  → 연동(청소/예약) → 모바일 처리 안내 → **관리자 예외 개입**(강제 완료 / 무효 처리 / 삭제).
- **확인 모달** 3종: 강제 완료(`btn--pri`) · 무효 처리(`btn--warnsolid`) · 삭제(`btn--danger`).
  세 가지 모두 사유 메모(선택)를 받는다.

### 파생 값 (저장하지 않는다)

- **재실 중** = 연동 예약의 `check_in ≤ 오늘(Tokyo) < check_out`. 조회 시 계산.
- **오래된 미해결** = `open` 상태이면서 접수 후 **72시간** 초과.
  상수는 `MAINTENANCE_AGING_HOURS` (`src/lib/maintenance-constants.ts`).

둘 다 컬럼이 아니다. 저장하면 예약이 바뀌거나 시간이 흐를 때 즉시 낡은 값이 되기 때문에,
`src/lib/admin-maintenance.ts`가 조회할 때마다 계산해서 뷰모델에 실어 보낸다.

### 모바일 — 현장 처리 UI (신설)

이 콘솔은 "처리는 현장(모바일)"을 전제하는데, **그 모바일 UI가 존재한 적이 없었다.** 이번에 만들었다.

- 위치: `/mobile/requests/maintenance/[id]` 상세 화면 하단의 **"현장 처리"** 블록
  (`src/components/requests/maintenance-handling-form.tsx`).
- 한 번의 저장으로 **상태 + 처리 메모 + 완료 사진**을 같이 기록한다.
- 상태 칩 4개(접수 / 처리중 / 완료 / 무효). 무효를 고르면 "삭제가 아니라 기록은 남는다"는 안내가,
  종료 건을 다시 열면 "완료시각이 초기화된다"는 안내가 뜬다.
- `part_time_staff`에게는 폼 대신 읽기 전용 안내만 보인다. 서버 액션과 RLS가 최종 게이트다.
- 서버 액션: `updateMaintenanceHandling`(`src/app/mobile/requests/maintenance/actions.ts`).

### 모바일 — 신청 폼의 "유령 필드" 수정

신청 폼에는 **카테고리 드롭다운·우선순위 칩·메모 입력이 렌더되고 있었지만 전부 저장되지 않았다.**

- **카테고리**: hidden input으로 제출은 됐지만 서버 액션이 읽지 않았다(컬럼도 없었다). → 10종으로
  교체하고 실제 저장.
- **우선순위**: `name` 속성이 없어 폼에 실리지도 않았다. → hidden input 추가, 실제 저장.
- **메모**: `name` 속성이 없었다. → 신고 메모가 아니라 **처리 메모**가 맞는 개념이므로 신청 폼에서
  제거하고 상세의 "현장 처리" 블록으로 옮겼다.
- **건물 전체 신고**: 그동안 신고자의 **언어로 번역된 문자열**("건물 전체" / "建物全体" /
  "Whole building")이 `room_label`에 저장돼, 조회하는 사람의 언어가 다르면 그대로 노출됐다. 이제
  `is_building_only` 불리언으로 정규화하고, 기존 행은 마이그레이션이 backfill한다.

### 내보내기 — 없다 (확정)

**수리·점검에는 Excel/PDF 내보내기가 없다** (2026-07-14, 사용자 결정). 급여·정산처럼 외부로 넘길
산출물이 아니라 현장이 처리하고 콘솔이 감시하는 운영 기록이라 내보낼 일이 없다고 판단했다.
버튼과 서버 액션(`exportMaintenanceWorkbook` / `exportMaintenanceReport`)을 **모두 삭제**했다.

`docs/product/05-admin-web-ia.md`의 "Excel + PDF 내보내기 — 절대 규칙"에 대한 **확정 예외**다.
그 규칙은 *내보내기를 제공하는 화면*이 두 포맷을 함께 내야 한다는 뜻이지, 모든 화면이 내보내기를
가져야 한다는 뜻이 아니다. 다시 필요해지면 공용 빌더(`buildAdminTableWorkbookBase64` /
`buildAdminTableReportHtml`)로 되살린다.

### 같이 고친 버그 (문서에도 없던 것)

- **`property_name` 컬럼에 마이그레이션이 없었다.** `database.ts`와 모바일 create 액션이 이미 쓰고
  있었는데 DDL이 어디에도 없었다(원격 DB에 대시보드로 직접 추가된 것으로 보인다). `supabase db reset`을
  하면 모바일 신청이 깨지는 상태였다. `add column if not exists`로 따라잡았다.
- **상태 변경이 조용히 실패했다.** `updateMaintenanceStatus`는 `requireAdminSession()`만 통과하면
  실행됐는데, RLS UPDATE 정책은 더 좁았다. RLS가 행을 걸러내면 Supabase는 **에러 없이 0행**을 돌려주므로,
  권한 없는 사용자(예: 남의 신고를 건드리는 `staff`)에게도 "변경됨"이라고 응답했다. 모든 쓰기 경로가
  이제 영향 행 수를 확인한다.
- **RLS UPDATE 정책에서 `staff`가 빠져 있었다.** 이 문서의 "Status Change Permission"은 Staff를
  포함하는데 정책은 아니었다. 문서를 정답으로 보고 정책에 추가했다.

### 파일

- `supabase/migrations/202607160001_maintenance_backend.sql` — 스키마 + RLS + storage 정책.
- `src/lib/maintenance-constants.ts` — 상태/우선순위/카테고리 상수 (클라이언트 안전).
  `maintenance-reports.ts`는 서버 전용 Supabase 클라이언트를 끌어오므로 상수를 분리했다.
- `src/lib/maintenance-reports.ts` — 조회 + 신고자/완료처리자 이름 배치 조인.
- `src/lib/admin-maintenance.ts` — **어드민 콘솔 실데이터 레이어**. 청소의 `admin-cleaning.ts` 패턴:
  조직 스코프, `loadError` 플래그(KPI가 0 대신 "–"), 프리젠테이션용 flat 뷰모델, 연동 예약·청소 배치 조회.
  재실 중·오래된 미해결을 **조회 시 파생**한다.
- `src/app/admin/maintenance/actions.ts` — 예외 개입(`applyMaintenanceException`) · 삭제 · 내보내기.
- `src/app/mobile/requests/maintenance/actions.ts` — 현장 처리(`updateMaintenanceHandling`).
- `src/components/admin/maintenance/` — 콘솔 6개 파일. `maintenance-console-data.ts`는 이제 목데이터가
  아니라 **표시 헬퍼**(상태/우선순위/카테고리 메타 맵, 정렬, Tokyo 시각 포맷터)다.
- `src/components/requests/maintenance-handling-form.tsx` — 모바일 현장 처리 블록.
- 공용 CSS 프리미티브(`.cviewbar` · `.lviews` · `.syncchip` · `.ctoolbar` · `.cstat` · `.rptile` ·
  `.hmeta` · `.opscell__v` 상태색 · `.panel .kv`)는 청소 전용 스타일시트에서 `admin-console.css`로
  **승격**했다 — 수리·점검이 두 번째 소비자가 됐기 때문.
- i18n: `dictionary.maintenance.console` + `dictionary.maintenance.handling` (ko/ja/en).

## 2026-07-14 (이전) `/admin/maintenance` 목록 — 폐기된 중간 단계

같은 날 하루 사이에 이 화면은 두 번 바뀌었다. 기록만 남긴다.

1. 구 목록 카드 화면의 네이티브 `<input type="date">`를 공용 `DateRangeFormField`로 바꾸고,
   CSV 링크를 실제 Excel/PDF(`MaintenanceExportBar`)로 교체했다.
2. 그 직후 화면 전체가 **운영 콘솔**로 교체되면서 위 목록 화면 · 필터 폼 · `MaintenanceExportBar`가
   전부 사라졌고, 이어서 사용자 결정으로 **내보내기 자체가 제거**됐다(서버 액션 포함).

따라서 `MaintenanceExportBar` · `exportMaintenanceWorkbook` · `exportMaintenanceReport`는 **현재 코드에
존재하지 않는다.** 되살릴 일이 생기면 공용 빌더(`src/lib/admin-table-workbook.ts` /
`admin-table-report.ts`)와 `<AdminExportButtons>`로 다시 만든다.

여전히 유효한 사실 하나: **구 CSV 경로(`/api/admin/export/*`)는 조직 전체에서 삭제됐다** — 청소 문서(07)·
주문 문서(10)와 동일한 export 통합 작업의 일부다.
