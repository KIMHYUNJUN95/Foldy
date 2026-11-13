/**
 * 손님 메시지 본문 → 조각(글 · 사진 · 링크). docs/product/47-guest-messaging.md §5-8 「사진 · 링크 보이기」.
 *
 * Beds24 는 Airbnb 사진을 `<a href="https://a0.muscache.com/im/pictures-signed/…?X-Amz-…">…</a>` 그대로 본문에 싣는다
 * (서명 주소는 1시간 뒤 죽는다). Booking.com 답장에는 보통 링크 `<a href="…">글</a>` 이 있다.
 * 그런데 본문에는 HTML 이 아닌 꺾쇠 글도 많다 — `<Baby Friendly House>` · `<truncated>` · `<someone@naver.com>`.
 * 그래서 **진짜 `<a href="http(s)://…">…</a>` 만** 조각으로 바꾸고 나머지는 글자 그대로 둔다(꺾쇠를 지우지 않는다).
 * 화면은 이 조각을 React 요소로 그린다(dangerouslySetInnerHTML 없음).
 *
 * **순수 모듈** — 서버 · 화면 · 시험 어디서나.
 */

export type MessageSegment =
  | { type: "text"; text: string }
  | {
      type: "image";
      /** 정본 주소 = origin + path(쿼리 전부 버림 — 서명은 1시간 뒤 죽는다). 사본 찾기 · 저장 경로의 열쇠. */
      url: string;
      /** 이 메시지 안에서 몇 번째 사진인가(0부터) — 저장 경로 `<…>/<index>.<ext>`. */
      index: number;
    }
  | {
      type: "link";
      href: string;
      label: string;
      /** 링크가 실제로 가는 호스트 — 글과 다르면 화면이 옆에 같이 보인다(피싱 막기). */
      host: string;
      /** 글(label)만 보고는 가는 곳을 알 수 없다 — 호스트를 같이 보여야 한다. */
      showHost: boolean;
    };

/** 사진으로 읽는 Airbnb 사진 호스트 — 받아 오기(SSRF 막기)도 이 호스트 하나만. */
export const AIRBNB_IMAGE_HOST = "a0.muscache.com";
const AIRBNB_IMAGE_PATHS = ["/im/pictures-signed/", "/im/pictures/"] as const;

// `<a … href="…" …>안</a>` — 따옴표 있는 href 만, 안쪽은 태그 없는 글만. 모든 반복에 상한을 둬
// 이상한 본문(닫히지 않은 `<a` 수만 개 등)에서도 시작점마다 다음 `<` · `>` 까지만 본다(선형에 가깝게 — 시험 256KB < 50ms).
const ANCHOR_RE = /<a\s[^<>]{0,2000}?\bhref\s*=\s*(["'])([^"'<>]{0,4096})\1[^<>]{0,2000}>([^<]{0,2048})<\/a\s*>/gi;
/** 이보다 긴 본문은 앞부분만 앵커를 찾고 나머지는 글 그대로(메시지는 보통 몇 KB). */
const MAX_PARSE_CHARS = 100_000;
const TAG_RE = /<[^<>]*>/g;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

/** href · 링크 글에 나오는 몇 가지 HTML 엔티티만 푼다(본문 글자에는 쓰지 않는다 — 그대로 보인다). */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower in NAMED_ENTITIES) return NAMED_ENTITIES[lower];
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Airbnb 사진 주소면 정본(origin + path), 아니면 null. https 만. */
export function canonicalAirbnbImageUrl(raw: string): string | null {
  const url = parseHttpUrl(raw);
  if (!url || url.protocol !== "https:" || url.hostname !== AIRBNB_IMAGE_HOST || url.port) return null;
  if (!AIRBNB_IMAGE_PATHS.some((prefix) => url.pathname.startsWith(prefix))) return null;
  if (url.pathname.includes("..")) return null;
  return `https://${AIRBNB_IMAGE_HOST}${url.pathname}`;
}

/**
 * 정본 → 크기 지정 주소(`?im_w=N`). 서명 없이 `im_w` 만 붙이면 지금은 열린다(2026-11-13 확인 — 문서에 없는 동작이라
 * 언제 막힐지 모른다 → 사본을 Foldy 저장소에 남긴다, §5-8).
 */
export function airbnbImageVariant(canonical: string, width: number): string {
  // Airbnb 는 정해진 폭만 준다(그 밖은 403 · 404 — 2026-11-13 실측: 720 · 1600 · 1024 거절). 요청보다 크거나 같은 첫 폭.
  const w = AIRBNB_IM_WIDTHS.find((candidate) => candidate >= width) ?? AIRBNB_IM_WIDTHS[AIRBNB_IM_WIDTHS.length - 1];
  return `${canonical}?im_w=${w}`;
}

/** 서명 없이 열리는 `im_w` 값(2026-11-13 실측). */
export const AIRBNB_IM_WIDTHS = [240, 320, 480, 960, 1200, 1440, 1920, 2560] as const;

function linkLabel(inner: string, url: URL): string {
  const text = decodeHtmlEntities(inner.replace(TAG_RE, "")).replace(/\s+/g, " ").trim();
  if (!text || /^https?:\/\//i.test(text) || text.length > 200) return url.hostname;
  return text;
}

/** 글에 실제 호스트(www. 뺀 것)가 들어 있지 않으면 호스트를 같이 보여야 한다. */
function needsHost(label: string, host: string): boolean {
  const bare = host.replace(/^www\./i, "").toLowerCase();
  return !label.toLowerCase().includes(bare);
}

/**
 * 본문 → 조각. 진짜 앵커만 바꾸고 나머지는 글자 그대로(꺾쇠 글도). 글 조각은 사진 · 링크와 맞닿은 앞뒤 빈 줄만 정리하고,
 * 공백만 남은 글 조각은 버린다.
 */
export function parseMessageBody(body: string | null | undefined): MessageSegment[] {
  const source = typeof body === "string" ? body : "";
  if (!source) return [];
  const out: MessageSegment[] = [];
  let cursor = 0;
  let imageIndex = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.text += text;
    else out.push({ type: "text", text });
  };
  const scan = source.length > MAX_PARSE_CHARS ? source.slice(0, MAX_PARSE_CHARS) : source;
  if (/<a\s/i.test(scan)) {
    ANCHOR_RE.lastIndex = 0;
    for (let match = ANCHOR_RE.exec(scan); match; match = ANCHOR_RE.exec(scan)) {
      const [whole, , rawHref, inner] = match;
      const href = decodeHtmlEntities(rawHref.trim());
      const url = parseHttpUrl(href);
      if (!url) continue; // http(s) 아님(mailto · javascript 등) — 글자 그대로 남긴다.
      pushText(source.slice(cursor, match.index));
      const canonical = canonicalAirbnbImageUrl(href);
      if (canonical) out.push({ type: "image", url: canonical, index: imageIndex++ });
      else {
        const label = linkLabel(inner, url);
        out.push({ type: "link", href: url.toString(), label, host: url.hostname, showHost: needsHost(label, url.hostname) });
      }
      cursor = match.index + whole.length;
    }
  }
  pushText(source.slice(cursor));

  // 사진 · 링크와 맞닿은 줄바꿈 정리 · 빈 글 조각 버리기(글 안쪽 줄바꿈 · 꺾쇠는 그대로).
  // 사진은 덩어리(블록)라 맞닿은 글의 앞뒤 공백 · 줄바꿈만 정리한다. 링크는 글 안(인라인)이라 그대로.
  if (!out.some((segment) => segment.type === "image")) return out;
  const cleaned: MessageSegment[] = [];
  out.forEach((segment, i) => {
    if (segment.type !== "text") {
      cleaned.push(segment);
      return;
    }
    let text = segment.text;
    if (out[i - 1]?.type === "image") text = text.replace(/^\s+/, "");
    if (out[i + 1]?.type === "image") text = text.replace(/\s+$/, "");
    if (text.trim()) cleaned.push({ type: "text", text });
  });
  return cleaned;
}

export function messageImages(body: string | null | undefined): Array<Extract<MessageSegment, { type: "image" }>> {
  return parseMessageBody(body).filter((segment): segment is Extract<MessageSegment, { type: "image" }> => segment.type === "image");
}

/** 본문에 Airbnb 사진 앵커가 있을 수 있나(빠른 거르기 — DB 트리거의 like 와 같은 조건). */
export function mayContainAirbnbImage(body: string | null | undefined): boolean {
  return typeof body === "string" && body.includes(`${AIRBNB_IMAGE_HOST}/im/pictures`);
}

/**
 * 번역에 보낼 글 — 글 + 링크 글(사진 · 링크 주소는 빼고). 없으면 빈 글.
 */
export function messageTextForTranslation(body: string | null | undefined): string {
  // 링크 글은 문장 안에 그대로(문장을 끊지 않게), 사진 자리만 줄바꿈. 주소는 보내지 않는다.
  let out = "";
  for (const segment of parseMessageBody(body)) {
    if (segment.type === "image") out += "\n";
    else if (segment.type === "link") out += segment.label;
    else out += segment.text;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 글로만 보여 줄 자리(목록 미리 보기 · 고른 말 · 업무 미리 채움) — 글 조각 + 링크 글. 사진은 세기만.
 * 사진만 있는 말이면 `text` 가 빈 글이고 `imageCount > 0` — 화면이 「사진」 글자를 쓴다.
 */
export function messagePlainText(body: string | null | undefined): { text: string; imageCount: number } {
  let imageCount = 0;
  let text = "";
  for (const segment of parseMessageBody(body)) {
    if (segment.type === "image") {
      imageCount += 1;
      text += " ";
    } else if (segment.type === "link") text += segment.label;
    else text += segment.text;
  }
  return { text: text.trim(), imageCount };
}
