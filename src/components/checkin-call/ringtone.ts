// 직원 통화 벨소리 — 파일 없이 웹 오디오로 합성한다(docs/product/46 §6).
// 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으므로 첫 입력에서 풀어 둔다. 막혀 있어도 화면은 뜨고 벨만 조용하다.

const CYCLE_MS = 2400;
const NOTES: readonly (readonly [frequency: number, startSeconds: number])[] = [
  [659.25, 0],
  [880, 0.22],
  [659.25, 0.62],
  [880, 0.84],
];
const NOTE_SECONDS = 0.34;
const PEAK_GAIN = 0.18;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** 사용자 탭 안에서 동기로 부른다 — iOS 는 `await` 뒤에는 탭으로 쳐 주지 않는다. */
export function unlockCallAudio(): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return Promise.resolve(false);
  if (ctx.state === "running") return Promise.resolve(true);
  return ctx.resume().then(
    () => ctx.state === "running",
    () => false,
  );
}

/** 첫 입력에서 AudioContext 를 풀어 둔다. 풀린 것을 확인한 뒤에만 리스너를 지운다 — 막히면 다음 입력에서 다시 시도한다. */
export function armRingtoneUnlock(): () => void {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const disarm = () => events.forEach((name) => window.removeEventListener(name, unlock, true));
  const unlock = () => {
    void unlockCallAudio().then((running) => {
      if (running) disarm();
    });
  };
  events.forEach((name) => window.addEventListener(name, unlock, true));
  return disarm;
}

function playCycle(ctx: AudioContext, output: AudioNode) {
  const base = ctx.currentTime + 0.02;
  for (const [frequency, start] of NOTES) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = base + start;
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS);
    oscillator.connect(gain).connect(output);
    oscillator.start(at);
    oscillator.stop(at + NOTE_SECONDS + 0.02);
  }
}

/** 벨 시작 — 멈추는 함수를 돌려준다. */
export function startRingtone(): () => void {
  const ctx = audioContext();
  if (!ctx) return () => undefined;
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const cycle = () => {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    // 막혀 있으면 currentTime 이 멈춰 있어 소리가 쌓인다 — 풀린 뒤 한꺼번에 나지 않게 건너뛴다.
    if (ctx.state === "running") playCycle(ctx, master);
  };
  cycle();
  const timer = window.setInterval(cycle, CYCLE_MS);
  return () => {
    window.clearInterval(timer);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    window.setTimeout(() => master.disconnect(), 120);
  };
}
