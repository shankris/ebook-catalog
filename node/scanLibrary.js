//  node/scanLibrary.js

const fs = require("fs");
const path = require("path");
const processPDF = require("./processors/pdfProcessor");
const processEPUB = require("./processors/epubProcessor");

const ROOT = path.join(__dirname, "..");
const EBOOKS_DIR = path.join(ROOT, "ebooks");
const COVERS_DIR = path.join(ROOT, "covers");
const CATALOG_FILE = path.join(ROOT, "data", "catalog.json");

// Helper to enforce standard forward slashes for comparisons
function normalizeToUrl(p) {
  return p.replace(/\\/g, "/");
}

// Ensure directories exist
if (!fs.existsSync(path.dirname(CATALOG_FILE))) {
  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
}

async function run() {
  console.log("\n--- Starting Smart Self-Healing Scan ---");

  // 1. Load Existing Catalog
  let catalog = [];
  if (fs.existsSync(CATALOG_FILE)) {
    try {
      catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    } catch (e) {
      console.error("Catalog corrupt. Starting fresh.");
    }
  }

  // 2. Build Fast Lookup Map
  const catalogMap = new Map(catalog.map((book) => [normalizeToUrl(book.filepath), book]));
  const foundPaths = new Set();
  const validCoverPaths = new Set(); // Track covers we actively need
  const updatedCatalog = [];

  // 3. Recursive File Walker (Ebooks)
  async function scan(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const relativePath = normalizeToUrl(path.relative(ROOT, fullPath));

      if (item.isDirectory()) {
        await scan(fullPath);
        continue;
      }

      const ext = path.extname(item.name).toLowerCase();
      if (ext !== ".pdf" && ext !== ".epub") continue;

      foundPaths.add(relativePath);
      const stats = fs.statSync(fullPath);
      const existing = catalogMap.get(relativePath);

      // Verify if the cover image physically exists on disk
      let coverExists = false;
      if (existing && existing.coverImage) {
        const absoluteCoverPath = path.join(ROOT, existing.coverImage);
        coverExists = fs.existsSync(absoluteCoverPath) || existing.coverImage === "covers/placeholder.jpg";
      }

      // 4. Decision: Process or Skip?
      const isModified = existing && new Date(existing.modifiedAt).getTime() !== stats.mtime.getTime();

      // REGENERATE TRIGGER: Process if new, modified, OR if the cover file vanished
      if (!existing || isModified || !coverExists) {
        if (existing && !coverExists) {
          console.log(`[Regenerating Cover] Cover missing for: ${item.name}`);
        } else {
          console.log(`${existing ? "[Updated]" : "[New]"} processing: ${item.name}`);
        }

        try {
          const result = ext === ".pdf" ? await processPDF(fullPath) : await processEPUB(fullPath);
          updatedCatalog.push(result);
          if (result.coverImage) validCoverPaths.add(normalizeToUrl(result.coverImage));
        } catch (err) {
          console.error(`Failed to process ${item.name}:`, err.message);
        }
      } else {
        // Exists, unchanged, and cover is safe on disk
        updatedCatalog.push(existing);
        if (existing.coverImage) validCoverPaths.add(normalizeToUrl(existing.coverImage));
      }
    }
  }

  await scan(EBOOKS_DIR);

  // ----------------------------------------------------
  // 5. Detect deleted books
  // ----------------------------------------------------

  const removedBooks = catalog.filter((book) => {
    return !foundPaths.has(normalizeToUrl(book.filepath));
  });

  for (const book of removedBooks) {
    console.log(`[Removed Book] ${book.filepath}`);

    if (book.coverImage && book.coverImage !== "covers/placeholder.jpg") {
      const coverPath = path.join(ROOT, book.coverImage);

      if (fs.existsSync(coverPath)) {
        fs.unlinkSync(coverPath);
        console.log(`  -> Deleted cover ${book.coverImage}`);
      }
    }
  }

  // updatedCatalog already contains only books that still exist
  const finalCatalog = updatedCatalog;

  // 6. Deep Clean Orphaned Covers (Cover exists -> No corresponding book file)
  if (fs.existsSync(COVERS_DIR)) {
    function cleanOrphanedCovers(dir) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = normalizeToUrl(path.relative(ROOT, fullPath));

        if (item.isDirectory()) {
          cleanOrphanedCovers(fullPath);
          // Clean up empty directory folders if they are left behind
          if (fs.readdirSync(fullPath).length === 0) {
            fs.rmdirSync(fullPath);
          }
          continue;
        }

        // Check if the current image on disk is in our valid cover tracker
        if (relativePath !== "covers/placeholder.jpg" && !validCoverPaths.has(relativePath)) {
          fs.unlinkSync(fullPath);
          console.log(`[Orphan Cleaned] Deleted detached cover file: ${relativePath}`);
        }
      }
    }
    cleanOrphanedCovers(COVERS_DIR);
  }

  // 7. Save Catalog
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(finalCatalog, null, 2), "utf8");
  console.log(`\nScan complete. Total active items: ${finalCatalog.length}`);
}

run();
