"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PreviewItem } from "@/components/announcements/announcement-image-uploader";

const BUCKET = "request-images";
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const FALLBACK_MARKER = `/storage/v1/object/${BUCKET}/`;

export type RequestImageType =
  | "lost-items"
  // 분실물 현장 처리(반환·폐기 등) 증빙 사진. 등록 사진과 같은 버킷이지만 폴더를 분리한다 —
  // supabase/migrations/202607170001_lostfound_return.sql의 storage 정책 화이트리스트와 일치해야 한다.
  | "lost-found-handling"
  | "maintenance-reports"
  // 완료(수리 후) 사진. 신고 사진과 같은 버킷이지만 폴더를 분리한다 —
  // supabase/migrations/202607160001_maintenance_backend.sql의 storage 정책 화이트리스트와 일치해야 한다.
  | "maintenance-resolutions"
  | "order-images"
  | "linen-returns"
  | "task-images"
  | "task-update-images"
  | "suggestion-images"
  | "attendance-corrections"
  | "board-posts"
  | "board-comments";

function getFileExtension(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  return file.type.split("/")[1] ?? "jpg";
}

export async function uploadRequestImages(params: {
  items: PreviewItem[];
  organizationId: string;
  requestId: string;
  requestType: RequestImageType;
}) {
  const { items, organizationId, requestId, requestType } = params;
  const supabase = getSupabaseBrowserClient();
  const uploadedPaths: string[] = [];
  const imageUrls: string[] = [];
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  for (const item of items) {
    const ext = getFileExtension(item.file);
    const path = `${organizationId}/${requestType}/${requestId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, item.file, { contentType: item.file.type, upsert: false });

    if (error) {
      if (uploadedPaths.length > 0) {
        await supabase.storage.from(BUCKET).remove(uploadedPaths);
      }
      throw new Error("upload_failed");
    }

    uploadedPaths.push(path);
    imageUrls.push(publicUrlOf(path, baseUrl));
  }

  return { imageUrls, uploadedPaths };
}

function publicUrlOf(path: string, baseUrl: string): string {
  const supabase = getSupabaseBrowserClient();
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const rawUrl = data.publicUrl;
  if (rawUrl.includes(PUBLIC_MARKER)) return rawUrl;
  if (rawUrl.includes(FALLBACK_MARKER)) return rawUrl.replace(FALLBACK_MARKER, PUBLIC_MARKER);
  if (baseUrl) return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
  return rawUrl;
}

/**
 * 사진 한 장 올리기(2026-10-15, 시안 Motion-C-Upload-Phone) — 사진마다 진행을 보여 주는 `usePhotoUpload` 가 쓴다.
 * 경로 규칙은 `uploadRequestImages` 와 같다(`{조직}/{종류}/{요청 id}/{무작위}.{확장자}` — 서버가 이 모양을 검사한다).
 */
export async function uploadRequestImageOne(params: {
  item: PreviewItem;
  organizationId: string;
  requestId: string;
  requestType: RequestImageType;
}): Promise<{ path: string; url: string }> {
  const { item, organizationId, requestId, requestType } = params;
  const supabase = getSupabaseBrowserClient();
  const path = `${organizationId}/${requestType}/${requestId}/${crypto.randomUUID()}.${getFileExtension(item.file)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, item.file, { contentType: item.file.type, upsert: false });
  if (error) throw new Error("upload_failed");
  return { path, url: publicUrlOf(path, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") };
}

/** 제출을 그만둘 때 이미 올라간 사진을 지운다(저장소에 남는 사진이 없게). */
export async function removeRequestImages(paths: string[]) {
  if (paths.length === 0) return;
  await getSupabaseBrowserClient().storage.from(BUCKET).remove(paths);
}
