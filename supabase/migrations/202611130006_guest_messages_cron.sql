-- 손님 메시지 정기 실행 — 보정 조회 15분 · 발송 큐 5분 · 자동 안내 5분 (2026-11-13, **운영 미적용 — 적용은 사용자 허락 뒤**)
--
-- 도메인 계약: docs/product/47-guest-messaging.md §10 「정기 실행」 · 설정 · 확인: docs/engineering/07-environment-setup.md
-- 「손님 메시지 정기 실행 (pg_cron + pg_net + Vault)」
--
-- ## 왜 vercel.json 이 아닌가
--
-- 지금 vercel.json 크론은 하루 한 번짜리뿐이고, Vercel 요금제가 확인되지 않았다 — Hobby 는 하루보다 짧은 크론을
-- 받지 않아 배포가 실패할 수 있다. Beds24 틱(`202609300004_beds24_tick_cron.sql`)과 같은 Supabase pg_cron + pg_net
-- 방식을 그대로 쓴다.
--
-- ## 어떻게
--
-- 잡 3개가 각각 `guest_messages_cron_fire(종류)` 를 부른다. 이 함수는 DB 안에서 싸게 판단하고 **할 일이 있을 때만**
-- `net.http_post` 로 앱 라우트를 부른다.
--   reconcile (15분) → /api/beds24/messages-reconcile  — 놓친 메시지 보정 조회(Beds24 크레딧을 쓴다). 늘 부른다.
--   outbox    (5분)  → /api/guest-messages/outbox      — 보낼 시각이 된 queued 줄 · 10분 넘게 멈춘 sending 줄이 있을 때만.
--   auto      (5분)  → /api/guest-messages/auto        — 켜 둔 자동 안내 규칙이 하나라도 있을 때만.
-- 실제 발송은 앱의 `GUEST_MESSAGES_SEND_ENABLED=1` 일 때만이다(꺼져 있으면 라우트가 202 로 아무것도 안 함).
-- `BEDS24_SYNC_PAUSED` 면 보정 조회 라우트가 202 로 아무것도 안 한다.
--
-- ## 비밀값
--
-- 토큰은 **이 SQL 안에서 난수로 만든다** — 값이 저장소 · 채팅 · 로그 어디에도 나오지 않는다. 라우트는
-- `guest_messages_cron_token_ok()` 로 대조만 한다(사람이 손으로 부를 때를 위해 `CRON_SECRET` 도 그대로 받는다).
-- 새 환경변수가 없다. 주소는 Vault `guest_messages_cron_base_url`(도메인을 옮기면 vault.update_secret 으로 바꾼다).
--
-- 다시 적용해도 같은 결과(시크릿은 없을 때만 만들고, 잡은 지운 뒤 다시 건다).

create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── ① Vault — 토큰(난수)과 앱 주소 ───────────────────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'guest_messages_cron_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'guest_messages_cron_token',
      'Bearer token pg_cron sends to the guest-message routes. Rotate with vault.update_secret; never print.'
    );
  end if;
  -- 프로덕션 도메인: docs/engineering/07-environment-setup.md (Beds24 틱과 같은 주소)
  if not exists (select 1 from vault.secrets where name = 'guest_messages_cron_base_url') then
    perform vault.create_secret(
      'https://stay-ops-two.vercel.app',
      'guest_messages_cron_base_url',
      'App origin pg_cron calls for guest-message reconcile / outbox / auto (no trailing slash).'
    );
  end if;
end;
$$;

-- ── ② 토큰 대조 — 라우트가 서비스 롤로 부른다 ──────────────────────────────────
-- 값을 돌려주지 않고 맞는지만. 원문 대신 SHA-256 다이제스트끼리 비교한다(beds24_tick_token_ok 와 같음).
create or replace function public.guest_messages_cron_token_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select length(p_token) >= 32
         and extensions.digest(p_token, 'sha256') = extensions.digest(s.decrypted_secret, 'sha256')
        from vault.decrypted_secrets s
       where s.name = 'guest_messages_cron_token'
       limit 1
    ),
    false
  );
$$;

revoke all on function public.guest_messages_cron_token_ok(text) from public, anon, authenticated;
grant execute on function public.guest_messages_cron_token_ok(text) to service_role;

-- ── ③ 부를지 판단하고, 필요할 때만 부른다 ──────────────────────────────────────
-- 돌려주는 값은 `cron.job_run_details.return_message` 에 남는다.
--   'idle'            할 일이 없다(outbox · auto)
--   'not_configured'  Vault 에 토큰 · 주소가 없다
--   'invalid_kind'    모르는 종류
--   'fired'           불렀다
create or replace function public.guest_messages_cron_fire(p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_base text;
  v_token text;
begin
  if p_kind = 'reconcile' then
    v_path := '/api/beds24/messages-reconcile';
  elsif p_kind = 'outbox' then
    -- 앱 발송 작업과 같은 기준: 보낼 시각이 된 queued 줄, 10분 넘게 멈춘 sending 줄(→ uncertain 으로 푼다).
    if not exists (
      select 1 from public.guest_message_outbox
       where (status = 'queued' and next_try_at <= now())
          or (status = 'sending' and claimed_at < now() - interval '10 minutes')
    ) then
      return 'idle';
    end if;
    v_path := '/api/guest-messages/outbox';
  elsif p_kind = 'auto' then
    if not exists (select 1 from public.auto_message_rules where enabled) then
      return 'idle';
    end if;
    v_path := '/api/guest-messages/auto';
  else
    return 'invalid_kind';
  end if;

  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'guest_messages_cron_base_url' limit 1;
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'guest_messages_cron_token' limit 1;
  if v_base is null or v_token is null then
    return 'not_configured';
  end if;

  -- 라우트가 최대 60초 돈다. 응답(JSON 요약)은 `net._http_response` 에 몇 시간 남는다.
  perform net.http_post(
    url := rtrim(v_base, '/') || v_path,
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

revoke all on function public.guest_messages_cron_fire(text) from public, anon, authenticated;
grant execute on function public.guest_messages_cron_fire(text) to service_role;

-- ── ④ 잡 3개 — 지운 뒤 다시 건다 ─────────────────────────────────────────────
-- 같은 분에 몰리지 않게 시작 분을 엇갈린다(보정 조회 2 · 17 · 32 · 47분, 발송 1분대, 자동 안내 3분대).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'guest-messages-reconcile') then
    perform cron.unschedule('guest-messages-reconcile');
  end if;
  perform cron.schedule('guest-messages-reconcile', '2-59/15 * * * *', $job$select public.guest_messages_cron_fire('reconcile')$job$);

  if exists (select 1 from cron.job where jobname = 'guest-messages-outbox') then
    perform cron.unschedule('guest-messages-outbox');
  end if;
  perform cron.schedule('guest-messages-outbox', '1-59/5 * * * *', $job$select public.guest_messages_cron_fire('outbox')$job$);

  if exists (select 1 from cron.job where jobname = 'guest-messages-auto') then
    perform cron.unschedule('guest-messages-auto');
  end if;
  perform cron.schedule('guest-messages-auto', '3-59/5 * * * *', $job$select public.guest_messages_cron_fire('auto')$job$);
end;
$$;
