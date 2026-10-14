import { redirect } from "next/navigation";
import { ExternalLink, ImageIcon } from "lucide-react";
import { OrderActionBar } from "@/components/requests/order-action-bar";
import { LightboxThumbs } from "@/components/shell/lightbox-thumbs";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getDictionary, type Locale } from "@/lib/i18n";
import { getDisplayRoomLabel, localizePropertyName } from "@/lib/room-label-normalization";
import {
  getOrderRequestById,
  type OrderRequestItem,
  type OrderRequestStatus,
} from "@/lib/order-requests";
import { canCurrentUserProcessOrders } from "@/app/mobile/requests/orders/actions";
import { getOnboardingState } from "@/lib/onboarding";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { tokyoToday } from "@/lib/tokyo-date";
import "@/components/requests/maintenance-detail.css";
import "@/components/requests/order-detail.css";

type ListFilterQuery = {
  scope?: string;
  type?: string;
  status?: string;
  building?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListFilterQuery>;
};

const LIST_FILTER_KEYS = [
  "scope", "type", "status", "building", "date", "startDate", "endDate",
] as const;

// "received" is not shown as an active step in MVP; map it to "ordered" for progress display.
const TIMELINE_STATUSES = ["requested", "approved", "ordered"] as const;

/**
 * 화면에 노출되는 상태는 4종(requested/approved/ordered/closed)뿐이다.
 * `received`는 DB enum에만 남아 있는 비활성 단계이고, 어드민 콘솔과 동일하게 `ordered`로 접어서
 * 표시한다 (docs/product/10-order-request-workflow.md → Statuses: "stays an inactive step everywhere
 * in the UI", 어드민은 `getAdminOrders`에서 명시적으로 ordered로 매핑). 이전에는 모바일만 초록
 * "입고됨" 배지를 그렸는데, `isValidTransition`에 `received` 케이스가 없어 어떤 경로로도 설정할 수
 * 없는 유령 상태였다.
 */
type OrderDisplayStatus = "requested" | "approved" | "ordered" | "closed";

function toDisplayStatus(status: OrderRequestStatus): OrderDisplayStatus {
  return status === "received" ? "ordered" : status;
}

function buildBackToListHref(query: ListFilterQuery): string {
  const params = new URLSearchParams();
  for (const key of LIST_FILTER_KEYS) {
    const val = query[key];
    if (val) params.set(key, val);
  }
  const qs = params.toString();
  return qs ? `/mobile/requests?${qs}` : "/mobile/requests";
}

/** "YYYY-MM-DD" → 「10월 10일 (토)」 — 날짜 키 그대로(UTC 정오 없이 UTC 로 해석해 요일이 밀리지 않게). */
function formatDayLabel(key: string, locale: Locale): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

function diffDays(fromKey: string, toKey: string): number {
  const n = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  return n(toKey) - n(fromKey);
}

/** created_at → 도쿄 「M/D HH:mm」. */
function tokyoStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

function linkHost(link: string): string {
  try {
    const u = new URL(link);
    const host = u.hostname.replace(/^www\./, "");
    return host === "ikea.com" && u.pathname.startsWith("/jp") ? "ikea.com/jp" : host;
  } catch {
    return link;
  }
}

// Only render clickable anchors for valid absolute http/https URLs.
function isValidAbsoluteUrl(value: string): boolean {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function parseItems(raw: unknown): OrderRequestItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const name = String(record.name ?? "").trim();
    const quantity = String(record.quantity ?? "").trim();
    if (!name) return [];
    const rawImageUrls = record.imageUrls;
    const imageUrls =
      Array.isArray(rawImageUrls)
        ? rawImageUrls.filter((u): u is string => typeof u === "string" && u.length > 0)
        : undefined;
    return [{
      id: String(record.id ?? ""),
      imageUrls: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
      link: String(record.link ?? "").trim(),
      memo: String(record.memo ?? "").trim(),
      name,
      quantity: quantity || "1",
    }];
  });
}

export default async function MobileOrderRequestDetailPage({
  params,
  searchParams,
}: PageProps) {
  const [state, session, { id }, query] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/requests/orders/${id}`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  // Only office-level roles (or an `order_processor` permission override) process orders
  // (approve/order/reject/edit delivery). The decision is delegated to the server action module so
  // the UI can never drift from the gate that actually enforces it. Non-processors (incl.
  // field_manager) get no processing action, so hide the whole bar instead of showing buttons that
  // would fail with "forbidden".
  const canProcessOrder = await canCurrentUserProcessOrders();
  const dictionary = getDictionary(locale);
  const copy = dictionary.mobile.orderDetail;
  const urgentLabel = dictionary.mobile.orderForm.urgencyHigh;
  const statusLabels = dictionary.mobile.orderStatusLabels;
  const backHref = buildBackToListHref(query);

  const order = await getOrderRequestById(session, id);
  if (!order) {
    redirect(backHref);
  }

  const items = parseItems(order.items);
  const displayStatus = toDisplayStatus(order.status);
  const isClosed = order.status === "closed";
  // closed: neutral timeline (all muted) -> the badge already communicates the terminal state.
  // received: maps to ordered (MVP hides the received step).
  const progressStatus: (typeof TIMELINE_STATUSES)[number] | null = isClosed
    ? null
    : order.status === "requested"
      ? "requested"
      : order.status === "approved"
        ? "approved"
        : "ordered"; // ordered / received -> show full active progress
  // -1 when closed so every i <= currentIdx check is false -> all bars muted.
  const currentIdx = progressStatus !== null ? TIMELINE_STATUSES.indexOf(progressStatus) : -1;

  const navBadges = await getMobileNavBadges();
  const statusLabel = statusLabels[displayStatus];
  const todayKey = tokyoToday();
  const deliv = order.delivery_start_date && order.delivery_end_date
    ? { start: order.delivery_start_date, end: order.delivery_end_date }
    : order.delivery_date
      ? { start: order.delivery_date, end: order.delivery_date }
      : null;
  const delivText = deliv
    ? deliv.start === deliv.end
      ? formatDayLabel(deliv.start, locale)
      : `${formatDayLabel(deliv.start, locale)} – ${formatDayLabel(deliv.end, locale)}`
    : null;
  const daysLeft = deliv ? diffDays(todayKey, deliv.start) : null;
  const rel =
    daysLeft === null || isClosed
      ? null
      : daysLeft === 0
        ? copy.wToday
        : daysLeft === 1
          ? copy.wTomorrow
          : daysLeft > 1
            ? copy.wInDays.replace("{n}", String(daysLeft))
            : copy.wDaysPast.replace("{n}", String(-daysLeft));
  const building = localizePropertyName(order.building_name ?? "", dictionary.cleaning.buildingLabels);
  const room = getDisplayRoomLabel(order.building_name ?? "", order.room_label);
  const where = room && room !== "-" && room !== building ? `${room} · ${building}` : building;
  const stamp = tokyoStamp(order.created_at);

  return (
    <MobileShell activeItem="requests" badges={navBadges} title={copy.title}>
      {/* 화이트 리디자인(2026-10-14, 시안 OrderDetail-Phone · OrderOffice-Phone): 상자 없는 한 줄 머리 · 배송 예정 ·
          품목 줄 · 사유 · 진행 3단 막대(누가 · 언제 기록은 DB 에 없어 단계만) · 사무실이면 처리 줄. */}
      <div className="mdw odw">
        <div className="mdw-kick">
          {order.urgency === "high" ? <span className="mdw-pri is-urgent">{urgentLabel}</span> : null}
          <span>{statusLabel}</span>
        </div>
        <h1 className="mdw-title">{order.title}</h1>
        <p className="mdw-sub">
          {where} · {order.reporter_name || "-"} · <span className="num">{stamp}</span>
        </p>

        {!isClosed ? (
          <div className="odw-deliv">
            <div>
              <span>{copy.wDelivPreview}</span>
              {delivText ? <b>{delivText}</b> : <em>{copy.wDelivTbd}</em>}
            </div>
            {rel ? <strong className={daysLeft !== null && daysLeft < 0 ? "is-past" : ""}>{rel}</strong> : null}
          </div>
        ) : null}

        <section className="odw-items">
          <div className="odw-items__h">
            <b>{copy.itemsTitle}</b>
            <span>{copy.wItemCount.replace("{n}", String(items.length))}</span>
          </div>
          {items.length === 0 ? (
            <p className="mdw-hint">-</p>
          ) : (
            items.map((item, idx) => (
              <div className="odw-item" key={item.id || `${item.name}-${idx}`} style={{ animationDelay: `${Math.min(idx, 6) * 40}ms` }}>
                {item.imageUrls && item.imageUrls.length > 0 ? (
                  <div className="odw-item__ph">
                    <LightboxThumbs
                      closeLabel={dictionary.common.close}
                      sizes="44px"
                      thumbClassName="odw-item__img"
                      urls={item.imageUrls}
                      wrapClassName="odw-item__thumbs"
                    />
                    {item.imageUrls.length > 1 ? <span className="odw-item__phn">{item.imageUrls.length}</span> : null}
                  </div>
                ) : (
                  <span className="odw-item__ph is-none" aria-hidden="true">
                    <ImageIcon />
                  </span>
                )}
                <span className="odw-item__b">
                  <span className="odw-item__n">{item.name}</span>
                  {isValidAbsoluteUrl(item.link) || item.memo ? (
                    <span className="odw-item__s">
                      {isValidAbsoluteUrl(item.link) ? (
                        <a aria-label={copy.itemLinkLabel} href={item.link} rel="noreferrer" target="_blank">
                          <ExternalLink aria-hidden="true" />
                          {linkHost(item.link)}
                        </a>
                      ) : null}
                      {item.memo ? <span className="odw-item__m">{item.memo}</span> : null}
                    </span>
                  ) : null}
                </span>
                <span className="odw-item__q">× {item.quantity}</span>
              </div>
            ))
          )}
        </section>

        {order.reason || order.description || order.admin_memo ? (
          <dl className="mdw-dl">
            {order.reason || order.description ? (
              <>
                <dt>{copy.wReason}</dt>
                <dd>{order.reason || order.description}</dd>
              </>
            ) : null}
            {order.admin_memo ? (
              <>
                <dt>{copy.wRejectReason}</dt>
                <dd>{order.admin_memo}</dd>
              </>
            ) : null}
          </dl>
        ) : null}

        <section className="odw-steps">
          <div className="odw-steps__h">
            <b>{copy.wProgress}</b>
            <span className="num">{copy.wReqAt.replace("{t}", stamp)}</span>
          </div>
          <div className={`odw-steps__bars${isClosed ? " is-closed" : ""}`}>
            {TIMELINE_STATUSES.map((s, i) => (
              <i key={s} className={i <= currentIdx ? "on" : ""} style={{ animationDelay: `${120 + i * 90}ms` }} />
            ))}
          </div>
          <div className="odw-steps__lbs">
            {TIMELINE_STATUSES.map((s, i) => (
              <span key={s} className={isClosed ? "" : i === currentIdx ? "is-cur" : i < currentIdx ? "is-done" : ""}>
                {statusLabels[s]}
              </span>
            ))}
          </div>
          {isClosed ? <p className="odw-closed">{copy.wClosedNote}</p> : null}
        </section>

        {canProcessOrder ? (
          <OrderActionBar
            labels={{
              actionApprove: copy.actionApprove,
              actionMarkOrdered: copy.actionMarkOrdered,
              actionReject: copy.actionReject,
              actionEditDelivery: copy.actionEditDelivery,
              successApprove: copy.successApprove,
              successOrdered: copy.successOrdered,
              successReject: copy.successReject,
              successEditDelivery: copy.successEditDelivery,
              errorInvalidTransition: copy.errorInvalidTransition,
              errorSaveFailed: copy.errorSaveFailed,
              deliveryDateRequired: copy.deliveryDateRequired,
              deliveryDateInvalid: copy.deliveryDateInvalid,
              deliveryRangeRequired: copy.deliveryRangeRequired,
              deliveryRangeInvalid: copy.deliveryRangeInvalid,
              calPrevMonth: copy.calPrevMonth,
              calNextMonth: copy.calNextMonth,
              wHintRequested: copy.wHintRequested,
              wHintApproved: copy.wHintApproved,
              wHintOrdered: copy.wHintOrdered,
              wProcessBody: copy.wProcessBody,
              wEditDelivBody: copy.wEditDelivBody,
              wDay: copy.wDay,
              wRange: copy.wRange,
              wDelivPreview: copy.wDelivPreview,
              wPickEnd: copy.wPickEnd,
              wPickDay: copy.wPickDay,
              wRejectTitle: copy.wRejectTitle,
              wRejectBody: copy.wRejectBody,
              wRejectReason: copy.wRejectReason,
              wRejectPh: copy.wRejectPh,
              wKeep: copy.wKeep,
              permissionDeniedTitle: dictionary.common.permissionDeniedTitle,
              permissionDeniedBody: dictionary.common.permissionDeniedBody,
              close: dictionary.common.close,
            }}
            summary={`${order.title} · ${building}`}
            currentDeliveryDate={order.delivery_date}
            currentDeliveryStartDate={order.delivery_start_date}
            currentDeliveryEndDate={order.delivery_end_date}
            locale={locale}
            orderId={order.id}
            status={order.status}
          />
        ) : null}
      </div>
    </MobileShell>
  );
}
