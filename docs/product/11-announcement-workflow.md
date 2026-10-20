# Announcement Workflow

## Purpose

Announcements are used for **official internal notices only**: company notices, operational updates,
building-specific instructions, and important information staff must read.

They are **not** a discussion board, not a feedback thread, and not a free conversation surface.
Questions / discussion / reactions should be handled in other modules, not inside announcements.

## Write Permission

All roles except Part-time Staff can create announcements.

Can create:

- Developer / Super Admin
- Owner
- Office Admin
- CS Staff
- Field Manager
- Staff

Cannot create:

- Part-time Staff

## Read Permission

Users can read announcements that target them.

Announcements can target:

- Everyone
- Specific role
- Specific property/building (deferred — requires property setup)
- Combination of property/building and role (deferred)

Current implementation:

- `everyone` scope: 조직 전체 대상
- `roles` scope: 지정된 역할에게만 노출
- Property/building targeting은 property setup 구현 전까지 보류 상태

## Required Fields

Announcement fields:

```txt
id
organization_id
title
content
image_urls
created_by_user_id
target_scope
target_property_ids
target_roles
is_important
is_pinned
show_popup_on_app_open
popup_until
allow_comments
created_at
updated_at
published_at
archived_at
```

## Mobile UI

### 목록 화면

날짜 타임라인 레이아웃으로 공지를 표시한다 (Wired 2026-06-26).

구성:

- 공지는 Tokyo 시간 기준 `published_at` 날짜로 그룹핑된다.
- 각 날짜 그룹 상단에 날짜 라벨 (`년 월 일` 형식, 로케일 적용)이 표시된다.
- 각 항목은 좌측에 도트+라인 타임라인 마커가 붙는다.
  - 중요 공지: `bg-red-600` 도트
  - 일반 공지: `bg-primary` 도트
  - 같은 날짜 그룹 내 마지막 항목 아래에는 세로 연결선을 표시하지 않음
- 항목 콘텐츠 영역:
  - 상단: 중요 공지는 빨간 AlertIcon + "중요" 칩, 일반 공지는 target label을 작은 캡션으로 표시
  - 제목 (`font-extrabold`, 최대 2줄 clamp)
  - 메타 한 줄: `{target label} · {author_name}`
  - 이미지 첨부 여부는 우측 `ImageIcon` 으로 표시

Current implementation:

- `getVisibleAnnouncements(session)` 서버 함수로 조직 내 표시 가능한 공지 목록을 가져온다.
- DB 정렬은 pinned 먼저, 이후 `published_at` 내림차순으로 반환된다.
- 날짜 그룹핑은 서버 컴포넌트에서 Tokyo timezone 기준으로 수행된다.

### 상세 화면

URL: `/mobile/announcements/[id]`

구성:

1. **중요 칩** — `is_important` 가 true일 때 AlertIcon + "중요" 텍스트의 빨간 pill 칩 표시
2. **제목** — `text-[21px] font-black` 대제목
3. **메타 블록** — `rounded-[13px] border bg-surface` 카드 안에 3행:
   - 게시일 (`published_at`)
   - 대상 (`target_scope` / `target_roles`)
   - 작성자 (`author_name`)
4. **본문** — `whitespace-pre-line` 으로 줄바꿈 보존, `text-[14px] font-medium`
5. **이미지** — `image_urls` 가 있으면 `AnnouncementImageGrid` (variant: `feature`) + "탭하여 확대" 힌트 표시

읽음 확인 UI 블록과 댓글 섹션은 모바일 상세 화면에 더 이상 렌더링되지 않는다 (2026-06-26 제거).
읽음 추적 서버 로직은 그대로 유지된다 (아래 Current implementation 참고).

Current implementation:

- `getVisibleAnnouncementById(session, id)` 로 공지를 조회하며 대상/조직 권한이 확인된다.
- 페이지 진입 시 `ensureAnnouncementRead(announcement, session.user.id)` 가 서버에서 자동으로 읽음 처리한다 (반환값은 UI에 표시하지 않음). 모바일 상세는 이것을 **응답을 보낸 뒤**(`after()`) 쓰고, 공지 조회와 함께 읽어 둔 「이미 읽었나」로 이 화면의 메뉴 배지에서 그 공지를 하나 뺀다 — 열자마자 배지가 줄어드는 동작은 그대로다(2026-10-19 속도).
- 공지가 존재하지 않거나 표시 권한이 없으면 `notFound()` 처리된다.

### 팝업

URL 진입 시 팝업 조건을 충족한 공지가 있으면 `AnnouncementPopup` 컴포넌트가 렌더링된다.

현재 구현 (Wired 2026-06-26 — BottomSheet 전환 완료):

- `AnnouncementPopup` 은 공유 `BottomSheet` 컴포넌트를 사용한다.
- BottomSheet 내부 구성:
  1. 상단: 중요 칩 (AlertIcon + "중요") + 짧은 날짜 (`published_at`, 로케일 적용)
  2. 제목 (`text-[19px] font-black`)
  3. 본문 프리뷰 (최대 6줄 clamp, `whitespace-pre-line`)
  4. 이미지 (`AnnouncementImageGrid`, `imageUrls` 가 있을 때)
  5. 7일 숨기기 체크박스
  6. CTA 2버튼: 확인(ghost, `close` 호출) + 자세히 보기(primary, 상세 페이지로 이동)
- 드래그 내리기 / 스크림 탭으로 닫기 → `dismissCurrentAnnouncement()` 호출
- BottomSheet는 `max-h-[calc(100dvh-2rem)] overflow-y-auto` 로 긴 콘텐츠를 스크롤 처리

팝업 표시 조건:

- `show_popup_on_app_open` = true
- `popup_until` 이 현재 시각보다 미래이거나 null
- 서버 측 dismissal 레코드가 없음 (페이지 로드 전 필터링)
- 클라이언트 localStorage에 hide-until 기록이 없음 (즉시 숨기기 fast path)

### 화이트 리디자인 — 모바일 (2026-10-15)

시안 Notice-Phone · NoticeDetail-Phone · NoticePopup-Phone · Notice-Fold · Notice-Tablet(캔버스 「R · 공지」 줄). 위 목록 · 상세 · 팝업 설명을 이렇게 바꿨다.

- 파일: `announcement-list-mobile.tsx`(목록, 클라이언트) · `announcements-mobile.css`(ntw-*) · `announcement-popup.tsx`(모양만) ·
  `announcement-image-grid.tsx` 의 `variant="plain"`(테두리 · 그림자 없는 2열, 한 장이면 넓게). 문구는 `white` 묶음의 `m*`(ko/ja/en).
- **목록**: 머리 「공지」 + 「안 읽은 공지 n개」(없으면 「모두 읽었어요」). 도트+선 타임라인은 없앴다.
  고정 공지는 맨 위 **「고정」 묶음**(meta 앞에 날짜), 나머지는 도쿄 게시일 묶음(「10월 6일 (월)」). 줄은 「중요」(빨강) → 제목 → 대상 · 작성자, 사진이 있으면 오른쪽 아이콘.
  **안 읽은 공지**는 왼쪽 보라 점 + 굵은 제목(`getReadAnnouncementIds` — 본인 `announcement_reads`). 누르면 점이 바로 줄어 사라진다(태블릿 2분할은
  칸에 열린 줄 표시를 보고 지운다). 빈 목록은 「아직 공지가 없어요」.
- **상세**: 상자 없는 한 장 — 「고정 · 중요」 → 제목 → 「10월 8일 18:20 · 대상 · 작성자」 → 가는 선 → 본문(16px) → 사진 2열 + 「사진을 누르면 크게 볼 수 있어요」.
  메타 상자 · 중요 알약은 없앴다. 읽음 처리는 그대로 상세 진입 시 서버에서.
- **팝업**: 「중요 · 10월 8일」 + 오른쪽 「1 / 2」(띄울 공지가 둘 이상일 때) → 제목 → 본문 6줄 → 사진 → 「7일 동안 다시 보지 않기」(체크 그리기) → 확인 / 자세히 보기.
  공지마다 시트를 새로 띄운다 — 예전에는 첫 팝업을 닫으면 같은 시트가 닫힌 채 남아 **두 번째 팝업이 뜨지 않았다**(고침).
- **넓은 화면**: 폴드는 셸 가운데 칸, 태블릿 가로는 목록 | 상세 2분할(기존 `SplitList`), 고른 줄은 옅은 보라 바탕.
- 모바일에는 공지 쓰기가 없다(시안의 「+ 공지 쓰기」는 이어지는 화면이 없어 뺐다 — 작성은 대시보드).
- **움직임**: 줄 차례 등장 · 안 읽음 점 줄어 사라짐 · 누름 반응 · 체크 그리기 · 사진 누름. 움직임 줄이기 설정이면 끈다.

### HIG 다듬기 2차 — 모바일 공지 (2026-10-20, 시안 A2Notice-* · 지금 A2NoticeNow-* 나란히)

기능 · 배치는 그대로, 크기 · 글자 · 줄만(`announcements-mobile.css`):
- 줄 사이 선: 화면 끝(0)부터 긋던 것 → **글자 시작점 20부터**(안 읽음 점 8 + 간격 12, 공용 구분선 규칙). 칸 모드 고른 줄 위아래 선은 숨김.
- 날짜 묶음 제목 「고정 · 오늘 · 10월 16일」 12/600 회색 + 아래 줄 → **17/600 먹색 · 높이 44, 아래 줄 없음**, 묶음 간격 18 → 10.
- 줄 제목 15 → 16(안 읽음 굵기 700 → 600), 아래 줄 · 「중요」 12 → 13, 사진 표시 16 → 18. 위 「안 읽은 공지 n개」 13 → 15. 빈 화면 17/15.
- 상세 「사진을 누르면…」 12 → 13. 팝업 「7일 동안 다시 보지 않기」 14 → 15 · 「1 / 2」 12 → 13.

## Image Attachments

공지에 이미지를 첨부할 수 있다.

제한:

- 공지당 최대 5장
- 장당 최대 8MB

권장 압축:

- 긴 쪽 최대 1600px 리사이즈
- JPEG/WebP quality 약 70-80%

Current implementation:

- 이미지는 공개 `announcement-images` Supabase Storage 버킷에 저장된다.
- 허용 포맷: JPEG, PNG, WebP, GIF
- 업로드는 브라우저에서 anon key + Storage RLS INSERT 정책을 통해 직접 수행된다 (Server Action body size 제한 우회).
- 클라이언트 측 압축 후 업로드: JPEG/PNG/WebP는 long edge 1600px + quality 0.75. GIF는 애니메이션 보존을 위해 무압축 통과.
- 이미지는 제출 전 개별 제거 가능.
- 업로드 완료 후 클라이언트가 public URL과 announcement UUID를 `createAnnouncement` server action에 전달한다.
- Server action은 URL을 Supabase 프로젝트 hostname / `announcement-images` 버킷 / `{orgId}/{announcementId}/{filename}` 3-segment 경로로 검증한다.
- 검증·권한·DB insert 실패 시 service role client로 업로드된 이미지를 정리한다 (미저장 announcement ID 한정).
- 고아 이미지 정리: platform admin 전용 `purgeOrphanAnnouncementImages` server action. 60분 유예 기간 적용, `/admin/announcements` 하단 버튼으로 실행.

관련 마이그레이션:

```txt
202605100003_announcement_images.sql            -- image_urls 컬럼 + 버킷 생성
202605170001_announcement_images_upload_policy.sql  -- Storage INSERT 정책
202605190001, 202605190002                      -- 경로 검증 강화 (UUID 세그먼트, 안전 파일명)
```

## Mobile Image Viewing

공지 이미지는 스크린샷, 안내문, 표 등 운영상 중요한 콘텐츠를 포함할 수 있다.

필수 모바일 동작:

- 이미지 탭 → 독립된 확대 이미지 뷰어 진입
- 뷰어에서 **두 손가락 핀치 줌** 지원
- 줌인 / 줌아웃 / 팬 이동 가능

권장 인터랙션 구조:

- 중요 공지 팝업 (BottomSheet) 에서 이미지를 탭하면 별도 줌 가능한 뷰어 레이어 진입
- BottomSheet 자체를 줌 표면으로 사용하지 말 것

이유:

- 핀치/드래그 이미지 제스처와 BottomSheet 드래그-닫기 제스처가 충돌함
- 이미지 뷰어는 이미지 콘텐츠 자체 열람에 최적화되어야 함

## Read Tracking

읽음 확인은 서버에서 자동으로 처리된다.

추적 정보:

```txt
announcement_id
user_id
read_at
```

Admin 사용자는 중요 공지를 누가 읽었는지 / 읽지 않았는지 조회할 수 있어야 한다.

Current implementation:

- `announcement_reads` 테이블에 공지별·사용자별 읽음 레코드 1건이 저장된다.
- `(announcement_id, user_id)` unique pair로 최초 읽음 시각을 보존한다.
- 상세 페이지 진입 시 `ensureAnnouncementRead()` server function 이 자동으로 읽음 처리한다 (mobile 및 admin 공통). 모바일은 `after()` 로 응답 뒤에 쓴다(위 참고).
- 모바일 상세 화면에는 읽음 확인 UI 블록을 표시하지 않는다 (2026-06-26 제거). 읽음 처리는 백그라운드 서버 로직으로만 동작한다.
- Admin 공지 상세에서 읽음/미읽음 카운트 및 대상 사용자 목록 (역할·읽음 시각 포함) 조회가 가능하다.
- 팝업 닫기는 읽음 처리가 아님. 읽음 추적은 상세 페이지 진입에만 연결된다.

관련 마이그레이션:

```txt
202605100002_announcement_reads.sql
```

## Important and Pinned Announcements

Important announcement:

- 목록에서 빨간 AlertIcon 칩으로 강조 표시
- 팝업 트리거 가능 (독립 플래그)
- 더 강한 알림 동작 적용 가능

Pinned announcement:

- 공지 목록 최상단 고정

두 플래그는 별도로 관리된다. 중요하지 않은 공지도 고정할 수 있고, 중요 공지도 고정하지 않을 수 있다.

## App Open Popup

공지 작성자가 앱 오픈 시 팝업 표시 여부를 공지별로 설정한다.

팝업 동작:

- 대상 사용자에게만 표시
- 공지별로 독립 설정
- 사용자가 확인/숨기기 처리한 후 반복 표시되지 않음 (7일 후 재표시 여부는 Open Questions 참고)

Current implementation:

- 모바일 공지 목록 페이지와 어드민 공지 목록 페이지 진입 시 팝업 후보를 서버 측에서 pre-filter한다.
  - 서버 측 dismissal 레코드 (`announcement_popup_dismissals`) 를 먼저 제외하므로 어떤 기기에서도 dismissed 팝업이 페이지 로드 시 플래시되지 않는다.
- 사용자는 현재 세션에서만 닫거나, 7일 숨기기 체크박스를 통해 서버에 영구 저장할 수 있다.
- 7일 hide preference는 `announcement_popup_dismissals` (user x announcement 1행) 에 서버 측 저장된다. 모든 브라우저·기기에 적용된다.
- localStorage는 동일 페이지 내 즉시 숨기기 fast path로만 사용된다.
- 팝업 닫기는 읽음 처리가 아님. 읽음 추적은 상세 페이지 진입과 연결된다.
- 팝업 "자세히 보기" CTA: mobile → `/mobile/announcements/[id]`, admin → `/admin/announcements/[id]`
- 팝업은 공유 `BottomSheet` 컴포넌트로 표시된다 (2026-06-26 전환 완료).

## Admin Dashboard Management Console

### Direction (confirmed 2026-07-22)

모바일 공지는 **읽기 소비 표면**이고, 대시보드 공지는 **작성·배포·감사 관리 표면**이다.

어드민 공지 기능은 단순한 폼+리스트 조합이 아니라, 다른 대시보드 운영 모듈과 같은 **공용 콘솔 패턴**으로
재정리한다.

핵심 성격:

- 공식 공지의 생성 / 수정 / 게시 / 보관 관리
- 대상(role) / 중요 / 고정 / 팝업 설정 관리
- 읽음 추적과 미읽음 추적 감사
- 모바일 노출 결과를 기준으로 한 배포 운영

공지 자체는 토론 공간이 아니므로, 대시보드에서도 **커뮤니티형 댓글/대화 흐름은 중심 기능으로 다루지 않는다.**

### Management Rules

어드민 공지 콘솔은 아래 운영 규칙을 기본으로 한다.

- **상태는 3개만 사용한다**: `draft` / `published` / `archived`
- **모바일에서 가능한 공지 기능은 대시보드에서도 모두 가능해야 한다**
- 대시보드에는 모바일 parity 위에 **배포/감사 관리 기능**이 추가된다
- **읽음 추적은 모든 공지에 존재**하지만, 운영상 우선 감시는 **중요 공지의 미읽음** 위주로 본다
- **댓글은 공지의 주기능이 아니다**. 향후 공지 콘솔에서는 제거 방향으로 정리한다

### Permission Split

대시보드 공지는 "작성"과 "운영 관리"를 분리해서 본다.

- **작성 / 초안 저장 / 자기 초안 수정**
  - 모바일 작성 권한이 있는 역할은 대시보드에서도 동일하게 수행 가능해야 한다
  - 즉, Part-time Staff를 제외한 역할은 대시보드에서도 공지 작성이 가능하다
- **게시 / 보관 / 삭제 / 전체 공지 운영 관리**
  - 작성 권한과 별도로 더 강한 운영 권한으로 취급한다
  - 기본 기준: owner / senior_managing_director / office_admin
  - 다른 역할은 우선 자기 작성 공지의 초안 편집까지를 기본으로 보고, 게시/보관/삭제 확대는 별도 결정으로 둔다

이 문서 기준으로는 **작성 가능 = 운영 관리 가능**으로 보지 않는다.

### Console Views

어드민 공지 콘솔은 3개 뷰를 기본으로 둔다.

1. **Published**
   - 현재 노출 중인 공지 운영 뷰
   - pinned 우선, 이후 `published_at` 역순
   - 중요 / 팝업 / 대상 / 읽음 현황을 가장 빨리 확인하는 기본 화면
2. **Drafts**
   - 아직 게시하지 않은 초안
   - 작성자 / 마지막 수정일 / 대상 / 중요 / 팝업 설정 확인
   - 게시 전 검토와 재편집 중심
3. **Archived**
   - 보관된 공지 이력
   - 과거 공지 검색 / 참고 / 필요 시 재게시 판단용

별도 "Popup" 전용 메뉴는 두지 않는다. 팝업은 Published/Drafts 안의 **속성**으로 취급한다.

### Top Summary

상단 KPI/요약 바는 아래 항목을 우선 보여준다.

- 게시 중 공지 수
- 초안 수
- 중요 공지 수
- 팝업 활성 공지 수
- 미읽음 대상자가 남아 있는 중요 공지 수

공지 콘솔은 처리 큐보다는 **배포 상태와 도달 상태**를 빠르게 읽는 것이 더 중요하다.

### List Row Requirements

목록 행/카드는 아래 정보를 한 줄에서 스캔 가능해야 한다.

- 제목
- 상태 (`draft` / `published` / `archived`)
- 중요 / 고정 / 팝업 배지
- 대상 (`everyone` 또는 role 목록)
- 작성자
- 게시일 또는 마지막 수정일
- 이미지 첨부 여부
- 읽음 요약 (`readCount / unreadCount`)

행 클릭 시 우측 상세 패널을 연다. 별도 페이지는 긴 본문 확인이나 브라우저 직접 진입 fallback으로만 둔다.

### Right Detail Panel

우측 상세 패널은 "읽기 + 관리 + 감사"를 한 곳에서 처리한다.

필수 블록:

- 제목 / 상태 / 중요 / 고정 / 팝업
- 조직 / 작성자 / 대상 / 게시일 / 보관일
- 본문 전문
- 첨부 이미지
- 읽음 요약
  - 읽음 수
  - 미읽음 수
  - 각 목록 열기
- 액션
  - 게시
  - 초안으로 유지/복귀
  - 보관
  - 삭제
  - 모바일 상세 보기

읽음 목록은 현재 구현처럼 BottomSheet/모달로 열어도 되지만, 콘솔 전체 패턴과 충돌하지 않게
우측 패널 하위 액션으로 취급한다.

### Composer / Edit Flow

현재의 좌측 고정 생성 카드보다는 **"새 공지" 액션으로 여는 전용 작성 패널 또는 전체 화면 편집 뷰**를 기본으로 한다.

작성/편집에서 관리해야 하는 필드:

- 조직
- 제목
- 본문
- 이미지(최대 5장)
- 대상 범위 (`everyone` / `roles`)
- 대상 role 선택
- 상태 (`draft` / `published`)
- 중요
- 고정
- 앱 오픈 팝업 표시

`popup_until`은 "팝업 종료 시각"으로 명시적으로 다룬다. 체크박스만 있는 모호한 상태로 두지 않는다.

### Read Tracking

모바일에서 읽음이 기록되는 만큼, 대시보드에서는 그 결과를 **관리 지표**로 써야 한다.

대시보드 공지 관리에서 읽음 추적은 다음 기준을 가진다.

- Published 공지에는 읽음/미읽음 요약이 항상 보여야 한다.
- 특히 중요 공지는 미읽음이 남아 있는지 빠르게 보여야 한다.
- 읽음 상세는 대상 사용자 기준으로 열람 가능해야 한다.
- 팝업을 닫은 것과 읽은 것은 분리해서 본다.
- 즉, **모든 공지에 읽음 데이터는 존재**하되, 대시보드의 경고/우선순위는 중요 공지에 집중한다.

### Comments Policy For Dashboard

공지 방향성상 댓글은 어드민에서도 중심 기능이 아니다.

재기획 기준:

- 어드민 공지 콘솔은 **댓글 없는 공식 공지 관리 표면**으로 정리한다.
- 토론/피드백은 게시판(Board) 또는 제안함(Suggestions)으로 보낸다.
- 현재 어드민 상세의 댓글 UI와 `allow_comments`는 **레거시 구현**으로 간주하며, 향후 클린업 대상이다.

즉 "공지 = 공식 전달", "게시판/제안함 = 상호작용" 경계를 대시보드에서도 유지한다.

### Current Implementation Note

`/admin/announcements` 는 위 콘솔 명세대로 **재구현 완료**되었다 (2026-07-23, Claude Design handoff
"Foldy 공지 관리 (admin)" 1:1 포팅).

구현된 구조:

- `src/app/admin/announcements/page.tsx` — 얇은 서버 래퍼. `getAdminAnnouncements(session)` 로
  데이터를 로드하고 `AdminShell` 안에 `<AnnouncementsConsole>` 을 렌더링한다. (좌측 고정 생성 카드 제거)
- `src/lib/admin-announcements.ts` — `getAdminAnnouncements()`: 작성 가능한 조직 전체의 공지를
  작성자/조직 이름 + 도달(대상자 수)·읽음/미읽음·팝업 닫음 수 파생 지표와 함께 로드 (배치 쿼리).
  행별 `canEdit`/`canOperate` 권한도 서버에서 계산한다.
- `src/components/admin/announcements/`
  - `announcements-console.tsx` — KPI 요약 바(게시중/초안/중요/팝업/중요·미읽음) + 3 상태 세그먼트
    (게시중/초안/보관) + 고밀도 목록 표 + 우측 상세 패널·모달 오케스트레이션 + 토스트.
  - `announcement-detail-panel.tsx` — 우측 상세 패널. 정보/본문/첨부/읽음 요약 + **작성 zone ↔
    운영 zone** 권한 분리 UI.
  - `announcement-form-modal.tsx` — 새 공지/편집 모달. 조직·제목·본문·이미지(≤5, 브라우저 직접
    업로드)·대상 범위/역할·상태·중요/고정/팝업(+`popup_until` 종료 시각).
  - `announcement-confirm-modal.tsx` — 게시/재게시/보관/초안 복귀/삭제 확인 모달.
  - `announcement-read-modal.tsx` — 읽음 현황 모달. 열릴 때 서버 액션으로 대상자 명단 로드 (감사용).
  - `announcements-console.css` — announce.css 포팅 (admin-console.css + maintenance-console.css 위에 확장).
- 서버 액션 (`src/app/admin/announcements/actions.ts`, 결과 반환형):
  `saveAnnouncementConsole`(생성/편집) · `setAnnouncementStatusConsole`(게시/보관/초안) ·
  `deleteAnnouncementConsole` · `getAnnouncementReadStatusConsole`(읽음 명단).
  기존 redirect 기반 액션(`createAnnouncement` 등)과 `/admin/announcements/[id]` 상세 페이지는
  긴 본문/직접 진입 fallback 및 레거시 경로로 유지된다.
- i18n: `src/lib/announcement-i18n.ts` 의 `console` 네임스페이스 (ko/ja/en 전체).

권한 매핑 (Permission Split 반영):

- `canEdit`(작성 zone) / `canOperate`(운영 zone) = platform admin, 또는 대상 조직에서
  owner / senior_managing_director / office_admin, 또는 본인이 작성한 공지 (part-time 제외).
  서버 액션(`canManageAnnouncement` / `canCreateInOrganization`)이 최종 강제한다.

콘솔 재구현에 따른 동작 변경 (2026-07-23):

- `/admin/announcements` 에서 **앱 오픈 팝업 미리보기(AnnouncementPopup)** 와 **고아 이미지 정리
  버튼(OrphanCleanupButton)** UI 를 제거했다 (콘솔은 관리 표면이라는 방향에 맞춤). 두 기능의 서버
  로직(`purgeOrphanAnnouncementImages` 등)은 그대로 유지되며, 추후 필요 시 별도 위치에서 재노출한다.
- 목록 행의 읽음 수는 성능을 위해 `announcement_reads` 원시 레코드 수(대상자 수로 상한)를 사용한다.
  정밀 명단(현재 활성 대상자 교차)은 읽음 현황 모달에서 `getAnnouncementReadStatusConsole` 로 조회한다.

### 화이트 리디자인 — PC (2026-10-15)

시안 Notice-PC · NoticeNew-PC · NoticeLeave-PC(캔버스 「R · 공지」 줄). 위 「Current Implementation Note」의 콘솔 구조를 이렇게 바꿨다.

- 파일: `announcements-console.tsx`(목록 + 상세 패널 + 확인 창) · `announcement-composer.tsx`(작성 · 수정 화면) · `announcements-white.css`(anw-*).
  예전 `announcement-detail-panel` · `announcement-form-modal` · `announcement-read-modal` · `announcement-confirm-modal` · `announcements-console.css` 는 지웠다.
  문구는 `announcement-i18n.ts` 의 `white` 묶음(ko/ja/en).
- **위 줄**: 「게시 중 n · 초안 n · 보관 n」 탭(숫자 붙음)과 「+ 새 공지」. 숫자 상자 다섯은 없앴다(탭 숫자와 겹침).
- **한 줄 요약**(게시 중 탭): 「고정 n · 팝업 켜짐 n · 중요 공지 n건에 아직 안 읽은 사람 p명」(빨강). 중요 공지를 모두 읽었으면 「중요 공지는 모두 읽었어요」(초록).
- **목록**: 제목(고정 핀 · 「중요」 빨강 · 「팝업 10/12까지」를 제목 뒤 한 줄로) · 대상 · 작성자 · 게시일(초안 탭은 수정일) · 읽음.
  읽음은 색 막대 대신 글자 — 「6명 안 읽음」(중요면 빨강) / 「✓ 모두 읽음」(초록) + 아래 「18 / 24명」. 초안은 「게시 전」. 정렬은 고정 먼저, 그다음 날짜 최신순.
- **상세 패널**(행 클릭): 머리 「중요 · 고정 · 게시 중 · 팝업 ~까지」, 제목, 「대상 · 작성자 · 날짜 시각」(조직이 여럿이면 조직 이름 앞에), 휴지통(운영 권한) · 닫기.
  본문 → 사진(누르면 크게 보기) → 읽음 「18 / 24명」 + 차오르는 막대 + 「안 읽음 n | 읽음 n」 명단(역할 / 읽은 시각). 명단은 패널을 열 때
  `getAnnouncementReadStatusConsole` 로 읽는다(이제 역할도 함께 돌려준다). 팝업을 닫은 사람이 있으면 「닫은 것은 읽음으로 세지 않아요」 안내.
  아래 버튼: 게시 중 = 보관하기 · 수정 / 초안 = 수정 · 게시하기 / 보관 = 초안으로 · 다시 게시. 권한이 없는 버튼은 그리지 않는다.
- **확인 창**(삭제 · 보관 · 초안으로 · 게시 · 다시 게시): 「그대로 두기 / (동작)」, 첫 초점은 「그대로 두기」. 삭제만 빨강.
- **작성 화면**(새 공지 · 수정): 목록 자리에 펼친다. 왼쪽 「‹ 공지 목록」, 제목 · 본문(노치 라벨 칸), 사진 ≤5(누르면 추가, 썸네일 × 로 빼기),
  오른쪽 「게시 설정」 — 대상(전체 / 역할 선택 + 역할 버튼) · 「받는 사람 n명」 · 중요 · 맨 위 고정 · 앱 열 때 팝업(켜면 「팝업 끝나는 날」 공용 날짜 고르기,
  비우면 끝나는 날 없음 · 시각은 원래 값 또는 23:59 도쿄) · 「초안 저장 / 게시하기」(게시 중인 공지를 고칠 때는 「취소 / 저장」).
  입력 오류는 해당 칸으로 초점을 옮긴다. 바뀐 내용이 있으면 나가기 전에 「작성 중인 내용을 버릴까요?」(그대로 두기 / 버리고 나가기), 창 닫기도 브라우저가 묻는다.
- **움직임**: 줄 차례 등장 · 패널 내용 페이드 · 읽음 막대 차오름 · 명단 탭 전환 페이드 · 사진 썸네일 · 크게 보기 확대 등장 · 스위치 손잡이 · 누름 반응 · 성공/실패 햅틱.
  움직임 줄이기 설정이면 끈다.
- 패널의 「모바일 상세」 링크는 뺐다(01-decision-log 2026-10-15).

## Comments

댓글은 **공지 방향성에 포함되지 않는다**.

이유:

- 공지는 깔끔한 공식 안내 채널로 유지되어야 한다.
- 토론은 게시판 또는 건의 플로우에서 처리되어야 한다.
- 댓글 스레드가 붙으면 공지가 운영 안내 도구가 아닌 커뮤니티 피드처럼 보인다.

Current implementation (레거시 처리 상태):

- 모바일 상세 페이지 (`/mobile/announcements/[id]`) 에서 `AnnouncementCommentsSection` 렌더링을 제거했다 (2026-06-26). `getAnnouncementComments` 호출과 댓글 관련 `searchParams` 처리도 함께 제거. 읽음 추적 (`ensureAnnouncementRead`) 은 유지.
- 어드민 상세 페이지 (`/admin/announcements/[id]`) 에서는 여전히 `AnnouncementCommentsSection` 이 렌더링되며 댓글 제출/수정/삭제가 가능하다.
- DB 스키마 (`announcement_comments` 테이블, `allow_comments` 컬럼) 가 유지되고 있다.
- 댓글 관련 server action (`createAnnouncementComment`, `updateAnnouncementComment`, `deleteAnnouncementComment` — `src/app/announcements/actions.ts`) 과 공유 컴포넌트 `AnnouncementCommentsSection`, lib 함수 `getAnnouncementComments` 는 어드민 사용을 위해 유지된다.
- 모바일 UI에서만 댓글을 제거했고, 어드민 댓글 및 서버 구현 전체는 **향후 클린업 대상** 으로 간주한다.
- 2026-07-22 재기획 기준으로도, 어드민 공지 콘솔은 댓글을 핵심 기능으로 유지하지 않는다.

관련 마이그레이션:

```txt
202605100004_announcement_comments.sql
```

## Notifications

잠재적 알림 트리거:

- 새 중요 공지 게시
- 사용자 대상 새 공지 게시
- 팝업 공지 게시

## Open Questions

- Staff가 전체 대상으로 게시할 수 있는가, 아니면 자신의 property/역할만 가능한가?
- 공지 게시 전 승인 절차가 필요한가?
- 팝업 공지를 필수 확인 공지로 지정할 수 있어야 하는가?
- 읽음 추적을 전체 공지에 적용할 것인가, 중요 공지에만 적용할 것인가?
- 팝업이 첫 읽음 후 영구 사라져야 하는가?
- 중요 팝업이 사용자가 "확인/읽음" 탭할 때까지 반복 표시되어야 하는가?
