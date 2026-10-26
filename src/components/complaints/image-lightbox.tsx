"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  images: string[];
  startIndex: number;
  onClose: () => void;
  labels: {
    close: string;
    photo: (index: number) => string;
  };
}

type XY = { clientX: number; clientY: number };
function dist2(a: XY, b: XY) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function ImageLightbox({ images, startIndex, onClose, labels }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [swipeDx, setSwipeDx] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);

  // 터치 추적은 일반 객체 ref 로 — 제스처 중 리렌더 없음
  const touch = useRef({
    n: 0,
    x0: 0, y0: 0,
    tx0: 0, ty0: 0,
    d0: 0, s0: 1,
    swiping: false,
    dx: 0,
  });

  // 네이티브 touchmove 핸들러가 읽는 상태 ref (오래된 클로저 방지)
  const live = useRef({ scale: 1, tx: 0, ty: 0, index });
  live.current = { scale, tx, ty, index };

  // Body scroll lock + 브라우저 뷰포트 핀치줌 완전 차단
  // iOS PWA에서 viewport meta(user-scalable=no)는 무시되는 경우가 있어 신뢰할 수 없다.
  // document 레벨에서 passive:false 로 touchmove를 전량 preventDefault 해야
  // 브라우저 자체 핀치줌이 완전히 막힌다. wrapRef의 핸들러는 이와 별개로 동작한다.
  // 닫힐 때: meta 트릭(maximum-scale=1 순간 적용 → 원복)으로 잔존 뷰포트 줌을 1x 로 강제 리셋.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 문서 전체 touchmove 차단 — 라이트박스 외부 영역 포함
    const blockMove = (e: TouchEvent) => { e.preventDefault(); };
    document.addEventListener("touchmove", blockMove, { passive: false });

    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const prevViewport = meta?.getAttribute("content") ?? "";

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("touchmove", blockMove);

      // 닫힐 때 뷰포트 줌 강제 1x 리셋
      if (meta) {
        meta.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1");
        requestAnimationFrame(() => {
          meta.setAttribute("content", prevViewport);
        });
      }
    };
  }, []);

  // 키보드
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && live.current.index > 0) go(live.current.index - 1);
      else if (e.key === "ArrowRight" && live.current.index < images.length - 1)
        go(live.current.index + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [images.length, onClose]);

  // non-passive touchmove — preventDefault 를 호출하려면 DOM API 로 추가해야 함
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const r = touch.current;
      const { scale } = live.current;
      if (e.touches.length === 2 && r.n >= 2) {
        const d = dist2(e.touches[0], e.touches[1]);
        setScale(Math.min(5, Math.max(1, r.s0 * (d / r.d0))));
      } else if (e.touches.length === 1 && r.n === 1) {
        const dx = e.touches[0].clientX - r.x0;
        const dy = e.touches[0].clientY - r.y0;
        if (scale > 1) {
          setTx(r.tx0 + dx);
          setTy(r.ty0 + dy);
        } else {
          r.dx = dx;
          r.swiping = true;
          setSwipeDx(dx);
        }
      }
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  });

  function go(i: number) {
    setIndex(i);
    setScale(1); setTx(0); setTy(0); setSwipeDx(0);
    touch.current.swiping = false;
    touch.current.dx = 0;
  }

  function onTouchStart(e: React.TouchEvent) {
    const r = touch.current;
    r.n = e.touches.length;
    if (r.n === 1) {
      r.x0 = e.touches[0].clientX;
      r.y0 = e.touches[0].clientY;
      r.tx0 = tx; r.ty0 = ty;
      r.swiping = false; r.dx = 0;
    } else if (r.n === 2) {
      r.d0 = dist2(e.touches[0], e.touches[1]);
      r.s0 = scale;
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    const r = touch.current;
    r.n = e.touches.length;
    if (r.swiping) {
      if (r.dx < -60 && index < images.length - 1) go(index + 1);
      else if (r.dx > 60 && index > 0) go(index - 1);
      else setSwipeDx(0);
      r.swiping = false;
      r.dx = 0;
    }
    if (scale < 1) { setScale(1); setTx(0); setTy(0); }
  }

  // 이미지 변형: 확대가 스와이프 피드백보다 우선
  const imgTransform =
    scale > 1
      ? `scale(${scale}) translate(${tx / scale}px, ${ty / scale}px)`
      : swipeDx !== 0
        ? `translateX(${swipeDx * 0.35}px)`
        : "none";
  const imgTransition =
    scale > 1 || touch.current.swiping ? "none" : "transform 0.22s cubic-bezier(.22,1,.36,1)";

  // SSR 가드 — SSR 중 Node.js 에서는 document 가 없음
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cx-lb" role="dialog" aria-modal>
      {/* 카운터 */}
      {images.length > 1 && (
        <div className="cx-lb__counter">{index + 1} / {images.length}</div>
      )}
      {/* 닫기 */}
      <button className="cx-lb__close" onClick={onClose} aria-label={labels.close}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {/* 이미지 영역 (터치 수신) */}
      <div
        ref={wrapRef}
        className="cx-lb__wrap"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* 라이트박스는 **원본 해상도**로 본다(결정 로그 2026-06-22) — 축소 사본을 내려받으면
            «크게 봐서 확인한다» 는 목적이 깨진다. 핀치 줌도 원본이어야 의미가 있다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[index]}
          alt=""
          className="cx-lb__img"
          style={{ transform: imgTransform, transition: imgTransition }}
          draggable={false}
        />
      </div>
      {/* 닷 인디케이터 */}
      {images.length > 1 && (
        <div className="cx-lb__dots">
          {images.map((_, i) => (
            <button
              key={i}
              className={`cx-lb__dot${i === index ? " on" : ""}`}
              onClick={() => go(i)}
              aria-label={labels.photo(i + 1)}
            />
          ))}
        </div>
      )}
      {/* 스크림 (이미지 밖 탭 → 닫기) */}
      <div className="cx-lb__scrim" onClick={onClose} />
    </div>,
    document.body,
  );
}
