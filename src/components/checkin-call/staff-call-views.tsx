"use client";

// 직원 통화 화면 — 폰 · 폴드 E4 · E5 · E6, 태블릿 E7, PC E8 · E9(시안 캔버스 BCPPdekM… 「재수정 · 직원 통화」). 문구는 전부 사전, 건물은 보는 사람 언어로.
import { BookOpen, Mic, MicOff, Phone, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBuildingName } from "@/components/shared/building-names";
import { checkinPropertyName } from "@/lib/checkin/model";
import { formatCallElapsed, type StaffCallNotice } from "@/lib/checkin/staff-call-flow";
import type { RingingStaffCall, StaffCallStay } from "@/lib/checkin/staff-call";
import type { Dictionary } from "@/lib/i18n";
import "./staff-call.css";

export type StaffCallCopy = Dictionary["checkinCall"];

const PRESS = "transition-transform duration-[120ms] ease-[cubic-bezier(.23,1,.32,1)] active:scale-[.97]";
// BottomSheet 기본(z-80)이나 콘솔 패널 위로 — 어느 화면에서든 전화가 보여야 한다.
const CALL_Z = "z-[200]";
export const STAY_SHEET_Z = "z-[210]";

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}

export function useCallLabels(call: RingingStaffCall, copy: StaffCallCopy) {
  const buildingName = useBuildingName();
  const building = buildingName(checkinPropertyName(call.propertyKey) ?? call.propertyKey);
  const steps: Record<string, string> = copy.steps;
  const stepRows: Record<string, string> = copy.stepRows;
  const languages: Record<string, string> = copy.languages;
  const language = languages[call.language] ?? call.language;
  return {
    title: fill(copy.title, { building }),
    why: fill(copy.why, { lang: language, step: steps[call.step] ?? steps.other }),
    language,
    stepRow: stepRows[call.step] ?? stepRows.other,
  };
}

export function useElapsed(startedAtMs: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAtMs === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAtMs]);
  return formatCallElapsed(startedAtMs === null ? 0 : now - startedAtMs);
}

/** 닫힐 때 포커스를 원래 자리로. 그사이 사용자가 다른 곳으로 옮겼으면(입력 중 등) 뺏지 않는다 — 패시브 정리는 DOM 제거 뒤라 잃은 포커스는 body 다. */
function useFocusReturn() {
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
}

/** 전체 화면 전화 — 바탕 스크롤을 막고 포커스를 옮긴다. `role="dialog"` 라 스와이프 뒤로가기도 받지 않는다. */
function FullScreenDialog({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusReturn();
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-staff-call-open", "1");
    ref.current?.focus();
    return () => root.removeAttribute("data-staff-call-open");
  }, []);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className={`fixed inset-0 ${CALL_Z} overflow-hidden overscroll-none bg-[#0d0e10] text-[#f2f1ee] outline-none [word-break:keep-all]`}
    >
      {children}
    </div>,
    document.body,
  );
}

function RoundControl({
  icon,
  label,
  onClick,
  tone = "plain",
  size = "md",
  disabled,
  pulse,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone?: "plain" | "ok" | "end";
  size?: "md" | "lg";
  disabled?: boolean;
  pulse?: boolean;
}) {
  const background = tone === "ok" ? "bg-[#1f9d4d]" : tone === "end" ? "bg-[#c4364b]" : size === "lg" ? "bg-[#33363b]" : "bg-[rgba(242,241,238,.16)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-[84px] flex-col items-center gap-2 border-0 bg-transparent p-0 text-[#f2f1ee] disabled:opacity-45 ${PRESS}`}
    >
      <span className={`flex items-center justify-center rounded-full ${size === "lg" ? "size-[76px]" : "size-16"} ${background} ${pulse ? "staff-call-pulse" : ""}`}>{icon}</span>
      <span className={`text-center font-medium leading-tight [overflow-wrap:anywhere] ${size === "lg" ? "text-[16px]" : "text-[14px]"}`}>{label}</span>
    </button>
  );
}

// ── 울림 ────────────────────────────────────────────────────────────────────
export function PhoneRing({ call, copy, onDismiss, onAccept }: { call: RingingStaffCall; copy: StaffCallCopy; onDismiss: () => void; onAccept: () => void }) {
  const labels = useCallLabels(call, copy);
  return (
    <FullScreenDialog label={labels.title}>
      <div className="flex h-full flex-col items-center overflow-y-auto pl-[calc(24px+env(safe-area-inset-left))] pr-[calc(24px+env(safe-area-inset-right))] pb-[calc(48px+env(safe-area-inset-bottom))] pt-[calc(min(132px,16dvh)+env(safe-area-inset-top))] text-center fold:pb-[calc(64px+env(safe-area-inset-bottom))] fold:pt-[calc(min(150px,18dvh)+env(safe-area-inset-top))]">
        <h2 className="m-0 text-[34px] font-semibold leading-[1.2] tracking-[-0.02em]">{labels.title}</h2>
        <p className="mb-8 mt-3 text-[17px] leading-[1.45] text-[#a3a6ac]">
          {copy.sub}
          <br />
          {labels.why}
        </p>
        <div className="mt-auto flex w-full max-w-[300px] justify-between">
          <RoundControl size="lg" icon={<X size={28} strokeWidth={1.8} />} label={copy.close} onClick={onDismiss} />
          <RoundControl size="lg" tone="ok" pulse icon={<Phone size={30} strokeWidth={1.8} color="#fff" />} label={copy.accept} onClick={onAccept} />
        </div>
      </div>
    </FullScreenDialog>
  );
}

export function PcRing({ call, copy, onDismiss, onAccept }: { call: RingingStaffCall; copy: StaffCallCopy; onDismiss: () => void; onAccept: () => void }) {
  const labels = useCallLabels(call, copy);
  useFocusReturn();
  // 포커스를 뺏지 않는다 — 입력 중에 스페이스가 「받기」가 되면 안 된다.
  return createPortal(
    <div
      role="dialog"
      aria-label={labels.title}
      aria-live="assertive"
      className={`staff-call-enter fixed bottom-6 right-6 ${CALL_Z} box-border w-[380px] max-w-[calc(100vw-32px)] rounded-2xl bg-white p-6 text-[#16141f] shadow-[0_12px_32px_rgba(20,22,26,.16)] [word-break:keep-all]`}
    >
      <b className="block text-[20px] font-semibold tracking-[-0.01em]">{labels.title}</b>
      <small className="mt-1.5 block text-[14px] leading-[1.45] text-[#6b6878]">
        {copy.sub}
        <br />
        {labels.why}
      </small>
      <div className="mt-[18px] flex gap-2">
        <button type="button" onClick={onDismiss} className={`h-11 flex-1 rounded-[10px] border-0 bg-[#f1f1f4] text-[15px] font-medium text-[#16141f] ${PRESS}`}>
          {copy.close}
        </button>
        <button type="button" onClick={onAccept} className={`h-11 flex-1 rounded-[10px] border-0 bg-[#7a52e6] text-[15px] font-semibold text-white ${PRESS}`}>
          {copy.accept}
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ── 통화 ────────────────────────────────────────────────────────────────────
export type CallViewProps = {
  call: RingingStaffCall;
  copy: StaffCallCopy;
  connected: boolean;
  startedAtMs: number | null;
  canHangUp: boolean;
  hasVideo: boolean;
  setVideoElement: (element: HTMLVideoElement | null) => void;
  muted: boolean;
  micDenied: boolean;
  playbackBlocked: boolean;
  onToggleMute: () => void;
  onRetryPlayback: () => void;
  onHangUp: () => void;
  /** 없으면 「예약 보기」를 숨긴다(stay 없음 · 권한 없음). */
  onViewStay: (() => void) | null;
};

function CallBanners({ copy, micDenied, playbackBlocked, onRetryPlayback, light }: Pick<CallViewProps, "copy" | "micDenied" | "playbackBlocked" | "onRetryPlayback"> & { light?: boolean }) {
  if (!micDenied && !playbackBlocked) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      {playbackBlocked ? (
        <button
          type="button"
          onClick={onRetryPlayback}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full border-0 px-4 text-[14px] font-semibold ${light ? "bg-[#16141f] text-white" : "bg-[#f2f1ee] text-[#14161a]"} ${PRESS}`}
        >
          <Volume2 size={18} aria-hidden="true" />
          {copy.tapForSound}
        </button>
      ) : null}
      {micDenied ? (
        <p role="status" className={`m-0 max-w-[420px] rounded-xl px-3 py-2 text-center text-[13px] leading-[1.45] ${light ? "bg-[#f4f4f7] text-[#3a3746]" : "bg-[rgba(13,14,16,.72)] text-[#f2f1ee]"}`}>
          {copy.micDenied}
        </p>
      ) : null}
    </div>
  );
}

function GuestVideo({
  setVideoElement,
  connected,
  hasVideo,
  emptyText,
  className,
}: {
  setVideoElement: (element: HTMLVideoElement | null) => void;
  connected: boolean;
  hasVideo: boolean;
  emptyText: string;
  className: string;
}) {
  return (
    <>
      {/* 손님 소리는 따로 붙은 audio 로 나온다 — 영상은 음소거라 자동 재생이 막히지 않는다. iOS 전체 화면 전환을 막는 playsInline 필수. */}
      <video ref={setVideoElement} autoPlay playsInline muted className={`${className} ${hasVideo ? "" : "invisible"}`} />
      {connected && !hasVideo ? (
        <p role="status" className="absolute inset-x-6 top-1/2 m-0 -translate-y-1/2 text-center text-[15px] leading-[1.45] text-[#a3a6ac]">
          {emptyText}
        </p>
      ) : null}
    </>
  );
}

export function PhoneCall(props: CallViewProps) {
  const { call, copy, connected, startedAtMs, canHangUp, muted, micDenied, onToggleMute, onHangUp, onViewStay } = props;
  const labels = useCallLabels(call, copy);
  const elapsed = useElapsed(startedAtMs);
  return (
    <FullScreenDialog label={labels.title}>
      <div className="relative h-full bg-[#17191c]">
        <GuestVideo setVideoElement={props.setVideoElement} connected={connected} hasVideo={props.hasVideo} emptyText={copy.noVideo} className="absolute inset-0 size-full object-cover tablet:object-contain" />
        <div className="absolute inset-x-0 top-0 bg-[linear-gradient(rgba(13,14,16,.78),rgba(13,14,16,0))] pl-[calc(24px+env(safe-area-inset-left))] pr-[calc(24px+env(safe-area-inset-right))] pb-14 pt-[calc(24px+env(safe-area-inset-top))] tablet:pt-[calc(28px+env(safe-area-inset-top))]">
          <h2 className="m-0 text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] tablet:text-[26px]">{labels.title}</h2>
          <p className="m-0 mt-1 text-[15px] leading-[1.45] text-[#d6d7da] [font-variant-numeric:tabular-nums]">{connected ? `${elapsed} · ${labels.why}` : copy.connecting}</p>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 bg-[linear-gradient(rgba(13,14,16,0),rgba(13,14,16,.82))] pl-[calc(16px+env(safe-area-inset-left))] pr-[calc(16px+env(safe-area-inset-right))] min-[360px]:pl-[calc(24px+env(safe-area-inset-left))] min-[360px]:pr-[calc(24px+env(safe-area-inset-right))] pb-[calc(40px+env(safe-area-inset-bottom))] pt-16 tablet:pb-[calc(28px+env(safe-area-inset-bottom))]">
          <CallBanners copy={copy} micDenied={micDenied} playbackBlocked={props.playbackBlocked} onRetryPlayback={props.onRetryPlayback} />
          <div className="flex justify-center gap-2 min-[360px]:gap-7">
            <RoundControl
              icon={muted || micDenied ? <MicOff size={26} strokeWidth={1.8} /> : <Mic size={26} strokeWidth={1.8} />}
              label={muted ? copy.unmute : copy.mute}
              disabled={!connected || micDenied}
              onClick={onToggleMute}
            />
            {onViewStay ? <RoundControl icon={<BookOpen size={26} strokeWidth={1.8} />} label={copy.booking} onClick={onViewStay} /> : null}
            <RoundControl tone="end" disabled={!canHangUp} icon={<X size={26} strokeWidth={1.8} color="#fff" />} label={copy.hangUp} onClick={onHangUp} />
          </div>
        </div>
      </div>
    </FullScreenDialog>
  );
}

export function PcCall(props: CallViewProps & { stay: StaffCallStay | null }) {
  const { call, copy, connected, startedAtMs, canHangUp, muted, micDenied, onToggleMute, onHangUp, onViewStay, stay } = props;
  const labels = useCallLabels(call, copy);
  const elapsed = useElapsed(startedAtMs);
  useFocusReturn();
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-staff-call-panel", "1");
    return () => root.removeAttribute("data-staff-call-panel");
  }, []);
  const rows: [string, string][] = [
    [copy.guestLanguage, labels.language],
    [copy.pressedStep, labels.stepRow],
  ];
  if (stay) rows.push([copy.bookingRow, [...stay.roomLabels, fill(copy.partyN, { n: String(stay.partySize) })].join(" · ")]);
  const pcButton = `min-h-11 flex-1 rounded-[10px] border-0 px-2 text-[15px] leading-tight ${PRESS} disabled:opacity-45`;
  return createPortal(
    <aside
      role="dialog"
      aria-label={labels.title}
      className={`staff-call-enter fixed inset-y-0 right-0 ${CALL_Z} box-border flex w-[440px] max-w-full flex-col overflow-y-auto bg-white p-6 text-[#16141f] shadow-[-8px_0_24px_rgba(20,22,26,.06)] [word-break:keep-all]`}
    >
      <div className="relative h-[294px] flex-none overflow-hidden rounded-xl bg-[#17191c]">
        <GuestVideo setVideoElement={props.setVideoElement} connected={connected} hasVideo={props.hasVideo} emptyText={copy.noVideo} className="size-full object-contain" />
      </div>
      <h2 className="m-0 mt-5 text-[20px] font-semibold tracking-[-0.01em]">{labels.title}</h2>
      <p className="m-0 mt-1 text-[14px] text-[#6b6878] [font-variant-numeric:tabular-nums]">{connected ? fill(copy.inCall, { time: elapsed }) : copy.connecting}</p>
      <dl className="m-0 mt-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-h-11 items-center justify-between gap-4 border-b-[0.5px] border-[#e4e3e9] text-[14px]">
            <dt className="text-[#6b6878]">{label}</dt>
            <dd className="m-0 text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-col gap-3 pt-4">
        <CallBanners light copy={copy} micDenied={micDenied} playbackBlocked={props.playbackBlocked} onRetryPlayback={props.onRetryPlayback} />
        <div className="flex gap-2">
          <button type="button" disabled={!connected || micDenied} onClick={onToggleMute} className={`${pcButton} bg-[#f1f1f4] font-medium text-[#16141f]`}>
            {muted ? copy.unmute : copy.mute}
          </button>
          {onViewStay ? (
            <button type="button" onClick={onViewStay} className={`${pcButton} bg-[#f1f1f4] font-medium text-[#16141f]`}>
              {copy.booking}
            </button>
          ) : null}
          <button type="button" disabled={!canHangUp} onClick={onHangUp} className={`${pcButton} bg-[#c4364b] font-semibold text-white`}>
            {copy.hangUp}
          </button>
        </div>
      </div>
    </aside>,
    document.body,
  );
}

// ── 끝 안내 ─────────────────────────────────────────────────────────────────
export function CallNotice({ notice, copy, surface }: { notice: StaffCallNotice; copy: StaffCallCopy; surface: "mobile" | "admin" }) {
  const text = copy.notices[notice];
  if (surface === "mobile") {
    return (
      <FullScreenDialog label={text}>
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p role="status" className="m-0 text-[20px] font-medium leading-[1.4]">
            {text}
          </p>
        </div>
      </FullScreenDialog>
    );
  }
  return createPortal(
    <div
      role="dialog"
      aria-label={text}
      className={`staff-call-enter fixed bottom-6 right-6 ${CALL_Z} box-border w-[380px] max-w-[calc(100vw-32px)] rounded-2xl bg-white p-6 text-[#16141f] shadow-[0_12px_32px_rgba(20,22,26,.16)] [word-break:keep-all]`}
    >
      <p role="status" className="m-0 text-[16px] font-medium leading-[1.45]">
        {text}
      </p>
    </div>,
    document.body,
  );
}

// ── 예약 요약(모바일 시트 안) ───────────────────────────────────────────────
export function StaySummary({ stay, copy }: { stay: StaffCallStay; copy: StaffCallCopy }) {
  const buildingName = useBuildingName();
  const rows: [string, string][] = [
    [copy.leadName, stay.leadName ?? "—"],
    [copy.reservationNo, stay.reservationNumber],
    [copy.room, [buildingName(checkinPropertyName(stay.propertyKey) ?? stay.propertyKey), ...stay.roomLabels].join(" ")],
    [copy.stay, `${stay.checkInDate} – ${stay.checkOutDate}`],
    [copy.party, String(stay.partySize)],
  ];
  return (
    <dl className="m-0">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-h-11 items-center justify-between gap-4 border-b-[0.5px] border-[#e4e3e9] py-2 text-[15px] last:border-b-0">
          <dt className="flex-none text-muted-foreground">{label}</dt>
          <dd className="m-0 min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
