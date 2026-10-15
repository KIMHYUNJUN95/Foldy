import Link from "next/link";
import { LiveWash } from "@/components/shared/live-wash";
import { MessageSquareWarning } from "lucide-react";
import "./feedback-mobile.css";
import { platformName } from "./cx-platform";
import { getDictionary, type Locale } from "@/lib/i18n";
import { tokyoDateOf } from "@/lib/tokyo-date";
import { getCanonicalPropertyName, localizePropertyName } from "@/lib/room-label-normalization";
import type { Complaint } from "@/lib/complaints";

function md(iso: string): string {
  const day = tokyoDateOf(iso);
  return day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : "—";
}

/**
 * 수동 컴플레인 — 모바일 목록. 화이트 리디자인(2026-10-14, 시안 FBManual-Phone):
 * 「미처리 · 오래된 순」 → 「처리 완료 · 최근 순」 두 묶음, 한 줄씩(상태 점 · 제목 · 플랫폼 · 건물 · 객실 · 작성자 · 날짜).
 * 등록은 머리의 「+ 컴플레인 등록」(떠 있는 + 버튼은 뺐다), 삭제는 상세에서(확인 시트). 서버 컴포넌트.
 */
export function ComplaintList({ locale, complaints }: { locale: Locale; complaints: Complaint[] }) {
  const dict = getDictionary(locale);
  const t = dict.complaints;
  const buildingLabels = dict.cleaning.buildingLabels;

  const open = complaints.filter((c) => c.status === "open").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = complaints.filter((c) => c.status !== "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (complaints.length === 0) {
    return (
      <div className="fbw fbw-empty">
        <span className="fbw-empty__ic">
          <MessageSquareWarning aria-hidden="true" />
        </span>
        <b>{t.manualEmptyTitle}</b>
        <span>{t.manualEmptySub}</span>
      </div>
    );
  }

  const row = (c: Complaint) => {
    const place = c.propertyName
      ? `${localizePropertyName(getCanonicalPropertyName(c.propertyName), buildingLabels)}${c.roomLabel ? ` · ${c.roomLabel}` : ""}`
      : null;
    const meta = [platformName(c.platform, dict), place, c.authorName].filter(Boolean).join(" · ");
    return (
      <Link key={c.id} href={`/mobile/complaints/${c.id}`} className="fbw-mr" data-live={c.id}>
        <i className={c.status === "open" ? "is-open" : "is-done"} aria-hidden="true" />
        <span className="fbw-mr__main">
          <b>{c.title}</b>
          <span>{meta}</span>
        </span>
        <time className="num">{md(c.createdAt)}</time>
      </Link>
    );
  };

  return (
    <LiveWash move sig={[...open, ...done].map((c) => c.id).join(",")}>
    <div className="fbw fbw-manual">
      {open.length > 0 ? (
        <section>
          <h2 className="fbw-grp">
            {t.statusOpen} <span>{t.wOpenGroupSub.replace("{n}", String(open.length))}</span>
          </h2>
          <div className="fbw-rows">{open.map(row)}</div>
        </section>
      ) : null}
      {done.length > 0 ? (
        <section>
          <h2 className="fbw-grp">
            {t.wDoneTab} <span>{t.wDoneGroupSub}</span>
          </h2>
          <div className="fbw-rows">{done.map(row)}</div>
        </section>
      ) : null}
    </div>
    </LiveWash>
  );
}
