import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planLinenLineReplace, replaceLinenRecordLines } from "../linen-return-lines";
import type { Database } from "@/types/database";

type Line = { id: string; linen_item_id: string; quantity: number; sort_order: number };

const existing: Line[] = [
  { id: "l1", linen_item_id: "towel", quantity: 2, sort_order: 0 },
  { id: "l2", linen_item_id: "sheet", quantity: 1, sort_order: 1 },
];

/** 실제 쿼리 순서를 기록하고, 지정한 동작을 실패시키는 가짜 클라이언트. */
function fakeClient(rows: Line[], failOn: "insert" | "update" | "delete" | null) {
  const log: string[] = [];
  let nextId = 100;
  const client = {
    from() {
      let op = "select";
      let payload: unknown = null;
      let ids: string[] = [];
      const builder = {
        select() {
          return builder;
        },
        insert(value: unknown) {
          op = "insert";
          payload = value;
          return builder;
        },
        update(value: unknown) {
          op = "update";
          payload = value;
          return builder;
        },
        delete() {
          op = "delete";
          return builder;
        },
        eq(column: string, value: string) {
          if (column === "id") ids = [value];
          return builder;
        },
        in(_column: string, values: string[]) {
          ids = values;
          return builder;
        },
        then(resolve: (r: unknown) => void) {
          if (op === "select") return resolve({ data: rows.map((r) => ({ ...r })), error: null });
          log.push(`${op}:${ids.join(",") || JSON.stringify(payload)}`);
          if (op === failOn) return resolve({ data: null, error: { message: "denied" } });
          if (op === "insert") {
            const inserted = (payload as unknown[]).map(() => ({ id: `n${nextId++}` }));
            return resolve({ data: inserted, error: null });
          }
          return resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, log };
}

describe("planLinenLineReplace", () => {
  it("남길 것은 수정, 새 것은 추가, 빠진 것만 삭제 — 같은 행은 건드리지 않는다", () => {
    const plan = planLinenLineReplace(existing, [
      { itemId: "towel", quantity: 2 },
      { itemId: "pillow", quantity: 3 },
    ]);
    expect(plan.inserts).toEqual([{ linen_item_id: "pillow", quantity: 3, sort_order: 1 }]);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes.map((l) => l.id)).toEqual(["l2"]);
  });

  it("수량 · 순서가 바뀌면 수정으로 잡는다", () => {
    const plan = planLinenLineReplace(existing, [
      { itemId: "sheet", quantity: 5 },
      { itemId: "towel", quantity: 2 },
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates.map((u) => [u.id, u.quantity, u.sort_order])).toEqual([
      ["l2", 5, 0],
      ["l1", 2, 1],
    ]);
    expect(plan.deletes).toEqual([]);
  });
});

describe("replaceLinenRecordLines", () => {
  const desired = [
    { itemId: "towel", quantity: 4 },
    { itemId: "pillow", quantity: 1 },
  ];

  it("추가 → 수정 → 삭제 순서로 실행한다", async () => {
    const { client, log } = fakeClient(existing, null);
    const result = await replaceLinenRecordLines(client, "r1", desired);
    expect(result.ok).toBe(true);
    expect(log.map((l) => l.split(":")[0])).toEqual(["insert", "update", "delete"]);
    expect(log[2]).toBe("delete:l2");
  });

  it("추가가 막히면(남의 기록 · RLS) 아무것도 지우지 않는다 — 품목이 사라지지 않는다", async () => {
    const { client, log } = fakeClient(existing, "insert");
    const result = await replaceLinenRecordLines(client, "r1", desired);
    expect(result.ok).toBe(false);
    expect(log.some((l) => l.startsWith("delete") || l.startsWith("update"))).toBe(false);
  });

  it("삭제가 실패하면 앞서 바꾼 수량과 추가한 행을 되돌린다", async () => {
    const { client, log } = fakeClient(existing, "delete");
    const result = await replaceLinenRecordLines(client, "r1", desired);
    expect(result.ok).toBe(false);
    expect(log).toEqual(["insert:" + JSON.stringify([{ linen_item_id: "pillow", quantity: 1, sort_order: 1, return_record_id: "r1" }]), "update:l1", "delete:l2", "update:l1", "delete:n100"]);
  });
});
