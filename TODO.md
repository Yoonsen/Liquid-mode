# Pixel-Liquid Mode — TODO & Veikart

## 🔥 Topp prioritet (Neste økt)
1. **Rask og friksjonsfri vei tilbake til Lesemodus etter menybruk:**
   - Gjøre det umiddelbart å lukke menyene og havne rett tilbake på den rene boksiden (f.eks. en alltid synlig, tydelig **«📖 Tilbake til boksiden / Lukk meny»**-knapp øverst/nederst i menyen, automatisk lukking når man klikker på selve boksiden/ordene under menyen, eller `Esc`-tast).
   - Sørge for at man også etter å ha vært inne i `✂️ Original & Utsnitt` kommer tilbake til full Kindle-lesemodus med ett enkelt trykk.

## 📚 Forside / Bokhylle med åpne IIIF-bøker & kilder
2. **Kuratert forside / Bokhylle (Startskjerm):**
   - Visuell bokhylle med utvalgte åpne verk fra **Nasjonalbiblioteket (IIIF)** (f.eks. Hamsun, Ibsen, Collett, Asbjørnsen & Moe, eldre aviser i fraktur), pluss søkefelt direkte mot Nasjonalbibliotekets åpne katalog-API (`api.nb.no/catalog/v1/items?filter=accessInfo.accessAllowedFrom:EVERYWHERE`).
   - Mulighet for andre åpne IIIF-samlinger / arkiver (og rask opplasting / kamera-knapp på forsiden for egne mobilbilder og pocketbøker).

## 📐 Bildebehandling & Skannekvalitet
3. **Skjeve og krumme pocketbok-skanninger (Deskew & Unwarp):**
   - Videreutvikle `Auto`-oppretting (Deskew) til også å håndtere lokal linjekrumning inn mot bokryggen på tykke pocketbøker (f.eks. følge linjebuen lokalt per kolonne i stedet for kun én global horisontal projeksjon).
   - Automatisk deteksjon av tekstblokkens ytterkanter (auto-crop) så man slipper å dra i utsnittsboksen manuelt.
