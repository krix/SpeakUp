/**
 * Stabile IDs für Wörter und Themen.
 *
 * Wort-ID = Thema + deutsch + englisch (normalisiert) → Hash.
 * Dadurch bleibt der Lernfortschritt an das Wort gebunden und nicht an
 * seine Position in der CSV-Datei.
 */

/** cyrb53: schneller, gut streuender 53-Bit-Hash (synchron, ohne Crypto-API). */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Stabile, lesbare Wort-ID, z. B. "tiere.k3x9a2b1c". */
export function makeWordId(themeId, de, en) {
  const base = `${themeId}|${normalizeKey(de)}|${normalizeKey(en)}`;
  return `${themeId}.${cyrb53(base).toString(36)}`;
}

/** Themen-IDs aus Namen erzeugen, z. B. "Essen & Trinken" → "essen-trinken". */
export function slugify(text, fallback = "thema") {
  const slug = String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

export function uniqueId(base, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function randomId(prefix = "id") {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
