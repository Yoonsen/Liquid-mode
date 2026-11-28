# Tilereflow: Old Algorithms, New Layout Engine — Script-Agnostic, OCR-Free Reflow of IIIF Page Images in the Browser

**Submission type:** Poster (DH2027 Galway)  
**Author:** Lars G. Bagøien Johnsen, National Library of Norway, Research Department  
**Repository / Demo:** \[https\://github.com\]

---

## Abstract

Digitised books, newspapers and manuscripts are mostly published as page images, for example through IIIF. On a phone, reading such a page means pinching and scrolling sideways line by line. For readers with low vision, it often means not reading at all. WCAG 2.1/2.2 Success Criterion 1.4.10 (Reflow) asks that content be usable at 320 CSS pixels without scrolling in two directions. In practice, however, page images are treated as exempt two-dimensional content. Readers with low vision are not exempt. The usual remedy is OCR-based text, but OCR fails or lacks training data exactly where heritage material is most interesting: blackletter, worn type, unusual layouts, historical orthography, handwriting and mathematics.

We present **Tilereflow**, a script-agnostic, browser-based reader that reflows page images *without recognising any characters*. It combines well-established document-image techniques with the layout engine every browser already has. Text lines, baselines and word gaps are found from projection profiles over an adaptively thresholded page (integral-image normalisation and Otsu thresholding). Each word is cut out as an image tile, levelled against a locally fitted baseline, and optionally vectorised (using marching squares, the 2D special case of Lorensen and Cline's algorithm, with Chaikin smoothing) so that it stays sharp at 300–400 % magnification. The tiles are then handed to HTML/CSS flexbox, which wraps them to any screen width and zoom level, much as Breuel et al. did with word images in "Paper to PDA" two decades ago. Word tiles never grow wider than the screen, so a page stays free of horizontal scrolling at 320 pixels even at 350 % magnification. Hyphenated words are detected geometrically, including double blackletter hyphens, and stitched back together across line breaks. Because nothing is transcribed, nothing can be mistranscribed, and no script-specific language models are required: the reader always sees the original glyphs.

The tool runs entirely client-side as static HTML, CSS and JavaScript, with no build step and no server. It loads IIIF Image and Presentation resources directly, including the public-domain collections of the National Library of Norway. A single slider moves from the original page image to cleaned, recoloured text, with presets for low-vision reading (large size, night mode, adjustable stroke weight). We address two groups with the same underlying need: readers with low vision, and sighted readers who simply want to avoid horizontal scrolling on mobile devices.

We report simple, reproducible measures on five public-domain books (antiqua, italic and blackletter). Across 386 line breaks on 17 pages, fitting the baseline in overlapping windows along each line, rather than per word, reduced the share of visibly misaligned word pairs (≥ 3 px) at line breaks from 18.4 % to 10.9 %. This matches the noise level of word pairs within a line. Hyphen stitching produced no false joins on the test set after constraining hyphens to the middle of the x-height band; earlier versions joined words at the ear of *r* and *g*.

Our second contribution concerns the code rather than the algorithm. The repository is designed to be **adapted by a researcher's own AI coding agent**. A single, tool-neutral instruction file (`AGENTS.md`, imported by tool-specific files) describes the architecture, test pages, release routine and a hand-over protocol for work interrupted mid-task. Console debugging helpers and before/after measurements let an agent verify its own changes. The current version was itself developed this way in five days, and its commit history documents each step. We argue that such "agent-ready" repositories lower the threshold for local adaptation of digital humanities tools—such as supporting different IIIF providers, right-to-left scripts, or project-specific page layouts—without forking a large codebase or waiting for its maintainers.

The poster will present the five-stage processing pipeline, before-and-after comparisons on blackletter and antiqua pages, a live mobile demonstration, and a concrete walkthrough of an agent adapting the reader to a new manuscript collection. Next steps are column and block detection (XY-cut) for newspapers and two-column scholarly PDFs, where formulas and figures can be kept as image tiles instead of being garbled by text extraction.

**Keywords:** document image reflow, script-agnostic, IIIF, accessibility, WCAG, low vision, OCR-free, research software, AI coding agents

---

## References

* Bradley, D., & Roth, G. (2007). Adaptive thresholding using the integral image. *Journal of Graphics Tools*, 12(2), 13–21.  
* Breuel, T. M., Janssen, W. C., Popat, K., & Baird, H. S. (2002). Paper to PDA. *Proceedings of the 16th International Conference on Pattern Recognition (ICPR 2002\)*, Vol. 1, 476–479.  
* Chaikin, G. M. (1974). An algorithm for high-speed curve generation. *Computer Graphics and Image Processing*, 3(4), 346–349.  
* IIIF Consortium. (2020). *IIIF Image API 3.0* & *IIIF Presentation API 3.0*. [https\://iiif.io](https://iiif.io)  
* Lorensen, W. E., & Cline, H. E. (1987). Marching cubes: A high resolution 3D surface construction algorithm. *ACM SIGGRAPH Computer Graphics*, 21(4), 163–169.  
* Nagy, G., & Seth, S. (1984). Hierarchical representation of optically scanned documents. *Proceedings of the 7th International Conference on Pattern Recognition (ICPR 1984\)*, 347–349.  
* Otsu, N. (1979). A threshold selection method from gray-level histograms. *IEEE Transactions on Systems, Man, and Cybernetics*, 9(1), 62–66.  
* W3C. (2023). *Web Content Accessibility Guidelines (WCAG) 2.2: Understanding Success Criterion 1.4.10 Reflow*. [https\://w3.org](https://w3.org)

