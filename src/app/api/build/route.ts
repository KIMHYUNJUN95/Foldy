// 지금 배포의 이름표(2026-10-19) — 서비스 워커가 앱을 켤 때 저장해 둔 화면이 같은 배포의 것인지 확인한다(`public/sw.js`).
// 빌드 때 굳는 값이라 정적으로 낸다(배포마다 CDN 에서 바로 응답, 함수 실행 없음). 로그인 없이 열리고 비밀값은 없다.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ build: process.env.FOLDY_DEPLOY_ID ?? "dev" });
}
