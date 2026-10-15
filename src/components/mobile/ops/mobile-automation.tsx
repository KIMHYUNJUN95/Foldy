"use client";

import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { loadAutomationRunMessage, sendAutomationNow, setAutomationEnabled } from "@/app/admin/ops/automation/actions";
import {
  aheadWhen,
  dayLabel,
  destLineOf,
  errorTextOf,
  eventLineOf,
  fill,
  FoldyMark,
  gateLine,
  hhmmOf,
  LANG_LABEL,
  lastLineOf,
  MAX_PAST_POINTS,
  mdOf,
  messageCountOf,
  previewDefaultDate,
  previewFootText,
  previewSendState,
  previewStampAt,
  Rich,
  runAtText,
  runReasonText,
  runTriggerText,
  scheduleLineOf,
  statusClass,
  todayRunPoints,
  upcomingSends,
  useAutomationPreview,
  useHydrated,
  useNowMinute,
  type AutomationCopy,
} from "@/components/admin/ops/automation-shared";
import { MobileAutomationAssign } from "@/components/mobile/ops/mobile-automation-assign";
import { MobileAutomationSettings } from "@/components/mobile/ops/mobile-automation-settings";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import type { AutomationJobView, AutomationPageData } from "@/lib/automation/console-data";
import { AUTOMATION_LOCALES, isAutomationJobKey, type AutomationJobKey, type AutomationLocale } from "@/lib/automation/jobs";
import { isScheduledSendDue } from "@/lib/automation/schedule";
import { DatePickerSheet } from "@/components/shell/date-picker-sheet";
import { haptic } from "@/lib/haptics";
import "./mobile-automation.css";

/**
 * 모바일 자동화 — 시안 AutoM-Phone · AutoMDetail-Phone · AutoMRuns-Phone · AutoMSettings-Phone · AutoMAssign-Phone ·
 * AutoM-Fold · AutoM-Tablet(2026-10-15).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「모바일 자동화」
 *
 * - **폰 · 폴드**: 목록(상태 줄 · 오늘 발송 세로 타임라인 · 자동화 목록) → 누르면 상세(`?job=`). 상세는 머리(이름 · 시각 · 받는 곳 ·
 *   켜짐 스위치) + 밑줄 탭 미리보기 · 실행 기록 · 설정 · 담당자(청소 명단만, `&tab=`). 폴드는 가운데 540px 한 줄.
 * - **태블릿 가로**: 왼쪽 330px 목록 | 오른쪽 상세. 고른 줄은 옅은 보라 바탕, 처음엔 첫 자동화.
 * - 목록 → 상세는 `history.pushState`(서버를 다시 부르지 않는다 — 데이터는 이미 다 있다), 탭 · 태블릿 고르기는 replaceState —
 *   스와이프 뒤로가기 한 번이면 목록으로 돌아온다. Next 가 주소를 `useSearchParams` 로 다시 알려 준다.
 * - 규칙(오늘 발송 묶기 · 다음 시각 · 정정본 판정 · 미리보기 읽기)은 PC 와 같은 `automation-shared.tsx` 를 쓴다.
 * - 설정 · 담당자 칸은 `MobileAutomationSettings` · `MobileAutomationAssign`(따로 만든 파일).
 *
 * 화면의 잠금(보기 전용)은 편의다 — 저장 · 발송은 서버 액션이 `automation.manage` 를 다시 본다.
 */

type Tab = "preview" | "history" | "settings" | "assign";
const TABS: Tab[] = ["preview", "history", "settings", "assign"];
const isTab = (value: string | null): value is Tab => !!value && (TABS as string[]).includes(value);

const BASE_PATH = "/mobile/ops/automation";
/** 언어 고르기 — 폭이 좁아 영어는 EN(말 이름이라 번역하지 않는다 · PC 의 LANG_LABEL 과 같은 자리). */
const LANG_SHORT: Record<AutomationLocale, string> = { en: "EN", ja: "日本語", ko: "한국어" };

const hrefOf = (jobKey: AutomationJobKey | null, tab?: Tab) => {
  if (!jobKey) return BASE_PATH;
  return tab && tab !== "preview" ? `${BASE_PATH}?job=${jobKey}&tab=${tab}` : `${BASE_PATH}?job=${jobKey}`;
};

/** 성공 체크 — 선이 그려진다(동작 줄이기면 바로 보임). */
function DrawCheck() {
  return (
    <svg aria-hidden="true" className="mat-draw" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
    </svg>
  );
}

type Confirm = { title: string; body: string; warnings: string[]; ok: string; run: () => Promise<void> };

export function MobileAutomation({
  data,
  copy,
  locale,
  localeTag,
}: {
  data: AutomationPageData;
  copy: AutomationCopy;
  locale: AutomationLocale;
  localeTag: string;
}) {
  const m = copy.mobile;
  const params = useSearchParams();
  const isTablet = useIsTablet();
  const nowMinute = useNowMinute();
  const now = nowMinute === null ? null : new Date(nowMinute * 60_000);

  const jobParam = params.get("job");
  const tabParam = params.get("tab");
  const picked = isAutomationJobKey(jobParam) ? jobParam : null;
  // 태블릿 가로는 오른쪽 칸이 늘 무언가를 보인다 — 고른 것, 없으면 첫 자동화.
  const detailKey: AutomationJobKey | null = picked ?? (isTablet ? (data.jobs[0]?.jobKey ?? null) : null);
  const job = detailKey ? (data.jobs.find((item) => item.jobKey === detailKey) ?? null) : null;
  const tabs: Tab[] = detailKey === "cleaning_list" ? TABS : ["preview", "history", "settings"];
  const tab: Tab = isTab(tabParam) && tabs.includes(tabParam) ? tabParam : "preview";

  // ── 알림(탭 바 위 작은 알약) ──
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const flash = useCallback((text: string) => {
    const id = Date.now();
    setToast({ id, text });
    window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), 2400);
  }, []);
  const errorText = useCallback((code: string) => errorTextOf(copy, code), [copy]);

  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const open = (jobKey: AutomationJobKey) => {
    haptic("light");
    if (isTablet) {
      window.history.replaceState(null, "", hrefOf(jobKey));
      return;
    }
    window.history.pushState(null, "", hrefOf(jobKey));
    window.scrollTo({ top: 0 });
  };
  const pickTab = (next: Tab) => {
    if (!detailKey || next === tab) return;
    haptic("light");
    window.history.replaceState(null, "", hrefOf(detailKey, next));
  };

  const mode = picked ? "detail" : "list";

  return (
    <div className="mat" data-mode={mode}>
      <div className="mat-body">
        <div className="mat-side">
          <ListView copy={copy} data={data} localeTag={localeTag} now={now} onOpen={open} selected={isTablet ? detailKey : null} />
        </div>
        {job ? (
          <section className="mat-detail" key={job.jobKey}>
            <DetailView
              copy={copy}
              data={data}
              errorText={errorText}
              flash={flash}
              job={job}
              locale={locale}
              localeTag={localeTag}
              onConfirm={setConfirm}
              onTab={pickTab}
              tab={tab}
              tabs={tabs}
            />
          </section>
        ) : null}
      </div>

      {confirm ? <ConfirmModal confirm={confirm} keep={m.keep} onClose={() => setConfirm(null)} /> : null}
      {toast ? <Toast key={toast.id} settings={!!job && tab === "settings"} text={toast.text} /> : null}
    </div>
  );
}

// ── 목록 ─────────────────────────────────────────────────────────────────

function ListView({
  data,
  copy,
  localeTag,
  now,
  selected,
  onOpen,
}: {
  data: AutomationPageData;
  copy: AutomationCopy;
  localeTag: string;
  now: Date | null;
  selected: AutomationJobKey | null;
  onOpen: (jobKey: AutomationJobKey) => void;
}) {
  const w = copy.white;
  const m = copy.mobile;
  const gate = gateLine(data, w);
  const validChannels = data.channels.filter((channel) => channel.valid).length;

  return (
    <>
      <header className="mat-h">
        <h1>{copy.title}</h1>
        <div className="mat-status">
          <span className={`mat-hp ${gate.cls}`}>
            <i />
            {gate.text}
          </span>
          <span className={`mat-hp ${validChannels > 0 ? "is-ok" : "is-warn"}`}>
            <i />
            {validChannels > 0 ? fill(w.channels, { n: validChannels }) : w.channelsNone}
          </span>
          <span className={`mat-hp ${data.opsAlertConfigured ? "is-ok" : "is-warn"}`}>
            <i />
            {data.opsAlertConfigured ? w.alertOn : w.alertOff}
          </span>
        </div>
      </header>

      <TodayLine copy={copy} data={data} localeTag={localeTag} now={now} />

      <div className="mat-list">
        <div className="mat-group">{m.slackGroup}</div>
        {data.jobs.map((item, index) => {
          const last = lastLineOf(item, copy, data.today);
          const on = item.jobKey === selected;
          return (
            <button
              aria-current={on ? "true" : undefined}
              aria-label={fill(m.openJob, { name: copy.jobs[item.jobKey].name })}
              className={`mat-job${on ? " is-sel" : ""}`}
              key={item.jobKey}
              onClick={() => onOpen(item.jobKey)}
              style={{ "--i": index } as CSSProperties}
              type="button"
            >
              <span className="mat-job__t">
                <b>{copy.jobs[item.jobKey].name}</b>
                <span className="mat-job__s">{scheduleLineOf(item, copy, data.today, now)}</span>
                <span className="mat-job__l">
                  {last.status ? <em className={statusClass(last.status)}>{w.lastStatus[last.status]}</em> : null}
                  {last.status ? " · " : null}
                  {last.text}
                </span>
              </span>
              <span className={`mat-job__st${item.enabled ? " is-on" : ""}`}>{item.enabled ? copy.on : copy.off}</span>
              <ChevronRight aria-hidden="true" className="mat-job__chev" />
            </button>
          );
        })}
      </div>

      <div className="mat-foot">
        <span>
          {copy.sectionLater} — {copy.laterBody}
        </span>
        <span>{copy.footTz}</span>
      </div>
    </>
  );
}

/** 오늘 발송 — PC 의 가로 줄을 세로로. 묶는 규칙(같은 자동화 · 같은 분은 한 점 · 지난 것이 많으면 「앞서 N건」)은 PC 와 같다. */
function TodayLine({ data, copy, localeTag, now }: { data: AutomationPageData; copy: AutomationCopy; localeTag: string; now: Date | null }) {
  const w = copy.white;
  const today = data.today;
  const { points, sent, failed } = useMemo(() => todayRunPoints(data.jobs, today), [data.jobs, today]);
  const hidden = Math.max(0, points.length - MAX_PAST_POINTS);
  const past = points.slice(hidden);
  const upcoming = upcomingSends(data.jobs, now);
  const hydrated = useHydrated();
  const dateLabel = hydrated ? dayLabel(today, localeTag) : mdOf(today);

  let index = 0;
  return (
    <section className="mat-today">
      <div className="mat-today__h">
        <b>{w.todayTitle}</b>
        <span>{fill(w.todaySummary, { date: dateLabel, failed, sent })}</span>
      </div>
      {past.length === 0 && upcoming.length === 0 ? (
        <div className="mat-today__empty">{now ? `${w.nothingToday} · ${w.nothingNext}` : w.nothingToday}</div>
      ) : (
        <ol className="mat-line">
          {hidden > 0 ? (
            <li className="mat-pt is-more" style={{ "--i": index++ } as CSSProperties}>
              <span className="mat-pt__dot" />
              <span className="mat-pt__time">{fill(w.earlier, { n: hidden })}</span>
            </li>
          ) : null}
          {past.map((point) => (
            <li className={`mat-pt is-past ${statusClass(point.status)}`} key={`${point.jobKey}-${point.time}`} style={{ "--i": index++ } as CSSProperties}>
              <span className="mat-pt__dot" />
              <span className="mat-pt__time">{point.time}</span>
              <span className="mat-pt__name">
                {copy.jobs[point.jobKey].name}
                {point.status !== "sent" ? <em> · {w.lastStatus[point.status]}</em> : null}
              </span>
            </li>
          ))}
          {now ? (
            <li className="mat-now" style={{ "--i": index++ } as CSSProperties}>
              <span className="mat-now__bar" />
              <span className="mat-now__t">{fill(w.nowAt, { time: hhmmOf(now) })}</span>
              <span className="mat-now__rule" />
            </li>
          ) : null}
          {upcoming.map((item) => (
            <li className="mat-pt is-next" key={`next-${item.jobKey}`} style={{ "--i": index++ } as CSSProperties}>
              <span className="mat-pt__dot" />
              <span className="mat-pt__time">{aheadWhen(item.at, today, w)}</span>
              <span className="mat-pt__name">{copy.jobs[item.jobKey].name}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── 상세 ─────────────────────────────────────────────────────────────────

function DetailView({
  job,
  data,
  copy,
  locale,
  localeTag,
  tab,
  tabs,
  onTab,
  flash,
  errorText,
  onConfirm,
}: {
  job: AutomationJobView;
  data: AutomationPageData;
  copy: AutomationCopy;
  locale: AutomationLocale;
  localeTag: string;
  tab: Tab;
  tabs: Tab[];
  onTab: (tab: Tab) => void;
  flash: (text: string) => void;
  errorText: (code: string) => string;
  onConfirm: (confirm: Confirm) => void;
}) {
  const router = useRouter();
  const w = copy.white;
  const view = !data.canManage;
  const [pending, startTransition] = useTransition();
  const name = copy.jobs[job.jobKey].name;
  const messageCount = messageCountOf(job);

  const toggle = () => {
    if (view || pending) return;
    haptic("light");
    if (job.enabled) {
      startTransition(async () => {
        const result = await setAutomationEnabled(job.jobKey, false);
        if (!result.ok) return flash(errorText(result.error));
        flash(copy.toggleOffDone);
        router.refresh();
      });
      return;
    }
    const warnings: string[] = [];
    if (job.destinations.length === 0) warnings.push(copy.errors.no_destination);
    // 발송 시간대 안에서 켜면 다음 틱(1분 안)에 바로 나간다 — 미리 알린다.
    if (job.kind === "scheduled" && job.destinations.length > 0 && isScheduledSendDue({ ...job, enabled: true }, new Date())) {
      warnings.push(fill(copy.sendsNowWarning, { until: job.retryUntil }));
    }
    onConfirm({
      body: fill(copy.confirmBody, {
        m: messageCount,
        n: job.destinations.length,
        name,
        when: job.kind === "scheduled" ? fill(copy.confirmWhenDaily, { time: job.sendTime }) : copy.confirmWhenEvent,
      }),
      ok: copy.confirmOk,
      run: async () => {
        const result = await setAutomationEnabled(job.jobKey, true);
        if (!result.ok) return flash(errorText(result.error));
        haptic("success");
        flash(copy.toggleOnDone);
        router.refresh();
      },
      title: copy.confirmTitle,
      warnings,
    });
  };

  // ── 탭 밑줄(미끄러짐) ──
  const navRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const bar = barRef.current;
    if (!nav || !bar) return;
    const place = () => {
      const el = nav.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`);
      if (!el) return;
      bar.style.width = `${el.offsetWidth}px`;
      bar.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    place();
    const raf = window.requestAnimationFrame(() => {
      bar.dataset.ready = "1";
    });
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [tab, tabs.length]);

  return (
    <>
      <div className="mat-dh">
        <div className="mat-dh__t">
          <h2>{name}</h2>
          <p>
            {job.kind === "scheduled" ? fill(copy.whenDaily, { time: job.sendTime }) : eventLineOf(job.jobKey, w)}
            {" · "}
            {destLineOf(job, w)}
          </p>
        </div>
        <div className="mat-sw">
          <span>{job.enabled ? copy.on : copy.off}</span>
          <button
            aria-checked={job.enabled}
            aria-label={copy.toggleAria}
            className={`mat-switch${job.enabled ? " is-on" : ""}`}
            disabled={view || pending}
            onClick={toggle}
            role="switch"
            type="button"
          >
            <i />
          </button>
        </div>
      </div>
      {view ? <p className="mat-ro">{w.viewOnlyNote}</p> : null}

      <div className="mat-tabs" ref={navRef} role="tablist">
        {tabs.map((key) => (
          <button
            aria-selected={tab === key}
            className={`mat-tab${tab === key ? " is-on" : ""}`}
            data-tab={key}
            key={key}
            onClick={() => onTab(key)}
            role="tab"
            type="button"
          >
            {copy.tabs[key]}
          </button>
        ))}
        <span aria-hidden className="mat-tabs__bar" ref={barRef} />
      </div>

      <div className={`mat-pane is-${tab}`} key={tab}>
        {tab === "preview" ? (
          <PreviewPane
            copy={copy}
            data={data}
            errorText={errorText}
            flash={flash}
            job={job}
            localeTag={localeTag}
            onConfirm={onConfirm}
            userLocale={locale}
            view={view}
          />
        ) : null}
        {tab === "history" ? <HistoryPane copy={copy} errorText={errorText} flash={flash} job={job} /> : null}
        {tab === "settings" ? (
          <MobileAutomationSettings
            copy={copy}
            data={data}
            flash={flash}
            job={job}
            key={`${job.jobKey}-${job.sendTime}-${job.retryUntil}`}
            view={view}
          />
        ) : null}
        {tab === "assign" ? (
          <MobileAutomationAssign copy={copy} data={data} flash={flash} localeTag={localeTag} userLocale={locale} view={view} />
        ) : null}
      </div>
    </>
  );
}

// ── 미리보기 ─────────────────────────────────────────────────────────────

function PreviewPane({
  job,
  data,
  copy,
  view,
  flash,
  errorText,
  localeTag,
  userLocale,
  onConfirm,
}: {
  job: AutomationJobView;
  data: AutomationPageData;
  copy: AutomationCopy;
  view: boolean;
  flash: (text: string) => void;
  errorText: (code: string) => string;
  localeTag: string;
  userLocale: AutomationLocale;
  onConfirm: (confirm: Confirm) => void;
}) {
  const w = copy.white;
  const m = copy.mobile;
  const [date, setDate] = useState(previewDefaultDate(job, data));
  const [lang, setLang] = useState<AutomationLocale>(job.destinations[0]?.locales[0] ?? userLocale);
  const [done, setDone] = useState(false);
  const [picking, setPicking] = useState(false);
  const onPreviewError = useCallback((code: string) => flash(errorText(code)), [errorText, flash]);
  const { loading, text, card } = useAutomationPreview(job.jobKey, date, lang, onPreviewError);
  const { timed, asCorrection } = previewSendState(job, date);
  const hydrated = useHydrated();

  const timeFormat = new Intl.DateTimeFormat(localeTag, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Tokyo" });
  const stampAt = previewStampAt(job, date, data.today);
  const stamp = stampAt ? (hydrated ? timeFormat.format(stampAt) : hhmmOf(stampAt)) : null;
  const dateText = hydrated ? dayLabel(date, localeTag) : mdOf(date);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 1800);
    return () => window.clearTimeout(timer);
  }, [done]);

  const send = () => {
    haptic("light");
    onConfirm({
      body: asCorrection
        ? fill(m.correctionBody, { date: mdOf(date), n: job.destinations.length })
        : fill(m.sendBody, { date: mdOf(date), m: messageCountOf(job), n: job.destinations.length, name: copy.jobs[job.jobKey].name }),
      ok: asCorrection ? w.sendCorrection : m.sendOk,
      run: async () => {
        const result = await sendAutomationNow(asCorrection ? { correction: true, date, jobKey: job.jobKey } : { date, jobKey: job.jobKey });
        if (!result.ok) {
          haptic("error");
          return flash(errorText(result.error));
        }
        haptic("success");
        flash(asCorrection ? copy.assign.correctionSent : fill(copy.preview.sentToast, { failed: result.failed, sent: result.sent }));
        setDone(true);
      },
      title: asCorrection ? m.correctionTitle : m.sendTitle,
      warnings: [],
    });
  };

  const copyText = () => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    haptic("light");
    flash(copy.preview.copied);
  };

  return (
    <div className="mat-preview">
      {picking ? (
        <DatePickerSheet
          labels={{ nextMonth: m.dateNext, prevMonth: m.datePrev, title: m.pickDate, today: m.dateToday }}
          locale={localeTag}
          onClose={() => setPicking(false)}
          onSelect={(next) => {
            setPicking(false);
            setDate(next);
          }}
          today={data.today}
          value={date}
        />
      ) : null}
      <div className="mat-tool">
        {timed ? (
          <button aria-label={m.pickDate} className="mat-date" onClick={() => setPicking(true)} type="button">
            <span className="mat-date__t">{dateText}</span>
            <ChevronDown aria-hidden="true" />
          </button>
        ) : (
          <span className="mat-tool__sp" />
        )}
        <div aria-label={w.langSeg} className="mat-seg" role="tablist">
          {AUTOMATION_LOCALES.map((item) => (
            <button
              aria-label={LANG_LABEL[item]}
              aria-selected={lang === item}
              className={lang === item ? "on" : ""}
              key={item}
              onClick={() => setLang(item)}
              role="tab"
              type="button"
            >
              {LANG_SHORT[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="mat-slack">
        <span className="mat-slack__av">
          <FoldyMark size={24} />
        </span>
        <div className="mat-slack__body">
          <div className="mat-slack__h">
            {/* 실제 Slack 에 보이는 보내는 사람 이름(Slack 앱 이름 — 고유 명사라 번역하지 않는다). */}
            <b>Foldy Automation</b>
            <span className="mat-slack__tag">{copy.preview.app}</span>
            {stamp ? <span className="mat-slack__time">{stamp}</span> : null}
          </div>
          <div className={`mat-slack__c${loading ? "" : " is-in"}`} key={`${date}|${lang}|${loading ? "l" : "r"}`}>
            {loading ? (
              <div className="mat-slack__note">{copy.preview.loading}</div>
            ) : card ? (
              <div className="mat-card">
                <div className="mat-card__h">{card.header}</div>
                <div className="mat-card__f">
                  {card.rows.map((row, index) => (
                    <div key={index}>
                      {row.map((cell) => (
                        <span key={cell.label}>
                          <b>{cell.label}</b>
                          {cell.value}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="mat-card__c">{card.context}</div>
                {card.link ? <div className="mat-card__l">{card.link.label}</div> : null}
              </div>
            ) : text ? (
              <div className="mat-slack__msg">
                {text.split("\n").map((line, index) => (
                  <div className="mat-slack__ln" key={index}>
                    {line === "" ? " " : <Rich text={line} />}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mat-slack__note">{copy.preview.empty}</div>
            )}
          </div>
        </div>
      </div>

      <p className="mat-note">
        <Rich text={previewFootText(job, date, copy, data.today)} />
      </p>

      <div className="mat-actions">
        <button className="mat-btn" disabled={!text} onClick={copyText} type="button">
          {copy.preview.copy}
        </button>
        <button
          className={`mat-btn is-tint${done ? " is-done" : ""}`}
          disabled={view || job.destinations.length === 0}
          onClick={send}
          type="button"
        >
          {done ? <DrawCheck /> : null}
          {asCorrection ? w.sendCorrection : copy.preview.sendNow}
        </button>
      </div>
    </div>
  );
}

// ── 실행 기록 ─────────────────────────────────────────────────────────────

function HistoryPane({
  job,
  copy,
  flash,
  errorText,
}: {
  job: AutomationJobView;
  copy: AutomationCopy;
  flash: (text: string) => void;
  errorText: (code: string) => string;
}) {
  const w = copy.white;
  const m = copy.mobile;
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = (id: string) => {
    if (busy) return;
    haptic("light");
    setBusy(id);
    loadAutomationRunMessage(id).then((result) => {
      setBusy(null);
      if (!result.ok) return flash(errorText(result.error));
      setMessage(result.text || "—");
    });
  };

  if (job.runs.length === 0) {
    return (
      <div className="mat-empty">
        <b>{copy.history.empty}</b>
        <span>{copy.history.emptyBody}</span>
      </div>
    );
  }
  return (
    <>
      <ul className="mat-runs">
        {job.runs.map((run, index) => {
          const detail = [
            runTriggerText(run.trigger, copy),
            run.channelKey ? `${run.channelKey}${run.locale ? ` ${LANG_LABEL[run.locale as AutomationLocale] ?? run.locale}` : ""}` : null,
            run.reason ? runReasonText(run.reason, copy) : null,
          ].filter(Boolean);
          return (
            <li className="mat-run" key={run.id} style={{ "--i": Math.min(index, 14) } as CSSProperties}>
              <span className="mat-run__t">
                <span className="mat-run__at">
                  <b>{runAtText(run.createdAt)}</b>
                  {run.targetDate ? <span> · {fill(m.targetOf, { date: mdOf(run.targetDate) })}</span> : null}
                </span>
                <span className="mat-run__d">{detail.join(" · ")}</span>
              </span>
              <span className={`mat-run__st ${statusClass(run.status)}`}>{w.runStatus[run.status]}</span>
              {run.channelKey ? (
                <button
                  aria-label={fill(m.rawAria, { at: runAtText(run.createdAt) })}
                  className="mat-link"
                  disabled={busy === run.id}
                  onClick={() => open(run.id)}
                  type="button"
                >
                  {w.raw}
                </button>
              ) : (
                <span aria-hidden className="mat-link is-blank" />
              )}
            </li>
          );
        })}
      </ul>
      {message !== null ? (
        <BottomSheet ariaLabel={w.raw} header={<div className="mat-sheet__h">{w.raw}</div>} onClose={() => setMessage(null)}>
          <div className="mat-sheet">
            <pre className="mat-sheet__pre">{message}</pre>
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}

// ── 확인 창 · 알림 ────────────────────────────────────────────────────────

/** 가운데 확인 창(「그대로 두기 / 실행」) — 의도된 BottomSheet 예외(되돌리기 어려운 일: 켜기 · 지금 보내기). 첫 초점은 「그대로 두기」. */
function ConfirmModal({ confirm, keep, onClose }: { confirm: Confirm; keep: string; onClose: () => void }) {
  const [busy, startBusy] = useTransition();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="mat-scrim" onClick={busy ? undefined : onClose} role="presentation">
      <div aria-label={confirm.title} aria-modal="true" className="mat-cf" onClick={(event) => event.stopPropagation()} role="dialog">
        <p className="mat-cf__t">{confirm.title}</p>
        <p className="mat-cf__b">{confirm.body}</p>
        {confirm.warnings.map((warning) => (
          <p className="mat-cf__w" key={warning}>
            {warning}
          </p>
        ))}
        <div className="mat-cf__f">
          {/* 첫 초점은 「그대로 두기」 — Enter 한 번에 Slack 으로 나가지 않게. */}
          <button autoFocus className="mat-btn" disabled={busy} onClick={onClose} type="button">
            {keep}
          </button>
          <button
            className="mat-btn is-primary"
            disabled={busy}
            onClick={() =>
              startBusy(async () => {
                await confirm.run();
                onClose();
              })
            }
            type="button"
          >
            {confirm.ok}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Toast({ text, settings }: { text: string; settings: boolean }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div aria-live="polite" className={`mat-toast${settings ? " is-raised" : ""}`} role="status">
      {text}
    </div>,
    document.body,
  );
}
