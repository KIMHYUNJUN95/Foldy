"use server";

import { getCurrentAppSession } from "@/lib/session";
import { parsePrintUserIds } from "@/lib/staff-documents/print";
import { canPrintIdDocuments, recordPrint } from "@/lib/staff-documents/print-server";

/**
 * 인쇄 기록 남기기(docs/product/41 §3-4) — 인쇄 화면이 인쇄 직전(버튼 · 브라우저 Ctrl+P 의 beforeprint)에 부른다.
 * 권한 · 조직 걸러내기는 화면을 그릴 때와 같은 규칙으로 서버가 다시 한다(클라이언트가 보낸 id 를 믿지 않는다).
 */
export async function recordIdDocumentPrint(userIds: string[]): Promise<{ ok: boolean; count?: number }> {
  const session = await getCurrentAppSession();
  if (!session || !canPrintIdDocuments(session)) return { ok: false };
  const ids = parsePrintUserIds(Array.isArray(userIds) ? userIds.filter((v): v is string => typeof v === "string") : []);
  if (ids.length === 0) return { ok: false };
  try {
    const count = await recordPrint(session, ids);
    return { ok: count > 0, count };
  } catch (error) {
    console.error("[id-card/print] log failed", error instanceof Error ? error.message : error);
    return { ok: false };
  }
}
