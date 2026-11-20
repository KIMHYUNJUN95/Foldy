/**
 * 손님 이름 검색 사례표 — JS(`matchesGuestName` · `normalizeGuestText`)와 DB(`guest_search_normalize` · `guest_name_search_key`,
 * 202611200002)가 **같은 표**로 검사된다. 한쪽 규칙만 바꾸면 다른 쪽 테스트가 깨진다(47 §5-10 「이름 판정은 한 규칙」).
 *
 * - `guest-search.test.ts` — JS 판정이 `expected` 와 같은가.
 * - `guest-message-search-sql.test.ts` — DB 정리 결과가 JS 와 글자까지 같은가, DB 이름 판정이 JS 참을 하나도 빠뜨리지 않는가(PGlite).
 */

export type GuestNameCase = { label: string; query: string; name: string; expected: boolean };

export const GUEST_NAME_CASES: readonly GuestNameCase[] = [
  { label: "성만", query: "kim", name: "Kim Minsu", expected: true },
  { label: "이름만", query: "minsu", name: "Kim Minsu", expected: true },
  { label: "앞 3글자", query: "kim", name: "Kimura Taro", expected: true },
  { label: "가운데 일부", query: "mur", name: "Kimura Taro", expected: true },
  { label: "순서 바꿈 · 띄어 씀", query: "minsu kim", name: "Kim Minsu", expected: true },
  { label: "순서 바꿈 · 붙여 씀", query: "minsukim", name: "Kim Minsu", expected: true },
  { label: "붙여 씀", query: "kimminsu", name: "Kim Minsu", expected: true },
  { label: "세 단어 붙여 씀 · 다른 순서", query: "minsukimlee", name: "Lee Kim Minsu", expected: true },
  { label: "붙여 씀이 단어 경계에 걸침", query: "akim", name: "Minsuka Kim", expected: true },
  { label: "대문자", query: "KIM MIN SU", name: "Kim Minsu", expected: true },
  { label: "악센트(이름 쪽)", query: "jose", name: "José García", expected: true },
  { label: "악센트(성 쪽)", query: "garcia", name: "José García", expected: true },
  { label: "악센트(검색어 쪽)", query: "José", name: "Jose Garcia", expected: true },
  { label: "기호 — 작은따옴표", query: "obrien", name: "O'Brien Pat", expected: true },
  { label: "기호 — 하이픈", query: "jeanluc", name: "Jean-Luc Picard", expected: true },
  { label: "기호 — 점", query: "j r", name: "J.R. Smith", expected: true },
  { label: "전각(이름 쪽)", query: "sol", name: "ＳＯＬ　ＬＥＥ", expected: true },
  { label: "전각(검색어 쪽)", query: "ＳＯＬ　ＬＥＥ", name: "SOL LEE", expected: true },
  { label: "악센트 없는 비라틴 대소문자", query: "øyvind", name: "ØYVIND HANSEN", expected: true },
  { label: "한글 2글자 — 성+이름 앞", query: "김민", name: "김민수", expected: true },
  { label: "한글 2글자 — 이름만", query: "민수", name: "김 민수", expected: true },
  { label: "한글 — 순서 바꿔 붙여 씀", query: "민수김", name: "김 민수", expected: true },
  { label: "한글 — 경계 걸침", query: "수김", name: "김 민수", expected: true },
  { label: "가나(히라가나)", query: "たろう", name: "やまだ たろう", expected: true },
  { label: "가나 2글자", query: "タロ", name: "ヤマダ タロウ", expected: true },
  { label: "반각 가나", query: "ﾀﾛｳ", name: "ヤマダ タロウ", expected: true },
  { label: "한자 2글자", query: "山田", name: "山田 太郎", expected: true },
  { label: "그리스 끝 시그마(이름 대문자)", query: "οδυσσευσ", name: "ΟΔΥΣΣΕΥΣ ΠΑΠΑΣ", expected: true },
  { label: "그리스 끝 시그마(검색어 끝 글자)", query: "παπας", name: "ΠΑΠΑΣ ΝΙΚΟΣ", expected: true },
  { label: "긴 이름(붙인 글자 40자 넘음) — 거꾸로는 찾는다", query: "wolfeschlegelmaximiliano", name: "Alexandrina Konstantinopoulos Maximiliano Wolfeschlegel", expected: true },
  { label: "긴 이름(붙인 글자 40자 넘음) — 섞은 순서는 안 본다", query: "wolfeschlegelalexandrina", name: "Alexandrina Konstantinopoulos Maximiliano Wolfeschlegel", expected: false },
  { label: "다른 사람", query: "kim", name: "Park Jisoo", expected: false },
  { label: "성은 맞고 이름은 다름", query: "minsu park", name: "Kim Minsu", expected: false },
  { label: "글자는 다 있지만 이어지지 않음", query: "kmu", name: "Kim Minsu", expected: false },
  { label: "한글 다른 사람", query: "민수", name: "박지수", expected: false },
  { label: "보조 평면 글자(「𠮷」)를 포함한 2글자", query: "𠮷田", name: "𠮷田 太郎", expected: true },
  { label: "보조 평면 글자 — 순서 바꿔 붙임", query: "太郎𠮷田", name: "𠮷田 太郎", expected: true },
];

/** 정리(normalize) 결과가 JS 와 DB 에서 같아야 하는 글 — 이름 · 검색어 양쪽에 쓰인다. */
export const NORMALIZE_SAMPLES: readonly string[] = [
  ...new Set(GUEST_NAME_CASES.flatMap((c) => [c.query, c.name])),
  "  Kim   Minsu  ",
  "Ｍａｒｉｅ－Ｃｌａｉｒｅ",
  "Zoë (Zoe) D’Angelo",
  "Ångström_Ölund/Test",
  "François·Dupont",
  "中村・花子",
  "ＡＢＣ ＤＥＦ",
  "Line Break",
  "Tab\tName",
  "Ñuñez Çelik",
  "ΟΔΥΣΣΕΥΣ Οδυσσεύς ς σ Σ",
  `${"Ａbc ".repeat(60)}끝`, // 정리 전 200글자에서 자른다(앞 200글자만)
  "",
];
