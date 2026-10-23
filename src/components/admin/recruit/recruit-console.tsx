"use client";

import { LiveWash } from "@/components/shared/live-wash";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, ExternalLink, MoveRight, Search, X } from "lucide-react";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminDateRangePicker } from "@/components/admin/shared/admin-date-range-picker";
import { AdminExportButtons } from "@/components/admin/shared/admin-export-buttons";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import {
  exportRecruitReport,
  exportRecruitWorkbook,
  setApplicationStatus,
  type RecruitExportRow,
} from "@/app/admin/recruit/actions";
import type { Dictionary, Locale } from "@/lib/i18n";
import type {
  ApplicationFilter,
  ApplicationListRow,
  ApplicationSummary,
} from "@/lib/recruit/applications";
import {
  localizeRecruitDaysPerWeek,
  localizeRecruitEmployment,
  localizeRecruitGender,
  localizeRecruitStartDate,
  localizeRecruitWorkDays,
} from "@/lib/recruit/choice-labels";
import { filterApplicationsBySearch } from "@/lib/recruit/search";
import { nextStatusOf, type JobApplicationStatus } from "@/lib/recruit/status";
import { tokyoDateOf } from "@/lib/tokyo-date";

/** 지원자가 공고를 보고 지원하는 채용 사이트(haru-job-web, Firebase Hosting). 같은 번들이 haru-recruit.web.app 에도 있다. */
const RECRUIT_SITE_URL = "https://stayari.web.app";

/**
 * 채용 지원서 목록 — 디자인 「Foldy Recruiting Console」 1a·1d·1f 구현, 화이트 리디자인(2026-10-14, 시안 Recruit-PC).
 *
 * **표이고 카드가 아니다.** 하루 10건이 몰릴 때 필요한 건 비교와 훑기이고, 카드 그리드는 같은
 * 항목을 눈으로 정렬하기 어렵다. 표가 못 담는 판단 근거(경험·재지원·비자 만료·첨부 없음)는
 * 행 안의 **신호 칩** 한 줄이 맡는다.
 *
 * **전화·주소·국적은 목록에 없다.** 어깨너머 노출을 줄이고, 「열어볼 가치가 있는가」 판단에는
 * 필요하지 않기 때문이다. 국적을 목록 앞에 세우면 국적으로 훑는 화면이 된다.
 *
 * **전진은 목록에서, 되돌리기는 상세에서.** 194건을 훑으며 서류검토로 넘기는 건 대량 작업이라
 * 행 hover 버튼과 벌크 바로 처리한다. 되돌리기는 개별 확인이 필요해 패널 하단에만 둔다.
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md
 */

const PAGE_SIZE = 14;

type Props = {
  copy: Dictionary["recruit"];
  sharedCopy: Dictionary["admin"]["shared"];
  locale: Locale;
  localeTag: string;
  rows: ApplicationListRow[];
  summary: ApplicationSummary;
  facets: { jobTitles: string[]; employmentTypes: string[] };
  filter: ApplicationFilter;
  selectedId: string | null;
  /** 도쿄 오늘(YYYY-MM-DD) — 「새 지원」 표시. 서버가 정해 넘겨 하이드레이션이 갈리지 않게 한다. */
  todayKey: string;
};

export function RecruitConsole({
  copy,
  sharedCopy,
  localeTag,
  rows,
  summary,
  facets,
  filter,
  selectedId,
  todayKey,
}: Props) {
  const router = useRouter();
  const { toast, showToast, dismiss } = useAdminToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  /** 필터는 전부 쿼리스트링이다 — 서버 렌더 한 번으로 끝나고, 링크로 공유된다. */
  function pushFilter(patch: Record<string, string | null>) {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    // 조건이 바뀌면 선택과 페이지는 의미를 잃는다.
    params.delete("application");
    setPicked([]);
    setPage(0);
    router.push(`/admin/recruit?${params.toString()}`);
  }

  /**
   * 검색어는 **브라우저에만 있다.** 다른 필터처럼 쿼리스트링에 넣지 않는다.
   *
   * 넣으면 글자마다 서버를 다시 타고, 그 사이 목록은 이전 결과에 머문다. 특히 글자를 **지울 때**
   * 손에 있는 건 이미 좁혀진 목록뿐이라 응답이 올 때까지 넓어지지 않는다 — 「한 글자만 쳐도 바로,
   * 지우면 바로 전체」가 안 되던 원인이다. 목록은 탭 기준 전량이 이미 와 있으므로
   * (`page.tsx` 가 `query: null` 로 부른다) 여기서 거르면 즉시 끝난다.
   *
   * 링크로 들어온 `?q=` 는 초기값으로만 받는다.
   */
  const [query, setQuery] = useState(filter.query ?? "");

  const visibleRows = useMemo(() => filterApplicationsBySearch(rows, query), [rows, query]);

  // 검색 결과가 줄면 보고 있던 페이지가 사라진다. 마지막 페이지로 당긴다.
  const lastPage = Math.max(0, Math.ceil(visibleRows.length / PAGE_SIZE) - 1);
  const safePage = Math.min(page, lastPage);
  const pageRows = useMemo(
    () => visibleRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [visibleRows, safePage],
  );

  function togglePick(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  function advance(ids: string[], to: JobApplicationStatus) {
    startTransition(async () => {
      const result = await setApplicationStatus(ids, to);
      showToast(result.ok ? copy.statusChanged : copy.actionFailed);
      if (result.ok) {
        setPicked([]);
      }
    });
  }

  /**
   * 벌크는 **다음 단계로 미는 것만** 가능하다. 선택한 건들의 상태가 섞여 있을 수 있으므로,
   * 각자의 다음 단계로 보낸다 — 「전부 면접으로」처럼 단계를 건너뛰지 않는다.
   */
  function advancePicked() {
    const byTarget = new Map<JobApplicationStatus, string[]>();
    for (const id of picked) {
      const row = rows.find((r) => r.id === id);
      const to = row ? nextStatusOf(row.status) : null;
      if (!to) continue;
      byTarget.set(to, [...(byTarget.get(to) ?? []), id]);
    }
    if (byTarget.size === 0) return;
    startTransition(async () => {
      const results = await Promise.all(
        Array.from(byTarget.entries()).map(([to, ids]) => setApplicationStatus(ids, to)),
      );
      showToast(results.every((r) => r.ok) ? copy.statusChanged : copy.actionFailed);
      setPicked([]);
    });
  }

  /**
   * 내보낼 대상 — **선택이 있으면 선택한 것만.**
   *
   * 목록에서 몇 건만 골라 넘기는 일이 실제 업무다(면접 후보를 뽑아 공유하는 등). 선택이 없으면
   * 지금 필터에 걸린 전부를 낸다.
   *
   * 목록은 이미 필터를 통과한 행이므로 여기서 다시 서버에 묻지 않는다.
   */
  const exportRows = useMemo(
    () => (picked.length > 0 ? rows.filter((row) => picked.includes(row.id)) : visibleRows),
    [rows, visibleRows, picked],
  );

  const exportPayload = useMemo(
    () => ({
      rows: exportRows.map<RecruitExportRow>((row) => ({
        appliedAt: row.appliedAt ? row.appliedAt.slice(0, 10) : "—",
        name: row.name,
        age: row.age ?? "—",
        gender: localizeRecruitGender(row.gender, copy.choice) ?? "—",
        jobTitle: row.jobTitle ?? "—",
        employmentType: localizeRecruitEmployment(row.employmentType, copy.choice) ?? "—",
        daysPerWeek: localizeRecruitDaysPerWeek(row.daysPerWeek, copy.choice) ?? "—",
        workDays: localizeRecruitWorkDays(row.workDays, copy.weekDays).join(" "),
        startDate: localizeRecruitStartDate(row.startDate, copy.choice) ?? "—",
        experience: row.hasIndustryExp ? copy.labelExperienceYes : copy.labelExperienceNo,
        visa:
          row.visaDaysLeft === null
            ? "—"
            : copy.chipVisaDays.replace("{n}", String(row.visaDaysLeft)),
        resume: row.hasResume ? "O" : "—",
        status: row.status,
      })),
      // 파일 제목에도 「선택분」임을 남긴다. 1건짜리 파일에 「전체 기간」이 찍혀 있으면 나중에
      // 그 파일을 받은 사람이 전수로 오해한다.
      rangeLabel:
        picked.length > 0
          ? copy.exportSelected.replace("{n}", String(picked.length))
          : filter.from && filter.to
            ? `${filter.from} ~ ${filter.to}`
            : copy.exportRangeAll,
    }),
    [exportRows, picked.length, filter.from, filter.to, copy],
  );

  const statusTabs: { key: JobApplicationStatus | "all"; label: string; count: number }[] = [
    { key: "pending", label: copy.status.pending, count: summary.byStatus.pending },
    { key: "screening", label: copy.status.screening, count: summary.byStatus.screening },
    { key: "interview", label: copy.status.interview, count: summary.byStatus.interview },
    { key: "all", label: copy.statusAll, count: summary.total },
  ];

  /** 빈 상태에서 하나씩 떼어낼 수 있도록, 지금 걸린 조건을 사람이 읽을 문장으로 모은다. */
  const activeFilters: {
    label: string;
    /** 쿼리스트링 필터는 URL 을 고쳐 지운다. */
    clear?: Record<string, string | null>;
    /** 검색어는 URL 에 없으므로 로컬 상태를 지운다. */
    onClear?: () => void;
  }[] = [];
  if (filter.status !== "all") {
    activeFilters.push({ label: copy.status[filter.status], clear: { status: "all" } });
  }
  // 검색 결과가 0건일 때 「무엇 때문에 비었는지」가 보여야 한다. 검색어는 URL 에 없으므로
  // 다른 칩들과 달리 로컬 상태를 지우는 칩으로 넣는다.
  if (query.trim()) activeFilters.push({ label: query.trim(), onClear: () => setQuery("") });
  if (filter.jobTitle) activeFilters.push({ label: filter.jobTitle, clear: { job: null } });
  if (filter.employmentType) {
    activeFilters.push({
      label: localizeRecruitEmployment(filter.employmentType, copy.choice) ?? filter.employmentType,
      clear: { employment: null },
    });
  }
  if (filter.from && filter.to) {
    activeFilters.push({ label: `${filter.from} ~ ${filter.to}`, clear: { from: null, to: null } });
  }
  if (filter.withResumeOnly) {
    activeFilters.push({ label: copy.filterResumeOnly, clear: { resume: null } });
  }


  const startOfToday = todayKey;
  const fmtApplied = (iso: string | null) => {
    if (!iso) return "—";
    const day = tokyoDateOf(iso);
    const time = new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
    return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} ${time}` : "—";
  };

  return (
    <div className="rc rcw">
      {/* 화이트 리디자인(2026-10-14, 시안 Recruit-PC · Recruit-Bulk-PC): 숫자 카드 넷을 빼고 단계 탭 숫자로 대신한다.
          1줄 = 단계 탭 · 실시간 · 내보내기, 2줄 = 기간 · 직무 · 고용형태 · 첨부만 · 검색. */}
      <div className="cviewbar rcw-bar">
        <div className="lviews" role="tablist" style={{ margin: 0 }}>
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter.status === tab.key}
              className={filter.status === tab.key ? "on" : ""}
              onClick={() => pushFilter({ status: tab.key === "pending" ? null : tab.key })}
            >
              {tab.label}
              <b className="rcw-tabn">{tab.count}</b>
            </button>
          ))}
        </div>
        <span className="rcw-live" role="status">
          <i aria-hidden="true" />
          {copy.wLive.replace("{n}", String(summary.today))}
        </span>
        <span className="rcw-sp" />
        <a className="chipbtn rcw-site" href={RECRUIT_SITE_URL} rel="noopener noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" className="ic" />
          {copy.wSite}
        </a>
        <AdminExportButtons
          onExportXls={() => exportRecruitWorkbook(exportPayload)}
          onExportPdf={() => exportRecruitReport(exportPayload)}
          onToast={showToast}
          disabled={exportRows.length === 0}
          labels={sharedCopy}
        />
      </div>

      <div className="rcw-filters">
        <AdminDateRangePicker
          from={filter.from ?? ""}
          to={filter.to ?? ""}
          onChange={(from, to) => pushFilter({ from: from || null, to: to || null })}
          localeTag={localeTag}
          ariaLabel={sharedCopy.pickRange}
          emptyLabel={copy.exportRangeAll}
          labels={{
            prevMonth: sharedCopy.datePrevMonth,
            nextMonth: sharedCopy.dateNextMonth,
            thisMonth: sharedCopy.dateThisMonth,
            reset: sharedCopy.dateReset,
            typeStart: sharedCopy.dateTypeStart,
            typeEnd: sharedCopy.dateTypeEnd,
            pickYear: sharedCopy.datePickYear,
            pickMonth: sharedCopy.datePickMonth,
            apply: sharedCopy.dateApply,
          }}
        />
        <AdmDropdown
          size="sm"
          ariaLabel={copy.filterJob}
          value={filter.jobTitle ?? ""}
          onChange={(value) => pushFilter({ job: value || null })}
          options={[{ value: "", label: copy.wAllJobs }, ...facets.jobTitles.map((title) => ({ value: title, label: title }))]}
        />
        <AdmDropdown
          size="sm"
          ariaLabel={copy.filterEmployment}
          value={filter.employmentType ?? ""}
          onChange={(value) => pushFilter({ employment: value || null })}
          options={[{ value: "", label: copy.wAllEmployment }, ...facets.employmentTypes.map((type) => ({ value: type, label: localizeRecruitEmployment(type, copy.choice) ?? type }))]}
        />
        <button
          type="button"
          className="rcw-toggle"
          role="switch"
          aria-checked={filter.withResumeOnly}
          onClick={() => pushFilter({ resume: filter.withResumeOnly ? null : "1" })}
        >
          <span className={`rcw-box${filter.withResumeOnly ? " on" : ""}`} aria-hidden="true">
            <Check strokeWidth={3} />
          </span>
          {copy.filterResumeOnly}
        </button>
        {/* 제출이 없다. 타이핑이 곧 검색이다 — Enter 로 페이지가 새로 뜨지 않도록 막아만 둔다. */}
        <form className="rcw-search" onSubmit={(event) => event.preventDefault()} role="search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            name="q"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={copy.wSearch}
            aria-label={copy.wSearch}
            autoComplete="off"
            type="text"
          />
          {query ? (
            <button
              type="button"
              className="rcw-search__x"
              aria-label={copy.searchClear}
              onClick={() => {
                setQuery("");
                setPage(0);
                searchRef.current?.focus();
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </form>
      </div>

      {picked.length > 0 ? (
        <div className="rcw-bulk" role="region" aria-label={copy.bulkSelected.replace("{n}", String(picked.length))}>
          <b>{copy.bulkSelected.replace("{n}", String(picked.length))}</b>
          <span>{copy.exportSelectedHint.replace("{n}", String(picked.length))}</span>
          <span className="rcw-sp" />
          <button type="button" className="rcw-bulk__go" onClick={advancePicked} disabled={pending}>
            {copy.wBulkAdvance}
          </button>
          <button type="button" className="rcw-bulk__clear" onClick={() => setPicked([])}>
            {copy.bulkClear}
          </button>
        </div>
      ) : null}

      {visibleRows.length === 0 ? (
        <div className="rcw-empty">
          <span className="rcw-empty__ic" aria-hidden="true">
            <Search size={22} />
          </span>
          <b>{summary.total === 0 ? copy.emptyNoData : copy.emptyTitle}</b>
          {summary.total > 0 ? (
            <>
              {/* 「없습니다」로 끝내지 않고 어떤 조건이 걸려 0건인지 그 자리에 보여 준다. */}
              <span>{copy.emptyBodyPrefix}</span>
              <div className="rcw-empty__acts">
                {activeFilters.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="rcw-active"
                    onClick={() => {
                      if (item.onClear) item.onClear();
                      else if (item.clear) pushFilter(item.clear);
                    }}
                  >
                    {item.label}
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="rcw-empty__acts">
                {filter.status !== "pending" && summary.byStatus.pending > 0 ? (
                  <button type="button" className="rcw-btn is-soft" onClick={() => pushFilter({ status: null })}>
                    {copy.emptyResetOne.replace("{n}", String(summary.byStatus.pending))}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rcw-btn is-gray"
                  onClick={() => pushFilter({ status: null, job: null, employment: null, from: null, to: null, resume: null, q: null })}
                >
                  {copy.emptyResetAll}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="rcw-tbl">
          <div className="rcw-th">
            <span aria-hidden="true" />
            <span>{copy.colApplicant}</span>
            <span>{copy.colJob}</span>
            <span>{copy.wColWork}</span>
            <span className="r">{copy.colApplied}</span>
            <span aria-hidden="true" />
          </div>

          <div className="rcw-rows">
            <LiveWash move sig={pageRows.map((row) => row.id).join(",")}>{pageRows.map((row) => {
              const next = nextStatusOf(row.status);
              const isNew = tokyoDateOf(row.appliedAt) === startOfToday;
              const on = picked.includes(row.id);
              const signals = signalsOf(row, copy);
              return (
                <div
                  key={row.id} data-live={row.id}
                  className={`rcw-tr${selectedId === row.id ? " on" : ""}${on ? " pk" : ""}${isNew ? " is-new" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/admin/recruit?${detailQuery(row.id)}`)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/admin/recruit?${detailQuery(row.id)}`);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="rcw-pick"
                    aria-label={copy.selectRow}
                    aria-pressed={on}
                    onClick={(event) => {
                      event.stopPropagation();
                      togglePick(row.id);
                    }}
                  >
                    <span className={`rcw-box${on ? " on" : ""}`}>
                      <Check strokeWidth={3} aria-hidden="true" />
                    </span>
                  </button>

                  <span className="rcw-who">
                    <span className="rcw-who__h">
                      <b>{row.name}</b>
                      <span>{[row.age, localizeRecruitGender(row.gender, copy.choice)].filter(Boolean).join(" · ")}</span>
                      {isNew ? <em>{copy.wNew}</em> : null}
                    </span>
                    <span className="rcw-who__s">
                      {signals.plain.join(" · ")}
                      {signals.alert ? (
                        <b className="is-bad">
                          {signals.plain.length ? " · " : ""}
                          {signals.alert}
                        </b>
                      ) : null}
                    </span>
                  </span>

                  <span className="rcw-two">
                    <span>{row.jobTitle ?? copy.notCollected}</span>
                    {row.employmentType ? <small>{localizeRecruitEmployment(row.employmentType, copy.choice)}</small> : null}
                  </span>

                  <span className="rcw-two">
                    <span>{localizeRecruitDaysPerWeek(row.daysPerWeek, copy.choice) ?? "—"}</span>
                    <small>{[localizeRecruitWorkDays(row.workDays, copy.weekDays).join(" "), localizeRecruitStartDate(row.startDate, copy.choice)].filter(Boolean).join(" · ") || "—"}</small>
                  </span>

                  <span className="rcw-at num">{fmtApplied(row.appliedAt)}</span>

                  <span className="rcw-act">
                    {next ? (
                      <button
                        type="button"
                        className="rcw-adv"
                        disabled={pending}
                        onClick={(event) => {
                          event.stopPropagation();
                          advance([row.id], next);
                        }}
                      >
                        {copy.wAdvanceShort[next]}
                        <MoveRight size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}</LiveWash>
          </div>

          <div className="rcw-pager">
            <span className="num">
              {copy.wPage
                .replace("{from}", String(safePage * PAGE_SIZE + 1))
                .replace("{to}", String(Math.min(visibleRows.length, (safePage + 1) * PAGE_SIZE)))
                .replace("{total}", String(visibleRows.length))}
            </span>
            <span className="rcw-sp" />
            <button type="button" className="rcw-pg" aria-label={copy.prevPage} disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}>
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <button type="button" className="rcw-pg" aria-label={copy.nextPage} disabled={safePage >= lastPage} onClick={() => setPage(Math.min(lastPage, safePage + 1))}>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {toast ? <AdminToast message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

function detailQuery(id: string): string {
  const params = new URLSearchParams(window.location.search);
  params.set("application", id);
  return params.toString();
}

/**
 * 신호 한 줄 — 표 칸으로는 표현 못 하는 판단 근거(동종 경험 · 재지원 · 이력서 · 첨부 없음 · 구 폼), 끝에 체류 만료만 빨갛게.
 * 화이트 리디자인(2026-10-14): 색 칩 대신 글자 한 줄. **체류 자격은 90일 이내 만료만** — 국적 · 비자 종류는 패널에서만 본다.
 */
function signalsOf(row: ApplicationListRow, copy: Dictionary["recruit"]): { plain: string[]; alert: string | null } {
  const plain: string[] = [];
  if (row.hasIndustryExp) plain.push(copy.chipExperience);
  if (row.repeatCount > 0) plain.push(copy.chipRepeat.replace("{n}", String(row.repeatCount + 1)));
  plain.push(row.hasResume ? copy.colResume : copy.chipNoResume);
  if (row.isLegacyForm) plain.push(copy.chipLegacy);
  let alert: string | null = null;
  if (row.visaAlert === "expired") alert = copy.chipVisaExpired;
  else if ((row.visaAlert === "critical" || row.visaAlert === "soon") && row.visaDaysLeft !== null) {
    alert = copy.chipVisaDays.replace("{n}", String(row.visaDaysLeft));
  }
  return { plain, alert };
}
