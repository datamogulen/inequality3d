import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadIndex, loadCountry, getSeries, getComponent, getGovFootprint, MEASURE_INFO } from "./data.js";
import {
  buildStrip, buildSpiral, buildSquare, buildPlinth, buildInlay,
  qrInlayTris, trisToGeometry, stripPAt,
} from "./geometry.js";
import { loadFont, loadBoldFont, textShapes, textBlock, translateShapes } from "./text.js";
import { exportSTL } from "./stl.js";
import { t, getLang, toggleLang, applyStatic, countryName } from "./i18n.js";
import qrcode from "../vendor/qrcode.mjs";

// ---------- konstanter ----------

const STATE_V = 7; // bumpa för att nollställa inaktuella val i localStorage
const PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const PART_COLORS = {
  base: 0xd9d2c2, text: 0xd9a021, numbers: 0x2f2f2f, mean: 0x1c1c1c,
  gov: 0x9a9a92, inv: 0xb9a7ef, debt: 0xc23434, split: 0xffffff,
};
// Fasta "snygga" enheter per mått – 1 mm betyder alltid lika mycket.
const MEASURE = {
  income: { scale: 1 / 5000, unit: "USD" },
  wealth: { scale: 1 / 50000, unit: "USD" },
  carbon: { scale: 1, unit: "tCO2" },
};
const CUT_LABEL = { "99": { sv: "1 %", en: "1%" }, "99.9": { sv: "0,1 %", en: "0.1%" }, "99.99": { sv: "0,01 %", en: "0.01%" } };
const M_SHORT = { income: "inc", wealth: "wea", carbon: "co2" }; // för QR-url

// ---------- tillstånd ----------

const state = {
  v: STATE_V,
  measure: "income",
  currency: "ppp",
  year: 2023,
  countries: ["SE", "US", "CN", "IN"],
  shapes: ["strip"],
  scales: { income: MEASURE.income.scale, wealth: MEASURE.wealth.scale, carbon: MEASURE.carbon.scale },
  baseSize: 180,
  clampMm: 250, // ≈ utskriftsmax (Bambu-bädd 256 mm) – extremtoppar får synas
  cutTop: 99,
  deciles: true,   // skåror + graverade nummer (remsa)
  govMode: "flat", // "flat" = Chancel (lika/person), "income" = Oxfam
  debt: false,     // förmögenhet: skuldlager under förhöjt nollplan
  qr: true,        // QR-kod på undersidan
  stack: true,     // stapla länderna bakom varandra (minst främst)
  more: false,     // visa alla länder (varierande datakvalitet)
};
try {
  const saved = JSON.parse(localStorage.getItem("ineq3d") || "{}");
  if (saved.v === STATE_V) Object.assign(state, saved);
  else {
    for (const k of ["measure", "year", "countries", "cutTop"]) {
      if (saved[k] !== undefined) state[k] = saved[k];
    }
    if (Array.isArray(saved.shapes)) {
      const sh = saved.shapes.filter((s) => ["strip", "spiral", "square"].includes(s));
      if (sh.length) state.shapes = sh;
    }
  }
  if (state.currency !== "mer") state.currency = "ppp";
} catch { /* ignorera trasig lagring */ }

// Delbara vyer: URL-parametrar vinner över sparat läge, och adressfältet
// hålls uppdaterat så att aktuell vy alltid går att kopiera/dela.
const M_BACK = { inc: "income", wea: "wealth", co2: "carbon" };
(function applyUrlState() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].some((k) => k !== "lang")) return;
  if (M_BACK[q.get("m")]) state.measure = M_BACK[q.get("m")];
  if (q.get("c")) {
    const cs = q.get("c").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (cs.length) state.countries = cs;
  }
  if (q.get("y") && +q.get("y")) state.year = +q.get("y");
  if (q.get("sh")) {
    const sh = q.get("sh").split(",").filter((x) => ["strip", "spiral", "square"].includes(x));
    if (sh.length) state.shapes = sh;
  }
  if (q.has("stack")) state.stack = q.get("stack") !== "0";
  if (q.get("cur") === "mer") state.currency = "mer";
  if (q.has("top")) state.cutTop = +q.get("top") || 0;
  if (q.get("gov") === "inc") state.govMode = "income";
  if (q.get("debt") === "1") state.debt = true;
  if (q.get("dec") === "0") state.deciles = false;
  if (q.get("qr") === "0") state.qr = false;
})();

function stateToQuery() {
  const p = new URLSearchParams();
  p.set("m", M_SHORT[state.measure]);
  p.set("c", state.countries.join(","));
  p.set("y", String(state.year));
  p.set("sh", state.shapes.join(","));
  p.set("stack", state.stack ? "1" : "0");
  if (state.currency === "mer") p.set("cur", "mer");
  if (String(state.cutTop) !== "99") p.set("top", String(state.cutTop));
  if (state.govMode === "income") p.set("gov", "inc");
  if (state.debt) p.set("debt", "1");
  if (!state.deciles) p.set("dec", "0");
  if (!state.qr) p.set("qr", "0");
  p.set("lang", getLang());
  return "?" + p.toString();
}

function persist() {
  localStorage.setItem("ineq3d", JSON.stringify(state));
  try { history.replaceState(null, "", stateToQuery()); } catch { /* file:// m.m. */ }
}

let index = null;
let colorByCountry = new Map();
let currentModels = [];
let hoverTargets = [];

// ---------- three-scen ----------

const viewport = document.getElementById("canvas3d");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f7f5f0");
const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
camera.position.set(0, 260, 420);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xfff8ec, 0xcabfa8, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(240, 420, 180);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xfff2dd, 0.5);
fill.position.set(-260, 180, -140);
scene.add(fill);

const root = new THREE.Group();
root.rotation.x = -Math.PI / 2;
scene.add(root);
const grid = new THREE.GridHelper(3000, 150, 0xd8d2c4, 0xe8e3d8);
grid.position.y = -0.2;
scene.add(grid);

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();
window.__ineq = { camera, controls, scene, root, renderer };
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---------- data → segment ----------

// Viktat snitt av toppen (per fält) → en klass. rows: [{p0,p1,...fält}]
function mergeTopRows(rows, level, fields) {
  if (!level) return rows;
  const main = rows.filter((r) => r.p1 <= level);
  const top = rows.filter((r) => r.p0 >= level);
  if (!top.length) return rows;
  const share = top.reduce((s, r) => s + (r.p1 - r.p0), 0);
  const merged = { p0: level, p1: 100, merged: true, minLen: 0.8 };
  for (const f of fields) {
    merged[f] = top.reduce((s, r) => s + (r[f] ?? 0) * (r.p1 - r.p0), 0) / share;
  }
  main.push(merged);
  return main;
}

// Rader {p0,p1,fält...} → segmentstaplar {p0,p1,segs:[{part,z0,z1}]} i mm.
// layers: [{part, field}] i stapelordning nerifrån. Klipper vid clampMm
// (proportionellt så sammansättningen bevaras).
function rowsToSegs(rows, layers, scale, clampMm, baseZ = () => 0) {
  return rows.map((r) => {
    let z = baseZ(r);
    const raw = [];
    for (const l of layers) {
      const h = Math.max(0, (r[l.field] ?? 0) * scale);
      if (h > 1e-6) raw.push({ part: l.part, z0: z, z1: z + h });
      z += h;
    }
    let clamped = false;
    if (clampMm > 0 && z > clampMm) {
      const f = clampMm / z;
      let zz = 0;
      for (const s of raw) {
        const h = (s.z1 - s.z0) * f;
        s.z0 = zz; s.z1 = zz + h; zz += h;
      }
      clamped = true;
    }
    return { p0: r.p0, p1: r.p1, segs: raw, merged: r.merged, minLen: r.minLen, clamped };
  });
}

// CO2: rader med gov/cons/inv (Chancel- eller Oxfam-allokering av gov).
// Länder med förberäknad gov-serie per klass (Världen: olika länders
// klumpsummor blandas i varje global klass) använder den direkt; där är
// carbonCons redan enbart privat konsumtion och Oxfam-läget gäller inte.
function carbonRows(countryData, series, warns) {
  const cons = getComponent(countryData, "carbonCons", series.year);
  const inv = getComponent(countryData, "carbonInv", series.year);
  const govSeries = getComponent(countryData, "carbonGov", series.year);
  const govpc = getGovFootprint(countryData, series.year);
  if (!cons || !inv || (govpc == null && !govSeries)) return null;
  let incomeRatio = null;
  if (state.govMode === "income" && !govSeries) {
    // kvoten y_p/ȳ är valutaoberoende – PPP duger
    const inc = getSeries(countryData, "income", series.year, "ppp");
    if (inc) {
      incomeRatio = new Map(inc.brackets.map((b) => [`${b.p0}|${b.p1}`, b.vRaw / inc.mean]));
    }
  }
  if (state.govMode === "income" && govSeries && warns) warns.add(t("warn_wo_oxfam"));
  const rows = [];
  for (const b of series.brackets) {
    const key = `${b.p0}|${b.p1}`;
    const c = cons.map.get(key), i = inv.map.get(key);
    if (c == null || i == null) continue;
    let gov, priv;
    if (govSeries) {
      gov = govSeries.map.get(key) ?? 0;
      priv = c; // redan exkl. offentligt
    } else {
      const ratio = incomeRatio ? (incomeRatio.get(key) ?? 1) : 1;
      gov = govpc * ratio;
      priv = c - govpc;
    }
    rows.push({
      p0: b.p0, p1: b.p1,
      gov: Math.max(0, gov),
      cons: Math.max(0, priv),
      inv: Math.max(0, i),
    });
  }
  return rows.length > 100 ? rows : null; // kräv nästan full täckning
}

// ---------- modellbygge ----------

function shapeOpts(shape) {
  const scale = state.scales[state.measure];
  const base = { scale, clampMm: state.clampMm, endMargin: 6 };
  if (shape === "strip") {
    return { ...base, length: state.baseSize, depth: Math.max(30, state.baseSize * 0.21), grooves: state.deciles };
  }
  if (shape === "square") return { ...base, length: state.baseSize };
  const sw = Math.max(7, state.baseSize * 0.05);
  return { ...base, length: state.baseSize, spiralWidth: sw, spiralGap: sw * 0.3 };
}

function qrModules(code, plate) {
  if (!state.qr) return null;
  // gemensam kort-URL-tjänst på hedin.it (r/index.php i hedin_cleanup-repot)
  const url = `https://hedin.it/r/?p=i3d&c=${code}&m=${M_SHORT[state.measure]}`;
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const availD = (plate.kind === "circle" ? plate.r * 1.1 : plate.d) - 4;
  const side = Math.min(availD, 36);
  const mod = side / (n + 2 * quiet);
  if (mod < 0.8) return null; // för litet för att skrivas/skannas
  const sz = mod * n;
  // placeras vid högra änden (p100); speglad i x (läses underifrån)
  const cx = (plate.kind === "circle" ? plate.r * 0.45 : plate.w / 2 - sz / 2 - quiet * mod - 2);
  const cy = 0;
  const rects = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      const fc = n - 1 - c; // spegla kolumner → läsbar underifrån
      rects.push({
        x0: cx - sz / 2 + fc * mod, x1: cx - sz / 2 + (fc + 1) * mod + 0.001,
        y0: cy - sz / 2 + (n - 1 - r) * mod, y1: cy - sz / 2 + (n - r) * mod + 0.001,
      });
    }
  }
  return { rects, size: sz + 2 * quiet * mod, cx, url };
}

// bottentextens tre rader, skalade att passa plattan (minus QR-zon)
function bottomText(font, plate, cName, qrZone) {
  const curTag = MEASURE_INFO[state.measure].isMoney ? (state.currency === "mer" ? " USD" : " PPP") : "";
  const unit = state.measure === "carbon" ? t("unit_tco2") : "USD";
  const perMm = 1 / state.scales[state.measure];
  const perMmNum = perMm >= 1000 ? Math.round(perMm).toLocaleString("sv-SE") : String(+perMm.toFixed(2));
  const lines = [
    cName,
    `${t("short_" + state.measure)}/${t("per_" + state.measure)}${curTag}`,
    `1 MM = ${perMmNum} ${unit}`,
  ];
  const isRect = plate.kind !== "circle";
  const qrW = qrZone ? qrZone.size + 4 : 0;
  const availW = (isRect ? plate.w - 14 : plate.r * 1.5) - qrW;
  const availH = isRect ? Math.min(plate.d - 5, plate.w * 0.5) : plate.r * 1.4;
  let size = Math.min(7, (availH - 2 * 1.4) / 3);
  const mk = (sz) => textBlock(font, lines.map((tx, i) => ({ text: tx, size: i === 0 ? sz * 1.1 : sz })), true, sz * 0.35);
  let blk = mk(size);
  if (blk.width > availW && blk.width > 0) { size *= availW / blk.width; blk = mk(size); }
  // QR ligger vid +x-änden av plattan → centrera texten i den fria delen
  // [−w/2, w/2 − qrW], dvs. förskjut blocket −qrW/2.
  if (qrZone) translateShapes(blk.shapes, -qrW / 2, 0);
  return blk;
}

// Fetstil + stora siffror: tunna streck överlever inte tvåfärgstryck.
// Percentil där halva totalsumman ligger till vänster (50/50-markören)
function splitPercentile(brackets) {
  const total = brackets.reduce((s, b) => s + b.v * (b.p1 - b.p0), 0);
  if (total <= 0) return null;
  let cum = 0;
  for (const b of brackets) {
    const add = b.v * (b.p1 - b.p0);
    if (cum + add >= total / 2 && b.v > 0) return b.p0 + (total / 2 - cum) / b.v;
    cum += add;
  }
  return null;
}

function decileGlyphs(boldFont, depth) {
  const size = Math.min(9, depth * 0.24);
  const out = [];
  for (let k = 0; k < 10; k++) {
    const ts = textShapes(boldFont, String(k + 1), size, false);
    out.push({ shapes: ts.shapes, width: ts.width, height: ts.height });
  }
  return out;
}

function makeModel(countryData, shape, font, boldFont, warns) {
  const series = getSeries(countryData, state.measure, state.year, state.currency);
  if (!series) return null;
  const opts = shapeOpts(shape);
  const scale = state.scales[state.measure];
  const notes = [];

  let built;
  let meanH = series.mean * scale;
  if (shape === "strip") {
    let bracketRows;
    let hoverRows = null;
    if (state.measure === "carbon") {
      const rows = carbonRows(countryData, series, warns);
      if (rows) {
        const merged = mergeTopRows(rows, state.cutTop, ["gov", "cons", "inv"]);
        hoverRows = merged.map((r) => ({
          p0: r.p0, p1: r.p1, merged: r.merged,
          total: r.gov + r.cons + r.inv, gov: r.gov, cons: r.cons, inv: r.inv,
        }));
        // Oxfam-läget ändrar summan per percentil; medel är oförändrat
        bracketRows = rowsToSegs(merged, [
          { part: "gov", field: "gov" },
          { part: "cons", field: "cons" },
          { part: "inv", field: "inv" },
        ], scale, state.clampMm);
        notes.push("layers");
      }
    } else if (state.measure === "wealth" && state.debt) {
      const rows = mergeTopRows(
        series.brackets.map((b) => ({ p0: b.p0, p1: b.p1, v: b.vRaw })),
        state.cutTop, ["v"]
      );
      hoverRows = rows.map((r) => ({ p0: r.p0, p1: r.p1, merged: r.merged, v: r.v }));
      const minV = Math.min(0, ...rows.map((r) => r.v));
      const H0 = -minV * scale; // nollplanets höjd
      bracketRows = rows.map((r) => {
        const segs = [];
        if (r.v >= 0) {
          if (H0 + r.v * scale > 1e-6) segs.push({ part: "graph", z0: 0, z1: H0 + r.v * scale });
        } else {
          const zTop = H0 + r.v * scale; // < H0
          if (zTop > 1e-6) segs.push({ part: "graph", z0: 0, z1: zTop });
          segs.push({ part: "debt", z0: Math.max(0, zTop), z1: H0 });
        }
        return { p0: r.p0, p1: r.p1, segs, merged: r.merged, minLen: r.minLen };
      });
      meanH = H0 + series.mean * scale;
      // klipp vid clamp
      for (const b of bracketRows) {
        for (const s of b.segs) s.z1 = Math.min(s.z1, state.clampMm > 0 ? state.clampMm : Infinity);
        b.segs = b.segs.filter((s) => s.z1 > s.z0);
      }
      notes.push("debt");
    }
    if (!bracketRows) {
      const rows = mergeTopRows(
        series.brackets.map((b) => ({ p0: b.p0, p1: b.p1, v: b.v })),
        state.cutTop, ["v"]
      );
      hoverRows = rows.map((r) => ({ p0: r.p0, p1: r.p1, merged: r.merged, v: r.v }));
      bracketRows = rowsToSegs(rows, [{ part: "graph", field: "v" }], scale, state.clampMm);
    }
    if (state.deciles) opts.decileGlyphs = decileGlyphs(boldFont, opts.depth);
    opts.meanH = meanH > 0.5 ? meanH : null;
    opts.splitP = splitPercentile(series.brackets);
    built = buildStrip(bracketRows, opts);
    built.splitP = opts.splitP;
    built.hover = hoverRows;
    built.merged = bracketRows.some((b) => b.merged);
    built.clamped = bracketRows.some((b) => b.clamped);
  } else {
    const rows = mergeTopRows(
      series.brackets.map((b) => ({ p0: b.p0, p1: b.p1, v: b.v })),
      state.cutTop, ["v"]
    );
    const br = rows.map((r) => {
      let h = r.v * scale;
      let clamped = false;
      if (state.clampMm > 0 && h > state.clampMm) { h = state.clampMm; clamped = true; }
      return { p0: r.p0, p1: r.p1, v: h, merged: r.merged, minLen: r.minLen, clamped };
    });
    built = (shape === "square" ? buildSquare : buildSpiral)(br, opts);
    built.merged = br.some((b) => b.merged);
    built.clamped = br.some((b) => b.clamped);
  }

  const cName = countryName(countryData).toUpperCase();
  const qrZone = qrModules(countryData.code, built.plate);
  const txt = bottomText(font, built.plate, cName, qrZone);

  const cCol = colorByCountry.get(countryData.code);
  const parts = [];
  const order = ["graph", "gov", "cons", "inv", "debt", "mean", "split", "numbers"];
  for (const key of order) {
    const tris = built.parts[key];
    if (!tris || !tris.length) continue;
    const color = key === "graph" || key === "cons" ? cCol : new THREE.Color(PART_COLORS[key]);
    parts.push({ key, geoms: [trisToGeometry(tris)], color });
  }
  parts.push({ key: "base", geoms: buildPlinth(built.plate, txt.shapes, qrZone ? qrZone.rects : []), color: new THREE.Color(PART_COLORS.base) });
  const textGeoms = buildInlay(txt.shapes);
  if (qrZone) textGeoms.push(trisToGeometry(qrInlayTris(qrZone.rects)));
  parts.push({ key: "text", geoms: textGeoms, color: new THREE.Color(PART_COLORS.text) });

  return { series, built, parts, notes };
}

function disposeModels() {
  for (const m of currentModels) {
    m.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    root.remove(m.group);
  }
  currentModels = [];
  hoverTargets = [];
}

// Markskylt: text ritad på canvas → plan som ligger på marken framför
// (eller bredvid) modellen. Skyms naturligt och kan aldrig täcka graferna.
function makeGroundLabel(line1, line2, wMm) {
  const hMm = 20;
  const px = 6; // px per mm
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(wMm * px);
  canvas.height = Math.round(hMm * px);
  const ctx = canvas.getContext("2d");
  const r = 10;
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.strokeStyle = "#d8d2c4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, r);
  ctx.fill(); ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#26241f";
  ctx.font = `bold ${6.4 * px}px -apple-system, Helvetica, sans-serif`;
  ctx.fillText(line1, canvas.width / 2, 8.6 * px, canvas.width - 20);
  ctx.fillStyle = "#6b675e";
  ctx.font = `${4.4 * px}px -apple-system, Helvetica, sans-serif`;
  ctx.fillText(line2, canvas.width / 2, 15.6 * px, canvas.width - 20);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(wMm, hMm),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  mesh.renderOrder = 1;
  return mesh;
}

function assignColors() {
  const map = new Map();
  state.countries.forEach((c, i) => {
    const base = new THREE.Color(PALETTE[i % PALETTE.length]);
    if (i >= PALETTE.length) base.multiplyScalar(0.65);
    map.set(c, base);
  });
  colorByCountry = map;
}

function fmtH(mm) { return mm >= 1000 ? (mm / 1000).toFixed(1) + " m" : Math.round(mm) + " mm"; }
const cutLabel = () => CUT_LABEL[String(state.cutTop)]?.[getLang()] ?? "";

async function rebuild() {
  const status = document.getElementById("status");
  status.textContent = t("building");
  assignColors();
  const [font, boldFont] = await Promise.all([loadFont(), loadBoldFont()]);
  const countryDatas = await Promise.all(state.countries.map(loadCountry));
  disposeModels();

  const gapX = 40, gapY = 96;
  const warns = new Set();
  // i stapelläge sorteras länderna minst→störst (efter medelvärde)
  const order = [...countryDatas].filter(Boolean);
  if (state.stack) {
    order.sort((a, b) => {
      const sa = getSeries(a, state.measure, state.year, state.currency);
      const sb = getSeries(b, state.measure, state.year, state.currency);
      return (sa?.mean ?? Infinity) - (sb?.mean ?? Infinity);
    });
  }
  let col = 0;
  const stackY = state.shapes.map(() => 0); // ackumulerat djup per formkolumn
  for (let ci = 0; ci < order.length; ci++) {
    const cd = order[ci];
    const cName = countryName(cd);
    let any = false;
    for (let si = 0; si < state.shapes.length; si++) {
      const shape = state.shapes[si];
      const model = makeModel(cd, shape, font, boldFont, warns);
      if (!model) { warns.add(t("warn_nodata")(cName)); continue; }
      any = true;
      const { series, built, parts, notes } = model;
      const group = new THREE.Group();
      const dataParts = new Set(["graph", "gov", "cons", "inv", "debt", "mean", "split", "numbers"]);
      for (const part of parts) {
        const mat = new THREE.MeshStandardMaterial({
          color: part.color, roughness: part.key === "base" ? 0.8 : 0.62, metalness: 0.03,
        });
        for (const g of part.geoms) {
          const mesh = new THREE.Mesh(g, mat);
          group.add(mesh);
          if (dataParts.has(part.key)) hoverTargets.push(mesh);
        }
      }
      const halfD = built.plate.kind === "circle" ? built.plate.r : built.plate.d / 2;
      const plateW = built.plate.kind === "circle" ? built.plate.r * 2 : built.plate.w;
      if (state.stack) {
        // samma x för alla länder; plattorna kant-i-kant bakåt
        group.position.set(si * (state.baseSize + gapX + 60), stackY[si] + halfD, 0);
        stackY[si] += 2 * halfD + 2;
      } else {
        group.position.set(col * (state.baseSize + gapX), si * (state.baseSize + gapY), 0);
      }
      root.add(group);

      // markskylt (canvas-textur, ligger på marken – skymmer aldrig)
      const bits = [t("lbl_top")(fmtH(built.stats.maxH))];
      if (built.clamped) bits.push(t("lbl_clampnote")(state.clampMm));
      if (built.splitP) bits.push(t("lbl_split")(Math.round(built.splitP)));
      if (built.merged) bits.push(t("lbl_merged")(cutLabel()));
      if (state.measure === "carbon" && shape === "strip" && !notes.includes("layers")) {
        warns.add(t("warn_nolayers")(cName));
      }
      const line1 = `${cName} · ${series.year}`;
      const line2 = bits.join(" · ");
      if (state.stack) {
        // skylt till vänster om modellen, roterad längs djupled
        const lbl = makeGroundLabel(line1, line2, Math.max(70, 2 * halfD - 4));
        lbl.rotation.z = -Math.PI / 2;
        lbl.position.set(-plateW / 2 - 14, 0, 0.06);
        group.add(lbl);
      } else {
        const lbl = makeGroundLabel(line1, line2, Math.min(plateW, 190));
        lbl.position.set(0, -halfD - 12, 0.06);
        group.add(lbl);
      }

      if (series.clampedNeg && !(state.measure === "wealth" && state.debt)) warns.add(t("warn_neg")(cName));
      const fm = t("file_measure")[state.measure];
      currentModels.push({
        code: cd.code, name: cName, shape, parts, series, group,
        map: built.map, hover: built.hover,
        basename: `${cd.code}_${fm}_${series.year}_${t("shape_" + shape)}`,
      });
      for (const mesh of group.children) {
        if (mesh.isMesh && hoverTargets.includes(mesh)) mesh.userData.model = currentModels[currentModels.length - 1];
      }
    }
    if (any) col++;
  }
  if (state.measure === "carbon") warns.add(t("warn_carbon"));

  renderExports();
  renderWarnings([...warns]);
  const perMm = 1 / state.scales[state.measure];
  const unit = state.measure === "carbon" ? "tCO₂e" : "USD";
  status.textContent = t("status2")(currentModels.length, t("measure_" + state.measure), fmtNum(perMm), unit);
  fitCameraIfNeeded();
  persist();
}

function fmtNum(x) {
  return x >= 1000 ? Math.round(x).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-US") : String(+x.toFixed(2));
}

let lastFitKey = "";
function fitCameraIfNeeded() {
  const key = `${state.countries.join()}|${state.shapes.join()}|${state.baseSize}|${state.stack}`;
  if (key === lastFitKey || !currentModels.length) return;
  lastFitKey = key;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const h = state.baseSize / 2 + 30;
  for (const m of currentModels) {
    minX = Math.min(minX, m.group.position.x - h);
    maxX = Math.max(maxX, m.group.position.x + h);
    minY = Math.min(minY, m.group.position.y - h);
    maxY = Math.max(maxY, m.group.position.y + h);
  }
  root.updateMatrixWorld(true);
  const pts = [
    new THREE.Vector3(minX, minY, 0), new THREE.Vector3(maxX, minY, 0),
    new THREE.Vector3(minX, maxY, 0), new THREE.Vector3(maxX, maxY, 0),
  ].map((p) => p.applyMatrix4(root.matrixWorld));
  const box = new THREE.Box3().setFromPoints(pts);
  const c = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3());
  const d = Math.max(sz.x, sz.z * 1.6) * 0.75 + 180;
  controls.target.set(c.x, 20, c.z);
  camera.position.set(c.x, d * 0.62, box.max.z + d * 0.85);
}

// ---------- export ----------

const PART_ORDER = ["graph", "gov", "cons", "inv", "debt", "mean", "split", "base", "numbers", "text"];

function renderExports() {
  const el = document.getElementById("exports");
  el.innerHTML = "";
  for (const m of currentModels) {
    const row = document.createElement("div");
    row.className = "kv";
    const lbl = document.createElement("span");
    lbl.textContent = `${m.name} · ${t("shape_" + m.shape)}`;
    const btns = document.createElement("span");
    btns.className = "btns";
    for (const key of PART_ORDER) {
      const p = m.parts.find((x) => x.key === key);
      if (!p || !p.geoms.length) continue;
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = t("part_" + key);
      b.onclick = () => exportSTL(p.geoms, `${m.basename}_${t("file_" + key)}.stl`);
      btns.appendChild(b);
    }
    row.append(lbl, btns);
    el.appendChild(row);
  }
  if (!currentModels.length) el.innerHTML = `<span class="hint">${t("no_models")}</span>`;
}
document.getElementById("exportAll").onclick = () => {
  let i = 0;
  for (const m of currentModels) {
    for (const key of PART_ORDER) {
      const p = m.parts.find((x) => x.key === key);
      if (p && p.geoms.length) {
        setTimeout(() => exportSTL(p.geoms, `${m.basename}_${t("file_" + key)}.stl`), i++ * 350);
      }
    }
  }
};

function renderWarnings(warns) {
  const el = document.getElementById("warn");
  el.style.display = warns.length ? "block" : "none";
  el.innerHTML = warns.map((w) => "⚠ " + w).join("<br>");
}

// ---------- hover: data för punkten under muspekaren ----------

const $ = (id) => document.getElementById(id);
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

function fmtTipVal(v) {
  if (state.measure === "carbon") {
    return v.toLocaleString(getLang() === "sv" ? "sv-SE" : "en-US", { maximumFractionDigits: 1 }) + " t";
  }
  return Math.round(v).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-US") + " USD";
}

function onPointerMove(e) {
  const tip = $("tip");
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(hoverTargets, false);
  if (!hits.length) { tip.style.display = "none"; return; }
  const hit = hits[0];
  const m = hit.object.userData.model;
  if (!m) { tip.style.display = "none"; return; }
  let html = `<b>${m.name}</b> ${m.series.year}`;
  if (m.map && m.hover) {
    const local = hit.object.parent.worldToLocal(hit.point.clone());
    const p = stripPAt(m.map, local.x);
    const row = m.hover.find((r) => p >= r.p0 - 1e-9 && p <= r.p1 + 1e-9);
    if (row) {
      const dec = Math.min(10, Math.floor(row.p0 / 10) + 1);
      const pLbl = row.merged
        ? `p99–100 · ${t("lbl_merged")(cutLabel())}`
        : `p${Math.floor(p)} · ${t("tip_decile")} ${dec}`;
      html += ` · ${pLbl}<br>`;
      if (row.total != null) {
        html += `<b>${fmtTipVal(row.total)}</b> = ${t("part_gov").toLowerCase()} ${fmtTipVal(row.gov)} + ${t("part_cons").toLowerCase()} ${fmtTipVal(row.cons)} + ${t("part_inv").toLowerCase()} ${fmtTipVal(row.inv)}`;
      } else {
        html += `<b>${fmtTipVal(row.v)}</b>${row.v < 0 ? " (" + t("part_debt").toLowerCase() + ")" : ""}`;
      }
    }
  } else {
    html += ` · ${t("shape_" + m.shape)}`;
  }
  tip.innerHTML = html;
  tip.style.display = "block";
  const vp = viewport.getBoundingClientRect();
  let x = e.clientX - vp.left + 14, y = e.clientY - vp.top + 14;
  if (x + tip.offsetWidth > vp.width - 8) x = e.clientX - vp.left - tip.offsetWidth - 10;
  if (y + tip.offsetHeight > vp.height - 8) y = e.clientY - vp.top - tip.offsetHeight - 10;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerleave", () => { $("tip").style.display = "none"; });

// ---------- kontroller ----------

function syncControls() {
  applyStatic();
  $("langBtn").textContent = t("langBtn");
  document.querySelectorAll('input[name="measure"]').forEach((r) => {
    r.checked = r.value === state.measure;
  });
  $("currency").value = state.currency;
  $("currencyRow").style.display = MEASURE_INFO[state.measure].isMoney ? "flex" : "none";
  $("govRow").style.display = state.measure === "carbon" ? "flex" : "none";
  $("govMode").value = state.govMode;
  $("debtRow").style.display = state.measure === "wealth" ? "flex" : "none";
  $("debt").checked = state.debt;
  const maxYear = state.measure === "carbon" ? 2019 : 2024;
  const yr = $("year");
  yr.max = maxYear;
  if (+yr.value > maxYear) state.year = maxYear;
  yr.value = state.year;
  $("yearLabel").textContent = state.year;
  $("yearHint").textContent = t(state.measure === "carbon" ? "yearHintCarbon" : "yearHint");
  document.querySelectorAll('input[name="shape"]').forEach((c) => (c.checked = state.shapes.includes(c.value)));
  $("cutTop").value = String(state.cutTop);
  $("deciles").checked = state.deciles;
  $("qr").checked = state.qr;
  $("stack").checked = state.stack;
  $("moreCountries").checked = state.more;
  $("moreLink").href = `m.html?c=${state.countries[0] || "SE"}&m=${M_SHORT[state.measure]}&lang=${getLang()}`;
  $("scaleUnit").textContent = t("scale_per_mm") + " " + (state.measure === "carbon" ? "tCO₂e" : "USD");
  $("scale").value = fmtScaleInput();
  $("baseSize").value = state.baseSize;
  $("clampMm").value = state.clampMm;
  renderCountryList();
}

function fmtScaleInput() {
  const perMm = 1 / state.scales[state.measure];
  return +perMm.toFixed(perMm >= 100 ? 0 : 2);
}

function renderCountryList() {
  const el = $("countries");
  el.innerHTML = "";
  assignColors();
  const visible = index.countries.filter(
    (c) => c.core !== false || state.more || state.countries.includes(c.code)
  );
  for (const c of visible) {
    const lab = document.createElement("label");
    lab.className = "row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.countries.includes(c.code);
    cb.onchange = () => {
      if (cb.checked) state.countries.push(c.code);
      else state.countries = state.countries.filter((x) => x !== c.code);
      syncControls();
      rebuild();
    };
    const sw = document.createElement("span");
    sw.className = "swatch";
    const col = colorByCountry.get(c.code);
    sw.style.background = col ? "#" + col.getHexString() : "#e4e0d6";
    lab.append(cb, sw, document.createTextNode(" " + countryName(c)));
    if (c.core === false && c.quality > 0) {
      const q = document.createElement("span");
      q.className = "hint";
      q.style.marginLeft = "auto";
      q.textContent = `dq ${c.quality}`;
      q.title = t("dq_title");
      lab.appendChild(q);
    }
    el.appendChild(lab);
  }
}

document.querySelectorAll('input[name="measure"]').forEach((r) =>
  r.addEventListener("change", () => { state.measure = r.value; syncControls(); rebuild(); }));
$("currency").addEventListener("change", (e) => { state.currency = e.target.value; syncControls(); rebuild(); });
$("govMode").addEventListener("change", (e) => { state.govMode = e.target.value; rebuild(); });
$("debt").addEventListener("change", (e) => { state.debt = e.target.checked; rebuild(); });
$("qr").addEventListener("change", (e) => { state.qr = e.target.checked; rebuild(); });
$("year").addEventListener("input", (e) => { state.year = +e.target.value; $("yearLabel").textContent = state.year; });
$("year").addEventListener("change", () => rebuild());
document.querySelectorAll('input[name="shape"]').forEach((c) =>
  c.addEventListener("change", () => {
    state.shapes = [...document.querySelectorAll('input[name="shape"]:checked')].map((x) => x.value);
    if (!state.shapes.length) { state.shapes = [c.value]; c.checked = true; }
    rebuild();
  }));
$("cutTop").addEventListener("change", (e) => { state.cutTop = +e.target.value; rebuild(); });
$("deciles").addEventListener("change", (e) => { state.deciles = e.target.checked; rebuild(); });
document.querySelectorAll(".quick button[data-set]").forEach((b) =>
  b.addEventListener("click", () => { state.countries = b.dataset.set ? b.dataset.set.split(",") : []; syncControls(); rebuild(); }));
$("scale").addEventListener("change", (e) => {
  const perMm = parseFloat(e.target.value);
  if (perMm > 0) state.scales[state.measure] = 1 / perMm;
  syncControls();
  rebuild();
});
$("scaleNice").addEventListener("click", () => { state.scales[state.measure] = MEASURE[state.measure].scale; syncControls(); rebuild(); });
$("baseSize").addEventListener("change", (e) => { state.baseSize = Math.max(60, Math.min(256, +e.target.value || 180)); syncControls(); rebuild(); });
$("clampMm").addEventListener("change", (e) => { state.clampMm = Math.max(0, +e.target.value || 0); rebuild(); });
$("stack").addEventListener("change", (e) => { state.stack = e.target.checked; rebuild(); });
$("moreCountries").addEventListener("change", (e) => { state.more = e.target.checked; renderCountryList(); persist(); });
$("langBtn").addEventListener("click", () => { toggleLang(); syncControls(); rebuild(); });
$("shareBtn").addEventListener("click", async () => {
  const url = location.origin + location.pathname + stateToQuery();
  try {
    await navigator.clipboard.writeText(url);
    $("shareBtn").textContent = "✓";
  } catch {
    prompt("URL:", url);
  }
  setTimeout(() => { $("shareBtn").textContent = "🔗"; }, 1400);
});

// ---------- play: animera årsutvecklingen ----------
let playing = false;
async function playLoop() {
  while (playing) {
    const maxYear = state.measure === "carbon" ? 2019 : 2024;
    if (state.year >= maxYear) break;
    state.year++;
    $("year").value = state.year;
    $("yearLabel").textContent = state.year;
    await rebuild();
    await new Promise((r) => setTimeout(r, 220));
  }
  playing = false;
  $("playBtn").textContent = "▶";
}
$("playBtn").addEventListener("click", () => {
  if (playing) { playing = false; $("playBtn").textContent = "▶"; return; }
  const maxYear = state.measure === "carbon" ? 2019 : 2024;
  if (state.year >= maxYear) {
    state.year = 1990;
    $("year").value = 1990;
    $("yearLabel").textContent = "1990";
  }
  playing = true;
  $("playBtn").textContent = "⏸";
  playLoop();
});

// ---------- start ----------

(async () => {
  document.getElementById("status").textContent = t("loading");
  index = await loadIndex();
  state.countries = state.countries.filter((c) => index.countries.some((x) => x.code === c));
  syncControls();
  await rebuild();
})().catch((e) => {
  document.getElementById("status").textContent = "Fel/Error: " + e.message;
  console.error(e);
});
