import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // apps/* 는 독립 앱 — 자기 vitest 설정으로 돈다. .claude/worktrees 는 다른 세션 작업 트리(2026-11-02).
    exclude: [...configDefaults.exclude, "apps/**", ".claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve("./src"),
    },
  },
});
