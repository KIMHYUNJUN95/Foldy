"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { fetchCreditDetail, useBeds24CreditLive } from "@/components/shared/beds24-credit-live";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import {
  actorLines,
  creditPollMs,
  creditTexts,
  showCreditLoadError,
  featureLabel,
  fillCopy,
  sharePercent,
  windowHeadLine,
  type Beds24CreditCopy,
  type Beds24CreditTexts,
} from "@/lib/beds24-credit-view";
import type { Beds24CreditActorUsage, Beds24CreditDetail, Beds24CreditSnapshot } from "@/lib/beds24/credit-usage-types";
import "./beds24-credit-mobile.css";

/**
 * 모바일 Beds24 크레딧(2026-11-18, 시안 Mobile).
 *
 * - `MobileCreditNote` — 판매 캘린더 맨 위 한 줄. **주의 · 쉬는 중일 때만** 보인다(넉넉하거나 모르면 아무것도 없다 — 지금과 같음).
 *   누르면 공용 `BottomSheet` 로 지금 5분 동안 누가 쓰는지.
 * - `MobileCreditSection` — 모바일 자동화 목록 아래 크레딧 칸(남은 양 · 오늘 누가 · 어디에).
 *
 * 값은 우리 DB 기록을 읽는 서버 액션만 부른다(Beds24 를 부르지 않는다). 도메인 계약: docs/product/36-automation-control.md 「Beds24 크레딧」.
 */

export function MobileCreditNote({
  initial,
  copy,
  serverNow,
}: {
  initial: Beds24CreditSnapshot | null;
  copy: Beds24CreditCopy;
  /** 서버가 그린 시각 — 서버 그림과 붙기 전 첫 그림이 같은 상태 · 같은 카운트다운 글자를 쓰게(흔들림 없음). */
  serverNow: number | null;
}) {
  const live = useBeds24CreditLive(initial, true, serverNow);
  const [open, setOpen] = useState(false);
  const [userFailed, setUserFailed] = useState(false);
  // 직접 누른 다시 받기 — 실패는 바로 줄 + 햅틱 error, 성공은 풀림. 밀려 버려진 응답은 아무것도 바꾸지 않는다.
  const retry = async () => {
    const result = await live.refresh();
    if (result === "failed") {
      setUserFailed(true);
      haptic("error");
    } else if (result === "ok") setUserFailed(false);
  };
  const texts = creditTexts(live.display, copy);
  // 줄이 사라질 때 접히는 동안 마지막 글자를 들고 있는다(바로 비우면 접힘 없이 뚝 사라진다).
  const [lastNote, setLastNote] = useState(texts.note);
  if (texts.note && (texts.note.label !== lastNote?.label || texts.note.value !== lastNote?.value)) setLastNote(texts.note);
  const shown = texts.note ?? lastNote;
  const visible = texts.note !== null;

  return (
    <>
      <div aria-hidden={visible ? undefined : true} className={`mcr-fold${visible ? " is-open" : ""}`} inert={!visible}>
        <div className="mcr-fold__in">
          {shown ? (
            <button
              aria-haspopup="dialog"
              aria-label={`${shown.label}${shown.value ? ` · ${shown.value}` : ""}. ${copy.noteOpen}`}
              className={`mcr-note mcr-note--${live.display.state === "stop" ? "stop" : "warn"}`}
              onClick={() => {
                haptic("light");
                setOpen(true);
                void live.refresh();
              }}
              type="button"
            >
              <span className="mcr-note__t">{shown.label}</span>
              {shown.value ? <span className="mcr-note__v">{shown.value}</span> : null}
              <ChevronRight aria-hidden="true" className="mcr-note__chev" />
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <BottomSheet ariaLabel={copy.title} onClose={() => setOpen(false)}>
          <div className={`mcr-sheet mcr--${live.display.state}`}>
            <CreditHead copy={copy} texts={texts} />
            {live.failed && !live.summary ? (
              <ErrorLine copy={copy} onRetry={() => void retry()} />
            ) : !live.summary ? (
              <Loading copy={copy} />
            ) : (
              <>
                {showCreditLoadError(userFailed, live.failures) ? <ErrorLine copy={copy} onRetry={() => void retry()} /> : null}
                <div className="mcr-lh">{windowHeadLine(live.summary.windowUsed, copy)}</div>
                <ActorRows actors={live.summary.actors} copy={copy} empty={copy.windowEmpty} />
              </>
            )}
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}

/** 큰 숫자(쉬는 중이면 풀리는 시각) + 옆 글자 + 막대 + 한 줄 설명 — 판정은 `creditTexts()` 하나. */
function CreditHead({ texts, copy }: { texts: Beds24CreditTexts; copy: Beds24CreditCopy }) {
  return (
    <>
      <div className="mcr-n">
        <b>{texts.big.value}</b>
        <span>{texts.big.suffix}</span>
      </div>
      <div
        aria-label={fillCopy(copy.percentAria, { n: Math.round(texts.fill * 100) })}
        className="mcr-bar"
        role="img"
        style={{ "--cg-fill": texts.fill } as CSSProperties}
      >
        <i />
      </div>
      <p className="mcr-sub">{texts.sub}</p>
    </>
  );
}

function ActorRows({ actors, copy, empty, total }: { actors: Beds24CreditActorUsage[]; copy: Beds24CreditCopy; empty: string; total?: number }) {
  if (actors.length === 0) return <div className="mcr-empty">{empty}</div>;
  return (
    <ul className="mcr-list">
      {actors.map((actor) => {
        const lines = actorLines(actor, copy);
        return (
          <li className="mcr-row" key={actor.key}>
            <span className="mcr-row__t">
              {lines.name}
              {lines.sub ? <small>{lines.sub}</small> : null}
            </span>
            <b>{actor.credits.toLocaleString()}</b>
            {total !== undefined ? <em>{sharePercent(actor.credits, total)}%</em> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Loading({ copy }: { copy: Beds24CreditCopy }) {
  return (
    <div aria-busy="true" className="mcr-loading">
      <span className="sr-only">{copy.loading}</span>
      <i />
      <i />
      <i />
    </div>
  );
}

function ErrorLine({ copy, onRetry }: { copy: Beds24CreditCopy; onRetry: () => void }) {
  return (
    <div className="mcr-msg" role="alert">
      <span>{copy.loadError}</span>
      <button
        onClick={() => {
          haptic("light");
          onRetry();
        }}
        type="button"
      >
        <RefreshCw aria-hidden="true" />
        {copy.retry}
      </button>
    </div>
  );
}

/** 모바일 자동화 — 크레딧 칸. 첫 값은 서버(`getAutomationPageData().credit`, 「오늘」), 큰 숫자는 30초 · 누가/어디에는 10초마다 새로. */
export function MobileCreditSection({
  detail: initialDetail,
  copy,
  serverNow,
}: {
  detail: Beds24CreditDetail | null;
  copy: Beds24CreditCopy;
  serverNow: number | null;
}) {
  const [detail, setDetail] = useState(initialDetail);
  const [userFailed, setUserFailed] = useState(false);
  const live = useBeds24CreditLive(detail?.snapshot ?? null, true, serverNow);
  const texts = creditTexts(live.display, copy);
  const state = live.display.state;

  // 탭이 보일 때 10초마다 · 복귀 즉시 우리 DB 만 조용히 다시 읽는다(관제실 칸과 같은 원칙). 겹치면 건너뛰고, 실패하면 옛 값 유지.
  const inFlight = useRef(false);
  const shared = useRef(live);
  useEffect(() => {
    shared.current = live;
  });
  // force — 「다시 받기」 버튼은 탭 상태 · 겹침과 상관없이 바로 읽는다(같은 읽기 경로 · 같은 순번 규칙).
  const poll = useCallback(async (force = false) => {
    if (!force && (inFlight.current || document.visibilityState !== "visible")) return;
    inFlight.current = true;
    const token = shared.current.begin();
    const result = await fetchCreditDetail("today");
    inFlight.current = false;
    if (!result.ok) {
      shared.current.fail(token);
      // 직접 누른 다시 받기의 실패는 바로 보인다 — 조용한 갱신 실패는 실패 횟수로만(PC 와 같은 판정).
      if (force) {
        setUserFailed(true);
        haptic("error");
      }
      return;
    }
    setUserFailed(false);
    setDetail(result.data);
    shared.current.commit(token, result.data.snapshot);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => void poll(), creditPollMs("today"));
    const onBack = () => void poll();
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [poll]);
  const limit = live.display.limit;

  return (
    <section aria-labelledby="mcr-title" className={`mcr-sec mcr--${state}`} id="beds24-credit">
      <div className="mcr-sec__h">
        <h2 id="mcr-title">{copy.title}</h2>
        <span>{fillCopy(copy.sub, { limit })}</span>
      </div>
      <CreditHead copy={copy} texts={texts} />
      {!detail || showCreditLoadError(userFailed, live.failures) ? (
        <ErrorLine copy={copy} onRetry={() => void poll(true)} />
      ) : null}
      {detail ? (
        <>
          <div className="mcr-lh">
            {copy.mobileWho}
            <span>{fillCopy(copy.rangeTotal.today, { n: detail.total.toLocaleString() })}</span>
          </div>
          <ActorRows actors={detail.actors.slice(0, 5)} copy={copy} empty={copy.emptyRange} total={detail.total} />
          <div className="mcr-lh">{copy.mobileWhere}</div>
          {detail.features.length === 0 ? (
            <div className="mcr-empty">{copy.emptyRange}</div>
          ) : (
            <ul className="mcr-list">
              {detail.features.slice(0, 6).map((item) => (
                <li className="mcr-row" key={item.feature}>
                  <span className="mcr-row__t">{featureLabel(item.feature, copy)}</span>
                  <b>{item.credits.toLocaleString()}</b>
                  <em>{sharePercent(item.credits, detail.total)}%</em>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
