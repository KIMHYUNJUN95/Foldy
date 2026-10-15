"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, FileText, Lock, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { generateDailyReport, sendDailyReportToSlack } from "@/app/mobile/tasks/report-actions";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  buildDailyReportText,
  type DailyReportItem,
  type DailyReportTemplate,
} from "@/lib/daily-report";
import type { Dictionary, Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Copy = Dictionary["tasks"];
type Status = "loading" | "done" | "forbidden" | "empty" | "error";
type SlackStatus =
  | "idle"
  | "sending"
  | "sent"
  | "not_configured"
  | "too_long"
  | "forbidden"
  | "empty"
  | "error";

// Clipboard write with a legacy fallback (mirrors the calendar's copy util) so it works in
// non-secure contexts / older webviews.
async function copyText(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

/**
 * Bottom sheet that generates and displays the AI daily work report for a given Tokyo date.
 * Same portal+animation pattern as PhotoGallery (mount→show, body scroll lock, Esc to close, portal
 * to <body> so the mobile shell's transformed scroll container can't trap `position: fixed`).
 *
 * Permission is enforced server-side: a non-staff caller gets `forbidden`, which renders the
 * "권한 없음" state in place of the report — satisfying the "권한 없는 사람이 누르면 팝업" requirement.
 */
export function ReportSheet({
  copy,
  date,
  locale,
  onClose,
}: {
  copy: Copy;
  date: string;
  locale: Locale;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [slackStatus, setSlackStatus] = useState<SlackStatus>("idle");
  // 완료 항목 원본 + 조립 조각. 체크된 항목만으로 본문을 다시 만들기 위해 들고 있는다.
  const [items, setItems] = useState<DailyReportItem[]>([]);
  const [template, setTemplate] = useState<DailyReportTemplate | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  // 마지막으로 자동 조립한 본문. 사용자가 직접 손댔는지(`dirty`) 판정하는 기준.
  const [builtText, setBuiltText] = useState("");

  const run = useCallback(() => {
    setStatus("loading");
    setCopied(false);
    setSlackStatus("idle");
    generateDailyReport(date).then((res) => {
      if (res.ok) {
        setItems(res.items);
        setTemplate(res.template);
        setPicked(res.items.map(() => true)); // 기본은 전체 포함 — 빼는 쪽이 예외다.
        setText(res.text);
        setBuiltText(res.text);
        setStatus("done");
      } else {
        setStatus(res.reason);
      }
    });
  }, [date]);

  /**
   * 선택을 바꾸고 본문을 다시 조립한다. 번호와 합계가 선택 기준으로 다시 매겨지므로, 사용자가
   * textarea 에서 줄을 지우고 번호를 손보는 일이 없어진다. 직접 편집한 내용은 이 시점에
   * 덮어써지며, 그 사실은 `reportPickResetHint` 로 미리 알린다.
   */
  const applyPick = (next: boolean[]) => {
    const chosen = items.filter((_, i) => next[i]);
    const nextText = template && chosen.length ? buildDailyReportText(template, chosen) : "";
    setPicked(next);
    setText(nextText);
    setBuiltText(nextText);
    setCopied(false);
    setSlackStatus("idle");
  };

  const pickedCount = picked.filter(Boolean).length;
  const allPicked = items.length > 0 && pickedCount === items.length;
  const dirty = text !== builtText;
  const canSubmit = pickedCount > 0 && text.trim().length > 0;

  // Kick off generation on mount (rAF-scheduled so the loading setState is not called
  // synchronously inside the effect body).
  useEffect(() => {
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  }, [run]);

  const onCopy = async () => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onSlackSend = async () => {
    setSlackStatus("sending");
    const result = await sendDailyReportToSlack(date, text);
    if (result.ok) {
      setSlackStatus("sent");
      return;
    }
    // 서버가 준 사유를 **그대로** 보여준다. 예전에는 forbidden / empty 를 일반 오류로 접었는데,
    // 그러면 "다시 시도해 주세요"만 뜨고 사용자는 무엇이 문제인지 끝까지 모른다(2026-08-04).
    setSlackStatus(result.reason);
  };

  const slackMessage =
    slackStatus === "sent"
      ? copy.reportSlackSent
      : slackStatus === "not_configured"
        ? copy.reportSlackNotConfigured
        : slackStatus === "too_long"
          ? copy.reportSlackTooLong
          : slackStatus === "forbidden"
            ? copy.reportSlackForbidden
            : slackStatus === "empty"
              ? copy.reportSlackEmpty
              : slackStatus === "error"
                ? copy.reportSlackError
                : null;

  // PC 업무일지 창과 같은 「10월 15일 (목)」(연도 없이).
  const dateLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${date}T00:00:00+09:00`));

  const centered = (icon: React.ReactNode, title: string, body: string, retry?: boolean) => (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
        {icon}
      </span>
      <p className="text-[15px] font-extrabold text-foreground">{title}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      {retry ? (
        <button
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-bold text-primary"
          onClick={run}
          type="button"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {copy.reportRegenerate}
        </button>
      ) : null}
    </div>
  );

  return (
    <BottomSheet
      ariaLabel={copy.reportTitle}
      header={
        // 화이트 리디자인(2026-10-15, 시안 TodoReport-Phone) — PC 업무일지 창과 같은 구성: 제목 + 「날짜 · 완료 n건 중 m건 포함」.
        <div className="tkw-rpt__h">
          <h2>{copy.reportTitle}</h2>
          <span>
            {status === "done"
              ? copy.mobileWhite.reportSub
                  .replace("{date}", dateLabel)
                  .replace("{total}", String(items.length))
                  .replace("{selected}", String(pickedCount))
              : dateLabel}
          </span>
        </div>
      }
      onClose={onClose}
    >
      {status === "loading"
          ? centered(
              <RefreshCw className="size-6 animate-spin" aria-hidden="true" />,
              copy.reportGenerating,
              copy.reportSubtitle,
            )
          : status === "forbidden"
            ? centered(
                <Lock className="size-6" aria-hidden="true" />,
                copy.reportNoPermissionTitle,
                copy.reportNoPermissionBody,
              )
            : status === "empty"
              ? centered(
                  <FileText className="size-6" aria-hidden="true" />,
                  copy.reportEmptyTitle,
                  copy.reportEmptyBody,
                )
              : status === "error"
                ? centered(
                    <RefreshCw className="size-6" aria-hidden="true" />,
                    copy.reportError,
                    copy.reportSubtitle,
                    true,
                  )
                : (
                  <div className="tkw-rpt">
                    {/* 포함할 항목 — 체크만 풀면 번호 · 합계가 다시 매겨진다. */}
                    <div className="tkw-rpt__pick">
                      <div className="tkw-rpt__pickh">
                        <b>{copy.reportPickTitle}</b>
                        <span>
                          {copy.reportPickCount
                            .replace("{selected}", String(pickedCount))
                            .replace("{total}", String(items.length))}
                        </span>
                        <button onClick={() => applyPick(items.map(() => !allPicked))} type="button">
                          {allPicked ? copy.reportPickNone : copy.reportPickAll}
                        </button>
                      </div>
                      <ul>
                        {items.map((item, i) => (
                          <li key={`${item.text}-${i}`}>
                            <button
                              aria-checked={picked[i]}
                              className={cn("tkw-rpt__row", picked[i] && "on")}
                              onClick={() => applyPick(picked.map((on, idx) => (idx === i ? !on : on)))}
                              role="checkbox"
                              type="button"
                            >
                              <span aria-hidden="true" className="tkw-rpt__box">
                                <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.2" viewBox="0 0 24 24">
                                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                                </svg>
                              </span>
                              <span className="tkw-rpt__label">{item.text}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <label className="tkw-rpt__nf">
                      <span>{copy.mobileWhite.reportBody}</span>
                      <textarea
                        onChange={(e) => {
                          setText(e.target.value);
                          setSlackStatus("idle");
                        }}
                        placeholder={copy.reportPickEmpty}
                        value={text}
                      />
                    </label>
                    <div className="tkw-rpt__hint">
                      <span>
                        {pickedCount === 0 ? copy.reportPickEmpty : dirty ? copy.reportPickResetHint : copy.reportEditHint}
                      </span>
                      <button onClick={run} type="button">
                        <RefreshCw aria-hidden="true" />
                        {copy.reportRegenerate}
                      </button>
                    </div>
                    {/* 전송 결과는 놓치면 안 된다 — 성공(보라) · 실패(빨강) 한 줄. */}
                    {slackMessage ? (
                      <p className={cn("tkw-rpt__msg", slackStatus === "sent" ? "is-ok" : "is-bad")} role="status">
                        {slackStatus === "sent" ? (
                          <Check aria-hidden="true" strokeWidth={3} />
                        ) : (
                          <TriangleAlert aria-hidden="true" />
                        )}
                        {slackMessage}
                      </p>
                    ) : null}
                    <div className="tkw-rpt__f">
                      <button
                        className="tkw-rpt__btn is-gray"
                        disabled={slackStatus === "sending" || !canSubmit}
                        onClick={onSlackSend}
                        type="button"
                      >
                        {slackStatus === "sending" ? <RefreshCw aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
                        <span>{slackStatus === "sending" ? copy.reportSlackSending : copy.reportSlackSend}</span>
                      </button>
                      <button className="tkw-rpt__btn is-pri" disabled={!canSubmit} onClick={onCopy} type="button">
                        {copied ? <Check aria-hidden="true" strokeWidth={3} /> : <Copy aria-hidden="true" />}
                        <span>{copied ? copy.reportCopied : copy.reportCopy}</span>
                      </button>
                    </div>
                  </div>
                )}
    </BottomSheet>
  );
}
