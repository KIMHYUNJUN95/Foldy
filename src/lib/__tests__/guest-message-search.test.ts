import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SEARCH_FETCH_LIMIT,
  answerOnRunStart,
  buildSearchArgs,
  codeMaskPattern,
  maskCodeText,
  normalizeSearchQuery,
  pickSearchMatches,
  SEARCH_MAX_CHARS,
  searchViewState,
  placeNamesFor,
  snippetAround,
  type SearchRpcRow,
} from "@/lib/guest-messages/inbox-search";
import { escapeLikePattern, phoneLikePattern } from "@/lib/guest-search";
import { searchInbox } from "@/lib/guest-messages/inbox-server";
import { dictionaries } from "@/lib/i18n";

/** 손님 메시지 검색(47 §5-10) — 검색어 다듬기 · 찾는 곳별 판정 · 코드 가리기 · 조직 범위 · 순서 · 50개. */

const LABELS = Object.values(dictionaries).map((d) => d.cleaning.buildingLabels as Record<string, string>);
const base = { labelSets: LABELS, canSeeCodes: true, codes: [] as string[] };

function rpcRow(id: string, patch: Partial<SearchRpcRow> = {}): SearchRpcRow {
  return {
    conversation_id: id,
    last_message_at: "2026-11-17T00:00:00Z",
    guest_name: null,
    reservation_guest_name: null,
    name_hit: false,
    reference_hit: false,
    place_hit: false,
    phone: null,
    mobile: null,
    email_hit: false,
    body_message_id: null,
    body_direction: null,
    body: null,
    ...patch,
  };
}

describe("검색어 다듬기", () => {
  it("앞뒤 · 겹친 공백을 줄이고 2글자 미만은 찾지 않는다", () => {
    expect(normalizeSearchQuery("  John   Smith ")).toBe("John Smith");
    expect(normalizeSearchQuery("a")).toBeNull();
    expect(normalizeSearchQuery(" a ")).toBeNull();
    expect(normalizeSearchQuery("鍵穴")).toBe("鍵穴");
    expect(normalizeSearchQuery(42)).toBeNull();
    expect(normalizeSearchQuery(undefined)).toBeNull();
  });
  it("60자에서 자른다(글자 단위 — 이모지를 반으로 자르지 않는다)", () => {
    const long = "가".repeat(80);
    expect(Array.from(normalizeSearchQuery(long)!).length).toBe(60);
    const emoji = "😀".repeat(70);
    expect(normalizeSearchQuery(emoji)).toBe("😀".repeat(60));
  });
});

describe("DB 함수 인자", () => {
  it("ilike 패턴은 \\ % _ 만 막고 . @ 같은 글자는 남긴다(이메일 검색)", () => {
    expect(escapeLikePattern("50%_off\\x")).toBe("50\\%\\_off\\\\x");
    const args = buildSearchArgs("john.smith@gmail.com", base);
    expect(args.p_like).toBe("%john.smith@gmail.com%");
    expect(args.p_email).toBe("full");
  });
  it("@ 없는 한 단어는 이메일 @ 앞만, 띄어 쓴 말은 이메일을 안 본다", () => {
    expect(buildSearchArgs("smithj", base).p_email).toBe("local");
    expect(buildSearchArgs("John Smith", base).p_email).toBeNull();
    expect(buildSearchArgs("ab", base).p_email).toBeNull();
  });
  it("이름 조각 · 예약번호 · 전화번호(6자리 이상)", () => {
    const name = buildSearchArgs("Smith John", base);
    // 넓은 거름용 조각(소문자) — 최종 판정은 `matchesGuestName`.
    expect(name.p_name_fragments.length).toBeGreaterThan(0);
    expect(name.p_name_fragments.every((f) => "smith john".includes(f))).toBe(true);
    expect(name.p_reference).toBeNull();
    expect(name.p_phone_pattern).toBeNull();

    const hm = buildSearchArgs("HMABC12345", base);
    expect(hm.p_reference).toBe("HMABC12345");

    const phone = buildSearchArgs("090-1234-5678", base);
    expect(phone.p_phone_pattern).toBe(phoneLikePattern("09012345678"));
    expect(phone.p_phone_pattern).toBe("%9%0%1%2%3%4%5%6%7%8%");
    expect(buildSearchArgs("12345", base).p_phone_pattern).toBeNull();
  });
  it("건물은 ja · en 이름으로 쳐도 정본(ko) 이름으로 바꿔 보낸다", () => {
    expect(placeNamesFor("Arakicho A", LABELS)).toEqual(["아라키초A"]);
    expect(placeNamesFor("荒木町", LABELS).sort()).toEqual(["아라키초A", "아라키초B"]);
    expect(placeNamesFor("오쿠보", LABELS).sort()).toEqual(["오쿠보A", "오쿠보B", "오쿠보C"]);
    expect(placeNamesFor("umbrella", LABELS)).toEqual([]);
    expect(buildSearchArgs("Arakicho A", base).p_place_names).toEqual(["아라키초A"]);
  });
  it("내용 검색은 언제나 켜고, 코드를 볼 수 있으면 가리기 없음", () => {
    const args = buildSearchArgs("parking", base);
    expect(args.p_body).toBe(true);
    expect(args.p_code_mask).toBeNull();
  });
});

describe("출입 코드 가리기", () => {
  it("코드를 못 보면 3자 이상 코드를 긴 것부터 정규식으로(특수 글자는 막아서)", () => {
    expect(codeMaskPattern(false, ["1234#", "12", "482913", "1234#"])).toBe("482913|1234#");
    expect(codeMaskPattern(false, ["a.b*c"])).toBe("a\\.b\\*c");
    expect(codeMaskPattern(true, ["482913"])).toBeNull();
    expect(codeMaskPattern(false, [])).toBeNull();
  });
  it("코드 값을 못 읽었으면 숫자 · 기호 묶음 전체를 가린다", () => {
    expect(codeMaskPattern(false, null)).toBe("[0-9#*]{3,}");
    expect(maskCodeText("Door code: 482913#", false, null)).toBe("Door code: ••••");
  });
  it("미리보기 — 코드를 못 보면 손님 말 · 우리 답장 모두 코드를 가린다", () => {
    const rows = [
      rpcRow("h", { body_message_id: "m1", body_direction: "host", body: "Door code is 482913, parking is free" }),
      rpcRow("g", { body_message_id: "m2", body_direction: "guest", body: "Is 482913 the parking code?" }),
    ];
    const picked = pickSearchMatches(rows, "parking", { canSeeCodes: false, codes: ["482913"] });
    expect(picked[0].match.snippet).toEqual({ direction: "host", text: "Door code is ••••, parking is free" });
    expect(picked[1].match.snippet).toEqual({ direction: "guest", text: "Is •••• the parking code?" });
    const seen = pickSearchMatches(rows, "parking", { canSeeCodes: true, codes: ["482913"] });
    expect(seen[0].match.snippet?.text).toContain("482913");
    expect(seen[1].match.snippet?.text).toContain("482913");
  });
});

describe("결과 다시 보기 · 순서 · 개수", () => {
  it("찾는 곳별 맞은 곳 — 이름 · 전화는 기존 예약 검색 판정으로 다시 본다", () => {
    const rows = [
      rpcRow("a", { name_hit: true, guest_name: "John Smith" }),
      rpcRow("b", { name_hit: true, guest_name: "Johnny Smithers" }),
      rpcRow("c", { reference_hit: true, place_hit: true, email_hit: true }),
    ];
    const picked = pickSearchMatches(rows, "john smith", { canSeeCodes: true, codes: [] });
    expect(picked.map((p) => [p.id, p.match.hits])).toEqual([
      ["a", ["name"]],
      ["b", ["name"]],
      ["c", ["booking", "place", "email"]],
    ]);
  });
  it("전화번호 넓은 거름에 우연히 걸린 줄은 뺀다", () => {
    const rows = [
      rpcRow("ok", { phone: "+81 90-1234-5678" }),
      // `%9%0%1%2%…%` 에는 걸리지만 숫자가 이어져 있지 않다.
      rpcRow("noise", { mobile: "9-1-0-1-2-3-4-5-6-7-8" }),
    ];
    const picked = pickSearchMatches(rows, "090-1234-5678", { canSeeCodes: true, codes: [] });
    expect(picked.map((p) => [p.id, p.match.hits])).toEqual([["ok", ["phone"]]]);
  });
  it("맞은 곳이 없는 줄 · 같은 대화 두 번은 빼고, DB 순서를 지키며 50개까지", () => {
    const rows = [rpcRow("none"), ...Array.from({ length: 70 }, (_, i) => rpcRow(`r${i}`, { reference_hit: true })), rpcRow("r0", { reference_hit: true })];
    const picked = pickSearchMatches(rows, "HM1234", { canSeeCodes: true, codes: [] });
    expect(picked).toHaveLength(50);
    expect(picked[0].id).toBe("r0");
    expect(picked[49].id).toBe("r49");
    expect(new Set(picked.map((p) => p.id)).size).toBe(50);
  });
  it("내부 메모 · 시스템 줄은 맞은 곳이 되지 않는다", () => {
    const rows = [rpcRow("n", { body_message_id: "m", body_direction: "note" as never, body: "parking" })];
    expect(pickSearchMatches(rows, "parking", { canSeeCodes: true, codes: [] })).toEqual([]);
  });
});

describe("미리보기 자르기", () => {
  it("맞은 자리 앞뒤를 자르고 줄바꿈을 한 칸으로", () => {
    const body = `${"a".repeat(100)}\n\nwhere is the umbrella?\n${"b".repeat(200)}`;
    const text = snippetAround(body, "UMBRELLA");
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text).toContain("where is the umbrella?");
    expect(text).not.toContain("\n");
  });
  it("짧은 말은 그대로", () => {
    expect(snippetAround("우산 있어요?", "우산")).toBe("우산 있어요?");
  });
});

describe("searchInbox — 조직 범위", () => {
  function fakeDb(rpcRows: SearchRpcRow[], options: { failBuildingInfo?: boolean } = {}) {
    const calls: { rpc: Array<{ name: string; args: Record<string, unknown> }>; eq: Array<[string, unknown]> } = { rpc: [], eq: [] };
    const query = (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, {
        get(_, prop) {
          if (prop === "then") {
            const failed = options.failBuildingInfo && table === "property_operation_infos";
            return (resolve: (v: unknown) => void) => resolve(failed ? { data: null, error: { code: "x" } } : { data: [], error: null });
          }
          if (prop === "eq") return (col: string, val: unknown) => (calls.eq.push([col, val]), self);
          return () => self;
        },
      });
      return self;
    };
    const db = {
      from: (table: string) => query(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push({ name, args });
        if (name === "guest_conversation_search") return { data: rpcRows, error: null };
        return { data: [], error: null };
      },
    };
    return { db, calls };
  }

  it("검색 함수와 줄 다시 읽기에 언제나 세션 조직을 건다", async () => {
    const { db, calls } = fakeDb([rpcRow("11111111-1111-4111-8111-111111111111", { reference_hit: true })]);
    await searchInbox(db as never, "org-1", "HM1234", { status: "all", building: null, channel: "all" });
    const search = calls.rpc.find((c) => c.name === "guest_conversation_search")!;
    expect(search.args.p_organization_id).toBe("org-1");
    expect(search.args.p_limit).toBe(SEARCH_FETCH_LIMIT);
    expect(calls.eq.filter(([col]) => col === "organization_id").every(([, v]) => v === "org-1")).toBe(true);
    expect(calls.eq.some(([col]) => col === "organization_id")).toBe(true);
    for (const call of calls.rpc) expect(call.args.p_organization_id).toBe("org-1");
  });
  it("코드를 못 보는 사람은 가리기 정규식을 넘긴다(코드를 못 읽으면 숫자 묶음 전체)", async () => {
    const { db, calls } = fakeDb([], { failBuildingInfo: true });
    await searchInbox(db as never, "org-1", "482913", { status: "all", building: null, channel: "all" }, new Date(), {
      canSeeCodes: false,
      canManageAuto: false,
    });
    const args = calls.rpc.find((c) => c.name === "guest_conversation_search")!.args;
    expect(args.p_code_mask).toBe("[0-9#*]{3,}");
    const seen = fakeDb([]);
    await searchInbox(seen.db as never, "org-1", "482913", { status: "all", building: null, channel: "all" });
    expect(seen.calls.rpc.find((c) => c.name === "guest_conversation_search")!.args.p_code_mask).toBeUndefined();
  });
});

describe("검색 칸 상태", () => {
  const ready = { query: "umbrella", status: "ready" as const, results: [1], truncated: false };
  const failed = { query: "umbrella", status: "error" as const };
  it("다시 시도 — 실패 답을 지워 바로 찾는 중, 결과 답은 새 답까지 둔다", () => {
    expect(answerOnRunStart(failed)).toBeNull();
    expect(searchViewState(answerOnRunStart(failed), "umbrella")).toEqual({ current: null, loading: true, stale: null });
    expect(answerOnRunStart(ready)).toBe(ready);
    expect(answerOnRunStart(null)).toBeNull();
  });
  it("같은 검색어 답은 지금 답, 다른 검색어면 찾는 중 + 앞 결과 흐리게", () => {
    expect(searchViewState(ready, "umbrella")).toEqual({ current: ready, loading: false, stale: null });
    expect(searchViewState(ready, "umbrellas")).toEqual({ current: null, loading: true, stale: ready });
    expect(searchViewState(failed, "umbrellas").stale).toBeNull();
  });
  it("검색어가 없으면 아무것도 그리지 않는다(지운 뒤엔 답도 비운다)", () => {
    expect(searchViewState(ready, null)).toEqual({ current: null, loading: false, stale: null });
    expect(searchViewState(null, "umbrella")).toEqual({ current: null, loading: true, stale: null });
  });
  it("입력 칸 최대 길이 = 검색 길이 60", () => {
    expect(SEARCH_MAX_CHARS).toBe(60);
    expect(normalizeSearchQuery("a".repeat(70))).toHaveLength(SEARCH_MAX_CHARS);
  });
});
