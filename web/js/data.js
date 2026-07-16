// Laddning och normalisering av percentildata (WID.world).

const cache = new Map();
let indexData = null;

export async function loadIndex() {
  if (!indexData) {
    indexData = await (await fetch("data/index.json")).json();
  }
  return indexData;
}

export async function loadCountry(code) {
  if (!cache.has(code)) {
    cache.set(code, await (await fetch(`data/wid_${code}.json`)).json());
  }
  return cache.get(code);
}

export const MEASURE_INFO = {
  income: {
    label: "Inkomst",
    unitShort: (cur) => (cur === "lcu" ? "lokal valuta/år" : "USD/år"),
    isMoney: true,
  },
  wealth: {
    label: "Förmögenhet",
    unitShort: (cur) => (cur === "lcu" ? "lokal valuta" : "USD"),
    isMoney: true,
  },
  carbon: {
    label: "CO₂e-avtryck",
    unitShort: () => "tCO₂e/år",
    isMoney: false,
  },
};

// Returnerar { brackets: [{p0,p1,v}], year, ... } för land+mått+år.
// year = närmast tillgängliga år; värden i USD (PPP/MER) eller ton.
export function getSeries(country, measure, wantYear, currency) {
  const m = country.measures[measure];
  if (!m) return null;
  // närmaste tillgängliga år
  let best = m.years[0];
  for (const y of m.years) {
    if (Math.abs(y - wantYear) < Math.abs(best - wantYear)) best = y;
  }
  const yi = m.years.indexOf(best);

  let divisor = 1;
  if (MEASURE_INFO[measure].isMoney) {
    const xr = currency === "mer" ? country.xrates?.merUsd : country.xrates?.pppUsd;
    if (!xr) return null;
    divisor = xr.lcuPer;
  }

  const idx = indexData.brackets;
  const brackets = [];
  let clampedNeg = false;
  let dropped = 0;
  for (let i = 0; i < idx.length; i++) {
    const raw = m.values[i]?.[yi];
    if (raw == null) { dropped++; continue; }
    const vRaw = raw / divisor;
    let v = vRaw;
    if (v < 0) { v = 0; clampedNeg = true; }
    brackets.push({ p0: idx[i][0], p1: idx[i][1], v, vRaw });
  }
  if (!brackets.length) return null;

  // Median ≈ p50p51, max = högsta klassvärdet, medel = viktat snitt
  const median = brackets.find((b) => b.p0 <= 50 && b.p1 > 50)?.v ?? 0;
  const max = Math.max(...brackets.map((b) => b.v));
  const share = brackets.reduce((s, b) => s + (b.p1 - b.p0), 0);
  const mean = brackets.reduce((s, b) => s + b.vRaw * (b.p1 - b.p0), 0) / share;
  return { brackets, year: best, median, max, mean, clampedNeg, dropped };
}

// Komponentserie (t.ex. carbonCons/carbonInv) för samma år som en
// huvudserie: returnerar Map percentilnyckel "p0|p1" → värde, eller null.
export function getComponent(country, key, year) {
  const m = country.measures[key];
  if (!m) return null;
  let best = m.years[0];
  for (const y of m.years) if (Math.abs(y - year) < Math.abs(best - year)) best = y;
  const yi = m.years.indexOf(best);
  const idx = indexData.brackets;
  const map = new Map();
  for (let i = 0; i < idx.length; i++) {
    const v = m.values[i]?.[yi];
    if (v != null) map.set(`${idx[i][0]}|${idx[i][1]}`, v);
  }
  return map.size ? { map, year: best } : null;
}

// Offentlig konsumtions fotavtryck per capita (klumpsumman) närmast year.
export function getGovFootprint(country, year) {
  const g = country.govFootprint;
  if (!g || !g.years.length) return null;
  let bi = 0;
  for (let i = 0; i < g.years.length; i++) {
    if (Math.abs(g.years[i] - year) < Math.abs(g.years[bi] - year)) bi = i;
  }
  return g.values[bi];
}
