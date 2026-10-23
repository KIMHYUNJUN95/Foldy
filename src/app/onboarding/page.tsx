import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { InviteCodeFieldCopy } from "@/app/onboarding/invite-code-field";
import { DesktopOnboarding } from "@/app/onboarding/desktop-onboarding";
import { OnboardingWizard } from "@/app/onboarding/onboarding-wizard";
import { getDictionary, resolvePreSessionLocale, type Locale } from "@/lib/i18n";
import { getDeviceSurfaceFromHeaders } from "@/lib/mobile-device";
import { getOnboardingState } from "@/lib/onboarding";
import { normalizeNextPathForSurface, normalizePathForSurface } from "@/lib/surface-routing";

const LOCALE_COOKIE = "stayops_locale";

type OnboardingPageProps = {
  searchParams: Promise<{
    error?: string;
    lang?: string;
    next?: string;
    rejoin?: string;
  }>;
};


export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const [state, params, cookieStore, headerStore] = await Promise.all([
    getOnboardingState(),
    searchParams,
    cookies(),
    headers(),
  ]);
  const surface = getDeviceSurfaceFromHeaders(headerStore);

  // ?lang= → stayops_locale 쿠키 → Accept-Language(지원하지 않는 언어는 en) — 틀린 값은 다음 단계로.
  const queryLocale: Locale = resolvePreSessionLocale({
    query: params.lang,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  const safeNext = normalizeNextPathForSurface(params.next, surface);
  const allowRejoin = state.status === "removed" && params.rejoin === "1";
  const joinProfile =
    state.status === "needs_membership" || state.status === "removed"
      ? state.profile
      : null;
  const blockedLocale: Locale =
    state.status === "suspended" || state.status === "removed"
      ? state.profile.preferredLanguage
      : queryLocale;

  if (state.status === "ready") {
    // Honour `safeNext` when present (e.g. user was mid-flow when session
    // expired, or was redirected here after Google OAuth). Fall back to the
    // role-appropriate default route.
    redirect(safeNext || normalizePathForSurface(state.redirectTo, surface));
  }

  if (state.status === "unauthenticated") {
    const onboardingNext = `/onboarding?lang=${queryLocale}${safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""}`;
    redirect(
      `/auth/login?next=${encodeURIComponent(onboardingNext)}&lang=${queryLocale}`,
    );
  }

  if (
    state.status === "suspended" ||
    (state.status === "removed" && !allowRejoin) ||
    state.status === "disabled"
  ) {
    const blockedParams = new URLSearchParams({
      view: "blocked",
      mode: state.status,
      lang: blockedLocale,
    });
    if (safeNext) blockedParams.set("next", safeNext);
    const blockedEmail =
      state.status === "disabled" ? state.email : state.user.email ?? "";
    if (blockedEmail) blockedParams.set("email", blockedEmail);
    redirect(`/auth/login?${blockedParams.toString()}`);
  }

  const locale: Locale =
    joinProfile && (state.status === "needs_membership" || allowRejoin)
      ? joinProfile.preferredLanguage
      : queryLocale;
  const dictionary = getDictionary(locale);
  const errorMessage = params.error
    ? (dictionary.onboarding.errors[params.error] ?? params.error)
    : null;

  const o = dictionary.onboarding;
  const inviteCopy: InviteCodeFieldCopy = {
    label: o.inviteCodePlaceholder,
    placeholder: o.inviteCodePlaceholder,
    hint: o.inviteCodeHint,
    verifyCta: o.verifyInviteCta,
    verifiedBadge: o.inviteVerifiedBadge,
    orgLabel: o.previewOrgLabel,
    roleLabel: o.previewRoleLabel,
    changeCode: o.changeInviteCode,
    errors: o.errors,
    roleCategories: o.roleCategories,
  };

  /*
   * ── 대시보드(PC) 전용 가입 화면(2026-10-01) ─────────────────────────────────────
   *
   * PC 에서는 모바일 마법사(한 화면 한 질문 · 휠 피커 · 하단 시트)가 아니라 한 화면 폼을 그린다.
   * **기기 표면이 `desktop` 일 때만**이다 — 모바일 · 판별 불가는 아래 마법사 그대로라 두 화면이 섞이지 않는다.
   */
  if (surface === "desktop" && (state.status === "needs_profile" || (joinProfile && (state.status === "needs_membership" || allowRejoin)))) {
    const d = o.desktop;
    const c = dictionary.auth.console;
    const membership = state.status !== "needs_profile";
    return (
      <DesktopOnboarding
        allowInviteSkip={!membership}
        identityCopy={o.identity}
        copy={{
          brandRole: c.role,
          brandHead: d.brandHead,
          brandLede: d.brandLede,
          brandFoot: [c.foot1, c.foot2, c.foot3],
          railAccount: d.railAccount,
          railProfile: d.railProfile,
          railProfileSub: d.railProfileSub,
          railJoin: d.railJoin,
          railJoinSub: d.railJoinSub,
          railStart: d.railStart,
          railStartSub: d.railStartSub,
          eyebrow: membership ? o.joinFlow.inviteEyebrow : d.eyebrow,
          title: d.title,
          lede: d.lede,
          joinTitle: d.joinTitle,
          joinLede: errorMessage ?? (joinProfile ? o.joinBody(joinProfile.name) : o.joinFlow.inviteSubtitle),
          basicsTitle: o.steps.basicsEyebrow,
          inviteTitle: o.joinFlow.inviteEyebrow,
          inviteHint: d.inviteHint,
          nameLabel: o.steps.nameLabel,
          nameHint: o.steps.nameHint,
          dobLabel: o.review.rowDob,
          dobYear: o.steps.dobYearLabel,
          dobMonth: o.steps.dobMonthLabel,
          dobDay: o.steps.dobDayLabel,
          dobHint: o.steps.dobHint,
          dobInvalid: d.dobInvalid,
          genderLabel: o.steps.genderLabel,
          genderOptions: o.genderOptions,
          phoneLabel: o.steps.phoneNumLabel,
          phonePlaceholder: o.steps.phoneInputPlaceholder,
          phoneHint: o.steps.phoneHint,
          phoneDuplicateHelp: o.phoneDuplicateHelp,
          countrySearch: d.countrySearch,
          countryEmpty: d.countryEmpty,
          countries: o.countries,
          codePlaceholder: o.inviteCodePlaceholder,
          caseHint: o.joinFlow.caseHint,
          verifyCta: o.joinFlow.verifyCta,
          checking: o.joinFlow.checking,
          verified: o.joinFlow.verified,
          orgLabel: o.previewOrgLabel,
          roleLabel: o.joinFlow.roleLabel,
          roleCategories: o.roleCategories,
          skip: o.joinFlow.skip,
          submit: o.review.submit,
          exit: dictionary.auth.blocked.logout,
          nameRequired: d.nameRequired,
          genderRequired: d.genderRequired,
          phoneRequired: d.phoneRequired,
          inviteVerifyFirst: d.inviteVerifyFirst,
          errors: o.errors,
          successEyebrow: o.success.eyebrow,
          welcomePrefix: o.success.welcomePrefix,
          welcomeSuffix: o.success.welcomeSuffix,
          bodyJoined: o.success.bodyJoined,
          bodyNoTeam: o.success.bodyNoTeam,
          startCta: o.success.startCta,
        }}
        initialError={membership ? null : errorMessage}
        initialBirthDate={joinProfile?.birthDate ?? ""}
        initialGender={joinProfile?.gender ?? ""}
        initialName={joinProfile?.name ?? ""}
        initialPhone={joinProfile?.phoneNumber}
        locale={locale}
        mode={membership ? "membership" : "profile"}
        safeNext={safeNext}
      />
    );
  }

  // ── needs_profile → multi-step wizard (Profile Setup redesign) ──────────────
  if (state.status === "needs_profile") {
    return (
      <OnboardingWizard
        intro={{
          title: o.intro.title,
          subtitle: o.intro.subtitle,
          itemBasicsTitle: o.intro.itemBasicsTitle,
          itemBasicsSub: o.intro.itemBasicsSub,
          itemLangTitle: o.intro.itemLangTitle,
          itemLangSub: o.intro.itemLangSub,
          itemInviteTitle: o.intro.itemInviteTitle,
          itemInviteSub: o.intro.itemInviteSub,
          startCta: o.intro.startCta,
        }}
        steps={{
          basicsEyebrow: o.steps.basicsEyebrow,
          continueCta: o.steps.continueCta,
          nameTitle: o.steps.nameTitle,
          nameSubtitle: o.steps.nameSubtitle,
          nameLabel: o.steps.nameLabel,
          nameHint: o.steps.nameHint,
          dobTitle: o.steps.dobTitle,
          dobSubtitle: o.steps.dobSubtitle,
          dobYearLabel: o.steps.dobYearLabel,
          dobMonthLabel: o.steps.dobMonthLabel,
          dobDayLabel: o.steps.dobDayLabel,
          dobYearPlaceholder: o.steps.dobYearPlaceholder,
          dobMonthPlaceholder: o.steps.dobMonthPlaceholder,
          dobDayPlaceholder: o.steps.dobDayPlaceholder,
          dobHint: o.steps.dobHint,
          dobSheetTitle: o.steps.dobSheetTitle,
          dobConfirm: o.steps.dobConfirm,
          genderTitle: o.steps.genderTitle,
          genderSubtitle: o.steps.genderSubtitle,
          genderLabel: o.steps.genderLabel,
          genderHint: o.steps.genderHint,
          genderOptions: o.genderOptions,
          phoneTitle: o.steps.phoneTitle,
          phoneSubtitle: o.steps.phoneSubtitle,
          phoneNumLabel: o.steps.phoneNumLabel,
          phoneInputPlaceholder: o.steps.phoneInputPlaceholder,
          phoneHint: o.steps.phoneHint,
          phoneCountrySheetTitle: o.steps.phoneCountrySheetTitle,
          phoneDuplicateHelp: o.phoneDuplicateHelp,
          backCta: o.steps.backCta,
        }}
        countries={o.countries}
        identity={o.identity}
        join={{
          inviteEyebrow: o.joinFlow.inviteEyebrow,
          inviteTitle: o.joinFlow.inviteTitle,
          inviteSubtitle: o.joinFlow.inviteSubtitle,
          caseHint: o.joinFlow.caseHint,
          verifyCta: o.joinFlow.verifyCta,
          checking: o.joinFlow.checking,
          skip: o.joinFlow.skip,
          invalidTitle: o.joinFlow.invalidTitle,
          confirmEyebrow: o.joinFlow.confirmEyebrow,
          confirmTitle: o.joinFlow.confirmTitle,
          confirmSubtitle: o.joinFlow.confirmSubtitle,
          roleLabel: o.joinFlow.roleLabel,
          verified: o.joinFlow.verified,
          reviewCta: o.joinFlow.reviewCta,
          submitCta: o.joinTeamCta,
          codePlaceholder: o.inviteCodePlaceholder,
          orgLabel: o.previewOrgLabel,
          errors: o.errors,
          roleCategories: o.roleCategories,
        }}
        review={{
          title: o.review.title,
          subtitle: o.review.subtitle,
          rowName: o.review.rowName,
          rowDob: o.review.rowDob,
          rowGender: o.review.rowGender,
          rowPhone: o.review.rowPhone,
          rowLang: o.review.rowLang,
          rowOrg: o.review.rowOrg,
          rowRole: o.review.rowRole,
          edit: o.review.edit,
          infoTitle: o.review.infoTitle,
          infoBody: o.review.infoBody,
          submit: o.review.submit,
        }}
        success={{
          eyebrow: o.success.eyebrow,
          welcomePrefix: o.success.welcomePrefix,
          welcomeSuffix: o.success.welcomeSuffix,
          bodyJoined: o.success.bodyJoined,
          bodyNoTeam: o.success.bodyNoTeam,
          startCta: o.success.startCta,
        }}
        exit={{
          backToLogin: dictionary.auth.email.resetSentBackToLogin,
        }}
        languageName={dictionary.languages[locale]}
        profile={{
          copy: {
            nameLabel: o.fullNamePlaceholder,
            namePlaceholder: o.fullNamePlaceholder,
            birthDateLabel: o.birthDateLabel,
            birthDatePlaceholder: o.birthDatePlaceholder,
            birthDateHint: o.birthDateHint,
            genderLabel: o.genderLabel,
            genderPlaceholder: o.genderPlaceholder,
            genderOptions: o.genderOptions,
            phoneLabel: o.phonePlaceholder,
            phonePlaceholder: o.phonePlaceholder,
            phoneHint: o.phoneHint,
            languageLabel: dictionary.auth.languageSelector,
            languages: dictionary.languages,
            continueCta: o.saveProfile,
            joinTeamCta: o.joinTeamCta,
            invite: inviteCopy,
          },
          locale,
          safeNext,
          initialName: "",
          initialBirthDate: "",
          initialGender: "",
          initialPhone: "",
        }}
        showExitToLogin
      />
    );
  }

  if (joinProfile && (state.status === "needs_membership" || allowRejoin)) {
    return (
      <OnboardingWizard
        intro={{
          title: o.intro.title,
          subtitle: o.intro.subtitle,
          itemBasicsTitle: o.intro.itemBasicsTitle,
          itemBasicsSub: o.intro.itemBasicsSub,
          itemLangTitle: o.intro.itemLangTitle,
          itemLangSub: o.intro.itemLangSub,
          itemInviteTitle: o.intro.itemInviteTitle,
          itemInviteSub: o.intro.itemInviteSub,
          startCta: o.intro.startCta,
        }}
        steps={{
          basicsEyebrow: o.steps.basicsEyebrow,
          continueCta: o.steps.continueCta,
          nameTitle: o.steps.nameTitle,
          nameSubtitle: o.steps.nameSubtitle,
          nameLabel: o.steps.nameLabel,
          nameHint: o.steps.nameHint,
          dobTitle: o.steps.dobTitle,
          dobSubtitle: o.steps.dobSubtitle,
          dobYearLabel: o.steps.dobYearLabel,
          dobMonthLabel: o.steps.dobMonthLabel,
          dobDayLabel: o.steps.dobDayLabel,
          dobYearPlaceholder: o.steps.dobYearPlaceholder,
          dobMonthPlaceholder: o.steps.dobMonthPlaceholder,
          dobDayPlaceholder: o.steps.dobDayPlaceholder,
          dobHint: o.steps.dobHint,
          dobSheetTitle: o.steps.dobSheetTitle,
          dobConfirm: o.steps.dobConfirm,
          genderTitle: o.steps.genderTitle,
          genderSubtitle: o.steps.genderSubtitle,
          genderLabel: o.steps.genderLabel,
          genderHint: o.steps.genderHint,
          genderOptions: o.genderOptions,
          phoneTitle: o.steps.phoneTitle,
          phoneSubtitle: o.steps.phoneSubtitle,
          phoneNumLabel: o.steps.phoneNumLabel,
          phoneInputPlaceholder: o.steps.phoneInputPlaceholder,
          phoneHint: o.steps.phoneHint,
          phoneCountrySheetTitle: o.steps.phoneCountrySheetTitle,
          phoneDuplicateHelp: o.phoneDuplicateHelp,
          backCta: o.steps.backCta,
        }}
        countries={o.countries}
        identity={o.identity}
        join={{
          inviteEyebrow: o.joinFlow.inviteEyebrow,
          inviteTitle: o.joinFlow.inviteTitle,
          inviteSubtitle: errorMessage ?? o.joinBody(joinProfile.name),
          caseHint: o.joinFlow.caseHint,
          verifyCta: o.joinFlow.verifyCta,
          checking: o.joinFlow.checking,
          skip: o.joinFlow.skip,
          invalidTitle: o.joinFlow.invalidTitle,
          confirmEyebrow: o.joinFlow.confirmEyebrow,
          confirmTitle: o.joinFlow.confirmTitle,
          confirmSubtitle: o.joinFlow.confirmSubtitle,
          roleLabel: o.joinFlow.roleLabel,
          verified: o.joinFlow.verified,
          reviewCta: o.joinFlow.reviewCta,
          submitCta: o.joinTeamCta,
          codePlaceholder: o.inviteCodePlaceholder,
          orgLabel: o.previewOrgLabel,
          errors: o.errors,
          roleCategories: o.roleCategories,
        }}
        review={{
          title: o.review.title,
          subtitle: o.review.subtitle,
          rowName: o.review.rowName,
          rowDob: o.review.rowDob,
          rowGender: o.review.rowGender,
          rowPhone: o.review.rowPhone,
          rowLang: o.review.rowLang,
          rowOrg: o.review.rowOrg,
          rowRole: o.review.rowRole,
          edit: o.review.edit,
          infoTitle: o.review.infoTitle,
          infoBody: o.review.infoBody,
          submit: o.review.submit,
        }}
        success={{
          eyebrow: o.success.eyebrow,
          welcomePrefix: o.success.welcomePrefix,
          welcomeSuffix: o.success.welcomeSuffix,
          bodyJoined: o.success.bodyJoined,
          bodyNoTeam: o.success.bodyNoTeam,
          startCta: o.success.startCta,
        }}
        exit={{
          backToLogin: dictionary.auth.email.resetSentBackToLogin,
        }}
        languageName={dictionary.languages[locale]}
        profile={{
          copy: {
            nameLabel: o.fullNamePlaceholder,
            namePlaceholder: o.fullNamePlaceholder,
            birthDateLabel: o.birthDateLabel,
            birthDatePlaceholder: o.birthDatePlaceholder,
            birthDateHint: o.birthDateHint,
            genderLabel: o.genderLabel,
            genderPlaceholder: o.genderPlaceholder,
            genderOptions: o.genderOptions,
            phoneLabel: o.phonePlaceholder,
            phonePlaceholder: o.phonePlaceholder,
            phoneHint: o.phoneHint,
            languageLabel: dictionary.auth.languageSelector,
            languages: dictionary.languages,
            continueCta: o.saveProfile,
            joinTeamCta: o.joinTeamCta,
            invite: inviteCopy,
          },
          locale,
          safeNext,
          initialName: joinProfile.name,
          initialBirthDate: joinProfile.birthDate ?? "",
          initialGender: joinProfile.gender ?? "",
          initialPhone: joinProfile.phoneNumber,
        }}
        initialStep={5}
        allowInviteSkip={false}
        showExitToLogin
      />
    );
  }

  return null;
}
