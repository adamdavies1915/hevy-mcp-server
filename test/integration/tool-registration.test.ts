/**
 * The bug report stated that get_exercise_templates and get_routine_folders
 * were advertised but not callable. Both are registered in mcp-server.ts, so
 * this asserts the full catalogue is listed and invocable over a real MCP
 * connection — if a tool ever fails to register, this fails loudly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/key-storage.js", () => ({
	getUserApiKey: vi.fn(async () => "test-key"),
}));

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createHevyMcpServer } from "../../src/mcp-server.js";
import { HevyClient } from "../../src/lib/client.js";
import { SqliteKV } from "../../src/lib/kv.js";

let kv: SqliteKV;

const env = {
	get OAUTH_KV() {
		return kv as any;
	},
	GITHUB_CLIENT_ID: "id",
	GITHUB_CLIENT_SECRET: "secret",
	COOKIE_ENCRYPTION_KEY: "a".repeat(64),
};

const props = { login: "adamdavies1915", name: "Adam", email: "", accessToken: "t" };

const EXPECTED_TOOLS = [
	"get_workouts",
	"get_workout",
	"create_workout",
	"update_workout",
	"get_workouts_count",
	"get_workout_events",
	"get_routines",
	"get_routine",
	"create_routine",
	"update_routine",
	"get_exercise_templates",
	"search_exercise_templates",
	"get_exercise_template",
	"create_exercise_template",
	"get_exercise_history",
	"get_routine_folders",
	"get_routine_folder",
	"create_routine_folder",
];

async function connect() {
	const server = await createHevyMcpServer(props, env);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test", version: "1.0.0" });
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

describe("tool registration", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		kv = new SqliteKV(":memory:");
	});

	it("should advertise every expected tool", async () => {
		const client = await connect();
		const { tools } = await client.listTools();

		expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());

		await client.close();
	});

	it("should expose get_routine_folders as callable", async () => {
		vi.spyOn(HevyClient.prototype, "getRoutineFolders").mockResolvedValue({
			page: 1,
			page_count: 1,
			routine_folders: [{ id: 3343401, index: 0, title: "5-Day Plan" }],
		});

		const client = await connect();
		const result: any = await client.callTool({ name: "get_routine_folders", arguments: {} });

		expect(result.isError).toBeFalsy();
		expect(result.content.map((c: any) => c.text).join("\n")).toContain("5-Day Plan");

		await client.close();
	});

	it("should expose get_exercise_templates as callable", async () => {
		vi.spyOn(HevyClient.prototype, "getExerciseTemplates").mockResolvedValue({
			page: 1,
			page_count: 1,
			exercise_templates: [{ id: "A127DA73", title: "Kettlebell Goblet Squat" }],
		});

		const client = await connect();
		const result: any = await client.callTool({ name: "get_exercise_templates", arguments: {} });

		expect(result.isError).toBeFalsy();
		expect(result.content.map((c: any) => c.text).join("\n")).toContain("Kettlebell Goblet Squat");

		await client.close();
	});

	it("should expose search_exercise_templates and return matches", async () => {
		vi.spyOn(HevyClient.prototype, "getExerciseTemplates").mockResolvedValue({
			page: 1,
			page_count: 1,
			exercise_templates: [
				{ id: "1", title: "Bench Press", primary_muscle_group: "chest", equipment: "barbell" },
				{ id: "2", title: "Squat", primary_muscle_group: "legs", equipment: "barbell" },
			],
		});

		const client = await connect();
		const result: any = await client.callTool({
			name: "search_exercise_templates",
			arguments: { query: "bench" },
		});
		const text = result.content.map((c: any) => c.text).join("\n");

		expect(result.isError).toBeFalsy();
		expect(text).toContain("Bench Press");
		expect(text).toContain("1");
		expect(text).not.toContain("Squat");

		await client.close();
	});

	it("should report no matches without erroring", async () => {
		vi.spyOn(HevyClient.prototype, "getExerciseTemplates").mockResolvedValue({
			page: 1,
			page_count: 1,
			exercise_templates: [{ id: "2", title: "Squat" }],
		});

		const client = await connect();
		const result: any = await client.callTool({
			name: "search_exercise_templates",
			arguments: { query: "kayaking" },
		});

		expect(result.isError).toBeFalsy();
		expect(result.content.map((c: any) => c.text).join("\n")).toContain("No exercise templates");

		await client.close();
	});

	it("should serve repeat searches from the cache instead of re-paging the API", async () => {
		const spy = vi.spyOn(HevyClient.prototype, "getExerciseTemplates").mockResolvedValue({
			page: 1,
			page_count: 1,
			exercise_templates: [{ id: "1", title: "Bench Press" }],
		});

		// A second connection stands in for a later MCP session: the cache lives
		// in the KV store, so it survives beyond one session.
		for (const _ of [1, 2]) {
			const client = await connect();
			const result: any = await client.callTool({
				name: "search_exercise_templates",
				arguments: { query: "bench" },
			});
			expect(result.content.map((c: any) => c.text).join("\n")).toContain("Bench Press");
			await client.close();
		}

		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("should re-page the API when refresh is requested", async () => {
		const spy = vi.spyOn(HevyClient.prototype, "getExerciseTemplates").mockResolvedValue({
			page: 1,
			page_count: 1,
			exercise_templates: [{ id: "1", title: "Bench Press" }],
		});

		const client = await connect();
		await client.callTool({ name: "search_exercise_templates", arguments: { query: "bench" } });
		await client.callTool({
			name: "search_exercise_templates",
			arguments: { query: "bench", refresh: true },
		});
		await client.close();

		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("should drop the cache when a custom exercise is created", async () => {
		const spy = vi.spyOn(HevyClient.prototype, "getExerciseTemplates").mockResolvedValue({
			page: 1,
			page_count: 1,
			exercise_templates: [{ id: "1", title: "Bench Press" }],
		});
		vi.spyOn(HevyClient.prototype, "createExerciseTemplate").mockResolvedValue({
			exercise_template: { id: "99", title: "My Custom Lift" },
		});

		const client = await connect();
		await client.callTool({ name: "search_exercise_templates", arguments: { query: "bench" } });

		await client.callTool({
			name: "create_exercise_template",
			arguments: {
				title: "My Custom Lift",
				exercise_type: "weight_reps",
				equipment_category: "barbell",
				muscle_group: "chest",
			},
		});

		// The new exercise would otherwise be invisible until the TTL expired.
		await client.callTool({ name: "search_exercise_templates", arguments: { query: "bench" } });
		await client.close();

		expect(spy).toHaveBeenCalledTimes(2);
	});
});
