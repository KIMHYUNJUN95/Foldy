/**
 * 손님 메시지 — 통로(채널 어댑터)와 무관한 표준 모양. docs/product/47-guest-messaging.md §4
 *
 * 화면 · 규칙 · 업무 연결은 이 모양만 안다. Beds24 는 통로 하나(`beds24-adapter.ts`)이고, 나중에 OTA 직접 연동 ·
 * 이메일(직접 예약 손님) 어댑터를 같은 인터페이스로 붙인다.
 *
 * **순수 모듈** — 서버 import 없음(테스트 · 어디서나 가져올 수 있게).
 */

export type GuestMessageProvider = "beds24";

export type GuestMessageDirection = "guest" | "host" | "internal" | "system";

export type GuestConversationStatus = "awaiting" | "done" | "snoozed";

export type GuestMessageAttachment = {
  name: string | null;
  mimeType: string | null;
  /** 통로가 주소를 줬을 때만. */
  url: string | null;
  /** 본문에 파일 데이터(base64)가 실려 왔다 — 데이터 자체는 저장하지 않는다. */
  inline: boolean;
};

/** 메시지에 딸린 예약 정보(웹훅 본문에 예약이 같이 오면 채운다). 모르는 칸은 null. */
export type NormalizedBookingContext = {
  providerBookingId: string;
  /** 채널 번호(Beds24 `apiReference`) — 우리 예약 행 찾기에 쓴다. */
  channelReference: string | null;
  externalPropertyId: string | null;
  externalRoomId: string | null;
  guestName: string | null;
  guestLanguage: string | null;
  /** `classifyGuestChannel` 결과. */
  channel: GuestChannelKey | null;
  bookingStatus: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
};

export type NormalizedMessage = {
  provider: GuestMessageProvider;
  externalId: string;
  providerBookingId: string;
  direction: GuestMessageDirection;
  /** 통로가 준 출처 원문(모르는 값도 그대로). */
  providerSource: string | null;
  body: string;
  /** ISO. 통로가 시각을 주지 않으면 받은 시각. */
  sentAt: string;
  /** 시간대 표시가 없는 시각을 UTC 로 읽었다(Beds24 실제 형식은 V1 확인 전 — 세어서 경고로 남긴다). */
  timeAssumedUtc: boolean;
  read: boolean;
  attachments: GuestMessageAttachment[];
  externalPropertyId: string | null;
  externalRoomId: string | null;
  booking: NormalizedBookingContext | null;
};

export type GuestChannelKey = "airbnb" | "booking" | "expedia" | "agoda" | "vrbo" | "direct" | "other";

/**
 * Beds24 로 답장을 보낼 수 있는 채널 — **허용 목록**(2026-11-12 검토). 이 밖(직접 예약 · 모름 · 그 밖)은 보내지 않는다.
 * 실제 값 · 채널별 동작은 V4 에서 확정한다(47 §3-4).
 */
export const OTA_SENDABLE_CHANNELS: readonly GuestChannelKey[] = ["airbnb", "booking", "expedia", "agoda", "vrbo"];

/** 크레딧 헤더(마지막 응답 기준). `resetsAt` 은 ms epoch. */
export type ChannelCreditSnapshot = {
  remaining: number | null;
  resetsAt: number | null;
  requestCost: number | null;
  /** 5분 한도 자체(헤더가 줄 때만 — 지금 Beds24 는 남은 양만 준다). 없으면 화면이 200 으로 추정한다. */
  limit?: number | null;
};

export type OutboundItem = {
  outboxId: string;
  providerBookingId: string;
  body: string;
  channel: GuestChannelKey | null;
};

export type SendItemResult =
  | { outboxId: string; ok: true; externalId: string | null }
  | {
      outboxId: string;
      ok: false;
      /**
       * `uncertain` — 요청은 나갔는데 이 줄의 결과가 응답에 없다. **다시 보내지 않는다**(되돌아옴으로 확인).
       * 나머지는 보내지 않았거나 Beds24 가 거절했다 — 다시 보내도 같다.
       */
      reason: "direct_booking" | "unknown_channel" | "provider_rejected" | "invalid_booking_id" | "uncertain";
      detail?: string;
    };

export type SendOutcome =
  | { kind: "sent"; items: SendItemResult[]; credit: ChannelCreditSnapshot }
  /** 5분 한도를 넘었다 — `retryAfterSec` 뒤에 다시. 이 묶음의 어떤 것도 나가지 않았다. */
  | { kind: "rate_limited"; retryAfterSec: number; credit: ChannelCreditSnapshot; items: SendItemResult[] }
  /**
   * 묶음 전체 실패. 거절 줄은 `items` 에 따로 온다.
   * - `pre_send`: 요청을 내보내기 전(설정 · 토큰 없음) — 나간 것이 없으니 나중에 다시 보내도 된다.
   * - `rejected`: Beds24 가 받고 거절(4xx) — 다시 보내도 같다.
   * - `uncertain`: 요청은 나갔는데 결과를 모른다(네트워크 끊김 · 5xx) — **다시 보내지 않는다**.
   */
  | {
      kind: "failed";
      phase: "pre_send" | "rejected" | "uncertain";
      errorCode: string;
      credit: ChannelCreditSnapshot | null;
      items: SendItemResult[];
    };

export type MarkReadOutcome =
  | { kind: "ok"; credit: ChannelCreditSnapshot }
  | { kind: "rate_limited"; retryAfterSec: number; credit: ChannelCreditSnapshot }
  | { kind: "failed"; errorCode: string; credit: ChannelCreditSnapshot | null };

/**
 * 채널 어댑터 — 이 세 가지만 한다(47 §4).
 * `receive` 는 순수(웹훅 본문 → 표준 메시지, 통로 호출 없음 — 크레딧 0).
 */
export interface GuestMessageChannelAdapter {
  readonly provider: GuestMessageProvider;
  receive(rawWebhookBody: unknown): NormalizedMessage[];
  send(items: OutboundItem[]): Promise<SendOutcome>;
  markRead(externalIds: string[]): Promise<MarkReadOutcome>;
}

/** `guest_message_channel_state.settings` 의 모양(+ 칸 값). */
export type ResponseTargetCategory = "inquiry" | "request" | "staying" | "other";

export type GuestMessageSettings = {
  responseTargetMinutes: Record<ResponseTargetCategory, number>;
  nightPause: boolean;
  creditReserve: number;
  stallHours: number;
};

export const DEFAULT_RESPONSE_TARGET_MINUTES: Record<ResponseTargetCategory, number> = {
  inquiry: 30,
  request: 30,
  staying: 60,
  other: 120,
};

export const DEFAULT_GUEST_MESSAGE_SETTINGS: GuestMessageSettings = {
  responseTargetMinutes: DEFAULT_RESPONSE_TARGET_MINUTES,
  nightPause: false,
  creditReserve: 20,
  stallHours: 3,
};

/** DB 줄(`guest_message_channel_state`) → 설정. 이상한 값은 기본값으로. */
export function readGuestMessageSettings(row: {
  settings?: unknown;
  night_pause?: boolean | null;
  credit_reserve?: number | null;
  stall_hours?: number | null;
} | null | undefined): GuestMessageSettings {
  const targets = { ...DEFAULT_RESPONSE_TARGET_MINUTES };
  const raw = row?.settings;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const minutes = (raw as Record<string, unknown>).responseTargetMinutes;
    if (minutes && typeof minutes === "object" && !Array.isArray(minutes)) {
      for (const key of Object.keys(targets) as ResponseTargetCategory[]) {
        const value = (minutes as Record<string, unknown>)[key];
        if (typeof value === "number" && Number.isFinite(value) && value > 0) targets[key] = Math.round(value);
      }
    }
  }
  return {
    responseTargetMinutes: targets,
    nightPause: row?.night_pause ?? DEFAULT_GUEST_MESSAGE_SETTINGS.nightPause,
    creditReserve: row?.credit_reserve ?? DEFAULT_GUEST_MESSAGE_SETTINGS.creditReserve,
    stallHours: row?.stall_hours ?? DEFAULT_GUEST_MESSAGE_SETTINGS.stallHours,
  };
}
