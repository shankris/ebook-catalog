// node/scanLibrary.js

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

// Ensure clean directories exist before execution
if (!fs.existsSync(path.dirname(CATALOG_FILE))) {
fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
}

async function run() {
console.log("\n--- Starting Fresh Catalog Generation ---");

const validCoverPaths = new Set();
const freshCatalog = [];

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

console.log(`[Processing File] -> ${item.name}`);

try {
// Raw extraction from parsing processors
const result = ext === ".pdf" ? await processPDF(fullPath) : await processEPUB(fullPath);

// Destructure and drop ALL unwanted fields completely
const { id, filename, filepath, readingStatus, source, checksum, status, notes, ...rest } = result;

// Force construction using your exact structural key blueprint
const transformedResult = {
id,
filename,
filepath,
author: result.author || "",
publisher: result.publisher || "",
series: result.series || "",
...rest,
};

freshCatalog.push(transformedResult);
if (transformedResult.coverImage) {
validCoverPaths.add(normalizeToUrl(transformedResult.coverImage));
}
} catch (err) {
console.error(`❌ Failed processing ${item.name}:`, err.message);
}
}
}

// Execute fresh crawl across the directory
await scan(EBOOKS_DIR);

// Deep Clean Orphaned Covers
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

// Clean out images that weren't re-verified by this scan run
if (relativePath !== "covers/placeholder.jpg" && !validCoverPaths.has(relativePath)) {
fs.unlinkSync(fullPath);
console.log(`[Orphan Cleaned] Deleted detached cover file: ${relativePath}`);
}
}
}
cleanOrphanedCovers(COVERS_DIR);
}

// Save clean snapshot to data/catalog.json
fs.writeFileSync(CATALOG_FILE, JSON.stringify(freshCatalog, null, 2), "utf8");
console.log(`\n✨ Fresh scan complete. Total items compiled: ${freshCatalog.length}`);
}

run();