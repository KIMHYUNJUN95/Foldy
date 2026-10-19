"use client";

/**
 * Attendance capture — real GPS + QR clock-in / clock-out (Step 3).
 *
 * Preserves the finalized design (Section B of "Attendance Module v2.html"): the scan viewfinder, the
 * GPS+QR / Wi-Fi(준비중) method chips, and ONE result sheet. What changed is that it is now FUNCTIONAL:
 *   - in-app camera QR scan (jsQR over a live <video> frame loop)
 *   - device GPS (Geolocation API)
 *   - both are sent to `submitAttendanceScan` (all validation + attempt logging happen server-side)
 *   - the result sheet renders the REAL success summary or the matching failure (gps / radius / qr /
 *     already-clocked-in / no-open-session), and reuses the app's shared drag-down-to-dismiss sheet.
 *
 * `mode` = "in" (출근 인증) or "out" (퇴근 인증). Wi-Fi stays inactive (`준비중`).
 *
 * QR deep link (2026-07-31): when the phone's own camera opened the printed site QR, the page passes
 * `qrToken` and we start in the **landing** phase instead of the camera — the building QR carries no
 * direction, so the staff member picks 출근/퇴근 here and we submit that token directly.
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
  /** Set when the phone camera opened the printed site QR — starts in the landing phase. */
  qrToken?: string | null;
  /** Building name behind `qrToken`; null means the token no longer resolves (reissued/revoked). */
  qrSiteName?: string | null;
  /**
   * Set when there is no login session and the staff member was identified by the remembered
   * device instead (iOS Safari path). Shown prominently so nobody clocks in as someone else.
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
  // The direction actually submitted — from the `mode` prop in the scan flow, from the landing
  // buttons in the QR flow. The result sheet reads this, not the prop.
  const [activeMode, setActiveMode] = useState<AttendanceScanMode>(mode);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const gpsRef = useRef<Gps | null>(null);
  const submittedRef = useRef(false);
  // Holds the latest scan tick so the rAF loop never references the callback before it is declared.
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
      let g = gpsRef.current;
      if (!g) {
        g = await getGpsOnce();
        gpsRef.current = g;
      }
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;
      const res = await submitAttendanceScan(
        "lat" in g
          ? { mode: submitMode, token, latitude: g.lat, longitude: g.lng, accuracy: g.acc, gpsError: null, userAgent }
          : { mode: submitMode, token, latitude: null, longitude: null, accuracy: null, gpsError: g.error, userAgent },
      );
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
      // New QRs encode a URL, older printed ones the bare token — accept both. Anything else is
      // forwarded as-is so the server answers with the familiar "QR 인식 실패" sheet.
      void submit(extractAttendanceToken(code.data) ?? code.data, mode);
      return;
    }
    rafRef.current = requestAnimationFrame(() => scanTickRef.current());
  }, [mode, submit]);

  // Keep the rAF loop pointed at the latest scanTick.
  useEffect(() => {
    scanTickRef.current = scanTick;
  }, [scanTick]);

  const startScanning = useCallback(async () => {
    // Initial state is already pending/no-error; retry() resets them in an event handler. No
    // synchronous setState here keeps this safe to call from the mount effect.
    // GPS runs in parallel; it updates the chip and is cached for submit.
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
    // Start the camera/GPS on the next tick (after paint) — keeps any state updates out of the
    // synchronous effect commit.
    const id = window.setTimeout(() => void startScanning(), 0);
    return () => {
      window.clearTimeout(id);
      stopCamera();
    };
  }, [phase, startScanning, stopCamera]);

  // QR landing: no camera, but GPS still warms up so the chip is honest and submit is instant.
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
    // Came in from a QR link → go back to the direction picker, not the camera.
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
      <BottomSheet ariaLabel={isOut ? copy.resultOutTitle : copy.resultInTitle} className="att att__result-sheet capw-sheet" onClose={onDismiss}>
        <ResultSheet result={result} isOut={isOut} onHome={goHome} onRetry={retry} copy={copy} />
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

  // ── QR deep link landing: pick 출근 / 퇴근 for the building we just scanned ──
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
  onHome,
  onRetry,
  copy,
}: {
  result: AttendanceScanResult;
  isOut: boolean;
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
