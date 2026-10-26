import type { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Task photo storage helpers, shared by the mobile task actions and the admin console actions.
 *
 * These were private to `src/app/mobile/tasks/[id]/actions.ts` until the admin console gained photo
 * editing (2026-07-29). They are security-sensitive — `cleanupRemovedTaskImages` deletes storage
 * objects — so they live in one place rather than being reimplemented per caller.
 * See docs/engineering/09-todo-task-technical-design.md → Images.
 */
export const REQUEST_IMAGE_BUCKET = "request-images";

/** Max task-level photos: project tasks get 20, everything else 5 (CLAUDE.md §8). */
export function taskImageLimit(isProjectTask: boolean): number {
  return isProjectTask ? 20 : 5;
}

/**
 * Extract the Storage object path from a request-images public URL.
 * Returns null for URLs that are not public objects in the expected bucket/host — this is what
 * keeps arbitrary client-supplied URLs from ever reaching a storage delete.
 */
export function extractRequestImagePath(publicUrl: string): string | null {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!baseUrl) return null;
    const url = new URL(publicUrl);
    const supabaseUrl = new URL(baseUrl);
    const prefix = `/storage/v1/object/public/${REQUEST_IMAGE_BUCKET}/`;
    if (
      url.protocol !== "https:" ||
      url.hostname !== supabaseUrl.hostname ||
      !url.pathname.startsWith(prefix)
    ) {
      return null;
    }
    const encoded = url.pathname.slice(prefix.length);
    if (!encoded) return null;
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/** Storage folders a task photo may live in — task-level photos vs update-log (memo) photos. */
export type TaskImageFolder = "task-images" | "task-update-images";

/**
 * Is this URL one of **our** request-images public objects under `${organizationId}/${folder}/`?
 *
 * Upload paths are `{org}/{folder}/{requestId}/{uuid}.{ext}` (`uploadRequestImages`). The requestId
 * is a fresh client uuid for creates *and* edits (the task id does not exist yet on create), so the
 * narrowest stable rule is the org + folder prefix — not the task's own folder.
 */
export function isOrgTaskImageUrl(
  url: string,
  organizationId: string,
  folder: TaskImageFolder = "task-images",
): boolean {
  const path = extractRequestImagePath(url);
  if (!path || !organizationId) return false;
  // `..` 를 섞어 접두사만 맞추는 경로는 거절한다(스토리지가 정규화하지 않더라도 방어적으로).
  if (path.split("/").some((seg) => seg === ".." || seg === "")) return false;
  return path.startsWith(`${organizationId}/${folder}/`);
}

/**
 * Hard-delete task-level photos the author detached during an edit.
 *
 * Three defensive boundaries, all load-bearing: candidates must come from **server-truth previous
 * URLs** (never raw client input), each must resolve to a path under
 * `${organizationId}/task-images/`, and **no other task in the org may still reference it**
 * (2026-10-26). The last one closes «attach someone else's photo URL, save, then remove it» — new
 * URLs are only org-prefix checked (see `isOrgTaskImageUrl`), so without it a user could delete a
 * colleague's file through their own task. Soft-deleted tasks count as references (undo restores them).
 */
export async function cleanupRemovedTaskImages(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  removedUrls: string[],
  organizationId: string,
) {
  if (removedUrls.length === 0) return;
  const candidates = removedUrls.filter((u) => isOrgTaskImageUrl(u, organizationId));
  if (candidates.length === 0) return;
  // Runs after the edit's UPDATE, so the edited task no longer references these — any hit is another task.
  const { data: refs, error: refError } = await supabase
    .from("tasks")
    .select("image_urls")
    .eq("organization_id", organizationId)
    .overlaps("image_urls", candidates);
  if (refError) {
    // Fail closed: a stray file is harmless, deleting a file another task shows is not.
    console.error("[cleanupRemovedTaskImages] reference check failed:", refError.message);
    return;
  }
  const stillReferenced = new Set(
    ((refs ?? []) as Array<{ image_urls: string[] | null }>).flatMap((r) => r.image_urls ?? []),
  );
  const paths = candidates
    .filter((u) => !stillReferenced.has(u))
    .map((u) => extractRequestImagePath(u))
    .filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(REQUEST_IMAGE_BUCKET).remove(paths);
  if (error) {
    // Non-fatal: the DB reference is already detached; a stray file is the worst case.
    console.error("[cleanupRemovedTaskImages] storage remove failed:", error.message);
  }
}

function isHttpUrl(u: string): boolean {
  return u.startsWith("https://") || u.startsWith("http://");
}

/**
 * Keep only http(s) URLs, capped at the per-task limit. For creates — edits use `mergeTaskImageUrls`.
 * With `organizationId` (mobile, 2026-10-26) a URL must also be our storage object under
 * `${organizationId}/task-images/` — an arbitrary external or another org's URL is dropped.
 */
export function sanitizeTaskImageUrls(
  urls: string[],
  isProjectTask: boolean,
  organizationId?: string,
): string[] {
  return Array.from(new Set(urls.map((v) => String(v))))
    .filter(isHttpUrl)
    .filter((u) => !organizationId || isOrgTaskImageUrl(u, organizationId))
    .slice(0, taskImageLimit(isProjectTask));
}

/**
 * The image set an edit stores. Photos the task **already has** are never cut by the cap — a project
 * task with 15 photos moved out of its project (cap 20 → 5) keeps all 15. Only newly added URLs are
 * capped, and only while the total is under the limit. Without this the cap sliced the list and the
 * edit hard-deleted the "removed" overflow from storage.
 */
export function mergeTaskImageUrls(
  previous: string[],
  requested: string[],
  isProjectTask: boolean,
  /** When given, *newly added* URLs must be our `${organizationId}/task-images/` objects (2026-10-26). */
  organizationId?: string,
): string[] {
  const limit = taskImageLimit(isProjectTask);
  const had = new Set(previous);
  const out: string[] = [];
  for (const raw of requested) {
    const u = String(raw);
    if (!isHttpUrl(u) || out.includes(u)) continue;
    if (had.has(u)) out.push(u);
  }
  for (const raw of requested) {
    const u = String(raw);
    if (!isHttpUrl(u) || had.has(u) || out.includes(u)) continue;
    if (organizationId && !isOrgTaskImageUrl(u, organizationId)) continue;
    if (out.length >= limit) break;
    out.push(u);
  }
  return out;
}
