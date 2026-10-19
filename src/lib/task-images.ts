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

/**
 * Hard-delete task-level photos the author detached during an edit.
 *
 * Two defensive boundaries, both load-bearing: candidates must come from **server-truth previous
 * URLs** (never raw client input), and each must resolve to a path under
 * `${organizationId}/task-images/` before it is eligible for removal.
 */
export async function cleanupRemovedTaskImages(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  removedUrls: string[],
  organizationId: string,
) {
  if (removedUrls.length === 0) return;
  const expectedPrefix = `${organizationId}/task-images/`;
  const paths = removedUrls
    .map((u) => extractRequestImagePath(u))
    .filter((p): p is string => !!p && p.startsWith(expectedPrefix));
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

/** Keep only http(s) URLs, capped at the per-task limit. For creates — edits use `mergeTaskImageUrls`. */
export function sanitizeTaskImageUrls(urls: string[], isProjectTask: boolean): string[] {
  return urls
    .map((v) => String(v))
    .filter(isHttpUrl)
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
    if (out.length >= limit) break;
    out.push(u);
  }
  return out;
}
