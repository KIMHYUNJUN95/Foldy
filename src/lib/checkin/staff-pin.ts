import "server-only";

import { pbkdf2Sync, randomBytes } from "node:crypto";

// 직원 해제 PIN 해시 — apps/checkin `device/pin.ts` `hashPin` 과 같은 값을 내야 태블릿이 대조할 수 있다(FR-K18).
// 두 앱은 서로 import 하지 않는다. 같은 값인지는 양쪽 테스트의 고정 벡터가 지킨다(checkin-cross-app.test.ts · device.test.ts).
const ITERATIONS = 120_000;
const KEY_BYTES = 32;

export function hashCheckinStaffPin(pin: string, salt: Buffer = randomBytes(16)): string {
  const hash = pbkdf2Sync(pin, salt, ITERATIONS, KEY_BYTES, "sha256");
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
