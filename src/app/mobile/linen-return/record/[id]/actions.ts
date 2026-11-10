"use server";

import { redirect } from "next/navigation";
import {
  canManageLinenRecord,
  getActiveLinenItems,
  getLinenReturnRecordById,
  revalidateLinenReturnPaths,
} from "@/lib/linen-returns";
import {
  LINEN_MAX_PHOTOS,
  areLinenPhotoUrlsAllowed,
  linenAllowedItemIds,
  linenRpcErrorReason,
  parseLinenLines,
} from "@/lib/linen-return-rules";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function parseLines(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
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
  // 라인 항목은 헤더와 함께 cascade 삭제된다. 지워진 행 수를 본다 — RLS 가 막으면 오류 없이 0행이다.
  const { data: deleted, error } = await supabase
    .from("linen_return_records")
    .delete()
    .eq("id", recordId)
    .eq("organization_id", session.organization.id)
    .select("id");
  if (error || !deleted || deleted.length === 0) {
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

  // 고를 수 있는 품목 = 이 건물의 활성 품목 + 이미 이 기록에 있던 품목(비활성이 됐어도 그대로 저장할 수 있게).
  const catalog = await getActiveLinenItems(session, building);
  const parsed = parseLinenLines(
    parseLines(cleanText(formData.get("linesJson"))),
    linenAllowedItemIds({
      activeIds: catalog.map((item) => item.id),
      building,
      existing: { building, itemIds: record.lines.map((line) => line.itemId) },
    }),
  );
  if (!parsed.ok) {
    redirect(editPath(recordId, building, parsed.reason));
  }

  // 사진은 폼이 보낸 집합으로 통째로 교체한다 — 남긴 기존 URL + 새로 올린 URL.
  // 새 주소는 이 기록 폴더(`{조직}/linen-returns/{기록 id}/`)만, 이미 저장돼 있던 주소는 폴더가 달라도 그대로(PC 콘솔과 같은 함수).
  const imageUrls = [...new Set(formData.getAll("imageUrls").map((value) => String(value)).filter(Boolean))];
  if (imageUrls.length > LINEN_MAX_PHOTOS) {
    redirect(editPath(recordId, building, "too_many_photos"));
  }
  if (
    !areLinenPhotoUrlsAllowed(imageUrls, {
      organizationId: session.organization.id,
      folderId: recordId,
      kept: record.imageUrls,
    })
  ) {
    redirect(editPath(recordId, building, "invalid_photo"));
  }

  // 머리 · 품목 줄을 한 트랜잭션으로(반쪽 저장 없음). 폼이 hidden `updatedAt`(연 때의 값)을 보내면
  // 그사이 다른 사람이 고친 경우 'stale' 로 돌려보낸다 — 보내지 않으면 이 검사만 건너뛴다.
  const expectedUpdatedAt = cleanText(formData.get("updatedAt")) || null;
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("linen_update_return", {
    p_record_id: recordId,
    p_expected_updated_at: expectedUpdatedAt,
    p_building: null,
    p_note: note,
    p_image_urls: imageUrls,
    p_lines: parsed.lines,
  });
  if (error) {
    const reason = linenRpcErrorReason(error.message);
    redirect(editPath(recordId, building, reason ?? "save_failed"));
  }

  revalidateLinenReturnPaths();
  redirect(`/mobile/linen-return/record/${recordId}?building=${encodeURIComponent(building)}`);
}
