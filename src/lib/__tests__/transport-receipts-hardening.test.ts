// 교통비 영수증 점검(2026-11-25) — 비공개 버킷 · 파일 확인 뒤 등록 · 거절된 업로드 정리 · 행 먼저 지우기 ·
// 읽기 실패를 빈 목록으로 숨기지 않기 · 서명 주소 실패 표시 · 다시 받기 · 입력 방식 바꾸기.
// 문서: docs/engineering/11-attendance-payroll-technical-design.md 「교통비 영수증 저장소(2026-11-25)」
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/tokyo-date", () => ({ tokyoToday: () => "2026-11-25" }));

const ORG = "org-1";
const USER = "user-1";
let sessionUserId = USER;
vi.mock("@/lib/session", () => ({
  getCurrentAppSession: async () => ({
    organization: { id: ORG },
    user: { id: sessionUserId, preferredLanguage: "ko" },
  }),
  hasOrganizationContext: () => true,
}));
let canManage = true;
vi.mock("@/lib/attendance-review", async (orig) => ({
  ...(await orig<typeof import("@/lib/attendance-review")>()),
  attendanceCan: async () => canManage,
}));

const NEW = "transport-receipts";
const LEGACY = "request-images";

type Fake = ReturnType<typeof makeFake>;
let fake: Fake;
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: () => fake.client }));

/** fake-supabase 위에 Storage 두 버킷 · 표별 오류 주입 · 호출 순서 기록을 얹는다. */
function makeFake(tables: Record<string, Record<string, unknown>[]>) {
  const base = createFakeSupabase(tables);
  const faults = new Map<string, string | { message: string; code: string }>(); // "표:동작" → 오류 문장(또는 코드까지)
  const log: string[] = [];
  const buckets: Record<string, Set<string>> = { [NEW]: new Set(), [LEGACY]: new Set() };
  const storageFaults = {
    existsThrows: false,
    /** exists 가 던지지 않고 돌려주는 값을 바꾼다(확인 못 함 · 이상한 응답). */
    existsReturns: null as null | { data: boolean | null; error: unknown },
    signFails: new Set<string>(),
    removeFails: false,
  };

  const from = (table: string) => {
    const b = base.client.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
    let op = "select";
    for (const m of ["insert", "update", "delete", "upsert"]) {
      const orig = b[m];
      b[m] = (...a: unknown[]) => {
        op = m;
        return orig(...a);
      };
    }
    const origThen = b.then as (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => unknown;
    b.then = ((res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      log.push(`${table}:${op}`);
      const msg = faults.get(`${table}:${op}`);
      if (msg) return Promise.resolve(res({ data: null, error: typeof msg === "string" ? { message: msg } : msg }));
      return origThen(res, rej);
    }) as never;
    return b;
  };

  const storage = {
    from(bucket: string) {
      const set = (buckets[bucket] ??= new Set());
      return {
        async exists(path: string) {
          if (storageFaults.existsThrows) throw new Error("network down");
          if (storageFaults.existsReturns) return storageFaults.existsReturns;
          // storage-js: 없으면 StorageApiError(status 400/404) 또는 StorageUnknownError(originalError.status).
          return set.has(path)
            ? { data: true, error: null }
            : { data: false, error: { message: "Object not found", status: 404 } };
        },
        async remove(paths: string[]) {
          log.push(`storage:${bucket}:remove`);
          if (storageFaults.removeFails) return { data: null, error: { message: "remove failed" } };
          for (const p of paths) set.delete(p);
          return { data: [], error: null };
        },
        async createSignedUrls(paths: string[], ttl: number) {
          if (storageFaults.signFails.has(bucket)) return { data: null, error: { message: "sign failed" } };
          return {
            data: paths.map((p) =>
              set.has(p)
                ? { path: p, signedUrl: `https://signed/${bucket}/${p}?ttl=${ttl}`, error: null }
                : { path: p, signedUrl: null, error: "Either the object does not exist or you do not have access to it" },
            ),
            error: null,
          };
        },
      };
    },
  };

  return { client: { from, rpc: base.client.rpc, storage }, tables: base.tables, faults, log, buckets, storageFaults };
}

const R1 = "rep-1";
const I1 = "item-1";
const pathOf = (file: string, item = I1, report = R1) => `${ORG}/transport-reimbursements/${report}/${item}/${file}`;

function seed(status = "draft", images = 0) {
  fake = makeFake({
    transport_reimbursement_reports: [
      { id: R1, organization_id: ORG, user_id: USER, target_month: "2026-11-01", status, total_amount_cached: 400 },
    ],
    transport_reimbursement_items: [
      {
        id: I1,
        organization_id: ORG,
        report_id: R1,
        user_id: USER,
        usage_date: "2026-11-05",
        amount_yen: 400,
        entry_mode: "linked",
        attendance_session_id: "att-1",
        work_context: { linkedSourceType: "attendance", linkedSourceId: "att-1", buildingLabel: "아라키초A" },
        sort_order: 0,
      },
    ],
    transport_reimbursement_item_images: Array.from({ length: images }, (_, i) => ({
      id: `img-${i}`,
      organization_id: ORG,
      report_id: R1,
      item_id: I1,
      user_id: USER,
      storage_path: pathOf(`old-${i}.jpg`),
      sort_order: i,
      created_at: `2026-11-0${i + 1}T00:00:00Z`,
    })),
  });
}

beforeEach(() => {
  sessionUserId = USER;
  canManage = true;
  seed();
});

const actions = () => import("@/app/mobile/attendance/transport/actions");

describe("버킷 이름 — 화면 · 서버가 같은 상수를 쓴다", () => {
  it("새 버킷은 transport-receipts, 예전 버킷은 request-images, 서명 주소는 10분", async () => {
    const m = await import("@/lib/transport-receipt-bucket");
    expect(m.TRANSPORT_RECEIPT_BUCKET).toBe(NEW);
    expect(m.LEGACY_TRANSPORT_RECEIPT_BUCKET).toBe(LEGACY);
    expect(m.TRANSPORT_RECEIPT_URL_TTL_SECONDS).toBe(600);
  });
});

describe("읽기 실패를 「없음」으로 숨기지 않는다", () => {
  it("getTransportReport 는 읽기 오류면 던진다", async () => {
    const { getTransportReport } = await import("@/lib/transport-reimbursement");
    fake.faults.set("transport_reimbursement_reports:select", "boom");
    await expect(getTransportReport(fake.client as never, ORG, USER, "2026-11-01")).rejects.toThrow();
  });

  it("getTransportItems 는 항목 · 사진 읽기 오류면 던진다", async () => {
    const { getTransportItems } = await import("@/lib/transport-reimbursement");
    fake.faults.set("transport_reimbursement_items:select", "boom");
    await expect(getTransportItems(fake.client as never, R1)).rejects.toThrow();
    fake.faults.clear();
    fake.faults.set("transport_reimbursement_item_images:select", "boom");
    await expect(getTransportItems(fake.client as never, R1)).rejects.toThrow();
  });

  it("항목 읽기 오류는 forbidden 이 아니라 read_failed", async () => {
    const { updateTransportItemAction } = await actions();
    fake.faults.set("transport_reimbursement_items:select", "boom");
    expect(await updateTransportItemAction({ itemId: I1, amountYen: 500 })).toEqual({ ok: false, error: "read_failed" });
  });
});

describe("addTransportItemImageAction — 파일 확인 · 거절된 업로드 정리", () => {
  it("Storage 에 파일이 없으면 file_missing, 행을 만들지 않는다", async () => {
    const { addTransportItemImageAction } = await actions();
    expect(await addTransportItemImageAction(I1, pathOf("a.jpg"))).toEqual({ ok: false, error: "file_missing" });
    expect(fake.tables.transport_reimbursement_item_images).toHaveLength(0);
  });

  it("파일 확인이 실패하면(네트워크) storage_failed", async () => {
    const { addTransportItemImageAction } = await actions();
    fake.storageFaults.existsThrows = true;
    expect(await addTransportItemImageAction(I1, pathOf("a.jpg"))).toEqual({ ok: false, error: "storage_failed" });
  });

  it("새 버킷에 올린 파일이 있으면 등록한다", async () => {
    const { addTransportItemImageAction } = await actions();
    fake.buckets[NEW].add(pathOf("a.jpg"));
    expect(await addTransportItemImageAction(I1, pathOf("a.jpg"))).toEqual({ ok: true });
    expect(fake.tables.transport_reimbursement_item_images).toHaveLength(1);
    expect(fake.buckets[NEW].has(pathOf("a.jpg"))).toBe(true);
  });

  it("제출된 정산서면 report_not_editable 이고 올라간 파일을 지운다", async () => {
    seed("submitted");
    const { addTransportItemImageAction } = await actions();
    fake.buckets[NEW].add(pathOf("a.jpg"));
    expect(await addTransportItemImageAction(I1, pathOf("a.jpg"))).toEqual({ ok: false, error: "report_not_editable" });
    expect(fake.buckets[NEW].has(pathOf("a.jpg"))).toBe(false);
  });

  it("5장이 차 있으면 too_many_images 이고 올라간 파일을 지운다", async () => {
    seed("draft", 5);
    const { addTransportItemImageAction } = await actions();
    fake.buckets[NEW].add(pathOf("a.jpg"));
    expect(await addTransportItemImageAction(I1, pathOf("a.jpg"))).toEqual({ ok: false, error: "too_many_images" });
    expect(fake.buckets[NEW].has(pathOf("a.jpg"))).toBe(false);
  });

  it("DB 상한 트리거에 걸리면 too_many_images, 잠금 트리거면 report_not_editable — 둘 다 파일 정리", async () => {
    const { addTransportItemImageAction } = await actions();
    fake.buckets[NEW].add(pathOf("a.jpg"));
    fake.faults.set("transport_reimbursement_item_images:insert", "transport item image limit");
    expect(await addTransportItemImageAction(I1, pathOf("a.jpg"))).toEqual({ ok: false, error: "too_many_images" });
    expect(fake.buckets[NEW].has(pathOf("a.jpg"))).toBe(false);

    fake.buckets[NEW].add(pathOf("b.jpg"));
    fake.faults.set("transport_reimbursement_item_images:insert", "transport report is not editable");
    expect(await addTransportItemImageAction(I1, pathOf("b.jpg"))).toEqual({ ok: false, error: "report_not_editable" });
    expect(fake.buckets[NEW].has(pathOf("b.jpg"))).toBe(false);
  });

  it("남의 경로면 invalid_path 이고 그 파일은 건드리지 않는다", async () => {
    const { addTransportItemImageAction } = await actions();
    const other = pathOf("a.jpg", "item-other");
    fake.buckets[NEW].add(other);
    expect(await addTransportItemImageAction(I1, other)).toEqual({ ok: false, error: "invalid_path" });
    expect(fake.buckets[NEW].has(other)).toBe(true);
  });

  it("이미 등록된 경로를 다시 보내면(두 번 누름 · 다시 시도) 새 행 없이 ok, 파일도 지우지 않는다", async () => {
    seed("draft", 5);
    const { addTransportItemImageAction } = await actions();
    const existing = pathOf("old-0.jpg");
    fake.buckets[NEW].add(existing);
    expect(await addTransportItemImageAction(I1, existing)).toEqual({ ok: true });
    expect(fake.tables.transport_reimbursement_item_images).toHaveLength(5);
    expect(fake.buckets[NEW].has(existing)).toBe(true);
  });

  it("동시에 두 번 넣어 DB 유일 제약(23505)에 걸리면 ok, 올라간 파일은 남긴다", async () => {
    const { addTransportItemImageAction } = await actions();
    fake.buckets[NEW].add(pathOf("a.jpg"));
    fake.faults.set("transport_reimbursement_item_images:insert", {
      message: 'duplicate key value violates unique constraint "transport_item_images_item_path_key"',
      code: "23505",
    });
    expect(await addTransportItemImageAction(I1, pathOf("a.jpg"))).toEqual({ ok: true });
    expect(fake.buckets[NEW].has(pathOf("a.jpg"))).toBe(true);
    expect(fake.log).not.toContain(`storage:${NEW}:remove`);
  });

  it("파일 확인이 「없음」이 아닌 오류로 돌아오면(권한 · 설정 · 서버) storage_failed — file_missing 으로 숨기지 않는다", async () => {
    const { addTransportItemImageAction } = await actions();
    for (const r of [
      { data: false, error: { message: "Forbidden", status: 403 } },
      { data: false, error: { message: "Internal", originalError: { status: 500 } } },
      { data: false, error: { message: "no status" } },
      { data: null, error: null },
    ]) {
      fake.storageFaults.existsReturns = r;
      expect(await addTransportItemImageAction(I1, pathOf("a.jpg")), JSON.stringify(r)).toEqual({ ok: false, error: "storage_failed" });
    }
    expect(fake.tables.transport_reimbursement_item_images).toHaveLength(0);
  });

  it("400 · 404(StorageUnknownError 의 originalError.status 포함)는 「없음」", async () => {
    const { addTransportItemImageAction } = await actions();
    for (const r of [
      { data: false, error: { message: "x", status: 400 } },
      { data: false, error: { message: "x", originalError: { status: 404 } } },
    ]) {
      fake.storageFaults.existsReturns = r;
      expect(await addTransportItemImageAction(I1, pathOf("a.jpg"))).toEqual({ ok: false, error: "file_missing" });
    }
  });
});

describe("사진 · 항목 삭제 — 행 먼저, 파일은 그 뒤(두 버킷 모두)", () => {
  it("사진 삭제: 행을 지운 뒤 두 버킷에서 파일을 지운다", async () => {
    seed("draft", 1);
    const { deleteTransportItemImageAction } = await actions();
    fake.buckets[LEGACY].add(pathOf("old-0.jpg"));
    expect(await deleteTransportItemImageAction("img-0")).toEqual({ ok: true });
    const rowAt = fake.log.indexOf("transport_reimbursement_item_images:delete");
    const fileAt = fake.log.findIndex((l) => l.startsWith("storage:"));
    expect(rowAt).toBeGreaterThanOrEqual(0);
    expect(fileAt).toBeGreaterThan(rowAt);
    expect(fake.log).toContain(`storage:${NEW}:remove`);
    expect(fake.log).toContain(`storage:${LEGACY}:remove`);
    expect(fake.buckets[LEGACY].has(pathOf("old-0.jpg"))).toBe(false);
  });

  it("사진 삭제: DB 잠금 트리거에 걸리면 report_not_editable 이고 파일은 남긴다", async () => {
    seed("draft", 1);
    const { deleteTransportItemImageAction } = await actions();
    fake.buckets[NEW].add(pathOf("old-0.jpg"));
    fake.faults.set("transport_reimbursement_item_images:delete", "transport report is not editable");
    expect(await deleteTransportItemImageAction("img-0")).toEqual({ ok: false, error: "report_not_editable" });
    expect(fake.buckets[NEW].has(pathOf("old-0.jpg"))).toBe(true);
  });

  it("사진 삭제: 파일 지우기가 실패해도 행은 이미 지워졌으므로 ok", async () => {
    seed("draft", 1);
    const { deleteTransportItemImageAction } = await actions();
    fake.storageFaults.removeFails = true;
    expect(await deleteTransportItemImageAction("img-0")).toEqual({ ok: true });
    expect(fake.tables.transport_reimbursement_item_images).toHaveLength(0);
  });

  it("항목 삭제: 행을 지운 뒤 파일을 지운다, 잠금 트리거면 파일은 남긴다", async () => {
    seed("draft", 1);
    const { deleteTransportItemAction } = await actions();
    fake.buckets[NEW].add(pathOf("old-0.jpg"));
    fake.faults.set("transport_reimbursement_items:delete", "transport report is not editable");
    expect(await deleteTransportItemAction(I1)).toEqual({ ok: false, error: "report_not_editable" });
    expect(fake.buckets[NEW].has(pathOf("old-0.jpg"))).toBe(true);

    fake.faults.clear();
    fake.log.length = 0;
    expect(await deleteTransportItemAction(I1)).toEqual({ ok: true });
    const rowAt = fake.log.indexOf("transport_reimbursement_items:delete");
    const fileAt = fake.log.findIndex((l) => l.startsWith("storage:"));
    expect(fileAt).toBeGreaterThan(rowAt);
    expect(fake.buckets[NEW].has(pathOf("old-0.jpg"))).toBe(false);
  });

  it("사진 목록 읽기가 실패하면 항목을 지우지 않는다(read_failed)", async () => {
    seed("draft", 1);
    const { deleteTransportItemAction } = await actions();
    fake.faults.set("transport_reimbursement_item_images:select", "boom");
    expect(await deleteTransportItemAction(I1)).toEqual({ ok: false, error: "read_failed" });
    expect(fake.tables.transport_reimbursement_items).toHaveLength(1);
  });
});

describe("서명 주소 — 새 버킷 먼저, 없으면 예전 버킷, 실패는 표시", () => {
  it("두 버킷을 차례로 보고, 어디에도 없는 경로는 failedPaths", async () => {
    const { signTransportReceiptPaths } = await import("@/lib/transport-receipt-storage");
    fake.buckets[NEW].add("a");
    fake.buckets[LEGACY].add("b");
    const { urlByPath, failedPaths } = await signTransportReceiptPaths(fake.client as never, ["a", "b", "c"]);
    expect(urlByPath.get("a")).toContain(`/${NEW}/a?ttl=600`);
    expect(urlByPath.get("b")).toContain(`/${LEGACY}/b`);
    expect([...failedPaths]).toEqual(["c"]);
  });

  it("새 버킷 호출 전체가 실패해도 예전 버킷으로 다시 본다, 둘 다 실패면 전부 failed — 던지지 않는다", async () => {
    const { signTransportReceiptPaths } = await import("@/lib/transport-receipt-storage");
    fake.buckets[LEGACY].add("b");
    fake.storageFaults.signFails.add(NEW);
    const first = await signTransportReceiptPaths(fake.client as never, ["b"]);
    expect(first.urlByPath.get("b")).toContain(LEGACY);
    fake.storageFaults.signFails.add(LEGACY);
    const second = await signTransportReceiptPaths(fake.client as never, ["b"]);
    expect(second.urlByPath.size).toBe(0);
    expect([...second.failedPaths]).toEqual(["b"]);
  });

  it("휴대폰 다시 받기: 내 항목만, 사진 id 와 주소, 실패 표시", async () => {
    seed("approved", 2);
    fake.buckets[NEW].add(pathOf("old-0.jpg"));
    const { refreshTransportReceiptUrlsAction } = await actions();
    const res = await refreshTransportReceiptUrlsAction(I1);
    expect(res).toMatchObject({ ok: true, imageUrlsFailed: true });
    if (!res.ok) throw new Error("unreachable");
    expect(res.images.map((i) => i.id)).toEqual(["img-0", "img-1"]);
    expect(res.images[0].url).toContain("old-0.jpg");
    expect(res.images[1].url).toBeNull();

    sessionUserId = "user-2";
    expect(await refreshTransportReceiptUrlsAction(I1)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("updateTransportItemAction — 입력 방식(entryMode)", () => {
  it("자동 연결 → 직접 입력은 받는다: 연결 출처와 근태 칸을 비운다", async () => {
    const { updateTransportItemAction } = await actions();
    expect(await updateTransportItemAction({ itemId: I1, entryMode: "manual" })).toMatchObject({ ok: true });
    const item = fake.tables.transport_reimbursement_items[0];
    expect(item.entry_mode).toBe("manual");
    expect(item.attendance_session_id).toBeNull();
    expect(item.work_context).toEqual({ buildingLabel: "아라키초A" });
  });

  it("직접 입력 → 자동 연결, 알 수 없는 값은 invalid_entry_mode", async () => {
    const { updateTransportItemAction } = await actions();
    await updateTransportItemAction({ itemId: I1, entryMode: "manual" });
    expect(await updateTransportItemAction({ itemId: I1, entryMode: "linked" })).toEqual({
      ok: false,
      error: "invalid_entry_mode",
    });
    expect(await updateTransportItemAction({ itemId: I1, entryMode: "weird" as never })).toEqual({
      ok: false,
      error: "invalid_entry_mode",
    });
  });

  it("DB 잠금 트리거에 걸리면 report_not_editable", async () => {
    const { updateTransportItemAction } = await actions();
    fake.faults.set("transport_reimbursement_items:update", "transport report is not editable");
    expect(await updateTransportItemAction({ itemId: I1, amountYen: 500 })).toEqual({
      ok: false,
      error: "report_not_editable",
    });
  });
});

describe("관리자 — 달 검사 · 다시 받기", () => {
  const admin = () => import("@/app/admin/attendance/actions");

  it("loadAdminTransportDetail: 잘못된 달은 invalid_month", async () => {
    const { loadAdminTransportDetail } = await admin();
    expect(await loadAdminTransportDetail(USER, "2026-13")).toEqual({ ok: false, reason: "invalid_month" });
    expect(await loadAdminTransportDetail(USER, "x")).toEqual({ ok: false, reason: "invalid_month" });
  });

  it("loadAdminTransportDetail: 읽기 실패는 error, 서명 실패는 항목에 표시", async () => {
    seed("submitted", 1);
    const { loadAdminTransportDetail } = await admin();
    const res = await loadAdminTransportDetail(USER, "2026-11");
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) throw new Error("unreachable");
    expect(res.items[0]).toMatchObject({ imageCount: 1, imageUrls: [], imageUrlsFailed: true });

    fake.faults.set("transport_reimbursement_items:select", "boom");
    expect(await loadAdminTransportDetail(USER, "2026-11")).toEqual({ ok: false, reason: "error" });
  });

  it("refreshAdminTransportReceiptUrlsAction: 권한 · 조직 확인 뒤 주소", async () => {
    seed("submitted", 1);
    fake.buckets[LEGACY].add(pathOf("old-0.jpg"));
    const { refreshAdminTransportReceiptUrlsAction } = await admin();
    const res = await refreshAdminTransportReceiptUrlsAction(I1);
    expect(res).toMatchObject({ ok: true, imageUrlsFailed: false });
    if (!res.ok) throw new Error("unreachable");
    expect(res.images[0]).toMatchObject({ id: "img-0" });
    expect(res.images[0].url).toContain(LEGACY);

    expect(await refreshAdminTransportReceiptUrlsAction("nope")).toEqual({ ok: false, reason: "not_found" });
    fake.tables.transport_reimbursement_items[0].organization_id = "org-2";
    expect(await refreshAdminTransportReceiptUrlsAction(I1)).toEqual({ ok: false, reason: "not_found" });
    canManage = false;
    expect(await refreshAdminTransportReceiptUrlsAction(I1)).toEqual({ ok: false, reason: "forbidden" });
  });
});
