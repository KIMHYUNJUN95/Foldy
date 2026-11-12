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
      /** `not(칸, "is", null)` 만 흉내(그 밖은 거르지 않음). */
      not(column?: string, operator?: string, value?: unknown) {
        if (column && operator === "is") filters.push((row) => (valueOf(row, column) ?? null) !== value);
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
      select() {
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
