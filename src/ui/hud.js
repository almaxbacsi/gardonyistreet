import { OSM, wayPoints, buildingFootprints, project } from '../world/geo.js';
import { PLAY } from '../world/layout.js';

export class Hud {
  constructor() {
    this.addr = document.getElementById('addr');
    this.toast = document.getElementById('toast');
    this.fps = document.getElementById('fps');
    this.map = document.getElementById('minimap');
    this.ctx = this.map.getContext('2d');
    this.roads = OSM.w.filter((w) => w.k === 'h').map((w) => ({ pts: wayPoints(w), main: w.n === 'Gárdonyi Géza utca', path: w.v === 'path' }));
    this.buildings = buildingFootprints().map((b) => b.pts);
    this.addrs = OSM.addr;
    this.frames = 0; this.acc = 0;
    this.toastT = 0;
  }

  /** tool hotbar at the bottom centre; index -1 = empty hands */
  setHotbar(labels, index) {
    let el = document.getElementById('hotbar');
    if (!el) { el = document.createElement('div'); el.id = 'hotbar'; document.getElementById('hud').appendChild(el); }
    el.innerHTML = [['0', 'Empty hands'], ...labels.map((l, i) => [String(i + 1), l])]
      .map(([k, l], i) => `<div class="slot${i - 1 === index ? ' on' : ''}"><b>${k}</b>${l}</div>`).join('');
  }

  showToast(text, secs = 2.5) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastT = secs;
  }

  update(dt, player) {
    // fps
    this.frames++; this.acc += dt;
    if (this.acc > 0.5) { this.fps.textContent = Math.round(this.frames / this.acc) + ' FPS'; this.frames = 0; this.acc = 0; }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toast.classList.remove('show'); }

    const x = player.pos.x, y = -player.pos.z;
    // nearest address on this street side
    let best = null, bd = 1e9;
    for (const [street, num, ax, ay] of this.addrs) {
      const d = Math.hypot(ax - x, ay - y);
      if (d < bd) { bd = d; best = `${street} ${num}.`; }
    }
    const p = project(x, y);
    this.addr.innerHTML = `<b>Piliscsaba, ${bd < 30 ? best : 'Gárdonyi Géza utca'}</b><span>${Math.max(0, p.s).toFixed(0)} m from Szent István király útja</span>`;
    if (player.hitBoundary && this.toastT <= 0) this.showToast(p.s > PLAY.sMax - 1 ? 'No Street View imagery beyond this point – the walkable area ends here' : 'You can\'t go any further this way');

    this.drawMap(x, y, player.yaw, player.facing);
  }

  drawMap(px, py, yaw, facing) {
    const c = this.ctx, S = this.map.width, sc = 1.6;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(48,62,38,0.85)'; c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.rotate(yaw); // camera-up map
    const T = (x, y) => [(x - px) * sc, -(y - py) * sc];
    c.fillStyle = '#c9b9a0'; c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1;
    for (const b of this.buildings) {
      c.beginPath();
      b.forEach((p, i) => { const [X, Y] = T(p[0], p[1]); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
      c.closePath(); c.fill(); c.stroke();
    }
    for (const r of this.roads) {
      c.strokeStyle = r.main ? '#f1ece0' : r.path ? 'rgba(220,200,160,0.6)' : '#b8b2a4';
      c.lineWidth = r.main ? 5 : r.path ? 1.5 : 4;
      c.setLineDash(r.path ? [3, 3] : []);
      c.beginPath();
      r.pts.forEach((p, i) => { const [X, Y] = T(p[0], p[1]); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
      c.stroke();
    }
    c.setLineDash([]);
    // player arrow
    c.rotate(-yaw);
    c.rotate(-(facing) + Math.PI + 0);
    c.restore();
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(yaw - facing + Math.PI);
    c.fillStyle = '#ff6a3d'; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 6); c.lineTo(0, 3); c.lineTo(-6, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // north marker
    c.save(); c.translate(S / 2, S / 2); c.rotate(yaw);
    c.fillStyle = '#fff'; c.font = 'bold 11px system-ui'; c.textAlign = 'center';
    c.fillText('N', 0, -S / 2 + 14);
    c.restore();
  }
}
