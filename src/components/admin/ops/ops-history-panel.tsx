"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadOpsChangeHistory,
  revertBeds24Change,
  revertBlockChange,
  revertPriceJob,
  sendPendingPriceJobs,
} from "@/actions/ops-calendar";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { fetchOpsSendLog } from "@/components/admin/ops/ops-reads";
import {
  appendChangeGroups,
  collapseCellRuns,
  describeSendFailure,
  isSendStalled,
  localizeSendDetail,
  SEND_STALL_MINUTES,
  type ChangeField,
  type ChangeGroup,
  type SendEntry,
  type ValueRange,
} from "@/lib/ops-history";
import { haptic } from "@/lib/haptics";
import { formatHistoryWhen } from "@/lib/ops-price-history";
import "./ops-calendar-tools-white.css";
import { useBuildingName, useRoomPlaceLabel } from "@/components/shared/building-names";

/**
 * 판매 캘린더 「이력」 — 오른쪽 사이드 패널, 탭 둘.
 *
 * 도메인 계약: `docs/product/33-calendar-write-features.md` → 「이력 · 전송 로그」
 *
 * - **변경 이력**: 수정 한 번 = 한 줄(우리 앱 + Beds24 에서 바뀐 것). 7일씩 거슬러 읽는다.
 * 상태·종류 수식 클래스는 **전부 `is-*`** 다 — `app`·`block` 같은 맨 이름은 콘솔 셸(`.adm .app`)·
 * Tailwind(`.block`)와 겹쳐 레이아웃이 통째로 깨졌다(2026-09-29).
 *
 * - **Beds24 전송**: 가격·최소숙박 작업과 차단 — 반영됨 · 일부 실패 · 실패 · 대기 · 보내는 중,
 *   실패한 객실과 사유. 대기가 `SEND_STALL_MINUTES` 를 넘으면 「안 나감」으로 빨갛게 세우고
 *   「지금 보내기」를 준다. 대기·진행 중인 줄이 있으면 몇 초마다 다시 읽는다.
 *   Beds24 쿨다운(429 · 크레딧 부족)으로 기다리는 대기는 멈춘 게 아니라서 주황 「Beds24 한도 대기」와
 *   사유 · 자동 재전송 시각으로 보여준다(`isSendStalled` 가 빼 준다).
 *
 * 화이트 리디자인(2026-10-16, 시안 SalesHistory · SalesSend): 줄 하나 = 「종류 · 객실(외 N)」 + 오른쪽 상태 글자,
 * 값 줄, 누가 · 언제 + 오른쪽 글자 동작(칸 보기 · 되돌리기). 모양은 `ops-calendar-tools-white.css` 의 `stw-*`.
 * PC 옆 패널과 모바일 하단 시트(`mobile-ops-calendar.tsx` 의 `.mops-side`)가 같은 마크업을 쓴다.
 */

export type HistoryPanelCopy = {
  hsTitle: string;
  hsButton: string;
  hsSendTitle: string;
  hsChangesSub: string;
  hsSendSub: string;
  hsAlertCount: string;
  hsRoomsMore: string;
  hsFromBeds24: string;
  hsTabChanges: string;
  hsTabSend: string;
  hsSourceApp: string;
  hsSourceBeds24: string;
  hsCells: string;
  hsRooms: string;
  hsMore: string;
  hsMoreSend: string;
  hsEmptyWindow: string;
  hsEmptySend: string;
  hsTruncated: string;
  hsLoadFailed: string;
  hsRetry: string;
  hsShowCells: string;
  hsRevert: string;
  hsRevertAsk: string;
  hsRevertAskBeds24: string;
  hsRevertConfirm: string;
  hsRevertDone: string;
  hsRevertSkipped: string;
  hsRevertNothing: string;
  hsRevertFailed: string;
  panelCancel: string;
  bkPending: string;
  hsHideCells: string;
  hsCellsMore: string;
  hsDays: string;
  hsKindPrice: string;
  hsKindMinStay: string;
  hsKindBlock: string;
  hsKindUnblock: string;
  hsBlockOn: string;
  hsBlockOff: string;
  hsStatusQueued: string;
  hsStatusProcessing: string;
  hsStatusSucceeded: string;
  hsStatusPartial: string;
  hsStatusFailed: string;
  hsStalled: string;
  hsSendNow: string;
  hsSending: string;
  hsFinished: string;
  /** Beds24 쿨다운(429 · 크레딧 부족) 대기 — 배지, 사유 둘, `{time}` 이후 재전송, 곧 재전송. */
  hsStatusCooldown: string;
  hsWaitRateLimit: string;
  hsWaitLowCredit: string;
  hsWaitRetryAt: string;
  hsWaitRetrySoon: string;
  hsReasons: Record<string, string>;
  /** 가격·최소숙박 작업의 객실별 실패 코드 → 문구(`describeSendFailure`). `{n}` · `{status}` 자리표시. */
  hsFailures: Record<string, string>;
  /** 되읽기 불일치 첫 건 — `{date}` · `{expected}` · `{actual}`. */
  hsFailSample: string;
  /** 「지금 보내기」 결과 — `sent` · `empty` · `cooldown`({n}초) · `lock_busy` · `lock_error` · `failed` · `forbidden`. */
  hsSendResult: Record<string, string>;
  minStay: string;
  unknownUser: string;
  rcClose: string;
};

const POLL_MS = 4_000;
const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
const shortDate = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;

/** 한 값 — 가격 ¥, 최소숙박 N박, 차단 1 = 차단 · 0 = 열림. */
function formatValue(value: number, field: ChangeField, copy: HistoryPanelCopy): string {
  if (field === "minStay") return copy.minStay.replace("{n}", String(value));
  if (field === "block") return value === 1 ? copy.hsBlockOn : copy.hsBlockOff;
  return yen(value);
}

function formatRange(range: ValueRange, field: ChangeField, copy: HistoryPanelCopy): string {
  if (!range) return "—";
  const one = (value: number) => formatValue(value, field, copy);
  return range.min === range.max ? one(range.min) : `${one(range.min)}~${one(range.max)}`;
}

function dateSpan(from: string | null, to: string | null): string {
  if (!from || !to) return "";
  return from === to ? shortDate(from) : `${shortDate(from)}–${shortDate(to)}`;
}

/**
 * 「가부키초 202, 203, 302 · 9개 객실」 — 건물 이름은 **건물마다 한 번**. 방은 앞 3개까지.
 * `rooms` 는 `건물 방` 문자열이다(건물 이름에 공백이 있을 수 있어 **마지막** 공백으로 가른다).
 */
function roomsText(rooms: string[], copy: HistoryPanelCopy): string {
  const shown = rooms.slice(0, 3);
  const byProperty = new Map<string, string[]>();
  for (const name of shown) {
    const cut = name.lastIndexOf(" ");
    const property = cut > 0 ? name.slice(0, cut) : "";
    const room = cut > 0 ? name.slice(cut + 1) : name;
    byProperty.set(property, [...(byProperty.get(property) ?? []), room]);
  }
  const text = [...byProperty]
    .map(([property, list]) => [property, list.join(", ")].filter(Boolean).join(" "))
    .join(" / ");
  return rooms.length > shown.length ? `${text} · ${copy.hsRooms.replace("{n}", String(rooms.length))}` : text;
}

const kindOf = (field: ChangeField, copy: HistoryPanelCopy) =>
  field === "minStay" ? copy.hsKindMinStay : field === "block" ? copy.hsKindBlock : copy.hsKindPrice;

/**
 * 펼친 칸 표 — 방(번호순)마다, 이어진 날짜가 같은 값이면 한 줄(`collapseCellRuns`).
 * 건물이 하나뿐인 수정이면 건물 이름을 줄마다 되풀이하지 않는다(머리 줄에 이미 있다).
 */
/**
 * 되돌릴 수 있는 줄 — 우리 앱의 **큐 작업**(가격·최소숙박), **앱에서 건 · 푼 차단**(`block:<시각>`, 2026-10-02), **Beds24 에서
 * 바뀐 묶음**.
 */
function isRevertibleGroup(group: ChangeGroup) {
  // Beds24 에서 바뀐 묶음(`beds24:<시각>`)도 된다 — 가격 · 최소숙박 · 차단 전부(2026-10-01 사용자 요청).
  if (group.source === "beds24") return group.id.startsWith("beds24:");
  // 앱 차단 · 차단 해제 — 한 번 누른 것이 같은 시각 한 줄(2026-10-02 사용자 요청 「블락 해제 되돌리기」).
  if (group.id.startsWith("block:")) return true;
  return (
    /^[0-9a-f-]{36}$/i.test(group.id) &&
    group.fields.some((summary) => summary.field === "price" || summary.field === "minStay")
  );
}

function CellRunsTable({ copy, group }: { copy: HistoryPanelCopy; group: ChangeGroup }) {
  const bName = useBuildingName();
  const bRoom = useRoomPlaceLabel();
  const runs = collapseCellRuns(group.cells);
  const singleProperty = new Set(runs.map((run) => run.property)).size <= 1;
  const show = (value: number | null, field: ChangeField) => (value === null ? "—" : formatValue(value, field, copy));
  const multiField = group.fields.length > 1;
  return (
    <table className="stw-cells">
      <tbody>
        {runs.map((run) => (
          <tr key={`${run.property}-${run.room}-${run.field}-${run.dateFrom}`}>
            <th scope="row">
              {singleProperty ? bRoom(run.room) : [run.property ? bName(run.property) : "", run.room].filter(Boolean).join(" ")}
              {multiField && <span className="stw-cells__kind">{kindOf(run.field, copy)}</span>}
            </th>
            <td className="stw-cells__date">
              {dateSpan(run.dateFrom, run.dateTo)}
              {run.nights > 1 && <span className="stw-cells__days">{copy.hsDays.replace("{n}", String(run.nights))}</span>}
            </td>
            <td className="stw-cells__val">
              <s>{show(run.from, run.field)}</s>
              <span aria-hidden="true"> → </span>
              <b>{show(run.to, run.field)}</b>
            </td>
          </tr>
        ))}
      </tbody>
      {group.cellCount > group.cells.length && (
        <tfoot>
          <tr>
            <td colSpan={3}>{copy.hsCellsMore.replace("{n}", String(group.cellCount - group.cells.length))}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** 「가부키초 202 외 4」 — 줄 머리용 짧은 객실 표기. 전체는 `roomsText` 로 `title` 에 둔다. */
function compactRooms(rooms: string[], copy: HistoryPanelCopy): string {
  if (rooms.length === 0) return "";
  if (rooms.length === 1) return rooms[0];
  return copy.hsRoomsMore.replace("{first}", rooms[0]).replace("{n}", String(rooms.length - 1));
}

/** 「¥41,980 → ¥44,080 (+5%)」 — 한 종류의 바뀐 값. 앞뒤가 한 값이고 가격이면 % 를 붙인다(같은 두 값에서 계산). */
function changeText(summary: ChangeGroup["fields"][number], copy: HistoryPanelCopy): string {
  const text = `${formatRange(summary.from, summary.field, copy)} → ${formatRange(summary.to, summary.field, copy)}`;
  const { from, to } = summary;
  if (summary.field !== "price" || !from || !to || from.min !== from.max || to.min !== to.max || from.min <= 0) return text;
  const pct = Math.round(((to.min - from.min) / from.min) * 1000) / 10;
  if (pct === 0) return text;
  return `${text} (${pct > 0 ? "+" : "−"}${Math.abs(pct)}%)`;
}

/** 「10-16 10:42」 → 「10/16 10:42」. */
const whenText = (at: string) => formatHistoryWhen(at).replace(/^(\d\d)-(\d\d)/, "$1/$2");

type Loadable<T> = { status: "idle" | "loading" | "ready" | "error"; data: T };

type ChangesState = Loadable<{
  groups: ChangeGroup[];
  nextBefore: string | null;
  windowFrom: string | null;
  truncated: boolean;
}>;

/** 한 쪽을 받은 뒤의 상태. `before` 가 있으면 「더 보기」 — 붙인다(갈라진 수정은 합친다). */
function applyChanges(
  previous: ChangesState,
  result: Awaited<ReturnType<typeof loadOpsChangeHistory>>,
  before: string | null,
): ChangesState {
  if (!result.ok) return { ...previous, status: "error" };
  return {
    data: {
      groups: before ? appendChangeGroups(previous.data.groups, result.groups) : result.groups,
      nextBefore: result.nextBefore,
      truncated: previous.data.truncated || result.truncated,
      windowFrom: result.windowFrom,
    },
    status: "ready",
  };
}

/** `canWrite` — 판매 캘린더를 바꿀 수 있나(`ops_calendar.write`). 없으면 되돌리기 · 지금 보내기를 숨긴다(기록은 본다, 서버도 막는다). */
export function OpsHistoryPanel({ canWrite = true, copy, onClose }: { canWrite?: boolean; copy: HistoryPanelCopy; onClose: () => void }) {
  const bRoom = useRoomPlaceLabel();
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { quietRestore: true });
  const [tab, setTab] = useState<"changes" | "send">("changes");

  // ── 변경 이력
  const [changes, setChanges] = useState<ChangesState>({ data: { groups: [], nextBefore: null, truncated: false, windowFrom: null }, status: "loading" });
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  /** 되돌리기 — 묻는 중 · 보내는 중 · 결과. 작업(그룹)마다 따로. */
  const [reverts, setReverts] = useState<
    Record<string, "ask" | "pending" | { text: string; tone: "ok" | "warn" }>
  >({});

  // 「불러오는 중」 표시는 **부르는 쪽**이 켠다(버튼 · 첫 상태) — 이펙트 안에서 바로 상태를 바꾸지 않는다.
  const loadChanges = useCallback(async (before: string | null) => {
    const result = await loadOpsChangeHistory({ before });
    setChanges((previous) => applyChanges(previous, result, before));
  }, []);

  // ── Beds24 전송
  const [sends, setSends] = useState<Loadable<{ entries: SendEntry[]; nextBefore: string | null }>>({
    data: { entries: [], nextBefore: null },
    status: "idle",
  });
  const [kicking, setKicking] = useState(false);
  const [sendResult, setSendResult] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const sendPagesRef = useRef(1);

  const loadSends = useCallback(async (before: string | null) => {
    const result = await fetchOpsSendLog({ before });
    if (!result.ok) {
      setSends((previous) => ({ ...previous, status: "error" }));
      return;
    }
    setSends((previous) => ({
      data: {
        entries: before ? [...previous.data.entries, ...result.entries] : result.entries,
        nextBefore: result.nextBefore,
      },
      status: "ready",
    }));
  }, []);

  // 처음엔 변경 이력만 읽는다. 전송 탭은 처음 누를 때 읽는다 — 안 보는 탭까지 미리 읽을 이유가 없다.
  useEffect(() => {
    let alive = true;
    void loadOpsChangeHistory({ before: null }).then((result) => {
      if (!alive) return;
      setChanges((previous) => applyChanges(previous, result, null));
    });
    return () => {
      alive = false;
    };
  }, []);
  const openSendTab = () => {
    setTab("send");
    if (sends.status === "idle") {
      setSends((previous) => ({ ...previous, status: "loading" }));
      void loadSends(null);
    }
  };
  const reloadChanges = (before: string | null) => {
    setChanges((previous) => ({ ...previous, status: "loading" }));
    void loadChanges(before);
  };
  const reloadSends = (before: string | null) => {
    setSends((previous) => ({ ...previous, status: "loading" }));
    void loadSends(before);
  };

  // 대기·진행 중인 줄이 있으면 첫 쪽을 몇 초마다 다시 읽는다 — 「나갔나?」를 새로고침 없이 본다.
  const hasActive = sends.data.entries.some((entry) => entry.status === "queued" || entry.status === "processing");
  useEffect(() => {
    if (tab !== "send" || !hasActive || sendPagesRef.current > 1) return;
    const timer = window.setInterval(() => void loadSends(null), POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasActive, loadSends, tab]);

  // Beds24 한도 대기(`waitReason`)는 멈춘 게 아니다 — 빨간 띠 · 탭 점에 넣지 않는다.
  const stalled = sends.data.entries.some(isSendStalled);
  /** 빨간 알림 줄 — 읽어 온 줄 중 실패 · 일부 실패 · 멈춤(한도 대기는 뺀다). */
  const troubleCount = sends.data.entries.filter(
    (entry) => entry.status === "failed" || entry.status === "partial" || isSendStalled(entry),
  ).length;

  // 첫 작업은 서버가 기다렸다 결과를 준다 — 반응이 없는 것처럼 보이면 사람은 계속 누른다.
  const sendNow = async () => {
    setKicking(true);
    setSendResult(null);
    const result = await sendPendingPriceJobs();
    const text = (copy.hsSendResult[result.outcome] ?? copy.hsSendResult.failed).replace(
      "{n}",
      String(result.cooldownSec ?? 0),
    );
    const ok = result.outcome === "sent" || result.outcome === "empty";
    if (ok) haptic("success");
    setSendResult({ text, tone: ok ? "ok" : "warn" });
    await loadSends(null);
    setKicking(false);
  };

  // 되돌리기 — 서버가 「그 뒤에 다시 바뀐 칸」을 걸러 낸다. 결과는 그 줄에 남기고 전송 로그를 다시 읽는다.
  const runRevert = async (jobId: string) => {
    setReverts((previous) => ({ ...previous, [jobId]: "pending" }));
    const result = jobId.startsWith("beds24:")
      ? await revertBeds24Change({ at: jobId.slice("beds24:".length) })
      : jobId.startsWith("block:")
        ? await revertBlockChange({ at: jobId.slice("block:".length) })
        : await revertPriceJob({ jobId });
    let next: { text: string; tone: "ok" | "warn" };
    if (result.ok) {
      const done = copy.hsRevertDone.replace("{n}", String(result.cells));
      next = {
        text: result.skippedChanged > 0 ? `${done} ${copy.hsRevertSkipped.replace("{n}", String(result.skippedChanged))}` : done,
        tone: "ok",
      };
      haptic("success");
    } else {
      next = { text: result.error === "nothing_to_revert" ? copy.hsRevertNothing : copy.hsRevertFailed, tone: "warn" };
    }
    setReverts((previous) => ({ ...previous, [jobId]: next }));
    await loadSends(null);
  };

  const kindLabel = (entry: SendEntry) =>
    entry.kind === "minStay"
      ? copy.hsKindMinStay
      : entry.kind === "block"
        ? copy.hsKindBlock
        : entry.kind === "unblock"
          ? copy.hsKindUnblock
          : copy.hsKindPrice;
  const statusLabel = (entry: SendEntry) =>
    ({
      failed: copy.hsStatusFailed,
      partial: copy.hsStatusPartial,
      processing: copy.hsStatusProcessing,
      queued: copy.hsStatusQueued,
      succeeded: copy.hsStatusSucceeded,
    })[entry.status];
  const toggleCells = (id: string) =>
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside aria-label={copy.hsTitle} aria-modal="true" className="panel stw-panel stw-hs" ref={panelRef} role="dialog" tabIndex={-1}>
        <div className="panel__h stw-h">
          <div className="stw-h__row">
            <div className="stw-h__txt">
              <span className="stw-h__kicker">{copy.hsButton}</span>
              <b className="stw-h__title">{tab === "changes" ? copy.hsTabChanges : copy.hsSendTitle}</b>
              <span className="stw-h__sub">{tab === "changes" ? copy.hsChangesSub : copy.hsSendSub}</span>
            </div>
            <button aria-label={copy.rcClose} className="panel__x stw-x" onClick={onClose} type="button">
              <X />
            </button>
          </div>
          <div className="stw-seg" role="tablist">
            <button
              aria-selected={tab === "changes"}
              className={tab === "changes" ? "on" : undefined}
              onClick={() => setTab("changes")}
              role="tab"
              type="button"
            >
              {copy.hsTabChanges}
            </button>
            <button
              aria-selected={tab === "send"}
              className={tab === "send" ? "on" : undefined}
              onClick={openSendTab}
              role="tab"
              type="button"
            >
              {copy.hsTabSend}
              {stalled && <i aria-hidden="true" className="stw-dot is-red stw-breathe" />}
            </button>
          </div>
        </div>

        <div className="panel__body stw-body">
          {tab === "changes" ? (
            <div className="stw-pane" key="changes">
              {changes.status === "error" && (
                <div className="stw-state">
                  <span>{copy.hsLoadFailed}</span>
                  <button className="stw-link" onClick={() => reloadChanges(null)} type="button">
                    {copy.hsRetry}
                  </button>
                </div>
              )}
              {changes.data.truncated && <p className="stw-note">{copy.hsTruncated}</p>}
              <ol className="stw-list">
                {changes.data.groups.map((group, index) => {
                  const open = openGroups.has(group.id);
                  const revert = reverts[group.id];
                  const kinds = group.fields.map((summary) => kindOf(summary.field, copy)).join(" · ");
                  return (
                    <li className="stw-item" key={group.id} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
                      <div className="stw-item__top">
                        <b className="stw-item__t" title={roomsText(group.rooms.map(bRoom), copy)}>
                          {kinds} · {compactRooms(group.rooms.map(bRoom), copy)}
                        </b>
                        <span className="stw-st is-mute">
                          {group.source === "beds24" ? copy.hsFromBeds24 : copy.hsSourceApp}
                        </span>
                      </div>
                      <div className="stw-item__v">
                        {[
                          dateSpan(group.dateFrom, group.dateTo),
                          ...group.fields.map((summary) => changeText(summary, copy)),
                          copy.hsCells.replace("{n}", String(group.cellCount)),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      <div className="stw-item__meta">
                        <span className="stw-item__who">
                          {group.source === "beds24" ? (
                            <span className="stw-tag">{copy.hsSourceBeds24}</span>
                          ) : (
                            <span>{group.by ?? copy.unknownUser}</span>
                          )}
                          <span className="stw-sep" aria-hidden="true">·</span>
                          <span>{whenText(group.at)}</span>
                        </span>
                        <span className="stw-acts">
                          <button aria-expanded={open} className="stw-link is-mute" onClick={() => toggleCells(group.id)} type="button">
                            {open ? copy.hsHideCells : copy.hsShowCells}
                          </button>
                          {canWrite && isRevertibleGroup(group) && revert === undefined && (
                            <button
                              className="stw-link"
                              onClick={() => setReverts((previous) => ({ ...previous, [group.id]: "ask" }))}
                              type="button"
                            >
                              {copy.hsRevert}
                            </button>
                          )}
                        </span>
                      </div>
                      {revert === "ask" && (
                        <div className="stw-ask" role="group">
                          <p>{group.source === "beds24" ? copy.hsRevertAskBeds24 : copy.hsRevertAsk}</p>
                          <div className="stw-ask__btns">
                            <button
                              className="stw-btn is-ghost"
                              onClick={() =>
                                setReverts((previous) => {
                                  const next = { ...previous };
                                  delete next[group.id];
                                  return next;
                                })
                              }
                              type="button"
                            >
                              {copy.panelCancel}
                            </button>
                            <button className="stw-btn is-pri" onClick={() => void runRevert(group.id)} type="button">
                              {copy.hsRevertConfirm}
                            </button>
                          </div>
                        </div>
                      )}
                      {revert === "pending" && (
                        <p className="stw-msg is-wait" role="status">
                          <i aria-hidden="true" className="stw-dot is-v stw-breathe" />
                          {copy.bkPending}
                        </p>
                      )}
                      {typeof revert === "object" && (
                        <p className={`stw-msg is-${revert.tone}`} role="status">
                          {revert.tone === "ok" && <DrawCheck />}
                          {revert.text}
                        </p>
                      )}
                      {open && <CellRunsTable copy={copy} group={group} />}
                    </li>
                  );
                })}
              </ol>
              {changes.status === "ready" && changes.data.groups.length === 0 && changes.data.windowFrom && (
                <p className="stw-empty">
                  {copy.hsEmptyWindow.replace("{from}", shortDate(changes.data.windowFrom.slice(0, 10)))}
                </p>
              )}
              {changes.status === "loading" && <ListSkeleton />}
              {changes.status === "ready" && changes.data.nextBefore && (
                <button className="stw-more" onClick={() => reloadChanges(changes.data.nextBefore)} type="button">
                  {copy.hsMore}
                </button>
              )}
            </div>
          ) : (
            <div className="stw-pane" key="send">
              {sends.status === "error" && (
                <div className="stw-state">
                  <span>{copy.hsLoadFailed}</span>
                  <button className="stw-link" onClick={() => reloadSends(null)} type="button">
                    {copy.hsRetry}
                  </button>
                </div>
              )}
              {troubleCount > 0 && (
                <div className="stw-alert" role="status">
                  <i aria-hidden="true" className="stw-dot is-red stw-breathe" />
                  <span>{copy.hsAlertCount.replace("{n}", String(troubleCount))}</span>
                </div>
              )}
              {stalled && (
                <div className="stw-stall" role="status">
                  <span>{copy.hsStalled.replace("{n}", String(SEND_STALL_MINUTES))}</span>
                  {canWrite && (
                    <button className="stw-btn is-pri is-sm" disabled={kicking} onClick={() => void sendNow()} type="button">
                      {kicking ? copy.hsSending : copy.hsSendNow}
                    </button>
                  )}
                </div>
              )}
              {sendResult && (
                <p className={`stw-msg is-${sendResult.tone}`} role="status">
                  {sendResult.tone === "ok" && <DrawCheck />}
                  {sendResult.text}
                </p>
              )}
              <ol className="stw-list">
                {sends.data.entries.map((entry, index) => {
                  const stuck = isSendStalled(entry);
                  const cooling = entry.waitReason !== null;
                  const tone = stuck || entry.status === "failed" || entry.status === "partial"
                    ? "red"
                    : cooling
                      ? "amber"
                      : entry.status === "succeeded"
                        ? "green"
                        : "mute";
                  const active = !stuck && !cooling && (entry.status === "queued" || entry.status === "processing");
                  return (
                    <li className="stw-item" key={entry.id} style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
                      <div className="stw-item__top">
                        <b className="stw-item__t" title={roomsText(entry.rooms.map(bRoom), copy)}>
                          {kindLabel(entry)} · {compactRooms(entry.rooms.map(bRoom), copy)}
                        </b>
                        <span className={`stw-st is-${tone}`}>
                          {active && <i aria-hidden="true" className="stw-dot is-v stw-breathe" />}
                          {cooling ? copy.hsStatusCooldown : statusLabel(entry)}
                          {entry.waitingMinutes !== null && entry.waitingMinutes > 0 && ` · ${entry.waitingMinutes}′`}
                        </span>
                      </div>
                      <div className="stw-item__v">
                        {[
                          dateSpan(entry.dateFrom, entry.dateTo),
                          entry.values ? formatRange(entry.values, entry.kind === "minStay" ? "minStay" : "price", copy) : "",
                          copy.hsCells.replace("{n}", String(entry.cellCount)),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {entry.waitReason && (
                        <p className="stw-item__wait">
                          {entry.waitReason === "low_credit" ? copy.hsWaitLowCredit : copy.hsWaitRateLimit}
                          {" · "}
                          {entry.retryAt
                            ? copy.hsWaitRetryAt.replace("{time}", formatHistoryWhen(entry.retryAt).slice(6))
                            : copy.hsWaitRetrySoon}
                        </p>
                      )}
                      {(entry.error || entry.failures.length > 0) && (
                        <div className="stw-item__errs">
                          {entry.error && (
                            <p>
                              {copy.hsReasons[entry.error] ?? entry.error}
                              {entry.detail && <span> · {localizeSendDetail(entry.detail, copy.hsFailures)}</span>}
                            </p>
                          )}
                          {entry.failures.map((failure, failureIndex) => {
                            const described = describeSendFailure(
                              failure,
                              copy.hsFailures,
                              copy.hsFailSample,
                              (value, field) => formatValue(value, field, copy),
                            );
                            return (
                              <p key={`${failure.room}-${failureIndex}`}>
                                <b>{failure.room}</b> {described.text}
                                {described.detail && <span> · {described.detail}</span>}
                              </p>
                            );
                          })}
                        </div>
                      )}
                      <div className="stw-item__meta">
                        <span className="stw-item__who">
                          <span>{entry.by ?? copy.unknownUser}</span>
                          <span className="stw-sep" aria-hidden="true">·</span>
                          <span>{whenText(entry.at)}</span>
                          {entry.finishedAt && entry.source === "job" && (
                            <>
                              <span className="stw-sep" aria-hidden="true">·</span>
                              <span>{copy.hsFinished.replace("{time}", formatHistoryWhen(entry.finishedAt).slice(6))}</span>
                            </>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {sends.status === "ready" && sends.data.entries.length === 0 && <p className="stw-empty">{copy.hsEmptySend}</p>}
              {sends.status === "loading" && <ListSkeleton />}
              {sends.status === "ready" && sends.data.nextBefore && (
                <button
                  className="stw-more"
                  onClick={() => {
                    sendPagesRef.current += 1;
                    reloadSends(sends.data.nextBefore);
                  }}
                  type="button"
                >
                  {copy.hsMoreSend}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/** 성공 — 초록 체크를 그린다(선이 그어지며 나타남). */
function DrawCheck() {
  return (
    <svg aria-hidden="true" className="stw-check" viewBox="0 0 16 16">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

/** 불러오는 동안 — 줄 모양 뼈대 셋(최종 줄과 같은 높이). */
function ListSkeleton() {
  return (
    <div aria-busy="true" className="stw-skel">
      {[0, 1, 2].map((index) => (
        <div className="stw-skel__row" key={index}>
          <span className="w60" />
          <span className="w80" />
          <span className="w40" />
        </div>
      ))}
    </div>
  );
}
