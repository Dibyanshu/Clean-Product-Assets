import { logger } from "../lib/logger.js";

interface CacheEntry<T> {
  value: T;
  createdAt: string;
  key: string;
}

const store = new Map<string, CacheEntry<unknown>>();

export function cacheKey(projectId: string, apiId: string, promptVersion: string): string {
  return `${projectId}::${apiId}::${promptVersion}`;
}

export function get<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) {
    logger.debug({ key }, "[CacheService] Miss");
    return null;
  }
  logger.info({ key, createdAt: entry.createdAt }, "[CacheService] Hit");
  return entry.value as T;
}

export function set<T>(key: string, value: T): void {
  store.set(key, { value, createdAt: new Date().toISOString(), key });
  logger.info({ key, total: store.size }, "[CacheService] Stored");
}

export function invalidateProject(projectId: string): number {
  let count = 0;
  for (const key of store.keys()) {
    if (key.startsWith(`${projectId}::`)) {
      store.delete(key);
      count++;
    }
  }
  logger.info({ projectId, evicted: count }, "[CacheService] Project cache cleared");
  return count;
}

export function clear(): void {
  const count = store.size;
  store.clear();
  logger.info({ evicted: count }, "[CacheService] Full cache cleared");
}

export function stats(): { size: number; keys: string[] } {
  return { size: store.size, keys: [...store.keys()] };
}
