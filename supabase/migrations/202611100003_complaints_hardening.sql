-- 게스트 피드백(수기 컴플레인 · 외부 리뷰) 점검 보강 — 2026-11-10.
--
-- 도메인 계약: docs/product/25-complaint-workflow.md → 「2026-11-10 점검 보강」
-- 데이터 모델: docs/engineering/04-data-model.md → customer_complaints / complaint_comments / external_reviews / review_translations
-- 권한:       docs/engineering/05-rls-permissions.md → external_reviews
--
-- 1. external_reviews 칸 권한 — `private_feedback` · `raw_payload` 를 일반 사용자(PostgREST) 읽기에서 뺀다.
--    예전 `grant select on public.external_reviews to authenticated`(202608050001) 는 표 전체 읽기라, 조직 구성원 누구나
--    API 로 Beds24 원본(raw_payload) 과 비공개 피드백을 직접 꺼낼 수 있었다. 화면은 이제 비공개 피드백을 서버(service_role)
--    가 조직 확인 뒤에만 읽는다(`getExternalReview`). 나머지 칸은 그대로 읽힌다(RLS 정책도 그대로).
--    **새 칸을 이 표에 더하면 authenticated 에 그 칸 select 를 따로 줘야 화면에서 읽힌다.**
-- 2. 등록 · 댓글 중복 막기 — `submission_id`(화면이 작성 한 번당 만든 uuid) + 조직별 부분 유니크 인덱스.
--    같은 id 가 다시 오면 서버가 새 줄을 만들지 않고 먼저 만든 줄 id 를 돌려준다(경합은 이 인덱스가 막는다).
-- 3. 번역 사용량 — `review_translations.source_char_count`(보낸 원문 글자 수). DeepL 무료 한도는 원문으로 센다.
-- 4. 비공개 피드백 번역(`source_part = 'private'`) — 일반 사용자 select 정책에서 뺀다(서버만 읽는다).
--
-- 되돌리기(필요할 때만): 칸을 지우고 `grant select on public.external_reviews to authenticated;` 를 다시 준다.

-- ────────────────────────────────────────────────────────────
-- 1. external_reviews — 칸 단위 읽기 권한
-- ────────────────────────────────────────────────────────────
-- Supabase 기본 권한이 anon · authenticated 에 표 전체 권한을 줬을 수 있어 표 단위 권한을 모두 거둔다.
-- 쓰기는 원래 정책이 없어 막혀 있었다(service_role 만). 이제 권한부터 없다.
revoke all on table public.external_reviews from anon;
revoke all on table public.external_reviews from authenticated;

grant select (
  id,
  organization_id,
  provider,
  external_review_id,
  rating_value,
  rating_scale,
  risk_level,
  rating_breakdown,
  reviewed_at,
  imported_at,
  source_updated_at,
  property_id,
  property_name,
  room_id,
  room_label,
  reservation_id,
  source_reservation_id,
  guest_display_name,
  headline,
  source_language_code,
  review_text,
  positive_review_text,
  negative_review_text,
  ota_reply_text,
  ota_replied_at,
  linked_complaint_id,
  created_at,
  updated_at
) on public.external_reviews to authenticated;

grant all on table public.external_reviews to service_role;

comment on column public.external_reviews.private_feedback is
  'Airbnb guest-to-host private feedback. Never public, never scored. Not readable by authenticated (column grant withheld, 2026-11-10) — the server reads it with service_role after an org check.';
comment on column public.external_reviews.raw_payload is
  'Server-only Beds24 payload copy. Not readable by authenticated (column grant withheld, 2026-11-10).';

-- ────────────────────────────────────────────────────────────
-- 2. 등록 · 댓글 중복 막기
-- ────────────────────────────────────────────────────────────
alter table public.customer_complaints
  add column if not exists submission_id uuid;
alter table public.complaint_comments
  add column if not exists submission_id uuid;

comment on column public.customer_complaints.submission_id is
  'Client-generated id per compose session. Same id from the same organization returns the existing row instead of inserting (2026-11-10).';
comment on column public.complaint_comments.submission_id is
  'Client-generated id per comment send. Same id from the same organization returns the existing row instead of inserting (2026-11-10).';

create unique index if not exists customer_complaints_org_submission_unique
  on public.customer_complaints (organization_id, submission_id)
  where submission_id is not null;

create unique index if not exists complaint_comments_org_submission_unique
  on public.complaint_comments (organization_id, submission_id)
  where submission_id is not null;

-- ────────────────────────────────────────────────────────────
-- 3. 번역 사용량 — 원문 글자 수
-- ────────────────────────────────────────────────────────────
alter table public.review_translations
  add column if not exists source_char_count integer
    check (source_char_count is null or source_char_count >= 0);

comment on column public.review_translations.source_char_count is
  'Characters of the source text sent to DeepL for this translation. Monthly usage sums this (DeepL bills input characters).';

-- 이번 달 사용량 계산이 바로 맞도록 기존 줄을 지금 원문 길이로 채운다(원문이 그 뒤 바뀌었으면 근사값).
update public.review_translations t
   set source_char_count = char_length(btrim(coalesce(
         case t.source_part
           when 'review'   then r.review_text
           when 'positive' then r.positive_review_text
           when 'negative' then r.negative_review_text
           when 'headline' then r.headline
           when 'private'  then r.private_feedback
         end, t.translated_text)))
  from public.external_reviews r
 where r.id = t.external_review_id
   and t.source_char_count is null;

create index if not exists review_translations_translated_at_idx
  on public.review_translations (translated_at);

-- ────────────────────────────────────────────────────────────
-- 4. review_translations — 비공개 피드백 번역은 일반 사용자 읽기에서 뺀다
-- ────────────────────────────────────────────────────────────
-- 1번에서 원문(`private_feedback`) 칸 읽기를 거뒀는데, 그 번역(`source_part = 'private'`)은 예전 select 정책
-- (202608050001)으로 조직 구성원 누구나 PostgREST 로 그대로 읽혔다. 앱은 번역을 처음부터 서버(service_role)로만
-- 읽고 쓴다(`src/lib/review-translate.ts` — 상세는 사용자 연결로 리뷰를 읽어 볼 수 있는지 판정한 뒤에만 부른다),
-- 그래서 이 정책을 바꿔도 화면은 그대로다(코드 먼저 · 마이그레이션 나중 어느 쪽이든 동작). 다시 돌려도 같은 결과.
drop policy if exists "review translations: active members or platform admins can read" on public.review_translations;
drop policy if exists "review translations: members read non-private" on public.review_translations;
create policy "review translations: members read non-private"
  on public.review_translations for select
  using (
    source_part <> 'private'
    and (
      public.has_active_membership(organization_id)
      or exists (
        select 1 from public.platform_admins pa
        where pa.user_id = auth.uid() and pa.is_active = true
      )
    )
  );
