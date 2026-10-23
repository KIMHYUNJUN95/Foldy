"use client";

import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  addCleaningExtraRoom,
  loadAssigneeBoard,
  loadAutomationRunMessage,
  removeCleaningExtraRoom,
  saveAutomationJob,
  saveCleaningAssignee,
  sendAutomationNow,
  setAutomationEnabled,
  type AssigneeRoomView,
  type CleaningRoomOptionGroup,
} from "@/actions/ops-automation";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminDatePicker } from "@/components/admin/shared/admin-date-picker";
import { AdminTimePicker } from "@/components/admin/shared/admin-time-picker";
import {
  aheadWhen,
  dayLabel,
  destLineOf,
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
  scheduleLineOf,
  statusClass,
  todayRunPoints,
  tokyoDayOf,
  upcomingSends,
  useAutomationPreview,
  useHydrated,
  useNowMinute,
  eventLineOf,
} from "@/components/admin/ops/automation-shared";
import type { AutomationJobView, AutomationPageData } from "@/lib/automation/console-data";
import {
  AUTOMATION_LOCALES,
  DAILY_REPORT_CHANNELS,
  type AutomationDestination,
  type AutomationJobKey,
  type AutomationLocale,
  type AutomationSettings,
} from "@/lib/automation/jobs";
import { isScheduledSendDue } from "@/lib/automation/schedule";
import type { Dictionary } from "@/lib/i18n";
import "./automation-white.css";

/**
 * 자동화 관제실 — 화이트 리디자인(2026-10-15, 시안 Auto-PC · AutoRuns-PC · AutoSettings-PC · AutoAssign-PC).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「화이트 리디자인」
 *
 * 위 상태 줄 → 오늘 발송 타임라인(실제 오늘 실행 기록 + 켜진 정시 발송의 다음 시각) → 왼쪽 자동화 목록(켜짐/꺼짐은 글자) +
 * 오른쪽 상세(스위치는 여기 하나 · 미리보기 · 실행 기록 · 설정 · 담당자).
 *
 * 화면의 잠금(보기 전용)은 편의다 — 저장 · 발송은 서버 액션이 `automation.manage` 를 다시 본다.
 */

type Copy = Dictionary["automation"];
type SharedCopy = Dictionary["admin"]["shared"];
type Tab = "preview" | "assign" | "history" | "settings";

type Draft = {
  sendTime: string;
  retryUntil: string;
  weekdays: number[];
  settings: AutomationSettings;
  destinations: AutomationDestination[];
};

function draftOf(job: AutomationJobView): Draft {
  return {
    destinations: job.destinations.map((item) => ({ ...item, locales: [...item.locales] })),
    retryUntil: job.retryUntil,
    sendTime: job.sendTime,
    settings: JSON.parse(JSON.stringify(job.settings)) as AutomationSettings,
    weekdays: [...job.weekdays],
  };
}

/** 성공 체크 — 선이 그려진다(동작 줄이기면 바로 보임). */
function DrawCheck() {
  return (
    <svg aria-hidden="true" className="atw-draw" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
    </svg>
  );
}

export function AutomationConsole({
  data,
  copy,
  shared,
  locale,
  localeTag,
}: {
  data: AutomationPageData;
  copy: Copy;
  shared: SharedCopy;
  locale: AutomationLocale;
  localeTag: string;
}) {
  const w = copy.white;
  const [selected, setSelected] = useState<AutomationJobKey>("daily_report");
  const [tab, setTab] = useState<Tab>("preview");
  const [toast, setToast] = useState<string | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);
  const [justSaved, setJustSaved] = useState<AutomationJobKey | null>(null);
  const [pending, startTransition] = useTransition();
  const nowMinute = useNowMinute();
  const job = data.jobs.find((item) => item.jobKey === selected) ?? data.jobs[0];
  const view = !data.canManage;

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), 2200);
  }, []);
  const onSaved = useCallback((jobKey: AutomationJobKey) => {
    setJustSaved(jobKey);
    window.setTimeout(() => setJustSaved((current) => (current === jobKey ? null : current)), 1800);
  }, []);

  const errorText = useCallback((code: string) => (copy.errors as Record<string, string>)[code] ?? copy.errors.save_failed, [copy.errors]);

  const jobName = (key: AutomationJobKey) => copy.jobs[key].name;
  const tabs: Tab[] = selected === "cleaning_list" ? ["preview", "history", "settings", "assign"] : ["preview", "history", "settings"];
  const activeTab: Tab = tabs.includes(tab) ? tab : "preview";
  const messageCount = messageCountOf(job);

  const toggle = () => {
    if (view) return;
    if (!job.enabled) {
      setConfirmOn(true);
      return;
    }
    startTransition(async () => {
      const result = await setAutomationEnabled(job.jobKey, false);
      if (!result.ok) return flash(errorText(result.error));
      flash(copy.toggleOffDone);
    });
  };
  const confirmEnable = () => {
    startTransition(async () => {
      const result = await setAutomationEnabled(job.jobKey, true);
      setConfirmOn(false);
      if (!result.ok) return flash(errorText(result.error));
      flash(copy.toggleOnDone);
    });
  };

  // ── 상태 줄 ──
  const gate = gateLine(data, w);
  const validChannels = data.channels.filter((channel) => channel.valid).length;

  // ── 목록 줄 ──
  const now = nowMinute === null ? null : new Date(nowMinute * 60_000);
  const scheduleLine = (item: AutomationJobView) => scheduleLineOf(item, copy, data.today, now);
  const lastLine = (item: AutomationJobView) => lastLineOf(item, copy, data.today);
  const destLine = destLineOf(job, w);

  // ── 탭 밑줄(미끄러짐) ──
  const navRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const bar = barRef.current;
    if (!nav || !bar) return;
    const place = () => {
      const el = nav.querySelector<HTMLButtonElement>(`[data-tab="${activeTab}"]`);
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
  }, [activeTab, tabs.length]);

  return (
    <div className="atw">
      {/* 상태 줄 — 칩 · 상자 없이 점 + 글자 */}
      <div className="atw-status">
        <span className={`atw-hp ${gate.cls}`}>
          <i />
          {gate.text}
        </span>
        <span className={`atw-hp ${validChannels > 0 ? "is-ok" : "is-warn"}`}>
          <i />
          {validChannels > 0 ? fill(w.channels, { n: validChannels }) : w.channelsNone}
        </span>
        <span className={`atw-hp ${data.opsAlertConfigured ? "is-ok" : "is-warn"}`}>
          <i />
          {data.opsAlertConfigured ? w.alertOn : w.alertOff}
        </span>
        <span className="atw-role">{view ? w.viewOnlyNote : w.manageNote}</span>
      </div>

      <TodayLine copy={copy} data={data} localeTag={localeTag} now={now} />

      <div className="atw-body">
        <aside className="atw-list">
          <div className="atw-group">Slack</div>
          {data.jobs.map((item) => {
            const last = lastLine(item);
            return (
              <button
                aria-current={item.jobKey === selected ? "true" : undefined}
                className={`atw-job${item.jobKey === selected ? " is-on" : ""}`}
                key={item.jobKey}
                onClick={() => setSelected(item.jobKey)}
                type="button"
              >
                <span className="atw-job__t">
                  <b>{jobName(item.jobKey)}</b>
                  <span className="atw-job__s">{scheduleLine(item)}</span>
                  <span className="atw-job__l">
                    {last.status ? <em className={statusClass(last.status)}>{w.lastStatus[last.status]}</em> : null}
                    {last.status ? " · " : null}
                    {last.text}
                  </span>
                </span>
                <span className={`atw-job__st${item.enabled ? " is-on" : ""}`}>{item.enabled ? copy.on : copy.off}</span>
              </button>
            );
          })}
          <div className="atw-later">
            <span className="atw-later__h">{copy.sectionLater}</span>
            <span>{copy.laterBody}</span>
            <span className="atw-later__tz">{copy.footTz}</span>
          </div>
        </aside>

        <section className="atw-detail">
          <div className="atw-dh">
            <div className="atw-dh__t">
              <h2>{jobName(job.jobKey)}</h2>
              <p>
                {job.kind === "scheduled" ? fill(copy.whenDaily, { time: job.sendTime }) : eventLineOf(job.jobKey, w)}
                {" · "}
                {destLine}
              </p>
            </div>
            <div className="atw-sw">
              <span>{job.enabled ? copy.toggleOn : copy.toggleOff}</span>
              <button
                aria-checked={job.enabled}
                aria-label={copy.toggleAria}
                className={`atw-switch${job.enabled ? " is-on" : ""}`}
                disabled={view || pending}
                onClick={toggle}
                role="switch"
                type="button"
              >
                <i />
              </button>
            </div>
          </div>

          <div className="atw-tabs" ref={navRef} role="tablist">
            {tabs.map((key) => (
              <button
                aria-selected={activeTab === key}
                className={`atw-tab${activeTab === key ? " is-on" : ""}`}
                data-tab={key}
                key={key}
                onClick={() => setTab(key)}
                role="tab"
                type="button"
              >
                {copy.tabs[key]}
              </button>
            ))}
            <span aria-hidden className="atw-tabs__bar" ref={barRef} />
          </div>

          <div className="atw-pane" key={`${job.jobKey}-${activeTab}`}>
            {activeTab === "preview" ? (
              <PreviewPane
                copy={copy}
                data={data}
                errorText={errorText}
                flash={flash}
                job={job}
                key={`preview-${job.jobKey}`}
                localeTag={localeTag}
                shared={shared}
                userLocale={locale}
                view={view}
              />
            ) : null}
            {activeTab === "assign" ? (
              <AssignPane copy={copy} data={data} errorText={errorText} flash={flash} localeTag={localeTag} shared={shared} userLocale={locale} view={view} />
            ) : null}
            {activeTab === "history" ? <HistoryPane copy={copy} errorText={errorText} flash={flash} job={job} /> : null}
            {activeTab === "settings" ? (
              <SettingsPane
                copy={copy}
                data={data}
                errorText={errorText}
                flash={flash}
                job={job}
                justSaved={justSaved === job.jobKey}
                key={`settings-${job.jobKey}-${job.sendTime}-${job.retryUntil}`}
                onSaved={onSaved}
                view={view}
              />
            ) : null}
          </div>
        </section>
      </div>

      {confirmOn ? (
        <div className="atw-scrim" onClick={() => setConfirmOn(false)} role="presentation">
          <div aria-modal="true" className="atw-modal" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="atw-modal__t">{copy.confirmTitle}</div>
            <div className="atw-modal__b">
              {fill(copy.confirmBody, {
                m: messageCount,
                n: job.destinations.length,
                name: jobName(job.jobKey),
                when: job.kind === "scheduled" ? fill(copy.confirmWhenDaily, { time: job.sendTime }) : copy.confirmWhenEvent,
              })}
            </div>
            {job.destinations.length === 0 ? <div className="atw-warn">{copy.errors.no_destination}</div> : null}
            {/* 발송 시간대 안에서 켜면 다음 틱(1분 안)에 바로 나간다 — 미리 알린다. */}
            {job.kind === "scheduled" && job.destinations.length > 0 && isScheduledSendDue({ ...job, enabled: true }, new Date()) ? (
              <div className="atw-warn">{fill(copy.sendsNowWarning, { until: job.retryUntil })}</div>
            ) : null}
            <div className="atw-modal__f">
              <button className="atw-btn" onClick={() => setConfirmOn(false)} type="button">
                {copy.cancel}
              </button>
              <button className="atw-btn is-primary" disabled={pending} onClick={confirmEnable} type="button">
                {copy.confirmOk}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div className="atw-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

// ── 오늘 발송 타임라인 ─────────────────────────────────────────────────────

function TodayLine({ data, copy, localeTag, now }: { data: AutomationPageData; copy: Copy; localeTag: string; now: Date | null }) {
  const w = copy.white;
  const today = data.today;

  // 오늘(도쿄) 실제 실행 기록 — 같은 자동화 · 같은 분은 한 점(공용 `todayRunPoints`, 모바일과 같은 규칙).
  const { points, sent, failed } = useMemo(() => todayRunPoints(data.jobs, today), [data.jobs, today]);

  const hidden = Math.max(0, points.length - MAX_PAST_POINTS);
  const past = points.slice(hidden);

  const upcoming = upcomingSends(data.jobs, now);

  const hydrated = useHydrated();
  const dateLabel = hydrated ? dayLabel(today, localeTag) : mdOf(today);

  let index = 0;
  return (
    <div className="atw-today">
      <div className="atw-today__h">
        <b>{w.todayTitle}</b>
        <span>{fill(w.todaySummary, { date: dateLabel, failed, sent })}</span>
      </div>
      {past.length === 0 && upcoming.length === 0 ? (
        <div className="atw-today__empty">{now ? `${w.nothingToday} · ${w.nothingNext}` : w.nothingToday}</div>
      ) : (
        <div className="atw-line">
          {hidden > 0 ? (
            <div className="atw-pt is-more" style={{ "--i": index++ } as CSSProperties}>
              <div className="atw-pt__track">
                <span className="atw-pt__dot" />
                <span className="atw-pt__seg" />
              </div>
              <span className="atw-pt__time">{fill(w.earlier, { n: hidden })}</span>
            </div>
          ) : null}
          {past.map((point) => (
            <div
              className={`atw-pt is-past ${statusClass(point.status)}`}
              key={`${point.jobKey}-${point.time}`}
              style={{ "--i": index++ } as CSSProperties}
            >
              <div className="atw-pt__track">
                <span className="atw-pt__dot" />
                <span className="atw-pt__seg" />
              </div>
              <span className="atw-pt__time">{point.time}</span>
              <span className="atw-pt__name">
                {copy.jobs[point.jobKey].name}
                {point.status !== "sent" ? <em> · {w.lastStatus[point.status]}</em> : null}
              </span>
            </div>
          ))}
          {now ? (
            <div className="atw-now" style={{ "--i": index++ } as CSSProperties}>
              <span className="atw-now__t">{fill(w.nowAt, { time: hhmmOf(now) })}</span>
              <span className="atw-now__bar" />
            </div>
          ) : null}
          {upcoming.map((item) => (
            <div className="atw-pt is-next" key={`next-${item.jobKey}`} style={{ "--i": index++ } as CSSProperties}>
              <div className="atw-pt__track">
                <span className="atw-pt__dot" />
                <span className="atw-pt__seg" />
              </div>
              <span className="atw-pt__time">{aheadWhen(item.at, today, w)}</span>
              <span className="atw-pt__name">{copy.jobs[item.jobKey].name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 미리보기 ─────────────────────────────────────────────────────────────

function PreviewPane({
  job,
  data,
  copy,
  shared,
  view,
  flash,
  errorText,
  localeTag,
  userLocale,
}: {
  job: AutomationJobView;
  data: AutomationPageData;
  copy: Copy;
  shared: SharedCopy;
  view: boolean;
  flash: (text: string) => void;
  errorText: (code: string) => string;
  localeTag: string;
  userLocale: AutomationLocale;
}) {
  const w = copy.white;
  const [date, setDate] = useState(previewDefaultDate(job, data));
  const [lang, setLang] = useState<AutomationLocale>(job.destinations[0]?.locales[0] ?? userLocale);
  const [sending, startSend] = useTransition();
  const [done, setDone] = useState(false);
  const onPreviewError = useCallback((code: string) => flash(errorText(code)), [errorText, flash]);
  // 취소 · 당일예약은 Slack 카드 — 미리보기도 카드로(제목 · 2열 칸 · 회색 줄 · 링크).
  const { loading, text, card } = useAutomationPreview(job.jobKey, date, lang, onPreviewError);
  const { timed, asCorrection } = previewSendState(job, date);

  const sendNow = () => {
    if (!window.confirm(copy.preview.sendConfirm)) return;
    startSend(async () => {
      const result = await sendAutomationNow(asCorrection ? { correction: true, date, jobKey: job.jobKey } : { date, jobKey: job.jobKey });
      if (!result.ok) return flash(errorText(result.error));
      flash(asCorrection ? copy.assign.correctionSent : fill(copy.preview.sentToast, { failed: result.failed, sent: result.sent }));
      setDone(true);
      window.setTimeout(() => setDone(false), 1800);
    });
  };

  const channel = job.destinations.find((item) => item.locales.includes(lang)) ?? job.destinations[0] ?? null;
  const hydrated = useHydrated();
  const timeFormat = new Intl.DateTimeFormat(localeTag, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Tokyo" });
  const stampOf = (at: Date) => (hydrated ? timeFormat.format(at) : hhmmOf(at));
  const stampAt = previewStampAt(job, date, data.today);
  const stamp = stampAt ? stampOf(stampAt) : null;

  const footText = previewFootText(job, date, copy, data.today);

  return (
    <div className="atw-preview">
      <div className="atw-tool">
        {timed ? (
          <div className="atw-date">
            <AdminDatePicker
              ariaLabel={copy.preview.date}
              display={hydrated ? dayLabel(date, localeTag) : mdOf(date)}
              labels={{ nextMonth: shared.dateNextMonth, prevMonth: shared.datePrevMonth, today: shared.dateToday }}
              localeTag={localeTag}
              onChange={setDate}
              value={date}
            />
          </div>
        ) : null}
        <div aria-label={w.langSeg} className="atw-seg" role="tablist">
          {AUTOMATION_LOCALES.map((item) => (
            <button aria-selected={lang === item} className={lang === item ? "on" : ""} key={item} onClick={() => setLang(item)} role="tab" type="button">
              {LANG_LABEL[item]}
            </button>
          ))}
        </div>
        <span className="atw-tool__note">{channel ? fill(w.asSent, { channel: channel.channelKey }) : copy.errors.no_destination}</span>
        <button
          className="atw-btn"
          disabled={!text}
          onClick={() => {
            if (text) void navigator.clipboard?.writeText(text);
            flash(copy.preview.copied);
          }}
          type="button"
        >
          {copy.preview.copy}
        </button>
      </div>

      <div className="atw-slack">
        <span className="atw-slack__av">
          <FoldyMark size={26} />
        </span>
        <div className="atw-slack__body">
          <div className="atw-slack__h">
            {/* 실제 Slack 에 보이는 보내는 사람 이름(Slack 앱 이름 — 고유 명사라 번역하지 않는다). */}
            <b>Foldy Automation</b>
            <span className="atw-slack__tag">{copy.preview.app}</span>
            {stamp ? <span className="atw-slack__time">{stamp}</span> : null}
          </div>
          {loading ? (
            <div className="atw-slack__note">{copy.preview.loading}</div>
          ) : card ? (
            <div className="atw-card">
              <div className="atw-card__h">{card.header}</div>
              <div className="atw-card__f">
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
              <div className="atw-card__c">{card.context}</div>
              {card.link ? <div className="atw-card__l">{card.link.label}</div> : null}
            </div>
          ) : text ? (
            <div className="atw-slack__msg">
              {text.split("\n").map((line, index) => (
                <div className="atw-slack__ln" key={index}>
                  {line === "" ? " " : <Rich text={line} />}
                </div>
              ))}
            </div>
          ) : (
            <div className="atw-slack__note">{copy.preview.empty}</div>
          )}
        </div>
      </div>

      <div className="atw-foot">
        <span className="atw-foot__t">
          <Rich text={footText} />
        </span>
        <button
          className={`atw-btn is-tint${done ? " is-done" : ""}`}
          disabled={view || sending || job.destinations.length === 0}
          onClick={sendNow}
          type="button"
        >
          {done ? <DrawCheck /> : null}
          {asCorrection ? w.sendCorrection : copy.preview.sendNow}
        </button>
      </div>
    </div>
  );
}

// ── 담당자 ───────────────────────────────────────────────────────────────

function AssignPane({
  data,
  copy,
  shared,
  view,
  flash,
  errorText,
  localeTag,
  userLocale,
}: {
  data: AutomationPageData;
  copy: Copy;
  shared: SharedCopy;
  view: boolean;
  flash: (text: string) => void;
  errorText: (code: string) => string;
  localeTag: string;
  userLocale: AutomationLocale;
}) {
  const w = copy.white;
  const hydrated = useHydrated();
  const [date, setDate] = useState(data.today);
  const [board, setBoard] = useState<{ date: string; rooms: AssigneeRoomView[]; sent: boolean; roomOptions: CleaningRoomOptionGroup[] } | null>(null);
  const [addKey, setAddKey] = useState("");
  const [addNote, setAddNote] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, startBusy] = useTransition();
  // 고른 날짜의 명단이 아직 안 왔으면 null(「만드는 중」).
  const rooms = board?.date === date ? board.rooms : null;
  const sent = board?.date === date ? board.sent : false;
  const setRooms = (update: (current: AssigneeRoomView[]) => AssigneeRoomView[]) =>
    setBoard((current) => (current ? { ...current, rooms: update(current.rooms) } : current));

  const reload = useCallback(() => {
    loadAssigneeBoard(date, userLocale).then((result) => {
      if (!result.ok) {
        flash(errorText(result.error));
        setBoard({ date, roomOptions: [], rooms: [], sent: false });
        return;
      }
      setBoard({ date, roomOptions: result.roomOptions, rooms: result.rooms, sent: result.sent });
      setNames(Object.fromEntries(result.rooms.map((room) => [room.roomKey, room.names])));
    });
  }, [date, errorText, flash, userLocale]);

  useEffect(() => {
    reload();
  }, [reload]);

  const commit = (room: AssigneeRoomView) => {
    const value = names[room.roomKey] ?? "";
    if (value === room.names) return;
    startBusy(async () => {
      const result = await saveCleaningAssignee({ date, names: value, roomKey: room.roomKey });
      if (!result.ok) return flash(errorText(result.error));
      setRooms((current) => current.map((item) => (item.roomKey === room.roomKey ? { ...item, names: value.trim() } : item)));
      flash(copy.assign.saved);
    });
  };

  // 청소 방 직접 추가(연박 청소 등 — Hotelsmart 대신). 이미 명단에 있는 방은 고를 목록에서 뺀다.
  const listedKeys = new Set((rooms ?? []).filter((room) => room.section === "cleaning").map((room) => room.roomKey));
  const addOptions = (board?.date === date ? board.roomOptions : []).flatMap((group) =>
    group.rooms.filter((room) => !listedKeys.has(room.roomKey)).map((room) => ({ label: `${group.label} · ${room.code}`, value: room.roomKey })),
  );
  const addRoom = () => {
    if (!addKey) return;
    startBusy(async () => {
      const result = await addCleaningExtraRoom({ date, note: addNote, roomKey: addKey });
      if (!result.ok) return flash(errorText(result.error));
      setAddKey("");
      setAddNote("");
      flash(copy.assign.extraAdded);
      reload();
    });
  };
  const removeRoom = (room: AssigneeRoomView) => {
    startBusy(async () => {
      const result = await removeCleaningExtraRoom({ date, roomKey: room.roomKey });
      if (!result.ok) return flash(errorText(result.error));
      flash(copy.assign.extraRemoved);
      reload();
    });
  };

  const changed = (rooms ?? []).filter((room) => sent && room.sentNames !== null && (names[room.roomKey] ?? "").trim() !== (room.sentNames ?? ""));
  const sendCorrection = () => {
    startBusy(async () => {
      const result = await sendAutomationNow({ correction: true, date, jobKey: "cleaning_list" });
      if (!result.ok) return flash(errorText(result.error));
      flash(copy.assign.correctionSent);
      reload();
    });
  };

  const groups = (section: "cleaning" | "setting") => {
    const list = (rooms ?? []).filter((room) => room.section === section);
    const byBuilding = new Map<string, AssigneeRoomView[]>();
    for (const room of list) byBuilding.set(room.label, [...(byBuilding.get(room.label) ?? []), room]);
    return [...byBuilding.entries()];
  };
  const counts = {
    c: (rooms ?? []).filter((room) => room.section === "cleaning").length,
    s: (rooms ?? []).filter((room) => room.section === "setting").length,
  };

  const roomLabel = (room: AssigneeRoomView) =>
    room.kind === "extra"
      ? room.note || copy.assign.extraDefault
      : room.kind === "no_checkin"
        ? room.pax !== null
          ? `${copy.assign.noCheckIn} (${room.pax})`
          : copy.assign.noCheckIn
        : `${room.guestName ?? "-"}${room.pax !== null ? ` (${room.pax})` : ""}`;

  let rowIndex = 0;
  const renderRows = (items: AssigneeRoomView[]) =>
    items.map((room) => {
      const isChanged = changed.some((item) => item.roomKey === room.roomKey);
      return (
        <div className="atw-ar" key={room.roomKey} style={{ "--i": Math.min(rowIndex++, 14) } as CSSProperties}>
          <b className="atw-ar__code">{room.code}</b>
          <span className="atw-ar__label">{roomLabel(room)}</span>
          {isChanged ? <span className="atw-ar__chg">{w.changedTag}</span> : null}
          <input
            aria-label={`${room.code} ${copy.assign.namePlaceholder}`}
            className="atw-input atw-ar__in"
            disabled={view}
            maxLength={120}
            onBlur={() => commit(room)}
            onChange={(event) => setNames((current) => ({ ...current, [room.roomKey]: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
            placeholder={w.namePlaceholder}
            value={names[room.roomKey] ?? ""}
          />
          {room.kind === "extra" && !view ? (
            <button
              aria-label={`${room.code} ${copy.assign.removeRoom}`}
              className="atw-icon"
              disabled={busy}
              onClick={() => removeRoom(room)}
              title={copy.assign.removeRoom}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          ) : null}
        </div>
      );
    });

  const cleaningGroups = groups("cleaning");
  const settingGroups = groups("setting");

  return (
    <div className="atw-assign">
      <div className="atw-tool">
        <div className="atw-date">
          <AdminDatePicker
            ariaLabel={copy.preview.date}
            display={hydrated ? dayLabel(date, localeTag) : mdOf(date)}
            labels={{ nextMonth: shared.dateNextMonth, prevMonth: shared.datePrevMonth, today: shared.dateToday }}
            localeTag={localeTag}
            onChange={setDate}
            value={date}
          />
        </div>
        {rooms !== null ? <span className="atw-tool__count">{fill(w.assignCount, counts)}</span> : null}
        <span className="atw-tool__sp" />
        {changed.length > 0 ? (
          <>
            <span className="atw-tool__chg">
              <Rich text={fill(w.changedCount, { n: changed.length })} />
            </span>
            <button className="atw-btn is-tint" disabled={view || busy} onClick={sendCorrection} type="button">
              {copy.assign.sendCorrection}
            </button>
          </>
        ) : null}
      </div>
      {view ? <div className="atw-ro">{copy.assign.viewOnly}</div> : null}
      {rooms === null ? (
        <div className="atw-muted">{copy.preview.loading}</div>
      ) : rooms.length === 0 ? (
        <div className="atw-empty">{copy.assign.empty}</div>
      ) : (
        <>
          {cleaningGroups.length === 0 ? (
            <div className="atw-agroup">
              <span className="atw-agroup__h">{copy.assign.cleaning}</span>
              <div className="atw-muted atw-agroup__none">{copy.assign.none}</div>
            </div>
          ) : (
            cleaningGroups.map(([label, items]) => (
              <div className="atw-agroup" key={`c-${label}`}>
                <span className="atw-agroup__h">{label}</span>
                {renderRows(items)}
              </div>
            ))
          )}
          {!view ? (
            <div className="atw-addroom">
              <span className="atw-addroom__t">
                <Plus aria-hidden="true" size={14} />
                {copy.assign.addRoom}
              </span>
              <div className="atw-addroom__pick">
                <AdmDropdown
                  ariaLabel={copy.assign.addRoomPick}
                  onChange={setAddKey}
                  options={addOptions}
                  placeholder={copy.assign.addRoomPick}
                  searchable
                  searchPlaceholder={copy.assign.addRoomSearch}
                  size="sm"
                  value={addKey}
                  wide
                />
              </div>
              <input
                aria-label={copy.assign.addRoomNote}
                className="atw-input"
                maxLength={60}
                onChange={(event) => setAddNote(event.target.value)}
                placeholder={copy.assign.addRoomNote}
                value={addNote}
              />
              <button className="atw-btn" disabled={busy || !addKey} onClick={addRoom} type="button">
                {copy.assign.addRoomButton}
              </button>
              <span className="atw-addroom__hint">{copy.assign.addRoomHint}</span>
            </div>
          ) : null}
          <div className="atw-agroup is-setting">
            <span className="atw-agroup__h">{copy.assign.setting}</span>
            {settingGroups.length === 0 ? (
              <div className="atw-muted atw-agroup__none">{copy.assign.none}</div>
            ) : (
              settingGroups.map(([label, items]) => (
                <div className="atw-agroup__sub" key={`s-${label}`}>
                  {settingGroups.length > 1 ? <span className="atw-agroup__sh">{label}</span> : null}
                  {renderRows(items)}
                </div>
              ))
            )}
          </div>
        </>
      )}
      <div className="atw-note">{copy.assign.note}</div>
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
  copy: Copy;
  flash: (text: string) => void;
  errorText: (code: string) => string;
}) {
  const w = copy.white;
  const [message, setMessage] = useState<string | null>(null);
  const open = (id: string) => {
    loadAutomationRunMessage(id).then((result) => {
      if (!result.ok) return flash(errorText(result.error));
      setMessage(result.text || "—");
    });
  };
  const reasonText = (reason: string | null) => runReasonText(reason, copy);
  const at = runAtText;

  if (job.runs.length === 0) {
    return (
      <div className="atw-empty">
        <b>{copy.history.empty}</b>
        <span>{copy.history.emptyBody}</span>
      </div>
    );
  }
  return (
    <>
      <table className="atw-tbl">
        <thead>
          <tr>
            <th>{copy.history.at}</th>
            <th>{copy.history.target}</th>
            <th>{w.historyDest}</th>
            <th>{copy.history.trigger}</th>
            <th>{copy.history.result}</th>
            <th>{copy.history.reason}</th>
            <th aria-label={w.raw} />
          </tr>
        </thead>
        <tbody>
          {job.runs.map((run, index) => (
            <tr key={run.id} style={{ "--i": Math.min(index, 14) } as CSSProperties}>
              <td className="atw-tbl__at">{at(run.createdAt)}</td>
              <td className="atw-tbl__dim">{run.targetDate ? mdOf(run.targetDate) : "—"}</td>
              <td>
                {run.channelKey ?? "—"}
                {run.locale ? ` · ${LANG_LABEL[run.locale as AutomationLocale] ?? run.locale}` : ""}
              </td>
              <td>{(copy.history.triggers as Record<string, string>)[run.trigger] ?? run.trigger}</td>
              <td>
                <span className={`atw-st ${statusClass(run.status)}`}>{w.runStatus[run.status]}</span>
              </td>
              <td className="atw-tbl__dim">{reasonText(run.reason)}</td>
              <td className="atw-tbl__r">
                {run.channelKey ? (
                  <button className="atw-link" onClick={() => open(run.id)} type="button">
                    {w.raw}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {message !== null ? (
        <div className="atw-scrim" onClick={() => setMessage(null)} role="presentation">
          <div aria-modal="true" className="atw-modal is-wide" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="atw-modal__t">{w.raw}</div>
            <div className="atw-modal__pre">{message}</div>
            <div className="atw-modal__f">
              <button className="atw-btn" onClick={() => setMessage(null)} type="button">
                {copy.history.close}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── 설정 ─────────────────────────────────────────────────────────────────

function SettingsPane({
  job,
  data,
  copy,
  view,
  flash,
  errorText,
  justSaved,
  onSaved,
}: {
  job: AutomationJobView;
  data: AutomationPageData;
  copy: Copy;
  view: boolean;
  flash: (text: string) => void;
  errorText: (code: string) => string;
  justSaved: boolean;
  onSaved: (jobKey: AutomationJobKey) => void;
}) {
  const w = copy.white;
  const original = useMemo(() => draftOf(job), [job]);
  const [draft, setDraft] = useState<Draft>(original);
  const [saving, startSave] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const weekdayLabels = copy.settings.weekdayShort.split(",");
  const timed = job.kind === "scheduled";

  const destinationFor = (channelKey: string) => draft.destinations.find((item) => item.channelKey === channelKey);
  const toggleLocale = (channelKey: string, itemLocale: AutomationLocale) => {
    setDraft((current) => {
      const existing = current.destinations.find((item) => item.channelKey === channelKey);
      const locales = existing
        ? existing.locales.includes(itemLocale)
          ? existing.locales.filter((value) => value !== itemLocale)
          : [...existing.locales, itemLocale]
        : [itemLocale];
      const ordered = AUTOMATION_LOCALES.filter((value) => locales.includes(value));
      const rest = current.destinations.filter((item) => item.channelKey !== channelKey);
      return { ...current, destinations: ordered.length > 0 ? [...rest, { channelKey, locales: ordered }] : rest };
    });
  };
  const toggleWeekday = (day: number) =>
    setDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day) ? current.weekdays.filter((value) => value !== day) : [...current.weekdays, day].sort(),
    }));
  const toggleExcluded = (name: string) =>
    setDraft((current) => {
      const list = current.settings.excludedProperties;
      return {
        ...current,
        settings: { ...current.settings, excludedProperties: list.includes(name) ? list.filter((value) => value !== name) : [...list, name] },
      };
    });
  const toggleChannel = (channel: (typeof DAILY_REPORT_CHANNELS)[number]) =>
    setDraft((current) => {
      const list = current.settings.channels;
      const next = list.includes(channel) ? list.filter((value) => value !== channel) : [...list, channel];
      return next.length === 0 ? current : { ...current, settings: { ...current.settings, channels: next } };
    });
  const setResend = (patch: Partial<AutomationSettings["resend"]>) =>
    setDraft((current) => ({ ...current, settings: { ...current.settings, resend: { ...current.settings.resend, ...patch } } }));

  const save = () => {
    // 켜져 있고 바꾼 시각 · 받는 곳으로 지금이 발송 시간대면, 저장 직후 틱이 바로 보낸다 — 한 번 묻는다.
    const sendsNow =
      timed &&
      job.enabled &&
      draft.destinations.length > 0 &&
      isScheduledSendDue({ ...draft, enabled: true, lastDoneOn: job.lastDoneOn }, new Date());
    if (sendsNow && !window.confirm(fill(copy.sendsNowWarning, { until: draft.retryUntil }))) return;
    startSave(async () => {
      const result = await saveAutomationJob({ jobKey: job.jobKey, ...draft });
      if (!result.ok) return flash(errorText(result.error));
      flash(copy.settings.saved);
      onSaved(job.jobKey);
    });
  };

  const changeCount = [
    draft.sendTime !== original.sendTime,
    draft.retryUntil !== original.retryUntil,
    JSON.stringify(draft.weekdays) !== JSON.stringify(original.weekdays),
    JSON.stringify(draft.destinations) !== JSON.stringify(original.destinations),
    JSON.stringify(draft.settings) !== JSON.stringify(original.settings),
  ].filter(Boolean).length;

  const fieldLabel = (key: string) => {
    if (key.startsWith("assignee:")) return copy.settings.fields.assignee;
    if (key.startsWith("extra:")) return copy.assign.addRoom;
    return (copy.settings.fields as Record<string, string>)[key] ?? key;
  };
  const scalar = (value: unknown) =>
    typeof value === "boolean" ? (value ? copy.on : copy.off) : typeof value === "string" || typeof value === "number" ? String(value) : null;
  const changeText = (key: string, change: { before: unknown; after: unknown }) => {
    const before = scalar(change?.before);
    const after = scalar(change?.after);
    if ((key === "sendTime" || key === "retryUntil" || key === "enabled") && before !== null && after !== null) {
      return fill(w.logChange, { after, before, field: fieldLabel(key) });
    }
    return fieldLabel(key);
  };
  const logAt = (iso: string) => `${mdOf(tokyoDayOf(iso))} ${hhmmOf(iso)}`;

  const resendRow = (label: string, body: string) => (
    <>
      <span className="atw-fl">{label}</span>
      <div className="atw-fv atw-fv--wrap">
        <button
          aria-checked={draft.settings.resend.enabled}
          aria-label={label}
          className={`atw-switch${draft.settings.resend.enabled ? " is-on" : ""}`}
          disabled={view}
          onClick={() => setResend({ enabled: !draft.settings.resend.enabled })}
          role="switch"
          type="button"
        >
          <i />
        </button>
        <span className="atw-fv__txt">{body}</span>
        <label className="atw-inl">
          {copy.settings.debounce}
          <input
            className="atw-input atw-num"
            disabled={view}
            max={120}
            min={1}
            onChange={(event) => setResend({ debounceMinutes: Number(event.target.value) || 1 })}
            type="number"
            value={draft.settings.resend.debounceMinutes}
          />
        </label>
        <label className="atw-inl">
          {copy.settings.max}
          <input
            className="atw-input atw-num"
            disabled={view}
            max={20}
            min={0}
            onChange={(event) => setResend({ maxPerDay: Number(event.target.value) || 0 })}
            type="number"
            value={draft.settings.resend.maxPerDay}
          />
        </label>
        <span className="atw-inl">
          {view ? (
            <b className="atw-mono">{draft.settings.resend.until}</b>
          ) : (
            <span className="atw-time">
              <AdminTimePicker ariaLabel={copy.settings.until} onChange={(value) => setResend({ until: value })} value={draft.settings.resend.until} />
            </span>
          )}
          {copy.settings.until}
        </span>
      </div>
    </>
  );

  return (
    <div className="atw-settings">
      {view ? <div className="atw-ro">{copy.settings.viewOnly}</div> : null}

      <div className="atw-form">
        {timed ? (
          <>
            <span className="atw-fl">{copy.settings.sendTime}</span>
            <div className="atw-fv">
              {view ? (
                <b className="atw-mono">{draft.sendTime}</b>
              ) : (
                <span className="atw-time">
                  <AdminTimePicker ariaLabel={copy.settings.sendTime} onChange={(value) => setDraft((c) => ({ ...c, sendTime: value }))} value={draft.sendTime} />
                </span>
              )}
              <span className="atw-fv__note">
                {copy.settings.tokyo} · {copy.settings.sendTimeNote}
              </span>
            </div>

            <span className="atw-fl">{copy.settings.weekdays}</span>
            <div className="atw-fv atw-days">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <button
                  aria-pressed={draft.weekdays.includes(day)}
                  className={`atw-day${draft.weekdays.includes(day) ? " is-on" : ""}`}
                  disabled={view}
                  key={day}
                  onClick={() => toggleWeekday(day)}
                  type="button"
                >
                  {weekdayLabels[day - 1] ?? day}
                </button>
              ))}
            </div>

            <span className="atw-fl">{copy.settings.retryUntil}</span>
            <div className="atw-fv">
              {view ? (
                <b className="atw-mono">{draft.retryUntil}</b>
              ) : (
                <span className="atw-time">
                  <AdminTimePicker ariaLabel={copy.settings.retryUntil} onChange={(value) => setDraft((c) => ({ ...c, retryUntil: value }))} value={draft.retryUntil} />
                </span>
              )}
              <span className="atw-fv__note">{copy.settings.retryNote}</span>
            </div>
          </>
        ) : (
          <>
            <span className="atw-fl">{copy.settings.eventWhen}</span>
            <div className="atw-fv">
              <span className="atw-fv__txt">{fill(copy.settings.eventNote, { trigger: copy.triggers[job.jobKey as keyof Copy["triggers"]] ?? "" })}</span>
            </div>
          </>
        )}

        {job.jobKey === "cleaning_list" ? resendRow(copy.settings.resendCleaningLabel, copy.settings.resendCleaning) : null}

        {job.jobKey === "daily_report" ? (
          <>
            <span className="atw-fl">{copy.settings.channelsRule}</span>
            <div className="atw-fv atw-chips">
              {DAILY_REPORT_CHANNELS.map((channel) => (
                <button
                  aria-pressed={draft.settings.channels.includes(channel)}
                  className={`atw-chip${draft.settings.channels.includes(channel) ? " is-on" : ""}`}
                  disabled={view}
                  key={channel}
                  onClick={() => toggleChannel(channel)}
                  type="button"
                >
                  {copy.settings.channelNames[channel]}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {job.jobKey !== "failure_alert" && job.jobKey !== "cancel_alert" ? (
          <>
            <span className="atw-fl">{copy.settings.excluded}</span>
            <div className="atw-fv atw-chips">
              {data.buildings.map((building) => (
                <button
                  aria-pressed={draft.settings.excludedProperties.includes(building.name)}
                  className={`atw-chip${draft.settings.excludedProperties.includes(building.name) ? " is-on" : ""}`}
                  disabled={view}
                  key={building.name}
                  onClick={() => toggleExcluded(building.name)}
                  type="button"
                >
                  {building.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {job.jobKey === "daily_report" ? resendRow(copy.settings.resendDailyLabel, copy.settings.resendDaily) : null}

        {job.jobKey === "cancel_alert" || job.jobKey === "same_day_alert" || job.jobKey === "failure_alert" ? (
          <>
            <span className="atw-fl">{copy.settings.scopeLabel}</span>
            <div className="atw-fv">
              <span className="atw-fv__txt">{copy.settings.scope[job.jobKey]}</span>
            </div>
          </>
        ) : null}
        {job.jobKey === "cleaning_list" ? (
          <>
            <span className="atw-fl">{copy.settings.roomCodesLabel}</span>
            <div className="atw-fv">
              <span className="atw-fv__note">{copy.settings.roomCodes}</span>
            </div>
          </>
        ) : null}
      </div>

      <div className="atw-sec">
        <span className="atw-sec__h">
          {copy.settings.dest} · {copy.settings.destNote}
        </span>
        {data.channels.length === 0 ? (
          <div className="atw-sec__row atw-muted">{copy.settings.noChannels}</div>
        ) : (
          data.channels.map((channel) => {
            const destination = destinationFor(channel.key);
            return (
              <div className="atw-dest" key={channel.key}>
                <span className="atw-dest__n">
                  <b>{channel.key}</b>
                  <span className={channel.valid ? "" : "is-bad"}>
                    {channel.valid ? copy.settings.connected : copy.settings.invalid} · …{channel.last4}
                  </span>
                </span>
                <span className="atw-dest__langs">
                  {AUTOMATION_LOCALES.map((item) => {
                    const on = destination?.locales.includes(item) ?? false;
                    return (
                      <button
                        aria-label={`${channel.key} ${LANG_LABEL[item]}`}
                        aria-pressed={on}
                        className={`atw-ck${on ? " is-on" : ""}`}
                        disabled={view || !channel.valid}
                        key={item}
                        onClick={() => toggleLocale(channel.key, item)}
                        type="button"
                      >
                        <i>{on ? <Check size={12} strokeWidth={3.2} /> : null}</i>
                        {LANG_LABEL[item]}
                      </button>
                    );
                  })}
                </span>
              </div>
            );
          })
        )}
        <span className="atw-note">{copy.settings.channelHint}</span>
      </div>

      <div className="atw-sec">
        <span className="atw-sec__h">{copy.settings.history}</span>
        {job.logs.length === 0 ? (
          <span className="atw-log atw-muted">{copy.settings.noLogs}</span>
        ) : (
          job.logs.map((log) => (
            <span className="atw-log" key={log.id}>
              {logAt(log.createdAt)} · {log.actorName ?? "—"} ·{" "}
              {Object.entries(log.changes)
                .map(([key, change]) => changeText(key, change))
                .join(" · ")}
            </span>
          ))
        )}
      </div>

      {!view ? (
        <div className="atw-save">
          {dirty ? <span className="atw-save__t">{fill(copy.settings.unsaved, { n: changeCount })}</span> : null}
          <button className="atw-btn is-big" disabled={!dirty || saving} onClick={() => setDraft(original)} type="button">
            {copy.settings.revert}
          </button>
          <button className={`atw-btn is-primary is-big${justSaved ? " is-done" : ""}`} disabled={!dirty || saving} onClick={save} type="button">
            {justSaved ? <DrawCheck /> : null}
            {w.saveSettings}
          </button>
        </div>
      ) : null}
    </div>
  );
}
