-- 신분 서류 「지금 카드」 바꾸기를 한 트랜잭션으로(docs/product/41 「R4 구현」 남은 틈, 2026-10-27).
--
-- 본인 제출(submitIdCard)과 관리자 대신 올리기(saveStaffIdDocumentByAdmin)는 새 행을 is_current = false 로 넣은 뒤
-- 「이전 카드 내리기 → 새 카드 올리기」를 두 번의 update 로 했다. 같은 사람에게 두 저장이 동시에 오면 한쪽 올리기가
-- staff_id_documents_one_current(사람마다 지금 카드 하나) 에 걸려 실패하고, 순서에 따라 지금 카드가 0장으로 남을 수 있었다.
-- 이 함수는 (조직, 사람) 단위 잠금을 잡고 내리기 · 올리기를 한 번에 한다 — 동시에 와도 차례로 처리되고 나중 것이 지금 카드가 된다.
--
-- 부르는 쪽은 서버(service role)만. 그 문서가 그 조직 · 그 사람 것이 아니면 아무것도 바꾸지 않고 false.

create or replace function public.promote_staff_id_document(
  p_organization_id uuid,
  p_user_id uuid,
  p_document_id uuid
)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('staff_id_documents:' || p_organization_id::text || ':' || p_user_id::text, 0));

  if not exists (
    select 1
    from public.staff_id_documents
    where id = p_document_id
      and organization_id = p_organization_id
      and user_id = p_user_id
  ) then
    return false;
  end if;

  update public.staff_id_documents
  set is_current = false
  where organization_id = p_organization_id
    and user_id = p_user_id
    and is_current
    and id <> p_document_id;

  update public.staff_id_documents
  set is_current = true
  where id = p_document_id;

  return true;
end;
$$;

revoke all on function public.promote_staff_id_document(uuid, uuid, uuid) from public;
revoke all on function public.promote_staff_id_document(uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.promote_staff_id_document(uuid, uuid, uuid) to service_role;
