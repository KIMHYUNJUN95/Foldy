-- RLS 권한 함수를 행마다가 아니라 쿼리당 한 번 (2026-10-16 성능 점검).
--
-- 조직 소속 정책이 `has_active_membership(organization_id)` 를 **행마다** 불렀다. 이 함수는
-- SECURITY DEFINER 라 인라인되지 않아, 예약 1,500행을 읽으면 memberships 조회도 1,500번이다.
-- 그 결과 11행짜리 memberships 가 2,200만 번, 1행짜리 platform_admins 가 4,600만 번 훑였고,
-- 판매가(room_daily_rates) 평균 812ms · 예약 544ms 의 큰 몫이었다. 판매가 · 차단 정책은
-- `auth.uid()` · `is_platform_admin()` 까지 감싸지 않아 행마다 돌았다(Supabase 어드바이저
-- auth_rls_initplan 경고 3건).
--
-- 바꾸는 것 — 권한 결과는 같고 계산 횟수만 줄인다:
-- 1. `current_user_active_organization_ids()` — 내 활성 소속 조직 id 배열. SECURITY DEFINER 라
--    memberships RLS 를 다시 타지 않는다(memberships 자기 정책에서 써도 재귀 없음).
-- 2. 정책 안의 `has_active_membership(organization_id)`(그 표 자신의 열) →
--    `organization_id = ANY ((( SELECT current_user_active_organization_ids() ))::uuid[])`.
--    `( SELECT … )` 로 감싸 InitPlan 이 되어 쿼리당 한 번만 계산된다.
--    NULL 조직 · 소속 없음 → 예전처럼 false.
--    하위 쿼리 안의 `has_active_membership(a.organization_id)` 같은 다른 형태는 그대로 둔다.
-- 3. 감싸지 않은 `is_platform_admin()` · `auth.uid()` → `( SELECT … )`.
--
-- 정책 이름 · 대상 역할 · 명령은 ALTER POLICY 라 그대로다. 바뀐 식만 다시 쓴다.

create or replace function public.current_user_active_organization_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m.organization_id), '{}'::uuid[])
  from public.memberships m
  where m.user_id = auth.uid()
    and m.status = 'active';
$$;

revoke all on function public.current_user_active_organization_ids() from public;
grant execute on function public.current_user_active_organization_ids() to authenticated, anon, service_role;

do $$
declare
  p record;
  new_qual text;
  new_check text;
  stmt text;
  changed int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    new_qual := p.qual;
    new_check := p.with_check;

    if new_qual is not null then
      new_qual := replace(
        new_qual,
        'has_active_membership(organization_id)',
        '(organization_id = ANY ((( SELECT current_user_active_organization_ids() AS current_user_active_organization_ids))::uuid[]))'
      );
      new_qual := regexp_replace(new_qual, '(?<!SELECT )is_platform_admin\(\)', '( SELECT is_platform_admin() AS is_platform_admin)', 'g');
      new_qual := regexp_replace(new_qual, '(?<!SELECT )auth\.uid\(\)', '( SELECT auth.uid() AS uid)', 'g');
    end if;

    if new_check is not null then
      new_check := replace(
        new_check,
        'has_active_membership(organization_id)',
        '(organization_id = ANY ((( SELECT current_user_active_organization_ids() AS current_user_active_organization_ids))::uuid[]))'
      );
      new_check := regexp_replace(new_check, '(?<!SELECT )is_platform_admin\(\)', '( SELECT is_platform_admin() AS is_platform_admin)', 'g');
      new_check := regexp_replace(new_check, '(?<!SELECT )auth\.uid\(\)', '( SELECT auth.uid() AS uid)', 'g');
    end if;

    if new_qual is distinct from p.qual or new_check is distinct from p.with_check then
      stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
      if new_qual is not null then
        stmt := stmt || format(' using (%s)', new_qual);
      end if;
      if new_check is not null then
        stmt := stmt || format(' with check (%s)', new_check);
      end if;
      execute stmt;
      changed := changed + 1;
    end if;
  end loop;

  raise notice 'rls policies rewritten: %', changed;
end $$;
