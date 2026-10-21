-- 사진 업로드 규칙의 「아르바이트 제외」를 없앤다 (2026-10-22).
--
-- 도메인 계약: docs/engineering/05-rls-permissions.md 「저장소 사진 규칙」, docs/product/27-permission-override-workflow.md
--
-- 버그: 수리 · 분실물 · 주문 요청 사진 업로드(`request-images`)가 `m.role <> 'part_time_staff'` 로 막혀 있어 아르바이트는 요청을 쓰면서
-- 사진을 올리지 못했다(아르바이트 리더는 됐다). 요청 작성은 전원이 하는 일이라 활성 멤버면 올릴 수 있게 한다.
-- 지우기는 「내가 올린 사진」 또는 남의 요청 삭제 권한(`request.delete_any`)으로 좁힌다 — 아르바이트에게 남의 사진 지우기까지 열지 않는다.
-- 공지 사진은 역할 비교 대신 공지 작성 권한(`announcement.create`) — 사람마다 켠 작성 권한으로 사진도 올라가게.
-- 경로 첫 칸(조직 id)은 앞의 정규식 검사와 별개로 안전하게 uuid 로 바꾼다(형식이 틀리면 null → 권한 없음).

drop policy if exists "org members can upload request images" on storage.objects;
create policy "org members can upload request images" on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'request-images')
    and (array_length(string_to_array(name, '/'), 1) = 4)
    and (split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (split_part(name, '/', 2) = any (array['lost-items', 'lost-found-handling', 'maintenance-reports', 'maintenance-resolutions', 'order-images']))
    and (split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (char_length(split_part(name, '/', 4)) between 3 and 160)
    and (split_part(name, '/', 4) ~ '^[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9]$')
    and (
      exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true)
      or exists (
        select 1 from public.memberships m
        where (m.organization_id)::text = split_part(objects.name, '/', 1)
          and m.user_id = auth.uid()
          and m.status = 'active'
      )
    )
  );

drop policy if exists "org members can delete request images" on storage.objects;
create policy "org members can delete request images" on storage.objects
  for delete to authenticated
  using (
    (bucket_id = 'request-images')
    and (array_length(string_to_array(name, '/'), 1) = 4)
    and (split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (split_part(name, '/', 2) = any (array['lost-items', 'lost-found-handling', 'maintenance-reports', 'maintenance-resolutions', 'order-images']))
    and (split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (
      exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true)
      or (
        exists (
          select 1 from public.memberships m
          where (m.organization_id)::text = split_part(objects.name, '/', 1)
            and m.user_id = auth.uid()
            and m.status = 'active'
        )
        and (
          owner_id = (auth.uid())::text
          or public.has_capability(
            case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(name, '/', 1)::uuid end,
            auth.uid(),
            'request.delete_any'
          )
        )
      )
    )
  );

drop policy if exists "org members can upload announcement images" on storage.objects;
create policy "org members can upload announcement images" on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'announcement-images')
    and (array_length(string_to_array(name, '/'), 1) = 3)
    and (split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    and (char_length(split_part(name, '/', 3)) between 3 and 160)
    and (split_part(name, '/', 3) ~ '^[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9]$')
    and (
      exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true)
      or public.has_capability(
        case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid end,
        auth.uid(),
        'announcement.create'
      )
    )
  );
