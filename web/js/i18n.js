// Internationalisering sv/en – samma mönster som övriga hedin.it-projekt:
// I18N-ordbok, tr(), data-i18n-attribut, växlarknapp, localStorage.

export const I18N = {
  sv: {
    htmlLang: "sv", langBtn: "English",
    docTitle: "Ojämlikhet i 3D – inkomst, förmögenhet, CO₂",
    title: "Ojämlikhet i 3D",
    sub: "Percentildata från WID.world · för skärm och 3D-utskrift",
    fs_measure: "Mått",
    m_income: "Inkomst (pre-tax, per vuxen)",
    m_wealth: "Förmögenhet (netto, per vuxen)",
    m_carbon: "CO₂e-avtryck (per person)",
    currency: "Valuta",
    cur_ppp: "PPP-USD", cur_mer: "USD, marknadskurs", cur_lcu: "Lokal valuta (ej jämförbart!)",
    source: "Datakälla", src_wid: "WID.world", src_pip: "Världsbanken PIP",
    fs_year: "År:",
    yearHint: "Saknas året för ett land används närmaste tillgängliga.",
    yearHintCarbon: "CO₂-data finns t.o.m. 2019. Saknas året för ett land används närmaste.",
    fs_countries: "Länder", q_nordics: "Norden", q_clear: "Rensa",
    fs_shape: "Form",
    sh_strip: "Remsa (percentil-staket)",
    sh_spiral: "Spiral (rikast i mitten)",
    sh_square: "Kvadrat (10 × 10 rader)",
    fs_top: "Toppen",
    top_skip: "Utelämna", top_none: "Inget – visa allt",
    top_1: "topp 1 %", top_01: "topp 0,1 %", top_001: "topp 0,01 %",
    top_show: "Visa toppdelen bredvid, i verklig höjd",
    top_style: "Toppdel som",
    top_avg: "klump: viktad snitthöjd, verklig bas",
    top_stairs: "trappa: full detalj, lika breda klasser",
    lbl_avg: "snitt",
    top_hint: "Toppen trycker annars ihop allt annat. Klumpen har gruppens viktade snitthöjd och verklig bas i modellens skala (min 0,8 mm för utskrift). Trappan visar hela detaljen upp till sista hundradelen – meterhög, skrivs ut i liggande segment som limmas. (Världsbanken PIP har bara hela centiler – där finns bara topp 1 %.)",
    fs_scale: "Skala & storlek",
    scaleName: "Höjdskala",
    btn_median: "Median → 3 mm", btn_max: "Högsta → 80 mm",
    baseSize: "Modellbredd (mm)",
    clamp: "Kapa höjd vid (mm, 0 = av)",
    scale_hint: "Höjdskalan är gemensam för alla länder – 1 mm motsvarar alltid lika mycket, oavsett land.",
    fs_export: "Export (STL för Bambu)",
    seg_len: "Toppdelens segmentlängd (mm)",
    btn_exportAll: "Exportera alla synliga",
    export_hint: "Landsnamnet graveras i botten, speglat så att det läses rättvänt underifrån (Open Sans). ”Text” = inläggsbit som jackar i gravyren – skriv ut i annan färg (krymp 0,05–0,1 mm med XY-kompensering i slicern om den sitter trångt). ”Topp” = toppdelen i liggande segment.",
    sources_note: "Källor: inkomst/förmögenhet WID.world (aptinc/ahweal, konstanta priser); CO₂e Chancel (2021) & uppdateringar via WID – konsumtions- och investeringsbaserat avtryck, samma data som Oxfams rapporter bygger på. OBS: WID anger kvaliteten på CO₂-fördelningarna som låg – tolka toppen som storleksordning.",
    code_pre: "Kod: ", code_post: " – byggd av Claude utifrån en enda prompt (se README).",
    loading: "Laddar …", building: "Bygger …",
    status: (n, m, s, u) => `${n} modeller · ${m} · skala ${s} ${u}`,
    measure_income: "Inkomst", measure_wealth: "Förmögenhet", measure_carbon: "CO₂e-avtryck",
    unit_money: "mm / 10 000 USD", unit_money_lcu: "mm / 10 000 (lokal valuta)", unit_carbon: "mm / ton CO₂e",
    shape_strip: "remsa", shape_spiral: "spiral", shape_square: "kvadrat",
    lbl_top: (h) => `högsta stapel ${h}`, lbl_shown: (h) => `(visas ${h})`,
    lbl_clamped: (n) => `${n} kapade`,
    lbl_cut: (p) => `utan topp ${p}`,
    lbl_toppiece: (p, h) => `toppdelen (${p}): ${h}`,
    lbl_pip: (w) => `PIP (${w})`, welfare_cons: "konsumtion", welfare_inc: "disp. inkomst",
    warn_nodata: (c) => `${c}: ingen data för valt mått/valuta`,
    warn_neg: (c) => `${c}: negativa värden (skulder) kapas vid 0`,
    warn_carbon: "CO₂-fördelningarna: låg datakvalitet enligt WID – toppvärden är modellskattningar",
    warn_lcu: "Lokal valuta: höjder är INTE jämförbara mellan länder",
    warn_pip: "PIP: disponibel inkomst/konsumtion per person (survey) – lägre nivåer än WID:s nationalinkomst per vuxen är väntat",
    exp_model: "STL", exp_inlay: "text", exp_top: "topp",
    exp_top_title: (n, h) => `${n} liggande segment, verklig höjd ${h}`,
    no_models: "Inga modeller.",
    file_measure: { income: "inkomst", wealth: "formogenhet", carbon: "co2" },
    file_top: "topp", file_text: "text",
  },
  en: {
    htmlLang: "en", langBtn: "Svenska",
    docTitle: "Inequality in 3D – income, wealth, CO₂",
    title: "Inequality in 3D",
    sub: "Percentile data from WID.world · for screen and 3D printing",
    fs_measure: "Measure",
    m_income: "Income (pre-tax, per adult)",
    m_wealth: "Wealth (net, per adult)",
    m_carbon: "CO₂e footprint (per person)",
    currency: "Currency",
    cur_ppp: "PPP USD", cur_mer: "USD, market rate", cur_lcu: "Local currency (not comparable!)",
    source: "Data source", src_wid: "WID.world", src_pip: "World Bank PIP",
    fs_year: "Year:",
    yearHint: "If a year is missing for a country, the nearest available is used.",
    yearHintCarbon: "CO₂ data ends in 2019. If a year is missing for a country, the nearest is used.",
    fs_countries: "Countries", q_nordics: "Nordics", q_clear: "Clear",
    fs_shape: "Shape",
    sh_strip: "Strip (percentile fence)",
    sh_spiral: "Spiral (richest at the centre)",
    sh_square: "Square (10 × 10 rows)",
    fs_top: "The top",
    top_skip: "Leave out", top_none: "Nothing – show all",
    top_1: "top 1%", top_01: "top 0.1%", top_001: "top 0.01%",
    top_show: "Show the top piece alongside, at true height",
    top_style: "Top piece as",
    top_avg: "block: weighted average height, true base",
    top_stairs: "staircase: full detail, equal-width brackets",
    lbl_avg: "avg",
    top_hint: "Otherwise the top flattens everything else. The block has the group's weighted average height and a true-scale base (min 0.8 mm for printability). The staircase shows full detail up to the last hundredth – metres tall, printed as lying segments to glue. (World Bank PIP only has whole centiles – only top 1% applies there.)",
    fs_scale: "Scale & size",
    scaleName: "Height scale",
    btn_median: "Median → 3 mm", btn_max: "Highest → 80 mm",
    baseSize: "Model width (mm)",
    clamp: "Clamp height at (mm, 0 = off)",
    scale_hint: "The height scale is shared across countries – 1 mm always represents the same amount, whichever country you look at.",
    fs_export: "Export (STL for Bambu)",
    seg_len: "Top piece segment length (mm)",
    btn_exportAll: "Export all visible",
    export_hint: "The country name is engraved in the bottom, mirrored so it reads correctly from below (Open Sans). “Text” = inlay piece that fits into the engraving – print it in another colour (shrink 0.05–0.1 mm with XY compensation in the slicer if tight). “Top” = the top piece as lying segments.",
    sources_note: "Sources: income/wealth WID.world (aptinc/ahweal, constant prices); CO₂e Chancel (2021) & updates via WID – consumption- plus investment-based footprints, the same data Oxfam's reports build on. Note: WID rates the quality of the CO₂ distributions as low – treat the top as an order of magnitude.",
    code_pre: "Code: ", code_post: " – built by Claude from a single prompt (see README).",
    loading: "Loading …", building: "Building …",
    status: (n, m, s, u) => `${n} models · ${m} · scale ${s} ${u}`,
    measure_income: "Income", measure_wealth: "Wealth", measure_carbon: "CO₂e footprint",
    unit_money: "mm / 10,000 USD", unit_money_lcu: "mm / 10,000 (local currency)", unit_carbon: "mm / tonne CO₂e",
    shape_strip: "strip", shape_spiral: "spiral", shape_square: "square",
    lbl_top: (h) => `tallest bar ${h}`, lbl_shown: (h) => `(shown ${h})`,
    lbl_clamped: (n) => `${n} clamped`,
    lbl_cut: (p) => `top ${p} left out`,
    lbl_toppiece: (p, h) => `top piece (${p}): ${h}`,
    lbl_pip: (w) => `PIP (${w})`, welfare_cons: "consumption", welfare_inc: "disp. income",
    warn_nodata: (c) => `${c}: no data for the chosen measure/currency`,
    warn_neg: (c) => `${c}: negative values (debt) are cut at 0`,
    warn_carbon: "The CO₂ distributions: low data quality according to WID – top values are model estimates",
    warn_lcu: "Local currency: heights are NOT comparable across countries",
    warn_pip: "PIP: disposable income/consumption per person (survey) – lower levels than WID's national income per adult are expected",
    exp_model: "STL", exp_inlay: "text", exp_top: "top",
    exp_top_title: (n, h) => `${n} lying segments, true height ${h}`,
    no_models: "No models.",
    file_measure: { income: "income", wealth: "wealth", carbon: "co2" },
    file_top: "top", file_text: "text",
  },
};

const urlLang = new URLSearchParams(location.search).get("lang");
let LANG = (urlLang === "sv" || urlLang === "en") ? urlLang
  : localStorage.getItem("ineq3d_lang") ||
    ((navigator.language || "en").toLowerCase().startsWith("sv") ? "sv" : "en");
if (LANG !== "sv" && LANG !== "en") LANG = "en";

export const getLang = () => LANG;
export const t = (k) => I18N[LANG][k] ?? I18N.en[k] ?? k;

export function toggleLang() {
  LANG = LANG === "sv" ? "en" : "sv";
  localStorage.setItem("ineq3d_lang", LANG);
}

// Sätter alla statiska texter (element med data-i18n)
export function applyStatic() {
  document.documentElement.lang = t("htmlLang");
  document.title = t("docTitle");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
}

export const countryName = (c) => (LANG === "sv" ? c.nameSv : c.nameEn);
