// node/scanLibrary.js

const fs = require("fs");
const path = require("path");
const processPDF = require("./processors/pdfProcessor");
const processEPUB = require("./processors/epubProcessor");

const ROOT = path.join(__dirname, "..");
const EBOOKS_DIR = path.join(ROOT, "ebooks");
const COVERS_DIR = path.join(ROOT, "covers");
const CATALOG_FILE = path.join(ROOT, "data", "catalog202607.json");

// Optional: Run with `FORCE_RESCAN=true node scanLibrary.js` if you ever want a full rebuild
const FORCE_RESCAN = process.env.FORCE_RESCAN === "true";

// Normalize paths to standard forward slashes
function normalizeToUrl(p) {
  return p ? p.replace(/\\/g, "/") : "";
}

if (!fs.existsSync(path.dirname(CATALOG_FILE))) {
  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
}

/**
 * Builds summary counts for authors, categories, series, and publishers.
 * Splits string values on common delimiters (commas, semicolons, slashes).
 */
function buildSummary(books, field) {
  const counts = new Map();

  books.forEach((book) => {
    const rawValue = book[field];
    if (!rawValue) return;

    let values = [];
    if (Array.isArray(rawValue)) {
      values = rawValue;
    } else if (typeof rawValue === "string") {
      values = rawValue.split(/[,;|/]+/);
    } else {
      values = [String(rawValue)];
    }

    values.forEach((val) => {
      const cleanVal = (val || "").trim();
      if (!cleanVal) return;
      counts.set(cleanVal, (counts.get(cleanVal) || 0) + 1);
    });
  });

  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Falls back to subfolder name if book metadata has no category
 */
function inferCategoryFromPath(fullPath) {
  const relativeFromEbooks = path.relative(EBOOKS_DIR, fullPath);
  const parts = relativeFromEbooks.split(path.sep);
  return parts.length > 1 ? parts[0] : "";
}

async function run() {
  console.log("\n--- Starting Optimized Conditional Catalog Scan ---");

  let existingCatalog = [];

  if (fs.existsSync(CATALOG_FILE)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
      existingCatalog = Array.isArray(existingData) ? existingData : existingData.books || [];
    } catch (e) {
      console.error("Existing catalog corrupt or unreadable. Starting fresh.");
    }
  }

  // Case-insensitive, slash-normalized Map lookup
  const catalogMap = new Map(existingCatalog.map((book) => [normalizeToUrl(book.filepath).toLowerCase(), book]));

  const foundFilePaths = new Set();
  const validCoverPaths = new Set();
  const updatedCatalog = [];
  let booksAdded = 0;
  let booksDeleted = 0;

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

      foundFilePaths.add(relativePath);

      const stats = fs.statSync(fullPath);
      const existingRecord = catalogMap.get(relativePath.toLowerCase());

      // 1. Check if cover file was specified but is missing on disk
      let coverMissing = false;
      if (existingRecord && existingRecord.coverImage && existingRecord.coverImage !== "covers/placeholder.jpg") {
        const absoluteCoverPath = path.join(ROOT, existingRecord.coverImage);
        if (!fs.existsSync(absoluteCoverPath)) {
          coverMissing = true;
        }
      }

      // 2. Check modification timestamp with 1-second tolerance
      let isModified = false;
      if (existingRecord && existingRecord.modifiedAt) {
        const recordedTime = new Date(existingRecord.modifiedAt).getTime();
        const actualTime = stats.mtime.getTime();
        if (isNaN(recordedTime) || Math.abs(recordedTime - actualTime) > 1000) {
          isModified = true;
        }
      }

      // Reprocess ONLY if forced, completely new, modified on disk, or specified cover is missing
      if (FORCE_RESCAN || !existingRecord || isModified || coverMissing) {
        if (!existingRecord) {
          booksAdded++;
          console.log(`[New Book] Processing: ${item.name}`);
        } else if (isModified) {
          console.log(`[Modified Timestamp] Reprocessing: ${item.name}`);
        } else if (coverMissing) {
          console.log(`[Missing Cover Image File] Regenerating: ${item.name}`);
        }

        try {
          const result = ext === ".pdf" ? await processPDF(fullPath) : await processEPUB(fullPath);
          const inferredCat = inferCategoryFromPath(fullPath);

          const transformedResult = {
            id: result.id,
            isbn: result.isbn || "",
            filename: result.filename,
            subTitle: result.subTitle || "",
            filepath: normalizeToUrl(result.filepath || relativePath),
            author: result.author || "",
            publisher: result.publisher || "",
            series: result.series || "",
            format: result.format,
            filesize: result.filesize,
            filesizeMB: result.filesizeMB,
            publishDate: result.publishDate || "",
            createdAt: result.createdAt,
            modifiedAt: result.modifiedAt || stats.mtime.toISOString(),
            scanDate: result.scanDate,
            category: result.category || inferredCat,
            subCat: result.subCat || "",
            subSubCat: result.subSubCat || "",
            tags: result.tags || "",
            favorite: result.favorite !== undefined ? result.favorite : false,
            rating: result.rating !== undefined ? result.rating : 0,
            coverImage: normalizeToUrl(result.coverImage || ""),
            language: result.language || "",
            pageCount: result.pageCount !== undefined ? result.pageCount : 0,
            description: result.description || "",
          };

          updatedCatalog.push(transformedResult);
          if (transformedResult.coverImage) {
            validCoverPaths.add(normalizeToUrl(transformedResult.coverImage));
          }
        } catch (err) {
          console.error(`❌ Failed processing ${item.name}:`, err.message);
        }
      } else {
        // Reuse existing record without reprocessing
        const inferredCat = inferCategoryFromPath(fullPath);

        const forcedHistoricalOrder = {
          id: existingRecord.id,
          isbn: existingRecord.isbn || "",
          filename: existingRecord.filename,
          subTitle: existingRecord.subTitle || "",
          filepath: normalizeToUrl(existingRecord.filepath),
          author: existingRecord.author || "",
          publisher: existingRecord.publisher || "",
          series: existingRecord.series || "",
          format: existingRecord.format,
          filesize: existingRecord.filesize,
          filesizeMB: existingRecord.filesizeMB,
          publishDate: existingRecord.publishDate || "",
          createdAt: existingRecord.createdAt,
          modifiedAt: existingRecord.modifiedAt,
          scanDate: existingRecord.scanDate,
          category: existingRecord.category || inferredCat,
          subCat: existingRecord.subCat || "",
          subSubCat: existingRecord.subSubCat || "",
          tags: existingRecord.tags || "",
          favorite: existingRecord.favorite !== undefined ? existingRecord.favorite : false,
          rating: existingRecord.rating !== undefined ? existingRecord.rating : 0,
          coverImage: normalizeToUrl(existingRecord.coverImage || ""),
          language: existingRecord.language || "",
          pageCount: existingRecord.pageCount !== undefined ? existingRecord.pageCount : 0,
          description: existingRecord.description || "",
        };

        updatedCatalog.push(forcedHistoricalOrder);
        if (forcedHistoricalOrder.coverImage) {
          validCoverPaths.add(normalizeToUrl(forcedHistoricalOrder.coverImage));
        }
      }
    }
  }

  await scan(EBOOKS_DIR);

  // Remove missing book records
  const finalCatalog = updatedCatalog.filter((book) => {
    const bookFilepath = normalizeToUrl(book.filepath);
    const physicallyExists = foundFilePaths.has(bookFilepath);

    if (!physicallyExists) {
      booksDeleted++;
      console.log(`[Removed Book] File missing on disk, purging record: ${bookFilepath}`);
      if (book.coverImage && book.coverImage !== "covers/placeholder.jpg") {
        const coverPath = path.join(ROOT, book.coverImage);
        if (fs.existsSync(coverPath)) {
          fs.unlinkSync(coverPath);
          console.log(`  -> Cleaned up deleted book's cover image.`);
        }
      }
    }
    return physicallyExists;
  });

  // Clean orphaned cover files
  if (fs.existsSync(COVERS_DIR)) {
    function cleanOrphanedCovers(dir) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = normalizeToUrl(path.relative(ROOT, fullPath));

        if (item.isDirectory()) {
          cleanOrphanedCovers(fullPath);
          if (fs.readdirSync(fullPath).length === 0) {
            fs.rmdirSync(fullPath);
          }
          continue;
        }

        if (relativePath !== "covers/placeholder.jpg" && !validCoverPaths.has(relativePath)) {
          fs.unlinkSync(fullPath);
          console.log(`[Orphan Cleaned] Deleted detached cover file: ${relativePath}`);
        }
      }
    }
    cleanOrphanedCovers(COVERS_DIR);
  }

  // Calculate totals
  const totalSizeBytes = finalCatalog.reduce((total, book) => total + (Number(book.filesize) || 0), 0);
  const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);
  const totalSizeGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
  const totalSizeGBDecimal = (totalSizeBytes / 1_000_000_000).toFixed(2);

  // Build full summary statistics across all books
  const summary = {
    authors: buildSummary(finalCatalog, "author"),
    categories: buildSummary(finalCatalog, "category"),
    series: buildSummary(finalCatalog, "series"),
    publishers: buildSummary(finalCatalog, "publisher"),
  };

  const output = {
    metadata: {
      lastUpdated: new Date().toISOString(),
      booksAdded,
      booksDeleted,
      netChange: booksAdded - booksDeleted,
      totalBooks: finalCatalog.length,
      totalSizeBytes,
      totalSizeMB,
      totalSizeGB,
      totalSizeGBDecimal,
    },
    summary,
    books: finalCatalog,
  };

  fs.writeFileSync(CATALOG_FILE, JSON.stringify(output, null, 2), "utf8");

  console.log(`\n✨ Scan complete.`);
  console.log(`Total Books: ${finalCatalog.length}`);
  console.log(`Summary Counts Updated: ${summary.authors.length} authors, ${summary.categories.length} categories.`);
}

run();
