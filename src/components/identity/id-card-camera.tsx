"use client";

/**
 * 카드 촬영 화면 — 어두운 바탕 · 카드 비율(85.6 × 54mm) 틀 · 셔터 · 앨범(docs/product/41 §3-1, 시안 C2 · C3 · J1 · W2).
 *
 * 화면 속 틀에 맞는 부분만 잘라 긴 변 2000px JPEG 로 만든다(글자가 읽히게 품질 0.92). 카메라를 못 쓰면(권한 · 기기) 앨범만.
 * 자동 촬영(2026-10-23): 0.12초마다 틀 주변을 작게 떠서 카드 네 변이 틀에 맞고(셋 이상) 선명하고 멈춰 있으면 셔터 둘레 원이
 * 0.7초 동안 차오르고 저절로 찍힌다. 틀 모서리는 찾으면 흰색 → 보라. 못 찾는 환경(흰 카드 · 흰 책상)을 위해 셔터는 그대로.
 * 넓은 화면(`tablet:`)에서는 왼쪽 미리보기 · 오른쪽 단계 안내로 나눈다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";
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

/** 앨범 사진 — 자르지 않고 긴 변만 줄인다. */
export async function fileToCardJpeg(file: File): Promise<Blob | null> {
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
};

export function IdCardCamera({
  copy,
  title,
  counter,
  warning,
  steps,
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
  onCapture: (jpeg: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"starting" | "live" | "denied">("starting");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(false);
  const [progress, setProgress] = useState(0);
  const busyRef = useRef(false);
  const shootRef = useRef<() => Promise<void>>(async () => {});

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 2560 }, height: { ideal: 1440 } },
          audio: false,
        });
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
        setState("live");
      } catch {
        if (!cancelled) setState("denied");
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      stop();
    };
  }, [stop]);

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
    if (blob) {
      stop();
      onCapture(blob);
    }
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
    if (blob) {
      stop();
      onCapture(blob);
    }
  }

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
          {state === "denied" ? (
            <p className="idc-cam__note idc-cam__note--warn" role="alert">{copy.cameraDenied}</p>
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
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 16l5-5 4 4 3-3 6 6" /></svg>
          </button>
          <button
            aria-label={copy.shutter}
            className="idc-cam__shutter"
            disabled={state !== "live" || busy}
            onClick={() => void shoot()}
            type="button"
          >
            <svg aria-hidden="true" className="idc-cam__ring" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="37" style={{ strokeDashoffset: 232.5 * (1 - progress) }} />
            </svg>
            <span />
          </button>
          <span className="idc-cam__album idc-cam__album--ghost" aria-hidden="true" />
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
