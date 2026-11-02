import path from "node:path";
import type { NextConfig } from "next";

// 독립 앱 — Foldy 루트(../../)의 lockfile · 설정을 끌어오지 않게 루트를 이 폴더로 고정한다.
const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
