-- 교통비 영수증 비공개 버킷 · 사진 상한 · 제출 뒤 잠금 (2026-11-25) — 운영 미적용 — 사용자 허락 대기
-- 문서: docs/engineering/05-rls-permissions.md 「교통비 영수증 비공개 버킷(2026-11-25)」
--       docs/engineering/11-attendance-payroll-technical-design.md 「교통비 영수증 저장소(2026-11-25)」
-- 두 번 돌려도 같은 결과가 되게 썼다(on conflict do update · drop policy if exists → create policy · create or replace function ·
-- drop trigger if exists → create trigger). 전체를 begin; … commit; 한 거래로 감싸 반쯤 적용되지 않게 한다.
--
-- ── 도메인 약속 ─────────────────────────────────────────────────────────────────────────────────────────────────
--   영수증 사진은 본인 정산서(transport_reimbursement_reports) · 본인 항목(transport_reimbursement_items) 아래에만 붙는다.
--   항목 하나에 사진은 5장까지(CLAUDE.md 8번 업로드 규칙). 정산서가 draft · rejected · changes_requested 일 때만 고친다
--   (202611110002 guard_transport_item_report_editable 과 같은 목록). 제출 · 검토 중 · 승인된 정산서의 증빙은 그대로 남아야 한다.
--   읽기 · 지우기는 서버(service role)만 한다 — 화면은 서버가 만든 10분짜리 서명 주소로만 사진을 본다.
--
-- ── 고치는 문제 ─────────────────────────────────────────────────────────────────────────────────────────────────
--   ① 영수증이 공개 버킷(request-images, public=true)에 있어 경로만 알면 로그인 없이 누구나 볼 수 있었다.
--      → 비공개 버킷 transport-receipts 를 새로 만든다(8MB · jpeg/png/webp/gif). 새 업로드는 여기로 간다.
--        예전 파일은 scripts/dev/move-transport-receipts.mjs 로 옮긴다(이 파일은 옮기지 않는다 — 아래 배포 순서).
--   ② 올리기 정책이 「그 조직의 활성 멤버」만 봐서 같은 조직의 다른 사람 · 제출된 정산서 · 어긋난 항목 폴더에도 파일을 올릴 수 있었다.
--      → 두 버킷 모두 「경로의 정산서 · 항목이 내 것이고, 항목이 그 정산서에 속하고, 정산서를 고칠 수 있을 때」만 올린다.
--        플랫폼 관리자 예외는 없앤다(영수증은 본인만 올린다 — 관리자는 올리지 않는다).
--   ③ 사진 5장 상한 · 순서(sort_order)가 앱에만 있어 동시에 올리면 6장 이상 · 같은 순서가 생겼다.
--      → 사진 행 BEFORE INSERT 트리거가 항목 → 정산서 순으로 잠그고(FOR UPDATE, 잠금 순서 고정) 세어서 막고 순서를 매긴다.
--   ④ 제출 · 승인 뒤에도 사진 행 넣기 · 지우기, 항목 지우기가 DB 에서 막히지 않았다(202611110002 는 항목 insert · update 만 막음).
--      → 사진 insert · delete, 항목 delete 트리거가 정산서를 잠그고 상태를 본다.
--        정산서를 통째로 지울 때(계정 정리 · 데모 정리)의 cascade 는 막지 않는다 — pg_trigger_depth() > 1 이면 건너뛴다.
--   ⑤ request-images 의 예전 지우기 정책(202611110002 「org members can delete transport reimbursement images」)이
--      올린 사람 · transport.manage 에게 정산서 상태와 상관없이 지우기를 열어 둬, 제출 · 승인된 정산서의 영수증 파일을
--      브라우저에서 바로 지울 수 있었다. 앱은 브라우저에서 교통비 파일을 지우지 않는다(지우기는 서버 service role 만 —
--      transport-receipt-storage.ts removeTransportReceiptFiles) → 정책을 버린다(다시 만들지 않는다).
--      연차 증빙 지우기 정책 · 다른 기능의 request-images 지우기 정책(4칸 경로)은 그대로다.
--   ⑥ 같은 경로를 동시에 두 번 넣으면 사진 행이 둘 생겼다 → (item_id, storage_path) 유일 색인.
--      이미 겹친 행이 있어도 실패하지 않게, 만들기 전에 하나만 남기고(sort_order · id 가 가장 작은 것) 지운다.
--
-- ── 일부러 건드리지 않는 것 ─────────────────────────────────────────────────────────────────────────────────────
--   request-images 버킷의 공개 여부 · 다른 기능 정책(발주 · 수리 · 분실물 등 사진)은 그대로다. 그 버킷의 읽기(select) 정책은
--   만들지 않는다(request-image-folders-policy.test.ts 가 하나만 있어야 한다고 확인한다).
--   새 버킷에는 select · update · delete 정책을 만들지 않는다 — 로그인 사용자는 읽기 · 덮어쓰기 · 지우기를 못 한다.
--   권한 규칙(누가 정산서를 고치는지) · 금액 계산 · 지우기 정책(하드 삭제)은 바꾸지 않는다.
--
-- ── 배포 순서 ──────────────────────────────────────────────────────────────────────────────────────────────────
--   1) 이 마이그레이션 적용(버킷 · 정책 · 트리거). 앱이 아직 예전이어도 깨지지 않는다 — 예전 앱은 request-images 로 올리고,
--      좁아진 정책도 본인 · 고칠 수 있는 정산서면 통과한다.
--   2) 앱 배포(새 업로드는 transport-receipts, 서명은 새 버킷 → 예전 버킷 순).
--   3) node scripts/dev/move-transport-receipts.mjs (미리보기) → --apply 로 예전 파일 옮기기. 다시 돌려도 안전하다.
--
-- ── 되돌리기 ───────────────────────────────────────────────────────────────────────────────────────────────────
--   drop trigger if exists transport_item_images_guard_insert on public.transport_reimbursement_item_images;
--   drop trigger if exists transport_item_images_guard_delete on public.transport_reimbursement_item_images;
--   drop trigger if exists transport_items_guard_delete on public.transport_reimbursement_items;
--   drop function if exists public.guard_transport_item_image_insert();
--   drop function if exists public.guard_transport_item_image_delete();
--   drop function if exists public.guard_transport_item_delete();
--   drop index if exists public.transport_item_images_item_path_key;   (정리로 지운 겹친 행은 되돌리지 않는다 — 같은 경로의 중복이었다)
--   drop policy if exists "members can upload own transport receipts" on storage.objects;
--   (request-images 올리기 정책은 202606260001:148-190, 지우기 정책은 202611110002:205-237 의 원래 문장으로 다시 만든다.)
--   버킷은 파일을 옮긴 뒤라면 지우지 않는다 — 앱을 예전으로 돌려도 서명은 예전 버킷만 보므로, 옮긴 파일은 다시 옮겨야 보인다.
--
-- ── 확인 SQL(읽기 전용) ────────────────────────────────────────────────────────────────────────────────────────
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'transport-receipts';
--   select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
--     and policyname in ('members can upload own transport receipts', 'org members can upload transport reimbursement images',
--                        'org members can delete transport reimbursement images');  -- 지우기 정책은 없어야 함
--   select item_id, storage_path, count(*) from public.transport_reimbursement_item_images
--     group by 1, 2 having count(*) > 1;  -- 0줄이어야 함
--   select tgname, tgrelid::regclass from pg_trigger where tgname like 'transport_item%guard%';
--   select item_id, count(*) from public.transport_reimbursement_item_images group by item_id having count(*) > 5;  -- 0줄이어야 함
--   select p.proname, has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p
--     where p.proname like 'guard_transport_%';  -- 새 3개는 false

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 비공개 버킷
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transport-receipts',
  'transport-receipts',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 올리기 정책 — 경로 {조직}/transport-reimbursements/{정산서}/{항목}/{파일}
--    정산서 · 항목 · 본인 · 고칠 수 있는 상태를 DB 행으로 확인한다. uuid 가 아닌 칸은 case 로 null 이 되어 아무 행과도 맞지 않는다
--    (캐스트 오류로 깨지지 않게). 하위 조회는 storage 정책 안이라 RLS 를 탄다 — 본인 정산서 · 항목은 select 정책으로 늘 보인다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "members can upload own transport receipts" on storage.objects;
create policy "members can upload own transport receipts"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'transport-receipts'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 2) = 'transport-reimbursements'
    and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 5) ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,158}[A-Za-z0-9]$'
    and split_part(name, '/', 6) = ''
    and exists (
      select 1 from public.memberships m
      where m.organization_id::text = split_part(name, '/', 1)
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
    and exists (
      select 1
      from public.transport_reimbursement_reports r
      join public.transport_reimbursement_items i on i.report_id = r.id
      where r.id = case when split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then split_part(name, '/', 3)::uuid end
        and i.id = case when split_part(name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then split_part(name, '/', 4)::uuid end
        and r.organization_id::text = split_part(name, '/', 1)
        and i.organization_id = r.organization_id
        and r.user_id = (select auth.uid())
        and i.user_id = (select auth.uid())
        and r.status in ('draft', 'rejected', 'changes_requested')
    )
  );

-- 예전 버킷(request-images)의 교통비 올리기 정책도 같은 조건으로 좁힌다 — 배포 전 예전 앱 · 옮기기 전 사이에 열린 구멍을 닫는다.
drop policy if exists "org members can upload transport reimbursement images" on storage.objects;
create policy "org members can upload transport reimbursement images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'request-images'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 2) = 'transport-reimbursements'
    and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(name, '/', 5) ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,158}[A-Za-z0-9]$'
    and split_part(name, '/', 6) = ''
    and exists (
      select 1 from public.memberships m
      where m.organization_id::text = split_part(name, '/', 1)
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
    and exists (
      select 1
      from public.transport_reimbursement_reports r
      join public.transport_reimbursement_items i on i.report_id = r.id
      where r.id = case when split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then split_part(name, '/', 3)::uuid end
        and i.id = case when split_part(name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then split_part(name, '/', 4)::uuid end
        and r.organization_id::text = split_part(name, '/', 1)
        and i.organization_id = r.organization_id
        and r.user_id = (select auth.uid())
        and i.user_id = (select auth.uid())
        and r.status in ('draft', 'rejected', 'changes_requested')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b) 예전 버킷 지우기 정책 버리기(⑤) — 지우기는 서버 service role 만.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "org members can delete transport reimbursement images" on storage.objects;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2c) (항목, 경로) 유일(⑥) — 겹친 행을 먼저 하나만 남긴다.
--     다시 돌릴 때는 아래 4) 의 지우기 잠금 트리거가 이미 있어 제출된 정산서의 겹친 행 정리를 막는다 → 먼저 내리고, 4) 에서 다시 만든다
--     (한 거래 안이라 트리거가 빠진 틈은 밖에서 보이지 않는다).
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists transport_item_images_guard_delete on public.transport_reimbursement_item_images;

delete from public.transport_reimbursement_item_images d
using (
  select id, row_number() over (partition by item_id, storage_path order by sort_order, id) as rn
  from public.transport_reimbursement_item_images
) ranked
where d.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists transport_item_images_item_path_key
  on public.transport_reimbursement_item_images (item_id, storage_path);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 사진 행 넣기 — 잠금 순서: 항목 → 정산서. 사진 지우기 · 항목 지우기 트리거도 항목 → 정산서 순서로 잡는다(교착 방지).
--    같은 항목에 동시에 넣으면 두 번째가 항목 잠금에서 기다렸다가 늘어난 수를 본다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_transport_item_image_insert()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.transport_reimbursement_items%rowtype;
  v_status text;
  v_count integer;
  v_max integer;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  select * into v_item from public.transport_reimbursement_items where id = new.item_id for update;
  if not found
     or v_item.report_id <> new.report_id
     or v_item.organization_id <> new.organization_id
     or v_item.user_id <> new.user_id then
    raise exception 'transport image item mismatch' using errcode = 'P0001';
  end if;

  select status into v_status from public.transport_reimbursement_reports where id = new.report_id for update;
  if v_status is null or v_status not in ('draft', 'rejected', 'changes_requested') then
    raise exception 'transport report is not editable' using errcode = 'P0001';
  end if;

  select count(*), max(sort_order) into v_count, v_max
  from public.transport_reimbursement_item_images where item_id = new.item_id;
  if v_count >= 5 then
    raise exception 'transport item image limit' using errcode = 'P0001';
  end if;

  new.sort_order := coalesce(v_max, -1) + 1;
  return new;
end;
$$;

revoke all on function public.guard_transport_item_image_insert() from public, anon, authenticated;

drop trigger if exists transport_item_images_guard_insert on public.transport_reimbursement_item_images;
create trigger transport_item_images_guard_insert
  before insert on public.transport_reimbursement_item_images
  for each row execute function public.guard_transport_item_image_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 사진 행 지우기 · 항목 지우기 — 정산서가 고칠 수 있을 때만. 정산서 · 항목을 지울 때의 cascade(깊이 > 1)는 건너뛴다.
--    부모 정산서가 이미 없으면(같은 문장에서 지워지는 중) 막지 않는다.
--    잠금 순서는 넣기와 같다: 항목 → 정산서. 항목 지우기는 지우는 행(항목)이 트리거 전에 이미 잠기고, 사진 지우기는
--    여기서 항목을 먼저 잠근 뒤 정산서를 잠근다 — 사진 넣기와 사진 지우기가 서로 반대로 잡아 교착되지 않게.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_transport_item_image_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  perform 1 from public.transport_reimbursement_items where id = old.item_id for update;
  select status into v_status from public.transport_reimbursement_reports where id = old.report_id for update;
  if found and v_status not in ('draft', 'rejected', 'changes_requested') then
    raise exception 'transport report is not editable' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_transport_item_image_delete() from public, anon, authenticated;

drop trigger if exists transport_item_images_guard_delete on public.transport_reimbursement_item_images;
create trigger transport_item_images_guard_delete
  before delete on public.transport_reimbursement_item_images
  for each row execute function public.guard_transport_item_image_delete();

create or replace function public.guard_transport_item_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  select status into v_status from public.transport_reimbursement_reports where id = old.report_id for update;
  if found and v_status not in ('draft', 'rejected', 'changes_requested') then
    raise exception 'transport report is not editable' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_transport_item_delete() from public, anon, authenticated;

drop trigger if exists transport_items_guard_delete on public.transport_reimbursement_items;
create trigger transport_items_guard_delete
  before delete on public.transport_reimbursement_items
  for each row execute function public.guard_transport_item_delete();

commit;
