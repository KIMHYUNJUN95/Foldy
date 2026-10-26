"use client";

/**
 * 모바일 사용자 관리 › 서류(재류카드 R4, 2026-10-26, 시안 M8bU3z… Docs-Phone · Docs-Fold · Docs-Tablet).
 * 할 일 순 한 목록 + 위 숫자 거르기(밑줄 글 단추, 좁으면 줄바꿈). 줄을 누르면 `/mobile/users/documents/{userId}` —
 * 태블릿 가로는 `SplitList` 가 오른쪽 칸에 연다. 상태는 글자만(빨강은 만료만). 거르기 바꾸기는 바로(움직임 없음).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  ROSTER_FILTERS,
  countRoster,
  inRosterFilter,
  rosterStatus,
  type RosterFilter,
  type StaffDocRosterRow,
} from "@/lib/staff-documents/roster";
import { MobileUsersHead } from "./mobile-users-head";
import "./mobile-users.css";

const initialOf = (name: string) => name.replace(/\(.*\)/, "").trim().charAt(0) || "?";

export function MobileStaffDocs({
  rows,
  memberCount,
  inviteCount,
  locale,
}: {
  rows: StaffDocRosterRow[];
  memberCount: number | null;
  inviteCount: number | null;
  locale: Locale;
}) {
  const dict = getDictionary(locale);
  const c = dict.admin.users.console;
  const idc = dict.idCard;
  const [filter, setFilter] = useState<RosterFilter>("all");
  const counts = useMemo(() => countRoster(rows), [rows]);
  const shown = useMemo(() => rows.filter((row) => inRosterFilter(row.bucket, filter)), [rows, filter]);
  const label: Record<RosterFilter, string> = {
    all: c.docsFilterAll,
    pending: c.docsFilterPending,
    expired: c.docsFilterExpired,
    within90: c.docsFilter90,
    missing: c.docsFilterMissing,
  };
  const monthDay = (key: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));

  const meta = (row: StaffDocRosterRow) => {
    // 국적이 없으면 오른쪽 할 일 칸이 「국적 없음」이라 여기서는 되풀이하지 않는다.
    const parts: string[] = row.nationalityName ? [row.nationalityName] : [];
    if (!row.doc) parts.push(c.docsNoDoc);
    else if (row.doc.kind === "my_number_card") parts.push(idc.titleMyNumber);
    else if (row.doc.residenceStatus) parts.push(row.doc.residenceStatus);
    if (row.doc?.expiresOn && (row.bucket === "expired" || row.bucket === "within30")) parts.push(monthDay(row.doc.expiresOn));
    return parts.join(" · ");
  };

  return (
    <div className="muw">
      <MobileUsersHead active="documents" locale={locale} memberCount={memberCount} inviteCount={inviteCount} docsCount={rows.length} />
      <div className="muw-dfl" role="group" aria-label={c.docsFilterAria}>
        {ROSTER_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => {
              if (filter !== key) haptic("light");
              setFilter(key);
            }}
          >
            {label[key]}
            <b className={`num${key === "expired" && counts.expired > 0 ? " is-red" : ""}`}>{counts[key]}</b>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="muw-empty">
          <b>{c.docsEmpty}</b>
        </div>
      ) : (
        <div className="muw-dlist">
          {shown.map((row) => {
            const st = rosterStatus(row, c);
            return (
              <Link key={row.userId} href={`/mobile/users/documents/${row.userId}`} className="muw-row">
                <span className="muw-av" aria-hidden="true">
                  {initialOf(row.name)}
                </span>
                <span className="muw-rb">
                  <span className="muw-rt">
                    {row.name || "—"}
                    {row.isSelf ? <span className="me">{c.selfChip}</span> : null}
                  </span>
                  <span className="muw-rm">{meta(row)}</span>
                </span>
                <span className={`muw-dst is-${st.tone}`}>{st.text}</span>
                {st.tone === "link" ? null : <ChevronRight className="muw-chev" aria-hidden="true" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
