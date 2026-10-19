"use client";

/**
 * Attendance home — redesigned to match "Attendance Home (entry buttons).html" handoff.
 * Idle state: greeting header · ring hero · clock-in button · methods · shortcut entry list.
 * Open/break states: same greeting header + live ring data (unchanged).
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "./attendance.css";
import { AIc, AttIcon, AttRingDefs } from "./att-icons";
import { startBreak, endBreak, respondOpenSessionReminder } from "@/app/mobile/attendance/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { usePersistentToggle } from "@/lib/use-persistent-toggle";

type AttendanceCopy = Dictionary["attendance"];

function resolveBreakErrorMsg(reason: string, copy: AttendanceCopy): string {
  switch (reason) {
    case "no_session": return copy.breakErrorNoSession;
    case "already_on_break": return copy.breakErrorAlreadyOnBreak;
    case "no_open_break": return copy.breakErrorNoOpenBreak;
    default: return copy.breakErrorGeneric;
  }
}

export type HomeState = "idle" | "open" | "break" | "loading";

const RADIUS = 105;
const CIRC = 2 * Math.PI * RADIUS;

function Ring({
  variant,
  state,
  cls,
  big,
  sec,
  lbl,
  pct,
}: {
  variant: "idle" | "open" | "break";
  state?: string;
  cls?: "open" | "break";
  big?: string;
  sec?: string;
  lbl?: string;
  pct?: number;
}) {
  const off = CIRC * (1 - (pct ?? 0));
  return (
    <div className="hero">
      <div className="att-ring">
        <svg width="252" height="252" viewBox="0 0 252 252">
          <circle className="ring__track" cx="126" cy="126" r={RADIUS} />
          {variant !== "idle" ? (
            <circle
              className={`ring__prog ${cls}`}
              cx="126"
              cy="126"
              r={RADIUS}
              strokeDasharray={CIRC}
              strokeDashoffset={off}
            />
          ) : null}
        </svg>
        <div className="ring__center">
          {variant === "idle" ? (
            <>
              <span className="ring__idleicon">{AttIcon.qr}</span>
              <span className="ring__state idle">{state}</span>
              <span className="ring__idletxt">{lbl}</span>
            </>
          ) : (
            <>
              <span className={`ring__state ${cls}`}>
                <span className="pulse" />
                {state}
              </span>
              <span className="ring__big">
                {big}
                {sec ? <span className="sec">:{sec}</span> : null}
              </span>
              <span className="ring__lbl">{lbl}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtElapsed(elapsedSec: number) {
  const safe = Math.max(0, elapsedSec);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { big: `${pad(h)}:${pad(m)}`, sec: pad(s) };
}

function fmtHM(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}`;
}

function fmtMS(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(m)}:${pad(s)}`;
}

function LiveOpenRing({ clockInAt, copy }: { clockInAt: string | null; copy: AttendanceCopy }) {
  const startMs = clockInAt ? new Date(clockInAt).getTime() : null;
  const [elapsed, setElapsed] = useState(() =>
    startMs == null ? 0 : Math.floor((Date.now() - startMs) / 1000),
  );
  useEffect(() => {
    if (startMs == null) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startMs) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startMs]);
  const { big, sec } = fmtElapsed(elapsed);
  const pct = Math.min(Math.max(elapsed, 0) / (8 * 3600), 1);
  return <Ring variant="open" cls="open" state={copy.ringWorking} big={big} sec={sec} lbl={`${copy.ringAccumLabel} · ${copy.ringScaleNote}`} pct={pct} />;
}

function LiveBreakBody({
  clockInAt,
  openBreakStartedAt,
  closedBreakSeconds,
  breakCount,
  onEndBreak,
  busy,
  copy,
}: {
  clockInAt: string | null;
  openBreakStartedAt: string | null;
  closedBreakSeconds: number;
  breakCount: number;
  onEndBreak: () => void;
  busy: boolean;
  copy: AttendanceCopy;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const clockInMs = clockInAt ? new Date(clockInAt).getTime() : null;
  const breakStartMs = openBreakStartedAt ? new Date(openBreakStartedAt).getTime() : null;
  const currentBreakSec = breakStartMs ? Math.max(0, Math.floor((now - breakStartMs) / 1000)) : 0;
  const totalBreakSec = closedBreakSeconds + currentBreakSec;
  const elapsedSec = clockInMs ? Math.max(0, Math.floor((now - clockInMs) / 1000)) : 0;
  const workedSec = Math.max(0, elapsedSec - totalBreakSec);
  const pct = Math.min(workedSec / (8 * 3600), 1);

  return (
    <>
      <div className="breakbanner">
        <AIc>{AttIcon.coffee}</AIc>
        <div>
          <b>{copy.ringOnBreak}</b>
          <p>{copy.breakWarning}</p>
        </div>
        <span className="t mono">{fmtMS(currentBreakSec)}</span>
      </div>
      <Ring variant="break" cls="break" state={copy.ringOnBreak} big={fmtHM(workedSec)} lbl={copy.ringWorkLabel} pct={pct} />
      <div className="infostrip">
        <div className="infocell">
          <div className="infocell__k">{copy.breakTotal}</div>
          <div className="infocell__v mono">{fmtHM(totalBreakSec)}</div>
        </div>
        <div className="infocell">
          <div className="infocell__k">{copy.breakCount}</div>
          <div className="infocell__v">{copy.breakCountOrdinal(breakCount)}</div>
        </div>
      </div>
      <button type="button" className="clockbtn clockbtn--disabled">
        <AIc>{AttIcon.logout}</AIc>{copy.clockOutDisabled}
      </button>
      <button type="button" className="breakbtn breakbtn--active" onClick={onEndBreak} disabled={busy}>
        <AIc>{AttIcon.play}</AIc>{copy.endBreak}
      </button>
    </>
  );
}

function ReminderPrompt({ sessionId, copy }: { sessionId: string; copy: AttendanceCopy }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  const onStillWorking = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await respondOpenSessionReminder("still_working"); // 액션이 revalidatePath 한다 — router.refresh() 중복 금지
    setBusy(false);
    setOpen(false);
  }, [busy]);

  const onLeftWork = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await respondOpenSessionReminder("left_work");
      router.push(`/mobile/attendance/correction?sessionId=${sessionId}`);
    } finally {
      setBusy(false);
    }
  }, [busy, router, sessionId]);

  if (!open) return null;

  // NOTE: this sheet portals to <body> via BottomSheet, so the `.att`-scoped CSS does
  // NOT reach it. Styling is intentionally self-contained (Tailwind) — do not rely on
  // `.att .rsheet*` / `.att .rbtn*` here. Buttons stack full-width so longer ja/en labels
  // never clip (multilingual-safe).
  return (
    <BottomSheet onClose={() => setOpen(false)} ariaLabel={copy.reminderTitle}>
      <div className="px-1 pb-1 pt-3 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-[18px] bg-amber-100 text-amber-600 ring-1 ring-amber-200/70 [&>svg]:size-7">
          {AttIcon.warn}
        </div>
        <h3 className="text-[19px] font-extrabold tracking-[-0.02em] text-foreground">
          {copy.reminderTitle}
        </h3>
        <p className="mx-auto mt-1.5 max-w-[300px] text-[13.5px] leading-relaxed text-muted-foreground">
          {copy.reminderBody}
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onStillWorking}
            disabled={busy}
            className="flex h-[52px] w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(30,41,84,0.5)] transition active:scale-[0.98] disabled:opacity-60"
          >
            {copy.ringWorking}
          </button>
          <button
            type="button"
            onClick={onLeftWork}
            disabled={busy}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-[15px] font-bold text-foreground transition active:scale-[0.98] disabled:opacity-60 [&>svg]:size-[18px] [&>svg]:text-muted-foreground"
          >
            {AttIcon.edit}
            {copy.reminderLeft}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

function Methods({ copy }: { copy: AttendanceCopy }) {
  // 화이트 리디자인(2026-10-13): 링 아래 작은 글자 두 개 — 쓸 수 있는 방법(보라) · 준비 중(회색).
  return (
    <div className="methods">
      <span className="methodpill on">{copy.methodGpsQr}</span>
      <span className="methodpill">
        {copy.methodWifi} {copy.methodWifiSoon}
      </span>
    </div>
  );
}

/** 오늘 기록 — 출근 · 휴게(지금 있는 데이터만). 태블릿 가로의 빈 왼쪽 아래를 채운다(2026-10-13 시안 컨펌). */
function TodayLog({ session, copy }: { session: OpenSessionView; copy: AttendanceCopy }) {
  const breakMin = Math.round(session.closedBreakSeconds / 60);
  const onBreakAt = session.openBreakStartedAt
    ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tokyo" }).format(new Date(session.openBreakStartedAt))
    : null;
  return (
    <div className="att-todaylog">
      <div className="seclbl att-todaylog__t">{copy.homeTodayLog}</div>
      {onBreakAt ? (
        <div className="att-todaylog__r is-now">
          <i aria-hidden="true" />
          <span>{copy.homeLogOnBreak}</span>
          <time className="mono">{onBreakAt}</time>
        </div>
      ) : null}
      {session.breakCount > 0 && !onBreakAt ? (
        <div className="att-todaylog__r">
          <i aria-hidden="true" />
          <span>{copy.homeLogBreaks.replace("{n}", String(session.breakCount)).replace("{min}", String(breakMin))}</span>
          <time className="mono" />
        </div>
      ) : null}
      <div className={`att-todaylog__r${!onBreakAt && session.breakCount === 0 ? " is-now" : ""}`}>
        <i aria-hidden="true" />
        <span>{copy.homeLogClockIn.replace("{site}", session.siteName)}</span>
        <time className="mono">{session.clockInTimeLabel}</time>
      </div>
    </div>
  );
}

export type OpenSessionView = {
  clockInAt: string | null;
  clockInTimeLabel: string;
  siteName: string;
  openBreakStartedAt: string | null;
  closedBreakSeconds: number;
  breakCount: number;
};

export function AttendanceHome({
  userName,
  todayLabel,
  state = "idle",
  openSession = null,
  abandonedDates = [],
  reminderOpenSessionId = null,
  monthHours = null,
  monthPay = null,
  canSeeRoster = false,
  locale,
}: {
  userName: string;
  userInitial: string;
  todayLabel: string;
  state?: HomeState;
  openSession?: OpenSessionView | null;
  /** 퇴근을 안 찍고 넘어간 운영일들(YYYY-MM-DD). 비어 있으면 배너를 그리지 않는다. */
  abandonedDates?: string[];
  reminderOpenSessionId?: string | null;
  /** Formatted monthly worked hours (e.g. "32:10"). null = no data to show. */
  monthHours?: string | null;
  /** Formatted monthly pay string (e.g. "¥184,260"). null = salaried or no data. */
  monthPay?: string | null;
  /** Whether the current user may view the attendance roster (manager roles only). */
  canSeeRoster?: boolean;
  locale: string;
}) {
  const fullDict = getDictionary(locale);
  const copy = fullDict.attendance;
  const dict = fullDict;
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Default hidden (true). Persisted across sessions; shared key with attendance-pay.
  const [payMasked, togglePayMasked] = usePersistentToggle(
    "stayops:attendance:pay-amount-visible",
    true,
  );

  const onStartBreak = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    const res = await startBreak();
    setBusy(false);
    // 성공은 액션의 revalidatePath 가 화면을 갱신한다 — router.refresh() 중복 금지
    if (!res.ok) setErrorMsg(resolveBreakErrorMsg(res.reason ?? "error", copy));
  }, [busy, copy]);

  const onEndBreak = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    const res = await endBreak();
    setBusy(false);
    // 성공은 액션의 revalidatePath 가 화면을 갱신한다 — router.refresh() 중복 금지
    if (!res.ok) setErrorMsg(resolveBreakErrorMsg(res.reason ?? "error", copy));
  }, [busy, copy]);

  const [booting, setBooting] = useState(true);
  useEffect(() => {
    if (state === "loading") return;
    const t = setTimeout(() => setBooting(false), 800);
    return () => clearTimeout(t);
  }, [state]);
  const showLoading = state === "loading" || booting;

  // Greeting header — replaces old topline with avatar/links
  // 화이트 리디자인(2026-10-13): 인사말 대신 제목 「근태」 + 「10월 13일 화요일 · 김현준 님」.
  const greet = (
    <div className="greet greet--title">
      <h1 className="greet__h">{copy.homeTitle}</h1>
      <div className="greet__d">
        {todayLabel} · {copy.homeNameLine.replace("{name}", userName)}
      </div>
    </div>
  );

  // 퇴근 미기록 배너 — 근무 중이든 출근 전이든 항상 보여야 한다(정정 요청을 내야 하는 건 같다).
  // 날짜만 나열한다: 몇 시에 퇴근했는지는 본인만 아는 정보라 여기서 추정하지 않는다(2026-08-04).
  const abandonedBanner =
    abandonedDates.length > 0 ? (
      <div className="att-warn" role="status">
        <b>{copy.abandonedTitle}</b>
        <span>{copy.abandonedBody.replace("{dates}", abandonedDates.join(", "))}</span>
      </div>
    ) : null;

  // Shortcut entry list (idle only)
  const entryList = (
    <>
      <div className="seclbl">{copy.homeShortcutLabel}</div>
      <div className="entrylist">
        <Link href="/mobile/attendance/history" className="entryrow hist">
          <span className="entryrow__ic"><AIc>{AttIcon.clock}</AIc></span>
          <div className="entryrow__b">
            <div className="entryrow__t">{copy.homeHistTitle}</div>
            <div className="entryrow__s">{copy.homeHistSub}</div>
          </div>
          <div className="entryrow__r">
            <span className="entryrow__val">{monthHours ?? "00:00"}</span>
          </div>
        </Link>
        <Link href="/mobile/attendance/pay" className="entryrow pay">
          <span className="entryrow__ic"><AIc>{AttIcon.wallet}</AIc></span>
          <div className="entryrow__b">
            <div className="entryrow__t">{copy.homePayTitle}</div>
            <div className="entryrow__s">{copy.homePaySub}</div>
          </div>
          <div className="entryrow__r">
            <span className={`entryrow__val${payMasked ? " masked" : ""}`}>
              {monthPay ?? "---"}
            </span>
            <button
              type="button"
              className="eyemini"
              onClick={(e) => {
                e.preventDefault();
                togglePayMasked();
              }}
              aria-label={copy.homePayHide}
            >
              <AIc>{payMasked ? AttIcon.eyeOff : AttIcon.eye}</AIc>
            </button>
          </div>
        </Link>
        <Link href="/mobile/attendance/leave" className="entryrow leave">
          <span className="entryrow__ic"><AIc>{AttIcon.beach}</AIc></span>
          <div className="entryrow__b">
            <div className="entryrow__t">{copy.homeLeaveTitle}</div>
            <div className="entryrow__s">{copy.homeLeaveSub}</div>
          </div>
        </Link>
        {canSeeRoster && (
          <Link href="/mobile/attendance/roster" className="entryrow roster">
            <span className="entryrow__ic"><AIc>{AttIcon.users}</AIc></span>
            <div className="entryrow__b">
              <div className="entryrow__t">{copy.homeRosterTitle}</div>
              <div className="entryrow__s">{copy.homeRosterSub}</div>
            </div>
          </Link>
        )}
        <Link href="/mobile/attendance/transport" className="entryrow transport">
          <span className="entryrow__ic"><AIc>{AttIcon.bus}</AIc></span>
          <div className="entryrow__b">
            <div className="entryrow__t">{dict.transport.homeTransportTitle}</div>
            <div className="entryrow__s">{dict.transport.homeTransportSubNow}</div>
          </div>
        </Link>
      </div>
    </>
  );

  if (showLoading) {
    return (
      <div className="att att--home">
        <div className="greet">
          <div className="skel" style={{ width: "160px", height: "13px" }} />
          <div className="skel" style={{ width: "140px", height: "22px", marginTop: "8px" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 18px" }}>
          <div className="skel" style={{ width: "252px", height: "252px", borderRadius: "999px" }} />
        </div>
        <div className="skel" style={{ height: "60px", borderRadius: "18px", marginBottom: "11px" }} />
        <div className="skel" style={{ height: "52px", borderRadius: "14px" }} />
      </div>
    );
  }

  if (state === "open") {
    const siteName = openSession ? openSession.siteName : copy.previewSite;
    const clockInLabel = openSession ? openSession.clockInTimeLabel : "09:02";
    return (
      <div className="att att--home">
        <AttRingDefs />
        {greet}
        <div className="att-gap" />
        {openSession ? (
          <LiveOpenRing clockInAt={openSession.clockInAt} copy={copy} />
        ) : (
          <Ring variant="open" cls="open" state={copy.ringWorking} big="04:38" sec="12" lbl={`${copy.ringAccumLabel} · ${copy.ringScaleNote}`} pct={0.58} />
        )}
        <Methods copy={copy} />
        <div className="infostrip">
          <div className="infocell">
            <div className="infocell__k">{copy.clockInSite}</div>
            <div className="infocell__v">{siteName}</div>
          </div>
          <div className="infocell">
            <div className="infocell__k">{copy.clockInTime}</div>
            <div className="infocell__v mono">{clockInLabel}</div>
          </div>
        </div>
        {/* 휴게 시작(옅은 보라) | 퇴근(꽉 찬 보라) — 시안 Att-Phone */}
        <div className="att-actions">
          {openSession ? (
            <button type="button" className="breakbtn" onClick={onStartBreak} disabled={busy}>
              {copy.startBreak}
            </button>
          ) : (
            <Link href="/mobile/attendance?state=break" className="breakbtn">
              {copy.startBreak}
            </Link>
          )}
          <Link href="/mobile/attendance/capture?mode=out" className="clockbtn clockbtn--out">
            {copy.clockOut}
          </Link>
        </div>
        {openSession ? <TodayLog session={openSession} copy={copy} /> : null}
        {errorMsg ? (
          <p role="alert" style={{ color: "var(--color-error, #c0392b)", fontSize: "0.875rem", textAlign: "center", margin: "8px 0 0" }}>{errorMsg}</p>
        ) : null}
        {/* 근무 중 상태에서도 이력·급여로 바로 이동할 수 있도록 주요 액션 아래에 배치 */}
        {abandonedBanner}
        {entryList}
        {reminderOpenSessionId ? <ReminderPrompt sessionId={reminderOpenSessionId} copy={copy} /> : null}
      </div>
    );
  }

  if (state === "break") {
    return (
      <div className="att att--home">
        <AttRingDefs />
        {greet}
        <div className="att-gap" />
        {openSession ? (
          <LiveBreakBody
            clockInAt={openSession.clockInAt}
            openBreakStartedAt={openSession.openBreakStartedAt}
            closedBreakSeconds={openSession.closedBreakSeconds}
            breakCount={openSession.breakCount}
            onEndBreak={onEndBreak}
            busy={busy}
            copy={copy}
          />
        ) : (
          <>
            <div className="breakbanner">
              <AIc>{AttIcon.coffee}</AIc>
              <div>
                <b>{copy.ringOnBreak}</b>
                <p>{copy.breakWarning}</p>
              </div>
              <span className="t mono">00:23</span>
            </div>
            <Ring variant="break" cls="break" state={copy.ringOnBreak} big="04:15" lbl={copy.ringWorkLabel} pct={0.52} />
            <div className="infostrip">
              <div className="infocell">
                <div className="infocell__k">{copy.breakTotal}</div>
                <div className="infocell__v mono">00:48</div>
              </div>
              <div className="infocell">
                <div className="infocell__k">{copy.breakCount}</div>
                <div className="infocell__v">{copy.breakCountOrdinal(2)}</div>
              </div>
            </div>
            <button type="button" className="clockbtn clockbtn--disabled">
              <AIc>{AttIcon.logout}</AIc>{copy.clockOutDisabled}
            </button>
            <Link href="/mobile/attendance?state=open" className="breakbtn breakbtn--active">
              <AIc>{AttIcon.play}</AIc>{copy.endBreak}
            </Link>
          </>
        )}
        {errorMsg ? (
          <p role="alert" style={{ color: "var(--color-error, #c0392b)", fontSize: "0.875rem", textAlign: "center", margin: "8px 0 0" }}>{errorMsg}</p>
        ) : null}
        {/* 휴게 중 상태에서도 이력·급여 바로가기 유지 */}
        {abandonedBanner}
        {entryList}
        {reminderOpenSessionId ? <ReminderPrompt sessionId={reminderOpenSessionId} copy={copy} /> : null}
      </div>
    );
  }

  // idle — 출근 전
  return (
    <div className="att att--home">
      <AttRingDefs />
      {greet}
      <div className="att-gap" />
      <Ring variant="idle" state={copy.ringIdle} lbl={copy.ringIdleLabel} />
      <Methods copy={copy} />
      <Link href="/mobile/attendance/capture" className="clockbtn clockbtn--in">
        <AIc>{AttIcon.qr}</AIc>{copy.clockIn}
      </Link>
      {entryList}
    </div>
  );
}
