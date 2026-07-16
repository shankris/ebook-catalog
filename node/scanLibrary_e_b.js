//  node/scanLibrary.js

const fs = require("fs");
const path = require("path");
const processPDF = require("./processors/pdfProcessor");
const processEPUB = require("./processors/epubProcessor");

const ROOT = path.join(__dirname, "..");
const EBOOKS_DIR = path.join(ROOT, "ebooks/ebooks2");
const COVERS_DIR = path.join(ROOT, "ebooks/covers");
const CATALOG_FILE = path.join(ROOT, "data", "ebooks/catalog2026.json");

// Helper to enforce standard forward slashes for comparisons
function normalizeToUrl(p) {
  return p.replace(/\\/g, "/");
}

// Ensure clean directories exist before execution
if (!fs.existsSync(path.dirname(CATALOG_FILE))) {
  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
}

async function run() {
  console.log("\n--- Starting Optimized Conditional Catalog Scan ---");

  // 1. Load Existing Catalog for differential checking
  let existingCatalog = [];

  if (fs.existsSync(CATALOG_FILE)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));

      // Supports both old and new catalog formats
      existingCatalog = Array.isArray(existingData) ? existingData : existingData.books || [];
    } catch (e) {
      console.error("Existing catalog corrupt or unreadable. Starting fresh.");
    }
  }

  // Map to look up existing catalog records instantly by their filepath
  const catalogMap = new Map(existingCatalog.map((book) => [normalizeToUrl(book.filepath), book]));

  const foundFilePaths = new Set();
  const validCoverPaths = new Set();
  const updatedCatalog = [];
  let booksAdded = 0;
  let booksDeleted = 0;

  // Recursive File Walker (Ebooks)
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

      // Track that this book physically exists on the disk right now
      foundFilePaths.add(relativePath);

      const stats = fs.statSync(fullPath);
      const existingRecord = catalogMap.get(relativePath);

      // Rule: Check if the cover file physically exists on the disk
      let coverExists = false;
      if (existingRecord && existingRecord.coverImage) {
        const absoluteCoverPath = path.join(ROOT, existingRecord.coverImage);
        coverExists = fs.existsSync(absoluteCoverPath) || existingRecord.coverImage === "covers/placeholder.jpg";
      }

      // Rule: Verify if the update date stamp (`modifiedAt`) on the book file has changed
      const isModified = existingRecord && new Date(existingRecord.modifiedAt).getTime() !== stats.mtime.getTime();

      // Evaluation Logic: Reprocess if:
      // - New book has been added (!existingRecord)
      // - The file update date stamp has changed (isModified)
      // - The cover image does not exist (!coverExists)
      if (!existingRecord || isModified || !coverExists) {
        if (!existingRecord) {
          booksAdded++;
          console.log(`[New Book] Processing: ${item.name}`);
        } else if (isModified) {
          console.log(`[Modified Timestamp] Reprocessing: ${item.name}`);
        } else if (!coverExists) {
          console.log(`[Missing Cover Image] Regenerating: ${item.name}`);
        }

        try {
          const result = ext === ".pdf" ? await processPDF(fullPath) : await processEPUB(fullPath);

          // Force construction using your exact structural key blueprint order for flat-file sorting
          const transformedResult = {
            id: result.id,
            isbn: result.isbn || "",
            filename: result.filename,
            subTitle: result.subTitle || "",
            filepath: result.filepath,
            author: result.author || "",
            publisher: result.publisher || "",
            series: result.series || "",
            format: result.format,
            filesize: result.filesize,
            filesizeMB: result.filesizeMB,
            publishDate: result.publishDate || "",
            createdAt: result.createdAt,
            modifiedAt: result.modifiedAt,
            scanDate: result.scanDate,
            category: result.category || "",
            subCat: result.subCat || "",
            subSubCat: result.subSubCat || "",
            tags: result.tags || "",
            favorite: result.favorite !== undefined ? result.favorite : false,
            rating: result.rating !== undefined ? result.rating : 0,
            coverImage: result.coverImage || "",
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
        // Rule: Do not reprocess if the cover exists, update date is same on the record and the book, and there is a record in the json

        // Re-enforce explicit flat field row placement sorting layout rules to historical matching objects too
        const forcedHistoricalOrder = {
          id: existingRecord.id,
          isbn: existingRecord.isbn || "",
          filename: existingRecord.filename,
          subTitle: existingRecord.subTitle || "",
          filepath: existingRecord.filepath,
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
          category: existingRecord.category || "",
          subCat: existingRecord.subCat || "",
          subSubCat: existingRecord.subSubCat || "",
          tags: existingRecord.tags || "",
          favorite: existingRecord.favorite !== undefined ? existingRecord.favorite : false,
          rating: existingRecord.rating !== undefined ? existingRecord.rating : 0,
          coverImage: existingRecord.coverImage || "",
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

  // Execute conditional scan across the ebook directory
  await scan(EBOOKS_DIR);

  // Rule: Book has been removed then delete the cover and the record from json
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

  // Rule: If the cover image exists but does not have a corresponding book then delete the cover
  if (fs.existsSync(COVERS_DIR)) {
    function cleanOrphanedCovers(dir) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = normalizeToUrl(path.relative(ROOT, fullPath));

        if (item.isDirectory()) {
          cleanOrphanedCovers(fullPath);
          // Clean up empty tracking folders left behind
          if (fs.readdirSync(fullPath).length === 0) {
            fs.rmdirSync(fullPath);
          }
          continue;
        }

        // Clean out image assets that weren't actively re-verified by this scan cycle
        if (relativePath !== "covers/placeholder.jpg" && !validCoverPaths.has(relativePath)) {
          fs.unlinkSync(fullPath);
          console.log(`[Orphan Cleaned] Deleted detached cover file: ${relativePath}`);
        }
      }
    }
    cleanOrphanedCovers(COVERS_DIR);
  }

  // Save clean snapshot to data/catalog.json
  const output = {
    metadata: {
      lastUpdated: new Date().toISOString(),
      booksAdded,
      booksDeleted,
      netChange: booksAdded - booksDeleted,
      totalBooks: finalCatalog.length,
    },
    books: finalCatalog,
  };

  fs.writeFileSync(CATALOG_FILE, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n✨ Scan complete. Total items compiled: ${finalCatalog.length}`);
}

run();
