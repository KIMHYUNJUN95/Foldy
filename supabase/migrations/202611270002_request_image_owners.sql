-- request-images 사진을 「누가 올렸는지」 서버가 읽는 함수(2026-11-27).
--
-- 근태 정정 · 연차 사진은 그 사진을 올린 본인(또는 attendance.manage · leave.approve)만 연다(결정 A).
-- 예전 본인 확인은 「내 기록의 image_urls 에 그 주소가 있는가」였는데, 정정 저장 검사는 조직 · 폴더 모양만 봐서
-- 남의 사진 주소를 내 요청에 넣고 열 수 있었다. 이제 라우트(src/app/api/request-images/[...path]/route.ts)와
-- 정정 저장(src/app/mobile/attendance/actions.ts)이 storage.objects.owner_id 로 확인한다.
-- storage 스키마는 PostgREST 로 노출되지 않으므로 service role 전용 SECURITY DEFINER 함수로 읽는다.
--
-- 적용 순서: 이 SQL 을 **앱 코드 배포 전에** 먼저 적용한다(없으면 사진 붙인 정정 요청이 「오류」로 막히고
-- 본인 사진 열기가 403). 202611270001(버킷 비공개)은 코드 배포 뒤. 이 함수만 먼저 들어가도 지금 운영에는 영향이 없다.
-- 되돌리기: drop function if exists public.request_image_owners(text[]);

create or replace function public.request_image_owners(p_names text[])
returns table (name text, owner_id text)
language sql
security definer
set search_path = ''
stable
as $$
  select o.name, coalesce(o.owner_id, o.owner::text)
  from storage.objects o
  where o.bucket_id = 'request-images'
    and coalesce(array_length(p_names, 1), 0) <= 20
    and o.name = any (p_names);
$$;

revoke all on function public.request_image_owners(text[]) from public, anon, authenticated;
grant execute on function public.request_image_owners(text[]) to service_role;
