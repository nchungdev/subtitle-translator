/**
 * Movie Context Cache by IMDb ID / TMDB ID (Max 50 items with LRU eviction)
 */

export interface CachedContextData {
  movieId: string;
  synopsis: string;
  characterGraphText: string;
  wikiUrl?: string;
  imdbUrl?: string;
  tmdbOrText?: string;
  timestamp: number;
}

const CONTEXT_CACHE_STORAGE_KEY = "subtitle-translator-context-id-cache";
export const MAX_CONTEXT_CACHE_ITEMS = 50;

/**
 * Extract IMDb ID (e.g. tt0111161) or TMDB ID (e.g. movie/550, tv/12345) from URL or input string
 */
export function extractMovieId(inputUrlOrText: string): string | null {
  if (!inputUrlOrText || !inputUrlOrText.trim()) return null;
  const text = inputUrlOrText.trim();

  // 1. IMDb ID regex: tt followed by 6-9 digits
  const imdbMatch = text.match(/\b(tt\d{6,9})\b/i);
  if (imdbMatch) {
    return imdbMatch[1].toLowerCase();
  }

  // 2. TMDB movie/tv ID regex: tmdb.org/movie/12345 or tmdb.org/tv/67890
  const tmdbMatch = text.match(/\b(tmdb\.org\/(?:movie|tv)\/\d+)\b/i) || text.match(/\b((?:movie|tv)\/\d+)\b/i);
  if (tmdbMatch) {
    return tmdbMatch[1].toLowerCase();
  }

  // 3. Prefix tmdb:12345
  const tmdbPrefixMatch = text.match(/\btmdb:(\d+)\b/i);
  if (tmdbPrefixMatch) {
    return `tmdb-${tmdbPrefixMatch[1]}`;
  }

  return null;
}

/**
 * Get all cached context entries from LocalStorage
 */
export function getAllContextCaches(): Record<string, CachedContextData> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CONTEXT_CACHE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn("[contextCache] Failed to read context cache:", err);
    return {};
  }
}

/**
 * Retrieve cached context by IMDb/TMDB ID
 */
export function getCachedContextById(id: string): CachedContextData | null {
  if (!id) return null;
  const caches = getAllContextCaches();
  const entry = caches[id.toLowerCase()];
  if (entry && (entry.synopsis || entry.characterGraphText || entry.wikiUrl || entry.imdbUrl)) {
    return entry;
  }
  return null;
}

/**
 * Get the most recently saved/viewed context cache item
 */
export function getMostRecentContextCache(): CachedContextData | null {
  const caches = getAllContextCaches();
  const entries = Object.values(caches);
  if (entries.length === 0) return null;
  entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return entries[0];
}

/**
 * Get recent context history list sorted by timestamp descending (max 50)
 */
export function getRecentContextHistoryList(): CachedContextData[] {
  const caches = getAllContextCaches();
  const entries = Object.values(caches);
  entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return entries.slice(0, MAX_CONTEXT_CACHE_ITEMS);
}

/**
 * Save context data associated with an IMDb/TMDB ID with LRU eviction to max 50 items
 */
export function setCachedContextById(
  id: string,
  data: {
    synopsis?: string;
    characterGraphText?: string;
    wikiUrl?: string;
    imdbUrl?: string;
    tmdbOrText?: string;
  }
): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const caches = getAllContextCaches();
    const key = id.toLowerCase();
    const existing = caches[key] || {};
    caches[key] = {
      movieId: key,
      synopsis: data.synopsis ?? existing.synopsis ?? "",
      characterGraphText: data.characterGraphText ?? existing.characterGraphText ?? "",
      wikiUrl: data.wikiUrl ?? existing.wikiUrl ?? "",
      imdbUrl: data.imdbUrl ?? existing.imdbUrl ?? "",
      tmdbOrText: data.tmdbOrText ?? existing.tmdbOrText ?? "",
      timestamp: Date.now(),
    };

    // LRU Eviction: Limit to max 50 items
    const entries = Object.entries(caches);
    if (entries.length > MAX_CONTEXT_CACHE_ITEMS) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const pruned: Record<string, CachedContextData> = {};
      entries.slice(0, MAX_CONTEXT_CACHE_ITEMS).forEach(([k, v]) => {
        pruned[k] = v;
      });
      localStorage.setItem(CONTEXT_CACHE_STORAGE_KEY, JSON.stringify(pruned));
    } else {
      localStorage.setItem(CONTEXT_CACHE_STORAGE_KEY, JSON.stringify(caches));
    }
  } catch (err) {
    console.warn("[contextCache] Failed to save context cache:", err);
  }
}
