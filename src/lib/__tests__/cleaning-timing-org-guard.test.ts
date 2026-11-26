import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 청소 시각 서버 고정 + organization_id 잠금(2026-11-26, 202611260003) — 마이그레이션 정적 확인 + 실제 역할로 쓰기.
 * 문서: docs/engineering/05-rls-permissions.md 「청소 시각 서버 고정 · organization_id 잠금(2026-11-26)」
 *
 * PGlite 는 이 저장소의 의존성이 아니다 — 설치한 폴더를 `FOLDY_PGLITE_DIR` 로 넘기면 DB 검사가 돈다(없으면 건너뛰고 경고 줄을 남긴다).
 *   mkdir -p /tmp/pg && (cd /tmp/pg && npm i @electric-sql/pglite@0.3.14)
 *   FOLDY_PGLITE_DIR=/tmp/pg npx vitest run src/lib/__tests__/cleaning-timing-org-guard.test.ts
 */

const FILE = "202611260003_cleaning_timing_guard_and_org_id_locks.sql";
const SQL = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8");
const CODE = SQL.replace(/--.*$/gm, "");
const ADMIN_GUARD = readFileSync(
  join(process.cwd(), "supabase/migrations/202611250003_cleaning_sessions_admin_complete_snapshot.sql"),
  "utf8",
).replace(/--.*$/gm, "");
const PGLITE_DIR = process.env.FOLDY_PGLITE_DIR;

const ORG_TABLES = [
  "announcements",
  "cleaning_sessions",
  "tasks",
  "guest_conversations",
  "guest_message_channel_state",
  "property_operation_infos",
  "reservation_internal_notes",
] as const;

const ALLOWLIST = /if current_user in \('service_role', 'postgres', 'supabase_admin'\) then\s+return new;/;

describe("청소 시각 · organization_id 잠금 — 파일", () => {
  it("허용 목록이 202611250003 가드와 같다", () => {
    expect(ADMIN_GUARD).toMatch(ALLOWLIST);
    expect(CODE).toMatch(ALLOWLIST);
  });

  it("시각 가드는 insert · update 모두, 함수는 SECURITY DEFINER 가 아니고 실행 권한을 회수한다", () => {
    expect(CODE).toContain("drop trigger if exists cleaning_sessions_timing_guard on public.cleaning_sessions;");
    expect(CODE).toMatch(/create trigger cleaning_sessions_timing_guard\s+before insert or update on public\.cleaning_sessions/);
    expect(CODE).not.toMatch(/security definer/i);
    expect(CODE).toContain("set search_path = ''");
    expect(CODE).toContain("revoke all on function public.enforce_cleaning_session_timing() from public, anon, authenticated;");
  });

  it("표 7개에 forbid_organization_id_change 를 before update of organization_id 로 붙인다", () => {
    for (const t of ORG_TABLES) {
      expect(CODE, t).toContain(`drop trigger if exists ${t}_forbid_org_change on public.${t};`);
      expect(CODE, t).toMatch(
        new RegExp(`create trigger ${t}_forbid_org_change\\s+before update of organization_id on public\\.${t}\\s+for each row execute function public\\.forbid_organization_id_change\\(\\);`),
      );
    }
    // 기존 함수를 다시 만들지 않는다(202610280002 그대로).
    expect(CODE).not.toMatch(/create or replace function public\.forbid_organization_id_change/);
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
const ORG2 = "00000000-0000-4000-8000-00000000000b";
const ME = "00000000-0000-4000-8000-000000000001";

/** 운영과 같은 모양 — 표 단위 grant + 청소 기록 RLS(202610210007 의 상태 · 담당자 조건, 권한 함수는 뺐다). */
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

  create type public.cleaning_status as enum ('in_progress', 'completed', 'cancelled');
  create table public.cleaning_sessions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    staff_user_id uuid not null,
    room_label text not null default 'A 101',
    room_key text default 'a-101',
    task_label text not null default 'checkout',
    closed_without_cleaning boolean not null default false,
    status public.cleaning_status not null default 'in_progress',
    cleaning_date date not null,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    duration_seconds integer,
    notes text,
    check (
      (status = 'in_progress' and completed_at is null and duration_seconds is null)
      or (status in ('completed', 'cancelled') and completed_at is not null and duration_seconds is not null)
    )
  );
  alter table public.cleaning_sessions enable row level security;
  create policy "members can read relevant cleaning sessions" on public.cleaning_sessions for select
    using (staff_user_id = auth.uid());
  create policy "field members can start own cleaning sessions" on public.cleaning_sessions for insert
    with check (staff_user_id = auth.uid() and status = 'in_progress' and completed_at is null and duration_seconds is null);
  create policy "staff can complete own active cleaning sessions" on public.cleaning_sessions for update
    using (staff_user_id = auth.uid() and status = 'in_progress')
    with check (staff_user_id = auth.uid() and status in ('completed', 'cancelled') and completed_at is not null and duration_seconds is not null);

  create table public.announcements (id uuid primary key default gen_random_uuid(), organization_id uuid not null, title text);
  create table public.tasks (id uuid primary key default gen_random_uuid(), organization_id uuid not null, title text);
  create table public.guest_conversations (id uuid primary key default gen_random_uuid(), organization_id uuid not null, title text);
  create table public.guest_message_channel_state (organization_id uuid primary key, title text);
  create table public.property_operation_infos (id uuid primary key default gen_random_uuid(), organization_id uuid not null, title text);
  create table public.reservation_internal_notes (id uuid primary key default gen_random_uuid(), organization_id uuid not null, title text);

  -- 202610280002 그대로
  create or replace function public.forbid_organization_id_change()
  returns trigger language plpgsql set search_path to 'public' as $function$
  begin
    if new.organization_id is distinct from old.organization_id then
      raise exception 'organization_id cannot be changed' using errcode = '42501';
    end if;
    return new;
  end;
  $function$;

  grant all on all tables in schema public to anon, authenticated, service_role;

  insert into public.announcements (organization_id, title) values ('${ORG}', 'x');
  insert into public.tasks (organization_id, title) values ('${ORG}', 'x');
  insert into public.guest_conversations (organization_id, title) values ('${ORG}', 'x');
  insert into public.guest_message_channel_state (organization_id, title) values ('${ORG}', 'x');
  insert into public.property_operation_infos (organization_id, title) values ('${ORG}', 'x');
  insert into public.reservation_internal_notes (organization_id, title) values ('${ORG}', 'x');
`;

const TODAY = "(now() at time zone 'Asia/Tokyo')::date";

async function asRole<T>(db: Db, role: "authenticated" | "service_role", uid: string | null, run: () => Promise<T>): Promise<T> {
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

type Row = { id: string; started_at: string; completed_at: string | null; duration_seconds: number | null; status: string };

/** 서비스 키로 진행 중 기록을 만든다 — 시작 시각 · 날짜를 테스트가 정한다(트리거 통과). */
async function seedActive(db: Db, startedAgo: string, date: string): Promise<string> {
  return asRole(db, "service_role", null, async () => {
    await db.query(`delete from public.cleaning_sessions where staff_user_id = '${ME}' and status = 'in_progress'`);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.cleaning_sessions (organization_id, staff_user_id, cleaning_date, started_at)
       values ('${ORG}', '${ME}', ${date}, now() - interval '${startedAgo}') returning id`,
    );
    return rows[0].id;
  });
}

async function readRow(db: Db, id: string): Promise<Row & { now: string; start_lag: number; end_lag: number }> {
  const { rows } = await db.query<Row & { now: string; start_lag: number; end_lag: number }>(
    `select *, now()::text as now,
       abs(extract(epoch from (now() - started_at)))::float8 as start_lag,
       abs(extract(epoch from (now() - coalesce(completed_at, now()))))::float8 as end_lag
     from public.cleaning_sessions where id = $1`,
    [id],
  );
  return rows[0];
}

describe("청소 시각 · organization_id 잠금 — PGlite(실제 역할)", () => {
  it.runIf(!PGLITE_DIR)("FOLDY_PGLITE_DIR 없음 — DB 검사를 건너뛴 것을 출력에 남긴다", () => {
    process.stderr.write("[cleaning-timing-org-guard] FOLDY_PGLITE_DIR 가 없어 DB 검사를 건너뜁니다 — 파일 머리 주석의 설치 방법을 보세요.\n");
  });
});

describe.skipIf(!PGLITE_DIR)("청소 시각 · organization_id 잠금 — PGlite(실제 역할)", () => {
  let db: Db;
  let before: { backdatedStartKept: boolean; forgedDuration: number | null; orgMoved: boolean };

  beforeAll(async () => {
    const base = join(PGLITE_DIR!, "node_modules/@electric-sql/pglite/dist");
    const { PGlite } = await import(pathToFileURL(join(base, "index.js")).href);
    db = new PGlite() as Db;
    await db.exec(SCHEMA);

    // 적용 전 빈틈 재현 — 작업자가 시작 시각을 앞당기고, 소요를 지어 넣고, 조직을 옮길 수 있었다.
    const started = await asRole(db, "authenticated", ME, async () =>
      (await db.query<{ id: string; started_at: string }>(
        `insert into public.cleaning_sessions (organization_id, staff_user_id, cleaning_date, started_at)
         values ('${ORG}', '${ME}', ${TODAY}, '2000-01-01T00:00:00Z') returning id, started_at`,
      )).rows[0],
    );
    const done = await asRole(db, "authenticated", ME, async () =>
      (await db.query<{ duration_seconds: number }>(
        `update public.cleaning_sessions set status = 'completed', completed_at = now(), duration_seconds = 99999
         where id = '${started.id}' returning duration_seconds`,
      )).rows[0],
    );
    const moved = await asRole(db, "service_role", null, () =>
      errorCode(() => db.query(`update public.tasks set organization_id = '${ORG2}'`)),
    );
    await asRole(db, "service_role", null, () => db.exec(`update public.tasks set organization_id = '${ORG}'; delete from public.cleaning_sessions`));
    before = {
      backdatedStartKept: new Date(started.started_at).getUTCFullYear() === 2000,
      forgedDuration: done?.duration_seconds ?? null,
      orgMoved: moved === null,
    };

    await db.exec(SQL);
    await db.exec(SQL); // 두 번 돌려도 같은 결과(멱등).
  }, 60_000);

  it("앞의 빈틈 재현 — 적용 전에는 시작 시각 · 소요 · 조직을 바꿀 수 있었다", () => {
    expect(before).toEqual({ backdatedStartKept: true, forgedDuration: 99999, orgMoved: true });
  });

  it("작업자 시작(insert) — 보낸 started_at 은 무시하고 now() 로 저장", async () => {
    const row = await asRole(db, "authenticated", ME, async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.cleaning_sessions (organization_id, staff_user_id, cleaning_date, started_at)
         values ('${ORG}', '${ME}', ${TODAY}, '2000-01-01T00:00:00Z') returning id`,
      );
      return readRow(db, rows[0].id);
    });
    expect(row.status).toBe("in_progress");
    expect(row.start_lag).toBeLessThan(5);
  });

  it("작업자 시작(insert) — 정상 흐름처럼 started_at 을 안 보내도 그대로 된다", async () => {
    await asRole(db, "service_role", null, () => db.query(`delete from public.cleaning_sessions`));
    const code = await asRole(db, "authenticated", ME, () =>
      errorCode(() => db.query(`insert into public.cleaning_sessions (organization_id, staff_user_id, cleaning_date) values ('${ORG}', '${ME}', ${TODAY})`)),
    );
    expect(code).toBeNull();
  });

  it("작업자 끝내기(오늘) — 지어 넣은 끝 시각 · 소요 대신 서버가 계산(약 600초)", async () => {
    const id = await seedActive(db, "600 seconds", TODAY);
    const row = await asRole(db, "authenticated", ME, async () => {
      await db.query(
        `update public.cleaning_sessions set status = 'completed', completed_at = '2000-01-01T00:00:00Z', duration_seconds = 99999 where id = $1`,
        [id],
      );
      return readRow(db, id);
    });
    expect(row.status).toBe("completed");
    expect(row.end_lag).toBeLessThan(5);
    expect(row.duration_seconds).toBeGreaterThanOrEqual(599);
    expect(row.duration_seconds).toBeLessThan(610);
  });

  it("작업자 취소(오늘) — 끝 시각 now() · 소요는 시작부터", async () => {
    const id = await seedActive(db, "120 seconds", TODAY);
    const row = await asRole(db, "authenticated", ME, async () => {
      await db.query(`update public.cleaning_sessions set status = 'cancelled', completed_at = now(), duration_seconds = 0 where id = $1`, [id]);
      return readRow(db, id);
    });
    expect(row.status).toBe("cancelled");
    expect(row.duration_seconds).toBeGreaterThanOrEqual(119);
    expect(row.duration_seconds).toBeLessThan(130);
  });

  it("지난 기록 닫기 「청소했어요」 — 끝 = 시작 · 0초(끝낸 시각 모름)", async () => {
    const id = await seedActive(db, "1 day", `${TODAY} - 1`);
    const row = await asRole(db, "authenticated", ME, async () => {
      await db.query(`update public.cleaning_sessions set status = 'completed', completed_at = now(), duration_seconds = 86400 where id = $1`, [id]);
      return readRow(db, id);
    });
    expect(row.status).toBe("completed");
    expect(row.duration_seconds).toBe(0);
    expect(new Date(row.completed_at!).getTime()).toBe(new Date(row.started_at).getTime());
  });

  it("지난 기록 닫기 「못 했어요」 — 끝 = now() · 0초", async () => {
    const id = await seedActive(db, "1 day", `${TODAY} - 1`);
    const row = await asRole(db, "authenticated", ME, async () => {
      await db.query(`update public.cleaning_sessions set status = 'cancelled', completed_at = started_at, duration_seconds = 5 where id = $1`, [id]);
      return readRow(db, id);
    });
    expect(row.status).toBe("cancelled");
    expect(row.duration_seconds).toBe(0);
    expect(row.end_lag).toBeLessThan(5);
  });

  it("작업자가 started_at 을 바꾸면 막는다(42501)", async () => {
    const id = await seedActive(db, "60 seconds", TODAY);
    const code = await asRole(db, "authenticated", ME, () =>
      errorCode(() =>
        db.query(`update public.cleaning_sessions set status = 'completed', started_at = now() - interval '5 hours', completed_at = now(), duration_seconds = 1 where id = $1`, [id]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("작업자가 끝낼 때 주인 · 날짜 · 방 · 종류를 바꾸면 막는다(42501)", async () => {
    const changes = [
      `staff_user_id = '00000000-0000-4000-8000-000000000002'`,
      `cleaning_date = ${TODAY} - 3`,
      `room_label = 'B 202'`,
      `room_key = 'b-202'`,
      `task_label = 'simple'`,
      `closed_without_cleaning = true`,
    ];
    for (const change of changes) {
      const id = await seedActive(db, "60 seconds", TODAY);
      const code = await asRole(db, "authenticated", ME, () =>
        errorCode(() => db.query(`update public.cleaning_sessions set status = 'completed', completed_at = now(), duration_seconds = 1, ${change} where id = $1`, [id])),
      );
      expect({ change, code }).toEqual({ change, code: "42501" });
    }
  });

  it("같은 값을 다시 보내는 끝내기는 그대로 된다(정상 흐름 호환)", async () => {
    const id = await seedActive(db, "60 seconds", TODAY);
    const code = await asRole(db, "authenticated", ME, () =>
      errorCode(() =>
        db.query(
          `update public.cleaning_sessions set status = 'completed', completed_at = now(), duration_seconds = 1, notes = 'ok',
             staff_user_id = staff_user_id, cleaning_date = cleaning_date, room_label = room_label, room_key = room_key,
             task_label = task_label, closed_without_cleaning = closed_without_cleaning where id = $1`,
          [id],
        ),
      ),
    );
    expect(code).toBeNull();
  });

  it("service_role 은 주인 · 날짜 · 방을 바꿀 수 있다(관리자 강제 완료)", async () => {
    const id = await seedActive(db, "60 seconds", TODAY);
    const code = await asRole(db, "service_role", null, () =>
      errorCode(() => db.query(`update public.cleaning_sessions set room_label = 'B 202', staff_user_id = '00000000-0000-4000-8000-000000000002' where id = $1`, [id])),
    );
    expect(code).toBeNull();
    await asRole(db, "service_role", null, () => db.query(`delete from public.cleaning_sessions where id = $1`, [id]));
  });

  it("작업자가 끝낸 시각 · 소요를 넣어 시작하면 막는다(42501)", async () => {
    await asRole(db, "service_role", null, () => db.query(`delete from public.cleaning_sessions`));
    const code = await asRole(db, "authenticated", ME, () =>
      errorCode(() =>
        db.query(`insert into public.cleaning_sessions (organization_id, staff_user_id, cleaning_date, status, completed_at, duration_seconds)
                  values ('${ORG}', '${ME}', ${TODAY}, 'completed', now(), 99999)`),
      ),
    );
    expect(code).toBe("42501");
  });

  it("service_role(관리자 강제 완료 · 2분 되돌리기) — 정한 값 그대로 저장", async () => {
    const id = await seedActive(db, "60 seconds", TODAY);
    const row = await asRole(db, "service_role", null, async () => {
      await db.query(
        `update public.cleaning_sessions set status = 'completed', started_at = '2026-01-01T01:00:00Z', completed_at = '2026-01-01T02:00:00Z', duration_seconds = 3600 where id = $1`,
        [id],
      );
      await db.query(`update public.cleaning_sessions set status = 'in_progress', completed_at = null, duration_seconds = null where id = $1`, [id]);
      await db.query(
        `update public.cleaning_sessions set status = 'completed', completed_at = '2026-01-01T03:00:00Z', duration_seconds = 7200 where id = $1`,
        [id],
      );
      return readRow(db, id);
    });
    expect(row.duration_seconds).toBe(7200);
    expect(new Date(row.started_at).toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("표 7개 — organization_id 변경은 서비스 키도 막고(42501), 다른 칸 수정은 된다", async () => {
    await asRole(db, "service_role", null, () => seedActive(db, "60 seconds", TODAY));
    for (const t of ORG_TABLES) {
      const code = await asRole(db, "service_role", null, () => errorCode(() => db.query(`update public.${t} set organization_id = '${ORG2}'`)));
      expect({ t, code }).toEqual({ t, code: "42501" });
      const same = await asRole(db, "service_role", null, () => errorCode(() => db.query(`update public.${t} set organization_id = organization_id`)));
      expect({ t, same }).toEqual({ t, same: null });
    }
    const ok = await asRole(db, "service_role", null, () => errorCode(() => db.query(`update public.tasks set title = 'y'`)));
    expect(ok).toBeNull();
  });
});
