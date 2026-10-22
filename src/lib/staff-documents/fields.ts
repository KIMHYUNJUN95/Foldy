/**
 * 직원 신분 서류(재류카드 · 마이넘버 카드 앞면) — 칸 정의 · 정리 · 검사. 클라이언트 · 서버가 같이 쓴다.
 * docs/product/41-residence-card-workflow.md §2 · §3-1a (2026-10-23 R2).
 *
 * - 국적이 일본이면 마이넘버 카드 앞면만(개인번호는 받지 않는다), 그 밖은 재류카드 앞 · 뒤.
 * - 재류자격 이름은 법령 용어라 화면 언어와 무관하게 일본어 그대로 저장 · 표시한다(카드에 적힌 글자와 같게).
 */

export type IdDocumentKind = "residence_card" | "my_number_card";
export type IdDocumentStatus = "pending" | "confirmed" | "returned";

export type WorkRestriction = "none" | "status_based" | "designated_org" | "designated" | "not_allowed";
export type ExtraActivity = "none" | "weekly_28h" | "per_certificate";

export const WORK_RESTRICTIONS: readonly WorkRestriction[] = [
  "none",
  "status_based",
  "designated_org",
  "designated",
  "not_allowed",
];
export const EXTRA_ACTIVITIES: readonly ExtraActivity[] = ["none", "weekly_28h", "per_certificate"];

/** 카드에 적히는 그대로의 일본어. 자주 고르는 순. 목록에 없으면 「그 밖」으로 직접 적는다. */
export const RESIDENCE_STATUSES = [
  "永住者",
  "定住者",
  "日本人の配偶者等",
  "永住者の配偶者等",
  "特定活動",
  "留学",
  "技術・人文知識・国際業務",
  "家族滞在",
  "特定技能1号",
  "特定技能2号",
  "技能実習",
  "高度専門職",
  "経営・管理",
  "技能",
  "介護",
] as const;

/** 서버 · 화면이 주고받는 칸 값. 날짜는 YYYY-MM-DD, 비면 "". */
export type IdDocumentFields = {
  nameRoman: string;
  birthDate: string;
  gender: "" | "male" | "female";
  nationalityText: string;
  address: string;
  expiresOn: string;
  cardNumber: string;
  residenceStatus: string;
  workRestriction: "" | WorkRestriction;
  extraActivity: "" | ExtraActivity;
};

export type IdDocumentField = keyof IdDocumentFields;

export const EMPTY_ID_FIELDS: IdDocumentFields = {
  nameRoman: "",
  birthDate: "",
  gender: "",
  nationalityText: "",
  address: "",
  expiresOn: "",
  cardNumber: "",
  residenceStatus: "",
  workRestriction: "",
  extraActivity: "",
};

/** 화면에 보이는 칸 순서. 마이넘버 카드는 재류 관련 칸이 없다. */
export function fieldsForKind(kind: IdDocumentKind): IdDocumentField[] {
  return kind === "residence_card"
    ? ["cardNumber", "residenceStatus", "expiresOn", "workRestriction", "extraActivity", "nameRoman", "birthDate", "nationalityText", "address"]
    : ["nameRoman", "birthDate", "gender", "address", "expiresOn"];
}

export function documentKindFor(nationality: string): IdDocumentKind {
  return nationality === "JP" ? "my_number_card" : "residence_card";
}

const CARD_NUMBER = /^[A-Z]{2}[0-9]{8}[A-Z]{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function collapse(value: string) {
  return value.replace(/[\s　]+/g, " ").trim();
}

function isRealDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function normalizeIdFields(input: Partial<IdDocumentFields>): IdDocumentFields {
  const v = { ...EMPTY_ID_FIELDS, ...input };
  const date = (s: string) => {
    const t = s.normalize("NFKC").trim();
    return isRealDate(t) ? t : "";
  };
  return {
    nameRoman: collapse(v.nameRoman.normalize("NFKC").toUpperCase()).slice(0, 80),
    birthDate: date(v.birthDate),
    gender: v.gender === "male" || v.gender === "female" ? v.gender : "",
    nationalityText: collapse(v.nationalityText).slice(0, 60),
    address: collapse(v.address.normalize("NFKC")).slice(0, 200),
    expiresOn: date(v.expiresOn),
    cardNumber: v.cardNumber.normalize("NFKC").replace(/[\s-]/g, "").toUpperCase().slice(0, 12),
    residenceStatus: collapse(v.residenceStatus.normalize("NFKC")).slice(0, 60),
    workRestriction: (WORK_RESTRICTIONS as readonly string[]).includes(v.workRestriction) ? v.workRestriction : "",
    extraActivity: (EXTRA_ACTIVITIES as readonly string[]).includes(v.extraActivity) ? v.extraActivity : "",
  };
}

export type IdFieldErrorKey = "required" | "card_number_invalid";

/** 저장 전 검사(정리한 값). 빈 객체면 통과. 만료가 지난 것은 막지 않고 화면이 경고만 한다. */
export function validateIdFields(
  kind: IdDocumentKind,
  fields: IdDocumentFields,
): Partial<Record<IdDocumentField, IdFieldErrorKey>> {
  const errors: Partial<Record<IdDocumentField, IdFieldErrorKey>> = {};
  if (!fields.nameRoman && kind === "residence_card") errors.nameRoman = "required";
  if (!fields.birthDate) errors.birthDate = "required";
  if (!fields.expiresOn && kind === "residence_card") errors.expiresOn = "required";
  if (kind === "residence_card") {
    if (!fields.cardNumber) errors.cardNumber = "required";
    else if (!CARD_NUMBER.test(fields.cardNumber)) errors.cardNumber = "card_number_invalid";
    if (!fields.residenceStatus) errors.residenceStatus = "required";
    if (!fields.workRestriction) errors.workRestriction = "required";
    if (!fields.extraActivity) errors.extraActivity = "required";
  }
  return errors;
}

/** 만료까지 남은 날(도쿄 날짜 기준). 날짜가 없으면 null. */
export function daysUntil(dateKey: string, todayKey: string): number | null {
  if (!isRealDate(dateKey) || !isRealDate(todayKey)) return null;
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000);
}

export type ExpiryTone = "expired" | "within30" | "within90" | "ok";

export function expiryTone(days: number | null): ExpiryTone | null {
  if (days === null) return null;
  if (days < 0) return "expired";
  if (days <= 30) return "within30";
  if (days <= 90) return "within90";
  return "ok";
}

/** 칸 이름 → DB 컬럼. 서버만 쓰지만 목록이 칸 정의와 붙어 있어야 어긋나지 않는다. */
export const FIELD_COLUMNS: Record<IdDocumentField, string> = {
  nameRoman: "name_roman",
  birthDate: "birth_date",
  gender: "gender",
  nationalityText: "nationality_text",
  address: "address",
  expiresOn: "expires_on",
  cardNumber: "card_number",
  residenceStatus: "residence_status",
  workRestriction: "work_restriction",
  extraActivity: "extra_activity",
};

/** 본인이 고친 칸 — 읽은 값과 저장 값이 다른 칸. */
export function editedFieldsOf(read: IdDocumentFields | null, saved: IdDocumentFields, kind: IdDocumentKind): IdDocumentField[] {
  if (!read) return [];
  return fieldsForKind(kind).filter((key) => read[key] !== "" && read[key] !== saved[key]);
}
