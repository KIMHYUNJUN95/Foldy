"use client";

/**
 * 카드 촬영 화면 — 어두운 바탕 · 카드 비율(85.6 × 54mm) 틀 · 셔터 · 앨범(docs/product/41 §3-1, 시안 C2 · C3 · J1 · W2).
 *
 * 화면 속 틀에 맞는 부분만 잘라 긴 변 2000px JPEG 로 만든다(글자가 읽히게 품질 0.92). 카메라를 못 쓰면(권한 · 기기) 앨범만.
 * 자동 촬영(2026-10-23): 0.12초마다 틀 주변을 작게 떠서 카드 네 변이 틀에 맞고(셋 이상) 선명하고 멈춰 있으면 셔터 둘레 원이
 * 0.7초 동안 차오르고 저절로 찍힌다. 틀 모서리는 찾으면 흰색 → 보라. 못 찾는 환경(흰 카드 · 흰 책상)을 위해 셔터는 그대로.
 * 넓은 화면(`tablet:`)에서는 왼쪽 미리보기 · 오른쪽 단계 안내로 나눈다.
 *
 * 앱(iOS · Android, 2026-10-23): 먼저 OS 문서 스캐너(VisionKit · ML Kit)를 연다(`src/lib/native/document-scanner.ts`) — 모서리를
 * 찾아 저절로 찍고 기울기를 편다. 결과는 앨범 사진과 같은 규칙(긴 변 2000px · 0.92)으로 다시 만든다. 스캐너를 닫거나(취소) 쓸 수
 * 없으면(옛 앱 빌드 · Play 서비스 없음) 아래 웹 카메라로 이어지고, 오른쪽 아래 「자동 스캔」으로 다시 열 수 있다.
 * 카메라 권한이 꺼져 있으면 앱에서는 「설정 열기」를 같이 보여 준다(`src/lib/native/app-settings.ts`).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { canOpenAppSettings, openAppSettings } from "@/lib/native/app-settings";
import { abandonCardScan, canUseDocumentScanner, scanCardSide, scannerFailedBefore } from "@/lib/native/document-scanner";
import { DETECT_PAD, STILL_DIFF, assessCardFit, frameDifference, toGray, type GrayFrame } from "@/lib/staff-documents/card-detect";

const CARD_RATIO = 85.6 / 54;
const MAX_LONG = 2000;
const QUALITY = 0.92;
const DETECT_EVERY_MS = 120;
const HOLD_MS = 700;
const DETECT_W = 160;

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", QUALITY));
}

/** 앨범 사진 · 문서 스캐너 결과 — 자르지 않고 긴 변만 줄인다. */
export async function fileToCardJpeg(file: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, MAX_LONG / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return toJpeg(canvas);
}

export type CameraCopy = {
  cancel: string;
  shutter: string;
  album: string;
  cameraDenied: string;
  cameraStarting: string;
  tipGlare: string;
  autoHint: string;
  autoFound: string;
  scanOpening: string;
  scanUnavailable: string;
  scanStart: string;
  cameraDeniedApp: string;
  openSettings: string;
  cameraUnavailable: string;
  cameraRetry: string;
};

export function IdCardCamera({
  copy,
  title,
  counter,
  warning,
  steps,
  autoScan = true,
  onCapture,
  onCancel,
}: {
  copy: CameraCopy;
  /** 틀 위 안내 — 「사진이 있는 앞면을 …」 */
  title: string;
  /** 위 가운데 「앞면 2/4」 */
  counter: string;
  /** 마이넘버 「뒷면은 찍지 마세요」 같은 경고(선택). */
  warning?: ReactNode;
  /** 태블릿 오른쪽 단계 목록(선택). */
  steps?: ReactNode;
  /** 앱에서 열리자마자 문서 스캐너를 띄울지. 안내(경고 · 실패)를 먼저 읽어야 할 때는 false — 「자동 스캔」 버튼으로 연다. */
  autoScan?: boolean;
  onCapture: (jpeg: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 앱에서 문서 스캐너를 쓸 수 있으면 스캐너부터, 아니면 웹 카메라. */
  const [mode, setMode] = useState<"scan" | "camera">(() => (autoScan && canUseDocumentScanner() && !scannerFailedBefore() ? "scan" : "camera"));
  const [scannerAvailable] = useState(canUseDocumentScanner);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [state, setState] = useState<"starting" | "live" | "denied" | "unavailable">("starting");
  /** 한 번 넘긴 뒤에는 다시 넘기지 않는다(자동 촬영 · 셔터 · 앨범 · 스캐너가 겹쳐도 한 장만). */
  const deliveredRef = useRef(false);
  /** 넘긴 뒤(올리는 중) — 안내 · 버튼을 거둔다. */
  const [sent, setSent] = useState(false);
  /** 권한 거부 뒤 설정에서 켜고 돌아오면 카메라를 다시 켠다. */
  const [cameraTry, setCameraTry] = useState(0);
  const wentToSettingsRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(false);
  const [progress, setProgress] = useState(0);
  const busyRef = useRef(false);
  const shootRef = useRef<() => Promise<void>>(async () => {});

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  function deliver(jpeg: Blob) {
    if (deliveredRef.current) return;
    deliveredRef.current = true;
    stop();
    setSent(true);
    onCapture(jpeg);
  }
  // 스캐너 결과가 늘 최신 deliver · 문구를 쓰게(렌더 중 ref 쓰기 금지 — 커밋 뒤에).
  const deliverRef = useRef(deliver);
  const scanFailCopyRef = useRef(copy.scanUnavailable);
  useEffect(() => {
    deliverRef.current = deliver;
    scanFailCopyRef.current = copy.scanUnavailable;
  });

  // 앱 — OS 문서 스캐너. 닫으면(취소) · 실패하면 웹 카메라로. mode 가 바뀔 때만 연다(다시 그려져도 두 번 열지 않는다).
  useEffect(() => {
    if (mode !== "scan" || deliveredRef.current) return;
    let cancelled = false;
    void scanCardSide().then(async (result) => {
      if (cancelled || deliveredRef.current) return;
      if (result.kind === "image") {
        const jpeg = await fileToCardJpeg(result.blob);
        if (cancelled) return;
        if (jpeg) {
          haptic("light");
          deliverRef.current(jpeg);
          return;
        }
      }
      setScanNote(result.kind === "cancel" ? null : scanFailCopyRef.current);
      setState("starting");
      setMode("camera");
    });
    // 결과가 끝내 안 오면(네이티브가 멈춤) 기다림을 버리고 웹 카메라로 — 안 그러면 이후 모든 열기가 같이 멈춘다.
    let wasHidden = false;
    let timer = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        window.clearTimeout(timer);
      } else if (wasHidden) {
        // 안드로이드는 스캐너가 닫힌 뒤 결과가 곧 따라온다 — 넉넉히 기다려도 없으면 포기.
        timer = window.setTimeout(abandonCardScan, 3000);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      abandonCardScan();
    };
  }, [mode]);

  function reopenScanner() {
    haptic("light");
    stop();
    setScanNote(null);
    setFound(false);
    setProgress(0);
    // 자동 촬영 타이머를 멈춘다 — 스캐너가 떠 있는 동안 멈춘 영상의 마지막 장면을 찍지 않게.
    setState("starting");
    setMode("scan");
  }

  useEffect(() => {
    if (mode !== "camera") return;
    let cancelled = false;
    const open = (video: MediaStreamConstraints["video"]) => navigator.mediaDevices.getUserMedia({ video, audio: false });
    const id = window.setTimeout(async () => {
      let stream: MediaStream;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        stream = await open({ facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1440 } });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          if (!cancelled) setState("denied");
          return;
        }
        // 스캐너가 막 닫혀 카메라가 아직 잡혀 있는 경우 등 — 잠깐 뒤 조건을 풀어 한 번 더.
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        if (cancelled) return;
        try {
          stream = await open(true);
        } catch (retryError) {
          const retryName = retryError instanceof DOMException ? retryError.name : "";
          if (!cancelled) setState(retryName === "NotAllowedError" || retryName === "SecurityError" ? "denied" : "unavailable");
          return;
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      if (cancelled) return;
      setScanNote(null);
      setState("live");
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      stop();
    };
  }, [mode, stop, cameraTry]);

  // 「설정 열기」로 나갔다가 돌아오면(권한을 켰을 수 있다) 카메라를 다시 시도한다. 권한 팝업이 닫힐 때도 화면이 다시 보이므로
  // 설정으로 나간 경우에만(다시 묻는 팝업이 이어지지 않게).
  useEffect(() => {
    if (state !== "denied" || mode !== "camera") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !wentToSettingsRef.current) return;
      wentToSettingsRef.current = false;
      setState("starting");
      setCameraTry((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state, mode]);

  // 안드로이드 뒤로가기는 먼저 Esc 를 보낸다(NativeShellBridge) — 여기서 받아 바로 닫는다(두 번 눌러야 하지 않게).
  const cancelRef = useRef(() => {});
  useEffect(() => {
    cancelRef.current = () => {
      stop();
      onCancel();
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** 화면에 보이는 영상(object-fit: cover)에서 틀(+ 여유 `pad`)이 차지하는 부분 → 원본 영상 픽셀 사각형. */
  function cropRect(pad: number) {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || !video.videoWidth) return null;
    const vr = video.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const scale = Math.max(vr.width / video.videoWidth, vr.height / video.videoHeight);
    const offsetX = (video.videoWidth * scale - vr.width) / 2;
    const offsetY = (video.videoHeight * scale - vr.height) / 2;
    const padX = fr.width * pad;
    const padY = fr.height * pad;
    let sx = (fr.left - vr.left - padX + offsetX) / scale;
    let sy = (fr.top - vr.top - padY + offsetY) / scale;
    let sw = (fr.width + padX * 2) / scale;
    let sh = (fr.height + padY * 2) / scale;
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    sw = Math.min(video.videoWidth - sx, sw);
    sh = Math.min(video.videoHeight - sy, sh);
    return { video, sx, sy, sw, sh };
  }

  async function shoot() {
    const rect = cropRect(0.04);
    if (!rect || busyRef.current) return;
    const { video, sx, sy, sw, sh } = rect;
    busyRef.current = true;
    setBusy(true);
    haptic("light");
    const out = Math.min(1, MAX_LONG / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * out);
    canvas.height = Math.round(sh * out);
    canvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await toJpeg(canvas);
    busyRef.current = false;
    setBusy(false);
    if (blob) deliver(blob);
  }
  // 자동 촬영 타이머가 늘 최신 shoot 를 부르게(렌더 중 ref 쓰기 금지 — 커밋 뒤에).
  useEffect(() => {
    shootRef.current = shoot;
  });

  // 자동 촬영 — 카드가 틀에 맞고 멈춰 있으면 HOLD_MS 뒤 저절로.
  useEffect(() => {
    if (state !== "live") return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let prev: GrayFrame | null = null;
    let holdStart: number | null = null;
    let lastFound = false;
    const id = window.setInterval(() => {
      if (busyRef.current) return;
      const rect = cropRect(DETECT_PAD);
      if (!rect) return;
      const w = DETECT_W;
      const h = Math.max(20, Math.round((DETECT_W * rect.sh) / rect.sw));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(rect.video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, w, h);
      const gray = toGray(ctx.getImageData(0, 0, w, h).data, w, h);
      const fit = assessCardFit(gray);
      const still = frameDifference(prev, gray) <= STILL_DIFF;
      prev = gray;
      if (fit.fits !== lastFound) {
        lastFound = fit.fits;
        setFound(fit.fits);
        if (fit.fits) haptic("light");
      }
      if (fit.fits && still) {
        const now = performance.now();
        holdStart ??= now;
        const p = Math.min(1, (now - holdStart) / HOLD_MS);
        setProgress(p);
        if (p >= 1) {
          holdStart = null;
          setProgress(0);
          void shootRef.current();
        }
      } else if (!fit.fits) {
        holdStart = null;
        setProgress(0);
      }
    }, DETECT_EVERY_MS);
    return () => window.clearInterval(id);
  }, [state]);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const blob = await fileToCardJpeg(file);
    setBusy(false);
    if (blob) deliver(blob);
  }

  const scanning = mode === "scan";
  const settingsAvailable = state === "denied" && canOpenAppSettings();

  return (
    <div className="idc-cam" role="dialog" aria-label={title} data-swipe-back="off">
      <video ref={videoRef} playsInline muted className="idc-cam__video" aria-hidden="true" />
      <div className="idc-cam__main">
        <div className="idc-cam__top">
          <button className="idc-cam__textbtn" onClick={() => { stop(); onCancel(); }} type="button">
            {copy.cancel}
          </button>
          <span className="idc-cam__counter">{counter}</span>
          <span className="idc-cam__spacer" />
        </div>
        <div className="idc-cam__stage">
          <p className="idc-cam__title">{title}</p>
          <div
            ref={frameRef}
            className="idc-cam__frame"
            data-found={found ? "" : undefined}
            style={{ aspectRatio: String(CARD_RATIO) }}
            aria-hidden="true"
          >
            <i className="idc-cam__corner idc-cam__corner--tl" />
            <i className="idc-cam__corner idc-cam__corner--tr" />
            <i className="idc-cam__corner idc-cam__corner--bl" />
            <i className="idc-cam__corner idc-cam__corner--br" />
          </div>
          {sent ? null : scanning ? (
            <p className="idc-cam__note" role="status">{copy.scanOpening}</p>
          ) : state === "denied" ? (
            <div className="idc-cam__denied">
              <p className="idc-cam__note idc-cam__note--warn" role="alert">
                {settingsAvailable ? copy.cameraDeniedApp : copy.cameraDenied}
              </p>
              {settingsAvailable && (
                <button className="idc-cam__settings" onClick={() => {
                    wentToSettingsRef.current = true;
                    void openAppSettings();
                  }} type="button">
                  {copy.openSettings}
                </button>
              )}
            </div>
          ) : state === "unavailable" ? (
            <div className="idc-cam__denied">
              <p className="idc-cam__note idc-cam__note--warn" role="alert">{copy.cameraUnavailable}</p>
              <button className="idc-cam__settings" onClick={() => { setState("starting"); setCameraTry((n) => n + 1); }} type="button">
                {copy.cameraRetry}
              </button>
            </div>
          ) : scanNote ? (
            <p className="idc-cam__note idc-cam__note--warn" role="status">{scanNote}</p>
          ) : state === "starting" ? (
            <p className="idc-cam__note" role="status">{copy.cameraStarting}</p>
          ) : found ? (
            <p className="idc-cam__found" role="status">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
              {copy.autoFound}
            </p>
          ) : warning ? null : (
            <p className="idc-cam__note">{copy.autoHint}<br />{copy.tipGlare}</p>
          )}
          {warning && <div className="idc-cam__warn">{warning}</div>}
        </div>
        <div className="idc-cam__bar">
          <button
            aria-label={copy.album}
            className="idc-cam__album"
            disabled={busy || sent}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 16l5-5 4 4 3-3 6 6" /></svg>
          </button>
          <button
            aria-label={copy.shutter}
            className="idc-cam__shutter"
            disabled={scanning || sent || state !== "live" || busy}
            onClick={() => void shoot()}
            type="button"
          >
            <svg aria-hidden="true" className="idc-cam__ring" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="37" style={{ strokeDashoffset: 232.5 * (1 - progress) }} />
            </svg>
            <span />
          </button>
          {scannerAvailable ? (
            <button
              aria-label={copy.scanStart}
              className="idc-cam__album"
              disabled={busy || scanning || sent}
              onClick={reopenScanner}
              type="button"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10" /></svg>
            </button>
          ) : (
            <span className="idc-cam__album idc-cam__album--ghost" aria-hidden="true" />
          )}
        </div>
      </div>
      {steps && <aside className="idc-cam__side">{steps}</aside>}
      <input
        ref={fileRef}
        accept="image/*"
        aria-hidden="true"
        className="hidden"
        onChange={(e) => {
          void pickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
        tabIndex={-1}
        type="file"
      />
    </div>
  );
}
