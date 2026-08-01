/**
 * Caches the exercise template catalogue in the KV store.
 *
 * Searching pages the whole catalogue (about five requests), which is wasteful
 * for data that changes only when the user adds a custom exercise. The cache is
 * per user because the catalogue mixes Hevy's shared library with that user's
 * own exercises, and it survives restarts because the KV store is on a volume.
 */

import type { KVNamespace } from "./kv.js";
import type { ExerciseTemplate } from "./exercise-search.js";

/** Catalogue entries are effectively static; a day is plenty. */
export const TEMPLATE_CACHE_TTL_SECONDS = 24 * 60 * 60;

interface CacheEntry {
	templates: ExerciseTemplate[];
	cached_at: string;
}

function cacheKey(userKey: string): string {
	return `exercise_templates:${userKey}`;
}

export interface LoadResult {
	templates: ExerciseTemplate[];
	fromCache: boolean;
	cachedAt?: string;
}

/**
 * Returns the cached catalogue, falling back to `load` on a miss.
 *
 * A failed write is swallowed: serving a correct result uncached beats failing
 * the user's search because the cache is unavailable.
 */
export async function getCachedTemplates(
	kv: KVNamespace,
	userKey: string,
	load: () => Promise<ExerciseTemplate[]>,
	options?: { refresh?: boolean; ttlSeconds?: number },
): Promise<LoadResult> {
	const key = cacheKey(userKey);

	if (!options?.refresh) {
		try {
			const cached = (await kv.get(key, "json")) as CacheEntry | null;

			if (cached && Array.isArray(cached.templates) && cached.templates.length > 0) {
				return {
					templates: cached.templates,
					fromCache: true,
					cachedAt: cached.cached_at,
				};
			}
		} catch (error) {
			console.error("Failed to read exercise template cache:", error);
		}
	}

	const templates = await load();

	// An empty catalogue is more likely a transient API failure than the truth,
	// and caching it for a day would break search until the TTL expired.
	if (templates.length > 0) {
		try {
			const entry: CacheEntry = { templates, cached_at: new Date().toISOString() };
			await kv.put(key, JSON.stringify(entry), {
				expirationTtl: options?.ttlSeconds ?? TEMPLATE_CACHE_TTL_SECONDS,
			});
		} catch (error) {
			console.error("Failed to write exercise template cache:", error);
		}
	}

	return { templates, fromCache: false };
}

/** Drops the cached catalogue, e.g. after the user creates a custom exercise. */
export async function invalidateTemplateCache(
	kv: KVNamespace,
	userKey: string,
): Promise<void> {
	try {
		await kv.delete(cacheKey(userKey));
	} catch (error) {
		console.error("Failed to invalidate exercise template cache:", error);
	}
}
