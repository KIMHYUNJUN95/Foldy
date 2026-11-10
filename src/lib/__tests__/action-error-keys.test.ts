import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { getDictionary, locales } from "@/lib/i18n";

/**
 * 서버 액션이 `?error=<사유>` 로 넘기는 키는 **반드시 사전에 있어야 한다.**
 *
 * 이 저장소의 모바일·콘솔 서버 액션들은 실패해도 throw 하지 않고 `redirect("...?error=키")` 로
 * 화면에 되돌려 보낸다. 화면은 `copy.errors[키]` 를 배너로 띄운다. 키가 사전에 없으면 그 값이
 * `undefined` 가 되어 **배너가 통째로 안 그려지고, 사용자에게는 버튼이 먹통인 것처럼 보인다.**
 *
 * 2026-08-04 실제 사고: `dictionary.cleaning.errors` 에 9종 중 5종만 있어 "셋팅 시작을 눌러도
 * 아무 일이 없다"로 보고됐다. 액션은 정상 실행되고 303 으로 돌아오고 있었다. `errors` 객체가
 * `as Record<string, string>` 이라 타입 검사가 잡지 못했고, 린트도 잡을 수 없는 종류였다.
 *
 * 같은 점검에서 `mobile/orders/new` 와 `admin/maintenance`(목록)는 아예 `?error=` 를 **읽지도
 * 않고** 있던 것도 드러났다. 그건 이 테스트가 잡을 수 없으니(사전이 아니라 화면 쪽 문제),
 * 새 액션에 실패 리다이렉트를 붙일 때는 화면이 그 파라미터를 읽는지도 함께 확인할 것.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");

/** 액션 파일 → 그 화면이 읽는 사전 네임스페이스 경로. */
const ACTION_NAMESPACES: { file: string; namespace: string }[] = [
  { file: "src/app/mobile/cleaning/actions.ts", namespace: "cleaning.errors" },
  { file: "src/app/mobile/lost-found/new/actions.ts", namespace: "lostFound.errors" },
  { file: "src/app/mobile/maintenance/new/actions.ts", namespace: "maintenance.errors" },
  { file: "src/app/mobile/orders/new/actions.ts", namespace: "mobile.orderForm.errors" },
  { file: "src/app/mobile/suggestions/actions.ts", namespace: "mobile.suggestions.errors" },
  { file: "src/app/mobile/tasks/new/actions.ts", namespace: "tasks.errors" },
  { file: "src/app/mobile/tasks/[id]/actions.ts", namespace: "tasks.errors" },
  { file: "src/app/mobile/tasks/projects/actions.ts", namespace: "tasks.errors" },
  // src/app/admin/maintenance/actions.ts 는 2026-11-10 에 redirect 로 실패를 넘기던 `updateMaintenanceStatus` 를 지워 빠졌다(결과 객체만 돌려준다).
  { file: "src/app/admin/settings/actions.ts", namespace: "admin.settings.errors" },
  { file: "src/app/admin/settings/attendance/actions.ts", namespace: "admin.settings.errors" },
  { file: "src/app/auth/actions.ts", namespace: "auth.errors" },
  { file: "src/app/onboarding/actions.ts", namespace: "onboarding.errors" },
];

/**
 * 소스에서 실패 사유 키를 뽑는다. 두 가지 표기를 모두 본다:
 *   redirect("/path?error=some_key")   ·   redirectWithError("some_key")
 * 값이 변수인 경우(`?error=${key}`)는 정적으로 알 수 없어 건너뛴다.
 */
function emittedErrorKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const m of source.matchAll(/[?&]error=([a-z][a-z0-9_]*)/g)) keys.add(m[1]);
  for (const m of source.matchAll(/redirectWithError\(\s*"([a-z][a-z0-9_]*)"/g)) keys.add(m[1]);
  return [...keys].sort();
}

function lookup(dictionary: unknown, path: string): Record<string, string> | undefined {
  return path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dictionary) as
    | Record<string, string>
    | undefined;
}

describe("server action error keys exist in every locale", () => {
  for (const { file, namespace } of ACTION_NAMESPACES) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    const keys = emittedErrorKeys(source);

    it(`${file} emits at least one error key`, () => {
      // 키를 못 뽑았다면 파일이 옮겨졌거나 표기가 바뀐 것 — 조용히 통과시키지 않는다.
      expect(keys.length).toBeGreaterThan(0);
    });

    for (const locale of locales) {
      it(`${file} → ${namespace} (${locale})`, () => {
        const errors = lookup(getDictionary(locale), namespace);
        expect(errors, `${namespace} not found in ${locale}`).toBeDefined();
        expect(keys.filter((key) => !(key in (errors ?? {})))).toEqual([]);
      });
    }
  }
});
