"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { useBeds24CreditLive } from "@/components/shared/beds24-credit-live";
import {
  actorLines,
  creditTexts,
  fillCopy,
  windowHeadLine,
  type Beds24CreditCopy,
  type Beds24CreditDisplay,
  type Beds24CreditTexts,
} from "@/lib/beds24-credit-view";
import type { Beds24CreditSnapshot, Beds24CreditSummary } from "@/lib/beds24/credit-usage-types";
import "./beds24-credit.css";

/**
 * Beds24 크레딧 게이지 — 관리자 콘솔 상단 줄의 공용 자리(2026-11-18, 시안 Main · Popover).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「Beds24 크레딧」 · docs/product/05-admin-web-ia.md 「상단 줄 — Beds24 크레딧 게이지」.
 * 레이아웃(서버)이 `ops_admin.access` 가진 사람에게만 첫 값을 준다 — 없으면 게이지가 아예 없다(실제 차단은 서버 액션).
 */

export const BEDS24_CREDIT_DETAIL_HREF = "/admin/ops/automation#beds24-credit";

type CreditInit = { enabled: boolean; initial: Beds24CreditSnapshot | null };
type CreditLive = ReturnType<typeof useBeds24CreditLive> & { enabled: boolean };
const Beds24CreditContext = createContext<CreditLive | null>(null);

/** 값 받기는 여기 한 곳 — 상단 줄 게이지와 관제실 크레딧 칸이 같은 값 · 같은 30초 주기를 쓴다(두 번 부르지 않게). */
export function Beds24CreditProvider({
  enabled,
  initial,
  serverNow,
  children,
}: CreditInit & { serverNow: number | null; children: ReactNode }) {
  // 서버가 그린 시각 — 붙기 전 첫 그림이 서버 그림과 같은 카운트다운을 쓰게(콘솔 안 이동 뒤엔 1초 시계가 대신한다).
  const live = useBeds24CreditLive(initial, enabled, serverNow);
  return <Beds24CreditContext.Provider value={{ ...live, enabled }}>{children}</Beds24CreditContext.Provider>;
}

/** 레이아웃 공급자 밖(관리자 레이아웃이 아닌 곳)에서는 null. */
export function useBeds24Credit(): CreditLive | null {
  return useContext(Beds24CreditContext);
}

const STATE_CLASS = { ok: "", warn: " cg--warn", stop: " cg--stop", unknown: " cg--unknown" } as const;

export function Beds24CreditGauge({ copy }: { copy: Beds24CreditCopy }) {
  const live = useBeds24Credit();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const refresh = live?.refresh;

  useEffect(() => {
    if (!open || !refresh) return;
    void refresh();
    popRef.current?.focus({ preventScroll: true });
    const onDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // 열 때 한 번만 받는다 — refresh 는 안정된 함수다.
  }, [open, refresh]);

  if (!live?.enabled) return null;
  const { display } = live;
  const texts = creditTexts(display, copy);
  const bar = { "--cg-fill": texts.fill } as CSSProperties;

  return (
    <div className="cgwrap" ref={wrapRef}>
      <button
        aria-controls={open ? popId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={texts.aria}
        className={`cg${STATE_CLASS[display.state]}`}
        data-state={display.state}
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
        type="button"
      >
        <span className="cg__row" aria-hidden="true">
          <span className="cg__lb">{texts.gauge.label}</span>
          <span className={display.state === "unknown" ? "cg__q" : "cg__n"}>{texts.gauge.value}</span>
          {texts.gauge.suffix ? <span className="cg__t">{texts.gauge.suffix}</span> : null}
        </span>
        <span aria-hidden="true" className="cg__bar" style={bar}>
          <i />
        </span>
      </button>

      {open ? (
        <div aria-label={copy.popTitle} className="cgpop" id={popId} ref={popRef} role="dialog" tabIndex={-1}>
          <CreditSummaryBody
            copy={copy}
            failed={live.failed && !live.summary}
            loading={!live.summary}
            onRetry={() => void live.refresh()}
            state={display.state}
            summary={live.summary}
            texts={texts}
          />
          <Link className="cgpop__more" href={BEDS24_CREDIT_DETAIL_HREF} onClick={() => setOpen(false)}>
            {copy.more}
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** 요약 창 몸통 — 큰 숫자 · 막대 · 한 줄 설명 · 지금 5분 동안 쓴 곳. */
function CreditSummaryBody({
  state,
  texts,
  summary,
  loading,
  failed,
  onRetry,
  copy,
}: {
  state: Beds24CreditDisplay["state"];
  texts: Beds24CreditTexts;
  summary: Beds24CreditSummary | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  copy: Beds24CreditCopy;
}) {
  const actors = summary?.actors.slice(0, 4) ?? [];

  return (
    <div className={`cgpop__body cgpop--${state}`}>
      <div className="cgpop__n">
        <b>{texts.big.value}</b>
        <span>{texts.big.suffix}</span>
      </div>
      <div
        aria-label={fillCopy(copy.percentAria, { n: Math.round(texts.fill * 100) })}
        className="cgpop__bar"
        role="img"
        style={{ "--cg-fill": texts.fill } as CSSProperties}
      >
        <i />
      </div>
      <p className="cgpop__sub">{texts.sub}</p>

      {failed ? (
        <div className="cgpop__msg" role="alert">
          <span>{copy.loadError}</span>
          <button onClick={onRetry} type="button">
            <RefreshCw aria-hidden="true" />
            {copy.retry}
          </button>
        </div>
      ) : loading ? (
        <div aria-busy="true" className="cgpop__loading">
          <span className="sr-only">{copy.loading}</span>
          <i />
          <i />
          <i />
        </div>
      ) : summary ? (
        <>
          <div className="cgpop__lh">{windowHeadLine(summary.windowUsed, copy)}</div>
          {actors.length === 0 ? (
            <div className="cgpop__empty">{copy.windowEmpty}</div>
          ) : (
            <ul className="cgpop__list">
              {actors.map((actor) => {
                const lines = actorLines(actor, copy);
                return (
                  <li className="cgpop__row" key={actor.key}>
                    <span aria-hidden="true" className={`cgwho${actor.kind === "user" ? "" : " cgwho--auto"}`}>
                      {actor.kind === "user" ? lines.initial : actor.kind === "auto" ? <RefreshCw /> : <ExternalLink />}
                    </span>
                    <span className="cgpop__who">
                      {lines.name}
                      {lines.sub ? <small>{lines.sub}</small> : null}
                    </span>
                    <b>{actor.credits.toLocaleString()}</b>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
