import "server-only";

// 교통비 영수증 Storage — 어느 버킷을 볼지 정하는 곳은 여기 하나(2026-11-25).
// 서명: 새 비공개 버킷 → 없으면 예전 공개 버킷. 지우기: 두 버킷 모두. 있는지 확인: 새 → 예전 버킷(배포 직후 캐시된 예전 화면 대비).
// 문서: docs/engineering/11-attendance-payroll-technical-design.md 「교통비 영수증 저장소(2026-11-25)」
import {
  LEGACY_TRANSPORT_RECEIPT_BUCKET,
  TRANSPORT_RECEIPT_BUCKET,
  TRANSPORT_RECEIPT_URL_TTL_SECONDS,
} from "@/lib/transport-receipt-bucket";

type StorageError = { message?: string } | string | null | undefined;
type BucketApi = {
  createSignedUrls: (
    paths: string[],
    expiresIn: number,
  ) => Promise<{
    data: Array<{ path: string | null; signedUrl: string | null; error: StorageError }> | null;
    error: StorageError;
  }>;
  remove: (paths: string[]) => Promise<{ error: StorageError }>;
  exists: (path: string) => Promise<{ data: boolean | null; error: StorageError }>;
};
/** service role 클라이언트에서 storage 만 쓴다(타입이 다른 테스트 가짜도 받도록 느슨하게). */
export type ReceiptStorageClient = { storage: { from: (bucket: string) => unknown } };

const bucket = (client: ReceiptStorageClient, name: string) => client.storage.from(name) as BucketApi;

export type SignedReceiptUrls = {
  urlByPath: Map<string, string>;
  /** 두 버킷 어디에서도 주소를 못 받은 경로(파일 없음 · Storage 오류). 화면은 「사진을 불러오지 못했어요」로 보인다. */
  failedPaths: Set<string>;
};

async function signIn(client: ReceiptStorageClient, name: string, paths: string[], into: Map<string, string>) {
  if (paths.length === 0) return;
  try {
    const signed = await bucket(client, name).createSignedUrls(paths, TRANSPORT_RECEIPT_URL_TTL_SECONDS);
    if (signed.error || !signed.data) {
      console.error(`[transport-receipts] sign failed in ${name}`, signed.error);
      return;
    }
    for (const row of signed.data) {
      if (row.path && row.signedUrl && !row.error) into.set(row.path, row.signedUrl);
    }
  } catch (error) {
    console.error(`[transport-receipts] sign threw in ${name}`, error);
  }
}

/** 영수증 경로들의 서명 주소. 던지지 않는다 — 실패는 failedPaths 로 돌려준다. */
export async function signTransportReceiptPaths(
  client: ReceiptStorageClient,
  paths: readonly string[],
): Promise<SignedReceiptUrls> {
  const unique = [...new Set(paths.filter(Boolean))];
  const urlByPath = new Map<string, string>();
  await signIn(client, TRANSPORT_RECEIPT_BUCKET, unique, urlByPath);
  await signIn(
    client,
    LEGACY_TRANSPORT_RECEIPT_BUCKET,
    unique.filter((p) => !urlByPath.has(p)),
    urlByPath,
  );
  const failedPaths = new Set(unique.filter((p) => !urlByPath.has(p)));
  return { urlByPath, failedPaths };
}

/** 두 버킷에서 지운다. 없는 파일 지우기는 Storage 가 성공으로 돌려준다. 실패해도 던지지 않는다. */
export async function removeTransportReceiptFiles(
  client: ReceiptStorageClient,
  paths: readonly string[],
): Promise<{ ok: boolean; error?: string }> {
  const list = [...new Set(paths.filter(Boolean))];
  if (list.length === 0) return { ok: true };
  const errors: string[] = [];
  for (const name of [TRANSPORT_RECEIPT_BUCKET, LEGACY_TRANSPORT_RECEIPT_BUCKET]) {
    try {
      const res = await bucket(client, name).remove(list);
      if (res.error) errors.push(`${name}: ${typeof res.error === "string" ? res.error : res.error.message ?? "error"}`);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length > 0) {
    console.error("[transport-receipts] remove failed", errors.join("; "));
    return { ok: false, error: errors.join("; ") };
  }
  return { ok: true };
}

/** storage-js 오류의 HTTP 상태 — StorageApiError.status, 또는 StorageUnknownError.originalError.status(HEAD 응답). */
function storageErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { status?: unknown; statusCode?: unknown; originalError?: { status?: unknown } | null };
  for (const v of [e.status, e.originalError?.status, e.statusCode]) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * 그 파일이 Storage 에 있는가. 있음 true · 없음 false · 확인 못 함 "error".
 * 새 버킷을 먼저 보고, 없으면 예전 버킷도 본다 — 배포 직후 예전 화면(캐시된 PWA)이 request-images 로 올린 파일도
 * 등록되게 한다(옮기기 스크립트가 나중에 옮긴다).
 * storage-js 의 exists 는 400/404 면 { data:false, error } 를 돌려주고 그 밖의 오류는 던진다.
 * 「없음」은 data:false 이면서 상태가 400 · 404 일 때만이다 — 그 밖(권한 403 · 서버 5xx · 상태 없는 오류 · data 가 boolean 아님 ·
 * 던짐)은 「확인 못 함」으로 돌려 화면이 「파일이 없어요」 대신 「저장소 오류」를 보이게 한다(2026-11-25 독립 검사).
 * HEAD 응답에는 본문이 없어 400 이 「버킷 없음」인지 「파일 없음」인지는 가를 수 없다(storage-js 와 같은 판단).
 */
export async function transportReceiptExists(
  client: ReceiptStorageClient,
  path: string,
): Promise<boolean | "error"> {
  try {
    for (const name of [TRANSPORT_RECEIPT_BUCKET, LEGACY_TRANSPORT_RECEIPT_BUCKET]) {
      const res = await bucket(client, name).exists(path);
      if (res.data === true) return true;
      const status = storageErrorStatus(res.error);
      const notFound = res.data === false && (status === 400 || status === 404);
      if (!notFound) {
        console.error(`[transport-receipts] exists check failed in ${name}`, status ?? res.error ?? res.data);
        return "error";
      }
    }
    return false;
  } catch (error) {
    console.error("[transport-receipts] exists check failed", error);
    return "error";
  }
}
