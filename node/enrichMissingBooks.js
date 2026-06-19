// node/enrichLibrary.js

const fs = require("fs");
const path = require("path");
const https = require("https");

// 🔑 PASTE YOUR FREE GOOGLE API KEY HERE
const GOOGLE_API_KEY = "AIzaSyDZG7qNxsAoiWCNTi9Ub4wAvdKnGZWSw9E";

const ROOT = path.join(__dirname, "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog.json");

// LOOSE MATCH CLEANER: Clips complex file titles down so the API search can match cleanly
function cleanLooseQuery(filename) {
  let clean = filename.replace(/\.[^/.]+$/, ""); // Strip file extension

  // Strip out archive markers
  clean = clean
    .replace(/\(Z-Library\)/gi, "")
    .replace(/\[Z-Library\]/gi, "")
    .replace(/Z-Library/gi, "");

  // Replace brackets, underscores, and dividers with blank spaces
  clean = clean.replace(/[\(\)\[\]\{\}\-_,]/g, " ");

  // Extract just the first 4 words of the file title to ensure loose matching works smoothly
  let parts = clean.trim().split(/\s+/);
  let coreTitle = parts.slice(0, 4).join(" ");

  return encodeURIComponent(coreTitle.trim());
}

// Low-overhead HTTPS Promise client
function fetchGoogleBooks(query) {
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
            resolve(JSON.parse(data));
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
  console.log("\n--- Starting Deep-Clean Match Engine (Strict Sequential Mode) ---");

  if (GOOGLE_API_KEY === "YOUR_API_KEY_HERE" || !GOOGLE_API_KEY) {
    console.error("❌ Please paste your free Google API Key into line 8 first!");
    return;
  }

  if (!fs.existsSync(CATALOG_FILE)) {
    console.error(`❌ Catalog database file not found at ${CATALOG_FILE}`);
    return;
  }

  let catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));

  // STEP 1: Identify all books that do not have an ISBN yet
  let missingBooks = [];
  for (let i = 0; i < catalog.length; i++) {
    const isbnVal = catalog[i].isbn;
    if (!isbnVal || isbnVal.trim() === "" || isbnVal === "PENDING") {
      // Keep track of the original catalog array index so we can update it correctly
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

  // STEP 2: Use a strict traditional 'for' loop to prevent asynchronous thread bleeding
  for (let currentStep = 0; currentStep < totalToProcess; currentStep++) {
    let item = missingBooks[currentStep];
    let targetCatalogIndex = item.originalIndex;
    let book = item.data;

    const searchPhrase = cleanLooseQuery(book.filename);

    // Explicit console progression tracker using the active loop index loop step
    console.log(`[Processing ${currentStep + 1}/${totalToProcess}] ${book.filename}`);
    console.log(`  🔎 Querying: "${decodeURIComponent(searchPhrase)}"`);

    try {
      let apiResult = await fetchGoogleBooks(searchPhrase);

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
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);

      // 🛑 STOPS SCRIPT IMMEDIATELY ON KEY/AUTH/QUOTA ERRORS
      if (err.message.includes("API_ERROR")) {
        console.error(`\n🛑 Critical Auth Error: Google API rejected the key. Stopping script execution cleanly.`);
        break;
      }
      console.log(`  Moving to next item...\n`);
    }

    // STEP 3: Safe pacing gap to let Google's server process the request calmly
    await delay(500);
  }

  console.log(`\n✨ Scan Complete! All missing records have been successfully evaluated.`);
}

runSequentialEnrichment();
