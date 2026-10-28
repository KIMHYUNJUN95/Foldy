"use server";

// 게스트 피드백 Excel / PDF 내보내기 (2026-10-28, 시안 캔버스 92CCRr…).
//
// 공용 계약(CLAUDE.md §4b): 버튼은 <AdminExportButtons>, 워크북은 buildAdminTableWorkbookBase64,
// 인쇄본은 buildAdminTableReportHtml — 같은 입력 한 벌. 로케일은 buildAdminExportMeta(session) 가 서버에서 정한다.
//
// 결정(2026-10-28 사용자 「추천대로」):
//  - 지금 보고 있는 보기 하나 · 지금 고르기 그대로. 클라이언트는 **쿼리만** 넘기고, 행은 서버가 다시 읽는다
//    (화면에 펼친 「더 보기」 한도와 무관하게 조건에 맞는 전부).
//  - 번역 열은 이미 저장된 번역만(새로 번역하지 않음 — 비용).
//  - 비공개 피드백은 넣지 않는다 — 목록 · 집계 쿼리가 일부러 빼는 열이다(docs/engineering/05-rls-permissions.md).
//  - 내보내기는 `complaint.manage`(기본: 대표 · 전무 · CS 관리자)만 — 파일에 게스트 이름 · 예약 번호가 담긴다.
//  - 수동 컴플레인 처리 기록은 개수 + 마지막 한 줄.
// 도메인 계약: docs/product/25-complaint-workflow.md → 「Excel · PDF 내보내기」.

import { getAdminSessionForApi } from "@/lib/admin-session";
import {
  buildAdminExportMeta,
  compactRangePart,
  type AdminExportMeta,
} from "@/lib/admin-export-meta";
import type { AdminReportExportResult, AdminWorkbookExportResult } from "@/lib/admin-export-result";
import { buildAdminTableReportHtml } from "@/lib/admin-table-report";
import {
  buildAdminTableWorkbookBase64,
  type AdminTableColumn,
  type AdminTableExportRow,
  type AdminTableSheet,
} from "@/lib/admin-table-workbook";
import {
  canModerateComplaints,
  listComplaintCommentDigests,
  listComplaints,
  type Complaint,
} from "@/lib/complaints";
import {
  REVIEW_SCALE,
  listExternalReviews,
  listReviewBuildingOptions,
  summarizeReviewsByPlace,
  type BuildingSummary,
  type PlaceSummary,
  type PlatformStat,
  type ReviewListFilter,
} from "@/lib/external-reviews";
import { reviewRoomFallbackLabel } from "@/lib/external-review-rules";
import { defaultReviewRange } from "@/lib/external-review-pages";
import { getStoredTranslationsForReviews } from "@/lib/review-translate";
import { getDictionary, type Dictionary } from "@/lib/i18n";
import type { AppSession } from "@/lib/session";
import { tokyoDateOf, tokyoToday } from "@/lib/tokyo-date";
import {
  getCanonicalPropertyName,
  localizePropertyName,
  localizeRoomPlaceLabel,
} from "@/lib/room-label-normalization";
import { PLATFORMS, type ComplaintPlatform } from "@/components/complaints/cx-platform";

/** 콘솔 주소의 쿼리 그대로(`ComplaintsConsole` 의 `query`). 서버가 하나씩 다시 검증한다. */
export type ComplaintsExportQuery = Record<string, string>;

type View = "reviews" | "manual" | "rooms";
type Copy = Dictionary["complaints"];
type Built = { sheet: AdminTableSheet; filename: string };

const PROVIDER_LABEL: Record<"airbnb" | "booking", string> = { airbnb: "Airbnb", booking: "Booking.com" };
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)), template);
}

function viewOf(query: ComplaintsExportQuery): View {
  return query.view === "manual" || query.view === "rooms" ? query.view : "reviews";
}

function rangeOf(query: ComplaintsExportQuery) {
  const fallback = defaultReviewRange();
  return {
    from: DATE_KEY.test(query.from ?? "") ? query.from : fallback.from,
    to: DATE_KEY.test(query.to ?? "") ? query.to : fallback.to,
  };
}

function fmtDay(value: string, localeTag: string): string {
  return new Intl.DateTimeFormat(localeTag, { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(
    new Date(`${value}T00:00:00+09:00`),
  );
}

/** 제목 앞 라벨 — 기간 · 고른 조건. 파일만 봐도 무엇을 뽑았는지 알 수 있어야 한다. */
function scopeLabel(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}

function platformName(platform: ComplaintPlatform, copy: Copy): string {
  if (platform === "direct") return copy.platformDirect;
  if (platform === "other") return copy.platformOther;
  return PLATFORMS[platform]?.name ?? platform;
}

/** 긴 처리 기록은 첫 줄 앞부분만 — 「마지막 한 줄」. */
function firstLine(text: string | null): string {
  const line = (text ?? "").split("\n").find((part) => part.trim())?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

async function guard(): Promise<{ ok: true; session: AppSession } | { ok: false }> {
  const auth = await getAdminSessionForApi();
  if (!auth.ok || !canModerateComplaints(auth.session)) return { ok: false };
  return { ok: true, session: auth.session };
}

// ── 외부 리뷰 ─────────────────────────────────────────────

async function reviewsSheet(session: AppSession, query: ComplaintsExportQuery, meta: AdminExportMeta): Promise<Built> {
  const copy = getDictionary(meta.locale).complaints;
  const buildingLabels = getDictionary(meta.locale).cleaning.buildingLabels;
  const { from, to } = rangeOf(query);
  const provider = query.provider === "airbnb" || query.provider === "booking" ? query.provider : undefined;

  const buildingOptions = await listReviewBuildingOptions({ session, locale: meta.locale });
  const building = buildingOptions.find((option) => option.value === query.building?.trim()) ?? null;
  const roomLabel = building ? query.rl?.trim() || null : null;
  const filter: ReviewListFilter = {
    from,
    to,
    riskOnly: query.risk === "1",
    provider,
    propertyIds: building ? building.propertyIds : undefined,
  };
  const all = await listExternalReviews({ session, filter });
  // 객실은 표시 라벨로 거른다 — 콘솔 목록과 같은 규칙(page.tsx).
  const reviews = roomLabel ? all.filter((review) => review.displayRoomLabel === roomLabel) : all;
  const translations = await getStoredTranslationsForReviews({
    externalReviewIds: reviews.map((review) => review.id),
    targetLocale: meta.locale,
  });

  const columns: AdminTableColumn[] = [
    { key: "date", label: copy.exportColReviewDate, width: 12, printWidth: 7 },
    { key: "platform", label: copy.wColPlatform, width: 12, printWidth: 7 },
    { key: "score", label: copy.exportColScore, width: 8, printWidth: 5, bold: true },
    { key: "low", label: copy.riskOnly, width: 9, printWidth: 5 },
    { key: "building", label: copy.metaBuilding, width: 12, printWidth: 7 },
    { key: "room", label: copy.metaRoom, width: 10, printWidth: 6 },
    { key: "guest", label: copy.exportColGuest, width: 14, printWidth: 7 },
    { key: "reservation", label: copy.exportColReservation, width: 14, printWidth: 8 },
    { key: "headline", label: copy.exportColHeadline, width: 20, printWidth: 9, wrap: true },
    { key: "review", label: copy.exportColReview, width: 44, printWidth: 16, wrap: true },
    { key: "negative", label: copy.exportColNegative, width: 30, printWidth: 10, wrap: true },
    { key: "translation", label: copy.exportColTranslation, width: 40, printWidth: 9, wrap: true },
  ];

  const rows: AdminTableExportRow[] = reviews.map((review) => {
    const parts = translations.get(review.id) ?? {};
    const room = review.displayRoomLabel ?? reviewRoomFallbackLabel(review, copy);
    return {
      date: tokyoDateOf(review.reviewedAt) ?? "",
      platform: PROVIDER_LABEL[review.provider],
      score: review.ratingValue === null ? "" : `${review.ratingValue} / ${REVIEW_SCALE[review.provider]}`,
      low: review.riskLevel === "risk" ? copy.exportLowMark : "",
      building: review.propertyName
        ? localizePropertyName(getCanonicalPropertyName(review.propertyName), buildingLabels)
        : "",
      room: localizeRoomPlaceLabel(room, buildingLabels),
      guest: review.guestDisplayName ?? "",
      reservation: review.sourceReservationId ?? "",
      headline: review.headline ?? "",
      review: review.reviewText ?? review.positiveReviewText ?? "",
      negative: review.negativeReviewText ?? "",
      translation: [parts.headline, parts.review, parts.positive, parts.negative].filter(Boolean).join("\n"),
    };
  });

  const lowCount = reviews.filter((review) => review.riskLevel === "risk").length;
  return {
    sheet: {
      sheetName: copy.viewReviews,
      title: copy.exportReviewsTitle,
      rangeLabel: scopeLabel([
        `${fmtDay(from, meta.localeTag)} – ${fmtDay(to, meta.localeTag)}`,
        provider ? PROVIDER_LABEL[provider] : null,
        building?.label,
        roomLabel ? localizeRoomPlaceLabel(roomLabel, buildingLabels) : null,
        query.risk === "1" ? copy.riskOnly : null,
      ]),
      colNoLabel: meta.shared.colNo,
      totalLabel: meta.shared.exportTotalLabel,
      columns,
      rows,
      totals: { low: fill(copy.exportCountN, { n: lowCount }) },
    },
    filename: `guest-feedback_reviews_${compactRangePart(from)}_${compactRangePart(to)}.xlsx`,
  };
}

// ── 수동 컴플레인 ─────────────────────────────────────────

async function manualSheet(session: AppSession, query: ComplaintsExportQuery, meta: AdminExportMeta): Promise<Built> {
  const copy = getDictionary(meta.locale).complaints;
  const buildingLabels = getDictionary(meta.locale).cleaning.buildingLabels;
  const status = query.st === "open" || query.st === "done" ? query.st : "all";
  const platform = query.mp?.trim() || "all";
  const author = query.author?.trim() || "all";
  const building = query.building?.trim() || null;

  const complaints = await listComplaints({ session });
  // 콘솔 ManualView 와 같은 고르기 · 순서(미처리 먼저, 그 안에서 최근 등록 순).
  const rows: Complaint[] = complaints
    .filter((complaint) => {
      if (status === "open" && complaint.status !== "open") return false;
      if (status === "done" && complaint.status === "open") return false;
      if (platform !== "all" && complaint.platform !== platform) return false;
      if (author !== "all" && complaint.createdByUserId !== author) return false;
      if (building && (!complaint.propertyName || getCanonicalPropertyName(complaint.propertyName) !== building)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  const digests = await listComplaintCommentDigests({ session, complaintIds: rows.map((complaint) => complaint.id) });

  const columns: AdminTableColumn[] = [
    { key: "status", label: copy.wColStatus, width: 9, printWidth: 6 },
    { key: "registered", label: copy.exportColRegistered, width: 12, printWidth: 7 },
    { key: "platform", label: copy.wColPlatform, width: 12, printWidth: 7 },
    { key: "rating", label: copy.fieldRating, width: 7, printWidth: 5, bold: true },
    { key: "building", label: copy.metaBuilding, width: 12, printWidth: 7 },
    { key: "room", label: copy.metaRoom, width: 10, printWidth: 6 },
    { key: "guest", label: copy.exportColGuest, width: 14, printWidth: 7 },
    { key: "title", label: copy.wColTitle, width: 24, printWidth: 11, wrap: true },
    { key: "description", label: copy.wContent, width: 44, printWidth: 19, wrap: true },
    { key: "author", label: copy.authorLabel, width: 12, printWidth: 7 },
    { key: "logCount", label: copy.exportColLogCount, width: 9, printWidth: 5, bold: true },
    { key: "logLast", label: copy.exportColLogLast, width: 36, printWidth: 13, wrap: true },
  ];

  const authorName = author !== "all" ? complaints.find((complaint) => complaint.createdByUserId === author)?.authorName : null;
  const buildingName = building ? localizePropertyName(building, buildingLabels) : null;

  return {
    sheet: {
      sheetName: copy.viewManual,
      title: copy.exportManualTitle,
      rangeLabel: scopeLabel([
        status === "open" ? copy.statusOpen : status === "done" ? copy.wDoneTab : null,
        platform !== "all" ? platformName(platform as ComplaintPlatform, copy) : null,
        buildingName,
        authorName,
      ]),
      colNoLabel: meta.shared.colNo,
      totalLabel: meta.shared.exportTotalLabel,
      columns,
      rows: rows.map((complaint) => {
        const digest = digests.get(complaint.id);
        return {
          status: complaint.status === "open" ? copy.statusOpen : copy.wDoneTab,
          registered: tokyoDateOf(complaint.createdAt) ?? "",
          platform: platformName(complaint.platform, copy),
          rating: complaint.rating === null ? "" : String(complaint.rating),
          building: complaint.propertyName
            ? localizePropertyName(getCanonicalPropertyName(complaint.propertyName), buildingLabels)
            : "",
          room: complaint.roomLabel ? localizeRoomPlaceLabel(complaint.roomLabel, buildingLabels) : "",
          guest: complaint.guestName ?? "",
          title: complaint.title,
          description: complaint.description ?? "",
          author: complaint.authorName,
          logCount: fill(copy.exportCountN, { n: digest?.count ?? 0 }),
          logLast: firstLine(digest?.lastContent ?? null),
        };
      }),
      totals: { logCount: fill(copy.exportCountN, { n: rows.reduce((sum, c) => sum + (digests.get(c.id)?.count ?? 0), 0) }) },
    },
    filename: `guest-feedback_manual_${compactRangePart(tokyoToday())}.xlsx`,
  };
}

// ── 건물 · 객실별 ─────────────────────────────────────────

function avg(stat: PlatformStat, digits: number): string {
  return stat.average === null ? "" : stat.average.toFixed(digits);
}

async function roomsSheet(session: AppSession, query: ComplaintsExportQuery, meta: AdminExportMeta): Promise<Built> {
  const copy = getDictionary(meta.locale).complaints;
  const { from, to } = rangeOf(query);
  const byRoom = query.by === "room";
  const byCount = query.sort === "count";
  const summaries = await summarizeReviewsByPlace({ session, from, to, locale: meta.locale });

  // 콘솔 RoomsView 와 같은 정렬 — 낮은 평점 비율(기본) 또는 건수, 높은 순.
  const sortKey = (place: PlaceSummary) => (byCount ? place.riskCount : place.riskRatio ?? -1);
  const sorted = <T extends PlaceSummary>(list: T[]) => [...list].sort((a, b) => sortKey(b) - sortKey(a));

  type Line = { place: PlaceSummary; name: string; building: string };
  const label = (building: BuildingSummary) => building.label || building.name;
  // 객실별: 모든 건물의 객실을 한 줄로(독채 · 객실 없는 건물은 건물 한 줄). 건물별: 건물 줄 아래 그 객실들.
  const lines: Line[] = byRoom
    ? summaries
        .flatMap((building): Line[] =>
          building.rooms.length === 0
            ? [{ place: building, name: label(building), building: building.standalone ? copy.standalone : "" }]
            : building.rooms.map((room) => ({ place: room, name: room.name, building: label(building) })),
        )
        .sort((a, b) => sortKey(b.place) - sortKey(a.place))
    : sorted(summaries).flatMap((building) => [
        { place: building, name: label(building), building: "" },
        ...sorted(building.rooms).map((room) => ({ place: room, name: room.name, building: label(building) })),
      ]);

  const columns: AdminTableColumn[] = [
    { key: "place", label: byRoom ? copy.wColRoomPlace : copy.colPlace, width: 16, printWidth: 16 },
    { key: "building", label: copy.metaBuilding, width: 14, printWidth: 12 },
    { key: "aAvg", label: fill(copy.exportColAvg, { platform: "Airbnb" }), width: 12, printWidth: 9, bold: true },
    { key: "aCount", label: fill(copy.exportColReviews, { platform: "Airbnb" }), width: 12, printWidth: 9 },
    { key: "aLow", label: fill(copy.exportColLow, { platform: "Airbnb" }), width: 14, printWidth: 9 },
    { key: "bAvg", label: fill(copy.exportColAvg, { platform: "Booking.com" }), width: 16, printWidth: 10, bold: true },
    { key: "bCount", label: fill(copy.exportColReviews, { platform: "Booking.com" }), width: 16, printWidth: 10 },
    { key: "bLow", label: fill(copy.exportColLow, { platform: "Booking.com" }), width: 18, printWidth: 10 },
    { key: "ratio", label: copy.colRiskRatio, width: 12, printWidth: 11, bold: true },
  ];

  const total = (key: "airbnb" | "booking", field: "reviewCount" | "riskCount") =>
    String(summaries.reduce((sum, building) => sum + building[key][field], 0));

  return {
    sheet: {
      sheetName: copy.viewRooms,
      title: copy.exportRoomsTitle,
      rangeLabel: scopeLabel([
        `${fmtDay(from, meta.localeTag)} – ${fmtDay(to, meta.localeTag)}`,
        byRoom ? copy.wByRoom : copy.wByBuilding,
      ]),
      colNoLabel: meta.shared.colNo,
      totalLabel: meta.shared.exportTotalLabel,
      columns,
      rows: lines.map(({ place, name, building }) => ({
        place: name,
        building,
        aAvg: avg(place.airbnb, 2),
        aCount: String(place.airbnb.reviewCount),
        aLow: String(place.airbnb.riskCount),
        bAvg: avg(place.booking, 1),
        bCount: String(place.booking.reviewCount),
        bLow: String(place.booking.riskCount),
        ratio: place.riskRatio === null ? "" : `${Math.round(place.riskRatio)}%`,
      })),
      // 건물 줄만 더한다(객실 줄은 건물 안에 이미 들어 있다). 두 플랫폼 평균은 척도가 달라 합치지 않는다.
      totals: {
        aCount: total("airbnb", "reviewCount"),
        aLow: total("airbnb", "riskCount"),
        bCount: total("booking", "reviewCount"),
        bLow: total("booking", "riskCount"),
      },
    },
    filename: `guest-feedback_rooms_${compactRangePart(from)}_${compactRangePart(to)}.xlsx`,
  };
}

function build(session: AppSession, query: ComplaintsExportQuery, meta: AdminExportMeta): Promise<Built> {
  const view = viewOf(query);
  if (view === "manual") return manualSheet(session, query, meta);
  if (view === "rooms") return roomsSheet(session, query, meta);
  return reviewsSheet(session, query, meta);
}

export async function exportComplaintsWorkbook(query: ComplaintsExportQuery): Promise<AdminWorkbookExportResult> {
  const auth = await guard();
  if (!auth.ok) return { ok: false, reason: "forbidden" };
  try {
    const meta = buildAdminExportMeta(auth.session);
    const { sheet, filename } = await build(auth.session, query, meta);
    if (sheet.rows.length === 0) return { ok: false, reason: "empty" };
    const base64 = await buildAdminTableWorkbookBase64({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      sheets: [sheet],
    });
    return { ok: true, filename, base64, rowCount: sheet.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function exportComplaintsReport(query: ComplaintsExportQuery): Promise<AdminReportExportResult> {
  const auth = await guard();
  if (!auth.ok) return { ok: false, reason: "forbidden" };
  try {
    const meta = buildAdminExportMeta(auth.session);
    const { sheet } = await build(auth.session, query, meta);
    if (sheet.rows.length === 0) return { ok: false, reason: "empty" };
    const html = buildAdminTableReportHtml({
      orgName: meta.orgName,
      generatedLabel: meta.generatedLabel,
      printLabel: meta.shared.exportPrint,
      localeTag: meta.localeTag,
      sheets: [sheet],
    });
    return { ok: true, html, rowCount: sheet.rows.length };
  } catch {
    return { ok: false, reason: "error" };
  }
}
