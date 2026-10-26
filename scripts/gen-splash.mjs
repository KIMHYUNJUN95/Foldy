/**
 * 모든 최신 iPhone 크기용 iOS apple-touch-startup-image PNG 를 생성한다.
 * `sharp` 필요 (Next.js 의 간접 의존성으로 이미 설치됨).
 *
 * 출력: public/splash/apple-splash-{W}-{H}.png
 * 실행:   node scripts/gen-splash.mjs
 */

import sharp from "sharp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ICON_PATH = path.join(ROOT, "public/icons/icon-512.png");
const OUT_DIR = path.join(ROOT, "public/splash");

// 2026-10-19: 웹 진입 화면(app-splash 의 짧은 쪽)과 똑같이 — 흰 바탕, 로고 110pt 를 화면 정가운데. 시작 이미지 → 웹의 모인 로고 →
// 홈으로 끊김 없이 이어지게 한다. 로고 크기는 기기 배율(dpr)마다 110pt × dpr 픽셀. 바꾸면 `.spl__tile`(110px)도 같이.
const BG = { r: 255, g: 255, b: 255, alpha: 1 };
const ICON_PT = 110;

// 최신 iPhone 의 고유 물리 픽셀 크기 전체 (세로 방향).
// media query → (device-width: Wpt) and (device-height: Hpt) and (-webkit-device-pixel-ratio: R)
const SIZES = [
  { w: 1320, h: 2868, dw: 440, dh: 956, dpr: 3 }, // iPhone 16 Pro Max
  { w: 1290, h: 2796, dw: 430, dh: 932, dpr: 3 }, // iPhone 16 Plus / 15 Pro Max / 14 Pro Max
  { w: 1206, h: 2622, dw: 402, dh: 874, dpr: 3 }, // iPhone 16 Pro
  { w: 1179, h: 2556, dw: 393, dh: 852, dpr: 3 }, // iPhone 16 / 15 Pro / 15 / 14 Pro
  { w: 1284, h: 2778, dw: 428, dh: 926, dpr: 3 }, // iPhone 15 Plus / 14 Plus / 13 Pro Max / 12 Pro Max
  { w: 1170, h: 2532, dw: 390, dh: 844, dpr: 3 }, // iPhone 14 / 13 Pro / 13 / 12 Pro / 12
  { w: 1125, h: 2436, dw: 375, dh: 812, dpr: 3 }, // iPhone 13 mini / 12 mini / 11 Pro / XS / X
  { w: 1242, h: 2688, dw: 414, dh: 896, dpr: 3 }, // iPhone 11 Pro Max / XS Max
  { w: 828,  h: 1792, dw: 414, dh: 896, dpr: 2 }, // iPhone 11 / XR
  { w: 1080, h: 2340, dw: 360, dh: 780, dpr: 3 }, // (레거시 대체 크기; 정확히 대응하는 iPhone 없음)
  { w: 750,  h: 1334, dw: 375, dh: 667, dpr: 2 }, // iPhone SE (2·3세대)
];

if (!fs.existsSync(ICON_PATH)) {
  console.error(`Icon not found: ${ICON_PATH}`);
  process.exit(1);
}

for (const { w, h, dw, dh, dpr } of SIZES) {
  const ICON_PX = ICON_PT * dpr;
  const iconBuf = await sharp(ICON_PATH).resize(ICON_PX, ICON_PX, { fit: "cover" }).toBuffer();
  const left = Math.round((w - ICON_PX) / 2);
  const top  = Math.round((h - ICON_PX) / 2);
  const file = path.join(OUT_DIR, `apple-splash-${w}-${h}.png`);

  await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: iconBuf, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(file);

  console.log(`✓  ${w}×${h}  (${dw}×${dh} @${dpr}x)  →  public/splash/apple-splash-${w}-${h}.png`);
}

console.log(`\nDone — ${SIZES.length} splash images written to public/splash/`);

// layout.tsx 에 붙여 넣을 <link> 태그 출력
console.log("\n--- <link> tags for layout.tsx ---");
for (const { w, h, dw, dh, dpr } of SIZES) {
  const media = `(device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`;
  console.log(`  <link rel="apple-touch-startup-image" media="${media}" href="/splash/apple-splash-${w}-${h}.png?v=2" />`);
}
