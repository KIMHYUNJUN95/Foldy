// 린넨 반품 판정 규칙 — 모바일 등록 · 모바일 수정 · PC 수정이 같은 함수를 쓴다(2026-11-10).
// 순수 모듈(서버 import 없음). 저장 자체는 DB 함수 `linen_submit_return` · `linen_update_return` 이 한 트랜잭션으로 한다
// (supabase/migrations/202611100002_linen_returns_hardening.sql). 참고: docs/product/19-linen-defect-workflow.md.

import { isOwnStoragePublicUrl, storagePathFromPublicUrl } from "@/lib/storage-url-guard";
import { ymdShift } from "@/lib/tokyo-date";

/** CLAUDE.md §8 — 기능당 5장. DB 함수도 같은 수로 막는다. */
export const LINEN_MAX_PHOTOS = 5;
export const LINEN_PHOTO_BUCKET = "request-images";
/** 관리자 조회 기간 상한(양끝 포함 일수). */
export const LINEN_MAX_RANGE_DAYS = 366;
/** DB `integer` 상한 — 넘으면 저장이 DB 오류로 깨진다. */
const MAX_QUANTITY = 2_147_483_647;

export function linenPhotoPrefix(organizationId: string, folderId: string): string {
  return `${organizationId}/linen-returns/${folderId}/`;
}

/**
 * 사진 주소 규칙. 새 주소는 업로더가 쓰는 `{조직}/linen-returns/{폴더 id}/` 바로 아래 파일만 —
 * 등록은 제출 id, 수정은 기록 id 가 폴더다. 수정 때 이미 저장돼 있던 주소(`kept`)는 폴더가 달라도 그대로 허용한다
 * (같은 날 합쳐진 기록은 제출마다 폴더가 다르다).
 */
export function areLinenPhotoUrlsAllowed(
  urls: readonly string[],
  options: {
    organizationId: string;
    /**
     * 사진 폴더 id. `"any"` = 같은 조직 `linen-returns/` 아래 어느 제출 폴더든(uuid 한 칸) — 등록 폼이 실패 · 수정 뒤 새 제출 id 를
     * 만들어도 임시 저장에서 되살린 예전 id 폴더 사진을 그대로 보내기 때문이다. 다른 조직 · 다른 기능 폴더 · 외부 주소는 여전히 거절.
     */
    folderId: string | "any";
    kept?: readonly string[];
  },
): boolean {
  const kept = new Set(options.kept ?? []);
  if (options.folderId === "any") {
    const base = `${options.organizationId}/linen-returns/`;
    return urls.every((url) => {
      if (kept.has(url)) return true;
      if (!isOwnStoragePublicUrl(url, LINEN_PHOTO_BUCKET, base, { subfolders: 1 })) return false;
      const folder = (storagePathFromPublicUrl(url, LINEN_PHOTO_BUCKET) ?? "").split("/")[2] ?? "";
      return UUID.test(folder);
    });
  }
  const prefix = linenPhotoPrefix(options.organizationId, options.folderId);
  return urls.every((url) => kept.has(url) || isOwnStoragePublicUrl(url, LINEN_PHOTO_BUCKET, prefix));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 고를 수 있는 품목 id = 그 건물의 활성 품목 + (건물이 그대로면) 이미 그 기록에 있던 줄의 품목.
 * 품목을 비활성으로 돌린 뒤에도 예전 기록을 고쳐 저장할 수 있어야 한다.
 */
export function linenAllowedItemIds(input: {
  activeIds: Iterable<string>;
  building: string;
  existing?: { building: string; itemIds: Iterable<string> };
}): Set<string> {
  const ids = new Set(input.activeIds);
  if (input.existing && input.existing.building === input.building) {
    for (const id of input.existing.itemIds) ids.add(id);
  }
  return ids;
}

export type LinenLine = { itemId: string; quantity: number };
export type LinenLineError = "invalid_item" | "invalid_quantity" | "duplicate_item" | "missing_items";

/** 폼 · 콘솔이 보낸 줄 검사. 하나라도 틀리면 그 이유 하나. */
export function parseLinenLines(
  raw: readonly unknown[],
  allowed: ReadonlySet<string>,
): { ok: true; lines: LinenLine[] } | { ok: false; reason: LinenLineError } {
  const seen = new Set<string>();
  const lines: LinenLine[] = [];
  for (const entry of raw) {
    const value = (entry && typeof entry === "object" ? entry : {}) as { itemId?: unknown; quantity?: unknown };
    const itemId = String(value.itemId ?? "").trim();
    const quantity = Number(value.quantity);
    if (!itemId || !allowed.has(itemId)) return { ok: false, reason: "invalid_item" };
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      return { ok: false, reason: "invalid_quantity" };
    }
    if (seen.has(itemId)) return { ok: false, reason: "duplicate_item" };
    seen.add(itemId);
    lines.push({ itemId, quantity });
  }
  if (lines.length === 0) return { ok: false, reason: "missing_items" };
  return { ok: true, lines };
}

/** 관리자 조회 기간 — 거꾸로면 바로잡고, 366일을 넘으면 끝 날짜 기준 366일로 자른다. */
export function clampLinenRange(from: string, to: string, maxDays = LINEN_MAX_RANGE_DAYS): { from: string; to: string } {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const earliest = ymdShift(end, -(maxDays - 1));
  return { from: start < earliest ? earliest : start, to: end };
}

export type LinenRpcReason =
  | "too_many_photos"
  | "too_many_photos_merged"
  | "stale"
  | "not_found"
  | "forbidden"
  | "missing_items"
  | "invalid_quantity"
  | "duplicate_item"
  | "invalid_item";

const RPC_REASONS: readonly LinenRpcReason[] = [
  // 긴 이름표 먼저 — `too_many_photos` 가 `too_many_photos_merged` 를 먼저 잡지 않게.
  "too_many_photos_merged",
  "too_many_photos",
  "stale",
  "not_found",
  "forbidden",
  "missing_items",
  "invalid_quantity",
  "duplicate_item",
  "invalid_item",
];

/** DB 함수가 `raise exception 'linen:<이유>'` 로 던진 이름표를 화면 오류 코드로. 모르는 오류는 null(= save_failed). */
export function linenRpcErrorReason(message: string | null | undefined): LinenRpcReason | null {
  if (!message) return null;
  for (const reason of RPC_REASONS) {
    if (message.includes(`linen:${reason}`)) return reason;
  }
  return null;
}
