import "server-only";

/**
 * **운영자 경보** 전용 Slack 웹훅. 시스템이 조용히 멈췄을 때처럼 «사람이 손을 대야 하는» 사건만
 * 보낸다.
 *
 * 채널을 왜 따로 두는가
 * ---------------------
 * 이미 `SLACK_DAILY_REPORT_WEBHOOK_URL`(업무일지)이 있지만 **그쪽에 보내면 안 된다.** 그 채널은
 * 현장 직원이 업무일지를 올리는 곳이라, 「리뷰 수집이 멈춘 것 같습니다」 같은 시스템 경보는
 * 받는 사람이 할 수 있는 일이 없고 일지만 밀어 올린다. 대상이 다르면 채널도 달라야 한다.
 *
 * **설정하지 않으면 아무 데도 보내지 않는다**(`not_configured`). 감지 자체는 그대로 동작하고
 * 워크플로 로그에 경고로 남으므로, 이 변수는 «추가로 알림까지 받겠다» 는 선택이다.
 *
 * 검증·에러 처리는 `src/actions/task-report.ts` 의 방식을 따른다 — 특히 «URL 전체는 절대
 * 로그에 남기지 않는다»(경로에 토큰이 들어 있다).
 *
 * 실패해도 **던지지 않는다.** 알림은 부수 작업이라, 알림이 안 갔다고 본 작업(점검)을 실패로
 * 만들면 안 된다. 대신 사유를 반환해 호출부가 응답에 실어 드러낼 수 있게 한다.
 */
export type SlackResult = { ok: true } | { ok: false; reason: string };

export async function postSlackText(text: string): Promise<SlackResult> {
  const webhookUrl = process.env.SLACK_OPS_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return { ok: false, reason: "not_configured" };

  try {
    const endpoint = new URL(webhookUrl);
    // 경로에 토큰이 들어 있으므로 URL 전체는 절대 로그에 남기지 않는다.
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "hooks.slack.com") {
      console.warn(
        `[slack] webhook host rejected: ${endpoint.protocol}//${endpoint.hostname} (len=${webhookUrl.length})`,
      );
      return { ok: false, reason: "bad_host" };
    }
  } catch {
    console.warn(`[slack] webhook is not a valid URL (len=${webhookUrl.length})`);
    return { ok: false, reason: "invalid_url" };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[slack] rejected: ${response.status} ${detail.slice(0, 200)}`);
      return { ok: false, reason: `http_${response.status}` };
    }
  } catch (error) {
    console.warn("[slack] fetch failed:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "fetch_failed" };
  }

  return { ok: true };
}
