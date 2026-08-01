/**
 * SQLite-backed KV store
 *
 * Implements the subset of the Cloudflare KV API this server uses, so the
 * OAuth handler, auth middleware and key storage run unchanged outside Workers.
 * Values live in a single table with optional expiry; expired rows are filtered
 * on read and swept periodically.
 */

import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export interface KVListResult {
	keys: { name: string }[];
	list_complete: boolean;
	cursor?: string;
}

export interface KVNamespace {
	get(key: string): Promise<string | null>;
	get(key: string, type: "text"): Promise<string | null>;
	get(key: string, type: "json"): Promise<unknown | null>;
	put(
		key: string,
		value: string,
		options?: { expirationTtl?: number },
	): Promise<void>;
	delete(key: string): Promise<void>;
	list(options?: { prefix?: string; limit?: number }): Promise<KVListResult>;
}

/** How often expired rows are swept, in milliseconds. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export class SqliteKV implements KVNamespace {
	private db: Database.Database;
	private sweepTimer: NodeJS.Timeout;

	constructor(path: string) {
		if (path !== ":memory:") {
			mkdirSync(dirname(path), { recursive: true });
		}

		this.db = new Database(path);
		this.db.pragma("journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS kv (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				expires_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS kv_expires_at ON kv (expires_at);
		`);

		this.sweep();
		this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
		this.sweepTimer.unref();
	}

	async get(key: string): Promise<string | null>;
	async get(key: string, type: "text"): Promise<string | null>;
	async get(key: string, type: "json"): Promise<unknown | null>;
	async get(key: string, type?: "text" | "json"): Promise<string | unknown | null> {
		const row = this.db
			.prepare("SELECT value, expires_at FROM kv WHERE key = ?")
			.get(key) as { value: string; expires_at: number | null } | undefined;

		if (!row) {
			return null;
		}

		if (row.expires_at !== null && row.expires_at <= nowSeconds()) {
			await this.delete(key);
			return null;
		}

		if (type === "json") {
			try {
				return JSON.parse(row.value);
			} catch {
				// Match KV, which returns null rather than throwing on malformed JSON
				return null;
			}
		}

		return row.value;
	}

	async put(
		key: string,
		value: string,
		options?: { expirationTtl?: number },
	): Promise<void> {
		const expiresAt = options?.expirationTtl
			? nowSeconds() + options.expirationTtl
			: null;

		this.db
			.prepare(
				`INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
			)
			.run(key, value, expiresAt);
	}

	async delete(key: string): Promise<void> {
		this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
	}

	async list(options?: { prefix?: string; limit?: number }): Promise<KVListResult> {
		const prefix = options?.prefix ?? "";
		const limit = options?.limit ?? 1000;

		const rows = this.db
			.prepare(
				`SELECT key FROM kv
				 WHERE key LIKE ? ESCAPE '\\'
				   AND (expires_at IS NULL OR expires_at > ?)
				 ORDER BY key
				 LIMIT ?`,
			)
			.all(`${escapeLike(prefix)}%`, nowSeconds(), limit) as { key: string }[];

		return {
			keys: rows.map((row) => ({ name: row.key })),
			list_complete: rows.length < limit,
		};
	}

	/** Removes every row whose expiry has passed. */
	sweep(): void {
		this.db
			.prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?")
			.run(nowSeconds());
	}

	close(): void {
		clearInterval(this.sweepTimer);
		this.db.close();
	}
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/** Escapes LIKE wildcards so a prefix such as "session:%" matches literally. */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, "\\$&");
}
