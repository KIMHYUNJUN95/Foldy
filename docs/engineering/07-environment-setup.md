# Environment Setup

## Purpose

This document defines environment variables and external service setup needed for Foldy.

Do not store real secret values in Markdown files.

## Security Rule

Never commit:

- Supabase service role key
- OAuth client secrets
- Beds24 API keys/secrets
- Web Push private keys
- Any production secrets

Use `.env.local` for local development and Vercel environment variables for deployment.

## Environment Files

Expected local file:

```txt
.env.local
```

Current local status:

- `.env.local` exists locally and is ignored by Git.
- All three Supabase variables are configured locally.

Example file to create later:

```txt
.env.example
```

`.env.example` should include variable names only, with placeholder values.

## Supabase

Required variables:

```txt
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Current project URL:

```txt
https://sspdgzkytkpmquqsfaup.supabase.co
```

Usage:

- `NEXT_PUBLIC_SUPABASE_URL`: browser/client Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser/client anon key
- `SUPABASE_SERVICE_ROLE_KEY`: server-only admin operations

Important:

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to client code.
- Use service role only in server-only code paths.

Implementation note:

- Supabase clients are initialized lazily so `next build` can run before real environment values are available.
- Browser client uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Server/service clients must not be imported into client components.

## App URL

Required variables:

```txt
NEXT_PUBLIC_APP_URL=
```

Examples:

```txt
http://localhost:3000
https://stay-ops-two.vercel.app
```

프로덕션 도메인은 `stay-ops-two.vercel.app` 이다(2026-09-09 확인). 예전 문서에 있던
`stayops.vercel.app` 은 이 프로젝트에 연결된 적이 없다.

Usage:

- Auth redirects
- Invite links
- PWA metadata if needed

### Local Dev Tools

Optional local-only gate:

```txt
ENABLE_LOCAL_DEV_TOOLS=
```

Usage:

- Set to `true` only in `.env.local` when a localhost-only maintenance endpoint is needed.
- Do not set it in production or staging.
- It does **not** provide a test-login shortcut; QA now signs in with real Google/email accounts.

#### Sample data — linen returns (`scripts/dev/seed-linen-returns.js`)

Creates sample 린넨 반품 records so `/admin/linen-return` has something to look at. It reads the
organization's real building catalog, active `linen_items`, and active members, then writes records
across the current Tokyo month plus two in the previous month (for range-filter checks). Notes are
prefixed with `[샘플]` so seeded rows are easy to spot and delete from the console. Photos are not
seeded (they would need real storage objects). Uses `SUPABASE_SERVICE_ROLE_KEY` — **local only**.

```bash
node scripts/dev/seed-linen-returns.js                  # dry run (prints the plan, writes nothing)
node scripts/dev/seed-linen-returns.js --apply          # first organization
node scripts/dev/seed-linen-returns.js --apply --org <organization_id>
```

Delete seeded rows from the console UI (삭제 → 확인), or by the `[샘플]` note prefix.

#### Sample data — 근태 · 급여 데모 (`scripts/dev/seed-attendance-demo.js`, 2026-10-27)

근태 · 급여를 처음부터 끝까지 직접 눌러 보기 위한 데이터. **「Foldy Demo」 조직(slug `stayops-review-demo`)에만** 넣는다 —
slug 가 다르면 멈추고, 지우는 범위도 그 조직 + 스크립트의 사람들뿐(실제 Haru 데이터는 건드리지 않음). 운영 DB 에 넣는다(앱이 운영 웹을 띄우므로).

- 로그인 계정 3개: 데모 관리자(owner · 사장 결재) · 데모 전무(전무 결재 · 휴가 승인) · 데모 알바(시급, 본인 화면). 비밀번호는 처음 만들 때
  무작위로 정해 저장소 루트 `.env.demo-accounts`(git 제외, 권한 600)에 적고, 다시 돌려도 그 값을 쓴다.
- 로그인하지 않는 직원 6명: 시급 5명(원천세 갑 · 을 · 병 · 미설정, 현금 · 이체, 시급 2 · 3구간, 고용보험, 계좌 확인 대기 · 유초 · 계좌 없음) + 월급 사무 1명(휴가).
- 9월 · 10월(어제까지) 출퇴근 · 휴식, 10월 견본(검토 필요 · 수기 입력 · 퇴근 누락 + 정정 요청 · 무효 · 시간 정정 요청), 9월 승인된 정정,
  추가수당(주말 일반 · 특별), 교통비(승인 · 대기), 휴가(승인 · 대기), 회사 급여 설정(지급일 10일 · 결재자 · 2026년도 고용보험 5.5‰),
  9월 급여 입력(특별수당 · 원천세 직접 입력 · 메모 → 10월 「지난달 값 가져오기」 원본) · 10월 지난달 조정 1건.
- 넣지 않는 것: 근태 마감 · 결재 · 지급 확인 · 세무사 송부 — 직접 해 보는 단계.

```bash
node scripts/dev/seed-attendance-demo.js           # dry run (계획만 출력)
node scripts/dev/seed-attendance-demo.js --apply   # 넣기 — 이미 있으면 그 사람들의 근태 · 급여 데이터를 지우고 다시 넣음(처음 상태로 되돌리기)
```

저장소 루트(`.env` · `.env.local` 이 있는 곳)에서 돌린다. 다시 돌리면 테스트하며 바꾼 마감 · 결재 · 입력도 함께 처음 상태로 돌아간다.

### Testing the dev server on a phone over any network (Cloudflare quick tunnel)

To open the local dev server on a phone **without** needing the same WiFi (works on cellular too):

1. Start the dev server in WSL: `npm run dev` (binds `*:3000`).
2. Install cloudflared once: download `cloudflared-linux-amd64` to `~/.local/bin/cloudflared`, `chmod +x`.
3. Run a quick tunnel: `~/.local/bin/cloudflared tunnel --url http://localhost:3000 --no-autoupdate`.
   It prints a random `https://<random>.trycloudflare.com` URL — open that on the phone.

Two dev-only allowances make this work (no production effect):

- `next.config.ts` → `allowedDevOrigins` includes `"*.trycloudflare.com"` so Next dev serves HMR/client chunks to the tunnel origin.
- The dev temp-QR route (`src/app/api/dev/attendance/temp-qr/route.ts`) `isLocalDevHost()` also accepts `*.trycloudflare.com` hosts, so the temp clock-in QR page opens through the tunnel. It stays gated by `NODE_ENV=development` + `ENABLE_LOCAL_DEV_TOOLS=true`, so it is never reachable in production regardless of host.

Notes / cautions:

- The quick-tunnel URL is **random per run** and changes whenever cloudflared restarts; the config uses a wildcard so no edit is needed each time.
- A quick tunnel exposes the dev server **publicly** to anyone with the URL — use it only for short testing sessions and stop cloudflared when done.
- Log into the app **through the tunnel URL** on the phone first; the temp-QR page needs an org-scoped session on that origin (otherwise it returns `no_org_context`). Auth callback origin is derived from the request host, so login over the tunnel domain works.

## Google OAuth

Required later for Google login:

```txt
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Depending on Supabase Auth setup, these may be configured inside Supabase dashboard rather than app environment variables.

Document final setup after Supabase Auth is configured.

## Apple Login

Not required for MVP.

Future variables may include:

```txt
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
```

Apple login is deferred until Apple Developer account is available.

## Beds24

Webhook-first integration.

Variables:

```txt
BEDS24_WEBHOOK_SECRET=
BEDS24_API_BASE_URL=
BEDS24_API_TOKEN=
BEDS24_API_REFRESH_TOKEN=
CRON_SECRET=
```

Usage:

- `BEDS24_WEBHOOK_SECRET`: verify incoming webhook requests if supported/configured
- `BEDS24_PRICE_WEBHOOK_FORWARD_URL`: 선택. 받은 Beds24 배달을 그대로 넘길 주소(줄바꿈/쉼표로 여러 개). **미설정이 기본이고 그때는 아무 데도 넘기지 않는다.** 전환기에만 쓴다 — 아래 「Beds24 재고(가격) 웹훅 전환」 참고
- `BEDS24_API_BASE_URL`: Beds24 API base URL
- `BEDS24_API_TOKEN`: short-lived Beds24 access token for direct inventory/property calls
- `BEDS24_API_REFRESH_TOKEN`: long-lived Beds24 refresh token used to mint access tokens when `BEDS24_API_TOKEN` is unset or expired
- `DEEPL_API_KEY`: DeepL API key used to translate external reviews on demand. **Server-only** — never expose it to the browser. Optional: without it the review detail simply offers no translate button and the original text still renders. Free-tier keys end in `:fx`; the host is picked automatically (`api-free.deepl.com` vs `api.deepl.com`), or override with `DEEPL_API_URL`. Usage is capped in code at 450,000 characters per calendar month against DeepL API Free's 500,000 so a burst cannot overshoot the free tier. See `docs/product/25-complaint-workflow.md` → "Review Translation".
- `CRON_SECRET`: shared secret authorizing production scheduled/maintenance endpoints: Beds24 reconcile,
  external-review sync/health/relink, Todo reminders, and attendance reminders. Vercel sends it
  automatically only to routes declared in `vercel.json`; GitHub Actions and manual callers send the
  bearer header (Beds24 paths also accept `BEDS24_WEBHOOK_SECRET` where documented). An unset reminder
  secret returns 404; invalid/missing caller credentials return 403.
- **시크릿 비교 공용 규칙 (2026-10-26)**: 모든 API 시크릿 확인은 `src/lib/api-secret.ts`(상수 시간 · 길이 무관). Bearer / 지정 헤더 / (허용된 경로만) `?secret=` 중 **하나라도 맞으면** 통과 — 예전 `a ?? b ?? c` 는 첫 값만 봤다. 쿼리 시크릿은 호환을 위해 유지. `BEDS24_WEBHOOK_SECRET` 미설정 시 웹훅이 열린 채 통과하는 기존 동작(fail-open)은 운영 환경변수 확인 전이라 그대로 두었다(코드에 TODO).
- 웹훅 로그에는 본문 표본을 남기지 않고(키 · 길이만), 저장하는 거절 본문은 20,000자 상한(넘으면 표본 4,000자 + 길이). `/api/recruit/sync` 최신분(`mode=recent`)은 `{ok, count}` 만 돌려준다.
- Existing Beds24-linked properties can be backfilled locally through `POST /api/dev/beds24/backfill-inventory`

### Beds24 토큰 재발급 (rotation)

Beds24 관리 화면에서 토큰을 지우면 **그 리프레시 토큰은 되살릴 수 없다.** 증상은 조용하다 —
`/api/beds24/rates-sync` 가 `200` 을 주면서 `skipped: ["room-rates:refresh-token-invalid"]` 만 남기고,
판매 캘린더는 **마지막으로 성공한 시점의 요금을 계속 보여준다.** 실패가 화면에 안 뜨므로
요금이 안 바뀐다는 신고가 먼저 들어온다.

**발급 절차** — Beds24 `設定 → Marketplace → API`:

1. `ALL` 열 `すべて選択` (7줄 전부). 최종 스코프는
   `all:bookings+all:bookings-personal+all:bookings-financial+all:inventory+all:properties+all:accounts+all:channels`.
2. `Select which properties` → `このアカウントに登録された施設のみ`.
3. **`IP address whitelist` 는 반드시 비운다.** Vercel 은 송신 IP 가 고정이 아니라, 한 줄이라도
   넣으면 프로덕션이 전부 `401 Token not valid` 로 떨어진다. 발급된 토큰의
   `/authentication/details` 응답에서 `whiteListOnly: false` 로 검증할 수 있다.
4. **`Generate invite code`** (❌ `Generate long life token` 아님 — 우리 앱은 리프레시 토큰 구조다).
   나오는 초대코드는 172자 base64 라 리프레시 토큰과 생김새가 같지만 **다른 물건**이고,
   **1회용에 수 분 내 만료**된다.

**교환·주입**:

```bash
# 초대코드를 .beds24-invite-code 에 한 줄로 저장한 뒤 (gitignore 됨)
node scripts/dev/beds24-redeem-invite-code.mjs   # → .env 의 BEDS24_API_REFRESH_TOKEN 갱신, 코드 파일 폐기
node scripts/dev/beds24-push-token-to-vercel.mjs # → Vercel production 갱신 (vercel login 필요)
```

두 스크립트 모두 토큰 값을 stdout 에 찍지 않는다 — 길이와 스코프만 보고한다. 교환 스크립트는
`/authentication/token` + `/authentication/details` 로 **실제 발급이 되는 것을 확인한 뒤에만**
`.env` 를 건드린다.

**검증** (로컬 dev 서버 재시작 후):

```bash
curl -sX POST localhost:3000/api/beds24/rates-sync -H "authorization: Bearer $BEDS24_WEBHOOK_SECRET"
# 기대: skipped: [] · matchedRooms 91 · unmatchedRoomIds []
```

`BEDS24_WEBHOOK_SECRET` 은 이 절차와 **무관하다.** GitHub Actions 의 4개 워크플로는 그 시크릿만
쓰므로 토큰 교체 시 건드리지 않는다. 갱신 대상은 로컬 `.env` 와 Vercel 프로덕션 두 곳뿐이다.

### Beds24 재고(가격) 웹훅 전환

가격 변경 알림의 설정 지점은 Beds24 웹 화면 `設定 → Marketplace → API → Webhooks` 의
**`Inventory Webhooks`** 다. API 로는 보이지도 고칠 수도 없다.

**URL 칸이 프로퍼티당 한 줄만 받는다.** 예약 웹훅 칸은 `\r\n` 으로 여러 개를 받지만 여기는
안 된다. 그래서 가격 알림은 주인이 하나고, 지금 그 자리는 저쪽 프로젝트(Firebase
`priceWebhook`)가 갖고 있다.

**현재 상태 (2026-09-29): 전환 완료.** 9개 건물 전부 `https://stay-ops-two.vercel.app/api/beds24/webhook`
+ 커스텀 헤더 `x-beds24-webhook-secret` 로 바꿨다. 실측: 시크릿 없는 요청 403, 있는 요청 200,
실제 배달(건물 343112, 01:35 UTC)이 들어와 9,516행을 다시 읽었다.

**`BEDS24_PRICE_WEBHOOK_FORWARD_URL` 은 일부러 비워 둔다.** 저쪽 프로젝트를 곧 멈추므로 저쪽에
넘길 이유가 없다(사용자 결정). 아래 「전환일에 할 일」 1번과 5번의 저쪽 확인은 건너뛰었다.

**예약 웹훅의 저쪽 URL 은 아직 지우지 않는다** — 저쪽 자동화(시트·슬랙·노션)가 이쪽으로 옮겨질
때까지 그 배달이 필요하다.

**왜 옮기나 (2026-09-29 추가 이유).** 판매 캘린더의 「가격 개입 전환」이 Beds24 에서 바꾼 가격도 센다.
우리는 요금 동기화 때 이전 값과 비교해 그 변경을 이력에 남기는데, 웹훅이 저쪽에 있으면 주기 동기화
(실측 약 6시간 간격) 때에야 알아채 **바꾼 시각이 늦게 찍힌다.** 웹훅이 이쪽으로 오면 몇 초 안에
잡힌다.

**전달 주소는 Beds24 칸의 현재 값을 그대로 복사해 쓴다** — 저쪽 함수들은
`us-central1-my-booking-app-3f0e7.cloudfunctions.net` 아래에 있지만, 추측한 주소로 넘기면 전환 순간
저쪽 가격 알림이 조용히 끊긴다.

#### 전환일에 할 일

1. Vercel 프로덕션에 `BEDS24_PRICE_WEBHOOK_FORWARD_URL` = 저쪽 `priceWebhook` 주소를 넣고
   재배포한다. (**순서 중요** — Beds24 를 먼저 바꾸면 그 사이 배달이 저쪽에 안 간다.)
2. Beds24 `Inventory Webhooks` 에서 **9개 건물 각각** 드롭다운을 바꿔가며 URL 을
   `https://<도메인>/api/beds24/webhook` 로 교체한다.
3. 시크릿은 **`カスタムヘッダー` 칸**에 `x-beds24-webhook-secret: <값>` 으로 넣는다.
   `?secret=` 은 쓰지 않는다 — `GET` 배달이면 Beds24 가 `?roomId=…` 를 URL 에 붙이므로
   질의 문자열이 엉킬 수 있다. 라우트는 헤더·`Authorization` 베어러·`?secret=` 셋 다 받는다.
4. 각 객실의 `同期する` 체크가 켜져 있는지 확인한다.
5. 확인: `beds24_webhook_events` 에 `roomId` 가 실린 행이 들어오는지, 저쪽 로그에도 계속
   배달이 찍히는지 **둘 다** 본다.

#### 저쪽을 정리할 때

`BEDS24_PRICE_WEBHOOK_FORWARD_URL` 을 **지우고 재배포**하면 끝이다. 코드 수정도, Beds24 설정
변경도 없다.

#### 되돌리기

Beds24 URL 을 저쪽 주소로 되돌리면 즉시 원상복구된다. 그 사이 놓친 요금은 주기 동기화
(`/api/beds24/rates-sync`, 15분 예정 · 한 번에 가장 오래된 건물 3곳 — 2026-10-21)가 메운다 — 웹훅은 「즉시」를 위한 것이지 유일한 경로가 아니다.

### 객실 × 월 집계 틱 (pg_cron + pg_net, 2026-10-08)

- 크론 `ops-stats-tick`(매 분) → `ops_stats_tick_if_needed()` — dirty 달이 있을 때만 `/api/ops/stats-tick` 을 부른다. 주소는 Vault `ops_stats_tick_url`,
  토큰은 **Beds24 틱 토큰(`beds24_tick_token`)을 같이 쓴다**(대조 `beds24_tick_token_ok`) — 새 비밀값 · 환경변수 없음. 손으로 부를 때는 `CRON_SECRET`.
- 크론 `ops-stats-daily`(04:10 도쿄) — 모든 달을 dirty 로(안전망). 실행 결과는 `cron.job_run_details.return_message`(`idle` · `not_configured` · `fired`).
- 틱이 멈춰도 숫자는 틀리지 않는다 — 화면이 읽기 전에 dirty 달을 스스로 계산한다(느려질 뿐).

### 업무일지 예약 틱 (pg_cron + pg_net + Vault, 2026-10-20)

업무일지 예약 보내기(`docs/product/18-todo-task-workflow.md` 「업무일지 예약 보내기」)를 그 시각에 Slack 으로 보낸다. Beds24 틱과 같은 방식.

- 마이그레이션 `202610200005_task_report_schedules.sql` 이 표 · 함수 3개 · Vault 시크릿 2개 · pg_cron 잡 `task-report-tick`(매 분)을 만든다. **새 환경변수 없음**
  (Slack 은 기존 `SLACK_DAILY_REPORT_WEBHOOK_URL`). 손으로 부를 때는 `CRON_SECRET`.
- Vault `task_report_tick_token`(SQL 안에서 난수, 출력하지 않음) · `task_report_tick_url` = `https://stay-ops-two.vercel.app/api/tasks/report-tick`.
- 할 일이 없으면 `idle` 을 돌려주고 Vercel 함수는 뜨지 않는다. 확인: `cron.job_run_details` 에서 jobname `task-report-tick`(idle / not_configured / fired).
- 도메인이 바뀌면 `vault.update_secret` 으로 `task_report_tick_url` 을 같이 바꾼다(Beds24 틱 주소와 함께).

### Beds24 틱 (pg_cron + pg_net + Vault, 2026-09-30)

쿨다운(429·크레딧 부족)이 풀린 뒤 대기 가격 작업과 미뤄 둔 웹훅 재조회를 **1분 안에** 이어받는다.
계약: `docs/product/33-calendar-write-features.md` → 「쿨다운이 풀리면 1분 안에 이어서 보낸다 · 미뤄 둔 웹훅 재조회」.

- 마이그레이션 `202609300003_beds24_deferred_refreshes.sql` · `202609300004_beds24_tick_cron.sql` 이 전부 만든다
  — `pg_net` 활성화, Vault 시크릿 2개, 함수 2개, pg_cron 잡 `beds24-tick`(매 분). **새 환경변수는 없다.**
- Vault `beds24_tick_token`: 마이그레이션이 SQL 안에서 난수(32바이트 hex)로 만든다. 값은 저장소·채팅·로그
  어디에도 나오지 않는다. Vault `beds24_tick_url`: `https://stay-ops-two.vercel.app/api/beds24/tick`.
- 배포 순서: 라우트(`src/app/api/beds24/tick/route.ts`)가 **먼저 배포된 뒤** 마이그레이션을 적용하는 편이
  깔끔하다. 거꾸로 해도 그 사이 호출이 404 로 끝날 뿐 해는 없다.
- `BEDS24_SYNC_PAUSED` 가 켜져 있으면 라우트는 202 로 아무것도 안 한다(워커와 같다).
- GitHub Actions `beds24-price-job-worker.yml` 은 마지막 안전망으로 그대로 둔다.

확인(값을 출력하지 않는 쿼리만 쓴다):

```sql
-- 최근 판단 결과: cooldown / busy / idle / not_configured / fired
select start_time, status, return_message
  from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'beds24-tick')
 order by start_time desc limit 20;

-- 라우트가 돌려준 요약(몇 시간 보관)
select created, status_code, left(content, 300) from net._http_response order by created desc limit 10;

-- 미뤄 둔 재조회
select external_property_id, reason, attempts, requested_at, last_error
  from public.beds24_deferred_refreshes order by requested_at;
```

**토큰 교체** — 새 값을 SQL 안에서 만들어 바로 넣는다. `vault.decrypted_secrets` 를 select 하지 않는다:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'beds24_tick_token'),
  encode(extensions.gen_random_bytes(32), 'hex')
);
```

라우트는 매 요청 Vault 와 대조하므로 재배포가 필요 없다. 도메인이 바뀌면 같은 방식으로
`beds24_tick_url` 을 `vault.update_secret(id, 'https://<새 도메인>/api/beds24/tick')` 로 고친다.
잠시 끄려면 `select cron.unschedule('beds24-tick');`, 다시 켜려면 마이그레이션 ④의 `cron.schedule` 문을 다시 실행한다.

### 자동화 틱 · Slack 채널 (2026-10-06)

자동화 관제실(`/admin/ops/automation`)의 정시 발송 · 재시도 · 변동 재전송 · 정정본 · 취소/당일예약 알림을 **1분 안에** 처리한다.
계약: `docs/product/36-automation-control.md`.

- 마이그레이션 `202610060003_automation_control.sql` 이 표 · Vault 시크릿 2개(`automation_tick_token` 난수 · `automation_tick_url`
  = `https://stay-ops-two.vercel.app/api/automation/tick`) · 함수 2개 · pg_cron 잡 `automation-tick`(매 분)을 만든다. 운영 적용 2026-10-06.
- 켜진 자동화가 없으면 함수는 `idle` 만 돌려주고 라우트를 부르지 않는다.
- 토큰 교체 · 주소 변경 · 끄기는 위 Beds24 틱과 같은 방식(이름만 `automation_tick_*` · `automation-tick`).

**Slack 채널 = Vercel 환경변수** — 채널 하나에 변수 하나:

```
SLACK_AUTOMATION_<KEY>_WEBHOOK_URL=https://hooks.slack.com/services/…   # KEY = 대문자 · 숫자 · _ (예: OPS_DAILY, CLEANING_STAFF)
```

- 서버가 이 접두어의 변수를 찾아 관제실 「설정 → 받는 곳 · 언어」에 행으로 보여 준다. 채널을 늘리려면 변수를 넣고 **재배포**.
- 주소는 화면 · 로그에 나오지 않는다(끝 4자리만). `hooks.slack.com` 이 아니면 「주소 오류」로 표시하고 보내지 않는다.
- **`SLACK_DAILY_REPORT_WEBHOOK_URL`(업무일지) 과 다른 변수다.** 저쪽 STAY ARI Manager 가 같은 이름을 일일 리포트에 썼지만 우리 쪽은 업무일지 채널이다.
- 실패 알림 자동화가 꺼져 있거나 받는 곳이 없으면 자동화 실패는 기존 `SLACK_OPS_ALERT_WEBHOOK_URL` 로 간다.
- 알림의 「Foldy 에서 열기」 링크는 `NEXT_PUBLIC_APP_URL`(없으면 `APP_BASE_URL` → `VERCEL_PROJECT_PRODUCTION_URL`)로 만든다.

## Recruit (채용 지원서 수신)

외부 채용 사이트(haru-recruit / Firebase)가 지원서를 밀어넣는 경로. 계약은
`docs/product/30-recruit-workflow.md`.

Variables:

```txt
RECRUIT_WEBHOOK_SECRET=
RECRUIT_ORGANIZATION_ID=
```

Usage:

- `RECRUIT_WEBHOOK_SECRET`: `POST /api/recruit/applications` 의 공유 시크릿. **미설정이면 수신을
  거부한다(503).** 개인정보가 들어오는 입구라 기본값이 거부다. 값은 채용 사이트의 Cloud Functions
  쪽에도 같은 값으로 넣는다 — **클라이언트 번들에는 절대 넣지 않는다.**
- `RECRUIT_ORGANIZATION_ID`: 지원서가 속할 조직. 생략하면 유일한 조직을 쓰고, 조직이 둘 이상이면
  추측하지 않고 거부한다. **현재 조직은 1개라 설정 불필요**(2026-09-09 확인).

### Firestore 서비스 계정 (2026-09-11 — 공개 읽기를 잠글 때 필요)

```txt
RECRUIT_FIRESTORE_SERVICE_ACCOUNT=
```

채용 사이트 Firestore 는 **인증 없이 읽힌다** — 어드민이 Firebase Auth 를 쓰지 않아(비밀번호가
번들 안 상수) 규칙이 공개 읽기를 허용해야 그 화면이 동작하기 때문이다. 그 결과 지원자 이름·전화·
주소·국적·비자·이력서가 URL 만 알면 열린다. 그 URL 은 숨겨진 값이 아니다 — `projectId` 와 컬렉션
이름이 사이트 번들에 문자열로 들어 있고, 개발자도구 Network 탭에도 그대로 보인다.

규칙을 잠그면 그 노출이 닫히는 대신 **Foldy 의 당겨오기도 함께 죽는다.** 그래서 서비스 계정으로
읽는 경로를 먼저 깔아 둔다.

- 값은 **서비스 계정 JSON 통째로** 넣는다(Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개
  키 생성). `client_email` 과 `private_key` 만 쓴다.
- 이메일·키를 따로 넣고 싶으면 `RECRUIT_FIRESTORE_CLIENT_EMAIL` /
  `RECRUIT_FIRESTORE_PRIVATE_KEY` 도 받는다. 줄바꿈이 `\n` 리터럴로 저장돼도 코드가 되돌린다.
- **미설정이면 예전처럼 인증 없이 읽는다.** 그래서 이 코드를 배포하는 것만으로는 아무것도 바뀌지
  않는다 — 키를 넣고 규칙을 잠그는 순간 넘어간다(무중단).
- 지금 어느 쪽으로 읽고 있는지는 `POST /api/recruit/sync` 응답의 **`auth`** 로 확인한다:
  `anonymous` / `service_account`.
- 권한은 **읽기만** 요청한다(`datastore` 스코프). Firestore 쓰기는 채용 사이트가 한다.

**전환 순서(무중단).** ① 이 코드 배포 → ② 서비스 계정 키를 Vercel 에 넣고 재배포 →
`auth: "service_account"` 확인 → ③ Firestore 규칙 잠그기 → 동기화가 계속 도는지 확인.
②를 건너뛰고 ③을 하면 지원서 수신이 멈춘다(GitHub Actions 가 502 로 빨간불이 되므로 드러나긴 한다).


**자동 연동은 환경변수 없이 돈다 (2026-09-09).** 채용 사이트에 Cloud Function 이 없다는 것이
확인되어(저장소에 `functions/` 자체가 없다) push 대신 **당겨오기**로 간다:
`POST /api/recruit/sync` + GitHub Actions `.github/workflows/recruit-sync.yml`(주기 실행 + 하루 1회
전량). 이 경로는 **시크릿이 없다** — 외부 입력을 받지 않아 위조가 불가능하고, 남용은
`recruit_sync_state` 의 60초 창으로 막는다. Firestore 는 공개 읽기라 API 키도 필요 없다
(`RECRUIT_FIRESTORE_PROJECT_ID` 미설정 시 `haru-recruit` 를 쓴다).

**프로덕션 상태 (2026-09-09):** 아래 push 경로용 `RECRUIT_WEBHOOK_SECRET` 은 **아직 설정되지 않았다.**
당겨오기가 그 자리를 대신하므로 지금 당장 막히는 것은 없다. 나중에 Cloud Function 을 붙일 때 설정한다.
`POST https://stay-ops-two.vercel.app/api/recruit/applications` 가 503 `not_configured` 를 돌려준다.
Vercel Settings → Environment Variables 에 Production 으로 넣고 **재배포**해야 반영된다(빌드 시점
env 를 쓴다). 같은 값을 채용 사이트 Cloud Functions 의 환경변수에도 넣는다.

**Vercel Deployment Protection 은 이 경로를 막지 않는다.** Standard Protection
(`ssoProtection.deploymentType = all_except_custom_domains`)은 프리뷰 배포만 막고 프로덕션
도메인은 통과시킨다 — 위 503 이 401 이 아닌 것으로 확인했다. 웹훅 때문에 이 보호를 끄지 말 것.
  - requires `ENABLE_LOCAL_DEV_TOOLS=true`
  - requires localhost access
  - requires the same `BEDS24_WEBHOOK_SECRET` value in `x-beds24-webhook-secret`
  - helper script: `scripts/dev/beds24-backfill-inventory.sh`
- External reviews can be collected locally through `GET/POST /api/dev/beds24/sync-reviews`
  - same gate as the other dev routes: `ENABLE_LOCAL_DEV_TOOLS=true`, localhost only, `BEDS24_WEBHOOK_SECRET` in `x-beds24-webhook-secret`
  - `organizationId` (UUID) is **required**; optional `sinceDays` (1–365, default 90)
  - production counterpart: `/api/beds24/reviews-sync` (see below)

Reconciliation safety net (production):

- `GET/POST /api/beds24/reconcile` re-pulls the operational window (**current month + next two months**, 3 months total, widened 2026-07-17) from Beds24 `/bookings` and upserts anything missing. The window is keyed by **arrival/stay overlap, never by booking date** — a reservation booked long ago whose check-in falls in the window is still pulled. It is the production-safe, idempotent counterpart to the dev-only `backfill-reservations` route. That dev route now also accepts `from`/`to` (YYYY-MM-DD) query params for a one-time **wide catch-up** of far-future reservations the narrow window never reaches (used 2026-07-17 to seed 2026-06 → 2027-12).
- Driven by Vercel Cron (`vercel.json`, `0 19 * * *` UTC) **and** — since 2026-07-22 — an independent
  GitHub Actions schedule (`.github/workflows/beds24-reconcile.yml`, every 6h). Webhooks remain the primary
  update path; this only heals dropped/never-delivered webhook events.
- **Why two triggers (2026-07-22):** the Vercel cron was found to have silently stopped firing for days
  (0 invocations for both crons — a Vercel-side scheduling failure, not code/token: the endpoint returns
  HTTP 200 when hit manually). The GitHub Actions schedule is a redundant external trigger that does not
  depend on Vercel's cron scheduler, so the safety net survives a broken Vercel cron. reconcile is
  idempotent, so running from both is harmless. **Required GitHub repo secret:** `BEDS24_WEBHOOK_SECRET`
  (same value as on Vercel) — set it under repo Settings → Secrets and variables → Actions.
- Every run (and every inbound webhook) is logged to `beds24_webhook_events` for observability.
- Manual trigger: `curl "$APP_URL/api/beds24/reconcile" -H "Authorization: Bearer $CRON_SECRET"` (or `-H "x-beds24-webhook-secret: $BEDS24_WEBHOOK_SECRET"`).

Webhook ingestion hardening (2026-07-22):

- The webhook endpoint (`/api/beds24/webhook`) previously rejected any delivery whose
  booking record it could not locate with a bare **HTTP 400, before writing any
  observability row** — so a run of unrecognized deliveries went silently missing. Fixed:
  1. **Defensive body parsing** — the raw body is read once and parsed as JSON *or*
     `application/x-www-form-urlencoded` (a form field whose value is itself JSON is unwrapped),
     so a delivery is never dropped merely for its transport encoding.
  2. **Envelope-agnostic extraction** — `extractBeds24WebhookBookingCandidates` now recurses
     into *every* nested object/array (bounded depth), so a booking wrapped under any envelope
     key (`booking`, `data`, `bookings`, …) is still found; duplicates are de-duped by booking id.
  3. **No silent drops, ever** — when no booking can be extracted, the full raw body +
     `Content-Type` are persisted to `beds24_webhook_events` (`raw_payload` / `content_type`
     columns, migration `202607220001_beds24_webhook_raw_capture.sql`) with mode
     `no_booking_candidates`, and the endpoint **ACKs 2xx** so Beds24 does not retry-storm. The
     daily reconcile still heals the missed reservation from the Beds24 API. Partially-failed
     batches likewise keep their raw body for replay/debug.
- `raw_payload` is captured **only** for failed/unparsed deliveries (the case that needs
  debugging), not for every successful booking, keeping bulk guest PII out of the log.

Task reminder cron (production):

- `GET/POST /api/tasks/reminders` first materializes recurring Todo / Shared Task instances for the active task window, then evaluates time-based notifications and fans out one deduped reminder per task per recipient. Due-soon = active task due today (Asia/Tokyo); overdue = active task due before today. It is org-scoped and participant-only. See `src/lib/notifications/task-reminders.ts` and `docs/product/14-notification-design.md`.
- Driven daily by Vercel Cron (`vercel.json`, `0 23 * * *` UTC = 08:00 Asia/Tokyo). Authorized with `CRON_SECRET` only (returns 404 if `CRON_SECRET` is unset, 403 if the secret is missing/wrong).
- Requires the `task_due_soon` / `task_overdue` enum values from `supabase/migrations/202606110001_task_reminder_notifications.sql` (**applied to the linked project on 2026-06-11**); if a fresh environment lacks them, reminder inserts fail soft (logged, no crash) until applied.
- Manual trigger: `curl "$APP_URL/api/tasks/reminders" -H "Authorization: Bearer $CRON_SECRET"`.

External review collection cron (production):

- `GET/POST /api/beds24/reviews-sync` pulls Airbnb / Booking.com reviews from Beds24 into `external_reviews` (pure upsert on `organization_id, provider, external_review_id`). Reviews have no webhook, so this is the one Beds24 read path that must be scheduled. See `docs/engineering/01-beds24-integration.md` → "External Reviews".
- Driven daily by GitHub Actions (`.github/workflows/beds24-reviews-sync.yml`, `5 23 * * *` UTC =
  08:05 Asia/Tokyo). Routine runs use the workflow's rolling window; `?full=1` requests a deeper recovery
  sweep. Optional `?organizationId=<uuid>` limits the run to one org, otherwise active organizations are processed.
- Auth matches the reconcile endpoint: `CRON_SECRET` bearer, falling back to `BEDS24_WEBHOOK_SECRET` (`x-beds24-webhook-secret` header or `?secret=`) for manual triggers. 404 when neither secret is configured, 403 when the provided one is wrong. `BEDS24_SYNC_PAUSED` short-circuits the run with `202 {ok:true,paused:true}`.
- Per-organization failures do not abort the run — they surface in `failures[]` with HTTP 207. The response carries `creditsRemaining` / `stoppedEarly` so a credit-limited early stop is visible; the next cycle resumes the remainder.
- Manual trigger: `curl "$APP_URL/api/beds24/reviews-sync?full=1" -H "Authorization: Bearer $CRON_SECRET"`.

Token scope checklist (must verify on token create/refresh):

- bookings
- bookings-personal
- inventory
- properties
- Allow linked properties (linked properties access is not guaranteed by default)

Validation checkpoints (recommended after token update):

- `GET /v2/properties?includeAllRooms=true` returns expected linked properties.
- Current-month overlap bookings query returns reservations for linked properties.
- If not, check token scope first before debugging app code paths.

Important:

- Avoid frequent polling.
- Prefer webhook updates.
- Keep access/refresh tokens server-only.

## Web Push

Required for PWA push notifications:

```txt
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

Usage:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: browser subscription
- `VAPID_PRIVATE_KEY`: server-only push signing
- `VAPID_SUBJECT`: contact subject, usually mailto or URL

Example subject:

```txt
mailto:admin@example.com
```

## Daily Report (Todo 완료/기록 tab)

No environment variable required. The daily work-report generator
(`generateDailyReport` in `src/actions/task-report.ts`) is **template-based and free** —
it builds the report deterministically from the day's completed tasks with a local text tidy-up
(whitespace, bullet glyphs, punctuation spacing). No external API or key, no per-use cost.

> History: an LLM-backed version (`@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`, `claude-haiku-4-5`) was
> prototyped but replaced with the free template approach (2026-06-13). If richer 맞춤법 correction is
> ever wanted, re-introducing the SDK + key behind the same `generateDailyReport` contract is the
> upgrade path.

### `ANTHROPIC_API_KEY` — 재류카드 · 마이넘버 카드 글자 읽기 (2026-10-23)

- `@anthropic-ai/sdk` 를 다시 들였다 — 업무일지가 아니라 **신분 서류 사진 읽기** 전용(`src/lib/staff-documents/ocr.ts`, `docs/product/41` §10).
- 키는 **서버 전용** 환경변수 `ANTHROPIC_API_KEY`(Vercel Production). 사용자가 Claude Console 에서 발급해 직접 넣는다 — 채팅 · 문서에 값을 적지 않는다.
  `NEXT_PUBLIC_` 접두어 금지. 키가 없거나 거절되면 읽기만 건너뛰고(손 입력) 가입 · 등록은 그대로 된다.
- 키 만료일을 정했다면 그 전에 새 키로 바꿔야 한다(만료되면 읽기만 멈춤).
- 크레딧: 사용자 계정은 Max 플랜 포함 API 크레딧(월 US$100)을 연결해 쓴다(2026-10-23). 한 장 몇 엔 수준.

### Slack single-channel delivery

Set this server-only variable in local development and the deployed environment:

```txt
SLACK_DAILY_REPORT_WEBHOOK_URL=
```

It must be a Slack Incoming Webhook for the single company daily-report channel. Do not put this URL
in client variables, documentation, source code, or browser logs. The report send action permits only
`https://hooks.slack.com` endpoints, sends the reviewed textarea body unchanged, and rechecks the
existing daily-report permission server-side. Leaving it unset keeps report generation/copy working
and returns a localized "not configured" message for Slack send.

### Slack operator alerts — a *different* channel (2026-08-07)

```txt
SLACK_OPS_ALERT_WEBHOOK_URL=
```

Used only by `src/lib/slack-notify.ts` (currently: the external-review freshness check). **Do not
point this at the daily-report webhook.** That channel is where field staff post work logs; a
"review collection looks stalled" alert there reaches people who cannot act on it and pushes real
logs off screen. Different audience → different channel.

**Optional.** Unset means no Slack message at all — detection still runs and the reconcile workflow
still prints a `::warning::` in its run log. Setting it is opting *in* to an extra alert.

## Storage

Active Supabase Storage buckets:

```txt
announcement-images  -- announcement image uploads (live, RLS enforced)
request-images       -- lost-item and maintenance-report image uploads (live)
```

Planned (not yet created):

```txt
profile-photos       -- user profile photos (deferred to post-MVP)
```

### announcement-images bucket

The `announcement-images` bucket is live. Its Storage RLS INSERT policy enforces:

- Path structure: `{organizationId}/{announcementId}/{filename}` — exactly 3 segments.
- Both `organizationId` and `announcementId` must be valid UUIDs.
- `filename` must be 3-160 characters, start and end with an alphanumeric character, and use only letters, digits, `_`, `.`, `-`.
- Platform admins can upload to any valid organization folder.
- Active non-part-time members can upload only to their own organization's folder.

Policy migrations:

- `supabase/migrations/202605170001_announcement_images_upload_policy.sql` — initial policy
- `supabase/migrations/202605190001_harden_announcement_images_rls.sql` — corrective: full 3-segment path validation
- `supabase/migrations/202605190002_restrict_announcement_image_filenames.sql` — corrective: stricter safe filename validation

Recommended storage path pattern:

```txt
{organization_id}/{target_type}/{target_id}/{attachment_id}.{ext}
```

Profile photo path:

```txt
profiles/{user_id}/{file_id}.{ext}
```

## Vercel

Vercel environments:

- Development
- Preview
- Production

Required:

- Add all production-safe variables to Vercel environment settings.
- Keep server secrets unavailable to client bundle.

## Canonical `.env.example` Shape

```txt
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPPORT_EMAIL=

ENABLE_LOCAL_DEV_TOOLS=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

BEDS24_WEBHOOK_SECRET=
BEDS24_DEFAULT_ORGANIZATION_ID=
BEDS24_API_BASE_URL=
BEDS24_API_TOKEN=
BEDS24_API_REFRESH_TOKEN=
BEDS24_SYNC_PAUSED=
CRON_SECRET=

DEEPL_API_KEY=
DEEPL_API_URL=

SLACK_DAILY_REPORT_WEBHOOK_URL=
SLACK_OPS_ALERT_WEBHOOK_URL=

NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

## Supabase Migration CLI

### Authentication requirement

Supabase CLI commands that interact with the linked project require Supabase API authentication. Use one of these approaches:

```powershell
npx supabase login
```

This opens a browser for one-time authentication and stores the access token in `~/.supabase/access-token`.

For short-lived automation, set `SUPABASE_ACCESS_TOKEN` in the current shell instead of storing a login token. Never commit tokens or paste them into documentation.

Database operations may also require the remote Postgres password through `-p <db-password>`. The access token authenticates the Supabase API request; the database password authenticates the remote Postgres connection.

### Migration history snapshot (verified 2026-06-03; historical)

At that date, all 37 local migration files matched the linked remote history. The repository has since
grown substantially (112 local migration files as of 2026-08-07), so this historical list must not be
used to claim that a deployment is current. Run `npx supabase migration list` against the actual target.

**Local migration files (37 total):**

```txt
-- Foundation placeholders (comment-only, match remote history)
20260508190109_remote_history_placeholder.sql
20260508191844_remote_history_placeholder.sql
20260509165916_remote_history_placeholder.sql
20260509174644_remote_history_placeholder.sql
20260510135642_remote_history_placeholder.sql
20260510144012_remote_history_placeholder.sql

-- Core foundation (applied via repair)
202605090001_initial_foundation.sql
202605090002_api_grants.sql

-- Announcements (applied via repair)
202605100001_announcements.sql
202605100002_announcement_reads.sql
202605100003_announcement_images.sql
202605100004_announcement_comments.sql
202605110001_announcement_popup_dismissals.sql

-- Announcement hardening
202605160001_harden_announcement_popup_dismissals.sql
202605160002_harden_announcement_manage_rls.sql
202605170001_announcement_images_upload_policy.sql
202605190001_harden_announcement_images_rls.sql
202605190002_restrict_announcement_image_filenames.sql

-- Cleaning workflow (Phase 7)
202605210001_cleaning_sessions.sql
202605210002_correct_cleaning_operating_date_and_active_index.sql
202605210003_allow_owner_mobile_cleaning_qa.sql
202605210004_allow_admin_qa_mobile_cleaning.sql
202605210005_owner_field_hybrid_cleaning_access.sql

-- Requests (Phase 8)
202605210006_lost_items.sql
202605210007_maintenance_reports.sql
202605210008_request_images.sql

-- Reservation calendar (Phase 10)
202605220001_reservations.sql
202605240001_properties_rooms.sql
202605240002_beds24_sync_indexes.sql
202605240003_beds24_property_external_key.sql
202605260002_enable_reservations_realtime.sql

-- Order requests (Phase 8 order slice)
202606010001_order_requests.sql
202606010002_order_requests_delivery_date.sql
202606020001_order_requests_delivery_range.sql

-- Notifications (Phase 11)
202606030001_notifications.sql
```

**Verified at 2026-06-03:** All 37 migrations confirmed applied on remote Supabase project `sspdgzkytkpmquqsfaup` via MCP migration list check.

### Adding new migrations

History is reconciled. The normal workflow applies from this point:

1. Create a new file in `supabase/migrations/` using the naming convention `YYYYMMDDNNNN_description.sql`
2. Run: `npx supabase db push -p <db-password>`
3. Verify with: `npx supabase migration list -p <db-password>`

Run the commands after Supabase API authentication is available through `npx supabase login` or `SUPABASE_ACCESS_TOKEN`. Use `-p <db-password>` when the CLI asks for the remote Postgres password.

## Deployment-Specific Decisions

- Confirm the production support email and `VAPID_SUBJECT` before enabling those channels.
- Verify Google OAuth and redirect URLs in the target Supabase project/dashboard.
- **앱(Capacitor) Google 로그인용 Redirect URL (2026-10-06):** Supabase Dashboard → Authentication → URL Configuration → Redirect URLs 에
  `com.harutokyo.foldy://auth/callback` 를 추가한다. 없으면 앱의 Google 로그인이 앱으로 돌아오지 못한다. 상세: `03-deployment-strategy.md` 「앱 안 Google 로그인」.
- Verify both Vercel environment variables and GitHub Actions secrets for scheduled jobs.
- In-app notifications are live; Web Push remains a separately configured delivery channel.
## Reservation Calendar Flags

### `BEDS24_SYNC_PAUSED`

- Default when unset: `false` (active). The app treats Beds24 sync as active unless it is explicitly paused.
- Set to one of `1`, `true`, `on`, or `yes` to pause webhook/reconcile processing.
- **Production activated 2026-07-17:** the Vercel production project now sets `BEDS24_SYNC_PAUSED=false`,
  so live webhooks (all 8 linked properties) and the daily reconcile cron are active. The stale
  `BEDS24_API_TOKEN` was removed so the app mints access tokens from `BEDS24_API_REFRESH_TOKEN`.
- Used by:
  - `src/app/api/beds24/webhook/route.ts`
  - `src/app/api/beds24/reconcile/route.ts`
  - admin reservation calendar sync status chip

## `next/image` 원격 호스트 허용 목록 (2026-09-11)

### 왜 신경 써야 하나

`next/image` 는 허용 목록에 없는 원격 주소를 만나면 **렌더 중에 던진다.** 사진만 안 보이는 게
아니라 **화면 전체가 안 뜨고** 에러 경계(「문제가 발생했어요」)가 대신 뜬다. 사진 한 장이 페이지를
죽이는 구조라, 새 이미지 화면을 붙일 때 반드시 같이 확인해야 한다.

브라우저 콘솔에 원인은 정확히 찍힌다:

    hostname "<ref>.supabase.co" is not configured under images in your `next.config.js`

### Supabase 주소는 두 갈래다

| 갈래 | 경로 | 언제 |
| --- | --- | --- |
| 공개 버킷 | `/storage/v1/object/public/<bucket>/**` | `getPublicUrl()` |
| 서명 URL | `/storage/v1/object/sign/<bucket>/**` | `createSignedUrl(s)()` — 비공개 파일 |

**버킷 이름이 맞아도 경로가 다르면 걸린다.** 2026-09-11 에 근태 → 교통비 영수증이 그렇게 막혀
있었다. 영수증은 `request-images` 버킷을 쓰고 그 버킷은 허용 목록에 있었지만, 영수증만 비공개라
서명 URL(`/object/sign/...`)로 열리는데 목록에는 `public` 만 있었다. 버킷이 맞으니 원인이 눈에
잘 안 띄었다.

그래서 `next.config.ts` 는 버킷마다 **public / sign 을 짝으로** 둔다. 새 버킷을 추가할 때도 둘 다
넣는다 — 한쪽만 넣으면 그 화면은 나중에 비공개로 바뀌는 순간 통째로 죽는다.

### 호스트는 환경변수에서 뽑는다

프로젝트 ref 를 문자열로 박아 두면 프로젝트를 옮길 때 이미지가 **조용히 전부** 깨진다.
`NEXT_PUBLIC_SUPABASE_URL` 에서 호스트를 뽑고 지금 값을 대비책으로 둔다. `next.config` 는 Next 가
`.env*` 를 읽은 뒤에 평가되므로 로컬·Vercel 양쪽에서 값이 들어온다.

### 확인 방법

설정을 고쳤으면 **개발 서버를 다시 켜야** 한다(`next.config` 는 기동 시에만 읽는다). 확인은 이미지
최적화 엔드포인트를 직접 때려보는 것이 빠르다:

```bash
curl -o /dev/null -w '%{http_code}\n' \
  "http://localhost:3000/_next/image?url=<URL-encoded 이미지 주소>&w=640&q=75"
# 200 이면 허용, 400 이면 목록에 없음
```

2026-09-11 실측: 영수증 서명 URL `200 image/jpeg`, 목록에 없는 `recruit-resumes` 와 외부 도메인은
각각 `400` — 허용 범위는 필요한 만큼만 열려 있다.

## Capacitor 앱 빌드 환경 변수 (2026-10-06)

- `CAP_SERVER_URL` (선택) — `npm run cap:sync` 할 때 앱이 띄울 웹 주소. 비우면 `https://stay-ops-two.vercel.app`. 웹 런타임 변수가 아니라
  네이티브 설정을 만들 때만 읽는다(Vercel 에 넣을 필요 없음). 빌드 환경 · 명령: `docs/engineering/03-deployment-strategy.md` 「앱 빌드」.

### 네이티브 플러그인 추가 후 (2026-10-23)

- 신분 서류 촬영 · 화면 가리기로 `@capgo/capacitor-document-scanner` · `@capgo/capacitor-privacy-screen` 이 들어왔다(docs/planning/17 H15).
  새 환경 변수는 없다. `npm install` 뒤 `npx cap sync` 를 한 번 돌리고(이미 커밋된 `ios/App/CapApp-SPM/Package.swift` ·
  `android/capacitor.settings.gradle` 과 같아야 한다), iOS 는 Xcode 에서 SPM 패키지를 다시 받고(File → Packages → Resolve Package Versions),
  Android 는 Gradle 동기화 — ML Kit 문서 스캐너는 Google Play 서비스가 있는 **실기기**에서만 돈다(에뮬레이터는 실패 → 웹 카메라).
