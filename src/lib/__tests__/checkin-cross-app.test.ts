import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { CHECKIN_PROPERTIES, ENROLLMENT_CODE_PATTERN, formatEnrollmentCode } from "@/lib/checkin/model";
import { CHECKIN_CONTACT_KEYS, CHECKIN_FIELD_KEYS, CHECKIN_LANGUAGES } from "@/lib/checkin/settings-model";
import { hashCheckinStaffPin } from "@/lib/checkin/staff-pin";

vi.mock("server-only", () => ({}));

/**
 * Foldy 직원 서버 ↔ apps/checkin 이 같은 값을 쓰는지 — 두 앱은 서로 import 하지 않으므로 소스와 고정 벡터로 묶는다.
 * 같은 벡터가 apps/checkin/src/lib/__tests__/device.test.ts 에도 있다. docs/engineering/16 §4-1.
 */
const read = (path: string) => readFileSync(path, "utf8");

/** `export function 이름(...) { ... }` 본문을 주석 없이 꺼낸다. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}\n", start);
  return source
    .slice(source.indexOf("\n", start), end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const MODEL = read("src/lib/checkin/model.ts");
const SCHEMA_SQL = read("supabase/migrations/202611020001_checkin_schema.sql");
const GUEST_SQL = read("supabase/migrations/202611020002_checkin_guest_web.sql");
const withoutComments = (sql: string) => sql.replace(/--.*$/gm, "");

describe("체크인 앱과 같은 값", () => {
  it("직원 PIN 해시가 태블릿 쪽 hashPin 과 같은 값을 낸다(고정 벡터)", () => {
    expect(hashCheckinStaffPin("482913", Buffer.from("0123456789abcdef"))).toBe(
      "pbkdf2-sha256$120000$MDEyMzQ1Njc4OWFiY2RlZg==$Mj2V/Qp/9Ws/rF9fWcmliH7KRiXnTrYlbfyrrBo7xn8=",
    );
  });

  it("등록 코드는 해시 없이 평문 8자리로 대조된다 — 태블릿 라우트 · DB check 와 모양이 같다", () => {
    const route = read("apps/checkin/src/app/api/device/enroll/route.ts");
    expect(route).toContain("code: z.string().regex(/^[0-9]{8}$/)");
    expect(route).toContain('.eq("code", input.code)');
    expect(read("supabase/migrations/202611020001_checkin_schema.sql")).toContain("code text primary key check (code ~ '^[0-9]{8}$')");
    for (const value of [0, 42, 99_999_999]) expect(formatEnrollmentCode(value)).toMatch(ENROLLMENT_CODE_PATTERN);
  });

  it("필수 칸 판정 · 직원 확인 판정 본문이 체크인 앱과 같다", () => {
    expect(bodyOf(MODEL, "missingFields")).toBe(bodyOf(read("apps/checkin/src/lib/guest/fields.ts"), "missingFields"));
    expect(bodyOf(MODEL, "needsStaffCheck")).toBe(bodyOf(read("apps/checkin/src/lib/kiosk/complete.ts"), "needsStaffCheck"));
    expect(read("apps/checkin/src/lib/kiosk/complete.ts")).toContain('new Set(["passport_photo"])');
  });

  it("건물 키가 체크인 앱에 있고, 동기화에서 빠진 건물은 고를 수 없다", () => {
    const buildingKeys = read("apps/checkin/src/lib/building-key.ts");
    for (const property of CHECKIN_PROPERTIES) {
      expect(buildingKeys).toContain(`${property.key}: "${property.name}"`);
    }
    expect(read("apps/checkin/src/lib/sync/plan.ts")).toContain('EXCLUDED_PROPERTY_KEYS: ReadonlySet<string> = new Set(["sano"])');
    expect(CHECKIN_PROPERTIES.map((property) => property.key)).not.toContain("sano");
  });

  it("건물 설정 한계가 계약 스키마와 같다", () => {
    const schema = read("apps/checkin/src/lib/contract/schema.ts");
    expect(schema).toContain("videoSecondsPerGuest: z.number().int().min(3).max(15)");
    expect(schema).toContain("idleSecondsInput: z.number().int().min(30).max(900)");
    expect(schema).toContain("idleSecondsDone: z.number().int().min(5).max(120)");
    for (const key of CHECKIN_FIELD_KEYS) expect(schema).toContain(`"${key}"`);
    const build = read("apps/checkin/src/lib/contract/build.ts");
    expect(build).toContain(`for (const key of [${CHECKIN_CONTACT_KEYS.map((key) => `"${key}"`).join(", ")}] as const)`);
    const i18n = read("apps/checkin/src/lib/i18n/index.ts");
    for (const language of CHECKIN_LANGUAGES) expect(i18n).toContain(`"${language}"`);
  });
});

/**
 * 2026-11-04 독립 검사: 표 전체 SELECT 를 authenticated 에 주면 API 노출 순간 직원 JWT 로 코드 · 여권 번호 · 해시를 기록 없이 읽는다.
 * 앱은 service_role 만 쓰므로 그 길을 만들지 않는다. 실제 역할로 돌린 확인은 docs/engineering/16 §4-1.
 */
describe("checkin 스키마 접근", () => {
  const sql = withoutComments(`${SCHEMA_SQL}\n${GUEST_SQL}`);

  it("authenticated · anon 에 권한을 주지 않는다", () => {
    expect(sql).not.toMatch(/grant[^;]*\bto\s+[^;]*\b(authenticated|anon|public)\b/i);
    expect(sql).toMatch(/revoke all on schema checkin from public, anon, authenticated;/);
    expect(sql).toMatch(/grant usage on schema checkin to service_role;/);
  });

  it("직원 정책이 없고, 모든 표에 RLS 가 켜져 있다", () => {
    expect(sql).not.toMatch(/create policy/i);
    const tables = [...sql.matchAll(/create table checkin\.(\w+)/g)].map((match) => match[1]);
    expect(tables).toHaveLength(13);
    for (const table of tables) expect(sql, table).toContain(`alter table checkin.${table} enable row level security;`);
  });

  it("대기 시간 check 가 앱 검증과 같은 범위다", () => {
    expect(sql).toContain("check (idle_seconds_input between 30 and 900)");
    expect(sql).toContain("check (idle_seconds_done between 5 and 120)");
  });
});

describe("화면 연결", () => {
  const devices = read("src/components/admin/checkin/checkin-devices-console.tsx");

  it("「새 코드」만 무효화를 부르고, 패널을 닫는 길은 코드를 끝내지 않는다", () => {
    expect(devices).toContain("onClick={() => void discardCode()}");
    expect(devices.match(/invalidateCheckinEnrollmentCode\(/g)).toHaveLength(1);
    expect(devices).toContain("invalidateCheckinEnrollmentCode(issued.code)");
    expect(devices).not.toContain("closePanel");
    const add = devices.slice(devices.indexOf("function AddPanel("), devices.indexOf("function DevicePanel("));
    expect(add).toContain("useAdminPanelA11y<HTMLElement>(onClose, { disabled: busy })");
    expect(add).toContain("onClick={busy ? undefined : onClose}");
  });

  it("발급 중에는 X 도 스크림 · Esc 처럼 막힌다", () => {
    const add = devices.slice(devices.indexOf("function AddPanel("), devices.indexOf("function DevicePanel("));
    expect(add).toContain("aria-label={copy.close} disabled={busy} onClick={onClose}");
  });

  it("무효화가 실패하면 코드를 그대로 두고 알린다", () => {
    const discard = devices.slice(devices.indexOf("async function discardCode()"), devices.indexOf("const remaining = issued"));
    expect(discard).toContain("if (result.ok) {");
    expect(discard.indexOf("setIssued(null)")).toBeLessThan(discard.indexOf("} else {"));
    expect(discard.match(/setIssued\(null\)/g)).toHaveLength(1);
    expect(discard.match(/onToast\(copy\.actionFailed\)/g)).toHaveLength(2);
  });

  it("안내 문구가 세 언어에 있고 시간 자리가 맞다", () => {
    const i18n = read("src/lib/i18n.ts");
    const hints = i18n.match(/^ {4}codeCloseHint: ".*"/gm) ?? [];
    expect(hints).toHaveLength(3);
    for (const hint of hints) expect(hint).toContain("{time}");
    expect(i18n.match(/^ {4}newCodeNote: "/gm)).toHaveLength(3);
    expect(devices).toContain("copy.codeCloseHint");
    expect(devices).toContain("copy.newCodeNote");
  });

  it("저장 충돌 문구가 세 언어에 있고 화면이 쓴다", () => {
    expect(read("src/components/admin/checkin/checkin-settings-console.tsx")).toContain('result.errorKey === "conflict" ? copy.settingsConflict');
    expect(read("src/lib/i18n.ts").match(/^ {4}settingsConflict: "/gm)).toHaveLength(3);
  });
});
