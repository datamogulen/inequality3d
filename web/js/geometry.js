// Bygger vattentäta solider (Z-upp, mm) för formerna.
// Remsan är segmentbaserad: varje percentilstapel består av staplade
// segment {part, z0, z1} (t.ex. offentligt/konsumtion/investeringar för
// CO2, eller skuld/positiv för förmögenhet) som hamnar i olika STL-delar.
// All gravyr (bottentext, decilnummer, QR) byggs med scanline → slutna
// lådor, robust mot överlappande glyfer.

import * as THREE from "three";

const EPS = 0.06;
export const TEXT_PLATE = 0.7;    // gravyrdjup på undersidan, mm
export const BASE_TOP = 1.6;      // plintens totala höjd, mm
const BASE_OVERLAP = 0.1;
export const GROOVE_W = 1.2;      // decilskårans bredd, mm
export const TOP_ENGRAVE_D = 0.6; // decilnumrens gravyrdjup, mm
export const MEAN_T = 0.9;        // medelstreckets tjocklek, mm
export const SPLIT_W = 1.6;       // 50/50-markörens bredd, mm

// ---------- primitiver ----------

export function trisToGeometry(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// Sluten axeljusterad låda → 12 trianglar i out.
export function boxTris(x0, x1, y0, y1, z0, z1, out) {
  if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const q = (a, b, c, d) => out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  q(0, 3, 2, 1); q(4, 5, 6, 7); q(0, 1, 5, 4); q(2, 3, 7, 6); q(1, 2, 6, 5); q(3, 0, 4, 7);
}

function sweptBox(pts, w, z0, z1, out) {
  const n = pts.length;
  if (n < 2 || z1 <= z0) return;
  const half = w / 2;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    let dx = 0, dy = 0;
    if (i > 0) { dx += pts[i][0] - pts[i - 1][0]; dy += pts[i][1] - pts[i - 1][1]; }
    if (i < n - 1) { dx += pts[i + 1][0] - pts[i][0]; dy += pts[i + 1][1] - pts[i][1]; }
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    L.push([pts[i][0] + nx * half, pts[i][1] + ny * half]);
    R.push([pts[i][0] - nx * half, pts[i][1] - ny * half]);
  }
  const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const P = (p, z) => [p[0], p[1], z];
  for (let i = 0; i < n - 1; i++) {
    const li = L[i], lj = L[i + 1], ri = R[i], rj = R[i + 1];
    tri(P(li, z1), P(ri, z1), P(rj, z1)); tri(P(li, z1), P(rj, z1), P(lj, z1));
    tri(P(li, z0), P(rj, z0), P(ri, z0)); tri(P(li, z0), P(lj, z0), P(rj, z0));
    tri(P(li, z0), P(lj, z1), P(lj, z0)); tri(P(li, z0), P(li, z1), P(lj, z1));
    tri(P(ri, z0), P(rj, z0), P(rj, z1)); tri(P(ri, z0), P(rj, z1), P(ri, z1));
  }
  tri(P(L[0], z0), P(R[0], z0), P(R[0], z1));
  tri(P(L[0], z0), P(R[0], z1), P(L[0], z1));
  const e = n - 1;
  tri(P(L[e], z0), P(R[e], z1), P(R[e], z0));
  tri(P(L[e], z0), P(L[e], z1), P(R[e], z1));
}

function extendPath(pts, d) {
  if (pts.length < 2) return pts;
  const p = pts.map((q) => q.slice());
  const ext = (a, b) => {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    const l = Math.hypot(dx, dy) || 1;
    return [a[0] + (dx / l) * d, a[1] + (dy / l) * d];
  };
  p[0] = ext(p[0], p[1]);
  p[p.length - 1] = ext(p[p.length - 1], p[p.length - 2]);
  return p;
}

// ---------- scanline-verktyg ----------

function polysFromShapes(shapes, res = 6) {
  return shapes.map((s) => ({
    outer: s.getPoints(res).map((p) => [p.x, p.y]),
    holes: s.holes.map((h) => h.getPoints(res).map((p) => [p.x, p.y])),
  }));
}

function crossIntervals(poly, x) {
  const ys = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((a[0] - x) * (b[0] - x) < 0) {
      const t = (x - a[0]) / (b[0] - a[0]);
      ys.push(a[1] + t * (b[1] - a[1]));
    }
  }
  ys.sort((p, q) => p - q);
  const iv = [];
  for (let i = 0; i + 1 < ys.length; i += 2) iv.push([ys[i], ys[i + 1]]);
  return iv;
}

function subtract(a, b) {
  let res = a.map((iv) => iv.slice());
  for (const [b0, b1] of b) {
    const next = [];
    for (const [a0, a1] of res) {
      if (b1 <= a0 || b0 >= a1) { next.push([a0, a1]); continue; }
      if (b0 > a0) next.push([a0, b0]);
      if (b1 < a1) next.push([b1, a1]);
    }
    res = next;
  }
  return res;
}

function unionSorted(list) {
  const flat = list.slice().sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const iv of flat) {
    if (out.length && iv[0] <= out[out.length - 1][1] + 1e-6) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], iv[1]);
    } else out.push(iv.slice());
  }
  return out;
}

function coverageAtX(polys, x) {
  const covered = [];
  for (const p of polys) {
    let inside = crossIntervals(p.outer, x);
    for (const h of p.holes) inside = subtract(inside, crossIntervals(h, x));
    covered.push(...inside);
  }
  return unionSorted(covered);
}

// ---------- remsa (segmentbaserad) ----------
// brackets: [{p0, p1, segs: [{part, z0, z1}] (mm över plattan, staplade),
//             minLen?}]
// opts: { length, depth, endMargin, grooves (default true),
//         decileGlyphs (array[10] {shapes,width,height} | null),
//         meanH (mm över plattan | null), splitP (percentil | null) }
// Decilskåror och 50/50-markören är ICKE-DATA: de sprängs in som extra
// mellanrum så att varje percentil behåller sin fulla databredd.
// Returnerar { parts: {namn: tris[]}, plate, stats }.
export function buildStrip(brackets, opts) {
  const L = opts.length, W = opts.depth;
  const x0 = -L / 2, y0 = -W / 2, y1 = W / 2;
  const grooves = opts.grooves !== false;

  // luckor (sorterade i p)
  const gaps = [];
  if (grooves) for (let k = 1; k <= 9; k++) gaps.push({ p: k * 10, w: GROOVE_W, kind: "groove" });
  if (opts.splitP != null) {
    const sp = Math.round(Math.min(Math.max(opts.splitP, 1), 99));
    const same = gaps.find((g) => g.p === sp);
    if (same) { same.w = SPLIT_W; same.kind = "split"; }
    else { gaps.push({ p: sp, w: SPLIT_W, kind: "split" }); gaps.sort((a, b) => a.p - b.p); }
  }
  const La = L - gaps.reduce((s, g) => s + g.w, 0);
  let accW = 0;
  for (const g of gaps) { g.xStart = x0 + (g.p / 100) * La + accW; accW += g.w; }
  const before = (p, incl) => gaps.reduce((s, g) => s + ((incl ? g.p <= p : g.p < p) ? g.w : 0), 0);
  const xL = (p) => x0 + (p / 100) * La + before(p, true);   // stapelns vänsterkant
  const xR = (p) => x0 + (p / 100) * La + before(p, false);  // stapelns högerkant
  const pAt = (x) => {
    let xx = x - x0;
    for (const g of gaps) {
      if (x >= g.xStart + g.w) xx -= g.w;
      else if (x >= g.xStart) return g.p;
      else break;
    }
    return Math.min(100, Math.max(0, (xx / La) * 100));
  };

  const parts = {};
  const arr = (k) => (parts[k] ??= []);
  const mean = opts.meanH != null
    ? { z0: BASE_TOP + opts.meanH - MEAN_T / 2, z1: BASE_TOP + opts.meanH + MEAN_T / 2 }
    : null;

  const put = (part, xa, xb, ya, yb, za, zb, allowMean = true) => {
    if (zb <= za) return;
    if (mean && allowMean && zb > mean.z0 && za < mean.z1) {
      if (za < mean.z0) boxTris(xa, xb, ya, yb, za, mean.z0 + 0.03, arr(part));
      boxTris(xa, xb, ya, yb, Math.max(za, mean.z0), Math.min(zb, mean.z1), arr("mean"));
      if (zb > mean.z1) boxTris(xa, xb, ya, yb, mean.z1 - 0.03, zb, arr(part));
      return;
    }
    boxTris(xa, xb, ya, yb, za, zb, arr(part));
  };
  // Medelstrecket carvas bara i staplar som når klart över bandet – annars
  // "smetas" den mörka färgen ut över topparna där kurvan är flack.
  const putSegs = (segs, xa, xb, capZ) => {
    const barTop = segs.length ? BASE_TOP + segs[segs.length - 1].z1 : 0;
    const allow = !mean || barTop > mean.z1 + 0.6;
    for (const s of segs) {
      const za = BASE_TOP + s.z0, zb = Math.min(BASE_TOP + s.z1, capZ);
      put(s.part, xa, xb, y0, y1, za - (s.z0 > 0 ? EPS : BASE_OVERLAP), zb, allow);
    }
  };

  const bracketAt = (p) => {
    for (const b of brackets) if (p >= b.p0 - 1e-9 && p <= b.p1 + 1e-9) return b;
    return null;
  };
  const topOf = (b) => (b && b.segs.length ? b.segs[b.segs.length - 1].z1 : 0);

  // "10" på väggen: om sista stapeln reser sig brant räcker inte ovansidan –
  // siffran graveras då i stapelns vänstervägg (läses från låginkomsthållet).
  let wall = null;
  if (opts.decileGlyphs && opts.decileGlyphs[9] && brackets.length >= 2) {
    const last = brackets[brackets.length - 1];
    const prev = brackets[brackets.length - 2];
    const g = opts.decileGlyphs[9];
    const room = topOf(last) - topOf(prev);
    const bw = xR(last.p1) - xL(last.p0);
    if (last.p1 >= 99.99 && room > g.height + 6 && bw >= 1.4 && g.shapes.length) {
      wall = { bar: last, glyph: g, zBase: BASE_TOP + topOf(prev), zTop: BASE_TOP + topOf(last), xa: xL(last.p0), xb: xR(last.p1) };
    }
  }

  // decilnummer-zoner (på ovansidan)
  const zones = [];
  if (opts.decileGlyphs) {
    for (let k = 0; k < 10; k++) {
      if (wall && k === 9) continue;
      const g = opts.decileGlyphs[k];
      if (!g || !g.shapes.length) continue;
      const left = xL(k * 10) + 0.3, right = xR((k + 1) * 10) - 0.3;
      const cx = (left + right) / 2;
      const half = g.width / 2 + 0.6;
      const gx0 = Math.max(cx - half, left), gx1 = Math.min(cx + half, right);
      if (gx1 <= gx0) continue;
      const polys = polysFromShapes(g.shapes).map((poly) => ({
        outer: poly.outer.map(([x, y]) => [x + cx, y]),
        holes: poly.holes.map((h) => h.map(([x, y]) => [x + cx, y])),
      }));
      zones.push({ gx0, gx1, polys });
    }
  }
  const zoneCuts = zones.flatMap((z) => [z.gx0, z.gx1]);
  const inZone = (x) => zones.some((z) => x >= z.gx0 && x <= z.gx1);

  let maxH = 0, clamped = 0;
  for (const b of brackets) {
    maxH = Math.max(maxH, topOf(b));
    if (b.clamped) clamped++;
    if (wall && b === wall.bar) continue; // byggs av vägg-gravyren
    let xa = xL(b.p0);
    const xb = xR(b.p1);
    if (b.minLen && xb - xa < b.minLen) xa = xb - b.minLen;
    const cuts = [xa, ...zoneCuts.filter((c) => c > xa && c < xb).sort((a, c) => a - c), xb];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const sxa = cuts[i], sxb = cuts[i + 1];
      if (inZone((sxa + sxb) / 2)) continue;
      putSegs(b.segs, sxa, sxb + EPS, Infinity);
    }
  }

  // gravyrkolumner i zonerna (ficka + nummer-inlägg; tunna staplar får
  // upphöjd siffra i stället)
  const dx = 0.25;
  const minTop = TOP_ENGRAVE_D + 0.35;
  for (const z of zones) {
    const n = Math.max(1, Math.round((z.gx1 - z.gx0) / dx));
    const w = (z.gx1 - z.gx0) / n;
    for (let i = 0; i < n; i++) {
      const xa = z.gx0 + i * w, xb = xa + w, xc = (xa + xb) / 2;
      const b = bracketAt(pAt(xc));
      if (!b) continue;
      const segs = b.segs;
      const top = topOf(b);
      const cov = coverageAtX(z.polys, xc)
        .map(([a, c]) => [Math.max(y0, a), Math.min(y1, c)])
        .filter(([a, c]) => c > a);
      if (top < minTop) {
        putSegs(segs, xa, xb + EPS, Infinity);
        for (const [ya, yb] of cov) {
          boxTris(xa, xb + EPS, ya, yb, BASE_TOP + Math.max(0, top) - EPS,
            BASE_TOP + top + TOP_ENGRAVE_D, arr("numbers"));
        }
        continue;
      }
      const pocketBot = BASE_TOP + top - TOP_ENGRAVE_D;
      const topPart = segs[segs.length - 1].part;
      putSegs(segs, xa, xb + EPS, pocketBot);
      for (const [ya, yb] of subtract([[y0, y1]], cov)) {
        boxTris(xa, xb + EPS, ya, yb, pocketBot - EPS, BASE_TOP + top, arr(topPart));
      }
      for (const [ya, yb] of cov) {
        boxTris(xa, xb + EPS, ya, yb, pocketBot - EPS, BASE_TOP + top, arr("numbers"));
      }
    }
  }

  // väggravyr av sista siffran ("10")
  if (wall) {
    const D = Math.min(0.5, wall.xb - wall.xa - 0.8);
    // allt bakom främre laminan
    putSegs(wall.bar.segs, wall.xa + D, wall.xb + EPS, Infinity);
    const g = wall.glyph;
    // centrera i exponerad vägg, håll marginal mot kanterna
    const zc = Math.max(wall.zBase + g.height / 2 + 2.5,
      Math.min((wall.zBase + wall.zTop) / 2, wall.zTop - g.height / 2 - 2.5));
    // glyf i (y,z); spegla y – läses stående framför väggen (från −x)
    const polys = polysFromShapes(g.shapes).map((poly) => ({
      outer: poly.outer.map(([gx, gy]) => [-gx, gy + zc]),
      holes: poly.holes.map((h) => h.map(([gx, gy]) => [-gx, gy + zc])),
    }));
    const yHalf = Math.min(W / 2 - 1, g.width / 2 + 1.2);
    // sidoslabbar utanför sifferbandet
    for (const [sa, sb] of [[y0, -yHalf], [yHalf, y1]]) {
      const segs2 = wall.bar.segs.map((sg) => ({ ...sg }));
      const barTop = BASE_TOP + topOf(wall.bar);
      const allow = !mean || barTop > mean.z1 + 0.6;
      for (const sg of segs2) {
        put(sg.part, wall.xa, wall.xa + D + EPS, sa, sb,
          BASE_TOP + sg.z0 - (sg.z0 > 0 ? EPS : BASE_OVERLAP), BASE_TOP + sg.z1, allow);
      }
    }
    const dy = 0.25;
    const nCol = Math.max(1, Math.round((2 * yHalf) / dy));
    const wcol = (2 * yHalf) / nCol;
    for (let i = 0; i < nCol; i++) {
      const ya = -yHalf + i * wcol, yb = ya + wcol, yc = (ya + yb) / 2;
      const cov = coverageAtX(polys, yc)
        .map(([a, c]) => [Math.max(a, BASE_TOP + 0.3), Math.min(c, wall.zTop - 0.3)])
        .filter(([a, c]) => c > a);
      for (const sg of wall.bar.segs) {
        const za = BASE_TOP + sg.z0, zb = BASE_TOP + sg.z1;
        for (const [ia, ib] of subtract([[za, zb]], cov)) {
          put(sg.part, wall.xa, wall.xa + D + EPS, ya, yb + EPS,
            ia - (sg.z0 > 0 ? EPS : BASE_OVERLAP), ib);
        }
      }
      for (const [ia, ib] of cov) {
        boxTris(wall.xa, wall.xa + D + EPS, ya, yb + EPS, ia, ib, arr("numbers"));
      }
    }
  }

  // 50/50-markören fyller sin lucka, något högre än grafen intill
  const sg = gaps.find((g) => g.kind === "split");
  if (sg) {
    const hL = topOf(bracketAt(sg.p - 0.5));
    const hR = topOf(bracketAt(sg.p + 0.5));
    const h = Math.max(hL, hR, 3) + 2;
    put("split", sg.xStart, sg.xStart + sg.w, y0, y1, BASE_TOP - BASE_OVERLAP, BASE_TOP + h);
  }

  return {
    parts,
    plate: { kind: "rect", w: L + 2 * opts.endMargin, d: W },
    stats: { maxH, clamped },
    // för hover: invertera x → percentil (samma logik som pAt ovan)
    map: { x0, La, gaps: gaps.map((g) => ({ p: g.p, w: g.w, xStart: g.xStart })) },
  };
}

// Percentil vid lokal x-koordinat på en remsa (invers av lucke-mappningen).
export function stripPAt(map, x) {
  let xx = x - map.x0;
  for (const g of map.gaps) {
    if (x >= g.xStart + g.w) xx -= g.w;
    else if (x >= g.xStart) return g.p;
    else break;
  }
  return Math.min(100, Math.max(0, (xx / map.La) * 100));
}

// ---------- kvadrat ----------
export function buildSquare(brackets, opts) {
  const S = opts.length;
  const pitch = S / 10;
  const w = pitch * 0.8;
  const out = [];
  let maxH = 0;
  for (const b of brackets) {
    const h = b.v;
    if (h <= 0) continue;
    maxH = Math.max(maxH, h);
    const row = Math.min(9, Math.floor(b.p0 / 10));
    const yMid = -S / 2 + (row + 0.5) * pitch;
    const fx = (p) => -S / 2 + ((p - row * 10) / 10) * S;
    let xa = fx(b.p0);
    const xb = fx(b.p1);
    if (b.minLen && xb - xa < b.minLen) xa = xb - b.minLen;
    boxTris(xa, xb + EPS, yMid - w / 2, yMid + w / 2, BASE_TOP - BASE_OVERLAP, BASE_TOP + h, out);
  }
  return {
    parts: { graph: out },
    plate: { kind: "rect", w: S + 2 * opts.endMargin, d: S + 2 * opts.endMargin },
    stats: { maxH },
  };
}

// ---------- spiral ----------
export function buildSpiral(brackets, opts) {
  const R = opts.length / 2;
  const spiralWidth = opts.spiralWidth, spiralGap = opts.spiralGap;
  const rOut = R - opts.endMargin - spiralWidth / 2;
  const rIn = Math.max(4, spiralWidth * 0.8);
  const pitch = spiralWidth + spiralGap;
  const bCoef = pitch / (2 * Math.PI);
  const thetaEnd = (rOut - rIn) / bCoef;
  const sTot = rOut * thetaEnd - (bCoef * thetaEnd * thetaEnd) / 2;
  const thetaAt = (f) => {
    const s = f * sTot;
    const disc = Math.max(0, rOut * rOut - 2 * bCoef * s);
    return (rOut - Math.sqrt(disc)) / bCoef;
  };
  const pointAt = (theta) => {
    const r = rOut - bCoef * theta;
    return [r * Math.cos(theta), r * Math.sin(theta)];
  };
  const out = [];
  let maxH = 0;
  for (const b of brackets) {
    const h = b.v;
    if (h <= 0) continue;
    maxH = Math.max(maxH, h);
    let f0 = b.p0 / 100;
    const f1 = b.p1 / 100;
    if (b.minLen && (f1 - f0) * sTot < b.minLen) f0 = Math.max(0, f1 - b.minLen / sTot);
    const t0 = thetaAt(f0), t1 = thetaAt(f1);
    const steps = Math.max(2, Math.ceil((t1 - t0) / 0.09));
    const path = [];
    for (let i = 0; i <= steps; i++) path.push(pointAt(t0 + ((t1 - t0) * i) / steps));
    sweptBox(extendPath(path, EPS), spiralWidth, BASE_TOP - BASE_OVERLAP, BASE_TOP + h, out);
  }
  return {
    parts: { graph: out },
    plate: { kind: "circle", r: R },
    stats: { maxH },
  };
}

// ---------- glyfer → vattentäta shapes ----------
const GLYPH_RES = 20;

function dedupe(pts, eps = 2e-3) {
  const o = [];
  for (const p of pts) {
    const q = o[o.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > eps) o.push(p);
  }
  while (o.length > 2 && Math.hypot(o[0].x - o[o.length - 1].x, o[0].y - o[o.length - 1].y) <= eps) o.pop();
  return o;
}

function glyphToShape(glyph) {
  const s = new THREE.Shape(dedupe(glyph.getPoints(GLYPH_RES)));
  s.holes = glyph.holes.map((h) => new THREE.Path(dedupe(h.getPoints(GLYPH_RES))));
  return s;
}

// ---------- textinlägg (undersida) ----------
export const INLAY_H = TEXT_PLATE - BASE_OVERLAP;

export function buildInlay(shapes) {
  return shapes.map((glyph) =>
    new THREE.ExtrudeGeometry(glyphToShape(glyph), { depth: INLAY_H, bevelEnabled: false })
  );
}

// QR-inlägg: mörka moduler som lådor 0..INLAY_H (samma del som texten).
export function qrInlayTris(qrRects) {
  const out = [];
  for (const r of qrRects) boxTris(r.x0, r.x1, r.y0, r.y1, 0, INLAY_H, out);
  return out;
}

// ---------- plint (bottenplatta) med graverad text + QR ----------
function plateSpanY(plate, x) {
  if (plate.kind === "circle") {
    if (Math.abs(x) >= plate.r) return null;
    const yy = Math.sqrt(plate.r * plate.r - x * x);
    return [-yy, yy];
  }
  if (Math.abs(x) > plate.w / 2 + 1e-9) return null;
  return [-plate.d / 2, plate.d / 2];
}

export function buildPlinth(plate, textShapes, qrRects = []) {
  const outline = new THREE.Shape();
  if (plate.kind === "circle") outline.absarc(0, 0, plate.r, 0, Math.PI * 2, false);
  else {
    const w = plate.w / 2, d = plate.d / 2;
    outline.moveTo(-w, -d); outline.lineTo(w, -d); outline.lineTo(w, d); outline.lineTo(-w, d); outline.closePath();
  }
  const base = new THREE.ExtrudeGeometry(outline, { depth: BASE_TOP - (TEXT_PLATE - BASE_OVERLAP), bevelEnabled: false });
  base.translate(0, 0, TEXT_PLATE - BASE_OVERLAP);

  const lamina = [];
  const polys = textShapes && textShapes.length ? polysFromShapes(textShapes, 8) : [];
  const xMax = plate.kind === "circle" ? plate.r : plate.w / 2;
  const dx = 0.3;
  const n = Math.max(1, Math.round((2 * xMax) / dx));
  const w = (2 * xMax) / n;
  for (let i = 0; i < n; i++) {
    const xa = -xMax + i * w, xb = xa + w, xc = (xa + xb) / 2;
    const span = plateSpanY(plate, xc);
    if (!span) continue;
    const gcov = polys.length ? coverageAtX(polys, xc) : [];
    const qcov = qrRects.filter((r) => xc >= r.x0 && xc <= r.x1).map((r) => [r.y0, r.y1]);
    const cov = unionSorted([...gcov, ...qcov])
      .map(([a, b]) => [Math.max(span[0], a), Math.min(span[1], b)])
      .filter(([a, b]) => b > a);
    for (const [ya, yb] of subtract([span], cov)) boxTris(xa, xb + EPS, ya, yb, 0, TEXT_PLATE + EPS, lamina);
  }
  return [trisToGeometry(lamina), base];
}
