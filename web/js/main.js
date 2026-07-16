import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { loadIndex, loadCountry, getSeries, MEASURE_INFO } from "./data.js";
import { buildStrip, buildSpiral, buildSquare, buildPlinth, buildInlay, trisToGeometry } from "./geometry.js";
import { loadFont, textShapes, textBlock } from "./text.js";
import { exportSTL } from "./stl.js";
import { t, getLang, toggleLang, applyStatic, countryName } from "./i18n.js";

// ---------- konstanter ----------

const STATE_V = 2; // bumpa för att nollställa gamla skalor/storlekar i localStorage
const PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const COL_BASE = 0xd9d2c2, COL_FIN = 0x2f2f2f, COL_TEXT = 0xd9a021, COL_NUM = 0x2f2f2f;

// Fasta "snygga" enheter per mått – 1 mm betyder alltid lika mycket.
const MEASURE = {
  income: { scale: 1 / 5000, per: 5000, unit: "USD" },
  wealth: { scale: 1 / 50000, per: 50000, unit: "USD" },
  carbon: { scale: 1, per: 1, unit: "tCO2" },
};
const CUT_LABEL = { "99": { sv: "1 %", en: "1%" }, "99.9": { sv: "0,1 %", en: "0.1%" }, "99.99": { sv: "0,01 %", en: "0.01%" } };
// former: strip & cum använder buildStrip
const BUILDERS = { strip: buildStrip, cum: buildStrip, spiral: buildSpiral, square: buildSquare };
const STRIP_SHAPES = new Set(["strip", "cum"]);

// ---------- tillstånd ----------

const state = {
  v: STATE_V,
  measure: "income",
  currency: "ppp",
  source: "wid",
  year: 2023,
  countries: ["SE", "US", "CN", "IN"],
  shapes: ["strip"],
  scales: { income: MEASURE.income.scale, wealth: MEASURE.wealth.scale, carbon: MEASURE.carbon.scale },
  baseSize: 180,
  clampMm: 90,
  cutTop: 99,
  deciles: true, // fenor + nummer på remsan
};
try {
  const saved = JSON.parse(localStorage.getItem("ineq3d") || "{}");
  if (saved.v === STATE_V) Object.assign(state, saved);
  else { // migrera: behåll val men nollställ skalor/storlek
    for (const k of ["measure", "currency", "source", "year", "countries", "shapes", "cutTop"]) {
      if (saved[k] !== undefined) state[k] = saved[k];
    }
  }
} catch { /* ignorera trasig lagring */ }
function persist() { localStorage.setItem("ineq3d", JSON.stringify(state)); }

let index = null;
let colorByCountry = new Map();
let currentModels = [];

// ---------- three-scen ----------

const viewport = document.getElementById("canvas3d");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
viewport.appendChild(labelRenderer.domElement);

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
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();
window.__ineq = { camera, controls, scene, root, renderer };
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// ---------- data-transformer ----------

function mergeTop(brackets, level) {
  if (!level) return brackets;
  const main = brackets.filter((b) => b.p1 <= level);
  const top = brackets.filter((b) => b.p0 >= level);
  if (!top.length) return brackets;
  const share = top.reduce((s, b) => s + (b.p1 - b.p0), 0);
  const avg = top.reduce((s, b) => s + b.v * (b.p1 - b.p0), 0) / share;
  main.push({ p0: level, p1: 100, v: avg, merged: true, minLen: 0.8 });
  return main;
}

// kumulativ (viktad) summa fattigast→rikast; toppar vid medelvärdet
function cumulative(brackets) {
  const sorted = [...brackets].sort((a, b) => a.p0 - b.p0);
  let s = 0;
  return sorted.map((b) => {
    s += b.v * (b.p1 - b.p0) / 100;
    return { p0: b.p0, p1: b.p1, v: s };
  });
}

// ---------- geometri per modell ----------

function shapeOpts(shape) {
  const scale = state.scales[state.measure];
  const base = { scale, clampMm: state.clampMm, endMargin: 6 };
  if (STRIP_SHAPES.has(shape)) {
    return { ...base, length: state.baseSize, depth: Math.max(26, state.baseSize * 0.16) };
  }
  if (shape === "square") return { ...base, length: state.baseSize };
  // spiral
  const sw = Math.max(7, state.baseSize * 0.05);
  return { ...base, length: state.baseSize, spiralWidth: sw, spiralGap: sw * 0.3 };
}

// bottentextens tre rader (versaler), skalade att passa plattan
function bottomText(font, plate, cName) {
  const m = MEASURE[state.measure];
  const cur = state.currency === "ppp" ? "PPP" : state.currency === "mer" ? "USD" : t("lcu_short");
  const perNoun = t("per_" + state.measure);
  const measShort = t("short_" + state.measure);
  const curTag = MEASURE_INFO[state.measure].isMoney ? " " + cur : "";
  const unit = state.measure === "carbon" ? t("unit_tco2") : (state.currency === "lcu" ? t("lcu_short") : "USD");
  const niceNum = m.per >= 1000 ? m.per.toLocaleString("sv-SE").replace(/ /g, " ") : String(m.per);
  const perMm = (1 / state.scales[state.measure]);
  const perMmNum = perMm >= 1000 ? Math.round(perMm).toLocaleString("sv-SE").replace(/ /g, " ") : String(+perMm.toFixed(2));
  const lines = [
    cName,
    `${measShort}/${perNoun}${curTag}`,
    `1 MM = ${perMmNum} ${unit}`,
  ];
  const isRect = plate.kind !== "circle";
  const availW = isRect ? plate.w - 12 : plate.r * 1.5;
  const availH = isRect ? Math.min(plate.d - 5, plate.w * 0.5) : plate.r * 1.4;
  // storlek styrd av höjd (3 rader), sen krympt om bredden inte räcker
  let size = Math.min(7, (availH - 2 * 1.4) / 3);
  const mk = (sz) => textBlock(font, lines.map((tx, i) => ({ text: tx, size: i === 0 ? sz * 1.1 : sz })), true, sz * 0.35);
  let blk = mk(size);
  if (blk.width > availW && blk.width > 0) { size *= availW / blk.width; blk = mk(size); }
  return blk;
}

// decilnummer-glyfer (ospeglade, för toppgravyr på remsan)
function decileGlyphs(font, depth) {
  const size = Math.min(6, depth * 0.32);
  const out = [];
  for (let k = 0; k < 10; k++) {
    const ts = textShapes(font, String(k + 1), size, false);
    out.push({ shapes: ts.shapes, width: ts.width, height: ts.height });
  }
  return out;
}

function makeModel(countryData, shape, font) {
  const series = getSeries(countryData, state.source, state.measure, state.year, state.currency);
  if (!series) return null;
  const opts = shapeOpts(shape);

  // data: kumulativ eller ihopslagen topp
  const brackets = shape === "cum" ? cumulative(series.brackets) : mergeTop(series.brackets, state.cutTop);

  if (STRIP_SHAPES.has(shape) && state.deciles) opts.decileGlyphs = decileGlyphs(font, opts.depth);
  const built = BUILDERS[shape](brackets, opts);

  const cName = countryName(countryData).toUpperCase();
  const txt = bottomText(font, built.plate, cName);

  const parts = [];
  parts.push({ key: "graph", geoms: [trisToGeometry(built.graphTris)], color: null });
  parts.push({ key: "base", geoms: buildPlinth(built.plate, txt.shapes), color: COL_BASE });
  if (built.finTris && built.finTris.length) parts.push({ key: "fins", geoms: [trisToGeometry(built.finTris)], color: COL_FIN });
  parts.push({ key: "text", geoms: buildInlay(txt.shapes), color: COL_TEXT });
  if (built.numberInlayTris && built.numberInlayTris.length) parts.push({ key: "numbers", geoms: [trisToGeometry(built.numberInlayTris)], color: COL_NUM });

  return { series, built, brackets, parts };
}

function disposeModels() {
  for (const m of currentModels) {
    m.group.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
      if (o.isCSS2DObject) o.element.remove();
    });
    root.remove(m.group);
  }
  currentModels = [];
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
  const font = await loadFont();
  const countryDatas = await Promise.all(state.countries.map(loadCountry));
  disposeModels();

  const gapX = 40, gapY = 96;
  const warns = new Set();
  let col = 0;
  for (let ci = 0; ci < state.countries.length; ci++) {
    const cd = countryDatas[ci];
    const cName = countryName(cd);
    let any = false;
    for (let si = 0; si < state.shapes.length; si++) {
      const shape = state.shapes[si];
      const model = makeModel(cd, shape, font);
      if (!model) { warns.add(t("warn_nodata")(cName)); continue; }
      any = true;
      const { series, built, brackets, parts } = model;
      const group = new THREE.Group();
      const cCol = colorByCountry.get(cd.code);
      for (const part of parts) {
        const color = part.color == null ? cCol : new THREE.Color(part.color);
        const mat = new THREE.MeshStandardMaterial({ color, roughness: part.key === "graph" ? 0.6 : 0.8, metalness: 0.03 });
        for (const g of part.geoms) group.add(new THREE.Mesh(g, mat));
      }
      const size = state.baseSize;
      group.position.set(col * (size + gapX), si * (size + gapY), 0);
      root.add(group);

      // etikett
      const div = document.createElement("div");
      div.className = "model-label";
      const bits = [];
      const realMaxMm = built.stats.maxH;
      const fullMm = Math.max(0, ...brackets.map((b) => b.v)) * state.scales[state.measure];
      bits.push(state.clampMm > 0 && fullMm > state.clampMm + 0.5
        ? `${t("lbl_top")(fmtH(fullMm))} ${t("lbl_shown")(fmtH(realMaxMm))}`
        : t("lbl_top")(fmtH(realMaxMm)));
      if (shape !== "cum" && state.cutTop && brackets.some((b) => b.merged)) bits.push(t("lbl_merged")(cutLabel()));
      const srcNote = state.source === "pip"
        ? ` · ${t("lbl_pip")(series.welfare === "consumption" ? t("welfare_cons") : t("welfare_inc"))}` : "";
      div.innerHTML = `<span class="big">${cName}</span> <span class="dim">${series.year} · ${t("shape_" + shape)}${srcNote}</span><br>
        <span class="dim">${bits.join(" · ")}</span>`;
      const label = new CSS2DObject(div);
      const halfD = built.plate.kind === "circle" ? built.plate.r : built.plate.d / 2;
      label.position.set(0, -halfD - 12, 0);
      group.add(label);

      if (series.clampedNeg) warns.add(t("warn_neg")(cName));
      const fm = t("file_measure")[state.measure];
      currentModels.push({
        code: cd.code, name: cName, shape, parts, series, brackets, group,
        basename: `${cd.code}_${state.source}_${fm}_${series.year}_${t("shape_" + shape)}`,
      });
    }
    if (any) col++;
  }
  if (state.source === "pip") warns.add(t("warn_pip"));
  if (state.measure === "carbon") warns.add(t("warn_carbon"));
  if (state.currency === "lcu" && MEASURE_INFO[state.measure].isMoney) warns.add(t("warn_lcu"));

  renderExports();
  renderWarnings([...warns]);
  const perMm = 1 / state.scales[state.measure];
  const unit = state.measure === "carbon" ? "tCO₂e" : (state.currency === "lcu" ? t("lcu_short") : "USD");
  status.textContent = t("status2")(currentModels.length, t("measure_" + state.measure), fmtNum(perMm), unit);
  fitCameraIfNeeded();
  persist();
}

function fmtNum(x) {
  return x >= 1000 ? Math.round(x).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-US") : String(+x.toFixed(2));
}

let lastFitKey = "";
function fitCameraIfNeeded() {
  const key = `${state.countries.join()}|${state.shapes.join()}|${state.baseSize}`;
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

function partGeoms(m, key) {
  const p = m.parts.find((x) => x.key === key);
  return p ? p.geoms : null;
}

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
    const mk = (key, file) => {
      const geoms = partGeoms(m, key);
      if (!geoms || !geoms.length) return;
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = t("part_" + key);
      b.title = t("part_" + key);
      b.onclick = () => exportSTL(geoms, `${m.basename}_${file}.stl`);
      btns.appendChild(b);
    };
    mk("graph", t("file_graph"));
    mk("base", t("file_base"));
    mk("fins", t("file_fins"));
    mk("numbers", t("file_numbers"));
    mk("text", t("file_text"));
    row.append(lbl, btns);
    el.appendChild(row);
  }
  if (!currentModels.length) el.innerHTML = `<span class="hint">${t("no_models")}</span>`;
}
document.getElementById("exportAll").onclick = () => {
  let i = 0;
  const files = { graph: t("file_graph"), base: t("file_base"), fins: t("file_fins"), numbers: t("file_numbers"), text: t("file_text") };
  for (const m of currentModels) {
    for (const key of ["graph", "base", "fins", "numbers", "text"]) {
      const geoms = partGeoms(m, key);
      if (geoms && geoms.length) setTimeout(() => exportSTL(geoms, `${m.basename}_${files[key]}.stl`), i++ * 350);
    }
  }
};

function renderWarnings(warns) {
  const el = document.getElementById("warn");
  el.style.display = warns.length ? "block" : "none";
  el.innerHTML = warns.map((w) => "⚠ " + w).join("<br>");
}

// ---------- kontroller ----------

const $ = (id) => document.getElementById(id);

function syncControls() {
  applyStatic();
  $("langBtn").textContent = t("langBtn");
  if (state.source === "pip") { state.measure = "income"; state.currency = "ppp"; }
  document.querySelectorAll('input[name="measure"]').forEach((r) => {
    r.checked = r.value === state.measure;
    r.disabled = state.source === "pip" && r.value !== "income";
  });
  $("source").value = state.source;
  $("currency").disabled = state.source === "pip";
  $("currency").value = state.currency;
  $("currencyRow").style.display = MEASURE_INFO[state.measure].isMoney ? "flex" : "none";
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
  $("scaleUnit").textContent = t("scale_per_mm") + " " + (state.measure === "carbon" ? "tCO₂e" : (state.currency === "lcu" ? t("lcu_short") : "USD"));
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
  for (const c of index.countries) {
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
    el.appendChild(lab);
  }
}

document.querySelectorAll('input[name="measure"]').forEach((r) =>
  r.addEventListener("change", () => { state.measure = r.value; syncControls(); rebuild(); }));
$("currency").addEventListener("change", (e) => { state.currency = e.target.value; syncControls(); rebuild(); });
$("source").addEventListener("change", (e) => { state.source = e.target.value; syncControls(); rebuild(); });
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
$("langBtn").addEventListener("click", () => { toggleLang(); syncControls(); rebuild(); });

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
