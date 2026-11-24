-- request-images — 읽기(SELECT) 정책: 내가 방금 올린 사진만 + 아르바이트도 할 일 사진 올리기 (2026-11-24)
--
-- 도메인 계약: docs/engineering/05-rls-permissions.md 「2026-11-24 request-images 읽기 정책 · 할 일 사진 아르바이트 허용」,
--   코드 기준 목록 src/lib/request-image-folders.ts, 회귀 테스트 src/lib/__tests__/request-image-folders-policy.test.ts
--   (앞 마이그레이션 202611200005_request_images_folder_policies.sql 은 그대로 둔다 — 운영 적용됨. 올리기 · 지우기 정책도 다시 만들지 않는다.)
--
-- 1) 읽기 정책 "uploaders can read own recent request images" (storage.objects, select, authenticated)
--    이 버킷에는 SELECT 정책이 없어서 브라우저(사용자 키) remove() 가 지울 행을 못 보고 오류 없이 0행을 지웠다 — 즉 지우기 정책은 브라우저에서 한 번도 작동한 적이 없다.
--    앱이 브라우저 remove() 를 쓰는 곳은 「방금 올리고 아직 저장 안 한 내 사진 되지우기」뿐이다
--    (removeRequestImages · removeBoardUploads · uploadRequestImages 실패 되지우기 · 사진 시트 그만두기).
--    그래서 읽기는 「내가 올린 것(owner_id) + 올린 지 1시간 안」만 연다. 브라우저에서 실제로 지울 수 있는 행 = 지우기 정책 ∩ 이 읽기 정책
--    = 내 조직 · 목록 안 폴더 · 내가 1시간 안에 올린 사진. 남의 사진 지우기(request.delete_any · linen.manage · 플랫폼 관리자 갈래)는 브라우저에서 계속 0행이고,
--    지금처럼 서버(service role) 정리가 맡는다. 「지우기와 같은 조건」으로 열면 지우기 정책 전체(이미 제출한 증빙 지우기, 권한자의 남의 사진 지우기 ·
--    list() 로 남의 경로 받기, 플랫폼 관리자의 모든 조직)가 처음으로 실제 권한이 되므로 그렇게 하지 않았다.
--    공개 버킷이라 공개 주소 읽기는 원래 정책을 안 거친다 — 이 정책은 목록(list) · 지우기용 행 보임만 연다.
--    칼럼: storage.objects.owner_id 는 text(Supabase storage 스키마 — 202610220001 정책도 owner_id = (auth.uid())::text 로 비교),
--    created_at 은 timestamptz default now()(storage 기본 칼럼, 올릴 때 서버가 채움). 4칸 경로 모양 검사는 지우기 정책과 같은 첫 두 줄만 둔다.
-- 2) 폴더 함수 public.request_image_folder_allows — task-images · task-update-images 의 아르바이트(part_time_staff) 제외를 없앤다(사용자 승인 2026-11-24).
--    이제 목록 안 모든 폴더 = 그 조직 활성 멤버 누구나. 그 밖의 폴더 · 역할 조건은 그대로. p_role 인자는 정책 호출 모양을 바꾸지 않으려고 남긴다(지금은 안 씀).
--    5칸 경로(교통비 · 휴가)는 4칸 검사에 걸려 이 함수 · 정책과 상관없다(그쪽 정책 그대로).
--
-- 배포 순서: **앱 코드가 먼저.** 발주 등록 시트 · 청소 중 수리 신고 시트가 「저장 중에는 닫기(그만두기)를 막는」 수정
--   (order-create-form.tsx · maintenance-linked-form.tsx · maintenance-confirm-modal.tsx)이 운영에 배포된 뒤에 이 SQL 을 적용한다.
--   이유: 이 정책이 들어가면 그만두기의 remove() 가 실제로 지우므로, 저장 중에 시트를 닫으면 막 저장되는 기록의 사진이 지워질 수 있다.
--   적용은 대시보드 SQL 편집기에 통째로 붙여 한 번에 실행. 다시 돌려도 같은 결과.
--
-- 되돌리기(필요할 때만):
--   drop policy if exists "uploaders can read own recent request images" on storage.objects;
--   아르바이트 할 일 사진까지 되돌리려면 202611200005_request_images_folder_policies.sql 의 「1) 폴더 함수」 블록을 다시 실행.
--   (읽기 정책을 지우면 브라우저 remove() 가 다시 0행을 지운다 — 오늘 운영과 같은 상태.)
--
-- 확인 SQL(읽기만):
--   select policyname, cmd, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL');
--   -- 기대: request-images 를 다루는 SELECT 는 "uploaders can read own recent request images" 하나, qual 에 bucket_id 조건이 없는 정책 0개
--   select public.request_image_folder_allows('task-images', 'part_time_staff'),
--          public.request_image_folder_allows('task-update-images', 'part_time_staff'),
--          public.request_image_folder_allows('bug-reports', 'staff');
--   -- 기대: true · true · false
--   select has_function_privilege('anon', 'public.request_image_folder_allows(text, public.organization_role)', 'execute');
--   -- 기대: false

-- ── 1) 폴더 함수 — 할 일 두 폴더의 아르바이트 제외 없앰 ─────────────────────────────────────────────────────
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
      'suggestion-images', 'attendance-corrections', 'board-posts', 'board-comments',
      'task-images', 'task-update-images'
    ]) then true
    else false
  end
$$;

comment on function public.request_image_folder_allows(text, public.organization_role) is
  'request-images 버킷 4칸 경로의 폴더(2번째 칸) 허용 여부. 폴더를 더할 때는 이 함수만 바꾼다 — 기준 목록 src/lib/request-image-folders.ts. p_role 은 지금 안 씀(2026-11-24 할 일 폴더 아르바이트 제외 없앰).';

revoke all on function public.request_image_folder_allows(text, public.organization_role) from public;
-- Supabase 기본 권한이 anon 에 따로 준 실행 권한은 public 회수로 안 없어진다 — 따로 거둔다(정책은 authenticated 만).
revoke execute on function public.request_image_folder_allows(text, public.organization_role) from anon;
grant execute on function public.request_image_folder_allows(text, public.organization_role) to authenticated, service_role;

-- ── 2) 읽기 — 내가 1시간 안에 올린 사진만 ─────────────────────────────────────────────────────────────────────
drop policy if exists "uploaders can read own recent request images" on storage.objects;
create policy "uploaders can read own recent request images" on storage.objects
  for select to authenticated
  using (
    (bucket_id = 'request-images')
    and (array_length(string_to_array(name, '/'), 1) = 4)
    and (split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (owner_id = ((select auth.uid()))::text)
    and (created_at > now() - interval '1 hour')
  );
