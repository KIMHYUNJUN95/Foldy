"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Dictionary, Locale } from "@/lib/i18n";

import { BackIcon } from "./icons";
import { LangSwitch } from "./lang-switch";

// 약관 동의(시안 W3b) — 두 칸 모두 체크해야 끝난다. 미성년자는 보호자가 대신(FR-K23).
type Props = {
  token: string;
  locale: Locale;
  dict: Pick<Dictionary, "terms" | "common">;
  counter: string;
  /** 예약 인원 ≠ 명부 인원일 때 한 줄(43 §8, 막지 않음). */
  countNote: string | null;
  termsText: string | null;
};

export function TermsForm({ token, locale, dict, counter, countNote, termsText }: Props) {
  const router = useRouter();
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/guest/${token}/consent`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ terms, privacy, locale }),
        });
        const body = (await response.json()) as { ok: boolean; error?: string };
        if (!body.ok) {
          setMessage(body.error === "incomplete" ? dict.terms.incomplete : dict.common.error);
          return;
        }
        router.push(`/r/${token}`);
        router.refresh();
      } catch {
        setMessage(dict.common.error);
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
      <div className="flex h-11 items-center justify-between">
        <Link href={`/r/${token}?view=list`} className="w-icon" aria-label={dict.common.back}>
          <BackIcon />
        </Link>
        <LangSwitch locale={locale} label={dict.common.language} />
      </div>
      <p className="num mt-6 text-[14px] text-[var(--muted)]">{counter}</p>
      <h1 className="w-h mt-1 text-[30px]">
        <span className="block text-[17px] font-normal text-[var(--muted)]">{dict.terms.kicker}</span>
        {dict.terms.title}
      </h1>
      <ul className="mt-6 space-y-2.5 text-[15px] leading-relaxed">
        {[dict.terms.line1, dict.terms.line2, dict.terms.line3].map((line) => (
          <li key={line} className="flex gap-2.5">
            <span aria-hidden className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-[var(--muted)]" />
            {line}
          </li>
        ))}
      </ul>
      {countNote ? (
        <p className="mt-5 rounded-md bg-[var(--surface)] px-4 py-3 text-[14px] leading-relaxed text-[var(--sand)]">{countNote}</p>
      ) : null}
      <div className="mt-7 flex flex-col gap-2">
        <label className="w-check">
          <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[16px]">{dict.terms.terms}</span>
            <small className="text-[15px] text-[var(--muted)]">{dict.terms.termsSub}</small>
          </span>
        </label>
        <label className="w-check">
          <input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[16px]">{dict.terms.privacy}</span>
            <small className="text-[15px] text-[var(--muted)]">{dict.terms.minors}</small>
          </span>
        </label>
      </div>
      {termsText ? (
        <div className="mt-4">
          <button type="button" className="w-link text-[15px]" aria-expanded={showFull} onClick={() => setShowFull((v) => !v)}>
            {dict.terms.full}
          </button>
          {showFull ? (
            <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-[var(--surface)] p-4 text-[14px] leading-relaxed text-[var(--muted)]">
              {termsText}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex-1" />
      {message ? (
        <p role="alert" className="mt-6 text-[14px] text-[var(--error)]">
          {message}
        </p>
      ) : (
        <p className="mt-6 text-[14px] text-[var(--muted)]">{dict.terms.hint}</p>
      )}
      <button type="button" className="w-btn mt-4" disabled={!terms || !privacy || pending} onClick={submit}>
        {dict.terms.submit}
      </button>
    </main>
  );
}
