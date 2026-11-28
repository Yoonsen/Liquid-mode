/**
 * Lokal tilpasning av Pixel-Liquid Mode.
 *
 * Dette er filen du (eller agenten din) endrer for å lage en egen variant av appen:
 * navn, startbok, standardutseende og hvilke bøker/manuskripter som vises i biblioteket.
 * Alt her er vanlige data; app.js leser dem ved oppstart. Felt som utelates får standardverdier.
 *
 * Kilder (`source`) for et hylleelement – bruk ett av disse:
 *   { nbUrn: "URN:NBN:no-nb_digibok_..." }   Nasjonalbiblioteket (katalog-API + IIIF)
 *   { manifest: "https://.../manifest" }     IIIF Presentation-manifest, versjon 2 eller 3
 *   { image: "https://.../default.jpg" }     ett enkelt bilde (eller IIIF Image-URL)
 *   { synthetic: "synthetic-gothic" }        innebygd testside (synthetic-gothic | synthetic-mobile | synthetic-twocol)
 *
 * Bilder fra andre institusjoner må kunne hentes fra nettleseren (CORS). De fleste IIIF-tjenester
 * tillater det. Sjekk lisensen for materialet før du legger det inn.
 */
window.PIXEL_REFLOW_CONFIG = {
  app: {
    title: "Pixel-Liquid Mode",
    subtitle: "Universell leseflyt på pikselnivå — helt uten OCR",
  },

  // id-en til hylleelementet som åpnes ved første besøk (null = ingen bok åpnes automatisk)
  startItem: "nb-sult",

  // Søkefeltet mot Nasjonalbibliotekets åpne bøker
  nbSearch: true,

  // Standard utseende for nye lesere (lagrede valg i nettleseren går foran)
  appearance: {
    scale: 0.65, // 0.35–3.5
    cleanMix: 1, // 0 = originalt utklipp av boksiden … 1 = renset tekst
    palette: "paper", // "paper" | "white" | "sepia" | "night"
    strokeOffset: 9, // -15–18
    edgeSoftness: 0, // 0 = skarp … 1 = myk kant
    lineGap: 1.35, // 1.0–2.4
  },

  shelves: [
    {
      title: "Utvalgte bøker & testsider",
      hint: "Trykk på en bok for å åpne den i fullskjerms Liquid-leser.",
      items: [
        {
          id: "nb-sult",
          title: "Sult",
          author: "Knut Hamsun",
          tag: "IIIF • 1890",
          note: "Førsteutgave, København 1890 (353 s.)",
          source: { nbUrn: "URN:NBN:no-nb_digibok_2015051929001" },
          startPage: 12, // 0-basert sideindeks i manifestet
          cover: "https://www.nb.no/services/image/resolver/URN:NBN:no-nb_digibok_2015051929001_0007/full/0,220/0/native.jpg",
        },
        {
          id: "nb-constance-ring",
          title: "Constance Ring",
          author: "Amalie Skram",
          tag: "IIIF • 1885",
          note: "Roman, Kristiania 1885 (519 s.)",
          source: { nbUrn: "URN:NBN:no-nb_digibok_2013082608001" },
          startPage: 8,
          cover: "https://www.nb.no/services/image/resolver/URN:NBN:no-nb_digibok_2013082608001_0005/full/0,220/0/native.jpg",
        },
        {
          id: "nb-sommer",
          title: "Sommer : smaa fortællinger",
          author: "Amalie Skram",
          tag: "IIIF • 1899",
          note: "København 1899 (165 s.)",
          source: { nbUrn: "URN:NBN:no-nb_digibok_2009042312002" },
          startPage: 10,
          cover: "https://www.nb.no/services/image/resolver/URN:NBN:no-nb_digibok_2009042312002_0007/full/0,220/0/native.jpg",
        },
        {
          id: "nb-ibsen-jaeger",
          title: "Henrik Ibsen og hans Værker",
          author: "Henrik Jæger",
          tag: "IIIF • 1892",
          note: "København 1892 (473 s.)",
          source: { nbUrn: "URN:NBN:no-nb_digibok_2006082300044" },
          startPage: 12,
          cover: "https://www.nb.no/services/image/resolver/URN:NBN:no-nb_digibok_2006082300044_0005/full/0,220/0/native.jpg",
        },
        {
          id: "nb-landmandsbog",
          title: "Norsk Landmandsbog",
          author: "P. Chr. Asbjørnsen",
          tag: "Fraktur • 1869",
          note: "Gotisk fraktursats, 1869 (213 s.)",
          source: { nbUrn: "URN:NBN:no-nb_digibok_2017112348049" },
          startPage: 10,
          cover: "https://www.nb.no/services/image/resolver/URN:NBN:no-nb_digibok_2017112348049_0003/full/0,220/0/native.jpg",
        },
        {
          id: "demo-gothic",
          title: "Christiania Intelligentssedler",
          author: "1890 Avissats (Innebygd)",
          tag: "Offline Demo",
          note: "Testside med papirtekstur",
          source: { synthetic: "synthetic-gothic" },
          glyph: "𝔉",
        },
        {
          id: "demo-mobile",
          title: "Småskrift-skjermbilde / Brev",
          author: "Mobil-eksempel (Innebygd)",
          tag: "Offline Demo",
          note: "Test av tett dokument på liten flate",
          source: { synthetic: "synthetic-mobile" },
          glyph: "📱",
        },
        {
          id: "demo-twocol",
          title: "Norsk Folkeblad (To spalter)",
          author: "Spaltemarkering (Innebygd)",
          tag: "Spalte-demo",
          note: "Automatisk spaltedeteksjon (to spalter)",
          source: { synthetic: "synthetic-twocol" },
          glyph: "📰",
        },
      ],
    },
    {
      title: "Manuskripter fra andre IIIF-kilder",
      hint: "Eksempel på materiale fra en annen institusjon (IIIF Presentation 3). Håndskrift flyter mindre jevnt enn trykk.",
      items: [
        {
          id: "wellcome-receipt-book",
          title: "Receipt Book, 18th century",
          author: "Wellcome Collection",
          tag: "Manuskript • 1700-t.",
          note: "Håndskrevet oppskriftsbok (Public Domain Mark)",
          source: { manifest: "https://iiif.wellcomecollection.org/presentation/v3/b19336378" },
          startPage: 4,
          glyph: "✒",
        },
      ],
    },
  ],
};
