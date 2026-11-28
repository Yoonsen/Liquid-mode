/**
 * Pixel-Liquid Mode — Tekstlinje- og ordsegmentering på pikselnivå uten OCR.
 *
 * Algoritme-oversikt:
 * 1. Konverterer kildeutsnittet (eller hele bildet) til gråtoner og beregner
 *    lokal/adaptiv terskel (Otsu + bruker-offset) for å skille blekk fra papir.
 * 2. Horisontal projeksjonsprofil: finner sammenhengende tekstlinjer, filtrerer
 *    vekk mikroskopiske støyprikker, og normaliserer linjehøyde rundt linjens
 *    tetteste blekk-sentrum (x-høyde / baseline) slik at over- og underlengder
 *    (h, k, g, j, p) står på rett linje når ordene brytes på ny.
 * 3. Vertikal projeksjonsprofil per linje: finner alle horisontale gap. Små gap
 *    er bokstavmellomrom (kerning), mens gap over en adaptiv terskel (skalert
 *    med linjehøyde + brukerens følsomhets-slider) tolkes som ordskille (space).
 * 4. Hvert ord tegnes som et eget lite <canvas>-token i en flex-wrap container
 *    som skalerer fritt med brukerens zoom-slider og tilpasser seg mobil/viewport.
 */

(() => {
  // DOM-referanser
  const sourceCanvas = document.getElementById("source-canvas");
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const overlayCanvas = document.getElementById("overlay-canvas");
  const overlayCtx = overlayCanvas.getContext("2d");
  const canvasWrapper = document.getElementById("canvas-wrapper");

  const liquidReader = document.getElementById("liquid-reader");
  const statsBar = document.getElementById("stats-bar");

  const presetSelect = document.getElementById("preset-select");
  const fileInput = document.getElementById("file-input");
  const toggleIiifBtn = document.getElementById("toggle-iiif-btn");
  const iiifDrawer = document.getElementById("iiif-drawer");
  const iiifForm = document.getElementById("iiif-form");
  const iiifUrlInput = document.getElementById("iiif-url-input");

  const iiifBookBar = document.getElementById("iiif-book-bar");
  const bookTitleLabel = document.getElementById("book-title-label");
  const bookAccessLabel = document.getElementById("book-access-label");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageSelect = document.getElementById("page-select");

  const showBoxesToggle = document.getElementById("show-boxes-toggle");
  const resetCropBtn = document.getElementById("reset-crop-btn");
  const autoCropBtn = document.getElementById("auto-crop-btn");
  const deskewSlider = document.getElementById("deskew-slider");
  const deskewOutput = document.getElementById("deskew-output");
  const autoDeskewBtn = document.getElementById("auto-deskew-btn");
  const adaptiveShadowToggle = document.getElementById("adaptive-shadow-toggle");
  const mergeHyphensToggle = document.getElementById("merge-hyphens-toggle");
  const dejaggBaselineToggle = document.getElementById("dejagg-baseline-toggle");

  const zenToggleBtn = document.getElementById("zen-toggle-btn");
  const zenFloatingBar = document.getElementById("zen-floating-bar");
  const zenPageIndicator = document.getElementById("zen-page-indicator");
  const zenRestoreBtn = document.getElementById("zen-restore-btn");
  const zenPrevBtn = document.getElementById("zen-prev-btn");
  const zenNextBtn = document.getElementById("zen-next-btn");
  const zenSplitBtn = document.getElementById("zen-split-btn");
  const cacheStatusPill = document.getElementById("cache-status-pill");
  const bookProgressLabel = document.getElementById("book-progress-label");

  const scaleSlider = document.getElementById("scale-slider");
  const scaleOutput = document.getElementById("scale-output");
  const spaceSlider = document.getElementById("space-slider");
  const spaceOutput = document.getElementById("space-output");
  const contrastSlider = document.getElementById("contrast-slider");
  const contrastOutput = document.getElementById("contrast-output");
  const lineGapSlider = document.getElementById("line-gap-slider");
  const lineGapOutput = document.getElementById("line-gap-output");

  const renderModeButtons = document.querySelectorAll("[data-render-mode]");
  const flowModeButtons = document.querySelectorAll("[data-flow-mode]");
  const traceModeButtons = document.querySelectorAll("[data-trace-mode]");
  const activeAlgoPill = document.getElementById("active-algo-pill");
  const tracePerfPill = document.getElementById("trace-perf-pill");
  const smoothIterSlider = document.getElementById("smooth-iter-slider");
  const smoothIterOutput = document.getElementById("smooth-iter-output");
  const preblurSlider = document.getElementById("preblur-slider");
  const preblurOutput = document.getElementById("preblur-output");
  const strokeWeightSlider = document.getElementById("stroke-weight-slider");
  const strokeWeightOutput = document.getElementById("stroke-weight-output");
  const toggleLoupe = document.getElementById("toggle-loupe");
  const wordLoupePanel = document.getElementById("word-loupe-panel");
  const loupeRawCanvas = document.getElementById("loupe-raw-canvas");
  const loupeTracedCanvas = document.getElementById("loupe-traced-canvas");
  const loupeWireCanvas = document.getElementById("loupe-wire-canvas");
  const loupeTracedTitle = document.getElementById("loupe-traced-title");

  const mobileTabButtons = document.querySelectorAll("[data-view-target]");
  const workspaceGrid = document.getElementById("workspace-grid");

  // Offscreen original-canvas (urotert) slik at Deskew/rotasjon aldri taper skarphet
  const rawMasterCanvas = document.createElement("canvas");
  const rawMasterCtx = rawMasterCanvas.getContext("2d", { willReadFrequently: true });

  // Applikasjonstilstand (optimaliserte standardverdier: Renset blekk på papirtone, høy glatting, lav pre-blur, god blekkfylde)
  const state = {
    sourceImageData: null, // Full ImageData fra sourceCanvas (etter ev. deskew)
    gray: null,            // Uint8Array gråtoner for hele bildet
    otsuThreshold: 140,    // Automatisk beregnet terskel
    sampledPaperHex: "#f6efe0", // Automatisk målt papirfarge fra originalen
    deskewAngle: 0,        // Rotasjonsvinkel i grader (-7 .. +7)
    cropRect: null,        // { x, y, w, h } i bildepiksler, eller null for hele bildet
    savedCropRatio: null,  // Husker brukerens relative utsnitt { rx, ry, rw, rh } mellom bok-sider
    detectedLines: [],     // [{ yTop, yBottom, yCore, isParagraphStart, words: [...] }]
    detectedWords: [],     // Flatt liste med alle ord-objekter
    hoveredWordId: null,
    selectedWord: null,
    renderMode: "clean",   // 'clean' (standard!) | 'paper' | 'dark'
    flowMode: "auto",      // 'auto' (Original bredde når plass -> Liquid ved zoom) | 'liquid' | 'lines'
    baseNaturalLineWordSum: 640, // 85-persentil summert ordbredde (uskalert) for en full boklinje
    baseNaturalLineWordCount: 9, // Gjennomsnittlig antall ord i en full boklinje
    paperMedianLum: 220,   // Målt papirluminans (forhindrer at papir-korn tolkes som blekk på tittelsider)
    useAdaptiveShadow: true, // 2D Integral Image lokal skyggefjerning (fjerner bokrygg-skygge / ujevnt lys)
    mergeHyphens: true,    // Limer sammen orddeling ved linjeslutt (bok- + bad -> bokbad) i Liquid-flyt
    useDejaggBaseline: true, // Lokal grunnlinjekurve y(x) + vertikal shear dy/dx per ord (De-jagg)
    detectedParagraphCount: 0,
    detectedHyphenJoinCount: 0,
    traceMode: "vector",   // 'raw' | 'superres' | 'vector' | 'wireframe'
    smoothIterations: 3,   // 3 Chaikin-iterasjoner (høy kurve-glatting)
    preblurRadius: 0.0,    // 0.0 px sub-piksel utjevning (lav pre-blur bevarer skarpe detaljer)
    strokeOffset: 9,       // +9 blekkfylde-offset (fyldigere, mer lesbar strek)
    scaleFactor: 0.65,     // 65% kompakt startskala (matcher normal brødtekststørrelse, så Liquid-flyten står i sentrum)
    spaceSensitivity: 1.0,
    contrastOffset: 0,
    lineGapMultiplier: 1.35,
    iiifBook: null, // { title, pages: [{ label, serviceId }], currentIndex }
  };

  const APP_VERSION = "1.9.0";
  const APP_RELEASE_SUMMARY =
    "Jevnere overgang mellom linjene i Liquid-flyt: ordene plasseres nå etter linjens målte grunnlinje (målt i vinduer langs linjen) i stedet for etter hvert ords blekktyngdepunkt. Ordpar som bommer med 3 px eller mer ved linjeskift er nesten halvert.";

  // Hurtigminne (RAM-cache) for ferdig nedlastede IIIF-boksider (URL -> HTMLImageElement)
  const pageImageCache = new Map();
  const inflightImageLoads = new Map();
  const MAX_CACHED_PAGES = 14;

  // =========================================================================
  // 1. SYNTETISKE EKSEMPELSIDER & ÅPNE IIIF-KILDER (Nasjonalbiblioteket)
  // =========================================================================

  const HAMSUN_SULT_URN = "URN:NBN:no-nb_digibok_2015051929001";
  const HAMSUN_SULT_DEFAULT_PAGE_INDEX = 12; // _0011 (Første kapittel: "Det var i den Tid, jeg gik omkring og sulted i Kristiania...")

  /**
   * Genererer et realistisk skannet dokument med gulnet papir, støy,
   * kornete trykksværte og autentisk typografi direkte på sourceCanvas.
   */
  function generateSyntheticScan(kind) {
    const width = 940;
    const height = kind === "synthetic-twocol" ? 780 : 720;
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    overlayCanvas.width = width;
    overlayCanvas.height = height;

    // 1. Tegn papirbakgrunn med varm gulnet tone og vignettering
    const bgGrad = sourceCtx.createRadialGradient(
      width * 0.5,
      height * 0.45,
      60,
      width * 0.5,
      height * 0.5,
      width * 0.75
    );

    if (kind === "synthetic-mobile") {
      bgGrad.addColorStop(0, "#f9fafb");
      bgGrad.addColorStop(1, "#e5e7eb");
    } else {
      bgGrad.addColorStop(0, "#f5eedc");
      bgGrad.addColorStop(0.75, "#eadec3");
      bgGrad.addColorStop(1, "#d9c8a5");
    }
    sourceCtx.fillStyle = bgGrad;
    sourceCtx.fillRect(0, 0, width, height);

    // 2. Legg på lett papirstruktur / skannestøy før tekst
    addPaperGrain(sourceCtx, width, height, kind === "synthetic-mobile" ? 6 : 16);

    // 3. Tegn tekstinnhold basert på valgt preset
    sourceCtx.fillStyle = kind === "synthetic-mobile" ? "#1e293b" : "#231e18";
    sourceCtx.textBaseline = "alphabetic";

    if (kind === "synthetic-gothic") {
      sourceCtx.font = "bold 36px Georgia, 'Times New Roman', serif";
      sourceCtx.fillText("Christiania Intelligentssedler.", 75, 82);

      sourceCtx.font = "italic 21px Georgia, 'Times New Roman', serif";
      sourceCtx.fillText("No. 214. — Mandagen den 14de November 1890.", 75, 122);

      // Dekorativ skillelinje som ikke skal ødelegge ordflyten
      const paragraphs = [
        [
          "Det er en gammel Erfaring, at trykte Bøger og Aviser",
          "ofte er vanskelige at læse paa smaa Skjærme, naar Siden",
          "kun forstørres som et stivt Billede. Man tvinges da til",
          "at skyve Siden frem og tilbage for hver eneste Linje.",
        ],
        [
          "Ved at gjenkjende Linjer og Mellemrom direkte i",
          "Billedets Piksler — helt uden Brug af feilbarlig OCR —",
          "kan hvert enkelt Ord klippes ud og flyde frit som",
          "moderne Tekst. Saaledes bevares den originale Typografi,",
          "mens Læseren selv bestemmer Tekstens Størrelse.",
        ],
        [
          "Prøv at trække i Skyderen for Tekststørrelse til høire,",
          "eller marker et Udsnitt med Musen her i Originalbilledet!",
        ],
      ];

      sourceCtx.font = "25px Georgia, 'Times New Roman', serif";
      let y = 182;
      paragraphs.forEach((lines) => {
        lines.forEach((line) => {
          drawSlightlyAgedLine(sourceCtx, line, 75, y);
          y += 42;
        });
        y += 22; // Ekstra avsnittsavstand
      });
    } else if (kind === "synthetic-mobile") {
      sourceCtx.font = "bold 24px system-ui, -apple-system, sans-serif";
      sourceCtx.fillText("Vedtak om universell utforming — Sak 42/2026", 55, 70);

      const paragraphs = [
        [
          "Mange mottar skjermbilder av brev, tabeller eller skannede",
          "dokumenter på mobilen der skriften er altfor liten til å leses",
          "uten konstant horisontal panorering og klype-zooming.",
        ],
        [
          "Med Pixel-Liquid Mode deles skjermbildet opp i ord-brikker",
          "som automatisk tilpasser seg mobilskjermens bredde.",
          "Du trenger ikke vente på språkmodeller eller risikere at",
          "tall, navn og spesialtegn blir feiltolket av OCR.",
        ],
        [
          "Tips: Du kan lime inn et hvilket som helst skjermbilde",
          "med Ctrl+V / Cmd+V eller laste opp fra kamerarullen.",
        ],
      ];

      sourceCtx.font = "21px system-ui, -apple-system, sans-serif";
      let y = 128;
      paragraphs.forEach((lines) => {
        lines.forEach((line) => {
          sourceCtx.fillText(line, 55, y);
          y += 36;
        });
        y += 20;
      });
    } else if (kind === "synthetic-twocol") {
      sourceCtx.font = "bold 32px Georgia, serif";
      sourceCtx.fillText("Norsk Folkeblad — To-spalters Sats", 70, 74);

      sourceCtx.font = "19px Georgia, serif";
      sourceCtx.fillText(
        "Tips: Dra en markeringsboks rundt Spalte 1 eller Spalte 2 for å lese én spalte om gangen!",
        70,
        110
      );

      const col1 = [
        "Spalte 1: Naar en Avis eller",
        "Bog er sat op i to eller flere",
        "Spalter ved Siden af hinanden,",
        "vil en vanlig horisontal",
        "Linjeskanning kunne blande",
        "Ordene fra venstre og høire",
        "Spalte sammen paa samme Linje.",
        "",
        "Derfor har vi bygget ind et",
        "hurtigt Udsnits-værktøi:",
        "Træk blot Musen eller Fingeren",
        "over denne venstre Spalte,",
        "saa flyder kun disse Ord",
        "over i Liquid-læseren!",
      ];

      const col2 = [
        "Spalte 2: Her i den høire",
        "Spalte fortsætter Teksten",
        "uafhængigt af venstre Side.",
        "Naar du er færdig med første",
        "Spalte, kan du trække en ny",
        "Boks herover, eller klikke",
        "paa Knappen 'Hele siden'.",
        "",
        "Dette fungerer ogsaa",
        "udmerket paa Fotografier",
        "af Bogsider hvor Marger",
        "eller Billedtekster ellers",
        "ville forstyrre Læseflyten.",
      ];

      sourceCtx.font = "22px Georgia, 'Times New Roman', serif";
      let y1 = 175;
      col1.forEach((line) => {
        if (line === "") {
          y1 += 22;
        } else {
          drawSlightlyAgedLine(sourceCtx, line, 70, y1);
          y1 += 36;
        }
      });

      let y2 = 175;
      col2.forEach((line) => {
        if (line === "") {
          y2 += 22;
        } else {
          drawSlightlyAgedLine(sourceCtx, line, 505, y2);
          y2 += 36;
        }
      });
    }

    // 4. Litt avsluttende trykksværte-ujevnhet
    addInkTexture(sourceCtx, width, height);

    // Lagre urotert master-kopi for deskew
    rawMasterCanvas.width = width;
    rawMasterCanvas.height = height;
    rawMasterCtx.drawImage(sourceCanvas, 0, 0);
    state.deskewAngle = 0;
    if (deskewSlider) {
      deskewSlider.value = "0";
      deskewOutput.textContent = "0.0°";
    }

    state.iiifBook = null;
    iiifBookBar.setAttribute("hidden", "");

    state.cropRect =
      kind === "synthetic-twocol"
        ? { x: 55, y: 140, w: 410, h: 560 } // Forhåndsmarker spalte 1 på to-spalters demo!
        : null;
    resetCropBtn.disabled = !state.cropRect;

    ingestCanvasSource();
  }

  function drawSlightlyAgedLine(ctx, text, x, y) {
    // Tegn ord for ord med ørsmå naturlige variasjoner i trykksværte
    const words = text.split(" ");
    let cursorX = x;
    const spaceWidth = ctx.measureText(" ").width * 1.15;
    words.forEach((w, idx) => {
      const jitterY = ((idx * 17) % 3) - 1; // -1, 0 eller +1 px
      ctx.fillText(w, cursorX, y + jitterY * 0.4);
      cursorX += ctx.measureText(w).width + spaceWidth;
    });
  }

  function addPaperGrain(ctx, w, h, amplitude) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    let seed = 1337;
    for (let i = 0; i < d.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = ((seed & 0xff) / 255 - 0.5) * amplitude;
      d[i] = Math.min(255, Math.max(0, d[i] + noise));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + noise));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function addInkTexture(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    let seed = 4242;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 110) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const delta = ((seed & 0x1f) - 12);
        d[i] = Math.min(255, Math.max(0, d[i] + delta));
        d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + delta));
        d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + delta));
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // =========================================================================
  // 2. INNLASTING FRA FIL, UTKLIPPSTAVLE OG IIIF (NASJONALBIBLIOTEKET)
  // =========================================================================

  function storeInImageCache(url, img) {
    if (!url || url.startsWith("blob:")) return;
    if (pageImageCache.has(url)) {
      pageImageCache.delete(url);
    }
    pageImageCache.set(url, img);
    if (pageImageCache.size > MAX_CACHED_PAGES) {
      const oldestKey = pageImageCache.keys().next().value;
      pageImageCache.delete(oldestKey);
    }
  }

  function fetchOrGetCachedImage(url) {
    if (pageImageCache.has(url)) {
      const cached = pageImageCache.get(url);
      if (cached.complete && cached.naturalWidth > 0) {
        return Promise.resolve({ img: cached, fromCache: true });
      }
    }
    if (inflightImageLoads.has(url)) {
      return inflightImageLoads.get(url);
    }

    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        inflightImageLoads.delete(url);
        storeInImageCache(url, img);
        resolve({ img, fromCache: false });
      };
      img.onerror = (err) => {
        inflightImageLoads.delete(url);
        reject(err);
      };
      img.src = url;
    });

    inflightImageLoads.set(url, promise);
    return promise;
  }

  function applyLoadedImageToCanvases(img) {
    // Skaler ned svært store bilder til en hensiktsmessig arbeidsoppløsning (maks 1500px bredde)
    const maxDim = 1500;
    let targetW = img.naturalWidth || img.width;
    let targetH = img.naturalHeight || img.height;
    if (targetW > maxDim) {
      const ratio = maxDim / targetW;
      targetW = Math.round(targetW * ratio);
      targetH = Math.round(targetH * ratio);
    }

    sourceCanvas.width = targetW;
    sourceCanvas.height = targetH;
    overlayCanvas.width = targetW;
    overlayCanvas.height = targetH;

    sourceCtx.fillStyle = "#ffffff";
    sourceCtx.fillRect(0, 0, targetW, targetH);
    sourceCtx.drawImage(img, 0, 0, targetW, targetH);

    // Lagre urotert master-kopi for tapsfri deskew
    rawMasterCanvas.width = targetW;
    rawMasterCanvas.height = targetH;
    rawMasterCtx.drawImage(sourceCanvas, 0, 0);
    state.deskewAngle = 0;
    if (deskewSlider) {
      deskewSlider.value = "0";
      deskewOutput.textContent = "0.0°";
    }

    // Hvis brukeren selv har trukket opp et manuelt utsnitt i boken (state.savedCropRatio),
    // behold det mellom sidene. Ellers la state.cropRect være null slik at hele siden
    // (med automatisk 3–4 px skannerstripe-filter) brukes og ord nær kanten som "Virgil." aldri kuttes!
    if (state.iiifBook && state.savedCropRatio) {
      state.cropRect = {
        x: Math.round(targetW * state.savedCropRatio.rx),
        y: Math.round(targetH * state.savedCropRatio.ry),
        w: Math.round(targetW * state.savedCropRatio.rw),
        h: Math.round(targetH * state.savedCropRatio.rh),
      };
      resetCropBtn.disabled = false;
    } else {
      state.cropRect = null;
      resetCropBtn.disabled = true;
    }
    ingestCanvasSource();
    liquidReader.scrollTop = 0;
  }

  function loadExternalImageUrl(url, fallbackNotice, onReadyCallback = null) {
    const isCached = pageImageCache.has(url);
    if (!isCached) {
      statsBar.innerHTML = `<span class="stat-chip">Henter bilde fra åpen kilde...</span>`;
    }

    fetchOrGetCachedImage(url)
      .then(({ img }) => {
        applyLoadedImageToCanvases(img);
        if (typeof onReadyCallback === "function") {
          onReadyCallback();
        }
      })
      .catch(() => {
        statsBar.innerHTML = `
          <span class="stat-chip" style="color: var(--accent-warm)">
            Kunne ikke hente IIIF-bildet direkte (nettverk eller CORS). Viser innebygd skanning i stedet.
          </span>
        `;
        if (fallbackNotice) {
          generateSyntheticScan("synthetic-gothic");
        }
      });
  }

  /**
   * Håndterer NB.no-lenker (urn.nb.no/..., nb.no/items/...), bare URN-er,
   * IIIF Presentation-manifester og direkte IIIF Image-URLer.
   * Tilgangskontrollen avgjøres 100 % av Nasjonalbibliotekets egne servere
   * (accessInfo.viewability / HTTP-status fra IIIF-endepunktet).
   */
  async function handleIiifInput(rawInput, initialPageIndex = null) {
    const trimmed = rawInput.trim();
    if (!trimmed) return;

    // Dersom URL-en har ?page=11 (1-basert sidetall fra NB.no-viseren), bruk page - 1 som startside
    if (initialPageIndex === null) {
      const pageParamMatch = trimmed.match(/[?&]page=([0-9]+)/i);
      if (pageParamMatch) {
        initialPageIndex = Math.max(0, Number(pageParamMatch[1]) - 1);
      }
    }

    // 1. Sjekk om input inneholder en URN (f.eks. https://urn.nb.no/URN:NBN:no-nb_digibok_2015051929001)
    const urnMatch = trimmed.match(/(URN:NBN:no-nb_[A-Za-z0-9_-]+)/i);
    if (urnMatch && !trimmed.includes("/services/image/resolver/")) {
      const extractedUrn = urnMatch[1];
      // Hvis brukeren limte inn en URN med spesifikt sidetall på slutten (f.eks. _0007),
      // bruk hoved-URN for bokoppslag hvis den slutter på et 4-sifret sidetall etter digibok-ID
      const baseUrnMatch = extractedUrn.match(
        /^(URN:NBN:no-nb_digibok_[0-9]+)(?:_([0-9]{4}|C[0-9]|I[0-9]))?$/i
      );
      if (baseUrnMatch) {
        await loadNbBookByQuery(
          baseUrnMatch[1],
          initialPageIndex,
          baseUrnMatch[2] || null
        );
        return;
      }
      await loadNbBookByQuery(extractedUrn, initialPageIndex, null);
      return;
    }

    // 2. Sjekk om input er en https://www.nb.no/items/<id>-lenke
    const itemMatch = trimmed.match(/nb\.no\/items\/([a-f0-9]{32}|URN:NBN:[^/?#]+)/i);
    if (itemMatch) {
      await loadNbBookByQuery(itemMatch[1], initialPageIndex, null);
      return;
    }

    // 3. Dersom URLen peker direkte på et IIIF-manifest
    if (trimmed.includes("/manifest") || trimmed.endsWith(".json")) {
      await loadIiifManifestUrl(trimmed, initialPageIndex);
      return;
    }

    // 4. Ellers: direkte bilde-URL / IIIF Image API-utsnitt
    state.iiifBook = null;
    iiifBookBar.setAttribute("hidden", "");
    loadExternalImageUrl(trimmed, false);
  }

  /**
   * Slår opp et verk i Nasjonalbibliotekets åpne katalog-API.
   * Her avgjør NB-serveren om verket er fritt tilgjengelig (accessAllowedFrom / viewability)
   * eller begrenset (f.eks. pliktavlevert / kun på NB / Feide).
   */
  async function loadNbBookByQuery(queryId, preferredPageIndex = null, pageSuffix = null) {
    try {
      statsBar.innerHTML = `<span class="stat-chip">Spør Nasjonalbibliotekets API om tilgang og IIIF-manifest...</span>`;
      let item = null;

      // Ved 32-tegns NB-katalog-ID: slå opp direkte på /catalog/v1/items/<id> først
      if (/^[a-f0-9]{32}$/i.test(queryId)) {
        const directResp = await fetch(
          `https://api.nb.no/catalog/v1/items/${encodeURIComponent(queryId)}`
        );
        if (directResp.ok) {
          item = await directResp.json();
        }
      }

      if (!item) {
        const catalogUrl = `https://api.nb.no/catalog/v1/items?q=${encodeURIComponent(queryId)}&size=5`;
        const resp = await fetch(catalogUrl);
        if (!resp.ok) {
          throw new Error(`NB katalog-API svarte med HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const items = data?._embedded?.items || [];

        // Finn eksakt treff på URN eller ID, eller bruk første treff
        item =
          items.find(
            (it) =>
              it?.metadata?.identifiers?.urn?.toLowerCase() === queryId.toLowerCase() ||
              it?.id?.toLowerCase() === queryId.toLowerCase()
          ) || items[0];
      }

      if (!item) {
        statsBar.innerHTML = `
          <span class="stat-chip" style="color: var(--accent-warm)">
            Fant ikke verket (${queryId}) i Nasjonalbibliotekets katalog.
          </span>
        `;
        return;
      }

      const access = item.accessInfo || {};
      const title = item.metadata?.title || "Ukjent tittel";
      const creators = (item.metadata?.creators || []).join(", ");
      const issued = item.metadata?.originInfo?.issued || "";
      const manifestUrl = item._links?.presentation?.href;

      // Dersom NB-serveren sier at boken ikke kan vises fritt utenfor NB:
      if (access.viewability === "NONE" || access.accessAllowedFrom === "NB") {
        const reason =
          access.legalDepositLoginText ||
          `Tilgang styrt av NB.no: ${access.accessAllowedFrom || "Begrenset"} (${access.license || "opphavsrettsbeskyttet"})`;
        statsBar.innerHTML = `
          <span class="stat-chip" style="color: var(--accent-warm)">
            🔒 Avvist av Nasjonalbibliotekets server for «${title}»: ${reason}
          </span>
        `;
      }

      if (manifestUrl) {
        const displayMeta = {
          title: [title, creators, issued ? `(${issued})` : ""].filter(Boolean).join(" — "),
          accessText: access.isPublicDomain
            ? "Fritt tilgjengelig / Public Domain (NB.no)"
            : `Tilgang: ${access.accessAllowedFrom || "NB.no"} (${access.license || ""})`,
        };
        await loadIiifManifestUrl(
          manifestUrl,
          preferredPageIndex,
          pageSuffix,
          displayMeta
        );
        return;
      }
    } catch (err) {
      statsBar.innerHTML = `
        <span class="stat-chip" style="color: var(--accent-warm)">
          Feil ved oppslag mot NB.no: ${err.message}
        </span>
      `;
    }
  }

  /**
   * Laster et IIIF Presentation-manifest, bygger sidevelgeren og henter valgt side.
   */
  async function loadIiifManifestUrl(
    manifestUrl,
    preferredPageIndex = null,
    pageSuffix = null,
    metaOverride = null
  ) {
    try {
      statsBar.innerHTML = `<span class="stat-chip">Henter IIIF-sidemanifest fra Nasjonalbiblioteket...</span>`;
      const resp = await fetch(manifestUrl);
      if (!resp.ok) {
        statsBar.innerHTML = `
          <span class="stat-chip" style="color: var(--accent-warm)">
            🔒 NB.no IIIF-server avslo tilgang til manifestet (HTTP ${resp.status}).
          </span>
        `;
        return;
      }

      const manifest = await resp.json();
      const canvases = manifest?.sequences?.[0]?.canvases || [];
      if (canvases.length === 0) {
        statsBar.innerHTML = `
          <span class="stat-chip" style="color: var(--accent-warm)">
            IIIF-manifestet inneholder ingen åpne bilde-canvases (tilgang begrenset av NB.no).
          </span>
        `;
        return;
      }

      const pages = canvases
        .map((c, idx) => {
          const serviceId =
            c?.images?.[0]?.resource?.service?.["@id"] ||
            c?.images?.[0]?.resource?.["@id"];
          const rawLabel = c?.label && c.label !== "-" ? `Side ${c.label}` : null;
          const tailId = serviceId ? serviceId.split("_").pop() : String(idx + 1);
          return {
            index: idx,
            label: rawLabel ? `${rawLabel} (${tailId})` : `Oppslag ${idx + 1} (${tailId})`,
            tailId,
            serviceId,
          };
        })
        .filter((p) => Boolean(p.serviceId));

      // Velg startside: enten oppgitt pageSuffix, preferredPageIndex eller første tekstside
      let startIdx = 0;
      if (pageSuffix) {
        const found = pages.findIndex(
          (p) => p.tailId.toLowerCase() === pageSuffix.toLowerCase()
        );
        if (found >= 0) startIdx = found;
      } else if (
        typeof preferredPageIndex === "number" &&
        preferredPageIndex >= 0 &&
        preferredPageIndex < pages.length
      ) {
        startIdx = preferredPageIndex;
      } else if (pages.length > 8) {
        startIdx = 6; // Hopp over perm og forsatsblad som standard på bøker
      }

      state.savedCropRatio = null;
      state.cropRect = null;
      state.iiifBook = {
        title: metaOverride?.title || manifest.label || "IIIF Digitalbok",
        accessText:
          metaOverride?.accessText ||
          (manifest.license?.includes("public")
            ? "Public Domain (NB.no)"
            : "Levert via NB.no IIIF"),
        pages,
        currentIndex: startIdx,
      };

      renderIiifBookNavigator();
      loadCurrentIiifBookPage();
    } catch (err) {
      statsBar.innerHTML = `
        <span class="stat-chip" style="color: var(--accent-warm)">
          Kunne ikke lese IIIF-manifest (${err.message}). Tilgangen styres av NB-serveren.
        </span>
      `;
    }
  }

  function renderIiifBookNavigator() {
    const readerViewEl = document.getElementById("reader-view");
    const resumeTitleEl = document.getElementById("resume-book-title");
    if (!state.iiifBook) {
      iiifBookBar.setAttribute("hidden", "");
      if (readerViewEl) readerViewEl.classList.add("no-book-pager");
      return;
    }

    if (readerViewEl) readerViewEl.classList.remove("no-book-pager");
    if (resumeTitleEl) resumeTitleEl.textContent = state.iiifBook.title;
    iiifBookBar.removeAttribute("hidden");
    bookTitleLabel.textContent = state.iiifBook.title;
    bookAccessLabel.textContent = `${state.iiifBook.accessText} • ${state.iiifBook.pages.length} sider`;

    pageSelect.innerHTML = "";
    state.iiifBook.pages.forEach((p, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = p.label;
      if (idx === state.iiifBook.currentIndex) opt.selected = true;
      pageSelect.appendChild(opt);
    });

    prevPageBtn.disabled = state.iiifBook.currentIndex <= 0;
    nextPageBtn.disabled =
      state.iiifBook.currentIndex >= state.iiifBook.pages.length - 1;
  }

  function getIiifPageImageUrl(page) {
    if (!page || !page.serviceId) return "";
    const baseService = page.serviceId.replace(/\/$/, "");
    return baseService.endsWith(".jpg")
      ? baseService
      : `${baseService}/full/1200,/0/native.jpg`;
  }

  function prefetchAdjacentPages() {
    if (!state.iiifBook) {
      if (cacheStatusPill) cacheStatusPill.hidden = true;
      return;
    }

    const pages = state.iiifBook.pages;
    const curr = state.iiifBook.currentIndex;
    const nextPage = pages[curr + 1];
    const nextPage2 = pages[curr + 2];
    const prevPage = pages[curr - 1];

    if (!nextPage) {
      if (cacheStatusPill) {
        cacheStatusPill.hidden = false;
        cacheStatusPill.textContent = "Siste side";
        cacheStatusPill.classList.add("is-ready");
      }
      return;
    }

    const nextUrl = getIiifPageImageUrl(nextPage);
    if (pageImageCache.has(nextUrl)) {
      if (cacheStatusPill) {
        cacheStatusPill.hidden = false;
        cacheStatusPill.textContent = "⚡ Neste side klar i minnet";
        cacheStatusPill.classList.add("is-ready");
      }
    } else if (cacheStatusPill) {
      cacheStatusPill.hidden = false;
      cacheStatusPill.textContent = "⏳ Cacher neste side...";
      cacheStatusPill.classList.remove("is-ready");
    }

    // 1. Forhåndslast neste side (høyest prioritet)
    fetchOrGetCachedImage(nextUrl)
      .then(() => {
        if (state.iiifBook && state.iiifBook.currentIndex === curr && cacheStatusPill) {
          cacheStatusPill.textContent = "⚡ Neste side klar i minnet";
          cacheStatusPill.classList.add("is-ready");
        }
        // 2. Når neste side er i boks, forhåndslast også 2 sider frem og forrige side
        if (nextPage2) {
          fetchOrGetCachedImage(getIiifPageImageUrl(nextPage2)).catch(() => {});
        }
        if (prevPage) {
          fetchOrGetCachedImage(getIiifPageImageUrl(prevPage)).catch(() => {});
        }
      })
      .catch(() => {});
  }

  function loadCurrentIiifBookPage() {
    if (!state.iiifBook) return;
    const page = state.iiifBook.pages[state.iiifBook.currentIndex];
    if (!page) return;

    const atStart = state.iiifBook.currentIndex <= 0;
    const atEnd = state.iiifBook.currentIndex >= state.iiifBook.pages.length - 1;
    prevPageBtn.disabled = atStart;
    nextPageBtn.disabled = atEnd;
    if (zenPrevBtn) zenPrevBtn.disabled = atStart;
    if (zenNextBtn) zenNextBtn.disabled = atEnd;
    pageSelect.value = String(state.iiifBook.currentIndex);

    updateZenPageLabel();

    const imageUrl = getIiifPageImageUrl(page);
    iiifUrlInput.value = imageUrl;
    loadExternalImageUrl(imageUrl, false, () => {
      prefetchAdjacentPages();
    });
  }

  // =========================================================================
  // 3. BILDEANALYSE: GRÅTONER, OTSU-TERSKEL, LINJE- OG ORDSEGMENTERING
  // =========================================================================

  /**
   * 2D Integral Image (Summed-Area Table) som normaliserer lokal belysning
   * på < 3 ms slik at mørke bokrygg-skygger (gutter shadow på pocketbøker)
   * og ujevn mobilbelysning løftes til jevn papirtone uten å miste bokstavkontrast!
   */
  function normalizeGrayWithIntegralImage(rawGray, w, h, targetPaperLum) {
    const sw = w + 1;
    const sat = new Uint32Array(sw * (h + 1));

    // Bygg 2D Summed-Area Table i én enkelt passering
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      const srcRow = y * w;
      const prevSatRow = y * sw;
      const currSatRow = (y + 1) * sw;
      for (let x = 0; x < w; x++) {
        rowSum += rawGray[srcRow + x];
        sat[currSatRow + x + 1] = sat[prevSatRow + x + 1] + rowSum;
      }
    }

    // Vindusradius (~2.5% av bildets korteste side, typisk 24-32 px -> 49x49..65x65 vindu)
    const R = Math.max(20, Math.round(Math.min(w, h) * 0.026));
    const normGray = new Uint8Array(w * h);
    const normHist = new Uint32Array(256);

    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - R);
      const y1 = Math.min(h - 1, y + R);
      const r0 = y0 * sw;
      const r1 = (y1 + 1) * sw;
      const spanH = y1 - y0 + 1;
      const rowOff = y * w;

      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - R);
        const x1 = Math.min(w - 1, x + R);
        const area = (x1 - x0 + 1) * spanH;

        const sum =
          sat[r1 + x1 + 1] -
          sat[r0 + x1 + 1] -
          sat[r1 + x0] +
          sat[r0 + x0];
        const localMean = sum / area;

        // Kompenser ~6% for at mørke bokstaver inne i vinduet trekker snittet litt ned
        const localPaper = Math.max(48, Math.min(255, localMean * 1.06));
        const val = Math.min(
          255,
          Math.max(0, Math.round((rawGray[rowOff + x] * targetPaperLum) / localPaper))
        );
        normGray[rowOff + x] = val;
        normHist[val]++;
      }
    }

    return { normGray, normHist };
  }

  /**
   * Automatisk deteksjon av hovedtekstsatsen (Auto-Crop):
   * 1. Skreller først bort mørke skannekanter / svarte bokrammer langs ytterkantene.
   * 2. Finner deretter yttergrensene til selve tekstblokken med 2 % luft rundt.
   */
  function autoDetectTextBlockCrop() {
    if (!state.gray || !sourceCanvas.width || !sourceCanvas.height) return null;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const gray = state.gray;
    const thresh = state.otsuThreshold;

    // 1. Skrell vekk mørke skannerammer ytterst (inntil 14% fra hver kant)
    let minX = 0;
    let maxX = w;
    let minY = 0;
    let maxY = h;

    const maxBorderX = Math.round(w * 0.14);
    const maxBorderY = Math.round(h * 0.12);

    // Sjekk venstre kant for mørke skanningsstriper (> 38% mørke piksler i kolonnen)
    for (let x = 0; x < maxBorderX; x++) {
      let dark = 0;
      for (let y = minY; y < maxY; y += 2) {
        if (gray[y * w + x] < thresh) dark++;
      }
      if (dark / ((maxY - minY) / 2) > 0.38) {
        minX = x + 4;
      } else if (x > minX + 12) {
        break;
      }
    }

    // Sjekk høyre kant for mørke skanningsstriper
    for (let x = w - 1; x > w - maxBorderX; x--) {
      let dark = 0;
      for (let y = minY; y < maxY; y += 2) {
        if (gray[y * w + x] < thresh) dark++;
      }
      if (dark / ((maxY - minY) / 2) > 0.38) {
        maxX = x - 4;
      } else if (x < maxX - 12) {
        break;
      }
    }

    // Sjekk øvre og nedre kant for mørke skanningsstriper
    for (let y = 0; y < maxBorderY; y++) {
      let dark = 0;
      for (let x = minX; x < maxX; x += 2) {
        if (gray[y * w + x] < thresh) dark++;
      }
      if (dark / ((maxX - minX) / 2) > 0.38) {
        minY = y + 4;
      } else if (y > minY + 10) {
        break;
      }
    }

    for (let y = h - 1; y > h - maxBorderY; y--) {
      let dark = 0;
      for (let x = minX; x < maxX; x += 2) {
        if (gray[y * w + x] < thresh) dark++;
      }
      if (dark / ((maxX - minX) / 2) > 0.38) {
        maxY = y - 4;
      } else if (y < maxY - 10) {
        break;
      }
    }

    // 2. Finn tekstsatsens aktive rader og kolonner innenfor det rensede området
    const innerW = Math.max(40, maxX - minX);
    const innerH = Math.max(40, maxY - minY);
    const minRowInk = Math.max(4, Math.round(innerW * 0.01));
    const minColInk = Math.max(4, Math.round(innerH * 0.008));

    let textTop = minY;
    let textBottom = maxY;
    let textLeft = minX;
    let textRight = maxX;

    for (let y = minY; y < maxY; y++) {
      let ink = 0;
      const rowOff = y * w;
      for (let x = minX; x < maxX; x++) {
        if (gray[rowOff + x] < thresh) ink++;
      }
      if (ink >= minRowInk) {
        textTop = y;
        break;
      }
    }

    for (let y = maxY - 1; y > textTop; y--) {
      let ink = 0;
      const rowOff = y * w;
      for (let x = minX; x < maxX; x++) {
        if (gray[rowOff + x] < thresh) ink++;
      }
      if (ink >= minRowInk) {
        textBottom = y;
        break;
      }
    }

    for (let x = minX; x < maxX; x++) {
      let ink = 0;
      for (let y = textTop; y <= textBottom; y++) {
        if (gray[y * w + x] < thresh) ink++;
      }
      if (ink >= minColInk) {
        textLeft = x;
        break;
      }
    }

    for (let x = maxX - 1; x > textLeft; x--) {
      let ink = 0;
      for (let y = textTop; y <= textBottom; y++) {
        if (gray[y * w + x] < thresh) ink++;
      }
      if (ink >= minColInk) {
        textRight = x;
        break;
      }
    }

    const padX = Math.round(w * 0.018);
    const padY = Math.round(h * 0.018);
    const cx = Math.max(0, textLeft - padX);
    const cy = Math.max(0, textTop - padY);
    const cw = Math.min(w - cx, textRight - textLeft + padX * 2);
    const ch = Math.min(h - cy, textBottom - textTop + padY * 2);

    if (cw < w * 0.2 || ch < h * 0.15) {
      return {
        x: minX,
        y: minY,
        w: Math.max(40, maxX - minX),
        h: Math.max(40, maxY - minY),
      };
    }

    return { x: cx, y: cy, w: cw, h: ch };
  }

  function ingestCanvasSource() {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    state.sourceImageData = sourceCtx.getImageData(0, 0, w, h);
    const rgba = state.sourceImageData.data;

    // 1. Beregn rå luminans (gråtoner) og histogram
    const rawGray = new Uint8Array(w * h);
    const rawHist = new Uint32Array(256);

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      // ITU-R BT.601 luminans
      const lum = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
      rawGray[p] = lum;
      rawHist[lum]++;
    }

    const rawOtsu = computeOtsuThreshold(rawHist, w * h);

    // 2. Mål den faktiske papirfargen fra lyse bakgrunnspiksler midt på siden
    // slik at "Renset blekk (Papirtone)" får samme behagelige varme bakgrunn som originalen!
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let countPaper = 0;
    const sampleStep = Math.max(4, Math.floor((w * h) / 4000));
    const paperCutoff = Math.min(245, rawOtsu + 18);

    for (let p = 0; p < rawGray.length; p += sampleStep) {
      if (rawGray[p] >= paperCutoff) {
        const idx = p * 4;
        sumR += rgba[idx];
        sumG += rgba[idx + 1];
        sumB += rgba[idx + 2];
        countPaper++;
      }
    }

    if (countPaper > 20) {
      // Bland 82% målt papirfarge med 18% varm kremhvit (#faf6ed) så den alltid er behagelig og ren
      const r = Math.round((sumR / countPaper) * 0.82 + 250 * 0.18);
      const g = Math.round((sumG / countPaper) * 0.82 + 246 * 0.18);
      const b = Math.round((sumB / countPaper) * 0.82 + 237 * 0.18);
      state.sampledPaperHex = `rgb(${r}, ${g}, ${b})`;
    } else {
      state.sampledPaperHex = "#f6efe0";
    }
    liquidReader.style.setProperty("--sampled-paper-bg", state.sampledPaperHex);

    // 3. Lokal adaptiv skyggefjerning via 2D Integral Image (Summed-Area Table)
    if (state.useAdaptiveShadow) {
      const { normGray, normHist } = normalizeGrayWithIntegralImage(
        rawGray,
        w,
        h,
        state.paperMedianLum
      );
      state.gray = normGray;
      state.otsuThreshold = computeOtsuThreshold(normHist, w * h);
    } else {
      state.gray = rawGray;
      state.otsuThreshold = rawOtsu;
    }

    runSegmentationAndRender();
  }

  /**
   * Roterer kilde-canvaset (fra tapsfri rawMasterCanvas) med angleDeg grader
   * for å rette opp skjeve pocketbok-skanninger eller mobilbilder.
   */
  function applyDeskewRotation(angleDeg) {
    if (!rawMasterCanvas.width || !rawMasterCanvas.height) return;
    state.deskewAngle = angleDeg;
    if (deskewSlider) {
      deskewSlider.value = String(angleDeg);
      deskewOutput.textContent = `${angleDeg > 0 ? "+" : ""}${angleDeg.toFixed(1)}°`;
    }

    const w = rawMasterCanvas.width;
    const h = rawMasterCanvas.height;
    sourceCtx.save();
    sourceCtx.fillStyle = state.sampledPaperHex || "#f6efe0";
    sourceCtx.fillRect(0, 0, w, h);
    sourceCtx.translate(w / 2, h / 2);
    sourceCtx.rotate((angleDeg * Math.PI) / 180);
    sourceCtx.drawImage(rawMasterCanvas, -w / 2, -h / 2);
    sourceCtx.restore();

    ingestCanvasSource();
  }

  /**
   * Finner automatisk den rotasjonsvinkelen (-5.5° .. +5.5°) som gir skarpest
   * horisontal linjeseparasjon (maksimal varians i horisontal projeksjonsprofil).
   */
  function autoDetectSkewAngle() {
    if (!rawMasterCanvas.width || !state.gray) return;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const roi = state.cropRect || {
      x: Math.round(w * 0.1),
      y: Math.round(h * 0.1),
      w: Math.round(w * 0.8),
      h: Math.round(h * 0.8),
    };

    // Hent uroterte gråtoner fra rawMasterCanvas
    const rawData = rawMasterCtx.getImageData(0, 0, w, h).data;
    const rawGray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < rawData.length; i += 4, p++) {
      rawGray[p] = (rawData[i] * 77 + rawData[i + 1] * 150 + rawData[i + 2] * 29) >> 8;
    }

    const thresh = state.otsuThreshold;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const x0 = Math.max(0, Math.round(roi.x));
    const x1 = Math.min(w - 1, Math.round(roi.x + roi.w));
    const y0 = Math.max(0, Math.round(roi.y));
    const y1 = Math.min(h - 1, Math.round(roi.y + roi.h));
    const roiH = Math.max(1, y1 - y0);

    let bestAngle = 0;
    let bestScore = -1;

    // Søk med 0.25 graders oppløsning fra -5.5° til +5.5°
    for (let deg = -5.5; deg <= 5.5; deg += 0.25) {
      const rad = (-deg * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const rowHist = new Uint16Array(roiH);

      // Sample hver 2. piksel i x og y for lynraskt søk (< 15 ms)
      for (let y = y0; y < y1; y += 2) {
        const dy = y - cy;
        for (let x = x0; x < x1; x += 2) {
          if (rawGray[y * w + x] < thresh) {
            const dx = x - cx;
            const rotY = Math.round( -dx * sinA + dy * cosA + cy ) - y0;
            if (rotY >= 0 && rotY < roiH) {
              rowHist[rotY]++;
            }
          }
        }
      }

      // Beregn summen av kvadrerte rad-forskjeller (høyest når tekstlinjer og mellomrom er helt horisontale)
      let score = 0;
      for (let r = 1; r < roiH; r++) {
        const diff = rowHist[r] - rowHist[r - 1];
        score += diff * diff;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAngle = deg;
      }
    }

    applyDeskewRotation(bestAngle);
  }

  function computeOtsuThreshold(hist, totalPixels) {
    // 1. Finn papirets typiske lysstyrke (65-persentilen av pikslene på siden).
    // På tittelsider eller nesten tomme sider (der >98% av pikslene er papir)
    // vil vanlig Otsu ellers dele selve papir-gradienten i to og tolke halve papiret som blekk!
    let cum = 0;
    let paperLum = 215;
    const targetPaperRank = totalPixels * 0.65;
    for (let t = 0; t < 256; t++) {
      cum += hist[t];
      if (cum >= targetPaperRank) {
        paperLum = t;
        break;
      }
    }
    state.paperMedianLum = paperLum;

    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];

    let sumB = 0;
    let wB = 0;
    let maxVariance = 0;
    let threshold = 135;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;

      const wF = totalPixels - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const betweenVar = wB * wF * (mB - mF) * (mB - mF);
      if (betweenVar > maxVariance) {
        maxVariance = betweenVar;
        threshold = t;
      }
    }

    // Sikre at blekk-terskelen alltid ligger minst 34 nivåer mørkere enn selve papirbakgrunnen!
    // Dette forhindrer at papir-støy på tittelsider (som Skrams "Sommer") utløser gigantiske konturer.
    const maxSafeInkThreshold = Math.max(55, paperLum - 34);
    return Math.min(threshold, maxSafeInkThreshold);
  }

  /**
   * Hovedpipeline for å finne tekstlinjer og ord innenfor aktivt utsnitt (cropRect).
   */
  function runSegmentationAndRender() {
    if (!state.gray || !state.sourceImageData) return;

    const fullW = sourceCanvas.width;
    const fullH = sourceCanvas.height;

    // Effektiv blekk-terskel (piksler mørkere enn denne verdien regnes som blekk)
    const inkThreshold = Math.max(
      25,
      Math.min(235, state.otsuThreshold + state.contrastOffset)
    );

    let x0;
    let y0;
    let x1;
    let y1;

    if (state.cropRect) {
      x0 = Math.max(0, Math.min(fullW - 1, Math.round(state.cropRect.x)));
      y0 = Math.max(0, Math.min(fullH - 1, Math.round(state.cropRect.y)));
      x1 = Math.max(
        x0 + 1,
        Math.min(fullW, Math.round(state.cropRect.x + state.cropRect.w))
      );
      y1 = Math.max(
        y0 + 1,
        Math.min(fullH, Math.round(state.cropRect.y + state.cropRect.h))
      );
    } else {
      // Start helt ute ved 0 (så tett beskårne NB-sider der teksten starter 8 px fra kanten
      // aldri mister første bokstav!), og skrell KUN bort kontinuerlige vertikale/horisontale
      // skannerstriper (> 28 % mørke piksler gjennom hele sidens høyde/bredde) innenfor de ytterste 1,2 %.
      x0 = 0;
      x1 = fullW;
      y0 = 0;
      y1 = fullH;

      const maxBorderScanX = Math.min(14, Math.round(fullW * 0.013));
      const maxBorderScanY = Math.min(14, Math.round(fullH * 0.01));
      const sampleRows = Math.max(1, Math.floor(fullH / 2));

      let lastLeftStripe = -1;
      for (let c = 0; c < maxBorderScanX; c++) {
        let dark = 0;
        for (let y = 0; y < fullH; y += 2) {
          if (state.gray[y * fullW + c] < inkThreshold) dark++;
        }
        if (dark / sampleRows > 0.28) {
          lastLeftStripe = c;
        }
      }
      if (lastLeftStripe >= 0) {
        x0 = Math.min(fullW - 2, lastLeftStripe + 2);
      }

      let lastRightStripe = fullW;
      for (let c = fullW - 1; c >= fullW - maxBorderScanX; c--) {
        let dark = 0;
        for (let y = 0; y < fullH; y += 2) {
          if (state.gray[y * fullW + c] < inkThreshold) dark++;
        }
        if (dark / sampleRows > 0.28) {
          lastRightStripe = c;
        }
      }
      if (lastRightStripe < fullW) {
        x1 = Math.max(x0 + 1, lastRightStripe - 1);
      }

      const sampleCols = Math.max(1, Math.floor((x1 - x0) / 2));
      let lastTopStripe = -1;
      for (let r = 0; r < maxBorderScanY; r++) {
        let dark = 0;
        const ro = r * fullW;
        for (let x = x0; x < x1; x += 2) {
          if (state.gray[ro + x] < inkThreshold) dark++;
        }
        if (dark / sampleCols > 0.28) {
          lastTopStripe = r;
        }
      }
      if (lastTopStripe >= 0) {
        y0 = Math.min(fullH - 2, lastTopStripe + 2);
      }

      let lastBotStripe = fullH;
      for (let r = fullH - 1; r >= fullH - maxBorderScanY; r--) {
        let dark = 0;
        const ro = r * fullW;
        for (let x = x0; x < x1; x += 2) {
          if (state.gray[ro + x] < inkThreshold) dark++;
        }
        if (dark / sampleCols > 0.28) {
          lastBotStripe = r;
        }
      }
      if (lastBotStripe < fullH) {
        y1 = Math.max(y0 + 1, lastBotStripe - 1);
      }
    }

    const roiW = Math.max(1, x1 - x0);
    const roiH = Math.max(1, y1 - y0);

    // --- STEG A: Horisontal projeksjon (antall blekkpiksler per rad) ---
    // For selve linjedeteksjonen (rowCounts) måler vi de indre 92 % av bredden dersom
    // brukeren ikke har valgt manuelt utsnitt, slik at eventuelle skygger/stempler
    // helt ute i margen aldri kan koble sammen to linjer!
    const projX0 = state.cropRect ? x0 : Math.max(x0, Math.round(fullW * 0.035));
    const projX1 = state.cropRect ? x1 : Math.min(x1, Math.round(fullW * 0.965));
    const rowCounts = new Float32Array(roiH);
    for (let r = 0; r < roiH; r++) {
      const rowOffset = (y0 + r) * fullW;
      let ink = 0;
      for (let c = projX0; c < projX1; c++) {
        if (state.gray[rowOffset + c] < inkThreshold) {
          ink++;
        }
      }
      rowCounts[r] = ink;
    }

    // Glatt ut rad-profilen med et 3-punkts filter for å unngå falske brudd
    const smoothRows = new Float32Array(roiH);
    for (let r = 0; r < roiH; r++) {
      const prev = rowCounts[Math.max(0, r - 1)];
      const curr = rowCounts[r];
      const next = rowCounts[Math.min(roiH - 1, r + 1)];
      smoothRows[r] = (prev + curr * 2 + next) / 4;
    }

    // En rad regnes som aktiv tekstlinje når den har nok blekkpiksler
    const minRowInk = Math.max(3, Math.round(roiW * 0.008));
    const rawLineBands = [];
    let inLine = false;
    let bandStart = 0;

    for (let r = 0; r < roiH; r++) {
      if (!inLine && smoothRows[r] >= minRowInk) {
        inLine = true;
        bandStart = r;
      } else if (inLine && smoothRows[r] < minRowInk) {
        inLine = false;
        rawLineBands.push({ top: bandStart, bottom: r - 1 });
      }
    }
    if (inLine) {
      rawLineBands.push({ top: bandStart, bottom: roiH - 1 });
    }

    // Slå kun sammen bånd over <= 2 pikslers hull dersom minst ett av båndene er et
    // tynt diakritisk fragment (<= 8 px, f.eks. prikk over i/å). To fullhøyde tekstlinjer
    // skal ALDRI slås sammen bare fordi en descender kom nær en ascender på linjen under!
    const mergedBands = [];
    for (const band of rawLineBands) {
      if (mergedBands.length > 0) {
        const prev = mergedBands[mergedBands.length - 1];
        const prevH = prev.bottom - prev.top + 1;
        const currH = band.bottom - band.top + 1;
        if (band.top - prev.bottom <= 2 && Math.min(prevH, currH) <= 8) {
          prev.bottom = band.bottom;
          continue;
        }
      }
      mergedBands.push({ ...band });
    }

    // Filtrer bort støy-linjer (< 6px) og ekstremt høye bånd (> 260px, f.eks. helsides ramme/illustrasjon)
    const maxAllowedBandH = Math.max(180, Math.round(roiH * 0.22));
    const preValidBands = mergedBands.filter((b) => {
      const bh = b.bottom - b.top + 1;
      return bh >= 6 && bh <= maxAllowedBandH;
    });

    // Estimer typisk enkeltlinje-høyde (35-persentil av bånd >= 12 px) og splitt
    // eventuelle sammensmeltede dobbelt-/trippellinjer (bh >= refSingleH * 1.65) i bølgedalen!
    const tallHeights = preValidBands
      .map((b) => b.bottom - b.top + 1)
      .filter((h) => h >= 12)
      .sort((a, b) => a - b);
    const refSingleH =
      tallHeights.length > 0
        ? tallHeights[Math.floor(tallHeights.length * 0.35)]
        : 28;

    function splitMultiLineBand(top, bottom) {
      const bh = bottom - top + 1;
      if (bh < refSingleH * 1.65) {
        return [{ top, bottom }];
      }
      const margin = Math.max(10, Math.round(refSingleH * 0.55));
      if (top + margin >= bottom - margin) {
        return [{ top, bottom }];
      }
      let minVal = Infinity;
      let minR = -1;
      for (let r = top + margin; r <= bottom - margin; r++) {
        if (smoothRows[r] < minVal) {
          minVal = smoothRows[r];
          minR = r;
        }
      }
      if (minR <= top || minR >= bottom) {
        return [{ top, bottom }];
      }
      let peakTop = 0;
      for (let r = top; r < minR; r++) {
        if (smoothRows[r] > peakTop) peakTop = smoothRows[r];
      }
      let peakBot = 0;
      for (let r = minR + 1; r <= bottom; r++) {
        if (smoothRows[r] > peakBot) peakBot = smoothRows[r];
      }
      if (minVal <= Math.min(peakTop, peakBot) * 0.45) {
        return [
          ...splitMultiLineBand(top, minR - 1),
          ...splitMultiLineBand(minR + 1, bottom),
        ];
      }
      return [{ top, bottom }];
    }

    const splitBands = [];
    for (const b of preValidBands) {
      splitBands.push(...splitMultiLineBand(b.top, b.bottom));
    }

    // Tynne bånd rett under en linje er avkuttede underlengder (halen på y, g, p) fra den
    // linjen, ikke en egen tekstlinje. Slå dem sammen med linjen over, ellers blir halene
    // egne «ord» og bindestrek-sammensyingen limer forrige linjes orddeling til en hale.
    // (En rad med prikker/skilletegn ligger mye lenger unna og beholdes som egen linje.)
    const validBands = [];
    for (const b of splitBands) {
      const prev = validBands[validBands.length - 1];
      const bh = b.bottom - b.top + 1;
      if (
        prev &&
        bh < refSingleH * 0.3 &&
        b.top - prev.bottom <= refSingleH * 0.25
      ) {
        prev.bottom = b.bottom;
        continue;
      }
      validBands.push({ ...b });
    }

    // Beregn median linjehøyde og median linjeavstand (for å oppdage avsnittsskift!)
    const heights = validBands.map((b) => b.bottom - b.top + 1);
    const medianLineHeight = computeMedian(heights) || 24;

    const lineGaps = [];
    for (let i = 1; i < validBands.length; i++) {
      lineGaps.push(validBands[i].top - validBands[i - 1].bottom);
    }
    const medianLineGap = computeMedian(lineGaps) || Math.round(medianLineHeight * 0.45);

    // --- STEG A2: Masker smale blekkblokker langt utenfor tekstsatsen (sidekant, skygge, støv) ---
    // Vertikal projeksjon over ALLE tekstlinjene samlet: kolonner grupperes i blokker (hull
    // < 1,5 linjehøyder slås sammen). Den bredeste blokken er tekstsatsen. Andre blokker som er
    // smale (< 1 linjehøyde) og ligger minst 1,5 linjehøyder unna, er typisk en mørk sidekant
    // eller bokrygg som ellers blir egne «ord» (vertikale streker) ytterst på hver linje, og som
    // da også hindrer bindestrek-gjenkjenningen på linjen. Brede blokker (ekstra spalter) beholdes.
    const maskedColumns = new Uint8Array(roiW);
    if (validBands.length >= 3) {
      const pageColInk = new Uint32Array(roiW);
      for (const band of validBands) {
        for (let y = y0 + band.top; y <= y0 + band.bottom; y++) {
          const rowOff = y * fullW + x0;
          for (let c = 0; c < roiW; c++) {
            if (state.gray[rowOff + c] < inkThreshold) pageColInk[c]++;
          }
        }
      }
      const mergeGap = Math.round(medianLineHeight * 1.5);
      // Kolonner med bare 1–2 blekkpiksler (spredte støvkorn i margen) teller ikke, ellers
      // bygger de bro mellom tekstsatsen og sidekanten.
      const minSignificantColInk = 3;
      const colBlocks = [];
      let blockStart = -1;
      let lastInkCol = -1;
      for (let c = 0; c < roiW; c++) {
        if (pageColInk[c] < minSignificantColInk) continue;
        if (blockStart < 0) {
          blockStart = c;
        } else if (c - lastInkCol - 1 >= mergeGap) {
          colBlocks.push({ left: blockStart, right: lastInkCol });
          blockStart = c;
        }
        lastInkCol = c;
      }
      if (blockStart >= 0) colBlocks.push({ left: blockStart, right: lastInkCol });

      if (colBlocks.length >= 2) {
        let mainBlock = colBlocks[0];
        for (const b of colBlocks) {
          if (b.right - b.left > mainBlock.right - mainBlock.left) mainBlock = b;
        }
        for (const b of colBlocks) {
          if (b === mainBlock) continue;
          if (b.right - b.left + 1 < medianLineHeight) {
            const maskL = Math.max(0, b.left - 3);
            const maskR = Math.min(roiW - 1, b.right + 3);
            for (let c = maskL; c <= maskR; c++) maskedColumns[c] = 1;
          }
        }
      }
    }
    // Frittstående ord med mindre blekk enn dette er støvkorn (et punktum har ca. 2–3× så mye)
    const minIsolatedInkPixels = Math.max(6, Math.round(medianLineHeight * medianLineHeight * 0.008));

    // --- STEG B: Vertikal projeksjon og ordskille per linje ---
    const lines = [];
    const allWords = [];
    let wordCounter = 0;

    validBands.forEach((band, lineIdx) => {
      const absTop = y0 + band.top;
      const absBottom = y0 + band.bottom;
      const bandH = absBottom - absTop + 1;

      // Finn linjens "kjerne-sentrum" (tyngdepunktet av blekk) for baseline-justering
      let weightedRowSum = 0;
      let totalRowInk = 0;
      for (let r = band.top; r <= band.bottom; r++) {
        weightedRowSum += (y0 + r) * smoothRows[r];
        totalRowInk += smoothRows[r];
      }
      const yCore = totalRowInk > 0 ? weightedRowSum / totalRowInk : (absTop + absBottom) / 2;

      // Tell blekkpiksler per kolonne innenfor denne linjen
      const colCounts = new Uint16Array(roiW);
      for (let c = 0; c < roiW; c++) {
        if (maskedColumns[c]) {
          colCounts[c] = 0;
          continue;
        }
        const absX = x0 + c;
        let colInk = 0;
        for (let y = absTop; y <= absBottom; y++) {
          if (state.gray[y * fullW + absX] < inkThreshold) {
            colInk++;
          }
        }
        colCounts[c] = colInk;
      }

      // Finn sammenhengende horisontale blekk-segmenter (bokstaver eller bokstavgrupper)
      const minColInk = 1;
      const charRuns = [];
      let inRun = false;
      let runStart = 0;

      for (let c = 0; c < roiW; c++) {
        if (!inRun && colCounts[c] >= minColInk) {
          inRun = true;
          runStart = c;
        } else if (inRun && colCounts[c] < minColInk) {
          inRun = false;
          charRuns.push({ left: runStart, right: c - 1 });
        }
      }
      if (inRun) {
        charRuns.push({ left: runStart, right: roiW - 1 });
      }

      if (charRuns.length === 0) return;

      // Analyser gapene mellom segmentene i linjen for å skille bokstav-avstand fra ord-mellomrom.
      // Et ordskille (space) i typografi er typisk ~22%–35% av linjehøyden, skalert med brukerens slider.
      const baseSpaceThreshold = Math.max(
        2.5,
        (bandH * 0.24) / state.spaceSensitivity
      );

      const wordSpans = [];
      let currentWord = { left: charRuns[0].left, right: charRuns[0].right };

      for (let i = 1; i < charRuns.length; i++) {
        const gap = charRuns[i].left - currentWord.right - 1;
        if (gap >= baseSpaceThreshold) {
          wordSpans.push(currentWord);
          currentWord = { left: charRuns[i].left, right: charRuns[i].right };
        } else {
          currentWord.right = charRuns[i].right;
        }
      }
      wordSpans.push(currentWord);

      // Normaliser utklippshøyden rundt yCore slik at alle ord i en linje
      // har felles baseline og lik høyde når de flyter fritt i Liquid Mode!
      const baseHalfTop = Math.round(medianLineHeight * 0.64);
      const baseHalfBottom = Math.round(medianLineHeight * 0.54);
      // Hvis linjen har ekstra store fonter (f.eks. tittel/overskrift), legg til
      // symmetrisk polstring både oppe og nede slik at (paddedHalfTop - paddedHalfBottom)
      // og dermed grunnlinjens posisjon fra midten av ord-canvaset forblir 100 % konstant!
      const extraSymmetricPad =
        bandH > medianLineHeight * 1.25
          ? Math.max(0, Math.ceil((bandH - medianLineHeight * 1.15) * 0.5))
          : 0;

      const paddedHalfTop = state.useDejaggBaseline
        ? baseHalfTop + extraSymmetricPad
        : Math.max(
            baseHalfTop,
            Math.round(yCore - absTop + 3)
          );
      const paddedHalfBottom = state.useDejaggBaseline
        ? baseHalfBottom + extraSymmetricPad
        : Math.max(
            baseHalfBottom,
            Math.round(absBottom - yCore + 3)
          );

      const normTop = Math.max(y0, Math.round(yCore - paddedHalfTop));
      const normBottom = Math.min(y1 - 1, Math.round(yCore + paddedHalfBottom));
      const normH = state.useDejaggBaseline
        ? Math.max(6, paddedHalfTop + paddedHalfBottom + 1)
        : Math.max(6, normBottom - normTop + 1);

      /**
       * Måler x-høyden (øvre og nedre kant av små bokstaver) over kolonnene colL..colR
       * (relativt til x0) i denne linjen. Returnerer null når målingen er usikker.
       *
       * x-høyden er det sammenhengende området rundt raden med mest blekk der hver rad har
       * minst halvparten av 75-persentilen. Over en linjebit på flere bokstaver har opp- og
       * nedstreker (k, l, g, p) langt mindre blekk per rad enn kroppen av de små bokstavene.
       * (Bratteste stigning/fall brukes ikke: tverrstreken i «e» og fotseriffene gir brattere
       * kanter enn toppen av x-høyden og grunnlinjen.)
       */
      function measureXHeightRange(colL, colR) {
        if (colR - colL < 2) return null;
        const mass = new Int32Array(bandH);
        for (let r = 0; r < bandH; r++) {
          const rowOff = (absTop + r) * fullW + x0;
          let m = 0;
          for (let c = colL; c <= colR; c++) {
            if (state.gray[rowOff + c] < inkThreshold) m++;
          }
          mass[r] = m;
        }
        const sorted = Array.from(mass).sort((a, b) => a - b);
        const q75 = sorted[Math.floor((sorted.length - 1) * 0.75)];
        if (q75 < 4) return null;
        const minRowMass = q75 * 0.5;
        let peakR = 0;
        for (let r = 1; r < bandH; r++) if (mass[r] > mass[peakR]) peakR = r;
        let top = peakR;
        let bottom = peakR;
        while (top > 0 && mass[top - 1] >= minRowMass) top--;
        while (bottom < bandH - 1 && mass[bottom + 1] >= minRowMass) bottom++;
        if (bottom - top + 1 < Math.max(4, Math.round(bandH * 0.25))) return null;
        return { top: absTop + top, bottom: absTop + bottom, mass: q75 };
      }

      /**
       * x-høyden like før kolonne letterR, målt over de siste ~6 linjehøydene av linjen
       * (8–10 bokstaver, også fra ordene foran). Så kort strekning gir lite skjevhet.
       */
      function measureXHeightBand(letterL, letterR) {
        return measureXHeightRange(Math.max(0, letterR - Math.round(bandH * 6)), letterR);
      }

      /**
       * En bindestrek står midt i x-høyden. Armen på «r» og øret på «g» ser like ut
       * (tynn, vannrett, frittstående), men ligger helt i toppen av x-høyden.
       */
      function isAtHyphenHeight(minInkY, maxInkY, letterL, letterR) {
        if (letterL == null || letterR == null) return true;
        const xBand = measureXHeightBand(letterL, letterR);
        if (!xBand) return true;
        const xh = xBand.bottom - xBand.top + 1;
        const midY = (minInkY + maxInkY) * 0.5;
        return (
          minInkY >= xBand.top + xh * 0.22 &&
          maxInkY <= xBand.bottom - xh * 0.12 &&
          midY >= xBand.top + xh * 0.3 &&
          midY <= xBand.bottom - xh * 0.2
        );
      }

      /**
       * Streng geometrisk deteksjon av ekte bindestrek (- eller =) helt til høyre på en linje:
       * 1. Bredde: 4 px opp til 52 % av linjehøyden.
       * 2. Vertikal tykkelse (inkH): Maks 24 % av linjehøyden (vanlige små bokstaver som
       *    e, r, n, s, a, o er 40–50 % av linjehøyden og filtreres dermed alltid bort!).
       * 3. Aspektforhold (runW / inkH >= 1.3): Må være tydelig bredere enn den er høy
       *    (filtrerer bort punktum, komma, semikolon og smale bokstavstammer).
       * 4. Vertikal posisjon: Sentrert rundt x-høyden (yCore), godt klar av både
       *    topp-ascendere og baseline/descendere.
       */
      function checkHyphenGeometry(colStart, colEnd, letterL = null, letterR = null) {
        const runW = colEnd - colStart + 1;
        if (runW < 4 || runW > Math.max(16, Math.round(bandH * 0.52))) {
          return false;
        }
        let minInkY = absBottom + 1;
        let maxInkY = absTop - 1;
        let inkPixels = 0;
        let colsWithInk = 0;

        for (let c = colStart; c <= colEnd; c++) {
          const absX = x0 + c;
          let colHasInk = false;
          for (let y = absTop; y <= absBottom; y++) {
            if (state.gray[y * fullW + absX] < inkThreshold) {
              if (y < minInkY) minInkY = y;
              if (y > maxInkY) maxInkY = y;
              inkPixels++;
              colHasInk = true;
            }
          }
          if (colHasInk) colsWithInk++;
        }
        if (inkPixels < 3 || maxInkY < minInkY || colsWithInk < runW * 0.75) {
          return false;
        }

        const inkH = maxInkY - minInkY + 1;
        const midY = (minInkY + maxInkY) * 0.5;

        const isThinHorizontalStroke =
          inkH <= Math.max(7, Math.round(bandH * 0.24)) &&
          runW >= inkH * 1.3;
        const isCenteredOnXHeight =
          midY >= yCore - bandH * 0.16 && midY <= yCore + bandH * 0.22;
        const clearsTopAndBottom =
          minInkY >= absTop + Math.max(3, Math.floor(bandH * 0.20)) &&
          maxInkY <= absBottom - Math.max(3, Math.floor(bandH * 0.16));

        return (
          isThinHorizontalStroke &&
          isCenteredOnXHeight &&
          clearsTopAndBottom &&
          isAtHyphenHeight(minInkY, maxInkY, letterL, letterR)
        );
      }

      /**
       * 2D sammenhengende-komponent-søk (4-connected BFS) for bindestrek helt til høyre i et ord.
       * Løser tilfeller i tett kernet antikva-sats (f.eks. "ty-", "frede-", "gevæ-", "mang-")
       * der øret på 'g', seriffen på 'y' eller tverrstreken i 'e' stikker 1–2 px ut over/under
       * venstre spiss av bindestreken, slik at 1D vertikal projeksjon (colCounts) ikke ser
       * noen 100 % tom kolonne mellom bokstaven og bindestreken – mens bindestreken i 2D
       * er en helt frittstående, tynn horisontal øy!
       */
      function findRightmost2DHyphen(wordLeftCol, wordRightCol) {
        const maxDashW = Math.max(18, Math.round(bandH * 0.52));
        const maxDashH = Math.max(7, Math.round(bandH * 0.24));
        const yMinZone = Math.max(absTop, Math.round(yCore - bandH * 0.22));
        const yMaxZone = Math.min(absBottom, Math.round(yCore + bandH * 0.26));

        // Frø: blekkpiksler i x-høydesonen i de tre ytterste kolonnene. En dobbel, skrå
        // frakturbindestrek (⸗) har to streker som ikke nødvendigvis slutter i samme kolonne.
        const seedPixels = [];
        for (let sc = wordRightCol; sc >= Math.max(wordLeftCol, wordRightCol - 2); sc--) {
          const absX = x0 + sc;
          for (let y = yMinZone; y <= yMaxZone; y++) {
            if (state.gray[y * fullW + absX] < inkThreshold) {
              seedPixels.push({ c: sc, y });
            }
          }
        }
        if (seedPixels.length === 0) return null;

        const spanW = wordRightCol - wordLeftCol + 1;
        const visited = new Uint8Array(spanW * bandH);
        const components = [];

        // Vokser én sammenhengende komponent (4-naboskap). Returnerer null straks den blir
        // større enn en bindestrek (da er det en bokstav, og ordet har ingen bindestrek).
        function growComponent(seed) {
          const queue = [seed];
          visited[(seed.y - absTop) * spanW + (seed.c - wordLeftCol)] = 1;
          let minC = seed.c;
          let maxC = seed.c;
          let minY = seed.y;
          let maxY = seed.y;
          let head = 0;
          while (head < queue.length) {
            const curr = queue[head++];
            if (curr.c < minC) minC = curr.c;
            if (curr.c > maxC) maxC = curr.c;
            if (curr.y < minY) minY = curr.y;
            if (curr.y > maxY) maxY = curr.y;
            if (maxC - minC + 1 > maxDashW || maxY - minY + 1 > maxDashH) {
              return null;
            }
            const neighbors = [
              { c: curr.c + 1, y: curr.y },
              { c: curr.c - 1, y: curr.y },
              { c: curr.c, y: curr.y + 1 },
              { c: curr.c, y: curr.y - 1 },
            ];
            for (const nb of neighbors) {
              if (
                nb.c < wordLeftCol ||
                nb.c > wordRightCol ||
                nb.y < absTop ||
                nb.y > absBottom
              ) {
                continue;
              }
              const nIdx = (nb.y - absTop) * spanW + (nb.c - wordLeftCol);
              if (!visited[nIdx] && state.gray[nb.y * fullW + (x0 + nb.c)] < inkThreshold) {
                visited[nIdx] = 1;
                queue.push(nb);
              }
            }
          }
          return { minC, maxC, minY, maxY };
        }

        for (const sp of seedPixels) {
          if (visited[(sp.y - absTop) * spanW + (sp.c - wordLeftCol)]) continue;
          const comp = growComponent(sp);
          if (!comp) return null;
          components.push(comp);
          if (components.length > 2) return null;
        }

        // Hver strek må være tynn og tydelig bredere enn høy
        for (const comp of components) {
          const cw = comp.maxC - comp.minC + 1;
          const ch = comp.maxY - comp.minY + 1;
          if (cw < 4 || cw < ch * 1.35) return null;
        }

        const isDouble = components.length === 2;
        if (isDouble) {
          // Dobbel bindestrek: to streker over hverandre som overlapper horisontalt
          const [a, b] = components[0].minY <= components[1].minY
            ? components
            : [components[1], components[0]];
          const overlap = Math.min(a.maxC, b.maxC) - Math.max(a.minC, b.minC) + 1;
          const narrower = Math.min(a.maxC - a.minC + 1, b.maxC - b.minC + 1);
          if (overlap < narrower * 0.5) return null;
          if (b.minY - a.maxY - 1 > Math.max(3, bandH * 0.2)) return null;
        }

        let minC = Infinity;
        let maxC = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const comp of components) {
          minC = Math.min(minC, comp.minC);
          maxC = Math.max(maxC, comp.maxC);
          minY = Math.min(minY, comp.minY);
          maxY = Math.max(maxY, comp.maxY);
        }
        const totalH = maxY - minY + 1;
        const midY = (minY + maxY) * 0.5;

        // Må ha minst én bokstav til venstre for bindestreken inne i samme ord
        if (minC <= wordLeftCol + 3) return null;
        if (totalH > (isDouble ? Math.round(bandH * 0.42) : maxDashH)) return null;
        if (midY < yCore - bandH * 0.16 || midY > yCore + bandH * 0.22) return null;
        if (
          minY < absTop + Math.max(3, Math.floor(bandH * 0.20)) ||
          maxY > absBottom - Math.max(3, Math.floor(bandH * 0.16))
        ) {
          return null;
        }

        // Finn høyre ytterkant (maxLetterC) av selve bokstavblekket i ordet: blekk som IKKE
        // tilhører bindestreken. Se bort fra den øverste delen av båndet, der underlengder fra
        // linjen over kan stikke inn og ligge lenger til høyre enn bindestreken.
        const letterTopY = Math.max(absTop, Math.round(yCore - bandH * 0.3));
        let maxLetterC = wordLeftCol;
        for (let c = maxC; c >= wordLeftCol; c--) {
          const absX = x0 + c;
          let hasNonHyphenInk = false;
          for (let y = letterTopY; y <= absBottom; y++) {
            const nIdx = (y - absTop) * spanW + (c - wordLeftCol);
            if (!visited[nIdx] && state.gray[y * fullW + absX] < inkThreshold) {
              hasNonHyphenInk = true;
              break;
            }
          }
          if (hasNonHyphenInk) {
            maxLetterC = c;
            break;
          }
        }

        // Sikre at avstanden mellom siste bokstav og bindestreken ikke er et helt ordmellomrom (tankestrek)
        if (minC - maxLetterC - 1 > Math.max(5, baseSpaceThreshold * 0.9)) {
          return null;
        }
        const letterR = Math.min(maxLetterC, minC - 1);
        if (isDouble) {
          // Den doble streken dekker mye av x-høyden; krev bare at midten ligger midt i den
          const xBand = measureXHeightBand(wordLeftCol, letterR);
          if (xBand) {
            const xh = xBand.bottom - xBand.top + 1;
            if (midY < xBand.top + xh * 0.25 || midY > xBand.bottom - xh * 0.15) return null;
          }
        } else if (!isAtHyphenHeight(minY, maxY, wordLeftCol, letterR)) {
          return null;
        }

        return {
          minC,
          maxC,
          minY,
          maxY,
          maxLetterC,
        };
      }

      const padX = 2;
      const lineWords = [];
      for (const span of wordSpans) {
        // Ignorer frittstående støykorn (støv, skannerprikker) med svært lite blekk.
        // Ellers blir de egne «ord» og kan stå sist på linjen foran en bindestrek.
        let totalSpanInk = 0;
        for (let c = span.left; c <= span.right; c++) totalSpanInk += colCounts[c];
        if (
          totalSpanInk < minIsolatedInkPixels &&
          !checkHyphenGeometry(span.left, span.right)
        ) {
          continue;
        }

        const wordX = Math.max(x0, x0 + span.left - padX);
        const wordRight = Math.min(x1 - 1, x0 + span.right + padX);
        const wordW = Math.max(3, wordRight - wordX + 1);

        // Beregn ordets rå vertikale blekk-tyngdepunkt (x-høyde-kjerne)
        // ved å finne det tetteste horisontale båndet (ca. 48 % av medianLineHeight)
        // inne i ordet. Dette hindrer at enkeltstående ascendere (h, l, t) eller
        // descendere (g, j, p) drar ordets tyngdepunkt opp eller ned.
        let rawWordYCore = yCore;
        let wordInkMass = 0;
        const rowMass = new Float32Array(bandH);
        for (let r = 0; r < bandH; r++) {
          const y = absTop + r;
          const rowOff = y * fullW;
          let m = 0;
          for (let x = wordX; x <= wordRight; x++) {
            const lum = state.gray[rowOff + x];
            if (lum < inkThreshold) {
              m += inkThreshold - lum;
            }
          }
          rowMass[r] = m;
          wordInkMass += m;
        }

        if (wordInkMass > 0) {
          const coreWin = Math.max(4, Math.min(bandH, Math.round(medianLineHeight * 0.48)));
          let bestWinMass = -1;
          let bestWinStart = 0;
          let runningMass = 0;
          for (let r = 0; r < bandH; r++) {
            runningMass += rowMass[r];
            if (r >= coreWin) {
              runningMass -= rowMass[r - coreWin];
            }
            if (r >= coreWin - 1 && runningMass > bestWinMass) {
              bestWinMass = runningMass;
              bestWinStart = r - (coreWin - 1);
            }
          }
          const winEnd = Math.min(bandH - 1, bestWinStart + coreWin - 1);
          let weightedY = 0;
          let coreMass = 0;
          for (let r = bestWinStart; r <= winEnd; r++) {
            const wgt = rowMass[r] * rowMass[r];
            weightedY += (absTop + r) * wgt;
            coreMass += wgt;
          }
          if (coreMass > 0) {
            rawWordYCore = weightedY / coreMass;
          }
        }

        const wordObj = {
          id: ++wordCounter,
          lineIndex: lines.length,
          x: wordX,
          y: normTop,
          w: wordW,
          h: normH,
          tightY: absTop,
          tightH: bandH,
          rawYCore: rawWordYCore,
          yCoreLocal: yCore,
          localSlope: 0,
          inkMass: Math.max(1, wordInkMass),
          spanLeft: span.left,
          spanRight: span.right,
          hasTrailingHyphen: false,
          wWithoutHyphen: wordW,
          joinWithNextWord: null,
          joinedToPrevWord: null,
        };
        lineWords.push(wordObj);
        allWords.push(wordObj);
      }

      // --- GRUNNLINJE & HELNING PER ORD (DE-JAGG) ---
      // Utklippene plasseres etter linjens målte grunnlinje, ikke etter hvert ords eget
      // blekktyngdepunkt: grunnlinjen er det leseren ser, og den er lik for «og», «til»,
      // «Kraft» og «æ». Grunnlinjen måles i overlappende vinduer langs linjen, og en lokal
      // vektet rett linje (LOESS) gjennom målingene gir grunnlinje og helning for hvert ord.
      // Dermed følges skjevhet og krumning inn mot bokryggen.
      const sigmaX = Math.max(115, roiW * 0.34);
      const invTwoSigmaSq = 1 / (2 * sigmaX * sigmaX);

      // Lokal vektet lineær regresjon i punktet tx. Svak regularisering av helningen så
      // korte linjer (to små ord) ikke overtilpasses.
      function fitLocalLine(samples, tx) {
        let sumW = 0;
        let sumWX = 0;
        let sumWY = 0;
        let sumWXX = 0;
        let sumWXY = 0;
        for (const sp of samples) {
          const dx = sp.x - tx;
          const weight = Math.exp(-dx * dx * invTwoSigmaSq) * sp.weight;
          sumW += weight;
          sumWX += weight * dx;
          sumWY += weight * sp.y;
          sumWXX += weight * dx * dx;
          sumWXY += weight * dx * sp.y;
        }
        if (sumW <= 0) return null;
        const regLambda = sumW * 900;
        const denom = sumW * (sumWXX + regLambda) - sumWX * sumWX;
        if (Math.abs(denom) <= 1e-5) return { y: sumWY / sumW, slope: 0 };
        return {
          y: ((sumWXX + regLambda) * sumWY - sumWX * sumWXY) / denom,
          // Begrens helning til maks ±0.18 rad (ca. ±10.3 grader)
          slope: Math.max(-0.18, Math.min(0.18, (sumW * sumWXY - sumWX * sumWY) / denom)),
        };
      }

      // Grunnlinjen (underkanten av x-høyden) i vinduer på ca. 4 linjehøyder langs linjen
      function measureBaselineSamples() {
        if (lineWords.length === 0) return [];
        const left = lineWords[0].spanLeft;
        const right = lineWords[lineWords.length - 1].spanRight;
        const span = right - left + 1;
        const winW = Math.max(8, Math.round(bandH * 4));
        const step = Math.max(4, Math.round(bandH * 2));
        const windows = [];
        if (span <= winW * 1.25) {
          windows.push([left, right]);
        } else {
          const n = Math.ceil((span - winW) / step) + 1;
          for (let i = 0; i < n; i++) {
            const wl = Math.round(left + (i * (span - winW)) / (n - 1));
            windows.push([wl, wl + winW - 1]);
          }
        }
        const samples = [];
        for (const [wl, wr] of windows) {
          const band = measureXHeightRange(wl, wr);
          if (!band) continue;
          samples.push({ x: x0 + (wl + wr) * 0.5, y: band.bottom + 1, weight: band.mass });
        }
        if (samples.length < 3) return samples;
        // Forkast vinduer som avviker tydelig fra linjen gjennom de andre (f.eks. et vindu
        // med bare tall, en parentes eller en stor initial)
        const tol = Math.max(3, bandH * 0.1);
        const kept = samples.filter((sp) => {
          const fit = fitLocalLine(samples.filter((o) => o !== sp), sp.x);
          return !fit || Math.abs(sp.y - fit.y) <= tol;
        });
        return kept.length > 0 ? kept : samples;
      }

      // Utklippenes faste referansepunkt («kjernen») ligger en halv typisk x-høyde over
      // grunnlinjen, slik at bokstavene står omtrent like midt i utklippet som før.
      const coreAboveBaseline = medianLineHeight * 0.23;
      const baselineSamples = measureBaselineSamples();

      for (const target of lineWords) {
        const tx = target.x + target.w * 0.5;
        // Skjæringen skal dreie rundt samme kolonne som grunnlinjen ble målt i, også
        // når ordet senere kuttes (bindestrek fjernet) eller utvides.
        target.shearMidC = tx - target.x;
        let fit = baselineSamples.length > 0 ? fitLocalLine(baselineSamples, tx) : null;
        if (fit) {
          target.baselineLocal = fit.y;
          target.yCoreLocal = fit.y - coreAboveBaseline;
          target.localSlope = fit.slope;
          continue;
        }
        // Reserve når grunnlinjen ikke lot seg måle (svært korte linjer, ornamenter):
        // ordenes eget blekktyngdepunkt, glattet langs linjen.
        fit = fitLocalLine(
          lineWords.map((wj) => ({
            x: wj.x + wj.w * 0.5,
            y: wj.rawYCore,
            weight: Math.sqrt(wj.inkMass),
          })),
          tx
        );
        target.yCoreLocal = fit ? fit.y : target.rawYCore;
        target.localSlope = fit && lineWords.length >= 2 ? fit.slope : 0;
      }

      if (state.useDejaggBaseline) {
        const maxWordY = Math.max(y0, y1 - normH);
        for (const wObj of lineWords) {
          const idealTop = Math.round(wObj.yCoreLocal - paddedHalfTop);
          wObj.y = Math.max(y0, Math.min(maxWordY, idealTop));
        }
      }

      // Sjekk om siste ord på linjen ender med en frittstående bindestrek (tre tilfeller):
      // A) Bindestreken ble skilt ut som en egen liten "wordSpan" helt til høyre
      // B) Bindestreken er siste frittstående "charRun" inne i siste ord
      // C) Bindestreken er en frittstående 2D-komponent helt til høyre i siste ord (f.eks. "ty-", "frede-", "gevæ-", "mang-")
      // Bruk siste charRun som faktisk tilhører et beholdt ord (bortfiltrerte støvkorn og
      // maskerte kantstriper etter bindestreken skal ikke skjule den).
      const lastKeptWord = lineWords.length >= 1 ? lineWords[lineWords.length - 1] : null;
      let lastRunIdx = charRuns.length - 1;
      while (lastKeptWord && lastRunIdx >= 0 && charRuns[lastRunIdx].left > lastKeptWord.spanRight) {
        lastRunIdx--;
      }
      if (lineWords.length >= 1 && lastRunIdx >= 0) {
        const lastRun = charRuns[lastRunIdx];
        const prevRun = lastRunIdx >= 1 ? charRuns[lastRunIdx - 1] : null;
        const lastWord = lastKeptWord;

        if (
          lineWords.length >= 2 &&
          prevRun &&
          lastWord.spanLeft === lastRun.left &&
          lastWord.spanRight === lastRun.right &&
          lastRun.left - prevRun.right - 1 <= Math.max(6, baseSpaceThreshold * 1.35) &&
          checkHyphenGeometry(
            lastRun.left,
            lastRun.right,
            lineWords[lineWords.length - 2].spanLeft,
            prevRun.right
          )
        ) {
          // Tilfelle A: Bindestreken ble et eget lite segment rett etter siste ord -> slå sammen med forrige ord!
          const penultimateWord = lineWords[lineWords.length - 2];
          penultimateWord.wWithoutHyphen = penultimateWord.w;
          penultimateWord.w = Math.max(
            penultimateWord.w,
            lastWord.x + lastWord.w - penultimateWord.x
          );
          penultimateWord.hasTrailingHyphen = true;
          penultimateWord.hyphenBox = {
            x0: x0 + lastRun.left - 1,
            x1: x0 + lastRun.right + 1,
            y0: absTop,
            y1: absBottom,
          };
          lineWords.pop();
          allWords.pop();
        } else if (
          prevRun &&
          prevRun.left >= lastWord.spanLeft &&
          checkHyphenGeometry(lastRun.left, lastRun.right, lastWord.spanLeft, prevRun.right)
        ) {
          // Tilfelle B: Bindestreken er siste frittstående charRun inne i siste ord.
          // Gi siste bokstav full +padX (2 px) polstring slik at konturen ved +9 blekkfylde
          // aldri kuttes i kanten, og masker selve bindestrek-boksen til papirfarge!
          const trimmedRight = Math.min(x1 - 1, x0 + prevRun.right + padX);
          lastWord.hasTrailingHyphen = true;
          lastWord.wWithoutHyphen = Math.max(4, trimmedRight - lastWord.x + 1);
          lastWord.hyphenBox = {
            x0: x0 + lastRun.left - 1,
            x1: x0 + lastRun.right + 1,
            y0: absTop,
            y1: absBottom,
          };
        } else {
          // Tilfelle C: 2D sammenhengende komponent helt til høyre i siste ord (tett kernet under/over seriff/løkke)
          const comp = findRightmost2DHyphen(lastWord.spanLeft, lastWord.spanRight);
          if (comp) {
            const trimmedRight = Math.min(x1 - 1, x0 + comp.maxLetterC + padX);
            lastWord.hasTrailingHyphen = true;
            lastWord.wWithoutHyphen = Math.max(4, trimmedRight - lastWord.x + 1);
            lastWord.hyphenBox = {
              x0: x0 + comp.minC - 1,
              x1: x0 + comp.maxC + 1,
              y0: comp.minY - 1,
              y1: comp.maxY + 1,
            };
          }
        }
      }

      if (lineWords.length > 0) {
        const prevBand = lineIdx > 0 ? validBands[lineIdx - 1] : null;
        const gapFromPrev = prevBand ? band.top - prevBand.bottom : 0;

        lines.push({
          lineIndex: lines.length,
          yTop: absTop,
          yBottom: absBottom,
          yCore,
          gapFromPrev,
          leftEdge: lineWords[0].x,
          rightEdge:
            lineWords[lineWords.length - 1].x +
            lineWords[lineWords.length - 1].w,
          isParagraphStart: false,
          hasFirstLineIndent: false,
          words: lineWords,
        });
      }
    });

    // --- STEG C: Fler-signals Avsnittsgjenkjenning & Sammensying av Orddeling ---
    let paragraphCount = 0;
    let hyphenJoinCount = 0;

    if (lines.length > 0) {
      // Finn tekstblokkens typiske venstremarg (20-persentil) og høyremarg (80-persentil)
      const fullLines = lines.filter((l) => l.words.length >= 2);
      const refLines = fullLines.length >= 2 ? fullLines : lines;

      const sortedLefts = refLines.map((l) => l.leftEdge).sort((a, b) => a - b);
      const sortedRights = refLines.map((l) => l.rightEdge).sort((a, b) => a - b);

      const pageLeftMargin =
        sortedLefts[Math.floor(sortedLefts.length * 0.2)] ?? sortedLefts[0];
      const pageRightMargin =
        sortedRights[Math.floor(sortedRights.length * 0.8)] ??
        sortedRights[sortedRights.length - 1];
      const typicalLineSpan = Math.max(80, pageRightMargin - pageLeftMargin);

      // Sjekk om første linje på siden starter med tydelig avsnittsinnrykk
      const firstLineIndent = lines[0].leftEdge - pageLeftMargin;
      if (
        firstLineIndent >= Math.max(11, medianLineHeight * 0.65) &&
        firstLineIndent <= typicalLineSpan * 0.42
      ) {
        lines[0].hasFirstLineIndent = true;
        paragraphCount++;
      }

      for (let i = 1; i < lines.length; i++) {
        const curr = lines[i];
        const prev = lines[i - 1];

        // Signal 1: Ekstra vertikal linjeavstand (moderne sats / luft mellom avsnitt)
        const hasVerticalGap =
          curr.gapFromPrev >
          Math.max(medianLineGap * 1.48, medianLineHeight * 0.46);

        // Signal 2: Første-linjes innrykk på nåværende linje (klassisk boksats som i Sult / Skram)
        const indentPx = curr.leftEdge - pageLeftMargin;
        const hasIndent =
          indentPx >= Math.max(11, medianLineHeight * 0.65) &&
          indentPx <= typicalLineSpan * 0.45;

        // Signal 3: Foregående linje sluttet tydelig før høyremargen (kort sluttlinje i avsnitt)
        const prevShortfall = pageRightMargin - prev.rightEdge;
        const prevEndedEarly =
          prevShortfall >= Math.max(24, typicalLineSpan * 0.14);

        if (hasVerticalGap || hasIndent || prevEndedEarly) {
          curr.isParagraphStart = true;
          curr.hasFirstLineIndent = hasIndent || prevEndedEarly;
          paragraphCount++;
        }
      }

      // Par sammen orddeling ved linjeslutt (bok- på linje i + bad på linje i+1 -> bokbad)
      if (state.mergeHyphens) {
        for (let i = 0; i < lines.length - 1; i++) {
          const curr = lines[i];
          const next = lines[i + 1];
          const lastWord = curr.words[curr.words.length - 1];
          const firstNextWord = next.words[0];

          if (
            lastWord &&
            firstNextWord &&
            lastWord.hasTrailingHyphen &&
            !next.isParagraphStart &&
            curr.rightEdge >= pageRightMargin - typicalLineSpan * 0.28
          ) {
            lastWord.joinWithNextWord = firstNextWord;
            firstNextWord.joinedToPrevWord = lastWord;
            hyphenJoinCount++;
          }
        }
      }
    }

    state.detectedParagraphCount = paragraphCount;
    state.detectedHyphenJoinCount = hyphenJoinCount;
    state.detectedLines = lines;
    state.detectedWords = allWords;

    drawOverlayBoxes();
    renderLiquidWords(inkThreshold);
    updateStatsBar();
  }

  function computeMedian(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // =========================================================================
  // 4. TEGNING AV DETEKTERTE ORDBOKSER & UTSNITT PÅ OVERLAY-CANVAS
  // =========================================================================

  function drawOverlayBoxes(activeDragRect = null) {
    const w = overlayCanvas.width;
    const h = overlayCanvas.height;
    overlayCtx.clearRect(0, 0, w, h);

    const crop = activeDragRect || state.cropRect;

    // Hvis brukeren har valgt et utsnitt, mørklegg utsiden av utsnittet
    if (crop) {
      overlayCtx.save();
      overlayCtx.fillStyle = "rgba(15, 23, 42, 0.42)";
      overlayCtx.fillRect(0, 0, w, crop.y);
      overlayCtx.fillRect(0, crop.y + crop.h, w, h - (crop.y + crop.h));
      overlayCtx.fillRect(0, crop.y, crop.x, crop.h);
      overlayCtx.fillRect(
        crop.x + crop.w,
        crop.y,
        w - (crop.x + crop.w),
        crop.h
      );

      overlayCtx.strokeStyle = "#2563eb";
      overlayCtx.lineWidth = 2.5;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      overlayCtx.setLineDash([]);

      // Tegn 8 tydelige dra-håndtak (4 hjørner + 4 sidekanter) slik at brukeren
      // enkelt kan dra venstre/høyre/øvre/nedre kant ut eller inn!
      const handlePts = [
        { x: crop.x, y: crop.y },
        { x: crop.x + crop.w * 0.5, y: crop.y },
        { x: crop.x + crop.w, y: crop.y },
        { x: crop.x + crop.w, y: crop.y + crop.h * 0.5 },
        { x: crop.x + crop.w, y: crop.y + crop.h },
        { x: crop.x + crop.w * 0.5, y: crop.y + crop.h },
        { x: crop.x, y: crop.y + crop.h },
        { x: crop.x, y: crop.y + crop.h * 0.5 },
      ];
      const hs = Math.max(8, Math.round(Math.min(w, h) * 0.013));
      overlayCtx.fillStyle = "#ffffff";
      overlayCtx.strokeStyle = "#1d4ed8";
      overlayCtx.lineWidth = 2.5;
      for (const hp of handlePts) {
        overlayCtx.fillRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
        overlayCtx.strokeRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
      }
      overlayCtx.restore();
    }

    if (!showBoxesToggle.checked && !state.hoveredWordId) return;

    overlayCtx.save();
    for (const word of state.detectedWords) {
      const isHovered = word.id === state.hoveredWordId;
      if (!showBoxesToggle.checked && !isHovered) continue;

      if (isHovered) {
        overlayCtx.fillStyle = "rgba(245, 158, 11, 0.28)";
        overlayCtx.strokeStyle = "#d97706";
        overlayCtx.lineWidth = 2.5;
        overlayCtx.fillRect(word.x, word.tightY, word.w, word.tightH);
        overlayCtx.strokeRect(word.x, word.tightY, word.w, word.tightH);
      } else {
        overlayCtx.strokeStyle = "rgba(29, 78, 216, 0.48)";
        overlayCtx.lineWidth = 1;
        overlayCtx.strokeRect(word.x, word.tightY, word.w, word.tightH);
      }
    }

    // Tegn den tilpassede lokale grunnlinjekurven (De-jagg) tvers over hver linje
    if (showBoxesToggle.checked && state.useDejaggBaseline && state.detectedLines) {
      overlayCtx.strokeStyle = "rgba(217, 119, 6, 0.72)";
      overlayCtx.lineWidth = 1.5;
      overlayCtx.setLineDash([4, 3]);
      for (const line of state.detectedLines) {
        if (!line.words || line.words.length === 0) continue;
        overlayCtx.beginPath();
        for (let i = 0; i < line.words.length; i++) {
          const lw = line.words[i];
          const cx = lw.x + lw.w * 0.5;
          const cy = lw.baselineLocal ?? lw.yCoreLocal ?? line.yCore;
          if (i === 0) {
            overlayCtx.moveTo(lw.x, cy - (lw.w * 0.5) * (lw.localSlope || 0));
            overlayCtx.lineTo(cx, cy);
          } else {
            overlayCtx.lineTo(cx, cy);
          }
          if (i === line.words.length - 1) {
            overlayCtx.lineTo(lw.x + lw.w, cy + (lw.w * 0.5) * (lw.localSlope || 0));
          }
        }
        overlayCtx.stroke();
      }
      overlayCtx.setLineDash([]);
    }
    overlayCtx.restore();
  }

  // =========================================================================
  // 5. RENDERING AV ORD-PIKSLER & VEKTOR-TRACING I LIQUID MODE
  // =========================================================================

  /**
   * Henter en myknet (eller rå) gråtone-matrise (Float32Array) for et enkelt ord,
   * inkludert vertikal skjæring (vertical shear / De-jagg) basert på ordets lokale
   * helning langs linjen slik at skjeve/krumme ord rettes opp til 0 grader.
   */
  function extractWordScalarField(word, preblurRadius) {
    const fullW = sourceCanvas.width;
    const fullH = sourceCanvas.height;
    const gray = state.gray;
    const w = word.w;
    const h = word.h;

    const raw = new Float32Array(w * h);
    const slope = state.useDejaggBaseline ? (word.localSlope || 0) : 0;
    const paperFallback = state.paperMedianLum || 235;
    const maskHyphen =
      word.joinWithNextWord &&
      word.hyphenBox &&
      word.w === word.wWithoutHyphen
        ? word.hyphenBox
        : null;

    if (Math.abs(slope) > 0.002) {
      const midC = word.shearMidC ?? (w - 1) * 0.5;
      for (let c = 0; c < w; c++) {
        const absX = word.x + c;
        const dy = (c - midC) * slope;
        for (let r = 0; r < h; r++) {
          const sy = word.y + r + dy;
          if (
            maskHyphen &&
            absX >= maskHyphen.x0 &&
            absX <= maskHyphen.x1 &&
            sy >= maskHyphen.y0 &&
            sy <= maskHyphen.y1
          ) {
            raw[r * w + c] = paperFallback;
            continue;
          }
          const yFloor = Math.floor(sy);
          const ty = sy - yFloor;
          if (yFloor >= 0 && yFloor + 1 < fullH) {
            const v0 = gray[yFloor * fullW + absX];
            const v1 = gray[(yFloor + 1) * fullW + absX];
            raw[r * w + c] = v0 + (v1 - v0) * ty;
          } else if (yFloor >= 0 && yFloor < fullH) {
            raw[r * w + c] = gray[yFloor * fullW + absX];
          } else {
            raw[r * w + c] = paperFallback;
          }
        }
      }
    } else {
      for (let r = 0; r < h; r++) {
        const absY = word.y + r;
        const srcRow = absY * fullW + word.x;
        const dstRow = r * w;
        for (let c = 0; c < w; c++) {
          const absX = word.x + c;
          if (
            maskHyphen &&
            absX >= maskHyphen.x0 &&
            absX <= maskHyphen.x1 &&
            absY >= maskHyphen.y0 &&
            absY <= maskHyphen.y1
          ) {
            raw[dstRow + c] = paperFallback;
          } else {
            raw[dstRow + c] = gray[srcRow + c];
          }
        }
      }
    }

    if (preblurRadius <= 0.01) {
      return raw;
    }

    // Separabel 3x3 Gaussisk-lignende kjerne med valgfri styrke (0.5 .. 2.0)
    const alpha = Math.min(0.45, preblurRadius * 0.22);
    const center = 1 - 2 * alpha;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);

    // Horisontalt pass
    for (let r = 0; r < h; r++) {
      const row = r * w;
      for (let c = 0; c < w; c++) {
        const left = raw[row + Math.max(0, c - 1)];
        const mid = raw[row + c];
        const right = raw[row + Math.min(w - 1, c + 1)];
        tmp[row + c] = left * alpha + mid * center + right * alpha;
      }
    }

    // Vertikalt pass
    for (let r = 0; r < h; r++) {
      const row = r * w;
      const topRow = Math.max(0, r - 1) * w;
      const botRow = Math.min(h - 1, r + 1) * w;
      for (let c = 0; c < w; c++) {
        out[row + c] =
          tmp[topRow + c] * alpha + tmp[row + c] * center + tmp[botRow + c] * alpha;
      }
    }

    return out;
  }

  /**
   * Bicubic (Catmull-Rom) oppslag i ordets gråtonefelt for sub-piksel Super-Res (3x).
   */
  function sampleBicubic(field, w, h, fx, fy) {
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;

    function cubicHermite(A, B, C, D, t) {
      const a = -A / 2.0 + (3.0 * B) / 2.0 - (3.0 * C) / 2.0 + D / 2.0;
      const b = A - (5.0 * B) / 2.0 + 2.0 * C - D / 2.0;
      const c = -A / 2.0 + C / 2.0;
      const d = B;
      return ((a * t + b) * t + c) * t + d;
    }

    function getClamped(x, y) {
      const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
      const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
      return field[cy * w + cx];
    }

    const col0 = cubicHermite(
      getClamped(ix - 1, iy - 1),
      getClamped(ix, iy - 1),
      getClamped(ix + 1, iy - 1),
      getClamped(ix + 2, iy - 1),
      tx
    );
    const col1 = cubicHermite(
      getClamped(ix - 1, iy),
      getClamped(ix, iy),
      getClamped(ix + 1, iy),
      getClamped(ix + 2, iy),
      tx
    );
    const col2 = cubicHermite(
      getClamped(ix - 1, iy + 1),
      getClamped(ix, iy + 1),
      getClamped(ix + 1, iy + 1),
      getClamped(ix + 2, iy + 1),
      tx
    );
    const col3 = cubicHermite(
      getClamped(ix - 1, iy + 2),
      getClamped(ix, iy + 2),
      getClamped(ix + 1, iy + 2),
      getClamped(ix + 2, iy + 2),
      tx
    );

    return cubicHermite(col0, col1, col2, col3, ty);
  }

  /**
   * Sub-piksel Marching Squares som finner lukkede iso-kontur-løkker rundt
   * alle bokstaver (inkludert indre hull i 'o', 'e', 'a', 'g', 'd', 'b')
   * og glatter dem med Chaikin corner-cutting.
   */
  function traceMarchingSquaresPolylines(field, w, h, isoLevel, chaikinSteps) {
    // Lag et (w+2) x (h+2) polstret rutenett med papir-verdi (255) ytterst
    // slik at konturer ved kanten av utsnittet alltid danner lukkede ringer.
    const pw = w + 2;
    const ph = h + 2;
    const grid = new Float32Array(pw * ph);
    grid.fill(255);

    for (let r = 0; r < h; r++) {
      const srcRow = r * w;
      const dstRow = (r + 1) * pw + 1;
      for (let c = 0; c < w; c++) {
        grid[dstRow + c] = field[srcRow + c];
      }
    }

    // Hjelpefunksjon for lineær sub-piksel-interpolasjon langs en cellekant
    function interp(v1, v2) {
      const denom = v2 - v1;
      if (Math.abs(denom) < 1e-5) return 0.5;
      return Math.max(0.05, Math.min(0.95, (isoLevel - v1) / denom));
    }

    // Vi samler orienterte kant-segmenter der blekk (v < isoLevel) alltid ligger
    // på innsiden, og syr dem sammen til lukkede polygon-ringer via en romlig nøkkel.
    const segments = [];

    for (let r = 0; r < ph - 1; r++) {
      const row0 = r * pw;
      const row1 = (r + 1) * pw;
      for (let c = 0; c < pw - 1; c++) {
        const vTL = grid[row0 + c];
        const vTR = grid[row0 + c + 1];
        const vBR = grid[row1 + c + 1];
        const vBL = grid[row1 + c];

        // Bitmaske: 1=TL, 2=TR, 4=BR, 8=BL (1 betyr blekk / mørkere enn isoLevel)
        let mask = 0;
        if (vTL < isoLevel) mask |= 1;
        if (vTR < isoLevel) mask |= 2;
        if (vBR < isoLevel) mask |= 4;
        if (vBL < isoLevel) mask |= 8;

        if (mask === 0 || mask === 15) continue;

        // Koordinater i ordets eget koordinatsystem (trekker fra 0.5 pga. 1px padding)
        const x = c - 0.5;
        const y = r - 0.5;

        const topPt = () => ({ x: x + interp(vTL, vTR), y });
        const rightPt = () => ({ x: x + 1, y: y + interp(vTR, vBR) });
        const bottomPt = () => ({ x: x + interp(vBL, vBR), y: y + 1 });
        const leftPt = () => ({ x, y: y + interp(vTL, vBL) });

        switch (mask) {
          case 1:
            segments.push([leftPt(), topPt()]);
            break;
          case 2:
            segments.push([topPt(), rightPt()]);
            break;
          case 3:
            segments.push([leftPt(), rightPt()]);
            break;
          case 4:
            segments.push([rightPt(), bottomPt()]);
            break;
          case 5: {
            const centerVal = 0.25 * (vTL + vTR + vBR + vBL);
            if (centerVal < isoLevel) {
              segments.push([leftPt(), bottomPt()], [rightPt(), topPt()]);
            } else {
              segments.push([leftPt(), topPt()], [rightPt(), bottomPt()]);
            }
            break;
          }
          case 6:
            segments.push([topPt(), bottomPt()]);
            break;
          case 7:
            segments.push([leftPt(), bottomPt()]);
            break;
          case 8:
            segments.push([bottomPt(), leftPt()]);
            break;
          case 9:
            segments.push([bottomPt(), topPt()]);
            break;
          case 10: {
            const centerVal = 0.25 * (vTL + vTR + vBR + vBL);
            if (centerVal < isoLevel) {
              segments.push([topPt(), leftPt()], [bottomPt(), rightPt()]);
            } else {
              segments.push([topPt(), rightPt()], [bottomPt(), leftPt()]);
            }
            break;
          }
          case 11:
            segments.push([bottomPt(), rightPt()]);
            break;
          case 12:
            segments.push([rightPt(), leftPt()]);
            break;
          case 13:
            segments.push([rightPt(), topPt()]);
            break;
          case 14:
            segments.push([topPt(), leftPt()]);
            break;
        }
      }
    }

      if ( segments.length > 3600 ) {
        // Sikring mot tunge vignettsiegel / illustrasjoner med tusenvis av mikrokonturer:
        // reduser glatting til maks 1 steg så siden aldri fryser
        chaikinSteps = Math.min(1, chaikinSteps);
      }
      if (segments.length > 9000) {
        return [];
      }

    // Sy sammen segmentene til sammenhengende lukkede konturer
    const keyOf = (pt) => `${Math.round(pt.x * 1000)},${Math.round(pt.y * 1000)}`;
    const startMap = new Map();
    segments.forEach((seg, idx) => {
      const k = keyOf(seg[0]);
      if (!startMap.has(k)) startMap.set(k, []);
      startMap.get(k).push(idx);
    });

    const used = new Uint8Array(segments.length);
    const loops = [];

    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const ring = [segments[i][0], segments[i][1]];
      let currEnd = segments[i][1];

      for (let step = 0; step < 4096; step++) {
        const k = keyOf(currEnd);
        const candidates = startMap.get(k);
        if (!candidates) break;
        const nextIdx = candidates.find((cIdx) => !used[cIdx]);
        if (nextIdx === undefined) break;
        used[nextIdx] = 1;
        currEnd = segments[nextIdx][1];
        ring.push(currEnd);
      }

      if (ring.length >= 4) {
        loops.push(chaikinSmoothClosedLoop(ring, chaikinSteps));
      }
    }

    return loops;
  }

  /**
   * Chaikin corner-cutting på en lukket kontur-løkke.
   * Forvandler trappetrinn-hjørner til jevne kurver samtidig som lukkede former bevares.
   */
  function chaikinSmoothClosedLoop(points, iterations) {
    let pts = points;
    for (let it = 0; it < iterations; it++) {
      const n = pts.length;
      if (n < 4) break;
      const next = [];
      for (let i = 0; i < n; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % n];
        next.push(
          { x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y },
          { x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y }
        );
      }
      pts = next;
    }
    return pts;
  }

  /**
   * Tegner et enkelt ord på målet sitt <canvas> med valgt renderMode og traceMode.
   */
  function drawWordTokenCanvas(wCanvas, word, baseInkThreshold, overrideTraceMode = null, overrideScale = null) {
    const mode = state.renderMode;
    const tMode = overrideTraceMode || state.traceMode;
    // La aldri effektiv terskel (inkl. blekkfylde-offset) krysse opp i selve papirfargen!
    const maxSafeForPaper = Math.max(60, (state.paperMedianLum || 220) - 22);
    const effectiveThreshold = Math.max(
      15,
      Math.min(maxSafeForPaper, baseInkThreshold + state.strokeOffset)
    );

    const wCtx = wCanvas.getContext("2d");

    // 1. Originalt papir (viser alltid det ekte foto-utklippet, men unntatt i wireframe-debug)
    if (mode === "paper" && tMode !== "wireframe" && !overrideTraceMode) {
      wCanvas.width = word.w;
      wCanvas.height = word.h;
      const slope = state.useDejaggBaseline ? (word.localSlope || 0) : 0;
      if (Math.abs(slope) > 0.003) {
        const midC = word.shearMidC ?? (word.w - 1) * 0.5;
        wCtx.fillStyle = state.sampledPaperHex || "#f8f4e8";
        wCtx.fillRect(0, 0, word.w, word.h);
        for (let c = 0; c < word.w; c += 2) {
          const sliceW = Math.min(2, word.w - c);
          const dy = ((c + sliceW * 0.5) - midC) * slope;
          wCtx.drawImage(
            sourceCanvas,
            word.x + c,
            word.y + dy,
            sliceW,
            word.h,
            c,
            0,
            sliceW,
            word.h
          );
        }
      } else {
        wCtx.drawImage(
          sourceCanvas,
          word.x,
          word.y,
          word.w,
          word.h,
          0,
          0,
          word.w,
          word.h
        );
      }
      return;
    }

    const fgColor =
      mode === "dark" ? "rgb(244, 241, 232)" : "rgb(15, 23, 42)";
    const fgRgb = mode === "dark" ? [244, 241, 232] : [15, 23, 42];

    // 2. Rå 1x piksler
    if (tMode === "raw") {
      wCanvas.width = word.w;
      wCanvas.height = word.h;
      const field = extractWordScalarField(word, 0);
      const outImg = wCtx.createImageData(word.w, word.h);
      const dst = outImg.data;
      const softBand = 26;

      for (let i = 0; i < field.length; i++) {
        const lum = field[i];
        const rawAlpha = (effectiveThreshold + softBand * 0.5 - lum) / softBand;
        const inkAlpha = Math.max(0, Math.min(1, rawAlpha));
        const dIdx = i * 4;
        dst[dIdx] = fgRgb[0];
        dst[dIdx + 1] = fgRgb[1];
        dst[dIdx + 2] = fgRgb[2];
        dst[dIdx + 3] = Math.round(inkAlpha * 255);
      }
      wCtx.putImageData(outImg, 0, 0);
      return;
    }

    // 3. Sub-piksel Super-Res (3x Bicubic + skarp iso-kontur)
    if (tMode === "superres") {
      const upScale = overrideScale || 3;
      const outW = word.w * upScale;
      const outH = word.h * upScale;
      wCanvas.width = outW;
      wCanvas.height = outH;

      const field = extractWordScalarField(word, state.preblurRadius);
      const outImg = wCtx.createImageData(outW, outH);
      const dst = outImg.data;
      // Smalere overgangsbånd i 3x gir mye skarpere, glattere bokstavkanter uten trappetrinn!
      const softBand = 14;

      for (let r = 0; r < outH; r++) {
        const fy = (r + 0.5) / upScale - 0.5;
        const rowOffset = r * outW;
        for (let c = 0; c < outW; c++) {
          const fx = (c + 0.5) / upScale - 0.5;
          const lum = sampleBicubic(field, word.w, word.h, fx, fy);
          const rawAlpha = (effectiveThreshold + softBand * 0.5 - lum) / softBand;
          const inkAlpha = Math.max(0, Math.min(1, rawAlpha));
          const dIdx = (rowOffset + c) * 4;
          dst[dIdx] = fgRgb[0];
          dst[dIdx + 1] = fgRgb[1];
          dst[dIdx + 2] = fgRgb[2];
          dst[dIdx + 3] = Math.round(inkAlpha * 255);
        }
      }
      wCtx.putImageData(outImg, 0, 0);
      return;
    }

    // 4. Vektor-kontur (Marching Squares) eller 5. Vektor-trådramme (Debug)
    const vecScale = overrideScale || 4;
    const outW = word.w * vecScale;
    const outH = word.h * vecScale;
    wCanvas.width = outW;
    wCanvas.height = outH;

    const field = extractWordScalarField(word, state.preblurRadius);
    const loops = traceMarchingSquaresPolylines(
      field,
      word.w,
      word.h,
      effectiveThreshold,
      state.smoothIterations
    );

    wCtx.clearRect(0, 0, outW, outH);

    if (tMode === "wireframe") {
      // Tegn svakt pikselert original i bakgrunnen så brukeren ser hvordan kurvene følger bokstaven
      wCtx.save();
      wCtx.imageSmoothingEnabled = false;
      wCtx.globalAlpha = 0.32;
      wCtx.drawImage(
        sourceCanvas,
        word.x,
        word.y,
        word.w,
        word.h,
        0,
        0,
        outW,
        outH
      );
      wCtx.restore();
    }

    wCtx.save();
    wCtx.scale(vecScale, vecScale);
    wCtx.beginPath();

    for (const ring of loops) {
      if (ring.length < 3) continue;
      wCtx.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) {
        wCtx.lineTo(ring[i].x, ring[i].y);
      }
      wCtx.closePath();
    }

    if (tMode === "vector") {
      // evenodd-regelen sørger for at indre hull i 'o', 'e', 'a', 'b', 'd', 'g' automatisk stanses ut!
      wCtx.fillStyle = fgColor;
      wCtx.fill("evenodd");
    } else {
      // Wireframe Debug: Fyll lett + tegn skarpe vektor-linjer og kontrollpunkter
      wCtx.fillStyle = "rgba(37, 99, 235, 0.22)";
      wCtx.fill("evenodd");
      wCtx.lineWidth = 0.35;
      wCtx.strokeStyle = "#e11d48";
      wCtx.stroke();

      // Tegn knutepunktene langs kurven
      wCtx.fillStyle = "#1d4ed8";
      for (const ring of loops) {
        for (let i = 0; i < ring.length; i += 2) {
          wCtx.fillRect(ring[i].x - 0.16, ring[i].y - 0.16, 0.32, 0.32);
        }
      }
    }
    wCtx.restore();
  }

  /**
   * Oppdaterer den 3-delte forstørrelseslupen (Original 1x vs. Tracet vs. Marching Squares Wireframe)
   * for valgt ord slik at brukeren kan finstudere kantglattingen.
   */
  function updateWordLoupe(word, baseInkThreshold) {
    if (!word || !toggleLoupe.checked) {
      wordLoupePanel.setAttribute("hidden", "");
      return;
    }

    wordLoupePanel.removeAttribute("hidden");
    const displayZoom = 4.5;
    const cssW = `${Math.round(word.w * displayZoom)}px`;
    const cssH = `${Math.round(word.h * displayZoom)}px`;

    // 1. Original 1x piksler (med image-rendering: pixelated)
    drawWordTokenCanvas(loupeRawCanvas, word, baseInkThreshold, "raw", 1);
    loupeRawCanvas.style.width = cssW;
    loupeRawCanvas.style.height = cssH;
    loupeRawCanvas.style.imageRendering = "pixelated";

    // 2. Aktivt tracet/glattet resultat
    const activeAlgo =
      state.traceMode === "raw" ? "superres" : state.traceMode;
    loupeTracedTitle.textContent =
      activeAlgo === "superres"
        ? "Sub-piksel Super-Res (3×)"
        : "Marching Squares Vektor-fyll";
    drawWordTokenCanvas(
      loupeTracedCanvas,
      word,
      baseInkThreshold,
      activeAlgo === "wireframe" ? "vector" : activeAlgo,
      5
    );
    loupeTracedCanvas.style.width = cssW;
    loupeTracedCanvas.style.height = cssH;

    // 3. Marching Squares Vektor-trådramme oppå 1x piksler
    drawWordTokenCanvas(loupeWireCanvas, word, baseInkThreshold, "wireframe", 5);
    loupeWireCanvas.style.width = cssW;
    loupeWireCanvas.style.height = cssH;
  }

  function renderLiquidWords(inkThreshold) {
    const t0 = performance.now();
    liquidReader.innerHTML = "";
    liquidReader.className = `liquid-reader mode-${state.renderMode}`;
    updateReaderSpacingVariables();

    if (state.detectedWords.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state-msg";
      empty.textContent =
        "Ingen tydelige ord funnet i utsnittet. Prøv å justere Blekk-terskel eller velg et annet område.";
      liquidReader.appendChild(empty);
      tracePerfPill.textContent = "0 ms";
      return;
    }

    const fragment = document.createDocumentFragment();
    const lineMetrics = [];

    state.detectedLines.forEach((line, lineIdx) => {
      if (line.isParagraphStart) {
        const br = document.createElement("div");
        br.className = "liquid-paragraph-break";
        br.setAttribute("aria-hidden", "true");
        fragment.appendChild(br);
      } else if (lineIdx > 0) {
        // Mykt linjeskift mellom originale boklinjer (aktivt når original linjebredde får plass på skjermen)
        const lbr = document.createElement("div");
        lbr.className = "liquid-line-break";
        lbr.setAttribute("aria-hidden", "true");
        fragment.appendChild(lbr);
      }

      let wordWidthSum = 0;
      for (const word of line.words) {
        wordWidthSum += word.w;
      }
      if (line.words.length >= 3) {
        lineMetrics.push({
          wordSum: wordWidthSum,
          count: line.words.length,
        });
      }

      for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
        const word = line.words[wIdx];
        const token = document.createElement("span");
        token.className = "word-token";
        if (wIdx === 0 && line.hasFirstLineIndent) {
          token.classList.add("paragraph-indent-token");
        }
        if (word.joinWithNextWord) {
          token.classList.add("hyphen-orig-part");
        }
        if (word.joinedToPrevWord) {
          token.classList.add("hyphen-orig-next-part");
        }
        if (state.selectedWord && state.selectedWord.id === word.id) {
          token.classList.add("active-word");
        }
        token.dataset.wordId = String(word.id);
        token.title = `Linje ${line.lineIndex + 1}, ord #${word.id} — Klikk for å inspisere i lupe`;

        const wCanvas = document.createElement("canvas");
        wCanvas.dataset.origW = String(word.w);
        wCanvas.dataset.origH = String(word.h);
        wCanvas.style.width = `${Math.round(word.w * state.scaleFactor)}px`;
        wCanvas.style.height = `${Math.round(word.h * state.scaleFactor)}px`;

        drawWordTokenCanvas(wCanvas, word, inkThreshold);

        // Koble hover/trykk på ordet i Liquid-leseren til markering i originalbildet + lupe
        token.addEventListener("pointerenter", () => {
          state.hoveredWordId = word.id;
          drawOverlayBoxes();
        });
        token.addEventListener("pointerleave", () => {
          if (state.hoveredWordId === word.id) {
            state.hoveredWordId = null;
            drawOverlayBoxes();
          }
        });
        token.addEventListener("click", () => {
          document
            .querySelectorAll(".word-token.active-word")
            .forEach((el) => el.classList.remove("active-word"));
          token.classList.add("active-word");
          state.hoveredWordId = word.id;
          state.selectedWord = word;
          drawOverlayBoxes();
          updateWordLoupe(word, inkThreshold);
        });

        token.appendChild(wCanvas);
        fragment.appendChild(token);

        // Hvis dette ordet slutter med bindestrek (f.eks. "bok-") og skal limes sammen
        // med første ord på neste linje ("bad") i kontinuerlig Liquid-flyt -> lag sammensydd "bokbad"-token!
        if (word.joinWithNextWord) {
          const nextWord = word.joinWithNextWord;
          const mergedToken = document.createElement("span");
          mergedToken.className = "word-token hyphen-merged-token";
          if (wIdx === 0 && line.hasFirstLineIndent) {
            mergedToken.classList.add("paragraph-indent-token");
          }
          mergedToken.dataset.wordId = String(word.id);
          mergedToken.title = `Sammensydd orddeling (linje ${line.lineIndex + 1} + ${line.lineIndex + 2})`;

          // Første del uten bindestrek ("bok")
          const trimmedWordA = {
            ...word,
            w: Math.max(3, word.wWithoutHyphen || word.w),
          };
          const canvasA = document.createElement("canvas");
          canvasA.dataset.origW = String(trimmedWordA.w);
          canvasA.dataset.origH = String(trimmedWordA.h);
          canvasA.style.width = `${Math.round(trimmedWordA.w * state.scaleFactor)}px`;
          canvasA.style.height = `${Math.round(trimmedWordA.h * state.scaleFactor)}px`;
          drawWordTokenCanvas(canvasA, trimmedWordA, inkThreshold);

          // Andre del fra starten av neste linje ("bad")
          const canvasB = document.createElement("canvas");
          canvasB.dataset.origW = String(nextWord.w);
          canvasB.dataset.origH = String(nextWord.h);
          canvasB.style.width = `${Math.round(nextWord.w * state.scaleFactor)}px`;
          canvasB.style.height = `${Math.round(nextWord.h * state.scaleFactor)}px`;
          drawWordTokenCanvas(canvasB, nextWord, inkThreshold);

          mergedToken.addEventListener("pointerenter", () => {
            state.hoveredWordId = word.id;
            drawOverlayBoxes();
          });
          mergedToken.addEventListener("pointerleave", () => {
            if (state.hoveredWordId === word.id) {
              state.hoveredWordId = null;
              drawOverlayBoxes();
            }
          });
          mergedToken.addEventListener("click", () => {
            document
              .querySelectorAll(".word-token.active-word")
              .forEach((el) => el.classList.remove("active-word"));
            mergedToken.classList.add("active-word");
            state.hoveredWordId = word.id;
            state.selectedWord = word;
            drawOverlayBoxes();
            updateWordLoupe(word, inkThreshold);
          });

          mergedToken.appendChild(canvasA);
          mergedToken.appendChild(canvasB);
          fragment.appendChild(mergedToken);
        }
      }
    });

    // Beregn 85-persentil linjebredde (en typisk full tekstlinje i originalboken)
    if (lineMetrics.length > 0) {
      lineMetrics.sort((a, b) => a.wordSum - b.wordSum);
      const p85Idx = Math.min(
        lineMetrics.length - 1,
        Math.floor(lineMetrics.length * 0.85)
      );
      state.baseNaturalLineWordSum = lineMetrics[p85Idx].wordSum;
      state.baseNaturalLineWordCount = Math.max(2, lineMetrics[p85Idx].count);
    }

    liquidReader.appendChild(fragment);
    evaluateSmartLineFlow();

    // Velg første ord med litt lengde som standard i lupen hvis ingen er valgt ennå
    if (!state.selectedWord && state.detectedWords.length > 0) {
      state.selectedWord =
        state.detectedWords.find((w) => w.w >= 26) || state.detectedWords[0];
    } else if (state.selectedWord) {
      state.selectedWord =
        state.detectedWords.find((w) => w.id === state.selectedWord.id) ||
        state.detectedWords.find((w) => w.w >= 26) ||
        state.detectedWords[0];
    }
    updateWordLoupe(state.selectedWord, inkThreshold);

    const elapsedMs = Math.round(performance.now() - t0);
    tracePerfPill.textContent = `${elapsedMs} ms (${state.detectedWords.length} ord)`;
  }

  /**
   * Oppdaterer kun CSS-dimensjoner når brukeren drar i Forstørring eller Linjeavstand
   * (0 ms forsinkelse, trenger ikke kjøre bildeanalyse på nytt!).
   */
  function applyScaleWithoutResegmenting() {
    const canvases = liquidReader.querySelectorAll(".word-token canvas");
    canvases.forEach((c) => {
      const origW = Number(c.dataset.origW);
      const origH = Number(c.dataset.origH);
      c.style.width = `${Math.round(origW * state.scaleFactor)}px`;
      c.style.height = `${Math.round(origH * state.scaleFactor)}px`;
    });
    updateReaderSpacingVariables();
  }

  function updateReaderSpacingVariables() {
    const wordGapPx = Math.round(8 * state.scaleFactor);
    const lineGapPx = Math.round(
      10 * state.scaleFactor * (state.lineGapMultiplier - 0.85)
    );
    liquidReader.style.setProperty("--liquid-word-gap", `${wordGapPx}px`);
    liquidReader.style.setProperty(
      "--liquid-line-gap",
      `${Math.max(4, lineGapPx)}px`
    );
    evaluateSmartLineFlow();
  }

  /**
   * Smart linjebryting:
   * - I "auto"-modus måler vi bredden til en full original boklinje ved nåværende skala.
   * - Hvis den originale linjebredden får plass inne i leseflaten (f.eks. på Mac ved vanlig zoom),
   *   beholder vi bokens originale linjeskift og linjelengde (preserve-original-lines),
   *   slik at ord fra linjen under ikke trekkes opp!
   * - Så snart du forstørrer (med Cmd-+ eller slider) eller leser på en smal mobilskjerm
   *   slik at originallinjen ville blitt brutt på midten, glir den sømløst over i
   *   kontinuerlig Liquid-flyt (continuous-liquid-flow)!
   */
  function evaluateSmartLineFlow() {
    if (!liquidReader) return;
    const wordGapPx = Math.round(8 * state.scaleFactor);
    const naturalLinePx = Math.round(
      state.baseNaturalLineWordSum * state.scaleFactor +
        Math.max(0, state.baseNaturalLineWordCount - 1) * wordGapPx +
        14
    );

    liquidReader.style.setProperty("--natural-column-width", `${naturalLinePx}px`);

    const readerWidth = liquidReader.clientWidth || window.innerWidth;
    const minSidePadding = 44; // Minste samlede venstre+høyre marg
    const availableWidth = Math.max(180, readerWidth - minSidePadding);

    let keepOriginalLines = false;
    if (state.flowMode === "lines") {
      keepOriginalLines = true;
    } else if (state.flowMode === "liquid") {
      keepOriginalLines = false;
    } else {
      // "auto": Behold original linjelengde når hele boklinjen får plass i vinduet!
      keepOriginalLines = naturalLinePx <= availableWidth;
    }

    liquidReader.classList.toggle("preserve-original-lines", keepOriginalLines);
    liquidReader.classList.toggle("continuous-liquid-flow", !keepOriginalLines);
  }

  if (typeof ResizeObserver !== "undefined" && liquidReader) {
    const ro = new ResizeObserver(() => {
      evaluateSmartLineFlow();
    });
    ro.observe(liquidReader);
  } else {
    window.addEventListener("resize", () => evaluateSmartLineFlow());
  }

  function updateStatsBar() {
    const lineCount = state.detectedLines.length;
    const wordCount = state.detectedWords.length;
    const cropLabel = state.cropRect
      ? `Utsnitt (${Math.round(state.cropRect.w)}×${Math.round(state.cropRect.h)} px)`
      : `Hele siden (${sourceCanvas.width}×${sourceCanvas.height} px)`;

    statsBar.innerHTML = `
      <span class="stat-chip">📏 ${cropLabel}</span>
      <span class="stat-chip">☰ ${lineCount} tekstlinjer</span>
      <span class="stat-chip">🔤 ${wordCount} ord</span>
      <span class="stat-chip">¶ ${state.detectedParagraphCount} avsnitt</span>
      <span class="stat-chip">🔗 ${state.detectedHyphenJoinCount} sammensydde orddelinger</span>
    `;
    updateZenPageLabel();
  }

  // =========================================================================
  // 6. INTERAKTIV UTSNITTSMARKERING (DRA I KANTER/HJØRNER ELLER NY BOKS)
  // =========================================================================

  let isDraggingCrop = false;
  let dragMode = "new"; // 'new' | 'w' | 'e' | 'n' | 's' | 'nw' | 'ne' | 'sw' | 'se'
  let dragStartPt = null;
  let initialCropSnapshot = null;

  function clientToCanvasCoords(clientX, clientY) {
    const rect = sourceCanvas.getBoundingClientRect();
    const scaleX = sourceCanvas.width / rect.width;
    const scaleY = sourceCanvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(sourceCanvas.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(sourceCanvas.height, (clientY - rect.top) * scaleY)),
    };
  }

  /**
   * Sjekker om brukeren trykker på en av kantene eller hjørnene til eksisterende utsnitt.
   */
  function hitTestCropEdges(pt, crop) {
    if (!crop) return "new";
    const rect = sourceCanvas.getBoundingClientRect();
    const scale = sourceCanvas.width / Math.max(1, rect.width);
    // 22 CSS-pikslers treffsone rundt kantene/hjørnene (enkelt både med mus og finger)
    const tol = Math.max(18, 22 * scale);

    const nearLeft =
      Math.abs(pt.x - crop.x) <= tol &&
      pt.y >= crop.y - tol &&
      pt.y <= crop.y + crop.h + tol;
    const nearRight =
      Math.abs(pt.x - (crop.x + crop.w)) <= tol &&
      pt.y >= crop.y - tol &&
      pt.y <= crop.y + crop.h + tol;
    const nearTop =
      Math.abs(pt.y - crop.y) <= tol &&
      pt.x >= crop.x - tol &&
      pt.x <= crop.x + crop.w + tol;
    const nearBottom =
      Math.abs(pt.y - (crop.y + crop.h)) <= tol &&
      pt.x >= crop.x - tol &&
      pt.x <= crop.x + crop.w + tol;

    if (nearTop && nearLeft) return "nw";
    if (nearTop && nearRight) return "ne";
    if (nearBottom && nearLeft) return "sw";
    if (nearBottom && nearRight) return "se";
    if (nearLeft) return "w";
    if (nearRight) return "e";
    if (nearTop) return "n";
    if (nearBottom) return "s";
    return "new";
  }

  function computeResizedCrop(mode, startCrop, currPt) {
    let left = startCrop.x;
    let right = startCrop.x + startCrop.w;
    let top = startCrop.y;
    let bottom = startCrop.y + startCrop.h;

    if (mode.includes("w")) left = Math.min(right - 30, currPt.x);
    if (mode.includes("e")) right = Math.max(left + 30, currPt.x);
    if (mode.includes("n")) top = Math.min(bottom - 30, currPt.y);
    if (mode.includes("s")) bottom = Math.max(top + 30, currPt.y);

    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      w: Math.min(sourceCanvas.width - left, right - left),
      h: Math.min(sourceCanvas.height - top, bottom - top),
    };
  }

  function rememberCropRatio(rect) {
    if (!rect || !sourceCanvas.width || !sourceCanvas.height) {
      state.savedCropRatio = null;
      return;
    }
    state.savedCropRatio = {
      rx: rect.x / sourceCanvas.width,
      ry: rect.y / sourceCanvas.height,
      rw: rect.w / sourceCanvas.width,
      rh: rect.h / sourceCanvas.height,
    };
  }

  canvasWrapper.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    canvasWrapper.setPointerCapture(e.pointerId);
    isDraggingCrop = true;
    dragStartPt = clientToCanvasCoords(e.clientX, e.clientY);
    dragMode = hitTestCropEdges(dragStartPt, state.cropRect);
    initialCropSnapshot = state.cropRect ? { ...state.cropRect } : null;
  });

  canvasWrapper.addEventListener("pointermove", (e) => {
    const curr = clientToCanvasCoords(e.clientX, e.clientY);
    if (!isDraggingCrop || !dragStartPt) {
      // Oppdater musepeker når man hovrer over en utsnittskant
      const hoverEdge = hitTestCropEdges(curr, state.cropRect);
      const cursorMap = {
        nw: "nwse-resize",
        se: "nwse-resize",
        ne: "nesw-resize",
        sw: "nesw-resize",
        w: "ew-resize",
        e: "ew-resize",
        n: "ns-resize",
        s: "ns-resize",
        new: "crosshair",
      };
      canvasWrapper.style.cursor = cursorMap[hoverEdge] || "crosshair";
      return;
    }

    let dragRect;
    if (dragMode !== "new" && initialCropSnapshot) {
      dragRect = computeResizedCrop(dragMode, initialCropSnapshot, curr);
    } else {
      dragRect = {
        x: Math.min(dragStartPt.x, curr.x),
        y: Math.min(dragStartPt.y, curr.y),
        w: Math.abs(curr.x - dragStartPt.x),
        h: Math.abs(curr.y - dragStartPt.y),
      };
    }
    drawOverlayBoxes(dragRect);
  });

  canvasWrapper.addEventListener("pointerup", (e) => {
    if (!isDraggingCrop || !dragStartPt) return;
    isDraggingCrop = false;
    const curr = clientToCanvasCoords(e.clientX, e.clientY);

    if (dragMode !== "new" && initialCropSnapshot) {
      state.cropRect = computeResizedCrop(dragMode, initialCropSnapshot, curr);
      rememberCropRatio(state.cropRect);
      resetCropBtn.disabled = false;
      runSegmentationAndRender();
    } else {
      const w = Math.abs(curr.x - dragStartPt.x);
      const h = Math.abs(curr.y - dragStartPt.y);
      // Krev minst 25x25 piksler for å aktivere nytt utsnitt
      if (w >= 25 && h >= 25) {
        state.cropRect = {
          x: Math.min(dragStartPt.x, curr.x),
          y: Math.min(dragStartPt.y, curr.y),
          w,
          h,
        };
        rememberCropRatio(state.cropRect);
        resetCropBtn.disabled = false;
        runSegmentationAndRender();
      } else {
        drawOverlayBoxes();
      }
    }
    dragStartPt = null;
    initialCropSnapshot = null;
  });

  resetCropBtn.addEventListener("click", () => {
    state.cropRect = null;
    state.savedCropRatio = null;
    resetCropBtn.disabled = true;
    runSegmentationAndRender();
  });

  if (autoCropBtn) {
    autoCropBtn.addEventListener("click", () => {
      const detected = autoDetectTextBlockCrop();
      if (detected) {
        state.cropRect = detected;
        rememberCropRatio(state.cropRect);
        resetCropBtn.disabled = false;
        runSegmentationAndRender();
      }
    });
  }

  if (adaptiveShadowToggle) {
    adaptiveShadowToggle.addEventListener("change", () => {
      state.useAdaptiveShadow = adaptiveShadowToggle.checked;
      ingestCanvasSource();
    });
  }

  if (mergeHyphensToggle) {
    mergeHyphensToggle.addEventListener("change", () => {
      state.mergeHyphens = mergeHyphensToggle.checked;
      runSegmentationAndRender();
    });
  }

  if (dejaggBaselineToggle) {
    dejaggBaselineToggle.addEventListener("change", () => {
      state.useDejaggBaseline = dejaggBaselineToggle.checked;
      runSegmentationAndRender();
    });
  }

  // Deskew / oppretting av skjeve skanninger
  if (deskewSlider) {
    deskewSlider.addEventListener("input", () => {
      const deg = Number(deskewSlider.value);
      applyDeskewRotation(deg);
    });
  }

  if (autoDeskewBtn) {
    autoDeskewBtn.addEventListener("click", () => {
      autoDetectSkewAngle();
    });
  }

  // =========================================================================
  // 7. HENDELSESLYTTERE FOR KONTROLLER, OPPLASTING OG UTKLIPPSTAVLE
  // =========================================================================

  presetSelect.addEventListener("change", () => {
    const val = presetSelect.value;
    if (val === "nb-hamsun-sult") {
      iiifUrlInput.value = `https://urn.nb.no/${HAMSUN_SULT_URN}`;
      handleIiifInput(HAMSUN_SULT_URN, HAMSUN_SULT_DEFAULT_PAGE_INDEX);
    } else {
      generateSyntheticScan(val);
    }
  });

  prevPageBtn.addEventListener("click", () => {
    if (!state.iiifBook || state.iiifBook.currentIndex <= 0) return;
    state.iiifBook.currentIndex--;
    loadCurrentIiifBookPage();
  });

  nextPageBtn.addEventListener("click", () => {
    if (
      !state.iiifBook ||
      state.iiifBook.currentIndex >= state.iiifBook.pages.length - 1
    ) {
      return;
    }
    state.iiifBook.currentIndex++;
    loadCurrentIiifBookPage();
  });

  pageSelect.addEventListener("change", () => {
    if (!state.iiifBook) return;
    state.iiifBook.currentIndex = Number(pageSelect.value);
    loadCurrentIiifBookPage();
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.iiifBook = null;
    renderIiifBookNavigator();
    const resumeTitleEl = document.getElementById("resume-book-title");
    if (resumeTitleEl) resumeTitleEl.textContent = file.name || "Opplastet bilde";
    const objectUrl = URL.createObjectURL(file);
    openReaderScreen();
    loadExternalImageUrl(objectUrl, false);
  });

  // Lim inn bilde direkte med Ctrl+V / Cmd+V
  window.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          state.iiifBook = null;
          renderIiifBookNavigator();
          const resumeTitleEl = document.getElementById("resume-book-title");
          if (resumeTitleEl) resumeTitleEl.textContent = "Innlimt skjermbilde";
          const objectUrl = URL.createObjectURL(file);
          openReaderScreen();
          loadExternalImageUrl(objectUrl, false);
          break;
        }
      }
    }
  });

  if (toggleIiifBtn) {
    toggleIiifBtn.addEventListener("click", () => {
      const isHidden = iiifDrawer.hasAttribute("hidden");
      if (isHidden) {
        iiifDrawer.removeAttribute("hidden");
        toggleIiifBtn.setAttribute("aria-expanded", "true");
        iiifUrlInput.focus();
      } else {
        iiifDrawer.setAttribute("hidden", "");
        toggleIiifBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  iiifForm.addEventListener("submit", (e) => {
    e.preventDefault();
    openReaderScreen();
    handleIiifInput(iiifUrlInput.value);
  });

  showBoxesToggle.addEventListener("change", () => {
    drawOverlayBoxes();
  });

  scaleSlider.addEventListener("input", () => {
    const pct = Number(scaleSlider.value);
    scaleOutput.textContent = `${pct}%`;
    state.scaleFactor = pct / 100;
    applyScaleWithoutResegmenting();
  });

  spaceSlider.addEventListener("input", () => {
    const val = Number(spaceSlider.value);
    spaceOutput.textContent = `${val.toFixed(2)}×`;
    state.spaceSensitivity = val;
    runSegmentationAndRender();
  });

  contrastSlider.addEventListener("input", () => {
    const val = Number(contrastSlider.value);
    contrastOutput.textContent = val > 0 ? `+${val}` : String(val);
    state.contrastOffset = val;
    runSegmentationAndRender();
  });

  lineGapSlider.addEventListener("input", () => {
    const val = Number(lineGapSlider.value);
    lineGapOutput.textContent = `${val.toFixed(2)}×`;
    state.lineGapMultiplier = val;
    updateReaderSpacingVariables();
  });

  function updateActiveAlgoSummaryPill() {
    if (!activeAlgoPill) return;
    const algoNames = {
      raw: "Rå piksler (1×)",
      superres: "Super-Res (3×)",
      vector: "Vektor-kontur",
      wireframe: "Vektor-trådramme",
    };
    const name = algoNames[state.traceMode] || state.traceMode;
    const sign = state.strokeOffset > 0 ? `+${state.strokeOffset}` : String(state.strokeOffset);
    activeAlgoPill.textContent = `${name} • ${state.smoothIterations} steg • ${state.preblurRadius.toFixed(1)} px blur • ${sign} fylde`;
  }

  function currentEffectiveInkThreshold() {
    return Math.max(
      25,
      Math.min(235, state.otsuThreshold + state.contrastOffset)
    );
  }

  renderModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      renderModeButtons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      state.renderMode = btn.dataset.renderMode;

      updateActiveAlgoSummaryPill();
      renderLiquidWords(currentEffectiveInkThreshold());
    });
  });

  flowModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      flowModeButtons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      state.flowMode = btn.dataset.flowMode;
      evaluateSmartLineFlow();
    });
  });

  traceModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      traceModeButtons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      state.traceMode = btn.dataset.traceMode;

      // Hvis brukeren klikker på en av Renset/Tracing-algoritmene mens "Originalt papir"
      // står på, bytt automatisk over til "Renset blekk" (med mindre det er wireframe-debug)
      if (state.renderMode === "paper" && state.traceMode !== "wireframe") {
        state.renderMode = "clean";
        renderModeButtons.forEach((b) => {
          const isClean = b.dataset.renderMode === "clean";
          b.classList.toggle("active", isClean);
          b.setAttribute("aria-pressed", isClean ? "true" : "false");
        });
      }

      updateActiveAlgoSummaryPill();
      renderLiquidWords(currentEffectiveInkThreshold());
    });
  });

  smoothIterSlider.addEventListener("input", () => {
    const val = Number(smoothIterSlider.value);
    smoothIterOutput.textContent = `${val} steg`;
    state.smoothIterations = val;
    updateActiveAlgoSummaryPill();
    renderLiquidWords(currentEffectiveInkThreshold());
  });

  preblurSlider.addEventListener("input", () => {
    const val = Number(preblurSlider.value);
    preblurOutput.textContent = `${val.toFixed(1)} px`;
    state.preblurRadius = val;
    updateActiveAlgoSummaryPill();
    renderLiquidWords(currentEffectiveInkThreshold());
  });

  strokeWeightSlider.addEventListener("input", () => {
    const val = Number(strokeWeightSlider.value);
    strokeWeightOutput.textContent = val > 0 ? `+${val}` : String(val);
    state.strokeOffset = val;

    // Hvis brukeren drar i Teksttykkelse (Blekkfylde) mens "Originalt papir" er valgt,
    // bytt automatisk til "Renset blekk" slik at effekten synes med en gang!
    if (state.renderMode === "paper") {
      state.renderMode = "clean";
      renderModeButtons.forEach((b) => {
        const isClean = b.dataset.renderMode === "clean";
        b.classList.toggle("active", isClean);
        b.setAttribute("aria-pressed", isClean ? "true" : "false");
      });
    }

    updateActiveAlgoSummaryPill();
    renderLiquidWords(currentEffectiveInkThreshold());
  });

  toggleLoupe.addEventListener("change", () => {
    updateWordLoupe(state.selectedWord, currentEffectiveInkThreshold());
  });

  mobileTabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      mobileTabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      workspaceGrid.dataset.activeView = btn.dataset.viewTarget;
    });
  });

  // =========================================================================
  // 8. TO-DELT ARKITEKTUR: BIBLIOTEK + FULLSKJERMS LESER MED TIDSSTYRTE PILLER
  // =========================================================================

  const readerView = document.getElementById("reader-view");
  const resumeReadingBtn = document.getElementById("resume-reading-btn");
  const backToLibraryBtn = document.getElementById("back-to-library-btn");
  const openAaSheetBtn = document.getElementById("open-aa-sheet-btn");
  const closeAaSheetBtn = document.getElementById("close-aa-sheet-btn");
  const aaSettingsSheet = document.getElementById("aa-settings-sheet");
  const openCropModalBtn = document.getElementById("open-crop-modal-btn");
  const closeCropModalBtn = document.getElementById("close-crop-modal-btn");
  const cropInspectorSheet = document.getElementById("crop-inspector-sheet");
  const hudTopPills = document.getElementById("hud-top-pills");
  const hudBottomPills = document.getElementById("hud-bottom-pills");
  const nbSearchForm = document.getElementById("nb-search-form");
  const nbSearchInput = document.getElementById("nb-search-input");
  const nbSearchResults = document.getElementById("nb-search-results");

  let hudTimerId = null;
  const HUD_DISPLAY_DURATION_MS = 4200;

  function isAnySheetOpen() {
    const aaOpen = aaSettingsSheet && !aaSettingsSheet.hasAttribute("hidden");
    const cropOpen = cropInspectorSheet && !cropInspectorSheet.hasAttribute("hidden");
    return Boolean(aaOpen || cropOpen);
  }

  function showTransientHudPills(durationMs = HUD_DISPLAY_DURATION_MS) {
    if (!readerView) return;
    readerView.classList.add("hud-visible");
    if (hudTimerId) {
      clearTimeout(hudTimerId);
      hudTimerId = null;
    }
    if (!isAnySheetOpen() && durationMs > 0) {
      hudTimerId = setTimeout(() => {
        if (!isAnySheetOpen()) {
          readerView.classList.remove("hud-visible");
        }
      }, durationMs);
    }
  }

  function hideTransientHudPills() {
    if (hudTimerId) {
      clearTimeout(hudTimerId);
      hudTimerId = null;
    }
    if (aaSettingsSheet) aaSettingsSheet.setAttribute("hidden", "");
    if (openAaSheetBtn) openAaSheetBtn.setAttribute("aria-expanded", "false");
    if (readerView) readerView.classList.remove("hud-visible");
  }

  function openReaderScreen() {
    document.body.dataset.appScreen = "reader";
    // Vis de flytende pillene i 3.5 sekunder ved åpning så brukeren ser at de finnes,
    // og la dem deretter gli mykt bort for 100 % ren bokside!
    showTransientHudPills(3500);
  }

  function openLibraryScreen() {
    hideTransientHudPills();
    if (cropInspectorSheet) cropInspectorSheet.setAttribute("hidden", "");
    document.body.dataset.appScreen = "library";
  }

  if (resumeReadingBtn) {
    resumeReadingBtn.addEventListener("click", () => openReaderScreen());
  }
  if (backToLibraryBtn) {
    backToLibraryBtn.addEventListener("click", () => openLibraryScreen());
  }

  // Åpne / lukke "Aa Utseende"-skuffen fra den flytende pillen
  if (openAaSheetBtn && aaSettingsSheet) {
    openAaSheetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = aaSettingsSheet.hasAttribute("hidden");
      if (willOpen) {
        aaSettingsSheet.removeAttribute("hidden");
        openAaSheetBtn.setAttribute("aria-expanded", "true");
        showTransientHudPills(0); // Hold pillene synlige mens skuffen er åpen
      } else {
        aaSettingsSheet.setAttribute("hidden", "");
        openAaSheetBtn.setAttribute("aria-expanded", "false");
        showTransientHudPills(2200);
      }
    });
  }

  if (closeAaSheetBtn && aaSettingsSheet) {
    closeAaSheetBtn.addEventListener("click", () => {
      aaSettingsSheet.setAttribute("hidden", "");
      if (openAaSheetBtn) openAaSheetBtn.setAttribute("aria-expanded", "false");
      hideTransientHudPills();
    });
  }

  // Åpne / lukke "✂️ Utsnitt & Skjevhet"-modalen
  if (openCropModalBtn && cropInspectorSheet) {
    openCropModalBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (aaSettingsSheet) aaSettingsSheet.setAttribute("hidden", "");
      cropInspectorSheet.removeAttribute("hidden");
      drawOverlayBoxes();
      showTransientHudPills(0);
    });
  }

  if (closeCropModalBtn && cropInspectorSheet) {
    closeCropModalBtn.addEventListener("click", () => {
      cropInspectorSheet.setAttribute("hidden", "");
      hideTransientHudPills();
    });
  }

  // Forny tidsavbruddet hvis brukeren rører på de flytende pillene
  [hudTopPills, hudBottomPills].forEach((bar) => {
    if (!bar) return;
    bar.addEventListener("pointerDown", () => showTransientHudPills(HUD_DISPLAY_DURATION_MS));
    bar.addEventListener("pointermove", () => {
      if (readerView?.classList.contains("hud-visible") && !isAnySheetOpen()) {
        showTransientHudPills(HUD_DISPLAY_DURATION_MS);
      }
    });
  });

  // Koble bokkortene i Biblioteket til å åpne valgt bok direkte i Leseren
  function bindBookCards(container) {
    if (!container) return;
    container.querySelectorAll(".book-card").forEach((card) => {
      card.addEventListener("click", () => {
        const urn = card.dataset.urn;
        const pageIdx = card.dataset.page ? Number(card.dataset.page) : null;
        const synthetic = card.dataset.synthetic;
        const titleText = card.querySelector("h3")?.textContent || "Valgt bok";
        const resumeTitleEl = document.getElementById("resume-book-title");
        if (resumeTitleEl) resumeTitleEl.textContent = titleText;

        openReaderScreen();
        if (urn) {
          iiifUrlInput.value = `https://urn.nb.no/${urn}`;
          handleIiifInput(urn, pageIdx);
        } else if (synthetic) {
          renderIiifBookNavigator();
          generateSyntheticScan(synthetic);
        }
      });
    });
  }

  bindBookCards(document.getElementById("curated-book-grid"));

  // Søk direkte i Nasjonalbibliotekets åpne Public Domain-bøker
  if (nbSearchForm && nbSearchInput && nbSearchResults) {
    nbSearchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = nbSearchInput.value.trim();
      if (!q) return;

      nbSearchResults.removeAttribute("hidden");
      nbSearchResults.innerHTML = `<p class="panel-hint">Søker i Nasjonalbiblioteket etter «${q}»...</p>`;

      try {
        const url = `https://api.nb.no/catalog/v1/items?q=${encodeURIComponent(
          q
        )}&filter=contentClasses:publicdomain&filter=mediatype:b%C3%B8ker&size=8`;
        const resp = await fetch(url);
        const data = await resp.json();
        const items = data?._embedded?.items || [];

        if (items.length === 0) {
          nbSearchResults.innerHTML = `<p class="panel-hint">Ingen fritt tilgjengelige (Public Domain) bøker funnet for «${q}».</p>`;
          return;
        }

        nbSearchResults.innerHTML = "";
        items.forEach((it) => {
          const m = it.metadata || {};
          const urn = m.identifiers?.urn;
          if (!urn) return;
          const title = m.title || "Uten tittel";
          const author = (m.creators || []).join(", ") || "Ukjent forfatter";
          const year = m.originInfo?.issued || "";
          const pages = m.pageCount ? `${m.pageCount} s.` : "";
          const thumb =
            it._links?.thumbnail_large?.href ||
            `https://www.nb.no/services/image/resolver/${urn}_C1/full/0,220/0/native.jpg`;

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "book-card";
          btn.dataset.urn = urn;
          btn.dataset.page = "7";
          btn.innerHTML = `
            <div class="book-cover">
              <img src="${thumb}" alt="" loading="lazy" />
              <span class="book-tag">IIIF ${year ? "• " + year : ""}</span>
            </div>
            <div class="book-card-body">
              <h3></h3>
              <p class="book-author"></p>
              <span class="book-meta-note"></span>
            </div>
          `;
          btn.querySelector("h3").textContent = title;
          btn.querySelector(".book-author").textContent = author;
          btn.querySelector(".book-meta-note").textContent = [year, pages]
            .filter(Boolean)
            .join(" • ");
          nbSearchResults.appendChild(btn);
        });

        bindBookCards(nbSearchResults);
      } catch (err) {
        nbSearchResults.innerHTML = `<p class="panel-hint">Feil ved søk mot NB.no: ${err.message}</p>`;
      }
    });
  }

  function updateZenPageLabel() {
    if (state.iiifBook) {
      const page = state.iiifBook.pages[state.iiifBook.currentIndex];
      const total = state.iiifBook.pages.length;
      const idx = state.iiifBook.currentIndex + 1;
      const pct = Math.round((idx / Math.max(1, total)) * 100);
      if (zenPageIndicator) {
        zenPageIndicator.textContent = `${state.iiifBook.title} • ${page ? page.label : ""}`;
      }
      if (bookTitleLabel) {
        bookTitleLabel.textContent = state.iiifBook.title;
      }
      if (bookProgressLabel) {
        bookProgressLabel.textContent = `${page ? page.label : ""} • ${idx} / ${total} (${pct}%)`;
      }
    } else {
      if (zenPageIndicator) {
        zenPageIndicator.textContent = "Pixel-Liquid Mode";
      }
      if (bookTitleLabel) {
        const resumeTitleEl = document.getElementById("resume-book-title");
        bookTitleLabel.textContent = resumeTitleEl?.textContent || "Pixel-Liquid Mode";
      }
      if (bookProgressLabel) {
        bookProgressLabel.textContent = `${state.detectedWords.length} ord • Trykk på siden for meny`;
      }
    }
  }

  function turnBookPage(delta) {
    if (!state.iiifBook) return false;
    const nextIdx = state.iiifBook.currentIndex + delta;
    if (nextIdx < 0 || nextIdx >= state.iiifBook.pages.length) return false;
    state.iiifBook.currentIndex = nextIdx;
    loadCurrentIiifBookPage();
    updateZenPageLabel();
    return true;
  }

  // Sveip (venstre/høyre, eller opp ved bunnen / ned ved toppen) og trykk for tidsstyrte piller
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let wasAtTopOnTouchStart = false;
  let wasAtBottomOnTouchStart = false;

  liquidReader.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    touchStartX = e.clientX;
    touchStartY = e.clientY;
    touchStartTime = performance.now();
    wasAtTopOnTouchStart = liquidReader.scrollTop <= 6;
    wasAtBottomOnTouchStart =
      liquidReader.scrollTop + liquidReader.clientHeight >=
      liquidReader.scrollHeight - 8;
  });

  liquidReader.addEventListener("pointerup", (e) => {
    const dx = e.clientX - touchStartX;
    const dy = e.clientY - touchStartY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const dt = performance.now() - touchStartTime;

    // 1. Horisontalt sveip (venstre = neste side, høyre = forrige side)
    if (absX >= 58 && absX > absY * 1.35 && dt < 850) {
      if (dx < 0) {
        turnBookPage(1);
      } else {
        turnBookPage(-1);
      }
      return;
    }

    // 2. Vertikalt sveip når brukeren allerede er helt nederst eller øverst i leseflaten
    if (absY >= 85 && absY > absX * 1.4 && dt < 750) {
      if (dy < 0 && wasAtBottomOnTouchStart) {
        turnBookPage(1);
        return;
      }
      if (dy > 0 && wasAtTopOnTouchStart) {
        turnBookPage(-1);
        return;
      }
    }

    // 3. Kort trykk på boksiden:
    // - Hvis Aa-skuffen er åpen og brukeren trykker på selve boksiden (utenom ord når LAB er åpen), lukk skuffen og pillene!
    // - Trykk i venstre ytterkant (0..12%) -> Forrige side
    // - Trykk i høyre ytterkant (88..100%) -> Neste side
    // - Trykk ellers på siden -> Vis de flytende pillene i 4.2 sekunder (eller skjul dem hvis de allerede vises)!
    if (absX < 12 && absY < 12 && dt < 380) {
      const aaOpen = aaSettingsSheet && !aaSettingsSheet.hasAttribute("hidden");
      if (aaOpen) {
        const labOpen = document.getElementById("trace-lab-details")?.hasAttribute("open");
        const clickedWord = e.target.closest(".word-token");
        // Hvis LAB-flisen er åpen og man klikker på et ord, oppdateres bare 3-delers lupen
        if (labOpen && clickedWord) return;
        hideTransientHudPills();
        return;
      }

      const rect = liquidReader.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
      const relY = (e.clientY - rect.top) / Math.max(1, rect.height);

      if (relY > 0.16 && relX <= 0.12 && state.iiifBook) {
        turnBookPage(-1);
      } else if (relY > 0.16 && relX >= 0.88 && state.iiifBook) {
        turnBookPage(1);
      } else if (readerView?.classList.contains("hud-visible")) {
        hideTransientHudPills();
      } else {
        showTransientHudPills(HUD_DISPLAY_DURATION_MS);
      }
    }
  });

  // Piltaster venstre/høyre for å bla, Escape for å lukke skuffer/piller
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (cropInspectorSheet && !cropInspectorSheet.hasAttribute("hidden")) {
        cropInspectorSheet.setAttribute("hidden", "");
      }
      hideTransientHudPills();
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") {
      if (turnBookPage(1)) e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      if (turnBookPage(-1)) e.preventDefault();
    }
  });

  // =========================================================================
  // 9. OPPDATERINGSMELDING (SOM I NEO-DHLAB)
  // =========================================================================

  function initUpdateNotification() {
    const banner = document.getElementById("update-banner");
    const titleEl = document.getElementById("update-banner-title");
    const summaryEl = document.getElementById("update-banner-summary");
    const reloadBtn = document.getElementById("update-reload-btn");
    const dismissBtn = document.getElementById("update-dismiss-btn");
    const versionBadge = document.getElementById("app-version-badge");

    if (versionBadge) {
      versionBadge.textContent = `v${APP_VERSION}`;
    }
    if (!banner) return;

    const STORAGE_KEY = "pixel_liquid_seen_version";
    try {
      const lastSeen = localStorage.getItem(STORAGE_KEY);
      if (lastSeen && lastSeen !== APP_VERSION) {
        // Vis kvitteringsmelding når brukeren nettopp har lastet inn en nyere versjon
        titleEl.textContent = `Oppdatert til v${APP_VERSION}!`;
        summaryEl.textContent = APP_RELEASE_SUMMARY;
        reloadBtn.hidden = true;
        dismissBtn.textContent = "Flott!";
        banner.removeAttribute("hidden");
      }
      localStorage.setItem(STORAGE_KEY, APP_VERSION);
    } catch (_e) {
      // Ignorer hvis localStorage er blokkert
    }

    reloadBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("v", String(Date.now()));
      window.location.replace(url.toString());
    });

    dismissBtn.addEventListener("click", () => {
      banner.setAttribute("hidden", "");
    });

    async function checkRemoteVersion() {
      try {
        const resp = await fetch(`version.json?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data?.version && data.version !== APP_VERSION) {
          titleEl.textContent = `Ny versjon (v${data.version}) er klar!`;
          summaryEl.textContent =
            data.summary || "En ny oppdatering er rullet ut på GitHub Pages.";
          reloadBtn.hidden = false;
          dismissBtn.textContent = "Senere";
          banner.removeAttribute("hidden");
        }
      } catch (_err) {
        // Ignorer nettverksfeil i bakgrunnssjekk
      }
    }

    // Sjekk ved oppstart (etter 4 sek), når fanen får fokus igjen, og hvert 45. sekund
    setTimeout(checkRemoteVersion, 4000);
    setInterval(checkRemoteVersion, 45000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkRemoteVersion();
      }
    });
  }

  initUpdateNotification();

  // Feilsøkingskrok: med ?debug i URL-en kan konsollen lese tilstanden (window.__pixelLiquid)
  if (/[?&]debug\b/.test(window.location.search)) {
    window.__pixelLiquid = {
      state,
      sourceCanvas,
      rerun: runSegmentationAndRender,
      loadPage: (urn, idx) => handleIiifInput(urn, idx),
      openReader: () => openReaderScreen(),
    };
  }

  // Start med Knut Hamsuns Sult (1890) direkte fra Nasjonalbiblioteket IIIF
  // (med automatisk fallback til innebygd 1890-skanning dersom man er offline)
  handleIiifInput(HAMSUN_SULT_URN, HAMSUN_SULT_DEFAULT_PAGE_INDEX);
})();
