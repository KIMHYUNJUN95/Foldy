# User Profile and Directory

## Purpose

Foldy needs personal profile management and a company user directory.

Users should be able to manage their own basic information, and all members should be able to see who is registered in the organization.

## My Profile

Each user should be able to view and edit their own profile.

Editable fields:

```txt
name
age
phone_number
profile_photo
preferred_language
```

(Theme preference was removed 2026-06-08 — the app is light-mode-only; dark mode deferred post-launch. The `profiles.theme_preference` DB column remains in schema only and is not used by the app.)

Language selection:

- User selects language during signup.
- User can change language later from My Profile.

Signup required fields:

- Name
- Email or social login
- Language
- Invitation link or invite code
- Phone number

Implementation note:

- Initial profile completion is available at `/onboarding`.
- The current onboarding flow captures name, date of birth, gender, phone number, preferred language, and an optional invite code.
- Phone number stays an account-level unique field. If onboarding submission hits a duplicate number,
  the wizard now returns the user to the phone step and explains that they must either enter a
  different number or go back to login and use the existing account that already owns that number.
- Age and profile photo remain deferred to the later My Profile screen.

Optional after signup:

- Age
- Profile photo

Social login may prefill email, name, and profile photo, but the user can edit profile information.

Theme preference:

- Removed 2026-06-08. The app is light-mode-only for the MVP/internal rollout; dark mode (and the System/Light/Dark preference) is deferred until post-launch. The `profiles.theme_preference` column still exists in the DB but is no longer read or written by the app.

Implementation note:

- `/account` now provides the first editable My Profile screen.
- The current version supports name, date of birth, phone number, language, and gender.
- Existing accounts with missing `birth_date` and/or `gender` are not forced back into onboarding; instead, `/account` shows a gentle completion prompt and lets the user save the missing fields there.
- Mobile `date of birth` input now uses the same full-width field width contract as the other profile inputs, so the native date control does not overflow or render wider than the surrounding form fields on mobile WebKit.
- The page is reachable from the account icon in both admin and mobile shells.
- Age and profile photo are still deferred.

### 계정 화면 — 화이트 리디자인(모바일) (2026-10-15, 시안 Account-Phone)

`/account` 가 모바일 셸로 열릴 때(`?mode=mobile` — 모바일 머리의 프로필 버튼 · 사이드 메뉴, 또는 기본 모드가 모바일인 사람)만
새 화면(`src/components/account/account-mobile.tsx` · `account-white.css`, 접두어 `acw-`). **관리 콘솔(PC) 쪽 탭 화면은 그대로.**

- 위: 이니셜 원 · 이름 · 「조직 · 역할」. 저장됨 / 오류 / 프로필 채우기 안내는 옅은 회색 칸 한 줄.
- 묶음 줄(작은 회색 묶음 이름 + 가는 가로줄, 실제 기능만):
  - **내 정보** — 이름 · 생년월일 · 전화번호 · 성별: 줄을 누르면 공용 `BottomSheet` 에서 그 칸 하나만 고쳐 「저장」. 비어 있으면 빨간 「입력 안 함」.
    **언어**는 바로 바뀌는 3칸(한국어 · 日本語 · EN) — 누르면 곧바로 저장되고 화면이 그 언어로 다시 그려진다.
    저장은 기존 `updateAccountProfile` 그대로 — 이 액션이 이름 · 전화 · 성별 · 언어를 한꺼번에 받으므로 나머지 값은 숨은 칸으로 함께 보낸다.
  - **조직** — 조직 이름 · 역할(읽기만).
  - **앱** — 하단 탭 편집(지금 탭 이름들) → 셸의 가운데 편집 버튼이 여는 시트를 그대로 연다(`.tabbar__fab` 를 누름 — 셸 코드를 건드리지 않으려는 연결).
  - **게시판** — 차단한 사용자 N명 · 내가 신고한 글 · 댓글 N개 → 시트 안에 기존 `BlockedUsersList` · `MyReportsList`(`bare` — 상자 · 제목 없이).
  - **도움** — 제안함 · 버그 신고 · 이용약관 · 개인정보 처리방침 · 고객지원(시안은 약관 두 개를 한 줄로 묶었지만 앱 심사용 고객지원까지 세 줄로 나눔).
- 아래: 회색 「로그아웃」(기존 `signOut`) · 작은 빨간 「계정 삭제」(기존 `DeleteAccountSheet` 확인 시트) · 버전(앱이면 「Foldy 1.0.0 (24)」, 웹은 「Foldy · 웹」).
- 폴드 · 태블릿: 가운데 540px 한 칼럼. 움직임: 묶음이 차례로 떠오름 · 줄 누름 · 언어 손잡이 미끄러짐 · 저장 중 도는 표시. 동작 줄이기면 끔.
- 문구 `accountProfile.white.*`(ko/ja/en) + 기존 `onboarding` · `common` · `legal` 문구.

Possible future fields:

```txt
nickname
emergency_contact
department/team
memo
```

## User Directory

All registered organization members should be visible in a user directory.

Purpose:

- See who has joined
- Find staff contact information
- Call another staff member quickly
- Check role

Directory should show:

```txt
name
role
phone_number
profile_photo
status
```

Implementation notes:

Mobile directory (`/mobile/directory`) — 화이트 리디자인(2026-10-14, 시안 Dir-Phone · Dir-Fold · Dir-Tablet):

- Available in the mobile shell as the directory tab (bottom tab or side menu). Client view: `src/components/directory/directory-view.tsx` (`drw-*` in `directory.css`).
- Shows all active/invited org members, **grouped by role**: 관리 · 사무실(개발자 · 대표 · 전무 · 오피스 관리자 · CS) / 현장(현장 관리자 · 직원) / 파트타임, each group with a head count. Inside a group: role priority, then name.
- Head: 「직원 목록」 + `조직 · N명`, search box (name · role · phone digits, 2+ digits).
- Row: avatar initial · name (+ 「나」) · `역할 · 번호`. The call button is a `tel:` link (press: scale + light haptic).
- **No call button** for members without a phone number (`역할 · 전화번호 없음`) and for yourself — a greyed-out dead button read as broken.
- Fold (≥ 600px): one line per person — name · role | number | call. (The old 2-column cards wrapped the number.)
- Tablet landscape: list 380px + right profile pane drawn by the screen itself with `useIsTablet()` (no detail URL). Pane: avatar · name · `역할 · 소속`, [전화] [번호 복사 → ✓ 복사됨], then 전화 / 역할 / 소속 / 가입. Before picking: a hint line.
- Motion: rows rise in order, call press, check draw on 복사됨, pane blur → sharp. Off under reduced motion.
- Uses service-role query to load memberships, profiles and teams (bypasses RLS for directory visibility).
- **HIG 다듬기 2차 (2026-10-20, 시안 A2Dir-* · 지금 A2DirNow-* 나란히)** — 기능 · 배치는 그대로, `directory.css` 끝 블록만:
  - 줄 사이 선: 화면 끝(0)부터 긋던 것 → **글자 시작점 52부터**(이니셜 40 + 간격 12, 공용 구분선 규칙 · 태블릿은 줄 안쪽 여백 10 을 더해 62). 묶음 첫 줄 · 고른 줄 위아래는 선 없음.
  - 묶음 제목 12/600 회색 → **17/600 먹색 · 높이 44**, 인원수 15. 이름 15/600 → 16/500.
  - 「나」: 옅은 보라 상자 11 → **상자 없는 보라 글자 13**(색 알약 금지).
  - 검색 「✕」 누르는 자리 44(보이는 32) · 돋보기 17. 입력 글자 16 그대로(iOS 확대 방지).
  - 「조직 · N명」 · 빈 화면 · 폴드 번호 15. 태블릿 프로필: 역할 줄 15 · 버튼 48 → 50 · 정보 줄 이름 15 / 값 16 · 안내 15.

Admin user management (`/admin/users`) — 화이트 리디자인(2026-10-14, 시안 Users-PC · UsersGrant-PC · UsersDeact-PC):

- Tabs 「멤버 목록 N · 멤버 초대 N」(shared `.lviews`; invite count = codes usable now) + search (name · email · phone digits) on one line; filters 역할 · 소속 · 상태 below.
- Table: 이름+이메일 (「나」 on yourself) · 역할 · 소속 · 전화 · 상태 · 가입일. No save buttons in rows anymore.
- Clicking a row opens the **right panel** (`?member=<membershipId>`, shared `.panel`). The old profile page `/admin/users/[id]` now redirects there.
- Panel: avatar · name · `역할 · 소속`, trash (delete member → confirm modal) · close. 이메일 / 전화 / 가입. Then 역할 (dropdown) · 소속 (segment of the org's teams) · 상태 (활성 · 비활성).
  - Role and team **save immediately** with a toast. Choosing 비활성 opens a confirm modal (그대로 두기 / 비활성으로 바꾸기) because it blocks sign-in (auth ban — only when no other org keeps an active membership, see below). 활성 saves immediately.
  - Office admins only see roles they may assign (`officeAdminAssignableRoles`); the server still enforces it.
- 권한 — one list of switches (owner/전무/developer only; others see a one-line note). Each row says where it comes from: 역할로 받음 · 개인 부여(· 기한) · 개인 차단 · 꺼짐. Rules (server contract unchanged, `27-permission-override-workflow.md`):
  - off → on: grant override; on (from role) → off: deny override (only when the key allows deny and the role isn't deny-immune — otherwise the switch is disabled 「역할로 받음 · 끌 수 없음」).
  - grant/deny override → toggle back: revoke that override.
  - Keys that ask for an expiry (`asksExpiry`) expand the row: **무기한** · 1주 · 1개월 · 3개월 · 날짜 고르기 (shared `AdminDatePicker`) → [무기한으로 켜기/끄기] or [M월 D일까지 켜기/끄기]. Expiry = end of that Tokyo day; 무기한 = no `expires_at` (2026-10-20 사용자 결정, `27-permission-override-workflow.md`). Default chip stays 1개월. Reason is left empty (optional since 2026-09-30).
  - Expiry within 7 days and personal blocks are red; everything else grey.
  - **최근 변경(2026-10-20 권한 정리 ④ A)** — 패널 맨 아래(모바일 상세도 맨 아래)에 최근 10개: 「역할 직원 → CS 직원」 · 「급여 담당 켬」 ·
    「주문 처리 개인 부여 · 무기한」 · 「비활성 · 개인 지정 2개 회수」 + 「10/20 12:15 · 누가」. 기록은 기존 `audit_logs`(target_type `membership`,
    `src/lib/user-audit.ts`), 글은 보는 사람 언어로 `member-history.ts` 가 만든다. 사용자 관리의 모든 변경(역할 · 상태 · 소속 · 플래그 · 개발자 지정 ·
    개인 부여/차단/회수 · 삭제)과 초대코드(만들기 · 끄기/켜기 · 삭제, target_type `invite_code` — 화면엔 아직 없음)가 남는다. 기록 실패는 본 동작을 되돌리지 않는다.
  - **비활성 · 삭제 시 개인 지정 자동 회수(2026-10-20 권한 정리 ④ B)** — 상태를 활성이 아닌 것으로 바꾸거나 삭제하면 그 사람의 이 조직 개인 부여 · 차단을
    전부 회수한다(`revokeAllMemberOverrides`, 기록 남김). 다시 활성으로 돌려도 살아나지 않는다 — 필요한 것만 다시 켠다. 역할 변경 때는 그대로 둔다.
    비활성 확인 창 문구에 「개인 부여 · 차단은 회수돼요」.
  - Role-only feature gates (2026-10-20 권한 정리 ③ — 공지 작성, 청소 기록 보기, 컴플레인, 린넨, 요청 삭제, 버그 검토, 게시판 관리 등) also appear
    when the member's role has them, as 「역할로 받음 · 끌 수 없음」 — so the list shows what the person can actually do. They cannot be granted or blocked individually yet.
  - Also in the list: 급여 담당 · 연차 결재자 (membership flags), 일일 보고서 — 파트타임 허용 (only for part-time, `profiles.can_generate_report`), 개발자 지정 (developer viewer only). Developer-only keys (`user.manage`) are hidden from non-developers.
- Your own row: no role/status/permission controls (「내 역할 · 권한은 여기서 바꿀 수 없어요.」), no delete.
- Delete member: confirm modal (그대로 두기 / 삭제). Blocked with a message when the member has attendance / cleaning / leave history (deactivate instead).
- **보호 대상 · 마지막 대표 · 삭제/비활성 범위 (2026-10-19)** — 판정은 순수 함수 `src/lib/user-management-guard.ts`, 서버 액션(`src/actions/users.ts`)이 최종 판단. 회귀 테스트 `src/lib/__tests__/user-management-guard.test.ts`.
  - 대상이 **owner · 전무**면 역할 · 소속 · 상태 · 권한 · 플래그 · 삭제 등 패널의 모든 변경은 **그 조직의 owner · 전무 또는 개발자만**. 대상이 **개발자**(`platform_admins` 활성)면 **개발자만**. `user.manage` 위임만 받은 사람은 불가(`protected_member`). 패널은 그런 대상에 컨트롤 · 휴지통을 숨기고 한 줄 안내(「대표 · 전무 계정은 …」 / 「개발자 계정은 개발자만 …」)를 보여 준다.
  - 역할 변경의 「줄 수 있는 역할」(`officeAdminAssignableRoles` 밖)도 **대상 조직의** owner · 전무인지로 판정한다(세션 역할이 다른 조직 것일 수 있다).
  - **마지막 활성 owner** 는 owner 가 아닌 역할로 바꾸기 · 비활성 · 삭제가 막힌다(`last_owner`). 패널은 역할 드롭다운 · 「비활성」 · 휴지통을 막고 안내 문구를 띄운다. 전무는 owner 수에 세지 않는다.
  - **삭제**는 이 조직 멤버십만 지운다. 그 사람에게 **다른 조직 멤버십(상태 무관)** 이 있으면 profile · 로그인 계정은 남긴다. 다른 조직 멤버십이 없을 때만 계정 전체(멤버십 → profile → auth) 삭제. 활동 기록 검사(근태 · 청소 · 연차)는 예전처럼 조직 무관. **이 조직에 신분 서류(재류카드 · 마이넘버 카드 앞면)가 있으면 삭제 대신 비활성**(`has_id_documents`, 2026-10-23 — 퇴사 후 3년 보관, `41-residence-card-workflow.md` §6).
  - **비활성(auth ban)** 기준은 「바뀐 뒤 어느 조직에도 활성 멤버십이 없으면 로그인 차단」 하나. 다른 조직에 활성 멤버십이 있으면 이 조직 멤버십 상태만 바뀌고 로그인은 막지 않는다. 활성으로 바꾸면 항상 차단 해제. 확인 창 문구도 그 경우 「이 조직에서만 …」으로 바뀐다.
- Motion: rows rise in order, switch knob slide, expiry row unfolds, button press. Off under reduced motion.
- Code: `src/components/admin/users/users-console.tsx` + `users-white.css` (`usw-*`). Scope guard: the list is org-scoped; the panel only opens for a membership in that list.

Invite codes (`/admin/users/invites`) — same redesign (시안 Invite-PC):

- Left: 「새 초대코드」 — 조직 · 역할 (label-in-border fields), then the auto-filled summary (코드 + regenerate · 이름 · 만료일 (N일) · 최대 사용 횟수), 「세부 설정 바꾸기」 opens the editable fields, [초대코드 만들기].
- Right: table 코드 · 이름 · 역할 · 사용 (purple bar, grey when ended) · 기한, state = 「M월 D일까지」 / 꺼 둠 / 다 씀 / 「M월 D일 만료」(year shown when not this year). Ended codes are grey rows.
- Row icons with tooltips: 코드 복사 (→ ✓ 복사됨 for 1.6s) · 코드 끄기 / 다시 켜기 · 코드 삭제 (confirm modal 그대로 두기 / 삭제; joined members stay).

## Phone Action

Users should be able to tap a phone button to call another user.

Mobile/PWA behavior:

```txt
tel:{phone_number}
```

## Visibility

Confirmed:

- Organization members can see other organization members.
- Members can see phone numbers for calling.

Open privacy questions:

- Should age be visible to everyone or only editable in My Profile?
- Should phone number be required?
- Should deactivated users appear in the directory?

## Admin Management

Admin-capable roles should be able to:

- View all users
- Search users
- Filter by role/status
- Change role
- Deactivate user

Regular users should not be able to change another user's role or status.

## 모바일 사용자 관리 (2026-10-20)

시안 「사용자 관리 · 모바일 시안」 https://claude.ai/artifact/UsmRsgn8tB5DGr4tDwaX7E (보드 25, 스킬 ui-ux-pro-max · apple-hig ·
emil-design-eng · frontend-design). 대시보드 `/admin/users`(멤버 · 패널 · 멤버 초대)의 모바일판이다. **새 권한도, 새 서버 판정도 없다.**

| 무엇 | 어디 |
| --- | --- |
| 입장 | 대시보드와 같은 문 — 개발자 · 대표 · 전무(역할, 2026-10-20)이거나 `user.manage` 개인 부여(`actorCanOpenUserManagement`, `src/app/mobile/users/gate.ts`). 아니면 `/mobile` 로. 메뉴 「사용자」(사이드 메뉴 · 레일 · 사이드바 · 하단 탭 후보)도 같은 키로만 보인다(`src/config/navigation.ts`) |
| 데이터 | `src/lib/user-management-data.ts`(`loadUserDirectory` · `loadMemberPanel` · `loadUsableInviteCount`) — 대시보드 페이지에서 빼서 둘이 같이 쓴다 |
| 멤버 액션 | `src/actions/users.ts` 그대로(역할 · 소속 · 상태 · 권한 · 플래그 · 개발자 지정 · 삭제). 바꾸면 `/admin/users` · `/mobile/users` 둘 다 다시 그린다 |
| 초대코드 액션 | 본체 `src/lib/invite-codes-server.ts`(만들기 · 끄기/켜기 · 삭제 · 줄 수 있는 역할 · 고를 수 있는 조직). 대시보드 폼 액션(`/admin/settings/actions.ts`)은 결과를 주소 쿼리로, 모바일 액션(`src/app/mobile/users/actions.ts`)은 결과를 그대로 돌려준다 |

화면(`src/components/mobile/users/*`, `mobile-users.css`):

- **목록** `/mobile/users` — 큰 제목 34 · 「멤버 · 초대코드」 탭(주소가 다른 두 화면) · 검색(이름 · 이메일 · 전화 2자리 이상) ·
  「역할 · 소속 · 상태 ⌄」 버튼 하나 → 거르기 시트(칩 · 「n명 보기」, 고른 값이 버튼 글자가 됨) · 활성 / 비활성 묶음(17). 줄 = 이름(나) / 역할 · 소속.
  결과가 없으면 「조건에 맞는 멤버가 없어요」 + 조건 지우기.
- **상세** `/mobile/users/{membershipId}` — 이름 · 역할 · 소속, 빨간 휴지통(바꿀 수 있고 마지막 대표가 아닐 때만) → 연락처(전화는 하이픈 표시 · 누르면 걸기)
  → 역할 ›(역할 시트 — 체크, 고르면 바로 저장 + 알림 「되돌리기」 6초 줄) · 소속 · 상태(비활성은 확인 시트, 먹색 버튼 — 다시 켤 수 있어서;
  바꾼 뒤 「되돌리기」) → 권한 스위치(둘째 줄 = 역할로 받음 · 개인 부여 · 기한 · 개인 차단, 7일 안 만료 · 차단은 빨강). 기한을 묻는 권한은 그 줄이
  옅은 보라로 펼쳐져 **무기한** · 1주 · 1개월 · 3개월 · 날짜(공용 날짜 시트, 내일부터). 삭제 확인은 빨간 버튼 + 「되돌릴 수 없어요」.
  나 · 대표/전무 · 개발자 계정은 자물쇠 안내 + 값만.
- **초대코드** `/mobile/users/invites` — 새 초대코드(조직이 여럿일 때만 조직 줄 · 역할 › · 코드 ↻ · 기한 · 횟수, 「세부 설정 바꾸기」로 코드 · 이름 ·
  기한(날짜 시트) · 횟수를 덮어씀) → 코드 목록(고정폭 코드 · 「역할 · 사용 / 최대회 · 기한」 · 복사 → 「✓ 복사됨」 1.5초 · 「⋯」 = 끄기/다시 켜기 · 삭제 → 확인).
  만든 직후에는 목록이 위로 오고 새 코드가 옅은 보라.
- **넓은 화면** — 폴드: 레일 + 셸 가운데 칸. 태블릿 가로: 목록 \| 상세 칸(`SplitList`, `SPLIT_DETAIL_PATTERNS.users`, 고른 줄 옅은 보라 · 테두리 없음).
  초대코드는 상세 주소가 없어 한 단. 시트는 태블릿에서 가운데 카드(공용 BottomSheet).
- **알림** — 한 줄 알약(판매 캘린더와 같은 모양): 역할 · 상태 = 「되돌리기」 + 6초 줄, 스위치 · 소속 = 글만 2초(스위치가 곧 되돌리기), 실패 = 빨간 기운 + 이유 5초
  (낙관적으로 넘어갔던 스위치 · 값은 제자리로).

시안과 다르게 둔 것: 불러오는 중 · 불러오지 못함(시안 ⑮ ⑯)은 앱 공용 로딩(`/mobile/loading.tsx` — 2026-10-21부터 탭바를 그대로 둔 로딩 자리 셸) · 공용 오류 화면을 쓴다. 상세 위 줄은 셸 머리 그대로(시안의 작은 「멤버」 제목 없음).
