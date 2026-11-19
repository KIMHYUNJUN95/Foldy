"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useBeds24CreditCalls, type Beds24CreditCallsState } from "@/components/shared/beds24-credit-calls";
import { fetchCreditDetail, useBeds24CreditLive } from "@/components/shared/beds24-credit-live";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import {
  actorLines,
  creditPollMs,
  isCreditActorFilterable,
  isCreditCallGroupOpen,
  type CreditCallGroup,
  creditTexts,
  showCreditLoadError,
  featureLabel,
  fillCopy,
  sharePercent,
  windowHeadLine,
  type Beds24CreditCopy,
  type Beds24CreditTexts,
} from "@/lib/beds24-credit-view";
import type { Beds24CreditActorUsage, Beds24CreditCall, Beds24CreditDetail, Beds24CreditSnapshot } from "@/lib/beds24/credit-usage-types";
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
  localeTag,
  serverNow,
}: {
  initial: Beds24CreditSnapshot | null;
  copy: Beds24CreditCopy;
  localeTag?: string;
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
                <ActorRows actors={live.summary.actors} copy={copy} empty={copy.windowEmpty} localeTag={localeTag} />
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

function ActorRows({
  actors,
  copy,
  empty,
  total,
  picked,
  onPick,
  localeTag,
}: {
  actors: Beds24CreditActorUsage[];
  copy: Beds24CreditCopy;
  empty: string;
  /** 숫자 형식 — PC 칸과 같이 화면 언어로(없으면 기기 기본). */
  localeTag?: string;
  total?: number;
  /** 거르기 — 있으면 줄을 눌러 최근 호출을 그 사람만(Foldy 밖은 누를 수 없음). */
  picked?: string | null;
  onPick?: (key: string) => void;
}) {
  if (actors.length === 0) return <div className="mcr-empty">{empty}</div>;
  return (
    <ul className="mcr-list">
      {actors.map((actor) => {
        const lines = actorLines(actor, copy);
        const inner = (
          <>
            <span className="mcr-row__t">
              {lines.name}
              {lines.sub ? <small>{lines.sub}</small> : null}
            </span>
            <b>{actor.credits.toLocaleString(localeTag)}</b>
            {total !== undefined ? <em>{sharePercent(actor.credits, total)}%</em> : null}
          </>
        );
        return onPick && isCreditActorFilterable(actor) ? (
          <li className="mcr-row mcr-row--pick" key={actor.key}>
            <PickButton onPick={() => onPick(actor.key)} pressed={picked === actor.key}>
              {inner}
            </PickButton>
          </li>
        ) : (
          <li className="mcr-row" key={actor.key}>
            {inner}
          </li>
        );
      })}
    </ul>
  );
}

function PickButton({ pressed, onPick, children }: { pressed: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button
      aria-describedby="mcr-filter-hint"
      aria-pressed={pressed}
      className="mcr-pick"
      onClick={() => {
        haptic("light");
        onPick();
      }}
      type="button"
    >
      {children}
    </button>
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
  localeTag,
  serverNow,
}: {
  detail: Beds24CreditDetail | null;
  copy: Beds24CreditCopy;
  localeTag: string;
  serverNow: number | null;
}) {
  const [detail, setDetail] = useState(initialDetail);
  const [userFailed, setUserFailed] = useState(false);
  const [calls, callsRoot] = useBeds24CreditCalls(initialDetail);
  const callsShared = useRef(calls);
  useEffect(() => {
    callsShared.current = calls;
  });
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
    callsShared.current.syncDetail(result.data);
    shared.current.commit(token, result.data.snapshot);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void poll();
      // 거르기가 걸려 있으면 최근 호출 첫 장은 따로 읽는다(같은 주기).
      callsShared.current.refreshFiltered();
    }, creditPollMs("today"));
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
            <span>{fillCopy(copy.rangeTotal.today, { n: detail.total.toLocaleString(localeTag) })}</span>
          </div>
          <span className="sr-only" id="mcr-filter-hint">
            {copy.filterHint}
          </span>
          <ActorRows
            actors={detail.actors.slice(0, 5)}
            copy={copy}
            empty={copy.emptyRange}
            localeTag={localeTag}
            onPick={(key) => calls.toggleFilter("actor", key)}
            picked={calls.filter.actor}
            total={detail.total}
          />
          <div className="mcr-lh">{copy.mobileWhere}</div>
          {detail.features.length === 0 ? (
            <div className="mcr-empty">{copy.emptyRange}</div>
          ) : (
            <ul className="mcr-list">
              {detail.features.slice(0, 6).map((item) => (
                <li className="mcr-row mcr-row--pick" key={item.feature}>
                  <PickButton onPick={() => calls.toggleFilter("feature", item.feature)} pressed={calls.filter.feature === item.feature}>
                    <span className="mcr-row__t">{featureLabel(item.feature, copy)}</span>
                    <b>{item.credits.toLocaleString(localeTag)}</b>
                    <em>{sharePercent(item.credits, detail.total)}%</em>
                  </PickButton>
                </li>
              ))}
            </ul>
          )}
          <MobileRecentCalls calls={calls} copy={copy} detail={detail} localeTag={localeTag} rootRef={callsRoot} />
        </>
      ) : null}
    </section>
  );
}

function callFilterLabel(calls: Beds24CreditCallsState, detail: Beds24CreditDetail, copy: Beds24CreditCopy): string | null {
  const parts: string[] = [];
  if (calls.filter.actor) {
    const actor = detail.actors.find((item) => item.key === calls.filter.actor);
    parts.push(calls.filter.actor === "auto" ? copy.auto : actor?.name || "—");
  }
  if (calls.filter.feature) parts.push(featureLabel(calls.filter.feature, copy));
  return parts.length ? fillCopy(copy.filterOnly, { name: parts.join(" · ") }) : null;
}

/** 오늘 최근 호출 — PC 관제실 칸과 같은 목록(50개씩 · 연달아 난 같은 호출은 한 줄 · 누가/어디에 거르기). */
function MobileRecentCalls({
  calls,
  copy,
  detail,
  localeTag,
  rootRef,
}: {
  calls: Beds24CreditCallsState;
  copy: Beds24CreditCopy;
  detail: Beds24CreditDetail;
  localeTag: string;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }),
    [localeTag],
  );
  const time = (ms: number) => timeFmt.format(ms);
  const label = callFilterLabel(calls, detail, copy);
  return (
    <div className="mcr-calls" ref={rootRef}>
      <div className="mcr-lh">
        {copy.mobileRecent}
        {label ? (
          <span className="mcr-flt">
            {label}
            <button
              onClick={() => {
                haptic("light");
                calls.clearFilter();
              }}
              type="button"
            >
              {copy.filterClear}
            </button>
          </span>
        ) : null}
      </div>
      {calls.loadingHead ? (
        <Loading copy={copy} />
      ) : calls.empty && !calls.failed ? (
        <div className="mcr-empty">{label ? copy.emptyFiltered : copy.emptyCalls}</div>
      ) : (
        <ul className="mcr-list" aria-label={copy.recentTitle}>
          {calls.groups.map((group) =>
            group.calls.length === 1 ? (
              <li className="mcr-row mcr-call" data-row={group.id} key={group.id}>
                <MobileCallLine call={group.calls[0]} copy={copy} time={time(group.at)} />
              </li>
            ) : (
              <MobileGroup
                copy={copy}
                group={group}
                key={group.id}
                onToggle={() => {
                  haptic("light");
                  calls.toggleGroup(group);
                }}
                open={isCreditCallGroupOpen(group, calls.openIds)}
                time={time}
              />
            ),
          )}
        </ul>
      )}
      {calls.failed ? <ErrorLine copy={copy} onRetry={calls.retry} /> : null}
      {calls.hasMore && !calls.loadingHead && !calls.failed ? (
        <button
          aria-busy={calls.loadingMore ? true : undefined}
          className="mcr-more"
          disabled={calls.loadingMore}
          onClick={() => void calls.loadMore()}
          type="button"
        >
          {calls.loadingMore ? copy.loading : copy.loadMore}
        </button>
      ) : null}
    </div>
  );
}

function callWhatText(call: Beds24CreditCall, copy: Beds24CreditCopy): string {
  return call.itemCount !== null && call.itemCount > 0
    ? `${featureLabel(call.feature, copy)} · ${fillCopy(copy.itemCount, { n: call.itemCount })}`
    : featureLabel(call.feature, copy);
}

/** 한 호출 — 윗줄 「무엇 · 크레딧」, 아랫줄 「시각 · 누가 · 남은 값」. */
function MobileCallLine({ call, copy, time }: { call: Beds24CreditCall; copy: Beds24CreditCopy; time: string }) {
  const who = call.actor.kind === "user" ? call.actor.name || "—" : copy.auto;
  return (
    <>
      <span className="mcr-row__t">
        {callWhatText(call, copy)}
        <small>
          {time} · {who} · {copy.colRemaining} {call.remaining ?? "—"}
        </small>
      </span>
      {call.cost !== null ? <b>{call.cost}</b> : <span className="mcr-bad">{fillCopy(copy.callFailed, { code: call.httpStatus ?? "—" })}</span>}
    </>
  );
}

function MobileGroup({
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
  const who = head.actor.kind === "user" ? head.actor.name || "—" : copy.auto;
  const subId = `mcr-g-${group.id}`;
  return (
    <li className="mcr-row mcr-row--pick mcr-group" data-row={group.id}>
      <button aria-controls={subId} aria-expanded={open} className="mcr-pick" onClick={onToggle} type="button">
        <span className="mcr-row__t">
          <span className="mcr-gt">
            {featureLabel(head.feature, copy)}
            <em>{fillCopy(copy.callCount, { n: group.calls.length })}</em>
          </span>
          <small>
            {time(group.at)} · {who} · {copy.colRemaining} {group.remaining ?? "—"}
          </small>
        </span>
        <b>{group.cost ?? "—"}</b>
        <ChevronDown aria-hidden="true" className="mcr-gchev" />
      </button>
      <div aria-hidden={open ? undefined : true} className={`mcr-gsub${open ? " is-open" : ""}`} id={subId} inert={!open}>
        <ul className="mcr-gsub__in">
          {group.calls.map((call) => (
            <li className="mcr-row mcr-call" key={call.id}>
              <MobileCallLine call={call} copy={copy} time={time(call.at)} />
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
