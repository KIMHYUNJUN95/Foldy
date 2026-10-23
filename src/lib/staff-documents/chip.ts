import type { ExpiryTone, IdDocumentStatus } from "@/lib/staff-documents/fields";

export type IdDocChip = { kind: "pending" | "expired" | "expiring" | "returned"; label: string };

type ChipCopy = { idDocPending: string; idDocExpired: string; idDocExpiring: string; idDocReturned: string };

/** 목록에 칩으로 보일 서류 상태 — 관리자가 할 일이 있는 것만(확인 대기 > 만료 > 만료 임박 > 재제출 대기). 문제 없으면 null. */
export function idDocChip(doc: { status: IdDocumentStatus; tone: ExpiryTone | null } | null, copy: ChipCopy): IdDocChip | null {
  if (!doc) return null;
  if (doc.status === "pending") return { kind: "pending", label: copy.idDocPending };
  if (doc.tone === "expired") return { kind: "expired", label: copy.idDocExpired };
  if (doc.tone === "within30") return { kind: "expiring", label: copy.idDocExpiring };
  if (doc.status === "returned") return { kind: "returned", label: copy.idDocReturned };
  return null;
}
