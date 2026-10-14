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

Admin user management (`/admin/users`) — 화이트 리디자인(2026-10-14, 시안 Users-PC · UsersGrant-PC · UsersDeact-PC):

- Tabs 「멤버 목록 N · 멤버 초대 N」(shared `.lviews`; invite count = codes usable now) + search (name · email · phone digits) on one line; filters 역할 · 소속 · 상태 below.
- Table: 이름+이메일 (「나」 on yourself) · 역할 · 소속 · 전화 · 상태 · 가입일. No save buttons in rows anymore.
- Clicking a row opens the **right panel** (`?member=<membershipId>`, shared `.panel`). The old profile page `/admin/users/[id]` now redirects there.
- Panel: avatar · name · `역할 · 소속`, trash (delete member → confirm modal) · close. 이메일 / 전화 / 가입. Then 역할 (dropdown) · 소속 (segment of the org's teams) · 상태 (활성 · 비활성).
  - Role and team **save immediately** with a toast. Choosing 비활성 opens a confirm modal (그대로 두기 / 비활성으로 바꾸기) because it blocks sign-in (auth ban). 활성 saves immediately.
  - Office admins only see roles they may assign (`officeAdminAssignableRoles`); the server still enforces it.
- 권한 — one list of switches (owner/전무/developer only; others see a one-line note). Each row says where it comes from: 역할로 받음 · 개인 부여(· 기한) · 개인 차단 · 꺼짐. Rules (server contract unchanged, `27-permission-override-workflow.md`):
  - off → on: grant override; on (from role) → off: deny override (only when the key allows deny and the role isn't deny-immune — otherwise the switch is disabled 「역할로 받음 · 끌 수 없음」).
  - grant/deny override → toggle back: revoke that override.
  - Keys that require an expiry expand the row: 1주 · 1개월 · 3개월 · 날짜 고르기 (shared `AdminDatePicker`) → [M월 D일까지 켜기/끄기]. Expiry = end of that Tokyo day. Reason is left empty (optional since 2026-09-30).
  - Expiry within 7 days and personal blocks are red; everything else grey.
  - Also in the list: 급여 담당 · 연차 결재자 (membership flags), 일일 보고서 — 파트타임 허용 (only for part-time, `profiles.can_generate_report`), 개발자 지정 (developer viewer only). Developer-only keys (`user.manage`) are hidden from non-developers.
- Your own row: no role/status/permission controls (「내 역할 · 권한은 여기서 바꿀 수 없어요.」), no delete.
- Delete member: confirm modal (그대로 두기 / 삭제). Blocked with a message when the member has attendance / cleaning / leave history (deactivate instead).
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
