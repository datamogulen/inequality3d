#!/usr/bin/env python3
"""Hämtar percentildata från WID.world (World Inequality Database) och
skriver web/data/wid_<CC>.json + web/data/index.json.

Mått:
  income : aptinc_992_j  – genomsnittlig pre-tax nationalinkomst per vuxen
           (equal-split), konstant lokal valuta
  wealth : ahweal_992_j  – genomsnittlig nettoförmögenhet per vuxen,
           konstant lokal valuta
  carbon : lpfghg_999_i  – personligt växthusgasavtryck (konsumtion +
           investeringar), tCO2e/person, Chancel (2021) m. uppdateringar

Växelkurser: xlcusp999i (PPP, LCU per USD) och xlcusx999i (marknadskurs)
– används för att räkna om till USD med fast skala mellan länder.

API:t är samma som WID:s officiella R-paket använder (nyckeln ligger
öppet i paketet: github.com/world-inequality-database/wid-r-tool).
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

MIN_YEAR = 1990

# Kärnländer (visas alltid i UI:t). Övriga länder läses från
# data/countries_all.json och hamnar bakom "fler länder"-valet.
CORE = {
    "SE": ("Sverige", "Sweden"),
    "NO": ("Norge", "Norway"),
    "DK": ("Danmark", "Denmark"),
    "FI": ("Finland", "Finland"),
    "DE": ("Tyskland", "Germany"),
    "FR": ("Frankrike", "France"),
    "GB": ("Storbritannien", "United Kingdom"),
    "ES": ("Spanien", "Spain"),
    "IT": ("Italien", "Italy"),
    "PL": ("Polen", "Poland"),
    "RU": ("Ryssland", "Russia"),
    "TR": ("Turkiet", "Turkey"),
    "US": ("USA", "United States"),
    "CA": ("Kanada", "Canada"),
    "MX": ("Mexiko", "Mexico"),
    "BR": ("Brasilien", "Brazil"),
    "CN": ("Kina", "China"),
    "IN": ("Indien", "India"),
    "JP": ("Japan", "Japan"),
    "KR": ("Sydkorea", "South Korea"),
    "ID": ("Indonesien", "Indonesia"),
    "ZA": ("Sydafrika", "South Africa"),
    "NG": ("Nigeria", "Nigeria"),
    "EG": ("Egypten", "Egypt"),
    "AU": ("Australien", "Australia"),
    "WO": ("Världen", "World"),  # WID-kod WO-PPP; percentiler i PPP-USD
}
API_CODE = {"WO": "WO-PPP"}

def all_countries():
    extra = json.loads((ROOT / "data" / "countries_all.json").read_text())
    out = dict(CORE)
    for code, (sv, en) in sorted(extra.items(), key=lambda kv: kv[1][0]):
        if code not in out:
            out[code] = (sv, en)
    return out

COUNTRIES = all_countries()

# Percentilklasser: hela centiler 0–99, tiondelar 99–99.9,
# hundradelar 99.9–99.99, sist p99.99p100. Totalt 118 klasser.
def brackets():
    bs = []
    for i in range(99):
        bs.append((i, i + 1))
    for i in range(9):
        bs.append((round(99 + i / 10, 1), round(99 + (i + 1) / 10, 1)))
    for i in range(9):
        bs.append((round(99.9 + i / 100, 2), round(99.9 + (i + 1) / 100, 2)))
    bs.append((99.99, 100))
    return bs

BRACKETS = brackets()


def fmt_p(p):
    # WID skriver 99 som "99", 99.1 som "99.1"
    s = f"{p:g}"
    return s


def bracket_code(p0, p1):
    return f"p{fmt_p(p0)}p{fmt_p(p1)}"


MEASURES = {
    "income": {"sixlet": "aptinc", "age": "992", "pop": "j"},
    "wealth": {"sixlet": "ahweal", "age": "992", "pop": "j"},
    "carbon": {"sixlet": "lpfghg", "age": "999", "pop": "i"},
    # Chancels komponenter: konsumtion resp. investeringar (offentlig
    # konsumtion = carbon - carbonCons - carbonInv, klumpsumma i benchmark)
    "carbonCons": {"sixlet": "lcfghg", "age": "999", "pop": "i"},
    "carbonInv": {"sixlet": "lifghg", "age": "999", "pop": "i"},
}

XRATES = ["xlcusp_p0p100_999_i", "xlcusx_p0p100_999_i", "xlceup_p0p100_999_i"]


def api_get(path, params, cache_name):
    cache = RAW / (cache_name + ".json")
    if cache.exists():
        return json.loads(cache.read_text())
    url = API + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"x-api-key": API_KEY})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read().decode())
            break
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  ...försök {attempt+1} misslyckades ({e}), väntar...")
            time.sleep(5 * (attempt + 1))
    # Stora svar levereras via en separat URL
    if isinstance(data, dict) and data.get("status") == "payload_too_large":
        with urllib.request.urlopen(data["download_url"], timeout=300) as r:
            data = json.loads(r.read().decode())
    if isinstance(data, list) and len(data) == 1:
        data = data[0]
    cache.write_text(json.dumps(data))
    return data


def probe(country):
    """En billig fråga: finns aptinc-p50 alls för landet?"""
    api = API_CODE.get(country, country)
    data = api_get(
        "countries-variables",
        {"countries": api, "variables": "aptinc_p50p51_992_j", "years": "all"},
        f"{country}_probe",
    )
    for entries in data.values():
        for entry in entries:
            _, payload = next(iter(entry.items()))
            if payload.get("values"):
                return True
    return False


def fetch_measure(country, key):
    m = MEASURES[key]
    variables = ",".join(
        f"{m['sixlet']}_{bracket_code(p0, p1)}_{m['age']}_{m['pop']}"
        for p0, p1 in BRACKETS
    )
    print(f"{country}: {key} ...")
    data = api_get(
        "countries-variables",
        {"countries": API_CODE.get(country, country), "variables": variables, "years": "all"},
        f"{country}_{key}",
    )
    # data: { varcode: [ { CC: {meta:..., values:[{y,v},...] } } ] }
    unit = None
    api_cc = API_CODE.get(country, country)
    per_bracket = {}  # bracketindex -> {year: value}
    dq_by_year = {}   # år -> [kvalitetspoäng]
    for varcode, entries in data.items():
        pcode = varcode.split("_")[1]
        try:
            idx = next(
                i for i, (p0, p1) in enumerate(BRACKETS)
                if bracket_code(p0, p1) == pcode
            )
        except StopIteration:
            continue
        for entry in entries:
            cc, payload = next(iter(entry.items()))
            if cc not in (country, api_cc):
                continue
            meta = payload.get("meta") or {}
            unit = unit or meta.get("unit")
            vals = {}
            for item in payload.get("values", []):
                y, v = item["y"], item["v"]
                if y >= MIN_YEAR and v is not None:
                    vals[y] = v
                    if item.get("dq") is not None:
                        dq_by_year.setdefault(y, []).append(item["dq"])
            per_bracket[idx] = vals
    if not per_bracket:
        return None
    years = sorted({y for vals in per_bracket.values() for y in vals})
    # Behåll bara år där (nästan) alla klasser har data
    full_years = [
        y for y in years
        if sum(1 for i in range(len(BRACKETS)) if y in per_bracket.get(i, {}))
        >= len(BRACKETS) - 2
    ]
    if not full_years:
        return None
    values = [
        [per_bracket.get(i, {}).get(y) for y in full_years]
        for i in range(len(BRACKETS))
    ]
    dqs = dq_by_year.get(full_years[-1]) or []
    dq = round(sum(dqs) / len(dqs), 1) if dqs else None
    return {"unit": unit, "years": full_years, "values": values, "dq": dq}


def fetch_govpc(country):
    """Offentlig konsumtions fotavtryck per capita (kgfghg) – klumpsumman
    i Chancels benchmark. Tidsserie per land."""
    api_cc = API_CODE.get(country, country)
    data = api_get(
        "countries-variables",
        {"countries": api_cc, "variables": "kgfghg_p0p100_999_i", "years": "all"},
        f"{country}_govpc",
    )
    for varcode, entries in data.items():
        for entry in entries:
            cc, payload = next(iter(entry.items()))
            if cc not in (country, api_cc):
                continue
            vals = {item["y"]: item["v"] for item in payload.get("values", [])
                    if item["y"] >= MIN_YEAR and item["v"] is not None}
            if vals:
                years = sorted(vals)
                return {"years": years, "values": [vals[y] for y in years]}
    return None


def fetch_xrates(country):
    if country == "WO":  # världsserierna är redan i PPP-USD
        return {"pppUsd": {"year": 0, "lcuPer": 1.0}}
    data = api_get(
        "countries-variables",
        {"countries": country, "variables": ",".join(XRATES), "years": "all"},
        f"{country}_xrates",
    )
    out = {}
    names = {"xlcusp": "pppUsd", "xlcusx": "merUsd", "xlceup": "pppEur"}
    for varcode, entries in data.items():
        sixlet = varcode.split("_")[0]
        key = names.get(sixlet)
        if not key:
            continue
        for entry in entries:
            cc, payload = next(iter(entry.items()))
            if cc != country:
                continue
            vals = {item["y"]: item["v"] for item in payload.get("values", [])}
            if vals:
                y = max(vals)
                out[key] = {"year": y, "lcuPer": vals[y]}
    return out


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    index = {
        "source": "WID.world",
        "fetched": time.strftime("%Y-%m-%d"),
        "brackets": [[p0, p1] for p0, p1 in BRACKETS],
        "countries": [],
    }
    for cc, (sv, en) in COUNTRIES.items():
        if cc not in CORE:
            try:
                if not probe(cc):
                    continue
            except Exception as e:
                print(f"{cc}: probe-FEL {e}")
                continue
        country = {"code": cc, "nameSv": sv, "nameEn": en, "measures": {}}
        currency = None
        for key in MEASURES:
            try:
                res = fetch_measure(cc, key)
            except Exception as e:
                print(f"  {cc}/{key}: FEL {e}")
                res = None
            if res:
                country["measures"][key] = res
                if key in ("income", "wealth") and res.get("unit"):
                    currency = res["unit"]
        if not country["measures"]:
            print(f"{cc}: ingen data alls, hoppar över")
            continue
        country["currency"] = currency
        try:
            country["xrates"] = fetch_xrates(cc)
        except Exception as e:
            print(f"  {cc}/xrates: FEL {e}")
            country["xrates"] = {}
        try:
            country["govFootprint"] = fetch_govpc(cc)
        except Exception as e:
            print(f"  {cc}/govpc: FEL {e}")
            country["govFootprint"] = None
        (OUT / f"wid_{cc}.json").write_text(
            json.dumps(country, separators=(",", ":"))
        )
        index["countries"].append(
            {
                "code": cc,
                "nameSv": sv,
                "nameEn": en,
                "core": cc in CORE,
                "quality": country["measures"].get("income", {}).get("dq"),
                "measures": {
                    k: {"years": v["years"], "unit": v["unit"]}
                    for k, v in country["measures"].items()
                },
            }
        )
        print(
            f"{cc}: klart – "
            + ", ".join(
                f"{k} {v['years'][0]}–{v['years'][-1]}"
                for k, v in country["measures"].items()
            )
        )
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"\n{len(index['countries'])} länder skrivna till {OUT}")


if __name__ == "__main__":
    main()
