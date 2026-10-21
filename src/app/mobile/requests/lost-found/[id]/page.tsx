import { notFound, redirect } from "next/navigation";
import { Check } from "lucide-react";
import { AnnouncementImageGrid } from "@/components/announcements/announcement-image-grid";
import { LostFoundHandlingForm } from "@/components/requests/lost-found-handling-form";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getDictionary, type Locale } from "@/lib/i18n";
import { getLostItemById, isLostItemTerminal } from "@/lib/lost-found";
import { lostItemClock } from "@/lib/lost-found-constants";
import { localizeLostFoundMemo } from "@/lib/lost-found-memo";
import { getOnboardingState } from "@/lib/onboarding";
import { resolveRequestLocation } from "@/lib/request-location";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import "@/components/requests/maintenance-detail.css";
import "@/components/requests/lost-found-detail.css";

type ListFilterQuery = {
  building?: string;
  created?: string;
  date?: string;
  endDate?: string;
  scope?: string;
  startDate?: string;
  status?: string;
  type?: string;
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListFilterQuery>;
};

/** 짧은 도쿄 시각 — 올해면 M/D HH:mm, 아니면 YYYY/M/D HH:mm (수리 상세와 같은 규칙). */
function formatDateTime(value: string, locale: Locale) {
  void locale;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  const thisYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric" }).format(new Date());
  const md = `${Number(parts.month)}/${Number(parts.day)}`;
  return `${parts.year === thisYear ? md : `${parts.year}/${md}`} ${parts.hour}:${parts.minute}`;
}

/** "YYYY-MM-DD" → "M/D". */
function shortDate(ymd: string) {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}`;
}

export default async function MobileLostItemDetailPage({ params, searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, { id }, query] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/requests/lost-found/${id}`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const copy = dictionary.lostFound;

  const [item, roomCatalog] = await Promise.all([
    getLostItemById(session, id),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
  ]);
  if (!item) {
    notFound();
  }
  const localizedHandlingMemo = localizeLostFoundMemo(item.handling_memo, copy.adminRestoreMemoLabel);

  const location = resolveRequestLocation(
    item.room_label,
    roomCatalog,
    dictionary.cleaning.buildingLabels,
    item.property_name,
  );
  const isTerminal = isLostItemTerminal(item.status);
  // 상태 변경 = 권한 키 `lost_found.handle`. 서버 액션과 RLS가 최종 게이트, 여기서는 UI만 감춘다.
  const canHandle = session.capabilities.includes("lost_found.handle");
  const clock = lostItemClock(item);
  const c = copy.console;
  const flag = clock?.isExpired ? c.expiredFlag : clock?.isDueSoon ? c.soonFlag : null;
  const roomText = location.roomLabel && location.roomLabel !== "-" ? location.roomLabel : null;
  const showCreatedBanner = query.created === "1";

  const navBadges = await navBadgesPromise;

  // 화이트 리디자인(2026-10-14, 시안 LFDetail-Phone · LFDone-Phone): 한 줄 머리 · 제목 · 사진 · 「자동 폐기까지 D-n」 막대 ·
  // 정보 줄 · 아래로 현장 처리(진행 중) 또는 처리 기록(완료). 상자 · 칩 · 아이콘 타일 없음.
  return (
    <MobileShell activeItem="requests" badges={navBadges} title={copy.detailTitle}>
      <div className="mdw">
        {showCreatedBanner ? <p className="mdw-created">{copy.createdSuccess}</p> : null}

        <div className="mdw-kick">
          {flag ? <span className="mdw-pri is-urgent">{flag}</span> : null}
          {flag && item.status === "disposal_scheduled" ? null : (
            <span className={item.status === "returned" ? "lfd-ok" : undefined}>{copy.statusLabels[item.status]}</span>
          )}
          <span>{copy.categoryLabels[item.category]}</span>
          {item.cleaning_session_id ? <span className="mdw-from">{copy.fromCleaningTag}</span> : null}
        </div>
        <h1 className="mdw-title">{item.item_name}</h1>
        <p className="mdw-sub">
          {roomText ? <b className="mono">{roomText}</b> : null}
          {[location.buildingLabel, item.reporter_name, formatDateTime(item.found_at, locale)]
            .filter(Boolean)
            .map((x, i) => (
              <span key={i}>{roomText || i > 0 ? ` · ${x}` : x}</span>
            ))}
        </p>

        <AnnouncementImageGrid imageUrls={item.image_urls} closeLabel={dictionary.common.close} imageAltLabel={copy.handling.photosLabel} />

        {clock ? (
          <div className="lfd-clock">
            <div className="lfd-clock__h">
              <span>{c.autoDueIn}</span>
              <b className={clock.isDueSoon || clock.isExpired ? "is-soon" : undefined}>
                {clock.daysLeft < 0 ? c.dOver.replace("{n}", String(-clock.daysLeft)) : c.dueOn.replace("{n}", String(clock.daysLeft))}
              </b>
            </div>
            <span className="lfd-bar">
              <i
                className={clock.isExtended && !clock.isDueSoon ? "is-ext" : undefined}
                style={{ width: `${Math.min(100, Math.round((clock.storedDays / Math.max(1, clock.storedDays + Math.max(clock.daysLeft, 0))) * 100))}%` }}
              />
            </span>
            <span className="lfd-clock__s">
              {c.storedNth.replace("{n}", String(clock.storedDays))} · {c.dueOnDate.replace("{n}", shortDate(clock.dueDate))} · {copy.handling.extendHint}
            </span>
          </div>
        ) : null}

        {item.memo ? <p className="mdw-desc">{item.memo}</p> : null}

        {item.guest_name ? (
          <dl className="mdw-dl">
            <dt>{c.guestShort}</dt>
            <dd>{item.guest_name}</dd>
          </dl>
        ) : null}

        {isTerminal ? (
          <section className="mdw-handle lfd-hist">
            <div className="lfd-hist__h">
              <span aria-hidden="true">
                <Check />
              </span>
              <b>{copy.handling.historyTitle}</b>
            </div>
            <dl className="mdw-dl lfd-hist__dl">
              <dt>{copy.handling.handledBy}</dt>
              <dd>
                {item.handled_by_name ?? (item.status === "disposed" ? c.sysAuto : "-")}
                {item.handled_at ? ` · ${formatDateTime(item.handled_at, locale)}` : ""}
              </dd>
              {item.status === "returned" && item.return_method ? (
                <>
                  <dt>{c.pMethod}</dt>
                  <dd>
                    {item.return_method === "delivery" ? c.methodDelivery : c.methodPickup}
                    {item.return_tracking_no ? ` · ${item.return_tracking_no}` : ""}
                  </dd>
                </>
              ) : null}
              {localizedHandlingMemo ? (
                <>
                  <dt>{c.memoShort}</dt>
                  <dd>{localizedHandlingMemo}</dd>
                </>
              ) : null}
            </dl>
            {item.handling_image_urls.length > 0 ? (
              <AnnouncementImageGrid imageUrls={item.handling_image_urls} closeLabel={dictionary.common.close} imageAltLabel={copy.handling.photosLabel} />
            ) : null}
            <p className="mdw-hint">{copy.handling.adminNote}</p>
          </section>
        ) : (
          <LostFoundHandlingForm
            canHandle={canHandle}
            copy={copy}
            handlerName={session.user.name}
            imgCopy={dictionary.requestImages}
            initialMemo={localizedHandlingMemo ?? ""}
            initialStatus={item.status}
            itemId={item.id}
            itemName={item.item_name}
            organizationId={session.organization.id}
          />
        )}
      </div>
    </MobileShell>
  );
}
