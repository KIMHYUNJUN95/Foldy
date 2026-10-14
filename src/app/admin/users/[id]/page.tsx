import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * 예전 멤버 프로필 화면 주소. 화이트 리디자인(2026-10-14)에서 목록 오른쪽 패널로 합쳤다 — 알림 · 북마크로
 * 남아 있는 링크가 깨지지 않도록 같은 사람을 연 목록으로 넘긴다. 권한 검사는 목록 페이지가 한다.
 */
export default async function AdminUserDetailPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/admin/users?member=${encodeURIComponent(id)}`);
}
