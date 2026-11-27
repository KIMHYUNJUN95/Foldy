import "server-only";
import { storagePathFromPublicUrl } from "@/lib/storage-url-guard";

// request-images 파일을 그 사용자가 올렸는가(storage.objects.owner_id) — 근태 정정 · 연차 사진의 본인 확인(2026-11-27).
// 함수: supabase/migrations/202611270002_request_image_owners.sql (service role 전용).

type RpcClient = {
  rpc: (
    fn: "request_image_owners",
    args: { p_names: string[] },
  ) => PromiseLike<{ data: Array<{ name: string; owner_id: string | null }> | null; error: unknown }>;
};

/** 모든 경로가 있고 모두 `userId` 가 올렸으면 true, 아니면 false, 읽기 실패면 "error". */
export async function requestImagesOwnedBy(
  client: RpcClient,
  paths: readonly string[],
  userId: string,
): Promise<boolean | "error"> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return true;
  const { data, error } = await client.rpc("request_image_owners", { p_names: unique });
  if (error || !data) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error("[request-image-owners] rpc failed", { code: typeof code === "string" ? code : null });
    return "error";
  }
  const ownerByName = new Map(data.map((row) => [row.name, row.owner_id]));
  return unique.every((path) => ownerByName.get(path) === userId);
}

/**
 * 저장할 사진 주소 중 **이 기록에 없던 것**이 모두 `userId` 가 올린 파일인가(2026-11-27). 할 일 · 메모 · 제안 사진은
 * 그 행을 읽을 수 있는 사람에게 열리므로(라우트), 남의 사진 주소를 내 기록에 넣어 여는 것을 저장 때 막는다.
 * 이미 있던 주소(수정 때 그대로 두는 사진)는 묻지 않는다.
 */
export async function newRequestImagesOwnedBy(
  client: RpcClient,
  urls: readonly string[],
  previous: readonly string[],
  userId: string,
): Promise<boolean | "error"> {
  const had = new Set(previous);
  const paths: string[] = [];
  for (const url of urls) {
    if (had.has(url)) continue;
    const path = storagePathFromPublicUrl(url, "request-images");
    if (!path) return false;
    paths.push(path);
  }
  return requestImagesOwnedBy(client, paths, userId);
}
