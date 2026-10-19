import "server-only";
import { resolveFirestoreProjectId } from "@/lib/recruit/firestore";
import { normalizeApplication, type NormalizedApplication, type RecruitSource } from "@/lib/recruit/payload";
import { isAllowedResumeSourceUrl } from "@/lib/recruit/resume-source";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 지원서 수신 — 채용 사이트 → Foldy.
 *
 * 채용 사이트의 Cloud Function `onApplicationCreated` 가 이 경로로 보낸다. 백필도 같은 경로를 쓴다.
 *
 * **재전송해도 안전해야 한다.** 함수 재시도, 백필 재실행, 수동 재전송이 모두 일어난다. 그래서
 * `(organization_id, source, external_id)` 유니크로 받고, 이미 있는 행은 **지원자 정보만** 갱신한다.
 * 심사 상태·검토 메모·합격 연결은 Foldy 가 소유한 값이라 절대 덮지 않는다 — 덮으면 「불합격 처리해
 * 뒀는데 재전송 한 번에 대기 중으로 돌아가는」 사고가 난다.
 *
 * 도메인 계약: docs/product/30-recruit-workflow.md
 */

export const RESUME_BUCKET = "recruit-resumes";

/** 버킷 `file_size_limit` 과 같다. 넘는 파일은 어차피 올라가지 않으므로 받지도 않는다. */
const RESUME_MAX_BYTES = 10 * 1024 * 1024;
const RESUME_FETCH_TIMEOUT_MS = 20_000;

export type IngestResult =
  | { ok: true; id: string; created: boolean; resumeStored: boolean }
  /** 이 조직에서 지운 지원서다. 다시 넣지 않는다(§ 삭제 기록). */
  | { ok: true; skipped: "deleted" }
  | { ok: false; error: "invalid_payload" | "no_organization" | "write_failed" };

/**
 * 지원서가 속할 조직.
 *
 * 지금은 단일 조직 운영이라 `RECRUIT_ORGANIZATION_ID` 가 없으면 **유일한 조직**을 쓴다. 조직이 둘
 * 이상인데 환경변수가 없으면 **추측하지 않고 거부한다** — 남의 조직으로 지원서가 새는 것이 가장
 * 나쁜 실패다(조직 격리는 서버 관심사, CLAUDE.md §6).
 */
export async function resolveRecruitOrganizationId(): Promise<string | null> {
  const configured = process.env.RECRUIT_ORGANIZATION_ID?.trim();
  if (configured) return configured;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("organizations").select("id").limit(2);
  if (error) {
    console.error("[recruit/ingest] organization lookup failed:", error.message);
    return null;
  }
  if (!data || data.length !== 1) {
    console.error(
      `[recruit/ingest] cannot resolve organization (found ${data?.length ?? 0}). Set RECRUIT_ORGANIZATION_ID.`,
    );
    return null;
  }
  return data[0].id;
}

/**
 * 저장 경로에 쓸 파일명.
 *
 * **ASCII 만 쓴다.** Supabase Storage 의 오브젝트 키는 한글을 거부한다 — 백필에서 `이력서.pdf` 가
 * `Invalid key` 로 튕겼다. 원래 파일명은 `resume_file_name` 컬럼에 그대로 남아 있고 화면·내려받기
 * 이름은 그쪽을 쓰므로, 경로는 `resume.{확장자}` 로 단순하게 둔다.
 */
function storageFileName(name: string | null): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name ?? "")?.[1]?.toLowerCase();
  return ext ? `resume.${ext}` : "resume";
}

/** content-length 가 없거나 거짓이어도 상한을 넘기면 끊는다. 넘으면 null. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * 이력서 파일을 Foldy 비공개 버킷으로 복사한다.
 *
 * **왜 링크만 저장하지 않나.** 원본은 토큰이 박힌 Firebase 다운로드 URL이라 URL 을 아는 사람이면
 * 누구나 열 수 있고, 채용 사이트를 접거나 파일을 지우면 링크가 죽는다. 지원서는 채용 이력으로
 * 남아야 하므로 사본을 갖는다.
 *
 * **허용된 주소만 받는다**(`isAllowedResumeSourceUrl`) — 주소는 지원자가 마음대로 넣을 수 있다.
 *
 * 실패해도 지원서 수신 자체는 성공으로 둔다 — 접수 기록을 잃는 것이 훨씬 큰 손해다.
 * `resume_source_url` 은 남으므로 나중에 재시도할 수 있다(`job_applications_resume_pending_idx`).
 */
async function copyResumeToStorage(args: {
  organizationId: string;
  applicationId: string;
  sourceUrl: string;
  fileName: string | null;
}): Promise<string | null> {
  if (!isAllowedResumeSourceUrl(args.sourceUrl, resolveFirestoreProjectId())) {
    console.warn(`[recruit/ingest] resume source not allowed for ${args.applicationId}`);
    return null;
  }
  try {
    // 리다이렉트를 따라가면 허용 검사를 우회할 수 있다. Firebase 다운로드 URL 은 바로 200 을 준다.
    const response = await fetch(args.sourceUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(RESUME_FETCH_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      console.warn(`[recruit/ingest] resume fetch failed (${response.status}) for ${args.applicationId}`);
      return null;
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > RESUME_MAX_BYTES) {
      console.warn(`[recruit/ingest] resume too large (${declared}) for ${args.applicationId}`);
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const body = await readCapped(response, RESUME_MAX_BYTES);
    if (!body) {
      console.warn(`[recruit/ingest] resume exceeded size cap for ${args.applicationId}`);
      return null;
    }
    const path = `${args.organizationId}/${args.applicationId}/${storageFileName(args.fileName)}`;

    const supabase = getSupabaseServiceClient();
    const upload = (type: string) =>
      supabase.storage.from(RESUME_BUCKET).upload(path, body, { contentType: type, upsert: true });

    let { error } = await upload(contentType);
    if (error && /mime type/i.test(error.message)) {
      // 지원자는 무엇이든 낸다 — 한글(.hwp), 아이폰 사진(.heic), 엑셀이 실제로 들어왔다. 버킷 목록에
      // 없는 형식이면 octet-stream 으로 낮춰 저장한다. **접수를 잃는 것보다 낫다.** 이렇게 저장하면
      // 브라우저가 실행 대신 내려받으므로 html/svg 가 섞여 들어와도 위험하지 않다.
      ({ error } = await upload("application/octet-stream"));
    }
    if (error) {
      console.warn(`[recruit/ingest] resume upload failed for ${args.applicationId}:`, error.message);
      return null;
    }
    return path;
  } catch (error) {
    console.warn(`[recruit/ingest] resume copy threw for ${args.applicationId}:`, error);
    return null;
  }
}

/** 재전송으로 덮어도 되는 열(= 채용 사이트가 원본인 값)만 모은다. */
function applicantColumns(input: NormalizedApplication) {
  return {
    job_external_id: input.jobExternalId,
    job_title: input.jobTitle,
    employment_type: input.employmentType,
    applied_position: input.appliedPosition,
    applicant_name: input.applicantName,
    age: input.age,
    gender: input.gender,
    phone: input.phone,
    kakao_id: input.kakaoId,
    address: input.address,
    commute_time: input.commuteTime,
    uniform_size: input.uniformSize,
    nationality: input.nationality,
    visa_type: input.visaType,
    visa_period: input.visaPeriod,
    work_days: input.workDays,
    days_per_week: input.daysPerWeek,
    duration: input.duration,
    start_date: input.startDate,
    has_industry_exp: input.hasIndustryExp,
    industry_tasks: input.industryTasks,
    source_channel: input.sourceChannel,
    motivation: input.motivation,
    resume_file_name: input.resumeFileName,
    resume_source_url: input.resumeSourceUrl,
    applied_at: input.appliedAt,
    raw_payload: input.rawPayload as never,
  };
}

export async function ingestJobApplication(args: {
  source: RecruitSource;
  externalId: string;
  document: Record<string, unknown>;
}): Promise<IngestResult> {
  const input = normalizeApplication(args);
  if (!input) return { ok: false, error: "invalid_payload" };

  const organizationId = await resolveRecruitOrganizationId();
  if (!organizationId) return { ok: false, error: "no_organization" };

  const supabase = getSupabaseServiceClient();

  // **지운 지원서는 되살리지 않는다.**
  //
  // Foldy 는 Firestore 를 읽기만 하므로 콘솔에서 지워도 원본 문서는 남는다. 그대로 두면 하루
  // 1회 전량 훑기가 다시 읽어 넣고, 이력서 파일까지 다시 복사된다 — 지운 개인정보가 되돌아온다.
  // 「지웠다」는 Foldy 쪽 정보라 여기서 본다. 수신 경로가 이 함수 하나로 모여 있어서 전량
  // 훑기·재전송·나중에 붙일 Cloud Function 이 모두 함께 막힌다.
  const { data: tombstone, error: tombstoneError } = await supabase
    .from("job_application_deletions")
    .select("external_id")
    .eq("organization_id", organizationId)
    .eq("source", input.source)
    .eq("external_id", input.externalId)
    .maybeSingle();
  if (tombstoneError) {
    // 삭제 기록을 못 읽으면 **넣지 않는다.** 되살아나는 쪽이 조용히 잘못되기 때문이다.
    console.error("[recruit/ingest] deletion lookup failed:", tombstoneError.message);
    return { ok: false, error: "write_failed" };
  }
  if (tombstone) return { ok: true, skipped: "deleted" };

  const { data: existing, error: lookupError } = await supabase
    .from("job_applications")
    .select("id, resume_path")
    .eq("organization_id", organizationId)
    .eq("source", input.source)
    .eq("external_id", input.externalId)
    .maybeSingle();
  if (lookupError) {
    console.error("[recruit/ingest] lookup failed:", lookupError.message);
    return { ok: false, error: "write_failed" };
  }

  let applicationId: string;
  let created: boolean;

  if (existing) {
    // 상태·메모·합격 연결은 건드리지 않는다(위 주석 참고).
    const { error } = await supabase
      .from("job_applications")
      .update(applicantColumns(input))
      .eq("id", existing.id);
    if (error) {
      console.error("[recruit/ingest] update failed:", error.message);
      return { ok: false, error: "write_failed" };
    }
    applicationId = existing.id;
    created = false;
  } else {
    const { data, error } = await supabase
      .from("job_applications")
      .insert({
        organization_id: organizationId,
        source: input.source,
        external_id: input.externalId,
        ...applicantColumns(input),
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[recruit/ingest] insert failed:", error?.message);
      return { ok: false, error: "write_failed" };
    }
    applicationId = data.id;
    created = true;
  }

  // 이미 복사해 둔 이력서는 다시 받지 않는다.
  let resumeStored = Boolean(existing?.resume_path);
  if (input.resumeSourceUrl && !resumeStored) {
    const path = await copyResumeToStorage({
      organizationId,
      applicationId,
      sourceUrl: input.resumeSourceUrl,
      fileName: input.resumeFileName,
    });
    if (path) {
      const { error } = await supabase
        .from("job_applications")
        .update({ resume_path: path })
        .eq("id", applicationId);
      if (error) {
        // 파일은 올라갔는데 경로를 못 적은 상태. 다음 전송 때 같은 경로로 덮어쓰며 복구된다.
        console.warn("[recruit/ingest] resume path write failed:", error.message);
      } else {
        resumeStored = true;
      }
    }
  }

  return { ok: true, id: applicationId, created, resumeStored };
}
