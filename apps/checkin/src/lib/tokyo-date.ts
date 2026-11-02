// 체크인 날짜는 도쿄 기준(Foldy 7번 규칙과 같다). UTC 로 자르면 오전 0~9시가 전날이 된다.
export function todayTokyo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// "YYYY-MM-DD" 끼리의 날짜 계산 — 시간대가 끼지 않도록 UTC 정오로 계산한다.
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  // 2월 29일 + n년이 평년이면 2월 28일로.
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${String(y + years).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
