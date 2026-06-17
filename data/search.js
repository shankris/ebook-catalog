// Global variable to store the library data
let libraryData = [];

// DOM Elements
const searchInput = document.getElementById("searchInput");
const resultsGrid = document.getElementById("resultsGrid");
const resultCount = document.getElementById("resultCount");

// 1. Load the JSON data
async function loadLibraryData() {
  try {
    const response = await fetch("catalog.json");
    libraryData = await response.json();

    // FIXED: Do NOT display records on page load. Keep it completely empty.
    displayResults([]);
  } catch (error) {
    console.error("Error loading JSON data:", error);
    resultsGrid.innerHTML = `<p style="text-align: center; color: red;">Failed to load library data.</p>`;
  }
}

// 2. Filter data based on input across ALL fields (Supports split words like "Tintin Tibet")
function searchLibrary(query) {
  const cleanQuery = query.toLowerCase().trim();

  // If search bar is empty, return an empty array immediately
  if (!cleanQuery) {
    return [];
  }

  // Split the user's input by spaces into an array of individual words
  // (e.g., "Tintin Tibet" becomes ["tintin", "tibet"])
  const searchWords = cleanQuery.split(/\s+/);

  return libraryData.filter((item) => {
    // Collect ALL text values from this specific book record into one big string
    const recordRowText = Object.values(item)
      .filter((value) => value !== null && value !== undefined)
      .map((value) => value.toString().toLowerCase())
      .join(" "); // Combines filename, series, author, format, etc.

    // EVERY word typed by the user must exist somewhere inside that combined string
    return searchWords.every((word) => recordRowText.includes(word));
  });
}

// 3. Render the matching books to the screen
function displayResults(books) {
  const resultsList = document.getElementById("resultsGrid");
  resultsList.innerHTML = "";

  const currentQuery = searchInput.value.trim();
  if (!currentQuery) {
    resultCount.textContent = "";
    return;
  }

  // Cap the scrollable display pool to 30 records
  const limitedBooks = books.slice(0, 30);

  if (books.length > 30) {
    resultCount.textContent = `Showing top 30 of ${books.length} records`;
  } else {
    resultCount.textContent = `Found ${books.length} record(s)`;
  }

  if (books.length === 0) {
    resultsList.innerHTML = `<p style="text-align: center; color: var(--text-light); padding: 2rem;">No results match your search.</p>`;
    return;
  }

  limitedBooks.forEach((book) => {
    const displayTitle = book.filename || book.subTitle || "Untitled Document";

    let subMetaText = [];
    if (book.series) subMetaText.push(`Series: ${book.series}`);
    if (book.author) subMetaText.push(`By: ${book.author}`);
    subMetaText.push(`${book.filesizeMB || "0"} MB`);

    // 1. FIX: Convert all Windows backslashes (\) into Web forward slashes (/)
    let standardizedCover = book.coverImage ? book.coverImage.replace(/\\/g, "/") : "";
    let standardizedFile = book.filepath ? book.filepath.replace(/\\/g, "/") : "";

    // 2. FIX: Resolve relative path out of the "data/" subfolder
    let correctedImagePath = "";
    if (standardizedCover) {
      correctedImagePath = standardizedCover.startsWith("covers/") ? `../${standardizedCover}` : standardizedCover;
    }

    const row = document.createElement("div");
    row.classList.add("book-row");

    row.innerHTML = `
            <div class="thumb-wrapper" id="wrapper-${book.id}">
                <img class="thumb-image" 
                     src="${correctedImagePath}" 
                     alt="" 
                     onerror="document.getElementById('wrapper-${book.id}').classList.add('no-cover'); this.remove();">
            </div>
            <div class="book-details">
                <div class="book-title" title="${displayTitle}">${displayTitle}</div>
                <div class="book-sub-meta">${subMetaText.join("  •  ")}</div>
            </div>
            <div class="book-badges">
                <span class="badge">${book.format.toUpperCase()}</span>
                ${book.favorite ? '<span class="badge" style="background:#fef3c7; color:#d97706;">★</span>' : ""}
            </div>
        `;

    // 3. FIX: Safely route clicked links out of data/ folder using fixed forward slashes
    row.addEventListener("click", () => {
      if (standardizedFile) {
        const correctedFilePath = standardizedFile.startsWith("ebooks/") ? `../${standardizedFile}` : standardizedFile;
        window.open(correctedFilePath, "_blank");
      }
    });

    resultsList.appendChild(row);
  });
}

// 4. Debounce function to limit rapid executions while typing
function debounce(func, delay = 250) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(null, args), delay);
  };
}

// 5. Event Listener for Typing
searchInput.addEventListener(
  "input",
  debounce((e) => {
    const filteredBooks = searchLibrary(e.target.value);
    displayResults(filteredBooks);
  }),
);

// Initialize App
loadLibraryData();
