import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  ChevronRight,
  Package,
  QrCode,
  Search,
  Shirt,
  Sparkles,
  Timer,
  Wrench,
} from "lucide-react";
import {
  HomeCheckInOut,
  type HomeReservationItem,
} from "@/components/mobile/home-checkinout";
import { HomeElapsedTimer } from "@/components/mobile/home-elapsed-timer";
import { HomeRefreshButton } from "@/components/mobile/home-refresh-button";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getCurrentOpenSession } from "@/lib/attendance-sessions";
import { getDictionary } from "@/lib/i18n";
import { getMobileNotificationBadge } from "@/lib/nav-badges";
import {
  formatActivityTimeJst,
  getHomeActiveCleaningSession,
  getHomeCheckInOutReservations,
  getHomeTodayActivity,
  type HomeActivityEvent,
  type HomeReservationRow,
} from "@/lib/home";
import { getHomeImportantAnnouncement } from "@/lib/announcements";
import {
  CANONICAL_TO_BUILDING_KEY,
  getCanonicalPropertyName,
  getDisplayRoomLabel,
} from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext, type AppSession } from "@/lib/session";
import type { Dictionary, Locale } from "@/lib/i18n";
import "@/components/mobile/home-screen.css";
import { Beds24LiveRefresh } from "@/components/shared/beds24-live-refresh";
import { FoldyLoader } from "@/components/shared/foldy-loader";

type QuickActionItem = {
  colorClass: "a" | "b" | "c" | "d";
  href: string;
  Icon: typeof Sparkles;
  id: string;
  label: string;
};

// Build a localized "building room" label from a reservation's raw property + room.
function buildPlaceLabel(
  propertyName: string,
  roomLabel: string,
  buildingLabels: Record<string, string>,
): string {
  const canonicalProperty = getCanonicalPropertyName(propertyName);
  const buildingKey = CANONICAL_TO_BUILDING_KEY[canonicalProperty];
  const building = (buildingKey && buildingLabels[buildingKey]) || propertyName;
  return roomLabel ? `${building} ${roomLabel}`.trim() : building;
}

function toReservationItems(
  rows: HomeReservationRow[],
  buildingLabels: Record<string, string>,
): HomeReservationItem[] {
  return rows.map((row) => ({
    id: row.id,
    guestName: row.guestName,
    place: buildPlaceLabel(row.propertyName, row.roomLabel, buildingLabels),
    source: row.source,
  }));
}

function localizeRoomLabel(rawRoom: string, buildingLabels: Record<string, string>): string {
  const canonicalProperty = getCanonicalPropertyName(rawRoom);
  const buildingKey = CANONICAL_TO_BUILDING_KEY[canonicalProperty];
  if (!buildingKey) return rawRoom;
  const localizedBuilding = buildingLabels[buildingKey];
  if (!localizedBuilding) return rawRoom;
  const roomPart = rawRoom.slice(canonicalProperty.length).trim();
  // Collapse Arakicho sub-units (201_2 → 201) so the label matches every other room-facing screen.
  const displayRoom = roomPart ? getDisplayRoomLabel(canonicalProperty, roomPart) : "";
  return displayRoom ? `${localizedBuilding} ${displayRoom}` : localizedBuilding;
}

// Activity-event → log-row icon accent (mirrors the timeline dot meaning of the
// previous home so each event type stays distinguishable across the redesign).
function getActivityLogClass(event: HomeActivityEvent): string {
  if (event.type === "lost_item_reported") return "lost";
  if (event.type === "maintenance_reported") return "maint";
  if (event.type === "order_requested") return "order";
  if (event.type === "linen_returned") return "linen";
  return "cleaning";
}

function getActivityLogIcon(event: HomeActivityEvent) {
  if (event.type === "lost_item_reported") return <Search aria-hidden="true" />;
  if (event.type === "maintenance_reported") return <Wrench aria-hidden="true" />;
  if (event.type === "order_requested") return <Package aria-hidden="true" />;
  if (event.type === "linen_returned") return <Shirt aria-hidden="true" />;
  return <Sparkles aria-hidden="true" />;
}

function resolveCleaningTaskLabel(
  rawTaskLabel: string | undefined,
  taskOptions: Record<string, string> | undefined,
): string | undefined {
  if (!rawTaskLabel) return undefined;
  if (!taskOptions) return rawTaskLabel;
  return taskOptions[rawTaskLabel] ?? rawTaskLabel;
}

function getActivityLabel(
  event: HomeActivityEvent,
  dict: Dictionary["mobile"],
  taskOptions: Record<string, string> | undefined,
): string {
  switch (event.type) {
    case "cleaning_completed":
      return dict.homeActivityCleaningCompleted(
        event.room,
        resolveCleaningTaskLabel(event.taskLabel, taskOptions),
      );
    case "lost_item_reported":
      return dict.homeActivityLostItemReported(event.room);
    case "maintenance_reported":
      return dict.homeActivityMaintenanceReported(event.room);
    case "order_requested":
      return dict.homeActivityOrderRequested(event.room);
    case "linen_returned":
      return dict.homeActivityLinenReturned(event.room);
  }
}

const GREETING_LOCALE_TAG: Record<Locale, string> = {
  ko: "ko-KR",
  ja: "ja-JP",
  en: "en-US",
};

function formatGreetingDate(locale: Locale): string {
  return new Intl.DateTimeFormat(GREETING_LOCALE_TAG[locale] ?? "ko-KR", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

/**
 * Streaming boundary — the data-heavy body of the home screen.
 *
 * The shell + greeting render immediately (they only need the already-resolved session), while this
 * component's Supabase reads (check-in/out, today's activity, active cleaning, announcement, open
 * attendance session) run and stream in behind a Suspense skeleton. This keeps the cold-start "first
 * paint" fast without going stale — the data is still fetched fresh on every load, just not blocking
 * the initial byte. See docs/planning/06-current-status.md → 2026-07-22 PWA cold start.
 */
async function HomeBody({
  session,
  dictionary,
}: {
  session: AppSession;
  dictionary: Dictionary;
}) {
  const m = dictionary.mobile;
  const a = dictionary.attendance;

  const [checkInOut, todayActivity, activeSession, latestAnnouncement, openAttendanceSession] =
    await Promise.all([
      getHomeCheckInOutReservations(session),
      getHomeTodayActivity(session, 10),
      getHomeActiveCleaningSession(session),
      getHomeImportantAnnouncement(session),
      getCurrentOpenSession(session.organization.id, session.user.id),
    ]);

  const buildingLabels = dictionary.cleaning.buildingLabels;

  const quickActionItems: QuickActionItem[] = [
    {
      id: "cleaning",
      label: m.quickActions.cleaning,
      href: "/mobile/cleaning",
      Icon: Sparkles,
      colorClass: "a",
    },
    {
      id: "maintenance",
      label: m.quickActions.maintenance,
      href: "/mobile/maintenance/new",
      Icon: Wrench,
      colorClass: "b",
    },
    {
      id: "lostItem",
      label: m.quickActions.lostItem,
      href: "/mobile/lost-found/new",
      Icon: Search,
      colorClass: "c",
    },
    {
      id: "order",
      label: m.quickActions.order,
      href: "/mobile/orders/new",
      Icon: Bell,
      colorClass: "d",
    },
  ];

  const announcementHref = latestAnnouncement
    ? `/mobile/announcements/${latestAnnouncement.id}`
    : "/mobile/announcements";

  return (
    <div className="hm__grid">
      <div className="hm__blk hm__blk--hero">
        {/* 넓은 화면에서만 보이는 칸 제목(2026-10-06) — 다른 칸(체크인/아웃 · 오늘 기록)과 제목 · 카드 윗선을 맞춘다. 폰은 숨김. */}
        <div className="hm__sectt hm__wide-only">{a.pageTitle}</div>
        {/* Quick attendance hero — reflects the real open attendance session state. */}
        <Link
          aria-label={openAttendanceSession ? m.homeClockOpenTitle : m.homeClockIdleTitle}
          className="hm__clockhero"
          href="/mobile/attendance"
        >
          <div className="hm__ch-top">
            <span className={`hm__ch-state${openAttendanceSession ? " is-on" : ""}`}>
              <i aria-hidden="true" />
              {openAttendanceSession
                ? (openAttendanceSession.openBreakStartedAt ? a.ringOnBreak : a.ringWorking)
                : m.homeClockBefore}
            </span>
            <span className="hm__ch-tag">{m.homeClockMethodQr}</span>
          </div>
          {openAttendanceSession?.clockInAt ? (
            <div className="hm__ch-big hm__ch-big--timer mono">
              <HomeElapsedTimer startedAt={openAttendanceSession.clockInAt} />
            </div>
          ) : (
            <div className="hm__ch-big">{m.homeClockIdleTitle}</div>
          )}
          <div className="hm__ch-sub">
            {openAttendanceSession
              ? (openAttendanceSession.openBreakStartedAt ? m.homeClockBreakSub : m.homeClockOpenSub)
              : m.homeClockIdleSub}
          </div>
          {openAttendanceSession ? (
            <div className="hm__ch-meta">
              <div className="hm__ch-meta-item">
                <span className="hm__ch-meta-k">{a.clockInSite}</span>
                <span className="hm__ch-meta-v">{openAttendanceSession.siteName}</span>
              </div>
              <div className="hm__ch-meta-item">
                <span className="hm__ch-meta-k">{a.clockInTime}</span>
                <span className="hm__ch-meta-v mono">{openAttendanceSession.clockInTimeLabel}</span>
              </div>
            </div>
          ) : null}
          <span className="hm__ch-btn">
            {openAttendanceSession ? null : (
              <span className="ic">
                <QrCode aria-hidden="true" />
              </span>
            )}
            {openAttendanceSession ? m.homeClockOpenCta : m.homeClockIn}
          </span>
        </Link>

      </div>
      <div className="hm__blk hm__blk--notice">
        {/* Important announcement */}
        {latestAnnouncement ? (
          <Link aria-label={latestAnnouncement.title} href={announcementHref}>
            <div className="hm__notice">
              <div className="hm__notice-b">
                <div className="hm__notice-h">
                  <span className="hm__notice-cat">{m.homeAnnouncementTitle}</span>
                  <span className="hm__notice-badge">{m.homeAnnouncementImportant}</span>
                </div>
                <div className="hm__notice-t">{latestAnnouncement.title}</div>
              </div>
              <ChevronRight aria-hidden="true" className="hm__notice-chev" />
            </div>
          </Link>
        ) : null}

      </div>
      <div className="hm__blk hm__blk--stats">
        {/* Today's check-in / check-out — cards tap to open a detail sheet */}
        <div className="hm__sectt">{m.homeStatsSectionLabel}</div>
        <section aria-label={m.homeStatsSectionLabel}>
          {checkInOut.status === "ok" ? (
            <HomeCheckInOut
              checkInLabel={dictionary.admin.stats.checkIns}
              checkOutLabel={dictionary.admin.stats.checkOuts}
              checkIns={toReservationItems(checkInOut.data.checkIns, buildingLabels)}
              checkOuts={toReservationItems(checkInOut.data.checkOuts, buildingLabels)}
              emptyCheckIn={m.homeCheckInEmpty}
              emptyCheckOut={m.homeCheckOutEmpty}
              guestFallback={m.homeGuestUnknown}
            />
          ) : (
            <div className="hm__stats">
              <div className="hm__stat hm__stat--full">
                <p className="hm__stat-k">{m.homeSectionLoadError}</p>
                <HomeRefreshButton label={m.homeRetry} className="hm__state-cta" />
              </div>
            </div>
          )}
        </section>

      </div>
      <div className="hm__blk hm__blk--task">
        {/* Active cleaning task */}
        <div className="hm__sectt">{m.homeActiveTaskTitle}</div>
        <section aria-label={m.homeActiveTaskTitle}>
          {activeSession.status === "ok" ? (
            <div className="hm__task">
              <span className="hm__task-ic">
                <Timer aria-hidden="true" />
              </span>
              <div className="hm__task-b">
                <div className="hm__task-t">{localizeRoomLabel(activeSession.data.room_label, dictionary.cleaning.buildingLabels)}</div>
                <div className="hm__task-s">{activeSession.data.task_label}</div>
              </div>
              <div className="hm__task-right">
                <div className="hm__task-rk">{m.homeActiveTaskElapsed}</div>
                <div className="hm__task-rv">
                  <HomeElapsedTimer startedAt={activeSession.data.started_at} />
                </div>
              </div>
            </div>
          ) : activeSession.status === "error" ? (
            <div className="hm__taskempty">
              <div className="hm__taskempty-s" style={{ marginTop: 0 }}>
                {m.homeSectionLoadError}
              </div>
              <HomeRefreshButton label={m.homeRetry} className="hm__state-cta" />
            </div>
          ) : (
            <div className="hm__taskempty">
              <div className="hm__taskempty-t">{m.homeActiveTaskNone}</div>
              <div className="hm__taskempty-s">{m.homeActiveTaskNoneBody}</div>
            </div>
          )}
        </section>

      </div>
      <div className="hm__blk hm__blk--qa">
        {/* Quick actions */}
        <div className="hm__sectt-row">
          <span className="hm__sectt">{m.homeQuickActionsTitle}</span>
        </div>
        <nav className="hm__qa" aria-label={m.homeQuickActionsTitle}>
          {quickActionItems.map((action) => (
            <Link className="hm__qa-item" href={action.href} key={action.id}>
              <span className={`hm__qa-ic ${action.colorClass}`}>
                <action.Icon aria-hidden="true" />
              </span>
              <span className="hm__qa-lbl">{action.label}</span>
            </Link>
          ))}
        </nav>

      </div>
      <div className="hm__blk hm__blk--log">
        {/* Today's activity timeline */}
        <div className="hm__sectt-row">
          <span className="hm__sectt">{m.homeTodayActivityTitle}</span>
        </div>
        <section aria-label={m.homeTodayActivityTitle}>
          {todayActivity.status === "error" ? (
            <div className="hm__log">
              <div className="hm__state-msg">
                <p>{m.homeSectionLoadError}</p>
                <HomeRefreshButton label={m.homeRetry} className="hm__state-cta" />
              </div>
            </div>
          ) : todayActivity.status === "empty" ? (
            <div className="hm__log">
              <div className="hm__state-msg">
                <p>{m.homeActivityEmpty}</p>
              </div>
            </div>
          ) : (
            <div className="hm__log">
              {todayActivity.data.map((event) => {
                const localizedRoom = localizeRoomLabel(
                  event.room,
                  dictionary.cleaning.buildingLabels,
                );
                return (
                  <div className="hm__log-r" key={event.id}>
                    <span className={`hm__log-ic ${getActivityLogClass(event)}`}>
                      {getActivityLogIcon(event)}
                    </span>
                    <div className="hm__log-b">
                      <div className="hm__log-t">
                        {getActivityLabel(
                          { ...event, room: localizedRoom },
                          m,
                          dictionary.cleaning?.taskOptions,
                        )}
                      </div>
                    </div>
                    <span className="hm__log-time">
                      {formatActivityTimeJst(event.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


export default async function MobileHomePage() {
  const session = await getCurrentAppSession();

  if (!session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const m = dictionary.mobile;

  const navBadges = await getMobileNotificationBadge();

  const greetDate = formatGreetingDate(locale);
  const userName = session.user.name?.trim() || "";

  return (
    // 넓은 화면(폴드 · 태블릿)은 카드를 열로 나눠 쓴다(`home-screen.css` `.hm__grid` — 2026-10-05 시안 6b · 6c).
    <MobileShell activeItem="home" badges={navBadges} title={m.homeTitle} wide>
      <Beds24LiveRefresh organizationId={session.organization.id} />
      {/* 앱을 켤 때(세션당 한 번) 스플래시 — 시안 Motion-B-Splash-Phone */}
      <div className="hm pb-2">
        {/* Greeting — renders immediately with the shell (no data reads). */}
        <div className="hm__greet">
          <div>
            <div className="hm__greet-d">{greetDate}</div>
            <div className="hm__greet-n">{m.homeGreeting(userName)}</div>
          </div>
        </div>


        {/* Data-heavy sections stream in behind a skeleton so first paint stays fast. */}
        <Suspense fallback={<FoldyLoader />}>
          <HomeBody session={session} dictionary={dictionary} />
        </Suspense>
      </div>

      <div className="sr-only">
        {m.today}
        {m.snapshotTitle}
        {m.snapshotDescription}
        {m.ready}
      </div>
    </MobileShell>
  );
}
