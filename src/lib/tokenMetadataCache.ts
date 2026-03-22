// app/lib/tokenMetadataCache.ts
const CACHE_KEY = 'x1nerator_token_metadata';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CachedMetadata {
  symbol: string;
  name: string;
  logo: string | null;
  uri?: string;
  timestamp: number;
}

export function getCachedMetadata(mint: string): CachedMetadata | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const cache: Record<string, CachedMetadata> = JSON.parse(raw);
    const entry = cache[mint];

    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      delete cache[mint];
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      return null;
    }

    return entry;
  } catch (e) {
    console.warn('[MetadataCache] Read failed', e);
    return null;
  }
}

export function setCachedMetadata(mint: string, meta: Omit<CachedMetadata, 'timestamp'>) {
  try {
    const raw = localStorage.getItem(CACHE_KEY) || '{}';
    const cache: Record<string, CachedMetadata> = JSON.parse(raw);

    cache[mint] = { ...meta, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('[MetadataCache] Write failed', e);
  }
}

export function clearMetadataCache() {
  localStorage.removeItem(CACHE_KEY);
  console.log('[MetadataCache] Cleared');
}