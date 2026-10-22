-- 국적 + 이름 세 가지(한국어 · 일본어 · 영문 · 가타카나) — docs/product/41-residence-card-workflow.md §2.
-- 가입 첫 화면에서 받고, 이미 가입한 사람은 앱에서 한 번 채운다. 규칙(국적별 필수)은
-- src/lib/identity-names.ts 가 서버 액션에서 검사한다 — 기존 행이 비어 있어도 되도록 DB 는 형식만 막는다.
-- profiles 읽기 · 쓰기 규칙은 그대로(같은 조직 멤버 읽기, 본인 · 플랫폼 관리자 쓰기).

alter table public.profiles
  add column if not exists nationality text,
  add column if not exists name_ko text,
  add column if not exists name_ja text,
  add column if not exists name_en text,
  add column if not exists name_katakana text;

alter table public.profiles
  drop constraint if exists profiles_nationality_format,
  add constraint profiles_nationality_format check (nationality is null or nationality ~ '^[A-Z]{2}$'),
  drop constraint if exists profiles_identity_name_lengths,
  add constraint profiles_identity_name_lengths check (
    coalesce(char_length(name_ko), 0) <= 60
    and coalesce(char_length(name_ja), 0) <= 60
    and coalesce(char_length(name_en), 0) <= 60
    and coalesce(char_length(name_katakana), 0) <= 60
  );

comment on column public.profiles.nationality is 'ISO 3166-1 alpha-2 국적 (KR, JP, VN …)';
comment on column public.profiles.name_ko is '한국어 이름 — 국적 KR 필수';
comment on column public.profiles.name_ja is '일본어 이름(한자) — 국적 JP 필수';
comment on column public.profiles.name_en is '영문 이름(로마자 대문자, 재류카드 · 여권과 같게)';
comment on column public.profiles.name_katakana is '가타카나 이름 — 급여명세서 · 세무 서류 氏名';
