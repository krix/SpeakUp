/**
 * Westermann Vokabeltrainer (Firebase) – Katalog und Buch-Import.
 *
 * Die Daten liegen öffentlich lesbar in Firestore/Storage des Projekts
 * iw-iwk00110-vokabel-2019. Es wird nur lesend zugegriffen; der API-Key ist
 * im offiziellen Vokabeltrainer-Client eingebettet (siehe FETCH_DATA.md).
 *
 * Nur für Bücher verwenden, auf die der Nutzer Zugriff hat.
 */

export const WESTERMANN = {
  project: "iw-iwk00110-vokabel-2019",
  apiKey: "AIzaSyB7I3wDjiuOmeMtvbLXy-yJKcUiMb1uQm8",
  bucket: "iw-iwk00110-vokabel-2019.appspot.com",
};

const FIRESTORE_BASE =
  `https://firestore.googleapis.com/v1/projects/${WESTERMANN.project}/databases/(default)/documents`;
const STORAGE_BASE =
  `https://firebasestorage.googleapis.com/v0/b/${WESTERMANN.bucket}/o`;

function encodeStoragePath(parts) {
  return parts.map((part) => encodeURIComponent(part)).join("%2F");
}

/** Öffentliche Storage-URL für Buch-Medien. Kein Auth-Token nötig. */
export function storageUrl(bookId, kind, filename) {
  const clean = String(filename || "").trim();
  if (!bookId || !clean) return "";
  const path = encodeStoragePath(["book", bookId, "files", kind, clean]);
  return `${STORAGE_BASE}/${path}?alt=media`;
}

function asString(field) {
  return typeof field?.stringValue === "string" ? field.stringValue : "";
}
function asInt(field) {
  const raw = field?.integerValue ?? field?.doubleValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
function asArray(field) {
  return Array.isArray(field?.arrayValue?.values) ? field.arrayValue.values : [];
}
function asMap(field) {
  return field?.mapValue?.fields && typeof field.mapValue.fields === "object"
    ? field.mapValue.fields
    : null;
}

/** Firestore-Dokument -> schlankes Buchobjekt für die Kataloganzeige. */
export function parseBookSummary(doc) {
  const fields = doc?.fields || {};
  const id = String(doc?.name || "").split("/").pop() || asString(fields.id);
  const vocab = asArray(fields.vocabulary);
  return {
    id,
    name: asString(fields.name) || id,
    language: asString(fields.language) || "",
    vocabCount: vocab.length,
    coverUrl: asString(fields.cover_image_url) || "",
    bookVolume: asString(fields.book_volume) || "",
  };
}

/** Lädt die Buchliste aus Firestore. filterLanguage z.B. "en" oder "" für alle. */
export async function fetchBookCatalog({ language = "en", signal } = {}) {
  const books = [];
  let pageToken = "";
  while (true) {
    const url = new URL(`${FIRESTORE_BASE}/book`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("key", WESTERMANN.apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bücherliste konnte nicht geladen werden (HTTP ${res.status}). ${text.slice(0, 120)}`);
    }
    const data = await res.json();
    for (const doc of data.documents || []) {
      const book = parseBookSummary(doc);
      if (!book.id || !book.name) continue;
      if (language && book.language && book.language !== language) continue;
      books.push(book);
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  books.sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
  return books;
}

function normalizeChapterId(value) {
  return String(value ?? "").trim();
}

function parseChapters(fields) {
  const chapters = asArray(fields.chapters)
    .map((entry) => {
      const map = asMap(entry);
      if (!map) return null;
      return {
        id: normalizeChapterId(asString(map.id)),
        name: asString(map.name),
        pos: asInt(map.pos),
      };
    })
    .filter(Boolean);
  chapters.sort((a, b) => a.pos - b.pos || a.name.localeCompare(b.name, "de"));
  return chapters;
}

/**
 * Wandelt einen Firestore-Vokabeleintrag in ein SpeakUp-Importobjekt um.
 * imageUrl/audioUrl zeigen direkt auf Firebase Storage (öffentlich).
 */
export function parseVocabularyEntry(entry, bookId) {
  const map = asMap(entry);
  if (!map) return null;
  const en = asString(map.base).trim();
  const de = asString(map.translation).trim();
  if (!en || !de) return null;
  const audioFile = asString(map.audio_file).trim();
  const imageFile = asString(map.image_file).trim();
  const example = asString(map.example_phrase).trim();
  return {
    en,
    de,
    alternatives: [],
    example,
    emoji: "",
    imageUrl: imageFile ? storageUrl(bookId, "image", imageFile) : "",
    audioUrl: audioFile ? storageUrl(bookId, "audio", audioFile) : "",
    chapter: normalizeChapterId(asString(map.chapter)),
    chapterName: asString(map.chapter_name).trim(),
    section: asString(map.section).trim(),
    page: asString(map.page).trim(),
    task: asString(map.task).trim(),
  };
}

/** Lädt ein Buch inkl. Vokabeln aus Firestore. */
export async function fetchBook(bookId, { signal } = {}) {
  const cleanId = String(bookId || "").trim();
  if (!cleanId) throw new Error("Keine Buch-ID angegeben.");
  const url = new URL(`${FIRESTORE_BASE}/book/${encodeURIComponent(cleanId)}`);
  url.searchParams.set("key", WESTERMANN.apiKey);
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Buch konnte nicht geladen werden (HTTP ${res.status}). ${text.slice(0, 120)}`);
  }
  const doc = await res.json();
  const fields = doc?.fields || {};
  const chapters = parseChapters(fields);
  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  const rawVocab = asArray(fields.vocabulary);
  const words = [];
  const seen = new Set();
  for (const entry of rawVocab) {
    const row = parseVocabularyEntry(entry, cleanId);
    if (!row) continue;
    const key = `${row.de.toLowerCase()}|${row.en.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chapter = chapterById.get(row.chapter);
    if (chapter && !row.chapterName) row.chapterName = chapter.name;
    words.push(row);
  }

  return {
    id: cleanId,
    name: asString(fields.name) || cleanId,
    language: asString(fields.language) || "",
    coverUrl: asString(fields.cover_image_url) || "",
    bookVolume: asString(fields.book_volume) || "",
    chapters,
    words,
    vocabCount: rawVocab.length,
  };
}

function chapterPageLabel(words) {
  const pages = [...new Set((words || []).map((w) => String(w.page || "").trim()).filter(Boolean))]
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!pages.length) return "";
  const first = pages[0];
  const last = pages[pages.length - 1];
  return first === last ? `S. ${first}` : `S. ${first}–${last}`;
}

/** Gruppiert Buch-Wörter nach Kapiteln für Import/Übersicht. */
export function groupWordsByChapter(book) {
  const groups = new Map();
  for (const word of book.words || []) {
    const id = word.chapter || "_other";
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        name: word.chapterName || (id === "_other" ? "Sonstige" : `Kapitel ${id}`),
        words: [],
      });
    }
    groups.get(id).words.push(word);
  }
  const ordered = [];
  const seen = new Set();
  for (const chapter of book.chapters || []) {
    const g = groups.get(chapter.id);
    if (g) {
      const baseName = chapter.name || g.name;
      const pageLabel = chapterPageLabel(g.words);
      g.name = pageLabel ? `${baseName} (${pageLabel})` : baseName;
      g.chapterName = baseName;
      ordered.push(g);
      seen.add(chapter.id);
    }
  }
  for (const [id, g] of groups) {
    if (!seen.has(id)) {
      const pageLabel = chapterPageLabel(g.words);
      g.chapterName = g.name;
      g.name = pageLabel ? `${g.name} (${pageLabel})` : g.name;
      ordered.push(g);
    }
  }
  return ordered;
}
