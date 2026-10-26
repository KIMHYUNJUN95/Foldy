import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { FileAttachment } from "@/components/board/board-types";

const IMAGES_BUCKET = "request-images";
const FILES_BUCKET = "board-attachments";

const ALLOWED_FILE_MIME = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

function fileExt(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  return file.type.split("/")[1] ?? "bin";
}

/**
 * 게시글 사진·첨부 상한.
 *
 * 작성 폼 · 수정 폼 · 클라이언트 검증 · 서버 액션이 **같은 값**을 봐야 한다. 2026-08-07 글 수정
 * 화면을 붙이면서 `5` 리터럴이 이미 네 군데에 흩어져 있는 것을 발견해 여기로 모았다.
 */
export const BOARD_MAX_IMAGES = 5;
export const BOARD_MAX_FILES = 5;

export function validateBoardImageList(files: File[]): string | null {
  if (files.length > BOARD_MAX_IMAGES) return "too_many_photos";
  for (const f of files) {
    if (!f.type.startsWith("image/")) return "invalid_image_type";
    if (f.size > 10 * 1024 * 1024) return "image_too_large";
  }
  return null;
}

export function validateBoardFileList(files: File[]): string | null {
  if (files.length > BOARD_MAX_FILES) return "too_many_files";
  for (const f of files) {
    if (!ALLOWED_FILE_MIME.has(f.type)) return "invalid_file_type";
    if (f.size > 20 * 1024 * 1024) return "file_too_large";
  }
  return null;
}

export async function uploadBoardImage(params: {
  file: File;
  organizationId: string;
  postId: string;
  // `board-posts` 는 게시글 작성용, `board-comments` 는 댓글 사진용(둘 다 request-images 스토리지 정책에
  // 화이트리스트됨). 기본값은 board-posts.
  folder?: "board-posts" | "board-comments";
}): Promise<string> {
  const { file, organizationId, postId, folder = "board-posts" } = params;
  const supabase = getSupabaseBrowserClient();
  const ext = fileExt(file);
  const path = `${organizationId}/${folder}/${postId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) throw new Error("upload_failed");

  const { data } = supabase.storage.from(IMAGES_BUCKET).getPublicUrl(path);
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const PUBLIC_MARKER = `/storage/v1/object/public/${IMAGES_BUCKET}/`;
  const raw = data.publicUrl;

  if (raw.includes(PUBLIC_MARKER)) return raw;
  if (baseUrl) return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${IMAGES_BUCKET}/${path}`;
  return raw;
}

export async function uploadBoardAttachment(params: {
  file: File;
  organizationId: string;
  postId: string;
}): Promise<FileAttachment> {
  const { file, organizationId, postId } = params;
  const supabase = getSupabaseBrowserClient();
  const ext = fileExt(file);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const path = `${organizationId}/${postId}/${filename}`;

  const { error } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) throw new Error("upload_failed");

  return {
    name: file.name,
    url: path,
    sizeBytes: file.size,
    mimeType: file.type,
  };
}
