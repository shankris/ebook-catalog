const fs = require("fs");
const path = require("path");

// =====================================
// Configuration - Update these values
// =====================================

const scanFolder = "E:\\Ebooks\\ebook-catalog\\ebooks";
const minimumSizeMB = 40;

const outputFile = "largeFiles.json";

// =====================================
// Scanner variables
// =====================================

const minimumBytes = minimumSizeMB * 1024 * 1024;

let largeFiles = [];
let totalFilesScanned = 0;

// =====================================
// Recursive folder scan
// =====================================

function scanFolderRecursive(folder) {
  let entries;

  try {
    entries = fs.readdirSync(folder, {
      withFileTypes: true,
    });
  } catch (error) {
    console.log("Cannot access:", folder);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);

    try {
      if (entry.isDirectory()) {
        scanFolderRecursive(fullPath);
      } else {
        totalFilesScanned++;

        const stats = fs.statSync(fullPath);

        if (stats.size >= minimumBytes) {
          largeFiles.push({
            name: entry.name,

            folderPath: path.dirname(fullPath),

            extension: path.extname(entry.name).toLowerCase(),

            sizeBytes: stats.size,

            sizeMB: Number((stats.size / 1024 / 1024).toFixed(2)),

            created: stats.birthtime,

            modified: stats.mtime,
          });
        }
      }
    } catch (error) {
      console.log("Skipped:", fullPath);
    }
  }
}

// =====================================
// Start Scan
// =====================================

console.log("");
console.log("==============================");
console.log("Large File Scanner");
console.log("==============================");

console.log("Folder:");
console.log(scanFolder);

console.log(`Minimum Size: ${minimumSizeMB} MB`);

console.log("");

scanFolderRecursive(scanFolder);

// =====================================
// Sort largest files first
// =====================================

largeFiles.sort((a, b) => b.sizeBytes - a.sizeBytes);

// =====================================
// Create JSON
// =====================================

const result = {
  scanInfo: {
    rootFolder: scanFolder,

    scanDate: new Date().toISOString(),

    minimumFileSizeMB: minimumSizeMB,

    totalFilesScanned,

    largeFilesFound: largeFiles.length,
  },

  files: largeFiles,
};

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));

console.log("==============================");
console.log("Completed");
console.log("==============================");

console.log("Files scanned:", totalFilesScanned);

console.log("Large files found:", largeFiles.length);

console.log("JSON created:", outputFile);
