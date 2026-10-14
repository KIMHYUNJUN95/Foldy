import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { LinenBuildingSwitch } from "@/components/linen-return/linen-building-switch";
import { LinenReturnSuccess } from "@/components/linen-return/linen-return-success";
import { MobileShell } from "@/components/shell/mobile-shell";
import { SplitList } from "@/components/shell/split-list";
import "@/components/linen-return/linen-mobile.css";
import { getDictionary } from "@/lib/i18n";
import {
  getCurrentTokyoYearMonth,
  getLinenBuildings,
  getLinenBuildingStats,
  getLinenReturnsByBuilding,
  isKnownBuilding,
  type LinenReturnRecord,
} from "@/lib/linen-returns";
import { getMobileNavBadges } from "@/lib/nav-badges";
import { getOnboardingState } from "@/lib/onboarding";
import { localizePropertyName } from "@/lib/room-label-normalization";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";

type PageProps = {
  searchParams: Promise<{ building?: string; created?: string; merged?: string }>;
};

/** 도쿄 기준 「M/D」 · 「HH:mm」 · 「YYYY-MM」. */
function tokyoParts(iso: string): { md: string; hm: string; ym: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { md: `${+g("month")}/${+g("day")}`, hm: `${g("hour")}:${g("minute")}`, ym: `${g("year")}-${g("month")}` };
}

function linesText(record: LinenReturnRecord): string {
  return record.lines.length ? record.lines.map((l) => `${l.name} ${l.quantity}`).join(" · ") : "—";
}

export default async function LinenReturnListPage({ searchParams }: PageProps) {
  const [state, session, params] = await Promise.all([
    getOnboardingState(),
    getCurrentAppSession(),
    searchParams,
  ]);

  const building = (params.building ?? "").trim();
  const createdId = (params.created ?? "").trim();
  const merged = params.merged === "1";

  if (state.status === "unauthenticated") {
    redirect(
      `/auth/login?next=${encodeURIComponent(`/mobile/linen-return/list?building=${encodeURIComponent(building)}`)}`,
    );
  }
  if (state.status !== "ready" || !session) {
    redirect("/onboarding");
  }
  if (!hasOrganizationContext(session)) {
    redirect("/mobile/unavailable");
  }
  if (!building || !(await isKnownBuilding(session, building))) {
    redirect("/mobile/linen-return");
  }

  const locale = session.user.preferredLanguage;
  const dict = getDictionary(locale);
  const copy = dict.linenReturn;
  const buildingLabel = localizePropertyName(building, dict.cleaning.buildingLabels);

  const [records, navBadges, allBuildings, stats] = await Promise.all([
    getLinenReturnsByBuilding(session, building),
    getMobileNavBadges(),
    getLinenBuildings(session),
    getLinenBuildingStats(session),
  ]);
  const ym = getCurrentTokyoYearMonth();
  const monthKey = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
  const monthRecords = records.filter((r) => tokyoParts(r.registeredAt).ym === monthKey);
  const monthQty = monthRecords.reduce((sum, r) => sum + r.totalQuantity, 0);
  const created = createdId ? records.find((r) => r.id === createdId) : undefined;
  const buildingOptions = allBuildings.map((name) => ({
    name,
    label: localizePropertyName(name, dict.cleaning.buildingLabels),
    monthCount: stats[name]?.count ?? 0,
  }));

  const buildingParam = encodeURIComponent(building);

  return (
    <MobileShell activeItem="linen-return" badges={navBadges} title={buildingLabel} split>
      <SplitList detail="linen">
        {/* 화이트 리디자인(2026-10-14, 시안 Linen-Phone · Linen-Tablet): 상자 없는 머리(건물 이름을 눌러 바꾸기) · 이번 달 숫자 · 한 줄 기록 · 등록 단추. */}
        <div className="lnw">
          <div className="lnw-head">
            <span className="lnw-kick">{copy.eyebrow}</span>
            <LinenBuildingSwitch buildings={buildingOptions} copy={copy} current={building} currentLabel={buildingLabel} />
          </div>
          <div className="lnw-kpis">
            <div>
              <span>{copy.wMonthQty}</span>
              <b className="num">
                {monthQty}
                <small>{copy.quantityUnit}</small>
              </b>
            </div>
            <div>
              <span>{copy.wRecordsLabel}</span>
              <b className="num">
                {monthRecords.length}
                <small>{copy.countUnit}</small>
              </b>
            </div>
            <Link className="lnw-link" href={`/mobile/linen-return/ledger?building=${buildingParam}`}>
              {copy.wLedgerLink}
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>

          {records.length === 0 ? (
            <div className="lnw-empty-state">
              <b>{copy.listEmptyTitle}</b>
              <span>{copy.listEmptySub}</span>
            </div>
          ) : (
            <div className="lnw-rows">
              {records.map((record) => {
                const t = tokyoParts(record.registeredAt);
                return (
                  <Link
                    className={`lnw-row${record.id === createdId ? " is-new" : ""}`}
                    href={`/mobile/linen-return/record/${record.id}?building=${buildingParam}`}
                    key={record.id}
                  >
                    <span className="lnw-row__d num">
                      <b>{t.md}</b>
                      <span>{t.hm}</span>
                    </span>
                    <span className="lnw-row__b">
                      <b>{linesText(record)}</b>
                      <span>
                        {record.registrantName}
                        {record.imageUrls.length > 0 ? ` · ${copy.wPhotoN.replace("{n}", String(record.imageUrls.length))}` : ""}
                      </span>
                    </span>
                    <span className="lnw-row__q num">
                      {record.totalQuantity}
                      <small>{copy.quantityUnit}</small>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          <Link className="lnw-fab" href={`/mobile/linen-return/new?building=${buildingParam}`}>
            <Plus aria-hidden="true" />
            {copy.registerButton}
          </Link>

          <LinenReturnSuccess
            building={building}
            buildingLabel={buildingLabel}
            copy={copy}
            fallback={created ? { total: created.totalQuantity, lines: linesText(created) } : null}
            merged={merged}
            show={Boolean(createdId)}
          />
        </div>
      </SplitList>
    </MobileShell>
  );
}
