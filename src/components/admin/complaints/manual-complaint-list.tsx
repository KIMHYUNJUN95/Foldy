import Link from "next/link";

// 수동 컴플레인 목록 — 화이트 리디자인(2026-10-14, 시안 FBManual-PC): 상자 없는 표 한 줄씩
// 상태(점 + 글자) · 제목(아래 내용 한 줄) · 플랫폼 · 건물 · 객실 · 작성자 · 등록일.
// 삭제는 줄에서 뺐다 — 상세 패널 위 휴지통 → 확인 창(되돌릴 수 없음, CLAUDE.md §9).

export type ManualComplaintLabels = {
  statusOpen: string;
  statusDone: string;
  colStatus: string;
  colTitle: string;
  colPlatform: string;
  colPlace: string;
  colAuthorDate: string;
};

export type ManualRow = {
  id: string;
  href: string;
  open: boolean;
  title: string;
  description: string | null;
  platform: string;
  place: string;
  byline: string;
};

type Props = {
  rows: ManualRow[];
  selectedId: string | null;
  labels: ManualComplaintLabels;
};

export function ManualComplaintList({ rows, selectedId, labels }: Props) {
  return (
    <div className="cxw-mt">
      <div className="cxw-mh">
        <span>{labels.colStatus}</span>
        <span>{labels.colTitle}</span>
        <span>{labels.colPlatform}</span>
        <span>{labels.colPlace}</span>
        <span className="r">{labels.colAuthorDate}</span>
      </div>
      <div className="cxw-rows">
        {rows.map((row) => (
          <Link key={row.id} href={row.href} className={`cxw-mr${selectedId === row.id ? " on" : ""}`} scroll={false}>
            <span className={`cxw-st${row.open ? " is-open" : " is-done"}`}>
              <i aria-hidden="true" />
              {row.open ? labels.statusOpen : labels.statusDone}
            </span>
            <span className="cxw-mr__t">
              <b>{row.title}</b>
              {row.description ? <span>{row.description}</span> : null}
            </span>
            <span className="cxw-mr__c">{row.platform}</span>
            <span className="cxw-mr__c">{row.place}</span>
            <span className="cxw-mr__c r num">{row.byline}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
