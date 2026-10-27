"use client";

/**
 * 출퇴근 캡처 — 실제 GPS + QR 출근 / 퇴근 (Step 3).
 *
 * 확정된 디자인("Attendance Module v2.html" 의 Section B)을 유지한다: 스캔 뷰파인더,
 * GPS+QR / Wi-Fi(준비중) 방식 칩, 그리고 결과 시트 하나. 달라진 점은 이제 실제로 동작한다는 것이다:
 *   - 앱 안 카메라 QR 스캔 (jsQR, 실시간 <video> 프레임 루프)
 *   - 기기 GPS (Geolocation API)
 *   - 둘 다 `submitAttendanceScan` 으로 보낸다 (모든 검증 + 시도 기록은 서버에서 일어난다)
 *   - 결과 시트는 실제 성공 요약 또는 해당 실패(gps / radius / qr /
 *     이미 출근함 / 열린 세션 없음)를 그리고, 앱 공용 아래로 끌어 닫는 시트를 재사용한다.
 *
 * `mode` = "in" (출근 인증) or "out" (퇴근 인증). Wi-Fi stays inactive (`준비중`).
 *
 * QR 딥링크 (2026-07-31): 폰 자체 카메라로 인쇄된 근무지 QR 을 열면 페이지가
 * `qrToken` 을 넘기고 카메라 대신 **랜딩** 단계에서 시작한다 — 건물 QR 에는
 * 방향이 없으므로, 직원이 여기서 출근/퇴근을 고르고 그 토큰을 그대로 제출한다.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import "./attendance.css";
import "./clock-done.css";
import { AIc, AttIcon } from "./att-icons";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  submitAttendanceScan,
  type AttendanceScanMode,
  type AttendanceScanResult,
} from "@/app/mobile/attendance/actions";
import { extractAttendanceToken } from "@/lib/attendance-qr";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import { hasNativePlugin } from "@/lib/native-app";
import { haptic } from "@/lib/haptics";

type AttendanceCopy = Dictionary["attendance"];

type Gps = { lat: number; lng: number; acc: number | null } | { error: "denied" | "unavailable" };
type Phase = "landing" | "scanning" | "submitting" | "result";
type GpsStatus = "pending" | "ok" | "denied" | "unavailable";

/**
 * 앱(Capacitor) 안에서는 네이티브 위치 플러그인으로 읽는다(2026-10-08, 네이티브 품질 N2). WebView 의
 * `navigator.geolocation` 은 OS 권한과 별도로 「stay-ops-two.vercel.app 이(가) 위치를 사용하려고 함」 같은 **웹 팝업**을
 * 띄워 주소가 드러나고, iOS 는 앱을 켤 때마다 다시 묻는다. 플러그인은 앱 이름으로 묻는 OS 권한 팝업 한 번만 띄운다.
 */
async function getNativeGpsOnce(): Promise<Gps> {
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    let perm = await Geolocation.checkPermissions();
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
      perm = await Geolocation.requestPermissions({ permissions: ["location", "coarseLocation"] });
    }
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") return { error: "denied" };
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy ?? null };
  } catch {
    // 권한 거부는 메시지로만 구분된다(플랫폼마다 문구가 다름) — 권한 상태를 다시 보고 판정한다.
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const perm = await Geolocation.checkPermissions();
      if (perm.location === "denied" && perm.coarseLocation === "denied") return { error: "denied" };
    } catch {
      // 무시 — 아래 unavailable
    }
    return { error: "unavailable" };
  }
}

function getGpsOnce(): Promise<Gps> {
  // 위치 플러그인이 없는 옛 설치본이면 웹 방식으로(웹 · 앱 버전 어긋남 — `hasNativePlugin`).
  if (hasNativePlugin("Geolocation")) return getNativeGpsOnce();
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ error: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy ?? null }),
      (err) => resolve({ error: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
    );
  });
}

export function AttendanceCapture({
  mode = "in",
  locale,
  qrToken = null,
  qrSiteName = null,
  trustedDeviceName = null,
  userName = "",
}: {
  mode?: AttendanceScanMode;
  locale: string;
  /** 폰 카메라가 인쇄된 근무지 QR 을 열었을 때 설정되며 — 랜딩 단계에서 시작한다. */
  qrToken?: string | null;
  /** `qrToken` 뒤의 건물 이름. null 이면 토큰이 더는 해석되지 않는다 (재발급/폐기). */
  qrSiteName?: string | null;
  /**
   * 로그인 세션이 없고 기억해 둔 기기로 직원이 식별됐을 때 설정된다
   * (iOS Safari 경로). 다른 사람 이름으로 출근하는 일이 없도록 눈에 띄게 보여 준다.
   */
  trustedDeviceName?: string | null;
  /** 첫 출근 환영 문구에 쓰는 이름. */
  userName?: string;
}) {
  const copy = getDictionary(locale).attendance;
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [phase, setPhase] = useState<Phase>(qrToken ? "landing" : "scanning");
  const [result, setResult] = useState<AttendanceScanResult | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("pending");
  const [cameraError, setCameraError] = useState(false);
  // 실제로 제출된 방향 — 스캔 흐름에서는 `mode` prop, QR 흐름에서는
  // 랜딩 버튼에서 온다. 결과 시트는 prop 이 아니라 이것을 읽는다.
  const [activeMode, setActiveMode] = useState<AttendanceScanMode>(mode);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const gpsRef = useRef<Gps | null>(null);
  const submittedRef = useRef(false);
  // 최신 스캔 틱을 쥐고 있어, rAF 루프가 선언되기 전에 콜백을 참조하는 일이 없다.
  const scanTickRef = useRef<() => void>(() => {});

  const isOut = activeMode === "out";
  const isQrLanding = qrToken !== null;

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const submit = useCallback(
    async (token: string | null, submitMode: AttendanceScanMode) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setActiveMode(submitMode);
      stopCamera();
      haptic("light");
      setPhase("submitting");
      let res: AttendanceScanResult;
      try {
        let g = gpsRef.current;
        if (!g) {
          g = await getGpsOnce();
          gpsRef.current = g;
        }
        const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;
        res = await submitAttendanceScan(
          "lat" in g
            ? { mode: submitMode, token, latitude: g.lat, longitude: g.lng, accuracy: g.acc, gpsError: null, userAgent }
            : { mode: submitMode, token, latitude: null, longitude: null, accuracy: null, gpsError: g.error, userAgent },
        );
      } catch {
        // 네트워크 끊김 · 서버 오류로 액션이 던지면 예전에는 「보내는 중」에 영원히 멈췄다(submittedRef 도 true 로 남아
        // 다시 시도도 막혔다). 일반 실패 결과(다시 시도 버튼)로 보내고 잠금을 푼다(2026-10-26).
        res = { ok: false, reason: "error" };
        submittedRef.current = false;
      }
      haptic(res.ok ? "success" : "error");
      setResult(res);
      setPhase("result");
    },
    [stopCamera],
  );

  const scanTick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      rafRef.current = requestAnimationFrame(() => scanTickRef.current());
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(() => scanTickRef.current());
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
    if (code && code.data) {
      // 새 QR 은 URL 을 담고 예전에 인쇄한 것은 토큰만 담는다 — 둘 다 받는다. 그 밖은 모두
      // 그대로 전달해서 서버가 익숙한 "QR 인식 실패" 시트로 답하게 한다.
      void submit(extractAttendanceToken(code.data) ?? code.data, mode);
      return;
    }
    rafRef.current = requestAnimationFrame(() => scanTickRef.current());
  }, [mode, submit]);

  // rAF 루프가 항상 최신 scanTick 을 가리키게 한다.
  useEffect(() => {
    scanTickRef.current = scanTick;
  }, [scanTick]);

  const startScanning = useCallback(async () => {
    // 초기 상태는 이미 대기/오류 없음이고, retry() 가 이벤트 핸들러에서 리셋한다. 여기에
    // 동기 setState 가 없어서 마운트 effect 에서 호출해도 안전하다.
    // GPS 는 병렬로 돌며, 칩을 갱신하고 제출용으로 캐시된다.
    void getGpsOnce().then((g) => {
      gpsRef.current = g;
      setGpsStatus("lat" in g ? "ok" : g.error);
    });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      rafRef.current = requestAnimationFrame(() => scanTickRef.current());
    } catch {
      setCameraError(true);
    }
  }, []);

  useEffect(() => {
    if (phase !== "scanning") return;
    submittedRef.current = false;
    // 다음 틱(페인트 뒤)에 카메라/GPS 를 시작한다 — 상태 갱신이 동기
    // effect 커밋 안에 들어가지 않게 한다.
    const id = window.setTimeout(() => void startScanning(), 0);
    return () => {
      window.clearTimeout(id);
      stopCamera();
    };
  }, [phase, startScanning, stopCamera]);

  // QR 랜딩: 카메라는 없지만 GPS 는 미리 데워 두어 칩이 정직하고 제출이 즉시 된다.
  useEffect(() => {
    if (phase !== "landing") return;
    submittedRef.current = false;
    void getGpsOnce().then((g) => {
      gpsRef.current = g;
      setGpsStatus("lat" in g ? "ok" : g.error);
    });
  }, [phase]);

  const goHome = useCallback(() => router.push("/mobile/attendance"), [router]);
  const leave = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/mobile/attendance");
  }, [router]);
  // Esc(안드로이드 뒤로가기 포함) — 결과 시트가 열려 있으면 시트가 먼저 닫힌다(BottomSheet 가 처리).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "result") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, leave]);
  const retry = useCallback(() => {
    setCameraError(false);
    setGpsStatus("pending");
    setResult(null);
    // QR 링크로 들어왔다면 → 카메라가 아니라 방향 선택으로 돌아간다.
    setPhase(isQrLanding ? "landing" : "scanning");
  }, [isQrLanding]);
  const retryCamera = useCallback(() => {
    setCameraError(false);
    setGpsStatus("pending");
    void startScanning();
  }, [startScanning]);

  const onDismiss = result?.ok ? goHome : retry;

  const gpsText =
    gpsStatus === "ok"
      ? copy.gpsOk
      : gpsStatus === "denied"
        ? copy.gpsDenied
        : gpsStatus === "unavailable"
          ? copy.gpsUnavailable
          : copy.gpsPending;

  const scanHint = cameraError
    ? copy.captureHintCamera
    : phase === "submitting"
      ? copy.captureHintSubmitting
      : copy.captureHintScan;

  // 화이트 리디자인(2026-10-13, 시안 AttQR-Phone · Fold · Tablet · AttQRFail · AttQRLand): 화면 전체 어두운 스캔 —
  // 카메라 위 어두운 막에 사각 구멍(코너 맥박 · 스캔선), 아래 GPS 알약, 결과는 흰 시트. QR 을 잡으면 코너가 보라로
  // 조여지고(잠금) 짧은 진동, 성공이면 체크가 그려진다. 방식 카드(Wi-Fi 준비중) · 1/2 단계 표시는 뺐다.
  const gpsTone = gpsStatus === "ok" ? "ok" : gpsStatus === "pending" ? "wait" : "bad";
  // 성공이면 흰 화면 한 장(초록 점 → 얇은 큰 시각 → 근무 시작 선, 첫 출근만 환영 한 줄 — 시안 Motion-B2-*), 실패만 시트.
  const resultSheet =
    phase === "result" && result && result.ok ? (
      <ClockDone result={result} isOut={isOut} userName={userName} locale={locale} onHome={goHome} copy={copy} />
    ) : phase === "result" && result ? (
      // 스캔 화면(.att.capw, z-index 90) 위로 — 기본 z-[80] 이면 시트가 뒤에 깔려 실패가 안 보이고 꺼진 카메라 검은 화면에 멈춘다(2026-10-28).
      <BottomSheet ariaLabel={isOut ? copy.resultOutTitle : copy.resultInTitle} className="att att__result-sheet capw-sheet" onClose={onDismiss} zIndexClassName="z-[100]">
        <ResultSheet result={result} isOut={isOut} locale={locale} onHome={goHome} onRetry={retry} copy={copy} />
      </BottomSheet>
    ) : null;

  // 화면 전체(레일 · 사이드바 위)를 덮도록 <body> 로 띄운다 — 셸 안의 transform 이 position: fixed 를 가두기 때문.
  const toBody = (node: React.ReactNode) => (hydrated ? createPortal(node, document.body) : null);
  // 위층에 떠 있어 화면 스와이프 뒤로가기가 닿지 않는다 — 사진 뷰어처럼 × · Esc · 안드로이드 뒤로가기(Esc 로 들어옴)로 나간다.
  const closeLabel = getDictionary(locale).common.close;
  const exit = (
    <button type="button" className="capw__x" aria-label={closeLabel} onClick={leave}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );

  // ── QR 딥링크 랜딩: 방금 스캔한 건물의 출근 / 퇴근 선택 ──
  if (isQrLanding) {
    const submitting = phase === "submitting";
    const unusable = qrSiteName === null;
    return toBody(
      <div className="att capw capw--land" data-native-back-overlay="">
        {exit}
        <div className="capw__top">
          <h1>{unusable ? copy.qrLandingInvalidTitle : copy.landingRead}</h1>
          <p>{unusable ? copy.qrLandingInvalidSub : copy.landingSite.replace("{site}", qrSiteName ?? "")}</p>
        </div>
        <div className="capw__frame is-idle" aria-hidden="true">
          <span className="capw__c tl" />
          <span className="capw__c tr" />
          <span className="capw__c bl" />
          <span className="capw__c br" />
        </div>
        <div className={`capw__gps is-${gpsTone}`}>
          <i aria-hidden="true" />
          {gpsText}
        </div>

        <div className="capw__panel">
          {unusable ? (
            <Link href="/mobile/attendance/capture?mode=in" className="capw-btn">
              {copy.qrLandingScanInstead}
            </Link>
          ) : (
            <>
              <span className="capw__panel-k">{copy.landingSite.replace("{site}", qrSiteName ?? "")}</span>
              <b className="capw__panel-t">{copy.landingAsk}</b>
              {trustedDeviceName ? (
                <span className="capw__panel-s">{copy.qrLandingRememberedAs.replace("{name}", trustedDeviceName)}</span>
              ) : null}
              <div className="capw__duo">
                <button type="button" className="capw-btn" disabled={submitting} onClick={() => void submit(qrToken, "in")}>
                  {copy.landingIn}
                </button>
                <button type="button" className="capw-btn capw-btn--ghost" disabled={submitting} onClick={() => void submit(qrToken, "out")}>
                  {copy.landingOut}
                </button>
              </div>
              {trustedDeviceName ? <span className="capw__panel-s">{copy.qrLandingRememberedHint}</span> : null}
            </>
          )}
          <Link href="/mobile/attendance/correction" className="capw__link">
            {copy.scanNoQr} ›
          </Link>
        </div>
        {resultSheet}
      </div>,
    );
  }

  const locked = phase === "submitting" || phase === "result";
  return toBody(
    <div className="att capw" data-native-back-overlay="">
      {exit}
      <video ref={videoRef} playsInline muted className="capw__video" />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div className="capw__top">
        <h1>{isOut ? copy.scanTitleOut : copy.scanTitleIn}</h1>
        <p>{scanHint}</p>
      </div>
      <div className={`capw__frame${locked ? " is-locked" : ""}${cameraError ? " is-idle" : ""}`} aria-hidden="true">
        <span className="capw__c tl" />
        <span className="capw__c tr" />
        <span className="capw__c bl" />
        <span className="capw__c br" />
        {cameraError || locked ? null : <i className="capw__line" />}
      </div>
      <div className={`capw__gps is-${gpsTone}`}>
        <i aria-hidden="true" />
        {gpsText}
      </div>
      {cameraError ? (
        <button type="button" className="capw__retry" onClick={retryCamera}>
          <AIc>{AttIcon.refresh}</AIc>
          {copy.captureRetryCamera}
        </button>
      ) : null}
      <Link href="/mobile/attendance/correction" className="capw__link capw__link--dark">
        {copy.scanNoQr} ›
      </Link>
      {resultSheet}
    </div>,
  );
}

/** 결과 시트 — 아이콘 · 제목 · 한두 줄 · 버튼. 성공 체크는 그려지고, 실패 아이콘은 짧게 흔들린다. */
function ResultSheet({
  result,
  isOut,
  locale,
  onHome,
  onRetry,
  copy,
}: {
  result: AttendanceScanResult;
  isOut: boolean;
  locale: string;
  onHome: () => void;
  onRetry: () => void;
  copy: AttendanceCopy;
}) {
  const correction = (
    <Link href="/mobile/attendance/correction" className="capw__link">
      {copy.scanNoQr} ›
    </Link>
  );
  if (result.ok) {
    return (
      <div className="capr">
        <span className="capr__ic is-ok" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path className="capr__check" d="M5 12l5 5 9-10" />
          </svg>
        </span>
        <h3 className="capr__t">{isOut ? copy.resultOutTitle : copy.resultInTitle}</h3>
        <p className="capr__s">{copy.resultLine.replace("{site}", result.siteName).replace("{time}", result.timeLabel)}</p>
        <button type="button" className="capw-btn" onClick={onHome}>
          {copy.resultConfirm}
        </button>
      </div>
    );
  }
  const fail = (title: string, lines: (string | null)[], primary: "retry" | "home", withCorrection: boolean, tone: "warn" | "bad" = "bad") => (
    <div className="capr">
      <span className={`capr__ic is-${tone}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 7v6M12 17h.01" />
        </svg>
      </span>
      <h3 className="capr__t">{title}</h3>
      {lines.filter(Boolean).map((l, i) => (
        <p key={i} className="capr__s">
          {l}
        </p>
      ))}
      <button type="button" className="capw-btn" onClick={primary === "retry" ? onRetry : onHome}>
        {primary === "retry" ? copy.resultRetry : copy.resultHomeButton}
      </button>
      {withCorrection ? correction : null}
    </div>
  );
  switch (result.reason) {
    case "radius":
      return fail(
        copy.resultRadiusTitle,
        [
          copy.resultRadiusDetail(result.siteName ?? copy.resultSiteFallback, result.radiusMeters ?? "—"),
          copy.resultRadiusDistance(result.distanceMeters ?? "—"),
        ],
        "retry",
        true,
      );
    case "gps":
      return fail(copy.resultGpsTitle, [copy.resultGpsSub, copy.resultGpsHint], "retry", true);
    case "qr":
      return fail(copy.resultQrTitle, [copy.resultQrSub], "retry", true);
    case "open_session":
      return fail(copy.resultOpenSessionTitle, [copy.resultOpenSessionSub, copy.resultOpenSessionCanRetry], "home", false, "warn");
    case "no_session":
      return fail(copy.resultNoSessionTitle, [copy.resultNoSessionSub, copy.resultNoSessionHint], "home", true, "warn");
    case "open_break":
      return fail(copy.resultOpenBreakTitle, [copy.resultOpenBreakSub, copy.resultOpenBreakHint], "home", false, "warn");
    case "month_finalized":
      return fail(copy.resultMonthFinalizedTitle, [copy.resultMonthFinalizedSub], "home", false, "warn");
    case "stale_session": {
      // 지난 근무(퇴근 미기록) — 그 근무에 묶인 정정 요청으로 바로 보낸다.
      const date = result.staleDate
        ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", day: "numeric" }).format(new Date(`${result.staleDate}T00:00:00Z`))
        : "—";
      return (
        <div className="capr">
          <span className="capr__ic is-warn" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 7v6M12 17h.01" />
            </svg>
          </span>
          <h3 className="capr__t">{copy.resultStaleTitle.replace("{date}", date)}</h3>
          <p className="capr__s">{copy.resultStaleSub}</p>
          <p className="capr__s">{copy.resultStaleHint}</p>
          <button type="button" className="capw-btn" onClick={onHome}>
            {copy.resultHomeButton}
          </button>
          <Link
            href={result.staleSessionId ? `/mobile/attendance/correction?sessionId=${result.staleSessionId}` : "/mobile/attendance/correction"}
            className="capw__link"
          >
            {copy.resultStaleCorrection.replace("{date}", date)} ›
          </Link>
        </div>
      );
    }
    default:
      return fail(copy.resultGenericTitle, [copy.resultGenericSub], "retry", false);
  }
}

/** 출근 · 퇴근 완료 — 흰 화면 한 장(2026-10-14, 시안 Motion-B2-FirstWin-Phone · Motion-B2-ClockIn-Phone).
 *  초록 점에서 흰 화면이 퍼지고 → 점이 스프링으로 자리 잡으며 체크 → 시각 자리마다 아래서 올라옴 → 근무 시작 선이 그어짐.
 *  「첫 출근을 환영해요」는 서버가 firstEver 를 준 출근에만(그 뒤로는 「출근 완료」만). */
export function ClockDone({
  result,
  isOut,
  userName,
  locale,
  onHome,
  copy,
}: {
  result: Extract<AttendanceScanResult, { ok: true }>;
  isOut: boolean;
  userName: string;
  locale: string;
  onHome: () => void;
  copy: AttendanceCopy;
}) {
  const first = !isOut && result.firstEver === true;
  const date = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "long" }).format(new Date(result.atIso));
  const chars = result.timeLabel.split("");
  return (
    <div className={`cind${first ? " is-first" : ""}`} role="dialog" aria-modal="true" aria-label={isOut ? copy.resultOutTitle : copy.resultInTitle} data-native-back-overlay>
      <div className="cind__top">
        <span className="cind__dotw" aria-hidden="true">
          <span className="cind__ring" />
          <span className="cind__dot">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          {first ? (
            <span className="cind__spk">
              {Array.from({ length: 12 }, (_, i) => (
                <i key={i} style={{ "--a": `${-90 + (i - 5.5) * 14}deg`, "--r": `${70 + ((i * 37) % 5) * 14}px`, animationDelay: `${(i % 4) * 30}ms` } as React.CSSProperties} />
              ))}
            </span>
          ) : null}
        </span>
      </div>
      <div className="cind__body">
        {first ? (
          <>
            <span className="cind__ln"><span className="cind__k">{copy.cinWelcome}</span></span>
            <span className="cind__ln cind__d2">
              <span className="cind__w">
                <span className="cind__nm">
                  {copy.cinName.replace("{name}", userName || "")}
                  <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M2 7 C 30 3, 60 3, 98 6" pathLength={1} />
                  </svg>
                </span>
              </span>
            </span>
            <span className="cind__ln cind__d3"><span className="cind__w">{copy.cinTogether}</span></span>
          </>
        ) : (
          <span className="cind__ln"><span className="cind__k">{isOut ? copy.resultOutTitle : copy.resultInTitle}</span></span>
        )}
        <div className="cind__time" aria-label={result.timeLabel}>
          {chars.map((ch, i) => (
            <span key={i} className={`cind__d${ch === ":" ? " is-colon" : ""}`}>
              <span style={{ animationDelay: `${(first ? 1370 : 1230) + i * 60}ms` }}>{ch}</span>
            </span>
          ))}
        </div>
        <div className="cind__meta">
          <b>{result.siteName}</b> · {date}
        </div>
        <div className="cind__track" aria-hidden={isOut}>
          <span className="cind__bar"><i /></span>
          <span className="cind__start" />
          <span className="cind__tlab">
            <span>{(isOut ? copy.cinTrackOut : copy.cinTrackIn).replace("{time}", result.timeLabel)}</span>
            <span>{isOut ? copy.cinDayDone : copy.cinRecording}</span>
          </span>
        </div>
      </div>
      <button type="button" className="cind__btn" onClick={onHome}>
        {copy.resultConfirm}
      </button>
    </div>
  );
}
