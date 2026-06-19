// node/forceEnrich.js

const fs = require("fs");
const path = require("path");
const https = require("https");

// 🔑 PASTE YOUR FREE GOOGLE API KEY HERE
const GOOGLE_API_KEY = "AIzaSyAIoh3PfhLMtQmoIPylc1nDtHtguBjbzyU";

// 🏷️ SCRIPT VERSION TRACKER
const SCRIPT_VERSION = "1.0.3 - Sequential Excel-Optimized Edition";

const ROOT = path.join(__dirname, "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog.json");

/**
 * LOOSE MATCH CLEANER: Clips complex file titles down to a clean,
 * short prefix query string so Google Books can parse it efficiently.
 */
function cleanLooseQuery(filename) {
  let clean = filename.replace(/\.[^/.]+$/, ""); // Strip file format extension

  // Strip out known archive text tags
  clean = clean
    .replace(/\(Z-Library\)/gi, "")
    .replace(/\[Z-Library\]/gi, "")
    .replace(/Z-Library/gi, "");

  // Replace brackets, underscores, commas, and structural dividers with standard blank spaces
  clean = clean.replace(/[\(\)\[\]\{\}\-_,]/g, " ");

  // Extract just the first 4 words of the title to give the loose match engine maximum accuracy
  let parts = clean.trim().split(/\s+/);
  let coreTitle = parts.slice(0, 4).join(" ");

  return encodeURIComponent(coreTitle.trim());
}

/**
 * Native low-overhead HTTPS Promise request client.
 * Explicitly rejects and surfaces hidden error payload objects from Google.
 */
function fetchGoogleBooksDiagnostic(query) {
  return new Promise((resolve, reject) => {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1&key=${GOOGLE_API_KEY}`;

    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    };

    https
      .get(url, options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);

            // Catch and expose specific Google Developer Cloud setup/quota errors
            if (parsed.error) {
              reject(new Error(`Google API Error: [${parsed.error.code}] ${parsed.error.message}`));
            } else {
              resolve(parsed);
            }
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
  console.log("\n========================================================");
  console.log(`🚀 MASTER ENRICHMENT ENGINE INITIALIZED`);
  console.log(`📌 Script Version: ${SCRIPT_VERSION}`);
  console.log("========================================================\n");

  if (GOOGLE_API_KEY === "YOUR_API_KEY_HERE" || !GOOGLE_API_KEY) {
    console.error("❌ Error: Please paste your active Google API Key into line 8!");
    return;
  }

  if (!fs.existsSync(CATALOG_FILE)) {
    console.error(`❌ Catalog database file not found at: ${CATALOG_FILE}`);
    return;
  }

  let catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));

  // STEP 1: Scan the database array and build an absolute lookup queue map
  let missingBooks = [];
  for (let i = 0; i < catalog.length; i++) {
    const isbnVal = catalog[i].isbn;

    // Process if missing, blank, or marked as PENDING from previous incomplete attempts
    if (!isbnVal || isbnVal.trim() === "" || isbnVal === "PENDING") {
      missingBooks.push({ originalIndex: i, data: catalog[i] });
    }
  }

  const totalToProcess = missingBooks.length;
  console.log(`📊 Master Database Count: ${catalog.length} records.`);
  console.log(`🔍 Remaining Target Queue: ${totalToProcess} un-enriched items.\n`);

  if (totalToProcess === 0) {
    console.log("🎉 Complete! Every entry in your catalog database contains metadata records.");
    return;
  }

  // STEP 2: Traditional incremental 'for' loop ensuring explicit sync pacing
  for (let currentStep = 0; currentStep < totalToProcess; currentStep++) {
    let item = missingBooks[currentStep];
    let targetCatalogIndex = item.originalIndex;
    let book = item.data;

    const searchPhrase = cleanLooseQuery(book.filename);

    console.log(`[Item ${currentStep + 1}/${totalToProcess}] File: ${book.filename}`);
    console.log(`  🔎 Querying: "${decodeURIComponent(searchPhrase)}"`);

    try {
      const apiResult = await fetchGoogleBooksDiagnostic(searchPhrase);

      if (apiResult.items && apiResult.items.length > 0) {
        const volumeInfo = apiResult.items[0].volumeInfo;

        let isbn13 = "";
        if (volumeInfo.industryIdentifiers) {
          const match = volumeInfo.industryIdentifiers.find((id) => id.type === "ISBN_13");
          if (match) isbn13 = match.identifier;
        }

        // Map fresh structural metadata directly back onto the main file catalog list
        catalog[targetCatalogIndex].isbn = isbn13 || "N/A";
        catalog[targetCatalogIndex].subTitle = volumeInfo.subtitle || "";
        catalog[targetCatalogIndex].author = volumeInfo.authors ? volumeInfo.authors.join(", ") : book.author || "";
        catalog[targetCatalogIndex].publisher = volumeInfo.publisher || "";
        catalog[targetCatalogIndex].publishDate = volumeInfo.publishedDate || "";
        catalog[targetCatalogIndex].category = volumeInfo.categories ? volumeInfo.categories[0] : "";
        catalog[targetCatalogIndex].series = "[Loose Match Verified]"; // Group flag for Excel filtering
        catalog[targetCatalogIndex].pageCount = volumeInfo.pageCount || 0;
        catalog[targetCatalogIndex].description = volumeInfo.description ? volumeInfo.description.substring(0, 300) + "..." : "";

        console.log(`  ✅ Match Found -> Title: "${volumeInfo.title}"\n`);

        // Save block incrementally to protect memory state
        fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8");
      } else {
        console.log(`  ⚠️ Verified: Google has no entry for this title syntax. Skipping.\n`);

        // Permanent fallback flag so it is cleaned out of the queue and looks pristine in Excel
        catalog[targetCatalogIndex].isbn = "N/A";
        fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8");
      }
    } catch (err) {
      // Catch rate blocks or quota errors cleanly and halt before data gets corrupted
      console.error(`\n🚨 CRITICAL SERVER RESPONSE: ${err.message}`);
      console.log("  Stopping execution block to protect your catalog from throttling.\n");
      return;
    }

    // STEP 3: Spacing interval (750ms) to ensure smooth operations
    await delay(750);
  }

  console.log(`\n✨ Done! The loose metadata enrichment pass is completely finished.`);
}

runSequentialEnrichment();
