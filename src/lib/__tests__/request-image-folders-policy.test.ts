import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUEST_IMAGE_FOLDERS_ALL_MEMBERS, REQUEST_IMAGE_USER_FOLDERS } from "@/lib/request-image-folders";

/**
 * `request-images` 버킷 — 「코드가 사용자 키(브라우저 클라이언트)로 쓰는 폴더」와 「마이그레이션 최종 정책의 폴더」가 같아야 한다.
 *
 * 2026-07-16(202607160001)부터 정책을 다시 만드는 마이그레이션들이 폴더 목록을 통째로 다시 적으면서 할 일 · 제안 · 근태 정정 ·
 * 게시판 폴더를 빠뜨렸고, 그 뒤로 그 사진 올리기가 조용히 막혀 있었다(2026-11-20 발견). 여기서는 마이그레이션 폴더 전체를
 * 시간순으로 읽어(만들기 · 지우기 둘 다 따라가) 정책 · 폴더 함수의 마지막 정의를 뽑고 코드 목록과 맞춘다.
 *
 * 2026-11-24(202611240001): 할 일 두 폴더의 아르바이트 제외를 없앴고(갈래 하나 — 모든 활성 멤버), 읽기(SELECT) 정책을 더했다.
 * 읽기는 「내가 올린 것 + 1시간 안」만 — 브라우저 remove() 가 「방금 올린 내 사진 되지우기」에만 쓰이기 때문이다. 지우기 정책과 같은 조건으로 열면
 * 지금까지 0행이던 지우기 정책 전체(권한자의 남의 사진 지우기 · 플랫폼 관리자 갈래)가 처음으로 실제 권한이 되므로, 그 갈래가 없다는 것까지 본다.
 *
 * 함수를 실제로 돌리는 PGlite 는 이 저장소 의존성에 없다 — 갈래 모양은 함수 본문으로 보고, 실제 역할 표(직원 · 아르바이트 · 남의 조직 ×
 * 올리기 · 지우기 · 보이는 행)는 로컬 DB 스크립트로 돌렸다(docs/engineering/05-rls-permissions.md 「2026-11-24」 절).
 */

const DIR = "supabase/migrations";
const FILES = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const BODIES = FILES.map((file) => ({ file, body: stripComments(readFileSync(join(DIR, file), "utf8")) }));

type Definition = { file: string; text: string };

/**
 * 이름 하나(정책 · 함수)의 마지막 상태 — 파일 순서, 파일 안에서는 위치 순서로 만들기 · 지우기를 따라간다.
 * 마지막이 지우기면 null(정책 · 함수가 없어진 것).
 */
function lastDefinition(create: RegExp, drop: RegExp, end: string): Definition | null {
  let state: Definition | null = null;
  for (const { file, body } of BODIES) {
    const events: Array<{ at: number; text: string | null }> = [];
    for (const m of body.matchAll(new RegExp(create.source, "gi"))) {
      const at = m.index!;
      events.push({ at, text: body.slice(at, body.indexOf(end, at)) });
    }
    for (const m of body.matchAll(new RegExp(drop.source, "gi"))) events.push({ at: m.index!, text: null });
    for (const e of events.sort((a, b) => a.at - b.at)) state = e.text === null ? null : { file, text: e.text };
  }
  return state;
}

function policy(name: string): Definition {
  const q = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const def = lastDefinition(
    new RegExp(`create policy "${q}"`),
    new RegExp(`drop policy (?:if exists )?"${q}"`),
    ");\n",
  );
  expect(def, `${name} 가 마지막에 지워진 채다`).not.toBeNull();
  return def!;
}

function sqlFunction(name: string): Definition {
  const def = lastDefinition(
    new RegExp(`create (?:or replace )?function public\\.${name}\\(`),
    new RegExp(`drop function (?:if exists )?public\\.${name}\\b`),
    "$$;",
  );
  expect(def, `${name} 가 마지막에 지워진 채다`).not.toBeNull();
  return def!;
}

const folderFunction = () => sqlFunction("request_image_folder_allows");

const UPLOAD = "org members can upload request images";
const DELETE = "org members can delete request images";
const SELECT = "uploaders can read own recent request images";

/** 정책 본문의 `using (` 안 조건(정의 조각은 마지막 `);` 앞에서 끊기므로 using 의 닫는 괄호는 이미 빠져 있다). 공백은 하나로. */
function usingBody(text: string): string {
  const m = /\busing\s*\(/i.exec(text);
  expect(m, "using 절이 없다").not.toBeNull();
  return text.slice(m!.index + m![0].length).replace(/\s+/g, " ").trim();
}

/** 괄호 깊이 0 에서만 `and` / `or` 로 나눈다(문자열 따옴표 안은 무시). 바깥 괄호 한 겹은 벗긴다. */
function splitTopLevel(expr: string, op: "and" | "or"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  const token = ` ${op} `;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") quoted = !quoted;
    if (quoted) continue;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && expr.slice(i, i + token.length).toLowerCase() === token) {
      parts.push(expr.slice(start, i));
      start = i + token.length;
      i += token.length - 1;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => unwrap(p.trim()));
}

function unwrap(p: string): string {
  if (!p.startsWith("(") || !p.endsWith(")")) return p;
  let depth = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "(") depth++;
    else if (p[i] === ")") depth--;
    if (depth === 0 && i < p.length - 1) return p; // 맨 앞 괄호가 끝까지 감싸지 않음
  }
  return unwrap(p.slice(1, -1).trim());
}

function quotedFolders(text: string): string[] {
  return [...text.matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)].map((m) => m[1]);
}

/** 폴더 함수 본문의 갈래 — 「누구나」 배열 · 「아르바이트 제외」 배열 + 각 갈래의 결과. */
function functionBranches() {
  const { file, text } = folderFunction();
  const branches = [...text.matchAll(/when p_folder = any \(array\[([^\]]*)\]\)\s*then\s+([^\n]+)/g)].map((m) => ({
    folders: quotedFolders(m[1]),
    result: m[2].trim(),
  }));
  return { file, text, branches };
}

describe("request-images 폴더 목록 — 코드 ↔ 마이그레이션", () => {
  it("코드 목록에 겹침이 없다", () => {
    expect(new Set(REQUEST_IMAGE_USER_FOLDERS).size).toBe(REQUEST_IMAGE_USER_FOLDERS.length);
  });

  it("올리기 · 지우기 정책의 마지막 정의는 폴더를 직접 적지 않고 폴더 함수를 부른다(202611200005 그대로)", () => {
    for (const name of [UPLOAD, DELETE]) {
      const { file, text } = policy(name);
      expect(file, name).toBe("202611200005_request_images_folder_policies.sql");
      expect(text, `${file} ${name}`).toContain("public.request_image_folder_allows(");
      // 목록을 정책에 다시 적으면 다음 사람이 또 한 폴더만 더하다 나머지를 빠뜨린다 — `= any (array[…])` · `in ('…')` 둘 다.
      expect(text, `${file} ${name}`).not.toMatch(/split_part\([^)]*,\s*2\)\s*(?:=\s*any\s*\(|in\s*\()/i);
      const stray = quotedFolders(text).filter((f) => f !== "request-images" && f !== "linen-returns");
      expect(stray, `${file} ${name}`).toEqual([]);
    }
  });

  it("읽기(SELECT) 정책: authenticated 에게만, 조건은 and 다섯 개 — 버킷 · 4칸 · 조직 uuid · 내 것 · 1시간 안", () => {
    const { file, text } = policy(SELECT);
    expect(text, file).toMatch(/on storage\.objects\s+for select to authenticated\s+using/);
    const body = usingBody(text);
    expect(splitTopLevel(body, "or"), `${file} — 바깥에 or 갈래가 있으면 안 된다`).toHaveLength(1);
    expect(splitTopLevel(body, "and"), file).toEqual([
      "bucket_id = 'request-images'",
      "array_length(string_to_array(name, '/'), 1) = 4",
      "split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
      "owner_id = ((select auth.uid()))::text",
      "created_at > now() - interval '1 hour'",
    ]);
    // 지우기 정책의 넓은 갈래는 읽기에 없다 — 있으면 남의 사진 지우기 · 목록 받기가 처음으로 열린다.
    for (const wide of ["has_capability", "request.delete_any", "linen.manage", "platform_admins", "memberships"]) {
      expect(body, `${file} — ${wide}`).not.toContain(wide);
    }
  });

  it("request-images 를 다루는 SELECT 정책은 하나뿐, 판정 함수 request_image_deletable 은 만들지 않는다", () => {
    const selects = new Set<string>();
    for (const { body } of BODIES) {
      for (const m of body.matchAll(/create policy "([^"]+)" on storage\.objects\s+for (?:select|all)\b[^;]*?'request-images'/gi)) {
        selects.add(m[1]);
      }
    }
    expect([...selects]).toEqual([SELECT]);
    const fn = lastDefinition(
      /create (?:or replace )?function public\.request_image_deletable\(/,
      /drop function (?:if exists )?public\.request_image_deletable\b/,
      "$$;",
    );
    expect(fn).toBeNull();
  });

  it("폴더 함수: 갈래는 하나 — 목록 안이면 누구나(true, 아르바이트 제외 없음), 목록 밖은 false", () => {
    const { file, text, branches } = functionBranches();
    expect(branches.length, file).toBe(1);
    expect(branches[0].result, file).toBe("true");
    expect(text, file).not.toContain("part_time_staff");
    expect(text, file).toMatch(/else\s+false\s+end/);
    expect(text, file).toContain("immutable");
    expect(text, file).toContain("set search_path = ''");
  });

  it("폴더 함수의 폴더 = 코드의 REQUEST_IMAGE_FOLDERS_ALL_MEMBERS(할 일 두 폴더 포함)", () => {
    const { file, branches } = functionBranches();
    expect([...branches[0].folders].sort(), file).toEqual([...REQUEST_IMAGE_FOLDERS_ALL_MEMBERS].sort());
    expect(REQUEST_IMAGE_FOLDERS_ALL_MEMBERS).toContain("task-images");
    expect(REQUEST_IMAGE_FOLDERS_ALL_MEMBERS).toContain("task-update-images");
  });

  it("폴더 함수 실행 권한: public · anon 회수, authenticated 부여(정책이 authenticated 로 부른다)", () => {
    const { file } = folderFunction();
    const body = BODIES.find((b) => b.file === file)!.body;
    expect(body, file).toMatch(/revoke all on function public\.request_image_folder_allows\([^)]*\) from public;/);
    expect(body, file).toMatch(/revoke execute on function public\.request_image_folder_allows\([^)]*\) from anon;/);
    expect(body, file).toMatch(/grant execute on function public\.request_image_folder_allows\([^)]*\) to authenticated\b/);
  });

  it("브라우저 업로더가 쓰는 폴더 이름은 모두 코드 목록 안에 있다", () => {
    const known = new Set<string>(REQUEST_IMAGE_USER_FOLDERS);
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(path);
        } else if (/\.tsx?$/.test(entry.name)) {
          const src = readFileSync(path, "utf8");
          for (const m of src.matchAll(/requestType: "([a-z-]+)"/g)) used.add(m[1]);
          for (const m of src.matchAll(/folder: "(board-[a-z]+)"/g)) used.add(m[1]);
          // `usePhotoUpload(organizationId, "maintenance-reports")` — 두 번째 인자가 폴더.
          for (const m of src.matchAll(/usePhotoUpload\([^,()]+,\s*"([a-z-]+)"/g)) used.add(m[1]);
        }
      }
    };
    walk("src");
    for (const folder of ["maintenance-reports", "order-images", "lost-items", "board-posts", "task-images"]) {
      expect(used.has(folder), `검사가 ${folder} 쓰는 곳을 찾는다`).toBe(true);
    }
    for (const folder of used) expect(known.has(folder), folder).toBe(true);
  });
});
