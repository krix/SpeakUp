/**
 * Vokabeln aus einem Foto einlesen.
 *
 * Ablauf:
 *   1. Das Foto wird im Browser verkleinert (JPEG, lange Kante ≤ 1800 px).
 *   2. Google Cloud Vision (DOCUMENT_TEXT_DETECTION) oder Gemini liest den Text.
 *   3. Aus Text und Wort-Koordinaten werden Vokabelpaare (deutsch, englisch).
 *   4. Der Elternbereich zeigt die Vorschläge mit Auswahlhäkchen an; erst
 *      nach der Bestätigung landen sie in der Bibliothek.
 *
 * Es werden KEINE Rohdaten dauerhaft gespeichert: Das Bild lebt nur im
 * Arbeitsspeicher und wird nach dem Import verworfen.
 *
 * Bild-Koordinaten statt nur Text:
 * Vision liefert zu jedem Wort einen Rahmen. Damit lassen sich zwei Spalten
 * (deutsch | englisch) auch dann trennen, wenn die Textausgabe die Spalten
 * vermischt. Das ist bei Vokabellisten deutlich zuverlässiger.
 */
import { toCsv } from "./csv.js";
import { normalizeKey } from "./hash.js";
import {
  GEMINI_ENDPOINT,
  DEFAULT_GEMINI_MODEL,
  VISION_ENDPOINT,
  apiError,
  requestJson,
} from "./handwriting-cloud.js";
import { getApiKey, hasApiKey } from "./secrets.js";

/** Fehler mit einer verständlichen Meldung für den Elternbereich. */
export class PhotoImportError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "PhotoImportError";
    this.code = code;
  }
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1800;
const MAX_PAIRS = 300;
const OCR_TIMEOUT = 45000;

/** Wörter, die als Überschrift/Spaltenkopf keine Vokabel sind. */
const HEADER_WORDS = new Set([
  "deutsch", "englisch", "german", "english", "vokabeln", "vokabel", "vocabulary",
  "vocables", "words", "word", "wort", "unit", "kapitel", "chapter", "lektion",
  "lesson", "thema", "topic", "seite", "page", "name", "datum", "date", "klasse",
  "kurs", "aussprache", "pronunciation", "beispiel", "example", "nr", "no",
]);

const GERMAN_HINTS =
  /\b(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|sich|und|oder|nicht|sein|haben|werden|ich|du|er|sie|es|wir|ihr|zu|mit|auf|für|von|im|am|an|bei|nach|aus|durch|über|unter|vor|hinter|kann|muss|will|möchte)\b|[äöüß]/i;
const ENGLISH_HINTS =
  /\b(the|a|an|to|and|or|not|be|have|will|would|can|must|i|you|he|she|it|we|they|with|on|for|from|in|at|by|about|of|is|are|was|were|this|that|there|their)\b/i;

function normalizeSpace(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Entfernt Nummerierung, Aufzählungszeichen und Anführungszeichen. */
function cleanCell(value) {
  let text = normalizeSpace(value);
  text = text.replace(/^\s*(?:\d{1,3}\s*[.)]\s*|[-•*·]\s+)/, "");
  text = text.replace(/^["'„“”‚‘]+|["'„“”‚‘]+$/g, "");
  text = text.replace(/[.,;:]+$/g, "");
  return normalizeSpace(text);
}

function wordCount(value) {
  return value ? value.split(/\s+/).length : 0;
}

function looksLikeHeader(value) {
  const key = normalizeKey(value);
  if (!key) return true;
  if (HEADER_WORDS.has(key)) return true;
  // "Unit 3", "Kapitel 2", "Seite 14"
  if (/^(unit|kapitel|chapter|lesson|lektion|seite|page)\s*\d+$/i.test(value)) return true;
  return false;
}

function looksLikeNoise(value) {
  if (!value) return true;
  if (!/[a-zäöüß]/i.test(value)) return true; // nur Zahlen/Symbole
  if (/^(seite|page)\s*\d+$/i.test(value)) return true;
  if (value.length > 60) return true;
  if (wordCount(value) > 6) return true;
  return false;
}

/** Ist die linke Seite eher Deutsch als die rechte? */
function germanScore(value) {
  let score = 0;
  if (/[äöüß]/i.test(value)) score += 2;
  const matches = value.match(GERMAN_HINTS);
  if (matches) score += Math.min(3, matches.length);
  if (ENGLISH_HINTS.test(value)) score -= 1;
  return score;
}

function makePair(left, right) {
  const de = cleanCell(left);
  const en = cleanCell(right);
  if (!de || !en) return null;
  if (looksLikeHeader(de) || looksLikeHeader(en)) return null;
  if (looksLikeNoise(de) || looksLikeNoise(en)) return null;
  if (normalizeKey(de) === normalizeKey(en)) return null;
  return { de, en };
}

/**
 * Dreht die Paare, wenn die Liste offensichtlich Englisch–Deutsch steht.
 * Ohne Hinweise bleibt die übliche Reihenfolge (deutsch links) erhalten.
 */
export function orientPairs(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return [];
  let score = 0;
  for (const pair of pairs) score += germanScore(pair.de) - germanScore(pair.en);
  return score < 0 ? pairs.map(({ de, en }) => ({ de: en, en: de })) : pairs.slice();
}

function dedupePairs(pairs) {
  const seen = new Set();
  const result = [];
  for (const pair of pairs) {
    if (!pair) continue;
    const key = `${normalizeKey(pair.de)}|${normalizeKey(pair.en)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ de: pair.de, en: pair.en });
    if (result.length >= MAX_PAIRS) break;
  }
  return result;
}

/* ============================================================
   Textzeilen auswerten (Fallback und ohne Wort-Koordinaten)
   ============================================================ */

const LINE_SEPARATORS = [
  /\t+/,
  /\s*[;|]\s*/,
  /\s+[–—−=:]\s+/,
  /\s*[–—−]\s*/,
  /\s*=\s*/,
  /\s*:\s*/,
  /\s{2,}/,
  /\s*,\s*/,
];

function splitLine(line) {
  const text = line.trim();
  for (const pattern of LINE_SEPARATORS) {
    if (!pattern.test(text)) continue;
    const parts = text.split(pattern).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 2) return parts;
    if (parts.length > 2) {
      // "1. der Hund – dog" → Nummer war bereits entfernt; alles andere
      // zusammenhalten, damit mehrteilige Ausdrücke nicht zerfallen.
      return [parts[0], parts.slice(1).join(" ")];
    }
  }
  return null;
}

/**
 * Liest Vokabelpaare aus OCR-Text.
 * Erwartet eine Zeile pro Paar, z. B. "Hund – dog", "Katze;cat",
 * "Baum = tree" oder "Haus    house".
 *
 * @returns {{pairs: Array<{de: string, en: string}>, lines: number}}
 */
export function parseVocabText(rawText) {
  const text = String(rawText ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\.{3,}/g, " – ")
    .replace(/[–—−]/g, "–");
  const pairs = [];
  let lines = 0;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    lines++;
    const parts = splitLine(line);
    if (!parts) continue;
    const pair = makePair(parts[0], parts[1]);
    if (pair) pairs.push(pair);
  }

  return { pairs: dedupePairs(orientPairs(pairs)), lines };
}

/* ============================================================
   Vision: Wörter über ihre Rahmen zu Zeilen und Spalten ordnen
   ============================================================ */

function verticesBox(vertices) {
  if (!Array.isArray(vertices) || !vertices.length) return null;
  const xs = vertices.map((point) => Number(point?.x) || 0);
  const ys = vertices.map((point) => Number(point?.y) || 0);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

function wordText(word) {
  return (word?.symbols || []).map((symbol) => symbol?.text || "").join("");
}

function median(values) {
  if (!values.length) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
}

/** Alle Wörter einer Vision-Antwort mit Text und Rahmen. */
function collectWords(data) {
  const pages = data?.responses?.[0]?.fullTextAnnotation?.pages;
  if (!Array.isArray(pages)) return [];
  const words = [];
  for (const page of pages) {
    for (const block of page?.blocks || []) {
      for (const paragraph of block?.paragraphs || []) {
        for (const word of paragraph?.words || []) {
          const text = wordText(word);
          if (!text.trim()) continue;
          const box = verticesBox(word.boundingBox?.vertices);
          if (!box || box.bottom <= box.top) continue;
          words.push({ text: text.trim(), box });
        }
      }
    }
  }
  return words;
}

/**
 * Gruppiert Wörter in visuelle Zeilen und teilt jede Zeile an großen
 * horizontalen Lücken in Spalten. Zwei Spalten = ein Vokabelpaar.
 */
export function pairsFromVisionResponse(data) {
  const words = collectWords(data);
  if (!words.length) return { pairs: [], rows: 0 };

  const sorted = words.slice().sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const lines = [];

  for (const word of sorted) {
    const height = Math.max(1, word.box.bottom - word.box.top);
    let line = lines.find((candidate) => {
      const overlap =
        Math.min(candidate.bottom, word.box.bottom) - Math.max(candidate.top, word.box.top);
      return overlap > Math.min(candidate.height, height) * 0.45;
    });
    if (!line) {
      line = {
        words: [],
        top: word.box.top,
        bottom: word.box.bottom,
        height,
      };
      lines.push(line);
    }
    line.words.push(word);
    line.top = Math.min(line.top, word.box.top);
    line.bottom = Math.max(line.bottom, word.box.bottom);
    line.height = line.bottom - line.top;
  }

  lines.sort((a, b) => a.top - b.top);
  const pairs = [];
  let rows = 0;

  for (const line of lines) {
    line.words.sort((a, b) => a.box.left - b.box.left);
    const heights = line.words.map((word) => Math.max(1, word.box.bottom - word.box.top));
    const reference = median(heights);
    const gapLimit = Math.max(18, reference * 1.35);

    const cells = [[]];
    let lastRight = null;
    for (const word of line.words) {
      if (lastRight !== null && word.box.left - lastRight > gapLimit) cells.push([]);
      cells[cells.length - 1].push(word);
      lastRight = word.box.right;
    }

    let texts = cells.map((cell) => normalizeSpace(cell.map((word) => word.text).join(" ")));
    while (texts.length > 2 && /^\d{1,3}[.)]?$/.test(texts[0])) texts = texts.slice(1);

    rows++;
    if (texts.length === 2) {
      pairs.push(makePair(texts[0], texts[1]));
    } else if (texts.length === 4) {
      // Zwei Paare nebeneinander (selten, aber möglich).
      pairs.push(makePair(texts[0], texts[1]));
      pairs.push(makePair(texts[2], texts[3]));
    }
  }

  const filtered = pairs.filter(Boolean);
  return {
    pairs: dedupePairs(orientPairs(filtered)),
    rows,
  };
}

/* ============================================================
   Foto vorbereiten
   ============================================================ */

async function loadDrawable(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* Fallback über <img> */
    }
  }
  if (typeof document === "undefined") {
    throw new PhotoImportError("invalid-image", "Das Bild konnte hier nicht gelesen werden.");
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(
          new PhotoImportError(
            "invalid-image",
            "Dieses Bildformat kann der Browser nicht öffnen. Bitte als JPG oder PNG speichern."
          )
        );
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Verkleinert das Foto und liefert ein JPEG als Data-URL/Base64.
 * Kleine Fotos werden nicht hochskaliert, transparente Flächen werden weiß.
 *
 * @returns {Promise<{dataUrl: string, base64: string, width: number, height: number}>}
 */
export async function preparePhoto(file, { maxEdge = MAX_EDGE, quality = 0.82 } = {}) {
  if (!file) {
    throw new PhotoImportError("invalid-image", "Bitte wähle ein Foto aus.");
  }
  if (Number(file.size) > MAX_FILE_BYTES) {
    throw new PhotoImportError(
      "too-big",
      "Das Foto ist größer als 20 MB. Bitte verkleinere es oder nimm ein neues Foto auf."
    );
  }
  const type = String(file.type || "");
  if (type && !type.startsWith("image/")) {
    throw new PhotoImportError("invalid-image", "Das ist keine Bilddatei. Bitte wähle ein Foto aus.");
  }
  if (typeof document === "undefined") {
    throw new PhotoImportError("invalid-image", "Fotos können nur im Browser gelesen werden.");
  }

  const drawable = await loadDrawable(file);
  const sourceWidth = drawable.width || drawable.naturalWidth || 0;
  const sourceHeight = drawable.height || drawable.naturalHeight || 0;
  if (!sourceWidth || !sourceHeight) {
    throw new PhotoImportError("invalid-image", "Das Bild konnte nicht gelesen werden.");
  }

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new PhotoImportError("invalid-image", "Das Bild konnte nicht vorbereitet werden.");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(drawable, 0, 0, width, height);
  if (typeof drawable.close === "function") drawable.close();

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return {
    dataUrl,
    base64: dataUrl.split(",")[1] || "",
    width,
    height,
  };
}

/* ============================================================
   Anbieter
   ============================================================ */

/**
 * Welcher Dienst liest Fotos?
 * Zuerst der eingestellte Handschrift-Anbieter, danach der Anbieter, für
 * den ein Schlüssel hinterlegt ist. Sonst null (Eltern müssen einrichten).
 */
export async function resolvePhotoProvider(settings = {}) {
  const preferred = settings.handwritingProvider;
  if ((preferred === "google-vision" || preferred === "gemini") && (await hasApiKey(preferred))) {
    return preferred;
  }
  if (await hasApiKey("google-vision")) return "google-vision";
  if (await hasApiKey("gemini")) return "gemini";
  return null;
}

export function photoProviderLabel(providerId) {
  if (providerId === "google-vision") return "Google Cloud Vision";
  if (providerId === "gemini") return "Google Gemini";
  return "kein Dienst eingerichtet";
}

/* ============================================================
   Anfragen
   ============================================================ */

function visionBody(base64) {
  return {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        imageContext: { languageHints: ["de", "en"] },
      },
    ],
  };
}

const GEMINI_PROMPT = `Du liest ein Foto einer Vokabelliste (Deutsch-Englisch) für eine Kinder-Lern-App.
Gib ausschließlich echte Vokabelpaare aus dem Bild zurück.

Regeln:
- Erfinde nichts und übersetze nichts. Übernimm die Wörter genau so, wie sie im Bild stehen.
- Artikel und mehrteilige Ausdrücke bleiben vollständig (z. B. "der Hund", "ice cream").
- Überschriften (z. B. "Vokabeln", "Unit 3", "Deutsch", "Englisch"), Seitenzahlen,
  Nummerierungen und Beispielsätze weglassen.
- Unleserliche Zeilen weglassen, nicht raten.
- Normalerweise steht Deutsch links und Englisch rechts. Ist es umgekehrt,
  ordne die Paare trotzdem als deutsch/englisch zu.

Antworte nur mit JSON: {"pairs":[{"de":"...","en":"..."}]}`;

function geminiBody(base64) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: GEMINI_PROMPT },
          { inline_data: { mime_type: "image/jpeg", data: base64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          pairs: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                de: { type: "STRING" },
                en: { type: "STRING" },
              },
              required: ["de", "en"],
            },
          },
        },
        required: ["pairs"],
      },
    },
  };
}

function geminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => part && part.thought !== true)
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function jsonFromText(raw) {
  const text = String(raw || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function pairsFromGemini(raw) {
  const parsed = jsonFromText(raw);
  const list = Array.isArray(parsed?.pairs) ? parsed.pairs : [];
  const pairs = [];
  for (const item of list) {
    const pair = makePair(item?.de, item?.en);
    if (pair) pairs.push(pair);
  }
  return dedupePairs(orientPairs(pairs));
}

function clampPairs(pairs) {
  return pairs.slice(0, MAX_PAIRS);
}

/** Text, der im Elternbereich unter „Erkannter Text“ angezeigt wird. */
function describePairs(pairs) {
  return pairs.map((pair) => `${pair.de} – ${pair.en}`).join("\n");
}

/**
 * Liest ein Foto und liefert Vorschläge. Es wird nichts gespeichert.
 *
 * @param {File|Blob} file
 * @param {{provider?: string, model?: string, maxEdge?: number}} options
 * @returns {Promise<{provider: string, image: object, pairs: Array, rawText: string, rowCount: number}>}
 */
export async function extractVocabularyFromPhoto(
  file,
  { provider = "google-vision", model = DEFAULT_GEMINI_MODEL, maxEdge = MAX_EDGE } = {}
) {
  if (provider !== "google-vision" && provider !== "gemini") {
    throw new PhotoImportError(
      "disabled",
      "Für den Foto-Import wird Google Cloud Vision oder Gemini benötigt. Ein Elternteil kann den Dienst unter Einstellungen einrichten."
    );
  }

  const key = await getApiKey(provider);
  if (!key) {
    throw new PhotoImportError(
      "auth",
      "Es ist kein API-Schlüssel gespeichert. Ein Elternteil kann ihn unter Einstellungen eintragen."
    );
  }

  const image = await preparePhoto(file, { maxEdge });

  if (provider === "google-vision") {
    const data = await requestJson(`${VISION_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      body: visionBody(image.base64),
      timeout: OCR_TIMEOUT,
    });

    const response = data?.responses?.[0];
    if (response?.error?.message) {
      throw apiError(Number(response.error.code) || 400, { error: response.error });
    }

    const rawText = response?.fullTextAnnotation?.text || response?.textAnnotations?.[0]?.description || "";
    const fromBoxes = pairsFromVisionResponse(data);
    const fromText = parseVocabText(rawText);
    const pairs = clampPairs(dedupePairs([...fromBoxes.pairs, ...fromText.pairs]));

    if (!pairs.length) {
      throw new PhotoImportError(
        "no-vocab",
        "Ich konnte auf dem Foto keine Vokabelpaare finden. Fotografiere die Liste gerade von oben, sodass Deutsch und Englisch in einer Zeile stehen."
      );
    }
    return {
      provider,
      image,
      pairs,
      rawText: rawText || describePairs(pairs),
      rowCount: Math.max(fromBoxes.rows, fromText.lines),
    };
  }

  const modelId = String(model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const data = await requestJson(
    `${GEMINI_ENDPOINT}/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`,
    { body: geminiBody(image.base64), timeout: OCR_TIMEOUT }
  );

  if (data?.promptFeedback?.blockReason) {
    throw new PhotoImportError(
      "no-vocab",
      "Der Dienst hat das Foto nicht verarbeitet. Bitte versuche es mit einem anderen Foto."
    );
  }

  const pairs = clampPairs(pairsFromGemini(geminiText(data)));
  if (!pairs.length) {
    throw new PhotoImportError(
      "no-vocab",
      "Ich konnte auf dem Foto keine Vokabelpaare finden. Fotografiere die Liste gerade von oben und achte auf gutes Licht."
    );
  }

  return {
    provider,
    image,
    pairs,
    rawText: describePairs(pairs),
    rowCount: pairs.length,
  };
}

/** Vorschläge → CSV-Text im Format von SpeakUp (für die vorhandene Vorschau). */
export function pairsToCsv(pairs) {
  return toCsv(
    (Array.isArray(pairs) ? pairs : []).map((pair) => ({ de: pair.de, en: pair.en })),
    { delimiter: ";", includeHeader: true }
  );
}

export { MAX_EDGE, MAX_PAIRS };
