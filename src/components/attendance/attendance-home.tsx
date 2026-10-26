"use client";

/**
 * 출근 홈 — "Attendance Home (entry buttons).html" 핸드오프에 맞춰 재디자인.
 * 대기 상태: 인사 헤더 · 링 히어로 · 출근 버튼 · 방법 · 바로가기 진입 목록.
 * 근무 중/휴게 상태: 같은 인사 헤더 + 실시간 링 데이터 (변경 없음).
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import "./attendance.css";
import { AIc, AttIcon, AttRingDefs } from "./att-icons";
import { startBreak, endBreak, respondOpenSessionReminder } from "@/app/mobile/attendance/actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { usePersistentToggle } from "@/lib/use-persistent-toggle";
import { haptic } from "@/lib/haptics";
import { formatWeeklyMinutes } from "@/lib/staff-documents/weekly-limit";
import type { ResidenceCardNotice } from "@/lib/staff-documents/expiry";

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

// HIG 2차(2026-10-19): 링 240 · 두께 12 · 가운데 시간 34 — 숫자가 링에 닿지 않게.
const RADIUS = 110;
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
        <svg width="240" height="240" viewBox="0 0 240 240">
          <circle className="ring__track" cx="120" cy="120" r={RADIUS} />
          {variant !== "idle" ? (
            <circle
              className={`ring__prog ${cls}`}
              cx="120"
              cy="120"
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

  // 참고: 이 시트는 BottomSheet 를 통해 <body> 로 포털되므로 `.att` 범위 CSS 가 닿지 않는다.
  // 스타일은 의도적으로 자체 완결형(Tailwind)이다 — 의존하지 말 것
  // 여기서 `.att .rsheet*` / `.att .rbtn*` 에 의존하지 말 것. 버튼은 가로 전체로 쌓여서 긴 ja/en 라벨도
  // 잘리지 않는다 (다국어 안전).
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
  // HIG 2차(2026-10-19): 색 알약 대신 링 아래 회색 글자 한 줄 — 「GPS+QR · Wi-Fi 준비 중」.
  return (
    <p className="methods">
      {copy.methodGpsQr} · {copy.methodWifi} {copy.methodWifiSoon}
    </p>
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
  weeklyLimit = null,
  idCardNotice = null,
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
  /** 포맷된 월간 근무 시간 (예: "32:10"). null = 보여줄 데이터 없음. */
  monthHours?: string | null;
  /** 포맷된 월간 급여 문자열 (예: "¥184,260"). null = 월급제이거나 데이터 없음. */
  monthPay?: string | null;
  /** 현재 사용자가 출근 명단을 볼 수 있는지 (관리자 역할만). */
  canSeeRoster?: boolean;
  /** 「주 28시간」(docs/product/41 R4) — 자격외활동 대상자의 최근 7일이 근접 · 초과일 때만. */
  weeklyLimit?: { status: "over" | "near"; minutes: number } | null;
  /** 본인 재류카드 만료 · 30일 안 안내(docs/product/41 「만료 표시」). null 이면 그리지 않는다. */
  idCardNotice?: ResidenceCardNotice | null;
  locale: string;
}) {
  const fullDict = getDictionary(locale);
  const copy = fullDict.attendance;
  const dict = fullDict;
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 기본값은 숨김(true). 세션을 넘어 유지되며, attendance-pay 와 같은 키를 쓴다.
  const [payMasked, togglePayMasked] = usePersistentToggle(
    "stayops:attendance:pay-amount-visible",
    true,
  );

  const onStartBreak = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    let res: Awaited<ReturnType<typeof startBreak>>;
    try {
      res = await startBreak();
    } catch {
      res = { ok: false, reason: "error" } as Awaited<ReturnType<typeof startBreak>>;
    }
    setBusy(false);
    // 성공은 액션의 revalidatePath 가 화면을 갱신한다 — router.refresh() 중복 금지
    if (!res.ok) {
      haptic("error");
      setErrorMsg(resolveBreakErrorMsg(res.reason ?? "error", copy));
      return;
    }
    haptic("success");
  }, [busy, copy]);

  const onEndBreak = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    let res: Awaited<ReturnType<typeof endBreak>>;
    try {
      res = await endBreak();
    } catch {
      res = { ok: false, reason: "error" } as Awaited<ReturnType<typeof endBreak>>;
    }
    setBusy(false);
    // 성공은 액션의 revalidatePath 가 화면을 갱신한다 — router.refresh() 중복 금지
    if (!res.ok) {
      haptic("error");
      setErrorMsg(resolveBreakErrorMsg(res.reason ?? "error", copy));
      return;
    }
    haptic("success");
  }, [busy, copy]);

  const [booting, setBooting] = useState(true);
  useEffect(() => {
    if (state === "loading") return;
    const t = setTimeout(() => setBooting(false), 800);
    return () => clearTimeout(t);
  }, [state]);
  const showLoading = state === "loading" || booting;

  // 인사 헤더 — 예전 상단 줄을 아바타/링크로 대체
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

  // 「주 28시간」 안내 — 최근 7일(오늘에서 끝나는 창) 24시간 이상이면 조용히 한 장. 퇴근 미기록 배너와 같은 자리.
  const weeklyBanner = weeklyLimit ? (
    <div className={`att-warn${weeklyLimit.status === "over" ? " is-over" : ""}`} role="status">
      <b>{copy.weeklyNoticeTitle.replace("{hours}", formatWeeklyMinutes(weeklyLimit.minutes, copy))}</b>
      <span>{weeklyLimit.status === "over" ? copy.weeklyNoticeOver : copy.weeklyNoticeNear}</span>
    </div>
  ) : null;
  const notices =
    abandonedBanner || weeklyBanner ? (
      <>
        {abandonedBanner}
        {weeklyBanner}
      </>
    ) : null;

  // 바로가기 + (근무 중일 때) 오늘 기록 — 태블릿 가로에서는 오른쪽 칸(HIG 2차 시안 A2Att-Tablet).
  const chev = <span className="entryrow__chev" aria-hidden="true">{AttIcon.chevR}</span>;
  // 재류카드 안내 — 차분한 카드 한 장, 누르면 카드 등록 화면. 막지 않고 알리기만(갱신 신청 중이면 계속 일할 수 있다).
  const idCardCard = idCardNotice ? (
    <Link href="/account/id-card" className={`att-idcard${idCardNotice.kind === "expired" ? " is-expired" : ""}`}>
      <span className="att-idcard__b">
        <b>
          {idCardNotice.kind === "expired"
            ? copy.idCardExpiredTitle
            : idCardNotice.days === 0
              ? copy.idCardExpiringTodayTitle
              : copy.idCardExpiringTitle.replace("{n}", String(idCardNotice.days))}
        </b>
        <span>{idCardNotice.kind === "expired" ? copy.idCardExpiredBody : copy.idCardExpiringBody}</span>
      </span>
      <span className="att-idcard__a">{copy.idCardAction}</span>
    </Link>
  ) : null;
  const sideColumn = (log: ReactNode = null) => (
    <div className="att-side">
      {idCardCard}
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
            {chev}
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
            {chev}
          </div>
        </Link>
        <Link href="/mobile/attendance/leave" className="entryrow leave">
          <span className="entryrow__ic"><AIc>{AttIcon.beach}</AIc></span>
          <div className="entryrow__b">
            <div className="entryrow__t">{copy.homeLeaveTitle}</div>
            <div className="entryrow__s">{copy.homeLeaveSub}</div>
          </div>
          {chev}
        </Link>
        {canSeeRoster && (
          <Link href="/mobile/attendance/roster" className="entryrow roster">
            <span className="entryrow__ic"><AIc>{AttIcon.users}</AIc></span>
            <div className="entryrow__b">
              <div className="entryrow__t">{copy.homeRosterTitle}</div>
              <div className="entryrow__s">{copy.homeRosterSub}</div>
            </div>
            {chev}
          </Link>
        )}
        <Link href="/mobile/attendance/transport" className="entryrow transport">
          <span className="entryrow__ic"><AIc>{AttIcon.bus}</AIc></span>
          <div className="entryrow__b">
            <div className="entryrow__t">{dict.transport.homeTransportTitle}</div>
            <div className="entryrow__s">{dict.transport.homeTransportSubNow}</div>
          </div>
          {chev}
        </Link>
      </div>
      {log}
    </div>
  );

  if (showLoading) {
    return (
      <div className="att att--home">
        <div className="greet">
          <div className="skel" style={{ width: "160px", height: "13px" }} />
          <div className="skel" style={{ width: "140px", height: "22px", marginTop: "8px" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 18px" }}>
          <div className="skel" style={{ width: "240px", height: "240px", borderRadius: "999px" }} />
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
        <div className="att-main">
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
          {errorMsg ? (
            <p role="alert" style={{ color: "var(--color-error, #c0392b)", fontSize: "0.875rem", textAlign: "center", margin: "8px 0 0" }}>{errorMsg}</p>
          ) : null}
          {/* 근무 중 상태에서도 이력·급여로 바로 이동할 수 있도록 주요 액션 아래에 배치 */}
          {notices}
        </div>
        {sideColumn(openSession ? <TodayLog session={openSession} copy={copy} /> : null)}
        {reminderOpenSessionId ? <ReminderPrompt sessionId={reminderOpenSessionId} copy={copy} /> : null}
      </div>
    );
  }

  if (state === "break") {
    return (
      <div className="att att--home">
        <AttRingDefs />
        {greet}
        <div className="att-main">
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
          {notices}
        </div>
        {sideColumn()}
        {reminderOpenSessionId ? <ReminderPrompt sessionId={reminderOpenSessionId} copy={copy} /> : null}
      </div>
    );
  }

  // idle — 출근 전
  return (
    <div className="att att--home">
      <AttRingDefs />
      {greet}
      <div className="att-main">
        <div className="att-gap" />
        <Ring variant="idle" state={copy.ringIdle} lbl={copy.ringIdleLabel} />
        <Methods copy={copy} />
        <Link href="/mobile/attendance/capture" className="clockbtn clockbtn--in">
          <AIc>{AttIcon.qr}</AIc>{copy.clockIn}
        </Link>
        {/* 출근 전이 가장 쓸모 있는 때 — 출근하기 전에 최근 7일 시간을 본다. 퇴근 미기록 배너도 출근 전에
            보여야 한다(지난 운영일의 열린 근무는 출근 전 상태로 온다 — attendance-sessions getCurrentOpenSession). */}
        {notices}
      </div>
      {sideColumn()}
    </div>
  );
}
