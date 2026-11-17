-- 손님 메시지 목록 순서를 손님 말 · 우리 답장 기준으로 다시 계산 (2026-11-17) — docs/product/47-guest-messaging.md §6-1
--
-- 왜. 목록은 `guest_conversations.last_message_at` 내림차순인데, Airbnb 리뷰 알림 같은 system 줄 · 직원 메모(internal)가
-- 들어와도 이 값이 올라가 그 대화가 맨 위로 올라왔다. Airbnb 앱은 이런 알림으로 대화를 올리지 않는다.
-- 앱 코드(`summarizeAddedMessages`)는 이제 guest · host 메시지로만 last_message_at 을 올린다. 이 문장은 이미 들어간 값을 바로잡는다.
--
-- 이렇게 바꾼다. 각 대화의 guest · host 메시지 중 가장 늦은 sent_at 으로 다시 계산한다.
-- guest · host 메시지가 하나도 없는 대화는 null 로 만들지 않고 기존 값을 유지한다(coalesce).
-- 값이 실제로 바뀌는 줄만 고친다(is distinct from). 인덱스 (organization_id, last_message_at desc) 는 이미 있다.

begin;

update public.guest_conversations c
set last_message_at = coalesce(
  (
    select max(m.sent_at)
    from public.guest_messages m
    where m.conversation_id = c.id
      and m.direction in ('guest', 'host')
  ),
  c.last_message_at
)
where c.last_message_at is distinct from coalesce(
  (
    select max(m.sent_at)
    from public.guest_messages m
    where m.conversation_id = c.id
      and m.direction in ('guest', 'host')
  ),
  c.last_message_at
);

commit;
