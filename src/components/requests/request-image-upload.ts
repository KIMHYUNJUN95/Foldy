"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PreviewItem } from "@/components/announcements/announcement-image-uploader";
import type { RequestImageFolder } from "@/lib/request-image-folders";

const BUCKET = "request-images";
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const FALLBACK_MARKER = `/storage/v1/object/${BUCKET}/`;

/**
 * 폴더(경로 2번째 칸). 목록 기준은 `src/lib/request-image-folders.ts` — DB 정책은 `public.request_image_folder_allows` 가 같은 목록을 든다.
 * 새 폴더는 거기에 더하고 새 마이그레이션에서 그 함수를 바꾼다(정책을 다시 만들지 않는다).
 */
export type RequestImageType = RequestImageFolder;

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
