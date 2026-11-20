import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUEST_IMAGE_FOLDERS_ALL_MEMBERS,
  REQUEST_IMAGE_FOLDERS_NO_PART_TIME,
  REQUEST_IMAGE_USER_FOLDERS,
} from "@/lib/request-image-folders";

/**
 * `request-images` 버킷 — 「코드가 사용자 키(브라우저 클라이언트)로 쓰는 폴더」와 「마이그레이션 최종 정책의 폴더」가 같아야 한다.
 *
 * 2026-07-16(202607160001)부터 정책을 다시 만드는 마이그레이션들이 폴더 목록을 통째로 다시 적으면서 할 일 · 제안 · 근태 정정 ·
 * 게시판 폴더를 빠뜨렸고, 그 뒤로 그 사진 올리기가 조용히 막혀 있었다(2026-11-20 발견). 여기서는 마이그레이션 폴더 전체를
 * 시간순으로 읽어(만들기 · 지우기 둘 다 따라가) 정책 · 폴더 함수의 마지막 정의를 뽑고 코드 목록과 맞춘다.
 *
 * 함수를 실제로 돌리는 PGlite 는 이 저장소 의존성에 없다 — 역할 갈래(할 일 폴더 아르바이트 제외 · 목록 밖 false)는 함수 본문 모양으로
 * 보고, 실제 역할 표(자기 조직 허용 · 남의 조직 거부 · 목록 밖 거부 · 아르바이트 할 일 폴더 거부)는 로컬 DB 스크립트로 돌렸다(보고 참고).
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

function folderFunction(): Definition {
  const def = lastDefinition(
    /create (?:or replace )?function public\.request_image_folder_allows\(/,
    /drop function (?:if exists )?public\.request_image_folder_allows\b/,
    "$$;",
  );
  expect(def, "request_image_folder_allows 가 마지막에 지워진 채다").not.toBeNull();
  return def!;
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

  it("올리기 · 지우기 정책의 마지막 정의는 폴더를 직접 적지 않고 폴더 함수를 부른다", () => {
    for (const name of ["org members can upload request images", "org members can delete request images"]) {
      const { file, text } = policy(name);
      expect(text, `${file} ${name}`).toContain("public.request_image_folder_allows(");
      // 목록을 정책에 다시 적으면 다음 사람이 또 한 폴더만 더하다 나머지를 빠뜨린다 — `= any (array[…])` · `in ('…')` 둘 다.
      expect(text, `${file} ${name}`).not.toMatch(/split_part\([^)]*,\s*2\)\s*(?:=\s*any\s*\(|in\s*\()/i);
      // 정책에 남는 폴더 모양 글자는 버킷 이름과 지우기 권한 갈래의 linen-returns 뿐.
      const stray = quotedFolders(text).filter((f) => f !== "request-images" && f !== "linen-returns");
      expect(stray, `${file} ${name}`).toEqual([]);
    }
  });

  it("폴더 함수: 갈래는 둘 — 누구나(true) · 아르바이트 제외, 목록 밖은 false", () => {
    const { file, text, branches } = functionBranches();
    expect(branches.length, file).toBe(2);
    expect(branches[0].result, file).toBe("true");
    expect(branches[1].result, file).toBe("p_role is distinct from 'part_time_staff'::public.organization_role");
    expect(text, file).toMatch(/else\s+false\s+end/);
    expect(text, file).toContain("immutable");
    expect(text, file).toContain("set search_path = ''");
  });

  it("폴더 함수의 「활성 멤버 누구나」 폴더 = 코드의 REQUEST_IMAGE_FOLDERS_ALL_MEMBERS", () => {
    const { file, branches } = functionBranches();
    expect([...branches[0].folders].sort(), file).toEqual([...REQUEST_IMAGE_FOLDERS_ALL_MEMBERS].sort());
  });

  it("폴더 함수의 「아르바이트 제외」 폴더 = 코드의 REQUEST_IMAGE_FOLDERS_NO_PART_TIME", () => {
    const { file, branches } = functionBranches();
    expect([...branches[1].folders].sort(), file).toEqual([...REQUEST_IMAGE_FOLDERS_NO_PART_TIME].sort());
  });

  it("폴더 함수 실행 권한은 anon 에서 거둔다(public 회수만으로는 Supabase 기본 anon 권한이 남는다)", () => {
    const { file } = folderFunction();
    const body = BODIES.find((b) => b.file === file)!.body;
    expect(body).toMatch(/revoke all on function public\.request_image_folder_allows\([^)]*\) from public;/);
    expect(body).toMatch(/revoke execute on function public\.request_image_folder_allows\([^)]*\) from anon;/);
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
