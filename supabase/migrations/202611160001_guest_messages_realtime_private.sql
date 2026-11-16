-- 손님 메시지 실시간을 private 신호로 (2026-11-16) — docs/product/47-guest-messaging.md §5-9 · docs/engineering/05-rls-permissions.md → Realtime
--
-- 왜. `202611130008` 은 네 표(guest_conversations · guest_messages · guest_message_outbox · auto_message_runs)를
-- `supabase_realtime` publication 에 넣었다. 화면은 신호에서 id 만 꺼내 썼지만 **웹소켓 프레임에는 행 전체**가 실렸다 —
-- 메시지 본문 · 사진 · 손님 이름, 그리고 출입 코드가 채워진 자동 안내 글(Q10 비밀번호 가림을 건너뜀).
-- publication 칸 목록(column list)은 Supabase Realtime 이 지킨다고 믿기 어려워 쓰지 않는다.
--
-- 이렇게 바꾼다.
-- 1) 네 표를 publication 에서 뺀다(postgres_changes 로는 더 이상 아무것도 안 나간다).
-- 2) 네 표에 트리거를 달아 `realtime.send()` 로 **id 칸만 든 신호**를 private 토픽 `guest-messages:<organization_id>` 로 보낸다.
--    신호 = { table, eventType, id, organization_id, conversation_id?, provider_booking_id? } — 모두 문자열, 없는 칸은 뺀다.
--    본문 · 이름 · 첨부 · 상태 글은 처음부터 싣지 않는다. 화면은 지금처럼 그 id 로 권한 검사하는 서버 액션을 다시 부른다.
-- 3) `realtime.messages` 에 받기(SELECT) 정책 하나: 그 토픽의 조직에서 `guest_messages.view` 를 가진 사람(+ 플랫폼 개발자)만.
--    네 표의 select 정책과 같은 판정(`has_capability` · `is_platform_admin`, 202611120002 · 202611130004)이다.
--    보내기(INSERT) 정책은 두지 않는다 — 브라우저는 이 토픽에 보낼 수 없다. 신호는 트리거(SECURITY DEFINER)만 보낸다.
--
-- 신호 양. 예전 구독과 같게 INSERT · UPDATE 를 보내고(삭제 신호는 예전에도 없었다), 목록이 메시지 INSERT 만 받는 것 ·
-- 대화가 그 대화 것만 받는 것은 브라우저가 신호의 칸으로 거른다(`src/lib/live-sources.ts` · `liveChangeMatches`).
-- `updated_at` 말고는 바뀐 칸이 없는 UPDATE(같은 값 다시 쓰기 — 보정 조회 · 사진 사본 되풀이)는 트리거 조건에서 거른다.
-- 세 표(대화 · 메시지 · 큐)는 BEFORE UPDATE `set_updated_at()` 이 매번 `updated_at` 을 바꾸므로, 비교에서 그 칸을 뺀다
-- (`to_jsonb(old) - 'updated_at'`). `updated_at` 이 없는 표라면 빼기는 아무것도 안 한다.
--
-- 쓰기를 절대 막지 않는다. `realtime.send` 가 없거나(로컬 시험 DB) 실패하면 경고만 남기고 원래 쓰기는 그대로 끝난다.
--
-- 배포 순서: 이 마이그레이션을 **먼저** 적용하고 바로 앱(private 구독)을 배포한다. 그 사이 열려 있던 옛 화면은
-- 실시간만 멈춘다(데이터 영향 없음 · 새로고침하면 맞다). 앱을 먼저 내면 private 구독이 정책 없이 거절되고 옛 누수도 남는다.
-- 프로젝트의 Realtime 「Allow public access」 설정은 바꾸지 않는다 — private 채널은 그 설정과 상관없이 RLS 를 본다(beds24-live 와 같다).
--
-- 여러 번 돌려도 같다.

-- 1) publication 에서 빼기 ---------------------------------------------------------------------------------------------
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
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$$;

-- 2) id 만 든 신호 보내기 ----------------------------------------------------------------------------------------------
-- 표마다 있는 칸이 달라 표 이름으로 나눈다(plpgsql 은 실행하는 갈래의 칸만 본다).
-- SECURITY DEFINER: 신호는 realtime.messages 에 한 줄 쓰는 것인데, 대화 상태를 바꾸는 직원(authenticated)에게는
-- 그 표의 INSERT 정책이 없다. 소유자 권한으로 보내고, 함수는 트리거로만 쓰이니 RPC 실행 권한은 모두 회수한다.
create or replace function public.guest_messages_live_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return null;
  end if;

  -- 칸 읽기 · 신호 만들기도 모두 예외 처리 안에 둔다 — 나중에 칸 이름이 바뀌어도 원래 쓰기는 실패하지 않는다.
  begin
    v_payload := jsonb_build_object(
      'table', tg_table_name,
      'eventType', tg_op,
      'id', new.id::text,
      'organization_id', new.organization_id::text
    );
    if tg_table_name in ('guest_messages', 'guest_message_outbox', 'auto_message_runs') then
      v_payload := v_payload || jsonb_build_object('conversation_id', new.conversation_id::text);
    end if;
    if tg_table_name in ('guest_conversations', 'auto_message_runs') then
      v_payload := v_payload || jsonb_build_object('provider_booking_id', new.provider_booking_id::text);
    end if;

    perform realtime.send(
      jsonb_strip_nulls(v_payload),
      'change',
      'guest-messages:' || new.organization_id::text,
      true
    );
  exception when others then
    raise warning 'guest_messages_live_signal(%): %', tg_table_name, sqlerrm;
  end;
  return null;
end
$$;

comment on function public.guest_messages_live_signal() is
  '손님 메시지 네 표의 변경을 id 칸만 든 private 신호(guest-messages:<org>)로 보낸다. 실패해도 쓰기는 막지 않는다. 202611160001 · docs/product/47-guest-messaging.md §5-9';

revoke execute on function public.guest_messages_live_signal() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'guest_conversations',
    'guest_messages',
    'guest_message_outbox',
    'auto_message_runs'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_live_insert', t);
    execute format(
      'create trigger %I after insert on public.%I for each row execute function public.guest_messages_live_signal()',
      t || '_live_insert', t
    );
    execute format('drop trigger if exists %I on public.%I', t || '_live_update', t);
    execute format(
      'create trigger %I after update on public.%I for each row when ((to_jsonb(old) - ''updated_at'') is distinct from (to_jsonb(new) - ''updated_at'')) execute function public.guest_messages_live_signal()',
      t || '_live_update', t
    );
  end loop;
end
$$;

-- 3) 받기 정책 -------------------------------------------------------------------------------------------------------
-- 토픽 문자열을 uuid 로 캐스팅하지 않는다(beds24-live 와 같은 이유 — 다른 private 토픽 구독에서도 이 정책이 같이 평가돼,
-- 캐스팅 실패가 그 구독까지 에러로 만든다). 멤버십의 조직 id 를 문자열로 붙여 비교한다.
-- realtime 스키마가 없는 환경(로컬 시험 DB)은 건너뛴다.
do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;

  drop policy if exists "guest_messages_live_viewers_receive" on realtime.messages;

  create policy "guest_messages_live_viewers_receive"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'guest-messages:%'
    and (
      (select public.is_platform_admin())
      or exists (
        select 1
        from public.memberships m
        where m.user_id = (select auth.uid())
          and m.status = 'active'
          and 'guest-messages:' || m.organization_id::text = (select realtime.topic())
          and public.has_capability(m.organization_id, (select auth.uid()), 'guest_messages.view')
      )
    )
  );
end
$$;
