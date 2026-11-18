"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useBeds24Credit } from "@/components/admin/beds24-credit-gauge";
import { fetchCreditDetail, useBeds24CreditLive } from "@/components/shared/beds24-credit-live";
import {
  actorLines,
  barCaption,
  pauseSummaryLine,
  chartLines,
  creditPollMs,
  creditTexts,
  featureLabel,
  fillCopy,
  sharePercent,
  showCreditLoadError,
  type Beds24CreditCopy,
} from "@/lib/beds24-credit-view";
import type { Beds24CreditCall, Beds24CreditDetail, Beds24CreditRange } from "@/lib/beds24/credit-usage-types";
import "@/components/admin/beds24-credit.css";

/**
 * 자동화 관제실 — Beds24 크레딧 칸(2026-11-18, 시안 Detail). 상단 줄 요약 창의 「자세히 보기」가 여기(`#beds24-credit`)로 온다.
 *
 * 도메인 계약: docs/product/36-automation-control.md 「Beds24 크레딧」.
 * 첫 값은 서버(`getAutomationPageData` → `credit`)가 「오늘」로 준다. 기간을 바꾸면 상세 액션을 다시 부른다.
 * 큰 숫자 · 남은 시간은 상단 줄 게이지와 같은 값(레이아웃 공급자)을 쓴다 — 이 칸이 받은 스냅샷은 공급자에도 밀어 넣는다(더 늦은 기록이 이김).
 * 탭이 보일 때 10초마다(탭 · 창 복귀 즉시) 우리 DB 만 다시 읽는다 — 로딩 표시 없이 조용히.
 */

const RANGES: Beds24CreditRange[] = ["5m", "1h", "today", "7d"];

export function Beds24CreditPanel({
  initial,
  copy,
  localeTag,
  serverNow,
}: {
  initial: Beds24CreditDetail | null;
  copy: Beds24CreditCopy;
  localeTag: string;
  /** 서버가 그린 시각 — 붙기 전 첫 그림과 서버 그림이 같은 카운트다운을 쓰게. */
  serverNow: number | null;
}) {
  const [range, setRange] = useState<Beds24CreditRange>(initial?.range ?? "today");
  const [detail, setDetail] = useState<Beds24CreditDetail | null>(initial);
  const [failed, setFailed] = useState(initial === null);
  const [pending, setPending] = useState(false);
  const live = useBeds24Credit();
  // 공급자(관리자 레이아웃) 값이 있으면 상단 줄 게이지와 같은 숫자를 쓴다. 없을 때만 이 칸 첫 값으로.
  const local = useBeds24CreditLive(detail?.snapshot ?? null, !live, serverNow);
  const source = live ?? local;
  const display = source.display;
  const texts = creditTexts(display, copy);
  const limit = display.limit;

  // 마지막 요청만 반영한다(요청 번호). 기간 버튼 · 자동 갱신이 같은 번호를 써서 서로 덮지 않는다.
  const seq = useRef(0);
  const inFlight = useRef(0);
  const wantedRange = useRef<Beds24CreditRange>(range);
  const shownRange = useRef<Beds24CreditRange | null>(initial?.range ?? null);
  const shared = useRef(source);
  useEffect(() => {
    shared.current = source;
  });

  const run = useCallback(async (target: Beds24CreditRange, silent: boolean) => {
    const id = ++seq.current;
    wantedRange.current = target;
    inFlight.current += 1;
    const token = shared.current.begin();
    // 로딩 표시는 처음 읽을 때와 기간을 바꿀 때만 — 자동 갱신은 조용히(깜빡임 · 높이 튐 없음).
    if (!silent) setPending(true);
    const result = await fetchCreditDetail(target);
    inFlight.current -= 1;
    if (id !== seq.current) return;
    setPending(false);
    if (!result.ok) {
      shared.current.fail(token);
      // 버튼이 표가 보여 주는 기간과 어긋나지 않게 되돌린다.
      if (shownRange.current) {
        wantedRange.current = shownRange.current;
        setRange(shownRange.current);
      }
      // 조용한 갱신 실패는 낡은 값 기준(실패 횟수)으로만 드러난다 — 누른 요청의 실패만 바로 띠를 띄운다.
      if (!silent) setFailed(true);
      return;
    }
    shownRange.current = result.data.range;
    setRange(result.data.range);
    setFailed(false);
    setDetail(result.data);
    shared.current.commit(token, result.data.snapshot);
  }, []);

  const load = (next: Beds24CreditRange) => {
    setRange(next);
    void run(next, false);
  };

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && inFlight.current === 0) void run(wantedRange.current, true);
    };
    const timer = window.setInterval(tick, creditPollMs(range)); // 7일은 무거워 60초
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [run, range]);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }),
    [localeTag],
  );
  const hmFmt = useMemo(
    () => new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    [localeTag],
  );
  const num = (n: number) => n.toLocaleString(localeTag);

  const pauses = detail?.pausesToday;
  const pauseLine = pauseSummaryLine(pauses, (ms) => hmFmt.format(ms), copy);

  return (
    <section
      aria-busy={pending ? true : undefined}
      aria-labelledby="beds24-credit-title"
      className={`bcd bcd--${display.state}`}
      id="beds24-credit"
    >
      <div className="bcd-hd">
        <h2 id="beds24-credit-title">{copy.title}</h2>
        <span>{fillCopy(copy.sub, { limit })}</span>
        <RangeSeg copy={copy} onChange={load} value={range} />
      </div>

      <div className="bcd-r1">
        <div>
          <div className="bcd-big">
            <b>{texts.big.value}</b>
            <span>{texts.big.suffix}</span>
          </div>
          <div
            aria-label={fillCopy(copy.percentAria, { n: Math.round(texts.fill * 100) })}
            className="bcd-bar"
            role="img"
            style={{ "--cg-fill": texts.fill } as CSSProperties}
          >
            <i />
          </div>
          <p className="bcd-sub">
            {texts.sub}
            {pauseLine ? (
              <>
                <br />
                {pauseLine}
              </>
            ) : null}
          </p>
        </div>
        <div className="bcd-live">
          {detail ? <WindowChart copy={copy} detail={detail} limit={limit} /> : showCreditLoadError(failed, source.failures) ? null : <div className="bcd-skel" />}
        </div>
      </div>

      {showCreditLoadError(failed, source.failures) ? (
        <div className="bcd-msg" role="alert">
          <span>{copy.loadError}</span>
          <button disabled={pending} onClick={() => load(range)} type="button">
            <RefreshCw aria-hidden="true" />
            {copy.retry}
          </button>
        </div>
      ) : null}

      {detail ? (
        <>
          <div className="bcd-r2 bcd-live">
            <div>
              <div className="bcd-lh">
                <b>{copy.whoTitle}</b>
                <span>{fillCopy(copy.rangeTotal[detail.range], { n: num(detail.total) })}</span>
              </div>
              {detail.actors.length === 0 ? (
                <div className="bcd-empty">{copy.emptyRange}</div>
              ) : (
                (() => {
                  const max = Math.max(1, ...detail.actors.map((actor) => actor.credits));
                  return detail.actors.map((actor) => {
                    const lines = actorLines(actor, copy);
                    return (
                      <div className="bcd-row bcd-row--who" key={actor.key}>
                        <span aria-hidden="true" className={`cgwho${actor.kind === "user" ? "" : " cgwho--auto"}`}>
                          {actor.kind === "user" ? lines.initial : actor.kind === "auto" ? <RefreshCw /> : <ExternalLink />}
                        </span>
                        <span>
                          {lines.name}
                          {lines.sub ? <small>{lines.sub}</small> : null}
                        </span>
                        <div aria-hidden="true" className="bcd-m">
                          <i style={{ "--w": actor.credits / max } as CSSProperties} />
                        </div>
                        <b>{num(actor.credits)}</b>
                        <em>{sharePercent(actor.credits, detail.total)}%</em>
                      </div>
                    );
                  });
                })()
              )}
            </div>
            <div>
              <div className="bcd-lh">
                <b>{copy.whereTitle}</b>
                <span>{copy.whereSub}</span>
              </div>
              {detail.features.length === 0 ? (
                <div className="bcd-empty">{copy.emptyRange}</div>
              ) : (
                (() => {
                  const max = Math.max(1, ...detail.features.map((item) => item.credits));
                  return detail.features.map((item) => (
                    <div className="bcd-row" key={item.feature}>
                      <span>{featureLabel(item.feature, copy)}</span>
                      <div aria-hidden="true" className="bcd-m">
                        <i style={{ "--w": item.credits / max } as CSSProperties} />
                      </div>
                      <b>{num(item.credits)}</b>
                      <em>{sharePercent(item.credits, detail.total)}%</em>
                    </div>
                  ));
                })()
              )}
            </div>
          </div>

          <div className="bcd-live">
            <div className="bcd-lh">
              <b>{copy.recentTitle}</b>
            </div>
            {detail.recentCalls.length === 0 ? (
              <div className="bcd-empty">{copy.emptyCalls}</div>
            ) : (
              <div role="table" aria-label={copy.recentTitle}>
                <div className="bcd-log bcd-log--h" role="row">
                  <span role="columnheader">{copy.colTime}</span>
                  <span role="columnheader">{copy.colWho}</span>
                  <span role="columnheader">{copy.colWhat}</span>
                  <span className="n" role="columnheader">{copy.colCost}</span>
                  <span className="n" role="columnheader">{copy.colRemaining}</span>
                </div>
                {detail.recentCalls.map((call) => (
                  <CallRow call={call} copy={copy} key={call.id} time={timeFmt.format(call.at)} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function CallRow({ call, copy, time }: { call: Beds24CreditCall; copy: Beds24CreditCopy; time: string }) {
  const who = call.actor.kind === "user" ? call.actor.name || "—" : copy.auto;
  const what =
    call.itemCount !== null && call.itemCount > 0
      ? `${featureLabel(call.feature, copy)} · ${fillCopy(copy.itemCount, { n: call.itemCount })}`
      : featureLabel(call.feature, copy);
  return (
    <div className="bcd-log" role="row">
      <span role="cell">{time}</span>
      <span role="cell">{who}</span>
      <span role="cell">{what}</span>
      <span className="n" role="cell">
        {call.cost !== null ? <b>{call.cost}</b> : <span className="bad">{fillCopy(copy.callFailed, { code: call.httpStatus ?? "—" })}</span>}
      </span>
      <span className="n" role="cell">{call.remaining ?? "—"}</span>
    </div>
  );
}

/** 기간 — 콘솔 공용 나눔 단추 `.wgseg`(밀리는 손잡이) 모양. */
function RangeSeg({ value, onChange, copy }: { value: Beds24CreditRange; onChange: (next: Beds24CreditRange) => void; copy: Beds24CreditCopy }) {
  const index = RANGES.indexOf(value);
  return (
    <div
      aria-label={copy.rangeAria}
      className="wgseg"
      role="radiogroup"
      style={{ "--n": RANGES.length, "--i": Math.max(index, 0) } as CSSProperties}
    >
      <span aria-hidden="true" className="wgseg__thumb" />
      {RANGES.map((key) => (
        <button
          aria-checked={key === value}
          key={key}
          onClick={() => {
            if (key !== value) onChange(key);
          }}
          role="radio"
          type="button"
        >
          {copy.range[key]}
        </button>
      ))}
    </div>
  );
}

/** 최근 1시간, 5분 창 12개 — 150(리뷰 수집 멈춤) · 190(모두 쉼) 점선. */
function WindowChart({ detail, limit, copy }: { detail: Beds24CreditDetail; limit: number; copy: Beds24CreditCopy }) {
  const bars = detail.bars;
  if (bars.length === 0) return <div className="bcd-empty">{copy.emptyRange}</div>;
  const lastStart = bars[bars.length - 1].startsAt;
  const agoOf = (startsAt: number) => Math.round((lastStart - startsAt) / 60_000);
  const whenOf = (startsAt: number) => {
    const ago = agoOf(startsAt);
    return ago === 0 ? copy.now : fillCopy(copy.agoMin, { n: ago });
  };
  const aria = fillCopy(copy.chartAria, {
    list: bars
      .map((bar) => {
        const item = fillCopy(copy.chartAriaItem, { when: whenOf(bar.startsAt), n: bar.used });
        return bar.level === "stop" ? `${item} (${copy.levelStop})` : bar.level === "warn" ? `${item} (${copy.levelWarn})` : item;
      })
      .join(", "),
  });
  const mid = bars[Math.floor((bars.length - 1) / 2)];

  return (
    <>
      <div className="bcd-ct">
        <span>{copy.chartTitle}</span>
        <span>{copy.chartUnit}</span>
      </div>
      <div aria-label={aria} className="bcd-plot" role="img">
        {chartLines(limit, copy).map((line) => (
          <div className="bcd-th" key={line.used} style={{ "--y": Math.min(1, Math.max(0, 1 - line.used / Math.max(1, limit))) } as CSSProperties}>
            <span>{line.label}</span>
          </div>
        ))}
        <div className="bcd-bars">
          {bars.map((bar, index) => {
            const isNow = index === bars.length - 1;
            const caption = barCaption(bar, isNow);
            const h = Math.min(1, Math.max(0, bar.used / Math.max(1, limit)));
            return (
              <div className={caption?.cls ?? (isNow ? "now" : "")} key={bar.startsAt} style={{ "--h": h } as CSSProperties}>
                <i />
                {caption ? <em>{caption.text}</em> : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="bcd-base" />
      <div className="bcd-xl" aria-hidden="true">
        <span>{whenOf(bars[0].startsAt)}</span>
        <span>{whenOf(mid.startsAt)}</span>
        <span>{copy.now}</span>
      </div>
    </>
  );
}
