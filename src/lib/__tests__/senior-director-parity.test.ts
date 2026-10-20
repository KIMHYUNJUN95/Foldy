import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 전무(`senior_managing_director`)는 모든 조직 권한 검사에서 대표(`owner`)와 같다(2026-07-13 결정, docs/product/01-user-roles.md).
 * DB 는 `has_org_role` · `has_capability` 가 owner 를 보면 전무도 통과시키지만, 앱 코드에 직접 적은 역할 목록은 사람이 하나씩 넣어야 해서
 * 2026-10-20 에 여섯 기능(공지 작성 · 청소 · 컴플레인 · 린넨 · 버그 검토 · 게시판)에서 빠져 있었다. 이 테스트는 **대표가 들어 있는 역할 목록
 * 리터럴**(역할 이름이 둘 이상 든 `[...]` · `new Set([...])`)에 전무도 있는지 본다.
 */

const ROLE_NAMES = ["owner", "office_admin", "cs_staff", "field_manager", "staff", "part_time_staff", "developer_super_admin"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "__tests__" || name === "node_modules" || name === "dev-preview") continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("전무 = 대표 (앱 코드의 역할 목록)", () => {
  it("대표가 든 역할 목록에는 전무도 있다", () => {
    const missing: string[] = [];
    // 권한 레지스트리(capabilities.ts)는 `roleHasCapability` 가 owner → 전무를 물려준다(capability-registry.test 「전무는 owner 가 가진 것을 모두 가진다」).
    for (const file of walk("src").filter((path) => !path.endsWith("config/capabilities.ts"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\[([^\[\]]*?)\]/g)) {
        const body = match[1];
        if (!/"owner"/.test(body)) continue;
        const roles = ROLE_NAMES.filter((role) => new RegExp(`"${role}"`).test(body));
        if (roles.length < 2) continue; // 역할 목록이 아니다(예: 차단 목적 "owner")
        if (/"field_staff"|"office_staff"/.test(body)) continue; // 초대 분류(INVITE_CATEGORIES) — 역할이 아니다
        if (!/"senior_managing_director"/.test(body)) {
          const line = source.slice(0, match.index).split("\n").length;
          missing.push(`${file}:${line}`);
        }
      }
    }
    expect(missing, `전무가 빠진 역할 목록:\n${missing.join("\n")}`).toEqual([]);
  });
});
