# DH2027 Galway – poster abstract (utkast)

> Arbeidsutkast. Frist (ifølge egne notater): 30.11.2026 AoE. Før innsending: sjekk ordgrense,
> krav om anonymisering, malen i innsendingssystemet og grensen for antall bidrag per person.
> Navnet på verktøyet er ikke bestemt («Pixelflow» er foreløpig; sjekk at navnet er ledig).
> Ingen navn eller personopplysninger om testbrukere skal inn i teksten.

## Tittelforslag

1. **Pixelflow: Reflowing Digitised Pages Without OCR – and Handing the Code to Your Agent**
2. Old Algorithms, New Layout Engine: OCR-free Reflow of IIIF Page Images in the Browser
3. Read the Pixels, Not the Text: An Agent-Adaptable Reflow Reader for Digitised Heritage

## Abstract (≈ 644 ord)

Digitised books, newspapers and manuscripts are mostly published as page images, for example
through IIIF. On a phone, reading such a page means pinching and scrolling sideways line by line.
For readers with low vision, it often means not reading at all. WCAG 2.1 Success Criterion
1.4.10 (Reflow) asks that content be usable at 320 CSS pixels without scrolling in two directions.
In practice, however, page images are treated as exempt two-dimensional content. Readers with low
vision are not exempt. The usual remedy is OCR-based text, but OCR fails exactly where heritage
material is most interesting: blackletter, worn type, unusual layouts, handwriting and mathematics.

We present Pixelflow, a browser-based reader that reflows page images *without recognising any
characters*. It combines well-established document-image techniques with the layout engine every
browser already has. Text lines, baselines and word gaps are found from projection profiles over
an adaptively thresholded page (integral-image normalisation and Otsu thresholding). Each word is
cut out as an image tile, levelled against a locally fitted baseline, and optionally vectorised
(marching squares with Chaikin smoothing) so that it stays sharp at 300–400 % magnification. The
tiles are then handed to HTML/CSS flexbox, which wraps them to any screen width and zoom level,
much as Breuel et al. did with word images in "Paper to PDA" two decades ago. Word tiles never
grow wider than the screen, so a page stays free of horizontal scrolling at 320 pixels even at
350 % magnification. Hyphenated words
are detected geometrically, including double blackletter hyphens, and stitched back together
across line breaks. Because nothing is transcribed, nothing can be mistranscribed: the reader
always sees the original glyphs.

The tool runs entirely client-side as static HTML, CSS and JavaScript, with no build step and no
server. It loads IIIF Image and Presentation resources directly, including the public-domain
collections of the National Library of Norway. A single slider moves from the original page
image to cleaned, recoloured text, with presets for low-vision reading (large size, night mode,
adjustable stroke weight). We address two groups with the same underlying need: readers with low
vision, and sighted readers who simply want to avoid horizontal scrolling on mobile devices.

We report simple, reproducible measures on five public-domain books (antiqua, italic and
blackletter). Across 386 line breaks on 17 pages, fitting the baseline in overlapping windows
along each line, rather than per word, reduced the share of visibly misaligned word pairs
(≥ 3 px) at line breaks from 18.4 % to 10.9 %. This matches the noise level of word pairs within
a line. Hyphen stitching produced no false joins on the test set after constraining hyphens to
the middle of the x-height band; earlier versions joined words at the ear of *r* and *g*.

Our second contribution concerns the code rather than the algorithm. The repository is designed
to be **adapted by a researcher's own AI coding agent**. A single, tool-neutral instruction file
(AGENTS.md, imported by tool-specific files) describes the architecture, test pages, release
routine and a hand-over protocol for work interrupted mid-task. Console debugging helpers and
before/after measurements let an agent verify its own changes. The current version was itself
developed this way in five days, and its commit history documents each step. We argue that such
"agent-ready" repositories lower the threshold for local adaptation of DH tools. Examples are a
manuscript collection with a different IIIF provider, right-to-left scripts, or a project's own
page layouts. This happens without forking a large codebase or waiting for its maintainers.

The poster will show the pipeline, before/after comparisons on blackletter and antiqua pages, a
live demo on a phone, and a timed example of an agent adapting the reader to a manuscript
collection. Next steps are column and block detection (XY-cut) for newspapers and two-column
scholarly PDFs, where formulas and figures can be kept as image tiles instead of being garbled
by text extraction.

**Keywords:** document image reflow, IIIF, accessibility, WCAG, low vision, OCR-free, research software,
AI coding agents

## Plan for selve posteren

- **Venstre:** problemet (kniping og sideveis skrolling, svaksynte) og to målgrupper.
- **Midten:** pipeline i fem trinn (terskel → linjer/grunnlinje → ord → vektor → CSS-flyt) med
  før/etter-bilder fra *Sult* og frakturboken.
- **Høyre:** «agent-ready repo» – utdrag av AGENTS.md, tidslinje over fem dager med commits,
  tilpasningseksempel (manuskript).
- **QR-kode** til live-demo (GitHub Pages) og repo.

## Gjør før innsending

- [ ] Bestem navn (og sjekk at det er ledig).
- [ ] Sjekk ordgrense og tilpass lengden.
- [ ] Bekreft referansene under (særlig «Paper to PDA»: Breuel, Janssen, Popat og Baird, ICPR 2002).
- [ ] Kort brukertest med svaksynt leser (uten personopplysninger i teksten) – eller ta påstanden ut.
- [ ] Tidsmålt tilpasningsdemo med agent, eller formuler den som planlagt arbeid.
- [ ] Forfattere og affiliasjon.

## Referanser (å verifisere)

- Breuel, T. M., Janssen, W. C., Popat, K., & Baird, H. S. (2002). Paper to PDA. *ICPR 2002*.
- Nagy, G., & Seth, S. (1984). Hierarchical representation of optically scanned documents. *ICPR 1984*.
- Otsu, N. (1979). A threshold selection method from gray-level histograms. *IEEE Trans. SMC*, 9(1).
- Bradley, D., & Roth, G. (2007). Adaptive thresholding using the integral image. *Journal of Graphics Tools*, 12(2).
- Lorensen, W. E., & Cline, H. E. (1987). Marching cubes. *SIGGRAPH '87*.
- Chaikin, G. M. (1974). An algorithm for high-speed curve generation. *Computer Graphics and Image Processing*, 3(4).
- IIIF Image API 3.0 og Presentation API 3.0, https://iiif.io/api/
- W3C (2018/2023). Web Content Accessibility Guidelines (WCAG) 2.1/2.2, Success Criterion 1.4.10 Reflow.
  https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
