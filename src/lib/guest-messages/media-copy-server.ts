import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import {
  GUEST_MEDIA_BUCKET,
  MEDIA_COPY_LIMITS,
  checkFetchedMedia,
  extensionForMime,
  isAllowedMediaFetchUrl,
  isOrgMediaPath,
  mediaObjectPath,
  nextMediaState,
  planMediaCopy,
  storedMediaOf,
  type SignedMedia,
  type StoredMediaAttachment,
} from "@/lib/guest-messages/message-media";
import { airbnbImageVariant } from "@/lib/guest-messages/message-body";

/**
 * 손님 메시지 사진 사본 — 받아 와서 비공개 버킷에 올리고 `attachments` 에 적는다. docs/product/47 §5-8.
 *
 * - **잡기(claim)**: 후보(이 조직 · `pending` · 시도 시각이 됨)를 고른 뒤, 조건부 update 한 번으로 `media_claim_id = 내 번호` ·
 *   `media_next_try_at = 지금 + 5분` 을 건다(조건 = 아직 pending · 시도 시각이 됨). 돌려받은 줄만 처리하고, 마지막 저장도
 *   `media_claim_id = 내 번호` 일 때만 — 두 실행(웹훅 뒤 · 따라잡기 잡)이 겹쳐도 한 줄은 한 실행만 만지고 서로 사본 줄을 덮지 않는다.
 *   실행이 죽으면 5분 뒤 다른 실행이 다시 잡는다.
 * - 받아 오기: `https://a0.muscache.com/im/…?im_w=1200`(큰 사진) + `?im_w=480`(작은 사진) 만(SSRF 막기 `isAllowedMediaFetchUrl`),
 *   넘김(redirect) 거절, 15초 · 10MB · 이미지 4종. Beds24 를 부르지 않는다(크레딧 0). 작은 사진은 실패해도 사본은 된 것으로 본다.
 * - 실패는 로그(메시지 번호 · 이유 코드만 — 주소 · 서명 없음) + 뒤로 미룸, 5번이면 failed.
 * - **절대 던지지 않는다** — 웹훅 · 보정 조회 · 가져오기 뒤 `after()` 에서 부른다.
 */

type Client = SupabaseClient<Database>;

export type MediaCopySummary = {
  checked: number;
  copied: number;
  failed: number;
  done: number;
  /** 시간 · 개수 한도로 멈춰 남은 pending 이 더 있을 수 있다. */
  more: boolean;
};

type ClaimedRow = {
  id: string;
  conversation_id: string;
  body: string;
  attachments: unknown;
  media_attempts: number;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type MediaCopyOptions = {
  limit?: number;
  budgetMs?: number;
  /** 이 메시지들만(웹훅 — 방금 들어온 줄). 없으면 조직의 밀린 것 새 것부터. */
  messageIds?: readonly string[];
  now?: () => Date;
  fetchImpl?: FetchLike;
  claimId?: () => string;
};

/** 잡은 줄은 이만큼 다른 실행이 못 잡는다(실행이 죽어도 이 뒤엔 다시 잡힘). */
const CLAIM_MS = 5 * 60_000;

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** 사진 하나 받아 오기 — 이유 코드만 돌려준다(주소는 로그에 안 남김). */
export async function fetchMediaImage(
  canonical: string,
  fetchImpl: FetchLike = fetch,
  width: number = MEDIA_COPY_LIMITS.fetchWidth,
): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: string }> {
  const url = airbnbImageVariant(canonical, width);
  if (!isAllowedMediaFetchUrl(url)) return { ok: false, reason: "not_allowed" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_COPY_LIMITS.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "error",
      signal: controller.signal,
      // 저장 · 서명이 받는 4종만 청한다(avif 는 버킷이 받지 않음).
      headers: { accept: "image/webp,image/jpeg,image/png" },
      cache: "no-store",
    });
    const lengthHeader = response.headers.get("content-length");
    const checked = checkFetchedMedia({
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null,
    });
    if (!checked.ok) {
      await response.body?.cancel().catch(() => {});
      return checked;
    }
    const bytes = await readCapped(response, MEDIA_COPY_LIMITS.maxBytes);
    if (!bytes) return { ok: false, reason: "too_large" };
    if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
    return { ok: true, bytes, mime: checked.mime };
  } catch (error) {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : error instanceof TypeError ? "network" : "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}

async function uploadOne(supabase: Client, path: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const uploaded = await supabase.storage
    .from(GUEST_MEDIA_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: true, cacheControl: "31536000" });
  return uploaded.error ? uploaded.error.message.slice(0, 120) : null;
}

/** 잡은 한 줄 처리 — 저장 실패는 던진다(바깥에서 잡음). */
async function copyOne(
  supabase: Client,
  organizationId: string,
  row: ClaimedRow,
  claimId: string,
  fetchImpl: FetchLike,
  now: Date,
  deadline: number,
): Promise<{ copied: number; failed: number; finalState: "done" | "pending" | "failed" | "lost" }> {
  const targets = planMediaCopy(row.body, row.attachments);
  const added: StoredMediaAttachment[] = [];
  let failed = 0;
  for (const target of targets) {
    if (Date.now() > deadline) break;
    const fetched = await fetchMediaImage(target.sourceUrl, fetchImpl);
    if (!fetched.ok) {
      failed += 1;
      console.warn("[guest-messages/media] fetch failed", { messageId: row.id, index: target.index, reason: fetched.reason });
      continue;
    }
    const ext = extensionForMime(fetched.mime) ?? "jpg";
    const base = { organizationId, conversationId: row.conversation_id, messageId: row.id, index: target.index };
    const path = mediaObjectPath({ ...base, ext });
    const uploadError = await uploadOne(supabase, path, fetched.bytes, fetched.mime);
    if (uploadError) {
      failed += 1;
      console.warn("[guest-messages/media] upload failed", { messageId: row.id, index: target.index, reason: uploadError });
      continue;
    }
    // 작은 사진(말풍선용) — 실패해도 큰 사진으로 보이므로 사본은 된 것으로 본다.
    let thumbPath: string | null = null;
    const thumb = await fetchMediaImage(target.sourceUrl, fetchImpl, MEDIA_COPY_LIMITS.thumbWidth);
    if (thumb.ok) {
      const candidate = mediaObjectPath({ ...base, ext: extensionForMime(thumb.mime) ?? "jpg", thumb: true });
      const thumbError = await uploadOne(supabase, candidate, thumb.bytes, thumb.mime);
      if (!thumbError) thumbPath = candidate;
    }
    added.push({
      kind: "image_copy",
      source: "airbnb",
      sourceUrl: target.sourceUrl,
      path,
      thumbPath,
      index: target.index,
      mime: fetched.mime,
      bytes: fetched.bytes.byteLength,
      width: MEDIA_COPY_LIMITS.fetchWidth,
      copiedAt: now.toISOString(),
    });
  }
  const remaining = targets.length - added.length;
  const next = nextMediaState({ attempts: row.media_attempts, remaining, copiedThisRun: added.length, failedThisRun: failed, now });
  const attachments = [...(Array.isArray(row.attachments) ? row.attachments : []), ...added];
  const saved = await supabase
    .from("guest_messages")
    .update({
      attachments: attachments as unknown as Json,
      media_state: next.state,
      media_attempts: next.attempts,
      media_next_try_at: next.nextTryAt,
      media_claim_id: null,
    })
    .eq("organization_id", organizationId)
    .eq("id", row.id)
    .eq("media_claim_id", claimId)
    .select("id");
  if (saved.error) throw new Error(`media state save failed: ${saved.error.message}`);
  // 0줄 = 잡은 시간이 지나 다른 실행이 다시 잡았다 — 그쪽이 저장한다(올린 파일은 같은 경로라 그대로 쓰인다).
  if ((saved.data ?? []).length === 0) return { copied: 0, failed, finalState: "lost" };
  return { copied: added.length, failed, finalState: next.state };
}

/** 후보를 고르고 조건부 update 로 잡는다 — 돌려받은 줄만 내 것. */
async function claimRows(
  supabase: Client,
  organizationId: string,
  options: { limit: number; messageIds?: readonly string[]; now: Date; claimId: string },
): Promise<{ rows: ClaimedRow[]; more: boolean }> {
  const nowIso = options.now.toISOString();
  const due = `media_next_try_at.is.null,media_next_try_at.lte.${nowIso}`;
  let candidates = supabase
    .from("guest_messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("media_state", "pending")
    .or(due);
  if (options.messageIds) candidates = candidates.in("id", [...options.messageIds]);
  const picked = await candidates.order("sent_at", { ascending: false }).limit(options.limit + 1);
  if (picked.error) throw new Error(`pending read failed: ${picked.error.code ?? "unknown"}`);
  const ids = ((picked.data ?? []) as Array<{ id: string }>).map((row) => row.id);
  const more = ids.length > options.limit;
  if (ids.length === 0) return { rows: [], more: false };
  const claimed = await supabase
    .from("guest_messages")
    .update({
      media_claim_id: options.claimId,
      media_next_try_at: new Date(options.now.getTime() + CLAIM_MS).toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("media_state", "pending")
    .or(due)
    .in("id", ids.slice(0, options.limit))
    .select("id, conversation_id, body, attachments, media_attempts");
  if (claimed.error) throw new Error(`claim failed: ${claimed.error.code ?? "unknown"}`);
  return { rows: (claimed.data ?? []) as ClaimedRow[], more };
}

/**
 * 한 조직의 사진 사본을 한 번 돌린다(최대 `limit` 메시지 · `budgetMs`). `messageIds` 를 주면 그 줄들만.
 */
export async function copyPendingGuestMessageMedia(
  supabase: Client,
  organizationId: string,
  options: MediaCopyOptions = {},
): Promise<MediaCopySummary> {
  const summary: MediaCopySummary = { checked: 0, copied: 0, failed: 0, done: 0, more: false };
  if (options.messageIds && options.messageIds.length === 0) return summary;
  const limit = Math.max(1, Math.min(100, options.limit ?? 10));
  const deadline = Date.now() + Math.max(1_000, options.budgetMs ?? 25_000);
  const clock = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const claimId = (options.claimId ?? (() => crypto.randomUUID()))();
  try {
    const { rows, more } = await claimRows(supabase, organizationId, { limit, messageIds: options.messageIds, now: clock(), claimId });
    summary.more = more;
    for (const row of rows) {
      if (Date.now() > deadline) {
        // 시간이 다 됐다 — 잡은 줄은 놓아 다음 실행이 바로 잡게.
        summary.more = true;
        await supabase
          .from("guest_messages")
          .update({ media_claim_id: null, media_next_try_at: null })
          .eq("organization_id", organizationId)
          .eq("id", row.id)
          .eq("media_claim_id", claimId);
        continue;
      }
      summary.checked += 1;
      try {
        const result = await copyOne(supabase, organizationId, row, claimId, fetchImpl, clock(), deadline);
        summary.copied += result.copied;
        summary.failed += result.failed;
        if (result.finalState === "done") summary.done += 1;
      } catch (error) {
        summary.failed += 1;
        console.error("[guest-messages/media] message failed", {
          messageId: row.id,
          error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
        });
      }
    }
  } catch (error) {
    console.error("[guest-messages/media] run failed", error instanceof Error ? error.message.slice(0, 160) : "unknown");
  }
  return summary;
}

/** 여러 조직(보정 조회 · 가져오기 뒤) — 조직마다 작게. 던지지 않는다. */
export async function copyGuestMessageMediaForOrganizations(
  supabase: Client,
  organizationIds: readonly string[],
  options: MediaCopyOptions = {},
): Promise<void> {
  for (const organizationId of [...new Set(organizationIds)]) {
    await copyPendingGuestMessageMedia(supabase, organizationId, options);
  }
}

/**
 * 대화의 사본 → 짧은 서명 URL(한 번에, 큰 사진 + 작은 사진). 메시지 id → (정본 주소 → 서명 쌍). 실패하면 빈 맵(화면은 Airbnb 주소로).
 * 이 조직 폴더 경로만 서명한다.
 */
export async function signGuestMessageMedia(
  supabase: Client,
  organizationId: string,
  rows: ReadonlyArray<{ id: string; attachments: unknown }>,
): Promise<Map<string, Record<string, SignedMedia>>> {
  const out = new Map<string, Record<string, SignedMedia>>();
  const wanted: Array<{ messageId: string; sourceUrl: string; path: string; thumbPath: string | null }> = [];
  for (const row of rows) {
    for (const item of storedMediaOf(row.attachments)) {
      if (!isOrgMediaPath(item.path, organizationId)) continue;
      const thumbPath = item.thumbPath && isOrgMediaPath(item.thumbPath, organizationId) ? item.thumbPath : null;
      wanted.push({ messageId: row.id, sourceUrl: item.sourceUrl, path: item.path, thumbPath });
    }
  }
  if (wanted.length === 0) return out;
  try {
    const paths = wanted.flatMap((item) => (item.thumbPath ? [item.path, item.thumbPath] : [item.path]));
    const { data, error } = await supabase.storage.from(GUEST_MEDIA_BUCKET).createSignedUrls(paths, MEDIA_COPY_LIMITS.signedUrlTtlSec);
    if (error || !data) {
      console.warn("[guest-messages/media] sign failed", error?.message.slice(0, 120) ?? "no data");
      return out;
    }
    const byPath = new Map<string, string>();
    for (const entry of data) if (entry.path && entry.signedUrl && !entry.error) byPath.set(entry.path, entry.signedUrl);
    for (const item of wanted) {
      const full = byPath.get(item.path);
      if (!full) continue;
      const record = out.get(item.messageId) ?? {};
      record[item.sourceUrl] = { full, thumb: item.thumbPath ? (byPath.get(item.thumbPath) ?? null) : null };
      out.set(item.messageId, record);
    }
  } catch (error) {
    console.warn("[guest-messages/media] sign threw", error instanceof Error ? error.message.slice(0, 120) : "unknown");
  }
  return out;
}
