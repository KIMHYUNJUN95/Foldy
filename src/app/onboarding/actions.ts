"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { roleToInviteCategory } from "@/config/roles";
import { validateInviteCode } from "@/lib/auth-invite";
import { getDeviceSurfaceFromHeaders, type DeviceSurface } from "@/lib/mobile-device";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  getDefaultRouteForRole,
  getOnboardingState,
  isProfileGender,
  isValidBirthDate,
  isValidPhone,
  setLastUsedOrganization,
} from "@/lib/onboarding";
import { isLocale } from "@/lib/i18n";
import {
  displayNameFrom,
  normalizeIdentityNames,
  validateIdentityNames,
  type IdentityErrorKey,
  type IdentityField,
  type IdentityNames,
} from "@/lib/identity-names";
import { resolveInviteRpcError } from "@/lib/invite-errors";
import { normalizeNextPathForSurface, normalizePathForSurface } from "@/lib/surface-routing";
import type { Database } from "@/types/database";

type PlatformAdminInsert =
  Database["public"]["Tables"]["platform_admins"]["Insert"];
type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];

// The project's database.ts omits Relationships on all tables, which prevents
// Database["public"] from satisfying GenericSchema. service.from() has an untyped
// fallback overload so it works anyway, but service.rpc() does not. This interface
// provides just enough typing for the one RPC call we make.
type JoinRpcRow = {
  organization_id: string;
  role: Database["public"]["Enums"]["organization_role"];
  status: string;
};
type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: JoinRpcRow[] | null; error: { message: string } | null }>;
};

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function sanitizeNext(value: FormDataEntryValue | null, surface: DeviceSurface): string {
  return normalizeNextPathForSurface(cleanText(value), surface);
}

function normalizeInviteCode(value: FormDataEntryValue | null) {
  return cleanText(value).toUpperCase();
}

/** Redirects to /onboarding with an error key, preserving a safe `next` path if present. */
function onboardingError(errorKey: string, next: string): never {
  const nextSuffix = next ? `&next=${encodeURIComponent(next)}` : "";
  redirect(`/onboarding?error=${errorKey}${nextSuffix}`);
}

async function requireUser() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return user;
}

async function getCurrentSurface() {
  return getDeviceSurfaceFromHeaders(await headers());
}

/**
 * Validates an invite code WITHOUT consuming it and resolves the target
 * organization name + user-facing role category, so onboarding can show the
 * "조직·역할 미리보기" confirmation before the user commits to joining.
 *
 * Returns serializable data (callable directly from a client component).
 * Error keys map onto `onboarding.errors.*` i18n keys.
 */
type InvitePreviewResult =
  | { ok: true; organizationName: string; roleCategory: string }
  | { ok: false; errorKey: string };

const INVITE_PREVIEW_ERROR_MAP: Record<string, string> = {
  invalid: "invalid_invite",
  expired: "invite_expired",
  inactive: "invite_inactive",
  maxed_out: "invite_maxed",
};

export async function previewInviteCode(
  code: string,
): Promise<InvitePreviewResult> {
  // Require an authenticated onboarding user so this is not an open
  // invite-probing endpoint.
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, errorKey: "profile_required" };

  const trimmed = code.trim();
  if (!trimmed) return { ok: false, errorKey: "missing_invite" };

  const validation = await validateInviteCode(trimmed);
  if (!validation.ok) {
    return {
      ok: false,
      errorKey: INVITE_PREVIEW_ERROR_MAP[validation.error] ?? "invalid_invite",
    };
  }

  const service = getSupabaseServiceClient();
  const { data: org } = await service
    .from("organizations")
    .select("name")
    .eq("id", validation.organizationId)
    .maybeSingle();

  const organizationName = (org as { name: string } | null)?.name ?? "";
  // Expose the user-facing invite category (e.g. "office_staff"), not the raw
  // DB role slug. cs_staff (not an invite category) falls back to its slug.
  const roleCategory =
    roleToInviteCategory[validation.defaultRole] ?? validation.defaultRole;

  return { ok: true, organizationName, roleCategory };
}

async function joinInviteCode(userId: string, code: string, next: string) {
  if (!code) {
    return null;
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await (service as unknown as RpcClient).rpc(
    "join_organization_with_invite_code",
    { p_user_id: userId, p_code: code },
  );

  if (error) {
    onboardingError(resolveInviteRpcError(error.message), next);
  }

  const row = data?.[0];
  if (!row) onboardingError("invite_join_failed", next);

  return row;
}

export async function completeProfile(formData: FormData) {
  const user = await requireUser();
  const surface = await getCurrentSurface();
  const next = sanitizeNext(formData.get("next"), surface);
  const name = cleanText(formData.get("name"));
  const birthDate = cleanText(formData.get("birthDate"));
  const gender = cleanText(formData.get("gender"));
  const phoneNumber = cleanText(formData.get("phoneNumber"));
  const preferredLanguage = cleanText(formData.get("preferredLanguage"));
  const inviteCode = normalizeInviteCode(formData.get("inviteCode"));

  if (!name || !phoneNumber) {
    onboardingError("missing_profile_fields", next);
  }

  if (!birthDate || !isValidBirthDate(birthDate)) {
    onboardingError("missing_birth_date", next);
  }

  if (!isProfileGender(gender)) {
    onboardingError("missing_gender", next);
  }

  if (!isValidPhone(phoneNumber)) {
    onboardingError("phone_invalid", next);
  }

  if (!isLocale(preferredLanguage)) {
    onboardingError("invalid_language", next);
  }

  const service = getSupabaseServiceClient();
  const profile: ProfileInsert = {
    id: user.id,
    name,
    birth_date: birthDate,
    gender,
    phone_number: phoneNumber,
    preferred_language: preferredLanguage,
  };

  const { error } = await service.from("profiles").upsert(profile);

  if (error) {
    if (
      error.code === "23505" ||
      error.message.toLowerCase().includes("profiles_phone_number_unique")
    ) {
      onboardingError("phone_duplicate", next);
    }
    onboardingError("profile_failed", next);
  }

  const membership = await joinInviteCode(user.id, inviteCode, next);

  if (membership) {
    await setLastUsedOrganization(user.id, membership.organization_id);
    redirect(next || normalizePathForSurface(getDefaultRouteForRole(membership.role), surface));
  }

  // No invite code submitted — needs membership step. Preserve next for the join form.
  redirect(next ? `/onboarding?next=${encodeURIComponent(next)}` : "/onboarding");
}

export async function joinOrganizationWithInviteCode(formData: FormData) {
  const user = await requireUser();
  const surface = await getCurrentSurface();
  const next = sanitizeNext(formData.get("next"), surface);
  const inviteCode = normalizeInviteCode(formData.get("inviteCode"));

  if (!inviteCode) {
    onboardingError("missing_invite", next);
  }

  const membership = await joinInviteCode(user.id, inviteCode, next);
  if (membership) {
    await setLastUsedOrganization(user.id, membership.organization_id);
  }
  redirect(
    next || normalizePathForSurface(getDefaultRouteForRole(membership?.role ?? "staff"), surface),
  );
}

export async function claimFirstPlatformAdmin() {
  const user = await requireUser();
  const service = getSupabaseServiceClient();

  const [{ data: profile }, { count }] = await Promise.all([
    service.from("profiles").select("id").eq("id", user.id).maybeSingle(),
    service
      .from("platform_admins")
      .select("id", { count: "exact", head: true }),
  ]);

  if (!profile) {
    redirect("/onboarding?error=profile_required");
  }

  if ((count ?? 0) > 0) {
    redirect("/onboarding?error=platform_admin_exists");
  }

  const platformAdmin: PlatformAdminInsert = {
    is_active: true,
    role: "developer_super_admin",
    user_id: user.id,
  };

  const { error } = await service
    .from("platform_admins")
    .insert(platformAdmin);

  if (error) {
    redirect("/onboarding?error=platform_admin_failed");
  }

  redirect("/admin");
}

export type SubmitOnboardingResult =
  | { ok: true; redirectTo: string }
  | {
      ok: false;
      errorKey: string;
      /** errorKey === "identity_invalid" 일 때 칸별 오류 — 국적 · 이름 세 가지. */
      fieldErrors?: Partial<Record<IdentityField, IdentityErrorKey>>;
    };

/**
 * needs_membership wizard submit — joins via invite code only (profile already exists).
 * Returns a destination instead of redirecting so the wizard can show its success screen.
 */
export async function joinWithInviteCode(input: {
  inviteCode: string;
  next: string;
}): Promise<SubmitOnboardingResult> {
  const user = await requireUser();
  const surface = await getCurrentSurface();
  const code = input.inviteCode.trim().toUpperCase();
  const next = normalizeNextPathForSurface(input.next, surface);

  if (!code) return { ok: false, errorKey: "missing_invite" };

  const service = getSupabaseServiceClient();
  const { data, error } = await (service as unknown as RpcClient).rpc(
    "join_organization_with_invite_code",
    { p_user_id: user.id, p_code: code },
  );
  if (error) return { ok: false, errorKey: resolveInviteRpcError(error.message) };
  const row = data?.[0];
  if (!row) return { ok: false, errorKey: "invite_join_failed" };
  await setLastUsedOrganization(user.id, row.organization_id);
  return {
    ok: true,
    redirectTo: next || normalizePathForSurface(getDefaultRouteForRole(row.role), surface),
  };
}

/**
 * Wizard submit — upserts the profile and (optionally) joins via invite code,
 * then RETURNS the destination instead of redirecting. This lets the onboarding
 * wizard show its own "welcome / success" screen before entering the app.
 */
export async function submitOnboardingProfile(input: {
  /** 국적 + 한국어 · 일본어 · 영문 · 가타카나 이름 — 앱에 보이는 이름은 여기서 만든다. */
  identity: IdentityNames;
  birthDate: string;
  gender: string;
  phoneNumber: string;
  preferredLanguage: string;
  inviteCode: string;
  next: string;
}): Promise<SubmitOnboardingResult> {
  const user = await requireUser();
  const surface = await getCurrentSurface();
  const identity = normalizeIdentityNames(input.identity);
  const fieldErrors = validateIdentityNames(identity);
  const name = displayNameFrom(identity);
  const birthDate = input.birthDate.trim();
  const gender = input.gender.trim();
  const phoneNumber = input.phoneNumber.trim();
  const lang = input.preferredLanguage.trim();
  const code = input.inviteCode.trim().toUpperCase();
  const next = normalizeNextPathForSurface(input.next, surface);

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, errorKey: "identity_invalid", fieldErrors };
  }
  if (!name || !phoneNumber) return { ok: false, errorKey: "missing_profile_fields" };
  if (!birthDate || !isValidBirthDate(birthDate)) {
    return { ok: false, errorKey: "missing_birth_date" };
  }
  if (!isProfileGender(gender)) return { ok: false, errorKey: "missing_gender" };
  if (!isValidPhone(phoneNumber)) return { ok: false, errorKey: "phone_invalid" };
  if (!isLocale(lang)) return { ok: false, errorKey: "invalid_language" };

  const service = getSupabaseServiceClient();
  const profile: ProfileInsert = {
    id: user.id,
    name,
    nationality: identity.nationality,
    name_ko: identity.nameKo || null,
    name_ja: identity.nameJa || null,
    name_en: identity.nameEn,
    name_katakana: identity.nameKatakana,
    birth_date: birthDate,
    gender,
    phone_number: phoneNumber,
    preferred_language: lang,
  };

  const { error } = await service.from("profiles").upsert(profile);
  if (error) {
    if (
      error.code === "23505" ||
      error.message.toLowerCase().includes("profiles_phone_number_unique")
    ) {
      return { ok: false, errorKey: "phone_duplicate" };
    }
    return { ok: false, errorKey: "profile_failed" };
  }

  if (code) {
    const { data, error: rpcError } = await (service as unknown as RpcClient).rpc(
      "join_organization_with_invite_code",
      { p_user_id: user.id, p_code: code },
    );
    if (rpcError) return { ok: false, errorKey: resolveInviteRpcError(rpcError.message) };
    const row = data?.[0];
    if (!row) return { ok: false, errorKey: "invite_join_failed" };
    await setLastUsedOrganization(user.id, row.organization_id);
    return {
      ok: true,
      redirectTo: next || normalizePathForSurface(getDefaultRouteForRole(row.role), surface),
    };
  }

  // No invite code — re-evaluate so platform admins / existing members route in,
  // and users who still need a team land back on onboarding's join step.
  const state = await getOnboardingState();
  if (state.status === "ready") {
    return { ok: true, redirectTo: next || normalizePathForSurface(state.redirectTo, surface) };
  }
  return { ok: true, redirectTo: "/onboarding" };
}
