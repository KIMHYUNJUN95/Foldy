"use client";

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
    <button type="submit" disabled={pending} aria-busy={pending} className="aw-btn" style={pending ? { opacity: 0.7 } : undefined}>
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
  return (
    <form action={requestPasswordReset}>
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="lang" value={lang} />

      <div className="field" style={{ marginTop: 22 }}>
        <div className="field__l">{copy.emailLabel}</div>
        <div className="inp focus">
          <input
            type="email"
            name="email"
            autoComplete="email"
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
