# Platform Architecture

## Required Clients

Foldy must support two clients from the beginning:

## 1. Mobile Field App

Primary users:

- On-site staff
- Part-time staff
- Housekeeping staff
- Maintenance staff
- Front desk staff

Primary jobs:

- Check assigned tasks
- Create field reports
- Register lost items
- Submit maintenance requests
- Submit order requests
- Take and upload photos
- Receive push notifications
- View personal/team schedules
- Update task status quickly
- Start and complete cleaning records

Initial recommended implementation:

- PWA/mobile web first
- Native app later if needed

## 2. Admin Web App

Primary users:

- Owner
- Admin
- Office staff
- Managers

Primary jobs:

- View dashboard
- Manage staff
- Manage roles and permissions
- Assign tasks
- Review work status
- View calendar and occupancy
- Review Beds24 reservation data
- Manage announcements
- Manage inventory
- Search and filter records

## Shared Backend

Both clients should use the same backend and database.

Recommended principle:

- Mobile app and admin web app are separate clients.
- Business data lives in one shared backend.
- Permissions decide what each user can see and do.
- One account can access field mode and admin mode depending on role.

## Multi-Tenant Requirement

Foldy must be multi-tenant from the beginning.

Each company/customer should be represented as an organization/workspace. All operational data must belong to an organization so future public release is possible without redesigning the database.

Core rule:

```txt
Every business record needs organization_id.
```

MVP organization creation rule:

```txt
Only Developer/Super Admin can create organizations.
Users join organizations through invitation or invite code.
Self-serve organization signup is deferred until public release planning.
```

Accommodation model:

```txt
Organization
  -> Property
      -> Room / Unit
```

Standalone Airbnb-style properties can use one default room/unit. Hotel-style buildings can contain many rooms.

Role structure:

```txt
Platform:
- Developer/Super Admin

Organization:
- Owner
- Office Admin
- CS Staff
- Field Manager
- Staff
- Part-time Staff
```

## Authentication

Current implementation foundation:

- The initial app uses a temporary mock session provider before Supabase Auth is connected.
- Mock session shape includes `organization`, `user`, `role`, and preferred app mode.
- The provider exists only to stabilize shell, routing, and role-aware UI architecture early.
- Real authentication and authorization must be implemented with Supabase Auth, memberships, platform admins, and RLS.

### 요청당 공통 경로 (2026-10-19)

모든 모바일 · 관리자 화면은 렌더 시작에 `getOnboardingState()` 와 `getCurrentAppSession()` 을 함께 부른다(둘 다 `cache()`).

- 세션은 `getClaims()`(토큰 서명을 서버 안에서 검증)로 사용자 id 를 얻고, 온보딩은 계정 정지(`banned_until`) 확인 때문에
  `getUser()`(Auth 서버 왕복)를 **유지**한다.
- 두 쪽이 쓰는 사용자 행 — `profiles`(하단 탭 · 보고서 권한 열 포함) · `platform_admins` · `memberships`(`invited` 제외,
  조직 임베드) · `membership_permission_overrides` — 은 **`getIdentityRows(userId)`**(`src/lib/identity-rows.ts`,
  service-role, `user_id` 로만 거름) 한 배치에서 요청당 한 번 읽는다. 세션은 가장 먼저 가입한 활성 멤버십,
  온보딩은 가장 최근 가입 순으로 JS 에서 정렬한다(`sortMembershipsByJoinedAt` — 값 없는 행은 맨 뒤).
- `platform_admins` 전체 수(첫 플랫폼 관리자 가져가기)는 `ready` 가 아닌 판정(needs_profile · needs_membership)에서만 센다.
- 결과: 화면당 사용자 확인 쿼리 약 10개(같은 표를 사용자 클라이언트 · service 로 두 번씩) → **4개**, 직렬 단계는
  `getUser` 1 + 배치 1(세션 쪽이 `getClaims` 직후 먼저 시작해 두므로 보통 `getUser` 와 겹친다).
- 같은 렌더 안 반복 조회도 요청 캐시로 접는다: `fetchRoomCatalogRows`(조직 id 키 — `getActiveRoomCatalog*` ·
  `getActiveRoomLabels` · 판매 캘린더 매핑이 공유), `getBoardHiddenFor`. 렌더 밖(cron · 웹훅 · 라우트)에서는 `cache()` 가
  매번 새로 읽는다. 공유되는 결과(행 배열 · Set)는 읽기만 한다.

Required authentication methods:

- Email login
- Google login

Desired authentication method:

- Apple login

Apple login is especially important if the iOS app supports third-party social login.

## Platform Distribution Requirement

The mobile app must be usable on both iOS and Android before public store release.

The admin web app must also show notifications through an in-app notification center.

## Candidate Architecture

```txt
Mobile PWA (Next.js)
        |
        | API / SDK
        v
Shared Backend + Database
        ^
        | API / SDK
Admin Web App (Next.js)

Integration Layer
        |
        +-- Beds24
        +-- Push notifications
        +-- Future external services
```

## Current Recommended Direction

Confirmed MVP direction:

- Mobile: Next.js PWA/mobile web first
- Admin web: Next.js
- Backend/database: Supabase
- Integration layer: Next.js Route Handlers and/or Supabase Edge Functions
- Deployment: Vercel

Later native option:

- React Native + Expo when Apple Developer / Google Play setup is ready

## Key Architecture Questions

- Should mobile and admin live in one monorepo?
- Should both clients share TypeScript types?
- Should backend functions live in the same repo?
- Should admin web be included in MVP or built immediately after mobile foundation?
- Which permissions are enforced in backend/database policies?

## Offline Scope

MVP does not include full offline mode.

Required MVP behavior:

- Show clear network error messages.
- Prevent accidental form loss where possible.
- Retry failed saves/uploads where practical.
- Do not promise offline-first behavior.

Future:

- Draft saving
- Deferred photo upload
- Recent calendar cache
- Recent announcement cache
