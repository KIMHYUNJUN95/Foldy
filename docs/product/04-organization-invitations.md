# Organization and Invitations

## Requirement

Foldy must support company/workspace separation from the beginning.

The first workspace will be the company's internal workspace, but the product should be designed so other companies can use Foldy later without data mixing.

## Current User Scale

Initial internal usage:

- About 10 employees
- More than 40 part-time staff
- More users expected over time

## Recommended Model

Use a multi-tenant organization model.

Core entities:

```txt
Organization
User
Membership
Role
Invitation
Invite Code
Property
Room
```

## Organization

An organization represents one company/customer.

Examples:

- Our company
- Future hotel customer A
- Future accommodation operator B

Every important record should belong to an organization.

Examples:

- Properties
- Rooms
- Tasks
- Lost items
- Maintenance requests
- Cleaning records
- Announcements
- Inventory records
- Orders

## Membership

A user can belong to one or more organizations.

Membership stores:

- User
- Organization
- Role
- Status
- Joined date

Status candidates:

- Invited
- Active
- Suspended
- Removed

## User Profile

Each user should have a personal profile connected to their account.

Profile fields may include:

- Name
- Date of birth
- Phone number
- Profile photo
- Preferred language

All organization members should be able to see the user directory and call other members by phone button.

## Signup Required Information

Required during signup:

- Authentication method (`Google` or `email + password`)
- Name
- Date of birth
- Phone number
- Preferred language
- Team invite code

Optional after signup:

- Profile photo

## Social Login Profile Completion

Google login is supported alongside standard email signup/login (`email + password`).

Email magic-link is no longer part of the planned authentication model.

**Important product rule: Google login is only an authentication method.**

Google account profile data must NOT be trusted as final operational profile data and must NOT be auto-prefilled into required fields. Reason: many staff are international students, working-holiday workers, or non-Japanese residents whose Google profiles may reflect old countries, old phone numbers, or non-operational name formats. Operational data quality is more important than convenience.

After any Google login:

- The user's email is confirmed from Google.
- The user must still manually enter and confirm all required profile fields.
- No Google profile data (name, phone, profile image) is auto-applied.
- The user cannot enter the app until onboarding is complete.

Required onboarding fields before app access (applies equally to email and Google login):

- Name (entered manually)
- Date of birth (entered manually)
- Phone number (entered manually; stored in international format)
- Preferred language (selected manually)
- Valid team invite code (to join an organization)

Important onboarding rules:

- Authentication success alone does not grant product access.
- Users without a valid team invite code can authenticate, but they cannot use any Foldy feature.
- Incomplete accounts must always return to `continue onboarding`, not to the normal app.
- The same onboarding rules apply to both Google and email signup.

Implementation note (2026-06-03):

- Google OAuth is wired via `supabase.auth.signInWithOAuth({ provider: "google" })`.
- After Google callback, `getOnboardingState()` determines if profile is complete.
- If profile is missing → routed to `/onboarding` profile step.
- If profile complete but no membership → routed to `/onboarding` invite-code step.
- `/onboarding` renders by device surface (2026-10-01): **desktop** → one-screen form
  (`desktop-onboarding.tsx`), **mobile / unknown** → the step wizard (`onboarding-wizard.tsx`). Same server
  actions and validation; the two UIs share no components. See `05-admin-web-ia.md` → 「대시보드 전용 가입 화면」.
- If membership is suspended → routed to the blocked state on `/auth/login` with a logout action.
- If membership is removed → routed to the blocked state on `/auth/login` by default; the user may explicitly enter a re-join flow with another valid invite code.
- If the authenticated account is disabled at the Auth level → routed to the blocked state on `/auth/login`.
- Google login button is live on `/auth/login`; `prompt: "select_account"` forces account selection on each login attempt.
- The profile-setup wizard now exposes an explicit return-to-login action on every step so users who
  entered with the wrong Google/email account can leave onboarding immediately. The action signs the
  user out and returns to `/auth/login` while preserving the chosen language.

## Email Signup / Login

Standard email signup/login is also required.

Rules:

- Email signup uses `email + password`
- Email verification is required before onboarding is considered complete
- Password reset uses reset-email flow
- Password policy:
  - minimum **10** characters (2026-08-03 강화 — `MIN_PASSWORD_LENGTH` in `src/app/auth/actions.ts`)
  - letter + number required, obvious strings blocked (product names, `password`, email local part …)
  - special character optional
  - 가입 화면은 조건 체크(10자 · 영문 · 숫자) + **비밀번호 확인 칸**(2026-10-09). 서버도 확인 칸이 오면 일치를 본다(`password_mismatch`).
- Login attempts for email/password should be rate-limited

### 가입 → 메일 확인 흐름의 실제 동작 (2026-10-09 점검)

- 「계속하기」를 누르면 Supabase 가 **확인 전 계정**을 먼저 만들고 확인 메일을 보낸다. 메일 링크를 누르기 전에는 로그인되지 않는다.
  직원 등록(프로필 · 조직)은 그 뒤 온보딩에서 끝난다.
- **이미 가입된 이메일인지는 가입 응답으로 알 수 없다** — Supabase 가 새 가입에도, 이미 확인된 주소의 반복 가입에도 오류 없이
  `user = null` 을 돌려준다(실측). 그래서 가입하면 늘 「이메일을 확인해 주세요」 화면이고, 그 화면이
  「메일이 오지 않으면 이미 가입된 이메일일 수 있어요 — 로그인 · 비밀번호 재설정」을 안내한다. (가입 여부를 알려 주려면
  관리자 권한 조회가 필요한데, 누구나 가입 여부를 캐볼 수 있게 되므로 하지 않는다.)
- **메일 다시 보내기**: 확인 화면의 버튼(`resendSignupConfirmation` → `auth.resend({ type: "signup" })`). Supabase 가 같은 주소에
  60초 안에 다시 보내지 못하게 하므로 버튼도 60초 잠긴다. 예전에는 가입을 다시 하는 수밖에 없어 발송 한도만 빨리 찼다.
- **확인 안 된 오래된 가입 정리**: 메일 확인도 로그인도 한 번 없는 이메일 가입은 **7일 뒤 자동 삭제**(Supabase Auth 사용자 행만,
  프로필이 있으면 건너뜀). 매일 도는 `/api/tasks/reminders` 크론에 붙어 있다(`src/lib/auth/unconfirmed-signup-cleanup.ts`, 판정
  `unconfirmed-signup-rule.ts` + 테스트). 2026-10-09 사용자 승인(삭제 정책 예외 아님 — 쓰지 않은 인증 행 정리).
- **메일 발송 한도**: Supabase 기본 메일 서버는 시간당 몇 통뿐이라 여럿이 같은 날 가입하면 막힌다(「짧은 시간에 메일을 너무 많이
  보냈어요」). 외부 SMTP 연결이 출시 전 필수 — `docs/planning/17-app-release-plan.md` H14.
  - **왜 Supabase 기본 메일로는 안 되나**: ① 발송 수가 시간당 몇 통이고 늘릴 수 없다 ② Supabase 주소로 나가 스팸함에 가기 쉽고
    Foldy · 우리 도메인 이름으로 보낼 수 없다 ③ Supabase 스스로 테스트용이라고 밝힌다(운영은 외부 SMTP 권장)
    ④ 정책상 조직 팀원 주소로만 보내도록 제한될 수 있다(2026-10-09 기준 이 프로젝트는 새 주소로도 발송됨).
  - **외부 SMTP**: Supabase 는 그대로, 메일만 외부 서비스로. 대시보드 설정만 바꾸면 되고 코드는 그대로다. 직원 가입 · 재설정
    규모면 무료 범위(예: Resend 무료 하루 100통 · 월 3,000통). 보내는 주소 `no-reply@우리도메인` 은 도메인이 있어야 하므로
    **도메인 작업(17번 A4 · C1) 때 함께 연결한다(사용자 결정 2026-10-09).** 그 전까지는 기본 메일로 테스트 — 하루에 가입 테스트를
    여러 번 하면 한도에 걸릴 수 있다.

## Account Identity Rules

- Same email address should map to one Foldy account
- Google login and email/password login should attach to the same account when the email matches
- Phone number is an account-level unique value
- If an account exists but onboarding is incomplete, re-signup should resume the same account instead of creating a duplicate

Implementation note:

- Same-email Google/email account attachment currently depends on **Supabase Auth automatic identity linking + confirmed email settings**. Foldy app code explicitly handles duplicate/incomplete-account resume on the email-signup path, but Google sign-in itself relies on the Supabase-side linking policy.
- Phone number uniqueness remains account-level. If onboarding hits the unique `profiles.phone_number`
  rule, the user is returned to the phone-number step and told to either enter a different number or
  return to login and use the existing account that already owns that number.

## Team Invite Codes

Invite codes are the gate that turns an authenticated account into an active organization member.

Current business rules:

- Team invite code determines:
  - target organization
  - onboarding role category
- Invite codes are multi-use by default
- Normal staff codes:
  - valid for 3 months
  - maximum 100 joins
- Owner invite code:
  - one-time use only
- Invite code validation succeeds first, then the app shows the resolved organization + role before final membership activation
- If a signup is retried for an email that already has an incomplete Foldy account, the app sends the user to sign in and continue that existing onboarding flow instead of creating a duplicate account

Current onboarding role categories:

- Part-time Staff
- Office Staff
- Field Staff
- Part-time Staff (Manager)
- Owner

Important:

- These are the **signup/invite categories** that users see during onboarding.
- Final internal role/permission mapping may still be normalized during implementation, but the invite-code UX must expose these five business-facing categories.

## Organization Creation

Organization creation is not open to every public signup.

Rules:

- A new organization can be created only through an allowed organization-creation path
- The user who creates the first organization becomes that organization's first owner
- General public signups cannot create arbitrary organizations

Current temporary operating rule:

- Until invite-code management UI is built in the future admin dashboard, the initial organization / first owner / initial invite codes are bootstrapped manually in the database
- This is operational bootstrap data, not a normal self-service workflow

## Staff Onboarding Options

### Option 1: Email Invitation

Admin invites a user by email.

Good for:

- Employees
- Managers
- Admin users
- Controlled access

Flow:

```txt
Admin enters email
Invitation is created
User receives invitation
User signs up/logs in
User joins organization with assigned role
```

### Option 2: Team Invite Code

Admin creates an invite code for a role, property, or team.

Good for:

- Part-time staff
- Larger onboarding
- Temporary staff

Flow:

```txt
Admin creates team invite code
Staff authenticates
Staff completes required onboarding
Staff enters code
System resolves organization + role
User confirms the result
User joins organization immediately
```

## Invite Code Fields

Invite codes should include:

```txt
id
organization_id
code
name
default_role
expires_at
max_uses
used_count
is_active
created_by_user_id
created_at
updated_at
```

Required settings when creating an invite code (**updated 2026-09-09**):

- Default role category — **the only value an admin must choose**, besides the organization
- Code name, expiration date, maximum uses — **auto-generated**, overridable in the form's collapsed
  "Advanced" section
- Active/inactive status — always starts active; toggled from the list afterwards

폼에서 손으로 채우는 항목이 6개였을 때, 다른 역할로 한 명을 초대하려면 매번 코드 문자열을 새로
지어내야 했다. 그래서 실제 운영에서는 처음 만든 파트타임 코드 하나만 계속 재사용됐고,
어드민 콘솔이 필요한 사람까지 `part_time_staff` 로 가입해 `/admin` 이 열리지 않았다.

Auto-generation rules (`src/lib/invite-code-gen.ts` — 클라이언트 폼과 서버 액션이 공유):

| Field | Generated value |
| --- | --- |
| `code` | `HARU-K7M2QP` — 조직 slug(없으면 이름) 앞 6자 + 랜덤 6자. `0 O 1 I L` 제외 |
| `name` | `사무직 초대 09-09` — 역할 라벨 + 도쿄 기준 생성일 (ko/ja/en) |
| `expires_at` | 도쿄 기준 오늘 + 30일 |
| `max_uses` | 10 |

- 첫 코드는 **서버가** 생성한다 (클라이언트 랜덤은 하이드레이션을 깬다).
- `invite_codes.code` 는 전역 unique — 자동 코드 충돌은 최대 5회 조용히 재시도, 수동 입력 코드
  충돌은 `duplicate_code` 로 알린다.
- 서버 액션의 필수 검증은 조직 + 역할뿐이다. 나머지가 비어 오면 같은 규칙으로 채운다.

UI 세부는 `docs/product/05-admin-web-ia.md` → 사용자 관리 참조.

Example:

```txt
Name: 2026 Spring Part-time
Default role: Part-time Staff
Expires at: 2026-06-30
Max uses: 50
Status: Active
```

Recommended defaults:

- Default role category should be explicit
- Invite codes should be revocable
- Expired codes cannot be used
- Codes that reach max uses cannot be used
- Organization + role should be previewed to the user before final join

Recommended first operating defaults:

- `Owner` code: one-time use
- other role codes: 3 months + 100 uses

### Option 3: Signup Approval

User requests to join an organization and admin approves.

Good for:

- Future public release
- Companies where admin wants full control

## Recommended First Implementation

Use a hybrid approach:

- Google login and email/password login as auth entry methods
- Team invite code as the membership gate
- Manual DB bootstrap for the first organization / first owner / first codes until dashboard tooling exists
- Role is required for every membership

Current recommended setup flow:

```txt
Allowed user enters organization-creation path
User authenticates
User completes onboarding
User creates the first organization
User becomes that organization's first owner
Initial invite codes are prepared manually in DB for now
Employees / field staff / part-time staff authenticate
Users complete onboarding and enter team invite code
Users join the organization immediately
Owner later manages members / roles / code lifecycle from dashboard (when built)
```

Implementation notes (current as of 2026-06-18):

- Email magic-link has been **removed**. Auth methods are email+password and Google OAuth only.
- `/onboarding` profile completion now collects the required operational profile fields — **name, date of birth (`birthDate`), gender (`gender`), phone number, preferred language, and (optionally at this step) invite code**. New/incomplete accounts still go through this onboarding gate. For already-active legacy users, missing `birth_date` and/or `gender` is now completed from `/account` instead of forcing them back through the new-user onboarding intro.
- Invite-code join uses a **verify → preview → confirm** flow: `previewInviteCode` validates the code without consuming it and shows the resolved **organization name + user-facing role category** (the five business-facing categories, mapped from the DB role via `roleToInviteCategory`) before the user commits. Final join is still the atomic `join_organization_with_invite_code` RPC. This matches the rule "validation succeeds first, then the app shows the resolved organization + role before final membership activation."
- The pre-auth language selection persists via the `stayops_locale` cookie and is honored on `/onboarding`, so the chosen locale survives the login → callback → onboarding chain; the completed profile stores `preferred_language`.
- `/onboarding` handles profile completion and invite-code organization joining.
- If the profile is already complete but there is still no membership, `/onboarding` stays in the same redesigned wizard and jumps directly to the invite-code step instead of falling back to a legacy join-only form. That membership-only invite step also exposes an explicit return-to-login action so a stuck test account is not trapped on the page.
- Onboarding is required for all new users regardless of login method. Google users are not exempt.
- `/admin/settings/organization` lets Developer / Super Admin create organizations.
- Organization creation can attach the current Developer / Super Admin user as organization `owner`.
- `/admin/users/invites` lets developers and `manage_users` delegates create invite codes (moved from
  `/admin/settings/invite-codes` on 2026-07-13 — the old path now redirects there; see
  `docs/planning/01-decision-log.md` → 2026-07-13).
- The invite-code default-role picker supports `staff`, `part_time_staff`, `office_admin`, and
  `field_manager` (extended 2026-07-09 — the first implementation only had `staff`/
  `part_time_staff`; `office_admin`/`field_manager` were always defined in `INVITE_CATEGORIES` /
  `inviteCategoryToRole` (`src/config/roles.ts`) but the creation UI never exposed them until now).
  `owner` and `cs_staff` remain deliberately excluded from self-service invite-code creation: `owner`
  needs a separate single-use-code flow that is not built yet, and `cs_staff` has no invite category
  at all (admin-assigned only, by design). Both stay as manual role changes at `/admin/users/[id]`.
- Invite codes can be listed, **copied, activated / deactivated, and deleted** from the `/admin/users/invites` UI.
  - **Copy code** (`InviteCopyButton`, 2026-07-17) copies the code string to the clipboard from each
    invite card's action row (client component, `.ui-btn--sm` secondary style; async Clipboard API with
    an `execCommand` fallback for non-secure contexts). Shows a transient "복사됨 / Copied / コピーしました"
    state (~1.6s), or "복사 실패" on failure. Read-only convenience — no server action, no state change.
    Copy for the label lives in `dictionary.admin.settings.{copyCode,copiedCode,copyFailed}` (ko/ja/en).
  - **Deactivate / Activate** (`deactivateInviteCode` / `activateInviteCode`) toggle `is_active`. Active
    codes show a "Deactivate" button; inactive codes show an "Activate" button — so a deactivated code
    can be turned back on. The row is always kept (usage history preserved). Re-activating does not
    override expiry/max-use limits — those are still checked at join time.
  - **Delete** (`deleteInviteCode`, 2026-07-14) hard-deletes the code row (MVP hard-delete policy),
    org-scoped, behind a `.ovconfirm` inline confirmation. Available for **both active and inactive**
    codes. Members who already joined with the code **keep their memberships** — only the code record
    is removed. Both actions use the same `canManageInvites` gate as creation.
- **Invite conditions/limits** enforced by `validateInviteCode`: **expiry** (`expires_at`), **max uses**
  (`max_uses` vs `used_count`), and **active flag** (`is_active`). The default role a code grants is
  capped at what the issuer may assign.
- Invite code error handling distinguishes: expired, inactive, max-uses exceeded, and invalid/not-found.
- Membership state access control: `active` allows access; `suspended` shows a blocked screen with logout; `removed` shows a blocked screen by default but can move into a re-join flow with another valid invite code; `invited` prompts for invite code.
- Logout is accessible from `/account` and clears the session fully, redirecting to `/auth/login`.
- Phone number is required and validated at both onboarding and account editing (7-15 digits, allows +, spaces, hyphens, parentheses).

Future public release can add:

- Self-serve company signup
- Free plan creation
- Billing
- Automatic organization creation

Initial organization roles:

- Owner
- Senior Managing Director (전무) — added 2026-07-13, fully owner-equivalent; see
  `docs/product/01-user-roles.md` → "Senior Managing Director (전무)"
- Office Admin
- CS Staff
- Field Manager
- Staff
- Part-time Staff

Developer/Super Admin is a platform-level role and should not be treated as a normal organization member role.

## Security Rules

Required:

- Users can only access records within their organization.
- Role permissions must be checked on backend/database level.
- Removed users should lose access immediately.
- Invite codes should expire or be revocable.
- Part-time staff can view guest/reservation information except price/revenue fields.

## Post-Login Routing

Use one account system for both mobile/PWA field screens and admin web screens.

Default routing:

```txt
Developer / Super Admin -> Admin web
Owner -> Admin web
Senior Managing Director (전무) -> Admin web
Office Admin -> Admin web
CS Staff -> Admin web
Field Manager -> Mobile field home
Staff -> Mobile field home
Part-time Staff -> Mobile field home
```

Mode switching:

```txt
Developer / Super Admin: Admin mode + Field mode
Owner: Admin mode + Field mode
Senior Managing Director (전무): Admin mode + Field mode
Office Admin: Admin mode + Field mode
CS Staff: Admin mode + Field mode
Field Manager: Field mode + Admin mode
Staff: Field mode only
Part-time Staff: Field mode only
```

Device-aware behavior:

- Desktop/large screen should prefer admin web for admin-capable roles.
- Phone screen should prefer field home for field-oriented roles.

## Open Questions

- Should invite codes be role-specific? Confirmed for MVP: yes, default role is required.
- Should invite codes be property-specific?
- Should part-time staff require admin approval after using a code?
- Should one user be allowed to belong to multiple organizations?
- Should staff accounts be allowed to use personal email addresses?

## Onboarding Wizard — Desktop Input (2026-09-09)

회원가입 위저드(`src/app/onboarding/onboarding-wizard.tsx`)는 모바일 우선으로 만들어졌지만
**PC 로 가입하는 경로가 실제로 쓰인다.** 데스크톱 입력 수단이 빠져 있어 다음을 보강했다.

### 생년월일 휠 (`Wheel`)

원래는 iOS 손가락 스크롤 전용이었다 — 항목이 클릭되지 않는 `<div>`, 숨겨진 스크롤바, 키보드 진입점
없음. 마우스 휠은 네이티브 스크롤에만 의존했는데 `scroll-snap-mandatory` + 110ms 후 `scrollTop`
보정과 관성 스크롤이 서로 밀어냈다. 이제 네 가지 입력을 명시적으로 받는다.

| 입력 | 동작 |
| --- | --- |
| 마우스 휠 | `wheel` 을 직접 받아 칸 단위 이동 (50px = 1칸, 이벤트당 최대 4칸). React 의 `onWheel` 은 passive 라 `preventDefault` 가 안 먹으므로 **네이티브 리스너**를 쓴다 |
| 클릭 | 항목을 눌러 즉시 선택 |
| 키보드 | ↑↓ 1칸 · PageUp/PageDown 5칸 · Home/End 양끝 · Enter 는 확인 |
| 숫자 타이핑 | `199` → 1990 점프. 연도 87개를 한 칸씩 굴리지 않아도 된다 |

`role="listbox"` / `role="option"` / `aria-activedescendant` 를 붙였고, 컬럼은 `tabIndex=0`
이며 포커스 링은 마스크에 가려지지 않도록 **바깥 래퍼**가 `focus-within:ring` 으로 그린다.
시트를 열면 연도 컬럼에 포커스가 간다. 터치 스크롤은 그대로 네이티브다.

### Enter 로 다음 단계

이름·전화번호·초대코드 입력은 `<form>` 밖의 단독 `<input>` 이라 Enter 가 아무 일도 하지 않았다.
각 입력에 `onKeyDown` 을 붙여 **유효할 때만** 다음으로 넘어간다(초대코드는 검증 실행).

### 뒤로 버튼

"back chevron 없음 — 스와이프 / OS 백이 공통 패턴"이 원래 결정이었으나, PC 에는 엣지 스와이프가
없다. `ProgressHeader` 좌측에 이미 비어 있던 112px 슬롯에 뒤로 버튼을 넣었고 **모바일에도 함께
노출**한다. 동작은 `history.back()` — 위저드가 단계마다 `pushState` 하므로 브라우저 뒤로가기와
완전히 같은 경로를 탄다.

버튼은 **위저드 안에 돌아갈 단계가 있을 때만** 보인다. 히스토리 state 에 `obDepth` 를 함께 실어
판단한다 — 재가입(`initialStep = 5`)처럼 중간에서 시작하는 경우가 있어 step 값만으로는 진입
지점인지 알 수 없고, 깊이 0 에서 뒤로를 누르면 앱 밖으로 나가버린다.

새 i18n 키: `onboarding.steps.backCta` (ko `뒤로` / ja `戻る` / en `Back`).
