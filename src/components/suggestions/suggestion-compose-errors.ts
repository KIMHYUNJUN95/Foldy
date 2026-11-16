/**
 * 의견 쓰기 · 수정 오류 판정 — 어떤 오류가 어느 칸 아래에 붙는지 한 곳에서 정한다.
 * 칸에 묶이지 않는 오류(업로드 · 저장 실패)는 보내기 버튼 근처 한 줄로 간다.
 * docs/product/22-staff-suggestions-workflow.md 「화이트 리디자인 — 모바일」.
 */

export type ComposeField = "recipient" | "title" | "body" | "photos";

export type ComposeErrorKey =
  | "missing_title"
  | "missing_body"
  | "missing_recipient"
  | "invalid_recipient"
  | "too_many_photos"
  | "upload_failed"
  | "save_failed";

export type ComposeFieldErrors = Partial<Record<ComposeField, ComposeErrorKey>>;

/** 화면 위에서 아래 순서 — 보내기를 누르면 이 순서로 첫 오류 칸에 포커스. */
export const COMPOSE_FIELD_ORDER: readonly ComposeField[] = ["recipient", "title", "body", "photos"];

const FIELD_OF: Record<ComposeErrorKey, ComposeField | null> = {
  missing_recipient: "recipient",
  invalid_recipient: "recipient",
  missing_title: "title",
  missing_body: "body",
  too_many_photos: "photos",
  upload_failed: null,
  save_failed: null,
};

function isComposeErrorKey(value: string): value is ComposeErrorKey {
  return Object.prototype.hasOwnProperty.call(FIELD_OF, value);
}

export function composeFieldOf(key: ComposeErrorKey): ComposeField | null {
  return FIELD_OF[key];
}

export function validateCompose(input: {
  hasRecipient: boolean;
  title: string;
  body: string;
}): ComposeFieldErrors {
  const errors: ComposeFieldErrors = {};
  if (!input.hasRecipient) errors.recipient = "missing_recipient";
  if (!input.title.trim()) errors.title = "missing_title";
  if (!input.body.trim()) errors.body = "missing_body";
  return errors;
}

export function firstInvalidField(errors: ComposeFieldErrors): ComposeField | null {
  return COMPOSE_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/** 서버가 `?error=` 로 돌려준 값 → 칸 오류 또는 폼 오류. 모르는 값은 저장 실패로 본다. */
export function splitServerError(raw: string | null | undefined): {
  fields: ComposeFieldErrors;
  form: ComposeErrorKey | null;
} {
  if (!raw) return { fields: {}, form: null };
  const key: ComposeErrorKey = isComposeErrorKey(raw) ? raw : "save_failed";
  const field = composeFieldOf(key);
  return field ? { fields: { [field]: key }, form: null } : { fields: {}, form: key };
}

/**
 * 서버 오류를 다시 걸지 판정. 서버는 실패하면 같은 화면에 `?error=` 를 붙여 돌려보내는데, 두 번 연달아 같은 값이면
 * prop 이 안 바뀐다 — 그래서 값이 바뀔 때뿐 아니라 「서버에 보낸 시도가 끝났을 때」도 다시 건다.
 * `sentAttempt` 는 서버 액션을 부른 시도 번호(업로드 실패처럼 서버까지 못 간 시도는 올리지 않는다).
 */
export type ServerErrorSync = { seen: string | null; appliedAttempt: number };

export function nextServerErrorSync(
  prev: ServerErrorSync,
  input: { serverError: string | null | undefined; pending: boolean; sentAttempt: number },
): ServerErrorSync | null {
  const current = input.serverError ?? null;
  const changed = current !== prev.seen;
  const settled = !input.pending && input.sentAttempt !== prev.appliedAttempt;
  if (!changed && !settled) return null;
  return { seen: current, appliedAttempt: input.pending ? prev.appliedAttempt : input.sentAttempt };
}
