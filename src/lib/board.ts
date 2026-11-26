import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { FileAttachment } from "@/components/board/board-types";
import { boardImageStoragePath } from "@/lib/board-upload-paths";
import type { RequestImageFolder } from "@/lib/request-image-folders";

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
export const BOARD_MAX_TAGS = 10;
export const BOARD_TAG_MAX_LENGTH = 30;

/** 태그 서버 정리 — 앞 # · 공백을 걷고, 빈 값 · 중복을 버리고, 길이 30 · 개수 10 으로 자른다(폼 상한은 개수 10 만 있었다). */
export function normalizeBoardTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/^#+/, "").trim().slice(0, BOARD_TAG_MAX_LENGTH);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= BOARD_MAX_TAGS) break;
  }
  return out;
}

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
  // `board-posts` 는 게시글 작성용, `board-comments` 는 댓글 사진용. 둘 다 `src/lib/request-image-folders.ts` 목록
  // (= DB 함수 `request_image_folder_allows`)에 있어야 한다 — 2026-07-16 ~ 11-20 정책에서 빠져 업로드가 막혀 있었다. 기본값은 board-posts.
  folder?: Extract<RequestImageFolder, "board-posts" | "board-comments">;
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

/**
 * 글 저장이 서버에서 `{error}` 로 실패했을 때 방금 올린 사진 · 파일 지우기를 **시도한다**(게시판 unslop 2026-11-20).
 * 저장소 정책이 허락할 때만 지워지고, 아니면 그대로 남는다(고아 파일). `board-attachments` 는 올린 사람 지우기를 허락한다(202606250001).
 * `request-images` 사진은 SELECT 정책이 없어 브라우저 `remove()` 가 지울 행을 못 보고 0행을 지웠다 — 2026-11-24 `202611240001`
 * (운영 미적용)이 「내가 1시간 안에 올린 사진만 보이는」 SELECT 정책을 더해 적용 뒤에는 방금 올린 내 사진이 지워진다
 * (docs/engineering/05-rls-permissions.md 「2026-11-24」 절). 실패해도 화면 오류를 덮지 않게 조용히 넘긴다.
 */
export async function removeBoardUploads(params: { imageUrls: string[]; attachmentPaths: string[] }): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const imagePaths = params.imageUrls
    .map((u) => boardImageStoragePath(u))
    .filter((p): p is string => Boolean(p));
  await Promise.all([
    imagePaths.length ? supabase.storage.from(IMAGES_BUCKET).remove(imagePaths) : null,
    params.attachmentPaths.length ? supabase.storage.from(FILES_BUCKET).remove(params.attachmentPaths) : null,
  ]).catch(() => undefined);
}
