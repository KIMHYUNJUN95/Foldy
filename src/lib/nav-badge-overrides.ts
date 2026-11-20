/**
 * 메뉴 숫자 고쳐 쓰기 (2026-11-20, 손님 메시지 — docs/product/47 §5-9).
 *
 * 메뉴 숫자는 서버 렌더(관리자 레이아웃 · 모바일 페이지)가 준다. 손님 메시지 쓰기가 `revalidatePath` 를 그만 부르면서
 * 서버 렌더가 다시 오지 않으므로, 화면이 서버 액션으로 읽은 더 새 숫자(`navAwaitingCount`)를 여기에 알린다.
 * 어느 쪽이 새것인지는 번호 순서로 정한다 — 서버 숫자 묶음(객체)은 처음 그려진 때 번호를 받고, 알린 숫자는 **그 읽기를 시작한 때** 번호를 받는다
 * (`begin()` — 응답이 온 때가 아니다. 서버 렌더보다 먼저 시작한 읽기가 늦게 와서 더 새 서버 숫자를 덮지 않게).
 * 같은 객체가 다시 그려지면(라우터 캐시로 돌아온 옛 목록) 옛 번호 그대로라 그 뒤에 시작한 읽기가 이긴다. 새 서버 렌더는 새 객체라 이긴다.
 * React 를 모른다 — 훅은 `src/components/shared/nav-badge-overrides.ts`.
 */

export type NavBadges = Partial<Record<string, number>>;
export type NavBadgeOverride = { count: number; at: number };
export type NavBadgeOverrideMap = ReadonlyMap<string, NavBadgeOverride>;

/** 서버 숫자에 더 새 알림만 덮는다. `serverAt` 이 없으면(아직 번호를 못 받은 새 묶음) 서버 것이 새것. 바뀐 것이 없으면 같은 객체. */
export function mergeNavBadges(server: NavBadges, serverAt: number | undefined, overrides: NavBadgeOverrideMap): NavBadges {
  if (serverAt === undefined || overrides.size === 0) return server;
  let out = server;
  for (const [id, override] of overrides) {
    if (override.at <= serverAt) continue;
    if ((out[id] ?? 0) === override.count) continue;
    out = { ...out, [id]: override.count };
  }
  return out;
}

function sameBadges(a: NavBadges, b: NavBadges): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** `mergeNavBadges` + 앞 결과 기억 — 덮은 숫자가 있어도 내용이 같으면 앞의 객체(메뉴 · 탭바가 렌더마다 다시 돌지 않게). */
export function createNavBadgeMerger() {
  let last: NavBadges | null = null;
  return (server: NavBadges, serverAt: number | undefined, overrides: NavBadgeOverrideMap): NavBadges => {
    const next = mergeNavBadges(server, serverAt, overrides);
    if (next !== server && last && sameBadges(last, next)) return last;
    last = next;
    return next;
  };
}

export function createNavBadgeOverrideStore() {
  let clock = 0;
  let overrides: NavBadgeOverrideMap = new Map();
  const stamps = new WeakMap<object, number>();
  const listeners = new Set<() => void>();
  return {
    /** 읽기를 시작한다 — 이 번호를 `report` 에 넘긴다. */
    begin(): number {
      return ++clock;
    },
    /** 서버 액션으로 읽은 숫자. 이미 더 나중에 시작한 읽기가 알렸으면 버린다. 같은 값이어도 번호는 올린다(옛 묶음을 이기게). */
    report(id: string, count: number, at: number) {
      if (!Number.isFinite(count) || count < 0) return;
      if ((overrides.get(id)?.at ?? 0) >= at) return;
      const next = new Map(overrides);
      next.set(id, { count, at });
      overrides = next;
      listeners.forEach((listener) => listener());
    },
    /** 서버 숫자 묶음을 처음 그렸다 — 한 번만 번호를 준다. */
    stamp(server: object) {
      if (!stamps.has(server)) stamps.set(server, ++clock);
    },
    stampOf(server: object): number | undefined {
      return stamps.get(server);
    },
    snapshot(): NavBadgeOverrideMap {
      return overrides;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
