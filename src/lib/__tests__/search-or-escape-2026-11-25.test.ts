import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// 검색어의 `,` `)` 가 PostgREST `.or()` 문법을 깨서 목록이 통째로 비던 문제(2026-11-25) — 채용 지원서 검색 · 연차 대기열 검색.

vi.mock("server-only", () => ({}));
const orCalls: string[] = [];
function proxyClient(): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
        if (prop === "or") return (arg: string) => (orCalls.push(arg), chain);
        return () => chain;
      },
    },
  );
  return { from: () => chain };
}
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => proxyClient() }));

const { listJobApplications } = await import("@/lib/recruit/applications");

const session = { capabilities: ["job_application.read"], organization: { id: "o1" }, user: { id: "u1" } } as never;
const filter = (query: string) => ({
  status: "all" as const,
  jobTitle: null,
  employmentType: null,
  from: null,
  to: null,
  withResumeOnly: false,
  query,
});

describe("채용 지원서 검색 — or() 문법 글자", () => {
  it("`,` `)` `(` 가 or() 에 그대로 들어가지 않는다", async () => {
    orCalls.length = 0;
    await listJobApplications({ session, filter: filter("kim,phone.eq.1)") });
    expect(orCalls).toHaveLength(1);
    const inner = orCalls[0].replace("applicant_name.ilike.%", "").replace(/%,phone\.ilike\.%.*%$/, "");
    expect(inner).not.toMatch(/[,()]/);
  });

  it("기호만 있는 검색어는 or() 를 걸지 않는다", async () => {
    orCalls.length = 0;
    await listJobApplications({ session, filter: filter(",()") });
    expect(orCalls).toHaveLength(0);
  });
});

describe("연차 대기열 검색", () => {
  it("검색어를 escapeIlikeFragment 로 거른다(원문 그대로 or() 에 넣지 않는다)", () => {
    const src = readFileSync("src/lib/annual-leave-approvals-server.ts", "utf8");
    expect(src).toContain("escapeIlikeFragment(opts.search)");
    expect(src).not.toMatch(/`%\$\{opts\.search\.trim\(\)\}%`/);
  });
});
