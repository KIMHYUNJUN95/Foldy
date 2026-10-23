-- 멤버십 「떠난 시각」 — 신분 서류 보관 기한(퇴사 3년 뒤 삭제, docs/product/41 §6)을 잴 기준 (2026-10-23).
--
-- 지금까지 퇴사는 `memberships.status` 가 suspended · removed 로만 남았고 언제 바뀌었는지가 없었다(invited 는 아직 안 들어온 것 — 퇴사 아님).
-- `updated_at` 은 팀 · 역할 변경에도 바뀌어 기준으로 쓸 수 없다.
--
-- 규칙(트리거):
--   * active · invited 로 바뀌면 left_at = null (복직하면 기한이 사라진다).
--   * 그 밖에서 suspended · removed 로 바뀌면 left_at = now().
--   * 떠난 상태끼리(suspended → removed) 바뀌면 처음 떠난 시각을 그대로 둔다. 비어 있으면 now().
-- 기존 비활성 멤버십은 `updated_at` 을 떠난 시각으로 채운다(근사값 — 실제보다 늦을 수는 있어도 이르지 않아 일찍 지우는 일은 없다).

alter table public.memberships add column if not exists left_at timestamptz;

comment on column public.memberships.left_at is '떠난(suspended · removed) 시각. active · invited 면 null. 신분 서류 보관 기한 기준(docs/product/41 §6)';

update public.memberships
set left_at = updated_at
where status in ('suspended', 'removed') and left_at is null;

create or replace function public.memberships_track_left_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status not in ('suspended', 'removed') then
    new.left_at := null;
  elsif old.status not in ('suspended', 'removed') or new.left_at is null then
    new.left_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_track_left_at on public.memberships;
create trigger memberships_track_left_at
before update of status on public.memberships
for each row
when (old.status is distinct from new.status)
execute function public.memberships_track_left_at();
