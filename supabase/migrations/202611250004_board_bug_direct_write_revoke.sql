-- 게시판 · 버그 신고 표 — 사용자 직접 쓰기 권한 회수 (2026-11-25, 점검 높음 1).
--
-- 202606250001(board_posts · board_post_reads · board_comments · board_reactions) · 202606250004(bug_reports) 가
-- authenticated 에 INSERT · UPDATE · DELETE 를 줬고, Supabase 기본 권한으로 anon 에도 모든 권한이 붙어 있을 수 있다.
-- 쓰기 RLS 정책은 「본인 + 같은 조직」만 보고 앱의 검사(사진 5장 · 저장 경로 · 고정 권한 · 댓글 허용 · 소프트 삭제 ·
-- 버그 상태 흐름 · 알림)를 하지 않는다. 그래서 직원 누구나 자기 로그인 토큰 + 공개 anon 키로 PostgREST 를 바로 부르면
--   - 고정 글을 만들거나 남의 반응 · 읽음을 꾸미고, 댓글 막힌 글에 댓글을 달고,
--   - 사진 · 첨부 상한과 경로 검사를 건너뛰고, 소프트 삭제 대신 행을 아예 지우고(신고 기록 연쇄 삭제),
--   - 검토자는 버그 신고 상태를 알림 없이 바꿀 수 있었다.
-- 앱의 쓰기는 이미 전부 서버 액션의 service role 로만 한다(2026-11-25 코드 확인 — src/app/mobile/board/** ·
-- src/actions/board-moderation.ts · src/lib/board-queries.ts(읽음 upsert) · src/lib/bug-reports.ts ·
-- src/lib/notifications/create.ts(읽기만), 사용자 세션 쓰기 없음). service role 은 GRANT 와 RLS 를 모두 우회하므로
-- 이 회수로 앱 동작은 바뀌지 않는다. 읽기(SELECT)는 사용자 클라이언트 + RLS 로 계속 한다(board-queries.ts · bug-reports.ts,
-- 저장소 정책의 하위 질의도 SELECT 만 쓴다).
-- 쓰기 정책도 지운다 — 권한이 없으면 쓰이지 않지만, 나중에 누가 권한을 되돌려도 앱 검사를 건너뛰는 길이 다시 열리지 않게.
-- 이름은 202606250001 · 202606250004 · 202610210007(alter policy, 이름 그대로) 기준. if exists 라 두 번 돌려도 같다.
-- 문서: docs/engineering/05-rls-permissions.md → 게시판 · 버그 신고 「직접 쓰기 회수(2026-11-25)」.

begin;

revoke all on table
  public.board_posts,
  public.board_comments,
  public.board_reactions,
  public.board_post_reads,
  public.bug_reports
from anon;

revoke insert, update, delete, truncate, references, trigger on table
  public.board_posts,
  public.board_comments,
  public.board_reactions,
  public.board_post_reads,
  public.bug_reports
from authenticated;

grant select on table
  public.board_posts,
  public.board_comments,
  public.board_reactions,
  public.board_post_reads,
  public.bug_reports
to authenticated;

drop policy if exists "board posts: active members can create" on public.board_posts;
drop policy if exists "board posts: authors and admins can update" on public.board_posts;
drop policy if exists "board posts: authors and admins can delete" on public.board_posts;

drop policy if exists "board comments: active members can create" on public.board_comments;
drop policy if exists "board comments: authors and admins can delete" on public.board_comments;

drop policy if exists "board reactions: users can insert own" on public.board_reactions;
drop policy if exists "board reactions: users can delete own" on public.board_reactions;

drop policy if exists "board reads: insert own" on public.board_post_reads;
drop policy if exists "board reads: upsert own" on public.board_post_reads;

drop policy if exists "bug reports: active members can create" on public.bug_reports;
drop policy if exists "bug reports: author can update while submitted" on public.bug_reports;
drop policy if exists "bug reports: reviewer can update status" on public.bug_reports;
drop policy if exists "bug reports: author can delete while submitted" on public.bug_reports;

commit;
