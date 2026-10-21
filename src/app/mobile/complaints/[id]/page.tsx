import { notFound, redirect } from "next/navigation";
import { MobileShell } from "@/components/shell/mobile-shell";
import { ComplaintDetail } from "@/components/complaints/complaint-detail";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getDictionary } from "@/lib/i18n";
import {
  getComplaint,
  listComplaintComments,
  canChangeStatus,
  canModerateComplaints,
  canWriteComment,
} from "@/lib/complaints";

type PageProps = { params: Promise<{ id: string }> };

// Complaints / 컴플레인 — Screen 2 (detail). See docs/product/26-complaint-workflow.md.
export default async function MobileComplaintDetailPage({ params }: PageProps) {
  const [state, session, { id }] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/complaints/${id}`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const complaint = await getComplaint({ session, id });
  if (!complaint) notFound();

  const [comments, navBadges] = await Promise.all([
    listComplaintComments({ session, complaintId: id }),
    getMobileNavBadges(),
  ]);

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);

  return (
    <MobileShell activeItem="complaints" badges={navBadges} title={dict.complaints.pageTitle}>
      <ComplaintDetail
        complaint={complaint}
        comments={comments}
        locale={locale}
        currentUserId={session.user.id}
        canModerate={canModerateComplaints(session)}
        canChangeStatus={canChangeStatus(session, complaint)}
        canComment={canWriteComment(session)}
      />
    </MobileShell>
  );
}
