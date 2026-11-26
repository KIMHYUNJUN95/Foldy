/**
 * 테스트용 가짜 Supabase — 메모리 표 + PostgREST 의 **1,000행 상한**을 흉내 낸다(`.range()` 없이 읽으면 1,000행에서 자른다).
 * 판매 캘린더 쓰기 경로의 회귀 테스트가 쓴다(`ops-calendar-write-integrity.test.ts`). 실제 DB 도 Beds24 도 부르지 않는다.
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export const FAKE_MAX_ROWS = 1000;

/** 칸 값 — `raw_payload->>id` 같은 JSON 경로는 그 칸이 줄에 있으면 그것, 없으면 jsonb 안에서 읽는다. */
function valueOf(row: Row, column: string): unknown {
  if (column in row) return row[column];
  const arrow = column.indexOf("->>");
  if (arrow > 0) {
    const json = row[column.slice(0, arrow)];
    if (json && typeof json === "object") return (json as Row)[column.slice(arrow + 3)];
  }
  return undefined;
}

/** 맨 바깥 쉼표로 나누기(괄호 안 쉼표는 그대로). */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.filter((part) => part.length > 0);
}

/**
 * PostgREST 논리 식(`.or()` 안) 흉내 — `칸.연산.값` · `칸.not.연산.값` · `and(…)` · `or(…)`.
 * 연산은 eq · neq · lt · lte · gt · gte · is(null · true · false) · in((a,b)). 칸 값이 NULL 이면 비교는 거짓(SQL 처럼, `is` 만 예외).
 */
function logicFilter(term: string): Filter {
  const nested = /^(and|or)\((.*)\)$/.exec(term);
  if (nested) {
    const parts = splitTopLevel(nested[2]).map(logicFilter);
    return nested[1] === "and" ? (row) => parts.every((f) => f(row)) : (row) => parts.some((f) => f(row));
  }
  const first = term.indexOf(".");
  const column = term.slice(0, first);
  let rest = term.slice(first + 1);
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const operator = rest.slice(0, dot);
  const raw = rest.slice(dot + 1).replace(/^"(.*)"$/, "$1");
  const base: Filter = (row) => {
    const value = valueOf(row, column) ?? null;
    if (operator === "is") return raw === "null" ? value === null : String(value) === raw;
    if (value === null) return false;
    const text = String(value);
    switch (operator) {
      case "eq":
        return text === raw;
      case "neq":
        return text !== raw;
      case "lt":
        return text < raw;
      case "lte":
        return text <= raw;
      case "gt":
        return text > raw;
      case "gte":
        return text >= raw;
      case "in":
        return splitTopLevel(raw.replace(/^\((.*)\)$/, "$1")).includes(text);
      default:
        return true;
    }
  };
  if (!negate) return base;
  // SQL 처럼 NOT(NULL 비교) 도 NULL — `is` 가 아니면 NULL 칸은 빠진다.
  return (row) => (operator !== "is" && (valueOf(row, column) ?? null) === null ? false : !base(row));
}

export function createFakeSupabase(
  tables: Record<string, Row[]>,
  /** 이름별 가짜 DB 함수(없으면 `{ data: true }`). 같은 표 묶음을 받아 직접 고친다. */
  rpcHandlers: Record<string, (args: Record<string, unknown>, tables: Record<string, Row[]>) => { data: unknown; error: unknown }> = {},
) {
  const writes: Array<{ table: string; op: string; payload?: unknown; matched?: Row[] }> = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  let nextId = 1;

  function builder(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: unknown;
    let upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    let single = false;
    /** `select(cols, { count: "exact", head: true })` — 맞는 줄 수만(`count`), head 면 데이터 없이. */
    let countMode: { head: boolean } | null = null;
    let orders: Array<{ column: string; ascending: boolean }> = [];
    const rows = () => (tables[table] ??= []);

    const run = () => {
      if (op === "upsert" && upsertOptions.onConflict) {
        // 겹침 칸이 주어지면 PostgREST 처럼 — 있으면 고치거나(ignoreDuplicates 면 건너뜀), 없으면 넣는다.
        const keys = upsertOptions.onConflict.split(",").map((k) => k.trim());
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const out: Row[] = [];
        for (const row of list) {
          const existing = rows().find((r) => keys.every((k) => String(r[k]) === String(row[k])));
          if (existing) {
            if (!upsertOptions.ignoreDuplicates) Object.assign(existing, row);
            out.push(existing);
          } else {
            const inserted = { id: `id-${nextId++}`, created_at: new Date().toISOString(), ...row };
            rows().push(inserted);
            out.push(inserted);
          }
        }
        writes.push({ op, payload: list, table });
        return { data: single ? out[0] : out, error: null };
      }
      if (op === "insert" || op === "upsert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const inserted = list.map((row) => ({ id: `id-${nextId++}`, created_at: new Date().toISOString(), ...row }));
        rows().push(...inserted);
        writes.push({ op, payload: list, table });
        return { data: single ? inserted[0] : inserted, error: null };
      }
      const matched = rows().filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") {
        for (const row of matched) Object.assign(row, payload as Row);
        writes.push({ matched, op, payload, table });
        return { data: single ? (matched[0] ?? null) : matched, error: null };
      }
      if (op === "delete") {
        tables[table] = rows().filter((row) => !matched.includes(row));
        writes.push({ matched, op, table });
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
      if (countMode) return { count: sorted.length, data: countMode.head ? null : sorted, error: null };
      const from = rangeFrom ?? 0;
      const to = rangeTo ?? FAKE_MAX_ROWS - 1;
      const page = sorted.slice(from, Math.min(to + 1, from + FAKE_MAX_ROWS));
      if (single) return { data: page[0] ?? null, error: null };
      return { data: page, error: null };
    };

    const api = {
      delete() {
        op = "delete";
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => String(valueOf(row, column)) === String(value));
        return api;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => String(valueOf(row, column)) !== String(value));
        return api;
      },
      /** `filter(칸, "eq" | "is", 값)` 만 흉내(`raw_payload->>id` 같은 JSON 경로 포함). 그 밖 연산자는 거르지 않는다. */
      filter(column: string, operator: string, value: unknown) {
        if (operator === "eq") filters.push((row) => String(valueOf(row, column)) === String(value));
        if (operator === "is") filters.push((row) => (valueOf(row, column) ?? null) === value);
        return api;
      },
      gte(column: string, value: unknown) {
        filters.push((row) => String(valueOf(row, column)) >= String(value));
        return api;
      },
      gt(column: string, value: unknown) {
        filters.push((row) => String(valueOf(row, column)) > String(value));
        return api;
      },
      in(column: string, values: unknown[]) {
        const set = new Set(values.map(String));
        filters.push((row) => set.has(String(valueOf(row, column))));
        return api;
      },
      insert(value: unknown) {
        op = "insert";
        payload = value;
        return api;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (valueOf(row, column) ?? null) === value);
        return api;
      },
      limit(count?: number) {
        if (typeof count === "number" && rangeTo === null) {
          rangeFrom = rangeFrom ?? 0;
          rangeTo = rangeFrom + count - 1;
        }
        return api;
      },
      lt(column: string, value: unknown) {
        filters.push((row) => String(valueOf(row, column)) < String(value));
        return api;
      },
      lte(column: string, value: unknown) {
        filters.push((row) => String(valueOf(row, column)) <= String(value));
        return api;
      },
      maybeSingle() {
        single = true;
        return api;
      },
      like(column: string, pattern: string) {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`);
        filters.push((row) => re.test(String(valueOf(row, column) ?? "")));
        return api;
      },
      /** `not(칸, "is", null)` · `not(jsonb 칸, "cs", '{"키":값}')`(얕은 포함) 만 흉내(그 밖은 거르지 않음). */
      not(column?: string, operator?: string, value?: unknown) {
        if (column && operator === "is") filters.push((row) => (valueOf(row, column) ?? null) !== value);
        if (column && operator === "cs") {
          const needle = JSON.parse(String(value)) as Row;
          filters.push((row) => {
            const json = valueOf(row, column);
            // PostgreSQL 처럼 칸이 NULL 이면 `NOT (NULL @> …)` 도 NULL — 줄이 빠진다.
            if (!json || typeof json !== "object") return false;
            return !Object.entries(needle).every(([key, expected]) => (json as Row)[key] === expected);
          });
        }
        return api;
      },
      /** `or("a.eq.1,and(b.is.null,c.gt.2)")` — 맨 바깥은 OR. 여러 번 부르면 서로 AND(PostgREST 처럼). */
      or(expression: string) {
        const parts = splitTopLevel(expression).map(logicFilter);
        filters.push((row) => parts.some((f) => f(row)));
        return api;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orders = [...orders, { ascending: options?.ascending !== false, column }];
        return api;
      },
      range(from: number, to: number) {
        rangeFrom = from;
        rangeTo = to;
        return api;
      },
      select(_columns?: string, options?: { count?: string; head?: boolean }) {
        if (options?.count) countMode = { head: options.head === true };
        return api;
      },
      single() {
        single = true;
        return api;
      },
      then<T>(resolve: (value: ReturnType<typeof run>) => T, reject?: (reason: unknown) => T) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (error) {
          return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
        }
      },
      update(value: unknown) {
        op = "update";
        payload = value;
        return api;
      },
      upsert(value: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        op = "upsert";
        payload = value;
        upsertOptions = options ?? {};
        return api;
      },
    };
    return api;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ args, name });
      const handler = rpcHandlers[name];
      if (handler) return handler(args as Record<string, unknown>, tables);
      return { data: true, error: null };
    },
  };
  return { client, rpcCalls, tables, writes };
}
