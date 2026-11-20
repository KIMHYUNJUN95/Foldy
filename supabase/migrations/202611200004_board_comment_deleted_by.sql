-- 게시판 댓글 「누가 지웠는지」 칸 — 2026-11-20 (게시판 unslop 3차, 되돌리기 권한 감사).
--
-- 권한:       docs/engineering/05-rls-permissions.md → board_comments
-- 데이터 모델: docs/engineering/04-data-model.md → board_comments
-- 화면 흐름:   docs/product/23-board-workflow.md → 12-E
--
-- 댓글 지우기는 `deleted_at` 소프트 삭제이고 60초 안에 「되돌리기」가 된다. 예전 판정(쓴 사람 또는 board.manage)으로는
-- 쓴 사람이 관리자가 지운(신고 처리 포함) 댓글을 되살리거나, 관리자가 쓴 사람이 지운 댓글을 되살릴 수 있었다.
-- 이 칸에 지운 사람을 남기고, 되돌리기는 `deleted_by_user_id = 나` 일 때만 한다(서버 액션 `restoreBoardComment`).
--
-- - 더하기만 한다: 기본값 없음, 예전 행은 null(= 되돌릴 수 없음), 인덱스 없음(이 칸으로 찾는 조회가 없다).
-- - 참조는 `created_by_user_id` 와 같은 `public.profiles(id)`. 직원 계정이 지워지면 null 이 된다(on delete set null).
-- - 쓰기 권한: 표 권한은 202606250001 의 표 단위 grant 그대로다. authenticated 에는 board_comments UPDATE 정책이 없어
--   (select · insert · delete 정책만) 사용자 키로는 이 칸을 쓸 수 없다. 쓰기는 서버 키(service_role)만 한다 —
--   `deleteBoardComment` · `resolveBoardReport(remove)` 가 채우고 `restoreBoardComment` 가 비운다.
--
-- 배포 순서: **이 마이그레이션 먼저 → 코드.** 코드가 이 칸에 쓰므로 적용 전에 코드를 올리면 댓글 지우기가 실패한다.
-- 다시 돌려도 같은 결과다(add column if not exists · comment 만 쓴다).
--
-- 되돌리기(필요할 때만):
--   alter table public.board_comments drop column if exists deleted_by_user_id;

alter table public.board_comments
  add column if not exists deleted_by_user_id uuid null references public.profiles(id) on delete set null;

comment on column public.board_comments.deleted_by_user_id is
  '댓글을 지운 사람(쓴 사람 · board.manage · 신고 처리). 되돌리기는 이 사람만 60초 안에. 되돌리면 null. 202611200004.';
