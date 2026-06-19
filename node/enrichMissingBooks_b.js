// node/enrichLibrary.js

const fs = require("fs");
const path = require("path");
const https = require("https");

// 🔑 PASTE YOUR REGENERATED FREE GOOGLE API KEY HERE
const GOOGLE_API_KEY = "AIzaSyBVhpzjsIuIz9KMXhPvfXDw3iS6xYHBBrk";

const ROOT = path.join(__dirname, "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog.json");

// ADVANCED MATCH CLEANER: Strips noise, metadata tags, and volume numbers
function cleanLooseQuery(filename) {
  let clean = filename.replace(/\.[^/.]+$/, ""); // Strip file extension

  // 1. Remove parenthetical metadata like (Craig Storti) or [Z-Library]
  clean = clean.replace(/\([^)]*\)/g, "");
  clean = clean.replace(/\[[^\]]*\]/g, "");
  clean = clean.replace(/Z-Library/gi, "");

  // 2. Strip leading numbers, volume markers, or stray prefixes (e.g., "01- Asterix" -> "Asterix")
  clean = clean.replace(/^[\d\s\-A-Za-z\-_]+-\s*/, " ");
  clean = clean.replace(/^(Book|Vol|Volume|Part)\s*\d+/gi, "");

  // 3. Replace punctuation and dividers with clean spaces
  clean = clean.replace(/[\(\)\[\]\{\}\-_,.]/g, " ");

  // 4. Return clean string
  return clean.trim();
}

function fetchGoogleBooks(query) {
  return new Promise((resolve, reject) => {
    // We wrap the query in quotes or rely on the global search
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodedQuery}&maxResults=1&key=${GOOGLE_API_KEY}`;

    const options = { headers: { "User-Agent": "Mozilla/5.0" } };

    https
      .get(url, options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              return reject(new Error(`API_ERROR: ${parsed.error.message} (Code: ${parsed.error.code})`));
            }
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", (err) => reject(err));
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSequentialEnrichment() {
  console.log("\n--- Starting Smart-Clean Match Engine ---");

  if (GOOGLE_API_KEY === "YOUR_NEW_API_KEY" || !GOOGLE_API_KEY) {
    console.error("❌ Please paste your regenerated Google API Key first!");
    return;
  }

  if (!fs.existsSync(CATALOG_FILE)) {
    console.error(`❌ Catalog database file not found at ${CATALOG_FILE}`);
    return;
  }

  let catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));

  let missingBooks = [];
  for (let i = 0; i < catalog.length; i++) {
    const isbnVal = catalog[i].isbn;
    if (!isbnVal || isbnVal.trim() === "" || isbnVal === "PENDING") {
      missingBooks.push({ originalIndex: i, data: catalog[i] });
    }
  }

  const totalToProcess = missingBooks.length;
  console.log(`📊 Total Master Catalog Size: ${catalog.length} records.`);
  console.log(`🔍 Target Scan Queue: ${totalToProcess} un-enriched items.\n`);

  if (totalToProcess === 0) {
    console.log("🎉 Complete! Every entry in your library contains metadata.");
    return;
  }

  for (let currentStep = 0; currentStep < totalToProcess; currentStep++) {
    let item = missingBooks[currentStep];
    let targetCatalogIndex = item.originalIndex;
    let book = item.data;

    // Process Clean Query Strategy
    let cleanTitle = cleanLooseQuery(book.filename);

    // Fallback if cleaning completely empties the string
    if (!cleanTitle) cleanTitle = book.filename.replace(/\.[^/.]+$/, "");

    // Strategy 1: Cut to first 4 meaningful words for searching
    let words = cleanTitle.split(/\s+/);
    let searchPhrase = words.slice(0, 4).join(" ");

    console.log(`[Processing ${currentStep + 1}/${totalToProcess}] ${book.filename}`);
    console.log(`  🔎 Try 1 (Optimized): "${searchPhrase}"`);

    try {
      let apiResult = await fetchGoogleBooks(searchPhrase);

      // FALLBACK STRATEGY: If 4 words failed, try searching the full cleaned title string
      if ((!apiResult.items || apiResult.items.length === 0) && words.length > 4) {
        searchPhrase = cleanTitle;
        console.log(`  🔄 Try 2 (Full Title Fallback): "${searchPhrase}"`);
        apiResult = await fetchGoogleBooks(searchPhrase);
      }

      if (apiResult.items && apiResult.items.length > 0) {
        const volumeInfo = apiResult.items[0].volumeInfo;
        let isbn13 = "";
        if (volumeInfo.industryIdentifiers) {
          const match = volumeInfo.industryIdentifiers.find((id) => id.type === "ISBN_13");
          if (match) isbn13 = match.identifier;
        }

        catalog[targetCatalogIndex].isbn = isbn13 || "PENDING";
        catalog[targetCatalogIndex].subTitle = volumeInfo.subtitle || "";
        catalog[targetCatalogIndex].author = volumeInfo.authors ? volumeInfo.authors.join(", ") : book.author || "";
        catalog[targetCatalogIndex].publisher = volumeInfo.publisher || "";
        catalog[targetCatalogIndex].publishDate = volumeInfo.publishedDate || "";
        catalog[targetCatalogIndex].category = volumeInfo.categories ? volumeInfo.categories[0] : "";
        catalog[targetCatalogIndex].series = "[Loose Match Review]";
        catalog[targetCatalogIndex].pageCount = volumeInfo.pageCount || 0;
        catalog[targetCatalogIndex].description = volumeInfo.description ? volumeInfo.description.substring(0, 300) + "..." : "";

        console.log(`  ✅ Match Confirmed! -> ${volumeInfo.title} | ISBN: ${catalog[targetCatalogIndex].isbn}\n`);
        fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8");
      } else {
        console.log(`  ❌ No database metadata returned. Skipping to protect file entries.\n`);
        // We leave it unset/PENDING so it can be re-run cleanly without corrupting
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      if (err.message.includes("quota") || err.message.includes("limit") || err.message.includes("429")) {
        console.error(`\n🛑 Critical: Google API limit reached. Stopping script execution cleanly.`);
        break;
      }
      console.log(`  Moving to next item...\n`);
    }

    await delay(750);
  }

  console.log(`\n✨ Scan cycle paused/completed. Progress saved.`);
}

runSequentialEnrichment();
