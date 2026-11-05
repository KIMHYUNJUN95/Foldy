"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addressError, type AddressError } from "@/lib/guest/address";
import { guestCountText, messageAfterEdit, recomputeFieldError } from "@/lib/guest/address-form-state";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";

import { BackIcon, CheckIcon } from "./icons";
import { LangSwitch } from "./lang-switch";

// 사는 곳 주소(재수정 2 · A5 대표자 한 칸 · A6 「모두 같아요?」 · A7 다른 분만 따로).
// 글자 규칙: 외국인은 영문만, 일본 거주자는 일본어도 가능(운영 선택 — 법 해석 아님). 서버(PUT /api/guest/[token]/address)가 다시 검사한다.

type Guest = { id: string; name: string; isRepresentative: boolean; isChild: boolean; hasJapanAddress: boolean; address: string };
type Copy = Dictionary["address"];

type Props = {
  token: string;
  locale: Locale;
  dict: { address: Copy; common: Dictionary["common"] };
  guests: Guest[];
  nextHref: string;
  backHref: string;
};

const MESSAGE: Record<AddressError, keyof Copy> = { too_short: "errShort", too_long: "errLong", not_latin: "errLatin" };

function AddressField({
  guest,
  value,
  error,
  label,
  copy,
  onChange,
  autoFocus,
}: {
  guest: Guest;
  value: string;
  error: string | null;
  label: string;
  copy: Copy;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const latin = !guest.hasJapanAddress;
  return (
    <label className="block">
      <span className="w-lab">{label}</span>
      <textarea
        className="w-in w-ta"
        rows={3}
        autoFocus={autoFocus}
        autoComplete="street-address"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        lang={latin ? "en" : undefined}
        maxLength={400}
        placeholder={copy.placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `err-${guest.id}` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="mt-2 block text-[14px] text-[var(--muted)]">{copy.hint}</span>
      {latin ? <span className="mt-1 block text-[14px] text-[var(--muted)]">{copy.latinNote}</span> : null}
      {error ? (
        <span id={`err-${guest.id}`} role="alert" className="mt-1 block text-[14px] text-[var(--error)]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function AddressForm({ token, locale, dict, guests, nextHref, backHref }: Props) {
  const router = useRouter();
  const copy = dict.address;
  const representative = guests.find((guest) => guest.isRepresentative) ?? guests[0];
  const others = guests.filter((guest) => guest.id !== representative.id);
  const [step, setStep] = useState<"rep" | "others">("rep");
  const [repText, setRepText] = useState(representative.address);
  // 저장된 주소가 대표자와 다른 사람은 「다른 분」으로 미리 눌러 둔다.
  const [own, setOwn] = useState<Record<string, string>>(() =>
    Object.fromEntries(others.filter((guest) => guest.address && guest.address !== representative.address).map((guest) => [guest.id, guest.address])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const checkOne = (guest: Guest, text: string): string | null => {
    const code = addressError(text, guest.hasJapanAddress);
    return code ? (copy[MESSAGE[code]] as string) : null;
  };

  // 빨간 칸에 글을 고쳐 쓰면 그 칸의 오류를 새 글로 다시 판정하고, 빨간 칸이 없어지면 아래 안내도 지운다(다음 제출을 기다리지 않음).
  function editedError(guest: Guest, text: string) {
    const blank = !text.trim() && guest.id !== representative.id;
    const next = recomputeFieldError(errors, guest.id, blank ? copy.errPick : checkOne(guest, text));
    if (next === errors) return;
    setErrors(next);
    setMessage((old) => messageAfterEdit(next, old));
  }

  function checkRep(): boolean {
    const error = checkOne(representative, repText);
    setErrors(error ? { [representative.id]: error } : {});
    setMessage(error ? copy.invalid : null);
    return !error;
  }

  function checkOthers(): boolean {
    const next: Record<string, string> = {};
    const repError = checkOne(representative, repText);
    if (repError) next[representative.id] = repError;
    for (const guest of others) {
      if (!(guest.id in own)) continue;
      const error = own[guest.id].trim() ? checkOne(guest, own[guest.id]) : copy.errPick;
      if (error) next[guest.id] = error;
    }
    setErrors(next);
    setMessage(Object.keys(next).length ? copy.invalid : null);
    return Object.keys(next).length === 0;
  }

  function save(selected: Record<string, string>) {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/guest/${token}/address`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            representativeAddress: repText,
            others: Object.entries(selected).map(([guestId, address]) => ({ guestId, address })),
          }),
        });
        const body = (await response.json()) as { ok: boolean; error?: string; fields?: string[] };
        if (!body.ok) {
          if (body.error === "invalid") {
            const next: Record<string, string> = {};
            for (const field of body.fields ?? []) next[field === "address" ? representative.id : field.replace("address.", "")] = copy.errShort;
            setErrors(next);
            setMessage(copy.invalid);
          } else {
            setMessage(body.error === "locked" ? copy.locked : copy.error);
          }
          return;
        }
        router.push(nextHref);
        router.refresh();
      } catch {
        setMessage(copy.error);
      }
    });
  }

  const single = others.length === 0;
  const repLabel = fmt(copy.repLabel, { name: representative.name });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
      <div className="flex h-11 items-center justify-between">
        {step === "others" ? (
          <button type="button" className="w-icon" aria-label={copy.back} onClick={() => setStep("rep")}>
            <BackIcon />
          </button>
        ) : (
          <Link href={backHref} className="w-icon" aria-label={dict.common.back}>
            <BackIcon />
          </Link>
        )}
        <LangSwitch locale={locale} label={dict.common.language} />
      </div>

      {step === "rep" ? (
        <form
          className="mt-4 flex flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (single && checkRep()) save({});
          }}
        >
          <h1 className="w-h text-[28px]">{copy.title}</h1>
          <p className="mt-2 text-[15px] text-[var(--muted)]">{copy.sub}</p>
          <fieldset disabled={pending} className="mt-6 min-w-0">
            <AddressField
              guest={representative}
              value={repText}
              error={errors[representative.id] ?? null}
              label={single ? copy.label : repLabel}
              copy={copy}
              onChange={(value) => {
                setRepText(value);
                editedError(representative, value);
              }}
              autoFocus={!repText}
            />
          </fieldset>

          {!single ? (
            <div className="mt-8">
              <p className="text-[17px] font-medium">{fmt(copy.question, { n: guestCountText(locale, guests.length) })}</p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  className="w-btn"
                  disabled={pending}
                  onClick={() => {
                    if (checkRep()) save({});
                  }}
                >
                  {pending ? copy.saving : copy.yesAll}
                </button>
                <button
                  type="button"
                  className="w-ghost"
                  disabled={pending}
                  onClick={() => {
                    if (checkRep()) setStep("others");
                  }}
                >
                  {copy.noSome}
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex-1" />
          {message ? (
            <p role="alert" className="mt-4 text-[14px] text-[var(--error)]">
              {message}
            </p>
          ) : null}
          {single ? (
            <button type="submit" className="w-btn mt-4" disabled={pending}>
              {pending ? copy.saving : copy.next}
            </button>
          ) : null}
        </form>
      ) : (
        <form
          className="mt-4 flex flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!checkOthers()) return;
            const selected = Object.fromEntries(others.filter((guest) => guest.id in own).map((guest) => [guest.id, own[guest.id]]));
            save(selected);
          }}
        >
          <h1 className="w-h text-[28px]">{copy.diffTitle}</h1>
          <p className="mt-2 text-[15px] text-[var(--muted)]">{fmt(copy.diffSub, { name: representative.name })}</p>
          <fieldset disabled={pending} className="mt-6 flex min-w-0 flex-col gap-3">
            {others.map((guest) => {
              const picked = guest.id in own;
              return (
                <div key={guest.id} className="rounded-md border border-[var(--line)] bg-[var(--surface)]">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={picked}
                    className="flex min-h-[64px] w-full items-center gap-3.5 px-4 text-left"
                    onClick={() =>
                      setOwn((current) => {
                        const { [guest.id]: removed, ...rest } = current;
                        void removed;
                        return picked ? rest : { ...current, [guest.id]: "" };
                      })
                    }
                  >
                    <span
                      aria-hidden
                      className={`grid size-[22px] shrink-0 place-items-center rounded-full border ${
                        picked ? "border-[var(--text)] bg-[var(--text)] text-[var(--ink)]" : "border-[var(--line-strong)]"
                      }`}
                    >
                      {picked ? <CheckIcon className="size-3.5" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <b className="break-words text-[17px] font-medium">{guest.name}</b>
                      <small className="text-[15px] text-[var(--muted)]">
                        {picked ? copy.differs : fmt(copy.sameAs, { name: representative.name })}
                        {guest.isChild ? ` · ${copy.child}` : ""}
                      </small>
                    </span>
                  </button>
                  {picked ? (
                    <div className="px-4 pb-4">
                      <AddressField
                        guest={guest}
                        value={own[guest.id]}
                        error={errors[guest.id] ?? null}
                        label={fmt(copy.repLabel, { name: guest.name })}
                        copy={copy}
                        autoFocus
                        onChange={(value) => {
                          setOwn((current) => ({ ...current, [guest.id]: value }));
                          editedError(guest, value);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          <div className="flex-1" />
          {errors[representative.id] || message ? (
            <p role="alert" className="mt-4 text-[14px] text-[var(--error)]">
              {errors[representative.id] ?? message}
            </p>
          ) : null}
          <button type="submit" className="w-btn mt-4" disabled={pending}>
            {pending ? copy.saving : copy.next}
          </button>
        </form>
      )}
    </main>
  );
}
