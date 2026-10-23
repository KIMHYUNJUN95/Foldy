"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n";
import { greetingPools, tokyoGreetingClock, type GreetingSurface, type GreetingWork } from "@/lib/greetings";
import "./greeting-line.css";

// 상황별 인사말 한 줄(2026-10-15) — 서버는 예전 고정 문구를 숨겨 자리만 잡고, 브라우저가 고른 문구를
// 단어마다 흐림 → 또렷하게 띄운다. 같은 세션(앱에 들어와 있는 동안)엔 같은 문구, 상황(출근 · 저녁)이
// 바뀌거나 앱에 다시 들어오면 새로 고른다. 직전 문구는 빼고. 문구 원본: src/lib/greetings.ts.
const LAST_SEEN = "foldy.lastSeen";
const AWAY_MS = 7 * 24 * 60 * 60 * 1000;
const picked = new Map<string, string>();

function read(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Storage | undefined, key: string, value: string) {
  try {
    store?.setItem(key, value);
  } catch {
    // 개인 정보 보호 모드 등 — 고르기만 매번 새로 한다.
  }
}

function pick(surface: GreetingSurface, locale: Locale, name: string, work: GreetingWork | undefined): string {
  const named = name.length > 0;
  const lastSeen = Number(read(window.localStorage, LAST_SEEN) ?? 0);
  const away = surface === "login" && lastSeen > 0 && Date.now() - lastSeen > AWAY_MS;
  const { baseKey, base, extras } = greetingPools(surface, locale, tokyoGreetingClock(), { work, away, named });
  const cacheKey = `${surface}|${locale}|${name}|${baseKey}`;
  const hit = picked.get(cacheKey);
  if (hit) return hit;

  const sessionKey = `foldy.greet.${surface}`;
  const saved = read(window.sessionStorage, sessionKey);
  let template: string | null = null;
  if (saved) {
    const [k, t] = saved.split("\u0001");
    if (k === `${locale}|${baseKey}`) template = t;
  }
  if (!template) {
    let pool = base;
    for (const e of extras) {
      if (e.pool.length && Math.random() < e.chance) {
        pool = e.pool;
        break;
      }
    }
    const lastKey = `foldy.greet.last.${surface}`;
    const last = read(window.localStorage, lastKey);
    const choices = pool.length > 1 ? pool.filter((t) => t !== last) : pool;
    template = choices[Math.floor(Math.random() * choices.length)] ?? base[0] ?? "";
    write(window.sessionStorage, sessionKey, `${locale}|${baseKey}\u0001${template}`);
    write(window.localStorage, lastKey, template);
  }
  const text = template.replaceAll("{name}", name);
  picked.set(cacheKey, text);
  return text;
}

const subscribe = () => () => {};

export function GreetingLine({
  surface,
  locale,
  name = "",
  work,
  fallback,
}: {
  surface: GreetingSurface;
  locale: Locale;
  name?: string;
  work?: GreetingWork;
  /** 서버에서 자리를 잡는 예전 고정 문구(보이지 않음). */
  fallback: string;
}) {
  const text = useSyncExternalStore(subscribe, () => pick(surface, locale, name.trim(), work), () => null);

  // 로그인 화면의 「오랜만이에요」 기준 — 홈 · 대시보드에 들어온 시각.
  useEffect(() => {
    if (surface !== "login") write(window.localStorage, LAST_SEEN, String(Date.now()));
  }, [surface]);

  if (!text) {
    return (
      <span className="gl" aria-hidden="true">
        {fallback}
      </span>
    );
  }
  // 띄어쓰기 단위로 나누고, 일본어처럼 띄어쓰기가 없는 문장은 「、」「。」 뒤에서도 나눈다 — 덩어리(inline-block)
  // 사이에서만 줄이 바뀌어 「金曜日です / ね、…」처럼 한 글자가 다음 줄로 떨어지지 않는다.
  const words = text
    .split(" ")
    .flatMap((w, i, all) => {
      const parts = w.split(/(?<=[、。！？])/);
      return parts.map((part, j) => ({ part, space: j === parts.length - 1 && i < all.length - 1 }));
    });
  return (
    <span className="gl is-ready">
      {words.map(({ part, space }, i) => (
        <span key={i}>
          <span className="gl__w" style={{ animationDelay: `${i * 45}ms` }}>
            {part}
          </span>
          {space ? " " : null}
        </span>
      ))}
    </span>
  );
}
