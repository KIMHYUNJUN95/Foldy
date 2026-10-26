import Link from "next/link";
import "./leave.css";
import { AIc, AttIcon } from "./att-icons";
import type { LeaveRequestView } from "@/lib/annual-leave-requests-server";
import type { Dictionary } from "@/lib/i18n";

// L3 · 제출 완료 · 승인 단계 — 접수 상태 + 승인 타임라인. `request`는 방금 제출한 실제 신청 건
// (page.tsx가 getMyLeaveRequest로 조회). 승인 백엔드가 아직 없어 타임라인의 "현재 단계"는
// 언제나 2단계(담당자 검토)로 고정 표시 — 이 화면에 오는 신청은 항상 방금 requested 상태다.
// 디자인 leaveDone() 재현.

type LeaveCopy = Dictionary["leave"];
type LeaveType = "annual" | "paid" | "special" | "other";

function typeLabel(t: LeaveType, c: LeaveCopy): string {
  return t === "annual" ? c.typeAnnual : t === "paid" ? c.typePaid : t === "special" ? c.typeSpecial : c.typeOther;
}

export function LeaveDone({ copy: c, request }: { copy: LeaveCopy; request: LeaveRequestView }) {
  const requestNo = `LV-${request.id.slice(0, 8).toUpperCase()}`;
  const submittedAt = (request.submittedAt ?? request.createdAt).replace("T", " ").slice(0, 16);

  return (
    <div className="lv" style={{ paddingBottom: 92 }}>
      <div className="pagehead">
        <span className="pagehead__crumb">{c.crumb}</span>
        <span className="pagehead__t">{c.appTitle}</span>
      </div>

      {/* 성공 버스트 */}
      <div className="doneburst">
        <div className="doneburst__ic">{AttIcon.checkc}</div>
        <h3 className="doneburst__t">{c.doneT}</h3>
        <p className="doneburst__s">{c.doneS}</p>
      </div>

      {/* 요청 요약 */}
      <div className="reqcard">
        <div className="reqcard__h">
          <span className="chip c-info">{typeLabel(request.leaveType, c)}</span>
          <span className="chip c-warn">
            <span className="d" />
            {c.statusRequested}
          </span>
          <span className="reqcard__no" style={{ marginLeft: "auto" }}>
            {requestNo}
          </span>
        </div>
        <div className="reqcard__body">
          <div className="reqrow">
            <span className="reqrow__k">{c.rPeriod}</span>
            <span className="reqrow__v mono">
              {request.startDate} – {request.endDate}
            </span>
          </div>
          <div className="reqrow">
            <span className="reqrow__k">{c.rDays}</span>
            <span className="reqrow__v mono">
              {request.daysCount}
              {c.unitD}
            </span>
          </div>
          <div className="reqrow">
            <span className="reqrow__k">{c.fEmg}</span>
            <span className="reqrow__v mono">{request.emergencyContact}</span>
          </div>
        </div>
      </div>

      {/* 승인 타임라인 */}
      <div className="slabel">
        {c.apTitle} ·{" "}
        <span className="now">
          {c.nowStep}: {c.ap2}
        </span>
      </div>
      <div className="appt" style={{ margin: "6px 2px 0" }}>
        <div className="apstep done">
          <span className="apstep__dot">{AttIcon.check}</span>
          <div className="apstep__t">{c.ap1}</div>
          <div className="apstep__s">{c.ap1s}</div>
          <div className="apstep__time">{submittedAt}</div>
        </div>
        <div className="apstep on">
          <span className="apstep__dot" />
          <div className="apstep__t">{c.ap2}</div>
          <div className="apstep__s">{c.ap2s}</div>
        </div>
        <div className="apstep pending">
          <span className="apstep__dot" />
          <div className="apstep__t">{c.ap3}</div>
          <div className="apstep__s">{c.ap3s}</div>
        </div>
        <div className="apstep pending">
          <span className="apstep__dot" />
          <div className="apstep__t">{c.ap4}</div>
          <div className="apstep__s">{c.ap4s}</div>
        </div>
      </div>

      {/* 하단 고정 액션 */}
      <div className="lv-foot">
        <Link className="fbtn fbtn--draft" href="/mobile/attendance/leave" aria-label={c.appTitle}>
          <AIc>{AttIcon.home}</AIc>
        </Link>
        <Link className="fbtn fbtn--submit" href="/mobile/attendance/leave/history">
          <AIc>{AttIcon.list}</AIc>
          {c.goHist}
        </Link>
      </div>
    </div>
  );
}
