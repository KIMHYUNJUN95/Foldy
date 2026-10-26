"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import {
  createBugReport,
  deleteBugReport,
  updateBugReport,
  updateBugReportStatus,
  uploadBugReportImage,
  type BugStatus,
} from "@/lib/bug-reports";

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

function collectImageUrls(formData: FormData): string[] {
  // 개별 `image_0..image_4` 키와 반복되는 `imageUrls` 키를 모두 받아 프런트를
  // 유연하게 둔다. 이미 업로드된 공개 URL 만 받는다 — 실제 업로드는 먼저
  // `uploadBugReportImageAction` 으로 하므로 저장 경로는 서버가 통제한다.
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

function revalidateBugSurfaces(reportId?: string) {
  revalidatePath("/mobile/bugs");
  if (reportId) revalidatePath(`/mobile/bugs/${reportId}`);
}

/**
 * 초안 보고서의 스크린샷을 업로드한다. 프런트는 초안 ID 를 만들어 그 ID 로 업로드를
 * 요청한 뒤 결과 이미지 URL 로 `createBugReportAction` 을 호출해야 한다.
 * 헬퍼가 session.organization.id + 전달된 reportId 로 저장 경로를 다시 만들어서
 * 클라이언트가 자기 조직 밖이나 다른 report id 아래에 쓸 수 없다.
 */
export async function uploadBugReportImageAction(
  reportId: string,
  formData: FormData,
): Promise<{ url: string } | ActionError> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "missing_file" };

  try {
    const url = await uploadBugReportImage({ session, reportId, file });
    return { url };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function createBugReportAction(formData: FormData): Promise<CreateResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const title = pickString(formData.get("title"));
  const description = pickString(formData.get("description"));
  const imageUrls = collectImageUrls(formData);

  try {
    const { id } = await createBugReport({ session, title, description, imageUrls });
    revalidateBugSurfaces(id);
    return { id };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function updateBugReportAction(
  reportId: string,
  formData: FormData,
): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  const title = pickString(formData.get("title"));
  const description = pickString(formData.get("description"));
  const imageUrls = collectImageUrls(formData);

  try {
    await updateBugReport({ session, id: reportId, title, description, imageUrls });
    revalidateBugSurfaces(reportId);
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function deleteBugReportAction(reportId: string): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  try {
    await deleteBugReport({ session, id: reportId });
    revalidateBugSurfaces(reportId);
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}

export async function setBugReportStatus(
  reportId: string,
  status: BugStatus,
): Promise<OkResult> {
  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { error: "no_org" };

  try {
    await updateBugReportStatus({ session, id: reportId, status });
    revalidateBugSurfaces(reportId);
    return { ok: true };
  } catch (err) {
    return { error: messageFor(err) };
  }
}
