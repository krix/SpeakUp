/**
 * CSV-Werkzeuge für SpeakUp.
 *
 * Format: UTF-8, Semikolon als Trenner, Kopfzeile:
 *   deutsch;englisch;alternativen;beispielsatz;emoji
 *
 * Beim Import werden zusätzlich Komma- und Tabulator-Trenner erkannt,
 * damit Copy & Paste aus Excel/Google Sheets direkt funktioniert.
 * Anführungszeichen werden nach RFC 4180 unterstützt ("" als Escape).
 */
import { normalizeKey } from "./hash.js";

const HEADER_ALIASES = {
  de: ["deutsch", "german", "de", "wort", "vokabel"],
  en: ["englisch", "english", "en"],
  alternatives: ["alternativen", "alternative", "alternatives", "synonyme", "weitere"],
  example: ["beispielsatz", "beispiel", "satz", "example", "examples", "beispielsaetze"],
  emoji: ["emoji", "bild", "symbol", "icon"],
};

export const CSV_HEADER = ["deutsch", "englisch", "alternativen", "beispielsatz", "emoji"];

function cleanHeaderCell(value) {
  return normalizeKey(value).replace(/[._-]+/g, " ").trim();
}

export function countOutsideQuotes(line, char) {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && ch === char) {
      count++;
    }
  }
  return count;
}

/** Erkennt das wahrscheinlichste Trennzeichen. Semikolon hat Vorrang. */
export function detectDelimiter(text) {
  const sample = String(text ?? "").split(/\r?\n/).slice(0, 25).join("\n");
  const semi = countOutsideQuotes(sample, ";");
  const tab = countOutsideQuotes(sample, "\t");
  const comma = countOutsideQuotes(sample, ",");
  if (semi > 0) return ";";
  if (tab > 0) return "\t";
  if (comma > 0) return ",";
  return ";";
}

/**
 * Parst beliebigen CSV-Text. Liefert Zeilen (getrimmt), Startzeilennummern
 * und das erkannte Trennzeichen.
 */
export function parseTable(rawText, options = {}) {
  const text = String(rawText ?? "").replace(/^\uFEFF/, "");
  const delimiter = options.delimiter || detectDelimiter(text);
  const rows = [];
  const lines = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  let lineNo = 1;
  let rowStart = 1;

  const pushRow = () => {
    const trimmed = row.map((value) => value.trim());
    const isEmpty = trimmed.every((value) => value === "");
    if (!isEmpty) {
      rows.push(trimmed);
      lines.push(rowStart);
    }
    row = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") {
          lineNo++;
          cell += "\n";
        } else if (ch === "\r") {
          if (next === "\n") {
            i++;
            lineNo++;
            cell += "\n";
          }
        } else {
          cell += ch;
        }
      }
      continue;
    }

    if (ch === '"' && cell.trim() === "") {
      inQuotes = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i++;
      pushRow();
      lineNo++;
      rowStart = lineNo;
    } else {
      cell += ch;
    }
  }
  pushRow();

  return { rows, lines, delimiter, text };
}

function mapHeader(headerRow) {
  const mapping = {};
  headerRow.forEach((cell, index) => {
    const value = cleanHeaderCell(cell);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (mapping[field] === undefined && aliases.includes(value)) {
        mapping[field] = index;
      }
    }
  });
  return mapping;
}

/** "a|b | c" → ["a","b","c"] */
export function splitAlternatives(value) {
  return String(value ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * CSV → Vokabel-Einträge inkl. verständlicher Strukturfehler.
 * @returns {{entries: Array, globalErrors: string[], warnings: string[], delimiter: string, hasHeader: boolean}}
 */
export function parseVocabularyCsv(rawText, options = {}) {
  const { rows, lines, delimiter } = parseTable(rawText, options);
  const globalErrors = [];
  const warnings = [];
  const entries = [];

  if (!rows.length) {
    return {
      entries: [],
      globalErrors: ["Die Datei ist leer. Erwartet wird eine Kopfzeile und mindestens eine Vokabel."],
      warnings,
      delimiter,
      hasHeader: false,
    };
  }

  const headerMapping = mapHeader(rows[0]);
  const hasHeader = headerMapping.de !== undefined || headerMapping.en !== undefined;

  let mapping = headerMapping;
  if (hasHeader) {
    if (headerMapping.de === undefined || headerMapping.en === undefined) {
      globalErrors.push(
        "In der Kopfzeile fehlen die Pflichtspalten „deutsch“ und „englisch“. Beispiel: deutsch;englisch;alternativen;beispielsatz;emoji"
      );
    }
  } else {
    warnings.push(
      "Keine Kopfzeile erkannt. Die Spalten werden in dieser Reihenfolge gelesen: deutsch;englisch;alternativen;beispielsatz;emoji."
    );
    mapping = { de: 0, en: 1, alternatives: 2, example: 3, emoji: 4 };
  }

  const headerLength = Math.max(rows[0].length, 5);
  const maxIndex = Math.max(...Object.values(mapping).filter((v) => Number.isInteger(v)), 4);

  rows.forEach((cells, index) => {
    if (hasHeader && index === 0) return;
    const line = lines[index] || index + 1;
    const entry = {
      line,
      de: "",
      en: "",
      alternatives: [],
      example: "",
      emoji: "",
      raw: cells,
      errors: [],
      warnings: [],
      duplicateInFile: false,
      duplicateLine: null,
      cells,
    };

    const read = (field) => {
      const column = mapping[field];
      return column === undefined ? "" : String(cells[column] ?? "").trim();
    };

    entry.de = read("de");
    entry.en = read("en");
    entry.alternatives = splitAlternatives(read("alternatives"));
    entry.example = read("example");
    entry.emoji = read("emoji");

    const limit = Math.max(headerLength, maxIndex + 1);
    if (cells.length > limit) {
      entry.errors.push(
        `Zeile ${line}: zu viele Spalten (${cells.length} statt ${limit}). Enthält ein Feld ein ${delimiter === ";" ? "Semikolon" : "Trennzeichen"}? Setze das Feld dann in Anführungszeichen.`
      );
    }
    if (cells.length < 2) {
      entry.errors.push(`Zeile ${line}: Es fehlen Spalten. Mindestens deutsch und englisch sind nötig.`);
    }
    if (!entry.de) entry.errors.push(`Zeile ${line}: Das deutsche Wort fehlt.`);
    if (!entry.en) entry.errors.push(`Zeile ${line}: Die englische Übersetzung fehlt.`);

    if (!entry.emoji) {
      // optional – kein Fehler, nur ein leiser Hinweis in der Vorschau
      entry.warnings.push("Kein Emoji – das ist in Ordnung.");
    }

    entries.push(entry);
  });

  // Dubletten innerhalb der Datei (gleiches deutsches + englisches Wort)
  const seen = new Map();
  for (const entry of entries) {
    const key = `${normalizeKey(entry.de)}|${normalizeKey(entry.en)}`;
    if (!entry.de || !entry.en) continue;
    if (seen.has(key)) {
      entry.duplicateInFile = true;
      entry.duplicateLine = seen.get(key);
      entry.errors.push(
        `Zeile ${entry.line}: Dieses Wort steht schon in Zeile ${entry.duplicateLine} (doppelt).`
      );
    } else {
      seen.set(key, entry.line);
    }
  }

  if (!entries.length && !globalErrors.length) {
    globalErrors.push("Es wurden keine Vokabelzeilen gefunden. Steht unter der Kopfzeile mindestens ein Wort?");
  }

  return { entries, globalErrors, warnings, delimiter, hasHeader };
}

function quoteCell(value, delimiter) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(delimiter) || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Vokabeln → CSV-Text (ohne BOM; der Download ergänzt das BOM für Excel). */
export function toCsv(entries, { delimiter = ";", includeHeader = true } = {}) {
  const lines = [];
  if (includeHeader) lines.push(CSV_HEADER.join(delimiter));
  for (const entry of entries) {
    const row = [
      entry.de ?? "",
      entry.en ?? "",
      Array.isArray(entry.alternatives) ? entry.alternatives.join("|") : entry.alternatives ?? "",
      entry.example ?? "",
      entry.emoji ?? "",
    ];
    lines.push(row.map((cell) => quoteCell(cell, delimiter)).join(delimiter));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Zeilen für die Import-Vorschau. */
export function toPreviewRows(entries) {
  return entries.slice(0, 100).map((entry) => ({
    line: entry.line,
    de: entry.de,
    en: entry.en,
    alternatives: entry.alternatives.join(" | "),
    example: entry.example,
    emoji: entry.emoji,
    errors: entry.errors,
    warnings: entry.warnings,
  }));
}
