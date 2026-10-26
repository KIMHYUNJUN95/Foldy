/* i18n-ignore-file -- 정해진 일본 회사 휴가 양식; 고정된 도메인 문서이며 앱 UI 가 아님. */
"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, Download, FileText, Users } from "lucide-react";
import type { LeaveDurationUnit, LeaveType } from "@/lib/annual-leave-approvals-server";
import type { LeaveDocument } from "@/lib/annual-leave-admin-server";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n";

type Lc = Dictionary["admin"]["leaveConsole"];

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}

function roleLabel(role: string | null, dictionary: Dictionary): string {
  if (!role) return "—";
  const map = dictionary.roles as Record<string, string>;
  return map[role] ?? role;
}

function typeBadgeClass(type: LeaveType): string {
  switch (type) {
    case "paid":
      return "typebadge--paid";
    case "annual":
      return "typebadge--annual";
    case "special":
      return "typebadge--special";
    default:
      return "typebadge--other";
  }
}

function typeLabel(type: LeaveType, lc: Lc): string {
  switch (type) {
    case "paid":
      return lc.typePaid;
    case "annual":
      return lc.typeAnnual;
    case "special":
      return lc.typeSpecial;
    default:
      return lc.typeOther;
  }
}

/** "2026-07-14" → "07/14" */
function fmtMd(dateStr: string): string {
  return dateStr.slice(5).replace("-", "/");
}

function fmtPeriod(doc: LeaveDocument, lc: Lc): string {
  const s = fmtMd(doc.startDate);
  const e = fmtMd(doc.endDate);
  const base = s === e ? s : `${s} – ${e}`;
  if (doc.durationUnit === "am") return `${base} · ${lc.durationAm}`;
  if (doc.durationUnit === "pm") return `${base} · ${lc.durationPm}`;
  return base;
}

/** 「休暇届」양식 기간 열 — 일본식 슬래시 날짜 범위. */
function fmtFormPeriod(doc: LeaveDocument): string {
  const s = doc.startDate.replace(/-/g, "/");
  const e = doc.endDate.replace(/-/g, "/");
  return s === e ? s : `${s} ～ ${e}`;
}

const JP_TYPE_LABEL: Record<LeaveType, string> = {
  paid: "有給休暇",
  annual: "慶弔休暇",
  special: "特別休暇",
  other: "その他",
};

const JP_DUR_LABEL: Record<LeaveDurationUnit, string> = {
  full: "終日",
  am: "午前半休",
  pm: "午後半休",
};

/** A4 「休暇届」 용지 양식 — .handoff/src/leave-views.js doc() + leave.css .jp* 와 픽셀 단위로 맞췄다.
 * 양식 문구는 실제 일본 회사 양식 텍스트이며 앱 UI 가 아니므로 i18n 대상이 아니다. */
function LeaveFormSheet({ doc }: { doc: LeaveDocument }) {
  const [dy, dm, dd] = doc.appliedOn.split("/");
  const radioOption = (key: LeaveType) => (
    <span className={`jp__opt${doc.leaveType === key ? " on" : ""}`} key={key}>
      <span className="jp__radio" />
      {JP_TYPE_LABEL[key]}
    </span>
  );

  return (
    <div className="jp">
      <div className="jp__title">休　暇　届</div>
      <div className="jp__appdate">
        申請日<span className="jp__cln">：</span>
        <u>{dy}</u> 年 <u>{dm}</u> 月 <u>{dd}</u> 日
      </div>
      <table className="jp__tbl">
        <tbody>
          <tr className="r-sm">
            <th>氏　名</th>
            <td>{doc.applicantName}</td>
          </tr>
          <tr className="r-sm">
            <th>期　間</th>
            <td>
              <span className="jp__per">{fmtFormPeriod(doc)}</span>
              <span className="jp__sub">
                　（{JP_DUR_LABEL[doc.durationUnit]} ・ {doc.daysCount}日）
              </span>
            </td>
          </tr>
          <tr className="r-type">
            <th>休暇区分</th>
            <td>
              <div className="jp__opts">
                {radioOption("paid")}
                {radioOption("annual")}
                {radioOption("special")}
              </div>
              <div className="jp__opts">{radioOption("other")}</div>
            </td>
          </tr>
          <tr className="r-tall">
            <th>事　由</th>
            <td>{doc.reason}</td>
          </tr>
          <tr className="r-md">
            <th>緊急連絡先</th>
            <td>{doc.emergencyContact}</td>
          </tr>
        </tbody>
      </table>
      <div className="jp__sign">
        <div className="jp__note">上記の通りお届けします。</div>
        <table className="jp__stamps">
          <tbody>
            <tr>
              <th>本人</th>
              <th>部署長</th>
              <th>専務</th>
            </tr>
            <tr>
              <td>
                <span className="jp__seal">{doc.applicantInitial}</span>
              </td>
              {/* 部署長 — 지금은 의도적으로 비워 둠 (2026-07-09 확정). */}
              <td />
              {/* 専務 — 전무의 실제 도장 (鄭). 전무가 승인한 뒤에만 표시한다. */}
              <td>
                {doc.approverRole === "senior_managing_director" ? (
                  <span className="jp__seal jp__seal--smd">鄭</span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LeaveDocumentsView({
  lc,
  locale,
  documents,
}: {
  lc: Lc;
  locale: Locale;
  documents: LeaveDocument[];
}) {
  const dictionary = getDictionary(locale);
  const userIds = Array.from(new Set(documents.map((d) => d.userId)));
  const [userId, setUserId] = useState(userIds[0]);
  const empDocs = documents
    .filter((d) => d.userId === userId)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const [docId, setDocId] = useState(empDocs[0]?.id);
  const doc = documents.find((d) => d.id === docId) ?? empDocs[0];

  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 고정된 210mm×297mm 용지를 스테이지 너비에 맞춘다 — handoff fitDoc() 과 같다.
  useLayoutEffect(() => {
    function fit() {
      const stage = stageRef.current;
      const paper = paperRef.current;
      const wrap = wrapRef.current;
      if (!stage || !paper || !wrap) return;
      const scale = Math.min(1, (stage.clientWidth - 52) / paper.offsetWidth);
      paper.style.transform = `scale(${scale})`;
      paper.style.transformOrigin = "top left";
      wrap.style.width = `${paper.offsetWidth * scale}px`;
      wrap.style.height = `${paper.offsetHeight * scale}px`;
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [docId]);

  function selectEmp(id: string) {
    setUserId(id);
    const firstDoc = documents
      .filter((d) => d.userId === id)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
    setDocId(firstDoc?.id);
  }

  if (documents.length === 0 || !doc) {
    return (
      <div className="card">
        <div className="state">
          <span className="state__ic empty">
            <span className="ic">
              <FileText />
            </span>
          </span>
          <div className="state__t">{lc.docsEmptyTitle}</div>
          <div className="state__s">{lc.docsEmptyBody}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dwrap">
      <div className="dlist">
        <div className="dlist__h">
          <Ic>
            <Users />
          </Ic>
          <span className="t">{lc.docsEmpListTitle}</span>
          <span className="card__cnt" style={{ marginLeft: "auto" }}>
            {lc.docsEmpCount(userIds.length)}
          </span>
        </div>
        <div className="dlist__scroll">
          {userIds.map((id) => {
            const docs = documents.filter((d) => d.userId === id);
            const latest = docs.slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
            return (
              <div
                key={id}
                className={`demp${id === userId ? " on" : ""}`}
                onClick={() => selectEmp(id)}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") selectEmp(id);
                }}
              >
                <span className="avatar" style={{ background: latest.applicantBg }}>
                  {latest.applicantInitial}
                </span>
                <div className="demp__b">
                  <div className="demp__nm">{latest.applicantName}</div>
                  <div className="demp__s">
                    {roleLabel(latest.applicantRole, dictionary)} · {lc.docsEmpLatest(fmtMd(latest.startDate))}
                  </div>
                </div>
                <span className="demp__cnt">{lc.docsEmpCount(docs.length)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ddetail">
        <div className="dtop">
          <span className="avatar" style={{ background: doc.applicantBg, width: 28, height: 28, fontSize: 12 }}>
            {doc.applicantInitial}
          </span>
          <span className="dtop__t">{doc.applicantName}</span>
          <span className="dtop__s">
            {roleLabel(doc.applicantRole, dictionary)} · {lc.docsCountLabel(empDocs.length)}
          </span>
          <span className="toolbar__spacer" />
          <button type="button" className="btn btn--pri btn--sm" onClick={() => window.print()}>
            <Ic>
              <Download />
            </Ic>
            {lc.docsBtnPrint}
          </button>
        </div>

        <div className="card ddocs">
          {empDocs.map((d) => (
            <div
              key={d.id}
              className={`ddoc${d.id === docId ? " on" : ""}`}
              onClick={() => setDocId(d.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") setDocId(d.id);
              }}
            >
              <span className="ddoc__no mono">{d.documentNumber}</span>
              <span className={`typebadge ${typeBadgeClass(d.leaveType)}`}>{typeLabel(d.leaveType, lc)}</span>
              <span className="mono ddoc__per">{fmtPeriod(d, lc)}</span>
              <span className="ddoc__days">{lc.daysUnit(d.daysCount)}</span>
              {d.approverName ? (
                <span className="ddoc__by">{lc.docsApprovedBy(d.approverName, d.decidedAt)}</span>
              ) : null}
              <span className="ic ddoc__chk">{d.id === docId ? <Check /> : <ChevronRight />}</span>
            </div>
          ))}
        </div>

        <div className="card dviewer">
          <div className="dviewer__bar">
            <span className="dviewer__meta">
              <b className="mono">{doc.documentNumber}</b> · {lc.docsViewerMeta}
            </span>
          </div>
          <div className="dviewer__stage" ref={stageRef}>
            <div className="dviewer__wrap" id="paperWrap" ref={wrapRef}>
              <div id="docSheet" ref={paperRef}>
                <LeaveFormSheet doc={doc} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
