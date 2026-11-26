-- 셀프 체크인 보존 기간 지난 자료 지우기 — 매일 도쿄 04:00 (2026-11-26). 문서: docs/engineering/16-self-checkin-technical-design.md §3
-- 상태: **운영 DB 미적용.** 적용은 사용자 확인 뒤(CLAUDE.md 규칙 10). 202611260001(sync-stays 크론)과 같은 방식 — pg_cron + pg_net + Vault.
--
-- ## 왜
--
-- `apps/checkin` 의 `/api/jobs/retention` 은 `retain_until` 이 지난 stay 의 여권 사진 · 얼굴 동영상을 Storage API 로 먼저 지우고
-- (SQL 로는 storage.objects 를 지울 수 없다) 감사 기록 · 줄을 지운 뒤 `checkin.deletions` 에 건수만 남긴다. 48시간 지난
-- `claim_attempts` 도 지운다. 표 · 열은 바뀌지 않는다(타입 변경 없음).
--
-- ## 비밀값
--
-- 새 비밀값 없음 — 라우트는 sync-stays 와 같은 `CRON_SECRET` 을 보고, 여기서도 Vault 의 `checkin_sync_token` 을 그대로 쓴다.
-- 주소만 새로 넣는다(`checkin_retention_url`). 도메인을 옮기면 `vault.update_secret` 으로 바꾼다(코드 수정 없음).

create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'checkin_retention_url') then
    perform vault.create_secret(
      'https://foldy-checkin.vercel.app/api/jobs/retention',
      'checkin_retention_url',
      'Endpoint pg_cron calls daily (04:00 Asia/Tokyo) to delete expired self check-in records.'
    );
  end if;
end;
$$;

-- 돌려주는 값은 `cron.job_run_details.return_message` 에 남는다.
--   'not_configured'  Vault 에 주소 · 토큰이 없다
--   'fired'           불렀다(응답은 `net._http_response` — 200 이면 성공, 401 이면 토큰이 CRON_SECRET 과 다름)
create or replace function checkin.retention_tick()
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
    from vault.decrypted_secrets where name = 'checkin_retention_url' limit 1;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'checkin_sync_token' limit 1;
  if v_url is null or v_token is null then
    return 'not_configured';
  end if;

  -- 라우트 maxDuration 60초, 작업 예산 40초.
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

revoke all on function checkin.retention_tick() from public, anon, authenticated;
grant execute on function checkin.retention_tick() to service_role;

-- pg_cron 은 UTC — 도쿄 04:00 = 전날 19:00 UTC.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'checkin-retention') then
    perform cron.unschedule('checkin-retention');
  end if;
  perform cron.schedule('checkin-retention', '0 19 * * *', 'select checkin.retention_tick()');
end;
$$;
