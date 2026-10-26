import { redirect } from "next/navigation";
import { AdminShell } from "@/components/shell/admin-shell";
import { ApplicationDetailPanel } from "@/components/admin/recruit/application-detail-panel";
import { RecruitConsole } from "@/components/admin/recruit/recruit-console";
import { RecruitLiveRefresh } from "@/components/admin/recruit/recruit-live-refresh";
import "@/components/admin/recruit/recruit-console.css";
import { requireAdminPageSession } from "@/lib/admin-page-auth";
import { getDictionary, type Locale } from "@/lib/i18n";
import { isYmd, tokyoToday } from "@/lib/tokyo-date";
import {
  canReadJobApplications,
  getJobApplication,
  listApplicationFacets,
  listApplicationHistory,
  listJobApplications,
  signResumeUrl,
  summarizeJobApplications,
  type ApplicationFilter,
  APPLICATION_LIST_LIMIT,
  type JobApplicationStatus,
} from "@/lib/recruit/applications";

/**
 * 채용 지원서 콘솔 — 외부 채용 사이트에서 넘어온 지원서를 읽고 분류한다.
 *
 * 필터·상세는 전부 쿼리스트링이라 서버 렌더 한 번으로 끝난다(컴플레인 콘솔과 같은 방식).
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md
 */
export const dynamic = "force-dynamic";

type SearchParams = {
  status?: string;
  job?: string;
  employment?: string;
  from?: string;
  to?: string;
  resume?: string;
  q?: string;
  /** 상세 패널을 여는 지원서 id. */
  application?: string;
};

const LOCALE_TAGS: Record<Locale, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };

function readStatus(value: string | undefined): JobApplicationStatus | "all" {
  if (value === "all" || value === "screening" || value === "interview") return value;
  // 기본은 「접수」다 — 이 화면에 들어오는 이유가 처리 대기 건을 보기 위해서다.
  return "pending";
}

/** YYYY-MM-DD 이면서 실제 달력에 있는 날짜만. 아니면 null(기간 없음). */
function readDate(value: string | undefined): string | null {
  const v = value?.trim();
  if (!isYmd(v)) return null;
  const parsed = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v ? null : v;
}

export default async function AdminRecruitPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireAdminPageSession({ nextPath: "/admin/recruit" });
  // 지원서는 민감 개인정보라 어드민 웹 접근 권한만으로는 부족하다. 역할이 아니면 대시보드로.
  if (!canReadJobApplications(session)) redirect("/admin");

  const params = await searchParams;
  const dictionary = getDictionary(session.user.preferredLanguage);

  const filter: ApplicationFilter = {
    status: readStatus(params.status),
    jobTitle: params.job?.trim() || null,
    employmentType: params.employment?.trim() || null,
    from: readDate(params.from),
    to: readDate(params.to),
    withResumeOnly: params.resume === "1",
    query: params.q?.trim() || null,
  };

  const [rows, summary, facets] = await Promise.all([
    // **검색어(`q`)는 서버에서 거르지 않는다.** 목록은 탭 기준 전량을 내려보내고 검색은
    // 브라우저에서 즉시 건다(`recruit-console.tsx`).
    //
    // 서버에서 거르면 글자를 지울 때 목록을 넓힐 수가 없다 — 손에 있는 건 이미 좁혀진 결과뿐이라
    // 서버 왕복이 끝나야 한다. 「한 글자만 쳐도 바로, 지우면 바로 전체」가 안 되는 원인이 이것이다.
    // `q` 는 링크로 들어왔을 때 검색창의 초기값으로만 쓴다.
    listJobApplications({ session, filter: { ...filter, query: null } }),
    summarizeJobApplications(session),
    listApplicationFacets(session),
  ]);

  const applicationId = params.application?.trim() || null;
  const application = applicationId ? await getJobApplication({ session, id: applicationId }) : null;
  const [history, resumeUrl] = application
    ? await Promise.all([
        listApplicationHistory({ session, id: application.id, phone: application.phone }),
        signResumeUrl(application.resumePath),
      ])
    : [[], null];

  // 패널을 닫으면 필터는 그대로 두고 `application` 만 뺀다.
  const closeParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "application" && typeof value === "string" && value) closeParams.set(key, value);
  }
  const closeHref = `/admin/recruit${closeParams.size > 0 ? `?${closeParams.toString()}` : ""}`;

  return (
    <AdminShell activeItem="recruit" title={dictionary.recruit.title}>
      {/* 채용 사이트에서 지원서가 들어오면 새로고침 없이 이 화면이 갱신된다. */}
      <RecruitLiveRefresh organizationId={session.organization.id} />
      <RecruitConsole
        copy={dictionary.recruit}
        sharedCopy={dictionary.admin.shared}
        locale={session.user.preferredLanguage}
        localeTag={LOCALE_TAGS[session.user.preferredLanguage] ?? "ko-KR"}
        rows={rows}
        summary={summary}
        facets={facets}
        filter={filter}
        selectedId={application?.id ?? null}
        todayKey={tokyoToday()}
        truncated={rows.length >= APPLICATION_LIST_LIMIT}
      />
      {application && (
        <ApplicationDetailPanel
          application={application}
          history={history}
          resumeUrl={resumeUrl}
          copy={dictionary.recruit}
          closeHref={closeHref}
        />
      )}
    </AdminShell>
  );
}
