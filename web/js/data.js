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
    const wid = await (await fetch(`data/wid_${code}.json`)).json();
    let pip = null;
    try {
      const r = await fetch(`data/pip_${code}.json`);
      if (r.ok) pip = await r.json();
    } catch { /* pip saknas för landet */ }
    cache.set(code, { ...wid, pip });
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

// Returnerar { brackets: [{p0,p1,v}], year, ... } för land+källa+mått+år.
// year = närmast tillgängliga år; värden i USD (PPP/MER) eller ton.
export function getSeries(country, source, measure, wantYear, currency) {
  if (source === "pip") return getPipSeries(country, measure, wantYear, currency);
  const m = country.measures[measure];
  if (!m) return null;
  // närmaste tillgängliga år
  let best = m.years[0];
  for (const y of m.years) {
    if (Math.abs(y - wantYear) < Math.abs(best - wantYear)) best = y;
  }
  const yi = m.years.indexOf(best);

  let divisor = 1;
  const info = MEASURE_INFO[measure];
  if (info.isMoney && currency !== "lcu") {
    const xr = currency === "ppp" ? country.xrates?.pppUsd : country.xrates?.merUsd;
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
    let v = raw / divisor;
    if (v < 0) { v = 0; clampedNeg = true; }
    brackets.push({ p0: idx[i][0], p1: idx[i][1], v });
  }
  if (!brackets.length) return null;

  // Median ≈ p50p51, max = högsta klassvärdet
  const median = brackets.find((b) => b.p0 <= 50 && b.p1 > 50)?.v ?? 0;
  const max = Math.max(...brackets.map((b) => b.v));
  return { brackets, year: best, median, max, clampedNeg, dropped };
}

// PIP: 100 hela centiler, disponibel inkomst/konsumtion per person och år,
// PPP-USD. Bara måttet inkomst och valutan PPP finns.
function getPipSeries(country, measure, wantYear, currency) {
  const pip = country.pip;
  if (!pip || measure !== "income" || currency !== "ppp") return null;
  let best = pip.years[0];
  for (const y of pip.years) {
    if (Math.abs(y - wantYear) < Math.abs(best - wantYear)) best = y;
  }
  const yi = pip.years.indexOf(best);
  const brackets = [];
  for (let i = 0; i < 100; i++) {
    const v = pip.values[i]?.[yi];
    if (v != null) brackets.push({ p0: i, p1: i + 1, v: Math.max(0, v) });
  }
  if (!brackets.length) return null;
  const median = brackets.find((b) => b.p0 <= 50 && b.p1 > 50)?.v ?? 0;
  const max = Math.max(...brackets.map((b) => b.v));
  return {
    brackets, year: best, median, max, clampedNeg: false, dropped: 0,
    welfare: pip.welfare?.[best] === "consumption" ? "konsumtion" : "disp. inkomst",
  };
}
