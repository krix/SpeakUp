/**
 * Lokale API-Schlüssel für optionale Cloud-Dienste.
 *
 * Bewusste Entscheidungen:
 *   - Schlüssel liegen getrennt von den Einstellungen im kv-Speicher
 *     ("handwritingKeys"). Dadurch landen sie niemals in einem Backup.
 *   - Es gibt keinen Server und keine automatische Synchronisierung von SpeakUp.
 *   - Ein Schlüssel in einer Browser-App ist für alle lesbar, die Zugriff
 *     auf dieses Gerät haben. Deshalb im Elternbereich klar benennen und
 *     den Schlüssel beim Anbieter einschränken (API + HTTP-Referrer).
 */
import db from "./db.js";

const STORE_KEY = "handwritingKeys";

async function readAll() {
  const value = await db.kvGet(STORE_KEY);
  return value && typeof value === "object" ? value : {};
}

/** Liefert den gespeicherten Schlüssel eines Anbieters oder "". */
export async function getApiKey(providerId) {
  if (!providerId) return "";
  const all = await readAll();
  return typeof all[providerId] === "string" ? all[providerId] : "";
}

/** Speichert einen Schlüssel. Leere Werte löschen den Eintrag. */
export async function setApiKey(providerId, key) {
  if (!providerId) throw new Error("Ohne Anbieter kann kein Schlüssel gespeichert werden.");
  const all = await readAll();
  const value = String(key || "").trim();
  if (value) all[providerId] = value;
  else delete all[providerId];
  await db.kvSet(STORE_KEY, all);
  return value;
}

export async function clearApiKey(providerId) {
  return setApiKey(providerId, "");
}

export async function hasApiKey(providerId) {
  return Boolean(await getApiKey(providerId));
}

/** Nur für Tests/Diagnose: alle gespeicherten Anbieter-IDs. */
export async function listApiKeyProviders() {
  return Object.keys(await readAll());
}
