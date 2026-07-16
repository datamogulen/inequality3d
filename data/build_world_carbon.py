#!/usr/bin/env python3
"""Bygger världens CO2-fördelning bakvägen ur ländernas percentiler:
poolar alla (land, percentilklass)-atomer viktade med befolkning
(npopul999i), sorterar efter totalavtryck och skär om i de 118 globala
klasserna – samma metod som Chancel använder för sina globala serier.

Skriver in i web/data/wid_WO.json:
  measures.carbon     – totalt avtryck per global percentilklass
  measures.carbonGov  – offentlig del per klass (varierar globalt eftersom
                        olika länder har olika klumpsummor!)
  measures.carbonCons – privat konsumtion per klass
  measures.carbonInv  – investeringar per klass
  carbonCoverage      – andel av världsbefolkningen som täcks, per år
Kör: python3 data/build_world_carbon.py  (kräver att fetch_wid.py körts)
"""

import json
import time
import urllib.request
import urllib.parse
from pathlib import Path

API = "https://rfap9nitz6.execute-api.eu-west-1.amazonaws.com/prod/"
API_KEY = "rYFByOB0ioaPATwHtllMI71zLOZSK0Ic5veQonJP"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "data"

YEARS = range(1995, 2020)  # komponenterna finns 1995–2019


def api_get(params, cache_name):
    cache = RAW / (cache_name + ".json")
    if cache.exists():
        return json.loads(cache.read_text())
    url = API + "countries-variables?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"x-api-key": API_KEY})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read().decode())
            break
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(4 * (attempt + 1))
    if isinstance(data, list) and len(data) == 1:
        data = data[0]
    cache.write_text(json.dumps(data))
    return data


def fetch_pop(code, api_code=None):
    data = api_get(
        {"countries": api_code or code, "variables": "npopul_p0p100_999_i", "years": "all"},
        f"{code}_pop",
    )
    for entries in data.values():
        for entry in entries:
            _, payload = next(iter(entry.items()))
            vals = {i["y"]: i["v"] for i in payload.get("values", []) if i["v"]}
            if vals:
                return vals
    return {}


def main():
    index = json.loads((OUT / "index.json").read_text())
    brackets = index["brackets"]

    # länder med CO2-komponenter
    countries = []
    for c in index["countries"]:
        if c["code"] == "WO":
            continue
        ms = c.get("measures", {})
        if "carbon" in ms and "carbonCons" in ms and "carbonInv" in ms:
            countries.append(c["code"])
    print(f"{len(countries)} länder med CO2-komponenter")

    world_pop = fetch_pop("WO", "WO-PPP")
    pops = {}
    for i, cc in enumerate(countries):
        pops[cc] = fetch_pop(cc)
        if (i + 1) % 40 == 0:
            print(f"  befolkning {i+1}/{len(countries)}")

    datas = {cc: json.loads((OUT / f"wid_{cc}.json").read_text()) for cc in countries}

    def series_at(d, key, year):
        m = d["measures"].get(key)
        if not m or year not in m["years"]:
            return None
        yi = m["years"].index(year)
        return [m["values"][i][yi] for i in range(len(brackets))]

    def gov_at(d, year):
        g = d.get("govFootprint")
        if not g or not g["years"]:
            return None
        yrs = g["years"]
        bi = min(range(len(yrs)), key=lambda i: abs(yrs[i] - year))
        return g["values"][bi]

    out = {k: {"years": [], "values": [[] for _ in brackets]}
           for k in ("carbon", "carbonGov", "carbonCons", "carbonInv")}
    coverage = {}

    for year in YEARS:
        atoms = []  # (total, gov, cons, inv, vikt=personer)
        covered_pop = 0.0
        for cc in countries:
            d = datas[cc]
            tot = series_at(d, "carbon", year)
            lcf = series_at(d, "carbonCons", year)
            lif = series_at(d, "carbonInv", year)
            gov = gov_at(d, year)
            pop = pops[cc].get(year)
            if not (tot and lcf and lif and pop) or gov is None:
                continue
            covered_pop += pop
            for i, (p0, p1) in enumerate(brackets):
                t, c, v = tot[i], lcf[i], lif[i]
                if t is None or c is None or v is None:
                    continue
                w = (p1 - p0) / 100.0 * pop
                atoms.append((t, gov, max(0.0, c - gov), max(0.0, v), w))
        if not atoms:
            continue
        wp = world_pop.get(year)
        coverage[year] = round(covered_pop / wp, 3) if wp else None

        atoms.sort(key=lambda a: a[0])
        total_w = sum(a[4] for a in atoms)
        # skär atomlistan i de globala klasserna
        results = []
        ai = 0
        used = 0.0  # vikt förbrukad ur atoms[ai]
        for (q0, q1) in brackets:
            target = (q1 - q0) / 100.0 * total_w
            sums = [0.0, 0.0, 0.0, 0.0]
            got = 0.0
            while got < target - 1e-9 and ai < len(atoms):
                t, g, c, v, w = atoms[ai]
                avail = w - used
                take = min(avail, target - got)
                for j, val in enumerate((t, g, c, v)):
                    sums[j] += val * take
                got += take
                used += take
                if used >= w - 1e-12:
                    ai += 1
                    used = 0.0
            results.append([s / got if got > 0 else None for s in sums])

        for k_i, key in enumerate(("carbon", "carbonGov", "carbonCons", "carbonInv")):
            out[key]["years"].append(year)
            for b_i in range(len(brackets)):
                r = results[b_i][k_i]
                out[key]["values"][b_i].append(round(r, 4) if r is not None else None)
        print(f"{year}: {len(atoms)} atomer, täckning {coverage[year]}")

    wo = json.loads((OUT / "wid_WO.json").read_text())
    for key in out:
        out[key]["unit"] = "tCO2 equivalent/cap"
        wo["measures"][key] = out[key]
    wo["carbonCoverage"] = coverage
    (OUT / "wid_WO.json").write_text(json.dumps(wo, separators=(",", ":")))

    # uppdatera index
    for c in index["countries"]:
        if c["code"] == "WO":
            for key in out:
                c["measures"][key] = {"years": out[key]["years"], "unit": out[key]["unit"]}
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print("wid_WO.json + index.json uppdaterade")


if __name__ == "__main__":
    main()
