"use client";

import { useEffect, useRef, useState } from "react";
import { loadRoomAvailability } from "@/actions/ops-calendar";
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";
import { MAX_STAY_NIGHTS, stayNights } from "@/lib/ops-manual-booking";

/**
 * 한 객실 행의 **팔 수 있는 밤** — 날짜 피커가 회색으로 칠할 날을 정한다.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「팔 수 있는 날만 고른다」
 *
 * 수동 예약 패널과 예약 수정 패널이 같이 쓴다(2026-09-29 수동 예약 패널에서 떼어냈다).
 *
 * - 피커가 여는 달마다 그 달과 다음 달을 서버에서 읽는다(`loadRoomAvailability`, 최대 62일).
 *   한 번 읽은 달은 다시 안 읽는다. **아직 모르는 밤은 막는다** — 열어 두면 그대로 초과예약이다.
 * - 체크인을 찍은 뒤에는 **그 사이 밤이 전부 팔 수 있는** 체크아웃만 연다.
 * - `excludeReservationId` — 예약 수정에서 그 예약 자신의 밤은 「찬 밤」으로 세지 않는다.
 * - `allowedStart` — 묵고 있는 손님의 **원래 체크인**(과거)은 고를 수 있게 둔다. 그래야 체크아웃
 *   연장이 된다. 이미 지난 밤은 검사하지 않는다(그 예약이 이미 묵은 밤이다).
 */
export function useRoomAvailability(args: {
  roomKey: string;
  roomIds: string[];
  today: string;
  /** 처음에 읽어 둘 달들(`YYYY-MM`) — 피커를 열기 전에 회색이 맞아 있게. */
  seedMonths: string[];
  excludeReservationId?: string;
  allowedStart?: string;
}) {
  const [nightState, setNightState] = useState<Map<string, "free" | "taken">>(new Map());
  const [failed, setFailed] = useState(false);
  const requestedMonths = useRef(new Set<string>());

  const loadMonths = (monthKey: string) => {
    const months = [monthKey, shiftMonthKey(monthKey, 1)].filter(
      (month) => !requestedMonths.current.has(month),
    );
    if (months.length === 0) return;
    for (const month of months) requestedMonths.current.add(month);
    const from = `${months[0]}-01`;
    const toExclusive = `${shiftMonthKey(months[months.length - 1], 1)}-01`;
    void loadRoomAvailability({
      excludeReservationId: args.excludeReservationId,
      from,
      roomIds: args.roomIds,
      roomKey: args.roomKey,
      toExclusive,
    }).then((result) => {
      if (!result.ok) {
        // 다시 열 때 재시도할 수 있게 표시를 거둔다. 그동안은 막힌 채로 둔다.
        for (const month of months) requestedMonths.current.delete(month);
        setFailed(true);
        return;
      }
      const taken = new Set([...result.booked, ...result.unsellable]);
      setNightState((previous) => {
        const next = new Map(previous);
        for (const night of stayNights(from, toExclusive)) {
          next.set(night, taken.has(night) ? "taken" : "free");
        }
        return next;
      });
    });
  };

  // 열릴 때 한 번만 — 이후는 피커의 달 이동이 부른다.
  useEffect(() => {
    for (const month of new Set(args.seedMonths)) loadMonths(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 이미 지난 밤은 보지 않는다 — 새로 파는 밤이 아니다. */
  const nightTaken = (night: string) => night >= args.today && nightState.get(night) !== "free";

  const isDateDisabled = (date: string, pendingFrom: string | null) => {
    if (pendingFrom && date > pendingFrom) {
      // 체크아웃 후보: 그 사이의 밤이 **전부** 팔 수 있어야 한다. 체크아웃 날 자체는 밤이 아니다.
      const between = stayNights(pendingFrom, date);
      return between.length > MAX_STAY_NIGHTS || between.some(nightTaken);
    }
    if (date === args.allowedStart) return false;
    return date < args.today || nightTaken(date);
  };

  /** 이 숙박에서 막힌 밤 — 읽기가 늦게 도착해 드러날 수 있다. 지난 밤은 뺀다. */
  const takenIn = (nights: readonly string[]) =>
    nights.filter((night) => night >= args.today && nightState.get(night) === "taken");

  return { failed, isDateDisabled, loadMonths, takenIn };
}
