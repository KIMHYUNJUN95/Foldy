-- 손님 메시지 실시간 (2026-11-13) — docs/product/47-guest-messaging.md §5-9
--
-- PC `/admin/messages`(대화 · 자동 안내 탭) · 모바일 `/mobile/messages`(목록 · 대화 · 태블릿 칸)가 새로고침 없이 그 자리에서 바뀌게,
-- 네 표를 realtime publication 에 넣는다. 화면은 신호에서 **id 만** 꺼내(대화 · 메시지의 대화 · 큐의 대화 · 실행 줄)
-- 권한 검사를 하는 서버 액션으로 그 항목만 다시 읽는다 — 신호의 행 데이터는 그리지 않는다.
--
-- 구독은 각 표의 select RLS 를 그대로 통과해야 신호가 온다. 네 표 모두 같은 정책
-- 「그 조직에서 `guest_messages.view` 를 가진 사람(+ 플랫폼 개발자)」만 읽는다
-- (`202611120002` guest_conversations · guest_messages · guest_message_outbox, `202611130004` auto_message_runs) —
-- 볼 권한이 없는 사람 · 다른 조직 사람에게는 신호도 가지 않는다. authenticated 에는 select 만 열려 있다.
-- 번역 캐시(guest_message_translations)는 authenticated 정책이 없어(서버만 읽음) 넣지 않는다.
--
-- 삭제 신호는 오지 않는다(replica identity 기본값) — 지워진 대화 · 줄은 화면의 따라잡기 · 다시 읽기에서 빠진다.
-- 발행이 없는 환경(로컬 시험 DB)은 건너뛴다. 여러 번 돌려도 같다.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array[
    'guest_conversations',
    'guest_messages',
    'guest_message_outbox',
    'auto_message_runs'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
