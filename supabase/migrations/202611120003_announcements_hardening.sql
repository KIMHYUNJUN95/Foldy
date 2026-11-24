-- 공지사항 점검(2026-11-12) — 앱을 거치지 않고 PostgREST 로 직접 부를 때 드러나던 구멍을 닫는다.
-- 앱 화면 동작은 바뀌지 않는다: 공지 만들기 · 고치기 · 상태 바꾸기 · 지우기는 모두 서버(service role)가 한다
-- (src/app/admin/announcements/actions.ts — 2026-11-12 전수 grep, 사용자 세션으로 announcements 에 쓰는 곳 없음).
-- 문서: docs/engineering/05-rls-permissions.md 「공지사항 점검(2026-11-12)」 · docs/product/11-announcement-workflow.md
-- 두 번 돌려도 같은 결과가 되게 썼다(drop if exists · create or replace · revoke).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) announcements 쓰기 — 로그인 사용자의 직접 insert · update · delete 를 없앤다(H1).
--    INSERT 정책은 created_by_user_id = auth.uid() 를 보지 않아 남의 이름으로 공지를 넣을 수 있었고,
--    서버 검증(제목 · 본문 길이 · 사진 경로 · 대상 역할 · 알림)도 건너뛸 수 있었다.
--    쓰기는 전부 service role 서버 액션이라 표 권한을 거둔다. 정책은 남겨 두지만 권한이 없으니 쓰이지 않는다.
--    진짜 관문은 서버 액션의 권한 키(announcement.create · announcement.manage) 확인이다.
--    truncate 도 같이 거둔다 — RLS 를 타지 않아 권한만 있으면 표 전체를 비울 수 있다(PostgREST 로는 못 부르지만 남겨 둘 이유가 없다).
-- ─────────────────────────────────────────────────────────────────────────────
revoke insert, update, delete, truncate on public.announcements from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) announcements 읽기 — 초안 · 보관 공지는 관리 권한자와 작성자만(M1).
--    예전 정책은 상태를 보지 않아 대상 직원이 아직 게시하지 않은 초안 · 내린 보관 공지를 직접 읽을 수 있었다.
--    새 규칙:
--      플랫폼 관리자 — 전부
--      같은 조직 활성 멤버 —
--        게시 중(published) 공지 — 예전과 같다: 대상(전체 또는 내 역할)일 때만
--        초안 · 보관 공지 — 내가 쓴 것, 또는 announcement.manage 권한이 있으면 그 조직 것 전부
--    게시 중 공지가 보이는 범위는 바꾸지 않는다(모바일 목록 · 홈 · 안 읽음 수가 그대로).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "members can read announcements" on public.announcements;
create policy "members can read announcements"
on public.announcements
for select
using (
  (select public.is_platform_admin())
  or (
    organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
    and (
      (
        status = 'published'
        and (
          target_scope = 'everyone'
          or exists (
            select 1
            from public.memberships m
            where m.organization_id = announcements.organization_id
              and m.user_id = (select auth.uid())
              and m.status = 'active'
              and m.role = any(announcements.target_roles)
          )
        )
      )
      or (
        status <> 'published'
        and (
          created_by_user_id = (select auth.uid())
          or public.has_capability(organization_id, (select auth.uid()), 'announcement.manage')
        )
      )
    )
  )
);

-- 댓글 읽기 — 부모 공지에 같은 규칙(상태 포함)을 건다.
drop policy if exists "members can read visible announcement comments" on public.announcement_comments;
create policy "members can read visible announcement comments"
on public.announcement_comments
for select
using (
  deleted_at is null
  and exists (
    select 1
    from public.announcements a
    where a.id = announcement_comments.announcement_id
      and a.organization_id = announcement_comments.organization_id
      and (
        (select public.is_platform_admin())
        or (
          a.organization_id = any ((select public.current_user_active_organization_ids())::uuid[])
          and (
            (
              a.status = 'published'
              and (
                a.target_scope = 'everyone'
                or exists (
                  select 1
                  from public.memberships m
                  where m.organization_id = a.organization_id
                    and m.user_id = (select auth.uid())
                    and m.status = 'active'
                    and m.role = any(a.target_roles)
                )
              )
            )
            or (
              a.status <> 'published'
              and (
                a.created_by_user_id = (select auth.uid())
                or public.has_capability(a.organization_id, (select auth.uid()), 'announcement.manage')
              )
            )
          )
        )
      )
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) announcement_reads — 본인 행을 고칠 때 신원 칸(user_id · announcement_id · organization_id)을 못 바꾸게(M2).
--    UPDATE 정책은 주인만 봐서, 내 읽음 행의 announcement_id 를 바꿔 남의 공지 · 다른 조직 공지를 «읽음»으로
--    만들 수 있었다. 팝업 닫기(202605160001)와 같은 트리거를 붙인다. 앱은 service role upsert(ignoreDuplicates)라
--    기존 행을 고치지 않는다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.prevent_announcement_read_identity_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.announcement_id  is distinct from old.announcement_id
  or new.organization_id  is distinct from old.organization_id
  or new.user_id          is distinct from old.user_id
  then
    raise exception 'announcement_id, organization_id, and user_id are immutable on announcement_reads';
  end if;
  return new;
end;
$$;

drop trigger if exists announcement_reads_immutable_identity on public.announcement_reads;
create trigger announcement_reads_immutable_identity
before update on public.announcement_reads
for each row execute function public.prevent_announcement_read_identity_change();
