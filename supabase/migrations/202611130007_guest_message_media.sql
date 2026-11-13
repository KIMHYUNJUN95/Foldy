-- 손님 메시지 사진 사본 — docs/product/47-guest-messaging.md §5-8, docs/engineering/04 · 05 「손님 메시지」.
--
-- Airbnb 손님 사진은 Beds24 본문에 서명 주소(1시간 뒤 죽음) 앵커로 온다. 화면은 서명 없는 `?im_w=` 주소로 보이지만
-- 문서에 없는 동작이라, 사진을 Foldy 저장소(비공개 버킷 `guest-message-media`)에 한 번 복사해 둔다.
--
-- 1. guest_messages 에 사본 상태 칸 4개 — `media_state`(pending · done · failed, 사진이 없는 줄은 null) ·
--    `media_attempts` · `media_next_try_at` · `media_claim_id`(복사 실행이 잡은 줄 — 두 실행이 같은 줄을 만지지 않게).
--    들어올 때 트리거가 본문에 Airbnb 사진 주소가 있으면 pending 으로 표시.
--    이미 있는 줄도 한 번 표시한다(아래 update — 멱등).
-- 2. 비공개 버킷 + 읽기 정책(그 조직의 `guest_messages.view`). 쓰기 정책은 없다 — service_role(서버 복사 작업)만 쓴다.
--    화면은 서버가 만든 짧은 서명 URL 로만 본다.
--
-- 멱등 — 두 번 돌려도 같다. 코드 배포보다 먼저 적용해도 된다(새 칸은 기본값이 있고 앱이 아직 안 읽음).

-- ── 1. 사본 상태 칸 ─────────────────────────────────────────────────────────
alter table public.guest_messages
  add column if not exists media_state text,
  add column if not exists media_attempts smallint not null default 0,
  add column if not exists media_next_try_at timestamptz,
  add column if not exists media_claim_id uuid;
-- 상수 기본값 칸 더하기는 표를 다시 쓰지 않는다(메타데이터만). 검사 제약은 `not valid` 로 걸고(짧은 잠금) 따로 검증한다
-- (검증은 SHARE UPDATE EXCLUSIVE — 읽기 · 쓰기를 막지 않는다). 운영 guest_messages 약 4.5만 줄(2026-11-13).

alter table public.guest_messages drop constraint if exists guest_messages_media_state_check;
alter table public.guest_messages
  add constraint guest_messages_media_state_check
  check (media_state is null or media_state in ('pending', 'done', 'failed')) not valid;
alter table public.guest_messages validate constraint guest_messages_media_state_check;

alter table public.guest_messages drop constraint if exists guest_messages_media_attempts_check;
alter table public.guest_messages
  add constraint guest_messages_media_attempts_check
  check (media_attempts between 0 and 100) not valid;
alter table public.guest_messages validate constraint guest_messages_media_attempts_check;

comment on column public.guest_messages.media_state is
  '사진 사본 상태(47 §5-8): null = 사진 없음, pending = 복사할 사진 있음(트리거가 표시), done = 다 복사함 또는 복사할 것 없음, failed = 여러 번 실패해 멈춤. 사본 정보는 attachments 의 kind=image_copy 줄.';
comment on column public.guest_messages.media_attempts is '사진 사본 실패 횟수(성공 · 처음은 0).';
comment on column public.guest_messages.media_next_try_at is '다음 사진 사본 시도 시각(실패 뒤 미룸 · 잡은 동안 5분 뒤, null = 바로).';
comment on column public.guest_messages.media_claim_id is '이 줄을 잡은 사진 사본 실행 번호(저장은 이 번호일 때만, 끝나면 null).';

-- 복사 작업이 고르는 줄 — pending 만 작게.
create index if not exists guest_messages_media_pending_idx
  on public.guest_messages (organization_id, media_next_try_at)
  where media_state = 'pending';

-- 들어올 때 표시 — 본문에 Airbnb 사진 주소가 있으면 pending(복사 작업이 실제 앵커인지 다시 본다).
create or replace function public.guest_messages_mark_media()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.media_state is null and strpos(new.body, 'a0.muscache.com/im/pictures') > 0 then
    new.media_state := 'pending';
  end if;
  return new;
end;
$$;

revoke all on function public.guest_messages_mark_media() from public, anon, authenticated;

drop trigger if exists guest_messages_mark_media on public.guest_messages;
create trigger guest_messages_mark_media
  before insert on public.guest_messages
  for each row execute function public.guest_messages_mark_media();

-- 이미 있는 줄 — 운영 guest_messages 약 4.5만 줄 중 Airbnb 사진 줄 수천 개(2026-11-13, 과거 가져오기로 늘어나는 중).
-- 표시만 하고(한 문장, 해당 줄만 잠금) 복사는 `/api/guest-messages/media-backfill` 이 나눠서.
update public.guest_messages
set media_state = 'pending'
where media_state is null
  and strpos(body, 'a0.muscache.com/im/pictures') > 0;

-- ── 2. 비공개 버킷 ──────────────────────────────────────────────────────────
-- 경로: <organization_id>/<conversation_id>/<message_id>/<index>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guest-message-media', 'guest-message-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 읽기: 그 조직의 `guest_messages.view`(+ 플랫폼 개발자). 첫 칸이 uuid 가 아니면 has_capability 에 null(→ 거절) —
-- case 로 감싸 잘못된 경로가 형 변환 오류를 내지 않게.
drop policy if exists "guest message media: viewers can read" on storage.objects;
create policy "guest message media: viewers can read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'guest-message-media'
    and (
      (select public.is_platform_admin())
      or public.has_capability(
        case
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then split_part(name, '/', 1)::uuid
        end,
        (select auth.uid()),
        'guest_messages.view'
      )
    )
  );
-- 넣기 · 고치기 · 지우기 정책은 만들지 않는다 — 일반 사용자는 못 쓴다(service_role 만, RLS 우회).
