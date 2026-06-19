// node/enrichLibrary.js

const fs = require("fs");
const path = require("path");
const https = require("https");

// 🔑 PASTE YOUR FREE GOOGLE API KEY HERE
const GOOGLE_API_KEY = "AIzaSyAIoh3PfhLMtQmoIPylc1nDtHtguBjbzyU";

const ROOT = path.join(__dirname, "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog.json");

// Automatically creates a perfect search string from the filename
function cleanFilenameForSearch(filename) {
  let clean = filename.replace(/\.[^/.]+$/, ""); // Strip file extension (.epub, .pdf)

  // Strip out archive tags
  clean = clean
    .replace(/\(Z-Library\)/gi, "")
    .replace(/\[Z-Library\]/gi, "")
    .replace(/Z-Library/gi, "");

  // Replace parentheses and brackets with blank spaces so text inside stays searchable
  clean = clean.replace(/[\(\)\[\]\{\}]/g, " ");

  // Clean up double spaces
  return encodeURIComponent(clean.replace(/\s+/g, " ").trim());
}

// Promisified HTTPS request to Google Books API using your API Key
function fetchGoogleBooks(query) {
  return new Promise((resolve, reject) => {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1&key=${GOOGLE_API_KEY}`;

    https
      .get(url, (res) => {
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

async function runEnrichment() {
  console.log("\n--- Starting Full Catalog Automation (Google API Key Mode) ---");

  if (GOOGLE_API_KEY === "YOUR_API_KEY_HERE") {
    console.error("❌ Please paste your free Google API Key into line 8 of this script first!");
    return;
  }

  if (!fs.existsSync(CATALOG_FILE)) {
    console.error(`❌ Catalog file not found at ${CATALOG_FILE}.`);
    return;
  }

  let catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  let updatedCount = 0;

  // Filter down to rows missing an ISBN
  const targetBooks = catalog.filter((book) => !book.isbn || book.isbn.trim() === "");
  console.log(`📊 Total Catalog Size: ${catalog.length} books.`);
  console.log(`🔍 Un-enriched Books to Process: ${targetBooks.length} items.\n`);

  if (targetBooks.length === 0) {
    console.log("🏁 All 1,335 books are fully enriched!");
    return;
  }

  for (let i = 0; i < catalog.length; i++) {
    let book = catalog[i];

    // Skip if already filled
    if (book.isbn && book.isbn.trim() !== "") {
      continue;
    }

    const query = cleanFilenameForSearch(book.filename);
    console.log(`[Processing ${updatedCount + 1}/${targetBooks.length}] ${book.filename}`);

    try {
      const apiResult = await fetchGoogleBooks(query);

      if (apiResult.items && apiResult.items.length > 0) {
        const volumeInfo = apiResult.items[0].volumeInfo;

        let isbn13 = "";
        if (volumeInfo.industryIdentifiers) {
          const match = volumeInfo.industryIdentifiers.find((id) => id.type === "ISBN_13");
          if (match) isbn13 = match.identifier;
        }

        // Correctly update fields and overwrite wrong metadata with verified database answers
        catalog[i] = {
          id: book.id,
          isbn: isbn13 || book.isbn || "",
          filename: book.filename,
          subTitle: volumeInfo.subtitle || "",
          filepath: book.filepath,
          author: volumeInfo.authors ? volumeInfo.authors.join(", ") : book.author || "",
          publisher: volumeInfo.publisher || "",
          series: book.series || "",
          format: book.format,
          filesize: book.filesize,
          filesizeMB: book.filesizeMB,
          publishDate: volumeInfo.publishedDate || "",
          createdAt: book.createdAt,
          modifiedAt: book.modifiedAt,
          scanDate: book.scanDate,
          category: volumeInfo.categories ? volumeInfo.categories[0] : "",
          subCat: book.subCat || "",
          subSubCat: book.subSubCat || "",
          tags: volumeInfo.categories ? volumeInfo.categories.join(", ") : "",
          favorite: book.favorite,
          rating: book.rating,
          coverImage: book.coverImage,
          language: volumeInfo.language || "",
          pageCount: volumeInfo.pageCount || 0,
          description: volumeInfo.description ? volumeInfo.description.substring(0, 400) + "..." : "",
        };

        updatedCount++;
        console.log(`  ✅ Successfully Saved! -> ISBN: ${catalog[i].isbn} | Author: ${catalog[i].author}`);

        // Write instantly back to catalog.json so no work is ever lost
        fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8");
      } else {
        console.log(`  ❌ No matches found on Google Database.`);
      }
    } catch (err) {
      console.error(`  ❌ Network Error: ${err.message}`);
    }

    // Small 250ms sleep to keep execution smooth and steady
    await delay(250);
  }

  console.log(`\n✨ Automation Complete! Enriched and updated ${updatedCount} books inside your catalog file.`);
}

runEnrichment();
