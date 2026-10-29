import { notFound, redirect } from "next/navigation";
import { AnnouncementImageGrid } from "@/components/announcements/announcement-image-grid";
import { MaintenanceHandlingForm } from "@/components/requests/maintenance-handling-form";
import { canHandleMaintenance } from "@/app/mobile/requests/maintenance/actions";
import { MobileShell } from "@/components/shell/mobile-shell";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  getMaintenanceReportById,
  isMaintenanceTerminal,
} from "@/lib/maintenance-reports";
import { getOnboardingState } from "@/lib/onboarding";
import { resolveRequestLocation } from "@/lib/request-location";
import { getActiveRoomCatalogServer } from "@/lib/rooms";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import "@/components/requests/maintenance-detail.css";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { requestLiveSources } from "@/lib/live-sources";

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

/** 「7/15 03:02」(도쿄) — 시안처럼 짧게. 해가 다르면 「2025/12/3 09:00」. */
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

export default async function MobileMaintenanceDetailPage({ params, searchParams }: PageProps) {
  const navBadgesPromise = getMobileNavBadges();
  const [state, session, { id }, query] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    params,
    searchParams,
  ]);

  if (state.status === "unauthenticated") {
    redirect(`/auth/login?next=${encodeURIComponent(`/mobile/requests/maintenance/${id}`)}`);
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }

  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }

  const locale = session.user.preferredLanguage;
  const dictionary = getDictionary(locale);
  const copy = dictionary.maintenance;

  const [report, roomCatalog] = await Promise.all([
    getMaintenanceReportById(session, id),
    getActiveRoomCatalogServer(session.organization.id).catch(() => undefined),
  ]);
  if (!report) {
    notFound();
  }

  // 「건물 전체」 신고는 room_label 이 아니라 is_building_only 로 그린다(2026-10-26) — 옛 건은 room_label 에 신고자 언어의
  // 「건물 전체」가 들어 있어서 그대로 그리면 다른 언어가 섞였다.
  const location = resolveRequestLocation(
    report.is_building_only ? "" : report.room_label,
    roomCatalog,
    dictionary.cleaning.buildingLabels,
    report.property_name,
  );
  const isTerminal = isMaintenanceTerminal(report.status);
  // 상태 변경 = part_time_staff 제외 전원 (docs/product/08-maintenance-workflow.md → Status Change
  // Permission) + `maintenance_status_change` 권한 예외를 받은 파트타이머. 서버 액션과 RLS가 최종
  // 게이트고, 여기서는 UI만 감춘다 — 판정은 서버 액션 모듈과 같은 함수를 쓴다.
  const canHandle = await canHandleMaintenance(
    session.organization.id,
    session.user.id,
    session.user.role,
  );
  const showCreatedBanner = query.created === "1";

  const navBadges = await navBadgesPromise;

  // 화이트 리디자인(2026-10-13, 시안 ReqDetail-Phone · Req-Tablet): 카드 · 아이콘 상자 · 배지 대신 위 한 줄(우선순위 · 상태 · 분류) →
  // 제목 → 「호실 · 건물 · 신고자 · 시각」 → (연결된 예약) → 사진 → 설명 → 정보 줄 → 처리 결과 → 현장 처리.
  const roomText = report.is_building_only
    ? copy.form.roomBuildingOnly
    : location.roomLabel && location.roomLabel !== "-"
      ? location.roomLabel
      : null;
  return (
    <MobileShell activeItem="requests" badges={navBadges} title={copy.detailTitle}>
      <LiveRefresh sources={requestLiveSources(session.organization.id)} />
      <div className="mdw">
        {showCreatedBanner ? <p className="mdw-created">{copy.createdSuccess}</p> : null}

        <div className="mdw-kick">
          <span className={`mdw-pri is-${report.priority}`}>{copy.form.urgencies[report.priority]}</span>
          <span>{copy.statusLabels[report.status]}</span>
          <span>{copy.form.categories[report.category]}</span>
          {report.cleaning_session_id ? <span className="mdw-from">{copy.fromCleaningTag}</span> : null}
        </div>
        <h1 className="mdw-title">{report.issue_title}</h1>
        <p className="mdw-sub">
          {roomText ? <b className="mono">{roomText}</b> : null}
          {[location.buildingLabel, report.reporter_name, formatDateTime(report.created_at, locale)]
            .filter(Boolean)
            .map((x, i) => (
              <span key={i}>{roomText || i > 0 ? ` · ${x}` : x}</span>
            ))}
        </p>

        {report.guest_name ? (
          <p className="mdw-warn">
            <span aria-hidden="true">!</span>
            {dictionary.tasks.contextLinkedSection} · {report.guest_name}
          </p>
        ) : null}

        <AnnouncementImageGrid imageUrls={report.image_urls} closeLabel={dictionary.common.close} imageAltLabel={dictionary.requestImages.attachments} />

        {report.description ? <p className="mdw-desc">{report.description}</p> : null}

        <dl className="mdw-dl">
          <dt>{dictionary.cleaning.manualBuildingLabel}</dt>
          <dd>{[location.buildingLabel, roomText].filter(Boolean).join(" · ") || "-"}</dd>
          <dt>{copy.form.categoryLabel}</dt>
          <dd>{copy.form.categories[report.category]}</dd>
          <dt>{copy.form.urgencyLabel}</dt>
          <dd className={report.priority === "urgent" ? "is-urgent" : undefined}>{copy.form.urgencies[report.priority]}</dd>
          {report.reservation_id ? (
            <>
              <dt>{dictionary.mobile.calendarReservationId}</dt>
              <dd className="mono">{report.reservation_id}</dd>
            </>
          ) : null}
          {isTerminal && report.completed_at ? (
            <>
              <dt>{copy.handling.completedAt}</dt>
              <dd>
                {formatDateTime(report.completed_at, locale)}
                {report.completed_by_name ? ` · ${report.completed_by_name}` : ""}
              </dd>
            </>
          ) : null}
        </dl>

        {report.completed_by_admin ? (
          <p className="mdw-note">{report.status === "cancelled" ? copy.handling.adminVoided : copy.handling.adminForced}</p>
        ) : null}

        {isTerminal && report.resolution_memo ? (
          <div className="mdw-block">
            <span className="mdw-k">{copy.handling.memoLabel}</span>
            <p className="mdw-desc">{report.resolution_memo}</p>
          </div>
        ) : null}
        {report.resolution_image_urls.length > 0 ? (
          <div className="mdw-block">
            <span className="mdw-k">{copy.handling.photosLabel}</span>
            <AnnouncementImageGrid imageUrls={report.resolution_image_urls} closeLabel={dictionary.common.close} imageAltLabel={copy.handling.photosLabel} />
          </div>
        ) : null}

        <MaintenanceHandlingForm
          canHandle={canHandle}
          copy={copy}
          existingPhotoCount={report.resolution_image_urls.length}
          imgCopy={dictionary.requestImages}
          initialMemo={report.resolution_memo ?? ""}
          initialStatus={report.status}
          organizationId={session.organization.id}
          reportId={report.id}
        />
      </div>
    </MobileShell>
  );
}
