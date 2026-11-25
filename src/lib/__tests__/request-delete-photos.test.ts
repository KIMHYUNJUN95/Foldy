import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "org-1";
const ID = "11111111-1111-4111-8111-111111111111";
const BASE = "https://proj.supabase.co";
const url = (folder: string, name: string, id = ID, org = ORG) =>
  `${BASE}/storage/v1/object/public/request-images/${org}/${folder}/${id}/${name}`;
const own = (name: string) => url("lost-items", name);
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  deleted: [{ id: "x" }] as Array<{ id: string }>,
  deleteError: null as null | { message: string },
  readError: null as null | { message: string },
  removeError: null as null | { message: string },
  remove: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  hasOrganizationContext: () => true,
  getCurrentAppSession: vi.fn(async () => ({
    organization: { id: ORG },
    user: { id: "u1" },
    capabilities: ["request.delete_any"],
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: state.row, error: state.readError });
      chain.delete = () => {
        const del: Record<string, unknown> = {};
        del.eq = () => del;
        del.select = async () => ({ data: state.deleted, error: state.deleteError });
        return del;
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => ({
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          state.remove(paths);
          return { error: state.removeError };
        },
      }),
    },
  }),
}));

import { deleteLostItem, deleteMaintenanceReport, deleteOrderRequest } from "@/actions/request-delete";

describe("요청 삭제 — 사진 정리", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
    state.remove.mockClear();
    state.deleted = [{ id: "x" }];
    state.deleteError = null;
    state.readError = null;
    state.removeError = null;
    state.row = {
      reported_by_user_id: "u1",
      status: "open",
      image_urls: [own("a.jpg"), `https://evil.example.com/storage/v1/object/public/request-images/${ORG}/lost-items/${ID}/b.jpg`],
      handling_image_urls: [url("lost-found-handling", "c.jpg"), url("lost-found-handling", "d.jpg", ID, "other-org")],
    };
  });

  it("행 삭제 성공 뒤 우리 조직 경로만 지운다", async () => {
    await expect(deleteLostItem(ID)).resolves.toEqual({ ok: true });
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(state.remove).toHaveBeenCalledWith([`${ORG}/lost-items/${ID}/a.jpg`, `${ORG}/lost-found-handling/${ID}/c.jpg`]);
  });

  it("수리 신고도 처리 사진까지 지운다", async () => {
    state.row = { reported_by_user_id: "u1", status: "open", image_urls: [url("maintenance-reports", "a.jpg")], resolution_image_urls: [url("maintenance-resolutions", "r.jpg")] };
    await expect(deleteMaintenanceReport(ID)).resolves.toEqual({ ok: true });
    expect(state.remove).toHaveBeenCalledWith([`${ORG}/maintenance-reports/${ID}/a.jpg`, `${ORG}/maintenance-resolutions/${ID}/r.jpg`]);
  });

  it("0행이면 지우지 않는다", async () => {
    state.deleted = [];
    await expect(deleteLostItem(ID)).resolves.toEqual({ ok: false, error: "not_found" });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("행 삭제 오류면 지우지 않는다", async () => {
    state.deleteError = { message: "boom" };
    await expect(deleteLostItem(ID)).resolves.toEqual({ ok: false, error: "delete_failed" });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("사진 삭제가 실패해도 삭제는 성공", async () => {
    state.removeError = { message: "storage down" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deleteLostItem(ID)).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("경로 탈출 · 인코딩 입력은 거절", async () => {
    const b = `${BASE}/storage/v1/object/public/request-images`;
    state.row = {
      reported_by_user_id: "u1",
      status: "open",
      image_urls: [
        `${b}/${ORG}/lost-items/${ID}/../../x/a.jpg`,
        `${b}/${ORG}/lost-items/${ID}/%2e%2e/a.jpg`,
        `${b}/${ORG}/lost-items/${ID}/%2e%2e%2Fa.jpg`,
        `${b}/${ORG}/../x/a.jpg`,
      ],
    };
    await expect(deleteLostItem(ID)).resolves.toEqual({ ok: true });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("같은 주소가 두 열에 있어도 한 번만", async () => {
    state.row = { reported_by_user_id: "u1", status: "open", image_urls: [own("a.jpg"), own("a.jpg")], handling_image_urls: [own("a.jpg")] };
    await deleteLostItem(ID);
    expect(state.remove).toHaveBeenCalledWith([`${ORG}/lost-items/${ID}/a.jpg`]);
  });

  it("빈 열 · 배열 아닌 열은 건너뜀", async () => {
    state.row = { reported_by_user_id: "u1", status: "open", image_urls: [], handling_image_urls: null };
    await expect(deleteLostItem(ID)).resolves.toEqual({ ok: true });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("다른 기록 폴더나 다른 열 폴더 주소는 지우지 않음", async () => {
    state.row = {
      reported_by_user_id: "u1",
      status: "open",
      image_urls: [url("lost-items", "x.jpg", OTHER_ID), url("lost-found-handling", "y.jpg"), own("ok.jpg")],
      handling_image_urls: [],
    };
    await deleteLostItem(ID);
    expect(state.remove).toHaveBeenCalledWith([`${ORG}/lost-items/${ID}/ok.jpg`]);
  });

  it("행 읽기 오류면 delete_failed", async () => {
    state.readError = { message: "column does not exist" };
    state.row = null;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deleteLostItem(ID)).resolves.toEqual({ ok: false, error: "delete_failed" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("발주는 사진 삭제를 부르지 않는다", async () => {
    state.row = { reported_by_user_id: "u1", status: "pending" };
    await expect(deleteOrderRequest(ID)).resolves.toEqual({ ok: true });
    expect(state.remove).not.toHaveBeenCalled();
  });
});
