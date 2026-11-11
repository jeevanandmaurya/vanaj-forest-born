// Ground occlusion map: a small top-down texture around the player, redrawn whenever the near vegetation is
// rebuilt. R = contact occlusion at trunk bases, rocks and mounds; G = crown shade (canopy cover) used for
// darker ground under trees and for the dappled sun flecks in the terrain shader.
import * as THREE from 'three';
import { G } from '../core/shaderlib.js';

export class GroundAO {
  constructor(px = 256) {
    this.px = px;
    this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = px;
    this.ctx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.NoColorSpace; this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter; this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    G.tGroundAO.value = this.tex;
  }
  // rect: {x0, z0, size}; trees: flat [x, z, trunkR, crownR, ...]; blobs: flat [x, z, r, ...]
  update(rect, trees, blobs) {
    const ctx = this.ctx, P = this.px, k = P / rect.size;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, P, P);
    ctx.globalCompositeOperation = 'lighter';
    const disc = (x, z, r, col, inner = 0) => {
      const cx = (x - rect.x0) * k, cy = (z - rect.z0) * k, rr = Math.max(1.2, r * k);
      if (!Number.isFinite(cx + cy + rr) || cx < -rr || cy < -rr || cx > P + rr || cy > P + rr) return;   // (a tree not yet placed has no numbers: it shades nothing)
      const g = ctx.createRadialGradient(cx, cy, rr * inner, cx, cy, rr);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.fill();
    };
    for (let i = 0; i < trees.length; i += 4) {
      const x = trees[i], z = trees[i + 1], tr = trees[i + 2], cr = trees[i + 3];
      if (cr > 0.5) disc(x, z, cr, 'rgba(0,70,0,1)', 0.2);            // crown shade
      if (tr > 0.05) disc(x, z, tr * 3.6 + 0.4, 'rgba(150,0,0,1)', 0.15); // trunk-base contact
    }
    for (let i = 0; i < blobs.length; i += 3) disc(blobs[i], blobs[i + 1], blobs[i + 2] * 1.7 + 0.3, 'rgba(120,0,0,1)', 0.3);
    this.tex.needsUpdate = true;
    G.uAORect.value.set(rect.x0, rect.z0, 1 / rect.size, 1);
  }
}
