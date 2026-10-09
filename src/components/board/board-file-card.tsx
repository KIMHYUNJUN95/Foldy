"use client";
import { X, Paperclip, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type FileType = "xls" | "pdf" | "doc" | "generic";

function detectFileType(mimeType: string, name: string): FileType {
  if (mimeType.includes("spreadsheet") || name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) return "xls";
  if (mimeType.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mimeType.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) return "doc";
  return "generic";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const typeStyles: Record<FileType, { bg: string; text: string; label: string }> = {
  xls:     { bg: "bg-[hsl(146_44%_92%)]", text: "text-[hsl(150_56%_28%)]", label: "XLS" },
  pdf:     { bg: "bg-[#fdecec]",   text: "text-[#c5282e]",   label: "PDF" },
  doc:     { bg: "bg-[hsl(206_66%_93%)]", text: "text-[hsl(206_70%_38%)]", label: "DOC" },
  generic: { bg: "bg-[hsl(220_12%_92%)]", text: "text-[hsl(220_12%_52%)]", label: "FILE" },
};

export function BoardFileCard({
  name,
  sizeBytes,
  mimeType,
  onRemove,
  onDownload,
  downloading = false,
  downloadLabel,
}: {
  name: string;
  sizeBytes: number;
  mimeType: string;
  onRemove?: () => void;
  // When provided (and no onRemove), the whole card becomes a download button.
  onDownload?: () => void;
  downloading?: boolean;
  downloadLabel?: string;
}) {
  const type = detectFileType(mimeType, name);
  const style = typeStyles[type];

  const inner = (
    <>
      <span className={cn("inline-flex size-[38px] shrink-0 items-center justify-center rounded-[10px] font-mono text-[10px] font-extrabold tracking-[0.02em]", style.bg, style.text)}>
        {style.label}
      </span>
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] font-bold text-foreground">{name}</div>
        <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{formatSize(sizeBytes)}</div>
      </div>
    </>
  );

  // Download variant: the entire row is a button (mobile + PC friendly tap target).
  if (onDownload && !onRemove) {
    return (
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        aria-label={`${downloadLabel ?? "Download"} · ${name}`}
        className="flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-surface px-3 py-[10px] text-left transition-colors active:bg-[hsl(40_22%_94%)] disabled:opacity-60"
      >
        {inner}
        <span className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-primary/[0.10] text-primary">
          {downloading ? (
            <Loader2 className="size-[14px] animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-[14px]" aria-hidden="true" />
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="flex w-full items-center gap-[11px] rounded-[12px] border border-border bg-surface px-3 py-[10px]">
      {inner}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-[#f4f4f7] text-muted-foreground"
        >
          <X className="size-[13px]" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function BoardFileAddButton({
  onClick,
  disabled,
  label,
}: {
  onClick?: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 items-center gap-[7px] rounded-[12px] border-[1.5px] border-dashed border-border px-[14px] text-[13px] font-bold text-[#3a3746] disabled:opacity-50"
    >
      <Paperclip className="size-[17px]" aria-hidden="true" />
      {label}
    </button>
  );
}
