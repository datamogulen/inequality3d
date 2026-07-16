// Kontrollerar att genererade solider är vattentäta/rimliga och skriver
// test-STL:er till out/. Kör: node scripts/check_geometry.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import opentypePkg from "opentype.js";
const parseFont = opentypePkg.parse;
import { buildStrip, buildSquare, buildSpiral, buildPlinth, buildInlay, trisToGeometry } from "../web/js/geometry.js";
import { textShapes, textBlock } from "../web/js/text.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const country = JSON.parse(readFileSync(join(ROOT, "web/data/wid_SE.json")));
const index = JSON.parse(readFileSync(join(ROOT, "web/data/index.json")));
const font = parseFont(readFileSync(join(ROOT, "web/fonts/OpenSans-Regular.ttf")).buffer);

const m = country.measures.income;
const yi = m.years.indexOf(2023);
const ppp = country.xrates.pppUsd.lcuPer;
const brackets = [];
index.brackets.forEach(([p0, p1], i) => {
  const v = m.values[i][yi];
  if (v != null) brackets.push({ p0, p1, v: Math.max(0, v / ppp) });
});
// topp 1 % → viktat snitt
const main = brackets.filter((b) => b.p1 <= 99);
const top = brackets.filter((b) => b.p0 >= 99);
const share = top.reduce((s, b) => s + (b.p1 - b.p0), 0);
const avg = top.reduce((s, b) => s + b.v * (b.p1 - b.p0), 0) / share;
const merged = [...main, { p0: 99, p1: 100, v: avg, merged: true, minLen: 0.8 }];
// kumulativ
let cs = 0;
const cum = brackets.map((b) => { cs += b.v * (b.p1 - b.p0) / 100; return { p0: b.p0, p1: b.p1, v: cs }; });

const scale = 1 / 5000;
const stripOpts = { scale, clampMm: 90, endMargin: 6, length: 180, depth: 28 };

function analyze(name, geoms) {
  let tris = 0, badParts = 0, negVol = 0;
  const bbox = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (const g of geoms) {
    const a = g.getAttribute("position").array;
    tris += a.length / 9;
    const edges = new Map();
    const key = (x, y, z) => `${Math.round(x * 5000)},${Math.round(y * 5000)},${Math.round(z * 5000)}`;
    let vol = 0;
    for (let i = 0; i < a.length; i += 9) {
      const v = [[a[i], a[i + 1], a[i + 2]], [a[i + 3], a[i + 4], a[i + 5]], [a[i + 6], a[i + 7], a[i + 8]]];
      for (const [x, y, z] of v) for (let k = 0; k < 3; k++) {
        bbox[0][k] = Math.min(bbox[0][k], [x, y, z][k]);
        bbox[1][k] = Math.max(bbox[1][k], [x, y, z][k]);
      }
      vol += (v[0][0] * (v[1][1] * v[2][2] - v[2][1] * v[1][2]) - v[1][0] * (v[0][1] * v[2][2] - v[2][1] * v[0][2]) + v[2][0] * (v[0][1] * v[1][2] - v[1][1] * v[0][2])) / 6;
      for (let e = 0; e < 3; e++) {
        const p = key(...v[e]), q = key(...v[(e + 1) % 3]);
        const fwd = p + "|" + q, rev = q + "|" + p;
        if (edges.get(rev)) { edges.set(rev, edges.get(rev) - 1); if (edges.get(rev) === 0) edges.delete(rev); }
        else edges.set(fwd, (edges.get(fwd) || 0) + 1);
      }
    }
    if (edges.size > 0) badParts++;
    if (vol <= 0) negVol++;
  }
  const f = (x) => x.map((v) => v.toFixed(1)).join(", ");
  console.log(`${name}: ${geoms.length} delar, ${tris} tri, oparade i ${badParts}, negvol ${negVol}, bbox [${f(bbox[0])}]–[${f(bbox[1])}]`);
  return badParts + negVol;
}

function writeSTL(geoms, file) {
  let tris = 0;
  for (const g of geoms) tris += g.getAttribute("position").count / 3;
  const buf = Buffer.alloc(84 + tris * 50);
  buf.write("check", 0);
  buf.writeUInt32LE(tris, 80);
  let off = 84;
  for (const g of geoms) {
    const a = g.getAttribute("position").array;
    for (let i = 0; i < a.length; i += 9) {
      const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2];
      const vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      buf.writeFloatLE(nx / l, off); buf.writeFloatLE(ny / l, off + 4); buf.writeFloatLE(nz / l, off + 8);
      for (let k = 0; k < 9; k++) buf.writeFloatLE(a[i + k], off + 12 + k * 4);
      off += 50;
    }
  }
  writeFileSync(file, buf);
}

mkdirSync(join(ROOT, "out"), { recursive: true });
let fail = 0;

function decileGlyphs() {
  const out = [];
  for (let k = 0; k < 10; k++) { const ts = textShapes(font, String(k + 1), 6, false); out.push({ shapes: ts.shapes, width: ts.width, height: ts.height }); }
  return out;
}
function bottom(plate) {
  const blk = textBlock(font, [{ text: "SVERIGE", size: 6 }, { text: "INKOMST/VUXEN PPP", size: 5 }, { text: "1 MM = 5000 USD", size: 5 }], true, 1.8);
  return blk;
}

// remsa med fenor + nummer
{
  const built = buildStrip(merged, { ...stripOpts, decileGlyphs: decileGlyphs() });
  const txt = bottom(built.plate);
  const graph = [trisToGeometry(built.graphTris)];
  const fins = [trisToGeometry(built.finTris)];
  const nums = [trisToGeometry(built.numberInlayTris)];
  const base = buildPlinth(built.plate, txt.shapes);
  const inlay = buildInlay(txt.shapes);
  fail += analyze("remsa graf(+fickor)", graph);
  fail += analyze("remsa fenor", fins);
  fail += analyze("remsa nummer-inlägg", nums);
  fail += analyze("remsa botten+gravyr", base);
  fail += analyze("remsa textinlägg", inlay);
  writeSTL([...graph, ...fins, ...nums, ...base, ...inlay], join(ROOT, "out", "test_SE_remsa_alla.stl"));
  writeSTL(graph, join(ROOT, "out", "test_SE_remsa_graf.stl"));
}
// kumulativ
{
  const built = buildStrip(cum, { ...stripOpts, decileGlyphs: decileGlyphs() });
  fail += analyze("kumulativ graf", [trisToGeometry(built.graphTris)]);
}
// kvadrat + spiral
{
  const sq = buildSquare(merged, { scale, clampMm: 90, endMargin: 6, length: 180 });
  fail += analyze("kvadrat graf", [trisToGeometry(sq.graphTris)]);
  fail += analyze("kvadrat botten", buildPlinth(sq.plate, bottom(sq.plate).shapes));
  const sp = buildSpiral(merged, { scale, clampMm: 90, endMargin: 6, length: 180, spiralWidth: 9, spiralGap: 2.7 });
  fail += analyze("spiral graf", [trisToGeometry(sp.graphTris)]);
  fail += analyze("spiral botten", buildPlinth(sp.plate, bottom(sp.plate).shapes));
}

console.log(fail === 0 ? "\nALLT OK" : `\nPROBLEM (${fail})`);
process.exit(fail ? 1 : 0);
