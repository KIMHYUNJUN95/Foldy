import { weeklyChipDetail, type WeeklyLimitChip } from "@/lib/staff-documents/weekly-limit";

type Copy = {
  weeklyOver: string;
  weeklyNear: string;
  weeklyHours: string;
  weeklyHoursWhole: string;
  weeklyRange: string;
};

/**
 * 「28시간 초과 · 근접」 칩(docs/product/41 R4) — 관리자 근태(`.adm .wk28`) · 모바일 명단(`.att .wk28`)이 같이 쓴다.
 * 가장 많았던 7일과 시간은 title(마우스) + 화면 읽기 이름으로.
 */
export function WeeklyLimitBadge({ chip, copy }: { chip: WeeklyLimitChip | null | undefined; copy: Copy }) {
  if (!chip) return null;
  const label = chip.status === "over" ? copy.weeklyOver : copy.weeklyNear;
  const detail = weeklyChipDetail(chip, copy);
  return (
    <span className={`wk28${chip.status === "over" ? " is-over" : ""}`} title={detail} aria-label={`${label} · ${detail}`}>
      {label}
    </span>
  );
}

/** 관리자 직원 상세 · 급여 패널의 설명 한 줄 — 「자격외활동(주 28시간) 대상이에요 … 가장 많았던 7일: 10/14~10/20 · 29시간 30분」. */
export function WeeklyLimitNote({ chip, copy }: { chip: WeeklyLimitChip | null | undefined; copy: Copy & { weeklyStaffNote: string } }) {
  if (!chip) return null;
  return (
    <p className={`wk28-note${chip.status === "over" ? " is-over" : ""}`} role="note">
      {copy.weeklyStaffNote.replace("{detail}", weeklyChipDetail(chip, copy))}
    </p>
  );
}
