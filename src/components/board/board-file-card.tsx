"use client";
import { Download, Loader2, X } from "lucide-react";

type FileType = "xls" | "pdf" | "doc" | "generic";

function detectFileType(mimeType: string, name: string): FileType {
  const lower = name.toLowerCase();
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || /\.(xlsx|xls|csv)$/.test(lower)) return "xls";
  if (mimeType.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (mimeType.includes("word") || /\.(docx|doc)$/.test(lower)) return "doc";
  return "generic";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const typeLabel: Record<FileType, string> = { xls: "XLS", pdf: "PDF", doc: "DOC", generic: "FILE" };

/**
 * 첨부 파일 한 줄 — 화이트 리디자인(2026-10-15): 회색 둥근 줄 · 흰 종류 표시 · 이름 · 크기.
 * - 상세(`onDownload`): 줄 전체가 버튼, 서명 URL 로 내려받는다(부모가 처리). 오른쪽은 내려받기 아이콘.
 * - 글쓰기 · 수정(`onRemove`): 오른쪽 ✕ 로 뺀다.
 */
export function BoardFileCard({
  name,
  sizeBytes,
  mimeType,
  onRemove,
  removeLabel,
  onDownload,
  downloading = false,
  downloadLabel,
  hint,
}: {
  name: string;
  sizeBytes: number;
  mimeType: string;
  onRemove?: () => void;
  removeLabel?: string;
  onDownload?: () => void;
  downloading?: boolean;
  downloadLabel?: string;
  /** 크기 옆 회색 안내(「누르면 내려받아요」). */
  hint?: string;
}) {
  const type = detectFileType(mimeType, name);
  const inner = (
    <>
      <span className={`bdw-file__ty is-${type}`}>{typeLabel[type]}</span>
      <span className="bdw-file__b">
        <span className="bdw-file__n">{name}</span>
        <span className="bdw-file__s">{hint ? `${formatSize(sizeBytes)} · ${hint}` : formatSize(sizeBytes)}</span>
      </span>
    </>
  );

  if (onDownload && !onRemove) {
    return (
      <button
        aria-label={`${downloadLabel ?? ""} · ${name}`}
        className="bdw-file"
        disabled={downloading}
        onClick={onDownload}
        type="button"
      >
        {inner}
        {downloading ? (
          <Loader2 aria-hidden="true" className="bdw-file__i bdw-spin" />
        ) : (
          <Download aria-hidden="true" className="bdw-file__i" strokeWidth={1.8} />
        )}
      </button>
    );
  }

  return (
    <div className="bdw-file is-static">
      {inner}
      {onRemove ? (
        <button aria-label={removeLabel ? `${removeLabel} · ${name}` : name} className="bdw-file__x" onClick={onRemove} type="button">
          <X aria-hidden="true" strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  );
}
