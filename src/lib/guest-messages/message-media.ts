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
  isSignedAirbnbImageUrl,
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

/** 서명 사진 주소에 붙어 있어도 되는 쿼리(AWS 서명 7개) — 나머지는 `im_w` 하나만. */
const SIGNED_QUERY_KEYS = new Set([
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-SignedHeaders",
  "X-Amz-Security-Token",
  "X-Amz-Signature",
]);

/**
 * 받아 와도 되는 주소인가(SSRF 막기) — https · 호스트가 정확히 a0.muscache.com · 포트 · 계정 · # 없음 · 사진 경로.
 * 쿼리: `/im/pictures/` 는 `im_w` 하나만. `/im/pictures-signed/` 는 AWS 서명 키(`SIGNED_QUERY_KEYS`) + `im_w`. 같은 키 두 번은 거절.
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
  const canonical = `https://${AIRBNB_IMAGE_HOST}${url.pathname}`;
  if (canonicalAirbnbImageUrl(canonical) !== canonical) return false;
  const signed = isSignedAirbnbImageUrl(canonical);
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return false;
  if (keys.some((key) => key !== "im_w" && !(signed && SIGNED_QUERY_KEYS.has(key)))) return false;
  const width = url.searchParams.get("im_w");
  if (width !== null && !(AIRBNB_IM_WIDTHS as readonly number[]).includes(Number(width))) return false;
  return true;
}

/**
 * 허용 목록에서 쿼리 키 때문에만 떨어지는 주소면 그 키 이름들(값 없이, 짧게 — 로그용), 아니면 빈 배열.
 * Airbnb 가 서명 주소에 키를 새로 붙이면 이유 코드 `not_allowed_query` + 키 이름으로 원인을 알 수 있게.
 */
export function disallowedMediaQueryKeys(raw: string): string[] {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  const bare = `https://${AIRBNB_IMAGE_HOST}${url.pathname}`;
  if (url.search === "" || isAllowedMediaFetchUrl(raw) || !isAllowedMediaFetchUrl(`${url.protocol}//${url.host}${url.pathname}`)) return [];
  const signed = isSignedAirbnbImageUrl(bare);
  const keys = [...url.searchParams.keys()];
  const bad = keys.filter((key, i) => keys.indexOf(key) !== i || (key !== "im_w" && !(signed && SIGNED_QUERY_KEYS.has(key))));
  return [...new Set(bad)].slice(0, 5).map((key) => key.replace(/[^\w-]/g, "?").slice(0, 40));
}

export function mediaFetchUrl(canonical: string): string {
  return airbnbImageVariant(canonical, MEDIA_COPY_LIMITS.fetchWidth);
}

/**
 * 받아 올 주소 — 서명 사진은 정본 + 본문 href 의 쿼리를 **글자 그대로** 두고 `im_w` 만 바꾸거나 붙인다(다시 인코딩하면 서명이 깨질 수 있다 —
 * `im_w` 는 서명 뒤에 붙는 CDN 값이라 바꿔도 된다). 서명 없는 사진은 정본 + `?im_w=`.
 */
export function mediaSourceVariant(target: { sourceUrl: string; signedHref?: string | null }, width: number): string {
  if (!target.signedHref) return airbnbImageVariant(target.sourceUrl, width);
  const w = new URL(airbnbImageVariant(target.sourceUrl, width)).searchParams.get("im_w") ?? String(width);
  const hashAt = target.signedHref.indexOf("#");
  const href = hashAt >= 0 ? target.signedHref.slice(0, hashAt) : target.signedHref;
  const queryAt = href.indexOf("?");
  const parts = queryAt >= 0 ? href.slice(queryAt + 1).split("&").filter((part) => part && part.split("=")[0] !== "im_w") : [];
  return `${target.sourceUrl}?${[...parts, `im_w=${w}`].join("&")}`;
}

/** 서명이 이미 죽었나(서명 사진만 — 죽는 때를 모르면 아직 산 것으로 본다). */
export function isSignedMediaExpired(target: { signedHref?: string | null; expiresAt?: string | null }, now: Date): boolean {
  if (!target.signedHref || !target.expiresAt) return false;
  const at = Date.parse(target.expiresAt);
  return Number.isFinite(at) && now.getTime() > at;
}

/**
 * 서명 사진을 어떤 주소로 받아 볼까(순서대로) — 서명이 살아 있으면 서명 href → 서명 없는 정본 `?im_w=`, 죽었으면 서명 없는 것만.
 * 서명이 죽은 사진도 일부는 서명 없이 열린다(2026-11-13 운영: 유효 시간 안에 한 번 열려 이미지 서버에 남은 것, 11/9~11/13 33건).
 * 서명 없는 사진은 늘 정본 `?im_w=` 하나.
 */
export function mediaFetchPlan(
  target: { signedHref?: string | null; expiresAt?: string | null },
  now: Date,
): Array<"signed" | "unsigned"> {
  if (!target.signedHref || isSignedMediaExpired(target, now)) return ["unsigned"];
  return ["signed", "unsigned"];
}

/**
 * 마지막 시도(서명 없는 정본)의 실패가 다시 해도 소용없는 것인가(서명 사진만 — 서명 없는 사진은 늘 다시 해 본다, 예전 그대로).
 * - `not_allowed`(호스트 · 경로 — 본문은 안 바뀐다) = 영구.
 * - `http_403`(S3 AccessDenied) = 서명이 죽은 뒤이거나 죽는 때를 모르면 영구, 아직 살아 있으면 일시
 *   (다음 시도가 만료 뒤면 그때 서명 없는 403 으로 영구).
 * - 404 · 네트워크 · 타임아웃 · `not_allowed_query`(모르는 쿼리 키 — 키 이름 로그) = 일시.
 */
export function isPermanentMediaFailure(
  target: { signedHref?: string | null; expiresAt?: string | null },
  reason: string,
  now: Date,
): boolean {
  if (!target.signedHref) return false;
  if (reason === "not_allowed") return true;
  if (reason === "http_403") return !target.expiresAt || isSignedMediaExpired(target, now);
  return false;
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

export type MediaCopyTarget = {
  sourceUrl: string;
  index: number;
  /** 서명 사진만 — 본문 href 그대로(`mediaSourceVariant` 로 `im_w` 만 바꿔 받는다). */
  signedHref?: string;
  expiresAt?: string | null;
};

/** 이 메시지에서 아직 사본이 없는 사진 — 본문 사진 조각 중 같은 정본 주소의 사본 줄이 없는 것. */
export function planMediaCopy(body: string, attachments: unknown): MediaCopyTarget[] {
  const stored = new Set(storedMediaOf(attachments).map((item) => item.sourceUrl));
  const seen = new Set<string>();
  const out: MediaCopyTarget[] = [];
  for (const image of messageImages(body)) {
    if (stored.has(image.url) || seen.has(image.url)) continue;
    seen.add(image.url);
    out.push(
      image.signedHref
        ? { sourceUrl: image.url, index: image.index, signedHref: image.signedHref, expiresAt: image.expiresAt ?? null }
        : { sourceUrl: image.url, index: image.index },
    );
  }
  return out;
}

/**
 * 한 번 돌린 뒤 상태 — 남은 사진이 없으면 done, 있으면 실패 횟수를 올려 미루고, 한도면 failed.
 * 이번에 하나라도 새로 복사했으면 실패 횟수를 올리지 않는다(나아가고 있다) — 남은 것만 10분 뒤 다시.
 * 남은 것이 모두 다시 해도 안 되는 것(서명 죽음 · 서명 403 — `permanentThisRun`)이면 바로 failed(시도 횟수 한도로, 다시 안 함).
 */
export function nextMediaState(args: {
  attempts: number;
  remaining: number;
  copiedThisRun: number;
  /** 이번에 실패한 사진 수(다시 해 볼 것만). 0 인데 남았으면 시간 한도로 멈춘 것 — 횟수 그대로, 바로 다시. */
  failedThisRun: number;
  /** 이번에 다시 해도 안 되는 것으로 판정한 사진 수(남은 수에 들어 있다). */
  permanentThisRun?: number;
  now: Date;
}): { state: "done" | "pending" | "failed"; attempts: number; nextTryAt: string | null } {
  if (args.remaining <= 0) return { state: "done", attempts: args.attempts, nextTryAt: null };
  if (args.remaining - (args.permanentThisRun ?? 0) <= 0) {
    return { state: "failed", attempts: Math.max(args.attempts, MEDIA_COPY_LIMITS.maxAttempts), nextTryAt: null };
  }
  // 실패가 하나도 없는데 남았으면 시간 한도로 멈춘 것 — 바로 다시. 영구 실패도 실패로 센다(횟수 없이 무한 반복되지 않게).
  if (args.failedThisRun + (args.permanentThisRun ?? 0) <= 0) return { state: "pending", attempts: args.attempts, nextTryAt: null };
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

/**
 * 화면에 줄 사진 주소 — 사본(서명 URL)이 있으면 그것, 없으면 Airbnb 주소(서명 사진은 서명 href, 아니면 `?im_w=`).
 * 서명 사진인데 사본이 없고 서명도 죽었으면 `unavailable` — 화면은 깨진 사진 대신 「Airbnb 에서 보기」 안내.
 * `fallback` 은 사본이 안 열릴 때 쓸 Airbnb 주소(죽은 서명이면 null).
 */
export type MessageImageView = {
  sourceUrl: string;
  thumb: string;
  full: string;
  fallback: string | null;
  stored: boolean;
  unavailable: boolean;
};

/** 사본 서명 URL 한 쌍 — 작은 사진이 없으면 null(큰 사진을 쓴다). */
export type SignedMedia = { full: string; thumb: string | null };

export function imageViewsFor(body: string, signed: Record<string, SignedMedia> | null, now: Date = new Date()): MessageImageView[] {
  return messageImages(body).map((image) => {
    const copy = signed?.[image.url] ?? null;
    const target = { sourceUrl: image.url, signedHref: image.signedHref ?? null, expiresAt: image.expiresAt ?? null };
    const expired = isSignedMediaExpired(target, now);
    const fallback = expired ? null : mediaSourceVariant(target, MEDIA_COPY_LIMITS.fetchWidth);
    const outsideThumb = expired ? "" : mediaSourceVariant(target, MEDIA_COPY_LIMITS.thumbWidth);
    return {
      sourceUrl: image.url,
      thumb: copy ? (copy.thumb ?? copy.full) : outsideThumb,
      full: copy ? copy.full : (fallback ?? ""),
      fallback,
      stored: Boolean(copy),
      unavailable: !copy && expired,
    };
  });
}
