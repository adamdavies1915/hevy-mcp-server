import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAllowedUser, type Env } from "../../src/env.js";

const baseEnv: Env = {
	OAUTH_KV: {} as any,
	GITHUB_CLIENT_ID: "id",
	GITHUB_CLIENT_SECRET: "secret",
	COOKIE_ENCRYPTION_KEY: "a".repeat(64),
};

describe("isAllowedUser", () => {
	it("should allow anyone when no allowlist is configured", () => {
		expect(isAllowedUser(baseEnv, "stranger")).toBe(true);
		expect(isAllowedUser({ ...baseEnv, ALLOWED_GITHUB_USERS: "" }, "stranger")).toBe(true);
	});

	it("should allow a listed user", () => {
		const env = { ...baseEnv, ALLOWED_GITHUB_USERS: "adamdavies1915" };
		expect(isAllowedUser(env, "adamdavies1915")).toBe(true);
	});

	it("should reject an unlisted user", () => {
		const env = { ...baseEnv, ALLOWED_GITHUB_USERS: "adamdavies1915" };
		expect(isAllowedUser(env, "stranger")).toBe(false);
	});

	it("should ignore case and surrounding whitespace", () => {
		const env = { ...baseEnv, ALLOWED_GITHUB_USERS: " AdamDavies1915 , someone " };
		expect(isAllowedUser(env, "adamdavies1915")).toBe(true);
		expect(isAllowedUser(env, "SOMEONE")).toBe(true);
		expect(isAllowedUser(env, "other")).toBe(false);
	});
});

describe("Hevy API key resolution", () => {
	const getUserApiKey = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		getUserApiKey.mockReset();
		vi.doMock("../../src/lib/key-storage.js", () => ({ getUserApiKey }));
	});

	async function build(env: Env) {
		const { createHevyMcpServer } = await import("../../src/mcp-server.js");
		return createHevyMcpServer(
			{ login: "adamdavies1915", name: "Adam", email: "", accessToken: "t" },
			env,
		);
	}

	it("should prefer the key the user stored over the environment key", async () => {
		getUserApiKey.mockResolvedValue("user-stored-key");
		const server = await build({ ...baseEnv, HEVY_API_KEY: "env-key" });
		expect(server).toBeDefined();
		expect(getUserApiKey).toHaveBeenCalled();
	});

	it("should fall back to the environment key when none is stored", async () => {
		getUserApiKey.mockResolvedValue(null);
		const server = await build({
			...baseEnv,
			HEVY_API_KEY: "env-key",
			ALLOWED_GITHUB_USERS: "adamdavies1915",
		});
		expect(server).toBeDefined();
	});

	it("should point the user at /setup when no key exists anywhere", async () => {
		getUserApiKey.mockResolvedValue(null);
		await expect(build(baseEnv)).rejects.toThrow(/setup/);
	});

	it("should refuse a user outside the allowlist", async () => {
		getUserApiKey.mockResolvedValue("user-stored-key");
		await expect(
			build({ ...baseEnv, ALLOWED_GITHUB_USERS: "someone-else" }),
		).rejects.toThrow(/not permitted/);
	});
});
