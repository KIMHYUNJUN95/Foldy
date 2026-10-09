"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { resendSignupConfirmation } from "@/app/auth/actions";

/** Supabase 가 같은 주소로 다시 보내기를 막는 시간과 같다. */
const COOLDOWN_SECONDS = 60;

function SubmitButton({ label, waitLabel, left }: { label: string; waitLabel: string; left: number }) {
  const { pending } = useFormStatus();
  const waiting = left > 0;
  return (
    <button className="aw-btn aw-btn--line" disabled={pending || waiting} type="submit">
      {waiting ? waitLabel.replace("{s}", String(left)) : label}
    </button>
  );
}

/**
 * 「메일 다시 보내기」 — 방금 보냈으니 처음 60초는 잠겨 있다(새로 고쳐도 다시 센다). 다시 보낸 뒤에도 60초.
 */
export function ResendConfirmationForm({
  email,
  next,
  lang,
  label,
  waitLabel,
}: {
  email: string;
  next: string;
  lang: string;
  label: string;
  waitLabel: string;
}) {
  const [left, setLeft] = useState(COOLDOWN_SECONDS);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  return (
    <form action={resendSignupConfirmation} style={{ width: "100%" }}>
      <input name="email" type="hidden" value={email} />
      <input name="next" type="hidden" value={next} />
      <input name="lang" type="hidden" value={lang} />
      <SubmitButton label={label} left={left} waitLabel={waitLabel} />
    </form>
  );
}
