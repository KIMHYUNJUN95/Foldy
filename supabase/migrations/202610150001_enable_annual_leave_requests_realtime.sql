-- 연차 신청 실시간 신호 (2026-10-15).
--
-- 직원이 연차를 신청 · 취소하거나 다른 승인자가 처리하면, 열어 둔 PC 연차 승인 화면이 새로고침 없이
-- 바뀌어야 한다. 이 테이블을 realtime publication 에 넣어 브라우저가 변경 신호를 받게 한다.
--
-- 신호만 쓴다(`admin-live-refresh.tsx` → 서버 렌더 다시 받기). 구독은 select RLS
-- (`annual_leave_requests_self_or_approver_select` 등)를 그대로 통과해야 하므로 승인자가 아닌 세션은
-- 남의 신청 신호를 받지 못한다. 삭제 신호는 오지 않는다(replica identity 기본값) — 지우는 건 승인 화면에
-- 뜨지 않는 임시저장(draft)뿐이고, 제출된 신청은 취소 상태로 바뀌므로 UPDATE 로 충분하다.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'annual_leave_requests'
  ) then
    alter publication supabase_realtime add table public.annual_leave_requests;
  end if;
end
$$;
