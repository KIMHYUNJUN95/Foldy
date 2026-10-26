import { CxIcon } from "./cx-icons";
import type { Dictionary } from "@/lib/i18n";

// src/lib/complaints.ts 의 ComplaintPlatform 로컬 복제.
// 여기에 정의(가져오지 않음)해서 클라이언트 컴포넌트가
// 번들 시점에 server-only 가드를 건드리지 않고 쓸 수 있다.
export type ComplaintPlatform =
  | "airbnb"
  | "booking"
  | "google"
  | "tripadvisor"
  | "jalan"
  | "rakuten"
  | "direct"
  | "other";

type PlatformDef = {
  name: string;
  mono: string;
  bg: string;
  ink: string;
  solid: string;
  avg: string;
  maxRating: number;
};

export const PLATFORMS: Record<ComplaintPlatform, PlatformDef> = {
  airbnb: {
    name: "Airbnb",
    mono: "A",
    bg: "#fbe2e7",
    ink: "#cf2e54",
    solid: "#e0485f",
    avg: "linear-gradient(160deg,#ff8aa0,#e0485f)",
    maxRating: 5,
  },
  booking: {
    name: "Booking.com",
    mono: "B",
    bg: "#e3ecf7",
    ink: "#27548f",
    solid: "#2a5b9e",
    avg: "linear-gradient(160deg,#5b8fd6,#2a5b9e)",
    maxRating: 10,
  },
  google: {
    name: "Google",
    mono: "G",
    bg: "#e8f5e9",
    ink: "#2e7d32",
    solid: "#388e3c",
    avg: "linear-gradient(160deg,#66bb6a,#2e7d32)",
    maxRating: 5,
  },
  tripadvisor: {
    name: "TripAdvisor",
    mono: "T",
    bg: "#e8f5f1",
    ink: "#00aa6c",
    solid: "#00aa6c",
    avg: "linear-gradient(160deg,#34e0a1,#00aa6c)",
    maxRating: 5,
  },
  jalan: {
    name: "Jalan",
    mono: "J",
    bg: "#fff3e0",
    ink: "#e65100",
    solid: "#f57c00",
    avg: "linear-gradient(160deg,#ffb74d,#e65100)",
    maxRating: 5,
  },
  rakuten: {
    name: "Rakuten",
    mono: "R",
    bg: "#fce4ec",
    ink: "#bf0000",
    solid: "#bf0000",
    avg: "linear-gradient(160deg,#ef5350,#bf0000)",
    maxRating: 5,
  },
  direct: {
    name: "Direct",
    mono: "D",
    bg: "var(--primary-bg)",
    ink: "var(--cx-primary)",
    solid: "#7a52e6",
    avg: "linear-gradient(160deg,#8a63f0,#5a30cf)",
    maxRating: 0,
  },
  other: {
    name: "Other",
    mono: "?",
    bg: "var(--cx-surface)",
    ink: "var(--cx-muted)",
    solid: "var(--faint)",
    avg: "linear-gradient(160deg,hsl(222 10% 60%),hsl(222 10% 40%))",
    maxRating: 0,
  },
};

export function ratingMax(plat: ComplaintPlatform): number {
  return PLATFORMS[plat].maxRating;
}

export function platformName(plat: ComplaintPlatform, dict: Dictionary): string {
  return plat === "direct" ? dict.complaints.platformDirect : PLATFORMS[plat].name;
}

/** 정사각형 출처 배지 (목록 카드 / 생성 셀). */
export function PlatformBadge({ plat, sm = false }: { plat: ComplaintPlatform; sm?: boolean }) {
  const p = PLATFORMS[plat];
  return (
    <span className={`cx-pbadge${sm ? " sm" : ""}`} style={{ background: p.bg, color: p.ink }}>
      {p.mono}
    </span>
  );
}

/** 색 점 + 플랫폼 이름이 있는 알약 칩. */
export function PlatformSource({ plat, dict }: { plat: ComplaintPlatform; dict: Dictionary }) {
  const p = PLATFORMS[plat];
  return (
    <span className="cx-psrc" style={{ background: p.bg, color: p.ink }}>
      <span className="d" style={{ background: p.solid }} />
      {platformName(plat, dict)}
    </span>
  );
}

/** 목록 카드용 컴팩트 평점 알약 (예: ★ 2.0 / 5). */
export function RatingPill({ plat, rating }: { plat: ComplaintPlatform; rating: number | null }) {
  const max = ratingMax(plat);
  if (!max || rating == null) return null;
  return (
    <span className="cx-rpill">
      <span className="ic">{CxIcon.star}</span>
      <b>{rating.toFixed(1)}</b>
      <span className="rmax">/ {max}</span>
    </span>
  );
}

/** 상세 메타 행용 채워진 별 점. Booking (최대 10)은 별 하나만 표시한다. */
export function StarPips({ plat, rating }: { plat: ComplaintPlatform; rating: number | null }) {
  const max = ratingMax(plat);
  if (!max || rating == null) return null;
  if (max > 5) {
    return (
      <span className="cx-pips">
        <span className="pip on">{CxIcon.star}</span>
      </span>
    );
  }
  return (
    <span className="cx-pips">
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`pip ${i < rating ? "on" : ""}`}>
          {CxIcon.star}
        </span>
      ))}
    </span>
  );
}
