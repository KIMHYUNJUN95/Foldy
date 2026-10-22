"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sanitizeBottomNavTabIds } from "@/config/navigation";
import { isLocale } from "@/lib/i18n";
import {
  displayNameFrom,
  normalizeIdentityNames,
  validateIdentityNames,
} from "@/lib/identity-names";
import { isProfileGender, isValidBirthDate, isValidPhone } from "@/lib/onboarding";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { mustWrite } from "@/lib/db-write-guard";

export async function deleteAccount(): Promise<never> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const service = getSupabaseServiceClient();

  // Tombstone the profile: clear PII, mark as deleted.
  // The row is kept so operational records (attendance, cleaning, tasks)
  // retain their user_id FK and display "탈퇴한 사용자" instead of breaking.
  //
  // **두 쓰기는 반드시 성공해야 한다.** 아래 `deleteUser` 는 되돌릴 수 없고, 그러고 나면 본인도
  // 다시 로그인해 재시도할 수 없다. 예전에는 결과를 받지 않아, 묘비 처리가 실패해도 그대로
  // 계정을 지웠다 — **개인정보(이름·전화·사진·생년월일)가 남고 조직 명단에도 계속 보이는데
  // 복구 경로가 없는** 상태가 된다(2026-09-08 전수 점검에서 발견).
  const tombstoned = await mustWrite(
    "account delete: profile tombstone",
    service
      .from("profiles")
      .update({
        name: "",
        phone_number: "",
        profile_photo_url: null,
        birth_date: null,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", user.id),
  );
  if (!tombstoned) {
    redirect("/account?error=delete_failed");
  }

  // Remove from all org memberships so the user no longer appears in rosters.
  const removed = await mustWrite(
    "account delete: membership removal",
    service.from("memberships").update({ status: "removed" }).eq("user_id", user.id),
  );
  if (!removed) {
    redirect("/account?error=delete_failed");
  }

  // Hard-delete the auth user — this frees the email for re-registration.
  // The profiles row survives because we removed the ON DELETE CASCADE FK.
  // 여기까지 왔다면 위 두 쓰기가 성공했다 — 이제 되돌릴 수 없는 단계로 넘어가도 안전하다.
  await service.auth.admin.deleteUser(user.id);

  redirect("/auth/login");
}

function toAccountRedirect(mode: string, query: string): never {
  const nextMode = mode === "mobile" ? "mobile" : "admin";
  redirect(`/account?mode=${nextMode}&${query}`);
}

export async function updateAccountProfile(formData: FormData) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/account");
  }

  const mode = String(formData.get("mode") ?? "admin");
  // 국적 + 이름 세 가지(docs/product/41 §2) — 이 칸들을 보낸 폼일 때만 검사 · 저장하고, 앱에 보이는 이름도 여기서 만든다.
  // 모바일 계정 화면은 한 칸씩 고치므로(언어 · 전화 …) 이름 칸이 없는 저장은 지금 이름을 그대로 둔다.
  const hasIdentity = formData.has("nationality");
  const identity = normalizeIdentityNames({
    nationality: String(formData.get("nationality") ?? ""),
    nameKo: String(formData.get("nameKo") ?? ""),
    nameJa: String(formData.get("nameJa") ?? ""),
    nameEn: String(formData.get("nameEn") ?? ""),
    nameKatakana: String(formData.get("nameKatakana") ?? ""),
  });
  if (hasIdentity && Object.keys(validateIdentityNames(identity)).length > 0) {
    toAccountRedirect(mode, "error=identity_invalid");
  }
  const name = hasIdentity ? displayNameFrom(identity) : String(formData.get("name") ?? "").trim();
  const identityUpdate = hasIdentity
    ? {
        nationality: identity.nationality,
        name_ko: identity.nameKo || null,
        name_ja: identity.nameJa || null,
        name_en: identity.nameEn,
        name_katakana: identity.nameKatakana,
      }
    : {};
  const birthDate = String(formData.get("birthDate") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim();
  const preferredLanguage = String(formData.get("preferredLanguage") ?? "");

  if (!name || !isLocale(preferredLanguage)) {
    toAccountRedirect(mode, "error=missing_profile_fields");
  }

  if (!phoneNumber) {
    toAccountRedirect(mode, "error=missing_profile_fields");
  }

  if (!isProfileGender(gender)) {
    toAccountRedirect(mode, "error=missing_gender");
  }

  if (!isValidPhone(phoneNumber)) {
    toAccountRedirect(mode, "error=phone_invalid");
  }

  if (birthDate && !isValidBirthDate(birthDate)) {
    toAccountRedirect(mode, "error=missing_birth_date");
  }

  const { error } = await getSupabaseServiceClient()
    .from("profiles")
    .update({
      name,
      ...identityUpdate,
      gender,
      ...(birthDate ? { birth_date: birthDate } : {}),
      phone_number: phoneNumber,
      preferred_language: preferredLanguage,
    })
    .eq("id", user.id);

  if (error) {
    if (
      error.code === "23505" ||
      error.message.toLowerCase().includes("profiles_phone_number_unique")
    ) {
      toAccountRedirect(mode, "error=phone_duplicate");
    }
    toAccountRedirect(mode, "error=profile_failed");
  }

  revalidatePath("/", "layout");
  toAccountRedirect(mode, "saved=1");
}

/**
 * Persist the user's customized mobile bottom-bar tabs.
 * Called from the mobile shell's "edit bottom bar" sheet. Returns a small
 * result object instead of redirecting, so the client can update optimistically.
 */
export async function updateBottomNavTabs(
  tabIds: string[],
): Promise<{ ok: boolean; tabs: string[] }> {
  const sanitized = sanitizeBottomNavTabIds(tabIds ?? []);

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, tabs: sanitized };
  }

  const { error } = await getSupabaseServiceClient()
    .from("profiles")
    .update({ bottom_nav_tabs: sanitized })
    .eq("id", user.id);

  if (error) {
    return { ok: false, tabs: sanitized };
  }

  revalidatePath("/", "layout");
  return { ok: true, tabs: sanitized };
}
