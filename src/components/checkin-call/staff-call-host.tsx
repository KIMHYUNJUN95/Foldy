"use client";

// 직원 통화 수신 호스트 — 모바일 · 관리자 레이아웃에 붙는다. 신호는 내 알림 실시간으로만 받고, 내용은 권한을 검사한 서버 액션으로 읽는다(docs/product/46 §2).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { acceptStaffCall, endStaffCall, getRingingStaffCalls, getStaffCallStatus, getStaffCallStay } from "@/actions/checkin/calls";
import { useLiveRefresh } from "@/components/shared/live-refresh";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { haptic } from "@/lib/haptics";
import { STAFF_CALL_REOPEN_EVENT } from "@/lib/checkin/staff-call-events";
import {
  ACCEPT_TIMEOUT_MS,
  INITIAL_STAFF_CALL_FLOW,
  judgeCallStatus,
  needsRingReread,
  staffCallFlowReducer,
  withTimeout,
  type StaffCallFlowEvent,
} from "@/lib/checkin/staff-call-flow";
import type { RingingStaffCall, StaffCallStay } from "@/lib/checkin/staff-call";
import { notificationLiveSources } from "@/lib/live-sources";
import { armRingtoneUnlock, startRingtone, unlockCallAudio } from "./ringtone";
import { CallNotice, PcCall, PcRing, PhoneCall, PhoneRing, STAY_SHEET_Z, StaySummary, useCallLabels, type StaffCallCopy } from "./staff-call-views";
import { useCallRoom, type CallRoomCredentials } from "./use-call-room";

type Surface = "mobile" | "admin";

const RING_POLL_MS = 2_000;
const CALL_POLL_MS = 3_000;
const NOTICE_MS = 2_200;
const noop = () => undefined;
const subscribeNever = () => noop;

/** 칸 모드(`stayops-pane`) 안에서는 띄우지 않는다 — 부모 창의 호스트가 이미 있고, 소리가 겹친다. */
export function StaffCallHost({ userId, surface, copy }: { userId: string; surface: Surface; copy: StaffCallCopy }) {
  const canRun = useSyncExternalStore(
    subscribeNever,
    () => !document.documentElement.hasAttribute("data-pane"),
    () => false,
  );
  return canRun ? <StaffCallController userId={userId} surface={surface} copy={copy} /> : null;
}

function StaffCallController({ userId, surface, copy }: { userId: string; surface: Surface; copy: StaffCallCopy }) {
  const [flow, dispatch] = useReducer(staffCallFlowReducer, INITIAL_STAFF_CALL_FLOW);
  const [credentials, setCredentials] = useState<CallRoomCredentials | null>(null);
  const { screen } = flow;

  const refresh = useCallback(async () => {
    try {
      const result = await getRingingStaffCalls();
      // 실패는 「호출 없음」이 아니다 — 잠깐의 오류로 울리던 화면을 닫지 않는다. 표가 없어도(`not_ready`) 조용히 아무 일 없다.
      if (result.ok) dispatch({ type: "ring_list", calls: result.calls, nowMs: Date.now() });
    } catch {
      // 다음 신호 · 복귀 · 폴링에서 다시 읽는다.
    }
  }, []);

  const sources = useMemo(() => notificationLiveSources(userId), [userId]);
  useLiveRefresh(sources, refresh);

  // 신호는 저장되지 않는다 — 처음 켰을 때 · 앱으로 돌아왔을 때 다시 읽어 놓친 호출을 잡는다(재접속은 useLiveRefresh 가 부른다).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setTimeout(() => void refresh(), 0);
    const disarm = armRingtoneUnlock();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      window.clearTimeout(timer);
      disarm();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    const onReopen = (event: Event) => {
      dispatch({ type: "reopen", id: (event as CustomEvent<{ id: string }>).detail.id });
      void refresh();
    };
    window.addEventListener(STAFF_CALL_REOPEN_EVENT, onReopen);
    return () => window.removeEventListener(STAFF_CALL_REOPEN_EVENT, onReopen);
  }, [refresh]);

  // 닫기 · 통화 끝 · 안내 끝 뒤 — 함께 울리던 호출이나 통화 중 온 신호를 여기서 받는다.
  const screenKind = screen.kind;
  const previousKind = useRef(screenKind);
  useEffect(() => {
    const reread = needsRingReread(previousKind.current, screenKind);
    previousKind.current = screenKind;
    if (reread) void refresh();
  }, [screenKind, refresh]);

  const ringingId = screen.kind === "ringing" ? screen.call.id : null;
  useEffect(() => {
    if (!ringingId) return;
    const stop = startRingtone();
    haptic("warning");
    const timer = window.setInterval(() => {
      dispatch({ type: "tick", nowMs: Date.now() });
      haptic("warning");
      void refresh();
    }, RING_POLL_MS);
    return () => {
      stop();
      window.clearInterval(timer);
    };
  }, [ringingId, refresh]);

  const inNotice = screen.kind === "notice";
  useEffect(() => {
    if (!inNotice) return;
    const timer = window.setTimeout(() => dispatch({ type: "notice_done" }), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [inNotice]);

  async function accept(call: RingingStaffCall) {
    // 첫 await 앞이어야 탭으로 인정된다(iOS). 그래도 막히면 통화 화면의 소리 켜기 버튼으로 이어진다.
    void unlockCallAudio();
    setCredentials(null);
    dispatch({ type: "accept_start", id: call.id });
    try {
      const result = await withTimeout(acceptStaffCall(call.id), ACCEPT_TIMEOUT_MS);
      if (result.ok) {
        haptic("success");
        setCredentials({ url: result.url, token: result.token });
        dispatch({ type: "accept_ok", stayId: result.stayId, canViewStay: result.canViewStay });
      } else {
        haptic("error");
        dispatch({ type: "accept_failed", errorKey: result.errorKey });
      }
    } catch {
      // 응답만 잃었거나 늦을 수 있다 — 받은 상태로 남으면 손님이 빈 통화에 갇히니 닫아 본다. 서버 액션은 차례로 돌아 받기 뒤에 처리되고, 내 통화가 아니면 서버가 거절한다.
      haptic("error");
      void endStaffCall(call.id).catch(noop);
      dispatch({ type: "accept_failed", errorKey: "failed" });
    }
  }

  if (screen.kind === "ringing") {
    const Ring = surface === "admin" ? PcRing : PhoneRing;
    return (
      <Ring
        key={screen.call.id}
        call={screen.call}
        copy={copy}
        onDismiss={() => {
          haptic("light");
          dispatch({ type: "dismiss", id: screen.call.id });
        }}
        onAccept={() => void accept(screen.call)}
      />
    );
  }

  if (screen.kind === "connecting" || screen.kind === "active") {
    return (
      <CallSession
        key={screen.call.id}
        call={screen.call}
        copy={copy}
        surface={surface}
        credentials={screen.kind === "connecting" && !screen.accepted ? null : credentials}
        accepted={screen.kind === "active" || screen.accepted}
        startedAtMs={screen.kind === "active" ? screen.startedAtMs : null}
        canViewStay={screen.canViewStay && !!screen.stayId}
        dispatch={dispatch}
      />
    );
  }

  if (screen.kind === "notice") return <CallNotice notice={screen.notice} copy={copy} surface={surface} />;
  return null;
}

/** 받은 뒤 통화 하나 — 사라지면 방에서 나간다. */
function CallSession({
  call,
  copy,
  surface,
  credentials,
  accepted,
  startedAtMs,
  canViewStay,
  dispatch,
}: {
  call: RingingStaffCall;
  copy: StaffCallCopy;
  surface: Surface;
  credentials: CallRoomCredentials | null;
  accepted: boolean;
  startedAtMs: number | null;
  canViewStay: boolean;
  dispatch: (event: StaffCallFlowEvent) => void;
}) {
  const router = useRouter();
  const callId = call.id;
  const [sheetOpen, setSheetOpen] = useState(false);

  const finish = useCallback(
    (event: StaffCallFlowEvent, kind: "error" | "light") => {
      haptic(kind);
      dispatch(event);
    },
    [dispatch],
  );

  const room = useCallRoom(credentials, {
    onConnected: () => dispatch({ type: "room_connected", nowMs: Date.now() }),
    onRemoteEnded: () => finish({ type: "remote_ended" }, "light"),
    onLost: () => {
      void endStaffCall(callId).catch(noop);
      finish({ type: "connection_lost" }, "error");
    },
    onGuestGone: () => {
      void endStaffCall(callId).catch(noop);
      finish({ type: "remote_ended" }, "light");
    },
  });

  // 상대가 끊었는지 — 방 이벤트가 먼저 오는 게 보통이고, 놓쳐도 여기서 잡는다.
  useEffect(() => {
    if (!accepted) return;
    let forbiddenSinceMs: number | null = null;
    const timer = window.setInterval(() => {
      void getStaffCallStatus(callId)
        .then((result) => {
          const judged = judgeCallStatus(result, forbiddenSinceMs, Date.now());
          forbiddenSinceMs = judged.forbiddenSinceMs;
          if (judged.event) finish(judged.event, judged.event.type === "connection_lost" ? "error" : "light");
        })
        .catch(noop);
    }, CALL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [accepted, callId, finish]);

  // 페이지를 떠나도 · 레이아웃이 바뀌어(/mobile ↔ /admin) 이 화면이 사라져도 통화를 정리한다. 이미 끝났으면 서버가 그대로 둔다.
  const acceptedRef = useRef(accepted);
  useEffect(() => {
    acceptedRef.current = accepted;
  }, [accepted]);
  useEffect(() => {
    const onPageHide = () => {
      if (acceptedRef.current) void endStaffCall(callId).catch(noop);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      onPageHide();
    };
  }, [callId]);

  const [stay, setStay] = useState<StaffCallStay | null>(null);
  const [stayFailed, setStayFailed] = useState(false);
  const stayWanted = canViewStay && (surface === "admin" ? startedAtMs !== null : sheetOpen);
  useEffect(() => {
    if (!stayWanted) return;
    let stale = false;
    void getStaffCallStay(callId)
      .then((result) => {
        if (stale) return;
        if (result.ok) setStay(result.stay);
        else setStayFailed(true);
      })
      .catch(() => {
        if (!stale) setStayFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [stayWanted, callId]);

  const viewProps = {
    call,
    copy,
    connected: startedAtMs !== null,
    startedAtMs,
    canHangUp: accepted,
    hasVideo: room.videoTrack !== null,
    setVideoElement: room.setVideoElement,
    muted: room.muted,
    micDenied: room.micDenied,
    playbackBlocked: room.playbackBlocked,
    onToggleMute: () => {
      haptic("light");
      void room.toggleMute();
    },
    onRetryPlayback: () => void room.retryPlayback(),
    onHangUp: () => {
      void endStaffCall(callId).catch(noop);
      finish({ type: "local_end" }, "light");
    },
  };

  if (surface === "admin") {
    const stayHref = stay ? `/admin/checkin?date=${encodeURIComponent(stay.checkInDate)}&property=${encodeURIComponent(stay.propertyKey)}` : "/admin/checkin";
    return <PcCall {...viewProps} stay={stay} onViewStay={canViewStay ? () => router.push(stayHref) : null} />;
  }

  return (
    <>
      <PhoneCall {...viewProps} onViewStay={canViewStay ? () => setSheetOpen(true) : null} />
      {sheetOpen ? (
        <BottomSheet ariaLabel={copy.sheetTitle} zIndexClassName={STAY_SHEET_Z} onClose={() => setSheetOpen(false)}>
          <StaySheetBody stay={stay} failed={stayFailed} copy={copy} call={call} />
        </BottomSheet>
      ) : null}
    </>
  );
}

function StaySheetBody({ stay, failed, copy, call }: { stay: StaffCallStay | null; failed: boolean; copy: StaffCallCopy; call: RingingStaffCall }) {
  const labels = useCallLabels(call, copy);
  return (
    <div className="pt-1">
      <h2 className="m-0 text-[18px] font-semibold text-foreground">{copy.sheetTitle}</h2>
      <p className="m-0 mb-2 mt-0.5 text-[13px] text-muted-foreground">{labels.title}</p>
      {stay ? (
        <StaySummary stay={stay} copy={copy} />
      ) : failed ? (
        <p role="alert" className="m-0 py-4 text-[15px] text-muted-foreground">
          {copy.loadFailed}
        </p>
      ) : (
        <div aria-busy="true" className="h-[220px]" />
      )}
    </div>
  );
}
