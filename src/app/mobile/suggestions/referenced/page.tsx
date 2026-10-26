import { redirect } from "next/navigation";

// 직원 건의 / 피드백함 — 참조자 상세는 이제 `/mobile/suggestions/[id]` 라우트가
// 역할에 맞게 렌더한다(4단계, 2026-06-16). 그래서 이 디자인 미리보기 라우트(건의 id 가 없고
// 샘플 데이터만 보여줬음)는 목록으로 리디렉트만 한다.
// 참고: docs/product/22-staff-suggestions-workflow.md.
export default function MobileSuggestionReferencedPage() {
  redirect("/mobile/suggestions");
}
