// Registry of labelled scene objects, so they can be referred to by a stable id
// (e.g. "fa-31", "haz-G9", "kerites-12") when asking for changes.
// Ids come from the order of the lists in src/world/layout.js (and OSM house numbers),
// so `fa-31` = LANDMARK_TREES[30], `kerites-12` = FENCES[11], etc.
import * as THREE from 'three';
import { project } from '../world/geo.js';

const items = [];
const counters = {};

/**
 * @param {string} kind   category prefix, e.g. 'fa'
 * @param {number[]} pos  world position [X, Y, Z] for the label
 * @param {string} desc   short human description
 * @param {string} [id]   explicit id (otherwise kind-<n>)
 * @param {string} [src]  where it is defined (file / list)
 */
export function register(kind, pos, desc, id, src) {
  counters[kind] = (counters[kind] || 0) + 1;
  const iid = id || `${kind}-${counters[kind]}`;
  const p = project(pos[0], -pos[2]);
  items.push({ id: iid, kind, pos: new THREE.Vector3(...pos), desc, src, s: p.s, d: p.d });
  return iid;
}

export function allItems() { return items; }

export function findById(id) { return items.find((i) => i.id === id); }
