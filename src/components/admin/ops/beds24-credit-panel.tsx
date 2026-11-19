"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { useBeds24Credit } from "@/components/admin/beds24-credit-gauge";
import { useBeds24CreditCalls, type Beds24CreditCallsState } from "@/components/shared/beds24-credit-calls";
import { fetchCreditDetail, useBeds24CreditLive } from "@/components/shared/beds24-credit-live";
import {
  actorLines,
  isCreditActorFilterable,
  isCreditCallGroupOpen,
  type CreditCallGroup,
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
  const [calls, callsRoot] = useBeds24CreditCalls(initial);
  const syncCalls = useRef(calls.syncDetail);
  useEffect(() => {
    syncCalls.current = calls.syncDetail;
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
    syncCalls.current(result.data);
    shared.current.commit(token, result.data.snapshot);
  }, []);

  const load = (next: Beds24CreditRange) => {
    setRange(next);
    void run(next, false);
  };

  const refreshCalls = useRef(calls.refreshFiltered);
  useEffect(() => {
    refreshCalls.current = calls.refreshFiltered;
  });
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible" || inFlight.current !== 0) return;
      void run(wantedRange.current, true);
      // 거르기가 걸려 있으면 목록 첫 장은 상세와 따로 읽는다(같은 주기).
      refreshCalls.current();
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
                    const inner = (
                      <>
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
                      </>
                    );
                    // Foldy 밖은 호출 기록이 없어 거를 수 없다 — 누르지 않는 줄.
                    return isCreditActorFilterable(actor) ? (
                      <button
                        aria-describedby="bcd-filter-hint"
                        aria-pressed={calls.filter.actor === actor.key}
                        className="bcd-row bcd-row--who bcd-pick"
                        key={actor.key}
                        onClick={() => calls.toggleFilter("actor", actor.key)}
                        type="button"
                      >
                        {inner}
                      </button>
                    ) : (
                      <div className="bcd-row bcd-row--who" key={actor.key}>
                        {inner}
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
                    <button
                      aria-describedby="bcd-filter-hint"
                      aria-pressed={calls.filter.feature === item.feature}
                      className="bcd-row bcd-pick"
                      key={item.feature}
                      onClick={() => calls.toggleFilter("feature", item.feature)}
                      type="button"
                    >
                      <span>{featureLabel(item.feature, copy)}</span>
                      <div aria-hidden="true" className="bcd-m">
                        <i style={{ "--w": item.credits / max } as CSSProperties} />
                      </div>
                      <b>{num(item.credits)}</b>
                      <em>{sharePercent(item.credits, detail.total)}%</em>
                    </button>
                  ));
                })()
              )}
            </div>
          </div>

          <span className="sr-only" id="bcd-filter-hint">
            {copy.filterHint}
          </span>
          <RecentCalls calls={calls} copy={copy} detail={detail} rootRef={callsRoot} time={(ms) => timeFmt.format(ms)} />
        </>
      ) : null}
    </section>
  );
}

function callWhat(call: Beds24CreditCall, copy: Beds24CreditCopy): string {
  return call.itemCount !== null && call.itemCount > 0
    ? `${featureLabel(call.feature, copy)} · ${fillCopy(copy.itemCount, { n: call.itemCount })}`
    : featureLabel(call.feature, copy);
}

function callWho(call: Beds24CreditCall, copy: Beds24CreditCopy): string {
  return call.actor.kind === "user" ? call.actor.name || "—" : copy.auto;
}

/** 거르기 글자 — 「손님 메시지만」 · 둘 다면 「김 · 손님 메시지만」. 이름은 지금 「누가」 목록에서 찾는다. */
function filterLabel(calls: Beds24CreditCallsState, detail: Beds24CreditDetail, copy: Beds24CreditCopy): string | null {
  const parts: string[] = [];
  if (calls.filter.actor) {
    const actor = detail.actors.find((item) => item.key === calls.filter.actor);
    parts.push(calls.filter.actor === "auto" ? copy.auto : actor?.name || "—");
  }
  if (calls.filter.feature) parts.push(featureLabel(calls.filter.feature, copy));
  return parts.length ? fillCopy(copy.filterOnly, { name: parts.join(" · ") }) : null;
}

/** 최근 호출 — 고른 기간 · 새 것부터 50개씩, 연달아 난 같은 호출은 한 줄(누르면 펼침). */
function RecentCalls({
  calls,
  copy,
  detail,
  rootRef,
  time,
}: {
  calls: Beds24CreditCallsState;
  copy: Beds24CreditCopy;
  detail: Beds24CreditDetail;
  rootRef: RefObject<HTMLDivElement | null>;
  time: (ms: number) => string;
}) {
  const label = filterLabel(calls, detail, copy);
  return (
    <div className="bcd-live bcd-calls" ref={rootRef}>
      <div className="bcd-lh">
        <b>{copy.recentTitle}</b>
        {label ? (
          <span className="bcd-flt">
            {label}
            <button onClick={calls.clearFilter} type="button">
              {copy.filterClear}
            </button>
          </span>
        ) : null}
      </div>
      {calls.loadingHead ? (
        <div aria-busy="true" className="bcd-skel bcd-skel--calls">
          <span className="sr-only">{copy.loading}</span>
        </div>
      ) : calls.empty && !calls.failed ? (
        <div className="bcd-empty">{label ? copy.emptyFiltered : copy.emptyCalls}</div>
      ) : (
        <div aria-label={copy.recentTitle} role="table">
          <div className="bcd-log bcd-log--h" role="row">
            <span role="columnheader">{copy.colTime}</span>
            <span role="columnheader">{copy.colWho}</span>
            <span role="columnheader">{copy.colWhat}</span>
            <span className="n" role="columnheader">{copy.colCost}</span>
            <span className="n" role="columnheader">{copy.colRemaining}</span>
          </div>
          {calls.groups.map((group) =>
            group.calls.length === 1 ? (
              <CallRow call={group.calls[0]} copy={copy} key={group.id} time={time(group.at)} />
            ) : (
              <GroupRows
                copy={copy}
                group={group}
                key={group.id}
                onToggle={() => calls.toggleGroup(group)}
                open={isCreditCallGroupOpen(group, calls.openIds)}
                time={time}
              />
            ),
          )}
        </div>
      )}
      {calls.failed ? (
        <div className="bcd-msg" role="alert">
          <span>{copy.loadError}</span>
          <button onClick={calls.retry} type="button">
            <RefreshCw aria-hidden="true" />
            {copy.retry}
          </button>
        </div>
      ) : null}
      {calls.hasMore && !calls.loadingHead && !calls.failed ? (
        <button aria-busy={calls.loadingMore ? true : undefined} className="bcd-more" disabled={calls.loadingMore} onClick={() => void calls.loadMore()} type="button">
          {calls.loadingMore ? copy.loading : copy.loadMore}
        </button>
      ) : null}
    </div>
  );
}

function CallRow({ call, copy, time, sub = false }: { call: Beds24CreditCall; copy: Beds24CreditCopy; time: string; sub?: boolean }) {
  return (
    <div className={`bcd-log${sub ? " bcd-log--sub" : ""}`} data-row={call.id} role="row">
      <span role="cell">{time}</span>
      <span role="cell">{callWho(call, copy)}</span>
      <span role="cell">{callWhat(call, copy)}</span>
      <span className="n" role="cell">
        {call.cost !== null ? <b>{call.cost}</b> : <span className="bad">{fillCopy(copy.callFailed, { code: call.httpStatus ?? "—" })}</span>}
      </span>
      <span className="n" role="cell">{call.remaining ?? "—"}</span>
    </div>
  );
}

/** 묶음 한 줄 + 펼친 호출들. 펼침은 높이 0fr → 1fr 로 부드럽게(접힌 동안은 inert). */
function GroupRows({
  group,
  copy,
  time,
  open,
  onToggle,
}: {
  group: CreditCallGroup;
  copy: Beds24CreditCopy;
  time: (ms: number) => string;
  open: boolean;
  onToggle: () => void;
}) {
  const head = group.calls[0];
  const subId = `bcd-g-${group.id}`;
  return (
    <>
      <div className="bcd-log bcd-log--g" data-row={group.id} onClick={onToggle} role="row">
        <span role="cell">{time(group.at)}</span>
        <span role="cell">{callWho(head, copy)}</span>
        <span role="cell">
          <button
            aria-controls={subId}
            aria-expanded={open}
            className="bcd-gbtn"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            type="button"
          >
            {featureLabel(head.feature, copy)}
            <em>{fillCopy(copy.callCount, { n: group.calls.length })}</em>
            <ChevronDown aria-hidden="true" />
          </button>
        </span>
        <span className="n" role="cell">
          <b>{group.cost ?? "—"}</b>
        </span>
        <span className="n" role="cell">{group.remaining ?? "—"}</span>
      </div>
      <div aria-hidden={open ? undefined : true} className={`bcd-gsub${open ? " is-open" : ""}`} id={subId} inert={!open} role="rowgroup">
        <div className="bcd-gsub__in">
          {group.calls.map((call) => (
            <CallRow call={call} copy={copy} key={call.id} sub time={time(call.at)} />
          ))}
        </div>
      </div>
    </>
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
