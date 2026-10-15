import { describe, expect, it } from "vitest";

import { getDictionary, locales } from "@/lib/i18n";

/**
 * 클라이언트 컴포넌트로 **통째로 넘어가는** 사전 네임스페이스는 직렬화 가능해야 한다.
 *
 * 2026-08-03 에 `dictionary.tasks.reportPickCount` 를 `(selected, total) => ...` 함수로 넣었다가
 * 프로덕션에서 `/mobile/tasks` 가 통째로 죽었다:
 *
 *   Functions cannot be passed directly to Client Components unless you explicitly expose it
 *   by marking it with "use server".
 *
 * 서버 컴포넌트가 `<TasksWorkspace copy={dict.tasks} />` 로 네임스페이스를 그대로 건네므로, 그 안의
 * 값 하나라도 함수면 RSC 직렬화가 실패하고 화면 전체가 에러 바운더리로 떨어진다. 타입 검사도
 * 린트도 이걸 잡지 못한다(둘 다 함수형 카피 자체는 정상으로 본다) — 실제로 이틀 동안 살아 있었다.
 *
 * 그래서 규칙은: **아래 네임스페이스의 카피는 `{name}` 자리표시자 문자열 + `.replace()`** 로 쓴다.
 * 다른 네임스페이스(서버에서만 읽고 문자열만 넘기는 곳)는 함수형 카피를 계속 써도 된다.
 */
const CLIENT_PASSED_NAMESPACES = ["tasks", "cleaning", "board", "mobile.suggestions", "mobile.notifications.w"] as const;

/** "a.b.c" 경로로 사전을 판다. */
function resolve(dictionary: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dictionary);
}

function findFunctionPaths(value: unknown, path: string, out: string[]) {
  if (typeof value === "function") {
    out.push(path);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    findFunctionPaths(child, `${path}.${key}`, out);
  }
}

describe("dictionary namespaces passed to client components", () => {
  for (const locale of locales) {
    for (const namespace of CLIENT_PASSED_NAMESPACES) {
      it(`${locale}.${namespace} contains no function values`, () => {
        const found: string[] = [];
        findFunctionPaths(resolve(getDictionary(locale), namespace), namespace, found);
        expect(found).toEqual([]);
      });
    }
  }
});
