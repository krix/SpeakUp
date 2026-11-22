/**
 * Vokabel-Bibliothek von SpeakUp.
 *
 * Die mitgelieferten Listen liegen in /data (index.json + CSV).
 * Eigene Änderungen werden vollständig in IndexedDB gespeichert:
 *   library = { themes, words, deletedWords, deletedThemes, dataVersion }
 *
 * Beim Start werden neue/geänderte Standardwörter zusammengeführt:
 * - eigene Wörter bleiben erhalten
 * - gelöschte Standardwörter werden nicht wiederbelebt (Tombstones)
 * - Fortschritt bleibt an die stabile Wort-ID gebunden
 */
import db from "./db.js";
import bus from "./bus.js";
import { makeWordId, slugify, uniqueId, normalizeKey } from "./hash.js";
import { parseVocabularyCsv, splitAlternatives } from "./csv.js";

const STORAGE_KEY = "library";
const INDEX_URL = "data/index.json";

let library = null;
let defaultsCache = null;
let initInfo = { offline: false, addedWords: 0, addedThemes: 0, updatedWords: 0, migrations: [] };

const clone = (value) => structuredClone(value);

function cleanText(value, maxLength = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAlternatives(value) {
  const list = Array.isArray(value) ? value : splitAlternatives(value);
  return [...new Set(list.map((item) => cleanText(item, 120)).filter(Boolean))].slice(0, 12);
}

function cleanUrl(value, maxLength = 600) {
  const text = String(value ?? "").trim().slice(0, maxLength);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  // Lokale/relative Pfade (z. B. data/...) bleiben erlaubt.
  if (/^[a-z0-9_./-]+$/i.test(text)) return text;
  return "";
}

function cleanSource(source) {
  if (!source || typeof source !== "object") return null;
  const type = cleanText(source.type, 40);
  const src = {
    ...(type ? { type } : {}),
    bookId: cleanText(source.bookId, 120),
    bookName: cleanText(source.bookName, 160),
    chapter: cleanText(source.chapter, 120),
    chapterName: cleanText(source.chapterName, 160),
    section: cleanText(source.section, 160),
    page: cleanText(source.page, 40),
  };
  const hasSource = src.bookId || src.bookName || src.chapter || src.chapterName || src.section || src.page || src.type;
  return hasSource ? src : null;
}

function makeWord(
  { de, en, alternatives, example, emoji, imageUrl = "", audioUrl = "", source = null },
  themeId,
  order,
  origin = "user"
) {
  const german = cleanText(de, 120);
  const english = cleanText(en, 120);
  const src = cleanSource(source);
  return {
    id: makeWordId(themeId, german, english),
    themeId,
    de: german,
    en: english,
    alternatives: normalizeAlternatives(alternatives),
    example: cleanText(example, 240),
    emoji: cleanText(emoji, 24),
    imageUrl: cleanUrl(imageUrl),
    audioUrl: cleanUrl(audioUrl),
    source: src,
    origin,
    edited: origin === "user",
    order: Number.isFinite(order) ? order : 0,
  };
}

function normalizeTheme(raw, fallbackOrder = 1) {
  const name = cleanText(raw?.name, 60) || "Thema";
  let id = String(raw?.id ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) id = slugify(name, "thema");
  const source =
    raw?.source && typeof raw.source === "object"
      ? {
          type: cleanText(raw.source.type, 40),
          bookId: cleanText(raw.source.bookId, 120),
          bookName: cleanText(raw.source.bookName, 120),
        }
      : null;
  const hasSource = source && (source.type || source.bookId || source.bookName);
  return {
    id,
    name,
    emoji: cleanText(raw?.emoji, 16) || "📘",
    order: toInt(raw?.order, fallbackOrder),
    unlockPoints: Math.max(0, toInt(raw?.unlockPoints, 0)),
    file: raw?.file ? String(raw.file) : null,
    origin: raw?.origin === "user" ? "user" : "default",
    edited: Boolean(raw?.edited),
    source: hasSource ? source : null,
  };
}

function normalizeStoredLibrary(raw) {
  const themes = [];
  const usedThemeIds = new Set();
  for (const [index, theme] of (raw.themes || []).entries()) {
    const normalized = normalizeTheme(theme, index + 1);
    normalized.id = uniqueId(normalized.id, usedThemeIds);
    usedThemeIds.add(normalized.id);
    themes.push(normalized);
  }
  const words = [];
  const usedWordIds = new Set();
  for (const [index, rawWord] of (raw.words || []).entries()) {
    if (!rawWord || !rawWord.de || !rawWord.en) continue;
    const themeId = String(rawWord.themeId || "");
    if (!usedThemeIds.has(themeId)) continue;
    const word = makeWord(rawWord, themeId, toInt(rawWord.order, index + 1), rawWord.origin === "user" ? "user" : "default");
    if (typeof rawWord.id === "string" && rawWord.id && !usedWordIds.has(rawWord.id)) {
      word.id = rawWord.id;
    }
    if (usedWordIds.has(word.id)) continue;
    // Bestehende IDs behalten, damit Lernfortschritt erhalten bleibt.
    word.imageUrl = cleanUrl(rawWord.imageUrl ?? rawWord.image_url ?? word.imageUrl);
    word.audioUrl = cleanUrl(rawWord.audioUrl ?? rawWord.audio_url ?? word.audioUrl);
    if (rawWord.source && typeof rawWord.source === "object") {
      word.source = cleanSource(rawWord.source);
    }
    word.edited = Boolean(rawWord.edited);
    usedWordIds.add(word.id);
    words.push(word);
  }
  return {
    schemaVersion: 1,
    dataVersion: String(raw.dataVersion || ""),
    themes,
    words,
    deletedWords: Array.isArray(raw.deletedWords) ? [...new Set(raw.deletedWords.filter((x) => typeof x === "string"))] : [],
    deletedThemes: Array.isArray(raw.deletedThemes) ? [...new Set(raw.deletedThemes.filter((x) => typeof x === "string"))] : [],
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} für ${url}`);
  return response.json();
}

/** Lädt die mitgelieferten Daten aus /data. */
export async function loadDefaults({ force = false } = {}) {
  if (defaultsCache && !force) return defaultsCache;

  const index = await fetchJson(force ? `${INDEX_URL}?v=${Date.now()}` : INDEX_URL);
  if (!index || !Array.isArray(index.themes)) {
    throw new Error("data/index.json ist ungültig: „themes“ fehlt.");
  }

  const themes = [];
  const words = [];
  const warnings = [];
  const usedThemeIds = new Set();
  const usedWordIds = new Set();

  for (const [themeIndex, rawTheme] of index.themes.entries()) {
    const theme = normalizeTheme(rawTheme, themeIndex + 1);
    theme.origin = "default";
    theme.edited = false;
    theme.id = uniqueId(theme.id, usedThemeIds);
    usedThemeIds.add(theme.id);
    themes.push(theme);

    const file = String(rawTheme?.file || "").trim();
    if (!/^[\w.-]+\.csv$/i.test(file) || file.includes("..")) {
      warnings.push(`Thema „${theme.name}“: ungültiger Dateiname „${file}“.`);
      continue;
    }

    let text;
    try {
      const response = await fetch(`data/${file}`, { headers: { Accept: "text/csv" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch (err) {
      warnings.push(`Thema „${theme.name}“: Datei ${file} konnte nicht geladen werden (${err.message}).`);
      continue;
    }

    const parsed = parseVocabularyCsv(text);
    if (parsed.globalErrors.length) {
      warnings.push(`Thema „${theme.name}“ (${file}): ${parsed.globalErrors.join(" ")}`);
    }
    let order = 1;
    for (const entry of parsed.entries) {
      if (!entry.de || !entry.en) continue;
      const word = makeWord(entry, theme.id, order++, "default");
      if (usedWordIds.has(word.id)) {
        warnings.push(`Thema „${theme.name}“: doppeltes Wort „${word.de} / ${word.en}“ übersprungen.`);
        continue;
      }
      usedWordIds.add(word.id);
      words.push(word);
    }
  }

  themes.sort((a, b) => a.order - b.order);
  defaultsCache = {
    schemaVersion: 1,
    dataVersion: String(index.version || "1"),
    themes,
    words,
    warnings,
  };
  return defaultsCache;
}

/**
 * Führt neue Standarddaten mit der lokalen Bibliothek zusammen.
 * Fortschritts-Migrationen werden zurückgegeben (alte → neue IDs).
 */
function mergeDefaults(stored, defaults) {
  const merged = clone(stored);
  const deletedWords = new Set(merged.deletedWords);
  const deletedThemes = new Set(merged.deletedThemes);
  const migrations = [];
  let addedWords = 0;
  let updatedWords = 0;
  let addedThemes = 0;

  for (const defaultTheme of defaults.themes) {
    if (deletedThemes.has(defaultTheme.id)) continue;
    const existing = merged.themes.find((theme) => theme.id === defaultTheme.id);
    if (!existing) {
      merged.themes.push(clone(defaultTheme));
      addedThemes++;
    } else if (!existing.edited) {
      existing.name = defaultTheme.name;
      existing.emoji = defaultTheme.emoji;
      existing.unlockPoints = defaultTheme.unlockPoints;
      existing.origin = "default";
    }
  }

  for (const defaultWord of defaults.words) {
    if (deletedWords.has(defaultWord.id)) continue;
    if (deletedThemes.has(defaultWord.themeId)) continue;
    if (!merged.themes.some((theme) => theme.id === defaultWord.themeId)) continue;

    const existing = merged.words.find((word) => word.id === defaultWord.id);
    if (existing) {
      if (!existing.edited && existing.origin === "default") {
        // Inhalt kann sich in einer neuen App-Version geändert haben.
        const before = JSON.stringify([existing.de, existing.en, existing.alternatives, existing.example, existing.emoji, existing.imageUrl || "", existing.audioUrl || ""]);
        const after = JSON.stringify([defaultWord.de, defaultWord.en, defaultWord.alternatives, defaultWord.example, defaultWord.emoji, defaultWord.imageUrl || "", defaultWord.audioUrl || ""]);
        if (before !== after) {
          Object.assign(existing, {
            de: defaultWord.de,
            en: defaultWord.en,
            alternatives: [...defaultWord.alternatives],
            example: defaultWord.example,
            emoji: defaultWord.emoji,
            imageUrl: defaultWord.imageUrl || "",
            audioUrl: defaultWord.audioUrl || "",
          });
          updatedWords++;
        }
      }
      continue;
    }

    // Standardwort wurde inhaltlich geändert (neue ID): altes, unverändertes
    // Standardwort im selben Thema suchen und Fortschritt übernehmen.
    const twin = merged.words.find(
      (word) =>
        word.themeId === defaultWord.themeId &&
        word.origin === "default" &&
        !word.edited &&
        !deletedWords.has(word.id) &&
        (normalizeKey(word.de) === normalizeKey(defaultWord.de) || normalizeKey(word.en) === normalizeKey(defaultWord.en))
    );

    if (twin) {
      const oldId = twin.id;
      Object.assign(twin, clone(defaultWord), { order: twin.order });
      deletedWords.delete(defaultWord.id);
      if (oldId !== twin.id) migrations.push({ from: oldId, to: twin.id });
      updatedWords++;
    } else {
      merged.words.push(clone(defaultWord));
      addedWords++;
    }
  }

  merged.themes.sort((a, b) => a.order - b.order);
  merged.dataVersion = defaults.dataVersion;
  merged.deletedWords = [...deletedWords];
  merged.deletedThemes = [...deletedThemes];

  return { library: merged, migrations, addedWords, addedThemes, updatedWords };
}

/** Beim App-Start aufrufen. */
export async function init() {
  const stored = await db.kvGet(STORAGE_KEY);
  let defaults = null;
  let offline = false;

  try {
    defaults = await loadDefaults();
  } catch (err) {
    offline = true;
    console.warn("[library] Standarddaten nicht erreichbar:", err);
    if (!stored) {
      const error = new Error("Die Vokabellisten konnten nicht geladen werden.");
      error.code = "NO_DATA";
      throw error;
    }
  }

  let migrations = [];
  if (!stored) {
    library = {
      schemaVersion: 1,
      dataVersion: defaults.dataVersion,
      themes: clone(defaults.themes),
      words: clone(defaults.words),
      deletedWords: [],
      deletedThemes: [],
      updatedAt: Date.now(),
    };
    await persist({ silent: true });
    initInfo = { offline, addedWords: library.words.length, addedThemes: library.themes.length, updatedWords: 0, migrations: [] };
    return initInfo;
  }

  library = normalizeStoredLibrary(stored);
  let merge = { addedWords: 0, addedThemes: 0, updatedWords: 0, migrations: [] };
  if (defaults) merge = mergeDefaults(library, defaults);

  // Falls die gespeicherte Version älter ist, aber keine Änderungen erkannt
  // wurden, Version trotzdem aktualisieren.
  if (defaults && library.dataVersion !== defaults.dataVersion) {
    library.dataVersion = defaults.dataVersion;
  }

  const changed = merge.addedWords + merge.addedThemes + merge.updatedWords > 0;
  if (changed) await persist({ silent: true });
  else if (defaults && String(stored.dataVersion) !== library.dataVersion) await persist({ silent: true });

  migrations = merge.migrations;
  initInfo = {
    offline,
    addedWords: merge.addedWords,
    addedThemes: merge.addedThemes,
    updatedWords: merge.updatedWords,
    migrations,
  };
  return initInfo;
}

export function getInitInfo() {
  return initInfo;
}

async function persist({ silent = false } = {}) {
  library.updatedAt = Date.now();
  await db.kvSet(STORAGE_KEY, library);
  if (!silent) bus.emit("library:change", library);
}

function requireLibrary() {
  if (!library) throw new Error("Die Vokabel-Bibliothek ist noch nicht geladen.");
  return library;
}

export function getLibrary() {
  return requireLibrary();
}

export function getThemes() {
  return [...requireLibrary().themes].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de"));
}

export function getTheme(themeId) {
  return requireLibrary().themes.find((theme) => theme.id === themeId) || null;
}

export function getWords(themeId) {
  return requireLibrary()
    .words.filter((word) => word.themeId === themeId)
    .sort((a, b) => a.order - b.order || a.de.localeCompare(b.de, "de"));
}

export function getAllWords() {
  return [...requireLibrary().words];
}

export function getWord(wordId) {
  return requireLibrary().words.find((word) => word.id === wordId) || null;
}

export function isThemeUnlocked(theme, points) {
  if (!theme) return false;
  return Number(points) >= Number(theme.unlockPoints || 0);
}

/** Anzahl Wörter, gemeistert (Box 5), angefangen und Modus-Statistik. */
export function getThemeStats(themeId, progressMap) {
  const words = getWords(themeId);
  let mastered = 0;
  let started = 0;
  let speakSeen = 0;
  let speakCorrect = 0;
  let writeSeen = 0;
  let writeCorrect = 0;
  for (const word of words) {
    const progress = progressMap?.get?.(word.id);
    if (progress?.seen) started++;
    const speakOk = (progress?.speakCorrect || 0) >= 3;
    const writeOk = (progress?.writeCorrect || 0) >= 3;
    const legacyMastered = !progress?.speakSeen && !progress?.writeSeen && (progress?.box || 1) >= 5 && progress?.seen;
    if (speakOk && writeOk || legacyMastered) mastered++;
    speakSeen += progress?.speakSeen || 0;
    speakCorrect += progress?.speakCorrect || 0;
    writeSeen += progress?.writeSeen || 0;
    writeCorrect += progress?.writeCorrect || 0;
  }
  return { total: words.length, mastered, started, speakSeen, speakCorrect, writeSeen, writeCorrect };
}

function nextWordOrder(themeId) {
  const words = getWords(themeId);
  return words.reduce((max, word) => Math.max(max, word.order || 0), 0) + 1;
}

function nextThemeOrder() {
  return getThemes().reduce((max, theme) => Math.max(max, theme.order || 0), 0) + 1;
}

function addTombstone(wordId) {
  if (!library.deletedWords.includes(wordId)) library.deletedWords.push(wordId);
}

function removeTombstone(wordId) {
  library.deletedWords = library.deletedWords.filter((id) => id !== wordId);
}

function newThemeId(name) {
  const taken = new Set([
    ...library.themes.map((theme) => theme.id),
    ...library.deletedThemes,
  ]);
  return uniqueId(slugify(name, "thema"), taken);
}

/** Neues Wort hinzufügen. */
export async function addWord(themeId, data) {
  requireLibrary();
  if (!getTheme(themeId)) throw new Error("Das Thema wurde nicht gefunden.");
  const word = makeWord(data, themeId, nextWordOrder(themeId), "user");
  if (!word.de || !word.en) throw new Error("Deutsch und Englisch dürfen nicht leer sein.");
  if (getWord(word.id)) throw new Error(`„${word.de} / ${word.en}“ gibt es in diesem Thema schon.`);

  // Wurde ein Standardwort zuvor gelöscht, wird es durch das neue Wort ersetzt.
  removeTombstone(word.id);
  library.words.push(word);
  await persist();
  return word;
}

/**
 * Wort bearbeiten. Die ID ändert sich, wenn deutsch/englisch/Thema geändert
 * werden. Der Aufrufer entscheidet, ob der Fortschritt migriert wird.
 */
export async function updateWord(wordId, data, { keepProgress = true } = {}) {
  requireLibrary();
  const word = getWord(wordId);
  if (!word) throw new Error("Das Wort wurde nicht gefunden.");

  const targetThemeId = data.themeId || word.themeId;
  if (!getTheme(targetThemeId)) throw new Error("Das Ziel-Thema wurde nicht gefunden.");

  const de = cleanText(data.de ?? word.de, 120);
  const en = cleanText(data.en ?? word.en, 120);
  if (!de || !en) throw new Error("Deutsch und Englisch dürfen nicht leer sein.");

  const newId = makeWordId(targetThemeId, de, en);
  const collision = getWord(newId);
  if (newId !== word.id && collision) {
    throw new Error(`„${de} / ${en}“ gibt es in diesem Thema schon.`);
  }

  const oldId = word.id;
  const oldThemeId = word.themeId;
  word.de = de;
  word.en = en;
  word.alternatives = normalizeAlternatives(data.alternatives ?? word.alternatives);
  word.example = cleanText(data.example ?? word.example, 240);
  word.emoji = cleanText(data.emoji ?? word.emoji, 24);
  word.imageUrl = data.imageUrl === undefined ? word.imageUrl : cleanUrl(data.imageUrl);
  word.audioUrl = data.audioUrl === undefined ? word.audioUrl : cleanUrl(data.audioUrl);
  if (data.source !== undefined) {
    word.source = cleanSource(data.source);
  }
  word.themeId = targetThemeId;
  word.id = newId;
  word.edited = true;
  if (oldThemeId !== targetThemeId) word.order = nextWordOrder(targetThemeId);

  removeTombstone(newId);
  await persist();
  return { word, oldId, newId, changed: oldId !== newId, keepProgress: keepProgress && oldId !== newId };
}

/** Wort löschen. Der Fortschritt wird vom Aufrufer entfernt. */
export async function deleteWord(wordId) {
  requireLibrary();
  const word = getWord(wordId);
  if (!word) return null;
  if (word.origin === "default") addTombstone(word.id);
  library.words = library.words.filter((item) => item.id !== wordId);
  await persist();
  return word;
}

/** Wort innerhalb seines Themas nach oben/unten verschieben. */
export async function moveWord(wordId, direction) {
  requireLibrary();
  const word = getWord(wordId);
  if (!word) return false;
  const words = getWords(word.themeId);
  let index = words.findIndex((item) => item.id === wordId);
  if (index < 0) return false;

  // Sicherstellen, dass alle Wörter eine eindeutige Reihenfolge haben.
  if (new Set(words.map((item) => item.order)).size !== words.length) {
    words.forEach((item, i) => {
      item.order = i + 1;
    });
  }
  index = words.findIndex((item) => item.id === wordId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= words.length) return false;
  const other = words[targetIndex];
  const temp = word.order;
  word.order = other.order;
  other.order = temp;
  await persist();
  return true;
}

/**
 * Wörter eines Themas alphabetisch sortieren.
 * @param {"az"|"za"} direction
 */
export async function sortWords(themeId, direction = "az") {
  requireLibrary();
  if (!getTheme(themeId)) return false;
  const words = getWords(themeId);
  const factor = direction === "za" ? -1 : 1;
  words
    .slice()
    .sort((a, b) => factor * a.de.localeCompare(b.de, "de", { sensitivity: "base" }))
    .forEach((word, index) => {
      word.order = index + 1;
    });
  await persist();
  return words.length;
}

/** Themen alphabetisch sortieren. */
export async function sortThemes(direction = "az") {
  requireLibrary();
  const themes = getThemes();
  const factor = direction === "za" ? -1 : 1;
  themes
    .slice()
    .sort((a, b) => factor * a.name.localeCompare(b.name, "de", { sensitivity: "base" }))
    .forEach((theme, index) => {
      theme.order = index + 1;
    });
  await persist();
  return themes.length;
}

/** Neues eigenes Thema. */
export async function addTheme({ name, emoji = "📘", unlockPoints = 0 }) {
  requireLibrary();
  const cleanName = cleanText(name, 60);
  if (!cleanName) throw new Error("Bitte gib einen Namen für das Thema ein.");
  const theme = {
    id: newThemeId(cleanName),
    name: cleanName,
    emoji: cleanText(emoji, 16) || "📘",
    order: nextThemeOrder(),
    unlockPoints: Math.max(0, toInt(unlockPoints, 0)),
    file: null,
    origin: "user",
    edited: true,
  };
  library.themes.push(theme);
  await persist();
  return theme;
}

export async function updateTheme(themeId, data) {
  requireLibrary();
  const theme = getTheme(themeId);
  if (!theme) throw new Error("Das Thema wurde nicht gefunden.");
  const name = cleanText(data.name ?? theme.name, 60);
  if (!name) throw new Error("Der Themenname darf nicht leer sein.");
  theme.name = name;
  theme.emoji = cleanText(data.emoji ?? theme.emoji, 16) || "📘";
  theme.unlockPoints = Math.max(0, toInt(data.unlockPoints ?? theme.unlockPoints, 0));
  theme.edited = true;
  await persist();
  return theme;
}

/** Thema löschen; liefert die betroffenen Wort-IDs für den Fortschritt. */
export async function deleteTheme(themeId) {
  requireLibrary();
  const theme = getTheme(themeId);
  if (!theme) return null;
  const removedWords = library.words.filter((word) => word.themeId === themeId);
  if (theme.origin === "default" && !library.deletedThemes.includes(themeId)) {
    library.deletedThemes.push(themeId);
    // Wort-Tombstones sind nicht nötig, das Thema selbst ist tombstoned.
  }
  library.themes = library.themes.filter((item) => item.id !== themeId);
  library.words = library.words.filter((word) => word.themeId !== themeId);
  await persist();
  return { theme, removedWordIds: removedWords.map((word) => word.id) };
}

export async function moveTheme(themeId, direction) {
  requireLibrary();
  const themes = getThemes();
  let index = themes.findIndex((theme) => theme.id === themeId);
  if (index < 0) return false;
  if (new Set(themes.map((theme) => theme.order)).size !== themes.length) {
    themes.forEach((theme, i) => {
      theme.order = i + 1;
    });
  }
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= themes.length) return false;
  const theme = themes[index];
  const other = themes[targetIndex];
  const temp = theme.order;
  theme.order = other.order;
  other.order = temp;
  await persist();
  return true;
}

/**
 * Massen-Import in ein Thema.
 * mode: "add" (nur neue) | "merge" (nach deutschem Wort aktualisieren) | "replace" (Thema ersetzen)
 * @returns {{themeId: string, added: number, updated: number, skipped: number,
 *            removedWordIds: string[], migrations: Array<{from:string,to:string}>}}
 */
export async function applyImport({ themeId, newTheme = null, rows, mode = "add" }) {
  requireLibrary();
  if (!Array.isArray(rows) || !rows.length) throw new Error("Es gibt keine gültigen Zeilen zum Importieren.");

  let targetThemeId = themeId;

  if (newTheme) {
    const name = cleanText(newTheme.name, 60);
    if (!name) throw new Error("Bitte gib einen Namen f?r das neue Thema ein.");
    const src = cleanSource(newTheme.source);
    const theme = {
      id: newThemeId(name),
      name,
      emoji: cleanText(newTheme.emoji, 16) || "📘",
      order: nextThemeOrder(),
      unlockPoints: Math.max(0, toInt(newTheme.unlockPoints, 0)),
      file: null,
      origin: "user",
      edited: true,
      source: src,
    };
    library.themes.push(theme);
    targetThemeId = theme.id;
  }

  const theme = getTheme(targetThemeId);
  if (!theme) throw new Error("Das Ziel-Thema wurde nicht gefunden.");

  const existing = getWords(targetThemeId);
  const byGerman = new Map();
  for (const word of existing) {
    const key = normalizeKey(word.de);
    if (!byGerman.has(key)) byGerman.set(key, word);
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const removedWordIds = [];
  const migrations = [];
  const matchedIds = new Set();

  for (const row of rows) {
    const de = cleanText(row.de, 120);
    const en = cleanText(row.en, 120);
    if (!de || !en) {
      skipped++;
      continue;
    }

    const match = byGerman.get(normalizeKey(de));
    if (mode !== "add" && match) {
      matchedIds.add(match.id);
      const newId = makeWordId(targetThemeId, de, en);
      if (newId !== match.id && library.words.some((word) => word.id === newId && word !== match)) {
        skipped++; // würde mit einem anderen Wort kollidieren
        continue;
      }
      const oldId = match.id;
      match.de = de;
      match.en = en;
      match.alternatives = normalizeAlternatives(row.alternatives);
      match.example = cleanText(row.example, 240);
      match.emoji = cleanText(row.emoji, 24);
      if (row.imageUrl !== undefined) match.imageUrl = cleanUrl(row.imageUrl);
      if (row.audioUrl !== undefined) match.audioUrl = cleanUrl(row.audioUrl);
      if (row.source !== undefined) {
        match.source = cleanSource(row.source);
      }
      match.id = newId;
      match.edited = true;
      matchedIds.add(newId);
      removeTombstone(newId);
      if (oldId !== newId) migrations.push({ from: oldId, to: newId });
      updated++;
      continue;
    }

    if (mode === "add" && match) {
      skipped++;
      continue;
    }

    if (mode === "replace" && !match) {
      // Altes Wort mit gleichem deutschen Wort? nein → neu anlegen.
    }

    const word = makeWord(row, targetThemeId, nextWordOrder(targetThemeId), "user");
    if (getWord(word.id) || library.words.some((item) => item.themeId === targetThemeId && normalizeKey(item.de) === normalizeKey(word.de))) {
      skipped++;
      continue;
    }
    library.words.push(word);
    removeTombstone(word.id);
    added++;
  }

  if (mode === "replace") {
    for (const word of existing) {
      if (matchedIds.has(word.id)) continue;
      if (word.origin === "default") addTombstone(word.id);
      removedWordIds.push(word.id);
    }
    const removeSet = new Set(removedWordIds);
    library.words = library.words.filter((word) => !removeSet.has(word.id));
  }

  await persist();
  return { themeId: targetThemeId, added, updated, skipped, removedWordIds, migrations, theme };
}

/** Standardlisten wiederherstellen (eigene Listen werden verworfen). */
export async function resetToDefaults() {
  const defaults = await loadDefaults({ force: true }).catch(() => defaultsCache);
  if (!defaults) throw new Error("Die Standardlisten sind gerade nicht verfügbar.");
  const oldIds = new Set(requireLibrary().words.map((word) => word.id));
  library = {
    schemaVersion: 1,
    dataVersion: defaults.dataVersion,
    themes: clone(defaults.themes),
    words: clone(defaults.words),
    deletedWords: [],
    deletedThemes: [],
    updatedAt: Date.now(),
  };
  await persist();
  const newIds = new Set(library.words.map((word) => word.id));
  return { removedWordIds: [...oldIds].filter((id) => !newIds.has(id)) };
}

/** Bibliothek aus einem Backup ersetzen. */
export async function replaceLibrary(rawLibrary) {
  if (!rawLibrary || !Array.isArray(rawLibrary.themes) || !Array.isArray(rawLibrary.words)) {
    throw new Error("Die Bibliothek im Backup ist ungültig.");
  }
  const normalized = normalizeStoredLibrary(clone(rawLibrary));
  // Themen ohne Wörter sind erlaubt – aber eine komplett leere Bibliothek
  // wäre kein sinnvoller Zustand.
  if (!normalized.themes.length) throw new Error("Das Backup enthält keine Themen.");
  library = normalized;
  await persist();
  return library;
}

export function hasWordId(wordId) {
  return Boolean(getWord(wordId));
}
