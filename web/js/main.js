import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { loadIndex, loadCountry, getSeries, MEASURE_INFO } from "./data.js";
import {
  buildStrip, buildSpiral, buildSquare, buildPlinth, buildTopPiece,
  buildTopSegments, buildInlay, trisToGeometry, TOP_BAR_W,
} from "./geometry.js";
import { loadFont, textShapes } from "./text.js";
import { exportSTL } from "./stl.js";
import { t, getLang, toggleLang, applyStatic, countryName } from "./i18n.js";

// ---------- konstanter ----------

const PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const BUILDERS = { strip: buildStrip, spiral: buildSpiral, square: buildSquare };
// visningsenhet för skalinmatningen (mm per "per")
const SCALE_UNIT = {
  income: { per: 10000, label: "unit_money", lcuLabel: "unit_money_lcu" },
  wealth: { per: 10000, label: "unit_money", lcuLabel: "unit_money_lcu" },
  carbon: { per: 1, label: "unit_carbon", lcuLabel: "unit_carbon" },
};
const CUT_LABEL = { "99": { sv: "1 %", en: "1%" }, "99.9": { sv: "0,1 %", en: "0.1%" }, "99.99": { sv: "0,01 %", en: "0.01%" } };

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
  cutTop: 99,      // percentil där toppen utelämnas (0 = av)
  showTop: true,   // rita toppdelen bredvid
  segLen: 240,     // segmentlängd för toppdelens STL
};
try {
  Object.assign(state, JSON.parse(localStorage.getItem("ineq3d") || "{}"));
} catch { /* ignorera trasig lagring */ }
function persist() {
  localStorage.setItem("ineq3d", JSON.stringify(state));
}

let index = null;
let colorByCountry = new Map();
let currentModels = []; // {code, name, shape, geoms, inlayGeoms, series, group}
let topExports = [];    // en toppdel per land: {code, name, brackets, maxH, basename}

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
window.__ineq = { camera, controls, scene, root, renderer };

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

function splitTop(brackets) {
  if (!state.cutTop) return { main: brackets, top: [] };
  return {
    main: brackets.filter((b) => b.p1 <= state.cutTop),
    top: brackets.filter((b) => b.p0 >= state.cutTop),
  };
}

function makeModel(countryData, shape, font) {
  const series = getSeries(countryData, state.source, state.measure, state.year, state.currency);
  if (!series) return null;
  const opts = buildOpts();
  const { main, top } = splitTop(series.brackets);
  const built = BUILDERS[shape](main, opts);

  // gravyrtext, krymp om den inte får plats
  const name = countryName(countryData).toUpperCase();
  const maxW = (built.plate.kind === "circle" ? built.plate.r * 1.5 : built.plate.w - 12);
  let ts = textShapes(font, name, shapeTextSize(shape));
  if (ts.width > maxW && ts.width > 0) {
    ts = textShapes(font, name, shapeTextSize(shape) * (maxW / ts.width));
  }

  const geoms = [trisToGeometry(built.tris), ...buildPlinth(built.plate, ts.shapes)];
  const inlayGeoms = buildInlay(ts.shapes);
  // toppdel för visning (stående)
  let topBuilt = null;
  if (top.length) {
    topBuilt = buildTopPiece(top, opts);
    topBuilt.geoms = [trisToGeometry(topBuilt.tris), ...buildPlinth(topBuilt.plate, null)];
  }
  return { series, built, geoms, inlayGeoms, topBrackets: top, topBuilt };
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

function fmtH(mm) {
  return mm >= 1000 ? (mm / 1000).toFixed(1) + " m" : Math.round(mm) + " mm";
}
const cutLabel = () => CUT_LABEL[String(state.cutTop)]?.[getLang()] ?? "";

function topPieceWidth() {
  // bredd som toppdelen tar i layouten (grov övre gräns: 19 klasser vid 1 %)
  const n = state.cutTop === 99 ? 19 : state.cutTop === 99.9 ? 10 : 1;
  return n * TOP_BAR_W + 24;
}

async function rebuild() {
  const status = document.getElementById("status");
  status.textContent = t("building");
  assignColors();
  const font = await loadFont();
  const countryDatas = await Promise.all(state.countries.map(loadCountry));
  disposeModels();

  const showTop = state.showTop && state.cutTop > 0;
  const gapX = 36 + (showTop ? topPieceWidth() : 0);
  const gapY = 78;
  const warns = new Set();
  topExports = [];
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
      const { series, built, geoms, inlayGeoms, topBrackets, topBuilt } = model;
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: colorByCountry.get(cd.code), roughness: 0.62, metalness: 0.04,
      });
      const plinthMat = new THREE.MeshStandardMaterial({ color: 0xdad3c2, roughness: 0.8 });
      geoms.forEach((g, i) => group.add(new THREE.Mesh(g, i === 0 ? mat : plinthMat)));

      if (topBuilt && si === 0) {
        topExports.push({
          code: cd.code, name: cName, brackets: topBrackets,
          maxH: topBuilt.stats.maxH,
          basename: `${cd.code}_${state.source}_${t("file_measure")[state.measure]}_${series.year}`,
        });
      }
      // toppdel bredvid (verklig höjd) – EN per land, vid första formraden
      if (showTop && topBuilt && si === 0) {
        const tp = new THREE.Group();
        topBuilt.geoms.forEach((g, i) => tp.add(new THREE.Mesh(g, i === 0 ? mat : plinthMat)));
        tp.position.set(state.baseSize / 2 + topBuilt.plate.w / 2 + 14, 0, 0);
        group.add(tp);
        const tdiv = document.createElement("div");
        tdiv.className = "model-label";
        tdiv.innerHTML = `<span class="dim">${t("lbl_toppiece")(cutLabel(), fmtH(topBuilt.stats.maxH))}</span>`;
        const tlabel = new CSS2DObject(tdiv);
        tlabel.position.set(0, -topBuilt.plate.d / 2 - 8, 0);
        tp.add(tlabel);
      }

      group.position.set(col * (state.baseSize + gapX), si * (state.baseSize + gapY), 0);
      root.add(group);

      // etikett
      const div = document.createElement("div");
      div.className = "model-label";
      const bits = [];
      const realMaxMm = built.stats.maxH; // maxhöjd i huvudmodellen (efter ev. klipp)
      const mainMaxVal = Math.max(0, ...series.brackets.filter((b) => !state.cutTop || b.p1 <= state.cutTop).map((b) => b.v));
      const uncutMm = mainMaxVal * state.scales[state.measure];
      bits.push(state.clampMm > 0 && uncutMm > state.clampMm
        ? `${t("lbl_top")(fmtH(uncutMm))} ${t("lbl_shown")(fmtH(realMaxMm))}`
        : t("lbl_top")(fmtH(realMaxMm)));
      if (built.stats.truncated) bits.push(t("lbl_clamped")(built.stats.truncated));
      if (state.cutTop) bits.push(t("lbl_cut")(cutLabel()));
      const srcNote = state.source === "pip"
        ? ` · ${t("lbl_pip")(series.welfare === "consumption" ? t("welfare_cons") : t("welfare_inc"))}` : "";
      div.innerHTML = `<span class="big">${cName}</span> <span class="dim">${series.year} · ${t("shape_" + shape)}${srcNote}</span><br>
        <span class="dim">${bits.join(" · ")}</span>`;
      const label = new CSS2DObject(div);
      label.position.set(0, -(built.plate.kind === "circle" ? built.plate.r : built.plate.d / 2) - 10, 0);
      group.add(label);

      if (series.clampedNeg) warns.add(t("warn_neg")(cName));
      const fm = t("file_measure")[state.measure];
      currentModels.push({
        code: cd.code, name: cName, shape, geoms, inlayGeoms, topBrackets, topBuilt, series, group,
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
  const su = SCALE_UNIT[state.measure];
  const scaleDisp = (state.scales[state.measure] * su.per).toPrecision(3);
  const unitLbl = t(state.currency === "lcu" && MEASURE_INFO[state.measure].isMoney ? su.lcuLabel : su.label);
  status.textContent = t("status")(currentModels.length, t("measure_" + state.measure), scaleDisp, unitLbl);
  fitCameraIfNeeded();
  persist();
}

let lastFitKey = "";
function fitCameraIfNeeded() {
  const key = `${state.countries.join()}|${state.shapes.join()}|${state.baseSize}|${state.showTop && state.cutTop > 0}`;
  if (key === lastFitKey || !currentModels.length) return;
  lastFitKey = key;
  // planutbredning i root-lokala koordinater (x åt höger, y = djup)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const h = state.baseSize / 2 + 24 + (state.showTop && state.cutTop > 0 ? topPieceWidth() : 0);
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

function exportTop(e) {
  const { geoms } = buildTopSegments(e.brackets, buildOpts(), state.segLen);
  if (geoms.length) exportSTL(geoms, `${e.basename}_${t("file_top")}.stl`);
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
    const mk = (txt, fn, title) => {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = txt;
      if (title) b.title = title;
      b.onclick = fn;
      btns.appendChild(b);
      return b;
    };
    mk(t("exp_model"), () => exportSTL(m.geoms, `${m.basename}.stl`));
    mk(t("exp_inlay"), () => exportSTL(m.inlayGeoms, `${m.basename}_${t("file_text")}.stl`));
    row.append(lbl, btns);
    el.appendChild(row);
  }
  // toppdelar – en per land
  for (const e of topExports) {
    const row = document.createElement("div");
    row.className = "kv";
    const lbl = document.createElement("span");
    lbl.textContent = `${e.name} · ${t("exp_top")} (${cutLabel()})`;
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = t("exp_model");
    b.title = t("exp_top_title")(Math.ceil(e.maxH / state.segLen), fmtH(e.maxH));
    b.onclick = () => exportTop(e);
    row.append(lbl, b);
    el.appendChild(row);
  }
  if (!currentModels.length) el.innerHTML = `<span class="hint">${t("no_models")}</span>`;
}
document.getElementById("exportAll").onclick = () => {
  let i = 0;
  for (const m of currentModels) {
    setTimeout(() => exportSTL(m.geoms, `${m.basename}.stl`), i++ * 400);
    setTimeout(() => exportSTL(m.inlayGeoms, `${m.basename}_${t("file_text")}.stl`), i++ * 400);
  }
  for (const e of topExports) setTimeout(() => exportTop(e), i++ * 400);
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
  $("yearHint").textContent = t(state.measure === "carbon" ? "yearHintCarbon" : "yearHint");
  document.querySelectorAll('input[name="shape"]').forEach((c) => (c.checked = state.shapes.includes(c.value)));
  $("cutTop").value = String(state.cutTop);
  $("showTop").checked = state.showTop;
  const su = SCALE_UNIT[state.measure];
  $("scaleUnit").textContent = t(state.currency === "lcu" && MEASURE_INFO[state.measure].isMoney ? su.lcuLabel : su.label);
  $("scale").value = +(state.scales[state.measure] * su.per).toPrecision(4);
  $("baseSize").value = state.baseSize;
  $("clampMm").value = state.clampMm;
  $("segLen").value = state.segLen;
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
    lab.append(cb, sw, document.createTextNode(" " + countryName(c)));
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
$("cutTop").addEventListener("change", (e) => { state.cutTop = +e.target.value; rebuild(); });
$("showTop").addEventListener("change", (e) => { state.showTop = e.target.checked; rebuild(); });
$("segLen").addEventListener("change", (e) => {
  state.segLen = Math.min(500, Math.max(40, +e.target.value || 240));
  syncControls();
  renderExports();
  persist();
});
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
  // "Högsta" = högsta klass i det som visas i huvudmodellen (efter topputelämning)
  const maxs = currentModels.map((m) =>
    Math.max(0, ...m.series.brackets.filter((b) => !state.cutTop || b.p1 <= state.cutTop).map((b) => b.v))
  ).filter((v) => v > 0);
  if (!maxs.length) return;
  state.scales[state.measure] = 80 / Math.max(...maxs);
  syncControls();
  rebuild();
});
$("langBtn").addEventListener("click", () => {
  toggleLang();
  syncControls();
  rebuild(); // gravyr och etiketter byter språk
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
