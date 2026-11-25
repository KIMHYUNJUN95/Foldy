import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 할 일 · 프로젝트 직접 읽기 보강(2026-11-25, 202611250001) — 마이그레이션 정적 확인 + 실제 역할로 읽기 · 쓰기.
 * 문서: docs/engineering/05-rls-permissions.md 「할 일 · 프로젝트 직접 읽기 보강(2026-11-25)」
 *
 * PGlite 는 이 저장소의 의존성이 아니다 — 설치한 폴더를 `FOLDY_PGLITE_DIR` 로 넘기면 DB 검사가 돈다(없으면 건너뛰고 경고 줄을 남긴다).
 *   mkdir -p /tmp/pg && (cd /tmp/pg && npm i @electric-sql/pglite@0.3.14)
 *   FOLDY_PGLITE_DIR=/tmp/pg npx vitest run src/lib/__tests__/task-project-read-hardening.test.ts
 */

const FILE = "202611250001_task_project_read_hardening.sql";
const SQL = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8");
const CODE = SQL.replace(/--.*$/gm, "");
const PGLITE_DIR = process.env.FOLDY_PGLITE_DIR;

const TABLES = [
  "tasks",
  "task_participants",
  "task_updates",
  "task_occurrence_state",
  "task_occurrence_order",
  "task_report_schedules",
  "projects",
  "project_participants",
  "project_sections",
] as const;

function policyBlock(name: string): string {
  const start = CODE.indexOf(`create policy "${name}"`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return CODE.slice(start, CODE.indexOf(");\n", start));
}

describe("할 일 · 프로젝트 읽기 보강 마이그레이션 — 파일", () => {
  it("anon 은 9개 표 권한을 모두 잃는다", () => {
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
  });

  it("tasks 읽기 정책 · deleted_at 은 건드리지 않는다(실시간 삭제 신호 · loadTaskScope 가 지운 행을 읽음)", () => {
    expect(CODE).not.toMatch(/policy "[^"]+" on public\.tasks\b/);
    expect(CODE).not.toContain("deleted_at");
  });

  it("쓰기 정책은 새로 만들지 않는다(읽기 정책만)", () => {
    const creates = [...CODE.matchAll(/create policy "[^"]+" on public\.\w+\s+for (\w+)/g)].map((m) => m[1]);
    expect(creates.length).toBe(5);
    expect(new Set(creates)).toEqual(new Set(["select"]));
  });

  it("모든 새 정책은 같은 이름으로 먼저 지우고(두 번 돌려도 같음) authenticated 에만 건다", () => {
    for (const m of CODE.matchAll(/create policy "([^"]+)" on (public\.\w+)\s+for select to authenticated/g)) {
      expect(CODE, m[1]).toContain(`drop policy if exists "${m[1]}" on ${m[2]};`);
    }
    expect([...CODE.matchAll(/for select to authenticated/g)].length).toBe(5);
  });

  it("참여자 명단 · 기록 — 참여자 조건은 그대로 두고 부모 할 일 조직의 활성 멤버를 더한다", () => {
    for (const [name, table] of [
      ["participants can read participant rows", "task_participants"],
      ["participants can read task updates", "task_updates"],
    ] as const) {
      const block = policyBlock(name);
      expect(block).toContain("public.is_task_participant(task_id)");
      expect(block).toContain(`where t.id = ${table}.task_id`);
      expect(block).toContain("t.organization_id = any ((select public.current_user_active_organization_ids())::uuid[])");
      expect(block).toContain("(select public.is_platform_admin())");
      expect(block).toContain("(select auth.uid()) is not null");
      expect(block).not.toContain("is_project_participant");
    }
  });

  it("프로젝트 멤버 · 섹션 — 프로젝트 조직의 활성 멤버를 더한다", () => {
    for (const [name, table] of [
      ["participants can read project participant rows", "project_participants"],
      ["participants can read project sections", "project_sections"],
    ] as const) {
      const block = policyBlock(name);
      expect(block).toContain("public.is_project_participant(project_id)");
      expect(block).toContain(`where p.id = ${table}.project_id`);
      expect(block).toContain("p.organization_id = any ((select public.current_user_active_organization_ids())::uuid[])");
    }
  });

  it("업무일지 예약 — 본인 + 활성 멤버", () => {
    const block = policyBlock("task report schedules: read own");
    expect(block).toContain("user_id = (select auth.uid())");
    expect(block).toContain("organization_id = any ((select public.current_user_active_organization_ids())::uuid[])");
  });

  it("파일 전체가 한 거래(begin; … commit;) — 반쯤 적용되지 않는다", () => {
    const body = CODE.trim();
    expect(body.startsWith("begin;")).toBe(true);
    expect(body.endsWith("commit;")).toBe(true);
    expect([...body.matchAll(/^(begin|commit);$/gm)].length).toBe(2);
  });

  it("정책 안의 인자 없는 함수는 (select …) 로 감싼다", () => {
    expect(CODE).not.toMatch(/(?<!select )auth\.uid\(\)/);
    expect(CODE).not.toMatch(/(?<!select public\.)is_platform_admin\(\)/);
    expect(CODE).not.toMatch(/(?<!select public\.)current_user_active_organization_ids\(\)/);
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
const OTHER_ORG = "00000000-0000-4000-8000-00000000000b";
const U = {
  active: "00000000-0000-4000-8000-000000000001", // 활성 멤버 · T1 작성자 · P1 멤버 · T_DEL 참여자
  left: "00000000-0000-4000-8000-000000000002", // 조직에서 나감(inactive) — T1 · P1 참여자 행이 남아 있음
  pm: "00000000-0000-4000-8000-000000000003", // 활성 멤버 · P1 멤버, T2 참여자는 아님
  outsider: "00000000-0000-4000-8000-000000000004", // 활성 멤버, 아무 데도 참여 안 함
  admin: "00000000-0000-4000-8000-000000000005", // 플랫폼 관리자(멤버십 없음)
  other: "00000000-0000-4000-8000-000000000006", // 다른 조직 활성 멤버
  dual: "00000000-0000-4000-8000-000000000007", // 두 조직 모두 활성 — T1 · T_OTHER · P1 참여, 예약 두 조직에 하나씩
  moved: "00000000-0000-4000-8000-000000000008", // 조직을 옮김(ORG inactive · OTHER_ORG active) — dual 과 같은 참여
  adminOff: "00000000-0000-4000-8000-000000000009", // 꺼진 플랫폼 관리자(is_active = false, 멤버십 없음)
};
const T1 = "20000000-0000-4000-8000-000000000001";
const T2 = "20000000-0000-4000-8000-000000000002"; // 프로젝트 P1 의 할 일, 작성자 active
const T_DEL = "20000000-0000-4000-8000-000000000003"; // 소프트 삭제
const T_OTHER = "20000000-0000-4000-8000-000000000004"; // 다른 조직
const P1 = "30000000-0000-4000-8000-000000000001";

/** 적용 전 운영과 같은 모양(202609040001 · 202609080001 · 202610200005 · 202610160003 치환 뒤의 뜻). 쓰기 권한은 일부러 열어 둔 최악의 경우. */
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

  create table public.memberships (user_id uuid, organization_id uuid, status text);
  -- 202605090001 과 같은 모양: is_active 가 꺼진 관리자는 관리자가 아니다.
  create table public.platform_admins (user_id uuid, is_active boolean not null default true);
  create or replace function public.is_platform_admin() returns boolean language sql stable security definer set search_path = public as
    $f$ select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true) $f$;
  create or replace function public.current_user_active_organization_ids() returns uuid[] language sql stable security definer set search_path = public as
    $f$ select coalesce(array_agg(m.organization_id), '{}'::uuid[]) from public.memberships m where m.user_id = auth.uid() and m.status = 'active' $f$;

  create table public.projects (id uuid primary key, organization_id uuid not null, title text);
  create table public.project_participants (id serial primary key, project_id uuid not null, user_id uuid not null);
  create table public.project_sections (id serial primary key, project_id uuid not null, title text);
  create table public.tasks (id uuid primary key, organization_id uuid not null, created_by_user_id uuid, project_id uuid, title text, deleted_at timestamptz);
  create table public.task_participants (id serial primary key, task_id uuid not null, user_id uuid not null, role text);
  create table public.task_updates (id serial primary key, task_id uuid not null, created_by_user_id uuid, update_type text, body text);
  create table public.task_occurrence_state (id serial primary key, organization_id uuid not null, task_id uuid not null);
  create table public.task_occurrence_order (id serial primary key, organization_id uuid not null, task_id uuid not null);
  create table public.task_report_schedules (id serial primary key, organization_id uuid not null, user_id uuid not null);

  create or replace function public.is_task_participant(target_task_id uuid) returns boolean language sql stable security definer set search_path = public as
    $f$ select exists (select 1 from public.task_participants tp where tp.task_id = target_task_id and tp.user_id = auth.uid()) $f$;
  create or replace function public.is_project_participant(target_project_id uuid) returns boolean language sql stable security definer set search_path = public as
    $f$ select exists (select 1 from public.project_participants pp where pp.project_id = target_project_id and pp.user_id = auth.uid()) $f$;

  alter table public.projects enable row level security;
  alter table public.project_participants enable row level security;
  alter table public.project_sections enable row level security;
  alter table public.tasks enable row level security;
  alter table public.task_participants enable row level security;
  alter table public.task_updates enable row level security;
  alter table public.task_occurrence_state enable row level security;
  alter table public.task_occurrence_order enable row level security;
  alter table public.task_report_schedules enable row level security;

  create policy "participants can read tasks" on public.tasks for select using (
    (select auth.uid()) is not null and ((select is_platform_admin()) or (
      organization_id = any ((select current_user_active_organization_ids())::uuid[])
      and (is_task_participant(id) or (project_id is not null and is_project_participant(project_id))))));
  create policy "author can create own task" on public.tasks for insert with check (
    (select auth.uid()) is not null and created_by_user_id = (select auth.uid())
    and organization_id = any ((select current_user_active_organization_ids())::uuid[]));
  create policy "participants can read participant rows" on public.task_participants for select using (
    (select auth.uid()) is not null and ((select is_platform_admin()) or is_task_participant(task_id)));
  create policy "participants can read task updates" on public.task_updates for select using (
    (select auth.uid()) is not null and ((select is_platform_admin()) or is_task_participant(task_id)));
  create policy "participants can add notes" on public.task_updates for insert with check (
    (select auth.uid()) is not null and created_by_user_id = (select auth.uid()) and is_task_participant(task_id));
  create policy "participants can read occurrence state" on public.task_occurrence_state for select using (
    (select auth.uid()) is not null and ((select is_platform_admin()) or (
      organization_id = any ((select current_user_active_organization_ids())::uuid[]) and is_task_participant(task_id))));
  create policy "participants can read occurrence order" on public.task_occurrence_order for select using (
    (select auth.uid()) is not null and ((select is_platform_admin()) or (
      organization_id = any ((select current_user_active_organization_ids())::uuid[]) and is_task_participant(task_id))));
  create policy "participants can read projects" on public.projects for select using (
    (select auth.uid()) is not null and ((select is_platform_admin()) or (
      organization_id = any ((select current_user_active_organization_ids())::uuid[]) and is_project_participant(id))));
  create policy "participants can read project participant rows" on public.project_participants for select using (
    (select auth.uid()) is not null and ((select is_platform_admin()) or is_project_participant(project_id)));
  create policy "participants can read project sections" on public.project_sections for select using (
    (select auth.uid()) is not null and ((select is_platform_admin()) or is_project_participant(project_id)));
  create policy "task report schedules: read own" on public.task_report_schedules for select to authenticated using (
    (select auth.uid()) = user_id);

  grant all on all tables in schema public to anon, authenticated, service_role;
  grant usage on all sequences in schema public to anon, authenticated, service_role;

  insert into public.memberships values
    ('${U.active}', '${ORG}', 'active'), ('${U.left}', '${ORG}', 'inactive'), ('${U.pm}', '${ORG}', 'active'),
    ('${U.outsider}', '${ORG}', 'active'), ('${U.other}', '${OTHER_ORG}', 'active'),
    ('${U.dual}', '${ORG}', 'active'), ('${U.dual}', '${OTHER_ORG}', 'active'),
    ('${U.moved}', '${ORG}', 'inactive'), ('${U.moved}', '${OTHER_ORG}', 'active');
  insert into public.platform_admins values ('${U.admin}', true), ('${U.adminOff}', false);
  insert into public.projects values ('${P1}', '${ORG}', 'P1');
  insert into public.project_participants (project_id, user_id) values ('${P1}', '${U.active}'), ('${P1}', '${U.left}'), ('${P1}', '${U.pm}'),
    ('${P1}', '${U.dual}'), ('${P1}', '${U.moved}');
  insert into public.project_sections (project_id, title) values ('${P1}', 'S1');
  insert into public.tasks values
    ('${T1}', '${ORG}', '${U.active}', null, 'T1', null),
    ('${T2}', '${ORG}', '${U.active}', '${P1}', 'T2', null),
    ('${T_DEL}', '${ORG}', '${U.active}', null, 'T_DEL', now()),
    ('${T_OTHER}', '${OTHER_ORG}', '${U.other}', null, 'T_OTHER', null);
  insert into public.task_participants (task_id, user_id, role) values
    ('${T1}', '${U.active}', 'author'), ('${T1}', '${U.left}', 'participant'),
    ('${T2}', '${U.active}', 'author'), ('${T_DEL}', '${U.active}', 'author'), ('${T_OTHER}', '${U.other}', 'author'),
    ('${T1}', '${U.dual}', 'participant'), ('${T_OTHER}', '${U.dual}', 'participant'),
    ('${T1}', '${U.moved}', 'participant'), ('${T_OTHER}', '${U.moved}', 'participant');
  insert into public.task_updates (task_id, created_by_user_id, update_type, body) values
    ('${T1}', '${U.active}', 'note', 'memo'), ('${T1}', '${U.left}', 'completed', null),
    ('${T2}', '${U.active}', 'completed', null), ('${T_DEL}', '${U.active}', 'note', 'gone'),
    ('${T_OTHER}', '${U.other}', 'note', 'x');
  insert into public.task_occurrence_state (organization_id, task_id) values ('${ORG}', '${T1}'), ('${ORG}', '${T2}');
  insert into public.task_occurrence_order (organization_id, task_id) values ('${ORG}', '${T1}');
  insert into public.task_report_schedules (organization_id, user_id) values ('${ORG}', '${U.active}'), ('${ORG}', '${U.left}'), ('${OTHER_ORG}', '${U.other}'),
    ('${ORG}', '${U.dual}'), ('${OTHER_ORG}', '${U.dual}'), ('${ORG}', '${U.moved}'), ('${OTHER_ORG}', '${U.moved}');
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

async function count(db: Db, table: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
  return rows[0].n;
}

/** 사용자 → 표 → 보이는 행 수 */
async function visibility(db: Db): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [name, uid] of Object.entries(U)) {
    out[name] = {};
    for (const t of TABLES) out[name][t] = await asRole(db, "authenticated", uid, () => count(db, t));
  }
  return out;
}

async function errorCode(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

describe("할 일 · 프로젝트 읽기 보강 — PGlite(실제 역할)", () => {
  it.runIf(!PGLITE_DIR)("FOLDY_PGLITE_DIR 없음 — DB 검사를 건너뛴 것을 출력에 남긴다", () => {
    process.stderr.write("[task-project-read-hardening] FOLDY_PGLITE_DIR 가 없어 DB 검사를 건너뜁니다 — 파일 머리 주석의 설치 방법을 보세요.\n");
  });
});

describe.skipIf(!PGLITE_DIR)("할 일 · 프로젝트 읽기 보강 — PGlite(실제 역할)", () => {
  let db: Db;
  let before: Record<string, Record<string, number>>;
  let after: Record<string, Record<string, number>>;

  beforeAll(async () => {
    const base = join(PGLITE_DIR!, "node_modules/@electric-sql/pglite/dist");
    const { PGlite } = await import(pathToFileURL(join(base, "index.js")).href);
    db = new PGlite() as Db;
    await db.exec(SCHEMA);
    before = await visibility(db);
    await db.exec(SQL);
    await db.exec(SQL); // 두 번 돌려도 같은 결과(멱등).
    after = await visibility(db);
  }, 60_000);

  it("활성 멤버 · 플랫폼 관리자 · 다른 조직 사람에게 보이는 행은 표마다 그대로다", () => {
    for (const name of ["active", "pm", "outsider", "admin", "other", "dual", "adminOff"]) expect({ name, ...after[name] }).toEqual({ name, ...before[name] });
  });

  it("앞의 빈틈 재현 — 조직에서 나간 사람은 참여자 명단 · 기록 · 프로젝트 멤버 · 섹션 · 예약을 읽을 수 있었다", () => {
    expect(before.left).toMatchObject({ tasks: 0, task_participants: 4, task_updates: 2, project_participants: 5, project_sections: 1, task_report_schedules: 1 });
    // 조직을 옮긴 사람도 앞 조직 것을 읽었다(T1 참여자 4 + T_OTHER 참여자 3, 기록 2 + 1, 프로젝트 멤버 5, 예약 2).
    expect(before.moved).toMatchObject({ tasks: 1, task_participants: 7, task_updates: 3, project_participants: 5, project_sections: 1, task_report_schedules: 2 });
  });

  it("조직에서 나간 사람은 이제 아무것도 못 읽는다", () => {
    for (const t of TABLES) expect({ t, n: after.left[t] }).toEqual({ t, n: 0 });
  });

  it("두 조직에 모두 활성인 사람 — 두 조직 것이 다 보인다(T1 · T_OTHER + 프로젝트 할 일 T2)", () => {
    expect(after.dual).toMatchObject({
      tasks: 3, task_participants: 7, task_updates: 3, task_occurrence_state: 1, task_occurrence_order: 1,
      projects: 1, project_participants: 5, project_sections: 1, task_report_schedules: 2,
    });
  });

  it("조직을 옮긴 사람 — 앞 조직 것은 0, 새 조직 것만 보인다", async () => {
    expect(after.moved).toMatchObject({
      tasks: 1, task_participants: 3, task_updates: 1, task_occurrence_state: 0, task_occurrence_order: 0,
      projects: 0, project_participants: 0, project_sections: 0, task_report_schedules: 1,
    });
    const orgs = await asRole(db, "authenticated", U.moved, async () => ({
      tasks: (await db.query<{ o: string }>("select distinct organization_id::text as o from public.tasks")).rows.map((r) => r.o),
      schedules: (await db.query<{ o: string }>("select distinct organization_id::text as o from public.task_report_schedules")).rows.map((r) => r.o),
      updates: (await db.query<{ t: string }>("select distinct task_id::text as t from public.task_updates")).rows.map((r) => r.t),
    }));
    expect(orgs).toEqual({ tasks: [OTHER_ORG], schedules: [OTHER_ORG], updates: [T_OTHER] });
  });

  it("꺼진 플랫폼 관리자는 아무것도 못 본다(켜진 관리자는 전부)", () => {
    for (const t of TABLES) expect({ t, n: after.adminOff[t] }).toEqual({ t, n: 0 });
    expect(after.admin.tasks).toBe(4);
    expect(after.admin.task_updates).toBe(5); // 예약은 본인 것만이라 관리자도 0(예전과 같음)
  });

  it("지운 할 일은 참여자에게 계속 보인다(실시간 삭제 신호 · 가시 범위 계산용 — 일부러 그대로)", async () => {
    const titles = await asRole(db, "authenticated", U.active, async () => (await db.query<{ title: string }>("select title from public.tasks order by title")).rows.map((r) => r.title));
    expect(titles).toEqual(["T1", "T2", "T_DEL"]);
    const memo = await asRole(db, "authenticated", U.active, () => db.query("select 1 from public.task_updates where body = 'gone'"));
    expect(memo.rows.length).toBe(1);
  });

  it("프로젝트 멤버는 프로젝트 할 일을 보지만 남의 할 일 기록 · 참여자 명단은 예전처럼 못 본다(권한 규칙 그대로)", () => {
    expect(after.pm).toMatchObject({ tasks: 1, task_updates: 0, task_participants: 0, project_participants: 5, project_sections: 1 });
  });

  it("anon — 읽기 · 쓰기 모두 권한 없음(42501)", async () => {
    for (const t of TABLES) {
      expect({ t, code: await asRole(db, "anon", null, () => errorCode(() => db.query(`select 1 from public.${t}`))) }).toEqual({ t, code: "42501" });
    }
    const code = await asRole(db, "anon", null, () => errorCode(() => db.query(`delete from public.tasks`)));
    expect(code).toBe("42501");
  });

  it("authenticated — insert · update · delete · truncate 는 권한 없음(42501), select 는 됨", async () => {
    const attempts = [
      `insert into public.tasks (id, organization_id, created_by_user_id, title) values (gen_random_uuid(), '${ORG}', '${U.active}', 'x')`,
      `insert into public.task_updates (task_id, created_by_user_id, update_type) values ('${T1}', '${U.active}', 'completed')`,
      `update public.tasks set deleted_at = null where id = '${T_DEL}'`,
      `delete from public.task_participants where task_id = '${T1}'`,
      `insert into public.project_participants (project_id, user_id) values ('${P1}', '${U.outsider}')`,
      `update public.task_report_schedules set user_id = '${U.active}'`,
      `truncate public.task_updates`,
    ];
    for (const sql of attempts) {
      expect({ sql, code: await asRole(db, "authenticated", U.active, () => errorCode(() => db.query(sql))) }).toEqual({ sql, code: "42501" });
    }
    expect(await asRole(db, "authenticated", U.active, () => errorCode(() => db.query("select 1 from public.tasks")))).toBeNull();
  });

  it("service_role — 모든 행을 읽고 쓴다(서버 액션 · 되살리기 경로)", async () => {
    const n = await asRole(db, "service_role", null, () => count(db, "tasks"));
    expect(n).toBe(4);
    const code = await asRole(db, "service_role", null, () =>
      errorCode(async () => {
        await db.query(`update public.tasks set deleted_at = null where id = '${T_DEL}'`);
        await db.query(`update public.tasks set deleted_at = now() where id = '${T_DEL}'`);
      }),
    );
    expect(code).toBeNull();
  });
});
