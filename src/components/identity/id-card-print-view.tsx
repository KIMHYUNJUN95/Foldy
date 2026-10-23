"use client";

/**
 * 신분 서류 A4 인쇄 화면(재류카드 R3, docs/product/41 §3-4 · 시안 A4-Print).
 *
 * - 위 막대(화면 전용 · 인쇄엔 빠짐): 사람 수 · 빠진 사람 · 「크게(2배)」 · 인쇄 · PDF 저장 · 배율 100% 안내. 글은 ko/ja/en.
 * - 아래 A4 종이들(일본어 고정 양식): 한 사람당 한 장, 페이지 나눔으로 이어서. 카드 사진은 실제 크기 85.6 × 54mm(2배 171.2 × 108mm).
 * - 사진이 모두 다 불러와진 뒤에만 인쇄 버튼이 켜진다(빈 칸으로 인쇄되지 않게).
 * - 인쇄 기록: 버튼은 기록을 먼저 남기고(실패하면 인쇄하지 않음) 인쇄, 브라우저 Ctrl+P 는 `beforeprint` 에서 기록.
 *   버튼으로 연 인쇄는 beforeprint 에서 다시 기록하지 않는다(한 번 인쇄 = 한 번 기록). 화면을 연 것만으로는 기록하지 않는다.
 */

import { Printer } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { recordIdDocumentPrint } from "@/app/account/id-card/print/actions";
import {
  PRINT_CONFIDENTIAL,
  PRINT_PHOTO_MISSING,
  PRINT_LARGE_SUFFIX,
  PRINT_SCALE_NOTE,
  PRINT_STAMP_LABEL,
  printFooter,
  type PrintablePerson,
  type PrintRow,
} from "@/lib/staff-documents/print";

type Copy = {
  printCta: string;
  printLoading: string;
  printLarge: string;
  printScaleHint: string;
  printCount: string;
  printSkipped: string;
  printEmpty: string;
  printLogFailed: string;
  printBack: string;
};

/** 화면에서 A4(210mm ≈ 794px)가 좁은 폰에 들어가게 줄이는 비율. 인쇄 때는 CSS 가 1 로 되돌린다. */
const SHEET_PX = 794;

export function IdCardPrintView({
  people,
  skipped,
  printerName,
  printedAt,
  copy,
}: {
  people: PrintablePerson[];
  skipped: number;
  printerName: string;
  printedAt: string;
  copy: Copy;
}) {
  const [large, setLarge] = useState(false);
  const [ready, setReady] = useState(people.length === 0);
  const [error, setError] = useState<string | null>(null);
  // 닫기를 막는 탭에서 돌아갈 곳. 폰 화면이면 미들웨어가 /mobile 쪽으로 보낸다.
  const backHref = "/admin/users";
  const [footerAt, setFooterAt] = useState(() => new Date(printedAt));
  const [zoom, setZoom] = useState(1);
  const sheetsRef = useRef<HTMLDivElement>(null);
  /** 버튼으로 연 인쇄 — 기록은 이미 남겼으니 beforeprint 는 건너뛴다. */
  const loggedByButton = useRef(false);
  const userIds = people.map((p) => p.userId);
  const idsKey = userIds.join(",");

  // 사진이 다 불러와졌나 — 이미 캐시돼 하이드레이션 전에 끝난 사진도 `complete` 로 잡는다. 실패한 사진도 「끝남」(그 칸은 画像なし).
  useEffect(() => {
    const root = sheetsRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll("img"));
    const update = () => setReady(imgs.every((img) => img.complete));
    imgs.forEach((img) => {
      img.addEventListener("load", update);
      img.addEventListener("error", update);
    });
    update();
    return () =>
      imgs.forEach((img) => {
        img.removeEventListener("load", update);
        img.removeEventListener("error", update);
      });
  }, []);

  // 폰 화면에서는 종이를 화면 폭에 맞춰 줄여 보여 준다(인쇄에는 영향 없음).
  useLayoutEffect(() => {
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 24) / SHEET_PX));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // 기록은 인쇄 창이 열리는 순간(beforeprint) 한 곳에서만 남긴다 — 버튼 · Ctrl+P · 브라우저 메뉴 모두.
  // 예전엔 버튼이 서버 기록을 기다린 뒤 window.print() 를 불러, Safari 가 「사용자 동작이 아님」으로 막거나 다시 물을 수 있었다(2026-10-23 점검).
  // 그래서 「기록이 실패하면 인쇄하지 않음」은 보장하지 않는다(실패하면 화면에 알림만). 바닥글의 출력 일시는 실제 인쇄 순간으로.
  useEffect(() => {
    const onBefore = () => {
      flushSync(() => setFooterAt(new Date()));
      if (loggedByButton.current) return;
      loggedByButton.current = true;
      if (idsKey) {
        void recordIdDocumentPrint(idsKey.split(",")).then((result) => {
          if (!result.ok) setError(copy.printLogFailed);
        });
      }
    };
    const onAfter = () => {
      loggedByButton.current = false;
    };
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, [idsKey, copy.printLogFailed]);

  function print() {
    setError(null);
    // 누른 그 자리에서 바로 연다(사용자 동작 유지). 기록은 위 beforeprint 가 남긴다.
    window.print();
  }

  const footer = printFooter(footerAt, printerName);

  return (
    <main className="icp" data-ready={ready ? "" : undefined} data-size={large ? "large" : "actual"}>
      <div className="icp-bar">
        <div className="icp-bar__row">
          <p className="icp-bar__count">
            {people.length > 0 ? copy.printCount.replace("{n}", String(people.length)) : copy.printEmpty}
          </p>
          {people.length > 0 ? (
            <>
              <label className="icp-bar__toggle">
                <input checked={large} onChange={(e) => setLarge(e.target.checked)} type="checkbox" />
                <span>{copy.printLarge}</span>
              </label>
              <button className="icp-bar__btn" disabled={!ready} onClick={print} type="button">
                <Printer aria-hidden="true" />
                {ready ? copy.printCta : copy.printLoading}
              </button>
            </>
          ) : null}
          <button
            className="icp-bar__close"
            onClick={() => {
              window.close();
              // 탭을 닫을 수 없는 경우(방문 기록이 여러 개) — 사용자 관리로.
              window.setTimeout(() => {
                if (!window.closed) window.location.assign(backHref);
              }, 150);
            }}
            type="button"
          >
            {copy.printBack}
          </button>
        </div>
        {skipped > 0 ? <p className="icp-bar__warn">{copy.printSkipped.replace("{n}", String(skipped))}</p> : null}
        {people.length > 0 ? <p className="icp-bar__hint">{copy.printScaleHint}</p> : null}
        {error ? (
          <p className="icp-bar__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="icp-sheets" ref={sheetsRef} style={{ zoom }}>
        {people.map((person) => (
          <Sheet footer={footer} key={person.userId} large={large} person={person} />
        ))}
      </div>
    </main>
  );
}

function Rows({ rows }: { rows: PrintRow[] }) {
  return (
    <dl className="icp-grid">
      {rows.map((row) => (
        <div className="icp-grid__row" key={row.label}>
          <dt>{row.label}</dt>
          <dd lang={row.lang}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CardImage({ url, label, large }: { url: string | null; label: string; large: boolean }) {
  return (
    <figure className="icp-card">
      <figcaption>{large ? `${label}${PRINT_LARGE_SUFFIX}` : label}</figcaption>
      <div className="icp-card__frame">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- 10분 서명 URL, 인쇄용 원본 크기
          <img alt={label} decoding="sync" loading="eager" src={url} />
        ) : (
          <span className="icp-card__missing">{PRINT_PHOTO_MISSING}</span>
        )}
      </div>
    </figure>
  );
}

function Sheet({ person, footer, large }: { person: PrintablePerson; footer: string; large: boolean }) {
  const { sheet } = person;
  return (
    <article className="icp-sheet" lang="ja">
      <header className="icp-head">
        <div>
          <div className="icp-head__org">{sheet.organizationName}</div>
          <h1 className="icp-head__title">{sheet.title}</h1>
        </div>
        <div className="icp-stamp" aria-hidden="true">
          <div>{PRINT_STAMP_LABEL}</div>
          <div />
        </div>
      </header>
      <Rows rows={sheet.top} />
      <section className="icp-cards">
        <CardImage label={sheet.frontLabel} large={large} url={person.frontUrl} />
        {sheet.backLabel ? <CardImage label={sheet.backLabel} large={large} url={person.backUrl} /> : null}
        <p className="icp-cards__note">{PRINT_SCALE_NOTE}</p>
      </section>
      <footer className="icp-foot">
        <Rows rows={sheet.bottom} />
        {sheet.attestation ? <p className="icp-foot__attest">{sheet.attestation}</p> : null}
        <div className="icp-foot__meta">
          <span>{footer}</span>
          <span>{PRINT_CONFIDENTIAL}</span>
        </div>
      </footer>
    </article>
  );
}
