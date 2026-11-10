import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PC 게스트 피드백 서버 액션 — 2026-11-10 점검 수정. 예전엔 전환 · 번역 실패를 삼키고 redirect 해서 화면이 실패를 몰랐다.
 * 이제 결과를 돌려준다: 전환은 `{ ok, complaintId }`(이미 연결됐어도 ok + 그 컴플레인) / `{ error }`, 번역은 `{ ok }` / `{ error }`.
 */
const state = vi.hoisted(() => ({
  session: null as unknown,
  convert: vi.fn(),
  translate: vi.fn(),
  review: null as unknown,
  create: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentAppSession: async () => state.session }));
vi.mock("@/lib/external-reviews", () => ({
  convertReviewToComplaint: (...args: unknown[]) => state.convert(...args),
  getExternalReview: async () => state.review,
}));
vi.mock("@/lib/review-translate", () => ({
  translateReviewPart: (...args: unknown[]) => state.translate(...args),
  createTranslationBudget: () => ({ reserve: async () => true, refund: () => undefined }),
}));
vi.mock("@/lib/complaints", () => ({
  canWriteComplaint: (s: { capabilities: string[] }) => s.capabilities.includes("complaint.write"),
  createComplaint: (...args: unknown[]) => state.create(...args),
  uploadComplaintImage: vi.fn(),
}));

import { convertReviewAction, createManualComplaintAction, translateReviewAction } from "@/app/admin/complaints/actions";

beforeEach(() => {
  state.session = { organization: { id: "org" }, user: { id: "u", preferredLanguage: "ko" }, capabilities: ["complaint.write"] };
  state.review = { id: "r1", provider: "airbnb", externalReviewId: "x", headline: null, reviewText: "dirty room", positiveReviewText: null, negativeReviewText: null, privateFeedback: null, sourceLanguageCode: null };
  state.convert.mockReset();
  state.translate.mockReset();
  state.create.mockReset();
});

describe("convertReviewAction", () => {
  it("성공하면 컴플레인 id", async () => {
    state.convert.mockResolvedValue({ complaintId: "c1", alreadyLinked: false });
    await expect(convertReviewAction("r1")).resolves.toEqual({ ok: true, complaintId: "c1", alreadyLinked: false });
  });
  it("이미 연결됐으면 오류가 아니라 연결된 컴플레인", async () => {
    state.convert.mockResolvedValue({ complaintId: "c9", alreadyLinked: true });
    await expect(convertReviewAction("r1")).resolves.toEqual({ ok: true, complaintId: "c9", alreadyLinked: true });
  });
  it("실패하면 error 를 돌려준다(삼키지 않는다)", async () => {
    state.convert.mockRejectedValue(new Error("save_failed"));
    await expect(convertReviewAction("r1")).resolves.toEqual({ error: "save_failed" });
  });
  it("권한이 없으면 forbidden", async () => {
    state.session = { organization: { id: "org" }, user: { id: "u" }, capabilities: [] };
    await expect(convertReviewAction("r1")).resolves.toEqual({ error: "forbidden" });
  });
});

describe("translateReviewAction", () => {
  it("모든 조각이 번역되면 ok", async () => {
    state.translate.mockResolvedValue({ status: "ok", text: "t" });
    await expect(translateReviewAction("r1")).resolves.toEqual({ ok: true });
  });
  it("하나라도 못 하면 error(조용히 원문만 보이지 않게)", async () => {
    state.translate.mockResolvedValue({ status: "unavailable", reason: "budget_exhausted" });
    await expect(translateReviewAction("r1")).resolves.toEqual({ error: "unavailable" });
  });
});

describe("createManualComplaintAction — submission_id 를 넘긴다", () => {
  it("폼의 submission_id 가 createComplaint 로 간다", async () => {
    state.create.mockResolvedValue({ id: "c1" });
    const form = new FormData();
    form.set("platform", "airbnb");
    form.set("title", "t");
    form.set("submission_id", "00000000-0000-4000-8000-000000000001");
    await createManualComplaintAction(form);
    expect(state.create.mock.calls[0][0].input.submissionId).toBe("00000000-0000-4000-8000-000000000001");
  });
});
