"use server";

// 컴플레인 콘솔 서버 액션 — 외부 리뷰 → 수동 컴플레인 전환, 외부 리뷰 번역 요청.
//
// 둘 다 폼 데이터의 reviewId만 신뢰하지 않는다: `getExternalReview`/`convertReviewToComplaint`/
// `translateReviewPart`가 세션 조직으로 다시 스코프를 좁힌다. 여기서는 진입 시점 권한만 먼저 막고,
// 실패는 조용히 원래 상세로 되돌아간다 — 리뷰 상세 자체는 읽기 화면이라 별도 에러 배너 카피가 아직 없다.
//
// 도메인 계약: docs/product/25-complaint-workflow.md → "External Review Fields", "Review Translation"

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  canWriteComplaint,
  createComplaint,
  deleteComplaint,
  uploadComplaintImage,
  type ComplaintInput,
} from "@/lib/complaints";
import { getCurrentAppSession } from "@/lib/session";
import { convertReviewToComplaint, getExternalReview } from "@/lib/external-reviews";
import { translateReviewPart, type TranslationPart } from "@/lib/review-translate";

/** redirectTo는 항상 이 콘솔 안에서만 온다 — open redirect 방지. */
function redirectTarget(formData: FormData): string {
  const target = String(formData.get("redirectTo") ?? "").trim();
  return target.startsWith("/admin/complaints") ? target : "/admin/complaints";
}

/**
 * 외부 리뷰를 근거로 수동 컴플레인을 만든다.
 *
 * 제목을 비워 두면 리뷰 headline → 본문(원문 텍스트) 앞부분 순으로 기본값을 만든다. 실제 스냅샷
 * 보존과 중복 전환 방지는 `convertReviewToComplaint`가 담당한다.
 */
export async function convertReviewAction(formData: FormData): Promise<void> {
  const session = await getCurrentAppSession();
  const target = redirectTarget(formData);
  if (!session) redirect("/admin/complaints");
  if (!canWriteComplaint(session)) redirect(target);

  const reviewId = String(formData.get("reviewId") ?? "").trim();
  if (!reviewId) redirect(target);

  const review = await getExternalReview({ session, id: reviewId });
  if (!review) redirect(target);

  const titleInput = String(formData.get("title") ?? "").trim();
  const title =
    titleInput ||
    review.headline?.trim() ||
    review.reviewText?.trim().slice(0, 60) ||
    review.positiveReviewText?.trim().slice(0, 60) ||
    review.negativeReviewText?.trim().slice(0, 60) ||
    `${review.provider} ${review.externalReviewId}`;

  try {
    await convertReviewToComplaint({ session, reviewId, title });
    revalidatePath("/admin/complaints");
  } catch {
    // 이미 전환됐거나(already_linked) 권한/조직이 어긋난 경우 — 상세를 그대로 다시 보여준다.
  }
  redirect(target);
}

const MAX_IMAGES = 5;

export type CreateComplaintResult = { id: string } | { error: string };
export type UploadImageResult = { url: string } | { error: string };

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value : null;
}

/**
 * 대시보드에서 수동 컴플레인을 직접 등록한다 (구현 2026-08-06).
 *
 * 모바일 `createComplaintAction`과 **같은 도메인 함수**(`createComplaint`)를 부른다 — 화면별로
 * 다른 저장 경로를 만들지 않는다는 교차 화면 계약(docs/product/25 §Cross-surface consistency).
 * 권한(`canWriteComplaint`)·조직 스코프·제목/플랫폼/이미지 검증은 전부 그 안에서 다시 이뤄지며,
 * 여기서 앞서 막는 것은 진입 시점 방어일 뿐이다.
 *
 * 결과를 반환하는 이유: 이 액션은 redirect 하는 다른 콘솔 액션과 달리 클라이언트 패널이 부르고,
 * 성공하면 패널을 닫고 실패하면 그 자리에서 사유를 보여 줘야 한다.
 */
export async function createManualComplaintAction(
  formData: FormData,
): Promise<CreateComplaintResult> {
  const session = await getCurrentAppSession();
  if (!session) return { error: "forbidden" };
  if (!canWriteComplaint(session)) return { error: "forbidden" };

  const imageUrls: string[] = [];
  for (let index = 0; index < MAX_IMAGES; index += 1) {
    const url = optional(formData, `image_${index}`);
    if (url) imageUrls.push(url);
  }

  const ratingRaw = optional(formData, "rating");
  const rating = ratingRaw === null ? null : Number(ratingRaw);

  const input: ComplaintInput = {
    platform: String(formData.get("platform") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
    description: optional(formData, "description"),
    rating: rating !== null && Number.isFinite(rating) ? rating : null,
    // 건물·객실은 예약을 골랐을 때와 객실 마스터에서 직접 골랐을 때 모두 채워진다. 어느 쪽도
    // 아니면 null로 두고 저장한다 — 어느 방 건인지 모르는 컴플레인도 등록 자체는 가능해야 한다.
    propertyId: optional(formData, "property_id"),
    propertyName: optional(formData, "property_name"),
    roomId: optional(formData, "room_id"),
    roomLabel: optional(formData, "room_label"),
    reservationId: optional(formData, "reservation_id"),
    guestName: optional(formData, "guest_name"),
    imageUrls,
  };

  try {
    const { id } = await createComplaint({ session, input });
    revalidatePath("/admin/complaints");
    revalidatePath("/mobile/complaints");
    return { id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "save_failed" };
  }
}

/**
 * 등록 패널의 사진 업로드. 아직 존재하지 않는 컴플레인이라 클라이언트가 만든 draft id 아래에
 * 올린다 — 모바일 등록 폼과 동일한 규약이고, 경로 검증과 5장 제한은 서버가 다시 본다.
 */
export async function uploadManualComplaintImageAction(
  draftId: string,
  formData: FormData,
): Promise<UploadImageResult> {
  const session = await getCurrentAppSession();
  if (!session) return { error: "forbidden" };
  if (!canWriteComplaint(session)) return { error: "forbidden" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "invalid_file" };

  try {
    const url = await uploadComplaintImage({ session, complaintId: draftId, file });
    return { url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "upload_failed" };
  }
}

/**
 * 수동 컴플레인 삭제 (MVP hard delete — 문서 25 §"컴플레인 본체는 hard delete").
 *
 * 권한(작성자 본인 또는 owner/office_admin/super-admin)은 `deleteComplaint`가 서버에서 다시 검증한다.
 * 폼의 complaintId만 신뢰하지 않는다. 되돌릴 수 없으므로 호출부(모달)에서 확인 UX를 거친다.
 * redirect 없이 revalidate만 한다 — 클라이언트가 목록에 남은 채로 서버 컴포넌트가 갱신된다.
 */
export async function deleteComplaintAction(formData: FormData): Promise<void> {
  const session = await getCurrentAppSession();
  if (!session) return;

  const id = String(formData.get("complaintId") ?? "").trim();
  if (!id) return;

  try {
    await deleteComplaint({ session, id });
  } catch {
    // 이미 삭제됐거나(not_found) 권한/조직이 어긋난 경우 — 목록을 그대로 다시 그린다.
  }
  revalidatePath("/admin/complaints");
}

/**
 * 리뷰의 텍스트가 있는 파트(공개/긍정/부정/제목/비공개)를 현재 사용자 언어로 번역해 캐시에 남긴다.
 *
 * 이미 캐시된 조합은 `translateReviewPart`가 즉시 반환하므로, 이 액션은 "번역 보기"를 누를 때마다
 * 매번 불러도 새 DeepL 호출을 만들지 않는다.
 */
export async function translateReviewAction(formData: FormData): Promise<void> {
  const session = await getCurrentAppSession();
  const target = redirectTarget(formData);
  if (!session) redirect("/admin/complaints");

  const reviewId = String(formData.get("reviewId") ?? "").trim();
  if (!reviewId) redirect(target);

  const review = await getExternalReview({ session, id: reviewId });
  if (!review) redirect(target);

  const organizationId = session.organization.id;
  const targetLocale = session.user.preferredLanguage;

  const parts: { part: TranslationPart; text: string | null }[] = [
    { part: "review", text: review.reviewText },
    { part: "positive", text: review.positiveReviewText },
    { part: "negative", text: review.negativeReviewText },
    { part: "headline", text: review.headline },
    { part: "private", text: review.privateFeedback },
  ];

  await Promise.all(
    parts
      .filter((entry): entry is { part: TranslationPart; text: string } => Boolean(entry.text?.trim()))
      .map((entry) =>
        translateReviewPart({
          organizationId,
          externalReviewId: reviewId,
          part: entry.part,
          targetLocale,
          sourceText: entry.text,
          sourceLanguageCode: review.sourceLanguageCode,
        }),
      ),
  );

  revalidatePath("/admin/complaints");
  redirect(target);
}
