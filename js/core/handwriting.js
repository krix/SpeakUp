/**
 * Handschrifterkennung – austauschbares Modul.
 *
 * Standard-Anbieter: Google Input Tools (Handwriting API, en).
 * Die API ist ein öffentlicher, nicht offiziell dokumentierter Dienst.
 * Deshalb ist die Anbindung gekapselt: Ein anderer Anbieter muss nur
 * dieselbe Schnittstelle erfüllen:
 *
 *   { id: string, label: string, recognize(strokes, {width, height, lang}) }
 *     → Promise<string[]>
 *
 * Bei Fehlern wirft der Anbieter einen HandwritingError mit .code:
 * "offline" | "timeout" | "network" | "too-little-ink" | "invalid-response" | "disabled"
 */

const GOOGLE_ENDPOINT = "https://inputtools.google.com/request?itc=en-t-i0-handwrit&app=demopage";
const REQUEST_TIMEOUT = 12000;

export class HandwritingError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "HandwritingError";
    this.code = code;
  }
}

function filterCandidates(rawCandidates) {
  if (!Array.isArray(rawCandidates)) return [];
  const seen = new Set();
  const result = [];
  for (const candidate of rawCandidates) {
    if (typeof candidate !== "string") continue;
    const text = candidate.replace(/\s+/g, " ").trim();
    if (!text || text.length > 40) continue;
    // Nur sinnvolle Wortzeichen behalten (Google liefert vereinzelt Symbole).
    if (!/^[a-zA-Z' -]+$/.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= 12) break;
  }
  return result;
}

/**
 * Bereitet Pointer-Strokes für die API auf:
 * - Punkte auf max. 800 reduzieren
 * - Zeitwerte relativ halten
 * - Koordinaten begrenzen
 */
export function prepareInk(strokes, width, height) {
  if (!Array.isArray(strokes) || !strokes.length) return [];
  const maxX = Math.max(1, width);
  const maxY = Math.max(1, height);
  let total = 0;
  const cleaned = [];

  for (const stroke of strokes) {
    const points = [];
    let lastX = null;
    let lastY = null;
    const startTime = stroke.points?.[0]?.t || 0;
    for (const point of stroke.points || []) {
      const x = Math.max(0, Math.min(maxX, Math.round(point.x)));
      const y = Math.max(0, Math.min(maxY, Math.round(point.y)));
      const distance = lastX === null ? Infinity : Math.hypot(x - lastX, y - lastY);
      if (distance < 1.6 && points.length) continue;
      points.push([x, y, Math.min(5000, Math.max(0, Math.round((point.t || 0) - startTime)))]);
      lastX = x;
      lastY = y;
      total++;
      if (total >= 800) break;
    }
    if (points.length >= 1) cleaned.push(points);
    if (total >= 800) break;
  }
  return cleaned;
}

const googleProvider = {
  id: "google-input-tools",
  label: "Google Input Tools (online)",
  async recognize(strokes, { width = 600, height = 300, lang = "en" } = {}) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new HandwritingError("offline", "Ohne Internet kann ich deine Schrift nicht lesen.");
    }
    const ink = prepareInk(strokes, width, height);
    if (!ink.length) {
      throw new HandwritingError("too-little-ink", "Schreib zuerst ein Wort auf die Fläche.");
    }

    const payload = {
      options: "enable_pre_space",
      requests: [
        {
          writing_guide: {
            writing_area_width: Math.round(width),
            writing_area_height: Math.round(height),
          },
          ink,
          language: lang === "de" ? "de" : "en",
        },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    let response;
    try {
      response = await fetch(GOOGLE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new HandwritingError("timeout", "Der Schreib-Lese-Dienst antwortet gerade nicht.");
      }
      throw new HandwritingError("network", "Der Schreib-Lese-Dienst ist nicht erreichbar.");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new HandwritingError("network", `Der Schreib-Lese-Dienst meldet einen Fehler (${response.status}).`);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new HandwritingError("invalid-response", "Die Antwort des Schreib-Lese-Dienstes war unverständlich.");
    }

    if (!Array.isArray(data) || data[0] !== "SUCCESS") {
      throw new HandwritingError("invalid-response", "Die Schrift konnte nicht gelesen werden.");
    }

    // Format: ["SUCCESS", [["id", ["wort","wort2"], [], {...}]]]
    const candidates = filterCandidates(data?.[1]?.[0]?.[1]);
    if (!candidates.length) {
      throw new HandwritingError("invalid-response", "Ich konnte deine Schrift nicht lesen. Versuch es noch einmal oder tippe das Wort.");
    }
    return candidates;
  },
};

const offProvider = {
  id: "off",
  label: "Aus (nur Tippen)",
  async recognize() {
    throw new HandwritingError("disabled", "Die Handschrifterkennung ist ausgeschaltet. Tippe dein Wort stattdessen.");
  },
};

const providers = new Map([
  [googleProvider.id, googleProvider],
  [offProvider.id, offProvider],
]);

let activeProvider = googleProvider;

export function getHandwritingProvider() {
  return activeProvider;
}

/** Anbieter wechseln (z. B. Eltern-Einstellung oder eigener Dienst). */
export function setHandwritingProvider(providerOrId) {
  if (typeof providerOrId === "string") {
    const found = providers.get(providerOrId);
    if (!found) throw new Error(`Unbekannter Handschrift-Anbieter: ${providerOrId}`);
    activeProvider = found;
    return activeProvider;
  }
  if (!providerOrId || typeof providerOrId.recognize !== "function") {
    throw new Error("Der Anbieter muss eine recognize()-Funktion haben.");
  }
  providers.set(providerOrId.id || `custom-${Date.now()}`, providerOrId);
  activeProvider = providerOrId;
  return activeProvider;
}

export function registerHandwritingProvider(provider) {
  if (!provider?.id || typeof provider.recognize !== "function") {
    throw new Error("Anbieter braucht id und recognize().");
  }
  providers.set(provider.id, provider);
  return provider;
}

export async function recognizeHandwriting(strokes, options = {}) {
  return activeProvider.recognize(strokes, options);
}

export { googleProvider, offProvider, providers };
