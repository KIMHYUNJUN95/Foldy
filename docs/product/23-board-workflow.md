# 23. 게시판(Board) 워크플로우

> **상태**: Page 1 (Composer) + Page 2 (Feed) + Page 3 (상세) + **Page 4 (글 수정) 구현 완료** | @멘션 기능 DB·백엔드·UI 구현 중 (2026-08-07)
> **최초 작성**: 2026-06-25  
> **업데이트**: 2026-06-25 — 파일 첨부 기능, 다중 최상단 고정(작성자 직접 고정) 추가 | 2026-06-25 — Page 1 구현 완료 (마이그레이션 적용, 글쓰기 페이지 연결) | 2026-06-25 — Page 2 구현 완료 (피드 목록 서버 연결, 태그 필터, 커서 페이지네이션, 안읽음 뱃지) | 2026-06-25 — Page 3 구현 완료 (상세 조회·반응·댓글·고정·삭제·읽음·공유, `board_activity` 알림, board-i18n 통합) | 2026-06-25 — @멘션 기능 기획 확정 및 문서화 (디자인 옵션 E, 바텀시트+검색, 다중 선택, @ALL)  
> **관련 기능**: Announcements(공지), Suggestions(제안함)와 완전히 분리된 별도 기능

---

## 1. 기능 개요

### 목적
전 직원이 자유롭게 글을 올리고 소통하는 공개 게시판. 관리자 전용인 공지사항(Announcements)과 달리 모든 구성원이 동등하게 글쓴이가 될 수 있다.

### 공지사항(Announcements)과의 차이

| | 공지사항 | 게시판 |
|---|---|---|
| 작성 권한 | staff 이상 (part_time 제외) | 전 직원 (part_time 포함) |
| 독자 범위 | 역할/전체 필터링 가능 | 조직 전체 공개 |
| 팝업 | 앱 열 때 팝업 지원 | 없음 |
| 성격 | 하향식 공지 | 수평적 자유 소통 |
| 이모지 반응 | 없음 | 있음 |

### 핵심 기능
- **글 작성**: 제목(선택), 본문(필수), 이미지(최대 5장), 파일 첨부(최대 5개), 자유 태그
- **파일 첨부**: PDF · Excel(.xlsx/.xls) · Word(.docx) · CSV · PowerPoint(.pptx) — 파일당 최대 20MB, 글당 최대 5개
- **이모지 반응**: 👍 ❤️ 😂 😮 😢 — 사용자당 이모지별 1회 (토글)
- **댓글**: 텍스트 + 이미지(최대 3장), 소프트 삭제
- **최상단 고정(Pin)**: 글 작성 시 또는 작성 후 작성자가 직접 고정 가능. 관리자도 고정 가능. 고정 글은 여러 개 동시 허용 — 피드 최상단에 `pinned_at` 내림차순으로 표시
- **읽음 추적**: 읽지 않은 글 배지 표시
- **소프트 삭제**: 글·댓글 모두 `deleted_at` 논리 삭제

---

## 2. 사용자 흐름

### 목록 화면
1. 고정 글(`is_pinned = true`)이 `pinned_at` 내림차순으로 최상단 노출 (고정 글 여러 개 허용)
2. 나머지 글은 `created_at` 내림차순 (최신순)
3. 읽지 않은 글에 배지 표시 (`board_post_reads` 기반)
4. 태그 필터링 (선택 시 해당 태그 글만 표시)

### 글 작성
1. 작성 버튼 탭
2. 제목(선택) · 본문(필수) 입력
3. **최상단 고정 토글**: 작성 화면에 "최상단에 고정" 스위치 — ON 시 제출 즉시 고정 글로 등록
4. 이미지 첨부 (최대 5장, 클라이언트 측 압축)
5. **파일 첨부** (최대 5개 — PDF, Excel, Word, CSV, PPT)
6. 태그 입력 (자유 입력, 엔터/쉼표로 구분)
7. 제출 → 목록으로 복귀

### 글 상세
1. 글 내용 · 이미지 표시
2. 이모지 반응 (탭으로 토글, 반응 수 표시)
3. 댓글 목록 (최신순 or 등록순)
4. 댓글 작성 (텍스트 + 이미지 최대 3장)
5. 읽음 자동 기록

### 수정·삭제
- **수정**: 작성자 본인만 가능 (댓글은 수정 불가, 삭제 후 재작성). 플랫폼 개발자는 남의 글도 수정 · 상단 고정 가능(2026-10-23 — `docs/engineering/05-rls-permissions.md` 「개발자 예외」)
- **삭제**: 작성자 또는 office_admin/owner

---

## 3. 데이터 모델

### 3.1 `board_posts` — 게시글

```sql
CREATE TABLE board_posts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id   UUID NOT NULL REFERENCES auth.users(id),
  title                TEXT,                          -- nullable: 제목 없는 짧은 글 허용
  content              TEXT NOT NULL,
  tags                 TEXT[] NOT NULL DEFAULT '{}',  -- 자유 태그
  image_urls           TEXT[] NOT NULL DEFAULT '{}',  -- 최대 5장
  -- 파일 첨부: [{name, url, size_bytes, mime_type}] 형태의 JSON 배열
  file_attachments     JSONB NOT NULL DEFAULT '[]',   -- 최대 5개, 파일당 20MB
  is_pinned            BOOLEAN NOT NULL DEFAULT false,
  pinned_at            TIMESTAMPTZ,                   -- 고정된 시각 (NULL = 비고정)
  pinned_by_user_id    UUID REFERENCES auth.users(id),-- 고정한 사용자
  allow_comments       BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ                    -- 소프트 삭제
);

-- 고정 글 정렬용 인덱스
CREATE INDEX board_posts_pinned_idx ON board_posts (organization_id, is_pinned, pinned_at DESC)
  WHERE deleted_at IS NULL;
-- 일반 피드 정렬용 인덱스
CREATE INDEX board_posts_feed_idx ON board_posts (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;
```

#### `file_attachments` JSONB 스키마
```jsonc
[
  {
    "name": "월간업무보고.xlsx",       // 원본 파일명
    "url": "https://...supabase.co/storage/...", // 스토리지 퍼블릭 URL
    "size_bytes": 204800,             // 파일 크기 (최대 20 * 1024 * 1024)
    "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
]
```

**허용 MIME 타입:**
| 확장자 | MIME type |
|--------|-----------|
| .pdf | `application/pdf` |
| .xlsx | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| .xls | `application/vnd.ms-excel` |
| .docx | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| .csv | `text/csv` |
| .pptx | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |

### 3.2 `board_post_reads` — 읽음 추적

```sql
CREATE TABLE board_post_reads (
  post_id   UUID NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
```

### 3.3 `board_comments` — 댓글

```sql
CREATE TABLE board_comments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id              UUID NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id   UUID NOT NULL REFERENCES auth.users(id),
  content              TEXT NOT NULL,               -- 평문; @이름 / @ALL 토큰을 그대로 저장
  image_urls           TEXT[] NOT NULL DEFAULT '{}',  -- 최대 3장
  mentioned_user_ids   UUID[] NOT NULL DEFAULT '{}',  -- 멘션된 멤버 UUID 배열 (GIN 인덱스)
  mention_all          BOOLEAN NOT NULL DEFAULT false, -- true이면 @ALL 전체 멘션
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ                    -- 소프트 삭제
);

-- @멘션 조회용 GIN 인덱스 (UUID[] 포함 여부 검색)
CREATE INDEX board_comments_mentions_idx ON board_comments USING gin (mentioned_user_ids)
  WHERE deleted_at IS NULL;
```

> **별도 mention 테이블 미사용 이유**: UUID 배열 컬럼 + GIN 인덱스로 충분, 알림은 시점에 발송하므로 영속 관계 불필요.

### 3.4 `board_reactions` — 이모지 반응

```sql
CREATE TABLE board_reactions (
  post_id    UUID NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,  -- '👍' | '❤️' | '😂' | '😮' | '😢'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, emoji)  -- 같은 이모지 중복 불가
);
```

### 지원 이모지 목록
`👍` `❤️` `😂` `😮` `😢` — 총 5종 (추후 확장 가능)

---

## 4. RLS (Row Level Security) 정책

> 읽기는 RLS 직접 적용, 쓰기는 server actions에서 SERVICE_ROLE로 처리

### `board_posts`
| 조작 | 허용 조건 |
|------|-----------|
| SELECT | 같은 org 활성 멤버 + `deleted_at IS NULL` |
| INSERT | 같은 org 활성 멤버 (전 직원, 작성 시 `is_pinned` 설정 포함) |
| UPDATE | 작성자 본인 (내용·고정 수정) OR office_admin/owner (고정만) |
| DELETE | 작성자 본인 OR org 내 office_admin/owner |

> **고정 권한**: 작성자는 자신의 글만 고정/해제. 관리자(office_admin/owner)는 모든 글 고정/해제 가능.

### `board_comments`
| 조작 | 허용 조건 |
|------|-----------|
| SELECT | 같은 org 활성 멤버 + `deleted_at IS NULL` |
| INSERT | 같은 org 활성 멤버 + 해당 글의 `allow_comments = true` |
| DELETE | 작성자 본인 OR org 내 office_admin/owner |

> 댓글 수정 없음 — 삭제 후 재작성

### `board_reactions`
| 조작 | 허용 조건 |
|------|-----------|
| SELECT | 같은 org 활성 멤버 |
| INSERT | `user_id = auth.uid()` + 같은 org 활성 멤버 |
| DELETE | `user_id = auth.uid()` (본인 반응만 취소) |

### `board_post_reads`
| 조작 | 허용 조건 |
|------|-----------|
| INSERT/UPDATE | `user_id = auth.uid()` (본인 읽음만 기록) |
| SELECT | `user_id = auth.uid()` |

---

## 5. 서버 액션 (Server Actions)

파일 위치: `src/app/mobile/board/actions.ts`

### 글 관련
```typescript
createBoardPost(formData: FormData): Promise<{ id: string } | { error: string }>
// 필드: title?, content, tags[], image_urls[], file_attachments[], is_pinned?
// 검증: content 필수, image_urls 최대 5개, file_attachments 최대 5개
//       파일 크기 파일당 20MB 이하, MIME 타입 허용 목록 내
//       tags 최대 10개
// is_pinned=true 시: pinned_at = now(), pinned_by_user_id = 작성자

updateBoardPost(id: string, formData: FormData): Promise<void | { error: string }>
// 작성자 본인 확인 후 수정 (내용 + 파일 + 이미지 + 태그 + 고정 상태 모두 수정 가능)
// 수정 시 updated_at 갱신

deleteBoardPost(id: string): Promise<void | { error: string }>
// 작성자 본인 OR office_admin/owner 확인
// deleted_at = now() 소프트 삭제
// 첨부 파일 스토리지 삭제는 별도 배치 or 즉시 처리

pinBoardPost(id: string, pin: boolean): Promise<void>
// 작성자 본인 OR office_admin/owner 가능
// pin=true:  is_pinned=true, pinned_at=now(), pinned_by_user_id=현재 사용자
// pin=false: is_pinned=false, pinned_at=NULL, pinned_by_user_id=NULL
```

### 댓글 관련
```typescript
addBoardComment(
  postId: string,
  content: string,
  imageUrls: string[],
  options?: { mentionedUserIds?: string[]; mentionAll?: boolean },
): Promise<{ ok: true } | { error: string }>
// allow_comments 확인 · image_urls 최대 3개 · content 필수
// 멘션 검증(서버):
//   - mentionedUserIds의 각 id가 같은 org 활성 멤버인지 확인 → 통과한 id만 저장
//   - 작성자 본인 id는 자동 제외 (자기 자신 멘션 의미 없음)
//   - mention_all = true 이면 mentionedUserIds는 무시하고 같은 org 활성 멤버 전체로 fan-out
// 알림 발송:
//   - 멘션 우선: mention_all이면 활성 멤버 전원에게 board_activity(event=mention_all) 1건
//   - 그 외 mentionedUserIds → board_activity(event=mentioned) 각 1건
//   - 글 작성자 알림(event=commented)은 작성자가 위 멘션 수신자에 이미 포함된 경우 생략 (중복 방지)
//   - 작성자 본인 행위는 항상 자기 자신에게 알림 안 보냄

searchMentions(query: string): Promise<MentionableMember[]>
// 멘션 자동완성 server action — 같은 org 활성 멤버 중 이름 prefix 일치 (caller 제외, 최대 20명)

deleteBoardComment(commentId: string): Promise<void | { error: string }>
// 작성자 본인 OR office_admin/owner 확인
// deleted_at = now() 소프트 삭제
```

### 반응 관련
```typescript
toggleBoardReaction(postId: string, emoji: string): Promise<void>
// emoji 유효성 검사 (허용 목록 내)
// 이미 있으면 DELETE, 없으면 INSERT
```

### 읽음 처리
```typescript
markBoardPostRead(postId: string): Promise<void>
// UPSERT board_post_reads
// 상세 페이지 진입 시 자동 호출 (서버 컴포넌트에서)
```

> 현재 구현(2026-10-19 속도): 함수 이름은 `ensureBoardPostRead(session, postId)` (`src/lib/board-queries.ts`). 모바일 상세는
> 글과 함께 `hasReadBoardPost()` 로 「이미 읽었나」를 읽고, 기록은 응답 뒤 `after()` 로 쓴다. 메뉴 배지는 기록 전에 셌으므로
> 남의 글 · 안 읽음이었으면 이 화면의 배지에서 하나 뺀다 — 열자마자 배지가 줄어드는 동작은 그대로다. 안 읽은 글 수
> (`getBoardUnreadCount`)는 글 · 숨김 · 읽음(`board_posts!inner` 로 조직 · 삭제 여부를 거름) 세 읽기를 한 번에 한다.

---

## 6. 쿼리 모듈

파일 위치: `src/lib/board.ts`

```typescript
// 목록 조회 (페이지네이션 포함)
getBoardPosts(session, options: { tag?: string; cursor?: string; limit?: number })
  → { posts: BoardPost[]; nextCursor: string | null }

// 단건 조회
getBoardPost(session, postId: string)
  → BoardPost | null

// 댓글 조회
getBoardComments(session, postId: string)
  → BoardComment[]

// 반응 집계 (이모지별 카운트 + 내가 반응했는지)
getBoardReactions(session, postId: string)
  → { emoji: string; count: number; myReaction: boolean }[]

// 읽지 않은 글 수 (배지용)
getUnreadBoardPostCount(session)
  → number
```

---

## 7. 스토리지

### 이미지 (`request-images` 버킷 — 기존)
```
{organization_id}/board-posts/{post_id}/{filename}
{organization_id}/board-comments/{comment_id}/{filename}
```
- 이미지 압축: 기존 `compressImageFile()` 유틸 재사용 (`src/components/announcements/announcement-image-uploader.tsx`)
- Storage RLS에 `board-posts`, `board-comments` 경로 패턴 추가 필요

### 파일 첨부 (`board-attachments` 버킷 — 신규)
```
{organization_id}/{post_id}/{original_filename}
```
- **별도 버킷 신규 생성**: 이미지와 구분하여 관리 (MIME 타입·사이즈 정책 상이)
- 버킷 설정: `public = false` (인증된 조직 멤버만 접근)
- 파일당 최대 크기: 20MB (`file_size_limit: 20971520`)
- 허용 MIME 타입: `application/pdf`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-*`, `text/csv`
- Storage RLS: 같은 org 활성 멤버 SELECT, 글 작성자 INSERT/DELETE
- 파일 URL: **signed URL로 확정 (2026-06-25)** — `board-attachments`는 private 유지, 다운로드 시
  서버 액션 `getBoardAttachmentDownloadUrl`이 120초 서명 URL을 `download`(원본 파일명) 옵션과 함께 발급.
  저장되는 `FileAttachment.url`은 full URL이 아니라 스토리지 **경로**.

---

## 8. 네비게이션 통합

### 사이드 메뉴 등록 (`src/config/navigation.ts`)
```typescript
{
  id: "board",
  href: "/mobile/board",
  icon: Newspaper,                  // lucide-react
  labelKey: "board",
  roles: ALL_ROLES,                 // 전 직원 접근 가능
}
```

### 하단 탭 커스터마이징
기존 `defaultBottomNavTabIds` 에 추가하지 않음 — 사용자가 커스터마이징으로 직접 추가 가능.

### 읽지 않은 글 배지
상단 탭 아이콘 옆에 미읽음 카운트 표시 (기존 `announcements` 배지 패턴과 동일).

---

## 9. @멘션 기능

> **추가**: 2026-06-25

### 개요

댓글 입력 중 `@`를 입력하면 멘션 피커가 열린다. 동료 한 명 이상을 멘션하거나, `@ALL`로 조직 전체를 멘션할 수 있다. 멘션된 멤버는 bell 알림을 받는다.

### 디자인: 옵션 E (바텀시트 + 검색)

- canonical `BottomSheet` 컴포넌트 사용 (`src/components/shell/bottom-sheet.tsx`)
- scrim(`fixed inset-0 z-[80]`)이 상단 헤더까지 어둡게 덮음
- 상단에 검색 input (이름 prefix 매칭, 디바운스 200ms)
- `@ALL` 옵션: 항상 최상단 고정행 ("전체 / 全員 / Everyone" — 로케일별 라벨)
- 다중 선택 가능 (체크 표시)
- 하단 "완료 (N)" 확정 버튼 (N = 현재 선택 인원 수)
- drag-to-dismiss + scrim-tap + Esc 로 닫기 (상단 X 버튼 없음 — BottomSheet 기본 계약)

### 진입

댓글 composer 입력칸에 `@` 문자를 입력하면 멘션 피커 바텀시트가 자동으로 열린다.

### 검색 동작

| 조건 | 결과 |
|------|------|
| 빈 쿼리 | 가나다순 상위 20명 (추후 최근 활동 기반으로 전환 검토) |
| 쿼리 입력 | 이름 prefix 매칭, 최대 20명 반환 |
| 제외 조건 | 본인, 비활성 멤버, 탈퇴 멤버 |

검색 디바운스: 200ms.

### 선택 및 확정

1. 멤버 행 탭 → 체크 토글 (다중 선택 가능)
2. `@ALL` 행 탭 → 전체 멘션 선택 (`mention_all = true`)
3. "완료 (N)" 버튼 탭 → 시트 닫힘
4. 본문에 토큰 삽입: 개별 선택 시 `@이름 `, @ALL 선택 시 `@전체 ` (locale별 표시 — 저장은 `@ALL` 고정 마커)

### 저장 형식

| 컬럼 | 저장값 |
|------|--------|
| `content` | 평문 (`@이름`, `@ALL` 토큰을 그대로 포함) |
| `mentioned_user_ids` | `UUID[]` — 선택된 멤버 UUID 배열 |
| `mention_all` | `BOOLEAN` — @ALL 선택 여부 |

> **렌더링**: 본문 내 `@ALL` 마커는 표시 시 로케일별 라벨(ko: `전체`, ja: `全員`, en: `Everyone`)으로 변환.

### 알림 정책

| 조건 | 발송 알림 |
|------|-----------|
| `mention_all = true` | `board_mention_all` 1종만 발송 (조직 전체 활성 멤버) |
| `mention_all = false` | `board_comment_mentioned` (선택된 UUID별 개별 발송) |
| `mention_all = true` 인 경우 | 개별 `board_comment_mentioned`는 생략 (중복 방지) |
| 공통 | 작성자 본인은 수신 제외 |

### 권한 및 보안

- 멘션 가능 대상: 같은 org 활성 멤버만 (본인 제외, 비활성/탈퇴 제외)
- 서버 액션에서 `mentioned_user_ids`의 각 UUID가 같은 org 활성 멤버인지 검증 (RLS만으로 차단 불가 — 서버 액션 레벨 보안)
- 알림은 서버 액션 내에서 댓글 저장 직후 발송

---

## 10. 알림 연동

### notification_type — `board_activity` (단일 enum, payload.event로 분기)
| event | 발생 시점 | 수신자 | i18n 키 |
|-------|-----------|--------|---------|
| `commented` | 내 글에 새 댓글 | 글 작성자 (작성자가 멘션 대상에 이미 포함되면 생략) | `boardCommentTitle/Body` |
| `mentioned` | 댓글에서 개별 `@사용자` 멘션 | 멘션된 사용자 (서버 검증된 같은 org 활성 멤버만) | `boardMentionTitle/Body` |
| `mention_all` | 댓글에서 `@ALL` 멘션 | 같은 org 활성 멤버 전원 (작성자 본인 제외) | `boardMentionAllTitle/Body` |

- `mention_all` 발생 시 같은 댓글의 개별 `mentioned` 알림은 **발송하지 않음** (수신자별 중복 방지).
- 댓글 작성자 본인은 모든 분기에서 수신자에서 제외.
- 멘션 알림 본문(`{actor}`)에는 댓글 작성자 표시명이 들어가므로, `payload.actorName`을 함께 저장.

### 알림 생성 위치
`addBoardComment()` server action 내에서 호출:
- `notifyBoardCommentMentions()` — 멘션(`mentioned`/`mention_all`) 우선 처리
- `notifyBoardPostAuthor()` — 작성자가 멘션 수신자에 포함되지 않은 경우에만 `commented` 발송

`searchMentions()` server action은 자동완성 전용 (실제 알림 발송과 무관).

---

## 11. i18n 키 구조

> **실제 구현**: `src/lib/i18n.ts` `board` 섹션 (FALLBACK_DICTIONARY + ko/ja 오버라이드). 아래는 기획 초안이며, 실제 키 목록과 상이할 수 있다. @멘션 UI 키(§ 9)는 `board` 섹션에 추가되어 있음.

파일: `src/lib/i18n.ts` → `board` 섹션 추가

```typescript
board: {
  // 네비게이션
  navLabel: { ko: "게시판", ja: "掲示板", en: "Board" },

  // 목록
  listTitle: { ko: "게시판", ja: "掲示板", en: "Board" },
  newPost: { ko: "글쓰기", ja: "投稿する", en: "New Post" },
  pinned: { ko: "고정", ja: "固定", en: "Pinned" },
  noPost: { ko: "아직 게시글이 없어요", ja: "まだ投稿がありません", en: "No posts yet" },
  filterByTag: { ko: "태그 필터", ja: "タグで絞り込む", en: "Filter by tag" },

  // 작성
  composeTitle: { ko: "글쓰기", ja: "投稿作成", en: "Write Post" },
  fieldTitle: { ko: "제목", ja: "タイトル", en: "Title" },
  fieldTitlePlaceholder: { ko: "제목 (선택)", ja: "タイトル（任意）", en: "Title (optional)" },
  fieldContent: { ko: "내용", ja: "内容", en: "Content" },
  fieldContentPlaceholder: { ko: "내용을 입력하세요", ja: "内容を入力してください", en: "What's on your mind?" },
  fieldTags: { ko: "태그", ja: "タグ", en: "Tags" },
  fieldTagsPlaceholder: { ko: "태그 입력 후 Enter", ja: "タグを入力してEnter", en: "Add tag and press Enter" },
  fieldImages: { ko: "사진", ja: "写真", en: "Photos" },
  submit: { ko: "게시", ja: "投稿", en: "Post" },
  submitEdit: { ko: "수정 완료", ja: "更新する", en: "Save Changes" },

  // 상세
  commentCount: { ko: "댓글", ja: "コメント", en: "Comments" },
  commentPlaceholder: { ko: "댓글을 입력하세요", ja: "コメントを入力", en: "Write a comment..." },
  commentSubmit: { ko: "등록", ja: "送信", en: "Send" },
  deleteComment: { ko: "댓글 삭제", ja: "コメントを削除", en: "Delete comment" },
  noComments: { ko: "아직 댓글이 없어요", ja: "まだコメントがありません", en: "No comments yet" },
  commentsDisabled: { ko: "댓글이 비활성화된 글입니다", ja: "コメントは無効です", en: "Comments are disabled" },

  // 수정/삭제
  editPost: { ko: "글 수정", ja: "投稿を編集", en: "Edit Post" },
  deletePost: { ko: "글 삭제", ja: "投稿を削除", en: "Delete Post" },
  deletePostConfirm: { ko: "이 글을 삭제할까요?", ja: "この投稿を削除しますか？", en: "Delete this post?" },
  deleteCommentConfirm: { ko: "이 댓글을 삭제할까요?", ja: "このコメントを削除しますか？", en: "Delete this comment?" },
  pinPost: { ko: "글 고정", ja: "投稿を固定", en: "Pin Post" },
  unpinPost: { ko: "고정 해제", ja: "固定を解除", en: "Unpin Post" },

  // 반응
  reactions: { ko: "반응", ja: "リアクション", en: "Reactions" },
  addReaction: { ko: "반응 추가", ja: "リアクションを追加", en: "Add reaction" },

  // 파일 첨부
  fieldFiles: { ko: "파일", ja: "ファイル", en: "Files" },
  fileAttach: { ko: "파일 첨부", ja: "ファイルを添付", en: "Attach File" },
  fileCount: { ko: "파일 {n}개", ja: "ファイル{n}件", en: "{n} file(s)" },
  fileDownload: { ko: "다운로드", ja: "ダウンロード", en: "Download" },
  fileRemove: { ko: "파일 삭제", ja: "ファイルを削除", en: "Remove file" },

  // 고정
  pinToggleLabel: { ko: "최상단에 고정", ja: "最上位に固定", en: "Pin to top" },
  pinnedBadge: { ko: "고정됨", ja: "固定中", en: "Pinned" },
  pinPost: { ko: "글 고정", ja: "投稿を固定", en: "Pin Post" },
  unpinPost: { ko: "고정 해제", ja: "固定を解除", en: "Unpin Post" },

  // 오류
  errorContentRequired: { ko: "내용을 입력해주세요", ja: "内容を入力してください", en: "Content is required" },
  errorImageLimit: { ko: "이미지는 최대 5장입니다", ja: "画像は最大5枚です", en: "Max 5 images allowed" },
  errorCommentImageLimit: { ko: "댓글 이미지는 최대 3장입니다", ja: "コメント画像は最大3枚です", en: "Max 3 images per comment" },
  errorFileLimit: { ko: "파일은 최대 5개입니다", ja: "ファイルは最大5件です", en: "Max 5 files allowed" },
  errorFileSizeLimit: { ko: "파일 크기는 20MB 이하여야 합니다", ja: "ファイルサイズは20MB以下にしてください", en: "File size must be 20MB or less" },
  errorFileType: { ko: "지원하지 않는 파일 형식입니다", ja: "対応していないファイル形式です", en: "Unsupported file type" },

  // @멘션 피커 (바텀시트 + 검색, 2026-06-25 추가)
  mentionSearchPlaceholder: { ko: "이름 검색", ja: "名前を検索", en: "Search by name" },
  mentionAll: { ko: "전체", ja: "全員", en: "Everyone" },
  mentionAllSubtitle: { ko: "조직 모든 멤버에게 알림", ja: "組織の全員に通知", en: "Notify everyone in the organization" },
  mentionDone: { ko: "완료 ({n})", ja: "完了 ({n})", en: "Done ({n})" },   // {n} = 선택 인원 수
  mentionEmpty: { ko: "검색 결과가 없어요", ja: "検索結果がありません", en: "No results" },
  mentionSelectedCount: { ko: "{n}명 선택됨", ja: "{n}名選択中", en: "{n} selected" },
  errorMentionInvalidMember: { ko: "유효하지 않은 멤버가 포함되어 있어요", ja: "無効なメンバーが含まれています", en: "Invalid member in selection" },
}
```

---

## 11. 라우트 구조

> 아래는 **실제 구현 기준** 라우트 구조다(초기 기획안의 `new/`는 `compose/`로 구현됨).

```
/mobile/board/
├── page.tsx                — 목록 (고정 글 상단 + 커서 페이지네이션 피드)
├── actions.ts              — loadMoreBoardPosts (더 보기)
├── compose/
│   ├── page.tsx            — 글 작성
│   └── actions.ts          — createBoardPost
└── [id]/
    ├── page.tsx            — 글 상세 (반응 · 댓글)
    ├── actions.ts          — 읽음·댓글·반응·고정·삭제·수정 서버 액션
    └── edit/
        └── page.tsx        — 글 수정 (Page 4 자리표시; updateBoardPost 액션은 구현됨)
```

---

## 12. 구현 순서 (Phase 3)

UI 디자인 핸드오프 후 아래 순서로 진행:

1. **DB 마이그레이션** — `supabase/migrations/YYYYMMDDXXXX_board.sql`
2. **DB 타입 업데이트** — `src/types/database.ts` 동기화
3. **쿼리 모듈** — `src/lib/board.ts`
4. **서버 액션** — `src/app/mobile/board/actions.ts`
5. **스토리지 설정** — `board-posts`, `board-comments` 경로 추가; `board-attachments` 버킷 생성 및 RLS 정책 적용
6. **페이지 & 컴포넌트** — UI 디자인 기반으로 구현
7. **네비게이션 등록** — `src/config/navigation.ts`
8. **알림 연동** — `src/lib/notifications/create.ts`
9. **i18n 등록** — `src/lib/i18n.ts`
10. **lint + build 검증**

---

## 12-A. As-built — Page 2 (피드 목록, 2026-06-25)

`/mobile/board` 피드 목록을 백엔드에 연결 완료.

- **서버 쿼리 모듈**: `src/lib/board-queries.ts` (서버 전용 — **`src/lib/board.ts`와 분리**). `board.ts`는
  브라우저 Supabase 클라이언트를 쓰고 클라이언트 컴포넌트(composer)가 import하므로, 서버 쿼리를 같은
  파일에 넣으면 `next/headers`가 클라이언트 번들로 끌려와 빌드가 깨진다. `suggestions.ts` ↔
  `suggestions-queries.ts` 분리 패턴을 따름.
  - `getBoardFeed({ session, category?, limit, before? })` → `{ posts: BoardPost[]; nextCursor }`.
    고정 글(`pinned_at` DESC, 첫 페이지에서만 전체) 먼저, 그 다음 일반 글(`created_at` DESC).
    `deleted_at IS NOT NULL` 제외. 각 글에 작성자명·역할(로케일라이즈)·댓글 수·반응 배열·안읽음 여부
    하이드레이션.
  - `getBoardTags(session)` → 조직 내 비삭제 글의 태그 distinct (빈도순, 최대 12개) — 필터 칩 목록.
  - `getBoardUnreadCount(session)` → 본인이 작성하지 않았고 읽음 레코드가 없는 글 수 (실패 시 0).
- **페이지네이션 방식**: **커서 기반** (offset 아님). 커서 = 마지막으로 로드된 일반 글의 `created_at`.
  고정 글은 첫 페이지에서만 반환(중복 방지). "더 보기" 버튼 → 서버 액션 `loadMoreBoardPosts`
  (`src/app/mobile/board/actions.ts`)가 다음 일반 글 페이지를 반환(페이지 크기 15). 무한스크롤 대신
  명시적 "더 보기" 버튼(공지/제안함이 페이지네이션을 안 해 기존 패턴이 없어, 명시 버튼 채택).
- **카테고리 필터**: 스키마에 `category` 컬럼이 없고 `tags text[]`만 존재. `category` 파라미터는
  `tags @> [값]`로 필터링하며, 행의 카테고리 뱃지는 첫 번째 태그를 사용. 필터 전환은
  `router.replace('/mobile/board?category=...')`로 서버 리페치(공지/제안함의 router 패턴과 일치),
  필터 변경 시 `key`로 클라이언트 컴포넌트 remount → 누적 페이지/커서 리셋.
- **안읽음**: `board_post_reads`에 읽음 레코드 없고 본인 글이 아니면 안읽음(점 표시). 하단 탭/사이드
  메뉴 뱃지(`board`)는 `getBoardUnreadCount`를 `getMobileNavBadges`에 연결.
- **상대 시간**: `Intl.RelativeTimeFormat` (로케일별, 하드코딩 없음). SSR 불일치 방지를 위해
  `useSyncExternalStore`로 하이드레이션 후에만 렌더.
- **빈 상태**: 글 0건이면 빈 상태; 필터 적용 시 0건이면 필터 전용 문구(`emptyFilteredTitle/Subtitle`).
- 라우트는 현행 구조(`/mobile/board`, `/mobile/board/compose`, `/mobile/board/[id]`)를 따름 — 위
  §11의 `new/`·`[id]/edit/` 표기는 초기 기획안이며 실제 구현과 다름(글쓰기는 `compose/`).

---

## 12-B. As-built — Page 3 (상세, 2026-06-25)

`/mobile/board/[id]` 상세 페이지를 백엔드에 연결 완료.

- **첨부 파일 다운로드 (2026-06-25 추가, 모바일·PC)**: `board-attachments`는 **private 버킷**이고
  `FileAttachment.url`은 스토리지 **경로**다. 상세에서 첨부 카드(`BoardFileCard`)를 탭하면 서버 액션
  `getBoardAttachmentDownloadUrl(postId, path)`가 (1) 같은 org·비삭제 글의 첨부 목록에 그 path가 실제로
  있는지 검증한 뒤 (2) 서비스롤로 **120초 서명 URL**을 `{ download: 원본파일명 }` 옵션으로 발급한다.
  이 옵션이 `Content-Disposition: attachment`를 달아줘서 모바일·데스크톱 모두 **미리보기가 아니라
  다운로드**된다. 클라이언트는 임시 `<a>`를 만들어 클릭 → 다운로드(설치형 PWA 이탈 없음). i18n
  `downloadFile`/`downloadFailed`(ko·ja·en) 추가. **첨부 URL 정책은 signed URL로 확정**(아래 §13 미결
  해소).
- **경로 검사 (2026-10-26)**: 작성 · 수정 · 댓글 액션이 클라이언트가 보낸 사진 URL · 첨부 경로를 그대로 저장하고 있어서, 다른 조직
  폴더의 파일 경로를 첨부로 끼워 넣으면 위 다운로드 액션이 서비스 키로 서명해 줄 수 있었다. 이제 업로드 함수(`src/lib/board.ts`)가
  만드는 모양만 받는다(`src/app/mobile/board/board-storage-guard.ts`): 첨부 = `{orgId}/{postId}/{uuid}.{ext}`, 사진 = 우리 스토리지 공개 URL
  `…/request-images/{orgId}/{board-posts|board-comments}/{postId}/{uuid}.{ext}`, 「..」 · 하위 폴더 금지. 첨부 객체는 알려진 필드
  (`name`·`url`·`sizeBytes`·`mimeType`)만 남겨 다시 만든다. 수정 때는 **이미 그 글에 있던** URL · 경로는 그대로 허용한다. 다운로드 액션은
  서명 **직전에** 경로를 한 번 더 본다(검사 전 저장된 행 대비). 글 id 도 UUID 여야 한다. 거절 사유(`invalid_image` · `invalid_attachment` ·
  `invalid_id`)는 화면에서 「저장 실패」 문구로 보인다. 회귀 테스트: `src/lib/__tests__/board-storage-guard.test.ts`.
- **댓글 · 고정 결과 처리 (2026-10-26)**: 댓글 보내기가 실패해도 입력이 비워지던 것을 고쳤다 — 컴포저의 `onSubmit` 은
  `Promise<boolean>` 을 돌려주고, 저장됐을 때만 글 · 사진을 비운다. 댓글 지우기는 공용 줄 접힘(`.row-collapse` + `data-leaving`)으로 바로
  접히고 실패하면 다시 펴지며 토스트 + `error` 햅틱. 고정 토글은 `useOptimistic` 으로 바로 바뀌고 실패하면 되돌아가며 알린다. **누가
  고정할 수 있는지는 바꾸지 않았다**(작성자 · `board.manage` — 사용자 결정 대기).
- **사진 뷰어 (2026-06-25 추가)**: 게시글 사진과 댓글 사진을 탭하면 공유 `ImageLightbox`
  (`src/components/shell/image-lightbox.tsx` — 풀스크린·스와이프·원본 표시·`<body>` 포털)가 열린다.
  `target="_blank"`는 쓰지 않는다(설치형 PWA 이탈 방지 — decision-log 2026-06-22 이미지 계약).
  게시글 그리드는 신규 `src/components/board/board-image-grid.tsx`(홀수 장수면 첫 사진을 풀폭 히어로,
  나머지는 정사각 2열; `next/image` 최적화 — `request-images` 버킷은 `next.config` 화이트리스트). 댓글
  사진은 `board-comment.tsx`에서 동일 라이트박스로 연결. i18n `viewPhoto`(ko·ja·en) 추가, 닫기 라벨은
  `copy.close` 사용.

- **서버 쿼리**: `getBoardPost({ session, id })` (`src/lib/board-queries.ts`) → `BoardPostDetail`. 전체 글
  필드 + 작성자(이름·로케일 역할) + 댓글(비삭제, 등록순) + 반응 5종 집계(이모지별 count·본인 isMine) +
  가장 많이 쓰인 이모지의 반응자 얼굴 최대 3명 + 반응 총원/첫 반응자 이름 + `allowComments`. 글이
  없거나 소프트삭제·타 조직이면 `null` → 페이지에서 `notFound()`. `getBoardPost`/`ensureBoardPostRead`는
  서버 전용 `board-queries.ts`에 둠(브라우저 클라이언트를 쓰는 `board.ts`와 분리 — Page 2와 동일 이유).
- **읽음 처리**: `ensureBoardPostRead`(서비스롤 upsert, revalidate 없음)를 상세 페이지 렌더 중 호출 —
  `ensureAnnouncementRead`와 동일 패턴. 하단/사이드 안읽음 뱃지는 다음 요청에서 자동 감소.
- **서버 액션** (`src/app/mobile/board/[id]/actions.ts`, 모두 게시글 row로 org-scope·권한 확인 후
  서비스롤 쓰기, `revalidatePath` 상세+피드):
  - `markBoardPostRead` (멱등 upsert), `addBoardComment`(본문 필수·사진 ≤3·작성자 알림),
    `deleteBoardComment`(소프트삭제 — 본인 또는 owner/office_admin), `toggleBoardReaction`(있으면 삭제/
    없으면 추가, 허용 이모지 👍❤️😂😮😢 외 서버 거부), `pinBoardPost`/`unpinBoardPost`(작성자 또는
    owner/office_admin), `updateBoardPost`(작성자 전용, 고정 플래그 갱신), `deleteBoardPost`(소프트삭제 —
    본인 또는 owner/office_admin).
- **댓글 본문 필수 결정**: `board_comments.content`에 `char_length(trim(content)) > 0` CHECK가 있어
  **이미지 전용(빈 본문) 댓글은 DB가 거부**. 새 마이그레이션 없이 정합성을 지키기 위해 댓글은 본문
  텍스트를 필수로 하고 사진은 보조 첨부(최대 3장)로 처리. 향후 이미지 전용 댓글이 필요하면 Page 4에서
  CHECK 완화 마이그레이션으로 결정.
- **반응 UI**: 5종 이모지 항상 표시(0 포함), 토글은 낙관적 업데이트 후 `router.refresh()`로 서버 정합.
  반응자 얼굴(상위 이모지 최대 3명) + 요약(`reactionSummaryOne`/`Many`).
- **더보기 액션 시트**: 글 수정/고정·해제/공유/삭제. 공유는 `navigator.share()` → 실패 시 클립보드 복사
  + 토스트. 삭제는 중앙정렬 확인 모달(CLAUDE.md의 BottomSheet 예외) → `deleteBoardPost` →
  `/mobile/board`로 이동. 권한에 따라 행 노출(작성자=수정/삭제, owner·office_admin=고정/삭제).
- **알림**: 새 `board_activity` 알림 타입(마이그레이션 `202606250002_board_notification_type.sql`,
  **적용 완료**). 댓글 작성 시 글 작성자에게 1건(작성자=본인이면 생략). `notifyBoardPostAuthor`
  (`src/lib/notifications/create.ts`) + 타입/가드(`types.ts`) + 표시 분기·`board_activity` 라벨
  (`display.ts`) + i18n(`boardKind`/`boardCommentTitle`/`boardCommentBody` ko·ja·en).
- **i18n 통합**: 임시 `src/lib/board-i18n.ts`를 **삭제**하고 모든 board 문자열을 `src/lib/i18n.ts`
  `FALLBACK_DICTIONARY`(en) + ko·ja 오버라이드의 `board` 섹션으로 이동. 함수형(`filterResultSuffix`,
  `commentCountSuffix`)은 `{count}` 플레이스홀더 문자열로 변환(서버→클라이언트 직렬화 가능). 컴포넌트는
  `copy: Dictionary["board"]`를 prop으로 받음.
- **클라이언트 검증(라이브 DB)**: 고정 우선 정렬, 댓글 등록순, 반응 집계(👍=2/❤️=1, 총 3명), 안읽음
  계산(작성자 본인 글 제외 → staff 0건 / owner 2건) 모두 SQL로 확인 후 시드 데이터 정리. RLS SELECT
  (`has_active_membership`) + `getBoardPost`의 명시적 org 일치 검사로 교차 조직 격리.

### 글 수정(edit) 페이지 — Page 4로 분리 결정 → **2026-08-07 구현 완료**
서버 액션 `updateBoardPost`는 이번에 구현(작성자 전용)했으나, **편집 폼 UI는 Page 4로 미룸**. 액션 시트의
"글 수정"이 404가 나지 않도록 `/mobile/board/[id]/edit`에 자리표시 페이지를 두어 안내 문구(`editTodo`)와
뒤로가기만 노출. Page 4에서 compose 폼을 재사용해 실제 편집 화면 구현 예정.

#### Page 4 구현 (2026-08-07)

자리표시를 실제 폼(`board-edit-client.tsx`)으로 교체했다. **액션 시트의 「글 수정」은 작성자에게
평범한 메뉴로 보이는데 눌러도 아무것도 못 고쳤다** — 사용자 입장에서는 고장난 버튼이었다.
(기능이 아예 없는 것과 「버튼은 있는데 안 되는 것」은 다르다.)

- **작성 폼과 화면 구조를 맞췄다.** 같은 글을 다루는 두 화면이 다르게 생기면 다른 기능으로 읽힌다.
  헤더 문구만 `editTitle`/`submitEdit` 로 갈린다 — 「새 글 발행」이라 쓰면 기존 글을 고치는 중에
  맞지 않는다.
- **기존/신규가 섞인 목록을 다룬다.** 이미 올라간 사진은 URL, 새로 고른 사진은 아직 업로드 전
  `File` 이다. 저장할 때 **신규만 업로드**해 «남긴 기존 + 새로 올린 것»을 순서 그대로 최종 목록으로
  보낸다. 목록에서 뺀 항목은 저장과 함께 사라진다.
- **`updateBoardPost` 에 사진·첨부를 추가했다.** 그 전에는 제목·본문·태그·고정만 저장돼서, 폼에서
  사진을 지워도 반영되지 않았을 것이다. 개수 상한은 **서버에서 다시** 건다(폼을 신뢰하지 않는다).
- **고정 권한 구멍을 막았다.** `createBoardPost` 는 owner/전무/office_admin 에게만 고정을 허용하는데
  `updateBoardPost` 에는 그 검사가 없어, **일반 직원이 자기 글을 수정하며 상단 고정을 할 수 있었다.**
  같은 상태를 바꾸는 두 경로가 다른 권한을 갖고 있으면 안 된다. 폼에서도 권한이 없으면 토글 자체를
  렌더하지 않는다(비활성 토글은 「고장」으로 읽힌다).
- **남의 글/없는 글은 상세(또는 목록)로 되돌린다.** 「권한 없음」 화면을 따로 띄우면 남의 글이
  존재한다는 사실만 알려 주는 셈이다.
- **상한 상수(`BOARD_MAX_IMAGES`/`BOARD_MAX_FILES`)를 `lib/board.ts` 로 모았다.** `5` 리터럴이 이미
  네 군데에 흩어져 있었다.
- **스토리지 정리는 하지 않는다.** 사진을 지워도 버킷의 원본은 남는다 — 글 삭제도 같은 방식이라
  여기서만 다르게 하면 규약이 갈린다. 정리는 별도 작업이다.
- 검증: 라우트 생성 확인, 비로그인 접근이 `next` 파라미터를 보존한 채 로그인으로 리다이렉트되는 것
  확인, tsc/lint/build/test 통과. **로그인 상태의 실제 수정·저장은 미확인**(실사용 계정 필요).

---

## 12-C. 신고 · 차단 (2026-10-06, 앱 출시 준비 B4)

App Store(1.2) · Google Play(UGC 정책)는 사용자 작성 콘텐츠가 있는 앱에 **부적절한 콘텐츠 신고**와 **사용자 차단**을 요구한다
(`docs/planning/17-app-release-plan.md` B4). 사용자 결정(2026-10-06): 처리자 = owner · office_admin(권한 키 `board.moderate` — 개인 부여 · 차단 가능), 신고자에게만 즉시 숨김,
차단은 게시판에만 적용.

### 신고
- **진입**: 남의 글 → 상세 「⋯」 → 「신고하기」. 남의 댓글 → 댓글 줄 「⋯」 → 「신고하기」. 내 글 · 댓글에는 나오지 않는다(서버도 `forbidden`).
- **시트**(`BoardReportSheet`, 공용 `BottomSheet`): 사유 하나 필수 — 스팸 · 광고 / 괴롭힘 · 혐오 표현 / 부적절한 내용 / 개인정보 노출 / 기타,
  메모 선택(500자).
- **즉시 효과**: 신고한 사람에게는 그 글 · 댓글이 피드 · 상세 · 안읽음 수 · 댓글 수에서 사라진다(글 신고면 목록으로 돌아간다).
  다른 사람에게는 관리자가 처리하기 전까지 그대로 보인다(자동 숨김 없음).
- 같은 사람이 같은 대상을 다시 신고하면 「이미 신고한 내용이에요」(유니크 인덱스).

### 신고 취소 (2026-10-06 추가)
- 계정 → 보안 「신고한 글 · 댓글」 — 대기 중이거나 「문제없음」으로 닫힌 내 신고 목록(대상이 남아 있는 것만) → 「신고 취소」.
- 취소하면 행을 지우지 않고 `status = withdrawn` 으로 남긴다(기록 보존). 나에게 다시 보이고, 대기 중이었다면 처리 목록에서도 빠진다.
- 취소한 대상을 다시 신고하면 같은 행을 `pending` 으로 다시 연다(유니크 인덱스 때문에 새 행을 만들지 않는다).

### 처리 (권한 키 `board.moderate`)
- 피드 머리에 「🚩 신고 N건」 칩(대기 중인 **대상** 수 — 같은 글의 여러 신고는 1건) → `/mobile/board/reports`.
- 카드: 글/댓글 · 작성자 · 신고 수 · 미리보기 · 사유 칩 · 메모(최대 2) · 최근 신고 시각(도쿄). 「글 보기」 / 「문제없음」 / 「삭제」(확인 모달).
  - **삭제** = 대상 소프트 삭제(작성자 · 관리자 삭제와 같은 `deleted_at`) + 그 대상의 대기 신고 전부 `removed`.
  - **문제없음** = 대상은 두고 대기 신고 전부 `dismissed`. 신고한 사람에게는 계속 숨겨진다.
  - 대상이 이미 지워졌으면 목록을 열 때 그 신고를 `removed` 로 정리한다.
- 화면: `wide` — 폰 1열 · 폴드 2열 · 태블릿 3열 카드.
- **관리 콘솔** `/admin/board-reports`(2026-10-06): 같은 데이터 · 같은 서버 액션을 표 + 우측 상세 패널로. 사이드바 「정보」 묶음, `board.moderate` 보유자만 보인다.
- 알림(관리자에게 「새 신고」)은 붙이지 않았다 — 「알림은 막바지에 일괄 구현」 방침. 그때 함께 붙인다.

#### 화이트 리디자인 — PC (2026-10-15, 시안 「R · 게시판 신고 · PC」)
- **위 줄**: 굵게 「처리할 신고 **N**」(N 은 빨강 `#c5282e`, 0 이면 검정) + 회색 안내 「같은 글에 들어온 신고는 한 줄로 묶어요」.
  처리 대기 / 처리 완료 탭은 없다 — 처리한 신고 기록 목록은 만들지 않았다. 페이지 제목은 메뉴 이름 「게시판 신고」.
- **표**(상자 · 세로선 없음, 가로선 `#f3f3f6` 만): 대상(글/댓글) · 내용(굵은 제목 + 아래 회색 사유 요약 「스팸 · 광고 2 · 부적절한 내용 1」) ·
  작성자 · 신고(수, 굵게) · 최근 신고(도쿄 `M/D HH:mm`). 선택한 줄은 옅은 보라 바탕(`#f4f1fd`, 둥근 12) — 왼쪽 막대 없음.
- **상세 패널**(오른쪽 420px 슬라이드, `useAdminPanelA11y` — Esc · 바깥 누르면 닫힘):
  머리 「신고 N건 · 글/댓글」 + 메타 「작성자 · M/D HH:mm 작성 · 반응 N · 댓글 N」(반응 · 댓글 수는 글일 때만, 못 읽으면 뺀다) +
  빨간 휴지통(→ 삭제 확인 창) + 닫기. 「원문」: 글 제목 · 본문 전체(줄바꿈 그대로) · 사진 2열(누르면 크게 보기, Esc 로 닫힘) · 태그.
  댓글이면 제목 대신 「「글 제목」에 달린 댓글」. 구분선 아래 「신고 사유」(사유 → 수, 많은 순) · 「신고 메모」(따옴표 + 신고 시각).
  맨 아래 넓은 회색 버튼 「문제없음으로 닫기」 + 작은 안내 「삭제는 위 휴지통. 문제없음으로 닫아도 신고한 사람에게는 계속 숨겨져요.」
  예전 「게시판에서 보기」 링크는 시안에 없어 뺐다(원문이 패널에 다 나온다).
- **삭제 확인 창**: 「이 글을 삭제할까요?」(댓글이면 「이 댓글을…」) + 설명 · 「그대로 두기」(회색, 첫 초점) / 「삭제」(빨강). Esc 로 닫힘.
- **빈 상태**: 가운데 조용히 「처리할 신고가 없어요」 + 「새 신고가 들어오면 여기에 보여요.」
- **움직임**: 줄 차례 등장 · 패널 내용 페이드 · 누름 반응(scale .97) · 사진 확대 · 처리 후 토스트 + 햅틱(성공/실패). 움직임 줄이기면 끈다.
- **데이터**: `listPendingBoardReports()` 가 패널용 필드를 **덧붙여** 돌려준다(모바일은 기존 필드만 씀) — `postTitle` · `body`(4,000자) ·
  `imageUrls` · `tags` · `targetCreatedAt` · `reasonCounts`(사유별 수) · `noteItems`(메모 + 시각) · `reactionCount`(반응한 사람 수) · `commentCount`(남은 댓글 수).
  서버 액션 · 권한(`board.moderate`)은 그대로.
- 파일: `src/components/admin/board-reports/board-reports-console.tsx` · `board-reports-white.css`(접두 `brw-`, 예전 `board-reports-console.css` 삭제).
  문구: `dictionary.boardReportsWhite.*`(ko/ja/en), 사유 이름은 `dictionary.board.reason*` 재사용.

### 차단
- **진입**: 남의 글 「⋯」 · 남의 댓글 「⋯」 → 「이 사용자 차단」 → 확인 모달(가운데 정렬 — 삭제 확인과 같은 의도된 예외).
- **효과**: 차단한 사람의 게시판(피드 · 상세 · 댓글 · 안읽음 수)에서 상대의 글 · 댓글이 보이지 않는다. 상대에게 알리지 않는다.
  게시판 밖(공지 · 할 일 등 업무 화면)에는 적용하지 않는다 — 업무 기록을 가리면 운영이 깨진다.
- **해제**: 계정 → 보안 「차단한 사용자」 → 「차단 해제」.

### 구현
- 표: `board_reports` · `user_blocks`(마이그레이션 `202610060001_board_reports_user_blocks.sql`, service-role 전용) — `docs/engineering/04-data-model.md`.
- 조회: `src/lib/board-moderation.ts` — `getBoardHiddenFor()`(피드 · 상세 · 안읽음이 이걸로 거름), `countPendingBoardReports()`,
  `listPendingBoardReports()`, `listMyBlockedUsers()`.
- 서버 액션: `src/actions/board-moderation.ts` — `reportBoardContent` · `blockBoardUser` · `unblockBoardUser` · `resolveBoardReport` · `withdrawBoardReport`.
  조직 · 대상 존재 · 작성자 · 처리 권한을 모두 서버에서 검사한다.
- 문구: `dictionary.board.*`(report* · reason* · block* · reports*), `dictionary.accountProfile.blockedUsers*` · `unblock` — ko/ja/en.

## 12-D. 화이트 리디자인 — 모바일 (2026-10-15)

시안: 「R · 게시판」 Board-Phone · Board-Fold · Board-Tablet · BoardPost-Phone · BoardReport-Phone · BoardNew-Phone · BoardReports-Phone.
공통 규칙: 흰 바탕 · 카드/상자 없음 · 가로 줄만(세로선 없음) · 선택은 옅은 보라 바탕(`#f4f1fd`, 왼쪽 막대 없음) · 보라 `#7a52e6`(글자 `#5a30cf`) ·
빨강 `#c5282e`. 스타일은 `src/components/board/board-white.css` 한 곳(접두 `bdw-`).

### 피드 `/mobile/board`
- **머리**: 「게시판」(24px) + 관리자(`board.moderate`)에게만 아래 빨간 글자 링크 「처리할 신고 N건 ›」(대기 0이면 없음) + 오른쪽 보라 글자 「+ 글쓰기」(44px 높이).
  예전 글 수 배지 · 보라 알약 버튼 · 빨간 칩은 없앴다.
- **태그**: 글자 탭(「전체 #엑셀 #코인 …」) — 고른 것만 굵은 먹색, 칩 · 상자 없음. 「OO 태그 · N개 결과」 줄은 뺐다(탭이 이미 말해 준다).
- **글 줄**(카드 없음, 줄 사이 `#f1f1f4` 가는 선): 이니셜 동그라미(`#f1ecfd`/`#5a30cf`) · 이름 · 회색 「역할 · 상대 시각」 · 안 읽음이면 오른쪽 보라 점 →
  고정이면 보라 「고정」 → 제목 16px(안 읽음 700 · 읽음 600) → 본문 두 줄 → 사진이 있으면 같은 크기 정사각 3칸(둥근 10), 4장 이상이면 셋째 칸에 어두운 「+n」 →
  아래 줄: 반응 칩(34px · 둥근 17 · 내 반응 옅은 보라) + 「+」 칩, 오른쪽 회색 「#태그 · 파일 n · 댓글 n」(파일은 있을 때만).
  제목 없는 글은 본문을 제목 자리에 세 줄까지.
- **피드에서 반응**: 된다. 피드 데이터(`getBoardFeed` → `hydratePosts`)에 이미 반응 배열(수 + 내 반응)이 있어 **서버 · 쿼리 변경 없음**.
  누르면 낙관적으로 바로 바뀌고 `toggleBoardReaction` 을 부른다 — 액션이 `/mobile/board` 를 재검증하므로 새 props 가 기준이 된다.
  「+」 를 누르면 아직 없는 반응이 그 줄에서 펼쳐진다. 실패하면 되돌리고 오류 햅틱.
- 줄 위쪽(작성자 ~ 사진)과 오른쪽 회색 요약은 상세 링크, 반응 칩은 링크 밖 버튼(링크 안에 버튼을 넣지 않는다).
- **넓은 화면**: 폴드 = 셸 가운데 칸 그대로. 태블릿 가로 = `SplitList` 피드 | 상세 칸. 고른 줄은 `.split-list .bdw-row:has(> a[data-split-active])` 로
  줄 전체를 옅은 보라 바탕 · 둥근 14로(전역 남색 테두리는 끈다).
- 「더 보기」는 넓은 회색 버튼. 빈 상태는 가운데 조용한 두 줄.

### 상세 `/mobile/board/[id]`
- 작성자 줄(40px 이니셜 · 이름 · 「역할 · 시각」 · 오른쪽 「⋯」 — 기존 동작 시트: 수정 · 고정 · 공유 · 삭제 · 신고 · 차단) → 제목 21px → 본문 15px/1.7 →
  사진(장수가 홀수면 첫 장을 넓게 16:9, 나머지 2열 정사각, 누르면 라이트박스) → 회색 「#태그」 → 첨부 파일 줄(회색 `#f7f7f9` 둥근 줄 · 흰 종류 표시 · 이름 · 「크기 · 누르면 내려받아요」 · 내려받기 아이콘, 서명 URL 다운로드 그대로) →
  반응 칩 + 「+」 + 오른쪽 「누구 외 N명이 반응했어요」 → 가는 선 → 「댓글 N」 목록(회색 이니셜 · 「이름 시각」 · 본문 · 남의 댓글 「⋯」 / 내 댓글 · 관리자 빨간 「삭제」).
- **댓글 입력**: 회색 알약 「댓글을 남겨 주세요 · @로 멘션」 + 회색 카메라 동그라미 + 보라 보내기 동그라미(46px). 셸 스크롤 안에서 `sticky` 로 화면 바닥에 붙는다
  (예전 100dvh 자체 스크롤러를 그만둠 — `16-mobile-navigation.md` 참고). **멘션은 입력칸에 「@」 를 치면 멘션 시트가 열린다**(친 「@」 는 지운다) — 따로 있던 @ 버튼은 시안대로 뺐다.
  고른 사람은 입력칸 위 보라 알약(누르면 다시 고름 · ✕ 로 비움).
- 동작 시트는 상자 없는 아이콘 줄 + 회색 「취소」, 삭제 · 차단 확인은 가운데 흰 창(회색 취소 + 빨간 확인, `BoardConfirm`).
- 태블릿 칸 안에서는 읽기 좋은 폭(680px)으로 묶는다.

### 신고 시트 (`BottomSheet`)
- 「이 글을 신고할까요?」(댓글이면 「이 댓글을…」) + 회색 「신고하면 나에게는 바로 보이지 않아요. 관리자가 확인해요.」 → 사유 다섯 줄(50px, 고르면 굵게 + 보라 링 라디오) →
  이름표 칸 「메모 (선택)」(예시 「예) 외부 판매 링크가 있어요」) → 보라 「신고하기」(사유를 골라야 켜짐). 예전 빨간 버튼 → 보라.

### 글쓰기 `/mobile/board/compose` · 수정 `/mobile/board/[id]/edit`
- **셸 안에서 그린다**(상단 바 · 화면 스와이프 뒤로가기 · 폴드 레일, 아래 탭 숨김). 예전의 자체 헤더(✕ · 제목 · 「게시」 버튼)는 없앴다.
- 「글쓰기」(수정은 「글 수정」) + 오른쪽 회색 「전 직원에게 보여요」 → 이름표 칸 「제목 (선택)」 · 「본문」 → 「사진 · 파일」: 76px 사진 칸 · 더하기 칸 · 「사진 n / 5」,
  파일 줄(✕ 로 빼기), 보라 글자 버튼 「파일 첨부 · PDF · Excel · Word 최대 5개」 → 「태그」: 고른 태그(옅은 보라 · ✕) + **조직에서 쓰던 태그**(회색, 누르면 고름 — `getBoardTags`) + 「+ 새 태그」(누르면 그 자리 입력칸) →
  「맨 위 고정」 스위치 줄(**고정 권한이 있는 사람에게만** — owner · 전무 · office_admin, `createBoardPost` 와 같은 판단. 예전 글쓰기는 모두에게 보였다) → 큰 보라 「올리기」(수정은 「수정 완료」).
- 글자 수 「n / 1000」 표시는 뺐다(서버 제한이 아니었다).
- 폴드 · 태블릿은 560px 가운데 폼. 수정 화면은 태블릿에서 2분할 칸 안에 열린다(기존 `SPLIT_DETAIL_PATTERNS.board`).

### 신고 처리 `/mobile/board/reports` (관리자)
- 「신고 처리」 + 회색 「같은 글에 들어온 신고는 한 줄로 묶어요」 → 묶음마다(카드 없음, 가는 선): 「신고 N건(빨강) · 글/댓글 · 작성자」 + 오른쪽 도쿄 시각 →
  제목(글이면 글 제목, 없으면 본문 · 댓글이면 댓글 내용) → 「스팸 · 광고 2 · 부적절한 내용 1」(사유별 수, PC 와 같은 `reasonCounts`) → 메모 인용 →
  회색 「글 보기」 · 옅은 보라 「문제없음」 · 빨간 바탕 휴지통(→ 가운데 확인 창 → 삭제). 폰 1 · 폴드 2 · 태블릿 3열(`wide`) 그대로.

### HIG 다듬기 2차 — 모바일 게시판 (2026-10-20, 시안 A2Board-* · 지금 A2BoardNow-* 나란히)
기능 · 배치는 그대로, 크기 · 글자만(`board-white.css` 끝 블록):
- 줄 사이 선은 그대로 — 아바타 · 제목 · 본문이 모두 왼쪽 끝(0)에서 시작해 끝까지 긋는 지금 선이 공용 구분선 규칙에 맞다.
- 태그 탭 높이 36 → 44 · 글자 14 → 15. 작성자 이름 14 → 15 · 「역할 · 시각」 12 → 13 · 「고정」 12 → 13.
- 제목 16 → **17**(제목 없는 글도) · 본문 14 → 15 · 오른쪽 요약 12 → 13.
- 반응 칩: 보이는 34 그대로, **누르는 자리 44**(`::before`) · 글자 14 → 15.
- 「+ 글쓰기」 14 → 15 · 「처리할 신고 N건 ›」 13 → 15 · 「더 보기」 46/14 → 50/15 · 빈 화면 17/15 · 오류 13.
- 상세: 본문 15 → 16(공지 상세와 같게) · 「⋯」 40 → 44.

### 움직임 (prefers-reduced-motion 이면 모두 끔)
- 피드 줄 · 신고 묶음 차례 등장(위로 6px + 페이드) · 상세 · 폼 페이드.
- 반응 칩 누름(scale .92) + 바뀐 숫자가 아래에서 올라옴(레이아웃 애니메이션 없음) · 「+」 가 45° 돌며 남은 반응이 톡 나타남.
- 열어 본 글의 안 읽음 점이 그 자리에서 줄어 사라짐(태블릿 칸에 열린 줄도).
- 신고 사유 고르면 라디오 링이 차오름 · 고정 스위치 미끄러짐 · 사진 · 파일 줄 누름 · 버튼 누름 scale(.97) · 확인 창 · 토스트 살짝 커지며 등장.
- 햅틱: 반응 · 태그 · 사유 고름 가벼움, 댓글 · 신고 · 글 올리기 · 수정 · 신고 처리 성공/실패.
- 누르는 것 모두 `touch-action: manipulation` · 탭 하이라이트 없음.

### 파일 · 문구
- 새로: `board-white.css` · `board-time.ts`(상대 시각 · 「역할 · 시각」) · `board-confirm.tsx` · `board-post-form.tsx`(글쓰기 · 수정 공용 조각).
  다시 씀: `board-list-row` · `board-reaction-bar` · `board-tag-filter` · `board-empty-state` · `board-image-grid` · `board-file-card` · `board-comment` · `board-composer` ·
  `board-report-sheet` · `board-action-sheet` · `board-block-confirm` · `board-pin-toggle` · `board-avatar`(그라데이션 → 옅은 보라 하나).
- 서버 · 쿼리 · 권한 변경 없음. 글쓰기 · 수정 페이지가 `getBoardTags` · `getMobileNavBadges` 를 더 부르고, 글쓰기 페이지가 고정 권한을 계산해 넘긴다.
- 새 문구(`dictionary.board`, ko/ja/en): `reportsPending` · `reactionAdd` · `feedFiles` · `commentsN` · `commentHint` · `fileTapToDownload` · `reportAskPost` ·
  `reportAskComment` · `reportSub` · `reportNoteLabel` · `reportNoteExample` · `composeAudience` · `bodyLabel` · `attachSection` · `photoCount` · `fileAddLong` ·
  `fileRemove` · `tagNew` · `pinRowTitle` · `pinRowSub` · `postSubmit` · `reportsMobileTitle`. 신고 처리 안내 · 사유 수는 PC 와 같은 `boardReportsWhite.hint` · `reasonN` 재사용.

## 13. 미결 사항

| 항목 | 상태 |
|------|------|
| UI/UX 디자인 | Page 1·2·3·4 구현 완료 |
| 피드 방식 (최신순 무한스크롤 vs 페이지네이션) | **확정: 커서 기반 + "더 보기" 버튼** (Page 2, 2026-06-25) |
| 댓글 정렬 (등록순 vs 최신순) | **확정: 등록순(오래된 것 먼저)** (Page 3, 2026-06-25) |
| 댓글 이미지 전용(빈 본문) 허용 | **현재 불가** — `board_comments.content` CHECK로 본문 필수; 필요 시 Page 4에서 CHECK 완화 |
| 글 수정 폼 UI | **완료 (2026-08-07)** — 아래 §12 참조 |
| `board_comment_replied` 알림 구현 여부 | 선택 구현 (Phase 3에서 결정) — Page 3은 `board_activity`(댓글) 1종만 구현 |
| 글 신고 기능 | **구현 (2026-10-06)** — §12-C 신고 · 차단 |
| `board-attachments` 버킷 URL 정책 (public vs signed URL) | **확정: signed URL** (2026-06-25) — `getBoardAttachmentDownloadUrl` 서버 액션이 120초 서명 URL을 `download` 옵션과 함께 발급(첨부가 글에 속하는지 검증 후). 버킷은 private 유지 |
| 파일 첨부 최대 개수 | 미정 — 현재 문서상 5개; 이미지 5장과 합산 vs 별도 제한인지 구현 시 결정 |
| @멘션 검색 결과 정렬 | **디폴트: 가나다순**. 추후 최근 활동 기반(마지막 댓글 시각 순)으로 전환 검토 — 현재는 단순 정렬이 충분 |
| @멘션 UI·DB·알림 구현 | **구현 중 (2026-06-25)** — DB 에이전트: `mentioned_user_ids` / `mention_all` 컬럼 + GIN 인덱스 마이그레이션. 백엔드 에이전트: `addBoardComment` 확장 + `notifyBoardMentions`. 프론트엔드 에이전트: 멘션 피커 바텀시트 컴포넌트. |
