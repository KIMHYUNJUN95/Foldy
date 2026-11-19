/**
 * Beds24 크레딧 사용 기록 — 서버와 화면이 같이 쓰는 모양 (2026-11-18).
 *
 * 도메인 계약: docs/engineering/01-beds24-integration.md → 「크레딧 사용 기록」.
 * 여기에는 **타입과 상수만** 둔다(클라이언트 컴포넌트가 import 해도 서버 코드가 딸려 오지 않게).
 */

/** 5분 창 한도. Beds24 가 헤더로 주지 않아(실측) 고정값으로 둔다. 헤더가 오면 그 값을 쓴다. */
export const BEDS24_CREDIT_LIMIT = 200;
/** 이 아래면 「주의」(주황). 리뷰 수집이 멈추는 값(`MIN_REMAINING_CREDITS`)과 같다. */
export const BEDS24_CREDIT_WARN_BELOW = 50;
/** 이 아래면 「쉬는 중」(빨강). `LOW_CREDIT_THRESHOLD` 와 같다. */
export const BEDS24_CREDIT_STOP_BELOW = 10;
/** 기록 보관 기간(일). */
export const BEDS24_CREDIT_RETENTION_DAYS = 30;

/** 어디에 썼나 — 화면 이름은 i18n `beds24Credit.feature.<key>`. */
export const BEDS24_CREDIT_FEATURES = [
  "rates_write", // 판매 캘린더 요금 바꾸기
  "rates_read", // 요금 · 재고 읽어 오기
  "block_write", // 방 차단
  "booking_write", // 수기 예약 만들기 · 고치기 · 취소
  "bookings_sync", // 예약 받아 오기
  "guest_messages", // 손님 메시지
  "reviews_sync", // 리뷰 수집
  "rooms_sync", // 건물 · 방 정보
  "auth", // 토큰 갱신
  "other",
] as const;
export type Beds24CreditFeature = (typeof BEDS24_CREDIT_FEATURES)[number];

/** 누가 — 사람이 누른 일은 `user`, 크론 · 웹훅 · 백그라운드 작업은 `auto`. */
export type Beds24CreditActor =
  | { kind: "user"; userId: string; name: string }
  | { kind: "auto"; job: string };

/** 호출 한 번을 기록할 때 넘기는 정보. */
export type Beds24CreditCallContext = {
  organizationId: string | null;
  feature: Beds24CreditFeature;
  actor: Beds24CreditActor;
  /** 화면에 그대로 보이지 않는 짧은 설명 키(예: `calendar.post`). */
  action: string;
  /** 「방 6개」 같은 덧붙임에 쓰는 개수(없으면 null). */
  itemCount?: number | null;
  /** 어느 Beds24 토큰(계정)으로 불렀나. 지금은 토큰이 하나라 항상 `main`(없으면 `main`). */
  credentialKey?: string;
};

/** 지금 쓰는 유일한 토큰의 키. 토큰이 늘어나면 기능마다 다른 키를 넘긴다. */
export const BEDS24_DEFAULT_CREDENTIAL_KEY = "main";

export type Beds24CreditState = "ok" | "warn" | "stop" | "unknown";

/** 상단 줄 게이지 · 모바일 한 줄. 모든 시각은 epoch ms. */
export type Beds24CreditSnapshot = {
  state: Beds24CreditState;
  /** 남은 크레딧. 최근 기록이 없으면 null(= 모름). 리셋 시각이 지났으면 한도 값으로 본다. */
  remaining: number | null;
  limit: number;
  /** 다시 가득 차는 시각. */
  resetsAt: number | null;
  /** `api_cooldown` 이 걸려 있으면 풀리는 시각. */
  pausedUntil: number | null;
  /** 이 값을 Beds24 에서 마지막으로 받은 시각. */
  recordedAt: number | null;
};

export type Beds24CreditActorUsage = {
  /** `user:<id>` · `auto` · `outside`(Foldy 밖에서 쓴 양 — 남은 크레딧 차이로 계산). */
  key: string;
  kind: "user" | "auto" | "outside";
  /** 사람 이름. auto · outside 는 빈 문자열(화면이 i18n 으로 붙인다). */
  name: string;
  /** 가장 많이 쓴 곳(작은 글씨). */
  topFeatures: Beds24CreditFeature[];
  credits: number;
};

export type Beds24CreditFeatureUsage = { feature: Beds24CreditFeature; credits: number };

/** 게이지를 눌렀을 때의 요약 창 · 모바일 시트. */
export type Beds24CreditSummary = {
  snapshot: Beds24CreditSnapshot;
  /** 지금 5분 창에서 쓴 합(Foldy 밖 포함). */
  windowUsed: number;
  actors: Beds24CreditActorUsage[];
};

export type Beds24CreditRange = "5m" | "1h" | "today" | "7d";

export type Beds24CreditWindowBar = {
  /** 창 시작 시각. */
  startsAt: number;
  used: number;
  /** 이 창에서 한도에 닿았거나(쉬는 중) 주의 구간에 들어갔나. */
  level: "ok" | "warn" | "stop";
};

export type Beds24CreditCall = {
  id: string;
  at: number;
  /** DB 가 준 `called_at` 그대로(마이크로초까지) — 「더 보기」 커서는 이 값으로 잇는다(ms 로 줄이면 같은 ms 줄이 빠진다). */
  calledAt: string;
  actor: { kind: "user" | "auto"; userId: string | null; name: string; job: string | null };
  feature: Beds24CreditFeature;
  action: string;
  itemCount: number | null;
  /** 헤더가 없던 호출(실패 등)은 null. */
  cost: number | null;
  remaining: number | null;
  httpStatus: number | null;
};

/** 자동화 관제실 크레딧 칸. */
export type Beds24CreditDetail = {
  snapshot: Beds24CreditSnapshot;
  range: Beds24CreditRange;
  total: number;
  /** 최근 1시간, 5분 창 12개(옛 것부터). 기간 선택과 상관없이 항상 1시간. */
  bars: Beds24CreditWindowBar[];
  actors: Beds24CreditActorUsage[];
  features: Beds24CreditFeatureUsage[];
  /** 최근 호출 첫 장(기간 안 · 거르기 없음 · 새 것부터 50개). */
  recentCalls: Beds24CreditCallPage;
  /** 오늘(도쿄) 쉰 횟수와 마지막으로 쉰 때. */
  pausesToday: { count: number; lastAt: number | null; lastSeconds: number | null };
};

/** 최근 호출 한 장에 담는 줄 수. 「더 보기」도 같은 수. */
export const BEDS24_CREDIT_CALL_PAGE_SIZE = 50;

/**
 * 최근 호출 거르기 — 「누가」 줄(`user:<id>` · `auto`) · 「어디에」 줄(기능). 둘 다 고르면 둘 다 맞는 호출만.
 * `outside`(Foldy 밖)는 호출 기록이 없어 거를 수 없다.
 */
export type Beds24CreditCallFilter = { actor: string | null; feature: Beds24CreditFeature | null };

/** 「더 보기」 커서 — 지금 보이는 가장 옛 줄. (called_at, id) 순서로 그 다음부터. */
export type Beds24CreditCallCursor = { calledAt: string; id: string };

export type Beds24CreditCallPage = {
  calls: Beds24CreditCall[];
  /** 이 장 뒤에 더 있나(개수는 세지 않는다 — 한 줄 더 물어 안다). */
  hasMore: boolean;
  /** 기간 시작(epoch ms) — 화면이 범위를 벗어난 줄을 걷어 낼 때 쓴다(5분 · 1시간은 시간이 지나며 밀린다). */
  since: number;
};
