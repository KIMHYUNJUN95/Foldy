/**
 * 게스트 피드백 테스트용 가짜 DB — 메모리 표 + PostgREST 흉내(1,000행 상한 · 유니크 위반 23505 · `col->>key` 경로 필터).
 * `fake-supabase.ts` 보다 조금 더 정확해야 하는 곳(조건부 갱신 · 중복 막기)에만 쓴다. 실제 DB 를 부르지 않는다.
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: { code: string; message: string } | null; count?: number | null };

export const FAKE_MAX_ROWS = 1000;

function readPath(row: Row, column: string): unknown {
  const arrow = column.indexOf("->>");
  if (arrow === -1) return row[column];
  const base = row[column.slice(0, arrow)];
  if (!base || typeof base !== "object") return undefined;
  return (base as Row)[column.slice(arrow + 3)];
}

export function createComplaintsFakeDb(options: {
  tables?: Record<string, Row[]>;
  /** 표별 유니크 키(컬럼 묶음). null 이 섞인 줄은 비교하지 않는다(부분 인덱스 `where x is not null` 흉내). */
  unique?: Record<string, string[][]>;
  /** 이 표의 insert / update / upsert 를 실패시키고 싶을 때. 돌려준 오류가 그대로 나간다. */
  failWrite?: (table: string, op: string, payload: unknown) => { code: string; message: string } | null;
  /** 이 select 를 실패시키고 싶을 때(칸 없음 흉내 등). */
  failSelect?: (table: string, columns: string) => { code: string; message: string } | null;
  /** 쓰기 직전에 부른다 — 「읽은 뒤 남이 먼저 바꿈」 같은 경합을 흉내 낼 때. */
  beforeWrite?: (table: string, op: string, tables: Record<string, Row[]>) => void;
} = {}) {
  const tables: Record<string, Row[]> = options.tables ?? {};
  const writes: Array<{ table: string; op: string; payload?: unknown }> = [];
  let nextId = 1;

  function violates(table: string, candidate: Row, ignore?: Row): boolean {
    for (const cols of options.unique?.[table] ?? []) {
      if (cols.some((c) => candidate[c] === null || candidate[c] === undefined)) continue;
      const hit = (tables[table] ?? []).some(
        (row) => row !== ignore && cols.every((c) => String(row[c]) === String(candidate[c])),
      );
      if (hit) return true;
    }
    return false;
  }

  function builder(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: unknown;
    let onConflict: string[] = [];
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    let single: "none" | "single" | "maybe" = "none";
    let wantCount = false;
    let columns = "*";
    let orders: Array<{ column: string; ascending: boolean }> = [];
    const rows = () => (tables[table] ??= []);

    const run = (): Result => {
      if (op !== "select") options.beforeWrite?.(table, op, tables);
      if (op !== "select" && op !== "delete") {
        const failed = options.failWrite?.(table, op, payload) ?? null;
        if (failed) return { data: null, error: failed };
      }
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        for (const row of list) {
          if (violates(table, row)) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
        }
        const inserted = list.map((row) => ({ id: `id-${nextId++}`, ...row }));
        rows().push(...inserted);
        writes.push({ op, payload: list, table });
        return { data: single !== "none" ? inserted[0] : inserted, error: null };
      }
      if (op === "upsert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const out: Row[] = [];
        for (const row of list) {
          const existing = onConflict.length
            ? rows().find((r) => onConflict.every((c) => String(r[c]) === String(row[c])))
            : undefined;
          if (existing) {
            Object.assign(existing, row);
            out.push(existing);
          } else {
            const inserted = { id: `id-${nextId++}`, ...row };
            rows().push(inserted);
            out.push(inserted);
          }
        }
        writes.push({ op, payload: list, table });
        return { data: out, error: null };
      }
      if (op === "select") {
        const failed = options.failSelect?.(table, columns) ?? null;
        if (failed) return { data: null, error: failed };
      }
      const matched = rows().filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") {
        for (const row of matched) {
          if (violates(table, { ...row, ...(payload as Row) }, row)) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
        }
        for (const row of matched) Object.assign(row, payload as Row);
        writes.push({ op, payload, table });
        return { data: single !== "none" ? (matched[0] ?? null) : matched, error: null };
      }
      if (op === "delete") {
        tables[table] = rows().filter((row) => !matched.includes(row));
        writes.push({ op, table, payload: matched });
        return { data: matched, error: null };
      }
      let sorted = matched;
      if (orders.length > 0) {
        sorted = [...matched].sort((a, b) => {
          for (const order of orders) {
            const left = String(a[order.column] ?? "");
            const right = String(b[order.column] ?? "");
            if (left !== right) return (left < right ? -1 : 1) * (order.ascending ? 1 : -1);
          }
          return 0;
        });
      }
      const from = rangeFrom ?? 0;
      const to = rangeTo ?? FAKE_MAX_ROWS - 1;
      const page = sorted.slice(from, Math.min(to + 1, from + FAKE_MAX_ROWS));
      const count = wantCount ? matched.length : null;
      if (single === "single") {
        if (page.length !== 1) return { data: null, error: { code: "PGRST116", message: "not single" } };
        return { data: page[0], error: null, count };
      }
      if (single === "maybe") return { data: page[0] ?? null, error: null, count };
      return { data: page.map((row) => ({ ...row })), error: null, count };
    };

    const api = {
      select(cols?: string, opts?: { count?: string }) {
        if (opts?.count) wantCount = true;
        if (cols) columns = cols;
        return api;
      },
      insert(value: unknown) {
        op = "insert";
        payload = value;
        return api;
      },
      upsert(value: unknown, opts?: { onConflict?: string }) {
        op = "upsert";
        payload = value;
        onConflict = (opts?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
        return api;
      },
      update(value: unknown) {
        op = "update";
        payload = value;
        return api;
      },
      delete() {
        op = "delete";
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => String(readPath(row, column)) === String(value));
        return api;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => String(readPath(row, column)) !== String(value));
        return api;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (readPath(row, column) ?? null) === value);
        return api;
      },
      not(column: string, operator: string, value: unknown) {
        if (operator === "is") filters.push((row) => (readPath(row, column) ?? null) !== value);
        return api;
      },
      in(column: string, values: unknown[]) {
        const set = new Set(values.map(String));
        filters.push((row) => set.has(String(readPath(row, column))));
        return api;
      },
      gte(column: string, value: unknown) {
        filters.push((row) => String(readPath(row, column)) >= String(value));
        return api;
      },
      lt(column: string, value: unknown) {
        filters.push((row) => String(readPath(row, column)) < String(value));
        return api;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orders = [...orders, { column, ascending: opts?.ascending !== false }];
        return api;
      },
      range(from: number, to: number) {
        rangeFrom = from;
        rangeTo = to;
        return api;
      },
      limit(n: number) {
        rangeFrom = 0;
        rangeTo = n - 1;
        return api;
      },
      maybeSingle() {
        single = "maybe";
        return api;
      },
      single() {
        single = "single";
        return api;
      },
      then<T>(resolve: (value: Result) => T, reject?: (reason: unknown) => T) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (error) {
          return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
        }
      },
    };
    return api;
  }

  const client = { from: (table: string) => builder(table) };
  return { client, tables, writes };
}
