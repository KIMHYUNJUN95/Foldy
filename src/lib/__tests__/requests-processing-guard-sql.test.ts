import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 요청 처리 칸 보호 트리거(202611100001) — 로컬 DB 가 없어서 SQL 을 정적으로 확인한다.
 * 트리거가 세 표에 붙는지 · 처리 권한 키가 앱과 같은지 · 쓰는 열이 실제로 있는지 · 외래 키 set null 을 막지 않는지.
 * 실제 동작(일반 사용자 / service_role 로 INSERT · UPDATE)은 개발 DB 에서 따로 돌려 봐야 한다.
 */
const SQL = readFileSync("supabase/migrations/202611100001_requests_permission_hardening.sql", "utf8");

function fnBody(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}()`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = SQL.indexOf("$$;", start);
  return SQL.slice(start, end);
}

function rowColumns(table: string): Set<string> {
  const columns = new Set<string>();
  let current: string | null = null;
  let inRow = false;
  for (const line of readFileSync("src/types/database.ts", "utf8").split("\n")) {
    const t = /^ {6}(\w+): \{$/.exec(line);
    if (t) current = t[1];
    if (/^ {8}Row: \{$/.test(line)) {
      inRow = current === table;
      continue;
    }
    if (inRow && /^ {8}\}/.test(line)) inRow = false;
    const c = /^ {10}(\w+)\??:/.exec(line);
    if (inRow && c) columns.add(c[1]);
  }
  return columns;
}

const GUARDS = [
  { capability: "order_processor", fn: "enforce_order_request_insert", ops: "before insert", start: "'requested'", table: "order_requests" },
  { capability: "maintenance_status_change", fn: "enforce_maintenance_report_processing", ops: "before insert or update", start: "'open'", table: "maintenance_reports" },
  { capability: "lost_found.handle", fn: "enforce_lost_item_processing", ops: "before insert or update", start: "'registered'", table: "lost_items" },
] as const;

describe("요청 처리 칸 보호 트리거 SQL", () => {
  for (const guard of GUARDS) {
    describe(guard.table, () => {
      const body = fnBody(guard.fn);

      it("트리거가 표에 붙는다", () => {
        const re = new RegExp(`create trigger \\w+\\s+${guard.ops}\\s+on public\\.${guard.table}\\s+for each row\\s+execute function public\\.${guard.fn}\\(\\)`);
        expect(SQL).toMatch(re);
      });

      it("앱과 같은 처리 권한 키 + 플랫폼 관리자, 서버 경로(auth.uid 없음)는 통과", () => {
        expect(body).toContain(`'${guard.capability}'`);
        expect(body).toContain("public.is_platform_admin()");
        expect(body).toMatch(/if \(select auth\.uid\(\)\) is null then\s+return new;/);
      });

      it("등록은 시작 상태로만", () => {
        expect(body).toContain(guard.start);
      });

      it("search_path 를 비우고 일반 역할 실행 권한을 거둔다", () => {
        expect(body).toContain("set search_path = ''");
        expect(SQL).toContain(`revoke all on function public.${guard.fn}() from public, anon, authenticated;`);
      });

      it("쓰는 열이 모두 실제 표에 있다", () => {
        const columns = rowColumns(guard.table);
        expect(columns.size).toBeGreaterThan(0);
        const used = new Set([...body.matchAll(/\b(?:new|old)\.(\w+)/g)].map((m) => m[1]));
        for (const column of used) expect(columns.has(column), `${guard.table}.${column}`).toBe(true);
      });
    });
  }

  it("수리 · 분실물 수정: 소속은 누구도 못 바꾸고, 외래 키 set null 은 막지 않는다", () => {
    for (const fn of ["enforce_maintenance_report_processing", "enforce_lost_item_processing"]) {
      const body = fnBody(fn);
      expect(body).toContain("new.reported_by_user_id is distinct from old.reported_by_user_id");
      expect(body).toContain("v_new - 'cleaning_session_id'");
      expect(body).toContain("v_new - 'reservation_id'");
    }
    expect(fnBody("enforce_maintenance_report_processing")).toContain("v_new - 'completed_by'");
    expect(fnBody("enforce_lost_item_processing")).toContain("v_new - 'handled_by'");
  });

  it("현장 관리자는 남의 요청 삭제 권한에서 빠진다", () => {
    expect(SQL).toMatch(/delete from public\.capability_roles\s+where capability = 'request\.delete_any'\s+and role = 'field_manager'/);
  });
});
