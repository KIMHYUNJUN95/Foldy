// 태블릿 명부 저장 판정(DB 없음 — 테스트로 덮는다). 44 FR-K06 · K07 · K08 · K16 · K21.
import { z } from "zod";

import { guestInputSchema, nameRomanOf, type MissingField } from "../guest/fields";

export const KIOSK_MAX_GUESTS = 20;

// "child" 는 웹과 같은 「동반 어린이 · 여권 없음」(어린이만). 나머지 셋은 태블릿만 — 「직원 확인 필요」로 저장하고 진행(FR-K16).
export const NO_PASSPORT_REASONS = ["child", "japan_resident", "not_shown", "camera_off"] as const;
export type NoPassportReason = (typeof NO_PASSPORT_REASONS)[number];

const kioskGuestSchema = guestInputSchema
  .omit({ noPassport: true, prevStay: true, nextDest: true })
  .extend({
    noPassportReason: z.enum(NO_PASSPORT_REASONS).optional(),
    mrz: z.object({ raw: z.string().trim().min(1).max(200), valid: z.boolean() }).optional(),
  })
  .refine((guest) => guest.noPassportReason !== "child" || guest.guestType === "child", {
    path: ["noPassportReason"],
    message: "noPassportReason",
  });

export const kioskGuestBodySchema = z.object({ sessionId: z.uuid(), guest: kioskGuestSchema });
export type KioskGuestInput = z.output<typeof kioskGuestSchema>;

/** 틀린 칸 이름 — 웹과 같게 사람 칸은 `guest.` 없이(`lastName` · `passportNumber` …). */
export function invalidFieldsOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String);
    return (path[0] === "guest" ? path.slice(1) : path).join(".");
  });
}

export const SHARED_FIELDS = ["address", "prev_stay", "next_dest"] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];
type Shared = Record<SharedField, string | null>;
type SharingGuest = Shared & { id: string; is_representative: boolean };

/** 저장할 칸(사람 하나). 주소를 안 보냈으면 칸을 비우지 않는다 — 새 사람이면 대표자 값을 이어받는다. */
export function kioskGuestRow(input: KioskGuestInput, representative: Shared | null, isNew: boolean, nowIso: string) {
  const noPassport = !!input.noPassportReason;
  const row: Record<string, unknown> = {
    guest_type: input.guestType,
    name_roman: nameRomanOf(input.lastName, input.firstName),
    name_kana: input.nameKana,
    has_japan_address: input.hasJapanAddress,
    nationality: input.nationality,
    passport_number: noPassport ? null : input.passportNumber,
    no_passport_reason: input.noPassportReason ?? null,
    birth_date: input.birthDate,
    gender: input.gender,
    source: input.mrz ? "mrz" : "guest",
    updated_at: nowIso,
  };
  if (input.mrz) {
    row.mrz_raw = input.mrz.raw;
    row.mrz_valid = input.mrz.valid;
  }
  if (input.address !== null) row.address = input.address;
  if (isNew && representative) {
    row.address ??= representative.address;
    row.prev_stay = representative.prev_stay;
    row.next_dest = representative.next_dest;
  }
  return row;
}

/** 대표자 값이 바뀔 때 같이 바꿀 동행자 — 비어 있었거나 대표자의 옛 값을 그대로 쓰던 사람만. */
export function companionsFollowing(guests: SharingGuest[], field: SharedField, before: string | null, after: string | null): string[] {
  if (before === after) return [];
  return guests
    .filter((guest) => !guest.is_representative && (guest[field] === null || guest[field] === before))
    .map((guest) => guest.id);
}

/**
 * 태블릿 저장 뒤 상태. 태블릿은 「미리 체크인 끝」(pre_registered)으로 올리지 않는다 — 체크인은 완료 단계에서.
 * 미리 끝났던 예약이 다시 덜 된 상태가 되면 pending 으로 내린다(웹 refreshPreRegStatus 와 같은 「다 됨」 기준).
 */
export function kioskStatusAfterSave(stay: {
  status: string;
  consented: boolean;
  partySize: number;
  guests: { missing: MissingField[] }[];
}): "pending" | null {
  if (stay.status !== "pre_registered") return null;
  const done =
    stay.consented &&
    stay.guests.length >= Math.max(1, stay.partySize) &&
    stay.guests.every((guest) => guest.missing.length === 0);
  return done ? null : "pending";
}

export const routeBodySchema = z.object({
  sessionId: z.uuid(),
  prevStay: z.string().trim().min(1).max(120),
  nextDest: z.string().trim().min(1).max(120),
});
