/**
 * `request-images` 버킷 — 브라우저(로그인 사용자 키)로 올리는 4칸 경로 `{조직}/{폴더}/{기록 id}/{파일}` 의 폴더 목록.
 *
 * 이 목록이 기준이다. DB 쪽은 `public.request_image_folder_allows(폴더, 역할)` 함수 하나가 같은 목록을 들고 있고
 * (마이그레이션 `202611200005_request_images_folder_policies.sql`), 올리기 · 지우기 정책은 그 함수만 부른다.
 * 폴더를 하나 더하면: 여기 + 새 마이그레이션에서 그 함수를 `create or replace` — 정책은 다시 만들지 않는다.
 * 두 목록이 어긋나면 `src/lib/__tests__/request-image-folders-policy.test.ts` 가 실패한다.
 *
 * 여기 없는 폴더는 서버(service role)만 쓴다 — 정책을 거치지 않는다:
 * `bug-reports` · `complaint-images` · `complaint-comment-images`. 5칸 경로(교통비 · 휴가)는 따로 정책이 있다.
 */

/** 그 조직 활성 멤버 누구나(아르바이트 포함) 올릴 수 있는 폴더. */
export const REQUEST_IMAGE_FOLDERS_ALL_MEMBERS = [
  "lost-items",
  "lost-found-handling",
  "maintenance-reports",
  "maintenance-resolutions",
  "order-images",
  "linen-returns",
  "suggestion-images",
  "attendance-corrections",
  "board-posts",
  "board-comments",
] as const;

/** 아르바이트(`part_time_staff`)는 못 올리는 폴더 — 2026-06-29 정의 그대로 되살림. */
export const REQUEST_IMAGE_FOLDERS_NO_PART_TIME = ["task-images", "task-update-images"] as const;

export const REQUEST_IMAGE_USER_FOLDERS = [
  ...REQUEST_IMAGE_FOLDERS_ALL_MEMBERS,
  ...REQUEST_IMAGE_FOLDERS_NO_PART_TIME,
] as const;

export type RequestImageFolder = (typeof REQUEST_IMAGE_USER_FOLDERS)[number];
