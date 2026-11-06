// Draw-call reduction: merge sibling meshes that share a material into one mesh per joint.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeByMaterial(root) {
  const nodes = [];
  root.traverse((o) => nodes.push(o));
  for (const node of nodes) {
    const groups = new Map();
    for (const c of node.children) {
      if (!c.isMesh || c.children.length || c.name || c.userData.keep) continue;
      const k = c.material.uuid;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const [, list] of groups) {
      if (list.length < 2) continue;
      const geos = [];
      let ok = true;
      for (const m of list) {
        m.updateMatrix();
        const g = m.geometry.clone().applyMatrix4(m.matrix);
        if (!g.index) { ok = false; break; }
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) { ok = false; break; }
        geos.push(g);
      }
      if (!ok) continue;
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
      for (const m of list) node.remove(m);
      node.add(mesh);
    }
  }
  return root;
}
