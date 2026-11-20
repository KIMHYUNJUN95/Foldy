import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 예약 원본 · 알림 만들기 권한 좁히기(202611200003) — 정적 확인.
 *
 * 실제 권한 동작(authenticated 가 남은 칸만 읽고 `raw_payload` · `last_known_amount` 는 permission denied, 알림 INSERT 거절,
 * read_at UPDATE · DELETE 는 그대로, 두 번 돌려도 같은 결과)은 PGlite 스크립트로 따로 돌렸다(보고 참고).
 * 여기서는 두 가지 회귀를 막는다.
 *  1. 마이그레이션의 칸 목록 · 정책 · 권한 줄이 빠지거나 바뀌는 것.
 *  2. 로그인 사용자 클라이언트(`getSupabaseServerClient()`)로 예약을 읽으면서 남은 칸 밖(`raw_payload` 등)을 건드리는 코드,
 *     그리고 로그인 사용자 클라이언트로 알림을 만드는 코드 — 적용 뒤 화면 오류 · 조용히 안 가는 알림이 된다.
 * 소스 검사라 파일 밖에서 정해지는 값(함수 인자로 넘어온 클라이언트)은 못 본다 — 그런 helper 는 아래 `CLIENT_TAKING_HELPERS` 로 따로 본다.
 */

const PATH = "supabase/migrations/202611200003_reservations_notifications_privileges.sql";
const SQL = readFileSync(PATH, "utf8");
/** 주석을 뺀 실행 SQL — 되돌리기 · 확인 SQL 은 주석 안에 있다. */
const BODY = SQL.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function grantedReservationColumns(): string[] {
  const match = /grant select \(([^)]*)\) on public\.reservations to authenticated;/.exec(BODY);
  expect(match, "reservations 칸 grant").not.toBeNull();
  return match![1]
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function reservationRowColumns(): string[] {
  const lines = readFileSync("src/types/database.ts", "utf8").split("\n");
  const start = lines.findIndex((line) => line === "      reservations: {");
  expect(start).toBeGreaterThan(0);
  const out: string[] = [];
  for (let i = start + 2; i < lines.length && !/^ {8}\}/.test(lines[i]); i += 1) {
    const column = /^ {10}(\w+)\??:/.exec(lines[i]);
    if (column) out.push(column[1]);
  }
  return out;
}

const SERVER_ONLY_COLUMNS = ["raw_payload", "last_known_amount"];

describe("202611200003 마이그레이션 내용", () => {
  it("reservations: anon · authenticated 표 권한을 모두 거두고, 원본 두 칸을 뺀 나머지 칸만 다시 준다", () => {
    expect(BODY).toContain("revoke all on table public.reservations from anon;");
    expect(BODY).toContain("revoke all on table public.reservations from authenticated;");
    expect(BODY).toContain("grant all on table public.reservations to service_role;");
    // 표 단위 select 를 다시 주면 칸 권한이 의미가 없어진다.
    expect(BODY).not.toMatch(/grant select on (table )?public\.reservations to authenticated/);
    expect(BODY.indexOf("revoke all on table public.reservations from authenticated")).toBeLessThan(
      BODY.indexOf("grant select ("),
    );

    const granted = grantedReservationColumns();
    for (const column of SERVER_ONLY_COLUMNS) expect(granted).not.toContain(column);
    // 타입의 칸 = 준 칸 + 서버 전용 칸. 새 칸을 더하면 여기서 걸린다 — 사용자 클라이언트가 읽어야 하면 새 마이그레이션에서 grant.
    expect([...granted, ...SERVER_ONLY_COLUMNS].sort()).toEqual(reservationRowColumns().sort());
  });

  it("notifications: 사용자 INSERT 정책 · 권한을 없애고, 읽기 · 읽음 표시 · 지우기는 건드리지 않는다", () => {
    expect(BODY).toContain(
      'drop policy if exists "org members can create notifications for org recipients" on public.notifications;',
    );
    expect(BODY).not.toMatch(/create policy[^;]*on public\.notifications/);
    expect(BODY).toContain("revoke insert, truncate, references, trigger on table public.notifications from authenticated;");
    expect(BODY).toContain("revoke all on table public.notifications from anon;");
    expect(BODY).toContain("grant all on table public.notifications to service_role;");
    // select · update(read_at) · delete 는 남긴다.
    expect(BODY).not.toMatch(/revoke[^;]*\b(select|update|delete)\b[^;]*public\.notifications from authenticated/);
    expect(BODY).not.toMatch(/revoke all on table public\.notifications from authenticated/);
  });

  it("트랜잭션 안에서 lock_timeout 5초로 돈다(잠금을 못 잡으면 통째로 취소)", () => {
    const begin = BODY.indexOf("begin;");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(BODY.indexOf("set local lock_timeout = '5s';")).toBeGreaterThan(begin);
    expect(BODY.indexOf("set local lock_timeout")).toBeLessThan(BODY.indexOf("revoke all on table public.reservations"));
    expect(BODY.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("다시 돌려도 안전한 문장만 쓴다", () => {
    expect(BODY).not.toMatch(/drop policy (?!if exists)/);
    expect(BODY).not.toMatch(/create (table|policy|function)/);
  });

  it("되돌리기 · 확인 SQL 이 머리말에 있다", () => {
    expect(SQL).toContain("--   grant select on public.reservations to authenticated;");
    expect(SQL).toContain("--   grant insert on public.notifications to authenticated;");
    expect(SQL).toContain("information_schema.column_privileges");
    expect(SQL).toContain("pg_policies");
  });
});

// ── 소스 검사 ────────────────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) ||
  ts.isParenthesizedExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isAwaitExpression(node)
    ? unwrap(node.expression)
    : node;

function callsNamed(node: ts.Node, name: string): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === name) {
      found = true;
      return;
    }
    if (ts.isFunctionLike(child)) return;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** 이름이 가리키는 선언 — 가장 가까운 함수부터 바깥으로(안쪽 함수의 선언은 보지 않는다). */
function declarationOf(identifier: ts.Identifier): ts.Expression | "param" | null {
  const name = identifier.text;
  let scope: ts.Node | undefined = identifier.parent;
  while (scope) {
    if (ts.isFunctionLike(scope) || ts.isSourceFile(scope)) {
      if (ts.isFunctionLike(scope) && scope.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) {
        return "param";
      }
      let found: ts.Expression | null = null;
      const root: ts.Node = ts.isFunctionLike(scope) && "body" in scope && scope.body ? scope.body : scope;
      const visit = (child: ts.Node) => {
        if (found) return;
        if (child !== root && ts.isFunctionLike(child)) return;
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === name && child.initializer) {
          found = child.initializer;
          return;
        }
        ts.forEachChild(child, visit);
      };
      visit(root);
      if (found) return found;
    }
    scope = scope.parent;
  }
  return null;
}

/** 이 값이 로그인 사용자 클라이언트(`getSupabaseServerClient()`)인가. */
function isUserClient(node: ts.Expression, depth = 0): boolean {
  const value = unwrap(node);
  if (depth > 10) return false;
  if (ts.isIdentifier(value)) {
    const declared = declarationOf(value);
    return declared !== null && declared !== "param" && isUserClient(declared, depth + 1);
  }
  return callsNamed(value, "getSupabaseServerClient");
}

/** 사용자 클라이언트에 남는 칸만 읽는가 — 아니면 이유를 돌려준다. */
function reservationReadProblem(fromCall: ts.CallExpression, granted: Set<string>): string | null {
  let node: ts.Node = fromCall;
  let selected = false;
  while (ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent.parent)) {
    const call = node.parent.parent;
    const method = node.parent.name.text;
    const first = call.arguments[0] ? unwrap(call.arguments[0]) : null;
    if (["insert", "update", "upsert", "delete"].includes(method)) return `쓰기(${method})`;
    if (method === "select") {
      selected = true;
      if (!first || !ts.isStringLiteralLike(first)) return "select 칸 목록이 문자열 그대로가 아니다(상수 · 템플릿은 못 본다)";
      for (const raw of first.text.split(",")) {
        const item = raw.trim();
        if (!item) continue;
        if (item === "*") return 'select("*")';
        const column = (item.includes(":") ? item.slice(item.indexOf(":") + 1) : item).split(/->|::/)[0].trim();
        if (!granted.has(column)) return `남지 않는 칸 ${column}`;
      }
    } else if (first && ts.isStringLiteralLike(first) && SERVER_ONLY_COLUMNS.some((c) => first.text.includes(c))) {
      return `${method}(${first.text})`;
    }
    node = call;
  }
  if (!selected) return "select 없음";
  const wrapper = node.parent;
  if (ts.isCallExpression(wrapper) && ts.isIdentifier(wrapper.expression) && wrapper.expression.text === "excludePendingInquiries") {
    return "excludePendingInquiries(raw_payload 거르기)";
  }
  return null;
}

type HelperArg = { index?: number; property?: string };
type Helpers = Map<string, HelperArg[]>;

const CLIENT_NAMES = new Set(["supabase", "client", "db", "service"]);

/**
 * 클라이언트를 인자로 받아 `reservations` 를 읽는 함수 — 소스에서 **자동으로 찾는다**(2026-11-20). 이름 붙은 함수(선언 · 화살표 상수)
 * 몸통에 `.from("reservations")` 가 있고, 매개변수 중 클라이언트가 있으면(형에 `SupabaseClient` · 이름 supabase/client/db/service ·
 * 객체 인자의 그런 속성 · 몸통의 `인자.supabase`) 그 자리를 기록한다. 이런 함수에 사용자 클라이언트를 넘기면 잡는다 —
 * 남은 칸만 읽는 함수는 `USER_CLIENT_OK_HELPERS` 에 이유와 함께 적는다.
 */
function discoverClientHelpers(files: string[]): Helpers {
  const helpers: Helpers = new Map();
  const add = (name: string, arg: HelperArg) => helpers.set(name, [...(helpers.get(name) ?? []), arg]);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!text.includes('from("reservations")')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      let name: string | null = null;
      let fn: ts.SignatureDeclaration | null = null;
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        name = node.name.text;
        fn = node;
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        name = node.name.text;
        fn = node.initializer;
      }
      const body = fn && "body" in fn && fn.body ? fn.body.getText() : "";
      if (name && fn && body.includes('from("reservations")')) {
        fn.parameters.forEach((param, index) => {
          const typeText = param.type?.getText() ?? "";
          if (ts.isIdentifier(param.name)) {
            const paramName = param.name.text;
            if (CLIENT_NAMES.has(paramName) || /^SupabaseClient\b/.test(typeText.replace(/\s*\|.*$/, ""))) add(name!, { index });
            for (const property of CLIENT_NAMES) {
              if (body.includes(`${paramName}.${property}`) || new RegExp(`\\b${property}\\??:\\s*SupabaseClient`).test(typeText)) {
                add(name!, { index, property });
              }
            }
          } else if (ts.isObjectBindingPattern(param.name)) {
            for (const element of param.name.elements) {
              const property = (element.propertyName ?? element.name).getText();
              if (CLIENT_NAMES.has(property)) add(name!, { index, property });
            }
          }
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return helpers;
}

/** 사용자 클라이언트를 넘겨도 되는 helper — 남은 칸(202611200003 grant)만 읽는다. 바꾸면 이유도 같이 고친다. */
const USER_CLIENT_OK_HELPERS: Record<string, string> = {
  readFirstStays: "src/lib/ops-sales-summary-server.ts — check_in_date · property_name · status 만",
};

function notificationCreators(): Set<string> {
  const text = readFileSync("src/lib/notifications/create.ts", "utf8");
  return new Set([...text.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]));
}

type Finding = { file: string; line: number; problem: string };

function scan(file: string, text: string, granted: Set<string>, creators: Set<string>, helpers: Helpers) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const reservations: Finding[] = [];
  const notifications: Finding[] = [];
  const at = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const first = node.arguments[0] ? unwrap(node.arguments[0]) : null;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "from" && first && ts.isStringLiteralLike(first)) {
        if (first.text === "reservations" && isUserClient(callee.expression)) {
          const problem = reservationReadProblem(node, granted);
          if (problem) reservations.push({ file, line: at(node), problem });
        }
        if (first.text === "notifications" && isUserClient(callee.expression)) {
          let chain: ts.Node = node;
          while (ts.isPropertyAccessExpression(chain.parent) && ts.isCallExpression(chain.parent.parent)) {
            if (["insert", "upsert"].includes(chain.parent.name.text)) {
              notifications.push({ file, line: at(node), problem: `사용자 클라이언트로 notifications.${chain.parent.name.text}` });
            }
            chain = chain.parent.parent;
          }
        }
      }
      if (ts.isIdentifier(callee)) {
        const specs = USER_CLIENT_OK_HELPERS[callee.text] ? [] : (helpers.get(callee.text) ?? []);
        const passesUserClient = specs.some(({ index = 0, property }) => {
          const target = node.arguments[index] ? unwrap(node.arguments[index]) : null;
          if (!target) return false;
          if (!property) return isUserClient(target);
          const value = ts.isObjectLiteralExpression(target) ? propertyValue(target, property) : null;
          return value !== null && isUserClient(value);
        });
        if (passesUserClient) {
          reservations.push({ file, line: at(node), problem: `${callee.text} 에 사용자 클라이언트` });
        }
        if (creators.has(callee.text)) {
          const arg = first && ts.isObjectLiteralExpression(first) ? propertyValue(first, "supabase") : first;
          if (arg && isUserClient(arg)) {
            notifications.push({ file, line: at(node), problem: `${callee.text} 에 사용자 클라이언트` });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { notifications, reservations };
}

function propertyValue(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) return property.name;
  }
  return null;
}

describe("소스 검사(DB 권한 검사 아님) — 사용자 클라이언트의 예약 읽기 · 알림 만들기", () => {
  const granted = new Set(grantedReservationColumns());
  const creators = notificationCreators();
  const appFiles = ["src", "apps"].flatMap(sourceFiles);
  const helpers = discoverClientHelpers(appFiles);
  const check = (text: string) => scan("x.ts", text, granted, creators, helpers);

  it("클라이언트를 받아 예약을 읽는 helper 를 자동으로 찾는다", () => {
    const expected: Record<string, HelperArg> = {
      getCleaningTargets: { index: 2 },
      readOpsSalesInputs: { index: 0, property: "supabase" },
      readOpsRoomUnavailableNights: { index: 0, property: "supabase" },
      readOpsMoveTargets: { index: 0, property: "supabase" },
      loadStayKeys: { index: 0 },
      loadRangeRooms: { index: 0 },
      fillCheckIns: { index: 0 },
      loadDailyReportReservations: { index: 0 },
      findCleaningDataIssues: { index: 0 },
      findReservationRowsByOriginalBookingId: { index: 0 },
      resolveConversationSeed: { index: 0 },
      loadInboxThread: { index: 0 },
    };
    for (const [name, arg] of Object.entries(expected)) expect(helpers.get(name), name).toContainEqual(arg);
  }, 30_000);

  it("잡아야 하는 형태", () => {
    const user = "const supabase = await getSupabaseServerClient();";
    expect(check(`${user} supabase.from("reservations").select("*")`).reservations).toHaveLength(1);
    expect(check(`${user} supabase.from("reservations").select("id, raw_payload")`).reservations).toHaveLength(1);
    expect(check(`${user} supabase.from("reservations").select("id, rp:raw_payload->status")`).reservations).toHaveLength(1);
    expect(check(`${user} supabase.from("reservations").select(COLUMNS)`).reservations).toHaveLength(1);
    expect(check(`${user} supabase.from("reservations").select("id").not("raw_payload", "cs", "{}")`).reservations).toHaveLength(1);
    expect(check(`${user} excludePendingInquiries(supabase.from("reservations").select("id").eq("a", 1))`).reservations).toHaveLength(1);
    expect(check(`async function f(c) { const s = c ?? (await getSupabaseServerClient()); return s.from("reservations").select("raw_payload"); }`).reservations).toHaveLength(1);
    expect(check(`${user} getCleaningTargets(org, date, supabase)`).reservations).toHaveLength(1);
    expect(check(`${user} readOpsSalesInputs({ organizationId, supabase, window })`).reservations).toHaveLength(1);
    expect(check(`${user} readOpsMoveTargets({ organizationId, supabase: supabase, rows })`).reservations).toHaveLength(1);
    expect(check(`${user} readOpsRoomUnavailableNights({ organizationId, supabase })`).reservations).toHaveLength(1);
    expect(check(`${user} loadStayKeys(supabase, org, from, to)`).reservations).toHaveLength(1);
    expect(check(`${user} createNotification(supabase, input)`).notifications).toHaveLength(1);
    expect(check(`${user} createOrderProcessedNotification({ supabase, order })`).notifications).toHaveLength(1);
    expect(check(`${user} supabase.from("notifications").insert({})`).notifications).toHaveLength(1);
  });

  it("넘어가야 하는 형태", () => {
    const user = "const supabase = await getSupabaseServerClient();";
    expect(check(`${user} supabase.from("reservations").select("id, guest_name, check_in_date").eq("organization_id", o)`).reservations).toEqual([]);
    expect(check(`getSupabaseServiceClient().from("reservations").select("raw_payload")`).reservations).toEqual([]);
    expect(check(`async function f(c) { return excludePendingInquiries(c.from("reservations").select("raw_payload")); }`).reservations).toEqual([]);
    expect(check(`async function f() { const s = getSupabaseServiceClient(); return s.from("reservations").select("raw_payload"); }`).reservations).toEqual([]);
    // 다른 함수의 같은 이름은 섞지 않는다.
    expect(
      check(`async function a() { const supabase = await getSupabaseServerClient(); }
             async function b() { const supabase = getSupabaseServiceClient(); return supabase.from("reservations").select("raw_payload"); }`).reservations,
    ).toEqual([]);
    expect(check(`${user} createOrderProcessedNotification({ supabase: getSupabaseServiceClient(), order })`).notifications).toEqual([]);
    expect(check(`${user} readOpsMoveTargets({ organizationId, supabase: getSupabaseServiceClient(), rows })`).reservations).toEqual([]);
    expect(check(`${user} readFirstStays(supabase, org, names)`).reservations).toEqual([]);
    expect(check(`${user} supabase.from("notifications").update({ read_at: now })`).notifications).toEqual([]);
  });

  it("앱 코드: 사용자 클라이언트로 예약 원본을 읽거나 알림을 만드는 곳이 없다", () => {
    const reservations: Finding[] = [];
    const notifications: Finding[] = [];
    let userReservationReads = 0;
    for (const file of appFiles) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("getSupabaseServerClient")) continue;
      const found = scan(file, text, granted, creators, helpers);
      reservations.push(...found.reservations);
      notifications.push(...found.notifications);
      if (text.includes('from("reservations")')) userReservationReads += 1;
    }
    expect(reservations).toEqual([]);
    expect(notifications).toEqual([]);
    // 검사가 헛돌지 않는다 — 사용자 클라이언트를 쓰면서 예약을 읽는 파일은 실제로 여럿 있다(분실물 · 수리 등록 등).
    expect(userReservationReads).toBeGreaterThan(3);
  }, 30_000);
});
