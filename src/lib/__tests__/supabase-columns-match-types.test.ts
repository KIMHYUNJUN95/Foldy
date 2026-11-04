import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 쿼리에 쓴 열 이름이 `src/types/database.ts` 에 있는지 소스를 읽어 대조한다.
 *
 * tsc 가 못 잡는 이유: supabase-js 는 없는 열을 `.select("id")` 하면 컴파일 오류가 아니라 **`data` 타입을 오류 타입으로** 바꿀 뿐이라,
 * `if (result.data)` 처럼 값을 읽지 않으면 그냥 통과한다. `.eq("없는열", …)` · `onConflict` 는 문자열이라 아예 검사되지 않는다.
 * 그렇게 2026-11-04 `cleaning_list_extra_rooms.select("id")`(42703)가 들어가 방 추가가 항상 실패했다.
 */

function schemaColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  let table: string | null = null;
  let inRow = false;
  for (const line of readFileSync("src/types/database.ts", "utf8").split("\n")) {
    const tableMatch = /^ {6}(\w+): \{$/.exec(line);
    if (tableMatch) table = tableMatch[1];
    if (/^ {8}Row: \{$/.test(line)) {
      inRow = true;
      if (table) tables.set(table, new Set());
      continue;
    }
    if (inRow && /^ {8}\}/.test(line)) inRow = false;
    const column = /^ {10}(\w+)\??:/.exec(line);
    if (inRow && table && column) tables.get(table)!.add(column[1]);
  }
  return tables;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && path !== join("src", "types", "database.ts") ? [path] : [];
  });
}

/** 파일 하나의 `.from("표")` 사슬에서 쓴 열 — 임베드(`a(b)`) · 별칭이 있는 select 는 건너뛴다. */
export function columnsUsed(text: string): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = [];
  const constants = new Map([...text.matchAll(/const (\w+) = "([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const fromMatches = [...text.matchAll(/\.from\("(\w+)"\)/g)];
  fromMatches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = Math.min(fromMatches[index + 1]?.index ?? text.length, text.indexOf(";\n", start) === -1 ? text.length : text.indexOf(";\n", start));
    const chain = text.slice(start, end);
    const push = (column: string) => out.push({ column: column.trim(), table: match[1] });
    for (const select of chain.matchAll(/\.select\(\s*(?:"([^"]*)"|([A-Z_]+))/g)) {
      const list = select[1] ?? constants.get(select[2]) ?? "";
      if (list.includes("(") || list.includes(":")) continue;
      for (const column of list.split(",")) if (column.trim() && column.trim() !== "*" && !column.includes("->")) push(column);
    }
    // JSON 경로(`raw_payload->>phone`)는 정규식 `\w+` 에 걸리지 않는다.
    for (const filter of chain.matchAll(/\.(?:eq|neq|in|is|not|gt|gte|lt|lte|order)\("(\w+)"/g)) push(filter[1]);
    for (const conflict of chain.matchAll(/onConflict: "([^"]*)"/g)) for (const column of conflict[1].split(",")) push(column);
  });
  return out;
}

const SCHEMA = schemaColumns();

describe("쿼리 열 이름 ↔ src/types/database.ts", () => {
  it("타입 파일을 실제로 읽었다 — 형식이 바뀌어 표가 비면 아래 검사가 조용히 통과하므로 막는다", () => {
    expect(SCHEMA.size).toBeGreaterThan(50);
    expect(SCHEMA.get("cleaning_assignments")?.has("room_key")).toBe(true);
    const scanned = sourceFiles("src").flatMap((file) => columnsUsed(readFileSync(file, "utf8")));
    expect(scanned.length).toBeGreaterThan(500);
    expect(scanned.filter(({ table }) => SCHEMA.has(table)).length).toBeGreaterThan(500);
  });

  it("검사기 자체 — 없는 열을 잡는다", () => {
    const used = columnsUsed(`await supabase.from("cleaning_list_extra_rooms").select("id").eq("organization_id", org).maybeSingle();\n`);
    expect(used.filter(({ column, table }) => !SCHEMA.get(table)?.has(column))).toEqual([{ column: "id", table: "cleaning_list_extra_rooms" }]);
  });

  it("src 의 모든 .select · 필터 · onConflict 열이 타입 파일에 있다", () => {
    const missing = sourceFiles("src").flatMap((file) =>
      columnsUsed(readFileSync(file, "utf8"))
        .filter(({ column, table }) => SCHEMA.has(table) && !SCHEMA.get(table)!.has(column))
        .map(({ column, table }) => `${file}: ${table}.${column}`),
    );
    expect([...new Set(missing)]).toEqual([]);
  });
});
