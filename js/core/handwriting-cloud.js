/**
 * Cloud-Anbieter für die Handschrifterkennung.
 *
 * Beide Anbieter bekommen KEINE Roh-Striche, sondern ein aus den Strichen
 * gerendertes PNG (schwarze Schrift auf weißem Grund, zugeschnitten und
 * vergrößert). Das ist für OCR deutlich besser und verrät keine Schreib-
 * geschwindigkeit.
 *
 *   google-vision : Google Cloud Vision, DOCUMENT_TEXT_DETECTION
 *                   1.000 Einheiten/Monat kostenlos, sehr gute Handschrift.
 *   gemini        : Google Gemini, Bild → JSON mit Wörtern.
 *                   Free Tier vorhanden; im Free Tier darf Google die
 *                   Inhalte zum Verbessern der Produkte verwenden.
 *
 * Schlüssel liegen in secrets.js und sind nie Teil eines Backups.
 */
import {
  HandwritingError,
  filterCandidates,
  registerHandwritingProvider,
  setHandwritingProvider,
} from "./handwriting.js";
import { getApiKey } from "./secrets.js";

export const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

const REQUEST_TIMEOUT = 18000;

/** Kurzinfos für den Elternbereich. */
export const PROVIDER_INFO = {
  "google-input-tools": {
    label: "Google Input Tools",
    needsKey: false,
  },
  "google-vision": {
    label: "Google Cloud Vision",
    needsKey: true,
    docsUrl: "https://console.cloud.google.com/apis/library/vision.googleapis.com",
    keyUrl: "https://console.cloud.google.com/apis/credentials",
    quotaUrl: "https://cloud.google.com/vision/quotas",
  },
  gemini: {
    label: "Google Gemini (KI)",
    needsKey: true,
    docsUrl: "https://ai.google.dev/gemini-api/docs/rate-limits",
    keyUrl: "https://aistudio.google.com/app/apikey",
    quotaUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  off: {
    label: "Aus (nur Tippen)",
    needsKey: false,
  },
};

export function isCloudProvider(providerId) {
  return providerId === "google-vision" || providerId === "gemini";
}

/* ============================================================
   Striche → PNG
   ============================================================ */

function collectPoints(strokes) {
  const points = [];
  for (const stroke of Array.isArray(strokes) ? strokes : []) {
    for (const point of stroke?.points || []) {
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x, y });
    }
  }
  return points;
}

/**
 * Rendert Striche als PNG mit weißem Hintergrund und Rand.
 * Der Rand ist wichtig: OCR-Modelle brauchen Luft um die Schrift.
 *
 * @returns {{dataUrl: string, base64: string, width: number, height: number}}
 */
export function renderInkImage(strokes, { width = 600, height = 300 } = {}) {
  const points = collectPoints(strokes);
  if (!points.length) {
    throw new HandwritingError("too-little-ink", "Schreib zuerst ein Wort auf die Fläche.");
  }
  if (typeof document === "undefined") {
    throw new HandwritingError("invalid-response", "Die Zeichenfläche ist in dieser Umgebung nicht verfügbar.");
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const longEdge = Math.max(contentW, contentH);
  // Großzügiger Rand (ca. 22 % der Schrift) und Vergrößerung auf ~640 px.
  const pad = Math.max(14, Math.round(longEdge * 0.22));
  const paddedW = contentW + pad * 2;
  const paddedH = contentH + pad * 2;
  let scale = Math.max(1, Math.min(6, Math.round(640 / longEdge)));
  // Beide Seiten gemeinsam begrenzen, damit das Seitenverhältnis erhalten bleibt.
  const fit = Math.min(1600 / (paddedW * scale), 1600 / (paddedH * scale), 1);
  scale *= fit;

  const outW = Math.max(64, Math.ceil(paddedW * scale));
  const outH = Math.max(64, Math.ceil(paddedH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new HandwritingError("invalid-response", "Die Zeichenfläche konnte nicht vorbereitet werden.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);

  // Koordinaten der Striche in das Ausgabebild abbilden.
  const sx = outW / (contentW + pad * 2);
  const sy = outH / (contentH + pad * 2);
  ctx.setTransform(sx, 0, 0, sy, (pad - minX) * sx, (pad - minY) * sy);
  ctx.strokeStyle = "#111111";
  ctx.fillStyle = "#111111";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const lineWidth = Math.max(2.5, longEdge * 0.02);
  ctx.lineWidth = lineWidth;

  for (const stroke of Array.isArray(strokes) ? strokes : []) {
    const pts = (stroke?.points || []).filter(
      (point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
    );
    if (!pts.length) continue;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(Number(pts[0].x), Number(pts[0].y), lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(Number(pts[0].x), Number(pts[0].y));
    for (let i = 1; i < pts.length - 1; i++) {
      const current = pts[i];
      const next = pts[i + 1];
      ctx.quadraticCurveTo(
        Number(current.x),
        Number(current.y),
        (Number(current.x) + Number(next.x)) / 2,
        (Number(current.y) + Number(next.y)) / 2
      );
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(Number(last.x), Number(last.y));
    ctx.stroke();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  return {
    dataUrl,
    base64: dataUrl.split(",")[1] || "",
    width: outW,
    height: outH,
  };
}

/* ============================================================
   HTTP-Helfer
   ============================================================ */

function ensureOnline() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new HandwritingError("offline", "Ohne Internet kann ich deine Schrift nicht lesen. Tippe das Wort stattdessen.");
  }
}

function apiError(status, data) {
  const apiMessage =
    data?.error?.message ||
    data?.responses?.[0]?.error?.message ||
    data?.error?.status ||
    "";
  if (status === 400 || status === 401 || status === 403) {
    return new HandwritingError(
      "auth",
      "Der API-Schlüssel wurde abgelehnt. Ein Elternteil kann Schlüssel und Freigaben im Elternbereich prüfen."
    );
  }
  if (status === 429) {
    return new HandwritingError(
      "rate-limit",
      "Das kostenlose Kontingent ist gerade aufgebraucht. Versuch es später noch einmal oder tippe das Wort."
    );
  }
  if (status === 404) {
    return new HandwritingError(
      "invalid-response",
      `Der Dienst wurde nicht gefunden${apiMessage ? `: ${apiMessage}` : "."} Prüfe das Modell im Elternbereich.`
    );
  }
  return new HandwritingError(
    "network",
    `Der Schreib-Lese-Dienst meldet einen Fehler (${status})${apiMessage ? `: ${apiMessage}` : "."}`
  );
}

async function requestJson(url, { method = "POST", body = null, timeout = REQUEST_TIMEOUT } = {}) {
  ensureOnline();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new HandwritingError("timeout", "Der Schreib-Lese-Dienst antwortet gerade nicht. Versuch es noch einmal.");
    }
    throw new HandwritingError("network", "Der Schreib-Lese-Dienst ist nicht erreichbar. Prüfe die Internetverbindung.");
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) throw apiError(response.status, data);
  return data;
}

/* ============================================================
   Kandidaten aus Text
   ============================================================ */

/** Zerlegt erkannten Text in sinnvolle Wort-Kandidaten. */
export function candidatesFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const cleaned = raw.replace(/\r/g, "\n").replace(/[|_]+/g, " ");
  const parts = [cleaned, cleaned.replace(/\s+/g, "")];
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    parts.push(trimmed);
    for (const word of trimmed.split(/[\s,;]+/)) parts.push(word);
  }
  return filterCandidates(parts);
}

/* ============================================================
   Google Cloud Vision
   ============================================================ */

function visionRequest(base64, lang) {
  return {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        imageContext: { languageHints: [lang === "de" ? "de" : "en"] },
      },
    ],
  };
}

function visionText(data) {
  const first = data?.responses?.[0];
  if (!first) return "";
  if (first.error?.message) {
    const code = Number(first.error.code) || 0;
    throw apiError(code || 400, { error: first.error });
  }
  return first.fullTextAnnotation?.text || first.textAnnotations?.[0]?.description || "";
}

const visionProvider = {
  id: "google-vision",
  label: "Google Cloud Vision (online)",
  async recognize(strokes, { lang = "en" } = {}) {
    const key = await getApiKey("google-vision");
    if (!key) {
      throw new HandwritingError(
        "disabled",
        "Für Google Vision fehlt der API-Schlüssel. Ein Elternteil kann ihn im Elternbereich eintragen – bis dahin kannst du tippen."
      );
    }

    const image = renderInkImage(strokes);
    const data = await requestJson(`${VISION_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      body: visionRequest(image.base64, lang),
    });

    const candidates = candidatesFromText(visionText(data));
    if (!candidates.length) {
      throw new HandwritingError(
        "invalid-response",
        "Ich konnte deine Schrift nicht sicher lesen. Schreibe größer in Druckbuchstaben oder tippe das Wort."
      );
    }
    return candidates;
  },
};

/* ============================================================
   Google Gemini
   ============================================================ */

const GEMINI_PROMPT = `You transcribe handwriting for a children's vocabulary app.
The image shows one handwritten English word (sometimes two).
Return only the letters you can actually see.
Never invent a word and never translate.
If nothing is readable, return an empty list.
Keep apostrophes and hyphens.
Answer as JSON: {"words": ["..."]}`;

function geminiBody(base64) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: GEMINI_PROMPT }, { inline_data: { mime_type: "image/png", data: base64 } }],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 64,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          words: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["words"],
      },
    },
  };
}

function geminiRawText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => part && part.thought !== true)
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export function parseGeminiWords(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const withoutFence = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(withoutFence);
    if (Array.isArray(parsed?.words)) return filterCandidates(parsed.words);
    if (typeof parsed?.words === "string") return filterCandidates([parsed.words]);
    if (Array.isArray(parsed)) return filterCandidates(parsed);
  } catch {
    // Kein JSON – dann den Text selbst auswerten.
  }
  return candidatesFromText(withoutFence);
}

const geminiProvider = {
  id: "gemini",
  label: "Google Gemini (KI, online)",
  async recognize(strokes, { model = DEFAULT_GEMINI_MODEL } = {}) {
    const key = await getApiKey("gemini");
    if (!key) {
      throw new HandwritingError(
        "disabled",
        "Für Gemini fehlt der API-Schlüssel. Ein Elternteil kann ihn im Elternbereich eintragen – bis dahin kannst du tippen."
      );
    }

    const image = renderInkImage(strokes);
    const modelId = String(model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
    const data = await requestJson(
      `${GEMINI_ENDPOINT}/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`,
      { body: geminiBody(image.base64) }
    );

    const candidates = parseGeminiWords(geminiRawText(data));
    if (!candidates.length) {
      throw new HandwritingError(
        "invalid-response",
        "Ich konnte deine Schrift nicht sicher lesen. Schreibe größer in Druckbuchstaben oder tippe das Wort."
      );
    }
    return candidates;
  },
};

/* ============================================================
   Registrierung, Auswahl und Verbindungstest
   ============================================================ */

let registered = false;

/** Macht beide Cloud-Anbieter in handwriting.js bekannt. */
export function registerCloudProviders() {
  if (registered) return;
  registerHandwritingProvider(visionProvider);
  registerHandwritingProvider(geminiProvider);
  registered = true;
}

/**
 * Wendet die gespeicherte Anbieter-Einstellung an.
 * Wird beim Start und nach jeder Änderung im Elternbereich aufgerufen.
 */
export function applyHandwritingProvider(settings = {}) {
  registerCloudProviders();
  const id = settings.handwritingProvider || "google-input-tools";
  if (id === "google-vision" || id === "gemini" || id === "off") {
    return setHandwritingProvider(id);
  }
  return setHandwritingProvider("google-input-tools");
}

function blankPngBase64() {
  if (typeof document === "undefined") {
    // Winziges, gültiges 1×1-PNG als Notlösung.
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  }
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 64, 64);
  return canvas.toDataURL("image/png").split(",")[1] || "";
}

/**
 * Prüft Schlüssel und Erreichbarkeit, ohne eine echte Handschrift zu senden.
 * Google Vision bekommt ein leeres weißes Bild, Gemini nur die Modellliste.
 *
 * @returns {Promise<string>} verständliche Erfolgsmeldung
 */
export async function testCloudProvider(providerId, { model = DEFAULT_GEMINI_MODEL } = {}) {
  const key = await getApiKey(providerId);
  if (!key) {
    throw new HandwritingError("auth", "Es ist noch kein API-Schlüssel gespeichert.");
  }

  if (providerId === "google-vision") {
    const data = await requestJson(`${VISION_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      body: {
        requests: [
          {
            image: { content: blankPngBase64() },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
          },
        ],
      },
    });
    const error = data?.responses?.[0]?.error;
    if (error?.message) throw apiError(Number(error.code) || 400, { error });
    return "Der Schlüssel funktioniert – die Vision API ist freigeschaltet.";
  }

  if (providerId === "gemini") {
    const data = await requestJson(
      `${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}&pageSize=200`,
      { method: "GET", timeout: 12000 }
    );
    const names = (data?.models || [])
      .map((entry) => String(entry?.name || "").replace(/^models\//, ""))
      .filter(Boolean);
    const wanted = String(model || DEFAULT_GEMINI_MODEL).trim();
    if (wanted && names.length && !names.includes(wanted)) {
      return `Der Schlüssel funktioniert, aber das Modell „${wanted}“ ist nicht verfügbar. Bitte ein anderes Modell eintragen (z. B. eines aus der Liste in der Google-Dokumentation).`;
    }
    return "Der Schlüssel funktioniert – Gemini ist erreichbar.";
  }

  throw new HandwritingError("disabled", "Für diesen Anbieter gibt es keinen Verbindungstest.");
}

export { visionProvider, geminiProvider };
