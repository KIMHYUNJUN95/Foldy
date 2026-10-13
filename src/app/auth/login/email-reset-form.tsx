"use client";

import { useId } from "react";
import { useFormStatus } from "react-dom";
import { requestPasswordReset } from "@/app/auth/actions";

type EmailResetFormCopy = {
  emailLabel: string;
  emailPlaceholder: string;
  resetHint: string;
  resetCta: string;
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

export function EmailResetForm({
  copy,
  next,
  lang,
}: {
  copy: EmailResetFormCopy;
  next: string;
  lang: string;
}) {
  const fieldId = useId();
  return (
    <form action={requestPasswordReset}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="lang" value={lang} />

      <div className="field" style={{ marginTop: 22 }}>
        <label className="field__l" htmlFor={`${fieldId}-1`}>{copy.emailLabel}</label>
        <div className="inp focus">
          <input
            id={`${fieldId}-1`}
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={copy.emailPlaceholder}
            required
          />
        </div>
        <div className="field__hint">{copy.resetHint}</div>
      </div>

      <SubmitButton label={copy.resetCta} />
    </form>
  );
}
