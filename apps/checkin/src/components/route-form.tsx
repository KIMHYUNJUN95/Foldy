"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Dictionary, Locale } from "@/lib/i18n";

import { BackIcon, LockIcon } from "./icons";
import { LangSwitch } from "./lang-switch";
import { RouteQuestions } from "./route-questions";

// 어디서 오셔서 어디로 가세요(시안 W3s) — 대표자 명부 다음 화면. 외국 손님만 온다(신주쿠구 규칙 10 ⑦ · ⑧).
type Props = {
  token: string;
  locale: Locale;
  dict: Pick<Dictionary, "route" | "person" | "common">;
  initial: { prevStay: string; nextDest: string };
  editable: boolean;
  /** 「저장하고 2번째 분으로」의 사람 이름표. 다음 사람이 없으면 null. */
  nextLabel: string | null;
  nextHref: string;
  backHref: string;
};

export function RouteForm({ token, locale, dict, initial, editable, nextLabel, nextHref, backHref }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const copy = dict.route;
  const complete = !!value.prevStay && !!value.nextDest;

  function save() {
    if (!complete) {
      setMessage(copy.incomplete);
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/guest/${token}/route`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        });
        const body = (await response.json()) as { ok: boolean; error?: string };
        if (!body.ok) {
          setMessage(body.error === "locked" ? dict.person.locked : dict.common.error);
          return;
        }
        router.push(nextHref);
        router.refresh();
      } catch {
        setMessage(dict.common.error);
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
      <div className="flex h-11 items-center justify-between">
        <Link href={backHref} className="w-icon" aria-label={dict.common.back}>
          <BackIcon />
        </Link>
        <LangSwitch locale={locale} label={dict.common.language} />
      </div>
      <h1 className="w-h mt-4 text-[28px]">{copy.title}</h1>
      <p className="mt-2 text-[15px] text-[var(--muted)]">{copy.sub}</p>

      <form
        className="mt-6 flex flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <RouteQuestions
          copy={copy}
          prevStay={initial.prevStay}
          nextDest={initial.nextDest}
          disabled={!editable || pending}
          onChange={(next) => setValue((current) => ({ ...current, ...next }))}
        />
        <p className="mt-6 flex items-start gap-2 text-[14px] text-[var(--muted)]">
          <LockIcon className="mt-0.5 size-4 shrink-0" />
          {copy.note}
        </p>
        <div className="flex-1" />
        {!editable ? (
          <p className="mt-6 text-[14px] text-[var(--sand)]">{dict.person.locked}</p>
        ) : (
          <>
            {message ? (
              <p role="alert" className="mt-4 text-[14px] text-[var(--error)]">
                {message}
              </p>
            ) : null}
            <button type="submit" className="w-btn mt-4" disabled={pending}>
              {pending ? dict.person.saving : nextLabel ? copy.saveTo.replace("{label}", nextLabel) : copy.save}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
