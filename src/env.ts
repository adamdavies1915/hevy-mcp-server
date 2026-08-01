import type { KVNamespace } from "./lib/kv.js";
import type { Props } from "./utils.js";

/**
 * Runtime bindings.
 *
 * On Workers these came from wrangler; under Node they are assembled in
 * server.ts from process.env plus the SQLite-backed KV store.
 */
export interface Env {
	OAUTH_KV: KVNamespace;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	COOKIE_ENCRYPTION_KEY: string;
	/**
	 * Fallback Hevy API key, used when the signed-in user has not stored one of
	 * their own via /setup. Because every allowed user shares this key, it is
	 * only honoured for logins in ALLOWED_GITHUB_USERS.
	 */
	HEVY_API_KEY?: string;
	/**
	 * Comma-separated GitHub logins permitted to sign in. Empty means anyone
	 * with a GitHub account may sign in and store their own key.
	 */
	ALLOWED_GITHUB_USERS?: string;
}

/** Returns true when `login` may sign in under the configured allowlist. */
export function isAllowedUser(env: Env, login: string): boolean {
	const allowlist = (env.ALLOWED_GITHUB_USERS ?? "")
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);

	if (allowlist.length === 0) {
		return true;
	}

	return allowlist.includes(login.toLowerCase());
}

/** Values middleware attaches to the Hono context. */
export interface Variables {
	props?: Props;
	session?: Props;
}

export type { KVNamespace };
