import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 린넨 반품 DB 보강(202611100002) — 정적 확인. 실제 동작(일반 사용자 · service_role · 퇴사자)은 PGlite 스크립트로 따로 돌렸다
 * (보고 참고). 여기서는 정책 · 트리거 · 함수가 빠지거나 이름이 바뀌는 회귀를 막는다.
 */
const PATH = "supabase/migrations/202611100002_linen_returns_hardening.sql";
const SQL = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";

function policyBlock(name: string): string {
  const start = SQL.indexOf(`create policy "${name}"`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return SQL.slice(start, SQL.indexOf(");\n", start));
}

describe("린넨 반품 보강 마이그레이션", () => {
  it("파일이 있다", () => {
    expect(SQL.length).toBeGreaterThan(0);
  });

  it("요청 사진 올리기 · 지우기 정책에 linen-returns 폴더가 돌아온다(기존 폴더는 그대로)", () => {
    for (const name of ["org members can upload request images", "org members can delete request images"]) {
      const block = policyBlock(name);
      for (const folder of ["lost-items", "lost-found-handling", "maintenance-reports", "maintenance-resolutions", "order-images", "linen-returns"]) {
        expect(block, `${name} ${folder}`).toContain(`'${folder}'`);
      }
    }
  });

  it("linen-returns 사진 지우기는 내가 올린 것 또는 linen.manage, 다른 폴더는 request.delete_any 그대로", () => {
    const block = policyBlock("org members can delete request images");
    expect(block).toContain("owner_id = (auth.uid())::text");
    expect(block).toContain("'linen.manage'");
    expect(block).toContain("'request.delete_any'");
  });

  it("기록 칸 보호 트리거 — 등록 시각은 now(), 등록자는 본인, 수정 불가, service_role 통과", () => {
    expect(SQL).toMatch(/create trigger \w+\s+before insert or update on public\.linen_return_records/);
    expect(SQL).toContain("new.registered_at := now()");
    expect(SQL).toContain("new.registered_by_user_id is distinct from (select auth.uid())");
    expect(SQL).toContain("new.registered_at is distinct from old.registered_at");
    expect(SQL).toMatch(/if \(select auth\.uid\(\)\) is null then\s+return new;/);
  });

  it("수정 · 삭제 정책 4곳 작성자 조건에 활성 멤버", () => {
    for (const name of [
      "author or admin can update linen return records",
      "author or admin can delete linen return records",
      "delete line items of editable linen return records",
      "mutate line items of editable linen return records",
    ]) {
      const start = SQL.indexOf(`alter policy "${name}"`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const block = SQL.slice(start, SQL.indexOf(";", start));
      expect(block, name).toMatch(/registered_by_user_id = \(select auth\.uid\(\)\)\) and public\.has_active_membership\(/);
    }
    const mutate = SQL.slice(SQL.indexOf(`alter policy "mutate line items of editable linen return records"`));
    expect(mutate.slice(0, mutate.indexOf(";"))).toContain("with check");
  });

  it("품목 줄은 같은 조직 품목만", () => {
    expect(SQL).toMatch(/create trigger \w+\s+before insert or update on public\.linen_return_record_items/);
  });

  it("합치기 · 수정 함수 — invoker, search_path 비움, 잠금, 멱등", () => {
    for (const fn of ["linen_submit_return", "linen_update_return"]) {
      const start = SQL.indexOf(`create or replace function public.${fn}(`);
      expect(start, fn).toBeGreaterThanOrEqual(0);
      const body = SQL.slice(start, SQL.indexOf("$$;", start));
      expect(body).toContain("security invoker");
      expect(body).toContain("set search_path = ''");
      expect(SQL).toContain(`revoke all on function public.${fn}(`);
    }
    const submit = SQL.slice(SQL.indexOf("create or replace function public.linen_submit_return("));
    expect(submit).toContain("pg_advisory_xact_lock");
    // 같은 제출 id 로 건물만 바꿔 동시에 보내도 둘째가 기본 키 충돌 대신 「이미 처리됨」을 보게 — 제출 id 잠금을 먼저.
    expect(submit).toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\(concat_ws\('\|', 'linen_submit_return:submission', p_submission_id\)/);
    expect(submit).toContain("submission_ids");
    expect(submit).toContain("'linen:too_many_photos_merged'");
    expect(submit).toContain("on conflict (return_record_id, linen_item_id)");
    // 형식이 틀린 품목 id · 수량은 이름표 없는 22P02 대신 linen:invalid_item · linen:invalid_quantity 로.
    for (const fn of ["linen_submit_return", "linen_update_return"]) {
      const body = SQL.slice(SQL.indexOf(`create or replace function public.${fn}(`));
      const head = body.slice(0, body.indexOf("$$;"));
      expect(head, fn).toContain("'linen:invalid_item'");
      expect(head, fn).toMatch(/case when jsonb_typeof\(e -> 'quantity'\) = 'number'/);
    }
    const update = SQL.slice(SQL.indexOf("create or replace function public.linen_update_return("));
    expect(update).toContain("'linen:stale'");
    expect(update).toContain("for update");
  });
});
