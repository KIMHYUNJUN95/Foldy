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
import { isProfileGender, isValidBirthDate, isValidPhone, type ProfileGender } from "@/lib/onboarding";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { mustWrite } from "@/lib/db-write-guard";

export type DeleteAccountResult = { error: "last_owner" | "delete_failed" };

/** 이 사용자가 활성 대표(owner)인 조직 중, 본인 말고 활성 대표가 없는 조직이 있는가. 읽기 실패면 null. */
async function isLastActiveOwnerSomewhere(userId: string): Promise<boolean | null> {
  const service = getSupabaseServiceClient();
  const { data: owned, error } = await service
    .from("memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .eq("status", "active");
  if (error) return null;
  for (const row of (owned ?? []) as { organization_id: string }[]) {
    const { count, error: countError } = await service
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", row.organization_id)
      .eq("role", "owner")
      .eq("status", "active")
      .neq("user_id", userId);
    if (countError) return null;
    if ((count ?? 0) === 0) return true;
  }
  return false;
}

/**
 * 회원 탈퇴. 성공하면 로그인 화면으로 보낸다(redirect). 실패하면 **결과를 돌려준다**(2026-11-11) — 화면(delete-account-sheet)이
 * `last_owner` 는 전용 문구, 그 밖은 일반 실패 문구로 보여 준다.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const service = getSupabaseServiceClient();

  // 어느 조직의 마지막 활성 대표면 탈퇴를 막는다(2026-11-11) — 아래 멤버십 「removed」 처리로 대표가 0 명인 조직이 생긴다.
  // DB 트리거(202611110003 `enforce_last_active_owner`)도 같은 경우를 막지만, 그 전에 묘비 처리가 끝나 버리므로 여기서 먼저 본다.
  const lastOwner = await isLastActiveOwnerSomewhere(user.id);
  if (lastOwner === null) return { error: "delete_failed" };
  if (lastOwner) return { error: "last_owner" };

  // 프로필을 묘비 처리: 개인정보를 지우고 삭제됨으로 표시한다.
  // 운영 기록(출퇴근, 청소, 할 일)이 남도록
  // user_id FK 를 유지하고 깨지지 않고 "탈퇴한 사용자" 로 표시된다.
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
  if (!tombstoned) return { error: "delete_failed" };

  // 모든 조직 멤버십에서 제거해 명단에 더는 나타나지 않게 한다.
  const { error: removeError } = await service.from("memberships").update({ status: "removed" }).eq("user_id", user.id);
  if (removeError) {
    console.error("[account delete] membership removal failed", removeError.message);
    return { error: removeError.message?.includes("last_owner") ? "last_owner" : "delete_failed" };
  }

  // 플랫폼 개발자 권한을 끈다(2026-11-11) — 로그인 계정이 지워져도 platform_admins 행은 profiles 에 묶여 남아(profiles 는 지우지 않는다)
  // 「활성 개발자」로 세어졌다(`is_platform_admin()` · `has_capability` 의 개발자 분기 · 화면의 개발자 표시 · 사용자 관리의 보호 대상 판정).
  // 첫 개발자 등록 판정(`claim_first_platform_admin` · 온보딩 개수)은 활성 여부와 무관하게 **행이 하나라도 있으면** 막으므로
  // 이 처리로 바뀌지 않는다 — 개발자가 탈퇴해도 아무나 「첫 개발자」가 될 수는 없다.
  const platformOff = await mustWrite(
    "account delete: platform admin deactivate",
    service.from("platform_admins").update({ is_active: false }).eq("user_id", user.id),
  );
  if (!platformOff) return { error: "delete_failed" };

  // auth 사용자를 하드 삭제 — 이메일을 재가입에 쓸 수 있게 풀어 준다.
  // ON DELETE CASCADE FK 를 없앴으므로 profiles 행은 남는다.
  // 결과를 본다(2026-11-11) — 실패를 무시하고 로그인 화면으로 보내면 「탈퇴됐다」고 믿지만 로그인 계정은 살아 있다. 위 쓰기는 다시 해도
  // 같은 결과라 재시도하면 된다.
  const { error: deleteError } = await service.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("[account delete] auth deleteUser failed", deleteError.message);
    return { error: "delete_failed" };
  }

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
        name_en: identity.nameEn || null,
        name_katakana: identity.nameKatakana,
      }
    : {};
  const birthDate = String(formData.get("birthDate") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim();
  const preferredLanguage = String(formData.get("preferredLanguage") ?? "");

  if (!isLocale(preferredLanguage)) {
    toAccountRedirect(mode, "error=missing_profile_fields");
  }

  // **바뀐 칸만 검사 · 저장한다**(2026-11-11). 모바일 계정 화면은 한 칸씩 고치며 나머지 칸을 지금 값 그대로 같이 보낸다 — 예전
  // 형식으로 저장된 전화(하이픈 없음 등)나 비어 있는 성별이 있으면 언어만 바꿔도 「전화 형식이 틀렸다」로 막혔다. 지금 값과 같은
  // 칸은 사용자가 고친 게 아니므로 다시 검사하지 않고 덮어쓰지도 않는다.
  const service = getSupabaseServiceClient();
  const { data: currentRow, error: currentError } = await service
    .from("profiles")
    .select("name, phone_number, gender, birth_date")
    .eq("id", user.id)
    .maybeSingle();
  if (currentError || !currentRow) {
    toAccountRedirect(mode, "error=profile_failed");
  }
  const current = currentRow as { name: string | null; phone_number: string | null; gender: string | null; birth_date: string | null };
  const nameChanged = name !== (current.name ?? "");
  const phoneChanged = phoneNumber !== (current.phone_number ?? "");
  const genderChanged = gender !== (current.gender ?? "");
  const birthChanged = Boolean(birthDate) && birthDate !== (current.birth_date ?? "");

  if (nameChanged && !name) {
    toAccountRedirect(mode, "error=missing_profile_fields");
  }

  if (phoneChanged && !phoneNumber) {
    toAccountRedirect(mode, "error=missing_profile_fields");
  }

  if (genderChanged && !isProfileGender(gender)) {
    toAccountRedirect(mode, "error=missing_gender");
  }

  if (phoneChanged && !isValidPhone(phoneNumber)) {
    toAccountRedirect(mode, "error=phone_invalid");
  }

  if (birthChanged && !isValidBirthDate(birthDate)) {
    toAccountRedirect(mode, "error=missing_birth_date");
  }

  const { error } = await service
    .from("profiles")
    .update({
      ...(nameChanged ? { name } : {}),
      ...identityUpdate,
      ...(genderChanged ? { gender: gender as ProfileGender } : {}),
      ...(birthChanged ? { birth_date: birthDate } : {}),
      ...(phoneChanged ? { phone_number: phoneNumber } : {}),
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
 * 언어만 바꾼다 — **결과를 돌려준다**(2026-11-11). 모바일 계정 화면의 언어 3칸이 쓴다. 전에는 `updateAccountProfile`(redirect)로
 * 저장해, 화면이 주소에 남은 예전 `?error=` 를 보고 성공한 저장까지 되돌렸다. 언어 말고 다른 칸은 건드리지도 검사하지도 않는다
 * (`updateAccountProfile` 의 「바뀐 칸만」 규칙에서 바뀐 칸이 언어 하나인 경우와 같다).
 */
export async function updateAccountLanguage(
  language: string,
): Promise<{ ok: true } | { ok: false; error: "unauthenticated" | "invalid_language" | "profile_failed" }> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (!isLocale(language)) return { ok: false, error: "invalid_language" };

  const { data, error } = await getSupabaseServiceClient()
    .from("profiles")
    .update({ preferred_language: language })
    .eq("id", user.id)
    .select("id");
  if (error || ((data ?? []) as unknown[]).length === 0) return { ok: false, error: "profile_failed" };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * 사용자가 편집한 모바일 하단 바 탭을 저장한다.
 * 모바일 셸의 "하단 바 편집" 시트에서 호출한다. 리다이렉트하지 않고 작은
 * 결과 객체를 돌려주므로, 클라이언트가 낙관적으로 갱신할 수 있다.
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
