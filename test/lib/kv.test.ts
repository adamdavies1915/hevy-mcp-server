import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteKV } from "../../src/lib/kv.js";

describe("SqliteKV", () => {
	let kv: SqliteKV;

	beforeEach(() => {
		kv = new SqliteKV(":memory:");
	});

	afterEach(() => {
		kv.close();
		vi.useRealTimers();
	});

	describe("get/put/delete", () => {
		it("should round-trip a value", async () => {
			await kv.put("session:abc", "hello");
			expect(await kv.get("session:abc")).toBe("hello");
		});

		it("should return null for a missing key", async () => {
			expect(await kv.get("nope")).toBeNull();
		});

		it("should parse JSON when asked", async () => {
			await kv.put("session:abc", JSON.stringify({ login: "adam" }));
			expect(await kv.get("session:abc", "json")).toEqual({ login: "adam" });
		});

		it("should return null rather than throw on malformed JSON", async () => {
			await kv.put("session:abc", "not json");
			expect(await kv.get("session:abc", "json")).toBeNull();
		});

		it("should overwrite an existing key", async () => {
			await kv.put("k", "first");
			await kv.put("k", "second");
			expect(await kv.get("k")).toBe("second");
		});

		it("should clear the expiry when a key is rewritten without a TTL", async () => {
			await kv.put("k", "first", { expirationTtl: 60 });
			await kv.put("k", "second");

			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + 120_000);

			expect(await kv.get("k")).toBe("second");
		});

		it("should delete a key", async () => {
			await kv.put("k", "v");
			await kv.delete("k");
			expect(await kv.get("k")).toBeNull();
		});
	});

	describe("expiry", () => {
		it("should hide values once the TTL has passed", async () => {
			await kv.put("authcode:xyz", "v", { expirationTtl: 600 });
			expect(await kv.get("authcode:xyz")).toBe("v");

			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + 601_000);

			expect(await kv.get("authcode:xyz")).toBeNull();
		});

		it("should keep values without a TTL indefinitely", async () => {
			await kv.put("hevy_key:adam", "encrypted");

			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + 365 * 24 * 60 * 60 * 1000);

			expect(await kv.get("hevy_key:adam")).toBe("encrypted");
		});

		it("should drop expired rows when swept", async () => {
			await kv.put("a", "1", { expirationTtl: 10 });
			await kv.put("b", "2");

			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + 20_000);
			kv.sweep();

			const listed = await kv.list();
			expect(listed.keys.map((k) => k.name)).toEqual(["b"]);
		});
	});

	describe("list", () => {
		it("should filter by prefix", async () => {
			await kv.put("session:1", "a");
			await kv.put("session:2", "b");
			await kv.put("hevy_key:adam", "c");

			const sessions = await kv.list({ prefix: "session:" });

			expect(sessions.keys.map((k) => k.name)).toEqual(["session:1", "session:2"]);
			expect(sessions.list_complete).toBe(true);
		});

		it("should exclude expired keys", async () => {
			await kv.put("session:1", "a", { expirationTtl: 10 });
			await kv.put("session:2", "b");

			vi.useFakeTimers();
			vi.setSystemTime(Date.now() + 20_000);

			const sessions = await kv.list({ prefix: "session:" });
			expect(sessions.keys.map((k) => k.name)).toEqual(["session:2"]);
		});

		it("should treat LIKE wildcards in the prefix literally", async () => {
			await kv.put("a%b", "match");
			await kv.put("axxb", "should not match");

			const result = await kv.list({ prefix: "a%" });

			expect(result.keys.map((k) => k.name)).toEqual(["a%b"]);
		});

		it("should report list_complete false when the limit is hit", async () => {
			await kv.put("k1", "a");
			await kv.put("k2", "b");

			const result = await kv.list({ limit: 2 });

			expect(result.keys).toHaveLength(2);
			expect(result.list_complete).toBe(false);
		});
	});
});
