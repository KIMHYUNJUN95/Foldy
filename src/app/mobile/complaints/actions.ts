"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import {
  createComplaint,
  createComplaintComment,
  deleteComplaint,
  deleteComplaintComment,
  reopenComplaint,
  resolveComplaint,
  updateComplaint,
  updateComplaintComment,
  uploadComplaintCommentImage,
  uploadComplaintImage,
  type ComplaintInput,
  type ComplaintPatch,
} from "@/lib/complaints";
import { convertReviewToComplaint } from "@/lib/external-reviews";
import { translateReviewPart, type TranslationPart } from "@/lib/review-translate";

type ActionError = { error: string };
type CreateResult = { id: string } | ActionError;
type OkResult = { ok: true } | ActionError;

function messageFor(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "save_failed";
}

function pickString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function optionalString(formData: FormData, key: string): string | null {
  const value = pickString(formData.get(key)).trim();
  return value ? value : null;
}

function optionalRating(formData: FormData): number | null {
  const raw = pickString(formData.get("rating")).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function collectImageUrls(formData: FormData): string[] {
  // Both individual `image_0..image_4` keys and a repeated `imageUrls` key are accepted (mirrors the
  // bug-report action). Already-uploaded public URLs only — the actual upload goes through the
  // dedicated upload action first so the server controls the storage path.
  const urls: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const v = pickString(formData.get(`image_${i}`));
    if (v) urls.push(v);
  }
  for (const entry of formData.getAll("imageUrls")) {
    const v = typeof entry === "string" ? entry : "";
    if (v) urls.push(v);
  }
  return Array.from(new Set(urls)).slice(0, 5);
}

function revalidateComplaintSurfaces(complaintId?: string) {
  revalidatePath("/mobile/complaints");
  if (complaintId) revalidatePath(`/mobile/complaints/${complaintId}`);
  // 어드민 콘솔도 같은 데이터를 보여 준다(상세 패널의 처리 기록 · 상태).
  revalidatePath("/admin/complaints");
}

export async function uploadComplaintImageAction(
  complaintId: string,
  formData: FormData,
): Promise<{ url: string } | ActionError> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "missing_file" };

  try {
    const url = await uploadComplaintImage({ session, complaintId, file });
    return { url };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function uploadComplaintCommentImageAction(
  complaintId: string,
  commentId: string,
  formData: FormData,
): Promise<{ url: string } | ActionError> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "missing_file" };

  try {
    const url = await uploadComplaintCommentImage({ session, complaintId, commentId, file });
    return { url };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function createComplaintAction(formData: FormData): Promise<CreateResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const input: ComplaintInput = {
    platform: pickString(formData.get("platform")),
    title: pickString(formData.get("title")),
    description: optionalString(formData, "description"),
    platformRef: optionalString(formData, "platform_ref"),
    rating: optionalRating(formData),
    propertyId: optionalString(formData, "property_id"),
    propertyName: optionalString(formData, "property_name"),
    roomId: optionalString(formData, "room_id"),
    roomLabel: optionalString(formData, "room_label"),
    reservationId: optionalString(formData, "reservation_id"),
    guestName: optionalString(formData, "guest_name"),
    imageUrls: collectImageUrls(formData),
  };

  try {
    const { id } = await createComplaint({ session, input });
    revalidateComplaintSurfaces(id);
    return { id };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function updateComplaintAction(id: string, formData: FormData): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const patch: ComplaintPatch = {
    platform: pickString(formData.get("platform")),
    title: pickString(formData.get("title")),
    description: optionalString(formData, "description"),
    platformRef: optionalString(formData, "platform_ref"),
    rating: optionalRating(formData),
    propertyId: optionalString(formData, "property_id"),
    propertyName: optionalString(formData, "property_name"),
    roomId: optionalString(formData, "room_id"),
    roomLabel: optionalString(formData, "room_label"),
    reservationId: optionalString(formData, "reservation_id"),
    guestName: optionalString(formData, "guest_name"),
    imageUrls: collectImageUrls(formData),
  };

  try {
    await updateComplaint({ session, id, patch });
    revalidateComplaintSurfaces(id);
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function deleteComplaintAction(id: string): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  try {
    await deleteComplaint({ session, id });
    revalidateComplaintSurfaces(id);
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function resolveComplaintAction(id: string): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  try {
    await resolveComplaint({ session, id });
    revalidateComplaintSurfaces(id);
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function reopenComplaintAction(id: string): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  try {
    await reopenComplaint({ session, id });
    revalidateComplaintSurfaces(id);
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function createComplaintCommentAction(
  complaintId: string,
  content: string,
  imageUrls: string[],
): Promise<CreateResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, 5)
    : [];

  try {
    const { id } = await createComplaintComment({ session, complaintId, content, imageUrls: urls });
    revalidateComplaintSurfaces(complaintId);
    return { id };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function updateComplaintCommentAction(
  commentId: string,
  content: string,
): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  try {
    await updateComplaintComment({ session, commentId, content });
    revalidateComplaintSurfaces();
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function deleteComplaintCommentAction(commentId: string): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  try {
    await deleteComplaintComment({ session, commentId });
    revalidateComplaintSurfaces();
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

// ────────────────────────────────────────────────────────────
// External review → manual complaint conversion + on-demand translation.
// See docs/product/25-complaint-workflow.md.
// ────────────────────────────────────────────────────────────

export async function convertReviewToComplaintAction(
  reviewId: string,
  title: string,
  description: string,
): Promise<CreateResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  try {
    const { complaintId } = await convertReviewToComplaint({
      session,
      reviewId,
      title,
      description: description.trim() ? description.trim() : null,
    });
    revalidateComplaintSurfaces(complaintId);
    revalidatePath(`/mobile/complaints/reviews/${reviewId}`);
    return { id: complaintId };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export type TranslateReviewResult = { status: "ok"; text: string } | { status: "unavailable" };

export async function translateReviewPartAction(
  reviewId: string,
  part: TranslationPart,
  sourceText: string,
  sourceLanguageCode: string | null,
): Promise<TranslateReviewResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { status: "unavailable" };

  // Locale is read from the session, never taken from the caller — keeps the translation
  // cache keyed to the viewer's real app language.
  const result = await translateReviewPart({
    organizationId: session.organization.id,
    externalReviewId: reviewId,
    part,
    targetLocale: session.user.preferredLanguage,
    sourceText,
    sourceLanguageCode,
  });

  if (result.status === "ok") return { status: "ok", text: result.text };
  return { status: "unavailable" };
}
