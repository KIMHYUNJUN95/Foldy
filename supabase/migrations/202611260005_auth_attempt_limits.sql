-- 로그인 · 가입 · 확인 메일 다시 보내기 · 비밀번호 재설정 시도 제한(2026-11-26, 보안 점검).
--
-- `src/app/auth/actions.ts` 는 서버에서 Supabase Auth 를 부른다. Supabase 의 IP 별 제한은 그래서 손님 IP 가 아니라
-- Vercel 서버 IP 를 본다 — 사실상 보호가 없거나, 한 사람이 모든 직원 로그인을 429 로 막을 수 있다.
-- 앱이 Supabase 를 부르기 전에 이 표에 시도를 남기고, 창(window) 안 횟수가 한도를 넘으면 거절한다.
--
--   · 여러 Vercel 인스턴스가 같은 표를 보므로 메모리 제한기와 달리 인스턴스를 넘어 맞는다.
--   · 이메일 · IP 원문은 두지 않는다 — 앱이 sha256 으로 바꿔 보낸다(`src/lib/auth-attempt-limit.ts`).
--   · 한도 · 창 길이는 앱이 넘긴다(한 곳에서 고치고 테스트하도록). 함수는 세고 · 남기고 · 판정만 한다.
--   · 거절된 시도는 남기지 않는다 — 창이 미끄러지며 한도만큼은 계속 다시 열린다.
--   · 쓰기 · 읽기는 서버(service_role)만. RLS 켜고 정책 없음, anon · authenticated 권한 없음.
--   · 하루 지난 줄은 매시 pg_cron 이 지운다.

create table if not exists public.auth_attempts (
  id bigint generated always as identity primary key,
  action text not null check (action in ('sign_in', 'sign_up', 'resend_signup', 'password_reset')),
  key_kind text not null check (key_kind in ('email', 'ip')),
  key_hash text not null check (char_length(key_hash) = 64),
  attempted_at timestamptz not null default now()
);

create index if not exists auth_attempts_lookup_idx
  on public.auth_attempts (action, key_kind, key_hash, attempted_at desc);
create index if not exists auth_attempts_attempted_at_idx
  on public.auth_attempts (attempted_at);

alter table public.auth_attempts enable row level security;
revoke all on table public.auth_attempts from public, anon, authenticated;
grant all on table public.auth_attempts to service_role;

-- 시도 하나를 판정하고, 통과면 남긴다. true = 통과, false = 한도 초과.
-- 같은 키(동작 · 종류 · 해시)는 트랜잭션 advisory lock 으로 줄 세워 「세고 → 남기기」 사이에 끼어들지 못하게 한다.
-- 잠그는 순서는 늘 이메일 → IP 라 서로 기다리다 멈추는(deadlock) 일이 없다.
-- p_email_hash · p_ip_hash 가 null 이면 그 키는 세지 않는다(IP 를 모르는 로컬 개발 등).
create or replace function public.take_auth_attempt(
  p_action text,
  p_email_hash text,
  p_ip_hash text,
  p_window_seconds integer,
  p_email_limit integer,
  p_ip_limit integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_count integer;
begin
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'invalid window';
  end if;
  if p_email_limit is null or p_email_limit < 1 or p_ip_limit is null or p_ip_limit < 1 then
    raise exception 'invalid limit';
  end if;
  v_since := now() - make_interval(secs => p_window_seconds);

  if p_email_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('auth_attempt|' || p_action || '|email|' || p_email_hash, 0));
    select count(*) into v_count
      from public.auth_attempts
     where action = p_action and key_kind = 'email' and key_hash = p_email_hash and attempted_at > v_since;
    if v_count >= p_email_limit then
      return false;
    end if;
  end if;

  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('auth_attempt|' || p_action || '|ip|' || p_ip_hash, 0));
    select count(*) into v_count
      from public.auth_attempts
     where action = p_action and key_kind = 'ip' and key_hash = p_ip_hash and attempted_at > v_since;
    if v_count >= p_ip_limit then
      return false;
    end if;
  end if;

  if p_email_hash is not null then
    insert into public.auth_attempts (action, key_kind, key_hash) values (p_action, 'email', p_email_hash);
  end if;
  if p_ip_hash is not null then
    insert into public.auth_attempts (action, key_kind, key_hash) values (p_action, 'ip', p_ip_hash);
  end if;

  return true;
end;
$$;

revoke all on function public.take_auth_attempt(text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.take_auth_attempt(text, text, text, integer, integer, integer) to service_role;

-- 하루 지난 시도 지우기 — 매시 23분.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'auth-attempts-cleanup') then
    perform cron.unschedule('auth-attempts-cleanup');
  end if;
  perform cron.schedule(
    'auth-attempts-cleanup',
    '23 * * * *',
    $cron$ delete from public.auth_attempts where attempted_at < now() - interval '1 day' $cron$
  );
end;
$$;
