import type { Metadata } from "next";
import { redirect } from "next/navigation";
import "@/components/identity/id-card-print.css";
import { IdCardPrintView } from "@/components/identity/id-card-print-view";
import { getDictionary } from "@/lib/i18n";
import { getCurrentAppSession } from "@/lib/session";
import { parsePrintUserIds } from "@/lib/staff-documents/print";
import { canPrintIdDocuments, loadPrintPeople } from "@/lib/staff-documents/print-server";

/**
 * 신분 서류 A4 인쇄(재류카드 R3, docs/product/41 §3-4) — `?u=<사람id,…>` 한 사람당 A4 한 장.
 *
 * 셸 없는 화면(인쇄물에 사이드바 · 탭바가 섞이면 안 된다). `/admin` 아래가 아닌 이유: 폰에서는 미들웨어가 `/admin/*` 를
 * `/mobile` 로 돌려보내는데, 모바일 사용자 관리 상세에서도 한 사람 인쇄를 연다.
 * 권한 `staff_documents.view` + 같은 조직 — 다른 조직 사람 id 는 서버가 걸러 「빠짐」 수로만 보인다.
 * 화면을 여는 것만으로는 기록하지 않는다 — 인쇄할 때(버튼 · Ctrl+P) 서버 액션이 기록한다.
 */

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const session = await getCurrentAppSession();
  return { title: getDictionary(session?.user.preferredLanguage ?? "ko").idCard.printTitle, robots: { index: false } };
}

export default async function IdCardPrintPage({ searchParams }: Props) {
  const [session, params] = await Promise.all([getCurrentAppSession(), searchParams]);
  const ids = parsePrintUserIds(params?.u);
  if (!session) {
    redirect(`/auth/login?next=${encodeURIComponent(`/account/id-card/print?u=${ids.join(",")}`)}`);
  }
  const copy = getDictionary(session.user.preferredLanguage).idCard;

  if (!canPrintIdDocuments(session)) {
    return (
      <main className="icp-msg">
        <p>{copy.printForbidden}</p>
      </main>
    );
  }

  const { people, skipped, printerName } = await loadPrintPeople(session, ids);
  return (
    <IdCardPrintView
      copy={{
        printCta: copy.printCta,
        printLoading: copy.printLoading,
        printLarge: copy.printLarge,
        printScaleHint: copy.printScaleHint,
        printCount: copy.printCount,
        printSkipped: copy.printSkipped,
        printEmpty: copy.printEmpty,
        printLogFailed: copy.printLogFailed,
        printBack: copy.printBack,
      }}
      printedAt={new Date().toISOString()}
      printerName={printerName}
      people={people}
      skipped={skipped}
    />
  );
}
