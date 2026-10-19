/**
 * 서버가 내려받아도 되는 이력서 주소인가.
 *
 * 지원서는 브라우저가 Firestore 에 직접 쓰므로 `resumeUrl` 은 누구나 아무 값이나 넣을 수 있다.
 * 검사 없이 받으면 우리 서버가 내부망·메타데이터 주소를 대신 열어 비공개 버킷에 담아 주는 SSRF 가
 * 된다. 채용 사이트 업로드가 실제로 만드는 형식 — Firebase Storage 다운로드 URL, 그 프로젝트의
 * 버킷 — 만 허용한다.
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md §5
 */

export const RESUME_SOURCE_HOST = "firebasestorage.googleapis.com";

export function allowedResumeBuckets(projectId: string): string[] {
  return [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];
}

export function isAllowedResumeSourceUrl(raw: string, projectId: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname !== RESUME_SOURCE_HOST) return false;
  if (url.port !== "" || url.username !== "" || url.password !== "") return false;
  const match = /^\/v0\/b\/([^/]+)\/o\/.+$/.exec(url.pathname);
  if (!match) return false;
  return allowedResumeBuckets(projectId).includes(match[1]);
}
