import { redirect } from "next/navigation";

// 초대 코드(팀 코드) 관리는 2026-07-13 에 사용자 섹션으로 옮겼다 — 구성원 생애주기
// (초대 → 관리 → 비활성화 → 삭제)가 이제 한곳에 있다. 예전 링크와 북마크가 404 가 되지 않도록
// 리다이렉트로 남겨 둔다.
export default function AdminInviteCodesRedirectPage() {
  redirect("/admin/users/invites");
}
