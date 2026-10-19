"use server";

import { redirect } from "next/navigation";
import {
  canManageLinenRecord,
  getActiveLinenItems,
  getLinenReturnRecordById,
  revalidateLinenReturnPaths,
} from "@/lib/linen-returns";
import { replaceLinenRecordLines } from "@/lib/linen-return-lines";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type RawLine = { itemId?: string; quantity?: unknown };

/** CLAUDE.md §8 — 기능당 5장. 어드민 콘솔(`updateAdminLinenRecord`)과 같은 상한. */
const MAX_PHOTOS = 5;

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
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

function listPath(building: string) {
  return `/mobile/linen-return/list?building=${encodeURIComponent(building)}`;
}

function editPath(id: string, building: string, error?: string) {
  const base = `/mobile/linen-return/record/${id}/edit?building=${encodeURIComponent(building)}`;
  return error ? `${base}&error=${error}` : base;
}

export async function deleteLinenReturnRecord(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/linen-return")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const recordId = cleanText(formData.get("recordId"));
  if (!recordId) {
    redirect("/mobile/linen-return");
  }

  const record = await getLinenReturnRecordById(session, recordId);
  if (!record) {
    redirect("/mobile/linen-return");
  }
  if (!canManageLinenRecord(session, record)) {
    redirect(`/mobile/linen-return/record/${recordId}?building=${encodeURIComponent(record.buildingName)}`);
  }

  const supabase = await getSupabaseServerClient();
  // Line items cascade-delete with the header.
  const { error } = await supabase
    .from("linen_return_records")
    .delete()
    .eq("id", recordId)
    .eq("organization_id", session.organization.id);
  if (error) {
    redirect(`/mobile/linen-return/record/${recordId}?building=${encodeURIComponent(record.buildingName)}&error=delete_failed`);
  }

  revalidateLinenReturnPaths();
  redirect(listPath(record.buildingName));
}

export async function updateLinenReturnRecord(formData: FormData) {
  const session = await getCurrentAppSession();
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent("/mobile/linen-return")}`);
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const recordId = cleanText(formData.get("recordId"));
  if (!recordId) {
    redirect("/mobile/linen-return");
  }

  const record = await getLinenReturnRecordById(session, recordId);
  if (!record) {
    redirect("/mobile/linen-return");
  }
  if (!canManageLinenRecord(session, record)) {
    redirect(`/mobile/linen-return/record/${recordId}?building=${encodeURIComponent(record.buildingName)}`);
  }

  const building = record.buildingName;
  const note = cleanText(formData.get("note"));
  const rawLines = parseLines(cleanText(formData.get("linesJson")));

  const catalog = await getActiveLinenItems(session, building);
  const validItemIds = new Set(catalog.map((item) => item.id));

  const seen = new Set<string>();
  const lines: { itemId: string; quantity: number }[] = [];
  for (const raw of rawLines) {
    const itemId = String(raw.itemId ?? "").trim();
    const quantity = Number(raw.quantity);
    if (!itemId || !validItemIds.has(itemId)) {
      redirect(editPath(recordId, building, "invalid_item"));
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      redirect(editPath(recordId, building, "invalid_quantity"));
    }
    if (seen.has(itemId)) {
      redirect(editPath(recordId, building, "duplicate_item"));
    }
    seen.add(itemId);
    lines.push({ itemId, quantity });
  }

  if (lines.length === 0) {
    redirect(editPath(recordId, building, "missing_items"));
  }

  // 사진은 폼이 보낸 집합으로 통째로 교체한다 — 남긴 기존 URL + 새로 올린 URL.
  // 어드민 콘솔의 사진 수정과 같은 규칙이라, 현장도 자기 기록의 사진을 정정할 수 있다.
  const imageUrls = formData
    .getAll("imageUrls")
    .map((value) => String(value))
    .filter((url) => url.startsWith("https://") || url.startsWith("http://"));
  if (imageUrls.length > MAX_PHOTOS) {
    redirect(editPath(recordId, building, "too_many_photos"));
  }

  const supabase = await getSupabaseServerClient();

  const headerUpdate: Database["public"]["Tables"]["linen_return_records"]["Update"] = {
    note: note || null,
    image_urls: imageUrls,
  };
  const { error: headerError } = await supabase
    .from("linen_return_records")
    .update(headerUpdate)
    .eq("id", recordId)
    .eq("organization_id", session.organization.id);
  if (headerError) {
    redirect(editPath(recordId, building, "save_failed"));
  }

  const replaced = await replaceLinenRecordLines(supabase, recordId, lines);
  if (!replaced.ok) {
    redirect(editPath(recordId, building, "save_failed"));
  }

  revalidateLinenReturnPaths();
  redirect(`/mobile/linen-return/record/${recordId}?building=${encodeURIComponent(building)}`);
}
