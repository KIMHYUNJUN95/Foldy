import { describe, expect, it } from "vitest";

import type { CandidateOverview, CandidateView } from "@/lib/guest-messages/reply-candidates-server";
import {
  applyResult,
  candidateButtons,
  candidateCounts,
  candidateScreen,
  candidatesFor,
  createDecisionQueue,
  putAllOutcome,
  splitPutAll,
  whenConfirmed,
  whenConfirmedHere,
  createNavStamp,
  draftOf,
  entryCounts,
  groupByBuilding,
  isEdited,
  isLongValue,
  nextAfter,
  RUN_STALE_MS,
  runButton,
  runFinished,
  runNote,
  settleStaleRun,
  splitMasked,
  type CandidateLoad,
} from "@/lib/guest-messages/reply-candidates-view";

const L = (ko: string, ja = ko, en = ko) => ({ ko, ja, en });

function cand(over: Partial<CandidateView> & Pick<CandidateView, "id">): CandidateView {
  return {
    kind: "saved_reply",
    status: "pending",
    title: L("짐 맡기기", "荷物預かり", "Luggage"),
    question: L(""),
    bodies: L("체크인 전 짐은…", "チェックイン前…", "Before check-in…"),
    note: L(""),
    askCount: 3,
    firstAskedAt: null,
    lastAskedAt: null,
    evidence: [],
    similarSavedReplyId: null,
    propertyName: null,
    field: null,
    options: [],
    decidedAt: null,
    canUndo: false,
    ...over,
  };
}

function overview(pending: CandidateView[], decided: CandidateView[] = [], available = true): CandidateOverview {
  return { available, lastRun: null, pending, decided };
}

const ready = (o: CandidateOverview, kinds: CandidateView["kind"][] = ["saved_reply", "guest_info"], canRun = true): CandidateLoad => ({
  kind: "ready",
  overview: o,
  kinds,
  canRun,
});

describe("candidateScreen — 화면 상태 하나로", () => {
  it("읽는 중 · 실패는 그대로", () => {
    expect(candidateScreen({ kind: "loading" }, "saved_reply", "pending")).toBe("loading");
    expect(candidateScreen({ kind: "error" }, "saved_reply", "pending")).toBe("error");
  });

  it("그 종류 권한이 없으면 forbidden", () => {
    expect(candidateScreen(ready(overview([cand({ id: "a" })]), ["guest_info"]), "saved_reply", "pending")).toBe("forbidden");
  });

  it("하나도 없으면 empty, 키가 없으면 unavailable", () => {
    expect(candidateScreen(ready(overview([])), "saved_reply", "pending")).toBe("empty");
    expect(candidateScreen(ready(overview([], [], false)), "saved_reply", "pending")).toBe("unavailable");
  });

  it("키가 없어도 이미 있는 후보는 보인다", () => {
    expect(candidateScreen(ready(overview([cand({ id: "a" })], [], false)), "saved_reply", "pending")).toBe("list");
  });

  it("남은 것이 0 이고 끝낸 것이 있으면 done — 다른 거르기는 filter-empty", () => {
    const o = overview([], [cand({ id: "a", status: "added" })]);
    expect(candidateScreen(ready(o), "saved_reply", "pending")).toBe("done");
    expect(candidateScreen(ready(o), "saved_reply", "added")).toBe("list");
    expect(candidateScreen(ready(o), "saved_reply", "dismissed")).toBe("filter-empty");
  });

  it("다른 종류 후보는 세지 않는다", () => {
    const o = overview([cand({ id: "g", kind: "guest_info", propertyName: "아라키초A", field: "checkIn" })]);
    expect(candidateScreen(ready(o), "saved_reply", "pending")).toBe("empty");
    expect(candidateScreen(ready(o), "guest_info", "pending")).toBe("list");
  });
});

describe("candidateButtons — 권한 · 상태별 버튼", () => {
  const both: CandidateView["kind"][] = ["saved_reply", "guest_info"];
  it("남은 것: 추가 · 고치기 · 빼기", () => {
    expect(candidateButtons({ kind: "saved_reply", status: "pending" }, both)).toEqual({ add: true, edit: true, dismiss: true, restore: false });
  });
  it("뺀 것: 되돌리기만", () => {
    expect(candidateButtons({ kind: "guest_info", status: "dismissed" }, both)).toEqual({ add: false, edit: false, dismiss: false, restore: true });
  });
  it("추가한 것: 버튼 없음", () => {
    expect(candidateButtons({ kind: "saved_reply", status: "added" }, both)).toEqual({ add: false, edit: false, dismiss: false, restore: false });
  });
  it("그 종류 권한이 없으면 아무 버튼도 없다", () => {
    expect(candidateButtons({ kind: "saved_reply", status: "pending" }, ["guest_info"])).toEqual({ add: false, edit: false, dismiss: false, restore: false });
    expect(candidateButtons({ kind: "guest_info", status: "dismissed" }, ["saved_reply"]).restore).toBe(false);
  });
});

describe("runButton — 다시 찾기", () => {
  it("canRun 이 없으면 숨긴다", () => {
    expect(runButton(ready(overview([]), ["saved_reply"], false))).toBe("hidden");
  });
  it("키가 없으면 숨긴다", () => {
    expect(runButton(ready(overview([], [], false)))).toBe("hidden");
  });
  it("돌고 있으면 running", () => {
    const o = overview([]);
    o.lastRun = { status: "running", startedAt: "", finishedAt: null, sourceCount: 0, sourceSince: null, errorKey: null, skipNotes: [] };
    expect(runButton(ready(o))).toBe("running");
  });
  it("읽는 중 · 실패면 숨긴다", () => {
    expect(runButton({ kind: "loading" })).toBe("hidden");
    expect(runButton({ kind: "error" })).toBe("hidden");
  });
  it("그 외엔 ready", () => {
    expect(runButton(ready(overview([])))).toBe("ready");
  });
});

describe("수 세기 · 거르기", () => {
  const o = overview(
    [cand({ id: "a" }), cand({ id: "g", kind: "guest_info", propertyName: "아라키초A", field: "checkIn" }), cand({ id: "b" })],
    [cand({ id: "c", status: "dismissed" }), cand({ id: "d", status: "added" })],
  );
  it("candidateCounts", () => {
    expect(candidateCounts(o, "saved_reply")).toEqual({ pending: 2, added: 1, dismissed: 1 });
    expect(candidateCounts(o, "guest_info")).toEqual({ pending: 1, added: 0, dismissed: 0 });
  });
  it("candidatesFor 는 서버 순서를 지킨다", () => {
    expect(candidatesFor(o, "saved_reply", "pending").map((c) => c.id)).toEqual(["a", "b"]);
    expect(candidatesFor(o, "saved_reply", "dismissed").map((c) => c.id)).toEqual(["c"]);
  });
  it("entryCounts 는 권한 있는 종류만 센다", () => {
    expect(entryCounts(o, ["saved_reply", "guest_info"])).toEqual({ replies: 2, info: 1, total: 3 });
    expect(entryCounts(o, ["guest_info"])).toEqual({ replies: 0, info: 1, total: 1 });
  });
});

describe("groupByBuilding", () => {
  it("건물마다 묶고 값이 둘인 칸을 센다", () => {
    const opt = (v: string) => ({ value: L(v), count: 1, firstAt: "", lastAt: "" });
    const groups = groupByBuilding([
      cand({ id: "1", kind: "guest_info", propertyName: "아라키초A", field: "checkIn", options: [opt("15시"), opt("16시")] }),
      cand({ id: "2", kind: "guest_info", propertyName: "오쿠보B", field: "trash", options: [opt("1층")] }),
      cand({ id: "3", kind: "guest_info", propertyName: "아라키초A", field: "checkOut", options: [opt("10시")] }),
      cand({ id: "4" }),
    ]);
    expect(groups.map((g) => [g.propertyName, g.fields.map((f) => f.id), g.conflicts])).toEqual([
      ["아라키초A", ["1", "3"], 1],
      ["오쿠보B", ["2"], 0],
    ]);
  });
});

describe("고치기 · 다음 고르기 · 가린 자리", () => {
  it("draftOf 는 화면 언어 이름, 고치면 isEdited", () => {
    const c = cand({ id: "a" });
    const d = draftOf(c, "ja");
    expect(d.title).toBe("荷物預かり");
    expect(isEdited(c, d, "ja")).toBe(false);
    expect(isEdited(c, { ...d, bodies: { ...d.bodies, en: "x" } }, "ja")).toBe(true);
    expect(isEdited(c, { ...d, title: "y" }, "ja")).toBe(true);
  });
  it("nextAfter 는 같은 자리 → 앞", () => {
    expect(nextAfter(["a", "b", "c"], "b")).toBe("c");
    expect(nextAfter(["a", "b", "c"], "c")).toBe("b");
    expect(nextAfter(["a"], "a")).toBeNull();
  });
  it("isLongValue", () => {
    expect(isLongValue(L("15시"), "ko")).toBe(false);
    expect(isLongValue(L("가".repeat(41)), "ko")).toBe(true);
  });
  it("splitMasked 는 […] 를 •••• 로", () => {
    expect(splitMasked("문 번호는 […] 이고 […]")).toEqual([
      { masked: false, text: "문 번호는 " },
      { masked: true, text: "••••" },
      { masked: false, text: " 이고 " },
      { masked: true, text: "••••" },
    ]);
  });
});

describe("applyResult — 결정 뒤 목록", () => {
  const o = overview([cand({ id: "a", askCount: 9 }), cand({ id: "b", askCount: 5 }), cand({ id: "c", askCount: 2 })], [cand({ id: "d", status: "added" })]);
  it("추가하면 남은 것에서 빠지고 끝낸 것 맨 앞", () => {
    const next = applyResult(o, cand({ id: "b", status: "added", askCount: 5 }));
    expect(next.pending.map((c) => c.id)).toEqual(["a", "c"]);
    expect(next.decided.map((c) => c.id)).toEqual(["b", "d"]);
  });
  it("되돌리면 많이 물어본 순 자리로", () => {
    const next = applyResult(o, cand({ id: "d", status: "pending", askCount: 3 }));
    expect(next.pending.map((c) => c.id)).toEqual(["a", "b", "d", "c"]);
    expect(next.decided).toEqual([]);
  });
  it("가장 적으면 맨 뒤, 원본은 그대로", () => {
    const next = applyResult(o, cand({ id: "d", status: "pending", askCount: 1 }));
    expect(next.pending.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(o.decided.map((c) => c.id)).toEqual(["d"]);
  });
});

describe("다시 찾기 — 낡은 실행 · 지난 실행 한 줄 · 끝남 알아채기", () => {
  const base = { status: "running" as const, startedAt: "2026-11-19T00:00:00.000Z", finishedAt: null, sourceCount: 10, sourceSince: null, errorKey: null, skipNotes: [] };
  const started = Date.parse(base.startedAt);

  it("15분 넘게 running 이면 failed · stale 로 보여 준다(경계 포함 아님)", () => {
    expect(settleStaleRun(base, started + RUN_STALE_MS).status).toBe("running");
    const stale = settleStaleRun(base, started + RUN_STALE_MS + 1);
    expect(stale).toMatchObject({ status: "failed", errorKey: "stale" });
  });

  it("끝난 실행 · 시각을 못 읽는 실행은 그대로", () => {
    const done = { ...base, status: "done" as const };
    expect(settleStaleRun(done, started + RUN_STALE_MS * 10)).toBe(done);
    const bad = { ...base, startedAt: "" };
    expect(settleStaleRun(bad, started + RUN_STALE_MS * 10)).toBe(bad);
  });

  it("낡은 실행은 「다시 찾기」를 다시 누를 수 있다", () => {
    const load: CandidateLoad = { kind: "ready", overview: { available: true, lastRun: settleStaleRun(base, started + RUN_STALE_MS + 1), pending: [], decided: [] }, kinds: ["saved_reply"], canRun: true };
    expect(runButton(load)).toBe("ready");
  });

  it("지난 실행 한 줄 — 실패 · 한도 · 멈춤만, 키 없음 · 끝남 · 도는 중은 없음", () => {
    expect(runNote(null)).toBeNull();
    expect(runNote(base)).toBeNull();
    expect(runNote({ ...base, status: "done" })).toBeNull();
    expect(runNote({ ...base, status: "failed", errorKey: "failed" })).toBe("failed");
    expect(runNote({ ...base, status: "failed", errorKey: null })).toBe("failed");
    expect(runNote({ ...base, status: "failed", errorKey: "cap" })).toBe("cap");
    expect(runNote({ ...base, status: "failed", errorKey: "stale" })).toBe("stale");
    expect(runNote({ ...base, status: "failed", errorKey: "unavailable" })).toBeNull();
  });

  it("도는 중 → 끝남 · 실패로 바뀔 때만 알린다", () => {
    expect(runFinished({ status: "running" }, { ...base, status: "done" })).toBe("done");
    expect(runFinished({ status: "running" }, { ...base, status: "failed", errorKey: "cap" })).toBe("failed");
    expect(runFinished({ status: "running" }, base)).toBeNull();
    expect(runFinished({ status: "running" }, null)).toBeNull();
    expect(runFinished({ status: "done" }, { ...base, status: "done" })).toBeNull();
    expect(runFinished(null, { ...base, status: "done" })).toBeNull();
  });
});

describe("결정 줄 · 서버 확인 뒤 넘기기 · 모두 넣기", () => {
  it("같은 후보를 빠르게 두 번 누르면 두 번째는 받지 않는다", () => {
    const lane = createDecisionQueue({ ok: false });
    expect(lane.lock(["a"])).toBe(true);
    expect(lane.lock(["a"])).toBe(false);
    expect(lane.lock(["a", "b"])).toBe(false);
    expect(lane.lock(["b"])).toBe(true);
    expect(lane.busy()).toBe(true);
    lane.unlock(["a", "b"]);
    expect(lane.busy()).toBe(false);
    expect(lane.lock(["a"])).toBe(true);
  });

  it("되돌리기는 앞선 넣기가 끝난 뒤에 나가고, 실패해도 줄은 이어진다", async () => {
    const lane = createDecisionQueue<{ ok: boolean }>({ ok: false });
    const order: string[] = [];
    let release!: () => void;
    const put = lane.enqueue(
      () =>
        new Promise((resolve) => {
          release = () => {
            order.push("put");
            resolve({ ok: true });
          };
        }),
    );
    const fail = lane.enqueue(async () => {
      order.push("fail");
      throw new Error("x");
    });
    const undo = lane.enqueue(async () => {
      order.push("undo");
      return { ok: true };
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await expect(put).resolves.toEqual({ ok: true });
    await expect(fail).resolves.toEqual({ ok: false });
    await expect(undo).resolves.toEqual({ ok: true });
    expect(order).toEqual(["put", "fail", "undo"]);
  });

  it("서버가 확인했을 때만 다음 후보로 넘긴다", async () => {
    let moved = 0;
    await whenConfirmed(Promise.resolve(true), () => (moved += 1));
    await whenConfirmed(Promise.resolve(false), () => (moved += 1));
    await whenConfirmed(undefined, () => (moved += 1));
    await whenConfirmed(true, () => (moved += 1));
    expect(moved).toBe(2);
  });

  it("모두 넣기는 긴 칸을 빼고 수를 센다", () => {
    const short = L("10시", "10時", "10:00");
    const long = L("가".repeat(41), "あ".repeat(41), "a".repeat(41));
    const fields = [{ id: "1", v: short }, { id: "2", v: long }, { id: "3", v: short }];
    const { items, skippedLong } = splitPutAll(fields, (field) => field.v, "ko");
    expect(items.map((item) => item.candidate.id)).toEqual(["1", "3"]);
    expect(items[0].value).toBe(short);
    expect(skippedLong).toBe(1);
  });

  it("모두 넣기 결과는 토스트 하나 — 다 됨 · 일부 실패 · 모두 실패", () => {
    expect(putAllOutcome(3, 0, 0)).toEqual({ key: "candToastPutAll", haptic: "success", conflictLeft: false, longLeft: false, undo: true });
    expect(putAllOutcome(2, 1, 1)).toEqual({ key: "candToastPutAllPartial", haptic: "warning", conflictLeft: false, longLeft: true, undo: true });
    expect(putAllOutcome(0, 3, 0)).toEqual({ key: "candErrFailed", haptic: "error", conflictLeft: false, longLeft: false, undo: false });
  });

  it("모두 넣기 — 이미 채워진 칸은 실패가 아니라 건너뜀(「다시 시도」는 진짜 실패에만)", () => {
    // 넣은 것 + 이미 채워진 칸: 다 됨 문구 + 건너뜀 꼬리, 실패 문구 없음
    expect(putAllOutcome(2, 0, 1, 1)).toEqual({ key: "candToastPutAll", haptic: "warning", conflictLeft: true, longLeft: true, undo: true });
    // 모두 이미 채워짐 — 한 칸이면 한 칸 막힘 문구 그대로, 여러 칸이면 수를 넣은 문구 · 되돌리기 없음
    expect(putAllOutcome(0, 0, 0, 1)).toEqual({ key: "candErrConflict", haptic: "warning", conflictLeft: false, longLeft: false, undo: false });
    expect(putAllOutcome(0, 0, 0, 3)).toEqual({ key: "candToastPutAllConflicts", haptic: "warning", conflictLeft: false, longLeft: false, undo: false });
    // 진짜 실패가 섞이면 실패 문구 + 건너뜀 꼬리
    expect(putAllOutcome(0, 1, 0, 2)).toMatchObject({ key: "candErrFailed", haptic: "error", conflictLeft: true });
    expect(putAllOutcome(1, 1, 0, 1)).toMatchObject({ key: "candToastPutAllPartial", conflictLeft: true });
  });
});

describe("기다리는 사이 자리를 옮겼으면 넘기지 않는다", () => {
  it("결정 뒤 그대로면 다음 후보로 · 그 사이 뒤로 · 다른 후보를 골랐으면 그대로", async () => {
    const nav = createNavStamp();
    let moved = 0;
    const at = nav.take();
    await whenConfirmedHere(Promise.resolve(true), nav, at, () => (moved += 1));
    expect(moved).toBe(1);

    let release: (ok: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => (release = resolve));
    const at2 = nav.take();
    const done = whenConfirmedHere(pending, nav, at2, () => (moved += 1));
    nav.bump(); // 기다리는 사이 다른 후보를 고름 · 뒤로
    release(true);
    await done;
    expect(moved).toBe(1);

    // 실패는 자리와 상관없이 넘기지 않는다
    await whenConfirmedHere(Promise.resolve(false), nav, nav.take(), () => (moved += 1));
    expect(moved).toBe(1);
  });
});
