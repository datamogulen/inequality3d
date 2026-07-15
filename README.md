# Ojämlikhet i 3D

Interaktiv webbsida som visualiserar **inkomst-, förmögenhets- och
CO₂-ojämlikhet per percentil** för 25 länder, i tre 3D-former som kan
**exporteras som STL** och skrivas ut på en 3D-skrivare (Bambu).

## Köra

```bash
python3 -m http.server 8642          # i projektroten
# öppna http://127.0.0.1:8642/web/
```

(Servern behövs för att sidan läser `node_modules/` och `web/data/` –
att öppna `index.html` direkt från disk fungerar inte. Kör `npm install`
först om `node_modules/` saknas.)

## Vad man kan göra

- **Mått**: inkomst (pre-tax nationalinkomst per vuxen), förmögenhet
  (netto per vuxen), CO₂e-avtryck (per person, konsumtion + investeringar).
- **Valuta**: PPP-USD eller marknadskurs-USD (eller lokal valuta, då utan
  jämförbarhet). **Höjdskalan är fix per mått** – 1 mm är lika mycket
  oavsett land, så modellerna är direkt jämförbara.
- **Tre former**, valfri kombination:
  - *Remsa*: percentil 0–100 längs x, höjd ∝ värde.
  - *Spiral*: fattigast ytterst, rikast i mitten (arkimedisk spiral).
  - *Kvadrat*: 10 rader × 10 centiler; fattigaste raden närmast,
    rikaste centilen längst bort till höger.
- **Toppupplösning**: hela centiler 0–99, tiondelar 99–99,9 och
  hundradelar 99,9–99,99 + p99,99–100 (118 klasser) från WID.
- **Kapa höjd**: linjär skala gör toppen meterhög – sätt t.ex. 60 mm
  för utskrift (kapade staplar plattas av och räknas i etiketten).
- **STL-export** per modell: mm-skala, plint med landsnamnet graverat
  (0,6 mm djupt) i botten, speglat så det läses rättvänt underifrån.
  Font: Open Sans Bold (öppen licens). Geometrin är verifierad
  vattentät (`node scripts/check_geometry.mjs`).

## Datakällor

| Källa | Fil | Vad |
|---|---|---|
| **WID.world** | `data/fetch_wid.py` → `web/data/wid_*.json` | `aptinc992j` (inkomst), `ahweal992j` (förmögenhet), `lpfghg999i` (CO₂e-avtryck, Chancel 2021 – samma underlag som Oxfams rapporter), `xlcusp/xlcusx` (PPP/MER). 1990–2024 (CO₂ t.o.m. 2019). |
| **Världsbanken PIP** | `data/fetch_pip.py` → `web/data/pip_*.json` | 100 percentiler av disponibel inkomst/konsumtion per person (survey, PPP-USD). Bra kontrast till WID: surveydata fångar inte toppen. |

Kända skillnader källorna emellan (avsiktligt synliga i verktyget):
WID:s inkomstbegrepp är nationalinkomst före skatt per vuxen (inkl.
kapital), PIP:s är disponibel inkomst/konsumtion per person – PIP ger
mycket lägre toppar. För Kina/Indien är PIP **konsumtion**, märks i
etiketten. WID:s CO₂-fördelningar har låg datakvalitet enligt WID själva.

Rådata cachas i `data/raw/` (gitignorerad) – radera en fil där för att
tvinga omhämtning. WID hämtas via samma API som deras officiella
R-paket (nyckeln ligger öppet i paketet).

## Kod

- `web/js/geometry.js` – vattentäta solider (svepta lådor längs bana,
  plint, gravyr). Allt i mm, Z uppåt; delarna överlappar 0,06–0,1 mm så
  slicern kan unionera.
- `web/js/text.js` – opentype.js → THREE-shapes, speglade, med
  mikrojitter per glyf (bryter exakt kollinjäritet som annars ger
  T-korsningar i earcut vid extrudering – lärdom!).
- `web/js/data.js` – laddning/normalisering, PPP/MER-konvertering.
- `web/js/stl.js` – binär STL-skrivare.
- `web/js/main.js` – UI + Three.js-scen.
- `scripts/check_geometry.mjs` – bygger testmodeller och kontrollerar
  kantparning (vattentäthet), volymorientering och bbox; skriver
  test-STL:er till `out/`.

Utskriftstips (Bambu Studio): importera STL, ingen reparation ska
behövas. 0,2 mm lager funkar; texten i botten blir tydligast med
0,12 mm förstalager. Vid "kapa höjd" över ~150 mm: tänk på vippning –
staplarna är smala.
