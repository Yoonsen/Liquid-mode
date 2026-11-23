# Pixel-Liquid Mode

**Universell leseflyt (Liquid Mode) for skannet tekst, skjermbilder og IIIF-bøker på piksel-nivå — helt uten OCR.**

I stedet for å tolke bokstaver med feilbarlig OCR (som ofte sliter med fraktur, eldre typografi, slitte typer eller skjermbilder), gjenkjenner **Pixel-Liquid Mode** tekstlinjer, grunnlinje (baseline) og ordskillere (`space`) direkte i bildets piksler. Hvert ord klippes ut som en egen bildebrikke og flyter fritt (`flex-wrap`) tilpasset skjermbredden og brukerens valgte forstørrelse.

## Hovedfunksjoner

- **100 % i nettleseren uten OCR:** Ingen tekst feiltolkes; original typografi og tegnsetting bevares.
- **Sub-piksel Vektor-tracing & Kantglatting:**
  - **Originalt papir:** Viser de faktiske utklipte ordene med papirtekstur.
  - **Renset blekk & Nattmodus:** Bruker sub-piksel **Marching Squares** med **Chaikin-kurveglatting** (eller 3× bikubisk Super-Res) og justerbar **Teksttykkelse (Blekkfylde)** slik at bokstavene forblir sylskarpe selv ved 300–400 % forstørring.
- **IIIF & Nasjonalbiblioteket (NB.no):**
  - Støtter direkte innlasting av fritt tilgjengelige bøker fra Nasjonalbiblioteket via URN (f.eks. Knut Hamsuns *Sult* fra 1890, `URN:NBN:no-nb_digibok_2015051929001`) eller IIIF Presentation/Image-URLer, inkludert full sideblading.
  - All tilgangskontroll styres av Nasjonalbibliotekets egne servere.
- **Spalte- og utsnittsvelger:** Dra en boks over én enkelt spalte eller et avsnitt i flerspaltede aviser og bøker.
- **Egne bilder & utklippstavle:** Last opp bilde fra mobil/PC eller lim inn et skjermbilde direkte med `Ctrl+V` / `⌘V`.

## Kjøre lokalt

Åpne via en enkel lokal statisk webserver:

```bash
python3 -m http.server 8123
```

Gå deretter til `http://127.0.0.1:8123/`.

## Lisens

Utgitt under [MIT-lisensen](LICENSE).
