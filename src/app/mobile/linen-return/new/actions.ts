"use server";

import { redirect } from "next/navigation";
import {
  getActiveLinenItems,
  isKnownBuilding,
  revalidateLinenReturnPaths,
} from "@/lib/linen-returns";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type RawLine = { itemId?: string; quantity?: unknown };
type RecordRow = Database["public"]["Tables"]["linen_return_records"]["Row"];
type LineRow = Database["public"]["Tables"]["linen_return_record_items"]["Row"];

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseLines(value: string): RawLine[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l) => l && typeof l === "object") as RawLine[];
  } catch {
    return [];
  }
}

function newPath(building: string, error?: string) {
  const base = `/mobile/linen-return/new?building=${encodeURIComponent(building)}`;
  return error ? `${base}&error=${error}` : base;
}

function getCurrentTokyoDayRange() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const from = new Date(Date.UTC(year, month - 1, day, -9, 0, 0)).toISOString();
  const to = new Date(Date.UTC(year, month - 1, day + 1, -9, 0, 0)).toISOString();
  return { from, to };
}

function mergeNote(existing: string | null, incoming: string) {
  if (!incoming) return existing ?? null;
  if (!existing) return incoming;
  if (existing === incoming) return existing;
  return `${existing}\n\n${incoming}`;
}

/** CLAUDE.md §8 — 기능당 5장. 수정 액션 · 어드민 콘솔과 같은 상한(2026-10-26 서버에서도 강제). */
const MAX_PHOTOS = 5;

function mergeImageUrls(existing: string[] | null, incoming: string[]) {
  return Array.from(new Set([...(existing ?? []), ...incoming]));
}

export async function createLinenReturnRecord(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/linen-return")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const building = cleanText(formData.get("building"));
  if (!building) {
    redirect("/mobile/linen-return");
  }
  if (!(await isKnownBuilding(session, building))) {
    redirect(newPath(building, "invalid_building"));
  }

  const note = cleanText(formData.get("note"));
  const rawLines = parseLines(cleanText(formData.get("linesJson")));

  // 항목 id 를 건물의 활성 카탈로그와 대조해 검증한다(실패 시 닫힘).
  const catalog = await getActiveLinenItems(session, building);
  const validItemIds = new Set(catalog.map((item) => item.id));

  const seen = new Set<string>();
  const lines: { itemId: string; quantity: number }[] = [];
  for (const raw of rawLines) {
    const itemId = String(raw.itemId ?? "").trim();
    const quantity = Number(raw.quantity);
    if (!itemId || !validItemIds.has(itemId)) {
      redirect(newPath(building, "invalid_item"));
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      redirect(newPath(building, "invalid_quantity"));
    }
    if (seen.has(itemId)) {
      redirect(newPath(building, "duplicate_item"));
    }
    seen.add(itemId);
    lines.push({ itemId, quantity });
  }

  if (lines.length === 0) {
    redirect(newPath(building, "missing_items"));
  }

  const imageUrls = formData
    .getAll("imageUrls")
    .map((v) => String(v))
    .filter((u) => u.startsWith("https://") || u.startsWith("http://"));
  if (imageUrls.length > MAX_PHOTOS) {
    redirect(newPath(building, "too_many_photos"));
  }

  // 유효하면 클라이언트가 만든 id(이미지 폴더로도 쓰임)를 재사용해
  // 새 기록에서 사진 저장 경로와 기록 id 가 일치하게 하고,
  // 같은 날 병합 저장은 후속 업로드 폴더의 새 사진을 덧붙일 수 있다.
  const requestedId = cleanText(formData.get("id"));
  const recordId = requestedId && isValidUuid(requestedId) ? requestedId : crypto.randomUUID();
  const supabase = await getSupabaseServerClient();
  const { from, to } = getCurrentTokyoDayRange();

  const { data: sameDayRecord, error: sameDayRecordError } = await supabase
    .from("linen_return_records")
    .select("id, note, image_urls")
    .eq("organization_id", session.organization.id)
    .eq("building_name", building)
    .eq("registered_by_user_id", session.user.id)
    .gte("registered_at", from)
    .lt("registered_at", to)
    .order("registered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sameDayRecordError) {
    redirect(newPath(building, "save_failed"));
  }

  if (sameDayRecord) {
    const targetRecord = sameDayRecord as Pick<RecordRow, "id" | "note" | "image_urls">;
    // 합친 뒤 사진이 5장을 넘으면 아무것도 쓰기 전에 거절한다 — 줄 수량만 더해지고 사진에서 막히는 반쪽 저장이 없게.
    const mergedImageUrls = mergeImageUrls(targetRecord.image_urls, imageUrls);
    if (mergedImageUrls.length > MAX_PHOTOS) {
      redirect(newPath(building, "too_many_photos_merged"));
    }
    const { data: existingLineData, error: existingLinesError } = await supabase
      .from("linen_return_record_items")
      .select("id, linen_item_id, quantity, sort_order")
      .eq("return_record_id", targetRecord.id)
      .order("sort_order", { ascending: true });
    if (existingLinesError) {
      redirect(newPath(building, "save_failed"));
    }

    const existingLines = (existingLineData ?? []) as Array<
      Pick<LineRow, "id" | "linen_item_id" | "quantity" | "sort_order">
    >;
    const existingByItemId = new Map(existingLines.map((line) => [line.linen_item_id, line]));

    for (const line of lines) {
      const existing = existingByItemId.get(line.itemId);
      if (!existing) continue;
      const lineUpdate: Database["public"]["Tables"]["linen_return_record_items"]["Update"] = {
        quantity: existing.quantity + line.quantity,
      };
      const { error: updateLineError } = await supabase
        .from("linen_return_record_items")
        .update(lineUpdate)
        .eq("id", existing.id);
      if (updateLineError) {
        redirect(newPath(building, "save_failed"));
      }
    }

    let nextSortOrder =
      existingLines.reduce((max, line) => Math.max(max, line.sort_order), -1) + 1;
    const newLineInserts: Database["public"]["Tables"]["linen_return_record_items"]["Insert"][] =
      [];
    for (const line of lines) {
      if (existingByItemId.has(line.itemId)) continue;
      newLineInserts.push({
        return_record_id: targetRecord.id,
        linen_item_id: line.itemId,
        quantity: line.quantity,
        sort_order: nextSortOrder,
      });
      nextSortOrder += 1;
    }

    if (newLineInserts.length > 0) {
      const { error: insertNewLinesError } = await supabase
        .from("linen_return_record_items")
        .insert(newLineInserts);
      if (insertNewLinesError) {
        redirect(newPath(building, "save_failed"));
      }
    }

    const headerUpdate: Database["public"]["Tables"]["linen_return_records"]["Update"] = {
      note: mergeNote(targetRecord.note, note),
      image_urls: mergedImageUrls,
    };
    const { error: updateRecordError } = await supabase
      .from("linen_return_records")
      .update(headerUpdate)
      .eq("id", targetRecord.id)
      .eq("organization_id", session.organization.id);
    if (updateRecordError) {
      redirect(newPath(building, "save_failed"));
    }

    revalidateLinenReturnPaths();
    // merged=1 — 완료 화면이 「오늘 등록한 기록에 합쳐졌어요」를 보여 준다(2026-10-14 화이트 리디자인).
    redirect(
      `/mobile/linen-return/list?building=${encodeURIComponent(building)}&created=${targetRecord.id}&merged=1`,
    );
  }

  const recordInsert: Database["public"]["Tables"]["linen_return_records"]["Insert"] = {
    id: recordId,
    organization_id: session.organization.id,
    building_name: building,
    note: note || null,
    image_urls: imageUrls,
    registered_by_user_id: session.user.id,
  };

  const { error: recordError } = await supabase
    .from("linen_return_records")
    .insert(recordInsert);
  if (recordError) {
    redirect(newPath(building, "save_failed"));
  }

  const lineInserts: Database["public"]["Tables"]["linen_return_record_items"]["Insert"][] =
    lines.map((line, index) => ({
      return_record_id: recordId,
      linen_item_id: line.itemId,
      quantity: line.quantity,
      sort_order: index,
    }));

  const { error: linesError } = await supabase
    .from("linen_return_record_items")
    .insert(lineInserts);
  if (linesError) {
    // 고아 헤더를 롤백해 저장이 실패해도 부분 기록이 남지 않게 한다.
    await supabase.from("linen_return_records").delete().eq("id", recordId);
    redirect(newPath(building, "save_failed"));
  }

  // 건물 목록으로 돌아가 거기서 완료 연출을 보여준다
  // (created=<id> 가 영향받은 행을 강조하며, 새로 만들었든 병합했든 동일).
  revalidateLinenReturnPaths();
  redirect(
    `/mobile/linen-return/list?building=${encodeURIComponent(building)}&created=${recordId}`,
  );
}
