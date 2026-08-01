import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Bearer auth is exercised in its own suite; here it just injects a user.
let currentUser = "testuser";

vi.mock("../../src/middleware/auth.js", () => ({
	bearerAuth: async (c: any, next: any) => {
		c.set("props", {
			login: currentUser,
			baseUrl: "http://localhost",
			accessToken: "test-token",
		});
		await next();
	},
}));

// The Hevy client is never reached in these tests, but createHevyMcpServer
// needs a stored API key to get as far as building a server.
vi.mock("../../src/lib/key-storage.js", async () => {
	const actual = await vi.importActual<any>("../../src/lib/key-storage.js");
	return {
		...actual,
		getUserApiKey: vi.fn(async () => storedApiKey),
	};
});

let storedApiKey: string | null = "test-hevy-key";

import { createMcpRoutes, closeAllSessions, activeSessionCount } from "../../src/routes/mcp.js";

const env = {
	OAUTH_KV: {} as any,
	GITHUB_CLIENT_ID: "id",
	GITHUB_CLIENT_SECRET: "secret",
	COOKIE_ENCRYPTION_KEY: "a".repeat(64),
};

const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "test", version: "1.0.0" },
	},
};

function initializeRequest(body: unknown = INITIALIZE): Request {
	return new Request("http://localhost/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify(body),
	});
}

describe("MCP Routes", () => {
	let mcpApp: ReturnType<typeof createMcpRoutes>;

	beforeEach(() => {
		vi.clearAllMocks();
		currentUser = "testuser";
		storedApiKey = "test-hevy-key";
		mcpApp = createMcpRoutes();
	});

	afterEach(() => {
		closeAllSessions();
	});

	describe("Initialization", () => {
		it("should establish a session and return a session id", async () => {
			const response = await mcpApp.fetch(initializeRequest(), env);

			expect(response.status).toBe(200);
			expect(response.headers.get("mcp-session-id")).toBeTruthy();
			expect(activeSessionCount()).toBe(1);
		});

		it("should advertise the Hevy tools after initialization", async () => {
			const initResponse = await mcpApp.fetch(initializeRequest(), env);
			const sessionId = initResponse.headers.get("mcp-session-id");
			expect(sessionId).toBeTruthy();

			const listRequest = new Request("http://localhost/mcp", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					"mcp-session-id": sessionId as string,
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
			});

			const response = await mcpApp.fetch(listRequest, env);
			const body = await response.text();

			expect(response.status).toBe(200);
			expect(body).toContain("get_workouts");
			expect(body).toContain("create_workout");
		});

		it("should reject initialization when no API key is stored", async () => {
			storedApiKey = null;

			const response = await mcpApp.fetch(initializeRequest(), env);
			const body = (await response.json()) as any;

			expect(response.status).toBe(403);
			expect(body.error.message).toContain("/setup");
			expect(activeSessionCount()).toBe(0);
		});
	});

	describe("Session handling", () => {
		it("should return 404 for an unknown session id", async () => {
			const request = new Request("http://localhost/mcp", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					"mcp-session-id": "does-not-exist",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
			});

			const response = await mcpApp.fetch(request, env);
			const body = (await response.json()) as any;

			expect(response.status).toBe(404);
			expect(body.error.code).toBe(-32001);
		});

		it("should refuse to serve another user's session", async () => {
			const initResponse = await mcpApp.fetch(initializeRequest(), env);
			const sessionId = initResponse.headers.get("mcp-session-id") as string;

			currentUser = "someone-else";

			const request = new Request("http://localhost/mcp", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					"mcp-session-id": sessionId,
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
			});

			const response = await mcpApp.fetch(request, env);
			const body = (await response.json()) as any;

			expect(response.status).toBe(403);
			expect(body.error.code).toBe(-32003);
		});

		it("should drop the session on DELETE", async () => {
			const initResponse = await mcpApp.fetch(initializeRequest(), env);
			const sessionId = initResponse.headers.get("mcp-session-id") as string;
			expect(activeSessionCount()).toBe(1);

			const request = new Request("http://localhost/mcp", {
				method: "DELETE",
				headers: { "mcp-session-id": sessionId },
			});

			await mcpApp.fetch(request, env);

			expect(activeSessionCount()).toBe(0);
		});

		it("should keep sessions isolated per initialization", async () => {
			const first = await mcpApp.fetch(initializeRequest(), env);
			const second = await mcpApp.fetch(initializeRequest(), env);

			expect(first.headers.get("mcp-session-id")).not.toBe(
				second.headers.get("mcp-session-id"),
			);
			expect(activeSessionCount()).toBe(2);
		});
	});

	describe("Route matching", () => {
		it("should match /mcp/* patterns", async () => {
			const request = new Request("http://localhost/mcp/anything", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					"mcp-session-id": "does-not-exist",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
			});

			const response = await mcpApp.fetch(request, env);

			// Reaches the handler rather than falling through to a 404 page
			expect(response.status).toBe(404);
			expect(response.headers.get("Content-Type")).toContain("application/json");
		});
	});

	describe("Legacy SSE endpoint", () => {
		it("should report /sse as gone", async () => {
			const response = await mcpApp.fetch(new Request("http://localhost/sse"), env);
			const body = (await response.json()) as any;

			expect(response.status).toBe(410);
			expect(body.message).toContain("/mcp");
		});

		it("should report /sse/* as gone", async () => {
			const response = await mcpApp.fetch(new Request("http://localhost/sse/message"), env);

			expect(response.status).toBe(410);
		});
	});
});
