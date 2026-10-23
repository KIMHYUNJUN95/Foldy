"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronRight } from "lucide-react";
import { saveAutomationJob } from "@/actions/ops-automation";
import type { AutomationJobView, AutomationPageData } from "@/lib/automation/console-data";
import {
  AUTOMATION_LOCALES,
  DAILY_REPORT_CHANNELS,
  type AutomationDestination,
  type AutomationLocale,
  type AutomationSettings,
} from "@/lib/automation/jobs";
import { isScheduledSendDue, tokyoClock } from "@/lib/automation/schedule";
import type { Dictionary } from "@/lib/i18n";
import "./mobile-automation-form.css";

/**
 * 모바일 자동화 — 설정 칸(시안 AutoMSettings-Phone, 2026-10-15). PC `SettingsPane`(automation-console.tsx)와 같은 동작 ·
 * 같은 서버 액션(`saveAutomationJob`)을 폰 손에 맞게 옮겼다: 시각은 기기 시각 휠(투명 `<input type="time">` 이 줄 전체를 덮음),
 * 확인 간격 · 하루 최대는 −/+ , 저장 줄은 바뀐 게 있을 때만 아래에서 올라온다(폰은 탭바 위, 폴드 · 태블릿은 칸 아래).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「화이트 리디자인」 · 「모바일」
 * 잠금(보기 전용)은 편의다 — 저장은 서버 액션이 `automation.manage` 를 다시 본다.
 */

type Copy = Dictionary["automation"];

export const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(String(value)), template);

/** `*굵게*` 표시(PC 와 같은 규칙). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("*").map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : <span key={index}>{part}</span>))}
    </>
  );
}

export const errorTextOf = (copy: Copy, code: string) => (copy.errors as Record<string, string>)[code] ?? copy.errors.save_failed;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmmOf = (iso: string) => {
  const minutes = tokyoClock(new Date(iso)).minutes;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
};
const mdOf = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 언어 이름은 그 언어로(번역하지 않는 고유 이름 — PC `LANG_LABEL` 과 같은 성격). */
const LANG_SHORT: Record<AutomationLocale, string> = { en: "EN", ja: "日本語", ko: "한국어" };
const LANG_FULL: Record<AutomationLocale, string> = { en: "English", ja: "日本語", ko: "한국어" };

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
export function DrawCheck({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="maf-draw" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
    </svg>
  );
}

/**
 * 가운데 확인 창 — 「그대로 두기 / 실행」. 첫 초점은 「그대로 두기」(Enter 한 번에 Slack 으로 나가지 않게).
 * 닫기는 「그대로 두기」 · Esc · 바깥 누르기. body 로 포털(당겨서 새로고침의 transform 에 갇히지 않게).
 */
export function MobileConfirm({
  title,
  body,
  okLabel,
  keepLabel,
  busy,
  onOk,
  onKeep,
}: {
  title: string;
  body: ReactNode;
  okLabel: string;
  keepLabel: string;
  busy: boolean;
  onOk: () => void;
  onKeep: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ busy, onKeep });
  useEffect(() => {
    latest.current = { busy, onKeep };
  });
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !latest.current.busy) latest.current.onKeep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="maf-cf"
      data-native-back-overlay=""
      onPointerDown={(event) => {
        event.stopPropagation(); // 셸의 마우스 당겨서 새로고침으로 올라가지 않게(포털도 React 트리로는 올라간다)
        if (event.target === event.currentTarget && !busy) onKeep();
      }}
    >
      <div aria-describedby="maf-cf-body" aria-labelledby="maf-cf-title" aria-modal="true" className="maf-cf__card" role="alertdialog">
        <h3 id="maf-cf-title">{title}</h3>
        <p id="maf-cf-body">{body}</p>
        <div className="maf-cf__btns">
          <button className="maf-btn is-gray" disabled={busy} onClick={onKeep} ref={keepRef} type="button">
            {keepLabel}
          </button>
          <button className="maf-btn is-primary" disabled={busy} onClick={onOk} type="button">
            {okLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 저장 줄을 화면 맨 아래에 붙인다. 셸 스크롤 칸(`[data-shell-scroll]`)은 아래 패딩(폰 124 · 폴드 40 · 칸 32)이 있어 sticky 가
 * 그만큼 위에 서므로 그 값을 읽어 음수 bottom 으로 되돌린다. 폰에서 탭바가 보이면(셸이 스크롤에 따라 내렸다 올림 — 인라인 transform)
 * 탭바 + 가운데 단추 위로 들어 올리고, 탭바가 내려가면 같이 내려온다.
 */
function useStickyBar(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!active || !bar) return;
    const scroller = bar.closest<HTMLElement>("[data-shell-scroll]");
    const nav = document.querySelector<HTMLElement>("nav.tabbar");
    const update = () => {
      if (scroller) bar.style.setProperty("--maf-pad", getComputedStyle(scroller).paddingBottom);
      const shown = !!nav && getComputedStyle(nav).display !== "none" && (nav.style.transform === "" || /translateY\(0(px)?\)/.test(nav.style.transform));
      if (shown && nav) {
        const barPad = parseFloat(getComputedStyle(bar).paddingBottom) || 0;
        // 단추 아랫변이 탭바 윗변보다 24px 위(가운데 + 단추가 14px 솟는다).
        bar.style.setProperty("--maf-lift", `${Math.max(0, nav.offsetHeight + 24 - barPad)}px`);
      }
      bar.classList.toggle("is-lifted", shown);
    };
    update();
    const observer = nav ? new MutationObserver(update) : null;
    observer?.observe(nav as HTMLElement, { attributeFilter: ["style", "class"], attributes: true });
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [active]);
  return ref;
}

/** 시각 줄 — 줄 전체를 투명한 기기 시각 입력이 덮는다(iOS · Android 는 휠, 데스크톱은 `showPicker`). */
function TimeRow({
  label,
  value,
  display,
  note,
  view,
  sub,
  onChange,
}: {
  label: string;
  value: string;
  display: string;
  note?: string;
  view: boolean;
  sub?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`maf-time${sub ? " is-sub" : ""}${view ? " is-off" : ""}`}>
      <span className="maf-time__top">
        <span className={sub ? "maf-sl" : "maf-l"}>{label}</span>
        <b className="maf-v" key={value}>
          {display}
        </b>
        {view ? null : <ChevronRight aria-hidden="true" className="maf-chev" size={14} strokeWidth={2} />}
      </span>
      {note ? <span className="maf-note">{note}</span> : null}
      {view ? null : (
        <input
          aria-label={label}
          className="maf-time__in"
          onChange={(event) => {
            // iOS 「지우기」는 빈 값 — 시각이 없는 자동화는 없으니 무시한다.
            if (/^\d{2}:\d{2}/.test(event.target.value)) onChange(event.target.value.slice(0, 5));
          }}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker?.();
            } catch {
              /* 사용자 동작 밖 · 지원 안 함 — 기기 기본 동작에 맡긴다 */
            }
          }}
          step={60}
          type="time"
          value={value}
        />
      )}
    </label>
  );
}

/** −/+ 숫자 — 버튼 36px(줄은 44px). 바뀌면 숫자가 누른 쪽으로 살짝 굴러 들어온다. */
function Stepper({
  label,
  value,
  display,
  min,
  max,
  view,
  copy,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  view: boolean;
  copy: Copy["mobileForm"];
  onChange: (value: number) => void;
}) {
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next === value) return;
    setDir(delta > 0 ? "up" : "down");
    onChange(next);
  };
  return (
    <div className="maf-step">
      <span className="maf-sl">{label}</span>
      <div aria-label={label} className="maf-step__ctl" role="group">
        <button aria-label={`${label} ${copy.decrease}`} className="maf-step__b" disabled={view || value <= min} onClick={() => step(-1)} type="button">
          −
        </button>
        <output aria-live="polite" className="maf-step__v">
          <span className={dir ? `is-${dir}` : ""} key={value}>
            {display}
          </span>
        </output>
        <button aria-label={`${label} ${copy.increase}`} className="maf-step__b" disabled={view || value >= max} onClick={() => step(1)} type="button">
          +
        </button>
      </div>
    </div>
  );
}

export function MobileAutomationSettings({
  job,
  data,
  copy,
  view,
  flash,
}: {
  job: AutomationJobView;
  data: AutomationPageData;
  copy: Copy;
  view: boolean;
  flash: (text: string) => void;
}) {
  const router = useRouter();
  const m = copy.mobileForm;
  const s = copy.settings;
  const original = useMemo(() => draftOf(job), [job]);
  const [draft, setDraft] = useState<Draft>(original);
  const [saving, startSave] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // 서버에서 새 값이 오면(저장 뒤 refresh · 다른 자동화로 바꿈) 따라간다 — 손대던 중(같은 자동화 · 바뀐 곳 있음)이면 그대로 둔다.
  const signature = JSON.stringify(original);
  const [synced, setSynced] = useState({ jobKey: job.jobKey, signature });
  if (synced.signature !== signature || synced.jobKey !== job.jobKey) {
    const wasClean = JSON.stringify(draft) === synced.signature;
    setSynced({ jobKey: job.jobKey, signature });
    if (wasClean || synced.jobKey !== job.jobKey) setDraft(original);
  }

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  const dirty = JSON.stringify(draft) !== signature;
  const weekdayLabels = s.weekdayShort.split(",");
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

  const doSave = () => {
    startSave(async () => {
      const result = await saveAutomationJob({ jobKey: job.jobKey, ...draft });
      setConfirming(false);
      if (!result.ok) return flash(errorTextOf(copy, result.error));
      flash(s.saved);
      setJustSaved(true);
      router.refresh();
    });
  };
  const save = () => {
    // 켜져 있고 바꾼 시각 · 받는 곳으로 지금이 발송 시간대면, 저장 직후 틱이 바로 보낸다 — 한 번 묻는다(PC 와 같은 조건).
    const sendsNow =
      timed && job.enabled && draft.destinations.length > 0 && isScheduledSendDue({ ...draft, enabled: true, lastDoneOn: job.lastDoneOn }, new Date());
    if (sendsNow) return setConfirming(true);
    doSave();
  };

  const changeCount = [
    draft.sendTime !== original.sendTime,
    draft.retryUntil !== original.retryUntil,
    JSON.stringify(draft.weekdays) !== JSON.stringify(original.weekdays),
    JSON.stringify(draft.destinations) !== JSON.stringify(original.destinations),
    JSON.stringify(draft.settings) !== JSON.stringify(original.settings),
  ].filter(Boolean).length;

  // 변경 이력 글자 — PC 와 같은 규칙.
  const fieldLabel = (key: string) => {
    if (key.startsWith("assignee:")) return s.fields.assignee;
    if (key.startsWith("extra:")) return copy.assign.addRoom;
    return (s.fields as Record<string, string>)[key] ?? key;
  };
  const scalar = (value: unknown) =>
    typeof value === "boolean" ? (value ? copy.on : copy.off) : typeof value === "string" || typeof value === "number" ? String(value) : null;
  const changeText = (key: string, change: { before: unknown; after: unknown }) => {
    const before = scalar(change?.before);
    const after = scalar(change?.after);
    if ((key === "sendTime" || key === "retryUntil" || key === "enabled") && before !== null && after !== null) {
      return fill(copy.white.logChange, { after, before, field: fieldLabel(key) });
    }
    return fieldLabel(key);
  };
  const logAt = (iso: string) => `${mdOf(tokyoClock(new Date(iso)).date)} ${hhmmOf(iso)}`;

  const resendBlock = (label: string, body: string) => (
    <div className="maf-row maf-resend">
      <div className="maf-sw-row">
        <span className="maf-sw-row__t">
          <span className="maf-l">{label}</span>
          <span className="maf-note">{body}</span>
        </span>
        <button
          aria-checked={draft.settings.resend.enabled}
          aria-label={label}
          className={`maf-switch${draft.settings.resend.enabled ? " is-on" : ""}`}
          disabled={view}
          onClick={() => setResend({ enabled: !draft.settings.resend.enabled })}
          role="switch"
          type="button"
        >
          <i />
        </button>
      </div>
      <Stepper
        copy={m}
        display={String(draft.settings.resend.debounceMinutes)}
        label={s.debounce}
        max={120}
        min={1}
        onChange={(value) => setResend({ debounceMinutes: value })}
        value={draft.settings.resend.debounceMinutes}
        view={view}
      />
      <Stepper
        copy={m}
        display={fill(m.timesPerDay, { n: draft.settings.resend.maxPerDay })}
        label={s.max}
        max={20}
        min={0}
        onChange={(value) => setResend({ maxPerDay: value })}
        value={draft.settings.resend.maxPerDay}
        view={view}
      />
      <TimeRow
        display={draft.settings.resend.until}
        label={m.untilRow}
        onChange={(value) => setResend({ until: value })}
        sub
        value={draft.settings.resend.until}
        view={view}
      />
    </div>
  );

  const showSave = !view && (dirty || saving || justSaved);
  const barRef = useStickyBar(showSave);

  return (
    <div className={`maf maf-settings${view ? " is-view" : ""}`}>
      {view ? <div className="maf-ro">{s.viewOnly}</div> : null}

      {timed ? (
        <>
          <TimeRow
            display={draft.sendTime}
            label={s.sendTime}
            note={`${s.tokyo} · ${s.sendTimeNote}`}
            onChange={(value) => setDraft((current) => ({ ...current, sendTime: value }))}
            value={draft.sendTime}
            view={view}
          />
          <div className="maf-row">
            <span className="maf-l">{s.weekdays}</span>
            <div className="maf-days">
              {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                const on = draft.weekdays.includes(day);
                return (
                  <button
                    aria-pressed={on}
                    className={`maf-day${on ? " is-on" : ""}`}
                    disabled={view}
                    key={day}
                    onClick={() => toggleWeekday(day)}
                    type="button"
                  >
                    {weekdayLabels[day - 1] ?? day}
                  </button>
                );
              })}
            </div>
          </div>
          <TimeRow
            display={fill(m.untilAt, { time: draft.retryUntil })}
            label={s.retryUntil}
            note={s.retryNote}
            onChange={(value) => setDraft((current) => ({ ...current, retryUntil: value }))}
            value={draft.retryUntil}
            view={view}
          />
        </>
      ) : (
        <div className="maf-row">
          <span className="maf-l">{s.eventWhen}</span>
          <span className="maf-txt">{fill(s.eventNote, { trigger: copy.triggers[job.jobKey as keyof Copy["triggers"]] ?? "" })}</span>
        </div>
      )}

      {job.jobKey === "cleaning_list" ? resendBlock(s.resendCleaningLabel, s.resendCleaning) : null}

      {job.jobKey === "daily_report" ? (
        <div className="maf-row">
          <span className="maf-l">{s.channelsRule}</span>
          <div className="maf-pills">
            {DAILY_REPORT_CHANNELS.map((channel) => {
              const on = draft.settings.channels.includes(channel);
              return (
                <button aria-pressed={on} className={`maf-pill${on ? " is-on" : ""}`} disabled={view} key={channel} onClick={() => toggleChannel(channel)} type="button">
                  {s.channelNames[channel]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {job.jobKey !== "failure_alert" && job.jobKey !== "cancel_alert" ? (
        <div className="maf-row">
          <span className="maf-l">{s.excluded}</span>
          <div className="maf-pills">
            {data.buildings.map((building) => {
              const on = draft.settings.excludedProperties.includes(building.name);
              return (
                <button
                  aria-pressed={on}
                  className={`maf-pill${on ? " is-on" : ""}`}
                  disabled={view}
                  key={building.name}
                  onClick={() => toggleExcluded(building.name)}
                  type="button"
                >
                  {building.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {job.jobKey === "daily_report" ? resendBlock(s.resendDailyLabel, s.resendDaily) : null}

      {job.jobKey === "cancel_alert" || job.jobKey === "same_day_alert" || job.jobKey === "failure_alert" ? (
        <div className="maf-row">
          <span className="maf-l">{s.scopeLabel}</span>
          <span className="maf-txt">{s.scope[job.jobKey]}</span>
        </div>
      ) : null}
      {job.jobKey === "cleaning_list" ? (
        <div className="maf-row">
          <span className="maf-l">{s.roomCodesLabel}</span>
          <span className="maf-note">{s.roomCodes}</span>
        </div>
      ) : null}

      <span className="maf-h">
        {s.dest} · {s.destNote}
      </span>
      {data.channels.length === 0 ? (
        <div className="maf-row maf-muted">{s.noChannels}</div>
      ) : (
        data.channels.map((channel) => {
          const destination = destinationFor(channel.key);
          return (
            <div className="maf-row maf-dest" key={channel.key}>
              <span className="maf-dest__n">
                <b>{channel.key}</b>
                <span className={channel.valid ? "is-ok" : "is-bad"}>
                  {channel.valid ? s.connected : s.invalid} · …{channel.last4}
                </span>
              </span>
              <div className="maf-langs">
                {AUTOMATION_LOCALES.map((item) => {
                  const on = destination?.locales.includes(item) ?? false;
                  return (
                    <button
                      aria-label={`${channel.key} ${LANG_FULL[item]}`}
                      aria-pressed={on}
                      className={`maf-lang${on ? " is-on" : ""}`}
                      disabled={view || !channel.valid}
                      key={item}
                      onClick={() => toggleLocale(channel.key, item)}
                      type="button"
                    >
                      <i>{on ? <Check size={11} strokeWidth={3.4} /> : null}</i>
                      {LANG_SHORT[item]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
      <span className="maf-note maf-hint">{s.channelHint}</span>

      <span className="maf-h">{s.history}</span>
      {job.logs.length === 0 ? (
        <span className="maf-log maf-muted">{s.noLogs}</span>
      ) : (
        job.logs.map((log) => (
          <span className="maf-log" key={log.id}>
            {logAt(log.createdAt)} · {log.actorName ?? "—"} ·{" "}
            {Object.entries(log.changes)
              .map(([key, change]) => changeText(key, change))
              .join(" · ")}
          </span>
        ))
      )}

      {showSave ? (
        <div className="maf-save" ref={barRef}>
          <span className="maf-save__t">{dirty ? <Rich text={fill(m.changedShort, { n: changeCount })} /> : null}</span>
          <button className="maf-btn is-gray" disabled={!dirty || saving} onClick={() => setDraft(original)} type="button">
            {s.revert}
          </button>
          <button className={`maf-btn is-primary${justSaved && !dirty ? " is-done" : ""}`} disabled={!dirty || saving} onClick={save} type="button">
            {justSaved && !dirty ? (
              <>
                <DrawCheck />
                {m.saved}
              </>
            ) : (
              copy.white.saveSettings
            )}
          </button>
        </div>
      ) : null}

      {confirming ? (
        <MobileConfirm
          body={fill(copy.sendsNowWarning, { until: draft.retryUntil })}
          busy={saving}
          keepLabel={m.keep}
          okLabel={m.saveAnyway}
          onKeep={() => setConfirming(false)}
          onOk={doSave}
          title={m.saveNowTitle}
        />
      ) : null}
    </div>
  );
}
