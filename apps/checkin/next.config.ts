import path from "node:path";
import type { NextConfig } from "next";

// 보안 헤더(2026-11-13 점검, docs/engineering/16 §4). 다른 사이트가 이 화면을 틀 안에 넣지 못하게(frame-ancestors · X-Frame-Options),
// 형식 추측 금지, 바깥으로 주소 경로를 흘리지 않게. CSP 는 frame-ancestors 만 — 스크립트 · 이미지(서명 URL) · 카메라 입력을 막지 않는다.
// 카메라 · 마이크는 이 사이트에만 허용(여권 사진 촬영), 위치 · 결제는 쓰지 않는다.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
];

const headers: NextConfig["headers"] = async () => [{ source: "/:path*", headers: SECURITY_HEADERS }];

// 독립 앱 — 로컬에서는 Foldy 루트(../../)의 lockfile · 설정을 끌어오지 않게 루트를 이 폴더로 고정한다.
// Vercel(Root Directory = apps/checkin)에서는 고정하지 않는다. Vercel 빌더(Next 어댑터)는 결과물 경로를 추적 루트 기준으로
// 적고 배포 단계에서 저장소 루트 기준으로 읽는다 — 이 폴더로 고정하면 `/vercel/path0/.next/routes-manifest-deterministic.json`
// ENOENT 로 배포가 실패한다(2026-11-10 첫 배포). 추적 루트가 저장소 루트가 되면 Turbopack 이 Foldy 루트 `middleware.ts` 를
// 끌어오므로 Vercel 빌드는 webpack 으로 한다(`vercel.json` buildCommand). 문서: docs/engineering/16 §7.
const nextConfig: NextConfig = process.env.VERCEL
  ? { headers }
  : {
      headers,
      turbopack: { root: path.resolve(__dirname) },
      outputFileTracingRoot: path.resolve(__dirname),
    };

export default nextConfig;
