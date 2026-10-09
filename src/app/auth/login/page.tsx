import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signInWithGoogle, signOut } from "@/app/auth/actions";
import { AuthFrame } from "@/app/auth/login/auth-frame";
import { FoldyMark } from "@/components/brand/foldy-mark";
import { EmailLoginForm } from "@/app/auth/login/email-login-form";
import { EmailNewPasswordForm } from "@/app/auth/login/email-new-password-form";
import { EmailResetForm } from "@/app/auth/login/email-reset-form";
import { EmailSignupForm } from "@/app/auth/login/email-signup-form";
import { GoogleSubmitButton } from "@/app/auth/login/google-button";
import { legalOverlayProps } from "@/components/legal/legal-overlay-props";
import { resolveAuthErrorMessage } from "@/lib/auth-errors";
import { ATTENDANCE_QR_PATH } from "@/lib/attendance-qr";
import { isMobileSurfacePath, isSurfaceNeutralPath } from "@/lib/surface-routing";
import { getDictionary, inferLocaleFromAcceptLanguage, isLocale, type Locale } from "@/lib/i18n";
import { getDeviceSurfaceFromHeaders, isMobileUserAgent } from "@/lib/mobile-device";
import { getOnboardingState } from "@/lib/onboarding";
import { sanitizeNextPath } from "@/lib/safe-redirect";

const LOCALE_COOKIE = "stayops_locale";

type LoginPageProps = {
  searchParams: Promise<{
    email?: string;
    error?: string;
    lang?: string;
    mode?: string;
    next?: string;
    sent?: string;
    view?: string;
  }>;
};

/* ── inline icons (1em, sized by the `.ic` wrapper) ── */
const Mail = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M4.5 7l7.5 5.5L19.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const QrMark = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.7" /><path d="M13.5 13.5h3v3h-3zM17.5 17.5h2.5v2.5h-2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
);
const Warn = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="17" r="1.1" fill="currentColor" /></svg>
);
const Lock = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 10.5V8a4 4 0 018 0v2.5" stroke="currentColor" strokeWidth="1.8" /></svg>
);
const UserX = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" /><path d="M4 20c0-3.4 2.7-5.5 6-5.5 1 0 2 .2 2.8.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M16 15l5 5M21 15l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
);
const Power = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /><path d="M7.5 6.6a7 7 0 109 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
);

/**
 * 대시보드에서 넘어온 로그인 화면(`?next=/admin…`)은 대시보드 매니페스트를 알린다(2026-10-15).
 * 로그아웃 상태의 `/admin` 은 여기로 넘어오므로, 그대로면 PWABuilder(Microsoft Store 패키징) · 브라우저 설치가
 * 모바일 「Foldy」 매니페스트를 집는다. docs/product/05-admin-web-ia.md 「Windows 설치 파일」.
 */
export async function generateMetadata({ searchParams }: LoginPageProps): Promise<Metadata> {
  const { next } = await searchParams;
  const nextPath = sanitizeNextPath(next);
  return nextPath === "/admin" || nextPath.startsWith("/admin/") || nextPath.startsWith("/admin?") ? { manifest: "/manifest-admin.webmanifest" } : {};
}

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="banner banner--danger">
      <span className="banner__ic"><Ic>{Warn}</Ic></span>
      <div className="banner__s" style={{ color: "var(--danger)", fontWeight: 700 }}>{message}</div>
    </div>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const state = await getOnboardingState();

  // Priority: ?lang= param → stayops_locale cookie → Accept-Language header → "ko"
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value ?? "";
  const requestedLocale = params.lang ?? cookieLocale;
  const headerStore = await headers();
  const acceptLanguage = headerStore.get("accept-language") ?? "";
  const locale: Locale = isLocale(requestedLocale)
    ? requestedLocale
    : inferLocaleFromAcceptLanguage(acceptLanguage);
  const dictionary = getDictionary(locale);
  const t = dictionary.auth;
  const c = t.console;
  const errorMessage = resolveAuthErrorMessage(params.error, dictionary);

  // Mobile-first login: on a phone/tablet, always route into the mobile app after
  // sign-in — overriding the role-based admin default and any ?next=/admin/... value.
  const userAgent = (await headers()).get("user-agent");
  const isMobileDevice = isMobileUserAgent(userAgent);
  // 로그인 첫 화면 문구용 — 아이패드(Mac 사용자 에이전트)는 「터치 되는 Mac」 쿠키로 알아본다(`getDeviceSurfaceFromHeaders`).
  const showMobileCopy = isMobileDevice || getDeviceSurfaceFromHeaders(headerStore) === "mobile";
  const next = sanitizeNextPath(params.next, isMobileDevice ? "/mobile" : "/admin");
  // 목적지의 경로 부분만 본다 — `next` 에는 쿼리가 붙어 올 수 있다(예: 근태 QR 의 ?token=).
  const nextPathname = next.split("?")[0].split("#")[0];
  // 모바일에서는 `/admin/...` 목적지를 앱으로 돌린다. 다만 **이미 모바일 경로인 next 는 지킨다** —
  // 예전에는 무조건 "/mobile" 로 덮어써서, 로그아웃 상태로 근태 QR 을 찍은 직원이 로그인 후
  // 인증 화면이 아니라 홈으로 떨어졌다(토큰이 통째로 버려졌다).
  // 예약 바로가기(`/go/...`)도 지킨다 — 그 문이 기기를 보고 폰 화면으로 보낸다.
  const effectiveNext =
    isMobileDevice && !isMobileSurfacePath(nextPathname) && !isSurfaceNeutralPath(nextPathname) ? "/mobile" : next;
  // 현장에 붙은 출퇴근 QR 을 로그아웃 상태로 찍고 들어온 경우. 지나가던 사람도 찍을 수 있는
  // 인쇄물이라, 이 화면이 누구를 위한 것인지 분명히 알려준다.
  const isAttendanceQrEntry =
    nextPathname === ATTENDANCE_QR_PATH && next.includes("token=");
  const isBlockedState =
    params.view === "blocked" &&
    (state.status === "suspended" ||
      state.status === "removed" ||
      state.status === "disabled");

  // Password-reset link lands here with a recovery SESSION (so the user is
  // authenticated). This screen must render despite that — otherwise the gating
  // below would bounce the user to their dashboard/onboarding before they can
  // set a new password.
  const isPasswordRecovery = params.view === "email" && params.mode === "new_password";

  if (state.status === "ready" && !isPasswordRecovery) {
    redirect(effectiveNext);
  }

  if (state.status !== "unauthenticated" && !isBlockedState && !isPasswordRecovery) {
    const onboardingUrl = `/onboarding?lang=${locale}&next=${encodeURIComponent(next)}`;
    redirect(onboardingUrl);
  }

  const langNext = `lang=${locale}&next=${encodeURIComponent(effectiveNext)}`;
  const splitHref = `/auth/login?${langNext}`;
  const emailHref = `/auth/login?view=email&${langNext}`;
  const signupHref = `/auth/login?view=email&mode=signup&${langNext}`;
  const forgotHref = `/auth/login?view=email&mode=reset&${langNext}`;

  // ===== Password reset — sent confirmation =====
  if (params.view === "email" && params.mode === "reset" && params.sent) {
    return (
      <AuthFrame locale={locale} next={effectiveNext} view="email" mobileCopy={showMobileCopy}>
        <div className="aw-status authw__col--center" style={{ flex: 1 }}>
          <span className="aw-status__ic"><Ic>{Mail}</Ic></span>
          <span className="aw-status__ey">{t.email.resetSentEyebrow}</span>
          <h1 className="aw-title">{t.email.resetSentTitle}</h1>
          <p className="aw-lede">{t.email.resetSentBody}</p>
          {params.email && (
            <span className="aw-status__email"><Ic>{Mail}</Ic>{params.email}</span>
          )}
          <Link href={emailHref} className="aw-btn aw-gap-m">{t.email.resetSentBackToLogin}</Link>
          <div className="aw-help">
            {t.email.resetSentNoMail}
            <Link href={forgotHref}>{t.email.resetSentResend}</Link>
          </div>
        </div>
      </AuthFrame>
    );
  }

  // ===== New password (recovery) =====
  if (params.view === "email" && params.mode === "new_password") {
    return (
      <AuthFrame locale={locale} next={effectiveNext} view="email" mobileCopy={showMobileCopy}>
        <div className="aw-head">
          <h1 className="aw-title">{t.email.newPasswordTitle}</h1>
          <p className="aw-lede">{t.email.newPasswordSubtitle}</p>
        </div>
        {errorMessage && <ErrorBanner message={errorMessage} />}
        <div className="aw-gap-l">
          <EmailNewPasswordForm
            copy={{
              newPasswordLabel: t.email.newPasswordLabel,
              newPasswordConfirmLabel: t.email.newPasswordConfirmLabel,
              updatePasswordCta: t.email.updatePasswordCta,
              showPassword: t.email.showPassword,
              hidePassword: t.email.hidePassword,
            }}
            next={effectiveNext}
            lang={locale}
          />
        </div>
      </AuthFrame>
    );
  }

  // ===== Password reset request =====
  if (params.view === "email" && params.mode === "reset") {
    return (
      <AuthFrame locale={locale} next={effectiveNext} view="email" backHref={emailHref} mobileCopy={showMobileCopy}>
        <div className="aw-head">
          <h1 className="aw-title">{t.email.resetTitle}</h1>
          <p className="aw-lede">{t.email.resetSubtitle}</p>
        </div>
        {errorMessage && <ErrorBanner message={errorMessage} />}
        <EmailResetForm
          copy={{
            emailLabel: t.emailLabel,
            emailPlaceholder: t.emailPlaceholder,
            resetHint: t.email.resetHint,
            resetCta: t.email.resetCta,
          }}
          next={effectiveNext}
          lang={locale}
        />
      </AuthFrame>
    );
  }

  // ===== Email verification sent =====
  if (params.view === "email" && params.mode === "signup" && params.sent === "verify") {
    return (
      <AuthFrame locale={locale} next={effectiveNext} view="email" mobileCopy={showMobileCopy}>
        <div className="aw-status authw__col--center" style={{ flex: 1 }}>
          <span className="aw-status__ic"><Ic>{Mail}</Ic></span>
          <span className="aw-status__ey">{c.signupEyebrow}</span>
          <h1 className="aw-title">{t.email.verificationSentTitle}</h1>
          <p className="aw-lede">{t.email.verificationSentBody}</p>
          {params.email && (
            <span className="aw-status__email"><Ic>{Mail}</Ic>{params.email}</span>
          )}
          <Link href={emailHref} className="aw-btn aw-gap-m">{t.email.resetSentBackToLogin}</Link>
        </div>
      </AuthFrame>
    );
  }

  // ===== Blocked / suspended / removed / disabled =====
  if (params.view === "blocked") {
    const b = t.blocked;
    const blockedEmail =
      params.email ??
      (state.status === "disabled"
        ? state.email
        : state.status === "suspended" || state.status === "removed"
          ? state.user.email ?? ""
          : "");
    const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";
    const contactBody = b.contactBody.replace("{email}", blockedEmail);
    const buildMailto = (subject: string) =>
      `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(contactBody)}`;
    const removedRejoinHref = `/onboarding?rejoin=1&lang=${locale}${effectiveNext ? `&next=${encodeURIComponent(effectiveNext)}` : ""}`;

    type BlockedConfig = {
      icon: React.ReactNode;
      iconBg: string;
      iconColor: string;
      eyebrow: string;
      title: string;
      body: string;
      showEmail: boolean;
      primary: string;
      primaryHref: string;
      secondary: string;
    };
    const configs: Record<string, BlockedConfig> = {
      suspended: {
        icon: Lock, iconBg: "#fdf3e3", iconColor: "#a15c07",
        eyebrow: b.suspendedEyebrow, title: b.suspendedTitle, body: b.suspendedBody,
        showEmail: true, primary: b.suspendedCta, primaryHref: buildMailto(b.contactSubjectSuspended), secondary: b.logout,
      },
      removed: {
        icon: UserX, iconBg: "#f4f4f7", iconColor: "#6b6878",
        eyebrow: b.removedEyebrow, title: b.removedTitle, body: b.removedBody,
        showEmail: false, primary: b.removedCta, primaryHref: removedRejoinHref, secondary: b.logout,
      },
      disabled: {
        icon: Power, iconBg: "#fdecec", iconColor: "#c5282e",
        eyebrow: b.disabledEyebrow, title: b.disabledTitle, body: b.disabledBody,
        showEmail: true, primary: b.disabledCta, primaryHref: buildMailto(b.contactSubjectDisabled), secondary: b.disabledAltLogin,
      },
    };
    const cfg = configs[params.mode ?? ""] ?? configs.suspended;

    return (
      <AuthFrame locale={locale} next={effectiveNext} view="blocked" mobileCopy={showMobileCopy}>
        <div className="aw-status authw__col--center" style={{ flex: 1 }}>
          <span className="aw-status__ic" style={{ background: cfg.iconBg, color: cfg.iconColor }}><Ic>{cfg.icon}</Ic></span>
          <span className="aw-status__ey" style={{ color: cfg.iconColor }}>{cfg.eyebrow}</span>
          <h1 className="aw-title">{cfg.title}</h1>
          <p className="aw-lede">{cfg.body}</p>
          {cfg.showEmail && blockedEmail && (
            <span className="aw-status__email"><Ic>{Mail}</Ic>{blockedEmail}</span>
          )}
          <div className="aw-row aw-gap-m">
            <a href={cfg.primaryHref} className="aw-btn">{cfg.primary}</a>
            <form action={signOut} style={{ display: "flex" }}>
              <input name="next" type="hidden" value="/auth/login" />
              <button type="submit" className="aw-btn aw-btn--line">{cfg.secondary}</button>
            </form>
          </div>
        </div>
      </AuthFrame>
    );
  }

  // ===== Email signup =====
  if (params.view === "email" && params.mode === "signup") {
    return (
      <AuthFrame locale={locale} next={effectiveNext} view="email" backHref={splitHref} mobileCopy={showMobileCopy}>
        <div className="aw-tabs" role="tablist">
          <Link href={emailHref} role="tab" aria-selected="false">{t.email.tabLogin}</Link>
          <span className="on" role="tab" aria-selected="true">{t.email.tabSignup}</span>
        </div>
        <div className="aw-head aw-gap-m">
          <h1 className="aw-title">{t.email.signupTitle}</h1>
          <p className="aw-lede">{t.email.signupSubtitle}</p>
        </div>
        {errorMessage && <ErrorBanner message={errorMessage} />}
        <div className="aw-gap-l">
          <EmailSignupForm
            copy={{
              emailLabel: t.emailLabel,
              emailPlaceholder: t.emailPlaceholder,
              passwordLabel: t.email.passwordLabel,
              confirmLabel: t.email.confirmPasswordLabel,
              confirmPlaceholder: t.email.confirmPasswordPlaceholder,
              ruleLength: t.email.pwRuleLength,
              ruleLetter: t.email.pwRuleLetter,
              ruleNumber: t.email.pwRuleNumber,
              mismatch: t.email.passwordMismatch,
              signupCta: t.email.signupCta,
              showPassword: t.email.showPassword,
              hidePassword: t.email.hidePassword,
              termsLink: t.email.termsLink,
              termsConMid: t.email.termsConMid,
              privacyLink: t.email.privacyLink,
              termsConPost: t.email.termsConPost,
            }}
            next={effectiveNext}
            lang={locale}
            legal={legalOverlayProps(locale)}
          />
        </div>
      </AuthFrame>
    );
  }

  // ===== Email login =====
  if (params.view === "email") {
    return (
      <AuthFrame locale={locale} next={effectiveNext} view="email" backHref={splitHref} mobileCopy={showMobileCopy}>
        <div className="aw-tabs" role="tablist">
          <span className="on" role="tab" aria-selected="true">{t.email.tabLogin}</span>
          <Link href={signupHref} role="tab" aria-selected="false">{t.email.tabSignup}</Link>
        </div>
        <div className="aw-head aw-gap-l">
          <h1 className="aw-title">{t.email.welcomeTitle}</h1>
          <p className="aw-lede">{t.email.loginSubtitle}</p>
        </div>
        {params.sent === "password_updated" && (
          <div className="banner banner--info">
            <span className="banner__ic"><Ic>{Mail}</Ic></span>
            <div>{t.email.passwordUpdatedNote}</div>
          </div>
        )}
        {errorMessage && <ErrorBanner message={errorMessage} />}
        <div className="aw-gap-l">
          <EmailLoginForm
            copy={{
              emailLabel: t.emailLabel,
              emailPlaceholder: t.emailPlaceholder,
              passwordLabel: t.email.passwordLabel,
              passwordPlaceholder: t.email.passwordPlaceholder,
              forgot: t.email.forgot,
              loginCta: t.email.loginCta,
              showPassword: t.email.showPassword,
              hidePassword: t.email.hidePassword,
            }}
            forgotHref={forgotHref}
            initialEmail={params.email ?? ""}
            next={effectiveNext}
            lang={locale}
          />
        </div>
      </AuthFrame>
    );
  }

  // ===== Entry =====
  return (
    <AuthFrame locale={locale} next={effectiveNext} view={params.view} mobileCopy={showMobileCopy}>
      <div className="authw__col--center" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="aw-hero">
          <span className="aw-hero__mark"><FoldyMark size={56} /></span>
          <h1 className="aw-title">{c.welcomeTitle}</h1>
          <p className="aw-lede">{c.welcomeLede}</p>
        </div>
        {isAttendanceQrEntry && (
          <div className="banner banner--info" style={{ marginTop: 0 }}>
            <span className="banner__ic"><Ic>{QrMark}</Ic></span>
            <div>
              <div className="banner__t">{t.entry.qrNoticeTitle}</div>
              <div>{t.entry.qrNoticeBody}</div>
            </div>
          </div>
        )}
        {errorMessage && <ErrorBanner message={errorMessage} />}
        <div className="aw-stack" style={{ paddingTop: 8 }}>
          <form action={signInWithGoogle}>
            <input name="next" type="hidden" value={effectiveNext} />
            <input name="lang" type="hidden" value={locale} />
            <GoogleSubmitButton label={t.entry.continueGoogle} />
          </form>
          <div className="aw-or">{t.divider}</div>
          {/* 이메일을 여기서 받아 이메일 로그인 화면으로 넘긴다(비밀번호는 그 화면에서). */}
          <form method="get" action="/auth/login" className="aw-stack" style={{ marginTop: 6 }}>
            <input type="hidden" name="view" value="email" />
            <input type="hidden" name="lang" value={locale} />
            <input type="hidden" name="next" value={effectiveNext} />
            <div className="field">
              <label className="field__l" htmlFor="entry-email">{t.emailLabel}</label>
              <div className="inp">
                <input id="entry-email" type="email" name="email" autoComplete="email" enterKeyHint="go" placeholder={t.emailPlaceholder} />
              </div>
            </div>
            <button type="submit" className="aw-btn">{t.entry.continueEmail}</button>
          </form>
          <div className="aw-help">
            {t.entry.noAccount}
            <Link href={signupHref}>{t.entry.signUpEmail}</Link>
          </div>
        </div>
        <p className="aw-note aw-note--mobile">{t.entry.inviteNote}</p>
        {!showMobileCopy && (
          <div className="aw-feats">
            <span>{c.feat1T}</span>
            <span>{c.feat2T}</span>
            <span>{c.feat3T}</span>
          </div>
        )}
      </div>
    </AuthFrame>
  );
}
