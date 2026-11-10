"use server";

import { redirect } from "next/navigation";
import {
  getActiveLinenItems,
  isKnownBuilding,
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

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseLines(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function newPath(building: string, error?: string) {
  const base = `/mobile/linen-return/new?building=${encodeURIComponent(building)}`;
  return error ? `${base}&error=${error}` : base;
}

/**
 * 반품 등록. 같은 사람 · 같은 건물 · 같은 도쿄 날짜면 그날 기록에 합친다(문서 19 §2).
 * 검사(건물 · 품목 · 수량 · 사진 주소)는 여기서, 저장은 DB 함수 `linen_submit_return` 한 번 — 한 트랜잭션이라
 * 동시에 들어온 첫 제출이 기록 두 개를 만들거나 수량이 덮어써지는 일이 없고, 같은 제출 id(form `id`)를 다시 보내면 한 번만 반영된다.
 */
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

  // 항목 id 를 건물의 활성 카탈로그와 대조해 검증한다(실패 시 닫힘).
  const catalog = await getActiveLinenItems(session, building);
  const parsed = parseLinenLines(
    parseLines(cleanText(formData.get("linesJson"))),
    linenAllowedItemIds({ activeIds: catalog.map((item) => item.id), building }),
  );
  if (!parsed.ok) {
    redirect(newPath(building, parsed.reason));
  }

  const imageUrls = [...new Set(formData.getAll("imageUrls").map((v) => String(v)).filter(Boolean))];
  if (imageUrls.length > LINEN_MAX_PHOTOS) {
    redirect(newPath(building, "too_many_photos"));
  }

  // 제출 id = 클라이언트가 만든 id(사진 폴더 · 새 기록 id 와 같다). 형식이 틀리면 새로 만든다(그때는 멱등이 없다).
  const requestedId = cleanText(formData.get("id"));
  const submissionId = requestedId && isValidUuid(requestedId) ? requestedId : crypto.randomUUID();

  // 사진은 우리 저장소의 같은 조직 `linen-returns/{제출 폴더}/` 파일만. 폼이 실패 · 수정 뒤 새 제출 id 를 만들어도
  // 임시 저장에서 되살린 예전 id 폴더 사진을 그대로 보내므로, 폴더는 같은 조직 linen-returns 아래 어느 uuid 든 받는다.
  if (!areLinenPhotoUrlsAllowed(imageUrls, { organizationId: session.organization.id, folderId: "any" })) {
    redirect(newPath(building, "invalid_photo"));
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("linen_submit_return", {
    p_organization_id: session.organization.id,
    p_submission_id: submissionId,
    p_building: building,
    p_note: note,
    p_image_urls: imageUrls,
    p_lines: parsed.lines,
  });
  if (error) {
    const reason = linenRpcErrorReason(error.message);
    redirect(newPath(building, reason ?? "save_failed"));
  }

  const result = (data ?? {}) as { record_id?: string; merged?: boolean };
  const recordId = result.record_id ?? submissionId;

  // 건물 목록으로 돌아가 거기서 완료 연출을 보여준다(created=<id> 가 영향받은 행을 강조).
  // merged=1 — 완료 화면이 「오늘 등록한 기록에 합쳐졌어요」를 보여 준다(2026-10-14 화이트 리디자인).
  revalidateLinenReturnPaths();
  redirect(
    `/mobile/linen-return/list?building=${encodeURIComponent(building)}&created=${recordId}${result.merged ? "&merged=1" : ""}`,
  );
}
