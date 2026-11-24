# Pixel-Liquid Mode — Handover, Arkitektur & Veikart (TODO)

## 1. Prosjektoversikt & Formål
**Pixel-Liquid Mode** er en klientbasert nettleserapplikasjon som gjør skannede bøker, dokumenter, mobilbilder av pocketbøker og IIIF-bilder lesbare på mobil og for svaksynte – **helt uten OCR**.

I stedet for tradisjonell panorering/zooming segmenterer appen tekstlinjer og enkeltord direkte fra pikslene, vektoriserer dem med sub-piksel Marching Squares + Chaikin-glatting, og flyter ordene om som responsive `<canvas>`-brikker (`flex-wrap`).

### Hovedmålgrupper
1. **Mobillesere av skannet tekst & IIIF-arkivmateriale (bl.a. Nasjonalbiblioteket / NB.no):** Slipper horisontal scrolling på smale skjermer.
2. **Svaksynte:** Kan forstørre ordene som skarpe vektorfigurer med justerbar blekkfylde, høykontrast (mørk modus) og valgfri linjeavstand uten pikselering.

---

## 2. Arkitektur & Kjerneflyt (`index.html`, `styles.css`, `app.js`, `version.json`)

### Innlasting & IIIF-integrasjon
- Støtter direkte bildeopplasting, innliming fra utklippstavle (`Ctrl/Cmd+V`), NB.no URN-er (`URN:NBN:no-nb_digibok_...`), IIIF Presentation-manifester og IIIF Image API-URLer.
- Spør NB.no Katalog API (`api.nb.no/catalog/v1/items`) om tilgang og henter sidemanifest.
- **RAM-cache & Prefetching:** `pageImageCache` (maks 14 sider) forhåndslaster neste 2 sider og forrige side i bakgrunnen for umiddelbar sideblading.
- **Tapsfri rotasjon (Deskew):** `rawMasterCanvas` holder på urotert originalbilde slik at manuell og automatisk oppretting (`autoDetectSkewAngle` via horisontal projeksjonsvarians) aldri forringer bildekvaliteten.

### Bildeanalyse & Segmentering (`runSegmentationAndRender`)
1. **Lokal adaptiv terskel via 2D Integral Image (Summed-Area Table) + Papir-forankret Otsu:**
   - Beregner en 2D Summed-Area Table (`state.integralGray`) over bildet på < 2 ms, slik at hver piksel sammenlignes med gjennomsnittlig lokal papirlysstyrke i et `35×35 px` vindu (`localMean`).
   - Dermed håndteres mørke skygger inn mot bokryggen (*gutter shadow* på pocketbøker) og ujevn mobilbelysning sømløst, samtidig som `state.normalizedGray` normaliserer bakgrunnen til jevn papirverdi før Marching Squares-tracing!
2. **Automatisk tekstblokk-deteksjon (`autoDetectTextBlockCrop`):**
   - Skreller automatisk bort svarte skannekanter / mørke bokrammer langs ytterkantene av bildet og finner tekstsatsens faktiske yttergrenser.
3. **Horisontal & Vertikal projeksjon:**
   - Finner sammenhengende tekstlinjer (`rowCounts`), beregner blekk-tyngdepunkt (`yCore`) for felles baseline, oppdager avsnittsskift og skiller kerning fra ordmellomrom.

### Vektor-tracing & Rendering (`drawWordTokenCanvas`)
- **4 visningsalgoritmer (`traceMode`):** `vector` (standard), `superres` (3× Bicubic Catmull-Rom), `raw` (1×), og `wireframe` (debug med kontrollpunkter).
- **Marching Squares + Chaikin Corner-Cutting:**
  - Polstrer hvert ord med 1 px papirverdi (255) for garantert lukkede konturer og bruker `ctx.fill("evenodd")` for indre hull (`o`, `e`, `a`, `b`, `d`, `g`).
  - Har sikkerhetsgrenser (`segments.length > 3600` reduserer Chaikin til 1 steg; `> 9000` avbryter) for å hindre frys på illustrasjoner/segl.
- **Smart Auto-Flow (`evaluateSmartLineFlow`):**
  - Måler 85-persentil originallinjebredde (`baseNaturalLineWordSum`). Hvis linjen får plass i vinduet, beholdes bokens originale linjeskift (`preserve-original-lines`). Ved zoom eller smal mobilskjerm bytter den sømløst til kontinuerlig flyt (`continuous-liquid-flow`).

---

## 3. Veikart & Status

### ✅ Fullført i v1.4 – v1.5
- [x] To-delt visning: **Bibliotek** (kuraterte bøker + direkte søk mot NB.no Public Domain) og **Fullskjerms leser** med tidsstyrte flytende HUD-piller (4,2 sek).
- [x] Smart linjebryting (`Auto`): Beholder original linjelengde når skjermen har plass, og går automatisk over i Liquid-flyt ved forstørrelse.
- [x] Papir-forankret Otsu-terskel + kontur-sikring mot frys på tittelsider (som Amalie Skrams *Sommer*).
- [x] **Fase 1.1: Lokal adaptiv terskel (2D Integral Image / Summed-Area Table)** for bokrygg-skygger (*gutter shadow*) og ujevn belysning på pocketbøker.
- [x] **Fase 1.2: Automatisk tekstblokk-deteksjon (Auto-beskjæring)** som skreller bort mørke skannekanter og bokrygg-striper + egen `Auto-utsnitt`-knapp i utsnittspanelet.

### 🔜 Neste steg (Fase 1.3 & Fase 2)
1. **Fase 1.3 – Ytelsesoptimalisering på svært lange sider:**
   - Vurdere `IntersectionObserver` (lazy-rendering av ord-canvases under bretten) dersom sider med > 600 ord (f.eks. store avissider) oppleves tunge på eldre telefoner.
2. **Fase 2.1 – Automatisk kolonnedeteksjon (Flerspalters bøker og aviser):**
   - Oppdage vertikale hvite renner (*column gutters*) automatisk og lese spalte for spalte ovenfra og ned uten at brukeren trenger å markere én spalte manuelt.
3. **Fase 2.2 – Filtrering av dekorative skillelinjer:**
   - Filtrere ut lange horisontale/vertikale spaltelinjer og tabellstreker i aviser slik at de ikke slår sammen ord.
4. **Fase 2.3 – Lokal linjekrumning (Unwarp ved bokrygg):**
   - Følge linjekrumningen lokalt inn mot bokryggen på tykke pocketbøker der tekstlinjene bøyer seg nedover ytterst i margen.

---

## 4. Tekniske føringer
- **Ingen eksterne byggsteg:** Ren, statisk HTML/CSS/Vanilla JS for direkte hosting på GitHub Pages (inkl. `version.json` oppdateringssjekk).
- **Ingen OCR:** All tekstbehandling er ren piksel- og vektorbasert datasyn.
- **Beskytt mot frys på illustrasjoner:** Alle kontur- og bildesøk-algoritmer skal ha øvre grenser for beregningsmengde.
- **Språk:** All UI-tekst, kommentarer i koden og oppdateringsmeldinger (`APP_RELEASE_SUMMARY`) skrives på norsk.
