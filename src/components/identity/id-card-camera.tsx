"use client";

/**
 * 카드 촬영 화면 — 어두운 바탕 · 카드 비율(85.6 × 54mm) 틀 · 셔터 · 앨범(docs/product/41 §3-1, 시안 C2 · C3 · J1 · W2).
 *
 * 화면 속 틀에 맞는 부분만 잘라 긴 변 2000px JPEG 로 만든다(글자가 읽히게 품질 0.92). 카메라를 못 쓰면(권한 · 기기) 앨범만.
 * 넓은 화면(`tablet:`)에서는 왼쪽 미리보기 · 오른쪽 단계 안내로 나눈다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";

const CARD_RATIO = 85.6 / 54;
const MAX_LONG = 2000;
const QUALITY = 0.92;

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

  async function shoot() {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || busy || !video.videoWidth) return;
    setBusy(true);
    haptic("light");
    // 화면에 보이는 영상(object-fit: cover)에서 틀이 차지하는 부분 → 원본 영상 픽셀로 바꿔 자른다. 가장자리 4% 여유.
    const vr = video.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const scale = Math.max(vr.width / video.videoWidth, vr.height / video.videoHeight);
    const offsetX = (video.videoWidth * scale - vr.width) / 2;
    const offsetY = (video.videoHeight * scale - vr.height) / 2;
    const padX = fr.width * 0.04;
    const padY = fr.height * 0.04;
    let sx = (fr.left - vr.left - padX + offsetX) / scale;
    let sy = (fr.top - vr.top - padY + offsetY) / scale;
    let sw = (fr.width + padX * 2) / scale;
    let sh = (fr.height + padY * 2) / scale;
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    sw = Math.min(video.videoWidth - sx, sw);
    sh = Math.min(video.videoHeight - sy, sh);
    const out = Math.min(1, MAX_LONG / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * out);
    canvas.height = Math.round(sh * out);
    canvas.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await toJpeg(canvas);
    setBusy(false);
    if (blob) {
      stop();
      onCapture(blob);
    }
  }

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
          ) : warning ? null : (
            <p className="idc-cam__note">{copy.tipGlare}</p>
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
