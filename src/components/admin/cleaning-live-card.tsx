"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { CleaningLive } from "@/lib/admin-dashboard";
import { getDictionary } from "@/lib/i18n";

const X = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const Check = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function Ic({ children }: { children: React.ReactNode }) {
  return <span className="ic">{children}</span>;
}

function fmtTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(
    new Date(iso),
  );
}
function elapsedMinutes(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}
function initial(name: string): string {
  return name.trim().slice(0, 1) || "·";
}

export function CleaningLiveCard({
  cleaning,
  locale,
}: {
  cleaning: CleaningLive[];
  /** locale tag (e.g. "ko-KR") — used for Intl + resolved to the console dictionary. */
  locale: string;
}) {
  const dictionary = getDictionary(locale);
  const c = dictionary.admin.console;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sel = cleaning.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  return (
    <div className="dh-col7">
      <div className="dh-ch">
        <span className="dh-ct">{c.cleaningTitle}</span>
        <span className="dh-live"><i />{c.dhRealtime}</span>
        <Link href="/admin/cleaning" className="dh-link" style={{ marginLeft: "auto" }}>{c.dhCleaningLink} →</Link>
      </div>

      {cleaning.length === 0 ? (
        <div className="dh-empty">{c.cleaningEmpty}</div>
      ) : (
        cleaning.map((row) => (
          <button
            className={`dh-row${row.id === selectedId ? " dh-sel" : ""}`}
            key={row.id}
            onClick={() => setSelectedId(row.id)}
            style={{ width: "100%", border: 0, borderTop: "1px solid #f3f3f6", background: row.id === selectedId ? "#f4f1fd" : "transparent", font: "inherit", textAlign: "left", padding: 0 }}
            type="button"
          >
            <span className="dh-room">{row.room}</span>
            <div className="dh-rb">
              <div className="dh-rt">{row.staff || c.unassigned}</div>
              <div className="dh-rs">
                {row.taskLabel || c.taskOther} · {c.dhCleaningStarted.replace("{time}", fmtTime(row.startedAt, locale))}
              </div>
            </div>
            <span className="dh-cc">{c.elapsedMin(elapsedMinutes(row.startedAt))}</span>
          </button>
        ))
      )}

      {sel &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="adm">
            <button className="panel-scrim" aria-label={dictionary.common.close} onClick={() => setSelectedId(null)} />
            <aside className="panel" role="dialog" aria-modal="true">
              <div className="panel__h">
                <div className="panel__top">
                  <span className="panel__kicker">{c.panelKicker}</span>
                  <button className="panel__x" onClick={() => setSelectedId(null)} aria-label={dictionary.common.close}>{X}</button>
                </div>
                <div className="panel__title">
                  <span className="panel__room">{sel.room}</span>
                  <span className="panel__sub">{sel.taskLabel || c.taskOther}</span>
                </div>
                <div className="panel__chips">
                  <span className="pill pill--open"><span className="d" />{c.statusInProgress}</span>
                </div>
              </div>

              <div className="panel__body">
                <div className="pblock">
                  <div className="pblock__t">{c.panelInfo}</div>
                  <div className="kv">
                    <span className="kv__k">{c.panelStaff}</span>
                    <span className="kv__v">
                      <span className="avatar" style={{ width: 24, height: 24, fontSize: 11, background: sel.staff ? "var(--adm-primary)" : "var(--adm-surface)", color: sel.staff ? "#fff" : "var(--adm-muted)" }}>
                        {sel.staff ? initial(sel.staff) : "?"}
                      </span>
                      {sel.staff || c.unassigned}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">{c.panelStart}</span>
                    <span className="kv__v mono">{fmtTime(sel.startedAt, locale)}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">{c.panelElapsed}</span>
                    <span className="kv__v mono">{c.elapsedMin(elapsedMinutes(sel.startedAt))}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">{c.colType}</span>
                    <span className="kv__v">{sel.taskLabel || c.taskOther}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">{c.panelStatus}</span>
                    <span className="kv__v"><span className="pill pill--open"><span className="d" />{c.statusInProgress}</span></span>
                  </div>
                </div>

                <div className="pblock">
                  <div className="pblock__t">{c.panelActivity}</div>
                  <div className="ptl">
                    <div className="ptlrow">
                      <span className="ptlrow__dot on" />
                      <div className="ptlrow__t">{c.panelActInProgress}</div>
                      <div className="ptlrow__s">{sel.staff || c.unassigned}</div>
                    </div>
                    <div className="ptlrow">
                      <span className="ptlrow__dot done" />
                      <div className="ptlrow__t">{c.panelActStarted}</div>
                      <div className="ptlrow__time">{fmtTime(sel.startedAt, locale)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel__foot">
                <Link href="/admin/cleaning" className="btn btn--ghost">{c.panelMessage}</Link>
                <Link href="/admin/cleaning" className="btn btn--pri"><Ic>{Check}</Ic>{c.panelComplete}</Link>
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </div>
  );
}
