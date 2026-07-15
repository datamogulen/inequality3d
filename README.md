# Inequality in 3D / Ojämlikhet i 3D

Interaktiv webbsida (svenska/engelska) som visualiserar **inkomst-,
förmögenhets- och CO₂-ojämlikhet per percentil** för 25 länder, i tre
3D-former som kan **exporteras som STL** och skrivas ut på en
3D-skrivare (Bambu).

*Interactive web page (Swedish/English) visualizing income, wealth and
carbon-footprint inequality per percentile for 25 countries, as three 3D
shapes exportable as 3D-printable STL models.*

**Live: <https://hedin.it/inequality3d/>**

## Bakgrund

Byggt som experiment: hela projektet – datakällsval, hämtning från två
API:er, webbapp, STL-generering med gravyr, verifiering – skapades av
Claude (Fable 5) i **en session utifrån en enda prompt** (2026-07-15),
plus två uppföljningar (publicering till GitHub/hedin.it; toppdel som
egen utskrivbar del, textinlägg för flerfärg, sv/en och OG-taggar).
Ursprungsprompten i sin helhet:

> Jag vill nu göra först en interaktiv webbsida som visualiserar dessa
> ojämlikhetsmått [inkomstfördelning per centil eller finare per land,
> konsumtionsbaserade koldioxidavtryck, förmögenhet]. Jag vill kunna testa
> att visualisera data fr ett land på olika sätt. Ett kan vara en vanlig
> graf (mer detaljerad på toppen där högsta inkomster/utsläpp finns) som
> ska vara 3D och där X-axeln är percentil (eller finare), Y-axeln är fix
> typ "någon centimeter" och Z-axeln är proportionell mot data. En annan
> kan vara en spiral som börjar med fattigast/lägst utsläpp ytterst och
> sedan spiralar sig in mot mitten där de med högst inomst/utsläpp finns.
> Även en kvadrat med första raden som de fattigaste 10 procenten (eller
> utsläppen) och sedan varje rad efter som allt rikare. […] Man ska kunna
> välja ett eller flera länder […] Viktigt är att Z-axeln ska vara fix per
> kategori. […] Och sen ska man kunna exportera det man ser till STL-filer
> som man kan skriva ut på en bambuskrivare, med landet ingraverat i
> botten på lämpligt sätt (och åt ett håll så man ser texten rättvänt om
> man tittar på modellen underifrån. […] Och datakällor får du välja
> själv, finns flera ska man kunna testa olika för att se hur väl de
> stämmer överens med varandra.

## Köra

```bash
python3 -m http.server 8642          # i projektroten
# öppna http://127.0.0.1:8642/web/
```

Sidan är självförsörjande (three.js och opentype.js ligger vendorerade i
`web/vendor/`) – en enkel statisk server räcker, ingen npm behövs.
`npm install` behövs bara för utvecklarskriptet
`scripts/check_geometry.mjs` och för att uppdatera vendor-filerna.

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
- **Toppen som viktat snitt** (standard: topp 1 % av befolkningen; även
  0,1 %/0,01 %, eller full detalj): toppgruppen slås ihop till EN stapel
  med gruppens viktade snitthöjd, **integrerad i modellen** på sin
  riktiga plats och med verklig bas (remsans sista 1 % ≈ 0,9 mm tunn,
  spiralens mittpelare, kvadratens bortre hörn; min 0,8 mm bas för
  utskrift). USA:s topprocent i inkomst blir då 94 mm i stället för
  2,1 m (snittet av topp 0,01 %) vid 0,5 mm/10 000 USD – modellen
  skrivs ut i ett stycke. Full detalj (hundradelar) finns kvar för den
  som vill se hela dramat.
- **Kapa höjd** finns också kvar som alternativ (kapade staplar plattas
  av och räknas i etiketten).
- **STL-export** per modell: mm-skala, plint med landsnamnet graverat
  (0,6 mm djupt) i botten, speglat så det läses rättvänt underifrån.
  Font: Open Sans Bold (öppen licens). Dessutom en **inläggs-STL**
  (”text”) med bokstäverna som egen solid i samma koordinatsystem – den
  jackar i gravyren och kan skrivas ut i annan färg (krymp 0,05–0,1 mm
  med XY-kompensering i slicern om den sitter trångt; skriv ut med
  ovansidan mot bädden som filen ligger). Geometrin är verifierad
  vattentät (`node scripts/check_geometry.mjs`).
- **Språk**: svenska/engelska (auto via webbläsaren, växlare i sidofältet,
  `?lang=sv`/`?lang=en` fungerar också). Gravyren följer valt språk.

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
- `web/js/i18n.js` – strängtabell sv/en (samma mönster som övriga
  hedin.it-projekt).
- `scripts/check_geometry.mjs` – bygger testmodeller och kontrollerar
  kantparning (vattentäthet), volymorientering och bbox; skriver
  test-STL:er till `out/`.

Utskriftstips (Bambu Studio): importera STL, ingen reparation ska
behövas. 0,2 mm lager funkar; texten i botten blir tydligast med
0,12 mm förstalager. Vid "kapa höjd" över ~150 mm: tänk på vippning –
staplarna är smala.
