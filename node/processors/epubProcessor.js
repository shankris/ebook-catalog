const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { XMLParser } = require("fast-xml-parser");
const generateId = require("../utils/idGenerator");

const ROOT = path.join(__dirname, "..", "..");

async function processEPUB(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const id = generateId();

    // ---------------------------------
    // Maintain folder structure
    // ---------------------------------
    const relativeDir = path.relative(
      path.join(ROOT, "ebooks"),
      path.dirname(filePath)
    );

    const coversDir = path.join(ROOT, "covers", relativeDir);
    fs.mkdirSync(coversDir, { recursive: true });

    // ---------------------------------
    // Open EPUB
    // ---------------------------------
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();

    // ---------------------------------
    // Find container.xml
    // ---------------------------------
    const containerEntry = entries.find(
      (entry) => entry.entryName === "META-INF/container.xml"
    );

    if (!containerEntry) {
      throw new Error("container.xml not found");
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
    });

    // ---------------------------------
    // Read container.xml
    // ---------------------------------
    const containerText = containerEntry.getData().toString("utf8");

    // ---------------------------------
    // Extract OPF path
    // ---------------------------------
    const match = containerText.match(/full-path="([^"]+)"/);
    if (!match) {
      throw new Error("OPF path missing");
    }

    const opfPath = match[1];
    const normalizedOpfPath = opfPath.replace(/\\/g, "/");

    // ---------------------------------
    // Find OPF file
    // ---------------------------------
    const opfEntry = entries.find(
      (entry) =>
        entry.entryName.replace(/\\/g, "/") === normalizedOpfPath
    );

    if (!opfEntry) {
      throw new Error("OPF file not found");
    }

    // ---------------------------------
    // Parse OPF XML
    // ---------------------------------
    const opfXml = parser.parse(opfEntry.getData().toString("utf8"));

    if (!opfXml.package || !opfXml.package.manifest) {
      throw new Error("Invalid OPF structural layout");
    }

    const manifestItems = opfXml.package.manifest.item;
    const manifest = Array.isArray(manifestItems) ? manifestItems : [manifestItems];

    let coverHref = null;

    // ---------------------------------
    // Strategy A: Try EPUB 3 Standard (properties="cover-image")
    // ---------------------------------
    for (const item of manifest) {
      const props = item["@_properties"] || "";
      if (props.split(" ").includes("cover-image")) {
        coverHref = item["@_href"];
        break;
      }
    }

    // ---------------------------------
    // Strategy B: Fallback to EPUB 2 Standard (meta tags)
    // ---------------------------------
    if (!coverHref && opfXml.package.metadata) {
      const metadata = opfXml.package.metadata;
      const meta = metadata.meta || [];
      const metaArray = Array.isArray(meta) ? meta : [meta];

      let coverId = null;
      for (const item of metaArray) {
        if (item["@_name"] === "cover") {
          coverId = item["@_content"];
          break;
        }
      }

      if (coverId) {
        for (const item of manifest) {
          if (item["@_id"] === coverId) {
            coverHref = item["@_href"];
            break;
          }
        }
      }
    }

    // ---------------------------------
    // Strategy C: Heuristic search inside the Manifest IDs
    // ---------------------------------
    if (!coverHref) {
      for (const item of manifest) {
        const itemId = String(item["@_id"] || "").toLowerCase();
        if (itemId === "cover" || itemId === "cover-image" || itemId.includes("thumb")) {
          coverHref = item["@_href"];
          break;
        }
      }
    }

    // ---------------------------------
    // Resolve Cover Entry Object
    // ---------------------------------
    let coverEntry = null;
    let finalExtension = ".jpg";

    if (coverHref) {
      const opfDir = path.dirname(opfPath);
      const decodedCoverHref = decodeURIComponent(coverHref);
      const coverPath = path.join(opfDir, decodedCoverHref);
      const normalizedCoverPath = coverPath.replace(/\\/g, "/");

      coverEntry = entries.find(
        (entry) => entry.entryName === normalizedCoverPath
      );
      if (coverEntry) {
        finalExtension = path.extname(decodedCoverHref) || ".jpg";
      }
    }

    // ---------------------------------
    // Strategy D: Scan Zip Entries Directly for Cover Names
    // ---------------------------------
    if (!coverEntry) {
      const structuralCoverEntry = entries.find((entry) => {
        const name = path.basename(entry.entryName).toLowerCase();
        const ext = path.extname(name);
        const validExts = [".jpg", ".jpeg", ".png", ".gif"];

        if (!validExts.includes(ext)) return false;

        return (
          name.startsWith("cover") ||
          name.startsWith("thumbnail") ||
          name.includes("front-cover") ||
          name === "folder.jpg"
        );
      });

      if (structuralCoverEntry) {
        coverEntry = structuralCoverEntry;
        finalExtension = path.extname(structuralCoverEntry.entryName) || ".jpg";
      }
    }

    // ---------------------------------
    // Strategy E: First Image Found (Desperation Mode)
    // ---------------------------------
    if (!coverEntry) {
      const firstImageEntry = entries.find((entry) => {
        const name = entry.entryName.toLowerCase();
        return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
      });

      if (firstImageEntry) {
        coverEntry = firstImageEntry;
        finalExtension = path.extname(firstImageEntry.entryName) || ".jpg";
      }
    }

    // ---------------------------------
    // Finalize Image Extraction or Fallback to Placeholder
    // ---------------------------------
    let relativeCoverImage = "covers/placeholder.jpg"; // Default global placeholder

    if (coverEntry) {
      const absoluteCoverImage = path.join(coversDir, `${id}${finalExtension}`);
      fs.writeFileSync(absoluteCoverImage, coverEntry.getData());
      relativeCoverImage = path.relative(ROOT, absoluteCoverImage);
    } else {
      console.warn(`  [Notice] No images found inside "${path.basename(filePath)}". Defaulting to placeholder.`);
    }

    const relativeFilePath = path.relative(ROOT, filePath);

    return {
      id,
      filename: path.basename(filePath),
      filepath: relativeFilePath,
      format: "epub",
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
      notes: coverEntry ? "" : "No embedded cover found; used placeholder image.",
    };
  } catch (err) {
    console.error("\nEPUB processing failed:");
    console.error(filePath);
    console.error(err);

    return {
      filename: path.basename(filePath),
      filepath: path.relative(ROOT, filePath),
      status: "error",
      error: err.message,
    };
  }
}

module.exports = processEPUB;