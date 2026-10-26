import { redirect } from "next/navigation";

// 예전 Todoist 관리자 경로. 데스크톱 Todoist 콘솔은 이제 /admin/tasks 에 있다
// (docs/product/28-admin-todoist-console.md 참고). 옛 링크가 열리도록 이 경로는 리다이렉트로 둔다.
export default function AdminRecurringWorkPage() {
  redirect("/admin/tasks");
}
