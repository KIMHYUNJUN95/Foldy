/**
 * 과거 답장에서 찾은 후보 — 순수 함수(서버 · 시험 공용). docs/product/49-guest-message-ai-reply-assist.md §9
 *
 * - 비밀 걸러내기(`containsSecretLike`): 출입 비밀번호 · 와이파이 비밀번호 · 문 코드는 **후보로 만들지 않는다**.
 *   모델 지시문에도 적지만(1차), 모델이 낸 글을 서버가 한 번 더 본다(2차) — 둘 중 하나라도 걸리면 그 후보는 버린다.
 * - 묶기(`greedyClusters`): 질문 뜻 숫자끼리 가까운 것을 많이 가진 질문부터 묶음으로 잡는다.
 * - 값 후보(`mergeOptions`): **최신이 이긴다** — 마지막으로 쓴 날이 늦은 값이 앞. 섞여 있으면 화면이 둘 다 보인다.
 * - 기억(`isRemembered` · `valueHashOf`): 넣은 · 뺀 후보와 같은 묶음 · 같은 값은 다시 띄우지 않는다.
 */

import { GUEST_LANGS, GUEST_INFO_LIMITS, type GuestLang, type Localized } from "@/lib/guest-messages/guest-info-model";
import { SAVED_REPLY_LIMITS, SAVED_REPLY_VARIABLES } from "@/lib/guest-messages/saved-reply-model";
import { SECRET_WORD_RE, SENTENCE_SPLIT_RE, WIFI_WORD_RE } from "@/lib/guest-messages/ai-assist-model";

export const CANDIDATE_FIELDS = ["checkIn", "checkOut", "luggage", "parking", "trash", "directions"] as const;
export type CandidateField = (typeof CANDIDATE_FIELDS)[number];

export function isCandidateField(value: unknown): value is CandidateField {
  return typeof value === "string" && (CANDIDATE_FIELDS as readonly string[]).includes(value);
}

export const CANDIDATE_RULES = {
  /** 질문 묶음: 이 거리(코사인) 안이면 같은 질문. */
  clusterMaxDistance: 0.3,
  /** 표본 안에서 묶음이 되려면 비슷한 질문이 이만큼(자기 포함). */
  clusterMinSample: 4,
  /** 실제 기간 전체에서 이만큼 물어봤어야 후보. */
  minAskCount: 10,
  /** 한 번에 만드는 문구 후보 최대. */
  maxSavedReplyCandidates: 30,
  /** 이미 있는 문구와 이만큼 비슷하면 후보를 만들지 않는다 / 「비슷한 문구가 있어요」 표시. */
  savedReplySkipSimilarity: 0.9,
  savedReplyHintSimilarity: 0.8,
  /** 넣은 · 뺀 묶음과 이만큼 비슷하면 같은 묶음 — 다시 띄우지 않는다. */
  rememberSimilarity: 0.88,
  /** 건물 칸: 근거 답장이 이만큼 안 되면 후보를 만들지 않는다(「비슷한 답이 n건뿐」). */
  minFieldSupport: 10,
  /** 값 하나가 후보가 되려면 근거가 이만큼. */
  minOptionSupport: 3,
  /** 화면에 보이는 값 후보 최대(최신 순). */
  maxOptions: 2,
  /** 묶음마다 모델에 주는 최근 답장 수 · 화면 근거 수. */
  repliesPerCluster: 8,
  evidencePerCandidate: 3,
  /** 건물마다 모델에 주는 최근 답장 수 · 한 줄 길이. */
  repliesPerBuilding: 150,
  replyClipChars: 400,
  /** 표본(최근 질문) 수 — 묶기는 이 안에서만 계산한다. */
  sampleSize: 1500,
  /** 한 번 실행 비용 상한(micro USD) — 먼저 잡아 두고, 넘으면 남은 호출을 하지 않는다. */
  runReserveMicroUsd: 2_000_000,
  /** 문구 묶음을 모델 한 번에 몇 개씩. */
  clustersPerCall: 5,
  sourceMonths: 12,
} as const;

// ── 비밀 걸러내기 ─────────────────────────────────────────────────────────────

/** 비밀번호 · 코드를 말하는 낱말(한 · 일 · 영). 와이파이 낱말은 건물 칸에서만 더한다. */
/** 숫자 3자리 넘게(띄어쓰기 · 하이픈 섞여도) 또는 가린 자리. */
// 가린 자리 「[…]」 는 NFKC 에서 「[...]」 가 된다 — 문장 나누기 전에 표지로 바꿔 둔다(점에서 잘리지 않게).
const MASK_RE = /\[(?:…|\.\.\.)\]/g;
const MASK_TOKEN = "⟦MASK⟧";
const CODE_LIKE_RE = /(\d[\s-]?){3,}|⟦MASK⟧|••|＊{2,}|\*{3,}|#\d/;

function normalizeSecret(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s-]/g, "");
}

/**
 * 비밀처럼 보이면 true — (1) 조직의 실제 출입 코드 · 와이파이 값이 들어 있음, 또는
 * (2) 비밀번호 · 코드 낱말과 숫자(3자리 넘게) · 가린 자리가 같은 문장에 있음. `wifi` 면 와이파이 낱말 + 숫자도 막는다.
 */
export function containsSecretLike(text: string, secrets: readonly string[], options: { wifi?: boolean } = {}): boolean {
  if (!text) return false;
  const flat = normalizeSecret(text);
  for (const secret of secrets) {
    const value = normalizeSecret(secret);
    if (value.length >= 3 && flat.includes(value)) return true;
  }
  return secretSentenceFlags(text, options).some(Boolean);
}

/**
 * 문장마다 「비밀 낱말 + 숫자 · 가린 자리」인가 — 비밀 낱말이 든 문장 **바로 다음 조각**도 본다(「Door code:\n12 34」 처럼
 * 줄을 바꿔 값을 쓴 것 · 사이 빈 줄 · 마침표 뒤 줄바꿈은 건넌다). 나누는 자리는 `text.split(SENTENCE_SPLIT_RE)` 와 같다(NFKC · 가린 자리 표지는 문장 안에서만).
 */
function secretSentenceFlags(text: string, options: { wifi?: boolean }): boolean[] {
  let previousSecret = false;
  return text.split(SENTENCE_SPLIT_RE).map((raw) => {
    // 빈칸 · 줄바꿈뿐인 조각은 상태를 건드리지 않는다(빈 줄 · 마침표 뒤 줄바꿈을 건너 다음 조각까지 본다).
    if (!raw.trim()) return false;
    const sentence = raw.normalize("NFKC").replace(MASK_RE, MASK_TOKEN);
    const secretWord = SECRET_WORD_RE.test(sentence) || (options.wifi === true && WIFI_WORD_RE.test(sentence));
    const hit = (secretWord || previousSecret) && CODE_LIKE_RE.test(sentence);
    previousSecret = secretWord;
    return hit;
  });
}

/**
 * 건물 칸 값 — 숫자가 없어도 비밀번호 · 코드 낱말이 있으면 true(「비밀번호는 sakura」). 건물 안내는 손님에게 그대로 나가므로
 * 비밀 낱말이 든 값은 아예 후보로 내지 않는다. 와이파이 낱말만은 괜찮다(「Wi-Fi 무료」).
 */
export function mentionsSecretWord(text: string): boolean {
  return Boolean(text) && SECRET_WORD_RE.test(text.normalize("NFKC"));
}

/** 근거 글(가린 뒤) — 한 번 더 본다. 비밀처럼 보이는 문장은 통째로 `[…]`(뜻만 남기고 값은 못 읽게). */
export function scrubSecretSentences(text: string, secrets: readonly string[]): string {
  if (!text) return text;
  const flags = secretSentenceFlags(text, { wifi: true });
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((sentence, index) => {
      if (!flags[index] && !containsSecretLike(sentence, secrets, { wifi: true })) return sentence;
      const tail = /\s*$/.exec(sentence)?.[0] ?? "";
      const head = /^\s*/.exec(sentence)?.[0] ?? "";
      return `${head}[…]${tail}`;
    })
    .join("")
    .replace(/\[…\](?:\s*\[…\])+/g, "[…]");
}

/** 후보 글 전부(이름 · 질문 · 본문 · 메모 · 값) 중 하나라도 걸리면 true. */
export function anySecretLike(texts: ReadonlyArray<string | null | undefined>, secrets: readonly string[], options: { wifi?: boolean } = {}): boolean {
  return texts.some((text) => typeof text === "string" && containsSecretLike(text, secrets, options));
}

// ── 동시 실행 ─────────────────────────────────────────────────────────────────

/**
 * 줄 묶음 동시 실행(최대 n개) — 모델 호출을 한 줄로 세우면 함수 시간(300초)을 넘는다.
 * 하나가 실패하면 **새 작업은 잡지 않고, 돌던 작업이 모두 끝난 뒤에** 첫 오류로 거부한다 — 실행 줄을 닫은(비용 정산 · 후보 지우기) 뒤에
 * 후보가 더 들어가거나 비용이 빠지지 않게.
 */
export async function eachLimited<T>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (failure === null && next < items.length) {
      const index = next;
      next += 1;
      try {
        await run(items[index], index);
      } catch (error) {
        failure ??= { error };
      }
    }
  });
  await Promise.all(workers);
  if (failure !== null) throw (failure as { error: unknown }).error;
}

// ── 뜻 숫자 ───────────────────────────────────────────────────────────────────

export function cosineOf(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function centroidOf(vectors: ReadonlyArray<readonly number[]>): number[] {
  if (vectors.length === 0) return [];
  const out = new Array<number>(vectors[0].length).fill(0);
  for (const vector of vectors) for (let i = 0; i < out.length; i += 1) out[i] += vector[i];
  const norm = Math.sqrt(out.reduce((sum, value) => sum + value * value, 0));
  return norm ? out.map((value) => value / norm) : out;
}

export type Cluster = { seed: number; members: number[] };

/**
 * 많이 겹치는 질문부터 묶는다(가까운 질문 수가 가장 많은 것 → 그 이웃을 빼고 다시). 묶음마다 이웃 수 내림차순.
 * 표본이 1,500줄이면 계산 약 110만 쌍 — 서버에서 1~2초.
 */
export function greedyClusters(
  vectors: ReadonlyArray<readonly number[]>,
  options: { maxDistance: number; minSize: number; max: number },
): Cluster[] {
  const n = vectors.length;
  const minSim = 1 - options.maxDistance;
  // 길이를 한 번만 맞춰 두고(단위 벡터) 안쪽 곱만 — 쌍마다 길이를 다시 재지 않는다.
  const units = vectors.map((vector) => {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm ? vector.map((value) => value / norm) : vector.map(() => 0);
  });
  const dim = units[0]?.length ?? 0;
  const dot = (a: readonly number[], b: readonly number[]) => {
    if (a.length !== dim || b.length !== dim) return 0;
    let sum = 0;
    for (let k = 0; k < dim; k += 1) sum += a[k] * b[k];
    return sum;
  };
  const neighbors: number[][] = Array.from({ length: n }, (_, i) => [i]);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (dot(units[i], units[j]) >= minSim) {
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }
  const taken = new Array<boolean>(n).fill(false);
  const clusters: Cluster[] = [];
  while (clusters.length < options.max) {
    let best = -1;
    let bestSize = 0;
    for (let i = 0; i < n; i += 1) {
      if (taken[i]) continue;
      const size = neighbors[i].filter((j) => !taken[j]).length;
      if (size > bestSize) {
        best = i;
        bestSize = size;
      }
    }
    if (best < 0 || bestSize < options.minSize) break;
    const members = neighbors[best].filter((j) => !taken[j]);
    for (const j of members) taken[j] = true;
    clusters.push({ seed: best, members });
  }
  return clusters;
}

/** 넣은 · 뺀 묶음 가운데 중 하나와 충분히 가까우면 같은 묶음(다시 띄우지 않는다). */
export function isRemembered(centroid: readonly number[], remembered: ReadonlyArray<readonly number[]>, minSimilarity: number): boolean {
  return remembered.some((other) => cosineOf(centroid, other) >= minSimilarity);
}

// ── 건물 칸 값 ────────────────────────────────────────────────────────────────

export function normalizeValue(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.,!?。、！？・·'"「」『』()（）]/g, "");
}

/** 값 지문 — 세 언어 중 있는 것을 정규화해 묶는다(언어 하나만 같아도 같은 값으로 본다). */
export function valueHashesOf(value: Partial<Localized>): string[] {
  return GUEST_LANGS.flatMap((lang) => {
    const hash = normalizeValue(value[lang] ?? "");
    return hash ? [`${lang}:${hash}`] : [];
  });
}

/** 근거 답장 하나 — 세기는 답장 id 로(같은 시각 다른 답장은 따로 센다). */
export type SupportRef = { id: string; at: string };
export type RawOption = { value: Localized; support: readonly SupportRef[] };
export type CandidateOption = { value: Localized; count: number; firstAt: string; lastAt: string };

/**
 * 모델이 낸 값 후보 + 근거 답장 → 화면 후보. **마지막으로 쓴 날이 늦은 값이 앞**(최신이 이긴다), 같으면 건수 많은 쪽.
 * 근거가 `minOptionSupport` 안 되는 값은 버리고, 같은 값(지문)끼리는 합친다.
 */
export function mergeOptions(raw: readonly RawOption[], rules: { minOptionSupport: number; maxOptions: number } = CANDIDATE_RULES): CandidateOption[] {
  const merged: Array<{ value: Localized; refs: Map<string, string>; hashes: string[] }> = [];
  for (const option of raw) {
    const hashes = valueHashesOf(option.value);
    if (hashes.length === 0) continue;
    let same = merged.find((item) => item.hashes.some((hash) => hashes.includes(hash)));
    if (same) {
      for (const hash of hashes) if (!same.hashes.includes(hash)) same.hashes.push(hash);
    } else {
      same = { value: option.value, refs: new Map(), hashes };
      merged.push(same);
    }
    for (const ref of option.support) if (ref.id && Number.isFinite(Date.parse(ref.at))) same.refs.set(ref.id, ref.at);
  }
  return merged
    .map((item) => {
      const ats = [...item.refs.values()].sort();
      return { value: item.value, count: item.refs.size, firstAt: ats[0] ?? "", lastAt: ats[ats.length - 1] ?? "" };
    })
    .filter((option) => option.count >= rules.minOptionSupport)
    .sort((a, b) => (a.lastAt === b.lastAt ? b.count - a.count : a.lastAt < b.lastAt ? 1 : -1))
    .slice(0, rules.maxOptions);
}

// ── 글 ────────────────────────────────────────────────────────────────────────

/** 근거 줄 언어 표시용 — 한글이면 ko, 가나면 ja, 아니면 en. */
export function detectLang(text: string): GuestLang {
  if (/[가-힣]/.test(text)) return "ko";
  if (/[぀-ヿ]/.test(text)) return "ja";
  return "en";
}

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

/** 본문에 모르는 `{변수}` 가 있으면 false — 아는 변수(정해 둔 문구 변수)만 쓴다. */
export function onlyKnownPlaceholders(text: string): boolean {
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    if (!(SAVED_REPLY_VARIABLES as readonly string[]).includes(match[1])) return false;
  }
  return true;
}

function localizedOf(raw: unknown, max: number): Localized | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const out = { ko: "", ja: "", en: "" } as Localized;
  for (const lang of GUEST_LANGS) {
    const value = record[lang];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (Array.from(trimmed).length > max) return null;
    out[lang] = trimmed;
  }
  return out;
}

export type SavedReplyDraft = { index: number; skip: boolean; title: Localized; question: Localized; body: Localized; note: Localized };

/** 문구 후보 모델 출력 확인 — 모양이 틀린 묶음은 버린다(본문 세 언어 모두 있어야). */
export function validateSavedReplyOutput(raw: unknown, clusterCount: number): SavedReplyDraft[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { candidates?: unknown }).candidates;
  if (!Array.isArray(items)) return [];
  const out: SavedReplyDraft[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const index = record.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= clusterCount || seen.has(index)) continue;
    seen.add(index);
    if (record.skip === true) {
      out.push({ index, skip: true, title: { ko: "", ja: "", en: "" }, question: { ko: "", ja: "", en: "" }, body: { ko: "", ja: "", en: "" }, note: { ko: "", ja: "", en: "" } });
      continue;
    }
    const title = localizedOf(record.title, SAVED_REPLY_LIMITS.title);
    const question = localizedOf(record.question, 200);
    const body = localizedOf(record.body, SAVED_REPLY_LIMITS.body);
    const note = localizedOf(record.note ?? { ko: "", ja: "", en: "" }, 200);
    if (!title || !question || !body || !note) continue;
    if (GUEST_LANGS.some((lang) => !title[lang] || !body[lang])) continue;
    if (GUEST_LANGS.some((lang) => !onlyKnownPlaceholders(body[lang]))) continue;
    out.push({ index, skip: false, title, question, body, note });
  }
  return out;
}

export type FieldDraft = { field: CandidateField; options: Array<{ value: Localized; support: number[] }> };

/** 건물 칸 모델 출력 확인 — 아는 칸만, 근거 번호는 주어진 답장 안에서만. */
export function validateGuestInfoOutput(raw: unknown, replyCount: number, allowed: readonly CandidateField[]): FieldDraft[] {
  if (!raw || typeof raw !== "object") return [];
  const fields = (raw as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  const out: FieldDraft[] = [];
  for (const item of fields) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (!isCandidateField(record.field) || !allowed.includes(record.field) || out.some((f) => f.field === record.field)) continue;
    if (!Array.isArray(record.options)) continue;
    const max = record.field === "checkIn" || record.field === "checkOut" ? GUEST_INFO_LIMITS.short : GUEST_INFO_LIMITS.text;
    const options: FieldDraft["options"] = [];
    for (const option of record.options) {
      if (!option || typeof option !== "object") continue;
      const value = localizedOf((option as Record<string, unknown>).value, max);
      const support = (option as Record<string, unknown>).support;
      if (!value || GUEST_LANGS.some((lang) => !value[lang]) || !Array.isArray(support)) continue;
      const refs = [...new Set(support.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < replyCount))];
      options.push({ value, support: refs });
    }
    out.push({ field: record.field, options });
  }
  return out;
}

/** 근거 줄 하나의 모양(저장 · 화면 공용). 글은 가린 뒤. */
export type CandidateEvidence = { at: string; property: string | null; lang: GuestLang; text: string };
