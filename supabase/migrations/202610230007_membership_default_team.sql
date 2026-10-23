-- 소속(현장/사무실) 기본값 — 2026-10-23. docs/product/01-user-roles.md → 「Team (소속) Assignment」.
--
-- 202607140001_teams.sql 은 그때 있던 멤버만 역할로 한 번 채웠다. 그 뒤 가입한 사람은 소속이 비어(미지정)
-- 사용자 화면의 소속 필터(현장/사무실)로 아무도 안 나왔다(운영: 13명 중 12명 미지정). 그래서:
--   1) 지금 비어 있는 멤버를 같은 규칙으로 채운다(이미 소속이 있는 사람은 그대로).
--   2) 앞으로 멤버십이 생길 때 소속이 비어 있으면 같은 규칙으로 넣는다(트리거). 그 조직에 기본 소속이 없으면 만든다.
-- 규칙: field_manager · staff(아르바이트 리더) · part_time_staff → 현장, 나머지 → 사무실. 관리자는 뒤에 언제든 바꿀 수 있다.

-- 기본 소속이 없는 조직에 두 개를 만든다(07-14 뒤에 생긴 조직).
insert into public.teams (organization_id, name, kind)
select o.id, '현장', 'field'::public.team_kind
from public.organizations o
where not exists (select 1 from public.teams t where t.organization_id = o.id and t.kind = 'field');

insert into public.teams (organization_id, name, kind)
select o.id, '사무실', 'office'::public.team_kind
from public.organizations o
where not exists (select 1 from public.teams t where t.organization_id = o.id and t.kind = 'office');

create or replace function public.default_team_kind_for_role(p_role text)
returns public.team_kind
language sql
immutable
as $$
  select (case when p_role in ('field_manager', 'staff', 'part_time_staff') then 'field' else 'office' end)::public.team_kind;
$$;

-- 1) 지금 비어 있는 멤버 채우기 — 그 종류의 가장 먼저 만든 소속으로.
update public.memberships m
set team_id = (
  select t.id
  from public.teams t
  where t.organization_id = m.organization_id
    and t.kind = public.default_team_kind_for_role(m.role::text)
  order by t.created_at, t.id
  limit 1
)
where m.team_id is null;

-- 2) 새 멤버십 — 소속이 비어 있으면 역할로 기본 소속(그 조직에 없으면 만든다).
create or replace function public.memberships_default_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind public.team_kind;
  v_team uuid;
begin
  if new.team_id is not null then
    return new;
  end if;
  v_kind := public.default_team_kind_for_role(new.role::text);
  select t.id into v_team
  from public.teams t
  where t.organization_id = new.organization_id and t.kind = v_kind
  order by t.created_at, t.id
  limit 1;
  if v_team is null then
    insert into public.teams (organization_id, name, kind)
    values (new.organization_id, case when v_kind = 'field' then '현장' else '사무실' end, v_kind)
    returning id into v_team;
  end if;
  new.team_id := v_team;
  return new;
end;
$$;

revoke all on function public.memberships_default_team() from public, anon, authenticated;

drop trigger if exists memberships_default_team on public.memberships;
create trigger memberships_default_team
  before insert on public.memberships
  for each row
  execute function public.memberships_default_team();
