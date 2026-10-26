/**
 * 게시판 사진 · 첨부 경로 검사(서버 전용, 2026-10-26 버그 수정).
 *
 * 작성 · 수정 · 댓글 액션은 클라이언트가 올린 뒤 보낸 URL/경로를 그대로 저장했다. 그래서 다른 조직 폴더의 파일 경로를
 * 첨부로 끼워 넣으면 `getBoardAttachmentDownloadUrl` 이 서비스 키로 서명해 내려 줄 수 있었고, 사진 칸에는 아무 외부 URL 이나
 * 들어갈 수 있었다. 업로드 함수(`src/lib/board.ts`)가 만드는 모양과 **정확히 같은 것만** 받는다:
 *
 * - 첨부(비공개 `board-attachments`): `{orgId}/{postId}/{uuid}.{ext}`
 * - 사진(공개 `request-images`): `{SUPABASE_URL}/storage/v1/object/public/request-images/{orgId}/{board-posts|board-comments}/{postId}/{uuid}.{ext}`
 *
 * 공용 `storage-url-guard` 가 생기면 옮길 수 있다 — 지금은 게시판 액션만 쓴다.
 */

const IMAGES_BUCKET = "request-images";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// 확장자는 파일 이름에서, 없으면 MIME 뒤쪽(`vnd.ms-excel` 같은 점 · 하이픈 포함)에서 온다(`fileExt`). 「..」 는 따로 막는다.
const FILE_NAME_RE = new RegExp(`^${UUID}\\.[a-z0-9][a-z0-9.+-]{0,99}$`, "i");
const UUID_RE = new RegExp(`^${UUID}$`, "i");

export function isBoardUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function hasTraversal(value: string): boolean {
  return value.includes("..") || value.includes("\\") || value.includes("%") || value.includes("//");
}

/** 첨부 저장 경로가 이 조직 · 이 글 폴더 안의 파일 하나인지. */
export function isOwnBoardAttachmentPath(path: unknown, orgId: string, postId: string): path is string {
  if (typeof path !== "string" || hasTraversal(path)) return false;
  const prefix = `${orgId}/${postId}/`;
  if (!path.startsWith(prefix)) return false;
  return FILE_NAME_RE.test(path.slice(prefix.length));
}

function publicImagePrefix(orgId: string, folder: "board-posts" | "board-comments", postId: string): string | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/${IMAGES_BUCKET}/${orgId}/${folder}/${postId}/`;
}

/** 사진 URL 이 우리 스토리지 공개 URL 이고 이 조직 · 이 글 폴더 안의 파일 하나인지. */
export function isOwnBoardImageUrl(
  url: unknown,
  orgId: string,
  postId: string,
  folder: "board-posts" | "board-comments",
): url is string {
  if (typeof url !== "string") return false;
  const prefix = publicImagePrefix(orgId, folder, postId);
  if (!prefix || !url.startsWith(prefix)) return false;
  const rest = url.slice(prefix.length);
  if (hasTraversal(rest)) return false;
  return FILE_NAME_RE.test(rest);
}

export type BoardFileAttachmentInput = { name: string; url: string; sizeBytes: number; mimeType: string };

/**
 * 첨부 목록을 검사하고 알려진 필드만 남겨 다시 만든다. 하나라도 어긋나면 `null`.
 * `keepExisting` — 수정 때 이미 그 글에 있던 경로(예전 업로드 모양일 수 있다)는 그대로 둔다.
 */
export function sanitizeBoardAttachments(
  list: unknown,
  orgId: string,
  postId: string,
  keepExisting: ReadonlySet<string> = new Set(),
): BoardFileAttachmentInput[] | null {
  if (!Array.isArray(list)) return null;
  const out: BoardFileAttachmentInput[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const url = item.url;
    if (typeof url !== "string") return null;
    if (!keepExisting.has(url) && !isOwnBoardAttachmentPath(url, orgId, postId)) return null;
    const name = typeof item.name === "string" ? item.name.slice(0, 255) : "";
    const sizeBytes = typeof item.sizeBytes === "number" && Number.isFinite(item.sizeBytes) ? item.sizeBytes : 0;
    const mimeType = typeof item.mimeType === "string" ? item.mimeType.slice(0, 200) : "";
    out.push({ mimeType, name, sizeBytes, url });
  }
  return out;
}

/** 사진 URL 목록이 모두 이 조직 · 이 글 폴더의 우리 공개 URL 인지(`keepExisting` 은 그대로 허용). */
export function areOwnBoardImageUrls(
  list: unknown,
  orgId: string,
  postId: string,
  folder: "board-posts" | "board-comments",
  keepExisting: ReadonlySet<string> = new Set(),
): list is string[] {
  if (!Array.isArray(list)) return false;
  return list.every(
    (url) => typeof url === "string" && (keepExisting.has(url) || isOwnBoardImageUrl(url, orgId, postId, folder)),
  );
}
