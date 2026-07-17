const fs = require("fs");
const path = require("path");
const processPDF = require("./processors/pdfProcessor");
const processEPUB = require("./processors/epubProcessor");

const ROOT = path.resolve(__dirname, "..");
const EBOOKS_BASE = path.join(ROOT, "ebooks/ebooks2");
const COVERS_BASE = path.join(ROOT, "ebooks/covers");
const CATALOG_FILE = path.join(ROOT, "data", "ebooks/catalog2026.json");

function normalizeToUrl(p) {
  return p.replace(/\\/g, "/");
}

if (!fs.existsSync(path.dirname(CATALOG_FILE))) {
  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
}

async function run() {
  console.log("\n--- Starting Catalog Scan ---");
  let existingCatalog = [];
  if (fs.existsSync(CATALOG_FILE)) {
    try {
      existingCatalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8")).books || [];
    } catch (e) {
      console.error("Catalog corrupt. Starting fresh.");
    }
  }

  const catalogMap = new Map(existingCatalog.map((b) => [normalizeToUrl(b.filepath), b]));
  const foundFilePaths = new Set();
  const validCoverPaths = new Set();
  const updatedCatalog = [];

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
      const existingRecord = catalogMap.get(relativePath);

      let coverExists = existingRecord && existingRecord.coverImage && (fs.existsSync(path.join(ROOT, existingRecord.coverImage)) || existingRecord.coverImage.includes("placeholder"));
      const isModified = existingRecord && new Date(existingRecord.modifiedAt).getTime() !== stats.mtime.getTime();

      if (!existingRecord || isModified || !coverExists) {
        try {
          const result = ext === ".pdf" ? await processPDF(fullPath) : await processEPUB(fullPath);
          updatedCatalog.push(result);
          if (result.coverImage) validCoverPaths.add(normalizeToUrl(result.coverImage));
        } catch (err) {
          console.error(`❌ Failed: ${item.name}`, err.message);
        }
      } else {
        updatedCatalog.push(existingRecord);
        validCoverPaths.add(normalizeToUrl(existingRecord.coverImage));
      }
    }
  }

  await scan(EBOOKS_BASE);

  // Clean orphans
  const finalCatalog = updatedCatalog.filter((book) => {
    const physicallyExists = foundFilePaths.has(normalizeToUrl(book.filepath));
    if (!physicallyExists && book.coverImage && !book.coverImage.includes("placeholder")) {
      const cPath = path.join(ROOT, book.coverImage);
      if (fs.existsSync(cPath)) fs.unlinkSync(cPath);
    }
    return physicallyExists;
  });

  // Recursive directory cleaner for covers
  function cleanEmptyDirs(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        cleanEmptyDirs(full);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      }
    }
  }
  if (fs.existsSync(COVERS_BASE)) cleanEmptyDirs(COVERS_BASE);

  fs.writeFileSync(CATALOG_FILE, JSON.stringify({ books: finalCatalog }, null, 2), "utf8");
  console.log("✨ Scan complete.");
}
run();
