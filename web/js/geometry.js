// Bygger vattentäta solider (Z-upp, mm) för formerna.
// Axeljusterade lådor för remsa/kvadrat/fenor/gravyr; svept låda för spiral.
// Delar överlappar EPS så slicern kan unionera utan koplanära ytor.

import * as THREE from "three";

const EPS = 0.06;
export const TEXT_PLATE = 0.7;   // gravyrdjup på undersidan, mm
export const BASE_TOP = 1.6;     // plintens totala höjd, mm
const BASE_OVERLAP = 0.1;
export const FIN_W = 1.4;        // decilfenans bredd, mm
export const TOP_ENGRAVE_D = 0.6; // decilnumrens gravyrdjup ovanpå, mm

// ---------- primitiver ----------

export function trisToGeometry(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// Axeljusterad låda → 12 trianglar i out.
function boxTris(x0, x1, y0, y1, z0, z1, out) {
  if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], // botten 0-3
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], // topp 4-7
  ];
  const q = (a, b, c, d) => {
    out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  };
  q(0, 3, 2, 1); // botten (−Z)
  q(4, 5, 6, 7); // topp (+Z)
  q(0, 1, 5, 4); // −Y
  q(2, 3, 7, 6); // +Y
  q(1, 2, 6, 5); // +X
  q(3, 0, 4, 7); // −X
}

// svept låda längs polylinje (för spiral)
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

function barHeight(v, opts) {
  const h = v * opts.scale;
  if (opts.clampMm > 0 && h > opts.clampMm) return { h: opts.clampMm, truncated: true };
  return { h, truncated: false };
}

// ---------- gravyr på ovansidan (decilnummer) ----------
// Glyfer → polygoner; scanline ger täckta y-intervall per x-kolumn så vi kan
// bygga gravyrficka + inlägg som följer den trappande grafytan.

function polysFromShapes(shapes, res = 6) {
  return shapes.map((s) => ({
    outer: s.getPoints(res).map((p) => [p.x, p.y]),
    holes: s.holes.map((h) => h.getPoints(res).map((p) => [p.x, p.y])),
  }));
}

// y-krossningar av vertikal linje x mot polygon → inside-intervall [ [y0,y1], ... ]
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
  // a, b: sorterade disjunkta intervall. a minus b.
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

// täckta y-intervall (inuti glyf) vid x
function coverageAtX(polys, x) {
  const covered = [];
  for (const p of polys) {
    let inside = crossIntervals(p.outer, x);
    for (const h of p.holes) inside = subtract(inside, crossIntervals(h, x));
    covered.push(...inside);
  }
  return unionSorted(covered);
}

// Gravera glyfer (i strip-koord, placerade) i toppytan över x∈[gx0,gx1].
// heightAt(x) → grafhöjd (z, absolut). Skriver ficka till graphOut, inlägg
// till inlayOut. Kolumnbredd dx styr x-upplösningen.
function engraveTop(polys, gx0, gx1, y0, y1, heightAt, graphOut, inlayOut) {
  const dx = 0.3;
  const n = Math.max(1, Math.round((gx1 - gx0) / dx));
  const w = (gx1 - gx0) / n;
  for (let i = 0; i < n; i++) {
    const xa = gx0 + i * w, xb = xa + w, xc = (xa + xb) / 2;
    const top = heightAt(xc);
    const pocketTop = top;
    const pocketBot = top - TOP_ENGRAVE_D;
    const cov = coverageAtX(polys, xc).map(([a, b]) => [Math.max(y0, a), Math.min(y1, b)])
      .filter(([a, b]) => b > a);
    // bulk under fickan
    boxTris(xa, xb + EPS, y0, y1, BASE_TOP - BASE_OVERLAP, pocketBot, graphOut);
    // lamina: solid där INTE täckt; inlägg där täckt
    const solid = subtract([[y0, y1]], cov);
    for (const [ya, yb] of solid) boxTris(xa, xb + EPS, ya, yb, pocketBot, pocketTop, graphOut);
    for (const [ya, yb] of cov) boxTris(xa, xb + EPS, ya, yb, pocketBot, pocketTop, inlayOut);
  }
}

// ---------- remsa ----------
// opts extra: length, depth, endMargin, decileGlyphs (array[10] {shapes,size}|null),
// cumulative (bool påverkar redan värdena i main), engrave (bool)
export function buildStrip(brackets, opts) {
  const L = opts.length;
  const W = opts.depth;
  const x0 = -L / 2;
  const y0 = -W / 2, y1 = W / 2;
  const xAt = (p) => x0 + (p / 100) * L;
  const isDecile = (p) => Math.abs(p / 10 - Math.round(p / 10)) < 1e-6 && p > 0 && p < 100;

  const graph = [], fins = [], numberInlay = [];
  let truncated = 0, maxH = 0;

  // höjd per percentil (för fenor och gravyr): styckvis konstant per bracket
  const heightForP = (p) => {
    for (const b of brackets) if (p >= b.p0 - 1e-9 && p <= b.p1 + 1e-9) {
      return BASE_TOP + barHeight(b.v, opts).h;
    }
    return BASE_TOP;
  };

  for (const b of brackets) {
    const { h, truncated: t } = barHeight(b.v, opts);
    if (t) truncated++;
    maxH = Math.max(maxH, h);
    let xa = xAt(b.p0), xb = xAt(b.p1);
    // krymp för fen-gap vid decilgränser
    if (isDecile(b.p0)) xa += FIN_W / 2;
    if (isDecile(b.p1)) xb -= FIN_W / 2;
    if (h <= 0) continue;
    boxTris(xa, xb + EPS, y0, y1, BASE_TOP - BASE_OVERLAP, BASE_TOP + h, graph);
  }

  // decilfenor (fyller gapen), höjd = max av grannbrackets höjd
  for (let k = 1; k <= 9; k++) {
    const p = k * 10;
    const xc = xAt(p);
    const hFin = Math.max(heightForP(p - 0.001), heightForP(p + 0.001));
    boxTris(xc - FIN_W / 2, xc + FIN_W / 2, y0, y1, BASE_TOP - BASE_OVERLAP, hFin, fins);
  }

  // decilnummer graverade i toppen
  if (opts.decileGlyphs) {
    for (let k = 0; k < 10; k++) {
      const g = opts.decileGlyphs[k];
      if (!g || !g.shapes.length) continue;
      const pc = (k + 0.5) * 10;
      const cx = xAt(pc);
      // placera glyfblocket centrerat vid (cx, 0)
      const polys = polysFromShapes(g.shapes).map((poly) => ({
        outer: poly.outer.map(([x, y]) => [x + cx, y]),
        holes: poly.holes.map((h) => h.map(([x, y]) => [x + cx, y])),
      }));
      const half = g.width / 2 + 0.6;
      let gx0 = cx - half, gx1 = cx + half;
      // håll gravyren innanför decilen (minus fen-gap)
      gx0 = Math.max(gx0, xAt(k * 10) + (k > 0 ? FIN_W / 2 : 0) + 0.3);
      gx1 = Math.min(gx1, xAt((k + 1) * 10) - (k < 9 ? FIN_W / 2 : 0) - 0.3);
      const yBand = Math.min(W / 2 - 1, g.height / 2 + 1);
      const heightAt = (x) => {
        // percentil vid x
        const p = ((x - x0) / L) * 100;
        return Math.max(BASE_TOP + TOP_ENGRAVE_D + 0.2, heightForP(p));
      };
      engraveTop(polys, gx0, gx1, -yBand, yBand, heightAt, graph, numberInlay);
    }
  }

  return {
    graphTris: graph,
    finTris: fins,
    numberInlayTris: numberInlay,
    plate: { kind: "rect", w: L + 2 * opts.endMargin, d: W, extendX: true },
    stats: { truncated, maxH },
  };
}

// ---------- kvadrat ----------
export function buildSquare(brackets, opts) {
  const S = opts.length;
  const pitch = S / 10;
  const w = pitch * 0.8;
  const out = [];
  let truncated = 0, maxH = 0;
  for (const b of brackets) {
    const { h, truncated: t } = barHeight(b.v, opts);
    if (t) truncated++;
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
    graphTris: out,
    finTris: [], numberInlayTris: [],
    plate: { kind: "rect", w: S + 2 * opts.endMargin, d: S + 2 * opts.endMargin },
    stats: { truncated, maxH },
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
  let truncated = 0, maxH = 0;
  for (const b of brackets) {
    const { h, truncated: t } = barHeight(b.v, opts);
    if (t) truncated++;
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
    graphTris: out,
    finTris: [], numberInlayTris: [],
    plate: { kind: "circle", r: R },
    stats: { truncated, maxH },
  };
}

// ---------- glyfer → vattentäta shapes ----------
// Vissa glyfer (t.ex. N) har exakta dubbelpunkter i konturen som ger
// degenererade väggfacetter vid extrudering → oparade kanter. Vi
// polygoniserar och tar bort ENBART dubbletter (inte kollinjära punkter,
// som skulle förstöra bokstavsformen).
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

// ---------- plint (bottenplatta) med graverad text ----------
// Undersidan graveras via scanline (robust mot överlappande glyfer, till
// skillnad från earcut-hål). Returnerar [laminaGeom, basGeom]. textShapes
// är speglade och centrerade. Inlägget byggs separat med buildInlay.
function plateSpanY(plate, x) {
  if (plate.kind === "circle") {
    if (Math.abs(x) >= plate.r) return null;
    const yy = Math.sqrt(plate.r * plate.r - x * x);
    return [-yy, yy];
  }
  if (Math.abs(x) > plate.w / 2 + 1e-9) return null;
  return [-plate.d / 2, plate.d / 2];
}

export function buildPlinth(plate, textShapes) {
  const outline = new THREE.Shape();
  if (plate.kind === "circle") outline.absarc(0, 0, plate.r, 0, Math.PI * 2, false);
  else {
    const w = plate.w / 2, d = plate.d / 2;
    outline.moveTo(-w, -d); outline.lineTo(w, -d); outline.lineTo(w, d); outline.lineTo(-w, d); outline.closePath();
  }
  const base = new THREE.ExtrudeGeometry(outline, { depth: BASE_TOP - (TEXT_PLATE - BASE_OVERLAP), bevelEnabled: false });
  base.translate(0, 0, TEXT_PLATE - BASE_OVERLAP);

  const lamina = [];
  const polys = textShapes && textShapes.length ? polysFromShapes(textShapes) : [];
  const xMax = plate.kind === "circle" ? plate.r : plate.w / 2;
  const dx = 0.4;
  const n = Math.max(1, Math.round((2 * xMax) / dx));
  const w = (2 * xMax) / n;
  for (let i = 0; i < n; i++) {
    const xa = -xMax + i * w, xb = xa + w, xc = (xa + xb) / 2;
    const span = plateSpanY(plate, xc);
    if (!span) continue;
    const cov = polys.length
      ? coverageAtX(polys, xc).map(([a, b]) => [Math.max(span[0], a), Math.min(span[1], b)]).filter(([a, b]) => b > a)
      : [];
    for (const [ya, yb] of subtract([span], cov)) boxTris(xa, xb + EPS, ya, yb, 0, TEXT_PLATE + EPS, lamina);
  }
  return [trisToGeometry(lamina), base];
}
