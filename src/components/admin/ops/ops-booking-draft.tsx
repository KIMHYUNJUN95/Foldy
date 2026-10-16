"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkoutCandidates, resolveDraftCheckout, stayNights } from "@/lib/ops-manual-booking";
import "./ops-calendar-panels-white.css";

/**
 * 수동 예약 — 체크인을 찍은 **그 방의 예약 줄** 위에 깔리는 기간 고르기 레이어.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「기간은 격자에서 고른다」
 *
 * ## 왜 따로 떼었나 (2026-09-28)
 *
 * 처음에는 칸마다 `onMouseEnter` 로 격자 상태를 바꿨다. 그러면 마우스가 한 칸 옮길 때마다
 * **격자 전체(객실 수 × 날짜 수)가 다시 그려져서** 막대가 끊겨 따라왔다(사용자 지적).
 * 여기서는 포인터 위치를 이 컴포넌트 **안에서만** 들고 있다 — 움직여도 이 줄만 다시 그린다.
 *
 * ## 칸이 아니라 포인터 좌표로 날짜를 잡는다
 *
 * 칸 경계·막대·빗금 위를 지나도 끊기지 않는다. 팔린 밤 너머를 가리키면
 * `resolveDraftCheckout` 이 **벽 앞으로 당긴다** — 막대가 사라지지 않고 거기서 멈춘다.
 * 미리보기와 확정이 같은 함수를 쓰므로 보이는 그대로 잡힌다.
 *
 * ## 클릭 두 번도, 드래그도 된다
 *
 * - **드래그**: `+` 를 누른 채 끌어서 놓으면 놓은 날이 체크아웃이다.
 * - **클릭 두 번**: `+` 를 누르고 떼면 기다린다. 다음에 누른 날이 체크아웃이다(저쪽과 같다).
 *
 * 둘을 가르는 것은 **이 레이어에서 눌렀는가**다. `+` 에서 누르고 여기서 뗀 것은 드래그의 끝이고,
 * 여기서 누르고 뗀 것은 두 번째 클릭이다. 드래그 끝이 체크인 칸이면(안 움직였으면) 클릭 모드로
 * 남는다 — 그래서 `+` 를 한 번 누른 것만으로 무르지 않는다.
 */
export function OpsBookingDraft({
  checkIn,
  checkInLabel,
  dates,
  geometry,
  isOccupied,
  nightsLabel,
  onCancel,
  onCommit,
  onRestart,
}: {
  checkIn: string;
  checkInLabel: string;
  /** 화면의 연속 날짜(정렬됨). 포인터 좌표를 날짜로 바꾸는 눈금이다. */
  dates: readonly string[];
  /** 실제 예약 막대와 같은 자리 계산 — 미리보기가 **들어갈 모양 그대로** 보이게. */
  geometry: (checkIn: string, checkOut: string) => { left: string; width: string } | null;
  isOccupied: (date: string) => boolean;
  /** `{n}` 자리에 박 수가 들어간다. */
  nightsLabel: string;
  onCancel: () => void;
  onCommit: (checkOut: string) => void;
  /** 체크인보다 앞의 빈 날을 누르면 그 날부터 다시 고른다. 못 고르는 날이면 아무 일도 없다. */
  onRestart: (date: string) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const pressedHere = useRef(false);
  const [pointed, setPointed] = useState<string | null>(null);

  const candidates = useMemo(
    () => checkoutCandidates(checkIn, dates, isOccupied),
    [checkIn, dates, isOccupied],
  );
  const checkOut = pointed ? resolveDraftCheckout(checkIn, pointed, candidates) : null;

  // 레이어가 생기자마자 키보드를 받는다 — ←/→ 로 늘리고 줄이고, Enter 로 확정한다.
  useEffect(() => {
    layerRef.current?.focus({ preventScroll: true });
  }, []);

  const dateAt = (clientX: number): string | null => {
    const layer = layerRef.current;
    if (!layer || dates.length === 0) return null;
    const rect = layer.getBoundingClientRect();
    const column = Math.floor(((clientX - rect.left) / rect.width) * dates.length);
    return dates[Math.min(dates.length - 1, Math.max(0, column))] ?? null;
  };

  const track = (clientX: number) => {
    const date = dateAt(clientX);
    // 같은 날이면 상태를 안 바꾼다 — 칸 안에서 움직이는 동안은 다시 그리지 않는다.
    if (date && date !== pointed) setPointed(date);
  };

  const release = (clientX: number) => {
    const date = dateAt(clientX);
    const wasClick = pressedHere.current;
    pressedHere.current = false;
    if (!date) return;
    const out = resolveDraftCheckout(checkIn, date, candidates);
    if (out) {
      onCommit(out);
      return;
    }
    // 여기서부터는 기간이 안 잡힌 경우다. 드래그의 끝이면 클릭 모드로 남는다.
    if (!wasClick) return;
    if (date === checkIn) onCancel();
    else if (date < checkIn) onRestart(date);
  };

  const step = (direction: 1 | -1) => {
    const list = [...candidates];
    if (list.length === 0) return;
    const index = checkOut ? list.indexOf(checkOut) : -1;
    const next = list[Math.min(list.length - 1, Math.max(0, index + direction))];
    setPointed(next);
  };

  const ghost = geometry(checkIn, checkOut ?? addOneDay(checkIn));

  return (
    <div
      aria-label={checkInLabel}
      className="opsg__draftlayer"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          step(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          step(-1);
        } else if (event.key === "Enter" && checkOut) {
          event.preventDefault();
          onCommit(checkOut);
        }
      }}
      onPointerDown={(event) => {
        pressedHere.current = true;
        track(event.clientX);
      }}
      onPointerMove={(event) => track(event.clientX)}
      onPointerUp={(event) => release(event.clientX)}
      ref={layerRef}
      role="slider"
      // 값은 박 수다 — ←/→ 한 번이 1박이다.
      aria-valuemax={candidates.size}
      aria-valuemin={0}
      aria-valuenow={checkOut ? stayNights(checkIn, checkOut).length : 0}
      aria-valuetext={checkOut ?? checkIn}
      tabIndex={0}
    >
      {ghost && (
        <div aria-hidden className={`opsg__draft spw-draft${checkOut ? " has-out" : ""}`} style={ghost}>
          {checkOut
            ? `${nightsLabel.replace("{n}", String(stayNights(checkIn, checkOut).length))} · ${checkOut
                .slice(5)
                .replace("-", "/")}`
            : checkInLabel}
        </div>
      )}
    </div>
  );
}

/** `YYYY-MM-DD` 다음 날. 시간대에 안 흔들리도록 UTC 정오로 고정한다. */
function addOneDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}
