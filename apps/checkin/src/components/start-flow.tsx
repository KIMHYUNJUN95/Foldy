"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { fmt, formatStayDate, formatTokyoTime, LOCALES, type Dictionary, type Locale } from "@/lib/i18n";

import { BackIcon, ChevronIcon, LockIcon } from "./icons";
import { LangSwitch, LOCALE_NAMES, setLocaleCookie } from "./lang-switch";

// 건물 고정 링크 첫 화면 흐름(시안 W-Start → W0 → W1 / W1b → W1x · W1L). 예약을 찾으면 개인 링크 /r/<토큰> 으로 간다.
type Step = "start" | "language" | "find" | "notFound" | "locked";
type Mode = "reference" | "phone";

type Props = {
  building: string;
  buildingName: string;
  locale: Locale;
  dict: Dictionary;
  langPrompts: Record<Locale, { prompt: string; hint: string }>;
  welcomes: Record<Locale, string>;
  today: string;
};

const WELCOME_ORDER: Locale[] = ["ja", "zh-Hans", "ko"];

export function StartFlow({ building, buildingName, locale, dict, langPrompts, welcomes, today }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("start");
  const [mode, setMode] = useState<Mode>("reference");
  const [form, setForm] = useState({ lastName: "", firstName: "", checkInDate: today, reference: "", phoneLast4: "" });
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filled =
    form.lastName.trim() &&
    form.firstName.trim() &&
    form.checkInDate &&
    (mode === "reference" ? form.reference.trim().length >= 4 : /^\d{4}$/.test(form.phoneLast4));

  function submit() {
    if (!filled) {
      setError(dict.find.invalid);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/guest/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            building,
            lastName: form.lastName,
            firstName: form.firstName,
            checkInDate: form.checkInDate,
            ...(mode === "reference" ? { reference: form.reference } : { phoneLast4: form.phoneLast4 }),
          }),
        });
        const body = (await response.json()) as {
          ok: boolean;
          token?: string;
          error?: string;
          failures?: number;
          locked_until?: string;
        };
        if (body.ok && body.token) {
          router.push(`/r/${body.token}`);
          return;
        }
        if (body.error === "locked" && body.locked_until) {
          setLockedUntil(body.locked_until);
          setStep("locked");
        } else if (body.error === "not_found") {
          setFailures(body.failures ?? failures + 1);
          setStep("notFound");
        } else if (body.error === "rate_limited") {
          setError(dict.common.rateLimited);
        } else {
          setError(dict.common.error);
        }
      } catch {
        setError(dict.common.error);
      }
    });
  }

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((value) => ({ ...value, [key]: event.target.value }));

  if (step === "start") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-14">
        <h1 lang="en" className="w-h text-[44px] font-medium leading-[1.02]">
          Check in
          <br />
          before
          <br />
          you arrive
        </h1>
        <ul className="mt-8 space-y-1 text-[17px] text-[var(--muted)]">
          <li lang="en">Welcome</li>
          {WELCOME_ORDER.map((option) => (
            <li key={option} lang={option}>
              {welcomes[option]}
            </li>
          ))}
        </ul>
        <div className="flex-1" />
        <p className="mb-5 text-[13px] tracking-[0.06em] text-[var(--muted)]">{buildingName}</p>
        <button type="button" className="w-btn" onClick={() => setStep("language")}>
          {dict.start.button}
        </button>
      </main>
    );
  }

  if (step === "language") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
        <div className="flex h-11 items-center">
          <button type="button" className="w-icon" aria-label={dict.common.back} onClick={() => setStep("start")}>
            <BackIcon />
          </button>
        </div>
        <h1 lang="en" className="w-h mt-6 text-[34px]">
          Language
        </h1>
        <ul className="mt-2 space-y-0.5 text-[15px] text-[var(--muted)]">
          {(["ja", "zh-Hans", "ko"] as Locale[]).map((option) => (
            <li key={option} lang={option}>
              {langPrompts[option].prompt}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col gap-2">
          {LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              lang={option}
              onClick={() => {
                setLocaleCookie(option);
                setStep("find");
                router.refresh();
              }}
              className="flex min-h-[72px] items-center gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 text-left"
            >
              <span className="flex flex-1 flex-col gap-1">
                <b className="text-[19px] font-medium">{LOCALE_NAMES[option]}</b>
                <small className="text-[15px] text-[var(--muted)]">{langPrompts[option].hint}</small>
              </span>
              <ChevronIcon className="size-4 text-[var(--muted)]" />
            </button>
          ))}
        </div>
      </main>
    );
  }

  const top = (onBack: () => void) => (
    <div className="flex h-11 items-center justify-between">
      <button type="button" className="w-icon" aria-label={dict.common.back} onClick={onBack}>
        <BackIcon />
      </button>
      <LangSwitch locale={locale} label={dict.common.language} />
    </div>
  );

  if (step === "locked") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
        {top(() => setStep("find"))}
        <LockIcon className="mt-10 size-8 text-[var(--sand)]" />
        <h1 className="w-h mt-4 text-[30px]">{dict.locked.title}</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">{dict.locked.body}</p>
        {lockedUntil ? (
          <div className="mt-8 rounded-md bg-[var(--surface)] p-5">
            <p className="num text-[40px] font-medium tracking-tight">{formatTokyoTime(locale, lockedUntil)}</p>
            <p className="mt-1 text-[14px] text-[var(--muted)]">
              {fmt(dict.locked.until, { time: formatTokyoTime(locale, lockedUntil) })}
            </p>
          </div>
        ) : null}
        <p className="mt-6 text-[15px] leading-relaxed">{dict.locked.arrived}</p>
      </main>
    );
  }

  if (step === "notFound") {
    const entered = [
      { label: dict.find.lastName + " · " + dict.find.firstName, value: `${form.lastName} ${form.firstName}`.toUpperCase() },
      { label: dict.find.checkInDate, value: form.checkInDate ? formatStayDate(locale, form.checkInDate) : "" },
      mode === "reference"
        ? { label: dict.find.reference, value: form.reference.toUpperCase() }
        : { label: dict.find.phoneLast4, value: form.phoneLast4 },
    ];
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
        {top(() => setStep("find"))}
        <h1 className="w-h mt-8 text-[30px]">{dict.notFound.title}</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">{dict.notFound.body}</p>
        <dl className="mt-6 divide-y divide-[var(--line)] rounded-md bg-[var(--surface)] px-4">
          {entered.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[14px] text-[var(--muted)]">{row.label}</dt>
              <dd className="num text-right text-[16px] font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
        <ol className="mt-6 space-y-3 text-[15px] leading-relaxed">
          {[dict.notFound.tip1, dict.notFound.tip2, dict.notFound.tip3].map((tip, index) => (
            <li key={tip} className="flex gap-3">
              <span className="num text-[14px] text-[var(--muted)]">{index + 1}</span>
              <span>{tip}</span>
            </li>
          ))}
        </ol>
        <div className="flex-1" />
        <p className="mb-4 mt-6 text-[14px] text-[var(--sand)]">{fmt(dict.notFound.remaining, { n: failures })}</p>
        <button type="button" className="w-btn" onClick={() => setStep("find")}>
          {dict.notFound.retry}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
      {top(() => setStep("language"))}
      <h1 className="w-h mt-8 text-[30px]">{mode === "reference" ? dict.find.title : dict.find.phoneTitle}</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">
        {mode === "reference" ? dict.find.body : dict.find.phoneBody}
      </p>
      <form
        className="mt-7 flex flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="w-lab">{dict.find.lastName}</span>
            <input className="w-in uppercase" autoComplete="family-name" value={form.lastName} onChange={set("lastName")} />
          </label>
          <label>
            <span className="w-lab">{dict.find.firstName}</span>
            <input className="w-in uppercase" autoComplete="given-name" value={form.firstName} onChange={set("firstName")} />
          </label>
        </div>
        <label className="mt-5">
          <span className="w-lab">{dict.find.checkInDate}</span>
          <input className="w-in num" type="date" value={form.checkInDate} onChange={set("checkInDate")} />
        </label>
        {mode === "reference" ? (
          <>
            <label className="mt-5">
              <span className="w-lab">{dict.find.reference}</span>
              <input
                className="w-in num uppercase"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={form.reference}
                onChange={set("reference")}
              />
            </label>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{dict.find.referenceHelp}</p>
            <button type="button" className="w-link mt-5 self-start text-left text-[15px]" onClick={() => setMode("phone")}>
              {dict.find.noReference}
            </button>
          </>
        ) : (
          <>
            <label className="mt-5">
              <span className="w-lab">{dict.find.phoneLast4}</span>
              <input
                className="w-in num tracking-[0.4em]"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                value={form.phoneLast4}
                onChange={(event) =>
                  setForm((value) => ({ ...value, phoneLast4: event.target.value.replace(/\D/g, "").slice(0, 4) }))
                }
              />
            </label>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{dict.find.phoneHelp}</p>
            <button type="button" className="w-link mt-5 self-start text-left text-[15px]" onClick={() => setMode("reference")}>
              {dict.find.useReference}
            </button>
          </>
        )}
        <div className="flex-1" />
        {error ? (
          <p role="alert" className="mb-3 mt-6 text-[14px] text-[var(--error)]">
            {error}
          </p>
        ) : null}
        <button type="submit" className="w-btn mt-6" disabled={pending}>
          {pending ? dict.find.searching : dict.find.submit}
        </button>
      </form>
    </main>
  );
}
