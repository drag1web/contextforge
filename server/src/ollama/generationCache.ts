import crypto from "node:crypto";

interface GenerationCacheEntry {
  content: string;
  model: string;
  createdAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ITEMS = 50;

const cache = new Map<string, GenerationCacheEntry>();

interface BuildGenerationCacheKeyInput {
  model: string;
  prompt: string;
  expectedHeading?: string;
  numPredict?: number;
  temperature?: number;
}

export function buildGenerationCacheKey(input: BuildGenerationCacheKeyInput) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        expectedHeading: input.expectedHeading ?? null,
        numPredict: input.numPredict ?? null,
        temperature: input.temperature ?? null
      })
    )
    .digest("hex");
}

export function getCachedGeneration(key: string) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  const isExpired = Date.now() - entry.createdAt > CACHE_TTL_MS;

  if (isExpired) {
    cache.delete(key);
    return null;
  }

  return entry;
}

export function setCachedGeneration(
  key: string,
  entry: Omit<GenerationCacheEntry, "createdAt">
) {
  if (cache.size >= MAX_CACHE_ITEMS) {
    const oldestKey = cache.keys().next().value;

    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, {
    ...entry,
    createdAt: Date.now()
  });
}