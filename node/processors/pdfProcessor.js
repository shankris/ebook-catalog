// node/processors/pdfProcessor.js

const fs = require("fs");
const path = require("path");
const pdf = require("pdf-poppler");
const generateId = require("../utils/idGenerator");

const ROOT = path.join(__dirname, "..", "..");

async function processPDF(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const id = generateId();

    // -----------------------------
    // Maintain ebook folder structure
    // -----------------------------
    const relativeDir = path.relative(
      path.join(ROOT, "ebooks"),
      path.dirname(filePath)
    );

    const coversDir = path.join(ROOT, "covers", relativeDir);

    fs.mkdirSync(coversDir, {
      recursive: true,
    });

    // -----------------------------
    // Generate first-page cover
    // -----------------------------
    const options = {
      format: "jpeg",
      out_dir: coversDir,
      out_prefix: id, // Will create something like id-1.jpg or id-001.jpg
      page: 1,
      scale: 0.7,
    };

    await pdf.convert(filePath, options);

    // -------------------------------------------------------------
    // CRITICAL FIX: Find what file pdf-poppler actually generated
    // -------------------------------------------------------------
    const files = fs.readdirSync(coversDir);
    // Find the file that starts with our unique ID and ends with .jpg
    const generatedFile = files.find(file => file.startsWith(id) && file.toLowerCase().endsWith(".jpg"));

    if (!generatedFile) {
      throw new Error("PDF cover generation completed, but output file could not be found on disk.");
    }

    const initialAbsoluteCover = path.join(coversDir, generatedFile);
    const finalAbsoluteCover = path.join(coversDir, `${id}.jpg`);

    // Clean up: Rename it to exactly {id}.jpg (stripping out any -1, -01, or -001 variations)
    if (initialAbsoluteCover !== finalAbsoluteCover) {
      fs.renameSync(initialAbsoluteCover, finalAbsoluteCover);
    }

    // relative path for JSON (Force forward slashes for cross-platform matching)
    const relativeCoverImage = path.relative(ROOT, finalAbsoluteCover).replace(/\\/g, "/");
    const relativeFilePath = path.relative(ROOT, filePath).replace(/\\/g, "/");

    return {
      id,
      filename: path.basename(filePath),
      filepath: relativeFilePath,
      format: "pdf",
      filesize: stat.size,
      filesizeMB: (stat.size / 1024 / 1024).toFixed(2),
      createdAt: stat.birthtime,
      modifiedAt: stat.mtime,
      scanDate: new Date(),
      category: "",
      subCat: "",
      subSubCat: "",
      tags: "",
      favorite: false,
      rating: null,
      readingStatus: "unread",
      source: "",
      coverImage: relativeCoverImage,
      checksum: "",
      status: "processed",
      notes: "",
    };
  } catch (err) {
    console.error("\nPDF processing failed:");
    console.error(filePath);
    console.error(err);

    return {
      filename: path.basename(filePath),
      filepath: path.relative(ROOT, filePath).replace(/\\/g, "/"),
      status: "error",
      error: err.message,
    };
  }
}

module.exports = processPDF;