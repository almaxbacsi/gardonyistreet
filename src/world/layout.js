// Street furniture layout derived from Street View reference panoramas.
// s = metres along Gárdonyi Géza utca from the SW junction (Szent István király útja),
// d = lateral offset, + = north-west side (left when walking uphill), - = south-east side.
//
// Reference panoramas (Street View, summer + spring imagery):
//   P0 s≈4   junction, concrete slabs, earth bank on the left, dense green
//   P1 s≈40  green welded-panel fence + empty lot + wooden cabin on NW, dense bush + blue standpipe on SE
//   P2 s≈72  service road + green gate + wheelie bins NW, terracotta single-storey house SE, concrete poles
//   P3 s≈123 new brick (Porotherm) houses + carport SE, block wall + black gate + parked car NW, road climbs
//   P4 s≈165 road turns to dirt, dark plank fence on stone pillars SE, overgrown lots NW, wooden poles
// Coverage ends after P4, the playable corridor stops shortly after.

export const PLAY = { sMin: -7, sMax: 192, dMax: 24 };

export const ROAD = {
  width: 3.3,
  concrete: [-14, 136],
  dirt: [132, 260],
};

// fence runs: [side(+1 NW / -1 SE), s0, s1, d(abs), type, opts]
export const FENCES = [
  // NW
  [+1, 12, 60, 4.2, 'panel'],
  [+1, 62, 72, 5.5, 'chain', { h: 1.2 }],
  [+1, 72.2, 76.8, 6.5, 'gate-green'],
  [+1, 78, 108, 5.8, 'chain', { h: 1.2 }],
  [+1, 108, 119, 4.0, 'blockwall', { gateAt: [111, 114.6] }],
  [+1, 119, 150, 4.6, 'chain', { h: 1.4, pillarAt: [119] }],
  [+1, 150, 200, 4.4, 'chain', { h: 1.2 }],
  // SE
  [-1, 62, 108, 4.2, 'mesh-wood'],
  [-1, 108, 121.5, 4.0, 'bars'],
  [-1, 121.5, 125.5, 4.0, 'none'], // driveway to carport
  [-1, 125.5, 141, 4.0, 'bars'],
  [-1, 141, 200, 4.1, 'planks', { gateAt: [163.5, 165] }],
];

export const POLES = [
  { s: 12, d: -2.9, kind: 'concrete' },
  { s: 47, d: -2.9, kind: 'concrete' },
  { s: 82, d: -2.9, kind: 'concrete' },
  { s: 116, d: 2.9, kind: 'wood' },
  { s: 150, d: 2.8, kind: 'wood' },
  { s: 184, d: 2.8, kind: 'wood' },
  { s: 218, d: 2.8, kind: 'wood' },
];

export const PROPS = [
  { type: 'bin', s: 76.5, d: 2.5, rot: 0.2 },
  { type: 'bin', s: 77.4, d: 2.55, rot: -0.1 },
  { type: 'bin', s: 170, d: 2.5, rot: 0.4 },
  { type: 'standpipe', s: 39.2, d: -3.4 },
  { type: 'car', s: 112.5, d: 3.0, color: 0x1d2228 },
  { type: 'carport', s: 123.5, d: -7.2 },
  { type: 'cabin', at: [-77, -15], rot: 0.75 },
  { type: 'post', s: 82, d: 3.4 }, // white concrete post with small sign on NW bank
  { type: 'mailbox', s: 113.5, d: 3.9 },
  { type: 'mailbox', s: 166, d: -3.95 },
  { type: 'woodpile', s: 92, d: -7.5 },
];

// Hand-placed landmark trees (s, d, species, scale)
export const LANDMARK_TREES = [
  [178, -4.8, 'oak', 1.45],
  [160, -11, 'pine', 1.1],
  [166, -13, 'pine', 1.2],
  [154, -9, 'pine', 0.95],
  [80, -9, 'spruce', 1.1],
  [126, 13, 'spruce', 1.0],
  [86, -6.5, 'linden', 1.35],
  [35, -5.5, 'locust', 1.2],
  [28, -6.5, 'locust', 1.1],
  [50, -5, 'locust', 1.15],
  [92, 7.5, 'locust', 1.05],
  [98, 8.5, 'locust', 1.15],
  [104, 7, 'locust', 0.95],
  [8, 5.5, 'locust', 1.1],
  [3, -5.2, 'linden', 1.2],
];

// Vegetation density by section and side: returns { tree, bush } densities (0..1)
export function vegDensity(s, d) {
  const se = d < 0, ad = Math.abs(d);
  let tree = 0.25, bush = 0.25;
  if (s < 62) { tree = se ? 0.75 : (ad > 30 ? 0.6 : 0.12); bush = se ? 0.9 : 0.15; }
  else if (s < 110) { tree = se ? 0.35 : 0.55; bush = se ? 0.3 : 0.6; }
  else if (s < 145) { tree = 0.25; bush = 0.3; }
  else { tree = se ? 0.45 : 0.4; bush = se ? 0.35 : 0.85; }
  if (s < -10 || s > 210) { tree = 0.55; bush = 0.4; }
  return { tree, bush };
}

// Building style assignment by footprint centroid (data coords) – nearest match
export const BUILDING_STYLES = [
  { at: [-22, -42], style: 'terracotta' }, // P2 SE
  { at: [7, -18], style: 'brick' }, // P3 SE (rear)
  { at: [14, -3], style: 'brick' }, // P3 SE
  { at: [-19, 16], style: 'cream-balcony' }, // P3 NW on slope
  { at: [-5, 36], style: 'cream' },
  { at: [28, 6], style: 'cream' },
  { at: [41, 16], style: 'beige' }, // P4 SE
  { at: [57, 30], style: 'beige' },
  { at: [64, 39], style: 'white' },
  { at: [13, 60], style: 'chalet' }, // P4 NW left
  { at: [55, 81], style: 'white' }, // P4 NW right
  { at: [-5, 93], style: 'cream' },
  { at: [100, 53], style: 'cream' },
  { at: [83, 64], style: 'shed' },
  { at: [-43, -76], style: 'beige' },
  { at: [10, -61], style: 'cream' },
  { at: [-29, -98], style: 'white' },
  { at: [12, -86], style: 'shed' },
  { at: [20, -83], style: 'shed' },
  { at: [161, 37], style: 'beige' },
];
