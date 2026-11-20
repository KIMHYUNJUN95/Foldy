import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { GUEST_NAME_CASES, NORMALIZE_SAMPLES } from "@/lib/__tests__/guest-name-cases";
import { buildSearchArgs } from "@/lib/guest-messages/inbox-search";
import { matchesGuestName, normalizeGuestText } from "@/lib/guest-search";

/**
 * 손님 메시지 검색 DB 함수(202611180001 → 202611200001 → 202611200002)를 **실제 Postgres(PGlite)** 에 올려 돌린다.
 * docs/product/47-guest-messaging.md §5-10 「이름은 DB 에서 정확히」
 *
 * PGlite 는 이 저장소의 의존성이 아니다 — 설치한 폴더를 `FOLDY_PGLITE_DIR` 로 넘기면 돈다(없으면 DB 검사는 건너뛰고,
 * 건너뛴 사실을 경고 줄과 「건너뜀」 표시로 남긴다). 마이그레이션 파일 검사는 PGlite 없이도 돈다.
 *   mkdir -p /tmp/pg && (cd /tmp/pg && npm i @electric-sql/pglite@0.3.14)
 *   FOLDY_PGLITE_DIR=/tmp/pg npx vitest run src/lib/__tests__/guest-message-search-sql.test.ts
 */

const PGLITE_DIR = process.env.FOLDY_PGLITE_DIR;
const MIGRATIONS = ["202611180001_guest_message_search.sql", "202611200001_guest_message_search_perf.sql", "202611200002_guest_name_search.sql"];
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-20T03:00:00.000Z");
const HELPERS = [
  "public.guest_search_normalize(text)",
  "public.guest_name_search_key(text)",
  "public.guest_name_search_patterns(text)",
  "public.guest_name_search_match(text, text)",
];

function migrationSql(file: string): string {
  // 없으면 여기서 실패한다(조용히 건너뛰지 않는다).
  return readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
}

describe("손님 메시지 검색 마이그레이션 파일 — PGlite 없이", () => {
  it.runIf(!PGLITE_DIR)("FOLDY_PGLITE_DIR 없음 — DB 검사를 건너뛴 것을 출력에 남긴다", () => {
    process.stderr.write("[guest-message-search-sql] FOLDY_PGLITE_DIR 가 없어 DB 검사를 건너뜁니다 — 파일 머리 주석의 설치 방법을 보세요.\n");
  });
  it("세 파일이 모두 있다", () => {
    for (const file of MIGRATIONS) expect(migrationSql(file).length, file).toBeGreaterThan(0);
  });
  it("202611200002 — 이름 열쇠는 저장 칸(식 색인 없음) · 칸 색인 · 도우미 권한 거두기 · 끝에 analyze", () => {
    const sql = migrationSql(MIGRATIONS[2]).replace(/--.*$/gm, "");
    expect(sql).toMatch(/add column if not exists guest_name_key text\s+generated always as \(public\.guest_name_search_key\(guest_name\)\) stored/);
    expect(sql).toMatch(/using gin \(guest_name_key extensions\.gin_trgm_ops\)/);
    expect(sql).not.toMatch(/gin \(public\.guest_name_search_key/);
    expect(sql).toMatch(/drop index if exists public\.guest_conversations_name_search_trgm_idx/);
    for (const helper of HELPERS) expect(sql, helper).toContain(`revoke all on function ${helper} from public, anon`);
    expect(sql.trim().endsWith("analyze public.guest_conversations;")).toBe(true);
    expect(sql).toMatch(/^\s*set lock_timeout = '3s';/m);
    expect(sql).toMatch(/reset lock_timeout;\s+analyze public\.guest_conversations;\s*$/);
    expect(sql).not.toMatch(/\bcascade\b/i);
  });
});

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
};

const SCHEMA = `
  create schema if not exists extensions;
  create extension if not exists pg_trgm with schema extensions;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create table public.reservations (
    id uuid primary key, organization_id uuid not null, guest_name text,
    source_reservation_id text, original_reservation_id text, raw_payload jsonb
  );
  create table public.guest_conversations (
    id uuid primary key, organization_id uuid not null, guest_name text, provider_booking_id text,
    property_name text, room_label text, reservation_id uuid, status text not null default 'awaiting',
    snooze_until timestamptz, channel text, last_message_at timestamptz, updated_at timestamptz not null default now()
  );
  -- 운영과 같은 BEFORE UPDATE 트리거(guest_conversations_set_updated_at · 정의자 권한 아님). 이 트리거가 있으면 PG 는 status 만
  -- 바꿔도 생성 칸을 다시 계산하고, 그때 부르는 역할에 계산 함수 실행 권한이 필요하다(2026-11-20 실측 — 없으면 테스트가 못 잡는다).
  create or replace function public.set_updated_at() returns trigger language plpgsql as $t$
  begin new.updated_at := now(); return new; end; $t$;
  create trigger guest_conversations_set_updated_at before update on public.guest_conversations
    for each row execute function public.set_updated_at();
  -- 운영과 같은 표 권한(202611120002) — 직원(authenticated)은 읽기 + 상태 두 칸만 고친다.
  grant select on table public.guest_conversations to authenticated;
  grant update (status, snooze_until) on table public.guest_conversations to authenticated;
  grant all on table public.guest_conversations to service_role;
  create table public.guest_messages (
    id uuid primary key, organization_id uuid not null, conversation_id uuid not null, direction text not null,
    body text, sent_at timestamptz not null
  );
`;

function uuid(n: number): string {
  return `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

async function search(db: Db, query: string, extra: { limit?: number; status?: string; channel?: string; building?: string | null } = {}) {
  const args = buildSearchArgs(query, { labelSets: [], canSeeCodes: true, codes: [], now: NOW });
  const { rows } = await db.query<{ conversation_id: string; guest_name: string; name_hit: boolean; body_message_id: string | null }>(
    `select * from public.guest_conversation_search($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      ORG, args.p_like, args.p_name_fragments, args.p_reference, args.p_phone_pattern, args.p_email, args.p_place_names, args.p_body,
      args.p_body_since, args.p_code_mask, extra.status ?? "all", extra.building ?? null, extra.channel ?? "all", NOW.toISOString(),
      extra.limit ?? 80,
    ],
  );
  return rows;
}

describe.skipIf(!PGLITE_DIR)("손님 메시지 검색 DB 함수 — PGlite", () => {
  let db: Db;

  beforeAll(async () => {
    const base = join(PGLITE_DIR!, "node_modules/@electric-sql/pglite/dist");
    const { PGlite } = await import(pathToFileURL(join(base, "index.js")).href);
    const { pg_trgm } = await import(pathToFileURL(join(base, "contrib/pg_trgm.js")).href);
    db = new PGlite({ extensions: { pg_trgm } }) as Db;
    await db.exec(SCHEMA);
    for (const file of MIGRATIONS) {
      const sql = migrationSql(file);
      await db.exec(sql);
      await db.exec(sql); // 다시 돌려도 안전한가(멱등).
    }
  }, 60_000);

  it("이름 정리 — DB 와 JS 가 글자까지 같다", async () => {
    for (const sample of NORMALIZE_SAMPLES) {
      const { rows } = await db.query<{ v: string }>("select public.guest_search_normalize($1) as v", [sample]);
      expect({ sample, v: rows[0].v }).toEqual({ sample, v: normalizeGuestText(sample) });
    }
  });

  it("이름 판정 — 모든 사례에서 DB 와 JS(matchesGuestName)가 똑같고, 표의 기대값과도 같다", async () => {
    for (const c of GUEST_NAME_CASES) {
      const { rows } = await db.query<{ v: boolean }>("select public.guest_name_search_match($1, $2) as v", [c.query, c.name]);
      const js = matchesGuestName(c.query, c.name);
      expect({ label: c.label, db: rows[0].v, js }).toEqual({ label: c.label, db: c.expected, js: c.expected });
    }
  });

  it("이름 판정 — 단어가 서로 다른 순서의 덩이에 흩어진 경우는 DB 도 거짓(앱과 같다)", async () => {
    // 각 단어는 열쇠 어딘가에 있지만(색인 조건은 참) 한 덩이에 모두 있지는 않은 경우 — 다시 확인 조건이 거른다.
    const name = "Anna Bo Cy";
    for (const query of ["nab ocya", "bocya nab"]) {
      const { rows } = await db.query<{ v: boolean }>("select public.guest_name_search_match($1, $2) as v", [query, name]);
      expect({ query, db: rows[0].v }).toEqual({ query, db: matchesGuestName(query, name) });
    }
  });

  describe("결과 고르기", () => {
    beforeAll(async () => {
      await db.exec("truncate public.guest_conversations, public.guest_messages, public.reservations");
      const conv: string[] = [];
      const msg: string[] = [];
      // 최근 대화 120개 — 이름은 느슨한 조각('ki' · 'ra')에 걸리지만 진짜 이름은 아님, 메시지에 「kimura」.
      for (let i = 0; i < 120; i += 1) {
        const at = new Date(NOW.getTime() - i * 60_000).toISOString();
        conv.push(`('${uuid(i)}', '${ORG}', 'Kiara Smith ${i}', 'b${i}', '아라키초A', '201', null, 'awaiting', null, 'airbnb', '${at}')`);
        msg.push(`('${uuid(10_000 + i)}', '${ORG}', '${uuid(i)}', 'guest', 'Is kimura station near?', '${at}')`);
      }
      // 오래된 진짜 이름 히트 — 처리 끝 · 다른 채널 · 다른 건물 하나씩.
      conv.push(`('${uuid(900)}', '${ORG}', 'Taro Kimura', 'b900', '아라키초A', '301', null, 'done', null, 'airbnb', '2024-01-01T00:00:00Z')`);
      conv.push(`('${uuid(901)}', '${ORG}', 'KIMURA Hanako', 'b901', '아라키초A', '302', null, 'snoozed', '2027-01-01T00:00:00Z', 'booking', '2023-01-01T00:00:00Z')`);
      conv.push(`('${uuid(902)}', '${ORG}', 'Kimúra Jiro', 'b902', '요츠야', '101', null, 'awaiting', null, 'airbnb', '2022-01-01T00:00:00Z')`);
      // 다른 조직의 같은 이름 — 절대 나오면 안 된다.
      conv.push(`('${uuid(950)}', '${OTHER_ORG}', 'Taro Kimura', 'x', '아라키초A', '1', null, 'awaiting', null, 'airbnb', '2026-11-20T00:00:00Z')`);
      await db.exec(`insert into public.guest_conversations values ${conv.join(",")}`);
      await db.exec(`insert into public.guest_messages values ${msg.join(",")}`);
    });

    it("느슨한 히트 · 내용 히트가 80개 넘게 더 최근에 있어도 오래된 진짜 이름 히트가 남고, 맨 앞에 온다", async () => {
      const rows = await search(db, "kimura");
      expect(rows).toHaveLength(80);
      expect(rows.slice(0, 3).map((r) => r.conversation_id)).toEqual([uuid(900), uuid(901), uuid(902)]);
      expect(rows.slice(0, 3).every((r) => r.name_hit)).toBe(true);
      // 남는 칸은 내용 히트로 — 최신순.
      expect(rows[3].conversation_id).toBe(uuid(0));
      expect(rows[3].body_message_id).toBe(uuid(10_000));
      expect(rows.some((r) => r.conversation_id === uuid(950))).toBe(false);
    });

    it("이름으로 칸이 차면 내용 히트는 들어오지 않는다", async () => {
      const rows = await search(db, "kimura", { limit: 2 });
      expect(rows.map((r) => r.conversation_id)).toEqual([uuid(900), uuid(901)]);
    });

    it("붙여 씀 · 순서 바꿈도 DB 에서 바로 찾는다", async () => {
      const rows = await search(db, "kimuratar");
      expect(rows[0]?.conversation_id).toBe(uuid(900));
    });

    it("p_like 가 없으면 예전 조각(p_name_fragments)을 이름 단어로 쓴다", async () => {
      const { rows } = await db.query<{ conversation_id: string }>(
        `select conversation_id from public.guest_conversation_search($1, null, $2, null, null, null, '{}', false, null, null, 'all', null, 'all', $3, 80)`,
        [ORG, ["kimura"], NOW.toISOString()],
      );
      expect(rows.map((r) => r.conversation_id)).toEqual([uuid(900), uuid(901), uuid(902)]);
    });

    it("코드 가리기 — 가려진 글자로만 맞는 메시지는 내용 히트가 되지 않는다", async () => {
      await db.exec(`insert into public.guest_messages values ('${uuid(20_000)}', '${ORG}', '${uuid(5)}', 'host', 'door code 4821', '${NOW.toISOString()}')`);
      const call = (mask: string | null) =>
        db.query<{ conversation_id: string }>(
          `select conversation_id from public.guest_conversation_search($1, '%4821%', '{}', null, null, null, '{}', true, null, $2, 'all', null, 'all', $3, 80)`,
          [ORG, mask, NOW.toISOString()],
        );
      expect((await call(null)).rows.map((r) => r.conversation_id)).toEqual([uuid(5)]);
      expect((await call("4821")).rows).toHaveLength(0);
    });

    it("상태 인자는 그대로 동작하고(앱이 검색 땐 all 을 보낸다) 건물 · 채널 필터는 이름 히트에도 걸린다", async () => {
      expect((await search(db, "kimura", { status: "done" })).map((r) => r.conversation_id)).toEqual([uuid(900)]);
      const booking = await search(db, "kimura", { channel: "booking" });
      expect(booking.map((r) => r.conversation_id)).toEqual([uuid(901)]);
      const yotsuya = await search(db, "kimura", { building: "요츠야" });
      expect(yotsuya.map((r) => r.conversation_id)).toEqual([uuid(902)]);
    });

    it("앱과 같은 판정 — 단어가 다른 순서 덩이에 흩어지면 대화 이름 · 예약 이름 어느 쪽으로도 안 나온다", async () => {
      const resId = "20000000-0000-4000-8000-000000000001";
      await db.exec(`insert into public.reservations (id, organization_id, guest_name) values ('${resId}', '${ORG}', 'Anna Bo Cy')`);
      await db.exec(`insert into public.guest_conversations (id, organization_id, guest_name, provider_booking_id, property_name, room_label, reservation_id, status, channel, last_message_at)
        values ('${uuid(960)}', '${ORG}', 'Anna Bo Cy', 'b960', '아라키초A', '1', null, 'awaiting', 'airbnb', '2021-01-01T00:00:00Z'),
               ('${uuid(961)}', '${ORG}', 'Guest', 'b961', '아라키초A', '2', '${resId}', 'awaiting', 'airbnb', '2021-01-01T00:00:00Z')`);
      try {
        for (const query of ["nab ocya", "bocya nab"]) {
          const ids = (await search(db, query)).map((r) => r.conversation_id);
          expect({ query, ids, js: matchesGuestName(query, "Anna Bo Cy") }).toEqual({ query, ids: [], js: false });
        }
        // 붙여 쓴 순서 바꿈은 둘 다 나온다 — 대화 이름(A 단계)이 먼저, 예약 이름으로만 맞는 대화(B 단계)가 뒤.
        expect((await search(db, "cyanna")).map((r) => r.conversation_id)).toEqual([uuid(960), uuid(961)]);
      } finally {
        await db.exec(`delete from public.guest_conversations where id in ('${uuid(960)}', '${uuid(961)}'); delete from public.reservations where id = '${resId}'`);
      }
    });
  });

  it("권한 — service_role 만 검색 함수를 부를 수 있다(anon · authenticated 는 못 부름) · security invoker · search_path ''", async () => {
    const sig = "public.guest_conversation_search(uuid, text, text[], text, text, text, text[], boolean, timestamptz, text, text, text, text, timestamptz, integer)";
    const { rows } = await db.query<{ svc: boolean; anon: boolean; auth: boolean; definer: boolean; config: string[] }>(
      `select has_function_privilege('service_role', $1, 'execute') as svc,
              has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              (select prosecdef from pg_proc where oid = $1::regprocedure) as definer,
              (select proconfig from pg_proc where oid = $1::regprocedure) as config`,
      [sig],
    );
    expect(rows[0]).toEqual({ svc: true, anon: false, auth: false, definer: false, config: ['search_path=""'] });
  });

  it("색인 — 3글자 이상 이름은 저장 칸의 trigram 색인을 쓴다 · 식 색인은 없다", async () => {
    await db.exec("set enable_seqscan = off");
    const { rows } = await db.query<{ "QUERY PLAN": string }>(
      `explain select id from public.guest_conversations c
        where c.organization_id = '${ORG}' and c.guest_name_key like '%kimura%'`,
    );
    await db.exec("reset enable_seqscan");
    expect(rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain("guest_conversations_name_key_trgm_idx");
    const { rows: idx } = await db.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and tablename = 'guest_conversations' and indexdef ilike '%guest_name_search_key%'",
    );
    expect(idx).toEqual([]);
  });

  it("저장 칸 guest_name_key — 생성 칸(stored)이고 값은 열쇠 함수와 같으며, 이름을 바꾸면 다시 계산된다", async () => {
    const { rows: col } = await db.query<{ attgenerated: string }>(
      "select attgenerated from pg_attribute where attrelid = 'public.guest_conversations'::regclass and attname = 'guest_name_key'",
    );
    expect(col).toEqual([{ attgenerated: "s" }]);
    const { rows: diff } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.guest_conversations where guest_name_key is distinct from public.guest_name_search_key(guest_name)",
    );
    expect(diff[0].n).toBe(0);
    await db.exec(`update public.guest_conversations set guest_name = 'Minsu Kim' where id = '${uuid(902)}'`);
    const { rows } = await db.query<{ k: string }>(`select guest_name_key as k from public.guest_conversations where id = '${uuid(902)}'`);
    expect(rows[0].k).toBe("minsukim kimminsu");
    await db.exec(`update public.guest_conversations set guest_name = 'Kimúra Jiro' where id = '${uuid(902)}'`);
  });

  it("직원(authenticated)이 상태 · 나중에 칸을 바꿀 수 있다(BEFORE UPDATE 트리거로 저장 칸이 다시 계산돼도)", async () => {
    await db.exec("set role authenticated");
    try {
      await db.exec(`update public.guest_conversations set status = 'done', snooze_until = null where id = '${uuid(901)}'`);
    } finally {
      await db.exec("reset role");
    }
    const { rows } = await db.query<{ status: string; k: string }>(`select status, guest_name_key as k from public.guest_conversations where id = '${uuid(901)}'`);
    expect(rows[0]).toEqual({ status: "done", k: "kimurahanako hanakokimura" });
    await db.exec(`update public.guest_conversations set status = 'snoozed', snooze_until = '2027-01-01T00:00:00Z' where id = '${uuid(901)}'`);
  });

  it("웹훅 · 동기화(service_role)는 이름을 바꿀 수 있고 저장 칸이 따라 바뀐다", async () => {
    await db.exec("set role service_role");
    try {
      await db.exec(`update public.guest_conversations set guest_name = 'Hanako KIMURA' where id = '${uuid(901)}'`);
    } finally {
      await db.exec("reset role");
    }
    const { rows } = await db.query<{ k: string }>(`select guest_name_key as k from public.guest_conversations where id = '${uuid(901)}'`);
    expect(rows[0].k).toBe("hanakokimura kimurahanako");
    await db.exec(`update public.guest_conversations set guest_name = 'KIMURA Hanako' where id = '${uuid(901)}'`);
  });

  it("도우미 함수 4개 — PUBLIC · anon 은 못 하고, 정리 · 열쇠만 authenticated 도(BEFORE UPDATE 트리거 때문), 조각 · 판정은 service_role 만", async () => {
    const authOk = new Set(["public.guest_search_normalize(text)", "public.guest_name_search_key(text)"]);
    for (const helper of HELPERS) {
      const { rows } = await db.query<{ svc: boolean; anon: boolean; auth: boolean; pub: boolean }>(
        `select has_function_privilege('service_role', $1, 'execute') as svc,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub`,
        [helper],
      );
      expect({ helper, ...rows[0] }).toEqual({ helper, svc: true, anon: false, auth: authOk.has(helper), pub: false });
    }
  });

  it("anon 으로 도우미 함수를 부르면 거절된다", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select public.guest_search_normalize('Kim')")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.guest_name_search_match('kim', 'Kim Minsu')")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.guest_name_search_key('Kim')")).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("authenticated 는 조각 · 판정 함수를 부를 수 없다", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select public.guest_name_search_patterns('kim')")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.guest_name_search_match('kim', 'Kim Minsu')")).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("한 트랜잭션 안에서 두 번 돌려도 된다 · 끝나면 lock_timeout 이 돌아온다", async () => {
    const sql = migrationSql(MIGRATIONS[2]);
    await db.exec(`begin; ${sql} ${sql} commit;`);
    const { rows } = await db.query<{ t: string }>("select current_setting('lock_timeout') as t");
    expect(rows[0].t).toBe("0");
  });
});
