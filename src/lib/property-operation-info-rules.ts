/**
 * 건물 운영 정보(주소 · 출입 코드 · 운영 메모) 합치기 · 검사 규칙 — **순수 모듈** (2026-11-12 예약 캘린더 점검).
 *
 * DB 를 읽고 쓰는 쪽은 `property-operation-info.ts`. 여기는 테스트할 수 있게 규칙만 둔다.
 *
 * - **지운 코드는 비어 있는 채로 남는다.** 예전엔 저장한 목록이 비면(코드를 다 지우면) 코드 안 기본값(`PROPERTY_MAP_META`)이
 *   되살아났다. 이제 저장된 줄이 있으면 그 목록(빈 목록 · 빈 코드 포함)이 그대로 정답이고, 기본값은 **저장된 줄이 아예 없을 때만** 쓴다.
 * - **기본값으로 물러서는 건 표가 없을 때뿐**(42P01 · PGRST205). 다른 오류(권한 · 네트워크 · 시간 초과)에 기본값을 보이면
 *   이미 바뀐 출입 코드를 옛 값으로 보여 준다 — 그때는 오류로 다룬다.
 */
import type { PropertyAccessInfo, PropertyMapMeta, PropertyRoomCode } from "@/lib/property-map-links";

export type PropertyOperationInfoOverride = {
  canonical_name: string;
  address_ko: string | null;
  address_ja: string | null;
  address_en: string | null;
  shared_access: unknown;
  room_access: unknown;
  note: string | null;
  updated_at?: string | null;
};

export const PROPERTY_INFO_LIMITS = {
  address: 300,
  code: 100,
  entries: 60,
  note: 2000,
} as const;

const ACCESS_LABEL_KEYS = new Set<PropertyAccessInfo["labelKey"]>([
  "doorPassword",
  "keyBox",
  "keyBoxPassword",
  "linenStorageEntrancePassword",
  "roomPassword",
  "storage",
  "storagePassword",
]);
const ACCESS_PREFIX_KEYS = new Set<NonNullable<PropertyAccessInfo["prefixKey"]>>(["floor1"]);
const ACCESS_NOTE_KEYS = new Set<NonNullable<PropertyAccessInfo["noteKey"]>>(["allRoomsSame"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 읽기 오류를 나눈다 — 표가 없을 때(마이그레이션 전)만 코드 기본값으로 물러선다. */
export function classifyPropertyInfoReadError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): "missing_table" | "failed" {
  const code = error?.code ?? "";
  return code === "42P01" || code === "PGRST205" ? "missing_table" : "failed";
}

/** 공용 출입 정보 — 줄 모양만 거른다. 빈 코드도 남긴다(지운 값이 기본값으로 되살아나지 않게). 목록이 아니면 `null`. */
export function sanitizeSharedAccess(value: unknown): PropertyAccessInfo[] | null {
  if (!Array.isArray(value)) return null;
  const result: PropertyAccessInfo[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const labelKey = record.labelKey as PropertyAccessInfo["labelKey"];
    if (!ACCESS_LABEL_KEYS.has(labelKey)) continue;
    const prefixKey = record.prefixKey as NonNullable<PropertyAccessInfo["prefixKey"]>;
    const noteKey = record.noteKey as NonNullable<PropertyAccessInfo["noteKey"]>;
    result.push({
      labelKey,
      code: text(record.code).slice(0, PROPERTY_INFO_LIMITS.code),
      prefixKey: ACCESS_PREFIX_KEYS.has(prefixKey) ? prefixKey : undefined,
      noteKey: ACCESS_NOTE_KEYS.has(noteKey) ? noteKey : undefined,
    });
  }
  return result;
}

/** 객실 출입 코드 — 방 이름이 있는 줄만, 빈 코드도 남긴다. 목록이 아니면 `null`. */
export function sanitizeRoomAccess(value: unknown): PropertyRoomCode[] | null {
  if (!Array.isArray(value)) return null;
  const result: PropertyRoomCode[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const roomLabel = text(record.roomLabel);
    if (!roomLabel) continue;
    result.push({ roomLabel, code: text(record.code).slice(0, PROPERTY_INFO_LIMITS.code) });
  }
  return result;
}

export function cloneBasePropertyMapMeta(item: PropertyMapMeta): PropertyMapMeta {
  return {
    ...item,
    note: item.note ?? "",
    roomAccess: (item.roomAccess ?? []).map((room) => ({ ...room })),
    sharedAccess: item.sharedAccess.map((access) => ({ ...access })),
    updatedAt: null,
  };
}

/** 코드 기본값 + 저장된 줄. 저장된 줄이 있으면 출입 코드 · 메모는 저장된 값 그대로(빈 값 포함). 주소만 비면 기본 주소. */
export function mergePropertyMapMeta(base: PropertyMapMeta, override?: PropertyOperationInfoOverride): PropertyMapMeta {
  if (!override) return cloneBasePropertyMapMeta(base);
  return {
    ...base,
    address: {
      ko: text(override.address_ko) || base.address.ko,
      ja: text(override.address_ja) || base.address.ja,
      en: text(override.address_en) || base.address.en,
    },
    note: text(override.note),
    roomAccess: sanitizeRoomAccess(override.room_access) ?? (base.roomAccess ?? []).map((room) => ({ ...room })),
    sharedAccess: sanitizeSharedAccess(override.shared_access) ?? base.sharedAccess.map((access) => ({ ...access })),
    updatedAt: override.updated_at ?? null,
  };
}

export type PropertyInfoInput = Pick<PropertyMapMeta, "address" | "note" | "roomAccess" | "sharedAccess">;

/** 저장할 값 검사 · 다듬기 — 길이 · 줄 수 제한. 통과하면 DB 에 그대로 넣을 값. */
export function validatePropertyInfoInput(
  base: PropertyMapMeta,
  data: PropertyInfoInput,
):
  | {
      ok: true;
      value: {
        address_en: string;
        address_ja: string;
        address_ko: string;
        note: string;
        room_access: PropertyRoomCode[];
        shared_access: PropertyAccessInfo[];
      };
    }
  | { ok: false; error: "invalid_input" | "too_long" } {
  if (!data || typeof data !== "object" || !data.address || typeof data.address !== "object") {
    return { ok: false, error: "invalid_input" };
  }
  const addresses = [data.address.ko, data.address.ja, data.address.en].map(text);
  const note = text(data.note);
  const rawShared = Array.isArray(data.sharedAccess) ? data.sharedAccess : [];
  const rawRooms = Array.isArray(data.roomAccess) ? data.roomAccess : [];
  if (rawShared.length > PROPERTY_INFO_LIMITS.entries || rawRooms.length > PROPERTY_INFO_LIMITS.entries) {
    return { ok: false, error: "too_long" };
  }
  if (addresses.some((value) => value.length > PROPERTY_INFO_LIMITS.address) || note.length > PROPERTY_INFO_LIMITS.note) {
    return { ok: false, error: "too_long" };
  }
  const codes = [...rawShared, ...rawRooms].map((entry) => text((entry as { code?: unknown })?.code));
  if (codes.some((code) => code.length > PROPERTY_INFO_LIMITS.code)) return { ok: false, error: "too_long" };
  return {
    ok: true,
    value: {
      address_ko: addresses[0] || base.address.ko,
      address_ja: addresses[1] || base.address.ja,
      address_en: addresses[2] || base.address.en,
      note,
      room_access: sanitizeRoomAccess(rawRooms) ?? [],
      shared_access: sanitizeSharedAccess(rawShared) ?? [],
    },
  };
}
