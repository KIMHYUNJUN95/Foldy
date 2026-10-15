"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { decideMapIntro } from "./map-intro";
import { geoToMap, SHINJUKU_GEO as G } from "./shinjuku-geo";
import "./building-map.css";

/**
 * 예약 캘린더 건물 지도(2026-10-15, 시안 Motion-D-Map-Phone).
 *
 * 실제 신주쿠구 경계 위에 우리 건물을 하얀 블록으로 세운다. 지도는 두께 있는 모형 판처럼 비스듬히 눕고(회전 -14° ·
 * 세로 0.62), 카메라(확대 · 이동)는 지도 판에만 걸린다. 건물 블록 · 이름표 · 역 표시는 화면 좌표에 따로 그려서 확대해도
 * 크기가 그대로다(진짜 지도의 표식처럼). 둘은 같은 시간 · 같은 곡선으로 움직이므로 위치가 어긋나지 않는다 —
 * 점의 화면 위치는 카메라 (이동, 배율)에 대해 1차식이라 둘 다 같은 진행률로 보간되면 정확히 같이 간다.
 *
 * 누름: 겹친 건물 이름표 → 갈라질 만큼 다가감 · 건물 하나 → 고름(보라 · 이름표에 「달력 보기」) → 한 번 더 → 그 건물 달력.
 * 더 다가가도 안 갈라지는 건물(같은 자리 오쿠보 A·B)은 이름표가 세로 목록으로 펼쳐진다. 빈 곳 → 처음 화면.
 * 처음 그리는 장면(경계선 → 판이 눕고 → 건물이 솟음)은 탭(세션)마다 한 번만, 그 뒤엔 짧게.
 */

export type MapBuilding = { id: string; label: string; rooms: number; empty: number; lat: number; lng: number };
export type BuildingMapCopy = {
  mapAria: string;
  emptyN: string;
  full: string;
  roomsN: string;
  open: string;
  more: string;
  reset: string;
  stationShinjuku: string;
  stationYotsuya: string;
};

const ROT = -14;
const KY = 0.62;
const RAD = (ROT * Math.PI) / 180;
const COS = Math.cos(RAD);
const SIN = Math.sin(RAD);
const MAX_ZOOM = 9;
const CHIP_H = 28;

type Vec = [number, number];
type Cam = { s: number; tx: number; ty: number };

/** 판 좌표 차이 → 눕힌 뒤 차이(배율 1). */
function lay(dx: number, dy: number): Vec {
  return [dx * COS - dy * SIN, (dx * SIN + dy * COS) * KY];
}

const STATIONS: Array<{ key: "stationShinjuku" | "stationYotsuya"; lng: number; lat: number; dx: number; dy: number; anchor: "end" | "start" }> = [
  { key: "stationShinjuku", lng: 139.7006, lat: 35.6896, dx: -8, dy: 4, anchor: "end" },
  { key: "stationYotsuya", lng: 139.7302, lat: 35.686, dx: 8, dy: 12, anchor: "start" },
];

let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, size: number) {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  }
  if (!measureCtx) return text.length * size * 0.62;
  measureCtx.font = `600 ${size}px Geist, "Noto Sans KR", system-ui, sans-serif`;
  return measureCtx.measureText(text).width;
}

/** 같은 앞부분을 묶어 짧게: 아라키초A · 아라키초B → 아라키초A·B */
function compactLabel(labels: string[], more: string) {
  if (labels.length === 1) return labels[0];
  let prefix = labels[0];
  for (const l of labels) {
    while (prefix && !l.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const rests = labels.map((l) => l.slice(prefix.length).trim());
  if (prefix.trim().length >= 2 && rests.every((r) => r.length > 0 && r.length <= 3)) return `${prefix.trimEnd()}${rests.join("·")}`;
  return more.replace("{name}", labels[0]).replace("{n}", String(labels.length - 1));
}

export function BuildingMap({
  buildings,
  copy,
  selectedId,
  onSelect,
  onOpen,
}: {
  buildings: MapBuilding[];
  copy: BuildingMapCopy;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Vec>([0, 0]);
  const [cam, setCam] = useState<Cam>({ s: 1, tx: 0, ty: 0 });
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const [intro, setIntro] = useState<boolean | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((prev) => (Math.abs(prev[0] - width) < 1 && Math.abs(prev[1] - height) < 1 ? prev : [width, height]));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 처음 그리는 긴 장면은 세션마다 한 번 · 움직임 줄이기면 없음.
  useEffect(() => {
    // 첫 칠하기 전에 정해야 깜빡임이 없다 — 마운트 직후 한 번만(결정은 모듈에 기억 — 개발 모드 이중 실행에도 같은 값).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIntro(decideMapIntro());
  }, []);

  const [W, H] = size;

  // ── 배치: 건물들이 화면 가운데에 꽉 차게(눕힌 판 기준) · 처음 장면은 구 전체를 평평하게
  const layout = useMemo(() => {
    if (!W || !H) return null;
    const pts = buildings.map((b) => geoToMap(b.lng, b.lat));
    const F: Vec = pts.length
      ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
      : [G.box[0] / 2, G.box[1] / 2];
    const C: Vec = [W / 2, H * 0.52];
    const laid = pts.map((p) => lay(p[0] - F[0], p[1] - F[1]));
    const xs = laid.map((p) => p[0]);
    const ys = laid.map((p) => p[1]);
    const spanX = Math.max(1, Math.max(...xs, 0) - Math.min(...xs, 0));
    const spanY = Math.max(1, Math.max(...ys, 0) - Math.min(...ys, 0));
    const marginX = Math.min(150, Math.max(70, W * 0.3));
    const s = Math.min(Math.max(1.1, Math.min((W - marginX) / spanX, (H - 210) / spanY)), 6);
    const world = (p: Vec): Vec => {
      const v = lay(p[0] - F[0], p[1] - F[1]);
      return [C[0] + v[0] * s, C[1] + v[1] * s];
    };
    const s0 = Math.min((W * 0.9) / G.box[0], (H * 0.86) / G.box[1]);
    const flat = `translate(${W / 2}px, ${H / 2}px) scale(${s0}) scaleY(1) rotate(0deg) translate(${-G.box[0] / 2}px, ${-G.box[1] / 2}px)`;
    const tilt = `translate(${C[0]}px, ${C[1]}px) scale(${s}) scaleY(${KY}) rotate(${ROT}deg) translate(${-F[0]}px, ${-F[1]}px)`;
    // 화면에서 「똑바로 아래」 d px 이 되는 판 좌표 벡터(두께 · 바닥 그림자)
    const down = (d: number): Vec => {
      const w = d / (s * KY);
      return [w * SIN, w * COS];
    };
    return { F, C, s, world, flat, tilt, down };
  }, [W, H, buildings]);

  // ── 건물 블록 모양(화면 px · 확대와 무관)
  const shapes = useMemo(() => {
    return buildings.map((b) => {
      const h = 5.5 + Math.min(b.rooms, 26) * 0.24;
      const Hh = 14 + Math.min(b.rooms, 30) * 1.8;
      const base: Vec[] = [lay(-h, -h), lay(h, -h), lay(h, h), lay(-h, h)];
      const faces: Array<{ side: "l" | "r"; pts: string; floors: string[] }> = [];
      const floorsN = Math.max(2, Math.floor(Hh / 6.5));
      for (let j = 0; j < 4; j++) {
        const p1 = base[j];
        const p2 = base[(j + 1) % 4];
        if ((p1[1] + p2[1]) / 2 <= 0) continue;
        const floors: string[] = [];
        for (let f = 1; f < floorsN; f++) {
          const yy = (f * Hh) / floorsN;
          floors.push(`M${p1[0].toFixed(1)} ${(p1[1] - yy).toFixed(1)}L${p2[0].toFixed(1)} ${(p2[1] - yy).toFixed(1)}`);
        }
        faces.push({
          side: (p1[0] + p2[0]) / 2 < 0 ? "l" : "r",
          pts: `${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)} ${p2[0].toFixed(1)},${(p2[1] - Hh).toFixed(1)} ${p1[0].toFixed(1)},${(p1[1] - Hh).toFixed(1)}`,
          floors,
        });
      }
      const top = base.map((p) => [p[0], p[1] - Hh] as Vec);
      const rim = top
        .map((p, j) => [p, top[(j + 1) % 4]] as const)
        .filter(([a, c]) => (a[1] + c[1]) / 2 > -Hh)
        .map(([a, c]) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}`)
        .join("");
      return { id: b.id, h, H: Hh, faces, top: top.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "), rim };
    });
  }, [buildings]);

  const worldOf = useMemo(() => {
    const m = new Map<string, Vec>();
    if (!layout) return m;
    for (const b of buildings) m.set(b.id, layout.world(geoToMap(b.lng, b.lat)));
    return m;
  }, [layout, buildings]);
  const heightOf = useMemo(() => new Map(shapes.map((s) => [s.id, s.H])), [shapes]);
  const byId = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);

  const screen = (w: Vec, c: Cam = cam): Vec => [c.tx + w[0] * c.s, c.ty + w[1] * c.s];

  // ── 블록 벌리기(2026-10-15 사용자 결정 「모든 건물이 다 보이게」): 실제 자리끼리 너무 가까우면(오쿠보 · 가부키초 ·
  // STAY ARI 는 300 m 안, 오쿠보A · B 는 같은 집) 블록만 서로 안 겹칠 만큼 밀어 놓는다. 같은 동네(이름 끝 A/B/C 를 뗀
  // 이름)는 바짝 붙여 한 단지처럼, 다른 동네끼리만 조금 더 띄운다 — 그래서 블록이 거의 제자리라 실제 자리 표시(점 · 선)는
  // 두지 않는다(2026-10-15 사용자 결정). 지금 카메라 기준으로 계산하므로 다가가면 블록이 실제 자리로 모인다.
  const spread = useMemo(() => {
    const m = new Map<string, Vec>();
    if (!layout) return m;
    const ids = buildings.map((b) => b.id).filter((id) => worldOf.has(id));
    const truth = ids.map((id) => screen(worldOf.get(id)!));
    const pos = truth.map((p) => [p[0], p[1]] as Vec);
    const foot = ids.map((id) => (shapes.find((x) => x.id === id)?.h ?? 8) * 2.5);
    const hood = ids.map((id) => id.replace(/[A-Z]$/, ""));
    const ys = 0.6; // 블록은 세로로 길어서 옆으로 나란히 떼는 게 잘 보인다(세로 차이는 덜 쳐 줌)
    const push = () => {
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const sep = (foot[i] + foot[j]) / 2 + (hood[i] === hood[j] ? 2 : 14);
          let dx = pos[j][0] - pos[i][0];
          let dy = (pos[j][1] - pos[i][1]) * ys;
          let d = Math.hypot(dx, dy);
          if (d >= sep) continue;
          if (d < 0.01) {
            const a = (i * 2.399 + j * 1.3) % (Math.PI * 2);
            dx = Math.cos(a);
            dy = Math.sin(a) * 0.4;
            d = Math.hypot(dx, dy);
          }
          const k = (sep - d) / 2 / d;
          pos[i][0] -= dx * k;
          pos[i][1] -= (dy * k) / ys;
          pos[j][0] += dx * k;
          pos[j][1] += (dy * k) / ys;
        }
      }
    };
    for (let it = 0; it < 90; it++) {
      push();
      for (let i = 0; i < pos.length; i++) {
        pos[i][0] += (truth[i][0] - pos[i][0]) * 0.05;
        pos[i][1] += (truth[i][1] - pos[i][1]) * 0.05;
      }
    }
    for (let it = 0; it < 12; it++) push();
    ids.forEach((id, i) => m.set(id, pos[i]));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, cam, worldOf, buildings, shapes]);
  const posOf = (id: string): Vec => spread.get(id) ?? screen(worldOf.get(id)!);
  const badgeOf = (ids: string[]) => {
    const empty = ids.reduce((a, id) => a + (byId.get(id)?.empty ?? 0), 0);
    if (empty > 0) return { text: copy.emptyN.replace("{n}", String(empty)), vac: true };
    // 「만실」은 다가갔을 때만 — 처음 화면은 이름만(빈 방 있는 건물만 배지) 남겨 이름표가 덜 붐비게.
    if (ids.length === 1) return cam.s > 1.4 || ids[0] === selectedId ? { text: copy.full, vac: false } : null;
    return { text: copy.roomsN.replace("{n}", String(ids.reduce((a, id) => a + (byId.get(id)?.rooms ?? 0), 0))), vac: false };
  };
  const chipWidth = (label: string, badge: string, cta: boolean) =>
    Math.ceil(textWidth(label, 12) + textWidth(badge, 11) + 36 + (cta ? textWidth(copy.open, 11.5) + 34 : 0));

  // ── 이름표: 블록마다 하나, 겹치면 콜아웃처럼 옆 · 위 · 아래로 뺀다
  const clusters = useMemo(() => {
    if (!layout) return [] as Array<{ key: string; ids: string[]; x: number; y: number; lift: number; dx: number; by: number; w: number; label: string; badge: { text: string; vac: boolean } | null }>;
    type Cl = { ids: string[]; bx: number; by: number; top: number; compact?: boolean };
    const make = (ids: string[]): Cl => {
      const ps = ids.map((id) => posOf(id));
      return {
        ids,
        bx: ps.reduce((a, p) => a + p[0], 0) / ps.length,
        by: ps.reduce((a, p) => a + p[1], 0) / ps.length,
        top: Math.min(...ids.map((id, i) => ps[i][1] - (heightOf.get(id) ?? 20))),
      };
    };
    const labelOf = (ids: string[]) => compactLabel(ids.map((id) => byId.get(id)!.label), copy.more);
    const widthOf = (c: Cl) => chipWidth(labelOf(c.ids), c.compact ? "" : badgeOf(c.ids)?.text ?? "", c.ids.length === 1 && c.ids[0] === selectedId) - (c.compact ? 6 : 0);
    const list: Cl[] = buildings.filter((b) => b.id !== selectedId).map((b) => make([b.id]));
    if (selectedId && worldOf.has(selectedId)) list.push(make([selectedId]));
    // 이름표 자리: 위쪽 건물부터 놓고, 겹치면 위로 · 옆으로 빼서 비스듬한 지시선으로 잇는다(지도 콜아웃처럼).
    type Placed = { cl: Cl; lift: number; dx: number; r: [number, number, number, number] };
    const hit = (a: Placed["r"], b: Placed["r"]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const placed: Placed[] = [];
    const sorted = [...list].sort((a, b) => {
      const sa = a.ids.length === 1 && a.ids[0] === selectedId ? 1 : 0;
      const sb = b.ids.length === 1 && b.ids[0] === selectedId ? 1 : 0;
      return sb - sa || a.top - b.top;
    });
    // 다른 건물 블록을 가리지 않게 블록 자리도 장애물로
    const blocks = list.flatMap((c) =>
      c.ids.map((id) => {
        const p = posOf(id);
        return { owner: c, r: [p[0] - 13, p[1] - (heightOf.get(id) ?? 20) - 4, p[0] + 13, p[1] + 5] as Placed["r"] };
      }),
    );
    for (const cl of sorted) {
      // 겹치지 않는 자리 가운데 지시선이 가장 짧은 곳(위쪽을 조금 더 좋아함). 없으면 배지를 뺀 짧은 이름표로 다시,
      // 그래도 없으면 제자리에 둔다. 건물은 묶지 않는다 — 블록마다 이름표 하나.
      const pick = (w: number) => {
        const side = w / 2 + 16;
        const far = side + w / 2 + 12;
        const down = cl.top - 12 - (cl.by + 18 + CHIP_H);
        const tries: Vec[] = [
          [0, 0], [0, 34], [-side, 22], [side, 22], [0, 68], [-side, 56], [side, 56], [-far, 22], [far, 22],
          [0, down], [-side, down], [side, down], [-side, 90], [side, 90], [-far, 56], [far, 56], [0, down - 34], [-side, down - 34], [side, down - 34], [0, 102],
          [-far, down], [far, down], [-far, 90], [far, 90], [-far, down - 34], [far, down - 34], [0, down - 68], [-side, 124], [side, 124], [0, 136],
        ];
        let best: Placed | null = null;
        let bestCost = Infinity;
        for (const [dx, lift] of tries) {
          const y1 = cl.top - 12 - lift;
          const cx = cl.bx + dx;
          const r: Placed["r"] = [cx - w / 2 - 4, y1 - CHIP_H - 3, cx + w / 2 + 4, y1 + 3];
          if (r[0] < 4 || r[2] > W - 4 || r[1] < 6) continue;
          if (placed.some((p) => hit(p.r, r))) continue;
          if (blocks.some((b) => b.owner !== cl && hit(b.r, r))) continue;
          const cost = Math.hypot(dx, lift < 0 ? -lift * 1.25 : lift);
          if (cost < bestCost) {
            bestCost = cost;
            best = { cl, lift, dx, r };
          }
        }
        return { best };
      };
      let { best } = pick(widthOf(cl));
      if (!best) {
        cl.compact = true;
        ({ best } = pick(widthOf(cl)));
      }
      if (!best) {
        const w = widthOf(cl);
        const y1 = cl.top - 12;
        best = { cl, lift: 0, dx: 0, r: [cl.bx - w / 2 - 4, y1 - CHIP_H - 3, cl.bx + w / 2 + 4, y1 + 3] };
      }
      placed.push(best);
    }
    return placed.map(({ cl: c, lift, dx }) => ({
      key: c.ids.join("|"),
      ids: c.ids,
      x: c.bx,
      y: c.top,
      by: c.by,
      lift,
      dx,
      w: widthOf(c),
      label: labelOf(c.ids),
      badge: c.compact ? null : badgeOf(c.ids),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, cam, selectedId, worldOf, heightOf, byId, buildings, copy]);

  const baseCam: Cam = { s: 1, tx: 0, ty: 0 };
  const focusAt = (w: Vec, s: number) => {
    if (!layout) return;
    setCam({ s, tx: layout.C[0] - w[0] * s, ty: H * 0.54 - w[1] * s });
  };

  function reset() {
    setExpanded(null);
    onSelect(null);
    setCam(baseCam);
  }

  function pickCluster(ids: string[]) {
    if (ids.length === 1) return pickBuilding(ids[0]);
    if (!layout) return;
    const ws = ids.map((id) => worldOf.get(id)!);
    // 모든 짝이 이름표 하나 너비만큼(가로) 또는 이름표 높이만큼(세로) 떨어질 배율
    let need = cam.s;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const dx = Math.abs(ws[i][0] - ws[j][0]);
        const dy = Math.abs(ws[i][1] - ws[j][1]);
        const wi = chipWidth(byId.get(ids[i])!.label, badgeOf([ids[i]])?.text ?? "", false);
        const wj = chipWidth(byId.get(ids[j])!.label, badgeOf([ids[j]])?.text ?? "", false);
        const sx = dx > 0.01 ? ((wi + wj) / 2 + 10) / dx : Infinity;
        const sy = dy > 0.01 ? (CHIP_H + 26) / dy : Infinity;
        need = Math.max(need, Math.min(sx, sy));
      }
    }
    const center: Vec = [ws.reduce((a, p) => a + p[0], 0) / ws.length, ws.reduce((a, p) => a + p[1], 0) / ws.length];
    if (cam.s >= MAX_ZOOM * 0.98 || !Number.isFinite(need) || need > MAX_ZOOM * 1.02) {
      // 끝까지 다가가도 못 가르면(같은 자리) 이름표를 세로로 펼친다.
      focusAt(center, Math.min(MAX_ZOOM, Math.max(cam.s * 1.6, 3.2)));
      setExpanded(ids);
      return;
    }
    setExpanded(null);
    focusAt(center, Math.min(MAX_ZOOM, need * 1.08));
  }

  function pickBuilding(id: string) {
    if (selectedId === id) {
      onOpen(id);
      return;
    }
    setExpanded(null);
    onSelect(id);
    const w = worldOf.get(id);
    if (w) focusAt(w, Math.max(cam.s, 2.2));
  }

  // 목록에서 고른 건물이 바뀌면(바깥에서) 그 건물로
  const lastSel = useRef<string | null>(selectedId);
  useEffect(() => {
    if (lastSel.current === selectedId) return;
    lastSel.current = selectedId;
    if (!selectedId) return;
    const w = worldOf.get(selectedId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (w && layout) setCam({ s: Math.max(cam.s, 2.2), tx: layout.C[0] - w[0] * Math.max(cam.s, 2.2), ty: H * 0.54 - w[1] * Math.max(cam.s, 2.2) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const zoomed = cam.s > 1.01 || cam.tx !== 0 || cam.ty !== 0;
  const focusIds = expanded ?? (selectedId ? [selectedId] : null);
  const order = [...buildings].filter((b) => worldOf.has(b.id)).sort((a, b) => posOf(a.id)[1] - posOf(b.id)[1]);
  const riseDelay = (i: number) => (intro ? 2500 + i * 95 : 60 + i * 45);
  const ready = layout && intro !== null;

  const rootStyle = { "--bm-cam": `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})` } as CSSProperties;

  return (
    <div
      aria-label={copy.mapAria}
      className={`bm${intro ? " bm--intro" : ""}${focusIds ? " has-focus" : ""}`}
      ref={rootRef}
      role="group"
      style={rootStyle}
    >
      {ready ? (
        <>
          <button aria-label={copy.reset} className="bm-bg" onClick={reset} tabIndex={-1} type="button" />
          <div className="bm-cam" aria-hidden="true">
            <svg className="bm-plane" height={H} viewBox={`0 0 ${W} ${H}`} width={W}>
              <defs>
                <clipPath id={`${uid}c`}>
                  <path d={G.ward} />
                </clipPath>
                <linearGradient id={`${uid}s`} x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#FFFFFF" />
                  <stop offset=".55" stopColor="#F8F5FF" />
                  <stop offset="1" stopColor="#EEE7FE" />
                </linearGradient>
                <linearGradient id={`${uid}h`} x1="0" x2="1">
                  <stop offset="0" stopColor="#fff" stopOpacity="0" />
                  <stop offset=".5" stopColor="#fff" stopOpacity=".85" />
                  <stop offset="1" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <radialGradient cx="50%" cy="40%" id={`${uid}p`} r="70%">
                  <stop offset="0" stopColor="#E6F3EA" />
                  <stop offset="1" stopColor="#D6EBDD" />
                </radialGradient>
                <mask id={`${uid}m`}>
                  <circle className="bm-reveal" cx={layout.F[0]} cy={layout.F[1]} fill="#fff" r="420" style={{ transformOrigin: `${layout.F[0]}px ${layout.F[1]}px` }} />
                </mask>
              </defs>
              <g className="bm-g" style={{ "--bm-flat": layout.flat, "--bm-tilt": layout.tilt } as CSSProperties}>
                <path
                  className="bm-gshadow"
                  d={G.ward}
                  transform={`translate(${layout.down(26)[0].toFixed(2)} ${layout.down(26)[1].toFixed(2)})`}
                />
                <g className="bm-wall">
                  {Array.from({ length: 22 }, (_, k) => 22 - k).map((i) => {
                    const v = layout.down((11 * i) / 22);
                    const t = i / 22;
                    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
                    return <path d={G.ward} fill={`rgb(${mix(0xe4, 0xb9)},${mix(0xda, 0xa4)},${mix(0xfc, 0xf2)})`} key={i} transform={`translate(${v[0].toFixed(2)} ${v[1].toFixed(2)})`} />;
                  })}
                </g>
                <g className="bm-surf">
                  <path d={G.ward} fill={`url(#${uid}s)`} />
                  <g clipPath={`url(#${uid}c)`} fill="none" mask={`url(#${uid}m)`} strokeLinecap="round" strokeLinejoin="round">
                    <path d={G.park} fill={`url(#${uid}p)`} stroke="#CFE6D6" strokeWidth=".6" />
                    <path d={G.primary} stroke="#ECE5FC" strokeWidth=".8" />
                    <path d={G.trunk} stroke="#E3D9FB" strokeWidth="1.5" />
                    <path d={G.river} stroke="#CFE2F7" strokeWidth="2.6" />
                    <path d={G.river} stroke="#E6F0FB" strokeWidth="1" />
                    <g className="bm-rails">
                      <path d={G.seibu} stroke="#C9C3D8" strokeWidth="1.5" />
                      <path d={G.chuo} stroke="#B7AFCA" strokeWidth="1.8" />
                      <path d={G.yama} stroke="#B7AFCA" strokeWidth="1.8" />
                      <path d={`${G.chuo} ${G.yama} ${G.seibu}`} stroke="#fff" strokeDasharray="2.2 2.6" strokeWidth=".7" />
                    </g>
                    <rect className="bm-sheen" fill={`url(#${uid}h)`} height="480" width="72" x="-40" y="-70" />
                  </g>
                </g>
                <path className="bm-outline" d={G.ward} fill="none" pathLength={1} strokeDasharray="1 1" strokeLinejoin="round" />
                <path className="bm-ohead" d={G.ward} fill="none" pathLength={1} strokeDasharray=".03 1" strokeLinecap="round" />
              </g>
            </svg>
          </div>

          {/* 역(확대와 무관한 크기) */}
          <svg aria-hidden="true" className="bm-stations" height={H} viewBox={`0 0 ${W} ${H}`} width={W}>
            <defs>
              <linearGradient id={`${uid}b`} x1="0" x2="0" y1="1" y2="0">
                <stop offset="0" stopColor="#8A63F0" stopOpacity=".55" />
                <stop offset="1" stopColor="#8A63F0" stopOpacity="0" />
              </linearGradient>
            </defs>
            {STATIONS.map((st) => {
              const p = screen(layout.world(geoToMap(st.lng, st.lat)));
              return (
                <g className="bm-st" key={st.key} style={{ transform: `translate(${p[0]}px, ${p[1]}px)` }}>
                  <circle fill="#fff" r="2.7" stroke="#9E97B3" strokeWidth="1.3" />
                  <text dy={st.dy} textAnchor={st.anchor} x={st.dx}>
                    {copy[st.key]}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* 건물 블록 */}
          {order.map((b, i) => {
            const shape = shapes.find((s) => s.id === b.id)!;
            const p = posOf(b.id);
            const on = b.id === selectedId;
            const focus = focusIds?.includes(b.id) ?? false;
            const style = { transform: `translate3d(${p[0]}px, ${p[1]}px, 0)`, zIndex: 3 + i, "--d": `${riseDelay(i)}ms` } as CSSProperties;
            const badge = (badgeOf([b.id]) ?? { text: copy.full }).text;
            return (
              <div className={`bm-b${on ? " is-on" : ""}${focus ? " is-focus" : ""}${b.empty > 0 ? " is-vac" : ""}`} key={b.id} style={style}>
                <svg aria-hidden="true" className="bm-b__svg" height="1" width="1">
                  <ellipse className="bm-b__shadow" cx="7" cy="3" rx={shape.h * 2.4 + 5} ry={shape.h * 1.1 + 2.5} />
                  <ellipse className="bm-b__ripple" rx={shape.h * 2.2} ry={shape.h * 1.1} />
                  {b.empty > 0 ? <ellipse className="bm-b__ring" rx="13" ry="6.5" /> : null}
                  <g className="bm-b__g">
                    {shape.faces.map((f, k) => (
                      <polygon className={`bm-b__f${f.side}`} key={k} points={f.pts} />
                    ))}
                    <path className="bm-b__floor" d={shape.faces.flatMap((f) => f.floors).join("")} />
                    <polygon className="bm-b__ft" points={shape.top} />
                    <path className="bm-b__rim" d={shape.rim} />
                  </g>
                  {b.empty > 0 ? (
                    <g className="bm-b__beam" style={{ transform: `translateY(${-shape.H}px)` }}>
                      <rect fill={`url(#${uid}b)`} height="64" width="8" x="-4" y="-64" />
                      <rect fill={`url(#${uid}b)`} height="56" width="1.2" x="-.6" y="-56" />
                      <circle className="bm-b__dot" r="3.2" />
                    </g>
                  ) : null}
                </svg>
                <button
                  aria-label={`${b.label} · ${badge}`}
                  className="bm-b__hit"
                  onClick={(e) => {
                    e.stopPropagation();
                    pickBuilding(b.id);
                  }}
                  style={{ height: shape.H + 26, top: -shape.H - 16 }}
                  type="button"
                />
              </div>
            );
          })}

          {/* 지시선 — 지붕에서 이름표 아래 가장자리까지(옆으로 뺀 이름표는 비스듬히) */}
          {clusters.map((c, i) => {
            if (expanded && expanded.join("|") === c.key) return null;
            const left = Math.min(Math.max(c.x + c.dx - c.w / 2, 8), W - 8 - c.w);
            const chipBottom = c.y - 12 - c.lift;
            const below = chipBottom - CHIP_H > c.by;
            const sx = c.x;
            const sy = below ? c.by + 3 : c.y - 2;
            const ex = Math.min(Math.max(c.x, left + 14), left + c.w - 14);
            const ey = below ? chipBottom - CHIP_H : chipBottom;
            const len = Math.hypot(ex - sx, ey - sy);
            const ang = Math.atan2(ey - sy, ex - sx);
            return (
              <span
                aria-hidden="true"
                className={`bm-lead${focusIds && !c.ids.some((id) => focusIds.includes(id)) ? " is-dim" : ""}`}
                key={`lead-${c.key}`}
                style={{ transform: `translate3d(${sx}px, ${sy}px, 0) rotate(${ang}rad)`, width: len, "--d": `${(intro ? 2900 : 260) + i * 40}ms` } as CSSProperties}
              />
            );
          })}

          {/* 이름표 */}
          {clusters.map((c, i) => {
            const cta = c.ids.length === 1 && c.ids[0] === selectedId;
            const isOpen = expanded && expanded.join("|") === c.key;
            // 가장자리에선 이름표만 안쪽으로 밀고, 지시선은 건물을 그대로 가리킨다.
            const left = Math.min(Math.max(c.x + c.dx - c.w / 2, 8), W - 8 - c.w);
            const style = {
              transform: `translate3d(${left}px, ${c.y - 12 - c.lift - CHIP_H}px, 0)`,
              width: c.w,
              "--d": `${(intro ? 2900 : 260) + i * 40}ms`,
            } as CSSProperties;
            if (isOpen) {
              return (
                <div className="bm-stack" key={`${c.key}-open`} style={{ transform: `translate3d(${c.x}px, ${c.y - 12}px, 0)` }}>
                  {c.ids.map((id) => {
                    const b = byId.get(id)!;
                    const bd = badgeOf([id]) ?? { text: copy.full, vac: false };
                    return (
                      <button className="bm-chip is-row" key={id} onClick={() => onOpen(id)} type="button">
                        <b>{b.label}</b>
                        <em className={bd.vac ? "v" : undefined}>{bd.text}</em>
                        <ChevronRight aria-hidden="true" className="bm-chip__chev" />
                      </button>
                    );
                  })}
                </div>
              );
            }
            return (
              <button
                aria-label={[c.label, c.badge?.text, cta ? copy.open : null].filter(Boolean).join(" · ")}
                className={`bm-chip${cta ? " is-cta" : ""}${focusIds && !c.ids.some((id) => focusIds.includes(id)) ? " is-dim" : ""}`}
                key={c.key}
                onClick={(e) => {
                  e.stopPropagation();
                  if (cta) onOpen(c.ids[0]);
                  else pickCluster(c.ids);
                }}
                style={style}
                type="button"
              >
                <b>{c.label}</b>
                {c.badge ? <em className={c.badge.vac ? "v" : undefined}>{c.badge.text}</em> : null}
                {cta ? (
                  <i className="bm-chip__go">
                    {copy.open}
                    <ChevronRight aria-hidden="true" />
                  </i>
                ) : null}
              </button>
            );
          })}

          <div className="bm-tools">
            {zoomed ? (
              <button className="bm-reset" onClick={reset} type="button">
                {copy.reset}
              </button>
            ) : null}
            <span aria-hidden="true" className="bm-north">
              <svg height="16" viewBox="0 0 24 24" width="16">
                <path d="M12 3l4.5 14L12 14.5 7.5 17z" fill="#7A52E6" />
                <path d="M12 14.5L16.5 17 12 3z" fill="#5B2BD6" />
              </svg>
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
