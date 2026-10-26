import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountSettings } from "@/components/account/account-settings";
import { AccountMobile } from "@/components/account/account-mobile";
import { AccountIdentityFields } from "@/components/account/account-identity-fields";
import { DeleteAccountSheet } from "@/components/account/delete-account-sheet";
import { BlockedUsersList } from "@/components/account/blocked-users-list";
import { MyReportsList } from "@/components/account/my-reports-list";
import { listMyBlockedUsers, listMyBoardReports } from "@/lib/board-moderation";
import { boardReasonLabel } from "@/lib/board-report-reasons";
import { GenderSegmented } from "@/components/account/gender-segmented";
import { legalHref } from "@/components/legal/legal-page-shell";
import { LanguageSegmented } from "@/components/account/language-segmented";
import { DateFormField } from "@/components/admin/shared/date-form-field";
import { AdminShell } from "@/components/shell/admin-shell";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { loadEmploymentNow } from "@/lib/payroll-settings-server";
import { loadMemberBanks } from "@/lib/payroll-bank-server";
import { getPayrollBankCopy } from "@/lib/payroll-bank-i18n";
import { tokyoToday } from "@/lib/tokyo-date";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { loadCurrentIdDocument } from "@/lib/staff-documents/server";
import { getDictionary, localizedNavigationLabels } from "@/lib/i18n";
import { resolveBottomNavItems } from "@/config/navigation";
import type { MemberBank } from "@/lib/payroll-bank";
import { adminLocaleTag } from "@/lib/admin-export-meta";
import { hasAdminWebAccess } from "@/config/capabilities";
import { updateAccountProfile } from "@/app/account/actions";
import { signOut } from "@/app/auth/actions";

type AccountPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect("/auth/login?next=/account");
  }

  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  const dictionary = getDictionary(session.user.preferredLanguage);
  const [blockedUsers, myReports] = await Promise.all([
    listMyBlockedUsers(session),
    listMyBoardReports(session),
  ]);
  const requestedMode = firstParam(params?.mode);
  const shellMode =
    requestedMode === "mobile" ||
    (requestedMode === "admin" && hasAdminWebAccess(session))
      ? requestedMode
      : session.user.preferredMode;
  const errorKey = firstParam(params?.error);
  const savedKey = firstParam(params?.saved);

  /**
   * 패널 껍데기를 공용 `Card` 로 쓰지 않는 이유: `Card` 는 `bg-surface/80` 인데
   * `admin-console.css` 가 `.adm` 안에서 `--surface` 를 중간 톤 토프로 재정의한다. 그래서 관리
   * 콘솔에서만 카드가 탁하게 보였다(2026-07-31). 두 셸에서 같게 보이도록 명시적으로 칠한다.
   */
  // `.adm` 이 `--surface` 를 재정의하던 문제는 콘솔 변수 접두어화(`--adm-*`, 2026-08-03)로
  // 해소돼, 이제 두 셸 모두에서 토큰을 그대로 쓴다.
  const surface = "bg-surface";
  const panelCard = `overflow-hidden rounded-2xl border border-border ${surface} shadow-[0_1px_2px_rgba(20,32,43,0.04)]`;
  const inputCls = surface;
  const shared = dictionary.admin.shared;
  const ap = dictionary.accountProfile;
  const profileIncomplete = !session.user.birthDate || !session.user.gender;

  const banners = (
    <>
      {savedKey && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
          {dictionary.onboarding.profileSaved}
        </div>
      )}
      {errorKey && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
          {dictionary.onboarding.errors[errorKey] ??
            dictionary.onboarding.errors.profile_failed}
        </div>
      )}
      {profileIncomplete && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-4 shadow-sm">
          <p className="text-sm font-bold text-amber-900">{ap.completionTitle}</p>
          <p className="mt-1 text-sm leading-6 text-amber-800">
            {!session.user.birthDate && !session.user.gender
              ? ap.missingBirthDateAndGenderBody
              : !session.user.birthDate
                ? ap.missingBirthDateBody
                : ap.genderMissingBody}
          </p>
        </div>
      )}
    </>
  );

  const profilePanel = (
    <div className={panelCard}>
      <div className="border-b-[0.5px] border-[var(--separator)] px-5 py-3.5">
        <span className="text-[11px] font-black uppercase tracking-[0.05em] text-muted-foreground">
          {ap.tabProfile}
        </span>
      </div>
      <form action={updateAccountProfile} className="grid gap-3.5 p-5">
        <input name="mode" type="hidden" value={shellMode} />
        {/* 신원 행 — 폼 맨 위에서 "누구의 계정을 고치는 중인지"를 먼저 보여준다. */}
        <div className="flex items-center gap-3 border-b-[0.5px] border-[var(--separator)] pb-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[15px] bg-primary text-[17px] font-extrabold text-primary-foreground">
            {session.user.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14.5px] font-extrabold tracking-[-0.02em] text-foreground">
              {session.user.name}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] font-semibold text-muted-foreground">
              {session.organization.name} ·{" "}
              {dictionary.roles[session.user.role] ?? session.user.role}
            </p>
          </div>
        </div>
        {/* 국적 + 한국어 · 영문 · 가타카나 이름(docs/product/41 §2) — 앱에 보이는 이름은 여기서 만든다. */}
        <div id="identity">
          <AccountIdentityFields
            copy={dictionary.onboarding.identity}
            initial={session.user.identity}
            locale={session.user.preferredLanguage}
            showErrors={errorKey === "identity_invalid" || session.user.identityIncomplete}
          />
        </div>
        <div className="grid gap-3.5 @2xl:grid-cols-2">
        <div className="grid gap-1.5 text-sm font-semibold">
          <span>{dictionary.onboarding.birthDateLabel}</span>
          {/* 관리 콘솔에서는 네이티브 date input 이 금지다(CLAUDE.md §4a) — 공용 `AdminDatePicker`
              를 쓴다. 다만 이 화면은 **모바일 셸에서도 열리고**(`shellMode`) `.adp` 스타일은
              `admin-console.css` 안에서 `.adm` 스코프로만 정의되므로, 모바일에서는 앱 표준 date
              input 을 그대로 쓴다(§4a 는 관리 콘솔 한정 규칙이며 모바일 입력은 iOS 정렬까지
              이미 맞춰져 있다). */}
          {shellMode === "admin" ? (
            <DateFormField
              ariaLabel={dictionary.onboarding.birthDateLabel}
              defaultValue={session.user.birthDate ?? ""}
              labels={{
                prevMonth: shared.datePrevMonth,
                nextMonth: shared.dateNextMonth,
                today: shared.dateToday,
              }}
              localeTag={adminLocaleTag(session.user.preferredLanguage)}
              name="birthDate"
              placeholder={dictionary.onboarding.birthDatePlaceholder}
            />
          ) : (
            <Input
              className={inputCls}
              defaultValue={session.user.birthDate ?? ""}
              name="birthDate"
              placeholder={dictionary.onboarding.birthDatePlaceholder}
              type="date"
            />
          )}
          <span className="text-xs font-normal text-muted-foreground">
            {dictionary.onboarding.birthDateHint}
          </span>
        </div>
        <label className="grid gap-1.5 text-sm font-semibold">
          <span>{dictionary.onboarding.phonePlaceholder}</span>
          <Input
            defaultValue={session.user.phoneNumber}
            className={inputCls}
            name="phoneNumber"
            placeholder={dictionary.onboarding.phonePlaceholder}
            required
            type="tel"
          />
          <span className="text-xs font-normal text-muted-foreground">
            {dictionary.onboarding.phoneHint}
          </span>
        </label>
        </div>
        <div className="grid gap-1.5 text-sm font-semibold">
          <span>{dictionary.onboarding.genderLabel}</span>
          <GenderSegmented
            name="gender"
            defaultValue={session.user.gender ?? ""}
            ariaLabel={dictionary.onboarding.genderLabel}
            options={[
              { code: "female", label: dictionary.onboarding.genderOptions.female },
              { code: "male", label: dictionary.onboarding.genderOptions.male },
            ]}
          />
          <span className="text-xs font-normal leading-5 text-muted-foreground">
            {ap.genderHint}
          </span>
        </div>
        <div className="grid gap-1.5 text-sm font-semibold">
          <span>{dictionary.common.language}</span>
          <LanguageSegmented
            name="preferredLanguage"
            defaultValue={session.user.preferredLanguage}
            ariaLabel={dictionary.common.language}
            options={[
              { code: "ko", label: dictionary.languages.ko },
              { code: "ja", label: dictionary.languages.ja },
              { code: "en", label: dictionary.languages.en },
            ]}
          />
        </div>
        <div className="mt-1 flex gap-2.5">
          <Button className="flex-1" type="submit">
            {dictionary.common.save}
          </Button>
          <Button
            className="w-[92px]"
            type="reset"
            variant="secondary"
          >
            {dictionary.common.cancel}
          </Button>
        </div>
      </form>
    </div>
  );

  const organizationPanel = (
    <div className={panelCard}>
      <div className="border-b-[0.5px] border-[var(--separator)] px-5 py-3.5">
        <span className="text-[11px] font-black uppercase tracking-[0.05em] text-muted-foreground">
          {ap.tabOrganization}
        </span>
      </div>
      <div className="space-y-2.5 p-5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold text-muted-foreground">
            {dictionary.admin.settings.organizationName}
          </span>
          <span className="text-sm font-bold">{session.organization.name}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold text-muted-foreground">
            {dictionary.admin.users.role}
          </span>
          <span className="text-sm font-bold">
            {dictionary.roles[session.user.role] ?? session.user.role}
          </span>
        </div>
      </div>
    </div>
  );

  // 되돌릴 수 없는 동작(계정 삭제)은 이 탭에만 둔다 — 예전에는 프로필 폼 바로 아래에 붙어 있었다.
  const securityPanel = (
    <div className="space-y-4">
      <p className="px-0.5 text-[13px] leading-6 text-muted-foreground">{ap.securityIntro}</p>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/20 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">{dictionary.common.logout}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{session.user.email}</p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="secondary">
            {dictionary.common.logout}
          </Button>
        </form>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-destructive">{dictionary.common.deleteAccount}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {dictionary.common.deleteAccountWarning}
          </p>
        </div>
        <DeleteAccountSheet
          copy={{
            cancel: dictionary.common.cancel,
            deleteAccount: dictionary.common.deleteAccount,
            deleteAccountTitle: dictionary.common.deleteAccountTitle,
            deleteAccountDesc: dictionary.common.deleteAccountDesc,
            deleteAccountWarning: dictionary.common.deleteAccountWarning,
            deleteAccountConfirm: dictionary.common.deleteAccountConfirm,
          }}
        />
      </div>
      <BlockedUsersList
        users={blockedUsers}
        copy={{
          title: dictionary.accountProfile.blockedUsersTitle,
          body: dictionary.accountProfile.blockedUsersBody,
          empty: dictionary.accountProfile.blockedUsersEmpty,
          unblock: dictionary.accountProfile.unblock,
          unknown: dictionary.board.reportsAuthorUnknown,
        }}
      />
      <MyReportsList
        reports={myReports.map((r) => ({
          id: r.id,
          authorName: r.authorName,
          preview: r.preview,
          reasonLabel: boardReasonLabel(dictionary.board, r.reason),
          statusLabel:
            r.status === "dismissed"
              ? dictionary.accountProfile.myReportDismissed
              : dictionary.accountProfile.myReportPending,
        }))}
        copy={{
          title: dictionary.accountProfile.myReportsTitle,
          body: dictionary.accountProfile.myReportsBody,
          empty: dictionary.accountProfile.myReportsEmpty,
          withdraw: dictionary.accountProfile.withdrawReport,
          unknown: dictionary.board.reportsAuthorUnknown,
        }}
      />
      {/* 약관 · 개인정보처리방침 · 고객지원 — App Store 심사는 앱 안에서도 이 문서들에 닿을 수
          있기를 요구한다. 공개 페이지(`/legal/*`, `/support`)라 같은 탭에서 연다. */}
      <div className="rounded-xl border border-border px-4 py-3">
        <p className="text-sm font-bold">{dictionary.legal.accountSectionTitle}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-semibold">
          {(
            [
              ["terms", dictionary.legal.navTerms],
              ["privacy", dictionary.legal.navPrivacy],
              ["support", dictionary.legal.navSupport],
            ] as const
          ).map(([key, label]) => (
            <Link
              className="text-primary underline-offset-2 hover:underline"
              href={legalHref(key, session.user.preferredLanguage)}
              key={key}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );

  const content = (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <Badge>{dictionary.common.account}</Badge>
      <div className="mt-5">
        <AccountSettings
          banners={banners}
          labels={{
            profile: ap.tabProfile,
            organization: ap.tabOrganization,
            security: ap.tabSecurity,
          }}
          panels={{
            profile: profilePanel,
            organization: organizationPanel,
            security: securityPanel,
          }}
        />
      </div>
    </div>
  );

  if (shellMode === "mobile") {
    // 모바일 셸 — 화이트 리디자인(2026-10-15, 시안 Account-Phone). 관리 콘솔 쪽(아래 AdminShell)은 그대로.
    // docs/product/17-user-profile-directory.md 「계정 화면 — 화이트 리디자인(모바일)」.
    const locale = session.user.preferredLanguage;
    const reportRows = myReports.map((r) => ({
      id: r.id,
      authorName: r.authorName,
      preview: r.preview,
      reasonLabel: boardReasonLabel(dictionary.board, r.reason),
      statusLabel:
        r.status === "dismissed"
          ? dictionary.accountProfile.myReportDismissed
          : dictionary.accountProfile.myReportPending,
    }));
    const gender = session.user.gender === "female" || session.user.gender === "male" ? session.user.gender : null;
    // 신분 서류 줄(docs/product/41 R2) — 조직 멤버이고 국적이 있을 때만.
    const idDoc =
      hasOrganizationContext(session) && session.user.identity.nationality
        ? await loadCurrentIdDocument(session.organization.id, session.user.id, { withPhotos: false })
        : null;
    const idCopy = dictionary.idCard;
    const idCardRow =
      hasOrganizationContext(session) && session.user.identity.nationality
        ? {
            label: session.user.identity.nationality === "JP" ? idCopy.titleMyNumber : idCopy.titleResidence,
            value: idDoc
              ? idDoc.status === "confirmed"
                ? idCopy.statusConfirmed
                : idDoc.status === "returned"
                  ? idCopy.statusReturned
                  : idCopy.statusPending
              : idCopy.statusMissing,
            missing: !idDoc,
          }
        : null;
    // 「급여 계좌」 줄(docs/product/39 §3-A) — 시급제이거나 이미 적어 둔 계좌가 있는 조직 멤버에게만.
    let payrollBank: { userId: string; copy: ReturnType<typeof getPayrollBankCopy>; bank: MemberBank | null } | null = null;
    if (hasOrganizationContext(session)) {
      const service = getSupabaseServiceClient();
      const [emp, banks] = await Promise.all([
        loadEmploymentNow(service, session.organization.id, session.user.id, tokyoToday()).catch(() => null),
        loadMemberBanks(service, session.organization.id, [session.user.id]).catch(() => new Map<string, MemberBank>()),
      ]);
      const bank = banks.get(session.user.id) ?? null;
      if (bank || emp?.employment === "hourly") {
        payrollBank = { userId: session.user.id, copy: getPayrollBankCopy(locale), bank };
      }
    }
    return (
      <MobileShell title={dictionary.common.account}>
        <AccountMobile
          blockedUsers={blockedUsers}
          bottomTabsLabel={resolveBottomNavItems(session.user.bottomNavTabs)
            .map((item) => item.label[locale])
            .join(" · ")}
          copy={{
            white: ap.white,
            name: dictionary.onboarding.fullNamePlaceholder,
            birthDate: dictionary.onboarding.birthDateLabel,
            birthDateHint: dictionary.onboarding.birthDateHint,
            phone: dictionary.onboarding.phonePlaceholder,
            phoneHint: dictionary.onboarding.phoneHint,
            gender: dictionary.onboarding.genderLabel,
            genderHint: ap.genderHint,
            genderOptions: dictionary.onboarding.genderOptions,
            language: dictionary.common.language,
            languages: dictionary.languages,
            organizationName: dictionary.admin.settings.organizationName,
            role: dictionary.admin.users.role,
            logout: dictionary.common.logout,
            saved: dictionary.onboarding.profileSaved,
            errorText: errorKey
              ? (dictionary.onboarding.errors[errorKey] ?? dictionary.onboarding.errors.profile_failed)
              : null,
            identity: dictionary.onboarding.identity,
            incomplete: profileIncomplete
              ? {
                  title: ap.completionTitle,
                  body:
                    !session.user.birthDate && !session.user.gender
                      ? ap.missingBirthDateAndGenderBody
                      : !session.user.birthDate
                        ? ap.missingBirthDateBody
                        : ap.genderMissingBody,
                }
              : null,
            blockedList: {
              title: ap.blockedUsersTitle,
              body: ap.blockedUsersBody,
              empty: ap.blockedUsersEmpty,
              unblock: ap.unblock,
              unknown: dictionary.board.reportsAuthorUnknown,
            },
            reportsList: {
              title: ap.myReportsTitle,
              body: ap.myReportsBody,
              empty: ap.myReportsEmpty,
              withdraw: ap.withdrawReport,
              unknown: dictionary.board.reportsAuthorUnknown,
            },
            deleteSheet: {
              cancel: dictionary.common.cancel,
              deleteAccount: dictionary.common.deleteAccount,
              deleteAccountTitle: dictionary.common.deleteAccountTitle,
              deleteAccountDesc: dictionary.common.deleteAccountDesc,
              deleteAccountWarning: dictionary.common.deleteAccountWarning,
              deleteAccountConfirm: dictionary.common.deleteAccountConfirm,
            },
          }}
          help={[
            { href: "/mobile/suggestions", label: localizedNavigationLabels.mobile.suggestions[locale] },
            { href: "/mobile/bugs", label: localizedNavigationLabels.mobile.bugs[locale] },
            { href: legalHref("terms", locale), label: dictionary.legal.navTerms },
            { href: legalHref("privacy", locale), label: dictionary.legal.navPrivacy },
            { href: legalHref("support", locale), label: dictionary.legal.navSupport },
          ]}
          myReports={reportRows}
          organization={{
            name: session.organization.name,
            role: dictionary.roles[session.user.role] ?? session.user.role,
          }}
          saved={Boolean(savedKey)}
          openIdentity={firstParam(params?.fill) === "identity" || errorKey === "identity_invalid"}
          idCard={idCardRow}
          payrollBank={payrollBank}
          user={{
            name: session.user.name,
            birthDate: session.user.birthDate ?? null,
            phoneNumber: session.user.phoneNumber ?? "",
            gender,
            language: locale,
            identity: session.user.identity,
            identityIncomplete: session.user.identityIncomplete,
          }}
        />
      </MobileShell>
    );
  }

  return <AdminShell title={dictionary.common.account}>{content}</AdminShell>;
}
