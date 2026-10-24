import type { NextConfig } from "next";

/**
 * Supabase Storage 호스트.
 *
 * 예전에는 프로젝트 ref 를 문자열로 박아 뒀다. 프로젝트를 옮기면 이미지가 **조용히 전부** 깨지는
 * 종류의 고정값이라, 이미 있는 환경변수에서 뽑고 지금 값을 대비책으로 둔다. `next.config` 는
 * Next 가 `.env*` 를 읽은 뒤에 평가되므로 로컬·Vercel 양쪽에서 값이 들어온다.
 */
const SUPABASE_HOSTNAME = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "sspdgzkytkpmquqsfaup.supabase.co";
  try {
    return new URL(raw).hostname;
  } catch {
    return "sspdgzkytkpmquqsfaup.supabase.co";
  }
})();

/**
 * 이 배포의 이름표(2026-10-19). 문서 응답마다 `x-foldy-build` 헤더로 싣고 `/api/build` 가 같은 값을 돌려준다.
 * 서비스 워커는 저장해 둔 화면의 이름표가 지금 배포와 다르면 그 화면을 내주지 않는다(`public/sw.js`) — 옛 화면을
 * 먼저 그렸다가 Next 가 빌드 차이로 페이지를 통째로 다시 불러와 **진입 모션이 두 번 돌던 것**(Edge 설치 앱)을 막는다.
 * 같은 커밋을 다시 배포해도 Next 빌드는 달라지므로 커밋보다 배포 id 를 먼저 쓴다.
 */
const DEPLOY_ID = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";

const nextConfig: NextConfig = {
  // React Compiler — 자동 메모이제이션.
  //
  // **이 코드베이스는 오래전부터 컴파일러가 켜져 있다고 전제하고 쓰여 왔다.** `tasks-workspace.tsx`
  // 에는 "React Compiler 가 메모이제이션을 보존하지 못하고 컴포넌트 전체를 포기한다"는 이유로
  // `useMemo` 를 넣거나 선언 순서를 맞춘 주석이 여럿 있다. 그런데 실제로는 설정도 패키지도 없어
  // **꺼진 상태였다**(2026-09-03 확인). 즉 그 배려가 아무 효과도 못 내고 있었다.
  //
  // 켜는 이유: 관리자 투두 콘솔(4900줄)과 모바일 워크스페이스(2500줄)는 메모이제이션 경계가 없어
  // state 하나만 바뀌어도 본문 전체가 다시 실행된다. 그 둘을 손으로 쪼개는 것은 상태 결합도가
  // 높아 회귀 위험이 크다 — 컴파일러가 같은 문제를 훨씬 안전하게 푼다.
  reactCompiler: true,
  // 지금 기기에서 도는 빌드를 진단 표시(화면 스와이프 — `src/lib/swipe-back/debug.ts`)에 띄우려는 것. 홈 화면 앱은 옛
  // 빌드가 캐시에서 한 번 더 뜨므로 「고친 코드가 실제로 돌고 있는가」부터 확인해야 한다(2026-10-09).
  env: { NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7), FOLDY_DEPLOY_ID: DEPLOY_ID },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "x-foldy-build", value: DEPLOY_ID }] }];
  },
  // Allow dev resource access (HMR + client chunks) when the app is opened via
  // the WSL network IP instead of localhost. Dev-only; no effect on production.
  // `*.trycloudflare.com` covers Cloudflare quick tunnels (random subdomain each
  // run) so the app can be opened on a phone over any network, not just same-WiFi.
  // `127.0.0.1` is the iOS Simulator app pointed at the local server
  // (`CAP_SERVER_URL=http://127.0.0.1:3000` — Capacitor iOS reserves `localhost`).
  allowedDevOrigins: ["127.0.0.1", "172.20.50.244", "10.255.255.254", "192.168.1.112", "*.trycloudflare.com"],
  /**
   * 개발 서버에서는 `/sw.js` 를 스스로 해제하는 kill-switch 로 바꿔 낸다(`public/sw-dev-reset.js`).
   * 같은 localhost 에서 전에 프로덕션으로 띄울 때 깔린 SW 가 dev 요청을 가로채 옛 캐시를 내주면
   * 무한 로딩에 걸린다(2026-09-28). `beforeFiles` 라야 `public/sw.js` 보다 먼저 적용된다.
   */
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return { beforeFiles: [{ source: "/sw.js", destination: "/sw-dev-reset.js" }] };
  },
  images: {
    /**
     * `next/image` 는 허용 목록에 없는 원격 주소를 만나면 **렌더 중에 던진다.** 화면이 안 뜨고
     * 에러 경계가 대신 뜨므로, 사진 한 장이 페이지 전체를 죽인다. 실제로 근태 → 교통비 영수증이
     * 그렇게 막혀 있었다(2026-09-11).
     *
     * Supabase Storage 의 주소는 **두 갈래**다. 공개 버킷은 `/object/public/...`, 비공개 파일의
     * 서명 URL(`createSignedUrl`)은 `/object/sign/...` 이다. 영수증은 비공개라 서명 URL 인데
     * 허용 목록에는 `public` 만 있었다 — 버킷 이름(`request-images`)은 맞는데 **경로가 달라서**
     * 걸린 것이라 원인이 눈에 잘 안 띄었다.
     *
     * 그래서 두 갈래를 **짝으로** 둔다. 새 버킷을 추가할 때도 public/sign 을 같이 넣어야 한다 —
     * 한쪽만 넣으면 그 화면은 나중에 비공개로 바뀌는 순간 통째로 죽는다.
     */
    remotePatterns: [
      // 공지 이미지 — 공개 버킷.
      {
        hostname: SUPABASE_HOSTNAME,
        pathname: "/storage/v1/object/public/announcement-images/**",
        protocol: "https",
      },
      {
        hostname: SUPABASE_HOSTNAME,
        pathname: "/storage/v1/object/sign/announcement-images/**",
        protocol: "https",
      },
      // 요청 이미지 — 청소·정비·분실물·게시판 사진과 **교통비 영수증**이 같은 버킷을 쓴다.
      // 영수증은 서명 URL 로만 열린다.
      {
        hostname: SUPABASE_HOSTNAME,
        pathname: "/storage/v1/object/public/request-images/**",
        protocol: "https",
      },
      {
        hostname: SUPABASE_HOSTNAME,
        pathname: "/storage/v1/object/sign/request-images/**",
        protocol: "https",
      },
    ],
  },
};

export default nextConfig;
