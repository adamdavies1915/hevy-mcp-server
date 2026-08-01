import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bearerAuth } from "../middleware/auth.js";
import { createHevyMcpServer } from "../mcp-server.js";
import type { Env, Variables } from "../env.js";

interface Session {
	server: McpServer;
	transport: StreamableHTTPTransport;
	/** GitHub login the session was opened for; requests from anyone else are rejected. */
	login: string;
	lastSeen: number;
}

/** Sessions idle for longer than this are closed by the sweeper. */
const SESSION_IDLE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map<string, Session>();

const sweeper = setInterval(() => {
	const cutoff = Date.now() - SESSION_IDLE_MS;
	for (const [id, session] of sessions) {
		if (session.lastSeen < cutoff) {
			closeSession(id);
		}
	}
}, SWEEP_INTERVAL_MS);
sweeper.unref();

function closeSession(id: string): void {
	const session = sessions.get(id);
	if (!session) {
		return;
	}
	sessions.delete(id);
	void session.server.close().catch(() => {
		// Server may already be closed; nothing useful to do here.
	});
}

/** JSON-RPC error response for failures that happen before the transport takes over. */
function jsonRpcError(message: string, code = -32000, status = 400): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			error: { code, message },
			id: null,
		}),
		{
			status,
			headers: { "Content-Type": "application/json" },
		},
	);
}

export function createMcpRoutes() {
	const mcpRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

	const handle = async (c: any): Promise<Response> => {
		const props = c.get("props");
		const sessionId = c.req.header("mcp-session-id");

		if (sessionId) {
			const session = sessions.get(sessionId);

			if (!session) {
				// Client is holding a session we no longer have (restart, or swept).
				// -32001 tells the client to re-initialize.
				return jsonRpcError("Session not found. Reinitialize the connection.", -32001, 404);
			}

			if (session.login !== props?.login) {
				return jsonRpcError("Session does not belong to this user.", -32003, 403);
			}

			session.lastSeen = Date.now();

			if (c.req.method === "DELETE") {
				const response = await session.transport.handleRequest(c);
				closeSession(sessionId);
				return response ?? new Response(null, { status: 204 });
			}

			return (await session.transport.handleRequest(c)) ?? new Response(null, { status: 202 });
		}

		// No session header: this must be an initialize request, so stand up a
		// fresh server + transport pair for this user.
		let server: McpServer;
		try {
			server = await createHevyMcpServer(props, c.env);
		} catch (error) {
			// Thrown when the user has not stored a Hevy API key yet — surface the
			// setup instructions rather than a generic 500.
			const message = error instanceof Error ? error.message : "Failed to start MCP server";
			return jsonRpcError(message, -32002, 403);
		}

		const transport = new StreamableHTTPTransport({
			sessionIdGenerator: () => crypto.randomUUID(),
			onsessioninitialized: (id: string) => {
				sessions.set(id, {
					server,
					transport,
					login: props?.login ?? "",
					lastSeen: Date.now(),
				});
			},
		});

		transport.onclose = () => {
			if (transport.sessionId) {
				sessions.delete(transport.sessionId);
			}
		};

		await server.connect(transport);

		return (await transport.handleRequest(c)) ?? new Response(null, { status: 202 });
	};

	mcpRoutes.all("/mcp", bearerAuth, handle);
	mcpRoutes.all("/mcp/*", bearerAuth, handle);

	// The SSE transport was Durable Object backed and is deprecated in the MCP
	// spec; clients should use the streamable HTTP endpoint above.
	mcpRoutes.all("/sse", (c) =>
		c.json(
			{
				error: "gone",
				message: "The SSE transport has been removed. Use the streamable HTTP endpoint at /mcp.",
			},
			410,
		),
	);
	mcpRoutes.all("/sse/*", (c) =>
		c.json(
			{
				error: "gone",
				message: "The SSE transport has been removed. Use the streamable HTTP endpoint at /mcp.",
			},
			410,
		),
	);

	return mcpRoutes;
}

/** Exposed for tests and graceful shutdown. */
export function closeAllSessions(): void {
	for (const id of [...sessions.keys()]) {
		closeSession(id);
	}
}

export function activeSessionCount(): number {
	return sessions.size;
}
