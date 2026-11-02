import { z } from "zod";

import { isCountryCode } from "./countries";

// 사전 등록 웹 한 사람 명부(시안 W3). 서버가 다시 검사한다 — 화면 검사는 편의일 뿐(16 §2).
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value));

export const guestInputSchema = z.object({
  id: z.uuid().optional(),
  lastName: text(60).min(1),
  firstName: text(60).min(1),
  nameKana: optionalText(60),
  guestType: z.enum(["adult", "child"]),
  hasJapanAddress: z.boolean(),
  nationality: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || isCountryCode(value), "nationality"),
  passportNumber: z
    .string()
    .optional()
    .transform((value) => (value ? value.toUpperCase().replace(/[\s-]/g, "") : null))
    .refine((value) => value === null || /^[A-Z0-9]{5,12}$/.test(value), "passport_number"),
  birthDate: isoDate.optional().transform((value) => value ?? null),
  gender: z
    .enum(["male", "female"])
    .optional()
    .transform((value) => value ?? null),
  noPassport: z.boolean().default(false),
  address: optionalText(200),
  prevStay: optionalText(120),
  nextDest: optionalText(120),
});

export type GuestInput = z.output<typeof guestInputSchema>;

export type StoredGuest = {
  is_representative: boolean;
  guest_type: "adult" | "child";
  name_roman: string | null;
  has_japan_address: boolean | null;
  nationality: string | null;
  passport_number: string | null;
  birth_date: string | null;
  gender: string | null;
  no_passport_reason: string | null;
  address: string | null;
  prev_stay: string | null;
  next_dest: string | null;
};

export type MissingField =
  | "name"
  | "address"
  | "nationality"
  | "passport_number"
  | "passport_photo"
  | "birth_date"
  | "gender"
  | "prev_stay"
  | "next_dest";

/**
 * 한 사람이 다 됐는지(시안 W2 「다 됐어요」). 규칙(44 FR-W02 · 43 §2):
 *  - 모두: 이름 · 주소(동행자는 대표자 값을 그대로 저장)
 *  - 일본에 주소가 없는 사람(외국인): 국적 · 여권 번호 · 여권 사진 · 생년월일 · 성별 · 전 숙박지 · 다음 행선지
 *  - 「여권 없음」 어린이는 여권 번호 · 사진을 빼 준다
 */
export function missingFields(guest: StoredGuest, hasPassportPhoto: boolean): MissingField[] {
  const missing: MissingField[] = [];
  if (!guest.name_roman) missing.push("name");
  if (!guest.address) missing.push("address");
  if (guest.has_japan_address) return missing;
  const passportExempt = guest.guest_type === "child" && !!guest.no_passport_reason;
  if (!guest.nationality) missing.push("nationality");
  if (!passportExempt && !guest.passport_number) missing.push("passport_number");
  if (!passportExempt && !hasPassportPhoto) missing.push("passport_photo");
  if (!guest.birth_date) missing.push("birth_date");
  if (!guest.gender) missing.push("gender");
  if (!guest.prev_stay) missing.push("prev_stay");
  if (!guest.next_dest) missing.push("next_dest");
  return missing;
}

/** 명부에 넣을 이름 — 「성 이름」 대문자 로마자(여권 표기와 같은 순서). */
export function nameRomanOf(lastName: string, firstName: string): string {
  return `${lastName.trim()} ${firstName.trim()}`.replace(/\s+/g, " ").toUpperCase();
}
