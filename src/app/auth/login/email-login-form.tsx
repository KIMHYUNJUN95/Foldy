"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useState, useId } from "react";
import "./login-motion.css";
import { signInWithEmailPassword } from "@/app/auth/actions";

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

type EmailLoginFormCopy = {
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  forgot: string;
  loginCta: string;
  showPassword: string;
  hidePassword: string;
};

// 로그인 → 첫 화면(2026-10-15, 시안 Motion-C-Login-Phone) — 누르면 버튼이 보라 점으로 오므라들어 막대가 숨 쉬고(확인 중),
// 성공하면 모바일 스플래시가 이 점 자리에서 로고로 떠오른다(점 위치는 sessionStorage `foldy.loginRise` 로 넘김). 틀리면 흔들림.
const RISE_KEY = "foldy.loginRise";

function SubmitButton({ label, failed }: { label: string; failed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`aw-btn lgm${pending ? " is-pending" : ""}${failed && !pending ? " is-failed" : ""}`}
    >
      <span className="lgm__t">{label}</span>
      <span className="lgm__bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </button>
  );
}

export function EmailLoginForm({
  copy,
  forgotHref,
  initialEmail = "",
  next,
  lang,
  failed = false,
}: {
  copy: EmailLoginFormCopy;
  forgotHref: string;
  initialEmail?: string;
  next: string;
  lang: string;
  /** 직전 시도가 틀려서 돌아왔으면 버튼이 한 번 흔들린다. */
  failed?: boolean;
}) {
  const fieldId = useId();
  const [showPassword, setShowPassword] = useState(false);

  // 이 화면에 (다시) 왔다 = 지난 시도는 성공 안 함 → 넘겨 둔 점 위치를 지운다.
  useEffect(() => {
    try {
      sessionStorage.removeItem(RISE_KEY);
    } catch {}
  }, []);

  return (
    <form
      action={signInWithEmailPassword}
      onSubmit={(e) => {
        const btn = (e.nativeEvent as SubmitEvent).submitter;
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        try {
          sessionStorage.setItem(RISE_KEY, JSON.stringify({ t: Date.now(), x: r.left + r.width / 2, y: r.top + r.height / 2 }));
        } catch {}
      }}
    >
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
            defaultValue={initialEmail}
            placeholder={copy.emailPlaceholder}
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
            autoComplete="current-password"
            enterKeyHint="go"
            placeholder={copy.passwordPlaceholder}
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
        <div className="field__under">
          <a href={forgotHref}>{copy.forgot}</a>
        </div>
      </div>

      <SubmitButton label={copy.loginCta} failed={failed} />
    </form>
  );
}
