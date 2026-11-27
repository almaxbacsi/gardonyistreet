// Tool definitions: model, hold type and keyframed poses in the character's root frame
// (+Z forward, +Y up, +X = character's left; metres above the feet).
//  grip  = right-hand grip point, aim = point the tool points at (shaft end for long tools,
//  forward for power tools), lean = forward spine lean (rad).
// kind: 'strike' = one action per click (impact at `hitAt`), 'hold' = active while the button is held
// (impacts every `interval`), 'push' = mower.
import * as M from './models.js';

const K = (p, grip, aim, lean = 0) => ({ p, grip, aim, lean });

export const TOOLS = [
  {
    id: 'shovel', label: 'Shovel', build: M.shovel, hold: 'two', side: 1, kind: 'strike', duration: 1.1, hitAt: 0.5, reach: 1.5,
    idle: K(0, [-0.2, 0.98, 0.22], [0.05, 0.1, 0.95]),
    use: [
      K(0, [-0.2, 0.98, 0.22], [0.05, 0.1, 0.95]),
      K(0.3, [-0.16, 1.22, 0.16], [0.0, 0.6, 0.95], 0.05),
      K(0.5, [-0.12, 0.88, 0.45], [0.0, -0.1, 1.05], 0.32),
      K(0.75, [-0.2, 0.98, 0.12], [0.0, 0.1, 0.95], 0.2),
      K(1, [-0.2, 0.98, 0.22], [0.05, 0.1, 0.95]),
    ],
  },
  {
    id: 'mower', label: 'Lawn mower', build: M.lawnMower, hold: 'push', kind: 'push', reach: 0.6,
    offset: 1.3, // deck centre in front of the feet
  },
  {
    id: 'grinder', label: 'Angle grinder', build: M.angleGrinder, hold: 'one', kind: 'hold', interval: 0.05, reach: 1.4,
    idle: K(0, [-0.18, 1.02, 0.3], [-0.15, 0.95, 1.3]),
    use: [K(0, [-0.14, 1.08, 0.46], [-0.1, 0.9, 1.4], 0.15)],
  },
  {
    id: 'drill', label: 'Impact drill', build: M.impactDrill, hold: 'one', kind: 'hold', interval: 0.12, reach: 1.3,
    idle: K(0, [-0.2, 1.05, 0.3], [-0.2, 1.0, 1.3]),
    use: [K(0, [-0.12, 1.25, 0.5], [-0.1, 1.2, 1.5], 0.1)],
  },
  {
    id: 'sledgehammer', label: 'Sledgehammer', build: M.sledgehammer, hold: 'two', side: 1, kind: 'strike', duration: 1.3, hitAt: 0.58, reach: 1.8,
    idle: K(0, [-0.14, 0.78, 0.25], [-0.05, 0.3, 0.9]),
    use: [
      K(0, [-0.14, 0.78, 0.25], [-0.05, 0.3, 0.9]),
      K(0.4, [-0.08, 1.75, -0.02], [-0.02, 2.2, -0.65], -0.15),
      K(0.58, [-0.05, 0.95, 0.55], [0.0, 0.15, 1.2], 0.35),
      K(0.8, [-0.08, 0.9, 0.5], [0.0, 0.1, 1.15], 0.3),
      K(1, [-0.14, 0.78, 0.25], [-0.05, 0.3, 0.9]),
    ],
  },
  {
    id: 'trimmer', label: 'Hedge trimmer', build: M.hedgeTrimmer, hold: 'two', side: 1, kind: 'hold', interval: 0.15, reach: 1.6,
    idle: K(0, [-0.16, 1.02, 0.25], [-0.05, 0.95, 1.0]),
    use: [K(0, [-0.1, 1.15, 0.38], [0.0, 1.15, 1.2], 0.1)],
    sweep: 0.35,
  },
  {
    id: 'rake', label: 'Rake', build: M.rake, hold: 'two', side: -1, kind: 'strike', duration: 1.0, hitAt: 0.62, reach: 1.9,
    idle: K(0, [-0.2, 0.95, 0.2], [0.1, 0.0, 1.3]),
    use: [
      K(0, [-0.2, 0.95, 0.2], [0.1, 0.0, 1.3]),
      K(0.35, [-0.14, 1.05, 0.55], [0.05, 0.05, 1.75], 0.25),
      K(0.45, [-0.14, 1.0, 0.55], [0.05, -0.05, 1.7], 0.3),
      K(0.8, [-0.24, 0.92, 0.08], [0.05, -0.05, 1.1], 0.1),
      K(1, [-0.2, 0.95, 0.2], [0.1, 0.0, 1.3]),
    ],
  },
];
