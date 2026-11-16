import type { Locale } from "@/lib/i18n";

/**
 * 청소 기록의 소요 시간 표기 · 합계 규칙 하나 — PC 기록 표(`/admin/cleaning`)와 모바일 청소 기록이 같이 쓴다.
 * 순수 함수(서버 전용 Supabase 를 끌어들이지 않는다) — 클라이언트 컴포넌트에서도 가져올 수 있다.
 */

/** ko 「1시간 10분」 · ja 「1時間10分」(붙임) · en 「1h 10m」. 1분 미만은 「0분」. */
export function formatCleaningMinutes(minutes: number, locale: Locale, units: { hour: string; min: string }): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const gap = locale === "ja" ? "" : " ";
  if (h === 0) return `${m}${units.min}`;
  return m === 0 ? `${h}${units.hour}` : `${h}${units.hour}${gap}${m}${units.min}`;
}

export type DurationRecordLike = {
  /** 완료한 기록만 true — 진행 중 · 취소는 false. */
  finished: boolean;
  /** 「처리 끝」(청소한 시간 없음). */
  closed?: boolean;
  seconds: number | null;
};

/**
 * 이 기록이 소요 시간으로 **세어지는** 분. 완료 · 처리 끝 아님 · 잰 시간 > 0 일 때만 — 취소 · 진행 중 ·
 * 처리 끝 · 시각 모름(0초)은 null. 줄 표시 · 총 소요 · 평균이 모두 이 판정 하나를 따른다.
 */
export function countedCleaningMinutes(rec: DurationRecordLike): number | null {
  if (!rec.finished || rec.closed) return null;
  if (rec.seconds == null || rec.seconds <= 0) return null;
  return Math.round(rec.seconds / 60);
}

export function summarizeCleaningDurations(recs: readonly DurationRecordLike[]): {
  totalMin: number;
  timedCount: number;
  avgMin: number | null;
} {
  let totalMin = 0;
  let timedCount = 0;
  for (const rec of recs) {
    const min = countedCleaningMinutes(rec);
    if (min == null) continue;
    totalMin += min;
    timedCount += 1;
  }
  return { totalMin, timedCount, avgMin: timedCount ? Math.round(totalMin / timedCount) : null };
}

/** 관리자 기록 줄(`dur` 분 · 상태 done/progress/cancelled · 처리 끝)을 소요 규칙 입력으로. 화면 · 내보내기가 같이 쓴다. */
export function historyRowDuration(h: { status: string; closed?: boolean; dur: number | null }): DurationRecordLike {
  return { finished: h.status === "done", closed: Boolean(h.closed), seconds: h.dur == null ? null : h.dur * 60 };
}
