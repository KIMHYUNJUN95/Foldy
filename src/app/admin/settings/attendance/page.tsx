import Link from "next/link";
import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { Check, Plus, Printer, TriangleAlert } from "lucide-react";
import {
  issueAttendanceSiteQr,
  revokeAttendanceTrustedDevice,
  saveAttendanceSiteSettings,
} from "@/app/admin/settings/attendance/actions";
import { AdminShell } from "@/components/shell/admin-shell";
import { SettingsSubnav } from "@/components/admin/settings/settings-subnav";
import { DdFormSelect } from "@/components/admin/shared/dd-form-select";
import { SettingsConfirm } from "@/components/admin/settings/settings-confirm";
import { SiteDangerActions } from "@/components/admin/settings/site-danger-actions";
import { SiteGeoFields } from "@/components/admin/settings/site-geo-fields";
import "@/components/admin/settings/settings-white.css";
import { requireAdminSession } from "@/lib/admin-session";
import { attendanceQrLinkState, buildAttendanceQrValue } from "@/lib/attendance-qr";
import {
  attendanceSiteHasHistory,
  getAttendanceSiteQrOverview,
  getQrTokenHistory,
  listAttendanceSiteProperties,
} from "@/lib/attendance-sites";
import { listTrustedDevices } from "@/lib/attendance-trusted-device";
import { getDictionary } from "@/lib/i18n";
import { hasOrganizationContext } from "@/lib/session";
import type { AttendanceSiteRow } from "@/lib/attendance";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatField(site: AttendanceSiteRow | null, key: "latitude" | "longitude") {
  if (!site) return "";
  return typeof site[key] === "number" ? String(site[key]) : String(site[key] ?? "");
}

/** 목록·이력의 날짜는 도쿄 기준으로 짧게. */
function tokyoDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Admin · 출퇴근 QR — 마스터·디테일 (2026-07-31 리디자인 → 2026-10-15 화이트 리디자인, 시안 Settings-PC).
//
// 2026-10-15: 상자 없는 표(현장 · 연결 건물 · 반경 · QR) + 오른쪽 패널(QR 먼저 → 편집 칸 → 변경 저장).
// 위도·경도·반경 확인은 SiteGeoFields, QR 다시 발급과 삭제는 확인 창(SettingsConfirm)을 거친다.
//
// 현장이 여러 곳인 현실을 정면으로 다룬다: 좌측 표에서 **전 현장의 QR 상태를 한눈에** 보고,
// 우측에서 선택한 한 곳을 관리한다(현장 정보 / QR / 기억된 기기). 린넨·청소 콘솔의
// 목록+상세 패턴과 같은 구조이고, 시각 표현은 공용 `.adm` 프리미티브를 그대로 쓴다.
//
// QR 은 인쇄물이라 "지금 뽑아도 되는가"를 출력 전에 알려주는 것이 이 화면의 핵심 책임이다.
// See docs/product/24-attendance-workflow.md → "QR Deep Link" / "인쇄 전 안전장치".
export default async function AdminAttendanceSettingsPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  if (!session.capabilities.includes("attendance.settings") || !hasOrganizationContext(session)) {
    redirect("/admin/settings?error=forbidden");
  }

  const params = (await searchParams) ?? {};
  const selectedSiteId = firstParam(params.site) ?? "";
  const dictionary = getDictionary(session.user.preferredLanguage);
  const settings = dictionary.admin.settings;
  const organizationId = session.organization.id;

  const rows = await getAttendanceSiteQrOverview(organizationId);
  // 비활성 현장은 기본으로 숨긴다. 선택 중인 현장이 비활성이면 목록에서 사라지지 않도록 강제로 켠다.
  const requestedInactive = firstParam(params.inactive) === "1";
  // `?site=new` 는 "선택 없음" = 신규 등록 폼. 그 외에는 선택된 현장, 없으면 첫 현장.
  const selectedRow =
    rows.find((row) => row.site.id === selectedSiteId) ?? (selectedSiteId ? null : rows[0] ?? null);
  const selectedSite = selectedRow?.site ?? null;
  const activeQr = selectedRow?.token ?? null;
  const showInactive = requestedInactive || (selectedSite ? !selectedSite.is_active : false);
  const visibleRows = showInactive ? rows : rows.filter((row) => row.site.is_active);
  const inactiveCount = rows.length - rows.filter((row) => row.site.is_active).length;

  // QR 에는 토큰이 아니라 절대 URL 을 담는다 — 휴대폰 기본 카메라로 찍으면 바로 인증 화면으로
  // 들어오게 하기 위해서다. 토큰 값 자체는 그대로라 기존 인쇄물도 앱 스캔에서 계속 동작한다.
  const qrValue = activeQr ? buildAttendanceQrValue(activeQr.token) : null;
  const qrSvg = qrValue ? await QRCode.toString(qrValue, { type: "svg", margin: 1, width: 256 }) : null;
  const qrLinkState = qrValue ? attendanceQrLinkState(qrValue) : null;

  const [history, trustedDevices, siteHasHistory, propertyOptions] = await Promise.all([
    selectedSite ? getQrTokenHistory(organizationId, selectedSite.id) : Promise.resolve([]),
    listTrustedDevices(organizationId),
    // 기록이 있으면 DB(FK restrict)가 삭제를 막는다 → 삭제 버튼 대신 비활성화만 노출한다.
    selectedSite ? attendanceSiteHasHistory(organizationId, selectedSite.id) : Promise.resolve(false),
    // 근무지를 어느 건물로 볼지 고르게 한다. 캘린더·교통비와 같은 건물 집합을 쓴다.
    listAttendanceSiteProperties(organizationId),
  ]);

  const saved = firstParam(params.saved) === "1";
  const issued = firstParam(params.issued) === "1";
  const reissued = firstParam(params.reissued) === "1";
  const deviceRevoked = firstParam(params.device_revoked) === "1";
  const siteDeleted = firstParam(params.site_deleted) === "1";
  const siteActivated = firstParam(params.site_activated) === "1";
  const siteDeactivated = firstParam(params.site_deactivated) === "1";
  const errorKey = firstParam(params.error);
  const flashMessage =
    (saved && settings.success.attendanceSiteSaved) ||
    (issued && settings.success.attendanceQrIssued) ||
    (reissued && settings.success.attendanceQrReissued) ||
    (deviceRevoked && settings.success.attendanceDeviceRevoked) ||
    (siteDeleted && settings.success.attendanceSiteDeleted) ||
    (siteActivated && settings.success.attendanceSiteActivated) ||
    (siteDeactivated && settings.success.attendanceSiteDeactivated) ||
    (errorKey ? settings.errors[errorKey] ?? settings.errors.save_failed : "");
  const flashIsError = Boolean(errorKey);
  const w = settings.white;
  const activeRows = rows.filter((row) => row.site.is_active);
  const readyCount = activeRows.filter(
    (row) => row.token && attendanceQrLinkState(buildAttendanceQrValue(row.token.token)) === "ok",
  ).length;
  const attentionCount = activeRows.length - readyCount;
  const propertyLabel = new Map(propertyOptions.map((option) => [option.id, option.label]));
  const qrStatusOf = (row: (typeof rows)[number]) => {
    if (!row.site.is_active) return { label: settings.attendanceSiteInactive, cls: "is-off" };
    if (!row.token) return { label: settings.attendanceQrNone, cls: "is-red" };
    return attendanceQrLinkState(buildAttendanceQrValue(row.token.token)) === "ok"
      ? { label: settings.attendanceQrOk, cls: "is-ok" }
      : { label: settings.attendanceQrNeedsFix, cls: "is-red" };
  };
  const selectedStatus = selectedRow ? qrStatusOf(selectedRow) : null;
  const inactiveHref = showInactive
    ? // 끄는 링크: 선택 현장이 비활성이면 선택도 함께 해제한다(안 그러면 강제로 다시 켜진다).
      `/admin/settings/attendance${selectedSite && selectedSite.is_active ? `?site=${selectedSite.id}` : ""}`
    : `/admin/settings/attendance?inactive=1${selectedSite ? `&site=${selectedSite.id}` : ""}`;

  return (
    <AdminShell activeItem="settings" title={settings.attendanceTitle}>
      <div className="stw">
        <SettingsSubnav
          active="attendance"
          settings={settings}
          showOrganization={session.user.role === "developer_super_admin"}
        />

        {flashMessage ? (
          <p className={`stw-flash ${flashIsError ? "is-red" : "is-green"}`} role="status">
            {flashIsError ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
            {flashMessage}
          </p>
        ) : null}

        <div className="stw-split">
          {/* ── 목록 ── */}
          <div className="stw-sites">
            <div className="stw-bar">
              <span className="stw-sum">
                <span>{w.sitesN.replace("{n}", String(activeRows.length))}</span>
                <span className="dot">·</span>
                <span>{w.readyN.replace("{n}", String(readyCount))}</span>
                {attentionCount > 0 ? (
                  <>
                    <span className="dot">·</span>
                    <span className="is-red">{w.attentionN.replace("{n}", String(attentionCount))}</span>
                  </>
                ) : null}
                {inactiveCount > 0 ? (
                  <>
                    <span className="dot">·</span>
                    <Link className="stw-link" href={inactiveHref}>
                      {showInactive ? w.hideInactive : w.showInactive.replace("{n}", String(inactiveCount))}
                    </Link>
                  </>
                ) : null}
              </span>
              <span className="stw-bar__r">
                <Link className="stw-chip" href="/admin/settings/attendance/print" target="_blank">
                  <Printer aria-hidden="true" />
                  {settings.attendanceQrPrintAll}
                </Link>
                <Link className="stw-chip is-pri" href="/admin/settings/attendance?site=new">
                  <Plus aria-hidden="true" />
                  {settings.attendanceNewSite}
                </Link>
              </span>
            </div>

            {visibleRows.length === 0 ? (
              <div className="stw-empty">{settings.attendanceEmptySites}</div>
            ) : (
              <>
                <div className="stw-th" aria-hidden="true">
                  <span>{w.colSite}</span>
                  <span>{w.colBuilding}</span>
                  <span className="r">{w.colRadius}</span>
                  <span className="r">{w.colQr}</span>
                </div>
                <div className="stw-rows">
                  {visibleRows.map((row) => {
                    const status = qrStatusOf(row);
                    const building = row.site.property_id ? propertyLabel.get(row.site.property_id) : null;
                    return (
                      <Link
                        className={`stw-tr${selectedSite?.id === row.site.id ? " on" : ""}${row.site.is_active ? "" : " is-off"}`}
                        href={`/admin/settings/attendance?site=${row.site.id}${showInactive ? "&inactive=1" : ""}`}
                        key={row.site.id}
                        aria-current={selectedSite?.id === row.site.id ? "true" : undefined}
                      >
                        <span className="stw-who">
                          <span className="stw-av" aria-hidden="true">
                            {Array.from(row.site.name)[0] ?? "·"}
                          </span>
                          <span className="stw-who__t">
                            <b>{row.site.name}</b>
                            <span>{w.printNameLine.replace("{name}", row.site.print_name || "—")}</span>
                          </span>
                        </span>
                        <span className={building ? undefined : "is-soft"}>{building ?? w.notBuilding}</span>
                        <span className="r num">{row.site.allowed_radius_meters}m</span>
                        <span className={`r stw-q ${status.cls}`}>{status.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}

            {/* 기억된 기기 — 조직 전체 목록이라 현장 패널이 아니라 목록 아래에 둔다. */}
            <section className="stw-dev" aria-labelledby="stw-dev-t">
              <h2 id="stw-dev-t">
                {settings.attendanceDevicesTitle} <span className="num is-soft">{trustedDevices.length}</span>
              </h2>
              <p>{settings.attendanceDevicesDescription}</p>
              {trustedDevices.length === 0 ? (
                <p className="stw-hint" style={{ margin: "0 2px" }}>{settings.attendanceDevicesEmpty}</p>
              ) : (
                <>
                  <div className="stw-th" aria-hidden="true">
                    <span>{settings.attendanceDeviceStaff}</span>
                    <span>{settings.attendanceDeviceLastUsed}</span>
                    <span>{settings.attendanceDeviceExpires}</span>
                    <span />
                  </div>
                  <div className="stw-rows">
                    {trustedDevices.map((device) => (
                      <div className="stw-tr" key={device.id}>
                        <span className="stw-who__t">
                          <b>{device.userName}</b>
                          <span>{device.deviceLabel ?? settings.attendanceDeviceUnknown}</span>
                        </span>
                        <span className="num is-soft">{tokyoDate(device.lastUsedAt)}</span>
                        <span className="num is-soft">{tokyoDate(device.expiresAt)}</span>
                        <form action={revokeAttendanceTrustedDevice} className="r">
                          <input name="deviceId" type="hidden" value={device.id} />
                          <input name="siteId" type="hidden" value={selectedSite?.id ?? ""} />
                          <button className="stw-link is-red" type="submit">
                            {settings.attendanceDeviceRevoke}
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          {/* ── 패널: 선택한 현장 / 새 현장 ── */}
          <aside className="stw-panel" key={selectedSite?.id ?? "new"} aria-label={selectedSite?.name ?? w.newSiteTitle}>
            <div className="stw-hd">
              {selectedSite && selectedStatus ? (
                <div className="stw-meta">
                  <span className={selectedStatus.cls === "is-red" ? "is-red" : undefined}>
                    {w.qrStatus.replace("{s}", selectedStatus.label)}
                  </span>
                  {selectedSite.is_active ? <span>{w.active}</span> : null}
                </div>
              ) : (
                <div className="stw-meta">
                  <span>{w.siteSection}</span>
                </div>
              )}
              <h2>{selectedSite ? selectedSite.name : w.newSiteTitle}</h2>
              {selectedSite ? null : <span>{w.newSiteHint}</span>}
            </div>

            {/* QR 먼저 — 이 화면에 들어오는 이유. 인쇄 전에 "지금 뽑아도 되는가"를 알려준다. */}
            {selectedSite ? (
              <div className="stw-qr">
                {activeQr && qrSvg ? (
                  <div
                    className={`stw-qr__img${qrLinkState === "ok" ? "" : " is-dim"}`}
                    role="img"
                    aria-label={settings.attendanceQrSectionTitle}
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : null}
                <div className="stw-qr__b">
                  <b className={qrLinkState === "ok" ? "is-green" : "is-red"}>
                    {!activeQr
                      ? settings.attendanceQrNone
                      : qrLinkState === "ok"
                        ? settings.attendanceQrOk
                        : settings.attendanceQrNeedsFix}
                  </b>
                  <p>
                    {!activeQr
                      ? settings.attendanceNoQr
                      : qrLinkState === "ok"
                        ? settings.attendanceQrReady
                        : qrLinkState === "local"
                          ? settings.attendanceQrWarnLocal
                          : settings.attendanceQrWarnMissing}
                  </p>
                  {activeQr ? <small className="num">{w.qrIssuedOn.replace("{date}", tokyoDate(activeQr.issued_at))}</small> : null}
                  <div className="stw-qr__acts">
                    {activeQr ? (
                      <SettingsConfirm
                        action={issueAttendanceSiteQr}
                        fields={{ siteId: selectedSite.id }}
                        trigger={settings.attendanceReissueQr}
                        triggerClassName="stw-link"
                        title={w.reissueTitle}
                        body={w.reissueBody}
                        keep={w.keep}
                        ok={w.reissueOk}
                      />
                    ) : (
                      <form action={issueAttendanceSiteQr}>
                        <input name="siteId" type="hidden" value={selectedSite.id} />
                        <button className="stw-link" type="submit">
                          {settings.attendanceIssueQr}
                        </button>
                      </form>
                    )}
                    {activeQr && qrLinkState === "ok" ? (
                      <Link className="stw-link" href={`/admin/settings/attendance/print?site=${selectedSite.id}`} target="_blank">
                        {w.print}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {history.length > 1 ? (
              <div className="stw-f">
                <span className="stw-k">{settings.attendanceQrHistory}</span>
                <ul className="stw-hist">
                  {history.slice(0, 3).map((token) => (
                    <li key={token.id}>
                      {/* 발급 이력은 "토큰 상태"다 — `attendanceQrOk`("준비됨")는 인쇄해도 되는지의 판정 문구라 여기 쓰면 의미가 어긋난다. */}
                      <span className={token.is_active ? "is-green" : undefined}>
                        {token.is_active ? settings.attendanceQrActive : settings.attendanceQrRevoked}
                      </span>
                      <span className="num">{tokyoDate(token.issued_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <form
              id="stw-site-form"
              action={saveAttendanceSiteSettings}
              className={`stw-form${selectedSite ? "" : " is-top"}`}
              // 현장이 바뀌면 폼을 통째로 다시 마운트한다. 이게 없으면 소프트 내비게이션에서
              // 이전 현장의 입력값이 남아, 저장 시 다른 현장을 덮어쓴다(2026-07-31 실제 사고).
              key={selectedSite?.id ?? "new"}
            >
              <input name="siteId" type="hidden" value={selectedSite?.id ?? ""} />
              <label className="stw-nf">
                <span>{settings.attendanceSiteName}</span>
                <input defaultValue={selectedSite?.name ?? ""} name="name" required autoComplete="off" />
              </label>
              <div className="stw-f">
                <label className="stw-nf">
                  <span>{settings.attendancePrintName}</span>
                  <input defaultValue={selectedSite?.print_name ?? ""} name="printName" placeholder={selectedSite?.name ?? ""} autoComplete="off" />
                </label>
                <span className="stw-hint">{w.printNameHint}</span>
              </div>
              {/*
                근무지를 어느 **건물**로 볼지. 이 연결이 없으면 교통비 자동 연결이 건물을 못 찾고
                이름으로 더듬어야 한다 — 근무지 이름(`아라키초A`)과 건물 이름(Beds24 원본
                `Arakicho A`)은 따로 관리돼 어긋난다. 사무실처럼 **건물이 아닌 근무지**는 비워 둔다.
              */}
              <div className="stw-f">
                {/* 브라우저 기본 목록 대신 공용 드롭다운(.dd) — 숨은 칸 name="propertyId" 로 같은 폼에 실린다. */}
                <div className="stw-nf is-dd">
                  <span>{settings.attendanceSiteProperty}</span>
                  <DdFormSelect
                    name="propertyId"
                    defaultValue={selectedSite?.property_id ?? ""}
                    ariaLabel={settings.attendanceSiteProperty}
                    options={[
                      { value: "", label: settings.attendanceSitePropertyNone },
                      ...propertyOptions.map((option) => ({ value: option.id, label: option.label })),
                    ]}
                  />
                </div>
                <span className="stw-hint">{w.buildingHint}</span>
              </div>
              <SiteGeoFields
                initialLat={formatField(selectedSite, "latitude")}
                initialLng={formatField(selectedSite, "longitude")}
                initialRadius={selectedSite?.allowed_radius_meters?.toString() ?? "100"}
                copy={{
                  latitude: settings.attendanceLatitude,
                  longitude: settings.attendanceLongitude,
                  latInvalid: w.latInvalid,
                  lngInvalid: w.lngInvalid,
                  mapLink: w.mapLink,
                  radiusLabel: w.radiusLabel,
                  radiusCustom: w.radiusCustom,
                  radiusHint: w.radiusHint,
                  radiusInvalid: w.radiusInvalid,
                }}
              />
            </form>

            {/* 맨 아래 한 줄: 비활성화 · 삭제(글자) + 변경 저장. 폼이 겹치지 않게 저장 버튼은 form 속성으로 위 폼을 제출한다. */}
            <div className="stw-f" style={{ marginTop: "auto" }}>
              <div className="stw-foot">
                {selectedSite ? (
                  <SiteDangerActions
                    hasHistory={siteHasHistory}
                    isActive={selectedSite.is_active}
                    labels={{
                      activate: settings.attendanceSiteActivate,
                      deactivate: settings.attendanceSiteDeactivate,
                      delete: settings.attendanceSiteDelete,
                      deleteTitle: w.deleteSiteTitle,
                      deleteConfirm: settings.attendanceSiteDeleteConfirm,
                      deleteOk: w.deleteOk,
                      keep: w.keep,
                    }}
                    siteId={selectedSite.id}
                  />
                ) : null}
                <button className="stw-btn is-pri" form="stw-site-form" type="submit">
                  {selectedSite ? w.saveChanges : settings.attendanceCreateSiteCta}
                </button>
              </div>
              {selectedSite ? (
                <span className="stw-hint">
                  {siteHasHistory ? settings.attendanceSiteInUseHint : settings.attendanceSiteDeactivateHint}
                </span>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
