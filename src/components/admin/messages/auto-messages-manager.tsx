"use client";

/**
 * PC 「자동 안내」 탭 — 왼쪽: 안내 목록(이름 · 보내는 때 · 다음 발송 · 켜기) + 「보낼 예정」, 오른쪽: 고치기(시안 Rules).
 * docs/product/47-guest-messaging.md §5-3 · §5-6
 *
 * - `guest_messages.manage` 만(서버 페이지가 거르고, 액션이 다시 본다). 새 안내는 꺼진 채로 저장 → 미리 보기 확인 뒤 켠다.
 * - 고치기 저장은 연 때의 버전(`updated_at`)일 때만 — 남이 먼저 고쳤으면 쓴 글은 두고 「최신 값 불러오기 / 내 글로 덮기」.
 * - 지우기는 하드 삭제 + 확인 창(CLAUDE.md 9). 세로 구분선 없음(목록 칸 바탕만 다름), 고른 줄은 옅은 보라 바탕(왼쪽 막대 없음).
 */

import { Check, ChevronDown, Lock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteAutoRuleAction,
  listUpcomingAutoRunsAction,
  previewAutoRuleAction,
  saveAutoRuleAction,
  setAutoRunPausedAction,
  toggleAutoRuleAction,
  type SaveAutoRuleActionResult,
} from "@/app/admin/messages/auto-actions";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminTimePicker } from "@/components/admin/shared/admin-time-picker";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { autoRunStatusText, autoVariableLabel, autoWhenText, formatAutoAt, missingText } from "@/components/guest-messages/auto-format";
import { GmConfirm } from "@/components/guest-messages/gm-parts";
import { channelName, fill, type GmCopy } from "@/components/guest-messages/gm-format";
import { useBuildingName, useRoomPlaceLabel } from "@/components/shared/building-names";
import {
  AUTO_CODE_VARIABLES,
  AUTO_LIMITS,
  AUTO_TARGET_CHANNELS,
  AUTO_TARGET_STATUSES,
  AUTO_TRIGGERS,
  AUTO_VARIABLES,
  canPauseAutoRun,
  canResumeAutoRun,
  offsetRange,
  type AutoRule,
  type AutoRunView,
  type AutoTargetStatus,
  type AutoTrigger,
  type AutoVariable,
} from "@/lib/guest-messages/auto-model";
import type { AutoPreview, AutoPreviewBooking, AutoRuleSummary } from "@/lib/guest-messages/auto-rules-server";
import { GUEST_LANGS, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import type { GuestChannelKey } from "@/lib/guest-messages/types";
import { haptic } from "@/lib/haptics";

const LANG_KEY: Record<GuestLang, "langAutonymKo" | "langAutonymJa" | "langAutonymEn"> = {
  ko: "langAutonymKo",
  ja: "langAutonymJa",
  en: "langAutonymEn",
};
const TRIGGER_KEY: Record<AutoTrigger, keyof GmCopy> = {
  confirmed: "autoTriggerConfirmed",
  before_checkin: "autoTriggerBeforeCheckin",
  day_of_checkin: "autoTriggerDayOfCheckin",
  before_checkout: "autoTriggerBeforeCheckout",
  after_checkout: "autoTriggerAfterCheckout",
};
const STATUS_KEY: Record<AutoTargetStatus, keyof GmCopy> = {
  confirmed: "autoStatusConfirmed",
  request: "autoStatusRequest",
  inquiry: "autoStatusInquiry",
};
const DEFAULT_TIME: Record<AutoTrigger, string | null> = {
  confirmed: null,
  before_checkin: "18:00",
  day_of_checkin: "10:00",
  before_checkout: "20:00",
  after_checkout: "12:00",
};

type Editing = {
  id: string | null;
  name: string;
  trigger: AutoTrigger;
  offsetDays: number;
  sendTime: string | null;
  targetBuildings: string[];
  targetChannels: GuestChannelKey[];
  targetStatuses: AutoTargetStatus[];
  bodies: Localized;
  version: string | null;
};

const EMPTY: Editing = {
  id: null,
  name: "",
  trigger: "before_checkin",
  offsetDays: 1,
  sendTime: "18:00",
  targetBuildings: [],
  targetChannels: [],
  targetStatuses: ["confirmed"],
  bodies: { ko: "", ja: "", en: "" },
  version: null,
};

const editingOf = (rule: AutoRule): Editing => ({
  id: rule.id,
  name: rule.name,
  trigger: rule.trigger,
  offsetDays: rule.offsetDays,
  sendTime: rule.sendTime,
  targetBuildings: [...rule.targetBuildings],
  targetChannels: [...rule.targetChannels],
  targetStatuses: [...rule.targetStatuses],
  bodies: { ...rule.bodies },
  version: rule.updatedAt,
});

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function isDirty(editing: Editing, original: AutoRule | null): boolean {
  if (!original) {
    return Boolean(editing.name.trim() || editing.bodies.ko || editing.bodies.ja || editing.bodies.en);
  }
  return (
    original.name !== editing.name ||
    original.trigger !== editing.trigger ||
    original.offsetDays !== editing.offsetDays ||
    original.sendTime !== editing.sendTime ||
    !sameList(original.targetBuildings, editing.targetBuildings) ||
    !sameList(original.targetChannels, editing.targetChannels) ||
    !sameList(original.targetStatuses, editing.targetStatuses) ||
    GUEST_LANGS.some((lang) => original.bodies[lang] !== editing.bodies[lang])
  );
}

function errorOf(key: Extract<SaveAutoRuleActionResult, { ok: false }>["errorKey"] | "invalid" | "locked", copy: GmCopy): string {
  switch (key) {
    case "empty":
      return copy.autoErrEmpty;
    case "too_long":
      return copy.autoErrTooLong;
    case "invalid_time":
      return copy.autoErrTime;
    case "invalid_offset":
      return copy.autoErrOffset;
    case "limit":
      return copy.autoErrLimit;
    case "not_found":
      return copy.autoErrNotFound;
    case "forbidden":
      return copy.forbidden;
    case "locked":
      return copy.autoPauseLocked;
    default:
      return copy.autoErrFailed;
  }
}

/** 여러 개 고르는 드롭다운 — 공용 `.dd` 모양 그대로(두 번째 드롭다운 스타일을 만들지 않는다), 고르는 동안 열린 채. */
function MultiDropdown({
  label,
  allLabel,
  countLabel,
  options,
  value,
  onChange,
  required = false,
}: {
  label: string;
  allLabel: string;
  countLabel: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  /** 하나는 골라야 한다(예약 상태) — 「모두」 = 전부 고름. */
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const all = required ? value.length === options.length : value.length === 0;
  const shown = all
    ? allLabel
    : value.length === 1
      ? (options.find((option) => option.value === value[0])?.label ?? allLabel)
      : fill(countLabel, { n: value.length });
  const toggle = (key: string) => {
    haptic("light");
    if (value.includes(key)) {
      const next = value.filter((item) => item !== key);
      if (required && next.length === 0) return;
      onChange(next);
    } else {
      const next = [...value, key];
      onChange(!required && next.length === options.length ? [] : next);
    }
  };
  return (
    <div className={`dd${open ? " open" : ""}`} ref={rootRef}>
      <button type="button" className="dd__btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
        <span className="dd__val">{shown}</span>
        <span className="ic dd__chev">
          <ChevronDown />
        </span>
      </button>
      {open ? (
        <div className="dd__menu" role="listbox" aria-multiselectable="true" aria-label={label}>
          <button
            type="button"
            className={`dd__opt${all ? " on" : ""}`}
            role="option"
            aria-selected={all}
            onClick={() => {
              haptic("light");
              onChange(required ? options.map((option) => option.value) : []);
            }}
          >
            <span className="dd__opt__k">{allLabel}</span>
            {all ? (
              <span className="ic dd__chk">
                <Check />
              </span>
            ) : null}
          </button>
          {options.map((option) => {
            const on = !all && value.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`dd__opt${on ? " on" : ""}`}
                role="option"
                aria-selected={on}
                onClick={() => toggle(option.value)}
              >
                <span className="dd__opt__k">{option.label}</span>
                {on ? (
                  <span className="ic dd__chk">
                    <Check />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function UpcomingRow({
  run,
  copy,
  locale,
  busy,
  onPause,
}: {
  run: AutoRunView;
  copy: GmCopy;
  locale: string;
  busy: boolean;
  onPause: (run: AutoRunView, paused: boolean) => void;
}) {
  const buildingName = useBuildingName();
  const roomLabel = useRoomPlaceLabel();
  const status = autoRunStatusText(run, copy);
  const place = [run.propertyName ? buildingName(run.propertyName) : null, run.roomLabel ? roomLabel(run.roomLabel) : null]
    .filter(Boolean)
    .join(" · ");
  const guest = run.guestName ?? copy.guestUnknown;
  return (
    <div className="gm-arun">
      <span className="gm-arun__at">{formatAutoAt(run.scheduledAt, locale)}</span>
      <span className="gm-arun__main">
        <b>{guest}</b>
        <span>{[run.ruleName, place, channelName((run.channel as GuestChannelKey | null) ?? null, copy)].filter(Boolean).join(" · ")}</span>
      </span>
      <span className={`gm-arun__status${status.urgent ? " gm-urgent" : ""}`}>{status.text}</span>
      <span className="gm-arun__act">
        {canPauseAutoRun(run) ? (
          <button
            type="button"
            className="gm-btn gm-btn--sm"
            disabled={busy}
            aria-label={fill(copy.autoPauseAria, { guest, rule: run.ruleName })}
            onClick={() => onPause(run, true)}
          >
            {copy.autoPause}
          </button>
        ) : canResumeAutoRun(run) ? (
          <button
            type="button"
            className="gm-btn gm-btn--sm"
            disabled={busy}
            aria-label={fill(copy.autoResumeAria, { guest, rule: run.ruleName })}
            onClick={() => onPause(run, false)}
          >
            {copy.autoResume}
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function AutoMessagesManager({
  copy,
  locale,
  rules,
  upcoming,
  previewBookings,
  buildings,
  sendEnabled,
}: {
  copy: GmCopy;
  locale: string;
  rules: AutoRuleSummary[] | null;
  upcoming: AutoRunView[] | null;
  previewBookings: AutoPreviewBooking[];
  buildings: Array<{ key: string; label: string }>;
  sendEnabled: boolean;
}) {
  const router = useRouter();
  const buildingName = useBuildingName();
  const roomLabel = useRoomPlaceLabel();
  const { toast, showToast, dismiss } = useAdminToast();
  const [list, setList] = useState<AutoRuleSummary[]>(rules ?? []);
  const [runs, setRuns] = useState<AutoRunView[]>(upcoming ?? []);
  const [seen, setSeen] = useState({ rules, upcoming });
  if (seen.rules !== rules || seen.upcoming !== upcoming) {
    setSeen({ rules, upcoming });
    setList(rules ?? []);
    setRuns(upcoming ?? []);
  }
  const [editing, setEditing] = useState<Editing | null>(() => (rules?.[0] ? editingOf(rules[0]) : null));
  const [lang, setLang] = useState<GuestLang>(GUEST_LANGS.includes(locale as GuestLang) ? (locale as GuestLang) : "en");
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<{ kind: "delete"; rule: AutoRule } | { kind: "discard"; next: Editing | null } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [runFilter, setRunFilter] = useState<string>("");
  const [busyRun, setBusyRun] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [previewId, setPreviewId] = useState<string>(previewBookings[0]?.providerBookingId ?? "");
  const [preview, setPreview] = useState<{ key: string; state: "loading" | "failed" | AutoPreview } | null>(null);

  const previewKey = editing && previewId ? JSON.stringify([previewId, lang, editing.bodies[lang], editing.bodies.en]) : null;
  useEffect(() => {
    if (!previewKey || !editing) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      setPreview((current) => ({ key: previewKey, state: current?.key === previewKey ? current.state : "loading" }));
      const result = await previewAutoRuleAction({ bodies: editing.bodies, lang, providerBookingId: previewId });
      if (!alive) return;
      setPreview({ key: previewKey, state: result.ok ? result.preview : "failed" });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // previewKey 가 본문 · 언어 · 예약을 다 담는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  if (rules === null) {
    return (
      <div className="gm-root gm-settings">
        <p className="gm-set__error" role="alert">
          {copy.autoLoadFailed}
        </p>
      </div>
    );
  }

  const original = editing?.id ? (list.find((rule) => rule.id === editing.id) ?? null) : null;
  const dirty = editing ? isDirty(editing, original) : false;

  const refreshRuns = async (filter: string = runFilter) => {
    const result = await listUpcomingAutoRunsAction(filter || null);
    if (result.ok) setRuns(result.runs);
  };

  const pick = (next: Editing | null) => {
    if (editing && dirty) {
      setConfirm({ kind: "discard", next });
      return;
    }
    setEditing(next);
    setConflict(false);
  };

  const save = () => {
    if (!editing || pending) return;
    startTransition(async () => {
      const result = await saveAutoRuleAction({
        id: editing.id,
        name: editing.name,
        trigger: editing.trigger,
        offsetDays: editing.offsetDays,
        sendTime: editing.sendTime,
        targetBuildings: editing.targetBuildings,
        targetChannels: editing.targetChannels,
        targetStatuses: editing.targetStatuses,
        bodies: editing.bodies,
        expectedUpdatedAt: editing.version,
      });
      if (result.ok) {
        haptic("success");
        const isNew = !editing.id;
        setList((current) => {
          const summary = (prev?: AutoRuleSummary): AutoRuleSummary => ({
            ...result.rule,
            nextSendAt: prev?.nextSendAt ?? null,
            scheduledCount: prev?.scheduledCount ?? 0,
            blockedCount: prev?.blockedCount ?? 0,
          });
          return isNew ? [...current, summary()] : current.map((rule) => (rule.id === result.rule.id ? summary(rule) : rule));
        });
        setEditing(editingOf(result.rule));
        setConflict(false);
        showToast(result.rule.enabled ? copy.autoSaved : copy.autoSavedOff);
        await refreshRuns();
        router.refresh();
      } else if (result.errorKey === "conflict") {
        haptic("error");
        const latest = result.current;
        setList((current) => current.map((rule) => (rule.id === latest.id ? { ...rule, ...latest } : rule)));
        setEditing((current) => (current && current.id === latest.id ? { ...current, version: latest.updatedAt } : current));
        setConflict(true);
      } else {
        haptic("error");
        showToast(errorOf(result.errorKey, copy));
      }
    });
  };

  const toggle = (rule: AutoRuleSummary) => {
    const next = !rule.enabled;
    haptic("light");
    setList((current) => current.map((item) => (item.id === rule.id ? { ...item, enabled: next } : item)));
    startTransition(async () => {
      const result = await toggleAutoRuleAction(rule.id, next);
      if (result.ok) {
        showToast(next ? copy.autoTurnedOn : copy.autoTurnedOff);
        await refreshRuns();
        router.refresh();
      } else {
        haptic("error");
        setList((current) => current.map((item) => (item.id === rule.id ? { ...item, enabled: rule.enabled } : item)));
        showToast(errorOf(result.errorKey, copy));
      }
    });
  };

  const remove = (rule: AutoRule) => {
    setConfirm(null);
    startTransition(async () => {
      const result = await deleteAutoRuleAction(rule.id);
      if (result.ok) {
        haptic("light");
        setList((current) => current.filter((item) => item.id !== rule.id));
        setRuns((current) => current.filter((run) => run.ruleId !== rule.id));
        if (editing?.id === rule.id) setEditing(null);
        showToast(copy.autoDeleted);
        router.refresh();
      } else {
        haptic("error");
        showToast(errorOf(result.errorKey, copy));
      }
    });
  };

  const pauseRun = (run: AutoRunView, paused: boolean) => {
    if (busyRun) return;
    setBusyRun(run.id);
    startTransition(async () => {
      const result = await setAutoRunPausedAction(run.id, paused);
      setBusyRun(null);
      if (result.ok) {
        haptic("light");
        showToast(paused ? copy.autoPausedToast : copy.autoResumedToast);
        await refreshRuns();
      } else {
        haptic("error");
        showToast(errorOf(result.errorKey, copy));
      }
    });
  };

  const insertVariable = (name: AutoVariable) => {
    if (!editing) return;
    const token = `{${name}}`;
    const el = bodyRef.current;
    const value = editing.bodies[lang];
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    setEditing({ ...editing, bodies: { ...editing.bodies, [lang]: `${value.slice(0, start)}${token}${value.slice(end)}` } });
    requestAnimationFrame(() => {
      const node = bodyRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const setTrigger = (trigger: AutoTrigger) => {
    if (!editing) return;
    const range = offsetRange(trigger);
    const offsetDays = Math.min(range.max, Math.max(range.min, editing.offsetDays));
    setEditing({
      ...editing,
      trigger,
      offsetDays,
      sendTime: trigger === "confirmed" ? null : (editing.sendTime ?? DEFAULT_TIME[trigger]),
    });
  };

  const langsOf = (bodies: Localized) => {
    const names = GUEST_LANGS.filter((code) => bodies[code].trim()).map((code) => copy[LANG_KEY[code]]);
    return names.length ? names.join(" · ") : copy.replyLangsNone;
  };

  const nextText = (rule: AutoRuleSummary) => {
    if (!rule.enabled) return copy.autoStateOff;
    if (rule.trigger === "confirmed") return copy.autoNextOnConfirm;
    return rule.nextSendAt ? formatAutoAt(rule.nextSendAt, locale) : "—";
  };

  const targetSummary = (rule: Editing | AutoRule) =>
    [
      rule.targetStatuses.length === AUTO_TARGET_STATUSES.length
        ? copy.autoPickAll
        : rule.targetStatuses.map((status) => copy[STATUS_KEY[status]] as string).join(" · "),
      rule.targetBuildings.length === 0
        ? copy.autoAllBuildings
        : rule.targetBuildings.length === 1
          ? copy.autoOneBuilding
          : fill(copy.autoNBuildings, { n: rule.targetBuildings.length }),
    ].join(" · ");

  const range = editing ? offsetRange(editing.trigger) : null;
  const previewState = preview && preview.key === previewKey ? preview.state : previewKey ? "loading" : null;
  const previewBooking = previewBookings.find((booking) => booking.providerBookingId === previewId) ?? null;
  const guestVars = AUTO_VARIABLES.filter((name) => !AUTO_CODE_VARIABLES.includes(name));

  return (
    <div className="gm-root gm-replies gm-auto">
      <section className="gm-replies__list" aria-label={copy.autoListLabel}>
        <div className="gm-replies__top">
          <p>{copy.autoBody}</p>
          <button
            type="button"
            className="gm-btn gm-btn--primary gm-btn--lg"
            disabled={list.length >= AUTO_LIMITS.count}
            onClick={() => pick({ ...EMPTY, bodies: { ...EMPTY.bodies }, targetStatuses: [...EMPTY.targetStatuses] })}
          >
            {copy.autoAdd}
          </button>
        </div>
        {!sendEnabled ? <p className="gm-auto__off">{copy.autoSendOff}</p> : null}
        {list.length > 0 ? (
          <div className="gm-auto__head" aria-hidden="true">
            <span>{copy.autoColName}</span>
            <span>{copy.autoColWhen}</span>
            <span>{copy.autoColNext}</span>
            <span>{copy.autoColOn}</span>
          </div>
        ) : editing?.id !== null ? (
          <div className="gm-empty">
            <b>{copy.autoEmpty}</b>
            <span>{copy.autoEmptyHint}</span>
          </div>
        ) : null}
        {list.map((rule) => (
          <div key={rule.id} className="gm-reply-row gm-auto__row" data-selected={editing?.id === rule.id ? "" : undefined}>
            <button
              type="button"
              className="gm-reply-row__main"
              aria-current={editing?.id === rule.id ? "true" : undefined}
              onClick={() => pick(editingOf(rule))}
            >
              <b>{rule.name}</b>
              <span>
                {langsOf(rule.bodies)}
                {rule.blockedCount > 0 ? (
                  <span className="gm-urgent"> · {fill(copy.autoBlockedCount, { n: rule.blockedCount })}</span>
                ) : null}
              </span>
            </button>
            <span className="gm-auto__when">{autoWhenText(rule, copy)}</span>
            <span className="gm-auto__next">{nextText(rule)}</span>
            <span className="gm-auto__on">
              <button
                type="button"
                role="switch"
                className="gm-switch"
                aria-checked={rule.enabled}
                aria-label={fill(copy.autoToggleLabel, { name: rule.name })}
                disabled={pending}
                onClick={() => toggle(rule)}
              />
            </span>
          </div>
        ))}
        <p className="gm-auto__foot">{copy.autoFootNote}</p>

        <section className="gm-auto__upcoming" aria-label={copy.autoUpcomingTitle}>
          <div className="gm-set__head">
            <h2 className="gm-set__title">{copy.autoUpcomingTitle}</h2>
            <span className="gm-auto__filter">
              <AdmDropdown
                size="sm"
                ariaLabel={copy.autoUpcomingFilter}
                value={runFilter}
                options={[{ value: "", label: copy.autoUpcomingAll }, ...list.map((rule) => ({ value: rule.id, label: rule.name }))]}
                onChange={(value) => {
                  setRunFilter(value);
                  startTransition(() => refreshRuns(value));
                }}
              />
            </span>
          </div>
          <p className="gm-set__body">{copy.autoUpcomingBody}</p>
          {upcoming === null ? <p className="gm-set__error">{copy.autoLoadFailed}</p> : null}
          {upcoming !== null && runs.length === 0 ? <p className="gm-hint">{copy.autoUpcomingEmpty}</p> : null}
          {runs.map((run) => (
            <UpcomingRow key={run.id} run={run} copy={copy} locale={locale} busy={busyRun !== null} onPause={pauseRun} />
          ))}
        </section>
      </section>

      {editing && range ? (
        <aside className="gm-editor gm-auto__editor" aria-label={editing.id ? editing.name || copy.autoNew : copy.autoNew}>
          <div className="gm-auto__titlebar">
            <div>
              <span className="gm-editor__kicker">
                {[original ? (original.enabled ? copy.autoStateOn : copy.autoStateOff) : copy.autoStateOff, targetSummary(editing)].join(" · ")}
              </span>
              <h2 className="gm-editor__title">{editing.id ? (original?.name ?? editing.name) : copy.autoNew}</h2>
            </div>
            {editing.id && original ? (
              <button
                type="button"
                className="gm-iconbtn-sm"
                data-tone="danger"
                aria-label={copy.autoDelete}
                disabled={pending}
                onClick={() => setConfirm({ kind: "delete", rule: original })}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {conflict && original ? (
            <div className="gm-conflict" role="alert">
              <span>{copy.autoConflict}</span>
              <span className="gm-conflict__acts">
                <button
                  type="button"
                  className="gm-btn gm-btn--sm"
                  onClick={() => {
                    haptic("light");
                    setEditing(editingOf(original));
                    setConflict(false);
                  }}
                >
                  {copy.replyConflictLoad}
                </button>
                <button type="button" className="gm-btn gm-btn--sm gm-btn--primary" disabled={pending} onClick={save}>
                  {copy.replyConflictOverwrite}
                </button>
              </span>
            </div>
          ) : null}
          <label className="gm-notch" style={{ marginTop: 8 }}>
            <span className="gm-notch__label">{copy.autoNameLabel}</span>
            <input
              className="gm-notch__input"
              value={editing.name}
              maxLength={AUTO_LIMITS.name}
              placeholder={copy.autoNamePlaceholder}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
          </label>

          <div className="gm-auto__field">
            <span className="gm-auto__k">{copy.autoTriggerLabel}</span>
            <div className="gm-auto__when-row">
              <AdmDropdown
                ariaLabel={copy.autoTriggerLabel}
                value={editing.trigger}
                options={AUTO_TRIGGERS.map((trigger) => ({ value: trigger, label: copy[TRIGGER_KEY[trigger]] as string }))}
                onChange={(value) => setTrigger(value as AutoTrigger)}
              />
              {range.max > 0 ? (
                <span className="gm-auto__offset">
                  <input
                    className="gm-num"
                    type="number"
                    inputMode="numeric"
                    min={range.min}
                    max={range.max}
                    aria-label={copy.autoOffsetLabel}
                    value={editing.offsetDays}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setEditing({ ...editing, offsetDays: Number.isFinite(value) ? Math.trunc(value) : range.min });
                    }}
                    aria-invalid={editing.offsetDays < range.min || editing.offsetDays > range.max ? "true" : undefined}
                  />
                  <span className="gm-hint">{editing.trigger === "after_checkout" ? copy.autoOffsetAfter : copy.autoOffsetBefore}</span>
                </span>
              ) : null}
              {editing.sendTime !== null ? (
                <span className="gm-auto__time">
                  <AdminTimePicker
                    ariaLabel={copy.autoTimeLabel}
                    value={editing.sendTime}
                    onChange={(value) => setEditing({ ...editing, sendTime: value })}
                  />
                  <span className="gm-hint">{copy.autoTokyoTime}</span>
                </span>
              ) : null}
            </div>
            {editing.trigger === "confirmed" ? <span className="gm-hint">{copy.autoConfirmedHint}</span> : null}
            {editing.trigger === "before_checkout" ? <span className="gm-hint">{copy.autoOffsetSameDay}</span> : null}
          </div>

          <div className="gm-auto__field">
            <span className="gm-auto__k">{copy.autoTargetsLabel}</span>
            <div className="gm-auto__targets">
              <MultiDropdown
                label={copy.autoTargetStatuses}
                allLabel={copy.autoPickAll}
                countLabel={copy.autoNStatuses}
                required
                options={AUTO_TARGET_STATUSES.map((status) => ({ value: status, label: copy[STATUS_KEY[status]] as string }))}
                value={editing.targetStatuses}
                onChange={(next) => setEditing({ ...editing, targetStatuses: next as AutoTargetStatus[] })}
              />
              <MultiDropdown
                label={copy.autoTargetBuildings}
                allLabel={copy.autoAllBuildings}
                countLabel={copy.autoNBuildings}
                options={buildings.map((building) => ({ value: building.key, label: building.label }))}
                value={editing.targetBuildings}
                onChange={(next) => setEditing({ ...editing, targetBuildings: next })}
              />
              <MultiDropdown
                label={copy.autoTargetChannels}
                allLabel={copy.autoAllChannels}
                countLabel={copy.autoNChannels}
                options={AUTO_TARGET_CHANNELS.map((channel) => ({ value: channel, label: channelName(channel, copy) }))}
                value={editing.targetChannels}
                onChange={(next) => setEditing({ ...editing, targetChannels: next as GuestChannelKey[] })}
              />
            </div>
          </div>

          <div className="gm-set__head" style={{ alignItems: "center" }}>
            <span className="gm-hint">{copy.autoLangOther}</span>
            <div className="gm-langseg" role="tablist" aria-label={copy.guestInfoLangLabel}>
              {GUEST_LANGS.map((code) => (
                <button key={code} type="button" role="tab" aria-selected={lang === code} onClick={() => setLang(code)}>
                  {copy[LANG_KEY[code]]}
                </button>
              ))}
            </div>
          </div>
          <label className="gm-notch">
            <span className="gm-notch__label">{fill(copy.replyBodyLabel, { lang: copy[LANG_KEY[lang]] })}</span>
            <textarea
              ref={bodyRef}
              className="gm-notch__input"
              rows={7}
              lang={lang}
              value={editing.bodies[lang]}
              maxLength={AUTO_LIMITS.body}
              placeholder={copy.replyBodyPlaceholder}
              onChange={(event) => setEditing({ ...editing, bodies: { ...editing.bodies, [lang]: event.target.value } })}
            />
          </label>
          <div className="gm-vars">
            <span className="gm-hint">{copy.autoVarsTitle}</span>
            {guestVars.map((name) => (
              <button key={name} type="button" className="gm-btn gm-btn--sm" onClick={() => insertVariable(name)}>
                {autoVariableLabel(name, copy)}
              </button>
            ))}
          </div>
          <div className="gm-vars">
            <span className="gm-hint gm-auto__codes">
              <Lock size={12} aria-hidden="true" /> {copy.autoVarsCodes}
            </span>
            {AUTO_CODE_VARIABLES.map((name) => (
              <button key={name} type="button" className="gm-btn gm-btn--sm" onClick={() => insertVariable(name)}>
                {autoVariableLabel(name, copy)}
              </button>
            ))}
          </div>

          <div className="gm-auto__preview">
            <div className="gm-auto__preview-head">
              <span className="gm-hint">{copy.autoPreviewTitle}</span>
              {previewBookings.length > 0 ? (
                <AdmDropdown
                  size="sm"
                  wide
                  ariaLabel={copy.autoPreviewPick}
                  value={previewId}
                  options={previewBookings.map((booking) => ({
                    value: booking.providerBookingId,
                    label: [
                      booking.propertyName ? buildingName(booking.propertyName) : null,
                      booking.roomLabel ? roomLabel(booking.roomLabel) : null,
                      booking.guestName,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  }))}
                  onChange={setPreviewId}
                />
              ) : null}
            </div>
            {previewBookings.length === 0 ? (
              <span className="gm-hint">{copy.autoPreviewNone}</span>
            ) : previewState === "loading" || previewState === null ? (
              <span className="gm-hint" aria-live="polite">
                {copy.autoPreviewLoading}
              </span>
            ) : previewState === "failed" ? (
              <span className="gm-set__error">{copy.autoPreviewFailed}</span>
            ) : previewState.noBody ? (
              <span className="gm-hint">{copy.autoPreviewNoBody}</span>
            ) : (
              <>
                <div className="gm-auto__bubble" lang={previewState.lang} aria-label={previewBooking?.guestName ?? copy.autoPreviewTitle}>
                  {previewState.text}
                </div>
                {previewState.fellBackToEnglish ? <span className="gm-hint">{copy.autoPreviewEnglish}</span> : null}
                {previewState.missing.length > 0 ? (
                  <span className="gm-urgent gm-auto__missing" role="status">
                    {fill(copy.autoPreviewMissing, { fields: missingText(previewState.missing, copy) })}
                  </span>
                ) : null}
              </>
            )}
          </div>

          <div className="gm-editor__foot">
            {dirty ? (
              <button type="button" className="gm-btn gm-btn--lg" disabled={pending} onClick={() => pick(original ? editingOf(original) : null)}>
                {copy.replyCancel}
              </button>
            ) : null}
            <button type="button" className="gm-btn gm-btn--primary gm-btn--lg" disabled={!dirty || pending} onClick={save}>
              {pending ? copy.settingsSaving : copy.replySave}
            </button>
          </div>
        </aside>
      ) : null}

      {confirm?.kind === "delete" ? (
        <GmConfirm
          title={fill(copy.autoDeleteTitle, { name: confirm.rule.name })}
          body={copy.autoDeleteBody}
          confirmLabel={copy.autoDelete}
          cancelLabel={copy.replyCancel}
          onConfirm={() => remove(confirm.rule)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm?.kind === "discard" ? (
        <GmConfirm
          title={copy.replyUnsavedTitle}
          body={copy.replyUnsavedBody}
          confirmLabel={copy.replyDiscard}
          cancelLabel={copy.replyCancel}
          onConfirm={() => {
            setEditing(confirm.next);
            setConflict(false);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}
