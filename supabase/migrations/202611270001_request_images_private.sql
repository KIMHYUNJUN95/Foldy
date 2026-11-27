-- request-images 버킷을 비공개로(2026-11-27, 결정 A).
--
-- 예전에는 공개 버킷이라 주소만 알면 누구나(로그인 없이) 사진을 열 수 있었다. 이제 화면은
-- `/api/request-images/{경로}` (src/app/api/request-images/[...path]/route.ts) 로 열고, 그 라우트가
-- 조직 멤버 · 근태 정정 / 연차 사진을 올린 본인 · 권한을 확인한 뒤 5분짜리 서명 주소로 보낸다.
--
-- 바꾸는 것은 buckets.public 하나다. 올리기 · 지우기 · 읽기 정책(202605210008 · 202607060002 · 202611200005 ·
-- 202611240001)은 그대로 둔다 — 브라우저 올리기는 INSERT 정책으로 계속 되고, DB 에 저장하는 주소 모양
-- (`.../object/public/request-images/...`)도 그대로다(getPublicUrl 은 비공개 버킷에서도 같은 문자열을 만든다).
--
-- 주의: 202605210008_request_images.sql 의 `insert ... on conflict (id) do update set public = excluded.public`
-- 을 다시 돌리면 버킷이 다시 공개가 된다. 그 파일은 다시 실행하지 않는다(이미 적용된 마이그레이션은 고치지 않는다).
--
-- 적용 순서: 202611270002(사진 주인 함수) → 라우트 · 화면 코드 배포 → 이 SQL 적용 → 예전 공개 주소가 400/404 인지 확인
-- (docs/engineering/07-environment-setup.md 「request-images 비공개 전환」).
-- 되돌리기: update storage.buckets set public = true where id = 'request-images';

update storage.buckets set public = false where id = 'request-images';
