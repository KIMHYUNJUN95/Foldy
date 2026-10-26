"use server";

import { logDailyReportSent, postDailyReportToSlack } from "@/lib/daily-report-slack";
import { buildDailyReportText, type DailyReportDraft, type DailyReportItem } from "@/lib/daily-report";
import { getFieldActivities } from "@/lib/field-activity";
import { getCurrentAppSession, hasOrganizationContext } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type DailyReportResult =
  | ({ ok: true } & DailyReportDraft)
  | { ok: false; reason: "forbidden" | "empty" | "error" };

export type SlackSendFailureReason =
  | "forbidden"
  | "empty"
  | "error"
  | "not_configured"
  | "too_long";

export type SendDailyReportToSlackResult = { ok: true } | { ok: false; reason: SlackSendFailureReason };

// ── 현지화 템플릿 조각 ─────────────────────────────────────────────────
// i18n-ignore-start: 서버 액션 보고서 현지화 템플릿은 여기에 모아 둔다.
// 합계 문구는 `{n}` 자리표시자를 쓴다 — 클라이언트가 선택 개수에 맞춰 다시 조립하는데
// 함수는 서버 액션 경계를 넘지 못하기 때문이다(`src/lib/daily-report.ts` 참고).
type ReportTemplateParts = {
  header: string;
  labelDate: string;
  labelName: string;
  sectionDone: string;
  sectionField: string;
  summaryOne: string;
  summaryMany: string;
};

const REPORT_TEMPLATE: Record<string, ReportTemplateParts> = {
  ko: {
    header: "[업무일지]",
    labelDate: "날짜",
    labelName: "담당자",
    sectionDone: "■ 완료 업무",
    sectionField: "■ 현장 활동",
    summaryOne: "총 완료: {n}건",
    summaryMany: "총 완료: {n}건",
  },
  ja: {
    header: "[業務日報]",
    labelDate: "日付",
    labelName: "担当者",
    sectionDone: "■ 完了業務",
    sectionField: "■ 現場作業",
    summaryOne: "計: {n}件完了",
    summaryMany: "計: {n}件完了",
  },
  en: {
    header: "[Daily Work Report]",
    labelDate: "Date",
    labelName: "Name",
    sectionDone: "■ Completed Tasks",
    sectionField: "■ Field Activity",
    summaryOne: "Total: {n} task completed",
    summaryMany: "Total: {n} tasks completed",
  },
};
// i18n-ignore-end

/**
 * 거친 항목 한 줄을 다듬는, 결정적이고 비용 없는 텍스트 정리. LLM 없이 사전 수준의
 * 맞춤법 교정까지는 못 하지만, 사람들이 흔히 틀리는 부분은 믿을 수 있게 정리할 수 있다 — 업무를
 * 빠르게 적은 업무에 흔한 문제를 바로잡는다: 불필요한 공백, 앞쪽 글머리 기호, 문장부호 주변 띄어쓰기. 사용자가
 * 입력한 의미를 바꾸지 않도록 보수적으로 유지한다.
 */
function tidy(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  // 연속된 공백을 한 칸으로 합친다.
  s = s.replace(/\s+/g, " ");
  // 사용자가 직접 넣은 앞쪽 글머리 / 대시 / 목록 기호를 지운다.
  s = s.replace(/^[-–—•·*▪◦●○▶▷>]+\s*/, "");
  // 쉼표 / 한국어 열거 쉼표 뒤에는 한 칸, 앞에는 공백 없음.
  s = s.replace(/\s*[,，、]\s*/g, ", ");
  // 자주 쓰는 구분자 주변 간격을 고르게 맞춘다.
  s = s.replace(/\s*\/\s*/g, " / ");
  s = s.replace(/\s*·\s*/g, " · ");
  s = s.replace(/\s*&\s*/g, " & ");
  s = s.replace(/\s*~\s*/g, "~");
  // 괄호: 안쪽 공백 없음, 여는 괄호 바로 앞에는 한 칸.
  s = s.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  s = s.replace(/\[\s+/g, "[").replace(/\s+\]/g, "]");
  s = s.replace(/(\S)\(/g, "$1 (");
  // 문장부호 앞 공백 없음, 반복되는 부호는 하나로.
  s = s.replace(/\s+([.!?…])/g, "$1");
  s = s.replace(/([.,!?])\1+/g, "$1");
  // 마지막 정리: 다시 공백을 합치고 trim 하며 끝의 마침표를 지운다(업무일지 항목은 마침표 없는 편이 읽기 좋다).
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[.\s]+$/, "");
  return s;
}

/**
 * 현재 사용자가 완료한 업무로 주어진 도쿄 날짜의 일일 업무 보고서("업무일지")를 만든다.
 * 무료 / 템플릿 기반 — LLM 호출 없음, 사용당 비용 없음. `can_generate_report` 권한으로 제한한다.
 * 공식 업무 보고서를 출력한다: 제목, 날짜, 직원 이름, 번호 매긴 업무 목록, 총 건수.
 * 태그와 설명은 의도적으로 제외하고 제목만 쓴다.
 */
export async function generateDailyReport(date: string): Promise<DailyReportResult> {
  const day = String(date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, reason: "error" };

  const session = await getCurrentAppSession();
  if (!session || !hasOrganizationContext(session)) return { ok: false, reason: "forbidden" };
  // 권한 키 `can_generate_report` 하나로 판정(역할 기본 + 개인 부여 · 차단, 2026-10-21). 예전 프로필 표시는 마이그레이션에서 부여로 옮겼다.
  if (!session.capabilities.includes("can_generate_report")) {
    return { ok: false, reason: "forbidden" };
  }

  const locale = session.user.preferredLanguage;
  const tmpl = REPORT_TEMPLATE[locale] ?? REPORT_TEMPLATE.ko;

  // 이 도쿄 날짜에 본인이 완료한 것. `task_updates` 의 `completed`/`reopened` 이벤트에서 계산한다
  // (`tasks.status` 가 아님). 반복 업무는 완료하면 행을 다음 회차로 넘기고 `open` 으로 두므로
  // `status=completed` 가 되지 않아 완료 기록은 로그에만 남는다. 업무별 순증(completed − reopened)으로
  // 세면 반복 완료도 잡히고 같은 날 되돌린 것은 상쇄된다.
  const supabase = await getSupabaseServerClient();
  const dayStart = new Date(`${day}T00:00:00+09:00`);
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = new Date(dayStart.getTime() + 86_400_000).toISOString(); // +09:00 범위 == 도쿄 하루
  const { data: updData, error: updErr } = await supabase
    .from("task_updates")
    .select("task_id, update_type, created_at")
    .in("update_type", ["completed", "reopened"])
    .eq("created_by_user_id", session.user.id)
    .gte("created_at", dayStartIso)
    .lt("created_at", dayEndIso)
    .order("created_at", { ascending: true });
  if (updErr) return { ok: false, reason: "error" };

  type Upd = { task_id: string; update_type: string };
  const net = new Map<string, number>();
  const order: string[] = []; // 첫 완료 순서대로 task_id
  for (const r of (updData ?? []) as Upd[]) {
    if (!net.has(r.task_id)) {
      net.set(r.task_id, 0);
      order.push(r.task_id);
    }
    net.set(r.task_id, (net.get(r.task_id) ?? 0) + (r.update_type === "completed" ? 1 : -1));
  }
  const completedIds = order.filter((id) => (net.get(id) ?? 0) > 0);

  // 제목을 가져온다(조직 범위. 완료 뒤 삭제된 업무는 그냥 빠진다).
  const titleById = new Map<string, string>();
  if (completedIds.length > 0) {
    const { data: taskData, error: taskErr } = await supabase
      .from("tasks")
      .select("id, title")
      .eq("organization_id", session.organization.id)
      .in("id", completedIds)
      .is("deleted_at", null);
    if (taskErr) return { ok: false, reason: "error" };
    for (const t of (taskData ?? []) as { id: string; title: string }[]) titleById.set(t.id, t.title);
  }

  // 제목만 중복 없이 완료 순서대로 모은다(태그 · 설명 제외).
  const seen = new Set<string>();
  const items: DailyReportItem[] = [];
  for (const id of completedIds) {
    const title = tidy(titleById.get(id) ?? "");
    if (!title || seen.has(title)) continue;
    seen.add(title);
    items.push({ text: title, section: "done" });
  }

  // 현장 활동 — 청소·유지보수·린넨·주문에서 **본인이 완료 처리한** 것만(`src/lib/field-activity.ts`).
  // 투두 완료가 하나도 없어도 현장 일은 있었을 수 있으므로, `empty` 판정은 둘을 합친 뒤에 한다.
  const field = await getFieldActivities({
    organizationId: session.organization.id,
    userId: session.user.id,
    locale,
  });
  const fieldSeen = new Set<string>();
  for (const activity of field) {
    if (activity.day !== day || fieldSeen.has(activity.label)) continue;
    fieldSeen.add(activity.label);
    items.push({ text: activity.label, section: "field" });
  }

  if (items.length === 0) return { ok: false, reason: "empty" };

  // 사용자 로케일에 맞춰 날짜를 포맷한다.
  const dateLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${day}T00:00:00+09:00`));

  // 항목 배열과 조각을 함께 내려보내, 클라이언트가 체크한 것만으로 본문을 다시 만들 수 있게 한다.
  const template = { ...tmpl, dateLabel, name: session.user.name };

  return { ok: true, text: buildDailyReportText(template, items), items, template };
}

/**
 * 본인이 검토한 일일 보고서를 회사 단일 Slack 채널에 올린다.
 *
 * 웹훅 URL 은 `SLACK_DAILY_REPORT_WEBHOOK_URL` 에만 두며 클라이언트는 받지 않는다.
 * 기존 보고서 템플릿과 사용자의 최종 수정이 그대로 Slack 에 나가도록 텍스트 영역 본문은
 * 일부러 바꾸지 않고 보낸다. 먼저 다시 생성하는 것은 권한 + 빈 보고서
 * 가드이지 수정한 텍스트를 대체하는 것이 아니다.
 */
export async function sendDailyReportToSlack(
  date: string,
  editedText: string,
): Promise<SendDailyReportToSlackResult> {
  // 실패 사유를 서버 로그에 남긴다. 이 액션은 throw 하지 않고 결과 객체로 실패를 돌려주므로
  // Vercel 런타임 **에러** 로그에 아무것도 안 남는다. 2026-08-04 "모바일에서 Slack 전송이 안
  // 된다"를 추적할 때 POST 200 만 보이고 어느 분기인지 알 수 없었다(청소 액션과 같은 교훈).
  const fail = (reason: SlackSendFailureReason) => {
    console.warn(`[report] slack send blocked: ${reason}`);
    return { ok: false as const, reason };
  };

  const day = String(date ?? "").trim();
  const text = String(editedText ?? "").trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day) || !text) return fail("error");
  // Slack 은 40,000자를 넘는 텍스트를 잘라낸다. 일부만 올라가지 않도록 거절한다.
  if (text.length > 40_000) return fail("too_long");

  const generated = await generateDailyReport(day);
  if (!generated.ok) return fail(generated.reason);

  const posted = await postDailyReportToSlack(text);
  if (!posted.ok) return fail(posted.reason);

  // 감사 기록 — 실패가 **이미 전달된** Slack 메시지를 실패로 보이게 만들면 안 된다(삼키지 않고 로그만, 공용 본체).
  const session = await getCurrentAppSession();
  if (session && hasOrganizationContext(session)) {
    await logDailyReportSent({ organizationId: session.organization.id, userId: session.user.id, date: day, characterCount: text.length });
  }
  return { ok: true };
}
