import { AdminShell } from "@/components/shell/admin-shell";
import { ComplaintsConsole } from "@/components/admin/complaints/complaints-console";
import {
  canModerateComplaints,
  canChangeStatus,
  canWriteComment,
  canWriteComplaint,
  getComplaint,
  listComplaintComments,
  listComplaints,
  type ComplaintComment,
  type Complaint,
} from "@/lib/complaints";
import {
  listComplaintPickerPlaces,
  listComplaintPickerReservations,
} from "@/lib/complaint-reservations";
import {
  getExternalReview,
  listExternalReviews,
  listReviewBuildingOptions,
  summarizeReviewsByPlace,
  type ExternalReviewDetail,
  type ReviewListFilter,
} from "@/lib/external-reviews";
import { getStoredTranslations, type TranslationPart } from "@/lib/review-translate";
import { getReviewSyncStatus } from "@/lib/beds24/reviews-sync-manual";
import { reviewSyncLabels } from "@/lib/review-sync-labels";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary } from "@/lib/i18n";

// 컴플레인 콘솔 — 수동 컴플레인 + Beds24 외부 리뷰 통합 검토.
// 뷰 전환과 기간/필터는 전부 쿼리스트링으로 다뤄, 서버 렌더 한 번으로 끝난다.
// 도메인 계약: docs/product/25-complaint-workflow.md, IA: docs/product/05-admin-web-ia.md
export const dynamic = "force-dynamic";

type SearchParams = {
  view?: string;
  from?: string;
  to?: string;
  provider?: string;
  property?: string;
  room?: string;
  /** 건물 필터(정규화 건물명) — 리뷰 · 수동 컴플레인 공용. 화이트 리디자인(2026-10-14). */
  building?: string;
  /** 객실 필터(표시 라벨) — 건물을 고른 뒤에만. */
  rl?: string;
  /** 건물 · 객실별 집계 단위 — building(기본) | room. */
  by?: string;
  /** 건물 · 객실별 정렬 — ratio(기본) | count. */
  sort?: string;
  /** 수동 컴플레인 상태 — open | done. */
  st?: string;
  /** 수동 컴플레인 플랫폼 · 작성자 고르기. */
  mp?: string;
  author?: string;
  risk?: string;
  /** 상세 패널을 여는 외부 리뷰 id. */
  review?: string;
  /** 상세 패널을 여는 수동 컴플레인 id (`review` 와 같은 방식, 2026-09-08). */
  complaint?: string;
  /** "1"이면 저장된 번역을 원문 대신 보여준다. */
  tr?: string;
};

/** 기본 기간은 최근 90일 — Beds24 초기 수집 범위와 같은 창을 본다. */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

export default async function AdminComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireAdminPageSession({ nextPath: "/admin/complaints" });
  const params = await searchParams;
  const dictionary = getDictionary(session.user.preferredLanguage);

  const fallback = defaultRange();
  const from = params.from?.trim() || fallback.from;
  const to = params.to?.trim() || fallback.to;

  // 들어오면 **외부 리뷰**가 먼저 보인다(2026-10-01 사용자 요청 — 모바일과 같다). 다른 뷰는 탭(`?view=`)으로.
  const view =
    params.view === "manual" || params.view === "reviews" || params.view === "rooms"
      ? params.view
      : "reviews";

  // 건물 고르기는 정규화 이름 하나가 여러 property_id 에 대응한다(Beds24 원본 표기가 여럿) — 마스터에서 묶는다.
  const buildingOptions = await listReviewBuildingOptions({ session, locale: session.user.preferredLanguage });
  const building = buildingOptions.find((option) => option.value === params.building?.trim()) ?? null;
  const roomLabel = building ? params.rl?.trim() || null : null;

  const filter: ReviewListFilter = {
    from,
    to,
    riskOnly: params.risk === "1",
    provider: params.provider === "airbnb" || params.provider === "booking" ? params.provider : undefined,
    propertyId: params.property?.trim() || undefined,
    propertyIds: building ? building.propertyIds : undefined,
    roomId: params.room?.trim() || undefined,
  };

  // 세 뷰가 같은 KPI 줄을 공유하므로 집계는 항상 계산한다. 리뷰 목록은 뷰와 무관하게
  // 미전환 건수 계산에 쓰이므로 함께 가져온다.
  // 등록 패널의 선택지는 작성 권한자에게만 필요하다 — 권한이 없으면 두 쿼리를 아예 돌리지 않는다.
  const canWrite = canWriteComplaint(session.user.role);

  const [complaints, allReviews, summaries, createReservations, createPlaces, reviewSync] = await Promise.all([
    listComplaints({ session }),
    listExternalReviews({ session, filter }),
    summarizeReviewsByPlace({ session, from, to, locale: session.user.preferredLanguage }),
    canWrite
      ? listComplaintPickerReservations(session.organization.id, session.user.preferredLanguage)
      : Promise.resolve([]),
    canWrite
      ? listComplaintPickerPlaces(session.organization.id, session.user.preferredLanguage)
      : Promise.resolve([]),
    // 「지금 가져오기」 — 작성 권한자에게만 보인다(서버 액션이 같은 권한을 다시 본다).
    canWrite ? getReviewSyncStatus(getSupabaseServiceClient(), session.organization.id) : Promise.resolve(null),
  ]);

  // 상세 패널은 ?review=<id> 쿼리로만 연다 — 콘솔의 나머지 상태와 같은 서버 렌더 한 번으로 끝난다.
  const reviewId = params.review?.trim() || null;
  // 수동 컴플레인 상세도 같은 규약으로 연다 — 새 라우트를 파지 않는다(콘솔 공유 계약).
  const complaintId = params.complaint?.trim() || null;
  let selectedComplaint: Complaint | null = null;
  let selectedReview: ExternalReviewDetail | null = null;
  let translations: Partial<Record<TranslationPart, string>> = {};
  const showTranslation = params.tr === "1";
  if (reviewId) {
    selectedReview = await getExternalReview({ session, id: reviewId });
    if (selectedReview && showTranslation) {
      translations = await getStoredTranslations({
        externalReviewId: reviewId,
        targetLocale: session.user.preferredLanguage,
      });
    }
  }

  let comments: ComplaintComment[] = [];
  if (complaintId) {
    selectedComplaint = await getComplaint({ session, id: complaintId });
    if (selectedComplaint) comments = await listComplaintComments({ session, complaintId });
  }

  // 객실은 표시 라벨로 거른다 — 같은 방을 두 Beds24 어카운트가 나눠 쓰므로 room_id 하나로는 모자란다.
  const reviews = roomLabel ? allReviews.filter((review) => review.displayRoomLabel === roomLabel) : allReviews;

  return (
    <AdminShell activeItem="complaints" title={dictionary.complaints.adminTitle}>
      <ComplaintsConsole
        copy={dictionary.complaints}
        sharedCopy={dictionary.admin.shared}
        buildingLabels={dictionary.cleaning.buildingLabels}
        locale={session.user.preferredLanguage}
        view={view}
        from={from}
        to={to}
        filter={filter}
        complaints={complaints}
        comments={comments}
        canComment={canWriteComment(session.user.role)}
        canChangeSelectedStatus={selectedComplaint ? canChangeStatus(session, selectedComplaint) : false}
        buildingOptions={buildingOptions.map(({ value, label }) => ({ value, label }))}
        building={building?.value ?? null}
        roomLabel={roomLabel}
        roomsBy={params.by === "room" ? "room" : "building"}
        roomsSort={params.sort === "count" ? "count" : "ratio"}
        manualStatus={params.st === "open" || params.st === "done" ? params.st : "all"}
        manualPlatform={params.mp?.trim() || "all"}
        manualAuthor={params.author?.trim() || "all"}
        currentUserId={session.user.id}
        canModerate={canModerateComplaints(session.user.role)}
        canWrite={canWrite}
        createReservations={createReservations}
        createPlaces={createPlaces}
        reviews={reviews}
        summaries={summaries}
        selectedReview={selectedReview}
        selectedComplaint={selectedComplaint}
        showTranslation={showTranslation}
        translations={translations}
        canConvert={canWrite}
        reviewSync={reviewSync ? { ...reviewSync, labels: reviewSyncLabels(dictionary.complaints) } : null}
        panelLabels={{
          building: dictionary.complaints.metaBuilding,
          room: dictionary.complaints.metaRoom,
          reservation: dictionary.mobile.calendarReservationId,
          guest: dictionary.admin.calendar.guestName,
          close: dictionary.common.close,
        }}
      />
    </AdminShell>
  );
}
