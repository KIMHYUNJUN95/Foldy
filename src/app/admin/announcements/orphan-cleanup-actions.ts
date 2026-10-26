"use server";

import { getPublicSupabaseEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

type AnnouncementImageRow = Pick<
  Database["public"]["Tables"]["announcements"]["Row"],
  "image_urls"
>;

const BUCKET = "announcement-images";
// 업로드된 지 GRACE_MS 가 지나지 않은 객체는 건너뛴다 — 사용자가 이미지를 올린 뒤
// 아직 작성 폼을 채우는 중일 수 있다.
const GRACE_MS = 60 * 60 * 1000; // 60분
const DELETE_BATCH = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9]$/;

export type OrphanCleanupResult = {
  ok: boolean;
  aborted: boolean;
  errorMessage?: string;
  listingFailures: number;
  deleted: number;
  skippedGrace: number;
  skippedReferenced: number;
  errors: number;
};

class ListingFailureError extends Error {
  failures: number;

  constructor(message: string) {
    super(message);
    this.name = "ListingFailureError";
    this.failures = 1;
  }
}

// actions.ts 의 검증 로직과 동일하게 맞춰, 구조가 올바른
// 버킷 경로만 삭제 후보가 되도록 한다.
function isValidStoragePath(name: string): boolean {
  const segs = name.split("/");
  if (segs.length !== 3) return false;
  const [orgId, announcementId, filename] = segs as [string, string, string];
  return (
    UUID_RE.test(orgId) &&
    UUID_RE.test(announcementId) &&
    filename.length >= 3 &&
    filename.length <= 160 &&
    SAFE_FILENAME_RE.test(filename)
  );
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data } = await getSupabaseServiceClient()
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

// 현재 공지 한 건 이상의 image_urls 컬럼에서 참조 중인
// Storage 객체 경로 집합을 만든다.
async function getReferencedPaths(): Promise<Set<string>> {
  const { url } = getPublicSupabaseEnv();
  const supabaseHostname = new URL(url).hostname;
  const prefix = `/storage/v1/object/public/${BUCKET}/`;
  const service = getSupabaseServiceClient();
  const paths = new Set<string>();

  let offset = 0;
  const PAGE = 500;
  while (true) {
    const { data, error: queryError } = await service
      .from("announcements")
      .select("image_urls")
      .range(offset, offset + PAGE - 1);

    if (queryError) {
      throw new Error(
        `getReferencedPaths: query failed at offset ${offset}: ${queryError.message}`,
      );
    }

    const rows = (data ?? []) as AnnouncementImageRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      for (const rawUrl of row.image_urls ?? []) {
        try {
          const u = new URL(rawUrl);
          if (
            u.protocol === "https:" &&
            u.hostname === supabaseHostname &&
            u.pathname.startsWith(prefix)
          ) {
            const path = decodeURIComponent(u.pathname.slice(prefix.length));
            if (path) paths.add(path);
          }
        } catch {
          // 형식이 잘못된 항목은 건너뜀
        }
      }
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  return paths;
}

// 3단계 계층(조직 → 공지 → 파일명)을 순회한다.
// 각 단계는 500개로 제한한다. MVP 사용량에는 충분하며,
// 버킷이 그보다 커지면 단계마다 페이지네이션을 추가한다.
async function listBucketObjects(): Promise<
  Array<{ path: string; createdAt: Date | null }>
> {
  const service = getSupabaseServiceClient();
  const results: Array<{ path: string; createdAt: Date | null }> = [];

  const { data: orgEntries, error: orgListErr } = await service.storage
    .from(BUCKET)
    .list("", { limit: 500, sortBy: { column: "name", order: "asc" } });

  if (orgListErr) {
    throw new ListingFailureError(
      `Failed to list org folders in ${BUCKET}: ${orgListErr.message}`,
    );
  }

  for (const orgEntry of orgEntries ?? []) {
    if (!UUID_RE.test(orgEntry.name)) continue;

    const { data: annEntries, error: annListErr } = await service.storage
      .from(BUCKET)
      .list(orgEntry.name, {
        limit: 500,
        sortBy: { column: "name", order: "asc" },
      });

    if (annListErr) {
      throw new ListingFailureError(
        `Failed to list announcement folders under ${orgEntry.name}: ${annListErr.message}`,
      );
    }

    for (const annEntry of annEntries ?? []) {
      if (!UUID_RE.test(annEntry.name)) continue;

      const { data: fileEntries, error: fileListErr } = await service.storage
        .from(BUCKET)
        .list(`${orgEntry.name}/${annEntry.name}`, {
          limit: 500,
          sortBy: { column: "name", order: "asc" },
        });

      if (fileListErr) {
        throw new ListingFailureError(
          `Failed to list files under ${orgEntry.name}/${annEntry.name}: ${fileListErr.message}`,
        );
      }

      for (const f of fileEntries ?? []) {
        if (f.id == null) continue; // 가상 폴더 자리표시자이며 실제 객체가 아님
        results.push({
          path: `${orgEntry.name}/${annEntry.name}/${f.name}`,
          createdAt: f.created_at ? new Date(f.created_at) : null,
        });
      }
    }
  }

  return results;
}

// 플랫폼 관리자 전용 서버 액션. announcement-images 버킷에서
// DB 공지 어디에서도 참조하지 않는 Storage 객체를 삭제한다.
//
// 안전 조건(객체를 지우려면 모두 충족해야 함):
//   1. 호출자가 활성 플랫폼 관리자일 것.
//   2. 경로가 UUID/파일명 3단계 전체 검증을 통과할 것.
//   3. 객체 생성 시각을 알고 있고 GRACE_MS 보다 오래됐을 것.
//   4. 객체의 공개 URL 을 재구성한 값이 어느 공지의 image_urls 에도 없을 것.
export async function purgeOrphanAnnouncementImages(): Promise<OrphanCleanupResult> {
  const result: OrphanCleanupResult = {
    ok: true,
    aborted: false,
    listingFailures: 0,
    deleted: 0,
    skippedGrace: 0,
    skippedReferenced: 0,
    errors: 0,
  };

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isPlatformAdmin(user.id))) {
    return {
      ...result,
      ok: false,
      aborted: true,
      errorMessage: "Cleanup is restricted to active platform admins.",
    };
  }

  const graceCutoff = new Date(Date.now() - GRACE_MS);

  let referenced: Set<string>;
  let objects: Array<{ path: string; createdAt: Date | null }>;
  try {
    [referenced, objects] = await Promise.all([
      getReferencedPaths(),
      listBucketObjects(),
    ]);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to build reference set or bucket listing.";
    console.error(
      "[purgeOrphanAnnouncementImages] Aborted — failed to build reference set or bucket listing:",
      message,
    );
    return {
      ...result,
      ok: false,
      aborted: true,
      errorMessage: message,
      listingFailures: err instanceof ListingFailureError ? err.failures : 0,
    };
  }

  const toDelete: string[] = [];

  for (const obj of objects) {
    if (!isValidStoragePath(obj.path)) continue;

    // 보수적 처리: 생성 시각을 모르는 객체는 건너뛴다.
    if (obj.createdAt === null || obj.createdAt > graceCutoff) {
      result.skippedGrace++;
      continue;
    }

    if (referenced.has(obj.path)) {
      result.skippedReferenced++;
      continue;
    }

    toDelete.push(obj.path);
  }

  const service = getSupabaseServiceClient();
  for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
    const batch = toDelete.slice(i, i + DELETE_BATCH);
    const { error } = await service.storage.from(BUCKET).remove(batch);
    if (error) {
      result.errors += batch.length;
      console.error(
        "[purgeOrphanAnnouncementImages] Storage delete error:",
        error.message,
      );
    } else {
      result.deleted += batch.length;
    }
  }

  if (result.errors > 0) {
    result.ok = false;
    result.errorMessage = `Cleanup completed with ${result.errors} Storage deletion error(s).`;
  }

  return result;
}
