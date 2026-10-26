"use client";

// 사진 올리기 진행(2026-10-15, 시안 Motion-C-Upload-Phone · 사용자 결정 「제출할 때 올리기」).
// 「확인」을 누르면 확인 시트에서 사진마다 진행 고리 → 체크, 실패한 사진만 빨갛게 흔들리며 「다시」.
// 다시 누르면(빨간 사진이나 확인 버튼) **실패한 사진만** 다시 올린다 — 같은 요청 id 를 계속 쓰므로 이미 올라간 사진은 그대로 쓴다.
// 시트를 닫고 그만두면 올라간 사진을 지운다(저장소에 남는 사진 없음). 동작 줄이기면 고리가 돌지 않는다.
// 사진의 주인은 이 훅 하나다(2026-10-26): 서버 저장(수리 · 분실물 · 주문 등록)이 실패해도 서버는 사진을 지우지 않는다 —
// 다시 보내면 같은 요청 id · 같은 주소를 그대로 쓰기 때문이다(예전엔 서버가 지워서 다시 보낸 기록이 지워진 사진을 가리켰다).
// 지우는 건 사용자가 그만둘 때의 `abandon()` 뿐.
import { useCallback, useRef, useState } from "react";
import type { PreviewItem } from "@/components/announcements/announcement-image-uploader";
import {
  removeRequestImages,
  uploadRequestImageOne,
  type RequestImageType,
} from "@/components/requests/request-image-upload";
import "./photo-upload-progress.css";

export type PhotoState = "wait" | "up" | "done" | "error";

export function usePhotoUpload(organizationId: string, requestType: RequestImageType) {
  const requestIdRef = useRef<string | null>(null);
  const uploaded = useRef(new Map<string, { path: string; url: string }>());
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [states, setStates] = useState<Record<string, PhotoState>>({});
  const [running, setRunning] = useState(false);

  const requestId = useCallback(() => {
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    return requestIdRef.current;
  }, []);

  /** 올리기 — 다 올라가면 사진 순서대로 주소, 하나라도 실패하면 null(실패한 사진은 빨간 「다시」). */
  const run = useCallback(
    async (list: PreviewItem[]): Promise<string[] | null> => {
      const id = requestId();
      setItems(list);
      setRunning(true);
      setStates(Object.fromEntries(list.map((it) => [it.id, uploaded.current.has(it.id) ? "done" : "wait"])));
      const todo = list.filter((it) => !uploaded.current.has(it.id));
      let failed = false;
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const it = todo[next++];
          setStates((s) => ({ ...s, [it.id]: "up" }));
          try {
            const res = await uploadRequestImageOne({ item: it, organizationId, requestId: id, requestType });
            uploaded.current.set(it.id, res);
            setStates((s) => ({ ...s, [it.id]: "done" }));
          } catch {
            failed = true;
            setStates((s) => ({ ...s, [it.id]: "error" }));
          }
        }
      };
      await Promise.all([worker(), worker()]);
      setRunning(false);
      if (failed) return null;
      return list.map((it) => uploaded.current.get(it.id)!.url);
    },
    [organizationId, requestType, requestId],
  );

  /** 시트를 닫고 그만둠 — 올라간 사진을 지우고 처음 상태로. */
  const abandon = useCallback(() => {
    const paths = [...uploaded.current.values()].map((v) => v.path);
    uploaded.current.clear();
    requestIdRef.current = null;
    setItems([]);
    setStates({});
    void removeRequestImages(paths).catch(() => {});
  }, []);

  return { requestId, run, abandon, items, states, running };
}

export function PhotoUploadStrip({
  items,
  states,
  retryLabel,
  progressLabel,
  failedLabel,
  onRetry,
}: {
  items: PreviewItem[];
  states: Record<string, PhotoState>;
  retryLabel: string;
  /** `{done}` · `{total}` 자리 */
  progressLabel: string;
  /** `{n}` 자리 */
  failedLabel: string;
  onRetry: () => void;
}) {
  if (items.length === 0) return null;
  const done = items.filter((it) => states[it.id] === "done").length;
  const failed = items.filter((it) => states[it.id] === "error").length;
  const busy = items.some((it) => states[it.id] === "up" || states[it.id] === "wait");
  return (
    <div className="pup">
      <div className="pup__row">
        {items.map((it) => {
          const st = states[it.id] ?? "wait";
          return (
            <button
              key={it.id}
              type="button"
              className={`pup__t is-${st}`}
              onClick={st === "error" ? onRetry : undefined}
              disabled={st !== "error"}
              aria-label={st === "error" ? retryLabel : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 미리 보기(blob:) */}
              <img src={it.previewUrl} alt="" />
              <span className="pup__ov" aria-hidden="true" />
              <svg className="pup__ring" width="26" height="26" viewBox="0 0 30 30" fill="none" aria-hidden="true">
                <circle cx="15" cy="15" r="11" stroke="rgba(255,255,255,.3)" strokeWidth="2.6" />
                <circle className="pup__arc" cx="15" cy="15" r="11" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" pathLength={1} transform="rotate(-90 15 15)" />
              </svg>
              <span className="pup__bd" aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
                </svg>
              </span>
              <span className="pup__rt" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />
                </svg>
                {retryLabel}
              </span>
            </button>
          );
        })}
      </div>
      <p className={`pup__msg${failed && !busy ? " is-bad" : ""}`} role="status">
        {failed && !busy
          ? failedLabel.replace("{n}", String(failed))
          : progressLabel.replace("{done}", String(done)).replace("{total}", String(items.length))}
      </p>
    </div>
  );
}
