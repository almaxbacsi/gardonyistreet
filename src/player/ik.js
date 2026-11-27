// Axis-agnostic bone posing helpers (work on any rig: they only use bone world positions).
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
const _id = new THREE.Quaternion();

/** Rotate `bone` (shortest arc, in world space) so the bone->child vector points along `dirWorld`. */
export function aimBone(bone, child, dirWorld, weight = 1) {
  if (weight <= 0) return;
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  const cur = _b.sub(_a);
  if (cur.lengthSq() < 1e-10) return;
  cur.normalize();
  _q.setFromUnitVectors(cur, _a.copy(dirWorld).normalize());
  if (weight < 1) _q.slerpQuaternions(_id, _q, weight);
  bone.parent.getWorldQuaternion(_pq);
  // local' = parentWorld^-1 * q * parentWorld * local
  const inv = _pq.clone().invert();
  bone.quaternion.premultiply(_pq).premultiply(_q).premultiply(inv);
  bone.updateMatrixWorld(true);
}

/** Rotate `bone` about a world axis (e.g. lean the spine). */
export function rotateBoneWorld(bone, axisWorld, angle) {
  if (Math.abs(angle) < 1e-5) return;
  _q.setFromAxisAngle(axisWorld, angle);
  bone.parent.getWorldQuaternion(_pq);
  const inv = _pq.clone().invert();
  bone.quaternion.premultiply(_pq).premultiply(_q).premultiply(inv);
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK: shoulder (upper) -> elbow (lower) -> wrist (end) reaching `target` (world).
 * `pole` (world point) chooses the bend plane (where the elbow points).
 */
export function twoBoneIK(upper, lower, end, target, pole, weight = 1) {
  if (weight <= 0) return;
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E0 = lower.getWorldPosition(new THREE.Vector3());
  const W0 = end.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E0), b = E0.distanceTo(W0);
  const toT = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const p = pole.clone().sub(S);
  const perp = p.sub(dir.clone().multiplyScalar(p.dot(dir)));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0);
  perp.normalize();
  const elbow = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  const wrist = S.clone().addScaledVector(dir, d);
  aimBone(upper, lower, elbow.sub(S), weight);
  const E1 = lower.getWorldPosition(new THREE.Vector3());
  aimBone(lower, end, wrist.sub(E1), weight);
}
