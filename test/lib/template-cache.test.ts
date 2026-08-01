import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SqliteKV } from "../../src/lib/kv.js";
import {
	getCachedTemplates,
	invalidateTemplateCache,
	TEMPLATE_CACHE_TTL_SECONDS,
} from "../../src/lib/template-cache.js";

const templates = [
	{ id: "1", title: "Bench Press" },
	{ id: "2", title: "Squat" },
];

describe("exercise template cache", () => {
	let kv: SqliteKV;

	beforeEach(() => {
		kv = new SqliteKV(":memory:");
	});

	afterEach(() => {
		kv.close();
		vi.useRealTimers();
	});

	it("should fetch on a miss and serve from cache afterwards", async () => {
		const load = vi.fn(async () => templates);

		const first = await getCachedTemplates(kv, "adam", load);
		const second = await getCachedTemplates(kv, "adam", load);

		expect(load).toHaveBeenCalledTimes(1);
		expect(first.fromCache).toBe(false);
		expect(second.fromCache).toBe(true);
		expect(second.templates).toEqual(templates);
		expect(second.cachedAt).toBeTruthy();
	});

	it("should keep each user's catalogue separate", async () => {
		const adams = [{ id: "1", title: "Adam Custom" }];
		const others = [{ id: "2", title: "Other Custom" }];

		await getCachedTemplates(kv, "adam", async () => adams);
		const result = await getCachedTemplates(kv, "someone-else", async () => others);

		expect(result.fromCache).toBe(false);
		expect(result.templates).toEqual(others);
	});

	it("should re-fetch when refresh is requested", async () => {
		const load = vi.fn(async () => templates);

		await getCachedTemplates(kv, "adam", load);
		const refreshed = await getCachedTemplates(kv, "adam", load, { refresh: true });

		expect(load).toHaveBeenCalledTimes(2);
		expect(refreshed.fromCache).toBe(false);
	});

	it("should expire after the TTL", async () => {
		const load = vi.fn(async () => templates);
		await getCachedTemplates(kv, "adam", load);

		vi.useFakeTimers();
		vi.setSystemTime(Date.now() + (TEMPLATE_CACHE_TTL_SECONDS + 60) * 1000);

		const afterExpiry = await getCachedTemplates(kv, "adam", load);

		expect(load).toHaveBeenCalledTimes(2);
		expect(afterExpiry.fromCache).toBe(false);
	});

	it("should re-fetch after invalidation", async () => {
		const load = vi.fn(async () => templates);
		await getCachedTemplates(kv, "adam", load);

		await invalidateTemplateCache(kv, "adam");
		const result = await getCachedTemplates(kv, "adam", load);

		expect(load).toHaveBeenCalledTimes(2);
		expect(result.fromCache).toBe(false);
	});

	it("should not cache an empty catalogue, which is likely an API failure", async () => {
		const load = vi.fn(async () => []);

		await getCachedTemplates(kv, "adam", load);
		await getCachedTemplates(kv, "adam", load);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it("should still serve results when the cache cannot be read", async () => {
		const brokenKv = {
			get: vi.fn(async () => {
				throw new Error("disk failure");
			}),
			put: vi.fn(async () => {}),
			delete: vi.fn(async () => {}),
			list: vi.fn(),
		} as any;

		const result = await getCachedTemplates(brokenKv, "adam", async () => templates);

		expect(result.templates).toEqual(templates);
		expect(result.fromCache).toBe(false);
	});

	it("should still serve results when the cache cannot be written", async () => {
		const brokenKv = {
			get: vi.fn(async () => null),
			put: vi.fn(async () => {
				throw new Error("disk full");
			}),
			delete: vi.fn(async () => {}),
			list: vi.fn(),
		} as any;

		const result = await getCachedTemplates(brokenKv, "adam", async () => templates);

		expect(result.templates).toEqual(templates);
	});

	it("should ignore a corrupt cache entry", async () => {
		await kv.put("exercise_templates:adam", "not json");

		const result = await getCachedTemplates(kv, "adam", async () => templates);

		expect(result.fromCache).toBe(false);
		expect(result.templates).toEqual(templates);
	});
});
