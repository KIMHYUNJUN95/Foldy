-- 셀프 체크인 예약 옮겨 적기 — 5분마다 (2026-11-10). 문서: docs/engineering/16-self-checkin-technical-design.md §7
-- 상태: **운영 DB 미적용.** 적용은 사용자 확인 뒤(CLAUDE.md 규칙 10).
--
-- ## 왜
--
-- 체크인 서버(`apps/checkin`, Vercel `foldy-checkin`)의 `/api/jobs/sync-stays` 는 우리 DB 의 `public.reservations` 만 읽어
-- `checkin.stays` · `stay_rooms` 를 맞춘다(Beds24 호출 없음). 5분마다 불려야 하는데 Vercel Hobby 크론은 하루 한 번뿐이라,
-- 이미 운영 중인 `beds24-tick`(202609300004)과 같은 방식 — pg_cron + pg_net + Vault — 으로 DB 가 부른다.
-- 웹훅 · 매일 맞추기 · 판매 캘린더 수기 예약 등 예약이 바뀌는 모든 길과, 날마다 움직이는 「어제 ~ 30일 뒤」 범위를 다 잡는다.
--
-- ## 비밀값
--
-- 라우트는 `Authorization: Bearer <CRON_SECRET>`(Vercel 환경 변수)과 맞는지 본다. 같은 값을 Vault 의 `checkin_sync_token` 에
-- **사용자가 SQL Editor 에서 따로** 넣는다(이 파일 · 저장소 · 채팅에는 값이 없다). 넣기 전까지 함수는 'not_configured' 만 돌려준다.
--   select vault.create_secret('<CRON_SECRET 값>', 'checkin_sync_token', 'Bearer token pg_cron sends to checkin /api/jobs/sync-stays. Must equal Vercel CRON_SECRET; never print.');
-- 주소는 아래에서 넣는다. 도메인을 옮기면 `vault.update_secret` 으로 바꾼다(코드 수정 없음).

create extension if not exists pg_net with schema extensions;

-- ── ① Vault — 호출 주소 ─────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'checkin_sync_url') then
    perform vault.create_secret(
      'https://foldy-checkin.vercel.app/api/jobs/sync-stays',
      'checkin_sync_url',
      'Endpoint pg_cron calls every 5 minutes to copy reservations into checkin.stays.'
    );
  end if;
end;
$$;

-- ── ② 부르기 ────────────────────────────────────────────────────────────────
-- 돌려주는 값은 `cron.job_run_details.return_message` 에 남는다.
--   'not_configured'  Vault 에 주소 · 토큰이 없다
--   'fired'           불렀다(응답은 `net._http_response` 에 몇 시간 남는다 — 200 이면 성공, 401 이면 토큰이 CRON_SECRET 과 다름)
create or replace function checkin.sync_stays_tick()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'checkin_sync_url' limit 1;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'checkin_sync_token' limit 1;
  if v_url is null or v_token is null then
    return 'not_configured';
  end if;

  -- 라우트 maxDuration 60초.
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    timeout_milliseconds := 60000
  );
  return 'fired';
end;
$$;

revoke all on function checkin.sync_stays_tick() from public, anon, authenticated;
grant execute on function checkin.sync_stays_tick() to service_role;

-- ── ③ 5분마다 ───────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'checkin-sync-stays') then
    perform cron.unschedule('checkin-sync-stays');
  end if;
  perform cron.schedule('checkin-sync-stays', '*/5 * * * *', 'select checkin.sync_stays_tick()');
end;
$$;
