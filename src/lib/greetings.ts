// 상황별 인사말(2026-10-15 사용자 확정) — 로그인 제목 · 모바일 홈 인사 · PC 대시보드 제목.
// 완전 랜덤이 아니라 「시간대 · 근무 상태 · 요일 · 날짜」로 묶음을 고르고, 그 안에서 랜덤.
// 고르는 건 브라우저에서(`GreetingLine`) — 세션(앱에 들어올 때)마다 한 번, 직전 문구는 빼고.
// 문구는 ko · ja · en 을 함께 둔다(여기가 인사말의 i18n 원본). `{name}` 은 이름 자리.
import type { Locale } from "@/lib/i18n";

export type GreetingSurface = "login" | "home" | "admin";
export type GreetingWork = "working" | "done" | "none";

type Pool =
  | "loginAlways" | "loginMorning" | "loginDay" | "loginEvening" | "loginAway"
  | "beforeMorning" | "beforeNeutral" | "workMorning" | "lunch" | "afternoon" | "workEvening"
  | "afterWork" | "afterWorkEve" | "eveningRest" | "dawn"
  | "monday" | "friday" | "weekend" | "monthStart" | "monthEnd" | "newYear" | "yearEnd"
  | "adminMorning" | "adminDay" | "adminEvening" | "adminMonday" | "adminMonthEnd";

const ko: Record<Pool, string[]> = {
  loginAlways: ["다시 오신 걸 환영해요", "오늘도 반가워요", "기다리고 있었어요", "어서 오세요", "다시 만나서 반가워요", "오늘 하루도 함께해요", "로그인하고 시작해요"],
  loginMorning: ["좋은 아침이에요", "상쾌한 아침이에요", "오늘도 힘차게 시작해요", "아침부터 반가워요"],
  loginDay: ["좋은 오후예요", "오후도 함께해요", "반가워요, 오후도 힘내요"],
  loginEvening: ["좋은 저녁이에요", "늦은 시간까지 고생 많아요", "밤에도 반가워요", "오늘 하루 어땠어요?"],
  loginAway: ["오랜만이에요", "정말 오랜만이에요, 반가워요", "다시 와 주셔서 고마워요"],
  beforeMorning: ["좋은 아침이에요, {name} 님", "{name} 님, 상쾌한 하루 보내요", "새로운 하루예요, {name} 님"],
  beforeNeutral: ["{name} 님, 오늘도 잘 부탁해요", "오늘도 반가워요, {name} 님", "오늘 하루도 함께해요, {name} 님", "{name} 님, 준비되셨나요?"],
  workMorning: ["{name} 님, 오전도 힘내요", "순조롭게 가고 있어요, {name} 님", "{name} 님, 오늘도 든든해요", "좋은 흐름이에요, {name} 님"],
  lunch: ["{name} 님, 점심은 드셨어요?", "잠깐 쉬어 가도 괜찮아요", "{name} 님, 맛있는 점심 드세요", "벌써 반이나 왔어요, {name} 님"],
  afternoon: ["{name} 님, 오후도 힘내요", "조금만 더 힘내요, {name} 님", "{name} 님, 오늘도 잘하고 있어요", "물 한 잔 마시고 가요, {name} 님", "{name} 님 덕분에 잘 돌아가요"],
  workEvening: ["늦게까지 고생 많아요, {name} 님", "{name} 님, 마무리까지 파이팅", "거의 다 왔어요, {name} 님", "{name} 님, 오늘도 정말 수고 많아요"],
  afterWork: ["오늘도 수고했어요, {name} 님", "{name} 님, 푹 쉬세요", "고생 많았어요, {name} 님", "오늘 하루도 고마워요, {name} 님", "내일 또 만나요, {name} 님"],
  afterWorkEve: ["{name} 님, 편안한 저녁 보내요"],
  eveningRest: ["좋은 저녁이에요, {name} 님", "{name} 님, 편안한 저녁 보내요", "오늘 하루 어땠어요, {name} 님?"],
  dawn: ["이른 시간이에요, {name} 님", "{name} 님, 무리하지 마세요", "조용한 새벽이에요, {name} 님"],
  monday: ["{name} 님, 이번 주도 잘 부탁해요", "한 주의 시작이에요, {name} 님", "월요일도 반가워요, {name} 님"],
  friday: ["금요일이에요, {name} 님", "{name} 님, 이번 주도 고생 많았어요", "주말이 코앞이에요, {name} 님"],
  weekend: ["주말에도 고생 많아요, {name} 님", "{name} 님, 즐거운 주말 보내요"],
  monthStart: ["새로운 달이에요, {name} 님", "{name} 님, 이번 달도 잘 부탁해요"],
  monthEnd: ["이번 달도 거의 다 왔어요, {name} 님", "{name} 님, 한 달 동안 고생 많았어요"],
  newYear: ["새해 복 많이 받으세요, {name} 님", "올해도 잘 부탁해요, {name} 님"],
  yearEnd: ["올 한 해 고생 많았어요, {name} 님", "{name} 님, 따뜻한 연말 보내요"],
  adminMorning: ["좋은 아침이에요, {name} 님", "{name} 님, 오늘 현장을 살펴볼까요?", "오늘도 잘 부탁해요, {name} 님"],
  adminDay: ["{name} 님, 오후도 순조로워요", "좋은 오후예요, {name} 님", "오늘 흐름을 한눈에 보세요, {name} 님"],
  adminEvening: ["늦게까지 고생 많아요, {name} 님", "{name} 님, 오늘 하루를 정리해 볼까요?", "오늘도 수고 많았어요, {name} 님"],
  adminMonday: ["이번 주도 잘 부탁해요, {name} 님", "{name} 님, 이번 주 흐름을 확인해 보세요"],
  adminMonthEnd: ["월말이에요, 급여 마감을 확인해 보세요"],
};

const ja: Record<Pool, string[]> = {
  loginAlways: ["おかえりなさい", "今日もお会いできてうれしいです", "お待ちしていました", "ようこそ", "また会えてうれしいです", "今日も一日よろしくお願いします", "ログインして始めましょう"],
  loginMorning: ["おはようございます", "さわやかな朝ですね", "今日も元気にスタートしましょう", "朝からお会いできてうれしいです"],
  loginDay: ["こんにちは", "午後もよろしくお願いします", "午後もがんばりましょう"],
  loginEvening: ["こんばんは", "遅くまでお疲れさまです", "夜もお会いできてうれしいです", "今日はどんな一日でしたか?"],
  loginAway: ["お久しぶりです", "本当にお久しぶりです", "また来てくださってありがとうございます"],
  beforeMorning: ["おはようございます、{name}さん", "{name}さん、さわやかな一日を", "新しい一日ですね、{name}さん"],
  beforeNeutral: ["{name}さん、今日もよろしくお願いします", "今日もお会いできてうれしいです、{name}さん", "今日も一緒にがんばりましょう、{name}さん", "{name}さん、準備はいいですか?"],
  workMorning: ["{name}さん、午前もがんばりましょう", "順調に進んでいますね、{name}さん", "{name}さん、今日も頼もしいです", "いい流れですね、{name}さん"],
  lunch: ["{name}さん、お昼は食べましたか?", "少し休んでも大丈夫ですよ", "{name}さん、おいしいお昼を", "折り返し地点です、{name}さん"],
  afternoon: ["{name}さん、午後もがんばりましょう", "もう少しです、{name}さん", "{name}さん、今日もいい調子です", "お水を一杯どうぞ、{name}さん", "{name}さんのおかげで順調です"],
  workEvening: ["遅くまでお疲れさまです、{name}さん", "{name}さん、最後までがんばりましょう", "もう少しで終わりです、{name}さん", "{name}さん、今日も本当にお疲れさまです"],
  afterWork: ["今日もお疲れさまでした、{name}さん", "{name}さん、ゆっくり休んでください", "お疲れさまでした、{name}さん", "今日もありがとうございました、{name}さん", "また明日、{name}さん"],
  afterWorkEve: ["{name}さん、穏やかな夜を"],
  eveningRest: ["こんばんは、{name}さん", "{name}さん、穏やかな夜を", "今日はどんな一日でしたか、{name}さん?"],
  dawn: ["早い時間ですね、{name}さん", "{name}さん、無理しないでくださいね", "静かな明け方ですね、{name}さん"],
  monday: ["{name}さん、今週もよろしくお願いします", "新しい一週間の始まりです、{name}さん", "月曜日もお会いできてうれしいです、{name}さん"],
  friday: ["金曜日ですね、{name}さん", "{name}さん、今週もお疲れさまでした", "週末はもうすぐです、{name}さん"],
  weekend: ["週末もお疲れさまです、{name}さん", "{name}さん、楽しい週末を"],
  monthStart: ["新しい月ですね、{name}さん", "{name}さん、今月もよろしくお願いします"],
  monthEnd: ["今月もあと少しです、{name}さん", "{name}さん、今月もお疲れさまでした"],
  newYear: ["あけましておめでとうございます、{name}さん", "今年もよろしくお願いします、{name}さん"],
  yearEnd: ["今年一年お疲れさまでした、{name}さん", "{name}さん、よいお年を"],
  adminMorning: ["おはようございます、{name}さん", "{name}さん、今日の現場を見てみましょう", "今日もよろしくお願いします、{name}さん"],
  adminDay: ["{name}さん、午後も順調です", "こんにちは、{name}さん", "今日の流れをひと目で、{name}さん"],
  adminEvening: ["遅くまでお疲れさまです、{name}さん", "{name}さん、今日一日を振り返りましょう", "今日もお疲れさまでした、{name}さん"],
  adminMonday: ["今週もよろしくお願いします、{name}さん", "{name}さん、今週の流れを確認しましょう"],
  adminMonthEnd: ["月末です。給与の締めを確認しましょう"],
};

const en: Record<Pool, string[]> = {
  loginAlways: ["Welcome back", "Good to see you again", "We've been expecting you", "Come on in", "Nice to see you again", "Let's make today a good one", "Sign in to get started"],
  loginMorning: ["Good morning", "What a fresh morning", "Let's start the day strong", "Nice to see you this early"],
  loginDay: ["Good afternoon", "Here for the afternoon too", "Hello — keep it up this afternoon"],
  loginEvening: ["Good evening", "Thanks for working late", "Nice to see you tonight", "How was your day?"],
  loginAway: ["It's been a while", "Long time no see — welcome back", "Thanks for coming back"],
  beforeMorning: ["Good morning, {name}", "Have a fresh day, {name}", "A brand-new day, {name}"],
  beforeNeutral: ["Counting on you today, {name}", "Good to see you, {name}", "Let's do today together, {name}", "Ready to go, {name}?"],
  workMorning: ["Keep it up this morning, {name}", "Things are going smoothly, {name}", "Glad you're here, {name}", "Great momentum, {name}"],
  lunch: ["Had lunch yet, {name}?", "It's okay to take a short break", "Enjoy your lunch, {name}", "Halfway there, {name}"],
  afternoon: ["Keep going this afternoon, {name}", "Just a little more, {name}", "You're doing great today, {name}", "Grab a glass of water, {name}", "Things run well thanks to you, {name}"],
  workEvening: ["Thanks for staying late, {name}", "Finish strong, {name}", "Almost there, {name}", "You've worked hard today, {name}"],
  afterWork: ["Great work today, {name}", "Get some good rest, {name}", "Thanks for all your effort, {name}", "Thank you for today, {name}", "See you tomorrow, {name}"],
  afterWorkEve: ["Have a relaxing evening, {name}"],
  eveningRest: ["Good evening, {name}", "Have a relaxing evening, {name}", "How was your day, {name}?"],
  dawn: ["It's early, {name}", "Don't push yourself too hard, {name}", "A quiet early morning, {name}"],
  monday: ["Counting on you this week, {name}", "A new week begins, {name}", "Happy Monday, {name}"],
  friday: ["It's Friday, {name}", "Great work this week, {name}", "The weekend is almost here, {name}"],
  weekend: ["Thanks for working the weekend, {name}", "Have a nice weekend, {name}"],
  monthStart: ["A new month begins, {name}", "Counting on you this month, {name}"],
  monthEnd: ["The month is almost over, {name}", "Great work this month, {name}"],
  newYear: ["Happy New Year, {name}", "Looking forward to this year with you, {name}"],
  yearEnd: ["Thanks for all your work this year, {name}", "Have a warm year-end, {name}"],
  adminMorning: ["Good morning, {name}", "Shall we check on today's sites, {name}?", "Counting on you today, {name}"],
  adminDay: ["The afternoon is running smoothly, {name}", "Good afternoon, {name}", "Today at a glance, {name}"],
  adminEvening: ["Thanks for staying late, {name}", "Shall we wrap up today, {name}?", "Great work today, {name}"],
  adminMonday: ["Counting on you this week, {name}", "Check this week's flow, {name}"],
  adminMonthEnd: ["It's month-end — check payroll closing"],
};

export const GREETING_CATALOG: Record<Locale, Record<Pool, string[]>> = { ko, ja, en };

export type GreetingClock = { hour: number; weekday: number; day: number; month: number; lastDay: number };

/** 지금 도쿄 시각(시 · 요일 0=일 · 일 · 월 · 그 달 마지막 날). */
export function tokyoGreetingClock(now: Date = new Date()): GreetingClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", hourCycle: "h23", hour: "numeric", weekday: "short", day: "numeric", month: "numeric", year: "numeric",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  return {
    hour: Number(get("hour")) % 24,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    day: Number(get("day")),
    month,
    lastDay: new Date(Date.UTC(year, month, 0)).getUTCDate(),
  };
}

export type GreetingPick = {
  /** 기본 묶음 키 — 바뀌면(출근함 · 저녁이 됨) 세션 안에서도 다시 고른다. */
  baseKey: string;
  base: string[];
  /** 가끔 섞는 묶음(날짜 · 요일)과 그 확률. */
  extras: { pool: string[]; chance: number }[];
};

/** 상황 → 고를 묶음. 이름이 없으면 이름 없는 로그인 묶음으로. */
export function greetingPools(
  surface: GreetingSurface,
  locale: Locale,
  clock: GreetingClock,
  opts: { work?: GreetingWork; away?: boolean; named: boolean },
): GreetingPick {
  const c = GREETING_CATALOG[locale] ?? GREETING_CATALOG.ko;
  const { hour, weekday, day, month, lastDay } = clock;
  const tod = hour >= 5 && hour < 11 ? "morning" : hour >= 11 && hour < 17 ? "day" : "evening";

  if (surface === "login" || !opts.named) {
    if (opts.away && surface === "login") return { baseKey: "away", base: c.loginAway, extras: [] };
    const timed = tod === "morning" ? c.loginMorning : tod === "day" ? c.loginDay : c.loginEvening;
    return { baseKey: `login-${tod}`, base: [...timed, ...c.loginAlways], extras: [] };
  }

  const extras: GreetingPick["extras"] = [];
  const monthEnd = day > lastDay - 3;
  if (surface === "admin") {
    if (monthEnd) extras.push({ pool: c.adminMonthEnd, chance: 0.35 });
    if (weekday === 1) extras.push({ pool: c.adminMonday, chance: 0.3 });
    const base = tod === "morning" ? c.adminMorning : tod === "day" ? c.adminDay : c.adminEvening;
    return { baseKey: `admin-${tod}`, base, extras };
  }

  // 모바일 홈
  if (month === 1 && day <= 3) extras.push({ pool: c.newYear, chance: 0.6 });
  else if (month === 12 && day >= 25) extras.push({ pool: c.yearEnd, chance: 0.6 });
  else if (day <= 3) extras.push({ pool: c.monthStart, chance: 0.35 });
  else if (monthEnd) extras.push({ pool: c.monthEnd, chance: 0.35 });
  if (weekday === 1) extras.push({ pool: c.monday, chance: 0.3 });
  else if (weekday === 5) extras.push({ pool: c.friday, chance: 0.3 });
  else if (weekday === 0 || weekday === 6) extras.push({ pool: c.weekend, chance: 0.3 });

  const work = opts.work ?? "none";
  if (hour < 5) return { baseKey: `home-dawn-${work}`, base: c.dawn, extras };
  if (work === "working") {
    if (hour < 11) return { baseKey: "home-work-am", base: c.workMorning, extras };
    if (hour < 14) return { baseKey: "home-work-lunch", base: c.lunch, extras };
    if (hour < 17) return { baseKey: "home-work-pm", base: c.afternoon, extras };
    return { baseKey: "home-work-eve", base: c.workEvening, extras };
  }
  if (work === "done") {
    return hour >= 17
      ? { baseKey: "home-done-eve", base: [...c.afterWork, ...c.afterWorkEve], extras }
      : { baseKey: "home-done", base: c.afterWork, extras };
  }
  if (hour >= 17) return { baseKey: "home-rest-eve", base: c.eveningRest, extras };
  return hour < 11
    ? { baseKey: "home-before-am", base: [...c.beforeMorning, ...c.beforeNeutral], extras }
    : { baseKey: "home-before", base: c.beforeNeutral, extras };
}
