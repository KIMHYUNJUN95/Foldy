// 직원 건의 / 피드백함 — 공용 타입 + 상수 (1단계, 스키마 인접 부분만).
//
// 이 모듈은 아직 의도적으로 쿼리, 서버 액션, UI 연결을 두지 않는다. 이후
// 단계(목록 / 상세 / 댓글 / 상태)가 행 타입, 상태 유니온, 이미지 상한을
// 다시 도출하지 않고 공유할 수 있게 하려는 것이다. docs/engineering/12-staff-suggestions-technical-design.md 참고.

import type { Database } from "@/types/database";

export type StaffSuggestionRow = Database["public"]["Tables"]["staff_suggestions"]["Row"];
export type StaffSuggestionReferenceRow =
  Database["public"]["Tables"]["staff_suggestion_references"]["Row"];
export type StaffSuggestionCommentRow =
  Database["public"]["Tables"]["staff_suggestion_comments"]["Row"];

/** 건의 수명 주기. 수신자만 이들 사이를 옮길 수 있다 (나중에 서버에서 강제). */
export type StaffSuggestionStatus = "submitted" | "reviewing" | "on_hold" | "completed";

export const STAFF_SUGGESTION_STATUSES: readonly StaffSuggestionStatus[] = [
  "submitted",
  "reviewing",
  "on_hold",
  "completed",
];

/** 건의 행과 각 댓글 행의 최대 사진 수 — DB CHECK 제약과 같다. */
export const STAFF_SUGGESTION_MAX_IMAGES = 5;

/** `on_hold` 는 보류 사유가, `completed` 는 완료 메모가 필요하다 (DB CHECK 와 같음). */
export function suggestionStatusRequiresNote(status: StaffSuggestionStatus): boolean {
  return status === "on_hold" || status === "completed";
}
