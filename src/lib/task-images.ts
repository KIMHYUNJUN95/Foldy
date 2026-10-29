import type { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 할 일 사진 스토리지 헬퍼. 모바일 할 일 액션과 관리자 콘솔 액션이 함께 쓴다.
 *
 * 관리자 콘솔에 사진 편집이 생기기 전(2026-07-29)에는 `src/app/mobile/tasks/[id]/actions.ts` 안에서만 쓰였다.
 * 보안에 민감하다 — `cleanupRemovedTaskImages` 는 스토리지 객체를 지운다 —
 * 그래서 호출자마다 따로 만들지 않고 한곳에 둔다.
 * docs/engineering/09-todo-task-technical-design.md → Images 참고.
 */
export const REQUEST_IMAGE_BUCKET = "request-images";

/** 할 일 단위 사진 최대 장수: 프로젝트 할 일은 20장, 나머지는 5장(CLAUDE.md §8). */
export function taskImageLimit(isProjectTask: boolean): number {
  return isProjectTask ? 20 : 5;
}

/**
 * request-images 공개 URL 에서 스토리지 객체 경로를 뽑는다.
 * 예상한 버킷/호스트의 공개 객체가 아닌 URL 은 null 을 돌려준다 — 클라이언트가 보낸 임의의 URL 이
 * 스토리지 삭제까지 가지 못하게 막는 것이 바로 이 부분이다.
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

/** 할 일 사진이 있을 수 있는 스토리지 폴더 — 할 일 단위 사진 vs 갱신 로그(메모) 사진. */
export type TaskImageFolder = "task-images" | "task-update-images";

/**
 * 이 URL 이 `${organizationId}/${folder}/` 아래의 **우리** request-images 공개 객체인가?
 *
 * 업로드 경로는 `{org}/{folder}/{requestId}/{uuid}.{ext}` 이다(`uploadRequestImages`). requestId 는
 * 생성 *과* 수정 모두 새 클라이언트 uuid 다(생성 시에는 할 일 id 가 아직 없다). 그래서
 * 가장 좁으면서 안정적인 규칙은 할 일 자신의 폴더가 아니라 조직 + 폴더 접두어다.
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
 * 수정 중 작성자가 뗀 할 일 단위 사진을 완전 삭제한다.
 *
 * 세 가지 방어 경계가 모두 필수다: 후보는 **서버가 가진 이전 URL** 에서만 와야 하고
 * (클라이언트 입력 그대로는 안 됨), 각각 `${organizationId}/task-images/` 아래 경로로 해석돼야 하며,
 * **조직 내 다른 할 일이 아직 참조하고 있지 않아야** 한다(2026-10-26). 마지막 것이
 * «남의 사진 URL 을 붙여 저장하고 지우는» 공격을 막는다 — 새 URL 은 조직 접두어만 검사하므로(`isOrgTaskImageUrl` 참고),
 * 이게 없으면 사용자가 자기 할 일을 통해 동료의 파일을 지울 수 있다.
 * 소프트 삭제된 할 일도 참조로 센다(되돌리면 복구되므로).
 */
export async function cleanupRemovedTaskImages(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  removedUrls: string[],
  organizationId: string,
) {
  if (removedUrls.length === 0) return;
  const candidates = removedUrls.filter((u) => isOrgTaskImageUrl(u, organizationId));
  if (candidates.length === 0) return;
  // 수정의 UPDATE 이후에 실행되므로 수정된 할 일은 더는 이것을 참조하지 않는다 — 걸리는 것은 모두 다른 할 일이다.
  const { data: refs, error: refError } = await supabase
    .from("tasks")
    .select("image_urls")
    .eq("organization_id", organizationId)
    .overlaps("image_urls", candidates);
  if (refError) {
    // 닫힌 쪽으로 실패: 남은 파일은 해롭지 않지만, 다른 할 일이 보여주는 파일을 지우는 건 해롭다.
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
    // 치명적이지 않음: DB 참조는 이미 떼어졌고, 남은 파일이 있어도 최악일 뿐이다.
    console.error("[cleanupRemovedTaskImages] storage remove failed:", error.message);
  }
}

/**
 * 메모(갱신 로그) 사진 정리 — `cleanupRemovedTaskImages` 의 `task-update-images` 판(2026-10-29).
 * 우리 `${organizationId}/task-update-images/` 객체만, 아직 남은 메모(`task_updates.image_urls`)가 가리키는 파일은 남긴다.
 * 참조 확인이 실패하면 아무것도 지우지 않는다(남는 파일보다 보이는 사진을 지우는 쪽이 해롭다).
 */
export async function cleanupRemovedTaskUpdateImages(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  removedUrls: string[],
  organizationId: string,
) {
  const candidates = [...new Set(removedUrls)].filter((u) =>
    isOrgTaskImageUrl(u, organizationId, "task-update-images"),
  );
  if (candidates.length === 0) return;
  const { data: refs, error: refError } = await supabase
    .from("task_updates")
    .select("image_urls")
    .overlaps("image_urls", candidates);
  if (refError) {
    console.error("[cleanupRemovedTaskUpdateImages] reference check failed:", refError.message);
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
  if (error) console.error("[cleanupRemovedTaskUpdateImages] storage remove failed:", error.message);
}

/**
 * 프로젝트를 지우기 직전에 — 그 프로젝트 할 일(소프트 삭제된 것 포함)의 할 일 사진과 메모 사진 URL.
 * cascade 가 tasks · task_updates 행만 지우고 스토리지 파일은 남기므로, 지운 뒤 위 두 정리 헬퍼로 넘긴다.
 * 모바일 `deleteProject` · 콘솔 `deleteConsoleProject` 가 같이 쓴다. 읽기가 실패하면 그 몫은 빈 목록(파일이 남는 쪽이 안전).
 */
export async function collectProjectImageUrls(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  projectId: string,
  organizationId: string,
): Promise<{ taskImageUrls: string[]; updateImageUrls: string[] }> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, image_urls")
    .eq("project_id", projectId)
    .eq("organization_id", organizationId);
  if (error) {
    console.warn("[collectProjectImageUrls] task read failed:", error.message);
    return { taskImageUrls: [], updateImageUrls: [] };
  }
  const rows = (data ?? []) as Array<{ id: string; image_urls: string[] | null }>;
  const taskImageUrls = [...new Set(rows.flatMap((r) => r.image_urls ?? []))];
  const updateImageUrls = new Set<string>();
  // 주소 길이를 넘지 않게 나눠 읽는다.
  for (let i = 0; i < rows.length; i += 150) {
    const ids = rows.slice(i, i + 150).map((r) => r.id);
    const { data: updates, error: updateError } = await supabase
      .from("task_updates")
      .select("image_urls")
      .in("task_id", ids);
    if (updateError) {
      console.warn("[collectProjectImageUrls] update read failed:", updateError.message);
      return { taskImageUrls, updateImageUrls: [] };
    }
    for (const u of ((updates ?? []) as Array<{ image_urls: string[] | null }>).flatMap((r) => r.image_urls ?? [])) {
      updateImageUrls.add(u);
    }
  }
  return { taskImageUrls, updateImageUrls: [...updateImageUrls] };
}

function isHttpUrl(u: string): boolean {
  return u.startsWith("https://") || u.startsWith("http://");
}

/**
 * http(s) URL 만 남기고 할 일당 상한까지 자른다. 생성용 — 수정은 `mergeTaskImageUrls` 를 쓴다.
 * `organizationId` 를 주면(모바일, 2026-10-26) URL 은 `${organizationId}/task-images/` 아래의 우리 스토리지 객체여야
 * 한다 — 임의의 외부 URL 이나 다른 조직의 URL 은 버린다.
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
 * 수정이 저장하는 이미지 집합. 할 일이 **이미 가진** 사진은 상한 때문에 잘리지 않는다 — 사진 15장인
 * 프로젝트 할 일을 프로젝트에서 빼내도(상한 20 → 5) 15장을 모두 유지한다. 새로 추가한 URL 만
 * 상한을 적용하고, 그것도 전체가 상한 아래일 때만 받는다. 이게 없으면 상한이 목록을 잘라내고
 * 수정이 "제거된" 넘친 분을 스토리지에서 완전 삭제했다.
 */
export function mergeTaskImageUrls(
  previous: string[],
  requested: string[],
  isProjectTask: boolean,
  /** 주어지면 *새로 추가된* URL 은 우리 `${organizationId}/task-images/` 객체여야 한다(2026-10-26). */
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
