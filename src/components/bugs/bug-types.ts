// 서버 전용 도메인 모듈의 정식 타입을 다시 내보내서 컴포넌트가
// `server-only` 를 클라이언트 번들에 끌어들이지 않고 클라이언트 안전 경로에서 가져올 수 있게 한다.
import type { BugStatus } from "@/lib/bug-reports";
import type { Dictionary } from "@/lib/i18n";

export type { BugReport, BugStatus } from "@/lib/bug-reports";

/** 버그 신고 화면용 현지화 문구 조각. 서버 페이지가 클라이언트로 넘긴다. */
export type BugCopy = Dictionary["bugs"];

/** 상태 → 현지화 라벨의 단일 출처(배지, 목록, 상세, 시트에서 사용). */
export function bugStatusLabel(copy: BugCopy, status: BugStatus): string {
  switch (status) {
    case "submitted":
      return copy.statusSubmitted;
    case "reviewing":
      return copy.statusReviewing;
    case "fixed":
      return copy.statusFixed;
    case "closed":
      return copy.statusClosed;
    default:
      return status;
  }
}
