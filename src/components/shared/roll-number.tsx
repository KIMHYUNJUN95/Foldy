"use client";

// 공용 숫자 굴림(2026-10-14, 시안 Motion-Dash-* · Motion-B-Chart-PC) — 처음 그릴 때 자리마다 0에서 굴러 정확한 값에서 스프링으로 멈춘다.
// 값이 실시간으로 바뀌면(Beds24 · 새로 고침) 다시 굴리고, 옅은 보라 빛이 한 번 지나가며 `delta` 이면 「+1」 같은 차이를 잠깐 띄운다.
// 처음 굴림은 PC 진입 화면이 걷힐 때까지 미룬다(html --entry-d0, admin-entry). 화면 읽기 프로그램엔 값 그대로. 동작 줄이기면 바로 멈춘 값.
import { useState } from "react";
import "./roll-number.css";

function numeric(text: string): number | null {
  const digits = text.replace(/[^0-9.-]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function RollNumber({ text, delay = 0, delta = false }: { text: string; delay?: number; delta?: boolean }) {
  const [seen, setSeen] = useState(text);
  const [bump, setBump] = useState<{ n: number; diff: number | null }>({ n: 0, diff: null });
  if (seen !== text) {
    const a = numeric(seen);
    const b = numeric(text);
    setSeen(text);
    setBump((prev) => ({ n: prev.n + 1, diff: a !== null && b !== null ? b - a : null }));
  }

  let digitIndex = 0;
  const start = bump.n === 0 ? delay : 0;
  return (
    <span aria-label={text} className={`rolln${bump.n ? " is-bumped" : ""}`} key={bump.n} role="img">
      {text.split("").map((ch, i) => {
        if (!/[0-9]/.test(ch)) {
          return (
            <span aria-hidden="true" className={`rolln__sym${ch === "," || ch === "." ? " is-sep" : ""}`} key={i}>
              {ch}
            </span>
          );
        }
        const n = Number(ch);
        const idx = digitIndex++;
        return (
          <span aria-hidden="true" className="rolln__col" key={i}>
            <span
              className="rolln__strip"
              style={{ ["--to" as string]: `-${n + 10}`, animationDelay: bump.n === 0 ? `calc(var(--entry-d0, 0ms) + ${start + idx * 60}ms)` : `${idx * 60}ms`, animationDuration: `${900 + idx * 90}ms` }}
            >
              {Array.from({ length: 20 }, (_, k) => (
                <b key={k}>{k % 10}</b>
              ))}
            </span>
          </span>
        );
      })}
      {delta && bump.diff ? (
        <span aria-hidden="true" className={`rolln__delta${bump.diff < 0 ? " is-down" : ""}`}>
          {bump.diff > 0 ? `+${bump.diff}` : bump.diff}
        </span>
      ) : null}
    </span>
  );
}
