/**
 * 판매 캘린더 날짜 열 위의 두 줄 — 「빈 방」 · 「평균가」(2026-10-16 화이트 리디자인, 사용자 승인 「이대로」).
 *
 * 데스크톱(`/admin/ops/calendar`)과 모바일(`/mobile/ops/calendar`) 격자가 **같은 함수**를 쓴다 — 한쪽만 고치지 말 것.
 * 서버를 다시 부르지 않고 **지금 보이는 객실 · 날짜**에서 계산한다(필터로 객실을 숨기면 숫자도 따라 바뀐다).
 *
 * - **빈 방** = 그 밤에 예약(취소 아님)도 차단도 없는 객실 수.
 * - **평균가** = 그 밤에 가격이 있는 칸들의 평균(빈 방 · 팔린 방 구분 없이 — 가격표의 평균). 가격 있는 칸이 없으면 `null`.
 *
 * 판정(팔림 · 차단 · 가격)은 부르는 쪽이 넘긴다 — 격자가 이미 가진 조회(`soldCells` · `blockedCells` · `rateAt`)를
 * 그대로 쓰게 해서, 격자 칸이 보여 주는 것과 숫자가 어긋나지 않게 한다.
 */
export type OpsDaySummary = {
  date: string;
  /** 예약 · 차단 없는 객실 수. */
  vacant: number;
  /** 가격 있는 칸의 평균(엔, 반올림). 없으면 null. */
  avgPrice: number | null;
};

export function buildOpsDaySummaries(args: {
  /** 보이는 날짜(격자 열 순서). */
  dates: readonly string[];
  /** 보이는 객실 키(필터 반영 후). */
  roomKeys: readonly string[];
  isSold: (roomKey: string, date: string) => boolean;
  isBlocked: (roomKey: string, date: string) => boolean;
  priceAt: (roomKey: string, date: string) => number | null | undefined;
}): OpsDaySummary[] {
  const { dates, roomKeys, isSold, isBlocked, priceAt } = args;
  return dates.map((date) => {
    let vacant = 0;
    let sum = 0;
    let priced = 0;
    for (const roomKey of roomKeys) {
      if (!isSold(roomKey, date) && !isBlocked(roomKey, date)) vacant += 1;
      const price = priceAt(roomKey, date);
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        sum += price;
        priced += 1;
      }
    }
    return { avgPrice: priced > 0 ? Math.round(sum / priced) : null, date, vacant };
  });
}
