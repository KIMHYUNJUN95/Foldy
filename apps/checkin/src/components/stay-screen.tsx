import Link from "next/link";

import { afterPeopleHref, guestEntries, needsAddress } from "@/lib/guest/page";
import type { StayView } from "@/lib/guest/store";
import { fmt, formatStayDate, formatTokyoTime, getDictionary, nightsBetween, type Locale } from "@/lib/i18n";

import { CheckIcon, ChevronIcon } from "./icons";
import { LangSwitch } from "./lang-switch";
import { SeatRemover } from "./seat-remover";

// 개인 링크 화면: 체크인 뒤 → W5 읽기 전용, 다 넣고 동의함 → W4 끝(코드), 그 밖 → W2 사람 목록.

export function StayScreen({ stay, token, locale, view }: { stay: StayView; token: string; locale: Locale; view?: string }) {
  const dict = getDictionary(locale);
  const building = (dict.buildings as Record<string, string>)[stay.propertyKey] ?? stay.propertyKey;
  const nights = nightsBetween(stay.checkInDate, stay.checkOutDate);
  const ordinal = (n: number) => fmt(dict.guests.ordinal, { n });
  const entries = guestEntries(stay, token, ordinal);
  const doneCount = entries.filter((entry) => entry.done).length;
  const addressPending = needsAddress(stay);
  const allDone = entries.length > 0 && doneCount === entries.length && !addressPending;
  const representative = stay.guests.find((guest) => guest.is_representative);

  const top = (
    <div className="flex h-11 items-center justify-end">
      <LangSwitch locale={locale} label={dict.common.language} />
    </div>
  );

  if (stay.status === "checked_in") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
        {top}
        <h1 className="w-h mt-8 text-[30px]">{dict.readonly.title}</h1>
        {stay.checkedInAt ? (
          <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">
            {fmt(dict.readonly.body, { when: formatTokyoTime(locale, stay.checkedInAt, true) })}
          </p>
        ) : null}
        <dl className="mt-7 divide-y divide-[var(--line)] rounded-md bg-[var(--surface)] px-4">
          <div className="flex justify-between gap-4 py-3.5">
            <dt className="text-[14px] text-[var(--muted)]">{dict.readonly.room}</dt>
            <dd className="text-right text-[16px] font-medium">
              {building} · {stay.rooms.join(", ")}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-3.5">
            <dt className="text-[14px] text-[var(--muted)]">{dict.readonly.stay}</dt>
            <dd className="num text-right text-[16px] font-medium">
              {formatStayDate(locale, stay.checkInDate, false)} ~ {formatStayDate(locale, stay.checkOutDate, false)} ·{" "}
              {fmt(nights === 1 ? dict.guests.nightsOne : dict.guests.nightsOther, { n: nights })}
            </dd>
          </div>
        </dl>
        <h2 className="mt-7 text-[14px] text-[var(--muted)]">{fmt(dict.readonly.registry, { n: stay.guests.length })}</h2>
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {stay.guests.map((guest) => (
            <li key={guest.id} className="flex items-center justify-between py-3.5">
              <span className="text-[16px] font-medium">{guest.name_roman}</span>
              <span className="text-[15px] text-[var(--muted)]">
                {guest.is_representative
                  ? dict.guests.rep
                  : guest.guest_type === "child"
                    ? dict.readonly.child
                    : dict.readonly.companion}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[14px] leading-relaxed text-[var(--muted)]">{dict.readonly.note}</p>
      </main>
    );
  }

  if (allDone && stay.consented && view !== "list") {
    const code = stay.checkinCode ?? "";
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
        {top}
        <h1 className="w-h mt-8 text-[34px]">
          {dict.done.title1}
          <br />
          {dict.done.title2}
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">
          {fmt(dict.done.body, { n: stay.guests.length })}
        </p>
        <div className="mt-8 rounded-md bg-[var(--sand)] p-5 text-[var(--ink)]">
          <p className="text-[14px] opacity-80">{dict.done.codeLabel}</p>
          <p className="num mt-2 text-[48px] font-medium tracking-[0.08em]" aria-label={code.split("").join(" ")}>
            {code.slice(0, 3)} {code.slice(3)}
          </p>
        </div>
        <ol className="mt-7 space-y-4 text-[16px] leading-relaxed">
          {[dict.done.step1, dict.done.step2, dict.done.step3].map((line, index) => (
            <li key={line} className="flex gap-3">
              <span className="num w-4 text-[14px] leading-7 text-[var(--muted)]">{index + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
        <div className="flex-1" />
        <Link href={`/r/${token}?view=list`} className="w-ghost mt-8">
          {dict.done.view}
        </Link>
      </main>
    );
  }

  const nextEntry = entries.find((entry) => !entry.done);
  const summary = [
    building,
    `${fmt(dict.guests.from, { date: formatStayDate(locale, stay.checkInDate, false) })} ${fmt(
      nights === 1 ? dict.guests.nightsOne : dict.guests.nightsOther,
      { n: nights },
    )}`,
    fmt(entries.length === 1 ? dict.guests.peopleOne : dict.guests.peopleOther, { n: entries.length }),
  ].join(", ");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
      {top}
      <h1 className="w-h mt-6 text-[30px]">
        {fmt(dict.guests.title, { name: representative?.name_roman || ordinal(1) })}
      </h1>
      <p className="num mt-2.5 text-[15px] text-[var(--muted)]">{summary}</p>

      <div className="mt-6 rounded-md bg-[var(--surface)] p-4">
        <div className="flex justify-between text-[14px]">
          <span>{fmt(dict.guests.progress, { done: doneCount, total: entries.length })}</span>
          <span className="num text-[var(--muted)]">
            {doneCount} / {entries.length}
          </span>
        </div>
        <div className="mt-2.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
          {entries.map((entry) => (
            <i key={entry.key} className={`h-1 rounded-sm ${entry.done ? "bg-[var(--text)]" : "bg-[var(--line)]"}`} />
          ))}
        </div>
      </div>

      <ul className="mt-6 flex flex-col gap-2">
        {entries.map((entry, index) => {
          const isNext = entry === nextEntry;
          const sub = entry.isRepresentative
            ? entry.hasPhoto
              ? dict.guests.repPhoto
              : dict.guests.rep
            : entry.isChild
              ? dict.guests.childHint
              : dict.guests.companionHint;
          return (
            <li key={entry.key}>
              <Link
                href={entry.href}
                className={`flex min-h-[72px] items-center gap-3.5 rounded-md border bg-[var(--surface)] px-4 ${
                  isNext ? "border-[var(--line-strong)]" : "border-[var(--line)]"
                }`}
              >
                <span className="num w-3.5 text-[14px] text-[var(--muted)]">{index + 1}</span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <b className="text-[17px] font-medium">{entry.label}</b>
                  <small className="text-[15px] text-[var(--muted)]">{sub}</small>
                </span>
                {entry.done ? (
                  <span className="inline-flex items-center gap-1 text-[15px] text-[var(--sage)]">
                    <CheckIcon />
                    {dict.guests.done}
                  </span>
                ) : isNext ? (
                  <span className="text-[15px] text-[var(--sand)]">{dict.guests.next}</span>
                ) : (
                  <span className="text-[15px] text-[var(--muted)]">{dict.guests.left}</span>
                )}
                <ChevronIcon className="size-4 text-[var(--muted)]" />
              </Link>
            </li>
          );
        })}
      </ul>

      {stay.editable ? (
        <>
          <Link href={`/r/${token}/guest/new`} className="w-ghost mt-3">
            {dict.guests.add}
          </Link>
          {entries.some((entry) => entry.placeholder) ? (
            <div className="mt-3 flex justify-center">
              <SeatRemover
                token={token}
                guestId={null}
                label={dict.guests.removeSeat}
                confirm={dict.guests.removeSeatConfirm}
                remove={dict.common.remove}
                cancel={dict.common.cancel}
                error={dict.common.error}
              />
            </div>
          ) : null}
          {entries.every((entry) => entry.done) && !addressPending ? (
            <Link href={`/r/${token}/address`} className="w-ghost mt-3">
              {dict.guests.editAddress}
            </Link>
          ) : null}
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">{dict.guests.share}</p>
        </>
      ) : null}
      <div className="flex-1" />
      {stay.editable ? (
        nextEntry ? (
          <Link href={nextEntry.href} className="w-btn mt-8">
            {fmt(dict.guests.fillNext, { label: nextEntry.label })}
          </Link>
        ) : addressPending ? (
          <Link href={afterPeopleHref(token, true, stay.consented)} className="w-btn mt-8">
            {dict.guests.toAddress}
          </Link>
        ) : !stay.consented ? (
          <Link href={`/r/${token}/terms`} className="w-btn mt-8">
            {dict.guests.toTerms}
          </Link>
        ) : (
          <Link href={`/r/${token}`} className="w-btn mt-8">
            {dict.guests.showCode}
          </Link>
        )
      ) : null}
    </main>
  );
}
