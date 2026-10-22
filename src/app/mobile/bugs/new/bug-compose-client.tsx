"use client";

/**
 * 새 버그 신고 — 화이트 리디자인(2026-10-15, 시안 Bug-Phone).
 * 머리(「버그 신고」 · 한 줄 설명 · 오른쪽 「내 신고 N」) → 테두리 위에 이름표가 걸친 칸 「어떤 문제인가요?」 · 「자세히」 → 화면 사진(5장까지,
 * 기존 압축 · 업로드 그대로) → 꽉 찬 「보내기」(누르면 도는 표시 → 체크가 그려지고 목록으로) → 안내 한 줄. 저장 순서 · 서버 액션은 그대로.
 * See docs/product/25-bug-report-workflow.md 「화이트 리디자인 — 모바일」.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { compressImageFile } from "@/components/announcements/announcement-image-uploader";
import type { BugCopy } from "@/components/bugs/bug-types";
import { uploadBugReportImageAction, createBugReportAction } from "../actions";
import "@/components/bugs/bugs-white.css";
import { haptic } from "@/lib/haptics";

const ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];
const MAX_IMAGES = 5;

type Preview = { id: string; file: File; url: string };

const PLUS = (
  <svg aria-hidden="true" fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" viewBox="0 0 24 24" width="22">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const X = (
  <svg aria-hidden="true" fill="none" height="11" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" viewBox="0 0 24 24" width="11">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const CHECK = (
  <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" viewBox="0 0 24 24" width="20">
    <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
  </svg>
);

export function BugComposeClient({ copy, myCount }: { copy: BugCopy; myCount: number }) {
  const w = copy.white;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  // preview URL revoke on unmount
  const previewsRef = useRef(previews);
  useEffect(() => { previewsRef.current = previews; }, [previews]);
  useEffect(
    () => () => { previewsRef.current.forEach((p) => URL.revokeObjectURL(p.url)); },
    [],
  );

  const busy = isPending || done;
  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !busy;

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const allowed = files.filter((f) => ALLOWED_TYPES.includes(f.type));
    const remaining = MAX_IMAGES - previews.length;
    const toAdd = allowed.slice(0, remaining);
    if (toAdd.length === 0) return;

    const newPreviews: Preview[] = toAdd.map((f) => ({
      id: `${Date.now()}-${Math.random()}`,
      file: f,
      url: URL.createObjectURL(f),
    }));
    setPreviews((prev) => [...prev, ...newPreviews]);
  }

  function removePreview(id: string) {
    setPreviews((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((p) => p.id !== id);
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      // 1단계: title/description만으로 report row 생성 → id 확보
      const baseFormData = new FormData();
      baseFormData.set("title", title.trim());
      baseFormData.set("description", description.trim());

      const createResult = await createBugReportAction(baseFormData);
      if ("error" in createResult) {
        haptic("error");
        setError(copy.submitError);
        return;
      }

      const reportId = createResult.id;

      // 2단계: 이미지가 있으면 각각 압축 후 업로드
      for (const preview of previews) {
        try {
          const compressed = await compressImageFile(preview.file);
          const imgForm = new FormData();
          imgForm.set("file", compressed);
          await uploadBugReportImageAction(reportId, imgForm);
        } catch {
          // 이미지 업로드 실패는 non-fatal — report 자체는 이미 생성됨
        }
      }

      // 체크가 그려지는 걸 잠깐 보여 주고 목록으로.
      setDone(true);
      haptic("success");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(() => router.replace("/mobile/bugs"), reduce ? 0 : 650);
    });
  }

  const state = done ? "done" : isPending ? "busy" : undefined;

  return (
    <div className="bgw">
      <header className="bgw-h">
        <div className="bgw-h__t">
          <h1>{copy.title}</h1>
          <p>{w.formSub}</p>
        </div>
        <Link className="bgw-link" href="/mobile/bugs">
          {w.myReports.replace("{n}", String(myCount))}
        </Link>
      </header>

      <form className="bgw-form" onSubmit={onSubmit}>
        <label className="bgw-fl">
          <span>{w.fieldTitle}</span>
          <input
            enterKeyHint="next"
            onChange={(e) => setTitle(e.target.value)}
            placeholder={copy.composeTitlePlaceholder}
            type="text"
            value={title}
          />
        </label>

        <label className="bgw-fl">
          <span>{w.fieldDetail}</span>
          <textarea
            onChange={(e) => setDescription(e.target.value)}
            placeholder={copy.composeDescriptionPlaceholder}
            rows={4}
            value={description}
          />
        </label>

        <div className="bgw-ph">
          <span className="bgw-ph__l">
            {w.photos} <span>{w.photosHint.replace("{n}", String(previews.length))}</span>
          </span>
          <div className="bgw-ph__g">
            {previews.map((preview) => (
              <div className="bgw-tile" key={preview.id} style={{ backgroundImage: `url(${preview.url})` }}>
                <button aria-label={copy.screenshotRemoveAria} onClick={() => removePreview(preview.id)} type="button">
                  {X}
                </button>
              </div>
            ))}
            {previews.length < MAX_IMAGES ? (
              <button aria-label={copy.screenshotAddAria} className="bgw-add" onClick={() => fileRef.current?.click()} type="button">
                {PLUS}
              </button>
            ) : null}
          </div>
          <input accept="image/*" aria-hidden="true" className="sr-only" multiple onChange={onPickFiles} ref={fileRef} tabIndex={-1} type="file" />
        </div>

        {error ? (
          <p className="bgw-err" role="alert">
            {error}
          </p>
        ) : null}

        <button className="bgw-send" data-state={state} disabled={!canSubmit} type="submit">
          {done ? (
            <>
              {CHECK}
              {w.sent}
            </>
          ) : isPending ? (
            <>
              <span aria-hidden="true" className="bgw-spin" />
              {w.sending}
            </>
          ) : (
            w.send
          )}
        </button>
        <p className="bgw-note">{w.note}</p>
      </form>
    </div>
  );
}
