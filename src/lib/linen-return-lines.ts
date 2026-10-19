import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type LineRow = Database["public"]["Tables"]["linen_return_record_items"]["Row"];
type ExistingLine = Pick<LineRow, "id" | "linen_item_id" | "quantity" | "sort_order">;

export type DesiredLinenLine = { itemId: string; quantity: number };

export type LinenLinePlan = {
  inserts: { linen_item_id: string; quantity: number; sort_order: number }[];
  updates: { id: string; quantity: number; sort_order: number; before: { quantity: number; sort_order: number } }[];
  deletes: ExistingLine[];
};

/** 지금 품목 → 원하는 품목. 바뀌지 않은 행은 건드리지 않는다. */
export function planLinenLineReplace(
  existing: ExistingLine[],
  desired: DesiredLinenLine[],
): LinenLinePlan {
  const byItem = new Map(existing.map((line) => [line.linen_item_id, line]));
  const wanted = new Set(desired.map((line) => line.itemId));
  const plan: LinenLinePlan = { inserts: [], updates: [], deletes: [] };

  desired.forEach((line, index) => {
    const current = byItem.get(line.itemId);
    if (!current) {
      plan.inserts.push({ linen_item_id: line.itemId, quantity: line.quantity, sort_order: index });
    } else if (current.quantity !== line.quantity || current.sort_order !== index) {
      plan.updates.push({
        id: current.id,
        quantity: line.quantity,
        sort_order: index,
        before: { quantity: current.quantity, sort_order: current.sort_order },
      });
    }
  });
  for (const line of existing) {
    if (!wanted.has(line.linen_item_id)) plan.deletes.push(line);
  }
  return plan;
}

/**
 * 기록의 품목 행을 원하는 집합으로 바꾼다 — 추가 → 수정 → 삭제 순서.
 *
 * 예전엔 「전부 지우고 다시 넣기」였는데, 품목 INSERT 정책이 작성자만 허용해서 관리자가 남의 기록을
 * 고치면 DELETE 만 성공하고 INSERT 가 막혀 **품목이 통째로 사라졌다**(2026-10-19 발견). 지우기를
 * 맨 끝에 두면 어느 단계에서 실패해도 원래 품목이 남고, 앞 단계에서 바꾼 것은 되돌린다.
 * 반환값의 `before` 는 감사 기록용 수정 전 품목.
 */
export async function replaceLinenRecordLines(
  supabase: SupabaseClient<Database>,
  recordId: string,
  desired: DesiredLinenLine[],
): Promise<{ ok: true; before: ExistingLine[] } | { ok: false }> {
  const { data, error } = await supabase
    .from("linen_return_record_items")
    .select("id, linen_item_id, quantity, sort_order")
    .eq("return_record_id", recordId);
  if (error) return { ok: false };
  const before = (data ?? []) as ExistingLine[];
  const plan = planLinenLineReplace(before, desired);

  let insertedIds: string[] = [];
  if (plan.inserts.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("linen_return_record_items")
      .insert(plan.inserts.map((line) => ({ ...line, return_record_id: recordId })))
      .select("id");
    if (insertError) return { ok: false };
    insertedIds = (inserted ?? []).map((row) => row.id);
  }

  const applied: LinenLinePlan["updates"] = [];
  const rollback = async () => {
    for (const update of applied) {
      await supabase
        .from("linen_return_record_items")
        .update(update.before)
        .eq("id", update.id);
    }
    if (insertedIds.length > 0) {
      await supabase.from("linen_return_record_items").delete().in("id", insertedIds);
    }
  };

  for (const update of plan.updates) {
    const { error: updateError } = await supabase
      .from("linen_return_record_items")
      .update({ quantity: update.quantity, sort_order: update.sort_order })
      .eq("id", update.id);
    if (updateError) {
      await rollback();
      return { ok: false };
    }
    applied.push(update);
  }

  if (plan.deletes.length > 0) {
    const { error: deleteError } = await supabase
      .from("linen_return_record_items")
      .delete()
      .in(
        "id",
        plan.deletes.map((line) => line.id),
      );
    if (deleteError) {
      await rollback();
      return { ok: false };
    }
  }

  return { ok: true, before };
}
