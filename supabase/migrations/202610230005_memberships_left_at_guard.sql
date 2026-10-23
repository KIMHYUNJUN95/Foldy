-- memberships.left_at 은 서버(트리거)만 정한다 (2026-10-23 점검).
--
-- 202610230004 의 트리거는 status 가 바뀔 때만 돌아서, 상태는 그대로 두고 left_at 만 바꾸는 요청(멤버십을 관리할 수 있는
-- 사무실 관리자의 직접 요청)을 막지 못했다. left_at 을 과거로 당기면 다음 날 정리 작업이 신분 서류를 3년 전에 하드 삭제한다.
-- 이제 insert · 모든 update 에서 호출자가 보낸 left_at 을 무시하고 상태로부터 다시 정한다.

create or replace function public.memberships_track_left_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status not in ('suspended', 'removed') then
    new.left_at := null;
  elsif tg_op = 'INSERT' or old.status not in ('suspended', 'removed') then
    new.left_at := now();
  else
    -- 떠난 상태끼리(suspended ↔ removed) 또는 다른 칸만 바뀜 — 처음 떠난 시각을 그대로(호출자 값 무시).
    new.left_at := coalesce(old.left_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_track_left_at on public.memberships;
create trigger memberships_track_left_at
before insert or update on public.memberships
for each row
execute function public.memberships_track_left_at();
