/**
 * 브랜드 로고 → 앱 · PWA 아이콘 · 시작 화면 일괄 생성 (계획 B1-2, docs/planning/17-app-release-plan.md).
 *
 * **원본 = 이 파일의 SVG 정의**(2026-10-09 「접힌 리넨」 로고로 교체 — 라벤더 바탕 위 보라 3톤 둥근 막대 세 겹).
 * 벡터에서 바로 그리므로 크기마다 선명하다. 시안 캔버스: https://claude.ai/artifact/RVnjFAhUmmZ2CYndfL5e1h (13 Folded Linen).
 * 로고를 바꿀 때는 아래 `BG` · `MARK` 만 고치고 다시 돌린 뒤 `node scripts/gen-splash.mjs` 도 돌린다.
 *
 *   node scripts/dev/generate-app-icons.mjs
 *
 * 만드는 것:
 * - 원본 SVG `public/brand/logo.svg`(바탕 포함 정사각) · `public/brand/logo-mark.svg`(막대만, 투명)
 * - PWA `public/icons/icon-192.png` · `icon-512.png`(둥근 네모, 모서리 투명) · `maskable-512.png`(꽉 찬 바탕, 안전 영역 안 로고)
 *   · `apple-touch-icon.png`(180, 알파 없음) · `public/favicon.ico`(16 · 32 · 48)
 * - 링크 미리보기 `src/app/opengraph-image.png`(1200×630, 바탕 + 가운데 로고 — 카카오톡 · 슬랙 공유 카드)
 * - iOS   `AppIcon.appiconset/AppIcon-512@2x.png` (1024, 알파 없음 — App Store 규칙. 모서리는 iOS 가 자기 곡률로 잘라낸다)
 * - iOS   `Splash.imageset/splash-2732x2732*.png` (아이보리 바탕 + 가운데 로고, LaunchScreen 이 aspectFill)
 * - Android `mipmap-*` ic_launcher(둥근 네모) · ic_launcher_round(원) · 적응형 ic_launcher_foreground(막대) + ic_launcher_background(라벤더)
 * - Android `drawable-nodpi/splash_icon.png` — Android 12+ 시작 화면 아이콘(960px, 240dp 로 그려지므로 크게)
 * - `capacitor-www/icon.png` — 앱 연결 실패 화면 로고
 * - 스토어 원본 `store-assets/icon-1024.png` · `play-icon-512.png`
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const IVORY = "#f7f4ee";
/** 로고 바탕(라벤더). Android 적응형 배경 층 · 시작 화면 아이콘 원 색(`styles.xml`)과 같아야 한다. */
const BG = "#EFE7FF";
/** 막대 세 겹(아래 → 위) + 맨 아래 막대의 흰 줄(접힌 자국 — 시안 13번 그대로, 빠지면 안 된다). viewBox 0 0 100 100 기준. */
const MARK = `<rect x="18" y="62" width="64" height="17" rx="8.5" fill="#5B2BD6"/><rect x="25" y="43" width="50" height="17" rx="8.5" fill="#8A63F0"/><rect x="32" y="24" width="36" height="17" rx="8.5" fill="#B9A0FA"/><path d="M30 70.5 H52" stroke="#EFE7FF" stroke-width="2.5" stroke-linecap="round"/>`;
/** 둥근 네모 곡률(한 변 대비). iOS 마스크(약 22%)와 비슷하게. */
const RADIUS = 0.225;

/**
 * size px 정사각 SVG. markScale = 막대를 가운데 기준으로 줄이는 비율(적응형 · maskable 안전 영역용).
 * rounded = 모서리를 투명하게 깎을지, background = 바탕을 깔지.
 */
function svg(size, { markScale = 1, rounded = false, background = true } = {}) {
  const r = rounded ? 100 * RADIUS : 0;
  const t = (1 - markScale) * 50;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${
    background ? `<rect width="100" height="100" rx="${r}" ry="${r}" fill="${BG}"/>` : ""
  }<g transform="translate(${t} ${t}) scale(${markScale})">${MARK}</g></svg>`;
}

const png = (size, opts) => sharp(Buffer.from(svg(size, opts))).png().toBuffer();
const opaque = async (size, opts) => sharp(await png(size, opts)).flatten({ background: BG }).png().toBuffer();

async function out(rel, buf) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  console.log("wrote", rel);
}

/** 정사각 캔버스 가운데에 그림을 scale 비율로 얹는다. */
async function onCanvas(image, size, scale, background = { r: 0, g: 0, b: 0, alpha: 0 }) {
  const inner = Math.round(size * scale);
  const logo = await sharp(image).resize(inner, inner, { kernel: "lanczos3" }).png().toBuffer();
  const off = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: logo, left: off, top: off }])
    .png()
    .toBuffer();
}

/** 원 마스크. */
async function circle(buf, size) {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(buf).resize(size, size).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

/** PNG 여러 장을 하나의 .ico 로(PNG 내장 ICO — 모든 현역 브라우저가 읽는다). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// 적응형 · maskable: 108dp 중 가운데 72dp 원만 보인다(안전 영역 66dp). 막대 바깥 모서리가 원 안에 들도록 72% 로 줄인다.
const ADAPTIVE_MARK = 0.72;

// ── 원본 SVG ─────────────────────────────────────────────────────────
await out("public/brand/logo.svg", Buffer.from(svg(1024) + "\n"));
await out("public/brand/logo-mark.svg", Buffer.from(svg(1024, { background: false }) + "\n"));

// ── PWA · 웹 ─────────────────────────────────────────────────────────
await out("public/icons/icon-192.png", await png(192, { rounded: true }));
await out("public/icons/icon-512.png", await png(512, { rounded: true }));
await out("public/icons/maskable-512.png", await opaque(512, { markScale: 0.8 }));
await out("public/icons/apple-touch-icon.png", await opaque(180));
await out(
  "public/favicon.ico",
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size, { rounded: true }) })))),
);
// 링크 미리보기(og:image). 없으면 카카오톡이 옛 그림을 계속 보여준다(2026-10-16).
await out(
  "src/app/opengraph-image.png",
  await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${BG}"/><g transform="translate(375 90) scale(4.5)">${MARK}</g></svg>`,
    ),
  )
    .png()
    .toBuffer(),
);

// ── iOS ──────────────────────────────────────────────────────────────
const ios1024 = await opaque(1024);
await out("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", ios1024);
const iosSplash = await onCanvas(await png(1024, { rounded: true }), 2732, 0.16, IVORY);
const iosSplashRgb = await sharp(iosSplash).flatten({ background: IVORY }).png().toBuffer();
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await out(`ios/App/App/Assets.xcassets/Splash.imageset/${name}`, iosSplashRgb);
}

// ── Android ──────────────────────────────────────────────────────────
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const res = "android/app/src/main/res";
for (const [d, k] of Object.entries(densities)) {
  const legacy = Math.round(48 * k);
  const adaptive = Math.round(108 * k);
  // 옛 런처(적응형 이전): 둥근 네모 · 원형.
  await out(`${res}/mipmap-${d}/ic_launcher.png`, await onCanvas(await png(512, { rounded: true }), legacy, 0.92));
  await out(`${res}/mipmap-${d}/ic_launcher_round.png`, await circle(await png(legacy, { markScale: 0.9 }), legacy));
  // 적응형: 전경 = 막대만(투명), 배경 = 라벤더 단색.
  await out(`${res}/mipmap-${d}/ic_launcher_foreground.png`, await png(adaptive, { markScale: ADAPTIVE_MARK, background: false }));
  await out(
    `${res}/mipmap-${d}/ic_launcher_background.png`,
    await sharp({ create: { width: adaptive, height: adaptive, channels: 3, background: BG } }).png().toBuffer(),
  );
}
// Android 12+ 시작 화면 아이콘(아이콘 원 색 = BG, styles.xml). 240dp 중 가운데 160dp 원만 보인다 — 적응형과 같은 비율.
await out(`${res}/drawable-nodpi/splash_icon.png`, await png(960, { markScale: ADAPTIVE_MARK, background: false }));

// 시작 테마는 비트맵을 쓰지 않는다(N11) — 예전 Capacitor 기본 splash.png 가 남아 있으면 지운다.
for (const dir of ["drawable", ...["port", "land"].flatMap((o) => Object.keys(densities).map((d) => `drawable-${o}-${d}`))]) {
  await rm(path.join(root, res, dir, "splash.png"), { force: true });
}

// ── 연결 실패 화면 · 스토어 원본 ────────────────────────────────────────
await out("capacitor-www/icon.png", await png(192, { rounded: true }));
await out("store-assets/icon-1024.png", ios1024);
await out("store-assets/play-icon-512.png", await opaque(512));

console.log("done");
