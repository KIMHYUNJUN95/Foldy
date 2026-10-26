/**
 * ⚠️ 더 이상 쓰지 않는다. 제품 로고는 2026-10-09 「접힌 리넨」(`generate-app-icons.mjs` 의 벡터 정의)이고,
 * 이 스크립트를 돌리면 옛 남색 "S" 임시 마크로 **덮어쓴다**. 앱 아이콘 · 시작 화면은 `generate-app-icons.mjs`(실제 로고 기준)를 쓴다.
 */
/**
 * 1회용: 인라인 SVG로 Foldy PWA / 홈 화면 아이콘을 생성한다 (바이너리 에셋 불필요).
 *
 * 브랜드 마크: 깊은 잉크 네이비 그라데이션 스쿼클 + 아이보리 세리프 이탤릭 "S" ("Foldy" 워드마크가
 * 세리프 이탤릭이다). 임시로 쓰는 깔끔한 마크이므로 나중에 실제 로고 SVG로 바꾸고 다시 실행한다.
 *
 *   node scripts/dev/generate-pwa-icons.mjs
 *
 * public/icons/ 에 출력: icon-192.png, icon-512.png (purpose "any", 둥근 모서리),
 * maskable-512.png (Android 적응형용 풀블리드), apple-touch-icon.png (180, 꽉 찬 정사각형).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const NAVY_LIGHT = "#36568f"; // hsl(223 50% 42%)
const NAVY_DARK = "#1a2c4f"; // hsl(223 54% 22%)
const IVORY = "#f7f4ee";

function svg(size, { maskable = false } = {}) {
  const radius = maskable ? 0 : Math.round(size * 0.22); // OS가 적응형 아이콘을 직접 마스킹함
  // 세리프 이탤릭 "S": 마스커블에서는 적응형 안전 영역 안에 들어오도록 조금 작게.
  const fontSize = Math.round(size * (maskable ? 0.52 : 0.62));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NAVY_LIGHT}"/>
      <stop offset="1" stop-color="${NAVY_DARK}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#g)"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
    font-family="Georgia, 'Times New Roman', 'DejaVu Serif', serif" font-style="italic"
    font-weight="700" font-size="${fontSize}" fill="${IVORY}">S</text>
</svg>`;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../public/icons");

const targets = [
  { name: "icon-192.png", size: 192, maskable: false },
  { name: "icon-512.png", size: 512, maskable: false },
  { name: "maskable-512.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180, maskable: true },
];

await mkdir(outDir, { recursive: true });
for (const t of targets) {
  const buf = Buffer.from(svg(t.size, { maskable: t.maskable }));
  const png = await sharp(buf).png().toBuffer();
  await writeFile(path.join(outDir, t.name), png);
  console.log("wrote", path.relative(path.resolve(here, "../.."), path.join(outDir, t.name)), `${t.size}px`);
}
console.log("done");
