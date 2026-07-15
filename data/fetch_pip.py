#!/usr/bin/env python3
"""Processar Världsbankens PIP-percentiler (world_100bin.csv, nedladdad av
detta skript om den saknas) till web/data/pip_<CC>.json.

PIP mäter disponibel inkomst ELLER konsumtion per person och DAG i
PPP-dollar (survey-baserat). Vi årsräknar (×365). Jämför med WID som mäter
pre-tax nationalinkomst per VUXEN – nivåskillnader är väntade; formen på
fördelningen är det intressanta att jämföra.
"""

import csv
import json
import urllib.request
from pathlib import Path

URL = "https://datacatalogfiles.worldbank.org/ddh-published/0063646/DR0090251/world_100bin.csv"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "pip_world_100bin.csv"
OUT = ROOT / "web" / "data"

ISO3TO2 = {
    "SWE": "SE", "NOR": "NO", "DNK": "DK", "FIN": "FI", "DEU": "DE",
    "FRA": "FR", "GBR": "GB", "ESP": "ES", "ITA": "IT", "POL": "PL",
    "RUS": "RU", "TUR": "TR", "USA": "US", "CAN": "CA", "MEX": "MX",
    "BRA": "BR", "CHN": "CN", "IND": "IN", "JPN": "JP", "KOR": "KR",
    "IDN": "ID", "ZAF": "ZA", "NGA": "NG", "EGY": "EG", "AUS": "AU",
}


def main():
    if not RAW.exists():
        print("laddar ner", URL)
        urllib.request.urlretrieve(URL, RAW)
    # {cc: {year: {"welfare": str, "values": [100]}}}
    data = {}
    with RAW.open() as f:
        for row in csv.DictReader(f):
            cc = ISO3TO2.get(row["country_code"])
            if not cc or row["reporting_level"] != "national":
                continue
            year = int(row["year"])
            if year < 1990:
                continue
            d = data.setdefault(cc, {}).setdefault(
                year, {"welfare": row["welfare_type"], "values": [None] * 100}
            )
            p = int(row["percentile"])
            d["values"][p - 1] = round(float(row["avg_welfare"]) * 365, 2)

    for cc, years in sorted(data.items()):
        ok_years = sorted(
            y for y, d in years.items() if all(v is not None for v in d["values"])
        )
        if not ok_years:
            continue
        out = {
            "code": cc,
            "source": "PIP",
            "unit": "PPP-USD/år (2021 års priser)",
            "years": ok_years,
            "welfare": {y: years[y]["welfare"] for y in ok_years},
            "values": [[years[y]["values"][i] for y in ok_years] for i in range(100)],
        }
        (OUT / f"pip_{cc}.json").write_text(json.dumps(out, separators=(",", ":")))
        wtypes = sorted(set(out["welfare"].values()))
        print(f"{cc}: {ok_years[0]}–{ok_years[-1]} ({len(ok_years)} år, {'/'.join(wtypes)})")

    idx_path = OUT / "index.json"
    idx = json.loads(idx_path.read_text())
    idx["pip"] = {
        cc: sorted(y for y, d in years.items() if all(v is not None for v in d["values"]))
        for cc, years in sorted(data.items())
    }
    idx["pip"] = {cc: ys for cc, ys in idx["pip"].items() if ys}
    idx_path.write_text(json.dumps(idx, separators=(",", ":")))
    print("index.json uppdaterad med pip-år")


if __name__ == "__main__":
    main()
