// Ground chunks, worked out off the main thread (see land.js). One job in, one chunk's arrays out, handed over without a copy.
import { buildGridRaw, height, LAND, WATER_STATE } from './land.js';
self.onmessage = (e) => {
  const d = e.data; LAND.rise = d.rise; WATER_STATE.holeOffset = d.hole;
  const r = buildGridRaw(d.x0, d.z0, d.size, d.segs, height, true);
  r.k = d.k; r.segs = d.segs;
  self.postMessage(r, [r.pos.buffer, r.nor.buffer, r.spl.buffer, r.bio.buffer, r.fld.buffer, r.idx.buffer, r.hgrid.buffer]);
};
