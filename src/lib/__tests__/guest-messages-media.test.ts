import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  airbnbImageVariant,
  canonicalAirbnbImageUrl,
  messagePlainText,
  messageTextForTranslation,
  parseMessageBody,
} from "@/lib/guest-messages/message-body";
import {
  MEDIA_COPY_LIMITS,
  checkFetchedMedia,
  imageViewsFor,
  isAllowedMediaFetchUrl,
  isOrgMediaPath,
  mediaObjectPath,
  nextMediaState,
  planMediaCopy,
  providerAttachmentCount,
} from "@/lib/guest-messages/message-media";
import { bodyPieces } from "@/components/guest-messages/message-body-view";
import { copyPendingGuestMessageMedia, fetchMediaImage, signGuestMessageMedia } from "@/lib/guest-messages/media-copy-server";

const PATH = "/im/pictures-signed/messaging/Messaging-2726943899/original/fa4d40a1-77ea-4691-a3d6-0a76dbb92eeb.png";
const CANON = `https://a0.muscache.com${PATH}`;
const SIGNED = `${CANON}?X-Amz-Security-Token=FAKE%2Ftoken&amp;X-Amz-Expires=3600&amp;X-Amz-Signature=deadbeef&amp;im_w=1200`;
const anchor = (href: string, inner = href) => `<a href="${href}">${inner}</a>`;

describe("parseMessageBody", () => {
  it("운영 모양 — 앵커 안에 <img> (2026-11-13 운영 본문 그대로의 구조)", () => {
    const longSigned = `${CANON}?X-Amz-Security-Token=${"A".repeat(1500)}&X-Amz-Expires=3600&im_w=1200`;
    const body = `<a href="${longSigned}" target="_blank"><img src="${longSigned}" style="height:100px"></a>`;
    expect(parseMessageBody(body)).toEqual([{ type: "image", url: CANON, index: 0 }]);
    expect(planMediaCopy(body, [])).toEqual([{ sourceUrl: CANON, index: 0 }]);
    expect(messagePlainText(body)).not.toContain("<img");
    const mixed = `봐 주세요\n${body}\n${body.replace("fa4d40a1", "fb4d40a1")}`;
    expect(parseMessageBody(mixed).filter((s) => s.type === "image")).toHaveLength(2);
  });

  it("앵커 안 <img> 도 이상한 입력에서 빠르게 끝난다", () => {
    const evil = `<a href="x">${"<img a ".repeat(40000)}`;
    const started = performance.now();
    parseMessageBody(evil);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("Airbnb 사진 앵커 → 사진 조각(쿼리 버린 정본)", () => {
    expect(parseMessageBody(anchor(SIGNED))).toEqual([{ type: "image", url: CANON, index: 0 }]);
  });

  it("글 + 앵커 섞임 — 글은 그대로, 사진 앞 빈 줄 정리", () => {
    const segments = parseMessageBody(`Here is the broken lamp:\n${anchor(SIGNED)}\nThanks`);
    expect(segments).toEqual([
      { type: "text", text: "Here is the broken lamp:" },
      { type: "image", url: CANON, index: 0 },
      { type: "text", text: "Thanks" },
    ]);
  });

  it("사진 여러 장 — 순서대로 번호", () => {
    const second = SIGNED.replace("fa4d40a1", "bb11cc22");
    const segments = parseMessageBody(`${anchor(SIGNED)}${anchor(second)}`);
    expect(segments.map((s) => (s.type === "image" ? s.index : -1))).toEqual([0, 1]);
    expect(segments[1]).toMatchObject({ url: CANON.replace("fa4d40a1", "bb11cc22") });
  });

  it("/im/pictures/ 경로도 사진", () => {
    const href = "https://a0.muscache.com/im/pictures/abc/def.jpg?im_w=720";
    expect(parseMessageBody(anchor(href))).toEqual([{ type: "image", url: "https://a0.muscache.com/im/pictures/abc/def.jpg", index: 0 }]);
  });

  it("Booking 링크 → 링크 조각(안쪽 글)", () => {
    const body = `Please check in here: <a href="https://secure.booking.com/x?a=1&amp;b=2">Check-in guide</a>`;
    expect(parseMessageBody(body)).toEqual([
      { type: "text", text: "Please check in here: " },
      { type: "link", href: "https://secure.booking.com/x?a=1&b=2", label: "Check-in guide", host: "secure.booking.com", showHost: true },
    ]);
  });

  it("링크 뒤 줄바꿈은 남긴다(링크는 글 안)", () => {
    const segments = parseMessageBody(`guide: ${anchor("https://x.com/a", "here")}
next line`);
    expect(segments[2]).toEqual({ type: "text", text: "\nnext line" });
  });

  it("링크 안쪽이 주소면 호스트를 보인다", () => {
    const href = "https://example.com/path/very/long";
    expect(parseMessageBody(anchor(href))).toEqual([{ type: "link", href, label: "example.com", host: "example.com", showHost: false }]);
  });

  it("꺾쇠 글은 HTML 이 아니다 — 그대로", () => {
    for (const body of ["Welcome to <Baby Friendly House>!", "long text <truncated>", "mail me <someone@naver.com> please"]) {
      expect(parseMessageBody(body)).toEqual([{ type: "text", text: body }]);
    }
  });

  it("꺾쇠 글 + 앵커 함께 — 꺾쇠 글은 남는다", () => {
    const body = `<Baby Friendly House>\n${anchor("https://www.booking.com/hotel", "our page")}`;
    const segments = parseMessageBody(body);
    expect(segments[0]).toEqual({ type: "text", text: "<Baby Friendly House>\n" });
    expect(segments[1]).toMatchObject({ type: "link", label: "our page" });
  });

  it("&amp; 가 든 href 를 풀어 읽는다", () => {
    const [segment] = parseMessageBody(anchor("https://a0.muscache.com/im/pictures/x.jpg?a=1&amp;im_w=1200"));
    expect(segment).toEqual({ type: "image", url: "https://a0.muscache.com/im/pictures/x.jpg", index: 0 });
  });

  it("http(s) 아닌 href 는 글자 그대로", () => {
    for (const href of ["javascript:alert(1)", "mailto:a@b.c", "/relative"]) {
      const body = `see ${anchor(href, "x")}`;
      expect(parseMessageBody(body)).toEqual([{ type: "text", text: body }]);
    }
  });

  it("다른 호스트 · http 사진 주소는 사진이 아니라 링크", () => {
    expect(parseMessageBody(anchor("http://a0.muscache.com/im/pictures/x.jpg", "x"))[0].type).toBe("link");
    expect(parseMessageBody(anchor("https://a0.muscache.com.evil.com/im/pictures/x.jpg", "x"))[0].type).toBe("link");
    expect(parseMessageBody(anchor("https://a0.muscache.com/other/x.jpg", "x"))[0].type).toBe("link");
  });

  it("빈 본문 · null", () => {
    expect(parseMessageBody("")).toEqual([]);
    expect(parseMessageBody(null)).toEqual([]);
  });

  it("번역용 글 · 미리 보기 글", () => {
    const body = `Lamp broken\n${anchor(SIGNED)}\n${anchor("https://x.com/y", "guide")}`;
    expect(messageTextForTranslation(body)).toBe("Lamp broken\nguide");
    expect(messagePlainText(body)).toEqual({ text: "Lamp broken guide", imageCount: 1 });
    expect(messagePlainText(anchor(SIGNED))).toEqual({ text: "", imageCount: 1 });
    expect(messageTextForTranslation(anchor(SIGNED))).toBe("");
  });

  it("번역 글 — 링크 글은 문장 안에 그대로, 사진 자리만 줄바꿈", () => {
    const body = `Please read ${anchor("https://x.com/a", "the guide")} before arrival.${anchor(SIGNED)}Thanks`;
    expect(messageTextForTranslation(body)).toBe("Please read the guide before arrival.\nThanks");
    expect(messageTextForTranslation(anchor("https://x.com/a", "guide"))).toBe("guide");
  });

  it("피싱 — 글에 실제 호스트가 없으면 호스트를 같이", () => {
    const [bad] = parseMessageBody(anchor("https://evil.example/login", "booking.com 로그인"));
    expect(bad).toMatchObject({ type: "link", host: "evil.example", showHost: true });
    const [ok] = parseMessageBody(anchor("https://www.booking.com/x", "Booking.com help"));
    expect(ok).toMatchObject({ host: "www.booking.com", showHost: false });
  });

  it("이상한 본문도 빠르다(256KB < 50ms) · 앵커 안 태그는 글로", () => {
    const patterns = [
      '<a href="https://x.com/'.repeat(12_000),
      "<a ".repeat(90_000),
      `<a href="https://x.com/a">${"x".repeat(260_000)}`,
      '<a x="'.repeat(40_000) + "href=",
    ];
    for (const input of patterns) {
      const body = input.slice(0, 256 * 1024);
      const started = performance.now();
      parseMessageBody(body);
      messageTextForTranslation(body);
      expect(performance.now() - started, input.slice(0, 20)).toBeLessThan(50);
    }
    expect(parseMessageBody(`<a href="https://x.com/a"><b>x</b></a>`)).toEqual([{ type: "text", text: `<a href="https://x.com/a"><b>x</b></a>` }]);
  });

  it("canonical · variant", () => {
    expect(canonicalAirbnbImageUrl(SIGNED.replace(/&amp;/g, "&"))).toBe(CANON);
    expect(airbnbImageVariant(CANON, 240)).toBe(`${CANON}?im_w=240`);
    // 열리는 폭으로 올린다(720 · 1600 은 Airbnb 가 거절).
    expect(airbnbImageVariant(CANON, 720)).toBe(`${CANON}?im_w=960`);
    expect(airbnbImageVariant(CANON, 1600)).toBe(`${CANON}?im_w=1920`);
    expect(airbnbImageVariant(CANON, 99999)).toBe(`${CANON}?im_w=2560`);
  });
});

describe("bodyPieces (번역문 + 원문 사진)", () => {
  it("번역문이 있으면 글은 번역문, 사진은 원문의 것", () => {
    const pieces = bodyPieces(`Lamp broken\n${anchor(SIGNED)}`, "램프가 고장났어요");
    expect(pieces.map((p) => p.kind)).toEqual(["text", "photos"]);
    expect(pieces[0]).toMatchObject({ text: "램프가 고장났어요" });
  });
  it("번역문에서는 링크를 끝으로 옮겨 붙이지 않는다(링크 글은 번역문 안)", () => {
    const pieces = bodyPieces(`Read ${anchor("https://x.com/a", "the guide")} now`, "가이드를 지금 읽어 주세요");
    expect(pieces.map((p) => p.kind)).toEqual(["text"]);
  });
  it("호스트를 같이 보일 링크", () => {
    const pieces = bodyPieces(anchor("https://evil.example/a", "Booking help"), null);
    expect(pieces[0]).toMatchObject({ kind: "link", host: "evil.example" });
  });
  it("붙은 사진은 한 묶음", () => {
    const pieces = bodyPieces(`${anchor(SIGNED)}${anchor(SIGNED.replace("fa4d40a1", "cc"))}`, null);
    expect(pieces).toEqual([{ kind: "photos", key: "p0", indexes: [0, 1] }]);
  });
});

describe("SSRF 허용 목록", () => {
  it("a0.muscache.com 사진 경로 + im_w 만", () => {
    expect(isAllowedMediaFetchUrl(`${CANON}?im_w=1200`)).toBe(true);
    expect(isAllowedMediaFetchUrl(`${CANON}?im_w=1600`)).toBe(false);
    expect(isAllowedMediaFetchUrl(CANON)).toBe(true);
  });
  it("거절: http · 다른 호스트 · 포트 · 계정 · 다른 쿼리 · 다른 경로 · 이상한 주소", () => {
    for (const url of [
      `http://a0.muscache.com${PATH}?im_w=1200`,
      `https://a1.muscache.com${PATH}?im_w=1200`,
      `https://a0.muscache.com.evil.com${PATH}`,
      `https://evil.com/?u=https://a0.muscache.com${PATH}`,
      `https://a0.muscache.com:8443${PATH}`,
      `https://user:pw@a0.muscache.com${PATH}`,
      `${CANON}?X-Amz-Signature=abc`,
      `${CANON}?im_w=1&x=2`,
      "https://a0.muscache.com/admin",
      "https://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(isAllowedMediaFetchUrl(url), url).toBe(false);
    }
  });
});

describe("사본 판단", () => {
  const stored = {
    kind: "image_copy",
    source: "airbnb",
    sourceUrl: CANON,
    path: "o/c/m/0.jpg",
    index: 0,
    mime: "image/jpeg",
    bytes: 10,
    width: 1600,
    copiedAt: "2026-11-13T00:00:00Z",
  };
  const second = SIGNED.replace("fa4d40a1", "bb11cc22");

  it("사본 없는 사진만 고른다 · 같은 사진 두 번은 하나", () => {
    expect(planMediaCopy(`${anchor(SIGNED)}${anchor(second)}`, [])).toEqual([
      { sourceUrl: CANON, index: 0 },
      { sourceUrl: CANON.replace("fa4d40a1", "bb11cc22"), index: 1 },
    ]);
    expect(planMediaCopy(`${anchor(SIGNED)}${anchor(second)}`, [stored])).toEqual([
      { sourceUrl: CANON.replace("fa4d40a1", "bb11cc22"), index: 1 },
    ]);
    expect(planMediaCopy(`${anchor(SIGNED)}${anchor(SIGNED)}`, [])).toHaveLength(1);
    expect(planMediaCopy("no photo <truncated>", [])).toEqual([]);
  });

  it("통로 첨부 수는 사본 줄을 빼고 센다 — 두 모양을 섞어 세지 않는다", () => {
    expect(providerAttachmentCount([stored, { name: "a.jpg", mimeType: null, url: null, inline: true }])).toBe(1);
    expect(providerAttachmentCount([stored, { ...stored, index: 1 }])).toBe(0);
    expect(providerAttachmentCount([])).toBe(0);
    expect(providerAttachmentCount(null)).toBe(0);
    // 통로 첨부 줄은 사본으로 읽히지 않는다(planMediaCopy 가 사본이 있다고 착각하지 않게).
    expect(planMediaCopy(anchor(SIGNED), [{ name: "a.jpg", mimeType: "image/jpeg", url: CANON, inline: false }])).toHaveLength(1);
  });

  it("상태: 다 됨 → done / 실패 → 미룸 → 5번이면 failed / 일부 성공 → 10분 / 시간 한도 → 바로", () => {
    const now = new Date("2026-11-13T00:00:00Z");
    expect(nextMediaState({ attempts: 0, remaining: 0, copiedThisRun: 2, failedThisRun: 0, now })).toEqual({ state: "done", attempts: 0, nextTryAt: null });
    expect(nextMediaState({ attempts: 0, remaining: 1, copiedThisRun: 0, failedThisRun: 1, now })).toEqual({
      state: "pending",
      attempts: 1,
      nextTryAt: "2026-11-13T00:10:00.000Z",
    });
    expect(nextMediaState({ attempts: 1, remaining: 1, copiedThisRun: 0, failedThisRun: 1, now }).nextTryAt).toBe("2026-11-13T01:00:00.000Z");
    expect(nextMediaState({ attempts: MEDIA_COPY_LIMITS.maxAttempts - 1, remaining: 1, copiedThisRun: 0, failedThisRun: 1, now })).toEqual({
      state: "failed",
      attempts: MEDIA_COPY_LIMITS.maxAttempts,
      nextTryAt: null,
    });
    expect(nextMediaState({ attempts: 2, remaining: 1, copiedThisRun: 1, failedThisRun: 1, now })).toMatchObject({ state: "pending", attempts: 2 });
    expect(nextMediaState({ attempts: 2, remaining: 3, copiedThisRun: 0, failedThisRun: 0, now })).toEqual({ state: "pending", attempts: 2, nextTryAt: null });
  });

  it("받은 응답 검사", () => {
    expect(checkFetchedMedia({ status: 200, contentType: "image/jpeg", contentLength: 100 })).toEqual({ ok: true, mime: "image/jpeg" });
    expect(checkFetchedMedia({ status: 404, contentType: "text/html", contentLength: null })).toEqual({ ok: false, reason: "http_404" });
    expect(checkFetchedMedia({ status: 200, contentType: "text/html", contentLength: null })).toEqual({ ok: false, reason: "not_image" });
    expect(checkFetchedMedia({ status: 200, contentType: "image/svg+xml", contentLength: null })).toEqual({ ok: false, reason: "not_image" });
    expect(checkFetchedMedia({ status: 200, contentType: "image/png", contentLength: MEDIA_COPY_LIMITS.maxBytes + 1 })).toEqual({ ok: false, reason: "too_large" });
  });

  it("경로 — uuid 만 · 조직 폴더만 서명", () => {
    const org = "aaaaaaaa-0000-4000-8000-0000000000a1";
    const conv = "bbbbbbbb-0000-4000-8000-0000000000b1";
    const msg = "cccccccc-0000-4000-8000-0000000000c1";
    const path = mediaObjectPath({ organizationId: org, conversationId: conv, messageId: msg, index: 0, ext: "jpg" });
    expect(path).toBe(`${org}/${conv}/${msg}/0.jpg`);
    expect(() => mediaObjectPath({ organizationId: "../x", conversationId: conv, messageId: msg, index: 0, ext: "jpg" })).toThrow();
    expect(isOrgMediaPath(path, org)).toBe(true);
    expect(isOrgMediaPath(path, "dddddddd-0000-4000-8000-0000000000d1")).toBe(false);
    expect(isOrgMediaPath(`${org}/../x/y`, org)).toBe(false);
  });

  it("화면 주소 — 사본 먼저, 없으면 Airbnb im_w", () => {
    const body = `${anchor(SIGNED)}${anchor(second)}`;
    const views = imageViewsFor(body, { [CANON]: { full: "https://storage.local/full?token=x", thumb: "https://storage.local/t?token=x" } });
    expect(views[0]).toMatchObject({ stored: true, thumb: "https://storage.local/t?token=x", full: "https://storage.local/full?token=x", fallback: `${CANON}?im_w=1200` });
    expect(imageViewsFor(anchor(SIGNED), { [CANON]: { full: "F", thumb: null } })[0]).toMatchObject({ thumb: "F", full: "F" });
    expect(views[1]).toMatchObject({ stored: false, thumb: `${CANON.replace("fa4d40a1", "bb11cc22")}?im_w=480` });
  });
});

// ── 받아 오기 · 복사 (가짜 fetch · 가짜 DB) ────────────────────────────────────────
const ORG = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CONV = "bbbbbbbb-0000-4000-8000-0000000000b1";
const MSG = "cccccccc-0000-4000-8000-0000000000c1";

function imageResponse(bytes = 8, type = "image/jpeg") {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type, "content-length": String(bytes) } });
}

describe("fetchMediaImage", () => {
  it("허용 주소만 · redirect 거절 옵션 · 이미지면 바이트", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return imageResponse(5);
    };
    const result = await fetchMediaImage(CANON, fetchImpl);
    expect(result).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(calls[0][0]).toBe(`${CANON}?im_w=1200`);
    expect(calls[0][1]?.redirect).toBe("error");
    expect((calls[0][1]?.headers as Record<string, string>).accept).toBe("image/webp,image/jpeg,image/png");
  });
  it("허용 밖 정본은 부르지도 않는다", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchMediaImage("https://evil.com/im/pictures/x.jpg", fetchImpl)).toEqual({ ok: false, reason: "not_allowed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("크기 머리가 없어도 10MB 넘으면 버린다", async () => {
    const big = new Response(new Uint8Array(MEDIA_COPY_LIMITS.maxBytes + 10), { status: 200, headers: { "content-type": "image/png" } });
    expect(await fetchMediaImage(CANON, async () => big)).toEqual({ ok: false, reason: "too_large" });
  });
  it("네트워크 오류 → network", async () => {
    expect(await fetchMediaImage(CANON, async () => Promise.reject(new TypeError("fetch failed")))).toEqual({ ok: false, reason: "network" });
  });
});

type Row = {
  id: string;
  conversation_id: string;
  body: string;
  attachments: unknown;
  media_attempts: number;
  media_state: string | null;
  media_claim_id?: string | null;
  media_next_try_at?: string | null;
};

/** 가짜 DB — select · update 의 eq / in 거르기만 흉내(or 시도 시각 조건은 테스트 줄이 늘 만족). */
function fakeDb(rows: Row[], options: { uploadError?: boolean; beforeUpdate?: (patch: Record<string, unknown>) => void } = {}) {
  const uploads: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      const filters: Record<string, unknown> = {};
      let ids: string[] | null = null;
      let patch: Record<string, unknown> | null = null;
      const builder = {
        select: () => builder,
        update: (value: Record<string, unknown>) => {
          patch = value;
          return builder;
        },
        eq: (col: string, value: unknown) => {
          filters[col] = value;
          return builder;
        },
        in: (_col: string, values: string[]) => {
          ids = values;
          return builder;
        },
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        then(resolve: (value: unknown) => void) {
          if (patch) options.beforeUpdate?.(patch);
          const hit = rows.filter(
            (row) =>
              (ids === null || ids.includes(row.id)) &&
              Object.entries(filters).every(([col, value]) => col === "organization_id" || (row as Record<string, unknown>)[col] === value),
          );
          if (patch) {
            for (const row of hit) Object.assign(row, patch);
            updates.push(patch);
            resolve({ data: hit.map((row) => ({ ...row })), error: null });
          } else {
            resolve({ data: hit.map((row) => ({ ...row })), error: null });
          }
        },
      };
      return builder;
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (options.uploadError) return { data: null, error: { message: "bucket missing" } };
          uploads.push(path);
          return { data: { path }, error: null };
        },
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://store.local/${path}?token=t`, error: null })),
          error: null,
        }),
      }),
    },
  };
  return { client: client as never, uploads, updates };
}

describe("copyPendingGuestMessageMedia", () => {
  it("사진을 올리고 attachments 에 사본 줄 · done", async () => {
    const rows: Row[] = [{ id: MSG, conversation_id: CONV, body: `hi ${anchor(SIGNED)}`, attachments: [], media_attempts: 0, media_state: "pending" }];
    const db = fakeDb(rows);
    const summary = await copyPendingGuestMessageMedia(db.client, ORG, { fetchImpl: async () => imageResponse(12) });
    expect(summary).toMatchObject({ checked: 1, copied: 1, failed: 0, done: 1 });
    expect(db.uploads).toEqual([`${ORG}/${CONV}/${MSG}/0.jpg`, `${ORG}/${CONV}/${MSG}/0-t.jpg`]);
    expect(rows[0]).toMatchObject({ media_state: "done", media_claim_id: null });
    expect(rows[0].attachments).toEqual([
      expect.objectContaining({ kind: "image_copy", sourceUrl: CANON, bytes: 12, mime: "image/jpeg", thumbPath: `${ORG}/${CONV}/${MSG}/0-t.jpg` }),
    ]);
  });

  it("작은 사진 실패는 사본 실패가 아니다(thumbPath 없음)", async () => {
    const rows: Row[] = [{ id: MSG, conversation_id: CONV, body: anchor(SIGNED), attachments: [], media_attempts: 0, media_state: "pending" }];
    const db = fakeDb(rows);
    const fetchImpl = async (url: string) => (url.endsWith("im_w=480") ? new Response("x", { status: 404 }) : imageResponse());
    await copyPendingGuestMessageMedia(db.client, ORG, { fetchImpl });
    expect(rows[0].media_state).toBe("done");
    expect(rows[0].attachments).toEqual([expect.objectContaining({ thumbPath: null })]);
  });

  it("잡기 — 다른 실행이 잡은 줄은 저장하지 않는다(사본 줄을 덮지 않음)", async () => {
    const rows: Row[] = [{ id: MSG, conversation_id: CONV, body: anchor(SIGNED), attachments: [], media_attempts: 0, media_state: "pending" }];
    let stolen = false;
    const db = fakeDb(rows, {
      beforeUpdate: (patch) => {
        // 내 실행이 받아 오는 사이 잡은 시간이 지나 다른 실행이 다시 잡았다.
        if (patch.media_state && !stolen) {
          stolen = true;
          rows[0].media_claim_id = "other-run";
        }
      },
    });
    const summary = await copyPendingGuestMessageMedia(db.client, ORG, { fetchImpl: async () => imageResponse(), claimId: () => "my-run" });
    expect(summary.done).toBe(0);
    expect(rows[0]).toMatchObject({ media_state: "pending", media_claim_id: "other-run", attachments: [] });
  });

  it("messageIds 를 주면 그 줄들만(웹훅 — 밀린 것은 안 건드림)", async () => {
    const other = "dddddddd-0000-4000-8000-0000000000d1";
    const rows: Row[] = [
      { id: MSG, conversation_id: CONV, body: anchor(SIGNED), attachments: [], media_attempts: 0, media_state: "pending" },
      { id: other, conversation_id: CONV, body: anchor(SIGNED), attachments: [], media_attempts: 0, media_state: "pending" },
    ];
    const db = fakeDb(rows);
    await copyPendingGuestMessageMedia(db.client, ORG, { messageIds: [MSG], fetchImpl: async () => imageResponse() });
    expect(rows[0].media_state).toBe("done");
    expect(rows[1].media_state).toBe("pending");
    expect(rows[1].media_claim_id).toBeUndefined();
    const fetchImpl = vi.fn();
    await copyPendingGuestMessageMedia(db.client, ORG, { messageIds: [], fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("받아 오기 실패 → 미룸(던지지 않음 · 주소를 로그에 남기지 않음)", async () => {
    const rows: Row[] = [{ id: MSG, conversation_id: CONV, body: anchor(SIGNED), attachments: [], media_attempts: 0, media_state: "pending" }];
    const db = fakeDb(rows);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const summary = await copyPendingGuestMessageMedia(db.client, ORG, { fetchImpl: async () => new Response("no", { status: 404 }) });
    expect(summary).toMatchObject({ copied: 0, failed: 1, done: 0 });
    expect(rows[0]).toMatchObject({ media_state: "pending", media_attempts: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("muscache");
    warn.mockRestore();
  });

  it("올리기 실패도 미룸", async () => {
    const rows: Row[] = [{ id: MSG, conversation_id: CONV, body: anchor(SIGNED), attachments: [], media_attempts: 4, media_state: "pending" }];
    const db = fakeDb(rows, { uploadError: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await copyPendingGuestMessageMedia(db.client, ORG, { fetchImpl: async () => imageResponse() });
    expect(rows[0]).toMatchObject({ media_state: "failed", media_attempts: 5 });
    warn.mockRestore();
  });

  it("앵커가 아닌 주소 글(트리거만 걸림)은 복사 없이 done", async () => {
    const rows: Row[] = [
      { id: MSG, conversation_id: CONV, body: "see a0.muscache.com/im/pictures/x.jpg", attachments: [], media_attempts: 0, media_state: "pending" },
    ];
    const db = fakeDb(rows);
    const fetchImpl = vi.fn();
    await copyPendingGuestMessageMedia(db.client, ORG, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rows[0].media_state).toBe("done");
  });

  it("DB 가 던져도 던지지 않는다", async () => {
    const broken = { from: () => { throw new Error("boom"); } } as never;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(copyPendingGuestMessageMedia(broken, ORG)).resolves.toMatchObject({ checked: 0 });
    error.mockRestore();
  });
});

describe("signGuestMessageMedia", () => {
  it("이 조직 경로만 한 번에 서명", async () => {
    const db = fakeDb([]);
    const good = { kind: "image_copy", source: "airbnb", sourceUrl: CANON, path: `${ORG}/${CONV}/${MSG}/0.jpg`, thumbPath: `${ORG}/${CONV}/${MSG}/0-t.jpg`, index: 0, mime: "image/jpeg", bytes: 1, width: 1200, copiedAt: "x" };
    const other = { ...good, sourceUrl: `${CANON}2`, path: `dddddddd-0000-4000-8000-0000000000d1/${CONV}/${MSG}/1.jpg` };
    const out = await signGuestMessageMedia(db.client, ORG, [{ id: MSG, attachments: [good, other] }]);
    expect(out.get(MSG)).toEqual({ [CANON]: { full: `https://store.local/${good.path}?token=t`, thumb: `https://store.local/${good.thumbPath}?token=t` } });
  });
  it("사본 없으면 저장소를 부르지 않는다", async () => {
    const out = await signGuestMessageMedia({ storage: undefined } as never, ORG, [{ id: MSG, attachments: [] }]);
    expect(out.size).toBe(0);
  });
});
