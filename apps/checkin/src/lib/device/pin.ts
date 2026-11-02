import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

// 직원 해제 PIN(FR-K18) — `property_settings.staff_pin_hash` = "pbkdf2-sha256$<반복>$<salt base64>$<hash base64>".
// 태블릿은 계약으로 받은 같은 값으로 오프라인에서도 대조한다(16 §5 kiosk/). 설정 화면(4단계)이 hashPin 으로 만든다.
const ITERATIONS = 120_000;
const KEY_BYTES = 32;

export type StaffPin = { algorithm: "pbkdf2-sha256"; iterations: number; salt: string; hash: string };

export function isPinShaped(pin: string): boolean {
  return /^[0-9]{4,8}$/.test(pin);
}

export function hashPin(pin: string, salt = randomBytes(16)): string {
  const hash = pbkdf2Sync(pin, salt, ITERATIONS, KEY_BYTES, "sha256");
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function parseStaffPin(stored: string | null | undefined): StaffPin | null {
  const parts = stored?.split("$");
  if (!parts || parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0 || !parts[2] || !parts[3]) return null;
  return { algorithm: "pbkdf2-sha256", iterations, salt: parts[2], hash: parts[3] };
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  const parsed = parseStaffPin(stored);
  if (!parsed || !isPinShaped(pin)) return false;
  const expected = Buffer.from(parsed.hash, "base64");
  const given = pbkdf2Sync(pin, Buffer.from(parsed.salt, "base64"), parsed.iterations, expected.length, "sha256");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
