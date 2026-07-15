// Bygger vattentäta solider (Z-upp, mm) för de tre formerna.
// Varje percentilklass blir en egen sluten "svept låda" längs en bana;
// lådorna överlappar varandra och bottenplattan marginellt (EPS) så att
// slicern kan slå ihop dem till en solid utan koplanära ytor.

import * as THREE from "three";

const EPS = 0.06;          // överlapp mellan delar, mm
export const TEXT_PLATE = 0.7;   // textplattans tjocklek (gravyrdjup), mm
export const BASE_TOP = 1.6;     // plintens totala höjd, mm
const BASE_OVERLAP = 0.1;

// ---------- svept låda ----------

// pts: [[x,y],...] centrumlinje; w: bredd; z0..z1: höjd.
// Returnerar platta trianglar som läggs till out (Array<number>).
function sweptBox(pts, w, z0, z1, out) {
  const n = pts.length;
  if (n < 2 || z1 <= z0) return;
  const half = w / 2;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    // riktning: medel av angränsande segment (miter)
    let dx = 0, dy = 0;
    if (i > 0) { dx += pts[i][0] - pts[i - 1][0]; dy += pts[i][1] - pts[i - 1][1]; }
    if (i < n - 1) { dx += pts[i + 1][0] - pts[i][0]; dy += pts[i + 1][1] - pts[i][1]; }
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // vänsternormal
    L.push([pts[i][0] + nx * half, pts[i][1] + ny * half]);
    R.push([pts[i][0] - nx * half, pts[i][1] - ny * half]);
  }
  const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const P = (p, z) => [p[0], p[1], z];
  for (let i = 0; i < n - 1; i++) {
    const li = L[i], lj = L[i + 1], ri = R[i], rj = R[i + 1];
    // topp (+Z)
    tri(P(li, z1), P(ri, z1), P(rj, z1)); tri(P(li, z1), P(rj, z1), P(lj, z1));
    // botten (−Z)
    tri(P(li, z0), P(rj, z0), P(ri, z0)); tri(P(li, z0), P(lj, z0), P(rj, z0));
    // vänstervägg
    tri(P(li, z0), P(lj, z1), P(lj, z0)); tri(P(li, z0), P(li, z1), P(lj, z1));
    // högervägg
    tri(P(ri, z0), P(rj, z0), P(rj, z1)); tri(P(ri, z0), P(rj, z1), P(ri, z1));
  }
  // startgavel (utåt = −riktning)
  tri(P(L[0], z0), P(R[0], z0), P(R[0], z1));
  tri(P(L[0], z0), P(R[0], z1), P(L[0], z1));
  // slutgavel
  const e = n - 1;
  tri(P(L[e], z0), P(R[e], z1), P(R[e], z0));
  tri(P(L[e], z0), P(L[e], z1), P(R[e], z1));
}

export function trisToGeometry(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// förläng en polylinje med d mm i båda ändar (för överlapp)
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

// ---------- gemensam höjdlogik ----------

function barHeight(v, opts) {
  const h = v * opts.scale;
  if (opts.clampMm > 0 && h > opts.clampMm) return { h: opts.clampMm, truncated: true };
  return { h, truncated: false };
}

// ---------- formerna ----------
// Alla returnerar { tris:[...koordinater], plate:{kind, ...mått}, stats }

export function buildStrip(brackets, opts) {
  const L = opts.baseSize - 2 * opts.margin;
  const w = opts.stripWidth;
  const x0 = -L / 2;
  const out = [];
  let truncated = 0, maxH = 0;
  for (const b of brackets) {
    const { h, truncated: t } = barHeight(b.v, opts);
    if (t) truncated++;
    if (h <= 0) continue;
    maxH = Math.max(maxH, h);
    const xa = x0 + (b.p0 / 100) * L, xb = x0 + (b.p1 / 100) * L;
    const path = extendPath([[xa, 0], [xb, 0]], EPS);
    sweptBox(path, w, BASE_TOP - BASE_OVERLAP, BASE_TOP + h, out);
  }
  return {
    tris: out,
    plate: { kind: "rect", w: opts.baseSize, d: w + 2 * opts.margin },
    stats: { truncated, maxH },
  };
}

export function buildSquare(brackets, opts) {
  const S = opts.baseSize - 2 * opts.margin;
  const pitch = S / 10;
  const w = pitch * 0.78;
  const out = [];
  let truncated = 0, maxH = 0;
  for (const b of brackets) {
    const { h, truncated: t } = barHeight(b.v, opts);
    if (t) truncated++;
    if (h <= 0) continue;
    maxH = Math.max(maxH, h);
    const row = Math.min(9, Math.floor(b.p0 / 10));
    // rad 0 (fattigast) närmast betraktaren (lägst y)
    const y = -S / 2 + (row + 0.5) * pitch;
    const fx = (p) => -S / 2 + ((p - row * 10) / 10) * S;
    const path = extendPath([[fx(b.p0), y], [fx(b.p1), y]], EPS);
    sweptBox(path, w, BASE_TOP - BASE_OVERLAP, BASE_TOP + h, out);
  }
  return {
    tris: out,
    plate: { kind: "rect", w: opts.baseSize, d: opts.baseSize },
    stats: { truncated, maxH },
  };
}

export function buildSpiral(brackets, opts) {
  const R = opts.baseSize / 2;
  const rOut = R - opts.margin - opts.spiralWidth / 2;
  const rIn = Math.max(4, opts.spiralWidth * 0.8);
  const pitch = opts.spiralWidth + opts.spiralGap;
  const bCoef = pitch / (2 * Math.PI);
  const thetaEnd = (rOut - rIn) / bCoef;
  // båglängd s(θ) ≈ ∫ r dθ = rOut·θ − b·θ²/2 (b² försumbart)
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
    const t0 = thetaAt(b.p0 / 100), t1 = thetaAt(b.p1 / 100);
    const steps = Math.max(2, Math.ceil((t1 - t0) / 0.09));
    const path = [];
    for (let i = 0; i <= steps; i++) path.push(pointAt(t0 + ((t1 - t0) * i) / steps));
    sweptBox(extendPath(path, EPS), opts.spiralWidth, BASE_TOP - BASE_OVERLAP, BASE_TOP + h, out);
  }
  return {
    tris: out,
    plate: { kind: "circle", r: R },
    stats: { truncated, maxH },
  };
}

// ---------- toppdel (utelämnade topp-klasser) ----------
// Två stilar:
//  "avg"    – EN klump med viktad snitthöjd för hela den utelämnade
//             gruppen och VERKLIG bas (samma mm per percentil som
//             modellen; golv 0,8 mm för utskrivbarhet). Standard.
//  "stairs" – trappa med full detalj upp till sista hundradelen, med
//             lika breda klasser (verklig bredd vore mikroskopisk).

export const TOP_BAR_W = 4;      // bredd per klass i trappstilen, mm
const MIN_TOP_W = 0.8;           // minsta utskrivbara bastjocklek, mm

function topBoxes(brackets, opts, style) {
  if (style === "avg") {
    const share = brackets.reduce((s, b) => s + (b.p1 - b.p0), 0);
    if (share <= 0) return { boxes: [], floored: false, avg: 0 };
    const avg = brackets.reduce((s, b) => s + b.v * (b.p1 - b.p0), 0) / share;
    const L = opts.baseSize - 2 * opts.margin;
    const trueW = (share * L) / 100;
    const w = Math.max(MIN_TOP_W, trueW);
    return {
      boxes: [{ x0: -w / 2, x1: w / 2, h: avg * opts.scale }],
      floored: trueW < MIN_TOP_W,
      avg,
    };
  }
  const n = brackets.length;
  const w = TOP_BAR_W;
  const x0 = -(n * w) / 2;
  return {
    boxes: brackets.map((b, i) => ({
      x0: x0 + i * w,
      x1: x0 + (i + 1) * w,
      h: b.v * opts.scale,
    })),
    floored: false,
  };
}

// Stående, på egen liten plint – för visning bredvid modellen.
export function buildTopPiece(brackets, opts, style = "avg") {
  const { boxes, floored, avg } = topBoxes(brackets, opts, style);
  const out = [];
  let maxH = 0;
  for (const b of boxes) {
    if (b.h <= 0) continue;
    maxH = Math.max(maxH, b.h);
    sweptBox(extendPath([[b.x0, 0], [b.x1, 0]], EPS), opts.stripWidth,
      BASE_TOP - BASE_OVERLAP, BASE_TOP + b.h, out);
  }
  const extent = boxes.length
    ? boxes[boxes.length - 1].x1 - boxes[0].x0 : TOP_BAR_W;
  return {
    tris: out,
    plate: {
      kind: "rect",
      w: Math.max(extent, 8) + 2 * opts.margin,
      d: opts.stripWidth + 2 * opts.margin,
    },
    stats: { truncated: 0, maxH, floored, avg },
  };
}

// Liggande segment för utskrift: skivor om segLen mm, roterade att ligga
// på rygg (forna z-axeln längs +y), utlagda sida vid sida med mellanrum.
// Klasserna är sorterade stigande ⇒ varje skiva är sammanhängande.
export function buildTopSegments(brackets, opts, segLen, style = "avg") {
  const { boxes } = topBoxes(brackets, opts, style);
  const maxH = Math.max(0, ...boxes.map((b) => b.h));
  const nSeg = Math.max(1, Math.ceil(maxH / segLen));
  const geoms = [];
  let offX = 0;
  for (let k = 0; k < nSeg; k++) {
    const zA = k * segLen, zB = (k + 1) * segLen;
    const out = [];
    let minX = Infinity, maxX = -Infinity;
    for (const b of boxes) {
      const top = Math.min(b.h, zB);
      if (top <= zA) continue;
      minX = Math.min(minX, b.x0); maxX = Math.max(maxX, b.x1);
      sweptBox(extendPath([[b.x0, 0], [b.x1, 0]], EPS), opts.stripWidth,
        0, top - zA, out);
    }
    if (!out.length) continue;
    const g = trisToGeometry(out);
    // lägg på rygg: z → +y, djupet blir tjocklek; ställ på bädden (z=0)
    g.rotateX(Math.PI / 2);
    g.translate(offX - minX, 0, opts.stripWidth / 2);
    geoms.push(g);
    offX += (maxX - minX) + 6;
  }
  return { geoms, nSeg, maxH };
}

// ---------- textinlägg (för flerfärgstryck) ----------
// Bokstäverna som egen solid, 0–0,6 mm, i SAMMA koordinater som plattan –
// jackar i gravyren. Skriv ut med undersidan (z=0) mot bädden.

export const INLAY_H = TEXT_PLATE - BASE_OVERLAP; // = gravyrens djup

export function buildInlay(textShapes) {
  // Extrudera glyfen direkt (kurvform) – polygoniserad variant gav
  // oparade kanter för R:s hål. Konturen avviker <0,01 mm från
  // gravyrhålet (annan kurvsampling), försumbart för utskrift.
  return textShapes.map((glyph) =>
    dropDegenerateTris(
      new THREE.ExtrudeGeometry(glyph, { depth: INLAY_H, bevelEnabled: false })
    )
  );
}

// ---------- plint med graverad text ----------

// Earcut lämnar ibland noll-area-trianglar (hål-bryggor längs t.ex.
// baslinjen i text). De är osynliga men ger "oparade kanter" i STL-koll –
// släng dem.
function dropDegenerateTris(geom) {
  const a = geom.getAttribute("position").array;
  const keep = [];
  for (let i = 0; i < a.length; i += 9) {
    const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2];
    const vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz > 1e-16) {
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
  g.computeVertexNormals();
  return g;
}

// Tar bort dubbletter och kollinjära punkter ur en sluten kontur.
// Viktigt för vattentäthet: earcut slopar kollinjära punkter i locken,
// medan extruderingens väggar behåller dem – ger T-korsningar i STL:en.
function cleanContour(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n], p = pts[i], next = pts[(i + 1) % n];
    if (Math.hypot(p.x - next.x, p.y - next.y) < 1e-6) continue; // dubblett
    const area = (p.x - prev.x) * (next.y - prev.y) - (next.x - prev.x) * (p.y - prev.y);
    if (Math.abs(area) < 1e-7) continue; // kollinjär
    out.push(p);
  }
  return out;
}

// textShapes: THREE.Shape[] (speglade, centrerade, i mm) eller null.
// Returnerar [{geometry}] – textplatta (med hål + öar) + solid bottenplatta.
export function buildPlinth(plate, textShapes) {
  const outline = () => {
    const s = new THREE.Shape();
    if (plate.kind === "circle") {
      s.absarc(0, 0, plate.r, 0, Math.PI * 2, false);
    } else {
      const w = plate.w / 2, d = plate.d / 2;
      s.moveTo(-w, -d); s.lineTo(w, -d); s.lineTo(w, d); s.lineTo(-w, d); s.closePath();
    }
    return s;
  };

  const parts = [];
  // Textplatta 0..TEXT_PLATE med texthål; bokstavsöar (t.ex. mitten av O)
  // läggs som egna solider – de bärs upp av basplattan ovanför.
  const textPlate = outline();
  const islands = [];
  if (textShapes) {
    for (const glyph of textShapes) {
      const outer = new THREE.Path(cleanContour(glyph.getPoints(20)));
      textPlate.holes.push(outer);
      for (const hole of glyph.holes) {
        islands.push(new THREE.Shape(cleanContour(hole.getPoints(20))));
      }
    }
  }
  const extrude = (shape, z0, z1) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
    g.translate(0, 0, z0);
    return dropDegenerateTris(g);
  };
  parts.push(extrude(textPlate, 0, TEXT_PLATE + EPS));
  for (const isl of islands) parts.push(extrude(isl, 0, TEXT_PLATE + EPS));
  // Basplatta (solid) ovanpå, överlappar textplattan
  parts.push(extrude(outline(), TEXT_PLATE - BASE_OVERLAP, BASE_TOP));
  return parts;
}
