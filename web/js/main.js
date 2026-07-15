import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { loadIndex, loadCountry, getSeries, MEASURE_INFO } from "./data.js";
import { buildStrip, buildSpiral, buildSquare, buildPlinth, trisToGeometry, BASE_TOP } from "./geometry.js";
import { loadFont, textShapes } from "./text.js";
import { exportSTL } from "./stl.js";

// ---------- konstanter ----------

const PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const SHAPES = { strip: "remsa", spiral: "spiral", square: "kvadrat" };
const BUILDERS = { strip: buildStrip, spiral: buildSpiral, square: buildSquare };
// visningsenhet för skalinmatningen
const SCALE_UNIT = {
  income: { per: 10000, label: "mm / 10 000 USD", lcuLabel: "mm / 10 000 (lokal valuta)" },
  wealth: { per: 10000, label: "mm / 10 000 USD", lcuLabel: "mm / 10 000 (lokal valuta)" },
  carbon: { per: 1, label: "mm / ton CO₂e", lcuLabel: "mm / ton CO₂e" },
};

// ---------- tillstånd ----------

const state = {
  measure: "income",
  currency: "ppp",
  source: "wid",
  year: 2023,
  countries: ["SE", "US", "CN", "IN"],
  shapes: ["strip"],
  scales: { income: 0.5 / 10000, wealth: 0.2 / 10000, carbon: 1 }, // mm per USD resp. ton
  baseSize: 100,
  clampMm: 0,
};
try {
  Object.assign(state, JSON.parse(localStorage.getItem("ineq3d") || "{}"));
} catch { /* ignorera trasig lagring */ }
function persist() {
  localStorage.setItem("ineq3d", JSON.stringify(state));
}

let index = null;
let colorByCountry = new Map();
let currentModels = []; // {code, nameSv, shape, geoms, series, group}

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

// Z-upp (utskriftskoordinater) → skärmens Y-upp
const root = new THREE.Group();
root.rotation.x = -Math.PI / 2;
scene.add(root);
const grid = new THREE.GridHelper(2000, 100, 0xd8d2c4, 0xe8e3d8);
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

// för felsökning i konsolen
window.__ineq = { camera, controls, scene, root };

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});

// ---------- modellbygge ----------

const buildOpts = () => ({
  scale: state.scales[state.measure],
  clampMm: state.clampMm,
  baseSize: state.baseSize,
  margin: 4,
  stripWidth: 10,
  spiralWidth: 7,
  spiralGap: 2,
});

function shapeTextSize(shape) {
  return shape === "strip" ? 5.5 : 9;
}

async function makeModel(countryData, shape, font) {
  const series = getSeries(countryData, state.source, state.measure, state.year, state.currency);
  if (!series) return null;
  const opts = buildOpts();
  const built = BUILDERS[shape](series.brackets, opts);

  // gravyrtext, krymp om den inte får plats
  const name = countryData.nameSv.toUpperCase();
  const maxW = (built.plate.kind === "circle" ? built.plate.r * 1.5 : built.plate.w - 12);
  let ts = textShapes(font, name, shapeTextSize(shape));
  if (ts.width > maxW && ts.width > 0) {
    ts = textShapes(font, name, shapeTextSize(shape) * (maxW / ts.width));
  }

  const geoms = [trisToGeometry(built.tris), ...buildPlinth(built.plate, ts.shapes)];
  return { series, built, geoms };
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

function fmtMoney(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + " mdr";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + " M";
  if (v >= 1e3) return Math.round(v / 1e3) + " k";
  return Math.round(v).toString();
}
function fmtH(mm) {
  return mm >= 1000 ? (mm / 1000).toFixed(1) + " m" : Math.round(mm) + " mm";
}

async function rebuild() {
  const status = document.getElementById("status");
  status.textContent = "Bygger …";
  assignColors();
  const font = await loadFont();
  const countryDatas = await Promise.all(state.countries.map(loadCountry));
  disposeModels();

  const gapX = 36, gapY = 78;
  const warns = new Set();
  let col = 0;
  for (let ci = 0; ci < state.countries.length; ci++) {
    const cd = countryDatas[ci];
    let any = false;
    for (let si = 0; si < state.shapes.length; si++) {
      const shape = state.shapes[si];
      const model = await makeModel(cd, shape, font);
      if (!model) { warns.add(`${cd.nameSv}: ingen data för valt mått/valuta`); continue; }
      any = true;
      const { series, built, geoms } = model;
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: colorByCountry.get(cd.code), roughness: 0.62, metalness: 0.04,
        });
      const plinthMat = new THREE.MeshStandardMaterial({ color: 0xdad3c2, roughness: 0.8 });
      geoms.forEach((g, i) => group.add(new THREE.Mesh(g, i === 0 ? mat : plinthMat)));
      group.position.set(col * (state.baseSize + gapX), si * (state.baseSize + gapY), 0);
      root.add(group);

      // etikett
      const div = document.createElement("div");
      div.className = "model-label";
      const truncNote = built.stats.truncated ? ` · ${built.stats.truncated} kapade` : "";
      const realMaxMm = series.max * state.scales[state.measure];
      const heightNote = state.clampMm > 0 && realMaxMm > state.clampMm
        ? `topp ${fmtH(realMaxMm)} (visas ${fmtH(built.stats.maxH)})`
        : `topp ${fmtH(built.stats.maxH)}`;
      const srcNote = state.source === "pip" ? ` · PIP (${series.welfare})` : "";
      div.innerHTML = `<span class="big">${cd.nameSv}</span> <span class="dim">${series.year} · ${SHAPES[shape]}${srcNote}</span><br>
        <span class="dim">${heightNote}${truncNote}</span>`;
      const label = new CSS2DObject(div);
      label.position.set(0, -(built.plate.kind === "circle" ? built.plate.r : built.plate.d / 2) - 10, 0);
      group.add(label);

      if (series.clampedNeg) warns.add(`${cd.nameSv}: negativa värden (skulder) kapas vid 0`);
      currentModels.push({
        code: cd.code, nameSv: cd.nameSv, shape, geoms, series,
        group,
        filename: `${cd.code}_${state.source}_${MEASURE_INFO[state.measure].label.toLowerCase().replace("₂","2")}_${series.year}_${SHAPES[shape]}.stl`,
      });
    }
    if (any) col++;
  }
  if (state.source === "pip") {
    warns.add("PIP: disponibel inkomst/konsumtion per person (survey) – lägre nivåer än WID:s nationalinkomst per vuxen är väntat");
  }
  if (state.measure === "carbon") {
    warns.add("CO₂-fördelningarna: låg datakvalitet enligt WID – toppvärden är modellskattningar");
  }
  if (state.currency === "lcu" && MEASURE_INFO[state.measure].isMoney) {
    warns.add("Lokal valuta: höjder är INTE jämförbara mellan länder");
  }

  renderExports();
  renderWarnings([...warns]);
  const su = SCALE_UNIT[state.measure];
  const scaleDisp = state.scales[state.measure] * su.per;
  status.textContent =
    `${currentModels.length} modeller · ${MEASURE_INFO[state.measure].label} · ` +
    `skala ${scaleDisp.toPrecision(3)} ${state.currency === "lcu" ? su.lcuLabel : su.label}`;
  fitCameraIfNeeded();
  persist();
}

let lastFitKey = "";
function fitCameraIfNeeded() {
  const key = `${state.countries.join()}|${state.shapes.join()}|${state.baseSize}`;
  if (key === lastFitKey || !currentModels.length) return;
  lastFitKey = key;
  // planutbredning i root-lokala koordinater (x åt höger, y = djup)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const h = state.baseSize / 2 + 24;
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
  const size = box.getSize(new THREE.Vector3());
  const d = Math.max(size.x, size.z * 1.6) * 0.75 + 150;
  controls.target.set(c.x, 15, c.z);
  camera.position.set(c.x, d * 0.62, box.max.z + d * 0.85);
}

// ---------- export ----------

function renderExports() {
  const el = document.getElementById("exports");
  el.innerHTML = "";
  for (const m of currentModels) {
    const row = document.createElement("div");
    row.className = "kv";
    const lbl = document.createElement("span");
    lbl.textContent = `${m.nameSv} · ${SHAPES[m.shape]}`;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "STL";
    btn.onclick = () => exportSTL(m.geoms, m.filename);
    row.append(lbl, btn);
    el.appendChild(row);
  }
  if (!currentModels.length) el.innerHTML = '<span class="hint">Inga modeller.</span>';
}
document.getElementById("exportAll").onclick = () => {
  currentModels.forEach((m, i) => setTimeout(() => exportSTL(m.geoms, m.filename), i * 400));
};

function renderWarnings(warns) {
  const el = document.getElementById("warn");
  el.style.display = warns.length ? "block" : "none";
  el.innerHTML = warns.map((w) => "⚠ " + w).join("<br>");
}

// ---------- kontroller ----------

const $ = (id) => document.getElementById(id);

function syncControls() {
  // PIP har bara inkomst i PPP
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
  $("yearHint").textContent = state.measure === "carbon"
    ? "CO₂-data finns t.o.m. 2019. Saknas året för ett land används närmaste."
    : "Saknas året för ett land används närmaste tillgängliga.";
  document.querySelectorAll('input[name="shape"]').forEach((c) => (c.checked = state.shapes.includes(c.value)));
  const su = SCALE_UNIT[state.measure];
  $("scaleUnit").textContent = state.currency === "lcu" && MEASURE_INFO[state.measure].isMoney ? su.lcuLabel : su.label;
  $("scale").value = +(state.scales[state.measure] * su.per).toPrecision(4);
  $("baseSize").value = state.baseSize;
  $("clampMm").value = state.clampMm;
  renderCountryList();
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
    lab.append(cb, sw, document.createTextNode(" " + c.nameSv));
    el.appendChild(lab);
  }
}

document.querySelectorAll('input[name="measure"]').forEach((r) =>
  r.addEventListener("change", () => { state.measure = r.value; syncControls(); rebuild(); }));
$("currency").addEventListener("change", (e) => { state.currency = e.target.value; syncControls(); rebuild(); });
$("source").addEventListener("change", (e) => { state.source = e.target.value; syncControls(); rebuild(); });
$("year").addEventListener("input", (e) => {
  state.year = +e.target.value;
  $("yearLabel").textContent = state.year;
});
$("year").addEventListener("change", () => rebuild());
document.querySelectorAll('input[name="shape"]').forEach((c) =>
  c.addEventListener("change", () => {
    state.shapes = [...document.querySelectorAll('input[name="shape"]:checked')].map((x) => x.value);
    if (!state.shapes.length) { state.shapes = [c.value]; c.checked = true; }
    rebuild();
  }));
document.querySelectorAll(".quick button[data-set]").forEach((b) =>
  b.addEventListener("click", () => {
    state.countries = b.dataset.set ? b.dataset.set.split(",") : [];
    syncControls();
    rebuild();
  }));
$("scale").addEventListener("change", (e) => {
  const su = SCALE_UNIT[state.measure];
  const v = parseFloat(e.target.value);
  if (v > 0) state.scales[state.measure] = v / su.per;
  rebuild();
});
$("baseSize").addEventListener("change", (e) => { state.baseSize = Math.max(30, +e.target.value || 100); rebuild(); });
$("clampMm").addEventListener("change", (e) => { state.clampMm = Math.max(0, +e.target.value || 0); rebuild(); });
$("scaleMedian").addEventListener("click", () => {
  const meds = currentModels.map((m) => m.series.median).filter((v) => v > 0);
  if (!meds.length) return;
  state.scales[state.measure] = 3 / Math.max(...meds);
  syncControls();
  rebuild();
});
$("scaleMax").addEventListener("click", () => {
  const maxs = currentModels.map((m) => m.series.max).filter((v) => v > 0);
  if (!maxs.length) return;
  state.scales[state.measure] = 80 / Math.max(...maxs);
  syncControls();
  rebuild();
});

// ---------- start ----------

(async () => {
  index = await loadIndex();
  state.countries = state.countries.filter((c) => index.countries.some((x) => x.code === c));
  syncControls();
  await rebuild();
})().catch((e) => {
  document.getElementById("status").textContent = "Fel: " + e.message;
  console.error(e);
});
