import { project, toXY } from '../world/geo.js';
import { PLAY } from '../world/layout.js';

/** 2D collision world (data coordinates x east / y north). */
export class CollisionWorld {
  constructor() {
    this.segs = []; // [x1,y1,x2,y2,thickness]
    this.circles = []; // [x,y,r]
    this.cell = 8;
    this.grid = new Map();
  }
  addSegs(list, t = 0.08) { for (const s of list) this.segs.push([s[0], s[1], s[2], s[3], s[4] ?? t]); }
  addCircles(list) { for (const c of list) this.circles.push(c); }
  build() {
    const key = (i, j) => i * 73856093 ^ j * 19349663;
    const put = (i, j, item) => { const k = key(i, j); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(item); };
    for (const s of this.segs) {
      const x0 = Math.min(s[0], s[2]) - s[4], x1 = Math.max(s[0], s[2]) + s[4], y0 = Math.min(s[1], s[3]) - s[4], y1 = Math.max(s[1], s[3]) + s[4];
      for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) for (let j = Math.floor(y0 / this.cell); j <= Math.floor(y1 / this.cell); j++) put(i, j, { seg: s });
    }
    for (const c of this.circles) {
      for (let i = Math.floor((c[0] - c[2]) / this.cell); i <= Math.floor((c[0] + c[2]) / this.cell); i++) for (let j = Math.floor((c[1] - c[2]) / this.cell); j <= Math.floor((c[1] + c[2]) / this.cell); j++) put(i, j, { circle: c });
    }
    this._key = key;
  }
  near(x, y) {
    const i = Math.floor(x / this.cell), j = Math.floor(y / this.cell);
    const out = new Set();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = this.grid.get(this._key(i + a, j + b));
      if (l) for (const it of l) out.add(it);
    }
    return out;
  }
  /** Resolve a circle at (x,y) with radius r; returns [x, y, hitBoundary] */
  resolve(x, y, r) {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const it of this.near(x, y)) {
        if (it.seg) {
          const [ax, ay, bx, by, t] = it.seg;
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6;
          let u = ((x - ax) * dx + (y - ay) * dy) / l2; u = Math.max(0, Math.min(1, u));
          const cx = ax + u * dx, cy = ay + u * dy;
          const ex = x - cx, ey = y - cy, d = Math.hypot(ex, ey);
          const min = r + t;
          if (d < min) {
            const nx = d > 1e-6 ? ex / d : -dy / Math.sqrt(l2), ny = d > 1e-6 ? ey / d : dx / Math.sqrt(l2);
            x = cx + nx * min; y = cy + ny * min; moved = true;
          }
        } else {
          const [cx, cy, cr] = it.circle;
          const ex = x - cx, ey = y - cy, d = Math.hypot(ex, ey), min = r + cr;
          if (d < min && d > 1e-6) { x = cx + (ex / d) * min; y = cy + (ey / d) * min; moved = true; }
        }
      }
      if (!moved) break;
    }
    // playable corridor
    const p = project(x, y);
    let s = p.s, dd = p.d, hit = false;
    if (s < PLAY.sMin) { s = PLAY.sMin; hit = true; }
    if (s > PLAY.sMax) { s = PLAY.sMax; hit = true; }
    if (Math.abs(dd) > PLAY.dMax) { dd = Math.sign(dd) * PLAY.dMax; hit = true; }
    if (hit) [x, y] = toXY(s, dd);
    return [x, y, hit];
  }
}
