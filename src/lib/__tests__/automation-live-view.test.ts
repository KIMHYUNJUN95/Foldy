import { describe, expect, it } from "vitest";
import {
  AUTOMATION_MIN_GAP_MS,
  AUTOMATION_POLL_MS,
  draftSubmitOf,
  draftSyncOf,
  editDraft,
  judgeLivePoll,
  liveRefreshDue,
  mergeDraftFields,
  pickLiveData,
  reconcileDraft,
  holdDraft,
  releaseDraft,
  settleDraft,
  draftVersionOf,
  type DraftSync,
  type LivePolled,
} from "@/lib/automation/live-view";

/**
 * 자동화 관제실 실시간 — 갱신 시점 · 응답 순서 · 초안 보호(2026-11-18).
 * 도메인 계약: docs/product/36-automation-control.md 「실시간(2026-11-18)」.
 */

/** `updatedAt` = 서버의 설정 줄 버전(automation_jobs.updated_at) — 초안 판정은 이것으로 「저장 전 / 뒤」를 가른다. */
type Props = { jobs: { sendTime: string; enabled: boolean; destinations: string[]; updatedAt: string | null }[]; credit: string; renderedAt: number };
type Live = Omit<Props, "credit" | "renderedAt">;
type Draft = { sendTime: string; destinations: string[] };

/** 버전 n → 서버 시각 문자열(n 초). 1 = 처음 그림. */
const v = (n: number) => new Date(Date.UTC(2026, 10, 19, 0, 0, n)).toISOString();
const props = (sendTime: string, destinations: string[] = ["a"], enabled = true, version = 1): Props => ({
  credit: "credit-from-server",
  jobs: [{ destinations, enabled, sendTime, updatedAt: v(version) }],
  renderedAt: 1,
});
const live = (sendTime: string, destinations: string[] = ["a"], enabled = true, version = 1): Live => ({
  jobs: [{ destinations, enabled, sendTime, updatedAt: v(version) }],
});
const draftOf = (data: Props): Draft => ({ destinations: [...data.jobs[0].destinations], sendTime: data.jobs[0].sendTime });

/** 훅(`useAutomationLive` + `useAutomationDraft`)과 같은 순서로 판정 함수를 부르는 작은 흉내. */
function simulate(initial: Props) {
  let currentProps = initial;
  let polled: LivePolled<Props, Live> | null = null;
  let issued = 0;
  let applied = 0;
  let renders = 0;
  // 화면과 같이 — 보이는 값은 (서버 그림, 폴링 값)이 그대로면 같은 객체(useMemo), 초안 원본도 보이는 값이 그대로면 같은 객체.
  let shownMemo: { props: Props; polled: LivePolled<Props, Live> | null; value: Props } | null = null;
  const shown = (): Props => {
    const memo = shownMemo;
    if (memo && memo.props === currentProps && memo.polled === polled) return memo.value;
    const value = pickLiveData(currentProps, polled);
    shownMemo = { polled, props: currentProps, value };
    return value;
  };
  let originalMemo: { from: Props; value: Draft } | null = null;
  const original = () => {
    const from = shown();
    if (!originalMemo || originalMemo.from !== from) originalMemo = { from, value: draftOf(from) };
    return originalMemo.value;
  };
  const version = () => draftVersionOf(shown().jobs[0].updatedAt);
  let draft: DraftSync<Draft> = draftSyncOf(original(), version());
  const render = () => {
    renders += 1;
    draft = reconcileDraft(draft, original(), version());
  };
  return {
    /** 요청을 보낸다 — 순번과 그때의 서버 그림을 기억. */
    issue() {
      return { basedOn: currentProps, token: ++issued };
    },
    /** 응답 도착. `null` 은 실패(조용히 무시). */
    land(request: { basedOn: Props; token: number }, next: Live | null) {
      if (!next) return "failed" as const;
      const verdict = judgeLivePoll({ appliedToken: applied, basedOn: request.basedOn, currentProps, next, shown: shown(), token: request.token });
      if (verdict === "stale" || verdict === "superseded") return verdict;
      applied = request.token;
      if (verdict === "apply") {
        polled = { basedOn: request.basedOn, data: next };
        render();
      }
      return verdict;
    },
    /** 저장 뒤 revalidate · router.refresh() 로 새 서버 그림이 온다. */
    serverRender(next: Props) {
      currentProps = next;
      render();
    },
    edit(update: (value: Draft) => Draft) {
      draft = editDraft(draft, update);
    },
    /** 저장을 보낸다(훅의 `submit()` — 표를 받고 저장 중 표시). */
    submit() {
      const ticket = draftSubmitOf(draft);
      draft = holdDraft(draft);
      return ticket;
    },
    /** 저장 성공 — 서버가 돌려준 새 버전(기본 2). */
    settle(ticket: ReturnType<typeof draftSubmitOf>, savedVersion = 2) {
      draft = settleDraft(draft, ticket, draftVersionOf(v(savedVersion)));
      render();
    },
    /** 저장 실패 · 예외. */
    fail() {
      draft = releaseDraft(draft);
      render();
    },
    get shown() {
      return shown();
    },
    get draft() {
      return draft.draft;
    },
    get dirty() {
      return JSON.stringify(draft.draft) !== draft.base;
    },
    get renders() {
      return renders;
    },
  };
}

describe("liveRefreshDue — 언제 다시 읽나", () => {
  const base = { inFlight: false, lastFetchedAt: 0, minGapMs: AUTOMATION_MIN_GAP_MS, now: 10_000, visible: true };
  it("보이고 · 받는 중이 아니고 · 5초가 지났으면 읽는다", () => expect(liveRefreshDue(base)).toBe(true));
  it("탭이 안 보이면 읽지 않는다", () => expect(liveRefreshDue({ ...base, visible: false })).toBe(false));
  it("받는 중이면 겹쳐 보내지 않는다", () => expect(liveRefreshDue({ ...base, inFlight: true })).toBe(false));
  it("방금(5초 안) 받았으면 복귀해도 건너뛴다", () => expect(liveRefreshDue({ ...base, lastFetchedAt: 6_000 })).toBe(false));
  it("간격은 15초 · 최소 간격 5초", () => {
    expect(AUTOMATION_POLL_MS).toBe(15_000);
    expect(AUTOMATION_MIN_GAP_MS).toBe(5_000);
  });
});

describe("pickLiveData — 어느 값을 보이나", () => {
  it("폴링 값이 없으면 서버 그림", () => expect(pickLiveData(props("09:00"), null).jobs[0].sendTime).toBe("09:00"));
  it("지금 서버 그림을 바탕으로 받은 폴링 값이면 덮되, 응답에 없는 칸(크레딧)은 서버 그림 그대로", () => {
    const p = props("09:00");
    const view = pickLiveData(p, { basedOn: p, data: live("10:00") });
    expect(view.jobs[0].sendTime).toBe("10:00");
    expect(view.credit).toBe("credit-from-server");
  });
  it("서버 그림이 새로 오면 그전 폴링 값은 버린다", () => {
    const old = props("09:00");
    expect(pickLiveData(props("11:00"), { basedOn: old, data: live("10:00") }).jobs[0].sendTime).toBe("11:00");
  });
});

describe("judgeLivePoll — 어느 응답이 이기나", () => {
  const p = props("09:00");
  it("이미 더 나중 요청을 반영했으면 stale", () =>
    expect(judgeLivePoll({ appliedToken: 3, basedOn: p, currentProps: p, next: live("10:00"), shown: p, token: 2 })).toBe("stale"));
  it("요청 뒤 서버 그림이 바뀌었으면 superseded", () =>
    expect(judgeLivePoll({ appliedToken: 0, basedOn: p, currentProps: props("11:00"), next: live("10:00"), shown: p, token: 1 })).toBe("superseded"));
  it("보이는 값과 같으면 same(다시 그리지 않음)", () =>
    expect(judgeLivePoll({ appliedToken: 0, basedOn: p, currentProps: p, next: live("09:00"), shown: p, token: 1 })).toBe("same"));
  it("다르면 apply", () =>
    expect(judgeLivePoll({ appliedToken: 0, basedOn: p, currentProps: p, next: live("10:00"), shown: p, token: 1 })).toBe("apply"));
});

describe("reconcileDraft — 초안 보호(저장 없음)", () => {
  const s0 = draftSyncOf<Draft>({ destinations: ["a"], sendTime: "09:00" }, 1);
  it("서버 값이 같은 객체면 같은 상태 객체(다시 그리기 없음)", () => expect(reconcileDraft(s0, s0.original, 1)).toBe(s0));
  it("내용이 같은 새 객체면 초안 · 기준은 그대로, 원본 객체만 바꾼다", () => {
    const next = reconcileDraft(s0, { destinations: ["a"], sendTime: "09:00" }, 1);
    expect(next.draft).toBe(s0.draft);
    expect(next.base).toBe(s0.base);
    expect(reconcileDraft(next, next.original, 1)).toBe(next);
  });
  it("손대지 않았으면 새 서버 값을 받는다", () => expect(reconcileDraft(s0, { destinations: ["a"], sendTime: "10:00" }, 2).draft.sendTime).toBe("10:00"));
  it("손대던 중이면 손댄 칸만 지키고(나머지는 따름) 비교 기준을 옮긴다", () => {
    const editing = editDraft(s0, (d) => ({ ...d, sendTime: "08:30" }));
    const next = reconcileDraft(editing, { destinations: ["a", "b"], sendTime: "09:00" }, 2);
    expect(next.draft.sendTime).toBe("08:30");
    expect(next.draft.destinations).toEqual(["a", "b"]);
    expect(next.base).toBe(JSON.stringify({ destinations: ["a", "b"], sendTime: "09:00" }));
  });
  it("버전을 모르는 그림(아직 저장한 적 없는 자동화)도 저장 전이면 받는다", () =>
    expect(reconcileDraft(draftSyncOf<Draft>({ destinations: [], sendTime: "09:00" }, null), { destinations: ["a"], sendTime: "09:00" }, null).draft.destinations).toEqual(["a"]));
  it("버전 읽기 — 서버 시각 문자열(Z · +00:00)은 같은 순간이면 같은 수, 없거나 못 읽으면 null", () => {
    expect(draftVersionOf("2026-11-19T00:00:01.123Z")).toBe(draftVersionOf("2026-11-19T00:00:01.123+00:00"));
    expect(draftVersionOf(null)).toBeNull();
    expect(draftVersionOf("x")).toBeNull();
  });
});

describe("상황표 — 편집 중/아님 × 폴링/저장 응답 × 순서 뒤바뀜 × 실패", () => {
  for (const editing of [false, true]) {
    const label = editing ? "편집 중" : "편집 안 함";

    it(`${label} · 폴링 응답이 다른 사람의 변경을 가져온다`, () => {
      const sim = simulate(props("09:00"));
      if (editing) sim.edit((d) => ({ ...d, sendTime: "08:30" }));
      expect(sim.land(sim.issue(), live("10:00", ["a", "b"]))).toBe("apply");
      expect(sim.shown.jobs[0].sendTime).toBe("10:00");
      expect(sim.draft.sendTime).toBe(editing ? "08:30" : "10:00");
      expect(sim.dirty).toBe(editing);
    });

    it(`${label} · 같은 값 폴링은 다시 그리지 않는다`, () => {
      const sim = simulate(props("09:00"));
      if (editing) sim.edit((d) => ({ ...d, sendTime: "08:30" }));
      expect(sim.land(sim.issue(), live("09:00"))).toBe("same");
      expect(sim.renders).toBe(0);
      expect(sim.draft.sendTime).toBe(editing ? "08:30" : "09:00");
    });

    it(`${label} · 폴링 두 개가 거꾸로 도착하면 나중에 보낸 쪽이 이긴다`, () => {
      const sim = simulate(props("09:00"));
      if (editing) sim.edit((d) => ({ ...d, sendTime: "08:30" }));
      const first = sim.issue();
      const second = sim.issue();
      expect(sim.land(second, live("11:00"))).toBe("apply");
      expect(sim.land(first, live("10:00"))).toBe("stale");
      expect(sim.shown.jobs[0].sendTime).toBe("11:00");
      expect(sim.draft.sendTime).toBe(editing ? "08:30" : "11:00");
    });

    it(`${label} · 실패는 조용히 — 보이는 값 · 초안 그대로`, () => {
      const sim = simulate(props("09:00"));
      if (editing) sim.edit((d) => ({ ...d, sendTime: "08:30" }));
      expect(sim.land(sim.issue(), null)).toBe("failed");
      expect(sim.shown.jobs[0].sendTime).toBe("09:00");
      expect(sim.draft.sendTime).toBe(editing ? "08:30" : "09:00");
      expect(sim.renders).toBe(0);
    });

    it(`${label} · 저장 전에 보낸 폴링이 저장 뒤 서버 그림보다 늦게 와도 서버 그림이 이긴다`, () => {
      const sim = simulate(props("09:00"));
      if (editing) sim.edit((d) => ({ ...d, sendTime: "08:30" }));
      const before = sim.issue();
      sim.serverRender(props("08:30"));
      expect(sim.land(before, live("09:00"))).toBe("superseded");
      expect(sim.shown.jobs[0].sendTime).toBe("08:30");
      expect(sim.draft.sendTime).toBe("08:30");
      expect(sim.dirty).toBe(false);
    });

    it(`${label} · 서버 그림 뒤에 보낸 폴링은 서버 그림을 덮는다(더 나중 값)`, () => {
      const sim = simulate(props("09:00"));
      if (editing) sim.edit((d) => ({ ...d, sendTime: "08:30" }));
      sim.serverRender(props("09:00", ["a"], false));
      expect(sim.land(sim.issue(), live("09:00", ["a"], true))).toBe("apply");
      expect(sim.shown.jobs[0].enabled).toBe(true);
      expect(sim.draft.sendTime).toBe(editing ? "08:30" : "09:00");
    });
  }

});

describe("칸 단위 초안 — 손댄 칸만 남고 나머지는 서버 값을 따른다(독립 검사 재현, 2026-11-18)", () => {
  type Form = { sendTime: string; retryUntil: string; weekdays: number[]; settings: { channels: string[]; resend: { enabled: boolean; until: string } } };
  const form = (over: Partial<Form> = {}): Form => ({
    retryUntil: "10:00",
    sendTime: "06:45",
    settings: { channels: ["line"], resend: { enabled: false, until: "12:00" } },
    weekdays: [1, 2, 3],
    ...over,
  });
  const changed = (s: DraftSync<Form>) =>
    (Object.keys(s.draft) as (keyof Form)[]).filter((key) => JSON.stringify(s.draft[key]) !== JSON.stringify(s.original[key]));

  it("재현 — 한 칸(마감)만 고친 채 다른 사람이 시각을 07:10 으로 바꾸면 시각은 07:10 을 따르고 「바뀐 곳」은 1", () => {
    const edited = editDraft(draftSyncOf(form(), 1), (d) => ({ ...d, retryUntil: "11:30" }));
    const next = reconcileDraft(edited, form({ sendTime: "07:10" }), 2);
    expect(next.draft.sendTime).toBe("07:10");
    expect(next.draft.retryUntil).toBe("11:30");
    expect(changed(next)).toEqual(["retryUntil"]);
    // 이대로 저장하면 다른 사람의 07:10 을 되돌리지 않는다.
    expect(JSON.parse(draftSubmitOf(next).draft).sendTime).toBe("07:10");
  });

  it("묶음 안(설정 · 재발송)도 칸 단위 — 재발송 켜기만 고쳤으면 서버의 채널 변경은 따른다", () => {
    const edited = editDraft(draftSyncOf(form(), 1), (d) => ({ ...d, settings: { ...d.settings, resend: { ...d.settings.resend, enabled: true } } }));
    const next = reconcileDraft(edited, form({ settings: { channels: ["line", "slack"], resend: { enabled: false, until: "13:00" } } }), 2);
    expect(next.draft.settings).toEqual({ channels: ["line", "slack"], resend: { enabled: true, until: "13:00" } });
  });

  it("손댄 칸을 서버도 바꿨으면 내 값이 남고 기준만 새 서버 값 — 「바뀐 곳」에 그대로 보이고, 저장하면 내 값(마지막 저장이 이긴다)", () => {
    const edited = editDraft(draftSyncOf(form(), 1), (d) => ({ ...d, sendTime: "08:00" }));
    const next = reconcileDraft(edited, form({ sendTime: "07:10" }), 2);
    expect(next.draft.sendTime).toBe("08:00");
    expect(next.original.sendTime).toBe("07:10");
    expect(changed(next)).toEqual(["sendTime"]);
  });

  it("목록 칸(요일 · 받는 곳)은 통째로 한 칸 — 내가 고친 목록은 남고, 안 고친 목록은 따른다", () => {
    const edited = editDraft(draftSyncOf(form(), 1), (d) => ({ ...d, weekdays: [1, 2] }));
    const next = reconcileDraft(edited, form({ weekdays: [1, 2, 3, 4], settings: { channels: ["slack"], resend: { enabled: false, until: "12:00" } } }), 2);
    expect(next.draft.weekdays).toEqual([1, 2]);
    expect(next.draft.settings.channels).toEqual(["slack"]);
  });

  it("고쳤다가 원래 값으로 되돌린 칸은 손대지 않은 칸 — 서버 값을 따른다", () => {
    const edited = editDraft(editDraft(draftSyncOf(form(), 1), (d) => ({ ...d, sendTime: "08:00" })), (d) => ({ ...d, sendTime: "06:45" }));
    expect(reconcileDraft(edited, form({ sendTime: "07:10" }), 2).draft.sendTime).toBe("07:10");
  });
});

/**
 * 저장 상황표(2026-11-19 세 번째 리뷰) — 「저장 전 / 뒤」를 **서버 버전**(automation_jobs.updated_at)으로 가른다.
 * 저장 중에 온 그림은 맞추지 않고 미뤄 두고(원본만 기억), 저장 성공이 돌려준 버전보다 옛 그림은 저장 전 값이라 버린다.
 * 버전 1 = 처음 그림, 2 = 다른 사람(B)이 내 저장보다 먼저 쓴 값, 3 = 내 저장.
 */
describe("저장 상황표 — 서버 버전으로 「저장 전 / 뒤」를 가른다", () => {
  const start = () => simulate(props("09:00", ["a"]));

  it("저장 전 폴링 · 같은 내용(초안 밖 칸만 다름)이 저장 중 도착 → 저장 성공: 저장한 값 그대로, 「바뀜」 없음", () => {
    const sim = start();
    const poll = sim.issue();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    const ticket = sim.submit();
    expect(sim.land(poll, live("09:00", ["a"], false, 1))).toBe("apply");
    expect(sim.draft.sendTime).toBe("08:30");
    sim.settle(ticket, 3);
    expect(sim.draft).toEqual({ destinations: ["a"], sendTime: "08:30" });
    expect(sim.dirty).toBe(false);
  });

  it("저장 전 폴링 · 같은 내용 그대로(same) — 다시 그리지 않고 저장 성공 뒤 「바뀜」 없음", () => {
    const sim = start();
    const poll = sim.issue();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    const ticket = sim.submit();
    expect(sim.land(poll, live("09:00", ["a"], true, 1))).toBe("same");
    sim.settle(ticket, 3);
    expect(sim.draft.sendTime).toBe("08:30");
    expect(sim.dirty).toBe(false);
  });

  it("문제 1 — 저장 중 온 폴링에 다른 사람의 다른 칸 변경(받는 곳 [a,b], 버전 2): 저장 성공 뒤 내가 저장한 값 그대로(시각 08:30 · 받는 곳 [a])", () => {
    const sim = start();
    const poll = sim.issue();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    const ticket = sim.submit();
    sim.land(poll, live("09:00", ["a", "b"], true, 2));
    // 저장 중에는 초안을 건드리지 않는다 — 보내는 값과 화면이 같다.
    expect(sim.draft).toEqual({ destinations: ["a"], sendTime: "08:30" });
    sim.settle(ticket, 3);
    // 내 저장이 설정 줄 · 받는 곳을 통째로 썼으므로 서버도 {08:30, [a]} — 버전 2 그림은 저장 전 값이다.
    expect(sim.draft).toEqual({ destinations: ["a"], sendTime: "08:30" });
    expect(sim.dirty).toBe(false);
    sim.serverRender(props("08:30", ["a"], true, 3));
    expect(sim.draft).toEqual({ destinations: ["a"], sendTime: "08:30" });
    expect(sim.dirty).toBe(false);
  });

  it("저장 중 온 폴링에 내가 저장한 바로 그 칸의 다른 값(B 의 10:00, 버전 2): 저장 성공 뒤 내 값 08:30", () => {
    const sim = start();
    const poll = sim.issue();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    const ticket = sim.submit();
    sim.land(poll, live("10:00", ["a"], true, 2));
    sim.settle(ticket, 3);
    expect(sim.draft.sendTime).toBe("08:30");
    expect(sim.dirty).toBe(false);
  });

  it("저장 전 폴링이 저장 성공 **뒤** 도착(다른 사람 변경 포함, 버전 2) → 버린다", () => {
    const sim = start();
    const poll = sim.issue();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    sim.settle(sim.submit(), 3);
    sim.land(poll, live("09:00", ["a", "b"], true, 2));
    expect(sim.draft).toEqual({ destinations: ["a"], sendTime: "08:30" });
    expect(sim.dirty).toBe(false);
  });

  it("저장 실패 — 미뤄 둔 그림(B 의 받는 곳 변경)을 그때 맞추고(내 편집은 남김), 이후 폴링도 막지 않는다", () => {
    const sim = start();
    const poll = sim.issue();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    sim.submit();
    sim.land(poll, live("09:00", ["a", "b"], true, 2));
    sim.fail();
    expect(sim.draft).toEqual({ destinations: ["a", "b"], sendTime: "08:30" });
    expect(sim.dirty).toBe(true);
    sim.land(sim.issue(), live("09:00", ["a", "b", "c"], true, 4));
    expect(sim.draft).toEqual({ destinations: ["a", "b", "c"], sendTime: "08:30" });
  });

  it("저장 실패 · 그사이 그림 없음 — 초안 그대로", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    sim.submit();
    sim.fail();
    expect(sim.draft.sendTime).toBe("08:30");
    expect(sim.dirty).toBe(true);
  });

  it("저장 뒤 서버가 정리한 그림 · 저장 전과 다른 값 → 받는다", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, destinations: ["c", "b"] }));
    sim.settle(sim.submit(), 3);
    expect(sim.dirty).toBe(false);
    sim.serverRender(props("09:00", ["b", "c"], true, 3));
    expect(sim.draft.destinations).toEqual(["b", "c"]);
    expect(sim.dirty).toBe(false);
  });

  it("저장 뒤 서버가 정리한 그림 · 저장 전과 같은 값(순서만 바꿨는데 서버가 원래대로) → 받는다(지난 한계 풀림)", () => {
    const sim = simulate(props("09:00", ["a", "b"]));
    sim.edit((d) => ({ ...d, destinations: ["b", "a"] }));
    sim.settle(sim.submit(), 3);
    sim.serverRender(props("09:00", ["a", "b"], true, 3));
    expect(sim.draft.destinations).toEqual(["a", "b"]);
    expect(sim.dirty).toBe(false);
  });

  it("저장 뒤 그림이 settle 보다 먼저(PC — 저장 응답의 revalidate) → settle 때 맞춘다", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, destinations: ["c", "b"] }));
    const ticket = sim.submit();
    sim.serverRender(props("09:00", ["b", "c"], true, 3));
    expect(sim.draft.destinations).toEqual(["c", "b"]);
    sim.settle(ticket, 3);
    expect(sim.draft.destinations).toEqual(["b", "c"]);
    expect(sim.dirty).toBe(false);
  });

  it("저장 뒤 또 고친 채 서버가 저장한 칸을 정리해 돌려줌 → 그 칸은 서버 값, 「바뀜」은 새로 고친 칸만", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, destinations: ["c", "b"] }));
    sim.settle(sim.submit(), 3);
    sim.edit((d) => ({ ...d, sendTime: "07:00" }));
    sim.serverRender(props("09:00", ["b", "c"], true, 3));
    expect(sim.draft).toEqual({ destinations: ["b", "c"], sendTime: "07:00" });
    expect(sim.dirty).toBe(true);
  });

  it("보낸 뒤 또 고치고 저장 성공 → 새 편집은 남고 기준은 저장한 값", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    const ticket = sim.submit();
    sim.edit((d) => ({ ...d, destinations: ["a", "c"] }));
    sim.settle(ticket, 3);
    expect(sim.draft).toEqual({ destinations: ["a", "c"], sendTime: "08:30" });
    sim.serverRender(props("08:30", ["a"], true, 3));
    expect(sim.draft).toEqual({ destinations: ["a", "c"], sendTime: "08:30" });
    expect(sim.dirty).toBe(true);
  });

  it("문제 2 — 연속 저장 두 번, 첫 저장 그림이 늦게 옴: 두 번째 저장 값 그대로, 첫 그림은 버리고 두 번째 그림은 받는다", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    sim.settle(sim.submit(), 3);
    sim.edit((d) => ({ ...d, destinations: ["a", "b"] }));
    sim.settle(sim.submit(), 4);
    expect(sim.draft).toEqual({ destinations: ["a", "b"], sendTime: "08:30" });
    expect(sim.dirty).toBe(false);
    sim.serverRender(props("08:30", ["a"], true, 3));
    expect(sim.draft).toEqual({ destinations: ["a", "b"], sendTime: "08:30" });
    expect(sim.dirty).toBe(false);
    sim.serverRender(props("08:30", ["a", "b"], true, 4));
    expect(sim.draft).toEqual({ destinations: ["a", "b"], sendTime: "08:30" });
    expect(sim.dirty).toBe(false);
  });

  it("연속 저장 · 첫 저장 그림이 두 번째 저장 전에 옴 → 평소대로 받고 이어서 저장", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    sim.settle(sim.submit(), 3);
    sim.serverRender(props("08:30", ["a"], true, 3));
    sim.edit((d) => ({ ...d, destinations: ["a", "b"] }));
    sim.settle(sim.submit(), 4);
    expect(sim.draft).toEqual({ destinations: ["a", "b"], sendTime: "08:30" });
    expect(sim.dirty).toBe(false);
  });

  it("저장 뒤 props 그림이 먼저, 저장 전에 보낸 폴링이 나중 → 폴링은 superseded(서버 그림이 이김)", () => {
    const sim = start();
    const before = sim.issue();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    sim.settle(sim.submit(), 3);
    sim.serverRender(props("08:30", ["a"], true, 3));
    expect(sim.land(before, live("09:00", ["a"], true, 1))).toBe("superseded");
    expect(sim.draft.sendTime).toBe("08:30");
  });

  it("저장 뒤 보낸 폴링이 props 그림보다 먼저 → 저장 뒤 값이라 받고, props 는 같은 값", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    sim.settle(sim.submit(), 3);
    sim.land(sim.issue(), live("08:30", ["a"], false, 3));
    expect(sim.draft.sendTime).toBe("08:30");
    sim.serverRender(props("08:30", ["a"], false, 3));
    expect(sim.draft.sendTime).toBe("08:30");
    expect(sim.dirty).toBe(false);
  });

  it("저장 중 보냈지만 서버에서 저장 전에 읽힌 폴링(액션 줄 버림으로 겹쳐 돎, 버전 1)이 저장 뒤 도착 → 버전이 옛 것이라 버린다", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, sendTime: "08:30" }));
    const ticket = sim.submit();
    const during = sim.issue();
    sim.settle(ticket, 3);
    sim.land(during, live("09:00", ["a"], false, 1));
    expect(sim.draft.sendTime).toBe("08:30");
    expect(sim.dirty).toBe(false);
  });

  it("남는 한계 — 내 저장 도중(설정 줄은 썼고 받는 곳은 아직)에 읽힌 그림은 내 버전이라 받는다: 받는 곳이 잠깐 옛 값", () => {
    const sim = start();
    sim.edit((d) => ({ ...d, destinations: ["a", "b"], sendTime: "08:30" }));
    const ticket = sim.submit();
    const during = sim.issue();
    sim.settle(ticket, 3);
    sim.land(during, live("08:30", ["a"], false, 3));
    expect(sim.draft.destinations).toEqual(["a"]);
    // 다음 그림(revalidate · refresh · 다음 폴링)에서 맞춰진다.
    sim.serverRender(props("08:30", ["a", "b"], true, 3));
    expect(sim.draft.destinations).toEqual(["a", "b"]);
  });
});

describe("mergeDraftFields — 서버에서 없어진 칸", () => {
  it("손대지 않은 칸이 서버에서 없어지면 초안에서도 뺀다", () =>
    expect(mergeDraftFields<Record<string, unknown>>({ a: 1, gone: 2 }, { a: 1, gone: 2 }, { a: 1 })).toEqual({ a: 1 }));
  it("손댄 칸은 서버에서 없어져도 남긴다", () =>
    expect(mergeDraftFields<Record<string, unknown>>({ a: 1, gone: 3 }, { a: 1, gone: 2 }, { a: 1 })).toEqual({ a: 1, gone: 3 }));
});
