"use client";

/** 태그 거르기 — 글자 탭(상자 · 칩 없음). 고른 태그만 굵은 먹색. 「전체」 말고는 앞에 #. */
export function BoardTagFilter({
  tags,
  selected,
  allTag,
  ariaLabel,
  onSelect,
}: {
  tags: string[];
  selected: string;
  allTag: string;
  ariaLabel: string;
  onSelect: (tag: string) => void;
}) {
  return (
    <div aria-label={ariaLabel} className="bdw-tabs" role="tablist">
      {tags.map((tag) => {
        const isActive = tag === selected;
        return (
          <button
            aria-selected={isActive}
            className={`bdw-tab${isActive ? " is-on" : ""}`}
            key={tag}
            onClick={() => onSelect(tag)}
            role="tab"
            type="button"
          >
            {tag === allTag ? tag : `#${tag}`}
          </button>
        );
      })}
    </div>
  );
}
