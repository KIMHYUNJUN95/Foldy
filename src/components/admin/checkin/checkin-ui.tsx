import Link from "next/link";
import { Hourglass, Inbox, LockKeyhole, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { CheckinCopy } from "./checkin-copy";
import "./checkin.css";

/** 오늘 · 기기 · 건물 설정 — 서버에서 그려도 되는 링크 탭. `checkin.manage` 가 없으면 앞의 하나만. */
export function CheckinTabs({ active, canManage, copy }: { active: "today" | "devices" | "settings"; canManage: boolean; copy: CheckinCopy }) {
  const tabs = [
    { id: "today" as const, href: "/admin/checkin", label: copy.tabToday },
    ...(canManage
      ? [
          { id: "devices" as const, href: "/admin/checkin/devices", label: copy.tabDevices },
          { id: "settings" as const, href: "/admin/checkin/settings", label: copy.tabSettings },
        ]
      : []),
  ];
  return (
    <nav className="ck-tabs" aria-label={copy.tabsLabel}>
      {tabs.map((tab) => (
        <Link key={tab.id} href={tab.href} className={`ck-tab${tab.id === active ? " on" : ""}`} aria-current={tab.id === active ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

type StateKind = "empty" | "error" | "notReady" | "forbidden";

/** 빈 · 오류 · 준비 중 · 권한 없음 한 덩어리(상자 없음). */
export function CheckinState({ kind, title, body, action }: { kind: StateKind; title: string; body?: string; action?: ReactNode }) {
  const Icon = kind === "error" ? TriangleAlert : kind === "notReady" ? Hourglass : kind === "forbidden" ? LockKeyhole : Inbox;
  return (
    <div className="ck-state" role={kind === "error" ? "alert" : "status"}>
      <span className="ck-state__ic">
        <Icon aria-hidden="true" />
      </span>
      <b>{title}</b>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}
