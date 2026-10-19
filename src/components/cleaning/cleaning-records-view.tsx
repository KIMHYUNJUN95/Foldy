"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  UserRound,
} from "lucide-react";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import { useIsTablet } from "@/components/shell/split-list";
import type { Dictionary, Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Copy = Dictionary["cleaning"];

export type CleaningRecordItem = {
  id: string;
  dateKey: string;
  title: string;
  taskLabel: string;
  staffUserId: string;
  staffName: string;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  status: string;
  notes: string | null;
};

// Compact, human duration ("1h 54m" / "8m 47s" / "34s"). Pure — can't import lib/cleaning into a
// client component (it pulls in the server-only Supabase client).
function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return "-";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

const STATUSES = ["completed", "in_progress", "cancelled"] as const;

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function statusTone(status: string): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "in_progress") return "bg-amber-500";
  return "bg-slate-300";
}

export function CleaningRecordsView({
  buildings,
  canViewOthers,
  copy,
  locale,
  members,
  monthKey,
  records,
  selectedBuilding,
  selectedStaff,
  selectedStatus,
}: {
  buildings: { value: string; label: string }[];
  canViewOthers: boolean;
  copy: Copy;
  locale: Locale;
  members: { id: string; name: string }[];
  monthKey: string;
  records: CleaningRecordItem[];
  selectedBuilding: string;
  selectedStaff: string;
  selectedStatus: string;
}) {
  const r = copy.records;
  const router = useRouter();

  // Tap a record → detail bottom sheet (shared BottomSheet handles slide + drag-to-dismiss).
  const isTablet = useIsTablet();
  const [selected, setSelected] = useState<CleaningRecordItem | null>(null);
  const openDetail = useCallback((rec: CleaningRecordItem) => setSelected(rec), []);

  // Filter picker bottom sheet (building / staff) — replaces the native <select> dropdowns.
  const [picker, setPicker] = useState<"building" | "staff" | null>(null);
  const openPicker = useCallback((kind: "building" | "staff") => setPicker(kind), []);

  // Build a URL for /mobile/cleaning/records preserving the other filters.
  const hrefWith = (next: { month?: string; staff?: string; status?: string; building?: string }) => {
    const p = new URLSearchParams();
    const month = next.month ?? monthKey;
    const staff = next.staff ?? selectedStaff;
    const status = next.status ?? selectedStatus;
    const building = next.building ?? selectedBuilding;
    if (month) p.set("month", month);
    if (staff) p.set("staff", staff);
    if (status) p.set("status", status);
    if (building) p.set("building", building);
    const qs = p.toString();
    return `/mobile/cleaning/records${qs ? `?${qs}` : ""}`;
  };

  const fmtTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Tokyo",
        }).format(new Date(iso))
      : "";

  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${monthKey}-15T00:00:00+09:00`));

  // Group by date (newest first); records already arrive ordered by date asc then time desc.
  const byDate = new Map<string, CleaningRecordItem[]>();
  for (const rec of records) byDate.set(rec.dateKey, [...(byDate.get(rec.dateKey) ?? []), rec]);
  const dateKeys = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  const totalSeconds = records.reduce((sum, rec) => sum + (rec.durationSeconds ?? 0), 0);
  const statusLabel = (s: string) =>
    s === "completed" ? r.status.completed : s === "cancelled" ? r.status.cancelled : r.status.in_progress;

  const dayLabel = (key: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "long",
      day: "numeric",
      weekday: "short",
      timeZone: "Asia/Tokyo",
    }).format(new Date(`${key}T00:00:00+09:00`));

  const buildingDisplay = buildings.find((b) => b.value === selectedBuilding)?.label ?? r.buildingAll;
  const staffDisplay = members.find((m) => m.id === selectedStaff)?.name ?? r.staffAll;
  const pickerOptions: { value: string; label: string }[] =
    picker === "building"
      ? [{ value: "", label: r.buildingAll }, ...buildings]
      : [{ value: "", label: r.staffAll }, ...members.map((m) => ({ value: m.id, label: m.name }))];
  const pickerCurrent = picker === "building" ? selectedBuilding : selectedStaff;
  const onPick = (value: string) => {
    const kind = picker;
    setPicker(null);
    router.push(hrefWith(kind === "building" ? { building: value } : { staff: value }));
  };

  const field = (label: string, value: React.ReactNode, block = false) => (
    <div className={cn("flex gap-4", block ? "flex-col gap-1" : "items-start justify-between")}>
      <dt className="shrink-0 text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-[13.5px] font-bold text-foreground",
          block ? "leading-relaxed whitespace-pre-wrap" : "text-right",
        )}
      >
        {value}
      </dd>
    </div>
  );

  // 기록 상세 — 폰 · 폴드는 바텀시트, 태블릿 가로는 오른쪽 칸(2026-10-05 넓은 화면 대응). 내용은 하나.
  const detailHeader = (selected: CleaningRecordItem) => (
      <>
        <p className="text-[11px] font-black uppercase tracking-[0.08em] text-muted-foreground">
          {r.detailTitle}
        </p>
        <p className="mt-1 text-[19px] font-black leading-snug tracking-[-0.02em] text-foreground">
          {selected.title}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
            {selected.taskLabel}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-0.5 text-[11px] font-bold text-foreground">
            <span className={cn("size-1.5 rounded-full", statusTone(selected.status))} />
            {statusLabel(selected.status)}
          </span>
        </div>
      </>
  );
  const detailBody = (selected: CleaningRecordItem) => (
    <dl className="mt-4 flex flex-col gap-2.5 border-t-[0.5px] border-[var(--separator)] pt-4">
      {field(r.staffLabel, selected.staffName || "-")}
      {field(r.dateLabel, dayLabel(selected.dateKey))}
      {field(r.startLabel, fmtTime(selected.startedAt) || "-")}
      {field(
        r.endLabel,
        selected.completedAt ? fmtTime(selected.completedAt) : r.ongoing,
      )}
      {field(
        r.durationLabel,
        <span className="font-mono">
          {selected.durationSeconds != null
            ? formatDuration(selected.durationSeconds)
            : r.ongoing}
        </span>,
      )}
      {selected.notes ? field(r.notesLabel, selected.notes, true) : null}
    </dl>
  );
  // 태블릿 가로는 오른쪽 칸이 늘 무언가를 보인다 — 고른 기록, 없으면 맨 위 기록(룸 링크와 같은 규칙).
  const paneRecord = selected ?? (dateKeys.length > 0 ? (byDate.get(dateKeys[0])?.[0] ?? null) : null);

  return (
    // 두 칸은 **상세 칸이 있을 때만**(2026-10-06 아이패드 점검) — 기록이 없는 달에도 오른쪽 자리를 비워 두면 왼쪽이 반쪽 폭으로 보였다.
    <div className={paneRecord ? "tablet:grid tablet:grid-cols-[minmax(0,1fr)_400px] tablet:items-start tablet:gap-5" : undefined}>
    <div className="pb-10">
      {/* Month + summary — a clean dashboard header */}
      <div className="mb-3 overflow-hidden rounded-[22px] border border-border bg-surface shadow-[0_18px_44px_-30px_rgba(15,23,42,0.5)]">
        <div className="flex items-center justify-between px-2.5 py-2.5">
          <Link
            aria-label={r.prevMonth}
            className="flex size-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-foreground active:scale-95"
            href={hrefWith({ month: shiftMonth(monthKey, -1) })}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <span className="text-[17px] font-black tracking-[-0.02em] text-foreground">{monthLabel}</span>
          <Link
            aria-label={r.nextMonth}
            className="flex size-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-foreground active:scale-95"
            href={hrefWith({ month: shiftMonth(monthKey, 1) })}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border border-t-[0.5px] border-[var(--separator)] bg-background/40">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ListChecks className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {r.summaryCount}
              </p>
              <p className="text-[18px] font-black leading-tight tracking-[-0.02em] text-foreground">
                {records.length}
                <span className="ml-0.5 text-[12px] font-bold text-muted-foreground">{r.countUnit}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clock3 className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {r.summaryDuration}
              </p>
              <p className="font-mono text-[18px] font-black leading-tight tracking-[-0.02em] text-foreground">
                {formatDuration(totalSeconds)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Building + staff — custom pill triggers that open a bottom-sheet picker */}
      <div className="mb-2.5 flex gap-2">
        <button
          className={cn(
            "relative flex h-11 flex-1 items-center rounded-2xl border px-9 shadow-[0_2px_8px_-6px_rgba(15,23,42,0.3)] transition-colors active:bg-slate-50",
            selectedBuilding ? "border-primary/40 bg-primary/[0.05]" : "border-border bg-surface",
          )}
          onClick={() => openPicker("building")}
          type="button"
        >
          <Building2 className="absolute left-3 size-[17px] text-primary" aria-hidden="true" />
          <span className="w-full truncate text-center text-[13px] font-bold text-foreground">
            {buildingDisplay}
          </span>
        </button>
        {canViewOthers && members.length > 0 ? (
          <button
            className={cn(
              "relative flex h-11 flex-1 items-center rounded-2xl border px-9 shadow-[0_2px_8px_-6px_rgba(15,23,42,0.3)] transition-colors active:bg-slate-50",
              selectedStaff ? "border-primary/40 bg-primary/[0.05]" : "border-border bg-surface",
            )}
            onClick={() => openPicker("staff")}
            type="button"
          >
            <UserRound className="absolute left-3 size-[17px] text-primary" aria-hidden="true" />
            <span className="w-full truncate text-center text-[13px] font-bold text-foreground">
              {staffDisplay}
            </span>
          </button>
        ) : null}
      </div>

      {/* Status — segmented control */}
      <div className="mb-4 flex gap-1 rounded-2xl bg-slate-100 p-1">
        <Link
          className={cn(
            "flex h-8 flex-1 items-center justify-center rounded-xl text-[12.5px] font-bold transition-colors",
            !selectedStatus ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground",
          )}
          href={hrefWith({ status: "" })}
        >
          {r.statusAll}
        </Link>
        {STATUSES.map((s) => (
          <Link
            className={cn(
              "flex h-8 flex-1 items-center justify-center rounded-xl text-[12.5px] font-bold transition-colors",
              selectedStatus === s ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground",
            )}
            href={hrefWith({ status: s })}
            key={s}
          >
            {statusLabel(s)}
          </Link>
        ))}
      </div>

      {/* Records grouped by date — horizontal text rows, no horizontal scroll */}
      {dateKeys.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <span className="mb-4 flex size-[60px] items-center justify-center rounded-[18px] bg-slate-50 text-slate-400">
            <CalendarDays className="size-7" aria-hidden="true" />
          </span>
          <p className="text-[15px] font-extrabold text-foreground">{r.empty}</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{r.emptySub}</p>
        </div>
      ) : (
        <div className="grid items-start gap-5 fold:grid-cols-2">
          {dateKeys.map((key) => {
            const items = byDate.get(key)!;
            return (
              <div key={key}>
                <div className="mb-2 flex items-center gap-2 px-0.5">
                  <span className="text-[12.5px] font-black tracking-[-0.01em] text-foreground">
                    {dayLabel(key)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-[7px] py-px font-mono text-[10.5px] font-semibold text-muted-foreground">
                    {items.length}
                    {r.countUnit}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                  {items.map((rec, i) => (
                    <button
                      className={cn(
                        "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors active:bg-slate-50",
                        i > 0 && "border-t-[0.5px] border-[var(--separator)]",
                        isTablet && paneRecord?.id === rec.id && "bg-primary/[0.06] shadow-[inset_3px_0_0_var(--primary)]",
                      )}
                      key={rec.id}
                      onClick={() => openDetail(rec)}
                      type="button"
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn("size-1.5 shrink-0 rounded-full", statusTone(rec.status))} />
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {fmtTime(rec.startedAt)}–{rec.completedAt ? fmtTime(rec.completedAt) : ""}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold tracking-[-0.01em] text-foreground">
                          {rec.title}
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-px text-[10px] font-bold text-slate-600">
                          {rec.taskLabel}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">
                          {rec.durationSeconds != null ? formatDuration(rec.durationSeconds) : r.ongoing}
                        </span>
                      </div>
                      {canViewOthers && rec.staffName ? (
                        <span className="pl-[14px] text-[11px] font-semibold text-muted-foreground">
                          {rec.staffName}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Record detail — bottom sheet; shows the full info for the tapped record. */}
      {!isTablet && selected ? (
        <BottomSheet ariaLabel={r.detailTitle} header={detailHeader(selected)} onClose={() => setSelected(null)}>
          {detailBody(selected)}
        </BottomSheet>
      ) : null}

      {/* Filter picker — building / staff bottom sheet */}
      {picker ? (
        <BottomSheet
          ariaLabel={picker === "building" ? r.buildingTitle : r.staffTitle}
          header={
            <p className="mb-3 text-[16px] font-black tracking-[-0.01em] text-foreground">
              {picker === "building" ? r.buildingTitle : r.staffTitle}
            </p>
          }
          onClose={() => setPicker(null)}
        >
          <div className="-mx-1 flex max-h-[56vh] flex-col gap-1 overflow-y-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {pickerOptions.map((opt) => {
              const on = opt.value === pickerCurrent;
              return (
                <button
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors",
                    on ? "border-primary bg-primary/[0.06]" : "border-transparent active:bg-slate-50",
                  )}
                  key={opt.value || "__all"}
                  onClick={() => onPick(opt.value)}
                  type="button"
                >
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[14px] font-bold",
                      on ? "text-primary" : "text-foreground",
                    )}
                  >
                    {opt.label}
                  </span>
                  {on ? (
                    <Check className="size-[18px] shrink-0 text-primary" strokeWidth={2.6} aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </BottomSheet>
      ) : null}
    </div>
    {isTablet && paneRecord ? (
      <aside className="sticky top-3 hidden max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[22px] border border-border bg-surface px-5 pb-5 pt-5 tablet:block">
        {detailHeader(paneRecord)}
        {detailBody(paneRecord)}
      </aside>
    ) : null}
    </div>
  );
}
