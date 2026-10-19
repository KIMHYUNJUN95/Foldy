/**
 * 자동화 발송 상태 판정 — **순수하다**(실행기 `runner.ts` 가 DB 를 읽어 넘긴다).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「발송 상태 — 보내는 중 · 정정본 판정」
 */

/** 중복 방지 키가 이미 잡혀 있을 때 — 그 줄이 끝난 것(보냄 · 건너뜀)이면 중복, 아니면 아직 보내는 중(죽었을 수도). */
export function claimConflictKind(existingStatus: string | null | undefined): "duplicate" | "in_flight" {
  return existingStatus === "sent" || existingStatus === "skipped" ? "duplicate" : "in_flight";
}

/** 정시 발송을 오늘 끝낼까 — 실패나 아직 끝나지 않은 줄이 있으면 마감 전까지 다시 본다. */
export function isScheduledRunDone(input: { failed: number; inFlight: number; pastDeadline: boolean }): boolean {
  return (input.failed === 0 && input.inFlight === 0) || input.pastDeadline;
}

export type SentRunRow = {
  id: string;
  channel_key: string | null;
  locale: string | null;
  meta: Record<string, unknown>;
};

export function targetKey(channelKey: string, locale: string): string {
  return `${channelKey}|${locale}`;
}

/** 받는 곳 × 언어마다 마지막으로 보낸 줄. `rows` 는 최근 것부터. */
export function latestSentByTarget(rows: SentRunRow[]): Map<string, SentRunRow> {
  const latest = new Map<string, SentRunRow>();
  for (const row of rows) {
    if (!row.channel_key || !row.locale) continue;
    const key = targetKey(row.channel_key, row.locale);
    if (!latest.has(key)) latest.set(key, row);
  }
  return latest;
}

/**
 * 변동 재전송 · 정정본을 받을 곳과 그 중복 방지 꼬리.
 *
 * - 받는 곳 × 언어마다 **그곳에 마지막으로 보낸 내용**과 비교한다 — 한 곳만 실패했으면 그곳만 다시 받는다.
 * - 꼬리 = `<prefix>:<그곳에 마지막으로 보낸 줄 id>:<지문>` — A → B → A → B 처럼 같은 내용으로 되돌아가도 「직전에 보낸 줄」이
 *   달라 키가 새로 생긴다. 같은 판정이 두 번 돌면(틱 겹침 · 재시도) 같은 키라 한 통만 나간다.
 * - 오늘 아직 아무것도 못 받은 곳은 다른 곳에 정정본이 나갈 때만 같이 받는다.
 */
export function planFollowUpTargets(input: {
  targets: Array<{ channelKey: string; locale: string }>;
  latest: Map<string, SentRunRow>;
  differs: (meta: Record<string, unknown>) => boolean;
  prefix: string;
  fingerprint: string;
}): Map<string, string> {
  const plan = new Map<string, string>();
  const neverSent: string[] = [];
  for (const target of input.targets) {
    const key = targetKey(target.channelKey, target.locale);
    const last = input.latest.get(key);
    if (!last) neverSent.push(key);
    else if (input.differs(last.meta)) plan.set(key, `${input.prefix}:${last.id}:${input.fingerprint}`);
  }
  if (plan.size > 0) for (const key of neverSent) plan.set(key, `${input.prefix}:none:${input.fingerprint}`);
  return plan;
}
