"use client";

import { useFormStatus } from "react-dom";
import { useState, useId } from "react";
import { signUpWithEmail } from "@/app/auth/actions";
import { LegalLink, type LegalOverlayCopy, type LegalOverlayDoc } from "@/components/legal/legal-overlay";
import type { LegalDocument } from "@/lib/legal-content";

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9.6 5.8A10 10 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3 3.7M6.3 7.8A17 17 0 002.5 12S6 18.5 12 18.5a9.6 9.6 0 003.7-.7M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type EmailSignupFormCopy = {
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  confirmLabel: string;
  confirmPlaceholder: string;
  ruleLength: string;
  ruleLetter: string;
  ruleNumber: string;
  mismatch: string;
  signupCta: string;
  showPassword: string;
  hidePassword: string;
  termsLink: string;
  termsConMid: string;
  privacyLink: string;
  termsConPost: string;
};

/** Same minimum as the server (`MIN_PASSWORD_LENGTH` in src/app/auth/actions.ts). */
const MIN_PASSWORD_LENGTH = 10;

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const dim = disabled || pending;
  return (
    <button type="submit" disabled={dim} aria-busy={pending} className={`aw-btn${dim ? " dim" : ""}`}>
      {pending ? (
        <span className="size-5 animate-spin rounded-full border-[2.4px] border-white/60 border-t-white" aria-hidden="true" />
      ) : (
        label
      )}
    </button>
  );
}

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "ok" : undefined}>
      <span className="ic">{ok ? <CheckIcon /> : <DotIcon />}</span>
      {label}
    </span>
  );
}

export function EmailSignupForm({
  copy,
  next,
  lang,
  legal,
}: {
  copy: EmailSignupFormCopy;
  next: string;
  lang: string;
  legal: {
    copy: LegalOverlayCopy;
    documents: Record<LegalOverlayDoc, LegalDocument>;
    hrefs: Record<LegalOverlayDoc, string>;
  };
}) {
  const fieldId = useId();
  const [emailValid, setEmailValid] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const ruleLength = password.length >= MIN_PASSWORD_LENGTH;
  const ruleLetter = /[a-zA-Z]/.test(password);
  const ruleNumber = /\d/.test(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const isReady = emailValid && ruleLength && ruleLetter && ruleNumber && confirm === password;

  return (
    <form action={signUpWithEmail}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="lang" value={lang} />

      <div className="field">
        <label className="field__l" htmlFor={`${fieldId}-1`}>{copy.emailLabel}</label>
        <div className="inp">
          <input
            id={`${fieldId}-1`}
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            placeholder={copy.emailPlaceholder}
            onChange={(e) => setEmailValid(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value))}
            required
          />
        </div>
      </div>

      <div className="field">
        <label className="field__l" htmlFor={`${fieldId}-2`}>{copy.passwordLabel}</label>
        <div className="inp pw">
          <input
            id={`${fieldId}-2`}
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            enterKeyHint="next"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? copy.hidePassword : copy.showPassword}
            className="inp__eye"
          >
            <span className="ic">{showPassword ? <EyeOffIcon /> : <EyeIcon />}</span>
          </button>
        </div>
        <div className="aw-rules" aria-live="polite">
          <Rule ok={ruleLength} label={copy.ruleLength} />
          <Rule ok={ruleLetter} label={copy.ruleLetter} />
          <Rule ok={ruleNumber} label={copy.ruleNumber} />
        </div>
      </div>

      <div className="field">
        <label className="field__l" htmlFor={`${fieldId}-3`}>{copy.confirmLabel}</label>
        <div className={`inp${mismatch ? " bad" : ""}`}>
          <input
            id={`${fieldId}-3`}
            type={showPassword ? "text" : "password"}
            name="confirm"
            autoComplete="new-password"
            enterKeyHint="go"
            placeholder={copy.confirmPlaceholder}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {mismatch && <div className="field__hint" style={{ color: "var(--aw-danger)" }}>{copy.mismatch}</div>}
      </div>

      <p className="field__hint" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <LegalLink doc="terms" href={legal.hrefs.terms} {...legal} className="font-semibold">{copy.termsLink}</LegalLink>
        {copy.termsConMid}
        <LegalLink doc="privacy" href={legal.hrefs.privacy} {...legal} className="font-semibold">{copy.privacyLink}</LegalLink>
        {copy.termsConPost}
      </p>

      <SubmitButton label={copy.signupCta} disabled={!isReady} />
    </form>
  );
}
