import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Dev-only Node.js scripts — not subject to Next.js/TS lint rules
    "scripts/**",
    // 디자인 핸드오프 산출물(standalone HTML + 그 자산). git 추적 대상도 아니고 앱 코드도
    // 아닌데 린트에 잡혀 경고 5건을 내고 있었다 — 그 경고는 고칠 대상이 아니라 소음이다.
    ".handoff/**",
    // Capacitor 네이티브 프로젝트(iOS · Android). 안의 JS 는 Capacitor 가 복사해 넣는 생성물이다(2026-10-06).
    "android/**",
    "ios/**",
    // 세션별 작업 트리(.claude/worktrees/*) — 저장소 사본 + 각자의 .next 라 본 저장소 린트에 29만 건이 섞였다(2026-11-01).
    ".claude/**",
    // 셀프 체크인 독립 앱(apps/checkin · apps/checkin-kiosk) — 자기 설정으로 따로 린트 · 빌드한다(2026-11-02, 16 §2).
    "apps/**",
  ]),
]);

export default eslintConfig;
