"use client";

/**
 * 관리자 Todoist 콘솔용 데스크톱 사진 첨부/미리보기 컨트롤.
 * 호출처는 세 곳: 인라인 할 일 추가 행 (compact), 상세 패널의 할 일 사진
 * (full), 상세 패널의 메모 작성기 (compact). 선택/미리보기/제거만 담당하고
 * 실제 업로드는 `uploadPendingTaskPhotos` /
 * `uploadPendingTaskUpdatePhotos` 로 호출자에게 맡겨, 어느 호출처도 업로드 루프를 중복하지 않는다.
 *
 * 새로 만들지 않고 기존 업로드 규약을 재사용한다:
 * - 공지 업로더의 `compressImageFile` / `PreviewItem` (클라이언트 압축
 *   정책 — CLAUDE.md §8).
 * - 공용 요청 이미지 업로드 헬퍼의 `uploadRequestImages`.
 */

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import {
  compressImageFile,
  type PreviewItem,
} from "@/components/announcements/announcement-image-uploader";
import { uploadRequestImages } from "@/components/requests/request-image-upload";

// 공지 업로더가 이미 적용하는 크기 상한과 같다 — 같은 값으로 맞춰 두어
// 거기서 거부될 파일은 여기서도 거부된다.
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/gif", "image/jpeg", "image/png", "image/webp"];

export type PhotoUploaderCopy = {
  /** 드롭존 라벨, 기본(non-compact) 변형. 예: "사진 추가" */
  add: string;
  /** 드롭존 라벨, compact 변형 (인라인 추가 행 / 메모 작성기). 예: "사진" */
  addCompact: string;
  /** 라벨 아래 보조 문구, 기본 변형에서만. 예: "클릭하거나 파일을 끌어다 놓으세요" */
  dropHint: string;
  /** 개수 배지. 자리표시자: {n} 현재 개수, {max} 상한. 예: "{n}/{max}" */
  count: string;
  /** 각 썸네일의 제거 버튼 aria-label. 예: "사진 삭제" */
  remove: string;
  /** 선택이 상한을 넘을 때 표시. 자리표시자: {max}. 예: "최대 {max}장까지 첨부할 수 있어요" */
  tooMany: string;
  /** Shown for a non-image file. e.g. "이미지 파일만 첨부할 수 있어요" */
  invalidType: string;
  /** 파일이 너무 클 때 표시. 자리표시자: {max} (MB). 예: "파일 용량은 {max}MB 이하만 가능해요" */
  tooLarge: string;
  /** `uploading` 이 true 인 동안 추가 라벨 대신 표시. 예: "업로드 중…" */
  uploading: string;
};

function fillCopy(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [key, val]) => acc.replaceAll(`{${key}}`, String(val)),
    template,
  );
}

type Props = {
  /** 이미 업로드된 공개 URL (기존 사진, 예: 편집할 때). */
  value: string[];
  /** 로컬에서 선택했지만 아직 업로드되지 않은 것. */
  pending: PreviewItem[];
  onChange: (next: { value: string[]; pending: PreviewItem[] }) => void;
  /** 상한: 호출자가 5 또는 20 을 넘긴다 — 프로젝트 할 일은 20, 나머지는 5 (CLAUDE.md §8). */
  maxImages: number;
  copy: PhotoUploaderCopy;
  disabled?: boolean;
  /** 인라인 추가 행과 메모 작성기용 작은 변형. */
  compact?: boolean;
  /** 호출자가 업로드 중일 때 true (예: 제출 transition 안) — 컨트롤을 잠근다. */
  uploading?: boolean;
};

export function TaskPhotoUploader({
  value,
  pending,
  onChange,
  maxImages,
  copy,
  disabled = false,
  compact = false,
  uploading = false,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isBusy = disabled || uploading;
  const total = value.length + pending.length;
  const atCap = total >= maxImages;

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || isBusy) return;

      const invalidType = files.find((f) => !ALLOWED_TYPES.includes(f.type));
      if (invalidType) {
        setError(copy.invalidType);
        return;
      }
      const tooBig = files.find((f) => f.size > MAX_BYTES);
      if (tooBig) {
        setError(fillCopy(copy.tooLarge, { max: Math.round(MAX_BYTES / (1024 * 1024)) }));
        return;
      }
      if (total + files.length > maxImages) {
        setError(fillCopy(copy.tooMany, { max: maxImages }));
        return;
      }

      setError(null);
      const items: PreviewItem[] = await Promise.all(
        files.map(async (file) => {
          const compressed = await compressImageFile(file);
          return {
            id: `${Date.now()}-${Math.random()}`,
            file: compressed,
            previewUrl: URL.createObjectURL(compressed),
          };
        }),
      );
      onChange({ value, pending: [...pending, ...items] });
    },
    [copy, isBusy, maxImages, onChange, pending, total, value],
  );

  const handlePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      // 제거 후에도 같은 파일을 다시 선택할 수 있게 초기화
      e.target.value = "";
      void addFiles(files);
    },
    [addFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (isBusy) return;
      void addFiles(Array.from(e.dataTransfer.files ?? []));
    },
    [addFiles, isBusy],
  );

  const removeExisting = useCallback(
    (url: string) => {
      onChange({ value: value.filter((v) => v !== url), pending });
      setError(null);
    },
    [onChange, pending, value],
  );

  const removePending = useCallback(
    (id: string) => {
      const item = pending.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      onChange({ value, pending: pending.filter((p) => p.id !== id) });
      setError(null);
    },
    [onChange, pending, value],
  );

  // 언마운트 시 아직 대기 중인 object URL 을 해제해 미리보기 blob 이 새지 않게 한다.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });
  useEffect(() => {
    return () => {
      for (const item of pendingRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const dropDisabled = isBusy || atCap;

  return (
    <div className={`tphoto${compact ? " tphoto--compact" : ""}`}>
      <div
        aria-disabled={dropDisabled}
        aria-label={compact ? copy.addCompact : copy.add}
        className={`tphoto__drop${dragOver ? " is-drag" : ""}${dropDisabled ? " is-disabled" : ""}`}
        onClick={() => !dropDisabled && inputRef.current?.click()}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dropDisabled) setDragOver(true);
        }}
        onDrop={handleDrop}
        onKeyDown={(e) => {
          if (dropDisabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={dropDisabled ? -1 : 0}
      >
        {uploading ? (
          <Loader2 aria-hidden="true" className="tphoto__spin" size={compact ? 14 : 16} />
        ) : (
          <ImagePlus aria-hidden="true" size={compact ? 14 : 16} />
        )}
        <span className="tphoto__addlabel">
          {uploading ? copy.uploading : compact ? copy.addCompact : copy.add}
        </span>
        {!compact && !uploading && <span className="tphoto__hint">{copy.dropHint}</span>}
        {/* compact 는 날짜/우선순위/대상 옆의 칩으로 렌더된다 — 빈 칩에 "0/5" 접미사는
            잡음이므로, 무언가 첨부된 뒤에만 개수를 보여준다. */}
        {(!compact || total > 0) && (
          <span className="tphoto__count">{fillCopy(copy.count, { n: total, max: maxImages })}</span>
        )}
      </div>

      <input
        accept="image/gif,image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={dropDisabled}
        multiple
        onChange={handlePick}
        ref={inputRef}
        type="file"
      />

      {(value.length > 0 || pending.length > 0) && (
        <div className="tphoto__grid">
          {value.map((url) => (
            <div className="tphoto__thumb" key={url}>
              {/* `request-images` 는 next.config 의 remotePatterns 에 있다 — 예전 주석의
                  「허용 목록에 없다」는 사실과 다르다(2026-08-11 확인). */}
              <Image alt="" className="tphoto__img" src={url} width={64} height={64} />
              <button
                aria-label={copy.remove}
                className="tphoto__remove"
                disabled={isBusy}
                onClick={() => removeExisting(url)}
                type="button"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </div>
          ))}
          {pending.map((item) => (
            <div className="tphoto__thumb" key={item.id}>
              {/* Blob URL 은 Next.js Image 로 최적화할 수 없으므로 일반 img 를 쓴다 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" className="tphoto__img" src={item.previewUrl} />
              <button
                aria-label={copy.remove}
                className="tphoto__remove"
                disabled={isBusy}
                onClick={() => removePending(item.id)}
                type="button"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error !== null && (
        <p className="tphoto__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

async function uploadTaskPhotos(params: {
  pending: PreviewItem[];
  organizationId: string;
  requestId: string;
  requestType: "task-images" | "task-update-images";
}): Promise<string[]> {
  const { pending, organizationId, requestId, requestType } = params;
  if (pending.length === 0) return [];
  const { imageUrls } = await uploadRequestImages({
    items: pending,
    organizationId,
    requestId,
    requestType,
  });
  return imageUrls;
}

/**
 * 할 일 단위 사진 업로드 (인라인 추가 행 + 상세 패널의 할 일 사진).
 * 저장 경로는 `${organizationId}/task-images/...` 아래로 간다 — 그 접두사만 인식하는
 * src/lib/task-images.ts 의 `cleanupRemovedTaskImages` 가 요구한다.
 */
export async function uploadPendingTaskPhotos(params: {
  pending: PreviewItem[];
  organizationId: string;
  taskId: string; // 아직 만들어지지 않은 할 일이면 새 uuid
}): Promise<string[]> {
  return uploadTaskPhotos({ ...params, requestId: params.taskId, requestType: "task-images" });
}

/**
 * 메모/업데이트 로그 사진 업로드 (상세 패널 메모 작성기). `uploadPendingTaskPhotos` 와는 별도의 `requestType` —
 * 모바일 할 일 상세가 이미 쓰는 폴더 분리(`task-update-images` 대 `task-images`)와 같게 맞춰
 * 관리자와 모바일이 같은 스토리지 구조에 저장되게 한다.
 */
export async function uploadPendingTaskUpdatePhotos(params: {
  pending: PreviewItem[];
  organizationId: string;
  taskId: string;
}): Promise<string[]> {
  return uploadTaskPhotos({
    ...params,
    requestId: params.taskId,
    requestType: "task-update-images",
  });
}
