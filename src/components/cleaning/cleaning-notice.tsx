"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { haptic as fireHaptic, type HapticKind } from "@/lib/haptics";

/**
 * 청소 화면의 결과 안내(시작됨 · 거절 사유 …) — 뜨면 **보이는 곳으로 끌어온다**(2026-10-15).
 *
 * 시작 · 완료 · 취소는 같은 화면으로 돌아오며 안내를 화면 위쪽에 그린다. 그런데 셸은 같은 화면의 스크롤 위치를 그대로 두므로,
 * 아래쪽 카드에서 「청소 시작」을 누른 사람에게는 안내가 화면 밖에 떠서 **아무 반응이 없는 것처럼** 보였다(10/15 아라키초A 401 거절).
 * `nonce` 가 바뀔 때마다(서버가 매번 새로 준다) 다시 끌어온다 — 같은 거절이 연달아 와도 매번 보이게.
 */
export function CleaningNotice({
  children,
  className,
  haptic,
  nonce,
}: {
  children: ReactNode;
  className: string;
  /** 안내가 뜰 때 한 번 — 서버 결과를 받은 뒤라 완료는 `success`, 거절은 `error`(햅틱 공용 규칙, 2026-10-26). */
  haptic?: HapticKind;
  nonce: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (haptic) fireHaptic(haptic);
    // nonce 가 바뀔 때만(서버가 매번 새로 준다) — 같은 안내의 다시 그리기로는 울리지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  return (
    <div className={className} ref={ref} role="status">
      {children}
    </div>
  );
}
