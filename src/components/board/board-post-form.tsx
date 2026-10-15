"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Paperclip, Plus, X } from "lucide-react";
import { haptic } from "@/lib/haptics";
import type { Dictionary } from "@/lib/i18n";
import "./board-white.css";

/**
 * 글쓰기 · 글 수정이 함께 쓰는 화면 조각 — 화이트 리디자인(2026-10-15, 시안 BoardNew-Phone).
 * 두 화면은 데이터(새 파일 · 이미 올라간 URL)만 다르고 생김새는 같아야 한다 — 다르게 생기면 «다른 기능»으로 읽힌다.
 */

type FormCopy = Dictionary["board"];

/** 머리 · 이름표 칸(제목 · 본문) · 아래 큰 보라 버튼까지의 틀. 사진 · 파일 · 태그 · 고정은 children. */
export function BoardPostForm({
  heading,
  copy,
  error,
  title,
  content,
  onTitle,
  onContent,
  submitLabel,
  canSubmit,
  onSubmit,
  children,
}: {
  heading: string;
  copy: FormCopy;
  error: string | null;
  title: string;
  content: string;
  onTitle: (v: string) => void;
  onContent: (v: string) => void;
  submitLabel: string;
  canSubmit: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="bdw bdw-form">
      <header className="bdw-form__head">
        <h1>{heading}</h1>
        <span>{copy.composeAudience}</span>
      </header>
      {error ? (
        <p className="bdw-form__err" role="alert">
          {error}
        </p>
      ) : null}
      <label className="bdw-nf">
        <span className="bdw-nf__l">{copy.titlePlaceholder}</span>
        <input className="bdw-nf__in is-title" onChange={(e) => onTitle(e.target.value)} type="text" value={title} />
      </label>
      <label className="bdw-nf">
        <span className="bdw-nf__l">{copy.bodyLabel}</span>
        <textarea
          className="bdw-nf__in is-body"
          onChange={(e) => onContent(e.target.value)}
          placeholder={copy.contentPlaceholder}
          rows={7}
          value={content}
        />
      </label>
      {children}
      <button
        className="bdw-btn is-pri is-lg"
        disabled={!canSubmit}
        onClick={() => {
          haptic("light");
          onSubmit();
        }}
        type="button"
      >
        {submitLabel}
      </button>
    </div>
  );
}

/** 「사진 · 파일」 — 76px 사진 칸 + 더하기 칸 + 「사진 n / 5」, 그 아래 파일 줄(children)과 보라 「파일 첨부」 글자 버튼. */
export function BoardAttachSection({
  copy,
  photos,
  maxPhotos,
  onAddPhoto,
  onRemovePhoto,
  canAddFile,
  maxFiles,
  onAddFile,
  children,
}: {
  copy: FormCopy;
  photos: { id: string; src: string }[];
  maxPhotos: number;
  onAddPhoto: () => void;
  onRemovePhoto: (id: string) => void;
  canAddFile: boolean;
  maxFiles: number;
  onAddFile: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="bdw-sec">
      <span className="bdw-sec__l">{copy.attachSection}</span>
      <div className="bdw-tiles">
        {photos.map((p) => (
          <span className="bdw-tile" key={p.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src={p.src} />
            <button aria-label={copy.deletePhoto} className="bdw-tile__x" onClick={() => onRemovePhoto(p.id)} type="button">
              <X aria-hidden="true" strokeWidth={2.4} />
            </button>
          </span>
        ))}
        {photos.length < maxPhotos ? (
          <button aria-label={copy.addPhoto} className="bdw-tile is-add" onClick={onAddPhoto} type="button">
            <Plus aria-hidden="true" strokeWidth={2} />
          </button>
        ) : null}
        <span className="bdw-tiles__n num">
          {copy.photoCount.replace("{n}", String(photos.length)).replace("{max}", String(maxPhotos))}
        </span>
      </div>
      {children}
      {canAddFile ? (
        <button className="bdw-linkbtn" onClick={onAddFile} type="button">
          <Paperclip aria-hidden="true" strokeWidth={1.8} />
          {copy.fileAddLong.replace("{max}", String(maxFiles))}
        </button>
      ) : null}
    </section>
  );
}

/**
 * 「태그」 — 고른 태그(옅은 보라 · ✕)와 조직에서 쓰던 태그(회색, 누르면 고름), 끝의 「+ 새 태그」 를 누르면 그 자리에 입력칸.
 * 한글 · 일본어 조합 중의 Enter/Space 는 태그를 끊지 않는다.
 */
export function BoardTagPicker({
  copy,
  selected,
  suggestions,
  onAdd,
  onRemove,
}: {
  copy: FormCopy;
  selected: string[];
  suggestions: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const rest = suggestions.filter((t) => !selected.includes(t));

  function commit() {
    const t = input.trim().replace(/^#+/, "");
    if (t) onAdd(t);
    setInput("");
  }

  return (
    <section className="bdw-sec">
      <span className="bdw-sec__l">{copy.tagSection}</span>
      <div className="bdw-tags">
        {selected.map((t) => (
          <button
            aria-label={copy.tagRemoveAriaLabel.replace("{tag}", t)}
            className="bdw-tg is-on"
            key={t}
            onClick={() => onRemove(t)}
            type="button"
          >
            #{t}
            <X aria-hidden="true" strokeWidth={2.2} />
          </button>
        ))}
        {rest.map((t) => (
          <button
            className="bdw-tg"
            key={t}
            onClick={() => {
              haptic("light");
              onAdd(t);
            }}
            type="button"
          >
            #{t}
          </button>
        ))}
        {editing ? (
          <input
            aria-label={copy.tagPlaceholder}
            autoFocus
            className="bdw-tg__in"
            onBlur={() => {
              commit();
              setEditing(false);
            }}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !e.nativeEvent.isComposing && input.trim()) {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder={copy.tagPlaceholder}
            type="text"
            value={input}
          />
        ) : (
          <button className="bdw-tg is-ghost" onClick={() => setEditing(true)} type="button">
            {copy.tagNew}
          </button>
        )}
      </div>
    </section>
  );
}
