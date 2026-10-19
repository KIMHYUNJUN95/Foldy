import { describe, expect, it } from "vitest";

import {
  claimConflictKind,
  isScheduledRunDone,
  latestSentByTarget,
  planFollowUpTargets,
  type SentRunRow,
} from "@/lib/automation/delivery-state";

/**
 * 자동화 발송 상태 — 「보내는 중」 고착 · 정정본 A → B → A → B.
 * 도메인 계약: docs/product/36-automation-control.md 「발송 상태 — 보내는 중 · 정정본 판정」
 */

const targets = [
  { channelKey: "CLEANING", locale: "ko" },
  { channelKey: "CLEANING", locale: "ja" },
];

function row(id: string, locale: string, structureKey: string): SentRunRow {
  return { channel_key: "CLEANING", id, locale, meta: { structureKey } };
}

/** 정정본 판정을 한 번 돌린다 — 실제로 보낸 것(키가 처음인 것)만 기록에 쌓는다. */
function simulate(sequence: string[]) {
  const sent: SentRunRow[] = [row("r0-ko", "ko", "A"), row("r0-ja", "ja", "A")];
  const usedKeys = new Set<string>();
  const delivered: string[] = [];
  let n = 0;
  for (const current of sequence) {
    const plan = planFollowUpTargets({
      differs: (meta) => meta.structureKey !== current,
      fingerprint: current,
      latest: latestSentByTarget([...sent].reverse()),
      prefix: "correction",
      targets,
    });
    for (const [target, suffix] of plan) {
      const key = `${suffix}:${target}`;
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      n += 1;
      const locale = target.split("|")[1];
      sent.push(row(`r${n}`, locale, current));
      delivered.push(`${locale}:${current}`);
    }
  }
  return delivered;
}

describe("claimConflictKind", () => {
  it("끝난 줄만 중복, 「보내는 중」은 아직 안 끝남", () => {
    expect(claimConflictKind("sent")).toBe("duplicate");
    expect(claimConflictKind("skipped")).toBe("duplicate");
    expect(claimConflictKind("failed")).toBe("in_flight");
    expect(claimConflictKind(null)).toBe("in_flight");
  });
});

describe("isScheduledRunDone", () => {
  it("보내는 중으로 남은 줄이 있으면 오늘을 끝내지 않는다(마감 전)", () => {
    expect(isScheduledRunDone({ failed: 0, inFlight: 1, pastDeadline: false })).toBe(false);
    expect(isScheduledRunDone({ failed: 0, inFlight: 0, pastDeadline: false })).toBe(true);
    expect(isScheduledRunDone({ failed: 1, inFlight: 0, pastDeadline: false })).toBe(false);
    expect(isScheduledRunDone({ failed: 0, inFlight: 1, pastDeadline: true })).toBe(true);
  });
});

describe("planFollowUpTargets", () => {
  it("A → B → A → B 정정본이 매번 나간다", () => {
    expect(simulate(["B", "A", "B"])).toEqual(["ko:B", "ja:B", "ko:A", "ja:A", "ko:B", "ja:B"]);
  });

  it("같은 판정이 두 번 돌아도(틱 겹침 · 재시도) 한 번만", () => {
    expect(simulate(["B", "B", "B"])).toEqual(["ko:B", "ja:B"]);
  });

  it("마지막으로 보낸 내용과 같으면 보내지 않는다", () => {
    expect(simulate(["A"])).toEqual([]);
  });

  it("한 곳만 못 받았으면 그곳만 다시", () => {
    const latest = latestSentByTarget([row("r2", "ko", "B"), row("r0-ja", "ja", "A"), row("r0-ko", "ko", "A")]);
    const plan = planFollowUpTargets({ differs: (meta) => meta.structureKey !== "B", fingerprint: "B", latest, prefix: "correction", targets });
    expect([...plan.entries()]).toEqual([["CLEANING|ja", "correction:r0-ja:B"]]);
  });

  it("오늘 아무것도 못 받은 곳은 다른 곳 정정본이 나갈 때만 같이", () => {
    const latest = latestSentByTarget([row("r0-ko", "ko", "A")]);
    const same = planFollowUpTargets({ differs: (meta) => meta.structureKey !== "A", fingerprint: "A", latest, prefix: "correction", targets });
    expect(same.size).toBe(0);
    const changed = planFollowUpTargets({ differs: (meta) => meta.structureKey !== "B", fingerprint: "B", latest, prefix: "correction", targets });
    expect(changed.get("CLEANING|ja")).toBe("correction:none:B");
  });
});
