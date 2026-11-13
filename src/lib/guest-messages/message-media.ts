/**
 * 손님 메시지 사진 사본 — 판단만(순수). docs/product/47-guest-messaging.md §5-8.
 *
 * 사본 정보는 `guest_messages.attachments`(jsonb 배열)에 `kind: "image_copy"` 줄로 둔다. 같은 배열의 예전 줄
 * (통로가 준 첨부 정보 `{ name, mimeType, url, inline }` — `kind` 없음)과 섞여도 `kind` 로 가른다.
 * **둘을 섞어 세지 않는다**: 「첨부 n개」는 통로 첨부만(`providerAttachmentCount`), 사진 수는 본문 사진 조각(`images`)으로.
 * (2026-11-13 운영: 통로 첨부는 모든 줄에서 비어 있다 — 그래도 두 모양이 섞일 수 있게 갈라 둔다.)
 * 받아 오기 · 올리기는 `media-copy-server.ts`.
 */

import {
  AIRBNB_IMAGE_HOST,
  AIRBNB_IM_WIDTHS,
  airbnbImageVariant,
  canonicalAirbnbImageUrl,
  messageImages,
} from "@/lib/guest-messages/message-body";

export const GUEST_MEDIA_BUCKET = "guest-message-media";

export const MEDIA_COPY_LIMITS = {
  /** 받아 올 폭(Airbnb `im_w` — 정해진 값만 열린다, `AIRBNB_IM_WIDTHS`). */
  fetchWidth: 1200,
  /** 말풍선 작은 사진 폭 — 사본도 이 폭으로 하나 더 둔다(`thumbPath`). */
  thumbWidth: 480,
  maxBytes: 10 * 1024 * 1024,
  timeoutMs: 15_000,
  /** 이만큼 실패하면 failed 로 멈춘다(화면은 `?im_w=` 주소로 계속 보인다). */
  maxAttempts: 5,
  /** 화면용 서명 URL 수명(초). */
  signedUrlTtlSec: 30 * 60,
} as const;

/** 실패 뒤 다음 시도까지(분) — 1번째 실패 뒤 10분, 1시간, 6시간, 24시간. */
const RETRY_MINUTES = [10, 60, 360, 1440] as const;

export type StoredMediaAttachment = {
  kind: "image_copy";
  source: "airbnb";
  /** 정본 주소(쿼리 없음) — 본문의 사진 조각과 맞추는 열쇠. */
  sourceUrl: string;
  /** 버킷 안 경로 `<org>/<conversation>/<message>/<index>.<ext>`(1200 폭). */
  path: string;
  /** 작은 사진(480 폭) `<…>/<index>-t.<ext>` — 못 받았으면 없음(화면은 큰 사진을 쓴다). */
  thumbPath?: string | null;
  index: number;
  mime: string;
  bytes: number;
  /** 받아 온 `im_w`. */
  width: number;
  copiedAt: string;
};

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isStoredMedia(value: unknown): value is StoredMediaAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.kind === "image_copy" &&
    typeof rec.sourceUrl === "string" &&
    typeof rec.path === "string" &&
    typeof rec.index === "number"
  );
}

/** 통로가 준 첨부 수(사본 줄은 빼고) — 대화 줄 「사진 n장」 · 업무 미리 보기. */
export function providerAttachmentCount(attachments: unknown): number {
  if (!Array.isArray(attachments)) return 0;
  return attachments.filter((item) => !isStoredMedia(item)).length;
}

export function storedMediaOf(attachments: unknown): StoredMediaAttachment[] {
  return Array.isArray(attachments) ? attachments.filter(isStoredMedia) : [];
}

/**
 * 받아 와도 되는 주소인가(SSRF 막기) — https · 호스트가 정확히 a0.muscache.com · 포트 · 계정 없음 · 사진 경로.
 * 쿼리는 `im_w` 하나만 허용(서명 주소를 다시 쓰지 않는다).
 */
export function isAllowedMediaFetchUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== AIRBNB_IMAGE_HOST || url.port || url.username || url.password) return false;
  if (url.hash) return false;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "im_w") || keys.length > 1) return false;
  const width = url.searchParams.get("im_w");
  if (width !== null && !(AIRBNB_IM_WIDTHS as readonly number[]).includes(Number(width))) return false;
  return canonicalAirbnbImageUrl(`https://${url.hostname}${url.pathname}`) === `https://${AIRBNB_IMAGE_HOST}${url.pathname}`;
}

export function mediaFetchUrl(canonical: string): string {
  return airbnbImageVariant(canonical, MEDIA_COPY_LIMITS.fetchWidth);
}

export function extensionForMime(mime: string | null): string | null {
  if (!mime) return null;
  return MIME_EXT[mime.split(";")[0].trim().toLowerCase()] ?? null;
}

export function normalizeImageMime(contentType: string | null): string | null {
  if (!contentType) return null;
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return mime in MIME_EXT ? mime : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mediaObjectPath(args: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  index: number;
  ext: string;
  /** 작은 사진이면 `<index>-t.<ext>`. */
  thumb?: boolean;
}): string {
  for (const id of [args.organizationId, args.conversationId, args.messageId]) {
    if (!UUID_RE.test(id)) throw new Error("media path: not a uuid");
  }
  if (!Number.isInteger(args.index) || args.index < 0 || args.index > 99) throw new Error("media path: bad index");
  if (!/^[a-z]{3,4}$/.test(args.ext)) throw new Error("media path: bad ext");
  return `${args.organizationId}/${args.conversationId}/${args.messageId}/${args.index}${args.thumb ? "-t" : ""}.${args.ext}`;
}

/** 서명해 줘도 되는 경로인가 — 이 조직 폴더 안만. */
export function isOrgMediaPath(path: string, organizationId: string): boolean {
  return path.startsWith(`${organizationId}/`) && !path.includes("..") && path.split("/").length === 4;
}

export type MediaCopyTarget = { sourceUrl: string; index: number };

/** 이 메시지에서 아직 사본이 없는 사진 — 본문 사진 조각 중 같은 정본 주소의 사본 줄이 없는 것. */
export function planMediaCopy(body: string, attachments: unknown): MediaCopyTarget[] {
  const stored = new Set(storedMediaOf(attachments).map((item) => item.sourceUrl));
  const seen = new Set<string>();
  const out: MediaCopyTarget[] = [];
  for (const image of messageImages(body)) {
    if (stored.has(image.url) || seen.has(image.url)) continue;
    seen.add(image.url);
    out.push({ sourceUrl: image.url, index: image.index });
  }
  return out;
}

/**
 * 한 번 돌린 뒤 상태 — 남은 사진이 없으면 done, 있으면 실패 횟수를 올려 미루고, 한도면 failed.
 * 이번에 하나라도 새로 복사했으면 실패 횟수를 올리지 않는다(나아가고 있다) — 남은 것만 10분 뒤 다시.
 */
export function nextMediaState(args: {
  attempts: number;
  remaining: number;
  copiedThisRun: number;
  /** 이번에 실패한 사진 수. 0 인데 남았으면 시간 한도로 멈춘 것 — 횟수 그대로, 바로 다시. */
  failedThisRun: number;
  now: Date;
}): { state: "done" | "pending" | "failed"; attempts: number; nextTryAt: string | null } {
  if (args.remaining <= 0) return { state: "done", attempts: args.attempts, nextTryAt: null };
  if (args.failedThisRun <= 0) return { state: "pending", attempts: args.attempts, nextTryAt: null };
  if (args.copiedThisRun > 0) {
    return { state: "pending", attempts: args.attempts, nextTryAt: new Date(args.now.getTime() + RETRY_MINUTES[0] * 60_000).toISOString() };
  }
  const attempts = args.attempts + 1;
  if (attempts >= MEDIA_COPY_LIMITS.maxAttempts) return { state: "failed", attempts, nextTryAt: null };
  const minutes = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
  return { state: "pending", attempts, nextTryAt: new Date(args.now.getTime() + minutes * 60_000).toISOString() };
}

/** 받아 온 응답이 쓸 만한가 — 이유 코드(로그용, 주소 없음). */
export function checkFetchedMedia(args: {
  status: number;
  contentType: string | null;
  contentLength: number | null;
}): { ok: true; mime: string } | { ok: false; reason: string } {
  if (args.status !== 200) return { ok: false, reason: `http_${args.status}` };
  const mime = normalizeImageMime(args.contentType);
  if (!mime) return { ok: false, reason: "not_image" };
  if (args.contentLength != null && args.contentLength > MEDIA_COPY_LIMITS.maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, mime };
}

/** 화면에 줄 사진 주소 한 쌍 — 사본(서명 URL)이 있으면 그것, 없으면 Airbnb `?im_w=`. */
export type MessageImageView = { sourceUrl: string; thumb: string; full: string; fallback: string; stored: boolean };

/** 사본 서명 URL 한 쌍 — 작은 사진이 없으면 null(큰 사진을 쓴다). */
export type SignedMedia = { full: string; thumb: string | null };

export function imageViewsFor(body: string, signed: Record<string, SignedMedia> | null): MessageImageView[] {
  return messageImages(body).map((image) => {
    const copy = signed?.[image.url] ?? null;
    const fallback = airbnbImageVariant(image.url, MEDIA_COPY_LIMITS.fetchWidth);
    return {
      sourceUrl: image.url,
      thumb: copy ? (copy.thumb ?? copy.full) : airbnbImageVariant(image.url, MEDIA_COPY_LIMITS.thumbWidth),
      full: copy ? copy.full : fallback,
      fallback,
      stored: Boolean(copy),
    };
  });
}
