"use client";

// 모바일 주문 상세 — 사무실 처리 줄. 화이트 리디자인(2026-10-14, 시안 OrderOffice-Phone · OrderProcess-Phone ·
// OrderReject-Phone): 지금 할 수 있는 버튼만 보인다 — 요청됨 = [반려][승인], 승인됨 = [반려][주문 처리],
// 주문 처리됨 = [반려][배송일 수정], 종료 = 없음. 주문 처리 · 배송일 수정은 공용 BottomSheet 안 달력(하루/기간),
// 반려는 사유를 받는 시트(되돌리기 어려운 동작이라 확인 — ui-ux-pro-max 점검). 승인은 바로 처리.
// 성공하면 성공 진동 + 위에 한 줄 안내(체크가 그려짐).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  updateOrderDeliveryDate,
  updateOrderRequestStatus,
} from "@/actions/orders";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { PermissionDeniedSheet } from "@/components/shell/permission-denied-sheet";
import { haptic } from "@/lib/haptics";
import { tokyoToday } from "@/lib/tokyo-date";
import type { Database } from "@/types/database";
import type { Locale } from "@/lib/i18n";

type OrderStatus = Database["public"]["Enums"]["order_request_status"];
type Sheet = "ordered" | "edit-delivery" | "reject";

export type OrderActionBarLabels = {
  actionApprove: string;
  actionMarkOrdered: string;
  actionReject: string;
  actionEditDelivery: string;
  successApprove: string;
  successOrdered: string;
  successReject: string;
  successEditDelivery: string;
  errorInvalidTransition: string;
  errorSaveFailed: string;
  deliveryDateRequired: string;
  deliveryDateInvalid: string;
  deliveryRangeRequired: string;
  deliveryRangeInvalid: string;
  calPrevMonth: string;
  calNextMonth: string;
  wHintRequested: string;
  wHintApproved: string;
  wHintOrdered: string;
  wProcessBody: string;
  wEditDelivBody: string;
  wDay: string;
  wRange: string;
  wDelivPreview: string;
  wPickEnd: string;
  wPickDay: string;
  wRejectTitle: string;
  wRejectBody: string;
  wRejectReason: string;
  wRejectPh: string;
  wKeep: string;
  permissionDeniedTitle: string;
  permissionDeniedBody: string;
  close: string;
};

type OrderActionBarProps = {
  labels: OrderActionBarLabels;
  locale: Locale;
  orderId: string;
  /** 시트 머리에 보일 「제목 · 건물」. */
  summary: string;
  status: OrderStatus;
  currentDeliveryDate?: string | null;
  currentDeliveryStartDate?: string | null;
  currentDeliveryEndDate?: string | null;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function keyOf(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}

function dayLabel(key: string, locale: Locale): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

function Calendar({
  locale,
  labels,
  todayKey,
  mode,
  date,
  start,
  end,
  onPick,
}: {
  locale: Locale;
  labels: OrderActionBarLabels;
  todayKey: string;
  mode: "exact" | "range";
  date: string;
  start: string;
  end: string;
  onPick: (key: string) => void;
}) {
  const seed = (mode === "range" ? start : date) || todayKey;
  const [month, setMonth] = useState(() => ({ y: +seed.slice(0, 4), m: +seed.slice(5, 7) - 1 }));
  const first = new Date(Date.UTC(month.y, month.m, 1)).getUTCDay(); // 일요일 시작(모바일 달력과 같음)
  const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const wd = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 7, 2 + i))),
  );
  const title = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(month.y, month.m, 1)),
  );
  const move = (delta: number) =>
    setMonth((cur) => {
      const total = cur.y * 12 + cur.m + delta;
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
    });

  return (
    <div className="odw-cal">
      <div className="odw-cal__h">
        <button type="button" aria-label={labels.calPrevMonth} onClick={() => move(-1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <b>{title}</b>
        <button type="button" aria-label={labels.calNextMonth} onClick={() => move(1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="odw-cal__g odw-cal__wd">
        {wd.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="odw-cal__g">
        {Array.from({ length: first }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const key = keyOf(month.y, month.m, i + 1);
          const sel = mode === "exact" ? key === date : key === start || key === end;
          const inRange = mode === "range" && start && end && key > start && key < end;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={sel}
              className={`odw-day${sel ? " is-sel" : ""}${inRange ? " is-in" : ""}${key === todayKey ? " is-today" : ""}`}
              onClick={() => {
                haptic("light");
                onPick(key);
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function OrderActionBar({
  labels,
  locale,
  orderId,
  summary,
  status,
  currentDeliveryDate,
  currentDeliveryStartDate,
  currentDeliveryEndDate,
}: OrderActionBarProps) {
  const router = useRouter();
  const todayKey = useMemo(() => tokyoToday(), []);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [mode, setMode] = useState<"exact" | "range">("exact");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  function openDelivery(kind: "ordered" | "edit-delivery") {
    if (kind === "edit-delivery" && currentDeliveryStartDate && currentDeliveryEndDate) {
      setMode("range");
      setStart(currentDeliveryStartDate);
      setEnd(currentDeliveryEndDate);
      setDate("");
    } else {
      setMode("exact");
      setDate(kind === "edit-delivery" ? (currentDeliveryDate ?? "") : "");
      setStart("");
      setEnd("");
    }
    setError(null);
    setSheet(kind);
  }

  function pick(key: string) {
    setError(null);
    if (mode === "exact") {
      setDate(key);
      return;
    }
    if (!start || (start && end)) {
      setStart(key);
      setEnd("");
    } else if (key < start) {
      setEnd(start);
      setStart(key);
    } else {
      setEnd(key);
    }
  }

  async function run(kind: "approve" | Sheet, close?: () => void) {
    if (pending) return;
    setPending(true);
    setError(null);
    const delivery =
      mode === "exact"
        ? { deliveryMode: "exact" as const, deliveryDate: date }
        : { deliveryMode: "range" as const, deliveryStartDate: start, deliveryEndDate: end };
    const result =
      kind === "edit-delivery"
        ? await updateOrderDeliveryDate({ orderId, ...delivery })
        : await updateOrderRequestStatus({
            orderId,
            targetStatus: kind === "approve" ? "approved" : kind === "ordered" ? "ordered" : "closed",
            ...(kind === "ordered" ? delivery : {}),
            ...(kind === "reject" ? { reason } : {}),
          });
    setPending(false);

    if (!result.ok) {
      if (result.error === "unauthorized" || result.error === "forbidden") {
        close?.();
        setPermissionDenied(true);
        return;
      }
      haptic("error");
      setError(
        result.error === "invalid_transition"
          ? labels.errorInvalidTransition
          : result.error === "missing_delivery_date"
            ? labels.deliveryDateRequired
            : result.error === "invalid_delivery_date"
              ? labels.deliveryDateInvalid
              : result.error === "missing_delivery_range"
                ? labels.deliveryRangeRequired
                : result.error === "invalid_delivery_range"
                  ? labels.deliveryRangeInvalid
                  : labels.errorSaveFailed,
      );
      return;
    }

    haptic("success");
    setDone(
      kind === "approve"
        ? labels.successApprove
        : kind === "ordered"
          ? labels.successOrdered
          : kind === "edit-delivery"
            ? labels.successEditDelivery
            : labels.successReject,
    );
    close?.();
    router.refresh();
  }

  const valid = mode === "exact" ? Boolean(date) : Boolean(start && end);
  const preview =
    mode === "exact"
      ? date
        ? dayLabel(date, locale)
        : labels.wPickDay
      : start
        ? end
          ? `${dayLabel(start, locale)} – ${dayLabel(end, locale)}`
          : `${dayLabel(start, locale)} – ${labels.wPickEnd}`
        : labels.wPickDay;

  const hint =
    status === "requested" ? labels.wHintRequested : status === "approved" ? labels.wHintApproved : status === "ordered" ? labels.wHintOrdered : null;

  if (status === "closed" && !done) return null;

  return (
    <>
      {done ? (
        <p className="odw-done" role="status">
          <span aria-hidden="true">
            <Check />
          </span>
          {done}
        </p>
      ) : null}

      {status !== "closed" && status !== "received" ? (
        <div className="odw-act">
          <div className="odw-act__btns">
            <button type="button" className="odw-btn is-gray" disabled={pending} onClick={() => { setReason(""); setError(null); setSheet("reject"); }}>
              {labels.actionReject}
            </button>
            {status === "requested" ? (
              <button type="button" className="odw-btn is-pri" disabled={pending} onClick={() => run("approve")}>
                {labels.actionApprove}
              </button>
            ) : status === "approved" ? (
              <button type="button" className="odw-btn is-pri" disabled={pending} onClick={() => openDelivery("ordered")}>
                {labels.actionMarkOrdered}
              </button>
            ) : (
              <button type="button" className="odw-btn is-soft" disabled={pending} onClick={() => openDelivery("edit-delivery")}>
                {labels.actionEditDelivery}
              </button>
            )}
          </div>
          {error && !sheet ? <p className="odw-err">{error}</p> : hint ? <p className="odw-hint">{hint}</p> : null}
        </div>
      ) : null}

      {sheet === "ordered" || sheet === "edit-delivery" ? (
        <BottomSheet ariaLabel={sheet === "ordered" ? labels.actionMarkOrdered : labels.actionEditDelivery} onClose={() => setSheet(null)}>
          {({ close }) => (
            <div className="odw-sheet">
              <div className="odw-sheet__h">
                <h3>{sheet === "ordered" ? labels.actionMarkOrdered : labels.actionEditDelivery}</h3>
                <span>{summary}</span>
              </div>
              <p className="odw-sheet__p">{sheet === "ordered" ? labels.wProcessBody : labels.wEditDelivBody}</p>
              <div className="odw-seg" role="radiogroup">
                {(["exact", "range"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    className={mode === m ? "on" : ""}
                    onClick={() => {
                      setMode(m);
                      setError(null);
                    }}
                  >
                    {m === "exact" ? labels.wDay : labels.wRange}
                  </button>
                ))}
              </div>
              <Calendar locale={locale} labels={labels} todayKey={todayKey} mode={mode} date={date} start={start} end={end} onPick={pick} />
              <div className="odw-sheet__sum">
                <span>{labels.wDelivPreview}</span>
                <b className={valid ? "" : "is-dim"}>{preview}</b>
              </div>
              {error ? <p className="odw-err">{error}</p> : null}
              <button type="button" className="odw-btn is-pri is-lg" disabled={!valid || pending} onClick={() => run(sheet, close)}>
                {sheet === "ordered" ? labels.actionMarkOrdered : labels.actionEditDelivery}
              </button>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {sheet === "reject" ? (
        <BottomSheet ariaLabel={labels.wRejectTitle} onClose={() => setSheet(null)}>
          {({ close }) => (
            <div className="odw-sheet">
              <div className="odw-sheet__h">
                <h3>{labels.wRejectTitle}</h3>
                <span>{summary}</span>
              </div>
              <p className="odw-sheet__p">{labels.wRejectBody}</p>
              <label className="mdw-nf">
                <span className="mdw-nf__l">{labels.wRejectReason}</span>
                <textarea className="mdw-nf__in" rows={3} value={reason} placeholder={labels.wRejectPh} onChange={(e) => setReason(e.target.value)} />
              </label>
              {error ? <p className="odw-err">{error}</p> : null}
              <div className="odw-act__btns">
                <button type="button" className="odw-btn is-gray is-lg" onClick={close}>
                  {labels.wKeep}
                </button>
                <button type="button" className="odw-btn is-ink is-lg" disabled={pending} onClick={() => run("reject", close)}>
                  {labels.actionReject}
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      ) : null}

      {permissionDenied ? (
        <PermissionDeniedSheet
          body={labels.permissionDeniedBody}
          closeLabel={labels.close}
          onClose={() => setPermissionDenied(false)}
          title={labels.permissionDeniedTitle}
        />
      ) : null}
    </>
  );
}
