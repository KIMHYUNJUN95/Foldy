-- 셀프 체크인 — 사전 등록 웹: 「예약 찾기」 시도 기록 · 개인 링크 토큰 · 실제 인원 (2026-11-02, 초안 · 운영 미적용 — 사용자 컨펌 뒤에만 적용)
--
-- 건물 고정 링크(`/p/<건물>`)는 공개라서, 이름 + 날짜 + 예약 번호를 마구 넣어 보는 것을 막아야 한다(44 FR-W01 · 16 §4).
--   · 같은 사람(IP) · 같은 건물에서 10분 안에 5번 틀리면 10분 잠금(시안 W1L)
--   · 같은 IP 는 1분에 30번까지
-- IP 원문은 두지 않는다 — `key_hash` = sha256(IP + 건물 키 + 서버 비밀값). 하루 지난 줄은 `jobs/retention` 이 지운다.
-- 쓰기 · 읽기는 서버 라우트(service_role)만. 직원 화면에서 볼 일이 없어 select 정책도 두지 않는다.

create table checkin.claim_attempts (
  id bigint generated always as identity primary key,
  key_hash text not null,
  ip_hash text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index claim_attempts_key_idx on checkin.claim_attempts (key_hash, attempted_at desc);
create index claim_attempts_ip_idx on checkin.claim_attempts (ip_hash, attempted_at desc);

alter table checkin.claim_attempts enable row level security;
grant all on checkin.claim_attempts to service_role;

-- 개인 링크 토큰 — stay 하나에 여러 개 (2026-11-02). 다시 찾아도 일행에게 보낸 앞 링크가 닫히지 않게 한다.
-- 원문은 두지 않는다(sha256 만). stay 당 최근 10개만 남기고 오래된 것은 claim 이 지운다. stay 가 지워지면 같이 지워진다.
-- `stays.pre_reg_token_hash` 는 이 표로 대신해 쓰지 않는다(직원 화면 · 크론도 읽지 않음).
create table checkin.stay_tokens (
  token_hash text primary key,
  organization_id uuid not null,
  stay_id uuid not null references checkin.stays (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index stay_tokens_stay_idx on checkin.stay_tokens (stay_id, created_at desc);
alter table checkin.stay_tokens enable row level security;
grant all on checkin.stay_tokens to service_role;

-- 손님이 말한 실제 인원 (2026-11-02, 43 §8 「인원이 예약과 다르면 손님이 줄을 더하거나 빼되 직원 화면에 표시」).
-- null = 예약 인원(`guest_count_expected`) 그대로. 「이 사람은 안 와요」로 빈 자리를 빼면 여기 줄어든 값.
-- 예약 인원은 sync-stays 가 계속 따라가고, 직원 화면은 두 값이 다르면 표시한다.
alter table checkin.stays add column party_size smallint check (party_size between 1 and 20);
