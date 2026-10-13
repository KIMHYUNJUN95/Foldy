"use client";

import { useState, useId } from "react";
import { useFormStatus } from "react-dom";
import { updatePassword } from "@/app/auth/actions";

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[19px]" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-[19px]" aria-hidden="true">
      <path
        d="M9.6 5.8A10 10 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3 3.7M6.3 7.8A17 17 0 002.5 12S6 18.5 12 18.5a9.6 9.6 0 003.7-.7M3 3l18 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type EmailNewPasswordFormCopy = {
  newPasswordLabel: string;
  newPasswordConfirmLabel: string;
  updatePasswordCta: string;
  showPassword: string;
  hidePassword: string;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className="aw-btn">
      {pending ? (
        <span className="size-5 animate-spin rounded-full border-[2.4px] border-white/60 border-t-white" aria-hidden="true" />
      ) : (
        label
      )}
    </button>
  );
}

export function EmailNewPasswordForm({
  copy,
  next,
  lang,
}: {
  copy: EmailNewPasswordFormCopy;
  next: string;
  lang: string;
}) {
  const fieldId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <form action={updatePassword}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="lang" value={lang} />

      <div className="field">
        <label className="field__l" htmlFor={`${fieldId}-1`}>{copy.newPasswordLabel}</label>
        <div className="inp pw">
          <input
            id={`${fieldId}-1`}
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            enterKeyHint="next"
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
      </div>

      <div className="field">
        <label className="field__l" htmlFor={`${fieldId}-2`}>{copy.newPasswordConfirmLabel}</label>
        <div className="inp pw">
          <input
            id={`${fieldId}-2`}
            type={showConfirm ? "text" : "password"}
            name="confirm"
            autoComplete="new-password"
            enterKeyHint="done"
            required
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? copy.hidePassword : copy.showPassword}
            className="inp__eye"
          >
            <span className="ic">{showConfirm ? <EyeOffIcon /> : <EyeIcon />}</span>
          </button>
        </div>
      </div>

      <SubmitButton label={copy.updatePasswordCta} />
    </form>
  );
}
