# QA 체크리스트 — 공지 이미지 보안 플로우

> **템플릿 고지**
> 이 문서는 QA 실행을 위한 **체크리스트 템플릿**입니다.
> 테스트가 실행된 기록이 아니며, 실행 결과는 테스트 실행자가 직접 기입합니다.
> 결과 기입 없이 배포 판단의 근거로 사용하지 마세요.

> **2026-06-23 인증 절차 갱신**
> 이 템플릿 안의 `/api/dev/seed-login`, `ENABLE_DEV_SEED_LOGIN`, `DEV_SEED_LOGIN_PASSWORD`, E2E
> 시드 계정 절차는 폐기되었습니다. 현재 QA는 실제 Google/email 계정으로 로그인하고, 필요한 경우
> 실제 초대코드 온보딩을 거쳐 실행합니다. 이 문서의 세부 시나리오를 재사용할 때는 로그인 단계만
> 최신 실제 계정 로그인 절차로 바꿔 적용하세요.

---

## 1. 테스트 메타데이터

| 항목 | 내용 |
|---|---|
| 테스트 날짜 | `____-__-__` |
| 체크리스트 작성자 | (이 템플릿을 작성하거나 마지막으로 갱신한 담당자) |
| 테스트 실행자 | (실제로 시나리오를 실행하고 결과를 기입하는 QA 담당자) |
| 환경 | `[ ] 로컬` `[ ] 스테이징` |
| 브랜치 | |
| 커밋 해시 | |
| 앱 URL | `http://localhost:3000` 또는 스테이징 URL |
| Supabase 프로젝트 ref | `sspdgzkytkpmquqsfaup` (로컬) 또는 스테이징 ref |

> **작성자 vs 실행자 구분**: 체크리스트 작성자는 시나리오 설계 및 문서 갱신을 담당하고, 테스트 실행자는 실제 브라우저에서 단계를 수행하고 Pass/Fail/Blocked를 기입합니다. 동일인이 담당할 수 있으나 역할은 분리하여 기록합니다.

---

## 2. 사전 조건

### 2-1. 필요 계정

| 역할 | 이메일 (로컬 시드 기준) | 설정 방법 |
|---|---|---|
| Platform Admin | `stayops.e2e.admin+local@example.com` | `GET /api/dev/seed-login?as=admin` 접속 |
| Staff (비관리자) | `stayops.e2e.staff+local@example.com` | `GET /api/dev/seed-login?as=staff` 접속 |

- 시드 엔드포인트 `/api/dev/seed-login`은 **로컬 환경에서만** 동작합니다. 프로덕션에서는 404를 반환합니다.
- 엔드포인트를 활성화하려면 `.env.local`에 `ENABLE_DEV_SEED_LOGIN=true`와 `DEV_SEED_LOGIN_PASSWORD=<로컬전용값>`이 모두 설정되어 있어야 합니다. `DEV_SEED_LOGIN_PASSWORD`는 `trim()` 후 비어 있으면 안 되며, 둘 중 하나라도 없거나 올바르지 않으면 404를 반환합니다.
- 비밀번호, 토큰, 서비스 키는 이 문서에 기록하지 마세요.
- 스테이징 환경에서는 시드 엔드포인트를 사용할 수 없습니다. 스테이징 테스트 계정은 별도 계정 관리 절차를 따릅니다.

### 2-2. 필요 시드 데이터

다음 조건이 충족되어야 합니다. `GET /api/dev/seed-login?as=admin`을 먼저 실행하면 자동으로 충족됩니다.

- `platform_admins` 테이블에 Platform Admin 계정이 `is_active = true`로 존재
- `organizations` 테이블에 `stayops-e2e-security` 조직이 `status = active`로 존재
- `memberships` 테이블에 Staff 계정이 해당 조직에 `role = staff, status = active`로 존재

### 2-3. 환경 변수 확인

`.env.local`에 다음 항목이 설정되어 있어야 합니다:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- `ENABLE_DEV_SEED_LOGIN=true` ← **로컬 QA 전용 게이트. 없으면 시드 엔드포인트가 404를 반환합니다.**
- `DEV_SEED_LOGIN_PASSWORD=<로컬전용비밀번호>` ← **시드 계정에 설정되는 패스워드. `trim()` 후 비어 있거나 없으면 시드 엔드포인트가 404를 반환합니다. 값 자체는 이 문서에 기록하지 마세요.**

값 자체를 이 문서에 기록하지 마세요. 존재 여부만 확인합니다.

### 2-4. 필요 라우트 및 페이지

| 페이지 | URL | 관련 시나리오 |
|---|---|---|
| 관리자 공지 목록 | `/admin/announcements` | TC-01 ~ TC-10 전체 |
| 공지 상세 (admin) | `/admin/announcements/[id]` → `?id=` 패널 | TC-01 |
| 시드 로그인 (관리자) | `/api/dev/seed-login?as=admin` | 전체 |
| 시드 로그인 (스태프) | `/api/dev/seed-login?as=staff` | TC-04 |
| Supabase Storage 대시보드 | 프로젝트 → Storage → `announcement-images` | TC-01, TC-02, TC-08, TC-09 |
| Supabase Table Editor | 프로젝트 → Table Editor → `announcements` | TC-01, TC-05 |
| Supabase SQL Editor | 프로젝트 → SQL Editor | TC-08 |

### 2-5. 브라우저 준비

- Chrome 또는 Edge 권장 (DevTools 사용).
- DevTools → Network 탭, Console 탭, Elements 탭을 미리 열어두세요.
- Network 탭에서 "기록 유지(Preserve log)"를 활성화하세요.
- 테스트 중 다른 탭이나 확장 프로그램이 Storage 요청에 영향을 주지 않도록 확인하세요.

### 2-6. 알려진 제한 사항

- Next.js 서버 액션은 클라이언트 JS 런타임의 RSC 직렬화 형식을 사용하므로, `curl`로 직접 호출할 수 없습니다. 서버 액션 검증은 브라우저에서 수행해야 합니다.
- TC-09의 주 실행 방법(Storage RLS 정책 임시 변경)은 Supabase 프로젝트 관리자 권한이 필요합니다. 권한이 없으면 TC-09는 Blocked 처리합니다.
- 로컬 환경에서만 실행 가능한 시나리오(TC-02, TC-03, TC-04)는 스테이징에서 재현 방법이 다를 수 있습니다. 차이는 해당 시나리오 비고란에 기록합니다.
- 시드 엔드포인트는 `.env.local`의 `ENABLE_DEV_SEED_LOGIN=true`와 `trim()` 후 비어 있지 않은 `DEV_SEED_LOGIN_PASSWORD` 두 가지가 모두 설정된 경우에만 동작합니다.

### 2-7. 실행 모드 범례

각 시나리오에는 **실행 모드** 태그가 있습니다. 테스트 시작 전 해당 모드에 필요한 접근 권한을 확인하세요.

| 태그 | 의미 | 필요 접근 권한 |
|---|---|---|
| `Browser-only` | 브라우저와 DevTools만으로 완전히 실행 가능 | Chrome 또는 Edge (DevTools) |
| `Browser + DB/Admin` | Supabase 대시보드 접근이 필요한 단계 포함 | 브라우저 + Supabase 프로젝트 읽기/쓰기 권한 (Storage, Table Editor, SQL Editor) |
| `Browser + DB/Admin ★` | Supabase Storage 정책 편집이 필요한 단계 포함 | 브라우저 + Supabase 프로젝트 **관리자(Owner/Editor) 권한** |

**Browser-only**: DevTools만으로 모든 단계를 완료할 수 있습니다. Supabase 대시보드나 SQL Editor 접근이 불필요합니다.

**Browser + DB/Admin**: Supabase 대시보드(Storage 버킷 보기/업로드, Table Editor에서 행 확인, SQL Editor 실행)가 필요합니다. 읽기/쓰기 권한이 있는 모든 팀원이 실행할 수 있습니다.

**Browser + DB/Admin ★ (별표)**: Supabase Storage RLS 정책을 직접 수정하는 단계가 포함됩니다. Supabase 프로젝트 Owner 또는 Editor 역할이 필요합니다. 해당 권한이 없으면 해당 시나리오를 Blocked로 표시합니다.

---

## 3. 시나리오 매트릭스

> 각 시나리오 상단의 **실행 모드** 태그를 확인하세요. 태그 의미는 [2-7. 실행 모드 범례](#2-7-실행-모드-범례)를 참고합니다.

---

### TC-01. 이미지 포함 공지 정상 생성

**실행 모드**: `Browser + DB/Admin` — 완료 후 Supabase Table Editor(`announcements.image_urls`)와 Storage 버킷에서 파일 존재를 확인합니다.

**목적**: 이미지를 포함한 공지가 DB와 Storage에 정상 저장되고, 화면에 올바르게 표시되는지 확인합니다.

**주 실행 방법**: 브라우저에서 공지 생성 폼에 이미지를 첨부하여 제출합니다.

**대체 실행 방법**: 해당 없음. 이 시나리오는 특별한 환경 조작 없이 재현 가능합니다.

**단계**:

1. 브라우저에서 `GET /api/dev/seed-login?as=admin` 접속 → `/admin/announcements`로 리다이렉트 확인.
2. 공지 생성 폼에서 다음 값 입력:
   - 제목: `QA-TC01-이미지정상생성`
   - 내용: `이미지 업로드 정상 테스트`
   - 이미지: JPEG 파일 3장 (각 1MB 이하)
   - 상태: 게시
   - 대상: 전체
3. 이미지 선택 후 썸네일 미리보기가 표시되는지 확인합니다.
4. "생성" 버튼 클릭 → 제출 완료 대기.
5. 리다이렉트 후 URL에 `?created=1`이 포함되는지 확인합니다.
6. Supabase Table Editor → `announcements` → 방금 생성한 행의 `image_urls` 배열 확인.
7. Supabase Storage → `announcement-images/{orgId}/{announcementId}/` 경로에 파일 3개가 존재하는지 확인.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | `공지가 생성되었습니다.` 배너 표시, 공지 카드에 이미지 그리드 표시 |
| DB | `announcements.image_urls` 배열에 3개 URL 포함 |
| Storage | `{orgId}/{announcementId}/` 경로에 파일 3개 존재 |
| 리다이렉트 | URL이 `/admin/announcements?created=1`을 포함 |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

### TC-02. 부분 업로드 실패 시 cleanup

**실행 모드**: `Browser + DB/Admin` — 업로드 차단은 DevTools로 수행하고, 완료 후 Supabase Storage 버킷과 Table Editor에서 파일/행 부재를 확인합니다.

**목적**: 이미지 일부가 업로드된 후 이후 업로드가 실패할 때, 이미 업로드된 파일이 Storage에서 정리되는지 확인합니다.

**주 실행 방법**: DevTools Request Blocking으로 두 번째 Storage 업로드 요청을 차단합니다.

> DevTools → Network 탭 → 우클릭 또는 `Ctrl+Shift+P` → "Show Request Blocking" 검색 → 패턴 `*supabase.co/storage*` 추가.

**대체 실행 방법**: TC-02 실행이 어려운 경우, TC-08(고아 cleanup)을 통해 실패 이후 고아 파일이 정리되는지 간접 확인합니다. 이 경우 TC-02를 Blocked로 표시하고 TC-08 결과와 연결합니다.

**단계**:

1. `GET /api/dev/seed-login?as=admin` 접속.
2. 공지 생성 폼 열기 → 제목: `QA-TC02-부분업로드`, 내용 입력.
3. DevTools Network → Request Blocking 패턴 `*supabase.co/storage*` 추가 (아직 활성화하지 마세요).
4. 이미지 2장 선택 → 첫 번째 파일의 Storage 업로드 요청이 Network 탭에서 완료(200)되는 것을 확인합니다.
5. 첫 번째 요청 완료 즉시 Request Blocking 패턴을 활성화하여 두 번째 업로드를 차단합니다.
6. 화면에 업로드 실패 오류 메시지가 표시되는지 확인합니다.
7. Supabase Storage → `announcement-images/{orgId}/{announcementId}/` 경로를 확인합니다.
   - 즉시 확인 시 첫 번째 파일이 삭제되어 있어야 합니다.
   - 삭제되지 않은 경우, TC-08 실행 후 삭제 여부를 재확인합니다.
8. Supabase Table Editor → `announcements` 테이블에 해당 `announcementId`로 신규 행이 없는지 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | 업로드 실패 오류 표시, 폼 제출 중단 |
| DB | `announcements` 테이블에 해당 `announcementId` 행 없음 |
| Storage | 첫 번째 파일이 삭제되어 있음 (또는 TC-08 실행 후 삭제 확인) |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

### TC-03. 서버 유효성 검사 실패 시 cleanup

**실행 모드**: `Browser + DB/Admin` — DevTools로 폼 속성을 조작하고, 완료 후 Supabase Storage와 Table Editor에서 파일/행 부재를 확인합니다.

**목적**: 이미지 업로드 완료 후 서버 측 검증이 실패할 때, 업로드된 파일이 Storage에서 삭제되는지 확인합니다.

**주 실행 방법**: DevTools Elements 탭에서 제목 입력란의 `required` 및 `minlength` 속성을 제거한 뒤 제목을 비워 제출합니다.

**대체 실행 방법**: DevTools Console에서 `required` 속성을 제거합니다:
```javascript
document.querySelector('input[name="title"]')?.removeAttribute('required');
document.querySelector('input[name="title"]')?.removeAttribute('minlength');
```
이후 제목 입력란을 비운 상태에서 제출 버튼 클릭.

**단계**:

1. `GET /api/dev/seed-login?as=admin` 접속.
2. 공지 생성 폼 열기 → 내용 입력 → JPEG 1장 업로드 완료 대기 (썸네일 표시 확인).
3. DevTools → Elements 탭에서 제목 input 요소를 찾아 `required` 속성을 삭제합니다.
4. 제목 입력란의 내용을 지워 빈 문자열로 만듭니다.
5. "생성" 버튼 클릭.
6. 리다이렉트 URL과 배너 메시지를 확인합니다.
7. Supabase Storage → `announcement-images/{orgId}/{announcementId}/` 경로에 파일이 삭제되었는지 확인합니다.
8. Supabase Table Editor → `announcements`에 해당 행이 없는지 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | `/admin/announcements?error=invalid_announcement` 리다이렉트, `공지 내용을 확인해 주세요.` 배너 |
| DB | `announcements` 테이블에 해당 `announcementId` 행 없음 |
| Storage | 업로드했던 파일이 삭제되어 있음 |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

### TC-04. 권한 실패 시 cleanup

**실행 모드**: `Browser + DB/Admin` — DevTools Console로 organizationId를 조작하고, 완료 후 Supabase Storage 버킷에서 파일 삭제를 확인합니다.

**목적**: 사용자가 멤버십이 없는 조직의 ID로 공지를 생성하려 할 때, 업로드된 파일이 Storage에서 삭제되는지 확인합니다.

**주 실행 방법**: Platform Admin 세션에서 조직 선택 hidden input 값을 존재하지 않는 UUID로 교체한 뒤 제출합니다.

**대체 실행 방법**: Staff 세션에서 동일하게 실행합니다. Staff도 조직 멤버인 경우 forbidden이 발생하지 않을 수 있으므로, 멤버십이 없는 임의의 UUID를 사용합니다.

**단계**:

1. `GET /api/dev/seed-login?as=admin` 접속.
2. 공지 생성 폼 → 내용 입력 → JPEG 1장 업로드 완료 대기.
3. DevTools Console에서 조직 선택 필드 값을 멤버십 없는 UUID로 교체합니다:
   ```javascript
   // select가 있는 경우
   const sel = document.querySelector('select[name="organizationId"]');
   if (sel) sel.value = '00000000-0000-0000-0000-000000000099';

   // hidden input인 경우
   const hid = document.querySelector('input[name="organizationId"]');
   if (hid) hid.value = '00000000-0000-0000-0000-000000000099';
   ```
4. "생성" 버튼 클릭.
5. 리다이렉트 URL과 배너 메시지를 확인합니다.
6. Supabase Storage → 해당 `announcementId` 경로의 파일 삭제 여부를 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | `?error=forbidden` 배너(`공지 관리 권한이 없습니다.`) 또는 `?error=invalid_organization` 배너(`조직을 선택해 주세요.`) |
| DB | 해당 `announcementId` 행 없음 |
| Storage | 업로드했던 파일이 삭제되어 있음 |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

### TC-05. 중복 `announcementId`로 기존 이미지 삭제 불가 확인

**실행 모드**: `Browser + DB/Admin` — TC-01 공지 ID를 Supabase Table Editor에서 복사하고, 완료 후 Storage 파일 목록과 Table Editor에서 기존 이미지/행이 그대로인지 확인합니다.

**목적**: 이미 DB에 저장된 공지의 `announcementId`와 동일한 ID로 cleanup이 요청될 때, `announcementExists()` 가드가 작동하여 기존 이미지가 삭제되지 않음을 확인합니다.

**주 실행 방법**: TC-01로 생성된 공지의 `id`를 DevTools Elements에서 새 생성 폼의 `announcementId` hidden input에 입력한 뒤 제출합니다.

**대체 실행 방법**: TC-01 실행이 완료되어 있지 않은 경우, TC-01을 먼저 실행한 뒤 이 시나리오를 진행합니다.

**단계**:

1. TC-01을 완료하여 이미지가 포함된 공지가 DB와 Storage에 존재하는 상태를 확인합니다.
2. Supabase Table Editor → `announcements`에서 TC-01 공지의 `id` 값을 복사합니다.
3. `GET /api/dev/seed-login?as=admin` 접속 → `/admin/announcements`.
4. 새 공지 생성 폼을 엽니다 → 제목·내용 입력 → JPEG 1장 업로드 완료 대기.
5. DevTools Console에서 `announcementId` hidden input 값을 TC-01의 ID로 교체합니다:
   ```javascript
   const input = document.querySelector('input[name="announcementId"]');
   if (input) input.value = '<TC-01-공지-UUID>';
   ```
6. "생성" 버튼 클릭.
7. 리다이렉트 URL과 배너 메시지를 확인합니다.
8. Supabase Storage → TC-01 공지의 이미지 파일(`{orgId}/{TC-01-uuid}/`) 3개가 그대로 존재하는지 확인합니다.
9. Supabase Table Editor → TC-01 공지 행의 `image_urls`가 변경되지 않았는지 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | 에러 배너 표시 (중복 ID로 인한 insert 실패 또는 `?error=invalid_announcement`) |
| DB | TC-01 공지 행이 그대로 유지됨, 신규 행 없음 |
| Storage | TC-01 이미지 파일 3개 **삭제되지 않음** (핵심 보안 검증) |

> **핵심 검증**: `announcementExists()` 가드가 `cleanupSubmittedAnnouncementImages`와 `cleanupAnnouncementImagePaths` 양쪽에서 작동하여, 이미 저장된 공지의 이미지를 절대 삭제하지 않아야 합니다.

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

### TC-06. `updateAnnouncementStatus` — UUID 아닌 `announcementId` 거부

**실행 모드**: `Browser + DB/Admin` — DevTools Elements로 hidden input을 조작하고, 완료 후 Supabase Table Editor에서 `status` 변경이 없었는지 확인합니다.

**목적**: 상태 변경 폼에 UUID 형식이 아닌 `announcementId`를 전달할 때 서버가 `invalid_announcement`로 거부하는지 확인합니다.

**주 실행 방법**: DevTools Elements 탭에서 상태 변경 form의 `announcementId` hidden input 값을 `not-a-valid-uuid`로 교체한 뒤 제출합니다.

**대체 실행 방법**: DevTools Console에서 hidden input 값을 변경한 뒤 `form.requestSubmit()`으로 제출합니다:
```javascript
const input = document.querySelector('form input[name="announcementId"]');
if (input) {
  input.value = 'not-a-valid-uuid';
  input.closest('form')?.requestSubmit();
}
```

**단계**:

1. `GET /api/dev/seed-login?as=admin` 접속.
2. `/admin/announcements`에 공지가 1개 이상 존재하는지 확인합니다 (없으면 TC-01 먼저 실행).
3. DevTools → Elements 탭에서 상태 변경 버튼("게시" 또는 "임시저장") 주변의 form 요소를 찾습니다.
4. form 내부의 `<input type="hidden" name="announcementId" value="...">` 요소를 찾아 `value`를 다음으로 교체합니다:
   ```
   not-a-valid-uuid
   ```
5. 상태 변경 버튼을 클릭합니다.
6. 리다이렉트 URL과 배너 메시지를 확인합니다.
7. Supabase Table Editor → 해당 공지의 `status`가 변경되지 않았는지 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | `/admin/announcements?error=invalid_announcement` 리다이렉트, `공지 내용을 확인해 주세요.` 배너 |
| DB | 어떤 공지의 `status`도 변경되지 않음 |
| Storage | 변화 없음 |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

### TC-07. `deleteAnnouncement` — UUID 아닌 `announcementId` 거부

**실행 모드**: `Browser + DB/Admin` — 삭제 모달에서 DevTools Elements로 hidden input을 조작하고, 완료 후 Supabase Table Editor에서 행이 삭제되지 않았는지 확인합니다.

**목적**: 삭제 액션에 UUID 형식이 아닌 `announcementId`를 전달할 때 서버가 `invalid_announcement`로 거부하는지 확인합니다.

**주 실행 방법**: 삭제 확인 모달이 열린 상태에서 DevTools Elements 탭으로 `announcementId` hidden input 값을 `not-a-valid-uuid`로 교체한 뒤 제출합니다.

**대체 실행 방법**: DevTools Console에서 모달 내 모든 `announcementId` input을 일괄 교체합니다:
```javascript
document.querySelectorAll('input[name="announcementId"]').forEach(el => {
  el.value = 'not-a-valid-uuid';
});
```

**단계**:

1. `GET /api/dev/seed-login?as=admin` 접속.
2. `/admin/announcements`에 공지가 1개 이상 존재하는지 확인합니다 (없으면 TC-01 먼저 실행).
3. 공지 카드의 "삭제" 버튼을 클릭하여 확인 모달을 엽니다.
4. 모달이 열린 상태에서 DevTools → Elements → 모달 내부의 `<input type="hidden" name="announcementId">` 를 찾아 `value`를 다음으로 교체합니다:
   ```
   not-a-valid-uuid
   ```
5. 모달의 최종 "삭제" 버튼을 클릭합니다.
6. 리다이렉트 URL과 배너 메시지를 확인합니다.
7. Supabase Table Editor → 해당 공지 행이 삭제되지 않았는지 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | `/admin/announcements?error=invalid_announcement` 리다이렉트, `공지 내용을 확인해 주세요.` 배너 |
| DB | 어떤 공지 행도 삭제되지 않음 |
| Storage | 어떤 파일도 삭제되지 않음 |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

### TC-08. 고아 이미지 정상 cleanup (Platform Admin)

**실행 모드**: `Browser + DB/Admin` — Supabase Storage 버킷에 파일을 수동 업로드하고 SQL Editor로 `created_at`을 갱신한 뒤, 브라우저에서 cleanup 버튼을 클릭하고 Storage에서 삭제를 확인합니다.

**목적**: DB에 참조되지 않은 고아 이미지가 60분 유예 기간 이후 cleanup 액션으로 삭제되는지 확인합니다.

**주 실행 방법**: Supabase 대시보드에서 수동으로 고아 파일을 업로드한 뒤, SQL Editor로 `created_at`을 61분 이전으로 갱신합니다.

**대체 실행 방법**: TC-02의 부분 업로드 실패 후 실제 60분 대기. 이 경우 테스트 시간이 길어지므로 주 방법 사용을 권장합니다.

**단계**:

1. Supabase 대시보드 → Storage → `announcement-images` 버킷으로 이동합니다.
2. 다음 경로에 테스트 파일을 수동 업로드합니다:
   ```
   aaaaaaaa-0000-0000-0000-000000000001/bbbbbbbb-0000-0000-0000-000000000002/test-orphan.jpg
   ```
   - 경로는 `{UUID}/{UUID}/{안전한파일명}` 형식을 따라야 합니다.
   - 파일명은 영숫자로 시작하고 끝나야 합니다.
3. Supabase SQL Editor에서 다음 쿼리로 해당 파일의 `created_at`을 61분 이전으로 갱신합니다:
   ```sql
   UPDATE storage.objects
   SET created_at = NOW() - INTERVAL '61 minutes'
   WHERE bucket_id = 'announcement-images'
     AND name LIKE '%test-orphan%';
   ```
4. `GET /api/dev/seed-login?as=admin` 접속 → `/admin/announcements`.
5. 페이지 하단 "스토리지 정리" 카드가 표시되는지 확인합니다 (Platform Admin에게만 보임).
6. "고아 이미지 정리" 버튼을 클릭합니다.
7. 버튼이 "정리 중…"으로 변경되는지 확인합니다.
8. 완료 후 결과 수치를 확인합니다.
9. Supabase Storage → `announcement-images`에서 `test-orphan.jpg`가 삭제되었는지 확인합니다.
10. TC-01에서 생성한 공지의 이미지 파일이 삭제되지 않았는지 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | 결과 수치: `삭제됨: 1` (이상), `오류: 0`, 빨간 alert 없음 |
| Storage | `test-orphan.jpg` 삭제됨, 참조 중인 공지 이미지는 그대로 |
| DB | `announcements.image_urls` 참조 이미지 변화 없음 |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

### TC-09. 고아 cleanup 목록 조회 실패 시 abort 동작

**실행 모드**: `Browser + DB/Admin ★` — Supabase Storage RLS 정책을 임시 비활성화해야 합니다. **Supabase 프로젝트 관리자(Owner/Editor) 권한 필요.** 해당 권한이 없으면 이 시나리오를 Blocked로 표시합니다.

**목적**: Storage 목록 조회 실패 시 cleanup이 전체 중단되고, `ok=false`, `aborted=true`, `listingFailures >= 1` 상태를 반환하는지 확인합니다.

**주 실행 방법**: Supabase Storage의 service role SELECT 정책을 임시 비활성화하여 목록 조회를 강제 실패시킵니다.

> **주의**: 테스트 종료 후 즉시 정책을 복원해야 합니다. 복원 전 단계를 명시적으로 포함합니다.

**대체 실행 방법**: DevTools Network → Throttling → "Offline"으로 설정하여 버튼 클릭. 단, Offline 설정은 Storage뿐 아니라 서버 액션 호출 자체를 차단하므로 결과가 다를 수 있습니다. 이 경우 TC-09를 Blocked로 처리하고 코드 트레이스 결과를 비고에 기록합니다.

**단계**:

1. Supabase 대시보드 → Storage → Policies에서 `announcement-images` 버킷의 service role SELECT 정책을 확인하고, 정책 이름/내용을 **별도 기록**합니다 (복원을 위해).
2. 해당 정책을 임시 비활성화하거나 삭제합니다.
3. `GET /api/dev/seed-login?as=admin` 접속 → `/admin/announcements`.
4. "고아 이미지 정리" 버튼을 클릭합니다.
5. 결과 UI와 수치를 확인합니다.
6. **즉시** 1단계에서 기록한 정책을 복원합니다.
7. 복원 후 `GET /admin/announcements` 페이지를 새로고침하여 정상 동작하는지 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| UI | 빨간 destructive alert 박스 표시 (`role="alert"`) |
| 결과 수치 | `삭제됨: 0`, `목록 조회 실패: 1` (이상) |
| 서버 로그 | 터미널에서 `[purgeOrphanAnnouncementImages]` 관련 에러 로그 확인 |
| DB | 어떤 공지 행도 변경 없음 |
| Storage | 어떤 파일도 삭제되지 않음 (abort이므로) |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고** (정책 복원 확인 포함):

---

### TC-10. Cleanup 실패 시 alert UI 렌더링 확인

**실행 모드**: `Browser-only` — TC-09 실행 중 DevTools Elements에서 UI를 관찰합니다. Supabase 대시보드 접근은 TC-09에 이미 포함되어 있으며 이 시나리오 자체는 브라우저와 DevTools만 사용합니다.

**목적**: `ok=false` 결과 시 `OrphanCleanupButton`이 빨간 destructive alert를 올바르게 렌더링하는지 확인합니다.

**주 실행 방법**: TC-09를 실행하는 동시에 UI를 관찰합니다. TC-09와 이 시나리오를 함께 수행합니다.

**대체 실행 방법**: TC-09가 Blocked인 경우, TC-08에서 정상 실행 결과를 확인하고, DevTools → Elements에서 결과 dl 영역의 DOM 구조를 검사하여 `role="alert"` div가 렌더링되지 않음을 확인합니다. 실패 alert 자체의 렌더링 검증은 TC-09가 가능한 환경에서 재실행합니다.

**단계** (TC-09 실행 중 병행 수행):

1. TC-09 단계 5 직후, 결과가 렌더링된 화면에서 DevTools → Elements 탭으로 전환합니다.
2. 다음 요소가 DOM에 존재하는지 확인합니다:
   - `role="alert"` 속성이 있는 div
   - `border-destructive` 클래스 포함 div
   - `bg-destructive/10` 클래스 포함 div
   - 결과 텍스트(`errorMessage`) 내용 표시
3. `목록 조회 실패` 행이 결과 dl에 표시되는지 확인합니다.
4. TC-08 실행 중 정상 성공 시에는 위 alert div가 **없는지** 확인합니다.

**예상 결과**:

| 항목 | 예상 |
|---|---|
| 실패 시 alert | `role="alert"` div 존재, 빨간 border·background, `errorMessage` 텍스트 표시 |
| `listingFailures` 행 | `listingFailures > 0`일 때만 dl에 `목록 조회 실패: N` 행 표시 |
| 정상 성공 시 | alert div 없음, 수치 dl만 표시 |

**결과**: `[ ] Pass` `[ ] Fail` `[ ] Blocked`

**비고**:

---

## 4. 증거 수집 규칙

### 4-1. 시나리오별 필수 증거

| 시나리오 | 스크린샷 | 서버 로그 | DB/Storage 조회 |
|---|---|---|---|
| TC-01 | 이미지 업로드 썸네일, 완료 배너, 공지 카드 이미지 그리드 | — | `announcements.image_urls` 값, Storage 파일 목록 |
| TC-02 | 업로드 실패 오류 메시지, Network 탭 차단 항목 | — | Storage 파일 삭제 전/후 |
| TC-03 | 에러 배너 (`invalid_announcement`), DevTools Elements 조작 화면 | — | Storage 파일 삭제 확인, DB에 행 없음 |
| TC-04 | 에러 배너 (`forbidden` 또는 `invalid_organization`) | — | Storage 파일 삭제 확인, DB에 행 없음 |
| TC-05 | 에러 배너, Storage 파일 목록 (삭제 안 됨) | — | TC-01 공지 `image_urls` 변화 없음 |
| TC-06 | 에러 배너 (`invalid_announcement`), DevTools Elements에서 input 교체 화면 | — | DB `status` 변화 없음 |
| TC-07 | 에러 배너 (`invalid_announcement`), 모달 내 input 교체 화면 | — | DB 행 삭제 없음, Storage 변화 없음 |
| TC-08 | 정리 결과 수치 UI (`deleted=N`), Storage 삭제 전/후 목록 | 터미널 로그 (정리 완료 메시지) | Storage `test-orphan.jpg` 삭제 확인, 참조 이미지 유지 확인 |
| TC-09 | 빨간 alert box 포함 결과 UI, `listingFailures: 1` 수치 | 터미널 로그 (`[purgeOrphanAnnouncementImages]` 에러) | Storage 파일 변화 없음, 정책 복원 확인 |
| TC-10 | DevTools Elements에서 `role="alert"` div 포함 DOM 캡처 | — | — |

### 4-2. DB 조회 예시

Supabase Table Editor 또는 SQL Editor에서 사용합니다:

```sql
-- 특정 announcementId로 공지 행 확인
SELECT id, image_urls, status, created_at
FROM announcements
WHERE id = '<테스트에서-사용한-announcementId>';

-- announcement-images Storage 파일 최신 목록
SELECT name, created_at
FROM storage.objects
WHERE bucket_id = 'announcement-images'
ORDER BY created_at DESC
LIMIT 20;

-- 고아 cleanup 전후 Storage 변화 확인 (TC-08)
SELECT name, created_at
FROM storage.objects
WHERE bucket_id = 'announcement-images'
  AND name LIKE '%test-orphan%';
```

### 4-3. 증거 파일 명명 규칙

```
QA_YYYYMMDD_TC{번호}_{단계}_{결과}.png

예시:
QA_20260520_TC01_upload_complete_pass.png
QA_20260520_TC05_storage_intact_pass.png
QA_20260520_TC09_failure_alert_pass.png
QA_20260520_TC06_error_banner_fail.png
```

결과가 Blocked인 경우 `blocked`로 표기합니다:
```
QA_20260520_TC09_policy_blocked.png
```

---

## 5. 종료 기준

### 5-1. QA 통과 (Pass) 정의

다음 조건이 **모두** 충족되어야 합니다:

- [ ] TC-01 ~ TC-10 중 **Fail 0건**
- [ ] Blocked 시나리오가 있을 경우, 블록 사유가 비고에 문서화되어 있고 대안 검증(코드 트레이스 또는 다음 실행 계획)이 명시되어 있음
- [ ] DB에 의도치 않게 삭제된 `announcements` 행이 없음
- [ ] Storage에 의도치 않게 삭제된 참조 이미지가 없음
- [ ] TC-09에서 변경한 Storage 정책이 복원되었음
- [ ] `npm run lint` 및 `npm run build` 통과 (테스트 종료 후 재실행)

### 5-2. QA 실패 (Fail) 정의

다음 중 하나라도 해당하면 QA Fail입니다:

- TC-01 ~ TC-10 중 1건 이상 Fail
- 의도치 않게 삭제된 DB 행 또는 Storage 파일 발견
- TC-09 이후 Storage 정책 미복원 상태 발견

### 5-3. QA 보류 (Blocked) 정의

다음 중 하나라도 해당하면 해당 시나리오를 Blocked로 표시합니다:

- 필요 계정 또는 시드 데이터 생성 불가
- Supabase Storage/DB 접근 권한 없음
- 환경 조작(정책 변경, DevTools 조작)이 불가능
- 기능이 해당 환경에 배포되어 있지 않음

Blocked 시나리오는 배포 차단 사유가 되지 않지만, 블록 사유와 재실행 예정일을 반드시 기록해야 합니다.

### 5-4. 에스컬레이션 경로

| 우선순위 | 조건 | 조치 |
|---|---|---|
| P1 (배포 차단) | TC-05 Fail — 기존 공지 이미지 삭제 확인 | 즉시 개발팀 에스컬레이션, 배포 차단 |
| P1 (배포 차단) | TC-09 Fail — 목록 조회 실패 시에도 cleanup이 계속 실행됨 | 즉시 개발팀 에스컬레이션, 배포 차단 |
| P2 | TC-01, TC-02, TC-03, TC-04 Fail | 재현 단계 기록, 버그 리포트 생성, 개발팀 공유 |
| P3 | TC-06, TC-07 Fail | 버그 리포트 생성, 다음 스프린트 수정 |
| P3 | TC-08, TC-10 Fail | 버그 리포트 생성, 고아 cleanup 기능 재검토 |

### 5-5. 테스트 환경 복원 체크리스트

테스트 완료 후 반드시 확인합니다:

- [ ] TC-08에서 수동 업로드한 `test-orphan.jpg` 파일이 Storage에서 삭제됨
- [ ] TC-09에서 임시 변경한 Storage SELECT 정책이 복원됨
- [ ] 테스트용 공지 (제목에 `QA-TC` 포함)가 아카이브 또는 삭제 처리됨
- [ ] Request Blocking 패턴이 DevTools에서 비활성화됨

---

## 6. 유예 항목

이 섹션은 현재 QA 범위에서 의도적으로 제외된 시나리오와 그 사유를 기록합니다.

실행자는 유예 항목을 Pass/Fail로 판단하지 않으며, 유예 만료일에 재검토합니다.

| 항목 | 사유 | 계획된 실행 환경 | 유예 만료 |
|---|---|---|---|
| 공지 속성 기반 타겟팅 (property targeting) | 속성(건물/호실) 설정 기능이 구현되지 않아 테스트 불가 | 속성 설정 기능 구현 후 | 미정 |
| 다중 기기 팝업 숨기기 동기화 검증 | 서버 측 `announcement_popup_dismissals` 동기화 동작은 복수 브라우저 세션 필요 — 로컬 단일 기기 환경에서 완전한 재현 어려움 | 스테이징 환경 (복수 기기) | 스테이징 준비 후 |
| 스테이징 환경에서 이미지 업로드 E2E | 스테이징 Supabase 프로젝트 환경 변수 및 계정 미구성 | 스테이징 배포 후 | 스테이징 준비 후 |
| 서버 액션 직접 호출 (curl 또는 API 레벨) | Next.js 서버 액션은 RSC 직렬화 형식이 필요하여 curl로 재현 불가 — 코드 트레이스로 대체됨 | 자동화 테스트 도구 도입 후 | 미정 |
| 60분 실제 대기 기반 고아 cleanup 검증 | TC-08 주 방법(SQL `created_at` 갱신)으로 대체 — 실시간 대기는 QA 세션 시간 상 비효율적 | 해당 없음 (대체 방법 충분) | — |

---

---

## 문서 이력

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-05-20 | 최초 템플릿 작성 — TC-01 ~ TC-10, 증거 규칙, 종료 기준, 유예 항목 포함 | 체크리스트 작성자 기입 |
| 2026-05-20 | 역할 구분 (체크리스트 작성자 / 테스트 실행자) 추가, 시나리오별 주/대체 실행 방법 명시, 유예 항목 섹션 추가 | 체크리스트 작성자 기입 |
| 2026-05-20 | 실행 모드 범례(2-7) 추가 (`Browser-only` / `Browser + DB/Admin` / `Browser + DB/Admin ★`), 각 TC에 실행 모드 태그 추가, `ENABLE_DEV_SEED_LOGIN=true` 환경 변수 게이트 사전 조건 추가 | 체크리스트 작성자 기입 |
| 2026-05-20 | `DEV_SEED_LOGIN_PASSWORD` 사전 조건 추가 (2-1, 2-3, 2-6 섹션) — 하드코딩된 패스워드 제거에 따른 env 요구 사항 및 `trim()` 후 비어 있지 않아야 한다는 조건 반영 | 체크리스트 작성자 기입 |

*이 문서는 테스트 실행 기록이 아닙니다. 실행자가 결과를 기입하기 전까지 모든 결과 필드는 공백입니다.*
