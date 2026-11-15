/**
 * IndexedDB-Zugriff (ohne externe Bibliothek).
 * Stores:
 *  - kv        : Einstellungen, Bibliothek, Profil, Einwilligung
 *  - progress  : Lernstand pro Wort-ID
 *  - sessions  : abgeschlossene Runden (für Statistik)
 *
 * Fällt IndexedDB aus (z. B. privater Modus), wird automatisch auf
 * localStorage ausgewichen – die App bleibt benutzbar.
 */
const DB_NAME = "speakup";
const DB_VERSION = 1;
const STORES = ["kv", "progress", "sessions"];

let dbPromise = null;
let useFallback = false;

const LS_PREFIX = "speakup:";

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!("indexedDB" in window)) {
      useFallback = true;
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (db) => {
      if (settled) return;
      settled = true;
      resolve(db || null);
    };

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => {
      console.warn("[db] IndexedDB nicht verfügbar, nutze localStorage", request.error);
      useFallback = true;
      finish(null);
    };
    request.onblocked = () => {
      console.warn("[db] IndexedDB blockiert");
      useFallback = true;
      finish(null);
    };
    // Falls der Browser die Anfrage nie beantwortet
    setTimeout(() => {
      if (!settled) {
        useFallback = true;
        finish(null);
      }
    }, 2500);
  });
  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function lsKey(store, key) {
  return `${LS_PREFIX}${store}:${key}`;
}

function lsGetRaw(store) {
  try {
    return JSON.parse(localStorage.getItem(lsKey(store, "__all")) || "{}");
  } catch {
    return {};
  }
}

function lsSetRaw(store, value) {
  try {
    localStorage.setItem(lsKey(store, "__all"), JSON.stringify(value));
  } catch (err) {
    console.error("[db] localStorage voll oder blockiert", err);
    throw new Error("Der Speicher ist voll. Bitte lösche alte Fotos oder gib mehr Speicher frei.");
  }
}

export const db = {
  async init() {
    await openDb();
    return !useFallback;
  },

  get usingFallback() {
    return useFallback;
  },

  async kvGet(key) {
    const database = await openDb();
    if (!database) {
      const all = lsGetRaw("kv");
      return all[key] ?? null;
    }
    return requestToPromise(tx(database, "kv", "readonly").get(key));
  },

  async kvSet(key, value) {
    const database = await openDb();
    if (!database) {
      const all = lsGetRaw("kv");
      all[key] = value;
      lsSetRaw("kv", all);
      return;
    }
    return requestToPromise(tx(database, "kv", "readwrite").put(value, key));
  },

  async kvDelete(key) {
    const database = await openDb();
    if (!database) {
      const all = lsGetRaw("kv");
      delete all[key];
      lsSetRaw("kv", all);
      return;
    }
    return requestToPromise(tx(database, "kv", "readwrite").delete(key));
  },

  async progressAll() {
    const database = await openDb();
    if (!database) return Object.values(lsGetRaw("progress"));
    return requestToPromise(tx(database, "progress", "readonly").getAll());
  },

  async progressPut(record) {
    const database = await openDb();
    if (!database) {
      const all = lsGetRaw("progress");
      all[record.id] = record;
      lsSetRaw("progress", all);
      return;
    }
    return requestToPromise(tx(database, "progress", "readwrite").put(record));
  },

  async progressDelete(id) {
    const database = await openDb();
    if (!database) {
      const all = lsGetRaw("progress");
      delete all[id];
      lsSetRaw("progress", all);
      return;
    }
    return requestToPromise(tx(database, "progress", "readwrite").delete(id));
  },

  async progressClear() {
    const database = await openDb();
    if (!database) {
      lsSetRaw("progress", {});
      return;
    }
    return requestToPromise(tx(database, "progress", "readwrite").clear());
  },

  async sessionAdd(record) {
    const database = await openDb();
    if (!database) {
      const all = lsGetRaw("sessions");
      const list = all.list || [];
      list.push({ ...record, id: Date.now() });
      lsSetRaw("sessions", { list: list.slice(-100) });
      return;
    }
    return requestToPromise(tx(database, "sessions", "readwrite").add(record));
  },

  async sessionsAll() {
    const database = await openDb();
    if (!database) return (lsGetRaw("sessions").list || []).slice();
    const list = await requestToPromise(tx(database, "sessions", "readonly").getAll());
    return list.sort((a, b) => b.at - a.at);
  },

  async sessionsClear() {
    const database = await openDb();
    if (!database) {
      lsSetRaw("sessions", {});
      return;
    }
    return requestToPromise(tx(database, "sessions", "readwrite").clear());
  },

  async clearAll() {
    const database = await openDb();
    if (!database) {
      STORES.forEach((store) => localStorage.removeItem(lsKey(store, "__all")));
      return;
    }
    await Promise.all(
      STORES.map((store) => requestToPromise(tx(database, store, "readwrite").clear()))
    );
  },
};

export default db;
