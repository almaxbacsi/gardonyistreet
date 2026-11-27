// Dev mode: floating labels with stable ids over every registered object.
//   F2 (or ?dev in the URL)  – toggle labels
//   I                        – identify the object under the crosshair (copied to clipboard)
//   console: __dev.list(), __dev.find('tree-31'), __dev.goto('house-G9')
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { allItems, findById } from './registry.js';
import { project } from '../world/geo.js';

const COLORS = { house: '#ffb74d', tree: '#81c784', hedge: '#aed581', fence: '#90caf9', pole: '#e0e0e0', car: '#f48fb1', road: '#fff176', paving: '#bcaaa4' };

export class DevMode {
  constructor({ scene, camera, player, hud }) {
    this.scene = scene; this.camera = camera; this.player = player; this.hud = hud;
    this.enabled = false;
    this.renderer = new CSS2DRenderer();
    this.renderer.setSize(innerWidth, innerHeight);
    Object.assign(this.renderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 5 });
    document.body.appendChild(this.renderer.domElement);
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.labels = [];
    for (const it of allItems()) {
      const el = document.createElement('div');
      el.className = 'devlabel';
      el.textContent = it.id;
      el.style.borderColor = COLORS[it.kind] || '#ffffff';
      el.title = it.desc;
      const obj = new CSS2DObject(el);
      obj.position.copy(it.pos);
      obj.userData.item = it;
      this.group.add(obj);
      this.labels.push(obj);
    }
    this.info = document.createElement('div');
    this.info.id = 'devinfo';
    document.body.appendChild(this.info);

    addEventListener('resize', () => this.renderer.setSize(innerWidth, innerHeight));
    addEventListener('keydown', (e) => {
      if (e.code === 'F2') { e.preventDefault(); this.toggle(); }
      if (e.code === 'KeyI' && this.enabled) this.identify();
    });
    if (new URLSearchParams(location.search).has('dev')) this.toggle(true);

    window.__dev = {
      list: () => console.table(allItems().map(({ id, desc, src, s, d }) => ({ id, desc, src, s: +s.toFixed(1), d: +d.toFixed(1) }))),
      find: (id) => findById(id),
      goto: (id) => {
        const it = findById(id);
        if (!it) return console.warn('nincs ilyen:', id);
        this.player.spawn(Math.min(190, Math.max(-6, it.s)), Math.max(-1.2, Math.min(1.2, it.d * 0.1)));
        return it;
      },
    };
  }

  toggle(on = !this.enabled) {
    this.enabled = on;
    this.group.visible = on;
    this.info.style.display = on ? 'block' : 'none';
    this.hud.showToast(on ? 'Dev mode: ON (I = id of the targeted object)' : 'Dev mode: OFF');
  }

  identify() {
    const v = new THREE.Vector3();
    let best = null, bs = Infinity;
    for (const it of allItems()) {
      const dist = it.pos.distanceTo(this.camera.position);
      if (dist > 80) continue;
      v.copy(it.pos).project(this.camera);
      if (v.z > 1) continue;
      const scr = Math.hypot(v.x, v.y);
      const score = scr + dist * 0.004;
      if (scr < 0.25 && score < bs) { bs = score; best = it; }
    }
    if (!best) { this.hud.showToast('No labelled object near the crosshair'); return; }
    const text = `${best.id} – ${best.desc}`;
    navigator.clipboard?.writeText(best.id).catch(() => {});
    console.info('[dev]', text, '|', best.src);
    this.hud.showToast(`${text} (copied to clipboard)`, 4);
    for (const l of this.labels) l.element.classList.toggle('picked', l.userData.item === best);
  }

  update() {
    if (!this.enabled) return;
    const cp = this.camera.position;
    for (const l of this.labels) {
      const d = l.position.distanceTo(cp);
      l.visible = d < 55;
      if (l.visible) l.element.style.opacity = String(Math.max(0.35, 1 - d / 60));
    }
    const pos = this.player.pos;
    const sd = project(pos.x, -pos.z);
    this.info.innerHTML = `DEV · <b>s ${sd.s.toFixed(1)} m, d ${sd.d.toFixed(1)} m</b> (s: distance from Szent István király útja, d: + NW / − SE) · X ${pos.x.toFixed(1)} Z ${pos.z.toFixed(1)} · I = identify · F2 = off`;
    this.renderer.render(this.scene, this.camera);
  }
}
