"use client";

import { useMemo, useState, useTransition } from "react";
import {
  submitPriceChange,
  type PriceChangeCell,
} from "@/app/admin/ops/calendar/actions";
import type { PriceChangeError } from "@/app/admin/ops/calendar/actions";
import {
  outcomeText as writeOutcomeText,
  type OpsWriteOutcome,
  type OpsWriteOutcomeCopy,
  type RunOpsWrite,
} from "@/components/admin/ops/ops-write-tracker";
import {
  amountFromPercent,
  buildAdjustmentPreview,
  findAdjustmentWarnings,
  percentFromAmount,
  PERCENT_PRESETS,
  type AdjustmentInput,
} from "@/lib/ops-price-adjustment";
import {
  PriceScopeEditor,
  usePriceScope,
  type PriceScopeCopy,
  type PriceScopeRoom,
} from "@/components/admin/ops/ops-price-scope";
import type { AdminDateRangePickerLabels } from "@/components/admin/shared/admin-date-range-picker";
import "./ops-calendar-panels-white.css";

/**
 * 가격·최소숙박 조작 패널 — **격자 오른쪽 세로 카드**.
 *
 * 도메인 계약: docs/product/33-calendar-write-features.md 「조정 방식 두 가지」
 * 시안: Claude Design 「Foldy 운영 관리자 영역」 `3-select.dc.html`
 *
 * ## 왜 옆인가
 *
 * 위에 가로로 두면 그만큼 격자가 아래로 밀린다. **가격을 고칠 때야말로 객실을 아래까지 길게
 * 봐야 한다.** 옆에 두면 세로를 0 먹고, 대신 숫자·제외 목록·설명을 세로로 쌓을 수 있다.
 *
 * ## 모드 토글이 없다
 *
 * 저쪽은 `adjustMode` 로 「직접 입력」과 「퍼센트」를 갈라 놓았지만, **둘은 같은 값을 정하는
 * 두 가지 방법일 뿐**이라 한 화면에 둔다(2026-09-16 확정). 금액을 쓰면 % 배지가 계산되고,
 * 퍼센트를 누르면 금액이 채워진다.
 *
 * **적용 결과는 다르다.** 금액은 고른 칸 전부를 그 값으로, 퍼센트는 칸마다 자기 현재가
 * 기준이다. 그래서 퍼센트일 때 「변경」을 **범위**로 보여준다.
 *
 * ## 확인을 한 번 더 받는다
 *
 * 잘못 쓰면 채널에 그대로 나간다 — 0원에 팔리거나 자릿수 하나가 더 붙어 아무도 안 사는 방이
 * 된다. 막지는 않되 **무엇이 몇 칸 바뀌는지 보여주고 한 번 더 묻는다.**
 */

/** 화이트 리디자인 문구(`SpwCopy`)를 같이 싣는다 — 격자의 `Copy` 가 이 타입을 통해 받는다. */
export type PanelCopy = OpsWriteOutcomeCopy & SpwCopy & PriceScopeCopy & {
  panelTitle: string;
  panelAmount: string;
  panelPercent: string;
  panelCurrent: string;
  panelNext: string;
  panelApply: string;
  panelCancel: string;
  panelConfirm: string;
  panelConfirmBody: string;
  panelNoChange: string;
  panelIdle: string;
  panelHint: string;
  /** 선택한 칸 목록(2026-10-01) — 건물 · 객실 · 날짜 · 현재가 → 바뀔 가격. */
  panelListTitle: string;
  /** 「평균 {price}」 — 현재가가 범위일 때 그 아래 작게. */
  panelAverage: string;
  panelListNoPrice: string;
  panelListRooms: string;
  /** 「다음 · {count}칸 확인」 — 확인 단계로 넘어가는 버튼. */
  panelGo: string;
  panelTarget: string;
  panelExcluded: string;
  panelChannelNote: string;
  panelQueued: string;
  panelDone: string;
  panelFailed: string;
  errForbidden: string;
  errNoCells: string;
  errNoPricedCells: string;
  errBadMinStay: string;
  errNoWritableRoom: string;
  errInvalidValues: string;
  errEnqueueFailed: string;
  warnZero: string;
  warnDrop: string;
  warnRise: string;
  minStayTitle: string;
};

/** 패널 머리말에 뜨는 「무엇을 고치는가」. */
export type PanelScopeSummary = { rooms: string; dates: string };

export type PanelCell = {
  roomKey: string;
  roomLabel: string;
  roomIds: string[];
  date: string;
  price: number | null;
  /** 그 칸이 1박 갭인가. **가격 패널은 쓰지 않는다** — 1박 갭 고치기는 최소숙박 패널에서만(2026-10-02 사용자 지시). */
  isGap: boolean;
};

/**
 * 화이트 리디자인(2026-10-16, 시안 SalesEdit · SalesMinStay · SalesBlock · SalesNew · SalesResv -PC)이
 * 쓰는 문구. 데스크톱 패널만 받는다 — 모바일 시트가 쓰는 `PanelCopy` 등은 그대로다.
 */
export type SpwCopy = {
  localeTag: string;
  /** 「지우기」 — 모바일 가격 시트와 같은 문구. */
  mpClearInput: string;
  /** 「{n}박」 · 「{from} → {to}」 — 최소숙박 · 차단 목록. */
  minStay: string;
  change: string;
  spwKicker: string;
  spwTabPrice: string;
  spwTabMinStay: string;
  spwTabBlock: string;
  spwCells: string;
  spwCurrentAvg: string;
  spwAfter: string;
  spwAmountLabel: string;
  spwAmountHint: string;
  spwPercentLabel: string;
  spwPercentHint: string;
  spwListCount: string;
  spwBack: string;
  spwPriceConfirmKicker: string;
  spwPriceConfirmSame: string;
  spwPriceConfirmRange: string;
  spwPriceConfirmSub: string;
  spwCheckTitle: string;
  spwRowChanged: string;
  spwChangedOf: string;
  spwRowRooms: string;
  spwRowDates: string;
  spwSameValue: string;
  spwMsTitle: string;
  spwMsGapLine: string;
  spwMsCustomPh: string;
  spwNightUnit: string;
  spwMsListTitle: string;
  spwBkTitle: string;
  spwBkMemoLabel: string;
  spwBkMemoLimit: string;
  spwBkRangesTitle: string;
  spwBkGo: string;
  spwBkConfirmKicker: string;
  spwBkConfirmTitle: string;
  spwBkConfirmHead: string;
  spwBkConfirmNote: string;
  spwBkReason: string;
  spwMbKicker: string;
  spwOptional: string;
  spwMinus: string;
  spwPlus: string;
  spwNightsTotal: string;
  spwArrival: string;
  spwRcConfirmTitle: string;
  spwRcNumber: string;
  spwReKicker: string;
  spwReSub: string;
};

/** 가격 · 최소숙박 · 차단 — 같은 자리의 세 패널. */
export type SpwMode = "price" | "minstay" | "block";

/** `2026-10-16` → 「10/16 (금)」 — 도쿄 기준 요일. */
export function spwDate(date: string, localeTag: string): string {
  const weekday = new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", weekday: "short" }).format(
    new Date(`${date}T12:00:00+09:00`),
  );
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} (${weekday})`;
}

/**
 * 패널 위 「가격 · 최소숙박 · 차단」 탭(시안 `.seg`). 지금 패널이 선택된 탭이다.
 * 바꾸는 쪽(격자)이 `onSwitchMode` 를 넘길 때만 그린다 — 눌러도 아무 일 없는 탭은 두지 않는다.
 */
export function SpwModeTabs({
  copy,
  mode,
  onSwitchMode,
}: {
  copy: SpwCopy;
  mode: SpwMode;
  onSwitchMode?: (mode: SpwMode) => void;
}) {
  if (!onSwitchMode) return null;
  const tabs: { key: SpwMode; label: string }[] = [
    { key: "price", label: copy.spwTabPrice },
    { key: "minstay", label: copy.spwTabMinStay },
    { key: "block", label: copy.spwTabBlock },
  ];
  return (
    <div aria-label={copy.spwKicker} className="spw-seg" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={tab.key === mode}
          className={tab.key === mode ? "on" : undefined}
          key={tab.key}
          onClick={() => {
            if (tab.key !== mode) onSwitchMode(tab.key);
          }}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** 패널 머리 — 작은 윗줄 · 굵은 제목 · 설명(시안 공통). */
export function SpwHead({ kicker, sub, title }: { kicker: string; sub?: string | null; title: string }) {
  return (
    <div className="spw-head">
      <span className="spw-head__k">{kicker}</span>
      <b className="spw-head__t">{title}</b>
      {sub && <span className="spw-head__s">{sub}</span>}
    </div>
  );
}

const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;

/** 입력칸 표시용 — 숫자만 남겨 쉼표를 넣는다. 음수 기호는 지킨다. */
const formatAmountText = (text: string) => {
  const negative = text.trim().startsWith("-");
  const digits = text.replace(/[^\d]/g, "");
  if (!digits) return negative ? "-" : "";
  return `${negative ? "-" : ""}${Number(digits).toLocaleString("ja-JP")}`;
};

type ListRow = { date: string; current: number | null; next: number | null };
type ListRoom = { key: string; label: string; rows: ListRow[] };
type ListBuilding = { name: string; rooms: ListRoom[] };

/**
 * 고른 칸을 **건물 → 객실 → 날짜**로 묶는다. 순서는 고른 칸 순서(= 격자 행 순서) 그대로. 바뀔 가격은
 * 미리보기(`buildAdjustmentPreview`)에서 — 확인 단계와 **같은 계산**이라 목록과 실제로 나가는 값이 갈리지 않는다.
 */
function groupSelection(
  cells: readonly PanelCell[],
  nextByCell: ReadonlyMap<string, number>,
): ListBuilding[] {
  const buildings: ListBuilding[] = [];
  const buildingByName = new Map<string, ListBuilding>();
  const roomByKey = new Map<string, ListRoom>();
  for (const cell of cells) {
    const separator = cell.roomKey.indexOf("::");
    const name = separator >= 0 ? cell.roomKey.slice(0, separator) : "";
    let building = buildingByName.get(name);
    if (!building) {
      building = { name, rooms: [] };
      buildingByName.set(name, building);
      buildings.push(building);
    }
    let room = roomByKey.get(cell.roomKey);
    if (!room) {
      room = { key: cell.roomKey, label: cell.roomLabel, rows: [] };
      roomByKey.set(cell.roomKey, room);
      building.rooms.push(room);
    }
    room.rows.push({
      current: cell.price,
      date: cell.date,
      next: nextByCell.get(`${cell.roomKey}|${cell.date}`) ?? null,
    });
  }
  for (const room of roomByKey.values()) room.rows.sort((a, b) => a.date.localeCompare(b.date));
  return buildings;
}

/**
 * 선택한 칸 목록 — 시안 SalesEdit-PC: 한 줄에 **객실 · 날짜(요일) · 현재가 → 바뀔 가격**. 가로 헤어라인만.
 * 건물이 둘 이상이면 건물 이름을 작은 머리로 끊는다(방 번호만으로는 어느 건물인지 모른다).
 */
function SelectionList({
  buildings,
  cellCount,
  copy,
  showNext,
}: {
  buildings: ListBuilding[];
  cellCount: number;
  copy: PanelCopy & SpwCopy;
  showNext: boolean;
}) {
  let index = 0;
  return (
    <section aria-label={copy.panelListTitle} className="spw-list">
      <span className="spw-sec">{copy.spwListCount.replace("{n}", String(cellCount))}</span>
      {buildings.map((building) => (
        <div key={building.name}>
          {buildings.length > 1 && <div className="spw-list__bld">{building.name}</div>}
          {building.rooms.map((room) =>
            room.rows.map((row) => {
              const delta = showNext && row.current !== null && row.next !== null ? row.next - row.current : null;
              const order = index++;
              return (
                <div className="spw-row" key={`${room.key}|${row.date}`} style={{ "--i": Math.min(order, 12) } as React.CSSProperties}>
                  <span className="spw-row__room">{room.label}</span>
                  <span className="spw-row__date">{spwDate(row.date, copy.localeTag)}</span>
                  {row.current === null ? (
                    <span className="spw-row__none">{copy.panelListNoPrice}</span>
                  ) : (
                    <>
                      <span className={`spw-row__cur${delta ? " is-old" : ""}`}>{yen(row.current)}</span>
                      {delta !== null && delta !== 0 && row.next !== null && (
                        <>
                          <span aria-hidden="true" className="spw-row__arrow">→</span>
                          <b className="spw-row__next">{yen(row.next)}</b>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            }),
          )}
        </div>
      ))}
    </section>
  );
}

/** 서버가 준 **코드**를 사용자의 언어로 바꾼다. 서버는 문구를 모른다. */
function errorText(copy: PanelCopy, code: PriceChangeError): string {
  switch (code) {
    case "forbidden":
      return copy.errForbidden;
    case "no_cells":
      return copy.errNoCells;
    case "no_priced_cells":
      return copy.errNoPricedCells;
    case "bad_min_stay":
      return copy.errBadMinStay;
    case "no_writable_room":
      return copy.errNoWritableRoom;
    case "invalid_values":
      return copy.errInvalidValues;
    default:
      return copy.errEnqueueFailed;
  }
}


/** 기기 키보드의 「완료」(Enter)로 키보드를 내린다 — 모바일 시트에서 다음 버튼이 키보드에 가리지 않게(2026-10-02). */
const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") event.currentTarget.blur();
};
export function OpsPricePanel({
  cells: selectedCells,
  clearLabel,
  copy,
  onApplied,
  onClear,
  onFinished,
  onSwitchMode,
  pickerLabels,
  priceAt,
  rooms,
  runWrite,
  scopeSummary: selectionSummary,
  today,
}: {
  /** 격자에서 고른 칸 — 범위의 처음 값. 패널에서 기간 · 요일 · 객실을 고치면 그 범위로 바뀐다(`usePriceScope`). */
  cells: PanelCell[];
  clearLabel: string;
  copy: PanelCopy & SpwCopy;
  /** 쓰기가 반영된 **뒤** 보낸 칸만 선택에서 뺀다(2026-09-30 버그) — 전체를 비우는 `onClear`
   * 와 달리, 왕복하는 동안 사람이 새로 고른 칸은 건드리지 않는다. */
  onApplied: (sentCells: { roomKey: string; date: string }[]) => void;
  onClear: () => void;
  /** 저장이 접수된 뒤(성공) — 모바일 시트가 스스로 닫히는 데 쓴다(2026-10-02). 데스크톱은 넘기지 않는다. */
  onFinished?: () => void;
  /** 패널 위 「가격 · 최소숙박 · 차단」 탭(2026-10-16 화이트 리디자인). 넘겨야 탭이 그려진다. */
  onSwitchMode?: (mode: SpwMode) => void;
  /** 격자가 흐린 값 → 접수 → 반영 대기 → 데이터 다시 받기를 맡는다(`ops-write-tracker.ts`). */
  /** 공용 범위 달력 문구(`dictionary.admin.shared`). */
  pickerLabels: AdminDateRangePickerLabels;
  /** 격자가 아는 지금 가격 — 격자 창 밖이면 `undefined`(서버에서 읽는다). */
  priceAt: (roomKey: string, date: string) => number | null | undefined;
  /** 범위에 넣을 수 있는 객실(격자 행). */
  rooms: readonly PriceScopeRoom[];
  runWrite: RunOpsWrite;
  scopeSummary: PanelScopeSummary | null;
  today: string;
}) {
  const scope = usePriceScope({
    andMore: copy.andMore,
    cells: selectedCells,
    priceAt,
    rooms,
    summary: selectionSummary,
    today,
  });
  const cells = scope.cells;
  const scopeSummary = scope.summary;
  const [input, setInput] = useState<AdjustmentInput | null>(null);
  const [amountText, setAmountText] = useState("");
  const [percentText, setPercentText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = useMemo(
    () =>
      buildAdjustmentPreview(
        cells.map((cell) => ({
          date: cell.date,
          price: cell.price,
          roomKey: cell.roomKey,
          roomLabel: cell.roomLabel,
        })),
        input ?? { amount: 0, kind: "amount" },
      ),
    [cells, input],
  );

  /** 목록용 — 칸별 바뀔 가격. 입력이 없으면 비어 있다(현재가만 보인다). */
  const listBuildings = useMemo(() => {
    const nextByCell = new Map<string, number>();
    if (input) for (const row of preview.rows) nextByCell.set(`${row.roomKey}|${row.date}`, row.newPrice);
    return groupSelection(cells, nextByCell);
  }, [cells, input, preview]);

  const warnings = useMemo(
    () => (input ? findAdjustmentWarnings(preview) : []),
    [input, preview],
  );
  /**
   * 현재가의 **범위**. 건물마다 가격대가 달라 평균 하나로는 「지금 얼마인가」가 안 읽힌다(2026-10-01 사용자) —
   * 값이 갈리면 최저 ~ 최고를 크게, 평균은 작게 적는다.
   */
  const currentRange = useMemo(() => {
    if (preview.rows.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const row of preview.rows) {
      if (row.currentPrice < min) min = row.currentPrice;
      if (row.currentPrice > max) max = row.currentPrice;
    }
    return { max, min };
  }, [preview]);
  /** 현재 평균 대비 몇 %인가. 금액을 직접 썼을 때 배지로 보여준다. */
  const deltaPercent =
    input && preview.rows.length > 0
      ? percentFromAmount(preview.currentAverage, preview.newAverage)
      : null;

  /** 금액을 쓰면 % 배지가 따라온다 — 모드 토글을 없앤 대가다. */
  const onAmount = (text: string) => {
    setAmountText(text);
    const amount = Number.parseInt(text.replace(/[^\d-]/g, ""), 10);
    if (!Number.isFinite(amount)) {
      setInput(null);
      setPercentText("");
      return;
    }
    setInput({ amount, kind: "amount" });
    const percent = percentFromAmount(preview.currentAverage, amount);
    setPercentText(percent === null ? "" : String(percent));
  };

  /** 퍼센트를 누르거나 쓰면 금액칸이 **평균 기준으로** 채워진다(적용은 칸마다 다르다). */
  const onPercent = (value: number) => {
    setPercentText(String(value));
    setInput({ kind: "percent", percent: value });
    const amount = amountFromPercent(preview.currentAverage, value);
    setAmountText(amount === null ? "" : String(amount));
  };

  /** 입력만 비운다(선택은 그대로). */
  const clearInput = () => {
    setInput(null);
    setAmountText("");
    setPercentText("");
  };

  const reset = () => {
    setInput(null);
    setAmountText("");
    setPercentText("");
    setConfirming(false);
  };

  const toRequestCells = (): PriceChangeCell[] =>
    cells.map((cell) => ({
      currentPrice: cell.price,
      date: cell.date,
      roomIds: cell.roomIds,
      roomKey: cell.roomKey,
      roomLabel: cell.roomLabel,
    }));

  /**
   * 「반영 완료」는 **Beds24 에 실제로 들어간 뒤에** 띄운다. 예전에는 접수만 되면 바로 「반영
   * 완료」라고 했는데, 그때는 아직 큐에 있을 뿐이었다(2026-09-28).
   */
  const reportSettled = (settled: Promise<OpsWriteOutcome> | null) => {
    void settled?.then((outcome) => setMessage(writeOutcomeText(copy.panelDone, copy, outcome)));
  };

  const apply = () => {
    if (!input) return;
    const rows = preview.rows;
    const cellsToSend = toRequestCells();
    const sentInput = input;
    setMessage(copy.panelQueued);
    setConfirming(false);
    startTransition(async () => {
      // 흐린 새 값은 격자가 **보내기 전에** 그린다(저쪽도 같은 이유로 낙관적 표시를 앞으로 당겼다).
      const { result, settled } = await runWrite(
        "price",
        rows.map((row) => ({ key: `${row.roomKey}|${row.date}`, value: row.newPrice })),
        () => submitPriceChange({ cells: cellsToSend, input: sentInput }),
      );
      if (!result.ok) {
        setMessage(copy.panelFailed.replace("{error}", errorText(copy, result.error)));
        return;
      }
      reset();
      // **보낸 칸만** 선택에서 뺀다(2026-09-30 버그) — 왕복하는 동안 새로 고른 칸까지
      // 통째로 비우면 안 된다. 결과 문구(반영됨·실패)는 패널에 그대로 남는다.
      onApplied(cellsToSend.map((cell) => ({ date: cell.date, roomKey: cell.roomKey })));
      reportSettled(settled);
      onFinished?.();
    });
  };

  const warningText = (warning: string) =>
    warning === "zero" ? copy.warnZero : warning === "huge_drop" ? copy.warnDrop : copy.warnRise;

  const hasSelection = preview.rows.length > 0;
  const percentLabel = (value: number) => (value > 0 ? `+${value}%` : `${String(value).replace("-", "−")}%`);
  const nextLabel =
    deltaPercent !== null ? `${copy.spwAfter} · ${deltaPercent > 0 ? "+" : ""}${deltaPercent}%` : copy.spwAfter;

  /** 경고에 걸린 칸 하나 — 확인 상자에 「어느 칸이 얼마로」를 적는다(시안 SalesPriceConfirm-PC). */
  const warnedRow = (warning: string) =>
    preview.rows.find((row) =>
      warning === "zero"
        ? row.newPrice <= 0
        : warning === "huge_drop"
          ? row.newPrice < row.currentPrice * 0.5
          : row.newPrice > row.currentPrice * 3,
    ) ?? null;

  // ── 확인 단계 ── 무엇이 몇 칸 얼마로 바뀌는지 보여주고 한 번 더 묻는다. 탭 · 입력은 숨긴다.
  if (confirming) {
    const sameValue = preview.newMin === preview.newMax;
    const currentText =
      currentRange && currentRange.min !== currentRange.max
        ? `${yen(currentRange.min)} – ${yen(currentRange.max)} · ${copy.panelAverage.replace("{price}", yen(preview.currentAverage))}`
        : yen(preview.currentAverage);
    const nextText = sameValue
      ? `${yen(preview.newMin)} · ${copy.spwSameValue}`
      : `${yen(preview.newMin)} – ${yen(preview.newMax)} · ${copy.spwPercentHint}`;
    return (
      <aside aria-label={copy.panelTitle} className="opsp spw">
        <div className="spw-body spw-anim" key="confirm">
          <SpwHead
            kicker={copy.spwPriceConfirmKicker}
            sub={copy.spwPriceConfirmSub}
            title={
              sameValue
                ? copy.spwPriceConfirmSame.replace("{count}", String(preview.changedCount)).replace("{price}", yen(preview.newMin))
                : copy.spwPriceConfirmRange.replace("{count}", String(preview.changedCount))
            }
          />
          {warnings.map((warning) => {
            const row = warnedRow(warning);
            return (
              <div className="spw-alert" key={warning} role="alert">
                <b>{copy.spwCheckTitle.replace("{warning}", warningText(warning))}</b>
                {row && (
                  <span>
                    {row.roomLabel} {spwDate(row.date, copy.localeTag)} {yen(row.currentPrice)} → {yen(row.newPrice)}
                  </span>
                )}
              </div>
            );
          })}
          <dl className="spw-kv">
            <div>
              <dt>{copy.spwRowChanged}</dt>
              <dd>
                {copy.spwChangedOf
                  .replace("{total}", String(preview.rows.length))
                  .replace("{n}", String(preview.changedCount))}
              </dd>
            </div>
            <div>
              <dt>{copy.panelCurrent}</dt>
              <dd>{currentText}</dd>
            </div>
            <div>
              <dt>{copy.panelNext}</dt>
              <dd>{nextText}</dd>
            </div>
            {scopeSummary && (
              <>
                <div>
                  <dt>{copy.spwRowRooms}</dt>
                  <dd>{scopeSummary.rooms}</dd>
                </div>
                <div>
                  <dt>{copy.spwRowDates}</dt>
                  <dd>{scopeSummary.dates}</dd>
                </div>
              </>
            )}
          </dl>
          {preview.skippedNoPrice > 0 && (
            <p className="spw-note">{copy.panelExcluded.replace("{count}", String(preview.skippedNoPrice))}</p>
          )}
          <p className="spw-note">{copy.panelChannelNote}</p>
        </div>
        <div className="spw-foot">
          <button className="spw-btn" onClick={() => setConfirming(false)} type="button">
            {copy.spwBack}
          </button>
          {/* 버튼은 짧게 — 「몇 칸 반영」만(2026-09-29 사용자 요청). 채널로 그대로 나가므로 빨강. */}
          <button className="spw-btn is-danger" disabled={pending} onClick={apply} type="button">
            {copy.panelConfirmBody.replace("{count}", String(preview.changedCount))}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside aria-label={copy.panelTitle} className="opsp spw">
      <div className="spw-body">
        {/* **무엇을 고치는가**를 먼저 적는다. 「9칸」만으로는 어느 방 어느 날인지 모른 채
            적용하게 되는데, 가격은 채널로 그대로 나간다. */}
        <SpwHead
          kicker={copy.spwKicker}
          sub={scopeSummary ? copy.spwCells.replace("{dates}", scopeSummary.dates).replace("{n}", String(cells.length)) : null}
          title={scopeSummary ? scopeSummary.rooms : copy.panelIdle}
        />
        <SpwModeTabs copy={copy} mode="price" onSwitchMode={onSwitchMode} />
        {/* 범위 — 기간 · 요일 · 객실을 여기서 고친다(2026-10-20, Beds24 와 같이). 처음 값은 격자에서 고른 칸. */}
        <PriceScopeEditor
          copy={copy}
          localeTag={copy.localeTag}
          pickerLabels={pickerLabels}
          rooms={rooms}
          state={scope}
          today={today}
          variant="desktop"
        />

        {/* 현재 평균 → 변경. 무엇을 바꾸는지 모르고 누르는 일을 막는 것이 확인 단계의 전부다. */}
        <div className="spw-compare">
          <div>
            <span className="spw-compare__l">{copy.spwCurrentAvg}</span>
            {hasSelection && currentRange && currentRange.min !== currentRange.max ? (
              <>
                <b className="spw-compare__v is-cur is-range">
                  {yen(currentRange.min)}
                  <span>~ {yen(currentRange.max)}</span>
                </b>
                <span className="spw-compare__avg">{copy.panelAverage.replace("{price}", yen(preview.currentAverage))}</span>
              </>
            ) : (
              <b className="spw-compare__v is-cur">{hasSelection ? yen(preview.currentAverage) : "—"}</b>
            )}
          </div>
          <span aria-hidden="true" className="spw-compare__arrow">→</span>
          <div>
            <span className={`spw-compare__l${deltaPercent !== null && deltaPercent < 0 ? " is-dn" : ""}`}>{nextLabel}</span>
            {/* 퍼센트는 칸마다 결과가 달라 **범위**로 쓴다. */}
            {input && hasSelection && preview.newMin !== preview.newMax ? (
              <b className="spw-compare__v is-next is-range" key={`${preview.newMin}-${preview.newMax}`}>
                {yen(preview.newMin)}
                <span>~ {yen(preview.newMax)}</span>
              </b>
            ) : (
              <b className="spw-compare__v is-next" key={input && hasSelection ? preview.newMin : "none"}>
                {input && hasSelection ? yen(preview.newMin) : "—"}
              </b>
            )}
          </div>
        </div>

        {/* 금액과 퍼센트는 같은 값을 정하는 **두 가지 방법**이라 한 덩어리로 둔다. */}
        <div className="spw-amount">
          <div className="spw-field">
            <span className="spw-field__l">{copy.spwAmountLabel}</span>
            <label className="spw-field__box is-money">
              <span aria-hidden="true" className="spw-field__unit">¥</span>
              <input
                aria-label={copy.panelAmount}
                autoComplete="off"
                disabled={!hasSelection}
                enterKeyHint="done"
                inputMode="numeric"
                onChange={(event) => onAmount(event.target.value)}
                onKeyDown={blurOnEnter}
                placeholder={hasSelection ? formatAmountText(String(Math.round(preview.currentAverage))) : ""}
                // 천 단위 쉼표 — 「46600」보다 「46,600」이 한눈에 읽힌다. 파싱은 숫자만 본다(`onAmount`).
                value={formatAmountText(amountText)}
              />
            </label>
          </div>
          {/* 퍼센트 직접 입력 — 프리셋에 없는 값(예: +7%)도 쓴다. */}
          <label className="spw-field__box is-pct">
            <input
              aria-label={copy.panelPercent}
              autoComplete="off"
              disabled={!hasSelection}
              enterKeyHint="done"
              inputMode="numeric"
              onChange={(event) => {
                const value = Number.parseInt(event.target.value.replace(/[^\d-]/g, ""), 10);
                if (Number.isFinite(value)) onPercent(value);
                else {
                  setPercentText(event.target.value);
                  setInput(null);
                }
              }}
              onKeyDown={blurOnEnter}
              placeholder="±"
              value={percentText}
            />
            <span aria-hidden="true" className="spw-field__unit">%</span>
          </label>
          <span className="spw-amount__hint">{copy.spwAmountHint}</span>
        </div>

        <div className="spw-pcts">
          <div className="spw-pcts__h">
            <span className="spw-label">{copy.spwPercentLabel}</span>
            <span className="spw-pcts__hint">{copy.spwPercentHint}</span>
          </div>
          <div className="spw-pcts__grid">
            {PERCENT_PRESETS.map((preset) => {
              const on = input?.kind === "percent" && input.percent === preset;
              return (
                <button
                  aria-pressed={on}
                  className={`spw-chip${on ? " on" : ""}`}
                  disabled={!hasSelection}
                  key={preset}
                  // 같은 프리셋을 다시 누르면 푼다(2026-10-01 사용자 요청) — 입력도 같이 비운다.
                  onClick={() => (on ? clearInput() : onPercent(preset))}
                  type="button"
                >
                  {percentLabel(preset)}
                </button>
              );
            })}
            <button
              className="spw-chip is-quiet"
              disabled={!hasSelection || (input === null && amountText === "" && percentText === "")}
              onClick={clearInput}
              type="button"
            >
              {copy.mpClearInput}
            </button>
          </div>
        </div>

        {/* 채널 규칙을 화면에 적어 둔다 — 「왜 부킹닷컴은 안 바뀌지?」가 나오지 않게. */}
        <p className="spw-note">{copy.panelChannelNote}</p>

        {/* 빠진 칸은 **개수가 아니라 이유**를 적는다 — 「아, 502호가 블록이었지」가 되어야 한다. */}
        {preview.skippedNoPrice > 0 && (
          <p className="spw-note is-warn">{copy.panelExcluded.replace("{count}", String(preview.skippedNoPrice))}</p>
        )}
        {input !== null && preview.changedCount === 0 && <p className="spw-note is-warn">{copy.panelNoChange}</p>}
        {warnings.map((warning) => (
          <p className="spw-note is-danger" key={warning}>
            {warningText(warning)}
          </p>
        ))}

        {/* 「무엇이 얼마로 바뀌는지」 목록(2026-10-01 사용자 요청). 패널 본문 안에서 넘긴다. */}
        {cells.length > 0 && (
          <SelectionList buildings={listBuildings} cellCount={cells.length} copy={copy} showNext={input !== null} />
        )}

        {message && (
          <p className="spw-msg" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="spw-foot">
        <button
          className="spw-btn"
          disabled={!hasSelection}
          // 적어 둔 금액도 같이 비운다 — 남겨 두면 다음에 고른 칸에 그 값이 그대로 걸린다.
          onClick={() => {
            reset();
            setMessage(null);
            onClear();
          }}
          title="Esc"
          type="button"
        >
          {clearLabel}
        </button>
        <button
          className="spw-btn is-primary"
          // 격자 밖 칸의 지금 가격을 아직 못 읽었으면 기다린다 — 모른 채 넘기면 그 칸이 「요금 없음」으로 빠져 보인다.
          disabled={!input || preview.changedCount === 0 || pending || scope.loading || scope.failed}
          onClick={() => setConfirming(true)}
          type="button"
        >
          {copy.panelGo.replace("{count}", String(preview.changedCount))}
        </button>
      </div>
    </aside>
  );
}
