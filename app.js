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

  const scaleSlider = document.getElementById("scale-slider");
  const scaleOutput = document.getElementById("scale-output");
  const spaceSlider = document.getElementById("space-slider");
  const spaceOutput = document.getElementById("space-output");
  const contrastSlider = document.getElementById("contrast-slider");
  const contrastOutput = document.getElementById("contrast-output");
  const lineGapSlider = document.getElementById("line-gap-slider");
  const lineGapOutput = document.getElementById("line-gap-output");

  const renderModeButtons = document.querySelectorAll("[data-render-mode]");
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

  // Applikasjonstilstand (optimaliserte standardverdier: høy glatting, lav pre-blur, god blekkfylde)
  const state = {
    sourceImageData: null, // Full ImageData fra sourceCanvas
    gray: null,            // Uint8Array gråtoner for hele bildet
    otsuThreshold: 140,    // Automatisk beregnet terskel
    cropRect: null,        // { x, y, w, h } i bildepiksler, eller null for hele bildet
    detectedLines: [],     // [{ yTop, yBottom, yCore, isParagraphStart, words: [...] }]
    detectedWords: [],     // Flatt liste med alle ord-objekter
    hoveredWordId: null,
    selectedWord: null,
    renderMode: "paper",   // 'paper' | 'clean' | 'dark'
    traceMode: "vector",   // 'raw' | 'superres' | 'vector' | 'wireframe'
    smoothIterations: 3,   // 3 Chaikin-iterasjoner (høy kurve-glatting)
    preblurRadius: 0.0,    // 0.0 px sub-piksel utjevning (lav pre-blur bevarer skarpe detaljer)
    strokeOffset: 9,       // +9 blekkfylde-offset (fyldigere, mer lesbar strek)
    scaleFactor: 1.85,
    spaceSensitivity: 1.0,
    contrastOffset: 0,
    lineGapMultiplier: 1.35,
    iiifBook: null, // { title, pages: [{ label, serviceId }], currentIndex }
  };

  // =========================================================================
  // 1. SYNTETISKE EKSEMPELSIDER & ÅPNE IIIF-KILDER (Nasjonalbiblioteket)
  // =========================================================================

  const HAMSUN_SULT_URN = "URN:NBN:no-nb_digibok_2015051929001";
  const HAMSUN_SULT_DEFAULT_PAGE_INDEX = 8; // _0007 (Første kapittel: "Det var i den Tid, jeg gik omkring og sulted i Kristiania...")

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

  function loadExternalImageUrl(url, fallbackNotice) {
    statsBar.innerHTML = `<span class="stat-chip">Henter bilde fra åpen kilde...</span>`;
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // Skaler ned svært store bilder til en hensiktsmessig arbeidsoppløsning (maks 1600px bredde)
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

      // Dersom vi er inne i en IIIF-bok fra NB.no, sett automatisk et
      // innholds-utsnitt (8% marg rundt) så svarte skanningskanter/bokrygg ikke
      // slår sammen linjene — brukeren kan når som helst dra sitt eget utsnitt
      // eller trykke "Hele siden".
      if (state.iiifBook) {
        state.cropRect = {
          x: Math.round(targetW * 0.08),
          y: Math.round(targetH * 0.07),
          w: Math.round(targetW * 0.84),
          h: Math.round(targetH * 0.84),
        };
        resetCropBtn.disabled = false;
      } else {
        state.cropRect = null;
        resetCropBtn.disabled = true;
      }
      ingestCanvasSource();
    };

    img.onerror = () => {
      statsBar.innerHTML = `
        <span class="stat-chip" style="color: var(--accent-warm)">
          Kunne ikke hente IIIF-bildet direkte (nettverk eller CORS). Viser innebygd skanning i stedet.
        </span>
      `;
      if (fallbackNotice) {
        generateSyntheticScan("synthetic-gothic");
      }
    };

    img.src = url;
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
      const catalogUrl = `https://api.nb.no/catalog/v1/items?q=${encodeURIComponent(queryId)}&size=5`;
      const resp = await fetch(catalogUrl);
      if (!resp.ok) {
        throw new Error(`NB katalog-API svarte med HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const items = data?._embedded?.items || [];

      // Finn eksakt treff på URN eller ID, eller bruk første treff
      const item =
        items.find(
          (it) =>
            it?.metadata?.identifiers?.urn?.toLowerCase() === queryId.toLowerCase() ||
            it?.id?.toLowerCase() === queryId.toLowerCase()
        ) || items[0];

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
    if (!state.iiifBook) {
      iiifBookBar.setAttribute("hidden", "");
      return;
    }

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

  function loadCurrentIiifBookPage() {
    if (!state.iiifBook) return;
    const page = state.iiifBook.pages[state.iiifBook.currentIndex];
    if (!page) return;

    prevPageBtn.disabled = state.iiifBook.currentIndex <= 0;
    nextPageBtn.disabled =
      state.iiifBook.currentIndex >= state.iiifBook.pages.length - 1;
    pageSelect.value = String(state.iiifBook.currentIndex);

    // Be om 1200px bredde fra Nasjonalbibliotekets IIIF Image API
    const baseService = page.serviceId.replace(/\/$/, "");
    const imageUrl = baseService.endsWith(".jpg")
      ? baseService
      : `${baseService}/full/1200,/0/native.jpg`;

    iiifUrlInput.value = imageUrl;
    loadExternalImageUrl(imageUrl, false);
  }

  // =========================================================================
  // 3. BILDEANALYSE: GRÅTONER, OTSU-TERSKEL, LINJE- OG ORDSEGMENTERING
  // =========================================================================

  function ingestCanvasSource() {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    state.sourceImageData = sourceCtx.getImageData(0, 0, w, h);
    const rgba = state.sourceImageData.data;

    // Beregn luminans (gråtoner) og histogram for Otsu-terskel
    const gray = new Uint8Array(w * h);
    const hist = new Uint32Array(256);

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      // ITU-R BT.601 luminans
      const lum = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
      gray[p] = lum;
      hist[lum]++;
    }

    state.gray = gray;
    state.otsuThreshold = computeOtsuThreshold(hist, w * h);

    runSegmentationAndRender();
  }

  function computeOtsuThreshold(hist, totalPixels) {
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
    return threshold;
  }

  /**
   * Hovedpipeline for å finne tekstlinjer og ord innenfor aktivt utsnitt (cropRect).
   */
  function runSegmentationAndRender() {
    if (!state.gray || !state.sourceImageData) return;

    const fullW = sourceCanvas.width;
    const fullH = sourceCanvas.height;

    const roi = state.cropRect || { x: 0, y: 0, w: fullW, h: fullH };
    const x0 = Math.max(0, Math.min(fullW - 1, Math.round(roi.x)));
    const y0 = Math.max(0, Math.min(fullH - 1, Math.round(roi.y)));
    const x1 = Math.max(x0 + 1, Math.min(fullW, Math.round(roi.x + roi.w)));
    const y1 = Math.max(y0 + 1, Math.min(fullH, Math.round(roi.y + roi.h)));
    const roiW = x1 - x0;
    const roiH = y1 - y0;

    // Effektiv blekk-terskel (piksler mørkere enn denne verdien regnes som blekk)
    const inkThreshold = Math.max(
      25,
      Math.min(235, state.otsuThreshold + state.contrastOffset)
    );

    // --- STEG A: Horisontal projeksjon (antall blekkpiksler per rad) ---
    const rowCounts = new Float32Array(roiH);
    for (let r = 0; r < roiH; r++) {
      const rowOffset = (y0 + r) * fullW;
      let ink = 0;
      for (let c = x0; c < x1; c++) {
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

    // Slå sammen bånd som kun er separert av 1-2 pikslers hull (f.eks. prikk over i/å)
    const mergedBands = [];
    for (const band of rawLineBands) {
      if (
        mergedBands.length > 0 &&
        band.top - mergedBands[mergedBands.length - 1].bottom <= 2
      ) {
        mergedBands[mergedBands.length - 1].bottom = band.bottom;
      } else {
        mergedBands.push({ ...band });
      }
    }

    // Filtrer bort støy-linjer som er lavere enn 6 piksler
    const validBands = mergedBands.filter((b) => b.bottom - b.top + 1 >= 6);

    // Beregn median linjehøyde og median linjeavstand (for å oppdage avsnittsskift!)
    const heights = validBands.map((b) => b.bottom - b.top + 1);
    const medianLineHeight = computeMedian(heights) || 24;

    const lineGaps = [];
    for (let i = 1; i < validBands.length; i++) {
      lineGaps.push(validBands[i].top - validBands[i - 1].bottom);
    }
    const medianLineGap = computeMedian(lineGaps) || Math.round(medianLineHeight * 0.45);

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
      const paddedHalfTop = Math.max(
        Math.round(medianLineHeight * 0.62),
        Math.round(yCore - absTop + 3)
      );
      const paddedHalfBottom = Math.max(
        Math.round(medianLineHeight * 0.52),
        Math.round(absBottom - yCore + 3)
      );

      const normTop = Math.max(y0, Math.round(yCore - paddedHalfTop));
      const normBottom = Math.min(y1 - 1, Math.round(yCore + paddedHalfBottom));
      const normH = Math.max(6, normBottom - normTop + 1);

      const lineWords = [];
      for (const span of wordSpans) {
        const spanW = span.right - span.left + 1;
        // Ignorer enkeltstående støykorn (1px smale med nesten null blekk)
        if (spanW <= 2) {
          let totalSpanInk = 0;
          for (let c = span.left; c <= span.right; c++) totalSpanInk += colCounts[c];
          if (totalSpanInk <= 2) continue;
        }

        const padX = 2;
        const wordX = Math.max(x0, x0 + span.left - padX);
        const wordRight = Math.min(x1 - 1, x0 + span.right + padX);
        const wordW = Math.max(3, wordRight - wordX + 1);

        const wordObj = {
          id: ++wordCounter,
          lineIndex: lines.length,
          x: wordX,
          y: normTop,
          w: wordW,
          h: normH,
          tightY: absTop,
          tightH: bandH,
        };
        lineWords.push(wordObj);
        allWords.push(wordObj);
      }

      if (lineWords.length > 0) {
        const prevBand = lineIdx > 0 ? validBands[lineIdx - 1] : null;
        const gapFromPrev = prevBand ? band.top - prevBand.bottom : 0;
        const isParagraphStart =
          lines.length > 0 &&
          gapFromPrev > Math.max(medianLineGap * 1.55, medianLineHeight * 0.48);

        lines.push({
          lineIndex: lines.length,
          yTop: absTop,
          yBottom: absBottom,
          yCore,
          isParagraphStart,
          words: lineWords,
        });
      }
    });

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
    overlayCtx.restore();
  }

  // =========================================================================
  // 5. RENDERING AV ORD-PIKSLER & VEKTOR-TRACING I LIQUID MODE
  // =========================================================================

  /**
   * Henter en myknet (eller rå) gråtone-matrise (Float32Array) for et enkelt ord,
   * med 1px lys polstring langs kanten slik at alle Marching Squares-konturer
   * lukker seg pent rundt bokstaver som berører ordets ytterkant.
   */
  function extractWordScalarField(word, preblurRadius) {
    const fullW = sourceCanvas.width;
    const gray = state.gray;
    const w = word.w;
    const h = word.h;

    const raw = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      const srcRow = (word.y + r) * fullW + word.x;
      const dstRow = r * w;
      for (let c = 0; c < w; c++) {
        raw[dstRow + c] = gray[srcRow + c];
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
    const effectiveThreshold = Math.max(
      15,
      Math.min(245, baseInkThreshold + state.strokeOffset)
    );

    const wCtx = wCanvas.getContext("2d");

    // 1. Originalt papir (viser alltid det ekte foto-utklippet, men unntatt i wireframe-debug)
    if (mode === "paper" && tMode !== "wireframe" && !overrideTraceMode) {
      wCanvas.width = word.w;
      wCanvas.height = word.h;
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

    for (const line of state.detectedLines) {
      if (line.isParagraphStart) {
        const br = document.createElement("div");
        br.className = "liquid-paragraph-break";
        br.setAttribute("aria-hidden", "true");
        fragment.appendChild(br);
      }

      for (const word of line.words) {
        const token = document.createElement("span");
        token.className = "word-token";
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
      }
    }

    liquidReader.appendChild(fragment);

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
      <span class="stat-chip">🔤 ${wordCount} ord-brikker</span>
    `;
  }

  // =========================================================================
  // 6. INTERAKTIV UTSNITTSMARKERING (DRA BOKS RUNDT SPALTE/AVSNITT)
  // =========================================================================

  let isDraggingCrop = false;
  let dragStartPt = null;

  function clientToCanvasCoords(clientX, clientY) {
    const rect = sourceCanvas.getBoundingClientRect();
    const scaleX = sourceCanvas.width / rect.width;
    const scaleY = sourceCanvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(sourceCanvas.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(sourceCanvas.height, (clientY - rect.top) * scaleY)),
    };
  }

  canvasWrapper.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    canvasWrapper.setPointerCapture(e.pointerId);
    isDraggingCrop = true;
    dragStartPt = clientToCanvasCoords(e.clientX, e.clientY);
  });

  canvasWrapper.addEventListener("pointermove", (e) => {
    if (!isDraggingCrop || !dragStartPt) return;
    const curr = clientToCanvasCoords(e.clientX, e.clientY);
    const dragRect = {
      x: Math.min(dragStartPt.x, curr.x),
      y: Math.min(dragStartPt.y, curr.y),
      w: Math.abs(curr.x - dragStartPt.x),
      h: Math.abs(curr.y - dragStartPt.y),
    };
    drawOverlayBoxes(dragRect);
  });

  canvasWrapper.addEventListener("pointerup", (e) => {
    if (!isDraggingCrop || !dragStartPt) return;
    isDraggingCrop = false;
    const curr = clientToCanvasCoords(e.clientX, e.clientY);
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
      resetCropBtn.disabled = false;
      runSegmentationAndRender();
    } else {
      drawOverlayBoxes();
    }
    dragStartPt = null;
  });

  resetCropBtn.addEventListener("click", () => {
    state.cropRect = null;
    resetCropBtn.disabled = true;
    runSegmentationAndRender();
  });

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
    iiifBookBar.setAttribute("hidden", "");
    const objectUrl = URL.createObjectURL(file);
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
          iiifBookBar.setAttribute("hidden", "");
          const objectUrl = URL.createObjectURL(file);
          loadExternalImageUrl(objectUrl, false);
          break;
        }
      }
    }
  });

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

  iiifForm.addEventListener("submit", (e) => {
    e.preventDefault();
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

  // Start med Knut Hamsuns Sult (1890) direkte fra Nasjonalbiblioteket IIIF
  // (med automatisk fallback til innebygd 1890-skanning dersom man er offline)
  handleIiifInput(HAMSUN_SULT_URN, HAMSUN_SULT_DEFAULT_PAGE_INDEX);
})();
