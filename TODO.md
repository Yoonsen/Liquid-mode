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

### ✅ Fullført i v1.4 – v1.7
- [x] To-delt visning: **Bibliotek** (kuraterte bøker + direkte søk mot NB.no Public Domain) og **Fullskjerms leser** med tidsstyrte flytende HUD-piller (`← Bibliotek` og `Aa Utseende`).
- [x] Nytt **Pixel-to-Liquid SVG-favicon** (`favicon.svg`).
- [x] Smart linjebryting (`Auto`): Beholder original linjelengde når skjermen har plass, og går automatisk over i Liquid-flyt ved forstørrelse.
- [x] Papir-forankret Otsu-terskel + kontur-sikring mot frys på tittelsider (som Amalie Skrams *Sommer*).
- [x] **Fase 1.1: Lokal adaptiv terskel (2D Integral Image / Summed-Area Table)** for bokrygg-skygger (*gutter shadow*) og ujevn belysning på pocketbøker.
- [x] **Fase 1.2: Automatisk tekstblokk-deteksjon (Auto-beskjæring)** som skreller bort mørke skannekanter og bokrygg-striper + egen `✨ Auto-beskjær`-knapp i utsnittspanelet.
- [x] **Fler-signals avsnittsgjenkjenning (v1.6.0):** Kombinerer 1) ekstra vertikal linjeavstand, 2) første-linjes innrykk i klassisk boksats (`> 0.65 × linjehøyde` fra venstremarg), og 3) kort avslutningslinje på foregående linje (`> 14 %` før høyremarg), med visuelt innrykk på nye avsnitt.
- [x] **Geometrisk orddeling og bindestrek-sammensying (v1.6.0 – v1.6.1):** Gjenkjenner bindestrek (`-` / `=`) ved linjeslutt via streng horisontal pikselgeometri (`inkH <= 24 %` av linjehøyden, `runW >= 1.3 × inkH`, sentrert rundt x-høyden `yCore`), trimmer bort bindestreken og syr sammen `Fyr-` + `direktøren` til ett udelelig ord (`Fyrdirektøren`) i Liquid-modus!
- [x] **Fase 1.3 – Per-ord Baseline- & Helnings-alignment («De-jagg» når linje $N$ møter linje $N+1$, v1.7.0):**
  - Beregner hvert ords eget x-høyde-tyngdepunkt og tilpasser en Gaussisk-vektet lokal lineær regresjon (LOESS) langs linjen for å finne ordets lokale grunnlinje `yCoreLocal` og lokale helning `localSlope`.
  - Klipper ut hvert ord sentrert rundt sin lokale `yCoreLocal` og retter opp ordets helning til $0^\circ$ med rask vertikal skjæring (*vertical shear* med bilineær vertikal interpolasjon) direkte i `extractWordScalarField` (< 0,3 ms per side). Dermed møtes siste ord på linje $N$ og første ord på linje $N+1$ snorrett i CSS Flexbox!
  - Viser den tilpassede lokale grunnlinjekurven som en stiplet gull-linje i `✂️ Utsnitt & Skjevhet`-inspektøren, og kan skrus av/på under `▸ LAB` (`Lokal grunnlinje & helning (De-jagg)`).

- [x] **v1.8.0 – Renere linjeskift og sikrere orddeling:**
  - Mørke sidekanter/bokrygg og støv i margen maskeres via vertikal projeksjon over hele siden (smale blekkblokker > 1,5 linjehøyder utenfor tekstsatsen), så de ikke blir egne «ord» (vertikale streker) ytterst på linjene.
  - Frittstående støvkorn (< 0,8 % av linjehøyden² i blekkpiksler) droppes.
  - Tynne bånd rett under en linje (avkuttede underlengder) slås sammen med linjen over i stedet for å bli en egen linje.
  - Bindestrek må ligge midt i x-høyden (målt over de siste ~6 linjehøydene av linjen); armen på «r» og øret på «g» avvises. Dobbel/skrå frakturbindestrek (⸗) gjenkjennes og fjernes helt.
  - Skjæringen (de-jagg) dreier rundt samme kolonne også når bindestreken er kuttet bort; leseren midtstiller ordbrikkene (`align-items: center`).
  - Testet på Sult s. 12–18, 40, 50, 51, 81, 120, 150, 151, 200, 250, 300 og de fire andre bøkene i biblioteket: alle sammensydde ord riktige, ingen falske.

- [x] **v1.9.0 – Utklipp etter målt grunnlinje:** Grunnlinjen (underkanten av x-høyden, persentilmetoden) måles i overlappende vinduer på ~4 linjehøyder langs hver linje; avvikende vinduer forkastes, og en lokal vektet rett linje gir grunnlinje og helning per ord. Utklippene legges etter denne i stedet for ordets eget blekktyngdepunkt (som er reserve). Målt med `D.measure()` på 17 sider i fem bøker: ordpar med ≥ 3 px avvik ved linjeskift 18,4 % → 10,9 % (innenfor linjene uendret ~14 %, som er målestøyen). Inspektørens stiplede kurve viser nå selve grunnlinjen.

- [x] **v1.10.0 – Forenklet Aa-meny:** Tekststørrelse, én glider «Boksiden ↔ Renset tekst», fire fargevalg (Papir/Hvit/Sepia/Natt), strektykkelse, kant skarp ↔ myk og linjeavstand. Linjebryting, ordskille og LAB under «Avansert». Hvert ord er to canvas oppå hverandre (`.word-orig` + `.word-ink`); glideren og kantmykheten er bare CSS-variabler (`--orig-opacity`, `--ink-opacity`, `--ink-blur`) og reagerer umiddelbart. Originalen lyses opp og multipliseres (natt: grå + invertert + screen), så utklippene smelter inn i bakgrunnen. Valgene lagres i `localStorage` (`pixel_liquid_appearance`).

- [x] **v1.10.1 – WCAG 1.4.10 Reflow:** Ordbrikker får aldri bli bredere enn leseflaten (`max-width: 100%`, høyden følger sideforholdet). Bredden settes uavrundet, så høyden er eksakt h × skala (avrundet bredde ga opptil flere px feil i høyden på smale ord). Testet: ingen sideveis skrolling i 320 px bredde ved 100 % og 350 % (Sult s. 12, 15, 40).

- [x] **v1.11.0 – Tilpassbar app, spalter og oppslag:**
  - `config.js`: appnavn, startbok, standardutseende, NB-søk av/på og bokhyller (kilder: NB-URN, IIIF-manifest v2/v3, bilde, innebygd demo). Bibliotekssiden bygges fra konfigurasjonen.
  - IIIF Presentation 3 og andre leverandører: språkkart-etiketter, `default.jpg` for Image API 2/3 (NB/Image API 1 beholder `native.jpg`).
  - `detectTextBlocks`: vertikal projeksjon over siden (rader som i hovedsak er mørke hoppes over) finner tekstblokker skilt av tomme renner eller mørke striper; skygge (mørkere rått papir) og skarpe kantstreker trimmes; blokkene utvides litt i tomme marger. Første nivå av XY-cut: rader med blekk i spaltemellomrommet blir blokker i full bredde. `segmentRegion` kjøres per blokk, og linjene settes sammen i lesrekkefølge. Ingen av 23 testede NB-boksider deles.
  - `bandsFromLinePitch`: når radene aldri blir tomme (håndskrift), finnes linjeavstanden med autokorrelasjon og linjene deles i dalene.
  - Originalutklipp: hvitbalanse per fargekanal (SVG-filter) fra papirfargen målt i ordutklippene, så flekket/gulnet papir ikke gir synlige rektangler.
  - Eksempel i biblioteket: Wellcome «Receipt Book, 18th century» (Public Domain Mark), oppslag med to håndskrevne sider.

### 🚧 Pågår
_(Ingenting akkurat nå. Skriv mål, hva som er prøvd, testsider og neste steg her når du starter på noe.)_

Mulig neste steg: behandle hvert avsnitt som én sammenhengende sekvens når grunnlinjen glattes (siste ord på linje N og første på N+1 som naboer), og se om det slår v1.9.0 på `D.measure()`.

Kjente svakheter å se på:
- Håndskrift med skrå/bøyde linjer gir fragmenter (linjer søkes vannrett i hele blokken). Mulig løsning: linjesøk i vertikale striper som kobles sammen, eller skjevhet per blokk.
- XY-cut: overskrift over to spalter deles hvis ordmellomrommet i overskriften faller i spaltemellomrommet (f.eks. «Norsk Folkeblad»-demoen).
- Orddeling sys ikke sammen på tvers av spalter/sider.
- Stor initial (som «D» i Sult s. 12) blir delt over to linjer.
- I `continuous-liquid-flow` får sammensydde ord fra kursiv småsats av og til et lite mellomrom før andre del (f.eks. «theater historie», bok …300044 s. 100).

### 🔜 Neste steg (Fase 1.4 & Fase 2)
1. **Fase 1.4 – Typografisk marg-justering (Blokkjustering & Midtstilte overskrifter):**
   - Gruppere ordene per avsnitt i `<div class="liquid-paragraph">` med `display: inline-block` og CSS `text-align: justify; text-align-last: left;` (samt `text-align: center` for korte, symmetriske overskrifter).
3. **Fase 1.5 – Ytelsesoptimalisering på svært lange sider:**
   - Vurdere `IntersectionObserver` (lazy-rendering av ord-canvases under bretten) dersom sider med > 600 ord (f.eks. store avissider) oppleves tunge på eldre telefoner.
4. **Fase 2.1 – Automatisk kolonnedeteksjon (Flerspalters bøker og aviser):**
   - Oppdage vertikale hvite renner (*column gutters*) automatisk og lese spalte for spalte ovenfra og ned uten at brukeren trenger å markere én spalte manuelt.
5. **Fase 2.2 – Filtrering av dekorative skillelinjer:**
   - Filtrere ut lange horisontale/vertikale spaltelinjer og tabellstreker i aviser slik at de ikke slår sammen ord.

---

## 4. Tekniske føringer
- **Ingen eksterne byggsteg:** Ren, statisk HTML/CSS/Vanilla JS for direkte hosting på GitHub Pages (inkl. `version.json` oppdateringssjekk).
- **Ingen OCR:** All tekstbehandling er ren piksel- og vektorbasert datasyn.
- **Beskytt mot frys på illustrasjoner:** Alle kontur- og bildesøk-algoritmer skal ha øvre grenser for beregningsmengde.
- **Språk:** All UI-tekst, kommentarer i koden og oppdateringsmeldinger (`APP_RELEASE_SUMMARY`) skrives på norsk.
