"use client";

import { useState, type ReactNode } from "react";

import {
  ROUTE_CITIES,
  ROUTE_TEXT_MAX,
  routeChoiceOf,
  routeValueOf,
  type RouteChoice,
  type RouteCity,
  type RouteDirection,
} from "@/lib/guest/route";
import type { Dictionary } from "@/lib/i18n";

import { BedIcon, CheckIcon, PlaneIcon } from "./icons";

// 어디서 오셔서 어디로 가세요(시안 W3s) — 대표자 화면과 「바꾸기」를 누른 동행자 화면이 같이 쓴다.
// 값은 명부에 적는 짧은 일본어(`lib/guest/route.ts`)로 부모에게 올려 보낸다. 아직 덜 고른 상태는 빈 글.

type Mode = "border" | "japan" | null;
type Pick = RouteCity | "other" | null;
type Answer = { mode: Mode; pick: Pick; text: string };

function answerOf(direction: RouteDirection, value: string): Answer {
  const choice = routeChoiceOf(direction, value);
  if (!choice) return { mode: null, pick: null, text: "" };
  if (choice.kind === "border") return { mode: "border", pick: null, text: "" };
  if (choice.kind === "city") return { mode: "japan", pick: choice.city, text: "" };
  return { mode: "japan", pick: "other", text: choice.text };
}

function valueOf(direction: RouteDirection, answer: Answer): string {
  let choice: RouteChoice | null = null;
  if (answer.mode === "border") choice = { kind: "border" };
  else if (answer.mode === "japan" && answer.pick === "other") choice = { kind: "other", text: answer.text };
  else if (answer.mode === "japan" && answer.pick && answer.pick !== "other") choice = { kind: "city", city: answer.pick };
  return (choice && routeValueOf(direction, choice)) ?? "";
}

type Copy = Dictionary["route"];

function Radio({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-[22px] shrink-0 place-items-center rounded-full border ${
        selected ? "border-[var(--text)] bg-[var(--text)] text-[var(--ink)]" : "border-[var(--line-strong)]"
      }`}
    >
      {selected ? <CheckIcon className="size-3.5" /> : null}
    </span>
  );
}

function Question(props: {
  direction: RouteDirection;
  copy: Copy;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { direction, copy, disabled } = props;
  const [answer, setAnswer] = useState(() => answerOf(direction, props.value));
  const prev = direction === "prev";
  const title = prev ? copy.prevQ : copy.nextQ;
  const hint = prev ? copy.prevHint : copy.nextHint;

  function update(next: Answer) {
    setAnswer(next);
    props.onChange(valueOf(direction, next));
  }

  const rowClass = (selected: boolean) =>
    `block w-full rounded-md bg-[var(--surface)] text-left ${
      selected ? "border-2 border-[var(--text)] p-[15px]" : "border border-[var(--line)] p-4"
    }`;

  const row = (mode: "border" | "japan", label: string, small: string, icon: ReactNode, extra?: ReactNode) => {
    const selected = answer.mode === mode;
    return (
      <div className={rowClass(selected)}>
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          onClick={() => update(mode === "border" ? { mode, pick: null, text: "" } : { ...answer, mode })}
          className="flex min-h-[30px] w-full items-center gap-3 text-left"
        >
          <span className="shrink-0 text-[var(--muted)]">{icon}</span>
          <span className="flex-1">
            <span className="block text-[17px] leading-snug">{label}</span>
            <span className="mt-0.5 block text-[14px] leading-snug text-[var(--muted)]">{small}</span>
          </span>
          <Radio selected={selected} />
        </button>
        {selected ? extra : null}
      </div>
    );
  };

  const cities = (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label={copy.pickCity}>
        {(Object.keys(ROUTE_CITIES) as RouteCity[]).map((city) => (
          <Chip key={city} on={answer.pick === city} disabled={disabled} onClick={() => update({ ...answer, pick: city })}>
            {copy.city[city]}
          </Chip>
        ))}
        <Chip on={answer.pick === "other"} disabled={disabled} onClick={() => update({ ...answer, pick: "other" })}>
          {copy.other}
        </Chip>
      </div>
      {answer.pick === "other" ? (
        <input
          className="w-in mt-3"
          maxLength={ROUTE_TEXT_MAX}
          placeholder={copy.otherPlaceholder}
          aria-label={copy.otherPlaceholder}
          autoComplete="off"
          disabled={disabled}
          value={answer.text}
          onChange={(event) => update({ ...answer, text: event.target.value })}
        />
      ) : null}
    </div>
  );

  return (
    <div role="radiogroup" aria-label={title}>
      <h2 className="text-[18px] font-semibold leading-snug">{title}</h2>
      <p className="mt-1 text-[14px] text-[var(--muted)]">{hint}</p>
      <div className="mt-3 flex flex-col gap-2">
        {row(
          "border",
          prev ? copy.prevBorder : copy.nextBorder,
          prev ? copy.prevBorderHint : copy.nextBorderHint,
          <PlaneIcon />,
        )}
        {row("japan", prev ? copy.prevJapan : copy.nextJapan, copy.pickCity, <BedIcon />, cities)}
      </div>
    </div>
  );
}

function Chip(props: { on: boolean; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`h-11 rounded-md border px-4 text-[16px] ${
        props.on ? "border-[var(--text)] bg-[var(--text)] font-medium text-[var(--ink)]" : "border-[var(--line-strong)]"
      }`}
    >
      {props.children}
    </button>
  );
}

export function RouteQuestions(props: {
  copy: Copy;
  prevStay: string;
  nextDest: string;
  disabled?: boolean;
  onChange: (next: { prevStay?: string; nextDest?: string }) => void;
}) {
  const disabled = !!props.disabled;
  return (
    <div className="flex flex-col gap-6">
      <Question direction="prev" copy={props.copy} value={props.prevStay} disabled={disabled} onChange={(prevStay) => props.onChange({ prevStay })} />
      <Question direction="next" copy={props.copy} value={props.nextDest} disabled={disabled} onChange={(nextDest) => props.onChange({ nextDest })} />
    </div>
  );
}

/** 「같은 값」 요약 한 줄 — 명부의 짧은 일본어 값을 화면 언어의 문구로. */
export function routeSummary(copy: Copy, prevStay: string, nextDest: string): string {
  const place = (choice: RouteChoice) => (choice.kind === "city" ? copy.city[choice.city] : choice.kind === "other" ? choice.text : "");
  const part = (direction: RouteDirection, value: string): string => {
    const choice = routeChoiceOf(direction, value);
    if (!choice) return "";
    if (choice.kind === "border") return direction === "prev" ? copy.sumPrevBorder : copy.sumNextBorder;
    return (direction === "prev" ? copy.sumPrev : copy.sumNext).replace("{place}", place(choice));
  };
  return [part("prev", prevStay), part("next", nextDest)].filter(Boolean).join(" · ");
}
