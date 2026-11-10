import path from "node:path";
import type { NextConfig } from "next";

// 독립 앱 — 로컬에서는 Foldy 루트(../../)의 lockfile · 설정을 끌어오지 않게 루트를 이 폴더로 고정한다.
// Vercel(Root Directory = apps/checkin)에서는 고정하지 않는다. Vercel 빌더(Next 어댑터)는 결과물 경로를 추적 루트 기준으로
// 적고 배포 단계에서 저장소 루트 기준으로 읽는다 — 이 폴더로 고정하면 `/vercel/path0/.next/routes-manifest-deterministic.json`
// ENOENT 로 배포가 실패한다(2026-11-10 첫 배포). 추적 루트가 저장소 루트가 되면 Turbopack 이 Foldy 루트 `middleware.ts` 를
// 끌어오므로 Vercel 빌드는 webpack 으로 한다(`vercel.json` buildCommand). 문서: docs/engineering/16 §7.
const nextConfig: NextConfig = process.env.VERCEL
  ? {}
  : {
      turbopack: { root: path.resolve(__dirname) },
      outputFileTracingRoot: path.resolve(__dirname),
    };

export default nextConfig;
