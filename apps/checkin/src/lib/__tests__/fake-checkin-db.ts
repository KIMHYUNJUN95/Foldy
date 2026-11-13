// 라우트 테스트용 메모리 DB — 조건부 update · 부분 고유 인덱스(기기당 진행 중 통화 하나)까지 흉내 낸다.
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type FakeDb = ReturnType<typeof fakeCheckinDb>;

export function fakeCheckinDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const rpcCalls: { name: string; args: Row }[] = [];
  let nextId = 1;
  const hooks = {
    rpc: (() => ({ data: 1, error: null })) as (name: string, args: Row) => { data: unknown; error: { message: string } | null },
    beforeUpdate: null as null | ((table: string) => void),
    selectError: null as null | ((table: string, columns: string) => { code: string; message: string } | null),
    insertError: null as null | ((table: string) => { code: string; message: string } | null),
  };

  function query(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: Filter[] = [];
    let action: { kind: "select" } | { kind: "update"; values: Row } | { kind: "insert"; values: Row[] } | { kind: "delete" } = { kind: "select" };
    let sort: { column: string; ascending: boolean } | null = null;
    let slice: { from: number; to: number } | null = null;
    let headCount = false;
    let insertError: { code: string; message: string } | null = null;
    let selectFailure: { code: string; message: string } | null = null;

    const run = (): Row[] => {
      if (selectFailure) {
        insertError = selectFailure;
        return [];
      }
      if (action.kind === "insert") {
        const failed = hooks.insertError?.(table) ?? null;
        if (failed) {
          insertError = failed;
          return [];
        }
        for (const value of action.values) {
          const active = value.status === "ringing" || value.status === "accepted";
          if (table === "staff_calls" && active && rows().some((row) => row.device_id === value.device_id && (row.status === "ringing" || row.status === "accepted"))) {
            insertError = { code: "23505", message: "duplicate key" };
            return [];
          }
        }
        const created = action.values.map((value) =>
          table === "claim_attempts"
            ? { id: value.id ?? nextId++, ...value, attempted_at: value.attempted_at ?? new Date().toISOString() }
            : { ...value },
        );
        rows().push(...created);
        return created;
      }
      let matched = rows().filter((row) => filters.every((filter) => filter(row)));
      if (action.kind === "delete") {
        tables[table] = rows().filter((row) => !matched.includes(row));
        return matched;
      }
      if (sort) {
        const { column, ascending } = sort;
        matched = [...matched].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
      }
      if (slice) matched = matched.slice(slice.from, slice.to + 1);
      if (action.kind === "update") {
        hooks.beforeUpdate?.(table);
        const stillMatched = rows().filter((row) => filters.every((filter) => filter(row)));
        for (const row of stillMatched) Object.assign(row, action.values);
        return stillMatched;
      }
      return matched;
    };

    const builder = {
      select(columns = "*", options?: { count?: string; head?: boolean }) {
        if (action.kind === "select") selectFailure = hooks.selectError?.(table, columns) ?? null;
        if (options?.head) headCount = true;
        return builder;
      },
      delete() {
        action = { kind: "delete" };
        return builder;
      },
      gt(column: string, value: unknown) {
        filters.push((row) => String(row[column]) > String(value));
        return builder;
      },
      gte(column: string, value: unknown) {
        filters.push((row) => String(row[column]) >= String(value));
        return builder;
      },
      insert(values: Row | Row[]) {
        action = { kind: "insert", values: Array.isArray(values) ? values : [values] };
        return builder;
      },
      update(values: Row) {
        action = { kind: "update", values };
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        sort = { column, ascending: options?.ascending ?? true };
        return builder;
      },
      limit(count: number) {
        slice = { from: 0, to: count - 1 };
        return builder;
      },
      range(from: number, to: number) {
        slice = { from, to };
        return builder;
      },
      async maybeSingle() {
        const data = run();
        return { data: data[0] ?? null, error: insertError };
      },
      async single() {
        const data = run();
        return { data: data[0] ?? null, error: insertError ?? (data[0] ? null : { message: "no rows" }) };
      },
      then(resolve: (value: { data: Row[] | null; count?: number; error: unknown }) => unknown) {
        const data = run();
        if (headCount) return Promise.resolve(resolve({ data: null, count: data.length, error: insertError }));
        return Promise.resolve(resolve({ data, error: insertError }));
      },
    };
    return builder;
  }

  const db = {
    tables,
    rpcCalls,
    hooks,
    from: query,
    schema: () => db,
    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });
      return hooks.rpc(name, args);
    },
  };
  return db;
}
