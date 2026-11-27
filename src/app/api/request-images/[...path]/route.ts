import { NextResponse, type NextRequest } from "next/server";
import type { Capability } from "@/config/capabilities";
import { isPlatformDeveloper } from "@/config/roles";
import { memberCapabilities } from "@/lib/capabilities-server";
import { REQUEST_IMAGE_USER_FOLDERS } from "@/lib/request-image-folders";
import { requestImagesOwnedBy } from "@/lib/request-image-owners";
import { getCurrentAppSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * 비공개 `request-images` 버킷 사진 열기(2026-11-27). 화면 주소는 `requestImageSrc()` 가 만든다.
 * 조직 활성 멤버면 열린다 — 단 근태 정정 · 연차 사진은 그 기록의 본인이나 근태 관리 · 연차 결재 권한만(결정 A),
 * 할 일 · 메모 · 제안 사진은 그 행을 읽을 수 있는 사람이나 올린 사람만, 버그 사진은 신고한 사람 · 검토자만(2026-11-27).
 * 통과하면 5분짜리 서명 주소로 302. 파일이 있는지는 알려 주지 않는다.
 * 문서: docs/engineering/05-rls-permissions.md 「request-images 비공개 버킷」
 */
export const dynamic = "force-dynamic";

const BUCKET = "request-images";
const ROUTE_PREFIX = "/api/request-images/";
const SIGNED_URL_TTL_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

type RestrictedFolder = "attendance-corrections" | "annual-leave-requests";

/**
 * 본인 = 그 파일을 올린 사람(storage.objects.owner_id). 기록의 image_urls 로 보면 남의 주소를 내 기록에 넣어 열 수 있었다.
 * 이 두 폴더(와 아래 할 일 · 제안 · 버그 폴더)는 캐시하지 않는다 — 공용 태블릿에서 로그아웃 · 계정 바꾸기 뒤에 남은 302 로 열리지 않게.
 */
const RESTRICTED: Record<RestrictedFolder, Capability> = {
  "attendance-corrections": "attendance.manage",
  "annual-leave-requests": "leave.approve",
};

/** 폴더 → 경로 칸 수. 서버(service role)만 쓰는 폴더와 연차 폴더도 여기 있다. 교통비(`transport-reimbursements`)는 자기 서명 경로가 따로 있어 받지 않는다. */
const FOLDER_SEGMENTS: Record<string, number> = {
  ...Object.fromEntries(
    REQUEST_IMAGE_USER_FOLDERS.map((folder) => [folder, 4]),
  ),
  "annual-leave-requests": 4,
  "bug-reports": 4,
  "complaint-images": 4,
  "complaint-comment-images": 5,
};

type RowFolder = "task-images" | "task-update-images" | "suggestion-images";
const ROW_FOLDERS = new Set<string>([
  "task-images",
  "task-update-images",
  "suggestion-images",
] satisfies RowFolder[]);
const BUG_FOLDER = "bug-reports";

type Found = { data: unknown; error: unknown };

/** 읽기 오류는 403(닫힘) 그대로 두되 운영에서 원인을 찾을 수 있게 남긴다 — 경로 · 주소 · 사용자는 적지 않는다. */
function logFailure(what: string, folder: string, error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[request-images] ${what} failed`, {
    folder,
    code: typeof code === "string" ? code : null,
  });
}

function found(folder: string, result: Found): boolean {
  if (result.error) {
    logFailure("row check", folder, result.error);
    return false;
  }
  return result.data != null;
}

/** 저장된 주소 모양 두 가지(public · 그냥 object). 경로 칸은 SAFE_SEGMENT 라 인코딩이 바꾸지 않는다. */
function storedUrlsFor(path: string): string[] {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return [];
  try {
    const origin = new URL(base).origin;
    return [
      `${origin}/storage/v1/object/public/${BUCKET}/${path}`,
      `${origin}/storage/v1/object/${BUCKET}/${path}`,
    ];
  } catch {
    return [];
  }
}

/**
 * 사용자 세션(RLS)으로 그 사진을 가진 행이 하나라도 보이는가 — 앱 화면이 읽는 범위와 같다.
 * 할 일 RLS 는 지운 할 일도 참여자에게 보여 주므로(실시간 삭제 신호) 여기서 `deleted_at is null` 을 건다.
 */
async function visibleRowHasImage(
  folder: RowFolder,
  organizationId: string,
  path: string,
): Promise<boolean> {
  const urls = storedUrlsFor(path);
  if (urls.length === 0) return false;
  const supabase = await getSupabaseServerClient();
  if (folder === "task-images") {
    return found(
      folder,
      await supabase
        .from("tasks")
        .select("id")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .overlaps("image_urls", urls)
        .limit(1)
        .maybeSingle(),
    );
  }
  if (folder === "task-update-images") {
    return found(
      folder,
      await supabase
        .from("task_updates")
        .select("id, tasks!inner(organization_id, deleted_at)")
        .eq("tasks.organization_id", organizationId)
        .is("tasks.deleted_at", null)
        .overlaps("image_urls", urls)
        .limit(1)
        .maybeSingle(),
    );
  }
  const [suggestion, comment] = await Promise.all([
    supabase
      .from("staff_suggestions")
      .select("id")
      .eq("organization_id", organizationId)
      .overlaps("image_urls", urls)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("staff_suggestion_comments")
      .select("id")
      .eq("organization_id", organizationId)
      .overlaps("image_urls", urls)
      .limit(1)
      .maybeSingle(),
  ]);
  return found(folder, suggestion) || found(folder, comment);
}

const NO_STORE = { "Cache-Control": "no-store" };
const ERROR_CODES = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
} as const;

function failure(code: keyof typeof ERROR_CODES, asJson: boolean) {
  if (asJson)
    return NextResponse.json(
      { error: ERROR_CODES[code] },
      { status: code, headers: NO_STORE },
    );
  return new NextResponse(null, { status: code, headers: NO_STORE });
}

/** 주소의 날 경로에서 버킷 안 경로 칸을 꺼낸다. 이상하면 null. */
function parseSegments(pathname: string): string[] | null {
  if (!pathname.startsWith(ROUTE_PREFIX)) return null;
  const raw = pathname.slice(ROUTE_PREFIX.length).split("/");
  const segments: string[] = [];
  for (const part of raw) {
    let seg: string;
    try {
      seg = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (seg === "." || seg === ".." || !SAFE_SEGMENT.test(seg)) return null;
    segments.push(seg);
  }
  const [org, folder] = segments;
  if (segments.length < 3 || !UUID.test(org) || !(folder in FOLDER_SEGMENTS))
    return null;
  if (segments.length !== FOLDER_SEGMENTS[folder]) return null;
  return segments;
}

/** `?as=json` — 앱(Capacitor)이 서명 주소를 받아 앱 안 브라우저로 연다. 302 를 따라가면 WebView 가 Supabase 로 나가 버린다. */
export async function GET(request: NextRequest) {
  const asJson = request.nextUrl.searchParams.get("as") === "json";
  const status = (code: keyof typeof ERROR_CODES) => failure(code, asJson);
  const segments = parseSegments(request.nextUrl.pathname);
  if (!segments) return status(400);
  const [organizationId, folder] = segments;
  const path = segments.join("/");

  const session = await getCurrentAppSession();
  if (!session) return status(401);
  const userId = session.user.id;
  const service = getSupabaseServiceClient();

  // 세션 조직은 이미 활성 멤버십으로 확인됐다. 다른 조직이면 그 조직 활성 멤버인지 한 번 본다.
  const isSessionOrg = session.organization.id === organizationId;
  if (!isSessionOrg) {
    const { data, error } = await service
      .from("memberships")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (error || !data) return status(403);
  }

  const capabilitiesFor = () =>
    isSessionOrg
      ? session.capabilities
      : memberCapabilities(organizationId, userId);
  const capability = RESTRICTED[folder as RestrictedFolder] as
    Capability | undefined;
  if (capability) {
    if (
      !(await capabilitiesFor()).includes(capability) &&
      (await requestImagesOwnedBy(service, [path], userId)) !== true
    ) {
      return status(403);
    }
  }

  // 올린 사람 = storage owner_id — 저장하기 전 미리 보기도 열린다.
  const rowFolder = ROW_FOLDERS.has(folder) ? (folder as RowFolder) : null;
  if (rowFolder) {
    if (
      !(await visibleRowHasImage(rowFolder, organizationId, path)) &&
      (await requestImagesOwnedBy(service, [path], userId)) !== true
    ) {
      return status(403);
    }
  }

  // 버그 사진은 서버(service role)가 올려 owner 가 없다. 폴더 칸 3 = 신고 id 라 그 신고의 주인 · 검토자로 본다(앱의 상세 읽기와 같은 규칙).
  const isBug = folder === BUG_FOLDER;
  if (isBug) {
    const { data, error } = await service
      .from("bug_reports")
      .select("reported_by_user_id")
      .eq("id", segments[2])
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) logFailure("bug report check", folder, error);
    if (error || !data) return status(403);
    const allowed =
      data.reported_by_user_id === userId ||
      isPlatformDeveloper(session.user.role) ||
      (await capabilitiesFor()).includes("bug.review");
    if (!allowed) return status(403);
  }
  const noStore = Boolean(capability || rowFolder || isBug);

  const { data, error } = await service.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return status(404);

  if (asJson)
    return NextResponse.json({ url: data.signedUrl }, { headers: NO_STORE });
  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: {
      "Cache-Control": noStore ? "no-store" : "private, max-age=240",
      "Referrer-Policy": "no-referrer",
    },
  });
}
