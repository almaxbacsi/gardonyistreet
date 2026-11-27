import * as THREE from 'three';
import { buildingFootprints, heightAt, polygonArea, project, rng } from './geo.js';
import { BUILDING_STYLES } from './layout.js';
import { GeoBuilder, Batcher } from './builder.js';

const STYLES = {
  terracotta: { wall: 'plaster', wallColor: 0xc9734f, wallH: 3.0, roof: 'metal', roofColor: 0x6d4a3d, pitch: 14, frame: 'brown', hip: false },
  brick: { wall: 'brick', wallH: 4.3, roof: 'tile', roofColor: 0x75402e, pitch: 40, frame: 'white', chimney: true, attic: true, rollers: true },
  cream: { wall: 'plaster', wallColor: 0xe6d8bc, wallH: 3.0, roof: 'tile', roofColor: 0xa24a31, pitch: 36, frame: 'white', hip: true, chimney: true, rollers: true },
  'cream-balcony': { wall: 'plaster', wallColor: 0xe6dfcd, wallH: 3.1, roof: 'tile', roofColor: 0x9b4632, pitch: 30, frame: 'white', porch: true, chimney: true },
  beige: { wall: 'plaster', wallColor: 0xd9c4a3, wallH: 3.1, roof: 'tile', roofColor: 0x4f3a2f, pitch: 48, frame: 'brown', attic: true },
  white: { wall: 'plaster', wallColor: 0xefede7, wallH: 3.0, roof: 'tile', roofColor: 0x4b5562, pitch: 45, frame: 'white', attic: true, rollers: true },
  chalet: { wall: 'wood', wallColor: 0x6a4630, wallH: 3.2, roof: 'tile', roofColor: 0x6b3a2a, pitch: 45, frame: 'white', attic: true },
  shed: { wall: 'wood', wallColor: 0x8b6b4b, wallH: 2.3, roof: 'metal', roofColor: 0x6c6f70, pitch: 10, frame: 'brown', noWindows: true },
};

function styleFor(centroid, area, R) {
  let best = null, bd = 1e9;
  for (const b of BUILDING_STYLES) {
    const d = Math.hypot(b.at[0] - centroid[0], b.at[1] - centroid[1]);
    if (d < bd) { bd = d; best = b; }
  }
  if (best && bd < 9) return STYLES[best.style];
  if (area < 30) return STYLES.shed;
  const keys = ['cream', 'beige', 'white', 'cream'];
  return STYLES[keys[Math.floor(R() * keys.length)]];
}

// --- templates ---------------------------------------------------------------
function windowTemplates(w = 1.1, h = 1.3) {
  const t = 0.07, dep = 0.09;
  const parts = [
    new THREE.BoxGeometry(w, t, dep).translate(0, h / 2 - t / 2, 0),
    new THREE.BoxGeometry(w, t, dep).translate(0, -h / 2 + t / 2, 0),
    new THREE.BoxGeometry(t, h, dep).translate(-w / 2 + t / 2, 0, 0),
    new THREE.BoxGeometry(t, h, dep).translate(w / 2 - t / 2, 0, 0),
    new THREE.BoxGeometry(t * 0.8, h - t, dep * 0.8).translate(0, 0, 0),
    new THREE.BoxGeometry(w + 0.12, 0.05, 0.22).translate(0, -h / 2 - 0.02, 0.07), // sill
  ];
  const glass = new THREE.PlaneGeometry(w - t, h - t).translate(0, 0, -0.01);
  return { frame: parts, glass };
}

function obb(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of pts) {
      const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-6) best = { area, ang, u0, u1, v0, v1 };
  }
  let { ang, u0, u1, v0, v1 } = best;
  // make e1 the long axis
  if (v1 - v0 > u1 - u0) {
    ang += Math.PI / 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    u0 = 1e9; u1 = -1e9; v0 = 1e9; v1 = -1e9;
    for (const p of pts) {
      const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
  }
  const c = Math.cos(ang), s = Math.sin(ang);
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return {
    e1: [c, s], e2: [-s, c], L: u1 - u0, W: v1 - v0,
    center: [cu * c - cv * s, cu * s + cv * c],
  };
}

const W3 = (x, y, h) => [x, h, -y];

const gutterMat = new THREE.MeshStandardMaterial({ color: 0x5b4334, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
function gutterGeo(len) {
  // half-round gutter: open cylinder segment
  const g = new THREE.CylinderGeometry(0.075, 0.075, len, 8, 1, true, Math.PI / 2, Math.PI);
  g.rotateZ(Math.PI / 2);
  return g;
}
function pipeGeo(a, b) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(0.045, 0.045, dir.length(), 8, 1, true);
  g.translate(0, dir.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}

export function buildBuildings(M) {
  const R = rng(77);
  const batch = new Batcher();
  const colliders = [];
  const info = [];
  const tpl = windowTemplates();
  const doorGeo = new THREE.BoxGeometry(1.0, 2.1, 0.08);
  const rollerGeo = new THREE.BoxGeometry(1.24, 0.2, 0.14);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);

  const matFor = (st) => {
    if (st.wall === 'brick') return ['brick', M.brick, 1];
    if (st.wall === 'wood') return ['wood:' + st.wallColor, M.woodPlank(st.wallColor), 1];
    return ['plaster:' + st.wallColor, M.plaster(st.wallColor), 3];
  };
  const roofMat = (st) => {
    const m = st.roof === 'metal' ? M.metalRoof(st.roofColor) : M.roof(st.roofColor);
    m.side = THREE.DoubleSide;
    return ['roof:' + st.roof + st.roofColor, m];
  };
  const fasciaMat = M.wood(0x6b4a33);
  const plinthMat = M.concrete;
  const frameMat = (st) => (st.frame === 'brown' ? M.frameBrown : M.frameWhite);

  const placeOnWall = (key, mat, geo, px, py, h, nx, ny, out = 0.0) => {
    const ang = Math.atan2(nx, -ny); // local +Z -> world normal (nx, 0, -ny)
    q.setFromAxisAngle(up, ang);
    m4.compose(new THREE.Vector3(px + nx * out, h, -(py + ny * out)), q, sc);
    batch.addTransformed(key, mat, geo, m4);
  };

  for (const fp of buildingFootprints()) {
    let pts = fp.pts.map((p) => [p[0], p[1]]);
    if (pts.length < 3) continue;
    const area = polygonArea(pts);
    if (area < 0) pts.reverse();
    const absA = Math.abs(area);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const st = styleFor([cx, cy], absA, R);
    let gMin = 1e9, gMax = -1e9;
    for (const p of [...pts, [cx, cy]]) { const h = heightAt(p[0], p[1]); gMin = Math.min(gMin, h); gMax = Math.max(gMax, h); }
    const floor = gMax + (st === STYLES.shed ? 0.08 : 0.35);
    const top = floor + st.wallH;
    const [wKey, wMat, wScale] = matFor(st);
    const walls = new GeoBuilder(), plinth = new GeoBuilder();

    // street direction for the door
    const pr = project(cx, cy);
    const toStreet = [-Math.sign(pr.d) * 1, 0];
    // convert lateral direction to data vector: perpendicular to street
    let doorEdge = -1, doorScore = -2;
    let perim = 0;
    const edges = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const nx = dy / len, ny = -dx / len;
      const want = [nx, 0, -ny];
      const u0 = perim / wScale, u1 = (perim + len) / wScale;
      walls.quad(W3(a[0], a[1], floor), W3(b[0], b[1], floor), W3(b[0], b[1], top), W3(a[0], a[1], top),
        [u0, 0], [u1, 0], [u1, st.wallH / wScale], [u0, st.wallH / wScale], want);
      plinth.quad(W3(a[0], a[1], gMin - 0.6), W3(b[0], b[1], gMin - 0.6), W3(b[0], b[1], floor), W3(a[0], a[1], floor),
        [u0, 0], [u1, 0], [u1, (floor - gMin + 0.6) / 3], [u0, (floor - gMin + 0.6) / 3], want);
      perim += len;
      // street-facing score: compare normal to vector towards the street centre
      const sp = project(a[0] + dx / 2, a[1] + dy / 2);
      const p2 = project(a[0] + dx / 2 + nx, a[1] + dy / 2 + ny);
      const score = (Math.abs(sp.d) - Math.abs(p2.d)) * Math.min(1, len / 3);
      if (score > doorScore) { doorScore = score; doorEdge = edges.length; }
      edges.push({ a, b, len, nx, ny });
      colliders.push([a[0], a[1], b[0], b[1]]);
    }
    batch.add(wKey, wMat, walls.build());
    batch.add('plinth', plinthMat, plinth.build());

    // ---- roof (on oriented bounding box)
    const o = obb(pts);
    const [rKey, rMat] = roofMat(st);
    const pitch = (st.pitch * Math.PI) / 180, tp = Math.tan(pitch);
    const ov = st === STYLES.shed ? 0.25 : 0.55;
    const hl = o.L / 2, hw = o.W / 2;
    const rise = hw * tp;
    const ridgeH = top + rise;
    const P = (al, ac, h) => W3(o.center[0] + o.e1[0] * al + o.e2[0] * ac, o.center[1] + o.e1[1] * al + o.e2[1] * ac, h);
    const eaveH = top - ov * tp;
    const roof = new GeoBuilder();
    const slopeLen = (hw + ov) / Math.cos(pitch);
    const hipped = st.hip && o.L > o.W * 1.05;
    const rl = hipped ? hl - hw : hl + ov * 0.8; // ridge half length
    for (const side of [-1, 1]) {
      const n3 = (() => { const nx = o.e2[0] * side * Math.sin(pitch), ny = o.e2[1] * side * Math.sin(pitch); return [nx, Math.cos(pitch), -ny]; })();
      const eL = hipped ? hl + ov : hl + ov * 0.8;
      roof.quad(P(-rl, 0, ridgeH), P(rl, 0, ridgeH), P(eL, side * (hw + ov), eaveH), P(-eL, side * (hw + ov), eaveH),
        [-rl, 0], [rl, 0], [eL, slopeLen], [-eL, slopeLen], n3);
    }
    if (hipped) {
      for (const end of [-1, 1]) {
        const n3 = [o.e1[0] * end * Math.sin(pitch), Math.cos(pitch), -o.e1[1] * end * Math.sin(pitch)];
        roof.tri(P(end * rl, 0, ridgeH), P(end * (hl + ov), -(hw + ov), eaveH), P(end * (hl + ov), hw + ov, eaveH),
          [0, 0], [-(hw + ov), slopeLen], [hw + ov, slopeLen], n3);
      }
    } else {
      // gable triangles (wall material)
      const gab = new GeoBuilder();
      for (const end of [-1, 1]) {
        const n3 = [o.e1[0] * end, 0, -o.e1[1] * end];
        gab.tri(P(end * hl, -hw, top), P(end * hl, hw, top), P(end * hl, 0, ridgeH), [0, 0], [o.W / wScale, 0], [hw / wScale, rise / wScale], n3);
      }
      batch.add(wKey, wMat, gab.build());
    }
    batch.add(rKey, rMat, roof.build());
    // fascia boards along eaves
    const fas = new GeoBuilder();
    for (const side of [-1, 1]) {
      const eL = hipped ? hl + ov : hl + ov * 0.8;
      const n3 = [o.e2[0] * side, 0, -o.e2[1] * side];
      fas.quad(P(-eL, side * (hw + ov), eaveH - 0.2), P(eL, side * (hw + ov), eaveH - 0.2), P(eL, side * (hw + ov), eaveH), P(-eL, side * (hw + ov), eaveH), [0, 0], [1, 0], [1, 0.1], [0, 0.1], n3);
    }
    if (!hipped) for (const end of [-1, 1]) {
      const n3 = [o.e1[0] * end, 0, -o.e1[1] * end];
      const x = end * (hl + ov * 0.8);
      for (const side of [-1, 1]) {
        fas.quad(P(x, 0, ridgeH + 0.02), P(x, side * (hw + ov), eaveH + 0.02), P(x, side * (hw + ov), eaveH - 0.2), P(x, 0, ridgeH - 0.2), [0, 0], [1, 0], [1, 0.1], [0, 0.1], n3);
      }
    }
    batch.add('fascia', fasciaMat, fas.build());

    // gutters + downpipes
    if (st !== STYLES.shed) {
      const eL = hipped ? hl + ov : hl + ov * 0.8;
      const rotG = Math.atan2(o.e1[1], o.e1[0]);
      for (const side of [-1, 1]) {
        const c3 = P(0, side * (hw + ov + 0.06), eaveH - 0.16);
        q.setFromAxisAngle(up, rotG);
        m4.compose(new THREE.Vector3(...c3), q, sc);
        batch.addTransformed('gutter', gutterMat, gutterGeo(eL * 2), m4);
        for (const end of [-1, 1]) {
          const al = end * (Math.min(hl, eL) - 0.25);
          const g0 = P(al, side * (hw + ov + 0.06), eaveH - 0.2);
          const g1 = P(al, side * (hw + 0.1), eaveH - 0.6);
          const gx = o.center[0] + o.e1[0] * al + o.e2[0] * side * (hw + 0.1), gy = o.center[1] + o.e1[1] * al + o.e2[1] * side * (hw + 0.1);
          const g2 = [g1[0], heightAt(gx, gy) - 0.1, g1[2]];
          batch.add('gutter', gutterMat, pipeGeo(g0, g1));
          batch.add('gutter', gutterMat, pipeGeo(g1, g2));
        }
      }
    }

    // chimney
    if (st.chimney && o.L > 6) {
      const al = o.L * 0.22, ac = o.W * 0.12;
      const surf = top + rise - Math.abs(ac) * tp;
      const H = Math.max(1.4, ridgeH + 0.7 - (surf - 0.5));
      const ch = new THREE.BoxGeometry(0.55, H, 0.55);
      const c3 = P(al, ac, surf - 0.5 + H / 2);
      m4.compose(new THREE.Vector3(...c3), q.setFromAxisAngle(up, Math.atan2(o.e1[1], o.e1[0])), sc);
      batch.addTransformed(st.wall === 'brick' ? 'brick' : wKey, st.wall === 'brick' ? M.brick : wMat, ch, m4);
      const cap = new THREE.BoxGeometry(0.75, 0.08, 0.75);
      m4.compose(new THREE.Vector3(c3[0], surf - 0.5 + H + 0.04, c3[2]), q, sc);
      batch.addTransformed('plinth', plinthMat, cap, m4);
    }

    // ---- windows & door
    if (!st.noWindows) {
      const fKey = 'frame:' + st.frame, fMat = frameMat(st);
      edges.forEach((e, ei) => {
        if (e.len < 1.8) return;
        const k = Math.max(1, Math.floor((e.len - 0.6) / 2.7));
        const doorSlot = ei === doorEdge ? Math.floor(k / 2) : -1;
        for (let j = 0; j < k; j++) {
          const t = (j + 0.5) / k;
          const px = e.a[0] + (e.b[0] - e.a[0]) * t, py = e.a[1] + (e.b[1] - e.a[1]) * t;
          if (j === doorSlot) {
            placeOnWall('door', M.frameBrown, doorGeo, px, py, floor + 1.05, e.nx, e.ny, 0.03);
            continue;
          }
          const h = floor + 1.55;
          for (const g of tpl.frame) placeOnWall(fKey, fMat, g, px, py, h, e.nx, e.ny, 0.05);
          placeOnWall('glass', M.glass, tpl.glass, px, py, h, e.nx, e.ny, 0.05);
          if (st.rollers) placeOnWall(fKey, fMat, rollerGeo, px, py, h + 0.76, e.nx, e.ny, 0.07);
          // attic windows on gable-end walls
          const along = Math.abs(e.nx * o.e1[0] + e.ny * o.e1[1]);
          if (st.attic && along > 0.8 && st.wallH > 3.6) {
            const ha = floor + 3.55;
            for (const g of tpl.frame) placeOnWall(fKey, fMat, g, px, py, ha, e.nx, e.ny, 0.05);
            placeOnWall('glass', M.glass, tpl.glass, px, py, ha, e.nx, e.ny, 0.05);
          }
        }
        // attic window in gable triangle for single storey houses
        const along = Math.abs(e.nx * o.e1[0] + e.ny * o.e1[1]);
        if (st.attic && st.wallH < 3.6 && along > 0.85 && !hipped && rise > 1.8 && e.len > 4) {
          const px = (e.a[0] + e.b[0]) / 2, py = (e.a[1] + e.b[1]) / 2;
          const ha = top + Math.min(1.0, rise * 0.35);
          const small = windowTemplates(0.8, 0.9);
          for (const g of small.frame) placeOnWall(fKey, fMat, g, px, py, ha, e.nx, e.ny, 0.05);
          placeOnWall('glass', M.glass, small.glass, px, py, ha, e.nx, e.ny, 0.05);
        }
      });
    }

    // ---- porch / terrace with railing (P3 NW house)
    if (st.porch && doorEdge >= 0) {
      const e = edges[doorEdge];
      const depth = 2.2;
      const deckH = floor + 0.05;
      const deck = new THREE.BoxGeometry(e.len, 0.15, depth);
      const mx = (e.a[0] + e.b[0]) / 2 + e.nx * depth / 2, my = (e.a[1] + e.b[1]) / 2 + e.ny * depth / 2;
      placeOnWall('wood:deck', M.wood(0x8a6a4c), deck, mx, my, deckH, e.nx, e.ny);
      const nPost = Math.max(2, Math.round(e.len / 2.5) + 1);
      const ex = e.b[0] - e.a[0], ey = e.b[1] - e.a[1];
      for (let k = 0; k < nPost; k++) {
        const t = k / (nPost - 1);
        const px = e.a[0] + ex * (0.03 + t * 0.94) + e.nx * (depth - 0.1), py = e.a[1] + ey * (0.03 + t * 0.94) + e.ny * (depth - 0.1);
        const gh = heightAt(px, py);
        const post = new THREE.BoxGeometry(0.14, top - gh, 0.14);
        placeOnWall('wood:deck', M.wood(0x8a6a4c), post, px, py, gh + (top - gh) / 2, e.nx, e.ny);
      }
      const beam = new THREE.BoxGeometry(e.len, 0.18, 0.16);
      placeOnWall('wood:deck', M.wood(0x8a6a4c), beam, mx + e.nx * (depth / 2 - 0.1), my + e.ny * (depth / 2 - 0.1), top - 0.09, e.nx, e.ny);
      const rail = new THREE.BoxGeometry(e.len, 0.08, 0.08);
      placeOnWall('wood:deck', M.wood(0x8a6a4c), rail, mx + e.nx * (depth / 2 - 0.1), my + e.ny * (depth / 2 - 0.1), deckH + 1.0, e.nx, e.ny);
      const nb = Math.floor(e.len / 0.15);
      const bal = new THREE.BoxGeometry(0.04, 0.95, 0.04);
      for (let k = 0; k < nb; k++) {
        const t = (k + 0.5) / nb;
        placeOnWall('wood:deck', M.wood(0x8a6a4c), bal, e.a[0] + ex * t + e.nx * (depth - 0.1), e.a[1] + ey * t + e.ny * (depth - 0.1), deckH + 0.55, e.nx, e.ny);
      }
      // porch roof (shed roof) attached under main eave
      const pr2 = new THREE.BoxGeometry(e.len + 0.4, 0.08, depth + 0.3);
      placeOnWall(rKey, rMat, pr2, mx, my, top + 0.05, e.nx, e.ny);
    }

    info.push({ pts, floor, top, style: st, addr: fp.addr });
  }
  const group = batch.toGroup();
  group.name = 'buildings';
  return { group, colliders, info };
}

export { STYLES };
