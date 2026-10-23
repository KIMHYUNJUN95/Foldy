import "server-only";

import { CHANNEL_KEY_PATTERN } from "@/lib/automation/jobs";

/**
 * 자동화 Slack 채널 — **Vercel 환경변수**에서 찾는다(2026-10-06 사용자 결정).
 *
 * 도메인 계약: docs/product/36-automation-control.md 「데이터」 · docs/engineering/07-environment-setup.md
 *
 * 이름 규칙 `SLACK_AUTOMATION_<KEY>_WEBHOOK_URL`. 서버가 이 접두어의 변수를 모아 채널 목록을 만든다 — 채널을
 * 늘리려면 Vercel 에 변수를 넣고 재배포하면 되고 코드는 안 바뀐다. 표(`automation_destinations`)에는 KEY 만 둔다.
 *
 * 업무일지용 `SLACK_DAILY_REPORT_WEBHOOK_URL`(src/actions/task-report.ts)과 **이름이 겹치지 않는다** —
 * 저쪽 프로젝트가 같은 이름을 일일 리포트에 썼지만 우리는 다른 채널이다.
 *
 * 주소 전체는 절대 로그 · 화면에 내지 않는다(경로에 토큰이 있다 — `slack-notify.ts` 와 같은 규칙). 화면에는 끝 4자리만.
 */

const ENV_PATTERN = /^SLACK_AUTOMATION_([A-Z0-9_]{1,40})_WEBHOOK_URL$/;

export type AutomationChannel = { key: string; last4: string; valid: boolean };

function validWebhook(url: string): boolean {
  try {
    const endpoint = new URL(url);
    return endpoint.protocol === "https:" && endpoint.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

export function listAutomationChannels(env: NodeJS.ProcessEnv = process.env): AutomationChannel[] {
  const channels: AutomationChannel[] = [];
  for (const [name, value] of Object.entries(env)) {
    const match = ENV_PATTERN.exec(name);
    if (!match || !value?.trim()) continue;
    const url = value.trim();
    channels.push({ key: match[1], last4: url.slice(-4), valid: validWebhook(url) });
  }
  return channels.sort((a, b) => a.key.localeCompare(b.key));
}

export type SlackSendResult = { ok: true } | { ok: false; reason: "channel_missing" | "bad_host" | `http_${number}` | "fetch_failed" };

/** `blocks` 가 있으면 카드(Block Kit)로, `text` 는 잠금화면 알림 · 카드를 못 그리는 곳의 한 줄. */
export async function postToAutomationChannel(
  channelKey: string,
  text: string,
  blocks?: Array<Record<string, unknown>>,
): Promise<SlackSendResult> {
  if (!CHANNEL_KEY_PATTERN.test(channelKey)) return { ok: false, reason: "channel_missing" };
  const url = process.env[`SLACK_AUTOMATION_${channelKey}_WEBHOOK_URL`]?.trim();
  if (!url) return { ok: false, reason: "channel_missing" };
  if (!validWebhook(url)) {
    console.warn(`[automation/slack] webhook host rejected for ${channelKey} (len=${url.length})`);
    return { ok: false, reason: "bad_host" };
  }
  try {
    const response = await fetch(url, {
      body: JSON.stringify(blocks && blocks.length > 0 ? { blocks, text } : { text }),
      cache: "no-store",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[automation/slack] ${channelKey} rejected: ${response.status} ${detail.slice(0, 200)}`);
      return { ok: false, reason: `http_${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    console.warn(`[automation/slack] ${channelKey} fetch failed:`, error instanceof Error ? error.message : error);
    return { ok: false, reason: "fetch_failed" };
  }
}
