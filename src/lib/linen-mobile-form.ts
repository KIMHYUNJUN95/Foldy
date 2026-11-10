// 린넨 반품 모바일 화면의 순수 판정 — 오류 뒤 입력 복원(임시 저장) · 장부 기간 · 품목 집계 보충.
// 화면 파일에서 빼 두어 테스트로 고정한다(2026-11-10 린넨 점검).
import { shiftMonthKey } from "@/components/admin/shared/admin-month-key";

export type LinenDraft = {
  /** 제출 id — 서버가 같은 id 두 번을 한 번으로 본다. */
  id: string;
  /** 그 id 로 보낸 내용의 지문 — 다음 제출 때 같은지 본다. */
  fp: string;
  qty: Record<string, number>;
  note: string;
  /** 저장한 시각(ms) — 1시간이 지난 것은 쓰지 않는다. */
  savedAt: number;
};

export const LINEN_DRAFT_TTL_MS = 60 * 60 * 1000;

export function linenDraftKey(mode: "create" | "edit", building: string, recordId?: string): string {
  return `linen-draft:${mode}:${building}:${recordId ?? ""}`;
}

export function serializeLinenDraft(draft: LinenDraft): string {
  return JSON.stringify(draft);
}

/** 임시 저장 읽기. 사진은 보관하지 않는다(오류 뒤 사용자가 다시 고른다). */
export function parseLinenDraft(raw: string | null): LinenDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LinenDraft> | null;
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !v.id) return null;
    const qty: Record<string, number> = {};
    if (v.qty && typeof v.qty === "object") {
      for (const [k, n] of Object.entries(v.qty)) {
        if (typeof n === "number" && Number.isInteger(n) && n > 0) qty[k] = n;
      }
    }
    return { id: v.id, fp: typeof v.fp === "string" ? v.fp : "", qty, note: typeof v.note === "string" ? v.note : "",
      savedAt: typeof v.savedAt === "number" ? v.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** 임시 저장 읽기 + 유효 시간 확인 — 저장 시각이 없거나 미래이거나 1시간이 지났으면 null(호출자가 지운다). */
export function freshLinenDraft(raw: string | null, now: number): LinenDraft | null {
  const d = parseLinenDraft(raw);
  if (!d || !d.savedAt || d.savedAt > now || now - d.savedAt > LINEN_DRAFT_TTL_MS) return null;
  return d;
}

/** 제출 순간의 내용 지문 — 건물 · 정렬한 품목·수량 · 메모 · 남긴 사진 주소 · 새로 고른 파일의 개수와 이름·크기. */
export function linenFingerprint(input: {
  building: string;
  lines: { itemId: string; quantity: number }[];
  note: string;
  keptPhotos: string[];
  files: { name: string; size: number }[];
}): string {
  const lines = [...input.lines].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return JSON.stringify([
    input.building,
    lines.map((l) => [l.itemId, l.quantity]),
    input.note,
    input.keptPhotos,
    input.files.length,
    input.files.map((f) => [f.name, f.size]),
  ]);
}

/** 지문이 지난 제출과 같으면 같은 id(재시도), 다르면 새 id. */
export function decideSubmissionId(stored: { id: string; fp: string } | null, fp: string, makeId: () => string): string {
  return stored && stored.fp && stored.fp === fp ? stored.id : makeId();
}

export type LedgerYearMonth = { year: number; month: number };

/** 주소창의 year · month. 2000 ~ 현재 연도+1, 1~12 밖이거나 숫자가 아니면 이번 달. */
export function parseLedgerPeriod(
  yearRaw: string | undefined,
  monthRaw: string | undefined,
  current: LedgerYearMonth,
): LedgerYearMonth {
  const ok = (s: string | undefined) => (s && /^\d{1,4}$/.test(s.trim()) ? Number(s) : NaN);
  const year = ok(yearRaw);
  const month = ok(monthRaw);
  if (year >= 2000 && year <= current.year + 1 && month >= 1 && month <= 12) return { year, month };
  return current;
}

export function shiftLedgerMonth(year: number, month: number, delta: number): LedgerYearMonth {
  const key = shiftMonthKey(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`, delta);
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m };
}

export type LinenAggRow = { id: string; name: string; qty: number; count: number };

/** 반품이 없던 품목도 0 으로 보이게 — 이름이 아니라 id 로 거른다(이름이 같은 다른 품목이 있을 수 있다). */
export function aggregateWithCatalog(rows: LinenAggRow[], catalog: { id: string; name: string }[]): LinenAggRow[] {
  const have = new Set(rows.map((r) => r.id));
  const out = [...rows];
  for (const it of catalog) {
    if (!have.has(it.id)) {
      have.add(it.id);
      out.push({ id: it.id, name: it.name, qty: 0, count: 0 });
    }
  }
  return out;
}

/** 화면에 온 오류 문구가 어느 코드의 것인지(문구 사전에서 거꾸로 찾는다). */
export function errorCodeForMessage(message: string | null, errors: Record<string, string>): string | null {
  if (!message) return null;
  return Object.entries(errors).find(([, text]) => text === message)?.[0] ?? null;
}
