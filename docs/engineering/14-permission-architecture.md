# 권한 아키텍처 — 역할과 개인 지정을 하나의 모델로

- 상태: **5단계 진행 중** — 2026-09-10. 채용(`job_application.*`)·사용자 관리(`user.manage`) 전환 완료.
  남은 기능은 하나씩 옮긴다(§9).
- 구현된 것: `src/config/capabilities.ts`(레지스트리·판정식) · `src/lib/capabilities-server.ts`
  (서버 리졸버) · `src/lib/capability-seed.ts`(시드 생성) ·
  `supabase/migrations/202609100001_capability_foundation.sql`(원격 적용 완료) ·
  `AppSession.capabilities` · `/admin/users/[id]` 권한 카드 ·
  `src/lib/__tests__/capability-registry.test.ts`(13건)
- 사용자 방향 지시(2026-09-10): 「앞으로도 모든 기능은 역할 기반으로 나눠 쓰는 기능도 필요하지만,
  개개인을 특정해 권한을 세분화할 수 있도록도 설계해야 한다. 채용 기능만 중요한 게 아니라 설계
  자체를 그렇게 해야 한다. 차단 모델도 넣고, 사용자 기능에서 관리할 수 있어야 한다.」
- 관련 코드: `src/config/roles.ts`, `src/config/permission-overrides.ts`,
  `src/lib/permission-overrides-server.ts`, `src/lib/admin-session.ts`, `src/config/navigation.ts`
- 관련 문서: `docs/product/01-user-roles.md`, `docs/engineering/05-rls-permissions.md`,
  `docs/product/27-permission-override-workflow.md`

---

## 0. 한 줄 요약

기능 코드는 **역할을 모른다.** 「권한 키(capability)」만 묻는다. 그 키를 누가 갖는지는 **역할표 +
개인 부여/차단**이 정하고, 그 정의는 **한 곳에만** 있다.

```txt
       역할 ──┐
               ├──→ 권한 키 ──→ 기능 게이트 / RLS 정책 / 사이드바
개인 부여 ──┤
개인 차단 ──┘
```

판정식:

```txt
can(user, cap) =
      NOT denied(user, cap)                       -- 차단이 최우선
  AND ( granted(user, cap)                        -- 개인 부여
        OR role(user) ∈ cap.roles                 -- 역할 기본 부여
        OR (is_platform_admin AND cap.platformBypass) )
```

---

## 1. 왜 다시 세우는가

### 1-1. 같은 규칙이 네 곳에 복사된다

「누가 이 기능을 쓸 수 있는가」가 지금은 **역할 배열을 직접 적는 방식**이다. 그래서 같은 규칙이
서로 다른 언어와 파일에 흩어진다.

| 자리 | 예 |
| --- | --- |
| 페이지 게이트 | `if (!canReadJobApplications(session.user.role)) redirect("/admin")` |
| 서버 액션 | `requireRecruitSession()` 안에서 같은 술어 재호출 |
| RLS 정책 (SQL) | `has_org_role(organization_id, ARRAY['owner','senior_managing_director','office_admin'])` |
| 사이드바 | (아무 검사도 없음 — §1-4) |

실측(2026-09-10): 정책 **145개** 중 **31개**가 `has_org_role` 로 역할 배열을 직접 들고 있고,
개인 예외를 반영하는 정책은 **4개**뿐이다.

TypeScript 쪽 역할표를 고쳐도 SQL 쪽은 따라오지 않는다. **이 저장소는 이 실패를 반복해서 겪었다** —
「같은 판정식이 세 곳에 복사돼 있었고 그중 하나만 조건을 빠뜨렸다」는 수정이 결정 로그에 여러 건
남아 있다. 권한에서 같은 일이 나면 결과는 「보면 안 되는 사람이 본다」다.

### 1-2. 개인 단위 권한 장치가 네 종류로 갈라져 있다

같은 목적(개인에게 예외를 준다)에 네 가지 서로 다른 구현이 있다.

| 장치 | 저장 위치 | 기한 | 감사 기록 |
| --- | --- | --- | --- |
| `membership_permission_overrides` | 전용 표 | 필수 | 있음(부여자·사유·회수) |
| `memberships.attendance_payroll_admin` | 불리언 컬럼 | 없음 | 없음 |
| `memberships.leave_approver_role` | 컬럼 | 없음 | 없음 |
| `profiles.can_generate_report` | 불리언 컬럼 | 없음 | 없음 |

새 기능마다 「컬럼을 팔까, 오버라이드를 쓸까」를 다시 고민하게 되고, 관리 화면도 장치마다 다르다.

### 1-3. 차단(deny)이 아예 없다

지금 모델은 **더하기만** 된다. 「사무직인데 이 사람만 발주 처리 제외」를 표현할 방법이 없다.
역할을 강등하는 수밖에 없는데, 그러면 그 사람의 다른 권한까지 함께 사라진다.

### 1-4. 사이드바가 권한을 모른다

`admin-shell.tsx` 는 14개 메뉴를 **모두에게 무조건** 렌더한다. `NavigationItem.allowedRoles` 필드가
선언되어 있으나 **어떤 항목에도 설정되지 않았고 읽는 코드도 없다** — 배선되지 않은 죽은 필드다.
결과적으로 `field_manager`·`staff` 에게 「채용」 메뉴가 보이고, 누르면 `/admin` 으로 튕긴다.

데이터가 새지는 않는다(서버 게이트가 막는다). 그러나 죽은 링크이고, 기능의 존재가 전원에게
노출된다.

### 1-5. 지금이 적기다

실측(2026-09-10): `membership_permission_overrides` **0행**, `can_generate_report` **0명**,
`attendance_payroll_admin` **0명**.

**이전할 데이터가 없다.** 키 이름·스키마·기한 정책을 원하는 대로 정할 수 있다. 사용자가 늘고
부여 이력이 쌓인 뒤에 하면 같은 작업이 몇 배로 커진다.

---

## 2. 설계 원칙

1. **정의는 한 곳.** 역할↔권한 매핑은 한 파일에서만 선언한다. 기능 코드·RLS·사이드바는 그것을
   참조만 한다. 배열을 복사하는 순간 이 설계는 실패한 것이다.
2. **기능 코드는 역할을 모른다.** `can(session, "job_application.read")` 만 안다. 나중에 그 권한을
   가진 역할이 바뀌어도 기능 코드는 한 글자도 안 바뀐다.
3. **서버가 유일한 집행자.** 사이드바 필터는 UX다. `AdminShell` 은 클라이언트 컴포넌트이므로
   메뉴 목록은 어차피 번들에 있다. 페이지·서버 액션·RLS 3중 게이트는 그대로 유지한다
   (CLAUDE.md §6).
4. **잠기지 않는다.** 어떤 설정 조합으로도 「아무도 권한을 관리할 수 없는」 상태가 되면 안 된다.
   §3-4 의 보호 규칙이 이것을 보장한다.
5. **한 번에 하나씩 옮긴다.** 토대를 놓는 단계에서는 **어떤 권한도 바뀌지 않는다.** 기능별 전환은
   그 기능의 실제 게이트를 읽고 하나씩 한다.

---

## 3. 모델

### 3-0-0. 사이드바에 권한 키를 다는 기준 (2026-09-10 실측)

메뉴를 숨기려면 **그 페이지의 실제 게이트와 일치**해야 한다. 안 맞으면 「메뉴는 없는데 URL 로는
들어가진다」 또는 「권한을 줬는데 메뉴가 안 뜬다」가 된다.

admin 페이지 14개의 게이트를 전수 확인한 결과:

| 페이지 | 게이트 | 메뉴 |
| --- | --- | --- |
| 대부분(청소·수리·주문·분실물·근태·업무 등) | `requireAdminPageSession` 뿐(어드민 웹 접근) | **숨기지 않는다** |
| `/admin/settings` | 페이지는 열리고 내부 섹션만 역할로 막는다 | 숨기지 않는다 |
| `/admin/users` · `/mobile/users` | 개발자 · 대표 · 전무(역할, 2026-10-20) **또는** `user.manage` 개인 부여 | **`user.manage`** |
| `/admin/recruit` | `canReadJobApplications(role)` | 5단계에서 전환 후 적용 |

`/admin/users` 가 첫 적용 대상이 된 이유: 위임 플래그 보유자가 **0명**이라 실제로는 플랫폼
개발자만 열 수 있는데 메뉴는 전원에게 보이고 있었다 — 사무직에게 죽은 링크였다. 적용 후
`has_capability` 로 재확인: 개발자 겸 owner **보임**, 사무직 **안 보임**.

**페이지 게이트도 같은 키를 보게 했다.** 사이드바만 키를 보고 페이지는 플래그만 보면 판정이 두
벌이 된다 — `actorCanOpenUserManagement` 가 `user.manage` 부여도 함께 인정한다. 레거시 플래그는
위임 UI 를 권한 부여로 옮기는 5단계까지 남겨 둔다(0명이라 당장 문제는 없다).

**대표 · 전무는 `user.manage` 를 역할로 받는다(2026-10-20 사용자 결정, 권한 정리 ②).** 권한을 바꾸는 자격(`permission.manage`)은
대표 · 전무에게 있는데 화면 입장권이 없어 개발자가 열어 줘야 했다. 레지스트리 `roles` + `capability_roles`(마이그레이션
`202610200002`) + 입장 판정 `actorCanOpenUserManagement` · `actorCanManageUsersInOrg`(이제 그 조직의 멤버십 역할로 `evaluateCapability`
— 예전엔 개인 부여만 봤다). 개인 부여(위임)는 여전히 개발자만(`developerOnly`).

**`user.manage` 는 대표급 · 개발자 계정에 닿지 않는다(2026-10-19).** 위임받은 사람이 owner · 전무를
정지 · 강등 · 삭제할 수 있으면 위임이 곧 권한 상승이다. 사용자 콘솔의 모든 변경 액션은
`guardProtectedTarget` 을 거친다 — 대상이 owner · 전무면 그 조직의 owner · 전무 또는 개발자만,
대상이 개발자면 개발자만(`developerOnly` 와 같은 결). 마지막 활성 owner 는 강등 · 비활성 · 삭제 불가.
삭제 · 비활성은 다른 조직 멤버십이 있으면 이 조직 멤버십에서 멈춘다(로그인 계정은 조직 공용).
판정: `src/lib/user-management-guard.ts`, 화면 규칙: `docs/product/17-user-profile-directory.md`.

### 3-0. 기존 오버라이드 키 4개는 이름을 유지한다

`order_processor` · `maintenance_status_change` · `property_room_manage` · `can_generate_report` 는
RLS 정책과 앱 코드가 **그 문자열 그대로**를 검사하고 있다. 이름을 바꾸면 그 정책들을 함께 고쳐야
하므로 레지스트리에 원래 이름으로 넣었다. 5단계에서 기능을 옮길 때 정리한다.

이 키들의 `roles` 는 **각 기능의 현재 RLS 정책에서 그대로 옮겨 적은 값**이다(2026-09-10 실측).
관리 화면이 「역할로 받은 권한」을 보여줄 때 사실과 달라지면 안 되기 때문이다.
`property_room_manage` 만 `roles: []` 인데, 현재 정책이 오버라이드 보유자와 플랫폼 관리자에게만
쓰기를 열어 원래부터 「지정된 개인만」인 권한이기 때문이다.

### 3-0-1. 전무는 owner 와 동등하다

DB 헬퍼 `has_org_role` 이 「목록에 `owner` 가 있으면 `senior_managing_director` 도 통과」로 동작한다
(마이그레이션 202607130003). **판정식도 같아야 한다** — 다르면 같은 권한이 앱에서는 열리고 RLS
에서는 막히는 상태가 된다. `evaluateCapability`(앱)와 `has_capability`(SQL) 양쪽에 같은 동등 규칙을
넣었고, 테스트가 「전무는 owner 가 가진 것을 모두 가진다」를 전 키에 대해 검증한다.

### 3-1. 권한 키(capability)

권한의 단위. `도메인.동작` 형태의 문자열이다.

현재 레지스트리(2026-09-10):

```txt
permission.manage           권한 관리 (systemOnly — 개인 지정 불가)
job_application.read        지원서 열람
job_application.triage      지원서 심사 상태 변경
job_application.delete      지원서 삭제
order_processor             발주 상태 처리          ← 기존 키, 이름 유지(§3-0)
maintenance_status_change   수리 상태 변경          ← 기존 키
property_room_manage        건물·객실 관리          ← 기존 키
can_generate_report         일일 업무일지 생성      ← 기존 키
ops_admin.access            운영 관리자 영역 전체    ← 2026-09-17 추가
room_links.access           룸 링크                 ← 2026-10-02 추가
board.moderate              게시판 신고 처리         ← 2026-10-06 추가
automation.manage           자동화 설정 · 발송       ← 2026-10-06 추가 (역할 기본 없음 — 개인 부여만)
```

**`board.moderate`**(2026-10-06) — 게시판 신고 처리(모바일 `/mobile/board/reports` · 관리 `/admin/board-reports`). 역할 owner · office_admin
(그전까지 남의 글을 지울 수 있던 역할과 같다), 개인 부여 · 차단 가능, 기한 없음, 개발자 통과. 코드는 `canModerateBoard`
(`src/lib/board-moderation.ts`) 만 본다. 기존 DB 반영: `202610060002_board_moderate_capability.sql`. docs/product/23-board-workflow.md §12-C.

**`automation.manage`**(2026-10-06) — 자동화 관제실에서 실제로 Slack 에 나가는 것을 바꾸는 일(발송 토글 · 시각 · 받는 곳/언어 · 지금 보내기 ·
정정본 · 청소 명단 담당자 이름). 보기는 `ops_admin.access` 로 충분하다. **역할 기본 부여가 없다** — 사용자 결정 「중요한 사람만, 내가 권한을 준
사람만」이라 대표 · 전무도 개인 부여를 받아야 한다. 개인 부여 · 기한 없음 · 차단 없음 · 개발자 통과. 서버 액션이 매번 확인한다.
docs/product/36-automation-control.md.

**`room_links.access` 는 운영 관리자 묶음에 있지만 `ops_admin.access` 와 따로 준다**(2026-10-02 사용자 결정). 리스팅
확인은 가격을 만지지 않는 사람도 한다. 정책은 같다(대표 · 전무 역할, 개인 부여, 기한 · 차단 없음, 개발자 통과).
코드는 `canAccessRoomLinks`(`src/lib/ops-admin.ts`) 만 본다. docs/product/35-room-links.md.

**`ops_admin.access` 는 「영역 하나 = 키 하나」의 첫 사례다.** 그 안의 다섯 화면(판매 캘린더 ·
가동률 · 매출 · 전표 · 자동화)을 기능별로 쪼개지 않는다 — 들어오는 사람이 사무실 직원 몇 명뿐이고,
들어왔으면 전부 쓴다. 쪼개 봐야 관리 부담만 늘고 「가격은 되는데 재고는 안 되는」 상태가 실제
업무에 없다. 나중에 쪼개야 하면 키를 추가하면 되고, **기능 코드는 `src/lib/ops-admin.ts` 만 본다**
(docs/product/32-ops-admin-area.md).

RLS 에서도 같은 키로 판정한다: `beds24_price_jobs` · `price_change_logs` · `beds24_block_logs` 의 SELECT 는
`capability_organization_ids('ops_admin.access')`(= 호출자가 `has_capability` 참인 조직 목록)로 좁혀져 있다
(2026-09-30, `202609300007`, docs/engineering/05-rls-permissions.md).

앞으로 추가될 것(5단계에서 해당 기능을 옮길 때): `payroll.view` 등.

읽기와 쓰기를 나누는 이유: 「보기만 되는 사람」과 「처리까지 되는 사람」이 실제로 다르다. 지금은
채용에서 볼 수 있으면 삭제까지 된다.

### 3-2. 키마다 정책을 갖는다

```ts
"job_application.read": {
  roles: [],                  // 역할로는 아무도 안 받는다 → 지정된 개인만
  individualGrant: true,
  individualDeny: false,      // 역할 부여가 없으므로 차단할 대상이 없다
  asksExpiry: false,          // 상시 업무 → 누르면 바로 무기한
  platformBypass: true,
},
order_processor: {
  roles: ["owner", "senior_managing_director", "office_admin", "cs_staff"], // 2026-10-20 field_manager 뺌(문서 10 · 앱 · DB 트리거와 맞춤)
  individualGrant: true,
  individualDeny: true,       // 「사무직인데 이 사람만 제외」
  asksExpiry: true,           // 켤 때 기한 줄(무기한 · 1주 · 1개월 · 3개월 · 날짜)
  platformBypass: true,
},
```

| 필드 | 뜻 |
| --- | --- |
| `roles` | 이 역할이면 기본으로 받는다. **빈 배열이면 「지정된 개인만」**이 된다 |
| `individualGrant` | 개인에게 추가 부여할 수 있는가 |
| `individualDeny` | 역할로 받은 것을 개인에게서 뺄 수 있는가 |
| `asksExpiry` | 켤 때 기한을 묻는가(2026-10-20 전 이름 `requiresExpiry` = 기한 필수. 지금은 무기한도 고를 수 있다) |
| `platformBypass` | 플랫폼 개발자(`developer_super_admin`)가 통과하는가 |
| `systemOnly` | 관리 화면에 **노출조차 하지 않는다**(권한 관리 자체) |

**기존 결정과의 관계.** `27-permission-override-workflow.md` 는 「모든 부여에 기한 필수, 무기한
없음」을 확정 결정으로 적고 있다. 이 설계는 그것을 **키별 정책으로 일반화**한다 — 기존 예외성
권한은 `requiresExpiry: true` 로 그대로 두고, 상시 업무 지정(채용 담당자 등)만 무기한을 허용한다.
결정이 뒤집히는 것이 아니라 적용 범위가 명시된다.

**2026-10-20 개정 — 기한 필수 폐지.** 사용자 결정으로 모든 키에서 무기한을 고를 수 있다. 예외성 권한도 켤 때 기한
줄이 펼쳐지지만 맨 앞에 「무기한」 칩이 있고, 서버는 기한을 비우면 무기한으로 저장한다. 필드 이름도 `asksExpiry` 로 바꿨다.

### 3-3. 판정식

```txt
can(user, cap) =
      NOT denied(user, cap)
  AND ( granted(user, cap)
        OR role(user) ∈ cap.roles
        OR (is_platform_admin(user) AND cap.platformBypass) )
```

- **차단이 최우선이다.** 개인 부여보다도 앞선다. 「빼라」는 지시가 「줘라」보다 강해야 사고가
  안전한 쪽으로 난다.
- 부여·차단은 모두 **활성인 것만** 센다(회수되지 않았고, 기한이 있으면 아직 지나지 않은 것).

### 3-4. 잠기지 않기 위한 보호 규칙

| 규칙 | 이유 |
| --- | --- |
| `owner` · `senior_managing_director` · `developer_super_admin` 에게는 **차단을 걸 수 없다** | 소유자를 잠그면 되돌릴 사람이 없다 |
| **자기 자신에게 부여·차단 불가** | 이미 DB 제약으로 존재(`no_self_grant`). 차단에도 같이 적용 |
| 권한 관리 자체(`permission.manage`)는 **개인 부여·차단 대상이 아니다** | 관리 권한을 개인 지정으로 뺏고 주면 잠금 사고가 난다. 역할로만 결정 |

---

## 4. 데이터 모델

### 4-1. `capability_roles` (신설)

역할↔권한 매핑을 **DB 에도 둔다.** RLS 가 그것을 읽어야 하기 때문이다.

```sql
create table public.capability_roles (
  capability text not null,
  role organization_role not null,
  primary key (capability, role)
);
```

**시드는 마이그레이션이 TypeScript 정의로부터 만든다.** 사람이 SQL 에 다시 적지 않는다 — 다시
적는 순간 §1-1 의 문제가 재발한다. 일치는 테스트가 검증한다(§6).

### 4-2. `membership_permission_overrides` (변경)

기존 표를 재사용한다. 부여자·사유·회수·조직 격리가 이미 있다.

| 변경 | 내용 |
| --- | --- |
| `effect` 컬럼 추가 | `'grant' | 'deny'`, 기본 `'grant'` |
| `expires_at` NULL 허용 | NULL = 무기한. (2026-10-20 부터 모든 키에서 허용 — 서버 거부 없음) |
| 부분 유니크 인덱스 | 활성 행 기준 `(organization_id, user_id, permission_key, effect)` 중복 방지 |

행이 0건이므로 **데이터 이전이 없다.** 표 이름은 유지한다(참조가 여러 곳이고 의미는 그대로다).

### 4-3. `has_capability()` (신설 SQL 함수)

```sql
has_capability(target_organization_id uuid, target_user_id uuid, target_capability text)
  returns boolean
```

§3-3 의 판정식을 그대로 담는다. RLS 정책은 역할 배열을 **다시 적지 않고** 이 함수만 부른다.

```sql
-- 전: 정책마다 역할 배열을 복사
using (has_org_role(organization_id, ARRAY['owner','senior_managing_director','office_admin']))

-- 후: 권한 키 하나
using (has_capability(organization_id, (select auth.uid()), 'job_application.read'))
```

기존 `has_org_role` · `has_permission_override` 는 남긴다 — 아직 전환하지 않은 정책들이 쓴다.

---

## 5. 판정 경로

세 곳에서 묻지만 **규칙은 하나**다.

| 부르는 곳 | 방법 | 비고 |
| --- | --- | --- |
| 서버 컴포넌트 · 서버 액션 | `await can(session, cap)` | `react.cache` 로 요청당 1회 조회 |
| 클라이언트(사이드바 등) | 세션에 실린 **유효 권한 집합** | 서버가 계산한 결과를 그대로 받음 |
| RLS 정책 | `has_capability(...)` | DB 안에서 독립 판정 |

**클라이언트는 스스로 계산하지 않는다.** 서버가 세션을 만들 때 유효 권한 집합을 한 번 계산해
실어 보내고, 사이드바는 그 집합을 보기만 한다. 계산이 두 벌이 아니므로 어긋날 수 없다.

`AppSession` 에 `capabilities: readonly Capability[]` 가 추가된다(현재는 `organization` + `user`
뿐). 조회는 멤버십 1회 + 오버라이드 1회로 끝난다.

---

## 6. 드리프트 방지

권한 설계가 실패하는 방식은 언제나 「두 벌이 갈라지는 것」이다. 세 가지 장치를 둔다.

1. **TypeScript 레지스트리가 원본.** 역할표는 `src/config/capabilities.ts` 에만 있다.
2. **마이그레이션이 그것으로부터 `capability_roles` 를 채운다.** 손으로 SQL 을 적지 않는다.
3. **일치 테스트.** `capability_roles` 의 내용과 TypeScript 레지스트리가 같은지 검증한다.
   갈라지면 테스트가 깨진다. (이 저장소는 RLS InitPlan 전면 적용 때 「체크섬으로 무변경을 증명」한
   전례가 있다 — 같은 방식이다.)

추가로, 레지스트리에 없는 키를 쓰면 **타입 에러**가 난다(`Capability` 는 유니온 타입).

---

## 7. 사용자 관리 화면에서 관리한다

`/admin/users/[id]` 의 「권한 예외」 카드를 **「권한」 카드로 확장**한다. 새 화면을 만들지 않는다 —
역할 변경이 이미 그 화면에 있고, 권한은 그 옆에 있어야 한다.

카드가 보여줄 것:

| 구역 | 내용 |
| --- | --- |
| 역할로 받은 권한 | 읽기 전용 목록. 「역할(사무직)으로 부여됨」이라고 근거를 밝힌다 |
| 개인 부여 | 부여 버튼 · 사유 필수 · 기한(키 정책에 따라 필수/선택) · 회수 |
| 개인 차단 | 역할로 받은 권한 옆의 「제외」. 사유 필수 · 해제 가능 |
| 현재 유효 권한 | 위 셋을 합친 **최종 결과**. 「이 사람이 지금 실제로 무엇을 할 수 있는가」 |

**최종 결과를 같이 보여주는 것이 중요하다.** 부여와 차단이 겹치면 사람은 결과를 암산하지 못한다.
화면이 판정식을 대신 계산해 보여줘야 실수를 막는다.

관리 권한: `owner` · `senior_managing_director` · `developer_super_admin`(현재와 동일).

**키에 따라 부여 자격이 더 좁을 수 있다 — `developerOnly`.** 사용자 관리 위임(`user.manage`)이
그렇다: 위임받은 사람이 다시 위임하면 권한이 무한히 번진다(2026-07-13 결정 「위임자는 재위임하지
못한다」). 이 규칙은 **누가 가지는가가 아니라 누가 줄 수 있는가**의 규칙이라 판정식(`has_capability`)
에는 들어가지 않고 서버 액션과 관리 화면에서만 본다. 부여와 **회수 양쪽**에 건다 — 부여만 막으면
대표가 개발자의 위임을 되돌린 뒤 다시 줄 수는 없는 어긋난 상태가 된다.

**컨트롤은 한 곳에만 둔다 (2026-09-10).** 처음에는 「사용자 관리 권한」 드롭다운이 개발자 카드에
따로 있었다. 권한 카드와 **같은 데이터를 쓰는 컨트롤이 두 개**여서, 나중에 한쪽만 고쳐지면 갈라진다
— 이번 감사에서 나온 결함 4건이 전부 그 패턴이었다. 드롭다운을 없애고 권한 카드로 모았다.
개발자 카드에 남는 것은 조직 권한이 아니라 플랫폼 등급인 「개발자 지정」뿐이다.

### 구현 메모 (2026-09-10)

- 부여 드롭다운은 **레지스트리가 정한 것만** 낸다. i18n 사전에 라벨이 남아 있어도 개인 부여가
  불가능한 키는 뜨지 않는다.
- 기한을 묻는지는 **키 정책을 따른다**(`asksExpiry`). 비우면 무기한 — 2026-10-20 부터 모든 키에서 허용된다.
- 차단 버튼은 「역할로 받은 권한」 칩 옆에 붙는다 — 뺄 대상이 눈앞에 있어야 조작이 자연스럽다.
  owner·전무·개발자에게는 버튼이 뜨지 않고, 서버도 같은 규칙으로 거부한다(이중 방어).
- 부여·차단·회수 후 `router.refresh()` 로 **최종 유효 권한을 서버가 다시 계산**한다. 클라이언트가
  판정식을 흉내 내면 그 순간 계산이 두 벌이 된다.
- 시각 품질(레이아웃·간격·칩 스타일)은 **전체 완료 후 조정**한다(사용자 지시 2026-09-10).

**다국어는 처음부터 셋 다.** 권한 키의 라벨·설명, 부여/차단/회수 문구, 사유 입력, 만료 표시,
빈 상태를 `ko`/`ja`/`en` 로 함께 만든다(CLAUDE.md §2). 라벨은 기존
`admin.users.console.keys` 네임스페이스를 확장한다.

---

## 8. 이행 단계

| 단계 | 내용 | 권한이 바뀌는가 |
| --- | --- | --- |
| ~~**1. 설계 문서**~~ | 완료 2026-09-10 | 아니오 |
| ~~**2. 토대**~~ | 완료 2026-09-10 — 레지스트리 · 서버 리졸버 · `has_capability` · `capability_roles` · 세션 적재 · 일치 테스트 | **아니오** |
| ~~**3. 관리 UI**~~ | 완료 2026-09-10 — `/admin/users/[id]` 권한 카드(부여·차단·유효 권한) + i18n 3개 국어 | 아니오 |
| ~~**4. 사이드바**~~ | 완료 2026-09-10 — `NavigationItem.capability` 배선 + 필터, `user.manage` 첫 적용 | 메뉴 노출만 |
| **5. 기능 전환** | ~~사용자 관리~~ ~~채용~~ → 설정 → 급여 → … **한 번에 하나씩** | 예 |

2단계는 **순수 배선**이다. 기존 술어(`canReadJobApplications` 등)는 레지스트리를 부르는 얇은
껍데기가 되고, 호출부는 한 줄도 바뀌지 않으며, 판정 결과도 같다.

5단계에서만 실제 권한이 움직인다. 기능마다 그 기능의 현재 게이트를 읽고, 바뀌는 사람을 확인하고,
결정 로그에 남긴다. **일괄 전환하지 않는다** — 추측으로 옮기면 「필요한 사람이 못 쓰게 되는」
방향으로 실패한다.

---

## 9. 흡수 대상 — 기존 개인 단위 장치 3종

`attendance_payroll_admin` · `leave_approver_role` · `can_generate_report` 는 각각 컬럼으로 박혀
있고 감사 기록이 없다. 모두 사용자가 0명이므로 **지금이면 비용 없이 흡수할 수 있다.**

다만 5단계(기능 전환)에 포함시키고, 토대 단계에서는 건드리지 않는다. 이 컬럼들은 RLS 정책과
서버 코드 여러 곳이 참조하고 있어 개별 확인이 필요하다.

---

## 10. 결정된 사항 (2026-09-10 사용자 답변)

1. **채용 권한의 `roles` = `["owner", "senior_managing_director"]`.** 대표·전무는 지정 없이도 본다.
   지정 목록이 비면 아무도 못 보게 되고, 담당자를 지정할 사람도 그 화면을 봐야 할 때가 있다.
2. **개발자는 모든 권한을 갖는다.** 모든 키가 `platformBypass: true` 이고, **테스트가 전 키에 대해
   이것을 검증한다** — 새 키를 추가하며 빠뜨리면 그 자리에서 걸린다. 차단으로도 개발자를 잠글 수
   없다(마지막 복구 수단).
   김현준 계정은 `owner` 멤버십과 **별개로** 활성 플랫폼 관리자(`developer_super_admin`)이고,
   세션 역할이 개발자로 잡힌다(`platformAdmin?.role ?? membership?.role`).
3. **현재 `office_admin` 1명(정지훈)은 실제 채용 담당**이라 역할 기반 접근에서 **개인 지정으로
   옮겼다**(`job_application.read` + `.triage`, 무기한). 넣고 빼는 것은 `/admin/users/[id]` 권한
   카드에서 사용자가 직접 한다.
4. **읽기/쓰기를 나눴다(실무 기준).**
   - 담당자에게는 **열람 + 심사**가 한 세트다 — 훑고 분류하는 것이 이 콘솔이 하는 일 전부다.
   - **삭제는 기본으로 주지 않는다.** 하드 삭제이고 이력서 파일까지 지운다 — 되돌릴 수 없는
     개인정보 파기다. 필요하면 개인 부여로 연다.

### 전환 후 실측 (2026-09-10)

| 사람 | 역할 | 열람 | 심사 | 삭제 |
| --- | --- | --- | --- | --- |
| 김현준 | 개발자(+owner) | ✓ | ✓ | ✓ |
| 정지훈 | 사무직 + 개인 지정 | ✓ | ✓ | **✗** |
| 테스트 계정 | 파트타임 | ✗ | ✗ | ✗ |

## 11. 남은 미결

- 기존 개인 단위 장치 3종(`attendance_payroll_admin` · `leave_approver_role` ·
  `can_generate_report` 컬럼)의 흡수 — §9. 셋 다 보유자 0명이라 아직 비용이 없다.
- 나머지 기능(설정·급여·근태·수리·발주 등)의 전환 — 각 기능의 실제 게이트를 읽고 하나씩.
  급하지 않다: 옮기지 않은 기능은 예전 방식으로 정상 동작한다.
- 권한 카드의 시각 품질 조정(현재는 기능만 넣은 상태 — 사용자 지시로 전체 완료 후 일괄).

### 완료됨

- ~~`manage_users` 레거시 플래그 제거와 위임 UI 이전~~ — 2026-09-10 (`202609100003`).
  위임이 `user.manage` 개인 부여로 바뀌어 **부여자·사유·회수가 남는다.** 지우기 전 확인:
  보유자 0명 · 참조 정책 0개 · 앱 코드 읽기·쓰기 전부 제거.

## 11-1. 감사에서 나온 결함 4건 (2026-09-10, 전부 수정)

구현 직후 스스로 감사한 결과다. **네 건 모두 「판정이 두 벌」이라는 같은 뿌리**였다.

### ① 차단(deny) 행이 권한을 **주고** 있었다 — 가장 심각

`hasPermissionOverride()` 가 `effect` 를 보지 않고 「그 키의 활성 행이 있는가」만 봤다. 그래서
**차단 행이 부여로 읽혔다** — 「빼라」가 「줘라」로 뒤집히는, 가능한 실패 중 가장 나쁜 것이다.
영향 범위는 이 함수를 쓰는 4곳: 사용자 관리(2) · 수리 상태 변경 · 발주 처리 · 업무일지 생성.

### ② 무기한 부여가 인식되지 않았다 — **당시 실제로 깨져 있었다**

같은 함수가 `gt("expires_at", now)` 로 걸러서 **NULL(무기한) 행이 제외**됐다. 무기한을 허용한
뒤로 그 필터는 곧 「상시 지정은 없는 것으로 친다」다. 사용자 관리 위임이 무기한으로 저장되므로,
**위임을 해도 화면이 열리지 않는** 상태였다. `listMemberOverrides` 에서 같은 실수를 이미 한 번
고쳤는데 이 함수에는 반영하지 않았다.

### ③ 앱과 SQL 이 서로 다른 답을 냈다 — 실측으로 확인

`has_capability()` 가 **키별 정책을 몰랐다.** `individualGrant`/`individualDeny`/`platformBypass`
는 TypeScript 레지스트리에만 있었고 SQL 은 부여·차단 행을 무조건 적용했다.

실측: `individualDeny: false` 인 `job_application.read` 에 차단 행을 넣자 **SQL 은 `false`,
앱은 `true`** 를 냈다. 서버 검증이 그런 행을 만들지 못하게 막지만, 이중 방어가 성립하지 않는다.

수정: 키별 정책을 `capability_policies` 표로 내리고(레지스트리에서 생성) `has_capability` 가
그것을 읽는다. 재확인: 차단 행 → 앱·SQL 모두 `true`(무시), 개인 부여 불가 키의 부여 행 →
모두 `false`.

### ④ 통과(bypass)가 꺼진 키에서 개발자가 거부됐다

앱이 `return policy.platformBypass` 라 통과가 꺼지면 **개인 부여를 갖고도 즉시 거부**했다.
SQL 은 일반 규칙으로 흘려보내고 있어 또 갈렸다. 앱을 SQL 쪽으로 맞췄다(통과가 켜져 있으면 허용,
꺼져 있으면 흘려보낸다). 현재 모든 키가 통과 `true` 라 눈에 보이는 차이는 없었고, 회귀 가드를
테스트로 남겼다.

### 함께 고친 것 — 플랫폼 전용 계정의 빈 권한

조직 멤버십이 없는 계정(플랫폼 전용)은 유효 권한이 `[]` 였다. 사이드바가 그 목록으로 메뉴를
거르므로 **개발자에게 메뉴가 사라진다.** 멤버십이 없어도 역할 기준으로 계산하게 했다.

**교훈.** 「같은 규칙을 두 언어로 구현한다」는 설계는 그 자체가 드리프트 원인이다. 규칙의 **입력
(역할표·키별 정책)을 한 곳에서 생성**해 양쪽에 내리는 것까지 해야 실제로 하나가 된다. 역할표는
처음부터 그렇게 했는데 키별 정책은 빠뜨렸다.

## 11-2. 회귀 한 건 (2026-09-11) — 개인 부여가 통째로 무시됐다

**증상.** 관리 화면에서는 「최종 유효 권한」에 채용 지원서 열람이 떠 있는데, **그 사람 계정으로
로그인하면 사이드바에 채용 메뉴가 없다.**

**원인.** 세션 워터폴을 접으면서(2026-09-11 성능 개선) 개인 부여·차단 조회를 **service-role 에서
사용자 클라이언트로 옮겼다.** `membership_permission_overrides` 에는 **RLS 정책이 하나도 없고**
RLS 는 켜져 있다 — `authenticated` 로 읽으면 오류가 아니라 **조용히 0행**이 온다. 그래서 역할로
받은 권한만 남고 개인 부여가 전부 사라졌다.

관리 화면은 멀쩡해 보였다. 그쪽은 `resolveCapabilities`(service-role)를 쓰기 때문이다 — **두 경로가
서로 다른 답을 내는데 한쪽만 보고 있었다.**

**수정.** 세션도 service-role 로 읽는다. 「내 세션의 내 권한을 계산한다」는 용도에 한정되고, 부여
자체는 서버 액션이 권한을 확인한 뒤에만 쓴다. (2026-10-19 부터 이 읽기는 프로필 · 멤버십과 함께
`getIdentityRows()` — `src/lib/identity-rows.ts` — 한 배치에서 온보딩 판정과 같이 쓴다.)

**남은 불일치.** `27-permission-override-workflow.md` 는 이 표에 「owner/platform-admin 읽기 전용
RLS」가 있다고 적고 있으나 **정책이 존재하지 않는다.** 지금은 service-role 로만 읽으므로 동작에는
문제가 없다. 정책을 붙이든 문서를 고치든 정리가 필요하다.

**교훈.** RLS 가 켜져 있고 정책이 없는 표는 **읽기가 실패하지 않고 빈 결과를 준다.** 권한 계산에서
빈 결과는 「권한 없음」으로 조용히 흘러간다. 클라이언트를 바꿀 때 그 표의 정책을 함께 확인해야 한다.

## 12. 현재 적용 범위 (2026-09-10 실측)

```txt
RLS 정책 146개
├─ 권한 키 사용         1개   ← 채용
├─ 역할 배열 직접      30개   ← 아직 옛 방식
└─ 나머지             115개   (조직 격리 등, 권한 판정과 무관)
```

전환 완료: **채용**(`job_application.*`) · **사용자 관리**(`user.manage`).
레지스트리에 있는 나머지 키 4개(`order_processor` 등)는 이름만 등록된 상태이고 실제 판정은
아직 각 기능의 옛 경로다 — 그 기능을 만질 때 옮긴다.

**구조는 끝났다.** 앞으로 새 기능은 키 하나를 추가하면 되고, 역할로 묶든 개인 지정하든 같은
장치를 쓴다. 남은 것은 기존 기능을 하나씩 옮기는 일이며, 옮기지 않아도 동작에는 문제가 없다.
