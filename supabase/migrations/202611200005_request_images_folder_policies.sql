-- request-images 사진 폴더 되살리기 + 폴더 목록을 함수 하나로 (2026-11-20)
--
-- 도메인 계약: docs/engineering/05-rls-permissions.md 「2026-11-20 request-images 폴더 되살리기」,
--   코드 기준 목록 src/lib/request-image-folders.ts, 회귀 테스트 src/lib/__tests__/request-image-folders-policy.test.ts
--
-- 버그: 올리기 · 지우기 정책("org members can upload/delete request images")을 다시 만드는 마이그레이션마다 폴더 목록을 통째로 다시 적었다.
--   202606290001 까지는 12개 폴더였는데 202607160001(수리 완료 사진)이 4개 목록으로 덮어써 나머지가 빠졌고,
--   202607170001 · 202610220001 · 202611100002 가 그 짧은 목록을 이어받았다(202611100002 는 linen-returns 만 되살림).
--   그래서 브라우저(사용자 키)로 올리는 할 일 · 할 일 메모 · 제안 · 근태 정정 · 게시판 글 · 게시판 댓글 사진이 막혀 있었다.
--
-- 고친 것
--   1) public.request_image_folder_allows(폴더, 역할) — 폴더 목록 · 폴더별 역할 조건을 이 함수 하나에 둔다. 정책은 이 함수만 부른다.
--      앞으로 폴더를 더할 때는 이 함수만 create or replace(목록 전체를 그대로 두고 한 줄 더하기) — 정책을 다시 만들지 않는다.
--   2) 되살린 폴더의 역할 조건은 마지막으로 그 폴더가 있던 정의(202606290001) 그대로:
--      suggestion-images · attendance-corrections · board-posts · board-comments = 아르바이트 포함 활성 멤버,
--      task-images · task-update-images = 아르바이트 제외.
--      기존 6개 폴더는 지금 그대로(202610220001 결정 — 아르바이트 포함).
--   3) 지우기는 지금 규칙 그대로(202610220001 · 202611100002): 활성 멤버 + (내가 올린 것 또는 request.delete_any,
--      linen-returns 는 linen.manage). 되살린 폴더도 이 규칙 — 예전(06-29)의 「조직 멤버 누구나 남의 사진 지우기」는 되살리지 않는다.
--   4) 경로 검사(4칸 · 조직 id · 기록 id uuid 형식 · 파일 이름 길이 · 글자)는 그대로. 플랫폼 관리자도 예전처럼 목록 안 폴더만.
--   bug-reports · complaint-images · complaint-comment-images 는 서버(service role)만 올리므로 목록에 넣지 않는다(정책을 거치지 않음).
--
-- 배포 순서: 이 마이그레이션만 적용하면 된다(앱 코드는 이미 이 폴더들로 올리고 있다 — 적용 즉시 막힌 업로드가 풀린다). 다시 돌려도 같은 결과.
--
-- 되돌리기(필요할 때만 — 되돌리면 위 6개 폴더가 다시 막힌다):
--   202611100002_linen_returns_hardening.sql 의 「1) 요청 사진 저장소 정책」 두 정책 블록을 그대로 다시 실행한 뒤
--   drop function if exists public.request_image_folder_allows(text, public.organization_role);
--
-- 확인 SQL(읽기만):
--   select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
--     and coalesce(with_check, qual) like '%request_image_folder_allows%';
--   select public.request_image_folder_allows('board-posts', 'part_time_staff'), public.request_image_folder_allows('task-images', 'part_time_staff');
--   -- 기대: 정책 2줄, true · false

-- ── 1) 폴더 함수 ──────────────────────────────────────────────────────────────────────────────────────────
-- p_role 은 그 조직에서의 역할. 플랫폼 관리자는 null 로 부른다(역할 조건 없이 목록 안 폴더면 통과).
create or replace function public.request_image_folder_allows(p_folder text, p_role public.organization_role)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    -- 그 조직 활성 멤버 누구나(아르바이트 포함). src/lib/request-image-folders.ts REQUEST_IMAGE_FOLDERS_ALL_MEMBERS 와 같아야 한다.
    when p_folder = any (array[
      'lost-items', 'lost-found-handling', 'maintenance-reports', 'maintenance-resolutions', 'order-images', 'linen-returns',
      'suggestion-images', 'attendance-corrections', 'board-posts', 'board-comments'
    ]) then true
    -- 아르바이트 제외. REQUEST_IMAGE_FOLDERS_NO_PART_TIME 과 같아야 한다.
    when p_folder = any (array['task-images', 'task-update-images'])
      then p_role is distinct from 'part_time_staff'::public.organization_role
    else false
  end
$$;

comment on function public.request_image_folder_allows(text, public.organization_role) is
  'request-images 버킷 4칸 경로의 폴더(2번째 칸) 허용 여부. 폴더를 더할 때는 이 함수만 바꾼다 — 기준 목록 src/lib/request-image-folders.ts.';

revoke all on function public.request_image_folder_allows(text, public.organization_role) from public;
-- Supabase 기본 권한이 anon 에 따로 준 실행 권한은 public 회수로 안 없어진다 — 따로 거둔다(정책은 authenticated 만).
revoke execute on function public.request_image_folder_allows(text, public.organization_role) from anon;
grant execute on function public.request_image_folder_allows(text, public.organization_role) to authenticated, service_role;

-- ── 2) 올리기 ─────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "org members can upload request images" on storage.objects;
create policy "org members can upload request images" on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'request-images')
    and (array_length(string_to_array(name, '/'), 1) = 4)
    and (split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (char_length(split_part(name, '/', 4)) between 3 and 160)
    and (split_part(name, '/', 4) ~ '^[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9]$')
    and (
      (
        exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()) and pa.is_active = true)
        and public.request_image_folder_allows(split_part(name, '/', 2), null)
      )
      or exists (
        select 1 from public.memberships m
        where (m.organization_id)::text = split_part(objects.name, '/', 1)
          and m.user_id = (select auth.uid())
          and m.status = 'active'
          and public.request_image_folder_allows(split_part(objects.name, '/', 2), m.role)
      )
    )
  );

-- ── 3) 지우기 ─────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "org members can delete request images" on storage.objects;
create policy "org members can delete request images" on storage.objects
  for delete to authenticated
  using (
    (bucket_id = 'request-images')
    and (array_length(string_to_array(name, '/'), 1) = 4)
    and (split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (
      (
        exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()) and pa.is_active = true)
        and public.request_image_folder_allows(split_part(name, '/', 2), null)
      )
      or (
        exists (
          select 1 from public.memberships m
          where (m.organization_id)::text = split_part(objects.name, '/', 1)
            and m.user_id = (select auth.uid())
            and m.status = 'active'
            and public.request_image_folder_allows(split_part(objects.name, '/', 2), m.role)
        )
        and (
          owner_id = ((select auth.uid()))::text
          or public.has_capability(
            case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(name, '/', 1)::uuid end,
            (select auth.uid()),
            case when split_part(name, '/', 2) = 'linen-returns' then 'linen.manage' else 'request.delete_any' end
          )
        )
      )
    )
  );
