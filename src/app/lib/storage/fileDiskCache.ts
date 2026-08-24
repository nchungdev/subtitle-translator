import SparkMD5 from "spark-md5";
import { splitFileName } from "@/app/utils/fileUtils";

export interface DiskCacheItem {
  id: string; // unique cache key: `${inputMd5}::${targetLang}`
  originalName: string;
  targetLang: string;
  timestamp: number; // Date.now()
  inputMd5: string;
  ext: string;
  cachedFileName: string; // e.g. "ten_goc.vi.1787552000.a1b2c3d4e5.srt"
  content: string; // Subtitle text content stored on disk (IndexedDB)
}

export interface DiskCacheMetadata {
  id: string;
  originalName: string;
  targetLang: string;
  timestamp: number;
  inputMd5: string;
  ext: string;
  cachedFileName: string;
}

const DB_NAME = "SubtitleTranslatorDiskCache";
const DB_VERSION = 1;
const STORE_NAME = "translated_files";
const MAX_CACHE_FILES = 1000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours Expiry

/**
 * Open or initialize native IndexedDB instance for local file disk storage
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported in this environment."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("inputMd5", "inputMd5", { unique: false });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Compute MD5 Hash of file content
 */
export const computeFileMd5 = (fileContent: string): string => {
  return SparkMD5.hash(fileContent);
};

/**
 * Format cached filename: ten_goc.[ngon_ngu].[timestamp].[md5].[ext]
 */
export const buildCachedFileName = (
  originalFileName: string,
  targetLang: string,
  timestamp: number,
  inputMd5: string,
  ext: string
): string => {
  const { nameWithoutExt } = splitFileName(originalFileName, `.${ext}`);
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  // Format: ten_goc.[ngon_ngu].[timestamp].[md5].[ext]
  return `${nameWithoutExt}.${targetLang}.${timestamp}.${inputMd5.slice(0, 10)}.${cleanExt}`;
};

/**
 * Save a translated file into IndexedDB disk storage with 24h TTL & 1000 file LRU eviction
 */
export const saveFileToDiskCache = async (
  originalFileName: string,
  targetLang: string,
  inputMd5: string,
  ext: string,
  content: string
): Promise<DiskCacheItem> => {
  const db = await openDB();
  const timestamp = Date.now();
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
  const id = `${inputMd5}::${targetLang}`;
  const cachedFileName = buildCachedFileName(originalFileName, targetLang, timestamp, inputMd5, cleanExt);

  const cacheItem: DiskCacheItem = {
    id,
    originalName: originalFileName,
    targetLang,
    timestamp,
    inputMd5,
    ext: cleanExt,
    cachedFileName,
    content,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(cacheItem);

    request.onsuccess = async () => {
      // Trigger background eviction (24h expiry & 1000 LRU cap)
      void evictExpiredDiskCache();
      resolve(cacheItem);
    };

    request.onerror = () => reject(request.error);
  });
};

/**
 * Get cached file from IndexedDB by inputMd5 + targetLang (validates 24h TTL)
 */
export const getCachedFileByMd5 = async (
  inputMd5: string,
  targetLang: string
): Promise<DiskCacheItem | null> => {
  try {
    const db = await openDB();
    const id = `${inputMd5}::${targetLang}`;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        const item = request.result as DiskCacheItem | undefined;
        if (!item) {
          resolve(null);
          return;
        }

        // Validate 24h Expiry
        if (Date.now() - item.timestamp > TTL_MS) {
          void deleteDiskCacheItem(item.id);
          resolve(null);
          return;
        }

        resolve(item);
      };

      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

/**
 * Delete a specific cache item by id
 */
export const deleteDiskCacheItem = async (id: string): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
  } catch (err) {
    console.error("Failed to delete disk cache item:", err);
  }
};

/**
 * Evict expired items (>24h) and enforce 1,000 files LRU cap
 */
export const evictExpiredDiskCache = async (): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const items = (request.result as DiskCacheItem[]) || [];
      const now = Date.now();
      const validItems: DiskCacheItem[] = [];

      // 1. Delete items older than 24h
      for (const item of items) {
        if (now - item.timestamp > TTL_MS) {
          store.delete(item.id);
        } else {
          validItems.push(item);
        }
      }

      // 2. Enforce 1,000 files LRU cap
      if (validItems.length > MAX_CACHE_FILES) {
        // Sort by timestamp ascending (oldest first)
        validItems.sort((a, b) => a.timestamp - b.timestamp);
        const overflowCount = validItems.length - MAX_CACHE_FILES;
        for (let i = 0; i < overflowCount; i++) {
          store.delete(validItems[i].id);
        }
      }
    };
  } catch (err) {
    console.error("Disk cache eviction failed:", err);
  }
};

/**
 * Get total cached file counts in disk storage
 */
export const getDiskCacheCount = async (): Promise<number> => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
};

/**
 * Get all cached items metadata from IndexedDB
 */
export const getAllDiskCacheItems = async (): Promise<DiskCacheItem[]> => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as DiskCacheItem[]) || []);
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
};

/**
 * Clear all cached files in IndexedDB disk storage
 */
export const clearAllDiskCache = async (): Promise<number> => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();

      countReq.onsuccess = () => {
        const total = countReq.result;
        const clearReq = store.clear();
        clearReq.onsuccess = () => resolve(total);
        clearReq.onerror = () => resolve(0);
      };
      countReq.onerror = () => resolve(0);
    });
  } catch (err) {
    console.error("Failed to clear all disk cache:", err);
    return 0;
  }
};
