// IndexedDB storage utility for translation cache
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "tools-by-ai";
const DB_VERSION = 1;
const STORE_NAME = "translation-cache";

interface TranslationCacheDB {
  "translation-cache": {
    key: string;
    value: string;
  };
}

let dbPromise: Promise<IDBPDatabase<TranslationCacheDB>> | null = null;

const getDB = (): Promise<IDBPDatabase<TranslationCacheDB>> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in SSR"));
  }

  if (!dbPromise) {
    dbPromise = openDB<TranslationCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
};

export const translationCache = {
  async get(key: string): Promise<string | null> {
    try {
      const db = await getDB();
      const value = await db.get(STORE_NAME, key);
      return value ?? null;
    } catch {
      return null;
    }
  },

  // Batch read in ONE readonly transaction. `db.get()` opens a fresh
  // transaction per call, so the per-line cache prefill (1000+ lines on a
  // long subtitle) used to spin up 1000 transactions — a real chunk of the
  // "cache-hit re-run still feels slow" latency. All gets here are issued
  // synchronously before the first await, so idb keeps them on the same tx.
  // Result order matches `keys`; a missing entry is null; a tx-level failure
  // degrades to all-null (callers treat null as a cache miss → translate).
  async getMany(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const values = await Promise.all(keys.map((k) => store.get(k)));
      await tx.done;
      return values.map((v) => v ?? null);
    } catch {
      return keys.map(() => null);
    }
  },

  async set(key: string, value: string): Promise<void> {
    try {
      const db = await getDB();
      await db.put(STORE_NAME, value, key);
    } catch (error) {
      console.error("Failed to set translation cache:", error);
    }
  },

  async delete(key: string): Promise<void> {
    try {
      const db = await getDB();
      await db.delete(STORE_NAME, key);
    } catch (error) {
      console.error("Failed to delete translation cache:", error);
    }
  },

  async clear(): Promise<number> {
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const count = await store.count();
      await store.clear();
      await tx.done;
      return count;
    } catch (error) {
      console.error("Failed to clear translation cache:", error);
      return 0;
    }
  },

  async getFileCache24h(hashKey: string): Promise<string | null> {
    const raw = await this.get(`file24h:${hashKey}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const TTL_24H = 24 * 60 * 60 * 1000;
      if (Date.now() - parsed.timestamp < TTL_24H && parsed.value) {
        return parsed.value;
      }
    } catch {
      return null;
    }
    return null;
  },

  async setFileCache24h(hashKey: string, value: string): Promise<void> {
    const payload = JSON.stringify({ value, timestamp: Date.now() });
    await this.set(`file24h:${hashKey}`, payload);
  },

  async count(): Promise<number> {
    try {
      const db = await getDB();
      return await db.count(STORE_NAME);
    } catch {
      return 0;
    }
  },
};

export async function computeFileHash(
  content: string,
  targetLang: string,
  provider: string,
  model: string
): Promise<string> {
  const payload = `${targetLang}:${provider}:${model}:${content}`;
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(payload);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fallback
    }
  }
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `filehash-${Math.abs(hash)}`;
}
