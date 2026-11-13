import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

// 직원 해제 PIN(FR-K18) — `property_settings.staff_pin_hash` = "pbkdf2-sha256$<반복>$<salt base64>$<hash base64>".
// 설정 화면(4단계)이 hashPin 으로 만든다. 온라인이면 태블릿은 `POST /api/kiosk/pin` 으로 서버가 대조하고(2026-11-13),
// 오프라인일 때만 계약의 기기별 값(devicePin)으로 대조한다 — 원 해시는 기기로 나가지 않는다(16 §4 보안 점검).
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

export type DevicePin = {
  algorithm: "pbkdf2-sha256-hmac-device";
  iterations: number;
  salt: string;
  /** 기기마다 다른 값 — HMAC(CHECKIN_HASH_SECRET, 기기 id). 같은 기기면 늘 같아 설정 버전이 흔들리지 않는다. */
  deviceSalt: string;
  keyBytes: number;
  /** HMAC-SHA256(deviceSalt, PBKDF2 결과) — 원 해시가 아니다. */
  hash: string;
};

/** 계약에 싣는 기기별 PIN 값. 태블릿은 PBKDF2(PIN, salt) 를 만든 뒤 deviceSalt 로 HMAC 해 hash 와 비교한다(`Pin.kt`). */
export function devicePin(stored: string | null | undefined, deviceId: string, secret: string): DevicePin | null {
  const parsed = parseStaffPin(stored);
  if (!parsed) return null;
  const deviceSalt = createHmac("sha256", secret).update(`pin-device|${deviceId}`).digest();
  const original = Buffer.from(parsed.hash, "base64");
  return {
    algorithm: "pbkdf2-sha256-hmac-device",
    iterations: parsed.iterations,
    salt: parsed.salt,
    deviceSalt: deviceSalt.toString("base64"),
    keyBytes: original.length,
    hash: createHmac("sha256", deviceSalt).update(original).digest("base64"),
  };
}

/** 태블릿 오프라인 대조와 같은 계산(테스트 · 고정 벡터용). */
export function verifyDevicePin(pin: string, value: DevicePin): boolean {
  if (!isPinShaped(pin)) return false;
  const derived = pbkdf2Sync(pin, Buffer.from(value.salt, "base64"), value.iterations, value.keyBytes, "sha256");
  const given = createHmac("sha256", Buffer.from(value.deviceSalt, "base64")).update(derived).digest();
  const expected = Buffer.from(value.hash, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
