"use server";

// 컴플레인 콘솔(PC) 서버 액션 — 외부 리뷰 → 수동 컴플레인 전환 · 외부 리뷰 번역 · 수기 등록 · 등록 사진 올리기.
//
// 폼의 reviewId 만 신뢰하지 않는다: `getExternalReview`/`convertReviewToComplaint`/`translateReviewPart` 가
// 세션 조직으로 다시 스코프를 좁힌다. **결과를 돌려준다**(2026-11-10) — 예전엔 실패를 삼키고 redirect 해서 화면이
// 실패를 몰랐다. 화면(`review-panel-actions.tsx`)이 결과에 따라 오류 문구 · 오류 햅틱을 띄우고 성공하면 주소를 바꾼다.
// 삭제 · 해결 · 처리 기록은 모바일과 같은 `src/actions/complaints.ts` 를 쓴다(화면별 저장 경로를 만들지 않는다).
//
// 도메인 계약: docs/product/25-complaint-workflow.md → "External Review Fields", "Review Translation"

import { revalidatePath } from "next/cache";
import { canWriteComplaint, createComplaint, uploadComplaintImage, type ComplaintInput } from "@/lib/complaints";
import { getCurrentAppSession } from "@/lib/session";
import { convertReviewToComplaint, getExternalReview } from "@/lib/external-reviews";
import { createTranslationBudget, translateReviewPart, type TranslationPart } from "@/lib/review-translate";

export type ConvertReviewResult = { ok: true; complaintId: string; alreadyLinked: boolean } | { error: string };
export type TranslateReviewAllResult = { ok: true } | { error: "unavailable" | "forbidden" };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 외부 리뷰를 근거로 수동 컴플레인을 만든다.
 *
 * 제목은 리뷰 headline → 본문(원문 텍스트) 앞부분 순으로 기본값을 만든다. 스냅샷 보존 · 중복 전환 방지 · 반쪽 상태
 * 되돌리기는 `convertReviewToComplaint` 가 맡는다. 이미 전환된 리뷰면 오류가 아니라 그 컴플레인을 돌려준다.
 */
export async function convertReviewAction(reviewId: string): Promise<ConvertReviewResult> {
  const session = await getCurrentAppSession();
  if (!session || !canWriteComplaint(session)) return { error: "forbidden" };
  const id = typeof reviewId === "string" ? reviewId.trim() : "";
  if (!id) return { error: "not_found" };

  try {
    const review = await getExternalReview({ session, id });
    if (!review) return { error: "not_found" };
    const title =
      review.headline?.trim() ||
      review.reviewText?.trim().slice(0, 60) ||
      review.positiveReviewText?.trim().slice(0, 60) ||
      review.negativeReviewText?.trim().slice(0, 60) ||
      `${review.provider} ${review.externalReviewId}`;
    const { complaintId, alreadyLinked } = await convertReviewToComplaint({ session, reviewId: id, title });
    revalidatePath("/admin/complaints");
    revalidatePath("/mobile/complaints");
    return { ok: true, complaintId, alreadyLinked };
  } catch (error) {
    return { error: messageOf(error, "save_failed") };
  }
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
 * 성공하면 패널을 닫고 실패하면 그 자리에서 사유를 보여 준다.
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
    // 작성 패널 한 번당 uuid — 두 번 눌러도 한 건만(2026-11-10, 모바일과 같은 계약).
    submissionId: optional(formData, "submission_id"),
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
 * 리뷰의 텍스트가 있는 파트(공개/긍정/부정/제목/비공개)를 현재 사용자 언어로 번역해 캐시에 남긴다.
 *
 * 이미 캐시된 조합은 `translateReviewPart`가 즉시 반환하므로, 이 액션은 "번역 보기"를 누를 때마다
 * 매번 불러도 새 DeepL 호출을 만들지 않는다. 성공하면 화면이 `?tr=1` 로 바꿔 저장된 번역을 보여 준다.
 */
export async function translateReviewAction(reviewId: string): Promise<TranslateReviewAllResult> {
  const session = await getCurrentAppSession();
  if (!session) return { error: "forbidden" };
  const id = typeof reviewId === "string" ? reviewId.trim() : "";
  if (!id) return { error: "unavailable" };

  const review = await getExternalReview({ session, id }).catch(() => null);
  if (!review) return { error: "unavailable" };

  const organizationId = session.organization.id;
  const targetLocale = session.user.preferredLanguage;

  const parts: { part: TranslationPart; text: string | null }[] = [
    { part: "review", text: review.reviewText },
    { part: "positive", text: review.positiveReviewText },
    { part: "negative", text: review.negativeReviewText },
    { part: "headline", text: review.headline },
    { part: "private", text: review.privateFeedback },
  ];

  // 한도는 한 번 읽어 조각들이 나눠 쓴다 — 조각마다 옛 합계로 따로 판정하지 않게.
  const budget = createTranslationBudget();
  const results = await Promise.all(
    parts
      .filter((entry): entry is { part: TranslationPart; text: string } => Boolean(entry.text?.trim()))
      .map((entry) =>
        translateReviewPart({
          organizationId,
          externalReviewId: review.id,
          part: entry.part,
          targetLocale,
          sourceText: entry.text,
          sourceLanguageCode: review.sourceLanguageCode,
          budget,
        }),
      ),
  );

  // 하나라도 못 했으면 실패로 알린다 — 예전엔 조용히 원문만 보였다. 된 조각은 저장돼 있어 다시 누르면 빠르다.
  if (results.length === 0 || results.some((result) => result.status !== "ok")) return { error: "unavailable" };
  revalidatePath("/admin/complaints");
  return { ok: true };
}
