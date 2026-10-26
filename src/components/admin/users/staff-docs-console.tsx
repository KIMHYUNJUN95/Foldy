"use client";

/**
 * 사용자 › 직원 서류(재류카드 R4, 2026-10-26, 시안 M8bU3z… Main · Upload-PC).
 * 할 일 순 한 목록(확인 대기 → 만료 → 30일 → 90일 → 미등록 → 확인함) + 위 숫자 거르기 + 오른쪽 패널(공용 `.panel`).
 * 줄을 누르면 `?u=<userId>` — 서류가 있으면 확인 패널(`IdDocumentPanel`), 없으면 대신 올리기(`StaffIdUploadForm`).
 * 서버가 `staff_documents.view` 를 확인한 뒤에만 이 화면을 그린다. docs/product/41 「R4 구현」
 */

import "./users-white.css";
import "./staff-docs.css";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Printer, Search, X } from "lucide-react";
import { IdDocumentPanel } from "@/components/identity/id-document-panel";
import { StaffIdUploadForm } from "@/components/identity/staff-id-upload-form";
import { statusLabel } from "@/components/identity/id-card-flow";
import { getDictionary, type Locale } from "@/lib/i18n";
import { MAX_PRINT_PEOPLE } from "@/lib/staff-documents/print";
import {
  ROSTER_FILTERS,
  countRoster,
  inRosterFilter,
  matchesRosterQuery,
  rosterStatus,
  type RosterFilter,
  type StaffDocRosterRow,
} from "@/lib/staff-documents/roster";
import type { IdDocumentView } from "@/lib/staff-documents/server";
import { UsersSectionTabs } from "./users-section-tabs";
import { useAdminPanelA11y } from "../shared/use-admin-panel-a11y";

const initialOf = (name: string) => name.replace(/\(.*\)/, "").trim().charAt(0) || "?";

export type StaffDocsSelection = { userId: string; mode: "view" | "upload"; doc: IdDocumentView | null };

export function StaffDocsConsole({
  rows,
  selection,
  locale,
  confirmerName,
  isDeveloperViewer,
  memberCount,
  inviteCount,
}: {
  rows: StaffDocRosterRow[];
  selection: StaffDocsSelection | null;
  locale: Locale;
  confirmerName: string;
  isDeveloperViewer: boolean;
  memberCount: number | null;
  inviteCount: number | null;
}) {
  const router = useRouter();
  const dict = getDictionary(locale);
  const c = dict.admin.users.console;
  const idc = dict.idCard;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");

  const counts = useMemo(() => countRoster(rows), [rows]);
  const shown = useMemo(() => rows.filter((row) => inRosterFilter(row.bucket, filter) && matchesRosterQuery(row, query)), [rows, filter, query]);
  const printIds = shown.filter((row) => row.doc).map((row) => row.userId).slice(0, MAX_PRINT_PEOPLE);
  const selected = selection ? rows.find((row) => row.userId === selection.userId) ?? null : null;

  const filterLabel: Record<RosterFilter, string> = {
    all: c.docsFilterAll,
    pending: c.docsFilterPending,
    expired: c.docsFilterExpired,
    within90: c.docsFilter90,
    missing: c.docsFilterMissing,
  };
  const kindLabel = (kind: string | null | undefined) => (kind === "residence_card" ? idc.titleResidence : kind === "my_number_card" ? idc.titleMyNumber : null);
  const dateText = (key: string) => (key ? key.replaceAll("-", ". ").replace(/\. 0/g, ". ") : "—");

  const go = (href: string) => router.replace(href, { scroll: false });
  const open = (row: StaffDocRosterRow) => go(`/admin/users/documents?u=${row.userId}`);
  const close = () => go("/admin/users/documents");

  return (
    <div className="usw sdc">
      <div className="usw-bar">
        <UsersSectionTabs
          active="documents"
          labels={{ members: c.tabMembers, invites: c.tabInvites, documents: c.tabDocs }}
          counts={{ members: memberCount ?? undefined, invites: inviteCount ?? undefined, documents: rows.length }}
        />
        <form className="usw-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={c.docsSearch} aria-label={c.docsSearch} autoComplete="off" type="text" />
          {query ? (
            <button type="button" className="usw-search__x" aria-label={c.wClear} onClick={() => setQuery("")}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </form>
      </div>

      <div className="sdc-fl" role="group" aria-label={c.docsFilterAria}>
        {ROSTER_FILTERS.map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>
            {filterLabel[key]}
            <b className={`num${key === "expired" && counts.expired > 0 ? " is-red" : ""}`}>{counts[key]}</b>
          </button>
        ))}
        {printIds.length > 0 ? (
          <a className="sdc-print" href={`/account/id-card/print?u=${printIds.join(",")}`} rel="noopener" target="_blank">
            <Printer size={15} aria-hidden="true" />
            {c.docsPrint}
          </a>
        ) : null}
      </div>

      <div className="usw-th sdc-th" aria-hidden="true">
        <span>{c.docsColName}</span>
        <span>{c.docsColDoc}</span>
        <span>{c.docsColStatus}</span>
        <span>{c.docsColExpires}</span>
        <span>{c.docsColTodo}</span>
      </div>
      {shown.length === 0 ? (
        <div className="usw-empty">
          <b>{c.docsEmpty}</b>
          {query || filter !== "all" ? (
            <button
              type="button"
              className="usw-link"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              {c.wClear}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="usw-rows">
          {shown.map((row) => {
            const on = selection?.userId === row.userId;
            const st = on && selection?.mode === "upload" ? { text: c.docsStUploading, tone: "link" as const } : rosterStatus(row, c);
            return (
              <button key={row.userId} type="button" className={`usw-tr sdc-tr${on ? " on" : ""}`} aria-current={on ? "true" : undefined} onClick={() => open(row)}>
                <span className="usw-who">
                  <span className="usw-av" aria-hidden="true">
                    {initialOf(row.name)}
                  </span>
                  <span className="usw-who__t">
                    <b>
                      {row.name || "—"}
                      {row.isSelf ? <span className="usw-me">{c.selfChip}</span> : null}
                    </b>
                    <span>{row.nationalityName || "—"}</span>
                  </span>
                </span>
                <span className={`usw-c${row.doc ? "" : " is-soft"}`}>{kindLabel(row.doc?.kind) ?? "—"}</span>
                <span className={`usw-c${row.doc?.residenceStatus ? "" : " is-soft"}`} lang={row.doc?.residenceStatus ? "ja" : undefined}>
                  {row.doc?.residenceStatus || "—"}
                </span>
                <span className={`usw-c num${row.doc?.expiresOn ? "" : " is-soft"}`}>{dateText(row.doc?.expiresOn ?? "")}</span>
                <span className={`sdc-st is-${st.tone}`}>{st.text}</span>
              </button>
            );
          })}
        </div>
      )}

      {selection && selected ? (
        <StaffDocPanel
          key={`${selection.userId}:${selection.mode}`}
          row={selected}
          selection={selection}
          locale={locale}
          confirmerName={confirmerName}
          isDeveloperViewer={isDeveloperViewer}
          onClose={close}
          onUpload={() => go(`/admin/users/documents?u=${selected.userId}&upload=1`)}
          onUploadDone={() => {
            go(`/admin/users/documents?u=${selected.userId}`);
            router.refresh();
          }}
          onUploadCancel={() => (selected.doc ? go(`/admin/users/documents?u=${selected.userId}`) : close())}
          kindLabel={kindLabel}
        />
      ) : null}
    </div>
  );
}

function StaffDocPanel({
  row,
  selection,
  locale,
  confirmerName,
  isDeveloperViewer,
  onClose,
  onUpload,
  onUploadDone,
  onUploadCancel,
  kindLabel,
}: {
  row: StaffDocRosterRow;
  selection: StaffDocsSelection;
  locale: Locale;
  confirmerName: string;
  isDeveloperViewer: boolean;
  onClose: () => void;
  onUpload: () => void;
  onUploadDone: () => void;
  onUploadCancel: () => void;
  kindLabel: (kind: string | null | undefined) => string | null;
}) {
  const dict = getDictionary(locale);
  const c = dict.admin.users.console;
  const idc = dict.idCard;
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose);
  const canUpload = Boolean(row.kind) && (!row.isSelf || isDeveloperViewer);
  const uploading = selection.mode === "upload" || !selection.doc;
  const doc = selection.doc;

  return (
    <>
      <div className="panel-scrim on" onClick={onClose} />
      <aside ref={panelRef} className="panel on usw-panel sdc-panel" role="dialog" aria-label={row.name || c.tabDocs} tabIndex={-1}>
        <div className="usw-ph">
          {uploading && canUpload ? (
            <span className="usw-ph__main" />
          ) : (
            <>
              <span className="usw-av is-lg" aria-hidden="true">
                {initialOf(row.name)}
              </span>
              <div className="usw-ph__main">
                <h2>{row.name || "—"}</h2>
                <span>{[row.nationalityName, kindLabel(doc?.kind ?? row.kind), doc ? statusLabel(idc, doc.status) : null].filter(Boolean).join(" · ")}</span>
              </div>
            </>
          )}
          <button type="button" className="usw-ic usw-ph__x" aria-label={c.wClose} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="panel__body usw-pb sdc-pb">
          {uploading ? (
            !row.kind ? (
              <p className="sdc-note">{idc.upNoNationality}</p>
            ) : !canUpload ? (
              <p className="sdc-note">{idc.upSelf}</p>
            ) : (
              <StaffIdUploadForm
                target={{ userId: row.userId, name: row.name, kind: row.kind }}
                confirmerName={confirmerName}
                locale={locale}
                variant="pc"
                onCancel={onUploadCancel}
                onSaved={onUploadDone}
              />
            )
          ) : (
            <>
              <IdDocumentPanel
                canReview={!row.isSelf || isDeveloperViewer}
                doc={doc}
                locale={locale}
                printHref={doc ? `/account/id-card/print?u=${row.userId}` : null}
              />
              {canUpload ? (
                <button type="button" className="usw-link sdc-new" onClick={onUpload}>
                  {idc.upNewCard}
                </button>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
