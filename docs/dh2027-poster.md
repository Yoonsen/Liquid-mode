# Tilereflow: Old Algorithms, New Layout Engine — Script-Agnostic, OCR-Free Reflow of IIIF Page Images in the Browser

> Arbeidsutkast til DH2027 Galway. Frist (ifølge egne notater): 30.11.2026 AoE. Før innsending: sjekk ordgrense,
> krav om anonymisering, malen i innsendingssystemet og grensen for antall bidrag per person.
> Navn: *Tilereflow* (også skrevet *Tile Reflow*); ga ingen Google-treff 28.11.2026. Publiseringsrepoet med ren
> historikk ligger lokalt i `~/Github/Tilereflow` (ikke pushet ennå); lenkene under forutsetter
> `github.com/Yoonsen/Tilereflow` med GitHub Pages.
> Ingen navn eller personopplysninger om testbrukere skal inn i teksten.
> Slått sammen fra dette utkastet og Lars' versjon i
> `docs/Tilereflow_ Old Algorithms, New Layout Engine — …md` (navn, vinkling og referanseformat derfra).

**Submission type:** Poster (DH2027 Galway)
**Author:** Lars G. Bagøien Johnsen, National Library of Norway, Research Department
**Repository / Demo:** https://github.com/Yoonsen/Tilereflow · https://yoonsen.github.io/Tilereflow/

---

## Abstract (≈ 812 ord)

Digitised books, newspapers and manuscripts are mostly published as page images, for example through IIIF. On a
phone, reading such a page means pinching and scrolling sideways line by line. For readers with low vision, it
often means not reading at all. WCAG 2.1/2.2 Success Criterion 1.4.10 (Reflow) asks that content be usable at
320 CSS pixels without scrolling in two directions. In practice, however, page images are treated as exempt
two-dimensional content. Readers with low vision are not exempt. The usual remedy is OCR-based text, but OCR fails
or lacks training data exactly where heritage material is most interesting: blackletter, worn type, unusual
layouts, historical orthography, handwriting and mathematics.

We present **Tilereflow**, a script-agnostic, browser-based reader that reflows page images *without recognising
any characters*. It combines well-established document-image techniques with the layout engine every browser
already has. The page is first split into text blocks with a first level of recursive XY-cut (Nagy & Seth, 1984):
empty gutters and dark strips (spine, scan background) separate columns or the two pages of an opening, and rows
that cross a gutter, such as headlines, become full-width blocks read in order. Within each block, text lines,
baselines and word gaps are found from projection profiles over an adaptively thresholded page (integral-image
normalisation and Otsu thresholding); where handwriting leaves no empty rows between lines, the line pitch is
found by autocorrelation of the row profile. Each word is cut out as an image tile, levelled against a locally
fitted baseline, and optionally vectorised (using marching squares, the 2D special case of Lorensen and Cline's
algorithm, with Chaikin smoothing) so that it stays sharp at 300–400 % magnification. The tiles are then handed
to HTML/CSS flexbox, which wraps them to any screen width and zoom level, much as Breuel et al. did with word
images in "Paper to PDA" two decades ago. Word tiles never grow wider than the screen, so a page stays free of
horizontal scrolling at 320 pixels even at 350 % magnification. Hyphenated words are detected geometrically,
including double blackletter hyphens, and stitched back together across line breaks. Because nothing is
transcribed, nothing can be mistranscribed, and no script-specific language models are required: the reader
always sees the original glyphs.

The tool runs entirely client-side as static HTML, CSS and JavaScript, with no build step and no server. It loads
IIIF Image and Presentation resources (versions 2 and 3) directly: the public-domain collections of the National
Library of Norway and, as an example of another provider, an eighteenth-century manuscript receipt book from
Wellcome Collection. A single slider moves from the original page image to cleaned, recoloured text, with presets
for low-vision reading (large size, night mode, adjustable stroke weight and edge sharpness). We address two
groups with the same underlying need: readers with low vision, and sighted readers who simply want to avoid
horizontal scrolling on mobile devices.

We report simple, reproducible measures on five public-domain books (antiqua, italic and blackletter). Across 386
line breaks on 17 pages, fitting the baseline in overlapping windows along each line, rather than per word,
reduced the share of visibly misaligned word pairs (≥ 3 px) at line breaks from 18.4 % to 10.9 %. This matches
the noise level of word pairs within a line. Hyphen stitching produced no false joins on the test set after
constraining hyphens to the middle of the x-height band; earlier versions joined words at the ear of *r* and *g*.
Block detection left all 23 tested single-column book pages intact while splitting two-column pages and
two-page manuscript openings.

Our second contribution concerns the code rather than the algorithm. The repository is designed to be **adapted
by a researcher's own AI coding agent**. A single, tool-neutral instruction file (`AGENTS.md`, imported by
tool-specific files) describes the architecture, test pages, release routine and a hand-over protocol for work
interrupted mid-task. Console debugging helpers and before/after measurements let an agent verify its own
changes. Everything a local variant usually changes – name, default appearance, and the shelves of books and
manuscripts with their IIIF sources – lives in one plain configuration file. The current version was itself
developed this way in five days, and its commit history documents each step. We argue that such "agent-ready"
repositories lower the threshold for local adaptation of digital humanities tools – such as supporting different
IIIF providers, right-to-left scripts, or project-specific page layouts – without forking a large codebase or
waiting for its maintainers.

The poster will present the processing pipeline, before-and-after comparisons on blackletter, antiqua and
manuscript pages, a live mobile demonstration, and a concrete walkthrough of an agent adapting the reader to a new
manuscript collection. Next steps are deeper layout analysis for newspapers and two-column scholarly PDFs, where
formulas and figures can be kept as image tiles instead of being garbled by text extraction, and line finding
that follows slanted and curved handwritten lines.

**Keywords:** document image reflow, script-agnostic, IIIF, accessibility, WCAG, low vision, OCR-free, layout
analysis, research software, AI coding agents

---

## References

- Bradley, D., & Roth, G. (2007). Adaptive thresholding using the integral image. *Journal of Graphics Tools*,
  12(2), 13–21.
- Breuel, T. M., Janssen, W. C., Popat, K., & Baird, H. S. (2002). Paper to PDA. *Proceedings of the 16th
  International Conference on Pattern Recognition (ICPR 2002)*, Vol. 1, 476–479.
- Chaikin, G. M. (1974). An algorithm for high-speed curve generation. *Computer Graphics and Image Processing*,
  3(4), 346–349.
- IIIF Consortium. (2020). *IIIF Image API 3.0* & *IIIF Presentation API 3.0*. https://iiif.io/api/
- Lorensen, W. E., & Cline, H. E. (1987). Marching cubes: A high resolution 3D surface construction algorithm.
  *ACM SIGGRAPH Computer Graphics*, 21(4), 163–169.
- Nagy, G., & Seth, S. (1984). Hierarchical representation of optically scanned documents. *Proceedings of the
  7th International Conference on Pattern Recognition (ICPR 1984)*, 347–349.
- Otsu, N. (1979). A threshold selection method from gray-level histograms. *IEEE Transactions on Systems, Man,
  and Cybernetics*, 9(1), 62–66.
- W3C. (2023). *Web Content Accessibility Guidelines (WCAG) 2.2: Understanding Success Criterion 1.4.10 Reflow*.
  https://www.w3.org/WAI/WCAG22/Understanding/reflow.html

---

## Plan for selve posteren

- **Venstre:** problemet (kniping og sideveis skrolling, svaksynte, WCAG 1.4.10) og to målgrupper.
- **Midten:** pipeline (blokker/XY-cut → terskel → linjer/grunnlinje → ord → vektor → CSS-flyt) med
  før/etter-bilder fra *Sult*, frakturboken og manuskriptoppslaget.
- **Høyre:** «agent-ready repo» – utdrag av AGENTS.md og config.js, tidslinje over fem dager med commits,
  tilpasningseksempel (manuskript).
- **QR-kode** til live-demo (GitHub Pages) og repo.

## Gjør før innsending

- [ ] Sjekk ordgrense og tilpass lengden (nå ca. 812 ord).
- [ ] Bekreft referansene (sidetall og årganger er fra Lars' versjon; sjekk særlig «Paper to PDA» og Nagy & Seth).
- [ ] Kort brukertest med svaksynt leser (uten personopplysninger i teksten) – eller behold bare målgruppen.
- [ ] Tidsmålt tilpasningsdemo med agent, eller formuler den som planlagt arbeid.
- [ ] Opprett `Yoonsen/Tilereflow` på GitHub, push, slå på GitHub Pages, og sjekk at lenkene over virker.
