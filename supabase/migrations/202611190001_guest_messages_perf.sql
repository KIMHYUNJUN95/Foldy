-- 손님 메시지 성능 (2026-11-19) — 인덱스 4개 + 마지막 한 줄 함수 LATERAL 로 다시 쓰기.
-- 상태: 운영 적용 2026-11-19(사용자가 대시보드 SQL 편집기로 실행).
-- 문서: docs/product/47-guest-messaging.md 「성능 — 읽기 묶음」 · docs/engineering/04-data-model.md
--
-- 새 인덱스만 더한다(기존 인덱스는 지우지 않음). 표가 작아(대화 1만 줄 안팎 · 예약 1만 줄 안팎) CONCURRENTLY 없이 만든다
-- — 트랜잭션 안에서 만들 수 있고, 만드는 동안의 쓰기 잠금은 짧다.
-- lock_timeout 5초 — 긴 트랜잭션 뒤에 줄 서서 그동안 웹훅 쓰기까지 막지 않게, 잠금을 못 잡으면 실패하고 나중에 다시 돌린다.

begin;
set local lock_timeout = '5s';

-- 1. 메시지함 창 — `status in (…)` / `= 'done'` + `order by last_message_at desc nulls last, id`.
--    예전 인덱스(organization_id, last_message_at desc) 는 NULLS 위치가 달라(desc 기본은 nulls first) 정렬에 못 썼고
--    상태로도 못 걸렀다 → 처리 끝 9천 줄을 다 읽고 top-N 정렬. 실시간 줄 다시 읽기의 처리 끝 경계(200번째 한 줄)도 이것을 탄다.
create index if not exists guest_conversations_org_status_last_message_idx
  on public.guest_conversations (organization_id, status, last_message_at desc nulls last, id);

-- 2. 예약 원본의 Beds24 번호 — 웹훅 대화 seed(`raw_payload->>id` → `->>bookId`) · 자동 안내 묶음 예약(`->>masterId`).
--    jsonb 식 인덱스(`->>` 는 GIN 으로 못 탄다). 조직이 늘 같이 걸리므로 앞에 둔다.
create index if not exists reservations_org_raw_id_idx
  on public.reservations (organization_id, (raw_payload ->> 'id'));
create index if not exists reservations_org_raw_book_id_idx
  on public.reservations (organization_id, (raw_payload ->> 'bookId'));
create index if not exists reservations_org_raw_master_id_idx
  on public.reservations (organization_id, (raw_payload ->> 'masterId'));

-- 3. 대화마다 마지막 손님 · 직원 한 줄 — 서명 · 보안 · 권한은 202611130001 과 같다.
--    예전 `distinct on` 은 고른 대화의 메시지를 전부 읽고 정렬했다(대화 500개 × 이력). 이제 대화마다
--    guest_messages_conversation_sent_idx (conversation_id, sent_at) 를 거꾸로 훑어 첫 맞는 줄에서 멈춘다.
--    같은 시각이면 id 큰 쪽(예전과 같음). 결과 순서는 보장하지 않는다(예전도 대화 id 순일 뿐 — 앱은 대화 id 로 묶는다).
create or replace function public.guest_conversation_last_lines(p_organization_id uuid, p_conversation_ids uuid[])
returns table (conversation_id uuid, direction text, body text, sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, l.direction, l.body, l.sent_at
  from (select distinct unnest(p_conversation_ids) as id) c
  cross join lateral (
    select m.direction, m.body, m.sent_at
    from public.guest_messages m
    where m.organization_id = p_organization_id
      and m.conversation_id = c.id
      and m.direction in ('guest', 'host')
    order by m.sent_at desc, m.id desc
    limit 1
  ) l;
$$;
revoke all on function public.guest_conversation_last_lines(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.guest_conversation_last_lines(uuid, uuid[]) to service_role;

commit;
