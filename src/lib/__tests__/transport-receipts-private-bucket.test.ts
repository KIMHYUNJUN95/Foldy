import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 교통비 영수증 비공개 버킷 · 사진 상한 · 제출 뒤 잠금(2026-11-25, 202611250002) — 마이그레이션 정적 확인 + 실제 역할로 쓰기.
 * 문서: docs/engineering/05-rls-permissions.md 「교통비 영수증 비공개 버킷(2026-11-25)」
 *
 * PGlite 는 이 저장소의 의존성이 아니다 — 설치한 폴더를 `FOLDY_PGLITE_DIR` 로 넘기면 DB 검사가 돈다(없으면 건너뛴다).
 *   mkdir -p /tmp/pg && (cd /tmp/pg && npm i @electric-sql/pglite@0.3.14)
 *   FOLDY_PGLITE_DIR=/tmp/pg npx vitest run src/lib/__tests__/transport-receipts-private-bucket.test.ts
 */

const FILE = "202611250002_transport_receipts_private_bucket.sql";
const SQL = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8");
const CODE = SQL.replace(/--.*$/gm, "");
const PGLITE_DIR = process.env.FOLDY_PGLITE_DIR;

describe("교통비 영수증 비공개 버킷 마이그레이션 — 파일", () => {
  it("한 거래로 감싼다", () => {
    expect(CODE.trim().startsWith("begin;")).toBe(true);
    expect(CODE.trim().endsWith("commit;")).toBe(true);
  });

  it("새 버킷은 비공개 · 8MB · 사진 4종", () => {
    const stmt = CODE.match(/insert into storage\.buckets[\s\S]*?;/)?.[0] ?? "";
    expect(stmt).toContain("'transport-receipts'");
    expect(stmt).toMatch(/false/);
    expect(stmt).toContain("8388608");
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif"]) expect(stmt).toContain(t);
    expect(stmt).toMatch(/on conflict \(id\) do update/);
  });

  it("새 버킷에는 읽기 · 지우기 정책을 만들지 않는다(서버 service role 만)", () => {
    const creates = [...CODE.matchAll(/create policy "[^"]+"\s+on storage\.objects\s+for (\w+)/g)].map((m) => m[1]);
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.every((op) => op === "insert")).toBe(true);
  });

  it("예전 request-images 교통비 지우기 정책을 버린다(다시 만들지 않음) — 연차 지우기 정책은 건드리지 않는다", () => {
    expect(CODE).toMatch(/drop policy if exists "org members can delete transport reimbursement images" on storage\.objects;/);
    expect(CODE).not.toMatch(/create policy "org members can delete transport reimbursement images"/);
    expect(CODE).not.toMatch(/annual leave/);
  });

  it("사진 지우기 · 항목 지우기 트리거는 같은 순서로 잠근다(항목 → 정산서)", () => {
    const body = CODE.match(/function public\.guard_transport_item_image_delete\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
    const itemLock = body.search(/from public\.transport_reimbursement_items[\s\S]*?for update/);
    const reportLock = body.search(/from public\.transport_reimbursement_reports[\s\S]*?for update/);
    expect(itemLock).toBeGreaterThan(-1);
    expect(reportLock).toBeGreaterThan(itemLock);
  });

  it("(항목, 경로) 유일 — 겹친 행을 먼저 정리한 뒤 유일 색인을 만든다", () => {
    const dedup = CODE.search(/delete from public\.transport_reimbursement_item_images/);
    const unique = CODE.search(/create unique index if not exists transport_item_images_item_path_key/);
    expect(dedup).toBeGreaterThan(-1);
    expect(unique).toBeGreaterThan(dedup);
    // 다시 돌릴 때 지우기 잠금 트리거가 정리를 막지 않게 먼저 내린다.
    expect(CODE.slice(0, dedup)).toMatch(/drop trigger if exists transport_item_images_guard_delete/);
  });

  it("트리거 함수는 public · anon · authenticated 에서 실행 권한을 거둔다", () => {
    const fns = [...CODE.matchAll(/create or replace function (public\.\w+)\(/g)].map((m) => m[1]);
    expect(fns.length).toBeGreaterThanOrEqual(3);
    for (const fn of fns) expect(CODE, fn).toMatch(new RegExp(`revoke all on function ${fn.replace(".", "\\.")}\\(\\) from public, anon, authenticated;`));
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
const U = {
  owner: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002", // 같은 조직 활성 멤버
  left: "00000000-0000-4000-8000-000000000003", // 조직에서 나감 — 자기 정산서 행은 남아 있음
};
const R_DRAFT = "10000000-0000-4000-8000-000000000001";
const R_SUBMITTED = "10000000-0000-4000-8000-000000000002";
const R_LEFT = "10000000-0000-4000-8000-000000000003";
const R_APPROVED = "10000000-0000-4000-8000-000000000004";
const I_DRAFT = "20000000-0000-4000-8000-000000000001";
const I_SUBMITTED = "20000000-0000-4000-8000-000000000002";
const I_LEFT = "20000000-0000-4000-8000-000000000003";
const I_APPROVED = "20000000-0000-4000-8000-000000000004";
const I_DRAFT2 = "20000000-0000-4000-8000-000000000005";

/** 적용 전 운영과 같은 모양(202606260001 표 · 외래 키 cascade, Supabase storage 최소 모양). request-images 예전 정책은 202606260001 그대로. */
const SCHEMA = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create schema if not exists storage;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;

  create table storage.buckets (id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text not null, owner uuid, owner_id text, created_at timestamptz default now());
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to authenticated, anon;
  grant all on storage.objects, storage.buckets to service_role;
  insert into storage.buckets (id, name, public) values ('request-images', 'request-images', true);

  create table public.memberships (user_id uuid, organization_id uuid, status text);
  create table public.platform_admins (user_id uuid, is_active boolean not null default true);
  grant select on public.memberships, public.platform_admins to authenticated;
  create or replace function public.is_platform_admin() returns boolean language sql stable security definer set search_path = public as
    $f$ select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true) $f$;

  create table public.transport_reimbursement_reports (id uuid primary key, organization_id uuid not null, user_id uuid not null,
    status text not null default 'draft');
  create table public.transport_reimbursement_items (id uuid primary key, organization_id uuid not null,
    report_id uuid not null references public.transport_reimbursement_reports(id) on delete cascade,
    user_id uuid not null, amount_yen integer not null default 100);
  create table public.transport_reimbursement_item_images (id uuid primary key default gen_random_uuid(), organization_id uuid not null,
    report_id uuid not null references public.transport_reimbursement_reports(id) on delete cascade,
    item_id uuid not null references public.transport_reimbursement_items(id) on delete cascade,
    user_id uuid not null, storage_path text not null, sort_order integer not null default 0);
  grant select, insert, update, delete on public.transport_reimbursement_reports, public.transport_reimbursement_items,
    public.transport_reimbursement_item_images to authenticated;
  grant all on public.transport_reimbursement_reports, public.transport_reimbursement_items,
    public.transport_reimbursement_item_images to service_role;

  create or replace function public.has_capability(org uuid, uid uuid, cap text) returns boolean language sql stable as
    $f$ select false $f$;
  -- 공개 버킷이라 읽기는 열려 있다고 본다(지우기가 지우기 정책 하나로만 갈리게).
  create policy "test can read request images" on storage.objects for select to authenticated using (bucket_id = 'request-images');
  -- 202611110002 그대로: 올린 사람 · transport.manage · 플랫폼 관리자면 정산서 상태와 상관없이 지울 수 있었다.
  create policy "org members can delete transport reimbursement images"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'request-images'
      and array_length(string_to_array(name, '/'), 1) = 5
      and split_part(name, '/', 2) = 'transport-reimbursements'
      and (
        exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active = true)
        or (
          exists (select 1 from public.memberships m where m.organization_id::text = split_part(objects.name, '/', 1)
            and m.user_id = auth.uid() and m.status = 'active')
          and (owner_id = (auth.uid())::text or public.has_capability(split_part(name, '/', 1)::uuid, auth.uid(), 'transport.manage'))
        )
      )
    );

  create policy "org members can upload transport reimbursement images"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'request-images'
      and split_part(name, '/', 2) = 'transport-reimbursements'
      and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and split_part(name, '/', 6) = ''
      and (
        public.is_platform_admin()
        or exists (select 1 from public.memberships m where m.organization_id::text = split_part(name, '/', 1)
          and m.user_id = auth.uid() and m.status = 'active')
      )
    );

  insert into public.memberships values ('${U.owner}', '${ORG}', 'active'), ('${U.other}', '${ORG}', 'active'), ('${U.left}', '${ORG}', 'inactive');
  insert into public.transport_reimbursement_reports values
    ('${R_DRAFT}', '${ORG}', '${U.owner}', 'draft'), ('${R_SUBMITTED}', '${ORG}', '${U.owner}', 'submitted'),
    ('${R_LEFT}', '${ORG}', '${U.left}', 'draft'), ('${R_APPROVED}', '${ORG}', '${U.owner}', 'approved');
  insert into public.transport_reimbursement_items (id, organization_id, report_id, user_id) values
    ('${I_DRAFT}', '${ORG}', '${R_DRAFT}', '${U.owner}'), ('${I_SUBMITTED}', '${ORG}', '${R_SUBMITTED}', '${U.owner}'),
    ('${I_LEFT}', '${ORG}', '${R_LEFT}', '${U.left}'), ('${I_APPROVED}', '${ORG}', '${R_APPROVED}', '${U.owner}'),
    ('${I_DRAFT2}', '${ORG}', '${R_DRAFT}', '${U.owner}');
  insert into public.transport_reimbursement_item_images (organization_id, report_id, item_id, user_id, storage_path) values
    ('${ORG}', '${R_APPROVED}', '${I_APPROVED}', '${U.owner}', 'approved-0.jpg'),
    ('${ORG}', '${R_SUBMITTED}', '${I_SUBMITTED}', '${U.owner}', 'submitted-0.jpg'),
    -- 적용 전 동시에 두 번 들어가 겹친 행(제출된 정산서 · 고칠 수 있는 정산서)
    ('${ORG}', '${R_SUBMITTED}', '${I_SUBMITTED}', '${U.owner}', 'dup-s.jpg'),
    ('${ORG}', '${R_SUBMITTED}', '${I_SUBMITTED}', '${U.owner}', 'dup-s.jpg'),
    ('${ORG}', '${R_DRAFT}', '${I_DRAFT}', '${U.owner}', 'dup-d.jpg'),
    ('${ORG}', '${R_DRAFT}', '${I_DRAFT}', '${U.owner}', 'dup-d.jpg'),
    ('${ORG}', '${R_DRAFT}', '${I_DRAFT}', '${U.owner}', 'dup-d.jpg');
  insert into storage.objects (bucket_id, name, owner_id) values
    ('request-images', '${ORG}/transport-reimbursements/${R_SUBMITTED}/${I_SUBMITTED}/old-s.jpg', '${U.owner}'),
    ('request-images', '${ORG}/transport-reimbursements/${R_DRAFT}/${I_DRAFT}/old-d.jpg', '${U.owner}');
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

async function failure(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return `${e.code ?? "?"} ${e.message ?? ""}`;
  }
}

const path = (report: string, item: string, file = "a.jpg") => `${ORG}/transport-reimbursements/${report}/${item}/${file}`;

describe("교통비 영수증 비공개 버킷 — PGlite(실제 역할)", () => {
  it.runIf(!PGLITE_DIR)("FOLDY_PGLITE_DIR 없음 — DB 검사를 건너뛴 것을 출력에 남긴다", () => {
    process.stderr.write("[transport-receipts-private-bucket] FOLDY_PGLITE_DIR 가 없어 DB 검사를 건너뜁니다.\n");
  });
});

describe.skipIf(!PGLITE_DIR)("교통비 영수증 비공개 버킷 — PGlite(실제 역할)", () => {
  let db: Db;

  beforeAll(async () => {
    const base = join(PGLITE_DIR!, "node_modules/@electric-sql/pglite/dist");
    const { PGlite } = await import(pathToFileURL(join(base, "index.js")).href);
    db = new PGlite() as Db;
    await db.exec(SCHEMA);
    await db.exec(SQL);
    await db.exec(SQL); // 두 번 돌려도 같은 결과(멱등).
  }, 60_000);

  const upload = (uid: string, bucket: string, name: string) =>
    asRole(db, "authenticated", uid, () =>
      failure(() => db.query("insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)", [bucket, name, uid])),
    );
  const imageInsert = (item: string, report: string, file: string) =>
    asRole(db, "service_role", null, () =>
      failure(() =>
        db.query(
          "insert into public.transport_reimbursement_item_images (organization_id, report_id, item_id, user_id, storage_path) values ($1, $2, $3, $4, $5)",
          [ORG, report, item, U.owner, file],
        ),
      ),
    );

  it("버킷: 비공개 · 8MB · 사진 4종 — 두 번 돌려도 하나", async () => {
    const { rows } = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'transport-receipts'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
    expect(rows[0].file_size_limit).toBe("8388608");
    expect([...rows[0].allowed_mime_types].sort()).toEqual(["image/gif", "image/jpeg", "image/png", "image/webp"]);
  });

  for (const bucket of ["transport-receipts", "request-images"]) {
    it(`${bucket} 올리기: 내 정산서 · 내 항목 · 고칠 수 있을 때만`, async () => {
      expect(await upload(U.owner, bucket, path(R_DRAFT, I_DRAFT))).toBeNull();
      // 같은 조직의 다른 사람이 내 항목 폴더에
      expect(await upload(U.other, bucket, path(R_DRAFT, I_DRAFT, "b.jpg"))).toMatch(/^42501/);
      // 제출된 정산서
      expect(await upload(U.owner, bucket, path(R_SUBMITTED, I_SUBMITTED))).toMatch(/^42501/);
      // 항목과 정산서가 어긋남
      expect(await upload(U.owner, bucket, path(R_SUBMITTED, I_DRAFT, "c.jpg"))).toMatch(/^42501/);
      // 조직에서 나간 사람
      expect(await upload(U.left, bucket, path(R_LEFT, I_LEFT))).toMatch(/^42501/);
      // 모양이 틀린 경로(uuid 아님 · 한 칸 더)
      expect(await upload(U.owner, bucket, `${ORG}/transport-reimbursements/x/${I_DRAFT}/a.jpg`)).toMatch(/^42501/);
      expect(await upload(U.owner, bucket, `${path(R_DRAFT, I_DRAFT)}/extra`)).toMatch(/^42501/);
    });
  }

  it("새 버킷은 로그인한 사용자가 읽을 수 없다(정책 없음)", async () => {
    const n = await asRole(db, "authenticated", U.owner, async () =>
      (await db.query<{ n: number }>("select count(*)::int as n from storage.objects where bucket_id = 'transport-receipts'")).rows[0].n,
    );
    expect(n).toBe(0);
  });

  it("예전 버킷: 올린 사람도 브라우저에서 교통비 파일을 지울 수 없다(제출된 정산서 · 고칠 수 있는 정산서 모두, 지우기는 서버만)", async () => {
    for (const name of [path(R_SUBMITTED, I_SUBMITTED, "old-s.jpg"), path(R_DRAFT, I_DRAFT, "old-d.jpg")]) {
      const deleted = await asRole(db, "authenticated", U.owner, async () =>
        (await db.query("delete from storage.objects where bucket_id = 'request-images' and name = $1 returning id", [name])).rows.length,
      );
      expect(deleted, name).toBe(0);
    }
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from storage.objects where bucket_id = 'request-images' and name like '%/old-_.jpg'",
    );
    expect(rows[0].n).toBe(2);
  });

  it("겹친 사진 행은 하나만 남기고(제출된 정산서 것도), 같은 (항목, 경로)는 다시 넣을 수 없다", async () => {
    const { rows } = await db.query<{ storage_path: string; n: number }>(
      `select storage_path, count(*)::int as n from public.transport_reimbursement_item_images
        where storage_path like 'dup-%' group by storage_path order by storage_path`,
    );
    expect(rows).toEqual([{ storage_path: "dup-d.jpg", n: 1 }, { storage_path: "dup-s.jpg", n: 1 }]);
    expect(await imageInsert(I_DRAFT2, R_DRAFT, "same.jpg")).toBeNull();
    expect(await imageInsert(I_DRAFT2, R_DRAFT, "same.jpg")).toMatch(/^23505/);
    // 정리 뒤 지우기 잠금 트리거가 다시 걸려 있다.
    const del = await asRole(db, "service_role", null, () =>
      failure(() => db.query(`delete from public.transport_reimbursement_item_images where storage_path = 'dup-s.jpg'`)),
    );
    expect(del).toMatch(/transport report is not editable/);
    await asRole(db, "service_role", null, () =>
      db.query(`delete from public.transport_reimbursement_item_images where item_id = '${I_DRAFT2}'`),
    );
  });

  it("다시 돌릴 때(지우기 잠금 트리거가 이미 있을 때)도 제출된 정산서의 겹친 행을 정리하고 끝난다", async () => {
    await db.exec(`
      drop index public.transport_item_images_item_path_key;
      alter table public.transport_reimbursement_item_images disable trigger transport_item_images_guard_insert;
      insert into public.transport_reimbursement_item_images (organization_id, report_id, item_id, user_id, storage_path) values
        ('${ORG}', '${R_SUBMITTED}', '${I_SUBMITTED}', '${U.owner}', 'dup-s.jpg');
      alter table public.transport_reimbursement_item_images enable trigger transport_item_images_guard_insert;
    `);
    expect(await failure(() => db.exec(SQL))).toBeNull();
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.transport_reimbursement_item_images where storage_path = 'dup-s.jpg'",
    );
    expect(rows[0].n).toBe(1);
  });

  it("사진은 항목마다 5장까지, 순서는 DB 가 0부터 매긴다", async () => {
    for (let i = 0; i < 5; i++) expect(await imageInsert(I_DRAFT2, R_DRAFT, `p${i}.jpg`)).toBeNull();
    expect(await imageInsert(I_DRAFT2, R_DRAFT, "p5.jpg")).toMatch(/transport item image limit/);
    const { rows } = await db.query<{ sort_order: number }>(
      `select sort_order from public.transport_reimbursement_item_images where item_id = '${I_DRAFT2}' order by sort_order`,
    );
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("항목과 정산서가 어긋난 사진 행은 넣을 수 없다", async () => {
    expect(await imageInsert(I_DRAFT, R_SUBMITTED, "x.jpg")).toMatch(/transport image item mismatch/);
  });

  it("제출 · 승인된 정산서의 사진은 넣기 · 지우기 모두 막고, 항목 지우기도 막는다", async () => {
    expect(await imageInsert(I_SUBMITTED, R_SUBMITTED, "y.jpg")).toMatch(/transport report is not editable/);
    const delImage = await asRole(db, "service_role", null, () =>
      failure(() => db.query(`delete from public.transport_reimbursement_item_images where item_id = '${I_APPROVED}'`)),
    );
    expect(delImage).toMatch(/transport report is not editable/);
    const delItem = await asRole(db, "service_role", null, () =>
      failure(() => db.query(`delete from public.transport_reimbursement_items where id = '${I_SUBMITTED}'`)),
    );
    expect(delItem).toMatch(/transport report is not editable/);
  });

  it("고칠 수 있는 정산서의 사진 · 항목은 지울 수 있고, 항목을 지우면 사진도 따라 지워진다", async () => {
    expect(await imageInsert(I_DRAFT, R_DRAFT, "keep.jpg")).toBeNull();
    const del = await asRole(db, "service_role", null, () =>
      failure(() => db.query(`delete from public.transport_reimbursement_items where id = '${I_DRAFT}'`)),
    );
    expect(del).toBeNull();
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.transport_reimbursement_item_images where item_id = '${I_DRAFT}'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("승인된 정산서를 통째로 지우면(계정 정리 · 데모 정리) 항목 · 사진이 cascade 로 지워진다", async () => {
    const del = await asRole(db, "service_role", null, () =>
      failure(() => db.query(`delete from public.transport_reimbursement_reports where id = '${R_APPROVED}'`)),
    );
    expect(del).toBeNull();
    const { rows } = await db.query<{ items: number; images: number }>(
      `select (select count(*)::int from public.transport_reimbursement_items where report_id = '${R_APPROVED}') as items,
              (select count(*)::int from public.transport_reimbursement_item_images where report_id = '${R_APPROVED}') as images`,
    );
    expect(rows[0]).toEqual({ items: 0, images: 0 });
  });

  it("트리거 함수는 로그인 사용자 · anon 이 직접 부를 수 없다", async () => {
    const { rows } = await db.query<{ fn: string; auth: boolean; anon: boolean }>(
      `select p.proname as fn, has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'guard_transport_%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(r, r.fn).toMatchObject({ auth: false, anon: false });
  });
});
