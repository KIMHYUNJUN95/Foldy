import { redirect } from "next/navigation";
import { announcementPanelHref } from "@/lib/announcement-display";

// 예전 공지 상세 주소(2026-11-20, 공지 unslop B2). 공지는 콘솔 오른쪽 패널에서 연다 — 따로 그리던 상세 화면은 없앴다.
// 예전 링크 · 북마크가 깨지지 않게 `/admin/announcements?id=<id>` 로 넘긴다(권한 · 조직 확인은 콘솔이 한다).
// docs/product/11-announcement-workflow.md → 「예전 상세 주소」.
type PageProps = { params: Promise<{ id: string }> };

export default async function LegacyAdminAnnouncementDetailPage({ params }: PageProps) {
  const { id } = await params;
  redirect(announcementPanelHref(id));
}
