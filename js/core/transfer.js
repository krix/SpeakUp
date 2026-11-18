/**
 * Import, Export und Backup.
 *
 * - CSV-Import mit Vorschau, Fehlerprüfung und den Modi
 *   Hinzufügen / Zusammenführen / Ersetzen
 * - CSV-Export pro Thema
 * - JSON-Backup (speakup-backup.json) inkl. Fortschritt und allen Profilen
 */
import { parseVocabularyCsv, toCsv } from "./csv.js";
import * as library from "./library.js";
import * as profiles from "./profiles.js";
import { makeWordId, normalizeKey } from "./hash.js";
import db from "./db.js";
import { getLearnerBackup, getSessions } from "./learner.js";
import { downloadFile } from "../ui/dom.js";
import { APP_VERSION, BACKUP_FILENAME } from "./config.js";

/* ---------- Import ---------- */

/**
 * Analysiert CSV-Text für die Vorschau.
 * @returns {{entries, globalErrors, warnings, counts, delimiter, hasHeader, themeId}}
 */
export function analyzeVocabulary(text, { themeId = null } = {}) {
  const parsed = parseVocabularyCsv(text);
  const existing = themeId ? library.getWords(themeId) : [];
  const byGerman = new Map();
  const byId = new Map();
  for (const word of existing) {
    byId.set(word.id, word);
    const key = normalizeKey(word.de);
    if (!byGerman.has(key)) byGerman.set(key, word);
  }

  for (const entry of parsed.entries) {
    entry.id = entry.de && entry.en && themeId ? makeWordId(themeId, entry.de, entry.en) : null;
    entry.existsByGerman = Boolean(byGerman.get(normalizeKey(entry.de)));
    entry.existsExact = entry.id ? byId.has(entry.id) : false;
    entry.hasErrors = entry.errors.length > 0;
    // Vorschau-Auswahl: Jede gültige Zeile ist zunächst angehakt.
    entry.selected = true;
  }

  const validEntries = parsed.entries.filter((entry) => !entry.hasErrors);
  const errorRows = parsed.entries.length - validEntries.length;
  const existingRows = validEntries.filter((entry) => entry.existsByGerman).length;
  const duplicateRows = parsed.entries.filter((entry) => entry.duplicateInFile).length;

  return {
    entries: parsed.entries,
    validEntries,
    globalErrors: parsed.globalErrors,
    warnings: parsed.warnings,
    delimiter: parsed.delimiter,
    hasHeader: parsed.hasHeader,
    themeId,
    existingCount: existing.length,
    counts: {
      total: parsed.entries.length,
      valid: validEntries.length,
      errors: errorRows,
      newRows: validEntries.length - existingRows,
      existingRows,
      duplicateRows,
    },
  };
}

export async function applyVocabularyImport(analysis, { mode = "merge", themeId = null, newTheme = null } = {}) {
  if (!analysis) throw new Error("Bitte zuerst eine Vorschau erstellen.");
  if (analysis.globalErrors.length) {
    throw new Error("Der Import ist noch nicht möglich. Bitte behebe zuerst die Fehler in der Datei.");
  }
  const rows = analysis.entries
    .filter((entry) => !entry.errors.length && entry.selected !== false)
    .map((entry) => ({
      de: entry.de,
      en: entry.en,
      alternatives: entry.alternatives,
      example: entry.example,
      emoji: entry.emoji,
    }));

  if (!rows.length) throw new Error("Es gibt keine fehlerfreien Zeilen zum Importieren.");
  if (!newTheme && !themeId) throw new Error("Bitte wähle ein Ziel-Thema.");
  if (newTheme && !newTheme.name?.trim()) throw new Error("Bitte gib einen Namen für das neue Thema ein.");

  return library.applyImport({
    themeId,
    newTheme: newTheme || null,
    rows,
    mode: newTheme ? "add" : mode,
  });
}

/* ---------- CSV-Export ---------- */

export function buildThemeCsv(themeId) {
  const words = library.getWords(themeId);
  return toCsv(
    words.map((word) => ({
      de: word.de,
      en: word.en,
      alternatives: word.alternatives,
      example: word.example,
      emoji: word.emoji,
    })),
    { delimiter: ";", includeHeader: true }
  );
}

export function downloadThemeCsv(themeId) {
  const theme = library.getTheme(themeId);
  if (!theme) throw new Error("Das Thema wurde nicht gefunden.");
  const csv = buildThemeCsv(themeId);
  downloadFile(`speakup-${theme.id}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
  return library.getWords(themeId).length;
}

export function downloadCsvTemplate() {
  const template =
    "\uFEFFdeutsch;englisch;alternativen;beispielsatz;emoji\r\n" +
    "Hund;dog;doggy;The dog is big.;🐶\r\n" +
    "Auto;car;automobile;;🚗\r\n" +
    "Eis;ice cream;icecream;We eat ice cream.;🍦\r\n";
  downloadFile("speakup-vorlage.csv", template, "text/csv;charset=utf-8");
}

/* ---------- Backup ---------- */

export async function createBackup() {
  const sessions = await getSessions();
  const learner = getLearnerBackup();
  return {
    app: "SpeakUp",
    format: "speakup-backup",
    schemaVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      library: structuredClone(library.getLibrary()),
      profile: learner.profile,
      settings: learner.settings,
      progress: learner.progress,
      sessions: sessions.map((session) => {
        const { id, ...rest } = session;
        return rest;
      }),
      // Alle Profile portabel machen – weiterhin ohne Einwilligung/Schlüssel.
      profiles: profiles.isReady() ? await profiles.exportCloudProfiles() : [],
    },
  };
}

export async function downloadBackup() {
  const backup = await createBackup();
  downloadFile(BACKUP_FILENAME, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
  return backup;
}

/** Prüft eine Backup-Datei und liefert eine verständliche Fehlermeldung. */
export function validateBackup(input) {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return { valid: false, error: "Die Datei ist kein gültiges JSON. Bitte wähle ein SpeakUp-Backup aus." };
    }
  }
  if (!raw || typeof raw !== "object") {
    return { valid: false, error: "Die Datei enthält keine gültigen Daten." };
  }
  if (raw.app !== "SpeakUp" || raw.format !== "speakup-backup") {
    return { valid: false, error: "Das ist kein SpeakUp-Backup. Erwartet wird die Datei speakup-backup.json." };
  }
  if (!raw.data || typeof raw.data !== "object") {
    return { valid: false, error: "Im Backup fehlen die Nutzdaten (data)." };
  }
  const lib = raw.data.library;
  if (!lib || !Array.isArray(lib.themes) || !Array.isArray(lib.words)) {
    return { valid: false, error: "Im Backup fehlt die Vokabelliste (library.themes / library.words)." };
  }
  if (!lib.themes.length) {
    return { valid: false, error: "Das Backup enthält keine Themen." };
  }
  if (raw.data.progress !== undefined && !Array.isArray(raw.data.progress)) {
    return { valid: false, error: "Der Lernfortschritt im Backup hat ein ungültiges Format." };
  }
  if (raw.data.profiles !== undefined && !Array.isArray(raw.data.profiles)) {
    return { valid: false, error: "Die Profile im Backup haben ein ungültiges Format." };
  }
  return { valid: true, backup: raw };
}

/**
 * Spielt ein Backup ein. Danach muss die Seite neu geladen werden,
 * damit alle Module den neuen Stand lesen.
 */
export async function restoreBackup(backup) {
  const check = validateBackup(backup);
  if (!check.valid) throw new Error(check.error);
  const data = check.backup.data;

  await library.replaceLibrary(data.library);
  if (data.profile && typeof data.profile === "object") {
    await db.kvSet("profile", data.profile);
  } else {
    await db.kvDelete("profile");
  }
  if (data.settings && typeof data.settings === "object") {
    await db.kvSet("settings", data.settings);
  } else {
    await db.kvDelete("settings");
  }

  await db.progressClear();
  for (const record of data.progress || []) {
    if (record?.id) await db.progressPut(record);
  }

  await db.sessionsClear();
  for (const session of data.sessions || []) {
    if (!session || typeof session !== "object") continue;
    const { id, ...rest } = session;
    await db.sessionAdd(rest);
  }

  // Registry mit dem wiederhergestellten aktiven Stand abgleichen und – sofern
  // vorhanden – alle weiteren Profile aus dem Backup übernehmen.
  if (profiles.isReady()) {
    await profiles.refreshActiveSnapshot();
    if (Array.isArray(data.profiles) && data.profiles.length) {
      await profiles.importCloudProfiles(data.profiles);
    }
  }

  return {
    themes: data.library.themes.length,
    words: data.library.words.length,
    progress: Array.isArray(data.progress) ? data.progress.length : 0,
  };
}
