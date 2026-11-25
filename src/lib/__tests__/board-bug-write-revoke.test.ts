import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 게시판 · 버그 신고 직접 쓰기 회수(2026-11-25, 202611250004) — 마이그레이션 정적 확인 + 실제 역할로 읽기 · 쓰기.
 * 문서: docs/engineering/05-rls-permissions.md 「게시판 · 버그 신고 직접 쓰기 회수(2026-11-25)」
 *
 * PGlite 는 이 저장소의 의존성이 아니다 — 설치한 폴더를 `FOLDY_PGLITE_DIR` 로 넘기면 DB 검사가 돈다(없으면 건너뛰고 경고 줄을 남긴다).
 *   mkdir -p /tmp/pg && (cd /tmp/pg && npm i @electric-sql/pglite@0.3.14)
 *   FOLDY_PGLITE_DIR=/tmp/pg npx vitest run src/lib/__tests__/board-bug-write-revoke.test.ts
 */

const FILE = "202611250004_board_bug_direct_write_revoke.sql";
const SQL = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8");
const CODE = SQL.replace(/--.*$/gm, "");
const PGLITE_DIR = process.env.FOLDY_PGLITE_DIR;

const TABLES = ["board_posts", "board_comments", "board_reactions", "board_post_reads", "bug_reports"] as const;

const WRITE_POLICIES: Array<[string, string]> = [
  ["board posts: active members can create", "board_posts"],
  ["board posts: authors and admins can update", "board_posts"],
  ["board posts: authors and admins can delete", "board_posts"],
  ["board comments: active members can create", "board_comments"],
  ["board comments: authors and admins can delete", "board_comments"],
  ["board reactions: users can insert own", "board_reactions"],
  ["board reactions: users can delete own", "board_reactions"],
  ["board reads: insert own", "board_post_reads"],
  ["board reads: upsert own", "board_post_reads"],
  ["bug reports: active members can create", "bug_reports"],
  ["bug reports: author can update while submitted", "bug_reports"],
  ["bug reports: reviewer can update status", "bug_reports"],
  ["bug reports: author can delete while submitted", "bug_reports"],
];

describe("게시판 · 버그 신고 직접 쓰기 회수 — 파일", () => {
  it("anon 은 다섯 표 권한을 모두 잃는다", () => {
    const stmt = CODE.match(/revoke all on table([^;]*)from anon;/)?.[1] ?? "";
    for (const t of TABLES) expect(stmt, t).toContain(`public.${t}`);
  });

  it("authenticated 는 쓰기 · truncate · references · trigger 를 잃고 select 만 남는다", () => {
    const revoke = CODE.match(/revoke insert, update, delete, truncate, references, trigger on table([^;]*)from authenticated;/)?.[1] ?? "";
    const grant = CODE.match(/grant select on table([^;]*)to authenticated;/)?.[1] ?? "";
    for (const t of TABLES) {
      expect(revoke, t).toContain(`public.${t}`);
      expect(grant, t).toContain(`public.${t}`);
    }
    expect(CODE).not.toMatch(/grant (insert|update|delete|all)/i);
    expect(CODE).not.toMatch(/service_role/);
  });

  it("쓰기 정책 13개를 if exists 로 지우고, 읽기 정책 · 새 정책은 건드리지 않는다", () => {
    for (const [name, table] of WRITE_POLICIES) {
      expect(CODE, name).toContain(`drop policy if exists "${name}" on public.${table};`);
    }
    expect([...CODE.matchAll(/drop policy/g)].length).toBe(WRITE_POLICIES.length);
    expect(CODE).not.toMatch(/can read|own rows|create policy|alter policy/);
  });

  it("파일 전체가 한 거래(begin; … commit;)", () => {
    const body = CODE.trim();
    expect(body.startsWith("begin;")).toBe(true);
    expect(body.endsWith("commit;")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 실제 역할로 — PGlite
// ─────────────────────────────────────────────────────────────────────────────

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
};

const ORG = "00000000-0000-4000-8000-00000000000a";
const ME = "00000000-0000-4000-8000-000000000001";
const POST = "10000000-0000-4000-8000-000000000001";
const COMMENT = "10000000-0000-4000-8000-000000000002";
const BUG = "10000000-0000-4000-8000-000000000003";

/** 적용 전 운영과 같은 모양 — 표 단위 쓰기 grant + 쓰기 정책(조건은 줄였다: 이 검사는 권한을 본다). */
const SCHEMA = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema public, auth to anon, authenticated, service_role;

  create table public.board_posts (id uuid primary key, organization_id uuid not null, created_by_user_id uuid not null,
    content text not null, is_pinned boolean not null default false, deleted_at timestamptz);
  create table public.board_post_reads (post_id uuid not null, user_id uuid not null, primary key (post_id, user_id));
  create table public.board_comments (id uuid primary key, post_id uuid not null, organization_id uuid not null,
    created_by_user_id uuid not null, content text not null, deleted_at timestamptz);
  create table public.board_reactions (post_id uuid not null, user_id uuid not null, emoji text not null, primary key (post_id, user_id, emoji));
  create table public.bug_reports (id uuid primary key, organization_id uuid not null, reported_by_user_id uuid not null,
    title text not null, status text not null default 'submitted');

  alter table public.board_posts enable row level security;
  alter table public.board_post_reads enable row level security;
  alter table public.board_comments enable row level security;
  alter table public.board_reactions enable row level security;
  alter table public.bug_reports enable row level security;

  create policy "board posts: active members can read" on public.board_posts for select using (deleted_at is null);
  create policy "board posts: active members can create" on public.board_posts for insert with check (created_by_user_id = auth.uid());
  create policy "board posts: authors and admins can update" on public.board_posts for update using (created_by_user_id = auth.uid());
  create policy "board posts: authors and admins can delete" on public.board_posts for delete using (created_by_user_id = auth.uid());
  create policy "board reads: own rows" on public.board_post_reads for select using (user_id = auth.uid());
  create policy "board reads: insert own" on public.board_post_reads for insert with check (user_id = auth.uid());
  create policy "board reads: upsert own" on public.board_post_reads for update using (user_id = auth.uid());
  create policy "board comments: active members can read" on public.board_comments for select using (deleted_at is null);
  create policy "board comments: active members can create" on public.board_comments for insert with check (created_by_user_id = auth.uid());
  create policy "board comments: authors and admins can delete" on public.board_comments for delete using (created_by_user_id = auth.uid());
  create policy "board reactions: active members can read" on public.board_reactions for select using (true);
  create policy "board reactions: users can insert own" on public.board_reactions for insert with check (user_id = auth.uid());
  create policy "board reactions: users can delete own" on public.board_reactions for delete using (user_id = auth.uid());
  create policy "bug reports: reporter or reviewer can read" on public.bug_reports for select using (reported_by_user_id = auth.uid());
  create policy "bug reports: active members can create" on public.bug_reports for insert with check (reported_by_user_id = auth.uid());
  create policy "bug reports: author can update while submitted" on public.bug_reports for update using (reported_by_user_id = auth.uid() and status = 'submitted');
  create policy "bug reports: reviewer can update status" on public.bug_reports for update using (true);
  create policy "bug reports: author can delete while submitted" on public.bug_reports for delete using (reported_by_user_id = auth.uid() and status = 'submitted');

  grant all on all tables in schema public to anon, authenticated, service_role;

  insert into public.board_posts values ('${POST}', '${ORG}', '${ME}', 'hello', false, null);
  insert into public.board_post_reads values ('${POST}', '${ME}');
  insert into public.board_comments values ('${COMMENT}', '${POST}', '${ORG}', '${ME}', 'c', null);
  insert into public.board_reactions values ('${POST}', '${ME}', '👍');
  insert into public.bug_reports values ('${BUG}', '${ORG}', '${ME}', 'bug', 'submitted');
`;

async function asRole<T>(db: Db, role: "anon" | "authenticated" | "service_role", uid: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}

async function errorCode(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

/** 작성자 본인이 자기 행에 하는 쓰기 — 적용 전에는 정책이 모두 통과시켰다. */
const OWN_WRITES = [
  `insert into public.board_posts values (gen_random_uuid(), '${ORG}', '${ME}', 'x', true, null)`,
  `update public.board_posts set is_pinned = true where id = '${POST}'`,
  `delete from public.board_posts where id = '${POST}'`,
  `insert into public.board_comments values (gen_random_uuid(), '${POST}', '${ORG}', '${ME}', 'x', null)`,
  `delete from public.board_comments where id = '${COMMENT}'`,
  `insert into public.board_reactions values ('${POST}', '${ME}', '❤️')`,
  `delete from public.board_reactions where post_id = '${POST}'`,
  `insert into public.board_post_reads values (gen_random_uuid(), '${ME}')`,
  `update public.board_post_reads set post_id = post_id`,
  `insert into public.bug_reports values (gen_random_uuid(), '${ORG}', '${ME}', 'x', 'closed')`,
  `update public.bug_reports set status = 'closed' where id = '${BUG}'`,
  `delete from public.bug_reports where id = '${BUG}'`,
  `truncate public.board_reactions`,
];

describe("게시판 · 버그 신고 직접 쓰기 회수 — PGlite(실제 역할)", () => {
  it.runIf(!PGLITE_DIR)("FOLDY_PGLITE_DIR 없음 — DB 검사를 건너뛴 것을 출력에 남긴다", () => {
    process.stderr.write("[board-bug-write-revoke] FOLDY_PGLITE_DIR 가 없어 DB 검사를 건너뜁니다 — 파일 머리 주석의 설치 방법을 보세요.\n");
  });
});

describe.skipIf(!PGLITE_DIR)("게시판 · 버그 신고 직접 쓰기 회수 — PGlite(실제 역할)", () => {
  let db: Db;
  let beforeCodes: { sql: string; code: string | null }[] = [];

  beforeAll(async () => {
    const base = join(PGLITE_DIR!, "node_modules/@electric-sql/pglite/dist");
    const { PGlite } = await import(pathToFileURL(join(base, "index.js")).href);
    db = new PGlite() as Db;
    await db.exec(SCHEMA);
    // 적용 전 빈틈을 먼저 재현해 둔다 — 그 뒤 마이그레이션 적용. 테스트 순서와 상관없이 아래 검사는 모두 「적용 뒤」 상태를 본다.
    beforeCodes = [];
    for (const sql of OWN_WRITES.slice(0, 12)) {
      const code = await asRole(db, "authenticated", ME, async () => {
        await db.exec("begin");
        try {
          return await errorCode(() => db.query(sql));
        } finally {
          await db.exec("rollback");
        }
      });
      beforeCodes.push({ sql, code });
    }
    await db.exec(SQL);
    await db.exec(SQL); // 두 번 돌려도 같은 결과(멱등).
  }, 60_000);

  it("앞의 빈틈 재현 — 적용 전에는 본인이 PostgREST 로 바로 쓸 수 있었다(거래 안에서 되돌림)", () => {
    expect(beforeCodes).toHaveLength(12);
    for (const r of beforeCodes) expect(r).toEqual({ sql: r.sql, code: null });
  });

  it("authenticated — insert · update · delete · truncate 는 권한 없음(42501)", async () => {
    for (const sql of OWN_WRITES) {
      expect({ sql, code: await asRole(db, "authenticated", ME, () => errorCode(() => db.query(sql))) }).toEqual({ sql, code: "42501" });
    }
  });

  it("authenticated — select 는 되고 RLS 로 거른다", async () => {
    for (const t of TABLES) {
      const rows = await asRole(db, "authenticated", ME, async () => (await db.query(`select 1 from public.${t}`)).rows.length);
      expect({ t, rows }).toEqual({ t, rows: 1 });
    }
    const other = await asRole(db, "authenticated", "00000000-0000-4000-8000-000000000099", async () => (await db.query("select 1 from public.bug_reports")).rows.length);
    expect(other).toBe(0);
  });

  it("anon — 읽기 · 쓰기 모두 권한 없음(42501)", async () => {
    for (const t of TABLES) {
      expect({ t, code: await asRole(db, "anon", null, () => errorCode(() => db.query(`select 1 from public.${t}`))) }).toEqual({ t, code: "42501" });
    }
    expect(await asRole(db, "anon", null, () => errorCode(() => db.query(`delete from public.board_posts`)))).toBe("42501");
  });

  it("읽기 정책은 남고 쓰기 정책은 모두 사라진다", async () => {
    const { rows } = await db.query<{ policyname: string; cmd: string }>(
      "select policyname, cmd from pg_policies where schemaname = 'public' order by policyname",
    );
    expect(new Set(rows.map((r) => r.cmd))).toEqual(new Set(["SELECT"]));
    expect(rows.length).toBe(5);
  });

  it("service_role — 그대로 읽고 쓴다(서버 액션 경로)", async () => {
    const code = await asRole(db, "service_role", null, () =>
      errorCode(async () => {
        await db.query(`update public.board_posts set deleted_at = now() where id = '${POST}'`);
        await db.query(`insert into public.board_post_reads values ('${POST}', gen_random_uuid())`);
        await db.query(`update public.bug_reports set status = 'closed' where id = '${BUG}'`);
        await db.query(`delete from public.board_reactions where post_id = '${POST}'`);
      }),
    );
    expect(code).toBeNull();
  });
});
