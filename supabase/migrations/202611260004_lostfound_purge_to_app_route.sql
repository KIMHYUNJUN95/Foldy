-- 분실물 자동 삭제를 pg_cron SQL 에서 앱 크론 라우트로 옮긴다(2026-11-26).
--
-- 예전 `public.lostfound_auto_purge()`(202607180001)는 폐기 후 90일 지난 lost_items 행만 지우고 사진 파일
-- (request-images 버킷 `{조직}/lost-items/{id}/…` · `{조직}/lost-found-handling/{id}/…`)은 저장소에 남겼다.
-- Supabase 는 storage.objects 직접 DELETE 를 막아 SQL 안에서는 파일을 못 지운다 — Storage API 가 필요하다.
-- 그래서 Vercel Cron `/api/lost-found/purge`(매일 15:15 UTC)가 행마다 사진 먼저 → 행 나중으로 지운다.
--
-- 적용 순서: 코드 배포 뒤 이 마이그레이션. 먼저 적용해도 자동 삭제가 하루 비는 것뿐이다.
-- 자동 폐기(lostfound_auto_dispose · 'lostfound-auto-dispose')는 그대로 둔다.

do $$ begin
  perform cron.unschedule('lostfound-auto-purge');
exception
  when others then null;
end $$;

drop function if exists public.lostfound_auto_purge();
