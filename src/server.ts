/**
 * Node entrypoint.
 *
 * Assembles the bindings the Hono app expects — previously supplied by
 * wrangler — from process.env plus a SQLite-backed KV store, then serves the
 * app over plain HTTP for a reverse proxy to terminate TLS in front of.
 */

import { serve } from "@hono/node-server";
import app from "./app.js";
import { SqliteKV } from "./lib/kv.js";
import { closeAllSessions } from "./routes/mcp.js";
import type { Env } from "./env.js";

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(
			`Missing required environment variable ${name}. See .env.example for the full list.`,
		);
		process.exit(1);
	}
	return value;
}

const port = Number(process.env.PORT ?? 3000);
const dataPath = process.env.KV_PATH ?? "/data/hevy-mcp.db";

const kv = new SqliteKV(dataPath);

const env: Env = {
	OAUTH_KV: kv,
	GITHUB_CLIENT_ID: required("GITHUB_CLIENT_ID"),
	GITHUB_CLIENT_SECRET: required("GITHUB_CLIENT_SECRET"),
	COOKIE_ENCRYPTION_KEY: required("COOKIE_ENCRYPTION_KEY"),
	HEVY_API_KEY: process.env.HEVY_API_KEY,
	ALLOWED_GITHUB_USERS: process.env.ALLOWED_GITHUB_USERS,
};

if (env.HEVY_API_KEY && !env.ALLOWED_GITHUB_USERS) {
	console.error(
		"HEVY_API_KEY is set without ALLOWED_GITHUB_USERS, which would let any " +
			"GitHub account use your Hevy key. Set ALLOWED_GITHUB_USERS to your login.",
	);
	process.exit(1);
}

if (env.COOKIE_ENCRYPTION_KEY.length !== 64) {
	console.error(
		"COOKIE_ENCRYPTION_KEY must be a 64-character hex string (openssl rand -hex 32).",
	);
	process.exit(1);
}

const server = serve(
	{
		// @hono/node-server passes its own bindings as env; merge ours in so the
		// app sees OAUTH_KV and the GitHub credentials.
		fetch: (request: Request, nodeBindings: unknown) =>
			app.fetch(request, { ...env, ...(nodeBindings as object) }),
		port,
		hostname: "0.0.0.0",
	},
	(info) => {
		console.log(`Hevy MCP server listening on port ${info.port}`);
		console.log(`KV database: ${dataPath}`);
	},
);

function shutdown(signal: string) {
	console.log(`Received ${signal}, shutting down.`);
	closeAllSessions();
	server.close(() => {
		kv.close();
		process.exit(0);
	});
	// Don't hang forever on open SSE streams.
	setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
