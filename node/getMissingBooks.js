// node/getMissingBooks.js

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog.json");
const OUTPUT_FILE = path.join(ROOT, "data", "missing_books.txt");

function extractMissing() {
  console.log("\n--- Scanning Catalog for Unmatched Books ---");

  if (!fs.existsSync(CATALOG_FILE)) {
    console.error(`❌ Catalog file not found at ${CATALOG_FILE}.`);
    return;
  }

  // Load the current catalog database
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));

  // Filter for books where the ISBN is missing or completely empty
  const missingBooks = catalog.filter((book) => !book.isbn || book.isbn.trim() === "");

  console.log(`📊 Total Catalog: ${catalog.length} books.`);
  console.log(`❌ Unmatched/Missing Records: ${missingBooks.length} books.\n`);

  if (missingBooks.length === 0) {
    console.log("🎉 Amazing! Every single book in your library has a valid record.");
    return;
  }

  // Extract just the filenames/titles
  let outputText = `--- UNMATCHED EBOOKS LIST (${missingBooks.length} TOTAL) ---\n\n`;

  missingBooks.forEach((book, index) => {
    const line = `[${index + 1}] ID: ${book.id} | File: ${book.filename}`;
    console.log(line); // Print to your terminal window
    outputText += `${book.filename}\n`; // Append clean filename to text file string
  });

  // Save the clean text list to data/missing_books.txt
  fs.writeFileSync(OUTPUT_FILE, outputText, "utf8");

  console.log(`\n💾 Clean text list saved successfully to: ${OUTPUT_FILE}`);
  console.log(`💡 You can open that file to see a clean copy-pasteable list of titles!`);
}

extractMissing();
