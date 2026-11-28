# AGENTS.md — Pixel-Liquid Mode

Retningslinjer for kodeagenter (Claude Code, Codex o.l.) som jobber i dette repoet.
Les `README.md` for brukeroversikten og `TODO.md` for arkitektur, status og veikart.

Denne filen er den eneste kilden til agentinstruksjoner. `CLAUDE.md` og `GEMINI.md` importerer den bare
(`@AGENTS.md`). Skriv nye regler her, ikke i de verktøyspesifikke filene.

## Hva appen gjør

Statisk nettleserapp som gjør skannet/pikselbasert tekst om til flytende tekst (reflow) **uten OCR**:
tekstlinjer, grunnlinje og ordmellomrom finnes direkte i pikslene, hvert ord klippes ut (og vektoriseres
med Marching Squares + Chaikin), og ordene flyter som `<canvas>`-brikker i en `flex-wrap`-beholder.
Kilder: egne bilder, utklippstavle, NB.no-URN-er og IIIF Presentation/Image-URLer.

## Filer

| Fil | Innhold |
|---|---|
| `config.js` | **Lokal tilpasning:** appnavn, startbok, standardutseende, NB-søk av/på og bokhyllene. Start her for en egen variant. |
| `index.html` | All markup: bibliotek-visning, fullskjerms leser, paneler. Laster `styles.css?v=N`, `config.js?v=N` og `app.js?v=N`. |
| `styles.css` | All styling. |
| `app.js` | All logikk i én IIFE (~4000 linjer), delt i nummererte seksjoner med `// ====` -overskrifter (se under). |
| `version.json` | Versjon + oppdateringstekst; leses av appen for å vise «ny versjon»-banner. |
| `favicon.svg`, `demo/` | Ikon og demovideoer. |
| `dev/` | Utviklerverktøy (feilsøking i konsollen). Publiseres ikke. |
| `.github/workflows/pages.yml` | Publiserer til GitHub Pages ved push til `main`. |

Seksjoner i `app.js` (finn dem med `grep -n '^  // [0-9]\.' app.js`):

1. Syntetiske eksempelsider og åpne IIIF-kilder (NB.no)
2. Innlasting fra fil, utklippstavle og IIIF (`api.nb.no/catalog/v1`, sidecache `pageImageCache`)
3. Bildeanalyse: gråtoner, integralbilde/adaptiv terskel, Otsu, linje- og ordsegmentering
4. Overlay-tegning av ordbokser og utsnitt
5. Rendering av ord og vektor-tracing (`drawWordTokenCanvas`, `traceMode`)
6. Interaktiv utsnittsmarkering
7. Hendelseslyttere
8. Bibliotek + fullskjerms leser
9. Oppdateringsmelding (`APP_VERSION`, `version.json`)

Delt tilstand ligger i `state`-objektet øverst i `app.js`.

## Kjøre og teste

Ingen byggsteg, ingen avhengigheter, ingen testsuite.

```bash
python3 -m http.server 8123
```

Åpne `http://127.0.0.1:8123/`. Verifiser endringer manuelt i nettleseren:

- Syntetisk eksempelside (ingen nettverk).
- Hamsuns *Sult* fra biblioteket (IIIF fra NB.no) — særlig venstremarg, bindestrek ved linjeslutt og avsnitt.
- Smal mobilbredde (375 px) og stor forstørrelse (300–400 %) i både «Renset blekk» og nattmodus.
- Sjekk nettleserkonsollen for feil.

Segmenteringsendringer bør prøves på flere sider (tittelside, tett sats, side med illustrasjon), fordi
justering av én terskel ofte flytter feil et annet sted.

### Feilsøking i konsollen

Med `?debug` i URL-en (f.eks. `http://127.0.0.1:8123/?debug`) eksponerer appen `window.__pixelLiquid`
(`state`, `sourceCanvas`, `rerun()`, `loadPage(urn, sideindeks)`, `openReader()`). Hjelpefunksjonene i
`dev/debug-console.js` bygger på den:

```js
const D = await import("/dev/debug-console.js");
await D.merged([12, 13, 14, 15, 16]);          // alle sammensydde bindestrek-ord, slik leseren tegner dem
await D.waitLoad(15); D.show(0, 0, 1500, 900, 0.5); // ordbokser, bindestrek-bokser og målt grunnlinje
await D.bookStats([["URN:NBN:no-nb_digibok_2017112348049", [40, 60]]]); // tall per side
```

Nettleseren cacher `app.js?v=N`. Etter en endring: `await fetch('app.js?v=N', {cache: 'reload'})` og last siden på nytt.

For å sammenligne med forrige versjon: legg `git show HEAD:<fil>` for `index.html`, `styles.css` og `app.js`
i en midlertidig mappe og server den på en annen port.

Gode testsider (sideindeks, 0-basert): Sult (`URN:NBN:no-nb_digibok_2015051929001`) 12, 14, 15 (mørk høyre
sidekant), 16, 40, 81 (underlengder som egen linje), 120; frakturboken `…2017112348049` 40, 60; kursiv
småsats `…2006082300044` 12. Oppslag med to sider og håndskrift: Wellcome «Receipt Book» (hylla
«Manuskripter»), side 4. To spalter: den innebygde «Norsk Folkeblad»-demoen. Ingen vanlige NB-boksider skal
deles i flere blokker (`state.detectedTextBlocks` skal være tom).

## Tilpasse appen (lokale varianter)

Appen er laget for at en annen institusjon eller et forskningsprosjekt kan lage sin egen variant raskt,
gjerne med egen AI-agent. Vanlige oppskrifter:

- **Egen bokhylle / samling:** rediger `shelves` i `config.js`. Hvert element har `id`, `title`, `author`, `tag`,
  `note`, valgfritt `cover` (bilde-URL) eller `glyph`, `startPage` (0-basert) og én `source`:
  `{ nbUrn }`, `{ manifest }` (IIIF Presentation 2 eller 3), `{ image }` eller `{ synthetic }`.
- **Annen IIIF-kilde (manuskripter, andre bibliotek):** legg inn manifest-URL-en som `source.manifest`.
  Kilden må tillate henting fra nettleseren (CORS; sjekk med `curl -H 'Origin: http://localhost' -D - <url>`),
  og lisensen må tillate bruken. Bildetjenester med Image API 1 og NB får `native.jpg`, andre `default.jpg`
  (`extractCanvasImage` i `app.js`).
- **Startbok og standardutseende:** `startItem` og `appearance` i `config.js` (lesernes lagrede valg går foran).
- **Uten NB-søk:** `nbSearch: false`.
- **Navn og undertittel:** `app.title` og `app.subtitle` (fanetittelen følger med).
- **Nye fargevalg:** `PALETTES` i `app.js`, en `palette-btn` i `index.html` og `.palette-swatch-*` /
  `.palette-*`-regler i `styles.css`.
- **Spalter, oppslag og håndskrift:** `detectTextBlocks` (spalter/oppslag/XY-cut), `bandsFromLinePitch`
  (reservemetode for linjer når radene aldri blir tomme, typisk håndskrift) og `segmentRegion` (linjer og ord
  i én blokk) i `app.js`. Endringer her må prøves på både trykte NB-sider og materialet du tilpasser til,
  se testsidene under «Kjøre og teste».

Kjente begrensninger: håndskrift med skrå eller bøyde linjer gir fragmenter (linjene søkes vannrett);
overskrifter over flere spalter deles hvis ordmellomrommet faller i spaltemellomrommet.

## Tekniske føringer (fra `TODO.md`)

- **Ingen byggsteg og ingen npm-avhengigheter.** Ren HTML/CSS/vanilla JS. Foreslås et tredjepartsbibliotek,
  oppgi lisens og spør først.
- **Ingen OCR.** All tekstbehandling er piksel- og vektorbasert.
- **Grenser mot frys:** Alle kontur- og søkealgoritmer skal ha øvre grenser for beregningsmengde
  (jf. `segments.length`-grensene i tracingen). Ikke fjern dem.
- **Språk:** Identifikatorer på engelsk. UI-tekst, kodekommentarer og `APP_RELEASE_SUMMARY` på norsk.
- NB.no styrer selv tilgangskontrollen; appen skal bare bruke fritt tilgjengelig materiale og aldri
  omgå tilgangssjekker.

## Utgivelse (versjonsbump)

Ved en ny versjon skal alt dette oppdateres samtidig:

1. `app.js`: `APP_VERSION` og `APP_RELEASE_SUMMARY`.
2. `version.json`: `version`, `updatedAt` (ISO 8601 med tidssone) og `summary` (samme tekst som over).
3. `index.html`: øk `?v=N` på både `styles.css` og `app.js` (cache-busting).
4. Commit-melding: `vX.Y.Z: <kort beskrivelse på norsk>`.
5. Kort statuslinje i `TODO.md` under «Fullført» for større funksjoner.

Nye filer som skal publiseres, må også legges til i `cp`-linjen i `.github/workflows/pages.yml`.

## Overlevering mellom agenter

Arbeid kan bli avbrutt midt i en oppgave (tokens går ut, økten lukkes) og tas opp av en annen agent.
Derfor:

- **Ved start:** les `git status`, `git log --oneline -15` og seksjonen «🚧 Pågår» i `TODO.md`.
  Ucommittede endringer kan være noen andres halvferdige arbeid — ikke forkast dem.
- **Underveis:** hold «🚧 Pågår» i `TODO.md` oppdatert med mål, hva som er prøvd (også det som ikke virket),
  hvilke sider det er testet på (URN + sideindeks), og neste steg. Fjern punktet når det er ferdig og flytt
  en kort linje til «Fullført».
- **Commit-meldingene er historikken:** skriv hva som ble endret *og hvorfor* (hvilket symptom på hvilken side).
- Algoritmeparametere (terskler, prosenter) har ofte en historie i `git log -S '<verdi>' -- app.js`.
  Sjekk den før du endrer en terskel, så du ikke gjeninnfører en feil som er fikset før.

## Git og data

- Spør før commit og push. En push til `main` publiseres straks til GitHub Pages.
- Repoet er offentlig: ingen interne vertsnavn, nøkler eller persondata i kode, commits eller dokumentasjon.
- Ikke legg inn sidebilder eller lengre tekstutdrag fra samlingen i repoet. Bruk URN/IIIF-lenker.
- Store binærfiler (video o.l.) bare i `demo/`, og bare når det er avtalt.
