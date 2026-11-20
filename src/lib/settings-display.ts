/**
 * 설정(`/admin/settings/*`)이 화면에 그릴 때만 쓰는 고르기 규칙 — 2026-11-20 unslop.
 * 날짜 점 표기는 사용자 관리와 같은 `dotDateOfIso` (`src/lib/users-display.ts`)를 그대로 쓴다.
 */

import { pickDefaultInviteOrganization } from "@/lib/users-display";

/**
 * 조직 설정에서 처음 열 조직.
 * - 주소에 `?org=` 가 있으면 그 조직(목록에 없으면 null — 「찾을 수 없음」을 보여 준다).
 * - 없으면 **지금 보고 있는 조직**, 그 조직을 관리할 수 없을 때(목록에 없음)만 목록 첫 조직.
 *   예전에는 늘 목록 첫 조직이라, 여러 조직을 관리하는 사람이 다른 조직을 보고 있다고 착각할 수 있었다.
 */
export function pickSettingsOrganization<T extends { id: string }>(
  organizations: readonly T[],
  requestedId: string | null | undefined,
  currentOrganizationId: string | null | undefined,
): T | null {
  if (requestedId) return organizations.find((organization) => organization.id === requestedId) ?? null;
  return pickDefaultInviteOrganization(organizations, currentOrganizationId);
}

/** 확인 창 실행 단추 글자 — 누른 뒤(서버 응답 대기)에는 동작마다 다른 「…하는 중」, 없으면 원래 글자. */
export function confirmOkLabel(ok: string, pendingLabel: string | null | undefined, pending: boolean): string {
  return pending && pendingLabel ? pendingLabel : ok;
}

/**
 * 자동 저장 칸 하나의 상태(설정 › 급여, 2026-11-20). 판정은 모두 여기 — 컴포넌트는 사건을 넘기고 결과대로 그리기만 한다.
 *
 * 원칙 두 가지를 나눈다:
 * - **서버가 확인한 값(`confirmed`)** — 서버 응답이 ok 면 낡은 응답이어도 그 요청이 보낸 값으로 갱신한다(서버엔 그 값이 들어갔으니까).
 * - **표시(「저장됨」 · 오류)** — 요청 번호(`seq`)로 그 칸의 **마지막 요청 응답만** 바꾼다. 칸을 다시 고치기 시작하면(touch) 번호가 올라
 *   기다리던 응답은 표시를 바꾸지 못한다. 오류는 그 칸을 고치거나 다시 저장에 성공할 때까지 남는다.
 */
export type SaveState<V> = {
  confirmed: V;
  seq: number;
  /** 아직 응답이 안 온 요청 번호들. */
  inflight: number[];
  /** 「저장됨」을 띄운 요청 번호(없으면 null) — 시간이 지나 지울 때 그사이 새 사건이 없었는지 본다. */
  savedSeq: number | null;
  error: string | null;
};

export function initSave<V>(confirmed: V): SaveState<V> {
  return { confirmed, seq: 0, inflight: [], savedSeq: null, error: null };
}

/** 저장 요청 시작 — 번호를 올리고 그 칸의 「저장됨」 · 오류를 지운다. */
export function beginSave<V>(s: SaveState<V>): { state: SaveState<V>; ticket: number } {
  const ticket = s.seq + 1;
  return { ticket, state: { ...s, seq: ticket, inflight: [...s.inflight, ticket], savedSeq: null, error: null } };
}

/** 칸을 다시 고치기 시작함 — 기다리던 응답의 표시를 무효화하고 「저장됨」 · 오류를 지운다(서버 확인 값은 그대로). */
export function touchSave<V>(s: SaveState<V>): SaveState<V> {
  return { ...s, seq: s.seq + 1, savedSeq: null, error: null };
}

export type SaveResponse<V> = { ok: true; value: V } | { ok: false; message: string };

/**
 * 응답 하나 반영. `latest` = 이 칸의 마지막 요청 응답(표시를 바꿈), `newerPending` = 이 요청보다 새 요청이 아직 응답 대기 중.
 * ok 면 `confirmed` 는 latest 여부와 관계없이 보낸 값.
 */
export function settleSaveResponse<V>(
  s: SaveState<V>,
  ticket: number,
  res: SaveResponse<V>,
): { state: SaveState<V>; latest: boolean; newerPending: boolean } {
  const inflight = s.inflight.filter((t) => t !== ticket);
  const latest = s.seq === ticket;
  const newerPending = inflight.some((t) => t > ticket);
  let next: SaveState<V> = { ...s, inflight };
  if (res.ok) {
    next.confirmed = res.value;
    if (latest) next = { ...next, savedSeq: ticket, error: null };
  } else if (latest) {
    next = { ...next, savedSeq: null, error: res.message };
  }
  return { state: next, latest, newerPending };
}

/** 「저장됨」을 시간이 지나 지운다 — 그사이 새 사건(요청 · 고침)이 없었을 때만. */
export function expireSaved<V>(s: SaveState<V>, savedSeq: number): SaveState<V> {
  return s.savedSeq === savedSeq ? { ...s, savedSeq: null } : s;
}

/**
 * 입력 칸(회사 이름 · 지급일): 응답 뒤 화면 값을 다시 저장해야 하나.
 * 늦은 성공으로 서버 확인 값이 바뀌었는데 칸이 편집 중이 아니고, 기다리는 요청 · 오류가 없고, 화면 값이 다르면 → 화면 값을 다시 저장한다
 * (예: O→X 저장 중 다시 O 로 되돌리고 벗어남 → 벗어날 땐 같아 보여 건너뛰었지만 서버는 X).
 */
export function needsResave<V>(s: SaveState<V>, display: V, editing: boolean): boolean {
  return !editing && s.inflight.length === 0 && s.error === null && display !== s.confirmed;
}

/** 지급일 1~28 정수 — 서버(`saveOrgPayrollSettings`)와 같은 검사. */
export function isValidPayDay(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 28;
}

/** 지급일: 응답 뒤 칸 글자를 다시 저장하나 — 1~28 이 아닌 글자는 다시 보내지 않는다(벗어날 때 오류로 보여 줌). */
export function shouldResavePayDay(s: SaveState<unknown>, shownText: string, editing: boolean): boolean {
  const shown = Number(shownText);
  return isValidPayDay(shown) && needsResave<unknown>(s, shown, editing);
}

/** 칸의 오류만 지운다(번호 · 기다리는 요청은 그대로 — 아직 오는 응답의 「저장됨」 · 오류 표시는 살아 있다). */
export function dismissError<V>(s: SaveState<V>): SaveState<V> {
  return s.error === null ? s : { ...s, error: null };
}

/**
 * 고르기 칸(결재 순서): 응답 뒤 화면을 서버 확인 값으로 되돌려야 하나 — 실패(낡은 실패 포함)하거나 늦은 성공으로 값이 바뀌었을 때,
 * 그 칸에 더 새 요청이 기다리고 있지 않으면 화면을 서버 확인 값에 맞춘다(되돌리는 기준은 `prev` 가 아니라 서버 확인 값).
 */
export function pickedValueAfter<V>(s: SaveState<V>, display: V, newerPending: boolean): V {
  return newerPending ? display : s.confirmed;
}
