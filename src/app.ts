import { Hono } from "hono";
import githubHandler from "./github-handler.js";
import { createMcpRoutes } from "./routes/mcp.js";
import utilityRoutes from "./routes/utility.js";
import type { Env, Variables } from "./env.js";

// Create main Hono app with proper TypeScript types
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global CORS middleware
app.use("*", async (c, next) => {
	// Handle OPTIONS preflight requests
	if (c.req.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization",
				"Access-Control-Max-Age": "86400",
			},
		});
	}

	await next();

	// Add CORS headers to all responses
	c.res.headers.set("Access-Control-Allow-Origin", "*");
	c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
	c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
});

// Error handling middleware
app.onError((err, c) => {
	console.error("Unhandled error:", err);
	return c.json(
		{
			error: "internal_server_error",
			message: "An unexpected error occurred",
		},
		500
	);
});

// Mount routes (order matters!)
app.route("/", githubHandler);        // OAuth/API routes (highest priority)
app.route("/", createMcpRoutes());     // MCP endpoints
app.route("/", utilityRoutes);        // Health, home, etc.

// 404 handler
app.notFound((c) => {
	return c.text("Not found", 404);
});

export default app;
export type { Env, Variables };
