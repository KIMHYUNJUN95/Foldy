import Link from "next/link";
import { FileText, X } from "lucide-react";
import type { Dictionary } from "@/lib/i18n";
import type { ApplicationDetail, ApplicationHistoryRow } from "@/lib/recruit/applications";
import { resumeKindOf } from "@/lib/recruit/status";
import { tokyoDateOf } from "@/lib/tokyo-date";
import { ApplicationPrintSheet } from "./application-print-sheet";
import {
  RecruitContactLine,
  RecruitDeleteButton,
  RecruitNoteField,
  RecruitPanelActions,
  RecruitPrintIcon,
  RecruitViewSheet,
} from "./recruit-panel-client";

/**
 * 지원서 상세 패널 — 서버 컴포넌트. 화이트 리디자인(2026-10-14, 시안 Recruit-PC 오른쪽 · RecruitDetail-PC · RecruitDelete-PC):
 * 상태 · 지원 시각 · 재지원 → 이름 → 공고 · 형태 → 연락처 한 줄(가림 · 「연락처 표시」) → 근무 가능 / 시작일 / 체류 / 통근 /
 * 경험 / 지원 경로 → 지원 동기 → 이전 지원(전화번호 일치) → 이력서 → 검토 메모 → 아래 [되돌리기][다음 단계].
 * 위 지원서 보기(A4 그대로 가운데 창) · 인쇄 · 휴지통(확인 창) · 닫기. `?application=<id>` 쿼리로 열고 공용 `.panel` 을 쓴다(CLAUDE.md §4).
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md
 */

/**
 * 폼이 `work_days` 에 저장한 값 그대로 — **표시용이 아니라 대조용 키다.** 화면에 찍히는 글자는 `copy.weekDays` 가 만든다.
 */
// i18n-ignore-start -- stored form values, matched not displayed
const WEEK_DAY_KEYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
// i18n-ignore-end

type Props = {
  application: ApplicationDetail;
  history: ApplicationHistoryRow[];
  resumeUrl: string | null;
  copy: Dictionary["recruit"];
  closeHref: string;
};

function stamp(iso: string | null): string {
  if (!iso) return "—";
  const day = tokyoDateOf(iso);
  const time = new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} ${time}` : "—";
}

export function ApplicationDetailPanel({ application: a, history, resumeUrl, copy, closeHref }: Props) {
  const resume = resumeKindOf(a.resumeFileName);
  const days = WEEK_DAY_KEYS.map((key, index) => (a.workDays.includes(key) ? copy.weekDays[index] : null)).filter(Boolean);
  const join = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

  const visa = (() => {
    if (!a.visaPeriodRaw) return null;
    if (a.visaAlert === "expired") return { text: copy.chipVisaExpired, bad: true };
    if (a.visaDaysLeft !== null && a.visaAlert) return { text: copy.chipVisaDays.replace("{n}", String(a.visaDaysLeft)), bad: true };
    if (a.visaExpiryDate === null) return { text: `${a.visaPeriodRaw} (${copy.visaUnreadable})`, bad: false };
    return { text: a.visaPeriodRaw, bad: false };
  })();

  const rows: [string, React.ReactNode][] = [
    [copy.wWorkable, join([a.daysPerWeek, days.join(""), a.duration ?? (a.isLegacyForm ? copy.notCollected : null)]) || "—"],
    [copy.labelStart, a.startDate ?? "—"],
    [
      copy.wStay,
      <>
        {join([a.nationality, a.visaType]) || (visa ? "" : "—")}
        {visa ? (
          <>
            {a.nationality || a.visaType ? " · " : ""}
            <b className={visa.bad ? "is-bad" : ""}>{visa.text}</b>
          </>
        ) : null}
      </>,
    ],
    [copy.wCommute, join([a.commuteTime, a.uniformSize ? copy.wUniform.replace("{size}", a.uniformSize) : null]) || "—"],
    [copy.wExperience, join([a.hasIndustryExp ? copy.wExpYes : copy.wExpNo, ...a.industryTasks])],
  ];
  if (a.sourceChannel) rows.push([copy.labelSource, a.sourceChannel]);

  return (
    <>
      <Link href={closeHref} className="panel-scrim" aria-label={copy.close} data-panel-close />
      <aside className="panel rcw-panel" role="dialog" aria-label={copy.detailAria}>
        <div className="rcw-ph">
          <div className="rcw-ph__main">
            <span className="rcw-kick">
              <em>{copy.status[a.status]}</em>
              <span className="num">{copy.wApplied.replace("{date}", stamp(a.appliedAt))}</span>
              {a.repeatCount > 0 ? <span>{copy.chipRepeat.replace("{n}", String(a.repeatCount + 1))}</span> : null}
            </span>
            <h2 className="rcw-name">
              {a.name}
              <small>{join([a.age, a.gender])}</small>
            </h2>
            <span className="rcw-job">{join([a.jobTitle ?? copy.notCollected, a.employmentType])}</span>
          </div>
          {/* 보기 · 인쇄는 상태를 바꾸지 않는 보조 동작 — 아래 진행 버튼 자리와 섞지 않는다. */}
          <RecruitViewSheet labels={{ view: copy.wView, print: copy.wPrintShort, close: copy.close }}>
            <ApplicationPrintSheet application={a} copy={copy} variant="screen" />
          </RecruitViewSheet>
          <RecruitPrintIcon label={copy.wPrint} />
          <RecruitDeleteButton
            applicationId={a.id}
            closeHref={closeHref}
            labels={{
              aria: copy.wDeleteAria,
              title: copy.wDeleteTitle,
              summary: join([a.name, a.age, a.jobTitle, stamp(a.appliedAt)]),
              body: copy.wDeleteBody,
              warn: copy.wDeleteWarn,
              keep: copy.wKeep,
              confirm: copy.deleteConfirm,
              deleted: copy.deleted,
              failed: copy.actionFailed,
            }}
          />
          <Link href={closeHref} className="rcw-ph__x" aria-label={copy.close} data-panel-close>
            <X aria-hidden="true" />
          </Link>
        </div>

        <div className="panel__body rcw-pb">
          <RecruitContactLine key={a.id} application={a} copy={copy} />

          {a.isLegacyForm ? <p className="rcw-legacy">{`${copy.legacyNoticeTitle} — ${copy.legacyNoticeBody}`}</p> : null}

          <dl className="rcw-dl">
            {rows.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          {/* 지원 동기는 접지 않고 전량 — 잘린 문장은 판단에 쓸 수 없다. */}
          {a.motivation ? (
            <section className="rcw-sec">
              <small className="rcw-k">{copy.wMotivation}</small>
              <p className="rcw-p">{a.motivation}</p>
            </section>
          ) : null}

          {history.length > 0 ? (
            <section className="rcw-sec">
              <small className="rcw-k">{copy.wPrevApplied}</small>
              <ol className="rcw-hist">
                {history.map((row) => (
                  <li key={row.id}>
                    <span className="rcw-hist__h">
                      <b className="num">{row.appliedAt?.slice(0, 10).replaceAll("-", ".") ?? "—"}</b>
                      <span>{join([row.jobTitle, row.employmentType])}</span>
                      <em>{copy.historyStoppedAt.replace("{status}", copy.status[row.status])}</em>
                    </span>
                    {/* 이전 판정 사유를 보지 않고 같은 결정을 반복하는 게 가장 큰 손실이다. */}
                    {row.reviewNote ? <span className="rcw-hist__note">{row.reviewNote}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {a.hasResume ? (
            resumeUrl ? (
              <a
                className="rcw-file"
                href={resumeUrl}
                target="_blank"
                rel="noreferrer"
                download={resume.previewable ? undefined : (a.resumeFileName ?? true)}
              >
                <FileText aria-hidden="true" />
                <span className="rcw-file__n">{a.resumeFileName ?? "—"}</span>
                <span className="rcw-file__a">{resume.previewable ? copy.wOpenResume : copy.resumeDownload}</span>
              </a>
            ) : (
              <p className="rcw-legacy">{copy.resumeUnavailable}</p>
            )
          ) : (
            // 첨부 없음은 결함이 아니라 다른 검토 경로 — 경고색을 쓰지 않는다.
            <p className="rcw-legacy">{`${copy.noResumeTitle} — ${copy.noResumeBody}`}</p>
          )}

          {/* key: 지원자를 바꾸면 입력값을 새로 받는다. 없으면 이전 지원자 메모가 남아 blur 때 새 지원자에게 저장된다. */}
          <RecruitNoteField key={a.id} application={a} copy={copy} />
        </div>

        <RecruitPanelActions application={a} copy={copy} />
      </aside>

      {/* 화면에서는 숨어 있고 인쇄할 때만 나타나는 A4 지원서 한 장(`recruit-console.css` 의 `@media print`). */}
      <ApplicationPrintSheet application={a} copy={copy} />
    </>
  );
}
