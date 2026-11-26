/**
 * 예약 막대를 **겹치지 않게 층으로 나눈다**.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「취소된 예약 보기」
 * 원본: STAY ARI Manager `BuildingCalendar.jsx` → `cancelledBarLaneMap`
 *
 * ## 왜 필요한가
 *
 * 취소된 예약은 **같은 밤에 여러 건이 겹친다.** 한 손님이 취소하고 다른 손님이 잡았다가 또
 * 취소하면 그 밤에 취소 막대가 세 개다. 한 줄에 그리면 서로 덮어 **아무것도 못 읽는다.**
 *
 * 2026-09-28 실측(최근 90일): 취소가 걸린 방-밤 3,069칸 중 **622칸(20%)이 2건 이상**이고
 * 한 칸 최대 **5건**이다. 드문 일이 아니다.
 *
 * ## 규칙
 *
 * 방마다 따로 센다. 체크인 순으로 훑으며 **비어 있는 첫 층**에 놓는다 — 층이 모자라면
 * 새로 만든다. 같은 층에 놓으려면 앞 막대가 **끝나 있어야** 한다.
 *
 * ```txt
 *  층0  ▓▓▓▓ A ▓▓▓▓        ▓▓ C ▓▓
 *  층1        ▓▓▓▓ B ▓▓▓▓
 * ```
 *
 * **체크아웃 날 밤은 비어 있다.** `checkOut === 다음 checkIn` 이면 겹치지 않으므로 같은 층에
 * 놓는다 — 예약 막대가 그 칸 가운데에서 만나는 것과 같은 규칙이다.
 *
 * ## 순수하다
 *
 * DB·DOM 을 모른다. 층이 하나 어긋나면 막대가 겹치거나 빈 줄이 생기는데 눈으로는 「원래
 * 저런가」 싶어 그냥 넘어간다. 그래서 테스트로 고정한다(`ops-bar-lanes.test.ts`).
 */

export type LaneBar = {
  id: string;
  roomKey: string;
  /** `YYYY-MM-DD`. */
  checkIn: string;
  /** `YYYY-MM-DD`. 이 날 밤은 비어 있다. */
  checkOut: string;
  /**
   * 먼저 자리를 잡는 순서(작을수록 먼저, 기본 0 — 2026-11-26). 판매 캘린더는 확정 0 · 문의/요청 1 · 취소 2 로 넘겨
   * **겹치면 확정이 위층**에 온다 — 문의가 먼저 체크인해도 확정 예약이 0층을 차지한다.
   */
  rank?: number;
};

export type BarLaneResult = {
  /** 막대 id → 층 번호(0부터). */
  laneById: Map<string, number>;
  /** 방 → 그 방이 쓰는 층 수(최소 1). 트랙 높이를 정하는 값이다. */
  laneCountByRoom: Map<string, number>;
};

export function assignBarLanes(bars: readonly LaneBar[]): BarLaneResult {
  const byRoom = new Map<string, LaneBar[]>();
  for (const bar of bars) {
    const list = byRoom.get(bar.roomKey);
    if (list) list.push(bar);
    else byRoom.set(bar.roomKey, [bar]);
  }

  const laneById = new Map<string, number>();
  const laneCountByRoom = new Map<string, number>();

  for (const [roomKey, roomBars] of byRoom) {
    // 체크인 순. 같은 날 시작하면 **짧은 것을 먼저** 놓는다 — 긴 것이 먼저 0층을 차지하면
    // 짧은 것들이 전부 아래층으로 밀려 층이 불필요하게 늘어난다.
    const sorted = [...roomBars].sort(
      (a, b) =>
        (a.rank ?? 0) - (b.rank ?? 0) || a.checkIn.localeCompare(b.checkIn) || a.checkOut.localeCompare(b.checkOut),
    );
    /**
     * 층별로 놓인 구간. 순서(rank)가 섞이면 「가장 늦은 체크아웃」 하나로는 앞쪽 빈자리를 놓친다 — 구간을 다 들고 겹침을 본다.
     * rank 가 하나뿐이면 예전(체크인 순 · 끝난 층에 놓기)과 같은 결과다.
     */
    const lanes: Array<Array<[string, string]>> = [];
    for (const bar of sorted) {
      let lane = lanes.findIndex((spans) => spans.every(([from, to]) => to <= bar.checkIn || bar.checkOut <= from));
      if (lane === -1) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane].push([bar.checkIn, bar.checkOut]);
      laneById.set(bar.id, lane);
    }
    laneCountByRoom.set(roomKey, Math.max(lanes.length, 1));
  }

  return { laneById, laneCountByRoom };
}

/**
 * 차단 막대를 **예약 막대와 겹치지 않는 층**에 놓는다 (2026-10-01).
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「차단이 예약과 겹치면 층을 나눈다」
 *
 * 수기·플랫폼 예약이 이미 있는 밤에도 차단을 건다(남은 판매만 멈추려고). 같은 줄에 그리면 차단이
 * 예약 이름을 덮어 못 읽는다. 「취소 보기」의 층과 같은 방식으로 **예약이 먼저 자리를 잡고**, 차단은
 * 겹치지 않는 첫 층에 놓는다. 겹치지 않으면 0층 — 평소 모습 그대로다.
 *
 * 겹침은 **그려지는 자리**로 잰다(2026-10-01 수정, 사용자 보고 — 아라키초A 302 Théo Mourian 위 BLOCK).
 * 예약 막대는 체크인 칸 **가운데**에서 체크아웃 칸 **가운데**까지, 차단 막대는 첫 밤 칸부터 끝 밤 칸까지
 * **칸 전체**를 덮는다. 그래서 체크아웃 날부터 건 차단은 밤은 안 겹쳐도 **체크아웃 칸의 앞 절반에서 예약 막대
 * 끝을 덮는다.** 처음에는 밤 기준(`block.startDate < bar.checkOut`)으로 재서 그 경우를 0층에 두었고, 막대가
 * 실제로 겹쳤다. 이제 체크아웃 날도 예약이 차지한 것으로 본다(`block.startDate <= bar.checkOut`).
 * 체크인 전날에 끝나는 차단은 체크인 칸 앞 절반이 비어 있으니 그대로 겹치지 않는다. 차단끼리는 밤이 겹칠 때만.
 *
 * **순수하다** — `ops-bar-lanes.test.ts`.
 */
export type LaneBlock = {
  id: string;
  /** `YYYY-MM-DD`, 막히는 첫 밤. */
  startDate: string;
  /** `YYYY-MM-DD`, 막히는 마지막 밤(포함). */
  endDate: string;
};

export type PlacedLaneBar = { checkIn: string; checkOut: string; lane: number };

export function assignBlockLanes(
  bars: readonly PlacedLaneBar[],
  blocks: readonly LaneBlock[],
  options: {
    /**
     * 차단을 놓기 시작할 층(2026-10-06). 판매 캘린더는 **예약 층 아래**에서 시작한다 — 0층은 예약 막대와 빈 칸의 `+`
     * (수기 예약 시작)가 쓰는 줄이라, 차단이 0층에 오면 차단한 날 `+` 가 가려졌다(차단한 날도 수기 예약을 넣게 된 뒤
     * 사용자 지적 「날짜 생성하는 게 전부 가려져 버린다, 블락 칸이랑 나눠야겠다」). 기본 0 — 예전 동작.
     */
    fromLane?: number;
  } = {},
): { laneById: Map<string, number>; laneCount: number } {
  const laneById = new Map<string, number>();
  /** 층별로 이미 놓인 것의 밤 구간 `[from, toExclusive)`. */
  const lanes: Array<Array<[string, string]>> = [];
  const occupy = (lane: number, from: string, toExclusive: string) => {
    while (lanes.length <= lane) lanes.push([]);
    lanes[lane].push([from, toExclusive]);
  };
  /** 그 날 다음 날 — 구간을 반열림으로 맞춘다. */
  const dayAfter = (date: string) => {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  };
  // 예약은 **체크아웃 칸까지**(막대가 그 칸 가운데까지 그려진다) 차지한 것으로 본다.
  for (const bar of bars) occupy(bar.lane, bar.checkIn, dayAfter(bar.checkOut));

  const sorted = [...blocks].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate),
  );
  for (const block of sorted) {
    const endExclusive = dayAfter(block.endDate);
    let lane = Math.max(0, options.fromLane ?? 0);
    while (
      lane < lanes.length &&
      lanes[lane].some(([from, toExclusive]) => block.startDate < toExclusive && from < endExclusive)
    ) {
      lane += 1;
    }
    occupy(lane, block.startDate, endExclusive);
    laneById.set(block.id, lane);
  }
  return { laneById, laneCount: Math.max(lanes.length, 1) };
}
