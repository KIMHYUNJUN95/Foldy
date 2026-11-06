import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { resolveCheckinNotificationLink } from "@/lib/checkin/staff-call";
import { buildNotificationViews } from "@/lib/notifications/brief";
import { getNotificationDisplay, notificationTypeLabel } from "@/lib/notifications/display";
import type { NotificationRow } from "@/lib/notifications/types";

// 새 알림 3종의 글 · 눌렀을 때 — docs/product/46 §4, docs/product/14.
const row = (type: string, payload: Record<string, unknown>) =>
  ({
    id: "n1",
    organization_id: "o",
    recipient_user_id: "u",
    type,
    href: "/admin/checkin",
    source_type: "checkin_staff_call",
    source_id: "c1",
    dedupe_key: "k",
    payload,
    read_at: null,
    created_at: "2026-11-06T00:00:00.000Z",
  }) as unknown as NotificationRow;

const TYPES = ["checkin_staff_call", "checkin_call_missed", "checkin_staff_check"] as const;
const LOCALES = ["ko", "ja", "en"] as const;
const payload = { callId: "c1", stayId: "s1", propertyKey: "arakicho_a" };

describe("문구", () => {
  it.each(TYPES.flatMap((type) => LOCALES.map((locale) => [type, locale] as const)))("%s · %s — 건물 이름이 그 언어로, 빈 문구 없음", (type, locale) => {
    const display = getNotificationDisplay(row(type, payload), locale);
    expect(display.title).toBeTruthy();
    expect(display.body).not.toContain("{building}");
    expect(display.body).not.toContain("arakicho_a");
    expect(notificationTypeLabel(type, locale)).toBeTruthy();
    const { views } = buildNotificationViews([row(type, payload)], { locale });
    expect(views[0].title).toBe(display.title);
    expect(views[0].object).not.toContain("arakicho_a");
  });
});

describe("눌렀을 때", () => {
  const link = (surface: "admin" | "mobile", canViewCheckin: boolean, type = "checkin_staff_call") =>
    resolveCheckinNotificationLink({ type, callId: "c1", access: { surface, canViewCheckin } });

  it("관리자 콘솔 + checkin.view 면 체크인 화면으로", () => {
    expect(link("admin", true).href).toBe("/admin/checkin");
  });

  it("checkin.view 가 없으면 이동하지 않는다", () => {
    expect(link("admin", false).href).toBe("");
    expect(link("admin", false, "checkin_call_missed").href).toBe("");
  });

  it("모바일에서는 관리자 화면으로 보내지 않는다", () => {
    expect(link("mobile", true).href).toBe("");
    expect(link("mobile", true, "checkin_call_missed").href).toBe("");
  });

  it("호출 알림만 받기 화면으로 다시 이을 수 있다", () => {
    expect(link("mobile", false).staffCallId).toBe("c1");
    expect(link("mobile", false, "checkin_call_missed").staffCallId).toBeNull();
    expect(link("mobile", false, "checkin_staff_check").staffCallId).toBeNull();
  });

  it("권한 정보를 안 넘기면 이동하지 않는다, 다른 알림의 href 는 그대로", () => {
    const { views } = buildNotificationViews(
      [row("checkin_call_missed", payload), { ...row("board_activity", {}), href: "/mobile/board/1" }],
      { locale: "ko" },
    );
    expect(views[0].href).toBe("");
    expect(views[1].href).toBe("/mobile/board/1");
  });
});

// 「이 세 종류는 서버만 만든다」는 만들기만이 아니라 바꾸기도 포함한다 — 로그인 사용자는 읽음 시각만 쓴다(문서 46 §4).
describe("알림 칸 보호", () => {
  const sql = readFileSync("supabase/migrations/202611060001_checkin_staff_calls.sql", "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("로그인 사용자의 표 전체 UPDATE 권한을 거두고 read_at 만 돌려준다", () => {
    const revoke = sql.search(/revoke update on public\.notifications from [^;]*\bauthenticated\b[^;]*;/);
    const grant = sql.search(/grant update \(read_at\) on public\.notifications to authenticated;/);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  // 소스 검사다 — 실제 DB 권한은 확인하지 않는다(그건 docs/engineering/05 의 로컬 PostgREST 확인). 칸 권한을 늘리지 않고도 앱이 돌아가는지만 본다.
  // 문법 트리로 형 변환 · 같은 파일의 변수 · 표 이름 상수까지 따라간다. 함수 인자로 넘어온 쿼리 · 표 이름처럼 파일 밖에서 정해지는 값은 못 본다.
  const writesOf = (text: string) => {
    const file = ts.createSourceFile("x.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const values = new Map<string, ts.Expression[]>();
    const remember = (name: string, value: ts.Expression) => values.set(name, [...(values.get(name) ?? []), value]);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) remember(node.name.text, node.initializer);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) remember(node.left.text, node.right);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["update", "upsert"].includes(node.expression.name.text)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    const unwrap = (node: ts.Expression): ts.Expression =>
      ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node) ? unwrap(node.expression) : node;
    const isTable = (node: ts.Expression, depth = 0): boolean => {
      const value = unwrap(node);
      if (ts.isStringLiteralLike(value)) return value.text === "notifications";
      return ts.isIdentifier(value) && depth < 20 && (values.get(value.text) ?? []).some((next) => isTable(next, depth + 1));
    };
    const comesFromTable = (node: ts.Expression, depth = 0): boolean => {
      const value = unwrap(node);
      if (depth > 40) return false;
      if (ts.isIdentifier(value)) return (values.get(value.text) ?? []).some((next) => comesFromTable(next, depth + 1));
      if (ts.isPropertyAccessExpression(value)) return comesFromTable(value.expression, depth + 1);
      if (!ts.isCallExpression(value)) return false;
      const callee = value.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "from" && value.arguments[0]) return isTable(value.arguments[0]);
      return comesFromTable(callee, depth + 1);
    };
    const columnsOf = (node: ts.Expression | undefined): string[] => {
      const value = node && unwrap(node);
      if (value && ts.isIdentifier(value)) return columnsOf(values.get(value.text)?.[0]);
      if (!value || !ts.isObjectLiteralExpression(value)) return ["<unknown>"];
      return value.properties.map((property) => (ts.isSpreadAssignment(property) || !property.name || !ts.isIdentifier(property.name) ? "<unknown>" : property.name.text));
    };
    return calls
      .filter((call) => comesFromTable((call.expression as ts.PropertyAccessExpression).expression))
      .map((call) => ({ method: (call.expression as ts.PropertyAccessExpression).name.text, columns: columnsOf(call.arguments[0]) }));
  };

  it("(소스 검사) 잡아야 하는 형태 — 형 변환 · 변수 · 표 이름 상수 · upsert", () => {
    const has = (text: string, method: string, columns: string[]) => expect(writesOf(text)).toContainEqual({ method, columns });
    has(`s.from("notifications" as never).update({ type: "x" })`, "update", ["type"]);
    has(`const q = s.from("notifications"); q.update({ href: "/x" }).eq("id", 1);`, "update", ["href"]);
    has(`const T = "notifications"; s.from(T).update({ payload: {} })`, "update", ["payload"]);
    has(`s.from("notifications").eq("id", 1).upsert({ read_at: 1 })`, "upsert", ["read_at"]);
    has(`const patch = { type: "x" }; s.from("notifications").update(patch)`, "update", ["type"]);
    has(`s.from("notifications").update(makePatch())`, "update", ["<unknown>"]);
    expect(writesOf(`s.from("rooms").update({ type: "x" })`)).toEqual([]);
  });

  it("(소스 검사 · DB 권한 검사 아님) 앱의 알림 UPDATE 는 read_at 만 쓰고, upsert 는 없다", () => {
    const writes = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !file.includes("__tests__"))
      .map((file) => readFileSync(path.join("src", file), "utf8"))
      .filter((text) => text.includes("notifications"))
      .flatMap(writesOf);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write).toEqual({ method: "update", columns: ["read_at"] });
  }, 30_000);
});
