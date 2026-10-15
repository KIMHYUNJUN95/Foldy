"use client";

import { LiveWash } from "@/components/shared/live-wash";
import Link from "next/link";
import { Plus } from "lucide-react";
import { BugStatusBadge } from "@/components/bugs/bug-status-badge";
import { bugStatusLabel, type BugCopy, type BugReport } from "@/components/bugs/bug-types";

// ISO 날짜를 "MM.dd" 형태로 클라이언트에서 포맷
function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}.${dd}`;
}

// BR-XXXX 형태의 display ID: id(uuid) 앞 4자리 기반 fallback
function formatBugCode(id: string): string {
  const suffix = id.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `BR-${suffix}`;
}

type Props = {
  copy: BugCopy;
  reports: BugReport[];
  isReviewer: boolean;
};

export function BugsListClient({ copy, reports, isReviewer }: Props) {
  const sectionLabel = isReviewer ? copy.listHeadingAll : copy.listHeadingMine;

  return (
    // 음수 여백은 셸의 패딩과 **정확히** 같아야 한다. 이 화면은 바텀탭을 띄우므로 셸의 하단
    // 여백이 `pb-8`(32px)이 아니라 `pb-[124px]` 이다 — `-mb-8` 만 쓰면 92px 이 남아 콘텐츠
    // 아래로 빈 공간이 스크롤된다(2026-08-07 수정). 바텀탭을 숨기는 화면(게시판 상세)만
    // `-mb-8` 이 맞다.
    <div className="-mx-5 -mb-[124px] -mt-[84px] flex h-[100dvh] flex-col bg-background">
      {/* MobileShell chrome 84px 영역 확보 */}
      <div className="h-[84px] shrink-0" aria-hidden="true" />

      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between px-[18px] pb-[10px] pt-4">
        <h3 className="m-0 text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted-foreground">
          {sectionLabel}
        </h3>
        <Link
          href="/mobile/bugs/new"
          className="inline-flex h-[30px] items-center gap-[5px] rounded-[8px] border border-primary bg-primary px-[13px] text-[12px] font-extrabold text-white"
        >
          <Plus className="size-[14px]" aria-hidden="true" />
          {copy.composeCta}
        </Link>
      </div>

      {/* 컬럼 헤더 */}
      <div className="flex items-center gap-3 border-b border-border px-[18px] py-[7px] text-[10px] font-extrabold uppercase tracking-[0.06em] text-[hsl(222_10%_60%)]">
        <span className="w-[70px]">{copy.listColumnId}</span>
        <span className="flex-1">{copy.listColumnTitle}</span>
        <span className="w-[64px] text-right">{copy.listColumnStatus}</span>
      </div>

      {/* 목록 (스크롤) */}
      <div className="flex-1 overflow-y-auto pb-[40px]">
        {reports.length === 0 ? (
          <p className="px-[18px] pt-[32px] text-center text-[13px] font-semibold text-muted-foreground">
            {copy.emptyState}
          </p>
        ) : (
          <LiveWash move sig={reports.map((b) => b.id).join(",")}>
          {reports.map((bug) => (
            <Link
              key={bug.id}
              data-live={bug.id}
              href={`/mobile/bugs/${bug.id}`}
              className="flex items-center gap-3 border-b border-border/60 px-[18px] py-[14px]"
            >
              <span className="w-[70px] shrink-0 font-mono text-[12.5px] font-bold text-primary">
                {formatBugCode(bug.id)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-foreground">
                  {bug.title}
                </span>
                <span className="mt-[3px] block font-mono text-[10.5px] font-semibold text-[hsl(222_10%_60%)]">
                  {formatDateLabel(bug.createdAt)}
                </span>
              </span>
              <span className="w-[64px] shrink-0 text-right">
                <BugStatusBadge status={bug.status} label={bugStatusLabel(copy, bug.status)} />
              </span>
            </Link>
          ))}
          </LiveWash>
        )}
      </div>
    </div>
  );
}
