-- 린넨 반품 품목 행 INSERT 정책을 UPDATE · DELETE 와 같은 범위로 맞춘다.
--
-- 202606100002 의 INSERT 정책은 「기록 작성자 본인」만 허용했고, UPDATE · DELETE 는 작성자 또는
-- 관리 역할(owner · office_admin · cs_staff · field_manager) · 플랫폼 관리자를 허용했다. 그래서
-- 관리자가 남이 등록한 기록의 품목을 고치면 DELETE 만 되고 INSERT 가 막혀 품목이 사라졌다.
-- 앱의 수정 액션도 「추가 → 수정 → 삭제」 순서로 바꿨다(src/lib/linen-return-lines.ts).
-- 작성자 경로는 기존과 같이 활성 멤버십을 요구하고, 조직 격리는 부모 기록의 organization_id 로 유지한다.

drop policy if exists "insert line items for own linen return records"
  on public.linen_return_record_items;

create policy "insert line items of editable linen return records"
on public.linen_return_record_items
for insert
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.linen_return_records r
    where r.id = return_record_id
      and (
        (r.registered_by_user_id = auth.uid() and public.has_active_membership(r.organization_id))
        or public.is_platform_admin()
        or public.has_org_role(
          r.organization_id,
          array['owner', 'office_admin', 'cs_staff', 'field_manager']::public.organization_role[]
        )
      )
  )
);
