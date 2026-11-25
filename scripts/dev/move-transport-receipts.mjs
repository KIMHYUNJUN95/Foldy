/**
 * 교통비 영수증 옮기기 — 공개 버킷 request-images → 비공개 버킷 transport-receipts (2026-11-25).
 * 문서: docs/engineering/11-attendance-payroll-technical-design.md 「교통비 영수증 저장소(2026-11-25)」
 *
 * 순서: 마이그레이션 202611250002 적용 → 앱 배포 → 이 스크립트 미리 보기 → --apply.
 * 앱은 새 버킷 → 예전 버킷 순으로 서명 · 지우기를 하므로, 옮기는 도중 · 옮긴 뒤 모두 사진이 보인다.
 *
 * - 기본은 **미리 보기**(아무것도 바꾸지 않음): 사진 행 수 · 옮길 파일 · 이미 옮긴 파일 · 없는 파일을 센다.
 *   예전 버킷의 교통비 폴더도 훑어 **사진 행이 없는 예전 파일**(올리고 등록 못 한 파일 · 지운 사진의 남은 파일)과
 *   **새 버킷이 받지 않는 형식 · 크기**(jpeg/png/webp/gif · 8MB 밖 — 예: heic)를 센다. 이 둘은 보여 주기만 한다 —
 *   `--apply` 에서도 지우지 않고, 받지 않는 형식은 옮기지 않고 예전 버킷에 남긴다(앱이 예전 버킷으로 계속 보여 준다).
 * - `--apply`: 예전 버킷에서 내려받아 새 버킷에 올리고(같은 경로, 덮어쓰기), 올리기가 끝난 것만 예전 버킷에서 지운다.
 *   다시 돌려도 안전하다 — 새 버킷에 이미 있으면 올리지 않고 예전 사본만 지운다.
 * - **운영 프로젝트**에서는 `--apply` 에 `--prod` 를 함께 줘야 돈다(운영 데이터 변경 = 사용자 허락 뒤에만).
 *
 * 사용:
 *   node scripts/dev/move-transport-receipts.mjs                 # 미리 보기
 *   node scripts/dev/move-transport-receipts.mjs --apply         # 옮기기(로컬 · 시험)
 *   node scripts/dev/move-transport-receipts.mjs --apply --prod  # 운영에서 옮기기 — 허락 받은 뒤
 *
 * 필요한 환경 값: NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (.env.local 에서 읽는다 — 값은 출력하지 않는다).
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const PROD_REF = "sspdgzkytkpmquqsfaup";
const FROM_BUCKET = "request-images";
const TO_BUCKET = "transport-receipts";
const PAGE = 500;
const LIST_PAGE = 1000;
const FOLDER = "transport-reimbursements";
// 202611250002 의 transport-receipts 버킷 설정과 같아야 한다.
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;
const EXT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const SAMPLE = 20;

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (!(key in process.env)) process.env[key] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const PROD_OK = argv.includes("--prod");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** 서비스 키가 JWT 면 안의 `ref`(프로젝트). 값은 출력하지 않는다. */
function jwtRef(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}

if (!url || !key) {
  console.error("멈춤: NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  process.exit(1);
}
const isProd = url.includes(PROD_REF) || jwtRef(key) === PROD_REF;
if (APPLY && isProd && !PROD_OK) {
  console.error(`멈춤: 운영 프로젝트(${PROD_REF})입니다. 사용자 허락을 받은 뒤 --apply --prod 로 돌려 주세요.`);
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** 있음 true · 없음 false. 「없음」은 400/404 일 때만 — 그 밖의 오류는 던져서 「없는 파일」로 잘못 세지 않는다. */
async function exists(bucket, path) {
  const res = await db.storage.from(bucket).exists(path);
  if (res.data === true) return true;
  const e = res.error ?? {};
  const status = e.status ?? e.originalError?.status;
  if (res.data === false && (status === 400 || status === 404)) return false;
  throw new Error(`${bucket} 파일 확인 실패(상태 ${status ?? "없음"})`);
}

/** 한 폴더의 항목 전부(쪽 나눠 읽기). 폴더는 id 가 null, 파일은 metadata(mimetype · size)가 있다. */
async function listAll(bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const res = await db.storage.from(bucket).list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (res.error) throw new Error(`${bucket}/${prefix} 목록 읽기 실패: ${res.error.message}`);
    const rows = res.data ?? [];
    out.push(...rows);
    if (rows.length < LIST_PAGE) break;
  }
  return out;
}

/** 예전 버킷의 교통비 파일 전부: 경로 → { type, size }. 경로 모양 <조직>/transport-reimbursements/<정산서>/<항목>/<파일>. */
async function scanLegacyFiles() {
  const files = new Map();
  for (const org of await listAll(FROM_BUCKET, "")) {
    if (org.id !== null) continue; // 맨 위의 파일은 교통비가 아니다
    const base = `${org.name}/${FOLDER}`;
    for (const report of await listAll(FROM_BUCKET, base)) {
      if (report.id !== null) continue;
      for (const item of await listAll(FROM_BUCKET, `${base}/${report.name}`)) {
        if (item.id !== null) continue;
        const dir = `${base}/${report.name}/${item.name}`;
        for (const file of await listAll(FROM_BUCKET, dir)) {
          if (file.id === null) continue;
          files.set(`${dir}/${file.name}`, { type: file.metadata?.mimetype ?? null, size: file.metadata?.size ?? null });
        }
      }
    }
  }
  return files;
}

/** 새 버킷이 받지 않는 형식 · 크기면 그 까닭, 받으면 null. 목록에 형식이 없으면 확장자로 본다. */
function unsupportedReason(path, info) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const type = info?.type || EXT_TYPES[ext] || null;
  if (!type || !ALLOWED_TYPES.has(type)) return `형식 ${type ?? `알 수 없음(.${ext})`}`;
  if (typeof info?.size === "number" && info.size > MAX_BYTES) return `크기 ${info.size}바이트(8MB 초과)`;
  return null;
}

async function main() {
  const { data: bucketRow, error: bucketErr } = await db.storage.getBucket(TO_BUCKET);
  if (bucketErr || !bucketRow) {
    console.error(`멈춤: ${TO_BUCKET} 버킷이 없습니다 — 마이그레이션 202611250002 를 먼저 적용해 주세요.`);
    process.exit(1);
  }
  if (bucketRow.public) {
    console.error(`멈춤: ${TO_BUCKET} 버킷이 공개로 되어 있습니다. 비공개여야 합니다.`);
    process.exit(1);
  }

  const legacyFiles = await scanLegacyFiles();
  const stats = {
    rows: 0, toMove: 0, alreadyMoved: 0, missing: 0, unsupported: 0, orphans: 0,
    moved: 0, cleaned: 0, failed: 0,
  };
  const seen = new Set();
  const unsupportedSamples = [];
  for (let from = 0; ; from += PAGE) {
    const res = await db
      .from("transport_reimbursement_item_images")
      .select("id, storage_path")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(`사진 행 읽기 실패: ${res.error.message}`);
    const rows = res.data ?? [];
    for (const row of rows) {
      stats.rows += 1;
      const path = row.storage_path;
      if (!path || seen.has(path)) continue;
      seen.add(path);

      const inNew = await exists(TO_BUCKET, path);
      const inOld = await exists(FROM_BUCKET, path);
      if (inNew && !inOld) {
        stats.alreadyMoved += 1;
        continue;
      }
      if (!inNew && !inOld) {
        stats.missing += 1;
        console.warn(`없는 파일(사진 행 ${row.id}) — 두 버킷 어디에도 없음`);
        continue;
      }
      if (inOld && !inNew) {
        const reason = unsupportedReason(path, legacyFiles.get(path));
        if (reason) {
          // 새 버킷이 받지 않는다 — 옮기지 않고 예전 버킷에 남긴다(앱은 예전 버킷으로 계속 서명한다).
          stats.unsupported += 1;
          if (unsupportedSamples.length < SAMPLE) unsupportedSamples.push(`${path} (사진 행 ${row.id}, ${reason})`);
          continue;
        }
      }
      stats.toMove += 1;
      if (!APPLY) continue;

      try {
        if (!inNew) {
          const dl = await db.storage.from(FROM_BUCKET).download(path);
          if (dl.error || !dl.data) throw new Error(`내려받기 실패: ${dl.error?.message ?? "no data"}`);
          const up = await db.storage
            .from(TO_BUCKET)
            .upload(path, dl.data, { contentType: dl.data.type || "image/jpeg", upsert: true });
          if (up.error) throw new Error(`올리기 실패: ${up.error.message}`);
          if (!(await exists(TO_BUCKET, path))) throw new Error("올린 뒤 확인 실패");
          stats.moved += 1;
        }
        const rm = await db.storage.from(FROM_BUCKET).remove([path]);
        if (rm.error) throw new Error(`예전 사본 지우기 실패: ${rm.error.message}`);
        stats.cleaned += 1;
      } catch (error) {
        stats.failed += 1;
        console.error(`실패(사진 행 ${row.id}): ${error instanceof Error ? error.message : error}`);
      }
    }
    if (rows.length < PAGE) break;
  }

  // 사진 행이 없는 예전 파일 — 보여 주기만(지우지 않음). 사진 행 경로 전부를 본 뒤에 센다.
  const orphanSamples = [];
  for (const path of legacyFiles.keys()) {
    if (seen.has(path)) continue;
    stats.orphans += 1;
    if (orphanSamples.length < SAMPLE) orphanSamples.push(path);
  }
  if (unsupportedSamples.length > 0) {
    console.warn(`새 버킷이 받지 않는 형식 · 크기 ${stats.unsupported}개(옮기지 않음, 예전 버킷에 남김) — 앞 ${unsupportedSamples.length}개:`);
    for (const line of unsupportedSamples) console.warn(`  ${line}`);
  }
  if (orphanSamples.length > 0) {
    console.warn(`사진 행이 없는 예전 파일 ${stats.orphans}개(지우지 않음 — 확인만) — 앞 ${orphanSamples.length}개:`);
    for (const line of orphanSamples) console.warn(`  ${line}`);
  }

  console.log(
    `${APPLY ? "옮기기 끝" : "미리 보기(바꾼 것 없음 — --apply 로 옮기기)"}: 사진 행 ${stats.rows} · 옮길 파일 ${stats.toMove} · ` +
      `이미 옮김 ${stats.alreadyMoved} · 없는 파일 ${stats.missing} · 받지 않는 형식 ${stats.unsupported} · ` +
      `사진 행 없는 예전 파일 ${stats.orphans}` +
      (APPLY ? ` · 새로 올림 ${stats.moved} · 예전 사본 지움 ${stats.cleaned} · 실패 ${stats.failed}` : ""),
  );
  if (stats.failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
