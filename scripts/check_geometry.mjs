// Kontrollerar att genererade solider är vattentäta, rättvända och rimliga,
// och skriver test-STL:er till out/. Kör: node scripts/check_geometry.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import opentypePkg from "opentype.js";
const parseFont = opentypePkg.parse;
import {
  buildStrip, buildSpiral, buildSquare, buildPlinth, buildInlay,
  trisToGeometry,
} from "../web/js/geometry.js";
import { textShapes } from "../web/js/text.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const country = JSON.parse(readFileSync(join(ROOT, "web/data/wid_SE.json")));
const index = JSON.parse(readFileSync(join(ROOT, "web/data/index.json")));
const font = parseFont(
  readFileSync(join(ROOT, "web/fonts/OpenSans-Bold.ttf")).buffer
);

// SE inkomst 2023 i PPP-USD, kapad vid 60 mm
const m = country.measures.income;
const yi = m.years.indexOf(2023);
const ppp = country.xrates.pppUsd.lcuPer;
const brackets = [];
index.brackets.forEach(([p0, p1], i) => {
  const v = m.values[i][yi];
  if (v != null) brackets.push({ p0, p1, v: Math.max(0, v / ppp) });
});

const opts = {
  scale: 0.5 / 10000, clampMm: 60, baseSize: 100,
  margin: 4, stripWidth: 10, spiralWidth: 7, spiralGap: 2,
};

function analyze(name, geoms) {
  let tris = 0, badParts = 0, negVol = 0;
  const bbox = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (const g of geoms) {
    const a = g.getAttribute("position").array;
    tris += a.length / 9;
    // kant-parning med positionshashning
    const edges = new Map();
    const key = (x, y, z) => `${Math.round(x * 5000)},${Math.round(y * 5000)},${Math.round(z * 5000)}`;
    let vol = 0;
    for (let i = 0; i < a.length; i += 9) {
      const v = [
        [a[i], a[i + 1], a[i + 2]],
        [a[i + 3], a[i + 4], a[i + 5]],
        [a[i + 6], a[i + 7], a[i + 8]],
      ];
      for (const [x, y, z] of v) {
        for (let k = 0; k < 3; k++) {
          bbox[0][k] = Math.min(bbox[0][k], [x, y, z][k]);
          bbox[1][k] = Math.max(bbox[1][k], [x, y, z][k]);
        }
      }
      vol += (
        v[0][0] * (v[1][1] * v[2][2] - v[2][1] * v[1][2]) -
        v[1][0] * (v[0][1] * v[2][2] - v[2][1] * v[0][2]) +
        v[2][0] * (v[0][1] * v[1][2] - v[1][1] * v[0][2])
      ) / 6;
      for (let e = 0; e < 3; e++) {
        const p = key(...v[e]), q = key(...v[(e + 1) % 3]);
        const fwd = p + "|" + q, rev = q + "|" + p;
        if (edges.get(rev)) {
          edges.set(rev, edges.get(rev) - 1);
          if (edges.get(rev) === 0) edges.delete(rev);
        } else {
          edges.set(fwd, (edges.get(fwd) || 0) + 1);
        }
      }
    }
    if (edges.size > 0) badParts++;
    if (vol <= 0) negVol++;
  }
  const f = (x) => x.map((v) => v.toFixed(1)).join(", ");
  console.log(
    `${name}: ${geoms.length} delar, ${tris} trianglar, ` +
    `oparade kanter i ${badParts} delar, negativ volym i ${negVol} delar, ` +
    `bbox [${f(bbox[0])}] – [${f(bbox[1])}]`
  );
  return { badParts, negVol };
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
const builders = { remsa: buildStrip, spiral: buildSpiral, kvadrat: buildSquare };
let fail = 0;
// modell med topp 1 % ihopslagen till viktat snitt (som appen gör)
const mainBr = brackets.filter((b) => b.p1 <= 99);
const topBr = brackets.filter((b) => b.p0 >= 99);
const share = topBr.reduce((sum, b) => sum + (b.p1 - b.p0), 0);
const avg = topBr.reduce((sum, b) => sum + b.v * (b.p1 - b.p0), 0) / share;
const mergedBr = [...mainBr, { p0: 99, p1: 100, v: avg, merged: true, minLen: 0.8 }];
console.log(`snitt topp 1 %: ${Math.round(avg)} USD → ${(avg * opts.scale).toFixed(1)} mm`);
for (const [name, build] of Object.entries(builders)) {
  const built = build(mergedBr, opts);
  const ts = textShapes(font, "SVERIGE", name === "remsa" ? 5.5 : 9);
  const geoms = [trisToGeometry(built.tris), ...buildPlinth(built.plate, ts.shapes)];
  const r = analyze(name, geoms);
  fail += r.badParts + r.negVol;
  writeSTL(geoms, join(ROOT, "out", `test_SE_${name}.stl`));
}
// textinlägg
const tsIn = textShapes(font, "SVERIGE", 9);
const inlay = buildInlay(tsIn.shapes);
const rInlay = analyze("textinlägg SVERIGE", inlay);
fail += rInlay.badParts + rInlay.negVol;
writeSTL(inlay, join(ROOT, "out", "test_SE_text_inlay.stl"));
console.log(fail === 0 ? "\nALLT OK" : "\nPROBLEM FUNNA");
process.exit(fail ? 1 : 0);
